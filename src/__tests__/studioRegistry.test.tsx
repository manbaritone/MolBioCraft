// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q16Q: every studio has one name, one icon and one shortcut digit, in a studio registry
 * (src/core/studioRegistry.ts) that the tab strip, the inspector titles, ⌘K, the header search, the
 * Help panel's view topics, the redirect message and the studio error boundary all read (D0237).
 * The App is mounted through appHarness.tsx; React DOM's server renderer is loaded only after a
 * mount (or in a test that mounts nothing), so the harness's live-DOM check holds.
 *
 * BG-01M7V0TD: with no session the database explorer is left by ⌘[, View › History › Back (in-window
 * and native) and a new session, which then shows; the rail's data-current-studio names the explorer
 * while it is open; and the studio routing branches Sprint 39 left untested are pinned: the redirect
 * names the studio of the tab asked for, a DNA chain of a structure has the 3D view, the Enzymes view
 * refuses a non-DNA record, the Enzymes view and Folding close, Back-Translate opens its dialog on a
 * protein and Protein Domains opens the Protein studio on one.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import {
  DOCUMENT_PANELS, STUDIOS, STUDIO_ENTRIES, studioAvailability, studioForView, studioForTab, studioIconElement,
  type StudioEntry,
} from '../core/studioRegistry';
import { VIEWER_TAB_ORDER, preferredViewerTab, relevantViewerTabs, supportedViewerTabs, viewerTabLabel, type ViewerTab } from '../core/documentViews';
import { resolveNativeMenuItemEnabled } from '../core/commandAvailability';
import { VIEW_HELP } from '../data/helpTopics';
import { appTsxSource, macHost, mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';
import type { GenomicsSubTabId } from '../core/analysisContext';
import { seededChromatogram } from './traceFixtures';

// A macOS host's mocked Tauri runtime records the native menu states (BG-01M7V0TD); the other mounts are Linux hosts.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

const RAIL = ['Sequence Map', 'Annotations', 'Flatfile', 'Cloning & Gel', 'Vectors & Architect', 'Primers & CRISPR',
  'Alignment', 'Phylogenetics', 'Sanger & Contig', 'Protein & 3D', 'Pipelines & NGS'];
const OLD_TAB_NAMES = ['Chromatogram', '3D Structure', 'Genomics', 'Tree', 'Sequences', 'Contig', 'Text', 'Enzymes'];

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const byName = (name: string): StudioEntry => {
  const hit = STUDIO_ENTRIES.filter((e) => e.name === name);
  if (hit.length !== 1) throw new Error(`the registry has ${hit.length} entries named ${name}`);
  return hit[0];
};

// ─── Records ───

const BASE: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', features: [], primers: [], history: [],
};
const trace = seededChromatogram(16, 60);
const DNA: SequenceDocument = {
  ...BASE, id: 'sr-dna', name: 'SR_Plasmid', accession: 'SR_1', sequence: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGA'.repeat(3),
  features: [0, 1, 2].map((i) => ({ id: `f${i}`, name: `f${i}`, type: 'misc_feature', start: 1 + i, end: 9 + i, strand: 1, color: '#888888' })),
} as SequenceDocument;
const TRACE: SequenceDocument = { ...BASE, id: 'sr-trace', name: 'SR_Read', accession: 'SR_2', sequence: trace.baseCalls, documentKind: 'trace', chromatogram: trace } as SequenceDocument;
const PROTEIN: SequenceDocument = {
  ...BASE, id: 'sr-protein', name: 'SR_Protein', accession: 'SR_3', moleculeType: 'Protein', sequence: 'MKWVTFISLLFLFSSAYSRGVFRR',
  docMetadata: { 'PDB name': 'SR1A', Chain: 'A' },
} as SequenceDocument;
const TREE: SequenceDocument = {
  ...BASE, id: 'sr-tree', name: 'SR_Tree', accession: 'SR_4', documentKind: 'tree', docMetadata: { Newick: '((a:1,b:1):1,c:2);', 'Source Format': 'Newick' },
} as SequenceDocument;
const reads = ['ATGGCCATTGTAATGGGCCGC', 'ATGGCCATTGTTATGGGCCGC', 'ATGGCGATTGTAATGGGCCGC'];
const ALIGNMENT: SequenceDocument = {
  ...BASE, id: 'sr-aln', name: 'SR_Alignment', accession: 'SR_5', sequence: reads[0], folder: 'Alignments', documentKind: 'alignment',
  alignmentMeta: { isAligned: true, sequences: reads.map((sequence, i) => ({ id: `sr-r${i}`, name: `read ${i + 1}`, sequence })) },
} as unknown as SequenceDocument;
const UNALIGNED: SequenceDocument = {
  ...ALIGNMENT, id: 'sr-list', name: 'SR_List', accession: 'SR_6', alignmentMeta: { ...ALIGNMENT.alignmentMeta!, isAligned: false },
} as unknown as SequenceDocument;
const NOTE: SequenceDocument = {
  ...BASE, id: 'sr-note', name: 'SR_Notes', accession: 'SR_7', docMetadata: { 'Document Type': 'Text Document', Notes: '# Bench notes\n\nDigest at 37 C.\n' },
} as SequenceDocument;
const ENZYMES: SequenceDocument = {
  ...BASE, id: 'sr-enz', name: 'SR_Enzymes', accession: 'SR_8', sequence: '', topology: 'circular',
  docMetadata: { 'Document Type': 'Enzyme Set', 'Enzyme Names': 'EcoRI, BamHI', '# Enzymes': 2 },
} as SequenceDocument;
const LIBRARY = [DNA, TRACE, PROTEIN, TREE, ALIGNMENT, UNALIGNED, NOTE, ENZYMES];
/** Cα records in fixed-column PDB (as caAtomsToPdb writes them), one helix per chain - a generated fixture. */
function caPdb(chains: { id: string; seq: string; dx: number }[]): string {
  const three: Record<string, string> = { A: 'ALA', G: 'GLY', K: 'LYS', L: 'LEU', M: 'MET', S: 'SER', V: 'VAL' };
  const col = (s: string | number, w: number) => String(s).padStart(w).slice(0, w);
  let serial = 0;
  const lines: string[] = [];
  for (const { id, seq, dx } of chains) {
    [...seq].forEach((aa, i) => {
      const t = (i * 100 * Math.PI) / 180;
      const [x, y, z] = [dx + 2.3 * Math.cos(t), 2.3 * Math.sin(t), 1.5 * i];
      lines.push(`ATOM  ${col(++serial, 5)}  CA  ${three[aa]} ${id}${col(i + 1, 4)}    ${col(x.toFixed(3), 8)}${col(y.toFixed(3), 8)}${col(z.toFixed(3), 8)}  1.00 20.00           C`);
    });
    lines.push('TER');
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}
/** A DNA record carrying a two-chain structure (as a chain of a protein-DNA complex is imported). */
const DNA_COMPLEX: SequenceDocument = {
  ...BASE, id: 'sr-dna-complex', name: 'SR_Complex_D', accession: 'SR_9', sequence: 'ATGGCCATTGTAATGGGCCGCTGA',
  docMetadata: { PDBText: caPdb([{ id: 'A', seq: 'MKVLSAGLKVAMLS', dx: 0 }, { id: 'B', seq: 'GSLLKAVMGASLKV', dx: 15 }]), Chain: 'D' },
} as SequenceDocument;

/**
 * Each studio entry of the studio rail (US-01M6Q1BD, D0242): the tab and genomics view it opens, its
 * studio id, its name element's text, its count element's text, whether it is the current one.
 */
function studioTabs(app: AppHarness): { view: string; genomicsView?: string; studio: string; name: string; count: string | null; current: boolean; disabled: boolean; el: LiveElement }[] {
  return app.railTabs().map((el) => ({
    view: el.getAttribute('data-view') ?? '',
    genomicsView: el.getAttribute('data-genomics-view') ?? undefined,
    studio: el.getAttribute('data-studio') ?? '',
    name: words(el.querySelectorAll('.mbc-studio-rail-name')[0]?.textContent ?? el.textContent),
    count: el.querySelectorAll('.mbc-studio-rail-count')[0]?.textContent ?? null,
    current: el.getAttribute('aria-selected') === 'true',
    disabled: el.getAttribute('aria-disabled') === 'true',
    el,
  }));
}

async function openOn(app: AppHarness, doc: SequenceDocument, viewerTab: ViewerTab) {
  await app.restoreSession({ documents: LIBRARY, activeDocId: doc.id, viewerTab });
}

/** Opens ⌘K (Ctrl+K here) with an empty query and gives its items. */
async function palette(app: AppHarness): Promise<{ label: string; category: string; studio: string | null; el: LiveElement }[]> {
  if (!app.all('.mbc-cmd-palette-list').length) await app.press('k', { mod: true });
  return app.all('.mbc-cmd-palette-item').map((el) => ({
    label: words(el.querySelectorAll('strong')[0]?.textContent ?? ''),
    category: words(el.querySelectorAll('.mbc-cmd-cat-pill')[0]?.textContent ?? ''),
    studio: el.getAttribute('data-studio'),
    el,
  }));
}

const statusText = (app: AppHarness) => app.all('.statusbar-toast-text').map((s) => words(s.textContent)).join(' | ');

/** An SVG's shape: its element names and their geometry attributes, in document order. */
const GEOMETRY = ['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry'];
function liveShape(svg: LiveElement): string {
  return [svg, ...svg.querySelectorAll('*')].map((el) => `${el.localName}[${GEOMETRY.map((a) => el.getAttribute(a) ?? '').join(',')}]`).join(' ');
}
function markupShape(html: string): string {
  return [...html.matchAll(/<([a-zA-Z]+)((?:\s+[^\s=>]+="[^"]*")*)\s*\/?>/g)].map(([, tag, attrs]) => {
    const value = (a: string) => new RegExp(`\\s${a}="([^"]*)"`).exec(attrs)?.[1] ?? '';
    return `${tag}[${GEOMETRY.map(value).join(',')}]`;
  }).join(' ');
}

// ─── AC1 ───

describe('US-01M6Q16Q AC1: the registry lists the eleven studios and two document panels once, in rail order', () => {
  it('US-01M6Q16Q AC1 lists the eleven studios and two document panels in rail order', () => {
    expect(STUDIOS.map((s) => s.name)).toEqual(RAIL);
    expect(STUDIOS.every((s) => s.kind === 'studio')).toBe(true);
    expect(DOCUMENT_PANELS.map((p) => p.name)).toEqual(['History', 'Info']);
    expect(DOCUMENT_PANELS.every((p) => p.kind === 'panel')).toBe(true);
    const ids = STUDIO_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size, 'each id is unique').toBe(13);
    expect(new Set(STUDIO_ENTRIES.map((e) => e.name)).size, 'each name is unique').toBe(13);
  });

  it('US-01M6Q16Q AC1 VIEWER_TAB_ORDER lists the studios\' tabs in rail order, then History, then Info', () => {
    expect(VIEWER_TAB_ORDER).toEqual(['sequence-view', 'annotations-table', 'text-view', 'cloning-gel', 'vector-library', 'primers-pcr',
      'sequence-alignment', 'phylogenetics', 'sanger-contig', 'protein-3d', 'guided-pipelines', 'genomics-ngs', 'history-hybrid', 'document-info']);
    // Each tab sits where its owner sits on the rail.
    const rank = (tab: ViewerTab) => STUDIO_ENTRIES.findIndex((e) => e.views.some((v) => v.tab === tab));
    const ranks = VIEWER_TAB_ORDER.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

// ─── AC2 ───

describe('US-01M6Q16Q AC2: every viewer tab and sub-view belongs to exactly one studio or panel', () => {
  it('US-01M6Q16Q AC2 resolves each of the 13 tabs and the five genomics sub-views to one owner', () => {
    const owners = (tab: ViewerTab, view?: string) => STUDIO_ENTRIES.filter((e) => e.views.some((v) => v.tab === tab && v.view === view)).map((e) => e.name);
    const expected: [ViewerTab, string | undefined, string][] = [
      ['sequence-view', undefined, 'Sequence Map'], ['annotations-table', undefined, 'Annotations'], ['text-view', undefined, 'Flatfile'],
      ['cloning-gel', undefined, 'Cloning & Gel'], ['vector-library', undefined, 'Vectors & Architect'], ['primers-pcr', undefined, 'Primers & CRISPR'],
      ['sequence-alignment', undefined, 'Alignment'], ['phylogenetics', undefined, 'Phylogenetics'], ['sanger-contig', undefined, 'Sanger & Contig'],
      ['protein-3d', undefined, 'Protein & 3D'], ['genomics-ngs', 'ngs-assembly', 'Pipelines & NGS'], ['genomics-ngs', 'genome-variants', 'Pipelines & NGS'],
      ['genomics-ngs', 'genes-cpg-repeats', 'Pipelines & NGS'], ['genomics-ngs', 'transform-submit', 'Pipelines & NGS'],
      ['guided-pipelines', undefined, 'Pipelines & NGS'], ['history-hybrid', undefined, 'History'], ['document-info', undefined, 'Info'],
    ];
    for (const [tab, view, name] of expected) {
      expect(owners(tab, view), `${tab}${view ? ` › ${view}` : ''}`).toEqual([name]);
      expect(studioForView(tab, view as never)?.name, `${tab}${view ? ` › ${view}` : ''}`).toBe(name);
    }
    // 14 tabs since US-01M6Q164 gave Protein & 3D its own (F01's 14 names); genomics-ngs has four views.
    expect(new Set(expected.map(([t]) => t)).size, 'every one of the 14 tabs is covered').toBe(14);
    expect(new Set(expected.map(([t]) => t)), 'and they are the registry\'s tabs').toEqual(new Set(VIEWER_TAB_ORDER));
    // Protein & 3D is its own tab; genomics-ngs is Pipelines & NGS whatever the record.
    expect(studioForTab('protein-3d', PROTEIN).name).toBe('Protein & 3D');
    expect(studioForTab('protein-3d', DNA).name).toBe('Protein & 3D');
    expect(studioForTab('genomics-ngs', PROTEIN).name).toBe('Pipelines & NGS');
    expect(studioForTab('genomics-ngs', DNA).name).toBe('Pipelines & NGS');
  });

  it('US-01M6Q16Q AC2 a studio applies to a DNA, a protein, a tree, a text note and a blank session as supportedViewerTabs says', () => {
    const available = (doc: SequenceDocument) => STUDIO_ENTRIES.filter((e) => studioAvailability(e, doc).ok).map((e) => e.name);
    const all = STUDIO_ENTRIES.map((e) => e.name);
    expect(available(DNA)).toEqual(all.filter((n) => n !== 'Sanger & Contig'));
    expect(available(PROTEIN)).toEqual(all.filter((n) => !['Cloning & Gel', 'Vectors & Architect', 'Primers & CRISPR', 'Sanger & Contig'].includes(n)));
    expect(available(TREE)).toEqual(['Flatfile', 'Phylogenetics', 'History', 'Info']);
    expect(available(NOTE)).toEqual(['Flatfile', 'Info']);
    expect(available(BASE)).toEqual([]);
    for (const doc of [DNA, TRACE, PROTEIN, TREE, NOTE, BASE]) {
      for (const e of STUDIO_ENTRIES) expect(studioAvailability(e, doc).ok, `${e.name} on ${doc.name || 'a blank session'}`).toBe(supportedViewerTabs(doc).includes(e.opens.tab));
    }
  });

  it('US-01M6Q16Q AC2 the label takes the view: genomics-ngs reads Protein & 3D in its protein-3d view and Pipelines & NGS in every other (D0239)', () => {
    for (const doc of [DNA, PROTEIN, undefined]) {
      expect(viewerTabLabel('protein-3d', doc), `${doc?.name ?? 'no record'} on the protein-3d tab`).toBe('Protein & 3D');
      for (const view of ['ngs-assembly', 'genome-variants', 'genes-cpg-repeats', 'transform-submit'] as const) {
        expect(viewerTabLabel('genomics-ngs', doc, view), `${doc?.name ?? 'no record'} in ${view}`).toBe('Pipelines & NGS');
      }
    }
  });

  it('US-01M6Q16Q AC2 on a DNA record the tab, the inspector title and the Help topic name the studio the genomics view shows (D0239)', async () => {
    const app = await mountApp();
    try {
      // The name the tab, the inspector and Help give the open view: one studio, three places.
      const shown = () => ({
        tab: studioTabs(app).filter((t) => t.current).map((t) => [t.name, t.studio]),
        inspector: app.inspectorButton()?.getAttribute('aria-label')?.replace(/^(Show|Hide) /, '').replace(/ Inspector$/, '') ?? null,
        help: app.all('.mbc-help-panel h4').map((h) => words(h.textContent)),
      });
      const helpOpen = async () => { if (!app.all('.mbc-help-panel').length) await app.press('F1'); };
      const choose = async (name: string) => app.click((await palette(app)).find((i) => i.label === name)!.el);
      const studio = (name: string) => byName(name).id;

      // A plain DNA record: ⌘K's Protein & 3D opens the Protein studio's tab (US-01M6Q164), whose
      // protein analysis of the CDS has its settings.
      await openOn(app, DNA, 'sequence-view');
      await helpOpen();
      expect(app.all('.mbc-help-panel'), 'F1 opens the Help panel').toHaveLength(1);
      await choose('Protein & 3D');
      expect(app.activeTab(), '⌘K Protein & 3D opens its own tab').toBe('protein-3d');
      expect(shown(), 'Protein & 3D on a DNA record').toEqual({ tab: [['Protein & 3D', studio('Protein & 3D')]], inspector: 'Protein & 3D Controls', help: ['Protein & 3D'] });
      await choose('Pipelines & NGS');
      // It opens on the guided pipelines, which have no settings either.
      expect(shown(), 'Pipelines & NGS on a DNA record')
        .toEqual({ tab: [['Pipelines & NGS', studio('Pipelines & NGS')]], inspector: null, help: ['Pipelines & NGS'] });

      // A DNA chain of a two-chain structure: the 3D view has its Structure section, so an inspector.
      await app.restoreSession({ documents: [...LIBRARY, DNA_COMPLEX], activeDocId: DNA_COMPLEX.id, viewerTab: 'sequence-view' });
      await helpOpen();
      await choose('Protein & 3D');
      expect(app.activeTab()).toBe('protein-3d');
      expect(shown(), 'Protein & 3D on a DNA chain of a structure')
        .toEqual({ tab: [['Protein & 3D', studio('Protein & 3D')]], inspector: 'Protein & 3D Controls', help: ['Protein & 3D'] });
      // The same record's genomics tab in an NGS view (Tools > NGS suite) is Pipelines & NGS on all three.
      await app.menu('tools:ngs-suite');
      expect(app.activeTab()).toBe('genomics-ngs');
      expect(shown(), 'the genomics tab of a DNA chain of a structure in its NGS view')
        .toEqual({ tab: [['Pipelines & NGS', studio('Pipelines & NGS')]], inspector: 'Pipelines & NGS Controls', help: ['Pipelines & NGS'] });

      // A click on the studio's own sub-tab bar renames all three by the same rule (D0241).
      const subTab = async (label: string) => {
        const hit = app.canvas().querySelectorAll('button[role="tab"]').filter((b) => words(b.textContent) === label);
        expect(hit, `the studio's ${label} sub-tab`).toHaveLength(1);
        await app.click(hit[0]);
        expect(app.canvas().querySelectorAll('button[role="tab"][aria-selected="true"]').map((b) => words(b.textContent)), `${label} is selected`).toContain(label);
      };
      // The genomics studio has no 3D sub-tab since US-01M6Q164: every sub-tab is Pipelines & NGS.
      expect(app.canvas().querySelectorAll('button[role="tab"]').filter((b) => words(b.textContent) === 'Coiled-Coils, Transmembrane & 3D PDB'), 'no 3D sub-tab').toHaveLength(0);
      await subTab('Glimmer Genes, CpG & Repeats');
      expect(shown(), 'back to an NGS sub-tab')
        .toEqual({ tab: [['Pipelines & NGS', studio('Pipelines & NGS')]], inspector: 'Pipelines & NGS Controls', help: ['Pipelines & NGS'] });
    } finally {
      app.unmount();
    }
  });
});

// ─── AC3 ───

describe('US-01M6Q16Q AC3: each studio tab shows its registry name', () => {
  it('US-01M6Q16Q AC3 a trace, a structure, a tree, an alignment and a text note show their tabs by registry name', async () => {
    const app = await mountApp();
    try {
      const cases: [SequenceDocument, ViewerTab, string][] = [
        [TRACE, 'sanger-contig', 'Sanger & Contig'], [PROTEIN, 'protein-3d', 'Protein & 3D'], [TREE, 'phylogenetics', 'Phylogenetics'],
        [ALIGNMENT, 'sequence-alignment', 'Alignment'], [NOTE, 'text-view', 'Flatfile'],
        // The per-record names are gone: an unaligned list and an enzyme set read Alignment and History.
        [UNALIGNED, 'sequence-alignment', 'Alignment'], [ENZYMES, 'history-hybrid', 'History'],
      ];
      for (const [doc, tab, name] of cases) {
        if (doc === ENZYMES && tab === 'history-hybrid') {
          // A set restored on History reopens in Cloning & Gel (D0220, D0253); the user's click opens History.
          await openOn(app, doc, 'cloning-gel');
          await app.clickTab('history-hybrid');
        } else {
          await openOn(app, doc, tab);
        }
        const tabs = studioTabs(app);
        expect(tabs.length, `${doc.name}: the header shows studio tabs`).toBeGreaterThanOrEqual(2);
        expect(tabs.filter((t) => t.current).map((t) => t.name), `${doc.name}'s ${tab} tab`).toEqual([name]);
        for (const t of tabs) {
          expect(t.studio, `${doc.name}'s ${t.view} tab names its studio`).toBe(studioForTab(t.view as ViewerTab, doc, t.genomicsView as GenomicsSubTabId | undefined).id);
          expect(t.name, `${doc.name}'s ${t.view} tab`).toBe(byName(t.name).name);
          expect(STUDIO_ENTRIES.find((e) => e.id === t.studio)?.name, `${doc.name}'s ${t.view} tab reads its studio's name`).toBe(t.name);
          expect(OLD_TAB_NAMES, `${doc.name}'s ${t.view} tab`).not.toContain(words(t.el.textContent));
        }
      }
      // The Annotations count is its own element, not part of the name.
      await openOn(app, DNA, 'annotations-table');
      const annotations = studioTabs(app).filter((t) => t.view === 'annotations-table');
      expect(annotations.map((t) => [t.name, t.count])).toEqual([['Annotations', '3']]);
    } finally {
      app.unmount();
    }
  });

  it('US-01M6Q16Q AC3 every inspector title is the registry name and Controls: a DNA record reads Sequence Map Controls, a trace Sanger & Contig Controls (D0237, D0239)', async () => {
    const app = await mountApp();
    try {
      const title = () => ({
        button: (app.inspectorButton()?.getAttribute('aria-label') ?? '').replace(/^(Show|Hide) /, ''),
        pane: app.inspectorAside()?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null,
      });
      for (const [doc, tab] of [[DNA, 'sequence-view'], [TRACE, 'sanger-contig'], [TRACE, 'sequence-view']] as const) {
        await openOn(app, doc, tab);
        const name = studioForTab(tab, doc).name;
        expect(title(), `${doc.name}'s ${tab} inspector`).toEqual({ button: `${name} Controls Inspector`, pane: `${name} Controls` });
      }
      expect(studioForTab('sequence-view', DNA).name).toBe('Sequence Map');
      expect(studioForTab('sanger-contig', TRACE).name).toBe('Sanger & Contig');
    } finally {
      app.unmount();
    }
  });
});

// ─── AC4 ───

describe('US-01M6Q16Q AC4: ⌘K and the header search list each studio once under its registry name', () => {
  it('US-01M6Q16Q AC4 lists the 11 studios once each in ⌘K and in the header search, and ⌘K opens Cloning & Gel', async () => {
    const app = await mountApp();
    try {
      await openOn(app, DNA, 'sequence-view');
      const items = await palette(app);
      const studios = items.filter((i) => i.studio);
      expect(studios.map((i) => i.label), '⌘K\'s studio items, in rail order').toEqual(RAIL);
      expect(studios.map((i) => i.studio)).toEqual(STUDIOS.map((s) => s.id));
      expect(items.filter((i) => i.category === 'Studio' || i.category === '3D Structure').map((i) => i.label), 'no other studio item').toEqual(RAIL);
      for (const name of RAIL) expect(items.filter((i) => i.label === name), `⌘K lists ${name} once`).toHaveLength(1);
      // Choosing Cloning & Gel on a DNA document opens Cloning & Gel.
      await app.click(studios.find((i) => i.label === 'Cloning & Gel')!.el);
      expect(app.activeTab()).toBe('cloning-gel');
      expect(studioTabs(app).filter((t) => t.view === 'cloning-gel').map((t) => t.name)).toEqual(['Cloning & Gel']);

      // The header search opens ⌘K with what is typed (US-01M7QCN2, D0255): each studio is found there once.
      for (const entry of STUDIOS) {
        if (app.all('.mbc-cmd-palette-input').length) await app.press('k', { mod: true });
        await app.input(app.one('#mbc-toolbar-global-search-input', 'the header search'), entry.name);
        expect(app.one('.mbc-cmd-palette-input', '⌘K, opened by the header search').value).toBe(entry.name);
        const hits = app.all('.mbc-cmd-palette-item');
        // The studio's own item (a menu command may share its name, as Primers & CRISPR's submenu does).
        const named = hits.filter((h) => h.getAttribute('data-studio') && words(h.querySelector('strong')?.textContent ?? '') === entry.name);
        expect(named.map((h) => h.getAttribute('data-studio')), `the header search for "${entry.name}" lists it once`).toEqual([entry.id]);
        expect(hits.filter((h) => h.getAttribute('data-studio')).map((h) => h.getAttribute('data-studio')), `"${entry.name}" lists no other studio item twice`)
          .toEqual([...new Set(hits.filter((h) => h.getAttribute('data-studio')).map((h) => h.getAttribute('data-studio')))]);
      }
    } finally {
      app.unmount();
    }
  });
});

// ─── AC5 ───

describe('US-01M6Q16Q AC5: an unavailable studio explains itself with the registry\'s reason', () => {
  it('US-01M6Q16Q AC5 Cloning & Gel on a protein and Sanger & Contig on a non-trace DNA say what they need and what the record is', async () => {
    const app = await mountApp();
    try {
      await openOn(app, PROTEIN, 'sequence-view');
      await app.click((await palette(app)).find((i) => i.label === 'Cloning & Gel')!.el);
      expect(app.activeTab(), 'the view does not change').toBe('sequence-view');
      const protein = statusText(app);
      expect(protein).toContain('Cloning & Gel needs a DNA sequence');
      expect(protein).toContain('"SR_Protein" is a Protein sequence');
      expect(protein).toContain((studioAvailability(byName('Cloning & Gel'), PROTEIN) as { reason: string }).reason);

      await openOn(app, DNA, 'sequence-view');
      await app.click((await palette(app)).find((i) => i.label === 'Sanger & Contig')!.el);
      expect(app.activeTab(), 'the view does not change').toBe('sequence-view');
      const dna = statusText(app);
      expect(dna).toContain('Sanger & Contig needs a Sanger trace');
      expect(dna).toContain('"SR_Plasmid" is DNA with no trace');
    } finally {
      app.unmount();
    }
  });

  it('US-01M6Q16Q AC5 the studio error boundary is labelled by the registry name', () => {
    const src = appTsxSource();
    const boundaries = [...src.matchAll(/<ErrorBoundary label=\{([^}]+)\} resetKey=\{`\$\{activeDoc\.id\}:\$\{viewerTab\}`\}>/g)].map((m) => m[1]);
    // It names the view as the tab does: by the genomics sub-view shown (D0239).
    expect(boundaries).toEqual(['viewerTabLabel(viewerTab, activeDoc, genomicsShownView)']);
    expect(viewerTabLabel('sanger-contig', TRACE)).toBe('Sanger & Contig');
    expect(viewerTabLabel('protein-3d', PROTEIN)).toBe('Protein & 3D');
  });
});

// ─── AC7 ───

describe('US-01M6Q16Q AC7: each studio is drawn with its registry icon from the existing multi-tone set', () => {
  it('US-01M6Q16Q AC7 each icon is an existing multi-tone glyph, no two studios share one, and each tab draws its studio\'s icon', async () => {
    // Mount first, so React DOM's server renderer loads after the live DOM exists.
    const app = await mountApp();
    const drawn: [string, string][] = [];
    try {
      for (const [doc, tab] of [[DNA, 'sequence-view'], [TRACE, 'sanger-contig'], [PROTEIN, 'protein-3d'], [TREE, 'phylogenetics'], [ALIGNMENT, 'sequence-alignment']] as const) {
        await openOn(app, doc, tab);
        for (const t of studioTabs(app)) {
          const svg = t.el.querySelectorAll('svg')[0];
          expect(svg, `${doc.name}'s ${t.view} tab draws an icon`).toBeTruthy();
          drawn.push([t.studio, liveShape(svg)]);
        }
      }
    } finally {
      app.unmount();
    }
    const { renderToStaticMarkup } = await import('react-dom/server');
    const shapes = new Map<string, string>();
    for (const e of STUDIO_ENTRIES) {
      const html = renderToStaticMarkup(studioIconElement(e.icon));
      expect(html, `${e.name}'s icon is a Precision Duotone glyph`).toMatch(/^<svg[^>]*class="[^"]*mbc-duotone-icon/);
      shapes.set(e.id, markupShape(html));
    }
    expect(new Set(STUDIOS.map((s) => shapes.get(s.id))).size, 'no two studios share a glyph').toBe(11);
    expect(new Set([...shapes.values()]).size, 'nor a panel and a studio').toBe(13);
    expect(new Set(drawn.map(([s]) => s)).size, 'several studios were drawn').toBeGreaterThanOrEqual(8);
    for (const [studio, shape] of drawn) expect(shape, `the ${studio} tab draws its registry icon`).toBe(shapes.get(studio));
  });
});

// ─── AC6 ───

describe('US-01M6Q16Q AC6: every studio and panel has a help topic under its registry name', () => {
  it('US-01M6Q16Q AC6 VIEW_HELP titles each studio\'s and panel\'s tab by its name, and the Help panel shows them', async () => {
    for (const e of STUDIO_ENTRIES) {
      expect(VIEW_HELP[e.opens.tab]?.title, `${e.name}'s topic`).toBe(e.name);
      expect(VIEW_HELP[e.opens.tab]?.summary.length, `${e.name}'s topic says what it is for`).toBeGreaterThan(20);
    }
    const { renderToStaticMarkup } = await import('react-dom/server');
    const React = await import('react');
    const { HelpPanel } = await import('../components/HelpPanel');
    for (const [tab, name] of [['vector-library', 'Vectors & Architect'], ['guided-pipelines', 'Pipelines & NGS']] as const) {
      const html = renderToStaticMarkup(React.createElement(HelpPanel, { viewerTab: tab, onClose: () => undefined }));
      expect(html, `the Help panel on ${tab}`).toContain('This view');
      expect(html.replace(/&amp;/g, '&'), `the Help panel on ${tab}`).toContain(`>${name}<`);
    }
  });
});

// ─── AC8 ───

describe('US-01M6Q16Q AC8: the registry assigns ⌘1-⌘9 in rail order and no digit to the last two studios', () => {
  it('US-01M6Q16Q AC8 gives Sequence Map to Sanger & Contig the digits 1 to 9 and none to the rest', () => {
    expect(STUDIOS.map((s) => [s.name, s.digit])).toEqual(RAIL.map((n, i) => [n, i < 9 ? i + 1 : undefined]));
    expect(DOCUMENT_PANELS.map((p) => p.digit)).toEqual([undefined, undefined]);
  });
});

// ─── BG-01M7V0TD ───

const explorerPane = (app: AppHarness) => app.all('.mbc-db-explorer-pane');
const railList = (app: AppHarness) => app.all('.mbc-studio-rail-list');
const menuRows = (app: AppHarness) => app.all('.desktop-menu-popup').flatMap((p) => p.querySelectorAll('button'));
/** Opens the in-window menubar's `top` menu and each submenu of `path`; gives the last row, unclicked. */
async function menuRow(app: AppHarness, path: string[]): Promise<LiveElement> {
  const [top, ...rest] = path;
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => words(b.textContent) === top);
  if (!trigger) throw new Error(`the menu bar has no ${top} menu`);
  await app.click(trigger);
  let row: LiveElement | undefined;
  for (const label of rest) {
    row = menuRows(app).find((b) => {
      const t = words(b.textContent);
      const after = t.slice(label.length).trim();
      return t.startsWith(label) && (after.length < 3 || /^(Ctrl|Shift|Alt|[⌘⇧⌥⌃])/.test(after));
    });
    if (!row) throw new Error(`no "${label}" in the open menu: ${menuRows(app).map((b) => words(b.textContent)).join(' | ')}`);
    if (label !== rest[rest.length - 1]) await app.click(row);
  }
  return row!;
}
async function closeMenus(app: AppHarness) {
  for (let i = 0; i < 3 && app.all('.desktop-menu-popup').length; i++) await app.press('Escape');
}
const isDisabled = (el: LiveElement) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

const RNA: SequenceDocument = { ...BASE, id: 'sr-rna', name: 'SR_RNA', accession: 'SR_10', moleculeType: 'RNA', sequence: 'AUGGCCAUUGUAAUGGGCCGCUGAAAGGGUGCCCGA' } as SequenceDocument;
const PLAIN_PROTEIN: SequenceDocument = { ...BASE, id: 'sr-plain-protein', name: 'SR_Plain', accession: 'SR_11', moleculeType: 'Protein', sequence: 'MKWVTFISLLFLFSSAYSRGVFRRDAHKSEVAHRFKDLGE' } as SequenceDocument;
const ROUTING_LIBRARY = [...LIBRARY, RNA, PLAIN_PROTEIN, DNA_COMPLEX];
const openRouted = (app: AppHarness, doc: SequenceDocument, viewerTab: ViewerTab) =>
  app.restoreSession({ documents: ROUTING_LIBRARY, activeDocId: doc.id, viewerTab });

describe('BG-01M7V0TD: the database explorer is left with no session open, and the rail names it while it is open', () => {
  it('BG-01M7V0TD with no session ⌘[ and View › History › Back leave the explorer for the start screen', async () => {
    const app = await mountApp();
    try {
      expect(railList(app), 'no session: no rail').toHaveLength(0);
      await app.menu('tools:databases-explorer');
      expect(explorerPane(app), 'the explorer opens over the start screen').toHaveLength(1);
      await app.press('[', { mod: true });
      expect(explorerPane(app), '⌘[ leaves the explorer').toHaveLength(0);
      expect(railList(app), 'still no session').toHaveLength(0);

      await app.menu('tools:databases-explorer');
      expect(explorerPane(app)).toHaveLength(1);
      const forward = await menuRow(app, ['View', 'History', 'Forward']);
      expect(isDisabled(forward), 'Forward still needs a session').toBe(true);
      await closeMenus(app);
      const back = await menuRow(app, ['View', 'History', 'Back']);
      expect(isDisabled(back), 'View › History › Back is enabled over the explorer').toBe(false);
      await app.click(back);
      await closeMenus(app);
      expect(explorerPane(app), 'View › History › Back leaves the explorer').toHaveLength(0);
      expect(statusText(app)).not.toMatch(/No active session/);

      // With neither a session nor the explorer, View › History (Back and Forward) stays off.
      const offHistory = await menuRow(app, ['View', 'History']);
      expect(isDisabled(offHistory), 'View › History with nothing to leave').toBe(true);
      await closeMenus(app);
      await app.press('[', { mod: true });
      expect(statusText(app), '⌘[ with nothing to leave is the disabled Back').toContain('Back is not available right now.');
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7V0TD with no session the native View › Back is enabled over the explorer and leaves it', async () => {
    const app = await mountApp(macHost());
    try {
      const backOn = () => {
        const states = app.nativeMenuStates();
        expect(states.length, 'the App sent a native menu state').toBeGreaterThan(0);
        return resolveNativeMenuItemEnabled('view:back', states[states.length - 1]);
      };
      expect(backOn(), 'no session, no explorer: native Back is off').toBe(false);
      expect(resolveNativeMenuItemEnabled('view:forward', app.nativeMenuStates().at(-1)!)).toBe(false);
      await app.menu('tools:databases-explorer');
      expect(backOn(), 'native Back is on over the explorer').toBe(true);
      expect(resolveNativeMenuItemEnabled('view:forward', app.nativeMenuStates().at(-1)!), 'Forward stays off').toBe(false);
      await app.menu('view:back');
      expect(explorerPane(app), 'native view:back leaves the explorer').toHaveLength(0);
      expect(statusText(app)).not.toMatch(/No active session/);
      expect(backOn(), 'native Back is off again').toBe(false);
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7V0TD with no session a new session started over the explorer leaves it, and the session shows', async () => {
    const app = await mountApp();
    try {
      await app.menu('tools:databases-explorer');
      expect(explorerPane(app)).toHaveLength(1);
      await app.menu('new-session:sample-library');
      expect(explorerPane(app), 'the new session is not covered by the explorer').toHaveLength(0);
      expect(railList(app), 'the session shows its studio rail').toHaveLength(1);
      expect(app.all('.mbc-center-stack').length, 'the session shows its document table and viewer').toBeGreaterThan(0);
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7V0TD data-current-studio names the explorer while it is open, and the studio again once Back leaves it', async () => {
    const app = await mountApp();
    try {
      await openRouted(app, DNA, 'annotations-table');
      expect(railList(app)[0].getAttribute('data-current-studio')).toBe('annotations');
      await app.menu('tools:databases-explorer');
      expect(explorerPane(app)).toHaveLength(1);
      expect(railList(app)[0].getAttribute('data-current-studio'), 'the explorer is what the main pane shows').toBe('database-explorer');
      expect(studioTabs(app).filter((t) => t.current), 'no studio is marked current').toEqual([]);
      await app.press('[', { mod: true });
      expect(explorerPane(app)).toHaveLength(0);
      expect(railList(app)[0].getAttribute('data-current-studio')).toBe('annotations');
    } finally {
      app.unmount();
    }
  });
});

describe('BG-01M7V0TD: the studio routing branches Sprint 39 left untested', () => {
  it('BG-01M7V0TD a DNA chain of a structure has the 3D view by its file or by its PDB name alone, and a plain DNA has none', () => {
    const DNA_PDB_NAME = { ...DNA, id: 'sr-dna-pdbname', docMetadata: { 'PDB name': 'SR1D', Chain: 'D' } } as SequenceDocument;
    const RNA_CHAIN = { ...RNA, id: 'sr-rna-chain', docMetadata: { PDBText: DNA_COMPLEX.docMetadata!.PDBText, Chain: 'R' } } as SequenceDocument;
    expect(relevantViewerTabs(DNA_COMPLEX)).toContain('protein-3d');
    expect(relevantViewerTabs(RNA_CHAIN)).toContain('protein-3d');
    expect(relevantViewerTabs(DNA_PDB_NAME)).toContain('protein-3d');
    expect(relevantViewerTabs(DNA)).not.toContain('protein-3d');
    expect(relevantViewerTabs(RNA)).not.toContain('protein-3d');
    // A chain with the structure file opens on it; the PDB name alone does not make it a structure to open on.
    expect(preferredViewerTab(DNA_COMPLEX)).toBe('protein-3d');
    expect(preferredViewerTab(RNA_CHAIN)).toBe('protein-3d');
    expect(preferredViewerTab(DNA_PDB_NAME)).toBe('sequence-view');
  });

  it('BG-01M7V0TD the redirect names the studio of the tab asked for, which needs no genomics sub-view', async () => {
    // Every genomics sub-view is Pipelines & NGS's, so the tab alone names the studio (the redirect passes no sub-view).
    const ngs = (['ngs-assembly', 'genome-variants', 'genes-cpg-repeats', 'transform-submit'] as GenomicsSubTabId[])
      .map((v) => studioForTab('genomics-ngs', DNA, v).id);
    expect(new Set(ngs)).toEqual(new Set(['pipelines-ngs']));
    expect(studioForTab('genomics-ngs', DNA).id).toBe('pipelines-ngs');
    const app = await mountApp();
    try {
      // Cloning › Restriction Cloning › Agarose Digest asks for Cloning & Gel, which a protein cannot show.
      await openRouted(app, PLAIN_PROTEIN, 'annotations-table');
      const row = await menuRow(app, ['Cloning', 'Restriction Cloning', 'Agarose Digest']);
      await app.click(row);
      await closeMenus(app);
      expect(app.activeTab(), 'a protein has no Cloning & Gel').not.toBe('cloning-gel');
      expect(statusText(app)).toContain('Cloning & Gel needs a DNA sequence or an Enzyme Set: "SR_Plain" is a Protein sequence. Select a document it applies to.');
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7V0TD the Enzymes view refuses an RNA and a protein, and opens in Sequence Map on a DNA', async () => {
    const app = await mountApp();
    try {
      for (const doc of [RNA, PLAIN_PROTEIN]) {
        await openRouted(app, doc, 'annotations-table');
        await app.menu('view:enzymes');
        expect(app.all('section.mbc-hosted-panel'), `${doc.moleculeType}: no Enzymes view`).toHaveLength(0);
        expect(app.activeTab(), `${doc.moleculeType}: the view is unchanged`).toBe('annotations-table');
        expect(statusText(app)).toContain(`The Enzymes view needs a DNA sequence: "${doc.name}" is a ${doc.moleculeType} sequence.`);
      }
      await openRouted(app, DNA, 'annotations-table');
      await app.menu('view:enzymes');
      expect(app.activeTab()).toBe('sequence-view');
      expect(app.all('section.mbc-hosted-panel[aria-label="Enzymes view"]'), 'DNA: the Enzymes view shows').toHaveLength(1);
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7V0TD Close Enzymes View and Close Folding close the panel and keep the host studio', async () => {
    const app = await mountApp();
    try {
      const closeButton = (label: string) => {
        const hits = app.all('section.mbc-hosted-panel button').filter((b) => words(b.textContent) === label);
        expect(hits, label).toHaveLength(1);
        return hits[0];
      };
      await openRouted(app, DNA, 'annotations-table');
      await app.menu('view:enzymes');
      expect(app.all('section.mbc-hosted-panel[aria-label="Enzymes view"]')).toHaveLength(1);
      await app.click(closeButton('Close Enzymes View'));
      expect(app.all('section.mbc-hosted-panel'), 'Close Enzymes View closes it').toHaveLength(0);
      expect(app.activeTab(), 'Sequence Map stays open').toBe('sequence-view');

      await app.menu('view:secondary-structure');
      expect(app.activeTab(), 'a DNA folds in Primers & CRISPR').toBe('primers-pcr');
      expect(app.all('section.mbc-hosted-panel[aria-label="Folding"]')).toHaveLength(1);
      await app.click(closeButton('Close Folding'));
      expect(app.all('section.mbc-hosted-panel'), 'Close Folding closes it').toHaveLength(0);
      expect(app.activeTab(), 'Primers & CRISPR stays open').toBe('primers-pcr');
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7V0TD Back-Translate opens its dialog on a protein, and Back Translate and Protein Domains open the Protein studio on one', async () => {
    const app = await mountApp();
    try {
      await openRouted(app, PLAIN_PROTEIN, 'annotations-table');
      await app.menu('annotate:protein-domains');
      expect(app.activeTab(), 'Protein Domains on a protein opens the Protein studio').toBe('protein-3d');
      expect(railList(app)[0].getAttribute('data-current-studio')).toBe('protein-3d');
      expect(statusText(app)).toContain('Protein Domains: motif and domain scanning is available for DNA/RNA (JASPAR PSSM); showing protein analysis.');

      // Sequence › Translation › Back Translate (no dialog) opens the Protein studio on a protein with no structure,
      // where no 3D fallback could stand in for the route.
      await openRouted(app, PLAIN_PROTEIN, 'annotations-table');
      await app.menu('sequence:back-translate');
      expect(app.activeTab(), 'Back Translate on a plain protein opens the Protein studio').toBe('protein-3d');
      expect(railList(app)[0].getAttribute('data-current-studio')).toBe('protein-3d');

      await openRouted(app, PLAIN_PROTEIN, 'annotations-table');
      await app.menu('sequence:back-translate-dialog');
      const dialogs = app.all('[role="dialog"], dialog').filter((d) => /Back-Translate/.test(words(d.textContent)) || /Back-Translate/.test(d.getAttribute('aria-label') ?? ''));
      expect(dialogs.length, 'the Back-Translate dialog opens').toBeGreaterThan(0);
      expect(words(dialogs[0].textContent), 'on the active protein').toContain('1 protein sequence');
      expect(app.activeTab(), 'the view stays').toBe('annotations-table');
    } finally {
      app.unmount();
    }
  });
});
