// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q1N2: the in-window menubar, the toolbar dropdowns and ⌘K are projections of one command
 * registry (src/core/commandRegistry.ts), and the operation shortcuts are refused exactly its keys.
 * The real App is mounted (Linux key conventions); the menubar trees are the ones the shortcut
 * dispatcher binds, the toolbar items are the ones each dropdown draws, and ⌘K is read from its DOM.
 */

import { readFileSync } from 'node:fs';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, type LiveElement } from './liveDom';
import { DOC_TABLE_COLUMN_PRESETS } from '../core/workbenchBatchOperations';
import {
  COMMANDS, COMMAND_BY_ID, PLATFORM_SHORTCUTS, isGeneratedCommand, SECOND_KEYS, TOOLBAR_GROUPS, formatCommandShortcut, menubarNodeAt,
  registryShortcuts, type RegistryMenuNode, type ToolbarGroupId,
} from '../core/commandRegistry';
import { collectMenuShortcutBindings } from '../core/menuShortcuts';
import { RESERVED_SHORTCUTS, setOperationShortcut } from '../core/operationShortcuts';
import { STUDIOS } from '../core/studioRegistry';

const probe = vi.hoisted(() => ({ trees: [] as unknown[], popups: new Map<string, unknown>() }));
vi.mock('../core/menuShortcuts', async () => {
  const actual = await vi.importActual<typeof import('../core/menuShortcuts')>('../core/menuShortcuts');
  return {
    ...actual,
    collectMenuShortcutBindings: (trees: Parameters<typeof actual.collectMenuShortcutBindings>[0]) => {
      probe.trees = trees as unknown[];
      return actual.collectMenuShortcutBindings(trees);
    },
  };
});
vi.mock('../components/CascadingMenu', async () => {
  const actual = await vi.importActual<typeof import('../components/CascadingMenu')>('../components/CascadingMenu');
  const Popup = actual.CascadingMenuPopup;
  return {
    ...actual,
    CascadingMenuPopup: (p: Parameters<typeof Popup>[0]) => {
      if (p.ariaLabel) probe.popups.set(p.ariaLabel, p.items);
      return Popup(p);
    },
  };
});

type Node = RegistryMenuNode;
const TOP = ['MolBioCraft', 'File', 'Edit', 'View', 'Sequence', 'Cloning', 'Tools', 'Help'];
/** Each toolbar dropdown by the aria-label its popup carries. */
const TOOLBAR: Record<ToolbarGroupId, string> = {
  add: 'Add & New Session Menu', import: 'Import Menu', export: 'Export Menu', session: 'Session Menu', workflows: 'Workflows Menu',
  align: 'Alignment Menu', tree: 'Phylogenetic Tree Menu', primers: 'Primers and CRISPR Menu', cloning: 'Cloning Menu',
};
const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const menubar = () => probe.trees as Node[][];

interface Leaf { node: Node; path: string[]; disabled: boolean }
function leaves(nodes: readonly Node[], path: string[] = [], disabled = false, out: Leaf[] = []): Leaf[] {
  for (const n of nodes) {
    const off = disabled || Boolean(n.disabled);
    if (n.kind === 'submenu' && n.children) leaves(n.children, [...path, n.label ?? ''], off, out);
    else if ((n.kind === 'command' || n.kind === 'checkbox') && n.id) out.push({ node: n, path: [...path, n.label ?? ''], disabled: off });
  }
  return out;
}
const menubarLeaves = () => menubar().flatMap((t, i) => leaves(t, [TOP[i]]));

interface PaletteItem { id: string | null; studio: string | null; label: string; path: string; key: string; disabled: boolean; reason: string; el: LiveElement }
async function palette(app: AppHarness, query: string): Promise<PaletteItem[]> {
  if (!app.all('.mbc-cmd-palette-input').length) await app.press('k', { mod: true });
  await app.input(app.one('.mbc-cmd-palette-input', 'the ⌘K field'), query);
  return app.all('.mbc-cmd-palette-item').map((el) => ({
    id: el.getAttribute('data-command-id'),
    studio: el.getAttribute('data-studio'),
    label: words(el.querySelector('strong')?.textContent),
    path: words(el.querySelector('.mbc-cmd-palette-path')?.textContent),
    key: words(el.querySelector('.mbc-cmd-palette-key')?.textContent),
    disabled: el.getAttribute('aria-disabled') === 'true',
    reason: words(el.querySelector('.mbc-cmd-palette-reason')?.textContent),
    el,
  }));
}
async function paletteCommand(app: AppHarness, label: string, id: string): Promise<PaletteItem> {
  const hit = (await palette(app, label)).filter((i) => i.id === id);
  if (hit.length !== 1) throw new Error(`⌘K "${label}" lists ${hit.length} items with id ${id}`);
  return hit[0];
}
async function closePalette(app: AppHarness) {
  if (app.all('.mbc-cmd-palette-input').length) await app.press('Escape');
}
async function openToolbar(app: AppHarness): Promise<Record<ToolbarGroupId, Node[]>> {
  probe.popups.clear();
  for (const b of app.all('button.mbc-tool-btn')) await app.click(b);
  const out = {} as Record<ToolbarGroupId, Node[]>;
  for (const [id, aria] of Object.entries(TOOLBAR) as [ToolbarGroupId, string][]) {
    const items = probe.popups.get(aria) as Node[] | undefined;
    if (!items) throw new Error(`the toolbar drew no ${aria}`);
    out[id] = items;
  }
  return out;
}
const linuxKey = (id: string) => formatCommandShortcut(COMMAND_BY_ID.get(id)?.shortcut, 'linux') ?? '';

const BASE: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'circular', folder: 'Local',
  createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', features: [], primers: [], history: [],
} as SequenceDocument;
const PLASMID = { ...BASE, id: 'cr-dna', name: 'CR_Plasmid', accession: 'CR_1', sequence: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGA'.repeat(4) } as SequenceDocument;
const PROTEIN = { ...BASE, id: 'cr-prot', name: 'CR_Protein', accession: 'CR_2', moleculeType: 'Protein', topology: 'linear', sequence: 'MKWVTFISLLFLFSSAYSRGVFRR' } as SequenceDocument;

describe('US-01M6Q1N2 AC1: every surface shows the registry label and shortcut', () => {
  it('US-01M6Q1N2 AC1 every surface shows the registry label and shortcut for a shared command', async () => {
    const app = await mountApp();
    try {
      await app.menu('new-session:sample-library');
      const bar = menubarLeaves();
      expect(bar.length, 'the menubar has its commands').toBeGreaterThan(300);
      const toolbar = await openToolbar(app);
      const tb = Object.values(toolbar).flatMap((items) => leaves(items));
      const seen = new Map<string, { label: string; key: string; where: string }>();
      const check = (id: string, label: string, key: string, where: string) => {
        const spec = COMMAND_BY_ID.get(id);
        if (!spec) {
          expect(isGeneratedCommand(id), `${where}: ${id} (${label}) is a registry command or a generated one`).toBe(true);
          expect(key, `${where}: generated ${id} takes no key`).toBe('');
        } else {
          if (!spec.dynamicLabel) expect(label, `${where}: ${id}'s label`).toBe(spec.label);
          expect(key, `${where}: ${id}'s shortcut`).toBe(linuxKey(id));
        }
        const first = seen.get(id);
        if (first) expect({ label, key }, `${id} in ${where} and ${first.where}`).toEqual({ label: first.label, key: first.key });
        else seen.set(id, { label, key, where });
      };
      // A row's key is the one it binds, or the one it shows for another listener (the Command Palette's ⌘K).
      for (const l of bar) check(l.node.id!, l.node.label ?? '', l.node.shortcut ?? l.node.shortcutHint ?? '', 'menubar');
      for (const l of tb) check(l.node.id!, l.node.label ?? '', l.node.shortcut ?? l.node.shortcutHint ?? '', 'toolbar');
      // ⌘K: every command the toolbar shows, each found by its label.
      const shared = [...new Map(tb.map((l) => [l.node.id!, l])).values()].filter((l) => !isGeneratedCommand(l.node.id!));
      expect(shared.length, 'the toolbar shares commands with the menubar').toBeGreaterThan(60);
      for (const l of shared) {
        const item = await paletteCommand(app, l.node.label ?? '', l.node.id!);
        check(item.id!, item.label, item.key, '⌘K');
      }
      // The example the criterion names: Export GenBank reads Ctrl+Shift+E on all three.
      const gb = bar.find((l) => l.node.id === 'file-exp-gb');
      expect(gb?.path.join(' › ')).toBe('File › Export Sequences › Export GenBank');
      expect(gb?.node.shortcut).toBe('Ctrl+Shift+E');
      expect(leaves(toolbar.export).find((l) => l.node.label === 'Export GenBank')?.node.shortcut, 'Export ▾').toBe('Ctrl+Shift+E');
      expect((await paletteCommand(app, 'Export GenBank', 'file-exp-gb')).key, '⌘K').toBe('Ctrl+Shift+E');
      await closePalette(app);
      // Every key binding the dispatcher honours is a registry command's shortcut, and every registry
      // shortcut is bound.
      const bindings = collectMenuShortcutBindings(menubar() as never);
      for (const b of bindings) expect(linuxKey(b.id), `binding ${b.id}`).not.toBe('');
      const bound = new Set(bindings.map((b) => COMMAND_BY_ID.get(b.id)!.shortcut));
      expect([...new Set(COMMANDS.flatMap((c) => (c.shortcut ? [c.shortcut] : [])))].filter((s) => s !== 'F1' && s !== 'Mod+K' && !bound.has(s)), 'registry keys no binding takes (F1 and ⌘K have their own listeners, D0255 (2))').toEqual([]);
    } finally {
      app.unmount();
    }
  }, 300_000);
});

describe('US-01M6Q1N2 AC2: ⌘K finds every menubar command by its path', () => {
  it('US-01M6Q1N2 AC2 ⌘K finds every menubar command leaf with its path and shortcut, every studio and every document', async () => {
    const app = await mountApp();
    try {
      await app.menu('new-session:sample-library');
      const bar = menubarLeaves();
      const missing: string[] = [];
      for (const l of bar) {
        const hit = (await palette(app, l.node.label ?? '')).filter((i) => i.id === l.node.id);
        if (hit.length !== 1) { missing.push(`${l.node.id} ${l.path.join(' › ')}`); continue; }
        expect(hit[0].path, `${l.node.id}'s path`).toBe(l.path.join(' › '));
        expect(hit[0].key, `${l.node.id}'s shortcut`).toBe(l.node.shortcut ?? l.node.shortcutHint ?? '');
      }
      expect(missing, 'menubar leaves ⌘K does not find').toEqual([]);
      const gibson = await paletteCommand(app, 'gibson', 'act-gibson');
      expect(gibson.path).toBe('Cloning › Seamless Assembly › Gibson Assembly');
      for (const s of STUDIOS) {
        const hit = (await palette(app, s.name)).filter((i) => i.studio === s.id);
        expect(hit.map((i) => i.label), `⌘K finds the ${s.name} studio`).toEqual([s.name]);
        expect(hit[0].key, `${s.name}'s key`).toBe(s.digit ? `Ctrl+${s.digit}` : '');
      }
    } finally {
      app.unmount();
    }
    await onRecords(PLASMID.id, async (app) => {
      const doc = (await palette(app, 'CR_Protein')).filter((i) => i.id === null && i.label === 'CR_Protein (CR_2)');
      expect(doc, '⌘K finds the document').toHaveLength(1);
    });
  }, 600_000);

  it('US-01M6Q1N2 AC2 ⌘K finds a command by its menu path alone: Seamless Assembly lists the five assembly methods under Cloning › Seamless Assembly', async () => {
    const app = await mountApp();
    try {
      await app.menu('new-session:sample-library');
      const query = 'Seamless Assembly';
      const named = (i: PaletteItem) => i.label.toLowerCase().includes(query.toLowerCase());
      const hits = (await palette(app, query)).filter((i) => i.id !== null);
      // One command is named Seamless Assembly (File › New Session › Cloning & Primers); no other
      // hit's label holds the query, so ⌘K found each of them by its path and nothing else.
      expect(hits.filter(named).map((i) => i.id), 'hits found by their label').toEqual(['file-ns-clone-asm']);
      const byPath = hits.filter((i) => !named(i));
      expect(byPath.map((i) => [i.id, i.path]), 'hits found only by their path').toEqual([
        ['act-gibson', 'Cloning › Seamless Assembly › Gibson Assembly'],
        ['act-goldengate', 'Cloning › Seamless Assembly › Golden Gate'],
        ['act-hifi', 'Cloning › Seamless Assembly › NEBuilder HiFi'],
        ['act-infusion', 'Cloning › Seamless Assembly › In-Fusion'],
        ['act-parts', 'Cloning › Seamless Assembly › Parts Cloning'],
      ]);
      // They are every command the menubar holds under that submenu, and the label match ranks first.
      const under = menubarLeaves().filter((l) => l.path.slice(0, -1).join(' › ') === 'Cloning › Seamless Assembly').map((l) => l.node.id);
      expect(byPath.map((i) => i.id), 'the menubar\'s Cloning › Seamless Assembly').toEqual(under);
      expect(hits[0].id, 'the label match ranks above the path matches').toBe('file-ns-clone-asm');
      await closePalette(app);
    } finally {
      app.unmount();
    }
  }, 300_000);
});

/** What the workbench shows: its tab, the canvas text and the Undo item's label. */
function state(app: AppHarness) {
  const undo = menubarLeaves().find((l) => l.node.id === 'edit-undo-cmd')?.node.label;
  return { tab: app.activeTab(), canvas: words(app.canvas().textContent), undo };
}

/** Mounts the App on the two records with `activeDocId` active, runs `fn` and unmounts. */
async function onRecords<T>(activeDocId: string, fn: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp();
  try {
    await app.restoreSession({ documents: [PLASMID, PROTEIN], activeDocId, viewerTab: 'sequence-view' });
    return await fn(app);
  } finally {
    app.unmount();
  }
}

describe('US-01M6Q1N2 AC3: a ⌘K command runs the menu handler and keeps its disabled reason', () => {
  it('US-01M6Q1N2 AC3 Reverse Complement and Gibson Assembly from ⌘K do what the menu does, and stay disabled with the menu reason on a protein', async () => {
    const results: Record<string, { before: ReturnType<typeof state>; after: ReturnType<typeof state> }> = {};
    for (const [label, id] of [['Reverse Complement', 'seq-rc'], ['Gibson Assembly', 'act-gibson']] as const) {
      const viaMenu = await onRecords(PLASMID.id, async (app) => {
        const before = state(app);
        const leaf = menubarLeaves().find((l) => l.node.id === id)!;
        expect(leaf.disabled, `${label} is enabled on the plasmid`).toBe(false);
        leaf.node.onSelect!();
        await app.settle();
        return { before, after: state(app) };
      });
      expect(viaMenu.after, `${label} from the menu changes the workbench`).not.toEqual(viaMenu.before);
      const viaPalette = await onRecords(PLASMID.id, async (app) => {
        const before = state(app);
        const item = await paletteCommand(app, label, id);
        expect(item.disabled, `${label} is enabled in ⌘K`).toBe(false);
        await app.click(item.el);
        return { before, after: state(app) };
      });
      expect(viaPalette, `${label} from ⌘K does what the menu does`).toEqual(viaMenu);
      results[id] = viaPalette;
    }
    // The plasmid's own bases, reverse-complemented, are what the Sequence view now draws.
    const rc = [...PLASMID.sequence].reverse().map((b) => ({ A: 'T', T: 'A', G: 'C', C: 'G' })[b]).join('');
    const bases = (t: string) => t.replace(/[^ACGT]/g, '');
    expect(bases(results['seq-rc'].before.canvas), 'the plasmid before').toContain(PLASMID.sequence.slice(0, 30));
    expect(bases(results['seq-rc'].after.canvas), 'Reverse Complement edited the sequence').toContain(rc.slice(0, 30));
    expect(bases(results['seq-rc'].after.canvas)).not.toContain(PLASMID.sequence.slice(0, 30));
    expect(results['act-gibson'].after.tab, 'Gibson Assembly opens in Cloning & Gel').toBe('cloning-gel');

    // A studio in ⌘K is its View › Studios command, handler included: behind the Map Gallery, Sequence
    // Map closes the gallery onto the studio, as the menu item does.
    const studio = STUDIOS[0];
    const studioId = `view-studio-${studio.id}`;
    const behindGallery = (choose: (app: AppHarness) => Promise<void>) => onRecords(PLASMID.id, async (app) => {
      const galleries = () => app.all('section[aria-label="Map Gallery"]').length;
      await app.change(app.one('input[aria-label="Select or deselect all documents in current folder"]'), true);
      menubarLeaves().find((l) => l.node.id === 'view-map-gallery')!.node.onSelect!();
      await app.settle();
      expect(galleries(), 'the Map Gallery is open').toBe(1);
      await choose(app);
      await app.settle();
      return { galleries: galleries(), ...state(app) };
    });
    const studioViaMenu = await behindGallery(async () => menubarLeaves().find((l) => l.node.id === studioId)!.node.onSelect!());
    expect(studioViaMenu.galleries, `View › Studios › ${studio.name} closes the gallery`).toBe(0);
    const studioViaPalette = await behindGallery(async (app) => app.click((await paletteCommand(app, studio.name, studioId)).el));
    expect(studioViaPalette, `${studio.name} from ⌘K does what View › Studios does`).toEqual(studioViaMenu);

    await onRecords(PROTEIN.id, async (app) => {
      const menuItem = menubarLeaves().find((l) => l.node.id === 'seq-rc')!;
      expect(menuItem.disabled, 'Reverse Complement is disabled on a protein').toBe(true);
      const before = state(app);
      const item = await paletteCommand(app, 'Reverse Complement', 'seq-rc');
      expect(item.disabled, '⌘K lists it disabled').toBe(true);
      expect(item.reason, '⌘K gives the menu reason').toBe(words(menuItem.node.description));
      expect(item.reason).not.toBe('');
      await app.click(item.el);
      await closePalette(app);
      expect(state(app), 'choosing it changes nothing').toEqual(before);
      // Every command the menu greys on a protein is listed disabled in ⌘K, with the item's own reason
      // where it gives one, and never without a reason.
      const greyed = menubarLeaves().filter((l) => l.disabled);
      expect(greyed.length, 'commands the menu greys on a protein').toBeGreaterThan(10);
      for (const l of greyed) {
        const hit = await paletteCommand(app, l.node.label ?? '', l.node.id!);
        expect(hit.disabled, `${l.node.id} is listed disabled`).toBe(true);
        if (l.node.disabled && l.node.description) expect(hit.reason, `${l.node.id}'s reason`).toBe(words(l.node.description));
        else expect(hit.reason, `${l.node.id} has a reason`).not.toBe('');
      }
      await closePalette(app);
    });
  }, 300_000);
});

describe('US-01M6Q1N2 AC4: the toolbar dropdowns list only registry commands', () => {
  it('US-01M6Q1N2 AC4 each of the nine toolbar dropdowns is a named group of the registry with no tb- duplicate', async () => {
    const app = await mountApp();
    try {
      await app.menu('new-session:sample-library');
      const toolbar = await openToolbar(app);
      const ids = (nodes: readonly Node[]): string[] => nodes.flatMap((n) => [n.id ?? '', ...(n.children ? ids(n.children) : [])]);
      for (const [id, items] of Object.entries(toolbar) as [ToolbarGroupId, Node[]][]) {
        expect(ids(items).filter((x) => x.startsWith('tb-')), `${id} ▾ has no tb- item`).toEqual([]);
        for (const l of leaves(items)) {
          expect(COMMAND_BY_ID.has(l.node.id!) || isGeneratedCommand(l.node.id!), `${id} ▾ ${l.node.id} resolves in the registry`).toBe(true);
        }
        const groups = TOOLBAR_GROUPS[id].map((p) => menubarNodeAt(menubar(), TOP, p));
        expect(groups.every(Boolean), `${id} ▾'s group is on the menubar`).toBe(true);
        const expected = groups.length === 1 ? ids(groups[0]!.children) : TOOLBAR_GROUPS[id].flatMap((p, i) => [
          menubarNodeAt(menubar(), TOP, p.slice(0, -1))!.children.find((n) => n.kind === 'submenu' && n.label === p[p.length - 1])!.id!,
          ...ids(groups[i]!.children),
        ]);
        expect(ids(items), `${id} ▾ is ${TOOLBAR_GROUPS[id].map((p) => p.join(' › ')).join(' + ')}`).toEqual(expected);
        expect(leaves(items).length, `${id} ▾ has commands`).toBeGreaterThan(0);
      }
      expect(TOOLBAR_GROUPS.import, 'Import ▾ is File › Import Data').toEqual([['File', 'Import Data']]);
    } finally {
      app.unmount();
    }
  }, 300_000);
});

describe('US-01M6Q1N2 AC5: operations are refused exactly the registry shortcuts', () => {
  it('US-01M6Q1N2 AC5 every registry shortcut and Shift-Cmd-F is refused, and RESERVED_SHORTCUTS is the registry keys plus the platform keys', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown };
    const before = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    try {
      const keys = registryShortcuts();
      expect(keys).toContain('Mod+Shift+E');
      expect(keys, 'D0017 (3): the hidden ⌥⌘S').toContain('Mod+Alt+S');
      for (const k of [...keys.filter((k) => k.startsWith('Mod+')), 'Mod+Shift+F']) {
        expect(setOperationShortcut('align-pairwise', k), k).toBe('That shortcut is already used by MolBioCraft.');
      }
      expect([...RESERVED_SHORTCUTS].sort()).toEqual([...new Set([...keys, ...PLATFORM_SHORTCUTS])].sort());
      for (const k of SECOND_KEYS) expect(COMMAND_BY_ID.has(k.commandId), `${k.shortcut} is a second key of a registry command`).toBe(true);
      expect(setOperationShortcut('align-pairwise', 'Mod+Alt+Shift+K'), 'a free key is taken').toBeNull();
    } finally {
      g.localStorage = before;
    }
  });
});

describe('US-01M6Q1N2 AC10: Align Structures stays a registry command on the menubar and in ⌘K', () => {
  it('US-01M6Q1N2 AC10 Align Structures sits under Tools › Alignment beside Pairwise Alignment, and ⌘K keeps its rule and opens the window', async () => {
    const app = await mountApp();
    try {
      await app.menu('new-session:blank');
      let node = menubarLeaves().find((l) => l.node.label === 'Align Structures…');
      expect(node?.disabled, 'disabled in a blank session').toBe(true);
      const blank = await paletteCommand(app, 'Align Structures', node!.node.id!);
      expect(blank.disabled).toBe(true);
      expect(blank.reason, 'the menu reason').toBe(words(node!.node.description));
      expect(blank.reason).not.toBe('');
      await closePalette(app);

      await app.menu('new-session:sample-library');
      const group = menubarNodeAt(menubar(), TOP, ['Tools', 'Alignment'])!.children;
      const at = group.findIndex((n) => n.label === 'Align Structures…');
      expect(at, 'under Tools › Alignment').toBeGreaterThan(0);
      expect(group[at - 1].label, 'beside Pairwise Alignment…').toBe('Pairwise Alignment…');
      node = menubarLeaves().find((l) => l.node.label === 'Align Structures…');
      expect(COMMAND_BY_ID.get(node!.node.id!), 'the registry entry').toMatchObject({ path: ['Tools', 'Alignment'], nativeId: 'align:structures-dialog', rule: 'align-structures' });
      expect(node?.disabled, 'enabled with structures').toBe(false);
      const item = await paletteCommand(app, 'Align Structures', node!.node.id!);
      expect(item.path).toBe('Tools › Alignment › Align Structures…');
      expect(item.disabled).toBe(false);
      await app.click(item.el);
      expect(app.all('dialog[aria-labelledby="opdlg-structure-alignment"]'), 'the structure alignment window').toHaveLength(1);
    } finally {
      app.unmount();
    }
  }, 300_000);
});

describe('US-01M6Q1N2 AC12: Map Gallery and Compare Table are registry commands under their native ids', () => {
  it('US-01M6Q1N2 AC12 Map Gallery and Compare Table carry the native ids and the multi-record-view rule, and the View menu draws them', async () => {
    const app = await mountApp();
    try {
      await app.menu('new-session:sample-library');
      for (const [id, nativeId, label] of [['view-map-gallery', 'view:map-gallery', 'Map Gallery'], ['view-compare-table', 'view:compare-table', 'Compare Table']]) {
        expect(COMMANDS.filter((c) => c.nativeId === nativeId), `one registry command for ${nativeId}`).toHaveLength(1);
        expect(COMMAND_BY_ID.get(id)).toMatchObject({ label, nativeId, rule: 'multi-record-view', path: ['View'] });
        const leaf = menubarLeaves().filter((l) => l.node.id === id);
        expect(leaf.map((l) => l.path.join(' › ')), `the View menu draws ${label}`).toEqual([`View › ${label}`]);
      }
    } finally {
      app.unmount();
    }
  }, 120_000);
});

// ─── US-01M7QCN2: the header search, Help › Load Example Data, Function Info and Table Columns ───

const rowsLabelled = (app: AppHarness, text: string) =>
  app.all('button.desktop-menu-row').filter((b) => words(b.querySelectorAll('.desktop-menu-label')[0]?.textContent) === text);
function menubarButton(app: AppHarness, name: string): LiveElement {
  const found = app.all('.mbc-menubar button.menu-item').filter((b) => words(b.textContent) === name);
  if (found.length !== 1) throw new Error(`the menubar draws ${found.length} ${name} menus`);
  return found[0];
}
/** Clicks `top` on the menubar, then each row of `path` in turn (the last one is chosen). */
async function chooseMenu(app: AppHarness, top: string, path: string[]) {
  await app.click(menubarButton(app, top));
  for (const label of path) {
    const rows = rowsLabelled(app, label);
    if (rows.length !== 1) throw new Error(`"${label}" is drawn ${rows.length} times`);
    await app.click(rows[0]);
  }
}
async function closeMenus(app: AppHarness, opener: LiveElement) {
  for (let i = 0; i < 3 && app.all('button.desktop-menu-row').length; i++) await app.click(opener);
  expect(app.all('button.desktop-menu-row'), 'the menus closed').toHaveLength(0);
}
const toast = (app: AppHarness) => words(app.all('.statusbar-toast-text')[0]?.textContent);
const topSub = (top: string, label: string) => {
  const sub = menubar()[TOP.indexOf(top)].filter((n) => n.kind === 'submenu' && n.label === label);
  if (sub.length !== 1) throw new Error(`${top} has ${sub.length} "${label}" submenus at its top level`);
  return sub[0];
};
const labelsOf = (nodes: readonly Node[] | undefined) => (nodes ?? []).filter((n) => n.kind !== 'separator').map((n) => n.label);
const nativeItems = (src: string) => [...src.matchAll(/item\(\s*"([^"]+)",\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
const EXAMPLES = ['Evolution Examples…', '500 kbp Annotated Genome', '10,000 aa Protein'];
const LOADED: Record<string, RegExp> = {
  '500 kbp Annotated Genome': /^Loaded ".+" \(500,000 bp, \d+ annotations; [\d,]+ KiB held in memory\)$/,
  '10,000 aa Protein': /^Loaded ".+" \(10,000 aa, \d+ annotations; [\d,]+ KiB held in memory\)$/,
};

describe('US-01M7QCN2 AC1: Help › Load Example Data offers the two benchmark documents', () => {
  it('US-01M7QCN2 AC1 Help Load Example Data offers the two benchmark documents', async () => {
    // The native Help menu: the same three items in their own submenu, out of Guides, none needing a session.
    const mainRs = readFileSync('src-tauri/src/main.rs', 'utf8');
    const native = mainRs.slice(mainRs.indexOf('let help_examples_sub'), mainRs.indexOf('let help_about_sub'));
    expect(nativeItems(native), 'the native Help › Load Example Data').toEqual([
      ['help:examples', 'Evolution Examples…'], ['help:bench-genome', '500 kbp Annotated Genome'], ['help:bench-protein', '10,000 aa Protein'],
    ]);
    expect(native).toContain('"Load Example Data"');
    const guides = mainRs.slice(mainRs.indexOf('let help_guides_sub'), mainRs.indexOf('let help_examples_sub'));
    expect(nativeItems(guides).map((i) => i[0]), 'Guides no longer holds it').not.toContain('help:examples');
    expect(mainRs.slice(mainRs.indexOf('let help_menu'), mainRs.indexOf('let help_menu') + 300)).toMatch(/&help_guides_sub,\s*&help_examples_sub,\s*&help_about_sub/);

    // Each benchmark from the in-window menu, without a session and with one; and from the native id.
    for (const withSession of [false, true]) {
      for (const label of Object.keys(LOADED)) {
        for (const via of ['menu', 'native'] as const) {
          const what = `${label} from the ${via}, ${withSession ? 'in a session' : 'with no session'}`;
          const app = await mountApp();
          try {
            if (withSession) await app.restoreSession({ documents: [PLASMID], activeDocId: PLASMID.id, viewerTab: 'sequence-view' });
            const sub = topSub('Help', 'Load Example Data');
            expect(labelsOf(sub.children), `${what}: the submenu`).toEqual(EXAMPLES);
            expect((sub.children ?? []).map((n) => Boolean(n.disabled)), `${what}: none greyed`).toEqual([false, false, false]);
            if (via === 'menu') await chooseMenu(app, 'Help', ['Load Example Data', label]);
            else await app.menu(label.startsWith('500') ? 'help:bench-genome' : 'help:bench-protein');
            expect(toast(app), what).toMatch(LOADED[label]);
            expect(app.railTabs().length, `${what}: a session is open`).toBeGreaterThan(0);
          } finally {
            app.unmount();
          }
        }
      }
    }

    // ⌘K finds both under Help › Load Example Data, once each, and runs the menu's loader.
    const app = await mountApp();
    try {
      const found = (await palette(app, 'benchmark')).filter((i) => i.path === `Help › Load Example Data › ${i.label}`);
      expect(found.map((i) => [i.label, i.id]), '⌘K "benchmark"').toEqual([['500 kbp Annotated Genome', 'help-bench-genome'], ['10,000 aa Protein', 'help-bench-protein']]);
      const named = await palette(app, '10,000 aa Protein');
      expect(named.filter((i) => i.label === '10,000 aa Protein').map((i) => i.id), 'listed once').toEqual(['help-bench-protein']);
      await app.click(named.find((i) => i.label === '10,000 aa Protein')!.el);
      expect(toast(app), 'chosen from ⌘K').toMatch(LOADED['10,000 aa Protein']);
    } finally {
      app.unmount();
    }
  }, 120_000);
});

describe('US-01M7QCN2 AC2: the header search opens the command palette', () => {
  it('US-01M7QCN2 AC2 the header search opens the command palette with what was typed', async () => {
    await onRecords(PLASMID.id, async (app) => {
      const search = app.one('#mbc-toolbar-global-search-input', 'the header search');
      const table = () => words(app.one('.doc-table-scroll', 'the document table').textContent);
      const open = () => app.all('.mbc-cmd-palette-input');
      // ⌘K toggles the palette shut (the harness's Escape does not reach the dialog).
      const shut = async () => {
        if (open().length) await app.press('k', { mod: true });
        expect(open(), 'the palette is shut').toHaveLength(0);
      };
      const listed = () => app.all('.mbc-cmd-palette-item').map((el) => words(el.querySelector('strong')?.textContent));
      expect(table(), 'both records listed').toMatch(/CR_Plasmid[\s\S]*CR_Protein|CR_Protein[\s\S]*CR_Plasmid/);

      await app.input(search, 'gibson');
      expect(open(), 'typing opens ⌘K').toHaveLength(1);
      expect(open()[0].value, 'with the text typed').toBe('gibson');
      expect(listed(), '⌘K lists Gibson Assembly').toContain('Gibson Assembly');
      expect(search.value, 'the header field keeps no query').toBe('');
      expect(app.all('.mbc-header-search-results'), 'no second list under the field').toHaveLength(0);
      expect(table(), 'the document table is not filtered').toContain('CR_Plasmid');
      expect(table()).toContain('CR_Protein');
      await shut();
      expect(open(), 'closed').toHaveLength(0);

      // ⇧⌘F: a second key that opens ⌘K for one release (D0017 (3)).
      await app.press('f', { mod: true, shift: true });
      expect(open().map((i) => i.value), '⇧⌘F opens ⌘K empty').toEqual(['']);
      await shut();

      // Focus alone does not open it; a click or Enter on the empty field does (D0255 (4)).
      // The live DOM fires no focus events, so the focusin a browser fires (React's onFocus) is
      // dispatched here, and its focusout after (React's select plugin reads a selection the live DOM lacks).
      search.focus();
      await act(async () => { dispatchLiveEvent(search, 'focusin', {}); });
      await app.settle();
      expect(open(), 'focus alone').toHaveLength(0);
      await act(async () => { dispatchLiveEvent(search, 'focusout', {}); });
      await app.click(search);
      expect(open().map((i) => i.value), 'a click on the empty field').toEqual(['']);
      await shut();
      search.focus();
      await app.press('Enter');
      expect(open().map((i) => i.value), 'Enter on the empty field').toEqual(['']);
      await shut();

      // View › Search & Filter: Command Palette (⌘K) and Filter Folder (⌥⌘F), no Search Workspace.
      const sf = menubar()[TOP.indexOf('View')].filter((n) => n.kind === 'submenu').flatMap((n) => n.children ?? []).find((n) => n.kind === 'submenu' && n.label === 'Search & Filter')
        ?? menubar()[TOP.indexOf('View')].find((n) => n.kind === 'submenu' && n.label === 'Search & Filter');
      const rows = (sf?.children ?? []).map((n) => [n.label, n.shortcut ?? n.shortcutHint ?? '']);
      expect(rows).toContainEqual(['Command Palette', 'Ctrl+K']);
      expect(rows).toContainEqual(['Filter Folder', 'Ctrl+Alt+F']);
      expect(rows.map((r) => r[0])).not.toContain('Search Workspace');
      // Shown, not bound (D0255 (2)): the ⌘K listener is the one binding, so the menu binds no key for it.
      expect(collectMenuShortcutBindings(menubar() as never).filter((b) => b.id === 'view-search-tools'), 'the menu binds no key for Command Palette').toEqual([]);
      await chooseMenu(app, 'View', ['Search & Filter']);
      const cp = rowsLabelled(app, 'Command Palette');
      expect(cp.map((r) => [words(r.querySelector('.desktop-menu-hint')?.textContent), r.getAttribute('aria-keyshortcuts')]), 'the row shows ⌘K').toEqual([['Ctrl+K', 'Control+K']]);
      await app.click(cp[0]);
      expect(open().map((i) => i.value), 'the menu item opens ⌘K').toEqual(['']);
      await shut();
      await app.menu('view:search-tools');
      expect(open().map((i) => i.value), 'the native Search Tools & Files opens ⌘K').toEqual(['']);
    });
  }, 60_000);
});

describe('US-01M7QCN2 AC3: the menus no longer carry the Function Info switch', () => {
  it('US-01M7QCN2 AC3 no popup has a Function Info row and the View switch still governs the descriptions', async () => {
    await onRecords(PLASMID.id, async (app) => {
      const tips = () => app.all('[role="tooltip"]').map((t) => words(t.textContent)).filter(Boolean);
      const noRow = (what: string) => {
        expect(app.all('.desktop-menu-popup').length, `${what}: a popup is drawn`).toBeGreaterThan(0);
        expect(app.all('.desktop-menu-info-toggle-row'), `${what}: no Function Info row`).toHaveLength(0);
        expect(app.all('.desktop-menu-popup button').filter((b) => words(b.textContent) === 'Function Info'), what).toHaveLength(0);
      };
      const hover = async (row: LiveElement) => {
        await act(async () => { dispatchLiveEvent(row, 'pointerover', { pointerId: 1, pointerType: 'mouse', isPrimary: true }); });
        await app.settle();
      };
      const view = menubarButton(app, 'View');
      await app.click(view);
      noRow('the View dropdown');
      await hover(rowsLabelled(app, 'Show Menu Function Info')[0]);
      expect(tips(), 'hovering shows its description while on').toEqual(['Show or hide short function description tooltips when hovering or focusing menu items']);
      await app.click(rowsLabelled(app, 'Panels')[0]);
      noRow('the View › Panels submenu');
      await closeMenus(app, view);

      const tool = app.all('button.mbc-tool-btn')[0];
      await app.click(tool);
      noRow('a toolbar dropdown');
      await closeMenus(app, tool);

      // Switched off from View: no description on hover.
      await chooseMenu(app, 'View', ['Show Menu Function Info']);
      if (!app.all('button.desktop-menu-row').length) await app.click(view);
      const sw = rowsLabelled(app, 'Show Menu Function Info')[0];
      expect(sw.getAttribute('aria-checked'), 'the View switch reads off').toBe('false');
      await hover(sw);
      expect(tips(), 'no description once off').toEqual([]);
      await closeMenus(app, view);

      // Preferences › General keeps the switch.
      menubarLeaves().find((l) => l.node.id === 'app-prefs-open')!.node.onSelect!();
      await app.settle();
      expect(words(app.doc.body.textContent)).toContain('Show short function descriptions when hovering or focusing menu items');
    });
  }, 60_000);
});

describe('US-01M7QCN2 AC4: View › Table Columns offers presets and opens the column chooser', () => {
  it('US-01M7QCN2 AC4 View Table Columns lists the presets and Choose Columns opens the document table Columns menu', async () => {
    await onRecords(PLASMID.id, async (app) => {
      const sub = topSub('View', 'Table Columns');
      expect(labelsOf(sub.children), 'View › Table Columns').toEqual([
        ...Object.values(DOC_TABLE_COLUMN_PRESETS).map((p) => p.label), 'Lock Column Order', 'Save Current State', 'Choose Columns…',
      ]);
      expect((sub.children ?? []).filter((n) => n.kind === 'checkbox').map((n) => n.label), 'no per-column checkbox').toEqual(['Lock Column Order']);
      expect(app.all('.mbc-columns-popover'), 'the Columns menu starts closed').toHaveLength(0);
      await chooseMenu(app, 'View', ['Table Columns', 'Choose Columns…']);
      expect(app.all('.mbc-columns-popover[aria-label="Choose Visible Table Columns"]'), 'Choose Columns… opens the Columns menu').toHaveLength(1);
      const heads = () => app.all('.doc-table-scroll th').map((th) => words(th.textContent));
      // %GC: the document table's own label for it ('% GC').
      const isGc = (t: string) => /^% ?GC$/.test(t);
      const gcItems = () => app.all('.mbc-columns-check-item').filter((l) => isGc(words(l.querySelector('.mbc-columns-check-label')?.textContent)));
      expect(gcItems(), 'the Columns menu lists %GC once').toHaveLength(1);
      const shown = () => app.all('.doc-table-scroll th').some((th) => isGc(words(th.textContent)));
      const before = shown();
      await app.click(gcItems()[0].querySelector('input')!);
      expect(shown(), 'toggling %GC flips the column').toBe(!before);
      await app.click(gcItems()[0].querySelector('input')!);
      expect(shown(), 'and back').toBe(before);
    });
  }, 60_000);

  it('US-01M7QCN2 AC4 Choose Columns on a folded document table unfolds it and opens its Columns menu', async () => {
    await onRecords(PLASMID.id, async (app) => {
      const folded = () => app.all('.mbc-doc-table-pane.collapsed').length === 1;
      expect(folded(), 'the table starts unfolded').toBe(false);
      await chooseMenu(app, 'View', ['Panels', 'Document Table']);
      expect(folded(), 'View › Panels › Document Table folds the table').toBe(true);
      expect(app.all('.doc-table-scroll'), 'a folded table draws no rows').toHaveLength(0);
      expect(app.all('.mbc-columns-popover'), 'the Columns menu starts closed').toHaveLength(0);
      if (app.all('button.desktop-menu-row').length) await closeMenus(app, menubarButton(app, 'View'));
      await chooseMenu(app, 'View', ['Table Columns', 'Choose Columns…']);
      expect(folded(), 'Choose Columns… unfolds the table').toBe(false);
      expect(app.all('.doc-table-scroll'), 'the unfolded table draws its rows').toHaveLength(1);
      const popover = app.all('.mbc-columns-popover[aria-label="Choose Visible Table Columns"]');
      expect(popover, 'Choose Columns… opens the Columns menu').toHaveLength(1);
      expect(popover[0].querySelectorAll('.mbc-columns-check-item').length, 'with its column check items').toBeGreaterThan(1);
      expect(
        popover[0].querySelectorAll('button.mbc-columns-action-btn').map((b) => words(b.textContent)),
        'and its Load Column State action'
      ).toContain('Load Column State...');
    });
  }, 60_000);
});
