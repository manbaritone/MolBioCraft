// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q1CF (D0015, D0017, D0244): ⌘1-⌘9 open the first nine studios in rail order, ⌥⌘1-⌥⌘3 switch
 * the map layout, ⌘S saves the session (⌥⌘S still does, shown in no menu) and ⇧⌘E exports GenBank, on
 * the in-window and the native menus alike. Each case drives the running App: the in-window menu bar
 * and its key dispatcher on a Linux host, the native menu ids and native menu state on a macOS host.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { STUDIOS, studioAvailability, type StudioEntry } from '../core/studioRegistry';
import { resolveNativeMenuItemEnabled } from '../core/commandAvailability';
import { OPERATION_LABELS, readOperationShortcuts, setOperationShortcut } from '../core/operationShortcuts';
import { resolveMenuNodeFunctionDescription } from '../data/menuFunctionDescriptions';
import { searchHelp } from '../data/helpTopics';
import { executeBioPipelineAsync } from '../core/bioPipelineEngine';
import { formatPlatformShortcut } from '../platform/osPlatform';
import { macHost, mountApp, type AppHarness, type MountOptions, type SessionSpec } from './appHarness';
import { memoryStorage, type LiveElement } from './liveDom';

vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));
vi.setConfig({ testTimeout: 120_000 });

const nodeFsSpec = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const MAIN_RS = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
const CHANGELOG = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const studio = (id: string): StudioEntry => STUDIOS.find((e) => e.id === id)!;
const NINE = STUDIOS.slice(0, 9);

const BASE: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', features: [], primers: [], history: [],
};
const CONSTRUCT = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG';
const PLASMID: SequenceDocument = {
  ...BASE, id: 'cf-plasmid', name: 'CF_Plasmid', accession: 'CF_1', topology: 'circular', sequence: CONSTRUCT.repeat(6),
  features: [{ id: 'f1', name: 'orf1', type: 'CDS', start: 1, end: 39, strand: 1, color: '#888888' }],
} as SequenceDocument;
const RNA: SequenceDocument = { ...BASE, id: 'cf-rna', name: 'CF_Rna', accession: 'CF_3', moleculeType: 'RNA', sequence: CONSTRUCT.replace(/T/g, 'U').repeat(4) } as SequenceDocument;
const PROTEIN: SequenceDocument = { ...BASE, id: 'cf-protein', name: 'CF_Protein', accession: 'CF_2', moleculeType: 'Protein', sequence: 'MKWVTFISLLFLFSSAYSRGVFRR' } as SequenceDocument;
/** A DNA Sanger trace, which every one of the first nine studios applies to. */
function traceDoc(): SequenceDocument {
  const calls = CONSTRUCT.repeat(4);
  const spacing = 12;
  const ch: Record<string, number[]> = {};
  for (const b of 'ACGT') ch[b] = new Array((calls.length + 1) * spacing).fill(0);
  const peakLocations = [...calls].map((b, i) => { const at = i * spacing + 6; ch[b][at] = 1000; return at; });
  return {
    ...BASE, id: 'cf-trace', name: 'CF_Trace.ab1', sequence: calls, folder: 'Sequencing Reads (Sanger/NGS)', documentKind: 'trace',
    chromatogram: { traceA: ch.A, traceC: ch.C, traceG: ch.G, traceT: ch.T, peakLocations, phredScores: calls.split('').map(() => 40), baseCalls: calls },
  } as SequenceDocument;
}
const TRACE = traceDoc();

async function withApp<T>(opts: MountOptions, session: SessionSpec | null, run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp(opts);
  try {
    if (session) await app.restoreSession(session);
    return await run(app);
  } finally {
    app.unmount();
  }
}
const one = (doc: SequenceDocument, viewerTab: SessionSpec['viewerTab']): SessionSpec => ({ documents: [doc], activeDocId: doc.id, viewerTab });
const currentStudio = (app: AppHarness) => app.railTabs().filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.getAttribute('data-studio'));
const status = (app: AppHarness) => words(app.all('.statusbar-toast-text').map((t) => t.textContent).join(' '));

interface MenuRow { label: string; key: string; checked: string | null; disabled: boolean }
const rowOf = (b: LiveElement): MenuRow => ({
  label: words(b.querySelectorAll('.desktop-menu-label')[0]?.textContent ?? b.textContent),
  key: words(b.querySelectorAll('kbd')[0]?.textContent ?? ''),
  checked: b.getAttribute('aria-checked'),
  disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true',
});
async function closeMenus(app: AppHarness) {
  for (let i = 0; i < 5 && app.all('.desktop-menu-popup').length; i++) await app.press('Escape');
}
/** Opens a menu (a menu bar menu, or a toolbar dropdown when `toolbar`) down `path` and reads the last popup's rows. */
async function menuRows(app: AppHarness, top: string, path: string[], toolbar = false): Promise<MenuRow[]> {
  const trigger = toolbar
    ? app.all('button.mbc-tool-btn').find((b) => words(b.textContent) === top)
    : app.all('.mbc-menubar [role="menuitem"]').find((b) => words(b.getAttribute('aria-label') ?? b.textContent) === top);
  if (!trigger) throw new Error(`no ${top} menu`);
  await app.click(trigger);
  for (const [depth, label] of path.entries()) {
    const item = app.all('.desktop-menu-popup')[depth]?.querySelectorAll('button').find((b) => rowOf(b).label === label);
    if (!item) throw new Error(`no ${label} under ${top} > ${path.slice(0, depth).join(' > ')}`);
    await app.click(item);
  }
  const popups = app.all('.desktop-menu-popup');
  const rows = popups[popups.length - 1].querySelectorAll('button').map(rowOf).filter((r) => r.label);
  await closeMenus(app);
  return rows;
}
async function keyboardRows(app: AppHarness): Promise<{ rows: [string, string][]; note: string }> {
  await app.menu('app:preferences');
  await app.click(app.one('#prefs-tab-keyboard', 'Preferences Keyboard tab'));
  const rows = app.all('tr.mbc-menu-shortcut-row').map((r): [string, string] => {
    const c = r.querySelectorAll('td');
    return [words(c[0].textContent), words(c[1].textContent)];
  });
  const panel = app.one('[aria-labelledby="prefs-tab-keyboard"]', 'Keyboard tab panel');
  return { rows, note: words(panel.querySelectorAll('.mbc-keyboard-remap-note')[0]?.textContent) };
}
const primaryDigit = /^(?:⌘|Ctrl\+)[1-9]$/;

describe('US-01M6Q1CF AC1: ⌘1 to ⌘9 open the first nine studios in rail order', () => {
  it('US-01M6Q1CF AC1 Ctrl+1 to Ctrl+9 open the first nine studios, and View > Studios lists all 11 with the keys on nine', async () => {
    expect(NINE.map((e) => e.name)).toEqual(['Sequence Map', 'Annotations', 'Flatfile', 'Cloning & Gel', 'Vectors & Architect',
      'Primers & CRISPR', 'Alignment', 'Phylogenetics', 'Sanger & Contig']);
    for (const e of NINE) expect(studioAvailability(e, TRACE), e.name).toEqual({ ok: true });
    await withApp({}, one(TRACE, 'text-view'), async (app) => {
      expect(currentStudio(app)).toEqual(['flatfile']);
      // From Flatfile: 2 to 9, then 1, so every press moves the view.
      for (const d of [2, 4, 5, 6, 7, 8, 9, 3, 1]) {
        await app.press(String(d), { mod: true });
        expect(currentStudio(app), `Ctrl+${d}`).toEqual([NINE[d - 1].id]);
      }
      const rows = await menuRows(app, 'View', ['Studios']);
      expect(rows.map((r) => [r.label, r.key])).toEqual(STUDIOS.map((e, i) => [e.name, i < 9 ? `Ctrl+${i + 1}` : '']));
      expect(STUDIOS.slice(9).map((e) => e.name)).toEqual(['Protein & 3D', 'Pipelines & NGS']);
    });
  });

  it('US-01M6Q1CF AC1 on macOS the native View > Studios ids open the same studios and the menus read ⌘1 to ⌘9', async () => {
    await withApp(macHost(), one(TRACE, 'text-view'), async (app) => {
      for (const e of [...NINE.slice(1), NINE[0]]) {
        await app.menu(`view:studio-${e.id}`);
        expect(currentStudio(app), e.id).toEqual([e.id]);
      }
      const { rows } = await keyboardRows(app);
      expect(rows.filter((r) => primaryDigit.test(r[1]))).toEqual(NINE.map((e, i) => [`View > Studios > ${e.name}`, `⌘${i + 1}`]));
    });
  });
});

describe('US-01M6Q1CF AC2: ⌥⌘1 to ⌥⌘3 switch the map layout', () => {
  it('US-01M6Q1CF AC2 Ctrl+Alt+1, 2 and 3 open Sequence Map in Split, Circular and Linear from Alignment', async () => {
    await withApp({}, one(PLASMID, 'sequence-alignment'), async (app) => {
      const layouts = ['Split Map & Sequence', 'Circular Map', 'Linear Sequence'];
      for (const [i, label] of [[2, layouts[2]], [1, layouts[1]], [0, layouts[0]], [2, layouts[2]]] as const) {
        await app.press('7', { mod: true });
        expect(currentStudio(app)).toEqual(['alignment']);
        await app.press(String(i + 1), { mod: true, alt: true });
        expect(currentStudio(app), `Ctrl+Alt+${i + 1}`).toEqual(['sequence-map']);
        const rows = (await menuRows(app, 'View', ['Map Layout'])).slice(0, 3);
        expect(rows.map((r) => [r.label, r.key, r.checked])).toEqual(layouts.map((l, j) => [l, `Ctrl+Alt+${j + 1}`, String(l === label)]));
      }
      const studioViews = await menuRows(app, 'View', ['Studio Views']);
      const mapLayout = await menuRows(app, 'View', ['Map Layout']);
      expect([...studioViews, ...mapLayout].filter((r) => primaryDigit.test(r.key))).toEqual([]);
    });
  });
});

describe('US-01M6Q1CF AC3: ⌘S saves the session and ⇧⌘E exports GenBank, and every menu says so', () => {
  it('US-01M6Q1CF AC3 Ctrl+S saves the session, Ctrl+Shift+E exports GenBank and Ctrl+Alt+S still saves', async () => {
    await withApp({}, one(PLASMID, 'sequence-view'), async (app) => {
      const kinds = () => app.downloads().map((d) => d.filename.replace(/^.*\./, ''));
      await app.press('s', { mod: true });
      expect(kinds(), 'Ctrl+S').toEqual(['mbc']);
      await app.press('e', { mod: true, shift: true });
      expect(kinds(), 'Ctrl+Shift+E').toEqual(['mbc', 'gb']);
      expect(await app.downloads()[1].text()).toMatch(/^LOCUS\s+CF_Plasmid/);
      await app.press('s', { mod: true, alt: true });
      expect(kinds(), 'Ctrl+Alt+S').toEqual(['mbc', 'gb', 'mbc']);
    });
  });

  it('US-01M6Q1CF AC3 File, toolbar Export and toolbar Session show Ctrl+S on Save Session and Ctrl+Shift+E on Export GenBank, and no menu shows Ctrl+Alt+S', async () => {
    await withApp({}, one(PLASMID, 'sequence-view'), async (app) => {
      const key = (rows: MenuRow[], label: string) => rows.filter((r) => r.label === label).map((r) => r.key);
      const fileSave = await menuRows(app, 'File', ['Save Session']);
      expect(key(fileSave, 'Save Session')).toEqual(['Ctrl+S']);
      expect(key(fileSave, 'Save Session As')).toEqual(['Ctrl+Alt+Shift+S']);
      expect(key(await menuRows(app, 'File', ['Export Sequences']), 'Export GenBank')).toEqual(['Ctrl+Shift+E']);
      const tbExportSession = await menuRows(app, 'Export', ['Session'], true);
      expect(key(tbExportSession, 'Save Session')).toEqual(['Ctrl+S']);
      expect(key(await menuRows(app, 'Export', ['Sequence Files'], true), 'Export GenBank')).toEqual(['Ctrl+Shift+E']);
      const tbSession = await menuRows(app, 'Session', ['Save Session'], true);
      expect(key(tbSession, 'Save Session')).toEqual(['Ctrl+S']);
      const every = [...fileSave, ...tbExportSession, ...tbSession];
      expect(every.filter((r) => r.key === 'Ctrl+Alt+S')).toEqual([]);
    });
  });

  it('US-01M6Q1CF AC3 with the native macOS menu bar ⌥⌘S runs Save Session as the native item does', async () => {
    const run = (act: (app: AppHarness) => Promise<void>) => withApp(macHost(), one(PLASMID, 'sequence-view'), async (app) => {
      const state = () => ({ status: status(app), files: app.downloads().map((d) => d.filename) });
      const before = state();
      await act(app);
      await app.settle();
      return { before, after: state() };
    });
    const pressed = await run((app) => app.press('s', { mod: true, alt: true }));
    const chosen = await run((app) => app.menu('file:save-session'));
    expect(pressed.after, '⌥⌘S does something').not.toEqual(pressed.before);
    expect(pressed.after).toEqual(chosen.after);
  });
});

describe('US-01M6Q1CF AC5: a studio key on a document it does not fit does nothing but say why, on both menus', () => {
  it('US-01M6Q1CF AC5 Ctrl+4 on a protein keeps the view and shows the registry reason', async () => {
    const reason = studioAvailability(studio('cloning-gel'), PROTEIN);
    expect(reason.ok).toBe(false);
    await withApp({}, one(PROTEIN, 'sequence-view'), async (app) => {
      await app.press('4', { mod: true });
      expect(currentStudio(app)).toEqual(['sequence-map']);
      expect(status(app)).toContain((reason as { reason: string }).reason);
      // The key itself refuses, so no view is requested: the redirect notice a refused view request
      // gets ("... Select a document it applies to.") never shows.
      expect(status(app)).not.toContain('Select a document it applies to.');
    });
  });

  it('US-01M6Q1CF AC5 the native state the App sends disables Cloning & Gel for a protein and enables it for DNA', async () => {
    for (const [doc, cloning] of [[PROTEIN, false], [PLASMID, true]] as const) {
      await withApp(macHost(), one(doc, 'sequence-view'), async (app) => {
        const states = app.nativeMenuStates();
        expect(states.length).toBeGreaterThan(0);
        const last = states[states.length - 1];
        expect(resolveNativeMenuItemEnabled('view:studio-cloning-gel', last), doc.name).toBe(cloning);
        expect(resolveNativeMenuItemEnabled('view:studio-sequence-map', last), doc.name).toBe(true);
        await app.menu('view:studio-cloning-gel');
        expect(currentStudio(app), doc.name).toEqual([cloning ? 'cloning-gel' : 'sequence-map']);
      });
    }
  });
});

describe('US-01M6Q1CF AC6: the remapped commands carry one label on both menus', () => {
  const nativeLabel = (id: string) => {
    const m = MAIN_RS.match(new RegExp(`item\\(\\s*"${id}",\\s*"([^"]+)"`));
    if (!m) throw new Error(`main.rs has no item ${id}`);
    return m[1];
  };
  it('US-01M6Q1CF AC6 native and in-window labels agree for the layouts, Save Session, Export GenBank, History and each studio', async () => {
    await withApp({}, one(PLASMID, 'sequence-view'), async (app) => {
      const studios = await menuRows(app, 'View', ['Studios']);
      expect(STUDIOS.map((e) => nativeLabel(`view:studio-${e.id}`))).toEqual(studios.map((r) => r.label));
      const layout = (await menuRows(app, 'View', ['Map Layout'])).slice(0, 3).map((r) => r.label);
      expect(['view:layout-split', 'view:layout-circular', 'view:layout-linear'].map(nativeLabel)).toEqual(layout);
      expect(layout[0]).toBe('Split Map & Sequence');
      const views = (await menuRows(app, 'View', ['Studio Views'])).map((r) => r.label);
      expect(views).toContain('History');
      expect(nativeLabel('view:lineage')).toBe('History');
      expect((await menuRows(app, 'File', ['Save Session'])).map((r) => r.label)).toContain(nativeLabel('file:save-session'));
      expect((await menuRows(app, 'File', ['Export Sequences'])).map((r) => r.label)).toContain(nativeLabel('file:save-gb'));
    });
    for (const label of ['History', 'Studios']) {
      const d = resolveMenuNodeFunctionDescription('menu-test-id', label, undefined, label === 'Studios');
      expect(d.length, label).toBeGreaterThanOrEqual(12);
      expect(d, `${label} has its own description`).not.toMatch(/^(Run|Browse) /);
    }
  });
});

describe('US-01M6Q1CF AC7: Help lists the new keys and explains the change', () => {
  it('US-01M6Q1CF AC7 the Keyboard tab lists the studio, layout, save and export keys and opens with a note', async () => {
    for (const os of ['linux', 'macos'] as const) {
      await withApp(os === 'macos' ? macHost() : {}, one(PLASMID, 'sequence-view'), async (app) => {
        const f = (k: string, m?: { alt?: boolean; shift?: boolean }) => formatPlatformShortcut(k, os, m);
        const { rows, note } = await keyboardRows(app);
        expect(rows.filter((r) => primaryDigit.test(r[1])), os).toEqual(NINE.map((e, i) => [`View > Studios > ${e.name}`, f(String(i + 1))]));
        expect(rows.filter((r) => /^View > Map Layout > /.test(r[0]) && r[1] !== f('0', { shift: true }))).toEqual([
          ['View > Map Layout > Split Map & Sequence', f('1', { alt: true })],
          ['View > Map Layout > Circular Map', f('2', { alt: true })],
          ['View > Map Layout > Linear Sequence', f('3', { alt: true })],
        ]);
        expect(rows.filter((r) => r[1] === f('S'))).toEqual([['File > Save Session > Save Session', f('S')]]);
        expect(rows.filter((r) => r[1] === f('E', { shift: true }))).toEqual([['File > Export Sequences > Export GenBank', f('E', { shift: true })]]);
        for (const k of [f('1'), f('9'), f('1', { alt: true }), f('3', { alt: true }), f('S'), f('E', { shift: true }), f('S', { alt: true })]) {
          expect(note, `${os} note names ${k}`).toContain(k);
        }
        expect(note).toMatch(/changed/i);
      });
    }
  });

  it('US-01M6Q1CF AC7 the Help panel search for "shortcut" finds a topic naming the four changes', async () => {
    const hits = searchHelp('shortcut').filter((h) => /⌘1/.test(h.topic.summary));
    expect(hits).toHaveLength(1);
    await withApp({}, one(PLASMID, 'sequence-view'), async (app) => {
      await app.press('F1');
      await app.input(app.one('input.mbc-help-search'), 'shortcut');
      const title = app.all('.mbc-help-result-title').find((b) => words(b.textContent) === hits[0].topic.title);
      expect(title).toBeTruthy();
      await app.click(title!);
      const text = words(title!.closest('.mbc-help-result')!.textContent);
      for (const k of ['⌘1', '⌘9', 'Ctrl+1', '⌥⌘1', '⌥⌘3', 'Ctrl+Alt+1', '⌘S', 'Ctrl+S', '⇧⌘E', 'Ctrl+Shift+E', 'Save Session', 'Export GenBank', 'map layout']) {
        expect(text, k).toContain(k);
      }
    });
  });
});

describe('US-01M6Q1CF AC8: the changelog announces the remap', () => {
  it('US-01M6Q1CF AC8 a Changed entry in [Unreleased] names every remapped key on both platforms', () => {
    const unreleased = CHANGELOG.slice(CHANGELOG.indexOf('## [Unreleased]'), CHANGELOG.indexOf('\n## [', CHANGELOG.indexOf('## [Unreleased]') + 5));
    const changed = unreleased.slice(unreleased.indexOf('### Changed'));
    const section = changed.slice(0, changed.indexOf('\n### ', 5) > 0 ? changed.indexOf('\n### ', 5) : undefined);
    const entry = section.split('\n').filter((l) => l.startsWith('- ') && l.includes('⌘1'));
    expect(entry).toHaveLength(1);
    for (const k of ['⌘1', '⌘9', 'Ctrl+1', 'Ctrl+9', '⌥⌘1', '⌥⌘3', 'Ctrl+Alt+1', 'Ctrl+Alt+3', '⌘S', 'Ctrl+S', '⇧⌘E', 'Ctrl+Shift+E', '⌥⌘S', 'Save Session', 'Export GenBank', 'next release']) {
      expect(entry[0], k).toContain(k);
    }
    // No other [Unreleased] entry may still say the ⌘-digit shortcuts are unchanged: the notes become
    // the release body, and the remap above makes that sentence false (round-1 review of US-01M6Q1CF).
    expect(unreleased.split(/(?<=\.)\s+/).filter((s) => /shortcuts are unchanged/i.test(s))).toEqual([]);
  });
});

describe('US-01M6Q1CF AC9: no label still names a ⌘-digit the remap gave to a studio', () => {
  it('US-01M6Q1CF AC9 the History studio sub-tabs and headings name no ⌘-digit, for DNA and RNA', async () => {
    for (const doc of [PLASMID, RNA]) {
      await withApp({}, one(doc, 'history-hybrid'), async (app) => {
        // US-01M7QC8Q: History has no sub-tabs; its former panels are read in the hosts that mount them.
        expect(app.canvas().querySelectorAll('button[role="tab"]'), `${doc.name}: no sub-tab in History`).toHaveLength(0);
        const headings = () => app.canvas().querySelectorAll('h2, h3, h4, button.method-tab-btn').map((h) => words(h.textContent));
        const seen: string[] = [...headings()];
        expect(seen.some((s) => s.startsWith('Construct History Tree')), doc.name).toBe(true);
        const moved = doc === PLASMID ? ['view:secondary-structure', 'view:enzymes'] : ['view:secondary-structure'];
        for (const id of moved) {
          await app.menu(id);
          seen.push(...headings());
        }
        expect(seen.some((s) => s.startsWith('Nucleic-Acid Fold')), `${doc.name}: the folding panel was read`).toBe(true);
        if (doc === PLASMID) expect(seen.some((s) => s.startsWith('Enzymes View')), 'the Enzymes view was read').toBe(true);
        expect(seen.filter((s) => /⌘\s*\d/.test(s)), doc.name).toEqual([]);
      });
    }
  });

  it('US-01M6Q1CF AC9 the protein-expression pipeline run by the WASM engine names Open RNA/DNA Folding with no key', async () => {
    const report = await executeBioPipelineAsync(PLASMID, 'multihost-protein-mrna');
    const labels = report.steps.map((s) => s.targetStudioLabel);
    expect(labels).toContain('Open RNA/DNA Folding');
    expect(labels.filter((l) => /⌘\s*\d/.test(l))).toEqual([]);
  });
});

describe('US-01M6Q1CF AC10: an operation shortcut cannot take a studio or map-layout key', () => {
  it('US-01M6Q1CF AC10 ⌘9 and ⌥⌘2 are refused, and a saved ⌥⌘1 is released on load with a notice naming the operation', async () => {
    const op = Object.keys(OPERATION_LABELS)[0] as keyof typeof OPERATION_LABELS;
    globalThis.localStorage?.removeItem('molbiocraft.operationShortcuts.v1');
    for (const combo of ['Mod+9', 'Mod+Alt+1', 'Mod+Alt+2', 'Mod+Alt+3']) {
      expect(setOperationShortcut(op, combo), combo).toBe('That shortcut is already used by MolBioCraft.');
    }
    expect(setOperationShortcut(op, 'Mod+Alt+Shift+9')).toBeNull();
    const storage = memoryStorage();
    storage.setItem('molbiocraft.operationShortcuts.v1', JSON.stringify({ shortcuts: { [op]: 'Mod+Alt+1', 'build-tree': 'Mod+Alt+Shift+8' }, toolbar: [] }));
    await withApp({ storage }, null, async (app) => {
      await app.settle();
      expect(status(app)).toContain(OPERATION_LABELS[op]);
      expect(status(app)).not.toContain(OPERATION_LABELS['build-tree']);
      const saved = JSON.parse(storage.getItem('molbiocraft.operationShortcuts.v1')!) as { shortcuts: Record<string, string> };
      expect(saved.shortcuts).toEqual({ 'build-tree': 'Mod+Alt+Shift+8' });
      expect(readOperationShortcuts().shortcuts[op]).toBeUndefined();
    });
  });
});

void React;
