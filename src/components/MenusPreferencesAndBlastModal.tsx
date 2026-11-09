// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BlastHitRecord, SequenceDocument } from '../types/bio';
import { TriangleAlert } from 'lucide-react';
import { calculatePrimerMetrics, runLocalBlastSearch } from '../core/bioEngine';
import { blastQueryCut, blastQueryCutNotice, blastQueryLetters, blastQueryTextWarnings } from '../core/operationRunners';
import { MolBioCraftLogo } from './MolBioCraftLogo';
import { MolBioPrefsToggleIcon } from './MolBioIcons';
import { FigureExportButton } from './FigureExportButton';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { localBlastDbDocuments, LocalSequenceDbEntry } from '../core/localBlastDb';
import {
  DEFAULT_USER_PREFERENCES,
  loadUserPreferences,
  updateUserPreferences,
  USER_PREFERENCES_EVENT,
  type UserPreferences,
} from '../core/userPreferences';
import { loadLastUsed, saveLastUsed } from '../core/optionProfiles';
import { OptionProfilesMenu } from './OperationDialog';
import { OperationShortcutsEditor } from './OperationShortcutsEditor';
import {
  MENU_FUNCTION_INFO_EVENT,
  readStoredShowMenuFunctionInfo,
  writeStoredShowMenuFunctionInfo,
} from '../data/menuFunctionDescriptions';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface StaticModalDialogProps {
  titleId: string;
  title: React.ReactNode;
  sizeClass:
    | 'modal-size-prefs'
    | 'modal-size-operation'
    | 'modal-size-blast'
    | 'modal-size-newseq'
    | 'modal-size-about'
    | 'modal-size-db'
    | 'modal-size-confirm-quit';
  closedBy?: 'any' | 'closerequest' | 'none';
  onClose: () => void;
  children: React.ReactNode;
}

function clampDialogViewportPosition(
  rawLeft: number,
  rawTop: number,
  dialogWidth: number,
  dialogHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { left: number; top: number } {
  const maxLeft = Math.max(0, viewportWidth - dialogWidth);
  const maxTop = Math.max(0, viewportHeight - dialogHeight);
  return {
    left: Math.round(Math.max(0, Math.min(rawLeft, maxLeft))),
    top: Math.round(Math.max(0, Math.min(rawTop, maxTop))),
  };
}

export const StaticModalDialog: React.FC<StaticModalDialogProps> = ({
  titleId,
  title,
  sizeClass,
  closedBy = 'any',
  onClose,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);

  const [dragReady, setDragReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dialogPos, setDialogPos] = useState<{ left: number; top: number } | null>(null);

  useIsomorphicLayoutEffect(() => {
    setDragReady(true);
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    } else if (!dialog.open) {
      dialog.setAttribute('open', '');
    }
    const autoFocusTarget = dialog.querySelector<HTMLElement>(
      '[autofocus], [data-autofocus="true"]'
    );
    if (autoFocusTarget) {
      autoFocusTarget.focus({ preventScroll: true });
    } else if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest('.prefs-modal-titlebar')
    ) {
      dialog.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    if (!dialogPos || typeof window === 'undefined') return;
    const handleResize = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      setDialogPos((prev) =>
        prev
          ? clampDialogViewportPosition(
              prev.left,
              prev.top,
              dialog.offsetWidth,
              dialog.offsetHeight,
              window.innerWidth,
              window.innerHeight
            )
          : null
      );
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dialogPos]);

  const supportsNativeClosedBy =
    typeof HTMLDialogElement !== 'undefined' &&
    'closedBy' in HTMLDialogElement.prototype;

  const closedByAttr = { closedby: closedBy } as Record<string, string>;

  const requestDialogClose = () => {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      {...closedByAttr}
      aria-labelledby={titleId}
      className={`prefs-modal-window ${sizeClass}`}
      style={
        dialogPos
          ? {
              margin: 0,
              insetInlineEnd: 'auto',
              insetBlockEnd: 'auto',
              left: `${dialogPos.left}px`,
              top: `${dialogPos.top}px`,
            }
          : undefined
      }
      onClose={(e) => {
        e.currentTarget.returnValue = '';
        onClose();
      }}
      onClick={(e) => {
        if (closedBy !== 'any' || supportsNativeClosedBy) return;
        const dialog = e.currentTarget;
        if (e.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= e.clientY &&
          e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX &&
          e.clientX <= rect.left + rect.width;
        if (!isDialogContent) {
          requestDialogClose();
        }
      }}
    >
      <div
        className={`prefs-modal-titlebar ${isDragging ? 'dragging' : ''}`}
        data-draggable-ready={dragReady ? 'true' : undefined}
        tabIndex={0}
        aria-label="Window title bar — drag or press arrow keys to reposition dialog"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const targetEl = e.target as HTMLElement | null;
          if (targetEl?.closest('button, input, select, textarea, a')) return;
          const dialog = dialogRef.current;
          if (!dialog) return;
          const rect = dialog.getBoundingClientRect();
          dragSessionRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const session = dragSessionRef.current;
          const dialog = dialogRef.current;
          if (
            !session ||
            !dialog ||
            session.pointerId !== e.pointerId ||
            !e.currentTarget.hasPointerCapture(e.pointerId)
          ) {
            return;
          }
          if (
            !session.moved &&
            Math.hypot(e.clientX - session.startX, e.clientY - session.startY) < 4
          ) {
            return;
          }
          session.moved = true;
          if (!isDragging) {
            setIsDragging(true);
          }
          setDialogPos(
            clampDialogViewportPosition(
              e.clientX - session.offsetX,
              e.clientY - session.offsetY,
              dialog.offsetWidth,
              dialog.offsetHeight,
              window.innerWidth,
              window.innerHeight
            )
          );
        }}
        onLostPointerCapture={() => {
          dragSessionRef.current = null;
          setIsDragging(false);
        }}
        onDoubleClick={(e) => {
          const targetEl = e.target as HTMLElement | null;
          if (targetEl?.closest('button, input, select, textarea, a')) return;
          setDialogPos(null);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            return;
          }
          const dialog = dialogRef.current;
          if (!dialog || typeof window === 'undefined') return;
          e.preventDefault();
          e.stopPropagation();
          const step = e.shiftKey ? 40 : 15;
          const rect = dialog.getBoundingClientRect();
          const baseLeft = dialogPos ? dialogPos.left : rect.left;
          const baseTop = dialogPos ? dialogPos.top : rect.top;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          setDialogPos(
            clampDialogViewportPosition(
              baseLeft + dx,
              baseTop + dy,
              dialog.offsetWidth,
              dialog.offsetHeight,
              window.innerWidth,
              window.innerHeight
            )
          );
        }}
      >
        <div style={{ width: 28 }} aria-hidden="true" />
        <h2 id={titleId} className="prefs-window-title">
          {title}
        </h2>
        <button
          type="button"
          className="mbc-modal-close-btn"
          aria-label="Close window"
          onClick={requestDialogClose}
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
};

export type PreferencesTabId =
  | 'General'
  | 'Files & Tabs'
  | 'Export'
  | 'DNA'
  | 'RNA'
  | 'Proteins'
  | 'Agarose Gels'
  | 'Traces & Alignment'
  | 'Enzymes'
  | 'Primers'
  | 'Keyboard';

export const PREFERENCES_CATEGORIES: PreferencesTabId[] = [
  'General',
  'Files & Tabs',
  'Export',
  'DNA',
  'RNA',
  'Proteins',
  'Agarose Gels',
  'Traces & Alignment',
  'Enzymes',
  'Primers',
  'Keyboard',
];

export const DEFAULT_ENZYME_SUPPLIERS: string[] = [
  'New England Biolabs (NEB)',
  'Thermo Scientific (FastDigest / Conventional)',
  'Promega',
  'Takara Bio',
  'Roche Applied Science',
  'Agilent Technologies',
  'Jena Bioscience',
  'EURx',
  'SibEnzyme',
  'NIPPON GENE',
  'Toyobo',
  'Vivantis',
  'Enzynomics',
  'NZYTech',
  'Bioneer',
  'Lucigen',
  'Cleaver Scientific',
  'Fisher BioReagents',
  'Invitrogen',
  'Merck / MilliporeSigma',
  'Molecular Biology Resources (CHIMERx)',
  'Minotech Biotechnology',
  'Optizyme',
  'TransGen Biotech',
  'Yeasen Biotechnology',
  'ZYMO Research',
];

export const KEYBOARD_SHORTCUT_ENTRIES: { action: string; shortcut: string }[] = [
  { action: 'About MolBioCraft & License', shortcut: '' },
  { action: 'Actions - Restriction and Insertion Cloning', shortcut: '' },
  { action: 'Actions - PCR Amplification', shortcut: '⌘D' },
  { action: 'Actions - Overlap Extension PCR (SOE-PCR)', shortcut: '' },
  { action: 'Actions - Primer-Directed Mutagenesis', shortcut: '⌘J' },
  { action: 'Actions - Gateway BP / LR Recombination', shortcut: '' },
  { action: 'Actions - Gibson Assembly', shortcut: '' },
  { action: 'Actions - Golden Gate (Type IIS) Assembly', shortcut: '' },
  { action: 'Actions - In-Fusion Cloning', shortcut: '' },
  { action: 'Actions - HiFi DNA Assembly', shortcut: '' },
  { action: 'Actions - TA or GC Cloning', shortcut: '' },
  { action: 'Actions - TOPO Cloning', shortcut: '' },
  { action: 'Actions - Anneal Oligos', shortcut: '' },
  { action: 'Alignment - Multiple Sequence Alignment (MAFFT)', shortcut: '⌥⌘A' },
  { action: 'Alignment - Clustal Omega / MUSCLE MSA', shortcut: '' },
  { action: 'Alignment - Global & Local Pairwise Alignment (NW / SW)', shortcut: '' },
  { action: 'Alignment - EMBOSS K-mer Dotplot', shortcut: '' },
  { action: 'Edit - Copy Selected Sequence', shortcut: '⌘C' },
  { action: 'Edit - Cut', shortcut: '⌘X' },
  { action: 'Edit - Paste', shortcut: '⌘V' },
  { action: 'Edit - Select Full Sequence', shortcut: '⌘A' },
  { action: 'Edit - Find in Sequence', shortcut: '⌘F' },
  { action: 'Edit - Go to Next Feature', shortcut: '⌘G' },
  { action: 'Edit - Reverse Complement', shortcut: '⇧⌘R' },
  { action: 'Edit - Undo', shortcut: '⌘Z' },
  { action: 'Edit - Redo', shortcut: '⇧⌘Z' },
  { action: 'Enzymes - Choose Enzymes', shortcut: '⌘E' },
  { action: 'Enzymes - Find Non-Cutting Enzymes', shortcut: '' },
  { action: 'Enzymes - Silent Mutations', shortcut: '' },
  { action: 'Features - Add Feature', shortcut: '⌘T' },
  { action: 'Features - Detect Common Features', shortcut: '' },
  { action: 'File - New Blank Session', shortcut: '⌥⌘N' },
  { action: 'File - New Sequence (DNA / RNA / Protein)', shortcut: '⌘N' },
  { action: 'File - New Project Folder', shortcut: '⇧⌘N' },
  { action: 'File - Open Session (.mbc)', shortcut: '⌘O' },
  { action: 'File - Import Sequence Files', shortcut: '⌘I' },
  { action: 'File - Import Sequence From Clipboard', shortcut: '⇧⌘I' },
  { action: 'File - Save GenBank (.gb)', shortcut: '⌘S' },
  { action: 'File - Save FASTA (.fasta)', shortcut: '⇧⌘S' },
  { action: 'File - Save Workbench Session (.mbc)', shortcut: '⌥⌘S' },
  { action: 'File - Close Current Session', shortcut: '⇧⌘W' },
  { action: 'File - Print / PDF Report', shortcut: '⌘P' },
  { action: 'Phylogenetics - Construct Maximum Likelihood Tree (ML)', shortcut: '⌥⌘T' },
  { action: 'Phylogenetics - Neighbor-Joining / Parsimony / Bayesian Trees', shortcut: '' },
  { action: 'Phylogenetics - Find Best Substitution Models (BIC / AICc)', shortcut: '' },
  { action: 'Phylogenetics - Evolutionary Distances & Population Diversity', shortcut: '' },
  { action: 'Phylogenetics - Codon Selection (dN/dS) & RelTime Timetree', shortcut: '' },
  { action: 'Phylogenetics - Diagnose Missense Mutation Impact', shortcut: '' },
  { action: 'Preferences', shortcut: '⌘,' },
  { action: 'Quit MolBioCraft', shortcut: '⌘Q' },
  { action: 'Primers - Design Primers & Oligo Biophysics', shortcut: '' },
  { action: 'Primers - Find CRISPR Sites', shortcut: '' },
  { action: 'Tools - Simulate Agarose Gel', shortcut: '⇧⌘G' },
  { action: 'Tools - Show DNA Calculations', shortcut: '⇧⌘M' },
  { action: 'Tools - BLAST Homology Search', shortcut: '⇧⌘B' },
  { action: 'Tools - Sanger Trace & Contig Verification (.ab1)', shortcut: '' },
  { action: 'Tools - Guided Multi-Task Bio Pipelines', shortcut: '⇧⌘Y' },
  { action: 'View - Back', shortcut: '⌘[' },
  { action: 'View - Forward', shortcut: '⌘]' },
  { action: 'View - Map View', shortcut: '⌘1' },
  { action: 'View - Sequence View', shortcut: '⌘2' },
  { action: 'View - Enzymes View (123 / ||||)', shortcut: '⌘3' },
  { action: 'View - Features View', shortcut: '⌘4' },
  { action: 'View - Primers View', shortcut: '⌘5' },
  { action: 'View - Text / Flatfile View', shortcut: '⌘6' },
  { action: 'View - Secondary Structure (MFE)', shortcut: '⌘7' },
  { action: 'View - History & Lineage', shortcut: '⌘8' },
  { action: 'View - Set Circular Origin', shortcut: '⇧⌘0' },
  { action: 'View - Zoom In', shortcut: '⌘=' },
  { action: 'View - Zoom Out', shortcut: '⌘-' },
  { action: 'View - Actual Size (100%)', shortcut: '⌘0' },
];

interface PreferencesModalProps {
  initialTab: PreferencesTabId;
  onClose: () => void;
  themeMode: 'system' | 'dark' | 'light';
  onChangeTheme: (mode: 'system' | 'dark' | 'light') => void;
  confirmBeforeQuit?: boolean;
  onChangeConfirmBeforeQuit?: (confirm: boolean) => void;
  onExportPreferences?: () => void;
  onImportPreferences?: () => void;
  onResetAllPreferences?: () => void;
}

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  initialTab,
  onClose,
  themeMode,
  onChangeTheme,
  confirmBeforeQuit = true,
  onChangeConfirmBeforeQuit,
  onExportPreferences,
  onImportPreferences,
  onResetAllPreferences,
}) => {
  const [activeTab, setActiveTab] = useState<PreferencesTabId>(initialTab);
  // Persisted workbench preferences (src/core/userPreferences.ts).
  const [prefs, setPrefs] = useState<UserPreferences>(() => loadUserPreferences());
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    const sync = (e: Event) => {
      const p = (e as CustomEvent<UserPreferences>).detail;
      if (p) setPrefs(p);
    };
    window.addEventListener(USER_PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(USER_PREFERENCES_EVENT, sync);
  }, []);
  const setView = (patch: Partial<UserPreferences['view']>) => setPrefs(updateUserPreferences({ view: patch }));
  const setGeneral = (patch: Partial<UserPreferences['general']>) => setPrefs(updateUserPreferences({ general: patch }));
  const setFilesAndTabs = (patch: Partial<UserPreferences['filesAndTabs']>) => setPrefs(updateUserPreferences({ filesAndTabs: patch }));
  const setExportDefaults = (patch: Partial<UserPreferences['exportDefaults']>) => setPrefs(updateUserPreferences({ exportDefaults: patch }));
  const setDnaDisplay = (patch: Partial<UserPreferences['dnaDisplay']>) => setPrefs(updateUserPreferences({ dnaDisplay: patch }));
  const setRnaDisplay = (patch: Partial<UserPreferences['rnaDisplay']>) => setPrefs(updateUserPreferences({ rnaDisplay: patch }));
  const setProteinDisplay = (patch: Partial<UserPreferences['proteinDisplay']>) => setPrefs(updateUserPreferences({ proteinDisplay: patch }));
  const setAgaroseGel = (patch: Partial<UserPreferences['agaroseGel']>) => setPrefs(updateUserPreferences({ agaroseGel: patch }));
  const setTraces = (patch: Partial<UserPreferences['traces']>) => setPrefs(updateUserPreferences({ traces: patch }));
  const setEnzymes = (patch: Partial<UserPreferences['enzymes']>) => setPrefs(updateUserPreferences({ enzymes: patch }));
  const setPrimers = (patch: Partial<UserPreferences['primers']>) => setPrefs(updateUserPreferences({ primers: patch }));
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dirPickerInputRef = useRef<HTMLInputElement | null>(null);

  // General state
  const [showMenuFuncInfo, setShowMenuFuncInfo] = useState<boolean>(() =>
    readStoredShowMenuFunctionInfo()
  );

  useEffect(() => {
    const syncMenuInfo = () => setShowMenuFuncInfo(readStoredShowMenuFunctionInfo());
    window.addEventListener(MENU_FUNCTION_INFO_EVENT, syncMenuInfo);
    window.addEventListener('storage', syncMenuInfo);
    return () => {
      window.removeEventListener(MENU_FUNCTION_INFO_EVENT, syncMenuInfo);
      window.removeEventListener('storage', syncMenuInfo);
    };
  }, []);

  // Enzymes tab state
  const [suppliers, setSuppliers] = useState<string[]>(DEFAULT_ENZYME_SUPPLIERS);
  const [selectedSupplierIdx, setSelectedSupplierIdx] = useState<number>(0);

  // Keyboard tab state
  const [shortcutFilter, setShortcutFilter] = useState('');
  const [selectedShortcutAction, setSelectedShortcutAction] = useState<string>('View - Back');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useIsomorphicLayoutEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const filteredShortcuts = useMemo(
    () =>
      KEYBOARD_SHORTCUT_ENTRIES.filter(
        (s) =>
          s.action.toLowerCase().includes(shortcutFilter.toLowerCase()) ||
          s.shortcut.toLowerCase().includes(shortcutFilter.toLowerCase())
      ),
    [shortcutFilter]
  );

  const handleMoveSupplier = (direction: 'up' | 'down' | 'top') => {
    setSuppliers((prev) => {
      const idx = selectedSupplierIdx;
      if (idx < 0 || idx >= prev.length) return prev;
      const next = [...prev];
      if (direction === 'up' && idx > 0) {
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        setSelectedSupplierIdx(idx - 1);
      } else if (direction === 'down' && idx < prev.length - 1) {
        [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
        setSelectedSupplierIdx(idx + 1);
      } else if (direction === 'top' && idx > 0) {
        const [picked] = next.splice(idx, 1);
        next.unshift(picked);
        setSelectedSupplierIdx(0);
      }
      return next;
    });
  };

  const restoreTraceDefaults = () => {
    setTraces(DEFAULT_USER_PREFERENCES.traces);
  };

  const handleBrowseDefaultDir = async () => {
    const w = window as unknown as {
      showDirectoryPicker?: () => Promise<{ name?: string }>;
    };
    if (typeof w.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await w.showDirectoryPicker();
        if (dirHandle?.name) {
          setFilesAndTabs({ defaultDirectory: `~/${dirHandle.name}` });
          setPrefsNotice(`Default directory set to "~/${dirHandle.name}".`);
        }
        return;
      } catch {
        // User cancelled directory picker
        return;
      }
    }
    dirPickerInputRef.current?.click();
  };

  // Sample 12-base preview chromatogram data for Traces & Alignment live preview
  const previewTraceBases: { base: 'A' | 'C' | 'G' | 'T'; q: number; amp: number }[] = [
    { base: 'G', q: 48, amp: 0.82 },
    { base: 'A', q: 52, amp: 0.94 },
    { base: 'A', q: 51, amp: 0.89 },
    { base: 'T', q: 49, amp: 0.86 },
    { base: 'T', q: 44, amp: 0.78 },
    { base: 'C', q: 54, amp: 0.96 },
    { base: 'G', q: 47, amp: 0.74 },
    { base: 'C', q: 53, amp: 0.92 },
    { base: 'G', q: 50, amp: 0.88 },
    { base: 'A', q: 46, amp: 0.68 },
    { base: 'T', q: 52, amp: 0.91 },
    { base: 'C', q: 49, amp: 0.84 },
  ];

  return (
    <StaticModalDialog
      titleId="mbc-prefs-dialog-title"
      title={`Preferences: ${activeTab}`}
      sizeClass="modal-size-prefs"
      onClose={onClose}
    >
      <div className="prefs-split-layout">
        {/* Left Navigation Category List Box */}
        <nav
          className="prefs-sidebar-nav"
          aria-label="Preferences Categories"
        >
          <ul className="prefs-sidebar-list" role="tablist" aria-orientation="vertical">
            {PREFERENCES_CATEGORIES.map((cat) => {
              const isSelected = activeTab === cat;
              return (
                <li key={cat} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id={`prefs-tab-${cat.replace(/\s+/g, '-').toLowerCase()}`}
                    aria-selected={isSelected}
                    className={`prefs-sidebar-item ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      setPrefsNotice(null);
                      setActiveTab(cat);
                    }}
                  >
                    {cat}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Right Live-Applying Settings Pane */}
        <div
          ref={bodyRef}
          role="tabpanel"
          aria-labelledby={`prefs-tab-${activeTab.replace(/\s+/g, '-').toLowerCase()}`}
          className="prefs-pane-scroll"
        >
          {prefsNotice && (
            <div className="info-callout" style={{ marginBottom: 10 }}>
              {prefsNotice}
            </div>
          )}

          <div className="info-callout" role="note" style={{ marginBottom: 10 }}>
            All preferences are saved automatically and apply immediately across the workbench.
          </div>

          {/* 1. GENERAL */}
          {activeTab === 'General' && (
            <div className="prefs-section-stack">
              <div className="prefs-check-stack">
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.general.singleWindow}
                    onChange={(e) => setGeneral({ singleWindow: e.target.checked })}
                  />
                  <span>Open files in single window when possible</span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.general.autoOpenProjectTable}
                    onChange={(e) => setGeneral({ autoOpenProjectTable: e.target.checked })}
                  />
                  <span>Automatically open the &ldquo;Project Info Table&rdquo; in multifile views</span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.general.confirmFileMoveRename}
                    onChange={(e) => setGeneral({ confirmFileMoveRename: e.target.checked })}
                  />
                  <span>Show confirmation warnings when moving or renaming project files</span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={confirmBeforeQuit}
                    onChange={(e) => onChangeConfirmBeforeQuit?.(e.target.checked)}
                  />
                  <span>Show confirmation dialog before quitting MolBioCraft</span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={showMenuFuncInfo}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setShowMenuFuncInfo(next);
                      writeStoredShowMenuFunctionInfo(next);
                    }}
                  />
                  <span>Show short function descriptions when hovering or focusing menu items</span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.general.multiLineTabStrip}
                    onChange={(e) => setGeneral({ multiLineTabStrip: e.target.checked })}
                  />
                  <span>Enable multi-line document tab strip when many files are open</span>
                </label>
              </div>

              <div className="prefs-form-rows">
                <div className="prefs-row">
                  <label htmlFor="prefs-appearance-select" className="prefs-inline-label">
                    Appearance:
                  </label>
                  <select
                    id="prefs-appearance-select"
                    value={themeMode}
                    onChange={(e) =>
                      onChangeTheme(e.target.value as 'system' | 'light' | 'dark')
                    }
                  >
                    <option value="system">System (Match OS Appearance)</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <div className="prefs-row">
                  <label htmlFor="prefs-bg-color-select" className="prefs-inline-label">
                    Light Background Color:
                  </label>
                  <select
                    id="prefs-bg-color-select"
                    value={prefs.general.lightBgSwatch}
                    onChange={(e) =>
                      setGeneral({
                        lightBgSwatch: e.target.value as '#ffffff' | '#f8fafc' | '#fefcf3' | '#f2fbf7',
                      })
                    }
                  >
                    <option value="#ffffff">Pure White (#FFFFFF)</option>
                    <option value="#f8fafc">Cool Laboratory Slate (#F8FAFC)</option>
                    <option value="#fefcf3">Warm Paper Ivory (#FEFCF3)</option>
                    <option value="#f2fbf7">Soft Mint Tint (#F2FBF7)</option>
                  </select>
                  <span
                    className="prefs-color-swatch"
                    style={{ backgroundColor: prefs.general.lightBgSwatch }}
                    aria-hidden="true"
                  />
                </div>

                <div className="prefs-row">
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.general.colorfulIcons}
                      onChange={(e) => setGeneral({ colorfulIcons: e.target.checked })}
                    />
                    <span>Use colorful action and view icons</span>
                  </label>
                </div>

                <div className="prefs-row">
                  <label htmlFor="prefs-default-fontsize" className="prefs-inline-label">
                    Default Font Size for New Files:
                  </label>
                  <select
                    id="prefs-default-fontsize"
                    value={String(prefs.general.defaultFontSizePt)}
                    onChange={(e) => setGeneral({ defaultFontSizePt: Number(e.target.value) })}
                  >
                    <option value="10">10 pt</option>
                    <option value="11">11 pt</option>
                    <option value="12">12 pt</option>
                    <option value="13">13 pt</option>
                    <option value="14">14 pt</option>
                    <option value="16">16 pt</option>
                  </select>
                </div>
              </div>

              <fieldset className="prefs-fieldset">
                <legend>Default Transformation Strain</legend>
                <div className="prefs-row">
                  <label htmlFor="prefs-strain-select">Bacterial transformation strain:</label>
                  <select
                    id="prefs-strain-select"
                    value={prefs.general.defaultStrain}
                    onChange={(e) =>
                      setGeneral({
                        defaultStrain: e.target.value as UserPreferences['general']['defaultStrain'],
                      })
                    }
                  >
                    <option value="None">None (Unmethylated Synthetic DNA)</option>
                    <option value="DH5a">DH5α — Standard Cloning (dam+ dcm+ EcoKI+)</option>
                    <option value="TOP10">TOP10 / DH10B — High-Efficiency Cloning (dam+ dcm+)</option>
                    <option value="JM110">JM110 / SCS110 — Methylation-Free (dam- dcm-)</option>
                    <option value="BL21">BL21(DE3) — T7 Protein Expression (dam+ dcm-)</option>
                    <option value="Stbl3">Stbl3 / NEB Stable — Lentiviral &amp; Repeat Constructs</option>
                  </select>
                </div>
                <div className="prefs-row">
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.general.propagateStrain}
                      onChange={(e) => setGeneral({ propagateStrain: e.target.checked })}
                    />
                    <span>Propagate bacterial transformation strain during simulated cloning</span>
                  </label>
                </div>
              </fieldset>

              <div className="prefs-form-rows">
                <div className="prefs-row">
                  <label htmlFor="prefs-updates-select" className="prefs-inline-label">
                    Check for updates:
                  </label>
                  <select
                    id="prefs-updates-select"
                    value={prefs.general.updateCheckInterval}
                    onChange={(e) =>
                      setGeneral({
                        updateCheckInterval: e.target.value as UserPreferences['general']['updateCheckInterval'],
                      })
                    }
                  >
                    <option value="auto">Automatically</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="manual">Manually</option>
                  </select>
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={() =>
                      setPrefsNotice(
                        'This build cannot check for updates. See the project releases page (Help › About) for the latest version.'
                      )
                    }
                  >
                    Check Now
                  </button>
                </div>

                <div className="prefs-row">
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={() => {
                      onChangeConfirmBeforeQuit?.(true);
                      setShowMenuFuncInfo(true);
                      writeStoredShowMenuFunctionInfo(true);
                      setGeneral({ confirmFileMoveRename: true });
                      setPrefsNotice('All dialog confirmation warnings have been reset.');
                    }}
                  >
                    Reset
                  </button>
                  <span>Reset all dialog warnings</span>
                </div>
              </div>
            </div>
          )}

          {/* 2. FILES & TABS */}
          {activeTab === 'Files & Tabs' && (
            <div className="prefs-section-stack">
              <fieldset className="prefs-fieldset">
                <legend>When Starting MolBioCraft</legend>
                <div className="prefs-radio-stack">
                  <label className="prefs-check-line">
                    <input type="radio" name="startup-behavior" checked={prefs.startup === 'home'}
                      onChange={() => setPrefs(updateUserPreferences({ startup: 'home' }))} />
                    <span>Start on Project First Page (do not open viewer tabs until New Session)</span>
                  </label>
                  <label className="prefs-check-line">
                    <input type="radio" name="startup-behavior" checked={prefs.startup === 'restore'}
                      onChange={() => setPrefs(updateUserPreferences({ startup: 'restore' }))} />
                    <span>Continue where you left off from local autosaved project</span>
                  </label>
                  <label className="prefs-check-line" style={{ paddingInlineStart: 22 }}>
                    <input
                      type="checkbox"
                      checked={prefs.filesAndTabs.restoreOpenTabs}
                      onChange={(e) => setFilesAndTabs({ restoreOpenTabs: e.target.checked })}
                    />
                    <span>Restore previously open document tabs when reopening a project</span>
                  </label>
                </div>
              </fieldset>

              <div className="prefs-form-rows">
                <div className="prefs-row">
                  <label htmlFor="prefs-default-dir" className="prefs-inline-label">
                    Default location for opening and saving files:
                  </label>
                </div>
                <div className="prefs-row">
                  <input
                    id="prefs-default-dir"
                    type="text"
                    value={prefs.filesAndTabs.defaultDirectory}
                    onChange={(e) => setFilesAndTabs({ defaultDirectory: e.target.value })}
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    style={{ flex: 1 }}
                  />
                  <input
                    ref={dirPickerInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    // @ts-expect-error webkitdirectory is standard across desktop webviews
                    webkitdirectory=""
                    onChange={(e) => {
                      const first = e.target.files?.[0];
                      if (first) {
                        const rel = (first as File & { webkitRelativePath?: string }).webkitRelativePath || '';
                        const folderName = rel.split('/')[0] || first.name;
                        if (folderName) {
                          setFilesAndTabs({ defaultDirectory: `~/${folderName}` });
                          setPrefsNotice(`Default directory set to "~/${folderName}".`);
                        }
                      }
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={handleBrowseDefaultDir}
                    title="Choose default directory for opening and saving project files"
                  >
                    Browse...
                  </button>
                </div>

                <div className="prefs-row">
                  <label htmlFor="prefs-default-author" className="prefs-inline-label">
                    Default &ldquo;Author&rdquo; for new files:
                  </label>
                  <input
                    id="prefs-default-author"
                    type="text"
                    value={prefs.filesAndTabs.defaultAuthor}
                    onChange={(e) => setFilesAndTabs({ defaultAuthor: e.target.value })}
                    style={{ width: 240 }}
                  />
                </div>

                <div className="prefs-row">
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.filesAndTabs.limitHistoryTrees}
                      onChange={(e) => setFilesAndTabs({ limitHistoryTrees: e.target.checked })}
                    />
                    <span>Limit file history trees to</span>
                  </label>
                  <input
                    type="number"
                    value={prefs.filesAndTabs.maxHistorySteps}
                    min={5}
                    max={500}
                    style={{ width: 70 }}
                    aria-label="Maximum history tree steps"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 5) {
                        setFilesAndTabs({ maxHistorySteps: n });
                      }
                    }}
                  />
                  <span>steps</span>
                </div>
              </div>

              <div className="prefs-check-stack">
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.filesAndTabs.showFileExtensions}
                    onChange={(e) => setFilesAndTabs({ showFileExtensions: e.target.checked })}
                  />
                  <span>Show File Extensions (.gb, .fasta, .ab1, .mbc) in Project Sidebar and Tabs</span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.filesAndTabs.convertMrnaToDsDna}
                    onChange={(e) => setFilesAndTabs({ convertMrnaToDsDna: e.target.checked })}
                  />
                  <span>When opening a GenBank file, convert mRNA molecule headers to dsDNA</span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.filesAndTabs.allowPlainTextRawSeq}
                    onChange={(e) => setFilesAndTabs({ allowPlainTextRawSeq: e.target.checked })}
                  />
                  <span>Allow plain text files without a FASTA header to be opened as raw sequences</span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.filesAndTabs.transferSourceFeatures}
                    onChange={(e) => setFilesAndTabs({ transferSourceFeatures: e.target.checked })}
                  />
                  <span>Transfer &ldquo;source&rdquo; features during simulated cloning and assembly</span>
                </label>
              </div>
            </div>
          )}

          {/* 3. EXPORT */}
          {activeTab === 'Export' && (
            <div className="prefs-section-stack">
              <div className="prefs-form-rows">
                <div className="prefs-row">
                  <label htmlFor="exp-dna-fmt" className="prefs-inline-label-wide">
                    Default format for exporting DNA:
                  </label>
                  <select
                    id="exp-dna-fmt"
                    value={prefs.exportDefaults.dnaFormat}
                    onChange={(e) =>
                      setExportDefaults({
                        dnaFormat: e.target.value as UserPreferences['exportDefaults']['dnaFormat'],
                      })
                    }
                  >
                    <option value="gb">GenBank - Standard (.gb)</option>
                    <option value="fasta">FASTA (.fasta)</option>
                    <option value="embl">EMBL Flatfile (.embl)</option>
                    <option value="gff3">GFF3 Annotations (.gff3)</option>
                  </select>
                </div>

                <div className="prefs-row">
                  <label htmlFor="exp-rna-fmt" className="prefs-inline-label-wide">
                    Default format for exporting RNA:
                  </label>
                  <select
                    id="exp-rna-fmt"
                    value={prefs.exportDefaults.rnaFormat}
                    onChange={(e) =>
                      setExportDefaults({
                        rnaFormat: e.target.value as UserPreferences['exportDefaults']['rnaFormat'],
                      })
                    }
                  >
                    <option value="gb">GenBank - Standard (.gb)</option>
                    <option value="fasta">FASTA (.fasta)</option>
                    <option value="embl">EMBL Flatfile (.embl)</option>
                  </select>
                </div>

                <div className="prefs-row">
                  <label htmlFor="exp-prot-fmt" className="prefs-inline-label-wide">
                    Default format for exporting Protein:
                  </label>
                  <select
                    id="exp-prot-fmt"
                    value={prefs.exportDefaults.proteinFormat}
                    onChange={(e) =>
                      setExportDefaults({
                        proteinFormat: e.target.value as UserPreferences['exportDefaults']['proteinFormat'],
                      })
                    }
                  >
                    <option value="gp">GenPept - Standard (.gp)</option>
                    <option value="faa">FASTA Protein (.faa)</option>
                  </select>
                </div>

                <div className="prefs-row">
                  <label htmlFor="exp-aln-fmt" className="prefs-inline-label-wide">
                    Default format for exporting Alignments:
                  </label>
                  <select
                    id="exp-aln-fmt"
                    value={prefs.exportDefaults.alignmentFormat}
                    onChange={(e) =>
                      setExportDefaults({
                        alignmentFormat: e.target.value as UserPreferences['exportDefaults']['alignmentFormat'],
                      })
                    }
                  >
                    <option value="clustal">Clustal (.aln)</option>
                    <option value="fasta">Aligned FASTA (.afa)</option>
                    <option value="phylip">PHYLIP (.phy)</option>
                    <option value="nexus">NEXUS (.nex)</option>
                  </select>
                </div>

                <div className="prefs-row">
                  <label htmlFor="exp-linebreak-fmt" className="prefs-inline-label-wide">
                    Line breaks:
                  </label>
                  <select id="exp-linebreak-fmt" value={prefs.exportLineEnding}
                    onChange={(e) => setPrefs(updateUserPreferences({ exportLineEnding: e.target.value as UserPreferences['exportLineEnding'] }))}>
                    <option value="system">Match this computer</option>
                    <option value="lf">macOS / Linux Format (LF)</option>
                    <option value="crlf">Windows Format (CRLF)</option>
                  </select>
                </div>
              </div>

              <fieldset className="prefs-fieldset">
                <legend>GenBank Customization</legend>
                <div className="prefs-check-stack">
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.exportDefaults.useFileNameAsLocus}
                      onChange={(e) => setExportDefaults({ useFileNameAsLocus: e.target.checked })}
                    />
                    <span>Use file name as LOCUS name when exporting GenBank flatfiles</span>
                  </label>
                  <div className="prefs-row" style={{ paddingInlineStart: 22 }}>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.exportDefaults.limitLocusLength}
                        onChange={(e) => setExportDefaults({ limitLocusLength: e.target.checked })}
                      />
                      <span>Limit LOCUS name length:</span>
                    </label>
                    <input
                      type="number"
                      value={prefs.exportDefaults.maxLocusChars}
                      min={10}
                      max={32}
                      style={{ width: 68 }}
                      aria-label="Maximum LOCUS name characters"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 10) {
                          setExportDefaults({ maxLocusChars: n });
                        }
                      }}
                    />
                    <span>characters</span>
                  </div>
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.exportDefaults.exportLabelQualifier}
                      onChange={(e) => setExportDefaults({ exportLabelQualifier: e.target.checked })}
                    />
                    <span>Export feature names using standard &ldquo;/label&rdquo; qualifier</span>
                  </label>
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.exportDefaults.useMiscFeatureFallback}
                      onChange={(e) => setExportDefaults({ useMiscFeatureFallback: e.target.checked })}
                    />
                    <span>Use &ldquo;misc_feature&rdquo; key for non-INSDC custom feature types</span>
                  </label>
                </div>
              </fieldset>
            </div>
          )}

          {/* 4. DNA */}
          {activeTab === 'DNA' && (
            <div className="prefs-section-stack">
              <div className="prefs-intro-caption">
                Default view settings for new or imported DNA files:
              </div>

              <div className="prefs-icon-toggle-list">
                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.dnaDisplay.showEnzymes}
                    aria-label="Toggle Show Enzymes by default"
                    className={`prefs-square-toggle ${prefs.dnaDisplay.showEnzymes ? 'active' : ''}`}
                    onClick={() => setDnaDisplay({ showEnzymes: !prefs.dnaDisplay.showEnzymes })}
                    title="Toggle Show Enzymes by default"
                  >
                    <MolBioPrefsToggleIcon kind="dna-enzymes" />
                  </button>
                  <span>Show enzymes:</span>
                  <select value={prefs.view.uniqueCuttersOnly ? 'unique' : 'all'} aria-label="Default DNA enzyme set"
                    onChange={(e) => setView({ uniqueCuttersOnly: e.target.value === 'unique' })}>
                    <option value="unique">Unique Cutters</option>
                    <option value="all">All Cutters</option>
                  </select>
                </div>

                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.dnaDisplay.showFeatures}
                    aria-label="Toggle Show DNA Features by default"
                    className={`prefs-square-toggle ${prefs.dnaDisplay.showFeatures ? 'active' : ''}`}
                    onClick={() => setDnaDisplay({ showFeatures: !prefs.dnaDisplay.showFeatures })}
                    title="Toggle Show DNA Features by default"
                  >
                    <MolBioPrefsToggleIcon kind="dna-features" />
                  </button>
                  <span>Show features</span>
                </div>

                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.view.showPrimers}
                    aria-label="Toggle Show Primers by default"
                    className={`prefs-square-toggle ${prefs.view.showPrimers ? 'active' : ''}`}
                    onClick={() => setView({ showPrimers: !prefs.view.showPrimers })}
                    title="Toggle Show Primers by default"
                  >
                    <MolBioPrefsToggleIcon kind="dna-primers" />
                  </button>
                  <span>Show primers</span>
                </div>

                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.view.showOrfs}
                    aria-label="Toggle Show DNA Translations and ORFs by default"
                    className={`prefs-square-toggle ${prefs.view.showOrfs ? 'active' : ''}`}
                    onClick={() => setView({ showOrfs: !prefs.view.showOrfs })}
                    title="Toggle Show DNA Translations and ORFs by default"
                  >
                    <MolBioPrefsToggleIcon kind="dna-orfs" />
                  </button>
                  <span>Show translations and ORFs</span>
                </div>

                <div className="prefs-indented-subcontrols">
                  <div className="prefs-row">
                    <span>Minimum Length:</span>
                    <input
                      type="number"
                      value={prefs.view.minOrfAa}
                      min={10}
                      max={1000}
                      style={{ width: 68 }}
                      aria-label="Minimum DNA ORF length in amino acids"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 10) setView({ minOrfAa: n });
                      }}
                    />
                    <span>amino acids</span>
                  </div>
                  <div className="prefs-row">
                    <label htmlFor="dna-orf-start">Require start codon:</label>
                    <select id="dna-orf-start" value={prefs.view.allowAltStartCodons ? 'alt' : 'atg'}
                      onChange={(e) => setView({ allowAltStartCodons: e.target.value === 'alt' })}>
                      <option value="atg">ATG</option>
                      <option value="alt">ATG, GTG, or TTG (Prokaryotic)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="prefs-grid-2col">
                <fieldset className="prefs-fieldset">
                  <legend>Map View</legend>
                  <div className="prefs-check-stack">
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.dnaDisplay.showFeatureArrows}
                        onChange={(e) => setDnaDisplay({ showFeatureArrows: e.target.checked })}
                      />
                      <span>Show feature directional arrows</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.dnaDisplay.curveFeatureLabels}
                        onChange={(e) => setDnaDisplay({ curveFeatureLabels: e.target.checked })}
                      />
                      <span>Curve feature labels inside wide plasmid arcs</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.dnaDisplay.showGcSkewRing}
                        onChange={(e) => setDnaDisplay({ showGcSkewRing: e.target.checked })}
                      />
                      <span>Show GC% skew ring on circular maps</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.dnaDisplay.showHistoryColors}
                        onChange={(e) => setDnaDisplay({ showHistoryColors: e.target.checked })}
                      />
                      <span>Highlight inserted fragments with History Colors</span>
                    </label>
                  </div>
                </fieldset>

                <fieldset className="prefs-fieldset">
                  <legend>Sequence View</legend>
                  <div className="prefs-check-stack">
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.dnaDisplay.showBothStrands}
                        onChange={(e) => setDnaDisplay({ showBothStrands: e.target.checked })}
                      />
                      <span>Show both 5&apos;&rarr;3&apos; and 3&apos;&larr;5&apos; DNA strands</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.dnaDisplay.groupTenBpBlocks}
                        onChange={(e) => setDnaDisplay({ groupTenBpBlocks: e.target.checked })}
                      />
                      <span>Group nucleotides in 10-bp blocks</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.dnaDisplay.colorCodeNucleotides}
                        onChange={(e) => setDnaDisplay({ colorCodeNucleotides: e.target.checked })}
                      />
                      <span>Color-code nucleotides (A/C/G/T)</span>
                    </label>
                    <label className="prefs-check-line">
                      <input type="checkbox" checked={prefs.view.showTranslation}
                        onChange={(e) => setView({ showTranslation: e.target.checked })} />
                      <span>Show 1-letter amino acid translation beneath CDS</span>
                    </label>
                    <label className="prefs-check-line">
                      <input type="checkbox" checked={prefs.view.showGcGraph}
                        onChange={(e) => setView({ showGcGraph: e.target.checked })} />
                      <span>Show GC% graph</span>
                    </label>
                  </div>
                </fieldset>
              </div>

              <div className="prefs-bottom-rule">
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.dnaDisplay.lowercaseOverhangs}
                    onChange={(e) => setDnaDisplay({ lowercaseOverhangs: e.target.checked })}
                  />
                  <span>Display unaligned 5&apos; primer tails and non-annealed overhangs in lowercase</span>
                </label>
              </div>
            </div>
          )}

          {/* 5. RNA */}
          {activeTab === 'RNA' && (
            <div className="prefs-section-stack">
              <div className="prefs-intro-caption">
                Default view settings for new or imported RNA files:
              </div>

              <div className="prefs-icon-toggle-list">
                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.rnaDisplay.showFeatures}
                    aria-label="Toggle Show RNA Features by default"
                    className={`prefs-square-toggle ${prefs.rnaDisplay.showFeatures ? 'active' : ''}`}
                    onClick={() => setRnaDisplay({ showFeatures: !prefs.rnaDisplay.showFeatures })}
                    title="Toggle Show RNA Features by default"
                  >
                    <MolBioPrefsToggleIcon kind="rna-features" />
                  </button>
                  <span>Show features (5&apos; UTR, CDS, IRES, 3&apos; UTR, poly(A))</span>
                </div>

                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.rnaDisplay.showOrfs}
                    aria-label="Toggle Show RNA Translations and ORFs by default"
                    className={`prefs-square-toggle ${prefs.rnaDisplay.showOrfs ? 'active' : ''}`}
                    onClick={() => setRnaDisplay({ showOrfs: !prefs.rnaDisplay.showOrfs })}
                    title="Toggle Show RNA Translations and ORFs by default"
                  >
                    <MolBioPrefsToggleIcon kind="rna-orfs" />
                  </button>
                  <span>Show translations and ORFs</span>
                </div>

                <div className="prefs-indented-subcontrols">
                  <div className="prefs-row">
                    <span>Minimum Length:</span>
                    <input
                      type="number"
                      value={prefs.rnaDisplay.minOrfAa}
                      min={15}
                      max={500}
                      style={{ width: 68 }}
                      aria-label="Minimum RNA ORF length in amino acids"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 15) setRnaDisplay({ minOrfAa: n });
                      }}
                    />
                    <span>amino acids</span>
                  </div>
                  <div className="prefs-row">
                    <label htmlFor="rna-orf-start">Require start codon:</label>
                    <select
                      id="rna-orf-start"
                      value={prefs.rnaDisplay.startCodonMode}
                      onChange={(e) =>
                        setRnaDisplay({
                          startCodonMode: e.target.value as UserPreferences['rnaDisplay']['startCodonMode'],
                        })
                      }
                    >
                      <option value="aug_ends">AUG except at RNA ends</option>
                      <option value="aug_strict">Always AUG</option>
                      <option value="aug_cug">AUG or CUG (Non-canonical)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="prefs-grid-2col">
                <fieldset className="prefs-fieldset">
                  <legend>Map &amp; Sequence View</legend>
                  <div className="prefs-check-stack">
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.rnaDisplay.singleStrandedLayout}
                        onChange={(e) => setRnaDisplay({ singleStrandedLayout: e.target.checked })}
                      />
                      <span>Single-stranded 5&apos;&rarr;3&apos; linear transcript layout</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.rnaDisplay.groupTenNtBlocks}
                        onChange={(e) => setRnaDisplay({ groupTenNtBlocks: e.target.checked })}
                      />
                      <span>Group ribonucleotides in 10-nt blocks</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.rnaDisplay.annotateKozakAndReadthrough}
                        onChange={(e) => setRnaDisplay({ annotateKozakAndReadthrough: e.target.checked })}
                      />
                      <span>Annotate Kozak consensus &amp; stop-codon readthrough</span>
                    </label>
                  </div>
                </fieldset>

                <fieldset className="prefs-fieldset">
                  <legend>Secondary Structure View</legend>
                  <div className="prefs-check-stack">
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.rnaDisplay.showFoldedBaseIndices}
                        onChange={(e) => setRnaDisplay({ showFoldedBaseIndices: e.target.checked })}
                      />
                      <span>Show base index labels on folded RNA structure</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.rnaDisplay.colorStemLoopsByDeltaG}
                        onChange={(e) => setRnaDisplay({ colorStemLoopsByDeltaG: e.target.checked })}
                      />
                      <span>Color stem-loops by free energy stability (&Delta;G kcal/mol)</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.rnaDisplay.showGuWobblePairs}
                        onChange={(e) => setRnaDisplay({ showGuWobblePairs: e.target.checked })}
                      />
                      <span>Show G:U wobble base pairs in secondary structure</span>
                    </label>
                  </div>
                </fieldset>
              </div>

              <div className="prefs-bottom-rule">
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.rnaDisplay.alwaysDisplayUracil}
                    onChange={(e) => setRnaDisplay({ alwaysDisplayUracil: e.target.checked })}
                  />
                  <span>Always display Uracil (U) instead of Thymine (T) across RNA sequence views</span>
                </label>
              </div>
            </div>
          )}

          {/* 6. PROTEINS */}
          {activeTab === 'Proteins' && (
            <div className="prefs-section-stack">
              <div className="prefs-intro-caption">
                Default view settings for new or imported Protein files:
              </div>

              <div className="prefs-icon-toggle-list">
                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.proteinDisplay.showRegions}
                    aria-label="Toggle Show Protein Region features by default"
                    className={`prefs-square-toggle ${prefs.proteinDisplay.showRegions ? 'active' : ''}`}
                    onClick={() => setProteinDisplay({ showRegions: !prefs.proteinDisplay.showRegions })}
                    title="Toggle Show Protein Region features by default"
                  >
                    <MolBioPrefsToggleIcon kind="protein-regions" />
                  </button>
                  <span>Show &ldquo;Region&rdquo; features (domains, signal peptides, transmembrane helices)</span>
                </div>

                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.proteinDisplay.showSites}
                    aria-label="Toggle Show Protein Site and Het features by default"
                    className={`prefs-square-toggle ${prefs.proteinDisplay.showSites ? 'active' : ''}`}
                    onClick={() => setProteinDisplay({ showSites: !prefs.proteinDisplay.showSites })}
                    title="Toggle Show Protein Site and Het features by default"
                  >
                    <MolBioPrefsToggleIcon kind="protein-sites" />
                  </button>
                  <span>Show &ldquo;Site&rdquo; and &ldquo;Het&rdquo; features (catalytic triad, PTM, metal binding)</span>
                </div>

                <div className="prefs-icon-toggle-row">
                  <button
                    type="button"
                    aria-pressed={prefs.proteinDisplay.showBonds}
                    aria-label="Toggle Show Protein Bond features by default"
                    className={`prefs-square-toggle ${prefs.proteinDisplay.showBonds ? 'active' : ''}`}
                    onClick={() => setProteinDisplay({ showBonds: !prefs.proteinDisplay.showBonds })}
                    title="Toggle Show Protein Bond features by default"
                  >
                    <MolBioPrefsToggleIcon kind="protein-bonds" />
                  </button>
                  <span>Show &ldquo;Bond&rdquo; features (disulfide bridges and cross-links)</span>
                </div>
              </div>

              <div className="prefs-grid-2col">
                <fieldset className="prefs-fieldset">
                  <legend>Map View</legend>
                  <div className="prefs-check-stack">
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.proteinDisplay.showDomainCoordinates}
                        onChange={(e) => setProteinDisplay({ showDomainCoordinates: e.target.checked })}
                      />
                      <span>Show domain boundary residue coordinates</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.proteinDisplay.showHydropathyAndPiBar}
                        onChange={(e) => setProteinDisplay({ showHydropathyAndPiBar: e.target.checked })}
                      />
                      <span>Show Kyte-Doolittle hydropathy &amp; pI summary bar</span>
                    </label>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.proteinDisplay.showProteaseSites}
                        onChange={(e) => setProteinDisplay({ showProteaseSites: e.target.checked })}
                      />
                      <span>Show protease cleavage sites (TEV, HRV 3C, Thrombin)</span>
                    </label>
                  </div>
                </fieldset>

                <fieldset className="prefs-fieldset">
                  <legend>Sequence View</legend>
                  <div className="prefs-form-rows">
                    <div className="prefs-row">
                      <label htmlFor="prot-color-mode">Color scheme:</label>
                      <select
                        id="prot-color-mode"
                        value={prefs.proteinDisplay.colorScheme}
                        onChange={(e) =>
                          setProteinDisplay({
                            colorScheme: e.target.value as UserPreferences['proteinDisplay']['colorScheme'],
                          })
                        }
                      >
                        <option value="hydrophobicity">Hydrophobicity</option>
                        <option value="charge">Charge &amp; Polarity</option>
                        <option value="rasmol">Shapely / RasMol</option>
                        <option value="none">Monochrome</option>
                      </select>
                    </div>
                    <div className="prefs-row">
                      <label htmlFor="prot-code-mode">Amino acid code:</label>
                      <select
                        id="prot-code-mode"
                        value={prefs.proteinDisplay.aminoAcidCode}
                        onChange={(e) =>
                          setProteinDisplay({
                            aminoAcidCode: e.target.value as UserPreferences['proteinDisplay']['aminoAcidCode'],
                          })
                        }
                      >
                        <option value="1letter">1-Letter (M, A, K...)</option>
                        <option value="3letter">3-Letter (Met, Ala, Lys...)</option>
                      </select>
                    </div>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.proteinDisplay.groupTenAaBlocks}
                        onChange={(e) => setProteinDisplay({ groupTenAaBlocks: e.target.checked })}
                      />
                      <span>Group amino acid residues in blocks of 10</span>
                    </label>
                  </div>
                </fieldset>
              </div>

              <div className="prefs-bottom-rule">
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.proteinDisplay.showDaltonsAlongsideKda}
                    onChange={(e) => setProteinDisplay({ showDaltonsAlongsideKda: e.target.checked })}
                  />
                  <span>Show molecular weights in Daltons (Da) alongside kilodaltons (kDa)</span>
                </label>
              </div>
            </div>
          )}

          {/* 7. AGAROSE GELS */}
          {activeTab === 'Agarose Gels' && (
            <div className="prefs-section-stack">
              <div className="prefs-form-rows">
                <div className="prefs-row">
                  <label htmlFor="gel-mw-marker" className="prefs-inline-label">
                    Default MW Marker:
                  </label>
                  <select
                    id="gel-mw-marker"
                    value={prefs.agaroseGel.defaultMwMarker}
                    onChange={(e) =>
                      setAgaroseGel({
                        defaultMwMarker: e.target.value as UserPreferences['agaroseGel']['defaultMwMarker'],
                      })
                    }
                  >
                    <option value="1kb">1 kb DNA Ladder (250 bp – 10,000 bp)</option>
                    <option value="1kb_plus">1 kb Plus DNA Ladder (100 bp – 15,000 bp)</option>
                    <option value="100bp">100 bp DNA Ladder (100 bp – 1,517 bp)</option>
                    <option value="lambda_hindiii">Lambda DNA / HindIII Marker</option>
                    <option value="ultralow">Ultra-Low Range Ladder (10 bp – 300 bp)</option>
                  </select>
                </div>

                <div className="prefs-row">
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.agaroseGel.numberMarkerLanes}
                      onChange={(e) => setAgaroseGel({ numberMarkerLanes: e.target.checked })}
                    />
                    <span>Number the lanes that show MW markers</span>
                  </label>
                </div>

                <div className="prefs-row">
                  <span>Place the</span>
                  <select
                    value={prefs.agaroseGel.bandReferenceEdge}
                    aria-label="DNA band reference edge"
                    onChange={(e) =>
                      setAgaroseGel({
                        bandReferenceEdge: e.target.value as UserPreferences['agaroseGel']['bandReferenceEdge'],
                      })
                    }
                  >
                    <option value="middle">middle</option>
                    <option value="front">leading edge</option>
                    <option value="back">trailing edge</option>
                  </select>
                  <span>of each DNA band at the calibrated mobility coordinate</span>
                </div>

                <div className="prefs-row">
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.agaroseGel.scaleIntensityByMass}
                      onChange={(e) => setAgaroseGel({ scaleIntensityByMass: e.target.checked })}
                    />
                    <span>Scale band fluorescence intensity proportionally to DNA fragment mass</span>
                  </label>
                </div>
              </div>

              <fieldset className="prefs-fieldset">
                <legend>Supercoiled DNA Migration Buffer</legend>
                <div className="prefs-intro-caption" style={{ marginBottom: 6 }}>
                  Simulate supercoiled DNA migration in gels using:
                </div>
                <div className="prefs-radio-stack">
                  <label className="prefs-check-line">
                    <input
                      type="radio"
                      name="gel-buffer"
                      checked={prefs.agaroseGel.migrationBuffer === 'TBE'}
                      onChange={() => setAgaroseGel({ migrationBuffer: 'TBE' })}
                    />
                    <span>
                      <strong>TBE</strong> (Tris-Borate-EDTA — higher resolution for fragments &lt; 2 kb)
                    </span>
                  </label>
                  <label className="prefs-check-line">
                    <input
                      type="radio"
                      name="gel-buffer"
                      checked={prefs.agaroseGel.migrationBuffer === 'TAE'}
                      onChange={() => setAgaroseGel({ migrationBuffer: 'TAE' })}
                    />
                    <span>
                      <strong>TAE</strong> (Tris-Acetate-EDTA — faster migration for supercoiled &amp; &gt; 3 kb DNA)
                    </span>
                  </label>
                  <label className="prefs-check-line">
                    <input
                      type="radio"
                      name="gel-buffer"
                      checked={prefs.agaroseGel.migrationBuffer === 'SB'}
                      onChange={() => setAgaroseGel({ migrationBuffer: 'SB' })}
                    />
                    <span>
                      <strong>SB</strong> (Sodium Borate — low-heat high-voltage rapid electrophoresis)
                    </span>
                  </label>
                </div>
                <p className="prefs-footnote">
                  Supercoiled plasmid migration relative to linear dsDNA markers is modeled using empirical buffer-specific mobility curves (Ishido et al., <em>Anal. Biochem.</em> 2010).
                </p>
              </fieldset>
            </div>
          )}

          {/* 8. TRACES & ALIGNMENT */}
          {activeTab === 'Traces & Alignment' && (
            <div className="prefs-section-stack">
              <div className="prefs-grid-2col">
                <div className="prefs-check-stack">
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.traces.autoscaleHeights}
                      onChange={(e) => setTraces({ autoscaleHeights: e.target.checked })}
                    />
                    <span>Autoscale heights</span>
                  </label>
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.traces.useLinearView}
                      onChange={(e) => setTraces({ useLinearView: e.target.checked })}
                    />
                    <span>Use linear view</span>
                  </label>
                  <div className="prefs-row">
                    <label htmlFor="trace-fmt-select">Trace Format:</label>
                    <select
                      id="trace-fmt-select"
                      value={prefs.traces.traceFormat}
                      onChange={(e) =>
                        setTraces({
                          traceFormat: e.target.value as 'above' | 'inside' | 'compact',
                        })
                      }
                    >
                      <option value="above">Show Bases Above</option>
                      <option value="inside">Show Bases Below Peaks</option>
                      <option value="compact">Compact Track</option>
                    </select>
                  </div>
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.traces.shading}
                      onChange={(e) => setTraces({ shading: e.target.checked })}
                    />
                    <span>Shading</span>
                  </label>
                </div>

                <div className="prefs-check-stack">
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.traces.stripedA}
                      onChange={(e) => setTraces({ stripedA: e.target.checked })}
                    />
                    <span>Striped pattern for &ldquo;A&rdquo; traces (colorblind aid)</span>
                  </label>
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.traces.thinLines}
                      onChange={(e) => setTraces({ thinLines: e.target.checked })}
                    />
                    <span>Thin lines</span>
                  </label>
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.traces.tickMarks}
                      onChange={(e) => setTraces({ tickMarks: e.target.checked })}
                    />
                    <span>Tick marks</span>
                  </label>
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.traces.includeParamsTab}
                      onChange={(e) => setTraces({ includeParamsTab: e.target.checked })}
                    />
                    <span>Include Parameters &amp; Raw Capillary tab</span>
                  </label>
                </div>
              </div>

              {/* Live 4-Channel SVG Sanger Chromatogram Preview Box */}
              <div className="prefs-trace-preview-box">
                <div className="prefs-trace-preview-header">
                  <span>Live Chromatogram Preview (GAATTCGCGATC)</span>
                  <span style={{ fontSize: 11, opacity: 0.78 }}>
                    {prefs.traces.autoscaleHeights ? 'Autoscaled' : 'Standard'} •{' '}
                    {prefs.traces.includeParamsTab ? 'Trace | Parameters' : 'Trace Only'}
                  </span>
                </div>
                <svg
                  viewBox="0 0 540 144"
                  className="prefs-trace-preview-svg"
                  role="img"
                  aria-label="Live Sanger chromatogram preview"
                >
                  <defs>
                    <pattern
                      id="prefs-stripe-a"
                      width="5"
                      height="5"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <line x1="0" y1="0" x2="0" y2="5" stroke="#16a34a" strokeWidth="2.5" />
                    </pattern>
                  </defs>
                  <rect x="0" y="0" width="540" height="144" fill="var(--mbc-bg-canvas)" />
                  {previewTraceBases.map((item, idx) => {
                    const cx = 32 + idx * 43;
                    const baseY = prefs.traces.traceFormat === 'above' ? 128 : 110;
                    const gain = prefs.traces.autoscaleHeights ? 1.0 : 0.76;
                    const peakH = Math.round(item.amp * 64 * gain);
                    const topY = baseY - peakH;
                    const col =
                      item.base === 'A'
                        ? 'var(--mbc-green)'
                        : item.base === 'C'
                        ? 'var(--mbc-blue)'
                        : item.base === 'G'
                        ? 'var(--mbc-amber)'
                        : 'var(--mbc-red)';
                    const fillStyle =
                      item.base === 'A' && prefs.traces.stripedA
                        ? 'url(#prefs-stripe-a)'
                        : col;
                    const dPath = `M ${cx - 21} ${baseY} C ${cx - 11} ${baseY}, ${cx - 8} ${topY}, ${cx} ${topY} C ${cx + 8} ${topY}, ${cx + 11} ${baseY}, ${cx + 21} ${baseY}`;
                    const qBarH = Math.round((item.q / 60) * 16);
                    return (
                      <g key={idx}>
                        {prefs.traces.showQualityBars && prefs.traces.traceFormat === 'above' && (
                          <rect
                            x={cx - 7}
                            y={24 - qBarH}
                            width={14}
                            height={qBarH}
                            rx={2}
                            fill="rgba(26, 115, 232, 0.22)"
                            stroke="rgba(26, 115, 232, 0.55)"
                            strokeWidth="0.8"
                          />
                        )}
                        <text
                          x={cx}
                          y={prefs.traces.traceFormat === 'above' ? 40 : 136}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="700"
                          fontFamily="Google Sans Code, monospace"
                          fill={col}
                        >
                          {item.base}
                        </text>
                        {prefs.traces.tickMarks && (
                          <line
                            x1={cx}
                            y1={baseY}
                            x2={cx}
                            y2={baseY + 4}
                            stroke="var(--mbc-text-muted)"
                            strokeWidth="1"
                          />
                        )}
                        {prefs.traces.shading && (
                          <path
                            d={`${dPath} Z`}
                            fill={fillStyle}
                            fillOpacity={item.base === 'A' && prefs.traces.stripedA ? 0.55 : 0.18}
                          />
                        )}
                        <path
                          d={dPath}
                          fill="none"
                          stroke={col}
                          strokeWidth={prefs.traces.thinLines ? 1.15 : 2.1}
                        />
                      </g>
                    );
                  })}
                  <line
                    x1="10"
                    y1={prefs.traces.traceFormat === 'above' ? 128 : 110}
                    x2="530"
                    y2={prefs.traces.traceFormat === 'above' ? 128 : 110}
                    stroke="var(--mbc-border-strong)"
                    strokeWidth="1"
                  />
                </svg>
              </div>

              <fieldset className="prefs-fieldset">
                <legend>Aligned Sequence Traces</legend>
                <div className="prefs-row">
                  <label htmlFor="trace-trim-stringency">
                    Hide ends of aligned sequence traces:
                  </label>
                  <select
                    id="trace-trim-stringency"
                    value={prefs.traces.trimStringency}
                    onChange={(e) =>
                      setTraces({
                        trimStringency: e.target.value as UserPreferences['traces']['trimStringency'],
                      })
                    }
                  >
                    <option value="high">High Stringency (Phred Q &ge; 30)</option>
                    <option value="medium">Medium Stringency (Phred Q &ge; 20)</option>
                    <option value="low">Low Stringency (Phred Q &ge; 15)</option>
                    <option value="none">Do Not Trim Ends</option>
                  </select>
                </div>
                <div className="prefs-row" style={{ justifyContent: 'space-between' }}>
                  <label className="prefs-check-line">
                    <input
                      type="checkbox"
                      checked={prefs.traces.showQualityBars}
                      onChange={(e) => setTraces({ showQualityBars: e.target.checked })}
                    />
                    <span>Show Phred quality bars on chromatogram bases</span>
                  </label>
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={restoreTraceDefaults}
                  >
                    Restore Default Settings
                  </button>
                </div>
              </fieldset>
            </div>
          )}

          {/* 9. ENZYMES */}
          {activeTab === 'Enzymes' && (
            <div className="prefs-section-stack">
              <div className="prefs-check-stack">
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.enzymes.italicPalindromic6Plus}
                    onChange={(e) => setEnzymes({ italicPalindromic6Plus: e.target.checked })}
                  />
                  <span>
                    Display palindromic 6+ bp cutters in <em>italics</em>
                  </span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.enzymes.boldUniqueCutters}
                    onChange={(e) => setEnzymes({ boldUniqueCutters: e.target.checked })}
                  />
                  <span>
                    Distinguish unique single-cutters in <strong>bold</strong>
                  </span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.enzymes.greenBluntCutters}
                    onChange={(e) => setEnzymes({ greenBluntCutters: e.target.checked })}
                  />
                  <span>
                    Color blunt-end restriction enzymes in{' '}
                    <strong style={{ color: '#15803d' }}>green</strong>
                  </span>
                </label>
                <label className="prefs-check-line">
                  <input
                    type="checkbox"
                    checked={prefs.enzymes.flagMethylationSites}
                    onChange={(e) => setEnzymes({ flagMethylationSites: e.target.checked })}
                  />
                  <span>Flag Dam / Dcm / EcoKI methylation-blocked sites with (*)</span>
                </label>
              </div>

              <div className="prefs-row">
                <span>Default tab for Enzymes view:</span>
                <div className="prefs-segmented-pair" role="group" aria-label="Default Enzymes view tab">
                  <button
                    type="button"
                    aria-pressed={prefs.enzymes.defaultViewMode === 'numbers'}
                    className={`prefs-seg-btn ${prefs.enzymes.defaultViewMode === 'numbers' ? 'active' : ''}`}
                    onClick={() => setEnzymes({ defaultViewMode: 'numbers' })}
                  >
                    <code>123</code> Numbers
                  </button>
                  <button
                    type="button"
                    aria-pressed={prefs.enzymes.defaultViewMode === 'lines'}
                    className={`prefs-seg-btn ${prefs.enzymes.defaultViewMode === 'lines' ? 'active' : ''}`}
                    onClick={() => setEnzymes({ defaultViewMode: 'lines' })}
                  >
                    <code>||||</code> Lines
                  </button>
                </div>
              </div>

              <fieldset className="prefs-fieldset">
                <legend>Commercial Suppliers Priority Order ({suppliers.length})</legend>
                <div className="prefs-suppliers-grid">
                  <div
                    className="prefs-suppliers-listbox"
                    role="listbox"
                    aria-label="Commercial restriction enzyme suppliers"
                  >
                    {suppliers.map((sup, idx) => (
                      <button
                        key={sup}
                        type="button"
                        role="option"
                        aria-selected={selectedSupplierIdx === idx}
                        className={`prefs-supplier-row ${selectedSupplierIdx === idx ? 'selected' : ''}`}
                        onClick={() => setSelectedSupplierIdx(idx)}
                      >
                        <span className="prefs-supplier-rank">{idx + 1}.</span>
                        <span>{sup}</span>
                      </button>
                    ))}
                  </div>
                  <div className="prefs-suppliers-actions">
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      disabled={selectedSupplierIdx <= 0}
                      onClick={() => handleMoveSupplier('up')}
                    >
                      Move Up
                    </button>
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      disabled={selectedSupplierIdx <= 0}
                      onClick={() => handleMoveSupplier('top')}
                    >
                      Move to Top
                    </button>
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      disabled={selectedSupplierIdx >= suppliers.length - 1}
                      onClick={() => handleMoveSupplier('down')}
                    >
                      Move Down
                    </button>
                  </div>
                </div>

                <div className="prefs-row" style={{ marginTop: 8 }}>
                  <span>List the top</span>
                  <input
                    type="number"
                    value={prefs.enzymes.topSuppliersInTooltips}
                    min={1}
                    max={10}
                    style={{ width: 58 }}
                    aria-label="Number of top suppliers listed in tooltips"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1) setEnzymes({ topSuppliersInTooltips: n });
                    }}
                  />
                  <span>suppliers in enzyme tooltips</span>
                </div>
                <div className="prefs-row">
                  <label htmlFor="enz-parental-set">Parental enzyme set:</label>
                  <select
                    id="enz-parental-set"
                    value={prefs.enzymes.parentalEnzymeSet}
                    onChange={(e) =>
                      setEnzymes({
                        parentalEnzymeSet: e.target.value as UserPreferences['enzymes']['parentalEnzymeSet'],
                      })
                    }
                  >
                    <option value="nonredundant_303">Nonredundant Commercial (303)</option>
                    <option value="all_commercial">All Commercial Enzymes (648)</option>
                    <option value="common_cloning">Common Cloning Cutters (124)</option>
                    <option value="rebase_full">Full REBASE Type II &amp; Type IIS</option>
                  </select>
                </div>
              </fieldset>
            </div>
          )}

          {/* 10. PRIMERS */}
          {activeTab === 'Primers' && (
            <div className="prefs-section-stack">
              <fieldset className="prefs-fieldset">
                <legend>Hybridization Parameters — Sequences &le; 1,000,000 bp</legend>
                <div className="prefs-primer-diagram-row">
                  <svg
                    viewBox="0 0 220 62"
                    className="prefs-primer-svg"
                    aria-hidden="true"
                  >
                    {/* Overhanging 5' tail + annealed 3' duplex with 1 mismatch */}
                    <path
                      d="M 10 16 L 52 16 L 70 30 L 188 30"
                      fill="none"
                      stroke="#7c3aed"
                      strokeWidth="2.4"
                    />
                    <polygon points="188,25 200,30 188,35" fill="#7c3aed" />
                    <line x1="12" y1="45" x2="206" y2="45" stroke="var(--mbc-text-main)" strokeWidth="2.2" />
                    {[76, 90, 104, 132, 146, 160, 174].map((x) => (
                      <line key={x} x1={x} y1="32" x2={x} y2="43" stroke="var(--mbc-text-muted)" strokeWidth="1.2" />
                    ))}
                    {/* Single internal mismatch indicator */}
                    <circle cx="118" cy="30" r="3.5" fill="#f59e0b" />
                    <text x="12" y="11" fontSize="11" fontWeight="600" fill="var(--mbc-text-secondary)">5&apos; tail</text>
                    <text x="176" y="21" fontSize="11" fontWeight="700" fill="#7c3aed">3&apos;</text>
                  </svg>
                  <div className="prefs-form-rows" style={{ flex: 1 }}>
                    <div className="prefs-row">
                      <span>Minimum continuous match at 3&apos; end:</span>
                      <input
                        type="number"
                        value={prefs.primers.minContinuousMatch3p}
                        min={8}
                        max={30}
                        style={{ width: 62 }}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 8) setPrimers({ minContinuousMatch3p: n });
                        }}
                      />
                      <span>bases</span>
                    </div>
                    <div className="prefs-row">
                      <span>Or</span>
                      <input
                        type="number"
                        value={prefs.primers.altMatch3pBases}
                        min={6}
                        max={25}
                        style={{ width: 62 }}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 6) setPrimers({ altMatch3pBases: n });
                        }}
                      />
                      <span>3&apos; bases with duplex Tm &ge;</span>
                      <input
                        type="number"
                        value={prefs.primers.altMatch3pMinTmC}
                        min={25}
                        max={75}
                        style={{ width: 62 }}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 25) setPrimers({ altMatch3pMinTmC: n });
                        }}
                      />
                      <span>&deg;C</span>
                    </div>
                    <label className="prefs-check-line">
                      <input
                        type="checkbox"
                        checked={prefs.primers.allowOneInternalMismatch}
                        onChange={(e) => setPrimers({ allowOneInternalMismatch: e.target.checked })}
                      />
                      <span>Allow 1 internal mismatch (&ge; 6 exact bases required at 3&apos; terminus)</span>
                    </label>
                  </div>
                </div>
              </fieldset>

              <fieldset className="prefs-fieldset">
                <legend>Large Sequences (&gt; 1,000,000 bp) &amp; Secondary 5&apos; Sites</legend>
                <div className="prefs-primer-diagram-row">
                  <svg
                    viewBox="0 0 220 54"
                    className="prefs-primer-svg"
                    aria-hidden="true"
                  >
                    <path d="M 32 22 L 188 22" fill="none" stroke="#0284c7" strokeWidth="2.4" />
                    <polygon points="188,17 200,22 188,27" fill="#0284c7" />
                    <line x1="12" y1="39" x2="206" y2="39" stroke="var(--mbc-text-main)" strokeWidth="2.2" />
                    {[42, 58, 74, 90, 106, 122, 138, 154, 170].map((x) => (
                      <line key={x} x1={x} y1="24" x2={x} y2="37" stroke="var(--mbc-text-muted)" strokeWidth="1.2" />
                    ))}
                    <text x="14" y="18" fontSize="11" fontWeight="700" fill="#0284c7">5&apos;</text>
                    <text x="180" y="13" fontSize="11" fontWeight="700" fill="#0284c7">3&apos;</text>
                  </svg>
                  <div className="prefs-form-rows" style={{ flex: 1 }}>
                    <div className="prefs-row">
                      <span>Large genome exact 3&apos; match:</span>
                      <input
                        type="number"
                        value={prefs.primers.largeGenomeExactMatch3p}
                        min={12}
                        max={35}
                        style={{ width: 62 }}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 12) setPrimers({ largeGenomeExactMatch3p: n });
                        }}
                      />
                      <span>bp and Tm &ge;</span>
                      <input
                        type="number"
                        value={prefs.primers.largeGenomeMinTmC}
                        min={30}
                        max={75}
                        style={{ width: 62 }}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 30) setPrimers({ largeGenomeMinTmC: n });
                        }}
                      />
                      <span>&deg;C</span>
                    </div>
                    <div className="prefs-row">
                      <span>Alert on additional 5&apos;-end binding sites &ge;</span>
                      <input
                        type="number"
                        value={prefs.primers.alertSecondary5pBp}
                        min={10}
                        max={30}
                        style={{ width: 62 }}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 10) setPrimers({ alertSecondary5pBp: n });
                        }}
                      />
                      <span>continuous bp</span>
                    </div>
                  </div>
                </div>
              </fieldset>

              <fieldset className="prefs-fieldset">
                <legend>Primer-Template Duplex Display &amp; SantaLucia Tm</legend>
                <div className="prefs-radio-stack" style={{ marginBottom: 8 }}>
                  <label className="prefs-check-line">
                    <input
                      type="radio"
                      name="primer-loop-style"
                      checked={prefs.primers.mismatchDisplayStyle === 'loop'}
                      onChange={() => setPrimers({ mismatchDisplayStyle: 'loop' })}
                    />
                    <span>Display internal mismatches as a raised loop above the template strand</span>
                  </label>
                  <label className="prefs-check-line">
                    <input
                      type="radio"
                      name="primer-loop-style"
                      checked={prefs.primers.mismatchDisplayStyle === 'inline'}
                      onChange={() => setPrimers({ mismatchDisplayStyle: 'inline' })}
                    />
                    <span>Display internal mismatches inline in lowercase amber text</span>
                  </label>
                </div>
                <div className="prefs-row">
                  <span>[Na+/K+]:</span>
                  <input
                    type="number"
                    value={prefs.primers.monovalentSaltMm}
                    min={1}
                    max={1000}
                    style={{ width: 64 }}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1) setPrimers({ monovalentSaltMm: n });
                    }}
                  />
                  <span>mM</span>
                  <span>[Mg2+]:</span>
                  <input
                    type="number"
                    value={prefs.primers.divalentMgMm}
                    min={0}
                    max={100}
                    step={0.1}
                    style={{ width: 64 }}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) setPrimers({ divalentMgMm: n });
                    }}
                  />
                  <span>mM</span>
                  <span>Primer Conc:</span>
                  <input
                    type="number"
                    value={prefs.primers.primerConcNm}
                    min={1}
                    max={100000}
                    style={{ width: 68 }}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1) setPrimers({ primerConcNm: n });
                    }}
                  />
                  <span>nM</span>
                </div>
              </fieldset>
            </div>
          )}

          {/* 11. KEYBOARD */}
          {activeTab === 'Keyboard' && (
            <div className="prefs-section-stack">
              <div className="prefs-row" style={{ justifyContent: 'space-between' }}>
                <input
                  type="text"
                  placeholder="Filter menu actions or shortcuts..."
                  value={shortcutFilter}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => setShortcutFilter(e.target.value)}
                  style={{ width: 280 }}
                />
                <span style={{ fontSize: 12, opacity: 0.8 }}>
                  Showing {filteredShortcuts.length} commands
                </span>
              </div>
              <WorkbenchSmartTable
                tableId="preferences-keyboard-shortcuts"
                tableLabel="Keyboard Shortcuts Table"
                regionMaxHeight={300}
                className="bio-table"
              >
                <thead>
                  <tr>
                    <th>Action</th>
                    <th style={{ width: 130 }}>Shortcut</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredShortcuts.map((item) => (
                    <tr
                      key={item.action}
                      className={selectedShortcutAction === item.action ? 'selected-row' : ''}
                      onClick={() => setSelectedShortcutAction(item.action)}
                    >
                      <td>{item.action}</td>
                      <td>
                        <code>{item.shortcut || '—'}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
              <div className="prefs-row" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>Shortcut for &ldquo;{selectedShortcutAction}&rdquo;:</span>
                  <input
                    type="text"
                    readOnly
                    value={
                      KEYBOARD_SHORTCUT_ENTRIES.find((k) => k.action === selectedShortcutAction)
                        ?.shortcut || ''
                    }
                    style={{ width: 84 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    disabled
                    title="Menu shortcuts are fixed; options-window shortcuts can be set below."
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>
              <OperationShortcutsEditor />
            </div>
          )}
        </div>
      </div>

      <div className="prefs-modal-footer">
        {confirmReset ? (
          <div className="prefs-row" role="alert">
            <span>Reset every preference to its default?</span>
            <button type="button" className="btn-secondary-sm" style={{ color: 'var(--mbc-red)' }} onClick={() => {
              setConfirmReset(false);
              onResetAllPreferences?.();
              setPrefsNotice('All preferences were reset to their defaults.');
            }}>Reset All</button>
            <button type="button" className="btn-secondary-sm" onClick={() => setConfirmReset(false)}>Keep</button>
          </div>
        ) : (
          <div className="prefs-row">
            {onResetAllPreferences && (
              <button type="button" className="btn-secondary-sm" onClick={() => setConfirmReset(true)}>Reset All Preferences…</button>
            )}
            {onExportPreferences && <button type="button" className="btn-secondary-sm" onClick={onExportPreferences}>Export…</button>}
            {onImportPreferences && <button type="button" className="btn-secondary-sm" onClick={onImportPreferences}>Import…</button>}
            <span className="prefs-live-hint">Enabled preferences apply immediately</span>
          </div>
        )}
        <button type="button" className="btn-primary-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </StaticModalDialog>
  );
};

interface BlastModalProps {
  activeDoc: SequenceDocument;
  allDocs: SequenceDocument[];
  /** Local databases registered in the Database Explorer (searched as their own document set). */
  localDatabases?: LocalSequenceDbEntry[];
  onClose: () => void;
  onSelectHitDoc: (docId: string) => void;
  /** Saves the hits as a query-centric alignment document. */
  onSaveQueryCentric?: (querySeq: string, hits: BlastHitRecord[]) => void;
}

/** The engine prints lengths bare ("12000 nt"); group each whole number of 4+ digits ("12,000 nt"). */
const groupLengths = (text: string) =>
  text.replace(/\d+(?:\.\d+)?/g, (n) => (/^\d{4,}$/.test(n) ? Number(n).toLocaleString() : n));

/**
 * The identity classes of the query-centric view, highest first: each hit's bar takes the hue of
 * the first class its identity reaches, and the legend shows that hue on a swatch beside the
 * class's label.
 */
const BLAST_IDENTITY_CLASSES: readonly { min: number; label: string; hue: string }[] = [
  { min: 98, label: '≥98%', hue: '#1f9d55' },
  { min: 90, label: '≥90%', hue: '#2f7de1' },
  { min: 75, label: '≥75%', hue: '#c77d14' },
  { min: -Infinity, label: '<75%', hue: '#d14343' },
];
const blastIdentityHue = (identityPct: number) =>
  (BLAST_IDENTITY_CLASSES.find((c) => identityPct >= c.min) ?? BLAST_IDENTITY_CLASSES[BLAST_IDENTITY_CLASSES.length - 1]).hue;

/** Query-centric overview: the query as a ruler, each hit as a bar at its query coordinates. */
const QueryCentricOverview: React.FC<{ queryLength: number; hits: BlastHitRecord[]; selectedId: string | null; onSelect: (id: string) => void }> = ({ queryLength, hits, selectedId, onSelect }) => {
  const W = 720;
  const rowH = 9;
  const shown = hits.slice(0, 60);
  const H = 28 + shown.length * (rowH + 3);
  const x = (p: number) => 8 + ((p - 1) / Math.max(1, queryLength)) * (W - 16);
  const color = blastIdentityHue;
  const step = Math.pow(10, Math.max(1, Math.floor(Math.log10(queryLength / 5))));
  const ticks: number[] = [];
  for (let p = step; p < queryLength; p += step) ticks.push(p);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Query-centric view of BLAST hits">
      <rect x={8} y={8} width={W - 16} height={8} rx={2} fill="currentColor" opacity={0.35} />
      {ticks.map((p) => <g key={p}><path d={`M${x(p)},17 v3`} stroke="currentColor" opacity={0.5} /><text x={x(p)} y={27} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.7}>{p}</text></g>)}
      {shown.map((h, i) => {
        const a = Math.min(h.queryStart, h.queryEnd);
        const b = Math.max(h.queryStart, h.queryEnd);
        const y = 30 + i * (rowH + 3);
        return (
          <g key={h.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(h.id)}>
            <rect x={x(a)} y={y} width={Math.max(2, x(b) - x(a))} height={rowH} rx={2} fill={color(h.identityPct)}
              stroke={selectedId === h.id ? 'currentColor' : 'none'} strokeWidth={1.5} />
            <title>{`${h.accession} ${h.description}: query ${a}–${b}, ${h.identityPct}% identity, E = ${h.eValue}`}</title>
          </g>
        );
      })}
    </svg>
  );
};

export const BlastSearchModal: React.FC<BlastModalProps> = ({
  activeDoc,
  allDocs,
  localDatabases = [],
  onClose,
  onSelectHitDoc,
  onSaveQueryCentric,
}) => {
  // Program and database start from the last search (Preferences-style memory) and can be
  // saved as named option profiles from the settings menu in the footer.
  const blastDefaults = { program: 'blastn', database: 'nr / nt (Curated Local + NCBI Reference Index)' };
  const [blastInitial] = useState(() => loadLastUsed('blast', blastDefaults));
  const [program, setProgram] = useState<'blastn' | 'blastp' | 'blastx' | 'tblastn'>(() =>
    (['blastn', 'blastp', 'blastx', 'tblastn'] as const).find((p) => p === blastInitial.program) ?? 'blastn');
  const [database, setDatabase] = useState<string>(() =>
    String(blastInitial.database).startsWith('local:') && !localDatabases.some((db) => `local:${db.id}` === blastInitial.database)
      ? blastDefaults.database
      : String(blastInitial.database));
  useEffect(() => {
    saveLastUsed('blast', { program, database });
  }, [program, database]);
  const [queryText, setQueryText] = useState<string>(activeDoc.sequence);
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);

  // A registered local database searches only its own documents; the
  // registrations used to be listed in the Database Explorer but never offered here.
  const localDb = database.startsWith('local:')
    ? localDatabases.find((db) => `local:${db.id}` === database)
    : undefined;
  const subjectDocs = useMemo(
    () => (localDb ? localBlastDbDocuments(localDb, allDocs) : allDocs),
    [localDb, allDocs]
  );
  const hits: BlastHitRecord[] = useMemo(
    () => runLocalBlastSearch(queryText, subjectDocs, program, localDb ? localDb.name : database),
    [queryText, subjectDocs, program, database, localDb]
  );
  // D0005: past its program's query cap a query is searched on its first cap letters only, and of a
  // FASTA query only the first record is. The engine puts those warnings on every hit, shown once
  // above the table; a search with no hit returns nothing to carry them, so they then come from
  // the query text, read by the engine's query-text rule. Lengths are grouped as the window's
  // captions are.
  const queryNotices = useMemo(() => {
    if (hits.length) return [...new Set(hits.flatMap((h) => h.warnings ?? []))].map(groupLengths);
    const cut = blastQueryCut(queryText, program);
    return [...blastQueryTextWarnings(queryText, program), ...(cut ? [blastQueryCutNotice(cut)] : [])].map(groupLengths);
  }, [hits, queryText, program]);
  const queryLetters = useMemo(() => blastQueryLetters(queryText), [queryText]);

  const activeHit = useMemo(
    () => hits.find((h) => h.id === selectedHitId) ?? hits[0] ?? null,
    [hits, selectedHitId]
  );

  return (
    <StaticModalDialog
      titleId="mbc-blast-dialog-title"
      title={`BLAST Search — ${activeDoc.name} (${activeDoc.sequence.length.toLocaleString()} bp)`}
      sizeClass="modal-size-blast"
      onClose={onClose}
    >
      <div className="prefs-modal-body">
        <div className="form-grid-2col" style={{ marginBottom: 10 }}>
          <label className="form-field">
            <span>BLAST Program:</span>
            <select
              value={program}
              onChange={(e) =>
                setProgram(e.target.value as 'blastn' | 'blastp' | 'blastx' | 'tblastn')
              }
            >
              <option value="blastn">blastn — Nucleotide-Nucleotide BLAST (megablast)</option>
              <option value="blastp">blastp — Protein-Protein BLAST (BLOSUM62)</option>
              <option value="blastx">blastx — Translated Query vs Protein DB</option>
              <option value="tblastn">tblastn — Protein Query vs Translated DB</option>
            </select>
          </label>
          <label className="form-field">
            <span>Database:</span>
            <select value={database} onChange={(e) => setDatabase(e.target.value)}>
              <option value="nr / nt (Curated Local + NCBI Reference Index)">
                nr / nt — Nucleotide Collection &amp; Local Workspace
              </option>
              <option value="refseq_rna (NCBI Transcript Reference)">
                refseq_rna — NCBI Reference Sequences
              </option>
              <option value="swissprot (UniProtKB / Swiss-Prot)">
                swissprot — Curated Protein Sequences
              </option>
              <option value="pdb (Protein Data Bank 3D Structures)">
                pdb — Protein Data Bank Structures
              </option>
              {localDatabases.map((db) => (
                <option key={db.id} value={`local:${db.id}`}>
                  Local: {db.name} ({db.moleculeType}, {db.sourceFolder})
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="form-field" style={{ marginBottom: 10 }}>
          <span>Query Sequence (FASTA or raw residues):</span>
          <textarea
            rows={2}
            value={queryText}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setQueryText(e.target.value)}
            style={{
              width: '100%',
              fontFamily: 'Google Sans Code, monospace',
              fontSize: 11.5,
              padding: 6,
              borderRadius: 6,
            }}
          />
        </label>

        {queryNotices.map((w) => (
          <div key={w} className="cloning-warning-note" role="status" data-mbc-blast-truncation
            style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 10 }}>
            <TriangleAlert size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 1 }} />
            <span>{w}</span>
          </div>
        ))}

        <WorkbenchSmartTable
          tableId="blast-search-hits"
          tableLabel="BLAST Search Hits Table"
          regionMaxHeight={200}
          className="bio-table"
        >
          <thead>
            <tr>
              <th>Accession</th>
              <th>Description</th>
              <th>Query Cov</th>
              <th>Identity</th>
              <th>E-Value</th>
              <th>Bit Score</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => (
              <tr
                key={h.id}
                className={activeHit?.id === h.id ? 'selected-row' : ''}
                onClick={() => setSelectedHitId(h.id)}
              >
                <td>
                  <code>{h.accession}</code>
                </td>
                <td>{h.description}</td>
                <td>{h.queryCoveragePct}%</td>
                <td>
                  <strong>{h.identityPct}%</strong>
                </td>
                <td>
                  <code>{h.eValue}</code>
                </td>
                <td>{h.bitScore}</td>
                <td>
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      const docId = h.id.replace(/^blast-hit-/, '').replace(/~hsp\d+$/, '');
                      onSelectHitDoc(docId);
                      onClose();
                    }}
                  >
                    Open Hit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </WorkbenchSmartTable>

        {hits.length > 0 && (
          <div className="cloning-result-box" style={{ marginTop: 10 }} data-mbc-figure>
            <div className="result-headline" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong>Query-centric view</strong>
              <FigureExportButton
                compact
                baseName="BLAST Query-Centric View"
                title="BLAST query-centric view"
                table={{
                  headers: ['Accession', 'Description', 'Query start', 'Query end', 'Identity (%)', 'Bit score', 'E-value'],
                  rows: hits.map((h) => [
                    h.accession,
                    h.description,
                    String(h.queryStart),
                    String(h.queryEnd),
                    String(h.identityPct),
                    String(h.bitScore),
                    String(h.eValue),
                  ]),
                  caption: `BLAST query-centric view — ${hits.length} hits over ${queryLetters.toLocaleString()} residues`,
                }}
              />
              {/* The identity classes print in ink; the hue that marks a class's bars sits on a swatch. */}
              <span className="mbc-blast-identity-legend">
                hits on the query ({queryLetters.toLocaleString()} residues) · identity
                {BLAST_IDENTITY_CLASSES.map((c) => (
                  <span key={c.label} className="mbc-blast-identity-key" data-identity-class={c.label}>
                    <span className="mbc-blast-identity-swatch" style={{ background: c.hue }} aria-hidden="true" />
                    {c.label}
                  </span>
                ))}
                {hits.length > 60 ? ` · first 60 of ${hits.length}` : ''}
              </span>
              {onSaveQueryCentric && (
                <button type="button" className="btn-secondary-sm" onClick={() => onSaveQueryCentric(queryText, hits)}>
                  Save Query-Centric Alignment
                </button>
              )}
            </div>
            <QueryCentricOverview
              queryLength={queryLetters}
              hits={hits}
              selectedId={activeHit?.id ?? null}
              onSelect={setSelectedHitId}
            />
          </div>
        )}

        {activeHit && (
          <div className="cloning-result-box" style={{ marginTop: 10 }}>
            <div className="result-headline">
              <strong>HSP Alignment:</strong> {activeHit.accession} ({activeHit.organism}) —
              Identity {activeHit.identityPct}%, Bit Score {activeHit.bitScore}, E ={' '}
              {activeHit.eValue}
            </div>
            <pre
              style={{
                margin: '6px 0 0',
                fontFamily: 'Google Sans Code, monospace',
                fontSize: 11,
                overflowX: 'auto',
              }}
            >
              {`Query  1    ${activeHit.alignedQuery}  ${activeHit.queryEnd}\n            ${activeHit.alignedMidline}\nSbjct  1    ${activeHit.alignedSubject}  ${activeHit.subjectEnd}`}
            </pre>
          </div>
        )}
      </div>

      <div className="prefs-modal-footer">
        <OptionProfilesMenu
          operationId="blast"
          defaults={blastDefaults}
          values={{ program, database }}
          onLoad={(v) => {
            const p = (['blastn', 'blastp', 'blastx', 'tblastn'] as const).find((x) => x === v.program);
            if (p) setProgram(p);
            const db = String(v.database);
            setDatabase(db.startsWith('local:') && !localDatabases.some((d) => `local:${d.id}` === db) ? blastDefaults.database : db);
          }}
        />
        <button type="button" className="btn-primary-sm" onClick={onClose}>
          Close BLAST Studio
        </button>
      </div>
    </StaticModalDialog>
  );
};

export type NewSequenceDocType = 'Nucleotide' | 'Protein' | 'Primer' | 'Probe';

export const NEW_SEQUENCE_TYPE_OPTIONS: {
  value: NewSequenceDocType;
  label: string;
  description: string;
}[] = [
  {
    value: 'Nucleotide',
    label: 'Nucleotide',
    description: 'New nucleotide sequence',
  },
  {
    value: 'Protein',
    label: 'Protein',
    description: 'New protein sequence',
  },
  {
    value: 'Primer',
    label: 'Primer',
    description: 'A new oligonucleotide entered manually',
  },
  {
    value: 'Probe',
    label: 'Probe',
    description: 'A new oligonucleotide entered manually',
  },
];

interface NewSequenceModalProps {
  defaultFolder: string;
  initialSequence?: string;
  initialType?: NewSequenceDocType;
  onClose: () => void;
  onCreateDoc: (doc: SequenceDocument) => void;
}

/**
 * Oligo Tm / ΔG°37 from the Rust engine: SantaLucia (1998) nearest-neighbour parameters with
 * Owczarzy et al. (2004/2008) Na⁺/Mg²⁺ corrections — the same model as Primer3's
 * `santalucia` + `owczarzy` options (agrees to < 0.1 °C). dNTPs chelate Mg²⁺ 1:1, so the free
 * Mg²⁺ (Mg²⁺ − dNTP) is used, as in Primer3. N and the other ambiguity codes are kept, so an oligo
 * holding one has no Tm and `tmNoAnswerReason` says why (BG-01M6SHQ0): they were deleted first, so
 * ACGTNACGT was given the Tm of ACGTACGT, a different oligo.
 */
export function computeOligoTmSantaLucia(
  seq: string,
  oligoConcNm = 250,
  saltMm = 50,
  mgMm = 1.5,
  dntpMm = 0.2
): { tmC: number; gcPct: number; deltaG37: number; length: number; tmNoAnswerReason?: string } {
  const clean = seq.toUpperCase().replace(/[^A-Z]/g, '').replace(/U/g, 'T');
  if (clean.length === 0) return { tmC: 0, gcPct: 0, deltaG37: 0, length: 0 };
  const m = calculatePrimerMetrics(clean, saltMm, Math.max(0, mgMm - dntpMm), oligoConcNm);
  return {
    tmC: m.tmC,
    gcPct: m.gcPercent,
    deltaG37: m.deltaG37,
    length: clean.length,
    ...(m.tmNoAnswerReason ? { tmNoAnswerReason: m.tmNoAnswerReason } : {}),
  };
}

export const NewSequenceModal: React.FC<NewSequenceModalProps> = ({
  defaultFolder,
  initialSequence = '',
  initialType = 'Nucleotide',
  onClose,
  onCreateDoc,
}) => {
  const [seqText, setSeqText] = useState(initialSequence);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [organism, setOrganism] = useState('');
  const [seqType, setSeqType] = useState<NewSequenceDocType>(initialType);
  const [isCircular, setIsCircular] = useState(false);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [bindingRegionBp, setBindingRegionBp] = useState(0);
  const [bindingRegionTouched, setBindingRegionTouched] = useState(false);
  const [showTmOptions, setShowTmOptions] = useState(false);
  const [oligoConcNm, setOligoConcNm] = useState(() => loadUserPreferences().primers.primerConcNm);
  const [saltMm, setSaltMm] = useState(() => loadUserPreferences().primers.monovalentSaltMm);
  const [mgMm, setMgMm] = useState(() => loadUserPreferences().primers.divalentMgMm);
  const [dntpMm, setDntpMm] = useState(0.2);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const typeWrapRef = React.useRef<HTMLDivElement | null>(null);
  const seqInputRef = React.useRef<HTMLTextAreaElement | null>(null);

  const isOligoType = seqType === 'Primer' || seqType === 'Probe';

  // Extract clean sequence and optional FASTA/GenBank header metadata
  const parsedInput = useMemo(() => {
    const raw = seqText || '';
    let headerName = '';
    let headerDesc = '';
    let headerOrg = '';
    let detectedCircular = false;

    const trimmed = raw.trim();
    if (trimmed.startsWith('>')) {
      const firstNewline = trimmed.indexOf('\n');
      const headerLine = (firstNewline >= 0 ? trimmed.slice(1, firstNewline) : trimmed.slice(1)).trim();
      const orgMatch = headerLine.match(/\[([^\]]+)\]\s*$/);
      if (orgMatch) {
        headerOrg = orgMatch[1].trim();
      }
      const withoutOrg = headerLine.replace(/\[[^\]]+\]\s*$/, '').trim();
      const parts = withoutOrg.split(/\s+/);
      headerName = parts[0] || '';
      headerDesc = parts.slice(1).join(' ');
    } else if (/^LOCUS\s+/m.test(trimmed)) {
      const locusMatch = trimmed.match(/^LOCUS\s+(\S+)([^\n]*)/m);
      if (locusMatch) {
        headerName = locusMatch[1];
        if (/\bcircular\b/i.test(locusMatch[2])) {
          detectedCircular = true;
        }
      }
      const defMatch = trimmed.match(/^DEFINITION\s+([^\n]+)/m);
      if (defMatch) headerDesc = defMatch[1].trim();
      const orgMatch = trimmed.match(/^\s+ORGANISM\s+([^\n]+)/m);
      if (orgMatch) headerOrg = orgMatch[1].trim();
    }

    let body = raw;
    if (/^ORIGIN\b/im.test(raw)) {
      const origIdx = raw.search(/^ORIGIN\b/im);
      body = raw.slice(origIdx).replace(/^ORIGIN[^\n]*\n?/i, '').replace(/\/\/[\s\S]*$/, '');
    } else {
      body = raw.replace(/^>.*$/gm, '');
    }

    const cleaned = body.replace(/[^A-Za-z*]/g, '').toUpperCase();
    return { cleaned, headerName, headerDesc, headerOrg, detectedCircular };
  }, [seqText]);

  const cleanedLength = parsedInput.cleaned.length;
  const effectiveBindingBp = isOligoType
    ? bindingRegionTouched
      ? Math.max(0, Math.min(cleanedLength || bindingRegionBp, bindingRegionBp))
      : cleanedLength
    : 0;

  const oligoThermo = useMemo((): { tmC: number; gcPct: number; deltaG37: number; tmNoAnswerReason?: string } => {
    if (!isOligoType || cleanedLength === 0) {
      return { tmC: 0, gcPct: 0, deltaG37: 0 };
    }
    const bindLen = effectiveBindingBp > 0 ? effectiveBindingBp : cleanedLength;
    const bindSeq = parsedInput.cleaned.slice(Math.max(0, cleanedLength - bindLen));
    return computeOligoTmSantaLucia(bindSeq, oligoConcNm, saltMm, mgMm, dntpMm);
  }, [isOligoType, cleanedLength, effectiveBindingBp, parsedInput.cleaned, oligoConcNm, saltMm, mgMm, dntpMm]);
  // The binding region's Tm as each reader prints it: the reason in its place when it holds N.
  const oligoTmText = oligoThermo.tmNoAnswerReason ?? `Tm ${oligoThermo.tmC.toFixed(1)} °C`;

  // Gutter line numbers for the sequence box (60 residues per visual row)
  const gutterLineStarts = useMemo(() => {
    if (cleanedLength === 0) return [];
    const lines: number[] = [];
    const step = 60;
    for (let pos = 1; pos <= cleanedLength; pos += step) {
      lines.push(pos);
      if (lines.length >= 24) break;
    }
    return lines;
  }, [cleanedLength]);

  React.useEffect(() => {
    if (!typeDropdownOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (typeWrapRef.current && e.target instanceof Node && !typeWrapRef.current.contains(e.target)) {
        setTypeDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [typeDropdownOpen]);

  const handleSelectType = (nextType: NewSequenceDocType) => {
    setSeqType(nextType);
    setTypeDropdownOpen(false);
    if (nextType !== 'Nucleotide') {
      setIsCircular(false);
    }
    if (nextType === 'Primer' || nextType === 'Probe') {
      if (!bindingRegionTouched || bindingRegionBp === 0) {
        setBindingRegionBp(cleanedLength);
      }
    } else {
      setShowTmOptions(false);
    }
  };

  const handleSequenceChange = (val: string) => {
    setSeqText(val);
    if (validationMsg) setValidationMsg(null);
    // Auto-populate optional fields if FASTA or GenBank was pasted and fields are blank
    const trimmed = val.trim();
    if (trimmed.startsWith('>') || /^LOCUS\s+/m.test(trimmed)) {
      const firstLine = trimmed.split('\n')[0];
      if (trimmed.startsWith('>')) {
        const header = firstLine.slice(1).trim();
        const orgMatch = header.match(/\[([^\]]+)\]\s*$/);
        if (orgMatch && !organism.trim()) {
          setOrganism(orgMatch[1].trim());
        }
        const withoutOrg = header.replace(/\[[^\]]+\]\s*$/, '').trim();
        const tokens = withoutOrg.split(/\s+/);
        if (tokens[0] && !name.trim()) {
          setName(tokens[0]);
        }
        if (tokens.length > 1 && !description.trim()) {
          setDescription(tokens.slice(1).join(' '));
        }
      }
    }
  };

  const handleSave = () => {
    const cleaned = parsedInput.cleaned;
    if (!cleaned) {
      setValidationMsg('Please type or paste a sequence above.');
      seqInputRef.current?.focus();
      return;
    }

    const defaultTitle =
      seqType === 'Protein'
        ? 'Untitled_Protein'
        : seqType === 'Primer'
        ? 'Untitled_Primer'
        : seqType === 'Probe'
        ? 'Untitled_Probe'
        : 'Untitled_Sequence';

    const finalName = name.trim() || parsedInput.headerName || defaultTitle;
    const finalDesc =
      description.trim() ||
      parsedInput.headerDesc ||
      (seqType === 'Primer'
        ? `Manual oligonucleotide primer (${cleaned.length} nt, ${oligoTmText})`
        : seqType === 'Probe'
        ? `Manual hybridization probe (${cleaned.length} nt, ${oligoTmText})`
        : `Custom ${seqType.toLowerCase()} sequence (${cleaned.length} ${seqType === 'Protein' ? 'aa' : 'bp'})`);
    const finalOrg = organism.trim() || parsedInput.headerOrg;

    const moleculeType: 'DNA' | 'RNA' | 'Protein' =
      seqType === 'Protein'
        ? 'Protein'
        : cleaned.includes('U') && !cleaned.includes('T')
        ? 'RNA'
        : 'DNA';

    const topology: 'linear' | 'circular' =
      seqType === 'Nucleotide' && (isCircular || parsedInput.detectedCircular)
        ? 'circular'
        : 'linear';

    const isGenericFolder =
      !defaultFolder ||
      defaultFolder === 'All Project Files' ||
      defaultFolder === 'Local' ||
      defaultFolder === 'Sample Documents' ||
      defaultFolder === 'Favorites' ||
      defaultFolder === 'Deleted Items';

    const resolvedFolder = !isGenericFolder
      ? defaultFolder
      : seqType === 'Protein'
      ? 'Protein Documents'
      : isOligoType
      ? 'Primers'
      : 'Plasmids & Vectors';

    const documentKind =
      seqType === 'Protein'
        ? 'protein'
        : isOligoType
        ? 'primer'
        : topology === 'circular'
        ? 'circular-dna'
        : 'linear-dna';

    const bindLen = isOligoType
      ? effectiveBindingBp > 0 && effectiveBindingBp <= cleaned.length
        ? effectiveBindingBp
        : cleaned.length
      : cleaned.length;
    const bindStart = isOligoType ? Math.max(1, cleaned.length - bindLen + 1) : 1;

    const currentPrefs = loadUserPreferences();
    const defaultAuthor = currentPrefs.filesAndTabs.defaultAuthor.trim();
    const defaultStrain = currentPrefs.general.defaultStrain.trim();

    const docMetadata: Record<string, string | number> = {
      ...(finalOrg ? { Organism: finalOrg } : {}),
      ...(defaultAuthor ? { Author: defaultAuthor } : {}),
      ...(defaultStrain ? { Strain: defaultStrain } : {}),
      'Sequence Type': seqType,
      ...(isOligoType
        ? {
            'Oligo Type': seqType,
            'Binding Region': `${bindLen} bp`,
            Tm: oligoThermo.tmNoAnswerReason ?? `${oligoThermo.tmC.toFixed(1)} °C`,
            '%GC Primer Bind': `${oligoThermo.gcPct.toFixed(1)}%`,
          }
        : {}),
    };

    const newDoc: SequenceDocument = {
      id: `doc-custom-${Date.now()}`,
      name: finalName,
      accession: `MBC_${Math.floor(1000 + Math.random() * 9000)}`,
      description: finalDesc,
      moleculeType,
      topology,
      sequence: cleaned,
      documentKind,
      docMetadata,
      folder: resolvedFolder,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      features: [
        {
          id: `feat-${Date.now()}`,
          name: isOligoType ? `${finalName}_bind` : finalName,
          type: isOligoType ? 'primer_bind' : seqType === 'Protein' ? 'Domain' : 'CDS',
          start: bindStart,
          end: cleaned.length,
          strand: 1,
          color: isOligoType ? '#0284c7' : '#10b981',
          notes: finalDesc,
        },
      ],
      primers: isOligoType
        ? [
            {
              id: `prm-${Date.now()}`,
              name: finalName,
              sequence: cleaned,
              annealSequence: cleaned.slice(bindStart - 1),
              tail5Prime: cleaned.slice(0, bindStart - 1),
              bindStart,
              bindEnd: cleaned.length,
              strand: 1,
              length: cleaned.length,
              gcPercent: oligoThermo.gcPct,
              tmAnnealC: oligoThermo.tmC,
              tmFullC: computeOligoTmSantaLucia(cleaned, oligoConcNm, saltMm, mgMm, dntpMm).tmC,
              deltaG37: oligoThermo.deltaG37,
              hairpinDeltaG: -0.8,
              selfDimerDeltaG: -1.4,
              gcClamp3Prime: /[GC]$/i.test(cleaned),
              notes: `${seqType} (${bindLen} bp binding region)`,
              ...(oligoThermo.tmNoAnswerReason ? { tmNoAnswerReason: oligoThermo.tmNoAnswerReason } : {}),
            },
          ]
        : [],
      history: [
        {
          id: `hist-${Date.now()}`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          operation: `New ${seqType} Created`,
          description: `Created ${cleaned.length} ${seqType === 'Protein' ? 'aa' : 'bp'} ${topology} ${seqType.toLowerCase()} sequence${finalOrg ? ` (${finalOrg})` : ''}`,
          parentIds: [],
          lengthBp: cleaned.length,
          topology,
        },
      ],
    };
    onCreateDoc(newDoc);
    onClose();
  };

  return (
    <StaticModalDialog
      titleId="mbc-newseq-dialog-title"
      title="New Sequence"
      sizeClass="modal-size-newseq"
      onClose={onClose}
    >
      <div className="prefs-modal-body newseq-modal-body">
        <div className="newseq-top-bar">
          <label htmlFor="mbc-newseq-seq-input" className="newseq-top-label">
            Type or paste in sequence:
          </label>
          {cleanedLength > 0 && (
            <span className="newseq-live-count">
              {cleanedLength.toLocaleString()} {seqType === 'Protein' ? 'aa' : 'bp'}
            </span>
          )}
        </div>

        <div className="newseq-editor-box">
          <div className="newseq-editor-gutter" aria-hidden="true">
            {gutterLineStarts.map((lineStart) => (
              <div key={lineStart} className="newseq-gutter-num">
                {lineStart}
              </div>
            ))}
          </div>
          <textarea
            ref={seqInputRef}
            id="mbc-newseq-seq-input"
            className="newseq-editor-textarea"
            rows={9}
            value={seqText}
            data-autofocus="true"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => handleSequenceChange(e.target.value)}
          />
        </div>

        {validationMsg && (
          <div className="newseq-validation-msg" role="alert">
            {validationMsg}
          </div>
        )}

        <div className="newseq-form-grid">
          <label htmlFor="mbc-newseq-name" className="newseq-field-label">
            Name:
          </label>
          <div className="newseq-field-control">
            <input
              id="mbc-newseq-name"
              type="text"
              className="newseq-text-input"
              placeholder="Optional"
              value={name}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <label htmlFor="mbc-newseq-desc" className="newseq-field-label">
            Description:
          </label>
          <div className="newseq-field-control">
            <input
              id="mbc-newseq-desc"
              type="text"
              className="newseq-text-input"
              placeholder="Optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <label htmlFor="mbc-newseq-org" className="newseq-field-label">
            Organism:
          </label>
          <div className="newseq-field-control">
            <input
              id="mbc-newseq-org"
              type="text"
              className="newseq-text-input"
              placeholder="Optional"
              value={organism}
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setOrganism(e.target.value)}
            />
          </div>

          <label htmlFor="mbc-newseq-type-btn" className="newseq-field-label">
            Type:
          </label>
          <div className="newseq-field-control newseq-type-row">
            <div className="newseq-type-dropdown-wrap" ref={typeWrapRef}>
              <button
                id="mbc-newseq-type-btn"
                type="button"
                className="newseq-type-trigger"
                aria-haspopup="listbox"
                aria-expanded={typeDropdownOpen}
                onClick={() => setTypeDropdownOpen((open) => !open)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const idx = NEW_SEQUENCE_TYPE_OPTIONS.findIndex((o) => o.value === seqType);
                    const delta = e.key === 'ArrowDown' ? 1 : -1;
                    const nextIdx =
                      (idx + delta + NEW_SEQUENCE_TYPE_OPTIONS.length) %
                      NEW_SEQUENCE_TYPE_OPTIONS.length;
                    handleSelectType(NEW_SEQUENCE_TYPE_OPTIONS[nextIdx].value);
                  } else if (e.key === 'Escape' && typeDropdownOpen) {
                    e.stopPropagation();
                    setTypeDropdownOpen(false);
                  }
                }}
              >
                <span className="newseq-type-trigger-text">{seqType}</span>
                <span className="newseq-type-trigger-caret" aria-hidden="true">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 4.25 6 7.75l3.5-3.5"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>

              <ul
                role="listbox"
                aria-label="Sequence Type"
                className={`newseq-type-listbox ${typeDropdownOpen ? 'is-open' : ''}`}
              >
                {NEW_SEQUENCE_TYPE_OPTIONS.map((opt) => {
                  const selected = opt.value === seqType;
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={selected}
                      className={`newseq-type-option ${selected ? 'is-selected' : ''}`}
                      onClick={() => handleSelectType(opt.value)}
                    >
                      <strong className="newseq-type-opt-title">{opt.label}</strong>
                      <span className="newseq-type-opt-sep">: </span>
                      <span className="newseq-type-opt-desc">{opt.description}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <label
              className={`newseq-circular-check ${
                seqType !== 'Nucleotide' ? 'is-disabled' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={seqType === 'Nucleotide' && isCircular}
                disabled={seqType !== 'Nucleotide'}
                onChange={(e) => setIsCircular(e.target.checked)}
              />
              <span>Circular</span>
            </label>
          </div>

          <label
            htmlFor="mbc-newseq-binding-bp"
            className={`newseq-field-label ${!isOligoType ? 'is-disabled' : ''}`}
          >
            Binding Region:
          </label>
          <div className="newseq-field-control newseq-binding-row">
            <input
              id="mbc-newseq-binding-bp"
              type="number"
              min={0}
              max={Math.max(9999, cleanedLength)}
              value={isOligoType ? effectiveBindingBp : 0}
              disabled={!isOligoType}
              onChange={(e) => {
                setBindingRegionTouched(true);
                setBindingRegionBp(Math.max(0, Number(e.target.value) || 0));
              }}
              className="newseq-binding-input"
            />
            <span className={`newseq-bp-unit ${!isOligoType ? 'is-disabled' : ''}`}>bp</span>
            <button
              type="button"
              className="newseq-binding-enter-btn"
              disabled={!isOligoType}
              title="Set binding region length to full sequence length"
              aria-label="Set binding region length to full sequence length"
              onClick={() => {
                setBindingRegionTouched(true);
                setBindingRegionBp(cleanedLength);
              }}
            >
              ↵
            </button>
            <button
              type="button"
              className="newseq-tm-options-btn"
              disabled={!isOligoType}
              aria-expanded={showTmOptions}
              onClick={() => setShowTmOptions((v) => !v)}
            >
              Tm Options
            </button>
          </div>
        </div>

        {isOligoType && showTmOptions && (
          <div className="newseq-tm-options-panel">
            <div className="newseq-tm-options-grid">
              <label className="newseq-tm-field">
                <span>Oligo Conc. (nM):</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={oligoConcNm}
                  onChange={(e) => setOligoConcNm(Math.max(1, Number(e.target.value) || 250))}
                />
              </label>
              <label className="newseq-tm-field">
                <span>Monovalent [Na+] (mM):</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={saltMm}
                  onChange={(e) => setSaltMm(Math.max(1, Number(e.target.value) || 50))}
                />
              </label>
              <label className="newseq-tm-field">
                <span>Divalent [Mg2+] (mM):</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={mgMm}
                  onChange={(e) => setMgMm(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
              <label className="newseq-tm-field">
                <span>dNTPs (mM):</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.1}
                  value={dntpMm}
                  onChange={(e) => setDntpMm(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            </div>
            <div className="newseq-tm-live-summary">
              <span title={oligoThermo.tmNoAnswerReason}>
                Melting Temp (Tm): <strong>{oligoThermo.tmNoAnswerReason ? 'n/a' : `${oligoThermo.tmC.toFixed(1)} °C`}</strong>
              </span>
              {oligoThermo.tmNoAnswerReason && <span>{oligoThermo.tmNoAnswerReason}</span>}
              <span>
                %GC: <strong>{oligoThermo.gcPct.toFixed(1)}%</strong>
              </span>
              <span>
                ΔG°37: <strong>{oligoThermo.deltaG37.toFixed(1)} kcal/mol</strong>
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="prefs-modal-footer newseq-modal-footer">
        <button type="button" className="btn-secondary-sm newseq-btn-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary-sm newseq-btn-ok" onClick={handleSave}>
          OK
        </button>
      </div>
    </StaticModalDialog>
  );
};

interface AboutMolBioCraftModalProps {
  onClose: () => void;
}

export const AboutMolBioCraftModal: React.FC<AboutMolBioCraftModalProps> = ({
  onClose,
}) => {
  return (
    <StaticModalDialog
      titleId="mbc-about-dialog-title"
      title="About MolBioCraft"
      sizeClass="modal-size-about"
      onClose={onClose}
    >
      <div className="about-single-page-body">
        <div className="about-hero-lockup">
          <MolBioCraftLogo size={76} decorative={true} />
          <div className="about-hero-wordmark">
            <div className="about-hero-brand mbc-logo-wordmark">MolBioCraft</div>
            <div className="about-hero-sub">Workbench</div>
          </div>
        </div>

        <div className="about-info-stack">
          <div className="about-info-group">
            <div className="about-version-line">MolBioCraft v1.0.0</div>
            <div>Molecular &amp; Evolutionary Biology Workbench</div>
            <div>Cross-Platform Desktop Application (macOS, Windows &amp; Linux)</div>
          </div>

          <div className="about-info-group">
            <div>
              Developed by <strong>Bundit Boonyarit</strong>
            </div>
            <div>CC BY-NC 4.0 (SPDX: CC-BY-NC-4.0) — Open-Source Research Workbench</div>
          </div>

          <div className="about-info-group">
            <div>
              GitHub:{' '}
              <a
                href="https://github.com/manbaritone/MolBioCraft"
                target="_blank"
                rel="noopener noreferrer"
                className="about-ext-link"
              >
                https://github.com/manbaritone/MolBioCraft
              </a>
            </div>
            <div>
              Issues &amp; Support:{' '}
              <a
                href="https://github.com/manbaritone/MolBioCraft/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="about-ext-link"
              >
                https://github.com/manbaritone/MolBioCraft/issues
              </a>
            </div>
            <div>Copyright &copy; 2026 Bundit Boonyarit. All rights reserved.</div>
          </div>

          <div className="about-info-group about-info-note">
            <div>
              Permitted for personal study, classroom teaching, and non-commercial academic research.
            </div>
            <div>
              Commercial use requires prior written authorization from the developer.
            </div>
          </div>
        </div>
      </div>

      <div className="prefs-modal-footer about-single-page-footer">
        <button type="button" className="btn-primary-sm" onClick={onClose}>
          Close
        </button>
      </div>
    </StaticModalDialog>
  );
};

export interface ConfirmQuitModalProps {
  onCancel: () => void;
  onConfirmQuit: (dontAskAgain: boolean) => void;
}

export const ConfirmQuitModal: React.FC<ConfirmQuitModalProps> = ({
  onCancel,
  onConfirmQuit,
}) => {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  return (
    <StaticModalDialog
      titleId="mbc-confirm-quit-dialog-title"
      title="Confirm Quit"
      sizeClass="modal-size-confirm-quit"
      closedBy="closerequest"
      onClose={onCancel}
    >
      <div className="confirm-quit-content">
        <div className="confirm-quit-body">
          <div className="confirm-quit-icon-wrap" aria-hidden="true">
            <svg
              className="confirm-quit-icon"
              width="36"
              height="36"
              viewBox="0 0 36 36"
              fill="none"
            >
              <circle
                cx="18"
                cy="18"
                r="15"
                stroke="currentColor"
                strokeWidth="2.1"
              />
              <path
                d="M14.3 14.15a3.75 3.75 0 0 1 7.4 0.95c0 2.3-3.7 2.85-3.7 5.05"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="18" cy="24.8" r="1.35" fill="currentColor" />
            </svg>
          </div>
          <p className="confirm-quit-message">
            Are you sure you want to quit MolBioCraft?
          </p>
        </div>

        <div className="confirm-quit-footer">
          <label className="confirm-quit-dont-ask">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            <span>Don&apos;t ask again</span>
          </label>

          <div className="confirm-quit-actions">
            <button
              type="button"
              className="confirm-quit-btn confirm-quit-btn-cancel"
              autoFocus
              data-autofocus="true"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="confirm-quit-btn confirm-quit-btn-quit"
              onClick={() => onConfirmQuit(dontAskAgain)}
            >
              Quit
            </button>
          </div>
        </div>
      </div>
    </StaticModalDialog>
  );
};
