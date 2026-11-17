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
import { TEXT_SEARCH_STATEMENT } from '../core/projectSearch';
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
}
const groupFor = (app: AppHarness, name: string) => {
  const found = groups(app).filter((g) => part(g, 'name') === name);
  if (found.length !== 1) throw new Error(`expected one group "${name}", found ${found.length}: ${groups(app).map((g) => part(g, 'name')).join(', ')}`);
  return found[0];
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

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

      await app.input(queryField(app), 'zqvector');
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
      await app.input(queryField(app), 'zqvector');
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
      await app.input(queryField(app), 'zqlonely');
      expect(summary(app)).toBe(`1 hit in 1 document · ${ENTIRE} documents searched`);
      expect(part(groupFor(app, 'Never opened protein'), 'path')).toBe('Sample Documents › Protein Documents');

      // A document in a hidden folder is found under its full path.
      await app.input(queryField(app), 'hidden zqvector');
      expect(part(groupFor(app, 'Hidden zqvector assay'), 'path')).toBe('Sample Documents › Plasmids & Vectors › Hidden Assays');

      await app.input(queryField(app), 'zqisolate');
      expect(summary(app)).toBe(`1 hit in 1 document · ${ENTIRE} documents searched`);
      await searchFolder(app, 'Bacteria');
      await app.input(queryField(app), 'zqisolate');
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
      await app.input(queryField(app), 'ZQVECTOR');
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

      await app.input(queryField(app), 'zqlonely');
      const never = groupFor(app, 'Never opened protein');
      expect(part(never, 'type')).toBe(inferDocumentTypeLabel(DOCS[5]));
      expect(part(never, 'type')).not.toBe(part(opened, 'type'));
      expect(never.querySelectorAll('mark').map((m) => m.textContent)).toEqual(['ZqLonely']);

      // Two hits in one document: the name and the description, counted per document.
      await app.input(queryField(app), 'insert');
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
      await app.input(queryField(app), 'zqprobe');
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
      await app.input(queryField(app), 'probe 0');
      expect(summary(app)).toBe(`100 hits in 100 documents · ${total} documents searched`);
      expect(pager(app)).toBe('Groups 1-50 of 100');
      await app.click(panel(app).querySelectorAll('button').filter((b) => nameOf(b) === 'Next')[0]);
      expect(pager(app)).toBe('Groups 51-100 of 100');
      // 50 groups or fewer need no pages.
      await app.input(queryField(app), 'probe 00');
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
      await app.input(queryField(app), 'zqnothing');
      expect(summary(app)).toBe(`No matches in ${BACT} documents searched`);
      await app.input(queryField(app), '');
      expect(summary(app)).toBe(`Type text to search ${BACT} documents`);

      await searchFolder(app, 'Favorites');
      expect(summary(app)).toBe('No documents in Favorites only');
      await app.input(queryField(app), 'zqvector');
      expect(summary(app)).toBe('No documents in Favorites only');
      expect(words(panel(app).textContent)).not.toContain('No matches in 0 documents searched');
    });
  });
});
