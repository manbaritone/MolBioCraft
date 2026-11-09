// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Persisted user preferences that the workbench reads and updates live. Each value
 * has a default, survives restarts (localStorage), is included in the exported
 * preferences file (.mbcprefs.json), and is restored by "Reset All Preferences".
 */

export interface SequenceViewDefaults {
  showOrfs: boolean;
  minOrfAa: number;
  allowAltStartCodons: boolean;
  showPrimers: boolean;
  showTranslation: boolean;
  showGcGraph: boolean;
  uniqueCuttersOnly: boolean;
}

export interface GeneralPreferences {
  singleWindow: boolean;
  autoOpenProjectTable: boolean;
  confirmFileMoveRename: boolean;
  multiLineTabStrip: boolean;
  lightBgSwatch: '#ffffff' | '#f8fafc' | '#fefcf3' | '#f2fbf7';
  colorfulIcons: boolean;
  defaultFontSizePt: number;
  defaultStrain: 'None' | 'DH5a' | 'TOP10' | 'JM110' | 'BL21' | 'Stbl3';
  propagateStrain: boolean;
  updateCheckInterval: 'auto' | 'weekly' | 'monthly' | 'manual';
}

export interface FilesAndTabsPreferences {
  restoreOpenTabs: boolean;
  defaultDirectory: string;
  defaultAuthor: string;
  limitHistoryTrees: boolean;
  maxHistorySteps: number;
  showFileExtensions: boolean;
  convertMrnaToDsDna: boolean;
  allowPlainTextRawSeq: boolean;
  transferSourceFeatures: boolean;
}

export interface ExportDefaultsPreferences {
  dnaFormat: 'gb' | 'fasta' | 'embl' | 'gff3';
  rnaFormat: 'gb' | 'fasta' | 'embl';
  proteinFormat: 'gp' | 'faa';
  alignmentFormat: 'clustal' | 'fasta' | 'phylip' | 'nexus';
  useFileNameAsLocus: boolean;
  limitLocusLength: boolean;
  maxLocusChars: number;
  exportLabelQualifier: boolean;
  useMiscFeatureFallback: boolean;
}

export interface DnaDisplayPreferences {
  showEnzymes: boolean;
  showFeatures: boolean;
  showFeatureArrows: boolean;
  curveFeatureLabels: boolean;
  showGcSkewRing: boolean;
  showHistoryColors: boolean;
  showBothStrands: boolean;
  groupTenBpBlocks: boolean;
  colorCodeNucleotides: boolean;
  lowercaseOverhangs: boolean;
}

export interface RnaDisplayPreferences {
  showFeatures: boolean;
  showOrfs: boolean;
  minOrfAa: number;
  startCodonMode: 'aug_ends' | 'aug_strict' | 'aug_cug';
  singleStrandedLayout: boolean;
  groupTenNtBlocks: boolean;
  annotateKozakAndReadthrough: boolean;
  showFoldedBaseIndices: boolean;
  colorStemLoopsByDeltaG: boolean;
  showGuWobblePairs: boolean;
  alwaysDisplayUracil: boolean;
}

export interface ProteinDisplayPreferences {
  showRegions: boolean;
  showSites: boolean;
  showBonds: boolean;
  showDomainCoordinates: boolean;
  showHydropathyAndPiBar: boolean;
  showProteaseSites: boolean;
  colorScheme: 'hydrophobicity' | 'charge' | 'rasmol' | 'none';
  aminoAcidCode: '1letter' | '3letter';
  groupTenAaBlocks: boolean;
  showDaltonsAlongsideKda: boolean;
}

export interface AgaroseGelPreferences {
  defaultMwMarker: '1kb' | '1kb_plus' | '100bp' | 'lambda_hindiii' | 'ultralow';
  numberMarkerLanes: boolean;
  bandReferenceEdge: 'middle' | 'front' | 'back';
  scaleIntensityByMass: boolean;
  migrationBuffer: 'TBE' | 'TAE' | 'SB';
}

export interface TracesAlignmentPreferences {
  autoscaleHeights: boolean;
  useLinearView: boolean;
  traceFormat: 'above' | 'inside' | 'compact';
  shading: boolean;
  stripedA: boolean;
  thinLines: boolean;
  tickMarks: boolean;
  includeParamsTab: boolean;
  trimStringency: 'high' | 'medium' | 'low' | 'none';
  showQualityBars: boolean;
}

export interface EnzymesPreferences {
  italicPalindromic6Plus: boolean;
  boldUniqueCutters: boolean;
  greenBluntCutters: boolean;
  flagMethylationSites: boolean;
  defaultViewMode: 'numbers' | 'lines';
  topSuppliersInTooltips: number;
  parentalEnzymeSet: 'nonredundant_303' | 'all_commercial' | 'common_cloning' | 'rebase_full';
}

export interface PrimersPreferences {
  minContinuousMatch3p: number;
  altMatch3pBases: number;
  altMatch3pMinTmC: number;
  allowOneInternalMismatch: boolean;
  largeGenomeExactMatch3p: number;
  largeGenomeMinTmC: number;
  alertSecondary5pBp: number;
  mismatchDisplayStyle: 'loop' | 'inline';
  monovalentSaltMm: number;
  divalentMgMm: number;
  primerConcNm: number;
}

export interface UserPreferences {
  /** What to show at launch when an autosaved session exists. */
  startup: 'home' | 'restore';
  /** Line endings for exported text files. */
  exportLineEnding: 'system' | 'lf' | 'crlf';
  view: SequenceViewDefaults;
  general: GeneralPreferences;
  filesAndTabs: FilesAndTabsPreferences;
  exportDefaults: ExportDefaultsPreferences;
  dnaDisplay: DnaDisplayPreferences;
  rnaDisplay: RnaDisplayPreferences;
  proteinDisplay: ProteinDisplayPreferences;
  agaroseGel: AgaroseGelPreferences;
  traces: TracesAlignmentPreferences;
  enzymes: EnzymesPreferences;
  primers: PrimersPreferences;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  startup: 'home',
  exportLineEnding: 'system',
  view: {
    showOrfs: true,
    minOrfAa: 50,
    allowAltStartCodons: false,
    showPrimers: true,
    showTranslation: true,
    showGcGraph: true,
    uniqueCuttersOnly: true,
  },
  general: {
    singleWindow: true,
    autoOpenProjectTable: true,
    confirmFileMoveRename: true,
    multiLineTabStrip: false,
    lightBgSwatch: '#ffffff',
    colorfulIcons: true,
    defaultFontSizePt: 12,
    defaultStrain: 'DH5a',
    propagateStrain: true,
    updateCheckInterval: 'auto',
  },
  filesAndTabs: {
    restoreOpenTabs: true,
    defaultDirectory: '~/Documents/MolBioCraft_Projects',
    defaultAuthor: 'MolBioCraft Researcher',
    limitHistoryTrees: true,
    maxHistorySteps: 50,
    showFileExtensions: true,
    convertMrnaToDsDna: true,
    allowPlainTextRawSeq: true,
    transferSourceFeatures: false,
  },
  exportDefaults: {
    dnaFormat: 'gb',
    rnaFormat: 'gb',
    proteinFormat: 'gp',
    alignmentFormat: 'clustal',
    useFileNameAsLocus: true,
    limitLocusLength: true,
    maxLocusChars: 16,
    exportLabelQualifier: true,
    useMiscFeatureFallback: true,
  },
  dnaDisplay: {
    showEnzymes: true,
    showFeatures: true,
    showFeatureArrows: true,
    curveFeatureLabels: true,
    showGcSkewRing: true,
    showHistoryColors: true,
    showBothStrands: true,
    groupTenBpBlocks: true,
    colorCodeNucleotides: true,
    lowercaseOverhangs: true,
  },
  rnaDisplay: {
    showFeatures: true,
    showOrfs: true,
    minOrfAa: 75,
    startCodonMode: 'aug_ends',
    singleStrandedLayout: true,
    groupTenNtBlocks: true,
    annotateKozakAndReadthrough: true,
    showFoldedBaseIndices: true,
    colorStemLoopsByDeltaG: true,
    showGuWobblePairs: true,
    alwaysDisplayUracil: true,
  },
  proteinDisplay: {
    showRegions: true,
    showSites: true,
    showBonds: true,
    showDomainCoordinates: true,
    showHydropathyAndPiBar: true,
    showProteaseSites: true,
    colorScheme: 'hydrophobicity',
    aminoAcidCode: '1letter',
    groupTenAaBlocks: true,
    showDaltonsAlongsideKda: true,
  },
  agaroseGel: {
    defaultMwMarker: '1kb_plus',
    numberMarkerLanes: true,
    bandReferenceEdge: 'middle',
    scaleIntensityByMass: true,
    migrationBuffer: 'TBE',
  },
  traces: {
    autoscaleHeights: true,
    useLinearView: true,
    traceFormat: 'above',
    shading: true,
    stripedA: false,
    thinLines: false,
    tickMarks: true,
    includeParamsTab: true,
    trimStringency: 'medium',
    showQualityBars: true,
  },
  enzymes: {
    italicPalindromic6Plus: true,
    boldUniqueCutters: true,
    greenBluntCutters: true,
    flagMethylationSites: true,
    defaultViewMode: 'numbers',
    topSuppliersInTooltips: 2,
    parentalEnzymeSet: 'nonredundant_303',
  },
  primers: {
    minContinuousMatch3p: 15,
    altMatch3pBases: 10,
    altMatch3pMinTmC: 40,
    allowOneInternalMismatch: true,
    largeGenomeExactMatch3p: 15,
    largeGenomeMinTmC: 40,
    alertSecondary5pBp: 15,
    mismatchDisplayStyle: 'loop',
    monovalentSaltMm: 50,
    divalentMgMm: 1.5,
    primerConcNm: 250,
  },
};

const STORAGE_KEY = 'molbiocraft.userPreferences.v1';
export const USER_PREFERENCES_EVENT = 'molbiocraft:user-preferences';

function clampInt(x: unknown, min: number, max: number, def: number): number {
  if (typeof x === 'number' && Number.isFinite(x)) {
    return Math.min(max, Math.max(min, Math.round(x)));
  }
  return def;
}

function clampFloat(x: unknown, min: number, max: number, def: number): number {
  if (typeof x === 'number' && Number.isFinite(x)) {
    return Math.min(max, Math.max(min, x));
  }
  return def;
}

function oneOf<T extends string>(x: unknown, allowed: readonly T[], def: T): T {
  return typeof x === 'string' && (allowed as readonly string[]).includes(x) ? (x as T) : def;
}

/** Validates any parsed object into a complete preferences value. */
export function normalizeUserPreferences(raw: unknown): UserPreferences {
  const d = DEFAULT_USER_PREFERENCES;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<UserPreferences>;
  const v = (r.view && typeof r.view === 'object' ? r.view : {}) as Partial<SequenceViewDefaults>;
  const g = (r.general && typeof r.general === 'object' ? r.general : {}) as Partial<GeneralPreferences>;
  const ft = (r.filesAndTabs && typeof r.filesAndTabs === 'object' ? r.filesAndTabs : {}) as Partial<FilesAndTabsPreferences>;
  const ex = (r.exportDefaults && typeof r.exportDefaults === 'object' ? r.exportDefaults : {}) as Partial<ExportDefaultsPreferences>;
  const dna = (r.dnaDisplay && typeof r.dnaDisplay === 'object' ? r.dnaDisplay : {}) as Partial<DnaDisplayPreferences>;
  const rna = (r.rnaDisplay && typeof r.rnaDisplay === 'object' ? r.rnaDisplay : {}) as Partial<RnaDisplayPreferences>;
  const prot = (r.proteinDisplay && typeof r.proteinDisplay === 'object' ? r.proteinDisplay : {}) as Partial<ProteinDisplayPreferences>;
  const gel = (r.agaroseGel && typeof r.agaroseGel === 'object' ? r.agaroseGel : {}) as Partial<AgaroseGelPreferences>;
  const tr = (r.traces && typeof r.traces === 'object' ? r.traces : {}) as Partial<TracesAlignmentPreferences>;
  const enz = (r.enzymes && typeof r.enzymes === 'object' ? r.enzymes : {}) as Partial<EnzymesPreferences>;
  const prm = (r.primers && typeof r.primers === 'object' ? r.primers : {}) as Partial<PrimersPreferences>;

  const bool = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def);
  const str = (x: unknown, def: string) => (typeof x === 'string' ? x : def);

  return {
    startup: r.startup === 'restore' ? 'restore' : 'home',
    exportLineEnding: r.exportLineEnding === 'lf' || r.exportLineEnding === 'crlf' ? r.exportLineEnding : 'system',
    view: {
      showOrfs: bool(v.showOrfs, d.view.showOrfs),
      minOrfAa: clampInt(v.minOrfAa, 10, 1000, d.view.minOrfAa),
      allowAltStartCodons: bool(v.allowAltStartCodons, d.view.allowAltStartCodons),
      showPrimers: bool(v.showPrimers, d.view.showPrimers),
      showTranslation: bool(v.showTranslation, d.view.showTranslation),
      showGcGraph: bool(v.showGcGraph, d.view.showGcGraph),
      uniqueCuttersOnly: bool(v.uniqueCuttersOnly, d.view.uniqueCuttersOnly),
    },
    general: {
      singleWindow: bool(g.singleWindow, d.general.singleWindow),
      autoOpenProjectTable: bool(g.autoOpenProjectTable, d.general.autoOpenProjectTable),
      confirmFileMoveRename: bool(g.confirmFileMoveRename, d.general.confirmFileMoveRename),
      multiLineTabStrip: bool(g.multiLineTabStrip, d.general.multiLineTabStrip),
      lightBgSwatch: oneOf(g.lightBgSwatch, ['#ffffff', '#f8fafc', '#fefcf3', '#f2fbf7'] as const, d.general.lightBgSwatch),
      colorfulIcons: bool(g.colorfulIcons, d.general.colorfulIcons),
      defaultFontSizePt: clampInt(g.defaultFontSizePt, 8, 24, d.general.defaultFontSizePt),
      defaultStrain: oneOf(g.defaultStrain, ['None', 'DH5a', 'TOP10', 'JM110', 'BL21', 'Stbl3'] as const, d.general.defaultStrain),
      propagateStrain: bool(g.propagateStrain, d.general.propagateStrain),
      updateCheckInterval: oneOf(g.updateCheckInterval, ['auto', 'weekly', 'monthly', 'manual'] as const, d.general.updateCheckInterval),
    },
    filesAndTabs: {
      restoreOpenTabs: bool(ft.restoreOpenTabs, d.filesAndTabs.restoreOpenTabs),
      defaultDirectory: str(ft.defaultDirectory, d.filesAndTabs.defaultDirectory),
      defaultAuthor: str(ft.defaultAuthor, d.filesAndTabs.defaultAuthor),
      limitHistoryTrees: bool(ft.limitHistoryTrees, d.filesAndTabs.limitHistoryTrees),
      maxHistorySteps: clampInt(ft.maxHistorySteps, 5, 500, d.filesAndTabs.maxHistorySteps),
      showFileExtensions: bool(ft.showFileExtensions, d.filesAndTabs.showFileExtensions),
      convertMrnaToDsDna: bool(ft.convertMrnaToDsDna, d.filesAndTabs.convertMrnaToDsDna),
      allowPlainTextRawSeq: bool(ft.allowPlainTextRawSeq, d.filesAndTabs.allowPlainTextRawSeq),
      transferSourceFeatures: bool(ft.transferSourceFeatures, d.filesAndTabs.transferSourceFeatures),
    },
    exportDefaults: {
      dnaFormat: oneOf(ex.dnaFormat, ['gb', 'fasta', 'embl', 'gff3'] as const, d.exportDefaults.dnaFormat),
      rnaFormat: oneOf(ex.rnaFormat, ['gb', 'fasta', 'embl'] as const, d.exportDefaults.rnaFormat),
      proteinFormat: oneOf(ex.proteinFormat, ['gp', 'faa'] as const, d.exportDefaults.proteinFormat),
      alignmentFormat: oneOf(ex.alignmentFormat, ['clustal', 'fasta', 'phylip', 'nexus'] as const, d.exportDefaults.alignmentFormat),
      useFileNameAsLocus: bool(ex.useFileNameAsLocus, d.exportDefaults.useFileNameAsLocus),
      limitLocusLength: bool(ex.limitLocusLength, d.exportDefaults.limitLocusLength),
      maxLocusChars: clampInt(ex.maxLocusChars, 10, 32, d.exportDefaults.maxLocusChars),
      exportLabelQualifier: bool(ex.exportLabelQualifier, d.exportDefaults.exportLabelQualifier),
      useMiscFeatureFallback: bool(ex.useMiscFeatureFallback, d.exportDefaults.useMiscFeatureFallback),
    },
    dnaDisplay: {
      showEnzymes: bool(dna.showEnzymes, d.dnaDisplay.showEnzymes),
      showFeatures: bool(dna.showFeatures, d.dnaDisplay.showFeatures),
      showFeatureArrows: bool(dna.showFeatureArrows, d.dnaDisplay.showFeatureArrows),
      curveFeatureLabels: bool(dna.curveFeatureLabels, d.dnaDisplay.curveFeatureLabels),
      showGcSkewRing: bool(dna.showGcSkewRing, d.dnaDisplay.showGcSkewRing),
      showHistoryColors: bool(dna.showHistoryColors, d.dnaDisplay.showHistoryColors),
      showBothStrands: bool(dna.showBothStrands, d.dnaDisplay.showBothStrands),
      groupTenBpBlocks: bool(dna.groupTenBpBlocks, d.dnaDisplay.groupTenBpBlocks),
      colorCodeNucleotides: bool(dna.colorCodeNucleotides, d.dnaDisplay.colorCodeNucleotides),
      lowercaseOverhangs: bool(dna.lowercaseOverhangs, d.dnaDisplay.lowercaseOverhangs),
    },
    rnaDisplay: {
      showFeatures: bool(rna.showFeatures, d.rnaDisplay.showFeatures),
      showOrfs: bool(rna.showOrfs, d.rnaDisplay.showOrfs),
      minOrfAa: clampInt(rna.minOrfAa, 15, 500, d.rnaDisplay.minOrfAa),
      startCodonMode: oneOf(rna.startCodonMode, ['aug_ends', 'aug_strict', 'aug_cug'] as const, d.rnaDisplay.startCodonMode),
      singleStrandedLayout: bool(rna.singleStrandedLayout, d.rnaDisplay.singleStrandedLayout),
      groupTenNtBlocks: bool(rna.groupTenNtBlocks, d.rnaDisplay.groupTenNtBlocks),
      annotateKozakAndReadthrough: bool(rna.annotateKozakAndReadthrough, d.rnaDisplay.annotateKozakAndReadthrough),
      showFoldedBaseIndices: bool(rna.showFoldedBaseIndices, d.rnaDisplay.showFoldedBaseIndices),
      colorStemLoopsByDeltaG: bool(rna.colorStemLoopsByDeltaG, d.rnaDisplay.colorStemLoopsByDeltaG),
      showGuWobblePairs: bool(rna.showGuWobblePairs, d.rnaDisplay.showGuWobblePairs),
      alwaysDisplayUracil: bool(rna.alwaysDisplayUracil, d.rnaDisplay.alwaysDisplayUracil),
    },
    proteinDisplay: {
      showRegions: bool(prot.showRegions, d.proteinDisplay.showRegions),
      showSites: bool(prot.showSites, d.proteinDisplay.showSites),
      showBonds: bool(prot.showBonds, d.proteinDisplay.showBonds),
      showDomainCoordinates: bool(prot.showDomainCoordinates, d.proteinDisplay.showDomainCoordinates),
      showHydropathyAndPiBar: bool(prot.showHydropathyAndPiBar, d.proteinDisplay.showHydropathyAndPiBar),
      showProteaseSites: bool(prot.showProteaseSites, d.proteinDisplay.showProteaseSites),
      colorScheme: oneOf(prot.colorScheme, ['hydrophobicity', 'charge', 'rasmol', 'none'] as const, d.proteinDisplay.colorScheme),
      aminoAcidCode: oneOf(prot.aminoAcidCode, ['1letter', '3letter'] as const, d.proteinDisplay.aminoAcidCode),
      groupTenAaBlocks: bool(prot.groupTenAaBlocks, d.proteinDisplay.groupTenAaBlocks),
      showDaltonsAlongsideKda: bool(prot.showDaltonsAlongsideKda, d.proteinDisplay.showDaltonsAlongsideKda),
    },
    agaroseGel: {
      defaultMwMarker: oneOf(gel.defaultMwMarker, ['1kb', '1kb_plus', '100bp', 'lambda_hindiii', 'ultralow'] as const, d.agaroseGel.defaultMwMarker),
      numberMarkerLanes: bool(gel.numberMarkerLanes, d.agaroseGel.numberMarkerLanes),
      bandReferenceEdge: oneOf(gel.bandReferenceEdge, ['middle', 'front', 'back'] as const, d.agaroseGel.bandReferenceEdge),
      scaleIntensityByMass: bool(gel.scaleIntensityByMass, d.agaroseGel.scaleIntensityByMass),
      migrationBuffer: oneOf(gel.migrationBuffer, ['TBE', 'TAE', 'SB'] as const, d.agaroseGel.migrationBuffer),
    },
    traces: {
      autoscaleHeights: bool(tr.autoscaleHeights, d.traces.autoscaleHeights),
      useLinearView: bool(tr.useLinearView, d.traces.useLinearView),
      traceFormat: oneOf(tr.traceFormat, ['above', 'inside', 'compact'] as const, d.traces.traceFormat),
      shading: bool(tr.shading, d.traces.shading),
      stripedA: bool(tr.stripedA, d.traces.stripedA),
      thinLines: bool(tr.thinLines, d.traces.thinLines),
      tickMarks: bool(tr.tickMarks, d.traces.tickMarks),
      includeParamsTab: bool(tr.includeParamsTab, d.traces.includeParamsTab),
      trimStringency: oneOf(tr.trimStringency, ['high', 'medium', 'low', 'none'] as const, d.traces.trimStringency),
      showQualityBars: bool(tr.showQualityBars, d.traces.showQualityBars),
    },
    enzymes: {
      italicPalindromic6Plus: bool(enz.italicPalindromic6Plus, d.enzymes.italicPalindromic6Plus),
      boldUniqueCutters: bool(enz.boldUniqueCutters, d.enzymes.boldUniqueCutters),
      greenBluntCutters: bool(enz.greenBluntCutters, d.enzymes.greenBluntCutters),
      flagMethylationSites: bool(enz.flagMethylationSites, d.enzymes.flagMethylationSites),
      defaultViewMode: oneOf(enz.defaultViewMode, ['numbers', 'lines'] as const, d.enzymes.defaultViewMode),
      topSuppliersInTooltips: clampInt(enz.topSuppliersInTooltips, 1, 10, d.enzymes.topSuppliersInTooltips),
      parentalEnzymeSet: oneOf(enz.parentalEnzymeSet, ['nonredundant_303', 'all_commercial', 'common_cloning', 'rebase_full'] as const, d.enzymes.parentalEnzymeSet),
    },
    primers: {
      minContinuousMatch3p: clampInt(prm.minContinuousMatch3p, 8, 30, d.primers.minContinuousMatch3p),
      altMatch3pBases: clampInt(prm.altMatch3pBases, 6, 25, d.primers.altMatch3pBases),
      altMatch3pMinTmC: clampInt(prm.altMatch3pMinTmC, 25, 75, d.primers.altMatch3pMinTmC),
      allowOneInternalMismatch: bool(prm.allowOneInternalMismatch, d.primers.allowOneInternalMismatch),
      largeGenomeExactMatch3p: clampInt(prm.largeGenomeExactMatch3p, 12, 35, d.primers.largeGenomeExactMatch3p),
      largeGenomeMinTmC: clampInt(prm.largeGenomeMinTmC, 30, 75, d.primers.largeGenomeMinTmC),
      alertSecondary5pBp: clampInt(prm.alertSecondary5pBp, 10, 30, d.primers.alertSecondary5pBp),
      mismatchDisplayStyle: oneOf(prm.mismatchDisplayStyle, ['loop', 'inline'] as const, d.primers.mismatchDisplayStyle),
      monovalentSaltMm: clampFloat(prm.monovalentSaltMm, 1, 1000, d.primers.monovalentSaltMm),
      divalentMgMm: clampFloat(prm.divalentMgMm, 0, 100, d.primers.divalentMgMm),
      primerConcNm: clampFloat(prm.primerConcNm, 1, 100000, d.primers.primerConcNm),
    },
  };
}

export function loadUserPreferences(): UserPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return normalizeUserPreferences(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeUserPreferences(undefined);
  }
}

function emit(prefs: UserPreferences) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(USER_PREFERENCES_EVENT, { detail: prefs }));
  } catch {
    // No event target (tests / SSR).
  }
}

export function saveUserPreferences(next: UserPreferences): UserPreferences {
  const prefs = normalizeUserPreferences(next);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: the change still applies for this session.
  }
  emit(prefs);
  return prefs;
}

export type UserPreferencesPatch = Partial<
  Omit<
    UserPreferences,
    | 'view'
    | 'general'
    | 'filesAndTabs'
    | 'exportDefaults'
    | 'dnaDisplay'
    | 'rnaDisplay'
    | 'proteinDisplay'
    | 'agaroseGel'
    | 'traces'
    | 'enzymes'
    | 'primers'
  >
> & {
  view?: Partial<SequenceViewDefaults>;
  general?: Partial<GeneralPreferences>;
  filesAndTabs?: Partial<FilesAndTabsPreferences>;
  exportDefaults?: Partial<ExportDefaultsPreferences>;
  dnaDisplay?: Partial<DnaDisplayPreferences>;
  rnaDisplay?: Partial<RnaDisplayPreferences>;
  proteinDisplay?: Partial<ProteinDisplayPreferences>;
  agaroseGel?: Partial<AgaroseGelPreferences>;
  traces?: Partial<TracesAlignmentPreferences>;
  enzymes?: Partial<EnzymesPreferences>;
  primers?: Partial<PrimersPreferences>;
};

export function updateUserPreferences(patch: UserPreferencesPatch): UserPreferences {
  const cur = loadUserPreferences();
  return saveUserPreferences({
    ...cur,
    ...patch,
    view: { ...cur.view, ...(patch.view ?? {}) },
    general: { ...cur.general, ...(patch.general ?? {}) },
    filesAndTabs: { ...cur.filesAndTabs, ...(patch.filesAndTabs ?? {}) },
    exportDefaults: { ...cur.exportDefaults, ...(patch.exportDefaults ?? {}) },
    dnaDisplay: { ...cur.dnaDisplay, ...(patch.dnaDisplay ?? {}) },
    rnaDisplay: { ...cur.rnaDisplay, ...(patch.rnaDisplay ?? {}) },
    proteinDisplay: { ...cur.proteinDisplay, ...(patch.proteinDisplay ?? {}) },
    agaroseGel: { ...cur.agaroseGel, ...(patch.agaroseGel ?? {}) },
    traces: { ...cur.traces, ...(patch.traces ?? {}) },
    enzymes: { ...cur.enzymes, ...(patch.enzymes ?? {}) },
    primers: { ...cur.primers, ...(patch.primers ?? {}) },
  });
}

export function resetUserPreferences(): UserPreferences {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  const prefs = normalizeUserPreferences(undefined);
  emit(prefs);
  return prefs;
}

/** Resolves the export line ending for the host OS. */
export function exportLineEndingFor(pref: UserPreferences['exportLineEnding'], hostOs: string): 'LF' | 'CRLF' {
  if (pref === 'lf') return 'LF';
  if (pref === 'crlf') return 'CRLF';
  return hostOs === 'windows' ? 'CRLF' : 'LF';
}
