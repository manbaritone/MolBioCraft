// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { SequenceDocument, SequenceFeature, type ProteinAnalysisReport } from '../types/bio';
import {
  analyzeProteinSequence,
  auditSequenceAlerts,
  complement,
  detectCommonFeatures,
  EMPTY_RESTRICTION_SCAN,
  predictSecondaryStructure,
  restrictionSiteCountsByName,
  reverseComplement,
  scanRestrictionSites,
  translateSequence,
} from '../core/bioEngine';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import {
  BUILTIN_JS_PLUGINS,
  executeJavaScriptPlugin,
  EXTERNAL_BIO_CLI_TOOLS,
  JSPluginExecutionResult,
} from '../plugins/pluginEngine';
import {
  buildConstructLineageDagRust,
  CodonOptimizationResult,
  optimizeCodonsRust,
  scanPostTranslationalModificationsRust,
  simulatePeptideMs2SpectrumRust,
  simulateProteolyticDigestMsRust,
} from '../lib/rustBioEngine';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import {
  ProteinStructure3DViewer,
} from './ProteinStructure3DViewer';

import { FigureExportButton } from './FigureExportButton';
import { ResultWarnings } from './ResultWarnings';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';
import type { FigureTable } from '../core/figureExport';
import { defaultHybridSubTab, hybridTabsForDocument, type HybridSubTabId } from '../core/analysisContext';
import { cutSiteDisplayPosition } from '../core/restrictionDisplay';
import { restrictionScanScope, restrictionScopeWords } from './CircularPlasmidMap';
import { hasStructure, structureAtomsOf } from '../core/structureModels';
import {
  arcDiagram,
  FOLD_CAP_NT,
  FOLD_TEMPERATURES_C,
  formatEnsembleShare,
  pairClass,
  stemLoopGeometry,
} from '../core/nucleicFold';
import { CHART_FULL, chartMaxWidth, plotFrame, ticks } from '../core/chartLayout';

/**
 * The most residues of a protein document the protein tab analyses: more than titin (UniProt
 * Q8WZ42, 34,350 aa), the longest known protein, so a real protein is analysed whole. The PTM
 * scan's time grows about with the square of the length (in the WASM engine under Node, 41 ms at
 * 34,350 aa and 0.39 s at 100,000 aa), and the scan stopped with an engine error at 200,000 aa
 * (BG-01M6S13D).
 */
const PROTEIN_ANALYSIS_CAP_AA = 40_000;
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
 * Which bases of a DNA or RNA input the engine translated into the protein it analysed: the
 * `translatedSpan` of its protein analysis (biophysics_3d.rs `TranslatedSpan`), null when it
 * translated no residue. src/types/bio.ts does not declare it.
 */
interface TranslatedSpan {
  rule: 'longestForwardOrf' | 'fewestStopFrame';
  /** 1-based first and last base of the analysed slice; an ORF's span ends with its stop codon. */
  start: number;
  end: number;
  stopsRemoved: number;
}

const groupDigits = (v: number) => v.toLocaleString('en-US');

/**
 * What a protein KPI reads, in place of its value, when the engine translated no residue
 * (BG-01M6SQXX): its reply for no residue holds zeros for the mass, the extinction and the
 * absorbance, and null for the pI and the charge, none of them a measurement. Each KPI with no
 * residue to describe reads this one string; a count of what was found stays a number.
 */
export const NO_RESIDUE_TRANSLATED = 'n/a: no residue translated';

/**
 * What the protein tab says of the bases it analysed from a DNA or RNA document, or null when it
 * analysed, as one ORF, exactly what its heading names: the whole CDS, or with no CDS feature the
 * whole molecule (BG-01M6S13D). `span` counts bases of the slice the engine was given (the CDS,
 * read along its own strand, or the first 1,200 bp); the sentence names them in the document's.
 */
function translatedCoverage(
  span: TranslatedSpan | null | undefined,
  aa: number,
  slice: { length: number; docLength: number; cds: { name: string; start: number; end: number; minus: boolean } | null }
): string | null {
  const n = groupDigits;
  const { cds } = slice;
  // An empty document had nothing to translate, rather than none of its 0 bases covered (BG-01M6SQXX).
  if (slice.docLength === 0) return 'The document holds no bases; nothing was translated.';
  if (span === undefined) {
    const [from, to] = cds ? [cds.start, cds.end] : [1, slice.length];
    return `Protein analysis did not report which of bases ${n(from)}–${n(to)} of ${n(slice.docLength)} it translated.`;
  }
  if (span === null) {
    return `Protein analysis covered no bases of ${n(slice.docLength)}: no residue was translated from ${cds ? `the CDS ${cds.name}` : 'the molecule'}.`;
  }
  const whole = span.rule === 'longestForwardOrf' && span.start === 1 && span.end === slice.length;
  if (whole && (cds || slice.length === slice.docLength)) return null;
  const [from, to] = !cds
    ? [span.start, span.end]
    : cds.minus
      ? [cds.end - span.end + 1, cds.end - span.start + 1]
      : [cds.start + span.start - 1, cds.start + span.end - 1];
  const bases = `${cds?.minus ? 'the minus-strand bases' : 'bases'} ${n(from)}–${n(to)} of ${n(slice.docLength)}${cds ? `, not the whole CDS ${cds.name}` : ''}`;
  const where = cds ? 'read along the CDS' : `on the forward strand of bases 1–${n(slice.length)}`;
  if (span.rule === 'longestForwardOrf') {
    return `Protein analysis covered ${bases}: ${cds ? '' : 'with no CDS feature, '}it analyses the longest ORF (ATG to the first in-frame stop, at least 30 aa) ${where}, a ${n(aa)}-aa protein.`;
  }
  const frame = ((span.start - 1) % 3) + 1;
  const stops = `${n(span.stopsRemoved)} stop codon${span.stopsRemoved === 1 ? '' : 's'}`;
  return `Protein analysis covered ${bases}: ${cds ? 'with' : 'with no CDS feature and'} no ORF of at least 30 aa ${where}, it analyses ${cds ? "the CDS's " : ''}reading frame ${frame}, the frame with the fewest stop codons, as ${n(aa)} aa with its ${stops} left out.`;
}

/** Kyte-Doolittle hydropathy, and the b/y fragment-ion spectrum, both fill a studio card. */
const HYDRO_PLOT = plotFrame(CHART_FULL);
/** The Enzymes view's count for an enzyme the restriction scan did not read (BG-01M6S1K2). */
const NOT_SCANNED = 'not scanned';
const MS2_PLOT = plotFrame({ ...CHART_FULL, h: 280, padL: 52 });
export type { HybridSubTabId } from '../core/analysisContext';

interface HybridToolsAndHistoryStudioProps {
  doc: SequenceDocument;
  allDocuments?: SequenceDocument[];
  onUpdateDocument?: (updated: SequenceDocument) => void;
  initialSubTab?: HybridSubTabId;
  initialPluginId?: string;
  /** Incremented on every menu request so re-requesting the same sub-tab re-applies it. */
  commandNonce?: number;
  /** Opens another project document: a lineage graph's parent or descendant. */
  onSelectDocument?: (docId: string) => void;
}

const COMMERCIAL_SUPPLIERS = [
  'New England Biolabs (258)',
  'Thermo Fisher (Fermentas) (209)',
  'SibEnzyme (203)',
  'USB (142)',
  'Vivantis (136)',
  'Thermo Fisher (Invitrogen) (128)',
  'Enzynomics (120)',
  'Roche (118)',
  'Alator Biosciences (108)',
  'TaKaRa Bio (Clontech) (103)',
  'Promega (99)',
  'Toyobo Biochemicals (91)',
  'MP Biomedicals (81)',
  'EURx (73)',
  'CHIMERx (73)',
  'Nippon Gene Co. (73)',
  'Jena Bioscience (68)',
  'MilliporeSigma (57)',
  'Minotech (47)',
  'GeNei (45)',
  'Yeasen (44)',
  'Stratagene (3)',
];

export const HybridToolsAndHistoryStudio: React.FC<HybridToolsAndHistoryStudioProps> = ({
  doc,
  allDocuments,
  onUpdateDocument,
  initialSubTab,
  initialPluginId,
  commandNonce,
  onSelectDocument,
}) => {
  // In the workbench the Protein, Secondary structure and Lineage settings sit in App's inspector;
  // drawn on its own, the studio keeps each where it sits in its result (US-01M6TANN).
  const inWorkbench = useInWorkbench();
  const availableTabs = hybridTabsForDocument(doc);
  const [selectedSubTab, setSubTab] = useState<HybridSubTabId>(initialSubTab ?? defaultHybridSubTab(doc));
  const subTab = availableTabs.includes(selectedSubTab) ? selectedSubTab : defaultHybridSubTab(doc);
  const [enzymesDisplayTab, setEnzymesDisplayTab] = useState<'numbers' | 'lines'>('numbers');
  const [enzymeSetFilter, setEnzymeSetFilter] = useState<
    'unique' | 'unique_dual' | 'six_plus' | 'type2s' | 'all' | 'custom_set'
  >(doc.docMetadata?.['Document Type'] === 'Enzyme Set' ? 'custom_set' : 'unique');
  const [customEnzymeSetNames, setCustomEnzymeSetNames] = useState<string[]>(() => {
    const raw = String(doc.docMetadata?.['Enzyme Names'] ?? '').trim();
    return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  });
  const [selectedEnzymeRowNames, setSelectedEnzymeRowNames] = useState<string[]>([]);
  const [enzymePickerValue, setEnzymePickerValue] = useState<string>(REBASE_ENZYMES[0]?.name ?? 'EcoRI');
  const [enzymeSetSubView, setEnzymeSetSubView] = useState<'Enzymes' | 'Lineage' | 'Info'>('Enzymes');
  const [enzymeSetStatusMsg, setEnzymeSetStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    const isEnzDoc = doc.docMetadata?.['Document Type'] === 'Enzyme Set';
    const raw = String(doc.docMetadata?.['Enzyme Names'] ?? '').trim();
    const parsed = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    setCustomEnzymeSetNames(parsed);
    setSelectedEnzymeRowNames([]);
    if (isEnzDoc) {
      setEnzymeSetFilter('custom_set');
    }
  }, [doc.id, doc.docMetadata]);
  const [historyColorsEnabled, setHistoryColorsEnabled] = useState<boolean>(true);
  const [selectedStrain, setSelectedStrain] = useState<string>('DH5α (dam+ dcm+)');
  const [proteaseEnzyme, setProteaseEnzyme] = useState<string>('Trypsin');
  const [selectedMs2PeptideIdx, setSelectedMs2PeptideIdx] = useState<number>(0);

  useEffect(() => {
    if (initialSubTab) setSubTab(initialSubTab);
  }, [initialSubTab, commandNonce]);

  const [selectedPluginId, setSelectedPluginId] = useState<string>(
    initialPluginId && BUILTIN_JS_PLUGINS.some((p) => p.id === initialPluginId)
      ? initialPluginId
      : BUILTIN_JS_PLUGINS[0].id
  );
  const [scriptCode, setScriptCode] = useState<string>(() => {
    const found = initialPluginId ? BUILTIN_JS_PLUGINS.find((p) => p.id === initialPluginId) : undefined;
    return (found ?? BUILTIN_JS_PLUGINS[0]).code;
  });
  const [pluginOutput, setPluginOutput] = useState<JSPluginExecutionResult | null>(null);

  useEffect(() => {
    if (initialPluginId) {
      const found = BUILTIN_JS_PLUGINS.find((p) => p.id === initialPluginId);
      if (found) {
        setSelectedPluginId(found.id);
        setScriptCode(found.code);
        setPluginOutput(executeJavaScriptPlugin(found.code, doc, found.id));
      }
    }
  }, [initialPluginId, commandNonce, doc]);

  const [targetHost, setTargetHost] = useState<
    'ecoli_k12' | 'human_hek293' | 'yeast_scerevisiae'
  >('ecoli_k12');
  const [codonResult, setCodonResult] = useState<CodonOptimizationResult | null>(null);
  const [hydroWindow, setHydroWindow] = useState<number>(9);

  // Folding: a DNA document folds with the DNA nearest-neighbour parameters by default, and an RNA
  // one with Turner 2004, but either can be forced to see how the same strand behaves as the other.
  const [foldAs, setFoldAs] = useState<'DNA' | 'RNA'>(doc.moleculeType === 'DNA' ? 'DNA' : 'RNA');
  const [foldRegion, setFoldRegion] = useState<'whole' | 'cds'>('whole');
  const [foldTempC, setFoldTempC] = useState(37);
  const [foldDangles, setFoldDangles] = useState(true);
  // A plasmid really is a circle, so it is folded as one unless the user asks otherwise.
  const [foldCircular, setFoldCircular] = useState(doc.topology === 'circular');
  const [selectedHairpinId, setSelectedHairpinId] = useState<string | null>(null);
  useEffect(() => {
    setFoldCircular(doc.topology === 'circular');
  }, [doc.topology]);
  useEffect(() => {
    setFoldAs(doc.moleculeType === 'DNA' ? 'DNA' : 'RNA');
    setFoldRegion('whole');
    setSelectedHairpinId(null);
  }, [doc.id, doc.moleculeType]);

  // Extract main CDS or full sequence for Protein Analysis (supporting both DNA/RNA and direct Protein documents).
  // A protein is cut at its 40,000th residue, counted as the engine counts residues (BG-01M6S13D).
  const isProteinDoc = doc.moleculeType === 'Protein';
  const targetCdsSlice = useMemo(() => {
    if (isProteinDoc) {
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
  }, [doc, isProteinDoc]);

  const proteinReport = useMemo(
    () =>
      subTab === 'protein'
        ? (analyzeProteinSequence(targetCdsSlice.dna, !isProteinDoc, hydroWindow) as ProteinAnalysisReport & {
            translatedSpan?: TranslatedSpan | null;
          })
        : null,
    [subTab, targetCdsSlice.dna, isProteinDoc, hydroWindow]
  );
  // The engine translated no residue (a lone stop, part of a codon, an empty document): each
  // protein KPI with no answer reads NO_RESIDUE_TRANSLATED, and the digest and the PTM scan read
  // no residue rather than the stand-in protein they fall back to (BG-01M6SQXX).
  const noResidue = proteinReport !== null && proteinReport.lengthAa === 0;

  // What protein analysis covered, said beside the result whenever it is not all the tab reads
  // from: a protein past the cap, or an ORF or frame short of the whole CDS (with no CDS, of the
  // whole molecule).
  const analysisCoverage = useMemo(() => {
    if (!proteinReport) return null;
    if (isProteinDoc) {
      const n = groupDigits;
      return proteinReport.lengthAa < targetCdsSlice.totalResidues
        ? `Protein analysis covered residues 1–${n(proteinReport.lengthAa)} of ${n(targetCdsSlice.totalResidues)}: it reads at most ${n(PROTEIN_ANALYSIS_CAP_AA)} aa.`
        : null;
    }
    return translatedCoverage(proteinReport.translatedSpan, proteinReport.lengthAa, {
      length: targetCdsSlice.dna.length,
      docLength: doc.sequence.length,
      cds: targetCdsSlice.cds,
    });
  }, [proteinReport, isProteinDoc, targetCdsSlice, doc.sequence.length]);

  // Measured coordinates only (an imported .pdb / .cif); a sequence alone gets no 3D model.
  const measured3DAtoms = useMemo(
    () => (subTab === 'protein' && hasStructure(doc) ? structureAtomsOf(doc) : []),
    [subTab, doc]
  );

  // What is actually folded, and whether the engine's 600 nt cap cut it short.
  const foldInput = useMemo(() => {
    const full = foldRegion === 'cds' ? targetCdsSlice.dna : doc.sequence;
    const offset = foldRegion === 'cds' ? targetCdsSlice.startOffset : 1;
    const label = foldRegion === 'cds' ? targetCdsSlice.label : `${doc.name} (1..${doc.sequence.length})`;
    return { seq: full, suppliedNt: full.length, offset, label, truncated: full.length > FOLD_CAP_NT };
  }, [foldRegion, targetCdsSlice.dna, targetCdsSlice.startOffset, targetCdsSlice.label, doc.sequence, doc.name]);

  const secondaryStructReport = useMemo(
    () =>
      subTab === 'secondary-structure'
        ? predictSecondaryStructure(foldInput.seq, foldAs, {
            temperatureC: foldTempC,
            danglingEnds: foldDangles,
            // Only the whole molecule can be a circle; a CDS cut out of it is a linear piece.
            circular: foldCircular && foldRegion === 'whole',
          })
        : null,
    [subTab, foldInput.seq, foldAs, foldTempC, foldDangles, foldCircular, foldRegion]
  );

  const foldArcs = useMemo(
    () =>
      secondaryStructReport
        ? arcDiagram(secondaryStructReport.dotBracket, { width: CHART_FULL.w, height: 260, padX: 40, baselinePad: 40 })
        : null,
    [secondaryStructReport]
  );

  const activeHairpin = useMemo(() => {
    const list = secondaryStructReport?.stemLoops ?? [];
    if (!list.length) return null;
    return list.find((sl) => sl.id === selectedHairpinId) ?? list[0];
  }, [secondaryStructReport, selectedHairpinId]);

  // Drawn at a nucleotide pitch chosen so a small hairpin still fills a readable card without
  // being scaled up: spreading the geometry grows the drawing while the base letters stay 10 px.
  const hairpinGeometry = useMemo(() => {
    if (!activeHairpin) return null;
    const base = stemLoopGeometry(activeHairpin);
    const pitch = Math.max(17, Math.min(34, (17 * 260) / Math.max(base.height, 1)));
    return pitch === 17 ? base : stemLoopGeometry(activeHairpin, { pitch });
  }, [activeHairpin]);

  // Every scanned enzyme's complete site count, with each enzyme's first sites kept by position
  // and a warning naming the enzymes whose positions were cut (BG-01M6S1K2).
  const restrictionScan = useMemo(
    () => doc.moleculeType === 'DNA' && (subTab === 'enzymes-view' || subTab === 'lineage') ? scanRestrictionSites(doc.sequence, doc.topology) : EMPTY_RESTRICTION_SCAN,
    [subTab, doc.moleculeType, doc.sequence, doc.topology]
  );
  const allCutSites = restrictionScan.sites;
  // The scan above covers the whole molecule, but over 100,000 bp with the engine's core catalog
  // only (BG-01M6RPWR): an enzyme cutting once is then named for that catalog, not as unique.
  const restrictionWords =
    doc.moleculeType === 'DNA' ? restrictionScopeWords(restrictionScanScope(doc.sequence.length), doc.sequence.length) : null;

  const sequenceAlerts = useMemo(
    () => subTab === 'lineage' ? auditSequenceAlerts(doc, allCutSites, selectedStrain, restrictionScan.stoppedEarly) : [],
    [subTab, doc, allCutSites, selectedStrain, restrictionScan.stoppedEarly]
  );

  const autoDetectedFeatures = useMemo(() => subTab === 'lineage' && doc.moleculeType === 'DNA' ? detectCommonFeatures(doc) : [], [subTab, doc]);

  const digestMsReport = useMemo(() => {
    if (subTab !== 'protein') return null;
    const cleanProt = noResidue ? '' : targetCdsSlice.proteinSeq || 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLK';
    return simulateProteolyticDigestMsRust(cleanProt, proteaseEnzyme, 1, 400.0, 4500.0, true);
  }, [subTab, noResidue, targetCdsSlice.proteinSeq, proteaseEnzyme]);

  const activeMs2Peptide = useMemo(() => {
    const list = digestMsReport?.peptides ?? [];
    if (list.length === 0) return 'MSKGEELFTGVVPILVELDGDVNGHK';
    const clamped = Math.min(selectedMs2PeptideIdx, list.length - 1);
    return list[Math.max(0, clamped)].sequence;
  }, [digestMsReport?.peptides, selectedMs2PeptideIdx]);

  const ms2SpectrumReport = useMemo(
    () => subTab === 'protein' ? simulatePeptideMs2SpectrumRust(activeMs2Peptide, true) : null,
    [subTab, activeMs2Peptide]
  );

  const ptmDisulfideReport = useMemo(() => {
    if (subTab !== 'protein') return null;
    const cleanProt = noResidue ? '' : targetCdsSlice.proteinSeq || 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLK';
    return scanPostTranslationalModificationsRust(cleanProt);
  }, [subTab, noResidue, targetCdsSlice.proteinSeq]);

  /** The DAG's own canvas, so its Export control does not pick up a chart elsewhere on the tab. */
  const lineageDagRef = useRef<HTMLDivElement | null>(null);

  const lineageDagReport = useMemo(
    () => subTab === 'lineage' ? buildConstructLineageDagRust(doc, allDocuments && allDocuments.length > 0 ? allDocuments : [doc]) : null,
    [subTab, doc, allDocuments]
  );

  // The project documents the graph links this one to, each of which can be opened from here: its
  // parents (named in its history), its descendants (whose history names it), and the documents
  // linked to those.
  const lineageLinkedDocuments = useMemo(() => {
    if (!lineageDagReport) return [];
    const parentIds = new Set(doc.history.flatMap((h) => h.parentIds ?? []));
    const byId = new Map((allDocuments ?? []).map((d) => [d.id, d]));
    const relationOf = (d: SequenceDocument): 'Parent' | 'Descendant' | 'Linked' =>
      parentIds.has(d.id) ? 'Parent' : d.history.some((h) => (h.parentIds ?? []).includes(doc.id)) ? 'Descendant' : 'Linked';
    const order = { Parent: 0, Descendant: 1, Linked: 2 } as const;
    return lineageDagReport.nodes
      .filter((n) => n.isDocumentNode && n.docId && n.docId !== doc.id && byId.has(n.docId))
      .map((n) => {
        const linked = byId.get(n.docId as string) as SequenceDocument;
        return { id: linked.id, name: linked.name, relation: relationOf(linked) };
      })
      .sort((a, b) => order[a.relation] - order[b.relation]);
  }, [lineageDagReport, doc, allDocuments]);

  const filteredEnzymeSummary = useMemo(() => {
    if (subTab !== 'enzymes-view') return [];
    const byEnz: Record<string, typeof allCutSites> = {};
    for (const c of allCutSites) {
      if (!byEnz[c.enzyme.name]) byEnz[c.enzyme.name] = [];
      byEnz[c.enzyme.name].push(c);
    }
    const customSetLookup = new Set(customEnzymeSetNames);
    // `count` is the enzyme's complete site count, and null for an enzyme the scan did not read
    // (over 100,000 bp only the core enzymes are scanned), which is no noncutter; `cuts` are the
    // positions the scan kept, each enzyme's first ones.
    const counts = restrictionSiteCountsByName(restrictionScan);
    return REBASE_ENZYMES.map((enz) => {
      const cuts = byEnz[enz.name] || [];
      const count: number | null = enz.name in counts ? counts[enz.name] : null;
      return { enzyme: enz, count, cuts };
    }).filter((row) => {
      if (enzymeSetFilter === 'custom_set') return customSetLookup.has(row.enzyme.name);
      if (enzymeSetFilter === 'unique') return row.count === 1;
      if (enzymeSetFilter === 'unique_dual') return row.count === 1 || row.count === 2;
      if (enzymeSetFilter === 'six_plus') return enzLength(row.enzyme.recognitionSeq) >= 6 && (row.count ?? 0) > 0;
      if (enzymeSetFilter === 'type2s') return Boolean(row.enzyme.isTypeIIS);
      return true;
    });
  }, [subTab, allCutSites, restrictionScan, enzymeSetFilter, customEnzymeSetNames]);

  function enzLength(seq: string): number {
    return seq.replace(/N/gi, '').length || seq.length;
  }

  const persistEnzymeSetToDocument = (nextNames: string[], note?: string) => {
    setCustomEnzymeSetNames(nextNames);
    setEnzymeSetFilter('custom_set');
    if (onUpdateDocument) {
      // Only an Enzyme Set record is retyped/re-described. On a sequence
      // document the set is stored as metadata; previously any plasmid open in
      // the Enzymes view was converted into an "Enzyme Set" record (sequence
      // hidden, description overwritten).
      const isEnzymeSetDoc = doc.docMetadata?.['Document Type'] === 'Enzyme Set';
      onUpdateDocument({
        ...doc,
        ...(isEnzymeSetDoc
          ? { description: `${nextNames.length} ${nextNames.length === 1 ? 'enzyme' : 'enzymes'}` }
          : {}),
        docMetadata: {
          ...(doc.docMetadata ?? {}),
          ...(isEnzymeSetDoc ? { 'Document Type': 'Enzyme Set', '# Enzymes': nextNames.length } : {}),
          'Enzyme Names': nextNames.join(', '),
        },
        updatedAt: new Date().toISOString(),
      });
    }
    if (note) setEnzymeSetStatusMsg(note);
  };

  const handleAddEnzymeToSet = (enzName: string) => {
    if (!enzName) return;
    // Edit the saved set itself; the table filter only changes what is shown.
    const baseList = customEnzymeSetNames;
    const next = baseList.includes(enzName) ? baseList : [...baseList, enzName];
    persistEnzymeSetToDocument(next, `Added ${enzName} (${next.length} enzymes in set)`);
  };

  const handleRemoveSelectedEnzymesFromSet = () => {
    if (selectedEnzymeRowNames.length === 0) return;
    const removeSet = new Set(selectedEnzymeRowNames);
    // Edit the saved set itself; the table filter only changes what is shown.
    const baseList = customEnzymeSetNames;
    const next = baseList.filter((n) => !removeSet.has(n));
    setSelectedEnzymeRowNames([]);
    persistEnzymeSetToDocument(
      next,
      `Removed ${removeSet.size} selected enzyme(s) (${next.length} remaining)`
    );
  };

  const handleCombineEnzymeSets = () => {
    const coreSixCutters = ['EcoRI', 'BamHI', 'HindIII', 'NcoI', 'NdeI', 'XhoI', 'NotI', 'SalI', 'KpnI', 'SacI', 'SpeI', 'XbaI'];
    // Edit the saved set itself; the table filter only changes what is shown.
    const baseList = customEnzymeSetNames;
    const combined = Array.from(new Set([...baseList, ...coreSixCutters]));
    persistEnzymeSetToDocument(
      combined,
      `Combined with Core Cloning Set (${combined.length} total enzymes)`
    );
  };

  const handleExtractSelectedEnzymes = () => {
    if (selectedEnzymeRowNames.length === 0) return;
    const extracted = [...selectedEnzymeRowNames];
    persistEnzymeSetToDocument(
      extracted,
      `Extracted ${extracted.length} selected enzyme(s) into active Enzyme Set`
    );
  };

  const handleExportEnzymeTableCsv = () => {
    const header = 'Name,Recognition Sequence,Effective Length (nt),Overhang,Methylation,# Cuts';
    const rows = filteredEnzymeSummary.map(({ enzyme, count }) => {
      const overhang =
        enzyme.cutFwd === enzyme.cutRev
          ? 'Blunt'
          : enzyme.cutFwd < enzyme.cutRev
          ? "5' Overhang"
          : "3' Overhang";
      const meth =
        enzyme.methylationSensitivity && enzyme.methylationSensitivity.length > 0
          ? enzyme.methylationSensitivity.join(';')
          : 'None';
      return `${enzyme.name},${enzyme.recognitionSeq},${enzLength(enzyme.recognitionSeq)},${overhang},${meth},${count}`;
    });
    const csv = [header, ...rows].join('\n');
    saveWorkbenchFile(`${doc.name.replace(/\s+/g, '_')}_Enzymes.csv`, csv, 'text/csv;charset=utf-8');
    setEnzymeSetStatusMsg(`Exported ${filteredEnzymeSummary.length} enzyme row(s) to CSV`);
  };

  const handleAutoAnnotateCommonFeatures = () => {
    if (!onUpdateDocument || autoDetectedFeatures.length === 0) return;
    onUpdateDocument({
      ...doc,
      features: [...doc.features, ...autoDetectedFeatures],
      updatedAt: new Date().toISOString(),
    });
  };

  useEffect(() => {
    if (subTab === 'workflows') {
      const activePlugin =
        BUILTIN_JS_PLUGINS.find((p) => p.id === selectedPluginId) ?? BUILTIN_JS_PLUGINS[0];
      setPluginOutput(executeJavaScriptPlugin(activePlugin.code, doc, activePlugin.id));
    }
  }, [doc, subTab, selectedPluginId]);

  useEffect(() => {
    if (subTab === 'protein' && !isProteinDoc) {
      setCodonResult(optimizeCodonsRust(targetCdsSlice.dna, 'ecoli_k12'));
    }
  }, [doc, targetCdsSlice.dna, subTab, isProteinDoc]);

  const handleSelectPlugin = (id: string) => {
    setSelectedPluginId(id);
    const found = BUILTIN_JS_PLUGINS.find((p) => p.id === id);
    if (found) {
      setScriptCode(found.code);
      setPluginOutput(executeJavaScriptPlugin(found.code, doc, found.id));
    }
  };

  const handleRunCustomScript = () => {
    setPluginOutput(executeJavaScriptPlugin(scriptCode, doc, selectedPluginId));
  };

  const handleAnnotatePredictedPluginFeatures = () => {
    if (!onUpdateDocument || !pluginOutput?.predictedFeatures?.length) return;
    const existingIds = new Set(doc.features.map((f) => f.id));
    const toAdd = pluginOutput.predictedFeatures.filter((f) => !existingIds.has(f.id));
    if (toAdd.length === 0) return;
    onUpdateDocument({
      ...doc,
      features: [...doc.features, ...toAdd],
      updatedAt: new Date().toISOString(),
    });
  };

  const handleRunCodonOpt = (
    host: 'ecoli_k12' | 'human_hek293' | 'yeast_scerevisiae'
  ) => {
    setTargetHost(host);
    setCodonResult(optimizeCodonsRust(targetCdsSlice.dna, host));
  };

  const handleAnnotateEpitopes = () => {
    if (!onUpdateDocument || !proteinReport) return;
    const newFeatures: SequenceFeature[] = proteinReport.antigenicDeterminants.map(
      (ep, idx) => {
        // Codon span of the epitope in CDS coordinates, mapped back to the
        // construct (mirrored for a minus-strand CDS).
        const cdsFrom = (ep.startAa - 1) * 3 + 1;
        const cdsTo = ep.endAa * 3;
        const { startOffset, endOffset, minusStrand } = targetCdsSlice;
        const start = isProteinDoc ? ep.startAa : minusStrand ? endOffset - cdsTo + 1 : startOffset + cdsFrom - 1;
        const end = isProteinDoc ? ep.endAa : minusStrand ? endOffset - cdsFrom + 1 : startOffset + cdsTo - 1;
        return {
        id: `feat-epitope-${Date.now()}-${idx}`,
        name: `Antigenic_Epitope_${ep.startAa}_${ep.endAa}`,
        type: 'antigenic_epitope',
        start: Math.max(1, start),
        end: Math.min(doc.sequence.length, end),
        strand: (minusStrand ? -1 : 1) as 1 | -1,
        color: '#d97706',
        notes: `EMBOSS Kolaskar-Tongaonkar antigenic determinant (${ep.peptide}, score=${ep.maxScore})`,
        };
      }
    );
    onUpdateDocument({
      ...doc,
      features: [...doc.features, ...newFeatures],
      updatedAt: new Date().toISOString(),
    });
  };

  // Build SVG path for Kyte-Doolittle Hydrophobicity Plot
  const hydroSvgPath = useMemo(() => {
    const prof = proteinReport?.hydrophobicityProfile ?? [];
    if (!prof.length) return '';
    return prof
      .map((pt, idx) => {
        const x = HYDRO_PLOT.xOfIndex(idx, prof.length);
        const y = HYDRO_PLOT.yOf(pt.score, -4.5, 4.5);
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [proteinReport?.hydrophobicityProfile]);

  /** The plotted profile as values, so the chart and the numbers behind it export together. */
  const hydroTable = useMemo((): FigureTable | null => {
    const prof = proteinReport?.hydrophobicityProfile ?? [];
    if (!prof.length) return null;
    return {
      headers: ['Residue position (aa)', `Kyte-Doolittle score (window ${hydroWindow} aa)`],
      rows: prof.map((pt) => [String(pt.position), pt.score.toFixed(3)]),
      caption: `${doc.name} — Kyte-Doolittle hydropathy, ${hydroWindow} aa window`,
    };
  }, [doc.name, hydroWindow, proteinReport?.hydrophobicityProfile]);

  // The Protein and Lineage settings sit in two places of their result. In the workbench each
  // sub-tab's pair is drawn in one inspector section and nowhere in the result; drawn on its own,
  // the studio draws each where it sat.
  const hydroWindowSlider = (
    <input
      type="range"
      min={5}
      max={21}
      step={2}
      value={hydroWindow}
      onChange={(e) => setHydroWindow(Number(e.target.value))}
    />
  );
  const proteaseSelect = (
    <select
      value={proteaseEnzyme}
      onChange={(e) => {
        setProteaseEnzyme(e.target.value);
        setSelectedMs2PeptideIdx(0);
      }}
    >
      <option value="Trypsin">Trypsin (K/R | not P)</option>
      <option value="Chymotrypsin">Chymotrypsin (F/Y/W/L)</option>
      <option value="Lys-C">Endoproteinase Lys-C (K)</option>
      <option value="Glu-C">Staph. V8 Glu-C (E/D)</option>
    </select>
  );
  const historyColorsToggle = (
    <label className="mbc-check-row">
      <input
        type="checkbox"
        checked={historyColorsEnabled}
        onChange={(e) => setHistoryColorsEnabled(e.target.checked)}
      />
      <span>Show History Colors</span>
    </label>
  );
  const strainField = (
    <label className="form-field">
      <span>Bacterial Transformation Strain:</span>
      <select
        value={selectedStrain}
        onChange={(e) => setSelectedStrain(e.target.value)}
      >
        <option value="DH5α (dam+ dcm+)">E. coli DH5α (dam+ dcm+)</option>
        <option value="JM110 / SCS110 (dam- dcm-)">E. coli JM110 / SCS110 (dam- dcm-)</option>
        <option value="BL21(DE3) (dam+ dcm-)">E. coli BL21(DE3) (dam+ dcm-)</option>
        <option value="Stbl3 / NEB Stable">E. coli Stbl3 / Stable (Lentiviral)</option>
      </select>
    </label>
  );

  return (
    <div className="alignment-studio-wrapper">
      <div className="studio-card-header" style={{ marginBottom: 8 }}>
        <ScrollableMenuStrip
          className="mbc-scroll-strip--pills"
          trackClassName="cloning-method-tabs"
          role="tablist"
          ariaLabel="Protein and Lineage Modules"
          alwaysShowArrows={availableTabs.length > 1}
          activeKey={subTab}
          enableSpatialArrowNav
          activateOnSpatialFocus
          prevAriaLabel="Slide protein modules left"
          nextAriaLabel="Slide protein modules right"
        >
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('protein')}
            tabIndex={subTab === 'protein' ? 0 : -1}
            aria-selected={subTab === 'protein'}
            className={`method-tab-btn ${subTab === 'protein' ? 'active' : ''}`}
            onClick={() => setSubTab('protein')}
          >
            {doc.moleculeType === 'Protein' ? 'Protein Analysis' : 'Protein Analysis & Codon Opt'}
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('secondary-structure')}
            tabIndex={subTab === 'secondary-structure' ? 0 : -1}
            aria-selected={subTab === 'secondary-structure'}
            className={`method-tab-btn ${subTab === 'secondary-structure' ? 'active' : ''}`}
            onClick={() => setSubTab('secondary-structure')}
          >
            Secondary Structure (⌘7)
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('enzymes-view')}
            tabIndex={subTab === 'enzymes-view' ? 0 : -1}
            aria-selected={subTab === 'enzymes-view'}
            className={`method-tab-btn ${subTab === 'enzymes-view' ? 'active' : ''}`}
            onClick={() => setSubTab('enzymes-view')}
          >
            Enzymes View (123 / |||| — ⌘3)
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('lineage')}
            tabIndex={subTab === 'lineage' ? 0 : -1}
            aria-selected={subTab === 'lineage'}
            className={`method-tab-btn ${subTab === 'lineage' ? 'active' : ''}`}
            onClick={() => setSubTab('lineage')}
          >
            History Tree, Alerts &amp; Info (⌘8)
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('workflows')}
            tabIndex={subTab === 'workflows' ? 0 : -1}
            aria-selected={subTab === 'workflows'}
            className={`method-tab-btn ${subTab === 'workflows' ? 'active' : ''}`}
            onClick={() => setSubTab('workflows')}
          >
            Workflows &amp; Genetic Code Tables
          </button>
        </ScrollableMenuStrip>
        <span className="badge-accent">{isProteinDoc ? 'Protein analysis and history' : 'Sequence tools and history'}</span>
      </div>

      {subTab === 'protein' && analysisCoverage && (
        <ResultWarnings warnings={[analysisCoverage]} label="Protein analysis coverage" />
      )}
      {subTab === 'protein' && proteinReport && digestMsReport && ms2SpectrumReport && ptmDisulfideReport && (
        <div className="studio-split-grid">
          {inWorkbench && (
            <InspectorSection title="Protein Analysis" order={1}>
              <label className="mbc-control-row">
                <span>Hydropathy window: {hydroWindow} aa</span>
                {hydroWindowSlider}
              </label>
              <label className="form-field">
                Protease
                {proteaseSelect}
              </label>
            </InspectorSection>
          )}
          {/* Left Card: EMBOSS Protein Analysis, Hydrophobicity, GOR Secondary Structure & Antigenicity */}
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>EMBOSS Protein Analysis — {targetCdsSlice.label}</h3>
              <span className="badge-accent">Kyte-Doolittle + GOR + Kolaskar</span>
            </div>

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Molecular Weight</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.molecularWeightKda} kDa ({proteinReport.lengthAa} aa)</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Isoelectric Point (pI)</span>
                <strong className="kpi-val">{noResidue ? NO_RESIDUE_TRANSLATED : <>pH {proteinReport.isoelectricPointPi}</>}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label" title="Net charge on the same Bjellqvist titration the pI is the root of">
                  Charge at pH 7
                </span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>
                    {proteinReport.chargeAtPh7 > 0 ? '+' : ''}
                    {proteinReport.chargeAtPh7.toFixed(2)}
                  </>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">ε₂₈₀ reduced / cystines (M⁻¹cm⁻¹)</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>
                    {proteinReport.extinctionCoeff280Reduced.toLocaleString()} /{' '}
                    {proteinReport.extinctionCoeff280Cystine.toLocaleString()}
                  </>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label" title="Absorbance of a 1 mg/ml solution in a 1 cm cell, cysteines paired">
                  A[280] of 1 mg/ml
                </span>
                <strong className="kpi-val">{noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.a280Of1mgPerMl.toFixed(2)} AU</>}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">GRAVY / Aliphatic</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.gravyHydropathy} / {proteinReport.aliphaticIndex}</>}
                </strong>
              </div>
            </div>

            {/* Kyte-Doolittle Hydrophobicity Plot */}
            <div data-mbc-figure>
            <div className="studio-card-header" style={{ paddingTop: 4 }}>
              <h4>Kyte-Doolittle Hydropathy Plot (Window = {hydroWindow} aa)</h4>
              {!inWorkbench && hydroWindowSlider}
              <FigureExportButton
                compact
                baseName={`${doc.name} — Kyte-Doolittle Hydropathy`}
                title={`${doc.name} — Kyte-Doolittle hydropathy (${hydroWindow} aa window)`}
                table={hydroTable}
              />
            </div>

            <svg
              viewBox={`0 0 ${HYDRO_PLOT.w} ${HYDRO_PLOT.h}`}
              className="phylo-tree-svg"
              style={chartMaxWidth(HYDRO_PLOT.w)}
              role="img"
              aria-label={`Kyte-Doolittle hydropathy over ${proteinReport.lengthAa} residues`}
            >
              <rect
                x={HYDRO_PLOT.x}
                y={HYDRO_PLOT.y}
                width={HYDRO_PLOT.width}
                height={HYDRO_PLOT.height}
                fill="var(--mbc-bg-panel)"
                stroke="var(--mbc-border)"
              />
              {ticks(-4.5, 4.5, 7).map((v) => (
                <g key={v}>
                  <line
                    x1={HYDRO_PLOT.x}
                    y1={HYDRO_PLOT.yOf(v, -4.5, 4.5)}
                    x2={HYDRO_PLOT.x + HYDRO_PLOT.width}
                    y2={HYDRO_PLOT.yOf(v, -4.5, 4.5)}
                    stroke={v === 0 ? 'var(--mbc-text-muted)' : 'var(--mbc-border-light)'}
                    strokeDasharray={v === 0 ? '3 3' : undefined}
                  />
                  <text
                    x={HYDRO_PLOT.x - 8}
                    y={HYDRO_PLOT.yOf(v, -4.5, 4.5) + 3.5}
                    textAnchor="end"
                    fill="var(--mbc-text-secondary)"
                    fontSize="11"
                  >
                    {v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)}
                  </text>
                </g>
              ))}
              {/* transmembrane threshold */}
              <line
                x1={HYDRO_PLOT.x}
                y1={HYDRO_PLOT.yOf(1.6, -4.5, 4.5)}
                x2={HYDRO_PLOT.x + HYDRO_PLOT.width}
                y2={HYDRO_PLOT.yOf(1.6, -4.5, 4.5)}
                stroke="var(--mbc-red)"
                strokeDasharray="2 2"
              />
              <text
                x={HYDRO_PLOT.x + HYDRO_PLOT.width - 6}
                y={HYDRO_PLOT.yOf(1.6, -4.5, 4.5) - 5}
                textAnchor="end"
                fill="var(--mbc-red)"
                fontSize="10.5"
                fontWeight="600"
              >
                +1.6 hydrophobic threshold
              </text>
              {ticks(1, proteinReport.lengthAa, 6).map((v, i, all) => (
                <text
                  key={v}
                  x={HYDRO_PLOT.xOfIndex(i, all.length)}
                  y={HYDRO_PLOT.y + HYDRO_PLOT.height + 16}
                  textAnchor="middle"
                  fill="var(--mbc-text-secondary)"
                  fontSize="10.5"
                >
                  {Math.round(v)}
                </text>
              ))}
              <path d={hydroSvgPath} fill="none" stroke="var(--mbc-blue)" strokeWidth="1.5" />
              <text
                x={HYDRO_PLOT.x + HYDRO_PLOT.width / 2}
                y={HYDRO_PLOT.h - 8}
                textAnchor="middle"
                fill="var(--mbc-text-secondary)"
                fontSize="11"
                fontWeight="600"
              >
                Residue position (1..{proteinReport.lengthAa} aa)
              </text>
            </svg>
            </div>

            {/* Garnier-Osguthorpe-Robson (GOR) Secondary Structure & Kolaskar Antigenicity */}
            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">α-Helix (GOR H)</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.secondaryStructureSummary.helixPercent}%</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">β-Sheet (GOR E)</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.secondaryStructureSummary.sheetPercent}%</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Random Coil (C)</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.secondaryStructureSummary.coilPercent}%</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Antigenic Epitopes</span>
                <strong className="kpi-val">
                  {proteinReport.antigenicDeterminants.length} regions
                </strong>
              </div>
            </div>

            {onUpdateDocument && proteinReport.antigenicDeterminants.length > 0 && (
              <button className="btn-success" onClick={handleAnnotateEpitopes}>
                + Annotate {proteinReport.antigenicDeterminants.length} Predicted Antigenic Epitopes onto{' '}
                {doc.name}
              </button>
            )}

            {measured3DAtoms.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <ProteinStructure3DViewer
                  primaryAtoms={measured3DAtoms}
                  structureText={String(doc.docMetadata?.PDBText ?? doc.docMetadata?.['PDB Text'] ?? '') || undefined}
                  activeChainId={String(doc.docMetadata?.Chain ?? '').trim() || undefined}
                  title={`${doc.name} — measured structure`}
                  heightPx={250}
                  offscreenDeferred
                />
              </div>
            )}
          </div>

          {/* Right Card: Back-Translation & Multi-Host Codon Optimization + Antigenic Table */}
          <div className="studio-card">
            {!isProteinDoc && (<>
            <div className="studio-card-header">
              <h3>
                Sequence{' '}
                <ChevronRight
                  size={15}
                  strokeWidth={2.4}
                  className="mbc-inline-chevron"
                  aria-hidden="true"
                />{' '}
                Back-Translate &amp; Multi-Host Codon Optimizer
              </h3>
              <span className="badge-accent">{codonResult?.engine || 'Python Sidecar'}</span>
            </div>

            <div className="cloning-method-tabs">
              {(
                [
                  ['ecoli_k12', 'E. coli K12'],
                  ['human_hek293', 'Human (HEK293)'],
                  ['yeast_scerevisiae', 'Yeast (S. cerevisiae)'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={`method-tab-btn ${targetHost === id ? 'active' : ''}`}
                  onClick={() => handleRunCodonOpt(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {codonResult && (
              <div className="codon-result-panel">
                <div className="thermo-kpi-grid">
                  <div className="kpi-box">
                    <span className="kpi-label">Codon Adaptation (CAI)</span>
                    <strong className="kpi-val">{codonResult.caiScore}</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Optimized GC%</span>
                    <strong className="kpi-val">{codonResult.gcPercent}%</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">CDS Length</span>
                    <strong className="kpi-val">{codonResult.lengthBp} bp</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Host Table</span>
                    <strong className="kpi-val">{codonResult.host}</strong>
                  </div>
                </div>
                <div className="newick-box" style={{ marginTop: 6 }}>
                  <span>Back-Translated / Codon-Optimized DNA (5&apos;→3&apos;):</span>
                  <code>{codonResult.optimizedDna.slice(0, 210)}...</code>
                </div>
              </div>
            )}

            </>)}

            <h4 className="sub-heading">
              EMBOSS Kolaskar-Tongaonkar Predicted Antigenic Regions
            </h4>
            <WorkbenchSmartTable
              tableId="hybrid-protein-antigenic-regions"
              tableLabel="Predicted Antigenic Regions"
              regionMaxHeight={195}
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>AA Coordinates</th>
                  <th>Peptide Sequence</th>
                  <th>Length</th>
                  <th>Antigenicity Score</th>
                </tr>
              </thead>
              <tbody>
                {proteinReport.antigenicDeterminants.map((ep, idx) => (
                  <tr key={idx}>
                    <td>
                      <strong>
                        aa {ep.startAa}..{ep.endAa}
                      </strong>
                    </td>
                    <td className="mono-cell">{ep.peptide}</td>
                    <td>{ep.peptide.length} aa</td>
                    <td>{ep.maxScore}</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>

            {/* Proteomics LC-MS/MS In-Silico Digest, CID/HCD b/y-Ion MS2 Spectrum & PTM / petgraph Disulfide Scanner */}
            <div className="mbc-studio-isolated-region" style={{ marginTop: 12 }}>
              <div className="studio-card-header" style={{ paddingTop: 4 }}>
                <h4>Proteomics LC-MS/MS Digest, b/y-Ion MS2 &amp; PTM / Disulfide Prediction</h4>
                {!inWorkbench && proteaseSelect}
              </div>

              <ResultWarnings warnings={digestMsReport.warnings} label="Digest warnings" />

              <div className="thermo-kpi-grid">
                <div className="kpi-box">
                  <span className="kpi-label">Intact Mass (Mono)</span>
                  <strong className="kpi-val">
                    {noResidue ? NO_RESIDUE_TRANSLATED : <>{(digestMsReport.intactMonoisotopicDa / 1000).toFixed(2)} kDa</>}
                  </strong>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">Observable MS1 Peptides</span>
                  <strong className="kpi-val">
                    {digestMsReport.observablePeptideCount} (
                    {noResidue ? NO_RESIDUE_TRANSLATED : <>{digestMsReport.sequenceCoveragePct.toFixed(1)}% cov</>})
                  </strong>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">PTMs / PEST Degrons</span>
                  <strong className="kpi-val">
                    {ptmDisulfideReport.ptmSites.length} / {ptmDisulfideReport.pestDegrons.length}
                  </strong>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">Predicted Disulfides</span>
                  <strong className="kpi-val">
                    {ptmDisulfideReport.disulfideBonds.length} ({ptmDisulfideReport.totalCysteines} Cys)
                  </strong>
                </div>
              </div>

              {digestMsReport.peptides.length > 0 && (
                <div style={{ marginTop: 6 }} data-mbc-figure>
                  <div className="studio-card-header" style={{ paddingTop: 0 }}>
                    <h4>b/y-Ion MS2 Spectrum</h4>
                    <FigureExportButton
                      compact
                      baseName={`${doc.name} — MS2 Spectrum`}
                      title={`${doc.name} — b/y fragment-ion spectrum`}
                      table={{
                        headers: ['m/z', 'Relative intensity (%)', 'Ion series', 'Label'],
                        rows: ms2SpectrumReport.peaks.map((pk) => [
                          pk.mz.toFixed(4),
                          pk.relativeIntensity.toFixed(1),
                          pk.ionSeries,
                          pk.label,
                        ]),
                        caption: `${doc.name} — b/y fragment ions, precursor [M+2H]2+ = ${ms2SpectrumReport.precursorMz2plus.toFixed(3)} m/z`,
                      }}
                    />
                  </div>
                  <label className="form-field" style={{ marginBottom: 6 }}>
                    <span>
                      b/y Fragment Ions (exact m/z; bar heights are a qualitative guide, not predicted
                      intensities) — Precursor [M+2H]²⁺ ={' '}
                      {ms2SpectrumReport.precursorMz2plus.toFixed(3)} m/z:
                    </span>
                    <select
                      value={Math.min(selectedMs2PeptideIdx, digestMsReport.peptides.length - 1)}
                      onChange={(e) => setSelectedMs2PeptideIdx(Number(e.target.value))}
                    >
                      {digestMsReport.peptides.slice(0, 18).map((pep, idx) => (
                        <option key={pep.peptideIndex} value={idx}>
                          #{pep.peptideIndex} ({pep.startAa}..{pep.endAa} aa) {pep.sequence} — {pep.mzCharge2.toFixed(2)} m/z (RT {pep.hplcRetentionMin.toFixed(1)} min)
                        </option>
                      ))}
                    </select>
                  </label>

                  <svg
                    viewBox={`0 0 ${MS2_PLOT.w} ${MS2_PLOT.h}`}
                    className="phylo-tree-svg"
                    style={chartMaxWidth(MS2_PLOT.w)}
                    role="img"
                    aria-label={`b and y fragment-ion spectrum, ${ms2SpectrumReport.peaks.length} peaks`}
                  >
                    <rect
                      x={MS2_PLOT.x}
                      y={MS2_PLOT.y}
                      width={MS2_PLOT.width}
                      height={MS2_PLOT.height}
                      fill="var(--mbc-bg-panel)"
                      stroke="var(--mbc-border)"
                    />
                    {(() => {
                      const peaks = ms2SpectrumReport.peaks;
                      const maxMz = Math.max(400, ...peaks.map((p) => p.mz)) * 1.06;
                      const baseY = MS2_PLOT.y + MS2_PLOT.height;
                      return (
                        <>
                          {ticks(0, 100, 5).map((v) => (
                            <g key={`i${v}`}>
                              <line
                                x1={MS2_PLOT.x}
                                y1={MS2_PLOT.yOf(v, 0, 100)}
                                x2={MS2_PLOT.x + MS2_PLOT.width}
                                y2={MS2_PLOT.yOf(v, 0, 100)}
                                stroke="var(--mbc-border-light)"
                              />
                              <text
                                x={MS2_PLOT.x - 8}
                                y={MS2_PLOT.yOf(v, 0, 100) + 3.5}
                                textAnchor="end"
                                fill="var(--mbc-text-secondary)"
                                fontSize="10.5"
                              >
                                {v}
                              </text>
                            </g>
                          ))}
                          {ticks(0, maxMz, 7).map((v) => (
                            <text
                              key={`m${v}`}
                              x={MS2_PLOT.xOf(v, 0, maxMz)}
                              y={baseY + 16}
                              textAnchor="middle"
                              fill="var(--mbc-text-secondary)"
                              fontSize="10.5"
                            >
                              {Math.round(v)}
                            </text>
                          ))}
                          {peaks.map((pk, idx) => {
                            const x = MS2_PLOT.xOf(pk.mz, 0, maxMz);
                            const y = MS2_PLOT.yOf(pk.relativeIntensity, 0, 100);
                            const isY = pk.ionSeries.startsWith('y');
                            const col = isY ? 'var(--mbc-red)' : 'var(--mbc-blue)';
                            return (
                              <g key={`${pk.label}-${idx}`}>
                                <line x1={x} y1={baseY} x2={x} y2={y} stroke={col} strokeWidth="1.4" />
                                {pk.relativeIntensity >= 42 && (
                                  <text x={x} y={y - 5} textAnchor="middle" fill={col} fontSize="10" fontWeight="700">
                                    {pk.label}
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </>
                      );
                    })()}
                    <text
                      x={MS2_PLOT.x - 8}
                      y={MS2_PLOT.y - 6}
                      textAnchor="end"
                      fill="var(--mbc-text-secondary)"
                      fontSize="10"
                    >
                      rel %
                    </text>
                    <text
                      x={MS2_PLOT.x + MS2_PLOT.width / 2}
                      y={MS2_PLOT.h - 8}
                      textAnchor="middle"
                      fill="var(--mbc-text-secondary)"
                      fontSize="11"
                      fontWeight="600"
                    >
                      m/z — blue: N-terminal b-ions · red: C-terminal y-ions (
                      {ptmDisulfideReport.predictedSubcellularCompartment})
                    </text>
                  </svg>
                </div>
              )}

              <WorkbenchSmartTable
                tableId="hybrid-proteomics-peptides"
                tableLabel="Proteolytic LC-MS Peptides"
                regionMaxHeight={165}
                className="bio-table"
              >
                <thead>
                  <tr>
                    <th>Span</th>
                    <th>Peptide</th>
                    <th>Formula</th>
                    <th>[M+2H]²⁺ m/z</th>
                    <th>RT (min)</th>
                  </tr>
                </thead>
                <tbody>
                  {digestMsReport.peptides.slice(0, 24).map((pep) => (
                    <tr key={pep.peptideIndex}>
                      <td>
                        aa {pep.startAa}..{pep.endAa}
                      </td>
                      <td className="mono-cell">{pep.sequence}</td>
                      <td className="mono-cell">{pep.chemicalFormula}</td>
                      <td>{pep.mzCharge2.toFixed(3)}</td>
                      <td>{pep.hplcRetentionMin.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>
          </div>
        </div>
      )}

      {subTab === 'secondary-structure' && secondaryStructReport && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Nucleic-Acid Fold — {foldInput.label}</h3>
              <span className="badge-accent">
                MFE ΔG = {secondaryStructReport.minimumFreeEnergyKcalMol} kcal/mol
              </span>
            </div>

            <InspectorSection title="Folding" order={1}>
            <div className="form-grid-2col">
              <label className="form-field">
                Nearest-neighbour parameters
                <select value={foldAs} onChange={(e) => setFoldAs(e.target.value as 'DNA' | 'RNA')}>
                  <option value="RNA">RNA — Turner 2004</option>
                  <option value="DNA">DNA — Mathews 2004</option>
                </select>
              </label>
              <label className="form-field">
                Region to fold
                <select value={foldRegion} onChange={(e) => setFoldRegion(e.target.value as 'whole' | 'cds')}>
                  <option value="whole">Whole sequence ({doc.sequence.length} nt)</option>
                  <option value="cds">CDS only ({targetCdsSlice.dna.length} nt)</option>
                </select>
              </label>
              <label className="form-field">
                Folding temperature
                <select value={foldTempC} onChange={(e) => setFoldTempC(Number(e.target.value))}>
                  {FOLD_TEMPERATURES_C.map((t) => (
                    <option key={t} value={t}>
                      {t} °C{t === 37 ? ' — body temperature' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Dangling ends
                <select
                  value={foldDangles ? 'd2' : 'd0'}
                  onChange={(e) => setFoldDangles(e.target.value === 'd2')}
                >
                  <option value="d2">On — stacking on every helix end (−d2)</option>
                  <option value="d0">Off — no dangling-end energies (−d0)</option>
                </select>
              </label>
              <label className="form-field">
                Topology
                <select
                  value={foldCircular ? 'circular' : 'linear'}
                  onChange={(e) => setFoldCircular(e.target.value === 'circular')}
                  disabled={foldRegion !== 'whole'}
                >
                  <option value="circular">Circular — the ends are joined</option>
                  <option value="linear">Linear — the ends are free</option>
                </select>
              </label>
            </div>
            </InspectorSection>
            {foldCircular && !secondaryStructReport.circular && !foldInput.truncated && (
              <p className="info-callout">
                Folded as a linear molecule: a CDS cut out of the sequence is a linear piece of it,
                not a circle.
              </p>
            )}

            {foldInput.truncated && (
              <p className="info-callout">
                The fold engine folds at most {FOLD_CAP_NT} nt, and this region is {foldInput.suppliedNt} nt.
                Everything below describes nucleotides 1..{FOLD_CAP_NT} of it, not the whole region
                {foldCircular ? ', folded as a linear molecule, since that stretch no longer closes on itself' : ''}.
              </p>
            )}

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Folded Length</span>
                <strong className="kpi-val">{secondaryStructReport.lengthNt} nt</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Minimum Free Energy</span>
                <strong className="kpi-val">
                  {secondaryStructReport.minimumFreeEnergyKcalMol} kcal/mol
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Base-Paired Nucleotides</span>
                <strong className="kpi-val">
                  {secondaryStructReport.pairedBasesCount} nt ({secondaryStructReport.pairedPct}%)
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Stem-Loop Hairpins</span>
                <strong className="kpi-val">{secondaryStructReport.stemLoops.length}</strong>
              </div>
              <div className="kpi-box" title="−RT ln Q summed over every structure the molecule can adopt; always at or below the MFE.">
                <span className="kpi-label">Ensemble Free Energy</span>
                <strong className="kpi-val">
                  {secondaryStructReport.ensembleFreeEnergyKcalMol} kcal/mol
                </strong>
              </div>
              <div className="kpi-box" title="The share of the Boltzmann ensemble that is this exact structure.">
                <span className="kpi-label">Frequency of MFE Structure</span>
                <strong className="kpi-val">
                  {formatEnsembleShare(secondaryStructReport.mfeFrequency)}
                </strong>
              </div>
              <div
                className="kpi-box"
                title={`Mean base-pair distance between two structures drawn from the ensemble, over ${secondaryStructReport.sampledStructures.toLocaleString()} draws.`}
              >
                <span className="kpi-label">Ensemble Diversity</span>
                <strong className="kpi-val">
                  {secondaryStructReport.ensembleDiversity.toFixed(1)} bp
                </strong>
              </div>
            </div>

            {/* Arc diagram of the fold as predicted: one semicircle per base pair of the
                dot-bracket string, arc height scaled to the real span of that pair. */}
            {foldArcs && (
              <div data-mbc-figure>
              <div className="studio-card-header" style={{ paddingTop: 0 }}>
                <h4>Base-Pair Arc Diagram</h4>
                <FigureExportButton
                  compact
                  baseName={`${doc.name} — Fold Arc Diagram`}
                  title={`${doc.name} — predicted ${foldAs} fold, ${foldArcs.arcs.length} base pairs`}
                  text={`${doc.name} — ${foldAs} minimum-free-energy fold\nRegion: ${foldInput.label}\nTemperature: ${secondaryStructReport.temperatureC} °C\nDangling ends: ${secondaryStructReport.danglingEnds ? 'on (-d2)' : 'off (-d0)'}\nTopology: ${secondaryStructReport.circular ? 'circular' : 'linear'}\nMFE: ${secondaryStructReport.minimumFreeEnergyKcalMol} kcal/mol\nEnsemble free energy: ${secondaryStructReport.ensembleFreeEnergyKcalMol} kcal/mol\nFrequency of the MFE structure: ${formatEnsembleShare(secondaryStructReport.mfeFrequency)}\nEnsemble diversity: ${secondaryStructReport.ensembleDiversity.toFixed(1)} bp over ${secondaryStructReport.sampledStructures} sampled structures\nLength: ${secondaryStructReport.lengthNt} nt\n\n${foldInput.seq}\n${secondaryStructReport.dotBracket}\n`}
                  table={{
                    headers: ['5′ position (nt)', '3′ position (nt)', 'Pair'],
                    rows: foldArcs.arcs.map((a) => [
                      String(a.i + foldInput.offset),
                      String(a.j + foldInput.offset),
                      `${foldInput.seq[a.i] ?? ''}-${foldInput.seq[a.j] ?? ''}`,
                    ]),
                    caption: `${doc.name} — ${foldArcs.arcs.length} predicted base pairs over ${secondaryStructReport.lengthNt} nt`,
                  }}
                />
              </div>
              <svg
                viewBox={`0 0 ${foldArcs.width} ${foldArcs.height}`}
                className="phylo-tree-svg"
                style={chartMaxWidth(foldArcs.width)}
                role="img"
                aria-label={`Arc diagram of ${foldArcs.arcs.length} predicted base pairs over ${secondaryStructReport.lengthNt} nucleotides`}
              >
                <rect x="0" y="0" width={foldArcs.width} height={foldArcs.height} rx="6" fill="var(--mbc-bg-panel)" stroke="var(--mbc-border)" />
                {foldArcs.arcs.map((a) => (
                  <path
                    key={`${a.i}-${a.j}`}
                    d={a.d}
                    fill="none"
                    stroke={activeHairpin && a.i + 1 >= activeHairpin.stemStart5 && a.j + 1 <= activeHairpin.stemEnd3 ? 'var(--mbc-amber)' : 'var(--mbc-blue)'}
                    strokeWidth={activeHairpin && a.i + 1 >= activeHairpin.stemStart5 && a.j + 1 <= activeHairpin.stemEnd3 ? 2 : 1.1}
                    strokeOpacity={0.85}
                  />
                ))}
                <line x1={foldArcs.x0} y1={foldArcs.baselineY} x2={foldArcs.x1} y2={foldArcs.baselineY} stroke="var(--mbc-text-main)" strokeWidth="2" />
                <text x={foldArcs.x0 - 4} y={foldArcs.baselineY + 4} textAnchor="end" fill="var(--mbc-blue)" fontSize="11" fontWeight="700">5&apos;</text>
                <text x={foldArcs.x1 + 4} y={foldArcs.baselineY + 4} fill="var(--mbc-red)" fontSize="11" fontWeight="700">3&apos;</text>
                <text x={foldArcs.width / 2} y={foldArcs.height - 6} textAnchor="middle" fill="var(--mbc-text-secondary)" fontSize="10.5">
                  {foldArcs.arcs.length} base pairs over {secondaryStructReport.lengthNt} nt
                  {foldInput.offset > 1 ? ` (document position ${foldInput.offset}..${foldInput.offset + secondaryStructReport.lengthNt - 1})` : ''}
                </text>
              </svg>
              </div>
            )}

            {/* The selected hairpin drawn to its predicted dimensions: one rung per base pair of
                its stem, and an apical loop circle sized to its real nucleotide count. */}
            {activeHairpin && hairpinGeometry && (
              <div data-mbc-figure>
                <div className="studio-card-header" style={{ paddingTop: 0 }}>
                  <h4>Hairpin {activeHairpin.id.toUpperCase()}</h4>
                  <FigureExportButton
                    compact
                    baseName={`${doc.name} — Hairpin ${activeHairpin.id.toUpperCase()}`}
                    title={`${doc.name} — hairpin ${activeHairpin.id.toUpperCase()}, ${activeHairpin.stemLengthBp} bp stem`}
                    table={{
                      headers: ['Stem pair', "5′ position (nt)", '5′ base', '3′ base', "3′ position (nt)", 'Pair type'],
                      rows: hairpinGeometry.rungs.map((r, i) => [
                        String(i + 1),
                        String(r.pos5),
                        r.base5,
                        r.base3,
                        String(r.pos3),
                        pairClass(r.base5, r.base3),
                      ]),
                      caption: `${doc.name} — hairpin ${activeHairpin.id.toUpperCase()}: nt ${activeHairpin.stemStart5}..${activeHairpin.stemEnd3}, ${activeHairpin.stemLengthBp} bp stem, ${activeHairpin.loopLengthNt} nt loop, dG ${activeHairpin.deltaGKcalMol} kcal/mol`,
                    }}
                  />
                </div>
                {secondaryStructReport.stemLoops.length > 1 && (
                  <label className="form-field" style={{ marginTop: 8 }}>
                    Hairpin shown below
                    <select
                      value={activeHairpin.id}
                      onChange={(e) => setSelectedHairpinId(e.target.value)}
                    >
                      {secondaryStructReport.stemLoops.map((sl) => (
                        <option key={sl.id} value={sl.id}>
                          {sl.id.toUpperCase()} — nt {sl.stemStart5}..{sl.stemEnd3}, {sl.stemLengthBp} bp stem,{' '}
                          {sl.loopLengthNt} nt loop, ΔG {sl.deltaGKcalMol} kcal/mol
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <svg
                  viewBox={`0 0 ${hairpinGeometry.width} ${hairpinGeometry.height}`}
                  className="phylo-tree-svg"
                  /* drawn at a real nucleotide pitch, so it renders 1:1 rather than being
                     stretched across the card */
                  style={chartMaxWidth(hairpinGeometry.width)}
                  role="img"
                  aria-label={`${activeHairpin.stemLengthBp} base-pair stem closing a ${activeHairpin.loopLengthNt} nucleotide apical loop`}
                >
                  {/* backbone: up the 5' strand, around the loop, back down the 3' strand */}
                  <polyline
                    points={[
                      `${hairpinGeometry.foot5X},${hairpinGeometry.footY}`,
                      ...hairpinGeometry.rungs.map((r) => `${r.x5},${r.y}`),
                      ...hairpinGeometry.loopBases.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)}`),
                      ...[...hairpinGeometry.rungs].reverse().map((r) => `${r.x3},${r.y}`),
                      `${hairpinGeometry.foot3X},${hairpinGeometry.footY}`,
                    ].join(' ')}
                    fill="none"
                    stroke="var(--mbc-text-muted)"
                    strokeWidth="1.6"
                  />
                  {hairpinGeometry.rungs.map((r) => {
                    const cls = pairClass(r.base5, r.base3);
                    const stroke = cls === 'GC' ? 'var(--mbc-green)' : cls === 'AU' ? 'var(--mbc-blue)' : 'var(--mbc-amber)';
                    return (
                      <g key={`${r.pos5}-${r.pos3}`}>
                        <line
                          x1={r.x5 + 6}
                          y1={r.y}
                          x2={r.x3 - 6}
                          y2={r.y}
                          stroke={stroke}
                          strokeWidth={cls === 'GU' ? 1.2 : 2}
                          strokeDasharray={cls === 'GU' ? '2 2' : undefined}
                        />
                        <text x={r.x5} y={r.y + 3.6} textAnchor="middle" fill="var(--mbc-text-main)" fontSize="10" fontWeight="700" fontFamily="var(--font-mono)">
                          {r.base5}
                        </text>
                        <text x={r.x3} y={r.y + 3.6} textAnchor="middle" fill="var(--mbc-text-main)" fontSize="10" fontWeight="700" fontFamily="var(--font-mono)">
                          {r.base3}
                        </text>
                      </g>
                    );
                  })}
                  {hairpinGeometry.loopBases.map((b) => (
                    <text
                      key={b.pos}
                      x={b.x.toFixed(2)}
                      y={(b.y + 3.6).toFixed(2)}
                      textAnchor="middle"
                      fill="var(--mbc-text-main)"
                      fontSize="10"
                      fontWeight="700"
                      fontFamily="var(--font-mono)"
                    >
                      {b.base}
                    </text>
                  ))}
                  <text x={hairpinGeometry.foot5X - 10} y={hairpinGeometry.footY} textAnchor="end" fill="var(--mbc-blue)" fontSize="10" fontWeight="700">
                    {activeHairpin.stemStart5}
                  </text>
                  <text x={hairpinGeometry.foot3X + 10} y={hairpinGeometry.footY} fill="var(--mbc-red)" fontSize="10" fontWeight="700">
                    {activeHairpin.stemEnd3}
                  </text>
                </svg>
                <p className="info-callout">
                  {activeHairpin.id.toUpperCase()}: a {activeHairpin.stemLengthBp} bp stem closing a{' '}
                  {activeHairpin.loopLengthNt} nt apical loop at nt {activeHairpin.stemStart5}..
                  {activeHairpin.stemEnd3}, ΔG {activeHairpin.deltaGKcalMol} kcal/mol. Green rungs are G:C,
                  blue are {foldAs === 'DNA' ? 'A:T' : 'A:U'}, dashed amber are G:{foldAs === 'DNA' ? 'T' : 'U'} wobble.
                </p>
              </div>
            )}

            <div className="newick-box">
              <span>Vienna Dot-Bracket Secondary Structure Notation (1..{secondaryStructReport.lengthNt} nt):</span>
              <code>{secondaryStructReport.dotBracket}</code>
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Predicted Stem-Loop Hairpin Structures</h3>
              <span className="badge-accent">{secondaryStructReport.stemLoops.length} Hairpins</span>
            </div>
            <WorkbenchSmartTable
              tableId="hybrid-rna-stem-loop-hairpins"
              tableLabel="Predicted Stem-Loop Hairpin Structures"
              regionMaxHeight={350}
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Hairpin</th>
                  <th>Coordinates</th>
                  <th>5&apos; Stem</th>
                  <th>Apical Loop</th>
                  <th>3&apos; Stem</th>
                  <th>ΔG (kcal/mol)</th>
                </tr>
              </thead>
              <tbody>
                {secondaryStructReport.stemLoops.map((sl) => (
                  <tr
                    key={sl.id}
                    onClick={() => setSelectedHairpinId(sl.id)}
                    aria-selected={sl.id === activeHairpin?.id}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <strong>{sl.id.toUpperCase()}</strong>
                    </td>
                    <td>
                      {sl.stemStart5}..{sl.stemEnd3}
                    </td>
                    <td>
                      <code>5&apos;-{sl.topStemSeq}-3&apos;</code>
                    </td>
                    <td>
                      <code>{sl.loopSeq}</code>
                    </td>
                    <td>
                      <code>5&apos;-{sl.bottomStemSeq}-3&apos;</code>
                    </td>
                    <td>
                      <strong>{sl.deltaGKcalMol}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {subTab === 'enzymes-view' && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3>Enzymes View — Restriction Sets &amp; Overhang Cleavage Diagrams (⌘3)</h3>
                <div className="cloning-method-tabs" style={{ marginBottom: 0 }}>
                  {(['Enzymes', 'Lineage', 'Info'] as const).map((tabName) => (
                    <button
                      key={tabName}
                      type="button"
                      className={`method-tab-btn ${enzymeSetSubView === tabName ? 'active' : ''}`}
                      onClick={() => {
                        if (tabName === 'Lineage') {
                          setSubTab('lineage');
                        } else {
                          setEnzymeSetSubView(tabName);
                        }
                      }}
                    >
                      {tabName}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cloning-method-tabs" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  className={`method-tab-btn ${enzymesDisplayTab === 'numbers' ? 'active' : ''}`}
                  onClick={() => setEnzymesDisplayTab('numbers')}
                >
                  123 Numbers
                </button>
                <button
                  type="button"
                  className={`method-tab-btn ${enzymesDisplayTab === 'lines' ? 'active' : ''}`}
                  onClick={() => setEnzymesDisplayTab('lines')}
                >
                  |||| Lines
                </button>
              </div>
            </div>

            {/* Enzyme Set Action Toolbar (matching Image 3) */}
            <div
              className="enzyme-set-action-bar"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
                padding: '6px 8px',
                marginBottom: 8,
                borderRadius: 6,
                background: 'var(--mbc-bg-panel)',
                border: '1px solid var(--mbc-border)',
              }}
            >
              <select
                aria-label="Choose enzyme to add"
                value={enzymePickerValue}
                onChange={(e) => setEnzymePickerValue(e.target.value)}
                style={{ height: 24, fontSize: 12, padding: '0 6px', borderRadius: 4 }}
              >
                {REBASE_ENZYMES.map((enz) => (
                  <option key={enz.name} value={enz.name}>
                    {enz.name} ({enz.recognitionSeq})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary-sm"
                onClick={() => handleAddEnzymeToSet(enzymePickerValue)}
              >
                + Add Enzymes
              </button>
              <button
                type="button"
                className="btn-secondary-sm"
                disabled={selectedEnzymeRowNames.length === 0}
                onClick={handleRemoveSelectedEnzymesFromSet}
              >
                &minus; Remove Selected Enzymes
              </button>
              <button
                type="button"
                className="btn-secondary-sm"
                onClick={handleCombineEnzymeSets}
              >
                Combine Sets
              </button>
              <button
                type="button"
                className="btn-secondary-sm"
                disabled={selectedEnzymeRowNames.length === 0}
                onClick={handleExtractSelectedEnzymes}
              >
                Extract Selected Enzymes
              </button>
              <button
                type="button"
                className="btn-secondary-sm"
                onClick={handleExportEnzymeTableCsv}
              >
                Export table
              </button>
              <button
                type="button"
                className="btn-primary-sm"
                onClick={() =>
                  persistEnzymeSetToDocument(
                    enzymeSetFilter === 'custom_set'
                      ? customEnzymeSetNames
                      : filteredEnzymeSummary.map((r) => r.enzyme.name),
                    `Saved Enzyme Set "${doc.name}" (${filteredEnzymeSummary.length} enzymes)`
                  )
                }
              >
                Save
              </button>
              {enzymeSetStatusMsg && (
                <span style={{ fontSize: 11.5, color: 'var(--mbc-blue)', marginLeft: 'auto' }}>
                  {enzymeSetStatusMsg}
                </span>
              )}
            </div>

            <div className="cloning-method-tabs">
              {(
                [
                  ['custom_set', `Custom Enzyme Set (${customEnzymeSetNames.length})`],
                  ['unique', restrictionWords ? `Cutting once ${restrictionWords.once}` : 'Unique Cutters (1)'],
                  ['unique_dual', 'Unique & Dual (1–2)'],
                  ['six_plus', '6+ Cutters'],
                  ['type2s', 'Type IIS Enzymes'],
                  ['all', 'All REBASE Commercial'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`method-tab-btn ${enzymeSetFilter === id ? 'active' : ''}`}
                  onClick={() => setEnzymeSetFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {restrictionWords && <p className="mbc-summary-note">{restrictionWords.detail}</p>}
            <ResultWarnings warnings={restrictionScan.warnings} label="Restriction scan warnings" />

            {enzymeSetSubView === 'Info' ? (
              <div className="info-callout" style={{ marginTop: 8 }}>
                <strong>{doc.name}</strong> — Enzyme Set containing{' '}
                <strong>{filteredEnzymeSummary.length}</strong> restriction endonuclease(s). Use{' '}
                <strong>+ Add Enzymes</strong> or <strong>Combine Sets</strong> to curate custom
                restriction screening panels across constructs.
              </div>
            ) : enzymesDisplayTab === 'lines' ? (
              <div data-mbc-figure>
              <div className="studio-card-header" style={{ paddingTop: 0 }}>
                <h4>Restriction Cut-Site Map</h4>
                <FigureExportButton
                  compact
                  baseName={`${doc.name} — Cut-Site Map`}
                  title={`${doc.name} — restriction cut-site map`}
                  table={{
                    headers: ['Enzyme', 'Recognition site', 'Cuts', 'Positions (bp)'],
                    rows: filteredEnzymeSummary.map((row) => [
                      row.enzyme.name,
                      row.enzyme.recognitionSeq,
                      row.count === null ? NOT_SCANNED : String(row.count),
                      row.cuts
                        .map((c) =>
                          String(
                            cutSiteDisplayPosition(
                              c.cutTop,
                              doc.sequence.length,
                              doc.topology === 'circular'
                            )
                          )
                        )
                        .join(' '),
                    ]),
                    caption: `${doc.name} — ${filteredEnzymeSummary.length} enzymes across ${doc.sequence.length} bp`,
                  }}
                />
              </div>
              <svg
                viewBox={`0 0 ${CHART_FULL.w} 246`}
                className="phylo-tree-svg"
                style={chartMaxWidth(CHART_FULL.w)}
                role="img"
                aria-label={`Cut-site map of ${Math.min(filteredEnzymeSummary.length, 8)} enzymes across ${doc.sequence.length} bp`}
              >
                <rect x="0" y="0" width={CHART_FULL.w} height="246" rx="6" fill="var(--mbc-bg-panel)" stroke="var(--mbc-border)" />
                {filteredEnzymeSummary.slice(0, 8).map((row, idx) => {
                  const y = 28 + idx * 26;
                  const trackX = 150;
                  const trackW = CHART_FULL.w - trackX - 24;
                  return (
                    <g key={row.enzyme.name}>
                      <text x="16" y={y + 4} fill="var(--mbc-text-main)" fontSize="11.5" fontWeight="700">
                        {row.enzyme.name} ({row.count === null ? NOT_SCANNED : row.count})
                      </text>
                      <line x1={trackX} y1={y} x2={trackX + trackW} y2={y} stroke="var(--mbc-border-strong)" strokeWidth="2" />
                      {row.cuts.map((c) => {
                        const x = trackX + (c.position / Math.max(1, doc.sequence.length)) * trackW;
                        return (
                          <g key={c.id}>
                            <line
                              x1={x}
                              y1={y - 7}
                              x2={x}
                              y2={y + 7}
                              stroke={c.overhangType === 'blunt' ? 'var(--mbc-green)' : 'var(--mbc-blue)'}
                              strokeWidth="2.2"
                            />
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </svg>
              </div>
            ) : (
              <>
                <WorkbenchSmartTable
                  tableId="hybrid-restriction-enzymes-view"
                  tableLabel="Restriction Enzymes Cleavage Sites Table"
                  regionMaxHeight={330}
                  className="bio-table"
                >
                  <thead>
                    <tr>
                      <th>Name ▲</th>
                      <th>Recognition Sequence</th>
                      <th>Effective Length (nt)</th>
                      <th>Overhang</th>
                      <th>Methylation</th>
                      <th># Cuts</th>
                      <th>Positions (bp)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEnzymeSummary.map(({ enzyme, count, cuts }) => {
                      const topCut =
                        enzyme.recognitionSeq.slice(0, enzyme.cutFwd) +
                        '▼' +
                        enzyme.recognitionSeq.slice(enzyme.cutFwd);
                      const botSeq = complement(enzyme.recognitionSeq);
                      const botCut =
                        botSeq.slice(0, enzyme.cutRev) + '▲' + botSeq.slice(enzyme.cutRev);
                      const isRowSelected = selectedEnzymeRowNames.includes(enzyme.name);
                      return (
                        <tr
                          key={enzyme.name}
                          onClick={() =>
                            setSelectedEnzymeRowNames((prev) =>
                              prev.includes(enzyme.name)
                                ? prev.filter((n) => n !== enzyme.name)
                                : [...prev, enzyme.name]
                            )
                          }
                          style={{
                            cursor: 'pointer',
                            background: isRowSelected ? 'rgba(59, 130, 246, 0.14)' : undefined,
                          }}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={isRowSelected}
                              onChange={() => {}}
                              style={{ marginRight: 6 }}
                              aria-label={`Select ${enzyme.name}`}
                            />
                            <strong
                              style={{
                                fontWeight: count === 1 ? 800 : 600,
                                color:
                                  enzyme.cutFwd === enzyme.cutRev ? '#15803d' : undefined,
                              }}
                            >
                              {enzyme.name}
                            </strong>
                          </td>
                          <td>
                            <code>5&apos;-{topCut}-3&apos;</code>
                            <br />
                            <code style={{ color: '#64748b' }}>3&apos;-{botCut}-5&apos;</code>
                          </td>
                          <td>{enzLength(enzyme.recognitionSeq)}</td>
                          <td>
                            {enzyme.cutFwd === enzyme.cutRev
                              ? 'Blunt'
                              : enzyme.cutFwd < enzyme.cutRev
                              ? "5' Overhang"
                              : "3' Overhang"}
                          </td>
                          <td>
                            {enzyme.methylationSensitivity &&
                            enzyme.methylationSensitivity.length > 0
                              ? enzyme.methylationSensitivity.join(', ')
                              : 'None'}
                          </td>
                          <td>
                            <strong>{count === null ? NOT_SCANNED : count}</strong>
                          </td>
                          <td>
                            {count === null
                              ? 'Not scanned: only the core enzymes are scanned on this sequence'
                              : cuts.length > 0
                              ? cuts
                                  .map((c) => cutSiteDisplayPosition(c.cutTop, doc.sequence.length, doc.topology === 'circular'))
                                  .join(', ') + (cuts.length < count ? ` (the first ${cuts.length.toLocaleString()} of ${count.toLocaleString()} sites)` : '')
                              : 'None (Noncutter)'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </WorkbenchSmartTable>
                <div
                  className="enzyme-set-statusbar"
                  style={{
                    marginTop: 6,
                    fontSize: 11.5,
                    color: 'var(--mbc-text-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>
                    {selectedEnzymeRowNames.length} of {filteredEnzymeSummary.length} enzymes
                    selected
                  </span>
                  <span>
                    Active Document: {doc.name} ({doc.sequence.length.toLocaleString()} bp)
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Commercial Enzyme Suppliers (22 Catalogs)</h3>
              <span className="badge-accent">Nonredundant Commercial (303)</span>
            </div>
            <div className="info-callout">
              Unique cutters are shown in <strong>bold</strong> and blunt cutters in{' '}
              <strong style={{ color: '#15803d' }}>green</strong>. Commercial supplier preference order:
            </div>
            <div className="plugin-list-box" style={{ maxHeight: 300 }}>
              {COMMERCIAL_SUPPLIERS.map((sup, idx) => (
                <div key={sup} className="plugin-row-item">
                  <span>
                    <strong>#{idx + 1}</strong> {sup}
                  </span>
                  <span className="plugin-ver-badge">Active Catalog</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {subTab === 'lineage' && lineageDagReport && (
        <div className="studio-split-grid">
          {inWorkbench && (
            <InspectorSection title="Lineage" order={1}>
              {historyColorsToggle}
              {strainField}
            </InspectorSection>
          )}
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Construct History Tree &amp; History Colors (⌘8)</h3>
              {!inWorkbench && historyColorsToggle}
            </div>

            {/* Interactive petgraph Multi-Document Construct Lineage Provenance DAG */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                fontSize: 11.5,
                marginBottom: 6,
                color: 'var(--mbc-text-secondary)',
              }}
            >
              <span>
                <strong>Lineage:</strong>{' '}
                {lineageDagReport.isAcyclic ? 'Topological DAG Verified' : 'Cyclic Graph'} •{' '}
                {lineageDagReport.nodes.length} nodes across {lineageDagReport.layerCount} layer(s)
              </span>
              <span>
                <strong>Linked Workspace Constructs:</strong> {lineageDagReport.ancestorDocumentCount} ancestor(s),{' '}
                {lineageDagReport.descendantDocumentCount} descendant(s)
              </span>
              <FigureExportButton
                compact
                baseName={`${doc.name} — Provenance DAG`}
                title={`${doc.name} — provenance DAG, ${lineageDagReport.nodes.length} nodes`}
                targetRef={lineageDagRef}
                table={{
                  headers: ['Node', 'Title', 'Subtitle', 'Timestamp', 'Layer'],
                  rows: lineageDagReport.nodes.map((n) => [
                    n.nodeId,
                    n.title,
                    n.subtitle,
                    n.timestamp ?? '',
                    String(n.layer ?? ''),
                  ]),
                  caption: `${doc.name} — provenance DAG: ${lineageDagReport.nodes.length} nodes across ${lineageDagReport.layerCount} layer(s)`,
                }}
              />
            </div>
            <div className="mbc-studio-isolated-region mbc-lineage-dag-canvas" ref={lineageDagRef}>
              {/* Rust layout: node.x is the LEFT edge of a 186px-wide box, node.y its vertical centre.
                  Render at natural size (scale down only) so a single node isn't blown up to full width. */}
              <svg
                viewBox={`0 0 ${lineageDagReport.width} ${lineageDagReport.height}`}
                width={lineageDagReport.width}
                role="img"
                aria-label="Construct history provenance graph"
              >
                <rect
                  x="0"
                  y="0"
                  width={lineageDagReport.width}
                  height={lineageDagReport.height}
                  rx="6"
                  fill="var(--mbc-bg-panel)"
                  stroke="var(--mbc-border)"
                />
                {lineageDagReport.edges.map((edge) => (
                  <path
                    key={edge.id}
                    d={edge.svgPath}
                    fill="none"
                    stroke={historyColorsEnabled ? 'var(--mbc-blue)' : 'var(--mbc-text-muted)'}
                    strokeWidth="2.1"
                  />
                ))}
                {lineageDagReport.nodes.map((node) => {
                  const strokeCol = historyColorsEnabled ? node.color : 'var(--mbc-green)';
                  const NODE_W = 186;
                  const NODE_H = 62;
                  const cx = node.x + NODE_W / 2;
                  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
                  return (
                    <g key={node.nodeId}>
                      <title>{`${node.title}\n${node.subtitle}${node.timestamp ? `\n${node.timestamp}` : ''}`}</title>
                      <rect
                        x={node.x}
                        y={node.y - NODE_H / 2}
                        width={NODE_W}
                        height={NODE_H}
                        rx={8}
                        fill="var(--mbc-bg-canvas)"
                        stroke={strokeCol}
                        strokeWidth={node.isActiveTarget ? '2.2' : '1.4'}
                      />
                      <rect
                        x={node.x}
                        y={node.y - NODE_H / 2}
                        width={4}
                        height={NODE_H}
                        rx={2}
                        fill={strokeCol}
                      />
                      <text
                        x={cx}
                        y={node.y - 10}
                        textAnchor="middle"
                        fill={strokeCol}
                        fontSize="11.5"
                        fontWeight="700"
                      >
                        {clip(node.title, 26)}
                      </text>
                      <text
                        x={cx}
                        y={node.y + 6}
                        textAnchor="middle"
                        fill="var(--mbc-text-main)"
                        fontSize="10.5"
                        fontWeight="600"
                      >
                        {clip(node.subtitle, 28)}
                      </text>
                      <text
                        x={cx}
                        y={node.y + 21}
                        textAnchor="middle"
                        fill="var(--mbc-text-secondary)"
                        fontSize="10"
                      >
                        {node.timestamp ? node.timestamp.slice(0, 16) : clip(node.operation, 28)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {lineageLinkedDocuments.length > 0 && (
              <ul className="mbc-lineage-links" aria-label="Linked documents">
                {lineageLinkedDocuments.map((linked) => (
                  <li key={linked.id} className="mbc-lineage-link">
                    <span className="mbc-lineage-link-relation">{linked.relation}</span>
                    <span className="mbc-lineage-link-name" title={linked.name}>{linked.name}</span>
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      aria-label={`Go to ${linked.name}`}
                      disabled={!onSelectDocument}
                      onClick={() => onSelectDocument?.(linked.id)}
                    >
                      <ArrowRight size={13} aria-hidden="true" />
                      <span>Go to</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="history-tree-timeline">
              {doc.history.map((h, idx) => (
                <div key={h.id} className="history-node">
                  <div className="history-dot" />
                  <div className="history-content">
                    <div className="history-top-line">
                      <strong style={{ color: '#15803d' }}>
                        Step {idx + 1}: {h.operation}
                      </strong>
                      <span className="history-time">{h.timestamp}</span>
                    </div>
                    <p>{h.description}</p>
                    <span className="history-meta-pill">
                      {h.lengthBp.toLocaleString()} bp • {h.topology}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Document Info Panel, Enhanced Alerts &amp; Auto-Annotation</h3>
              <span className="badge-accent">{doc.accession}</span>
            </div>

            <div className="form-grid-2col">
              {!inWorkbench && strainField}
              <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                {onUpdateDocument && autoDetectedFeatures.length > 0 && (
                  <button
                    className="btn-success"
                    onClick={handleAutoAnnotateCommonFeatures}
                  >
                    + Auto-Detect {autoDetectedFeatures.length} Common Features
                  </button>
                )}
              </div>
            </div>

            {/* Enhanced Sequence Alerts Card */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sequenceAlerts.map((al) => (
                <div
                  key={al.id}
                  className="info-callout"
                  style={{
                    background:
                      al.severity === 'critical'
                        ? 'var(--mbc-red-soft)'
                        : al.severity === 'warning'
                        ? 'var(--mbc-amber-soft)'
                        : 'var(--mbc-green-soft)',
                    borderColor:
                      al.severity === 'critical'
                        ? 'var(--mbc-red-border)'
                        : al.severity === 'warning'
                        ? 'var(--mbc-amber-border)'
                        : 'var(--mbc-green-border)',
                    color: 'var(--mbc-text-main)',
                  }}
                >
                  <strong>
                    [{al.category}] {al.title}
                  </strong>
                  <div style={{ fontSize: 11, marginTop: 2 }}>{al.detail}</div>
                </div>
              ))}
            </div>
            <WorkbenchSmartTable
              tableId="hybrid-lineage-document-metadata"
              tableLabel="Document Lineage and Properties"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Document Name</th>
                  <td>
                    <strong>{doc.name}</strong>
                  </td>
                </tr>
                <tr>
                  <th>NCBI / Local Accession</th>
                  <td className="mono-cell">{doc.accession}</td>
                </tr>
                <tr>
                  <th>Molecule Type &amp; Topology</th>
                  <td>
                    {doc.moleculeType} ({doc.topology.toUpperCase()})
                  </td>
                </tr>
                <tr>
                  <th>Sequence Length</th>
                  <td>{doc.sequence.length.toLocaleString()} bp</td>
                </tr>
                <tr>
                  <th>Folder Location</th>
                  <td>Local Database / {doc.folder}</td>
                </tr>
                <tr>
                  <th>Created / Modified</th>
                  <td>
                    {doc.createdAt} / {doc.updatedAt}
                  </td>
                </tr>
                <tr>
                  <th>Annotations &amp; Primers</th>
                  <td>
                    {doc.features.length} Features, {doc.primers.length} Primers
                  </td>
                </tr>
                <tr>
                  <th>Description</th>
                  <td>{doc.description}</td>
                </tr>
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {subTab === 'workflows' && (
        <div className="studio-stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Workflow Automation &amp; Bioinformatics Plugin Runner</h3>
              <span className="badge-accent">{BUILTIN_JS_PLUGINS.length} Built-in Tools &amp; Macros</span>
            </div>

            <div className="form-grid-2col">
              <label className="form-field">
                <span>Select Built-in Bioinformatics Tool or Macro:</span>
                <select
                  aria-label="Select Built-in Bioinformatics Tool or Macro"
                  value={selectedPluginId}
                  onChange={(e) => handleSelectPlugin(e.target.value)}
                >
                  {BUILTIN_JS_PLUGINS.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.category}] {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="cloning-action-row" style={{ alignSelf: 'end', display: 'flex', gap: 8 }}>
                <button className="btn-primary" onClick={handleRunCustomScript}>
                  ▶ Run Tool on {doc.name}
                </button>
                {onUpdateDocument &&
                  pluginOutput?.predictedFeatures &&
                  pluginOutput.predictedFeatures.length > 0 && (
                    <button
                      type="button"
                      className="btn-success"
                      onClick={handleAnnotatePredictedPluginFeatures}
                    >
                      + Annotate {pluginOutput.predictedFeatures.length} Predicted Features
                    </button>
                  )}
              </div>
            </div>

            <textarea
              className="js-code-editor"
              rows={6}
              value={scriptCode}
              onChange={(e) => setScriptCode(e.target.value)}
            />

            {pluginOutput && (
              <div className="js-output-console">
                <div className="console-header">
                  <span>
                    Status: <strong>{pluginOutput.ok ? 'SUCCESS' : 'ERROR'}</strong> • Engine:{' '}
                    <strong>{pluginOutput.runtime}</strong>
                  </span>
                  <span>Execution Time: {pluginOutput.elapsedMs} ms</span>
                </div>
                <pre>{JSON.stringify(pluginOutput.output ?? pluginOutput.error, null, 2)}</pre>
              </div>
            )}
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>External Alignment, Assembly &amp; Phylogenetics CLI Tools (Runs If Installed)</h3>
              <span className="badge-subtle">{EXTERNAL_BIO_CLI_TOOLS.length} Open-Source CLI Tools</span>
            </div>
            <WorkbenchSmartTable
              tableId="hybrid-external-cli-tools-table"
              tableLabel="External Alignment, Assembly and Phylogenetics CLI Tools"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Category</th>
                  <th>Upstream License</th>
                  <th>Executables Checked</th>
                  <th>Purpose &amp; Citation</th>
                  <th>Install Command</th>
                </tr>
              </thead>
              <tbody>
                {EXTERNAL_BIO_CLI_TOOLS.map((tool) => (
                  <tr key={tool.id}>
                    <td>
                      <strong>{tool.name}</strong>
                    </td>
                    <td>{tool.category}</td>
                    <td>
                      <span className="badge-subtle">{tool.spdxLicense}</span>
                    </td>
                    <td className="mono-cell">{tool.binaryCandidates.join(', ')}</td>
                    <td>
                      {tool.purpose} <span style={{ opacity: 0.78 }}>({tool.citation})</span>
                    </td>
                    <td className="mono-cell">{tool.installHint}</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}
    </div>
  );
};
