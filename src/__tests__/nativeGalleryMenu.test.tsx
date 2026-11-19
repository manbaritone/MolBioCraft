// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7NNGQ AC4: the native View › Map Gallery and View › Compare Table, through the mounted App on
 * a macOS host (appHarness). The menu bar's `mbc:native-menu` event runs the App's own dispatcher, and
 * the native-menu state the App sends follows the `multi-record-view` rule over the checked rows. It
 * lives in its own file because the Tauri runtime mock is a file-level vi.mock.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { macHost, mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

// A macOS host's Tauri runtime. vi.mock is hoisted above the imports, so the factory loads the harness itself.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

vi.setConfig({ testTimeout: 240_000 });

const FOLDER = 'Lab Alpha';

function dna(length: number, seed: number): string {
  const bases = 'ACGT';
  let x = seed >>> 0 || 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out += bases[(x >>> 16) & 3];
  }
  return out;
}
const doc = (id: string, name: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id, name, accession: `ACC-${id.toUpperCase()}`, description: `${name}, built in the test`, sequence,
  moleculeType: 'DNA', topology: 'circular', folder: FOLDER,
  createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z',
  features: [], primers: [], history: [], ...more,
} as SequenceDocument);

const CA = doc('na', 'Circ_A', dna(3_000, 21));
const CB = doc('nb', 'Circ_B', dna(3_200, 23));
const LIN = doc('nlin', 'Lin_Doc', dna(2_500, 31), { topology: 'linear' });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const restore = (app: AppHarness, docs: SequenceDocument[], active: string) =>
  app.restoreSession({
    documents: docs, activeDocId: active, viewerTab: 'sequence-view',
    workspace: { selectedFolder: FOLDER, projectExplorer: { customFolders: [FOLDER], folderParents: {} }, mapLayoutMode: 'split' } as never,
  });

const galleries = (app: AppHarness) => app.all('section[aria-label="Map Gallery"]');
const gallery = (app: AppHarness) => app.one('section[aria-label="Map Gallery"]', 'the Map Gallery');
const cards = (app: AppHarness) => gallery(app).querySelectorAll('article.mbc-map-gallery-card');
const cardName = (card: LiveElement) => words(card.querySelectorAll('.mbc-map-gallery-name')[0]?.textContent);
const compareTables = (app: AppHarness) => gallery(app).querySelectorAll('table.mbc-compare-table');
const labelled = (scope: LiveElement, selector: string, name: string) => {
  const found = scope.querySelectorAll(selector).filter((c) => c.getAttribute('aria-label') === name);
  expect(found, `one "${name}" control`).toHaveLength(1);
  return found[0];
};
const tableRows = (app: AppHarness) => app.all('table.mbc-document-table tbody tr').filter((r) => r.querySelectorAll('input[type="checkbox"]').length === 1);
const checkedNames = (app: AppHarness) =>
  tableRows(app).map((r) => r.querySelectorAll('input[type="checkbox"]')[0]).filter((b) => b.checked).map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Select /, '')).sort();
async function check(app: AppHarness, d: SequenceDocument, on = true) {
  const boxes = tableRows(app).filter((r) => words(r.textContent).includes(d.accession)).map((r) => r.querySelectorAll('input[type="checkbox"]')[0]);
  expect(boxes, `one row for ${d.accession}`).toHaveLength(1);
  if (boxes[0].checked !== on) await app.change(boxes[0], on);
}
async function closeGallery(app: AppHarness) {
  await app.click(labelled(gallery(app), 'button', 'Close Map Gallery'));
  expect(galleries(app)).toHaveLength(0);
}
/** The native items' state in the last native-menu state the App sent. */
const nativeGalleryState = (app: AppHarness) => {
  const last = app.nativeMenuStates().at(-1);
  expect(last, 'the App sent the native menu a state').toBeTruthy();
  return [last!.overrides['view:map-gallery'], last!.overrides['view:compare-table']];
};
/** The gallery shows its Compare Table over `names`, with no cards. */
function expectCompareTable(app: AppHarness, names: string[]) {
  expect(galleries(app), 'the gallery is open').toHaveLength(1);
  const tables = compareTables(app);
  expect(tables, 'one Compare Table in the gallery').toHaveLength(1);
  expect(tables[0].querySelectorAll('tbody tr').map((r) => words(r.querySelectorAll('td')[0]?.textContent)).sort(), 'the Compare Table lists the checked records').toEqual(names);
  expect(cards(app), 'no cards under the Compare Table').toHaveLength(0);
  expect(labelled(gallery(app), 'input', 'Compare Table').checked).toBe(true);
}
/** The gallery shows the maps of `names`, with no Compare Table. */
function expectMaps(app: AppHarness, names: string[]) {
  expect(galleries(app), 'the gallery is open').toHaveLength(1);
  expect(compareTables(app), 'the maps show no Compare Table').toHaveLength(0);
  expect(cards(app).map(cardName).sort(), 'a card per checked record').toEqual(names);
  expect(labelled(gallery(app), 'input', 'Maps').checked).toBe(true);
}

describe('US-01M7NNGQ AC4: the native View › Map Gallery and View › Compare Table on a macOS host', () => {
  it('US-01M7NNGQ AC4 the native events open the gallery on the view each names, and the native state follows the checked rows', async () => {
    const app = await mountApp(macHost());
    try {
      expect(app.host).toBe('macos');
      await restore(app, [CA, CB, LIN], CA.id);
      await app.settle();
      // One checked row: the native state has both off, and the events open nothing.
      expect(checkedNames(app), 'the restore checks the active record').toEqual(['Circ_A']);
      expect(nativeGalleryState(app), 'one checked row').toEqual([false, false]);
      await app.menu('view:compare-table');
      await app.menu('view:map-gallery');
      expect(galleries(app), 'a disabled native item opens nothing').toHaveLength(0);

      // Two checked rows: both on, as the in-app items are.
      await check(app, CB);
      expect(checkedNames(app)).toEqual(['Circ_A', 'Circ_B']);
      expect(nativeGalleryState(app), 'two checked rows').toEqual([true, true]);

      await app.menu('view:compare-table');
      expectCompareTable(app, ['Circ_A', 'Circ_B']);
      // An open gallery moves to the view the native item names, and back.
      await app.menu('view:map-gallery');
      expectMaps(app, ['Circ_A', 'Circ_B']);
      await app.menu('view:compare-table');
      expectCompareTable(app, ['Circ_A', 'Circ_B']);
      await closeGallery(app);

      // From a closed gallery, View › Map Gallery opens on the maps.
      await app.menu('view:map-gallery');
      expectMaps(app, ['Circ_A', 'Circ_B']);
      await closeGallery(app);

      // Back to one checked row: the native state turns both off again.
      await check(app, CB, false);
      expect(checkedNames(app)).toEqual(['Circ_A']);
      expect(nativeGalleryState(app), 'one checked row again').toEqual([false, false]);
      await app.menu('view:compare-table');
      expect(galleries(app), 'off again, it opens nothing').toHaveLength(0);
    } finally {
      app.unmount();
    }
  });
});
