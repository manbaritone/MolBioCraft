// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q1V9: the sidebar shows the user's Project first and keeps the vector catalogue, features,
 * samples and databases in a Libraries section, collapsed until opened; a database opens in the
 * main pane, not in a dialog. Every test mounts the real App (appHarness.tsx) and drives it through
 * its own sidebar rows, menus, toolbar, native menu ids and keys.
 *
 * Wrong implementations, and the case that catches each:
 * - Libraries open by default, or its open state kept in the session or not kept at all: AC1 reads
 *   it closed on first run, open after a relaunch on the same storage, and unchanged by a restore;
 * - a library, demo or action row left in Project (Standard Plasmid Features, Auto-Annotate,
 *   Vector Catalog, NCBI, a benchmark): AC2 lists Project's rows exactly;
 * - Operations not renamed to History, or a count that is not real: AC2's exact labels and counts;
 * - a benchmark row kept anywhere, or the samples elsewhere: AC3 lists every row of the sidebar;
 * - a database row with a made-up count, or RCSB PDB / Primers / Restriction Enzymes missing: AC4;
 * - the explorer left in a <dialog>, its category column kept, or Back not returning to the
 *   document the explorer opened over: AC5;
 * - an entry point left opening the old modal, or on the wrong category: AC6, one at a time;
 * - an RCSB request sent before the user submits: AC7, with the global fetch observed;
 * - an opened RCSB entry not handed to the workbench import: AC8 reads its chains back from the
 *   session the App saves.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import explorerSrc from '../components/DatabaseExplorerModal.tsx?raw';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { VECTOR_CATALOG } from '../data/vectorCatalog';
import { MODULAR_VECTOR_PARTS } from '../data/modularVectorParts';
import { COMMON_PLASMID_FEATURES } from '../core/bioEngine';
import { queryCuratedDatabaseRecordsRust } from '../lib/rustBioEngine';
import { RCSB_SEARCH_URL } from '../core/rcsbClient';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { memoryStorage, type LiveElement } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// ─── The sidebar, as a reader sees it ───

const section = (app: AppHarness, id: 'project' | 'libraries') =>
  app.one(`.mbc-sources-pane section.mbc-sidebar-section[data-section="${id}"]`, `the ${id} section`);
const sectionHead = (app: AppHarness, id: 'project' | 'libraries') =>
  section(app, id).querySelector('button.mbc-sidebar-section-head')!;
const isOpen = (app: AppHarness, id: 'project' | 'libraries') => sectionHead(app, id).getAttribute('aria-expanded') === 'true';

interface Row { label: string; count: string | null; el: LiveElement }
const rowOf = (el: LiveElement): Row => ({
  label: words(el.querySelector('.folder-label')?.textContent),
  count: el.querySelector('.folder-count') ? words(el.querySelector('.folder-count')!.textContent) : null,
  el,
});
const rowsIn = (el: LiveElement): Row[] => el.querySelectorAll('button.source-folder-row').map(rowOf);
const group = (app: AppHarness, id: string) =>
  app.one(`.mbc-sources-pane section[data-section="libraries"] .mbc-sidebar-group[data-group="${id}"]`, `Libraries › ${id}`);
/** A group's own rows, without those of a group inside it. */
const ownRows = (el: LiveElement): Row[] =>
  rowsIn(el).filter((r) => r.el.closest('.mbc-sidebar-group') === el);
const row = (rows: Row[], label: string): Row => {
  const hit = rows.filter((r) => r.label === label);
  if (hit.length !== 1) throw new Error(`${hit.length} rows labelled "${label}" in: ${rows.map((r) => r.label).join(' | ')}`);
  return hit[0];
};

async function openLibraries(app: AppHarness) {
  if (!isOpen(app, 'libraries')) await app.click(sectionHead(app, 'libraries'));
  expect(isOpen(app, 'libraries'), 'Libraries is open').toBe(true);
}

// ─── The main pane ───

const explorer = (app: AppHarness) => app.all('.mbc-db-explorer-pane');
const explorerCategory = (app: AppHarness) => explorer(app)[0]?.getAttribute('data-db-category') ?? null;
const activeDocName = (app: AppHarness) =>
  words(app.all('button.mbc-doc-tab-trigger[aria-selected="true"]')[0]?.querySelector('.mbc-doc-tab-title')?.textContent);
const toast = (app: AppHarness) => words(app.all('.statusbar-toast-text')[0]?.textContent);

/** The explorer fills the main pane: no document table or viewer beside it, no dialog around it. */
function expectMainPaneExplorer(app: AppHarness, category: string, how: string) {
  expect(explorer(app), `${how}: one explorer`).toHaveLength(1);
  expect(explorerCategory(app), `${how}: on ${category}`).toBe(category);
  expect(explorer(app)[0].closest('.mbc-main-split'), `${how}: in the main split`).not.toBeNull();
  expect(explorer(app)[0].closest('dialog'), `${how}: not in a dialog`).toBeNull();
  expect(app.all('dialog[open]'), `${how}: no dialog open`).toHaveLength(0);
  expect(app.all('.modal-size-db'), `${how}: no 940x640 modal`).toHaveLength(0);
  expect(app.all('.mbc-center-stack'), `${how}: the explorer takes the main pane`).toHaveLength(0);
  expect(app.all('nav[aria-label="Reference Databases"]'), `${how}: no second category list`).toHaveLength(0);
  expect(app.all('.mbc-db-explorer-pane .prefs-category-item'), `${how}: no category column`).toHaveLength(0);
}

async function back(app: AppHarness) {
  await app.press('[', { mod: true });
  expect(explorer(app), 'Back leaves the explorer').toHaveLength(0);
  expect(app.all('.mbc-center-stack'), 'Back returns to the document').toHaveLength(1);
}

/** The documents of the session the App saves. */
async function savedDocuments(app: AppHarness): Promise<SequenceDocument[]> {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files).toHaveLength(1);
  const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
  return parseMbcWorkbench(await files[0].text()).envelope.documents as SequenceDocument[];
}

async function clickMenuPath(app: AppHarness, trigger: LiveElement, rest: string[]) {
  await app.click(trigger);
  for (const label of rest) {
    const buttons = app.all('.desktop-menu-popup').flatMap((p) => p.querySelectorAll('button'));
    const item = buttons.find((b) => words(b.textContent).startsWith(label) && words(b.textContent).replace(label, '').trim().length < 4);
    if (!item) throw new Error(`no "${label}" in the open menu: ${buttons.map((b) => words(b.textContent)).join(' | ')}`);
    await app.click(item);
  }
}
const menubarItem = (app: AppHarness, top: string) =>
  app.all('.mbc-menubar [role="menuitem"]').find((b) => words(b.getAttribute('aria-label') ?? b.textContent) === top)!;

const PET = SAMPLE_LIBRARY.find((d) => d.id === 'doc-pet28-egfp')!;
const sampleSession = (app: AppHarness, workspace = {}) =>
  app.restoreSession({ documents: SAMPLE_LIBRARY, activeDocId: PET.id, viewerTab: 'sequence-view', workspace });

const NCBI = [
  ['ncbi-gene', 'Gene'], ['ncbi-nucleotide', 'Nucleotide'], ['ncbi-protein', 'Protein'],
  ['ncbi-pubmed', 'PubMed'], ['ncbi-structure', 'Structure'], ['ncbi-taxonomy', 'Taxonomy'],
] as const;
const count = (cat: string) => String(queryCuratedDatabaseRecordsRust(cat, '').length);

afterEach(() => { vi.unstubAllGlobals(); });

// ─── AC1 ───

describe('US-01M6Q1V9 AC1: the sidebar shows Project first and Libraries collapsed', () => {
  it('US-01M6Q1V9 AC1 shows Project first and Libraries collapsed, keeps Libraries open per viewer, and restores the saved project explorer', async () => {
    const storage = memoryStorage();
    let app = await mountApp({ storage });
    try {
      await app.menu('new-session:sample-library');
      const sections = app.all('.mbc-sources-pane .sources-tree-scroll > section.mbc-sidebar-section').map((s) => s.getAttribute('data-section'));
      expect(sections, 'two sections, Project first').toEqual(['project', 'libraries']);
      expect(words(sectionHead(app, 'project').querySelector('.mbc-sidebar-section-label')?.textContent)).toBe('Project');
      expect(words(sectionHead(app, 'libraries').querySelector('.mbc-sidebar-section-label')?.textContent)).toBe('Libraries');
      expect(isOpen(app, 'project'), 'Project is expanded').toBe(true);
      expect(rowsIn(section(app, 'project')).length, 'Project lists its rows').toBeGreaterThan(3);
      expect(isOpen(app, 'libraries'), 'Libraries is collapsed on first run').toBe(false);
      expect(rowsIn(section(app, 'libraries')), 'a collapsed Libraries lists no row').toEqual([]);
      const headCount = words(sectionHead(app, 'libraries').querySelector('.mbc-sidebar-section-count')?.textContent);
      expect(headCount, 'the Libraries header shows a count').toMatch(/^\d+$/);
      await openLibraries(app);
      expect(headCount, 'the count is the number of libraries listed').toBe(String(rowsIn(section(app, 'libraries')).length));
    } finally {
      app.unmount();
    }

    // A relaunch on the same browser storage: Libraries stays open.
    app = await mountApp({ storage });
    try {
      await app.menu('new-session:sample-library');
      expect(isOpen(app, 'libraries'), 'Libraries stays open after a reload').toBe(true);
      expect(rowsIn(section(app, 'libraries')).length).toBeGreaterThan(0);
      // A saved session restores its project explorer and selected folder as before; the Libraries
      // state is the viewer's, not the session's, so the restore leaves it open.
      const fav = SAMPLE_LIBRARY[1];
      await sampleSession(app, {
        selectedFolder: 'Bench Notes',
        projectExplorer: {
          customFolders: ['Bench Notes'], folderColors: {}, folderNames: {}, folderParents: {}, hiddenFolders: [],
          favoriteFolders: [], favoriteDocIds: [fav.id], deletedDocIds: [], readDocIds: [],
        },
      });
      const selected = rowsIn(section(app, 'project')).filter((r) => r.el.getAttribute('class')?.includes('selected')).map((r) => r.label);
      expect(selected, 'the saved selected folder').toEqual(['Bench Notes']);
      expect(row(rowsIn(section(app, 'project')), 'Favorites').count, 'the saved favourite').toBe('1');
      expect(isOpen(app, 'libraries'), 'a session restore leaves Libraries as the viewer left it').toBe(true);
      // Closing it is remembered too.
      await app.click(sectionHead(app, 'libraries'));
      expect(isOpen(app, 'libraries')).toBe(false);
    } finally {
      app.unmount();
    }
    app = await mountApp({ storage });
    try {
      await app.menu('new-session:sample-library');
      expect(isOpen(app, 'libraries'), 'closed Libraries stays closed after a reload').toBe(false);
    } finally {
      app.unmount();
    }
  });
});

// ─── AC2 ───

describe('US-01M6Q1V9 AC2: the Project section holds only the user\'s documents, folders and history', () => {
  it('US-01M6Q1V9 AC2 lists Favorites, the project folders, Deleted Items and History with real counts, and Standard Plasmid Features opens the feature library from Libraries', async () => {
    const app = await mountApp();
    try {
      const fav = SAMPLE_LIBRARY[1];
      const trashed = SAMPLE_LIBRARY[2];
      await sampleSession(app, {
        projectExplorer: {
          customFolders: [], folderColors: {}, folderNames: {}, folderParents: {}, hiddenFolders: [],
          favoriteFolders: [], favoriteDocIds: [fav.id], deletedDocIds: [trashed.id], readDocIds: [],
        },
      });
      await openLibraries(app);
      const project = rowsIn(section(app, 'project'));
      const labels = project.map((r) => r.label);
      expect(labels[0], 'Favorites first').toBe('Favorites');
      expect(labels[1]).toBe('All Project Files');
      expect(labels.slice(-2), 'Deleted Items, then History').toEqual(['Deleted Items', 'History']);
      expect(labels, 'the project folders').toContain('Sample Documents');
      // Every row between All Project Files and Deleted Items is a project folder.
      const folderRows = project.slice(2, -2);
      expect(folderRows.length).toBeGreaterThan(0);
      for (const r of folderRows) expect(r.el.closest('.tree-indent-1'), `${r.label} is in the folder tree`).not.toBeNull();
      for (const banned of ['Standard Plasmid Features', 'Auto-Annotate Features', 'Vector Catalog', 'Modular Vector Parts', 'NCBI', 'UniProt',
        'Local BLAST Databases', 'Operations', 'RefSeq: SpCas9 CDS', 'RefSeq: Spike RBD', 'Genome: 500 kbp E. coli', 'Protein: 10,000 aa Titin']) {
        expect(labels, `${banned} is not in Project`).not.toContain(banned);
      }
      const live = SAMPLE_LIBRARY.filter((d) => d.id !== trashed.id);
      expect(row(project, 'Favorites').count).toBe('1');
      expect(row(project, 'All Project Files').count).toBe(String(live.length));
      expect(row(project, 'Deleted Items').count).toBe('1');
      expect(row(project, 'History').count, 'History counts the operations on the project').toBe(String(live.reduce((n, d) => n + (d.history?.length ?? 0), 0)));
      await app.click(row(project, 'History').el);
      expect(app.all('[role="tab"][data-studio="history"][aria-selected="true"]'), 'History opens the History panel').toHaveLength(1);

      // Libraries › Features › Standard Plasmid Features opens the feature library.
      const features = ownRows(group(app, 'features'));
      expect(features.map((r) => [r.label, r.count])).toEqual([['Standard Plasmid Features', String(COMMON_PLASMID_FEATURES.length)]]);
      await app.click(sectionHead(app, 'project'));
      expect(isOpen(app, 'project'), 'Project folds on its chevron').toBe(false);
      await app.click(sectionHead(app, 'project'));
      await app.click(row(ownRows(group(app, 'features')), 'Standard Plasmid Features').el);
      expect(app.activeTab(), 'the feature library (Sequence › Features › Feature Library)').toBe('annotations-table');
    } finally {
      app.unmount();
    }
  });
});

// ─── AC3 ───

describe('US-01M6Q1V9 AC3: the sidebar has no benchmark or demo rows, and samples sit under Libraries', () => {
  it('US-01M6Q1V9 AC3 lists no benchmark row, the Sample Project and the three start-screen files under Libraries › Samples, the RefSeq fetches under Databases › NCBI, and ⌘K still loads both benchmarks', async () => {
    const app = await mountApp();
    try {
      await app.menu('new-session:sample-library');
      await openLibraries(app);
      const all = rowsIn(app.one('.mbc-sources-pane', 'the sidebar'));
      for (const r of all) {
        expect(r.label, 'no benchmark row').not.toMatch(/500 kbp|10,000 aa|Titin|Genome:/);
        expect(r.el.getAttribute('title') ?? '', `${r.label}: loads no benchmark`).not.toMatch(/Resident Rust Sequence Store|benchmark/i);
        expect(r.label, 'no demo or action row').not.toMatch(/Auto-Annotate/);
      }
      expect(ownRows(group(app, 'samples')).map((r) => r.label)).toEqual([
        'Sample Project', 'pET-28a(+)-eGFP.gb', 'pUC19_Standard_Vector.gb', 'eGFP_Clone3_Sanger_Fwd.ab1',
      ]);
      expect(row(ownRows(group(app, 'samples')), 'Sample Project').count, 'the Sample Project holds every sample document').toBe(String(SAMPLE_LIBRARY.length));
      const ncbi = ownRows(group(app, 'ncbi')).map((r) => r.label);
      expect(ncbi.slice(-2), 'the RefSeq fetches sit under Databases › NCBI').toEqual(['RefSeq: SpCas9 CDS', 'RefSeq: Spike RBD']);
      // The sample files open as the start screen opens them.
      await app.click(row(ownRows(group(app, 'samples')), 'pUC19_Standard_Vector.gb').el);
      expect(activeDocName(app)).toBe(SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!.name);
      expect(app.activeTab()).toBe('sequence-view');
      await app.click(row(ownRows(group(app, 'samples')), 'eGFP_Clone3_Sanger_Fwd.ab1').el);
      expect(activeDocName(app)).toBe(SAMPLE_LIBRARY.find((d) => d.id === 'doc-sanger-ab1-fwd')!.name);
      expect(app.activeTab()).toBe('sanger-contig');

      // ⌘K still loads both benchmark documents.
      for (const [label, loaded] of [
        ['500 kbp Annotated Genome', /^Loaded ".+" \(500,000 bp, \d+ annotations; [\d,]+ KiB held in memory\)$/],
        ['10,000 aa Protein', /^Loaded ".+" \(10,000 aa, \d+ annotations; [\d,]+ KiB held in memory\)$/],
      ] as const) {
        await app.press('k', { mod: true });
        await app.input(app.one('.mbc-cmd-palette-input', 'the ⌘K field'), label);
        const item = app.all('.mbc-cmd-palette-item').find((el) => words(el.querySelector('strong')?.textContent) === label);
        expect(item, `⌘K lists ${label}`).toBeTruthy();
        await app.click(item!);
        expect(toast(app), `⌘K loads ${label}`).toMatch(loaded);
      }
    } finally {
      app.unmount();
    }
  });
});

// ─── AC4 ───

describe('US-01M6Q1V9 AC4: Libraries lists every database category with its count', () => {
  it('US-01M6Q1V9 AC4 lists Vectors and every database category with its record count, RCSB PDB with none, and the Primer Database and Restriction Enzymes rows that open their windows', async () => {
    const app = await mountApp();
    try {
      await app.menu('new-session:sample-library');
      await openLibraries(app);
      expect(ownRows(group(app, 'vectors')).map((r) => [r.label, r.count])).toEqual([
        ['Vector Catalog', String(VECTOR_CATALOG.length)],
        ['Modular Vector Parts', String(MODULAR_VECTOR_PARTS.length)],
      ]);
      expect(ownRows(group(app, 'ncbi')).map((r) => [r.label, r.count])).toEqual([
        ...NCBI.map(([cat, label]) => [label, count(cat)]),
        ['RefSeq: SpCas9 CDS', '1'], ['RefSeq: Spike RBD', '1'],
      ]);
      for (const [cat] of NCBI) expect(Number(count(cat)), `${cat} has curated records`).toBeGreaterThan(0);
      const localCount = row(ownRows(group(app, 'databases')), 'Local BLAST Databases').count ?? '';
      expect(localCount, 'Local BLAST Databases shows a count').toMatch(/^\d+$/);
      expect(ownRows(group(app, 'databases')).map((r) => [r.label, r.count])).toEqual([
        ['UniProt', count('uniprot')],
        ['RCSB PDB', null],
        ['Local BLAST Databases', localCount],
        ['Primer Database', null],
        ['Restriction Enzymes', null],
      ]);
      expect(group(app, 'ncbi').closest('.mbc-sidebar-group[data-group="databases"]'), 'NCBI sits under Databases').not.toBeNull();
      // Each category row opens the explorer on its own category.
      for (const [cat, label] of [...NCBI, ['uniprot', 'UniProt'], ['rcsb-pdb', 'RCSB PDB'], ['local-blast-dbs', 'Local BLAST Databases']] as const) {
        const rows = [...ownRows(group(app, 'ncbi')), ...ownRows(group(app, 'databases'))];
        await app.click(row(rows, label).el);
        expectMainPaneExplorer(app, cat, label);
        expect(row([...ownRows(group(app, 'ncbi')), ...ownRows(group(app, 'databases'))], label).el.getAttribute('class'), `${label} is marked chosen`).toContain('selected');
        if (cat === 'local-blast-dbs') {
          expect(app.all('.mbc-db-explorer-pane table.mbc-document-table tbody tr'), 'the count is the databases the explorer lists').toHaveLength(Number(localCount));
        } else if (cat !== 'rcsb-pdb') {
          expect(app.all('.mbc-db-explorer-pane .mbc-db-record-card'), `${label}: the count is the records the explorer lists`).toHaveLength(Number(count(cat)));
        }
      }
      await back(app);
      // Primer Database and Restriction Enzymes open their existing windows (D0221).
      await app.click(row(ownRows(group(app, 'databases')), 'Primer Database').el);
      expect(app.all('[aria-labelledby="primer-db-title"]'), 'the Primer Database window').toHaveLength(1);
      expect(explorer(app)).toHaveLength(0);
      await app.press('Escape');
      await app.click(row(ownRows(group(app, 'databases')), 'Restriction Enzymes').el);
      expect(app.all('[aria-labelledby="enzyme-db-title"]'), 'the Restriction Enzymes window').toHaveLength(1);
      expect(explorer(app)).toHaveLength(0);
    } finally {
      app.unmount();
    }
  });
});

// ─── AC5 ───

describe('US-01M6Q1V9 AC5: a database category opens in the main pane, not in a dialog', () => {
  it('US-01M6Q1V9 AC5 opens NCBI Nucleotide in the main pane, searches it, adds a record to the project, and Back returns to the plasmid on Sequence Map', async () => {
    const app = await mountApp();
    try {
      await sampleSession(app);
      expect(activeDocName(app)).toBe(PET.name);
      await openLibraries(app);
      await app.click(row(ownRows(group(app, 'ncbi')), 'Nucleotide').el);
      expectMainPaneExplorer(app, 'ncbi-nucleotide', 'Libraries › Databases › NCBI Nucleotide');
      expect(app.all('[role="tab"][data-studio][aria-selected="true"]'), 'the rail marks no studio current over a library').toHaveLength(0);

      const records = queryCuratedDatabaseRecordsRust('ncbi-nucleotide', '');
      const cards = () => app.all('.mbc-db-explorer-pane .mbc-db-record-card');
      expect(cards(), 'every curated record listed').toHaveLength(records.length);
      const target = records[records.length - 1];
      const filter = app.one('.mbc-db-explorer-pane input[placeholder^="Filter"]', 'the record filter');
      await app.input(filter, target.accession);
      const found = queryCuratedDatabaseRecordsRust('ncbi-nucleotide', target.accession);
      expect(cards(), 'the search narrows the list').toHaveLength(found.length);
      expect(found.length).toBeLessThan(records.length);
      const before = (await savedDocuments(app)).map((d) => d.id);
      const card = cards().find((c) => c.textContent.includes(target.accession))!;
      await app.click(card.querySelector('button.btn-primary-sm')!);
      const added = (await savedDocuments(app)).filter((d) => !before.includes(d.id));
      expect(added, 'the record joins the project').toHaveLength(1);
      expect(added[0].sequence).toBe(target.sequence);
      expectMainPaneExplorer(app, 'ncbi-nucleotide', 'after the add');

      await back(app);
      expect(activeDocName(app), 'Back returns to the plasmid').toBe(PET.name);
      expect(app.activeTab(), 'on Sequence Map').toBe('sequence-view');
      expect(app.all('[role="tab"][data-studio][aria-selected="true"]'), 'a studio is current again').toHaveLength(1);

      // Choosing a studio in the rail also leaves the explorer.
      await app.click(row(ownRows(group(app, 'databases')), 'UniProt').el);
      expectMainPaneExplorer(app, 'uniprot', 'UniProt');
      await app.clickStudio('annotations');
      expect(explorer(app), 'a studio chosen in the rail leaves the explorer').toHaveLength(0);
      expect(app.activeTab()).toBe('annotations-table');
    } finally {
      app.unmount();
    }
  });
});

// ─── AC6 ───

describe('US-01M6Q1V9 AC6: every database command opens the main-pane explorer', () => {
  it('US-01M6Q1V9 AC6 opens the main-pane explorer from the Tools and File menus, the toolbar Import menu and the native ids, and Open BLAST still opens BLAST', async () => {
    const app = await mountApp();
    try {
      await sampleSession(app);
      const routes: Array<[string, string, () => Promise<void>]> = [
        ['Tools › Databases › NCBI & UniProt', 'ncbi-nucleotide', () => clickMenuPath(app, menubarItem(app, 'Tools'), ['Databases', 'NCBI & UniProt'])],
        ['Tools › Databases › Local BLAST DBs', 'local-blast-dbs', () => clickMenuPath(app, menubarItem(app, 'Tools'), ['Databases', 'Local BLAST DBs'])],
        ['File › Import Data › Databases › NCBI & UniProt', 'ncbi-nucleotide', () => clickMenuPath(app, menubarItem(app, 'File'), ['Import Data', 'Databases', 'NCBI & UniProt'])],
        ['toolbar Import ▾ › Databases › NCBI & UniProt', 'ncbi-nucleotide', () => clickMenuPath(app,
          app.all('button.mbc-tool-btn[aria-haspopup="menu"]').find((b) => words(b.textContent).startsWith('Import'))!, ['Databases', 'NCBI & UniProt'])],
        ['tools:databases-explorer', 'ncbi-nucleotide', () => app.menu('tools:databases-explorer')],
        ['tools:local-blast-dbs', 'local-blast-dbs', () => app.menu('tools:local-blast-dbs')],
        ['file:import-ncbi-db', 'ncbi-nucleotide', () => app.menu('file:import-ncbi-db')],
      ];
      for (const [how, category, open] of routes) {
        expect(explorer(app), `${how}: starts on the document`).toHaveLength(0);
        await open();
        expectMainPaneExplorer(app, category, how);
        await back(app);
      }
      // With the sidebar hidden too.
      await app.menu('view:toggle-sidebar');
      await app.menu('tools:databases-explorer');
      expectMainPaneExplorer(app, 'ncbi-nucleotide', 'sidebar hidden');
      await app.menu('view:toggle-sidebar');

      // Open BLAST still opens the BLAST window.
      const blast = app.all('.mbc-db-explorer-pane button').find((b) => words(b.textContent) === 'Open BLAST Search');
      expect(blast, 'the explorer offers Open BLAST').toBeTruthy();
      await app.click(blast!);
      expect(app.all('dialog.modal-size-blast'), 'the BLAST window').toHaveLength(1);
      expect(explorer(app), 'the explorer gives way to BLAST').toHaveLength(0);
    } finally {
      app.unmount();
    }
  });
});

// ─── AC7 and AC8: RCSB PDB ───

/** Two protein chains: A MET LYS VAL, B GLY ALA SER (a synthetic mmCIF, US-01M7NMQK's layout). */
const TWO_CHAIN_CIF = [
  'data_1XYZ', 'loop_', '_atom_site.group_PDB', '_atom_site.id', '_atom_site.type_symbol', '_atom_site.label_atom_id',
  '_atom_site.label_comp_id', '_atom_site.label_asym_id', '_atom_site.label_seq_id', '_atom_site.auth_asym_id',
  '_atom_site.auth_seq_id', '_atom_site.Cartn_x', '_atom_site.Cartn_y', '_atom_site.Cartn_z',
  ...[['MET', 'A', 1], ['LYS', 'A', 2], ['VAL', 'A', 3], ['GLY', 'B', 1], ['ALA', 'B', 2], ['SER', 'B', 3]].map(
    ([res, chain, seq], k) => `ATOM ${k + 1} C CA ${res} ${chain} ${seq} ${chain} ${seq} ${k}.000 1.000 2.000`),
  '',
].join('\n');

type FetchFn = typeof globalThis.fetch;
const urlOf = (input: Parameters<FetchFn>[0]): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

function rcsbStub() {
  return vi.fn<FetchFn>(async (input) => {
    const url = urlOf(input);
    if (url === RCSB_SEARCH_URL) {
      return json({ query_id: 't', result_type: 'entry', total_count: 1, result_set: [{ identifier: '1XYZ', score: 1 }] });
    }
    if (url === 'https://data.rcsb.org/rest/v1/core/entry/1XYZ') {
      return json({
        rcsb_id: '1XYZ', struct: { title: 'TWO SHORT CHAINS' }, exptl: [{ method: 'X-RAY DIFFRACTION' }],
        rcsb_entry_info: { resolution_combined: [2] }, rcsb_accession_info: { initial_release_date: '2001-01-01T00:00:00+0000' },
        rcsb_entry_container_identifiers: { polymer_entity_ids: ['1'] },
      });
    }
    if (url === 'https://files.rcsb.org/download/1XYZ.cif') return new Response(TWO_CHAIN_CIF);
    throw new Error(`unexpected request ${url}`);
  });
}
const rcsbCalls = (spy: ReturnType<typeof rcsbStub>) => spy.mock.calls.map(([input]) => urlOf(input)).filter((u) => u.includes('rcsb.org'));

async function openRcsb(app: AppHarness) {
  await openLibraries(app);
  await app.click(row(ownRows(group(app, 'databases')), 'RCSB PDB').el);
  expectMainPaneExplorer(app, 'rcsb-pdb', 'Libraries › Databases › RCSB PDB');
}
async function searchRcsb(app: AppHarness, spy: ReturnType<typeof rcsbStub>, query: string) {
  const box = app.one('.mbc-db-explorer-pane input[aria-label="RCSB PDB keywords"]', 'the RCSB keywords box');
  for (let i = 1; i <= query.length; i++) await app.input(box, query.slice(0, i));
  expect(rcsbCalls(spy), 'typing sends nothing').toEqual([]);
  const submit = app.one('.mbc-db-explorer-pane form button[type="submit"]', 'the RCSB search button');
  await app.click(submit);
}

describe('US-01M6Q1V9 AC7: RCSB stays user-initiated in the main pane', () => {
  it('US-01M6Q1V9 AC7 shows the RCSB panel in the main pane and requests nothing until the search is submitted', async () => {
    const spy = rcsbStub();
    vi.stubGlobal('fetch', spy);
    const app = await mountApp();
    try {
      await sampleSession(app);
      await openRcsb(app);
      expect(rcsbCalls(spy), 'opening RCSB PDB sends nothing').toEqual([]);
      await searchRcsb(app, spy, 'two chains');
      expect(rcsbCalls(spy)[0], 'the submitted search is the first request').toBe(RCSB_SEARCH_URL);
      expect(rcsbCalls(spy).length).toBeGreaterThan(0);
      // The explorer's source has no effect or ref that could request on mount (D0008).
      expect(explorerSrc).not.toMatch(/\buse(Layout|Insertion)?Effect\b/);
      expect(explorerSrc).not.toMatch(/\bref=|\buseRef\b|\bcreateRef\b|\buseImperativeHandle\b/);
    } finally {
      app.unmount();
    }
  });
});

describe('US-01M6Q1V9 AC8: opening an RCSB entry from the main pane goes through the workbench import', () => {
  it('US-01M6Q1V9 AC8 imports the opened entry\'s mmCIF through the workbench import and its chains join the open session', async () => {
    const spy = rcsbStub();
    vi.stubGlobal('fetch', spy);
    const app = await mountApp();
    try {
      await sampleSession(app);
      const before = (await savedDocuments(app)).map((d) => d.id);
      await openRcsb(app);
      await searchRcsb(app, spy, 'two chains');
      const open = app.one('.mbc-db-explorer-pane button[value="1XYZ"]', 'the hit\'s Open button');
      await app.click(open);
      expect(rcsbCalls(spy).at(-1), 'Open fetches the mmCIF').toBe('https://files.rcsb.org/download/1XYZ.cif');
      const added = (await savedDocuments(app)).filter((d) => !before.includes(d.id));
      expect(added.map((d) => [d.moleculeType, d.sequence]), 'one document per chain joins the session').toEqual([['Protein', 'MKV'], ['Protein', 'GAS']]);
      expect(before.length, 'the session kept its documents').toBe(SAMPLE_LIBRARY.length);
      expect((await savedDocuments(app)).length).toBe(SAMPLE_LIBRARY.length + 2);
    } finally {
      app.unmount();
    }
  });
});

// ─── AC5, round 2: a Project row chosen over the explorer leaves it, and its choice wins ───

describe('US-01M6Q1V9 AC5: a Project row chosen over the main-pane explorer leaves it, and Back then behaves as if it had never been open', () => {
  const PUC19 = SAMPLE_LIBRARY.find((d) => /pUC19/.test(d.name) && d.id !== PET.id)!;
  const TRASHED = SAMPLE_LIBRARY.find((d) => d.id !== PET.id && d.id !== PUC19.id)!;
  // All Project Files last: its click also folds the folder tree that holds the folders and Deleted Items.
  // 'Cloning ★' is the starred copy of the Cloning folder, listed under Favorites outside the folder tree.
  const ROWS = ['Favorites', 'Cloning ★', 'Sample Documents', 'Deleted Items', 'History', 'All Project Files'];
  const projectRow = (app: AppHarness, label: string): LiveElement => {
    if (label !== 'Cloning ★') return row(rowsIn(section(app, 'project')), label).el;
    const starred = rowsIn(section(app, 'project')).filter((r) => r.label === 'Cloning' && !r.el.closest('.tree-indent-1'));
    expect(starred, 'one starred Cloning row').toHaveLength(1);
    return starred[0].el;
  };
  const selectedProjectRow = (app: AppHarness) =>
    rowsIn(section(app, 'project')).filter((r) => (r.el.getAttribute('class') ?? '').split(/\s+/).includes('selected')).map((r) => r.label);
  const state = (app: AppHarness) => ({
    explorer: explorer(app).length, folder: selectedProjectRow(app), doc: activeDocName(app), tab: app.activeTab(),
  });

  /** For each Project row: optionally open the explorer, click the row, record; press ⌘[, record. */
  async function walk(overExplorer: boolean) {
    const app = await mountApp();
    const seen: Array<{ row: string; after: ReturnType<typeof state>; back: ReturnType<typeof state> }> = [];
    try {
      await sampleSession(app, {
        projectExplorer: {
          customFolders: [], folderColors: {}, folderNames: {}, folderParents: {}, hiddenFolders: [],
          favoriteFolders: ['Cloning'], favoriteDocIds: [PUC19.id], deletedDocIds: [TRASHED.id], readDocIds: [],
        },
      });
      expect(activeDocName(app)).toBe(PET.name);
      for (const label of ROWS) {
        if (overExplorer) {
          await app.menu('tools:databases-explorer');
          expectMainPaneExplorer(app, 'ncbi-nucleotide', `before Project › ${label}`);
        }
        await app.click(projectRow(app, label));
        const after = state(app);
        await app.press('[', { mod: true });
        seen.push({ row: label, after, back: state(app) });
      }
    } finally {
      app.unmount();
    }
    return seen;
  }

  it('US-01M6Q1V9 AC5 closes the explorer on Favorites, a starred folder, a folder, Deleted Items, History and All Project Files, keeps the row\'s choice, and ⌘[ then does what it does without the explorer', async () => {
    expect(PUC19, 'the sample library holds pUC19').toBeTruthy();
    const plain = await walk(false);
    const over = await walk(true);
    const byRow = (seen: typeof plain, label: string) => seen.find((s) => s.row === label)!;

    // The reviewer's probe: Favorites over the explorer.
    const fav = byRow(over, 'Favorites');
    expect(fav.after.explorer, 'Project › Favorites leaves the explorer').toBe(0);
    expect(fav.after.folder).toEqual(['Favorites']);
    expect(fav.after.doc, 'the active document is the one in Favorites, never pET-28a').toBe(PUC19.name);
    expect(fav.back.explorer).toBe(0);
    // ⌘[ is then the document Back it is without the explorer (compared below), not the explorer's restore.
    // Project › History over the explorer: History is shown, and ⌘[ does not set the view back to Sequence Map.
    const hist = byRow(over, 'History');
    expect(hist.after.explorer, 'Project › History leaves the explorer').toBe(0);
    expect(hist.after.tab, 'History is shown').toBe('history-hybrid');
    expect(hist.back.explorer).toBe(0);

    // Every row, after the click and after ⌘[, matches the same walk with the explorer never opened.
    for (const label of ROWS) {
      expect(byRow(over, label).after, `Project › ${label} over the explorer`).toEqual(byRow(plain, label).after);
      expect(byRow(over, label).back, `⌘[ after Project › ${label} over the explorer`).toEqual(byRow(plain, label).back);
    }
  });
  it('US-01M6Q1V9 AC5 does not restore the view the explorer opened over when a Project row is chosen after a record is added from it', async () => {
    const app = await mountApp();
    try {
      await sampleSession(app, {
        projectExplorer: {
          customFolders: [], folderColors: {}, folderNames: {}, folderParents: {}, hiddenFolders: [],
          favoriteFolders: [], favoriteDocIds: [PUC19.id], deletedDocIds: [], readDocIds: [],
        },
      });
      await app.clickStudio('annotations');
      expect(app.activeTab(), 'the explorer opens over the Features table').toBe('annotations-table');
      await openLibraries(app);
      await app.click(row(ownRows(group(app, 'databases')), 'UniProt').el);
      expectMainPaneExplorer(app, 'uniprot', 'UniProt');
      const card = app.all('.mbc-db-explorer-pane .mbc-db-record-card')[0];
      await app.click(card.querySelector('button.btn-primary-sm')!);
      await app.click(row(rowsIn(section(app, 'project')), 'Favorites').el);
      expect(explorer(app)).toHaveLength(0);
      expect(activeDocName(app)).toBe(PUC19.name);
      expect(app.activeTab(), 'pUC19 does not open on the view the explorer opened over').not.toBe('annotations-table');
    } finally {
      app.unmount();
    }
  });
});
