// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it, vi } from 'vitest';
import {
  collectMenuShortcutBindings,
  eventMatchesShortcut,
  findMenuShortcut,
  parseShortcutLabel,
  ShortcutMenuNode,
} from '../core/menuShortcuts';
import { formatPlatformShortcut, SupportedOS } from '../platform/osPlatform';

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
