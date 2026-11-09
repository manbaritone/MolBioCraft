/// <reference types="vite/client" />
// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import appSrc from '../App.tsx?raw';
import spaceGroteskFontUrl from '../assets/fonts/space-grotesk/SpaceGrotesk-VariableFont_wght.ttf?url';
import macMainMm from '../../packaging/macos/main.mm?raw';
import tauriCapDefaultJson from '../../src-tauri/capabilities/default.json?raw';
import tauriMainRs from '../../src-tauri/src/main.rs?raw';
import {
  CascadingMenuPopup,
  MenuNode,
} from '../components/CascadingMenu';
import cascadingMenuSrc from '../components/CascadingMenu.tsx?raw';
import {
  PhylogeneticsStudio,
  SequenceAlignmentStudio,
} from '../components/AlignmentAndPhyloStudio';
import {
  AboutMolBioCraftModal,
  BlastSearchModal,
  ConfirmQuitModal,
  NEW_SEQUENCE_TYPE_OPTIONS,
  NewSequenceModal,
  PREFERENCES_CATEGORIES,
  PreferencesModal,
  computeOligoTmSantaLucia,
} from '../components/MenusPreferencesAndBlastModal';
import { MolBioCraftLogo } from '../components/MolBioCraftLogo';
import { AppStartupSplash } from '../components/AppStartupSplash';
import { CloningAndGelStudio } from '../components/CloningAndGelStudio';
import {
  MolBioMenuGlyph,
  resolveMenuGlyphKind,
} from '../components/MolBioIcons';
import molBioIconsSrc from '../components/MolBioIcons.tsx?raw';
import { ProjectFirstPageHome } from '../components/ProjectFirstPageHome';
import { ScrollableMenuStrip } from '../components/ScrollableMenuStrip';
import scrollableStripSrc from '../components/ScrollableMenuStrip.tsx?raw';
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
} from '../components/ToolbarBioIcons';
import {
  extractZipArchiveEntries,
  isMbcFileOrPayload,
  isMbcZipArchiveBytes,
  parseMbcFolderZip,
  parseMbcWorkbench,
  serializeMbcFolderZip,
  serializeMbcWorkbench,
} from '../core/mbcSessionFormat';
import {
  buildCloningActionVectorDocument,
  CLONING_ACTION_VECTOR_PRESETS,
} from '../data/cloningActionVectors';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  MENU_FUNCTION_INFO_EVENT,
  MENU_FUNCTION_INFO_STORAGE_KEY,
  readStoredShowMenuFunctionInfo,
  resolveMenuNodeFunctionDescription,
  writeStoredShowMenuFunctionInfo,
} from '../data/menuFunctionDescriptions';
import {
  computeViewportClampedMenuPosition,
  computeViewportClampedSubmenuPosition,
  CONFIRM_BEFORE_QUIT_STORAGE_KEY,
  decodeBase64ToFile,
  isInteractiveWindowChromeTarget,
  isNativeMacMenuBarActive,
  performNativeAppQuit,
  postMacosNativeOpen,
  postMacosNativeSave,
  postMacosWindowDrag,
  postMacosWindowZoom,
  readStoredConfirmBeforeQuit,
  requestDesktopWindowDrag,
  requestDesktopWindowToggleMaximize,
  subscribeNativeMacMenuEvents,
  subscribeTauriWindowFileDropEvents,
  syncNativeConfirmBeforeQuit,
  writeStoredConfirmBeforeQuit,
} from '../platform/macosMenuBridge';

const EXCLUDED_COMMERCIAL_SW_B64 =
  'c25hcGdlbmV8ZG90bWF0aWNzfGxhYmFyY2hpdmVzfGdlbmVpb3VzfGJpb21hdHRlcnN8bHVtYXx2ZWN0b3JidWlsZGVyfGJlbmNobGluZ3xkbmFzdGFyfG1hY3ZlY3RvcnxsYXNlcmdlbmV8cHltb2w=';
const EXCLUDED_UI_TERMS_RE = new RegExp(
  `\\b(video|videos|purchase|${atob(EXCLUDED_COMMERCIAL_SW_B64)})\\b`,
  'i'
);
const EXCLUDED_HOME_TERMS_RE = new RegExp(
  `\\b(video|videos|purchase|order|orders|ordering|${atob(EXCLUDED_COMMERCIAL_SW_B64)})\\b`,
  'i'
);

interface MockMacosBridgeGlobals {
  __MBC_NATIVE_MACOS_MENUBAR__?: boolean;
  __MBC_MACOS_APP_BUNDLE__?: boolean;
  __TAURI_INTERNALS__?: {
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  webkit?: {
    messageHandlers?: {
      mbcNative?: {
        postMessage?: (payload: Record<string, unknown>) => void;
      };
    };
  };
  window?: EventTarget;
}

describe('macOS Native System Menu Bar Bridge & Viewport-Clamped Dropdown Positioning', () => {
  const g = globalThis as unknown as MockMacosBridgeGlobals;

  beforeEach(() => {
    delete g.__MBC_NATIVE_MACOS_MENUBAR__;
    delete g.__MBC_MACOS_APP_BUNDLE__;
    delete g.__TAURI_INTERNALS__;
    delete g.webkit;
  });

  afterEach(() => {
    delete g.__MBC_NATIVE_MACOS_MENUBAR__;
    delete g.__MBC_MACOS_APP_BUNDLE__;
    delete g.__TAURI_INTERNALS__;
    delete g.webkit;
  });

  it('clamps dropdown left and maxHeight strictly inside horizontal and vertical viewport bounds', () => {
    // Normal toolbar button (e.g. Add ▾ at left=290, bottom=54 on 1280x800 viewport)
    const addPos = computeViewportClampedMenuPosition(
      { left: 290, top: 8, bottom: 54 },
      1280,
      800,
      310
    );
    expect(addPos.left).toBe(290);
    expect(addPos.top).toBe(58);
    expect(addPos.maxHeight).toBe(728);

    // Right-aligned toolbar button (e.g. Cloning ▾ at left=1080 on 1280x700 viewport with minWidth=315)
    const cloningPos = computeViewportClampedMenuPosition(
      { left: 1080, top: 8, bottom: 54 },
      1280,
      700,
      315
    );
    expect(cloningPos.left).toBeLessThanOrEqual(1280 - 315 - 10);
    expect(cloningPos.top).toBe(58);
    expect(cloningPos.maxHeight).toBe(628);
  });

  it('positions cascading nested sub-menus beside triggers, flips left near right edge, and stacks below on narrow viewports', () => {
    // 1. Standard inline-end submenu (e.g. File -> New Session -> Sequence & Vector Tasks)
    const rightSideSub = computeViewportClampedSubmenuPosition(
      { left: 60, right: 320, top: 88, bottom: 116 },
      1440,
      900,
      290,
      220
    );
    expect(rightSideSub.flippedLeft).toBe(false);
    expect(rightSideSub.stackedBelow).toBe(false);
    expect(rightSideSub.left).toBe(323);
    expect(rightSideSub.right).toBeUndefined();
    expect(rightSideSub.top).toBe(83);

    // 2. Right-aligned menu (e.g. Cloning ▾ or Annotate & Predict near right viewport boundary): flips to inline-start via CSS `right`
    const flippedLeftSub = computeViewportClampedSubmenuPosition(
      { left: 1010, right: 1270, top: 140, bottom: 168 },
      1280,
      800,
      290,
      240
    );
    expect(flippedLeftSub.flippedLeft).toBe(true);
    expect(flippedLeftSub.stackedBelow).toBe(false);
    expect(flippedLeftSub.left).toBeUndefined();
    expect(flippedLeftSub.right).toBe(1280 - 1010 + 3);
    expect(flippedLeftSub.maxWidth).toBeGreaterThanOrEqual(210);

    // 3. Bottom-near submenu trigger clamps `top` upward so tall submenus stay visible inside viewport
    const bottomClampedSub = computeViewportClampedSubmenuPosition(
      { left: 120, right: 380, top: 720, bottom: 748 },
      1280,
      800,
      280,
      260
    );
    expect(bottomClampedSub.top).toBeLessThanOrEqual(800 - 260 - 10);
    expect(bottomClampedSub.maxHeight).toBeGreaterThanOrEqual(160);

    // 4. Narrow screen (< 440px): stacks below trigger row so submenu never covers its own trigger
    const narrowStackedSub = computeViewportClampedSubmenuPosition(
      { left: 18, right: 260, top: 96, bottom: 124 },
      390,
      740,
      280,
      220
    );
    expect(narrowStackedSub.stackedBelow).toBe(true);
    expect(narrowStackedSub.top).toBe(126);
    expect(narrowStackedSub.left).toBeGreaterThanOrEqual(10);
  });

  it('activates native macOS system menu bar only in macOS desktop containers and respects OS preview overrides', () => {
    // Plain web browser on macOS still renders in-window menu bar
    expect(isNativeMacMenuBarActive('macos')).toBe(false);

    // Native Cocoa/WKWebView MolBioCraft.app bundle
    g.__MBC_NATIVE_MACOS_MENUBAR__ = true;
    expect(isNativeMacMenuBarActive('macos')).toBe(true);
    // Switching OS preview to Windows or Linux restores the in-window menu bar preview
    expect(isNativeMacMenuBarActive('windows')).toBe(false);
    expect(isNativeMacMenuBarActive('linux')).toBe(false);

    // Tauri v2 desktop container on macOS
    delete g.__MBC_NATIVE_MACOS_MENUBAR__;
    g.__TAURI_INTERNALS__ = { invoke: async () => null };
    expect(isNativeMacMenuBarActive('macos')).toBe(true);
    expect(isNativeMacMenuBarActive('windows')).toBe(false);
  });

  it('delegates native NSSavePanel, NSOpenPanel, and titleless window drag/zoom messages via WKScriptMessageHandler when bundled', () => {
    expect(postMacosNativeSave('pET28a.gb', 'LOCUS pET28a')).toBe(false);
    expect(postMacosNativeOpen('replace')).toBe(false);
    expect(postMacosWindowDrag()).toBe(false);
    expect(postMacosWindowZoom()).toBe(false);

    const posted: Record<string, unknown>[] = [];
    const mbcNativeHandler = {
      postMessage(this: unknown, payload: Record<string, unknown>) {
        // Mirror WebKit C++ JSUserMessageHandler::postMessage, which silently drops unbound calls
        if (this !== mbcNativeHandler) {
          return;
        }
        posted.push(payload);
      },
    };
    g.__MBC_MACOS_APP_BUNDLE__ = true;
    g.webkit = {
      messageHandlers: {
        mbcNative: mbcNativeHandler,
      },
    };

    expect(postMacosNativeSave('pET28a.gb', 'LOCUS pET28a')).toBe(true);
    expect(postMacosNativeOpen('merge')).toBe(true);
    expect(postMacosNativeOpen('import')).toBe(true);
    expect(postMacosNativeOpen('prefs')).toBe(true);
    expect(postMacosWindowDrag()).toBe(true);
    expect(postMacosWindowZoom()).toBe(true);
    expect(posted).toEqual([
      { type: 'saveFile', filename: 'pET28a.gb', content: 'LOCUS pET28a' },
      { type: 'openFile', mode: 'merge' },
      { type: 'openFile', mode: 'import' },
      { type: 'openFile', mode: 'prefs' },
      { type: 'windowDrag' },
      { type: 'windowZoom' },
    ]);
  });

  it('decodes base64 payloads from NSOpenPanel into exact File byte buffers and dispatches DOM menu events', async () => {
    const sampleContent = 'LOCUS       pUC19               2686 bp ds-DNA     circular';
    const b64 = btoa(sampleContent);
    const decoded = decodeBase64ToFile(b64, 'pUC19.gb');
    expect(decoded.name).toBe('pUC19.gb');
    expect(await decoded.text()).toBe(sampleContent);

    const hadWindow = typeof globalThis.window !== 'undefined';
    if (!hadWindow) {
      g.window = new EventTarget();
    }

    try {
      const actions: string[] = [];
      const opened: { name: string; mode: string }[] = [];
      const saved: string[] = [];

      const unsubscribe = subscribeNativeMacMenuEvents({
        onMenuAction: (id) => actions.push(id),
        onNativeFileOpen: (file, mode) => opened.push({ name: file.name, mode }),
        onNativeFileSaved: (name) => saved.push(name),
      });

      window.dispatchEvent(new CustomEvent('mbc:native-menu', { detail: 'new-session:sequence' }));
      window.dispatchEvent(new CustomEvent('mbc:native-menu', { detail: 'actions:gibson' }));
      window.dispatchEvent(new CustomEvent('mbc:native-menu', { detail: 'file:close-session' }));
      window.dispatchEvent(
        new CustomEvent('mbc:native-file-open', {
          detail: { fileName: 'pUC19.gb', base64: b64, mode: 'import' },
        })
      );
      window.dispatchEvent(
        new CustomEvent('mbc:native-file-saved', { detail: 'Workbench.mbc' })
      );

      expect(actions).toEqual(['new-session:sequence', 'actions:gibson', 'file:close-session']);
      expect(opened).toEqual([{ name: 'pUC19.gb', mode: 'import' }]);
      expect(saved).toEqual(['Workbench.mbc']);

      unsubscribe();
      window.dispatchEvent(new CustomEvent('mbc:native-menu', { detail: 'tools:blast' }));
      expect(actions).toEqual(['new-session:sequence', 'actions:gibson', 'file:close-session']);
    } finally {
      if (!hadWindow) {
        delete g.window;
      }
    }
  });

  it('renders static top-anchored native <dialog> popup windows and 11-category 2-column split Preferences across all categories', () => {
    expect(PREFERENCES_CATEGORIES).toEqual([
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
    ]);

    const noop = () => {};
    const generalHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'General',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );
    const dnaHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'DNA',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );
    const tracesHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'Traces & Alignment',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );
    const enzymesHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'Enzymes',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );
    const primersHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'Primers',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );
    const keyboardHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'Keyboard',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );

    const rnaHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'RNA',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );
    const proteinsHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'Proteins',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );

    expect(generalHtml).toContain('Preferences: General');
    expect(dnaHtml).toContain('Preferences: DNA');
    expect(dnaHtml).toContain('prefs-square-toggle');
    expect(dnaHtml).toContain('data-prefs-icon="dna-enzymes"');
    expect(dnaHtml).toContain('data-prefs-icon="dna-features"');
    expect(dnaHtml).toContain('data-prefs-icon="dna-primers"');
    expect(dnaHtml).toContain('data-prefs-icon="dna-orfs"');
    expect(dnaHtml).toContain('width="22" height="22"');
    expect(dnaHtml).toContain('<span class="prefs-square-codon">ATG</span>');

    expect(rnaHtml).toContain('Preferences: RNA');
    expect(rnaHtml).toContain('data-prefs-icon="rna-features"');
    expect(rnaHtml).toContain('data-prefs-icon="rna-orfs"');
    expect(rnaHtml).toContain('<span class="prefs-square-codon">AUG</span>');

    expect(proteinsHtml).toContain('Preferences: Proteins');
    expect(proteinsHtml).toContain('data-prefs-icon="protein-regions"');
    expect(proteinsHtml).toContain('data-prefs-icon="protein-sites"');
    expect(proteinsHtml).toContain('data-prefs-icon="protein-bonds"');
    expect(proteinsHtml).toContain('width="22" height="22"');

    expect(tracesHtml).toContain('Preferences: Traces &amp; Alignment');
    expect(tracesHtml).toContain('Live Chromatogram Preview');
    expect(enzymesHtml).toContain('Preferences: Enzymes');
    expect(enzymesHtml).toContain('New England Biolabs (NEB)');
    expect(primersHtml).toContain('Preferences: Primers');
    expect(keyboardHtml).toContain('Preferences: Keyboard');

    for (const html of [
      generalHtml,
      dnaHtml,
      rnaHtml,
      proteinsHtml,
      tracesHtml,
      enzymesHtml,
      primersHtml,
      keyboardHtml,
    ]) {
      expect(html).toContain('<dialog');
      expect(html).toContain('closedby="any"');
      expect(html).toContain('class="prefs-modal-window modal-size-prefs"');
      expect(html).toContain('class="prefs-split-layout"');
      expect(html).toContain('class="prefs-sidebar-list"');
      expect(html).not.toContain('modal-backdrop');
      expect(html).not.toMatch(EXCLUDED_UI_TERMS_RE);
    }

    const blastHtml = renderToStaticMarkup(
      React.createElement(BlastSearchModal, {
        activeDoc: SAMPLE_LIBRARY[0],
        allDocs: SAMPLE_LIBRARY,
        onClose: noop,
        onSelectHitDoc: noop,
      })
    );
    expect(blastHtml).toContain('class="prefs-modal-window modal-size-blast"');
    expect(blastHtml).not.toContain('modal-backdrop');

    const newSeqHtml = renderToStaticMarkup(
      React.createElement(NewSequenceModal, {
        defaultFolder: 'Plasmids & Vectors',
        onClose: noop,
        onCreateDoc: noop,
      })
    );
    expect(newSeqHtml).toContain('class="prefs-modal-window modal-size-newseq"');
    expect(newSeqHtml).not.toContain('modal-backdrop');

    const aboutHtml = renderToStaticMarkup(
      React.createElement(AboutMolBioCraftModal, {
        onClose: noop,
      })
    );
    expect(aboutHtml).toContain('class="prefs-modal-window modal-size-about"');
    expect(aboutHtml).toContain('About MolBioCraft');
    expect(aboutHtml).toContain('about-hero-brand mbc-logo-wordmark');
    expect(aboutHtml).toContain('Bundit Boonyarit');
    expect(aboutHtml).toContain('https://github.com/manbaritone/MolBioCraft');
    expect(aboutHtml).not.toContain('Software Languages');
    expect(aboutHtml).not.toContain('Runtime Architecture');
    expect(aboutHtml).not.toContain('Vector Library');
    // The About hero shows the shipped application icon, not a second, separate mark.
    expect(aboutHtml).toContain('src="/logo.svg"');
    expect(aboutHtml).not.toContain('modal-backdrop');

    // Verify Space Grotesk variable font asset is bundled for MolBioCraft logo wordmarks
    expect(spaceGroteskFontUrl).toContain('SpaceGrotesk-VariableFont_wght.ttf');

    const logoHtml = renderToStaticMarkup(
      React.createElement(MolBioCraftLogo, { size: 54, decorative: false })
    );
    // The brand mark is the shipped icon artwork itself, at the icon's own corner radius
    // (108/512), so the in-app logo cannot drift away from the installed application icon.
    expect(logoHtml).toContain('src="/logo.svg"');
    expect(logoHtml).toContain('width="54"');
    expect(logoHtml).toContain('border-radius:11px');
    expect(logoHtml).toContain('alt="MolBioCraft');
    expect(logoHtml).not.toContain('<svg');
  });

  it('renders ProjectFirstPageHome 2-column welcome layout cleanly with zero forbidden vendor, video, order/purchase, or What’s New strings', () => {
    const noop = () => {};
    const homeHtml = renderToStaticMarkup(
      React.createElement(ProjectFirstPageHome, {
        sidebarOpen: true,
        sessionActive: false,
        sessionName: 'MolBioCraft_Workbench',
        documents: SAMPLE_LIBRARY,
        hasLocalAutosave: true,
        openDropdown: null,
        onToggleDropdown: noop,
        onOpenSampleProject: noop,
        onStartBlankProject: noop,
        onOpenMbcSession: noop,
        onRestoreAutosave: noop,
        onOpenFilePicker: noop,
        onOpenSampleDocumentById: noop,
        onResumeActiveSession: noop,
        onOpenShortcuts: noop,
      })
    );

    expect(homeHtml).toContain('No folder opened');
    expect(homeHtml).toContain('mbc-home-title mbc-logo-wordmark');
    expect(homeHtml).toContain('Sample Project');
    expect(homeHtml).toContain('Start a project');
    expect(homeHtml).toContain('Sample files'); // they were labelled "Recent" but are fixed samples
    expect(homeHtml).toContain('WORKBENCH CAPABILITIES');
    expect(homeHtml).toContain('Multifile Project Info Table');
    expect(homeHtml).toContain('Primer Specificity &amp; Binding Alerts');
    expect(homeHtml).toContain('Integrated 4-Dye Sanger Trace View');
    expect(homeHtml).not.toContain('mbc-home-callout');
    expect(homeHtml).not.toContain('Explore MolBioCraft with our curated Sample Project');
    expect(homeHtml).not.toMatch(/What['’]s New/i);
    expect(homeHtml).not.toMatch(EXCLUDED_HOME_TERMS_RE);
  });

  it('synthesizes annotated SequenceDocuments across all 7 Gateway, TA, GC, and TOPO cloning action vector groups', () => {
    expect(CLONING_ACTION_VECTOR_PRESETS.length).toBeGreaterThanOrEqual(27);
    const groups = new Set(CLONING_ACTION_VECTOR_PRESETS.map((p) => p.group));
    expect(Array.from(groups).sort()).toEqual([
      'gateway-dest',
      'gateway-donor',
      'gc-vectors',
      'ta-vectors',
      'topo-blunt',
      'topo-directional',
      'topo-ta',
    ]);

    for (const presetId of ['gw-pdonr221', 'gw-pdest17', 'ta-pgem-t-easy', 'gc-pgc-blue', 'topo-pentr-d-topo']) {
      const preset = CLONING_ACTION_VECTOR_PRESETS.find((p) => p.id === presetId)!;
      expect(preset).toBeDefined();
      const doc = buildCloningActionVectorDocument(preset);
      expect(doc.sequence.length).toBeGreaterThanOrEqual(2000);
      expect(doc.topology).toBe(preset.topology);
      expect(doc.features.length).toBeGreaterThanOrEqual(5);
      expect(doc.primers.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('ungroups SequenceAlignmentStudio and PhylogeneticsStudio cleanly with non-overlapping MSA taxon columns and zero grouped medallion ribbon', () => {
    const alignDocs = SAMPLE_LIBRARY.filter(
      (d) => d.moleculeType === 'DNA' && d.sequence.length > 0 && d.sequence.length <= 2400
    );
    const msaHtml = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, {
        documents: alignDocs,
        activeDoc: alignDocs[0],
        initialSubMode: 'msa',
        initialMsaAlgorithm: 'MAFFT (FFT-NS-i / L-INS-i)',
      })
    );
    expect(msaHtml).toContain('alignment-studio-wrapper');
    expect(msaHtml).toContain('Multiple Sequence Alignment (MSA)');
    // Virtualised AlignmentCanvas: sticky name column + identity metric per row
    expect(msaHtml).toContain('mbc-aln-name-text');
    expect(msaHtml).toContain('mbc-aln-name-metric');
    expect(msaHtml).not.toContain('evo-ribbon-bar');
    expect(msaHtml).not.toContain('evo-circle-medallion');
    expect(msaHtml).not.toContain('Phylogenetic Tree Reconstruction');

    const pairwiseHtml = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, {
        documents: alignDocs,
        activeDoc: alignDocs[0],
        initialSubMode: 'pairwise',
        initialPairwiseAlgorithm: 'sw',
      })
    );
    expect(pairwiseHtml).toContain('value="sw" selected=""');
    expect(pairwiseHtml).toContain('Smith-Waterman (Local Affine Gap)');
    expect(pairwiseHtml).toContain('mbc-pw-name');

    const phyloTreeHtml = renderToStaticMarkup(
      React.createElement(PhylogeneticsStudio, {
        documents: SAMPLE_LIBRARY,
        activeDoc: SAMPLE_LIBRARY[0],
        initialPhyloTab: 'phylogeny',
        initialTreeAlgorithm: 'Maximum Likelihood (ML)',
      })
    );
    expect(phyloTreeHtml).toContain('phylo-studio-topbar');
    expect(phyloTreeHtml).toContain('phylo-module-picker');
    expect(phyloTreeHtml).toContain('Phylogenetic Tree Reconstruction');
    expect(phyloTreeHtml).not.toContain('evo-ribbon-bar');
    expect(phyloTreeHtml).not.toContain('evo-circle-medallion');
    expect(phyloTreeHtml).not.toContain('Edit / Build Multiple Sequence Alignment');

    const phyloModelsHtml = renderToStaticMarkup(
      React.createElement(PhylogeneticsStudio, {
        documents: SAMPLE_LIBRARY,
        activeDoc: SAMPLE_LIBRARY[0],
        initialPhyloTab: 'models',
        initialModelsSubView: 'rscu',
      })
    );
    expect(phyloModelsHtml).toContain(
      'Substitution Models, Rate Matrices &amp; Codon Usage (RSCU)'
    );
  });

  it('condenses top-level Main Menus to <= 9 menus (fitting cleanly left of MacBook notch) while preserving 100% Alignment, Phylogenetics, Cloning, and Sequence action parity across Web, macOS Cocoa, and Tauri v2', () => {
    const appHtml = renderToStaticMarkup(React.createElement(App));
    expect(appHtml).toContain('role="menubar"');
    expect(appHtml).toContain('>File</button>');
    expect(appHtml).toContain('>Edit</button>');
    expect(appHtml).toContain('>View</button>');
    expect(appHtml).toContain('>Sequence</button>');
    expect(appHtml).toContain('>Cloning</button>');
    expect(appHtml).toContain('>Tools</button>');
    expect(appHtml).toContain('>Help</button>');
    expect(appHtml).not.toContain('>Enzymes</button>');
    expect(appHtml).not.toContain('>Features</button>');
    expect(appHtml).not.toContain('>Primers</button>');
    expect(appHtml).not.toContain('>Alignment</button>');
    expect(appHtml).not.toContain('>Phylogenetics</button>');
    expect(appHtml).not.toContain('>Actions</button>');

    const webMenubarTriggers = appHtml.match(/class="menubar-dropdown-anchor"/g) ?? [];
    expect(webMenubarTriggers.length).toBe(8);
    expect(webMenubarTriggers.length).toBeLessThanOrEqual(10);

    const cocoaTopLevelAdds = macMainMm.match(/\[menubar addItem:/g) ?? [];
    expect(cocoaTopLevelAdds.length).toBe(9);
    expect(cocoaTopLevelAdds.length).toBeLessThanOrEqual(10);

    const tauriRootBlock = tauriMainRs.match(/Menu::with_items\(\s*app,\s*&\[([\s\S]*?)\],\s*\)/);
    expect(tauriRootBlock).not.toBeNull();
    const tauriTopLevelMenus = tauriRootBlock![1].match(/&[a-z_]+_menu/g) ?? [];
    expect(tauriTopLevelMenus.length).toBe(9);
    expect(tauriTopLevelMenus.length).toBeLessThanOrEqual(10);

    expect(macMainMm).toContain('initWithTitle:@"Cloning"');
    expect(macMainMm).toContain('initWithTitle:@"Alignment"');
    expect(macMainMm).toContain('initWithTitle:@"Phylogenetics"');
    expect(tauriMainRs).toContain('"Cloning"');
    expect(tauriMainRs).toContain('"Alignment"');
    expect(tauriMainRs).toContain('"Phylogenetics"');
    expect(tauriMainRs).toContain('label.replace(\'&\', "&&")');

    const extractIds = (src: string, pattern: RegExp): string[] => {
      const ids = new Set<string>();
      for (const m of src.matchAll(pattern)) {
        ids.add(m[1]);
      }
      return Array.from(ids).sort();
    };

    const macMenuIds = extractIds(macMainMm, /@"((?:align|phylo):[a-z0-9-]+)"/g);
    const tauriMenuIds = extractIds(tauriMainRs, /"((?:align|phylo):[a-z0-9-]+)"/g);
    const appDispatchedIds = extractIds(appSrc, /case '((?:align|phylo):[a-z0-9-]+)':/g);

    expect(macMenuIds.length).toBe(55);
    expect(tauriMenuIds).toEqual(macMenuIds);
    expect(appDispatchedIds).toEqual(macMenuIds);

    // Verify .mbc round-trip for 'phylogenetics' and legacy migration of 'align-phylo' -> 'sequence-alignment'
    const serialized = serializeMbcWorkbench({
      sessionName: 'Ungrouped_Test',
      documents: SAMPLE_LIBRARY.slice(0, 2),
      workspace: {
        activeDocId: SAMPLE_LIBRARY[0].id,
        selectedFolder: 'All Project Files',
        navHistory: [SAMPLE_LIBRARY[0].id],
        navIndex: 0,
        viewerTab: 'phylogenetics',
        mapLayoutMode: 'split',
        zoomLevel: 100,
        textFormat: 'genbank',
        colorScheme: 'standard',
        darkMode: false,
        sidebarOpen: true,
        docTableCollapsed: false,
        selectedRange: null,
        displaySettings: {
          showOrfs: true,
          minOrfAa: 50,
          allowAltStartCodons: false,
          showPrimers: true,
          showTranslation: true,
          showGcGraph: true,
          showHydropathyGraph: false,
          showUniqueCuttersOnly: true,
        },
      },
    });
    const parsedPhylo = parseMbcWorkbench(serialized, 'Ungrouped_Test');
    expect(parsedPhylo.envelope.workspace.viewerTab).toBe('phylogenetics');

    const legacyPayload = serialized.replace(
      '"viewerTab": "phylogenetics"',
      '"viewerTab": "align-phylo"'
    );
    const parsedLegacy = parseMbcWorkbench(legacyPayload, 'Legacy_Test');
    expect(parsedLegacy.envelope.workspace.viewerTab).toBe('sequence-alignment');
  });

  it('renders custom bioinformatics SVG toolbar icons, adds Import menu across Toolbar and File menu in 100% parity, and places Personal & Research in the bottom status bar', () => {
    const iconComponents = [
      BioAddIcon,
      BioImportIcon,
      BioExportIcon,
      BioSessionIcon,
      BioBlastIcon,
      BioWorkflowsIcon,
      BioAlignAssembleIcon,
      BioTreeIcon,
      BioPrimersIcon,
      BioCloningIcon,
      BioVectorsIcon,
    ];
    for (const IconComp of iconComponents) {
      const svgMarkup = renderToStaticMarkup(React.createElement(IconComp, { size: 21 }));
      expect(svgMarkup).toContain('mbc-bio-icon');
      expect(svgMarkup).toContain('<svg');
    }

    // Verify Top Action Toolbar wires Import ▾ alongside all 11 semantic bioinformatics icons
    expect(appSrc).toContain("toggleToolbarMenu('import'");
    expect(appSrc).toContain('ariaLabel="Import Menu"');
    expect(appSrc).toContain('<BioImportIcon');
    expect(appSrc).toContain('<BioAlignAssembleIcon');
    expect(appSrc).toContain('<BioTreeIcon');
    expect(appSrc).toContain('<BioPrimersIcon');
    expect(appSrc).toContain('<BioCloningIcon');
    expect(appSrc).toContain('<BioVectorsIcon');

    // Verify "Personal & Research" badge is rendered inside the bottom status bar (<footer class="mbc-statusbar">) and nowhere in the top header
    const appHtml = renderToStaticMarkup(React.createElement(App));
    const footerStart = appHtml.indexOf('<footer class="mbc-statusbar">');
    expect(footerStart).toBeGreaterThan(0);
    const beforeFooter = appHtml.slice(0, footerStart);
    const footerHtml = appHtml.slice(footerStart);
    expect(beforeFooter).not.toContain('CC BY-NC 4.0 Non-Commercial');
    expect(footerHtml).toContain('statusbar-license-pill');
    expect(footerHtml).toContain('CC BY-NC 4.0 Non-Commercial');
    expect(footerHtml).not.toContain('Rust WASM + C++17');
    expect(footerHtml).toContain('statusbar-engine-pill');
    expect(footerHtml).toContain('Navigator</button>');

    // Verify File -> Import Data parity across Web/Windows/Linux, macOS Cocoa, and Tauri v2
    expect(appSrc).toContain("label: 'Import Data'");
    expect(macMainMm).toContain('@"Import Data"');
    expect(tauriMainRs).toContain('"Import Data"');

    const expectedFileImportActions = [
      'file:import-files',
      'file:import-clipboard',
      'file:import-sanger',
      'file:import-ngs',
      'file:import-vector-catalog',
      'file:import-twist-vector',
      'file:import-ncbi-db',
    ];
    for (const actionId of expectedFileImportActions) {
      expect(macMainMm).toContain(`@"${actionId}"`);
      expect(tauriMainRs).toContain(`"${actionId}"`);
      expect(appSrc).toContain(`case '${actionId}':`);
    }
  });

  it('prevents fixed submenu clipping on .desktop-menu-popup and renders 16px SVG submenu explore chevrons', async () => {
    // 1. Ensure `.desktop-menu-popup` never creates a fixed-position containing block via `backdrop-filter`
    //    and explicitly sets viewport-relative `position: fixed; inset: auto; margin: 0;`
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCss = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    const popupRuleMatch = appCss.match(/^\.desktop-menu-popup\s*\{([\s\S]*?)^\}/m);
    expect(popupRuleMatch).not.toBeNull();
    const popupRuleBody = popupRuleMatch![1];
    expect(popupRuleBody).toContain('position: fixed;');
    expect(popupRuleBody).toContain('inset: auto;');
    expect(popupRuleBody).toContain('margin: 0;');
    expect(popupRuleBody).not.toMatch(/backdrop-filter/i);

    // 2. Ensure nested `<CascadingMenuLevel depth={depth + 1}>` is rendered as a sibling outside `.desktop-menu-popup`
    //    and portaled via `createPortal`, without `onPointerDown` blocking submenu trigger clicks
    expect(cascadingMenuSrc).toContain('createPortal(');
    expect(cascadingMenuSrc).toContain('depth={depth + 1}');
    expect(cascadingMenuSrc).not.toContain('▸');

    // 3. Render multi-level cascading submenu items matching Project First Page `New` menu
    const sampleItems: MenuNode[] = [
      {
        kind: 'submenu',
        id: 'home-new-session',
        label: 'New Session',
        children: [
          {
            kind: 'command',
            id: 'home-new-blank',
            label: 'Empty Project Workspace',
            onSelect: () => {},
          },
        ],
      },
      { kind: 'separator', id: 'home-new-sep' },
      {
        kind: 'submenu',
        id: 'home-new-vector-presets',
        label: 'New from Cloning Vector Preset (27)',
        children: [
          {
            kind: 'submenu',
            id: 'home-new-gateway-donors',
            label: 'Gateway Donor Vectors (7)',
            children: [
              {
                kind: 'command',
                id: 'home-new-pdonr221',
                label: 'pDONR221 (4762 bp)',
                onSelect: () => {},
              },
            ],
          },
        ],
      },
    ];

    const popupHtml = renderToStaticMarkup(
      React.createElement(CascadingMenuPopup, {
        items: sampleItems,
        position: { left: 48, top: 82, maxHeight: 680 },
        minWidth: 300,
        ariaLabel: 'Project First Page Menu',
        onCloseAll: () => {},
      })
    );

    expect(popupHtml).toContain('submenu-chevron-icon');
    expect(popupHtml).toContain('width="16"');
    expect(popupHtml).toContain('height="16"');
    expect(popupHtml).not.toContain('▸');
    expect(popupHtml).toContain('aria-haspopup="menu"');
    expect(popupHtml).toContain('aria-expanded="false"');

    // 4. Verify Project First Page Quick Action Bar triggers (`New`, `Open`, `Import`) expose `aria-haspopup="menu"`
    //    and `13px` dropdown chevrons
    const homeHtml = renderToStaticMarkup(
      React.createElement(ProjectFirstPageHome, {
        sidebarOpen: true,
        sessionActive: false,
        sessionName: 'Untitled Project',
        documents: [],
        hasLocalAutosave: false,
        openDropdown: 'new',
        onToggleDropdown: () => {},
        onOpenSampleProject: () => {},
        onStartBlankProject: () => {},
        onOpenMbcSession: () => {},
        onRestoreAutosave: () => {},
        onOpenFilePicker: () => {},
        onOpenSampleDocumentById: () => {},
        onResumeActiveSession: () => {},
        onOpenShortcuts: () => {},
      })
    );

    expect(homeHtml).toContain('aria-haspopup="menu"');
    expect(homeHtml).toContain('aria-expanded="true"');
    expect(homeHtml).toContain('width="13"');
    expect(homeHtml).toContain('height="13"');
  });

  it('supports cross-platform window dragging, draggable modal dialogs, and native/Tauri file drag-and-drop', async () => {
    // 1. Verify Tauri v2 capabilities & macOS Cocoa MolBioCraftWebView window drag + file drop registration
    expect(tauriCapDefaultJson).toContain('"core:window:allow-start-dragging"');
    expect(tauriCapDefaultJson).toContain('"core:window:allow-toggle-maximize"');
    expect(tauriMainRs).toContain('cmd_window_start_dragging');
    expect(tauriMainRs).toContain('cmd_window_toggle_maximize');
    expect(tauriMainRs).toContain('cmd_read_dropped_file_bytes');
    expect(macMainMm).toContain('@interface MolBioCraftWebView : WKWebView');
    expect(macMainMm).toContain('lastLeftMouseDownEvent');
    expect(macMainMm).toContain('windowDragArmed');
    expect(macMainMm).toContain('translateArmedWindowToMouseScreenLocation:');
    expect(macMainMm).toContain('constrainFrameRect:proposedFrame toScreen:targetScreen');
    expect(macMainMm).toContain('[self.window setFrameOrigin:proposedFrame.origin]');
    expect(macMainMm).toContain('addLocalMonitorForEventsMatchingMask:');
    expect(macMainMm).toContain('acceptsFirstMouse:');
    expect(macMainMm).not.toContain('performWindowDragWithEvent:');
    expect(macMainMm).toContain('registerForDraggedTypes:@[NSPasteboardTypeFileURL]');
    expect(macMainMm).toContain('mbc:native-file-drag');

    // 2. Verify interactive vs empty window chrome hit-testing
    expect(isInteractiveWindowChromeTarget(null)).toBe(false);
    const mockButtonChild = {
      closest: (selector: string) =>
        selector.includes('button') ? ({ tagName: 'BUTTON' } as unknown as Element) : null,
    } as unknown as EventTarget;
    const mockSearchPillChild = {
      closest: (selector: string) =>
        selector.includes('.toolbar-global-search')
          ? ({ className: 'toolbar-global-search' } as unknown as Element)
          : null,
    } as unknown as EventTarget;
    const mockEmptyToolbarArea = {
      closest: () => null,
    } as unknown as EventTarget;
    expect(isInteractiveWindowChromeTarget(mockButtonChild)).toBe(true);
    expect(isInteractiveWindowChromeTarget(mockSearchPillChild)).toBe(true);
    expect(isInteractiveWindowChromeTarget(mockEmptyToolbarArea)).toBe(false);

    // 3. Verify requestDesktopWindowDrag & requestDesktopWindowToggleMaximize in macOS Cocoa mode
    const g = globalThis as unknown as MockMacosBridgeGlobals & {
      webkit?: {
        messageHandlers?: {
          mbcNative?: { postMessage: (msg: Record<string, unknown>) => void };
        };
      };
      __TAURI_INTERNALS__?: {
        invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        transformCallback?: (cb: (event: unknown) => void) => number;
      };
    };
    const postedCocoaMessages: Record<string, unknown>[] = [];
    g.__MBC_MACOS_APP_BUNDLE__ = true;
    g.webkit = {
      messageHandlers: {
        mbcNative: {
          postMessage: (msg) => postedCocoaMessages.push(msg),
        },
      },
    };
    expect(requestDesktopWindowDrag()).toBe(true);
    expect(requestDesktopWindowToggleMaximize()).toBe(true);
    expect(postedCocoaMessages).toEqual([
      { type: 'windowDrag' },
      { type: 'windowZoom' },
    ]);
    delete g.__MBC_MACOS_APP_BUNDLE__;
    delete g.webkit;

    // 4. Verify requestDesktopWindowDrag, requestDesktopWindowToggleMaximize, and subscribeTauriWindowFileDropEvents in Tauri v2 mode
    const tauriInvoked: string[] = [];
    const tauriEventCallbacks = new Map<string, (evt: unknown) => void>();
    let nextEventId = 100;
    const unlistedIds: number[] = [];

    const pendingCallbacks = new Map<number, (evt: unknown) => void>();
    g.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => {
        const cbId = ++nextEventId;
        pendingCallbacks.set(cbId, cb);
        return cbId;
      },
      invoke: async (cmd, args) => {
        tauriInvoked.push(cmd);
        if (cmd === 'plugin:event|listen') {
          const eventName = String(args?.event ?? '');
          const handlerId = Number(args?.handler ?? 0);
          const cb = pendingCallbacks.get(handlerId);
          if (cb) {
            tauriEventCallbacks.set(eventName, cb);
          }
          return handlerId;
        }
        if (cmd === 'plugin:event|unlisten') {
          unlistedIds.push(Number(args?.eventId ?? 0));
          return null;
        }
        if (cmd === 'cmd_read_dropped_file_bytes') {
          return {
            file_name: 'dropped_construct.ab1',
            base64: btoa('ABIF\x00\x65'),
            byte_len: 6,
          };
        }
        return null;
      },
    };

    expect(requestDesktopWindowDrag()).toBe(true);
    expect(requestDesktopWindowToggleMaximize()).toBe(true);
    expect(tauriInvoked).toContain('cmd_window_start_dragging');
    expect(tauriInvoked).toContain('cmd_window_toggle_maximize');

    const dragStates: boolean[] = [];
    const droppedBatches: File[][] = [];
    const unlistenDrops = subscribeTauriWindowFileDropEvents({
      onDragEnter: () => dragStates.push(true),
      onDragLeave: () => dragStates.push(false),
      onDropFiles: (files) => {
        droppedBatches.push(files);
      },
    });
    // Allow internal listenTauriEvent promises to register
    await new Promise((resolve) => setTimeout(resolve, 10));

    tauriEventCallbacks.get('tauri://drag-enter')?.({
      event: 'tauri://drag-enter',
      id: 1,
      payload: { paths: ['/tmp/dropped_construct.ab1'] },
    });
    expect(dragStates).toEqual([true]);

    tauriEventCallbacks.get('tauri://drag-drop')?.({
      event: 'tauri://drag-drop',
      id: 2,
      payload: { paths: ['/tmp/dropped_construct.ab1'] },
    });
    // Allow async file reconstruction to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dragStates).toEqual([true, false]);
    expect(droppedBatches).toHaveLength(1);
    expect(droppedBatches[0][0].name).toBe('dropped_construct.ab1');
    const droppedBytes = new Uint8Array(await droppedBatches[0][0].arrayBuffer());
    expect(Array.from(droppedBytes)).toEqual([0x41, 0x42, 0x49, 0x46, 0x00, 0x65]);

    unlistenDrops();
    expect(unlistedIds).toHaveLength(3);
    delete g.__TAURI_INTERNALS__;

    // 5. Verify StaticModalDialog renders accessible draggable titlebar without role="application"
    const aboutHtml = renderToStaticMarkup(
      React.createElement(AboutMolBioCraftModal, {
        onClose: () => {},
      })
    );
    expect(aboutHtml).toContain('class="prefs-modal-titlebar');
    expect(aboutHtml).toContain('tabindex="0"');
    expect(aboutHtml).toContain('drag or press arrow keys to reposition dialog');
    expect(aboutHtml).not.toContain('role="application"');

    // 6. Verify ProjectFirstPageHome renders interactive file dropzone card with drag-active feedback
    const homeDragHtml = renderToStaticMarkup(
      React.createElement(ProjectFirstPageHome, {
        sidebarOpen: true,
        sessionActive: false,
        sessionName: 'MolBioCraft_Workbench',
        documents: SAMPLE_LIBRARY,
        hasLocalAutosave: false,
        isFileDragActive: true,
        openDropdown: null,
        onToggleDropdown: () => {},
        onOpenSampleProject: () => {},
        onStartBlankProject: () => {},
        onOpenMbcSession: () => {},
        onRestoreAutosave: () => {},
        onOpenFilePicker: () => {},
        onOpenSampleDocumentById: () => {},
        onResumeActiveSession: () => {},
        onOpenShortcuts: () => {},
      })
    );
    expect(homeDragHtml).toContain('mbc-home-dropzone drag-active');
    expect(homeDragHtml).toContain('Release to Open Files in MolBioCraft');
    expect(homeDragHtml).not.toMatch(EXCLUDED_HOME_TERMS_RE);
  });

  it('enforces the indigo (#3F51B5) background across all square-format app icons and renders the same artwork as the inline UI MolBioCraftLogo', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { existsSync, readFileSync, statSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      existsSync: (path: URL) => boolean;
      readFileSync: (path: URL, encoding: string) => string;
      statSync: (path: URL) => { size: number };
    };

    const packagingSvg = readFileSync(new URL('../../packaging/logo.svg', import.meta.url), 'utf8');
    const publicSvg = readFileSync(new URL('../../public/logo.svg', import.meta.url), 'utf8');
    const generatorPy = readFileSync(new URL('../../scripts/generate_icons.py', import.meta.url), 'utf8');

    for (const svgText of [packagingSvg, publicSvg]) {
      expect(svgText).toContain('viewBox="0 0 512 512"');
      expect(svgText).toMatch(/<rect[^>]*fill="#(3F51B5|ffffff)"/i);
    }
    expect(generatorPy).toMatch(/<rect x="0" y="0" width="512" height="512" fill="#(3F51B5|ffffff)"/i);
    expect(generatorPy).toMatch(/<rect x="16" y="16" width="480" height="480"[^>]*fill="#(3F51B5|ffffff)"/i);

    const requiredSquareIconAssets = [
      '../../packaging/icon_512.png',
      '../../packaging/icon_256.png',
      '../../packaging/molbiocraft.ico',
      '../../packaging/AppIcon.icns',
      '../../src-tauri/icons/32x32.png',
      '../../src-tauri/icons/128x128.png',
      '../../src-tauri/icons/128x128@2x.png',
      '../../src-tauri/icons/icon.png',
      '../../src-tauri/icons/icon.ico',
      '../../src-tauri/icons/icon.icns',
      '../../src-tauri/icons/Square30x30Logo.png',
      '../../src-tauri/icons/Square44x44Logo.png',
      '../../src-tauri/icons/Square71x71Logo.png',
      '../../src-tauri/icons/Square89x89Logo.png',
      '../../src-tauri/icons/Square107x107Logo.png',
      '../../src-tauri/icons/Square142x142Logo.png',
      '../../src-tauri/icons/Square150x150Logo.png',
      '../../src-tauri/icons/Square284x284Logo.png',
      '../../src-tauri/icons/Square310x310Logo.png',
      '../../src-tauri/icons/StoreLogo.png',
    ];

    for (const relPath of requiredSquareIconAssets) {
      const assetUrl = new URL(relPath, import.meta.url);
      expect(existsSync(assetUrl)).toBe(true);
      expect(statSync(assetUrl).size).toBeGreaterThan(256);
    }

    // The inline UI mark and the square application icons are one and the same artwork:
    // the component renders public/logo.svg, which generate_icons.py writes alongside the
    // .icns/.ico/.png set from the same master PNG.
    const inlineLogoHtml = renderToStaticMarkup(
      React.createElement(MolBioCraftLogo, { size: 20 })
    );
    expect(inlineLogoHtml).toContain('src="/logo.svg"');
    expect(inlineLogoHtml).toContain('aria-hidden="true"');
    expect(publicSvg).toEqual(packagingSvg);
  });

  it('wires Import submenu file pickers with bound WebKit IPC, accessible offscreen file inputs, clean session activation, and no status-banner-pill', () => {
    expect(appSrc).not.toContain('status-banner-pill');
    expect(appSrc).toContain('activateImportedDocumentsInWorkspace');
    expect(appSrc).toContain('triggerImportPreferencesPicker');
    expect(appSrc).toContain('mbc-visually-hidden-file-input');
    expect(appSrc).toContain('target instanceof Element');
    expect(cascadingMenuSrc).toContain('onPointerDown');
    expect(macMainMm).toContain('file:import-preferences');
    expect(macMainMm).toContain('dispatch_async(dispatch_get_main_queue()');

    const initialAppHtml = renderToStaticMarkup(React.createElement(App));
    expect(initialAppHtml).not.toContain('status-banner-pill');
    expect(initialAppHtml).toContain('mbc-visually-hidden-file-input');

    // Verify "Search tools or files" (<search class="toolbar-global-search mbc-tabbar-search">)
    // sits inside .mbc-tabbar-right immediately to the left of the 3 vertical dots ("Window & Appearance Options")
    const tabbarRightIdx = initialAppHtml.indexOf('class="mbc-tabbar-right"');
    const searchElemIdx = initialAppHtml.indexOf('<search class="toolbar-global-search mbc-tabbar-search"');
    const searchInputIdx = initialAppHtml.indexOf('id="mbc-toolbar-global-search-input"');
    const threeDotsIdx = initialAppHtml.indexOf('aria-label="Window &amp; Appearance Options"');
    expect(tabbarRightIdx).toBeGreaterThan(0);
    expect(searchElemIdx).toBeGreaterThan(tabbarRightIdx);
    expect(searchInputIdx).toBeGreaterThan(searchElemIdx);
    expect(threeDotsIdx).toBeGreaterThan(searchInputIdx);
    expect(initialAppHtml).toContain('for="mbc-toolbar-global-search-input" class="mbc-sr-only"');
    expect(initialAppHtml).toMatch(/autocorrect="off"/i);
    expect(initialAppHtml).toMatch(/autocapitalize="off"/i);
    expect(initialAppHtml).toContain('spellcheck="false"');
  });

  it('embeds the Google Sans UI face, the Google Sans Code residue face, the Space Grotesk display face, and crisp modern SVG schematics', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { existsSync, readFileSync, statSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      existsSync: (path: URL) => boolean;
      readFileSync: (path: URL, encoding: string) => string;
      statSync: (path: URL) => { size: number };
    };

    const appCssText = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    expect(appCssText).toContain("font-family: 'Google Sans';");
    expect(appCssText).toContain("font-family: 'Google Sans Code';");
    expect(appCssText).toContain("font-family: 'Poppins';");
    expect(appCssText).toContain("font-family: 'Space Grotesk';");
    expect(appCssText).toContain("--font-sans: 'Google Sans', 'Google Sans Fallback'");
    expect(appCssText).toContain("--font-display: 'Space Grotesk'");
    expect(appCssText).toContain("--font-mono: 'Google Sans Code', 'Google Sans Code Fallback'");
    expect(appCssText).toContain("--font-logo: 'Space Grotesk'");
    // The operator chose Google Sans and Google Sans Code (D0077, D0078); the faces they replaced,
    // and Google Sans Flex, which D0078 superseded, are gone.
    for (const retired of ["'Inter'", "'IBM Plex Mono'", "'Google Sans Flex'"]) expect(appCssText).not.toContain(retired);
    expect(appCssText).toMatch(/button,\s*input,\s*select,\s*textarea,\s*optgroup\s*\{\s*font-family:\s*inherit;/);

    const bundledFontFiles = [
      '../assets/fonts/google-sans/GoogleSans-VariableFont.ttf',
      '../assets/fonts/google-sans/GoogleSans-Italic-VariableFont.ttf',
      '../assets/fonts/google-sans/GoogleSans-VariableFont.subset.woff2',
      '../assets/fonts/google-sans/GoogleSans-Italic-VariableFont.subset.woff2',
      '../assets/fonts/google-sans-code/GoogleSansCode-VariableFont_wght.ttf',
      '../assets/fonts/google-sans-code/GoogleSansCode-Italic-VariableFont_wght.ttf',
      '../assets/fonts/google-sans-code/GoogleSansCode-VariableFont_wght.subset.woff2',
      '../assets/fonts/google-sans-code/GoogleSansCode-Italic-VariableFont_wght.subset.woff2',
      '../assets/fonts/poppins/Poppins-Regular.ttf',
      '../assets/fonts/poppins/Poppins-Medium.ttf',
      '../assets/fonts/poppins/Poppins-SemiBold.ttf',
      '../assets/fonts/poppins/Poppins-Bold.ttf',
      '../assets/fonts/poppins/Poppins-ExtraBold.ttf',
      '../assets/fonts/space-grotesk/SpaceGrotesk-VariableFont_wght.ttf',
      '../assets/fonts/space-grotesk/SpaceGrotesk-Bold.ttf',
    ];
    for (const relFont of bundledFontFiles) {
      const fontUrl = new URL(relFont, import.meta.url);
      expect(existsSync(fontUrl)).toBe(true);
      expect(statSync(fontUrl).size).toBeGreaterThan(10_000);
    }

    const noop = () => {};
    const homeHtml = renderToStaticMarkup(
      React.createElement(ProjectFirstPageHome, {
        sidebarOpen: true,
        sessionActive: false,
        sessionName: 'MolBioCraft_Workbench',
        documents: SAMPLE_LIBRARY,
        hasLocalAutosave: false,
        openDropdown: null,
        onToggleDropdown: noop,
        onOpenSampleProject: noop,
        onStartBlankProject: noop,
        onOpenMbcSession: noop,
        onRestoreAutosave: noop,
        onOpenFilePicker: noop,
        onOpenSampleDocumentById: noop,
        onResumeActiveSession: noop,
        onOpenShortcuts: noop,
      })
    );
    expect(homeHtml).toContain('mbc-mini-feature-svg');
    expect(homeHtml).toContain('mbc-mini-primer-svg');
    expect(homeHtml).toContain('mbc-mini-trace-svg');
    expect(homeHtml).toContain('mbc-doc-svg-icon');

    expect(appCssText).toContain('.prefs-modal-titlebar:focus-visible');
    expect(appCssText).not.toMatch(/\.prefs-modal-titlebar:focus-visible\s*\{\s*outline:\s*2px\s+solid/);
    expect(appCssText).toContain('.prefs-category-sidebar');
  });

  it('stacks studio and sequence detail panels top-to-bottom below their side-by-side breakpoints', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCssText = readFileSync(
      new URL('../App.css', import.meta.url),
      'utf8'
    );

    expect(appCssText).toMatch(
      /\.mbc-viewer-canvas\s*\{[^}]*container:\s*viewer-canvas\s*\/\s*inline-size;/
    );
    expect(appCssText).toMatch(
      /\.studio-split-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/
    );
    expect(appCssText).toMatch(
      /\.gel-and-table-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/
    );
    expect(appCssText).toMatch(
      /\.dotplot-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/
    );
    expect(appCssText).toMatch(
      /\.map-seq-grid\.mode-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/
    );
    expect(appCssText).not.toMatch(
      /\.studio-split-grid\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr;/
    );
    expect(appCssText).toContain('.gel-controls-inline');
    expect(appCssText).toContain('.primer-card-top');
    expect(appCssText).toContain('.tm-pill');
  });

  it('shortens long menu and tab labels and separates multi-topic compound submenus across Web, Tauri, and macOS Cocoa', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCssText = readFileSync(
      new URL('../App.css', import.meta.url),
      'utf8'
    );

    const verboseRemovedStrings = [
      'Restriction & PCR Cloning',
      'Restriction and Insertion Cloning...',
      'Overlap Extension PCR (SOE-PCR)...',
      'Sequence & Plasmid Files',
      'Import Sequence Files (.gb / .fasta / .embl / .dna)...',
      'Session & Preferences Archive',
      'Import Preferences (.mbcprefs.json)...',
      'Multiple Sequence Alignment — MAFFT',
      'Selection, Site Rates, Clocks & Variant Impact',
      'Annotate, simulate, or edit data',
    ];
    for (const oldLabel of verboseRemovedStrings) {
      expect(appSrc).not.toContain(oldLabel);
      expect(tauriMainRs).not.toContain(oldLabel);
      expect(macMainMm).not.toContain(oldLabel);
    }

    const separatedSubmenus = [
      'Restriction Cloning',
      'PCR Cloning',
      'Mutagenesis',
      'Sequence Files',
      'Traces & Reads',
      'Vector Catalog',
      'Databases',
      'Import Data',
      'Alignment & Trees',
      'Sequencing & Genomics',
      'Folders',
      'Favorites & Trash',
      'Project Backup',
      'Preferences',
      'Selection & Rates',
      'Clocks & Variants',
    ];
    for (const submenuTitle of separatedSubmenus) {
      expect(appSrc).toContain(`label: '${submenuTitle}'`);
      expect(tauriMainRs).toContain(`"${submenuTitle}"`);
      expect(macMainMm).toContain(`@"${submenuTitle}"`);
    }

    expect(cascadingMenuSrc).toContain('submenu-stacked-below');
    expect(appCssText).toContain('.desktop-submenu-popup.submenu-stacked-below');
  });

  it('adds modern left and right slide arrows, scroll-state affordance fades, and roving tabindex spatial navigation to multi-item horizontal menu strips', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCssText = readFileSync(
      new URL('../App.css', import.meta.url),
      'utf8'
    );

    const stripHtml = renderToStaticMarkup(
      React.createElement(
        ScrollableMenuStrip,
        {
          className: 'mbc-scroll-strip--header-tabs',
          trackClassName: 'mbc-viewer-tabs',
          role: 'tablist',
          ariaLabel: 'Analysis and Visualization Views',
          alwaysShowArrows: true,
          activeKey: 'cloning-gel',
          enableSpatialArrowNav: true,
          activateOnSpatialFocus: true,
          canStepPrev: true,
          canStepNext: true,
          onStepPrev: () => {},
          onStepNext: () => {},
          prevAriaLabel: 'Slide studio menus left',
          nextAriaLabel: 'Slide studio menus right',
        },
        React.createElement(
          'button',
          {
            type: 'button',
            role: 'tab',
            tabIndex: -1,
            'aria-selected': false,
            className: 'mbc-vtab',
          },
          'Sequence'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            role: 'tab',
            tabIndex: 0,
            'aria-selected': true,
            className: 'mbc-vtab active',
          },
          'Cloning'
        )
      )
    );

    expect(stripHtml).toContain('mbc-menu-slide-btn prev');
    expect(stripHtml).toContain('mbc-menu-slide-btn next');
    expect(stripHtml).toContain('aria-label="Slide studio menus left"');
    expect(stripHtml).toContain('aria-label="Slide studio menus right"');
    expect(stripHtml).toContain('data-no-window-drag');
    expect(stripHtml).toContain('mbc-scroll-sentinel-start');
    expect(stripHtml).toContain('mbc-scroll-sentinel-end');
    expect(stripHtml).toContain('mbc-scroll-fade-left');
    expect(stripHtml).toContain('mbc-scroll-fade-right');
    expect(stripHtml).toContain('role="tablist"');
    expect(stripHtml).toContain('tabindex="0"');
    expect(stripHtml).toContain('tabindex="-1"');

    const cloningHtml = renderToStaticMarkup(
      React.createElement(CloningAndGelStudio, {
        documents: SAMPLE_LIBRARY,
        activeDoc: SAMPLE_LIBRARY[0],
        onAddConstruct: () => {},
      })
    );
    expect(cloningHtml).toContain('aria-label="Slide cloning methods left"');
    expect(cloningHtml).toContain('aria-label="Slide cloning methods right"');
    expect(cloningHtml).toContain('aria-label="Slide gel and enzyme tools left"');
    expect(cloningHtml).toContain('aria-label="Slide gel and enzyme tools right"');

    expect(appSrc).toContain('mbc-scroll-strip--header-tabs');
    expect(appSrc).toContain('mbc-scroll-strip--doc-tabs');
    expect(appSrc).toContain('mbc-scroll-strip--toolbar');
    expect(scrollableStripSrc).toContain("CSS.supports('container-type', 'scroll-state')");
    expect(scrollableStripSrc).toContain('IntersectionObserver');
    expect(scrollableStripSrc).toContain("block: 'nearest'");
    expect(scrollableStripSrc).toContain("inline: 'nearest'");

    expect(appCssText).toContain('container-type: scroll-state;');
    expect(appCssText).toContain('@container scroll-state(scrollable: left)');
    expect(appCssText).toContain('@container scroll-state(scrollable: right)');
    expect(appCssText).toContain('.mbc-scroll-strip-scroller.can-scroll-left');
    expect(appCssText).toContain('.mbc-scroll-strip-scroller.can-scroll-right');
    expect(appCssText).toContain('.mbc-menu-slide-btn');
    expect(appCssText).toContain('.mbc-dark-mode .mbc-menu-slide-btn');
  });

  it('renders enlarged 96px circular logo, concise About summary details, and modern light grid background on ProjectFirstPageHome', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCssText = readFileSync(
      new URL('../App.css', import.meta.url),
      'utf8'
    );

    const noop = () => {};
    const homeHtml = renderToStaticMarkup(
      React.createElement(ProjectFirstPageHome, {
        sidebarOpen: true,
        sessionActive: false,
        sessionName: 'MolBioCraft_Workbench',
        documents: SAMPLE_LIBRARY,
        hasLocalAutosave: false,
        openDropdown: null,
        onToggleDropdown: noop,
        onOpenSampleProject: noop,
        onStartBlankProject: noop,
        onOpenMbcSession: noop,
        onRestoreAutosave: noop,
        onOpenFilePicker: noop,
        onOpenSampleDocumentById: noop,
        onResumeActiveSession: noop,
        onOpenShortcuts: noop,
        onOpenAbout: noop,
      })
    );

    expect(homeHtml).toContain('width="96" height="96"');
    expect(homeHtml).toContain('mbc-home-logo-halo');
    expect(homeHtml).toContain('mbc-home-version-pill');
    expect(homeHtml).toContain('Version 1.0.0');
    expect(homeHtml).toContain(
      'Molecular &amp; Evolutionary Biology Workbench'
    );
    expect(homeHtml).toContain(
      'CC BY-NC 4.0 (SPDX: CC-BY-NC-4.0) — Open-Source Research Workbench'
    );
    expect(homeHtml).not.toContain(
      'Cross-Platform Desktop Application (macOS, Windows &amp; Linux)'
    );
    expect(homeHtml).not.toContain('Developed by');
    expect(homeHtml).not.toContain('Bundit Boonyarit');
    expect(homeHtml).not.toContain('About MolBioCraft');
    expect(homeHtml).not.toMatch(EXCLUDED_HOME_TERMS_RE);

    expect(appCssText).toContain('--mbc-grid-cell: 26px;');
    expect(appCssText).toContain('--mbc-grid-major: 130px;');
    expect(appCssText).toContain(
      'linear-gradient(to right, var(--mbc-grid-line) 1px, transparent 0)'
    );
    expect(appCssText).toContain('drop-shadow(');
  });

  it('provides ConfirmQuitModal dialog before exiting the app with Don’t ask again persistence and native Tauri/Cocoa close & quit interception', async () => {
    const noop = () => {};
    const confirmQuitHtml = renderToStaticMarkup(
      React.createElement(ConfirmQuitModal, {
        onCancel: noop,
        onConfirmQuit: noop,
      })
    );

    expect(confirmQuitHtml).toContain('<dialog');
    expect(confirmQuitHtml).toContain('modal-size-confirm-quit');
    expect(confirmQuitHtml).toContain('closedby="closerequest"');
    expect(confirmQuitHtml).toContain('aria-labelledby="mbc-confirm-quit-dialog-title"');
    expect(confirmQuitHtml).not.toContain('role="dialog"');
    expect(confirmQuitHtml).not.toContain('aria-modal');
    expect(confirmQuitHtml).toContain('Confirm Quit');
    expect(confirmQuitHtml).toContain('Are you sure you want to quit MolBioCraft?');
    expect(confirmQuitHtml).toContain('Don&#x27;t ask again');
    expect(confirmQuitHtml).toContain('confirm-quit-icon');
    expect(confirmQuitHtml).toContain('confirm-quit-btn-cancel');
    expect(confirmQuitHtml).toContain('data-autofocus="true"');
    expect(confirmQuitHtml).toContain('confirm-quit-btn-quit');
    expect(confirmQuitHtml).toContain('>Cancel<');
    expect(confirmQuitHtml).toContain('>Quit<');
    expect(confirmQuitHtml).not.toMatch(EXCLUDED_UI_TERMS_RE);

    // Preferences -> General exposes the quit confirmation setting
    const prefsGeneralHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'General',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
        confirmBeforeQuit: true,
        onChangeConfirmBeforeQuit: noop,
      })
    );
    expect(prefsGeneralHtml).toContain(
      'Show confirmation dialog before quitting MolBioCraft'
    );
    expect(prefsGeneralHtml).toContain('Reset all dialog warnings');

    // Persistence helpers for "Don't ask again"
    const storageMap = new Map<string, string>();
    const prevStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    (globalThis as unknown as { localStorage?: Partial<Storage> }).localStorage = {
      getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
      setItem: (k: string, v: string) => {
        storageMap.set(k, v);
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      },
    };
    try {
      expect(readStoredConfirmBeforeQuit()).toBe(true);
      writeStoredConfirmBeforeQuit(false);
      expect(storageMap.get(CONFIRM_BEFORE_QUIT_STORAGE_KEY)).toBe('false');
      expect(readStoredConfirmBeforeQuit()).toBe(false);
      writeStoredConfirmBeforeQuit(true);
      expect(readStoredConfirmBeforeQuit()).toBe(true);
    } finally {
      (globalThis as unknown as { localStorage?: Storage }).localStorage = prevStorage;
    }

    // Native bridge messages: plain web returns false, Cocoa WKScriptMessageHandler & Tauri v2 return true
    expect(syncNativeConfirmBeforeQuit(true)).toBe(false);
    expect(performNativeAppQuit()).toBe(false);

    const cocoaMessages: Record<string, unknown>[] = [];
    const mbcNative = {
      postMessage(this: unknown, payload: Record<string, unknown>) {
        if (this === mbcNative) {
          cocoaMessages.push(payload);
        }
      },
    };
    g.__MBC_MACOS_APP_BUNDLE__ = true;
    g.webkit = { messageHandlers: { mbcNative } };
    expect(syncNativeConfirmBeforeQuit(false)).toBe(true);
    expect(performNativeAppQuit()).toBe(true);
    expect(cocoaMessages).toEqual([
      { type: 'setConfirmBeforeQuit', confirm: false },
      { type: 'confirmQuitNow' },
    ]);

    delete g.__MBC_MACOS_APP_BUNDLE__;
    delete g.webkit;
    const tauriCalls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    g.__TAURI_INTERNALS__ = {
      invoke: async <T>(cmd: string, args?: Record<string, unknown>) => {
        tauriCalls.push({ cmd, args });
        return true as unknown as T;
      },
    };
    expect(syncNativeConfirmBeforeQuit(true)).toBe(true);
    expect(performNativeAppQuit()).toBe(true);
    await Promise.resolve();
    expect(tauriCalls).toEqual([
      { cmd: 'cmd_set_confirm_before_quit', args: { confirm: true } },
      { cmd: 'cmd_app_exit', args: {} },
    ]);

    // Verify native Rust Tauri v2 and macOS Cocoa intercept CloseRequested / ExitRequested / Cmd+Q
    expect(tauriMainRs).toContain('"app:request-quit"');
    expect(tauriMainRs).toContain('WindowEvent::CloseRequested');
    expect(tauriMainRs).toContain('RunEvent::ExitRequested');
    expect(tauriMainRs).toContain('cmd_set_confirm_before_quit');
    expect(tauriMainRs).toContain('cmd_app_exit');
    expect(macMainMm).toContain('@"app:request-quit"');
    expect(macMainMm).toContain('windowShouldClose:');
    expect(macMainMm).toContain('applicationShouldTerminate:');
    expect(macMainMm).toContain('@"setConfirmBeforeQuit"');
    expect(macMainMm).toContain('@"confirmQuitNow"');
    expect(appSrc).toContain("case 'app:request-quit':");
    expect(appSrc).toContain('<ConfirmQuitModal');

    // Verify ConfirmQuitModal centers in the app window without top-anchored 64px specificity collision
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCssText = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    expect(appCssText).toContain(
      ':where(dialog, dialog:modal).prefs-modal-window:not(.modal-size-confirm-quit)'
    );
    expect(appCssText).toContain('dialog[open].prefs-modal-window.modal-size-confirm-quit');
    expect(appCssText).toMatch(
      /\.prefs-modal-window\.modal-size-confirm-quit\s*\{[\s\S]*?inset:\s*0;[\s\S]*?margin:\s*auto;[\s\S]*?height:\s*fit-content;/
    );
  });

  it('displays AppStartupSplash loading screen on startup with About & License details, semantic <progress>, zero Tip text, and zero developer details', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCssText = readFileSync(
      new URL('../App.css', import.meta.url),
      'utf8'
    );
    const indexHtmlText = readFileSync(
      new URL('../../index.html', import.meta.url),
      'utf8'
    );

    const splashHtml = renderToStaticMarkup(
      React.createElement(AppStartupSplash, {
        onComplete: () => {},
      })
    );

    for (const markup of [splashHtml, indexHtmlText]) {
      expect(markup).toContain('MolBioCraft');
      expect(markup).toContain('Workbench');
      expect(markup).toMatch(/Molecular &amp; Evolutionary Biology\s*<br\s*\/?>\s*Workbench/);
      expect(markup).not.toContain(
        'Cross-Platform Desktop Application (macOS, Windows &amp; Linux)'
      );
      expect(markup).toContain('CC BY-NC 4.0 (SPDX: CC-BY-NC-4.0)');
      expect(markup).toContain('Open-Source Research Workbench');
      expect(markup).not.toContain(
        'Open-source software for personal study, classroom teaching, and scientific research.'
      );
      expect(markup).toContain('Version 1.0.0');
      expect(markup).toContain('<progress');
      expect(markup).toContain('role="status"');

      // Strictly no Tip / Next Tip and no developer details on startup loading splash
      expect(markup).not.toMatch(/\b(Tip|Next Tip)\b/i);
      expect(markup).not.toContain('Bundit Boonyarit');
      expect(markup).not.toContain('Developed by');
      expect(markup).not.toContain('github.com');
      expect(markup).not.toContain('Issues &amp; Support');
      expect(markup).not.toMatch(/\bdeveloper\b/i);
      expect(markup).not.toMatch(EXCLUDED_HOME_TERMS_RE);
    }

    expect(splashHtml).toContain('mbc-splash-phoenix');
    expect(splashHtml).toContain('mbc-splash-helix-ribbon');
    expect(splashHtml).toContain('mbc-splash-progress');

    // Both the React splash and the boot splash in index.html draw the shared phoenix and
    // DNA/protein helix artwork from public/splash/, and no longer carry the old inline watermark.
    for (const markup of [splashHtml, indexHtmlText]) {
      expect(markup).toContain('/splash/phoenix-details.webp');
      expect(markup).toContain('/splash/dna-helix-protein-horizontal.svg');
      expect(markup).not.toContain('viewBox="212 100 88 308"');
      expect(markup).not.toContain('M 183.6 80.25 A 75 75 0 1 0 183.6 159.75');
    }

    // Splash palette: blue gradient stops with the gold wordmark
    for (const css of [appCssText, indexHtmlText]) {
      for (const hex of ['#3c82dc', '#3f51b5', '#1e3498', '#5198a1', '#ffd666']) {
        expect(css.toLowerCase()).toContain(hex);
      }
    }
    expect(appCssText).toContain('text-wrap: pretty;');

    // Initial <App /> render includes the startup loading splash overlay on open
    const initialAppHtml = renderToStaticMarkup(React.createElement(App));
    expect(initialAppHtml).toContain('mbc-startup-splash-card');

    // Verify modern-web-guidance `progress` CSS rules
    expect(appCssText).toContain('progress.mbc-splash-progress');
    expect(appCssText).toContain('overflow: clip;');
    expect(appCssText).toContain('container-type: inline-size;');
    expect(appCssText).toContain('progress.mbc-splash-progress::-webkit-progress-value');
    expect(appCssText).toContain('progress.mbc-splash-progress::-moz-progress-bar');
  });

  it('renders stemless sub-menu style ChevronRight icons for menu paths without long horizontal arrow lines', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };

    const appCssText = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    const appTsxText = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const primerStudioText = readFileSync(
      new URL('../components/PrimerAndPCRStudio.tsx', import.meta.url),
      'utf8'
    );
    const hybridStudioText = readFileSync(
      new URL('../components/HybridToolsAndHistoryStudio.tsx', import.meta.url),
      'utf8'
    );
    const pipelineStudioText = readFileSync(
      new URL('../components/WorkflowPipelineStudio.tsx', import.meta.url),
      'utf8'
    );

    const renderedAppHtml = renderToStaticMarkup(React.createElement(App));
    expect(renderedAppHtml).toContain('mbc-inline-chevron');
    expect(renderedAppHtml).not.toContain('File → New Session');
    expect(renderedAppHtml).not.toContain('File &rarr; New Session');
    expect(renderedAppHtml).toMatch(
      /<strong>File\s*<svg(?=[^>]*class="[^"]*mbc-inline-chevron[^"]*")(?=[^>]*stroke-width="2\.4")(?=[^>]*aria-hidden="true")[^>]*>[\s\S]*?<\/svg>\s*New Session<\/strong>/
    );

    // Ensure no long-stem arrows remain in menu breadcrumb paths across App and studios
    for (const srcText of [appTsxText, primerStudioText, hybridStudioText]) {
      expect(srcText).not.toMatch(/\b(File|Add|Primers|Sequence)\s*(?:→|&rarr;)/);
    }
    expect(pipelineStudioText).not.toContain('ArrowRight');
    expect(pipelineStudioText).toContain('ChevronRight');

    // Verify modern-web-guidance `icons` 0.5cap optical alignment & non-shrinking rules
    expect(appCssText).toContain('.mbc-inline-chevron');
    expect(appCssText).toContain('vertical-align: calc(0.5cap - var(--icon-style-size) / 2 - 0.02em);');
    expect(appCssText).toContain('flex: none;');
    expect(appCssText).toContain('pointer-events: none;');
  });

  it('removes trailing ... from all complete main-menu and sub-menu labels and provides toggleable short function description tooltips', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCssText = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    const homeTsxText = readFileSync(
      new URL('../components/ProjectFirstPageHome.tsx', import.meta.url),
      'utf8'
    );
    const menuDescText = readFileSync(
      new URL('../data/menuFunctionDescriptions.ts', import.meta.url),
      'utf8'
    );

    // 1. Zero trailing '...' in any menu label across Web/React, Tauri Rust, and macOS Cocoa
    expect(appSrc).not.toMatch(/label:\s*['"`][^'"`]*\.\.\.['"`]/);
    expect(homeTsxText).not.toMatch(/label:\s*['"`][^'"`]*\.\.\.['"`]/);
    expect(tauriMainRs).not.toMatch(/"[^"\n]*\.\.\."/);
    expect(macMainMm).not.toMatch(/@"[^"\n]*\.\.\."/);

    // Ensure CSS never truncates complete menu labels with ellipsis
    const menuLabelRule = appCssText.match(/\.desktop-menu-label\s*\{([\s\S]*?)\}/);
    expect(menuLabelRule).not.toBeNull();
    expect(menuLabelRule![1]).toContain('white-space: nowrap;');
    expect(menuLabelRule![1]).not.toContain('text-overflow: ellipsis');

    // 2. Every menu label in App.tsx and ProjectFirstPageHome.tsx resolves to a clean, non-empty function description
    const allLabels = new Set<string>();
    for (const src of [appSrc, homeTsxText]) {
      for (const m of src.matchAll(/label:\s*'([^']+)'/g)) {
        allLabels.add(m[1]);
      }
    }
    expect(allLabels.size).toBeGreaterThan(220);
    for (const lbl of allLabels) {
      const desc = resolveMenuNodeFunctionDescription('menu-test-id', lbl, undefined, false);
      expect(desc.length).toBeGreaterThanOrEqual(12);
      expect(desc).not.toMatch(EXCLUDED_HOME_TERMS_RE);
    }
    expect(menuDescText).not.toMatch(EXCLUDED_UI_TERMS_RE);

    // Verify dynamic menu IDs (recent files, vector presets, open tabs, column toggles) also resolve cleanly
    expect(
      resolveMenuNodeFunctionDescription('file-rec-0', 'pET-28a(+)-eGFP', undefined, false)
    ).toContain('Open recent');
    expect(
      resolveMenuNodeFunctionDescription(
        'home-vec-pdonr221',
        'pDONR221 (4,762 bp)',
        undefined,
        false
      )
    ).toContain('cloning vector preset');
    expect(
      resolveMenuNodeFunctionDescription('view-cols-pctGc', '%GC', undefined, false)
    ).toContain('Show or hide the "%GC" column');

    // 3. CascadingMenuPopup renders inline non-closing Function Info menuitemcheckbox toggle row
    const popupItems: MenuNode[] = [
      {
        kind: 'command',
        id: 'tb-aa-msa',
        label: 'Pairwise / Multiple Align',
        onSelect: () => {},
      },
      {
        kind: 'submenu',
        id: 'tb-cl-rest',
        label: 'Restriction Cloning',
        children: [
          {
            kind: 'command',
            id: 'tb-cl-digest',
            label: 'Digest into Fragments',
            onSelect: () => {},
          },
        ],
      },
    ];
    const popupOnHtml = renderToStaticMarkup(
      React.createElement(CascadingMenuPopup, {
        items: popupItems,
        position: { left: 40, top: 64, maxHeight: 520 },
        showFunctionInfo: true,
        onCloseAll: () => {},
      })
    );
    expect(popupOnHtml).toContain('desktop-menu-info-toggle-row');
    expect(popupOnHtml).toContain('Function Info');
    expect(popupOnHtml).toContain('desktop-menu-info-pill is-on');
    expect(popupOnHtml).toContain('role="menuitemcheckbox"');
    expect(popupOnHtml).toContain('aria-checked="true"');

    const popupOffHtml = renderToStaticMarkup(
      React.createElement(CascadingMenuPopup, {
        items: popupItems,
        position: { left: 40, top: 64, maxHeight: 520 },
        showFunctionInfo: false,
        onCloseAll: () => {},
      })
    );
    expect(popupOffHtml).toContain('desktop-menu-info-pill is-off');
    expect(popupOffHtml).toContain('aria-checked="false"');

    // 4. Verify WCAG 1.4.13 tooltip wiring in CascadingMenu.tsx + CSS + View menu + Preferences -> General
    expect(cascadingMenuSrc).toContain('role="tooltip"');
    expect(cascadingMenuSrc).toContain('desktop-menu-func-tooltip');
    expect(cascadingMenuSrc).toContain('aria-describedby={hasActiveTip ? tooltipDomId : undefined}');
    expect(cascadingMenuSrc).toContain("e.key === 'Control' && activeTooltip !== null");
    expect(appCssText).toContain('.desktop-menu-func-tooltip');
    expect(appCssText).toContain('.mbc-dark-mode .desktop-menu-func-tooltip');
    expect(appSrc).toContain("label: 'Show Menu Function Info'");

    const prefsGeneralHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'General',
        onClose: () => {},
        themeMode: 'system',
        onChangeTheme: () => {},
      })
    );
    expect(prefsGeneralHtml).toContain(
      'Show short function descriptions when hovering or focusing menu items'
    );

    // 5. Verify localStorage + CustomEvent synchronization for Function Info toggle
    const store = new Map<string, string>();
    const prevStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    const hadWindow = typeof globalThis.window !== 'undefined';
    if (!hadWindow) {
      g.window = new EventTarget();
    }
    (globalThis as unknown as { localStorage?: Partial<Storage> }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    let eventFiredCount = 0;
    const onSyncEvt = () => {
      eventFiredCount += 1;
    };
    window.addEventListener(MENU_FUNCTION_INFO_EVENT, onSyncEvt);
    try {
      expect(readStoredShowMenuFunctionInfo()).toBe(true);
      writeStoredShowMenuFunctionInfo(false);
      expect(store.get(MENU_FUNCTION_INFO_STORAGE_KEY)).toBe('false');
      expect(readStoredShowMenuFunctionInfo()).toBe(false);
      expect(eventFiredCount).toBe(1);
      writeStoredShowMenuFunctionInfo(true);
      expect(readStoredShowMenuFunctionInfo()).toBe(true);
      expect(eventFiredCount).toBe(2);
    } finally {
      window.removeEventListener(MENU_FUNCTION_INFO_EVENT, onSyncEvt);
      (globalThis as unknown as { localStorage?: Storage }).localStorage = prevStorage;
      if (!hadWindow) {
        delete g.window;
      }
    }
  });

  it('renders distinctive Precision Duotone leading icons across all main menus, sub-menus, studio tabs, and popup levels with zero excluded terms', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appCssText = readFileSync(new URL('../App.css', import.meta.url), 'utf8');

    // 1. Ensure MolBioIcons.tsx contains zero excluded vendor or UI terms
    expect(molBioIconsSrc).not.toMatch(EXCLUDED_UI_TERMS_RE);
    expect(molBioIconsSrc).not.toMatch(EXCLUDED_HOME_TERMS_RE);

    // 2. Verify distinct molecular glyphs across cloning methods (never recycling a single generic arrow)
    const cloningMethodGlyphs = [
      resolveMenuGlyphKind('clone-rest', 'Restriction Cloning'),
      resolveMenuGlyphKind('clone-gg', 'Golden Gate (Type IIS)'),
      resolveMenuGlyphKind('clone-gib', 'Gibson Assembly'),
      resolveMenuGlyphKind('clone-inf', 'In-Fusion Cloning'),
      resolveMenuGlyphKind('clone-gw', 'Gateway BP/LR Recombination'),
      resolveMenuGlyphKind('clone-topo', 'TOPO Cloning'),
      resolveMenuGlyphKind('clone-ta', 'TA / GC Cloning'),
      resolveMenuGlyphKind('clone-parts', 'Parts Cloning'),
      resolveMenuGlyphKind('clone-soe', 'Overlap Extension PCR'),
    ];
    expect(new Set(cloningMethodGlyphs).size).toBe(cloningMethodGlyphs.length);

    for (const g of cloningMethodGlyphs) {
      const svg = renderToStaticMarkup(React.createElement(MolBioMenuGlyph, { glyph: g }));
      expect(svg).toContain(`data-glyph="${g}"`);
      expect(svg).toContain('mbc-duotone-icon');
    }

    // 3. Verify distinct glyphs across alignment, assembly, phylogenetics, primers, and sequence tools
    const analysisGlyphs = [
      resolveMenuGlyphKind('aln-msa', 'Multiple Alignment (MSA)'),
      resolveMenuGlyphKind('aln-pw', 'Pairwise Alignment'),
      resolveMenuGlyphKind('aln-dot', 'Dotplot Analysis'),
      resolveMenuGlyphKind('asm-ref', 'Map to Reference'),
      resolveMenuGlyphKind('asm-denovo', 'De Novo Assemble'),
      resolveMenuGlyphKind('asm-wga', 'Align Whole Genomes'),
      resolveMenuGlyphKind('phy-ml', 'Maximum Likelihood Tree'),
      resolveMenuGlyphKind('phy-bay', 'MrBayes Bayesian Phylogeny'),
      resolveMenuGlyphKind('phy-anc', 'Infer Ancestral Sequences'),
      resolveMenuGlyphKind('phy-clk', 'RelTime Timetree & Molecular Clock'),
      resolveMenuGlyphKind('prm-des', 'Design New Primers'),
      resolveMenuGlyphKind('prm-crisp', 'Find CRISPR Sites'),
      resolveMenuGlyphKind('seq-rc', 'Reverse Complement'),
      resolveMenuGlyphKind('seq-tr', 'Translate to Protein'),
    ];
    expect(new Set(analysisGlyphs).size).toBe(analysisGlyphs.length);

    // 4. Verify CascadingMenuPopup renders .desktop-menu-leading-icon SVG slots on command, checkbox, and submenu rows
    const sampleNodes: MenuNode[] = [
      { kind: 'command', id: 'cmd-gg', label: 'Golden Gate Assembly', onSelect: () => {} },
      { kind: 'checkbox', id: 'chk-circ', label: 'Circular Plasmid Map', checked: true, onToggle: () => {} },
      {
        kind: 'submenu',
        id: 'sub-align',
        label: 'Multiple Alignment',
        children: [
          { kind: 'command', id: 'cmd-mafft', label: 'MAFFT Alignment', onSelect: () => {} },
        ],
      },
    ];

    const popupMarkup = renderToStaticMarkup(
      React.createElement(CascadingMenuPopup, {
        items: sampleNodes,
        position: { left: 24, top: 48, maxHeight: 480 },
        onCloseAll: () => {},
      })
    );
    const leadingIconMatches = popupMarkup.match(/class="desktop-menu-leading-icon"/g) ?? [];
    expect(leadingIconMatches.length).toBe(3);
    expect(popupMarkup).toContain('data-glyph="clone-golden-gate"');

    // 5. Verify CSS custom property duotone palette, Preferences square toggle icon sizing, and hover currentColor inversion hooks exist in App.css
    expect(appCssText).toContain('--mbc-ico-teal');
    expect(appCssText).toContain('.desktop-menu-leading-icon');
    expect(appCssText).toContain('.prefs-square-toggle > .prefs-square-svg');
    expect(appCssText).toContain('.prefs-square-codon');
    expect(appCssText).toContain('text-box: trim-both cap alphabetic;');

    // 6. Verify toolbar-left-nav-cluster aligns with left sidebar width (Back, Forward, Undo, Redo only) and Add menu aligns with the project tab strip
    expect(appCssText).toContain('.toolbar-left-nav-cluster.sidebar-aligned');
    expect(appCssText).toContain('width: var(--mbc-sidebar-width, 245px);');
    expect(appSrc).toContain("toolbar-left-nav-cluster ${\n            sidebarOpen ? 'sidebar-aligned' : 'collapsed'");
    const leftNavMatch = appSrc.match(
      /toolbar-left-nav-cluster[\s\S]*?<ScrollableMenuStrip\s+className="mbc-scroll-strip--toolbar"/
    );
    expect(leftNavMatch).not.toBeNull();
    const leftNavSegment = leftNavMatch?.[0] ?? '';
    expect(leftNavSegment).toContain('aria-label="Navigate Back"');
    expect(leftNavSegment).toContain('aria-label="Navigate Forward"');
    expect(leftNavSegment).toContain('aria-label="Undo Sequence or Annotation Edit"');
    expect(leftNavSegment).toContain('aria-label="Redo Sequence or Annotation Edit"');
    expect(leftNavSegment).not.toContain('BioAddIcon');
    expect(leftNavSegment).not.toContain('mbc-toolbar-divider');

    // 7. Verify all sources (Vector Catalog, Modular Vector Parts, Standard Plasmid Features, NCBI, UniProt, Operations, etc.) display actual counts via .folder-count and never approximate "60+"
    expect(appSrc).not.toContain('60+');
    const vecDesc = resolveMenuNodeFunctionDescription('tb-add-vec-active', 'Vector Catalog');
    expect(vecDesc).toContain('60 curated');
    expect(vecDesc).not.toContain('60+');
    expect(appSrc).toContain('<span className="folder-label">Vector Catalog</span>');
    expect(appSrc).toContain('<span className="folder-count">{VECTOR_CATALOG.length}</span>');
    expect(appSrc).toContain('<span className="folder-label">Modular Vector Parts</span>');
    expect(appSrc).toContain('<span className="folder-count">{MODULAR_VECTOR_PARTS.length}</span>');
    expect(appSrc).toContain('<span className="folder-label">Standard Plasmid Features</span>');
    expect(appSrc).toContain('<span className="folder-count">{COMMON_PLASMID_FEATURES.length}</span>');
  });

  it('renders NewSequenceModal with split coordinate gutter, Type listbox (Nucleotide/Protein/Primer/Probe), Binding Region, and Add/Import menu hierarchy', () => {
    const html = renderToStaticMarkup(
      React.createElement(NewSequenceModal, {
        defaultFolder: 'local',
        onClose: () => {},
        onCreateDoc: () => {},
      })
    );
    expect(html).toContain('New Sequence');
    expect(html).toContain('Type or paste in sequence:');
    expect(html).toContain('newseq-editor-gutter');
    expect(html).toContain('newseq-editor-textarea');
    expect(html).toContain('Name:');
    expect(html).toContain('Description:');
    expect(html).toContain('Organism:');
    expect(html).toContain('Type:');
    expect(html).toContain('Circular');
    expect(html).toContain('Binding Region:');
    expect(html).toContain('Tm Options');
    expect(html).toContain('Cancel');
    expect(html).toContain('OK');

    expect(NEW_SEQUENCE_TYPE_OPTIONS.map((o) => `${o.label}: ${o.description}`)).toEqual([
      'Nucleotide: New nucleotide sequence',
      'Protein: New protein sequence',
      'Primer: A new oligonucleotide entered manually',
      'Probe: A new oligonucleotide entered manually',
    ]);

    const tmStats = computeOligoTmSantaLucia('ATGCGTACGATCGATCGATC', 250, 50, 1.5, 0.2);
    expect(tmStats.length).toBe(20);
    expect(tmStats.gcPct).toBe(50);
    expect(tmStats.tmC).toBeGreaterThan(45);

    // Verify Add and Import menu actions in App.tsx
    expect(appSrc).toContain("label: 'New Sequence'");
    expect(appSrc).toContain("label: 'New Folder'");
    expect(appSrc).toContain("label: 'Text Document'");
    expect(appSrc).toContain("label: 'Enzyme Set'");
    expect(appSrc).toContain("label: 'Import Files'");
    expect(appSrc).toContain("label: 'Import Folder'");
    expect(appSrc).toContain("label: 'Import From Clipboard'");
    expect(appSrc).toContain("label: 'Import Other'");
    expect(appSrc).toContain("label: 'Restore Backup'");
    expect(appSrc).toContain("label: 'Sample Documents'");
    expect(appSrc).toContain("label: 'MolBioCraft Preferences'");
    expect(appSrc).toContain("label: 'New Database Connection'");
  });

  it('exports and imports .mbc files in both JSON format and PKZIP folder archive format', () => {
    const sampleDocs = SAMPLE_LIBRARY.slice(0, 2);
    const snapshot = {
      sessionName: 'Cloning_Folder_Export',
      documents: sampleDocs,
      workspace: {
        activeDocId: sampleDocs[0].id,
        selectedFolder: 'Cloning',
        navHistory: [sampleDocs[0].id],
        navIndex: 0,
        viewerTab: 'sequence-view' as const,
        mapLayoutMode: 'split' as const,
        zoomLevel: 100,
        textFormat: 'genbank' as const,
        colorScheme: 'standard' as const,
        darkMode: false,
        sidebarOpen: true,
        docTableCollapsed: false,
        selectedRange: null,
        displaySettings: {
          showOrfs: true,
          minOrfAa: 50,
          allowAltStartCodons: false,
          showPrimers: true,
          showTranslation: true,
          showGcGraph: false,
          showHydropathyGraph: false,
          showUniqueCuttersOnly: false,
        },
      },
    };

    // 1. JSON format (.mbc)
    const jsonPayload = serializeMbcWorkbench(snapshot);
    expect(() => JSON.parse(jsonPayload)).not.toThrow();
    expect(isMbcFileOrPayload('Cloning_Folder_Export.mbc')).toBe(true);
    const parsedJson = parseMbcWorkbench(jsonPayload, 'Cloning_Folder_Export.mbc');
    expect(parsedJson.envelope.sessionName).toBe('Cloning_Folder_Export');
    expect(parsedJson.envelope.documents).toHaveLength(2);

    // 2. Folder ZIP format saved with .mbc extension
    const zipBytes = serializeMbcFolderZip(snapshot, 'Cloning');
    expect(isMbcZipArchiveBytes(zipBytes)).toBe(true);
    const zipEntries = extractZipArchiveEntries(zipBytes);
    expect(zipEntries.some((e) => e.path === 'Cloning/workbench.mbc.json')).toBe(true);
    expect(zipEntries.some((e) => e.path.endsWith('.mbc.json') && e.path !== 'Cloning/workbench.mbc.json')).toBe(true);
    expect(zipEntries.some((e) => e.path.endsWith('.fasta'))).toBe(true);

    const parsedZip = parseMbcFolderZip(zipBytes, 'Cloning.mbc');
    expect(parsedZip.envelope.sessionName).toBe('Cloning_Folder_Export');
    expect(parsedZip.envelope.documents).toHaveLength(2);
    expect(parsedZip.envelope.documents[0].name).toBe(sampleDocs[0].name);

    expect(appSrc).toContain("label: 'Export MBC JSON'");
    expect(appSrc).toContain("label: 'Export Folder as MBC'");
  });
});
