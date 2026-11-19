// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it, vi } from 'vitest';
import {
  collectMenuShortcutBindings,
  eventMatchesShortcut,
  EXPLICIT_SHORTCUT_ROWS,
  findMenuShortcut,
  menuShortcutRows,
  parseShortcutLabel,
  ShortcutMenuNode,
} from '../core/menuShortcuts';
import { formatPlatformShortcut, SupportedOS } from '../platform/osPlatform';
import { appTsxSource, mountApp, type AppHarness } from './appHarness';

const key = (
  k: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {},
  code?: string
) => ({
  key: k,
  code: code ?? (/^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : ''),
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('menu-derived keyboard shortcuts', () => {
  it('round-trips every shortcut form the menus display, on every OS', () => {
    const combos: Array<[string, { shift?: boolean; alt?: boolean }]> = [
      ['S', {}], ['S', { shift: true }], ['S', { alt: true }], ['S', { shift: true, alt: true }],
      ['0', { shift: true }], ['3', {}], [',', {}], ['[', {}], ['=', {}], ['-', {}],
    ];
    for (const os of ['macos', 'windows', 'linux'] as SupportedOS[]) {
      for (const [k, mods] of combos) {
        const parsed = parseShortcutLabel(formatPlatformShortcut(k, os, mods));
        expect(parsed, `${os} ${k} ${JSON.stringify(mods)}`).toEqual({
          key: k,
          primary: true,
          shift: Boolean(mods.shift),
          alt: Boolean(mods.alt),
          ctrlOnly: false,
        });
      }
    }
    expect(parseShortcutLabel(undefined)).toBeNull();
    expect(parseShortcutLabel('Alt+F4')).toBeNull();
  });

  it('blocks every reload chord except Shift+Cmd+R on the native macOS menu bar', async () => {
    const { shouldBlockReloadChord } = await import('../platform/macosMenuBridge');
    const ev = (k: string, m: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey', boolean>>) => ({
      key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...m,
    });
    expect(shouldBlockReloadChord(ev('r', { ctrlKey: true }), false)).toBe(true);
    expect(shouldBlockReloadChord(ev('R', { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(shouldBlockReloadChord(ev('r', { metaKey: true }), true)).toBe(true);
    // The AppKit key equivalent runs Reverse Complement; cancelling it would swallow it.
    expect(shouldBlockReloadChord(ev('R', { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(shouldBlockReloadChord(ev('t', { ctrlKey: true }), false)).toBe(false);
  });

  it('does not treat Windows/Linux AltGr character input as a Ctrl+Alt menu command', () => {
    const ctrlAltS = parseShortcutLabel('Ctrl+Alt+S')!;
    // Polish AltGr+S types "ś" and reports Ctrl+Alt with code KeyS.
    expect(eventMatchesShortcut(key('ś', { ctrlKey: true, altKey: true }, 'KeyS'), ctrlAltS, 'windows')).toBe(false);
    expect(
      eventMatchesShortcut(
        { ...key('s', { ctrlKey: true, altKey: true }), getModifierState: (m: string) => m === 'AltGraph' },
        ctrlAltS,
        'linux'
      )
    ).toBe(false);
    // A real Ctrl+Alt+S still matches.
    expect(eventMatchesShortcut(key('s', { ctrlKey: true, altKey: true }), ctrlAltS, 'windows')).toBe(true);
  });

  it('matches events by physical key so Shift / Alt do not change the letter or digit', () => {
    const shiftR = parseShortcutLabel('Ctrl+Shift+R')!;
    expect(eventMatchesShortcut(key('R', { ctrlKey: true, shiftKey: true }), shiftR, 'windows')).toBe(true);
    expect(eventMatchesShortcut(key('r', { ctrlKey: true }), shiftR, 'windows')).toBe(false);
    // ⇧⌘0 arrives as key ")" on US layouts.
    const origin = parseShortcutLabel('⇧⌘0')!;
    expect(eventMatchesShortcut(key(')', { metaKey: true, shiftKey: true }, 'Digit0'), origin, 'macos')).toBe(true);
    // ⌥ changes event.key on macOS ("∫" for ⌥B); the code still identifies the key.
    const altI = parseShortcutLabel('⌥⌘I')!;
    expect(eventMatchesShortcut(key('ˆ', { metaKey: true, altKey: true }, 'KeyI'), altI, 'macos')).toBe(true);
    // Layout-aware: on AZERTY the key labelled A reports code "KeyQ" — it must
    // match Ctrl+A, never Ctrl+Q (Quit).
    const ctrlQ = parseShortcutLabel('Ctrl+Q')!;
    const ctrlA = parseShortcutLabel('Ctrl+A')!;
    expect(eventMatchesShortcut(key('a', { ctrlKey: true }, 'KeyQ'), ctrlQ, 'windows')).toBe(false);
    expect(eventMatchesShortcut(key('a', { ctrlKey: true }, 'KeyQ'), ctrlA, 'windows')).toBe(true);
    // Ctrl on macOS is not the primary modifier.
    expect(eventMatchesShortcut(key('i', { ctrlKey: true, altKey: true }), altI, 'macos')).toBe(false);
  });

  it('binds every displayed shortcut to its menu handler and keeps disabled state', () => {
    const save = vi.fn();
    const rc = vi.fn();
    const tree: ShortcutMenuNode[] = [
      { kind: 'command', id: 'save', label: 'Save', shortcut: 'Ctrl+S', onSelect: save },
      {
        kind: 'submenu',
        id: 'strand',
        label: 'Strand',
        disabled: true,
        children: [{ kind: 'command', id: 'rc', label: 'Reverse Complement', shortcut: 'Ctrl+Shift+R', onSelect: rc }],
      },
      { kind: 'command', id: 'dup', label: 'Duplicate binding', shortcut: 'Ctrl+S', onSelect: vi.fn() },
      { kind: 'separator' },
    ];
    const bindings = collectMenuShortcutBindings([tree]);
    expect(bindings.map((b) => b.id)).toEqual(['save', 'rc']);
    const saveBinding = findMenuShortcut(bindings, key('s', { ctrlKey: true }), 'linux')!;
    saveBinding.run();
    expect(save).toHaveBeenCalledTimes(1);
    const rcBinding = findMenuShortcut(bindings, key('R', { ctrlKey: true, shiftKey: true }), 'linux')!;
    expect(rcBinding.disabled).toBe(true); // inherited from the disabled submenu
    expect(findMenuShortcut(bindings, key('q', { ctrlKey: true }), 'linux')).toBeUndefined();
  });
});

// ─── US-01M6P2G2: the Preferences Keyboard tab's rows ───

/** The Keyboard tab's rows in the mounted App, as [menu path, shortcut label]. */
async function keyboardTabRows(app: AppHarness): Promise<[string, string][]> {
  await app.menu('app:preferences');
  await app.click(app.one('#prefs-tab-keyboard', 'Preferences Keyboard tab'));
  return app.all('tr.mbc-menu-shortcut-row').map((r) => {
    const cells = r.querySelectorAll('td');
    return [cells[0].textContent.trim(), cells[1].textContent.trim()];
  });
}

describe('US-01M6P2G2 AC1: Keyboard rows come from the menu trees the shortcuts dispatch from', () => {
  const noop = () => undefined;
  const fileTree: ShortcutMenuNode[] = [
    {
      kind: 'submenu', id: 'exp', label: 'Export Sequences', children: [
        { kind: 'command', id: 'gb', label: 'Export GenBank', shortcut: 'Ctrl+S', onSelect: noop },
        { kind: 'separator' },
        { kind: 'command', id: 'fa', label: 'Export FASTA', shortcut: 'Ctrl+Shift+S', onSelect: noop },
      ],
    },
    // Shown but bound to nothing: the dispatcher skips it, so the tab does too.
    { kind: 'command', id: 'dead', label: 'No Handler', shortcut: 'Ctrl+E' },
    // A bare key the label parser does not bind (F1 is an explicit row instead).
    { kind: 'command', id: 'help', label: 'Show Help Panel', shortcut: 'F1', onSelect: noop },
    { kind: 'command', id: 'plain', label: 'No Shortcut', onSelect: noop },
  ];
  const viewTree: ShortcutMenuNode[] = [
    {
      kind: 'submenu', id: 'lay', label: 'Map Layout', disabled: true, children: [
        { kind: 'checkbox', id: 'split', label: 'Split Map & Sequence', shortcut: 'Ctrl+1', onToggle: noop },
      ],
    },
    // Bound a second time: the dispatcher runs the File item, so the tab lists only that one.
    { kind: 'command', id: 'gb-again', label: 'Save Again', shortcut: 'Ctrl+S', onSelect: noop },
  ];

  it('US-01M6P2G2 AC1 lists each bound item once, by its menu path, first definition winning, then the explicit rows', () => {
    const rows = menuShortcutRows([fileTree, viewTree], { topLabels: ['File', 'View'], os: 'linux' });
    expect(rows.map((r) => [r.path, r.label])).toEqual([
      ['File > Export Sequences > Export GenBank', 'Ctrl+S'],
      ['File > Export Sequences > Export FASTA', 'Ctrl+Shift+S'],
      // A disabled submenu's item still has its shortcut; it is listed.
      ['View > Map Layout > Split Map & Sequence', 'Ctrl+1'],
      ['Quick Command Navigator', 'Ctrl+K'],
      ['Help > Guides > Show or Hide Help Panel', 'F1'],
    ]);
    // The same walk and the same first-definition key as the dispatcher: the menu rows are the bindings, in order.
    const bindings = collectMenuShortcutBindings([fileTree, viewTree]);
    expect(rows.slice(0, bindings.length).map((r) => r.id)).toEqual(bindings.map((b) => b.id));
    expect(rows.length).toBe(bindings.length + EXPLICIT_SHORTCUT_ROWS.length);
    // The explicit rows read the host's format; on macOS they are the glyph labels.
    const mac = menuShortcutRows([], { os: 'macos' });
    expect(mac.map((r) => [r.path, r.label])).toEqual([['Quick Command Navigator', '⌘K'], ['Help > Guides > Show or Hide Help Panel', 'F1']]);
    // Without top labels the path starts at the tree's own items; a label list of the wrong length is refused.
    expect(menuShortcutRows([fileTree], { os: 'linux' })[0].path).toBe('Export Sequences > Export GenBank');
    expect(() => menuShortcutRows([fileTree, viewTree], { topLabels: ['File'], os: 'linux' })).toThrow(/2 menu trees but 1 label/);
  });

  it('US-01M6P2G2 AC1 the running App lists every combination bound twice once, under its first definition', async () => {
    // Source pins: App hands Preferences the same trees the dispatcher reads. (The hand-kept table's
    // deletion is AC1's own `git grep` over src.)
    const src = appTsxSource();
    expect(src).toContain('collectMenuShortcutBindings(\n    Object.values(topMenus)');
    expect(src).toMatch(/<PreferencesModal[\s\S]{0,800}menuTrees=\{Object\.values\(topMenus\)/);

    const app = await mountApp();
    try {
      const rows = await keyboardTabRows(app);
      const byLabel = (label: string) => rows.filter((r) => r[1] === label).map((r) => r[0]);
      expect(rows.length, 'the tab lists the menu shortcuts').toBeGreaterThan(40);
      // Each combination appears once.
      const labels = rows.map((r) => r[1]);
      expect(labels.filter((l, i) => labels.indexOf(l) !== i), 'no combination is listed twice').toEqual([]);
      expect({
        'Ctrl+3': byLabel('Ctrl+3'),
        'Ctrl+D': byLabel('Ctrl+D'),
        'Ctrl+J': byLabel('Ctrl+J'),
        'Ctrl+I': byLabel('Ctrl+I'),
        'Ctrl+Shift+I': byLabel('Ctrl+Shift+I'),
        'Ctrl+Q': byLabel('Ctrl+Q'),
      }).toEqual(FIRST_DEFINITIONS);
      expect(rows.slice(-2)).toEqual([['Quick Command Navigator', 'Ctrl+K'], ['Help > Guides > Show or Hide Help Panel', 'F1']]);
    } finally {
      app.unmount();
    }
  }, 120_000);
});

/**
 * The first definition of each combination App.tsx binds twice, in menu-bar order (Linux host), as the
 * walk the dispatcher uses finds it. The later definitions (Enzymes Table for ⌘3, In-Silico PCR for
 * ⌘D, a second Site Mutagenesis for ⌘J, File's direct Import Files and Import From Clipboard for ⌘I and
 * ⇧⌘I, and File's own Quit MolBioCraft for ⌘Q) are not listed.
 */
const FIRST_DEFINITIONS: Record<string, string[]> = {
  'Ctrl+3': ['View > Studio Views > Enzymes View'],
  'Ctrl+D': ['Cloning > PCR Cloning > PCR Amplification'],
  'Ctrl+J': ['Cloning > Mutagenesis > Site Mutagenesis'],
  'Ctrl+I': ['File > New Session > Starter & Import > Import Files'],
  'Ctrl+Shift+I': ['File > New Session > Starter & Import > From Clipboard'],
  'Ctrl+Q': ['MolBioCraft > Quit MolBioCraft'],
};
