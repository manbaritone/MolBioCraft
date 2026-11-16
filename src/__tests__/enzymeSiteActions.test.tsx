// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7JPSK: from a detected site, view its enzyme's definition or add the enzyme to a
 * collection, from a Displayed restriction sites panel row and from the linear map's cleavage
 * preview. Both open the Restriction Enzymes window with an intent region under its header; the
 * window's Collections section and tables print similar words, so each test reads the intent
 * region alone.
 *
 * AC1 and AC2 run in the real App over the live DOM (appHarness). The document the App hands the
 * main linear view is read from that view's own `doc` prop (AC3), so a view, an add or a display
 * toggle that wrote to the document would show there.
 */

import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ENZYME_COLLECTIONS_KEY,
  ENZYME_DATABASE_KEY,
  builtInNameClash,
  openEnzymeCollections,
  openEnzymeDatabase,
  type CustomEnzymeInput,
  type EnzymeCollection,
} from '../core/enzymeDatabase';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionCutSite, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** The documents the App last handed each linear view, by document id. */
const seen = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));
vi.mock('../components/LinearSequenceView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/LinearSequenceView')>();
  const View = actual.LinearSequenceView;
  const Watched = (props: React.ComponentProps<typeof View>) => {
    seen.docs.set(props.doc.id, props.doc);
    return React.createElement(View, props);
  };
  return { ...actual, LinearSequenceView: Watched };
});
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

/** The components rendered on their own, loaded only once React DOM has been loaded under the live DOM (mountApp). */
let ui: {
  renderToStaticMarkup: typeof import('react-dom/server').renderToStaticMarkup;
  DisplayedSitesPanel: typeof import('../components/DisplayedSitesPanel').DisplayedSitesPanel;
  CleavagePreview: typeof import('../components/CleavagePreview').CleavagePreview;
  scanRestrictionSites: typeof import('../core/bioEngine').scanRestrictionSites;
  restrictionSiteCountsByName: typeof import('../core/bioEngine').restrictionSiteCountsByName;
  sequenceRevision: typeof import('../core/restrictionDisplay').sequenceRevision;
  emptySiteVisibility: typeof import('../core/restrictionDisplay').emptySiteVisibility;
};
beforeAll(async () => {
  const app = await mountApp();
  app.unmount();
  ui = {
    renderToStaticMarkup: (await import('react-dom/server')).renderToStaticMarkup,
    DisplayedSitesPanel: (await import('../components/DisplayedSitesPanel')).DisplayedSitesPanel,
    CleavagePreview: (await import('../components/CleavagePreview')).CleavagePreview,
    scanRestrictionSites: (await import('../core/bioEngine')).scanRestrictionSites,
    restrictionSiteCountsByName: (await import('../core/bioEngine')).restrictionSiteCountsByName,
    sequenceRevision: (await import('../core/restrictionDisplay')).sequenceRevision,
    emptySiteVisibility: (await import('../core/restrictionDisplay')).emptySiteVisibility,
  };
});

// ─── The fixture ───

/**
 * Adaeze's own "EcoRI": another motif under the built-in's name, confirmed, cutting upstream of its
 * motif (signed cuts), Type IIS, Dcm-sensitive, with provenance and notes.
 */
const MINE: CustomEnzymeInput = {
  name: 'EcoRI',
  recognitionSeq: 'TGGTGGTGA',
  cutFwd: -3,
  cutRev: -1,
  isTypeIIS: true,
  methylationSensitivity: ['Dcm'],
  provenance: 'Own isolate, lab book 7',
  notes: 'Cuts three bases before its motif.',
};
const MINE_ID = 'custom:seed-1';

const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};
/** A/C filler with the built-in EcoRI's GAATTC once, the custom "EcoRI"'s motif once and BamHI's GGATCC once. */
const SEQ = [filler(300, 1), 'GAATTC', filler(300, 2), MINE.recognitionSeq, filler(300, 3), 'GGATCC', filler(300, 4)].join('');
const docOf = (id: string): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence: SEQ, topology: 'linear', features: [], primers: [],
  docMetadata: { Notes: 'kept as it is' },
});

function seeded(inputs: CustomEnzymeInput[], storage: LiveStorage = memoryStorage()): LiveStorage {
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => '2026-01-01T00:00:00.000Z', newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}
/** Stores collections named `names`, in order; the n-th is `collection:t-n`. */
function withCollections(storage: LiveStorage, names: string[]): LiveStorage {
  let n = 0;
  const c = openEnzymeCollections({ storage, now: () => '2026-02-01T00:00:00.000Z', newId: () => `collection:t-${++n}` });
  for (const name of names) {
    const r = c.create(name);
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}
/** A storage that counts the writes to each key and can refuse the collections key's. */
function watchedStorage(base: LiveStorage, refuse: 'throw' | 'drop' | null = null) {
  const writes: Record<string, number> = {};
  const storage = {
    ...base,
    getItem: (k: string) => base.getItem(k),
    setItem: (k: string, v: string) => {
      writes[k] = (writes[k] ?? 0) + 1;
      if (k === ENZYME_COLLECTIONS_KEY && refuse === 'throw') throw new Error('quota exceeded');
      if (k === ENZYME_COLLECTIONS_KEY && refuse === 'drop') return;
      base.setItem(k, v);
    },
    removeItem: (k: string) => base.removeItem(k),
  } as LiveStorage;
  return { storage, writes };
}
const collectionsIn = (storage: LiveStorage): EnzymeCollection[] => {
  const r = openEnzymeCollections({ storage }).read();
  if (!r.ok) throw new Error(r.error.message);
  return r.collections;
};
const membersOf = (storage: LiveStorage) => Object.fromEntries(collectionsIn(storage).map((c) => [c.name, c.enzymeIds]));

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function withDoc(storage: LiveStorage, docs: SequenceDocument[], run: (app: AppHarness) => Promise<void>): Promise<void> {
  seen.docs.clear();
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({
      documents: docs,
      activeDocId: docs[0].id,
      viewerTab: 'sequence-view',
      workspace: {
        mapLayoutMode: 'split',
        displaySettings: {
          showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
          showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
        },
      },
    });
    await app.settle();
    await run(app);
  } finally {
    app.unmount();
  }
}

const PANEL = 'section[aria-label="Displayed restriction sites"]';
const WIN = '[role="dialog"][aria-labelledby="enzyme-db-title"]';
const DEFINITION = `${WIN} section[aria-label="Enzyme definition"]`;
const addRegion = (label: string) => `${WIN} section[aria-label="Add ${label} to a collection"]`;
/** Every intent region the window draws (either kind). */
const intentRegions = (app: AppHarness) =>
  app.all(`${WIN} section`).filter((s) => {
    const l = s.getAttribute('aria-label') ?? '';
    return l === 'Enzyme definition' || /^Add .* to a collection$/.test(l);
  });

async function press(app: AppHarness, el: LiveElement) {
  await app.click(el);
  await app.settle();
}
function buttonIn(scope: LiveElement, text: string): LiveElement {
  const found = scope.querySelectorAll('button').filter((b) => words(b.textContent) === text || b.getAttribute('aria-label') === text);
  expect(found.map((b) => b.getAttribute('aria-label') ?? words(b.textContent)), `one "${text}" button`).toHaveLength(1);
  return found[0];
}
const buttonsIn = (scope: LiveElement) => scope.querySelectorAll('button').map((b) => `${b.getAttribute('aria-label') ?? ''}|${words(b.textContent)}`);
/** The panel row action named `label`. */
const panelAction = (app: AppHarness, label: string) => app.one(`${PANEL} [aria-label="${label}"]`, label);
/** Opens the linear map's cleavage preview of the pill whose name starts `name (`. */
async function openPreview(app: AppHarness, name: string): Promise<LiveElement> {
  const named = new RegExp(`^${name.replace(/[()]/g, '\\$&')} \\(\\d[\\d,]*\\) cut site`);
  const mainView = (el: LiveElement) => !el.closest('section[aria-label="Split view"]');
  const pills = app.all('.cut-pill').filter((p) => mainView(p) && named.test(p.getAttribute('aria-label') ?? ''));
  expect(pills, `one main-view ${name} pill`).toHaveLength(1);
  await press(app, pills[0]);
  const previews = app.all('section.mbc-cleavage-preview').filter(mainView);
  expect(previews, 'one main-view cleavage preview').toHaveLength(1);
  return previews[0];
}
async function closeWindow(app: AppHarness) {
  await press(app, app.one(`${WIN} [aria-label="Close Restriction Enzymes"]`, 'the window\'s Close'));
  expect(app.all(WIN)).toHaveLength(0);
}
/** Chooses `name` in the Add region's Collection chooser. */
async function choose(app: AppHarness, region: LiveElement, name: string) {
  const select = region.querySelectorAll('select[aria-label="Collection"]');
  expect(select, 'one Collection chooser').toHaveLength(1);
  const option = select[0].querySelectorAll('option').find((o) => words(o.textContent) === name);
  expect(option, `an option "${name}"`).toBeTruthy();
  await app.change(select[0], option!.getAttribute('value') ?? '');
  await app.settle();
}
/** The document's own content as the App last handed the main linear view. */
const docContent = (id: string) => {
  const d = seen.docs.get(id) as SequenceDocument | undefined;
  expect(d, `the App handed the linear view ${id}`).toBeTruthy();
  return JSON.stringify({ sequence: d!.sequence, features: d!.features, primers: d!.primers, docMetadata: d!.docMetadata });
};

// ─── AC1 ───

describe('US-01M7JPSK AC1: View the enzyme definition from a site', () => {
  it('US-01M7JPSK AC1 the custom twin\'s View, from the panel and from the cleavage preview, shows its definition read-only, and Edit opens the editor for it', async () => {
    const storage = seeded([MINE]);
    await withDoc(storage, [docOf('pSite')], async (app) => {
      // From the panel row.
      await press(app, panelAction(app, 'View the EcoRI (custom) enzyme definition'));
      let region = app.one(DEFINITION, 'the Enzyme definition region');
      const text = words(region.textContent);
      for (const part of ['EcoRI (custom)', 'Custom', 'TGGTGGTGA', '-3/-1', 'Type IIS: Yes', 'Dcm', 'Own isolate, lab book 7', 'Cuts three bases before its motif.']) {
        expect(text, part).toContain(part);
      }
      expect(text).not.toContain('GAATTC');
      expect(text).not.toContain('custom:');
      expect(region.querySelectorAll('input, select, textarea'), 'read-only: no field').toHaveLength(0);
      expect(buttonsIn(region)).toEqual(['Edit the EcoRI (custom) definition|Edit']);
      // Edit opens the existing editor on that definition.
      await press(app, buttonIn(region, 'Edit'));
      const form = app.one(`${WIN} form`, 'the editor');
      expect(form.getAttribute('aria-label')).toBe('Edit EcoRI');
      const motif = form.querySelectorAll('input').filter((i) => (i.getAttribute('aria-label') ?? '').startsWith('Recognition motif'));
      expect(motif).toHaveLength(1);
      expect((motif[0] as unknown as { value: string }).value).toBe('TGGTGGTGA');
      await closeWindow(app);

      // From the linear map's cleavage preview.
      const preview = await openPreview(app, 'EcoRI (custom)');
      await press(app, buttonIn(preview, 'View the EcoRI (custom) enzyme definition'));
      region = app.one(DEFINITION, 'the Enzyme definition region');
      expect(words(region.textContent)).toContain('TGGTGGTGA');
      expect(words(region.textContent)).toContain('Own isolate, lab book 7');
      expect(buttonsIn(region)).toEqual(['Edit the EcoRI (custom) definition|Edit']);
    });
  });

  it('US-01M7JPSK AC1 the built-in EcoRI\'s View shows the catalogue entry with no Edit, Save or Clone in the region, never the custom twin', async () => {
    const storage = seeded([MINE]);
    await withDoc(storage, [docOf('pSite')], async (app) => {
      for (const from of ['panel', 'preview'] as const) {
        if (from === 'panel') await press(app, panelAction(app, 'View the EcoRI enzyme definition'));
        else await press(app, buttonIn(await openPreview(app, 'EcoRI'), 'View the EcoRI enzyme definition'));
        const region = app.one(DEFINITION, 'the Enzyme definition region');
        const text = words(region.textContent);
        expect(text, from).toContain('GAATTC');
        expect(text, from).toContain('Built-in');
        expect(text, from).toContain('1/5');
        expect(text, from).toContain('Type IIS: No');
        expect(text, from).not.toContain('TGGTGGTGA');
        expect(text, from).not.toContain('(custom)');
        expect(text, from).not.toContain('Own isolate');
        expect(buttonsIn(region), from).toEqual([]);
        // The window's own tables keep their actions.
        expect(app.all(`${WIN} [aria-label="Clone EcoRI as custom"]`)).toHaveLength(1);
        expect(app.all(`${WIN} [aria-label="Edit EcoRI"]`)).toHaveLength(1);
        await closeWindow(app);
      }
    });
  });

  it('US-01M7JPSK AC1 a custom site whose definition is gone reads "A custom enzyme no longer stored", and with the store unreadable "A custom enzyme (the enzyme database could not be read)", never its id', async () => {
    const storage = seeded([MINE]);
    await withDoc(storage, [docOf('pSite')], async (app) => {
      // After the scan, the definition is removed from storage directly (the app has no delete).
      const envelope = JSON.parse(storage.getItem(ENZYME_DATABASE_KEY)!) as { definitions: { id: string }[] };
      expect(envelope.definitions.map((d) => d.id)).toEqual([MINE_ID]);
      storage.setItem(ENZYME_DATABASE_KEY, JSON.stringify({ ...envelope, definitions: [] }));
      await press(app, panelAction(app, 'View the EcoRI (custom) enzyme definition'));
      let region = app.one(DEFINITION, 'the Enzyme definition region');
      expect(words(region.textContent)).toContain('A custom enzyme no longer stored');
      expect(words(region.textContent)).not.toContain('custom:');
      expect(words(region.textContent)).not.toContain('TGGTGGTGA');
      expect(buttonsIn(region)).toEqual([]);
      await closeWindow(app);

      storage.setItem(ENZYME_DATABASE_KEY, '{ not json');
      await press(app, panelAction(app, 'View the EcoRI (custom) enzyme definition'));
      region = app.one(DEFINITION, 'the Enzyme definition region');
      expect(words(region.textContent)).toContain('A custom enzyme (the enzyme database could not be read)');
      expect(words(region.textContent)).not.toContain('no longer stored');
      expect(words(region.textContent)).not.toContain('custom:');
      expect(buttonsIn(region)).toEqual([]);
    });
  });

  it('US-01M7JPSK AC1 the custom twin\'s cleavage preview is named "EcoRI (custom)", and a built-in\'s as before', async () => {
    await withDoc(seeded([MINE]), [docOf('pSite')], async (app) => {
      let preview = await openPreview(app, 'EcoRI (custom)');
      expect(preview.getAttribute('aria-label')).toBe('EcoRI (custom) cleavage preview');
      expect(words(preview.querySelectorAll('strong')[0]?.textContent)).toBe('EcoRI (custom) cleavage');
      preview = await openPreview(app, 'EcoRI');
      expect(preview.getAttribute('aria-label')).toBe('EcoRI cleavage preview');
      expect(words(preview.querySelectorAll('strong')[0]?.textContent)).toBe('EcoRI cleavage');
      preview = await openPreview(app, 'BamHI');
      expect(preview.getAttribute('aria-label')).toBe('BamHI cleavage preview');
      expect(words(preview.querySelectorAll('strong')[0]?.textContent)).toBe('BamHI cleavage');
    });
  });
});

// ─── AC2 ───

describe('US-01M7JPSK AC2: Add the enzyme to a collection from a site', () => {
  it('US-01M7JPSK AC2 Add stores the built-in\'s key in the chosen collection, a repeat writes nothing, and the custom twin stores its id', async () => {
    const base = withCollections(seeded([MINE]), ['Digest set', 'Cloning set']);
    const { storage, writes } = watchedStorage(base);
    const definitions = storage.getItem(ENZYME_DATABASE_KEY);
    await withDoc(storage, [docOf('pSite')], async (app) => {
      await press(app, panelAction(app, 'Add EcoRI to a collection'));
      const region = app.one(addRegion('EcoRI'), 'the Add EcoRI region');
      await choose(app, region, 'Cloning set');
      await press(app, buttonIn(region, 'Add'));
      expect(words(app.one(addRegion('EcoRI')).querySelectorAll('[role="status"], [role="alert"]').map((p) => p.textContent).join(' '))).toBe(
        'Added EcoRI to "Cloning set".',
      );
      expect(membersOf(storage)).toEqual({ 'Digest set': [], 'Cloning set': ['EcoRI'] });
      expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(definitions);
      // A repeat writes nothing.
      const before = { writes: writes[ENZYME_COLLECTIONS_KEY], value: storage.getItem(ENZYME_COLLECTIONS_KEY) };
      await press(app, buttonIn(app.one(addRegion('EcoRI')), 'Add'));
      expect(words(app.one(addRegion('EcoRI')).querySelectorAll('[role="status"], [role="alert"]').map((p) => p.textContent).join(' '))).toBe(
        'EcoRI is already in "Cloning set": nothing was changed.',
      );
      expect({ writes: writes[ENZYME_COLLECTIONS_KEY], value: storage.getItem(ENZYME_COLLECTIONS_KEY) }).toEqual(before);
      await closeWindow(app);

      // The custom twin's, from the cleavage preview: its custom: id.
      await press(app, buttonIn(await openPreview(app, 'EcoRI (custom)'), 'Add EcoRI (custom) to a collection'));
      const twin = app.one(addRegion('EcoRI (custom)'), 'the Add EcoRI (custom) region');
      expect(words(twin.textContent)).not.toContain('custom:');
      await choose(app, twin, 'Cloning set');
      await press(app, buttonIn(twin, 'Add'));
      expect(words(app.one(addRegion('EcoRI (custom)')).querySelectorAll('[role="status"]').map((p) => p.textContent).join(' '))).toBe(
        'Added EcoRI (custom) to "Cloning set".',
      );
      expect(membersOf(storage)).toEqual({ 'Digest set': [], 'Cloning set': ['EcoRI', MINE_ID] });
      expect(storage.getItem(ENZYME_DATABASE_KEY)).toBe(definitions);
    });
  });

  it('US-01M7JPSK AC2 with no collection the region says so and adds nothing, and New Collection in the same window brings the chooser', async () => {
    const storage = seeded([MINE]);
    await withDoc(storage, [docOf('pSite')], async (app) => {
      await press(app, panelAction(app, 'Add EcoRI to a collection'));
      let region = app.one(addRegion('EcoRI'), 'the Add EcoRI region');
      expect(words(region.textContent)).toContain('No collection yet: create one in this window first.');
      expect(region.querySelectorAll('select, button')).toHaveLength(0);
      expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBeNull();
      // New Collection in the window's Collections section.
      const name = app.one(`${WIN} input[aria-label="New collection name"]`, 'the new collection name');
      await app.input(name, 'Cloning set');
      await press(app, buttonIn(app.one(`${WIN} section[aria-label="Collections"]`), 'New Collection'));
      region = app.one(addRegion('EcoRI'), 'the Add EcoRI region');
      expect(words(region.textContent)).not.toContain('No collection yet');
      await choose(app, region, 'Cloning set');
      await press(app, buttonIn(region, 'Add'));
      expect(words(app.one(addRegion('EcoRI')).querySelectorAll('[role="status"]').map((p) => p.textContent).join(' '))).toBe('Added EcoRI to "Cloning set".');
      expect(membersOf(storage)).toEqual({ 'Cloning set': ['EcoRI'] });
    });
  });

  it('US-01M7JPSK AC2 with the collections store unreadable the region shows the store\'s sentence, no Add control, and the stored value is untouched', async () => {
    const base = seeded([MINE]);
    base.setItem(ENZYME_COLLECTIONS_KEY, '{ not json');
    const { storage, writes } = watchedStorage(base);
    await withDoc(storage, [docOf('pSite')], async (app) => {
      await press(app, panelAction(app, 'Add EcoRI to a collection'));
      const region = app.one(addRegion('EcoRI'), 'the Add EcoRI region');
      expect(words(region.textContent)).toContain(
        'The stored enzyme collections (molbiocraft.enzymeCollections) cannot be read: it is not valid JSON. They are kept as they are, and nothing is written over them.',
      );
      expect(region.querySelectorAll('select, button')).toHaveLength(0);
      await closeWindow(app);
    });
    expect(storage.getItem(ENZYME_COLLECTIONS_KEY)).toBe('{ not json');
    expect(writes[ENZYME_COLLECTIONS_KEY] ?? 0).toBe(0);
  });

  it('US-01M7JPSK AC2 a write the storage does not keep says nothing was saved in the region, and a throwing one gives the store\'s other sentence', async () => {
    for (const refuse of ['drop', 'throw'] as const) {
      const base = withCollections(seeded([MINE]), ['Cloning set']);
      const stored = base.getItem(ENZYME_COLLECTIONS_KEY);
      const { storage } = watchedStorage(base, refuse);
      await withDoc(storage, [docOf('pSite')], async (app) => {
        await press(app, panelAction(app, 'Add EcoRI to a collection'));
        const region = app.one(addRegion('EcoRI'), 'the Add EcoRI region');
        await choose(app, region, 'Cloning set');
        await press(app, buttonIn(region, 'Add'));
        const said = words(app.one(addRegion('EcoRI')).querySelectorAll('[role="alert"]').map((p) => p.textContent).join(' '));
        if (refuse === 'drop') expect(said).toBe('Nothing was saved: the storage did not keep the change. The enzyme collections are as they were.');
        else expect(said).toBe('Nothing was saved (Error: quota exceeded). The enzyme collections are as they were.');
        expect(said).not.toContain('Added');
      });
      expect(storage.getItem(ENZYME_COLLECTIONS_KEY), refuse).toBe(stored);
    }
  });
});

// ─── AC3 ───

describe('US-01M7JPSK AC3: without the callbacks nothing new is drawn, and no action changes the document', () => {
  it('US-01M7JPSK AC3 the panel and the preview rendered without the callbacks draw no new control, and with them draw both', () => {
    const scan = ui.scanRestrictionSites(SEQ, 'linear');
    const sites = scan.sites;
    const eco = sites.find((s) => s.enzyme.name === 'EcoRI') as RestrictionCutSite;
    expect(eco).toBeTruthy();
    const revision = ui.sequenceRevision(SEQ, 'linear');
    const panel = (more: object) =>
      ui.renderToStaticMarkup(
        <ui.DisplayedSitesPanel
          sites={sites}
          siteCounts={ui.restrictionSiteCountsByName(scan)}
          visibility={ui.emptySiteVisibility(revision)}
          molecule={{ revision, seqLen: SEQ.length, circular: false }}
          uniqueCuttersOnly={false}
          onVisibilityChange={() => {}}
          onGoToSite={() => {}}
          {...more}
        />,
      );
    const preview = (more: object) =>
      ui.renderToStaticMarkup(<ui.CleavagePreview site={eco} sequence={SEQ} circular={false} onClose={() => {}} {...more} />);
    const actions = /enzyme definition|to a collection|Add to collection|View definition|Definition</;
    expect(panel({})).not.toMatch(actions);
    expect(preview({})).not.toMatch(actions);
    const both = { onViewEnzyme: () => {}, onAddEnzymeToCollection: () => {} };
    expect(panel(both)).toContain('aria-label="View the EcoRI enzyme definition"');
    expect(panel(both)).toContain('aria-label="Add EcoRI to a collection"');
    expect(preview(both)).toContain('aria-label="View the EcoRI enzyme definition"');
    expect(preview(both)).toContain('aria-label="Add EcoRI to a collection"');
  });

  it('US-01M7JPSK AC3 the split pane\'s preview offers neither action', async () => {
    await withDoc(seeded([MINE]), [docOf('pMain'), docOf('pOther')], async (app) => {
      await press(app, app.one('[aria-label="Split view: show another document side by side"]', 'the split toggle'));
      const split = app.one('section[aria-label="Split view"]', 'the split pane');
      const pills = split.querySelectorAll('.cut-pill').filter((p) => (p.getAttribute('aria-label') ?? '').startsWith('EcoRI (custom) ('));
      expect(pills, 'the split pane draws the custom pill').toHaveLength(1);
      await press(app, pills[0]);
      const preview = app.one('section[aria-label="Split view"] section.mbc-cleavage-preview', 'the split pane\'s preview');
      expect(buttonsIn(preview)).toEqual(['Close cleavage preview|×']);
      // The main view's preview of the same enzyme does offer both.
      const main = await openPreview(app, 'EcoRI (custom)');
      expect(buttonsIn(main)).toContain('View the EcoRI (custom) enzyme definition|View definition');
      expect(buttonsIn(main)).toContain('Add EcoRI (custom) to a collection|Add to collection');
    });
  });

  it('US-01M7JPSK AC3 the window from the Tools menu after a View and an Add shows no intent region, and no view, add or display toggle changes the document', async () => {
    const storage = withCollections(seeded([MINE]), ['Cloning set']);
    await withDoc(storage, [docOf('pSite')], async (app) => {
      const before = docContent('pSite');
      await press(app, panelAction(app, 'View the EcoRI (custom) enzyme definition'));
      expect(intentRegions(app).map((s) => s.getAttribute('aria-label'))).toEqual(['Enzyme definition']);
      await closeWindow(app);
      expect(docContent('pSite')).toBe(before);
      await press(app, panelAction(app, 'Add EcoRI to a collection'));
      const region = app.one(addRegion('EcoRI'), 'the Add EcoRI region');
      await choose(app, region, 'Cloning set');
      await press(app, buttonIn(region, 'Add'));
      expect(membersOf(storage)).toEqual({ 'Cloning set': ['EcoRI'] });
      await closeWindow(app);
      expect(docContent('pSite')).toBe(before);
      // A display toggle.
      expect(app.all('.cut-pill').filter((p) => /^EcoRI \(\d/.test(p.getAttribute('aria-label') ?? ''))).toHaveLength(1);
      await app.change(panelAction(app, 'Show EcoRI sites on the maps'), false);
      await app.settle();
      const builtInPills = () => app.all('.cut-pill').filter((p) => /^EcoRI \(\d/.test(p.getAttribute('aria-label') ?? '')).length;
      expect(builtInPills(), 'the toggle took effect').toBe(0);
      expect(docContent('pSite')).toBe(before);
      // The Tools menu's window carries no intent.
      await app.menu('tools:enzyme-database');
      await app.settle();
      expect(app.all(WIN)).toHaveLength(1);
      expect(intentRegions(app).map((r) => r.getAttribute('aria-label'))).toEqual([]);
      expect(docContent('pSite')).toBe(before);
    });
  });
});
