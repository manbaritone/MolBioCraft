// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVDV: Databases > Restriction Enzymes, the window over the built-in catalogue and the
 * custom enzyme store (US-01M7DVMJ), with an editor that adds, edits or clones a definition and
 * previews its double-strand cut before it is saved.
 *
 * Every check runs in the real App over the live DOM (appHarness): the window is opened from the
 * App's own menus, and the store is the page's own local storage, seeded and read back here through
 * src/core/enzymeDatabase.ts. The engine is the committed WASM; its restriction scan is watched (not
 * replaced) so a preview can be checked against the site the engine itself reported.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CUSTOM_MOTIF_LENGTH,
  builtInNameClash,
  openEnzymeDatabase,
  type CustomEnzymeInput,
} from '../core/enzymeDatabase';
import { buildNativeMenuState, resolveNativeMenuItemEnabled } from '../core/commandAvailability';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { CustomEnzymeDefinition, RestrictionCutSite, RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { LiveElement, memoryStorage, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 60_000 });

/** Every restriction scan the App asks the engine for, with what the engine answered. */
const engineScans = vi.hoisted(() => ({
  calls: [] as Array<{ seq: string; topology: string; enzymes: unknown; sites: RestrictionCutSite[] }>,
}));
vi.mock('../core/bioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/bioEngine')>();
  return {
    ...actual,
    scanRestrictionSites: (...args: Parameters<typeof actual.scanRestrictionSites>) => {
      const scan = actual.scanRestrictionSites(...args);
      engineScans.calls.push({ seq: args[0], topology: args[1], enzymes: args[2], sites: scan.sites });
      return scan;
    },
  };
});
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

const nodeFsSpec = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string;
};

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);

async function withApp(storage: LiveStorage, run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp({ storage });
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

function enzymeWindow(app: AppHarness): LiveElement | null {
  const found = app.all('[role="dialog"][aria-labelledby="enzyme-db-title"]');
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0] ?? null;
}
function win(app: AppHarness): LiveElement {
  const w = enzymeWindow(app);
  if (!w) throw new Error('the Restriction Enzymes window is not open');
  return w;
}
function button(scope: LiveElement, name: string): LiveElement {
  const found = scope.querySelectorAll('button').filter((b) => nameOf(b) === name);
  if (found.length !== 1) throw new Error(`expected one button named "${name}", found ${found.length}: ${scope.querySelectorAll('button').map(nameOf).join(' | ')}`);
  return found[0];
}
function field(scope: LiveElement, label: string): LiveElement {
  const found = scope.querySelectorAll('input, select').filter((f) => f.getAttribute('aria-label') === label);
  if (found.length !== 1) throw new Error(`expected one field labelled "${label}", found ${found.length}`);
  return found[0];
}
const editor = (app: AppHarness) => app.one('[role="dialog"][aria-labelledby="enzyme-db-title"] form', 'the enzyme editor');
const rowsOf = (app: AppHarness, table: 'Built-in enzymes' | 'Custom enzymes') =>
  win(app)
    .querySelectorAll(`table[aria-label="${table}"] tbody tr`)
    .map((tr) => tr.querySelectorAll('td').map((td) => words(td.textContent)));
const namesOf = (app: AppHarness, table: 'Built-in enzymes' | 'Custom enzymes') => rowsOf(app, table).map((r) => r[0]);

async function clickMenuPath(app: AppHarness, path: string[]): Promise<LiveElement> {
  const [top, ...rest] = path;
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => nameOf(b) === top || words(b.textContent) === top);
  if (!trigger) throw new Error(`the menu bar has no ${top} menu`);
  await app.click(trigger);
  for (const label of rest) {
    const popups = app.all('.desktop-menu-popup');
    const item = popups
      .flatMap((p) => p.querySelectorAll('button'))
      .find((b) => words(b.textContent).startsWith(label) && words(b.textContent).replace(label, '').trim().length < 3);
    if (!item) throw new Error(`no "${label}" in the open menu: ${popups.flatMap((p) => p.querySelectorAll('button')).map((b) => words(b.textContent)).join(' | ')}`);
    await app.click(item);
  }
  return trigger;
}
async function submenuLabels(app: AppHarness, path: string[]): Promise<string[]> {
  await clickMenuPath(app, path);
  const popups = app.all('.desktop-menu-popup');
  return popups[popups.length - 1].querySelectorAll('button').map((b) => words(b.textContent));
}

// ─── The store and the engine ───

const OLD_TIME = '2026-01-01T00:00:00.000Z';
function seeded(inputs: CustomEnzymeInput[]): LiveStorage {
  const storage = memoryStorage();
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => OLD_TIME, newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}
function stored(storage: LiveStorage): CustomEnzymeDefinition[] {
  const r = openEnzymeDatabase({ storage }).read();
  if (!r.ok) throw new Error(r.error.message);
  return r.definitions;
}
const rawStore = (storage: LiveStorage) => storage.getItem('molbiocraft.enzymeDatabase');

/** The catalogue as the engine returns it now, read afresh (not the App's module copy). */
const engineCatalogue = () => invokeRustBioSync<RestrictionEnzyme[]>('get_rebase_enzymes');
const catalogueRows = (cat: RestrictionEnzyme[]) => cat.map((e) => [e.name, 'Built-in', e.recognitionSeq, `${e.cutFwd}/${e.cutRev}`, `Clone ${e.name} as custom`]);
/** The built-in rows with each row's buttons named, so an edit or delete control would show. */
const builtInRowsWithButtons = (app: AppHarness) =>
  win(app)
    .querySelectorAll('table[aria-label="Built-in enzymes"] tbody tr')
    .map((tr) => [...tr.querySelectorAll('td').slice(0, 4).map((td) => words(td.textContent)), tr.querySelectorAll('button').map(nameOf).join(' | ')]);

const MY_BSA: CustomEnzymeInput = { name: 'MyBsa', recognitionSeq: 'GGTCTC', cutFwd: 7, cutRev: 11, isTypeIIS: true, provenance: 'lab notebook 4', notes: 'n1' };
const ZED: CustomEnzymeInput = { name: 'Zed', recognitionSeq: 'ACGTNNACGT', cutFwd: 2, cutRev: 8 };

// ─── The preview ───

const preview = (app: AppHarness) => app.one('section[aria-label="Cut preview"]', 'the cut preview');
const strand = (app: AppHarness, s: 'top' | 'bottom') => {
  const found = preview(app).querySelectorAll(`code[data-strand="${s}"]`);
  if (found.length !== 1) throw new Error(`the preview draws ${found.length} ${s} strands: ${words(preview(app).textContent)}`);
  return found[0].textContent ?? '';
};
const markedMotif = (app: AppHarness) => preview(app).querySelectorAll('[data-motif]').map((m) => m.textContent ?? '');
const previewWords = (app: AppHarness) => words(preview(app).textContent);
const probeLine = (app: AppHarness) => words(app.one('[data-preview-probe]', 'the probe line').textContent);

/** Opens Add and types a definition. */
async function typeDefinition(app: AppHarness, d: { name: string; motif: string; cutFwd: number | string; cutRev: number | string }) {
  await app.click(button(win(app), 'Add custom enzyme'));
  const f = editor(app);
  await app.input(field(f, 'Name'), d.name);
  await app.input(field(f, "Recognition motif (5' → 3')"), d.motif);
  await app.input(field(f, 'Top-strand cut (bases from the motif start)'), String(d.cutFwd));
  await app.input(field(f, 'Bottom-strand cut (bases from the motif start)'), String(d.cutRev));
}
const setFlank = async (app: AppHarness, side: 'Left' | 'Right', n: number) => app.input(field(editor(app), `${side} flank length`), String(n));
const setTopology = async (app: AppHarness, t: 'linear' | 'circular') => app.change(field(editor(app), 'Probe topology'), t);

/** The engine's last scan in this window, and its forward site at the planted motif (or undefined). */
function lastScan(app: AppHarness) {
  const call = engineScans.calls[engineScans.calls.length - 1];
  if (!call) throw new Error('the window never asked the engine for a scan');
  const planted = Number(/at bases (\d+)–/.exec(probeLine(app))?.[1]);
  return { call, planted, site: call.sites.find((s) => s.strand === 1 && s.position === planted) };
}

/** The one-declaration reader of US-01M7DVY6's origin-wrap constant (the BG-01M7FAQZ discipline). */
function declaredOriginWrap(source: string, path: string): number {
  if (source.trim() === '') throw new Error(`the Rust source declaring ORIGIN_WRAP_BASES is empty: ${path}`);
  // A candidate is a line that begins with the declaration, so the name inside a `///` comment is not one;
  // every candidate is counted, because a second spelling leaves this reader unable to tell which is meant.
  const declared = [...source.matchAll(/^pub const ORIGIN_WRAP_BASES:\s*usize\s*=\s*(\d+)\s*;/gm)];
  if (declared.length === 0) throw new Error(`no \`pub const ORIGIN_WRAP_BASES: usize = N;\` declaration in ${path}`);
  if (declared.length > 1) {
    throw new Error(`${declared.length} \`pub const ORIGIN_WRAP_BASES\` declarations in ${path}: this test cannot tell which one the scan reads, and adopts neither`);
  }
  return Number(declared[0][1]);
}
const CATALOG_RS = '../../crates/molbiocraft-cloning/src/rebase_catalog.rs';
function originWrapFromRust(): number {
  let source: string;
  try {
    source = readFileSync(new URL(CATALOG_RS, import.meta.url), 'utf8');
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    throw new Error(`the Rust source declaring ORIGIN_WRAP_BASES is ${code === 'ENOENT' ? 'missing' : `unreadable (${code ?? cause})`}: ${CATALOG_RS}`);
  }
  return declaredOriginWrap(source, CATALOG_RS);
}

// ─── AC1 ───

describe('Databases > Restriction Enzymes opens from every menu and lists both collections (US-01M7DVDV AC1)', () => {
  it('US-01M7DVDV AC1 both in-app Databases submenus open the window with no session open, keep their items, and closing returns focus to the opener', async () => {
    await withApp(seeded([MY_BSA]), async (app) => {
      expect(app.all('.mbc-menubar'), 'the in-window menu bar').toHaveLength(1);
      expect(await submenuLabels(app, ['Tools', 'Databases'])).toEqual([
        'NCBI & UniProt',
        'Primers',
        'Restriction Enzymes',
        'Make BLAST Database from Selection…',
        'Local BLAST DBs',
        'BLAST Setup',
      ]);
      await app.press('Escape');
      await app.press('Escape');
      await app.press('Escape');
      expect(await submenuLabels(app, ['File', 'Import Data', 'Databases'])).toEqual(['NCBI & UniProt', 'Primers', 'Restriction Enzymes']);
      await app.press('Escape');
      await app.press('Escape');
      await app.press('Escape');
      await app.press('Escape');

      expect(enzymeWindow(app)).toBeNull();
      const toolsOpener = await clickMenuPath(app, ['Tools', 'Databases', 'Restriction Enzymes']);
      expect(namesOf(app, 'Custom enzymes')).toEqual(['MyBsa']);
      await app.click(button(win(app), 'Close Restriction Enzymes'));
      expect(enzymeWindow(app)).toBeNull();
      expect(app.doc.activeElement === toolsOpener, `focus returns to the Tools menu button, not ${nameOf(app.doc.activeElement as LiveElement)}`).toBe(true);

      const fileOpener = await clickMenuPath(app, ['File', 'Import Data', 'Databases', 'Restriction Enzymes']);
      expect(namesOf(app, 'Custom enzymes')).toEqual(['MyBsa']);
      await app.press('Escape');
      expect(enzymeWindow(app)).toBeNull();
      expect(app.doc.activeElement === fileOpener, `focus returns to the File menu button, not ${nameOf(app.doc.activeElement as LiveElement)}`).toBe(true);
    });
  });

  it('US-01M7DVDV AC1 the native Databases submenu gains Restriction Enzymes after Primers, enabled and dispatched with no session', async () => {
    // The native Tools › Databases submenu, from the spec generated from the registry (US-01M6Q159, D0260).
    type NativeNode = { type: string; id?: string; label?: string; items?: NativeNode[] };
    const spec = JSON.parse(readFileSync(new URL('../../src-tauri/native-menu.json', import.meta.url), 'utf8')) as { menus: { label: string; items: NativeNode[] }[] };
    const tools = spec.menus.find((m) => m.label === 'Tools')?.items ?? [];
    const dbs = tools.find((n) => n.type === 'submenu' && n.label === 'Databases')?.items ?? [];
    expect(dbs.filter((n) => n.type === 'item').map((n) => `${n.id} ${n.label}`)).toEqual([
      'tools:databases-explorer NCBI & UniProt',
      'tools:primer-database Primers',
      'tools:enzyme-database Restriction Enzymes',
      'tools:make-blast-db Make BLAST Database from Selection…',
      'tools:local-blast-dbs Local BLAST DBs',
      'tools:blast-setup BLAST Setup',
    ]);
    const noSession = buildNativeMenuState({ sessionActive: false, activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0 });
    expect(resolveNativeMenuItemEnabled('tools:enzyme-database', noSession)).toBe(true);
    await withApp(seeded([MY_BSA]), async (app) => {
      await app.menu('tools:enzyme-database');
      expect(namesOf(app, 'Custom enzymes')).toEqual(['MyBsa']);
    });
  });

  it('US-01M7DVDV AC1 lists the built-in catalogue and the Custom collection apart, each row labelled by source, the built-ins with no edit or delete control', async () => {
    const storage = seeded([MY_BSA, ZED]);
    await withApp(storage, async (app) => {
      await app.menu('tools:enzyme-database');
      const cat = engineCatalogue();
      expect(cat.length).toBeGreaterThan(10);
      expect(builtInRowsWithButtons(app)).toEqual(catalogueRows(cat));
      const customs = win(app).querySelectorAll('table[aria-label="Custom enzymes"] tbody tr');
      expect(customs.map((tr) => [...tr.querySelectorAll('td').slice(0, 4).map((td) => words(td.textContent)), tr.querySelectorAll('button').map(nameOf).join(' | ')])).toEqual([
        ['MyBsa', 'Custom', 'GGTCTC', '7/11', 'Edit MyBsa'],
        ['Zed', 'Custom', 'ACGTNNACGT', '2/8', 'Edit Zed'],
      ]);
    });
  });

  it('US-01M7DVDV AC1 searching by name or motif narrows both lists', async () => {
    await withApp(seeded([MY_BSA, ZED]), async (app) => {
      await app.menu('tools:enzyme-database');
      const cat = engineCatalogue();
      const search = field(win(app), 'Search enzymes');
      const byMotif = (m: string) => cat.filter((e) => e.recognitionSeq.includes(m)).map((e) => e.name);
      const byName = (n: string) => cat.filter((e) => e.name.toLowerCase().includes(n.toLowerCase())).map((e) => e.name);
      expect(byMotif('GGTCTC').length, 'the catalogue holds a GGTCTC enzyme').toBeGreaterThan(0);
      expect(byName('eco').length, 'the catalogue holds an Eco enzyme').toBeGreaterThan(0);
      const cases: Array<[string, string[], string[]]> = [
        ['GGTCTC', byMotif('GGTCTC'), ['MyBsa']],
        ['ggt ctc', byMotif('GGTCTC'), ['MyBsa']],
        ['mybsa', [], ['MyBsa']],
        ['ACGTNN', byMotif('ACGTNN'), ['Zed']],
        ['eco', byName('eco'), []],
        ['', cat.map((e) => e.name), ['MyBsa', 'Zed']],
      ];
      for (const [query, builtIns, customs] of cases) {
        await app.input(search, query);
        expect(namesOf(app, 'Built-in enzymes'), `built-ins for "${query}"`).toEqual(builtIns);
        expect(namesOf(app, 'Custom enzymes'), `customs for "${query}"`).toEqual(customs);
      }
    });
  });

  it('US-01M7DVDV AC1 every control in the window, the editor and its preview included, has an accessible name and is reachable by keyboard', async () => {
    await withApp(seeded([MY_BSA]), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: engineCatalogue()[0].name, motif: 'GGTCTC', cutFwd: 7, cutRev: 11 });
      await app.click(button(editor(app), 'Save Enzyme'));
      // The clash confirmation is open too, so its controls are checked with the rest.
      expect(app.all('[role="group"][aria-label="Name clash"]')).toHaveLength(1);
      const controls = win(app).querySelectorAll('button, input, select, textarea, a[href]');
      expect(controls.length).toBeGreaterThan(20);
      for (const c of controls) {
        const labelled = nameOf(c) !== '' || words(c.closest('label')?.textContent) !== '';
        expect(labelled, `<${c.localName}> has an accessible name`).toBe(true);
        expect(Number(c.getAttribute('tabindex') ?? '0'), `${nameOf(c)} is in the tab order`).toBeGreaterThanOrEqual(0);
        expect(c.hasAttribute('disabled'), `${nameOf(c)} is enabled`).toBe(false);
        expect(c.getAttribute('type'), nameOf(c)).not.toBe('hidden');
      }
      // Escape closes the innermost thing first, the window last.
      await app.press('Escape');
      expect(app.all('[role="group"][aria-label="Name clash"]')).toHaveLength(0);
      expect(enzymeWindow(app)).not.toBeNull();
    });
  });

  it("US-01M7DVDV AC1 the built-in list after every custom-store write equals the engine's catalogue entry for entry and in order", async () => {
    const storage = seeded([MY_BSA]);
    await withApp(storage, async (app) => {
      await app.menu('tools:enzyme-database');
      const cat = engineCatalogue();
      const bsa = cat.find((e) => e.recognitionSeq === 'GGTCTC')!;
      const check = (when: string) => {
        expect(builtInRowsWithButtons(app), when).toEqual(catalogueRows(engineCatalogue()));
        expect(engineCatalogue(), `${when}: the engine's catalogue itself`).toEqual(cat);
      };
      check('on opening');
      // Write 1: a clone saved under the built-in's own name, with different offsets.
      await app.click(button(win(app), `Clone ${bsa.name} as custom`));
      await app.input(field(editor(app), 'Top-strand cut (bases from the motif start)'), '9');
      await app.click(button(editor(app), 'Save Enzyme'));
      await app.click(button(editor(app), `Keep Beside ${bsa.name}`));
      expect(stored(storage).map((d) => d.name)).toEqual(['MyBsa', bsa.name]);
      check('after a clone is saved under its name');
      // Write 2: an edit.
      await app.click(button(win(app), 'Edit MyBsa'));
      await app.input(field(editor(app), 'Bottom-strand cut (bases from the motif start)'), '12');
      await app.click(button(editor(app), 'Save Changes'));
      expect(stored(storage)[0].cutRev).toBe(12);
      check('after an edit');
    });
  });
});

// ─── AC2 ───

describe('Clone as custom (US-01M7DVDV AC2)', () => {
  const cloneSource = () => {
    const e = engineCatalogue().find((x) => x.recognitionSeq === 'GGTCTC' && x.methylationSensitivity.length > 0);
    if (!e) throw new Error('the catalogue holds no methylation-sensitive GGTCTC enzyme to clone');
    return e;
  };

  it('US-01M7DVDV AC2 opens the editor pre-filled from the built-in, and saving under its name asks first and stores a separate custom definition only once confirmed', async () => {
    const storage = memoryStorage();
    await withApp(storage, async (app) => {
      await app.menu('tools:enzyme-database');
      const src = cloneSource();
      await app.click(button(win(app), `Clone ${src.name} as custom`));
      const f = editor(app);
      expect(f.getAttribute('aria-label')).toBe(`Clone ${src.name} as custom`);
      expect(field(f, 'Name').value).toBe(src.name);
      expect(field(f, "Recognition motif (5' → 3')").value).toBe(src.recognitionSeq);
      expect(field(f, 'Top-strand cut (bases from the motif start)').value).toBe(String(src.cutFwd));
      expect(field(f, 'Bottom-strand cut (bases from the motif start)').value).toBe(String(src.cutRev));
      expect(field(f, 'Provenance').value).toContain(src.name);
      expect(words(app.one('[aria-label="Cloned from"]').textContent)).toBe(`Cloned from: ${src.name}`);
      expect(words(f.textContent)).toContain('it is given its own custom id when saved');
      for (const m of ['Dam', 'Dcm', 'CpG', 'EcoKI'] as const) {
        expect(field(f, `${m}-sensitive`).checked, m).toBe(src.methylationSensitivity.includes(m));
      }

      // Saving under the built-in's name, spelt in another case with spaces, asks first and writes nothing.
      await app.input(field(f, 'Name'), `  ${src.name.toLowerCase()} `);
      await app.click(button(editor(app), 'Save Enzyme'));
      const clash = app.one('[role="group"][aria-label="Name clash"]');
      expect(words(clash.textContent)).toContain(`is the name of the built-in enzyme ${src.name}`);
      expect(rawStore(storage)).toBeNull();
      // Cancelling the confirmation stores nothing.
      await app.click(button(clash, "Cancel saving under a built-in's name"));
      expect(app.all('[role="group"][aria-label="Name clash"]')).toHaveLength(0);
      expect(rawStore(storage)).toBeNull();

      await app.click(button(editor(app), 'Save Enzyme'));
      await app.click(button(editor(app), `Keep Beside ${src.name}`));
      const defs = stored(storage);
      expect(defs).toHaveLength(1);
      const d = defs[0];
      expect(d.id).toMatch(/^custom:./);
      expect(d).toMatchObject({
        source: 'custom',
        name: src.name.toLowerCase(),
        recognitionSeq: src.recognitionSeq,
        cutFwd: src.cutFwd,
        cutRev: src.cutRev,
        clonedFrom: src.name,
        sharesBuiltInName: src.name,
        methylationSensitivity: src.methylationSensitivity,
      });
      expect(d.provenance).toContain(src.name);
      expect(rowsOf(app, 'Custom enzymes')).toEqual([[src.name.toLowerCase(), 'Custom', src.recognitionSeq, `${src.cutFwd}/${src.cutRev}`, 'Edit']]);
      // The built-in entry is unchanged, in the window and in the engine.
      expect(engineCatalogue().find((e) => e.name === src.name)).toEqual(src);
      expect(builtInRowsWithButtons(app).find((r) => r[0] === src.name)).toEqual([src.name, 'Built-in', src.recognitionSeq, `${src.cutFwd}/${src.cutRev}`, `Clone ${src.name} as custom`]);
    });
  });

  it('US-01M7DVDV AC2 cancelling the editor stores nothing, and a second clone gets an id of its own', async () => {
    const storage = memoryStorage();
    await withApp(storage, async (app) => {
      await app.menu('tools:enzyme-database');
      const src = cloneSource();
      await app.click(button(win(app), `Clone ${src.name} as custom`));
      await app.click(button(editor(app), 'Cancel editing'));
      expect(app.all('[role="dialog"][aria-labelledby="enzyme-db-title"] form')).toHaveLength(0);
      expect(rawStore(storage)).toBeNull();
      for (const name of ['clone one', 'clone two']) {
        await app.click(button(win(app), `Clone ${src.name} as custom`));
        await app.input(field(editor(app), 'Name'), name);
        await app.click(button(editor(app), 'Save Enzyme'));
      }
      const defs = stored(storage);
      expect(defs.map((d) => [d.name, d.clonedFrom, d.sharesBuiltInName])).toEqual([
        ['clone one', src.name, undefined],
        ['clone two', src.name, undefined],
      ]);
      expect(new Set(defs.map((d) => d.id)).size).toBe(2);
    });
  });
});

// ─── AC3 ───

describe('The preview is a real engine scan of a probe built from the definition (US-01M7DVDV AC3)', () => {
  it('US-01M7DVDV AC3 the window draws the engine’s own site on the probe, motif resolved base by base, flanks fixed and sized to the reach plus 4', async () => {
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      engineScans.calls.length = 0;
      await typeDefinition(app, { name: 'Degen', motif: 'GRYSWKMBDHVNU', cutFwd: 15, cutRev: 17 });
      // Each degenerate letter planted as the first base it allows: R A, Y C, S C, W A, K G, M A, B C, D A, H A, V A, N A, U T.
      expect(probeLine(app)).toBe('Probe: 25 bases, linear, with the motif planted as GACCAGACAAAAT at bases 5–17.');
      expect(field(editor(app), 'Left flank length').value).toBe('4');
      expect(field(editor(app), 'Right flank length').value).toBe(String(17 - 13 + 4));
      const { call, site, planted } = lastScan(app);
      expect(call.topology).toBe('linear');
      expect(call.seq.slice(planted - 1, planted - 1 + 13)).toBe('GACCAGACAAAAT');
      expect(call.enzymes).toEqual([expect.objectContaining({ name: 'Degen', recognitionSeq: 'GRYSWKMBDHVNU', cutFwd: 15, cutRev: 17 })]);
      expect(site, 'the engine reported the planted site').toBeDefined();
      // The drawing is that site: its coordinates, cuts and overhang, read from the probe.
      expect(previewWords(app)).toContain(`Site GACCAGACAAAAT, bases 5–17, forward (+) strand`);
      expect(previewWords(app)).toContain(`Top strand cut after base ${site!.cutTop - 1}; bottom strand cut after base ${site!.cutBottom - 1}`);
      expect(previewWords(app)).toContain(`5' overhang, 2 nt: ${site!.overhangSeq}`);
      expect(site!.overhangSeq).toBe(call.seq.slice(4 + 15, 4 + 17));
      expect(strand(app, 'top').startsWith("5'-")).toBe(true);
      expect(strand(app, 'bottom').startsWith("3'-")).toBe(true);
      expect(markedMotif(app)).toEqual(['GACCAGACAAAAT']);
      expect(strand(app, 'top')).toContain('▼');
      expect(strand(app, 'bottom')).toContain('▲');

      // The flank bases are fixed: another definition with the same flank lengths has the same ones.
      const flanksOf = (seq: string, start: number, len: number) => [seq.slice(0, start), seq.slice(start + len)];
      const first = flanksOf(call.seq, 4, 13);
      await app.input(field(editor(app), "Recognition motif (5' → 3')"), 'TTTTTTTTTTTTT');
      const again = lastScan(app).call;
      expect(flanksOf(again.seq, 4, 13)).toEqual(first);
      expect(again.seq.slice(4, 17)).toBe('TTTTTTTTTTTTT');
    });
  });

  it('US-01M7DVDV AC3 the forward site drawn is the planted one, never an earlier match in the flanks', async () => {
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'Short', motif: 'GGAN', cutFwd: 2, cutRev: 2 });
      await setFlank(app, 'Left', 40);
      const { call, planted } = lastScan(app);
      expect(planted).toBe(41);
      const forward = call.sites.filter((s) => s.strand === 1).map((s) => s.position);
      // The fixture holds the trap: an earlier forward match in the left flank.
      expect(forward.length, `forward sites ${forward.join(', ')}`).toBeGreaterThan(1);
      expect(forward[0]).toBeLessThan(41);
      expect(previewWords(app)).toContain('Site GGAA, bases 41–44, forward (+) strand');
      expect(previewWords(app)).toContain('Top strand cut after base 42; bottom strand cut after base 42');
    });
  });

  it('US-01M7DVDV AC3 the preview is recomputed on every field change and never shown for a refused definition', async () => {
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'Live', motif: 'GAATTC', cutFwd: 1, cutRev: 5 });
      expect(previewWords(app)).toContain('Top strand cut after base 5; bottom strand cut after base 9');
      await app.input(field(editor(app), 'Top-strand cut (bases from the motif start)'), '2');
      expect(previewWords(app)).toContain('Top strand cut after base 6; bottom strand cut after base 9');
      await app.change(field(editor(app), 'Type IIS'), true);
      expect(previewWords(app)).toContain('Type IIS: cuts outside the GAATTC motif');
      await app.input(field(editor(app), "Recognition motif (5' → 3')"), 'GATC');
      expect(previewWords(app)).toContain('Site GATC, bases 5–8');
      expect(previewWords(app)).not.toContain('Methylation may block');
      await app.change(field(editor(app), 'Dam-sensitive'), true);
      expect(previewWords(app)).toContain('Methylation may block this cut (Live is Dam-sensitive)');
      await setTopology(app, 'circular');
      expect(probeLine(app)).toContain('circular');

      // Refused: no name, a letter outside IUPAC, a fractional offset, a motif past the limit.
      const refusals: Array<[string, string]> = [
        ['Name', ''],
        ["Recognition motif (5' → 3')", 'GAXTC'],
        ['Top-strand cut (bases from the motif start)', '1.5'],
        ["Recognition motif (5' → 3')", 'A'.repeat(MAX_CUSTOM_MOTIF_LENGTH + 1)],
      ];
      const valid: Record<string, string> = { Name: 'Live', "Recognition motif (5' → 3')": 'GATC', 'Top-strand cut (bases from the motif start)': '2' };
      for (const [label, bad] of refusals) {
        await app.input(field(editor(app), label), bad);
        expect(previewWords(app), `${label} = ${bad}`).toContain('No preview: the definition is not valid yet');
        expect(preview(app).querySelectorAll('code, [data-motif], pre'), `${label} = ${bad}`).toHaveLength(0);
        expect(previewWords(app)).not.toMatch(/[▼▲]/);
        await app.input(field(editor(app), label), valid[label]);
        expect(previewWords(app), `${label} restored`).toContain('Site GATC');
      }
    });
  });

  it('US-01M7DVDV AC3 a circular probe is never shorter than the motif plus its reach: the flank control stops at the reach', async () => {
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'Far', motif: 'GGTCTC', cutFwd: 7, cutRev: 11 });
      await setTopology(app, 'circular');
      const right = field(editor(app), 'Right flank length');
      expect(right.getAttribute('min')).toBe('5');
      expect(field(editor(app), 'Left flank length').getAttribute('min')).toBe('0');
      await setFlank(app, 'Right', 2);
      expect(field(editor(app), 'Right flank length').value).toBe('5');
      await setFlank(app, 'Left', 0);
      expect(probeLine(app)).toBe('Probe: 11 bases, circular, with the motif planted as GGTCTC at bases 1–6.');
      expect(lastScan(app).call.seq).toHaveLength(6 + 5);
      // Linear, the control goes below the reach (AC5's case).
      await setTopology(app, 'linear');
      expect(field(editor(app), 'Right flank length').getAttribute('min')).toBe('0');
    });
  });

  it("US-01M7DVDV AC3 the window's motif limit is the scan's origin wrap plus one, read from rebase_catalog.rs's one declaration", async () => {
    const wrap = originWrapFromRust();
    expect(MAX_CUSTOM_MOTIF_LENGTH).toBe(wrap + 1);
    // The reader refuses a source it cannot read one answer from, naming the file and the count.
    expect(() => declaredOriginWrap('/// pub const ORIGIN_WRAP_BASES: usize = 36;\nfn x() {}\n', 'a.rs')).toThrow(/no `pub const ORIGIN_WRAP_BASES: usize = N;` declaration in a\.rs/);
    expect(() => declaredOriginWrap('pub const ORIGIN_WRAP_BASES: usize = 36;\n/*\npub const ORIGIN_WRAP_BASES: usize = 40;\n*/\n', 'b.rs')).toThrow(/^2 `pub const ORIGIN_WRAP_BASES` declarations in b\.rs/);
    expect(() => declaredOriginWrap('  \n', 'c.rs')).toThrow(/empty: c\.rs/);
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'Long', motif: 'A'.repeat(wrap + 1), cutFwd: 0, cutRev: 0 });
      expect(words(editor(app).textContent)).toContain(`The motif may be up to ${wrap + 1} bases`);
      expect(previewWords(app)).toContain(`Site ${'A'.repeat(wrap + 1)}`);
      await app.input(field(editor(app), "Recognition motif (5' → 3')"), 'A'.repeat(wrap + 2));
      expect(words(editor(app).textContent)).toContain(`The motif is ${wrap + 2} bases; it may be at most ${wrap + 1}`);
      expect(previewWords(app)).toContain('No preview');
    });
  });
});

// ─── AC4 ───

describe('Offsets outside the motif are drawn where they fall (US-01M7DVDV AC4)', () => {
  /** Index of the first and last character of the marked motif in a drawn strand. */
  const motifAt = (line: string, motif: string) => {
    const i = line.indexOf(motif);
    expect(i, `${motif} in ${line}`).toBeGreaterThan(0);
    return { start: i, end: i + motif.length };
  };

  it("US-01M7DVDV AC4 GGTCTC with offsets 7 and 11 cuts 1 and 5 bases past the motif, leaving a 4-nt 5' overhang", async () => {
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'MyBsa', motif: 'GGTCTC', cutFwd: 7, cutRev: 11 });
      const top = strand(app, 'top');
      const bottom = strand(app, 'bottom');
      const m = motifAt(top, 'GGTCTC');
      // Top: one base past the motif, then ▼; four bases on, the blank column of the bottom cut.
      expect(top[m.end + 1]).toBe('▼');
      expect(top.slice(m.end + 2, m.end + 6)).toMatch(/^[ACGT]{4}$/);
      expect(top[m.end + 6]).toBe(' ');
      // Bottom: the blank column of the top cut one base past the motif, ▲ five bases past it.
      expect(bottom[m.end + 1]).toBe(' ');
      expect(bottom[m.end + 6]).toBe('▲');
      expect(top.indexOf('▼')).toBeGreaterThan(m.end);
      expect(previewWords(app)).toContain('Top strand cut after base 11; bottom strand cut after base 15');
      expect(previewWords(app)).toContain(`5' overhang, 4 nt: ${top.slice(m.end + 2, m.end + 6)}`);
      await app.change(field(editor(app), 'Type IIS'), true);
      expect(previewWords(app)).toContain('Type IIS: cuts outside the GGTCTC motif, top strand 1 nt and bottom strand 5 nt from it');
    });
  });

  for (const topology of ['linear', 'circular'] as const) {
    it(`US-01M7DVDV AC4 a negative offset is previewed, never refused, its cuts drawn before the motif on a ${topology} probe`, async () => {
      const storage = memoryStorage();
      await withApp(storage, async (app) => {
        await app.menu('tools:enzyme-database');
        await typeDefinition(app, { name: 'Before', motif: 'GTTCAG', cutFwd: -2, cutRev: -6 });
        await setTopology(app, topology);
        // Each flank at its least (a circle's left flank is then exactly the reach, its cut on the origin) and at the default.
        for (const left of topology === 'circular' ? [6, 10] : [10]) {
          await setFlank(app, 'Left', left);
          const top = strand(app, 'top');
          const bottom = strand(app, 'bottom');
          const m = motifAt(top, 'GTTCAG');
          expect(markedMotif(app)).toEqual(['GTTCAG']);
          expect(top.indexOf('▼'), top).toBeLessThan(m.start);
          expect(bottom.indexOf('▲'), bottom).toBeLessThan(m.start);
          expect(top.slice(m.end).includes('▼'), 'no top cut after the motif').toBe(false);
          expect(bottom.slice(m.end).includes('▲'), 'no bottom cut after the motif').toBe(false);
          // ▼ two bases before the motif, ▲ six before it.
          expect(top.slice(top.indexOf('▼') + 1, m.start).replace(/ /g, '')).toHaveLength(2);
          expect(bottom.slice(bottom.indexOf('▲') + 1, m.start).replace(/ /g, '')).toHaveLength(6);
          expect(previewWords(app)).toContain("3' overhang, 4 nt");
        }
        await app.click(button(editor(app), 'Save Enzyme'));
        expect(stored(storage).map((d) => [d.name, d.cutFwd, d.cutRev])).toEqual([['Before', -2, -6]]);
      });
    });
  }
});

// ─── AC5 ───

describe("A linear probe's end inside a cut's reach (US-01M7DVDV AC5)", () => {
  it("US-01M7DVDV AC5 the engine reports no site, so no cut is drawn: the probe's bases and how far past its end the cut falls", async () => {
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'MyBsa', motif: 'GGTCTC', cutFwd: 7, cutRev: 11 });
      await setFlank(app, 'Right', 3);
      const { call, site } = lastScan(app);
      expect(call.seq).toHaveLength(4 + 6 + 3);
      expect(site, 'the engine reports no site at the planted motif').toBeUndefined();
      expect(previewWords(app)).toContain("The cut falls 2 bases past the probe's end (after its last base) and cannot be previewed.");
      expect(previewWords(app)).not.toMatch(/[▼▲]/);
      expect(previewWords(app)).not.toContain('Site ');
      expect(preview(app).querySelectorAll('[data-motif], code[data-strand="top"], code[data-strand="bottom"]')).toHaveLength(0);
      expect(words(app.one('code[data-strand="probe-top"]').textContent)).toBe(`5'-${call.seq}-3'`);
      expect(app.one('code[data-strand="probe-bottom"]').textContent).toMatch(/^3'-[ACGT]{13}-5'$/);
      // At the reach the engine reports the site again, with the columns past the end left blank.
      await setFlank(app, 'Right', 5);
      expect(lastScan(app).site).toBeDefined();
      expect(previewWords(app)).toContain('Site GGTCTC, bases 5–10');
      expect(previewWords(app)).not.toContain('cannot be previewed');
    });
  });

  it('US-01M7DVDV AC5 with another match in the flank whose cut fits, the preview still draws no site, never that one', async () => {
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'Short', motif: 'GGAN', cutFwd: 6, cutRev: 6 });
      await setFlank(app, 'Left', 40);
      await setFlank(app, 'Right', 0);
      const { call, site } = lastScan(app);
      expect(site).toBeUndefined();
      expect(call.sites.filter((s) => s.strand === 1).length, 'the engine reports a flank site').toBeGreaterThan(0);
      expect(previewWords(app)).toContain("The cut falls 2 bases past the probe's end (after its last base) and cannot be previewed.");
      expect(previewWords(app)).not.toMatch(/[▼▲]/);
      expect(previewWords(app)).not.toContain('Site ');
    });
  });

  it('US-01M7DVDV AC5 on a circular probe the motif and both cuts are read through the origin', async () => {
    await withApp(memoryStorage(), async (app) => {
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'MyBsa', motif: 'GGTCTC', cutFwd: 7, cutRev: 11 });
      await setTopology(app, 'circular');
      await setFlank(app, 'Left', 0);
      await setFlank(app, 'Right', 0);
      const { call, site } = lastScan(app);
      expect(call.seq).toHaveLength(11);
      expect(site).toBeDefined();
      const top = strand(app, 'top');
      // The window opens 4 bases before the motif, read from the probe's end, and closes 4 past the bottom cut, read from its start.
      expect(top).toBe(`5'-${call.seq.slice(7)}${'GGTCTC'}${call.seq[6]}▼${call.seq.slice(7, 11)} ${call.seq.slice(0, 4)}-3'`);
      expect(previewWords(app)).toContain('Top strand cut after base 7; bottom strand cut after base 11');
      expect(previewWords(app)).toContain(`5' overhang, 4 nt: ${call.seq.slice(7, 11)}`);
    });
  });
});

// ─── AC6 ───

describe('Editing a stored definition (US-01M7DVDV AC6)', () => {
  it('US-01M7DVDV AC6 an edit keeps the id and changes only the edited fields and the modified time', async () => {
    const storage = seeded([MY_BSA, ZED]);
    const before = stored(storage);
    await withApp(storage, async (app) => {
      await app.menu('tools:enzyme-database');
      await app.click(button(win(app), 'Edit MyBsa'));
      const f = editor(app);
      expect(f.getAttribute('aria-label')).toBe('Edit MyBsa');
      expect(field(f, 'Name').value).toBe('MyBsa');
      await app.input(field(f, 'Bottom-strand cut (bases from the motif start)'), '12');
      await app.input(field(f, 'Notes'), 'n2');
      await app.click(button(editor(app), 'Save Changes'));
      const after = stored(storage);
      expect(after).toHaveLength(2);
      expect(after[0].modifiedAt).not.toBe(before[0].modifiedAt);
      expect(after[0]).toEqual({ ...before[0], cutRev: 12, notes: 'n2', modifiedAt: after[0].modifiedAt });
      expect(after[1]).toEqual(before[1]);
      expect(rowsOf(app, 'Custom enzymes')[0]).toEqual(['MyBsa', 'Custom', 'GGTCTC', '7/12', 'Edit']);

      // Saving with nothing changed writes nothing.
      const raw = rawStore(storage);
      await app.click(button(win(app), 'Edit Zed'));
      await app.click(button(editor(app), 'Save Changes'));
      expect(rawStore(storage)).toBe(raw);
    });
  });

  it('US-01M7DVDV AC6 a refused edit leaves the stored definition exactly as it was', async () => {
    const storage = seeded([MY_BSA]);
    const raw = rawStore(storage);
    await withApp(storage, async (app) => {
      await app.menu('tools:enzyme-database');
      for (const [label, bad] of [
        ["Recognition motif (5' → 3')", 'GGXTCTC'],
        ['Top-strand cut (bases from the motif start)', 'seven'],
        ['Name', ' '],
      ] as const) {
        await app.click(button(win(app), 'Edit MyBsa'));
        await app.input(field(editor(app), label), bad);
        await app.click(button(editor(app), 'Save Changes'));
        expect(rawStore(storage), `${label} = ${bad}`).toBe(raw);
        expect(app.all('[role="dialog"][aria-labelledby="enzyme-db-title"] form'), 'the editor stays open').toHaveLength(1);
        await app.click(button(editor(app), 'Cancel editing'));
      }
      // Renaming to a built-in's name is a clash: unconfirmed, nothing is written.
      const builtIn = engineCatalogue()[0].name;
      await app.click(button(win(app), 'Edit MyBsa'));
      await app.input(field(editor(app), 'Name'), builtIn);
      await app.click(button(editor(app), 'Save Changes'));
      expect(app.all('[role="group"][aria-label="Name clash"]')).toHaveLength(1);
      expect(rawStore(storage)).toBe(raw);
    });
  });

  it("US-01M7DVDV AC6 no add, clone or edit in the window changes any document's bases", async () => {
    const SEQ = 'TTGGTCTCAAGAATTCGGTACCAAGGTCTCTTAACCGG';
    const doc: SequenceDocument = {
      id: 'dvdv-doc', name: 'pDVDV', accession: '', description: '', sequence: SEQ, moleculeType: 'DNA', topology: 'circular', folder: 'Local',
      createdAt: '2026-11-16T00:00:00Z', updatedAt: '2026-11-16T00:00:00Z', features: [], primers: [], history: [],
    } as SequenceDocument;
    const storage = seeded([MY_BSA]);
    await withApp(storage, async (app) => {
      await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'sequence-view' });
      await app.menu('tools:enzyme-database');
      await typeDefinition(app, { name: 'New one', motif: 'GAATTC', cutFwd: 1, cutRev: 5 });
      await app.click(button(editor(app), 'Save Enzyme'));
      const src = engineCatalogue().find((e) => e.recognitionSeq === 'GGTCTC')!;
      await app.click(button(win(app), `Clone ${src.name} as custom`));
      await app.input(field(editor(app), 'Name'), 'cloned here');
      await app.click(button(editor(app), 'Save Enzyme'));
      await app.click(button(win(app), 'Edit MyBsa'));
      await app.input(field(editor(app), "Recognition motif (5' → 3')"), 'GAATTC');
      await app.click(button(editor(app), 'Save Changes'));
      expect(stored(storage).map((d) => d.name)).toEqual(['MyBsa', 'New one', 'cloned here']);
      await app.click(button(win(app), 'Close Restriction Enzymes'));

      const before = app.downloads().length;
      await app.menu('file:export-mbc-json');
      const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
      expect(files).toHaveLength(1);
      const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
      const docs = parseMbcWorkbench(await files[0].text()).envelope.documents;
      expect(docs.map((d) => [d.id, d.sequence, d.topology])).toEqual([[doc.id, SEQ, 'circular']]);
    });
  });
});
