// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DV88: Search Project opens from a folder's context menu ("Search Folder…") or from
 * View › Search & Filter › Search Project…, shows the scope it searches and what it does and does
 * not read, and lists the matches grouped by document with path, type, field and marked snippet.
 *
 * Every criterion runs in the mounted App over the live DOM (appHarness), from the App's own menus,
 * so a panel fed the wrong documents or folders by the App fails here even though the core
 * (projectSearch.ts, US-01M7DVC0) is right. The fixture is built so each wrong feed gives another
 * answer: a document in a hidden folder (a panel fed only the visible folders names its path
 * wrongly and leaves it out of its parent's subfolder scope), a document never opened in a tab (a
 * panel fed the open documents misses it), a deleted one, and the sample library (a panel fed the
 * root view's session documents counts fewer).
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { NUCLEOTIDE_MOTIF_STATEMENT, PROTEIN_MOTIF_STATEMENT, TEXT_SEARCH_STATEMENT } from '../core/projectSearch';
import { SEARCH_PAUSE_MS } from '../components/ProjectSearchPanel';
import { inferDocumentTypeLabel } from '../core/workbenchBatchOperations';
import { resolveNativeMenuItemEnabled } from '../core/commandAvailability';
import type { SequenceDocument } from '../types/bio';
import { macHost, mountApp, type AppHarness, type MountOptions, type SessionSpec } from './appHarness';
import { dispatchLiveEvent, type LiveElement } from './liveDom';

// The macOS host's Tauri runtime for AC1's native path; off a macOS host the mock reports none.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

vi.setConfig({ testTimeout: 180_000 });

// ─── Fixtures ───

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: 'ATGC'.repeat(30), moleculeType: 'DNA', topology: 'linear',
  folder: 'Plasmids & Vectors', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  features: [], primers: [], history: [],
};
const docOf = (over: Partial<SequenceDocument> & { id: string; name: string }): SequenceDocument => ({ ...BLANK, ...over });

const HIDDEN = 'Hidden Assays';
const DOCS: SequenceDocument[] = [
  docOf({ id: 'us88-open', name: 'Opened backbone', folder: 'Plasmids & Vectors', topology: 'circular', description: 'a zqvector backbone' }),
  docOf({ id: 'us88-bact', name: 'Bacterial zqisolate', folder: 'Genomes/Bacteria' }),
  docOf({ id: 'us88-fav', name: 'Favourite insert', folder: 'Plasmids & Vectors', description: 'kept zqvector insert' }),
  docOf({ id: 'us88-hidden', name: 'Hidden zqvector assay', folder: HIDDEN }),
  docOf({ id: 'us88-del', name: 'Deleted zqvector draft', folder: 'Plasmids & Vectors' }),
  // Restore opens the active document and the first two; this one is never opened in a tab.
  docOf({
    id: 'us88-never', name: 'Never opened protein', folder: 'Protein Documents', moleculeType: 'Protein', sequence: 'MKTAYIAKQR',
    description: 'carries the ZqLonely motif',
  }),
];
const SESSION_IDS = new Set(DOCS.map((d) => d.id));
const DELETED = ['us88-del'];
const FAVORITES = ['us88-fav'];
const EXPLORER = {
  customFolders: [HIDDEN], folderColors: {}, folderNames: {}, folderParents: { [HIDDEN]: 'Plasmids & Vectors' },
  hiddenFolders: [HIDDEN], favoriteFolders: [], favoriteDocIds: FAVORITES, deletedDocIds: DELETED, readDocIds: [],
};
const SPEC: SessionSpec = {
  documents: DOCS, activeDocId: 'us88-open', viewerTab: 'sequence-view',
  workspace: { projectExplorer: EXPLORER } as SessionSpec['workspace'],
};

/** Counted by hand from the fixture and the sample library, never through the core. */
const liveSample = SAMPLE_LIBRARY.filter((s) => !SESSION_IDS.has(s.id));
const ENTIRE = DOCS.filter((d) => !DELETED.includes(d.id)).length + liveSample.length;
const PV_SAMPLE = liveSample.filter((s) => s.folder === 'Plasmids & Vectors').length;
/** Plasmids & Vectors only: Opened backbone and Favourite insert (the deleted draft is not live). */
const PV_ONLY = 2 + PV_SAMPLE;
/** Plasmids & Vectors and subfolders: also the hidden child's assay. */
const PV_SUB = PV_ONLY + 1;
const BACT = 1 + liveSample.filter((s) => s.folder === 'Genomes/Bacteria').length;

// ─── Driving the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);

async function withSession(spec: SessionSpec, run: (app: AppHarness) => Promise<void>, opts: MountOptions = {}): Promise<void> {
  const app = await mountApp(opts);
  try {
    await app.restoreSession(spec);
    await run(app);
  } finally {
    app.unmount();
  }
}

const menuButtons = (app: AppHarness) => app.all('.desktop-menu-popup').flatMap((p) => p.querySelectorAll('button'));
async function openMenu(app: AppHarness, path: string[]): Promise<LiveElement> {
  const [top, ...rest] = path;
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => nameOf(b) === top || words(b.textContent) === top);
  if (!trigger) throw new Error(`the menu bar has no ${top} menu`);
  await app.click(trigger);
  let item: LiveElement | undefined;
  for (const label of rest) {
    item = menuButtons(app).find((b) => {
      const t = words(b.textContent);
      const after = t.slice(label.length).trim();
      return t.startsWith(label) && (after.length < 3 || /^(Ctrl|Shift|Alt|[⌘⇧⌥⌃])/.test(after));
    });
    if (!item) throw new Error(`no "${label}" in the open menu: ${menuButtons(app).map((b) => words(b.textContent)).join(' | ')}`);
    if (label !== rest[rest.length - 1]) await app.click(item);
  }
  return item!;
}

/** The explorer row that shows `label` (the folder tree, Favorites, All Project Files, Deleted Items). */
function folderRow(app: AppHarness, label: string): LiveElement {
  const rows = app.all('.mbc-sources-pane button.source-folder-row')
    .filter((b) => words(b.querySelector('.folder-label')?.textContent) === label);
  if (rows.length < 1) throw new Error(`no explorer row "${label}"`);
  return rows[rows.length - 1];
}

/** Right-clicks the explorer row `label` and picks Search Folder… from its context menu. */
async function searchFolder(app: AppHarness, label: string) {
  const row = folderRow(app, label);
  // The harness has no right-click; the browser's own contextmenu event reaches the row's handler.
  await React.act(async () => { dispatchLiveEvent(row, 'contextmenu', { bubbles: true, cancelable: true }); });
  await app.settle();
  const item = menuButtons(app).find((b) => words(b.textContent).startsWith('Search Folder…'));
  if (!item) throw new Error(`no Search Folder… in the context menu of ${label}: ${menuButtons(app).map((b) => words(b.textContent)).join(' | ')}`);
  await app.click(item);
}

const panels = (app: AppHarness) => app.all('[role="dialog"][aria-label="Search Project"]');
const panel = (app: AppHarness) => app.one('[role="dialog"][aria-label="Search Project"]', 'the Search Project panel');
const scopeLabel = (app: AppHarness) => words(panel(app).querySelector('[data-search-scope-label]')?.textContent);
const scopeRadios = (app: AppHarness) => panel(app).querySelectorAll('input[type="radio"]');
type Radio = { value: string; checked: boolean };
const scopeNames = (app: AppHarness) => scopeRadios(app).map((r) => (r as unknown as Radio).value);
const checkedScope = (app: AppHarness) => scopeRadios(app).filter((r) => (r as unknown as Radio).checked).map((r) => (r as unknown as Radio).value);
const summary = (app: AppHarness) => words(panel(app).querySelector('[data-search-summary]')?.textContent);
const pager = (app: AppHarness) => words(panel(app).querySelector('[data-search-pager-range]')?.textContent);
const groups = (app: AppHarness) => panel(app).querySelectorAll('[data-search-group]');
const part = (el: LiveElement, name: string) => words(el.querySelector(`[data-part="${name}"]`)?.textContent);
const queryField = (app: AppHarness) => app.one('[role="dialog"][aria-label="Search Project"] input[aria-label="Search text"]', 'the search field');
async function chooseScope(app: AppHarness, scope: string) {
  const radio = scopeRadios(app).find((r) => (r as unknown as Radio).value === scope);
  if (!radio) throw new Error(`the panel offers no scope ${scope}: ${scopeNames(app).join(', ')}`);
  await app.change(radio, true);
  await finishSearch(app, 0);
}
const groupFor = (app: AppHarness, name: string) => {
  const found = groups(app).filter((g) => part(g, 'name') === name);
  if (found.length !== 1) throw new Error(`expected one group "${name}", found ${found.length}: ${groups(app).map((g) => part(g, 'name')).join(', ')}`);
  return found[0];
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// ─── Waiting for a search (US-01M7DVVS) ───

const cancelButtons = (app: AppHarness) => panel(app).querySelectorAll('button').filter((b) => nameOf(b) === 'Cancel search');
/**
 * One run step: the timer task the run yields to between two documents. The fake clock schedules
 * a zero-delay timer set while another timer fires 1 ms on, so a step advances 1 ms; the sync
 * advance runs no promise continuation, so it never runs two steps.
 */
const STEP_MS = 1;
async function stepSearch(app: AppHarness) {
  await React.act(async () => { vi.advanceTimersByTime(STEP_MS); });
  await app.settle();
}
/**
 * Lets the pause after an input pass and steps the run it starts to its end, as a user waiting
 * would. A change of scope or Both strands starts its run at once, so it waits no pause (`pause` 0):
 * a panel that paused there would show no run to step and fail the assertion after it.
 */
async function finishSearch(app: AppHarness, pause = SEARCH_PAUSE_MS) {
  await React.act(async () => { vi.advanceTimersByTime(pause); });
  for (let i = 0; panels(app).length > 0 && cancelButtons(app).length > 0; i++) {
    if (i > 10_000) throw new Error('the search never finished');
    await React.act(async () => { vi.advanceTimersByTime(STEP_MS); });
  }
  await app.settle();
}
/** Types `value` into the search field and waits for its search to finish. */
async function typeQuery(app: AppHarness, field: LiveElement, value: string) {
  await app.input(field, value);
  await finishSearch(app);
}

// ─── AC1 ───

describe('US-01M7DV88 AC1: Search Folder… and Search Project… open the panel on its scope', () => {
  it('US-01M7DV88 AC1 opens each folder on its first offered wider scope, under the core label', async () => {
    await withSession(SPEC, async (app) => {
      expect(panels(app), 'no panel before it is asked for').toHaveLength(0);
      const cases: [string, string, string][] = [
        ['Bacteria', 'Folder and subfolders', 'Sample Documents › Genomes › Bacteria and subfolders'],
        ['All Project Files', 'Folder and subfolders', 'Entire project'],
        ['Favorites', 'This folder only', 'Favorites only'],
        ['Deleted Items', 'This folder only', 'Deleted Items (trash)'],
      ];
      for (const [row, scope, label] of cases) {
        await searchFolder(app, row);
        expect(panels(app), `one panel from ${row}`).toHaveLength(1);
        expect(checkedScope(app), `${row} opens on ${scope}`).toEqual([scope]);
        expect(scopeLabel(app), `${row}'s scope label`).toBe(label);
      }
    });
  });

  it('US-01M7DV88 AC1 View › Search & Filter › Search Project… opens it on the entire project', async () => {
    await withSession(SPEC, async (app) => {
      // From a folder first, so the View item is seen to move the panel to the entire project.
      await searchFolder(app, 'Bacteria');
      expect(scopeLabel(app)).toBe('Sample Documents › Genomes › Bacteria and subfolders');
      const item = await openMenu(app, ['View', 'Search & Filter', 'Search Project…']);
      expect(item.hasAttribute('disabled'), 'Search Project… is enabled with a session').toBe(false);
      await app.click(item);
      expect(panels(app)).toHaveLength(1);
      expect(checkedScope(app)).toEqual(['Entire project']);
      expect(scopeLabel(app)).toBe('Entire project');
    });
  });

  it('US-01M7DV88 AC1 the native item waits for a session and, run without one, says so and opens nothing', async () => {
    const app = await mountApp(macHost());
    try {
      const before = app.nativeMenuStates();
      expect(before.length, 'the App sent a menu state').toBeGreaterThan(0);
      expect(resolveNativeMenuItemEnabled('view:search-project', before[before.length - 1]), 'disabled with no session').toBe(false);
      await app.menu('view:search-project');
      expect(app.doc.body.textContent, 'the no-session banner').toContain('No active session');
      expect(panels(app), 'no panel without a session').toHaveLength(0);

      await app.restoreSession(SPEC);
      const after = app.nativeMenuStates();
      expect(resolveNativeMenuItemEnabled('view:search-project', after[after.length - 1]), 'enabled with a session').toBe(true);
      await app.menu('view:search-project');
      expect(panels(app)).toHaveLength(1);
      expect(scopeLabel(app)).toBe('Entire project');

      // Closing the session closes the panel, and the next session does not bring it back.
      await app.menu('file:close-session');
      expect(panels(app), 'no panel once the session is closed').toHaveLength(0);
      await app.restoreSession(SPEC);
      expect(panels(app), 'a new session opens no panel by itself').toHaveLength(0);
    } finally {
      app.unmount();
    }
  });
});

// ─── AC2 ───

describe('US-01M7DV88 AC2: the offered scopes, the label, the statements and the catalog count', () => {
  it('US-01M7DV88 AC2 shows the offered scopes and statements, and reruns the query on a scope change', async () => {
    await withSession(SPEC, async (app) => {
      await searchFolder(app, 'Plasmids & Vectors');
      expect(scopeNames(app)).toEqual(['This folder only', 'Folder and subfolders', 'Entire project']);
      expect(words(panel(app).textContent), 'the core statement, word for word').toContain(TEXT_SEARCH_STATEMENT);
      expect(scopeLabel(app)).toBe('Sample Documents › Plasmids & Vectors and subfolders');

      await typeQuery(app, queryField(app), 'zqvector');
      // The hidden child's assay is in the subfolder scope only when the App passes every folder.
      expect(summary(app)).toBe(`3 hits in 3 documents · ${PV_SUB} documents searched`);
      expect(groups(app).map((g) => part(g, 'name')).sort()).toEqual(['Favourite insert', 'Hidden zqvector assay', 'Opened backbone']);

      await chooseScope(app, 'This folder only');
      expect(scopeLabel(app)).toBe('Sample Documents › Plasmids & Vectors only');
      expect(summary(app), 'the query reruns on the new scope').toBe(`2 hits in 2 documents · ${PV_ONLY} documents searched`);

      await chooseScope(app, 'Entire project');
      expect(scopeLabel(app)).toBe('Entire project');
      expect(summary(app)).toBe(`3 hits in 3 documents · ${ENTIRE} documents searched`);

      for (const row of ['Favorites', 'Deleted Items']) {
        await searchFolder(app, row);
        expect(scopeNames(app), `${row} offers its own folder only`).toEqual(['This folder only']);
        expect(words(panel(app).textContent)).toContain(TEXT_SEARCH_STATEMENT);
        // One favourite, and one deleted document (in the catalog the App passes, deleted ones included).
        expect(summary(app), `${row} searches its one document`).toBe('Type text to search 1 document');
      }
      await typeQuery(app, queryField(app), 'zqvector');
      expect(summary(app)).toBe('1 hit in 1 document · 1 document searched');
      expect(groups(app).map((g) => part(g, 'name'))).toEqual(['Deleted zqvector draft']);
    });
  });

  it('US-01M7DV88 AC2 searches the whole catalog: the sample library, a never-opened document and hidden folders', async () => {
    await withSession(SPEC, async (app) => {
      // The never-opened document is not in a tab (restore opens the active one and the first two).
      const tabs = app.all('.mbc-doc-tab-title').map((t) => words(t.textContent));
      expect(tabs, 'the open tabs').toContain('Opened backbone');
      expect(tabs, 'never opened').not.toContain('Never opened protein');
      await searchFolder(app, 'All Project Files');
      await typeQuery(app, queryField(app), 'zqlonely');
      expect(summary(app)).toBe(`1 hit in 1 document · ${ENTIRE} documents searched`);
      expect(part(groupFor(app, 'Never opened protein'), 'path')).toBe('Sample Documents › Protein Documents');

      // A document in a hidden folder is found under its full path.
      await typeQuery(app, queryField(app), 'hidden zqvector');
      expect(part(groupFor(app, 'Hidden zqvector assay'), 'path')).toBe('Sample Documents › Plasmids & Vectors › Hidden Assays');

      await typeQuery(app, queryField(app), 'zqisolate');
      expect(summary(app)).toBe(`1 hit in 1 document · ${ENTIRE} documents searched`);
      await searchFolder(app, 'Bacteria');
      await typeQuery(app, queryField(app), 'zqisolate');
      expect(summary(app)).toBe(`1 hit in 1 document · ${plural(BACT, 'document')} searched`);
    });
  });
});

// ─── AC3 ───

const PROBES = (n: number) => Array.from({ length: n }, (_, i) =>
  docOf({ id: `us88-probe-${String(i).padStart(3, '0')}`, name: `Probe ${String(i).padStart(3, '0')} zqprobe`, folder: 'Primers' }));

describe('US-01M7DV88 AC3: grouped results, marked snippets, the header and paging', () => {
  it('US-01M7DV88 AC3 groups each document with name, path, type and hit count, and marks the matched text as written', async () => {
    await withSession(SPEC, async (app) => {
      await searchFolder(app, 'All Project Files');
      await typeQuery(app, queryField(app), 'ZQVECTOR');
      expect(summary(app)).toBe(`3 hits in 3 documents · ${ENTIRE} documents searched`);
      expect(groups(app)).toHaveLength(3);
      const opened = groupFor(app, 'Opened backbone');
      expect(part(opened, 'path')).toBe('Sample Documents › Plasmids & Vectors');
      expect(part(opened, 'type')).toBe(inferDocumentTypeLabel(DOCS[0]));
      expect(part(opened, 'hits')).toBe('1 hit');
      const hits = opened.querySelectorAll('[data-search-hit]');
      expect(hits).toHaveLength(1);
      expect(part(hits[0], 'field')).toBe('Description');
      // The mark holds the value's own letters, not the query's.
      expect(hits[0].querySelectorAll('mark').map((m) => m.textContent)).toEqual(['zqvector']);
      expect(part(hits[0], 'snippet')).toBe('a zqvector backbone');

      await typeQuery(app, queryField(app), 'zqlonely');
      const never = groupFor(app, 'Never opened protein');
      expect(part(never, 'type')).toBe(inferDocumentTypeLabel(DOCS[5]));
      expect(part(never, 'type')).not.toBe(part(opened, 'type'));
      expect(never.querySelectorAll('mark').map((m) => m.textContent)).toEqual(['ZqLonely']);

      // Two hits in one document: the name and the description, counted per document.
      await typeQuery(app, queryField(app), 'insert');
      const fav = groupFor(app, 'Favourite insert');
      expect(part(fav, 'hits')).toBe('2 hits');
      expect(fav.querySelectorAll('[data-search-hit]').map((h) => part(h, 'field'))).toEqual(['Name', 'Description']);
    });
  });

  it('US-01M7DV88 AC3 pages groups 50 at a time and never shows the page as the total', async () => {
    const probes = PROBES(130);
    const spec: SessionSpec = { documents: [...DOCS, ...probes], activeDocId: 'us88-open', viewerTab: 'sequence-view', workspace: SPEC.workspace };
    await withSession(spec, async (app) => {
      await searchFolder(app, 'All Project Files');
      const total = ENTIRE + 130;
      await typeQuery(app, queryField(app), 'zqprobe');
      expect(summary(app), 'the header counts every group, not the page').toBe(`130 hits in 130 documents · ${total} documents searched`);
      expect(pager(app)).toBe('Groups 1-50 of 130');
      expect(groups(app)).toHaveLength(50);
      const next = panel(app).querySelectorAll('button').filter((b) => nameOf(b) === 'Next');
      expect(next).toHaveLength(1);
      await app.click(next[0]);
      expect(pager(app)).toBe('Groups 51-100 of 130');
      expect(groups(app).map((g) => part(g, 'name'))[0]).toBe('Probe 050 zqprobe');
      await app.click(panel(app).querySelectorAll('button').filter((b) => nameOf(b) === 'Next')[0]);
      expect(pager(app)).toBe('Groups 101-130 of 130');
      expect(groups(app)).toHaveLength(30);
      expect(summary(app)).toBe(`130 hits in 130 documents · ${total} documents searched`);
      // Previous goes back a page.
      await app.click(panel(app).querySelectorAll('button').filter((b) => nameOf(b) === 'Previous')[0]);
      expect(pager(app)).toBe('Groups 51-100 of 130');

      // A narrower query starts again on its first page, under 100 groups.
      await typeQuery(app, queryField(app), 'probe 0');
      expect(summary(app)).toBe(`100 hits in 100 documents · ${total} documents searched`);
      expect(pager(app)).toBe('Groups 1-50 of 100');
      await app.click(panel(app).querySelectorAll('button').filter((b) => nameOf(b) === 'Next')[0]);
      expect(pager(app)).toBe('Groups 51-100 of 100');
      // 50 groups or fewer need no pages.
      await typeQuery(app, queryField(app), 'probe 00');
      expect(summary(app)).toBe(`10 hits in 10 documents · ${total} documents searched`);
      expect(panel(app).querySelectorAll('[data-search-pager-range]')).toHaveLength(0);
    });
  });
});

// ─── AC4 ───

describe('US-01M7DV88 AC4: no hits, an empty scope and an empty query are told apart', () => {
  it('US-01M7DV88 AC4 names no matches, an empty scope and an empty query by their own sentences', async () => {
    const spec: SessionSpec = { ...SPEC, workspace: { projectExplorer: { ...EXPLORER, favoriteDocIds: [] } } as SessionSpec['workspace'] };
    await withSession(spec, async (app) => {
      await searchFolder(app, 'Bacteria');
      expect(summary(app), 'no query yet').toBe(`Type text to search ${BACT} documents`);
      await app.input(queryField(app), '   ');
      expect(summary(app), 'a whitespace query runs no search').toBe(`Type text to search ${BACT} documents`);
      expect(groups(app)).toHaveLength(0);
      await typeQuery(app, queryField(app), 'zqnothing');
      expect(summary(app)).toBe(`No matches in ${BACT} documents searched`);
      await app.input(queryField(app), '');
      expect(summary(app)).toBe(`Type text to search ${BACT} documents`);

      await searchFolder(app, 'Favorites');
      expect(summary(app)).toBe('No documents in Favorites only');
      await typeQuery(app, queryField(app), 'zqvector');
      expect(summary(app)).toBe('No documents in Favorites only');
      expect(words(panel(app).textContent)).not.toContain('No matches in 0 documents searched');
    });
  });
});

// ─── US-01M7DVE7: motif mode ───
//
// The motif fixture lives in its own folder, Motif Lab, so each count is the fixture's and no
// sample-library document is in scope. Each document is built to tell a wrong panel apart: an RNA
// site on the reverse strand (a panel that writes the reverse complement shows CCTAAG, not CUUAGG),
// two circular sites across the origin (a panel that drops the topology finds neither; one that
// slices start..end shows no letters), a palindromic site (a plain "+" fails), a document with more
// than 1,000 hits (a panel counting its listed hits says 1,000), and alignments, a tree, a text
// document and an enzyme set that all carry GAATTC in `sequence` (a panel that searches whatever has
// letters lists them as hits). The engine is the real WASM; only AC4's unavailable-engine case
// swaps it, through the override below.

const engineOverride = vi.hoisted(() => ({ current: null as null | ((...args: unknown[]) => unknown) }));
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return {
    ...actual,
    searchIupacMotifRust: (...args: Parameters<typeof actual.searchIupacMotifRust>) =>
      (engineOverride.current ? engineOverride.current(...args) : actual.searchIupacMotifRust(...args)),
  };
});

const LAB = 'Motif Lab';
const lab = (over: Partial<SequenceDocument> & { id: string; name: string }) => docOf({ folder: LAB, ...over });
const MOTIF_DOCS: SequenceDocument[] = [
  // First, so a refusal that stopped the search would leave every later document unsearched.
  lab({ id: 'm-short', name: 'Short DNA', sequence: 'ACGTAC' }),
  lab({ id: 'm-rna', name: 'RNA reverse site', moleculeType: 'RNA', sequence: 'AAAACUUAGGAAAA' }),
  lab({ id: 'm-eco', name: 'Circular EcoRI origin', topology: 'circular', sequence: `TTC${'A'.repeat(2994)}GAA` }),
  lab({ id: 'm-bsa', name: 'Circular BsaI origin', topology: 'circular', sequence: `CTC${'A'.repeat(2994)}GGT` }),
  lab({ id: 'm-many', name: 'Many GAATTC sites', sequence: 'GAATTC'.repeat(1100) }),
  lab({ id: 'm-ambig', name: 'Ambiguous only', sequence: 'CCCCGAANTCCCCC' }),
  lab({ id: 'm-mixed', name: 'Mixed certainty', sequence: 'GAATTCAAAGAATNCAAA' }),
  lab({ id: 'm-pgac', name: 'Protein with GAC', moleculeType: 'Protein', sequence: 'MKGACWW' }),
  lab({ id: 'm-pgtc', name: 'Protein with GTC', moleculeType: 'Protein', sequence: 'MKGTCWW' }),
  lab({ id: 'm-pamb', name: 'Protein ambiguous', moleculeType: 'Protein', sequence: 'MKGXCWW' }),
  lab({ id: 'm-alnk', name: 'Alignment by kind', documentKind: 'alignment', sequence: 'GAATTCGAATTC' }),
  lab({
    id: 'm-alnm', name: 'Alignment by rows', sequence: 'GAATTCGAATTC',
    alignmentMeta: { sequences: [{ id: 'r1', name: 'r1', sequence: 'GAATTCGAATTC' }, { id: 'r2', name: 'r2', sequence: 'GAATTCGAATTA' }] },
  }),
  lab({ id: 'm-tree', name: 'Lab tree', sequence: 'GAATTC', docMetadata: { Newick: '(a,b);' } }),
  lab({ id: 'm-text', name: 'Lab notes', sequence: 'GAATTC', docMetadata: { 'Document Type': 'Text Document' } }),
  lab({ id: 'm-enz', name: 'Lab enzymes', sequence: 'GAATTC', docMetadata: { 'Document Type': 'Enzyme Set' } }),
  lab({ id: 'm-contig', name: 'Contig summary', sequence: '', docMetadata: { 'Is Contig Summary': 'yes', 'Declared Length': '5000' } }),
  lab({ id: 'm-empty', name: 'Empty record', sequence: '' }),
];
const MOTIF_SPEC: SessionSpec = {
  documents: MOTIF_DOCS, activeDocId: 'm-short', viewerTab: 'sequence-view',
  workspace: { projectExplorer: { ...EXPLORER, customFolders: [LAB], folderParents: {}, hiddenFolders: [] } } as SessionSpec['workspace'],
};
/** The reasons AC4 names for the kinds no motif mode reads, by document. */
const KIND_REASONS: Record<string, string> = {
  'Alignment by kind': 'alignment (motif search reads single sequences)',
  'Alignment by rows': 'alignment (motif search reads single sequences)',
  'Lab tree': 'tree (no sequence)',
  'Lab notes': 'text document (no sequence)',
  'Lab enzymes': 'enzyme set (no sequence)',
  'Contig summary': 'contig summary (annotations only, no bases)',
  'Empty record': 'empty sequence',
};
const PROTEINS = ['Protein with GAC', 'Protein with GTC', 'Protein ambiguous'];
const NUCLEIC = ['Short DNA', 'RNA reverse site', 'Circular EcoRI origin', 'Circular BsaI origin', 'Many GAATTC sites', 'Ambiguous only', 'Mixed certainty'];

const modeSelect = (app: AppHarness) => app.one('[role="dialog"][aria-label="Search Project"] select[aria-label="Search mode"]', 'the Search mode select');
const motifField = (app: AppHarness) => app.one('[role="dialog"][aria-label="Search Project"] input[aria-label="Search motif"]', 'the motif field');
const checkbox = (app: AppHarness, label: string) => {
  const found = panel(app).querySelectorAll('label').filter((l) => words(l.textContent) === label).flatMap((l) => l.querySelectorAll('input[type="checkbox"]'));
  if (found.length !== 1) throw new Error(`expected one "${label}" checkbox, found ${found.length}`);
  return found[0];
};
const isChecked = (el: LiveElement) => (el as unknown as Radio).checked;
const statement = (app: AppHarness) => words(panel(app).querySelector('.mbc-project-search-fields')?.textContent);
const skips = (app: AppHarness) => Object.fromEntries(panel(app).querySelectorAll('[data-search-skip]').map((s) => [part(s, 'name'), part(s, 'reason')]));
const hitRows = (group: LiveElement) => group.querySelectorAll('[data-search-hit]')
  .map((h) => [part(h, 'coords'), part(h, 'strand'), part(h, 'letters'), part(h, 'certainty')]);
const groupNames = (app: AppHarness) => groups(app).map((g) => part(g, 'name')).sort();
async function openLab(app: AppHarness, mode?: string) {
  await searchFolder(app, LAB);
  if (mode) await app.change(modeSelect(app), mode);
}

describe('US-01M7DVE7 AC1: the Search mode select, its statements and Text mode unchanged', () => {
  it('US-01M7DVE7 AC1 offers Text, Nucleotide motif and Protein motif, Text the default, and the scope radios stay the only radios', async () => {
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app);
      const select = modeSelect(app);
      expect(select.querySelectorAll('option').map((o) => words(o.textContent))).toEqual(['Text', 'Nucleotide motif', 'Protein motif']);
      expect((select as unknown as { value: string }).value).toBe('Text');
      expect(statement(app)).toBe(TEXT_SEARCH_STATEMENT);
      for (const mode of ['Text', 'Nucleotide motif', 'Protein motif']) {
        await app.change(select, mode);
        const radios = panel(app).querySelectorAll('input[type="radio"]');
        expect(radios.map((r) => (r as unknown as Radio).value), `${mode}: the radios are the scopes`).toEqual(scopeNames(app));
        expect(radios.map((r) => r.getAttribute('name')), `${mode}: one radio group`).toEqual(radios.map(() => 'mbc-project-search-scope'));
      }

      // Nucleotide letters in Text mode are text: only the name that holds them is found.
      await app.change(select, 'Text');
      await typeQuery(app, queryField(app), 'GAATTC');
      expect(summary(app)).toBe(`1 hit in 1 document · ${MOTIF_DOCS.length} documents searched`);
      expect(groupNames(app)).toEqual(['Many GAATTC sites']);
      expect(groups(app)[0].querySelectorAll('[data-search-hit]').map((h) => part(h, 'field'))).toEqual(['Name']);
      expect(panel(app).querySelectorAll('[data-search-not-searched]')).toHaveLength(0);
    });
  });

  it('US-01M7DVE7 AC1 shows each motif statement word for word in place of the text one, and an empty motif query asks for a motif', async () => {
    expect(NUCLEOTIDE_MOTIF_STATEMENT).toBe('Motif search reads the bases of each DNA and RNA document by IUPAC codes, on both strands when Both strands is on, and across the origin of a circular molecule. A hit is definite when every base is one the motif allows there, and possible when an ambiguous base in the document, such as N, may or may not be one. Not searched in this mode: protein documents, alignments, trees, text documents, enzyme sets and contig summaries.');
    expect(PROTEIN_MOTIF_STATEMENT).toBe('Motif search reads the residues of each protein document by IUPAC codes (B, Z, J, X), on one strand. A hit is definite when every residue is one the motif allows there, and possible when an ambiguous residue in the document, such as X, may or may not be one. Not searched in this mode: DNA and RNA documents (translated search is not available), alignments, trees, text documents, enzyme sets and contig summaries.');
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Nucleotide motif');
      expect(statement(app)).toBe(NUCLEOTIDE_MOTIF_STATEMENT);
      expect(words(panel(app).textContent)).not.toContain(TEXT_SEARCH_STATEMENT);
      // Seven DNA and RNA documents are read in this mode; the empty record is not.
      expect(summary(app)).toBe(`Type a motif to search ${NUCLEIC.length} documents`);
      await app.input(motifField(app), '   ');
      expect(summary(app)).toBe(`Type a motif to search ${NUCLEIC.length} documents`);
      expect(groups(app)).toHaveLength(0);

      await app.change(modeSelect(app), 'Protein motif');
      expect(statement(app)).toBe(PROTEIN_MOTIF_STATEMENT);
      expect(words(panel(app).textContent)).not.toContain(NUCLEOTIDE_MOTIF_STATEMENT);
      expect(summary(app)).toBe(`Type a motif to search ${PROTEINS.length} documents`);

      await app.change(modeSelect(app), 'Text');
      expect(statement(app)).toBe(TEXT_SEARCH_STATEMENT);
    });
  });
});

describe('US-01M7DVE7 AC2: each hit with coordinates, strand, letters and certainty, the counts and Definite only', () => {
  it('US-01M7DVE7 AC2 shows a reverse-strand RNA site in U, origin-crossing sites read across the origin, and the palindrome', async () => {
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Nucleotide motif');
      expect(isChecked(checkbox(app, 'Both strands')), 'Both strands is on by default').toBe(true);
      expect(isChecked(checkbox(app, 'Definite only'))).toBe(false);

      await typeQuery(app, motifField(app), 'CCTAAG');
      expect(groupNames(app)).toEqual(['RNA reverse site']);
      expect(hitRows(groupFor(app, 'RNA reverse site'))).toEqual([['5-10', '−', 'CUUAGG', 'definite']]);
      // The reverse strand is searched only while Both strands is on.
      await app.change(checkbox(app, 'Both strands'), false);
      await finishSearch(app, 0);
      expect(groups(app)).toHaveLength(0);
      expect(summary(app)).toBe(`No matches in ${NUCLEIC.length} documents searched · 10 not searched`);
      await app.change(checkbox(app, 'Both strands'), true);
      await finishSearch(app, 0);

      await typeQuery(app, motifField(app), 'GAGACC');
      expect(hitRows(groupFor(app, 'Circular BsaI origin'))).toEqual([['2998-3', '−', 'GGTCTC', 'definite']]);

      await typeQuery(app, motifField(app), 'GAATTC');
      expect(hitRows(groupFor(app, 'Circular EcoRI origin'))).toEqual([['2998-3', '+ palindrome', 'GAATTC', 'definite']]);
      expect(hitRows(groupFor(app, 'Mixed certainty'))).toEqual([
        ['1-6', '+ palindrome', 'GAATTC', 'definite'],
        ['10-15', '+ palindrome', 'GAATNC', 'possible'],
      ]);
      expect(part(groupFor(app, 'Mixed certainty'), 'hits')).toBe('2 hits (1 definite, 1 possible)');
    });
  });

  it('US-01M7DVE7 AC2 counts the whole molecule, lists at most 1,000 hits with the warning, and Definite only hides the possible ones', async () => {
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Nucleotide motif');
      await typeQuery(app, motifField(app), 'GAATTC');
      expect(groupNames(app)).toEqual(['Ambiguous only', 'Circular EcoRI origin', 'Many GAATTC sites', 'Mixed certainty']);
      const many = groupFor(app, 'Many GAATTC sites');
      expect(part(many, 'hits'), 'the engine counts, not the listed hits').toBe('1,100 hits (1,100 definite, 0 possible)');
      expect(part(many, 'warning')).toBe('Showing the first 1,000 of 1,100 hits.');
      expect(many.querySelectorAll('[data-search-hit]')).toHaveLength(1000);
      expect(hitRows(many)[999]).toEqual(['5995-6000', '+ palindrome', 'GAATTC', 'definite']);
      expect(part(groupFor(app, 'Ambiguous only'), 'hits')).toBe('1 hit (0 definite, 1 possible)');
      expect(summary(app)).toBe(`1,104 hits in 4 documents · ${NUCLEIC.length} documents searched · 10 not searched`);
      expect(panel(app).querySelectorAll('[data-part="warning"]'), 'only the cut document warns').toHaveLength(1);

      await app.change(checkbox(app, 'Definite only'), true);
      expect(groupNames(app), 'a document of possible hits only leaves the list').toEqual(['Circular EcoRI origin', 'Many GAATTC sites', 'Mixed certainty']);
      expect(hitRows(groupFor(app, 'Mixed certainty'))).toEqual([['1-6', '+ palindrome', 'GAATTC', 'definite']]);
      expect(summary(app)).toBe(`1,102 hits in 3 documents · ${NUCLEIC.length} documents searched · 10 not searched · 2 possible hits hidden`);
      await app.change(checkbox(app, 'Definite only'), false);
      expect(groupNames(app)).toHaveLength(4);
    });
  });
});

describe('US-01M7DVE7 AC3: Protein motif reads protein documents on one strand', () => {
  it('US-01M7DVE7 AC3 searches only proteins, never their reverse complement, and lists DNA and RNA as not searched', async () => {
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Protein motif');
      expect(panel(app).querySelectorAll('label').filter((l) => words(l.textContent) === 'Both strands'), 'no strand choice for proteins').toHaveLength(0);
      await typeQuery(app, motifField(app), 'GAC');
      // GTC is GAC's reverse complement: a panel that reverse-complements finds Protein with GTC.
      expect(groupNames(app)).toEqual(['Protein ambiguous', 'Protein with GAC']);
      expect(hitRows(groupFor(app, 'Protein with GAC'))).toEqual([['3-5', '+', 'GAC', 'definite']]);
      expect(hitRows(groupFor(app, 'Protein ambiguous'))).toEqual([['3-5', '+', 'GXC', 'possible']]);
      expect(summary(app)).toBe(`2 hits in 2 documents · ${PROTEINS.length} documents searched · 14 not searched`);
      expect(skips(app)).toEqual({
        ...Object.fromEntries(NUCLEIC.map((n) => [n, 'translated search is not available'])),
        ...KIND_REASONS,
      });
    });
  });
});

describe('US-01M7DVE7 AC4: not searched, refusals and an engine that cannot run, each told apart', () => {
  it('US-01M7DVE7 AC4 lists each kind it does not read with its reason, counted apart from the documents searched', async () => {
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Nucleotide motif');
      await typeQuery(app, motifField(app), 'GAATTC');
      expect(skips(app)).toEqual({
        ...Object.fromEntries(PROTEINS.map((n) => [n, 'protein sequence (use Protein motif)'])),
        ...KIND_REASONS,
      });
      expect(words(panel(app).querySelector('[data-search-not-searched] h3')?.textContent)).toBe('Not searched');
      expect(summary(app)).toBe(`1,104 hits in 4 documents · ${NUCLEIC.length} documents searched · 10 not searched`);
      for (const name of [...PROTEINS, ...Object.keys(KIND_REASONS)]) {
        expect(groups(app).filter((g) => part(g, 'name') === name), `${name} has no hit group`).toHaveLength(0);
      }

      // A document the engine refuses is listed with its reason, and the others are still searched after it.
      await typeQuery(app, motifField(app), 'GAATTCAA');
      expect(skips(app)['Short DNA']).toBe('query longer than the sequence (8 > 6)');
      expect(Object.keys(skips(app))).toHaveLength(11);
      expect(groupNames(app)).toEqual(['Circular EcoRI origin', 'Mixed certainty']);
      expect(hitRows(groupFor(app, 'Circular EcoRI origin'))).toEqual([['2998-5', '+', 'GAATTCAA', 'definite']]);
      expect(summary(app)).toBe(`3 hits in 2 documents · ${NUCLEIC.length - 1} documents searched · 11 not searched`);
      await typeQuery(app, motifField(app), 'CGCGCGCG');
      expect(summary(app), 'no matches counts only the searched').toBe(`No matches in ${NUCLEIC.length - 1} documents searched · 11 not searched`);
    });
  });

  it('US-01M7DVE7 AC4 shows a refused query once and lists no document', async () => {
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Nucleotide motif');
      await typeQuery(app, motifField(app), 'GAAXTC');
      expect(summary(app)).toBe("This motif cannot be searched: query letter 'X' is not a nucleotide code");
      const text = words(panel(app).textContent);
      expect(text.split('query letter').length - 1, 'the refusal is told once').toBe(1);
      expect(groups(app)).toHaveLength(0);
      expect(panel(app).querySelectorAll('[data-search-skip]')).toHaveLength(0);
      expect(text).not.toMatch(/No matches|searched ·|not searched ·/);

      await app.change(modeSelect(app), 'Protein motif');
      await typeQuery(app, motifField(app), 'MK1');
      expect(summary(app)).toBe("This motif cannot be searched: query letter '1' is not a protein code");
      expect(panel(app).querySelectorAll('[data-search-skip]')).toHaveLength(0);
    });
  });

  it('US-01M7DVE7 AC4 says the motif engine is not available when the op is unknown or the WASM fails, and lists no document', async () => {
    const real = await vi.importActual<typeof import('../lib/rustBioEngine')>('../lib/rustBioEngine');
    const cases: [string, (...args: unknown[]) => unknown, string][] = [
      // A build without the op: the real engine's own answer to an op it does not know.
      ['stale engine', (seq, query) => real.invokeRustBioSync('search_iupac_motif_not_built', { seq, query }),
        "The motif engine is not available: Unknown MolBioCraft Rust bioinformatics RPC operation: 'search_iupac_motif_not_built'"],
      ['WASM fails to load', () => { throw new WebAssembly.CompileError('WebAssembly.Module(): expected magic word'); },
        'The motif engine is not available: WebAssembly.Module(): expected magic word'],
    ];
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Nucleotide motif');
      try {
        for (const [what, engine, said] of cases) {
          engineOverride.current = engine;
          await typeQuery(app, motifField(app), what === 'stale engine' ? 'GAATTC' : 'GAGACC');
          expect(summary(app), what).toBe(said);
          expect(groups(app), what).toHaveLength(0);
          expect(panel(app).querySelectorAll('[data-search-skip]'), `${what}: no document listed`).toHaveLength(0);
          expect(words(panel(app).textContent), what).not.toMatch(/No matches|documents searched/);
        }
      } finally {
        engineOverride.current = null;
      }
      await typeQuery(app, motifField(app), 'GAATTC');
      expect(summary(app), 'the real engine answers again').toBe(`1,104 hits in 4 documents · ${NUCLEIC.length} documents searched · 10 not searched`);
    });
  });
});

// ─── US-01M7DVVS: searches wait for a pause, can be cancelled and rerun when documents change ───
//
// Each criterion names the wrong panel it fails: one that keeps an older query's groups during the
// pause, one that runs every document in one call (no step between them), one that lets an older
// run's answer land after a newer query was typed, one that lists a cancelled run's partial
// groups, and one that recomputes in place when the documents change, with no out-of-date sentence.

/** The groups GAATTC lists in Motif Lab: none of them may be shown for a later query. */
const GAATTC_GROUPS = ['Ambiguous only', 'Circular EcoRI origin', 'Many GAATTC sites', 'Mixed certainty'];
/** Lets `ms` of the fake clock pass, then lets the page settle. */
async function advance(app: AppHarness, ms: number) {
  await React.act(async () => { vi.advanceTimersByTime(ms); });
  await app.settle();
}
/** Counts the engine calls at search_iupac_motif (searchIupacMotifRust), by query, while `run` runs. */
async function countingEngine(run: (queries: string[]) => Promise<void>) {
  const real = await vi.importActual<typeof import('../lib/rustBioEngine')>('../lib/rustBioEngine');
  const queries: string[] = [];
  engineOverride.current = (...args: unknown[]) => {
    const [seq, query, options] = args as Parameters<typeof real.searchIupacMotifRust>;
    queries.push(query);
    return real.searchIupacMotifRust(seq, query, options);
  };
  try {
    await run(queries);
  } finally {
    engineOverride.current = null;
  }
}
const searchingFor = (q: string) => `Searching for "${q}"…`;

describe('US-01M7DVVS AC1: a search waits for a pause in typing and never lists an earlier query', () => {
  it('US-01M7DVVS AC1 in Nucleotide motif mode makes no engine call until 250 ms after the fifth keystroke, then calls it only for the final query', async () => {
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Nucleotide motif');
      await typeQuery(app, motifField(app), 'GAATTC');
      expect(groupNames(app), 'an earlier query is listed before the typing starts').toEqual(GAATTC_GROUPS);
      await countingEngine(async (queries) => {
        const typed = ['C', 'CT', 'CTT', 'CTTA', 'CTTAG'];
        for (const [i, q] of typed.entries()) {
          if (i > 0) await advance(app, 50);
          await app.input(motifField(app), q);
          expect(summary(app), `after typing ${q}`).toBe(searchingFor(q));
          expect(groups(app), `after typing ${q}: no group of an earlier query`).toHaveLength(0);
        }
        await advance(app, 249);
        expect(queries, '249 ms after the last keystroke').toEqual([]);
        expect(summary(app)).toBe(searchingFor('CTTAG'));
        expect(groups(app)).toHaveLength(0);
        await advance(app, 1);
        // One document per step: a run that searched every document at once would have made them all.
        expect(queries, 'the first step reads the first document only').toEqual(['CTTAG']);
        let steps = 0;
        while (cancelButtons(app).length > 0) {
          expect(summary(app), `step ${steps}`).toBe(searchingFor('CTTAG'));
          expect(groups(app), `step ${steps}: nothing listed until the run completes`).toHaveLength(0);
          await stepSearch(app);
          steps += 1;
        }
        expect(steps, 'the run took one step per document after the first').toBe(MOTIF_DOCS.length - 1);
        expect(queries, 'engine calls only for the final query, one per DNA and RNA document').toEqual(NUCLEIC.map(() => 'CTTAG'));
        expect(groupNames(app)).toEqual(['RNA reverse site']);
        expect(summary(app)).toBe(`1 hit in 1 document · ${NUCLEIC.length} documents searched · 10 not searched`);
      });
    });
  });

  it('US-01M7DVVS AC1 in Text mode lists no group of the earlier query from the first keystroke until the final run completes', async () => {
    await withSession(SPEC, async (app) => {
      await searchFolder(app, 'All Project Files');
      await typeQuery(app, queryField(app), 'zqvector');
      expect(groups(app).map((g) => part(g, 'name')).sort()).toEqual(['Favourite insert', 'Hidden zqvector assay', 'Opened backbone']);
      const typed = ['z', 'zq', 'zql', 'zqlo', 'zqlon'];
      for (const [i, q] of typed.entries()) {
        if (i > 0) await advance(app, 50);
        await app.input(queryField(app), q);
        expect(summary(app), `after typing ${q}`).toBe(searchingFor(q));
        expect(groups(app), `after typing ${q}`).toHaveLength(0);
      }
      await advance(app, 249);
      expect(cancelButtons(app), 'no run 249 ms after the last keystroke').toHaveLength(0);
      expect(summary(app)).toBe(searchingFor('zqlon'));
      await advance(app, 1);
      let steps = 0;
      while (cancelButtons(app).length > 0) {
        expect(summary(app), `step ${steps}`).toBe(searchingFor('zqlon'));
        expect(groups(app), `step ${steps}`).toHaveLength(0);
        await stepSearch(app);
        steps += 1;
      }
      expect(steps).toBe(ENTIRE - 1);
      expect(groups(app).map((g) => part(g, 'name'))).toEqual(['Never opened protein']);
      expect(summary(app)).toBe(`1 hit in 1 document · ${ENTIRE} documents searched`);
    });
  });
});

describe('US-01M7DVVS AC2: an older run never lands after a newer query', () => {
  it('US-01M7DVVS AC2 types GAATTC, steps its run once, types GGATCC and steps both: no GAATTC group is ever listed', async () => {
    await withSession(MOTIF_SPEC, async (app) => {
      await openLab(app, 'Nucleotide motif');
      const gaattcListed = () => groups(app).map((g) => part(g, 'name')).filter((n) => GAATTC_GROUPS.includes(n));
      await countingEngine(async (queries) => {
        await app.input(motifField(app), 'GAATTC');
        await advance(app, SEARCH_PAUSE_MS);
        await stepSearch(app);
        expect(queries, 'the GAATTC run is under way').toEqual(['GAATTC', 'GAATTC']);
        expect(cancelButtons(app), 'and not finished').toHaveLength(1);
        await app.input(motifField(app), 'GGATCC');
        // Through the pause and both runs' steps, a millisecond at a time.
        for (let ms = 0; ms < SEARCH_PAUSE_MS + 3 * MOTIF_DOCS.length; ms++) {
          expect(gaattcListed(), `${ms} ms after typing GGATCC`).toEqual([]);
          await stepSearch(app);
        }
        expect(queries.filter((q) => q === 'GAATTC'), 'the GAATTC run read no document after GGATCC was typed').toHaveLength(2);
        expect(queries.filter((q) => q === 'GGATCC')).toHaveLength(NUCLEIC.length);
      });
      expect(cancelButtons(app)).toHaveLength(0);
      expect(gaattcListed()).toEqual([]);
      expect(summary(app)).toBe(`No matches in ${NUCLEIC.length} documents searched · 10 not searched`);
    });
  });
});

describe('US-01M7DVVS AC3: Cancel search stops a run and shows no results', () => {
  it('US-01M7DVVS AC3 Cancel search after the first step stops a motif run and a text run before the next document', async () => {
    const cases: [string, string, () => (app: AppHarness) => LiveElement][] = [
      // Each query matches the first document, so a cancelled run has a partial group it must not list.
      ['Nucleotide motif', 'ACGTAC', () => motifField],
      ['Text', 'Short', () => queryField],
    ];
    for (const [mode, query, field] of cases) {
      await withSession(MOTIF_SPEC, async (app) => {
        await openLab(app, mode === 'Text' ? undefined : mode);
        await countingEngine(async (queries) => {
          expect(cancelButtons(app), `${mode}: no Cancel search before a run`).toHaveLength(0);
          await app.input(field()(app), query);
          expect(cancelButtons(app), `${mode}: none during the pause`).toHaveLength(0);
          await advance(app, SEARCH_PAUSE_MS);
          expect(cancelButtons(app), `${mode}: shown while the run is in progress`).toHaveLength(1);
          expect(queries).toHaveLength(mode === 'Text' ? 0 : 1);
          await app.click(cancelButtons(app)[0]);
          const said = `Cancelled after 1 of ${MOTIF_DOCS.length} documents: no results are shown`;
          expect(summary(app), mode).toBe(said);
          expect(groups(app), `${mode}: no result group`).toHaveLength(0);
          expect(panel(app).querySelectorAll('[data-search-skip]'), `${mode}: nothing listed`).toHaveLength(0);
          expect(cancelButtons(app)).toHaveLength(0);
          await advance(app, SEARCH_PAUSE_MS * 4);
          expect(queries, `${mode}: no document after Cancel`).toHaveLength(mode === 'Text' ? 0 : 1);
          expect(summary(app), `${mode}: still cancelled`).toBe(said);
          expect(groups(app)).toHaveLength(0);
          // The next query searches again.
          await typeQuery(app, field()(app), mode === 'Text' ? 'Short DNA' : 'ACGTA');
          expect(groupNames(app)).toEqual(['Short DNA']);
        });
      });
    }
  });
});

describe('US-01M7DVVS AC4: a change of the documents marks the results out of date and reruns after the pause', () => {
  it('US-01M7DVVS AC4 says Out of date over the old groups at once, then reruns: a renamed group takes its new name and a deleted document leaves', async () => {
    await withSession(SPEC, async (app) => {
      await searchFolder(app, 'All Project Files');
      await typeQuery(app, queryField(app), 'zqvector');
      const names = () => groups(app).map((g) => part(g, 'name')).sort();
      expect(names()).toEqual(['Favourite insert', 'Hidden zqvector assay', 'Opened backbone']);
      const OUT_OF_DATE = 'Out of date: the documents changed. Searching again…';

      // Rename Favourite insert in the document table (double-click its name, type, Enter).
      const cell = app.all('span[title="Double-click to rename"]').filter((s) => words(s.textContent) === 'Favourite insert');
      expect(cell, 'the document table lists Favourite insert').toHaveLength(1);
      await React.act(async () => { dispatchLiveEvent(cell[0], 'dblclick', { bubbles: true, cancelable: true }); });
      await app.settle();
      const editor = app.one('input[aria-label="New name for Favourite insert"]', 'the name editor');
      await app.input(editor, 'Favourite zqrenamed insert');
      await React.act(async () => { dispatchLiveEvent(editor, 'keydown', { key: 'Enter', bubbles: true, cancelable: true }); });
      await app.settle();
      expect(summary(app), 'out of date at once, before the pause').toBe(OUT_OF_DATE);
      expect(names(), 'the old groups stay listed under it').toEqual(['Favourite insert', 'Hidden zqvector assay', 'Opened backbone']);
      await advance(app, 249);
      expect(summary(app)).toBe(OUT_OF_DATE);
      expect(cancelButtons(app), 'no rerun before the pause').toHaveLength(0);
      await advance(app, 1);
      expect(cancelButtons(app), 'the rerun starts 250 ms after the change').toHaveLength(1);
      await finishSearch(app, 0);
      expect(names(), 'the renamed group shows its new name').toEqual(['Favourite zqrenamed insert', 'Hidden zqvector assay', 'Opened backbone']);
      expect(summary(app)).toBe(`3 hits in 3 documents · ${ENTIRE} documents searched`);

      // Delete Opened backbone, the active document.
      await app.menu('file:soft-delete');
      expect(summary(app), 'out of date at once').toBe(OUT_OF_DATE);
      expect(names()).toEqual(['Favourite zqrenamed insert', 'Hidden zqvector assay', 'Opened backbone']);
      await advance(app, 249);
      expect(summary(app)).toBe(OUT_OF_DATE);
      await finishSearch(app, 1);
      expect(names(), "the deleted document's hits are gone").toEqual(['Favourite zqrenamed insert', 'Hidden zqvector assay']);
      expect(summary(app)).toBe(`2 hits in 2 documents · ${ENTIRE - 1} documents searched`);
    });
  });

  it('US-01M7DVVS AC4 a restore from Deleted Items, and a favourite mark under the Favorites scope, each mark the results out of date and rerun', async () => {
    // Two favourites, so the Favorites scope still holds a document after one mark is cleared.
    const spec: SessionSpec = { ...SPEC, workspace: { projectExplorer: { ...EXPLORER, favoriteDocIds: ['us88-fav', 'us88-hidden'] } } as SessionSpec['workspace'] };
    await withSession(spec, async (app) => {
      const OUT_OF_DATE = 'Out of date: the documents changed. Searching again…';
      const names = () => groups(app).map((g) => part(g, 'name')).sort();
      await searchFolder(app, 'All Project Files');
      await typeQuery(app, queryField(app), 'zqvector');
      expect(names()).toEqual(['Favourite insert', 'Hidden zqvector assay', 'Opened backbone']);
      // File › Restore from Deleted Items with nothing selected there restores the deleted draft.
      await app.menu('file:restore-deleted');
      expect(summary(app), 'restored: out of date at once').toBe(OUT_OF_DATE);
      expect(names()).toEqual(['Favourite insert', 'Hidden zqvector assay', 'Opened backbone']);
      await advance(app, 249);
      expect(summary(app)).toBe(OUT_OF_DATE);
      await finishSearch(app, 1);
      expect(names(), 'the restored document is searched').toEqual(['Deleted zqvector draft', 'Favourite insert', 'Hidden zqvector assay', 'Opened backbone']);
      expect(summary(app)).toBe(`4 hits in 4 documents · ${ENTIRE + 1} documents searched`);

      await searchFolder(app, 'Favorites');
      await typeQuery(app, queryField(app), 'zqvector');
      const before = ['Favourite insert', 'Hidden zqvector assay'];
      expect(names()).toEqual(before);
      // File › Toggle Favorite on the App's target document clears one of the two marks.
      await app.menu('file:toggle-favorite');
      expect(summary(app), 'a favourite mark: out of date at once').toBe(OUT_OF_DATE);
      expect(names(), 'the old groups stay listed').toEqual(before);
      await advance(app, 249);
      expect(summary(app)).toBe(OUT_OF_DATE);
      await finishSearch(app, 1);
      expect(names(), 'one favourite is left').toHaveLength(1);
      expect(before).toContain(names()[0]);
      expect(summary(app)).toBe('1 hit in 1 document · 1 document searched');
    });
  });
});
