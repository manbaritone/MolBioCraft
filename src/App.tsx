// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { ProjectFolderTree } from './components/ProjectFolderTree';
import { documentsInFolder, folderDescendants, toggleVisibleSelection, normalizeProjectExplorer, PROJECT_ROOT, type ExplorerFolder } from './core/projectExplorer';
import { DocumentInfoPanel, DocumentNotesEditor } from './components/DocumentInfoPanel';
import { EMPTY_WORKSPACE_DOCUMENT, removeUntouchedLegacyStarter } from './core/emptyWorkspace';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Moon,
  MoreVertical,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  RotateCcw,
  Rows2,
  Search,
  Settings2,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  AlignJustify,
  ArrowLeftRight,
  GitCompare,
  Network,
  Scissors,
  ScanSearch,
  Combine,
  Layers,
  AlignStartVertical,
  CopyCheck,
  TextCursorInput,
  Rows3,
  EyeOff,
  Equal,
  GitMerge,
  Crosshair,
  ScissorsLineDashed,
  ListPlus,
  BadgeCheck,
  Table2,
  Merge,
  Columns2,
  ClipboardCheck,
  Ruler,
  Shrink,
  Copy,
  Highlighter,
  Sigma,
  Users,
  Scale,
  Gauge,
  History as HistoryIcon,
  Timer,
  Clock3,
  Shuffle,
  BarChart3,
  GitBranch,
  Tags,
  Rotate3d,
  type LucideIcon,
} from 'lucide-react';
import {
  BioAddIcon,
  BioAlignAssembleIcon,
  BioBlastIcon,
  BioCloningIcon,
  BioExportIcon,
  BioImportIcon,
  BioPrimersIcon,
  BioSessionIcon,
  BioTreeIcon,
  BioVectorsIcon,
  BioWorkflowsIcon,
} from './components/ToolbarBioIcons';
import { SAMPLE_LIBRARY } from './data/sampleLibrary';
import { ContigSummaryView } from './components/ContigSummaryView';
import { declaredLengthOf, isContigSummaryRecord } from './core/contigSummary';
import { importNexusOrNewickDocument } from './core/treeDocuments';
import { AlignOperationDialog, BuildTreeOperationDialog, ConsensusTreeDialog } from './components/AnalysisOperationDialogs';
import { DesignPrimersOperationDialog, DigestOperationDialog, PairwiseOperationDialog } from './components/SequenceOperationDialogs';
import { CloningOperationDialog, DeNovoOperationDialog, FindOrfsOperationDialog, MapToReferenceDialog, ValidateCloneDialog } from './components/CloningAssemblyOperationDialogs';
import { BatchRenameDialog, FindDuplicatesDialog } from './components/DocumentManagementDialogs';
import { AddToAlignmentDialog, ConsensusDialog, MaskAlignmentDialog, TranslationAlignDialog } from './components/AlignmentToolDialogs';
import { ManageWorkflowsDialog, RunWorkflowDialog } from './components/WorkflowDialogs';
import { BackTranslateDialog, CompareAnnotationsDialog, MergePairsDialog, ReadQcDialog, TestSavedPrimersDialog, TrimEndsDialog } from './components/PrimerReadDialogs';
import { MetadataImportDialog } from './components/MetadataImportDialog';
import { ComputeDistancesDialog, CondenseTreeDialog, EvolutionAnalysisDialog, TimetreeDialog, ExamplesDialog, GeneDuplicationDialog, HighlightSitesDialog } from './components/EvolutionAnalysisDialogs';
import type { EvoAnalysis } from './core/evolutionAnalyses';
import { loadStoredBlastDbs, localBlastDbDocuments, storeBlastDbs } from './core/localBlastDb';
import { isSearchField, loadSavedSearches, SEARCH_FIELDS, searchFieldText, storeSavedSearches, upsertSavedSearch, type SavedSearch } from './core/savedSearches';
import { ExpressionDialog, ExpressionResultsView } from './components/ExpressionViews';
import { HelpPanel } from './components/HelpPanel';
import { FragmentTraceView, MicrosatelliteDialog } from './components/FragmentViews';
import { contigDocument, fragmentDocumentFromFsa, mapOptionsOf, runQueryCentricAlignment } from './core/operationRunners';
import { exportReadsToFastq, fastqToReadDocuments, samToContigs, vcfToFeatures } from './core/importFormats';
import { parseAlignedFasta, parseTextAlignment, splitFlatfileRecords, textAlignmentToDocument } from './core/alignmentFormats';
import { SplitDocumentPane } from './components/SplitDocumentPane';
import { StructureAlignmentDialog } from './components/StructureAlignmentDialog';
import { hasStructure } from './core/structureModels';
import { ExpressionLevelsDialog, StructuralVariantsDialog, MakeBlastDbDialog, CrisprEditingDialog, AnnotateByBlastDialog, AnnotateFromDocumentsDialog, DegeneratePrimersDialog, ImportPrimersDialog } from './components/SequenceAnalysisToolDialogs';
import type { OptionValues } from './core/optionProfiles';
import { allWorkflows } from './core/workflows';
import {
  formatShortcut,
  IS_MAC_PLATFORM,
  OPERATION_LABELS,
  OPERATION_SHORTCUTS_EVENT,
  operationForShortcut,
  readOperationShortcuts,
  shortcutFromEvent,
  type OperationId,
} from './core/operationShortcuts';

const OPERATION_TOOLBAR_ICONS: Record<OperationId, LucideIcon> = {
  'align-multiple': AlignJustify,
  'align-pairwise': GitCompare,
  'build-tree': Network,
  'digest-fragments': Scissors,
  'design-primers': ArrowLeftRight,
  'find-orfs': ScanSearch,
  'clone-insert': Combine,
  'de-novo-assemble': Layers,
  'map-to-reference': AlignStartVertical,
  'find-duplicates': CopyCheck,
  'batch-rename': TextCursorInput,
  'translation-align': Rows3,
  'mask-alignment': EyeOff,
  'generate-consensus': Equal,
  'consensus-tree': GitMerge,
  'test-saved-primers': Crosshair,
  'trim-ends': ScissorsLineDashed,
  'back-translate': Undo2,
  'add-to-alignment': ListPlus,
  'validate-clone': BadgeCheck,
  'import-metadata': Table2,
  'merge-pairs': Merge,
  'compare-annotations': Columns2,
  'read-qc': ClipboardCheck,
  'compute-distances': Ruler,
  'condense-tree': Shrink,
  'gene-duplications': Copy,
  'highlight-sites': Highlighter,
  'evo-models': Sigma,
  'evo-diversity': Users,
  'evo-selection': Scale,
  'evo-rates': Gauge,
  'evo-ancestors': HistoryIcon,
  'evo-clocks': Timer,
  timetree: Clock3,
  'degenerate-primers': Shuffle,
  'annotate-from-documents': Tags,
  'import-primers': FileSpreadsheet,
  'annotate-by-blast': ScanSearch,
  'crispr-editing': Scissors,
  expression: BarChart3,
  'make-blast-db': Database,
  'expression-levels': BarChart3,
  'structural-variants': GitBranch,
  microsatellites: Activity,
  'align-structures': Rotate3d,
};
import {
  exportLineEndingFor,
  loadUserPreferences,
  normalizeUserPreferences,
  resetUserPreferences,
  saveUserPreferences,
  USER_PREFERENCES_EVENT,
  type UserPreferences,
} from './core/userPreferences';
import { applyHistorySnapshot } from './core/undoSnapshots';
import { ImportedTreeViewer } from './components/ImportedTreeViewer';
import {
  preferredViewerTab,
  phylogenySourceDocuments,
  relevantViewerTabs,
  resolveViewerTab,
  VIEWER_TAB_LABELS,
  visibleDocumentTabs,
  hasBiologicalSequence,
  originalDocumentText,
  type ViewerTab,
} from './core/documentViews';
import { ConstructCockpitBar, basicTmHasNoAnswer } from './components/ConstructCockpitBar';
import {
  MENU_FUNCTION_INFO_EVENT,
  readStoredShowMenuFunctionInfo,
  writeStoredShowMenuFunctionInfo,
} from './data/menuFunctionDescriptions';
import {
  CloningMethodType,
  NucleotideColorScheme,
  NUCLEOTIDE_COLOR_SCHEMES,
  ProteinAnalysisReport,
  SequenceDocument,
} from './types/bio';
import {
  analyzeProteinSequence,
  analyzeSequenceComposition,
  COMMON_PLASMID_FEATURES,
  convertDnaRna,
  detectCommonFeatures,
  EMPTY_RESTRICTION_SCAN,
  findORFs,
  invertSequenceCoordinates,
  MSA_MAX_RESIDUES,
  restrictionSiteCountsByName,
  reverseComplement,
  scanRestrictionSites,
  SequenceComposition,
  setCircularOrigin,
  tmNoAnswerSentence,
} from './core/bioEngine';
import {
  exportToEMBL,
  exportToFasta,
  exportToGenBank,
  exportToGFF3,
  parseBED,
  parseDnaBinaryPacket,
  parseFasta,
  parseFastq,
  parseEMBL,
  parseGenBank,
  looksLikeEmblRecord,
  assessRawSequenceText,
  refusedFileTypeReason,
  unsupportedImportReason,
  bamToSam,
  parseGFF3,
} from './core/fileParsers';
import {
  applyPlatformColorScheme,
  detectHostOS,
  formatPlatformShortcut,
  isPlatformPrimaryModifier,
  Logger,
  normalizeLineEndings,
  readStoredThemePreference,
  resolveEffectiveDarkMode,
  subscribeSystemColorScheme,
  SupportedOS,
  ThemePreference,
  sanitizeExportFilename,
  validateCrossPlatformFilename,
} from './platform/osPlatform';
import {
  CircularPlasmidMap,
  clampSequenceZoom,
  primerTmText,
  type RestrictionScanScope,
  restrictionScanScope,
  restrictionScannedBp,
  restrictionScopeWords,
  SEQUENCE_ZOOM_DEFAULT,
  stepSequenceZoom,
} from './components/CircularPlasmidMap';
import { AppStartupSplash } from './components/AppStartupSplash';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InspectorSection, NO_INSPECTOR_CLAIMS, WorkbenchInspectorProvider, type InspectorClaims } from './components/WorkbenchInspector';
import { ResultWarnings } from './components/ResultWarnings';
import { MolBioCraftLogo } from './components/MolBioCraftLogo';
import {
  GenomeInspectorExtras,
  LinearSequenceView,
} from './components/LinearSequenceView';
import { ScrollableMenuStrip } from './components/ScrollableMenuStrip';
import type { CloningSubToolType } from './components/CloningAndGelStudio';
import type {
  AlignmentSubMode,
  AncestralInferenceMethod,
  ModelsSubViewId,
  MsaAlgorithmOption,
  PairwiseAlgorithmOption,
  PhyloModuleTab,
} from './components/AlignmentAndPhyloStudio';
import type { PhyloTreeAlgorithm } from './core/phyloEvoEngine';
import type { HybridSubTabId } from './components/HybridToolsAndHistoryStudio';
import {
  AboutMolBioCraftModal,
  BlastSearchModal,
  ConfirmQuitModal,
  NewSequenceModal,
  PreferencesModal,
  PreferencesTabId,
  StaticModalDialog,
} from './components/MenusPreferencesAndBlastModal';
import {
  buildNcbiReferencePresetDocumentRust,
  ensureResidentSequenceRust,
  extractRegionWithAnnotationsRust,
  generateLargeGenomeBenchmarkRust,
  generateLargeProteinBenchmarkRust,
  queryCuratedDatabaseRecordsRust,
  spliceModularPartIntoDocumentRust,
} from './lib/rustBioEngine';
import type { VectorStudioTab } from './components/VectorLibraryAndDesignStudio';
import type { GenomicsSuiteSubTab } from './components/GenomicsNgsAndPredictionStudio';
import {
  complementOnlySequence,
  parsePdbCaCoordinates,
  reverseOnlySequence,
} from './core/genomicsAndStructureSuite';
import { MODULAR_VECTOR_PARTS, ModularVectorPart } from './data/modularVectorParts';
import { VECTOR_CATALOG } from './data/vectorCatalog';
import {
  clearWorkbenchLocalAutosave,
  hasWorkbenchLocalAutosave,
  isMbcFileOrPayload,
  isMbcZipArchiveBytes,
  loadWorkbenchFromLocalAutosave,
  MBC_MIME_TYPE,
  MBC_ZIP_MIME_TYPE,
  MbcWorkbenchSnapshot,
  parseMbcFolderZip,
  parseMbcWorkbench,
  saveWorkbenchToLocalAutosave,
  serializeMbcFolderZip,
  serializeMbcWorkbench,
  workbenchAutosaveNeedsRecovery,
  writeWorkbenchAutosaveDirtyFlag,
} from './core/mbcSessionFormat';
import {
  buildNativeMenuState,
  buildCommandDocumentContext,
  checkMultiDocumentSelection,
  isTagOrProteaseFeature,
  commandAvailability,
  CommandContext,
  CommandId,
  type WorkbenchCommandId,
} from './core/commandAvailability';
import { assignUniqueDocumentIds } from './core/documentIds';
import { stampEngineTimestamps } from './core/engineTimestamps';
import {
  collectMenuShortcutBindings,
  findMenuShortcut,
  MenuShortcutBinding,
  shortcutLabelToAriaKeyshortcuts,
  ShortcutMenuNode,
} from './core/menuShortcuts';
import {
  decideSessionReplacement,
  isSessionContentDirty,
  SessionContentSnapshot,
} from './core/sessionGuard';
import {
  discoverRustRestApiEndpoint,
  isTauriDesktopRuntime,
  ackQuitRequestTauri,
  printWorkbenchView,
  syncNativeMenuStateTauri,
} from './lib/tauriIpc';
import {
  computeViewportClampedContextMenuPosition,
  computeViewportClampedMenuPosition,
  DropdownViewportPosition,
  isInteractiveWindowChromeTarget,
  isNativeMacMenuBarActive,
  shouldBlockReloadChord,
  NativeFileOpenMode,
  performNativeAppQuit,
  postMacosNativeOpen,
  postMacosNativeSave,
  postMacosNativeSaveBinary,
  readStoredConfirmBeforeQuit,
  requestDesktopWindowDrag,
  requestDesktopWindowToggleMaximize,
  subscribeNativeMacMenuEvents,
  subscribeTauriWindowFileDropEvents,
  syncNativeConfirmBeforeQuit,
  writeStoredConfirmBeforeQuit,
} from './platform/macosMenuBridge';
import { CascadingMenuPopup, MenuNode } from './components/CascadingMenu';
import {
  HomeTopDropdownId,
  ProjectFirstPageHome,
} from './components/ProjectFirstPageHome';
import {
  ActionVectorGroup,
  buildCloningActionVectorDocument,
  CLONING_ACTION_VECTOR_PRESETS,
} from './data/cloningActionVectors';
import {
  addAttBSitesToSequence,
  annotateGatewayAttSites,
  batchModifyAnnotationIntervals,
  batchSetCdsTranslationProperty,
  computeDocumentTableMetrics,
  concatenateSequenceDocuments,
  convertSelectionToOligoPrimer,
  DOC_TABLE_COLUMN_PRESETS,
  DocTableColumnPresetId,
  DynamicDocColumnDef,
  exportLineageBundleGenBank,
  extractAnnotatedFeaturesToDocuments,
  generateConsensusDocument,
  getDefaultVisibleColumnsForFolder,
  getDocumentColumnDisplayValue,
  getFolderAwareDocumentColumns,
  groupDocumentsByPrefix,
  inferDocumentIconKind,
  maskSequenceRegions,
  randomlySampleDocuments,
  recordCheckVerdict,
  sortColumnsAsciiAlphabetical,
  sortDocumentsByColumn,
} from './core/workbenchBatchOperations';
import {
  evaluateTableRowFilters,
  WorkbenchColumnsPopover,
  SequenceDocKindIcon,
  WorkbenchFilterPanel,
  WorkbenchSmartTable,
  WorkbenchTableControlsBar,
  loadPersistedTableColumnState,
  savePersistedTableColumnState,
  TableFilterRule,
} from './components/WorkbenchSmartTable';
import { DocumentRecordBar, DocumentTableToggle, RecordStatusIcon, nextDocTableCollapsed, type DocTableEvent } from './components/DocumentRecordBar';
import {
  MolBioAttributeCellValue,
  MolBioColumnHeaderIcon,
  MolBioFeatureTypeBadge,
  MolBioSidebarNodeIcon,
  MolBioSortChevron,
  MolBioStarIcon,
  MolBioStrandBadge,
  MolBioViewerTabIcon,
  resolveMenuItemIcon,
} from './components/MolBioIcons';
import type {
  LocalSequenceDbEntry,
  ReferenceDatabaseCategoryId,
} from './components/DatabaseExplorerModal';
import { cutSiteDisplayPosition } from './core/restrictionDisplay';
import { alignmentImageRefusal, alignmentImageRows, exportAlignmentImage, isAlignmentImageDocument } from './core/alignmentImage';
import type { FigureImageFormat } from './core/figureExport';

// On-demand lazy studio & database explorer chunks (keep startup bundle lean & responsive)
const WorkflowPipelineStudio = React.lazy(() =>
  import('./components/WorkflowPipelineStudio').then((m) => ({
    default: m.WorkflowPipelineStudio,
  }))
);
const CloningAndGelStudio = React.lazy(() =>
  import('./components/CloningAndGelStudio').then((m) => ({
    default: m.CloningAndGelStudio,
  }))
);
const PrimerAndPCRStudio = React.lazy(() =>
  import('./components/PrimerAndPCRStudio').then((m) => ({
    default: m.PrimerAndPCRStudio,
  }))
);
const SequenceAlignmentStudio = React.lazy(() =>
  import('./components/AlignmentAndPhyloStudio').then((m) => ({
    default: m.SequenceAlignmentStudio,
  }))
);
const PhylogeneticsStudio = React.lazy(() =>
  import('./components/AlignmentAndPhyloStudio').then((m) => ({
    default: m.PhylogeneticsStudio,
  }))
);
const AlignmentTextStream = React.lazy(() =>
  import('./components/AlignmentAndPhyloStudio').then((m) => ({
    default: m.AlignmentTextStream,
  }))
);
const ChromatogramAndContigStudio = React.lazy(() =>
  import('./components/ChromatogramAndContigStudio').then((m) => ({
    default: m.ChromatogramAndContigStudio,
  }))
);
const HybridToolsAndHistoryStudio = React.lazy(() =>
  import('./components/HybridToolsAndHistoryStudio').then((m) => ({
    default: m.HybridToolsAndHistoryStudio,
  }))
);
const VectorLibraryAndDesignStudio = React.lazy(() =>
  import('./components/VectorLibraryAndDesignStudio').then((m) => ({
    default: m.VectorLibraryAndDesignStudio,
  }))
);
const GenomicsNgsAndPredictionStudio = React.lazy(() =>
  import('./components/GenomicsNgsAndPredictionStudio').then((m) => ({
    default: m.GenomicsNgsAndPredictionStudio,
  }))
);
const DatabaseExplorerModal = React.lazy(() =>
  import('./components/DatabaseExplorerModal').then((m) => ({
    default: m.DatabaseExplorerModal,
  }))
);

type NewSessionPreset =
  | 'blank'
  | 'new-sequence'
  | 'vector-catalog'
  | 'vector-architect'
  | 'twist-onboarding'
  | 'text-doc'
  | 'cloning-restriction'
  | 'cloning-assembly'
  | 'primers-crispr'
  | 'enzyme-set'
  | 'align-task'
  | 'phylo-task'
  | 'sanger-task'
  | 'ngs-genomics'
  | 'pipeline-task'
  | 'import-files'
  | 'import-clipboard'
  | 'new-folder'
  | 'sample-library';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const WORKSPACE_LAYOUT_STORAGE_KEY = 'molbiocraft.workspace.layout.v1';

interface PersistedWorkspaceLayout {
  sidebarWidthPx: number;
  inspectorWidthPx: number;
  docTableHeightPx: number;
  docTableWidthPx: number;
}

const DEFAULT_WORKSPACE_LAYOUT: PersistedWorkspaceLayout = {
  sidebarWidthPx: 245,
  inspectorWidthPx: 288,
  docTableHeightPx: 175,
  docTableWidthPx: 410,
};

/** Bounds for the inspector pane, shared by the resizer, the keyboard steps and persistence. */
const INSPECTOR_MIN_PX = 232;
const INSPECTOR_MAX_PX = 520;

function clampLayoutValue(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

/** Reads persisted pane geometry (clamped to the same bounds enforced by the resizers). */
function loadPersistedWorkspaceLayout(): PersistedWorkspaceLayout {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_WORKSPACE_LAYOUT;
    const raw = localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceLayout>;
    return {
      sidebarWidthPx: clampLayoutValue(parsed.sidebarWidthPx, 190, 420, 245),
      inspectorWidthPx: clampLayoutValue(
        parsed.inspectorWidthPx,
        INSPECTOR_MIN_PX,
        INSPECTOR_MAX_PX,
        DEFAULT_WORKSPACE_LAYOUT.inspectorWidthPx
      ),
      docTableHeightPx: clampLayoutValue(parsed.docTableHeightPx, 115, 460, 175),
      docTableWidthPx: clampLayoutValue(parsed.docTableWidthPx, 270, 680, 410),
    };
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT;
  }
}

function savePersistedWorkspaceLayout(layout: PersistedWorkspaceLayout): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage restrictions in sandboxed environments
  }
}

const MAX_UNDO_STEPS = 25;

interface DocumentUndoSnapshot {
  docId: string;
  prevDoc: SequenceDocument;
  nextDoc: SequenceDocument;
  label: string;
}

/**
 * Why the engine's basic Tm is no answer, or null where it has one (BG-01M6SHQ0): a span holding N or
 * any other base that is not A, C, G or T has none, by the cockpit's rule (basicTmHasNoAnswer), and
 * reads "n/a" with this shared sentence. It read 26 N and 14 A/C/G/T as 37.4 °C and 4,000 N and 1,000
 * A/C/G/T as 84.7 °C, by %GC over the A/C/G/T bases. Below 14 bases the Wallace rule holds, as before.
 * The status bar's selection Tm and Statistics' Melting temp read it.
 */
const basicTmNoAnswerReason = (c: SequenceComposition) => {
  const acgt = c.counts.A + c.counts.C + c.counts.G + c.counts.T;
  return basicTmHasNoAnswer(c.length, acgt) ? tmNoAnswerSentence(c.length - acgt) : null;
};

/** The status bar's selection Tm: "n/a", with the reason as its title, where it has no answer. */
const selectionTm = (c: SequenceComposition) => {
  const reason = basicTmNoAnswerReason(c);
  return reason === null ? `${c.meltingTempBasicC.toFixed(1)}°C` : <span title={reason}>n/a</span>;
};

/**
 * The status line's notice for a desktop Import Folder that left supported files out past its file
 * limit (BG-01M6S17Y): how many were not imported, of how many, and which were read.
 */
const folderImportLeftOutNotice = (filesLeftOut: number, filesRead: number) =>
  `${filesLeftOut.toLocaleString()} of the ${(filesRead + filesLeftOut).toLocaleString()} supported files in the folder ${
    filesLeftOut === 1 ? 'was' : 'were'
  } not imported: Import Folder reads the first ${filesRead.toLocaleString()}, by name.`;

/** The engine lists at most this many Dam and Dcm sites each (analyze_sequence_composition, iupac.rs). */
const METHYLATION_SITE_LIST_CAP = 4_096;
/** A Dam or Dcm count as Statistics gives it (BG-01M6RRSV): a full list is a floor, not the count. */
const methylationSiteCount = (listed: number) =>
  listed >= METHYLATION_SITE_LIST_CAP ? `at least ${listed.toLocaleString()}` : listed.toLocaleString();

/**
 * The water Biopython's `molecular_weight` takes off for each bond (BG-01M6RTP1). The engine weighs
 * the linear chain; a closed circle has one bond more per strand, so Statistics weighs a circular
 * molecule one water less per strand, as `molecular_weight(..., circular=True)` does.
 */
const BIOPYTHON_WATER_DA = 18.0153;

type WholeSequenceCount = { composition: SequenceComposition } | { error: string };
/**
 * The Statistics panel's whole-sequence pass (BG-01M6RTP1): a median 84 ms at 10,000,000 bp and
 * 0.7 to 1.1 s at 50,000,000 bp when measured, so it never runs in a render. A render asks for a
 * sequence's count with `request`, and gets it if that exact sequence was counted, or null while it
 * is counted in a task of its own, after the render that asked. `subscribe` and `version` are the
 * App's useSyncExternalStore pair: a count that lands bumps the version and tells the listeners, so
 * the App renders again and shows it. Each sequence is counted once (a failed pass too, kept with
 * its error), the last four kept. A request for another sequence replaces one whose task has not
 * run yet, so of the sequences asked for within one task only the last is counted; edits made one
 * at a time are each counted, one pass per edit in a task of its own, which still holds the main
 * thread (about a second at 50,000,000 bp).
 */
const wholeSequenceCounts = (() => {
  const KEPT = 4;
  let counted: { sequence: string; count: WholeSequenceCount }[] = [];
  let pending: { sequence: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
    request(sequence: string): WholeSequenceCount | null {
      const hit = counted.find((c) => c.sequence === sequence);
      if (hit) return hit.count;
      if (pending?.sequence !== sequence) {
        if (pending) clearTimeout(pending.timer);
        const timer = setTimeout(() => {
          pending = null;
          let count: WholeSequenceCount;
          try {
            count = { composition: analyzeSequenceComposition(sequence) };
          } catch (e) {
            count = { error: e instanceof Error ? e.message : String(e) };
          }
          counted = [{ sequence, count }, ...counted].slice(0, KEPT);
          version++;
          listeners.forEach((l) => l());
        }, 0);
        pending = { sequence, timer };
      }
      return null;
    },
  };
})();

const EMPTY_PROTEIN_STATS: ProteinAnalysisReport = {
  lengthAa: 0,
  molecularWeightDa: 0,
  molecularWeightKda: 0,
  isoelectricPointPi: 7.0,
  chargeAtPh7: 0,
  extinctionCoeff280Reduced: 0,
  extinctionCoeff280Cystine: 0,
  a280Of1mgPerMl: 0,
  gravyHydropathy: 0,
  aliphaticIndex: 0,
  aminoAcidCounts: {},
  hydrophobicityProfile: [],
  antigenicDeterminants: [],
  secondaryStructureSummary: {
    helixPercent: 0,
    sheetPercent: 0,
    coilPercent: 100,
    statesPerResidue: [],
  },
};

type TopMenuId =
  | 'app'
  | 'file'
  | 'edit'
  | 'view'
  | 'sequence'
  | 'cloning'
  | 'tools'
  | 'help'
  | null;

type ToolbarDropdownId =
  | 'add'
  | 'import'
  | 'export'
  | 'session'
  | 'workflows'
  | 'align'
  | 'tree'
  | 'primers'
  | 'cloning'
  | 'tab-plus'
  | 'tab-more'
  | null;

interface ProjectSubfolderNode {
  label: string;
  matchFolders: string[];
  children?: { label: string; folderKey: string; matchFolders: string[] }[];
}

const PROJECT_SUBFOLDERS: ProjectSubfolderNode[] = [
  { label: 'Alignments', matchFolders: ['Alignments'] },
  { label: 'Cloning', matchFolders: ['Cloning', 'Cloning Inserts & PCR'] },
  {
    label: 'Contig Assembly',
    matchFolders: ['Contig Assembly'],
  },
  {
    label: 'Genomes',
    matchFolders: [
      'Genomes',
      'Genomes & NGS',
      'Genomes/Bacteria',
      'Genomes/Eukaryotes',
      'Genomes/Human',
      'Genomes/Plants',
      'Genomes/Viruses',
    ],
    children: [
      { label: 'Bacteria', folderKey: 'Genomes/Bacteria', matchFolders: ['Genomes/Bacteria'] },
      { label: 'Eukaryotes', folderKey: 'Genomes/Eukaryotes', matchFolders: ['Genomes/Eukaryotes'] },
      { label: 'Human', folderKey: 'Genomes/Human', matchFolders: ['Genomes/Human'] },
      { label: 'Plants', folderKey: 'Genomes/Plants', matchFolders: ['Genomes/Plants'] },
      { label: 'Viruses', folderKey: 'Genomes/Viruses', matchFolders: ['Genomes/Viruses'] },
    ],
  },
  { label: 'Plasmids & Vectors', matchFolders: ['Plasmids & Vectors'] },
  { label: 'Primers', matchFolders: ['Primers', 'Primers & Guides'] },
  { label: 'Protein Documents', matchFolders: ['Protein Documents'] },
  { label: 'Tree Documents', matchFolders: ['Tree Documents'] },
];

function findSubfolderMatchFolders(folderName: string): string[] | null {
  for (const sf of PROJECT_SUBFOLDERS) {
    if (sf.label === folderName) return sf.matchFolders;
    if (sf.children) {
      for (const ch of sf.children) {
        if (ch.folderKey === folderName || ch.label === folderName) {
          return ch.matchFolders;
        }
      }
    }
  }
  return null;
}

const FOLDER_ACCENT_PALETTE = [
  '#2563eb',
  '#0d9488',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#e11d48',
];

/** The Flatfile tab's record formats, as its toolbar names the one shown. */
const FLATFILE_FORMAT_NAMES = { genbank: 'GenBank', fasta: 'FASTA', embl: 'EMBL-EBI', gff3: 'GFF3 Annotations' } as const;

export const App: React.FC = () => {
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const sessionActiveRef = useRef<boolean>(false);
  sessionActiveRef.current = sessionActive;
  const [homeViewActive, setHomeViewActive] = useState<boolean>(false);
  const [openTabIds, setOpenTabIds] = useState<string[]>([SAMPLE_LIBRARY[0].id]);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [folderNames, setFolderNames] = useState<Record<string, string>>({});
  const [folderParents, setFolderParents] = useState<Record<string, string>>({});
  const [hiddenFolders, setHiddenFolders] = useState<string[]>([]);
  const [favoriteFolders, setFavoriteFolders] = useState<string[]>([]);
  const [readDocIds, setReadDocIds] = useState<string[]>([]);
  const [folderContextMenu, setFolderContextMenu] = useState<{ folder: string; pos: DropdownViewportPosition } | null>(null);
  const [folderInfo, setFolderInfo] = useState<{ label: string; count: number; bytes: number } | null>(null);
  /** Open options window for an operation that creates a result document. */
  const [operationDialog, setOperationDialog] = useState<
    | { kind: 'align'; algorithm?: string }
    | { kind: 'tree'; method?: PhyloTreeAlgorithm }
    | { kind: 'pairwise' }
    | { kind: 'digest' }
    | { kind: 'primers' }
    | { kind: 'orfs' }
    | { kind: 'cloning' }
    | { kind: 'denovo' }
    | { kind: 'map' }
    | { kind: 'duplicates' }
    | { kind: 'rename' }
    | { kind: 'transalign' }
    | { kind: 'mask' }
    | { kind: 'consensus' }
    | { kind: 'consensus-tree' }
    | { kind: 'saved-primers' }
    | { kind: 'trim' }
    | { kind: 'backtranslate' }
    | { kind: 'add-to-alignment' }
    | { kind: 'validate-clone' }
    | { kind: 'import-metadata' }
    | { kind: 'merge-pairs' }
    | { kind: 'compare-annotations' }
    | { kind: 'read-qc' }
    | { kind: 'compute-distances'; analysis?: string }
    | { kind: 'condense-tree' }
    | { kind: 'gene-duplications' }
    | { kind: 'examples' }
    | { kind: 'highlight-sites' }
    | { kind: 'evo'; analysis: EvoAnalysis; initial?: OptionValues }
    | { kind: 'timetree' }
    | { kind: 'degenerate-primers' }
    | { kind: 'annotate-from-documents' }
    | { kind: 'import-primers' }
    | { kind: 'annotate-by-blast' }
    | { kind: 'crispr-editing' }
    | { kind: 'expression' }
    | { kind: 'make-blast-db' }
    | { kind: 'expression-levels' }
    | { kind: 'structural-variants' }
    | { kind: 'microsatellites' }
    | { kind: 'align-structures' }
    | null
  >(null);
  // Workflows → Manage Workflows… / Run Workflow…
  const [manageWorkflowsOpen, setManageWorkflowsOpen] = useState(false);
  const [runWorkflowFor, setRunWorkflowFor] = useState<{ workflowId?: string } | null>(null);
  const operationDialogFor = (op: OperationId) =>
    op === 'align-multiple' ? { kind: 'align' as const }
      : op === 'build-tree' ? { kind: 'tree' as const }
      : op === 'align-pairwise' ? { kind: 'pairwise' as const }
      : op === 'digest-fragments' ? { kind: 'digest' as const }
      : op === 'find-orfs' ? { kind: 'orfs' as const }
      : op === 'clone-insert' ? { kind: 'cloning' as const }
      : op === 'de-novo-assemble' ? { kind: 'denovo' as const }
      : op === 'map-to-reference' ? { kind: 'map' as const }
      : op === 'find-duplicates' ? { kind: 'duplicates' as const }
      : op === 'batch-rename' ? { kind: 'rename' as const }
      : op === 'translation-align' ? { kind: 'transalign' as const }
      : op === 'mask-alignment' ? { kind: 'mask' as const }
      : op === 'generate-consensus' ? { kind: 'consensus' as const }
      : op === 'consensus-tree' ? { kind: 'consensus-tree' as const }
      : op === 'test-saved-primers' ? { kind: 'saved-primers' as const }
      : op === 'trim-ends' ? { kind: 'trim' as const }
      : op === 'back-translate' ? { kind: 'backtranslate' as const }
      : op === 'add-to-alignment' ? { kind: 'add-to-alignment' as const }
      : op === 'validate-clone' ? { kind: 'validate-clone' as const }
      : op === 'import-metadata' ? { kind: 'import-metadata' as const }
      : op === 'merge-pairs' ? { kind: 'merge-pairs' as const }
      : op === 'compare-annotations' ? { kind: 'compare-annotations' as const }
      : op === 'read-qc' ? { kind: 'read-qc' as const }
      : op === 'compute-distances' ? { kind: 'compute-distances' as const }
      : op === 'condense-tree' ? { kind: 'condense-tree' as const }
      : op === 'gene-duplications' ? { kind: 'gene-duplications' as const }
      : op === 'highlight-sites' ? { kind: 'highlight-sites' as const }
      : op === 'timetree' ? { kind: 'timetree' as const }
      : op === 'degenerate-primers' ? { kind: 'degenerate-primers' as const }
      : op === 'annotate-from-documents' ? { kind: 'annotate-from-documents' as const }
      : op === 'import-primers' ? { kind: 'import-primers' as const }
      : op === 'annotate-by-blast' ? { kind: 'annotate-by-blast' as const }
      : op === 'crispr-editing' ? { kind: 'crispr-editing' as const }
      : op === 'expression' ? { kind: 'expression' as const }
      : op === 'make-blast-db' ? { kind: 'make-blast-db' as const }
      : op === 'expression-levels' ? { kind: 'expression-levels' as const }
      : op === 'structural-variants' ? { kind: 'structural-variants' as const }
      : op === 'microsatellites' ? { kind: 'microsatellites' as const }
      : op === 'align-structures' ? { kind: 'align-structures' as const }
      : op.startsWith('evo-') ? { kind: 'evo' as const, analysis: op.slice(4) as EvoAnalysis }
      : { kind: 'primers' as const };
  // User-assigned operation shortcuts and toolbar buttons (set from each options window).
  const [opShortcuts, setOpShortcuts] = useState(() => readOperationShortcuts());
  useEffect(() => {
    const sync = () => setOpShortcuts(readOperationShortcuts());
    window.addEventListener(OPERATION_SHORTCUTS_EVENT, sync);
    return () => window.removeEventListener(OPERATION_SHORTCUTS_EVENT, sync);
  }, []);
  const openOperationRef = useRef<(op: OperationId) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = shortcutFromEvent(e, IS_MAC_PLATFORM);
      if (!combo) return;
      const op = operationForShortcut(combo);
      if (!op || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      openOperationRef.current(op);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [folderColors, setFolderColors] = useState<Record<string, string>>({});
  const [favoriteDocIds, setFavoriteDocIds] = useState<string[]>(['doc-pet28-egfp']);
  const [deletedDocIds, setDeletedDocIds] = useState<string[]>([]);
  const [checkedDocIds, setCheckedDocIds] = useState<string[]>([SAMPLE_LIBRARY[0].id]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    () => DOC_TABLE_COLUMN_PRESETS['standard-cloning'].columns
  );
  const [docColumnOrder, setDocColumnOrder] = useState<string[]>([]);
  const [lockColumnOrder, setLockColumnOrder] = useState<boolean>(false);
  const [savedCustomColumnState, setSavedCustomColumnState] = useState<
    string[] | null
  >(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [docFilterOpen, setDocFilterOpen] = useState<boolean>(false);
  const [docFilterRules, setDocFilterRules] = useState<TableFilterRule[]>([]);
  const [docFilterMatchMode, setDocFilterMatchMode] = useState<'all' | 'any'>('all');
  const [wholeProjectSearch, setWholeProjectSearch] = useState<boolean>(false);
  const [helpPanelOpen, setHelpPanelOpen] = useState<boolean>(false);
  /** Split view: id of the document shown next to the main viewer ('' = choose; null = off). */
  const [splitDocId, setSplitDocId] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); setHelpPanelOpen((o) => !o); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** Document table cell being edited in place (Name / Description). */
  const [editingCell, setEditingCell] = useState<{ docId: string; col: 'name' | 'description'; draft: string } | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => loadSavedSearches());
  const [docColumnsPopoverOpen, setDocColumnsPopoverOpen] = useState<boolean>(false);
  const [docColumnsAnchorRect, setDocColumnsAnchorRect] = useState<DOMRect | null>(null);
  const [docColStatusMsg, setDocColStatusMsg] = useState<string | null>(null);
  const [dragDocColId, setDragDocColId] = useState<string | null>(null);
  const [workspaceSplitMode, setWorkspaceSplitMode] = useState<
    'top-bottom' | 'left-right'
  >('top-bottom');
  const [expandedDocView, setExpandedDocView] = useState<boolean>(false);
  const [dbExplorerCategory, setDbExplorerCategory] =
    useState<ReferenceDatabaseCategoryId | null>(null);
  const [localBlastDbs, setLocalBlastDbs] = useState<LocalSequenceDbEntry[]>(() => [
    {
      id: 'local-db-project-all',
      name: 'Active_Project_Constructs_DB',
      moleculeType: 'Nucleotide',
      sourceFolder: 'All Project Files',
      sequenceCount: SAMPLE_LIBRARY.length,
    },
    {
      id: 'local-db-vectors',
      name: 'Plasmid_Backbones_&_Vectors_DB',
      moleculeType: 'Nucleotide',
      sourceFolder: 'Plasmids & Vectors',
      sequenceCount: 8,
    },
    ...loadStoredBlastDbs(),
  ]);
  /** User-made BLAST databases persist in this browser; the two built-in ones are recreated. */
  useEffect(() => {
    storeBlastDbs(localBlastDbs.filter((db) => db.id !== 'local-db-project-all' && db.id !== 'local-db-vectors'));
  }, [localBlastDbs]);

  const [documents, setDocuments] = useState<SequenceDocument[]>(SAMPLE_LIBRARY);
  const [selectedFolder, setSelectedFolder] = useState<string>('All Project Files');
  const [activeDocId, setActiveDocId] = useState<string>(SAMPLE_LIBRARY[0].id);
  const [navHistory, setNavHistory] = useState<string[]>([SAMPLE_LIBRARY[0].id]);
  const [navIndex, setNavIndex] = useState<number>(0);

  const [tableFilter, setTableFilter] = useState<string>('');
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');
  const [helpMenuSearch, setHelpMenuSearch] = useState<string>('');
  const [docTableCollapsed, setDocTableCollapsed] = useState<boolean>(false);
  /** Folds or shows the document table for a workbench event (opening a document folds it; selecting rows never does). */
  const applyDocTableEvent = (event: DocTableEvent) =>
    setDocTableCollapsed((collapsed) => nextDocTableCollapsed(collapsed, event));
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);
  /** Whether a studio in the viewer claims the inspector (WorkbenchInspectorProvider tells only crossings). */
  const [inspectorClaims, setInspectorClaims] = useState<InspectorClaims>(NO_INSPECTOR_CLAIMS);
  // The provider tells a release after its commit, so it can reach App after App has unmounted.
  const appMountedRef = useRef(true);
  useIsomorphicLayoutEffect(() => {
    appMountedRef.current = true;
    return () => {
      appMountedRef.current = false;
    };
  }, []);
  const handleInspectorClaims = useCallback((claims: InspectorClaims) => {
    if (appMountedRef.current) setInspectorClaims(claims);
  }, []);
  /** The shared inspector column's body, which the studios' InspectorSections are drawn into. */
  const [inspectorColumn, setInspectorColumn] = useState<HTMLElement | null>(null);
  const [themePref, setThemePref] = useState<ThemePreference>(() =>
    readStoredThemePreference()
  );
  const [darkMode, setDarkMode] = useState<boolean>(() =>
    resolveEffectiveDarkMode(readStoredThemePreference())
  );
  const [previewOsOverride, setPreviewOsOverride] = useState<SupportedOS | null>(null);

  const applyThemePreference = (nextPref: ThemePreference) => {
    setThemePref(nextPref);
    setDarkMode(applyPlatformColorScheme(nextPref));
  };

  // Two-state quick chrome toggle following modern-web-guidance dark-mode-toggle:
  // Reverts to 'system' (clearing stored override) whenever target matches current OS default.
  const handleQuickThemeToggle = () => {
    const targetScheme: 'light' | 'dark' = darkMode ? 'light' : 'dark';
    const systemIsDark = resolveEffectiveDarkMode('system');
    const nextPref: ThemePreference =
      (targetScheme === 'dark') === systemIsDark ? 'system' : targetScheme;
    applyThemePreference(nextPref);
  };

  useEffect(() => {
    setDarkMode(applyPlatformColorScheme(themePref));
    return subscribeSystemColorScheme((_sysDark, stored) => {
      setThemePref(stored);
      setDarkMode(resolveEffectiveDarkMode(stored));
    });
  }, [themePref]);

  // Sidebar tree expansion states
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    projectFiles: true,
    sampleDocs: true,
    genomes: true,
    libraries: true,
    ncbiDbs: true,
  });

  // Active Top Menu Bar, Toolbar, First Page & Multifile Table Dropdowns
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId>(null);
  const [openToolbarDropdown, setOpenToolbarDropdown] = useState<ToolbarDropdownId>(null);
  const [openHomeDropdown, setOpenHomeDropdown] = useState<HomeTopDropdownId>(null);
  const [openMultifileDropdown, setOpenMultifileDropdown] = useState<
    'annotate' | 'manage' | 'columns' | null
  >(null);
  const [menuPopupPos, setMenuPopupPos] = useState<DropdownViewportPosition>({
    top: 60,
    left: 12,
    maxHeight: 520,
  });
  const [rowContextMenu, setRowContextMenu] = useState<{
    docId: string;
    pos: DropdownViewportPosition;
  } | null>(null);
  const [isFileDragActive, setIsFileDragActive] = useState<boolean>(false);
  const fileDragDepthRef = useRef<number>(0);

  const handleWindowChromeMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || isInteractiveWindowChromeTarget(e.target)) {
      return;
    }
    if (e.detail >= 2) {
      requestDesktopWindowToggleMaximize();
    } else {
      requestDesktopWindowDrag();
    }
  };

  const hasDraggedFiles = (dt: DataTransfer | null): boolean =>
    Boolean(dt && Array.from(dt.types ?? []).includes('Files'));

  const closeAllMenus = () => {
    setOpenTopMenu(null);
    setOpenToolbarDropdown(null);
    setOpenHomeDropdown(null);
    setOpenMultifileDropdown(null);
    setRowContextMenu(null);
    setFolderContextMenu(null);
  };

  const toggleTopMenu = (
    id: Exclude<TopMenuId, null>,
    e: React.MouseEvent<HTMLElement>,
    minWidth = 240
  ) => {
    setOpenToolbarDropdown(null);
    setOpenHomeDropdown(null);
    setOpenMultifileDropdown(null);
    setRowContextMenu(null);
    setFolderContextMenu(null);
    if (openTopMenu === id) {
      setOpenTopMenu(null);
      return;
    }
    const pos = computeViewportClampedMenuPosition(
      e.currentTarget.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
      minWidth
    );
    setMenuPopupPos(pos);
    setOpenTopMenu(id);
  };

  const toggleToolbarMenu = (
    id: Exclude<ToolbarDropdownId, null>,
    e: React.MouseEvent<HTMLElement>,
    minWidth = 260
  ) => {
    setOpenTopMenu(null);
    setOpenHomeDropdown(null);
    setOpenMultifileDropdown(null);
    setRowContextMenu(null);
    setFolderContextMenu(null);
    if (openToolbarDropdown === id) {
      setOpenToolbarDropdown(null);
      return;
    }
    const pos = computeViewportClampedMenuPosition(
      e.currentTarget.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
      minWidth
    );
    setMenuPopupPos(pos);
    setOpenToolbarDropdown(id);
  };

  const toggleHomeDropdown = (
    id: Exclude<HomeTopDropdownId, null>,
    e: React.MouseEvent<HTMLElement>,
    minWidth = 275
  ) => {
    setOpenTopMenu(null);
    setOpenToolbarDropdown(null);
    setOpenMultifileDropdown(null);
    setRowContextMenu(null);
    setFolderContextMenu(null);
    if (openHomeDropdown === id) {
      setOpenHomeDropdown(null);
      return;
    }
    const pos = computeViewportClampedMenuPosition(
      e.currentTarget.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
      minWidth
    );
    setMenuPopupPos(pos);
    setOpenHomeDropdown(id);
  };

  const toggleMultifileDropdown = (
    id: 'annotate' | 'manage' | 'columns',
    e: React.MouseEvent<HTMLElement>,
    minWidth = 290
  ) => {
    setOpenTopMenu(null);
    setOpenToolbarDropdown(null);
    setOpenHomeDropdown(null);
    setRowContextMenu(null);
    setFolderContextMenu(null);
    if (openMultifileDropdown === id) {
      setOpenMultifileDropdown(null);
      setRowContextMenu(null);
      setFolderContextMenu(null);
      return;
    }
    const pos = computeViewportClampedMenuPosition(
      e.currentTarget.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
      minWidth
    );
    setMenuPopupPos(pos);
    setOpenMultifileDropdown(id);
  };

  // Modals (Preferences 7-tab, BLAST Studio, New Sequence, About & License, Confirm Quit)
  const [prefsModalTab, setPrefsModalTab] = useState<PreferencesTabId | null>(null);
  const [blastModalOpen, setBlastModalOpen] = useState<boolean>(false);
  const [newSeqModalOpen, setNewSeqModalOpen] = useState<boolean>(false);
  const [aboutModalOpen, setAboutModalOpen] = useState<boolean>(false);
  const [startupSplashOpen, setStartupSplashOpen] = useState<boolean>(true);
  const [confirmBeforeQuit, setConfirmBeforeQuit] = useState<boolean>(() =>
    readStoredConfirmBeforeQuit()
  );
  const [confirmQuitModalOpen, setConfirmQuitModalOpen] = useState<boolean>(false);
  const quitApprovedBrowserRef = useRef<boolean>(false);

  const applyConfirmBeforeQuitPreference = (next: boolean) => {
    setConfirmBeforeQuit(next);
    writeStoredConfirmBeforeQuit(next);
    syncNativeConfirmBeforeQuit(next);
  };

  useEffect(() => {
    syncNativeConfirmBeforeQuit(confirmBeforeQuit);
  }, [confirmBeforeQuit]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState<string>('');
  const [commandPaletteIdx, setCommandPaletteIdx] = useState<number>(0);
  const [headerSearchFocused, setHeaderSearchFocused] = useState<boolean>(false);
  const [headerSearchIdx, setHeaderSearchIdx] = useState<number>(0);
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number>(
    () => loadPersistedWorkspaceLayout().sidebarWidthPx
  );
  const [sidebarDragging, setSidebarDragging] = useState<boolean>(false);
  const sidebarDragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startW: number;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    startW: 245,
  });
  const [inspectorWidthPx, setInspectorWidthPx] = useState<number>(
    () => loadPersistedWorkspaceLayout().inspectorWidthPx
  );
  const [inspectorDragging, setInspectorDragging] = useState<boolean>(false);
  const inspectorDragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startW: number;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    startW: DEFAULT_WORKSPACE_LAYOUT.inspectorWidthPx,
  });
  const [docTableHeightPx, setDocTableHeightPx] = useState<number>(
    () => loadPersistedWorkspaceLayout().docTableHeightPx
  );
  const [docTableWidthPx, setDocTableWidthPx] = useState<number>(
    () => loadPersistedWorkspaceLayout().docTableWidthPx
  );
  const workbenchRootRef = useRef<HTMLDivElement | null>(null);
  const sidebarWidthVarStyle = useMemo(
    () => ({ '--mbc-sidebar-width': `${sidebarWidthPx}px` }) as React.CSSProperties,
    [sidebarWidthPx]
  );
  const [workspacePaneDragging, setWorkspacePaneDragging] = useState<boolean>(false);
  const workspacePaneDragRef = useRef<{
    active: boolean;
    pointerId: number;
    mode: 'top-bottom' | 'left-right';
    startPos: number;
    startSize: number;
  }>({
    active: false,
    pointerId: -1,
    mode: 'top-bottom',
    startPos: 0,
    startSize: 175,
  });
  const [undoStack, setUndoStack] = useState<DocumentUndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DocumentUndoSnapshot[]>([]);
  const [vectorStudioTab, setVectorStudioTab] = useState<VectorStudioTab>('catalog');
  const [statusBanner, setStatusBannerState] = useState<string | null>(null);
  const statusBannerTimerRef = useRef<number | null>(null);
  /** Shows `message` in the status line for 5.2 s, or, with `keep`, until it is dismissed or replaced. */
  const setStatusBanner = useCallback((message: string | null, options?: { keep?: boolean }): void => {
    if (statusBannerTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(statusBannerTimerRef.current);
      statusBannerTimerRef.current = null;
    }
    setStatusBannerState(message);
    if (message && !options?.keep && typeof window !== 'undefined') {
      statusBannerTimerRef.current = window.setTimeout(() => {
        setStatusBannerState(null);
        statusBannerTimerRef.current = null;
      }, 5200);
    }
  }, []);
  useEffect(() => {
    return () => {
      if (statusBannerTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(statusBannerTimerRef.current);
      }
    };
  }, []);
  const [promptDialog, setPromptDialog] = useState<{
    title: string;
    label: string;
    value: string;
    placeholder?: string;
    confirmLabel: string;
    onConfirm: (entered: string) => void;
  } | null>(null);
  // Generic confirmation dialog used for destructive actions (discarding
  // unsaved sessions, permanently erasing documents, replacing the autosave).
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    destructive?: boolean;
    onConfirm: () => void;
    alternateLabel?: string;
    onAlternate?: () => void;
    onCancel?: () => void;
  } | null>(null);

  const [requestedViewerTab, setViewerTab] = useState<ViewerTab>('sequence-view');
  /** Mirrors useNativeMacMenuBar for listeners registered before it is computed. */
  const nativeMacMenuBarRef = useRef(false);
  // Bumped by every studio-opening command so a studio re-applies the requested
  // sub-tab even when it equals the previous request.
  const [studioCommandNonce, setStudioCommandNonce] = useState(0);
  const [primersInitialSubTab, setPrimersInitialSubTab] = useState<'design' | 'saved' | 'crispr'>('design');
  const [menubarFocusId, setMenubarFocusId] =
    useState<Exclude<TopMenuId, null>>('app');
  const menubarTriggerRefs = useRef<
    Partial<Record<Exclude<TopMenuId, null>, HTMLButtonElement | null>>
  >({});

  // Dedicated Sequence Alignment Studio state (ungrouped from Phylogenetics)
  const [alignInitialSubMode, setAlignInitialSubMode] =
    useState<AlignmentSubMode>('msa');
  const [alignInitialMsaAlgo, setAlignInitialMsaAlgo] =
    useState<MsaAlgorithmOption>('consistency-nj');
  const [alignInitialPairwiseAlgo, setAlignInitialPairwiseAlgo] =
    useState<PairwiseAlgorithmOption>('nw');
  const [alignCommandNonce, setAlignCommandNonce] = useState<number>(0);

  // Dedicated Phylogenetic Analysis Studio state (ungrouped from Sequence Alignment)
  const [phyloInitialTab, setPhyloInitialTab] =
    useState<PhyloModuleTab>('phylogeny');
  const [phyloInitialTreeAlgo, setPhyloInitialTreeAlgo] =
    useState<PhyloTreeAlgorithm>('Maximum Likelihood (ML)');
  const [phyloInitialModelsView, setPhyloInitialModelsView] =
    useState<ModelsSubViewId>('best-models');
  const [phyloInitialAncestralMethod, setPhyloInitialAncestralMethod] =
    useState<AncestralInferenceMethod>('Maximum Likelihood (Empirical Bayes)');
  const [phyloCommandNonce, setPhyloCommandNonce] = useState<number>(0);

  const [cloningInitialMethod, setCloningInitialMethod] =
    useState<CloningMethodType>('Restriction Ligation');
  const [cloningInitialSubTool, setCloningInitialSubTool] =
    useState<CloningSubToolType>('gel');
  const [hybridInitialSubTab, setHybridInitialSubTab] =
    useState<HybridSubTabId>('protein');
  const [hybridInitialPluginId, setHybridInitialPluginId] =
    useState<string | undefined>(undefined);
  const [genomicsInitialSubTab, setGenomicsInitialSubTab] =
    useState<GenomicsSuiteSubTab>('ngs-assembly');
  const viewerCanvasRef = useRef<HTMLDivElement | null>(null);


  const [mapLayoutMode, setMapLayoutMode] = useState<'split' | 'circular' | 'linear'>('split');
  const [zoomLevel, setZoomLevel] = useState<number>(SEQUENCE_ZOOM_DEFAULT);
  // Restoring the sequence map (⌘0, View › Actual Size, the header's % readout) returns its zoom to
  // 100% and counts up its restore key, on which the circle recentres a pan.
  const [sequenceViewRestores, setSequenceViewRestores] = useState(0);
  const restoreSequenceView = () => {
    setZoomLevel(SEQUENCE_ZOOM_DEFAULT);
    setSequenceViewRestores((n) => n + 1);
  };
  const [textFormat, setTextFormat] = useState<'genbank' | 'fasta' | 'embl' | 'gff3'>('genbank');
  const [colorScheme, setColorScheme] = useState<NucleotideColorScheme>('standard');

  // Right-hand 7-Section Accordion Panels state (Progressive disclosure: General + Restriction open by default)
  const [openRightPanels, setOpenRightPanels] = useState<Record<string, boolean>>({
    general: true,
    display: false,
    annotations: false,
    graphs: false,
    restriction: true,
    orfs: false,
    statistics: false,
  });

  // Sequence View & Graphs Display Toggles (start from Preferences → DNA defaults)
  const [startupPrefs] = useState(() => loadUserPreferences());
  const [showOrfs, setShowOrfs] = useState<boolean>(startupPrefs.view.showOrfs);
  const [minOrfAa, setMinOrfAa] = useState<number>(startupPrefs.view.minOrfAa);
  const [allowAltStartCodons, setAllowAltStartCodons] = useState<boolean>(startupPrefs.view.allowAltStartCodons);
  const [showPrimers, setShowPrimers] = useState<boolean>(startupPrefs.view.showPrimers);
  const [showTranslation, setShowTranslation] = useState<boolean>(startupPrefs.view.showTranslation);
  const [showGcGraph, setShowGcGraph] = useState<boolean>(startupPrefs.view.showGcGraph);
  const [showHydropathyGraph, setShowHydropathyGraph] = useState<boolean>(false);
  const [showUniqueCuttersOnly, setShowUniqueCuttersOnly] = useState<boolean>(startupPrefs.view.uniqueCuttersOnly);
  const [exportLineEndingPref, setExportLineEndingPref] = useState(startupPrefs.exportLineEnding);
  // Changing a view default in Preferences applies it to the open view immediately.
  useEffect(() => {
    const onPrefs = (e: Event) => {
      const p = (e as CustomEvent<UserPreferences>).detail;
      if (!p) return;
      setShowOrfs(p.view.showOrfs);
      setMinOrfAa(p.view.minOrfAa);
      setAllowAltStartCodons(p.view.allowAltStartCodons);
      setShowPrimers(p.view.showPrimers);
      setShowTranslation(p.view.showTranslation);
      setShowGcGraph(p.view.showGcGraph);
      setShowUniqueCuttersOnly(p.view.uniqueCuttersOnly);
      setExportLineEndingPref(p.exportLineEnding);
    };
    window.addEventListener(USER_PREFERENCES_EVENT, onPrefs);
    return () => window.removeEventListener(USER_PREFERENCES_EVENT, onPrefs);
  }, []);
  const [selectedRange, setSelectedRange] = useState<{
    start: number;
    end: number;
    label?: string;
  } | null>({ start: 5179, end: 5898, label: 'eGFP (CDS)' });

  const [sessionName, setSessionName] = useState<string>('MolBioCraft_Workbench');
  const [mbcImportMode, setMbcImportMode] = useState<'replace' | 'merge'>('replace');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderImportInputRef = useRef<HTMLInputElement | null>(null);
  const mbcFileInputRef = useRef<HTMLInputElement | null>(null);
  const prefsImportInputRef = useRef<HTMLInputElement | null>(null);
  const [newSeqInitialClipboardText, setNewSeqInitialClipboardText] = useState<string>('');
  const prevPanelStateBeforeExpandRef = useRef<{
    sidebarOpen: boolean;
    docTableCollapsed: boolean;
  } | null>(null);

  const favoriteIdsSet = useMemo(() => new Set(favoriteDocIds), [favoriteDocIds]);
  const deletedIdsSet = useMemo(() => new Set(deletedDocIds), [deletedDocIds]);
  const checkedIdsSet = useMemo(() => new Set(checkedDocIds), [checkedDocIds]);

  const activeNonDeletedDocs = useMemo(
    () => documents.filter((d) => !deletedIdsSet.has(d.id)),
    [documents, deletedIdsSet]
  );

  const sampleLibraryById = useMemo(
    () => new Map(SAMPLE_LIBRARY.map((d) => [d.id, d])),
    []
  );

  const catalogAllDocs = useMemo(() => {
    const byId = new Map<string, SequenceDocument>();
    for (const d of documents) {
      byId.set(d.id, d);
    }
    for (const s of SAMPLE_LIBRARY) {
      if (!byId.has(s.id)) {
        byId.set(s.id, s);
      }
    }
    return Array.from(byId.values());
  }, [documents]);

  const catalogNonDeletedDocs = useMemo(
    () => catalogAllDocs.filter((d) => !deletedIdsSet.has(d.id)),
    [catalogAllDocs, deletedIdsSet]
  );

  const sampleCatalogNonDeletedDocs = useMemo(
    () =>
      catalogNonDeletedDocs.filter(
        (d) => sampleLibraryById.has(d.id) || findSubfolderMatchFolders(d.folder) !== null
      ),
    [catalogNonDeletedDocs, sampleLibraryById]
  );

  const [showMenuFunctionInfo, setShowMenuFunctionInfo] = useState<boolean>(() =>
    readStoredShowMenuFunctionInfo()
  );

  useEffect(() => {
    const syncMenuInfo = () => setShowMenuFunctionInfo(readStoredShowMenuFunctionInfo());
    window.addEventListener(MENU_FUNCTION_INFO_EVENT, syncMenuInfo);
    window.addEventListener('storage', syncMenuInfo);
    return () => {
      window.removeEventListener(MENU_FUNCTION_INFO_EVENT, syncMenuInfo);
      window.removeEventListener('storage', syncMenuInfo);
    };
  }, []);

  const handleToggleMenuFunctionInfo = useCallback(() => {
    setShowMenuFunctionInfo((prev) => {
      const next = !prev;
      writeStoredShowMenuFunctionInfo(next);
      return next;
    });
  }, []);

  // Close dropdown menus on outside click, outside focus, or Escape key
  useEffect(() => {
    const closeIfOutsideMenuSystem = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      if (
        el?.closest(
          '.toolbar-dropdown-anchor, .menubar-dropdown-anchor, .desktop-menu-popup, .desktop-menu-func-tooltip, .mbc-visually-hidden-file-input'
        )
      ) {
        return;
      }
      setOpenTopMenu(null);
      setOpenToolbarDropdown(null);
      setOpenHomeDropdown(null);
      setOpenMultifileDropdown(null);
      setRowContextMenu(null);
      setFolderContextMenu(null);
    };
    const onMouseDown = (ev: MouseEvent) => {
      closeIfOutsideMenuSystem(ev.target);
    };
    const onFocusIn = (ev: FocusEvent) => {
      closeIfOutsideMenuSystem(ev.target);
    };
    const onGlobalKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !ev.defaultPrevented) {
        setOpenTopMenu(null);
        setOpenToolbarDropdown(null);
        setOpenHomeDropdown(null);
        setOpenMultifileDropdown(null);
        setRowContextMenu(null);
        setFolderContextMenu(null);
      }
      // Remove reload function (Cmd+R, Ctrl+R, Shift+Cmd/Ctrl+R, F5), including
      // from text fields, modals and key repeat. Shift+Cmd/Ctrl+R is Reverse
      // Complement: the in-window dispatcher runs it despite defaultPrevented;
      // on the native macOS menu bar it is not cancelled, so AppKit's key
      // equivalent runs it (see shouldBlockReloadChord).
      if (shouldBlockReloadChord(ev, nativeMacMenuBarRef.current)) {
        ev.preventDefault();
      }
      if (ev.key === 'F5') {
        ev.preventDefault();
      }
    };
    const onGlobalContextMenu = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!isInput) {
        ev.preventDefault();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('contextmenu', onGlobalContextMenu);
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('contextmenu', onGlobalContextMenu);
      window.removeEventListener('keydown', onGlobalKeyDown);
    };
  }, []);

  const selectDocumentWithHistory = (docId: string, preserveMultiSelection = false, recordNavigation = true) => {
    setHomeViewActive(false);
    setActiveDocId(docId);
    setReadDocIds((prev) => prev.includes(docId) ? prev : [...prev, docId]);
    setSelectedRange(null);
    const targetDoc = catalogAllDocs.find((d) => d.id === docId);
    if (targetDoc) {
      setHybridInitialSubTab(targetDoc.docMetadata?.['Document Type'] === 'Enzyme Set' ? 'enzymes-view' : 'lineage');
      const preferred = preferredViewerTab(targetDoc);
      const relevant = relevantViewerTabs(targetDoc, preserveMultiSelection
        ? documents.filter((d) => checkedDocIds.includes(d.id) || d.id === docId)
        : [targetDoc]);
      setViewerTab((current) =>
        preferred !== 'sequence-view' || !relevant.includes(current) ? preferred : current
      );
    }
    if (!preserveMultiSelection) {
      setCheckedDocIds([docId]);
    } else {
      setCheckedDocIds((prev) => (prev.includes(docId) ? prev : [...prev, docId]));
    }
    setOpenTabIds((prev) => (prev.includes(docId) ? prev : [...prev, docId]));
    if (recordNavigation) {
      const nextHistory = navHistory.slice(0, navIndex + 1);
      if (nextHistory[nextHistory.length - 1] !== docId) nextHistory.push(docId);
      setNavHistory(nextHistory);
      setNavIndex(nextHistory.length - 1);
    }
  };

  const handleGoBack = () => {
    if (navIndex > 0) {
      const nextIdx = navIndex - 1;
      setNavIndex(nextIdx);
      selectDocumentWithHistory(navHistory[nextIdx], false, false);
    }
  };

  const handleGoForward = () => {
    if (navIndex < navHistory.length - 1) {
      const nextIdx = navIndex + 1;
      setNavIndex(nextIdx);
      selectDocumentWithHistory(navHistory[nextIdx], false, false);
    }
  };

  const explorerFolders = useMemo<ExplorerFolder[]>(() => {
    const builtIn: ExplorerFolder[] = [
      { id: 'Sample Documents', label: 'Sample Documents', parent: PROJECT_ROOT, matchFolders: [] },
      ...PROJECT_SUBFOLDERS.flatMap((sf) => [
        { id: sf.label, label: sf.label, parent: 'Sample Documents', matchFolders: sf.matchFolders.filter((f) => !sf.children?.some((child) => child.matchFolders.includes(f))) },
        ...(sf.children ?? []).map((child) => ({ id: child.folderKey, label: child.label, parent: sf.label, matchFolders: child.matchFolders })),
      ]),
    ];
    const known = new Set(builtIn.flatMap((folder) => [folder.id, ...folder.matchFolders]));
    const custom = [...new Set([...customFolders, ...documents.map((doc) => doc.folder)])]
      .filter((id) => id !== PROJECT_ROOT && !known.has(id));
    const all = [...builtIn, ...custom.map((id) => ({ id, label: id, parent: SAMPLE_LIBRARY.some((doc) => doc.folder === id) ? 'Sample Documents' : PROJECT_ROOT, matchFolders: [id] }))];
    const ids = new Set([PROJECT_ROOT, ...all.map((folder) => folder.id)]);
    return all.map((folder) => ({ ...folder, label: folderNames[folder.id] ?? folder.label,
      parent: ids.has(folderParents[folder.id]) && folderParents[folder.id] !== folder.id ? folderParents[folder.id] : folder.parent,
    }));
  }, [customFolders, documents, folderNames, folderParents]);
  const visibleExplorerFolders = useMemo(() => explorerFolders.filter((folder) => !hiddenFolders.includes(folder.id)), [explorerFolders, hiddenFolders]);
  const explorerFolderCounts = useMemo(() => Object.fromEntries(explorerFolders.map((folder) => [folder.id,
    documentsInFolder(folder.id, explorerFolders, catalogNonDeletedDocs).length,
  ])), [explorerFolders, catalogNonDeletedDocs]);
  const folderLabel = (id: string) => explorerFolders.find((folder) => folder.id === id)?.label ?? id;

  const getDocsForFolderView = (folderName: string): SequenceDocument[] => {
    if (folderName === 'Deleted Items') {
      return catalogAllDocs.filter((d) => deletedIdsSet.has(d.id));
    }
    if (folderName === 'Favorites') {
      return catalogNonDeletedDocs.filter((d) => favoriteIdsSet.has(d.id));
    }
    if (
      folderName === 'All Project Files' ||
      folderName === 'All Documents' ||
      folderName === 'Local'
    ) {
      return activeNonDeletedDocs;
    }
    return documentsInFolder(folderName, explorerFolders, catalogNonDeletedDocs);
  };

  const docsInSelectedFolder = useMemo(
    () => getDocsForFolderView(selectedFolder),
    [
      selectedFolder,
      activeNonDeletedDocs,
      catalogAllDocs,
      catalogNonDeletedDocs,
      sampleCatalogNonDeletedDocs,
      deletedIdsSet,
      favoriteIdsSet,
      customFolders,
      explorerFolders,
    ]
  );

  const availableFolderColumns = useMemo<DynamicDocColumnDef[]>(
    () => getFolderAwareDocumentColumns(docsInSelectedFolder, selectedFolder),
    [docsInSelectedFolder, selectedFolder]
  );

  const orderedAllDocColumns = useMemo<DynamicDocColumnDef[]>(() => {
    if (docColumnOrder.length === 0) return availableFolderColumns;
    const orderMap = new Map(docColumnOrder.map((id, i) => [id, i]));
    return [...availableFolderColumns].sort((a, b) => {
      // Keep Icon & Name anchored on the frozen left edge
      if (a.id === 'icon') return -2;
      if (b.id === 'icon') return 2;
      if (a.id === 'name') return -1;
      if (b.id === 'name') return 1;
      const ia = orderMap.has(a.id) ? orderMap.get(a.id)! : 1000;
      const ib = orderMap.has(b.id) ? orderMap.get(b.id)! : 1000;
      return ia - ib;
    });
  }, [availableFolderColumns, docColumnOrder]);

  const orderedVisibleDocColumns = useMemo<DynamicDocColumnDef[]>(() => {
    const visSet = new Set(visibleColumns);
    return orderedAllDocColumns.filter((c) => c.alwaysVisible || visSet.has(c.id));
  }, [orderedAllDocColumns, visibleColumns]);

  const handleSelectProjectFolder = (nextFolder: string) => {
    setSelectedFolder(nextFolder);
    const nextDocs = getDocsForFolderView(nextFolder);
    // Selection object cannot select across other folders:
    // Update activeDocId and checkedDocIds strictly scoped to the newly selected folder
    if (nextDocs.length > 0) {
      const alreadyInFolder = nextDocs.some((d) => d.id === activeDocId);
      const targetDocId = alreadyInFolder ? activeDocId : nextDocs[0].id;
      setActiveDocId(targetDocId);
      setCheckedDocIds([targetDocId]);
      selectDocumentWithHistory(targetDocId);
    } else {
      setActiveDocId('');
      setCheckedDocIds([]);
      setViewerTab('sequence-view');
    }

    const savedFolderState =
      loadPersistedTableColumnState(`main-doc-table:${nextFolder}`) ??
      loadPersistedTableColumnState('main-doc-table');
    if (savedFolderState && savedFolderState.visibleIds.length > 0) {
      setVisibleColumns(savedFolderState.visibleIds);
      setDocColumnOrder(savedFolderState.orderedIds);
      setLockColumnOrder(savedFolderState.lockColumnOrder);
    } else {
      const nextAvail = getFolderAwareDocumentColumns(nextDocs, nextFolder);
      const nextDefaults = getDefaultVisibleColumnsForFolder(nextFolder, nextAvail);
      setVisibleColumns(nextDefaults);
      if (nextFolder === 'Alignments' || nextFolder === 'Contig Assembly') {
        setDocColumnOrder(nextDefaults);
      }
    }
  };

  const activeDocFilterCount =
    (tableFilter.trim().length > 0 ? 1 : 0) +
    docFilterRules.filter((r) => r.value.trim().length > 0).length;

  /** Documents in the open file tabs, in tab order (for split view). */
  const openDocs = useMemo(
    () => openTabIds.map((id) => documents.find((d) => d.id === id) ?? sampleLibraryById.get(id)).filter((d): d is SequenceDocument => !!d),
    [openTabIds, documents, sampleLibraryById]
  );

  const commitCellEdit = (doc: SequenceDocument) => {
    if (!editingCell || editingCell.docId !== doc.id) return;
    const value = editingCell.draft.trim();
    const { col } = editingCell;
    setEditingCell(null);
    if (col === 'name' && !value) { setStatusBanner('A document name cannot be empty.'); return; }
    if ((col === 'name' ? doc.name : doc.description) === value) return;
    const t = new Date().toISOString();
    handleUpdateDocument({
      ...doc,
      [col]: value,
      updatedAt: t,
      history: [...doc.history, { id: `hist-${Date.now().toString(36)}`, timestamp: t, operation: col === 'name' ? 'Rename' : 'Edit Description', description: `${col === 'name' ? 'Name' : 'Description'}: "${col === 'name' ? doc.name : doc.description}" → "${value}"`, parentIds: [doc.id], lengthBp: doc.sequence.length, topology: doc.topology }],
    }, col === 'name' ? 'Rename Document' : 'Edit Description');
  };

  const renderCellEditor = (doc: SequenceDocument) => (
    <input
      autoFocus
      className="mbc-cell-editor"
      aria-label={editingCell?.col === 'name' ? `New name for ${doc.name}` : `Description of ${doc.name}`}
      value={editingCell?.draft ?? ''}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setEditingCell((c) => (c ? { ...c, draft: e.target.value } : c))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commitCellEdit(doc);
        if (e.key === 'Escape') setEditingCell(null);
      }}
      onBlur={() => commitCellEdit(doc)}
    />
  );

  const filteredDocuments = useMemo(() => {
    const globalStr = globalSearchQuery.trim().toLowerCase();
    const searchableColIds = orderedVisibleDocColumns
      .filter((c) => c.id !== 'icon')
      .map((c) => c.id);

    const scope = wholeProjectSearch && activeDocFilterCount > 0 ? catalogNonDeletedDocs : docsInSelectedFolder;
    const baseList = scope.filter((d) => {
      if (
        globalStr &&
        !d.name.toLowerCase().includes(globalStr) &&
        !d.accession.toLowerCase().includes(globalStr) &&
        !d.description.toLowerCase().includes(globalStr)
      ) {
        return false;
      }

      if (activeDocFilterCount === 0) return true;

      const metrics = computeDocumentTableMetrics(d);
      const isFav = favoriteIdsSet.has(d.id);
      return evaluateTableRowFilters(
        (cid) => (isSearchField(cid) ? searchFieldText(d, cid) : getDocumentColumnDisplayValue(d, metrics, cid, isFav)),
        searchableColIds,
        tableFilter,
        docFilterRules,
        docFilterMatchMode
      );
    });

    return sortDocumentsByColumn(baseList, sortColumn, sortDirection, favoriteIdsSet);
  }, [
    docsInSelectedFolder,
    wholeProjectSearch,
    catalogNonDeletedDocs,
    orderedVisibleDocColumns,
    tableFilter,
    docFilterRules,
    docFilterMatchMode,
    activeDocFilterCount,
    globalSearchQuery,
    favoriteIdsSet,
    sortColumn,
    sortDirection,
  ]);

  const selectedInFilteredDocs = useMemo(
    () => filteredDocuments.filter((d) => checkedIdsSet.has(d.id)),
    [filteredDocuments, checkedIdsSet]
  );

  const activeDoc = useMemo(
    () =>
      documents.find((d) => d.id === activeDocId) ??
      sampleLibraryById.get(activeDocId) ??
      activeNonDeletedDocs[0] ??
      documents[0] ??
      EMPTY_WORKSPACE_DOCUMENT,
    [documents, sampleLibraryById, activeNonDeletedDocs, activeDocId]
  );

  const viewerTab = resolveViewerTab(activeDoc, requestedViewerTab);
  // A command that requests a view the active document cannot show used to be
  // silently redirected to the document's default view ("nothing happened").
  // Explain the redirect once per request instead.
  const lastRequestedViewerTabRef = useRef<ViewerTab>(requestedViewerTab);
  useEffect(() => {
    const changedRequest = lastRequestedViewerTabRef.current !== requestedViewerTab;
    lastRequestedViewerTabRef.current = requestedViewerTab;
    if (!changedRequest || !sessionActive || viewerTab === requestedViewerTab) return;
    // Sequence view is the default tab of a new (still empty) session; falling
    // back to Document Info there is expected, not a refused request.
    if (!activeDoc.id && requestedViewerTab === 'sequence-view') return;
    const label = VIEWER_TAB_LABELS[requestedViewerTab] ?? requestedViewerTab;
    const docLabel = activeDoc.id ? `"${activeDoc.name}" (${activeDoc.moleculeType})` : 'an empty session';
    setStatusBanner(
      `${label} is not available for ${docLabel}. Select a ${
        ['cloning-gel', 'primers-pcr', 'vector-library', 'sanger-contig'].includes(requestedViewerTab) ? 'DNA ' : ''
      }sequence document that supports it.`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedViewerTab, viewerTab]);
  useIsomorphicLayoutEffect(() => {
    if (viewerCanvasRef.current) {
      viewerCanvasRef.current.scrollTop = 0;
    }
  }, [
    viewerTab,
    vectorStudioTab,
    alignInitialSubMode,
    alignCommandNonce,
    phyloInitialTab,
    phyloCommandNonce,
    cloningInitialMethod,
    cloningInitialSubTool,
    hybridInitialSubTab,
    genomicsInitialSubTab,
  ]);
  const selectedAnalysisDocuments = useMemo(
    () => docsInSelectedFolder.filter((doc) => checkedIdsSet.has(doc.id)),
    [docsInSelectedFolder, checkedIdsSet]
  );
  const visibleViewerTabs = useMemo(
    () => visibleDocumentTabs(activeDoc, selectedAnalysisDocuments, viewerTab),
    [activeDoc, selectedAnalysisDocuments, viewerTab]
  );
  // Genomics studio pickers / assembly: live (not trashed) nucleotide records only.
  const genomicsCandidateDocs = useMemo(
    () => activeNonDeletedDocs.filter((d) => d.moleculeType !== 'Protein' && hasBiologicalSequence(d)),
    [activeNonDeletedDocs]
  );
  const genomicsProteinDocs = useMemo(
    () => activeNonDeletedDocs.filter((d) => d.moleculeType === 'Protein' && hasBiologicalSequence(d)),
    [activeNonDeletedDocs]
  );
  const phylogenyInputs = useMemo(
    () => phylogenySourceDocuments(
      activeDoc,
      selectedAnalysisDocuments,
      catalogNonDeletedDocs
    ),
    [activeDoc, selectedAnalysisDocuments, catalogNonDeletedDocs]
  );
  const isProteinSequence = activeDoc.moleculeType === 'Protein';
  const hasSequenceData = hasBiologicalSequence(activeDoc);
  const isDnaSequence = activeDoc.moleculeType === 'DNA' && hasSequenceData;
  const sequenceUnit = isProteinSequence ? 'aa' : activeDoc.moleculeType === 'RNA' ? 'nt' : 'bp';
  const canShowCircularMap = activeDoc.moleculeType === 'DNA' && activeDoc.topology === 'circular';
  const effectiveMapLayoutMode = canShowCircularMap ? mapLayoutMode : 'linear';
  // Zoom and the primer / ORF / unique-cutter toggles only drive the circular
  // map; with no circular map shown they changed a readout and nothing else.
  const circularMapShown = effectiveMapLayoutMode !== 'linear';
  const CIRCULAR_ONLY_HINT = 'Applies to the circular map (switch View › Map Layout to Circular or Split)';

  // Statistics are the whole sequence's at any length (BG-01M6RRSV): the engine counts it in one
  // pass, asked for only while the panel is open. Over 60,000 bp they were scaled up from the first
  // 12,000 bp, with the Dam / Dcm sites counted there. The pass runs outside render, once per
  // sequence (BG-01M6RTP1): until it lands the panel says it is counting.
  useSyncExternalStore(wholeSequenceCounts.subscribe, wholeSequenceCounts.version, wholeSequenceCounts.version);
  const statisticsShown =
    activeDoc.moleculeType !== 'Protein' &&
    sessionActive &&
    !homeViewActive &&
    viewerTab === 'sequence-view' &&
    rightPanelOpen &&
    Boolean(openRightPanels.statistics);
  const wholeSequenceCount = statisticsShown ? wholeSequenceCounts.request(activeDoc.sequence) : null;
  const composition = wholeSequenceCount && 'composition' in wholeSequenceCount ? wholeSequenceCount.composition : null;
  // The engine weighs the linear chain; a closed circle weighs one water less per strand. N and the
  // other IUPAC codes, which Biopython will not weigh, make both masses estimates.
  const strandEnds = activeDoc.topology === 'circular' ? BIOPYTHON_WATER_DA : 0;
  const massesApproximate = (composition?.counts.N ?? 0) > 0;
  const massText = (da: number) => `${massesApproximate ? '≈ ' : ''}${(da / 1000).toFixed(1)} kDa`;

  // The status bar's selection readout is the whole selection's (BG-01M6RTHN): one engine pass,
  // about 9 ms at 1,000,000 bp and under 100 ms at 10,000,000 bp when measured. It stopped after its
  // first 12,001 bp, so a 200 kb selection read "(12001 bp | GC ...)", its GC and Tm from that slice.
  const selectionComposition = useMemo(() => {
    if (!sessionActive || !selectedRange || activeDoc.moleculeType === 'Protein') return null;
    const sub = activeDoc.sequence.slice(
      Math.max(0, selectedRange.start - 1),
      Math.min(activeDoc.sequence.length, Math.max(selectedRange.start, selectedRange.end))
    );
    return analyzeSequenceComposition(sub);
  }, [sessionActive, activeDoc.sequence, activeDoc.moleculeType, selectedRange]);

  const proteinStats = useMemo(() => {
    if (
      activeDoc.moleculeType !== 'Protein' ||
      !sessionActive ||
      homeViewActive ||
      viewerTab !== 'sequence-view' ||
      !rightPanelOpen ||
      !openRightPanels.statistics
    ) {
      return EMPTY_PROTEIN_STATS;
    }
    return analyzeProteinSequence(
      activeDoc.sequence,
      activeDoc.moleculeType !== 'Protein',
      9
    );
  }, [
    sessionActive,
    homeViewActive,
    viewerTab,
    rightPanelOpen,
    openRightPanels.statistics,
    activeDoc.sequence,
    activeDoc.moleculeType,
  ]);

  // What the restriction scan covers (BG-01M6RPWR). Over 150,000 bp it reads only the first
  // 60,000 bp, as a linear sequence; and the engine scans more than 100,000 bp with its core
  // catalog only (CORE_CATALOG_LEN enzymes, the Rust constant of that name in rebase_catalog.rs).
  // The counts drawn from the scan say so: the map's note, and the Restriction Analysis header
  // and list.
  const restrictionScope = useMemo<RestrictionScanScope | null>(() => {
    const length = activeDoc.sequence.length;
    return restrictionScanScope(length, restrictionScannedBp(length));
  }, [activeDoc.sequence.length]);
  const restrictionWords = restrictionScopeWords(restrictionScope, activeDoc.sequence.length);

  // The scan gives every enzyme's complete site count and keeps each enzyme's first sites by
  // position (BG-01M6S1K2): single cutters and the site total are read from the counts, and a
  // limit on the kept positions is the scan's own warning, shown with the Restriction Analysis.
  const restrictionScan = useMemo(() => {
    if (
      !sessionActive ||
      homeViewActive ||
      viewerTab !== 'sequence-view' ||
      activeDoc.moleculeType !== 'DNA'
    ) {
      return EMPTY_RESTRICTION_SCAN;
    }
    if (restrictionScope?.firstBp) {
      return scanRestrictionSites(activeDoc.sequence.slice(0, restrictionScope.firstBp), 'linear');
    }
    return scanRestrictionSites(activeDoc.sequence, activeDoc.topology);
  }, [
    sessionActive,
    homeViewActive,
    viewerTab,
    activeDoc.sequence,
    activeDoc.topology,
    activeDoc.moleculeType,
    restrictionScope,
  ]);
  const cutSites = restrictionScan.sites;
  const restrictionSiteCounts = useMemo(() => restrictionSiteCountsByName(restrictionScan), [restrictionScan]);
  const restrictionSiteTotal = useMemo(
    () => restrictionScan.siteCounts.reduce((n, c) => n + c.sites, 0),
    [restrictionScan]
  );
  // The construct cockpit marks an enzyme cutting once as a unique cutter of the whole molecule,
  // which a scan of its first bases cannot tell, so it is handed none.
  const cockpitCutSites = useMemo(() => (restrictionScope?.firstBp ? [] : cutSites), [restrictionScope, cutSites]);
  // The Restriction Analysis header's count and its once-cutter list's name, scoped as the scan is.
  const restrictionSiteCount = restrictionWords
    ? `${restrictionSiteTotal.toLocaleString()} ${restrictionSiteTotal === 1 ? 'site' : 'sites'} ${restrictionWords.sites}`
    : String(restrictionSiteTotal);
  const onceCutterListName = restrictionWords ? `Cutting once ${restrictionWords.once}` : 'Unique Single-Cutters';

  // What the ORF scan covers (BG-01M6RRSV). Over 150,000 bp it reads only the first 60,000 bp, as a
  // linear sequence, for ORFs of 120 aa or more (or the slider's minimum, when that is higher). The
  // ORF counts say so: the ORFs header, its note and minimum, the Annotations and Tracks list and the
  // Annotations table.
  const orfScope = useMemo(
    () => (activeDoc.sequence.length > 150_000 ? { firstBp: 60_000, minAa: Math.max(120, minOrfAa) } : null),
    [activeDoc.sequence.length, minOrfAa]
  );
  const orfScopeWords = orfScope ? `of ${orfScope.minAa} aa or more in the first ${orfScope.firstBp.toLocaleString()} bp` : null;

  const orfs = useMemo(() => {
    if (
      !sessionActive ||
      homeViewActive ||
      (viewerTab !== 'sequence-view' && viewerTab !== 'annotations-table') ||
      activeDoc.moleculeType === 'Protein'
    ) {
      return [];
    }
    if (orfScope) {
      return findORFs(
        activeDoc.sequence.slice(0, orfScope.firstBp).replace(/U/g, 'T'),
        orfScope.minAa,
        allowAltStartCodons
      );
    }
    return findORFs(activeDoc.sequence.replace(/U/g, 'T'), minOrfAa, allowAltStartCodons, 1, activeDoc.topology === 'circular');
  }, [
    sessionActive,
    homeViewActive,
    viewerTab,
    activeDoc.sequence,
    activeDoc.moleculeType,
    activeDoc.topology,
    minOrfAa,
    allowAltStartCodons,
    orfScope,
  ]);

  const handleLoadBenchmarkDocument = (kind: 'genome-500k' | 'protein-10k') => {
    const targetNamePrefix =
      kind === 'genome-500k' ? 'Escherichia_coli_K_12' : 'Titin_Ig_Polyprotein';
    const existing = documents.find((d) => d.name.startsWith(targetNamePrefix));
    if (existing) {
      setSessionActive(true);
      ensureResidentSequenceRust(existing, 180);
      selectDocumentWithHistory(existing.id);
      applyDocTableEvent({ kind: 'open' });
      setViewerTab('sequence-view');
      setStatusBanner(
        `Switched to benchmark document "${existing.name}" (${existing.sequence.length.toLocaleString()} ${existing.moleculeType === 'Protein' ? 'aa' : 'bp'})`
      );
      return;
    }

    const generated =
      kind === 'genome-500k'
        ? generateLargeGenomeBenchmarkRust(500_000, 'Escherichia coli K-12')
        : generateLargeProteinBenchmarkRust(10_000, 'Titin_Ig_Polyprotein');
    const ack = ensureResidentSequenceRust(generated, 180);
    handleAddConstruct(generated);
    setStatusBanner(
      `Loaded "${generated.name}" (${generated.sequence.length.toLocaleString()} ${
        generated.moleculeType === 'Protein' ? 'aa' : 'bp'
      }, ${generated.features.length} annotations; ${Math.round(
        ack.residentTotalBytes / 1024
      ).toLocaleString()} KiB held in memory)`
    );
  };

  // The single cutters by their complete counts (BG-01M6S1K2), in the order of their sites.
  const uniqueCutterNames = useMemo(
    () => cutSites.filter((c) => restrictionSiteCounts[c.enzyme.name] === 1).map((c) => c.enzyme.name),
    [cutSites, restrictionSiteCounts]
  );

  const toggleAccordion = (key: string) => {
    setOpenRightPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTreeNode = (key: string) => {
    setExpandedNodes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleUpdateDocument = (
    updated: SequenceDocument,
    actionLabel = 'Sequence / Annotation Edit'
  ) => {
    if (!updated.id) {
      // The empty-workspace placeholder (blank session) is a rendering context,
      // never a project document: refuse edits instead of inserting a phantom row.
      setStatusBanner(`${actionLabel}: open or create a sequence document first.`);
      return;
    }
    const prevDoc =
      documents.find((d) => d.id === updated.id) ?? sampleLibraryById.get(updated.id);
    // Engine edits carry a placeholder date (no clock in WASM): stamp real time.
    updated = stampEngineTimestamps(updated, new Date().toISOString(), prevDoc);
    if (prevDoc && prevDoc !== updated) {
      setUndoStack((prev) => [
        ...prev.slice(-(MAX_UNDO_STEPS - 1)),
        {
          docId: updated.id,
          prevDoc,
          nextDoc: updated,
          label: actionLabel,
        },
      ]);
      setRedoStack([]);
    }
    setDocuments((prev) =>
      prev.some((d) => d.id === updated.id)
        ? prev.map((d) => (d.id === updated.id ? updated : d))
        : [...prev, updated]
    );
  };

  const handleUndoDocumentEdit = () => {
    if (!sessionActive) {
      setStatusBanner('No active session — nothing to undo.');
      return;
    }
    if (undoStack.length === 0) {
      setStatusBanner('Nothing to undo.');
      return;
    }
    const entry = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    if (!documents.some((d) => d.id === entry.docId)) {
      // The edited document was erased since; restoring it would resurrect a
      // stale snapshot behind the user's back.
      setStatusBanner(`Cannot undo ${entry.label}: "${entry.prevDoc.name}" no longer exists.`);
      return;
    }
    setRedoStack((prev) => [...prev.slice(-(MAX_UNDO_STEPS - 1)), entry]);
    setDocuments((prev) =>
      prev.map((d) => (d.id === entry.docId ? applyHistorySnapshot(d, entry.prevDoc) : d))
    );
    focusDocumentAfterHistoryStep(entry.docId, entry.prevDoc.sequence.length);
    setStatusBanner(`Undid ${entry.label} on "${entry.prevDoc.name}"`);
  };

  /** Bring the document an undo/redo step touched into view with a valid selection. */
  const focusDocumentAfterHistoryStep = (docId: string, sequenceLength: number) => {
    if (activeDoc.id !== docId) {
      setOpenTabIds((prev) => (prev.includes(docId) ? prev : [...prev, docId]));
      setCheckedDocIds([docId]);
      selectDocumentWithHistory(docId);
      setSelectedRange(null);
    } else if (selectedRange && selectedRange.end > sequenceLength) {
      setSelectedRange(null);
    }
  };

  const handleRedoDocumentEdit = () => {
    if (!sessionActive) {
      setStatusBanner('No active session — nothing to redo.');
      return;
    }
    if (redoStack.length === 0) {
      setStatusBanner('Nothing to redo.');
      return;
    }
    const entry = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    if (!documents.some((d) => d.id === entry.docId)) {
      setStatusBanner(`Cannot redo ${entry.label}: "${entry.nextDoc.name}" no longer exists.`);
      return;
    }
    setUndoStack((prev) => [...prev.slice(-(MAX_UNDO_STEPS - 1)), entry]);
    setDocuments((prev) =>
      prev.map((d) => (d.id === entry.docId ? applyHistorySnapshot(d, entry.nextDoc) : d))
    );
    focusDocumentAfterHistoryStep(entry.docId, entry.nextDoc.sequence.length);
    setStatusBanner(`Redid ${entry.label} on "${entry.nextDoc.name}"`);
  };

  const activateImportedDocumentsInWorkspace = (
    incomingDocs: SequenceDocument[],
    fallbackSessionName?: string
  ) => {
    if (incomingDocs.length === 0) return;
    const wasActive = sessionActiveRef.current;
    if (!wasActive) allocatedDocIdsRef.current.clear();
    // Parsers derive ids deterministically (e.g. `fasta-0-1200`), so importing
    // the same file twice — or two files with the same record — would collide
    // and make edits to one overwrite the other. Allocate unique ids.
    const takenIds = new Set<string>(wasActive ? documentsRef.current.map((d) => d.id) : []);
    for (const id of allocatedDocIdsRef.current) takenIds.add(id);
    incomingDocs = assignUniqueDocumentIds(incomingDocs, takenIds);
    const importedAt = new Date().toISOString();
    incomingDocs = incomingDocs.map((d) => stampEngineTimestamps(d, importedAt));
    for (const d of incomingDocs) {
      allocatedDocIdsRef.current.add(d.id);
      if (importBatchActiveRef.current) importBatchDocsRef.current.set(d.id, d);
    }
    const primary = incomingDocs[0];
    if (importBatchActiveRef.current) importTargetDocIdRef.current = primary.id;
    const incomingIds = incomingDocs.map((d) => d.id);

    sessionActiveRef.current = true;
    setSessionActive(true);
    setHomeViewActive(false);
    // Imported and opened files, new documents and most saved analysis results arrive here, opened
    // (the commands that open a document by another route apply the same event).
    applyDocTableEvent({ kind: 'open' });

    if (!wasActive) {
      const cleanTitle =
        (fallbackSessionName ?? `${primary.name}_Session`).replace(/[^\w.-]+/g, '_') ||
        'Imported_Session';
      // A new session starts from the imported files: reset session-scoped
      // state (history, explorer layout) left over from the closed session.
      // The pending-autosave flag is deliberately left untouched.
      markSessionPristine(false);
      resetSessionScopedState();
      for (const id of incomingIds) allocatedDocIdsRef.current.add(id);
      setCustomFolders([]); setFolderColors({}); setFolderNames({}); setFolderParents({});
      setHiddenFolders([]); setFavoriteFolders([]); setFavoriteDocIds([]); setReadDocIds([]);
      setSessionName(cleanTitle);
      setDocuments(incomingDocs);
      setDeletedDocIds([]);
      setSelectedFolder('All Project Files');
      setActiveDocId(primary.id);
      setCheckedDocIds([primary.id]);
      setOpenTabIds(incomingIds.slice(0, 8));
      setNavHistory([primary.id]);
      setNavIndex(0);
      setSelectedRange(null);
      return;
    }

    setDocuments((prev) => [...incomingDocs, ...removeUntouchedLegacyStarter(prev)]);
    setSessionName((prev) =>
      prev === 'Untitled_Session' ? `${primary.name}_Session` : prev
    );
    setOpenTabIds((prev) => {
      const next = [...prev];
      for (const id of incomingIds.slice(0, 6)) {
        if (!next.includes(id)) {
          next.push(id);
        }
      }
      return next;
    });
    selectDocumentWithHistory(primary.id);
    setSelectedRange(null);
  };

  const handleAddConstruct = (newDoc: SequenceDocument) => {
    if (!newDoc.id) {
      setStatusBanner('Could not add a document without an identifier.');
      return;
    }
    activateImportedDocumentsInWorkspace([newDoc]);
    setViewerTab('sequence-view');
    setStatusBanner(`Created "${newDoc.name}" (${newDoc.sequence.length.toLocaleString()} bp)`);
  };

  /** Adds an operation's result document, selects it and opens the matching view. */
  const handleAddOperationResult = (newDoc: SequenceDocument, tab: ViewerTab, summary: string) => {
    activateImportedDocumentsInWorkspace([newDoc]);
    setViewerTab(tab);
    setStatusBanner(summary);
  };
  const operationSourceLabel = (() => {
    if ((activeDoc.alignmentMeta?.sequences?.length ?? 0) > 1) return activeDoc.name;
    if (phylogenyInputs.length === 1) return phylogenyInputs[0].name;
    return `${phylogenyInputs.length} selected sequences`;
  })();

  // Menu Actions for Sequence transformations
  const handleReverseComplementActiveDoc = (target?: SequenceDocument) => {
    const targetDoc = target ?? activeDoc;
    const isActiveTarget = targetDoc.id === activeDoc.id;
    if (!ensureCommandAvailable('strand-transform', 'Reverse Complement', targetDoc)) return;
    const rcSeq = reverseComplement(targetDoc.sequence, targetDoc.moleculeType === 'RNA');
    const inverted = invertSequenceCoordinates(targetDoc, rcSeq.length, true);
    const updated: SequenceDocument = {
      ...targetDoc,
      sequence: rcSeq,
      features: inverted.features,
      primers: inverted.primers,
      updatedAt: new Date().toISOString(),
      history: [
        ...targetDoc.history,
        {
          id: `h-rc-${Date.now()}`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          operation: 'Reverse Complement',
          description: `Transformed ${targetDoc.name} to reverse complement (${rcSeq.length} bp, ${inverted.features.length} annotations inverted)`,
          parentIds: [targetDoc.id],
          lengthBp: rcSeq.length,
          topology: targetDoc.topology,
        },
      ],
    };
    handleUpdateDocument(updated);
    if (isActiveTarget && selectedRange && rcSeq.length > 0) {
      setSelectedRange({
        ...selectedRange,
        start: Math.max(1, Math.min(rcSeq.length, rcSeq.length - selectedRange.end + 1)),
        end: Math.max(1, Math.min(rcSeq.length, rcSeq.length - selectedRange.start + 1)),
      });
    }
    setStatusBanner(
      `Applied Reverse Complement to ${targetDoc.name} (${inverted.features.length} annotation coordinates inverted)`
    );
  };

  const handleComplementOnlyActiveDoc = (target?: SequenceDocument) => {
    const targetDoc = target ?? activeDoc;
    const isActiveTarget = targetDoc.id === activeDoc.id;
    if (!ensureCommandAvailable('strand-transform', 'Complement Only', targetDoc)) return;
    const compSeq = complementOnlySequence(
      targetDoc.sequence,
      targetDoc.moleculeType === 'RNA'
    );
    const updated: SequenceDocument = {
      ...targetDoc,
      sequence: compSeq,
      updatedAt: new Date().toISOString(),
      history: [
        ...targetDoc.history,
        {
          id: `h-comp-${Date.now()}`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          operation: 'Complement Only',
          description: `Transformed ${targetDoc.name} to 5'→3' Watson-Crick complement (${compSeq.length} bp)`,
          parentIds: [targetDoc.id],
          lengthBp: compSeq.length,
          topology: targetDoc.topology,
        },
      ],
    };
    handleUpdateDocument(updated);
    setStatusBanner(`Applied Complement-Only (5'→3') to ${targetDoc.name}`);
  };

  const handleReverseOnlyActiveDoc = (target?: SequenceDocument) => {
    const targetDoc = target ?? activeDoc;
    const isActiveTarget = targetDoc.id === activeDoc.id;
    if (!ensureCommandAvailable('strand-transform', 'Reverse Only', targetDoc)) return;
    const revSeq = reverseOnlySequence(targetDoc.sequence);
    const inverted = invertSequenceCoordinates(targetDoc, revSeq.length, false);
    const updated: SequenceDocument = {
      ...targetDoc,
      sequence: revSeq,
      features: inverted.features,
      primers: inverted.primers,
      updatedAt: new Date().toISOString(),
      history: [
        ...targetDoc.history,
        {
          id: `h-rev-${Date.now()}`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          operation: 'Reverse Only',
          description: `Reversed polarity (3'→5') of ${targetDoc.name} without complementing (${revSeq.length} bp, ${inverted.features.length} annotations mirrored)`,
          parentIds: [targetDoc.id],
          lengthBp: revSeq.length,
          topology: targetDoc.topology,
        },
      ],
    };
    handleUpdateDocument(updated);
    if (isActiveTarget && selectedRange && revSeq.length > 0) {
      setSelectedRange({
        ...selectedRange,
        start: Math.max(1, Math.min(revSeq.length, revSeq.length - selectedRange.end + 1)),
        end: Math.max(1, Math.min(revSeq.length, revSeq.length - selectedRange.start + 1)),
      });
    }
    setStatusBanner(
      `Applied Reverse-Only (3'→5') to ${targetDoc.name} (${inverted.features.length} annotation coordinates mirrored)`
    );
  };

  const openGenomicsSuite = (subTab: GenomicsSuiteSubTab = 'ngs-assembly') => {
    setStudioCommandNonce((n) => n + 1);
    setGenomicsInitialSubTab(subTab);
    setViewerTab('genomics-ngs');
  };

  const handleExtractSelectedRegion = () => {
    const start = selectedRange?.start ?? 1;
    const end = selectedRange?.end ?? Math.min(activeDoc.sequence.length, 500);
    const extracted = extractRegionWithAnnotationsRust(
      activeDoc,
      start,
      end,
      new Date().toISOString()
    );
    handleAddConstruct(extracted);
  };

  const handleConvertDnaRna = (target?: SequenceDocument) => {
    const targetDoc = target ?? activeDoc;
    const isActiveTarget = targetDoc.id === activeDoc.id;
    if (!ensureCommandAvailable('convert-dna-rna', 'Convert DNA / RNA', targetDoc)) return;
    const toRna = targetDoc.moleculeType !== 'RNA';
    const converted = convertDnaRna(targetDoc.sequence, toRna);
    handleUpdateDocument({
      ...targetDoc,
      moleculeType: toRna ? 'RNA' : 'DNA',
      sequence: converted,
      updatedAt: new Date().toISOString(),
    });
    setStatusBanner(
      `Converted ${targetDoc.name} to ${toRna ? 'RNA (Uracil)' : 'DNA (Thymine)'}`
    );
  };

  const handleToggleCircularLinear = (target?: SequenceDocument) => {
    const targetDoc = target ?? activeDoc;
    const isActiveTarget = targetDoc.id === activeDoc.id;
    if (!ensureCommandAvailable('document-edit', 'Change Topology', targetDoc)) return;
    const nextTopo = targetDoc.topology === 'circular' ? 'linear' : 'circular';
    handleUpdateDocument({
      ...targetDoc,
      topology: nextTopo,
      updatedAt: new Date().toISOString(),
    });
    setStatusBanner(`Changed ${targetDoc.name} topology to ${nextTopo.toUpperCase()}`);
  };

  // A menu-requested sub-tab applies to that request only; plain opens of the
  // Primers studio (toolbar, palette, other menu items) start on Design.
  // Keyed on the request, not the resolved tab: briefly selecting a protein
  // (which cannot show the studio) must not drop a pending sub-tab request.
  useEffect(() => {
    if (requestedViewerTab !== 'primers-pcr') setPrimersInitialSubTab('design');
  }, [requestedViewerTab]);

  const openPrimersStudio = (sub: 'design' | 'saved' | 'crispr' = 'design') => {
    setStudioCommandNonce((n) => n + 1);
    setPrimersInitialSubTab(sub);
    setViewerTab('primers-pcr');
  };

  /** Features › Add Feature: annotate the current selection (it only opened a read-only table). */
  const handleAddFeatureFromSelection = () => {
    if (!ensureCommandAvailable('document-edit', 'Add Feature')) return;
    if (!selectedRange) {
      setStatusBanner('Add Feature: select the region to annotate in the sequence view first.');
      return;
    }
    const target = activeDoc;
    const range = { start: selectedRange.start, end: selectedRange.end };
    setPromptDialog({
      title: 'Add Feature',
      label: `Name for ${range.start.toLocaleString()}..${range.end.toLocaleString()} on "${target.name}"`,
      value: selectedRange.label || 'New feature',
      placeholder: 'Feature name',
      confirmLabel: 'Add Feature',
      onConfirm: (name) => {
        const feature = {
          id: `feat-user-${Date.now().toString(36)}`,
          name: name.trim() || 'New feature',
          type: 'misc_feature',
          start: range.start,
          end: range.end,
          strand: 1,
          color: '#2563eb',
        } as SequenceDocument['features'][number];
        handleUpdateDocument(
          { ...target, features: [...target.features, feature], updatedAt: new Date().toISOString() },
          'Add Feature'
        );
        setViewerTab('annotations-table');
        setStatusBanner(`Added feature "${feature.name}" (${range.start}..${range.end}) to "${target.name}"`);
      },
    });
  };

  /** Features › Add Tag / Protease: only epitope-tag and protease-site detections (it added every common feature). */
  const handleDetectTagsAndProteaseSites = () => {
    if (!ensureCommandAvailable('nucleotide-analysis', 'Detect Tags & Protease Sites')) return;
    const detected = detectCommonFeatures(activeDoc).filter(isTagOrProteaseFeature);
    if (detected.length === 0) {
      setStatusBanner(`No new epitope tags or protease sites detected in ${activeDoc.name}.`);
      return;
    }
    handleUpdateDocument(
      { ...activeDoc, features: [...activeDoc.features, ...detected], updatedAt: new Date().toISOString() },
      'Detect Tags & Protease Sites'
    );
    setStatusBanner(`Added ${detected.length} tag / protease-site annotation${detected.length === 1 ? '' : 's'} to ${activeDoc.name}`);
  };

  /** Primers › Export Primers: FASTA of the document's primers (it only opened the studio). */
  const handleExportPrimersFasta = () => {
    if (!ensureCommandAvailable('document-edit', 'Export Primers')) return;
    if (activeDoc.primers.length === 0) {
      setStatusBanner(`"${activeDoc.name}" has no primers to export.`);
      return;
    }
    const fasta = activeDoc.primers
      .map((p) => `>${p.name} ${p.bindStart}..${p.bindEnd} ${p.strand === 1 ? 'forward' : 'reverse'}\n${p.sequence}`)
      .join('\n');
    if (handleDownloadFile(fasta + '\n', `${activeDoc.name}_primers.fasta`) === 'downloaded') {
      setStatusBanner(`Exported ${activeDoc.primers.length} primers from "${activeDoc.name}"`);
    }
  };

  /** Annotate › Transfer Features lives in the alignment's Annotations panel. */
  const handleOpenTransferAnnotations = () => {
    openSequenceAlignment('msa');
    setStatusBanner('Transfer annotations between aligned sequences from the Annotations panel of the alignment view.');
  };

  /** Motif / domain search: PSSM motif scanning exists for nucleotide sequences only. */
  const handleOpenMotifSearch = (label: string) => {
    if (activeDoc.moleculeType === 'Protein') {
      openHybridSubTab('protein');
      setStatusBanner(`${label}: motif and domain scanning is available for DNA/RNA (JASPAR PSSM); showing protein analysis.`);
      return;
    }
    openGenomicsSuite('genes-cpg-repeats');
  };

  const openCloningMethod = (
    method: CloningMethodType,
    subTool: CloningSubToolType = 'gel'
  ) => {
    setStudioCommandNonce((n) => n + 1);
    setCloningInitialMethod(method);
    setCloningInitialSubTool(subTool);
    setViewerTab('cloning-gel');
  };

  const openHybridSubTab = (subTab: HybridSubTabId) => {
    setStudioCommandNonce((n) => n + 1);
    setHybridInitialSubTab(subTab);
    setViewerTab('history-hybrid');
  };

  const openPluginTool = (pluginId: string) => {
    setStudioCommandNonce((n) => n + 1);
    setHybridInitialSubTab('workflows');
    setHybridInitialPluginId(pluginId);
    setViewerTab('history-hybrid');
  };

  const openVectorStudio = (tab: VectorStudioTab = 'catalog') => {
    setStudioCommandNonce((n) => n + 1);
    setVectorStudioTab(tab);
    setViewerTab('vector-library');
  };

  const handleInsertModularPart = (part: ModularVectorPart, positionBp: number) => {
    if (!ensureCommandAvailable('document-edit', `Insert ${part.name}`)) return;
    if (activeDoc.moleculeType === 'Protein') {
      setStatusBanner(`Insert ${part.name}: parts can only be spliced into DNA documents.`);
      return;
    }
    const updated = spliceModularPartIntoDocumentRust(
      activeDoc,
      part,
      positionBp,
      new Date().toISOString()
    );
    const delta = updated.sequence.length - activeDoc.sequence.length;
    const cutPos = Math.max(1, Math.min(activeDoc.sequence.length + 1, Math.round(positionBp)));
    handleUpdateDocument(updated);
    setStatusBanner(`Inserted ${part.name} (${delta} bp) into ${activeDoc.name} at bp ${cutPos}`);
    setViewerTab('sequence-view');
  };

  const handleAutoDetectCommonFeatures = () => {
    if (!ensureCommandAvailable('nucleotide-analysis', 'Detect Common Features')) return;
    const detected = detectCommonFeatures(activeDoc);
    if (detected.length === 0) {
      setStatusBanner(`All standard features in ${activeDoc.name} are already annotated.`);
      return;
    }
    handleUpdateDocument({
      ...activeDoc,
      features: [...activeDoc.features, ...detected],
      updatedAt: new Date().toISOString(),
    });
    setStatusBanner(
      `Auto-detected and added ${detected.length} common ${
        detected.length === 1 ? 'feature' : 'features'
      } to ${activeDoc.name}`
    );
  };

  const handleSetOriginToSelection = () => {
    // Previously defaulted to base 100 with no selection and rotated linear
    // molecules and proteins; the shared rule now requires a circular
    // nucleotide document and an explicit cursor/selection.
    if (!ensureCommandAvailable('set-origin', 'Set Origin', activeDoc)) return;
    const originPos = selectedRange!.start;
    if (originPos <= 1) {
      setStatusBanner(`Base ${originPos} is already the origin of ${activeDoc.name}.`);
      return;
    }
    const splitPrimer = activeDoc.primers.find(
      (p) => p.bindStart < originPos && originPos <= p.bindEnd
    );
    if (splitPrimer) {
      setStatusBanner(
        `Set Origin: base ${originPos} lies inside the binding site of primer "${splitPrimer.name}" (${splitPrimer.bindStart}..${splitPrimer.bindEnd}). Choose an origin outside primer binding sites.`
      );
      return;
    }
    const rotated = setCircularOrigin(activeDoc, originPos);
    handleUpdateDocument(rotated, 'Set Origin');
    setSelectedRange({ start: 1, end: 1 });
    setStatusBanner(`Rotated circular coordinate origin of ${activeDoc.name} to base ${originPos}`);
  };

  const openSequenceAlignment = (
    subMode: AlignmentSubMode = 'msa',
    opts?: {
      msaAlgo?: MsaAlgorithmOption;
      pairwiseAlgo?: PairwiseAlgorithmOption;
    }
  ) => {
    setAlignInitialSubMode(subMode);
    if (opts?.msaAlgo) setAlignInitialMsaAlgo(opts.msaAlgo);
    if (opts?.pairwiseAlgo) setAlignInitialPairwiseAlgo(opts.pairwiseAlgo);
    setAlignCommandNonce((n) => n + 1);
    setViewerTab('sequence-alignment');
  };

  const openPhylogeneticsModule = (
    tab: PhyloModuleTab = 'phylogeny',
    opts?: {
      treeAlgo?: PhyloTreeAlgorithm;
      modelsView?: ModelsSubViewId;
      ancestralMethod?: AncestralInferenceMethod;
    }
  ) => {
    setPhyloInitialTab(tab);
    if (opts?.treeAlgo) setPhyloInitialTreeAlgo(opts.treeAlgo);
    if (opts?.modelsView) setPhyloInitialModelsView(opts.modelsView);
    if (opts?.ancestralMethod) setPhyloInitialAncestralMethod(opts.ancestralMethod);
    setPhyloCommandNonce((n) => n + 1);
    setViewerTab('phylogenetics');
  };

  const handleFetchNcbiSample = (preset: 'spike' | 'cas9') => {
    const exists = documents.find((d) => d.id === `doc-ncbi-${preset}`);
    if (exists) {
      selectDocumentWithHistory(exists.id);
      applyDocTableEvent({ kind: 'open' });
      return;
    }
    const doc = buildNcbiReferencePresetDocumentRust(preset, new Date().toISOString());
    handleAddConstruct(doc);
  };

  const detectedOs = useMemo(() => detectHostOS(), []);
  // Behaviour (native menu bar, key matching, line endings) always follows the
  // real platform. The Workflow studio's OS preview only changes how shortcut
  // labels are displayed — it used to hide the in-window menu bar on
  // Windows/Linux (no native menu exists there) and write CRLF files on macOS.
  const hostOs: SupportedOS = detectedOs;
  const displayOs: SupportedOS = previewOsOverride ?? detectedOs;
  const useNativeMacMenuBar = isNativeMacMenuBarActive(hostOs);
  nativeMacMenuBarRef.current = useNativeMacMenuBar;
  const sc = (key: string, mods?: { shift?: boolean; alt?: boolean }) =>
    formatPlatformShortcut(key, displayOs, mods);
  /** `aria-keyshortcuts` for a control whose title shows the shortcut label `sc` returns. */
  const ariaSc = (key: string, mods?: { shift?: boolean; alt?: boolean }) =>
    shortcutLabelToAriaKeyshortcuts(sc(key, mods));

  // ---------------------------------------------------------------------------
  // Unsaved-changes tracking & session-replacement guard
  // ---------------------------------------------------------------------------
  // `sessionEpoch` is bumped whenever the workbench contents become pristine
  // (fresh session, .mbc load, successful save). The effect below captures the
  // committed content references for that epoch; any later immutable update
  // makes the session read as modified.
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const sessionBaselineRef = useRef<SessionContentSnapshot | null>(null);
  const currentSessionContent: SessionContentSnapshot = {
    documents,
    deletedDocIds,
    customFolders,
    folderNames,
    folderParents,
    sessionName,
  };
  // Epoch of the captured baseline. In the render that follows
  // markSessionPristine() the baseline is not captured yet (that happens in the
  // effect below); comparing against the previous baseline then made a freshly
  // loaded/saved session read as modified until some later re-render.
  const baselineEpochRef = useRef(-1);
  useEffect(() => {
    sessionBaselineRef.current = currentSessionContent;
    baselineEpochRef.current = sessionEpoch;
    sessionHasUnsavedChangesRef.current = sessionForcedDirtyRef.current;
    // Only the epoch decides when a new baseline is taken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEpoch]);
  // Set when the session was restored from an autosave that itself held
  // unsaved edits: the restored content is not saved anywhere else yet.
  const sessionForcedDirtyRef = useRef(false);
  const autosaveRestoreWasDirtyRef = useRef(false);
  const sessionHasUnsavedChanges =
    sessionForcedDirtyRef.current ||
    (baselineEpochRef.current === sessionEpoch &&
      isSessionContentDirty(sessionBaselineRef.current, currentSessionContent));
  const sessionHasUnsavedChangesRef = useRef(sessionHasUnsavedChanges);
  sessionHasUnsavedChangesRef.current = sessionHasUnsavedChanges;
  // An autosave left by a previous run that may contain unsaved work. Until the
  // user restores or explicitly discards it, it must not be silently replaced.
  const autosavePendingRecoveryRef = useRef<boolean>(workbenchAutosaveNeedsRecovery());
  // Latest committed documents, for code that runs between renders (sequential
  // file imports in one batch) and must see ids added moments earlier.
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const allocatedDocIdsRef = useRef<Set<string>>(new Set());
  // Within one import batch: documents created/updated so far (by id) and the
  // document that later feature tracks in the batch should annotate.
  const importBatchDocsRef = useRef<Map<string, SequenceDocument>>(new Map());
  const importTargetDocIdRef = useRef<string | null>(null);
  // True only while importIncomingFilesBatch runs; outside a batch the refs
  // above are ignored so a later track never targets a stale snapshot.
  const importBatchActiveRef = useRef(false);

  /** Clear per-session history when the workbench contents are replaced. */
  const resetSessionScopedState = () => {
    setUndoStack([]);
    setRedoStack([]);
    allocatedDocIdsRef.current.clear();
  };

  const markSessionPristine = (resolvesPendingAutosave = true) => {
    if (resolvesPendingAutosave) autosavePendingRecoveryRef.current = false;
    sessionHasUnsavedChangesRef.current = false;
    sessionForcedDirtyRef.current = false;
    setSessionEpoch((e) => e + 1);
  };

  /**
   * Run `proceed` only after the user agrees to discard unsaved work (or an
   * unrecovered autosave). `actionLabel` completes the sentence
   * "… will be lost if you <actionLabel>".
   */
  const guardSessionReplacement = (
    actionLabel: string,
    proceed: () => void,
    options: { ignorePendingAutosave?: boolean } = {}
  ) => {
    const decision = decideSessionReplacement({
      hasUnsavedChanges: sessionHasUnsavedChangesRef.current,
      pendingAutosaveRecovery:
        !options.ignorePendingAutosave &&
        autosavePendingRecoveryRef.current &&
        !sessionActiveRef.current,
    });
    if (decision.kind === 'proceed') {
      proceed();
      return;
    }
    closeAllMenus();
    if (decision.kind === 'confirm-unsaved-changes') {
      setConfirmDialog({
        title: 'Unsaved Changes',
        message: `"${sessionName}" has changes that have not been saved. They will be lost if you ${actionLabel}.`,
        confirmLabel: 'Discard Changes',
        destructive: true,
        onConfirm: () => {
          // The user explicitly discarded the in-memory work; the current content
          // becomes the baseline so a follow-up replacement does not prompt again.
          markSessionPristine();
          proceed();
        },
        alternateLabel: 'Save Session…',
        onAlternate: () => handleExportMbcRef.current(),
      });
      return;
    }
    setConfirmDialog({
      title: 'Autosaved Session Not Restored',
      message: `An autosaved session from your previous work has not been restored. It will be replaced if you ${actionLabel}.`,
      confirmLabel: 'Discard Autosave',
      destructive: true,
      onConfirm: () => {
        autosavePendingRecoveryRef.current = false;
        proceed();
      },
      alternateLabel: 'Restore Autosave',
      onAlternate: () => handleRestoreLocalAutosaveRef.current(),
    });
  };
  // Forward references to handlers declared further down this component.
  const handleExportMbcRef = useRef<() => void>(() => {});
  const pendingNativeSessionSaveRef = useRef(false);
  const nativeOpenQueueRef = useRef<{ file: File; mode: 'replace' | 'merge' }[]>([]);
  const nativeOpenFlushTimerRef = useRef<number | null>(null);
  /** What the desktop Import Folder whose files are queued left out (BG-01M6S17Y), shown once they are imported. */
  const nativeOpenLeftOutRef = useRef<{ filesLeftOut: number; filesRead: number } | null>(null);
  const handleRestoreLocalAutosaveRef = useRef<() => void>(() => {});

  // The one right-hand inspector (D0060): the Sequence tab's own controls, or the settings a studio
  // in the viewer claims it for. A tab with neither has nothing to set, so it shows no inspector
  // button and its toggle changes nothing.
  const sequenceInspectorTab = viewerTab === 'sequence-view' && !isContigSummaryRecord(activeDoc);
  const inspectorAvailable = sessionActive && (sequenceInspectorTab || inspectorClaims.shared || inspectorClaims.own);
  const inspectorVisible = inspectorAvailable && rightPanelOpen;
  /** App draws the column for the Sequence controls or shared sections; a studio with its own panel draws that. */
  const inspectorColumnShown = inspectorVisible && (sequenceInspectorTab || inspectorClaims.shared);

  // Shared availability context for the declarative command rules
  // (src/core/commandAvailability.ts). Menus use isCommandEnabled() for their
  // disabled state; handlers call ensureCommandAvailable() so shortcuts, the
  // native menu and context menus obey exactly the same rule.
  const buildCommandContext = (doc: SequenceDocument = activeDoc): CommandContext => ({
    sessionActive,
    activeDoc: buildCommandDocumentContext(doc),
    selection:
      doc.id === activeDoc.id && selectedRange
        ? { start: selectedRange.start, end: selectedRange.end }
        : null,
    undoDepth: undoStack.length,
    redoDepth: redoStack.length,
    structureDocumentCount: activeNonDeletedDocs.filter(hasStructure).length,
    inspectorAvailable,
  });
  const isCommandEnabled = (id: CommandId | WorkbenchCommandId, doc?: SequenceDocument): boolean =>
    commandAvailability(id, buildCommandContext(doc)).enabled;
  const commandDisabledReason = (id: CommandId | WorkbenchCommandId, doc?: SequenceDocument): string | undefined =>
    commandAvailability(id, buildCommandContext(doc)).reason;
  const ensureCommandAvailable = (
    id: CommandId,
    label: string,
    doc: SequenceDocument = activeDoc
  ): boolean => {
    const availability = commandAvailability(id, buildCommandContext(doc));
    if (!availability.enabled) {
      setStatusBanner(`${label}: ${availability.reason ?? 'not available right now.'}`);
      return false;
    }
    return true;
  };

  // Keep the native macOS menu bar's enabled state in step with the same
  // rules (it was previously built with every item enabled, forever).
  const nativeMenuStateKey = JSON.stringify(
    useNativeMacMenuBar && isTauriDesktopRuntime() ? buildNativeMenuState(buildCommandContext()) : null
  );
  useEffect(() => {
    const payload = JSON.parse(nativeMenuStateKey) as ReturnType<typeof buildNativeMenuState> | null;
    if (!payload) return;
    syncNativeMenuStateTauri(payload).catch((err) =>
      Logger.warn('NativeMenu', 'Could not sync native menu state', {
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }, [nativeMenuStateKey]);

  const requireActiveSession = (callback: () => void) => {
    if (!sessionActive) {
      setStatusBanner(
        'No active session — start a New Session via File › New Session or Add › New Session first.'
      );
      return;
    }
    callback();
  };

  // Existence check only: parsing the multi-MB autosave on every document
  // count change was needlessly expensive.
  const hasLocalAutosave = useMemo(
    () => hasWorkbenchLocalAutosave(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionActive, documents.length]
  );

  const closeSessionNow = () => {
    setSessionActive(false);
    setHomeViewActive(false);
    setOpenTabIds([]);
    closeAllMenus();
    setStatusBanner('Closed active session');
  };

  const handleCloseSession = () => {
    if (!sessionActiveRef.current) {
      closeSessionNow();
      return;
    }
    guardSessionReplacement('close the session', closeSessionNow);
  };

  const handleCloseDocumentTab = (docId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextTabs = openTabIds.filter((id) => id !== docId);
    if (nextTabs.length === 0) {
      handleCloseSession();
      return;
    }
    setOpenTabIds(nextTabs);
    if (activeDoc.id === docId) {
      const closedIdx = openTabIds.indexOf(docId);
      const fallbackId = nextTabs[Math.max(0, Math.min(closedIdx, nextTabs.length - 1))];
      setActiveDocId(fallbackId);
      setHomeViewActive(false);
    }
  };

  const initializeFreshBlankState = (nextSessionName: string) => {
    markSessionPristine();
    resetSessionScopedState();
    setCustomFolders([]); setFolderColors({}); setFolderNames({}); setFolderParents({});
    setHiddenFolders([]); setFavoriteFolders([]); setFavoriteDocIds([]); setReadDocIds([]);
    setSessionName(nextSessionName);
    setDocuments([]);
    setDeletedDocIds([]);
    setActiveDocId('');
    applyDocTableEvent({ kind: 'start-session', hasActiveDocument: false });
    setCheckedDocIds([]);
    setOpenTabIds([]);
    setNavHistory([]);
    setNavIndex(0);
    setSelectedFolder('All Project Files');
    setSelectedRange(null);
    setHomeViewActive(false);
  };

  const initializeFreshSampleState = (nextSessionName: string) => {
    markSessionPristine();
    resetSessionScopedState();
    setCustomFolders([]); setFolderColors({}); setFolderNames({}); setFolderParents({});
    setHiddenFolders([]); setFavoriteFolders([]); setFavoriteDocIds([]); setReadDocIds([]);
    setSessionName(nextSessionName);
    setDocuments(SAMPLE_LIBRARY);
    setDeletedDocIds([]);
    setActiveDocId(SAMPLE_LIBRARY[0].id);
    applyDocTableEvent({ kind: 'start-session', hasActiveDocument: true });
    setCheckedDocIds([SAMPLE_LIBRARY[0].id]);
    setOpenTabIds([
      SAMPLE_LIBRARY[0].id,
      SAMPLE_LIBRARY[1].id,
      SAMPLE_LIBRARY[3].id,
    ]);
    setNavHistory([SAMPLE_LIBRARY[0].id]);
    setNavIndex(0);
    setSelectedFolder('All Project Files');
    setSelectedRange({ start: 5179, end: 5898, label: 'eGFP (CDS)' });
    setHomeViewActive(false);
  };

  const handleOpenSampleDocumentFromHome = (
    sampleId: string,
    targetTab: ViewerTab = 'sequence-view'
  ) => {
    closeAllMenus();
    if (!sessionActive) {
      guardSessionReplacement('open the sample project', () =>
        openSampleDocumentFromHomeNow(sampleId, targetTab)
      );
      return;
    }
    openSampleDocumentFromHomeNow(sampleId, targetTab);
  };

  const openSampleDocumentFromHomeNow = (sampleId: string, targetTab: ViewerTab) => {
    const targetSample =
      SAMPLE_LIBRARY.find((d) => d.id === sampleId) ?? SAMPLE_LIBRARY[0];
    if (!sessionActive) {
      markSessionPristine();
      resetSessionScopedState();
      setCustomFolders([]); setFolderColors({}); setFolderNames({}); setFolderParents({});
      setHiddenFolders([]); setFavoriteFolders([]); setFavoriteDocIds([]); setReadDocIds([]);
      setSessionName('Sample_Project');
      setDocuments(SAMPLE_LIBRARY);
      setDeletedDocIds([]);
      setActiveDocId(targetSample.id);
      applyDocTableEvent({ kind: 'open' });
      setCheckedDocIds([targetSample.id]);
      setOpenTabIds([targetSample.id]);
      setNavHistory([targetSample.id]);
      setNavIndex(0);
      setSelectedFolder('All Project Files');
      setSelectedRange(
        targetSample.id === 'doc-pet28-egfp'
          ? { start: 5179, end: 5898, label: 'eGFP (CDS)' }
          : null
      );
      setSessionActive(true);
    } else {
      // Project documents open as themselves; only a real sample id may add
      // the sample (it used to fall back to the first sample for any id and
      // report its name).
      const existing = documents.find((d) => d.id === sampleId);
      const sample = sampleLibraryById.get(sampleId);
      if (!existing && !sample) {
        setStatusBanner('That document is no longer in this session.');
        return;
      }
      if (!existing && sample) {
        setDocuments((prev) => [sample, ...prev]);
      }
      const opened = existing ?? sample!;
      if (deletedIdsSet.has(opened.id)) {
        setDeletedDocIds((prev) => prev.filter((id) => id !== opened.id));
      }
      selectDocumentWithHistory(opened.id);
      applyDocTableEvent({ kind: 'open' });
      setHomeViewActive(false);
      setViewerTab(targetTab);
      const unit = opened.moleculeType === 'Protein' ? 'aa' : 'bp';
      setStatusBanner(`Opened "${opened.name}" (${opened.sequence.length.toLocaleString()} ${unit})`);
      return;
    }
    setHomeViewActive(false);
    setViewerTab(targetTab);
    setStatusBanner(`Opened "${targetSample.name}" (${targetSample.sequence.length.toLocaleString()} bp)`);
  };

  const handleLoadActionVectorPreset = (presetId: string) => {
    closeAllMenus();
    if (!sessionActive) {
      guardSessionReplacement('start a new cloning session', () =>
        loadActionVectorPresetNow(presetId)
      );
      return;
    }
    loadActionVectorPresetNow(presetId);
  };

  const loadActionVectorPresetNow = (presetId: string) => {
    const preset = CLONING_ACTION_VECTOR_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const vecDoc = buildCloningActionVectorDocument(preset);

    if (!sessionActive) {
      markSessionPristine();
      resetSessionScopedState();
      setCustomFolders([]); setFolderColors({}); setFolderNames({}); setFolderParents({});
      setHiddenFolders([]); setFavoriteFolders([]); setFavoriteDocIds([]); setReadDocIds([]);
      setDeletedDocIds([]);
      setCheckedDocIds([vecDoc.id]);
      setSessionName(`${preset.name.replace(/[^A-Za-z0-9_-]/g, '_')}_Cloning`);
      setDocuments([vecDoc, ...SAMPLE_LIBRARY.filter((d) => d.id !== vecDoc.id)]);
      setActiveDocId(vecDoc.id);
      setOpenTabIds([vecDoc.id]);
      setNavHistory([vecDoc.id]);
      setNavIndex(0);
      setSelectedFolder('All Project Files');
      setSelectedRange(null);
      setSessionActive(true);
    } else {
      const existing = documents.find((d) => d.id === vecDoc.id);
      if (existing && !deletedIdsSet.has(existing.id)) {
        // Never overwrite the user's (possibly edited) copy of the preset vector.
        selectDocumentWithHistory(existing.id);
        applyDocTableEvent({ kind: 'open' });
        setHomeViewActive(false);
        openCloningMethod(preset.cloningMethod, 'gel');
        setStatusBanner(`${preset.name} is already in this session — showing your existing copy.`);
        return;
      }
      setDocuments((prev) => [vecDoc, ...prev.filter((d) => d.id !== vecDoc.id)]);
      if (existing) {
        setDeletedDocIds((prev) => prev.filter((id) => id !== vecDoc.id));
      }
      selectDocumentWithHistory(vecDoc.id);
    }
    // In a new session or the open one, the vector is opened.
    applyDocTableEvent({ kind: 'open' });
    setHomeViewActive(false);
    openCloningMethod(preset.cloningMethod, 'gel');
    setStatusBanner(
      `Loaded ${preset.name} (${vecDoc.sequence.length.toLocaleString()} bp • ${preset.selectionMarker}) in ${preset.cloningMethod}`
    );
  };

  const resolveTargetCreationFolder = (fallback = 'Plasmids & Vectors'): string => {
    if (
      !selectedFolder ||
      selectedFolder === 'All Project Files' ||
      selectedFolder === 'Local' ||
      selectedFolder === 'Sample Documents' ||
      selectedFolder === 'Favorites' ||
      selectedFolder === 'Deleted Items'
    ) {
      return fallback;
    }
    return selectedFolder;
  };

  const createTextDocumentWithTitle = (rawTitle: string) => {
    const docTitle = rawTitle.trim() || 'Text Document';
    const targetFolder = resolveTargetCreationFolder('Plasmids & Vectors');
    const nowIso = new Date().toISOString();
    const newTextDoc: SequenceDocument = {
      id: `doc-text-${Date.now()}`,
      name: docTitle,
      accession: `TXT_${Math.floor(1000 + Math.random() * 9000)}`,
      description: 'Text document & lab notes',
      moleculeType: 'DNA',
      topology: 'linear',
      sequence: '',
      docMetadata: {
        'Document Type': 'Text Document',
        Notes: `# ${docTitle}\nCreated ${nowIso.slice(0, 16).replace('T', ' ')}`,
      },
      folder: targetFolder,
      createdAt: nowIso,
      updatedAt: nowIso,
      features: [],
      primers: [],
      history: [
        {
          id: `hist-txt-${Date.now()}`,
          timestamp: nowIso.slice(0, 16).replace('T', ' '),
          operation: 'Text Document Created',
          description: `Created text document "${docTitle}"`,
          parentIds: [],
          lengthBp: 0,
          topology: 'linear',
        },
      ],
    };
    activateImportedDocumentsInWorkspace([newTextDoc], `${docTitle}_Session`);
    setViewerTab('text-view');
    setStatusBanner(`Created text document "${docTitle}"`);
  };

  const handleCreateNewTextDocument = () => {
    closeAllMenus();
    setPromptDialog({
      title: 'New Text Document',
      label: 'Document name',
      value: 'Text Document',
      placeholder: 'Enter text document title…',
      confirmLabel: 'Create Document',
      onConfirm: (entered) => createTextDocumentWithTitle(entered),
    });
  };

  const handleCreateNewEnzymeSetDocument = () => {
    closeAllMenus();
    const targetFolder = resolveTargetCreationFolder('Cloning');
    const nowIso = new Date().toISOString();
    const newEnzDoc: SequenceDocument = {
      id: `doc-enzset-${Date.now()}`,
      name: 'Enzyme Set',
      accession: `ENZ_${Math.floor(1000 + Math.random() * 9000)}`,
      description: '0 enzymes',
      moleculeType: 'DNA',
      topology: 'circular',
      sequence: activeDoc?.sequence || SAMPLE_LIBRARY[0].sequence,
      docMetadata: {
        'Document Type': 'Enzyme Set',
        'Enzyme Names': '',
        '# Enzymes': 0,
      },
      folder: targetFolder,
      createdAt: nowIso,
      updatedAt: nowIso,
      features: [],
      primers: [],
      history: [
        {
          id: `hist-enz-${Date.now()}`,
          timestamp: nowIso.slice(0, 16).replace('T', ' '),
          operation: 'Enzyme Set Created',
          description: 'Created empty Restriction Enzyme Set (0 enzymes)',
          parentIds: [],
          lengthBp: (activeDoc?.sequence || SAMPLE_LIBRARY[0].sequence).length,
          topology: 'circular',
        },
      ],
    };
    activateImportedDocumentsInWorkspace([newEnzDoc], 'Enzyme_Set_Session');
    openHybridSubTab('enzymes-view');
    setStatusBanner('Created new Enzyme Set (0 enzymes)');
  };

  const handleImportFromClipboardAction = async () => {
    closeAllMenus();
    if (!sessionActiveRef.current) {
      guardSessionReplacement('start a new session', () => {
        void importFromClipboardNow();
      });
      return;
    }
    await importFromClipboardNow();
  };

  const importFromClipboardNow = async () => {
    setHomeViewActive(false);
    if (!sessionActiveRef.current) {
      initializeFreshBlankState('Untitled_Session');
      setViewerTab('sequence-view');
      setSessionActive(true);
    }
    let clipText = '';
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        clipText = (await navigator.clipboard.readText()) || '';
      }
    } catch {
      clipText = '';
    }
    setNewSeqInitialClipboardText(clipText);
    setNewSeqModalOpen(true);
  };

  const handleImportSampleDocuments = () => {
    closeAllMenus();
    if (!sessionActive) {
      guardSessionReplacement('open the sample documents', importSampleDocumentsNow);
      return;
    }
    importSampleDocumentsNow();
  };

  const importSampleDocumentsNow = () => {
    setHomeViewActive(false);
    if (!sessionActive) {
      initializeFreshSampleState('MolBioCraft_Sample_Session');
      setViewerTab('sequence-view');
      setSessionActive(true);
      setStatusBanner(
        `Imported Sample Documents (${SAMPLE_LIBRARY.length} documents across 12 folders)`
      );
      return;
    }
    setDocuments((prev) => {
      const existingIds = new Set(prev.map((d) => d.id));
      const missing = SAMPLE_LIBRARY.filter((s) => !existingIds.has(s.id));
      const withoutBlank = removeUntouchedLegacyStarter(prev);
      return [...withoutBlank, ...missing];
    });
    setSelectedFolder('Sample Documents');
    setSidebarOpen(true);
    setExpandedNodes((prev) => ({ ...prev, sampleDocs: true }));
    setStatusBanner(`Restored Sample Documents (${SAMPLE_LIBRARY.length} documents)`);
  };

  const handleStartNewSession = (preset: NewSessionPreset) => {
    closeAllMenus();
    // Presets that build a fresh workbench replace whatever is in memory: always
    // for Blank / Sample Library, and for the other presets when no session is
    // active (they then initialise a new one over the closed session's data).
    // Clipboard import guards itself; text documents and file imports add to (or start) a session.
    const nonReplacingPresets: NewSessionPreset[] = ['import-clipboard', 'text-doc', 'import-files'];
    const replacesWorkbench =
      preset === 'blank' ||
      preset === 'sample-library' ||
      (!sessionActive && !nonReplacingPresets.includes(preset));
    if (replacesWorkbench) {
      guardSessionReplacement('start a new session', () => startNewSessionNow(preset));
      return;
    }
    startNewSessionNow(preset);
  };

  const startNewSessionNow = (preset: NewSessionPreset) => {
    setHomeViewActive(false);

    switch (preset) {
      case 'blank': {
        initializeFreshBlankState('Untitled_Session');
        setViewerTab('sequence-view');
        setSessionActive(true);
        setStatusBanner('Started new blank workbench session');
        break;
      }
      case 'new-sequence': {
        if (!sessionActive) {
          initializeFreshBlankState('Untitled_Session');
          setViewerTab('sequence-view');
          setSessionActive(true);
        }
        setNewSeqInitialClipboardText('');
        setNewSeqModalOpen(true);
        break;
      }
      case 'import-clipboard': {
        void handleImportFromClipboardAction();
        break;
      }
      case 'vector-catalog': {
        if (!sessionActive) {
          initializeFreshBlankState('Vector_Design_Session');
          setSessionActive(true);
        }
        openVectorStudio('catalog');
        setStatusBanner(
          `Opened Vector Library (${VECTOR_CATALOG.length} Vectors) in active session`
        );
        break;
      }
      case 'vector-architect': {
        if (!sessionActive) {
          initializeFreshBlankState('Modular_Vector_Session');
          setSessionActive(true);
        }
        openVectorStudio('architect');
        setStatusBanner('Opened Modular Custom Vector Architect');
        break;
      }
      case 'twist-onboarding': {
        if (!sessionActive) {
          initializeFreshBlankState('Twist_Onboarding_Session');
          setSessionActive(true);
        }
        openVectorStudio('twist-onboarding');
        setStatusBanner('Opened Twist Custom Vector Onboarding & QC');
        break;
      }
      case 'text-doc': {
        handleCreateNewTextDocument();
        break;
      }
      case 'cloning-restriction': {
        if (!sessionActive) {
          initializeFreshSampleState('Cloning_Ligation_Session');
          setSessionActive(true);
        }
        openCloningMethod('Restriction Ligation', 'gel');
        setStatusBanner('Started Restriction & Ligation Cloning session');
        break;
      }
      case 'cloning-assembly': {
        if (!sessionActive) {
          initializeFreshSampleState('Seamless_Assembly_Session');
          setSessionActive(true);
        }
        openCloningMethod('Gibson Assembly', 'gel');
        setStatusBanner('Started Seamless DNA Assembly session');
        break;
      }
      case 'primers-crispr': {
        if (!sessionActive) {
          initializeFreshSampleState('Primers_CRISPR_Session');
          setSessionActive(true);
        }
        setViewerTab('primers-pcr');
        setStatusBanner('Started Primer, PCR & CRISPR Design session');
        break;
      }
      case 'enzyme-set': {
        handleCreateNewEnzymeSetDocument();
        break;
      }
      case 'align-task': {
        if (!sessionActive) {
          initializeFreshSampleState('Sequence_Alignment_Session');
          setSessionActive(true);
        }
        openSequenceAlignment('msa', {
          msaAlgo: 'consistency-nj',
        });
        setStatusBanner('Started Pairwise & Multiple Sequence Alignment session');
        break;
      }
      case 'phylo-task': {
        if (!sessionActive) {
          initializeFreshSampleState('Phylogenetics_Session');
          setSessionActive(true);
        }
        openPhylogeneticsModule('phylogeny', {
          treeAlgo: 'Maximum Likelihood (ML)',
        });
        setStatusBanner('Started Phylogenetic Analysis session');
        break;
      }
      case 'sanger-task': {
        if (!sessionActive) {
          initializeFreshSampleState('Sanger_Contig_Session');
          setSessionActive(true);
        }
        setViewerTab('sanger-contig');
        setStatusBanner('Started Sanger Chromatogram & Contig (.ab1) session');
        break;
      }
      case 'ngs-genomics': {
        if (!sessionActive) {
          initializeFreshSampleState('NGS_Genomics_Session');
          setSessionActive(true);
        }
        openGenomicsSuite('ngs-assembly');
        setStatusBanner('Started NGS, Genomics & 3D Structure session');
        break;
      }
      case 'pipeline-task': {
        if (!sessionActive) {
          initializeFreshSampleState('Guided_Pipeline_Session');
          setSessionActive(true);
        }
        setViewerTab('guided-pipelines');
        setStatusBanner('Started Guided Multi-Task Bio Pipeline session');
        break;
      }
      case 'import-files': {
        triggerImportFilesPicker();
        break;
      }
      case 'new-folder': {
        if (sessionActive) { handleNewFolder(explorerFolders.some((folder) => folder.id === selectedFolder) ? selectedFolder : PROJECT_ROOT); break; }
        setPromptDialog({
          title: 'New Project Folder',
          label: 'Folder name',
          value: 'Project_Constructs',
          placeholder: 'Enter project folder name…',
          confirmLabel: 'Create Folder',
          onConfirm: (entered) => {
            const cleanFolder = entered.trim() || 'Project_Constructs';
            if (!sessionActiveRef.current) {
              initializeFreshBlankState(`${cleanFolder}_Session`);
              setSessionActive(true);
            }
            setCustomFolders((prev) =>
              prev.includes(cleanFolder) ? prev : [...prev, cleanFolder]
            );
            setSidebarOpen(true);
            setExpandedNodes((prev) => ({ ...prev, local: true }));
            setSelectedFolder(cleanFolder);
            setViewerTab('sequence-view');
            setStatusBanner(`Created folder "${cleanFolder}" in active session`);
          },
        });
        break;
      }
      case 'sample-library': {
        initializeFreshSampleState('MolBioCraft_Sample_Session');
        setViewerTab('sequence-view');
        setSessionActive(true);
        setStatusBanner(
          'Started new session with MolBioCraft Sample Library (12 constructs)'
        );
        break;
      }
    }
  };

  // Universal Quick Command Palette shortcut (⌘K on macOS; Ctrl+K on Windows/Linux)
  useEffect(() => {
    const onCmdK = (e: KeyboardEvent) => {
      if (!isPlatformPrimaryModifier(e, hostOs)) return;
      if (e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setCommandPaletteQuery('');
        setCommandPaletteIdx(0);
        setCommandPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onCmdK);
    return () => window.removeEventListener('keydown', onCmdK);
  }, [hostOs]);

  // Pointer drag listener for interactive Project Explorer sidebar resizing.
  // Pointer moves are coalesced to one write per animation frame and applied directly to the
  // CSS custom property on the few elements that consume it (registered with `inherits: false`
  // in App.css), so dragging no longer re-renders the entire workbench tree per pointer event.
  // React state is committed once on release.
  useEffect(() => {
    if (!sidebarDragging) return;
    const root = workbenchRootRef.current;
    const targets: HTMLElement[] = root
      ? [root, ...Array.from(root.querySelectorAll<HTMLElement>('.sidebar-aligned, .mbc-main-split'))]
      : [];
    let pendingW = sidebarDragRef.current.startW;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const value = `${pendingW}px`;
      for (const el of targets) el.style.setProperty('--mbc-sidebar-width', value);
    };
    const onMove = (ev: PointerEvent) => {
      if (!sidebarDragRef.current.active) return;
      if (
        sidebarDragRef.current.pointerId !== -1 &&
        ev.pointerId !== sidebarDragRef.current.pointerId
      ) {
        return;
      }
      const dx = ev.clientX - sidebarDragRef.current.startX;
      pendingW = Math.max(190, Math.min(420, Math.round(sidebarDragRef.current.startW + dx)));
      if (raf === 0) raf = requestAnimationFrame(apply);
    };
    const finishDrag = () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      apply();
      sidebarDragRef.current.active = false;
      sidebarDragRef.current.pointerId = -1;
      setSidebarWidthPx(pendingW);
      setSidebarDragging(false);
    };
    const onUp = (ev: PointerEvent) => {
      if (
        sidebarDragRef.current.pointerId !== -1 &&
        ev.pointerId !== sidebarDragRef.current.pointerId
      ) {
        return;
      }
      finishDrag();
    };
    const onBlur = () => {
      finishDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('lostpointercapture', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('lostpointercapture', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [sidebarDragging]);

  // Pointer drag listener for the Inspector pane edge. The inspector grows leftwards,
  // so the drag delta is negated; otherwise this mirrors the sidebar resizer exactly --
  // frame-coalesced CSS variable writes while dragging, React state committed on release.
  useEffect(() => {
    if (!inspectorDragging) return;
    const root = workbenchRootRef.current;
    const targets: HTMLElement[] = root
      ? Array.from(root.querySelectorAll<HTMLElement>('.mbc-viewer-body-split'))
      : [];
    let pendingW = inspectorDragRef.current.startW;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const value = `${pendingW}px`;
      for (const el of targets) el.style.setProperty('--mbc-inspector-width', value);
    };
    const onMove = (ev: PointerEvent) => {
      if (!inspectorDragRef.current.active) return;
      if (
        inspectorDragRef.current.pointerId !== -1 &&
        ev.pointerId !== inspectorDragRef.current.pointerId
      ) {
        return;
      }
      const dx = inspectorDragRef.current.startX - ev.clientX;
      pendingW = Math.max(
        INSPECTOR_MIN_PX,
        Math.min(INSPECTOR_MAX_PX, Math.round(inspectorDragRef.current.startW + dx))
      );
      if (raf === 0) raf = requestAnimationFrame(apply);
    };
    const finishDrag = () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      apply();
      inspectorDragRef.current.active = false;
      inspectorDragRef.current.pointerId = -1;
      setInspectorWidthPx(pendingW);
      setInspectorDragging(false);
    };
    const onUp = (ev: PointerEvent) => {
      if (
        inspectorDragRef.current.pointerId !== -1 &&
        ev.pointerId !== inspectorDragRef.current.pointerId
      ) {
        return;
      }
      finishDrag();
    };
    const onBlur = () => {
      finishDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('lostpointercapture', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('lostpointercapture', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [inspectorDragging]);

  // Pointer drag listener for interactive Workspace Table / Viewer Split Divider
  // (same frame-coalesced, commit-on-release strategy as the sidebar resizer).
  useEffect(() => {
    if (!workspacePaneDragging) return;
    const root = workbenchRootRef.current;
    const st0 = workspacePaneDragRef.current;
    const varName = st0.mode === 'top-bottom' ? '--mbc-doc-table-h' : '--mbc-split-left-w';
    const targets: HTMLElement[] = root
      ? Array.from(
          root.querySelectorAll<HTMLElement>(
            st0.mode === 'top-bottom' ? '.mbc-doc-table-pane' : '.mbc-center-stack'
          )
        )
      : [];
    let pending = st0.startSize;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const value = `${pending}px`;
      for (const el of targets) el.style.setProperty(varName, value);
    };
    const onMove = (ev: PointerEvent) => {
      const st = workspacePaneDragRef.current;
      if (!st.active) return;
      if (st.pointerId !== -1 && ev.pointerId !== st.pointerId) return;
      if (st.mode === 'top-bottom') {
        // The stacked layout's handle sits above the table (US-01M6S7T2): dragging it up grows the table.
        const dy = ev.clientY - st.startPos;
        pending = Math.max(115, Math.min(460, Math.round(st.startSize - dy)));
      } else {
        const dx = ev.clientX - st.startPos;
        pending = Math.max(270, Math.min(680, Math.round(st.startSize + dx)));
      }
      if (raf === 0) raf = requestAnimationFrame(apply);
    };
    const finishPaneDrag = () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      apply();
      const mode = workspacePaneDragRef.current.mode;
      workspacePaneDragRef.current.active = false;
      workspacePaneDragRef.current.pointerId = -1;
      if (mode === 'top-bottom') {
        setDocTableHeightPx(pending);
      } else {
        setDocTableWidthPx(pending);
      }
      setWorkspacePaneDragging(false);
    };
    const onUp = (ev: PointerEvent) => {
      const st = workspacePaneDragRef.current;
      if (st.pointerId !== -1 && ev.pointerId !== st.pointerId) return;
      finishPaneDrag();
    };
    const onBlur = () => {
      finishPaneDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('lostpointercapture', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('lostpointercapture', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [workspacePaneDragging]);

  // Workspace persistence: remember pane geometry across launches (UI-only preference,
  // independent of session documents).
  useEffect(() => {
    if (sidebarDragging || inspectorDragging || workspacePaneDragging) return;
    savePersistedWorkspaceLayout({
      sidebarWidthPx,
      inspectorWidthPx,
      docTableHeightPx,
      docTableWidthPx,
    });
  }, [
    sidebarWidthPx,
    inspectorWidthPx,
    docTableHeightPx,
    docTableWidthPx,
    sidebarDragging,
    inspectorDragging,
    workspacePaneDragging,
  ]);

  const commandPaletteItems = useMemo(() => {
    const items: {
      id: string;
      label: string;
      category: string;
      hint: string;
      run: () => void;
    }[] = [
      {
        id: 'edit-undo',
        label:
          undoStack.length > 0
            ? `Undo: ${undoStack[undoStack.length - 1].label} (${undoStack[undoStack.length - 1].prevDoc.name})`
            : 'Undo Last Sequence / Annotation Edit',
        category: 'Edit History',
        hint: sc('Z'),
        run: () => handleUndoDocumentEdit(),
      },
      {
        id: 'edit-redo',
        label:
          redoStack.length > 0
            ? `Redo: ${redoStack[redoStack.length - 1].label} (${redoStack[redoStack.length - 1].nextDoc.name})`
            : 'Redo Sequence / Annotation Edit',
        category: 'Edit History',
        hint: sc('Z', { shift: true }),
        run: () => handleRedoDocumentEdit(),
      },
      {
        id: 'bench-genome-500k',
        label: 'Load 500,000 bp Annotated Chromosome (benchmark)',
        category: 'Large Genome',
        hint: '500 kbp',
        run: () => handleLoadBenchmarkDocument('genome-500k'),
      },
      {
        id: 'bench-protein-10k',
        label: 'Load 10,000 aa Multi-Domain Polyprotein (benchmark)',
        category: 'Giant Protein',
        hint: '10k aa',
        run: () => handleLoadBenchmarkDocument('protein-10k'),
      },
      {
        id: 'nav-seq-view',
        label: 'Open Sequence View (Circular Map + Resident Linear Viewer)',
        category: 'Studio',
        hint: 'View',
        run: () => {
          if (!sessionActive) handleStartNewSession('sample-library');
          else setViewerTab('sequence-view');
        },
      },
      {
        id: 'nav-protein-3d',
        label: 'Open Interactive 3D Protein Structure Viewer (Kabsch Superposition)',
        category: '3D Structure',
        hint: '3D Canvas',
        run: () => {
          if (!sessionActive) handleStartNewSession('ngs-genomics');
          openGenomicsSuite('protein-3d');
        },
      },
      {
        id: 'nav-cloning',
        label: 'Open Cloning & Agarose Gel Physics Studio (10 Methods)',
        category: 'Studio',
        hint: 'Cloning',
        run: () => {
          if (!sessionActive) handleStartNewSession('cloning-restriction');
          else setViewerTab('cloning-gel');
        },
      },
      {
        id: 'nav-align',
        label: 'Open Sequence Alignment Studio (MSA, Needleman-Wunsch & Smith-Waterman)',
        category: 'Studio',
        hint: 'MSA / NW / SW',
        run: () => {
          if (!sessionActive) handleStartNewSession('align-task');
          else setViewerTab('sequence-alignment');
        },
      },
      {
        id: 'nav-phylo',
        label: 'Open Phylogenetic Analysis Studio (ML, NJ, Robinson-Foulds)',
        category: 'Studio',
        hint: 'Tree',
        run: () => {
          if (!sessionActive) handleStartNewSession('phylo-task');
          else setViewerTab('phylogenetics');
        },
      },
      {
        id: 'a11y-colorblind',
        label: 'Switch Nucleotide Palette to Okabe-Ito Colorblind-Safe (Underline Cues)',
        category: 'Accessibility',
        hint: 'Okabe-Ito',
        run: () => {
          setColorScheme('colorblind-safe');
          setStatusBanner('Enabled Okabe-Ito Colorblind-Safe nucleotide palette with underline cues');
        },
      },
      {
        id: 'theme-toggle',
        label: `Toggle Appearance Theme (Currently ${darkMode ? 'Dark' : 'Light'})`,
        category: 'Appearance',
        hint: darkMode ? 'Light' : 'Dark',
        run: () => handleQuickThemeToggle(),
      },
    ];

    for (const d of activeNonDeletedDocs.slice(0, 16)) {
      items.push({
        id: `doc-${d.id}`,
        label: `${d.name} (${d.accession})`,
        category: d.moleculeType,
        hint: `${d.sequence.length.toLocaleString()} ${d.moleculeType === 'Protein' ? 'aa' : 'bp'}`,
        run: () => {
          setSessionActive(true);
          selectDocumentWithHistory(d.id);
          applyDocTableEvent({ kind: 'open' });
        },
      });
    }

    const q = commandPaletteQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        it.hint.toLowerCase().includes(q)
    );
  }, [
    activeNonDeletedDocs,
    commandPaletteQuery,
    darkMode,
    sessionActive,
    undoStack,
    redoStack,
    hostOs,
  ]);

  const headerSearchMatches = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q) return [];

    const candidates: {
      id: string;
      label: string;
      category: string;
      hint: string;
      run: () => void;
    }[] = [
      {
        id: 'hs-new-seq',
        label: 'New Sequence',
        category: 'Tool',
        hint: sc('N'),
        run: () => handleStartNewSession('new-sequence'),
      },
      {
        id: 'hs-import-seq',
        label: 'Import Sequence Files',
        category: 'Import',
        hint: `.gb / .fasta / .ab1 • ${sc('I')}`,
        run: () => triggerImportFilesPicker(),
      },
      {
        id: 'hs-seq-view',
        label: 'Sequence View',
        category: 'Studio',
        hint: 'Circular Map / Linear',
        run: () => {
          if (!sessionActive) handleStartNewSession('sample-library');
          else {
            setHomeViewActive(false);
            setViewerTab('sequence-view');
          }
        },
      },
      {
        id: 'hs-cloning',
        label: 'Cloning & Gel Studio',
        category: 'Studio',
        hint: 'Gibson / Golden Gate / Gateway / TOPO',
        run: () => {
          if (!sessionActive) handleStartNewSession('cloning-restriction');
          else {
            setHomeViewActive(false);
            setViewerTab('cloning-gel');
          }
        },
      },
      {
        id: 'hs-primers',
        label: 'Primers & CRISPR Studio',
        category: 'Studio',
        hint: 'PCR / CRISPR',
        run: () => {
          if (!sessionActive) handleStartNewSession('primers-crispr');
          else {
            setHomeViewActive(false);
            setViewerTab('primers-pcr');
          }
        },
      },
      {
        id: 'hs-align',
        label: 'Sequence Alignment Studio',
        category: 'Studio',
        hint: 'MAFFT-style / Clustal-style / NW / SW',
        run: () => {
          if (!sessionActive) handleStartNewSession('align-task');
          else {
            setHomeViewActive(false);
            setViewerTab('sequence-alignment');
          }
        },
      },
      {
        id: 'hs-phylo',
        label: 'Phylogenetics Studio',
        category: 'Studio',
        hint: 'ML / NJ / Bayesian / RSCU',
        run: () => {
          if (!sessionActive) handleStartNewSession('phylo-task');
          else {
            setHomeViewActive(false);
            setViewerTab('phylogenetics');
          }
        },
      },
      {
        id: 'hs-blast',
        label: 'BLAST Search',
        category: 'Tool',
        hint: 'BLAST',
        run: () => {
          if (!sessionActive) handleStartNewSession('sample-library');
          setBlastModalOpen(true);
        },
      },
      {
        id: 'hs-vectors',
        label: 'Vector Catalog',
        category: 'Studio',
        hint: `${VECTOR_CATALOG.length} Vectors & Architect`,
        run: () => {
          if (!sessionActive) handleStartNewSession('sample-library');
          openVectorStudio('catalog');
        },
      },
      {
        id: 'hs-sanger',
        label: 'Sanger Chromatogram Studio',
        category: 'Studio',
        hint: '.ab1 / .scf Contigs',
        run: () => {
          if (!sessionActive) handleStartNewSession('sanger-task');
          else {
            setHomeViewActive(false);
            setViewerTab('sanger-contig');
          }
        },
      },
      {
        id: 'hs-protein-3d',
        label: '3D Protein Viewer',
        category: '3D Structure',
        hint: 'PDB / mmCIF / Kabsch',
        run: () => {
          if (!sessionActive) handleStartNewSession('ngs-genomics');
          openGenomicsSuite('protein-3d');
        },
      },
      {
        id: 'hs-workflows',
        label: 'Guided Pipelines',
        category: 'Workflows',
        hint: 'Pipelines',
        run: () => {
          if (!sessionActive) handleStartNewSession('sample-library');
          setHomeViewActive(false);
          setViewerTab('guided-pipelines');
        },
      },
      {
        id: 'hs-prefs',
        label: 'Preferences',
        category: 'Settings',
        hint: sc(','),
        run: () => setPrefsModalTab('General'),
      },
      {
        id: 'hs-examples',
        label: 'Load Example Data…',
        category: 'Help',
        hint: 'Microsatellite runs, grouped alignment, gene/species trees, supported tree',
        run: () => { setHomeViewActive(false); setOperationDialog({ kind: 'examples' }); },
      },
      {
        id: 'hs-wf-manage',
        label: 'Manage Workflows…',
        category: 'Workflows',
        hint: 'Create, edit, import or export workflows',
        run: () => { setHomeViewActive(false); setManageWorkflowsOpen(true); },
      },
      {
        id: 'hs-wf-run',
        label: 'Run Workflow…',
        category: 'Workflows',
        hint: 'Run a saved workflow on the selection',
        run: () => { setHomeViewActive(false); setRunWorkflowFor({}); },
      },
      ...[
        { id: 'plugin-euk-gene-predictor', label: 'Eukaryotic Gene Predictor', hint: 'Bioinformatics Plugin • Exons & Kozak' },
        { id: 'plugin-microbial-gene-predictor', label: 'Microbial Gene Predictor', hint: 'Bioinformatics Plugin • Shine-Dalgarno RBS' },
        { id: 'plugin-crispr-repeat-arrays', label: 'CRISPR Repeat Array Finder', hint: 'Bioinformatics Plugin • Direct Repeats & Spacers' },
        { id: 'plugin-tandem-repeat-finder', label: 'Microsatellite & Tandem Repeats', hint: 'Bioinformatics Plugin • STR / VNTR Scanner' },
        { id: 'plugin-haplotype-partitioner', label: 'Haplotype & Allele Partitioner', hint: 'Bioinformatics Plugin • Hd & Segregating Sites' },
        { id: 'plugin-taxonomic-classifier', label: 'Taxonomic Sequence Classifier', hint: 'Bioinformatics Plugin • k-mer & CpG/UpA' },
        { id: 'plugin-species-delimitation', label: 'Species Delimitation', hint: 'Bioinformatics Plugin • Barcode Gap & P(RD)' },
        { id: 'plugin-protein-domains-epitopes', label: 'Protein Domains & Epitopes', hint: 'Bioinformatics Plugin • PROSITE, GOR IV & Kolaskar' },
        { id: 'plugin-transmembrane-topology', label: 'Transmembrane & Signal Topology', hint: 'Bioinformatics Plugin • TM Helices & Signal Peptide' },
        { id: 'plugin-adapter-quality-trimmer', label: 'Adapter & Quality Read Trimmer', hint: 'Bioinformatics Plugin • Adapter & Mott Trimming' },
        { id: 'plugin-genome-synteny-blocks', label: 'Whole-Genome Synteny Blocks', hint: 'Bioinformatics Plugin • LCB Anchors & Inversions' },
        { id: 'plugin-hpc-phylogeny-script', label: 'HPC Phylogeny Job Builder', hint: 'Bioinformatics Plugin • PHYLIP + Slurm Script' },
        { id: 'plugin-external-cli-suite', label: 'External CLI Suite', hint: 'Bioinformatics Plugin • Reproducible Shell Commands' },
      ].map((p) => ({
        id: `hs-${p.id}`,
        label: p.label,
        category: 'Bioinformatics Plugins',
        hint: p.hint,
        run: () => {
          if (!sessionActive) handleStartNewSession('sample-library');
          openPluginTool(p.id);
        },
      })),
      // Every operation options window (Multiple Alignment…, Find ORFs…, …).
      ...(Object.keys(OPERATION_LABELS) as OperationId[]).map((op) => ({
        id: `hs-op-${op}`,
        label: `${OPERATION_LABELS[op]}…`,
        category: 'Operation',
        hint: opShortcuts.shortcuts[op] ? formatShortcut(opShortcuts.shortcuts[op]!, IS_MAC_PLATFORM) : 'Options window',
        run: () => {
          setHomeViewActive(false);
          openOperationRef.current(op);
        },
      })),
    ];

    const searchableDocs = sessionActive ? activeNonDeletedDocs : SAMPLE_LIBRARY;
    for (const d of searchableDocs) {
      candidates.push({
        id: `hs-doc-${d.id}`,
        label: d.name,
        category: 'File',
        hint: `${d.accession} • ${d.sequence.length.toLocaleString()} ${
          d.moleculeType === 'Protein' ? 'aa' : 'bp'
        }`,
        run: () => {
          if (!sessionActive) {
            setSessionActive(true);
          }
          setHomeViewActive(false);
          setOpenTabIds((prev) => (prev.includes(d.id) ? prev : [...prev, d.id]));
          selectDocumentWithHistory(d.id);
          applyDocTableEvent({ kind: 'open' });
          if (d.chromatogram) {
            setViewerTab('sanger-contig');
          }
        },
      });
    }

    return candidates
      .filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q) ||
          it.hint.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [globalSearchQuery, sessionActive, activeNonDeletedDocs, hostOs, opShortcuts]);

  // Cross-platform global keyboard shortcuts (Cmd ⌘ on macOS; Ctrl on Windows & Linux)
  const primaryShortcutHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  primaryShortcutHandlerRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (!isPlatformPrimaryModifier(e, hostOs)) return;
    const k = e.key.toLowerCase();

    // Document-level Undo (⌘Z / Ctrl+Z) & Redo (⇧⌘Z / Ctrl+Y)
    if (k === 'z' && !e.shiftKey && !e.altKey) {
      if (sessionActive && undoStack.length > 0) {
        e.preventDefault();
        handleUndoDocumentEdit();
      }
      return;
    }
    if ((k === 'z' && e.shiftKey && !e.altKey) || (k === 'y' && !e.shiftKey && !e.altKey)) {
      if (sessionActive && redoStack.length > 0) {
        e.preventDefault();
        handleRedoDocumentEdit();
      }
      return;
    }

    if (useNativeMacMenuBar) return;

    if (k === 'n' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      handleStartNewSession('new-sequence');
    } else if (k === 'n' && !e.shiftKey && e.altKey) {
      e.preventDefault();
      handleStartNewSession('blank');
    } else if (k === 'n' && e.shiftKey && !e.altKey) {
      e.preventDefault();
      handleStartNewSession('new-folder');
    } else if (k === 'w' && e.shiftKey && !e.altKey) {
      e.preventDefault();
      handleCloseSession();
    } else if (k === 'p' && e.shiftKey && !e.altKey) {
      e.preventDefault();
      setPrefsModalTab('General');
    } else if (k === ',' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      setPrefsModalTab('General');
    } else if (k === 'y' && e.shiftKey && !e.altKey) {
      e.preventDefault();
      requireActiveSession(() => setViewerTab('guided-pipelines'));
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => primaryShortcutHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const buildCurrentMbcSnapshot = (overrideName?: string): MbcWorkbenchSnapshot => ({
    sessionName: (overrideName ?? sessionName).trim() || 'MolBioCraft_Workbench',
    documents,
    workspace: {
      activeDocId: documents.some((doc) => doc.id === activeDocId) ? activeDocId : '',
      selectedFolder,
      projectExplorer: { customFolders, folderColors, folderNames, folderParents, hiddenFolders, favoriteFolders, favoriteDocIds, deletedDocIds, readDocIds },
      navHistory,
      navIndex,
      viewerTab,
      mapLayoutMode,
      zoomLevel,
      textFormat,
      colorScheme,
      darkMode,
      sidebarOpen,
      docTableCollapsed,
      selectedRange,
      displaySettings: {
        showOrfs,
        minOrfAa,
        allowAltStartCodons,
        showPrimers,
        showTranslation,
        showGcGraph,
        showHydropathyGraph,
        showUniqueCuttersOnly,
      },
    },
  });

  const latestSnapshotRef = useRef<() => MbcWorkbenchSnapshot>(buildCurrentMbcSnapshot);
  latestSnapshotRef.current = buildCurrentMbcSnapshot;

  const executeConfirmedAppQuit = (dontAskAgain: boolean) => {
    if (dontAskAgain) {
      applyConfirmBeforeQuitPreference(false);
    }
    if (sessionActive && !autosavePendingRecoveryRef.current) {
      if (saveWorkbenchToLocalAutosave(latestSnapshotRef.current())) {
        writeWorkbenchAutosaveDirtyFlag(sessionHasUnsavedChangesRef.current);
      }
    }
    setConfirmQuitModalOpen(false);
    const handledNatively = performNativeAppQuit();
    if (!handledNatively) {
      quitApprovedBrowserRef.current = true;
      closeSessionNow();
      if (typeof window !== 'undefined' && typeof window.close === 'function') {
        try {
          window.close();
        } catch {
          // Ignore browser restrictions on closing non-script-opened tabs
        }
      }
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          quitApprovedBrowserRef.current = false;
        }, 250);
      }
    }
  };

  const handleRequestAppQuit = () => {
    closeAllMenus();
    // The quit-time autosave is skipped while an older, unrecovered autosave
    // exists (it must not be overwritten), so unsaved work would be lost
    // silently. Ask instead, regardless of the "confirm before quitting" option.
    if (sessionActive && sessionHasUnsavedChangesRef.current && autosavePendingRecoveryRef.current) {
      setConfirmDialog({
        title: 'Quit Without Saving?',
        message: `"${sessionName}" has unsaved changes, and they cannot be autosaved because an earlier autosaved session has not been restored. Save the session first, or quit and lose these changes (the earlier autosave is kept).`,
        confirmLabel: 'Quit Without Saving',
        destructive: true,
        onConfirm: () => executeConfirmedAppQuit(false),
        alternateLabel: 'Save Session…',
        onAlternate: () => handleExportMbcRef.current(),
      });
      return;
    }
    if (confirmBeforeQuit) {
      setConfirmQuitModalOpen(true);
    } else {
      executeConfirmedAppQuit(false);
    }
  };

  // Standard web browser unload guard when running outside native Tauri/Cocoa desktop wrappers
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const g = globalThis as unknown as { __MBC_MACOS_APP_BUNDLE__?: boolean };
    if (isTauriDesktopRuntime() || g.__MBC_MACOS_APP_BUNDLE__) return;
    if (!confirmBeforeQuit || !sessionActive) return;

    const handleBeforeUnload = (ev: BeforeUnloadEvent) => {
      if (quitApprovedBrowserRef.current) return;
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [confirmBeforeQuit, sessionActive]);

  // Automatically keep a local autosave draft in localStorage only while a session is active
  const autosaveFailureReportedRef = useRef(false);
  const autosavePausedReportedRef = useRef(false);
  useEffect(() => {
    if (!sessionActive) return;
    const timer = window.setTimeout(() => {
      if (autosavePendingRecoveryRef.current) {
        // Never overwrite an unrecovered autosave from a previous run; the user
        // must restore or explicitly discard it first.
        if (!autosavePausedReportedRef.current) {
          autosavePausedReportedRef.current = true;
          setStatusBanner(
            'Autosave paused: an earlier autosaved session has not been restored. Use File › Restore Autosave, or start a New Session to discard it.'
          );
        }
        return;
      }
      if (saveWorkbenchToLocalAutosave(latestSnapshotRef.current())) {
        writeWorkbenchAutosaveDirtyFlag(sessionHasUnsavedChangesRef.current);
        autosaveFailureReportedRef.current = false;
      } else if (!autosaveFailureReportedRef.current) {
        // Typically the browser storage quota (~5 MB) is exceeded by large sessions.
        autosaveFailureReportedRef.current = true;
        setStatusBanner(
          'Autosave failed (session too large for local storage). Save the session with File › Save Session to keep your work.'
        );
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    sessionActive,
    sessionName,
    documents,
    customFolders, folderColors, folderNames, folderParents, hiddenFolders, favoriteFolders, favoriteDocIds, deletedDocIds, readDocIds,
    activeDoc.id,
    selectedFolder,
    navIndex,
    viewerTab,
    mapLayoutMode,
    zoomLevel,
    textFormat,
    colorScheme,
    darkMode,
    sidebarOpen,
    docTableCollapsed,
    selectedRange,
    showOrfs,
    minOrfAa,
    allowAltStartCodons,
    showPrimers,
    showTranslation,
    showGcGraph,
    showHydropathyGraph,
    showUniqueCuttersOnly,
  ]);

  const applyParsedMbcSession = (
    rawText: string,
    sourceLabel: string,
    mode: 'replace' | 'merge' = 'replace',
    options: { isAutosaveRestore?: boolean } = {}
  ) => {
    if (mode === 'replace' || !sessionActiveRef.current) {
      // Validate before asking: a corrupt file must not cost the user a prompt
      // (or their current session). parseMbcWorkbench throws on invalid input.
      parseMbcWorkbench(rawText, sourceLabel.replace(/\.mbc$/i, '') || 'MolBioCraft_Workbench');
      guardSessionReplacement(
        `open "${sourceLabel}"`,
        () => applyParsedMbcSessionNow(rawText, sourceLabel, mode, options),
        { ignorePendingAutosave: options.isAutosaveRestore }
      );
      return;
    }
    applyParsedMbcSessionNow(rawText, sourceLabel, mode, options);
  };

  const applyParsedMbcSessionNow = (
    rawText: string,
    sourceLabel: string,
    mode: 'replace' | 'merge',
    options: { isAutosaveRestore?: boolean }
  ) => {
    const fallbackName = sourceLabel.replace(/\.mbc$/i, '') || 'MolBioCraft_Workbench';
    const parsed = parseMbcWorkbench(rawText, fallbackName);
    const env = parsed.envelope;
    const restoredDocuments = removeUntouchedLegacyStarter(env.documents);
    const restoredIds = new Set(restoredDocuments.map((doc) => doc.id));
    const restoredActiveId = restoredIds.has(env.workspace.activeDocId)
      ? env.workspace.activeDocId : restoredDocuments[0]?.id ?? '';

    if (mode === 'merge' && sessionActive) {
      const existingIds = new Set(documents.map((d) => d.id));
      const mergedIncoming = restoredDocuments.map((d) =>
        existingIds.has(d.id)
          ? { ...d, id: `${d.id}-mbc-${Date.now().toString(36)}` }
          : d
      );
      setDocuments((prev) => [...mergedIncoming, ...removeUntouchedLegacyStarter(prev)]);
      if (mergedIncoming[0]) {
        selectDocumentWithHistory(mergedIncoming[0].id);
        applyDocTableEvent({ kind: 'import' });
      }
      setStatusBanner(
        `Merged ${mergedIncoming.length} sequence ${
          mergedIncoming.length === 1 ? 'document' : 'documents'
        } from "${env.sessionName}.mbc"`
      );
      return;
    }

    // A freshly opened file is the saved state. A restored autosave is not:
    // it may hold edits that were never written to a .mbc file.
    markSessionPristine();
    resetSessionScopedState();
    if (options.isAutosaveRestore && autosaveRestoreWasDirtyRef.current) {
      sessionForcedDirtyRef.current = true;
    }
    const explorer = normalizeProjectExplorer(env.workspace.projectExplorer);
    setCustomFolders(explorer?.customFolders ?? []);
    setFolderColors(explorer?.folderColors ?? {});
    setFolderNames(explorer?.folderNames ?? {});
    setFolderParents(explorer?.folderParents ?? {});
    setHiddenFolders(explorer?.hiddenFolders ?? []);
    setFavoriteFolders(explorer?.favoriteFolders ?? []);
    setFavoriteDocIds(explorer?.favoriteDocIds ?? []);
    setDeletedDocIds(explorer?.deletedDocIds ?? []);
    setReadDocIds(explorer?.readDocIds ?? []);
    setSessionName(env.sessionName);
    setDocuments(restoredDocuments);
    setActiveDocId(restoredActiveId);
    setCheckedDocIds(restoredActiveId ? [restoredActiveId] : []);
    setOpenTabIds([
      ...(restoredActiveId ? [restoredActiveId] : []),
      ...restoredDocuments
        .slice(0, 2)
        .map((d) => d.id)
        .filter((id) => id !== restoredActiveId),
    ]);
    setSelectedFolder(
      env.workspace.selectedFolder === 'Sample Documents' ||
        env.workspace.selectedFolder === 'Local'
        ? 'All Project Files'
        : env.workspace.selectedFolder
    );
    const restoredHistory = env.workspace.navHistory.filter((id) => restoredIds.has(id));
    if (restoredActiveId && !restoredHistory.includes(restoredActiveId)) restoredHistory.push(restoredActiveId);
    setNavHistory(restoredHistory);
    setNavIndex(Math.max(0, restoredHistory.indexOf(restoredActiveId)));
    setViewerTab(env.workspace.viewerTab);
    setMapLayoutMode(env.workspace.mapLayoutMode);
    setZoomLevel(clampSequenceZoom(env.workspace.zoomLevel));
    setTextFormat(env.workspace.textFormat);
    // Checked here as importing a preferences file checks it: a scheme that is not a known nucleotide
    // scheme opens in the default ('standard'), whatever the session parser let through.
    setColorScheme(
      NUCLEOTIDE_COLOR_SCHEMES.includes(env.workspace.colorScheme) ? env.workspace.colorScheme : 'standard'
    );
    // the theme is an app preference (Preferences → Appearance), not part of a session: a session
    // saved in light mode must not switch a dark-mode app to light
    setSidebarOpen(env.workspace.sidebarOpen);
    applyDocTableEvent({ kind: 'restore-session', saved: env.workspace.docTableCollapsed });
    setSelectedRange(restoredActiveId && restoredActiveId === env.workspace.activeDocId ? env.workspace.selectedRange : null);
    setShowOrfs(env.workspace.displaySettings.showOrfs);
    setMinOrfAa(env.workspace.displaySettings.minOrfAa);
    setAllowAltStartCodons(env.workspace.displaySettings.allowAltStartCodons);
    setShowPrimers(env.workspace.displaySettings.showPrimers);
    setShowTranslation(env.workspace.displaySettings.showTranslation);
    setShowGcGraph(env.workspace.displaySettings.showGcGraph);
    setShowHydropathyGraph(env.workspace.displaySettings.showHydropathyGraph);
    setShowUniqueCuttersOnly(env.workspace.displaySettings.showUniqueCuttersOnly);
    setHomeViewActive(false);
    setSessionActive(true);

    const warnNote = parsed.warnings.length ? ` (${parsed.warnings[0]})` : '';
    setStatusBanner(
      `Restored workbench "${env.sessionName}.mbc" — ${restoredDocuments.length} documents (${restoredDocuments.reduce((total, doc) => total + doc.sequence.length, 0).toLocaleString()} bp)${warnNote}`
    );
  };

  /**
   * Hand a text export to the native save dialog or a browser download.
   * Returns 'native' when a native Save dialog was opened (completion is
   * reported asynchronously via onNativeFileSaved / onNativeFileError),
   * 'downloaded' for the browser path, or false on failure (a banner has
   * already explained the error, so callers must not announce success).
   */
  const handleDownloadFile = (
    content: string,
    filename: string,
    mimeType = 'text/plain;charset=utf-8'
  ): 'native' | 'downloaded' | false => {
    // A new export supersedes a session save whose dialog was cancelled (the
    // cancel is not always reported); session saves re-arm this after the call.
    pendingNativeSessionSaveRef.current = false;
    try {
      const validated = validateCrossPlatformFilename(sanitizeExportFilename(filename));
      const targetLineEnding = exportLineEndingFor(exportLineEndingPref, hostOs);
      const normalized = normalizeLineEndings(content, targetLineEnding);

      if (postMacosNativeSave(validated.sanitized, normalized)) {
        Logger.info('FileExport', `Opened native macOS Save panel for "${validated.sanitized}"`, {
          lineEnding: targetLineEnding,
        });
        return 'native';
      }

      const blob = new Blob([normalized], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = validated.sanitized;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      Logger.info('FileExport', `Exported "${validated.sanitized}"`, {
        lineEnding: targetLineEnding,
      });
      return 'downloaded';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error('FileExport', `Failed to export "${filename}"`, { error: msg });
      setStatusBanner(`Export failed for "${filename}": ${msg}`);
      return false;
    }
  };

  const handleDownloadBinaryFile = (
    bytes: Uint8Array,
    filename: string,
    mimeType: string = MBC_ZIP_MIME_TYPE
  ): 'native' | 'downloaded' | false => {
    // A new export supersedes a session save whose dialog was cancelled (the
    // cancel is not always reported); session saves re-arm this after the call.
    pendingNativeSessionSaveRef.current = false;
    try {
      const validated = validateCrossPlatformFilename(sanitizeExportFilename(filename));
      if (postMacosNativeSaveBinary(validated.sanitized, bytes)) {
        Logger.info('FileExport', `Opened native macOS Save panel for binary "${validated.sanitized}"`, {
          sizeBytes: bytes.byteLength,
        });
        return 'native';
      }

      const copyBuf = new Uint8Array(bytes.byteLength);
      copyBuf.set(bytes);
      const blob = new Blob([copyBuf.buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = validated.sanitized;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      Logger.info('FileExport', `Exported binary archive "${validated.sanitized}"`, {
        sizeBytes: bytes.byteLength,
      });
      return 'downloaded';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error('FileExport', `Failed to export binary archive "${filename}"`, { error: msg });
      setStatusBanner(`Export failed for "${filename}": ${msg}`);
      return false;
    }
  };

  const executeSaveMbcWorkbenchWithName = (rawName: string) => {
    const targetName = rawName.trim().replace(/\.mbc$/i, '') || 'MolBioCraft_Workbench';
    setSessionName(targetName);
    const snapshot = buildCurrentMbcSnapshot(targetName);
    const mbcPayload = serializeMbcWorkbench(snapshot);
    if (!autosavePendingRecoveryRef.current) saveWorkbenchToLocalAutosave(snapshot);
    const outcome = handleDownloadFile(mbcPayload, `${targetName}.mbc`, MBC_MIME_TYPE);
    if (!outcome) return;
    if (outcome === 'native') {
      // The session becomes "saved" only once the native dialog reports success.
      pendingNativeSessionSaveRef.current = true;
      setStatusBanner(`Choose where to save "${targetName}.mbc"…`);
      return;
    }
    markSessionPristine(false);
    // The flag describes the stored autosave; if that is still an unrecovered
    // older one (not written by this save), it must stay "needs recovery".
    if (!autosavePendingRecoveryRef.current) writeWorkbenchAutosaveDirtyFlag(false);
    setStatusBanner(
      `Saved current workbench session "${targetName}.mbc" in JSON format (${documents.length} documents)`
    );
  };

  const handleSaveMbcWorkbench = (promptForName = false) => {
    if (promptForName) {
      setPromptDialog({
        title: 'Save Workbench Session As (.mbc)',
        label: 'Session filename (.mbc JSON)',
        value: sessionName,
        placeholder: 'MolBioCraft_Workbench',
        confirmLabel: 'Save Session (.mbc)',
        onConfirm: (entered) => executeSaveMbcWorkbenchWithName(entered),
      });
      return;
    }
    executeSaveMbcWorkbenchWithName(sessionName);
  };

  const handleExportMbcJson = () => {
    const targetName = (sessionName || activeDoc.name || 'MolBioCraft_Workbench')
      .trim()
      .replace(/\.mbc$/i, '');
    const snapshot = buildCurrentMbcSnapshot(targetName);
    const jsonPayload = serializeMbcWorkbench(snapshot);
    if (!autosavePendingRecoveryRef.current) saveWorkbenchToLocalAutosave(snapshot);
    const outcome = handleDownloadFile(jsonPayload, `${targetName}.mbc`, MBC_MIME_TYPE);
    if (!outcome) return;
    if (outcome === 'native') {
      pendingNativeSessionSaveRef.current = true;
      setStatusBanner(`Choose where to save "${targetName}.mbc"…`);
      return;
    }
    markSessionPristine(false);
    // The flag describes the stored autosave; if that is still an unrecovered
    // older one (not written by this save), it must stay "needs recovery".
    if (!autosavePendingRecoveryRef.current) writeWorkbenchAutosaveDirtyFlag(false);
    setStatusBanner(
      `Exported "${targetName}.mbc" in JSON format (${snapshot.documents.length} documents)`
    );
  };
  handleExportMbcRef.current = () => handleSaveMbcWorkbench(true);

  const handleExportFolderMbc = (targetFolder = selectedFolder) => {
    const docsToExport = getDocsForFolderView(targetFolder);
    const exportFolderLabel =
      targetFolder && targetFolder !== 'All Project Files'
        ? folderLabel(targetFolder)
        : sessionName || 'MolBioCraft_Folder';
    const cleanLabel =
      exportFolderLabel.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_') || 'MolBioCraft_Folder';
    const baseSnapshot = buildCurrentMbcSnapshot(cleanLabel);
    const folderSnapshot: MbcWorkbenchSnapshot = {
      ...baseSnapshot,
      sessionName: cleanLabel,
      documents: docsToExport,
    };
    const zipBytes = serializeMbcFolderZip(folderSnapshot, cleanLabel);
    const outcome = handleDownloadBinaryFile(zipBytes, `${cleanLabel}.mbc`, MBC_ZIP_MIME_TYPE);
    if (!outcome) return;
    if (outcome === 'native') {
      setStatusBanner(`Choose where to save "${cleanLabel}.mbc"…`);
      return;
    }
    setStatusBanner(
      `Exported folder "${exportFolderLabel}" as ZIP-packaged "${cleanLabel}.mbc" (${docsToExport.length} documents)`
    );
  };

  const handlePrintWorkbench = () => {
    printWorkbenchView().catch((err) => {
      setStatusBanner(`Print failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const triggerOpenMbcPicker = (mode: 'replace' | 'merge' = 'replace') => {
    setMbcImportMode(mode);
    if (postMacosNativeOpen(mode)) return;
    mbcFileInputRef.current?.click();
  };

  const triggerImportFilesPicker = () => {
    if (postMacosNativeOpen('import')) return;
    fileInputRef.current?.click();
  };

  const triggerImportFolderPicker = () => {
    if (postMacosNativeOpen('folder')) return;
    folderImportInputRef.current?.click();
  };

  const triggerImportPreferencesPicker = () => {
    if (postMacosNativeOpen('prefs')) return;
    prefsImportInputRef.current?.click();
  };

  const handleRestoreLocalAutosave = () => {
    const cached = loadWorkbenchFromLocalAutosave();
    if (!cached) {
      setStatusBanner('No local autosaved .mbc workbench draft found in storage.');
      return;
    }
    autosaveRestoreWasDirtyRef.current = workbenchAutosaveNeedsRecovery();
    try {
      applyParsedMbcSession(
        JSON.stringify(cached.envelope),
        cached.envelope.sessionName,
        'replace',
        { isAutosaveRestore: true }
      );
    } catch (err) {
      setStatusBanner(`Could not restore the autosave: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  handleRestoreLocalAutosaveRef.current = handleRestoreLocalAutosave;
  // Preferences → Files: "Continue where you left off" restores the autosave at launch.
  useEffect(() => {
    if (startupPrefs.startup !== 'restore') return;
    const t = window.setTimeout(() => {
      if (!sessionActiveRef.current && autosavePendingRecoveryRef.current && loadWorkbenchFromLocalAutosave()) {
        handleRestoreLocalAutosaveRef.current();
      }
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResetDefaultWorkbench = () => {
    guardSessionReplacement('reset the workbench', resetDefaultWorkbenchNow);
  };

  const resetDefaultWorkbenchNow = () => {
    clearWorkbenchLocalAutosave();
    initializeFreshSampleState('MolBioCraft_Sample_Session');
    setViewerTab('sequence-view');
    setSessionActive(true);
    setStatusBanner('Started new session with MolBioCraft Sample Library.');
  };

  const processIncomingFile = async (
    file: File,
    mbcMode: 'replace' | 'merge' = 'replace'
  ) => {
    Logger.info('FileImport', `Importing file "${file.name}"`, {
      sizeBytes: file.size,
      hostOs,
    });

    // Proprietary plasmid, alignment and sequence-database files are refused by name with the open
    // format to export to, before any reader sees their bytes (CR-01M6T9MT).
    const refused = refusedFileTypeReason(file.name);
    if (refused) throw new Error(refused);

    const lowerName = file.name.toLowerCase();
    const stem = file.name.replace(/\.[^.]+$/, '') || 'Imported_Sequence';
    if (file.size === 0) {
      throw new Error(`"${file.name}" is empty`);
    }

    // 0. Fragment-analysis runs (.fsa / .hid): dye traces for microsatellite sizing
    if (/\.(fsa|hid)$/.test(lowerName)) {
      const buf = await file.arrayBuffer();
      const parsed = fragmentDocumentFromFsa(new Uint8Array(buf), file.name);
      handleAddConstruct(parsed);
      setHomeViewActive(false);
      setViewerTab('text-view');
      setStatusBanner(`Opened fragment-analysis run "${parsed.name}" (${String(parsed.docMetadata?.Dyes ?? '')})`);
      return;
    }

    // 1. Sanger capillary chromatogram (.ab1 / .abi / .scf) files
    if (/\.(ab1|abi|scf)$/.test(lowerName)) {
      const buf = await file.arrayBuffer();
      const parsed = parseDnaBinaryPacket(buf, file.name);
      if (!parsed.sequence.length) {
        // The parser never invents bases; surface why nothing could be read.
        throw new Error(parsed.description || `"${file.name}" contains no readable sequence`);
      }
      handleAddConstruct(parsed);
      setHomeViewActive(false);
      if (parsed.chromatogram) {
        setViewerTab('sanger-contig');
        setStatusBanner(
          `Opened chromatogram trace "${parsed.name}" (${parsed.sequence.length.toLocaleString()} bp)`
        );
      }
      return;
    }

    // 1b. MolBioCraft Folder Archive (.mcb / .mbc in PKZIP format)
    if (lowerName.endsWith('.mcb') || lowerName.endsWith('.mbc') || lowerName.endsWith('.zip')) {
      const buf = await file.arrayBuffer();
      if (isMbcZipArchiveBytes(buf)) {
        const parsedZip = parseMbcFolderZip(buf, file.name);
        applyParsedMbcSession(JSON.stringify(parsedZip.envelope), file.name, mbcMode);
        return;
      }
    }

    // BAM is BGZF-compressed binary SAM: decode it to SAM text and import it as SAM below
    const BAM_MAX_RECORDS = 20000;
    const rawText = lowerName.endsWith('.bam') ? bamToSam(await file.arrayBuffer(), BAM_MAX_RECORDS) : await file.text();
    const text = normalizeLineEndings(rawText, 'LF');

    // 2. MolBioCraft Workbench Session (.mbc / .mcb JSON)
    if (isMbcFileOrPayload(file.name, text)) {
      applyParsedMbcSession(text, file.name, mbcMode);
      return;
    }

    // Newick and NEXUS: a TREES block opens as a tree; a NEXUS file with only
    // a DATA / CHARACTERS matrix opens as an alignment.
    if (/\.(nex|nexus|nwk|newick)$/i.test(lowerName)) {
      const imported = importNexusOrNewickDocument(text, file.name);
      activateImportedDocumentsInWorkspace([imported.doc]);
      setViewerTab(imported.kind === 'tree' ? 'phylogenetics' : 'sequence-alignment');
      setHomeViewActive(false);
      setStatusBanner(
        imported.kind === 'tree'
          ? `Opened phylogenetic tree "${imported.doc.name}"`
          : `Opened NEXUS alignment "${imported.doc.name}" (${imported.sequenceCount} sequences)`
      );
      return;
    }

    // 3a. EMBL / ENA flatfiles (own line types; formerly mis-parsed as GenBank)
    if (lowerName.endsWith('.embl') || lowerName.endsWith('.ena') || looksLikeEmblRecord(text)) {
      const recs = splitFlatfileRecords(text);
      if (recs.length > 1) {
        const docs = recs.map((r, i) => parseEMBL(r, `${stem}_${i + 1}`)).filter((d) => d.sequence.length || d.docMetadata?.['Is Contig Summary']);
        activateImportedDocumentsInWorkspace(docs);
        setHomeViewActive(false);
        setStatusBanner(`Imported ${docs.length} EMBL records from "${file.name}"`);
        return;
      }
      const parsed = parseEMBL(text, stem);
      if (!parsed.sequence.length && !parsed.docMetadata?.['Is Contig Summary']) {
        throw new Error(`"${file.name}" contains no sequence (missing SQ block)`);
      }
      handleAddConstruct(parsed);
      setHomeViewActive(false);
      return;
    }

    // 3b. GenBank (.gb / .gbk) annotated flatfiles
    if (
      lowerName.endsWith('.gb') ||
      lowerName.endsWith('.gbk') ||
      lowerName.endsWith('.genbank') ||
      text.trim().startsWith('LOCUS')
    ) {
      const recs = splitFlatfileRecords(text);
      if (recs.length > 1) {
        const docs = recs.map((r, i) => parseGenBank(r, `${stem}_${i + 1}`));
        activateImportedDocumentsInWorkspace(docs);
        setHomeViewActive(false);
        setStatusBanner(`Imported ${docs.length} GenBank records from "${file.name}"`);
        return;
      }
      const parsed = parseGenBank(text, stem);
      handleAddConstruct(parsed);
      setHomeViewActive(false);
      return;
    }

    // 3c. Text alignments: Clustal, PHYLIP, Stockholm
    if (/\.(aln|clustal|clw|phy|phylip|sto|sth|stk|stockholm)$/.test(lowerName) || /^\s*(CLUSTAL|# ?STOCKHOLM)/i.test(text)) {
      const a = parseTextAlignment(text, file.name);
      const doc = textAlignmentToDocument(a, file.name);
      activateImportedDocumentsInWorkspace([doc]);
      setViewerTab('sequence-alignment');
      setHomeViewActive(false);
      setStatusBanner(`Opened ${a.format} alignment "${doc.name}" (${a.sequences.length} sequences)`);
      return;
    }

    // 4. 3D Macromolecular Structure (.pdb / .cif / .mmcif)
    if (
      lowerName.endsWith('.pdb') ||
      lowerName.endsWith('.cif') ||
      lowerName.endsWith('.mmcif')
    ) {
      const caAtoms = parsePdbCaCoordinates(text);
      if (caAtoms.length === 0) {
        throw new Error(`"${file.name}" has no protein Cα coordinates; this structure cannot be opened in the protein viewer`);
      }
      const threeToOne: Record<string, string> = {
        ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
        GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
        LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
        SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
      };
      // Each polypeptide chain is its own sequence: concatenating chains would invent a protein.
      const chainIds = [...new Set(caAtoms.map((a) => a.chainId || 'A'))];
      const nowIso = new Date().toISOString();
      const chainDocs: SequenceDocument[] = chainIds.map((chainId, chainIdx) => {
        const atoms = caAtoms.filter((a) => (a.chainId || 'A') === chainId);
        const aaSeq = atoms.map((a) => threeToOne[a.resName.toUpperCase()] ?? 'X').join('');
        const chainName = chainIds.length > 1 ? `${stem} chain ${chainId}` : stem;
        const stamp = `${Date.now().toString(36)}-${chainIdx}`;
        return {
          id: `pdb-${stem.toLowerCase()}-${chainId.toLowerCase()}-${stamp}`,
          name: chainName,
          accession: `PDB_${stem.toUpperCase().slice(0, 8)}${chainIds.length > 1 ? `_${chainId}` : ''}`,
          description: `Chain ${chainId} of ${file.name} (${atoms.length} Cα residues${chainIds.length > 1 ? `; structure has chains ${chainIds.join(', ')}` : ''})`,
          moleculeType: 'Protein',
          topology: 'linear',
          sequence: aaSeq,
          folder: 'Protein Documents',
          docMetadata: {
            'Source Format': lowerName.endsWith('.pdb') ? 'PDB' : 'mmCIF',
            PDBText: text,
            Chain: chainId,
            'First Residue Number': atoms[0]?.resSeq ?? '',
          },
          createdAt: nowIso,
          updatedAt: nowIso,
          features: [
            {
              id: `feat-pdb-${stamp}`,
              name: `Chain ${chainId} (modelled residues ${atoms[0]?.resSeq}–${atoms[atoms.length - 1]?.resSeq})`,
              type: 'misc_feature',
              start: 1,
              end: aaSeq.length,
              strand: 1,
              color: '#0d9488',
              notes: `Parsed ${atoms.length} C-alpha coordinates`,
            },
          ],
          primers: [],
          history: [
            {
              id: `hist-pdb-${stamp}`,
              timestamp: nowIso.slice(0, 16).replace('T', ' '),
              operation: 'Imported 3D Structure',
              description: `Extracted ${aaSeq.length} aa chain ${chainId} from ${file.name}`,
              parentIds: [],
              lengthBp: aaSeq.length,
              topology: 'linear',
            },
          ],
        };
      });
      activateImportedDocumentsInWorkspace(chainDocs);
      setHomeViewActive(false);
      openGenomicsSuite('protein-3d');
      setStatusBanner(
        `Opened 3D structure "${file.name}" (${chainDocs.length} protein ${chainDocs.length === 1 ? 'chain' : 'chains'}: ${chainDocs.map((d) => `${d.docMetadata?.Chain} ${d.sequence.length} aa`).join(', ')})`
      );
      return;
    }

    // 5. Next-Generation Sequencing FASTQ (.fastq / .fq)
    if (lowerName.endsWith('.fastq') || lowerName.endsWith('.fq')) {
      // every read (up to 20,000) with its Phred qualities, in the file's quality encoding
      const fq = fastqToReadDocuments(text, file.name, 20000);
      if (fq.reads.length > 0) {
        activateImportedDocumentsInWorkspace(fq.reads, `${stem}_NGS_Session`);
        openGenomicsSuite('ngs-assembly');
        setStatusBanner(
          `Imported ${fq.reads.length.toLocaleString()} ${fq.reads.length === 1 ? 'read' : 'reads'} from "${file.name}"` +
            `${fq.total > fq.reads.length ? ` (first ${fq.reads.length.toLocaleString()} of ${fq.total.toLocaleString()})` : ''}; mean Phred Q${fq.meanPhred.toFixed(1)}, Q30 ${fq.q30Pct.toFixed(1)}%`
        );
        return;
      }
      throw new Error(`"${file.name}" contains no FASTQ records`);
    }

    // 5b. SAM read alignments: a contig on the open reference, built from the records' own CIGAR
    if (lowerName.endsWith('.sam') || lowerName.endsWith('.bam')) {
      const open = [...documentsRef.current, ...importBatchDocsRef.current.values()];
      const o = mapOptionsOf({});
      const sam = samToContigs(text, file.name, open, { minIdentityPct: 0, minAlignedLength: 1, minVariantFrequencyPct: o.minVarFreq, minVariantCoverage: o.minVarCoverage });
      if (!sam.records) throw new Error(`"${file.name}" contains no alignment records`);
      if (sam.contigs.length) {
        const docs = sam.contigs.map(({ reference, contig }) => contigDocument(reference, sam.reads, contig, o, 'Contig Assembly', `${reference.name} contig (${file.name})`, lowerName.endsWith('.bam') ? 'Imported BAM' : 'Imported SAM'));
        activateImportedDocumentsInWorkspace(docs);
        setHomeViewActive(false);
        setStatusBanner(`Imported ${file.name}${lowerName.endsWith('.bam') && sam.records >= BAM_MAX_RECORDS ? ` (first ${BAM_MAX_RECORDS.toLocaleString()} records)` : ''}: ${sam.contigs.map((c) => `${c.contig.mapped.length.toLocaleString()} reads on ${c.reference.name}`).join(', ')}${sam.missingReferences.length ? `; reference ${sam.missingReferences.join(', ')} not open` : ''}`);
      } else {
        activateImportedDocumentsInWorkspace(sam.reads, `${stem}_SAM_Reads`);
        setHomeViewActive(false);
        setStatusBanner(`Imported ${sam.reads.length.toLocaleString()} reads from "${file.name}". Open the reference ${sam.missingReferences.join(', ')} first to import the alignment as a contig.`);
      }
      return;
    }

    // 6. GFF3 / BED Genomic Feature Track Overlay onto Active Document
    if (
      lowerName.endsWith('.gff') ||
      lowerName.endsWith('.gff3') ||
      lowerName.endsWith('.bed') ||
      lowerName.endsWith('.vcf')
    ) {
      const vcfTarget = lowerName.endsWith('.vcf') ? (documentsRef.current.find((d) => d.id === activeDoc.id) ?? activeDoc) : null;
      const importedFeatures = lowerName.endsWith('.bed')
        ? parseBED(text)
        : vcfTarget
          ? vcfToFeatures(text, [vcfTarget.name, vcfTarget.accession]).features
          : parseGFF3(text);
      if (importedFeatures.length === 0) {
        // Header-only tracks used to fall through to the FASTA reader.
        throw new Error(`"${file.name}" contains no feature records`);
      }
      // Resolve the target freshly: within a batch, the render closure's
      // activeDoc is stale (a sequence imported earlier in the batch, or a
      // previous track in the same batch, would otherwise be overwritten).
      const inBatch = importBatchActiveRef.current;
      const targetId = (inBatch ? importTargetDocIdRef.current : null) ?? activeDoc.id;
      const target =
        (inBatch ? importBatchDocsRef.current.get(targetId) : undefined) ??
        documentsRef.current.find((d) => d.id === targetId) ??
        (activeDoc.id === targetId ? activeDoc : undefined);
      if (!target || !target.id || !target.sequence.length) {
        throw new Error(`"${file.name}" is a feature track; open the sequence it annotates first`);
      }
      // Features outside the target sequence are reported, not squeezed onto its ends.
      const inRange = importedFeatures.filter((f) => f.start >= 1 && f.end <= target.sequence.length);
      const skipped = importedFeatures.length - inRange.length;
      if (inRange.length === 0) {
        throw new Error(`None of the ${importedFeatures.length} features in "${file.name}" fall within "${target.name}" (${target.sequence.length.toLocaleString()} bp)`);
      }
      const clamped = inRange.map((f, idx) => ({
        ...f,
        id: `${f.id || 'track'}-${idx}-${Date.now().toString(36)}`,
      }));
      const updatedTarget: SequenceDocument = {
        ...target,
        features: [...target.features, ...clamped],
        updatedAt: new Date().toISOString(),
      };
      if (inBatch) importBatchDocsRef.current.set(updatedTarget.id, updatedTarget);
      setHomeViewActive(false);
      handleUpdateDocument(updatedTarget, 'Attach Feature Track');
      setViewerTab('sequence-view');
      setStatusBanner(
        `Attached ${clamped.length} annotation ${
          clamped.length === 1 ? 'feature' : 'features'
        } from "${file.name}" onto "${target.name}"${skipped ? ` (${skipped} outside the sequence skipped)` : ''}`
      );
      return;
    }

    // Recognised-but-unsupported formats and non-sequence text must not be
    // turned into "sequences" by the permissive FASTA reader below.
    const unsupported = unsupportedImportReason(file.name);
    if (unsupported) throw new Error(unsupported);
    const rawCheck = assessRawSequenceText(text);
    if (!rawCheck.ok) {
      throw new Error(`"${file.name}" was not imported: ${rawCheck.reason}`);
    }

    // 7a. Aligned multi-FASTA (equal lengths with gaps) opens as an alignment
    const alignedFasta = text.trimStart().startsWith('>') ? parseAlignedFasta(text) : null;
    if (alignedFasta) {
      const doc = textAlignmentToDocument(alignedFasta, file.name);
      activateImportedDocumentsInWorkspace([doc]);
      setViewerTab('sequence-alignment');
      setHomeViewActive(false);
      setStatusBanner(`Opened aligned FASTA "${doc.name}" (${alignedFasta.sequences.length} sequences)`);
      return;
    }

    // 7. Multi-FASTA / Raw Nucleotide or Protein Sequence (.fasta / .fa / .fna / .faa / .txt)
    const parsedList = parseFasta(text, stem);
    if (parsedList.length === 0) {
      throw new Error(`"${file.name}" contains no sequence records`);
    }
    activateImportedDocumentsInWorkspace(parsedList, `${stem}_Session`);
    setViewerTab('sequence-view');
    setStatusBanner(
      `Imported ${parsedList.length} ${
        parsedList.length === 1 ? 'sequence' : 'sequences'
      } from "${file.name}"`
    );
  };

  /**
   * Import files one by one. A failing file no longer aborts the rest of the
   * batch; failures are collected and reported together, and the result lets
   * callers avoid announcing success over an error.
   */
  const importIncomingFilesBatch = async (
    fileList: File[],
    mbcMode: 'replace' | 'merge' = 'replace',
    sourceLabel: 'imported' | 'dropped' = 'dropped'
  ): Promise<{ imported: number; failed: { name: string; message: string }[] }> => {
    const failed: { name: string; message: string }[] = [];
    let imported = 0;
    if (fileList.length === 0) return { imported, failed };
    importBatchDocsRef.current = new Map();
    importTargetDocIdRef.current = null;
    importBatchActiveRef.current = true;
    try {
      for (const file of fileList) {
        try {
          await processIncomingFile(file, mbcMode);
          imported += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failed.push({ name: file.name, message: msg });
          Logger.error('FileImport', 'Failed to import file', { fileName: file.name, error: msg });
        }
      }
    } finally {
      importBatchActiveRef.current = false;
      importBatchDocsRef.current = new Map();
      importTargetDocIdRef.current = null;
    }
    const prefix = sourceLabel === 'dropped' ? 'Drop import' : 'Import';
    if (failed.length > 0) {
      const detail = failed.length === 1 ? failed[0].message : failed.map((f) => f.name).join(', ');
      setStatusBanner(
        imported > 0
          ? `${prefix}: ${imported} of ${fileList.length} files imported; failed: ${detail}`
          : `${prefix} error: ${detail}`
      );
    } else if (fileList.length > 1) {
      setStatusBanner(
        sourceLabel === 'dropped'
          ? `Imported ${fileList.length} dropped files into active session`
          : `Batch imported ${fileList.length} sequence files into active session`
      );
    }
    return { imported, failed };
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    if (fileList.length === 0) return;
    try {
      await importIncomingFilesBatch(fileList, 'replace', 'imported');
    } finally {
      e.target.value = '';
    }
  };

  const handleImportFolderFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files ? Array.from(e.target.files) : [];
    if (rawFiles.length === 0) return;
    try {
      const supportedExtRe =
        /\.(mbc|mcb|json|zip|gb|gbk|genbank|embl|gff|gff3|bed|fasta|fa|fas|fna|faa|ab1|abi|scf|fsa|hid|fastq|fq|pdb|cif|mmcif|ent|sam|bam|vcf|nex|nexus|nwk|newick|tre|aln|clustal|phy|phylip|sto|sth|stk|txt)$/i;
      const fileList = rawFiles.filter(
        (f) => !f.name.startsWith('.') && supportedExtRe.test(f.name)
      );
      const firstRelPath = (rawFiles[0] as File & { webkitRelativePath?: string })
        ?.webkitRelativePath;
      const folderName = firstRelPath ? firstRelPath.split('/')[0]?.trim() : '';
      // Create the folder after the import: importing into a closed session
      // starts a new session, which resets the explorer and used to wipe it.
      const addImportedFolder = () => {
        if (!folderName) return;
        setCustomFolders((prev) => (prev.includes(folderName) ? prev : [...prev, folderName]));
        setSelectedFolder(folderName);
      };
      if (fileList.length === 0) {
        addImportedFolder();
        setStatusBanner(
          folderName
            ? `Created folder "${folderName}" (no supported sequence files found inside)`
            : 'No supported sequence files found in selected folder'
        );
        return;
      }
      // Ids present before the batch. A closed session's documents are not
      // "before" anything: a re-import can reuse their parser-derived ids.
      const idsBefore = new Set(sessionActiveRef.current ? documentsRef.current.map((d) => d.id) : []);
      // A session archive restores its own folder layout; do not flatten it.
      const containsSessionArchive = fileList.some((f) => /\.(mbc|mcb|zip|json)$/i.test(f.name));
      const result = await importIncomingFilesBatch(fileList, 'replace', 'imported');
      addImportedFolder();
      if (folderName && result.imported > 0 && !containsSessionArchive) {
        // File the imported documents under the folder that was selected
        // (they kept their parser-assigned type folders, so the newly
        // selected folder looked empty). Functional update: runs after the
        // batch's own document updates.
        setDocuments((prev) =>
          prev.map((d) => (idsBefore.has(d.id) || d.folder === folderName ? d : { ...d, folder: folderName }))
        );
      }
      if (folderName && result.failed.length === 0) {
        setStatusBanner(
          `Imported folder "${folderName}" (${result.imported} file${
            result.imported === 1 ? '' : 's'
          })`
        );
      }
    } finally {
      e.target.value = '';
    }
  };

  const handleImportMbcFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await processIncomingFile(file, mbcImportMode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusBanner(`Failed to open .mbc session: ${msg}`);
      Logger.error('MbcSession', 'Failed to parse .mbc session file', {
        fileName: file.name,
        error: msg,
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleDragEnterWorkbench = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    fileDragDepthRef.current += 1;
    setIsFileDragActive(true);
  };

  const handleDragOverWorkbench = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isFileDragActive) {
      setIsFileDragActive(true);
    }
  };

  const handleDragLeaveWorkbench = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    const nextTarget = e.relatedTarget as Node | null;
    if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
      fileDragDepthRef.current = 0;
      setIsFileDragActive(false);
      return;
    }
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) {
      setIsFileDragActive(false);
    }
  };

  const handleDropOnWorkbench = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    fileDragDepthRef.current = 0;
    setIsFileDragActive(false);
    const fileList = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (fileList.length === 0) return;
    await importIncomingFilesBatch(fileList, 'replace', 'dropped');
  };

  const importDroppedFilesRef = useRef<(files: File[]) => Promise<void>>(
    async () => {}
  );
  importDroppedFilesRef.current = async (files: File[]) => {
    await importIncomingFilesBatch(files, 'replace', 'dropped');
  };

  useEffect(() => {
    void discoverRustRestApiEndpoint();
    const clearDragOverlay = () => {
      fileDragDepthRef.current = 0;
      setIsFileDragActive(false);
    };
    window.addEventListener('blur', clearDragOverlay);
    window.addEventListener('dragend', clearDragOverlay);

    const unlistenTauriDrops = subscribeTauriWindowFileDropEvents({
      onDragEnter: () => {
        fileDragDepthRef.current = 1;
        setIsFileDragActive(true);
      },
      onDragLeave: () => {
        fileDragDepthRef.current = 0;
        setIsFileDragActive(false);
      },
      onDropFiles: (files) => {
        void importDroppedFilesRef.current(files);
      },
      onDropError: (message) => {
        setStatusBanner(`Drop import error: ${message}`);
      },
    });

    return () => {
      window.removeEventListener('blur', clearDragOverlay);
      window.removeEventListener('dragend', clearDragOverlay);
      unlistenTauriDrops();
    };
  }, []);

  const handleSelectNextFeature = () => {
    if (activeDoc.features.length === 0) return;
    const sorted = [...activeDoc.features].sort((a, b) => a.start - b.start);
    const curStart = selectedRange?.start ?? 0;
    const next = sorted.find((f) => f.start > curStart) ?? sorted[0];
    setSelectedRange({
      start: next.start,
      end: next.end,
      label: `${next.name} (${next.type})`,
    });
    setViewerTab('sequence-view');
  };

  // --- Multifile Document Table, Folder, Favorites, Trash, SVG, Batch & Database Actions ---
  // The documents an action applies to: the ticked rows, else the active
  // document. Never pads the set with documents the user did not select.
  const getTargetSelectedDocs = (): SequenceDocument[] =>
    selectedAnalysisDocuments.length > 0
      ? selectedAnalysisDocuments
      : activeDoc.id
        ? [activeDoc]
        : [];

  /**
   * Targets for a multi-sequence operation, or null (with an explanatory
   * banner) when fewer than `minRequired` documents are selected or the
   * selection mixes nucleotide and protein documents.
   */
  const requireMultiDocSelection = (
    minRequired: number,
    actionLabel: string
  ): SequenceDocument[] | null => {
    const targets = getTargetSelectedDocs();
    const check = checkMultiDocumentSelection(targets, minRequired);
    if (!check.ok) {
      setStatusBanner(`${actionLabel}: ${check.reason}`);
      return null;
    }
    return targets;
  };

  const handleExportConsensusFasta = () => {
    const targets = requireMultiDocSelection(2, 'Export Consensus');
    if (!targets) return;
    try {
      const cons = generateConsensusDocument(targets, 60);
      if (handleDownloadFile(exportToFasta(cons), `${cons.name}.fasta`) !== 'downloaded') return;
      setStatusBanner(`Exported consensus FASTA "${cons.name}.fasta" from ${targets.length} sequences`);
    } catch (err) {
      setStatusBanner(`Export Consensus failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleColumnVisibility = (colId: string) => {
    const def = availableFolderColumns.find((c) => c.id === colId);
    if (def?.alwaysVisible || colId === 'name') return;
    setVisibleColumns((prev) =>
      prev.includes(colId) ? prev.filter((c) => c !== colId) : [...prev, colId]
    );
  };

  const handleApplyColumnPreset = (presetId: DocTableColumnPresetId) => {
    if (presetId === 'all-columns') {
      setVisibleColumns(availableFolderColumns.map((c) => c.id));
    } else {
      setVisibleColumns(DOC_TABLE_COLUMN_PRESETS[presetId].columns);
    }
    setStatusBanner(`Applied Table Columns preset: ${DOC_TABLE_COLUMN_PRESETS[presetId].label}`);
  };

  const handleHeaderColumnSort = (colId: string) => {
    if (sortColumn === colId) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(colId);
      setSortDirection('asc');
    }
  };

  const handleSaveDocColumnState = () => {
    const payload = {
      visibleIds: orderedVisibleDocColumns.map((c) => c.id),
      orderedIds: orderedAllDocColumns.map((c) => c.id),
      lockColumnOrder,
    };
    savePersistedTableColumnState(`main-doc-table:${selectedFolder}`, payload);
    savePersistedTableColumnState('main-doc-table', payload);
    setSavedCustomColumnState(payload.visibleIds);
    setDocColStatusMsg(`Saved column state for "${folderLabel(selectedFolder)}" ✓`);
    setStatusBanner(`Saved custom column state (${payload.visibleIds.length} columns)`);
    setTimeout(() => setDocColStatusMsg(null), 2200);
  };

  const handleLoadDocColumnState = () => {
    const saved =
      loadPersistedTableColumnState(`main-doc-table:${selectedFolder}`) ??
      loadPersistedTableColumnState('main-doc-table');
    if (saved && saved.visibleIds.length > 0) {
      setVisibleColumns(saved.visibleIds);
      setDocColumnOrder(saved.orderedIds);
      setLockColumnOrder(saved.lockColumnOrder);
      setDocColStatusMsg('Loaded saved column state ✓');
      setStatusBanner(`Restored saved column state (${saved.visibleIds.length} columns)`);
    } else if (savedCustomColumnState && savedCustomColumnState.length > 0) {
      setVisibleColumns(savedCustomColumnState);
      setDocColStatusMsg('Loaded saved column state ✓');
      setStatusBanner(`Restored saved column state (${savedCustomColumnState.length} columns)`);
    } else {
      const defaults = getDefaultVisibleColumnsForFolder(selectedFolder, availableFolderColumns);
      setVisibleColumns(defaults);
      setDocColumnOrder([]);
      setLockColumnOrder(false);
      setDocColStatusMsg('Reset to default folder columns ✓');
      setStatusBanner(`Reset columns to defaults for "${folderLabel(selectedFolder)}"`);
    }
    setTimeout(() => setDocColStatusMsg(null), 2200);
  };

  const handleDropDocColumn = (targetColId: string) => {
    if (
      lockColumnOrder ||
      !dragDocColId ||
      dragDocColId === targetColId ||
      dragDocColId === 'icon' ||
      dragDocColId === 'name' ||
      targetColId === 'icon' ||
      targetColId === 'name'
    ) {
      setDragDocColId(null);
      return;
    }
    const order = orderedAllDocColumns.map((c) => c.id);
    const fromIdx = order.indexOf(dragDocColId);
    const toIdx = order.indexOf(targetColId);
    if (fromIdx >= 0 && toIdx >= 0) {
      const next = [...order];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      setDocColumnOrder(next);
    }
    setDragDocColId(null);
  };

  const handleToggleFavoriteDocs = (specificDocId?: string) => {
    const targetIds = specificDocId
      ? [specificDocId]
      : getTargetSelectedDocs().map((d) => d.id);
    const allAlreadyFav = targetIds.every((id) => favoriteIdsSet.has(id));
    setFavoriteDocIds((prev) =>
      allAlreadyFav
        ? prev.filter((id) => !targetIds.includes(id))
        : Array.from(new Set([...prev, ...targetIds]))
    );
    setStatusBanner(
      allAlreadyFav
        ? `Removed ${targetIds.length} ${targetIds.length === 1 ? 'document' : 'documents'} from Favorites`
        : `Added ${targetIds.length} ${targetIds.length === 1 ? 'document' : 'documents'} to Favorites`
    );
  };

  const openFolderContextMenu = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, folder: string) => {
    event.preventDefault();
    event.stopPropagation();
    closeAllMenus();
    handleSelectProjectFolder(folder);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = 'clientX' in event && event.clientX > 0 ? event.clientX : rect.left;
    const y = 'clientY' in event && event.clientY > 0 ? event.clientY : rect.bottom;
    setFolderContextMenu({
      folder,
      pos: computeViewportClampedContextMenuPosition(x, y, window.innerWidth, window.innerHeight, 240, 360),
    });
  };

  const handleNewFolder = (parent = PROJECT_ROOT) => {
    setPromptDialog({ title: 'New Folder', label: `Folder name (inside ${folderLabel(parent)})`,
      value: 'New Folder', placeholder: 'Folder name', confirmLabel: 'Create Folder', onConfirm: (value) => {
        const name = value.trim();
        if (!name) return;
        if (visibleExplorerFolders.some((folder) => folder.parent === parent && folder.label.toLowerCase() === name.toLowerCase())) {
          setStatusBanner('A folder with that name already exists here. Choose a different name.'); return;
        }
        const id = `folder-${crypto.randomUUID()}`;
        setCustomFolders((prev) => [...prev, id]);
        setFolderNames((prev) => ({ ...prev, [id]: name }));
        setFolderParents((prev) => ({ ...prev, [id]: parent }));
        setExpandedNodes((prev) => ({ ...prev, projectFiles: true, [parent]: true }));
        handleSelectProjectFolder(id);
        setStatusBanner(`Created folder "${name}"`);
      } });
  };

  const handleRenameSelectedFolder = (target = selectedFolder) => {
    if (!explorerFolders.some((folder) => folder.id === target)) {
      setStatusBanner('Select a specific project subfolder first to rename it.'); return;
    }
    setPromptDialog({ title: `Rename Folder "${folderLabel(target)}"`, label: 'New folder name',
      value: folderLabel(target), placeholder: 'Folder name', confirmLabel: 'Rename Folder', onConfirm: (value) => {
        const name = value.trim();
        const parent = explorerFolders.find((folder) => folder.id === target)?.parent;
        if (!name) return;
        if (visibleExplorerFolders.some((folder) => folder.id !== target && folder.parent === parent && folder.label.toLowerCase() === name.toLowerCase())) {
          setStatusBanner('A folder with that name already exists here. Choose a different name.'); return;
        }
        setFolderNames((prev) => ({ ...prev, [target]: name }));
        setStatusBanner(`Renamed folder to "${name}"`);
      } });
  };

  const handleDeleteFolder = (target: string) => {
    const descendants = folderDescendants(target, explorerFolders);
    const targets = getDocsForFolderView(target);
    setPromptDialog({ title: `Delete Folder "${folderLabel(target)}"`,
      label: `Move ${targets.length} documents and this folder's subfolders to Deleted Items? Type DELETE to confirm.`,
      value: '', placeholder: 'DELETE', confirmLabel: 'Delete Folder', onConfirm: (value) => {
        if (value !== 'DELETE') { setStatusBanner('Folder deletion cancelled: confirmation did not match.'); return; }
        const ids = new Set(targets.map((doc) => doc.id));
        setDeletedDocIds((prev) => [...new Set([...prev, ...ids])]);
        setHiddenFolders((prev) => [...new Set([...prev, ...descendants])]);
        setCheckedDocIds((prev) => prev.filter((id) => !ids.has(id)));
        if (descendants.has(selectedFolder)) handleSelectProjectFolder(PROJECT_ROOT);
        if (ids.has(activeDocId)) { setActiveDocId(activeNonDeletedDocs.find((doc) => !ids.has(doc.id))?.id ?? ''); setSelectedRange(null); }
        setStatusBanner(`Deleted folder "${folderLabel(target)}". Its documents can be restored from Deleted Items.`);
      } });
  };

  const handleMoveFolder = (target: string, parent: string) => {
    if (folderDescendants(target, explorerFolders).has(parent)) return;
    if (visibleExplorerFolders.some((folder) => folder.id !== target && folder.parent === parent && folder.label.toLowerCase() === folderLabel(target).toLowerCase())) {
      setStatusBanner('The destination already contains a folder with that name. Rename the folder first.'); return;
    }
    setFolderParents((prev) => ({ ...prev, [target]: parent }));
    setExpandedNodes((prev) => ({ ...prev, projectFiles: true, [parent]: true }));
    setStatusBanner(`Moved "${folderLabel(target)}" into "${folderLabel(parent)}"`);
  };

  const folderContextItems = (target: string): MenuNode[] => {
    const isRoot = target === PROJECT_ROOT || target === 'Local' || target === 'All Project Files';
    const isFolder = explorerFolders.some((folder) => folder.id === target) || isRoot;
    const isTrash = target === 'Deleted Items';
    const targets = getDocsForFolderView(target);
    const descendants = folderDescendants(target, explorerFolders);
    const parent = explorerFolders.find((folder) => folder.id === target)?.parent;
    const isDarwin = detectHostOS() === 'macos';

    return [
      {
        kind: 'command',
        id: 'folder-new',
        label: 'New Folder…',
        icon: <FolderPlus size={14} />,
        shortcut: isDarwin ? '⇧⌘N' : 'Ctrl+Shift+N',
        disabled: isTrash || target === 'Favorites',
        onSelect: () => handleNewFolder(isTrash ? PROJECT_ROOT : target),
      },
      {
        kind: 'command',
        id: 'folder-export',
        label: 'Export Folder…',
        icon: null,
        onSelect: () => handleExportFolderMbc(target),
      },
      {
        kind: 'command',
        id: 'folder-delete',
        label: 'Delete Folder',
        icon: null,
        disabled: !isFolder || isRoot,
        onSelect: () => handleDeleteFolder(target),
      },
      {
        kind: 'command',
        id: 'folder-rename',
        label: 'Rename Folder…',
        icon: null,
        disabled: !isFolder || isRoot,
        onSelect: () => handleRenameSelectedFolder(target),
      },
      {
        kind: 'submenu',
        id: 'folder-color',
        label: 'Set Folder Color…',
        icon: null,
        disabled: !isFolder || isRoot,
        children: [
          ...FOLDER_ACCENT_PALETTE.map((color, index): MenuNode => ({
            kind: 'checkbox',
            id: `folder-color-${index}`,
            label: ['Blue', 'Teal', 'Green', 'Amber', 'Purple', 'Rose'][index],
            icon: <Folder size={14} color={color} fill={color} fillOpacity={0.2} />,
            checked: folderColors[target] === color,
            onToggle: () => setFolderColors((prev) => ({ ...prev, [target]: color })),
          })),
          {
            kind: 'command',
            id: 'folder-color-default',
            label: 'Default Color',
            icon: null,
            onSelect: () =>
              setFolderColors((prev) => {
                const next = { ...prev };
                delete next[target];
                return next;
              }),
          },
        ],
      },
      { kind: 'separator', id: 'folder-separator' },
      {
        kind: 'submenu',
        id: 'folder-move',
        label: 'Move Folder…',
        icon: null,
        disabled: !isFolder || isRoot,
        children: [{ id: PROJECT_ROOT, label: 'Local' }, ...visibleExplorerFolders]
          .filter((folder) => !descendants.has(folder.id))
          .map((folder) => ({
            kind: 'command',
            id: `folder-move-${folder.id}`,
            label: folder.label,
            icon: null,
            disabled: folder.id === parent,
            onSelect: () => handleMoveFolder(target, folder.id),
          })),
      },
      {
        kind: 'command',
        id: 'folder-read',
        label: 'Mark All as Read',
        icon: null,
        disabled: targets.length === 0 || isTrash,
        onSelect: () => {
          setReadDocIds((prev) => [...new Set([...prev, ...targets.map((doc) => doc.id)])]);
          setStatusBanner(`Marked ${targets.length} documents in "${folderLabel(target)}" as read`);
        },
      },
      {
        kind: 'command',
        id: 'folder-favorite',
        label: favoriteFolders.includes(target) ? 'Remove from Favorites' : 'Add to Favorites',
        icon: (
          <Star
            size={14}
            className={favoriteFolders.includes(target) ? 'is-active' : ''}
            fill={favoriteFolders.includes(target) ? 'currentColor' : 'none'}
          />
        ),
        disabled: !isFolder || isRoot,
        onSelect: () =>
          setFavoriteFolders((prev) =>
            prev.includes(target) ? prev.filter((id) => id !== target) : [...prev, target]
          ),
      },
      {
        kind: 'command',
        id: 'folder-size',
        label: 'Show Folder Size',
        icon: null,
        onSelect: () =>
          setFolderInfo({
            label: folderLabel(target),
            count: targets.length,
            bytes: new TextEncoder().encode(JSON.stringify(targets)).length,
          }),
      },
      ...(isTrash
        ? [
            {
              kind: 'command' as const,
              id: 'folder-restore',
              label: 'Put Back All',
              icon: null,
              onSelect: () => {
                setHiddenFolders([]);
                setDeletedDocIds([]);
                setStatusBanner('Restored deleted folders and documents.');
              },
            },
          ]
        : []),
    ];
  };

  const handleCycleSelectedFolderColor = () => {
    const cur = folderColors[selectedFolder];
    const curIdx = cur ? FOLDER_ACCENT_PALETTE.indexOf(cur) : -1;
    const nextColor =
      FOLDER_ACCENT_PALETTE[(curIdx + 1) % FOLDER_ACCENT_PALETTE.length];
    setFolderColors((prev) => ({ ...prev, [selectedFolder]: nextColor }));
    setStatusBanner(`Updated folder accent color for "${folderLabel(selectedFolder)}"`);
  };

  const handleMoveSelectedDocsToFolder = () => {
    const targets = getTargetSelectedDocs();
    const docNoun = targets.length === 1 ? 'Document' : 'Documents';
    setPromptDialog({
      title: `Move ${targets.length} Selected ${docNoun}`,
      label: 'Destination project folder',
      value: folderLabel(customFolders[0] ?? 'Plasmids & Vectors'),
      placeholder: 'Enter destination folder name…',
      confirmLabel: `Move ${docNoun}`,
      onConfirm: (dest) => {
        if (!dest.trim()) return;
        const matches = visibleExplorerFolders.filter((folder) => folder.id === dest.trim() || folder.label === dest.trim());
        if (matches.length > 1) { setStatusBanner('More than one folder has that name. Use a unique folder name.'); return; }
        const cleanDest = matches[0]?.id ?? dest.trim();
        if (
          !PROJECT_SUBFOLDERS.some((sf) => sf.label === cleanDest) &&
          cleanDest !== 'All Project Files'
        ) {
          setCustomFolders((prev) => (prev.includes(cleanDest) ? prev : [...prev, cleanDest]));
        }
        const idSet = new Set(targets.map((d) => d.id));
        setDocuments((prev) =>
          [...prev, ...targets.filter((doc) => !prev.some((existing) => existing.id === doc.id))].map((d) => (idSet.has(d.id) ? { ...d, folder: cleanDest } : d))
        );
        setSelectedFolder(cleanDest);
        setStatusBanner(
          `Moved ${targets.length} ${targets.length === 1 ? 'document' : 'documents'} to "${folderLabel(cleanDest)}"`
        );
      },
    });
  };

  const handleSoftDeleteSelectedDocs = () => handleSoftDeleteDocs(getTargetSelectedDocs());

  /** Move documents to Deleted Items; the shared path for menus and the row context menu. */
  const handleSoftDeleteDocs = (targets: SequenceDocument[]) => {
    if (targets.length === 0) {
      setStatusBanner('Move to Trash: select a document first.');
      return;
    }
    const idSet = new Set(targets.map((d) => d.id));
    setDeletedDocIds((prev) => Array.from(new Set([...prev, ...targets.map((d) => d.id)])));
    setCheckedDocIds((prev) => prev.filter((id) => !idSet.has(id)));
    const remaining = documents.filter((d) => !deletedIdsSet.has(d.id) && !idSet.has(d.id));
    if (idSet.has(activeDoc.id)) {
      // Never leave a trashed document active and on screen.
      setOpenTabIds((prev) => prev.filter((id) => !idSet.has(id)));
      if (remaining.length > 0) {
        setActiveDocId(remaining[0].id);
        setCheckedDocIds([remaining[0].id]);
      } else {
        setActiveDocId('');
      }
      setSelectedRange(null);
    }
    setStatusBanner(
      `Moved ${targets.length} ${
        targets.length === 1 ? 'document' : 'documents'
      } to Deleted Items (use File › Put Back to restore)`
    );
  };

  const handleRestoreFromDeletedItems = (specificId?: string) => {
    if (deletedDocIds.length === 0) {
      setStatusBanner('Deleted Items is already empty.');
      return;
    }
    const restoreIds = specificId
      ? [specificId]
      : selectedFolder === 'Deleted Items' && selectedInFilteredDocs.length > 0
      ? selectedInFilteredDocs.map((d) => d.id)
      : [...deletedDocIds];
    const restoreSet = new Set(restoreIds);
    setDeletedDocIds((prev) => prev.filter((id) => !restoreSet.has(id)));
    const restoredFolders = new Set(catalogAllDocs.filter((doc) => restoreSet.has(doc.id)).map((doc) => doc.folder));
    setHiddenFolders((prev) => prev.filter((id) => !documentsInFolder(id, explorerFolders, catalogAllDocs).some((doc) => restoreSet.has(doc.id)) && !restoredFolders.has(id)));
    if (restoreIds.length > 0) {
      selectDocumentWithHistory(restoreIds[0]);
    }
    if (selectedFolder === 'Deleted Items' && deletedDocIds.length <= restoreIds.length) {
      setSelectedFolder('All Project Files');
    }
    setStatusBanner(
      `Restored ${restoreIds.length} ${
        restoreIds.length === 1 ? 'document' : 'documents'
      } from Deleted Items`
    );
  };

  const handleEraseAllDeletedItems = () => {
    if (deletedDocIds.length === 0) {
      setStatusBanner('Deleted Items is already empty.');
      return;
    }
    closeAllMenus();
    const pending = deletedDocIds.length;
    setConfirmDialog({
      title: 'Empty Deleted Items',
      message: `Permanently erase ${pending} ${pending === 1 ? 'document' : 'documents'} from Deleted Items? This cannot be undone.`,
      confirmLabel: 'Erase Permanently',
      destructive: true,
      onConfirm: () => eraseAllDeletedItemsNow(),
    });
  };

  const eraseAllDeletedItemsNow = () => {
    const eraseSet = new Set(deletedDocIds);
    const count = eraseSet.size;
    setDocuments((prev) => prev.filter((doc) => !eraseSet.has(doc.id)));
    setCheckedDocIds((prev) => prev.filter((id) => !eraseSet.has(id)));
    if (eraseSet.has(activeDocId)) {
      setActiveDocId(documents.find((doc) => !eraseSet.has(doc.id))?.id ?? '');
      setSelectedRange(null);
    }
    setOpenTabIds((prev) => prev.filter((id) => !eraseSet.has(id)));
    setDeletedDocIds([]);
    const remainingHistory = navHistory.filter((id) => !eraseSet.has(id));
    setNavHistory(remainingHistory);
    setNavIndex(Math.min(navIndex, Math.max(0, remainingHistory.length - 1)));
    if (selectedFolder === 'Deleted Items') {
      setSelectedFolder('All Project Files');
    }
    setStatusBanner(
      `Permanently erased ${count} ${count === 1 ? 'document' : 'documents'} from Deleted Items`
    );
  };

  const handleToggleExpandDocumentView = () => {
    if (!expandedDocView) {
      prevPanelStateBeforeExpandRef.current = {
        sidebarOpen,
        docTableCollapsed,
      };
      setSidebarOpen(false);
      setDocTableCollapsed(true);
      setExpandedDocView(true);
      setStatusBanner('Expanded Document View (⇧⌘O to restore panels)');
    } else {
      const prev = prevPanelStateBeforeExpandRef.current;
      setSidebarOpen(prev ? prev.sidebarOpen : true);
      setDocTableCollapsed(prev ? prev.docTableCollapsed : false);
      setExpandedDocView(false);
      setStatusBanner('Restored Project Explorer & Multifile Info Table');
    }
  };

  const handleConcatenateSelectedSequences = () => {
    const targets = requireMultiDocSelection(2, 'Concatenate');
    if (!targets) return;
    let concatDoc: SequenceDocument;
    try {
      concatDoc = concatenateSequenceDocuments(targets);
    } catch (err) {
      setStatusBanner(`Concatenate failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    handleAddConstruct(concatDoc);
    setStatusBanner(
      `Concatenated ${targets.length} sequences into "${concatDoc.name}" (${concatDoc.sequence.length.toLocaleString()} bp)`
    );
  };

  const handleGenerateConsensusFromSelected = (displayedConsensus?: string) => {
    if (displayedConsensus !== undefined) {
      const sequence = displayedConsensus.replace(/-/g, '');
      if (!sequence) {
        setStatusBanner('The displayed consensus contains no residues.');
        return;
      }
      const timestamp = new Date().toISOString();
      const consensusDoc: SequenceDocument = {
        ...activeDoc,
        id: crypto.randomUUID(),
        name: `${activeDoc.name}_consensus`,
        accession: '',
        description: 'Consensus extracted using the current alignment viewer threshold and gap settings.',
        sequence,
        topology: 'linear',
        features: [], primers: [], alignmentMeta: undefined, chromatogram: undefined,
        documentKind: undefined,
        docMetadata: { 'Consensus source': activeDoc.name },
        createdAt: timestamp, updatedAt: timestamp,
        history: [{
          id: crypto.randomUUID(), timestamp, operation: 'Extract alignment consensus',
          description: 'Used the displayed alignment consensus without realigning or changing the threshold.',
          parentIds: [activeDoc.id],
          lengthBp: sequence.length, topology: 'linear',
        }],
      };
      handleAddConstruct(consensusDoc);
      setStatusBanner(`Extracted displayed consensus "${consensusDoc.name}" (${sequence.length} residues).`);
      return;
    }
    const targets = phylogenyInputs;
    if (targets.length < 2) {
      setStatusBanner('Select at least two sequences of the same molecule type, or open an alignment with stored members.');
      return;
    }
    const consDoc = generateConsensusDocument(targets, 60);
    handleAddConstruct(consDoc);
    setStatusBanner(
      `Generated consensus "${consDoc.name}" (${consDoc.alignmentMeta?.pairwiseIdentityPct ?? 100}% pairwise identity across ${targets.length} sequences)`
    );
  };

  const handleMaskActiveSequence = (mode: 'selection' | 'low-complexity') => {
    const label = mode === 'selection' ? 'Mask Selection' : 'Mask Homopolymers';
    if (!ensureCommandAvailable('document-edit', label)) return;
    if (mode === 'selection' && !selectedRange) {
      setStatusBanner('Mask Selection: select the residues to mask first.');
      return;
    }
    const { updated, maskedBases, maskedRuns, annotationsOmitted } = maskSequenceRegions(activeDoc, mode, selectedRange);
    handleUpdateDocument(updated);
    setStatusBanner(
      maskedBases > 0
        ? `Masked ${maskedBases} ${maskedBases === 1 ? 'residue' : 'residues'} in "${activeDoc.name}" (${mode})${
            annotationsOmitted
              ? ` — ${maskedRuns.toLocaleString()} homopolymer runs, too many to annotate individually (bases masked, no annotations added)`
              : ''
          }`
        : `No homopolymer tracts >= 5 nt detected in "${activeDoc.name}"`
    );
  };

  const handleExtractAnnotatedFeatures = () => {
    const extracted = extractAnnotatedFeaturesToDocuments(activeDoc, 'all');
    if (extracted.length === 0) {
      setStatusBanner(`No annotated features found in "${activeDoc.name}" to extract.`);
      return;
    }
    setDocuments((prev) => [...extracted, ...prev]);
    selectDocumentWithHistory(extracted[0].id);
    applyDocTableEvent({ kind: 'result' });
    // One run extracts up to MAX_EXTRACTED_FEATURE_DOCUMENTS features (batch_ops.rs); a record
    // annotated with more has the rest left out, and the banner says how many (BG-01M6S1Q9).
    const leftOut = activeDoc.features.length - extracted.length;
    setStatusBanner(
      `Extracted ${extracted.length.toLocaleString()} annotated feature ${
        extracted.length === 1 ? 'sequence' : 'sequences'
      } from "${activeDoc.name}"${
        leftOut > 0
          ? ` — ${leftOut.toLocaleString()} of its ${activeDoc.features.length.toLocaleString()} features were left out (one run extracts at most ${extracted.length.toLocaleString()})`
          : ''
      }`
    );
  };

  const handleConvertSelectionToOligo = () => {
    if (!ensureCommandAvailable('nucleotide-analysis', 'Selection to Oligo')) return;
    if (!selectedRange) {
      setStatusBanner('Selection to Oligo: select the bases for the oligo first.');
      return;
    }
    const { updatedDoc, primer } = convertSelectionToOligoPrimer(activeDoc, selectedRange, 1);
    handleUpdateDocument(updatedDoc);
    openPrimersStudio('saved');
    setStatusBanner(
      `Converted ${primer.bindStart}..${primer.bindEnd} to oligo "${primer.name}" (${primer.length} nt, ${primerTmText(primer)})`
    );
  };

  const handleAnnotateGatewaySites = () => {
    if (!ensureCommandAvailable('nucleotide-analysis', 'Annotate att Sites')) return;
    const { updatedDoc, addedCount } = annotateGatewayAttSites(activeDoc);
    if (addedCount === 0) {
      setStatusBanner(`No unannotated Gateway attB/attP/attL/attR motifs found in "${activeDoc.name}".`);
      return;
    }
    handleUpdateDocument(updatedDoc);
    setViewerTab('sequence-view');
    setStatusBanner(
      `Annotated ${addedCount} Gateway att recombination ${
        addedCount === 1 ? 'site' : 'sites'
      } on "${activeDoc.name}"`
    );
  };

  const handleAddAttBSitesToActive = () => {
    if (!ensureCommandAvailable('nucleotide-analysis', 'Add attB Sites')) return;
    const amplicon = addAttBSitesToSequence(activeDoc, selectedRange);
    handleAddConstruct(amplicon);
    setStatusBanner(
      `Created Gateway BP-ready amplicon "${amplicon.name}" (${amplicon.sequence.length.toLocaleString()} bp)`
    );
  };

  const handleExportLineageBundle = () => {
    const bundle = exportLineageBundleGenBank(activeDoc, activeNonDeletedDocs);
    if (handleDownloadFile(bundle.content, `${activeDoc.name}_Lineage_Bundle.gb`) !== 'downloaded') return;
    setStatusBanner(
      `Exported lineage bundle (${bundle.includedNames.length} linked ${
        bundle.includedNames.length === 1 ? 'construct' : 'constructs'
      }: ${bundle.includedNames.join(', ')})`
    );
  };

  const handleExportBatchDocuments = (
    scope: 'selected' | 'folder',
    format: 'fasta' | 'gb' | 'fastq'
  ) => {
    const inScope = scope === 'folder' ? filteredDocuments : getTargetSelectedDocs();
    if (format === 'fastq') {
      // reads with their Phred qualities (FASTQ / SAM / BAM / .ab1 imports)
      const fq = exportReadsToFastq(inScope);
      if (!fq.written) {
        setStatusBanner(`Nothing to export as FASTQ: ${inScope.length ? 'the selected documents have no per-base qualities (import reads from FASTQ, SAM, BAM or .ab1)' : 'select reads in the table first'}.`);
        return;
      }
      const base = fq.written === 1 ? inScope.find((d) => !fq.skipped.includes(d.name))?.name ?? 'reads' : `${sessionName}_${fq.written}_reads`;
      if (handleDownloadFile(fq.text, `${base}.fastq`) !== 'downloaded') return;
      setStatusBanner(`Exported ${fq.written.toLocaleString()} read${fq.written === 1 ? '' : 's'} as FASTQ${fq.skipped.length ? ` (${fq.skipped.length} without qualities skipped)` : ''}`);
      return;
    }
    // FASTA needs residues: annotation-only records would become empty records.
    const docsToExport = format === 'fasta' ? inScope.filter((d) => d.sequence.length > 0) : inScope;
    const skipped = inScope.length - docsToExport.length;
    if (docsToExport.length === 0) {
      setStatusBanner(
        skipped > 0
          ? `Nothing to export as FASTA: the ${skipped} document${skipped === 1 ? ' has' : 's have'} no sequence (annotation-only).`
          : 'No documents in current scope to export.'
      );
      return;
    }
    const content =
      format === 'gb'
        ? docsToExport.map((d) => exportToGenBank(d)).join('\n\n')
        : docsToExport.map((d) => exportToFasta(d)).join('\n');
    const baseLabel =
      scope === 'folder'
        ? selectedFolder.replace(/[^A-Za-z0-9_-]/g, '_')
        : docsToExport.length === 1
        ? docsToExport[0].name
        : `${sessionName}_${docsToExport.length}_Selected`;
    if (handleDownloadFile(content, `${baseLabel}.${format}`) !== 'downloaded') return;
    setStatusBanner(
      `Exported ${docsToExport.length} ${
        docsToExport.length === 1 ? 'document' : 'documents'
      } as .${format}${skipped > 0 ? ` (${skipped} annotation-only record${skipped === 1 ? '' : 's'} without sequence skipped)` : ''}`
    );
  };

  /**
   * Show or hide the inspector of the open tab. A tab with nothing to set keeps its open state as
   * it is, and stays the open tab (the toggle once switched to the Sequence tab).
   */
  const handleToggleInspector = () => {
    if (!inspectorAvailable) {
      setStatusBanner('Inspector: this view has no settings to show.');
      return;
    }
    setRightPanelOpen((v) => !v);
  };

  /** Open the document-table filter panel and focus its quick-filter field. */
  const handleFocusFolderFilter = () => {
    setDocTableCollapsed(false);
    setDocFilterOpen(true);
    window.setTimeout(() => {
      document.getElementById('mbc-folder-filter-input')?.focus();
    }, 30);
  };

  /** View › Document Table; the native menu command applies the same event, and the pane's own toggle does too (below). */
  const toggleDocumentTable = () => requireActiveSession(() => applyDocTableEvent({ kind: 'toggle' }));
  /** The document table pane, whichever slot of the centre stack it is in. */
  const docTablePaneRef = useRef<HTMLElement | null>(null);
  /** Set when the pane's toggle folds or opens the table while it has keyboard focus. */
  const docTableToggleRefocusRef = useRef(false);
  /**
   * The pane's own toggle, in the record bar or the table's toolbar. Folding or opening the table can
   * put a new pane on screen, and the toggle that had focus goes with the old one: the stacked layout
   * moves the table between the top and the bottom of the workspace, and with a record open the
   * record bar and the toolbar replace each other. So when the toggle had keyboard focus, focus moves
   * to the toggle of the pane now on screen (US-01M6S7T2).
   */
  const toggleDocumentTableFromPane = () =>
    requireActiveSession(() => {
      const pane = docTablePaneRef.current;
      const toggle = pane?.querySelector('.mbc-doc-table-toggle');
      docTableToggleRefocusRef.current = !!toggle && toggle === pane?.ownerDocument.activeElement;
      applyDocTableEvent({ kind: 'toggle' });
    });
  useIsomorphicLayoutEffect(() => {
    if (!docTableToggleRefocusRef.current) return;
    docTableToggleRefocusRef.current = false;
    const toggle = docTablePaneRef.current?.querySelector<HTMLElement>('.mbc-doc-table-toggle');
    if (toggle && toggle !== toggle.ownerDocument.activeElement) toggle.focus();
  }, [docTableCollapsed]);
  /**
   * The folded table shows the open record: the document the viewer is showing, when there is one.
   * The viewer shows the active document only while it is selected (the same test as the viewer's
   * empty state below), so a deselected active row, or an empty folder where `activeDoc` falls back
   * to the project's first document, folds to the folder bar instead of naming a record not on show.
   */
  const recordBarDoc = docTableCollapsed && activeDoc.id && checkedIdsSet.has(activeDocId) ? activeDoc : null;
  /**
   * In the stacked layout the expanded table sits below the viewer, while the folded table (the
   * record bar or the folder bar) stays on top; the side-by-side layout keeps the table first
   * (US-01M6S7T2).
   */
  const docTableBelowViewer = workspaceSplitMode === 'top-bottom' && !docTableCollapsed;
  /**
   * Where the empty states send a researcher for the table: below the viewer while the stacked
   * layout shows it, on the left side by side, and, while it is folded, to the Document table
   * control on the bar above, which opens it.
   */
  const docTableWhere = docTableCollapsed
    ? 'the document table (open it with the Document table control above)'
    : workspaceSplitMode === 'top-bottom'
    ? 'the table below'
    : 'the table on the left';

  /** Copy the selection (or the whole active sequence); reports the real outcome. */
  const handleCopySequenceToClipboard = () => {
    if (!ensureCommandAvailable('export-sequence', 'Copy Sequence')) return;
    const sub = selectedRange
      ? activeDoc.sequence.slice(selectedRange.start - 1, selectedRange.end)
      : activeDoc.sequence;
    const unit = activeDoc.moleculeType === 'Protein' ? 'aa' : 'bp';
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setStatusBanner('Copy failed: the clipboard is not available in this environment.');
      return;
    }
    navigator.clipboard.writeText(sub).then(
      () => setStatusBanner(`Copied ${sub.length.toLocaleString()} ${unit} to clipboard`),
      (err: unknown) =>
        setStatusBanner(`Copy failed: ${err instanceof Error ? err.message : String(err)}`)
    );
  };

  /** Export the active document; refused (with a reason) when there is no real document. */
  const handleExportActiveDocument = (format: 'genbank' | 'fasta' | 'embl' | 'gff3') => {
    const label = { genbank: 'Export GenBank', fasta: 'Export FASTA', embl: 'Export EMBL', gff3: 'Export GFF3' }[format];
    if (!ensureCommandAvailable(format === 'fasta' ? 'export-sequence' : 'export-active-document', label)) return;
    try {
      const content =
        format === 'genbank'
          ? exportToGenBank(activeDoc)
          : format === 'fasta'
            ? exportToFasta(activeDoc)
            : format === 'embl'
              ? exportToEMBL(activeDoc)
              : exportToGFF3(activeDoc);
      const ext = format === 'genbank' ? 'gb' : format;
      const outcome = handleDownloadFile(content, `${activeDoc.name || 'MolBioCraft_Export'}.${ext}`);
      if (outcome === 'downloaded') setStatusBanner(`Exported "${activeDoc.name}.${ext}"`);
    } catch (err) {
      setStatusBanner(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /**
   * Export › Alignment Image (US-01M6S8C5): the active alignment drawn whole from its data, never
   * from the scrolled grid. One too large to draw whole is refused at once, naming the limit; the
   * consensus is the grid's own, called under the settings its Display inspector last set.
   */
  const handleExportAlignmentImage = (format: FigureImageFormat) => {
    const doc = activeDoc;
    const rows = alignmentImageRows(doc);
    if (!rows) {
      setStatusBanner(`Alignment Image needs an alignment open: "${doc.name}" is not one.`);
      return;
    }
    const refusal = alignmentImageRefusal(doc.name, rows);
    if (refusal) {
      setStatusBanner(refusal);
      return;
    }
    void import('./components/AlignmentAndPhyloStudio')
      .then((studio) => {
        const settings = studio.alignmentConsensusSettingsFor(doc.id);
        const { consensus } = studio.alignmentGridConsensus(doc, rows, settings);
        return exportAlignmentImage(doc, rows, { consensus, consensusLabel: studio.alignmentConsensusLabel(settings.threshold) }, format);
      })
      .then(({ outcome, filename, error }) =>
        setStatusBanner(outcome === 'native' ? `Choose where to save "${filename}"` : outcome === 'downloaded'
          ? `Exported "${filename}"` : `Alignment Image export failed: ${error ?? filename}`))
      .catch((err) => setStatusBanner(`Alignment Image export failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  const handleSaveViewerAsSvgImage = () => {
    // The first <svg> in the viewer is the 22-px construct scrubber (or an
    // icon), not the map. Prefer the known map roots, else the largest SVG
    // that is not a control icon.
    const root = viewerCanvasRef.current;
    const mapSelectors = ['svg.plasmid-svg', 'svg.schematic-overview-svg', 'svg.mbc-wrapped-genome-svg'];
    let svgEl: SVGSVGElement | null = null;
    for (const sel of mapSelectors) {
      svgEl = root?.querySelector<SVGSVGElement>(sel) ?? null;
      if (svgEl) break;
    }
    if (!svgEl && root) {
      let bestArea = 0;
      root.querySelectorAll<SVGSVGElement>('svg').forEach((el) => {
        if (el.closest('button, .mbc-cockpit-bar, [aria-hidden="true"]')) return;
        const box = el.getBoundingClientRect();
        const area = box.width * box.height;
        if (box.height >= 64 && area > bestArea) {
          bestArea = area;
          svgEl = el;
        }
      });
    }
    let svgMarkup = '';
    if (svgEl) {
      const cloned = (svgEl as SVGSVGElement).cloneNode(true) as SVGSVGElement;
      if (!cloned.getAttribute('xmlns')) {
        cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      svgMarkup = new XMLSerializer().serializeToString(cloned);
      // Theme colours are CSS custom properties; resolve them so the exported
      // file renders the same outside the app.
      const rootStyle = getComputedStyle(document.documentElement);
      svgMarkup = svgMarkup.replace(/var\((--[A-Za-z0-9-]+)(?:,\s*([^)]+))?\)/g, (_m, name: string, fallback?: string) =>
        rootStyle.getPropertyValue(name).trim() || (fallback ?? '').trim() || 'currentColor'
      );
    } else {
      const metrics = computeDocumentTableMetrics(activeDoc);
      svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="220" viewBox="0 0 760 220">
  <rect width="760" height="220" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
  <text x="28" y="48" font-family="Google Sans, system-ui, sans-serif" font-size="20" font-weight="700" fill="#0f172a">${activeDoc.name} (${activeDoc.accession})</text>
  <text x="28" y="82" font-family="Google Sans, system-ui, sans-serif" font-size="14" fill="#334155">${metrics.docTypeLabel} • ${activeDoc.topology.toUpperCase()} • ${metrics.lengthLabel} • GC ${metrics.gcLabel} • ${metrics.annotationsCount} annotations</text>
  <rect x="28" y="112" width="704" height="26" rx="6" fill="#dbeafe" stroke="#2563eb"/>
  <text x="40" y="130" font-family="Google Sans Code, monospace" font-size="12" fill="#1e3a8a">${activeDoc.sequence.slice(0, 78)}${activeDoc.sequence.length > 78 ? '...' : ''}</text>
  <text x="28" y="178" font-family="Space Grotesk, Google Sans, system-ui, sans-serif" font-size="12" fill="#64748b">Exported from MolBioCraft Molecular Biology Workbench</text>
</svg>`;
    }
    if (handleDownloadFile(svgMarkup, `${activeDoc.name}_Map_View.svg`, 'image/svg+xml;charset=utf-8') !== 'downloaded') return;
    setStatusBanner(`Saved vector graphic "${activeDoc.name}_Map_View.svg"`);
  };

  const handleExportPreferencesFile = () => {
    const payload = JSON.stringify(
      {
        format: 'molbiocraft-preferences',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        themePref,
        workspaceSplitMode,
        mapLayoutMode,
        colorScheme,
        visibleColumns,
        lockColumnOrder,
        customFolders,
        folderColors,
        userPreferences: loadUserPreferences(),
        displaySettings: {
          showOrfs,
          minOrfAa,
          allowAltStartCodons,
          showPrimers,
          showTranslation,
          showGcGraph,
          showHydropathyGraph,
          showUniqueCuttersOnly,
        },
      },
      null,
      2
    );
    const outcome = handleDownloadFile(
      payload,
      'MolBioCraft_Preferences.mbcprefs.json',
      'application/json;charset=utf-8'
    );
    if (outcome === 'downloaded') {
      setStatusBanner('Exported preferences to "MolBioCraft_Preferences.mbcprefs.json"');
    }
  };

  const applyImportedPreferencesFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      // Any JSON used to "import" successfully. Only accept our own format.
      if (!parsed || typeof parsed !== 'object' || parsed.format !== 'molbiocraft-preferences') {
        throw new Error(`"${file.name}" is not a MolBioCraft preferences file`);
      }
      const applied: string[] = [];
      if (
        parsed.themePref === 'light' ||
        parsed.themePref === 'dark' ||
        parsed.themePref === 'system'
      ) {
        applyThemePreference(parsed.themePref);
        applied.push('theme');
      }
      if (
        parsed.workspaceSplitMode === 'top-bottom' ||
        parsed.workspaceSplitMode === 'left-right'
      ) {
        setWorkspaceSplitMode(parsed.workspaceSplitMode);
        applied.push('layout');
      }
      if (Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length > 0) {
        setVisibleColumns(parsed.visibleColumns.map(String));
        applied.push('table columns');
      }
      if (typeof parsed.lockColumnOrder === 'boolean') {
        setLockColumnOrder(parsed.lockColumnOrder);
      }
      // The export also writes these; they used to be silently ignored on import.
      if (parsed.mapLayoutMode === 'split' || parsed.mapLayoutMode === 'circular' || parsed.mapLayoutMode === 'linear') {
        setMapLayoutMode(parsed.mapLayoutMode);
        applied.push('map layout');
      }
      if (typeof parsed.colorScheme === 'string' && NUCLEOTIDE_COLOR_SCHEMES.includes(parsed.colorScheme as NucleotideColorScheme)) {
        setColorScheme(parsed.colorScheme as NucleotideColorScheme);
        applied.push('colour scheme');
      }
      if (parsed.userPreferences && typeof parsed.userPreferences === 'object') {
        saveUserPreferences(normalizeUserPreferences(parsed.userPreferences));
        applied.push('workbench preferences');
      }
      const ds = parsed.displaySettings as Record<string, unknown> | undefined;
      if (ds && typeof ds === 'object') {
        const bool = (k: string, set: (v: boolean) => void) => {
          if (typeof ds[k] === 'boolean') set(ds[k] as boolean);
        };
        bool('showOrfs', setShowOrfs);
        bool('allowAltStartCodons', setAllowAltStartCodons);
        bool('showPrimers', setShowPrimers);
        bool('showTranslation', setShowTranslation);
        bool('showGcGraph', setShowGcGraph);
        bool('showHydropathyGraph', setShowHydropathyGraph);
        bool('showUniqueCuttersOnly', setShowUniqueCuttersOnly);
        if (typeof ds.minOrfAa === 'number' && Number.isFinite(ds.minOrfAa) && ds.minOrfAa >= 1) {
          setMinOrfAa(Math.round(ds.minOrfAa));
        }
        applied.push('display settings');
      }
      setStatusBanner(
        applied.length
          ? `Imported preferences from "${file.name}" (${applied.join(', ')})`
          : `"${file.name}" contained no preferences this version can apply`
      );
    } catch (err) {
      setStatusBanner(
        `Preferences import error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleImportPreferencesFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await applyImportedPreferencesFile(file);
    } finally {
      e.target.value = '';
    }
  };

  // Batch Workflow Runners
  const handleWorkflowModifyAnnotationIntervals = () => {
    // Previously applied a hidden, hard-coded "+3 bp at every end" edit.
    if (!ensureCommandAvailable('document-edit', 'Modify Intervals')) return;
    if (activeDoc.features.length === 0) {
      setStatusBanner(`"${activeDoc.name}" has no annotations to modify.`);
      return;
    }
    const target = activeDoc;
    setPromptDialog({
      title: 'Modify Annotation Intervals',
      label: `Shift every annotation start and end on "${target.name}" (bp, start, end — e.g. "-10, 10")`,
      value: '0, 0',
      placeholder: 'start shift, end shift',
      confirmLabel: 'Apply',
      onConfirm: (entered) => {
        const m = entered.trim().match(/^([+-]?\d+)\s*[, ]\s*([+-]?\d+)$/);
        if (!m) {
          setStatusBanner('Modify Intervals: enter two whole numbers, e.g. "-10, 10".');
          return;
        }
        const dStart = Number(m[1]);
        const dEnd = Number(m[2]);
        if (dStart === 0 && dEnd === 0) {
          setStatusBanner('Modify Intervals: nothing to change (both shifts are 0).');
          return;
        }
        const updated = batchModifyAnnotationIntervals(target, dStart, dEnd);
        handleUpdateDocument(updated, 'Modify Annotation Intervals');
        setViewerTab('annotations-table');
        setStatusBanner(
          `Shifted ${updated.features.length} annotation ${
            updated.features.length === 1 ? 'interval' : 'intervals'
          } on "${target.name}" (start ${dStart >= 0 ? '+' : ''}${dStart} bp, end ${dEnd >= 0 ? '+' : ''}${dEnd} bp)`
        );
      },
    });
  };

  const handleWorkflowSetCdsTranslation = () => {
    if (!ensureCommandAvailable('nucleotide-analysis', 'Set CDS Translation')) return;
    const updated = batchSetCdsTranslationProperty(activeDoc);
    handleUpdateDocument(updated);
    setViewerTab('annotations-table');
    setStatusBanner(`Populated /translation & /transl_table qualifiers across all CDS annotations in "${activeDoc.name}"`);
  };

  const handleWorkflowRandomlySample = () => {
    const sampled = randomlySampleDocuments(
      filteredDocuments,
      Math.max(1, Math.ceil(filteredDocuments.length / 2))
    );
    const sampledIds = sampled.map((d) => d.id);
    setCheckedDocIds(sampledIds);
    if (sampled[0]) setActiveDocId(sampled[0].id);
    setStatusBanner(
      `Randomly sampled ${sampled.length} of ${filteredDocuments.length} sequences in "${selectedFolder}"`
    );
  };

  const handleWorkflowGroupByName = () => {
    const { updatedDocs, groupsCreated } = groupDocumentsByPrefix(documents);
    if (groupsCreated.length === 0) {
      setStatusBanner('No shared name prefixes (>=2 constructs) detected to group.');
      return;
    }
    setDocuments(updatedDocs);
    setCustomFolders((prev) => Array.from(new Set([...prev, ...groupsCreated])));
    setSelectedFolder(groupsCreated[0]);
    setStatusBanner(
      `Grouped sequences by prefix into ${groupsCreated.length} ${
        groupsCreated.length === 1 ? 'folder' : 'folders'
      }: ${groupsCreated.join(', ')}`
    );
  };

  // Native macOS system menu bar & native Cocoa Open/Save sheet bridge
  const nativeMenuDispatchRef = useRef<{
    onMenuAction: (actionId: string) => void;
    onNativeFileOpen: (file: File, mode: NativeFileOpenMode) => void;
    onNativeFileSaved: (savedFilename: string) => void;
    onNativeFileError: (message: string) => void;
    onNativeFileDrag: (active: boolean) => void;
    onNativeFolderImportLeftOut: (filesLeftOut: number, filesRead: number) => void;
  }>({
    onMenuAction: () => {},
    onNativeFileOpen: () => {},
    onNativeFileSaved: () => {},
    onNativeFileError: () => {},
    onNativeFileDrag: () => {},
    onNativeFolderImportLeftOut: () => {},
  });

  nativeMenuDispatchRef.current = {
    onMenuAction: (actionId: string) => {
      setOpenTopMenu(null);
      setOpenToolbarDropdown(null);
      switch (actionId) {
        case 'app:about':
        case 'help:about':
          setAboutModalOpen(true);
          break;
        case 'app:preferences':
        case 'tools:preferences':
        case 'help:updates':
          setPrefsModalTab('General');
          break;
        case 'app:toggle-theme':
          handleQuickThemeToggle();
          break;
        case 'app:request-quit':
        case 'file:quit':
          // Prove liveness so the backend keeps waiting for our confirmation.
          ackQuitRequestTauri().catch(() => {});
          handleRequestAppQuit();
          break;
        case 'help:shortcuts':
          setPrefsModalTab('Keyboard');
          break;

        // New Session actions (always start/activate a session)
        case 'new-session:blank':
          handleStartNewSession('blank');
          break;
        case 'new-session:sequence':
        case 'file:new-sequence':
        case 'sequence:new':
          handleStartNewSession('new-sequence');
          break;
        case 'new-session:vector-catalog':
          handleStartNewSession('vector-catalog');
          break;
        case 'new-session:vector-architect':
          handleStartNewSession('vector-architect');
          break;
        case 'new-session:twist-onboarding':
        case 'help:vector-guide':
          handleStartNewSession('twist-onboarding');
          break;
        case 'new-session:text-doc':
          handleStartNewSession('text-doc');
          break;
        case 'new-session:cloning-restriction':
          handleStartNewSession('cloning-restriction');
          break;
        case 'new-session:cloning-assembly':
          handleStartNewSession('cloning-assembly');
          break;
        case 'new-session:primers-crispr':
          handleStartNewSession('primers-crispr');
          break;
        case 'new-session:enzyme-set':
          handleStartNewSession('enzyme-set');
          break;
        case 'new-session:align-task':
          handleStartNewSession('align-task');
          break;
        case 'new-session:phylo-task':
          handleStartNewSession('phylo-task');
          break;
        case 'new-session:sanger-task':
          handleStartNewSession('sanger-task');
          break;
        case 'new-session:ngs-genomics':
          handleStartNewSession('ngs-genomics');
          break;
        case 'new-session:pipeline-task':
          handleStartNewSession('pipeline-task');
          break;
        case 'new-session:import-files':
        case 'file:import-files':
          handleStartNewSession('import-files');
          break;
        case 'file:import-folder':
          triggerImportFolderPicker();
          break;
        case 'file:import-samples':
          handleImportSampleDocuments();
          break;
        case 'new-session:import-clipboard':
        case 'file:import-clipboard':
          handleImportFromClipboardAction();
          break;
        case 'file:import-sanger':
          setHomeViewActive(false);
          handleStartNewSession('sanger-task');
          break;
        case 'file:import-ngs':
          setHomeViewActive(false);
          handleStartNewSession('ngs-genomics');
          break;
        case 'file:import-vector-catalog':
          setHomeViewActive(false);
          handleStartNewSession('vector-catalog');
          break;
        case 'file:import-twist-vector':
          setHomeViewActive(false);
          handleStartNewSession('twist-onboarding');
          break;
        case 'file:import-ncbi-db':
          setDbExplorerCategory('ncbi-nucleotide');
          break;
        case 'new-session:folder':
        case 'file:new-folder':
          handleStartNewSession('new-folder');
          break;
        case 'new-session:sample-library':
        case 'file:reset-library':
        case 'help:tutorials':
          handleStartNewSession('sample-library');
          break;
        case 'help:panel':
          setHelpPanelOpen((o) => !o);
          break;
        case 'help:examples':
          // Works without a session: adding the examples opens one.
          setHomeViewActive(false);
          setOperationDialog({ kind: 'examples' });
          break;

        // Open, Restore, Save & Close Session
        case 'file:open-session':
          triggerOpenMbcPicker('replace');
          break;
        case 'file:merge-session':
          requireActiveSession(() => triggerOpenMbcPicker('merge'));
          break;
        case 'file:restore-autosave':
          handleRestoreLocalAutosave();
          break;
        case 'file:close-session':
          handleCloseSession();
          break;
        case 'file:save-session':
          requireActiveSession(() => handleSaveMbcWorkbench(false));
          break;
        case 'file:save-session-as':
          requireActiveSession(() => handleSaveMbcWorkbench(true));
          break;

        // Sequence Export & Print (requires active session)
        case 'file:save-gb':
          requireActiveSession(() =>
            handleExportActiveDocument('genbank')
          );
          break;
        case 'file:save-fasta':
          requireActiveSession(() =>
            handleExportActiveDocument('fasta')
          );
          break;
        case 'file:export-embl':
          requireActiveSession(() =>
            handleExportActiveDocument('embl')
          );
          break;
        case 'file:export-gff3':
          requireActiveSession(() =>
            handleExportActiveDocument('gff3')
          );
          break;
        case 'file:print':
          requireActiveSession(() => handlePrintWorkbench());
          break;

        // Edit, View, Enzymes, Features, Actions, Tools, Sequence, Annotate & Predict (guarded by active session)
        case 'edit:copy-sequence':
requireActiveSession(() => handleCopySequenceToClipboard());
          break;
        case 'edit:select-all-sequence':
          requireActiveSession(() =>
            setSelectedRange({
              start: 1,
              end: activeDoc.sequence.length,
              label: 'Full Sequence',
            })
          );
          break;
        case 'edit:find-in-doc':
          requireActiveSession(() => {
            setViewerTab('sequence-view');
            setMapLayoutMode((m) => (m === 'circular' ? 'split' : m));
            window.setTimeout(() => {
              document.getElementById('mbc-seq-search-input')?.focus();
            }, 40);
          });
          break;
        case 'edit:next-feature':
          requireActiveSession(() => handleSelectNextFeature());
          break;

        case 'view:back':
          requireActiveSession(() => handleGoBack());
          break;
        case 'view:forward':
          requireActiveSession(() => handleGoForward());
          break;
        case 'view:home':
          if (sessionActive) setHomeViewActive((v) => !v);
          break;
        case 'view:toggle-sidebar':
          setSidebarOpen((v) => !v);
          break;
        case 'view:toggle-doctable':
          requireActiveSession(() => applyDocTableEvent({ kind: 'toggle' }));
          break;
        case 'view:toggle-inspector':
          requireActiveSession(() => handleToggleInspector());
          break;
        case 'view:layout-split':
          requireActiveSession(() => {
            setViewerTab('sequence-view');
            setMapLayoutMode('split');
          });
          break;
        case 'view:layout-circular':
          requireActiveSession(() => {
            setViewerTab('sequence-view');
            setMapLayoutMode('circular');
          });
          break;
        case 'view:layout-linear':
          requireActiveSession(() => {
            setViewerTab('sequence-view');
            setMapLayoutMode('linear');
          });
          break;
        case 'view:enzymes':
        case 'enzymes:choose':
        case 'enzymes:table':
          requireActiveSession(() => openHybridSubTab('enzymes-view'));
          break;
        case 'view:annotations':
          requireActiveSession(() => setViewerTab('annotations-table'));
          break;
        case 'features:add':
          requireActiveSession(() => handleAddFeatureFromSelection());
          break;
        case 'annotate:transfer':
          requireActiveSession(() => handleOpenTransferAnnotations());
          break;
        case 'tools:extract-annotations':
          requireActiveSession(() => handleExtractAnnotatedFeatures());
          break;
        case 'file:rename-folder':
          requireActiveSession(() => handleRenameSelectedFolder());
          break;
        case 'file:set-folder-color':
          requireActiveSession(() => handleCycleSelectedFolderColor());
          break;
        case 'file:move-to-folder':
          requireActiveSession(() => handleMoveSelectedDocsToFolder());
          break;
        case 'file:toggle-favorite':
          requireActiveSession(() => handleToggleFavoriteDocs());
          break;
        case 'file:soft-delete':
          requireActiveSession(() => handleSoftDeleteSelectedDocs());
          break;
        case 'file:restore-deleted':
          requireActiveSession(() => handleRestoreFromDeletedItems());
          break;
        case 'file:erase-deleted':
          requireActiveSession(() => handleEraseAllDeletedItems());
          break;
        case 'file:backup-data':
          requireActiveSession(() => handleSaveMbcWorkbench(true));
          break;
        case 'file:restore-backup':
          triggerOpenMbcPicker('replace');
          break;
        case 'file:import-preferences':
          triggerImportPreferencesPicker();
          break;
        case 'file:export-preferences':
          handleExportPreferencesFile();
          break;
        case 'file:export-batch-fasta':
          requireActiveSession(() => handleExportBatchDocuments('selected', 'fasta'));
          break;
        case 'file:export-batch-fastq':
          requireActiveSession(() => handleExportBatchDocuments('selected', 'fastq'));
          break;
        case 'file:export-mbc-json':
          requireActiveSession(() => handleExportMbcJson());
          break;
        case 'file:export-folder-mbc':
          requireActiveSession(() => handleExportFolderMbc());
          break;
        case 'file:export-folder-gb':
          requireActiveSession(() => handleExportBatchDocuments('folder', 'gb'));
          break;
        case 'file:export-lineage':
          requireActiveSession(() => handleExportLineageBundle());
          break;
        case 'file:export-consensus':
          requireActiveSession(() => handleExportConsensusFasta());
          break;
        case 'file:save-svg-image':
          requireActiveSession(() => handleSaveViewerAsSvgImage());
          break;
        case 'view:filter-folder':
          requireActiveSession(() => handleFocusFolderFilter());
          break;
        case 'view:search-tools':
          window.setTimeout(() => {
            document.getElementById('mbc-toolbar-global-search-input')?.focus();
          }, 30);
          break;
        case 'view:split-top-bottom':
          requireActiveSession(() => {
            setDocTableCollapsed(false);
            setWorkspaceSplitMode('top-bottom');
          });
          break;
        case 'view:split-left-right':
          requireActiveSession(() => {
            setDocTableCollapsed(false);
            setWorkspaceSplitMode('left-right');
          });
          break;
        case 'view:expand-doc-view':
          requireActiveSession(() => handleToggleExpandDocumentView());
          break;
        case 'view:col-preset-cloning':
          requireActiveSession(() => handleApplyColumnPreset('standard-cloning'));
          break;
        case 'view:col-preset-align':
          requireActiveSession(() => handleApplyColumnPreset('alignment-phylogeny'));
          break;
        case 'view:col-preset-genomics':
          requireActiveSession(() => handleApplyColumnPreset('genomics-sequencing'));
          break;
        case 'view:col-preset-all':
          requireActiveSession(() => handleApplyColumnPreset('all-columns'));
          break;
        case 'view:col-lock':
          requireActiveSession(() => setLockColumnOrder((v) => !v));
          break;
        case 'tools:databases-explorer':
          setDbExplorerCategory('ncbi-nucleotide');
          break;
        case 'align:expression-levels-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'expression-levels' }));
          break;
        case 'align:structural-variants-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'structural-variants' }));
          break;
        case 'align:structures-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'align-structures' }));
          break;
        case 'tools:make-blast-db':
          requireActiveSession(() => setOperationDialog({ kind: 'make-blast-db' }));
          break;
        case 'tools:local-blast-dbs':
        case 'tools:blast-setup':
          setDbExplorerCategory('local-blast-dbs');
          break;
        case 'tools:mask-selection':
          requireActiveSession(() => handleMaskActiveSequence('selection'));
          break;
        case 'tools:mask-low-complexity':
          requireActiveSession(() => handleMaskActiveSequence('low-complexity'));
          break;
        case 'tools:concatenate':
          requireActiveSession(() => handleConcatenateSelectedSequences());
          break;
        case 'tools:generate-consensus':
          requireActiveSession(() => handleGenerateConsensusFromSelected());
          break;
        case 'primers:convert-to-oligo':
          requireActiveSession(() => handleConvertSelectionToOligo());
          break;
        case 'actions:annotate-att':
          requireActiveSession(() => handleAnnotateGatewaySites());
          break;
        case 'actions:add-attb':
          requireActiveSession(() => handleAddAttBSitesToActive());
          break;
        case 'workflows:manage':
          requireActiveSession(() => setManageWorkflowsOpen(true));
          break;
        case 'workflows:run':
          requireActiveSession(() => setRunWorkflowFor({}));
          break;
        case 'workflows:modify-intervals':
          requireActiveSession(() => handleWorkflowModifyAnnotationIntervals());
          break;
        case 'workflows:set-cds-translation':
          requireActiveSession(() => handleWorkflowSetCdsTranslation());
          break;
        case 'workflows:random-sample':
          requireActiveSession(() => handleWorkflowRandomlySample());
          break;
        case 'workflows:group-by-name':
          requireActiveSession(() => handleWorkflowGroupByName());
          break;
        case 'view:text':
          requireActiveSession(() => setViewerTab('text-view'));
          break;
        case 'view:secondary-structure':
          requireActiveSession(() => openHybridSubTab('secondary-structure'));
          break;
        case 'view:lineage':
        case 'tools:workflows':
          requireActiveSession(() => openHybridSubTab('lineage'));
          break;
        case 'view:zoom-in':
          requireActiveSession(() => setZoomLevel((z) => stepSequenceZoom(z, 1)));
          break;
        case 'view:zoom-out':
          requireActiveSession(() => setZoomLevel((z) => stepSequenceZoom(z, -1)));
          break;
        case 'view:zoom-reset':
          requireActiveSession(restoreSequenceView);
          break;
        case 'view:set-origin':
          requireActiveSession(() => handleSetOriginToSelection());
          break;

        case 'enzymes:find-sites':
          requireActiveSession(() => {
            setViewerTab('sequence-view');
            setRightPanelOpen(true);
            setOpenRightPanels((p) => ({ ...p, restriction: true }));
          });
          break;
        case 'enzymes:noncutters':
          requireActiveSession(() =>
            openCloningMethod('Restriction Ligation', 'non-cutters')
          );
          break;
        case 'enzymes:silent-mutations':
          requireActiveSession(() =>
            openCloningMethod('Restriction Ligation', 'silent-mutations')
          );
          break;
        case 'enzymes:suppliers':
        case 'prefs:enzymes':
          setPrefsModalTab('Enzymes');
          break;
        case 'prefs:gels':
          setPrefsModalTab('Agarose Gels');
          break;
        case 'prefs:traces':
          setPrefsModalTab('Traces & Alignment');
          break;
        case 'prefs:primers':
        case 'primers:preferences':
          setPrefsModalTab('Primers');
          break;

        case 'features:detect-common':
          requireActiveSession(() => handleAutoDetectCommonFeatures());
          break;
        case 'features:add-protease':
          requireActiveSession(() => handleDetectTagsAndProteaseSites());
          break;
        case 'features:manage-library':
          requireActiveSession(() => {
            setSidebarOpen(true);
            setViewerTab('annotations-table');
          });
          break;

        case 'primers:add':
        case 'primers:add-list':
          requireActiveSession(() => setOperationDialog({ kind: 'import-primers' }));
          break;
        case 'primers:crispr-editing-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'crispr-editing' }));
          break;
        case 'primers:design':
        case 'actions:pcr':
        case 'tools:primers':
          requireActiveSession(() => openPrimersStudio('design'));
          break;
        case 'primers:import-saved':
        case 'primers:specificity':
          requireActiveSession(() => openPrimersStudio('saved'));
          break;
        case 'primers:export':
          requireActiveSession(() => handleExportPrimersFasta());
          break;
        case 'primers:crispr':
        case 'annotate:find-crispr':
          requireActiveSession(() => openPrimersStudio('crispr'));
          break;
        case 'primers:pcr':
          requireActiveSession(() => setViewerTab('primers-pcr'));
          break;
        case 'primers:mutagenesis':
          requireActiveSession(() =>
            openCloningMethod('Restriction Ligation', 'mutagenesis')
          );
          break;

        case 'actions:restriction-cloning':
        case 'actions:ligate-fragments':
        case 'tools:agarose-gel':
          requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel'));
          break;
        case 'actions:parts-cloning':
          requireActiveSession(() => openCloningMethod('Parts Cloning', 'gel'));
          break;
        case 'actions:soe-pcr':
          requireActiveSession(() => openCloningMethod('Overlap Extension PCR', 'gel'));
          break;
        case 'actions:mutagenesis':
          requireActiveSession(() =>
            openCloningMethod('Restriction Ligation', 'mutagenesis')
          );
          break;
        case 'actions:gateway':
          requireActiveSession(() =>
            openCloningMethod('Gateway BP/LR Recombination', 'gel')
          );
          break;
        case 'actions:gibson':
          requireActiveSession(() => openCloningMethod('Gibson Assembly', 'gel'));
          break;
        case 'actions:golden-gate':
          requireActiveSession(() => openCloningMethod('Golden Gate (Type IIS)', 'gel'));
          break;
        case 'actions:in-fusion':
          requireActiveSession(() => openCloningMethod('In-Fusion Cloning', 'gel'));
          break;
        case 'actions:hifi':
          requireActiveSession(() => openCloningMethod('NEBuilder HiFi Assembly', 'gel'));
          break;
        case 'actions:ta-gc':
          requireActiveSession(() => openCloningMethod('TA / GC Cloning', 'gel'));
          break;
        case 'actions:topo':
          requireActiveSession(() => openCloningMethod('TOPO Cloning', 'gel'));
          break;
        case 'actions:anneal-oligos':
          requireActiveSession(() =>
            openCloningMethod('Restriction Ligation', 'anneal-oligos')
          );
          break;

        case 'tools:dna-calc':
          requireActiveSession(() =>
            openCloningMethod('Restriction Ligation', 'dna-calculations')
          );
          break;
        case 'tools:blast':
        case 'annotate:blast':
          requireActiveSession(() => setOperationDialog({ kind: 'annotate-by-blast' }));
          break;
        case 'tools:vectors':
          requireActiveSession(() => openVectorStudio('catalog'));
          break;
        case 'tools:vectors-architect':
          requireActiveSession(() => openVectorStudio('architect'));
          break;
        // Dedicated Main Menu: Alignment
        case 'align:msa-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'align' }));
          break;
        case 'align:pairwise-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'pairwise' }));
          break;
        case 'enzymes:digest-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'digest' }));
          break;
        case 'primers:design-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'primers' }));
          break;
        case 'primers:degenerate-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'degenerate-primers' }));
          break;
        case 'annotate:from-documents-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'annotate-from-documents' }));
          break;
        case 'primers:test-saved-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'saved-primers' }));
          break;
        case 'align:trim-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'trim' }));
          break;
        case 'sequence:back-translate-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'backtranslate' }));
          break;
        case 'annotate:find-orfs-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'orfs' }));
          break;
        case 'actions:clone-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'cloning' }));
          break;
        case 'align:denovo-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'denovo' }));
          break;
        case 'align:map-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'map' }));
          break;
        case 'align:translation-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'transalign' }));
          break;
        case 'align:highlight-sites-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'highlight-sites' }));
          break;
        case 'align:add-to-alignment-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'add-to-alignment' }));
          break;
        case 'align:qc-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'read-qc' }));
          break;
        case 'align:merge-pairs-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'merge-pairs' }));
          break;
        case 'annotate:microsatellites-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'microsatellites' }));
          break;
        case 'annotate:expression-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'expression' }));
          break;
        case 'annotate:compare-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'compare-annotations' }));
          break;
        case 'file:import-metadata':
          requireActiveSession(() => setOperationDialog({ kind: 'import-metadata' }));
          break;
        case 'actions:validate-clone-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'validate-clone' }));
          break;
        case 'align:mask-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'mask' }));
          break;
        case 'align:consensus-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'consensus' }));
          break;
        case 'edit:find-duplicates':
          requireActiveSession(() => setOperationDialog({ kind: 'duplicates' }));
          break;
        case 'edit:batch-rename':
          requireActiveSession(() => setOperationDialog({ kind: 'rename' }));
          break;
        case 'phylo:build-tree':
          requireActiveSession(() => setOperationDialog({ kind: 'tree' }));
          break;
        case 'phylo:compute-distances-dialog':
          requireActiveSession(() => setOperationDialog({ kind: 'compute-distances' }));
          break;
        case 'phylo:timetree':
          requireActiveSession(() => setOperationDialog({ kind: 'timetree' }));
          break;
        case 'phylo:condense-tree':
          requireActiveSession(() => setOperationDialog({ kind: 'condense-tree' }));
          break;
        case 'phylo:gene-duplications':
          requireActiveSession(() => setOperationDialog({ kind: 'gene-duplications' }));
          break;
        case 'phylo:consensus-tree':
          requireActiveSession(() => setOperationDialog({ kind: 'consensus-tree' }));
          break;
        case 'align:msa-mafft':
        case 'tools:align':
          requireActiveSession(() =>
            openSequenceAlignment('msa', {
              msaAlgo: 'consistency-nj',
            })
          );
          break;
        case 'align:msa-clustalo':
          requireActiveSession(() =>
            openSequenceAlignment('msa', {
              msaAlgo: 'progressive-upgma',
            })
          );
          break;
        case 'align:msa-muscle':
          requireActiveSession(() =>
            openSequenceAlignment('msa', {
              msaAlgo: 'consistency-upgma',
            })
          );
          break;
        case 'align:pairwise-nw':
          requireActiveSession(() =>
            openSequenceAlignment('pairwise', { pairwiseAlgo: 'nw' })
          );
          break;
        case 'align:pairwise-sw':
          requireActiveSession(() =>
            openSequenceAlignment('pairwise', { pairwiseAlgo: 'sw' })
          );
          break;
        case 'align:dotplot':
          requireActiveSession(() => openSequenceAlignment('dotplot'));
          break;
        case 'align:map-reference':
        case 'align:denovo-assemble':
          requireActiveSession(() => openGenomicsSuite('ngs-assembly'));
          break;
        case 'align:whole-genome':
          requireActiveSession(() => openGenomicsSuite('genome-variants'));
          break;
        case 'align:sanger-contig':
          requireActiveSession(() => setViewerTab('sanger-contig'));
          break;

        // Dedicated Main Menu: Phylogenetics
        case 'phylo:tree-ml':
        case 'tools:tree':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'tree', method: 'Maximum Likelihood (ML)' })
          );
          break;
        case 'phylo:tree-fasttree':
          requireActiveSession(() =>
            openPhylogeneticsModule('phylogeny', {
              treeAlgo: 'FastTree (Approx-ML)',
            })
          );
          break;
        case 'phylo:tree-phyml':
          requireActiveSession(() =>
            openPhylogeneticsModule('phylogeny', {
              treeAlgo: 'PhyML (ML + SH-aLRT)',
            })
          );
          break;
        case 'phylo:tree-raxml':
          requireActiveSession(() =>
            openPhylogeneticsModule('phylogeny', {
              treeAlgo: 'RAxML (GTR+G Rapid ML)',
            })
          );
          break;
        case 'phylo:tree-mrbayes':
          requireActiveSession(() =>
            openPhylogeneticsModule('phylogeny', {
              treeAlgo: 'MrBayes (Bayesian MCMC)',
            })
          );
          break;
        case 'phylo:tree-nj':
          requireActiveSession(() =>
            openPhylogeneticsModule('phylogeny', {
              treeAlgo: 'Neighbor-Joining (NJ)',
            })
          );
          break;
        case 'phylo:tree-me':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'tree', method: 'Minimum-Evolution (ME)' })
          );
          break;
        case 'phylo:tree-upgma':
          requireActiveSession(() =>
            openPhylogeneticsModule('phylogeny', {
              treeAlgo: 'UPGMA',
            })
          );
          break;
        case 'phylo:tree-mp':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'tree', method: 'Maximum Parsimony (MP)' })
          );
          break;
        case 'phylo:usertree':
          requireActiveSession(() => openPhylogeneticsModule('usertree'));
          break;
        case 'phylo:ancestors-ml':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'evo', analysis: 'ancestors', initial: { method: 'ml' } })
          );
          break;
        case 'phylo:ancestors-mp':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'evo', analysis: 'ancestors', initial: { method: 'mp' } })
          );
          break;
        case 'phylo:data':
          requireActiveSession(() => openPhylogeneticsModule('data'));
          break;
        case 'phylo:models-best':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'best' } })
          );
          break;
        case 'phylo:models-matrix':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'matrix' } })
          );
          break;
        case 'phylo:models-disparity':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'disparity' } })
          );
          break;
        case 'phylo:models-composition':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'composition' } })
          );
          break;
        case 'phylo:models-rscu':
          requireActiveSession(() =>
            setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'rscu' } })
          );
          break;
        case 'phylo:distance':
          requireActiveSession(() => openPhylogeneticsModule('distance'));
          break;
        case 'phylo:diversity':
          requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'diversity' }));
          break;
        case 'phylo:selection':
          requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'selection' }));
          break;
        case 'phylo:rates':
          requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'rates' }));
          break;
        case 'phylo:clocks':
          requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'clocks' }));
          break;
        case 'phylo:diagnose':
          requireActiveSession(() => openPhylogeneticsModule('diagnose'));
          break;

        case 'tools:consensus':
          requireActiveSession(() => handleGenerateConsensusFromSelected());
          break;
        case 'tools:sanger':
        case 'sequence:contig-assembly':
          requireActiveSession(() => setViewerTab('sanger-contig'));
          break;
        case 'tools:ngs-suite':
        case 'sequence:denovo-assemble':
        case 'annotate:trim-ends':
        case 'annotate:bbduk-trim':
          requireActiveSession(() => openGenomicsSuite('ngs-assembly'));
          break;
        case 'tools:genbank-submit':
        case 'sequence:mutate-shuffle':
          requireActiveSession(() => openGenomicsSuite('transform-submit'));
          break;
        case 'tools:genome-variants':
        case 'annotate:find-snps':
        case 'annotate:freebayes-str':
        case 'annotate:classify-16s':
          requireActiveSession(() => openGenomicsSuite('genome-variants'));
          break;
        case 'annotate:glimmer-genes':
        case 'annotate:cpg-repeats':
          requireActiveSession(() => openGenomicsSuite('genes-cpg-repeats'));
          break;
        case 'annotate:coils-tm-pdb':
          requireActiveSession(() => openGenomicsSuite('protein-3d'));
          break;
        case 'tools:pipelines':
          requireActiveSession(() => setViewerTab('guided-pipelines'));
          break;
        case 'tools:plugin-euk-gene':
          requireActiveSession(() => openPluginTool('plugin-euk-gene-predictor'));
          break;
        case 'tools:plugin-microbial-gene':
          requireActiveSession(() => openPluginTool('plugin-microbial-gene-predictor'));
          break;
        case 'tools:plugin-crispr-arrays':
          requireActiveSession(() => openPluginTool('plugin-crispr-repeat-arrays'));
          break;
        case 'tools:plugin-tandem-repeats':
          requireActiveSession(() => openPluginTool('plugin-tandem-repeat-finder'));
          break;
        case 'tools:plugin-haplotype-part':
          requireActiveSession(() => openPluginTool('plugin-haplotype-partitioner'));
          break;
        case 'tools:plugin-taxonomic-class':
          requireActiveSession(() => openPluginTool('plugin-taxonomic-classifier'));
          break;
        case 'tools:plugin-species-delim':
          requireActiveSession(() => openPluginTool('plugin-species-delimitation'));
          break;
        case 'tools:plugin-protein-domains':
          requireActiveSession(() => openPluginTool('plugin-protein-domains-epitopes'));
          break;
        case 'tools:plugin-tm-topology':
          requireActiveSession(() => openPluginTool('plugin-transmembrane-topology'));
          break;
        case 'tools:plugin-adapter-trimmer':
          requireActiveSession(() => openPluginTool('plugin-adapter-quality-trimmer'));
          break;
        case 'tools:plugin-synteny-blocks':
          requireActiveSession(() => openPluginTool('plugin-genome-synteny-blocks'));
          break;
        case 'tools:plugin-hpc-phylo':
          requireActiveSession(() => openPluginTool('plugin-hpc-phylogeny-script'));
          break;
        case 'tools:plugin-ext-cli':
          requireActiveSession(() => openPluginTool('plugin-external-cli-suite'));
          break;

        case 'sequence:extract-region':
          requireActiveSession(() => handleExtractSelectedRegion());
          break;
        case 'sequence:reverse-complement':
          requireActiveSession(() => handleReverseComplementActiveDoc());
          break;
        case 'sequence:complement-only':
          requireActiveSession(() => handleComplementOnlyActiveDoc());
          break;
        case 'sequence:reverse-only':
          requireActiveSession(() => handleReverseOnlyActiveDoc());
          break;
        case 'sequence:translate':
          requireActiveSession(() => {
            setShowTranslation(true);
            setViewerTab('sequence-view');
          });
          break;
        case 'sequence:back-translate':
          requireActiveSession(() => openHybridSubTab('protein'));
          break;
        case 'annotate:find-motifs':
          requireActiveSession(() => handleOpenMotifSearch('Find Motifs'));
          break;
        case 'annotate:protein-domains':
          requireActiveSession(() => handleOpenMotifSearch('Protein Domains'));
          break;
        case 'sequence:toggle-topology':
          requireActiveSession(() => handleToggleCircularLinear());
          break;
        case 'sequence:convert-dna-rna':
          requireActiveSession(() => handleConvertDnaRna());
          break;

        case 'annotate:find-orfs':
          requireActiveSession(() => {
            setShowOrfs(true);
            setRightPanelOpen(true);
            setOpenRightPanels((p) => ({ ...p, orfs: true }));
            setViewerTab('sequence-view');
          });
          break;

        case 'edit:undo':
        case 'edit:redo': {
          // Native Edit › Undo/Redo: inside a text field keep standard text
          // undo; otherwise undo/redo document edits (the predefined AppKit
          // items only ever reached WKWebView's text undo manager).
          const focused = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
          const inTextField =
            !!focused &&
            (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable);
          if (inTextField) {
            document.execCommand(actionId === 'edit:undo' ? 'undo' : 'redo');
          } else if (actionId === 'edit:undo') {
            handleUndoDocumentEdit();
          } else {
            handleRedoDocumentEdit();
          }
          break;
        }

        default: {
          if (actionId.startsWith('action-vec:')) {
            const presetId = actionId.slice('action-vec:'.length);
            handleLoadActionVectorPreset(presetId);
          }
          break;
        }
      }
    },
    onNativeFileOpen: (file, mode) => {
      fileDragDepthRef.current = 0;
      setIsFileDragActive(false);
      if (mode === 'prefs') {
        void applyImportedPreferencesFile(file);
        return;
      }
      // Files of one native pick (or file-association launch) arrive as
      // separate events; import them as one sequential batch so failures are
      // collected and feature tracks attach to the right document.
      nativeOpenQueueRef.current.push({ file, mode: mode === 'merge' ? 'merge' : 'replace' });
      if (nativeOpenFlushTimerRef.current === null) {
        nativeOpenFlushTimerRef.current = window.setTimeout(() => {
          nativeOpenFlushTimerRef.current = null;
          const queued = nativeOpenQueueRef.current.splice(0);
          const leftOut = nativeOpenLeftOutRef.current;
          nativeOpenLeftOutRef.current = null;
          const merge = queued.filter((q) => q.mode === 'merge').map((q) => q.file);
          const replace = queued.filter((q) => q.mode === 'replace').map((q) => q.file);
          void (async () => {
            // a folder's files arrive as a replace batch
            const folderBatch = replace.length ? await importIncomingFilesBatch(replace, 'replace', 'imported') : null;
            if (merge.length) await importIncomingFilesBatch(merge, 'merge', 'imported');
            if (leftOut) {
              const failed = folderBatch?.failed ?? [];
              setStatusBanner(
                folderImportLeftOutNotice(leftOut.filesLeftOut, leftOut.filesRead) +
                  (failed.length ? ` Of the ${leftOut.filesRead.toLocaleString()} read, ${failed.length.toLocaleString()} failed to import: ${failed.map((f) => f.name).join(', ')}.` : ''),
                { keep: true }
              );
            }
          })();
        }, 0);
      }
    },
    onNativeFileSaved: (savedFilename) => {
      if (pendingNativeSessionSaveRef.current && /\.(mbc|mcb)$/i.test(savedFilename)) {
        pendingNativeSessionSaveRef.current = false;
        markSessionPristine(false);
        if (!autosavePendingRecoveryRef.current) writeWorkbenchAutosaveDirtyFlag(false);
      }
      setStatusBanner(`Saved "${savedFilename}"`);
    },
    onNativeFileError: (message) => {
      pendingNativeSessionSaveRef.current = false;
      setStatusBanner(`File dialog error: ${message}`);
    },
    onNativeFileDrag: (active) => {
      fileDragDepthRef.current = active ? 1 : 0;
      setIsFileDragActive(active);
    },
    onNativeFolderImportLeftOut: (filesLeftOut, filesRead) => {
      // the folder's files are queued before this arrives; with none queued, say it now
      if (nativeOpenFlushTimerRef.current === null) {
        setStatusBanner(folderImportLeftOutNotice(filesLeftOut, filesRead), { keep: true });
      } else {
        nativeOpenLeftOutRef.current = { filesLeftOut, filesRead };
      }
    },
  };

  useEffect(() => {
    return subscribeNativeMacMenuEvents({
      onMenuAction: (actionId) => nativeMenuDispatchRef.current.onMenuAction(actionId),
      onNativeFileOpen: (file, mode) =>
        nativeMenuDispatchRef.current.onNativeFileOpen(file, mode),
      onNativeFileSaved: (savedFilename) =>
        nativeMenuDispatchRef.current.onNativeFileSaved(savedFilename),
      onNativeFileError: (message) =>
        nativeMenuDispatchRef.current.onNativeFileError(message),
      onNativeFileDrag: (active) =>
        nativeMenuDispatchRef.current.onNativeFileDrag(active),
      onNativeFolderImportLeftOut: (filesLeftOut, filesRead) =>
        nativeMenuDispatchRef.current.onNativeFolderImportLeftOut(filesLeftOut, filesRead),
    });
  }, []);

  // Global keyboard shortcuts for Open Workbench (.mbc) [⌘O / Ctrl+O], Save Workbench (.mbc) [⌥⌘S / Ctrl+Alt+S],
  // Expand Document View [⇧⌘O], Filter Current Folder [⌥⌘F], and Search Tools or Files [⇧⌘F]
  const workspaceShortcutHandlerRef = useRef<(ev: KeyboardEvent) => void>(() => {});
  workspaceShortcutHandlerRef.current = (ev: KeyboardEvent) => {
    const mod = ev.metaKey || ev.ctrlKey;
    if (!mod) return;
    // Leave text fields alone (Ctrl+I / Ctrl+F there belong to the field) and
    // never run workbench commands behind an open modal dialog.
    const target = ev.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    ) {
      return;
    }
    if (typeof document !== 'undefined' && document.querySelector('dialog[open], .mbc-modal-backdrop')) return;
    const key = ev.key.toLowerCase();
    if (key === 'o' && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      triggerOpenMbcPicker('replace');
    } else if (key === 'i' && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      triggerImportFilesPicker();
    } else if (key === 'i' && ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      handleImportFromClipboardAction();
    } else if (key === 'i' && ev.altKey && !ev.shiftKey) {
      // Same binding as the native menu and the in-window View menu (it used
      // to open the Import Folder picker on Windows/Linux instead).
      ev.preventDefault();
      requireActiveSession(() => handleToggleInspector());
    } else if (key === 'o' && ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      requireActiveSession(() => handleToggleExpandDocumentView());
    } else if (key === 's' && ev.altKey) {
      ev.preventDefault();
      requireActiveSession(() => handleSaveMbcWorkbench(ev.shiftKey));
    } else if (key === 'f' && ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      requireActiveSession(() => handleFocusFolderFilter());
    } else if (key === 'f' && ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      window.setTimeout(() => {
        document.getElementById('mbc-toolbar-global-search-input')?.focus();
      }, 30);
    } else if (key === 'a' && ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      requireActiveSession(() =>
        openSequenceAlignment('msa', {
          msaAlgo: 'consistency-nj',
        })
      );
    } else if (key === 't' && ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      requireActiveSession(() =>
        openPhylogeneticsModule('phylogeny', {
          treeAlgo: 'Maximum Likelihood (ML)',
        })
      );
    } else if (key === 'q' && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      handleRequestAppQuit();
    }
  };

  useEffect(() => {
    if (useNativeMacMenuBar) return;
    const onKeyDown = (ev: KeyboardEvent) => workspaceShortcutHandlerRef.current(ev);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [useNativeMacMenuBar]);

  const flatfileText = useMemo(() => {
    if (!sessionActive || homeViewActive || viewerTab !== 'text-view') {
      return '';
    }
    const original = originalDocumentText(activeDoc);
    if (original) return original.text;
    if (textFormat === 'genbank') return exportToGenBank(activeDoc);
    if (textFormat === 'fasta') return exportToFasta(activeDoc);
    if (textFormat === 'embl') return exportToEMBL(activeDoc);
    return exportToGFF3(activeDoc);
  }, [sessionActive, homeViewActive, viewerTab, activeDoc, textFormat]);

  const originalText = originalDocumentText(activeDoc);

  /** The viewer header's tab labels; they also name a studio tab's inspector. */
  const viewerTabLabels: Record<ViewerTab, string> = {
    'sequence-view': 'Sequence',
    'annotations-table': `Annotations (${activeDoc.features.length + activeDoc.primers.length})`,
    'text-view': originalText ? 'Text' : 'Flatfile',
    'vector-library': 'Vectors', 'cloning-gel': 'Cloning', 'primers-pcr': 'Primers',
    'sequence-alignment': activeDoc.alignmentMeta?.isAligned === false ? 'Sequences' : activeDoc.documentKind === 'contig' ? 'Contig' : 'Alignment',
    'phylogenetics': 'Tree', 'sanger-contig': 'Chromatogram',
    'genomics-ngs': activeDoc.moleculeType === 'Protein' ? '3D Structure' : 'Genomics',
    'history-hybrid': activeDoc.docMetadata?.['Document Type'] === 'Enzyme Set' ? 'Enzymes' : 'History',
    'guided-pipelines': 'Pipelines', 'document-info': 'Info',
  };
  /** The inspector's pane title, which its button and resizer name too: it follows the open tab. */
  const inspectorTitle =
    viewerTab === 'sequence-view'
      ? 'Sequence View Controls'
      : viewerTab === 'sanger-contig'
      ? 'Chromatogram View Controls'
      : `${viewerTabLabels[viewerTab]} Controls`;

  const buildActionVectorGroupNodes = (
    group: ActionVectorGroup,
    idPrefix: string
  ): MenuNode[] =>
    CLONING_ACTION_VECTOR_PRESETS.filter((p) => p.group === group).map((preset) => ({
      kind: 'command',
      id: `${idPrefix}-${preset.id}`,
      label: preset.name,
      onSelect: () => handleLoadActionVectorPreset(preset.id),
    }));

  const buildNewSessionSubmenu = (idPrefix: string): MenuNode => ({
    kind: 'submenu',
    id: `${idPrefix}-new-session`,
    label: 'New Session',
    minWidth: 220,
    children: [
      {
        kind: 'command',
        id: `${idPrefix}-ns-blank`,
        label: 'Blank Session',
        shortcut: sc('N', { alt: true }),
        onSelect: () => handleStartNewSession('blank'),
      },
      { kind: 'separator', id: `${idPrefix}-ns-sep-1` },
      {
        kind: 'submenu',
        id: `${idPrefix}-ns-seq-vec`,
        label: 'Sequences & Vectors',
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: `${idPrefix}-ns-new-seq`,
            label: 'New Sequence',
            shortcut: sc('N'),
            onSelect: () => handleStartNewSession('new-sequence'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-vec-cat`,
            label: 'Vector Catalog',
            onSelect: () => handleStartNewSession('vector-catalog'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-vec-arch`,
            label: 'Custom Vector',
            onSelect: () => handleStartNewSession('vector-architect'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-twist`,
            label: 'Vector QC',
            onSelect: () => handleStartNewSession('twist-onboarding'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-text-doc`,
            label: 'Flatfile Document',
            onSelect: () => handleStartNewSession('text-doc'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: `${idPrefix}-ns-cloning-pcr`,
        label: 'Cloning & Primers',
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: `${idPrefix}-ns-clone-rest`,
            label: 'Restriction Cloning',
            onSelect: () => handleStartNewSession('cloning-restriction'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-clone-asm`,
            label: 'Seamless Assembly',
            onSelect: () => handleStartNewSession('cloning-assembly'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-primers`,
            label: 'Primers & CRISPR',
            onSelect: () => handleStartNewSession('primers-crispr'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-enzymes`,
            label: 'Enzyme Digest',
            onSelect: () => handleStartNewSession('enzyme-set'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: `${idPrefix}-ns-align-trees`,
        label: 'Alignment & Trees',
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: `${idPrefix}-ns-align`,
            label: 'Sequence Alignment',
            onSelect: () => handleStartNewSession('align-task'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-phylo`,
            label: 'Phylogenetic Tree',
            onSelect: () => handleStartNewSession('phylo-task'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: `${idPrefix}-ns-seq-genomics`,
        label: 'Sequencing & Genomics',
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: `${idPrefix}-ns-sanger`,
            label: 'Sanger Traces',
            onSelect: () => handleStartNewSession('sanger-task'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-ngs`,
            label: 'NGS & 3D Structure',
            onSelect: () => handleStartNewSession('ngs-genomics'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-pipeline`,
            label: 'Guided Pipeline',
            onSelect: () => handleStartNewSession('pipeline-task'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: `${idPrefix}-ns-import-starter`,
        label: 'Starter & Import',
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: `${idPrefix}-ns-imp-files`,
            label: 'Import Files',
            shortcut: sc('I'),
            onSelect: () => handleStartNewSession('import-files'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-imp-clip`,
            label: 'From Clipboard',
            shortcut: sc('I', { shift: true }),
            onSelect: () => handleStartNewSession('import-clipboard'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-folder`,
            label: 'New Folder',
            shortcut: sc('N', { shift: true }),
            onSelect: () => handleStartNewSession('new-folder'),
          },
          { kind: 'separator', id: `${idPrefix}-ns-imp-sep` },
          {
            kind: 'command',
            id: `${idPrefix}-ns-samples`,
            label: 'Sample Project',
            onSelect: () => handleStartNewSession('sample-library'),
          },
        ],
      },
    ],
  });

  const buildImportOtherSubmenu = (idPrefix: string): MenuNode => ({
    kind: 'submenu',
    id: `${idPrefix}-import-other`,
    label: 'Import Other',
    minWidth: 225,
    children: [
      {
        kind: 'command',
        id: `${idPrefix}-other-restore-backup`,
        label: 'Restore Backup',
        onSelect: () => triggerOpenMbcPicker('replace'),
      },
      {
        kind: 'command',
        id: `${idPrefix}-other-sample-docs`,
        label: 'Sample Documents',
        onSelect: () => handleImportSampleDocuments(),
      },
      {
        kind: 'command',
        id: `${idPrefix}-other-mbc-prefs`,
        label: 'MolBioCraft Preferences',
        onSelect: () => triggerImportPreferencesPicker(),
      },
      {
        kind: 'command',
        id: `${idPrefix}-other-new-db-conn`,
        label: 'New Database Connection',
        onSelect: () => setDbExplorerCategory('ncbi-nucleotide'),
      },
    ],
  });

  const buildImportMenuNodes = (idPrefix: string): MenuNode[] => [
    {
      kind: 'command',
      id: `${idPrefix}-direct-files`,
      label: 'Import Files',
      shortcut: sc('I'),
      onSelect: () => triggerImportFilesPicker(),
    },
    {
      kind: 'command',
      id: `${idPrefix}-direct-folder`,
      label: 'Import Folder',
      onSelect: () => triggerImportFolderPicker(),
    },
    {
      kind: 'command',
      id: `${idPrefix}-metadata`,
      label: 'Metadata from Spreadsheet…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'import-metadata' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-direct-clipboard`,
      label: 'Import From Clipboard',
      shortcut: sc('I', { shift: true }),
      onSelect: () => handleImportFromClipboardAction(),
    },
    buildImportOtherSubmenu(idPrefix),
    { kind: 'separator', id: `${idPrefix}-direct-sep` },
    {
      kind: 'submenu',
      id: `${idPrefix}-seq-files`,
      label: 'Sequence Files',
      minWidth: 215,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-gb-fasta`,
          label: 'Sequence Files',
          shortcut: sc('I'),
          onSelect: () => triggerImportFilesPicker(),
        },
        {
          kind: 'command',
          id: `${idPrefix}-clipboard`,
          label: 'From Clipboard',
          shortcut: sc('I', { shift: true }),
          onSelect: () => handleImportFromClipboardAction(),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-traces-ngs`,
      label: 'Traces & Reads',
      minWidth: 210,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-sanger`,
          label: 'Sanger Traces',
          onSelect: () => {
            setHomeViewActive(false);
            handleStartNewSession('sanger-task');
          },
        },
        {
          kind: 'command',
          id: `${idPrefix}-ngs`,
          label: 'NGS Reads',
          onSelect: () => {
            setHomeViewActive(false);
            handleStartNewSession('ngs-genomics');
          },
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-vec-cat-sub`,
      label: 'Vector Catalog',
      minWidth: 215,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-vec-cat`,
          label: 'Built-In Vectors',
          onSelect: () => {
            setHomeViewActive(false);
            handleStartNewSession('vector-catalog');
          },
        },
        {
          kind: 'command',
          id: `${idPrefix}-twist`,
          label: 'Custom Vector QC',
          onSelect: () => {
            setHomeViewActive(false);
            handleStartNewSession('twist-onboarding');
          },
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-dbs-sub`,
      label: 'Databases',
      minWidth: 210,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-ncbi-uniprot`,
          label: 'NCBI & UniProt',
          onSelect: () => setDbExplorerCategory('ncbi-nucleotide'),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-sess-sub`,
      label: 'Session',
      minWidth: 210,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-merge-mbc`,
          label: 'Merge Session',
          onSelect: () =>
            sessionActive
              ? triggerOpenMbcPicker('merge')
              : triggerOpenMbcPicker('replace'),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-prefs-sub`,
      label: 'Preferences',
      minWidth: 210,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-prefs-json`,
          label: 'Import Preferences',
          onSelect: () => triggerImportPreferencesPicker(),
        },
      ],
    },
  ];

  const buildTableColumnsMenuNodes = (idPrefix: string): MenuNode[] => [
    ...sortColumnsAsciiAlphabetical(availableFolderColumns).map(
      (col): MenuNode => ({
        kind: 'checkbox',
        id: `${idPrefix}-col-${col.id}`,
        label: col.label,
        checked: Boolean(col.alwaysVisible) || visibleColumns.includes(col.id),
        disabled: !sessionActive || Boolean(col.alwaysVisible),
        onToggle: () => requireActiveSession(() => handleToggleColumnVisibility(col.id)),
      })
    ),
    { kind: 'separator', id: `${idPrefix}-col-sep-1` },
    {
      kind: 'submenu',
      id: `${idPrefix}-col-presets`,
      label: 'Column Presets',
      disabled: !sessionActive,
      minWidth: 270,
      children: (Object.keys(DOC_TABLE_COLUMN_PRESETS) as DocTableColumnPresetId[]).map(
        (presetId) => ({
          kind: 'command',
          id: `${idPrefix}-preset-${presetId}`,
          label: DOC_TABLE_COLUMN_PRESETS[presetId].label,
          onSelect: () => requireActiveSession(() => handleApplyColumnPreset(presetId)),
        })
      ),
    },
    {
      kind: 'checkbox',
      id: `${idPrefix}-col-lock`,
      label: 'Lock Column Order',
      checked: lockColumnOrder,
      disabled: !sessionActive,
      onToggle: () => requireActiveSession(() => setLockColumnOrder((v) => !v)),
    },
    {
      kind: 'command',
      id: `${idPrefix}-col-save`,
      label: 'Save Current State',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => handleSaveDocColumnState()),
    },
    {
      kind: 'command',
      id: `${idPrefix}-col-load`,
      label: 'Load Column State',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => handleLoadDocColumnState()),
    },
  ];

  openOperationRef.current = (op) => requireActiveSession(() => setOperationDialog(operationDialogFor(op)));

  const buildAlignmentMenuNodes = (idPrefix: string): MenuNode[] => [
    {
      kind: 'command',
      id: `${idPrefix}-msa-dialog`,
      label: 'Multiple Alignment…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'align' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-pairwise-dialog`,
      label: 'Pairwise Alignment…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'pairwise' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-structures-dialog`,
      label: 'Align Structures…',
      disabled: !isCommandEnabled('align-structures'),
      description: commandDisabledReason('align-structures'),
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'align-structures' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-read-qc`,
      label: 'Read QC Report…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'read-qc' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-merge-pairs`,
      label: 'Merge Paired Reads…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'merge-pairs' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-trim-dialog`,
      label: 'Trim Ends…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'trim' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-denovo-dialog`,
      label: 'De Novo Assemble…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'denovo' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-map-dialog`,
      label: 'Map to Reference…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'map' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-expression-levels-dialog`,
      label: 'Calculate Expression Levels…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'expression-levels' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-structural-variants-dialog`,
      label: 'Find Structural Variants…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'structural-variants' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-translation-dialog`,
      label: 'Translation Alignment…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'transalign' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-highlight-sites`,
      label: 'Highlight Sites…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'highlight-sites' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-add-to-alignment`,
      label: 'Add Sequences to Alignment…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'add-to-alignment' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-mask-dialog`,
      label: 'Mask Alignment…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'mask' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-consensus-dialog`,
      label: 'Generate Consensus…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'consensus' })),
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-msa-sub`,
      label: 'Multiple Alignment',
      disabled: !sessionActive,
      minWidth: 220,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-msa-mafft`,
          label: 'MAFFT-style Alignment',
          shortcut: sc('A', { alt: true }),
          onSelect: () =>
            requireActiveSession(() =>
              openSequenceAlignment('msa', {
                msaAlgo: 'consistency-nj',
              })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-msa-clustalo`,
          label: 'Clustal-style Alignment',
          onSelect: () =>
            requireActiveSession(() =>
              openSequenceAlignment('msa', {
                msaAlgo: 'progressive-upgma',
              })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-msa-muscle`,
          label: 'MUSCLE-style Alignment',
          onSelect: () =>
            requireActiveSession(() =>
              openSequenceAlignment('msa', {
                msaAlgo: 'consistency-upgma',
              })
            ),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-pairwise-sub`,
      label: 'Pairwise & Dotplot',
      disabled: !sessionActive,
      minWidth: 225,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-pairwise-nw`,
          label: 'Global (Needleman-Wunsch)',
          onSelect: () =>
            requireActiveSession(() =>
              openSequenceAlignment('pairwise', { pairwiseAlgo: 'nw' })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-pairwise-sw`,
          label: 'Local (Smith-Waterman)',
          onSelect: () =>
            requireActiveSession(() =>
              openSequenceAlignment('pairwise', { pairwiseAlgo: 'sw' })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-dotplot`,
          label: 'K-mer Dotplot',
          onSelect: () =>
            requireActiveSession(() => openSequenceAlignment('dotplot')),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-map-contig-sub`,
      label: 'Read Mapping & Contigs',
      disabled: !sessionActive,
      minWidth: 220,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-map-ref`,
          label: 'Map Reads',
          onSelect: () =>
            requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-denovo`,
          label: 'De Novo Assembly',
          onSelect: () =>
            requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-sanger-contig`,
          label: 'Sanger Contigs',
          onSelect: () =>
            requireActiveSession(() => setViewerTab('sanger-contig')),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-genome-sub`,
      label: 'Genome Alignment',
      disabled: !sessionActive,
      minWidth: 215,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-whole-genome`,
          label: 'Genome Synteny',
          onSelect: () =>
            requireActiveSession(() => openGenomicsSuite('genome-variants')),
        },
      ],
    },
    { kind: 'separator', id: `${idPrefix}-sep-ops` },
    {
      kind: 'submenu',
      id: `${idPrefix}-consensus-ops-sub`,
      label: 'Consensus & Batch',
      disabled: !sessionActive,
      minWidth: 220,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-gen-consensus`,
          label: 'Generate Consensus',
          onSelect: () =>
            requireActiveSession(() => handleGenerateConsensusFromSelected()),
        },
        {
          kind: 'command',
          id: `${idPrefix}-concat`,
          label: 'Concatenate Sequences',
          onSelect: () =>
            requireActiveSession(() => handleConcatenateSelectedSequences()),
        },
        {
          kind: 'command',
          id: `${idPrefix}-mask-lowcomp`,
          label: 'Mask Homopolymers',
          onSelect: () =>
            requireActiveSession(() => handleMaskActiveSequence('low-complexity')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-export-consensus`,
          label: 'Export Consensus',
          onSelect: () =>
            requireActiveSession(() => handleExportConsensusFasta()),
        },
        {
          kind: 'command',
          id: `${idPrefix}-haplotype-partitioner`,
          label: 'Haplotype & Allele Partitioner',
          onSelect: () =>
            requireActiveSession(() => openPluginTool('plugin-haplotype-partitioner')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-ext-cli-suite`,
          label: 'External CLI Suite',
          onSelect: () =>
            requireActiveSession(() => openPluginTool('plugin-external-cli-suite')),
        },
      ],
    },
  ];

  const buildPhylogeneticsMenuNodes = (idPrefix: string): MenuNode[] => [
    {
      kind: 'command',
      id: `${idPrefix}-build-tree`,
      label: 'Build Tree…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'tree' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-compute-distances`,
      label: 'Compute Distances…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'compute-distances' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-timetree`,
      label: 'Compute Timetree…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'timetree' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-condense-tree`,
      label: 'Condense Tree…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'condense-tree' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-gene-dups`,
      label: 'Gene Duplication Inference…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'gene-duplications' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-consensus-tree`,
      label: 'Consensus Tree…',
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'consensus-tree' })),
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-tree-sub`,
      label: 'Tree Reconstruction',
      disabled: !sessionActive,
      minWidth: 225,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-tree-ml`,
          label: 'Maximum Likelihood',
          shortcut: sc('T', { alt: true }),
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'tree', method: 'Maximum Likelihood (ML)' })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-fasttree`,
          label: 'FastTree (runs if installed)',
          onSelect: () =>
            requireActiveSession(() =>
              openPhylogeneticsModule('phylogeny', {
                treeAlgo: 'FastTree (Approx-ML)',
              })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-phyml`,
          label: 'PhyML (runs if installed)',
          onSelect: () =>
            requireActiveSession(() =>
              openPhylogeneticsModule('phylogeny', {
                treeAlgo: 'PhyML (ML + SH-aLRT)',
              })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-raxml`,
          label: 'RAxML (runs if installed)',
          onSelect: () =>
            requireActiveSession(() =>
              openPhylogeneticsModule('phylogeny', {
                treeAlgo: 'RAxML (GTR+G Rapid ML)',
              })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-mrbayes`,
          label: 'MrBayes (runs if installed)',
          onSelect: () =>
            requireActiveSession(() =>
              openPhylogeneticsModule('phylogeny', {
                treeAlgo: 'MrBayes (Bayesian MCMC)',
              })
            ),
        },
        { kind: 'separator', id: `${idPrefix}-tree-sep` },
        {
          kind: 'command',
          id: `${idPrefix}-tree-nj`,
          label: 'Neighbor-Joining',
          onSelect: () =>
            requireActiveSession(() =>
              openPhylogeneticsModule('phylogeny', {
                treeAlgo: 'Neighbor-Joining (NJ)',
              })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-me`,
          label: 'Minimum Evolution',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'tree', method: 'Minimum-Evolution (ME)' })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-upgma`,
          label: 'UPGMA Clustering',
          onSelect: () =>
            requireActiveSession(() =>
              openPhylogeneticsModule('phylogeny', {
                treeAlgo: 'UPGMA',
              })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-mp`,
          label: 'Maximum Parsimony',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'tree', method: 'Maximum Parsimony (MP)' })
            ),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-usertree-anc-sub`,
      label: 'Ancestral States',
      disabled: !sessionActive,
      minWidth: 220,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-usertree`,
          label: 'Analyze User Tree',
          onSelect: () =>
            requireActiveSession(() => openPhylogeneticsModule('usertree')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-ancestors-ml`,
          label: 'Ancestors (ML)',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'ancestors', initial: { method: 'ml' } })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-ancestors-mp`,
          label: 'Ancestors (Parsimony)',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'ancestors', initial: { method: 'mp' } })
            ),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-models-sub`,
      label: 'Substitution Models',
      disabled: !sessionActive,
      minWidth: 220,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-models-best`,
          label: 'Best Fit Models',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'best' } })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-models-matrix`,
          label: 'Rate Matrix',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'matrix' } })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-models-disparity`,
          label: 'Homogeneity Test',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'disparity' } })
            ),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-codon-data-sub`,
      label: 'Codon Usage & Data',
      disabled: !sessionActive,
      minWidth: 220,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-data`,
          label: 'Alignment Explorer',
          onSelect: () =>
            requireActiveSession(() => openPhylogeneticsModule('data')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-models-composition`,
          label: 'Codon Composition',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'composition' } })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-models-rscu`,
          label: 'Codon Usage (RSCU)',
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'rscu' } })
            ),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-dist-div-sub`,
      label: 'Distances & Diversity',
      disabled: !sessionActive,
      minWidth: 220,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-distance`,
          label: 'Pairwise Distances',
          onSelect: () =>
            requireActiveSession(() => openPhylogeneticsModule('distance')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-diversity`,
          label: 'Population Diversity',
          onSelect: () =>
            requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'diversity' })),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-sel-rates-sub`,
      label: 'Selection & Rates',
      disabled: !sessionActive,
      minWidth: 225,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-selection`,
          label: 'Codon Selection (dN/dS)',
          onSelect: () =>
            requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'selection' })),
        },
        {
          kind: 'command',
          id: `${idPrefix}-rates`,
          label: 'Gamma Site Rates',
          onSelect: () =>
            requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'rates' })),
        },
      ],
    },
    {
      kind: 'submenu',
      id: `${idPrefix}-clocks-var-sub`,
      label: 'Clocks & Variants',
      disabled: !sessionActive,
      minWidth: 220,
      children: [
        {
          kind: 'command',
          id: `${idPrefix}-clocks`,
          label: 'Molecular Clocks',
          onSelect: () =>
            requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'clocks' })),
        },
        {
          kind: 'command',
          id: `${idPrefix}-diagnose`,
          label: 'Variant Impact',
          onSelect: () =>
            requireActiveSession(() => openPhylogeneticsModule('diagnose')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-species-delim`,
          label: 'Species Delimitation',
          onSelect: () =>
            requireActiveSession(() => openPluginTool('plugin-species-delimitation')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-hpc-phylo-job`,
          label: 'HPC Phylogeny Job Builder',
          onSelect: () =>
            requireActiveSession(() => openPluginTool('plugin-hpc-phylogeny-script')),
        },
      ],
    },
  ];

  const baseTopMenus: Pick<
    Record<Exclude<TopMenuId, null>, MenuNode[]>,
    'app' | 'file' | 'edit' | 'view'
  > = {
    app: [
      {
        kind: 'submenu',
        id: 'app-sub-about',
        label: 'About MolBioCraft',
        children: [
          {
            kind: 'command',
            id: 'app-about-modal',
            label: 'About MolBioCraft',
            onSelect: () => setAboutModalOpen(true),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'app-sub-prefs',
        label: 'Settings',
        children: [
          {
            kind: 'command',
            id: 'app-prefs-open',
            label: 'Preferences',
            shortcut: sc(','),
            onSelect: () => setPrefsModalTab('General'),
          },
          {
            kind: 'command',
            id: 'app-theme-toggle',
            label: `${darkMode ? 'Light' : 'Dark'} Appearance`,
            shortcut: sc('L', { shift: true }),
            onSelect: () => handleQuickThemeToggle(),
          },
        ],
      },
      { kind: 'separator', id: 'app-quit-sep' },
      {
        kind: 'command',
        id: 'app-quit-cmd',
        label: 'Quit MolBioCraft',
        shortcut: sc('Q'),
        onSelect: () => handleRequestAppQuit(),
      },
    ],
    file: [
      buildNewSessionSubmenu('file'),
      {
        kind: 'submenu',
        id: 'file-open-restore',
        label: 'Open Session',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'file-open-mbc',
            label: 'Open Session',
            shortcut: sc('O'),
            onSelect: () => triggerOpenMbcPicker('replace'),
          },
          {
            kind: 'command',
            id: 'file-merge-mbc',
            label: 'Merge Session',
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => triggerOpenMbcPicker('merge')),
          },
          { kind: 'separator', id: 'file-open-sep' },
          {
            kind: 'command',
            id: 'file-restore-auto',
            label: 'Restore Autosave',
            onSelect: () => handleRestoreLocalAutosave(),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'file-save-close',
        label: 'Save Session',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'file-save-mbc',
            label: 'Save Session',
            shortcut: sc('S', { alt: true }),
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(false)),
          },
          {
            kind: 'command',
            id: 'file-save-mbc-as',
            label: 'Save Session As',
            shortcut: sc('S', { shift: true, alt: true }),
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(true)),
          },
          { kind: 'separator', id: 'file-close-sep' },
          {
            kind: 'command',
            id: 'file-close-session',
            label: 'Close Session',
            shortcut: sc('W', { shift: true }),
            disabled: !sessionActive,
            onSelect: () => handleCloseSession(),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'file-folders-sub',
        label: 'Folders',
        disabled: !sessionActive,
        minWidth: 210,
        children: [
          {
            kind: 'command',
            id: 'file-rename-folder',
            label: 'Rename Folder',
            onSelect: () => requireActiveSession(() => handleRenameSelectedFolder()),
          },
          {
            kind: 'command',
            id: 'file-folder-color',
            label: 'Set Folder Color',
            onSelect: () => requireActiveSession(() => handleCycleSelectedFolderColor()),
          },
          {
            kind: 'command',
            id: 'file-move-folder',
            label: 'Move to Folder',
            onSelect: () => requireActiveSession(() => handleMoveSelectedDocsToFolder()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'file-fav-trash-sub',
        label: 'Favorites & Trash',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'file-toggle-fav',
            label: 'Toggle Favorite',
            onSelect: () => requireActiveSession(() => handleToggleFavoriteDocs()),
          },
          { kind: 'separator', id: 'file-trash-sep' },
          {
            kind: 'command',
            id: 'file-soft-delete',
            label: 'Move to Trash',
            onSelect: () => requireActiveSession(() => handleSoftDeleteSelectedDocs()),
          },
          {
            kind: 'command',
            id: 'file-put-back',
            label: 'Restore from Trash',
            disabled: deletedDocIds.length === 0,
            onSelect: () => requireActiveSession(() => handleRestoreFromDeletedItems()),
          },
          {
            kind: 'command',
            id: 'file-erase-all',
            label: 'Empty Trash',
            disabled: deletedDocIds.length === 0,
            onSelect: () => requireActiveSession(() => handleEraseAllDeletedItems()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'file-backup-sub',
        label: 'Project Backup',
        minWidth: 210,
        children: [
          {
            kind: 'command',
            id: 'file-backup-mbc',
            label: 'Back Up Project',
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(true)),
          },
          {
            kind: 'command',
            id: 'file-restore-backup-mbc',
            label: 'Restore Backup',
            onSelect: () => triggerOpenMbcPicker('replace'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'file-prefs-archive-sub',
        label: 'Preferences',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'file-import-prefs',
            label: 'Import Preferences',
            onSelect: () => triggerImportPreferencesPicker(),
          },
          {
            kind: 'command',
            id: 'file-export-prefs',
            label: 'Export Preferences',
            onSelect: () => handleExportPreferencesFile(),
          },
        ],
      },
      { kind: 'separator', id: 'file-sep-exp' },
      {
        kind: 'submenu',
        id: 'file-import-seq',
        label: 'Import Data',
        minWidth: 220,
        children: buildImportMenuNodes('file-imp'),
      },
      {
        kind: 'submenu',
        id: 'file-export-seq',
        label: 'Export Sequences',
        minWidth: 220,
        disabled: !sessionActive,
        children: [
          {
            kind: 'command',
            id: 'file-exp-gb',
            label: 'Export GenBank',
            shortcut: sc('S'),
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('genbank')
              ),
          },
          {
            kind: 'command',
            id: 'file-exp-fasta',
            label: 'Export FASTA',
            shortcut: sc('S', { shift: true }),
            disabled: !isCommandEnabled('export-sequence'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('fasta')
              ),
          },
          {
            kind: 'command',
            id: 'file-exp-embl',
            label: 'Export EMBL',
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('embl')
              ),
          },
          {
            kind: 'command',
            id: 'file-exp-gff3',
            label: 'Export GFF3',
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('gff3')
              ),
          },
          {
            kind: 'command',
            id: 'file-exp-ncbi-tbl',
            label: 'GenBank Submission',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('transform-submit')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'file-export-batch',
        label: 'Batch & SVG Export',
        minWidth: 220,
        disabled: !sessionActive,
        children: [
          {
            kind: 'command',
            id: 'file-exp-sel-fasta',
            label: 'Batch FASTA',
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('selected', 'fasta')),
          },
          {
            kind: 'command',
            id: 'file-exp-sel-fastastq',
            label: 'Reads as FASTQ',
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('selected', 'fastq')),
          },
          {
            kind: 'command',
            id: 'file-exp-mbc-json',
            label: 'Export MBC JSON',
            onSelect: () => requireActiveSession(() => handleExportMbcJson()),
          },
          {
            kind: 'command',
            id: 'file-exp-folder-mbc',
            label: 'Export Folder as MBC',
            onSelect: () => requireActiveSession(() => handleExportFolderMbc()),
          },
          {
            kind: 'command',
            id: 'file-exp-folder-gb',
            label: 'Export Folder',
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('folder', 'gb')),
          },
          {
            kind: 'command',
            id: 'file-exp-lineage-gb',
            label: 'Export Lineage',
            onSelect: () => requireActiveSession(() => handleExportLineageBundle()),
          },
          {
            kind: 'command',
            id: 'file-exp-consensus-fa',
            label: 'Export Consensus',
            onSelect: () =>
              requireActiveSession(() => handleExportConsensusFasta()),
          },
          {
            kind: 'command',
            id: 'file-exp-svg-img',
            label: 'Save SVG Map',
            onSelect: () => requireActiveSession(() => handleSaveViewerAsSvgImage()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'file-print-sub',
        label: 'Print & PDF',
        disabled: !sessionActive,
        children: [
          {
            kind: 'command',
            id: 'file-print-cmd',
            label: 'Print / Export PDF',
            shortcut: sc('P'),
            onSelect: () => requireActiveSession(() => handlePrintWorkbench()),
          },
        ],
      },
      { kind: 'separator', id: 'file-quit-sep' },
      {
        kind: 'command',
        id: 'file-quit-cmd',
        label: 'Quit MolBioCraft',
        shortcut: sc('Q'),
        onSelect: () => handleRequestAppQuit(),
      },
    ],
    edit: [
      {
        kind: 'command',
        id: 'edit-undo-cmd',
        label:
          undoStack.length > 0
            ? `Undo ${undoStack[undoStack.length - 1].label}`
            : 'Undo',
        shortcut: sc('Z'),
        disabled: !isCommandEnabled('undo'),
        onSelect: () => requireActiveSession(() => handleUndoDocumentEdit()),
      },
      {
        kind: 'command',
        id: 'edit-redo-cmd',
        label:
          redoStack.length > 0
            ? `Redo ${redoStack[redoStack.length - 1].label}`
            : 'Redo',
        shortcut: sc('Z', { shift: true }),
        disabled: !isCommandEnabled('redo'),
        onSelect: () => requireActiveSession(() => handleRedoDocumentEdit()),
      },
      { kind: 'separator', id: 'edit-undo-sep' },
      {
        kind: 'submenu',
        id: 'edit-clipboard-sel',
        label: 'Selection',
        disabled: !sessionActive,
        children: [
          {
            kind: 'command',
            id: 'edit-copy-seq',
            label: 'Copy Sequence',
            shortcut: sc('C'),
            disabled: !isCommandEnabled('export-sequence'),
            onSelect: () =>
requireActiveSession(() => handleCopySequenceToClipboard()),
          },
          {
            kind: 'command',
            id: 'edit-sel-all',
            label: 'Select Sequence',
            shortcut: sc('A'),
            onSelect: () =>
              requireActiveSession(() =>
                setSelectedRange({
                  start: 1,
                  end: activeDoc.sequence.length,
                  label: 'Full Sequence',
                })
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'edit-find-nav',
        label: 'Find & Navigate',
        disabled: !sessionActive,
        children: [
          {
            kind: 'command',
            id: 'edit-find-doc',
            label: 'Find in Sequence',
            shortcut: sc('F'),
            onSelect: () =>
              requireActiveSession(() => {
                setViewerTab('sequence-view');
                setMapLayoutMode((m) => (m === 'circular' ? 'split' : m));
                window.setTimeout(() => {
                  document.getElementById('mbc-seq-search-input')?.focus();
                }, 40);
              }),
          },
          {
            kind: 'command',
            id: 'edit-next-feat',
            label: 'Next Feature',
            shortcut: sc('G'),
            onSelect: () => requireActiveSession(() => handleSelectNextFeature()),
          },
          {
            kind: 'command',
            id: 'edit-find-dups',
            label: 'Find Duplicates…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'duplicates' })),
          },
          {
            kind: 'command',
            id: 'edit-batch-rename',
            label: 'Batch Rename…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'rename' })),
          },
        ],
      },
    ],
    view: [
      {
        kind: 'submenu',
        id: 'view-nav-sub',
        label: 'History',
        disabled: !sessionActive,
        children: [
          {
            kind: 'command',
            id: 'view-back',
            label: 'Back',
            shortcut: sc('['),
            onSelect: () => requireActiveSession(() => handleGoBack()),
          },
          {
            kind: 'command',
            id: 'view-fwd',
            label: 'Forward',
            shortcut: sc(']'),
            onSelect: () => requireActiveSession(() => handleGoForward()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'view-search-filter-sub',
        label: 'Search & Filter',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'view-filter-folder',
            label: 'Filter Folder',
            shortcut: sc('F', { alt: true }),
            onSelect: () =>
              requireActiveSession(() => handleFocusFolderFilter()),
          },
          {
            kind: 'command',
            id: 'view-search-tools',
            label: 'Search Workspace',
            shortcut: sc('F', { shift: true }),
            onSelect: () => {
              window.setTimeout(() => {
                document.getElementById('mbc-toolbar-global-search-input')?.focus();
              }, 30);
            },
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'view-panels-sub',
        label: 'Panels',
        disabled: !sessionActive,
        children: [
          {
            kind: 'checkbox',
            id: 'view-tog-sidebar',
            label: 'Project Sidebar',
            checked: sessionActive && sidebarOpen,
            onToggle: () => requireActiveSession(() => setSidebarOpen((v) => !v)),
          },
          {
            kind: 'checkbox',
            id: 'view-tog-doctable',
            label: 'Document Table',
            checked: sessionActive && !docTableCollapsed,
            onToggle: toggleDocumentTable,
          },
          {
            kind: 'checkbox',
            id: 'view-tog-inspector',
            label: 'Inspector',
            // Checked while an inspector is shown; greyed on a tab with nothing to set.
            checked: inspectorVisible,
            disabled: !inspectorAvailable,
            shortcut: sc('I', { alt: true }),
            onToggle: () => requireActiveSession(() => handleToggleInspector()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'view-split-expand-sub',
        label: 'Split & Expand',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'checkbox',
            id: 'view-split-tb',
            label: 'Split Top / Bottom',
            checked: sessionActive && workspaceSplitMode === 'top-bottom',
            onToggle: () =>
              requireActiveSession(() => {
                setDocTableCollapsed(false);
                setWorkspaceSplitMode('top-bottom');
              }),
          },
          {
            kind: 'checkbox',
            id: 'view-split-lr',
            label: 'Split Left / Right',
            checked: sessionActive && workspaceSplitMode === 'left-right',
            onToggle: () =>
              requireActiveSession(() => {
                setDocTableCollapsed(false);
                setWorkspaceSplitMode('left-right');
              }),
          },
          { kind: 'separator', id: 'view-split-sep' },
          {
            kind: 'checkbox',
            id: 'view-expand-doc',
            label: 'Expand Viewer',
            checked: sessionActive && expandedDocView,
            shortcut: sc('O', { shift: true }),
            onToggle: () => requireActiveSession(() => handleToggleExpandDocumentView()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'view-table-cols-sub',
        label: 'Table Columns',
        disabled: !sessionActive,
        minWidth: 220,
        children: buildTableColumnsMenuNodes('view-cols'),
      },
      {
        kind: 'submenu',
        id: 'view-open-tabs-sub',
        label: 'Open Tabs',
        disabled: !sessionActive,
        minWidth: 220,
        children:
          sessionActive && openTabIds.length > 0
            ? openTabIds
                .map((tid) => documents.find((d) => d.id === tid) ?? sampleLibraryById.get(tid))
                .filter((d): d is SequenceDocument => Boolean(d))
                .map(
                  (d): MenuNode => ({
                    kind: 'checkbox',
                    id: `view-tab-${d.id}`,
                    label: d.name,
                    checked: d.id === activeDoc.id,
                    onToggle: () => selectDocumentWithHistory(d.id),
                  })
                )
            : [
                {
                  kind: 'command',
                  id: 'view-no-tabs',
                  label: 'No tabs open',
                  disabled: true,
                  onSelect: () => {},
                },
              ],
      },
      {
        kind: 'submenu',
        id: 'view-layout-sub',
        label: 'Map Layout',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'checkbox',
            id: 'view-lay-split',
            label: 'Split Map & Sequence',
            checked: sessionActive && mapLayoutMode === 'split',
            shortcut: sc('1'),
            onToggle: () =>
              requireActiveSession(() => {
                setViewerTab('sequence-view');
                setMapLayoutMode('split');
              }),
          },
          {
            kind: 'checkbox',
            id: 'view-lay-circ',
            label: 'Circular Map',
            checked: sessionActive && mapLayoutMode === 'circular',
            shortcut: sc('2'),
            onToggle: () =>
              requireActiveSession(() => {
                setViewerTab('sequence-view');
                setMapLayoutMode('circular');
              }),
          },
          {
            kind: 'checkbox',
            id: 'view-lay-lin',
            label: 'Linear Sequence',
            checked: sessionActive && mapLayoutMode === 'linear',
            shortcut: sc('4'),
            onToggle: () =>
              requireActiveSession(() => {
                setViewerTab('sequence-view');
                setMapLayoutMode('linear');
              }),
          },
          { kind: 'separator', id: 'view-lay-sep' },
          {
            kind: 'command',
            id: 'view-set-origin',
            label: 'Set Origin',
            shortcut: sc('0', { shift: true }),
            disabled: !isCommandEnabled('set-origin'),
            description: commandDisabledReason('set-origin'),
            onSelect: () => requireActiveSession(() => handleSetOriginToSelection()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'view-spec-sub',
        label: 'Studio Views',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'view-enz',
            label: 'Enzymes View',
            shortcut: sc('3'),
            onSelect: () => requireActiveSession(() => openHybridSubTab('enzymes-view')),
          },
          {
            kind: 'command',
            id: 'view-annot',
            label: 'Annotations Table',
            shortcut: sc('5'),
            onSelect: () => requireActiveSession(() => setViewerTab('annotations-table')),
          },
          {
            kind: 'command',
            id: 'view-text',
            label: 'Flatfile View',
            shortcut: sc('6'),
            onSelect: () => requireActiveSession(() => setViewerTab('text-view')),
          },
          {
            kind: 'command',
            id: 'view-mfe',
            label: 'Secondary Structure',
            shortcut: sc('7'),
            onSelect: () =>
              requireActiveSession(() => openHybridSubTab('secondary-structure')),
          },
          {
            kind: 'command',
            id: 'view-lineage',
            label: 'Lineage & History',
            shortcut: sc('8'),
            onSelect: () => requireActiveSession(() => openHybridSubTab('lineage')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'view-zoom-sub',
        label: 'Zoom',
        disabled: !sessionActive,
        children: [
          {
            kind: 'command',
            id: 'view-zoom-in',
            label: 'Zoom In',
            shortcut: sc('='),
            onSelect: () =>
              requireActiveSession(() => setZoomLevel((z) => stepSequenceZoom(z, 1))),
          },
          {
            kind: 'command',
            id: 'view-zoom-out',
            label: 'Zoom Out',
            shortcut: sc('-'),
            onSelect: () =>
              requireActiveSession(() => setZoomLevel((z) => stepSequenceZoom(z, -1))),
          },
          {
            kind: 'command',
            id: 'view-zoom-100',
            label: 'Actual Size (100%)',
            shortcut: sc('0'),
            onSelect: () => requireActiveSession(restoreSequenceView),
          },
        ],
      },
      { kind: 'separator', id: 'view-menu-info-sep' },
      {
        kind: 'checkbox',
        id: 'view-tog-menu-func-info',
        label: 'Show Menu Function Info',
        description:
          'Show or hide short function description tooltips when hovering or focusing menu items',
        checked: showMenuFunctionInfo,
        onToggle: handleToggleMenuFunctionInfo,
      },
    ],
  };

  const enzymesMenuNodes: MenuNode[] = [
      {
        kind: 'submenu',
        id: 'enz-sites-sub',
        label: 'Enzyme Views',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'enz-choose',
            label: 'Choose Enzymes',
            shortcut: sc('E'),
            onSelect: () => requireActiveSession(() => openHybridSubTab('enzymes-view')),
          },
          {
            kind: 'command',
            id: 'enz-digest-dialog',
            label: 'Digest into Fragments…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'digest' })),
          },
          {
            kind: 'command',
            id: 'enz-table',
            label: 'Enzymes Table',
            shortcut: sc('3'),
            onSelect: () => requireActiveSession(() => openHybridSubTab('enzymes-view')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'enz-eng-sub',
        label: 'Site Screening',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'enz-noncut',
            label: 'Non-Cutters',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'non-cutters')
              ),
          },
          {
            kind: 'command',
            id: 'enz-silent',
            label: 'Silent Mutations',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'silent-mutations')
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'enz-meth-sub',
        label: 'Methylation',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'enz-suppliers',
            label: 'Suppliers & Methylation',
            onSelect: () => setPrefsModalTab('Enzymes'),
          },
          {
            kind: 'command',
            id: 'enz-gel-prefs',
            label: 'Gel Preferences',
            onSelect: () => setPrefsModalTab('Agarose Gels'),
          },
        ],
      },
    ];

  const featuresMenuNodes: MenuNode[] = [
      {
        kind: 'submenu',
        id: 'feat-annot-sub',
        label: 'Add & Detect',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'feat-add',
            label: 'Add Feature',
            shortcut: sc('T'),
            onSelect: () => requireActiveSession(() => handleAddFeatureFromSelection()),
          },
          {
            kind: 'command',
            id: 'feat-detect',
            label: 'Detect Common Features',
            onSelect: () => requireActiveSession(() => handleAutoDetectCommonFeatures()),
          },
          {
            kind: 'command',
            id: 'feat-protease',
            label: 'Add Tag / Protease',
            onSelect: () => requireActiveSession(() => handleDetectTagsAndProteaseSites()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'feat-lib-sub',
        label: 'Feature Library',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'feat-manage-lib',
            label: 'Manage Library',
            onSelect: () => requireActiveSession(() => setViewerTab('annotations-table')),
          },
          {
            kind: 'command',
            id: 'feat-transfer',
            label: 'Transfer Features',
            onSelect: () => requireActiveSession(() => handleOpenTransferAnnotations()),
          },
          {
            kind: 'command',
            id: 'feat-extract',
            label: 'Extract Features',
            onSelect: () => requireActiveSession(() => handleExtractAnnotatedFeatures()),
          },
        ],
      },
    ];

  const primersMenuNodes: MenuNode[] = [
      {
        kind: 'submenu',
        id: 'prm-design-sub',
        label: 'Design Primers',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'prm-design-dialog',
            label: 'Design Primers…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'primers' })),
          },
          {
            kind: 'command',
            id: 'prm-degenerate-dialog',
            label: 'Design Degenerate Primers…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'degenerate-primers' })),
          },
          {
            kind: 'command',
            id: 'prm-test-saved-dialog',
            label: 'Test with Saved Primers…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'saved-primers' })),
          },
          {
            kind: 'command',
            id: 'prm-add',
            label: 'Add Primer',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'prm-add-list',
            label: 'Import Primers from Spreadsheet…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'import-primers' })),
          },
          {
            kind: 'command',
            id: 'prm-design-pair',
            label: 'Design Primer Pair',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'prm-convert-oligo',
            label: 'Selection to Oligo',
            onSelect: () => requireActiveSession(() => handleConvertSelectionToOligo()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'prm-hyb-sub',
        label: 'Specificity',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'prm-saved',
            label: 'Map Saved Primers',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'prm-specificity',
            label: 'Binding Specificity',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'prm-export',
            label: 'Export Primers',
            onSelect: () => requireActiveSession(() => handleExportPrimersFasta()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'prm-pcr-mut-sub',
        label: 'PCR & Mutagenesis',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'prm-pcr-sim',
            label: 'In-Silico PCR',
            shortcut: sc('D'),
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'prm-soe',
            label: 'Overlap PCR',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Overlap Extension PCR', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'prm-sdm',
            label: 'Site Mutagenesis',
            shortcut: sc('J'),
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'mutagenesis')
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'prm-crispr-sub',
        label: 'CRISPR Guides',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'prm-crispr',
            label: 'Find CRISPR Sites',
            onSelect: () => requireActiveSession(() => openPrimersStudio('crispr')),
          },
          {
            kind: 'command',
            id: 'prm-crispr-editing',
            label: 'CRISPR Editing Analysis…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'crispr-editing' })),
          },
        ],
      },
      { kind: 'separator', id: 'prm-sep-prefs' },
      {
        kind: 'submenu',
        id: 'prm-prefs-sub',
        label: 'Primer Settings',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'prm-prefs',
            label: 'Primer Preferences',
            onSelect: () => setPrefsModalTab('Primers'),
          },
        ],
      },
    ];

  const cloningActionsMenuNodes: MenuNode[] = [
      {
        kind: 'command',
        id: 'act-clone-dialog',
        label: 'Clone Insert into Vector…',
        disabled: !sessionActive,
        onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'cloning' })),
      },
      {
        kind: 'command',
        id: 'act-validate-clone',
        label: 'Validate Clone…',
        disabled: !sessionActive,
        onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'validate-clone' })),
      },
      {
        kind: 'submenu',
        id: 'act-rest-sub',
        label: 'Restriction Cloning',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'act-rest-find-sites',
            label: 'Find Sites',
            onSelect: () =>
              requireActiveSession(() => {
                setViewerTab('sequence-view');
                setRightPanelOpen(true);
                setOpenRightPanels((p) => ({ ...p, restriction: true }));
              }),
          },
          {
            kind: 'command',
            id: 'act-rest-digest-dialog',
            label: 'Digest into Fragments…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'digest' })),
          },
          {
            kind: 'command',
            id: 'act-rest-frag',
            label: 'Agarose Digest',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-rest-ligate',
            label: 'Ligate Fragments',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-rest-clone',
            label: 'Restriction Ligation',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-anneal',
            label: 'Anneal Oligos',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'anneal-oligos')
              ),
          },
          {
            kind: 'command',
            id: 'act-rest-noncut',
            label: 'Non-Cutters',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'non-cutters')
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'act-pcr-sub',
        label: 'PCR Cloning',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'act-pcr',
            label: 'PCR Amplification',
            shortcut: sc('D'),
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'act-soe',
            label: 'Overlap PCR',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Overlap Extension PCR', 'gel')
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'act-mut-sub',
        label: 'Mutagenesis',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'act-mut-primer',
            label: 'Site Mutagenesis',
            shortcut: sc('J'),
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'mutagenesis')
              ),
          },
          {
            kind: 'command',
            id: 'act-mut-shuffle',
            label: 'Point Mutation',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('transform-submit')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'act-seamless-sub',
        label: 'Seamless Assembly',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'act-gibson',
            label: 'Gibson Assembly',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Gibson Assembly', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-goldengate',
            label: 'Golden Gate',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Golden Gate (Type IIS)', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'act-hifi',
            label: 'NEBuilder HiFi',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('NEBuilder HiFi Assembly', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'act-infusion',
            label: 'In-Fusion',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('In-Fusion Cloning', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-parts',
            label: 'Parts Cloning',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Parts Cloning', 'gel')),
          },
        ],
      },
      { kind: 'separator', id: 'act-recomb-sep' },
      {
        kind: 'submenu',
        id: 'act-gateway-sub',
        label: 'Gateway Cloning',
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'act-gw-lr',
            label: 'Gateway LR Reaction',
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Gateway BP/LR Recombination', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'act-gw-bp',
            label: 'Gateway BP Reaction',
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Gateway BP/LR Recombination', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'act-gw-annot-att',
            label: 'Annotate att Sites',
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleAnnotateGatewaySites()),
          },
          {
            kind: 'command',
            id: 'act-gw-add-attb',
            label: 'Add attB Sites',
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleAddAttBSitesToActive()),
          },
          { kind: 'separator', id: 'act-gw-sep' },
          {
            kind: 'submenu',
            id: 'act-gw-donors',
            label: 'Donor Vectors',
            minWidth: 210,
            children: buildActionVectorGroupNodes('gateway-donor', 'act-vec'),
          },
          {
            kind: 'submenu',
            id: 'act-gw-dests',
            label: 'Destination Vectors',
            minWidth: 210,
            children: buildActionVectorGroupNodes('gateway-dest', 'act-vec'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'act-ta-gc-sub',
        label: 'TA & GC Cloning',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'act-ta-open',
            label: 'TA / GC Cloning',
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('TA / GC Cloning', 'gel')),
          },
          { kind: 'separator', id: 'act-ta-sep' },
          {
            kind: 'submenu',
            id: 'act-ta-vecs',
            label: 'TA Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('ta-vectors', 'act-vec'),
          },
          {
            kind: 'submenu',
            id: 'act-gc-vecs',
            label: 'GC Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('gc-vectors', 'act-vec'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'act-topo-sub',
        label: 'TOPO Cloning',
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'act-topo-open',
            label: 'TOPO Cloning',
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('TOPO Cloning', 'gel')),
          },
          { kind: 'separator', id: 'act-topo-sep' },
          {
            kind: 'submenu',
            id: 'act-topo-ta-vecs',
            label: 'TOPO TA Vectors',
            minWidth: 215,
            children: buildActionVectorGroupNodes('topo-ta', 'act-vec'),
          },
          {
            kind: 'submenu',
            id: 'act-topo-blunt-vecs',
            label: 'Blunt TOPO Vectors',
            minWidth: 215,
            children: buildActionVectorGroupNodes('topo-blunt', 'act-vec'),
          },
          {
            kind: 'submenu',
            id: 'act-topo-dir-vecs',
            label: 'D-TOPO Vectors',
            minWidth: 215,
            children: buildActionVectorGroupNodes('topo-directional', 'act-vec'),
          },
        ],
      },
    ];

  const coreToolsMenuNodes: MenuNode[] = [
      {
        kind: 'submenu',
        id: 'tools-gel-calc',
        label: 'Gel & Calculators',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tools-gel',
            label: 'Agarose Gel',
            shortcut: sc('G', { shift: true }),
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'tools-calc',
            label: 'DNA Calculations',
            shortcut: sc('M', { shift: true }),
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'dna-calculations')
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tools-search-vec',
        label: 'BLAST & Vectors',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tools-blast',
            label: 'BLAST Search',
            shortcut: sc('B', { shift: true }),
            onSelect: () => requireActiveSession(() => setBlastModalOpen(true)),
          },
          {
            kind: 'command',
            id: 'tools-vec-cat',
            label: 'Vector Catalog',
            onSelect: () => requireActiveSession(() => openVectorStudio('catalog')),
          },
          {
            kind: 'command',
            id: 'tools-vec-arch',
            label: 'Vector Architect',
            onSelect: () => requireActiveSession(() => openVectorStudio('architect')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tools-dbs-sub',
        label: 'Databases',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tools-db-explorer',
            label: 'NCBI & UniProt',
            onSelect: () => setDbExplorerCategory('ncbi-nucleotide'),
          },
          {
            kind: 'command',
            id: 'tools-make-blast-db',
            label: 'Make BLAST Database from Selection…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'make-blast-db' })),
          },
          {
            kind: 'command',
            id: 'tools-local-blast-dbs',
            label: 'Local BLAST DBs',
            onSelect: () => setDbExplorerCategory('local-blast-dbs'),
          },
          {
            kind: 'command',
            id: 'tools-blast-setup',
            label: 'BLAST Setup',
            // BLAST is configured through local databases (Preferences had no BLAST settings).
            onSelect: () => setDbExplorerCategory('local-blast-dbs'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tools-batch-ops-sub',
        label: 'Batch Operations',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'tools-extract-ann',
            label: 'Extract Features',
            onSelect: () => requireActiveSession(() => handleExtractAnnotatedFeatures()),
          },
          {
            kind: 'command',
            id: 'tools-mask-sel',
            label: 'Mask Selection',
            onSelect: () =>
              requireActiveSession(() => handleMaskActiveSequence('selection')),
          },
          {
            kind: 'command',
            id: 'tools-mask-lowcomp',
            label: 'Mask Homopolymers',
            onSelect: () =>
              requireActiveSession(() => handleMaskActiveSequence('low-complexity')),
          },
          {
            kind: 'command',
            id: 'tools-concat-seqs',
            label: 'Concatenate',
            onSelect: () =>
              requireActiveSession(() => handleConcatenateSelectedSequences()),
          },
          {
            kind: 'command',
            id: 'tools-gen-consensus',
            label: 'Generate Consensus',
            onSelect: () =>
              requireActiveSession(() => handleGenerateConsensusFromSelected()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tools-ngs-sub',
        label: 'Sequencing & NGS',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'tools-sanger',
            label: 'Sanger Studio',
            onSelect: () => requireActiveSession(() => setViewerTab('sanger-contig')),
          },
          {
            kind: 'command',
            id: 'tools-ngs',
            label: 'NGS Assembly',
            onSelect: () => requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
          },
          {
            kind: 'command',
            id: 'tools-synteny',
            label: 'Genome Variants',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genome-variants')),
          },
          {
            kind: 'command',
            id: 'tools-gb-sub',
            label: 'GenBank Submission',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('transform-submit')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tools-pipe-sub',
        label: 'Pipelines',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tools-pipelines',
            label: 'Guided Pipelines',
            shortcut: sc('Y', { shift: true }),
            onSelect: () => requireActiveSession(() => setViewerTab('guided-pipelines')),
          },
          {
            kind: 'command',
            id: 'tools-workflows',
            label: 'Lineage Manager',
            onSelect: () => requireActiveSession(() => openHybridSubTab('lineage')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tools-wf-batch-sub',
        label: 'Batch Workflows',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'tools-wf-manage',
            label: 'Manage Workflows…',
            onSelect: () => requireActiveSession(() => setManageWorkflowsOpen(true)),
          },
          {
            kind: 'command',
            id: 'tools-wf-run',
            label: 'Run Workflow…',
            onSelect: () => requireActiveSession(() => setRunWorkflowFor({})),
          },
          {
            kind: 'command',
            id: 'tools-wf-group-name',
            label: 'Group by Prefix',
            onSelect: () => requireActiveSession(() => handleWorkflowGroupByName()),
          },
          {
            kind: 'command',
            id: 'tools-wf-mod-intervals',
            label: 'Modify Intervals',
            onSelect: () =>
              requireActiveSession(() => handleWorkflowModifyAnnotationIntervals()),
          },
          {
            kind: 'command',
            id: 'tools-wf-random-sample',
            label: 'Sample Sequences',
            onSelect: () => requireActiveSession(() => handleWorkflowRandomlySample()),
          },
          {
            kind: 'command',
            id: 'tools-wf-set-cds',
            label: 'Set CDS Translation',
            onSelect: () => requireActiveSession(() => handleWorkflowSetCdsTranslation()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tools-plugins-sub',
        label: 'Bioinformatics Plugins',
        disabled: !sessionActive,
        minWidth: 235,
        children: [
          {
            kind: 'command',
            id: 'tools-plugin-euk-gene',
            label: 'Eukaryotic Gene Predictor',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-euk-gene-predictor')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-microbial-gene',
            label: 'Microbial Gene Predictor',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-microbial-gene-predictor')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-crispr-arrays',
            label: 'CRISPR Repeat Array Finder',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-crispr-repeat-arrays')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-tandem-repeats',
            label: 'Microsatellite & Tandem Repeats',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-tandem-repeat-finder')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-haplotype-part',
            label: 'Haplotype & Allele Partitioner',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-haplotype-partitioner')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-taxonomic-class',
            label: 'Taxonomic Sequence Classifier',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-taxonomic-classifier')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-species-delim',
            label: 'Species Delimitation',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-species-delimitation')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-protein-domains',
            label: 'Protein Domains & Epitopes',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-protein-domains-epitopes')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-tm-topology',
            label: 'Transmembrane & Signal Topology',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-transmembrane-topology')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-adapter-trimmer',
            label: 'Adapter & Quality Read Trimmer',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-adapter-quality-trimmer')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-synteny-blocks',
            label: 'Whole-Genome Synteny Blocks',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-genome-synteny-blocks')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-hpc-phylo',
            label: 'HPC Phylogeny Job Builder',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-hpc-phylogeny-script')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-ext-cli',
            label: 'External CLI Suite',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-external-cli-suite')),
          },
        ],
      },
      { kind: 'separator', id: 'tools-sep-prefs' },
      {
        kind: 'submenu',
        id: 'tools-prefs-sub',
        label: 'Settings',
        children: [
          {
            kind: 'command',
            id: 'tools-prefs',
            label: 'Preferences',
            shortcut: sc('P', { shift: true }),
            onSelect: () => setPrefsModalTab('General'),
          },
        ],
      },
    ];

  const coreSequenceMenuNodes: MenuNode[] = [
      {
        kind: 'submenu',
        id: 'seq-strand-sub',
        label: 'Strand',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'command',
            id: 'seq-rc',
            label: 'Reverse Complement',
            shortcut: sc('R', { shift: true }),
            disabled: !isCommandEnabled('strand-transform'),
            description: commandDisabledReason('strand-transform'),
            onSelect: () =>
              requireActiveSession(() => handleReverseComplementActiveDoc()),
          },
          {
            kind: 'command',
            id: 'seq-comp',
            label: 'Complement Only',
            disabled: !isCommandEnabled('strand-transform'),
            onSelect: () => requireActiveSession(() => handleComplementOnlyActiveDoc()),
          },
          {
            kind: 'command',
            id: 'seq-rev',
            label: 'Reverse Only',
            disabled: !isCommandEnabled('strand-transform'),
            onSelect: () => requireActiveSession(() => handleReverseOnlyActiveDoc()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'seq-trans-sub',
        label: 'Translation',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'seq-back-translate',
            label: 'Back-Translate…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'backtranslate' })),
          },
          {
            kind: 'command',
            id: 'seq-translate',
            label: 'Translate Frames',
            onSelect: () =>
              requireActiveSession(() => {
                setShowTranslation(true);
                setViewerTab('sequence-view');
              }),
          },
          {
            kind: 'command',
            id: 'seq-back-trans',
            label: 'Back Translate',
            onSelect: () => requireActiveSession(() => openHybridSubTab('protein')),
          },
          {
            kind: 'command',
            id: 'seq-dna-rna',
            label: 'Convert DNA / RNA',
            disabled: !isCommandEnabled('convert-dna-rna'),
            onSelect: () => requireActiveSession(() => handleConvertDnaRna()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'seq-topo-sub',
        label: 'Topology & Edit',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'checkbox',
            id: 'seq-circ-tog',
            label: 'Circular Topology',
            checked: sessionActive && activeDoc.topology === 'circular',
            onToggle: () => requireActiveSession(() => handleToggleCircularLinear()),
          },
          {
            kind: 'command',
            id: 'seq-extract',
            label: 'Extract Region',
            onSelect: () => requireActiveSession(() => handleExtractSelectedRegion()),
          },
          {
            kind: 'command',
            id: 'seq-mutate',
            label: 'Mutate & Shuffle',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('transform-submit')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'seq-contig-sub',
        label: 'Read Assembly',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'seq-merge-sanger',
            label: 'Merge Reads',
            onSelect: () => requireActiveSession(() => setViewerTab('sanger-contig')),
          },
          {
            kind: 'command',
            id: 'seq-denovo',
            label: 'De Novo Assembly',
            onSelect: () => requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
          },
        ],
      },
    ];

  const annotateMenuNodes: MenuNode[] = [
      {
        kind: 'submenu',
        id: 'ann-genes-sub',
        label: 'Genes & ORFs',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'ann-orfs-dialog',
            label: 'Find ORFs…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'orfs' })),
          },
          {
            kind: 'command',
            id: 'ann-from-documents-dialog',
            label: 'Annotate from Documents…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'annotate-from-documents' })),
          },
          {
            kind: 'command',
            id: 'ann-microsatellites-dialog',
            label: 'Microsatellite Analysis…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'microsatellites' })),
          },
          {
            kind: 'command',
            id: 'ann-expression-dialog',
            label: 'Compare Expression Levels…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'expression' })),
          },
          {
            kind: 'command',
            id: 'ann-compare-dialog',
            label: 'Compare Annotations…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'compare-annotations' })),
          },
          {
            kind: 'command',
            id: 'ann-orfs',
            label: 'Show ORFs',
            onSelect: () =>
              requireActiveSession(() => {
                setShowOrfs(true);
                setRightPanelOpen(true);
                setOpenRightPanels((p) => ({ ...p, orfs: true }));
                setViewerTab('sequence-view');
              }),
          },
          {
            kind: 'command',
            id: 'ann-glimmer',
            label: 'Predict Genes',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genes-cpg-repeats')),
          },
          {
            kind: 'command',
            id: 'ann-cpg',
            label: 'CpG & Repeats',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genes-cpg-repeats')),
          },
          {
            kind: 'command',
            id: 'ann-motifs',
            label: 'Find Motifs',
            onSelect: () => requireActiveSession(() => handleOpenMotifSearch('Find Motifs')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'ann-crispr-var',
        label: 'CRISPR & Variants',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'ann-crispr',
            label: 'Find CRISPR Sites',
            onSelect: () => requireActiveSession(() => openPrimersStudio('crispr')),
          },
          {
            kind: 'command',
            id: 'ann-freebayes',
            label: 'Call Variants',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genome-variants')),
          },
          {
            kind: 'command',
            id: 'ann-16s',
            label: '16S / ITS Taxonomy',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genome-variants')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'ann-blast-sub',
        label: 'Read QC & Transfer',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'ann-bbduk',
            label: 'Trim NGS Reads',
            onSelect: () => requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
          },
          {
            kind: 'command',
            id: 'ann-blast',
            label: 'Annotate by BLAST…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'annotate-by-blast' })),
          },
          {
            kind: 'command',
            id: 'ann-transfer',
            label: 'Transfer Features',
            onSelect: () => requireActiveSession(() => handleOpenTransferAnnotations()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'ann-prot-sub',
        label: 'Protein & 3D',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'ann-prot-dom',
            label: 'Protein Domains',
            onSelect: () => requireActiveSession(() => handleOpenMotifSearch('Protein Domains')),
          },
          {
            kind: 'command',
            id: 'ann-pdb',
            label: '3D Structure & Coils',
            onSelect: () => requireActiveSession(() => openGenomicsSuite('protein-3d')),
          },
        ],
      },
    ];

  const helpMenuNodes: MenuNode[] = [
      {
        kind: 'search',
        id: 'help-search-input',
        placeholder: '🔍 Search Help & Guides',
        value: helpMenuSearch,
        onChange: setHelpMenuSearch,
      },
      { kind: 'separator', id: 'help-sep-1' },
      {
        kind: 'submenu',
        id: 'help-docs-sub',
        label: 'Guides',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'help-panel',
            label: helpPanelOpen ? 'Hide Help Panel' : 'Show Help Panel',
            shortcut: 'F1',
            onSelect: () => setHelpPanelOpen((o) => !o),
          },
          {
            kind: 'command',
            id: 'help-shortcuts',
            label: 'Keyboard Shortcuts',
            onSelect: () => setPrefsModalTab('Keyboard'),
          },
          {
            kind: 'command',
            id: 'help-vec-guide',
            label: 'Vector Guide',
            onSelect: () => handleStartNewSession('twist-onboarding'),
          },
          {
            kind: 'command',
            id: 'help-tutorials',
            label: 'Sample Tutorial',
            onSelect: () => handleStartNewSession('sample-library'),
          },
          {
            kind: 'command',
            id: 'help-examples',
            label: 'Load Example Data…',
            onSelect: () => { setHomeViewActive(false); setOperationDialog({ kind: 'examples' }); },
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'help-soft-sub',
        label: 'About',
        minWidth: 210,
        children: [
          {
            kind: 'command',
            id: 'help-updates',
            label: 'Check for Updates',
            onSelect: () => setPrefsModalTab('General'),
          },
          {
            kind: 'command',
            id: 'help-about',
            label: 'About MolBioCraft',
            onSelect: () => setAboutModalOpen(true),
          },
        ],
      },
    ];

  const topMenus: Record<Exclude<TopMenuId, null>, MenuNode[]> = {
    ...baseTopMenus,
    sequence: [
      ...coreSequenceMenuNodes,
      { kind: 'separator', id: 'seq-sep-condensed' },
      {
        kind: 'submenu',
        id: 'seq-features-group',
        label: 'Features',
        minWidth: 215,
        children: featuresMenuNodes,
      },
      {
        kind: 'submenu',
        id: 'seq-annotate-group',
        label: 'Annotate',
        minWidth: 215,
        children: annotateMenuNodes,
      },
    ],
    cloning: [
      ...cloningActionsMenuNodes,
      { kind: 'separator', id: 'cloning-sep-condensed' },
      {
        kind: 'submenu',
        id: 'cloning-enzymes-group',
        label: 'Enzymes',
        minWidth: 215,
        children: enzymesMenuNodes,
      },
      {
        kind: 'submenu',
        id: 'cloning-primers-group',
        label: 'Primers',
        minWidth: 215,
        children: primersMenuNodes,
      },
    ],
    tools: [
      {
        kind: 'submenu',
        id: 'tools-alignment-group',
        label: 'Alignment',
        minWidth: 220,
        children: buildAlignmentMenuNodes('top-align'),
      },
      {
        kind: 'submenu',
        id: 'tools-phylo-group',
        label: 'Phylogenetics',
        minWidth: 220,
        children: buildPhylogeneticsMenuNodes('top-phylo'),
      },
      { kind: 'separator', id: 'tools-sep-condensed' },
      ...coreToolsMenuNodes,
    ],
    help: helpMenuNodes,
  };

  // Shortcuts displayed in the in-window menus are dispatched from the menu
  // definitions themselves (Windows, Linux, browser). Explicit handlers above
  // run first and call preventDefault; anything they do not consume reaches
  // the menu item's own handler, honouring its (and its submenus') disabled
  // state. On the native macOS menu bar the AppKit accelerators do this.
  const menuShortcutBindingsRef = useRef<MenuShortcutBinding[]>([]);
  menuShortcutBindingsRef.current = collectMenuShortcutBindings(
    Object.values(topMenus) as unknown as ShortcutMenuNode[][]
  );
  useEffect(() => {
    if (useNativeMacMenuBar) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      // The reload blockers preventDefault every Ctrl/Cmd+R chord; that must
      // not hide Shift+Ctrl/Cmd+R (Reverse Complement) from this dispatcher.
      const reloadChord = (ev.ctrlKey || ev.metaKey) && (ev.key === 'r' || ev.key === 'R');
      if ((ev.defaultPrevented && !reloadChord) || ev.repeat) return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      // Never run workbench commands behind an open modal dialog.
      if (document.querySelector('dialog[open], .mbc-modal-backdrop')) return;
      const binding = findMenuShortcut(menuShortcutBindingsRef.current, ev, hostOs);
      if (!binding) return;
      // Keep the platform's Copy / Select All for ordinary page text.
      if ((binding.shortcut.key === 'C' || binding.shortcut.key === 'A') && !binding.shortcut.shift && !binding.shortcut.alt) {
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      }
      ev.preventDefault();
      if (binding.disabled) {
        setStatusBanner(`${binding.label} is not available right now.`);
        return;
      }
      binding.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useNativeMacMenuBar, hostOs]);

  const toolbarMenus: Record<Exclude<ToolbarDropdownId, null>, MenuNode[]> = {
    add: [
      {
        kind: 'command',
        id: 'tb-add-new-sequence',
        label: 'New Sequence',
        shortcut: sc('N'),
        onSelect: () => {
          setNewSeqInitialClipboardText('');
          if (!sessionActive) {
            setSessionActive(true);
            setHomeViewActive(false);
          }
          setNewSeqModalOpen(true);
        },
      },
      {
        kind: 'command',
        id: 'tb-add-new-folder',
        label: 'New Folder',
        shortcut: sc('N', { shift: true }),
        onSelect: () => handleStartNewSession('new-folder'),
      },
      {
        kind: 'command',
        id: 'tb-add-text-doc',
        label: 'Text Document',
        onSelect: () => handleCreateNewTextDocument(),
      },
      {
        kind: 'command',
        id: 'tb-add-enzyme-set',
        label: 'Enzyme Set',
        onSelect: () => handleCreateNewEnzymeSetDocument(),
      },
      { kind: 'separator', id: 'tb-add-primary-sep' },
      {
        kind: 'command',
        id: 'tb-add-import-files',
        label: 'Import Files',
        shortcut: sc('I'),
        onSelect: () => triggerImportFilesPicker(),
      },
      {
        kind: 'command',
        id: 'tb-add-import-folder',
        label: 'Import Folder',
        onSelect: () => triggerImportFolderPicker(),
      },
      {
        kind: 'command',
        id: 'tb-add-import-clipboard',
        label: 'Import From Clipboard',
        shortcut: sc('I', { shift: true }),
        onSelect: () => handleImportFromClipboardAction(),
      },
      buildImportOtherSubmenu('tb-add'),
      { kind: 'separator', id: 'tb-add-legacy-sep' },
      buildNewSessionSubmenu('tb-add'),
      { kind: 'separator', id: 'tb-add-sep' },
      {
        kind: 'submenu',
        id: 'tb-add-current',
        label: 'Add to Session',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-add-seq-active',
            label: 'Add Sequence',
            onSelect: () => requireActiveSession(() => setNewSeqModalOpen(true)),
          },
          {
            kind: 'command',
            id: 'tb-add-vec-active',
            label: 'Vector Catalog',
            onSelect: () => requireActiveSession(() => openVectorStudio('catalog')),
          },
          {
            kind: 'command',
            id: 'tb-add-imp-active',
            label: 'Import Files',
            onSelect: () => requireActiveSession(() => triggerImportFilesPicker()),
          },
          {
            kind: 'command',
            id: 'tb-add-merge-active',
            label: 'Merge Session',
            onSelect: () => requireActiveSession(() => triggerOpenMbcPicker('merge')),
          },
          {
            kind: 'command',
            id: 'tb-add-feat-active',
            label: 'Add Feature',
            onSelect: () => requireActiveSession(() => handleAddFeatureFromSelection()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-add-open-mbc',
        label: 'Open Session',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-add-open-session',
            label: 'Open Session',
            shortcut: sc('O'),
            onSelect: () => triggerOpenMbcPicker('replace'),
          },
          {
            kind: 'command',
            id: 'tb-add-restore-auto',
            label: 'Restore Autosave',
            onSelect: () => handleRestoreLocalAutosave(),
          },
        ],
      },
    ],
    import: buildImportMenuNodes('tb-imp'),
    export: [
      {
        kind: 'submenu',
        id: 'tb-exp-flat',
        label: 'Sequence Files',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-exp-gb',
            label: 'Export GenBank',
            shortcut: sc('E', { shift: true }),
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('genbank')
              ),
          },
          {
            kind: 'command',
            id: 'tb-exp-fa',
            label: 'Export FASTA',
            disabled: !isCommandEnabled('export-sequence'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('fasta')
              ),
          },
          {
            kind: 'command',
            id: 'tb-exp-embl',
            label: 'Export EMBL',
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('embl')
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-exp-ann',
        label: 'Annotations',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-exp-gff3',
            label: 'Export GFF3',
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('gff3')
              ),
          },
          {
            kind: 'command',
            id: 'tb-exp-ncbi',
            label: 'GenBank Submission',
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('transform-submit')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-exp-mbc',
        label: 'Session',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-exp-save-mbc',
            label: 'Save Session',
            shortcut: sc('S', { alt: true }),
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(false)),
          },
          {
            kind: 'command',
            id: 'tb-exp-save-mbc-as',
            label: 'Save Session As',
            shortcut: sc('S', { shift: true, alt: true }),
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(true)),
          },
          {
            kind: 'command',
            id: 'tb-exp-mbc-json',
            label: 'Export MBC JSON',
            onSelect: () => requireActiveSession(() => handleExportMbcJson()),
          },
          {
            kind: 'command',
            id: 'tb-exp-folder-mbc',
            label: 'Export Folder as MBC',
            onSelect: () => requireActiveSession(() => handleExportFolderMbc()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-exp-batch',
        label: 'Batch & Lineage',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-exp-batch-fa',
            label: 'Batch FASTA',
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('selected', 'fasta')),
          },
          {
            kind: 'command',
            id: 'tb-exp-batch-fastq',
            label: 'Reads as FASTQ',
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('selected', 'fastq')),
          },
          {
            kind: 'command',
            id: 'tb-exp-batch-folder-mbc',
            label: 'Export Folder as MBC',
            onSelect: () => requireActiveSession(() => handleExportFolderMbc()),
          },
          {
            kind: 'command',
            id: 'tb-exp-folder-gb',
            label: 'Export Folder',
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('folder', 'gb')),
          },
          {
            kind: 'command',
            id: 'tb-exp-lineage',
            label: 'Export Lineage',
            onSelect: () => requireActiveSession(() => handleExportLineageBundle()),
          },
          {
            kind: 'command',
            id: 'tb-exp-consensus',
            label: 'Export Consensus',
            onSelect: () =>
              requireActiveSession(() => handleExportConsensusFasta()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-exp-img-prefs',
        label: 'Images & Settings',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-exp-svg',
            label: 'Save SVG Map',
            onSelect: () => requireActiveSession(() => handleSaveViewerAsSvgImage()),
          },
          { kind: 'separator', id: 'tb-exp-prefs-sep' },
          {
            kind: 'command',
            id: 'tb-exp-prefs',
            label: 'Export Preferences',
            onSelect: () => handleExportPreferencesFile(),
          },
        ],
      },
      // Offered only while an alignment is the active document (US-01M6S8C5).
      ...(sessionActive && isAlignmentImageDocument(activeDoc)
        ? [{
            kind: 'submenu' as const,
            id: 'tb-exp-aln-img',
            label: 'Alignment Image',
            description: 'The whole alignment, in blocks of 60 columns under a position ruler, with names, identities and the consensus',
            minWidth: 215,
            children: ([['svg', 'SVG Vector'], ['png', 'PNG Image'], ['pdf', 'PDF Document']] as const).map(([format, label]) => ({
              kind: 'command' as const,
              id: `tb-exp-aln-img-${format}`,
              label,
              description: `Save the whole alignment as a ${format.toUpperCase()} figure`,
              onSelect: () => requireActiveSession(() => handleExportAlignmentImage(format)),
            })),
          }]
        : []),
      {
        kind: 'submenu',
        id: 'tb-exp-pdf',
        label: 'Print & PDF',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-exp-print',
            label: 'Print / Export PDF',
            shortcut: sc('P'),
            onSelect: () => requireActiveSession(() => handlePrintWorkbench()),
          },
        ],
      },
    ],
    session: [
      buildNewSessionSubmenu('tb-sess'),
      {
        kind: 'submenu',
        id: 'tb-sess-open',
        label: 'Open Session',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-sess-open-mbc',
            label: 'Open Session',
            shortcut: sc('O'),
            onSelect: () => triggerOpenMbcPicker('replace'),
          },
          {
            kind: 'command',
            id: 'tb-sess-merge',
            label: 'Merge Session',
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => triggerOpenMbcPicker('merge')),
          },
          { kind: 'separator', id: 'tb-sess-open-sep' },
          {
            kind: 'command',
            id: 'tb-sess-restore',
            label: 'Restore Autosave',
            onSelect: () => handleRestoreLocalAutosave(),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-sess-save',
        label: 'Save Session',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-sess-save-mbc',
            label: 'Save Session',
            shortcut: sc('S', { alt: true }),
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(false)),
          },
          {
            kind: 'command',
            id: 'tb-sess-save-as',
            label: 'Save Session As',
            shortcut: sc('S', { shift: true, alt: true }),
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(true)),
          },
          { kind: 'separator', id: 'tb-sess-close-sep' },
          {
            kind: 'command',
            id: 'tb-sess-close',
            label: 'Close Session',
            shortcut: sc('W', { shift: true }),
            onSelect: () => handleCloseSession(),
          },
        ],
      },
    ],
    workflows: [
      {
        kind: 'submenu',
        id: 'tb-wf-guided',
        label: 'Guided Pipelines',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-wf-open-guided',
            label: 'Guided Pipelines',
            shortcut: sc('Y', { shift: true }),
            onSelect: () => requireActiveSession(() => setViewerTab('guided-pipelines')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-wf-cloning',
        label: 'Cloning',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-wf-oligo',
            label: 'Annealed Oligo Cloning',
            onSelect: () =>
              requireActiveSession(() => {
                setViewerTab('cloning-gel');
                setStatusBanner('Opened the Annealed Oligo Cloning tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tb-wf-batch-rest',
            label: 'Batch Restriction',
            onSelect: () =>
              requireActiveSession(() => {
                setViewerTab('cloning-gel');
                setStatusBanner('Opened the Batch Restriction Cloning tools — set the inputs there to run it.');
              }),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-wf-align-tree',
        label: 'Alignment & Trees',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-wf-align-tree-run',
            label: 'Align & Build Tree',
            onSelect: () =>
              requireActiveSession(() => {
                openPhylogeneticsModule('phylogeny', {
                  treeAlgo: 'Maximum Likelihood (ML)',
                });
                setStatusBanner('Opened the Align DNA then build tree tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tb-wf-mafft',
            label: 'Multi-Engine MSA',
            onSelect: () =>
              requireActiveSession(() => {
                openSequenceAlignment('msa', {
                  msaAlgo: 'consistency-nj',
                });
                setStatusBanner('Opened the Align DNA via MAFFT-style, MUSCLE-style & Clustal-style tools — set the inputs there to run it.');
              }),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-wf-ngs',
        label: 'NGS Reads',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-wf-bbduk',
            label: 'Trim NGS Reads',
            onSelect: () =>
              requireActiveSession(() => {
                openGenomicsSuite('ngs-assembly');
                setStatusBanner('Opened the Trim and Filter (BBDuk) tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tb-wf-map-asm',
            label: 'Map & Assemble',
            onSelect: () =>
              requireActiveSession(() => {
                openGenomicsSuite('ngs-assembly');
                setStatusBanner('Opened the Combined mapping and de novo assembly tools — set the inputs there to run it.');
              }),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-wf-var-tax',
        label: 'Variants & Taxonomy',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-wf-freebayes',
            label: 'Call Variants',
            onSelect: () =>
              requireActiveSession(() => {
                openGenomicsSuite('genome-variants');
                setStatusBanner('Opened the Map reads then find variations/SNPs (FreeBayes) tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tb-wf-apply-var',
            label: 'Apply Variants',
            onSelect: () =>
              requireActiveSession(() => {
                openGenomicsSuite('genome-variants');
                setStatusBanner('Opened the Apply Variants to Reference Sequence tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tb-wf-16s',
            label: '16S / ITS Taxonomy',
            onSelect: () =>
              requireActiveSession(() => {
                openGenomicsSuite('genome-variants');
                setStatusBanner('Opened the Identify Organism (16S / ITS Taxonomy) tools — set the inputs there to run it.');
              }),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-wf-doc-batch',
        label: 'Batch Tasks',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-wf-exp-svg',
            label: 'Export SVG Map',
            onSelect: () => requireActiveSession(() => handleSaveViewerAsSvgImage()),
          },
          {
            kind: 'command',
            id: 'tb-wf-group-name',
            label: 'Group by Prefix',
            onSelect: () => requireActiveSession(() => handleWorkflowGroupByName()),
          },
          {
            kind: 'command',
            id: 'tb-wf-mod-intervals',
            label: 'Modify Intervals',
            onSelect: () =>
              requireActiveSession(() => handleWorkflowModifyAnnotationIntervals()),
          },
          {
            kind: 'command',
            id: 'tb-wf-random-sample',
            label: 'Sample Sequences',
            onSelect: () => requireActiveSession(() => handleWorkflowRandomlySample()),
          },
          {
            kind: 'command',
            id: 'tb-wf-set-cds',
            label: 'Set CDS Translation',
            onSelect: () => requireActiveSession(() => handleWorkflowSetCdsTranslation()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-wf-plugins',
        label: 'Bioinformatics Plugins',
        disabled: !sessionActive,
        minWidth: 235,
        children: [
          {
            kind: 'command',
            id: 'tb-wf-plugin-euk-gene',
            label: 'Eukaryotic Gene Predictor',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-euk-gene-predictor')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-microbial-gene',
            label: 'Microbial Gene Predictor',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-microbial-gene-predictor')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-crispr-arrays',
            label: 'CRISPR Repeat Array Finder',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-crispr-repeat-arrays')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-tandem-repeats',
            label: 'Microsatellite & Tandem Repeats',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-tandem-repeat-finder')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-haplotype-part',
            label: 'Haplotype & Allele Partitioner',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-haplotype-partitioner')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-taxonomic-class',
            label: 'Taxonomic Sequence Classifier',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-taxonomic-classifier')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-species-delim',
            label: 'Species Delimitation',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-species-delimitation')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-protein-domains',
            label: 'Protein Domains & Epitopes',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-protein-domains-epitopes')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-tm-topology',
            label: 'Transmembrane & Signal Topology',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-transmembrane-topology')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-adapter-trimmer',
            label: 'Adapter & Quality Read Trimmer',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-adapter-quality-trimmer')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-synteny-blocks',
            label: 'Whole-Genome Synteny Blocks',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-genome-synteny-blocks')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-hpc-phylo',
            label: 'HPC Phylogeny Job Builder',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-hpc-phylogeny-script')),
          },
          {
            kind: 'command',
            id: 'tb-wf-plugin-ext-cli',
            label: 'External CLI Suite',
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-external-cli-suite')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-wf-manage',
        label: 'Workflow Manager',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-wf-manage-open',
            label: 'Manage Workflows…',
            onSelect: () => requireActiveSession(() => setManageWorkflowsOpen(true)),
          },
          {
            kind: 'command',
            id: 'tb-wf-run-open',
            label: 'Run Workflow…',
            onSelect: () => requireActiveSession(() => setRunWorkflowFor({})),
          },
          { kind: 'separator', id: 'tb-wf-run-sep' },
          ...allWorkflows().map((w): MenuNode => ({
            kind: 'command',
            id: `tb-wf-run-${w.id}`,
            label: `${w.name}…`,
            onSelect: () => requireActiveSession(() => setRunWorkflowFor({ workflowId: w.id })),
          })),
        ],
      },
    ],
    align: buildAlignmentMenuNodes('tb-align'),
    tree: buildPhylogeneticsMenuNodes('tb-phylo'),
    primers: [
      {
        kind: 'submenu',
        id: 'tb-pr-design',
        label: 'Primer Design',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-pr-dialog',
            label: 'Design Primers…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'primers' })),
          },
          {
            kind: 'command',
            id: 'tb-pr-test-saved',
            label: 'Test with Saved Primers…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'saved-primers' })),
          },
          {
            kind: 'command',
            id: 'tb-pr-new',
            label: 'Design PCR Primers',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'tb-pr-add',
            label: 'Add Primers',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'tb-pr-saved',
            label: 'Map Saved Primers',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'tb-pr-chars',
            label: 'Selection Tm',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-pr-tail',
        label: 'Extensions & PCR',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-pr-ext5',
            label: "Add 5' Overhang",
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'tb-pr-convert-oligo',
            label: 'Selection to Oligo',
            onSelect: () => requireActiveSession(() => handleConvertSelectionToOligo()),
          },
          {
            kind: 'command',
            id: 'tb-pr-amplicon',
            label: 'In-Silico PCR',
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-pr-crispr',
        label: 'CRISPR Guides',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-pr-crispr-find',
            label: 'Find CRISPR Sites',
            onSelect: () => requireActiveSession(() => openPrimersStudio('crispr')),
          },
        ],
      },
    ],
    cloning: [
      {
        kind: 'command',
        id: 'tb-cl-clone-dialog',
        label: 'Clone Insert into Vector…',
        disabled: !sessionActive,
        onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'cloning' })),
      },
      {
        kind: 'command',
        id: 'tb-cl-validate-clone',
        label: 'Validate Clone…',
        disabled: !sessionActive,
        onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'validate-clone' })),
      },
      {
        kind: 'submenu',
        id: 'tb-cl-digest',
        label: 'Restriction Digest',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-cl-find-sites',
            label: 'Find Sites',
            onSelect: () =>
              requireActiveSession(() => {
                setViewerTab('sequence-view');
                setRightPanelOpen(true);
                setOpenRightPanels((p) => ({ ...p, restriction: true }));
              }),
          },
          {
            kind: 'command',
            id: 'tb-cl-digest-dialog',
            label: 'Digest into Fragments…',
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'digest' })),
          },
          {
            kind: 'command',
            id: 'tb-cl-frag',
            label: 'Agarose Digest',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'tb-cl-ligate',
            label: 'Ligate Fragments',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'tb-cl-rest',
            label: 'Restriction Cloning',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'tb-cl-rest-anneal',
            label: 'Anneal Oligos',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'anneal-oligos')
              ),
          },
          {
            kind: 'command',
            id: 'tb-cl-noncut',
            label: 'Non-Cutters',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'non-cutters')
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-cl-seamless',
        label: 'Seamless Assembly',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-cl-gibson',
            label: 'Gibson Assembly',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Gibson Assembly', 'gel')),
          },
          {
            kind: 'command',
            id: 'tb-cl-hifi',
            label: 'NEBuilder HiFi',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('NEBuilder HiFi Assembly', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'tb-cl-infusion',
            label: 'In-Fusion',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('In-Fusion Cloning', 'gel')),
          },
          {
            kind: 'command',
            id: 'tb-cl-gg',
            label: 'Golden Gate',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Golden Gate (Type IIS)', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'tb-cl-parts',
            label: 'Parts Cloning',
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Parts Cloning', 'gel')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-cl-gateway',
        label: 'Gateway Cloning',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-cl-gw',
            label: 'BP / LR Cloning',
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Gateway BP/LR Recombination', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'tb-cl-annot-att',
            label: 'Annotate att Sites',
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleAnnotateGatewaySites()),
          },
          {
            kind: 'command',
            id: 'tb-cl-add-attb',
            label: 'Add attB Sites',
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleAddAttBSitesToActive()),
          },
          { kind: 'separator', id: 'tb-cl-gw-sep' },
          {
            kind: 'submenu',
            id: 'tb-cl-gw-donors',
            label: 'Donor Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('gateway-donor', 'tb-vec'),
          },
          {
            kind: 'submenu',
            id: 'tb-cl-gw-dests',
            label: 'Destination Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('gateway-dest', 'tb-vec'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-cl-topo-sub',
        label: 'TOPO Cloning',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-cl-topo',
            label: 'TOPO Cloning',
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('TOPO Cloning', 'gel')),
          },
          { kind: 'separator', id: 'tb-cl-topo-sep' },
          {
            kind: 'submenu',
            id: 'tb-cl-topo-ta',
            label: 'TOPO TA Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('topo-ta', 'tb-vec'),
          },
          {
            kind: 'submenu',
            id: 'tb-cl-topo-blunt',
            label: 'Blunt TOPO Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('topo-blunt', 'tb-vec'),
          },
          {
            kind: 'submenu',
            id: 'tb-cl-topo-dir',
            label: 'D-TOPO Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('topo-directional', 'tb-vec'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-cl-tagc-sub',
        label: 'TA & GC Cloning',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-cl-ta',
            label: 'TA / GC Cloning',
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('TA / GC Cloning', 'gel')),
          },
          { kind: 'separator', id: 'tb-cl-tagc-sep' },
          {
            kind: 'submenu',
            id: 'tb-cl-ta-vecs',
            label: 'TA Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('ta-vectors', 'tb-vec'),
          },
          {
            kind: 'submenu',
            id: 'tb-cl-gc-vecs',
            label: 'GC Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('gc-vectors', 'tb-vec'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-cl-mut',
        label: 'PCR & Mutagenesis',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-cl-sdm',
            label: 'Site Mutagenesis',
            shortcut: sc('J'),
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'mutagenesis')
              ),
          },
          {
            kind: 'command',
            id: 'tb-cl-soe',
            label: 'Overlap PCR',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Overlap Extension PCR', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'tb-cl-anneal',
            label: 'Anneal Oligos',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'anneal-oligos')
              ),
          },
          {
            kind: 'command',
            id: 'tb-cl-silent',
            label: 'Silent Mutations',
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'silent-mutations')
              ),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-cl-codon-sub',
        label: 'Codon Optimization',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-cl-codons',
            label: 'Optimize Codons',
            onSelect: () => requireActiveSession(() => openHybridSubTab('protein')),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'tb-cl-vec-val',
        label: 'Vectors & Validation',
        disabled: !sessionActive,
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'tb-cl-vec-cat',
            label: 'Vector Catalog',
            onSelect: () => requireActiveSession(() => openVectorStudio('catalog')),
          },
          {
            kind: 'command',
            id: 'tb-cl-vec-arch',
            label: 'Vector Architect',
            onSelect: () => requireActiveSession(() => openVectorStudio('architect')),
          },
          {
            kind: 'command',
            id: 'tb-cl-twist-qc',
            label: 'Custom Vector QC',
            onSelect: () =>
              requireActiveSession(() => openVectorStudio('twist-onboarding')),
          },
          {
            kind: 'command',
            id: 'tb-cl-sanger-val',
            label: 'Sanger Validation',
            onSelect: () => requireActiveSession(() => setViewerTab('sanger-contig')),
          },
        ],
      },
      { kind: 'separator', id: 'tb-cl-enz-sep' },
      {
        kind: 'submenu',
        id: 'tb-cl-enzymes-group',
        label: 'Enzymes',
        minWidth: 215,
        children: enzymesMenuNodes,
      },
    ],
    'tab-plus': [
      buildNewSessionSubmenu('tab-plus'),
      ...(sessionActive
        ? ([
            { kind: 'separator', id: 'tab-plus-sep' },
            {
              kind: 'submenu',
              id: 'tab-plus-add-cur',
              label: 'Add to Project',
              minWidth: 215,
              children: [
                {
                  kind: 'command',
                  id: 'tab-plus-seq',
                  label: 'New Sequence',
                  shortcut: sc('N'),
                  onSelect: () => setNewSeqModalOpen(true),
                },
                {
                  kind: 'command',
                  id: 'tab-plus-vec',
                  label: 'Vector Catalog',
                  onSelect: () => {
                    setHomeViewActive(false);
                    openVectorStudio('catalog');
                  },
                },
                {
                  kind: 'command',
                  id: 'tab-plus-imp',
                  label: 'Import Files',
                  onSelect: () => triggerImportFilesPicker(),
                },
              ],
            },
          ] as MenuNode[])
        : []),
    ],
    'tab-more': [
      {
        kind: 'command',
        id: 'tab-more-theme',
        label: darkMode ? 'Light Appearance' : 'Dark Appearance',
        onSelect: () => handleQuickThemeToggle(),
      },
      {
        kind: 'command',
        id: 'tab-more-prefs',
        label: 'Preferences',
        shortcut: sc(','),
        onSelect: () => setPrefsModalTab('General'),
      },
      { kind: 'separator', id: 'tab-more-sep' },
      {
        kind: 'command',
        id: 'tab-more-shortcuts',
        label: 'Keyboard Shortcuts',
        onSelect: () => setPrefsModalTab('Keyboard'),
      },
      {
        kind: 'command',
        id: 'tab-more-about',
        label: 'About MolBioCraft',
        onSelect: () => setAboutModalOpen(true),
      },
      { kind: 'separator', id: 'tab-more-quit-sep' },
      {
        kind: 'command',
        id: 'tab-more-quit',
        label: 'Quit MolBioCraft',
        shortcut: sc('Q'),
        onSelect: () => handleRequestAppQuit(),
      },
    ],
  };

  const homeDropdownMenus: Record<Exclude<HomeTopDropdownId, null>, MenuNode[]> = {
    new: [
      buildNewSessionSubmenu('home-new'),
      { kind: 'separator', id: 'home-new-sep' },
      {
        kind: 'submenu',
        id: 'home-new-cloning-vecs',
        label: 'Cloning Vectors',
        minWidth: 215,
        children: [
          {
            kind: 'submenu',
            id: 'home-vec-gw-don',
            label: 'Gateway Donors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('gateway-donor', 'home-vec'),
          },
          {
            kind: 'submenu',
            id: 'home-vec-gw-dst',
            label: 'Gateway Destinations',
            minWidth: 205,
            children: buildActionVectorGroupNodes('gateway-dest', 'home-vec'),
          },
          {
            kind: 'submenu',
            id: 'home-vec-ta',
            label: 'TA Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('ta-vectors', 'home-vec'),
          },
          {
            kind: 'submenu',
            id: 'home-vec-gc',
            label: 'GC Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('gc-vectors', 'home-vec'),
          },
          {
            kind: 'submenu',
            id: 'home-vec-topo-ta',
            label: 'TOPO TA Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('topo-ta', 'home-vec'),
          },
          {
            kind: 'submenu',
            id: 'home-vec-topo-blunt',
            label: 'Blunt TOPO Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('topo-blunt', 'home-vec'),
          },
          {
            kind: 'submenu',
            id: 'home-vec-topo-dir',
            label: 'D-TOPO Vectors',
            minWidth: 205,
            children: buildActionVectorGroupNodes('topo-directional', 'home-vec'),
          },
        ],
      },
    ],
    open: [
      {
        kind: 'submenu',
        id: 'home-open-proj',
        label: 'Project Session',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'home-open-mbc',
            label: 'Open Session',
            shortcut: sc('O'),
            onSelect: () => triggerOpenMbcPicker('replace'),
          },
          {
            kind: 'command',
            id: 'home-open-sample',
            label: 'Sample Project',
            onSelect: () => handleStartNewSession('sample-library'),
          },
          {
            kind: 'command',
            id: 'home-open-auto',
            label: 'Restore Autosave',
            onSelect: () => handleRestoreLocalAutosave(),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'home-open-file',
        label: 'Sequence File',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'home-open-disk',
            label: 'Open Sequence File',
            onSelect: () => triggerImportFilesPicker(),
          },
        ],
      },
    ],
    import: buildImportMenuNodes('home-imp'),
    'sidebar-more': [
      {
        kind: 'submenu',
        id: 'home-sb-more-proj',
        label: 'Project Actions',
        minWidth: 210,
        children: [
          {
            kind: 'command',
            id: 'home-sb-open',
            label: 'Open Session',
            onSelect: () => triggerOpenMbcPicker('replace'),
          },
          {
            kind: 'command',
            id: 'home-sb-sample',
            label: 'Sample Project',
            onSelect: () => handleStartNewSession('sample-library'),
          },
          {
            kind: 'command',
            id: 'home-sb-new-folder',
            label: 'New Folder',
            onSelect: () => handleStartNewSession('new-folder'),
          },
        ],
      },
    ],
  };

  const multifileMenus: Record<'annotate' | 'manage' | 'columns', MenuNode[]> = {
    annotate: [
      {
        kind: 'submenu',
        id: 'mf-ann-feat',
        label: 'Features & Primers',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'mf-detect-common',
            label: 'Detect Features',
            onSelect: () => handleAutoDetectCommonFeatures(),
          },
          {
            kind: 'command',
            id: 'mf-open-ann',
            label: 'Edit Annotations',
            onSelect: () => setViewerTab('annotations-table'),
          },
          {
            kind: 'command',
            id: 'mf-extract-ann',
            label: 'Extract Features',
            onSelect: () => handleExtractAnnotatedFeatures(),
          },
          {
            kind: 'command',
            id: 'mf-open-primers',
            label: 'Primers & CRISPR',
            onSelect: () => setViewerTab('primers-pcr'),
          },
          {
            kind: 'command',
            id: 'mf-convert-oligo',
            label: 'Selection to Oligo',
            onSelect: () => handleConvertSelectionToOligo(),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'mf-batch-ops',
        label: 'Batch Sequence',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'mf-concat-sel',
            label: 'Concatenate',
            onSelect: () => handleConcatenateSelectedSequences(),
          },
          {
            kind: 'command',
            id: 'mf-consensus-sel',
            label: 'Generate Consensus',
            onSelect: () => handleGenerateConsensusFromSelected(),
          },
          {
            kind: 'command',
            id: 'mf-mask-sel',
            label: 'Mask Selection',
            onSelect: () => handleMaskActiveSequence('selection'),
          },
          {
            kind: 'command',
            id: 'mf-mask-lowcomp',
            label: 'Mask Homopolymers',
            onSelect: () => handleMaskActiveSequence('low-complexity'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'mf-sim-sub',
        label: 'Simulate & Verify',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'mf-sim-gel',
            label: 'Digest & Gel',
            onSelect: () => openCloningMethod('Restriction Ligation', 'gel'),
          },
          {
            kind: 'command',
            id: 'mf-sim-gibson',
            label: 'Seamless Assembly',
            onSelect: () => openCloningMethod('Gibson Assembly', 'gel'),
          },
          {
            kind: 'command',
            id: 'mf-sim-sanger',
            label: 'Verify Sanger',
            onSelect: () => setViewerTab('sanger-contig'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'mf-edit-seq',
        label: 'Strand & Topology',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'mf-tog-topo',
            label: `Set ${activeDoc.topology === 'circular' ? 'Linear' : 'Circular'}`,
            onSelect: () => handleToggleCircularLinear(),
          },
          {
            kind: 'command',
            id: 'mf-rc',
            label: 'Reverse Complement',
            disabled: !isCommandEnabled('strand-transform'),
            onSelect: () => handleReverseComplementActiveDoc(),
          },
          {
            kind: 'command',
            id: 'mf-dna-rna',
            label: 'Convert DNA / RNA',
            disabled: !isCommandEnabled('convert-dna-rna'),
            onSelect: () => handleConvertDnaRna(),
          },
        ],
      },
    ],
    manage: [
      {
        kind: 'submenu',
        id: 'mf-mng-add',
        label: 'Add Files',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'mf-add-seq',
            label: 'New Sequence',
            shortcut: sc('N'),
            onSelect: () => setNewSeqModalOpen(true),
          },
          {
            kind: 'command',
            id: 'mf-imp-file',
            label: 'Import Files',
            onSelect: () => triggerImportFilesPicker(),
          },
          {
            kind: 'command',
            id: 'mf-new-folder',
            label: 'New Subfolder',
            onSelect: () => handleStartNewSession('new-folder'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'mf-mng-folders',
        label: 'Folders & Favorites',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'mf-toggle-fav',
            label: 'Toggle Favorite',
            onSelect: () => handleToggleFavoriteDocs(),
          },
          {
            kind: 'command',
            id: 'mf-move-folder',
            label: 'Move to Folder',
            onSelect: () => handleMoveSelectedDocsToFolder(),
          },
          {
            kind: 'command',
            id: 'mf-rename-folder',
            label: 'Rename Folder',
            onSelect: () => handleRenameSelectedFolder(),
          },
          {
            kind: 'command',
            id: 'mf-folder-color',
            label: 'Cycle Folder Color',
            onSelect: () => handleCycleSelectedFolderColor(),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'mf-mng-trash',
        label: 'Trash',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'mf-soft-delete',
            label: 'Move to Trash',
            onSelect: () => handleSoftDeleteSelectedDocs(),
          },
          {
            kind: 'command',
            id: 'mf-restore-deleted',
            label: 'Restore from Trash',
            disabled: deletedDocIds.length === 0,
            onSelect: () => handleRestoreFromDeletedItems(),
          },
          {
            kind: 'command',
            id: 'mf-erase-deleted',
            label: 'Empty Trash',
            disabled: deletedDocIds.length === 0,
            onSelect: () => handleEraseAllDeletedItems(),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'mf-mng-exp',
        label: 'Export & Save',
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'mf-exp-gb',
            label: 'Export GenBank',
            onSelect: () =>
              handleExportActiveDocument('genbank'),
          },
          {
            kind: 'command',
            id: 'mf-exp-fa',
            label: 'Export FASTA',
            disabled: !isCommandEnabled('export-sequence'),
            onSelect: () =>
              handleExportActiveDocument('fasta'),
          },
          {
            kind: 'command',
            id: 'mf-exp-lineage',
            label: 'Export Lineage',
            onSelect: () => handleExportLineageBundle(),
          },
          {
            kind: 'command',
            id: 'mf-exp-svg',
            label: 'Save SVG Map',
            onSelect: () => handleSaveViewerAsSvgImage(),
          },
          {
            kind: 'command',
            id: 'mf-save-mbc',
            label: 'Save Session',
            onSelect: () => handleSaveMbcWorkbench(false),
          },
        ],
      },
    ],
    columns: buildTableColumnsMenuNodes('mf-cols'),
  };

  const topMenuBarEntries: {
    id: Exclude<TopMenuId, 'app' | null>;
    label: string;
    minWidth: number;
  }[] = [
    { id: 'file', label: 'File', minWidth: 215 },
    { id: 'edit', label: 'Edit', minWidth: 210 },
    { id: 'view', label: 'View', minWidth: 215 },
    { id: 'sequence', label: 'Sequence', minWidth: 215 },
    { id: 'cloning', label: 'Cloning', minWidth: 215 },
    { id: 'tools', label: 'Tools', minWidth: 220 },
    { id: 'help', label: 'Help', minWidth: 210 },
  ];

  const allMenubarTriggers: {
    id: Exclude<TopMenuId, null>;
    minWidth: number;
  }[] = [
    { id: 'app', minWidth: 215 },
    ...topMenuBarEntries.map((entry) => ({
      id: entry.id,
      minWidth: entry.minWidth,
    })),
  ];

  const handleMenubarKeyDown = (
    currentId: Exclude<TopMenuId, null>,
    currentMinWidth: number,
    e: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    const idx = allMenubarTriggers.findIndex((t) => t.id === currentId);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const next =
        allMenubarTriggers[
          (idx + delta + allMenubarTriggers.length) % allMenubarTriggers.length
        ];
      setMenubarFocusId(next.id);
      const nextBtn = menubarTriggerRefs.current[next.id];
      nextBtn?.focus({ preventScroll: true });
      if (openTopMenu && nextBtn) {
        const pos = computeViewportClampedMenuPosition(
          nextBtn.getBoundingClientRect(),
          window.innerWidth,
          window.innerHeight,
          next.minWidth
        );
        setMenuPopupPos(pos);
        setOpenTopMenu(next.id);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const btn = menubarTriggerRefs.current[currentId];
      if (btn && openTopMenu !== currentId) {
        const pos = computeViewportClampedMenuPosition(
          btn.getBoundingClientRect(),
          window.innerWidth,
          window.innerHeight,
          currentMinWidth
        );
        setMenuPopupPos(pos);
        setOpenTopMenu(currentId);
      }
    }
  };

  return (
    <div
      ref={workbenchRootRef}
      className={`mbc-workbench ${darkMode ? 'mbc-dark-mode' : ''}${
        sidebarDragging || inspectorDragging || workspacePaneDragging ? ' is-resizing' : ''
      }${
        workspacePaneDragging && workspaceSplitMode === 'top-bottom' ? ' is-resizing-rows' : ''
      }`}
      style={sidebarWidthVarStyle}
      onDragEnter={handleDragEnterWorkbench}
      onDragOver={handleDragOverWorkbench}
      onDragLeave={handleDragLeaveWorkbench}
      onDrop={handleDropOnWorkbench}
    >
      {isFileDragActive && (
        <div
          className="mbc-window-drop-overlay"
          role="status"
          aria-live="polite"
        >
          <div className="mbc-window-drop-card">
            <Upload size={28} className="mbc-icon blue" aria-hidden="true" />
            <strong>Drop Files into MolBioCraft Window</strong>
            <span>
              Session (.mbc) • GenBank / EMBL (.gb, .gbk, .embl) • FASTA / FASTQ (.fa, .fasta, .fq) • Sanger Traces (.ab1, .scf) • Annotations (.gff3, .bed) • 3D Structures (.pdb, .cif)
            </span>
          </div>
        </div>
      )}

      {/* 1. In-Window Application Menu Bar (Windows, Linux & Web Browser; hidden when integrated into macOS system menu bar) */}
      {!useNativeMacMenuBar && (
        <div
          className="mbc-menubar"
          data-tauri-drag-region
          onMouseDown={handleWindowChromeMouseDown}
        >
          <div
            className="menubar-left"
            role="menubar"
            aria-label="Main Menu Bar"
          >
            <div className="menubar-dropdown-anchor">
              <button
                ref={(el) => {
                  menubarTriggerRefs.current.app = el;
                }}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openTopMenu === 'app'}
                tabIndex={menubarFocusId === 'app' ? 0 : -1}
                className={`app-brand-pill ${openTopMenu === 'app' ? 'active' : ''}`}
                title="Application Menu"
                aria-label="Application Menu"
                onClick={(e) => {
                  setMenubarFocusId('app');
                  toggleTopMenu('app', e, 215);
                }}
                onKeyDown={(e) => handleMenubarKeyDown('app', 215, e)}
                onMouseEnter={(e) => {
                  if (openTopMenu && openTopMenu !== 'app') {
                    toggleTopMenu('app', e, 215);
                  }
                }}
              >
                <MolBioCraftLogo size={17} />
              </button>
              {openTopMenu === 'app' && (
                <CascadingMenuPopup
                  items={topMenus.app}
                  position={menuPopupPos}
                  minWidth={215}
                  ariaLabel="Application Menu"
                  onCloseAll={() => setOpenTopMenu(null)}
                />
              )}
            </div>

            {topMenuBarEntries.map((entry) => (
              <div key={entry.id} className="menubar-dropdown-anchor">
                <button
                  ref={(el) => {
                    menubarTriggerRefs.current[entry.id] = el;
                  }}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openTopMenu === entry.id}
                  tabIndex={menubarFocusId === entry.id ? 0 : -1}
                  className={`menu-item ${openTopMenu === entry.id ? 'active' : ''}`}
                  onClick={(e) => {
                    setMenubarFocusId(entry.id);
                    toggleTopMenu(entry.id, e, entry.minWidth);
                  }}
                  onKeyDown={(e) =>
                    handleMenubarKeyDown(entry.id, entry.minWidth, e)
                  }
                  onMouseEnter={(e) => {
                    if (openTopMenu && openTopMenu !== entry.id) {
                      toggleTopMenu(entry.id, e, entry.minWidth);
                    }
                  }}
                >
                  {entry.label}
                </button>
                {openTopMenu === entry.id && (
                  <CascadingMenuPopup
                    items={topMenus[entry.id]}
                    position={menuPopupPos}
                    minWidth={entry.minWidth}
                    ariaLabel={`${entry.label} Menu`}
                    onCloseAll={() => setOpenTopMenu(null)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Always-mounted hidden file pickers for Open (.mbc), Batch Import (.gb/.fasta/.ab1), and Preferences Archive */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="mbc-visually-hidden-file-input"
        accept=".mbc,.mcb,.gb,.gbk,.genbank,.embl,.gff,.gff3,.bed,.fasta,.fa,.fas,.fna,.faa,.ab1,.abi,.scf,.fsa,.hid,.fastq,.fq,.pdb,.cif,.mmcif,.ent,.sam,.bam,.vcf,.nex,.nexus,.nwk,.newick,.tre,.aln,.clustal,.phy,.phylip,.sto,.sth,.stk,.txt,.json,.zip"
        onChange={handleImportFile}
      />
      <input
        ref={folderImportInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        tabIndex={-1}
        aria-hidden="true"
        className="mbc-visually-hidden-file-input"
        onChange={handleImportFolderFiles}
      />
      <input
        ref={mbcFileInputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        className="mbc-visually-hidden-file-input"
        accept=".mbc,.mcb,application/json,application/zip"
        onChange={handleImportMbcFile}
      />
      <input
        ref={prefsImportInputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        className="mbc-visually-hidden-file-input"
        accept=".json,application/json"
        onChange={handleImportPreferencesFile}
      />

      {/* 1B. Unified Titleless Project Window Header & Open File Tab Bar (No software name; zero document tabs before New Session) */}
      <div
        className={`mbc-project-tabbar ${
          useNativeMacMenuBar ? 'macos-native-header' : ''
        }`}
        data-tauri-drag-region
        onMouseDown={handleWindowChromeMouseDown}
      >
        <div
          className={`mbc-tabbar-left ${
            sidebarOpen ? 'sidebar-aligned' : 'collapsed'
          }`}
          data-tauri-drag-region
          style={sidebarOpen ? sidebarWidthVarStyle : undefined}
        >
          <button
            type="button"
            className={`nav-cluster-icon-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle Project Folder Sidebar"
            title="Toggle Project Folder Sidebar"
          >
            <PanelLeft size={15} />
          </button>
          <span className="mbc-tabbar-left-spacer" data-tauri-drag-region />
          <button
            type="button"
            className={`nav-cluster-icon-btn ${prefsModalTab ? 'active' : ''}`}
            onClick={() => setPrefsModalTab('General')}
            aria-label="Preferences"
            aria-keyshortcuts={ariaSc(',')}
            title={`Preferences (${sc(',')})`}
          >
            <Settings2 size={15} />
          </button>
          <button
            type="button"
            className={`nav-cluster-icon-btn ${
              !sessionActive || homeViewActive ? 'active' : ''
            }`}
            onClick={() => {
              if (sessionActive) {
                setHomeViewActive((v) => !v);
              }
            }}
            aria-label="Project First Page"
            title="Project First Page"
          >
            <Home size={15} />
          </button>
        </div>

        <ScrollableMenuStrip
          className="mbc-scroll-strip--doc-tabs"
          trackClassName="mbc-tabbar-tabs"
          role="tablist"
          ariaLabel="Open Project Files"
          activeKey={homeViewActive ? '__home__' : activeDoc.id}
          enableSpatialArrowNav
          dragRegion
          prevAriaLabel="Slide open file tabs left"
          nextAriaLabel="Slide open file tabs right"
        >
          {sessionActive &&
            openTabIds.map((tabDocId) => {
              const tabDoc =
                documents.find((d) => d.id === tabDocId) ?? sampleLibraryById.get(tabDocId);
              if (!tabDoc) return null;
              const isTabActive = !homeViewActive && tabDoc.id === activeDoc.id;
              return (
                <div
                  key={tabDoc.id}
                  className={`mbc-doc-tab mbc-doc-tab-shell ${
                    isTabActive ? 'active' : ''
                  }`}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      handleCloseDocumentTab(tabDoc.id, e);
                    }
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    tabIndex={isTabActive ? 0 : -1}
                    aria-selected={isTabActive}
                    className="mbc-doc-tab-trigger"
                    onClick={() => {
                      selectDocumentWithHistory(tabDoc.id);
                      if (tabDoc.chromatogram && viewerTab === 'sequence-view') {
                        setViewerTab('sanger-contig');
                      }
                    }}
                    title={tabDoc.documentKind === 'tree'
                      ? `${tabDoc.name} (${tabDoc.docMetadata?.['No. tips'] ?? 'unknown'} tips)`
                      : `${tabDoc.name} (${tabDoc.sequence.length.toLocaleString()} ${tabDoc.moleculeType === 'Protein' ? 'aa' : tabDoc.moleculeType === 'RNA' ? 'nt' : 'bp'})`}
                  >
                    <SequenceDocKindIcon kind={inferDocumentIconKind(tabDoc)} doc={tabDoc} size={15} />
                    <span className="mbc-doc-tab-title">{tabDoc.name}</span>
                  </button>
                  <button
                    type="button"
                    className="mbc-doc-tab-close"
                    aria-label={`Close ${tabDoc.name}`}
                    onClick={(e) => handleCloseDocumentTab(tabDoc.id, e)}
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}

          <div className="toolbar-dropdown-anchor">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openToolbarDropdown === 'tab-plus'}
              className={`mbc-tab-plus-btn ${
                openToolbarDropdown === 'tab-plus' ? 'active' : ''
              }`}
              onClick={(e) => toggleToolbarMenu('tab-plus', e, 215)}
              title={
                sessionActive
                  ? 'New File or New Project Session'
                  : 'Start New Project Session'
              }
              aria-label="New Project Session or File"
            >
              <Plus size={14} />
            </button>
            {openToolbarDropdown === 'tab-plus' && (
              <CascadingMenuPopup
                items={toolbarMenus['tab-plus']}
                position={menuPopupPos}
                minWidth={215}
                ariaLabel="New Session Menu"
                onCloseAll={closeAllMenus}
              />
            )}
          </div>
        </ScrollableMenuStrip>

        <div className="mbc-tabbar-right" data-tauri-drag-region>
          <search className="toolbar-global-search mbc-tabbar-search" data-no-window-drag>
            <label htmlFor="mbc-toolbar-global-search-input" className="mbc-sr-only">
              Search tools or files
            </label>
            <Search size={13} className="toolbar-search-icon" aria-hidden="true" />
            <input
              id="mbc-toolbar-global-search-input"
              name="globalSearch"
              type="text"
              placeholder="Search tools or files"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={globalSearchQuery}
              onFocus={() => {
                setHeaderSearchFocused(true);
                setHeaderSearchIdx(0);
              }}
              onBlur={() => {
                setHeaderSearchFocused(false);
              }}
              onChange={(e) => {
                setGlobalSearchQuery(e.target.value);
                setHeaderSearchFocused(true);
                setHeaderSearchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && headerSearchMatches.length > 0) {
                  e.preventDefault();
                  setHeaderSearchFocused(true);
                  setHeaderSearchIdx((i) =>
                    Math.min(headerSearchMatches.length - 1, i + 1)
                  );
                } else if (e.key === 'ArrowUp' && headerSearchMatches.length > 0) {
                  e.preventDefault();
                  setHeaderSearchFocused(true);
                  setHeaderSearchIdx((i) => Math.max(0, i - 1));
                } else if (
                  e.key === 'Enter' &&
                  !e.nativeEvent.isComposing &&
                  headerSearchMatches.length > 0
                ) {
                  e.preventDefault();
                  const chosen =
                    headerSearchMatches[
                      Math.min(headerSearchIdx, headerSearchMatches.length - 1)
                    ];
                  if (chosen) {
                    chosen.run();
                    setGlobalSearchQuery('');
                    setHeaderSearchFocused(false);
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  if (globalSearchQuery.length > 0) {
                    setGlobalSearchQuery('');
                  } else {
                    setHeaderSearchFocused(false);
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }
              }}
            />
            {globalSearchQuery.length > 0 ? (
              <button
                type="button"
                className="toolbar-search-clear"
                aria-label="Clear search query"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setGlobalSearchQuery('');
                  setHeaderSearchIdx(0);
                }}
              >
                <X size={11} aria-hidden="true" />
              </button>
            ) : (
              <kbd className="toolbar-search-kbd" aria-hidden="true">
                {sc('F', { shift: true })}
              </kbd>
            )}
            {headerSearchFocused && globalSearchQuery.trim().length > 0 && (
              <div
                className="mbc-header-search-results"
                role="listbox"
                aria-label="Matching tools and project files"
              >
                {headerSearchMatches.length > 0 ? (
                  headerSearchMatches.map((item, idx) => (
                    <button
                      type="button"
                      key={item.id}
                      role="option"
                      aria-selected={idx === headerSearchIdx}
                      className={`mbc-header-search-item ${
                        idx === headerSearchIdx ? 'selected' : ''
                      }`}
                      onMouseEnter={() => setHeaderSearchIdx(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        item.run();
                        setGlobalSearchQuery('');
                        setHeaderSearchFocused(false);
                      }}
                    >
                      <span className="mbc-header-search-label">
                        <span className="mbc-search-leading-icon" aria-hidden="true">
                          {resolveMenuItemIcon(item.id, item.label, false, 14)}
                        </span>
                        <span>{item.label}</span>
                      </span>
                      <span className="mbc-header-search-meta">
                        <span className="mbc-cmd-cat-pill">{item.category}</span>
                        <span>{item.hint}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="mbc-header-search-empty">
                    No matching tools or project files
                  </div>
                )}
              </div>
            )}
          </search>

          <div className="toolbar-dropdown-anchor">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openToolbarDropdown === 'tab-more'}
              className={`nav-cluster-icon-btn ${
                openToolbarDropdown === 'tab-more' ? 'active' : ''
              }`}
              onClick={(e) => toggleToolbarMenu('tab-more', e, 205)}
              title="Window & Appearance Options"
              aria-label="Window & Appearance Options"
            >
              <MoreVertical size={15} />
            </button>
            {openToolbarDropdown === 'tab-more' && (
              <CascadingMenuPopup
                items={toolbarMenus['tab-more']}
                position={menuPopupPos}
                minWidth={205}
                ariaLabel="Window Options Menu"
                onCloseAll={closeAllMenus}
              />
            )}
          </div>
        </div>
      </div>

      {/* 2. Top Action Toolbar (Shown only when an active project workspace is open) */}
      {sessionActive && !homeViewActive && (
      <header
        className={`mbc-action-toolbar ${
          useNativeMacMenuBar ? 'macos-native-header' : ''
        }`}
        data-tauri-drag-region
        onMouseDown={handleWindowChromeMouseDown}
      >
        {/* Left Navigation Cluster (Aligned with Left Sidebar): ONLY Back, Forward, Undo, Redo */}
        <div
          className={`toolbar-left-nav-cluster ${
            sidebarOpen ? 'sidebar-aligned' : 'collapsed'
          }`}
          data-tauri-drag-region
          style={sidebarOpen ? sidebarWidthVarStyle : undefined}
        >
          <button
            type="button"
            className="nav-cluster-icon-btn"
            onClick={() => requireActiveSession(() => handleGoBack())}
            disabled={!sessionActive || navIndex <= 0}
            aria-label="Navigate Back"
            aria-keyshortcuts={ariaSc('[')}
            title={`Back (${sc('[')})`}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            className="nav-cluster-icon-btn"
            onClick={() => requireActiveSession(() => handleGoForward())}
            disabled={!sessionActive || navIndex >= navHistory.length - 1}
            aria-label="Navigate Forward"
            aria-keyshortcuts={ariaSc(']')}
            title={`Forward (${sc(']')})`}
          >
            <ArrowRight size={15} />
          </button>
          <span className="nav-cluster-subdivider" aria-hidden="true" />
          <button
            type="button"
            className="nav-cluster-icon-btn"
            onClick={() => requireActiveSession(() => handleUndoDocumentEdit())}
            disabled={!sessionActive || undoStack.length === 0}
            aria-label="Undo Sequence or Annotation Edit"
            aria-keyshortcuts={ariaSc('Z')}
            title={
              undoStack.length > 0
                ? `Undo ${undoStack[undoStack.length - 1].label} (${sc('Z')})`
                : `Undo (${sc('Z')})`
            }
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            className="nav-cluster-icon-btn"
            onClick={() => requireActiveSession(() => handleRedoDocumentEdit())}
            disabled={!sessionActive || redoStack.length === 0}
            aria-label="Redo Sequence or Annotation Edit"
            aria-keyshortcuts={ariaSc('Z', { shift: true })}
            title={
              redoStack.length > 0
                ? `Redo ${redoStack[redoStack.length - 1].label} (${sc('Z', { shift: true })})`
                : `Redo (${sc('Z', { shift: true })})`
            }
          >
            <Redo2 size={14} />
          </button>
        </div>

        <ScrollableMenuStrip
          className="mbc-scroll-strip--toolbar"
          trackClassName="toolbar-actions-strip"
          dragRegion
          prevAriaLabel="Slide toolbar actions left"
          nextAriaLabel="Slide toolbar actions right"
        >
        {/* 1. Add ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'add'}
            className={`mbc-tool-btn ${openToolbarDropdown === 'add' ? 'active' : ''}`}
            onClick={(e) => toggleToolbarMenu('add', e, 215)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'add') {
                toggleToolbarMenu('add', e, 215);
              }
            }}
          >
            <BioAddIcon size={21} className="mbc-icon teal" />
            <span>
              Add <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'add' && (
            <CascadingMenuPopup
              items={toolbarMenus.add}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Add & New Session Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 2. Import ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'import'}
            className={`mbc-tool-btn ${openToolbarDropdown === 'import' ? 'active' : ''}`}
            onClick={(e) => toggleToolbarMenu('import', e, 215)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'import') {
                toggleToolbarMenu('import', e, 215);
              }
            }}
            title="Import Sequence Files (.gb / .fasta / .embl), Sanger Traces (.ab1), NGS Reads, Vectors & Reference Databases"
          >
            <BioImportIcon size={21} className="mbc-icon teal" />
            <span>
              Import <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'import' && (
            <CascadingMenuPopup
              items={toolbarMenus.import}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Import Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 3. Export ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'export'}
            className={`mbc-tool-btn ${openToolbarDropdown === 'export' ? 'active' : ''}`}
            onClick={(e) => toggleToolbarMenu('export', e, 215)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'export') {
                toggleToolbarMenu('export', e, 215);
              }
            }}
          >
            <BioExportIcon size={21} className="mbc-icon blue" />
            <span>
              Export <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'export' && (
            <CascadingMenuPopup
              items={toolbarMenus.export}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Export Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 4. Session ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'session'}
            className={`mbc-tool-btn ${openToolbarDropdown === 'session' ? 'active' : ''}`}
            onClick={(e) => toggleToolbarMenu('session', e, 215)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'session') {
                toggleToolbarMenu('session', e, 215);
              }
            }}
            title="Start New Session, Open or Save MolBioCraft Workbench Session (.mbc)"
          >
            <BioSessionIcon size={21} className="mbc-icon teal" />
            <span>
              Session <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'session' && (
            <CascadingMenuPopup
              items={toolbarMenus.session}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Session Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 5. BLAST */}
        <button
          type="button"
          disabled={!sessionActive}
          className={`mbc-tool-btn ${blastModalOpen ? 'active' : ''}`}
          onClick={() => requireActiveSession(() => setBlastModalOpen(true))}
          title="Run Local & NCBI BLAST Search (blastn, blastp, blastx, tblastn)"
        >
          <BioBlastIcon size={21} className="mbc-icon orange" />
          <span>BLAST</span>
        </button>

        <span className="nav-cluster-subdivider" aria-hidden="true" />

        <div className="toolbar-studio-menus-cluster">
        {/* 6. Workflows ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'workflows'}
            className={`mbc-tool-btn ${
              (sessionActive &&
                (viewerTab === 'history-hybrid' || viewerTab === 'guided-pipelines')) ||
              openToolbarDropdown === 'workflows'
                ? 'active'
                : ''
            }`}
            onClick={(e) => toggleToolbarMenu('workflows', e, 215)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'workflows') {
                toggleToolbarMenu('workflows', e, 215);
              }
            }}
          >
            <BioWorkflowsIcon size={21} className="mbc-icon blue" />
            <span>
              Workflows <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'workflows' && (
            <CascadingMenuPopup
              items={toolbarMenus.workflows}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Workflows Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 7. Align ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            disabled={!hasSequenceData}
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'align'}
            className={`mbc-tool-btn ${
              (sessionActive && viewerTab === 'sequence-alignment') ||
              openToolbarDropdown === 'align'
                ? 'active'
                : ''
            }`}
            onClick={(e) => toggleToolbarMenu('align', e, 215)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'align') {
                toggleToolbarMenu('align', e, 215);
              }
            }}
            title="Multiple Sequence Alignment (MAFFT-style, Clustal-style, MUSCLE-style), Pairwise NW/SW, Read Assembly, Dotplot & Consensus"
          >
            <BioAlignAssembleIcon size={21} className="mbc-icon green" />
            <span>
              Align <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'align' && (
            <CascadingMenuPopup
              items={toolbarMenus.align}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Alignment Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 8. Tree ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'tree'}
            className={`mbc-tool-btn ${
              (sessionActive && viewerTab === 'phylogenetics') ||
              openToolbarDropdown === 'tree'
                ? 'active'
                : ''
            }`}
            onClick={(e) => toggleToolbarMenu('tree', e, 220)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'tree') {
                toggleToolbarMenu('tree', e, 220);
              }
            }}
            title="Phylogenetic Tree Reconstruction (ML, FastTree, PhyML, RAxML, MrBayes, NJ, ME, UPGMA, MP), Substitution Models, Distances, Selection & Rates, Clocks & Variants"
          >
            <BioTreeIcon size={21} className="mbc-icon amber" />
            <span>
              Tree <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'tree' && (
            <CascadingMenuPopup
              items={toolbarMenus.tree}
              position={menuPopupPos}
              minWidth={220}
              ariaLabel="Phylogenetic Tree Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 9. Primers ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'primers'}
            disabled={!isDnaSequence}
            title={isDnaSequence ? 'Primer, PCR and CRISPR tools' : 'Select a DNA sequence to use primers tools'}
            className={`mbc-tool-btn ${
              (sessionActive && viewerTab === 'primers-pcr') ||
              openToolbarDropdown === 'primers'
                ? 'active'
                : ''
            }`}
            onClick={(e) => toggleToolbarMenu('primers', e, 215)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'primers') {
                toggleToolbarMenu('primers', e, 215);
              }
            }}
          >
            <BioPrimersIcon size={21} className="mbc-icon green" />
            <span>
              Primers <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'primers' && (
            <CascadingMenuPopup
              items={toolbarMenus.primers}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Primers and CRISPR Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 10. Cloning ▾ */}
        <div className="toolbar-dropdown-anchor">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openToolbarDropdown === 'cloning'}
            disabled={!isDnaSequence}
            title={isDnaSequence ? 'Cloning and assembly tools' : 'Select a DNA sequence to use cloning tools'}
            className={`mbc-tool-btn ${
              (sessionActive && viewerTab === 'cloning-gel') ||
              openToolbarDropdown === 'cloning'
                ? 'active'
                : ''
            }`}
            onClick={(e) => toggleToolbarMenu('cloning', e, 215)}
            onMouseEnter={(e) => {
              if (openToolbarDropdown && openToolbarDropdown !== 'cloning') {
                toggleToolbarMenu('cloning', e, 215);
              }
            }}
          >
            <BioCloningIcon size={21} className="mbc-icon blue" />
            <span>
              Cloning <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
          {openToolbarDropdown === 'cloning' && (
            <CascadingMenuPopup
              items={toolbarMenus.cloning}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Cloning Menu"
              onCloseAll={() => setOpenToolbarDropdown(null)}
            />
          )}
        </div>

        {/* 11. Dedicated Vector Library & Design Studio Toolbar Action */}
        <button
          type="button"
          className={`mbc-tool-btn ${
            sessionActive && viewerTab === 'vector-library' ? 'active' : ''
          }`}
          onClick={() => requireActiveSession(() => openVectorStudio('catalog'))}
          title={`Browse ${VECTOR_CATALOG.length} Twist, Modular Systems & ConductScience Vectors, Modular Vector Architect & Twist Onboarding`}
        >
          <BioVectorsIcon size={21} className="mbc-icon teal" />
          <span>Vectors</span>
        </button>
        {opShortcuts.toolbar.length > 0 && <span className="nav-cluster-subdivider" aria-hidden="true" />}
        {opShortcuts.toolbar.map((op) => {
          const Icon = OPERATION_TOOLBAR_ICONS[op];
          const key = opShortcuts.shortcuts[op];
          return (
            <button
              key={op}
              type="button"
              disabled={!sessionActive}
              className={`mbc-tool-btn ${operationDialog && operationDialogFor(op).kind === operationDialog.kind ? 'active' : ''}`}
              onClick={() => requireActiveSession(() => setOperationDialog(operationDialogFor(op)))}
              title={`${OPERATION_LABELS[op]}…${key ? ` (${formatShortcut(key, IS_MAC_PLATFORM)})` : ''}`}
            >
              <Icon size={19} className="mbc-icon blue" />
              <span>{OPERATION_LABELS[op]}</span>
            </button>
          );
        })}
        </div>
        </ScrollableMenuStrip>
      </header>
      )}

      {/* 3. Main Work Window: Project First Page (when !sessionActive or Home toggled) vs Active Split Workspace */}
      {!sessionActive || homeViewActive ? (
        <>
          <ProjectFirstPageHome
            sidebarOpen={sidebarOpen}
            sessionActive={sessionActive}
            sessionName={sessionName}
            documents={documents}
            hasLocalAutosave={hasLocalAutosave}
            isFileDragActive={isFileDragActive}
            openDropdown={openHomeDropdown}
            onToggleDropdown={toggleHomeDropdown}
            onWindowChromeMouseDown={handleWindowChromeMouseDown}
            onOpenSampleProject={() => handleStartNewSession('sample-library')}
            onStartBlankProject={() => handleStartNewSession('blank')}
            onOpenMbcSession={() => triggerOpenMbcPicker('replace')}
            onRestoreAutosave={handleRestoreLocalAutosave}
            onOpenFilePicker={triggerImportFilesPicker}
            onOpenSampleDocumentById={(sampleId, targetTab) =>
              handleOpenSampleDocumentFromHome(sampleId, targetTab ?? 'sequence-view')
            }
            onResumeActiveSession={() => setHomeViewActive(false)}
            onOpenShortcuts={() => setPrefsModalTab('Keyboard')}
            onOpenAbout={() => setAboutModalOpen(true)}
          />
          {openHomeDropdown && (
            <CascadingMenuPopup
              key={openHomeDropdown}
              items={homeDropdownMenus[openHomeDropdown]}
              position={menuPopupPos}
              minWidth={215}
              ariaLabel="Project First Page Menu"
              onCloseAll={closeAllMenus}
            />
          )}
        </>
      ) : (
      /* 3B. Main Split Workspace (Left Project Explorer | Resizer | Center Multifile Table + Sequence Viewer) */
      <div
        className={`mbc-main-split ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
        style={
          sidebarOpen
            ? ({ '--mbc-sidebar-width': `${sidebarWidthPx}px` } as React.CSSProperties)
            : undefined
        }
      >
        {/* Left Pane: MolBioCraft Project Folder & Database Explorer */}
        {sidebarOpen && (
          <aside
            className="mbc-sources-pane"
            aria-label="Project Explorer"
            onContextMenu={(event) => {
              openFolderContextMenu(event, PROJECT_ROOT);
            }}
          >
            <div
              className="mbc-project-explorer-head"
              data-tauri-drag-region
              onMouseDown={handleWindowChromeMouseDown}
              onContextMenu={(event) => {
                openFolderContextMenu(event, PROJECT_ROOT);
              }}
            >
              <div className="mbc-project-explorer-title">
                <FolderOpen size={14} className="mbc-icon blue" />
                <strong title={`${sessionName}.mbc`}>{sessionName}</strong>
              </div>
              <button
                type="button"
                className="nav-cluster-icon-btn"
                onClick={() => handleStartNewSession('new-folder')}
                aria-label="New Project Subfolder"
                title="New Project Subfolder"
              >
                <FolderPlus size={14} />
              </button>
            </div>

            <div
              className="sources-tree-scroll"
              onContextMenu={(event) => {
                if (event.target === event.currentTarget) {
                  openFolderContextMenu(event, PROJECT_ROOT);
                }
              }}
            >
              {/* ★ Favorites */}
              <button
                type="button"
                className={`source-folder-row ${
                  selectedFolder === 'Favorites' ? 'selected' : ''
                }`}
                onClick={() => handleSelectProjectFolder('Favorites')}
                onContextMenu={(event) => openFolderContextMenu(event, 'Favorites')}
              >
                <span style={{ width: 12 }} />
                <MolBioSidebarNodeIcon nodeKey="Favorites" size={14} />
                <span className="folder-label">
                  <strong>Favorites</strong>
                </span>
                <span className="folder-count">
                  {activeNonDeletedDocs.filter((d) => favoriteIdsSet.has(d.id)).length}
                </span>
              </button>

              {favoriteFolders.filter((id) => !hiddenFolders.includes(id)).map((id) => (
                <button type="button" key={id} className={`source-folder-row ${selectedFolder === id ? 'selected' : ''}`}
                  onClick={() => handleSelectProjectFolder(id)} onContextMenu={(event) => openFolderContextMenu(event, id)}>
                  <span className="tree-leaf-spacer" aria-hidden="true" />
                  <Star size={14} /><span className="folder-label">{folderLabel(id)}</span>
                  <span className="folder-count">{explorerFolderCounts[id] ?? 0}</span>
                </button>
              ))}

              {/* ▾ Local Project Files */}
              <button
                type="button"
                className={`source-folder-row ${
                  selectedFolder === 'All Project Files' ? 'selected' : ''
                }`}
                onContextMenu={(event) => openFolderContextMenu(event, PROJECT_ROOT)}
                style={{ marginBlockStart: 2 }}
                onClick={() => {
                  toggleTreeNode('projectFiles');
                  handleSelectProjectFolder('All Project Files');
                }}
              >
                {expandedNodes.projectFiles ? (
                  <ChevronDown size={12} className="tree-chevron" />
                ) : (
                  <ChevronRight size={12} className="tree-chevron" />
                )}
                <MolBioSidebarNodeIcon
                  nodeKey="All Project Files"
                  isOpen={Boolean(expandedNodes.projectFiles)}
                  size={14}
                />
                <span className="folder-label">
                  <strong>All Project Files</strong>
                </span>
                <span className="folder-count">{activeNonDeletedDocs.length}</span>
              </button>

              {expandedNodes.projectFiles && (
                <div className="tree-indent-1">
                  <ProjectFolderTree
                    folders={visibleExplorerFolders}
                    selected={selectedFolder}
                    expanded={expandedNodes}
                    colors={folderColors}
                    counts={explorerFolderCounts}
                    onSelect={handleSelectProjectFolder}
                    onToggle={(id) => setExpandedNodes((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))}
                    onContextMenu={openFolderContextMenu}
                  />

                  {/* Reference Features: Standard Plasmid Features */}
                  <button
                    type="button"
                    className="source-folder-row"
                    onClick={() => setViewerTab('annotations-table')}
                    title="Inspect and apply standard plasmid promoter, resistance, origin, and tag features"
                  >
                    <span className="tree-leaf-spacer" aria-hidden="true" />
                    <MolBioSidebarNodeIcon nodeKey="standard-features" size={13} />
                    <span className="folder-label">Standard Plasmid Features</span>
                    <span className="folder-count">{COMMON_PLASMID_FEATURES.length}</span>
                  </button>

                  {/* 🗑 Deleted Items (Soft-Delete Recycle Bin) */}
                  <button
                    type="button"
                    className={`source-folder-row ${
                      selectedFolder === 'Deleted Items' ? 'selected' : ''
                    }`}
                    onClick={() => handleSelectProjectFolder('Deleted Items')}
                    onContextMenu={(event) => openFolderContextMenu(event, 'Deleted Items')}
                    title="Non-destructive recycle bin (use Put Back to restore or Erase All to remove)"
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="Deleted Items" size={13} />
                    <span className="folder-label">Deleted Items</span>
                    <span className="folder-count">{deletedDocIds.length}</span>
                  </button>
                </div>
              )}

              {/* ⟳ Operations & Lineage */}
              <button
                type="button"
                className="source-folder-row"
                style={{ marginBlockStart: 6 }}
                onClick={() => openHybridSubTab('lineage')}
                title="View construct genealogy, operation history, and workflow runs"
              >
                <span style={{ width: 12 }} />
                <MolBioSidebarNodeIcon nodeKey="Operations" size={14} />
                <span className="folder-label">
                  <strong>Operations</strong>
                </span>
                <span className="folder-count">
                  {activeNonDeletedDocs.reduce((sum, d) => sum + (d.history?.length ?? 0), 0)}
                </span>
              </button>

              {/* ▾ NCBI, UniProt & Local BLAST Databases */}
              <button
                type="button"
                className="source-folder-row"
                style={{ marginBlockStart: 4 }}
                onClick={() => toggleTreeNode('ncbiDbs')}
              >
                {expandedNodes.ncbiDbs ? (
                  <ChevronDown size={12} className="tree-chevron" />
                ) : (
                  <ChevronRight size={12} className="tree-chevron" />
                )}
                <MolBioSidebarNodeIcon nodeKey="NCBI" size={14} />
                <span className="folder-label">
                  <strong>NCBI</strong>
                </span>
                <span className="folder-count">
                  {queryCuratedDatabaseRecordsRust('ncbi-gene', '').length +
                    queryCuratedDatabaseRecordsRust('ncbi-nucleotide', '').length +
                    queryCuratedDatabaseRecordsRust('ncbi-protein', '').length +
                    queryCuratedDatabaseRecordsRust('ncbi-pubmed', '').length +
                    queryCuratedDatabaseRecordsRust('ncbi-structure', '').length +
                    queryCuratedDatabaseRecordsRust('ncbi-taxonomy', '').length}
                </span>
              </button>

              {expandedNodes.ncbiDbs && (
                <div className="tree-indent-1">
                  {(
                    [
                      ['ncbi-gene', 'Gene'],
                      ['ncbi-nucleotide', 'Nucleotide'],
                      ['ncbi-protein', 'Protein'],
                      ['ncbi-pubmed', 'PubMed'],
                      ['ncbi-structure', 'Structure'],
                      ['ncbi-taxonomy', 'Taxonomy'],
                    ] as [ReferenceDatabaseCategoryId, string][]
                  ).map(([catId, label]) => (
                    <button
                      type="button"
                      key={catId}
                      className={`source-folder-row ${
                        dbExplorerCategory === catId ? 'selected' : ''
                      }`}
                      onClick={() => setDbExplorerCategory(catId)}
                    >
                      <span style={{ width: 12 }} />
                      <MolBioSidebarNodeIcon nodeKey={catId} size={13} />
                      <span className="folder-label">{label}</span>
                      <span className="folder-count">
                        {queryCuratedDatabaseRecordsRust(catId, '').length}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                className={`source-folder-row ${
                  dbExplorerCategory === 'uniprot' ? 'selected' : ''
                }`}
                onClick={() => setDbExplorerCategory('uniprot')}
              >
                <span style={{ width: 12 }} />
                <MolBioSidebarNodeIcon nodeKey="uniprot" size={14} />
                <span className="folder-label">
                  <strong>UniProt</strong>
                </span>
                <span className="folder-count">
                  {queryCuratedDatabaseRecordsRust('uniprot', '').length}
                </span>
              </button>

              <button
                type="button"
                className={`source-folder-row ${
                  dbExplorerCategory === 'local-blast-dbs' ? 'selected' : ''
                }`}
                onClick={() => setDbExplorerCategory('local-blast-dbs')}
              >
                <span style={{ width: 12 }} />
                <MolBioSidebarNodeIcon nodeKey="local-blast-dbs" size={13} />
                <span className="folder-label">Local BLAST Databases</span>
                <span className="folder-count">{localBlastDbs.length}</span>
              </button>

              {/* ▾ Built-In Vector & Reference Libraries */}
              <button
                type="button"
                className="source-folder-row"
                style={{ marginBlockStart: 6 }}
                onClick={() => toggleTreeNode('libraries')}
              >
                {expandedNodes.libraries ? (
                  <ChevronDown size={12} className="tree-chevron" />
                ) : (
                  <ChevronRight size={12} className="tree-chevron" />
                )}
                <MolBioSidebarNodeIcon nodeKey="vector-catalog" size={14} />
                <span className="folder-label">
                  <strong>Vector &amp; Reference Banks</strong>
                </span>
                <span className="folder-count">
                  {VECTOR_CATALOG.length +
                    MODULAR_VECTOR_PARTS.length +
                    COMMON_PLASMID_FEATURES.length +
                    4}
                </span>
              </button>

              {expandedNodes.libraries && (
                <div className="tree-indent-1">
                  <button
                    type="button"
                    className="source-folder-row"
                    onClick={() => openVectorStudio('catalog')}
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="vector-catalog" size={13} />
                    <span className="folder-label">Vector Catalog</span>
                    <span className="folder-count">{VECTOR_CATALOG.length}</span>
                  </button>
                  <button
                    type="button"
                    className="source-folder-row"
                    onClick={() => openVectorStudio('architect')}
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="modular-parts" size={13} />
                    <span className="folder-label">Modular Vector Parts</span>
                    <span className="folder-count">{MODULAR_VECTOR_PARTS.length}</span>
                  </button>
                  <button
                    type="button"
                    className="source-folder-row"
                    onClick={() => handleAutoDetectCommonFeatures()}
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="auto-annotate" size={13} />
                    <span className="folder-label">Auto-Annotate Features</span>
                    <span className="folder-count">{COMMON_PLASMID_FEATURES.length}</span>
                  </button>
                  <button
                    type="button"
                    className="source-folder-row"
                    onClick={() => handleFetchNcbiSample('cas9')}
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="ncbi-nucleotide" size={13} />
                    <span className="folder-label">RefSeq: SpCas9 CDS</span>
                    <span className="folder-count">1</span>
                  </button>
                  <button
                    type="button"
                    className="source-folder-row"
                    onClick={() => handleFetchNcbiSample('spike')}
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="ncbi-nucleotide" size={13} />
                    <span className="folder-label">RefSeq: Spike RBD</span>
                    <span className="folder-count">1</span>
                  </button>
                  <button
                    type="button"
                    className="source-folder-row"
                    onClick={() => handleLoadBenchmarkDocument('genome-500k')}
                    title="Generate & load a 500,000 bp annotated chromosome in the Resident Rust Sequence Store"
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="Genomes" size={13} />
                    <span className="folder-label">Genome: 500 kbp E. coli</span>
                    <span className="folder-count">1</span>
                  </button>
                  <button
                    type="button"
                    className="source-folder-row"
                    onClick={() => handleLoadBenchmarkDocument('protein-10k')}
                    title="Generate & load a 10,000 aa multi-domain polyprotein in the Resident Rust Sequence Store"
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="Protein Documents" size={13} />
                    <span className="folder-label">Protein: 10,000 aa Titin</span>
                    <span className="folder-count">1</span>
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}

        {sidebarOpen && (
          <div
            role="separator"
            aria-label="Resize Project Explorer sidebar"
            aria-orientation="vertical"
            aria-valuenow={sidebarWidthPx}
            aria-valuemin={190}
            aria-valuemax={420}
            tabIndex={0}
            className={`mbc-sidebar-resizer ${sidebarDragging ? 'dragging' : ''}`}
            title="Drag or press Left/Right Arrow keys to resize Project Explorer • Double-click to reset"
            onDoubleClick={() => setSidebarWidthPx(245)}
            onPointerDown={(e) => {
              if (sidebarDragRef.current.active) return;
              e.preventDefault();
              sidebarDragRef.current = {
                active: true,
                pointerId: e.pointerId,
                startX: e.clientX,
                startW: sidebarWidthPx,
              };
              setSidebarDragging(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setSidebarWidthPx((w) => Math.max(190, w - 16));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setSidebarWidthPx((w) => Math.min(420, w + 16));
              } else if (e.key === 'Home') {
                e.preventDefault();
                setSidebarWidthPx(245);
              }
            }}
          />
        )}

        {/* Center Area: Multifile Project Info Table + Sequence Viewer (Top/Bottom or Left/Right Split) */}
        <div
          className={`mbc-center-stack ${
            workspaceSplitMode === 'left-right' && !docTableCollapsed
              ? 'split-left-right'
              : ''
          }${docTableBelowViewer ? ' table-below' : ''}`}
          style={
            {
              '--mbc-doc-table-h': `${docTableHeightPx}px`,
              '--mbc-split-left-w': `${docTableWidthPx}px`,
            } as React.CSSProperties
          }
        >
          {(() => {
          // The table pane and its handle go before the viewer, or after it while the stacked layout
          // shows the expanded table (US-01M6S7T2), so the focus order follows the screen. The
          // viewer keeps its slot either way, so folding the table never remounts the studios. The
          // table pane moves instead: in the stacked layout a fold or an open renders it in the other
          // slot, a new pane, so its toggle hands keyboard focus on (toggleDocumentTableFromPane).
          /* Multifile Project Info Table */
          const docTablePane = (
          <section
            ref={docTablePaneRef}
            className={`mbc-doc-table-pane ${docTableCollapsed ? 'collapsed' : ''}${recordBarDoc ? ' has-record-bar' : ''}`}
            style={{ '--mbc-doc-table-h': `${docTableHeightPx}px` } as React.CSSProperties}
          >
            {/* Folded with a document open: one line naming the open record (US-01M6Q10G). */}
            {recordBarDoc && (
              <DocumentRecordBar doc={recordBarDoc} onShowTable={toggleDocumentTableFromPane}>
                {workspaceSplitMode !== 'top-bottom' && (
                  <button
                    type="button"
                    className="mbc-icon-btn"
                    onClick={() => setWorkspaceSplitMode('top-bottom')}
                    aria-label="Switch to Stacked (Top / Bottom) Split View"
                    title="Switch to Stacked (Top / Bottom) Split View"
                  >
                    <Rows2 size={13} />
                  </button>
                )}
              </DocumentRecordBar>
            )}
            {!recordBarDoc && (
            <div className="doc-table-toolbar">
              <div className="doc-table-title">
                <FileSpreadsheet size={14} />
                <strong>
                  {folderLabel(selectedFolder)}
                </strong>
                <span className="doc-count-label">
                  ({filteredDocuments.length}{' '}
                  {filteredDocuments.length === 1 ? 'document' : 'documents'})
                </span>
                {selectedFolder === 'Deleted Items' && deletedDocIds.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="mbc-multifile-action-btn"
                      onClick={() => handleRestoreFromDeletedItems()}
                      title="Restore selected or all deleted items back to their original folders"
                    >
                      <RotateCcw size={11} />
                      <span>Put Back</span>
                    </button>
                    <button
                      type="button"
                      className="mbc-multifile-action-btn danger-action-btn"
                      onClick={() => handleEraseAllDeletedItems()}
                      title="Permanently remove all items in Deleted Items"
                    >
                      <Trash2 size={11} />
                      <span>Erase All</span>
                    </button>
                  </>
                )}
              </div>

              <div className="doc-table-controls">
                <div className="toolbar-dropdown-anchor">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={openMultifileDropdown === 'annotate'}
                    className={`mbc-multifile-action-btn ${
                      openMultifileDropdown === 'annotate' ? 'active' : ''
                    }`}
                    onClick={(e) => toggleMultifileDropdown('annotate', e, 215)}
                  >
                    <span>Annotate &amp; Simulate</span>
                    <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
                  </button>
                  {openMultifileDropdown === 'annotate' && (
                    <CascadingMenuPopup
                      items={multifileMenus.annotate}
                      position={menuPopupPos}
                      minWidth={215}
                      ariaLabel="Annotate and Simulate Menu"
                      onCloseAll={closeAllMenus}
                    />
                  )}
                </div>

                <div className="toolbar-dropdown-anchor">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={openMultifileDropdown === 'manage'}
                    className={`mbc-multifile-action-btn ${
                      openMultifileDropdown === 'manage' ? 'active' : ''
                    }`}
                    onClick={(e) => toggleMultifileDropdown('manage', e, 215)}
                  >
                    <span>Manage files</span>
                    <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" />
                  </button>
                  {openMultifileDropdown === 'manage' && (
                    <CascadingMenuPopup
                      items={multifileMenus.manage}
                      position={menuPopupPos}
                      minWidth={215}
                      ariaLabel="Manage Project Files Menu"
                      onCloseAll={closeAllMenus}
                    />
                  )}
                </div>

                {workspaceSplitMode !== 'top-bottom' && (
                  <button
                    type="button"
                    className="mbc-icon-btn"
                    onClick={() => setWorkspaceSplitMode('top-bottom')}
                    aria-label="Switch to Stacked (Top / Bottom) Split View"
                    title="Switch to Stacked (Top / Bottom) Split View"
                  >
                    <Rows2 size={13} />
                  </button>
                )}
                <DocumentTableToggle expanded={!docTableCollapsed} onToggle={toggleDocumentTableFromPane} />
              </div>
            </div>
            )}

            {!docTableCollapsed && (
              <>
                <WorkbenchTableControlsBar
                  filterOpen={docFilterOpen}
                  activeFilterCount={activeDocFilterCount}
                  onToggleFilter={() => setDocFilterOpen((v) => !v)}
                  summaryLabel={`${selectedInFilteredDocs.length} of ${filteredDocuments.length} selected`}
                  columnsOpen={docColumnsPopoverOpen}
                  onToggleColumns={(rect) => {
                    closeAllMenus();
                    setDocColumnsAnchorRect(rect);
                    setDocColumnsPopoverOpen((v) => !v);
                  }}
                />

                {docFilterOpen && (
                  <WorkbenchFilterPanel
                    columns={availableFolderColumns.filter((c) => c.id !== 'icon')}
                    quickFilter={tableFilter}
                    onQuickFilterChange={setTableFilter}
                    rules={docFilterRules}
                    onRulesChange={setDocFilterRules}
                    matchMode={docFilterMatchMode}
                    onMatchModeChange={setDocFilterMatchMode}
                    placeholder="Filter documents across visible columns..."
                    inputId="mbc-folder-filter-input"
                    extraFields={SEARCH_FIELDS}
                    wholeProject={wholeProjectSearch}
                    onWholeProjectChange={setWholeProjectSearch}
                    savedSearches={savedSearches}
                    onSaveSearch={(name) => {
                      const next = upsertSavedSearch(savedSearches, { name, quickFilter: tableFilter, rules: docFilterRules, matchMode: docFilterMatchMode, wholeProject: wholeProjectSearch });
                      setSavedSearches(next);
                      setStatusBanner(storeSavedSearches(next) ? `Saved search "${name}".` : `Saved search "${name}" for this session (browser storage is unavailable).`);
                    }}
                    onLoadSearch={(id) => {
                      const x = savedSearches.find((q) => q.id === id);
                      if (!x) return;
                      setTableFilter(x.quickFilter);
                      setDocFilterRules(x.rules);
                      setDocFilterMatchMode(x.matchMode);
                      setWholeProjectSearch(x.wholeProject);
                      setStatusBanner(`Running saved search "${x.name}"${x.wholeProject ? ' across the whole project' : ` in ${selectedFolder}`}.`);
                    }}
                    onDeleteSearch={(id) => {
                      const next = savedSearches.filter((q) => q.id !== id);
                      setSavedSearches(next);
                      storeSavedSearches(next);
                    }}
                  />
                )}

                {docColumnsPopoverOpen && (
                  <WorkbenchColumnsPopover
                    anchorRect={docColumnsAnchorRect}
                    columns={availableFolderColumns}
                    visibleColIds={orderedVisibleDocColumns.map((c) => c.id)}
                    lockColumnOrder={lockColumnOrder}
                    statusMessage={docColStatusMsg}
                    onToggleColumn={handleToggleColumnVisibility}
                    onToggleLockColumnOrder={() => setLockColumnOrder((v) => !v)}
                    onLoadColumnState={handleLoadDocColumnState}
                    onSaveColumnState={handleSaveDocColumnState}
                    onClose={() => setDocColumnsPopoverOpen(false)}
                  />
                )}

                <div
                  className="doc-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Project Document Table"
                >
                  <table className="mbc-document-table mbc-customizable-table">
                    <thead>
                      <tr>
                        <th scope="col" className="doc-check-col sticky-check-col">
                          <input
                            type="checkbox"
                            aria-label="Select or deselect all documents in current folder"
                            checked={
                              filteredDocuments.length > 0 &&
                              selectedInFilteredDocs.length === filteredDocuments.length
                            }
                            onChange={() => {
                              const allIds = filteredDocuments.map((d) => d.id);
                              setCheckedDocIds((prev) => {
                                const inFolder = prev.filter((id) => allIds.includes(id));
                                return toggleVisibleSelection(inFolder, allIds);
                              });
                              if (allIds[0] && !allIds.includes(activeDoc.id)) {
                                setActiveDocId(allIds[0]);
                              }
                            }}
                          />
                        </th>
                        {orderedVisibleDocColumns.map((col) => {
                          const isSorted = sortColumn === col.id;
                          const isSortable = col.id !== 'icon';
                          const isIconVisible = orderedVisibleDocColumns.some(
                            (c) => c.id === 'icon'
                          );
                          const isDraggable =
                            !lockColumnOrder && col.id !== 'icon' && col.id !== 'name';
                          const stickyClass =
                            col.id === 'icon'
                              ? 'sticky-icon-col'
                              : col.id === 'name'
                              ? `sticky-name-col ${
                                  isIconVisible
                                    ? 'with-icon-offset'
                                    : 'without-icon-offset'
                                }`
                              : '';

                          return (
                            <th
                              scope="col"
                              key={col.id}
                              draggable={isDraggable}
                              onDragStart={() => {
                                if (isDraggable) setDragDocColId(col.id);
                              }}
                              onDragOver={(e) => {
                                if (isDraggable && dragDocColId && dragDocColId !== col.id) {
                                  e.preventDefault();
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                handleDropDocColumn(col.id);
                              }}
                              onDragEnd={() => setDragDocColId(null)}
                              className={`${stickyClass} ${
                                isSortable ? 'sortable-th' : ''
                              } ${dragDocColId === col.id ? 'mbc-dragging-th' : ''} ${
                                col.align === 'right'
                                  ? 'right-cell'
                                  : col.align === 'center'
                                  ? 'center-cell'
                                  : ''
                              }`.trim()}
                              style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                              aria-sort={
                                isSorted
                                  ? sortDirection === 'asc'
                                    ? 'ascending'
                                    : 'descending'
                                  : 'none'
                              }
                              onClick={
                                isSortable
                                  ? () => handleHeaderColumnSort(col.id)
                                  : undefined
                              }
                              aria-label={col.id === 'favorite' ? 'Favorite' : col.id === 'icon' ? 'Document Type Icon' : undefined}
                              title={
                                isSortable
                                  ? `Sort by ${col.label}${
                                      lockColumnOrder
                                        ? ' (Column order locked)'
                                        : isDraggable
                                        ? ' • Drag header to reorder'
                                        : ''
                                    }`
                                  : col.label
                              }
                            >
                              <span className="th-sort-wrap">
                                <MolBioColumnHeaderIcon colId={col.id} />
                                {col.id !== 'icon' && col.id !== 'favorite' && (
                                  <span>{col.label}</span>
                                )}
                                {isSorted && (
                                  <span className="th-sort-arrow" aria-hidden="true">
                                    <MolBioSortChevron direction={sortDirection} />
                                  </span>
                                )}
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocuments.length === 0 ? (
                        <tr>
                          <td
                            colSpan={orderedVisibleDocColumns.length + 1}
                            className="empty-table-row-msg"
                          >
                            {selectedFolder === 'Deleted Items' ? (
                              <span>Deleted Items is empty.</span>
                            ) : selectedFolder === 'Favorites' ? (
                              <span>
                                No favorite sequences yet — click the star icon on any row to bookmark a sequence.
                              </span>
                            ) : activeDocFilterCount > 0 || globalSearchQuery.trim().length > 0 ? (
                              <span className="mbc-empty-inline-recovery">
                                <span>
                                  No sequences in <strong>{folderLabel(selectedFolder)}</strong> match the current search or filter.
                                </span>
                                <button
                                  type="button"
                                  className="btn-secondary-sm"
                                  onClick={() => {
                                    setTableFilter('');
                                    setDocFilterRules([]);
                                    setGlobalSearchQuery('');
                                  }}
                                >
                                  Clear Search &amp; Filters
                                </button>
                              </span>
                            ) : (
                              <span className="mbc-empty-inline-recovery">
                                <span>
                                  <strong>{folderLabel(selectedFolder)}</strong> has no sequences yet.
                                </span>
                                <button
                                  type="button"
                                  className="btn-secondary-sm"
                                  onClick={() => setNewSeqModalOpen(true)}
                                >
                                  + Create New Sequence
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary-sm"
                                  onClick={() => triggerImportFilesPicker()}
                                >
                                  Import Sequence Files
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredDocuments.map((doc) => {
                          const isChecked = checkedIdsSet.has(doc.id);
                          const isActiveRow = isChecked && doc.id === activeDoc.id;
                          const isFav = favoriteIdsSet.has(doc.id);
                          const metrics = computeDocumentTableMetrics(doc);
                          const isIconVisible = orderedVisibleDocColumns.some(
                            (c) => c.id === 'icon'
                          );

                          return (
                            <tr
                              key={doc.id}
                              className={`${
                                isActiveRow
                                  ? 'selected-row'
                                  : isChecked
                                  ? 'multi-checked-row'
                                  : ''
                              }`}
                              onClick={(ev) => {
                                setRowContextMenu(null);
                                setFolderContextMenu(null);
                                // Selecting rows browses the table: it never folds it.
                                applyDocTableEvent({ kind: 'select-row' });
                                if (ev.metaKey || ev.ctrlKey || ev.shiftKey) {
                                  setCheckedDocIds((prev) => {
                                    const inFolder = prev.filter((id) => docsInSelectedFolder.some((d) => d.id === id));
                                    return inFolder.includes(doc.id)
                                      ? inFolder.filter((id) => id !== doc.id)
                                      : [...inFolder, doc.id];
                                  });
                                  setActiveDocId(doc.id);
                                } else {
                                  selectDocumentWithHistory(doc.id);
                                  if (
                                    doc.chromatogram &&
                                    doc.folder !== 'Contig Assembly' &&
                                    viewerTab === 'sequence-view'
                                  ) {
                                    setViewerTab('sanger-contig');
                                  }
                                }
                              }}
                              onContextMenu={(ev) => {
                                ev.preventDefault();
                                closeAllMenus();
                                selectDocumentWithHistory(doc.id);
                                const pos = computeViewportClampedContextMenuPosition(
                                  ev.clientX,
                                  ev.clientY,
                                  window.innerWidth,
                                  window.innerHeight,
                                  260,
                                  420
                                );
                                setRowContextMenu({ docId: doc.id, pos });
                              }}
                            >
                              <td
                                className="center-cell doc-check-col sticky-check-col"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${doc.name}`}
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const nextChecked = e.target.checked;
                                    setCheckedDocIds((prev) => {
                                      const inFolder = prev.filter((id) => docsInSelectedFolder.some((d) => d.id === id));
                                      return nextChecked
                                        ? Array.from(new Set([...inFolder, doc.id]))
                                        : inFolder.filter((id) => id !== doc.id);
                                    });
                                    if (nextChecked) {
                                      setActiveDocId(doc.id);
                                    }
                                  }}
                                />
                              </td>

                              {orderedVisibleDocColumns.map((col) => {
                                if (col.id === 'name') {
                                  return (
                                    <th
                                      scope="row"
                                      key={col.id}
                                      className={`doc-name-cell sticky-name-col ${
                                        isIconVisible
                                          ? 'with-icon-offset'
                                          : 'without-icon-offset'
                                      }`}
                                    >
                                      {editingCell?.docId === doc.id && editingCell.col === 'name' ? renderCellEditor(doc) : (
                                        <span onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ docId: doc.id, col: 'name', draft: doc.name }); }} title="Double-click to rename">
                                          {doc.name}
                                        </span>
                                      )}
                                      {readDocIds.includes(doc.id) && <span className="document-read-marker" aria-label="Read" title="Read"> · Read</span>}
                                    </th>
                                  );
                                }

                                if (col.id === 'icon') {
                                  const iconKind = inferDocumentIconKind(doc);
                                  return (
                                    <td
                                      key={col.id}
                                      className="center-cell sticky-icon-col"
                                      title={`${metrics.docTypeLabel} (${
                                        doc.topology === 'circular' ? 'Circular' : 'Linear'
                                      })`}
                                    >
                                      <SequenceDocKindIcon
                                        kind={iconKind}
                                        doc={doc}
                                        title={`${metrics.docTypeLabel} (${
                                          doc.topology === 'circular' ? 'Circular' : 'Linear'
                                        })`}
                                      />
                                    </td>
                                  );
                                }

                                if (col.id === 'favorite') {
                                  return (
                                    <td
                                      key={col.id}
                                      className="center-cell"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        className={`fav-star-btn ${isFav ? 'active' : ''}`}
                                        aria-label={
                                          isFav
                                            ? `Remove ${doc.name} from Favorites`
                                            : `Add ${doc.name} to Favorites`
                                        }
                                        title={
                                          isFav
                                            ? 'Remove from Favorites'
                                            : 'Add to Favorites'
                                        }
                                        onClick={() => handleToggleFavoriteDocs(doc.id)}
                                      >
                                        <MolBioStarIcon active={isFav} size={14} />
                                      </button>
                                    </td>
                                  );
                                }

                                if (col.id === 'status') {
                                  // A record whose checks did not all run is neutral, never OK (BG-01M6S1B3).
                                  const verdict = recordCheckVerdict(metrics);
                                  return (
                                    <td
                                      key={col.id}
                                      className={`center-cell ${
                                        verdict === 'clear'
                                          ? 'ok-status-cell'
                                          : verdict === 'alerts'
                                          ? 'warn-status-cell'
                                          : ''
                                      }`}
                                      title={metrics.alertsSummary}
                                    >
                                      <RecordStatusIcon verdict={verdict} size={14} />
                                    </td>
                                  );
                                }

                                if (col.id === 'description') {
                                  return (
                                    <td
                                      key={col.id}
                                      className="desc-cell"
                                      title={`${doc.description}${doc.description ? '\n' : ''}(double-click to edit)`}
                                      onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ docId: doc.id, col: 'description', draft: doc.description }); }}
                                    >
                                      {editingCell?.docId === doc.id && editingCell.col === 'description' ? renderCellEditor(doc) : (doc.description || '-')}
                                    </td>
                                  );
                                }

                                const cellVal = getDocumentColumnDisplayValue(
                                  doc,
                                  metrics,
                                  col.id,
                                  isFav
                                );
                                const isMono =
                                  col.id === 'accession' ||
                                  col.id === 'modified' ||
                                  col.id === 'created' ||
                                  col.id === 'firstResidues' ||
                                  col.id === 'gid' ||
                                  col.id === 'urn' ||
                                  col.id === 'pdbName';

                                return (
                                  <td
                                    key={col.id}
                                    className={`${
                                      col.align === 'right'
                                        ? 'right-cell'
                                        : col.align === 'center'
                                        ? 'center-cell'
                                        : ''
                                    } ${isMono ? 'mono-cell' : ''}`.trim()}
                                  >
                                    <MolBioAttributeCellValue
                                      colId={col.id}
                                      rawValue={cellVal}
                                      doc={doc}
                                      metrics={metrics}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
          );

          const docTableResizer = !docTableCollapsed && (
            <div
              role="separator"
              aria-label={
                workspaceSplitMode === 'top-bottom'
                  ? 'Resize Project Document Table height'
                  : 'Resize Project Document Table width'
              }
              aria-orientation={
                workspaceSplitMode === 'top-bottom' ? 'horizontal' : 'vertical'
              }
              aria-valuenow={
                workspaceSplitMode === 'top-bottom'
                  ? docTableHeightPx
                  : docTableWidthPx
              }
              aria-valuemin={workspaceSplitMode === 'top-bottom' ? 115 : 270}
              aria-valuemax={workspaceSplitMode === 'top-bottom' ? 460 : 680}
              tabIndex={0}
              className={`mbc-workspace-pane-resizer ${
                workspaceSplitMode === 'top-bottom'
                  ? 'is-horizontal'
                  : 'is-vertical'
              } ${workspacePaneDragging ? 'dragging' : ''}`}
              title="Drag or use Arrow keys to resize Table / Viewer split • Double-click to reset"
              onDoubleClick={() => {
                if (workspaceSplitMode === 'top-bottom') {
                  setDocTableHeightPx(175);
                } else {
                  setDocTableWidthPx(410);
                }
              }}
              onPointerDown={(e) => {
                if (workspacePaneDragRef.current.active) return;
                e.preventDefault();
                workspacePaneDragRef.current = {
                  active: true,
                  pointerId: e.pointerId,
                  mode: workspaceSplitMode,
                  startPos:
                    workspaceSplitMode === 'top-bottom' ? e.clientY : e.clientX,
                  startSize:
                    workspaceSplitMode === 'top-bottom'
                      ? docTableHeightPx
                      : docTableWidthPx,
                };
                setWorkspacePaneDragging(true);
              }}
              onKeyDown={(e) => {
                if (workspaceSplitMode === 'top-bottom') {
                  // The handle moves the way the arrow points; the table is below it, so Up grows it.
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setDocTableHeightPx((h) => Math.min(460, h + 16));
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setDocTableHeightPx((h) => Math.max(115, h - 16));
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    setDocTableHeightPx(175);
                  }
                } else {
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setDocTableWidthPx((w) => Math.max(270, w - 20));
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    setDocTableWidthPx((w) => Math.min(680, w + 20));
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    setDocTableWidthPx(410);
                  }
                }
              }}
            />
          );

          return (
          <>
          {!docTableBelowViewer && docTablePane}
          {!docTableBelowViewer && docTableResizer}

          {/* Document Viewer + Right-Hand Control Panel: above the expanded table in the stacked layout, right of it side by side */}
          <section className="mbc-viewer-shell">
            {/* The vector catalog works without a document (blank session). */}
            {!checkedIdsSet.has(activeDocId) && !(viewerTab === 'vector-library' && !activeDoc.id) ? (
              <div className="empty-doc-selection-dropzone">
                <FileSpreadsheet size={28} className="empty-dropzone-icon" />
                <h3>
                  {filteredDocuments.length === 0
                    ? 'No Sequences in Current Folder'
                    : 'No Sequence Selected for Inspection'}
                </h3>
                <p>
                  {filteredDocuments.length === 0 ? (
                    <>
                      Import sequence files (<code>.gb</code>, <code>.fasta</code>,{' '}
                      <code>.ab1</code>, <code>.mbc</code>) or create a new
                      construct to begin analysis.
                    </>
                  ) : (
                    <>
                      Select a sequence in {docTableWhere} to inspect its map, sequence, and
                      analysis studios, or drag and drop files anywhere onto this workspace to
                      import.
                    </>
                  )}
                </p>
                <div className="empty-dropzone-actions">
                  {filteredDocuments.length > 0 && (
                    <button
                      type="button"
                      className="mbc-btn primary"
                      onClick={() => selectDocumentWithHistory(filteredDocuments[0].id)}
                    >
                      Inspect {filteredDocuments[0].name}
                    </button>
                  )}
                  <button
                    type="button"
                    className="mbc-btn"
                    onClick={() => triggerImportFilesPicker()}
                  >
                    Import Sequence Files
                  </button>
                  <button
                    type="button"
                    className="mbc-btn"
                    onClick={() => setNewSeqModalOpen(true)}
                  >
                    Create New Sequence
                  </button>
                </div>
              </div>
            ) : (
            <>
            {/* Viewer Top Control Bar (View Tabs + Zoom + Layout Switcher) */}
            <div className="mbc-viewer-header">
              <ScrollableMenuStrip
                className="mbc-scroll-strip--header-tabs"
                trackClassName="mbc-viewer-tabs"
                role="tablist"
                ariaLabel="Analysis and Visualization Views"
                activeKey={viewerTab}
                enableSpatialArrowNav
                activateOnSpatialFocus
                canStepPrev={visibleViewerTabs.indexOf(viewerTab) > 0}
                canStepNext={
                  visibleViewerTabs.indexOf(viewerTab) < visibleViewerTabs.length - 1
                }
                onStepPrev={() => {
                  const curIdx = visibleViewerTabs.indexOf(viewerTab);
                  if (curIdx > 0) {
                    setViewerTab(visibleViewerTabs[curIdx - 1]);
                  }
                }}
                onStepNext={() => {
                  const curIdx = visibleViewerTabs.indexOf(viewerTab);
                  if (curIdx >= 0 && curIdx < visibleViewerTabs.length - 1) {
                    setViewerTab(visibleViewerTabs[curIdx + 1]);
                  }
                }}
                prevAriaLabel="Slide studio menus left"
                nextAriaLabel="Slide studio menus right"
              >
                {visibleViewerTabs.map((tab, idx) => {
                  const tabGroups: Record<ViewerTab, string> = {
                    'sequence-view': 'construct',
                    'annotations-table': 'construct',
                    'text-view': 'construct',
                    'vector-library': 'wetlab',
                    'cloning-gel': 'wetlab',
                    'primers-pcr': 'wetlab',
                    'sequence-alignment': 'comparative',
                    'phylogenetics': 'comparative',
                    'sanger-contig': 'comparative',
                    'genomics-ngs': 'comparative',
                    'history-hybrid': 'audit',
                    'guided-pipelines': 'audit',
                    'document-info': 'audit',
                  };
                  const prevGroup = idx > 0 ? tabGroups[visibleViewerTabs[idx - 1]] : tabGroups[tab];
                  const showGroupDivider = idx > 0 && prevGroup !== tabGroups[tab];
                  return (
                    <React.Fragment key={tab}>
                      {showGroupDivider && (
                        <span className="mbc-vtab-group-divider" aria-hidden="true" />
                      )}
                      <button type="button" role="tab" data-view={tab}
                        tabIndex={viewerTab === tab ? 0 : -1} aria-selected={viewerTab === tab}
                        className={`mbc-vtab ${viewerTab === tab ? 'active' : ''}`}
                        onClick={() => tab === 'history-hybrid'
                          ? openHybridSubTab(activeDoc.docMetadata?.['Document Type'] === 'Enzyme Set' ? 'enzymes-view' : 'lineage')
                          : setViewerTab(tab)}>
                        {tab === 'document-info' ? <FileSpreadsheet size={13} /> : <MolBioViewerTabIcon tabId={tab} />}
                        <span>{viewerTabLabels[tab]}</span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </ScrollableMenuStrip>

              <button
                type="button"
                className={`mbc-zoom-btn mbc-split-toggle ${splitDocId !== null ? 'active' : ''}`}
                aria-pressed={splitDocId !== null}
                aria-label="Split view: show another document side by side"
                title={splitDocId !== null ? 'Close split view' : 'Split view: show another document side by side'}
                onClick={() => setSplitDocId((cur) => (cur !== null ? null : openDocs.find((d) => d.id !== activeDoc.id)?.id ?? ''))}
              >
                <Columns2 size={13} />
              </button>

              {/* The Sequence tab's zoom, then the inspector button on any tab with settings (alone off the Sequence tab). */}
              {(viewerTab === 'sequence-view' || inspectorAvailable) && (
                <div className="mbc-viewer-zoom-controls">
                  {viewerTab === 'sequence-view' && (<>
                  {selectedRange && (
                    <span
                      className="mbc-selection-readout"
                      title={`Selected: ${selectedRange.start}..${selectedRange.end} (${
                        selectedRange.end - selectedRange.start + 1
                      } ${activeDoc.moleculeType === 'Protein' ? 'aa' : activeDoc.moleculeType === 'RNA' ? 'nt' : 'bp'})${selectedRange.label ? ` [${selectedRange.label}]` : ''}`}
                    >
                      {selectedRange.start}..{selectedRange.end} (
                      {selectedRange.end - selectedRange.start + 1} {activeDoc.moleculeType === 'Protein' ? 'aa' : activeDoc.moleculeType === 'RNA' ? 'nt' : 'bp'})
                      {selectedRange.label ? ` • ${selectedRange.label}` : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    className="mbc-zoom-btn"
                    onClick={() => setZoomLevel((z) => stepSequenceZoom(z, -1))}
                    disabled={!circularMapShown}
                    aria-label="Zoom Out"
                    aria-keyshortcuts={circularMapShown ? ariaSc('-') : undefined}
                    title={circularMapShown ? `Zoom Out (${sc('-')})` : CIRCULAR_ONLY_HINT}
                  >
                    <ZoomOut size={13} />
                  </button>
                  <button
                    type="button"
                    className="mbc-zoom-btn zoom-pct-btn"
                    onClick={restoreSequenceView}
                    disabled={!circularMapShown}
                    aria-keyshortcuts={circularMapShown ? ariaSc('0') : undefined}
                    title={circularMapShown ? `Reset Zoom to 100% (${sc('0')})` : CIRCULAR_ONLY_HINT}
                  >
                    {zoomLevel}%
                  </button>
                  <button
                    type="button"
                    className="mbc-zoom-btn"
                    onClick={() => setZoomLevel((z) => stepSequenceZoom(z, 1))}
                    disabled={!circularMapShown}
                    aria-label="Zoom In"
                    aria-keyshortcuts={circularMapShown ? ariaSc('=') : undefined}
                    title={circularMapShown ? `Zoom In (${sc('=')})` : CIRCULAR_ONLY_HINT}
                  >
                    <ZoomIn size={13} />
                  </button>
                  </>)}
                  {inspectorAvailable && (
                  <button
                    type="button"
                    className={`mbc-zoom-btn ${inspectorVisible ? 'active' : ''}`}
                    onClick={handleToggleInspector}
                    aria-label={`${inspectorVisible ? 'Hide' : 'Show'} ${inspectorTitle} Inspector`}
                    aria-keyshortcuts={ariaSc('I', { alt: true })}
                    title={`${
                      inspectorVisible ? 'Hide' : 'Show'
                    } ${inspectorTitle} Inspector (${sc('I', { alt: true })})`}
                  >
                    <PanelRight size={13} />
                  </button>
                  )}
                </div>
              )}
            </div>

            {/* Viewer Body + Right-Hand Accordion Sidebar */}
            <div
              className={`mbc-viewer-body-split ${inspectorColumnShown ? '' : 'inspector-hidden'}`}
              style={
                { '--mbc-inspector-width': `${inspectorWidthPx}px` } as React.CSSProperties
              }
            >
              <div className={`mbc-split-host ${splitDocId !== null ? 'is-split' : ''}`}>
              <div
                ref={viewerCanvasRef}
                className={`mbc-viewer-canvas ${
                  viewerTab === 'sequence-view' ? 'is-sequence-view' : ''
                }`}
              >
                <ErrorBoundary label={VIEWER_TAB_LABELS[viewerTab] ?? 'This view'} resetKey={`${activeDoc.id}:${viewerTab}`}>
                {/* The main view's studios reach the inspector; the split view's pane and the header stay outside. */}
                <WorkbenchInspectorProvider open={rightPanelOpen} column={inspectorColumn} onClaimsChange={handleInspectorClaims}>
                {viewerTab === 'sequence-view' && isContigSummaryRecord(activeDoc) && (
                  <ContigSummaryView
                    doc={activeDoc}
                    onUpdateDocument={handleUpdateDocument}
                    onStatusNotice={setStatusBanner}
                  />
                )}
                {viewerTab === 'sequence-view' && !isContigSummaryRecord(activeDoc) && (
                  <>
                    <ConstructCockpitBar
                      doc={activeDoc}
                      cutSites={cockpitCutSites}
                      siteCounts={restrictionSiteCounts}
                      selectedRange={selectedRange}
                      onSelectRange={setSelectedRange}
                      onJumpToStudio={(studioId) => setViewerTab(studioId)}
                      onExtractSelection={handleExtractSelectedRegion}
                      colorblindSafe={colorScheme === 'colorblind-safe'}
                    />
                    <div className={`map-seq-grid mode-${effectiveMapLayoutMode}`}>
                      {(effectiveMapLayoutMode === 'split' || effectiveMapLayoutMode === 'circular') && (
                        <CircularPlasmidMap
                          doc={activeDoc}
                          cutSites={cutSites}
                          siteCounts={restrictionSiteCounts}
                          orfs={orfs}
                          selectedRange={selectedRange}
                          onSelectRange={setSelectedRange}
                          showOrfs={showOrfs}
                          orfScope={orfScope}
                          showPrimers={showPrimers}
                          showUniqueCuttersOnly={showUniqueCuttersOnly}
                          restrictionScope={restrictionScope}
                          zoomLevel={zoomLevel}
                          onZoomChange={setZoomLevel}
                          viewRestoreKey={sequenceViewRestores}
                        />
                      )}
                      {(effectiveMapLayoutMode === 'split' || effectiveMapLayoutMode === 'linear') && (
                        <LinearSequenceView
                          doc={activeDoc}
                          cutSites={cutSites}
                          restrictionScope={restrictionScope}
                          selectedRange={selectedRange}
                          onSelectRange={setSelectedRange}
                          onUpdateDocument={handleUpdateDocument}
                          showTranslation={showTranslation}
                          showGcGraph={showGcGraph}
                          showHydropathyGraph={showHydropathyGraph}
                          colorScheme={colorScheme}
                          onLoadBenchmarkDocument={handleLoadBenchmarkDocument}
                          onClearSelection={() => setSelectedRange(null)}
                          onExtractSelection={handleExtractSelectedRegion}
                          onConvertSelectionToOligo={handleConvertSelectionToOligo}
                          onStatusNotice={setStatusBanner}
                        />
                      )}
                    </div>
                  </>
                )}

                {viewerTab === 'annotations-table' && (
                  <div className="mbc-annotations-sheet">
                    <div className="studio-card-header" style={{ marginBottom: 10 }}>
                      <h3>
                        Annotations — {activeDoc.name}
                      </h3>
                      <div className="cloning-action-row">
                        <span className="badge-accent">
                          {activeDoc.features.length} Features • {activeDoc.primers.length} Primers •{' '}
                          {orfs.length} ORFs{orfScopeWords ? ` ${orfScopeWords}` : ''}
                        </span>
                        <button
                          className="btn-secondary-sm"
                          onClick={() =>
                            handleExportActiveDocument('gff3')
                          }
                        >
                          Export Annotations (.gff3)
                        </button>
                      </div>
                    </div>
                    <WorkbenchSmartTable
                      tableId="sequence-annotations-table"
                      tableLabel="Sequence Annotations Table"
                      className="mbc-document-table"
                    >
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Direction</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Length ({sequenceUnit})</th>
                          <th>Notes / Qualifiers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDoc.features.map((f) => {
                          const gStart = Number(f.qualifiers?.genomic_start) || f.start;
                          const gEnd = Number(f.qualifiers?.genomic_end) || f.end;
                          const gLen = Number(f.qualifiers?.genomic_length) || gEnd - gStart + 1;
                          return (
                            <tr
                              key={f.id}
                              onClick={() => {
                                setSelectedRange({
                                  start: f.start,
                                  end: f.end,
                                  label: `${f.name} (${f.qualifiers?.raw_type || f.type})`,
                                });
                                setViewerTab('sequence-view');
                              }}
                            >
                              <td>
                                <span
                                  className="feat-color-dot"
                                  style={{
                                    backgroundColor: f.color,
                                    display: 'inline-block',
                                    marginRight: 6,
                                  }}
                                />
                                <strong>{f.name}</strong>
                              </td>
                              <td>
                                <MolBioFeatureTypeBadge featureType={f.type} />
                              </td>
                              <td>
                                <MolBioStrandBadge strand={f.strand} />
                              </td>
                              <td>{gStart.toLocaleString()}</td>
                              <td>{gEnd.toLocaleString()}</td>
                              <td>{gLen.toLocaleString()}</td>
                              <td>{f.notes || '—'}</td>
                            </tr>
                          );
                        })}
                        {activeDoc.primers.map((p) => (
                          <tr
                            key={p.id}
                            onClick={() => {
                              setSelectedRange({
                                start: p.bindStart,
                                end: p.bindEnd,
                                label: `Primer ${p.name}`,
                              });
                              setViewerTab('sequence-view');
                            }}
                          >
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td>
                              <MolBioFeatureTypeBadge featureType="primer_bind" />
                            </td>
                            <td>
                              <MolBioStrandBadge strand={p.strand} />
                            </td>
                            <td>{p.bindStart}</td>
                            <td>{p.bindEnd}</td>
                            <td>{p.length}</td>
                            <td>
                              5&apos;-{p.sequence}-3&apos; ({primerTmText(p)})
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </WorkbenchSmartTable>
                  </div>
                )}

                {viewerTab === 'document-info' && <DocumentInfoPanel key={activeDoc.id} doc={activeDoc} onUpdateDocument={handleUpdateDocument} />}

                {viewerTab === 'text-view' && (
                  <div className="mbc-text-view-pane">
                    {activeDoc.docMetadata?.['Document Type'] === 'Text Document' ? (<>
                      <ExpressionResultsView key={`expr-${activeDoc.id}`} doc={activeDoc} onDownload={(content, name, mime) => void handleDownloadFile(content, name, mime)} />
                      <FragmentTraceView key={`fsa-${activeDoc.id}`} doc={activeDoc} />
                      <DocumentNotesEditor key={activeDoc.id} doc={activeDoc} onUpdateDocument={handleUpdateDocument} />
                    </>
                    ) : originalText ? <>
                      <div className="mbc-text-toolbar"><strong>{originalText.label}</strong>
                        <button className="mbc-btn" disabled={!originalText.text} onClick={() =>
                          handleDownloadFile(originalText.text, `${activeDoc.name}.${originalText.extension}`)}>Download source</button>
                      </div>
                      <pre className="mbc-flatfile-pre">{originalText.text || 'No source text is stored in this record.'}</pre>
                    </> : (activeDoc.alignmentMeta?.sequences?.length ?? 0) > 0 ? (
                      // An alignment's text is its members (Clustal, FASTA, PHYLIP, NEXUS, ...), not one record.
                      <React.Suspense fallback={<div className="mbc-studio-loading-state" role="status">Loading alignment text…</div>}>
                        <AlignmentTextStream key={activeDoc.id} doc={activeDoc} />
                      </React.Suspense>
                    ) : <>
                    {/* US-01M6TAZ7: the record format is the Flatfile tab's setting, so it is a section of
                        App's inspector ("Flatfile Controls"); the toolbar names the format shown and keeps Download. */}
                    <InspectorSection title="Record Format" order={1}>
                      <div className="mbc-control-row" role="group" aria-label="Flatfile record format">
                        <button
                          type="button"
                          aria-pressed={textFormat === 'genbank'}
                          className={`method-tab-btn ${textFormat === 'genbank' ? 'active' : ''}`}
                          onClick={() => setTextFormat('genbank')}
                        >
                          GenBank (.gb)
                        </button>
                        <button
                          type="button"
                          aria-pressed={textFormat === 'fasta'}
                          className={`method-tab-btn ${textFormat === 'fasta' ? 'active' : ''}`}
                          onClick={() => setTextFormat('fasta')}
                        >
                          FASTA (.fasta)
                        </button>
                        <button
                          type="button"
                          aria-pressed={textFormat === 'embl'}
                          className={`method-tab-btn ${textFormat === 'embl' ? 'active' : ''}`}
                          onClick={() => setTextFormat('embl')}
                        >
                          EMBL-EBI (.embl)
                        </button>
                        <button
                          type="button"
                          aria-pressed={textFormat === 'gff3'}
                          className={`method-tab-btn ${textFormat === 'gff3' ? 'active' : ''}`}
                          onClick={() => setTextFormat('gff3')}
                        >
                          GFF3 Annotations (.gff3)
                        </button>
                      </div>
                    </InspectorSection>
                    <div className="mbc-text-toolbar">
                      <strong>Flatfile Record Format:</strong>
                      <span>{FLATFILE_FORMAT_NAMES[textFormat]}</span>
                      <button
                        className="btn-primary-sm"
                        onClick={() =>
                          handleDownloadFile(
                            flatfileText,
                            `${activeDoc.name}.${textFormat === 'genbank' ? 'gb' : textFormat}`
                          )
                        }
                      >
                        Download .{textFormat === 'genbank' ? 'gb' : textFormat}
                      </button>
                    </div>
                    <pre className="mbc-flatfile-pre">{flatfileText}</pre>
                    </>}
                  </div>
                )}

                <React.Suspense
                  fallback={
                    <div className="mbc-studio-loading-state" role="status">
                      {viewerTab === 'cloning-gel'
                        ? 'Loading Cloning & Virtual Gel Studio…'
                        : viewerTab === 'primers-pcr'
                        ? 'Loading Primers & CRISPR Studio…'
                        : viewerTab === 'sequence-alignment'
                        ? 'Loading Sequence Alignment Studio…'
                        : viewerTab === 'phylogenetics'
                        ? 'Loading Phylogenetics Studio…'
                        : viewerTab === 'sanger-contig'
                        ? 'Loading Chromatogram & Contig Studio…'
                        : viewerTab === 'genomics-ngs'
                        ? 'Loading Genomics & 3D Structure Studio…'
                        : viewerTab === 'vector-library'
                        ? 'Loading Vector Library & Architect…'
                        : viewerTab === 'guided-pipelines'
                        ? 'Loading Guided Workflows Studio…'
                        : 'Loading Analysis Studio…'}
                    </div>
                  }
                >
                  {viewerTab === 'cloning-gel' && (
                    <CloningAndGelStudio
                      documents={documents}
                      activeDoc={activeDoc}
                      onAddConstruct={handleAddConstruct}
                      initialMethod={cloningInitialMethod}
                      initialSubTool={cloningInitialSubTool}
                      commandNonce={studioCommandNonce}
                      onStatusNotice={setStatusBanner}
                      onJumpToCoordinate={(start, end, label) => {
                        setSelectedRange({ start, end, label });
                        setViewerTab('sequence-view');
                        setStatusBanner(
                          `Jumped to ${label ? `${label} ` : ''}(${start.toLocaleString()}..${end.toLocaleString()} bp)`
                        );
                      }}
                    />
                  )}

                  {viewerTab === 'primers-pcr' && (
                    <PrimerAndPCRStudio
                      doc={activeDoc}
                      initialSubTab={primersInitialSubTab}
                      commandNonce={studioCommandNonce}
                      allDocuments={documents}
                      onUpdateDocument={handleUpdateDocument}
                      onAddConstruct={handleAddConstruct}
                      onStatusNotice={setStatusBanner}
                      onJumpToCoordinate={(start, end, label) => {
                        setSelectedRange({ start, end, label });
                        setViewerTab('sequence-view');
                        setStatusBanner(
                          `Jumped to ${label ? `${label} ` : ''}(${start.toLocaleString()}..${end.toLocaleString()} bp)`
                        );
                      }}
                    />
                  )}

                  {viewerTab === 'sequence-alignment' && (
                    phylogenyInputs.length < 2 && !activeDoc.alignmentMeta?.sequences?.length ? (
                      <div className="mbc-studio-loading-state" role="status">
                        <span>
                          Select at least two {activeDoc.moleculeType} sequences in {docTableWhere} to align them, or open a record with stored alignment members.
                        </span>
                        {(() => {
                          const compatibleInFolder = filteredDocuments.filter(
                            (d) => d.moleculeType === activeDoc.moleculeType && d.sequence.length > 0 && d.sequence.length <= MSA_MAX_RESIDUES
                          );
                          if (compatibleInFolder.length < 2) return null;
                          return (
                            <button
                              type="button"
                              className="btn-secondary-sm"
                              style={{ marginLeft: 10 }}
                              onClick={() => {
                                // A long active record (> MSA_MAX_RESIDUES) is not part of the selection;
                                // leaving it active while unchecked blanked the viewer, so make
                                // the first selected sequence active instead and say why.
                                const activeIncluded = compatibleInFolder.some((d) => d.id === activeDoc.id);
                                if (!activeIncluded) selectDocumentWithHistory(compatibleInFolder[0].id, true);
                                setCheckedDocIds(compatibleInFolder.map((d) => d.id));
                                setViewerTab('sequence-alignment');
                                setStatusBanner(
                                  `Selected ${compatibleInFolder.length} ${activeDoc.moleculeType} sequences for alignment${
                                    activeIncluded ? '' : ` ("${activeDoc.name}" is longer than ${MSA_MAX_RESIDUES.toLocaleString()} and was left out)`
                                  }`
                                );
                              }}
                            >
                              Select {compatibleInFolder.length} {activeDoc.moleculeType} Sequences in Folder
                            </button>
                          );
                        })()}
                      </div>
                    ) : <SequenceAlignmentStudio
                      key={activeDoc.id}
                      documents={phylogenyInputs.length ? phylogenyInputs : [activeDoc]}
                      projectDocuments={documents}
                      activeDoc={activeDoc}
                      initialSubMode={alignInitialSubMode}
                      initialMsaAlgorithm={alignInitialMsaAlgo}
                      initialPairwiseAlgorithm={alignInitialPairwiseAlgo}
                      commandNonce={alignCommandNonce}
                      onGenerateConsensus={handleGenerateConsensusFromSelected}
                      onUpdateDocument={handleUpdateDocument}
                    />
                  )}

                  {viewerTab === 'phylogenetics' && (
                    activeDoc.docMetadata?.Newick ? (
                      <ImportedTreeViewer
                        key={activeDoc.id}
                        doc={activeDoc}
                        onUpdateDocument={(d) => handleUpdateDocument(d, 'Edit Tree')}
                        onDownload={(content, name, mime) => void handleDownloadFile(content, name, mime)}
                        onDownloadBinary={(bytes, name, mime) => void handleDownloadBinaryFile(bytes, name, mime)}
                      />
                    ) :
                    phylogenyInputs.length < 2 ? (
                      <div className="mbc-studio-loading-state" role="status">
                        <span>
                          This record has no stored tree topology or source alignment. Import a Newick/NEXUS tree,
                          or select at least two {activeDoc.moleculeType} sequences in {docTableWhere} to build a tree.
                        </span>
                        {(() => {
                          const compatibleInFolder = filteredDocuments.filter(
                            (d) => d.moleculeType === activeDoc.moleculeType && d.sequence.length > 0
                          );
                          if (compatibleInFolder.length < 2) return null;
                          return (
                            <button
                              type="button"
                              className="btn-secondary-sm"
                              style={{ marginLeft: 10 }}
                              onClick={() => {
                                setCheckedDocIds(compatibleInFolder.map((d) => d.id));
                                setStatusBanner(
                                  `Selected ${compatibleInFolder.length} ${activeDoc.moleculeType} sequences for phylogenetic tree reconstruction`
                                );
                              }}
                            >
                              Select {compatibleInFolder.length} {activeDoc.moleculeType} Sequences in Folder
                            </button>
                          );
                        })()}
                      </div>
                    ) : <PhylogeneticsStudio
                      documents={phylogenyInputs}
                      activeDoc={activeDoc}
                      initialPhyloTab={phyloInitialTab}
                      initialTreeAlgorithm={phyloInitialTreeAlgo}
                      initialModelsSubView={phyloInitialModelsView}
                      initialAncestralMethod={phyloInitialAncestralMethod}
                      commandNonce={phyloCommandNonce}
                    />
                  )}

                  {viewerTab === 'sanger-contig' && (
                    <ChromatogramAndContigStudio
                      key={activeDoc.id}
                      activeDoc={activeDoc}
                      selectedDocuments={selectedAnalysisDocuments}
                      documents={catalogNonDeletedDocs}
                      onCreateDocument={(newDoc) => {
                        handleAddConstruct(newDoc);
                        setStatusBanner(
                          `Added "${newDoc.name}" (${newDoc.sequence.length.toLocaleString()} bp) to workspace`
                        );
                      }}
                    />
                  )}

                  {viewerTab === 'genomics-ngs' && (
                    <GenomicsNgsAndPredictionStudio
                      activeDoc={activeDoc}
                      documents={genomicsCandidateDocs}
                      proteinDocuments={genomicsProteinDocs}
                      selectedDocuments={selectedAnalysisDocuments}
                      selectedRange={selectedRange}
                      initialSubTab={genomicsInitialSubTab}
                      commandNonce={studioCommandNonce}
                      onCreateDocument={(newDoc) => {
                        handleAddConstruct(newDoc);
                        setStatusBanner(
                          `Added "${newDoc.name}" (${newDoc.sequence.length.toLocaleString()} bp) to workspace`
                        );
                      }}
                      onUpdateActiveSequence={(newSeq, summary) => {
                        handleUpdateDocument(
                          {
                            ...activeDoc,
                            sequence: newSeq,
                            updatedAt: new Date().toISOString(),
                            history: [
                              ...activeDoc.history,
                              {
                                id: `h-gen-${Date.now()}`,
                                timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
                                operation: 'Sequence Transformation',
                                description: summary,
                                parentIds: [activeDoc.id],
                                lengthBp: newSeq.length,
                                topology: activeDoc.topology,
                              },
                            ],
                          },
                          'Sequence Transformation'
                        );
                        setStatusBanner(summary);
                      }}
                      onAppendFeaturesToDocument={(docId, newFeatures, summary) => {
                        const target = documents.find((d) => d.id === docId);
                        if (!target) {
                          setStatusBanner('The reference document is no longer in this session.');
                          return;
                        }
                        const existingIds = new Set(target.features.map((f) => f.id));
                        const deduped = newFeatures.filter(
                          (f) => !existingIds.has(f.id) && f.start >= 1 && f.end <= target.sequence.length
                        );
                        handleUpdateDocument(
                          { ...target, features: [...target.features, ...deduped], updatedAt: new Date().toISOString() },
                          'Append Annotations'
                        );
                        setStatusBanner(summary);
                      }}
                      onComplementOnlyActiveDoc={() => handleComplementOnlyActiveDoc()}
                      onReverseOnlyActiveDoc={() => handleReverseOnlyActiveDoc()}
                      onAppendFeatures={(newFeatures, summary) => {
                        const existingIds = new Set(activeDoc.features.map((f) => f.id));
                        const deduped = newFeatures.filter((f) => !existingIds.has(f.id));
                        handleUpdateDocument(
                          {
                            ...activeDoc,
                            features: [...activeDoc.features, ...deduped],
                            updatedAt: new Date().toISOString(),
                          },
                          'Append Annotations'
                        );
                        setStatusBanner(summary);
                      }}
                      onStatusBanner={(msg) => setStatusBanner(msg)}
                    />
                  )}

                  {viewerTab === 'vector-library' && (
                    <VectorLibraryAndDesignStudio
                      activeDoc={activeDoc}
                      documents={documents}
                      initialSubTab={vectorStudioTab}
                      commandNonce={studioCommandNonce}
                      onAddDocument={(newDoc) => {
                        handleAddConstruct(newDoc);
                        setStatusBanner(`Loaded "${newDoc.name}" (${newDoc.sequence.length.toLocaleString()} bp) into workspace`);
                      }}
                      onInsertPartIntoActiveDoc={handleInsertModularPart}
                      onStatusNotice={setStatusBanner}
                      onJumpToCoordinate={(start, end, label, docId) => {
                        if (docId && docId !== activeDoc.id) {
                          selectDocumentWithHistory(docId);
                        }
                        setSelectedRange({ start, end, label });
                        setViewerTab('sequence-view');
                        setStatusBanner(
                          `Jumped to ${label ? `${label} ` : ''}(${start.toLocaleString()}..${end.toLocaleString()} bp)`
                        );
                      }}
                    />
                  )}

                  {viewerTab === 'history-hybrid' && (
                    <HybridToolsAndHistoryStudio
                      doc={activeDoc}
                      allDocuments={documents}
                      onUpdateDocument={handleUpdateDocument}
                      initialSubTab={hybridInitialSubTab}
                      initialPluginId={hybridInitialPluginId}
                      commandNonce={studioCommandNonce}
                      onSelectDocument={(docId) => selectDocumentWithHistory(docId)}
                    />
                  )}

                  {viewerTab === 'guided-pipelines' && (
                    <WorkflowPipelineStudio
                      activeDoc={activeDoc}
                      allDocuments={documents}
                      hostOs={displayOs}
                      onChangePreviewOs={(os) => setPreviewOsOverride(os)}
                      onSelectDocument={(docId) => selectDocumentWithHistory(docId)}
                      onSelectRange={setSelectedRange}
                      onNavigateStudio={(studio) => setViewerTab(studio)}
                      onStatusMessage={(msg) => setStatusBanner(msg)}
                    />
                  )}
                </React.Suspense>
                </WorkbenchInspectorProvider>
                              </ErrorBoundary>
              </div>
              {splitDocId !== null && (
                <SplitDocumentPane
                  doc={catalogNonDeletedDocs.find((d) => d.id === splitDocId) ?? null}
                  choices={[...openDocs.filter((d) => d.id !== activeDoc.id), ...catalogNonDeletedDocs.filter((d) => d.id !== activeDoc.id && !openDocs.some((o) => o.id === d.id))].slice(0, 400)}
                  onChooseDoc={(id) => setSplitDocId(id)}
                  onSwap={() => {
                    const other = splitDocId;
                    if (!other) return;
                    setSplitDocId(activeDoc.id);
                    selectDocumentWithHistory(other);
                  }}
                  onClose={() => setSplitDocId(null)}
                  onUpdateDocument={(d) => handleUpdateDocument(d)}
                  onDownload={(content, name, mime) => void handleDownloadFile(content, name, mime)}
                  onDownloadBinary={(bytes, name, mime) => void handleDownloadBinaryFile(bytes, name, mime)}
                />
              )}
              </div>

              {/* Right-Hand Inspector: the Sequence tab's 7-section accordion, or the open studio's sections */}
              {inspectorColumnShown && (
              <div
                role="separator"
                aria-label={`Resize ${inspectorTitle} inspector`}
                aria-orientation="vertical"
                aria-valuenow={inspectorWidthPx}
                aria-valuemin={INSPECTOR_MIN_PX}
                aria-valuemax={INSPECTOR_MAX_PX}
                tabIndex={0}
                className={`mbc-inspector-resizer ${inspectorDragging ? 'dragging' : ''}`}
                title="Drag or press Left/Right Arrow keys to resize the inspector • Double-click to reset"
                onDoubleClick={() =>
                  setInspectorWidthPx(DEFAULT_WORKSPACE_LAYOUT.inspectorWidthPx)
                }
                onPointerDown={(e) => {
                  if (inspectorDragRef.current.active) return;
                  e.preventDefault();
                  inspectorDragRef.current = {
                    active: true,
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startW: inspectorWidthPx,
                  };
                  setInspectorDragging(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setInspectorWidthPx((w) => Math.min(INSPECTOR_MAX_PX, w + 16));
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    setInspectorWidthPx((w) => Math.max(INSPECTOR_MIN_PX, w - 16));
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    setInspectorWidthPx(DEFAULT_WORKSPACE_LAYOUT.inspectorWidthPx);
                  }
                }}
              />
              )}
              {inspectorColumnShown && (
              <aside className="mbc-right-controls">
                <div className="mbc-pane-title">
                  <Settings2 size={14} />
                  <span>{inspectorTitle}</span>
                </div>

                {!sequenceInspectorTab ? (
                  // A studio's InspectorSections are drawn into this body, in their CSS order.
                  <div key="shared-sections" className="mbc-accordion-scroll mbc-inspector-sections" ref={setInspectorColumn} />
                ) : (
                <div key="sequence-accordion" className="mbc-accordion-scroll">
                  {/* 1. General & Layout Panel */}
                  <div className="mbc-accordion-section">
                    <button
                      type="button"
                      aria-expanded={Boolean(openRightPanels.general)}
                      className="mbc-accordion-header"
                      onClick={() => toggleAccordion('general')}
                    >
                      {openRightPanels.general ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span>General &amp; Layout</span>
                    </button>
                    {openRightPanels.general && (
                      <div className="mbc-accordion-body">
                        <div className="mbc-control-row">
                          <span>View Layout:</span>
                          <select
                            value={effectiveMapLayoutMode}
                            onChange={(e) =>
                              setMapLayoutMode(
                                e.target.value as 'split' | 'circular' | 'linear'
                              )
                            }
                          >
                            {canShowCircularMap && <option value="split">Split (Circular + Linear)</option>}
                            {canShowCircularMap && <option value="circular">Circular View Only</option>}
                            <option value="linear">Linear View Only</option>
                          </select>
                        </div>
                        <div className="mbc-control-row">
                          <span>Sequence Topology:</span>
                          <strong>{activeDoc.topology.toUpperCase()}</strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Display & Color Scheme Panel */}
                  {!isProteinSequence && (
                    <div className="mbc-accordion-section">
                      <button
                        type="button"
                        aria-expanded={Boolean(openRightPanels.display)}
                        className="mbc-accordion-header"
                        onClick={() => toggleAccordion('display')}
                      >
                        {openRightPanels.display ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <span>Display &amp; Color Scheme</span>
                      </button>
                      {openRightPanels.display && (
                        <div className="mbc-accordion-body">
                          <div className="mbc-control-row">
                            <span>Nucleotide Colors:</span>
                            <select
                              value={colorScheme}
                              onChange={(e) =>
                                setColorScheme(e.target.value as NucleotideColorScheme)
                              }
                            >
                              <option value="standard">Standard Default</option>
                              <option value="electropherogram">
                                Electropherogram (ABI 4-Dye)
                              </option>
                              <option value="gc_heatmap">GC Content Heat Map</option>
                              <option value="purine_pyrimidine">
                                Purine (A/G) vs Pyrimidine (C/T)
                              </option>
                              <option value="colorblind-safe">
                                Okabe-Ito Colorblind-Safe (Underline Cues)
                              </option>
                            </select>
                          </div>
                          <label className="mbc-check-row">
                            <input
                              type="checkbox"
                              checked={showTranslation}
                              onChange={(e) => setShowTranslation(e.target.checked)}
                            />
                            <span>Show 3-Frame Translation</span>
                          </label>
                        </div>
                      )}
                    </div>


                  )}

                  {/* 3. Annotations and Tracks Panel */}
                  <div className="mbc-accordion-section">
                    <button
                      type="button"
                      aria-expanded={Boolean(openRightPanels.annotations)}
                      className="mbc-accordion-header"
                      onClick={() => toggleAccordion('annotations')}
                    >
                      {openRightPanels.annotations ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span>Annotations and Tracks</span>
                    </button>
                    {openRightPanels.annotations && (
                      <div className="mbc-accordion-body">
                        {isDnaSequence && (<label className="mbc-check-row">
                          <input
                            type="checkbox"
                            checked={showPrimers}
                            disabled={!circularMapShown}
                            title={circularMapShown ? undefined : CIRCULAR_ONLY_HINT}
                            onChange={(e) => setShowPrimers(e.target.checked)}
                          />
                          <span>Primers ({activeDoc.primers.length})</span>
                        </label>)}
                        {!isProteinSequence && (<label className="mbc-check-row">
                          <input
                            type="checkbox"
                            checked={showOrfs}
                            disabled={!circularMapShown}
                            title={circularMapShown ? undefined : CIRCULAR_ONLY_HINT}
                            onChange={(e) => setShowOrfs(e.target.checked)}
                          />
                          <span>Predicted ORFs ({orfs.length}{orfScopeWords ? ` ${orfScopeWords}` : ''})</span>
                        </label>)}

                        <div className="mbc-mini-feature-list">
                          {activeDoc.features.map((f) => (
                            <button
                              type="button"
                              key={f.id}
                              className="mbc-mini-feat-btn"
                              onClick={() => {
                                setSelectedRange({
                                  start: f.start,
                                  end: f.end,
                                  label: `${f.name} (${f.type})`,
                                });
                              }}
                            >
                              <span
                                className="feat-dot"
                                style={{ backgroundColor: f.color }}
                              />
                              <span className="feat-lbl">{f.name}</span>
                              <span className="feat-rng">
                                {f.start}..{f.end}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. Graphs Panel (GC% & Hydrophobicity) */}
                  <div className="mbc-accordion-section">
                    <button
                      type="button"
                      aria-expanded={Boolean(openRightPanels.graphs)}
                      className="mbc-accordion-header"
                      onClick={() => toggleAccordion('graphs')}
                    >
                      {openRightPanels.graphs ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span>{isProteinSequence ? 'Hydropathy' : 'Nucleotide Composition'}</span>
                    </button>
                    {openRightPanels.graphs && (
                      <div className="mbc-accordion-body">
                        {!isProteinSequence && (<label className="mbc-check-row">
                          <input
                            type="checkbox"
                            checked={showGcGraph}
                            onChange={(e) => setShowGcGraph(e.target.checked)}
                          />
                          <span>GC% &amp; AT% Content Plot</span>
                        </label>)}
                        <label className="mbc-check-row">
                          <input
                            type="checkbox"
                            checked={showHydropathyGraph}
                            onChange={(e) => setShowHydropathyGraph(e.target.checked)}
                          />
                          <span>{isProteinSequence ? 'Kyte-Doolittle Hydrophobicity' : 'Translated Protein Hydropathy'}</span>
                        </label>
                      </div>
                    )}
                  </div>

                  {/* 5. Restriction Analysis Panel */}
                  {isDnaSequence && (
                    <div className="mbc-accordion-section">
                      <button
                        type="button"
                        aria-expanded={Boolean(openRightPanels.restriction)}
                        className="mbc-accordion-header"
                        onClick={() => toggleAccordion('restriction')}
                      >
                        {openRightPanels.restriction ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <span>Restriction Analysis ({restrictionSiteCount})</span>
                      </button>
                      {openRightPanels.restriction && (
                        <div className="mbc-accordion-body">
                          {restrictionWords && <p className="mbc-summary-note">{restrictionWords.detail}</p>}
                          <ResultWarnings warnings={restrictionScan.warnings} label="Restriction scan warnings" />
                          <label className="mbc-check-row">
                            <input
                              type="checkbox"
                              checked={showUniqueCuttersOnly}
                              disabled={!circularMapShown}
                              title={circularMapShown ? undefined : CIRCULAR_ONLY_HINT}
                              onChange={(e) => setShowUniqueCuttersOnly(e.target.checked)}
                            />
                            <span>{onceCutterListName} ({uniqueCutterNames.length})</span>
                          </label>
                          <div className="mbc-enzyme-cloud">
                            {uniqueCutterNames.map((name) => {
                              const site = cutSites.find((c) => c.enzyme.name === name);
                              return (
                                <button
                                  type="button"
                                  key={name}
                                  className="mbc-enz-pill"
                                  onClick={() => {
                                    if (site) {
                                      setSelectedRange({
                                        start: site.position,
                                        end:
                                          site.position +
                                          site.enzyme.recognitionSeq.length -
                                          1,
                                        label: `${name} cuts after ${cutSiteDisplayPosition(site.cutTop, activeDoc.sequence.length, activeDoc.topology === 'circular')}`,
                                      });
                                    }
                                  }}
                                >
                                  {name} ({site ? cutSiteDisplayPosition(site.cutTop, activeDoc.sequence.length, activeDoc.topology === 'circular') : ''})
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>


                  )}

                  {/* 6. ORFs (Open Reading Frames) Panel */}
                  {!isProteinSequence && (
                    <div className="mbc-accordion-section">
                      <button
                        type="button"
                        aria-expanded={Boolean(openRightPanels.orfs)}
                        className="mbc-accordion-header"
                        onClick={() => toggleAccordion('orfs')}
                      >
                        {openRightPanels.orfs ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <span>ORFs ({orfs.length} {orfScopeWords ?? 'Found'})</span>
                      </button>
                      {openRightPanels.orfs && (
                        <div className="mbc-accordion-body">
                          {orfScope && (
                            <p className="mbc-summary-note">
                              Only the first {orfScope.firstBp.toLocaleString()} of {activeDoc.sequence.length.toLocaleString()} bp
                              were scanned, as a linear sequence, for ORFs of {orfScope.minAa} aa or more: ORFs that run past{' '}
                              {orfScope.firstBp.toLocaleString()} bp are not listed.
                            </p>
                          )}
                          <div className="mbc-control-row">
                            <span>
                              Minimum ORF Size: {minOrfAa} aa
                              {orfScope && orfScope.minAa !== minOrfAa ? ` (${orfScope.minAa} aa on this sequence)` : ''}
                            </span>
                            <input
                              type="range"
                              min={25}
                              max={150}
                              step={5}
                              value={minOrfAa}
                              onChange={(e) => setMinOrfAa(Number(e.target.value))}
                            />
                          </div>
                          <label className="mbc-check-row">
                            <input
                              type="checkbox"
                              checked={allowAltStartCodons}
                              onChange={(e) => setAllowAltStartCodons(e.target.checked)}
                            />
                            <span>Include GTG / TTG Starts</span>
                          </label>
                        </div>
                      )}
                    </div>


                  )}

                  {/* 7. Statistics & Methylation Panel */}
                  <div className="mbc-accordion-section">
                    <button
                      type="button"
                      aria-expanded={Boolean(openRightPanels.statistics)}
                      className="mbc-accordion-header"
                      onClick={() => toggleAccordion('statistics')}
                    >
                      {openRightPanels.statistics ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span>Sequence Statistics</span>
                    </button>
                    {openRightPanels.statistics && (
                      <div className="mbc-accordion-body stats-list">
                        <div className="stat-kv">
                          <span>Length:</span>
                          <strong>{activeDoc.sequence.length.toLocaleString()} {sequenceUnit}</strong>
                        </div>
                        {isProteinSequence ? (
                          <>
                            <div className="stat-kv"><span>Molecular mass:</span><strong>{proteinStats.molecularWeightKda} kDa</strong></div>
                            <div className="stat-kv"><span>Isoelectric point:</span><strong>pH {proteinStats.isoelectricPointPi}</strong></div>
                          </>
                        ) : composition ? (
                          <>
                            {/* The engine counts U as T (analyze_sequence_composition, iupac.rs), so T or U is named by molecule type, never both (BG-01M6RTHN). */}
                            <div className="stat-kv"><span>{activeDoc.moleculeType === 'RNA' ? '%GC / %AU:' : '%GC / %AT:'}</span><strong>{composition.gcPercent.toFixed(1)}% / {composition.atPercent.toFixed(1)}%</strong></div>
                            {isDnaSequence && (
                              <>
                                <div className="stat-kv"><span>dsDNA mass:</span><strong>{massText(composition.mwDsDnaDa - 2 * strandEnds)}</strong></div>
                                <div className="stat-kv"><span>ssDNA mass:</span><strong>{massText(composition.mwSsDnaDa - strandEnds)}</strong></div>
                                {massesApproximate && (
                                  <p className="mbc-summary-note">
                                    Masses are approximate: {composition.counts.N.toLocaleString()} {composition.counts.N === 1 ? 'base is' : 'bases are'} N
                                    or another IUPAC code, weighed as the mean of A, C, G and T.
                                  </p>
                                )}
                                <div className="stat-kv"><span>Melting temp:</span><strong>{basicTmNoAnswerReason(composition) === null ? `${composition.meltingTempBasicC.toFixed(1)} °C` : 'n/a'}</strong></div>
                                {basicTmNoAnswerReason(composition) !== null && (
                                  <p className="mbc-summary-note">{basicTmNoAnswerReason(composition)}</p>
                                )}
                                <div className="stat-kv"><span>Dam / Dcm:</span><strong>{methylationSiteCount(composition.damSites.length)} / {methylationSiteCount(composition.dcmSites.length)} sites</strong></div>
                              </>
                            )}
                            <div className="stat-kv"><span>{activeDoc.moleculeType === 'RNA' ? 'A / C / G / U:' : 'A / C / G / T:'}</span><strong>{composition.counts.A} / {composition.counts.C} / {composition.counts.G} / {composition.counts.T}</strong></div>
                          </>
                        ) : wholeSequenceCount && 'error' in wholeSequenceCount ? (
                          <p className="mbc-summary-note" role="alert">The whole sequence could not be counted: {wholeSequenceCount.error}</p>
                        ) : (
                          <p className="mbc-summary-note" role="status">Counting the whole sequence…</p>
                        )}
                        {activeDoc.folder.startsWith('Genomes/') && (
                          <GenomeInspectorExtras
                            doc={activeDoc}
                            selectedRange={selectedRange}
                            onSelectRange={setSelectedRange}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
                )}
              </aside>
              )}
            </div>
            </>
            )}
          </section>

          {docTableBelowViewer && docTableResizer}
          {docTableBelowViewer && docTablePane}
          </>
          );
          })()}
        </div>
      </div>
      )}

      {/* 4. Full-Width Bottom Status Bar */}
      <footer className="mbc-statusbar" onMouseDown={handleWindowChromeMouseDown}>
        {sessionActive ? (
          <>
            <div className="statusbar-left">
              <span
                style={{ cursor: 'pointer' }}
                data-no-window-drag
                onClick={() => handleSaveMbcWorkbench(false)}
                title="Click to save current Workbench Session as .mbc"
              >
                Session: <strong>{sessionName}.mbc</strong> ({activeNonDeletedDocs.length} docs)
              </span>
              <span>•</span>
              {activeDoc.id ? (<>
              <span>
                Document: <strong>{activeDoc.name}</strong>{activeDoc.accession ? ` (${activeDoc.accession})` : ''}
              </span>
              <span>•</span>
              <span>
                {activeDoc.documentKind === 'tree'
                  ? `Tips: ${activeDoc.docMetadata?.['No. tips'] ?? 'unknown'}`
                  : selectedRange && selectionComposition
                  ? <>{`Selection: ${selectedRange.start}..${selectedRange.end} (${selectionComposition.length} bp | GC: ${selectionComposition.gcPercent.toFixed(1)}% | Tm: `}{selectionTm(selectionComposition)})</>
                  : isContigSummaryRecord(activeDoc)
                  ? `Summary record: ${declaredLengthOf(activeDoc).toLocaleString()} ${activeDoc.moleculeType === 'RNA' ? 'nt' : 'bp'} declared, bases not downloaded`
                  : `Full Length: ${activeDoc.sequence.length.toLocaleString()} ${
                      activeDoc.moleculeType === 'Protein' ? 'aa' : activeDoc.moleculeType === 'RNA' ? 'nt' : 'bp'
                    }`}
              </span>
              </>) : <span>Import or create a sequence to begin.</span>}
              {statusBanner && (
                <>
                  <span>•</span>
                  <span
                    className="statusbar-toast-pill"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    data-no-window-drag
                  >
                    <span className="statusbar-toast-text">{statusBanner}</span>
                    <button
                      type="button"
                      className="statusbar-toast-dismiss"
                      onClick={() => setStatusBanner(null)}
                      aria-label="Dismiss status notification"
                      title="Dismiss notification"
                    >
                      ×
                    </button>
                  </span>
                </>
              )}
            </div>
            <div className="statusbar-right">
              <button
                type="button"
                className="statusbar-engine-pill"
                onClick={() => {
                  setCommandPaletteQuery('');
                  setCommandPaletteIdx(0);
                  setCommandPaletteOpen(true);
                }}
                aria-label={`Open Quick Command Navigator (${sc('K')})`}
                aria-keyshortcuts={ariaSc('K')}
                title={`Quick Command Navigator (${sc('K')})`}
              >
                {sc('K')} Navigator
              </button>
              <span>•</span>
              <span>
                {!activeDoc.id ? 'No document selected' : activeDoc.documentKind === 'tree'
                  ? 'Document: Phylogenetic Tree'
                  : `Topology: ${activeDoc.topology === 'circular' ? 'Circular' : 'Linear'} (${activeDoc.moleculeType})`}
              </span>
              <span>•</span>
              <span>
                {sc('O')} Open
              </span>
              <span>•</span>
              <button
                type="button"
                className="statusbar-license-pill"
                onClick={() => setAboutModalOpen(true)}
                title="CC BY-NC 4.0 (SPDX: CC-BY-NC-4.0) — Click for About MolBioCraft"
              >
                CC BY-NC 4.0 Non-Commercial
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="statusbar-left">
              <span>
                Session: <strong>No Active Session</strong> — Choose{' '}
                <strong>
                  File{' '}
                  <ChevronRight
                    size={13}
                    strokeWidth={2.4}
                    className="mbc-inline-chevron"
                    aria-hidden="true"
                  />{' '}
                  New Session
                </strong>{' '}
                or <strong>Import</strong> to begin
              </span>
              {statusBanner && (
                <>
                  <span>•</span>
                  <span
                    className="statusbar-toast-pill"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    data-no-window-drag
                  >
                    <span className="statusbar-toast-text">{statusBanner}</span>
                    <button
                      type="button"
                      className="statusbar-toast-dismiss"
                      onClick={() => setStatusBanner(null)}
                      aria-label="Dismiss status notification"
                      title="Dismiss notification"
                    >
                      ×
                    </button>
                  </span>
                </>
              )}
            </div>
            <div className="statusbar-right">
              <button
                type="button"
                className="statusbar-engine-pill"
                onClick={() => {
                  setCommandPaletteQuery('');
                  setCommandPaletteIdx(0);
                  setCommandPaletteOpen(true);
                }}
                aria-label={`Open Quick Command Navigator (${sc('K')})`}
                aria-keyshortcuts={ariaSc('K')}
                title={`Quick Command Navigator (${sc('K')})`}
              >
                {sc('K')} Navigator
              </button>
              <span>•</span>
              <span>
                {sc('N')} New Session • {sc('I')} Import • {sc('O')} Open
              </span>
              <span>•</span>
              <button
                type="button"
                className="statusbar-license-pill"
                onClick={() => setAboutModalOpen(true)}
                title="CC BY-NC 4.0 (SPDX: CC-BY-NC-4.0) — Click for About MolBioCraft"
              >
                CC BY-NC 4.0 Non-Commercial
              </button>
            </div>
          </>
        )}
      </footer>

      {operationDialog?.kind === 'align' && (
        <AlignOperationDialog
          inputs={phylogenyInputs}
          sourceLabel={operationSourceLabel}
          folder={activeDoc.folder}
          initialAlgorithm={operationDialog.algorithm}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc) => handleAddOperationResult(doc, 'sequence-alignment',
            `Created alignment "${doc.name}" (${doc.alignmentMeta?.sequenceCount ?? 0} sequences, ${doc.sequence.length.toLocaleString()} columns)`)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'pairwise' && (
        <PairwiseOperationDialog
          inputs={phylogenyInputs}
          folder={activeDoc.folder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc) => handleAddOperationResult(doc, 'sequence-alignment',
            `Created pairwise alignment "${doc.name}" (identity ${doc.docMetadata?.['Identity (%)'] ?? '?'}%, score ${doc.docMetadata?.Score ?? '?'})`)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'digest' && (
        <DigestOperationDialog
          doc={activeDoc}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(docs) => {
            activateImportedDocumentsInWorkspace(docs);
            setViewerTab('sequence-view');
            setStatusBanner(`Digest created ${docs.length} fragment document${docs.length === 1 ? '' : 's'} from "${activeDoc.name}"`);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'primers' && (
        <DesignPrimersOperationDialog
          doc={activeDoc}
          selection={selectedRange}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onUpdate={(doc) => {
            handleUpdateDocument(doc, 'Design Primers');
            setStatusBanner(`Added primers ${doc.primers.slice(-2).map((p) => p.name).join(' and ')} to "${doc.name}"`);
          }}
          onCreate={(doc) => handleAddOperationResult(doc, 'sequence-view', `Created "${doc.name}"`)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'orfs' && (
        <FindOrfsOperationDialog
          doc={activeDoc}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onUpdate={(doc, added) => {
            handleUpdateDocument(doc, 'Find ORFs');
            setViewerTab('annotations-table');
            setStatusBanner(`Annotated ${added} ORF${added === 1 ? '' : 's'} on "${doc.name}"`);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'cloning' && (
        <CloningOperationDialog
          candidates={catalogNonDeletedDocs}
          initialVectorId={activeDoc.topology === 'circular' ? activeDoc.id : undefined}
          initialInsertId={selectedAnalysisDocuments.find((d) => d.id !== activeDoc.id && d.moleculeType === 'DNA')?.id
            ?? (activeDoc.topology === 'linear' ? activeDoc.id : undefined)}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc, summary) => handleAddOperationResult(doc, 'sequence-view', `Created "${doc.name}" — ${summary}`)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'denovo' && (
        <DeNovoOperationDialog
          reads={phylogenyInputs}
          sourceLabel={operationSourceLabel}
          folder={activeDoc.folder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(docs, summary) => {
            activateImportedDocumentsInWorkspace(docs);
            setViewerTab('sequence-view');
            setStatusBanner(`De novo assembly: ${summary}`);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'map' && (
        <MapToReferenceDialog
          inputs={phylogenyInputs}
          candidates={genomicsCandidateDocs}
          sourceLabel={operationSourceLabel}
          folder={activeDoc.folder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(docs, summary) => {
            activateImportedDocumentsInWorkspace(docs);
            setViewerTab('sequence-alignment');
            setStatusBanner(`Map to Reference: ${summary}`);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'duplicates' && (
        <FindDuplicatesDialog
          selected={selectedAnalysisDocuments}
          folderDocs={docsInSelectedFolder}
          folderLabel={selectedFolder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onSelect={(ids, summary) => {
            setCheckedDocIds(ids);
            setStatusBanner(summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'rename' && (
        <BatchRenameDialog
          docs={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(updated, summary) => {
            for (const d of updated) handleUpdateDocument(d, 'Batch Rename');
            setStatusBanner(summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'transalign' && (
        <TranslationAlignDialog
          inputs={phylogenyInputs}
          sourceLabel={operationSourceLabel}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc) => handleAddOperationResult(doc, 'sequence-alignment', `Created translation alignment "${doc.name}" (${doc.sequence.length.toLocaleString()} columns)`)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'mask' && (
        <MaskAlignmentDialog
          doc={activeDoc}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc) => handleAddOperationResult(doc, 'sequence-alignment', `Created "${doc.name}" (${doc.sequence.length.toLocaleString()} columns kept)`)}
          onUpdate={(doc, n) => {
            handleUpdateDocument(doc, 'Mask Alignment');
            setStatusBanner(`Annotated ${n} masked column${n === 1 ? '' : 's'} on "${doc.name}"`);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'consensus' && (
        <ConsensusDialog
          doc={activeDoc}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc) => handleAddOperationResult(doc, 'sequence-view', `Created consensus "${doc.name}" (${doc.sequence.length.toLocaleString()} residues)`)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {manageWorkflowsOpen && (
        <ManageWorkflowsDialog
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onRun={(id) => {
            setManageWorkflowsOpen(false);
            setRunWorkflowFor({ workflowId: id });
          }}
          onClose={() => setManageWorkflowsOpen(false)}
        />
      )}
      {runWorkflowFor && (
        <RunWorkflowDialog
          inputs={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          sourceLabel={selectedAnalysisDocuments.length > 1 ? `${selectedAnalysisDocuments.length} selected documents` : (selectedAnalysisDocuments[0] ?? activeDoc).name}
          folder={activeDoc.folder}
          initialWorkflowId={runWorkflowFor.workflowId}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onDone={(result, w) => {
            for (const d of result.updated) handleUpdateDocument(d, `Workflow: ${w.name}`);
            if (result.created.length) activateImportedDocumentsInWorkspace(result.created);
            const last = result.created[result.created.length - 1];
            // Show the workflow's final result (the import helper activates the first document).
            if (last && result.created.length > 1) window.setTimeout(() => selectDocumentWithHistory(last.id), 0);
            if (last) setViewerTab(last.documentKind === 'tree' ? 'phylogenetics' : last.documentKind === 'alignment' ? 'sequence-alignment' : 'sequence-view');
            setStatusBanner(`Workflow "${w.name}": ${result.log.map((l) => `${l.step}. ${l.label} — ${l.summary}`).join(' · ')}`);
          }}
          onClose={() => setRunWorkflowFor(null)}
        />
      )}
      {operationDialog?.kind === 'consensus-tree' && (
        <ConsensusTreeDialog
          trees={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          sourceLabel={selectedAnalysisDocuments.length > 1 ? `${selectedAnalysisDocuments.length} trees` : activeDoc.name}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc) => handleAddOperationResult(doc, 'phylogenetics', `Created "${doc.name}" (${doc.description})`)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'saved-primers' && (
        <TestSavedPrimersDialog
          targets={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          primerDocs={catalogNonDeletedDocs.filter((d) => d.documentKind === 'primer' && d.sequence.length > 0)}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(r) => {
            for (const d of r.updated) handleUpdateDocument(d, 'Test with Saved Primers');
            setStatusBanner(r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'trim' && (
        <TrimEndsDialog
          reads={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          folder={activeDoc.folder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(r) => {
            for (const d of r.updated) handleUpdateDocument(d, 'Trim Ends');
            if (r.created.length) activateImportedDocumentsInWorkspace(r.created);
            setStatusBanner(r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'backtranslate' && (
        <BackTranslateDialog
          proteins={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          folder={activeDoc.folder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => {
            activateImportedDocumentsInWorkspace(r.created);
            setViewerTab('sequence-view');
            setStatusBanner(r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'add-to-alignment' && (
        <AddToAlignmentDialog
          inputs={selectedAnalysisDocuments}
          activeDoc={activeDoc}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc) => handleAddOperationResult(doc, 'sequence-alignment', `Created "${doc.name}" (${doc.alignmentMeta?.sequenceCount ?? 0} sequences)`)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'validate-clone' && (
        <ValidateCloneDialog
          inputs={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          candidates={genomicsCandidateDocs}
          folder={activeDoc.folder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc, summary) => handleAddOperationResult(doc, 'sequence-alignment', summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'import-metadata' && (
        <MetadataImportDialog
          selected={selectedAnalysisDocuments}
          folderDocs={docsInSelectedFolder}
          allDocs={activeNonDeletedDocs}
          folderLabel={selectedFolder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(updated, summary) => {
            for (const d of updated) handleUpdateDocument(d, 'Import Metadata');
            setStatusBanner(summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'merge-pairs' && (
        <MergePairsDialog
          reads={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : docsInSelectedFolder}
          folder={activeDoc.folder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => {
            activateImportedDocumentsInWorkspace(r.created);
            setViewerTab('sequence-view');
            setStatusBanner(r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'degenerate-primers' && (
        <DegeneratePrimersDialog
          doc={activeDoc}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(r) => {
            for (const d of r.updated) handleUpdateDocument(d, 'Design Degenerate Primers');
            for (const d of r.created.slice(1)) handleAddOperationResult(d, 'sequence-view', r.summary);
            handleAddOperationResult(r.created[0], 'text-view', r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'annotate-from-documents' && (
        <AnnotateFromDocumentsDialog
          targets={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          candidates={catalogNonDeletedDocs}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(r) => {
            for (const d of r.updated) handleUpdateDocument(d, 'Annotate from Documents');
            setStatusBanner(r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'microsatellites' && (
        <MicrosatelliteDialog
          runs={(selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []).filter((d) => typeof d.docMetadata?.['Fragment trace'] === 'string')}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(r) => {
            for (const d of r.updated) handleUpdateDocument(d, 'Microsatellite Analysis');
            handleAddOperationResult(r.created[0], 'text-view', r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'expression-levels' && (
        <ExpressionLevelsDialog
          contigs={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          findDoc={(id) => catalogNonDeletedDocs.find((d) => d.id === id)}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'text-view', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'structural-variants' && (
        <StructuralVariantsDialog
          reads={(selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []).filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0)}
          references={catalogNonDeletedDocs.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length >= 500 && !d.alignmentMeta?.sequences?.length).slice(0, 500)}
          onCreate={(r) => {
            handleAddOperationResult(r.created[1], 'text-view', r.summary);
            handleAddOperationResult(r.created[0], 'sequence-view', r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'align-structures' && (
        <StructureAlignmentDialog
          documents={activeNonDeletedDocs}
          initialA={selectedAnalysisDocuments.find(hasStructure)?.id ?? (hasStructure(activeDoc) ? activeDoc.id : undefined)}
          initialB={selectedAnalysisDocuments.filter(hasStructure)[1]?.id}
          folder={activeDoc.folder}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'sequence-alignment', r.summary)}
          onDownload={(content, name, mime) => void handleDownloadFile(content, name, mime)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'make-blast-db' && (
        <MakeBlastDbDialog
          selected={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          existingNames={localBlastDbs.map((db) => db.name)}
          onCreate={(entry) => {
            setLocalBlastDbs((prev) => [...prev, entry]);
            setStatusBanner(`Created local BLAST database "${entry.name}" with ${entry.sequenceCount} sequence${entry.sequenceCount === 1 ? '' : 's'}.`);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'expression' && (
        <ExpressionDialog
          folder={activeDoc.folder}
          countTableDocs={catalogNonDeletedDocs.filter((d) => typeof d.docMetadata?.['Count table'] === 'string')}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'text-view', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'crispr-editing' && (
        <CrisprEditingDialog
          traces={catalogNonDeletedDocs.filter((d) => d.chromatogram)}
          selected={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'text-view', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'import-primers' && (
        <ImportPrimersDialog
          onCreate={(r) => {
            for (const d of r.created.slice(1)) handleAddOperationResult(d, 'sequence-view', r.summary);
            handleAddOperationResult(r.created[0], 'sequence-view', r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'annotate-by-blast' && (
        <AnnotateByBlastDialog
          targets={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          databases={localBlastDbs.filter((db) => db.moleculeType === 'Nucleotide').map((db) => ({ id: db.id, name: db.name, docs: localBlastDbDocuments(db, catalogNonDeletedDocs) }))}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(r) => {
            for (const d of r.updated) handleUpdateDocument(d, 'Annotate by BLAST');
            setStatusBanner(r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'compare-annotations' && (
        <CompareAnnotationsDialog
          inputs={selectedAnalysisDocuments.length >= 2 ? selectedAnalysisDocuments : [activeDoc, ...selectedAnalysisDocuments.filter((d) => d.id !== activeDoc.id)]}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'annotations-table', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'read-qc' && (
        <ReadQcDialog
          reads={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : docsInSelectedFolder}
          sourceLabel={selectedAnalysisDocuments.length ? `${selectedAnalysisDocuments.length} selected reads` : selectedFolder}
          folder={activeDoc.folder}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'text-view', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'evo' && (
        <EvolutionAnalysisDialog
          key={`${operationDialog.analysis}-${JSON.stringify(operationDialog.initial ?? {})}`}
          kind={operationDialog.analysis}
          inputs={phylogenyInputs}
          sourceLabel={operationSourceLabel}
          folder={activeDoc.folder}
          initial={operationDialog.initial}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'text-view', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'timetree' && (
        <TimetreeDialog
          treeDoc={[...selectedAnalysisDocuments, activeDoc].find((d) => d?.id && typeof d.docMetadata?.Newick === 'string') ?? null}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => {
            handleAddOperationResult(r.created[1], 'text-view', r.summary);
            handleAddOperationResult(r.created[0], 'phylogenetics', r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'compute-distances' && (
        <ComputeDistancesDialog
          inputs={phylogenyInputs}
          sourceLabel={operationSourceLabel}
          folder={activeDoc.folder}
          initialAnalysis={operationDialog.analysis}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'text-view', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'condense-tree' && (
        <CondenseTreeDialog
          trees={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'phylogenetics', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'gene-duplications' && (
        <GeneDuplicationDialog
          trees={selectedAnalysisDocuments.length ? selectedAnalysisDocuments : catalogNonDeletedDocs}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(r) => handleAddOperationResult(r.created[0], 'phylogenetics', r.summary)}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'examples' && (
        <ExamplesDialog
          library={SAMPLE_LIBRARY}
          onCreate={(docs, summary) => {
            activateImportedDocumentsInWorkspace(docs);
            setStatusBanner(summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'highlight-sites' && (
        <HighlightSitesDialog
          doc={activeDoc}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(r) => {
            for (const d of r.updated) handleUpdateDocument(d, 'Highlight Sites');
            setViewerTab('sequence-alignment');
            setStatusBanner(r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'tree' && (
        <BuildTreeOperationDialog
          inputs={phylogenyInputs}
          sourceLabel={operationSourceLabel}
          folder={activeDoc.folder}
          initialMethod={operationDialog.method}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onCreate={(doc) => handleAddOperationResult(doc, 'phylogenetics',
            `Created tree "${doc.name}" (${doc.docMetadata?.['No. tips'] ?? '?'} tips, ${doc.docMetadata?.['Tree method'] ?? ''})`)}
          onClose={() => setOperationDialog(null)}
        />
      )}

      {/* Static Top-Anchored Modals: Quick Command Palette, 11-Category Preferences, BLAST Search Studio, Reference Databases, New Sequence, About */}
      {commandPaletteOpen && (
        <StaticModalDialog
          titleId="mbc-cmd-palette-title"
          title={`Quick Command & Construct Jump (${sc('K')})`}
          sizeClass="modal-size-newseq"
          onClose={() => setCommandPaletteOpen(false)}
        >
          <div className="mbc-cmd-palette-body">
            <input
              type="text"
              autoFocus
              data-autofocus="true"
              className="mbc-cmd-palette-input"
              placeholder="Search open constructs, studios, 500 kbp genome, 10k aa protein, 3D viewer, or accessibility..."
              value={commandPaletteQuery}
              onChange={(e) => {
                setCommandPaletteQuery(e.target.value);
                setCommandPaletteIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCommandPaletteIdx((i) =>
                    Math.min(Math.max(0, commandPaletteItems.length - 1), i + 1)
                  );
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCommandPaletteIdx((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && commandPaletteItems[commandPaletteIdx]) {
                  e.preventDefault();
                  const chosen = commandPaletteItems[commandPaletteIdx];
                  setCommandPaletteOpen(false);
                  chosen.run();
                }
              }}
            />
            <div className="mbc-cmd-palette-list" role="listbox" aria-label="Quick Commands">
              {commandPaletteItems.map((it, idx) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === commandPaletteIdx}
                  key={it.id}
                  className={`mbc-cmd-palette-item ${
                    idx === commandPaletteIdx ? 'selected' : ''
                  }`}
                  onClick={() => {
                    setCommandPaletteOpen(false);
                    it.run();
                  }}
                >
                  <span>
                    <strong>{it.label}</strong>
                  </span>
                  <span className="mbc-cmd-palette-meta">
                    <span className="mbc-cmd-cat-pill">{it.category}</span>
                    <span>{it.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </StaticModalDialog>
      )}
      {prefsModalTab && (
        <PreferencesModal
          initialTab={prefsModalTab}
          onClose={() => setPrefsModalTab(null)}
          themeMode={themePref}
          onChangeTheme={applyThemePreference}
          confirmBeforeQuit={confirmBeforeQuit}
          onChangeConfirmBeforeQuit={applyConfirmBeforeQuitPreference}
          onExportPreferences={handleExportPreferencesFile}
          onImportPreferences={triggerImportPreferencesPicker}
          onResetAllPreferences={() => {
            resetUserPreferences();
            applyThemePreference('system');
            applyConfirmBeforeQuitPreference(true);
            setStatusBanner('All preferences were reset to their defaults.');
          }}
        />
      )}

      {helpPanelOpen && <HelpPanel viewerTab={viewerTab} onClose={() => setHelpPanelOpen(false)} />}

      {blastModalOpen && (
        <BlastSearchModal
          activeDoc={activeDoc}
          allDocs={activeNonDeletedDocs}
          localDatabases={localBlastDbs}
          onClose={() => setBlastModalOpen(false)}
          onSelectHitDoc={(docId) => selectDocumentWithHistory(docId)}
          onSaveQueryCentric={(querySeq, hits) => {
            try {
              const r = runQueryCentricAlignment(activeDoc, querySeq, hits, { sourceLabel: activeDoc.name, folder: activeDoc.folder }, activeNonDeletedDocs);
              setBlastModalOpen(false);
              handleAddOperationResult(r.created[0], 'sequence-alignment', r.summary);
            } catch (err) {
              setStatusBanner(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {folderContextMenu && <CascadingMenuPopup
        items={folderContextItems(folderContextMenu.folder)}
        position={folderContextMenu.pos}
        minWidth={240}
        isContextMenu={true}
        ariaLabel={`Folder Actions for ${folderLabel(folderContextMenu.folder)}`}
        onCloseAll={closeAllMenus}
      />}
      {folderInfo && <StaticModalDialog titleId="folder-size-title" sizeClass="modal-size-about" title={`Folder Size: ${folderInfo.label}`} onClose={() => setFolderInfo(null)}>
        <p>{folderInfo.count.toLocaleString()} documents · {folderInfo.bytes.toLocaleString()} bytes</p>
        <p>Uncompressed document JSON, including subfolders. Exported file size may differ.</p>
      </StaticModalDialog>}

      {rowContextMenu && (() => {
        const ctxDoc = documents.find((d) => d.id === rowContextMenu.docId) ?? activeDoc;
        const ctxFav = favoriteIdsSet.has(ctxDoc.id);
        const ctxDeleted = deletedIdsSet.has(ctxDoc.id);
        const ctxItems: MenuNode[] = [
          {
            kind: 'command',
            id: 'ctx-open-seq',
            label: 'Open Sequence View',
            onSelect: () => {
              selectDocumentWithHistory(ctxDoc.id);
              setViewerTab('sequence-view');
            },
          },
          {
            kind: 'command',
            id: 'ctx-toggle-fav',
            label: ctxFav ? 'Unfavorite' : 'Add to Favorites',
            onSelect: () => handleToggleFavoriteDocs(ctxDoc.id),
          },
          { kind: 'separator', id: 'ctx-sep-1' },
          ...(ctxDoc.moleculeType !== 'Protein'
            ? ([
                {
                  kind: 'command',
                  id: 'ctx-revcomp',
                  label: 'Reverse Complement',
                  onSelect: () => {
                    selectDocumentWithHistory(ctxDoc.id);
                    handleReverseComplementActiveDoc(ctxDoc);
                  },
                },
                {
                  kind: 'command',
                  id: 'ctx-toggle-topo',
                  label: `Set ${
                    ctxDoc.topology === 'circular' ? 'Linear' : 'Circular'
                  }`,
                  onSelect: () => {
                    selectDocumentWithHistory(ctxDoc.id);
                    handleToggleCircularLinear(ctxDoc);
                  },
                },
                {
                  kind: 'command',
                  id: 'ctx-cloning-gel',
                  label: 'Digest & Gel',
                  onSelect: () => {
                    selectDocumentWithHistory(ctxDoc.id);
                    openCloningMethod('Restriction Ligation', 'gel');
                  },
                },
                {
                  kind: 'command',
                  id: 'ctx-primers',
                  label: 'Primers & CRISPR',
                  onSelect: () => {
                    selectDocumentWithHistory(ctxDoc.id);
                    setViewerTab('primers-pcr');
                  },
                },
              ] as MenuNode[])
            : []),
          { kind: 'separator', id: 'ctx-sep-2' },
          {
            kind: 'command',
            id: 'ctx-export-gb',
            label: 'Export GenBank',
            onSelect: () =>
              handleDownloadFile(exportToGenBank(ctxDoc), `${ctxDoc.name}.gb`),
          },
          {
            kind: 'command',
            id: 'ctx-export-fasta',
            label: 'Export FASTA',
            disabled: ctxDoc.sequence.length === 0,
            onSelect: () =>
              handleDownloadFile(exportToFasta(ctxDoc), `${ctxDoc.name}.fasta`),
          },
          { kind: 'separator', id: 'ctx-sep-3' },
          ctxDeleted
            ? {
                kind: 'command',
                id: 'ctx-restore-trash',
                label: 'Restore from Trash',
                onSelect: () => handleRestoreFromDeletedItems(ctxDoc.id),
              }
            : {
                kind: 'command',
                id: 'ctx-move-trash',
                label: 'Move to Trash',
                // Same path as File › Move to Trash (it used to leave the
                // trashed document active and displayed).
                onSelect: () => handleSoftDeleteDocs([ctxDoc]),
              },
        ];
        return (
          <CascadingMenuPopup
            items={ctxItems}
            position={rowContextMenu.pos}
            minWidth={215}
            isContextMenu={true}
            ariaLabel={`Context Actions for ${ctxDoc.name}`}
            onCloseAll={closeAllMenus}
          />
        );
      })()}

      {dbExplorerCategory && (
        <React.Suspense fallback={null}>
          <DatabaseExplorerModal
            initialCategory={dbExplorerCategory}
            documents={activeNonDeletedDocs}
            localDatabases={localBlastDbs}
            onAddLocalDatabase={(entry) =>
              setLocalBlastDbs((prev) => [...prev, entry])
            }
            onRemoveLocalDatabase={(id) =>
              setLocalBlastDbs((prev) => prev.filter((db) => db.id !== id))
            }
            onImportDocument={(doc) => handleAddConstruct(doc)}
            onImportFiles={(files) => importIncomingFilesBatch(files, 'replace', 'imported')}
            onOpenBlastModal={() => {
              setDbExplorerCategory(null);
              setBlastModalOpen(true);
            }}
            onClose={() => setDbExplorerCategory(null)}
          />
        </React.Suspense>
      )}

      {newSeqModalOpen && (
        <NewSequenceModal
          defaultFolder={selectedFolder}
          initialSequence={newSeqInitialClipboardText}
          onClose={() => {
            setNewSeqModalOpen(false);
            setNewSeqInitialClipboardText('');
          }}
          onCreateDoc={handleAddConstruct}
        />
      )}

      {aboutModalOpen && (
        <AboutMolBioCraftModal onClose={() => setAboutModalOpen(false)} />
      )}

      {confirmQuitModalOpen && (
        <ConfirmQuitModal
          onCancel={() => setConfirmQuitModalOpen(false)}
          onConfirmQuit={executeConfirmedAppQuit}
        />
      )}

      {confirmDialog && (
        <StaticModalDialog
          titleId="mbc-confirm-dialog-title"
          title={confirmDialog.title}
          sizeClass="modal-size-newseq"
          onClose={() => {
            const cancel = confirmDialog.onCancel;
            setConfirmDialog(null);
            cancel?.();
          }}
        >
          <div className="mbc-prompt-dialog-form" role="alertdialog" aria-describedby="mbc-confirm-dialog-message">
            <p id="mbc-confirm-dialog-message" className="mbc-prompt-dialog-label">
              {confirmDialog.message}
            </p>
            <div className="mbc-prompt-dialog-actions">
              <button
                type="button"
                className="btn-secondary btn-sm"
                autoFocus
                data-autofocus="true"
                onClick={() => {
                  const cancel = confirmDialog.onCancel;
                  setConfirmDialog(null);
                  cancel?.();
                }}
              >
                Cancel
              </button>
              {confirmDialog.alternateLabel && confirmDialog.onAlternate && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    const alt = confirmDialog.onAlternate;
                    setConfirmDialog(null);
                    alt?.();
                  }}
                >
                  {confirmDialog.alternateLabel}
                </button>
              )}
              <button
                type="button"
                className={confirmDialog.destructive ? 'btn-primary btn-sm btn-danger' : 'btn-primary btn-sm'}
                onClick={() => {
                  const confirm = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  confirm();
                }}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </StaticModalDialog>
      )}

      {promptDialog && (
        <StaticModalDialog
          titleId="mbc-prompt-dialog-title"
          title={promptDialog.title}
          sizeClass="modal-size-newseq"
          onClose={() => setPromptDialog(null)}
        >
          <form
            className="mbc-prompt-dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              const val = promptDialog.value.trim();
              if (!val) return;
              const callback = promptDialog.onConfirm;
              setPromptDialog(null);
              callback(val);
            }}
          >
            <label className="mbc-prompt-dialog-label" htmlFor="mbc-prompt-dialog-input">
              {promptDialog.label}
            </label>
            <input
              id="mbc-prompt-dialog-input"
              type="text"
              autoFocus
              data-autofocus="true"
              maxLength={120}
              required
              className="mbc-cmd-palette-input"
              placeholder={promptDialog.placeholder}
              value={promptDialog.value}
              onChange={(e) =>
                setPromptDialog((prev) =>
                  prev ? { ...prev, value: e.target.value } : null
                )
              }
            />
            <div className="mbc-prompt-dialog-actions">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setPromptDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary btn-sm"
                disabled={!promptDialog.value.trim()}
              >
                {promptDialog.confirmLabel}
              </button>
            </div>
          </form>
        </StaticModalDialog>
      )}

      {startupSplashOpen && (
        <AppStartupSplash
          onComplete={() => setStartupSplashOpen(false)}
          onWindowChromeMouseDown={handleWindowChromeMouseDown}
        />
      )}
    </div>
  );
};
