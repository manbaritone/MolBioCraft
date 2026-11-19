// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q159: the native macOS menu is one more projection of the command registry. The spec file
 * src-tauri/native-menu.json is generated from it (AC1); its top level and every shared item match
 * the mounted in-window menubar (AC2); each native id runs its registry command, the in-window node
 * of that id (AC4); and each id's native enabled state is that node's availability (AC5).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { macHost, mountApp, menuCommandIds, type AppHarness } from './appHarness';
import { CLONING_ACTION_VECTOR_PRESETS } from '../data/cloningActionVectors';
import {
  NATIVE_ENABLED_ALWAYS, NATIVE_TOP_MENUS, nativeMenuSpec, nativeTargets, type NativeMenuNode, type RegistryMenuNode,
} from '../core/commandRegistry';
import {
  NATIVE_MENU_COMMAND_RULES, NATIVE_MENU_SESSION_INDEPENDENT_IDS, resolveNativeMenuItemEnabled,
} from '../core/commandAvailability';

const probe = vi.hoisted(() => ({ trees: [] as unknown[] }));
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
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));
vi.setConfig({ testTimeout: 300_000 });

const IN_WINDOW_TOP = ['MolBioCraft', 'File', 'Edit', 'View', 'Sequence', 'Cloning', 'Tools', 'Help'];
const SPEC_FILE = readFileSync('src-tauri/native-menu.json', 'utf8');
const SPEC = JSON.parse(SPEC_FILE) as ReturnType<typeof nativeMenuSpec>;
const TARGETS = nativeTargets(CLONING_ACTION_VECTOR_PRESETS);

const BASE = {
  description: '', folder: 'Local', createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z',
  features: [], primers: [], history: [],
};
const PLASMID = { ...BASE, id: 'q159-dna', name: 'Q159_Plasmid', accession: 'Q159_1', moleculeType: 'DNA', topology: 'circular', sequence: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGA'.repeat(4) } as SequenceDocument;
const PROTEIN = { ...BASE, id: 'q159-prot', name: 'Q159_Protein', accession: 'Q159_2', moleculeType: 'Protein', topology: 'linear', sequence: 'MKWVTFISLLFLFSSAYSRGVFRR' } as SequenceDocument;

type Row = { kind: 'item'; id: string; label: string } | { kind: 'sub'; label: string } | { kind: 'sep' };
/** A native submenu's rows, each by kind and label (predefined AppKit items left out). */
const nativeRows = (items: readonly NativeMenuNode[]): Row[] => items.flatMap((n): Row[] =>
  n.type === 'item' ? [{ kind: 'item', id: n.id, label: n.label }] : n.type === 'submenu' ? [{ kind: 'sub', label: n.label }] : n.type === 'separator' ? [{ kind: 'sep' }] : []);
/** Every native item with its parent path. */
function nativeItems(): Map<string, { path: string[]; label: string; accel?: string }> {
  const out = new Map<string, { path: string[]; label: string; accel?: string }>();
  const walk = (items: readonly NativeMenuNode[], path: string[]) => {
    for (const n of items) {
      if (n.type === 'submenu') walk(n.items, [...path, n.label]);
      else if (n.type === 'item') {
        expect(out.has(n.id), `the native id ${n.id} is listed once`).toBe(false);
        out.set(n.id, { path, label: n.label, ...(n.accel ? { accel: n.accel } : {}) });
      }
    }
  };
  for (const m of SPEC.menus) walk(m.items, [m.label]);
  return out;
}
/** The in-window menubar's leaves by id, with path, label and availability (its submenus' too). */
function inWindowLeaves(): Map<string, { path: string[]; label: string; disabled: boolean; node: RegistryMenuNode }> {
  const out = new Map<string, { path: string[]; label: string; disabled: boolean; node: RegistryMenuNode }>();
  const walk = (nodes: readonly RegistryMenuNode[], path: string[], off: boolean) => {
    for (const n of nodes) {
      const dis = off || Boolean(n.disabled);
      if (n.kind === 'submenu' && n.children) walk(n.children, [...path, n.label ?? ''], dis);
      else if ((n.kind === 'command' || n.kind === 'checkbox') && n.id && !out.has(n.id)) out.set(n.id, { path, label: n.label ?? '', disabled: dis, node: n });
    }
  };
  (probe.trees as RegistryMenuNode[][]).forEach((t, i) => walk(t, [IN_WINDOW_TOP[i]], false));
  return out;
}
/** A submenu's in-window rows, by its path. */
function inWindowRows(path: string[]): Row[] | undefined {
  let nodes = (probe.trees as RegistryMenuNode[][])[IN_WINDOW_TOP.indexOf(path[0])];
  for (const label of path.slice(1)) {
    const next = nodes?.find((n) => n.kind === 'submenu' && n.label === label);
    if (!next?.children) return undefined;
    nodes = next.children;
  }
  return nodes?.map((n): Row => n.kind === 'separator' ? { kind: 'sep' } : n.kind === 'submenu' ? { kind: 'sub', label: n.label ?? '' } : { kind: 'item', id: n.id ?? '', label: n.label ?? '' });
}
/** Rows kept to those both menus show, by label, and the dividers between them (none doubled, none at an end). */
const shared = (rows: Row[], labels: Set<string>): string[] => {
  const kept = rows.filter((r) => r.kind === 'sep' || labels.has(r.label)).map((r) => (r.kind === 'sep' ? '—' : r.label));
  return kept.filter((r, i) => r !== '—' || (i > 0 && kept[i - 1] !== '—')).join('|').replace(/^—\|?|\|?—$/g, '').split('|');
};

async function withApp(docs: SequenceDocument[], mac: boolean, body: (app: AppHarness) => Promise<void>) {
  const app = await mountApp(mac ? macHost() : {});
  try {
    if (docs.length) await app.restoreSession({ documents: docs, activeDocId: docs[0].id, viewerTab: 'sequence-view' });
    await body(app);
  } finally {
    app.unmount();
  }
}

describe('US-01M6Q159 AC1: the native menu spec is generated from the command registry', () => {
  it('US-01M6Q159 AC1 the native menu spec is generated from the command registry', () => {
    const want = nativeMenuSpec(CLONING_ACTION_VECTOR_PRESETS);
    const firstDiff = (a: unknown, b: unknown, at = '$'): string | null => {
      if (JSON.stringify(a) === JSON.stringify(b)) return null;
      if (Array.isArray(a) && Array.isArray(b)) {
        for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = firstDiff(a[i], b[i], `${at}[${i}]`); if (d) return d; }
      } else if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff((a as never)[k], (b as never)[k], `${at}.${k}`); if (d) return d; }
      }
      return `${at}: the file has ${JSON.stringify(a)}, the registry projects ${JSON.stringify(b)} (run npm run menu:native)`;
    };
    expect(firstDiff(SPEC, want)).toBeNull();
    expect(SPEC_FILE).toBe(`${JSON.stringify(want, null, 2)}\n`);
    expect(SPEC.generated).toMatch(/^Generated from src\/core\/commandRegistry\.ts by scripts\/gen_native_menu\.mjs .*Do not edit\.$/);
    expect(readFileSync('package.json', 'utf8')).toContain('"menu:native": "vite-node scripts/gen_native_menu.mjs"');

    // The builder reads only this file: main.rs names no menu item id; the close veto still emits app:request-quit.
    const mainRs = readFileSync('src-tauri/src/main.rs', 'utf8');
    const shell = mainRs.slice(0, mainRs.indexOf('#[cfg(test)]\nmod tests'));
    const ids = [...shell.matchAll(/"([a-z-]+:[a-z0-9-]+)"/g)].map((m) => m[1]);
    // The close veto and the exit veto both send the quit request; nothing else names an id.
    expect([...new Set(ids)], 'menu ids left in main.rs').toEqual(['app:request-quit']);
    expect(shell).toMatch(/emit\("mbc:\/\/native-menu", "app:request-quit"\)/);
    expect(shell).toMatch(/native_menu::build\(/);
    const builder = readFileSync('src-tauri/src/native_menu.rs', 'utf8');
    expect(builder).toContain('include_str!("../native-menu.json")');
    expect([...builder.matchAll(/"([a-z-]+:[a-z0-9-]+)"/g)].filter((m) => builder.indexOf(m[0]) < builder.indexOf('#[cfg(test)]')), 'no id in the builder').toEqual([]);
  });
});

describe('US-01M6Q159 AC2: the native top-level menus and labels match the in-window menubar', () => {
  it('US-01M6Q159 AC2 the native top level, shared labels, paths and dividers match the in-window menubar', async () => {
    expect(SPEC.menus.map((m) => m.label)).toEqual(['MolBioCraft', ...IN_WINDOW_TOP.slice(1), 'Window']);
    expect(NATIVE_TOP_MENUS).toEqual(SPEC.menus.map((m) => m.label));
    await withApp([PLASMID], false, async () => {
      const leaves = inWindowLeaves();
      const native = nativeItems();
      let sharedCount = 0;
      const mismatches: string[] = [];
      for (const [id, n] of native) {
        if (!TARGETS.get(id)?.runs) continue; // run by the App's native handler, with no in-window item
        const leaf = leaves.get(TARGETS.get(id)?.runs ?? '');
        if (!leaf) { mismatches.push(`${id}: no in-window item ${TARGETS.get(id)?.runs}`); continue; }
        sharedCount++;
        const dynamic = id === 'edit:undo' || id === 'edit:redo' || id === 'app:toggle-theme';
        if (!dynamic && leaf.label !== n.label) mismatches.push(`${id}: label ${n.label} vs ${leaf.label}`);
        if (leaf.path.join(' › ') !== n.path.join(' › ')) mismatches.push(`${id}: path ${n.path.join(' › ')} vs ${leaf.path.join(' › ')}`);
      }
      expect(mismatches).toEqual([]);
      expect(sharedCount).toBeGreaterThan(330);
      // The six label pairs of the Background now have one label each.
      for (const [id, label] of [['edit:copy-sequence', 'Copy Sequence'], ['view:search-tools', 'Command Palette'], ['view:toggle-sidebar', 'Project Sidebar'],
        ['view:toggle-doctable', 'Document Table'], ['view:toggle-inspector', 'Inspector'], ['view:expand-doc-view', 'Expand Viewer']]) {
        expect(native.get(id)?.label, id).toBe(label);
      }
      // Every submenu both show lists the shared rows in the same order, with the same dividers between them.
      const order: string[] = [];
      const walk = (items: readonly NativeMenuNode[], path: string[]) => {
        const rows = inWindowRows(path);
        if (rows) {
          const nat = nativeRows(items);
          const labels = new Set(nat.filter((r) => r.kind !== 'sep').map((r) => (r as { label: string }).label));
          const both = new Set(rows.filter((r) => r.kind !== 'sep' && labels.has(r.label)).map((r) => (r as { label: string }).label));
          const a = shared(nat, both).join(' | ');
          const b = shared(rows, both).join(' | ');
          if (a !== b) order.push(`${path.join(' › ')}:\n  native    ${a}\n  in-window ${b}`);
        }
        for (const n of items) if (n.type === 'submenu') walk(n.items, [...path, n.label]);
      };
      for (const m of SPEC.menus) walk(m.items, [m.label]);
      expect(order.join('\n')).toBe('');
    });
  });
});

describe('US-01M6Q159 AC4: every native menu id runs a registry command', () => {
  it('US-01M6Q159 AC4 every native menu id runs its registry command, the in-window item of that id', async () => {
    const native = [...nativeItems().keys(), ...SPEC.dispatchOnly];
    // The harness takes the registry's ids, and its action-vec: exemption the vector presets.
    expect([...menuCommandIds()].sort(), 'the harness dispatches exactly the registry ids').toEqual([...TARGETS.keys()].filter((id) => !id.startsWith('action-vec:')).sort());
    await withApp([PLASMID], false, async (app) => {
      const missed: string[] = [];
      for (const id of native) {
        const target = TARGETS.get(id);
        if (!target) { missed.push(`${id}: no registry command`); continue; }
        if (!target.runs) continue; // a native handler (the quit ack, text-field undo, Home); checked below
        const ran: string[] = [];
        const spy = (nodes: RegistryMenuNode[]) => nodes.forEach((n) => {
          if (n.children) spy(n.children);
          if (n.onSelect) n.onSelect = () => { ran.push(n.id ?? ''); };
          if (n.onToggle) n.onToggle = () => { ran.push(n.id ?? ''); };
        });
        (probe.trees as RegistryMenuNode[][]).forEach(spy);
        await app.menu(id);
        if (ran.join() !== target.runs) missed.push(`${id}: ran [${ran.join()}], not ${target.runs}`);
      }
      expect(missed).toEqual([]);
    });
    // Unspied, Export GenBank saves the record as the in-window item does, and Align Structures opens its window.
    await withApp([PLASMID], false, async (app) => {
      await app.menu('file:save-gb');
      expect(app.downloads().map((d) => d.filename)).toEqual([expect.stringMatching(/\.gb$/)]);
      // The Align Structures window is the operation dialog structureToolsWiring.test.tsx probes for.
      const structureWindow = () => app.all('dialog[aria-labelledby="opdlg-structure-alignment"]');
      expect(structureWindow(), 'closed before the native item').toEqual([]);
      await app.menu('align:structures-dialog');
      expect(structureWindow().map((d) => d.textContent).join(' ')).toMatch(/Align Structures/);
    });
  });
});

describe('US-01M6Q159 AC5: native enabled state follows the registry availability', () => {
  it("US-01M6Q159 AC5 each native id's enabled state is its in-window item's availability, with no session, a DNA and a protein session", async () => {
    const off: string[] = [];
    for (const docs of [[], [PLASMID], [PROTEIN]] as SequenceDocument[][]) {
      const what = docs[0]?.moleculeType ?? 'no session';
      await withApp(docs, true, async (app) => {
        const state = app.nativeMenuStates().at(-1)!;
        expect(state, `${what}: a native state was sent`).toBeTruthy();
        const leaves = inWindowLeaves();
        for (const id of nativeItems().keys()) {
          const leaf = leaves.get(TARGETS.get(id)?.runs ?? '');
          if (!leaf) continue;
          const nat = resolveNativeMenuItemEnabled(id, state);
          // D0262's one exception: Undo and Redo stay on natively, for AppKit's text-field undo.
          if (NATIVE_ENABLED_ALWAYS.includes(id)) { if (!nat) off.push(`${what} ${id}: native off, but D0262 keeps it on`); continue; }
          if (nat !== !leaf.disabled) off.push(`${what} ${id}: native ${nat ? 'on' : 'off'}, in-window ${leaf.disabled ? 'off' : 'on'}`);
        }
        if (what === 'Protein') {
          expect(resolveNativeMenuItemEnabled('sequence:reverse-complement', state)).toBe(false);
          expect(resolveNativeMenuItemEnabled('view:studio-cloning-gel', state)).toBe(false);
        }
      });
    }
    expect(off).toEqual([]);
    expect(NATIVE_ENABLED_ALWAYS, 'D0262 lists one native-only exception, Undo and Redo').toEqual(['edit:undo', 'edit:redo']);
    // The lists are derived from the registry, not kept by hand.
    expect(NATIVE_MENU_SESSION_INDEPENDENT_IDS).toEqual([...TARGETS].filter(([id, t]) => t.noSession && !id.startsWith('action-vec:')).map(([id]) => id));
    expect([...TARGETS].filter(([id]) => id.startsWith('action-vec:')).every(([, t]) => t.noSession && !t.rule), 'the action-vec: prefix covers the vectors').toBe(true);
    expect(NATIVE_MENU_COMMAND_RULES).toEqual(Object.fromEntries([...TARGETS].filter(([, t]) => t.rule).map(([id, t]) => [id, t.rule])));
    const src = readFileSync('src/core/commandAvailability.ts', 'utf8');
    expect(src).not.toMatch(/NATIVE_MENU_SESSION_INDEPENDENT_IDS = \[\s*'/);
  });
});
