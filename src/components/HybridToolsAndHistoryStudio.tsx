// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import { ArrowRight } from 'lucide-react';
import { SequenceDocument, SequenceFeature, type RestrictionEnzyme } from '../types/bio';
import {
  auditSequenceAlerts,
  complement,
  detectCommonFeatures,
  EMPTY_RESTRICTION_SCAN,
  enzymeLabel,
  isCustomEnzyme,
  predictSecondaryStructure,
  restrictionSiteCountsByName,
  scanRestrictionSites,
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
} from '../lib/rustBioEngine';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { documentDates } from './DocumentInfoPanel';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';

import { FigureExportButton } from './FigureExportButton';
import { ResultWarnings } from './ResultWarnings';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';
import type { FigureTable } from '../core/figureExport';
import { defaultHybridSubTab, hybridTabsForDocument, proteinAnalysisTarget, type HybridSubTabId } from '../core/analysisContext';
// The protein KPIs' n/a strings, which the protein analysis (now the Protein studio's) reads.
export { NO_RESIDUE_TRANSLATED, NO_STANDARD_RESIDUE } from '../core/analysisContext';
import { cutSiteDisplayPosition, enzymeKey } from '../core/restrictionDisplay';
import { openEnzymeCollections } from '../core/enzymeDatabase';
import { chosenRestrictionScope, CORE_CATALOG_LEN, restrictionScanEnzymes, restrictionScopeWords, type ChosenScanCollection } from './CircularPlasmidMap';
import {
  arcDiagram,
  FOLD_CAP_NT,
  FOLD_TEMPERATURES_C,
  formatEnsembleShare,
  pairClass,
  stemLoopGeometry,
} from '../core/nucleicFold';
import { CHART_FULL, chartMaxWidth, plotFrame, ticks } from '../core/chartLayout';

/** The Enzymes view's count for an enzyme the restriction scan did not read (BG-01M6S1K2). */
const NOT_SCANNED = 'not scanned';
/** An enzyme table CSV cell, RFC 4180-quoted only when it holds a comma, a double quote or a line break (D0155). */
const csvCell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
const isCustomEnzymeKey = (key: string) => key.startsWith('custom:');
/** The words an Enzyme Set action adds when it left custom rows out (US-01M7DV52). */
const customRowsLeftOut = (n: number) =>
  n > 0 ? ` (${n} custom enzyme row(s) left out: an Enzyme Set holds built-in enzymes only)` : '';

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
  /**
   * The active enzyme list (US-01M7DV52): the catalogue and the stored custom definitions, which
   * the Enzymes view scans and tabulates; the catalogue alone unless given.
   */
  enzymes?: RestrictionEnzyme[];
  /**
   * The collection chosen for site scans (US-01M7JX1J), when one is: the Enzymes view's rows, scan
   * and words read only its members, over the whole sequence; the Lineage tab keeps `enzymes`.
   */
  scanCollection?: ChosenScanCollection | null;
  /**
   * The App's count of writes to the collections store (BG-01M7JSCN): those the Restriction Enzymes
   * window makes and this view's own import. A change re-reads whether this document's Enzyme Set was
   * imported, so the import is offered again once its collection is deleted in the window.
   */
  collectionsRevision?: number;
  /** Called after the Enzymes view's import of the Enzyme Set succeeds (BG-01M7JSCN), so the App re-reads the collections. */
  onCollectionsChange?: () => void;
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
  enzymes = REBASE_ENZYMES,
  scanCollection = null,
  collectionsRevision = 0,
  onCollectionsChange,
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
  // The ticked rows by enzymeKey (US-01M7DV52): a built-in's is its name, so a custom definition
  // named like a built-in is ticked on its own.
  const [selectedEnzymeRowKeys, setSelectedEnzymeRowKeys] = useState<string[]>([]);
  const [enzymePickerValue, setEnzymePickerValue] = useState<string>(REBASE_ENZYMES[0]?.name ?? 'EcoRI');
  const [enzymeSetSubView, setEnzymeSetSubView] = useState<'Enzymes' | 'Lineage' | 'Info'>('Enzymes');
  const [enzymeSetStatusMsg, setEnzymeSetStatusMsg] = useState<string | null>(null);
  // The named enzyme collections (US-01M7DV72, D0159): the Enzyme Set is offered as one until a
  // collection records this document as where it came from. An unreadable store keeps the offer,
  // and the import then says why it wrote nothing.
  const enzymeCollections = useMemo(() => openEnzymeCollections(), []);
  const [collectionsVersion, setCollectionsVersion] = useState(0);
  const enzymeSetImported = useMemo(() => {
    const r = enzymeCollections.read();
    return r.ok && r.collections.some((c) => c.importedFrom?.documentId === doc.id);
  }, [enzymeCollections, collectionsVersion, collectionsRevision, doc.id]);
  /** Imports the Enzyme Set into a new collection; the document is not written. */
  const handleImportEnzymeSetAsCollection = () => {
    const r = enzymeCollections.importEnzymeSet({ id: doc.id, name: doc.name, enzymeNames: customEnzymeSetNames });
    setEnzymeSetStatusMsg(r.ok ? r.value.message : r.error.message);
    setCollectionsVersion((n) => n + 1);
    if (r.ok) onCollectionsChange?.();
  };

  useEffect(() => {
    const isEnzDoc = doc.docMetadata?.['Document Type'] === 'Enzyme Set';
    const raw = String(doc.docMetadata?.['Enzyme Names'] ?? '').trim();
    const parsed = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    setCustomEnzymeSetNames(parsed);
    setSelectedEnzymeRowKeys([]);
    if (isEnzDoc) {
      setEnzymeSetFilter('custom_set');
    }
  }, [doc.id, doc.docMetadata]);
  const [historyColorsEnabled, setHistoryColorsEnabled] = useState<boolean>(true);
  const [selectedStrain, setSelectedStrain] = useState<string>('DH5α (dam+ dcm+)');

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

  // What the protein of a document is read as; folding's CDS region is its CDS (proteinAnalysisTarget).
  const isProteinDoc = doc.moleculeType === 'Protein';
  const targetCdsSlice = useMemo(() => proteinAnalysisTarget(doc), [doc]);

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
  // The Enzymes view reads a chosen collection's members (US-01M7JX1J, D0169), and the Lineage tab
  // every active enzyme (D0168): the one scan follows the tab it is drawn for. A collection with
  // nothing that can be scanned sends the engine nothing.
  const enzymesViewCollection = subTab === 'enzymes-view' ? scanCollection : null;
  const enzymesViewList = enzymesViewCollection ? enzymesViewCollection.members : enzymes;
  const restrictionScan = useMemo(() => {
    if (doc.moleculeType !== 'DNA' || (subTab !== 'enzymes-view' && subTab !== 'lineage')) return EMPTY_RESTRICTION_SCAN;
    const list = restrictionScanEnzymes(subTab === 'lineage' ? enzymes : enzymesViewList, doc.sequence.length);
    return list.length === 0 ? EMPTY_RESTRICTION_SCAN : scanRestrictionSites(doc.sequence, doc.topology, list);
  }, [subTab, doc.moleculeType, doc.sequence, doc.topology, enzymes, enzymesViewList]);
  const allCutSites = restrictionScan.sites;
  // The scan above covers the whole molecule, but over 100,000 bp with the engine's core catalog
  // only (BG-01M6RPWR): an enzyme cutting once is then named for that catalog, not as unique.
  // A chosen collection is named in its place, by the same helper as the main view's.
  const restrictionWords =
    doc.moleculeType === 'DNA'
      ? restrictionScopeWords(
          chosenRestrictionScope(doc.sequence.length, doc.sequence.length, enzymes, scanCollection),
          doc.sequence.length
        )
      : null;

  const sequenceAlerts = useMemo(
    () => subTab === 'lineage' ? auditSequenceAlerts(doc, allCutSites, selectedStrain, restrictionScan.stoppedEarly) : [],
    [subTab, doc, allCutSites, selectedStrain, restrictionScan.stoppedEarly]
  );

  // The lineage table's Created / Modified are the Info tab's own, from the one derivation (BG-01M7N68F).
  const lineageDates = documentDates(doc);
  const autoDetectedFeatures = useMemo(() => subTab === 'lineage' && doc.moleculeType === 'DNA' ? detectCommonFeatures(doc) : [], [subTab, doc]);

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
    // Each enzyme's sites and count by its enzymeKey (US-01M7DV52), so a custom definition named
    // like a built-in is a row of its own.
    const byEnz: Record<string, typeof allCutSites> = {};
    for (const c of allCutSites) {
      const key = enzymeKey(c.enzyme);
      if (!byEnz[key]) byEnz[key] = [];
      byEnz[key].push(c);
    }
    const customSetLookup = new Set(customEnzymeSetNames);
    // `count` is the enzyme's complete site count, and null for an enzyme the scan did not read
    // (over 100,000 bp only the core enzymes are scanned), which is no noncutter; `cuts` are the
    // positions the scan kept, each enzyme's first ones.
    const counts = restrictionSiteCountsByName(restrictionScan);
    return enzymesViewList.map((enz) => {
      const key = enzymeKey(enz);
      const cuts = byEnz[key] || [];
      const count: number | null = key in counts ? counts[key] : null;
      return { enzyme: enz, count, cuts };
    }).filter((row) => {
      if (enzymeSetFilter === 'custom_set') return !isCustomEnzyme(row.enzyme) && customSetLookup.has(row.enzyme.name);
      if (enzymeSetFilter === 'unique') return row.count === 1;
      if (enzymeSetFilter === 'unique_dual') return row.count === 1 || row.count === 2;
      if (enzymeSetFilter === 'six_plus') return enzLength(row.enzyme.recognitionSeq) >= 6 && (row.count ?? 0) > 0;
      if (enzymeSetFilter === 'type2s') return Boolean(row.enzyme.isTypeIIS);
      return true;
    });
  }, [subTab, allCutSites, restrictionScan, enzymeSetFilter, customEnzymeSetNames, enzymesViewList]);

  // The Enzyme Set's built-ins the active list holds (the Custom Enzyme Set tab's rows with every
  // enzyme scanned), in Enzyme Set order: what that tab's Save counts, and, with a collection
  // chosen, the ones it leaves out are named under the tabs (US-01M7JX1J).
  const enzymeSetBuiltIns = useMemo(() => {
    const builtIns = new Set(enzymes.filter((e) => !isCustomEnzyme(e)).map((e) => e.name));
    return [...new Set(customEnzymeSetNames)].filter((n) => builtIns.has(n));
  }, [enzymes, customEnzymeSetNames]);
  const enzymeSetOutsideCollection = useMemo(() => {
    if (!scanCollection) return null;
    const members = new Set(scanCollection.members.filter((e) => !isCustomEnzyme(e)).map((e) => e.name));
    const outside = enzymeSetBuiltIns.filter((n) => !members.has(n));
    if (outside.length === 0) return null;
    const one = outside.length === 1;
    return `${outside.length.toLocaleString()} of this Enzyme Set's enzymes ${one ? 'is' : 'are'} not in "${scanCollection.name}" and ${one ? 'was' : 'were'} not scanned: ${outside.join(', ')}.`;
  }, [scanCollection, enzymeSetBuiltIns]);

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

  /**
   * An Enzyme Set stores built-in names (US-01M7DV52): the ticked rows' built-in names in the order
   * they were ticked, and how many ticked custom rows a set action leaves out.
   */
  const selectedForSet = () => {
    const names = selectedEnzymeRowKeys.filter((k) => !isCustomEnzymeKey(k));
    return { names, customLeftOut: selectedEnzymeRowKeys.length - names.length };
  };

  const handleRemoveSelectedEnzymesFromSet = () => {
    if (selectedEnzymeRowKeys.length === 0) return;
    const { names, customLeftOut } = selectedForSet();
    const removeSet = new Set(names);
    // Edit the saved set itself; the table filter only changes what is shown.
    const baseList = customEnzymeSetNames;
    const next = baseList.filter((n) => !removeSet.has(n));
    setSelectedEnzymeRowKeys([]);
    persistEnzymeSetToDocument(
      next,
      `Removed ${removeSet.size} selected enzyme(s) (${next.length} remaining)${customRowsLeftOut(customLeftOut)}`
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
    if (selectedEnzymeRowKeys.length === 0) return;
    const { names: extracted, customLeftOut } = selectedForSet();
    // Only custom rows ticked: the set is left as it is, never emptied.
    if (extracted.length === 0) {
      setEnzymeSetStatusMsg(`Nothing extracted${customRowsLeftOut(customLeftOut)}`);
      return;
    }
    persistEnzymeSetToDocument(
      extracted,
      `Extracted ${extracted.length} selected enzyme(s) into active Enzyme Set${customRowsLeftOut(customLeftOut)}`
    );
  };

  /** The Save button's set: the listed built-ins (custom rows are left out, and counted). */
  const handleSaveEnzymeSet = () => {
    if (enzymeSetFilter === 'custom_set') {
      persistEnzymeSetToDocument(customEnzymeSetNames, `Saved Enzyme Set "${doc.name}" (${enzymeSetBuiltIns.length} enzymes)`);
      return;
    }
    const names = filteredEnzymeSummary.filter((r) => !isCustomEnzyme(r.enzyme)).map((r) => r.enzyme.name);
    persistEnzymeSetToDocument(
      names,
      `Saved Enzyme Set "${doc.name}" (${names.length} enzymes${scanCollection ? `, from "${scanCollection.name}"` : ''})${customRowsLeftOut(filteredEnzymeSummary.length - names.length)}`
    );
  };

  const handleExportEnzymeTableCsv = () => {
    // Every row the filter shows, custom ones too (US-01M7GRYW). The four definition columns are
    // added only when a custom row is exported, so a catalogue-only file is today's six (D0155).
    const extended = filteredEnzymeSummary.some((row) => isCustomEnzyme(row.enzyme));
    const header = `Name,Recognition Sequence,Effective Length (nt),Overhang,Methylation,# Cuts${
      extended ? ',Source,Top Cut Offset,Bottom Cut Offset,Provenance' : ''
    }`;
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
      const custom = isCustomEnzyme(enzyme);
      const cells = [
        enzymeLabel(enzyme),
        enzyme.recognitionSeq,
        String(enzLength(enzyme.recognitionSeq)),
        overhang,
        meth,
        count === null ? NOT_SCANNED : String(count),
        // A built-in's provenance is empty: the catalogue holds none.
        ...(extended ? [custom ? 'custom' : 'built-in', String(enzyme.cutFwd), String(enzyme.cutRev), custom ? enzyme.provenance ?? '' : ''] : []),
      ];
      return cells.map(csvCell).join(',');
    });
    const csv = [header, ...rows].join('\n');
    saveWorkbenchFile(`${doc.name.replace(/\s+/g, '_')}_Enzymes.csv`, csv, 'text/csv;charset=utf-8');
    setEnzymeSetStatusMsg(`Exported ${rows.length} enzyme row(s) to CSV`);
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
            hidden={!availableTabs.includes('secondary-structure')}
            tabIndex={subTab === 'secondary-structure' ? 0 : -1}
            aria-selected={subTab === 'secondary-structure'}
            className={`method-tab-btn ${subTab === 'secondary-structure' ? 'active' : ''}`}
            onClick={() => setSubTab('secondary-structure')}
          >
            Secondary Structure
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
            Enzymes View (123 / ||||)
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
            History Tree, Alerts &amp; Info
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
        <span className="badge-accent">{isProteinDoc ? 'Provenance' : 'Sequence tools and history'}</span>
      </div>

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
                <h3>Enzymes View — Restriction Sets &amp; Overhang Cleavage Diagrams</h3>
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
                disabled={selectedEnzymeRowKeys.length === 0}
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
                disabled={selectedEnzymeRowKeys.length === 0}
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
                onClick={handleSaveEnzymeSet}
              >
                Save
              </button>
              {customEnzymeSetNames.length > 0 && !enzymeSetImported && (
                <button type="button" className="btn-secondary-sm" onClick={handleImportEnzymeSetAsCollection}>
                  Import Enzyme Set as collection
                </button>
              )}
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
                  ['all', scanCollection ? `All in "${scanCollection.name}"` : 'All REBASE Commercial'],
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
            {enzymeSetFilter === 'custom_set' && enzymeSetOutsideCollection && (
              <p className="mbc-summary-note">{enzymeSetOutsideCollection}</p>
            )}
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
                      enzymeLabel(row.enzyme),
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
                    <g key={enzymeKey(row.enzyme)}>
                      <text x="16" y={y + 4} fill="var(--mbc-text-main)" fontSize="11.5" fontWeight="700">
                        {enzymeLabel(row.enzyme)} ({row.count === null ? NOT_SCANNED : row.count})
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
                      const rowKey = enzymeKey(enzyme);
                      const isRowSelected = selectedEnzymeRowKeys.includes(rowKey);
                      return (
                        <tr
                          key={rowKey}
                          onClick={() =>
                            setSelectedEnzymeRowKeys((prev) =>
                              prev.includes(rowKey)
                                ? prev.filter((k) => k !== rowKey)
                                : [...prev, rowKey]
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
                              aria-label={`Select ${enzymeLabel(enzyme)}`}
                            />
                            <strong
                              style={{
                                fontWeight: count === 1 ? 800 : 600,
                                color:
                                  enzyme.cutFwd === enzyme.cutRev ? '#15803d' : undefined,
                              }}
                            >
                              {enzymeLabel(enzyme)}
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
                              ? isCustomEnzyme(enzyme)
                                ? 'Not scanned: its recognition sequence holds a letter the scan cannot read'
                                : scanCollection
                                ? `Not scanned: only the first ${CORE_CATALOG_LEN} built-in enzymes of "${scanCollection.name}" are scanned on this sequence`
                                : 'Not scanned: only the core enzymes are scanned on this sequence'
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
                    {selectedEnzymeRowKeys.length} of {filteredEnzymeSummary.length} enzymes
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
              {doc.moleculeType === 'DNA' && strainField}
            </InspectorSection>
          )}
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Construct History Tree &amp; History Colors</h3>
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
                  // The engine's subtitle reads "<accession> · <n> bp (<topology>)"; a protein's reads its length in aa, with no topology (US-01M6Q164).
                  const nodeDoc = node.docId ? (node.docId === doc.id ? doc : allDocuments?.find((d) => d.id === node.docId)) : undefined;
                  const subtitle = nodeDoc?.moleculeType === 'Protein'
                    ? `${nodeDoc.accession} · ${nodeDoc.sequence.length.toLocaleString()} aa`
                    : node.subtitle;
                  return (
                    <g key={node.nodeId}>
                      <title>{`${node.title}\n${subtitle}${node.timestamp ? `\n${node.timestamp}` : ''}`}</title>
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
                        {clip(subtitle, 28)}
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
                      {isProteinDoc ? `${h.lengthBp.toLocaleString()} aa` : `${h.lengthBp.toLocaleString()} ${doc.moleculeType === 'RNA' ? 'nt' : 'bp'} • ${h.topology}`}
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
              {!inWorkbench && doc.moleculeType === 'DNA' && strainField}
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
                  <th>{isProteinDoc ? 'Molecule Type' : <>Molecule Type &amp; Topology</>}</th>
                  <td>
                    {isProteinDoc ? doc.moleculeType : `${doc.moleculeType} (${doc.topology.toUpperCase()})`}
                  </td>
                </tr>
                <tr>
                  <th>Sequence Length</th>
                  <td>{doc.sequence.length.toLocaleString()} {isProteinDoc ? 'aa' : doc.moleculeType === 'RNA' ? 'nt' : 'bp'}</td>
                </tr>
                <tr>
                  <th>Folder Location</th>
                  <td>Local Database / {doc.folder}</td>
                </tr>
                <tr>
                  <th>Created / Modified</th>
                  <td>
                    {lineageDates.created} / {lineageDates.modified}
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
