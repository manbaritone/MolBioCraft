// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { ProjectFolderTree } from './components/ProjectFolderTree';
import { documentsInFolder, folderDescendants, folderPathLabels, toggleVisibleSelection, normalizeProjectExplorer, PROJECT_ROOT, type ExplorerFolder } from './core/projectExplorer';
import { MapGallery, type MapGalleryView } from './components/MapGallery';
import { DocumentInfoPanel, DocumentNotesEditor } from './components/DocumentInfoPanel';
import { EMPTY_WORKSPACE_DOCUMENT, removeUntouchedLegacyStarter } from './core/emptyWorkspace';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
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
  LayoutGrid,
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
import { BackTranslateDialog, CompareAnnotationsDialog, MergePairsDialog, PrimerBindingDialog, ReadQcDialog, TestSavedPrimersDialog, TrimEndsDialog } from './components/PrimerReadDialogs';
import { openPrimerDatabase } from './core/primerDatabase';
import { openEnzymeCollections, openEnzymeDatabase, readEnzymeScanCollection, writeEnzymeScanCollection } from './core/enzymeDatabase';
import { REBASE_ENZYMES } from './data/rebaseEnzymes';
import { MetadataImportDialog } from './components/MetadataImportDialog';
import { ComputeDistancesDialog, CondenseTreeDialog, EvolutionAnalysisDialog, TimetreeDialog, ExamplesDialog, GeneDuplicationDialog, HighlightSitesDialog } from './components/EvolutionAnalysisDialogs';
import type { EvoAnalysis } from './core/evolutionAnalyses';
import { loadStoredBlastDbs, localBlastDbDocuments, storeBlastDbs } from './core/localBlastDb';
import { deleteTableSearch, isSearchField, loadSavedSearches, saveTableSearch, SEARCH_FIELDS, searchFieldText, type ProjectSavedSearch, type SavedSearch } from './core/savedSearches';
import { ExpressionDialog, ExpressionResultsView } from './components/ExpressionViews';
import { HelpPanel } from './components/HelpPanel';
import { FragmentTraceView, MicrosatelliteDialog } from './components/FragmentViews';
import { contigDocument, fragmentDocumentFromFsa, mapOptionsOf, runQueryCentricAlignment, withWarningNotes } from './core/operationRunners';
import { exportReadsToFastq, fastqToReadDocuments, samToContigs, vcfToFeatures } from './core/importFormats';
import { parseAlignedFasta, parseTextAlignment, splitFlatfileRecords, textAlignmentToDocument } from './core/alignmentFormats';
import { DocumentSplitDivider, SplitDocumentPane, splitPaneShowsCircularMap, splitPaneShowsSequenceMap } from './components/SplitDocumentPane';
import {
  DEFAULT_PANE_SPLIT,
  PANE_SPLIT_KEY_STEP_LARGE_PX,
  PANE_SPLIT_KEY_STEP_PX,
  collapsePane,
  dragPaneSplit,
  paneSplitIsDefault,
  paneSplitRatioAt,
  paneSplitStyle,
  paneSplitValueNow,
  parsePaneSplit,
  renderedPaneSplitRatio,
  resetPaneSplit,
  restorePanes,
  stepPaneSplit,
  type PaneSplitState,
} from './core/paneSplit';
import {
  DOCUMENT_SPLIT_CHOICES,
  DEFAULT_DOCUMENT_SPLIT_SIZE,
  documentSplitExtent,
  documentSplitForSession,
  documentSplitHostClass,
  documentSplitStyle,
  parseDocumentSplit,
  renderedDocumentSplitRatio,
  DEFAULT_SPLIT_PANE_VIEW,
  type DocumentSplitOrientation,
  type DocumentSplitSize,
  type SplitPaneView,
} from './core/documentSplit';
import { StructureAlignmentDialog } from './components/StructureAlignmentDialog';
import { GenbankToDialog } from './components/GenbankToDialog';
import { hasStructure } from './core/structureModels';
import { ExpressionLevelsDialog, StructuralVariantsDialog, MakeBlastDbDialog, CrisprEditingDialog, AnnotateByBlastDialog, AnnotateFromDocumentsDialog, DegeneratePrimersDialog, ImportPrimersDialog, ImportPrimersToDatabaseDialog } from './components/SequenceAnalysisToolDialogs';
import type { OptionValues } from './core/optionProfiles';
import { allWorkflows } from './core/workflows';
import {
  formatShortcut,
  IS_MAC_PLATFORM,
  OPERATION_LABELS,
  OPERATION_SHORTCUTS_EVENT,
  operationForShortcut,
  readOperationShortcuts,
  releaseReservedOperationShortcuts,
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
  PAIR_ALIGNMENT_OPERATION,
  treeSourceAlignment,
  isTreeDocument,
  relevantViewerTabs,
  resolveViewerTab,
  studioRailItems,
  hasBiologicalSequence,
  originalDocumentText,
  viewerTabLabel,
  type ViewerTab,
} from './core/documentViews';
import { STUDIOS, studioAvailability, studioForTab, studioIconElement, type StudioEntry, type StudioId } from './core/studioRegistry';
import { genomicsTabsForDocument } from './core/analysisContext';
import { ConstructCockpitBar, basicTmHasNoAnswer } from './components/ConstructCockpitBar';
import {
  MENU_FUNCTION_INFO_EVENT,
  readStoredShowMenuFunctionInfo,
  resolveMenuNodeFunctionDescription,
  writeStoredShowMenuFunctionInfo,
} from './data/menuFunctionDescriptions';
import {
  CloningMethodType,
  NucleotideColorScheme,
  NUCLEOTIDE_COLOR_SCHEMES,
  ProteinAnalysisReport,
  RestrictionCutSite,
  RestrictionEnzyme,
  SequenceDocument,
} from './types/bio';
import {
  crossesOrigin,
  formatIntervalLabel,
  intervalLength,
  intervalSegments,
  intervalSequence,
  intervalUnit,
  piecesWithinInterval,
  reverseInterval,
  selectionInterval,
} from './core/activeInterval';
import {
  analyzeProteinSequence,
  analyzeSequenceComposition,
  COMMON_PLASMID_FEATURES,
  convertDnaRna,
  detectCommonFeatures,
  activeEnzymeList,
  EMPTY_RESTRICTION_SCAN,
  enzymeLabel,
  findORFs,
  invertSequenceCoordinates,
  MSA_MAX_RESIDUES,
  restrictionSiteCountsByName,
  reverseComplement,
  scanRestrictionSites,
  SequenceComposition,
  setCircularOrigin,
  tmNoAnswerSentence,
  joinedWithAnd,
  parseGff3Sequences,
  structureChainSequences,
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
  CircularMapRotationControl,
  CircularPlasmidMap,
  clampSequenceZoom,
  primerTmText,
  chosenRestrictionScope,
  type RestrictionScanScope,
  restrictionScanEnzymes,
  restrictionScanScope,
  restrictionScannedBp,
  restrictionScopeWords,
  SEQUENCE_ZOOM_DEFAULT,
  stepSequenceZoom,
  sequenceZoomLabel,
} from './components/CircularPlasmidMap';
import { AppStartupSplash } from './components/AppStartupSplash';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InspectorSection, NO_INSPECTOR_CLAIMS, WorkbenchInspectorContext, WorkbenchInspectorProvider, type InspectorClaims } from './components/WorkbenchInspector';
import { GENETIC_CODE_NAMES } from './core/alignmentViewModel';
import type { PipelinesView } from './components/WorkflowPipelineStudio';
import { ResultWarnings } from './components/ResultWarnings';
import { MolBioCraftLogo } from './components/MolBioCraftLogo';
import {
  GenomeInspectorExtras,
  LinearSequenceView,
} from './components/LinearSequenceView';
import { ScrollableMenuStrip } from './components/ScrollableMenuStrip';
import { StudioRail } from './components/StudioRail';
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
import { PrimerDatabaseWindow } from './components/PrimerDatabaseWindow';
import { initialFolderScope, ProjectSearchPanel } from './components/ProjectSearchPanel';
import { hitFolderId, notShownInExplorer, type HitOpening, type SearchContext, type SearchScope, type TextHit } from './core/projectSearch';
import { EnzymeDatabaseWindow, collectionMemberLabel, type EnzymeWindowIntent } from './components/EnzymeDatabaseWindow';
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
  reverseOnlySequence,
} from './core/genomicsAndStructureSuite';
import { MODULAR_VECTOR_PARTS, ModularVectorPart } from './data/modularVectorParts';
import { VECTOR_CATALOG } from './data/vectorCatalog';
import {
  clearWorkbenchLocalAutosave,
  createAutosaveFailureNotice,
  describeAutosaveFailure,
  hasWorkbenchLocalAutosave,
  isMbcFileOrPayload,
  isMbcGzipBytes,
  isMbcZipArchiveBytes,
  loadWorkbenchFromLocalAutosave,
  MBC_MIME_TYPE,
  MBC_ZIP_MIME_TYPE,
  MbcWorkbenchSnapshot,
  parseMbcFolderZip,
  parseMbcWorkbench,
  parseMbcWorkbenchBytes,
  autosaveWorkbench,
  autosaveWorkbenchWithin,
  QUIT_AUTOSAVE_TIMEOUT_MS,
  readNewestLocalStorageWorkbenchAutosave,
  mapRotationForSession,
  restoredMapRotation,
  restoredSiteVisibility,
  serializeMbcFolderZip,
  serializeMbcWorkbench,
  siteVisibilityForSession,
  unmatchedHiddenEnzymes,
  unmatchedHiddenEnzymesNotice,
  unreadableMapRotationNotice,
  UNREADABLE_TRACK_SETTING_WARNINGS,
  workbenchAutosaveNeedsRecovery,
  writeWorkbenchAutosaveDirtyFlag,
  type WorkbenchAutosaveReadResult,
  type WorkbenchAutosaveResult,
} from './core/mbcSessionFormat';
import {
  buildNativeMenuState,
  buildCommandDocumentContext,
  checkMultiDocumentSelection,
  circularMapUnavailableReason,
  isTagOrProteaseFeature,
  commandAvailability,
  CommandContext,
  CommandId,
  CIRCULAR_ONLY_HINT,
  trackAvailability,
  type TrackId,
  type ViewCommandId,
  type WorkbenchCommandId,
} from './core/commandAvailability';
import { assignUniqueDocumentIds } from './core/documentIds';
import {
  collectMenuShortcutBindings,
  findMenuShortcut,
  normalisedEventKey,
  MenuShortcutBinding,
  shortcutLabelToAriaKeyshortcuts,
  ShortcutMenuNode,
} from './core/menuShortcuts';
import { command as registryCommand, formatCommandShortcut, menubarCommands, nativeTargets, rankPaletteCommands, toolbarMenuItems, type ToolbarGroupId } from './core/commandRegistry';
import {
  decideSessionReplacement,
  isSessionContentDirty,
  SessionContentSnapshot,
} from './core/sessionGuard';
import {
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

/** Every native menu id and the registry command it runs (US-01M6Q159). */
const NATIVE_MENU_TARGETS = nativeTargets(CLONING_ACTION_VECTOR_PRESETS);
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
  MolBioDocTypeIcon,
  MolBioFeatureTypeBadge,
  MolBioMenuGlyph,
  MolBioSidebarNodeIcon,
  MolBioSortChevron,
  MolBioStarIcon,
  MolBioStrandBadge,
  resolveMenuItemIcon,
} from './components/MolBioIcons';
import type {
  LocalSequenceDbEntry,
  ReferenceDatabaseCategoryId,
} from './components/DatabaseExplorerModal';
import {
  cutSiteDisplayPosition,
  emptySiteVisibility,
  enzymeKey,
  reconcileSiteVisibility,
  sequenceRevision,
  type SiteVisibility,
} from './core/restrictionDisplay';
import { DisplayedSitesPanel, clearedChoiceCount, clearedChoicesNotice } from './components/DisplayedSitesPanel';
import { alignmentImageRefusal, alignmentImageRows, exportAlignmentImage, isAlignmentImageDocument } from './core/alignmentImage';
import type { FigureImageFormat } from './core/figureExport';
// Type only (the studio itself stays a lazy chunk): the guide a CRISPR row hands the views.
import type { CrisprGuideHighlight } from './components/PrimerAndPCRStudio';

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
/** The guided-pipeline steps whose tool is the folding panel (the engine's step ids), opened by openFoldingPanel. */
const PIPELINE_FOLDING_STEP_IDS: ReadonlySet<string> = new Set(['mrna-5prime-folding']);
/** History's former panels, each mounted by its own host (US-01M7QC8Q); they load with History's chunk. */
const loadHistoryChunk = () => import('./components/HybridToolsAndHistoryStudio');
const historyPanel = (name: 'EnzymesViewPanel' | 'FoldingPanel' | 'WorkflowsPanel' | 'SequenceAlertsPanel') =>
  React.lazy(() => loadHistoryChunk().then((m) => ({ default: m[name] })));
const EnzymesViewPanel = historyPanel('EnzymesViewPanel');
const FoldingPanel = historyPanel('FoldingPanel');
const WorkflowsPanel = historyPanel('WorkflowsPanel');
const SequenceAlertsPanel = historyPanel('SequenceAlertsPanel');
const VectorLibraryAndDesignStudio = React.lazy(() =>
  import('./components/VectorLibraryAndDesignStudio').then((m) => ({
    default: m.VectorLibraryAndDesignStudio,
  }))
);
const ProteinStudio = React.lazy(() =>
  import('./components/ProteinStudio').then((m) => ({
    default: m.ProteinStudio,
  }))
);
const GenomicsNgsAndPredictionStudio = React.lazy(() =>
  import('./components/GenomicsNgsAndPredictionStudio').then((m) => ({
    default: m.GenomicsNgsAndPredictionStudio,
  }))
);
const DatabaseExplorerView = React.lazy(() =>
  import('./components/DatabaseExplorerModal').then((m) => ({
    default: m.DatabaseExplorerView,
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
/** Libraries › Samples' files: the three the start screen offers, opened on the tab it opens them on (D0017). */
const SIDEBAR_SAMPLE_FILES: readonly { id: string; label: string; tab: ViewerTab; icon: string }[] = [
  { id: 'doc-pet28-egfp', label: 'pET-28a(+)-eGFP.gb', tab: 'sequence-view', icon: 'Plasmids & Vectors' },
  { id: 'doc-puc19', label: 'pUC19_Standard_Vector.gb', tab: 'sequence-view', icon: 'Plasmids & Vectors' },
  { id: 'doc-sanger-ab1-fwd', label: 'eGFP_Clone3_Sanger_Fwd.ab1', tab: 'sanger-contig', icon: 'Contig Assembly' },
];
/**
 * The libraries the sidebar's Libraries section lists, its header's count: Vectors (2), Features (1),
 * Samples (the Sample Project and its 3 files), and Databases (6 NCBI categories, 2 RefSeq fetches,
 * UniProt, RCSB PDB, Local BLAST Databases, Primer Database and Restriction Enzymes).
 */
const SIDEBAR_LIBRARY_ROW_COUNT = 2 + 1 + (1 + SIDEBAR_SAMPLE_FILES.length) + (6 + 2 + 5);
/** Whether the sidebar's Libraries section is open: this viewer's preference, not session data (US-01M6Q1V9). */
const LIBRARIES_OPEN_STORAGE_KEY = 'molbiocraft.sidebar.libraries-open.v1';

function loadLibrariesOpen(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LIBRARIES_OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveLibrariesOpen(open: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LIBRARIES_OPEN_STORAGE_KEY, String(open));
  } catch {
    // A sandboxed webview refuses storage; the section still opens for this launch.
  }
}

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
  /** The other documents one step changed (US-01M7DQMY AC3): undo and redo apply them with this one. */
  also?: Array<{ docId: string; prevDoc: SequenceDocument; nextDoc: SequenceDocument }>;
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
  const { codes, inosine, other } = compositionLetterKinds(c);
  return basicTmHasNoAnswer(c.length, acgt) ? tmNoAnswerSentence(codes, inosine, other) : null;
};

/** A composition's letters that are not A, C, G or T, by kind (US-01M6VFP8): `codes` is N and the other IUPAC codes. */
const compositionLetterKinds = (c: SequenceComposition) => {
  const n = c.counts.N;
  const ambiguity = c.counts.ambiguity ?? 0;
  const inosine = c.counts.inosine ?? 0;
  const other = c.counts.other ?? 0;
  return { n, ambiguity, codes: n + ambiguity, inosine, other, total: n + ambiguity + inosine + other };
};

/**
 * Statistics' note under masses weighed with letters that are not A, C, G or T, each as the mean of
 * the four (US-01M6VFP8), or null when there are none. A sequence of N and other codes alone reads the
 * sentence it read before, as the Tm reason does; otherwise the note names each kind whose count is above 0.
 */
const massesApproximateNote = (c: SequenceComposition): string | null => {
  const { n, ambiguity, codes, inosine, other, total } = compositionLetterKinds(c);
  if (total === 0) return null;
  const fmt = (k: number) => k.toLocaleString('en-US');
  if (inosine === 0 && other === 0) {
    return `Masses are approximate: ${fmt(codes)} ${codes === 1 ? 'base is' : 'bases are'} N or another IUPAC code, weighed as the mean of A, C, G and T.`;
  }
  const parts: string[] = [];
  /** The first part of N, codes and inosine names its noun, "base" or "bases"; the others do not. */
  const bases = (k: number) => (parts.length === 0 ? `${fmt(k)} ${k === 1 ? 'base is' : 'bases are'}` : `${fmt(k)} ${k === 1 ? 'is' : 'are'}`);
  if (n > 0) parts.push(`${bases(n)} N`);
  if (ambiguity > 0) parts.push(`${bases(ambiguity)} ${ambiguity === 1 ? 'another IUPAC code' : 'other IUPAC codes'}`);
  if (inosine > 0) parts.push(`${bases(inosine)} inosine (I)`);
  if (other > 0) {
    parts.push(`${fmt(other)} ${other === 1 ? 'letter is not a nucleotide code' : 'letters are not nucleotide codes'} (${(c.otherLetters ?? []).join(', ')})`);
  }
  return `Masses are approximate: ${joinedWithAnd(parts)}; each is weighed as the mean of A, C, G and T.`;
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

/**
 * The document and 1-based `{ start, end }` to hand an engine operation that reads the bases
 * `start..end` (extraction, attB flanking) for the selection `range` on `doc` (BG-01M7CG2W). A
 * selection across the origin of a circular molecule (start > end) is handed over on the
 * molecule rotated so the selection starts at base 1 - `{ 1, its length }` - so the operation
 * reads exactly its bases, the end of the molecule then its start. Any other selection is handed
 * over as it is, normalised; none (or one that is not a usable interval) gives null.
 */
export function selectionOnOwnOrigin(
  doc: SequenceDocument,
  range: { start: number; end: number } | null | undefined
): { doc: SequenceDocument; start: number; end: number } | null {
  const iv = selectionInterval(range, doc.sequence.length, doc.topology);
  if (!iv) return null;
  if (!crossesOrigin(iv)) return { doc, start: iv.start, end: iv.end };
  return { doc: setCircularOrigin(doc, iv.start), start: 1, end: intervalLength(iv, doc.sequence.length) };
}

/**
 * The result of an engine operation run on `selectionOnOwnOrigin`'s rotated molecule, with the
 * provenance of the molecule the person selected on: its own history, then the steps the operation
 * added - never the rotation, which the person did not make. `region.doc === doc` (no rotation)
 * returns `result` unchanged.
 */
function withoutRotationStep(
  result: SequenceDocument,
  doc: SequenceDocument,
  region: { doc: SequenceDocument }
): SequenceDocument {
  if (region.doc === doc) return result;
  const added = result.history.slice(region.doc.history.length).map((node) => ({
    ...node,
    parentIds: node.parentIds.map((id) => (id === region.doc.id ? doc.id : id)),
  }));
  return { ...result, history: [...doc.history, ...added] };
}

/**
 * Extract Region for the selection `range` on `doc` (none: its first 500 bases) as a new
 * document (BG-01M7CG2W). A selection across the origin of a circular molecule is extracted as its
 * bases in reading order - the end of the molecule, then its start - and the document is named,
 * described and given provenance by its own 1-based range, `start..end, across the origin`.
 */
export function extractSelectedRegionDocument(
  doc: SequenceDocument,
  range: { start: number; end: number } | null | undefined,
  nowIso: string
): SequenceDocument {
  const region = selectionOnOwnOrigin(doc, range) ?? { doc, start: 1, end: Math.min(doc.sequence.length, 500) };
  const extracted = extractRegionWithAnnotationsRust(region.doc, region.start, region.end, nowIso);
  if (region.doc === doc) return extracted;
  const iv = selectionInterval(range, doc.sequence.length, doc.topology)!;
  const unit = intervalUnit(doc.moleculeType);
  const across = `${iv.start}..${iv.end}, across the origin`;
  const kept = withoutRotationStep(extracted, doc, region);
  const step = kept.history[kept.history.length - 1];
  return {
    ...kept,
    ...crossingRegionAnnotations(doc, iv),
    id: `doc-ext-${doc.id}-${iv.start}-${iv.end}`,
    name: `${doc.name}_${iv.start}_${iv.end}`,
    accession: `MBC_EXT_${iv.start}_${iv.end}`,
    description: `Extracted region ${across} (${extracted.sequence.length} ${unit}) from ${doc.name}`,
    history: [
      ...kept.history.slice(0, -1),
      { ...step, id: `h-ext-${iv.start}-${iv.end}`, operation: `Extract Region (${across})` },
    ],
  };
}

/**
 * The features and primers of `doc` carried into the region `iv` extracts when it crosses the
 * origin (BG-01M7CG2W), in the region's coordinates (its first base is 1). Each feature keeps
 * exactly its overlap with the region - one that starts before it, ends after it, covers it whole,
 * crosses the origin itself or is joined from parts - with its strand; one whose overlap is in
 * several parts keeps them as its segments. A primer is carried when it binds wholly inside the
 * region. Computed from `doc` itself, not from a rotated copy: rotating a molecule turns a feature
 * that runs over the new origin into one spanning the whole molecule.
 */
function crossingRegionAnnotations(
  doc: SequenceDocument,
  iv: { start: number; end: number }
): Pick<SequenceDocument, 'features' | 'primers'> {
  const length = doc.sequence.length;
  const features = doc.features.flatMap((f) => {
    const parts = f.segments && f.segments.length > 1 ? f.segments : [{ start: f.start, end: f.end }];
    const within = piecesWithinInterval(parts, iv, length);
    if (within.length === 0) return [];
    const { segments: _drop, ...rest } = f;
    void _drop;
    return [{
      ...rest,
      id: `${f.id}-ext-${iv.start}`,
      start: within[0].start,
      end: within[within.length - 1].end,
      ...(within.length > 1
        ? { segments: within.map((w, i) => ({ index: i + 1, name: `${f.name} part ${i + 1}`, start: w.start, end: w.end, color: f.color })) }
        : {}),
    }];
  });
  const primers = doc.primers.flatMap((p) => {
    const lo = Math.min(p.bindStart, p.bindEnd);
    const hi = Math.max(p.bindStart, p.bindEnd);
    const within = piecesWithinInterval([{ start: lo, end: hi }], iv, length);
    if (within.length !== 1 || within[0].end - within[0].start !== hi - lo) return [];
    return [{ ...p, id: `${p.id}-ext-${iv.start}`, bindStart: within[0].start, bindEnd: within[0].end }];
  });
  return { features, primers };
}

/**
 * Add attB Sites for the selection `range` on `doc` (none: the whole sequence). A selection across
 * the origin of a circular molecule is flanked as its bases in reading order, with the provenance of
 * `doc` (no rotation step) and its own range, `start..end, across the origin`, in the description
 * and the insert's notes (BG-01M7CG2W).
 */
export function attBSelectedRegionDocument(
  doc: SequenceDocument,
  range: { start: number; end: number } | null | undefined
): SequenceDocument {
  const region = selectionOnOwnOrigin(doc, range);
  if (!region) return addAttBSitesToSequence(doc, null);
  const amplicon = addAttBSitesToSequence(region.doc, { start: region.start, end: region.end });
  if (region.doc === doc) return amplicon;
  const iv = selectionInterval(range, doc.sequence.length, doc.topology)!;
  const rotated = `(${region.start}..${region.end})`;
  const own = `(${iv.start}..${iv.end}, across the origin)`;
  const kept = withoutRotationStep(amplicon, doc, region);
  return {
    ...kept,
    description: kept.description?.split(rotated).join(own),
    features: kept.features.map((f) => (f.notes ? { ...f, notes: f.notes.split(rotated).join(own) } : f)),
  };
}

/**
 * Mask Selection / Mask Homopolymers on `doc` (BG-01M7CG2W): a selection across the origin of a
 * circular molecule is masked one side of the origin at a time - its bases from start to the end
 * of the molecule, then from base 1 to end - and the counts are the two passes' sums.
 */
export function maskActiveSelection(
  doc: SequenceDocument,
  mode: 'selection' | 'low-complexity',
  range: { start: number; end: number } | null | undefined
): ReturnType<typeof maskSequenceRegions> {
  const iv = mode === 'selection' ? selectionInterval(range, doc.sequence.length, doc.topology) : null;
  if (!iv) return maskSequenceRegions(doc, mode, range ?? null);
  const [first, second] = intervalSegments(iv, doc.sequence.length);
  const once = maskSequenceRegions(doc, mode, first);
  if (!second) return once;
  const twice = maskSequenceRegions(once.updated, mode, second);
  return {
    updated: twice.updated,
    maskedBases: once.maskedBases + twice.maskedBases,
    maskedRuns: once.maskedRuns + twice.maskedRuns,
    annotationsOmitted: once.annotationsOmitted || twice.annotationsOmitted,
  };
}

/**
 * The {@link sequenceRevision} of the molecule the restriction scan reads from `sequence`: the whole
 * molecule in its topology, or, past the scan's limit (BG-01M6RPWR), its first bases as linear: the
 * rule of the scanned view's restrictionMolecule, read here for a restored session's site choices
 * (BG-01M7DHM0), which must key on the revision that view will compute.
 */
function restrictionScanRevision(sequence: string, topology: SequenceDocument['topology']): string {
  const firstBp = restrictionScanScope(sequence.length, restrictionScannedBp(sequence.length))?.firstBp ?? 0;
  return sequenceRevision(firstBp ? sequence.slice(0, firstBp) : sequence, !firstBp && topology === 'circular' ? 'circular' : 'linear');
}

/** The Flatfile tab's record formats, as its toolbar names the one shown. */
const FLATFILE_FORMAT_NAMES = { genbank: 'GenBank', fasta: 'FASTA', embl: 'EMBL-EBI', gff3: 'GFF3 Annotations' } as const;
/**
 * The in-app items whose shortcut, while a rule disables the item, still runs its handler, which
 * refuses with the rule's reason (US-01M7DVEN): View › Zoom's Zoom In, Zoom Out and Actual Size, and
 * View › Map Layout's Split Map & Sequence and Circular Map.
 */
const RULE_REFUSED_SHORTCUT_IDS: ReadonlySet<string> = new Set(['view-zoom-in', 'view-zoom-out', 'view-zoom-100', 'view-lay-split', 'view-lay-circ',
  // US-01M6Q1CF: a studio key on a document the studio does not fit says the registry's reason (AC5).
  ...STUDIOS.map((e) => `view-studio-${e.id}`)]);

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
    | { kind: 'primer-db-binding'; primerIds?: string[] }
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
    | { kind: 'convert-genbank' }
    | null
  >(null);
  // The Primer Database as it is when a primer dialog opens (US-01M7DQMY): read once per opening,
  // so its records stay put while the dialog is open.
  const primerDbReadForDialog = useMemo(
    () =>
      operationDialog?.kind === 'saved-primers' || operationDialog?.kind === 'primer-db-binding'
        ? openPrimerDatabase().read()
        : undefined,
    [operationDialog]
  );
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
  // US-01M6Q1CF AC10: a saved operation shortcut on a key the app now uses (⌘9, ⌥⌘1-⌥⌘3) is released, and said.
  useEffect(() => {
    const released = releaseReservedOperationShortcuts();
    if (released.length === 0) return;
    setOpShortcuts(readOperationShortcuts());
    setStatusBanner(`${released.map((r) => `${OPERATION_LABELS[r.op]} (${formatShortcut(r.shortcut, IS_MAC_PLATFORM)})`).join(', ')}: MolBioCraft now uses that shortcut, so the operation's was released. Assign another in its options window.`);
  }, []);
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
  /**
   * The open Search Project panel (US-01M7DV88): its folder and the scope it opened on; `key` remounts it on each open.
   * `saved` is the saved search it was reopened to run (US-01M7DV4Y).
   */
  const [projectSearch, setProjectSearch] = useState<{ folderId: string; scope: SearchScope; key: number; saved?: ProjectSavedSearch } | null>(null);
  /** The Search Project hit Document info names (US-01M7DV78), shown only while its document is active; selectDocumentWithHistory drops it. */
  const [searchMatchShown, setSearchMatchShown] = useState<{ docId: string; hit: TextHit } | null>(null);
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
  /**
   * Split view's second pane: the id of the document it shows ('' = choose; null = none chosen yet).
   * Kept through Single Pane, so the next split shows the same document (US-01M7DVR0).
   */
  const [splitDocId, setSplitDocId] = useState<string | null>(null);
  /**
   * The second pane's own view, zoom and circular-map rotation (US-01M7DVQG), kept through Single Pane
   * as its document is. The main view's zoom (`zoomLevel`) and rotation (`mapRotationByDoc`) are apart.
   * The pane's zoom is not saved with the session.
   */
  const [splitView, setSplitView] = useState<SplitPaneView>(DEFAULT_SPLIT_PANE_VIEW);
  const [splitZoom, setSplitZoom] = useState<number>(SEQUENCE_ZOOM_DEFAULT);
  const [splitRotation, setSplitRotation] = useState<number>(0);
  /** Whether the second pane's rotate control is open: View › Rotate Circular Map… opens it while the pane is focused. */
  const [splitRotateOpen, setSplitRotateOpen] = useState(false);
  /**
   * The focused pane while the split is shown (US-01M7DV10): the one View › Zoom and View › Rotate
   * Circular Map… act on. The main pane each time a split opens; a pointer down or keyboard focus
   * inside a pane hands it focus, and folding the focused pane hands it to the other.
   */
  const [focusedPane, setFocusedPane] = useState<'main' | 'second'>('main');
  /**
   * Whether the Map Gallery of the table's checked rows takes the main view's place (US-01M7DVS2, D0192):
   * App state, not a viewer tab, so the tab behind it is the one saved, and nothing about it is saved.
   */
  const [mapGalleryOpen, setMapGalleryOpen] = useState(false);
  /** The gallery's view (US-01M7DVV8): its maps or its Compare Table, set by the entry point that opened it. */
  const [mapGalleryView, setMapGalleryView] = useState<MapGalleryView>('maps');
  /** The document split (US-01M7DVR0): Single Pane, or the second pane Side by Side or Top and Bottom. */
  const [documentSplit, setDocumentSplit] = useState<DocumentSplitOrientation>('single');
  /** The split the toggle returns to from Single Pane: the last one chosen, Side by Side the first time. */
  const lastDocumentSplitRef = useRef<Exclude<DocumentSplitOrientation, 'single'>>('side-by-side');
  /**
   * The divider between the two documents (US-01M7DVB1): the main pane's share the user chose and the
   * folded pane, kept through Single Pane, an orientation change and a swap. The host is measured apart,
   * so a smaller host clamps only the drawn ratio.
   */
  const [documentSplitSize, setDocumentSplitSize] = useState<DocumentSplitSize>(DEFAULT_DOCUMENT_SPLIT_SIZE);
  const [documentSplitHost, setDocumentSplitHost] = useState<HTMLDivElement | null>(null);
  const [documentSplitHostBox, setDocumentSplitHostBox] = useState<{ width: number; height: number } | null>(null);
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
  // The document and view the main-pane Database Explorer opened over; Back returns to them (US-01M6Q1V9).
  const [libraryReturn, setLibraryReturn] = useState<{ docId: string; tab: ViewerTab } | null>(null);
  // The sidebar's two sections: Project (open unless folded) and Libraries (this viewer's preference).
  const [projectSectionOpen, setProjectSectionOpen] = useState<boolean>(true);
  const [librariesOpen, setLibrariesOpen] = useState<boolean>(loadLibrariesOpen);
  // Databases > Primers (US-01M7DQFS): open with the element focus returns to when it closes. A
  // Search Project record hit (US-01M7DVZP) opens it, or brings the open one, to `showRecord`.
  const [primerDbWindow, setPrimerDbWindow] = useState<{ opener: HTMLElement | null; showRecord?: { id: string; nonce: number } } | null>(null);
  // The window's Import: the primer import dialog with Primer Database chosen (US-01M7DQ0X).
  const [primerDbImportOpen, setPrimerDbImportOpen] = useState(false);
  const [primerDbRefresh, setPrimerDbRefresh] = useState(0);
  /**
   * The control a Databases window returns focus to: the in-app opener is the menu bar or toolbar
   * button whose menu is open; from the native menu, it is whatever held focus.
   */
  const databaseWindowOpener = (): HTMLElement | null => {
    const trigger =
      typeof document === 'undefined'
        ? undefined
        : Array.from(document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]')).find(
            (el) => !el.closest('.desktop-menu-popup')
          );
    const active = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
    return trigger ?? (active && active !== document.body ? active : null);
  };
  const openPrimerDatabaseWindow = () => {
    setPrimerDbWindow({ opener: databaseWindowOpener() });
  };
  /** Opens the Primer Database window on a record, or brings the open one to it; selects no folder or document. */
  const openPrimerDatabaseOnRecord = (recordId: string) =>
    setPrimerDbWindow((prev) => ({
      opener: prev ? prev.opener : databaseWindowOpener(),
      showRecord: { id: recordId, nonce: (prev?.showRecord?.nonce ?? 0) + 1 },
    }));
  // Databases > Restriction Enzymes (US-01M7DVDV): open with the element focus returns to when it closes.
  // A site action (US-01M7JPSK) opens it with an intent, read once at mount: the Tools menu's never carries one.
  const [enzymeDbWindow, setEnzymeDbWindow] = useState<{ opener: HTMLElement | null; intent?: EnzymeWindowIntent } | null>(null);
  // The custom enzyme store (US-01M7DV52), read here once per write the Restriction Enzymes window
  // makes, and handed to every display scan as the active list: the catalogue, then each stored
  // definition. A store that cannot be read leaves the catalogue alone, and says so once (below);
  // storage that is unavailable gives the catalogue alone and no notice, the window naming it.
  const [enzymeDbRevision, setEnzymeDbRevision] = useState(0);
  const enzymeDbRead = useMemo(() => openEnzymeDatabase().read(), [enzymeDbRevision]);
  const activeEnzymes = useMemo(
    () => (enzymeDbRead.ok ? activeEnzymeList(enzymeDbRead.definitions) : REBASE_ENZYMES),
    [enzymeDbRead]
  );
  const enzymeDbNotice = !enzymeDbRead.ok && enzymeDbRead.error.kind !== 'unavailable' ? enzymeDbRead.error.message : null;
  // The collection the main display scan reads (US-01M7JPK6, D0163, D0168): the stored choice, or one
  // made in this run that the storage did not keep. The collections are read again on every write the
  // Restriction Enzymes window makes to them. The main display scan reads `displayScanEnzymes`, and
  // the split pane and the Enzymes view are handed the collection itself, each scanning it over its
  // own scanned length (US-01M7JX1J); digests, cloning, workflows and the studio's Lineage tab keep
  // `activeEnzymes`. A choice or
  // a collections store that cannot be read, or a chosen collection that is gone, scans every enzyme
  // and says why once (below); storage that is unavailable says nothing, as for `enzymeDbNotice`.
  const [enzymeCollectionsRevision, setEnzymeCollectionsRevision] = useState(0);
  const enzymeCollectionsRead = useMemo(() => openEnzymeCollections().read(), [enzymeCollectionsRevision]);
  const [scanChoiceRevision, setScanChoiceRevision] = useState(0);
  const storedScanChoice = useMemo(() => readEnzymeScanCollection(), [scanChoiceRevision]);
  const [unsavedScanChoice, setUnsavedScanChoice] = useState<{ collectionId: string | null } | null>(null);
  const scanCollectionChoice = useMemo((): {
    collection: { id: string; name: string; members: RestrictionEnzyme[]; notScanned: string[] } | null;
    notice: string | null;
  } => {
    if (!unsavedScanChoice && !storedScanChoice.ok) {
      const unreadable = storedScanChoice.error.kind !== 'unavailable';
      return { collection: null, notice: unreadable ? 'The collection chosen for site scans cannot be read, so every enzyme is scanned.' : null };
    }
    const chosenId = unsavedScanChoice ? unsavedScanChoice.collectionId : storedScanChoice.ok ? storedScanChoice.collectionId : null;
    if (chosenId === null) return { collection: null, notice: null };
    if (!enzymeCollectionsRead.ok) {
      const { kind, message } = enzymeCollectionsRead.error;
      return { collection: null, notice: kind === 'unavailable' ? null : `The enzyme collections cannot be read, so every enzyme is scanned. ${message}` };
    }
    const chosen = enzymeCollectionsRead.collections.find((c) => c.id === chosenId);
    if (!chosen) return { collection: null, notice: 'The collection chosen for site scans no longer exists: every enzyme is scanned.' };
    // Each member by its enzymeKey, in collection order; one the active list does not hold is named, never by its id.
    const byKey = new Map(activeEnzymes.map((e) => [enzymeKey(e), e] as const));
    const members: RestrictionEnzyme[] = [];
    const notScanned: string[] = [];
    for (const key of chosen.enzymeIds) {
      const e = byKey.get(key);
      if (e) members.push(e);
      else notScanned.push(collectionMemberLabel(key, enzymeDbRead));
    }
    return { collection: { id: chosen.id, name: chosen.name, members, notScanned }, notice: null };
  }, [unsavedScanChoice, storedScanChoice, enzymeCollectionsRead, activeEnzymes, enzymeDbRead]);
  const displayScanEnzymes = scanCollectionChoice.collection ? scanCollectionChoice.collection.members : activeEnzymes;
  /** The chooser's choice: a collection's id, or '' for All enzymes (also when a choice falls back). */
  const scanCollectionValue = scanCollectionChoice.collection?.id ?? '';
  const scanCollectionOptions = enzymeCollectionsRead.ok ? enzymeCollectionsRead.collections : [];
  const chooseScanCollection = (collectionId: string | null) => {
    const written = writeEnzymeScanCollection(collectionId);
    if (written.ok) {
      setUnsavedScanChoice(null);
      setScanChoiceRevision((n) => n + 1);
    } else {
      // Scanned for this run all the same, and said once.
      setUnsavedScanChoice({ collectionId });
      setStatusBanner('The choice of collection was not saved: the storage did not keep it.', { keep: true });
    }
  };
  const openEnzymeDatabaseWindow = () => {
    setEnzymeDbWindow({ opener: databaseWindowOpener() });
  };
  // A detected site's enzyme, by its id (US-01M7JPSK): its definition, or adding it to a collection.
  // Neither reads the document or writes it; the window's own collections store does the Add.
  const viewSiteEnzyme = (site: RestrictionCutSite) =>
    setEnzymeDbWindow({ opener: databaseWindowOpener(), intent: { view: enzymeKey(site.enzyme) } });
  const addSiteEnzymeToCollection = (site: RestrictionCutSite) =>
    setEnzymeDbWindow({ opener: databaseWindowOpener(), intent: { addToCollection: enzymeKey(site.enzyme) } });
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
  /**
   * Shows `message` in the status line for 5.2 s, or, with `keep`, until it is dismissed or replaced;
   * with `append`, after the message already shown (an edit's own confirmation is kept).
   */
  const setStatusBanner = useCallback((message: string | null, options?: { keep?: boolean; append?: boolean }): void => {
    if (statusBannerTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(statusBannerTimerRef.current);
      statusBannerTimerRef.current = null;
    }
    if (message && options?.append) setStatusBannerState((prev) => (prev && prev !== message ? `${prev} · ${message}` : message));
    else setStatusBannerState(message);
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

  const [requestedViewerTab, setRequestedViewerTab] = useState<ViewerTab>('sequence-view');
  /**
   * Puts the main view on a viewer tab and closes the Map Gallery in its place (US-01M7DVS2): the one
   * setter the studio rail, the menus (in-window and native), their shortcuts and every other command
   * that opens a tab call, so the selected tab is the panel shown. Two callers set the tab without it:
   * selecting a document (selectDocumentWithHistory), which closes the gallery only when the tab it
   * shows changes, and Map Layout with the split pane focused, where the gallery stays shown.
   */
  const setViewerTab = (tab: ViewerTab) => {
    setMapGalleryOpen(false);
    setRequestedViewerTab(tab);
  };
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
    useState<PhyloTreeAlgorithm>('Neighbor-Joining (NJ)');
  const [phyloInitialModelsView, setPhyloInitialModelsView] =
    useState<ModelsSubViewId>('best-models');
  const [phyloInitialAncestralMethod, setPhyloInitialAncestralMethod] =
    useState<AncestralInferenceMethod>('Maximum Likelihood (Empirical Bayes)');
  const [phyloCommandNonce, setPhyloCommandNonce] = useState<number>(0);
  // The tree a command opening a Phylogenetics module (phylo:* among them) opened the studio for
  // (US-01M6P2EZ, D0199); null shows the tree viewer, as opening the tab does.
  const [treeStudioFor, setTreeStudioFor] = useState<string | null>(null);

  const [cloningInitialMethod, setCloningInitialMethod] =
    useState<CloningMethodType>('Restriction Ligation');
  const [cloningInitialSubTool, setCloningInitialSubTool] =
    useState<CloningSubToolType>('gel');
  // None until a command or a record picks one, so History opens on the record's own default
  // (an Enzyme Set on its Enzymes view, every other record on its lineage).
  const [hybridInitialSubTab, setHybridInitialSubTab] =
    useState<HybridSubTabId | undefined>(undefined);
  const [hybridInitialPluginId, setHybridInitialPluginId] =
    useState<string | undefined>(undefined);
  const [genomicsInitialSubTab, setGenomicsInitialSubTab] =
    useState<GenomicsSuiteSubTab>('ngs-assembly');
  const viewerCanvasRef = useRef<HTMLDivElement | null>(null);


  const [mapLayoutMode, setMapLayoutMode] = useState<'split' | 'circular' | 'linear'>('split');
  const [zoomLevel, setZoomLevel] = useState<number>(SEQUENCE_ZOOM_DEFAULT);
  // US-01M7CCT5: the divider between the circle and the linear map in Split. Its own state, apart from
  // the inspector, explorer and split-document widths. A drag writes the frame's custom properties as
  // the pointer moves and commits the state on release (or puts the old one back on a cancel).
  const [paneSplit, setPaneSplit] = useState<PaneSplitState>(DEFAULT_PANE_SPLIT);
  const [paneSplitDragging, setPaneSplitDragging] = useState<boolean>(false);
  const paneSplitDragRef = useRef<{
    pointerId: number;
    left: number;
    width: number;
    start: PaneSplitState;
    pending: PaneSplitState;
    handle: HTMLElement;
    frame: HTMLElement;
  } | null>(null);
  // US-01M7CCRP: the Split frame, observed so a ratio restored from a session (or kept across a window
  // resize) is drawn clamped to the width the maps now have. BG-01M7CKN7: the width is kept apart from
  // `paneSplit`, which holds the ratio the user chose and is what the session saves, so a narrowing
  // clamps only what is drawn and widening again brings the chosen split back.
  const [paneSplitFrame, setPaneSplitFrame] = useState<HTMLDivElement | null>(null);
  const [paneSplitWidth, setPaneSplitWidth] = useState<number | null>(null);
  // Restoring the sequence map (⌘0, View › Actual Size, the header's % readout) returns its zoom to
  // 100% and counts up its restore key, on which the circle recentres a pan.
  const [sequenceViewRestores, setSequenceViewRestores] = useState(0);
  // View › Fit and Reset View (US-01M7DVEN) count up the linear overview's fit key, on which it fits
  // the whole molecule; the split pane has its own restore and fit keys, so each acts on one pane.
  const [sequenceOverviewFits, setSequenceOverviewFits] = useState(0);
  const [splitViewRestores, setSplitViewRestores] = useState(0);
  const [splitOverviewFits, setSplitOverviewFits] = useState(0);
  // US-01M7DVG4: the circular map's rotation is view state, held per document id (absent is 0), and
  // whether View › Rotate Circular Map…'s control is open.
  const [mapRotationByDoc, setMapRotationByDoc] = useState<Readonly<Record<string, number>>>({});
  const [rotateMapControlOpen, setRotateMapControlOpen] = useState(false);
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
  // View › Tracks' Features and Restriction Sites (US-01M7DV8W): saved with the session, shown at startup.
  const [showFeatures, setShowFeatures] = useState<boolean>(true);
  const [showRestrictionSites, setShowRestrictionSites] = useState<boolean>(true);
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

  /**
   * The CRISPR guide the views draw apart (US-01M7DVA6): the site a guide row showed, with its
   * spacer and its PAM as their own plus-strand spans (`start > end` across the origin), and the
   * document it was shown on. It is view state only - showing a guide never edits the document -
   * and it is drawn only while the selection it set is still the guide's own site, so any other
   * selection drops it rather than leaving a ribbon over bases that are no longer the guide's.
   */
  const [crisprGuideShown, setCrisprGuideShown] = useState<
    (CrisprGuideHighlight & { docId: string }) | null
  >(null);

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
    setSearchMatchShown(null);
    const targetDoc = catalogAllDocs.find((d) => d.id === docId);
    if (targetDoc) {
      setHybridInitialSubTab('lineage');
      const preferred = preferredViewerTab(targetDoc);
      const relevant = relevantViewerTabs(targetDoc, preserveMultiSelection
        ? documents.filter((d) => checkedDocIds.includes(d.id) || d.id === docId)
        : [targetDoc]);
      const pick = (current: ViewerTab) =>
        preferred !== 'sequence-view' || !relevant.includes(current) ? preferred : current;
      // A selection that changes the main view's tab closes the Map Gallery onto it; one that keeps the
      // tab leaves the gallery shown (US-01M7DVS2).
      if (mapGalleryOpen && resolveViewerTab(targetDoc, pick(requestedViewerTab)) !== viewerTab) setMapGalleryOpen(false);
      setRequestedViewerTab(pick);
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

  /** Opens the main-pane Database Explorer on `category`, remembering the document it opens over (US-01M6Q1V9). */
  const openDatabaseExplorer = (category: ReferenceDatabaseCategoryId) => {
    if (!dbExplorerCategory) {
      setLibraryReturn(sessionActive && !homeViewActive && activeDoc.id ? { docId: activeDoc.id, tab: viewerTab } : null);
    }
    setDbExplorerCategory(category);
  };

  /** Leaves the explorer; with `restore`, for the document and view it opened over, while that document is still in the project. */
  const leaveDatabaseExplorer = (restore = true) => {
    const back = libraryReturn;
    setDbExplorerCategory(null);
    setLibraryReturn(null);
    if (!restore || !back) return;
    if (back.docId !== activeDoc.id && catalogAllDocs.some((d) => d.id === back.docId) && !deletedDocIds.includes(back.docId)) {
      selectDocumentWithHistory(back.docId, false, false);
    }
    setViewerTab(back.tab);
  };

  /**
   * A Project row (a folder, Favorites, Deleted Items, All Project Files, History) chosen over the
   * explorer leaves it, and the row's own choice wins: unlike the explorer's Back, the document and
   * view it opened over are not restored on top of it, so ⌘[ then does what it does without the
   * explorer. US-01M6Q1V9 round-1 review: the Project rows never left the explorer, and Back then
   * brought back pET-28a under Favorites, a document that folder does not hold.
   */
  const leaveDatabaseExplorerForProjectRow = () => leaveDatabaseExplorer(false);

  /** Back (⌘[, the toolbar, View › Back): out of the explorer first, else to the previous document. */
  const goBack = () => {
    if (dbExplorerCategory) leaveDatabaseExplorer();
    else requireActiveSession(() => handleGoBack());
  };

  const handleGoBack = () => {
    // Out of the main-pane Database Explorer first (US-01M6Q1V9).
    if (dbExplorerCategory) {
      leaveDatabaseExplorer();
      return;
    }
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
  // Search Project reads the whole catalog (deleted documents included, for Deleted Items) and every
  // folder, hidden ones included, as projectSearch.ts's SearchContext asks - not the visible tree.
  // and the Primer Database (US-01M7DVZP), read once per store revision while the panel is open:
  // its records, or the error saying why it cannot be read.
  const projectSearchOpen = projectSearch !== null;
  const primerSearchRead = useMemo(
    () => (projectSearchOpen ? openPrimerDatabase().read() : undefined),
    [projectSearchOpen, primerDbRefresh]
  );
  const projectSearchContext = useMemo<SearchContext>(
    () => ({ documents: catalogAllDocs, folders: explorerFolders, deletedIds: deletedDocIds, favoriteIds: favoriteDocIds, primers: primerSearchRead }),
    [catalogAllDocs, explorerFolders, deletedDocIds, favoriteDocIds, primerSearchRead]
  );
  const openProjectSearch = (folderId: string, scope: SearchScope, saved?: ProjectSavedSearch) =>
    setProjectSearch((prev) => ({ folderId, scope, key: (prev?.key ?? 0) + 1, saved }));
  /**
   * Applies a table filter search (mbc.savedSearches.v1) to the document table filter, from the
   * table's own menu or from Search Project (US-01M7DV4Y). A v1 entry recorded no folder, so one not
   * for the whole project runs on the folder selected now, and says so.
   */
  const applyTableSearch = (x: SavedSearch) => {
    setTableFilter(x.quickFilter);
    setDocFilterRules(x.rules);
    setDocFilterMatchMode(x.matchMode);
    setWholeProjectSearch(x.wholeProject);
    setDocTableCollapsed(false);
    setDocFilterOpen(true);
    const folderLabel = explorerFolders.find((f) => f.id === selectedFolder)?.label ?? selectedFolder;
    setStatusBanner(x.wholeProject
      ? `Running saved search "${x.name}" across the whole project.`
      : `Running saved search "${x.name}" in ${folderLabel}: it did not record a folder, so it runs on the selected one.`);
  };
  // The panel searches a session; closing the session closes it, so the next session does not reopen it.
  useEffect(() => {
    if (!sessionActive) setProjectSearch(null);
  }, [sessionActive]);
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

  /**
   * Selects `nextFolder`; `openDocId`, a document in it, is the one it opens (else the active one if
   * in it, else its first). Returns the id of the document it opened, '' for none.
   */
  const handleSelectProjectFolder = (nextFolder: string, openDocId?: string): string => {
    setSelectedFolder(nextFolder);
    const nextDocs = getDocsForFolderView(nextFolder);
    let targetDocId = '';
    // Selection object cannot select across other folders:
    // Update activeDocId and checkedDocIds strictly scoped to the newly selected folder
    if (nextDocs.length > 0) {
      const keep = openDocId ?? activeDocId;
      const alreadyInFolder = nextDocs.some((d) => d.id === keep);
      targetDocId = alreadyInFolder ? keep : nextDocs[0].id;
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
    return targetDocId;
  };

  /**
   * Opens a Search Project hit (US-01M7DV78): selects the nearest shown folder whose view lists the
   * document, and the document in it, as one navigation step, so one Back returns, then shows the
   * hit's span in the Sequence view or its field in Document info, and returns null. When no shown
   * folder lists the document it changes nothing and returns the sentence the panel shows. Should
   * the folder still open another document, that document gets neither the hit's selection nor its
   * field, and a sentence is returned too. The panel answers a deleted or changed document itself
   * and never calls this for one.
   */
  const handleOpenSearchHit = (opening: HitOpening): string | null => {
    const doc = catalogAllDocs.find((d) => d.id === opening.documentId);
    if (!doc) return notShownInExplorer(opening.documentId);
    const folder = hitFolderId(doc, deletedIdsSet.has(doc.id), explorerFolders, hiddenFolders,
      (folderId) => getDocsForFolderView(folderId).some((d) => d.id === doc.id));
    if ('refused' in folder) return folder.refused;
    if (handleSelectProjectFolder(folder.folderId, doc.id) !== doc.id) return notShownInExplorer(doc.name);
    if (opening.selection) {
      setViewerTab('sequence-view');
      setSelectedRange(opening.selection);
    } else {
      setViewerTab('document-info');
      setSearchMatchShown(opening.field ? { docId: doc.id, hit: opening.field } : null);
    }
    return null;
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
    const searchableColIds = orderedVisibleDocColumns
      .filter((c) => c.id !== 'icon')
      .map((c) => c.id);

    const scope = wholeProjectSearch && activeDocFilterCount > 0 ? catalogNonDeletedDocs : docsInSelectedFolder;
    const baseList = scope.filter((d) => {
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

  /**
   * The one setter of the document split (US-01M7DVR0): the header chooser, View › Document Split, its
   * native items and the split toggle all call it. A split shows the pane's document as it was left;
   * the first time, another open document (or the picker's prompt when there is none).
   */
  const chooseDocumentSplit = (next: DocumentSplitOrientation) => {
    if (next !== 'single') {
      lastDocumentSplitRef.current = next;
      setSplitDocId((cur) => (cur !== null ? cur : openDocs.find((d) => d.id !== activeDoc.id)?.id ?? ''));
      // The first document starts at the main view's rotation for it, as showInSplitPane opens one (US-01M7DVQG AC3).
      if (splitDocId === null) setSplitRotation(mapRotationByDoc[openDocs.find((d) => d.id !== activeDoc.id)?.id ?? ''] ?? 0);
    } else {
      // Single Pane shows no focus, and the next split opens on the main pane with the pane's rotate control shut.
      setFocusedPane('main');
      setSplitRotateOpen(false);
    }
    setDocumentSplit(next);
  };
  // The split host's size, measured as it changes, for the ratio drawn (US-01M7DVB1); only while a
  // split is shown, as Single Pane draws no divider. Opening a split measures the host afresh.
  const documentSplitShown = documentSplit !== 'single';
  // A folded pane is not shown, so folding the focused one hands focus to the other; restoring it does not take it back.
  useEffect(() => {
    const folded = documentSplitSize.collapsed;
    if (folded && folded === focusedPane) setFocusedPane(folded === 'main' ? 'second' : 'main');
  }, [documentSplitSize.collapsed, focusedPane]);
  const mainPaneFocused = documentSplitShown && focusedPane === 'main';
  const secondPaneFocused = documentSplitShown && focusedPane === 'second';
  useEffect(() => {
    const host = documentSplitHost;
    if (!host || typeof host.getBoundingClientRect !== 'function') {
      setDocumentSplitHostBox(null);
      return;
    }
    if (!documentSplitShown) return;
    const measure = () => {
      const r = host.getBoundingClientRect();
      setDocumentSplitHostBox((prev) => (prev && prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [documentSplitHost, documentSplitShown]);
  const documentSplitDrawnRatio =
    documentSplit === 'single'
      ? documentSplitSize.ratio
      : renderedDocumentSplitRatio(
          documentSplitSize.ratio,
          documentSplitHostBox ? documentSplitExtent(documentSplit, documentSplitHostBox) : null,
          documentSplit
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
    // The studio is named, and its reason given, by the studio registry (US-01M6Q16Q).
    const availability = studioAvailability(
      studioForTab(requestedViewerTab, activeDoc, requestedViewerTab === 'genomics-ngs' ? genomicsInitialSubTab : undefined),
      activeDoc
    );
    if (!availability.ok) setStatusBanner(`${availability.reason} Select a document it applies to.`);
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
  // Leaving the Phylogenetics tab puts a tree back in its viewer (US-01M6P2EZ).
  useEffect(() => {
    if (viewerTab !== 'phylogenetics') setTreeStudioFor(null);
  }, [viewerTab]);
  // An imported tree (no rows of its own) is paired with an alignment by a 'Pair Alignment' history
  // entry; the picker offers the session's live alignments of at least two rows (US-01M6P2EZ).
  const treePairing = useMemo(() => {
    if (!activeDoc.docMetadata?.Newick || (activeDoc.alignmentMeta?.sequences?.length ?? 0) > 1) return null;
    const { doc, missingId, fewRows } = treeSourceAlignment(activeDoc, catalogNonDeletedDocs);
    const missingName = missingId === null ? null
      : catalogAllDocs.find((d) => d.id === missingId)?.name
        ?? [...activeDoc.history].reverse().find((h) => h.operation === PAIR_ALIGNMENT_OPERATION && h.parentIds[0] === missingId)
          ?.description.replace(/^Paired with alignment /, '')
        ?? missingId;
    return {
      chosenId: doc?.id ?? '',
      missingName,
      fewRowsName: fewRows?.name ?? null,
      choices: activeNonDeletedDocs.filter((d) => !isTreeDocument(d) && (d.alignmentMeta?.sequences?.length ?? 0) > 1),
    };
  }, [activeDoc, catalogNonDeletedDocs, catalogAllDocs, activeNonDeletedDocs]);
  const isProteinSequence = activeDoc.moleculeType === 'Protein';
  const hasSequenceData = hasBiologicalSequence(activeDoc);
  const isDnaSequence = activeDoc.moleculeType === 'DNA' && hasSequenceData;
  const sequenceUnit = isProteinSequence ? 'aa' : activeDoc.moleculeType === 'RNA' ? 'nt' : 'bp';
  // By the rule View › Map Layout and Rotate Circular Map… read (US-01M7DVEN): a contig summary draws no map.
  const canShowCircularMap = circularMapUnavailableReason(buildCommandDocumentContext(activeDoc) ?? activeDoc) === null;
  const effectiveMapLayoutMode = canShowCircularMap ? mapLayoutMode : 'linear';
  // Zoom and the primer / ORF / unique-cutter toggles only drive the circular
  // map; with no circular map shown they changed a readout and nothing else.
  const circularMapShown = effectiveMapLayoutMode !== 'linear';
  // US-01M7CCT5: the circle / linear divider exists only in Split; elsewhere nothing is collapsed.
  const paneSplitShown = effectiveMapLayoutMode === 'split';
  const paneSplitCollapsed = paneSplitShown ? paneSplit.collapsed : null;
  const activeMapRotation = mapRotationByDoc[activeDoc.id] ?? 0;
  /** Turns the active document's circular map; it never edits the document, its history or the undo stack. */
  const setActiveMapRotation = (rotationDeg: number) => setMainMapRotationOf(activeDoc.id, rotationDeg);
  /** Turns the main view's circular map of `docId` (a swap hands the split pane's rotation to it, US-01M7DVQG). */
  const setMainMapRotationOf = (docId: string, rotationDeg: number) => {
    setMapRotationByDoc((prev) => {
      if (rotationDeg !== 0) return { ...prev, [docId]: rotationDeg };
      if (!(docId in prev)) return prev;
      const { [docId]: _reset, ...rest } = prev;
      return rest;
    });
  };
  // The split pane's document, and its fall back to Linear Map (US-01M7DVQG): a pane in Circular Map
  // whose document cannot draw a circle - chosen, swapped in, or turned linear - is put in Linear Map,
  // by the rule View › Rotate Circular Map… reads, so that is also the view saved.
  const splitDoc = splitDocId ? catalogNonDeletedDocs.find((d) => d.id === splitDocId) ?? null : null;
  const splitCircleRefused = splitDoc ? circularMapUnavailableReason(buildCommandDocumentContext(splitDoc) ?? splitDoc) !== null : false;
  useEffect(() => {
    if (splitView === 'circular' && splitCircleRefused) setSplitView('linear');
  }, [splitView, splitCircleRefused]);
  /** Whether the second pane draws a circular map, for the map commands while it is focused (US-01M7DV10). */
  const splitPaneCircleShown = splitPaneShowsCircularMap(splitDoc, splitView);
  /** Shows `docId` in the split pane at the main view's rotation for it; the pane keeps its zoom and view. */
  const showInSplitPane = (docId: string) => {
    setSplitDocId(docId);
    setSplitRotation(mapRotationByDoc[docId] ?? 0);
  };
  // The ratio drawn: the chosen one, clamped to the frame while the maps are side by side.
  const paneSplitDrawn: PaneSplitState = { ...paneSplit, ratio: renderedPaneSplitRatio(paneSplit.ratio, paneSplitWidth) };
  /** Writes a ratio, and the pane a release would collapse, straight onto the Split frame mid-drag. */
  const showPaneSplitOnFrame = (frame: HTMLElement, ratio: number, preview: PaneSplitState['collapsed']) => {
    for (const [k, v] of Object.entries(paneSplitStyle(ratio))) frame.style.setProperty(k, v);
    if (preview) frame.setAttribute('data-collapse-preview', preview);
    else frame.removeAttribute('data-collapse-preview');
  };
  // A ratio the maps side by side cannot hold (a restored session, a narrower window) is drawn clamped
  // to the frame's width; a stacked layout draws the ratio unclamped. The frame's width is measured
  // here, and the chosen ratio in `paneSplit` is never rewritten by it (BG-01M7CKN7).
  useEffect(() => {
    const frame = paneSplitFrame;
    // A host without layout (a test's bare DOM) gives no width to clamp to.
    if (!frame || typeof frame.getBoundingClientRect !== 'function') {
      setPaneSplitWidth(null);
      return;
    }
    const measure = () => setPaneSplitWidth(frame.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [paneSplitFrame]);
  /** Ends the divider drag: a release commits where it got to, a cancel puts the old state back. */
  const finishPaneSplitDrag = (commit: boolean) => {
    const drag = paneSplitDragRef.current;
    if (!drag) return;
    paneSplitDragRef.current = null;
    const next = commit ? drag.pending : drag.start;
    try {
      if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    } catch {
      // The pointer has already gone.
    }
    // The frame shows what React will draw (a cancel's chosen ratio may not fit this width).
    showPaneSplitOnFrame(drag.frame, renderedPaneSplitRatio(next.ratio, drag.width), null);
    setPaneSplit(next);
    setPaneSplitDragging(false);
  };

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
  // The engine weighs the linear chain; a closed circle weighs one water less per strand. N, the
  // other IUPAC codes, inosine and any other letter, which Biopython will not weigh, make both masses
  // estimates, and the note names each kind (massesApproximateNote).
  const strandEnds = activeDoc.topology === 'circular' ? BIOPYTHON_WATER_DA : 0;
  const massesNote = composition ? massesApproximateNote(composition) : null;
  const massesApproximate = massesNote !== null;
  const massText = (da: number) => `${massesApproximate ? '≈ ' : ''}${(da / 1000).toFixed(1)} kDa`;

  // The status bar's selection readout is the whole selection's (BG-01M6RTHN): one engine pass,
  // about 9 ms at 1,000,000 bp and under 100 ms at 10,000,000 bp when measured. It stopped after its
  // first 12,001 bp, so a 200 kb selection read "(12001 bp | GC ...)", its GC and Tm from that slice.
  // The selection as the active-interval model reads it (BG-01M7CG2W): on a circular molecule
  // start > end crosses the origin, so its length and bases come from the model, never end - start.
  const selectionIv = useMemo(
    () => selectionInterval(selectedRange, activeDoc.sequence.length, activeDoc.topology),
    [selectedRange, activeDoc.sequence.length, activeDoc.topology]
  );
  /**
   * The guide the sequence views draw apart (US-01M7DVA6), or none: the one shown from a CRISPR row,
   * while it is still this document's and the selection is still the guide's own site. A selection
   * made anywhere else drops it, so the ribbon and the arcs never name a guide the selection left.
   */
  const guideHighlight = useMemo(
    () =>
      crisprGuideShown &&
      crisprGuideShown.docId === activeDoc.id &&
      selectedRange?.start === crisprGuideShown.site.start &&
      selectedRange?.end === crisprGuideShown.site.end
        ? crisprGuideShown
        : null,
    [crisprGuideShown, activeDoc.id, selectedRange]
  );
  const selectionComposition = useMemo(() => {
    if (!sessionActive || !selectionIv || activeDoc.moleculeType === 'Protein') return null;
    return analyzeSequenceComposition(intervalSequence(activeDoc.sequence, selectionIv));
  }, [sessionActive, activeDoc.sequence, activeDoc.moleculeType, selectionIv]);

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
  // A chosen collection (US-01M7JPK6) is named in place of the core rule: the members the bounded
  // member rule sends for the bases scanned, the built-ins it leaves out, and each member not scanned.
  // The split pane and the Enzymes view derive theirs by the same helper (US-01M7JX1J, D0169).
  const restrictionScope = useMemo<RestrictionScanScope | null>(() => {
    const length = activeDoc.sequence.length;
    return chosenRestrictionScope(length, restrictionScannedBp(length), activeEnzymes, scanCollectionChoice.collection);
  }, [activeDoc.sequence.length, activeEnzymes, scanCollectionChoice]);
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
    // The core cut follows the bases the scan reads (US-01M7DV52): a 60,000 bp slice is scanned
    // with the whole catalogue, and every custom definition is always sent. A chosen collection is
    // cut by the same rule (D0162); one with nothing that can be scanned is not sent at all.
    const scanEnzymes = restrictionScanEnzymes(displayScanEnzymes, restrictionScannedBp(activeDoc.sequence.length));
    if (scanEnzymes.length === 0) return EMPTY_RESTRICTION_SCAN;
    if (restrictionScope?.firstBp) {
      return scanRestrictionSites(activeDoc.sequence.slice(0, restrictionScope.firstBp), 'linear', scanEnzymes);
    }
    return scanRestrictionSites(activeDoc.sequence, activeDoc.topology, scanEnzymes);
  }, [
    displayScanEnzymes,
    sessionActive,
    homeViewActive,
    viewerTab,
    activeDoc.sequence,
    activeDoc.topology,
    activeDoc.moleculeType,
    restrictionScope,
  ]);
  // Why a chosen collection is not scanned, said once in the status line when a scan runs without it
  // (US-01M7JPK6): again only after the reason has gone and come back.
  const scanCollectionNotice = scanCollectionChoice.notice;
  const restrictionScanRan = restrictionScan !== EMPTY_RESTRICTION_SCAN;
  const shownScanCollectionNotice = useRef<string | null>(null);
  useEffect(() => {
    if (!scanCollectionNotice) {
      shownScanCollectionNotice.current = null;
      return;
    }
    if (!restrictionScanRan || shownScanCollectionNotice.current === scanCollectionNotice) return;
    shownScanCollectionNotice.current = scanCollectionNotice;
    setStatusBanner(scanCollectionNotice, { append: true, keep: true });
  }, [scanCollectionNotice, restrictionScanRan, setStatusBanner]);
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

  // Which scanned sites the maps are to draw (US-01M7CC7J): display state per document, keyed by
  // document id, plain data ready to keep with the session. The scanned molecule's revision keys
  // each site's choice; the shown choices are reconciled to the current scan, so a choice made
  // before an edit lands on no other site. An unscanned view reconciles nothing and writes nothing.
  const [siteVisibilityByDoc, setSiteVisibilityByDoc] = useState<Record<string, SiteVisibility>>({});
  // The revision hashes exactly the string the scan read, as it read it (the first bases of a long
  // molecule, read as linear), once per sequence version: hashing 10 Mb can take a few hundred
  // milliseconds, so it is kept until the scanned bases or topology change, never redone on a render.
  const restrictionRevisionCache = useRef<{ sequence: string; firstBp: number; topology: string; revision: string } | null>(null);
  const restrictionMolecule = useMemo(() => {
    if (restrictionScan === EMPTY_RESTRICTION_SCAN) return null;
    const firstBp = restrictionScope?.firstBp ?? 0;
    const circular = !firstBp && activeDoc.topology === 'circular';
    const topology = circular ? 'circular' : 'linear';
    const seqLen = firstBp ? Math.min(firstBp, activeDoc.sequence.length) : activeDoc.sequence.length;
    const cached = restrictionRevisionCache.current;
    if (cached && cached.sequence === activeDoc.sequence && cached.firstBp === firstBp && cached.topology === topology) {
      return { revision: cached.revision, seqLen, circular };
    }
    const revision = sequenceRevision(firstBp ? activeDoc.sequence.slice(0, firstBp) : activeDoc.sequence, topology);
    restrictionRevisionCache.current = { sequence: activeDoc.sequence, firstBp, topology, revision };
    return { revision, seqLen, circular };
  }, [restrictionScan, restrictionScope, activeDoc.sequence, activeDoc.topology]);
  const storedSiteVisibility = siteVisibilityByDoc[activeDoc.id];
  const activeSiteVisibility = useMemo(() => {
    if (!restrictionMolecule) return null;
    const stored = storedSiteVisibility ?? emptySiteVisibility(restrictionMolecule.revision);
    // The engine lists every enzyme it scanned, zero counts included: a site choice of an enzyme it
    // did not read is kept while the bases are unchanged (BG-01M7JP9Y).
    return reconcileSiteVisibility(stored, cutSites, restrictionMolecule.revision, new Set(Object.keys(restrictionSiteCounts)));
  }, [restrictionMolecule, storedSiteVisibility, cutSites, restrictionSiteCounts]);
  // An edit or rescan that clears per-site choices keeps the cleared state and says how many went,
  // in the status line (never a dialog), after the edit's own confirmation; with the bases unchanged
  // it says the scan no longer finds them, never that the sequence changed. Only a scanned view
  // reconciles, so nothing is cleared while the sites are not scanned.
  useEffect(() => {
    if (!storedSiteVisibility || !activeSiteVisibility) return;
    const cleared = clearedChoiceCount(storedSiteVisibility, activeSiteVisibility);
    const sameBases = storedSiteVisibility.revision === activeSiteVisibility.revision;
    if (cleared === 0 && sameBases) return;
    setSiteVisibilityByDoc((prev) => ({ ...prev, [activeDoc.id]: activeSiteVisibility }));
    if (cleared > 0) setStatusBanner(clearedChoicesNotice(cleared, sameBases), { append: true });
  }, [storedSiteVisibility, activeSiteVisibility, activeDoc.id, setStatusBanner]);
  // The maps draw only the displayed sites (US-01M7CCGA): they are handed the whole scan with these
  // choices and filter what they draw; every digest, fragment and cloning path keeps the whole scan.
  const mapSiteVisibility = useMemo(
    () => (restrictionMolecule && activeSiteVisibility ? { state: activeSiteVisibility, revision: restrictionMolecule.revision } : null),
    [restrictionMolecule, activeSiteVisibility]
  );
  // A visibility change only records the document's choices: it never moves the view or the selection.
  const handleSiteVisibilityChange = useCallback(
    (next: SiteVisibility) => setSiteVisibilityByDoc((prev) => ({ ...prev, [activeDoc.id]: next })),
    [activeDoc.id]
  );
  // Go to site, as a once-cutter button does: select the recognition span.
  const goToCutSite = useCallback(
    (site: RestrictionCutSite) =>
      setSelectedRange({
        start: site.position,
        end: site.position + site.enzyme.recognitionSeq.length - 1,
        label: `${enzymeLabel(site.enzyme)} cuts after ${cutSiteDisplayPosition(site.cutTop, activeDoc.sequence.length, activeDoc.topology === 'circular')}`,
      }),
    [activeDoc.sequence.length, activeDoc.topology]
  );

  // The single cutters by their complete counts (BG-01M6S1K2), in the order of their sites, each
  // counted by its enzymeKey (US-01M7DV52): a custom definition named like a built-in is its own.
  const uniqueCutters = useMemo(
    () => cutSites.filter((c) => restrictionSiteCounts[enzymeKey(c.enzyme)] === 1),
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

  /**
   * Several documents changed by one action, recorded as one undoable step (US-01M7DQMY AC3):
   * undo and redo restore or reapply every one of them together.
   */
  /** Pairs the active tree with an alignment: a 'Pair Alignment' history entry naming it (US-01M6P2EZ). */
  const pairTreeWithAlignment = (alignmentId: string) => {
    const alignment = activeNonDeletedDocs.find((d) => d.id === alignmentId);
    if (!alignment) return;
    const t = new Date().toISOString();
    handleUpdateDocument({
      ...activeDoc,
      updatedAt: t,
      history: [...activeDoc.history, {
        id: `hist-${Date.now().toString(36)}`, timestamp: t, operation: PAIR_ALIGNMENT_OPERATION,
        description: `Paired with alignment ${alignment.name}`, parentIds: [alignment.id], lengthBp: 0, topology: 'linear',
      }],
    }, PAIR_ALIGNMENT_OPERATION);
  };

  const handleUpdateDocuments = (updatedDocs: SequenceDocument[], actionLabel: string) => {
    const steps = updatedDocs.flatMap((u) => {
      const prevDoc = documents.find((d) => d.id === u.id);
      return prevDoc ? [{ docId: u.id, prevDoc, nextDoc: u }] : [];
    });
    if (!steps.length) {
      setStatusBanner(`${actionLabel}: the documents are no longer in the project.`);
      return;
    }
    const [first, ...rest] = steps;
    setUndoStack((prev) => [
      ...prev.slice(-(MAX_UNDO_STEPS - 1)),
      { ...first, label: actionLabel, ...(rest.length ? { also: rest } : {}) },
    ]);
    setRedoStack([]);
    const next = new Map(steps.map((st) => [st.docId, st.nextDoc]));
    setDocuments((prev) => prev.map((d) => next.get(d.id) ?? d));
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
    const undone = new Map([[entry.docId, entry.prevDoc], ...(entry.also ?? []).map((o) => [o.docId, o.prevDoc] as const)]);
    setDocuments((prev) => prev.map((d) => (undone.has(d.id) ? applyHistorySnapshot(d, undone.get(d.id)!) : d)));
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
    } else if (selectedRange && Math.max(selectedRange.start, selectedRange.end) > sequenceLength) {
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
    const redone = new Map([[entry.docId, entry.nextDoc], ...(entry.also ?? []).map((o) => [o.docId, o.nextDoc] as const)]);
    setDocuments((prev) => prev.map((d) => (redone.has(d.id) ? applyHistorySnapshot(d, redone.get(d.id)!) : d)));
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
    // The same bases on the mirrored molecule; an origin-crossing selection stays crossing.
    const mirroredSelection = isActiveTarget
      ? selectionInterval(selectedRange, rcSeq.length, targetDoc.topology)
      : null;
    if (selectedRange && mirroredSelection) {
      setSelectedRange({ ...selectedRange, ...reverseInterval(mirroredSelection, rcSeq.length) });
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
    // The same bases on the mirrored molecule; an origin-crossing selection stays crossing.
    const mirroredSelection = isActiveTarget
      ? selectionInterval(selectedRange, revSeq.length, targetDoc.topology)
      : null;
    if (selectedRange && mirroredSelection) {
      setSelectedRange({ ...selectedRange, ...reverseInterval(mirroredSelection, revSeq.length) });
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
  /** The Protein studio (US-01M6Q164): every route to protein tools - ProtParam, hydropathy, the 3D viewer, coils and TM - opens it. */
  const openProteinStudio = () => {
    setStudioCommandNonce((n) => n + 1);
    setViewerTab('protein-3d');
  };

  const handleExtractSelectedRegion = () => {
    const extracted = extractSelectedRegionDocument(activeDoc, selectedRange, new Date().toISOString());
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
    const featureIv = selectionInterval(range, target.sequence.length, target.topology);
    if (featureIv && crossesOrigin(featureIv)) {
      setStatusBanner('Add Feature: the selection runs across the origin; a feature is added on one side of it only. Select within the molecule, or set the origin first.');
      return;
    }
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
      openProteinStudio();
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

  /** A panel a studio hosts while shown (US-01M7QC8Q): the Enzymes view or folding, and the tab hosting it. */
  const [hostedPanel, setHostedPanel] = useState<{ kind: 'enzymes' | 'folding'; tab: ViewerTab } | null>(null);
  useEffect(() => {
    if (hostedPanel && hostedPanel.tab !== viewerTab) setHostedPanel(null);
  }, [viewerTab, hostedPanel]);
  useEffect(() => {
    setHostedPanel(null);
  }, [activeDoc.id]);
  const [pipelinesView, setPipelinesView] = useState<PipelinesView>('pipelines');

  const openHybridSubTab = (subTab: HybridSubTabId) => {
    setStudioCommandNonce((n) => n + 1);
    setHybridInitialSubTab(subTab);
    setViewerTab('history-hybrid');
  };

  /**
   * The Enzymes view: in Cloning & Gel for an Enzyme Set (D0220) or when asked from Cloning & Gel,
   * else in Sequence Map, for a DNA document (US-01M7QC8Q). Never in History.
   */
  const openEnzymesView = (forceTab?: 'cloning-gel') => {
    const enzymeSet = activeDoc.docMetadata?.['Document Type'] === 'Enzyme Set';
    if (!forceTab && !enzymeSet && activeDoc.moleculeType !== 'DNA') {
      setStatusBanner(`The Enzymes view needs a DNA sequence: "${activeDoc.name}" is a ${activeDoc.moleculeType} sequence.`);
      return;
    }
    const tab: ViewerTab = forceTab ?? (enzymeSet || viewerTab === 'cloning-gel' ? 'cloning-gel' : 'sequence-view');
    setStudioCommandNonce((n) => n + 1);
    setHostedPanel({ kind: 'enzymes', tab });
    setViewerTab(tab);
  };

  /** Folding: in Sequence Map for an RNA, in Primers & CRISPR for a DNA (US-01M7QC8Q); computed once shown. */
  const openFoldingPanel = () => {
    if (activeDoc.moleculeType !== 'RNA' && activeDoc.moleculeType !== 'DNA') {
      setStatusBanner(`Folding needs a DNA or RNA sequence: "${activeDoc.name}" is a ${activeDoc.moleculeType} sequence.`);
      return;
    }
    const tab: ViewerTab = activeDoc.moleculeType === 'RNA' ? 'sequence-view' : 'primers-pcr';
    setStudioCommandNonce((n) => n + 1);
    setHostedPanel({ kind: 'folding', tab });
    setViewerTab(tab);
  };

  /** The hosted panel, with a Close button back to its host's own tools (none for an Enzyme Set, whose only view it is). */
  const hostedPanelNode = (kind: 'enzymes' | 'folding', closable = true) => (
    <section className="mbc-hosted-panel" aria-label={kind === 'enzymes' ? 'Enzymes view' : 'Folding'}>
      {closable && (
        <div className="cloning-action-row">
          <button type="button" className="btn-secondary" onClick={() => setHostedPanel(null)}>
            Close {kind === 'enzymes' ? 'Enzymes View' : 'Folding'}
          </button>
        </div>
      )}
      <React.Suspense fallback={null}>
        {kind === 'enzymes' ? (
          <EnzymesViewPanel
            doc={activeDoc}
            enzymes={activeEnzymes}
            scanCollection={scanCollectionChoice.collection}
            collectionsRevision={enzymeCollectionsRevision}
            onCollectionsChange={() => setEnzymeCollectionsRevision((n) => n + 1)}
            allDocuments={documents}
            onUpdateDocument={handleUpdateDocument}
            commandNonce={studioCommandNonce}
            onOpenLineage={() => openHybridSubTab('lineage')}
          />
        ) : (
          <FoldingPanel doc={activeDoc} allDocuments={documents} onUpdateDocument={handleUpdateDocument} commandNonce={studioCommandNonce} />
        )}
      </React.Suspense>
    </section>
  );

  const openPluginTool = (pluginId: string) => {
    setStudioCommandNonce((n) => n + 1);
    setHybridInitialPluginId(pluginId);
    setPipelinesView('workflows');
    setViewerTab('guided-pipelines');
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
  ): boolean => {
    // A tree opens the studio only on at least two source rows (phylogenySourceDocuments: its own,
    // its paired alignment's, or a same-type selection). Returns whether the studio opened, so a
    // caller sets its own status only then and the refusal stays the one shown (BG-01M7RNMJ).
    if (activeDoc.docMetadata?.Newick) {
      if (phylogenyInputs.length < 2) {
        setStatusBanner('Pair this tree with an alignment of the same taxa first.');
        return false;
      }
      setTreeStudioFor(activeDoc.id);
    }
    setPhyloInitialTab(tab);
    if (opts?.treeAlgo) setPhyloInitialTreeAlgo(opts.treeAlgo);
    if (opts?.modelsView) setPhyloInitialModelsView(opts.modelsView);
    if (opts?.ancestralMethod) setPhyloInitialAncestralMethod(opts.ancestralMethod);
    setPhyloCommandNonce((n) => n + 1);
    setViewerTab('phylogenetics');
    return true;
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
  /** A registry command's shortcut as this OS shows it (US-01M6Q1N2): the menubar reads its keys from the registry. */
  const registryKey = (id: string) => formatCommandShortcut(registryCommand(id).shortcut, displayOs);
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
    // A session opened or restored opens no Map Gallery (US-01M7DVS2).
    setMapGalleryOpen(false);
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
    mapLayout: effectiveMapLayoutMode,
    circleCollapsed: paneSplitCollapsed === 'circular',
    focusedSplitPane: secondPaneFocused
      ? { circularMapShown: splitPaneCircleShown, sequenceMapShown: splitPaneShowsSequenceMap(splitDoc, splitView) }
      : undefined,
    checkedRecordCount: selectedInFilteredDocs.length,
    trashCount: deletedDocIds.length,
    studiosApplying: Object.fromEntries(STUDIOS.map((e) => [e.id, studioAvailability(e, doc).ok])),
  });
  const isCommandEnabled = (id: CommandId | WorkbenchCommandId | ViewCommandId, doc?: SequenceDocument): boolean =>
    commandAvailability(id, buildCommandContext(doc)).enabled;
  const commandDisabledReason = (id: CommandId | WorkbenchCommandId | ViewCommandId, doc?: SequenceDocument): string | undefined =>
    commandAvailability(id, buildCommandContext(doc)).reason;
  const ensureCommandAvailable = (
    id: CommandId | WorkbenchCommandId | ViewCommandId,
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
  /**
   * View › Tracks (US-01M7DV8W): each track's label, whether it is shown, and the one toggle its in-app
   * item and its native id call. A track its rule (trackAvailability) turns off changes nothing and
   * says why in the status bar.
   */
  const TRACK_MENU: Record<TrackId, { label: string; shown: boolean; set: (shown: boolean) => void }> = {
    features: { label: 'Features', shown: showFeatures, set: setShowFeatures },
    primers: { label: 'Primers', shown: showPrimers, set: setShowPrimers },
    'restriction-sites': { label: 'Restriction Sites', shown: showRestrictionSites, set: setShowRestrictionSites },
    orfs: { label: 'ORFs', shown: showOrfs, set: setShowOrfs },
    translation: { label: 'Translation', shown: showTranslation, set: setShowTranslation },
    'gc-graph': { label: 'GC Graph', shown: showGcGraph, set: setShowGcGraph },
    'hydropathy-graph': { label: 'Hydropathy Graph', shown: showHydropathyGraph, set: setShowHydropathyGraph },
  };
  const toggleTrack = (track: TrackId) => {
    const t = TRACK_MENU[track];
    if (!ensureCommandAvailable(`track-${track}`, t.label)) return;
    t.set(!t.shown);
  };
  /**
   * The main view's Sequence view, shown for a command that acts on it (US-01M7DVEN, US-01M7DVG4): from
   * another viewer tab, or from the Map Gallery in its place, which closes (US-01M7DVS2).
   */
  const showMainSequenceView = () => setViewerTab('sequence-view');
  /**
   * View › Rotate Circular Map… and View › Reset Rotation (US-01M7DVG4): on another viewer tab they
   * first switch to the Sequence view, as View › Map Layout's items do.
   */
  const handleRotateMapCommand = (action: 'open' | 'reset') => {
    if (!ensureCommandAvailable('rotate-map', action === 'open' ? 'Rotate Circular Map' : 'Reset Rotation')) return;
    // US-01M7DV10: with the split pane focused, they turn its map, and the main view's tab and control stay.
    if (secondPaneFocused) {
      if (action === 'open') setSplitRotateOpen(true);
      else setSplitRotation(0);
      return;
    }
    showMainSequenceView();
    if (action === 'open') setRotateMapControlOpen(true);
    else setActiveMapRotation(0);
  };

  /**
   * View › Zoom In (1), Zoom Out (-1) and Actual Size ('actual') on the focused pane (US-01M7DV10): the
   * one handler of the in-app items, the native ids, their shortcuts and the viewer header's buttons.
   */
  const zoomFocusedPane = (step: 1 | -1 | 'actual') => {
    if (!ensureCommandAvailable('zoom-map', step === 'actual' ? 'Actual Size' : step > 0 ? 'Zoom In' : 'Zoom Out')) return;
    if (secondPaneFocused) {
      setSplitZoom((z) => (step === 'actual' ? SEQUENCE_ZOOM_DEFAULT : stepSequenceZoom(z, step)));
      // Actual Size recentres the pane's circle as it does the main view's (US-01M7DVEN).
      if (step === 'actual') setSplitViewRestores((n) => n + 1);
    } else if (step === 'actual') restoreSequenceView();
    else setZoomLevel((z) => stepSequenceZoom(z, step));
  };
  // The viewer header's −, % and + zoom the focused pane's circular map, by the rule View › Zoom's
  // items and the native menu state read (US-01M7DVEN), so they are off, with its reason, where it has none.
  const headerZoomOn = isCommandEnabled('zoom-map');
  const headerZoomOffReason = commandDisabledReason('zoom-map');
  /**
   * View › Fit ('fit') and Reset View ('reset') on the focused pane (US-01M7DVEN): the one handler of
   * the in-app items and the native ids. Fit puts the circle at 100% and recentred and the linear
   * overview at the whole sequence; Reset View does Fit and, where Reset Rotation is enabled, turns
   * the map back to 0 degrees. On the main view, from another viewer tab, they first switch to the
   * Sequence view, as Rotate Circular Map… does.
   */
  const fitFocusedPane = (action: 'fit' | 'reset') => {
    if (!ensureCommandAvailable('fit-view', action === 'fit' ? 'Fit' : 'Reset View')) return;
    const turnBack = action === 'reset' && isCommandEnabled('rotate-map');
    if (secondPaneFocused) {
      setSplitZoom(SEQUENCE_ZOOM_DEFAULT);
      setSplitViewRestores((n) => n + 1);
      setSplitOverviewFits((n) => n + 1);
      if (turnBack) setSplitRotation(0);
      return;
    }
    showMainSequenceView();
    restoreSequenceView();
    setSequenceOverviewFits((n) => n + 1);
    if (turnBack) setActiveMapRotation(0);
  };
  /**
   * View › Map Layout's three items (US-01M7DVEN): the one handler of the in-app items, the native ids
   * and ⌥⌘1 / ⌥⌘2 / ⌥⌘3. Split and Circular are refused, with circularMapUnavailableReason's sentence, for
   * a document that cannot draw a circle, so the stored layout and the autosave stay as they are.
   */
  const chooseMapLayout = (mode: 'split' | 'circular' | 'linear') => {
    if (mode !== 'linear' && !ensureCommandAvailable('map-layout-circle', mode === 'split' ? 'Split Map & Sequence' : 'Circular Map')) return;
    // The main view's layout either way; with the split pane focused the Map Gallery stays (US-01M7DVS2).
    if (secondPaneFocused) setRequestedViewerTab('sequence-view');
    else showMainSequenceView();
    setMapLayoutMode(mode);
  };
  /**
   * Map Gallery (US-01M7DVS2): the table toolbar's button and View › Map Gallery, under the
   * `multi-record-view` rule over the checked rows the table shows. It takes the main view's place;
   * the split pane, its document, view, zoom, rotation and focus stay as they are. The table toolbar's
   * Compare Table and View › Compare Table (US-01M7DVV8) open it, under the same rule, on its Compare
   * Table; an open gallery moves to the view asked for.
   */
  const openMapGallery = (view: MapGalleryView = 'maps') => {
    // The toolbar buttons and the in-window items are disabled under this rule, but a native id runs its
    // item's handler whatever the item's state (menubarCommands), so this check is what refuses it, with the reason.
    if (!ensureCommandAvailable('multi-record-view', view === 'compare-table' ? 'Compare Table' : 'Map Gallery')) return;
    setMapGalleryView(view);
    setMapGalleryOpen(true);
  };
  /** A card's Open in viewer: the gallery closes onto the card's record, the checked rows kept so it reopens on the same cards. */
  const openFromMapGallery = (docId: string) => {
    setMapGalleryOpen(false);
    selectDocumentWithHistory(docId, true);
  };
  /**
   * Compare in split (US-01M7DV6R): the first chosen card opens in the main view as Open in viewer
   * does, and the second in the split pane at the main view's rotation for it, in the orientation last
   * chosen (Side by Side the first time), with the main pane focused. A folded pane, either one, is
   * unfolded at the ratio it had, so both records are shown.
   */
  const compareFromMapGallery = (mainDocId: string, paneDocId: string) => {
    openFromMapGallery(mainDocId);
    chooseDocumentSplit(lastDocumentSplitRef.current);
    setDocumentSplitSize((size) => (size.collapsed ? { ...size, collapsed: null } : size));
    // After chooseDocumentSplit, so the pane's document and rotation are these, not the split's first candidate.
    showInSplitPane(paneDocId);
    setFocusedPane('main');
  };
  /**
   * View › Restore Default Layout (US-01M7DVJ4), the in-app item's handler and the native id's: the
   * sidebar, the inspector and the document table shown, below the viewer, at the default sizes; Expand
   * Viewer off; the map divider at its default; Single Pane through its one setter, the divider half
   * each with no pane folded and the toggle opening Side by Side next; Map Layout Split, set directly,
   * as chooseMapLayout would switch the viewer tab. No zoom, rotation, document or pane view changes.
   */
  const restoreDefaultLayout = () => {
    setSidebarOpen(true);
    setRightPanelOpen(true);
    setSidebarWidthPx(DEFAULT_WORKSPACE_LAYOUT.sidebarWidthPx);
    setInspectorWidthPx(DEFAULT_WORKSPACE_LAYOUT.inspectorWidthPx);
    setDocTableHeightPx(DEFAULT_WORKSPACE_LAYOUT.docTableHeightPx);
    setDocTableWidthPx(DEFAULT_WORKSPACE_LAYOUT.docTableWidthPx);
    applyDocTableEvent({ kind: 'restore-session', saved: false });
    setWorkspaceSplitMode('top-bottom');
    setExpandedDocView(false);
    setPaneSplit(DEFAULT_PANE_SPLIT);
    chooseDocumentSplit('single');
    setDocumentSplitSize(DEFAULT_DOCUMENT_SPLIT_SIZE);
    lastDocumentSplitRef.current = 'side-by-side';
    setMapLayoutMode('split');
  };
  /**
   * The Function Info of a document-editing item while the focused split pane shows another document
   * (US-01M7DV10): it still edits the main view's, and says so; otherwise the item's own (`reason`).
   */
  const actsOnMainViewDescription = (id: string, label: string, reason: string | undefined): string | undefined => {
    if (!secondPaneFocused || !splitDoc || splitDoc.id === activeDoc.id) return reason;
    const own = resolveMenuNodeFunctionDescription(id, label, reason);
    return `${/[.!?]$/.test(own) ? own : `${own}.`} Acts on "${activeDoc.name}" in the main view.`;
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
    setViewerTab('cloning-gel');
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
        if (openPhylogeneticsModule('phylogeny', {
          treeAlgo: 'Maximum Likelihood (ML)',
        })) setStatusBanner('Started Phylogenetic Analysis session');
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

  /**
   * A studio as ⌘K and the header search list it: its registry name, once (US-01M6Q16Q). With a
   * session open it switches to the studio (the redirect explains a studio the record cannot show);
   * otherwise it starts the studio's task session where a preset exists, or says what it needs.
   */
  const STUDIO_SESSION_PRESETS: Partial<Record<StudioId, NewSessionPreset>> = {
    'sequence-map': 'sample-library', 'cloning-gel': 'cloning-restriction', vectors: 'sample-library',
    'primers-crispr': 'primers-crispr', alignment: 'align-task', phylogenetics: 'phylo-task', 'sanger-contig': 'sanger-task',
    'protein-3d': 'ngs-genomics', 'pipelines-ngs': 'sample-library',
  };
  const studioCommandItem = (entry: StudioEntry) => ({
    id: `studio-${entry.id}`,
    label: entry.name,
    category: 'Studio',
    hint: `For ${entry.needs}`,
    studio: entry.id as StudioId,
    run: () => {
      const preset = STUDIO_SESSION_PRESETS[entry.id as StudioId];
      if (!sessionActive) {
        if (!preset) {
          setStatusBanner(`${entry.name} needs ${entry.needs}: open or import one first.`);
          return;
        }
        handleStartNewSession(preset);
      }
      setHomeViewActive(false);
      if (entry.id === 'vectors') openVectorStudio('catalog');
      else if (entry.id === 'protein-3d') openProteinStudio();
      else setViewerTab(entry.opens.tab);
    },
  });

  /**
   * ⌘K's entries that are not menubar commands: the studios (each carries its View › Studios command's
   * path and key once the menubar is built), the two benchmark loaders and the colour-blind palette
   * switch, and the open documents. The menubar's commands join them below, after topMenus.
   */
  type PaletteItem = {
    id: string;
    label: string;
    category: string;
    hint: string;
    run: () => void;
    studio?: StudioId;
    commandId?: string;
    path?: string[];
    shortcut?: string;
    disabled?: boolean;
    reason?: string;
  };
  const commandPaletteExtras = useMemo(() => {
    const items: PaletteItem[] = [
      {
        id: 'bench-genome-500k',
        label: registryCommand('help-bench-genome').label,
        category: 'Help',
        hint: 'benchmark, 500 kbp',
        commandId: 'help-bench-genome',
        run: () => handleLoadBenchmarkDocument('genome-500k'),
      },
      {
        id: 'bench-protein-10k',
        label: registryCommand('help-bench-protein').label,
        category: 'Help',
        hint: 'benchmark, 10k aa',
        commandId: 'help-bench-protein',
        run: () => handleLoadBenchmarkDocument('protein-10k'),
      },
      ...STUDIOS.map((entry): PaletteItem => ({ ...studioCommandItem(entry), commandId: `view-studio-${entry.id}` })),
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
    sessionActive,
    hostOs,
  ]);


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
      paneSplit,
      documentSplit: documentSplitForSession(documentSplit, splitDocId, catalogAllDocs, documentSplitSize, { view: splitView, rotation: splitRotation }),
      siteVisibility: siteVisibilityForSession(siteVisibilityByDoc, documents),
      mapRotation: mapRotationForSession(mapRotationByDoc, documents),
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
        showFeatures,
        showRestrictionSites,
      },
    },
  });

  const latestSnapshotRef = useRef<() => MbcWorkbenchSnapshot>(buildCurrentMbcSnapshot);
  latestSnapshotRef.current = buildCurrentMbcSnapshot;

  /**
   * Show an autosave failure to the user (kept on screen, once per run of failures) instead of
   * swallowing it (BG-01M7CKYQ, LC-006); a success re-arms the notice.
   */
  const reportAutosaveResult = (result: WorkbenchAutosaveResult) => {
    const notice = autosaveFailureNoticeRef.current(result);
    // The sentence names the failure in plain words; the marker's tooltip also carries the
    // technical detail, as the log does (BG-01M7CPTZ).
    setAutosaveFailure(result.ok ? null : `${describeAutosaveFailure(result)}\n\nDetail: ${result.detail}`);
    if (!result.ok) Logger.warn('Autosave', 'Autosave failed', { reason: result.reason, detail: result.detail });
    if (notice) setStatusBanner(notice, { keep: true });
  };

  const executeConfirmedAppQuit = async (dontAskAgain: boolean) => {
    if (dontAskAgain) {
      applyConfirmBeforeQuitPreference(false);
    }
    if (sessionActive && !autosavePendingRecoveryRef.current) {
      // The autosave is asynchronous (IndexedDB); quit only once it has landed, and never
      // quit silently over unsaved work it could not keep (BG-01M7CKYQ). A write that hangs is
      // given up after QUIT_AUTOSAVE_TIMEOUT_MS, so the quit always goes on: to this guard when there
      // are unsaved changes, else to the quit itself (BG-01M7CPTZ).
      const saved = await autosaveWorkbenchWithin(latestSnapshotRef.current(), QUIT_AUTOSAVE_TIMEOUT_MS);
      const result = saved.ok ? writeWorkbenchAutosaveDirtyFlag(sessionHasUnsavedChangesRef.current) : saved;
      if (!result.ok && sessionHasUnsavedChangesRef.current) {
        setConfirmQuitModalOpen(false);
        reportAutosaveResult(result);
        setConfirmDialog({
          title: 'Quit Without Saving?',
          message: `${describeAutosaveFailure(result)} "${sessionName}" has unsaved changes that will be lost if you quit now.`,
          confirmLabel: 'Quit Without Saving',
          destructive: true,
          onConfirm: () => quitAppNow(),
          alternateLabel: 'Save Session…',
          onAlternate: () => handleExportMbcRef.current(),
        });
        return;
      }
    }
    quitAppNow();
  };

  const quitAppNow = () => {
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
        onConfirm: () => void executeConfirmedAppQuit(false),
        alternateLabel: 'Save Session…',
        onAlternate: () => handleExportMbcRef.current(),
      });
      return;
    }
    if (confirmBeforeQuit) {
      setConfirmQuitModalOpen(true);
    } else {
      void executeConfirmedAppQuit(false);
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

  // Automatically keep a local autosave draft (IndexedDB) only while a session is active.
  const autosaveFailureNoticeRef = useRef(createAutosaveFailureNotice());
  // The standing failure, shown in the status bar for as long as autosave keeps failing: the
  // one-off notice can be replaced by the next action's banner before it is read.
  const [autosaveFailure, setAutosaveFailure] = useState<string | null>(null);
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
      void autosaveWorkbench(latestSnapshotRef.current()).then((result) => {
        reportAutosaveResult(result.ok ? writeWorkbenchAutosaveDirtyFlag(sessionHasUnsavedChangesRef.current) : result);
      });
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
    paneSplit,
    documentSplit,
    splitDocId,
    documentSplitSize,
    splitView,
    splitRotation,
    siteVisibilityByDoc,
    mapRotationByDoc,
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
    showFeatures,
    showRestrictionSites,
  ]);

  const applyParsedMbcSession = (
    rawText: string,
    sourceLabel: string,
    mode: 'replace' | 'merge' = 'replace',
    options: { isAutosaveRestore?: boolean; earlierWarnings?: readonly string[] } = {}
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
    options: { isAutosaveRestore?: boolean; earlierWarnings?: readonly string[] }
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
    // An Enzyme Set's preferred tab was History before US-01M7QC8Q, so an older session with a set active
    // was saved on history-hybrid; History now draws only the lineage, so such a session reopens in
    // Cloning & Gel on its Enzymes view (D0220). Migrated here at restore only: History stays supported
    // for a set, so resolveViewerTab must not remap it or a user's click on History could never open it.
    const restoredActiveDoc = restoredDocuments.find((doc) => doc.id === restoredActiveId);
    setViewerTab(env.workspace.viewerTab === 'history-hybrid' && restoredActiveDoc?.docMetadata?.['Document Type'] === 'Enzyme Set'
      ? 'cloning-gel' : env.workspace.viewerTab);
    setMapLayoutMode(env.workspace.mapLayoutMode);
    setZoomLevel(clampSequenceZoom(env.workspace.zoomLevel));
    // Checked on the way in: a session saved before the divider, or a malformed value, opens at the default.
    setPaneSplit(parsePaneSplit(env.workspace.paneSplit));
    // The document split as saved (US-01M7DVR0), told apart by case: absent opens in Single Pane; a
    // saved document the pane can no longer show (not among the restored documents or the sample
    // library, or deleted), or a value that cannot be read, opens in Single Pane and is named once the
    // restore is announced.
    const restoredDeleted = new Set(explorer?.deletedDocIds ?? []);
    const restoredSplit = parseDocumentSplit(
      env.workspace.documentSplit,
      [...restoredDocuments, ...SAMPLE_LIBRARY].filter((d) => !restoredDeleted.has(d.id))
    );
    setDocumentSplit(restoredSplit.orientation);
    setSplitDocId(restoredSplit.docId);
    setDocumentSplitSize(restoredSplit.size);
    // The pane's view and rotation as saved with its document (US-01M7DVQG); its zoom is not saved, so
    // a restored pane opens at 100%.
    setSplitView(restoredSplit.view ?? DEFAULT_SPLIT_PANE_VIEW);
    setSplitRotation(restoredSplit.rotation ?? 0);
    setSplitZoom(SEQUENCE_ZOOM_DEFAULT);
    // A restored split opens on the main pane (US-01M7DV10).
    setFocusedPane('main');
    setSplitRotateOpen(false);
    lastDocumentSplitRef.current = restoredSplit.orientation === 'single' ? 'side-by-side' : restoredSplit.orientation;
    // Each document's displayed sites as saved (BG-01M7DHM0), malformed entries dropped and a choice
    // made on a sequence other than the restored one dropped; the App reconciles the rest with the
    // document's own scan before a map draws them.
    const restoredVisibility = restoredSiteVisibility(env.workspace.siteVisibility, restoredDocuments, (doc) =>
      restrictionScanRevision(doc.sequence, doc.topology)
    );
    setSiteVisibilityByDoc(restoredVisibility);
    // Each map's rotation as saved (US-01M7DVNS); a session saved before it opens every map at 0, and a
    // saved angle that is not a number opens its map at 0 and is named once the restore is announced.
    const restoredRotation = restoredMapRotation(env.workspace.mapRotation, restoredDocuments);
    setMapRotationByDoc(restoredRotation.byDoc);
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
    // Absent (a session saved before View › Tracks) is shown; the parser names an unreadable one.
    setShowFeatures(env.workspace.displaySettings.showFeatures ?? true);
    setShowRestrictionSites(env.workspace.displaySettings.showRestrictionSites ?? true);
    setHomeViewActive(false);
    setSessionActive(true);

    // The gzip, PKZIP and autosave routes hand in a re-serialised envelope, whose re-read verifies; the
    // sentence then carries the first read's checksum mismatch (BG-01M7RG7D), so an edited file says so.
    const sentenceWarning =
      parsed.warnings[0] ?? (options.earlierWarnings ?? []).find((w) => w.startsWith('Checksum mismatch'));
    const warnNote = sentenceWarning ? ` (${sentenceWarning})` : '';
    setStatusBanner(
      `Restored workbench "${env.sessionName}.mbc" — ${restoredDocuments.length} documents (${restoredDocuments.reduce((total, doc) => total + doc.sequence.length, 0).toLocaleString()} bp)${warnNote}`
    );
    // Hide choices that match no catalogue name and no stored custom enzyme (US-01M7GRX2), appended
    // after the restore sentence (set just above, which would overwrite an earlier append). With the
    // enzyme store unreadable or unavailable, custom keys are not checked; the keys stay as saved.
    const unmatchedNotice = unmatchedHiddenEnzymesNotice(
      unmatchedHiddenEnzymes(
        restoredVisibility,
        restoredDocuments,
        new Set(REBASE_ENZYMES.map((e) => e.name)),
        enzymeDbRead.ok ? new Set(enzymeDbRead.definitions.map((d) => d.id)) : null
      )
    );
    if (unmatchedNotice) setStatusBanner(unmatchedNotice, { append: true, keep: true });
    for (const doc of restoredRotation.unreadable) {
      setStatusBanner(unreadableMapRotationNotice(doc), { append: true, keep: true });
    }
    // An unreadable track setting (US-01M7DV8W) is named, past the one warning the restore sentence
    // carries. The autosave restore and the zipped-session open hand in their first parse's warnings,
    // since the envelope each passes here holds the setting already read as shown.
    for (const warning of new Set([...(options.earlierWarnings ?? []), ...parsed.warnings])) {
      if (warning !== parsed.warnings[0] && UNREADABLE_TRACK_SETTING_WARNINGS.includes(warning)) {
        setStatusBanner(warning, { append: true, keep: true });
      }
    }
    if (restoredSplit.notice) setStatusBanner(restoredSplit.notice, { append: true, keep: true });
    if (restoredSplit.sizeNotice) setStatusBanner(restoredSplit.sizeNotice, { append: true, keep: true });
    if (restoredSplit.viewNotice) setStatusBanner(restoredSplit.viewNotice, { append: true, keep: true });
    if (restoredSplit.rotationNotice) setStatusBanner(restoredSplit.rotationNotice, { append: true, keep: true });
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
    if (!autosavePendingRecoveryRef.current) void autosaveWorkbench(snapshot).then(reportAutosaveResult);
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
    if (!autosavePendingRecoveryRef.current) void autosaveWorkbench(snapshot).then(reportAutosaveResult);
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
    // A localStorage copy that is certainly the newest (no time, or no IndexedDB autosave recorded)
    // is restored at once. When both stores may hold one, the newer by its saved time is restored
    // (BG-01M7CPTZ), and loadWorkbenchFromLocalAutosave reads IndexedDB to decide.
    const local = readNewestLocalStorageWorkbenchAutosave();
    if (local) {
      applyAutosaveReadResult(local);
      return;
    }
    void loadWorkbenchFromLocalAutosave().then(applyAutosaveReadResult);
  };
  const applyAutosaveReadResult = (read: WorkbenchAutosaveReadResult) => {
    if (read.status === 'missing') {
      setStatusBanner('No local autosaved .mbc workbench draft found in storage.');
      return;
    }
    if (read.status === 'unreadable') {
      setStatusBanner(`Could not read the autosaved session: ${read.detail}`, { keep: true });
      return;
    }
    const cached = read.parsed;
    autosaveRestoreWasDirtyRef.current = workbenchAutosaveNeedsRecovery();
    try {
      applyParsedMbcSession(
        JSON.stringify(cached.envelope),
        cached.envelope.sessionName,
        'replace',
        { isAutosaveRestore: true, earlierWarnings: cached.warnings }
      );
    } catch (err) {
      setStatusBanner(`Could not restore the autosave: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  handleRestoreLocalAutosaveRef.current = handleRestoreLocalAutosave;
  const applyAutosaveReadResultRef = useRef(applyAutosaveReadResult);
  applyAutosaveReadResultRef.current = applyAutosaveReadResult;
  // Preferences → Files: "Continue where you left off" restores the autosave at launch.
  useEffect(() => {
    if (startupPrefs.startup !== 'restore') return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (sessionActiveRef.current || !autosavePendingRecoveryRef.current) return;
      void loadWorkbenchFromLocalAutosave().then((read) => {
        if (cancelled || sessionActiveRef.current || !autosavePendingRecoveryRef.current) return;
        // A missing autosave is not news at launch; an unreadable one is.
        if (read.status !== 'missing') applyAutosaveReadResultRef.current(read);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResetDefaultWorkbench = () => {
    guardSessionReplacement('reset the workbench', resetDefaultWorkbenchNow);
  };

  const resetDefaultWorkbenchNow = () => {
    void clearWorkbenchLocalAutosave().then((cleared) => {
      if (cleared.ok) return;
      Logger.warn('Autosave', 'The previous autosave could not be deleted', { detail: cleared.detail });
      setStatusBanner('The previous autosave could not be deleted, so it may be offered again at the next launch.', { keep: true });
    });
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

    // 1b. MolBioCraft Folder Archive (.mcb / .mbc in PKZIP format), or a gzip-compressed session
    // (.mbc / .mcb / .mbc.gz opening with 1f 8b), read from its bytes in Rust (US-01M6P2S4)
    if (lowerName.endsWith('.mcb') || lowerName.endsWith('.mbc') || lowerName.endsWith('.zip') || lowerName.endsWith('.mbc.gz')) {
      const buf = await file.arrayBuffer();
      if (isMbcZipArchiveBytes(buf)) {
        const parsedZip = parseMbcFolderZip(buf, file.name);
        // The envelope holds an unreadable track setting already read as shown; hand in the
        // warnings that named it (US-01M7DV8W), as the autosave restore does.
        applyParsedMbcSession(JSON.stringify(parsedZip.envelope), file.name, mbcMode, { earlierWarnings: parsedZip.warnings });
        return;
      }
      if (!lowerName.endsWith('.zip') && isMbcGzipBytes(buf)) {
        const parsedGz = parseMbcWorkbenchBytes(buf, file.name);
        applyParsedMbcSession(JSON.stringify(parsedGz.envelope), file.name, mbcMode, { earlierWarnings: parsedGz.warnings });
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

    // 4. 3D Macromolecular Structure (.pdb / .cif / .mmcif): one document per polymer chain the
    // engine reads (structure_chain_sequences, D0211), as Protein, DNA or RNA, its modified residues
    // read as their parents and named in its Notes, and its residues read as X (or N) in a Warnings
    // block. An ion or a water is never a chain; a polymer chain the engine skipped is named.
    if (
      lowerName.endsWith('.pdb') ||
      lowerName.endsWith('.cif') ||
      lowerName.endsWith('.mmcif')
    ) {
      const read = structureChainSequences(text);
      const skippedSentences = read.skipped.map((s) => `${stem} chain ${s.chainId} was not opened: ${s.reason}.`);
      if (read.chains.length === 0) {
        const refusal = `"${file.name}" has no protein or nucleic-acid chain to open`;
        throw new Error(skippedSentences.length ? `${refusal}. ${skippedSentences.join(' ')}` : refusal);
      }
      // A file of more than one polymer chain names each document by its chain.
      const chainIds = read.chains.map((c) => c.chainId);
      const named = read.chains.length + read.skipped.length > 1;
      const unitOf = { Protein: 'aa', DNA: 'bp', RNA: 'nt' } as const;
      const nowIso = new Date().toISOString();
      const chainDocs: SequenceDocument[] = read.chains.map((chain, chainIdx) => {
        const { chainId, molecule, sequence, firstResidueNumber, modified } = chain;
        const unit = unitOf[molecule];
        const chainName = named ? `${stem} chain ${chainId}` : stem;
        const stamp = `${Date.now().toString(36)}-${chainIdx}`;
        const modifiedNote = modified.length === 0 ? '' :
          `${modified.length} modified ${modified.length === 1 ? 'residue read as its parent' : 'residues read as their parents'}: ` +
          `${modified.map((m) => `${m.resName}${m.number}→${m.code}`).join(', ')}.`;
        // The engine's warnings each name their chain ("Residue XYZ7 in chain A ...").
        const chainWarnings = read.warnings.filter((w) => w.includes(` in chain ${chainId} `));
        const doc: SequenceDocument = {
          id: `pdb-${stem.toLowerCase()}-${chainId.toLowerCase()}-${stamp}`,
          name: chainName,
          accession: `PDB_${stem.toUpperCase().slice(0, 8)}${named ? `_${chainId}` : ''}`,
          description: `Chain ${chainId} of ${file.name} (${molecule}, ${sequence.length} residues${chainIds.length > 1 ? `; structure has chains ${chainIds.join(', ')}` : ''})`,
          moleculeType: molecule,
          topology: 'linear',
          sequence,
          folder: molecule === 'Protein' ? 'Protein Documents' : 'Local',
          docMetadata: {
            'Source Format': lowerName.endsWith('.pdb') ? 'PDB' : 'mmCIF',
            PDBText: text,
            Chain: chainId,
            'First Residue Number': firstResidueNumber,
            ...(modifiedNote ? { Notes: modifiedNote } : {}),
          },
          createdAt: nowIso,
          updatedAt: nowIso,
          features: [
            {
              id: `feat-pdb-${stamp}`,
              name: `Chain ${chainId} (residues from ${firstResidueNumber})`,
              type: 'misc_feature',
              start: 1,
              end: sequence.length,
              strand: 1,
              color: '#0d9488',
              notes: `Read ${sequence.length} polymer residues by the residue table`,
            },
          ],
          primers: [],
          history: [
            {
              id: `hist-pdb-${stamp}`,
              timestamp: nowIso.slice(0, 16).replace('T', ' '),
              operation: 'Imported 3D Structure',
              description: `Extracted ${sequence.length} ${unit} ${molecule} chain ${chainId} from ${file.name}`,
              parentIds: [],
              lengthBp: sequence.length,
              topology: 'linear',
            },
          ],
        };
        return withWarningNotes(doc, chainWarnings);
      });
      activateImportedDocumentsInWorkspace(chainDocs);
      setHomeViewActive(false);
      // The 3D view draws C-alpha atoms only, so a file whose first chain is DNA or RNA opens the Sequence view;
      // a protein chain opens the Protein studio's 3D view (US-01M6Q164).
      if (chainDocs[0].moleculeType === 'Protein') openProteinStudio();
      else setViewerTab('sequence-view');
      setStatusBanner([
        `Opened 3D structure "${file.name}" (${chainDocs.length} ${chainDocs.length === 1 ? 'chain' : 'chains'}: ${read.chains.map((c) => `${c.chainId} ${c.molecule} ${c.sequence.length} ${unitOf[c.molecule]}`).join(', ')}).`,
        ...skippedSentences,
      ].join(' '));
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
      // A GFF3 file that carries its sequences under ##FASTA opens them, each with the features
      // its seqid names; the active document is left alone (US-01M7NMB6).
      const carried = lowerName.endsWith('.gff') || lowerName.endsWith('.gff3') ? parseGff3Sequences(text) : null;
      if (carried && carried.documents.length) {
        const attached = carried.documents.reduce((n, d) => n + d.features.length, 0);
        activateImportedDocumentsInWorkspace(carried.documents, `${stem}_GFF3`);
        setHomeViewActive(false);
        setViewerTab('sequence-view');
        setStatusBanner(
          `Opened ${carried.documents.length} ${carried.documents.length === 1 ? 'sequence' : 'sequences'} from "${file.name}" with ${attached} ${attached === 1 ? 'feature' : 'features'} attached.${carried.warnings.map((w) => ` ${w}`).join('')}`
        );
        return;
      }
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
    // A drop that carries no files (a table-column drag bubbling up) is not a file drop.
    const fileList = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
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
        id: 'folder-search',
        label: 'Search Folder…',
        icon: <Search size={14} />,
        onSelect: () => requireActiveSession(() => openProjectSearch(target, initialFolderScope(target))),
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
    const { updated, maskedBases, maskedRuns, annotationsOmitted } = maskActiveSelection(activeDoc, mode, selectedRange);
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
    const oligoIv = selectionInterval(selectedRange, activeDoc.sequence.length, activeDoc.topology);
    if (oligoIv && crossesOrigin(oligoIv)) {
      setStatusBanner('Selection to Oligo: the selection runs across the origin, and a primer binds within the molecule. Select bases on one side of the origin, or set the origin first.');
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
    const amplicon = attBSelectedRegionDocument(activeDoc, selectedRange);
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
    const copyIv = selectionInterval(selectedRange, activeDoc.sequence.length, activeDoc.topology);
    const sub = copyIv ? intervalSequence(activeDoc.sequence, copyIv) : activeDoc.sequence;
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
      // US-01M6Q159: a native id runs its registry command, the in-window menubar item of that id,
      // so the native and in-window menus share one handler. The few native-only steps come first.
      const target = NATIVE_MENU_TARGETS.get(actionId);
      if (!target) {
        setStatusBanner(`The menu sent "${actionId}", which no command handles.`);
        return;
      }
      if (actionId === 'app:request-quit' || actionId === 'file:quit') {
        // Prove liveness so the backend keeps waiting for our confirmation (the window-close veto).
        ackQuitRequestTauri().catch(() => {});
      }
      if (actionId === 'edit:undo' || actionId === 'edit:redo') {
        // Native Edit › Undo/Redo: inside a text field keep standard text undo (the predefined
        // AppKit items only ever reached WKWebView's text undo manager).
        const focused = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable)) {
          document.execCommand(actionId === 'edit:undo' ? 'undo' : 'redo');
          return;
        }
      }
      if (!target.runs) {
        // A native id with no menubar item behind it.
        if (actionId === 'view:home') {
          if (sessionActive) setHomeViewActive((v) => !v);
        } else if (actionId === 'tools:primers') {
          requireActiveSession(() => openPrimersStudio('design'));
        }
        return;
      }
      const command = menubarCommands(menubarRef.current.trees, menubarRef.current.labels).find((c) => c.id === target.runs);
      if (!command) {
        setStatusBanner(`"${actionId}" runs ${target.runs}, which the menu bar does not show now.`);
        return;
      }
      command.run();
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

  // Global keyboard shortcuts for Open Workbench (.mbc) [⌘O / Ctrl+O], Save Workbench As (.mbc) [⌥⇧⌘S / Ctrl+Alt+Shift+S],
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
    } else if (key === 's' && ev.altKey && ev.shiftKey) {
      ev.preventDefault();
      requireActiveSession(() => handleSaveMbcWorkbench(true));
    } else if (key === 'f' && ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      requireActiveSession(() => handleFocusFolderFilter());
    } else if (key === 'f' && ev.shiftKey && !ev.altKey) {
      // D0017 (3): ⇧⌘F is a second key that opens ⌘K, for one release, then removed.
      ev.preventDefault();
      setCommandPaletteQuery('');
      setCommandPaletteIdx(0);
      setCommandPaletteOpen(true);
    } else if (key === 'a' && ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      requireActiveSession(() =>
        openSequenceAlignment('msa', {
          msaAlgo: 'consistency-nj',
        })
      );
    } else if (key === 'q' && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      handleRequestAppQuit();
    }
  };

  // D0017 (3), D0244: ⌥⌘S (Ctrl+Alt+S) is a second key for Save Session, shown in no menu, for one
  // release (⌘S is the menus' key, US-01M6Q1CF). It is listened for here, apart from
  // workspaceShortcutHandlerRef, so it works with the native macOS menu bar as well as the in-window one.
  const saveSessionSecondKeyRef = useRef<(ev: KeyboardEvent) => void>(() => {});
  saveSessionSecondKeyRef.current = (ev: KeyboardEvent) => {
    const primary = hostOs === 'macos' ? ev.metaKey : ev.ctrlKey;
    if (!primary || !ev.altKey || ev.shiftKey || ev.defaultPrevented || ev.repeat) return;
    if (normalisedEventKey(ev) !== 'S') return;
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (typeof document !== 'undefined' && document.querySelector('dialog[open], .mbc-modal-backdrop')) return;
    ev.preventDefault();
    requireActiveSession(() => handleSaveMbcWorkbench(false));
  };
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => saveSessionSecondKeyRef.current(ev);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  /**
   * The genomics-ngs sub-view the tab shows: the one a command or the studio's own sub-tab bar
   * (onSubTabChange, D0241) last chose, or the record's first when that one does not apply (as the
   * studio itself falls back). It decides the studio the tab belongs to, so the tab strip, the
   * inspector title and the Help topic all name the same one (D0239).
   */
  const genomicsTabs = genomicsTabsForDocument(activeDoc);
  const genomicsShownView = genomicsTabs.includes(genomicsInitialSubTab) ? genomicsInitialSubTab : genomicsTabs[0];
  /** The studio or panel the open view belongs to (US-01M6Q16Q). */
  const viewerStudio = studioForTab(viewerTab, activeDoc, genomicsShownView);
  /** The studio rail's entries: every studio and panel, the one showing marked (US-01M6Q1BD, D0242). */
  // While the main-pane Database Explorer is open the rail marks no studio current (US-01M6Q1V9).
  const studioRail = studioRailItems(activeDoc, viewerTab, genomicsShownView)
    .map((item) => (dbExplorerCategory ? { ...item, current: false } : item));
  /** A rail entry opens the view its studio opens (the genomics studios in their own sub-view); History opens on its lineage, an enzyme set on its enzymes, as the header tab did. */
  const openStudioFromRail = (entry: StudioEntry) => {
    // A studio chosen behind the Map Gallery closes it onto that studio through setViewerTab, which every branch calls (US-01M7DVS2).
    // A studio chosen over the main-pane Database Explorer leaves it for that studio (US-01M6Q1V9).
    if (dbExplorerCategory) leaveDatabaseExplorer(false);
    if (entry.id === 'history') openHybridSubTab('lineage');
    else if (entry.opens.tab === 'genomics-ngs' && entry.opens.view) openGenomicsSuite(entry.opens.view as GenomicsSuiteSubTab);
    else setViewerTab(entry.opens.tab);
  };
  /**
   * A studio key (⌘1-⌘9, View › Studios, the native view:studio-<id>; US-01M6Q1CF): with a session it
   * opens the studio as the rail does, or, when the studio does not fit the record, leaves the view
   * where it is and says the registry's reason; without one it starts the studio's task session as ⌘K does.
   */
  const openStudioByKey = (entry: StudioEntry) => {
    if (!sessionActive) {
      studioCommandItem(entry).run();
      return;
    }
    const availability = studioAvailability(entry, activeDoc);
    if (!availability.ok) {
      setStatusBanner(availability.reason);
      return;
    }
    setHomeViewActive(false);
    openStudioFromRail(entry);
  };
  /** The inspector's pane title, which its button and resizer name too: its studio's registry name (D0237, D0239). */
  const inspectorTitle = `${viewerStudio.name} Controls`;

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
        label: registryCommand('file-ns-blank').label,
        shortcut: registryKey('file-ns-blank'),
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
            label: registryCommand('file-ns-new-seq').label,
            shortcut: registryKey('file-ns-new-seq'),
            onSelect: () => handleStartNewSession('new-sequence'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-vec-cat`,
            label: registryCommand('file-ns-vec-cat').label,
            onSelect: () => handleStartNewSession('vector-catalog'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-vec-arch`,
            label: registryCommand('file-ns-vec-arch').label,
            onSelect: () => handleStartNewSession('vector-architect'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-twist`,
            label: registryCommand('file-ns-twist').label,
            onSelect: () => handleStartNewSession('twist-onboarding'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-text-doc`,
            label: registryCommand('file-ns-text-doc').label,
            onSelect: () => handleStartNewSession('text-doc'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-new-text-doc`,
            label: registryCommand('file-ns-new-text-doc').label,
            onSelect: () => handleCreateNewTextDocument(),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-new-enzyme-set`,
            label: registryCommand('file-ns-new-enzyme-set').label,
            onSelect: () => handleCreateNewEnzymeSetDocument(),
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
            label: registryCommand('file-ns-clone-rest').label,
            onSelect: () => handleStartNewSession('cloning-restriction'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-clone-asm`,
            label: registryCommand('file-ns-clone-asm').label,
            onSelect: () => handleStartNewSession('cloning-assembly'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-primers`,
            label: registryCommand('file-ns-primers').label,
            onSelect: () => handleStartNewSession('primers-crispr'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-enzymes`,
            label: registryCommand('file-ns-enzymes').label,
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
            label: registryCommand('file-ns-align').label,
            onSelect: () => handleStartNewSession('align-task'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-phylo`,
            label: registryCommand('file-ns-phylo').label,
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
            label: registryCommand('file-ns-sanger').label,
            onSelect: () => handleStartNewSession('sanger-task'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-ngs`,
            label: registryCommand('file-ns-ngs').label,
            onSelect: () => handleStartNewSession('ngs-genomics'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-pipeline`,
            label: registryCommand('file-ns-pipeline').label,
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
            label: registryCommand('file-ns-imp-files').label,
            shortcut: registryKey('file-ns-imp-files'),
            onSelect: () => handleStartNewSession('import-files'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-imp-clip`,
            label: registryCommand('file-ns-imp-clip').label,
            shortcut: registryKey('file-ns-imp-clip'),
            onSelect: () => handleStartNewSession('import-clipboard'),
          },
          {
            kind: 'command',
            id: `${idPrefix}-ns-folder`,
            label: registryCommand('file-ns-folder').label,
            shortcut: registryKey('file-ns-folder'),
            onSelect: () => handleStartNewSession('new-folder'),
          },
          { kind: 'separator', id: `${idPrefix}-ns-imp-sep` },
          {
            kind: 'command',
            id: `${idPrefix}-ns-samples`,
            label: registryCommand('file-ns-samples').label,
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
        label: registryCommand('file-imp-other-restore-backup').label,
        onSelect: () => triggerOpenMbcPicker('replace'),
      },
      {
        kind: 'command',
        id: `${idPrefix}-other-sample-docs`,
        label: registryCommand('file-imp-other-sample-docs').label,
        onSelect: () => handleImportSampleDocuments(),
      },
      {
        kind: 'command',
        id: `${idPrefix}-other-mbc-prefs`,
        label: registryCommand('file-imp-other-mbc-prefs').label,
        onSelect: () => triggerImportPreferencesPicker(),
      },
      {
        kind: 'command',
        id: `${idPrefix}-other-new-db-conn`,
        label: registryCommand('file-imp-other-new-db-conn').label,
        onSelect: () => openDatabaseExplorer('ncbi-nucleotide'),
      },
    ],
  });

  const buildImportMenuNodes = (idPrefix: string): MenuNode[] => [
    {
      kind: 'command',
      id: `${idPrefix}-direct-files`,
      label: registryCommand('file-imp-direct-files').label,
      shortcut: registryKey('file-imp-direct-files'),
      onSelect: () => triggerImportFilesPicker(),
    },
    {
      kind: 'command',
      id: `${idPrefix}-direct-folder`,
      label: registryCommand('file-imp-direct-folder').label,
      onSelect: () => triggerImportFolderPicker(),
    },
    {
      kind: 'command',
      id: `${idPrefix}-metadata`,
      label: registryCommand('file-imp-metadata').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'import-metadata' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-direct-clipboard`,
      label: registryCommand('file-imp-direct-clipboard').label,
      shortcut: registryKey('file-imp-direct-clipboard'),
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
          label: registryCommand('file-imp-gb-fasta').label,
          shortcut: registryKey('file-imp-gb-fasta'),
          onSelect: () => triggerImportFilesPicker(),
        },
        {
          kind: 'command',
          id: `${idPrefix}-clipboard`,
          label: registryCommand('file-imp-clipboard').label,
          shortcut: registryKey('file-imp-clipboard'),
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
          label: registryCommand('file-imp-sanger').label,
          onSelect: () => {
            setHomeViewActive(false);
            handleStartNewSession('sanger-task');
          },
        },
        {
          kind: 'command',
          id: `${idPrefix}-ngs`,
          label: registryCommand('file-imp-ngs').label,
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
          label: registryCommand('file-imp-vec-cat').label,
          onSelect: () => {
            setHomeViewActive(false);
            handleStartNewSession('vector-catalog');
          },
        },
        {
          kind: 'command',
          id: `${idPrefix}-twist`,
          label: registryCommand('file-imp-twist').label,
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
          label: registryCommand('file-imp-ncbi-uniprot').label,
          onSelect: () => openDatabaseExplorer('ncbi-nucleotide'),
        },
        {
          kind: 'command',
          id: `${idPrefix}-primer-database`,
          label: registryCommand('file-imp-primer-database').label,
          onSelect: () => openPrimerDatabaseWindow(),
        },
        {
          kind: 'command',
          id: `${idPrefix}-enzyme-database`,
          label: registryCommand('file-imp-enzyme-database').label,
          onSelect: () => openEnzymeDatabaseWindow(),
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
          label: registryCommand('file-imp-merge-mbc').label,
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
          label: registryCommand('file-imp-prefs-json').label,
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
      label: registryCommand('top-align-msa-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'align' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-pairwise-dialog`,
      label: registryCommand('top-align-pairwise-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'pairwise' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-structures-dialog`,
      label: registryCommand('top-align-structures-dialog').label,
      disabled: !isCommandEnabled('align-structures'),
      description: commandDisabledReason('align-structures'),
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'align-structures' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-read-qc`,
      label: registryCommand('top-align-read-qc').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'read-qc' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-merge-pairs`,
      label: registryCommand('top-align-merge-pairs').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'merge-pairs' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-trim-dialog`,
      label: registryCommand('top-align-trim-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'trim' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-denovo-dialog`,
      label: registryCommand('top-align-denovo-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'denovo' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-map-dialog`,
      label: registryCommand('top-align-map-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'map' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-expression-levels-dialog`,
      label: registryCommand('top-align-expression-levels-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'expression-levels' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-structural-variants-dialog`,
      label: registryCommand('top-align-structural-variants-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'structural-variants' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-translation-dialog`,
      label: registryCommand('top-align-translation-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'transalign' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-highlight-sites`,
      label: registryCommand('top-align-highlight-sites').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'highlight-sites' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-add-to-alignment`,
      label: registryCommand('top-align-add-to-alignment').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'add-to-alignment' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-mask-dialog`,
      label: registryCommand('top-align-mask-dialog').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'mask' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-consensus-dialog`,
      label: registryCommand('top-align-consensus-dialog').label,
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
          label: registryCommand('top-align-msa-mafft').label,
          shortcut: registryKey('top-align-msa-mafft'),
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
          label: registryCommand('top-align-msa-clustalo').label,
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
          label: registryCommand('top-align-msa-muscle').label,
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
          label: registryCommand('top-align-pairwise-nw').label,
          onSelect: () =>
            requireActiveSession(() =>
              openSequenceAlignment('pairwise', { pairwiseAlgo: 'nw' })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-pairwise-sw`,
          label: registryCommand('top-align-pairwise-sw').label,
          onSelect: () =>
            requireActiveSession(() =>
              openSequenceAlignment('pairwise', { pairwiseAlgo: 'sw' })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-dotplot`,
          label: registryCommand('top-align-dotplot').label,
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
          label: registryCommand('top-align-map-ref').label,
          onSelect: () =>
            requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-denovo`,
          label: registryCommand('top-align-denovo').label,
          onSelect: () =>
            requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-sanger-contig`,
          label: registryCommand('top-align-sanger-contig').label,
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
          label: registryCommand('top-align-whole-genome').label,
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
          label: registryCommand('top-align-gen-consensus').label,
          onSelect: () =>
            requireActiveSession(() => handleGenerateConsensusFromSelected()),
        },
        {
          kind: 'command',
          id: `${idPrefix}-concat`,
          label: registryCommand('top-align-concat').label,
          onSelect: () =>
            requireActiveSession(() => handleConcatenateSelectedSequences()),
        },
        {
          kind: 'command',
          id: `${idPrefix}-mask-lowcomp`,
          label: registryCommand('top-align-mask-lowcomp').label,
          onSelect: () =>
            requireActiveSession(() => handleMaskActiveSequence('low-complexity')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-export-consensus`,
          label: registryCommand('top-align-export-consensus').label,
          onSelect: () =>
            requireActiveSession(() => handleExportConsensusFasta()),
        },
        {
          kind: 'command',
          id: `${idPrefix}-haplotype-partitioner`,
          label: registryCommand('top-align-haplotype-partitioner').label,
          onSelect: () =>
            requireActiveSession(() => openPluginTool('plugin-haplotype-partitioner')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-ext-cli-suite`,
          label: registryCommand('top-align-ext-cli-suite').label,
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
      label: registryCommand('top-phylo-build-tree').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'tree' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-compute-distances`,
      label: registryCommand('top-phylo-compute-distances').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'compute-distances' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-timetree`,
      label: registryCommand('top-phylo-timetree').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'timetree' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-condense-tree`,
      label: registryCommand('top-phylo-condense-tree').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'condense-tree' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-gene-dups`,
      label: registryCommand('top-phylo-gene-dups').label,
      disabled: !sessionActive,
      onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'gene-duplications' })),
    },
    {
      kind: 'command',
      id: `${idPrefix}-consensus-tree`,
      label: registryCommand('top-phylo-consensus-tree').label,
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
          label: registryCommand('top-phylo-tree-ml').label,
          shortcut: registryKey('top-phylo-tree-ml'),
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'tree', method: 'Maximum Likelihood (ML)' })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-fasttree`,
          label: registryCommand('top-phylo-tree-fasttree').label,
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
          label: registryCommand('top-phylo-tree-phyml').label,
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
          label: registryCommand('top-phylo-tree-raxml').label,
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
          label: registryCommand('top-phylo-tree-mrbayes').label,
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
          label: registryCommand('top-phylo-tree-nj').label,
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
          label: registryCommand('top-phylo-tree-me').label,
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'tree', method: 'Minimum-Evolution (ME)' })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-tree-upgma`,
          label: registryCommand('top-phylo-tree-upgma').label,
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
          label: registryCommand('top-phylo-tree-mp').label,
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
          label: registryCommand('top-phylo-usertree').label,
          onSelect: () =>
            requireActiveSession(() => openPhylogeneticsModule('usertree')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-ancestors-ml`,
          label: registryCommand('top-phylo-ancestors-ml').label,
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'ancestors', initial: { method: 'ml' } })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-ancestors-mp`,
          label: registryCommand('top-phylo-ancestors-mp').label,
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
          label: registryCommand('top-phylo-models-best').label,
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'best' } })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-models-matrix`,
          label: registryCommand('top-phylo-models-matrix').label,
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'matrix' } })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-models-disparity`,
          label: registryCommand('top-phylo-models-disparity').label,
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
          label: registryCommand('top-phylo-data').label,
          onSelect: () =>
            requireActiveSession(() => openPhylogeneticsModule('data')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-models-composition`,
          label: registryCommand('top-phylo-models-composition').label,
          onSelect: () =>
            requireActiveSession(() =>
              setOperationDialog({ kind: 'evo', analysis: 'models', initial: { analysis: 'composition' } })
            ),
        },
        {
          kind: 'command',
          id: `${idPrefix}-models-rscu`,
          label: registryCommand('top-phylo-models-rscu').label,
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
          label: registryCommand('top-phylo-distance').label,
          onSelect: () =>
            requireActiveSession(() => openPhylogeneticsModule('distance')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-diversity`,
          label: registryCommand('top-phylo-diversity').label,
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
          label: registryCommand('top-phylo-selection').label,
          onSelect: () =>
            requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'selection' })),
        },
        {
          kind: 'command',
          id: `${idPrefix}-rates`,
          label: registryCommand('top-phylo-rates').label,
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
          label: registryCommand('top-phylo-clocks').label,
          onSelect: () =>
            requireActiveSession(() => setOperationDialog({ kind: 'evo', analysis: 'clocks' })),
        },
        {
          kind: 'command',
          id: `${idPrefix}-diagnose`,
          label: registryCommand('top-phylo-diagnose').label,
          onSelect: () =>
            requireActiveSession(() => openPhylogeneticsModule('diagnose')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-species-delim`,
          label: registryCommand('top-phylo-species-delim').label,
          onSelect: () =>
            requireActiveSession(() => openPluginTool('plugin-species-delimitation')),
        },
        {
          kind: 'command',
          id: `${idPrefix}-hpc-phylo-job`,
          label: registryCommand('top-phylo-hpc-phylo-job').label,
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
            label: registryCommand('app-about-modal').label,
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
            label: registryCommand('app-prefs-open').label,
            shortcut: registryKey('app-prefs-open'),
            onSelect: () => setPrefsModalTab('General'),
          },
          {
            kind: 'command',
            id: 'app-theme-toggle',
            label: `${darkMode ? 'Light' : 'Dark'} Appearance`,
            shortcut: registryKey('app-theme-toggle'),
            onSelect: () => handleQuickThemeToggle(),
          },
        ],
      },
      { kind: 'separator', id: 'app-quit-sep' },
      {
        kind: 'command',
        id: 'app-quit-cmd',
        label: registryCommand('app-quit-cmd').label,
        shortcut: registryKey('app-quit-cmd'),
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
            label: registryCommand('file-open-mbc').label,
            shortcut: registryKey('file-open-mbc'),
            onSelect: () => triggerOpenMbcPicker('replace'),
          },
          {
            kind: 'command',
            id: 'file-merge-mbc',
            label: registryCommand('file-merge-mbc').label,
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => triggerOpenMbcPicker('merge')),
          },
          { kind: 'separator', id: 'file-open-sep' },
          {
            kind: 'command',
            id: 'file-restore-auto',
            label: registryCommand('file-restore-auto').label,
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
            label: registryCommand('file-save-mbc').label,
            shortcut: registryKey('file-save-mbc'),
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(false)),
          },
          {
            kind: 'command',
            id: 'file-save-mbc-as',
            label: registryCommand('file-save-mbc-as').label,
            shortcut: registryKey('file-save-mbc-as'),
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(true)),
          },
          { kind: 'separator', id: 'file-close-sep' },
          {
            kind: 'command',
            id: 'file-close-session',
            label: registryCommand('file-close-session').label,
            shortcut: registryKey('file-close-session'),
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
            label: registryCommand('file-rename-folder').label,
            onSelect: () => requireActiveSession(() => handleRenameSelectedFolder()),
          },
          {
            kind: 'command',
            id: 'file-folder-color',
            label: registryCommand('file-folder-color').label,
            onSelect: () => requireActiveSession(() => handleCycleSelectedFolderColor()),
          },
          {
            kind: 'command',
            id: 'file-move-folder',
            label: registryCommand('file-move-folder').label,
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
            label: registryCommand('file-toggle-fav').label,
            onSelect: () => requireActiveSession(() => handleToggleFavoriteDocs()),
          },
          { kind: 'separator', id: 'file-trash-sep' },
          {
            kind: 'command',
            id: 'file-soft-delete',
            label: registryCommand('file-soft-delete').label,
            onSelect: () => requireActiveSession(() => handleSoftDeleteSelectedDocs()),
          },
          {
            kind: 'command',
            id: 'file-put-back',
            label: registryCommand('file-put-back').label,
            disabled: !isCommandEnabled('trash-items'),
            onSelect: () => requireActiveSession(() => handleRestoreFromDeletedItems()),
          },
          {
            kind: 'command',
            id: 'file-erase-all',
            label: registryCommand('file-erase-all').label,
            disabled: !isCommandEnabled('trash-items'),
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
            label: registryCommand('file-backup-mbc').label,
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleSaveMbcWorkbench(true)),
          },
          {
            kind: 'command',
            id: 'file-restore-backup-mbc',
            label: registryCommand('file-restore-backup-mbc').label,
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
            label: registryCommand('file-import-prefs').label,
            onSelect: () => triggerImportPreferencesPicker(),
          },
          {
            kind: 'command',
            id: 'file-export-prefs',
            label: registryCommand('file-export-prefs').label,
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
        children: [
          {
            kind: 'command',
            id: 'file-exp-gb',
            label: registryCommand('file-exp-gb').label,
            shortcut: registryKey('file-exp-gb'),
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('genbank')
              ),
          },
          {
            kind: 'command',
            id: 'file-exp-fasta',
            label: registryCommand('file-exp-fasta').label,
            shortcut: registryKey('file-exp-fasta'),
            disabled: !isCommandEnabled('export-sequence'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('fasta')
              ),
          },
          {
            kind: 'command',
            id: 'file-exp-embl',
            label: registryCommand('file-exp-embl').label,
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('embl')
              ),
          },
          {
            kind: 'command',
            id: 'file-exp-gff3',
            label: registryCommand('file-exp-gff3').label,
            disabled: !isCommandEnabled('export-active-document'),
            onSelect: () =>
              requireActiveSession(() =>
                handleExportActiveDocument('gff3')
              ),
          },
          {
            kind: 'command',
            id: 'file-exp-convert-genbank',
            label: registryCommand('file-exp-convert-genbank').label,
            onSelect: () => setOperationDialog({ kind: 'convert-genbank' }),
          },
          {
            kind: 'command',
            id: 'file-exp-ncbi-tbl',
            label: registryCommand('file-exp-ncbi-tbl').label,
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('transform-submit')),
          },
          // Offered only while an alignment is the active document (US-01M6S8C5).
          ...(sessionActive && isAlignmentImageDocument(activeDoc)
            ? [{
                kind: 'submenu' as const,
                id: 'file-exp-aln-img',
                label: 'Alignment Image',
                description: 'The whole alignment, in blocks of 60 columns under a position ruler, with names, identities and the consensus',
                minWidth: 215,
                children: ([['svg', 'SVG Vector'], ['png', 'PNG Image'], ['pdf', 'PDF Document']] as const).map(([format, label]) => ({
                  kind: 'command' as const,
                  id: `file-exp-aln-img-${format}`,
                  label,
                  description: `Save the whole alignment as a ${format.toUpperCase()} figure`,
                  onSelect: () => requireActiveSession(() => handleExportAlignmentImage(format)),
                })),
              }]
            : []),
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
            label: registryCommand('file-exp-sel-fasta').label,
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('selected', 'fasta')),
          },
          {
            kind: 'command',
            id: 'file-exp-sel-fastastq',
            label: registryCommand('file-exp-sel-fastastq').label,
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('selected', 'fastq')),
          },
          {
            kind: 'command',
            id: 'file-exp-mbc-json',
            label: registryCommand('file-exp-mbc-json').label,
            onSelect: () => requireActiveSession(() => handleExportMbcJson()),
          },
          {
            kind: 'command',
            id: 'file-exp-folder-mbc',
            label: registryCommand('file-exp-folder-mbc').label,
            onSelect: () => requireActiveSession(() => handleExportFolderMbc()),
          },
          {
            kind: 'command',
            id: 'file-exp-folder-gb',
            label: registryCommand('file-exp-folder-gb').label,
            onSelect: () =>
              requireActiveSession(() => handleExportBatchDocuments('folder', 'gb')),
          },
          {
            kind: 'command',
            id: 'file-exp-lineage-gb',
            label: registryCommand('file-exp-lineage-gb').label,
            onSelect: () => requireActiveSession(() => handleExportLineageBundle()),
          },
          {
            kind: 'command',
            id: 'file-exp-consensus-fa',
            label: registryCommand('file-exp-consensus-fa').label,
            onSelect: () =>
              requireActiveSession(() => handleExportConsensusFasta()),
          },
          {
            kind: 'command',
            id: 'file-exp-svg-img',
            label: registryCommand('file-exp-svg-img').label,
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
            label: registryCommand('file-print-cmd').label,
            shortcut: registryKey('file-print-cmd'),
            onSelect: () => requireActiveSession(() => handlePrintWorkbench()),
          },
        ],
      },
      { kind: 'separator', id: 'file-quit-sep' },
      {
        kind: 'command',
        id: 'file-quit-cmd',
        label: registryCommand('file-quit-cmd').label,
        shortcut: registryKey('file-quit-cmd'),
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
        shortcut: registryKey('edit-undo-cmd'),
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
        shortcut: registryKey('edit-redo-cmd'),
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
            label: registryCommand('edit-copy-seq').label,
            shortcut: registryKey('edit-copy-seq'),
            disabled: !isCommandEnabled('export-sequence'),
            onSelect: () =>
requireActiveSession(() => handleCopySequenceToClipboard()),
          },
          {
            kind: 'command',
            id: 'edit-sel-all',
            label: registryCommand('edit-sel-all').label,
            shortcut: registryKey('edit-sel-all'),
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
            label: registryCommand('edit-find-doc').label,
            shortcut: registryKey('edit-find-doc'),
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
            label: registryCommand('edit-next-feat').label,
            shortcut: registryKey('edit-next-feat'),
            onSelect: () => requireActiveSession(() => handleSelectNextFeature()),
          },
          {
            kind: 'command',
            id: 'edit-find-dups',
            label: registryCommand('edit-find-dups').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'duplicates' })),
          },
          {
            kind: 'command',
            id: 'edit-batch-rename',
            label: registryCommand('edit-batch-rename').label,
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
            label: registryCommand('view-back').label,
            shortcut: registryKey('view-back'),
            onSelect: goBack,
          },
          {
            kind: 'command',
            id: 'view-fwd',
            label: registryCommand('view-fwd').label,
            shortcut: registryKey('view-fwd'),
            onSelect: () => requireActiveSession(() => handleGoForward()),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'view-search-filter-sub',
        label: 'Search & Filter',
        // Command Palette works with no session (⌘K opens it then), so the submenu stays open (D0262).
        minWidth: 215,
        children: [
          {
            kind: 'command',
            id: 'view-filter-folder',
            label: registryCommand('view-filter-folder').label,
            shortcut: registryKey('view-filter-folder'),
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() => handleFocusFolderFilter()),
          },
          {
            kind: 'command',
            id: 'view-search-tools',
            label: registryCommand('view-search-tools').label,
            // Shown, not bound: the ⌘K listener is the one binding (D0255 (2)).
            shortcutHint: registryKey('view-search-tools'),
            onSelect: () => {
              setCommandPaletteQuery('');
              setCommandPaletteIdx(0);
              setCommandPaletteOpen(true);
            },
          },
          {
            kind: 'command',
            id: 'view-search-project',
            label: registryCommand('view-search-project').label,
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => openProjectSearch(PROJECT_ROOT, 'Entire project')),
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
            label: registryCommand('view-tog-sidebar').label,
            checked: sessionActive && sidebarOpen,
            onToggle: () => requireActiveSession(() => setSidebarOpen((v) => !v)),
          },
          {
            kind: 'checkbox',
            id: 'view-tog-doctable',
            label: registryCommand('view-tog-doctable').label,
            checked: sessionActive && !docTableCollapsed,
            onToggle: toggleDocumentTable,
          },
          {
            kind: 'checkbox',
            id: 'view-tog-inspector',
            label: registryCommand('view-tog-inspector').label,
            // Checked while an inspector is shown; greyed on a tab with nothing to set.
            checked: inspectorVisible,
            disabled: !inspectorAvailable,
            shortcut: registryKey('view-tog-inspector'),
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
            label: registryCommand('view-split-tb').label,
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
            label: registryCommand('view-split-lr').label,
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
            label: registryCommand('view-expand-doc').label,
            checked: sessionActive && expandedDocView,
            shortcut: registryKey('view-expand-doc'),
            onToggle: () => requireActiveSession(() => handleToggleExpandDocumentView()),
          },
        ],
      },
      {
        // US-01M7DVR0: the second document's pane, beside or below the viewer; the chooser's choices.
        kind: 'submenu',
        id: 'view-docsplit-sub',
        label: 'Document Split',
        disabled: !sessionActive,
        minWidth: 200,
        children: [
          {
            kind: 'checkbox',
            id: 'view-docsplit-single',
            label: registryCommand('view-docsplit-single').label,
            checked: sessionActive && documentSplit === 'single',
            onToggle: () => requireActiveSession(() => chooseDocumentSplit('single')),
          },
          {
            kind: 'checkbox',
            id: 'view-docsplit-side',
            label: registryCommand('view-docsplit-side').label,
            checked: sessionActive && documentSplit === 'side-by-side',
            onToggle: () => requireActiveSession(() => chooseDocumentSplit('side-by-side')),
          },
          {
            kind: 'checkbox',
            id: 'view-docsplit-stacked',
            label: registryCommand('view-docsplit-stacked').label,
            checked: sessionActive && documentSplit === 'top-bottom',
            onToggle: () => requireActiveSession(() => chooseDocumentSplit('top-bottom')),
          },
        ],
      },
      {
        // US-01M7DVS2: the checked rows' maps, under the rule the table toolbar's button reads.
        kind: 'command',
        id: 'view-map-gallery',
        label: registryCommand('view-map-gallery').label,
        disabled: !isCommandEnabled('multi-record-view'),
        description: commandDisabledReason('multi-record-view'),
        onSelect: () => requireActiveSession(() => openMapGallery('maps')),
      },
      {
        // US-01M7DVV8: the checked rows side by side in the gallery's Compare Table, under the same rule.
        kind: 'command',
        id: 'view-compare-table',
        label: registryCommand('view-compare-table').label,
        disabled: !isCommandEnabled('multi-record-view'),
        description: commandDisabledReason('multi-record-view'),
        onSelect: () => requireActiveSession(() => openMapGallery('compare-table')),
      },
      {
        kind: 'submenu',
        id: 'view-table-cols-sub',
        label: 'Table Columns',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          ...(Object.keys(DOC_TABLE_COLUMN_PRESETS) as DocTableColumnPresetId[]).map(
            (presetId): MenuNode => ({
              kind: 'command',
              id: `view-cols-preset-${presetId}`,
              label: DOC_TABLE_COLUMN_PRESETS[presetId].label,
              onSelect: () => requireActiveSession(() => handleApplyColumnPreset(presetId)),
            })
          ),
          { kind: 'separator', id: 'view-cols-sep-1' },
          {
            kind: 'checkbox',
            id: 'view-cols-col-lock',
            label: 'Lock Column Order',
            checked: lockColumnOrder,
            onToggle: () => requireActiveSession(() => setLockColumnOrder((v) => !v)),
          },
          {
            kind: 'command',
            id: 'view-cols-col-save',
            label: 'Save Current State',
            onSelect: () => requireActiveSession(() => handleSaveDocColumnState()),
          },
          {
            kind: 'command',
            id: 'view-cols-choose',
            label: 'Choose Columns…',
            // The document table's own Columns menu, every column a checkbox (US-01M7QCN2).
            onSelect: () =>
              requireActiveSession(() => {
                setDocTableCollapsed(false);
                setDocColumnsAnchorRect(
                  document.querySelector('.mbc-columns-trigger-btn')?.getBoundingClientRect() ?? null
                );
                setDocColumnsPopoverOpen(true);
              }),
          },
        ],
      },
      {
        kind: 'command',
        id: 'view-restore-default-layout',
        label: registryCommand('view-restore-default-layout').label,
        disabled: !sessionActive,
        onSelect: () => requireActiveSession(() => restoreDefaultLayout()),
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
                  label: registryCommand('view-no-tabs').label,
                  disabled: true,
                  onSelect: () => {},
                },
              ],
      },
      {
        // US-01M6Q1CF (D0015): the studios in rail order, from the registry, with its digits on the first nine.
        kind: 'submenu',
        id: 'view-studios-sub',
        label: 'Studios',
        minWidth: 220,
        children: STUDIOS.map((entry): MenuNode => {
          const availability = sessionActive ? studioAvailability(entry, activeDoc) : ({ ok: true } as const);
          return {
            kind: 'command',
            id: `view-studio-${entry.id}`,
            label: entry.name,
            shortcut: registryKey(`view-studio-${entry.id}`),
            disabled: !availability.ok,
            description: availability.ok ? undefined : availability.reason,
            onSelect: () => openStudioByKey(entry),
          };
        }),
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
            label: registryCommand('view-lay-split').label,
            checked: sessionActive && effectiveMapLayoutMode === 'split',
            shortcut: registryKey('view-lay-split'),
            disabled: !isCommandEnabled('map-layout-circle'),
            description: commandDisabledReason('map-layout-circle'),
            onToggle: () => requireActiveSession(() => chooseMapLayout('split')),
          },
          {
            kind: 'checkbox',
            id: 'view-lay-circ',
            label: registryCommand('view-lay-circ').label,
            checked: sessionActive && effectiveMapLayoutMode === 'circular',
            shortcut: registryKey('view-lay-circ'),
            disabled: !isCommandEnabled('map-layout-circle'),
            description: commandDisabledReason('map-layout-circle'),
            onToggle: () => requireActiveSession(() => chooseMapLayout('circular')),
          },
          {
            kind: 'checkbox',
            id: 'view-lay-lin',
            label: registryCommand('view-lay-lin').label,
            checked: sessionActive && effectiveMapLayoutMode === 'linear',
            shortcut: registryKey('view-lay-lin'),
            onToggle: () => requireActiveSession(() => chooseMapLayout('linear')),
          },
          { kind: 'separator', id: 'view-lay-sep' },
          {
            kind: 'command',
            id: 'view-set-origin',
            label: registryCommand('view-set-origin').label,
            shortcut: registryKey('view-set-origin'),
            disabled: !isCommandEnabled('set-origin'),
            description: actsOnMainViewDescription('view-set-origin', 'Set Origin', commandDisabledReason('set-origin')),
            onSelect: () => requireActiveSession(() => handleSetOriginToSelection()),
          },
        ],
      },
      {
        // US-01M7DV8W: show or hide each track; checked as shown, off with the reason where it cannot apply.
        kind: 'submenu',
        id: 'view-tracks-sub',
        label: 'Tracks',
        disabled: !sessionActive,
        minWidth: 220,
        children: [
          {
            kind: 'checkbox',
            id: 'view-track-features',
            label: registryCommand('view-track-features').label,
            checked: sessionActive && TRACK_MENU['features'].shown,
            disabled: !isCommandEnabled('track-features'),
            description: commandDisabledReason('track-features'),
            onToggle: () => requireActiveSession(() => toggleTrack('features')),
          },
          {
            kind: 'checkbox',
            id: 'view-track-primers',
            label: registryCommand('view-track-primers').label,
            checked: sessionActive && TRACK_MENU['primers'].shown,
            disabled: !isCommandEnabled('track-primers'),
            description: commandDisabledReason('track-primers'),
            onToggle: () => requireActiveSession(() => toggleTrack('primers')),
          },
          {
            kind: 'checkbox',
            id: 'view-track-restriction-sites',
            label: registryCommand('view-track-restriction-sites').label,
            checked: sessionActive && TRACK_MENU['restriction-sites'].shown,
            disabled: !isCommandEnabled('track-restriction-sites'),
            description: commandDisabledReason('track-restriction-sites'),
            onToggle: () => requireActiveSession(() => toggleTrack('restriction-sites')),
          },
          {
            kind: 'checkbox',
            id: 'view-track-orfs',
            label: registryCommand('view-track-orfs').label,
            checked: sessionActive && TRACK_MENU['orfs'].shown,
            disabled: !isCommandEnabled('track-orfs'),
            description: commandDisabledReason('track-orfs'),
            onToggle: () => requireActiveSession(() => toggleTrack('orfs')),
          },
          {
            kind: 'checkbox',
            id: 'view-track-translation',
            label: registryCommand('view-track-translation').label,
            checked: sessionActive && TRACK_MENU['translation'].shown,
            disabled: !isCommandEnabled('track-translation'),
            description: commandDisabledReason('track-translation'),
            onToggle: () => requireActiveSession(() => toggleTrack('translation')),
          },
          {
            kind: 'checkbox',
            id: 'view-track-gc-graph',
            label: registryCommand('view-track-gc-graph').label,
            checked: sessionActive && TRACK_MENU['gc-graph'].shown,
            disabled: !isCommandEnabled('track-gc-graph'),
            description: commandDisabledReason('track-gc-graph'),
            onToggle: () => requireActiveSession(() => toggleTrack('gc-graph')),
          },
          {
            kind: 'checkbox',
            id: 'view-track-hydropathy-graph',
            label: registryCommand('view-track-hydropathy-graph').label,
            checked: sessionActive && TRACK_MENU['hydropathy-graph'].shown,
            disabled: !isCommandEnabled('track-hydropathy-graph'),
            description: commandDisabledReason('track-hydropathy-graph'),
            onToggle: () => requireActiveSession(() => toggleTrack('hydropathy-graph')),
          },
        ],
      },
      {
        kind: 'command',
        id: 'view-rotate-map',
        label: registryCommand('view-rotate-map').label,
        disabled: !isCommandEnabled('rotate-map'),
        description: commandDisabledReason('rotate-map'),
        onSelect: () => requireActiveSession(() => handleRotateMapCommand('open')),
      },
      {
        kind: 'command',
        id: 'view-reset-rotation',
        label: registryCommand('view-reset-rotation').label,
        disabled: !isCommandEnabled('rotate-map'),
        description: commandDisabledReason('rotate-map'),
        onSelect: () => requireActiveSession(() => handleRotateMapCommand('reset')),
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
            label: registryCommand('view-enz').label,
            onSelect: () => requireActiveSession(() => openEnzymesView()),
          },
          {
            kind: 'command',
            id: 'view-annot',
            label: registryCommand('view-annot').label,
            onSelect: () => requireActiveSession(() => setViewerTab('annotations-table')),
          },
          {
            kind: 'command',
            id: 'view-text',
            label: registryCommand('view-text').label,
            onSelect: () => requireActiveSession(() => setViewerTab('text-view')),
          },
          {
            kind: 'command',
            id: 'view-mfe',
            label: registryCommand('view-mfe').label,
            onSelect: () =>
              requireActiveSession(() => openFoldingPanel()),
          },
          {
            kind: 'command',
            id: 'view-lineage',
            label: registryCommand('view-lineage').label,
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
            label: registryCommand('view-zoom-in').label,
            shortcut: registryKey('view-zoom-in'),
            disabled: !isCommandEnabled('zoom-map'),
            description: commandDisabledReason('zoom-map'),
            onSelect: () => requireActiveSession(() => zoomFocusedPane(1)),
          },
          {
            kind: 'command',
            id: 'view-zoom-out',
            label: registryCommand('view-zoom-out').label,
            shortcut: registryKey('view-zoom-out'),
            disabled: !isCommandEnabled('zoom-map'),
            description: commandDisabledReason('zoom-map'),
            onSelect: () => requireActiveSession(() => zoomFocusedPane(-1)),
          },
          {
            kind: 'command',
            id: 'view-zoom-100',
            label: registryCommand('view-zoom-100').label,
            shortcut: registryKey('view-zoom-100'),
            disabled: !isCommandEnabled('zoom-map'),
            description: commandDisabledReason('zoom-map'),
            onSelect: () => requireActiveSession(() => zoomFocusedPane('actual')),
          },
          {
            kind: 'command',
            id: 'view-fit',
            label: registryCommand('view-fit').label,
            disabled: !isCommandEnabled('fit-view'),
            description: commandDisabledReason('fit-view'),
            onSelect: () => requireActiveSession(() => fitFocusedPane('fit')),
          },
          {
            kind: 'command',
            id: 'view-reset-view',
            label: registryCommand('view-reset-view').label,
            disabled: !isCommandEnabled('fit-view'),
            description: commandDisabledReason('fit-view'),
            onSelect: () => requireActiveSession(() => fitFocusedPane('reset')),
          },
        ],
      },
      { kind: 'separator', id: 'view-menu-info-sep' },
      {
        kind: 'checkbox',
        id: 'view-tog-menu-func-info',
        label: registryCommand('view-tog-menu-func-info').label,
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
            label: registryCommand('enz-choose').label,
            shortcut: registryKey('enz-choose'),
            onSelect: () => requireActiveSession(() => openEnzymesView()),
          },
          {
            kind: 'command',
            id: 'enz-digest-dialog',
            label: registryCommand('enz-digest-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'digest' })),
          },
          {
            kind: 'command',
            id: 'enz-table',
            label: registryCommand('enz-table').label,
            onSelect: () => requireActiveSession(() => openEnzymesView()),
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
            label: registryCommand('enz-noncut').label,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'non-cutters')
              ),
          },
          {
            kind: 'command',
            id: 'enz-silent',
            label: registryCommand('enz-silent').label,
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
            label: registryCommand('enz-suppliers').label,
            onSelect: () => setPrefsModalTab('Enzymes'),
          },
          {
            kind: 'command',
            id: 'enz-gel-prefs',
            label: registryCommand('enz-gel-prefs').label,
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
            label: registryCommand('feat-add').label,
            shortcut: registryKey('feat-add'),
            onSelect: () => requireActiveSession(() => handleAddFeatureFromSelection()),
          },
          {
            kind: 'command',
            id: 'feat-detect',
            label: registryCommand('feat-detect').label,
            onSelect: () => requireActiveSession(() => handleAutoDetectCommonFeatures()),
          },
          {
            kind: 'command',
            id: 'feat-protease',
            label: registryCommand('feat-protease').label,
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
            label: registryCommand('feat-manage-lib').label,
            onSelect: () => requireActiveSession(() => setViewerTab('annotations-table')),
          },
          {
            kind: 'command',
            id: 'feat-transfer',
            label: registryCommand('feat-transfer').label,
            onSelect: () => requireActiveSession(() => handleOpenTransferAnnotations()),
          },
          {
            kind: 'command',
            id: 'feat-extract',
            label: registryCommand('feat-extract').label,
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
            label: registryCommand('prm-design-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'primers' })),
          },
          {
            kind: 'command',
            id: 'prm-degenerate-dialog',
            label: registryCommand('prm-degenerate-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'degenerate-primers' })),
          },
          {
            kind: 'command',
            id: 'prm-test-saved-dialog',
            label: registryCommand('prm-test-saved-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'saved-primers' })),
          },
          {
            kind: 'command',
            id: 'prm-db-binding-dialog',
            label: registryCommand('prm-db-binding-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'primer-db-binding' })),
          },
          {
            kind: 'command',
            id: 'prm-add',
            label: registryCommand('prm-add').label,
            // Add Primer opens Primers & CRISPR, on the Mac too; the import is Import Primers from Spreadsheet… (D0263).
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'prm-add-list',
            label: registryCommand('prm-add-list').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'import-primers' })),
          },
          {
            kind: 'command',
            id: 'prm-design-pair',
            label: registryCommand('prm-design-pair').label,
            // Design Primer Pair opens the Primers studio on Design, as the native item did before it ran this one (US-01M6Q159).
            onSelect: () => requireActiveSession(() => openPrimersStudio('design')),
          },
          {
            kind: 'command',
            id: 'prm-convert-oligo',
            label: registryCommand('prm-convert-oligo').label,
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
            label: registryCommand('prm-saved').label,
            // Map Saved Primers opens the Primers studio on Saved, as the native item did before it ran this one (US-01M6Q159).
            onSelect: () => requireActiveSession(() => openPrimersStudio('saved')),
          },
          {
            kind: 'command',
            id: 'prm-specificity',
            label: registryCommand('prm-specificity').label,
            // Binding Specificity is screened on the Primers studio's Saved sub-tab (the native item's route too).
            onSelect: () => requireActiveSession(() => openPrimersStudio('saved')),
          },
          {
            kind: 'command',
            id: 'prm-export',
            label: registryCommand('prm-export').label,
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
            label: registryCommand('prm-pcr-sim').label,
            shortcut: registryKey('prm-pcr-sim'),
            onSelect: () => requireActiveSession(() => setViewerTab('primers-pcr')),
          },
          {
            kind: 'command',
            id: 'prm-soe',
            label: registryCommand('prm-soe').label,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Overlap Extension PCR', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'prm-sdm',
            label: registryCommand('prm-sdm').label,
            shortcut: registryKey('prm-sdm'),
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
            label: registryCommand('prm-crispr').label,
            onSelect: () => requireActiveSession(() => openPrimersStudio('crispr')),
          },
          {
            kind: 'command',
            id: 'prm-crispr-editing',
            label: registryCommand('prm-crispr-editing').label,
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
            label: registryCommand('prm-prefs').label,
            onSelect: () => setPrefsModalTab('Primers'),
          },
        ],
      },
    ];

  const cloningActionsMenuNodes: MenuNode[] = [
      {
        kind: 'command',
        id: 'act-clone-dialog',
        label: registryCommand('act-clone-dialog').label,
        disabled: !sessionActive,
        onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'cloning' })),
      },
      {
        kind: 'command',
        id: 'act-validate-clone',
        label: registryCommand('act-validate-clone').label,
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
            label: registryCommand('act-rest-find-sites').label,
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
            label: registryCommand('act-rest-digest-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'digest' })),
          },
          {
            kind: 'command',
            id: 'act-rest-frag',
            label: registryCommand('act-rest-frag').label,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-rest-ligate',
            label: registryCommand('act-rest-ligate').label,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-rest-clone',
            label: registryCommand('act-rest-clone').label,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-anneal',
            label: registryCommand('act-anneal').label,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'anneal-oligos')
              ),
          },
          {
            kind: 'command',
            id: 'act-rest-noncut',
            label: registryCommand('act-rest-noncut').label,
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
            label: registryCommand('act-pcr').label,
            shortcut: registryKey('act-pcr'),
            // PCR Amplification opens the Primers studio on Design, as the native item did before it ran this one (US-01M6Q159).
            onSelect: () => requireActiveSession(() => openPrimersStudio('design')),
          },
          {
            kind: 'command',
            id: 'act-soe',
            label: registryCommand('act-soe').label,
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
            label: registryCommand('act-mut-primer').label,
            shortcut: registryKey('act-mut-primer'),
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Restriction Ligation', 'mutagenesis')
              ),
          },
          {
            kind: 'command',
            id: 'act-mut-shuffle',
            label: registryCommand('act-mut-shuffle').label,
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
            label: registryCommand('act-gibson').label,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Gibson Assembly', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-goldengate',
            label: registryCommand('act-goldengate').label,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Golden Gate (Type IIS)', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'act-hifi',
            label: registryCommand('act-hifi').label,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('NEBuilder HiFi Assembly', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'act-infusion',
            label: registryCommand('act-infusion').label,
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('In-Fusion Cloning', 'gel')),
          },
          {
            kind: 'command',
            id: 'act-parts',
            label: registryCommand('act-parts').label,
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
            label: registryCommand('act-gw-lr').label,
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Gateway BP/LR Recombination', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'act-gw-bp',
            label: registryCommand('act-gw-bp').label,
            disabled: !sessionActive,
            onSelect: () =>
              requireActiveSession(() =>
                openCloningMethod('Gateway BP/LR Recombination', 'gel')
              ),
          },
          {
            kind: 'command',
            id: 'act-gw-annot-att',
            label: registryCommand('act-gw-annot-att').label,
            disabled: !sessionActive,
            onSelect: () => requireActiveSession(() => handleAnnotateGatewaySites()),
          },
          {
            kind: 'command',
            id: 'act-gw-add-attb',
            label: registryCommand('act-gw-add-attb').label,
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
            label: registryCommand('act-ta-open').label,
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
            label: registryCommand('act-topo-open').label,
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
            label: registryCommand('tools-gel').label,
            shortcut: registryKey('tools-gel'),
            onSelect: () =>
              requireActiveSession(() => openCloningMethod('Restriction Ligation', 'gel')),
          },
          {
            kind: 'command',
            id: 'tools-calc',
            label: registryCommand('tools-calc').label,
            shortcut: registryKey('tools-calc'),
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
            label: registryCommand('tools-blast').label,
            shortcut: registryKey('tools-blast'),
            onSelect: () => requireActiveSession(() => setBlastModalOpen(true)),
          },
          {
            kind: 'command',
            id: 'tools-vec-cat',
            label: registryCommand('tools-vec-cat').label,
            onSelect: () => requireActiveSession(() => openVectorStudio('catalog')),
          },
          {
            kind: 'command',
            id: 'tools-vec-arch',
            label: registryCommand('tools-vec-arch').label,
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
            label: registryCommand('tools-db-explorer').label,
            onSelect: () => openDatabaseExplorer('ncbi-nucleotide'),
          },
          {
            kind: 'command',
            id: 'tools-primer-database',
            label: registryCommand('tools-primer-database').label,
            onSelect: () => openPrimerDatabaseWindow(),
          },
          {
            kind: 'command',
            id: 'tools-enzyme-database',
            label: registryCommand('tools-enzyme-database').label,
            onSelect: () => openEnzymeDatabaseWindow(),
          },
          {
            kind: 'command',
            id: 'tools-make-blast-db',
            label: registryCommand('tools-make-blast-db').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'make-blast-db' })),
          },
          {
            kind: 'command',
            id: 'tools-local-blast-dbs',
            label: registryCommand('tools-local-blast-dbs').label,
            onSelect: () => openDatabaseExplorer('local-blast-dbs'),
          },
          {
            kind: 'command',
            id: 'tools-blast-setup',
            label: registryCommand('tools-blast-setup').label,
            // BLAST is configured through local databases (Preferences had no BLAST settings).
            onSelect: () => openDatabaseExplorer('local-blast-dbs'),
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
            label: registryCommand('tools-extract-ann').label,
            onSelect: () => requireActiveSession(() => handleExtractAnnotatedFeatures()),
          },
          {
            kind: 'command',
            id: 'tools-mask-sel',
            label: registryCommand('tools-mask-sel').label,
            onSelect: () =>
              requireActiveSession(() => handleMaskActiveSequence('selection')),
          },
          {
            kind: 'command',
            id: 'tools-mask-lowcomp',
            label: registryCommand('tools-mask-lowcomp').label,
            onSelect: () =>
              requireActiveSession(() => handleMaskActiveSequence('low-complexity')),
          },
          {
            kind: 'command',
            id: 'tools-concat-seqs',
            label: registryCommand('tools-concat-seqs').label,
            onSelect: () =>
              requireActiveSession(() => handleConcatenateSelectedSequences()),
          },
          {
            kind: 'command',
            id: 'tools-gen-consensus',
            label: registryCommand('tools-gen-consensus').label,
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
            label: registryCommand('tools-sanger').label,
            onSelect: () => requireActiveSession(() => setViewerTab('sanger-contig')),
          },
          {
            kind: 'command',
            id: 'tools-ngs',
            label: registryCommand('tools-ngs').label,
            onSelect: () => requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
          },
          {
            kind: 'command',
            id: 'tools-synteny',
            label: registryCommand('tools-synteny').label,
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genome-variants')),
          },
          {
            kind: 'command',
            id: 'tools-gb-sub',
            label: registryCommand('tools-gb-sub').label,
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
            label: registryCommand('tools-pipelines').label,
            shortcut: registryKey('tools-pipelines'),
            onSelect: () => requireActiveSession(() => setViewerTab('guided-pipelines')),
          },
          {
            kind: 'command',
            id: 'tools-workflows',
            label: registryCommand('tools-workflows').label,
            onSelect: () => requireActiveSession(() => openHybridSubTab('lineage')),
          },
          { kind: 'separator', id: 'tools-wf-presets-sep' },
          {
            kind: 'command',
            id: 'tools-wf-oligo',
            label: registryCommand('tools-wf-oligo').label,
            onSelect: () =>
              requireActiveSession(() => {
                setViewerTab('cloning-gel');
                setStatusBanner('Opened the Annealed Oligo Cloning tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tools-wf-batch-rest',
            label: registryCommand('tools-wf-batch-rest').label,
            onSelect: () =>
              requireActiveSession(() => {
                setViewerTab('cloning-gel');
                setStatusBanner('Opened the Batch Restriction Cloning tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tools-wf-align-tree-run',
            label: registryCommand('tools-wf-align-tree-run').label,
            onSelect: () =>
              requireActiveSession(() => {
                if (openPhylogeneticsModule('phylogeny', {
                  treeAlgo: 'Maximum Likelihood (ML)',
                })) setStatusBanner('Opened the Align DNA then build tree tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tools-wf-mafft',
            label: registryCommand('tools-wf-mafft').label,
            onSelect: () =>
              requireActiveSession(() => {
                openSequenceAlignment('msa', {
                  msaAlgo: 'consistency-nj',
                });
                setStatusBanner('Opened the Align DNA via MAFFT-style, MUSCLE-style & Clustal-style tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tools-wf-map-asm',
            label: registryCommand('tools-wf-map-asm').label,
            onSelect: () =>
              requireActiveSession(() => {
                openGenomicsSuite('ngs-assembly');
                setStatusBanner('Opened the Combined mapping and de novo assembly tools — set the inputs there to run it.');
              }),
          },
          {
            kind: 'command',
            id: 'tools-wf-apply-var',
            label: registryCommand('tools-wf-apply-var').label,
            onSelect: () =>
              requireActiveSession(() => {
                openGenomicsSuite('genome-variants');
                setStatusBanner('Opened the Apply Variants to Reference Sequence tools — set the inputs there to run it.');
              }),
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
            label: registryCommand('tools-wf-manage').label,
            onSelect: () => requireActiveSession(() => setManageWorkflowsOpen(true)),
          },
          {
            kind: 'command',
            id: 'tools-wf-run',
            label: registryCommand('tools-wf-run').label,
            onSelect: () => requireActiveSession(() => setRunWorkflowFor({})),
          },
          { kind: 'separator', id: 'tools-wf-run-sep' },
          ...allWorkflows().map((w): MenuNode => ({
            kind: 'command',
            id: `tools-wf-run-${w.id}`,
            label: `${w.name}…`,
            onSelect: () => requireActiveSession(() => setRunWorkflowFor({ workflowId: w.id })),
          })),
          {
            kind: 'command',
            id: 'tools-wf-group-name',
            label: registryCommand('tools-wf-group-name').label,
            onSelect: () => requireActiveSession(() => handleWorkflowGroupByName()),
          },
          {
            kind: 'command',
            id: 'tools-wf-mod-intervals',
            label: registryCommand('tools-wf-mod-intervals').label,
            onSelect: () =>
              requireActiveSession(() => handleWorkflowModifyAnnotationIntervals()),
          },
          {
            kind: 'command',
            id: 'tools-wf-random-sample',
            label: registryCommand('tools-wf-random-sample').label,
            onSelect: () => requireActiveSession(() => handleWorkflowRandomlySample()),
          },
          {
            kind: 'command',
            id: 'tools-wf-set-cds',
            label: registryCommand('tools-wf-set-cds').label,
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
            label: registryCommand('tools-plugin-euk-gene').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-euk-gene-predictor')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-microbial-gene',
            label: registryCommand('tools-plugin-microbial-gene').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-microbial-gene-predictor')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-crispr-arrays',
            label: registryCommand('tools-plugin-crispr-arrays').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-crispr-repeat-arrays')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-tandem-repeats',
            label: registryCommand('tools-plugin-tandem-repeats').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-tandem-repeat-finder')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-haplotype-part',
            label: registryCommand('tools-plugin-haplotype-part').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-haplotype-partitioner')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-taxonomic-class',
            label: registryCommand('tools-plugin-taxonomic-class').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-taxonomic-classifier')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-species-delim',
            label: registryCommand('tools-plugin-species-delim').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-species-delimitation')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-protein-domains',
            label: registryCommand('tools-plugin-protein-domains').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-protein-domains-epitopes')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-tm-topology',
            label: registryCommand('tools-plugin-tm-topology').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-transmembrane-topology')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-adapter-trimmer',
            label: registryCommand('tools-plugin-adapter-trimmer').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-adapter-quality-trimmer')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-synteny-blocks',
            label: registryCommand('tools-plugin-synteny-blocks').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-genome-synteny-blocks')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-hpc-phylo',
            label: registryCommand('tools-plugin-hpc-phylo').label,
            onSelect: () =>
              requireActiveSession(() => openPluginTool('plugin-hpc-phylogeny-script')),
          },
          {
            kind: 'command',
            id: 'tools-plugin-ext-cli',
            label: registryCommand('tools-plugin-ext-cli').label,
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
            label: registryCommand('tools-prefs').label,
            shortcut: registryKey('tools-prefs'),
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
            label: registryCommand('seq-rc').label,
            shortcut: registryKey('seq-rc'),
            disabled: !isCommandEnabled('strand-transform'),
            description: actsOnMainViewDescription('seq-rc', 'Reverse Complement', commandDisabledReason('strand-transform')),
            onSelect: () =>
              requireActiveSession(() => handleReverseComplementActiveDoc()),
          },
          {
            kind: 'command',
            id: 'seq-comp',
            label: registryCommand('seq-comp').label,
            disabled: !isCommandEnabled('strand-transform'),
            onSelect: () => requireActiveSession(() => handleComplementOnlyActiveDoc()),
          },
          {
            kind: 'command',
            id: 'seq-rev',
            label: registryCommand('seq-rev').label,
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
            label: registryCommand('seq-back-translate').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'backtranslate' })),
          },
          {
            kind: 'command',
            id: 'seq-translate',
            label: registryCommand('seq-translate').label,
            onSelect: () =>
              requireActiveSession(() => {
                setShowTranslation(true);
                setViewerTab('sequence-view');
              }),
          },
          {
            kind: 'command',
            id: 'seq-back-trans',
            label: registryCommand('seq-back-trans').label,
            onSelect: () => requireActiveSession(() => openProteinStudio()),
          },
          {
            kind: 'command',
            id: 'seq-dna-rna',
            label: registryCommand('seq-dna-rna').label,
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
            label: registryCommand('seq-circ-tog').label,
            checked: sessionActive && activeDoc.topology === 'circular',
            onToggle: () => requireActiveSession(() => handleToggleCircularLinear()),
          },
          {
            kind: 'command',
            id: 'seq-extract',
            label: registryCommand('seq-extract').label,
            onSelect: () => requireActiveSession(() => handleExtractSelectedRegion()),
          },
          {
            kind: 'command',
            id: 'seq-mutate',
            label: registryCommand('seq-mutate').label,
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
            label: registryCommand('seq-merge-sanger').label,
            onSelect: () => requireActiveSession(() => setViewerTab('sanger-contig')),
          },
          {
            kind: 'command',
            id: 'seq-denovo',
            label: registryCommand('seq-denovo').label,
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
            label: registryCommand('ann-orfs-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'orfs' })),
          },
          {
            kind: 'command',
            id: 'ann-from-documents-dialog',
            label: registryCommand('ann-from-documents-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'annotate-from-documents' })),
          },
          {
            kind: 'command',
            id: 'ann-microsatellites-dialog',
            label: registryCommand('ann-microsatellites-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'microsatellites' })),
          },
          {
            kind: 'command',
            id: 'ann-expression-dialog',
            label: registryCommand('ann-expression-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'expression' })),
          },
          {
            kind: 'command',
            id: 'ann-compare-dialog',
            label: registryCommand('ann-compare-dialog').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'compare-annotations' })),
          },
          {
            kind: 'command',
            id: 'ann-orfs',
            label: registryCommand('ann-orfs').label,
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
            label: registryCommand('ann-glimmer').label,
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genes-cpg-repeats')),
          },
          {
            kind: 'command',
            id: 'ann-cpg',
            label: registryCommand('ann-cpg').label,
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genes-cpg-repeats')),
          },
          {
            kind: 'command',
            id: 'ann-motifs',
            label: registryCommand('ann-motifs').label,
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
            label: registryCommand('ann-crispr').label,
            onSelect: () => requireActiveSession(() => openPrimersStudio('crispr')),
          },
          {
            kind: 'command',
            id: 'ann-freebayes',
            label: registryCommand('ann-freebayes').label,
            onSelect: () =>
              requireActiveSession(() => openGenomicsSuite('genome-variants')),
          },
          {
            kind: 'command',
            id: 'ann-16s',
            label: registryCommand('ann-16s').label,
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
            label: registryCommand('ann-bbduk').label,
            onSelect: () => requireActiveSession(() => openGenomicsSuite('ngs-assembly')),
          },
          {
            kind: 'command',
            id: 'ann-blast',
            label: registryCommand('ann-blast').label,
            onSelect: () => requireActiveSession(() => setOperationDialog({ kind: 'annotate-by-blast' })),
          },
          {
            kind: 'command',
            id: 'ann-transfer',
            label: registryCommand('ann-transfer').label,
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
            label: registryCommand('ann-prot-dom').label,
            onSelect: () => requireActiveSession(() => handleOpenMotifSearch('Protein Domains')),
          },
          {
            kind: 'command',
            id: 'ann-pdb',
            label: registryCommand('ann-pdb').label,
            onSelect: () => requireActiveSession(() => openProteinStudio()),
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
            shortcut: registryKey('help-panel'),
            onSelect: () => setHelpPanelOpen((o) => !o),
          },
          {
            kind: 'command',
            id: 'help-shortcuts',
            label: registryCommand('help-shortcuts').label,
            onSelect: () => setPrefsModalTab('Keyboard'),
          },
          {
            kind: 'command',
            id: 'help-vec-guide',
            label: registryCommand('help-vec-guide').label,
            onSelect: () => handleStartNewSession('twist-onboarding'),
          },
          {
            kind: 'command',
            id: 'help-tutorials',
            label: registryCommand('help-tutorials').label,
            onSelect: () => handleStartNewSession('sample-library'),
          },
        ],
      },
      {
        kind: 'submenu',
        id: 'help-examples-sub',
        label: 'Load Example Data',
        minWidth: 230,
        children: [
          {
            kind: 'command',
            id: 'help-examples',
            label: registryCommand('help-examples').label,
            onSelect: () => { setHomeViewActive(false); setOperationDialog({ kind: 'examples' }); },
          },
          {
            kind: 'command',
            id: 'help-bench-genome',
            label: registryCommand('help-bench-genome').label,
            onSelect: () => handleLoadBenchmarkDocument('genome-500k'),
          },
          {
            kind: 'command',
            id: 'help-bench-protein',
            label: registryCommand('help-bench-protein').label,
            onSelect: () => handleLoadBenchmarkDocument('protein-10k'),
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
            label: registryCommand('help-updates').label,
            onSelect: () => setPrefsModalTab('General'),
          },
          {
            kind: 'command',
            id: 'help-about',
            label: registryCommand('help-about').label,
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
  const topMenuLabels = Object.keys(topMenus).map((id) =>
    id === 'app' ? 'MolBioCraft' : topMenuBarEntries.find((entry) => entry.id === id)?.label ?? id
  );
  // The menubar the native dispatcher runs commands from (its latest render); set before the shortcut
  // bindings are collected, so a dispatch during this render finds this render's menus.
  const menubarRef = useRef<{ trees: MenuNode[][]; labels: string[] }>({ trees: [], labels: [] });
  menubarRef.current = { trees: Object.values(topMenus), labels: topMenuLabels };

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
      // A shortcut whose item a rule disables runs its handler, which refuses it with the rule's own
      // reason (US-01M7DVEN): ⌘= / ⌘- / ⌘0 and ⌥⌘1 / ⌥⌘2 then say why in the status bar.
      if (binding.disabled && !RULE_REFUSED_SHORTCUT_IDS.has(binding.id)) {
        setStatusBanner(`${binding.label} is not available right now.`);
        return;
      }
      binding.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useNativeMacMenuBar, hostOs]);

  // The toolbar dropdowns are named groups of the menubar (US-01M6Q1N2): the same nodes, so the same
  // ids, labels, keys, availability and handlers (commandRegistry.ts TOOLBAR_GROUPS).
  const toolbarGroup = (id: ToolbarGroupId): MenuNode[] => toolbarMenuItems(Object.values(topMenus), topMenuLabels, id);
  // ⌘K (US-01M6Q1N2): with a query, every menubar command whose label or path matches, ranked and
  // capped, with its path, key, availability and the menu's own handler; each studio carries its
  // View › Studios command's path, key, availability and handler, and each benchmark loader its Help ›
  // Load Example Data command's (merged, not listed twice). An
  // empty query lists the studios, the two benchmark loaders, the colour-blind palette switch and
  // the documents.
  const PALETTE_COMMAND_CAP = 60;
  const commandPaletteItems: PaletteItem[] = (() => {
    if (!commandPaletteOpen) return [];
    const commands = menubarCommands(Object.values(topMenus), topMenuLabels);
    const byId = new Map(commands.map((c) => [c.id, c]));
    const extras = commandPaletteExtras.map((it): PaletteItem => {
      const c = it.commandId ? byId.get(it.commandId) : undefined;
      // A studio is its View › Studios command, and a benchmark its Help › Load Example Data command:
      // that item's path, key, greyed state, reason and handler.
      return c ? { ...it, path: c.path, shortcut: c.shortcut, disabled: c.disabled, reason: c.reason, run: c.run } : it;
    });
    const q = commandPaletteQuery.trim();
    if (!q) return extras;
    const studioIds = new Set(extras.flatMap((it) => (it.commandId ? [it.commandId] : [])));
    const matches = rankPaletteCommands(commands.filter((c) => !studioIds.has(c.id)), q)
      .slice(0, PALETTE_COMMAND_CAP)
      .map((c): PaletteItem => ({
        id: `cmd-${c.id}`,
        commandId: c.id,
        label: c.label,
        category: c.path[0],
        hint: '',
        path: c.path,
        shortcut: c.shortcut,
        disabled: c.disabled,
        reason: c.disabled ? c.reason ?? (sessionActive ? `${c.label} is not available right now.` : 'Open or create a session first.') : undefined,
        run: c.run,
      }));
    return [...extras.filter((it) => it.studio), ...matches, ...extras.filter((it) => !it.studio)];
  })();
  /** Runs a ⌘K entry, or says why a disabled one cannot run and changes nothing. */
  const choosePaletteItem = (it: PaletteItem) => {
    setCommandPaletteOpen(false);
    if (it.disabled) {
      setStatusBanner(it.reason ?? `${it.label} is not available right now.`);
      return;
    }
    it.run();
  };
  const toolbarMenus: Record<Exclude<ToolbarDropdownId, null>, MenuNode[]> = {
    add: toolbarGroup('add'),
    import: toolbarGroup('import'),
    export: toolbarGroup('export'),
    session: toolbarGroup('session'),
    workflows: toolbarGroup('workflows'),
    align: toolbarGroup('align'),
    tree: toolbarGroup('tree'),
    primers: toolbarGroup('primers'),
    cloning: toolbarGroup('cloning'),
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

  // The Database Explorer fills the main pane while a library is open (US-01M6Q1V9): in a session in
  // place of the document table and viewer, and over the start screen without one.
  const databaseExplorerPane = dbExplorerCategory ? (
    <React.Suspense fallback={null}>
      <DatabaseExplorerView
        key={dbExplorerCategory}
        category={dbExplorerCategory}
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
        onOpenBlastModal={() => setBlastModalOpen(true)}
        onClose={() => leaveDatabaseExplorer()}
      />
    </React.Suspense>
  ) : null;

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
              value=""
              aria-haspopup="dialog"
              onClick={(e) => {
                // A click on the field opens ⌘K empty, as pressing ⌘K does (D0255 (4)); focus alone does not.
                setCommandPaletteQuery('');
                setCommandPaletteIdx(0);
                setCommandPaletteOpen(true);
                // ⌘K's own field takes the focus, and the typing, from here.
                e.currentTarget.blur();
              }}
              onChange={(e) => {
                // ⇧⌘F folds into ⌘K (US-01M7QCN2): what is typed here opens ⌘K with that text.
                setCommandPaletteQuery(e.target.value);
                setCommandPaletteIdx(0);
                setCommandPaletteOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  setCommandPaletteQuery('');
                  setCommandPaletteIdx(0);
                  setCommandPaletteOpen(true);
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
            <kbd className="toolbar-search-kbd" aria-hidden="true">
              {sc('K')}
            </kbd>
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
          }${sessionActive && !homeViewActive ? ' with-studio-rail' : ''}`}
          data-tauri-drag-region
          style={sidebarOpen ? sidebarWidthVarStyle : undefined}
        >
          <button
            type="button"
            className="nav-cluster-icon-btn"
            onClick={goBack}
            disabled={!dbExplorerCategory && (!sessionActive || navIndex <= 0)}
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
              // Lit for its open dropdown, or for Pipelines & NGS; the rail alone shows History and Info (D0219).
              (sessionActive && !homeViewActive && viewerStudio.id === 'pipelines-ngs') ||
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
              // Lit only while its own dropdown is open: the rail shows the studio (D0219).
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
              // Lit only while its own dropdown is open: the rail shows the studio (D0219).
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
              // Lit only while its own dropdown is open: the rail shows the studio (D0219).
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
              // Lit only while its own dropdown is open: the rail shows the studio (D0219).
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
          // No dropdown, so it never lights: the rail shows the Vectors & Architect studio (D0219).
          className="mbc-tool-btn"
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
          {databaseExplorerPane ?? <ProjectFirstPageHome
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
          />}
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
        {/* The studio rail: every studio and panel, always present in a session, left of the sidebar (US-01M6Q1BD). */}
        <StudioRail
          items={studioRail}
          currentView={viewerTab}
          annotationCount={activeDoc.features.length + activeDoc.primers.length}
          onOpen={openStudioFromRail}
          onRefuse={(reason) => setStatusBanner(reason)}
        />
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
              {/* Project: the user's own documents, folders, trash and history (US-01M6Q1V9). */}
              <section className="mbc-sidebar-section" data-section="project" aria-labelledby="mbc-sidebar-project-head">
                <button
                  type="button"
                  id="mbc-sidebar-project-head"
                  className="mbc-sidebar-section-head"
                  aria-expanded={projectSectionOpen}
                  aria-controls="mbc-sidebar-project-body"
                  onClick={() => setProjectSectionOpen((open) => !open)}
                >
                  {projectSectionOpen ? (
                    <ChevronDown size={12} className="tree-chevron" />
                  ) : (
                    <ChevronRight size={12} className="tree-chevron" />
                  )}
                  <span className="mbc-sidebar-section-label">Project</span>
                </button>
                {projectSectionOpen && (
                  <div className="mbc-sidebar-section-body" id="mbc-sidebar-project-body">
                  {/* ★ Favorites */}
                  <button
                    type="button"
                    className={`source-folder-row ${
                      selectedFolder === 'Favorites' ? 'selected' : ''
                    }`}
                    onClick={() => {
                      leaveDatabaseExplorerForProjectRow();
                      handleSelectProjectFolder('Favorites');
                    }}
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
                      onClick={() => { leaveDatabaseExplorerForProjectRow(); handleSelectProjectFolder(id); }} onContextMenu={(event) => openFolderContextMenu(event, id)}>
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
                      leaveDatabaseExplorerForProjectRow();
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
                        onSelect={(id) => { leaveDatabaseExplorerForProjectRow(); handleSelectProjectFolder(id); }}
                        onToggle={(id) => setExpandedNodes((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))}
                        onContextMenu={openFolderContextMenu}
                      />

                      {/* 🗑 Deleted Items (Soft-Delete Recycle Bin) */}
                      <button
                        type="button"
                        className={`source-folder-row ${
                          selectedFolder === 'Deleted Items' ? 'selected' : ''
                        }`}
                        onClick={() => {
                          leaveDatabaseExplorerForProjectRow();
                          handleSelectProjectFolder('Deleted Items');
                        }}
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
                    onClick={() => {
                      leaveDatabaseExplorerForProjectRow();
                      openHybridSubTab('lineage');
                    }}
                    title="View construct genealogy, operation history, and workflow runs"
                  >
                    <span style={{ width: 12 }} />
                    <MolBioSidebarNodeIcon nodeKey="Operations" size={14} />
                    <span className="folder-label">
                      <strong>History</strong>
                    </span>
                    <span className="folder-count">
                      {activeNonDeletedDocs.reduce((sum, d) => sum + (d.history?.length ?? 0), 0)}
                    </span>
                  </button>
                  </div>
                )}
              </section>

              {/* Libraries: vectors, features, samples and databases, collapsed until opened (US-01M6Q1V9). */}
              <section className="mbc-sidebar-section" data-section="libraries" aria-labelledby="mbc-sidebar-libraries-head">
                <button
                  type="button"
                  id="mbc-sidebar-libraries-head"
                  className="mbc-sidebar-section-head"
                  aria-expanded={librariesOpen}
                  aria-controls="mbc-sidebar-libraries-body"
                  onClick={() => {
                    const open = !librariesOpen;
                    setLibrariesOpen(open);
                    saveLibrariesOpen(open);
                  }}
                >
                  {librariesOpen ? (
                    <ChevronDown size={12} className="tree-chevron" />
                  ) : (
                    <ChevronRight size={12} className="tree-chevron" />
                  )}
                  <span className="mbc-sidebar-section-label">Libraries</span>
                  {/* The number of libraries the section lists. */}
                  <span className="mbc-sidebar-section-count">{SIDEBAR_LIBRARY_ROW_COUNT}</span>
                </button>
                {librariesOpen && (
                  <div className="mbc-sidebar-section-body" id="mbc-sidebar-libraries-body">
                    <div className="mbc-sidebar-group" data-group="vectors">
                      <div className="sources-group-label">Vectors</div>
                      <button
                        type="button"
                        className="source-folder-row"
                        onClick={() => {
                          leaveDatabaseExplorer(false);
                          openVectorStudio('catalog');
                        }}
                      >
                        <span style={{ width: 12 }} />
                        <MolBioSidebarNodeIcon nodeKey="vector-catalog" size={13} />
                        <span className="folder-label">Vector Catalog</span>
                        <span className="folder-count">{VECTOR_CATALOG.length}</span>
                      </button>
                      <button
                        type="button"
                        className="source-folder-row"
                        onClick={() => {
                          leaveDatabaseExplorer(false);
                          openVectorStudio('architect');
                        }}
                      >
                        <span style={{ width: 12 }} />
                        <MolBioSidebarNodeIcon nodeKey="modular-parts" size={13} />
                        <span className="folder-label">Modular Vector Parts</span>
                        <span className="folder-count">{MODULAR_VECTOR_PARTS.length}</span>
                      </button>
                    </div>

                    <div className="mbc-sidebar-group" data-group="features">
                      <div className="sources-group-label">Features</div>
                      {/* The feature library, as Sequence › Features › Feature Library opens it. */}
                      <button
                        type="button"
                        className="source-folder-row"
                        onClick={() => {
                          leaveDatabaseExplorer(false);
                          requireActiveSession(() => setViewerTab('annotations-table'));
                        }}
                        title="Inspect and apply standard plasmid promoter, resistance, origin, and tag features"
                      >
                        <span style={{ width: 12 }} />
                        <MolBioSidebarNodeIcon nodeKey="standard-features" size={13} />
                        <span className="folder-label">Standard Plasmid Features</span>
                        <span className="folder-count">{COMMON_PLASMID_FEATURES.length}</span>
                      </button>
                    </div>

                    <div className="mbc-sidebar-group" data-group="samples">
                      <div className="sources-group-label">Samples</div>
                      <button
                        type="button"
                        className="source-folder-row"
                        onClick={() => {
                          leaveDatabaseExplorer(false);
                          handleImportSampleDocuments();
                        }}
                      >
                        <span style={{ width: 12 }} />
                        <MolBioSidebarNodeIcon nodeKey="Sample Documents" size={13} />
                        <span className="folder-label">Sample Project</span>
                        <span className="folder-count">{SAMPLE_LIBRARY.length}</span>
                      </button>
                      {SIDEBAR_SAMPLE_FILES.map((file) => (
                        <button
                          type="button"
                          key={file.id}
                          className="source-folder-row"
                          onClick={() => {
                            leaveDatabaseExplorer(false);
                            handleOpenSampleDocumentFromHome(file.id, file.tab);
                          }}
                        >
                          <span style={{ width: 12 }} />
                          <MolBioSidebarNodeIcon nodeKey={file.icon} size={13} />
                          <span className="folder-label">{file.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className="mbc-sidebar-group" data-group="databases">
                      <div className="sources-group-label">Databases</div>
                      <div className="mbc-sidebar-group" data-group="ncbi">
                        <div className="sources-group-label mbc-sidebar-subgroup-label">NCBI</div>
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
                            onClick={() => openDatabaseExplorer(catId)}
                          >
                            <span style={{ width: 12 }} />
                            <MolBioSidebarNodeIcon nodeKey={catId} size={13} />
                            <span className="folder-label">{label}</span>
                            <span className="folder-count">
                              {queryCuratedDatabaseRecordsRust(catId, '').length}
                            </span>
                          </button>
                        ))}
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
                      </div>

                      <button
                        type="button"
                        className={`source-folder-row ${
                          dbExplorerCategory === 'uniprot' ? 'selected' : ''
                        }`}
                        onClick={() => openDatabaseExplorer('uniprot')}
                      >
                        <span style={{ width: 12 }} />
                        <MolBioSidebarNodeIcon nodeKey="uniprot" size={13} />
                        <span className="folder-label">UniProt</span>
                        <span className="folder-count">
                          {queryCuratedDatabaseRecordsRust('uniprot', '').length}
                        </span>
                      </button>

                      {/* Online only, searched when the user asks (D0008): no record count. */}
                      <button
                        type="button"
                        className={`source-folder-row ${
                          dbExplorerCategory === 'rcsb-pdb' ? 'selected' : ''
                        }`}
                        onClick={() => openDatabaseExplorer('rcsb-pdb')}
                      >
                        <span style={{ width: 12 }} />
                        <MolBioDocTypeIcon kind="protein" visualOverride="structure-3d" size={13} />
                        <span className="folder-label">RCSB PDB</span>
                      </button>

                      <button
                        type="button"
                        className={`source-folder-row ${
                          dbExplorerCategory === 'local-blast-dbs' ? 'selected' : ''
                        }`}
                        onClick={() => openDatabaseExplorer('local-blast-dbs')}
                      >
                        <span style={{ width: 12 }} />
                        <MolBioSidebarNodeIcon nodeKey="local-blast-dbs" size={13} />
                        <span className="folder-label">Local BLAST Databases</span>
                        <span className="folder-count">{localBlastDbs.length}</span>
                      </button>

                      {/* Separate windows, not explorer categories (D0221). */}
                      <button
                        type="button"
                        className="source-folder-row"
                        onClick={() => openPrimerDatabaseWindow()}
                      >
                        <span style={{ width: 12 }} />
                        <MolBioSidebarNodeIcon nodeKey="Primers" size={13} />
                        <span className="folder-label">Primer Database</span>
                      </button>
                      <button
                        type="button"
                        className="source-folder-row"
                        onClick={() => openEnzymeDatabaseWindow()}
                      >
                        <span style={{ width: 12 }} />
                        <MolBioMenuGlyph glyph="digest-scissors" size={13} />
                        <span className="folder-label">Restriction Enzymes</span>
                      </button>
                    </div>
                  </div>
                )}
              </section>
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

        {/* Center Area: Multifile Project Info Table + Sequence Viewer (Top/Bottom or Left/Right Split), or the Database Explorer (US-01M6Q1V9) */}
        {databaseExplorerPane ?? (
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

                {/* US-01M7DVS2: the checked rows' maps, under the rule View › Map Gallery reads. */}
                <button
                  type="button"
                  className="mbc-multifile-action-btn mbc-map-gallery-btn"
                  disabled={!isCommandEnabled('multi-record-view')}
                  title={commandDisabledReason('multi-record-view') ?? 'Show the maps of the checked records side by side'}
                  onClick={() => openMapGallery('maps')}
                >
                  <LayoutGrid size={13} aria-hidden="true" />
                  <span>Map Gallery</span>
                </button>

                {/* US-01M7DVV8: the checked rows side by side, under the rule View › Compare Table reads. */}
                <button
                  type="button"
                  className="mbc-multifile-action-btn mbc-compare-table-btn"
                  disabled={!isCommandEnabled('multi-record-view')}
                  title={commandDisabledReason('multi-record-view') ?? 'Compare the checked records side by side in a table'}
                  onClick={() => openMapGallery('compare-table')}
                >
                  <Table2 size={13} aria-hidden="true" />
                  <span>Compare Table</span>
                </button>

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
                      // Re-reads the store first: one that cannot be read refuses the save and keeps its value (US-01M7DV4Y).
                      const out = saveTableSearch({ name, quickFilter: tableFilter, rules: docFilterRules, matchMode: docFilterMatchMode, wholeProject: wholeProjectSearch });
                      if (out.ok) setSavedSearches(out.searches);
                      setStatusBanner(out.ok ? `Saved search "${name}".` : out.sentence);
                    }}
                    onLoadSearch={(id) => {
                      const x = savedSearches.find((q) => q.id === id);
                      if (x) applyTableSearch(x);
                    }}
                    onDeleteSearch={(id) => {
                      // A delete the browser refuses says so and keeps the entry listed (US-01M7DV4Y).
                      const out = deleteTableSearch(id, savedSearches.find((q) => q.id === id)?.name ?? id);
                      if (out.ok) setSavedSearches(out.searches);
                      else setStatusBanner(out.sentence);
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
                            ) : activeDocFilterCount > 0 ? (
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
            {/* The vector catalog works without a document (blank session); the Map Gallery follows the checked rows, whichever they are (US-01M7DVS2). */}
            {!checkedIdsSet.has(activeDocId) && !(viewerTab === 'vector-library' && !activeDoc.id) && !mapGalleryOpen ? (
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
            {/* The one notice of a custom enzyme store that cannot be read (US-01M7DV52): every scan uses the catalogue alone. */}
            {enzymeDbNotice && (
              <p className="mbc-summary-note" role="alert">
                Your custom restriction enzymes are not used: {enzymeDbNotice} Open Databases &gt; Restriction Enzymes to recover or discard it.
              </p>
            )}
            {/* Viewer Top Control Bar (Split + Zoom + Inspector) */}
            <div className="mbc-viewer-header">
              {/* The studio tabs live in the studio rail (US-01M6Q1BD, D0242); the header keeps the split and view controls. */}

              <button
                type="button"
                className={`mbc-zoom-btn mbc-split-toggle ${documentSplit !== 'single' ? 'active' : ''}`}
                aria-pressed={documentSplit !== 'single'}
                aria-label="Split view: show another document side by side"
                title={documentSplit !== 'single' ? 'Close split view' : 'Split view: show another document side by side'}
                onClick={() => chooseDocumentSplit(documentSplit !== 'single' ? 'single' : lastDocumentSplitRef.current)}
              >
                <Columns2 size={13} />
              </button>
              <select
                className="mbc-document-split-select"
                aria-label="Document split"
                title="Document split"
                value={documentSplit}
                onChange={(e) => chooseDocumentSplit(e.target.value as DocumentSplitOrientation)}
              >
                {DOCUMENT_SPLIT_CHOICES.map((c) => (
                  <option key={c.orientation} value={c.orientation}>{c.label}</option>
                ))}
              </select>

              {/* The Sequence tab's zoom, then the inspector button on any tab with settings (alone off the Sequence tab). */}
              {(viewerTab === 'sequence-view' || inspectorAvailable) && (
                <div className="mbc-viewer-zoom-controls">
                  {viewerTab === 'sequence-view' && (<>
                  {selectedRange && selectionIv && (
                    <span
                      className="mbc-selection-readout"
                      title={`Selected: ${formatIntervalLabel(selectionIv, activeDoc.sequence.length, activeDoc.topology, intervalUnit(activeDoc.moleculeType))}${selectedRange.label ? ` [${selectedRange.label}]` : ''}`}
                    >
                      {formatIntervalLabel(selectionIv, activeDoc.sequence.length, activeDoc.topology, intervalUnit(activeDoc.moleculeType))}
                      {selectedRange.label ? ` • ${selectedRange.label}` : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    className="mbc-zoom-btn"
                    onClick={() => zoomFocusedPane(-1)}
                    disabled={!headerZoomOn}
                    aria-label="Zoom Out"
                    aria-keyshortcuts={headerZoomOn ? ariaSc('-') : undefined}
                    title={headerZoomOn ? `Zoom Out (${sc('-')})` : headerZoomOffReason}
                  >
                    <ZoomOut size={13} />
                  </button>
                  <button
                    type="button"
                    className="mbc-zoom-btn zoom-pct-btn"
                    onClick={() => zoomFocusedPane('actual')}
                    disabled={!headerZoomOn}
                    aria-keyshortcuts={headerZoomOn ? ariaSc('0') : undefined}
                    title={headerZoomOn ? `Reset Zoom to 100% (${sc('0')})` : headerZoomOffReason}
                  >
                    {sequenceZoomLabel(secondPaneFocused ? splitZoom : zoomLevel)}
                  </button>
                  <button
                    type="button"
                    className="mbc-zoom-btn"
                    onClick={() => zoomFocusedPane(1)}
                    disabled={!headerZoomOn}
                    aria-label="Zoom In"
                    aria-keyshortcuts={headerZoomOn ? ariaSc('=') : undefined}
                    title={headerZoomOn ? `Zoom In (${sc('=')})` : headerZoomOffReason}
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
              <div
                ref={setDocumentSplitHost}
                className={documentSplitHostClass(documentSplit, documentSplitSize.collapsed)}
                style={documentSplit === 'single' ? undefined : (documentSplitStyle(documentSplitDrawnRatio) as React.CSSProperties)}
              >
              <div
                ref={viewerCanvasRef}
                className={`mbc-viewer-canvas ${
                  viewerTab === 'sequence-view' ? 'is-sequence-view' : ''
                }${mainPaneFocused ? ' is-focused-pane' : ''}`}
                aria-current={mainPaneFocused ? 'true' : undefined}
                // US-01M7DV10: a pointer down or focus inside the main view (in its DOM, not the inspector
                // its studios portal into the column) focuses it while the split is shown.
                onPointerDownCapture={documentSplitShown ? (e) => { if (e.currentTarget.contains(e.target as Node)) setFocusedPane('main'); } : undefined}
                onFocusCapture={documentSplitShown ? (e) => { if (e.currentTarget.contains(e.target as Node)) setFocusedPane('main'); } : undefined}
              >
                {/* US-01M7DVS2: the Map Gallery takes the main view's place; the tab behind it is kept. */}
                {mapGalleryOpen && (
                  <ErrorBoundary label="Map Gallery" resetKey="map-gallery">
                    <MapGallery
                      docs={selectedInFilteredDocs}
                      folderPath={(d) => folderPathLabels(d.folder, explorerFolders)}
                      rotationOf={(id) => mapRotationByDoc[id] ?? 0}
                      tracks={{ showFeatures, showRestrictionSites }}
                      enzymes={activeEnzymes}
                      scanCollection={scanCollectionChoice.collection}
                      onOpen={openFromMapGallery}
                      onCompare={compareFromMapGallery}
                      onClose={() => setMapGalleryOpen(false)}
                      view={mapGalleryView}
                      onViewChange={setMapGalleryView}
                    />
                  </ErrorBoundary>
                )}
                {!mapGalleryOpen && (
                <ErrorBoundary label={viewerTabLabel(viewerTab, activeDoc, genomicsShownView)} resetKey={`${activeDoc.id}:${viewerTab}`}>
                {/* The main view's studios reach the inspector; the split view's pane and the header stay outside. */}
                <WorkbenchInspectorProvider open={rightPanelOpen} column={inspectorColumn} onClaimsChange={handleInspectorClaims} onRequestOpen={() => setRightPanelOpen(true)}>
                {viewerTab === 'sequence-view' && isContigSummaryRecord(activeDoc) && (
                  <ContigSummaryView
                    doc={activeDoc}
                    onUpdateDocument={handleUpdateDocument}
                    onStatusNotice={setStatusBanner}
                  />
                )}
                {viewerTab === 'sequence-view' && !isContigSummaryRecord(activeDoc) && (
                  <>
                    {hostedPanel?.tab === 'sequence-view' && (
                      // Sequence Map's inspector is its own column, so the hosted panel draws its settings in place.
                      <WorkbenchInspectorContext.Provider value={null}>{hostedPanelNode(hostedPanel.kind)}</WorkbenchInspectorContext.Provider>
                    )}
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
                    <div
                      className={`map-seq-split mode-${effectiveMapLayoutMode}${
                        paneSplitCollapsed ? ` collapsed-${paneSplitCollapsed}` : ''
                      }${paneSplitShown && (paneSplitDragging || !paneSplitIsDefault(paneSplit)) ? ' is-resized' : ''}${
                        paneSplitDragging ? ' dragging' : ''
                      }`}
                      style={paneSplitStyle(paneSplitDrawn.ratio) as React.CSSProperties}
                      ref={setPaneSplitFrame}
                    >
                      {paneSplitCollapsed === 'circular' && (
                        <button
                          type="button"
                          className="map-seq-restore restore-circular"
                          aria-label="Restore circular map"
                          title="Restore the circular map beside the linear map"
                          onClick={() => setPaneSplit(restorePanes)}
                        >
                          <ChevronRight size={14} aria-hidden="true" />
                          <span>Circular map</span>
                        </button>
                      )}
                      {rotateMapControlOpen && circularMapShown && paneSplitCollapsed !== 'circular' && (
                        <CircularMapRotationControl
                          rotationDeg={activeMapRotation}
                          onRotate={setActiveMapRotation}
                          onClose={() => setRotateMapControlOpen(false)}
                        />
                      )}
                      <div className={`map-seq-grid mode-${effectiveMapLayoutMode}`}>
                        {(effectiveMapLayoutMode === 'split' || effectiveMapLayoutMode === 'circular') && (
                          <CircularPlasmidMap
                            doc={activeDoc}
                            cutSites={cutSites}
                            siteCounts={restrictionSiteCounts}
                            siteVisibility={mapSiteVisibility}
                            orfs={orfs}
                            selectedRange={selectedRange}
                            guideHighlight={guideHighlight}
                            onSelectRange={setSelectedRange}
                            showOrfs={showOrfs}
                            orfScope={orfScope}
                            showPrimers={showPrimers}
                            showFeatures={showFeatures}
                            showRestrictionSites={showRestrictionSites}
                            showUniqueCuttersOnly={showUniqueCuttersOnly}
                            restrictionScope={restrictionScope}
                            zoomLevel={zoomLevel}
                            onZoomChange={setZoomLevel}
                            viewRestoreKey={sequenceViewRestores}
                            rotationDeg={activeMapRotation}
                          />
                        )}
                        {(effectiveMapLayoutMode === 'split' || effectiveMapLayoutMode === 'linear') && (
                          <LinearSequenceView
                            doc={activeDoc}
                            overviewFitKey={sequenceOverviewFits}
                            cutSites={cutSites}
                            siteVisibility={mapSiteVisibility}
                            restrictionScope={restrictionScope}
                            selectedRange={selectedRange}
                            guideHighlight={guideHighlight}
                            onSelectRange={setSelectedRange}
                            onUpdateDocument={handleUpdateDocument}
                            showTranslation={showTranslation}
                            showGcGraph={showGcGraph}
                            showHydropathyGraph={showHydropathyGraph}
                            showFeatures={showFeatures}
                            showRestrictionSites={showRestrictionSites}
                            colorScheme={colorScheme}
                            onLoadBenchmarkDocument={handleLoadBenchmarkDocument}
                            onClearSelection={() => setSelectedRange(null)}
                            onExtractSelection={handleExtractSelectedRegion}
                            onConvertSelectionToOligo={handleConvertSelectionToOligo}
                            onStatusNotice={setStatusBanner}
                            onViewEnzyme={viewSiteEnzyme}
                            onAddEnzymeToCollection={addSiteEnzymeToCollection}
                          />
                        )}
                      </div>
                      {paneSplitShown && (
                        <>
                          {/* US-01M7CCRP: it stays, at the collapsed pane's edge, while a pane is collapsed, so focus stays on it and Enter restores. */}
                          <div
                            className="map-seq-divider"
                            role="separator"
                            tabIndex={0}
                            aria-orientation="vertical"
                            aria-label="Resize the circular and linear maps"
                            aria-valuenow={paneSplitValueNow(paneSplitDrawn)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuetext={
                              paneSplit.collapsed === 'circular'
                                ? 'Circular map collapsed'
                                : paneSplit.collapsed === 'linear'
                                  ? 'Linear map collapsed'
                                  : `Circular map ${paneSplitValueNow(paneSplitDrawn)}%, linear map ${100 - paneSplitValueNow(paneSplitDrawn)}%`
                            }
                            title={`Drag, or press Left/Right Arrow (${PANE_SPLIT_KEY_STEP_PX}px; Shift ${PANE_SPLIT_KEY_STEP_LARGE_PX}px), to resize the circular and linear maps • Home/End or a drag to an edge collapses one, Enter restores • Double-click to reset`}
                            onKeyDown={(e) => {
                              const width = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
                              const step = e.shiftKey ? PANE_SPLIT_KEY_STEP_LARGE_PX : PANE_SPLIT_KEY_STEP_PX;
                              let next: PaneSplitState;
                              if (e.key === 'ArrowLeft') next = stepPaneSplit(paneSplit, -step, width);
                              else if (e.key === 'ArrowRight') next = stepPaneSplit(paneSplit, step, width);
                              else if (e.key === 'Home') next = collapsePane(paneSplit, 'circular');
                              else if (e.key === 'End') next = collapsePane(paneSplit, 'linear');
                              else if (e.key === 'Enter') next = restorePanes(paneSplit);
                              else return;
                              e.preventDefault();
                              if (next !== paneSplit) setPaneSplit(next);
                            }}
                            onPointerDown={(e) => {
                              if (e.button !== 0 || paneSplitDragRef.current) return;
                              const handle = e.currentTarget;
                              const frame = handle.parentElement;
                              if (!frame) return;
                              // No text selection starts, and the captured pointer never reaches the map.
                              e.preventDefault();
                              const box = frame.getBoundingClientRect();
                              try {
                                handle.setPointerCapture(e.pointerId);
                              } catch {
                                // The pointer has already gone.
                              }
                              paneSplitDragRef.current = {
                                pointerId: e.pointerId,
                                left: box.left,
                                width: box.width,
                                start: paneSplit,
                                pending: paneSplit,
                                handle,
                                frame,
                              };
                              setPaneSplitDragging(true);
                            }}
                            onPointerMove={(e) => {
                              const drag = paneSplitDragRef.current;
                              if (!drag || e.pointerId !== drag.pointerId) return;
                              const x = e.clientX - drag.left;
                              drag.pending = dragPaneSplit(drag.start, x, drag.width);
                              showPaneSplitOnFrame(drag.frame, paneSplitRatioAt(x, drag.width), drag.pending.collapsed);
                            }}
                            onPointerUp={(e) => {
                              if (paneSplitDragRef.current?.pointerId === e.pointerId) finishPaneSplitDrag(true);
                            }}
                            onPointerCancel={(e) => {
                              if (paneSplitDragRef.current?.pointerId === e.pointerId) finishPaneSplitDrag(false);
                            }}
                            onLostPointerCapture={(e) => {
                              if (paneSplitDragRef.current?.pointerId === e.pointerId) finishPaneSplitDrag(true);
                            }}
                            onDoubleClick={() => setPaneSplit(resetPaneSplit())}
                          />
                          {!paneSplitCollapsed && (
                          <div className="map-seq-divider-controls">
                            <button
                              type="button"
                              aria-label="Collapse circular map"
                              title="Collapse the circular map; the linear map takes its space"
                              onClick={() => setPaneSplit((s) => collapsePane(s, 'circular'))}
                            >
                              <ChevronLeft size={12} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label="Collapse linear map"
                              title="Collapse the linear map; the circular map takes its space"
                              onClick={() => setPaneSplit((s) => collapsePane(s, 'linear'))}
                            >
                              <ChevronRight size={12} aria-hidden="true" />
                            </button>
                          </div>
                          )}
                        </>
                      )}
                      {paneSplitCollapsed === 'linear' && (
                        <button
                          type="button"
                          className="map-seq-restore restore-linear"
                          aria-label="Restore linear map"
                          title="Restore the linear map beside the circular map"
                          onClick={() => setPaneSplit(restorePanes)}
                        >
                          <ChevronLeft size={14} aria-hidden="true" />
                          <span>Linear map</span>
                        </button>
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

                {viewerTab === 'document-info' && <DocumentInfoPanel key={activeDoc.id} doc={activeDoc} onUpdateDocument={handleUpdateDocument}
                  alerts={<React.Suspense fallback={null}><SequenceAlertsPanel doc={activeDoc} allDocuments={documents} enzymes={activeEnzymes}
                    scanCollection={scanCollectionChoice.collection} onUpdateDocument={handleUpdateDocument} /></React.Suspense>}
                  searchMatch={searchMatchShown?.docId === activeDoc.id ? searchMatchShown.hit : null} />}

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
                        : viewerTab === 'protein-3d'
                        ? 'Loading Protein & 3D Studio…'
                        : viewerTab === 'genomics-ngs'
                        ? 'Loading Pipelines & NGS Studio…'
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
                      hostedPanel={activeDoc.docMetadata?.['Document Type'] === 'Enzyme Set'
                        ? hostedPanelNode('enzymes', false)
                        : hostedPanel?.kind === 'enzymes' && hostedPanel.tab === 'cloning-gel' ? hostedPanelNode('enzymes') : undefined}
                      enzymes={activeEnzymes}
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
                      hostedPanel={hostedPanel?.kind === 'folding' && hostedPanel.tab === 'primers-pcr' ? hostedPanelNode('folding') : undefined}
                      initialSubTab={primersInitialSubTab}
                      commandNonce={studioCommandNonce}
                      /* The one active interval (PRD F03): the bases on screen, which Find CRISPR
                         Sites offers as the range to search beside the whole sequence
                         (US-01M7DVAS). */
                      selectedRange={selectedRange}
                      /* The 5' tail pickers offer the catalogue and every stored custom enzyme, by key (BG-01M7DX96). */
                      enzymes={activeEnzymes}
                      primerDatabaseRevision={primerDbRefresh}
                      onPrimerDatabaseChanged={() => setPrimerDbRefresh((n) => n + 1)}
                      allDocuments={documents}
                      onUpdateDocument={handleUpdateDocument}
                      onAddConstruct={handleAddConstruct}
                      onStatusNotice={setStatusBanner}
                      onJumpToCoordinate={(start, end, label, guide) => {
                        setSelectedRange({ start, end, label });
                        // A guide row hands its two parts along with its site (US-01M7DVA6): the
                        // views draw the spacer and the PAM apart. Nothing here edits the document.
                        setCrisprGuideShown(guide ? { ...guide, docId: activeDoc.id } : null);
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
                    activeDoc.docMetadata?.Newick && treeStudioFor === activeDoc.id && phylogenyInputs.length >= 2 ? (
                      <>
                        <div className="mbc-tree-studio-back">
                          <button type="button" className="btn-secondary-sm" onClick={() => setTreeStudioFor(null)}>
                            Back to tree
                          </button>
                        </div>
                        <PhylogeneticsStudio
                          key={`tree-studio-${activeDoc.id}`}
                          documents={phylogenyInputs}
                          activeDoc={activeDoc}
                          initialPhyloTab={phyloInitialTab}
                          initialTreeAlgorithm={phyloInitialTreeAlgo}
                          initialModelsSubView={phyloInitialModelsView}
                          initialAncestralMethod={phyloInitialAncestralMethod}
                          commandNonce={phyloCommandNonce}
                          initialUserNewick={String(activeDoc.docMetadata.Newick)}
                        />
                      </>
                    ) :
                    activeDoc.docMetadata?.Newick ? (
                      <>
                        {treePairing && (
                          <div className="mbc-tree-pairing">
                            <label>
                              <span>Paired alignment</span>{' '}
                              <select
                                aria-label="Paired alignment"
                                value={treePairing.chosenId}
                                onChange={(e) => { if (e.target.value) pairTreeWithAlignment(e.target.value); }}
                              >
                                <option value="">Choose an alignment…</option>
                                {treePairing.choices.map((d) => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>
                            </label>
                            {treePairing.missingName !== null && (
                              <span role="status">
                                {`The paired alignment ${treePairing.missingName} is no longer in the session; choose another.`}
                              </span>
                            )}
                            {treePairing.fewRowsName !== null && (
                              <span role="status">
                                {`The paired alignment ${treePairing.fewRowsName} has fewer than two rows; choose another.`}
                              </span>
                            )}
                          </div>
                        )}
                        <ImportedTreeViewer
                          key={activeDoc.id}
                          doc={activeDoc}
                          onUpdateDocument={(d) => handleUpdateDocument(d, 'Edit Tree')}
                          onDownload={(content, name, mime) => void handleDownloadFile(content, name, mime)}
                          onDownloadBinary={(bytes, name, mime) => void handleDownloadBinaryFile(bytes, name, mime)}
                        />
                      </>
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

                  {viewerTab === 'protein-3d' && (
                    <ProteinStudio
                      activeDoc={activeDoc}
                      proteinDocuments={genomicsProteinDocs}
                      selectedDocuments={selectedAnalysisDocuments}
                      selectedRange={selectedRange}
                      onUpdateDocument={handleUpdateDocument}
                      onStatusBanner={(msg) => setStatusBanner(msg)}
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
                      onSubTabChange={setGenomicsInitialSubTab}
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
                      enzymes={activeEnzymes}
                      scanCollection={scanCollectionChoice.collection}
                      collectionsRevision={enzymeCollectionsRevision}
                      onCollectionsChange={() => setEnzymeCollectionsRevision((n) => n + 1)}
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
                      view={pipelinesView}
                      onChangeView={setPipelinesView}
                      workflowsPanel={
                        <React.Suspense fallback={null}>
                          <WorkflowsPanel doc={activeDoc} allDocuments={documents} onUpdateDocument={handleUpdateDocument}
                            initialPluginId={hybridInitialPluginId} commandNonce={studioCommandNonce} />
                        </React.Suspense>
                      }
                      hostOs={displayOs}
                      onChangePreviewOs={(os) => setPreviewOsOverride(os)}
                      onSelectDocument={(docId) => selectDocumentWithHistory(docId)}
                      onSelectRange={setSelectedRange}
                      /* A folding step opens its studio on the folding panel (US-01M7QC8Q): folding is a panel there, not a tab. */
                      onNavigateStudio={(studio, step) => step && PIPELINE_FOLDING_STEP_IDS.has(step.id) ? openFoldingPanel() : setViewerTab(studio)}
                      onStatusMessage={(msg) => setStatusBanner(msg)}
                    />
                  )}
                </React.Suspense>
                </WorkbenchInspectorProvider>
                              </ErrorBoundary>
                )}
              </div>
              {documentSplit !== 'single' && (
                <DocumentSplitDivider
                  orientation={documentSplit}
                  size={documentSplitSize}
                  drawnRatio={documentSplitDrawnRatio}
                  onChange={setDocumentSplitSize}
                />
              )}
              {documentSplit !== 'single' && (
                <SplitDocumentPane
                  doc={splitDoc}
                  choices={[...openDocs.filter((d) => d.id !== activeDoc.id), ...catalogNonDeletedDocs.filter((d) => d.id !== activeDoc.id && !openDocs.some((o) => o.id === d.id))]}
                  onChooseDoc={(id) => showInSplitPane(id)}
                  onShowMainDoc={() => showInSplitPane(activeDoc.id)}
                  mainDocId={activeDoc.id}
                  mainRange={selectedRange}
                  onSelectMainRange={setSelectedRange}
                  view={splitView}
                  onViewChange={setSplitView}
                  zoomLevel={splitZoom}
                  onZoomChange={setSplitZoom}
                  rotationDeg={splitRotation}
                  onRotate={setSplitRotation}
                  rotateOpen={splitRotateOpen}
                  onRotateOpenChange={setSplitRotateOpen}
                  viewRestoreKey={splitViewRestores}
                  overviewFitKey={splitOverviewFits}
                  tracks={{ showFeatures, showRestrictionSites, showTranslation, showGcGraph, showHydropathyGraph }}
                  focused={secondPaneFocused}
                  onFocusPane={() => setFocusedPane('second')}
                  onSwap={(paneRange) => {
                    const other = splitDocId;
                    if (!other) return;
                    // Each document's zoom and rotation move with it (US-01M7DVQG): the main view takes
                    // the pane's and the pane the main view's, the same documents or not.
                    const mainZoom = zoomLevel;
                    setZoomLevel(splitZoom);
                    setSplitZoom(mainZoom);
                    setSplitRotation(activeMapRotation);
                    setMainMapRotationOf(other, splitRotation);
                    // The same document in both panes: only the zoom and rotation change places; the main
                    // view's document, tab, selection and navigation history stay as they are.
                    if (other === activeDoc.id) return;
                    setSplitDocId(activeDoc.id);
                    selectDocumentWithHistory(other);
                    // The pane's selection comes with its document (US-01M7DV3V); none stays none.
                    setSelectedRange(paneRange);
                  }}
                  onClose={() => chooseDocumentSplit('single')}
                  onUpdateDocument={(d) => handleUpdateDocument(d)}
                  onDownload={(content, name, mime) => void handleDownloadFile(content, name, mime)}
                  onDownloadBinary={(bytes, name, mime) => void handleDownloadBinaryFile(bytes, name, mime)}
                  enzymes={activeEnzymes}
                  scanCollection={scanCollectionChoice.collection}
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
                              disabled={!trackAvailability('translation', buildCommandContext()).enabled}
                              title={trackAvailability('translation', buildCommandContext()).reason}
                              onChange={(e) => setShowTranslation(e.target.checked)}
                            />
                            <span>Show 3-Frame Translation</span>
                          </label>
                          {/* The genetic-code tables sit beside translation (D0017, US-01M7QC8Q). */}
                          <div className="mbc-control-row" role="group" aria-label="Genetic code tables">
                            <span>Genetic Code Tables:</span>
                            <ul className="mbc-genetic-code-tables">
                              {GENETIC_CODE_NAMES.map((name) => <li key={name}>{name}</li>)}
                            </ul>
                          </div>
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
                            disabled={!trackAvailability('primers', buildCommandContext()).enabled}
                            title={trackAvailability('primers', buildCommandContext()).reason}
                            onChange={(e) => setShowPrimers(e.target.checked)}
                          />
                          <span>Primers ({activeDoc.primers.length})</span>
                        </label>)}
                        {!isProteinSequence && (<label className="mbc-check-row">
                          <input
                            type="checkbox"
                            checked={showOrfs}
                            disabled={!trackAvailability('orfs', buildCommandContext()).enabled}
                            title={trackAvailability('orfs', buildCommandContext()).reason}
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
                            disabled={!trackAvailability('gc-graph', buildCommandContext()).enabled}
                            title={trackAvailability('gc-graph', buildCommandContext()).reason}
                            onChange={(e) => setShowGcGraph(e.target.checked)}
                          />
                          <span>GC% &amp; AT% Content Plot</span>
                        </label>)}
                        <label className="mbc-check-row">
                          <input
                            type="checkbox"
                            checked={showHydropathyGraph}
                            disabled={!trackAvailability('hydropathy-graph', buildCommandContext()).enabled}
                            title={trackAvailability('hydropathy-graph', buildCommandContext()).reason}
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
                          {/* The enzymes the main display scan reads (US-01M7JPK6, D0164). */}
                          <div className="mbc-scan-collection">
                            <select
                              aria-label="Enzymes the site scans read"
                              value={scanCollectionValue}
                              onChange={(e) => chooseScanCollection(e.target.value === '' ? null : e.target.value)}
                            >
                              <option value="">All enzymes</option>
                              {scanCollectionOptions.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {`${c.name} (${c.enzymeIds.length.toLocaleString()} ${c.enzymeIds.length === 1 ? 'enzyme' : 'enzymes'})`}
                                </option>
                              ))}
                            </select>
                          </div>
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
                            <span>{onceCutterListName} ({uniqueCutters.length})</span>
                          </label>
                          <div className="mbc-enzyme-cloud">
                            {uniqueCutters.map((site) => {
                              const name = enzymeLabel(site.enzyme);
                              const cutAt = cutSiteDisplayPosition(site.cutTop, activeDoc.sequence.length, activeDoc.topology === 'circular');
                              return (
                                <button
                                  type="button"
                                  key={enzymeKey(site.enzyme)}
                                  className="mbc-enz-pill"
                                  onClick={() =>
                                    setSelectedRange({
                                      start: site.position,
                                      end: site.position + site.enzyme.recognitionSeq.length - 1,
                                      label: `${name} cuts after ${cutAt}`,
                                    })
                                  }
                                >
                                  {name} ({cutAt})
                                </button>
                              );
                            })}
                          </div>
                          {restrictionMolecule && activeSiteVisibility && (
                            <DisplayedSitesPanel
                              key={activeDoc.id}
                              sites={cutSites}
                              siteCounts={restrictionSiteCounts}
                              visibility={activeSiteVisibility}
                              molecule={restrictionMolecule}
                              uniqueCuttersOnly={showUniqueCuttersOnly}
                              onVisibilityChange={handleSiteVisibilityChange}
                              onGoToSite={goToCutSite}
                              onViewEnzyme={viewSiteEnzyme}
                              onAddEnzymeToCollection={addSiteEnzymeToCollection}
                            />
                          )}
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
                                {massesNote !== null && <p className="mbc-summary-note">{massesNote}</p>}
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
        )}
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
              {autosaveFailure && (<>
              <button
                type="button"
                className="statusbar-autosave-failed"
                data-no-window-drag
                onClick={() => handleSaveMbcWorkbench(true)}
                title={autosaveFailure}
                style={{ color: 'var(--mbc-danger, #b91c1c)', fontWeight: 600, background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
              >
                Autosave failed: save the session
              </button>
              <span>•</span>
              </>)}
              {activeDoc.id ? (<>
              <span>
                Document: <strong>{activeDoc.name}</strong>{activeDoc.accession ? ` (${activeDoc.accession})` : ''}
              </span>
              <span>•</span>
              <span>
                {activeDoc.documentKind === 'tree'
                  ? `Tips: ${activeDoc.docMetadata?.['No. tips'] ?? 'unknown'}`
                  : selectionIv && selectionComposition
                  ? <>{`Selection: ${
                      // The shared label, '5,990..71 (143 bp, across the origin)', its ')' moved past GC and Tm.
                      formatIntervalLabel(selectionIv, activeDoc.sequence.length, activeDoc.topology, intervalUnit(activeDoc.moleculeType)).slice(0, -1)
                    } | GC: ${selectionComposition.gcPercent.toFixed(1)}% | Tm: `}{selectionTm(selectionComposition)})</>
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
                    <span className="statusbar-toast-text" title={statusBanner}>{statusBanner}</span>
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
                    <span className="statusbar-toast-text" title={statusBanner}>{statusBanner}</span>
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
          enzymes={activeEnzymes}
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
          enzymes={activeEnzymes}
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
          enzymes={activeEnzymes}
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
          enzymes={activeEnzymes}
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
          databaseRead={primerDbReadForDialog}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onApply={(r) => {
            for (const d of r.updated) handleUpdateDocument(d, 'Test with Saved Primers');
            setStatusBanner(r.summary);
          }}
          onClose={() => setOperationDialog(null)}
        />
      )}
      {operationDialog?.kind === 'primer-db-binding' && (
        <PrimerBindingDialog
          databaseRead={primerDbReadForDialog ?? openPrimerDatabase().read()}
          documents={catalogNonDeletedDocs}
          initialPrimerIds={operationDialog.primerIds}
          initialTargetIds={(selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []).map((d) => d.id)}
          onDownload={(content, name) => void handleDownloadFile(content, name, 'application/json')}
          onAdd={(updated, summary) => {
            // One undoable step for every target (US-01M7DQMY AC3).
            handleUpdateDocuments(updated, 'Add Primer Binding Sites');
            setStatusBanner(summary);
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
      {operationDialog?.kind === 'convert-genbank' && (
        <GenbankToDialog
          records={sessionActive ? (selectedAnalysisDocuments.length ? selectedAnalysisDocuments : activeDoc.id ? [activeDoc] : []) : []}
          activeName={activeDoc.name}
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
                  choosePaletteItem(commandPaletteItems[commandPaletteIdx]);
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
                  data-studio={it.studio}
                  data-command-id={it.commandId}
                  aria-disabled={it.disabled ? true : undefined}
                  title={it.disabled ? it.reason : undefined}
                  className={`mbc-cmd-palette-item ${
                    idx === commandPaletteIdx ? 'selected' : ''
                  }${it.disabled ? ' disabled' : ''}`}
                  onClick={() => choosePaletteItem(it)}
                >
                  <span>
                    <strong>{it.label}</strong>
                    {it.path && <span className="mbc-cmd-palette-path">{it.path.join(' › ')}</span>}
                    {it.disabled && it.reason && <span className="mbc-cmd-palette-reason">{it.reason}</span>}
                  </span>
                  <span className="mbc-cmd-palette-meta">
                    <span className="mbc-cmd-cat-pill">{it.category}</span>
                    {it.hint && <span>{it.hint}</span>}
                    {it.shortcut && <kbd className="mbc-cmd-palette-key">{it.shortcut}</kbd>}
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
          // The Keyboard tab lists the shortcuts of the trees the shortcut dispatcher reads (US-01M6P2G2).
          menuTrees={Object.values(topMenus)}
          menuTreeLabels={Object.keys(topMenus).map((id) =>
            id === 'app' ? 'MolBioCraft' : topMenuBarEntries.find((entry) => entry.id === id)?.label ?? id
          )}
          shortcutOs={displayOs}
          onResetAllPreferences={() => {
            resetUserPreferences();
            applyThemePreference('system');
            applyConfirmBeforeQuitPreference(true);
            setStatusBanner('All preferences were reset to their defaults.');
          }}
        />
      )}

      {helpPanelOpen && <HelpPanel viewerTab={viewerStudio.opens.tab} onClose={() => setHelpPanelOpen(false)} />}

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

      {projectSearch && (
        <ProjectSearchPanel
          key={projectSearch.key}
          folderId={projectSearch.folderId}
          initialScope={projectSearch.scope}
          context={projectSearchContext}
          onClose={() => setProjectSearch(null)}
          onOpenHit={handleOpenSearchHit}
          onOpenPrimerRecord={openPrimerDatabaseOnRecord}
          initialSaved={projectSearch.saved}
          onReopenSaved={(folderId, saved) => openProjectSearch(folderId, saved.scope, saved)}
          onApplyTableSearch={applyTableSearch}
          onSavedSearchesChanged={() => setSavedSearches(loadSavedSearches())}
        />
      )}
      {primerDbWindow && (
        <PrimerDatabaseWindow
          returnFocusTo={primerDbWindow.opener}
          refreshKey={primerDbRefresh}
          showRecord={primerDbWindow.showRecord}
          onStoreChanged={() => setPrimerDbRefresh((n) => n + 1)}
          onOpenImport={() => setPrimerDbImportOpen(true)}
          onFindBindings={(primerIds) =>
            requireActiveSession(() => setOperationDialog({ kind: 'primer-db-binding', primerIds }))
          }
          onClose={() => setPrimerDbWindow(null)}
        />
      )}
      {enzymeDbWindow && (
        <EnzymeDatabaseWindow
          returnFocusTo={enzymeDbWindow.opener}
          intent={enzymeDbWindow.intent}
          onClose={() => setEnzymeDbWindow(null)}
          onChange={() => setEnzymeDbRevision((n) => n + 1)}
          onCollectionsChange={() => setEnzymeCollectionsRevision((n) => n + 1)}
        />
      )}
      {primerDbImportOpen && (
        <ImportPrimersToDatabaseDialog
          onSaved={(report) => {
            setPrimerDbRefresh((n) => n + 1);
            setStatusBanner(report);
          }}
          onClose={() => {
            setPrimerDbImportOpen(false);
            setPrimerDbRefresh((n) => n + 1);
          }}
        />
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
          onConfirmQuit={(dontAskAgain) => void executeConfirmedAppQuit(dontAskAgain)}
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
