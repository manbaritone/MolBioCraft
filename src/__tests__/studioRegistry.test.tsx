// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q16Q: every studio has one name, one icon and one shortcut digit, in a studio registry
 * (src/core/studioRegistry.ts) that the tab strip, the inspector titles, ⌘K, the header search, the
 * Help panel's view topics, the redirect message and the studio error boundary all read (D0237).
 * The App is mounted through appHarness.tsx; React DOM's server renderer is loaded only after a
 * mount (or in a test that mounts nothing), so the harness's live-DOM check holds.
 */

import { describe, expect, it } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import {
  DOCUMENT_PANELS, STUDIOS, STUDIO_ENTRIES, studioAvailability, studioForView, studioForTab, studioIconElement,
  type StudioEntry,
} from '../core/studioRegistry';
import { VIEWER_TAB_ORDER, supportedViewerTabs, viewerTabLabel, type ViewerTab } from '../core/documentViews';
import { VIEW_HELP } from '../data/helpTopics';
import { appTsxSource, mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';
import type { GenomicsSubTabId } from '../core/analysisContext';
import { seededChromatogram } from './traceFixtures';

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
      'sequence-alignment', 'phylogenetics', 'sanger-contig', 'genomics-ngs', 'guided-pipelines', 'history-hybrid', 'document-info']);
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
      ['genomics-ngs', 'protein-3d', 'Protein & 3D'], ['genomics-ngs', 'ngs-assembly', 'Pipelines & NGS'], ['genomics-ngs', 'genome-variants', 'Pipelines & NGS'],
      ['genomics-ngs', 'genes-cpg-repeats', 'Pipelines & NGS'], ['genomics-ngs', 'transform-submit', 'Pipelines & NGS'],
      ['guided-pipelines', undefined, 'Pipelines & NGS'], ['history-hybrid', undefined, 'History'], ['document-info', undefined, 'Info'],
    ];
    for (const [tab, view, name] of expected) {
      expect(owners(tab, view), `${tab}${view ? ` › ${view}` : ''}`).toEqual([name]);
      expect(studioForView(tab, view as never)?.name, `${tab}${view ? ` › ${view}` : ''}`).toBe(name);
    }
    expect(new Set(expected.map(([t]) => t)).size, 'every one of the 13 tabs is covered').toBe(13);
    // The shared tab resolves by record: a protein's genomics-ngs is Protein & 3D, a DNA's is Pipelines & NGS.
    expect(studioForTab('genomics-ngs', PROTEIN).name).toBe('Protein & 3D');
    expect(studioForTab('genomics-ngs', DNA).name).toBe('Pipelines & NGS');
    expect(studioForTab('genomics-ngs', DNA, 'protein-3d').name).toBe('Protein & 3D');
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
      expect(viewerTabLabel('genomics-ngs', doc, 'protein-3d'), `${doc?.name ?? 'no record'} in protein-3d`).toBe('Protein & 3D');
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

      // A plain DNA record: ⌘K's Protein & 3D opens the genomics tab in its 3D view, which has no settings.
      await openOn(app, DNA, 'sequence-view');
      await helpOpen();
      expect(app.all('.mbc-help-panel'), 'F1 opens the Help panel').toHaveLength(1);
      await choose('Protein & 3D');
      expect(app.activeTab(), '⌘K Protein & 3D opens the genomics tab').toBe('genomics-ngs');
      expect(shown(), 'Protein & 3D on a DNA record').toEqual({ tab: [['Protein & 3D', studio('Protein & 3D')]], inspector: null, help: ['Protein & 3D'] });
      await choose('Pipelines & NGS');
      // It opens on the guided pipelines, which have no settings either.
      expect(shown(), 'Pipelines & NGS on a DNA record')
        .toEqual({ tab: [['Pipelines & NGS', studio('Pipelines & NGS')]], inspector: null, help: ['Pipelines & NGS'] });

      // A DNA chain of a two-chain structure: the 3D view has its Structure section, so an inspector.
      await app.restoreSession({ documents: [...LIBRARY, DNA_COMPLEX], activeDocId: DNA_COMPLEX.id, viewerTab: 'sequence-view' });
      await helpOpen();
      await choose('Protein & 3D');
      expect(app.activeTab()).toBe('genomics-ngs');
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
      await subTab('Coiled-Coils, Transmembrane & 3D PDB');
      expect(shown(), 'the studio\'s own 3D sub-tab')
        .toEqual({ tab: [['Protein & 3D', studio('Protein & 3D')]], inspector: 'Protein & 3D Controls', help: ['Protein & 3D'] });
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
        [TRACE, 'sanger-contig', 'Sanger & Contig'], [PROTEIN, 'genomics-ngs', 'Protein & 3D'], [TREE, 'phylogenetics', 'Phylogenetics'],
        [ALIGNMENT, 'sequence-alignment', 'Alignment'], [NOTE, 'text-view', 'Flatfile'],
        // The per-record names are gone: an unaligned list and an enzyme set read Alignment and History.
        [UNALIGNED, 'sequence-alignment', 'Alignment'], [ENZYMES, 'history-hybrid', 'History'],
      ];
      for (const [doc, tab, name] of cases) {
        await openOn(app, doc, tab);
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

      const search = app.one('#mbc-toolbar-global-search-input', 'the header search');
      for (const entry of STUDIOS) {
        await app.input(search, entry.name);
        const hits = app.all('.mbc-header-search-item');
        const named = hits.filter((h) => words(h.querySelectorAll('.mbc-header-search-label')[0]?.textContent ?? '') === entry.name);
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
    expect(viewerTabLabel('genomics-ngs', PROTEIN)).toBe('Protein & 3D');
  });
});

// ─── AC7 ───

describe('US-01M6Q16Q AC7: each studio is drawn with its registry icon from the existing multi-tone set', () => {
  it('US-01M6Q16Q AC7 each icon is an existing multi-tone glyph, no two studios share one, and each tab draws its studio\'s icon', async () => {
    // Mount first, so React DOM's server renderer loads after the live DOM exists.
    const app = await mountApp();
    const drawn: [string, string][] = [];
    try {
      for (const [doc, tab] of [[DNA, 'sequence-view'], [TRACE, 'sanger-contig'], [PROTEIN, 'genomics-ngs'], [TREE, 'phylogenetics'], [ALIGNMENT, 'sequence-alignment']] as const) {
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
