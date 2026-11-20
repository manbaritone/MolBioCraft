// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Keyboard shortcuts derived from the in-window menu definitions.
 *
 * The in-window menus (Windows, Linux, browser builds) display a shortcut for
 * many commands, but only a handful were ever bound to a key handler, so most
 * advertised shortcuts did nothing. Parsing the displayed label back into a
 * key combination and dispatching the menu item's own handler guarantees that
 * a displayed shortcut is bound, runs the same code as the menu item, and is
 * subject to the same disabled state.
 */

import { formatPlatformShortcut, type SupportedOS } from '../platform/osPlatform';

export interface ParsedShortcut {
  /** Normalised key: single upper-case character or a named key ("F5", ","). */
  key: string;
  primary: boolean;
  shift: boolean;
  alt: boolean;
  /** macOS ⌃ (Control) without ⌘. */
  ctrlOnly: boolean;
}

/** Parse a label produced by formatPlatformShortcut (e.g. "⌥⇧⌘S" or "Ctrl+Alt+Shift+S"). */
export function parseShortcutLabel(label: string | undefined): ParsedShortcut | null {
  if (!label) return null;
  const text = label.trim();
  if (!text) return null;
  if (/[⌘⌥⇧⌃]/.test(text)) {
    const key = text.replace(/[⌘⌥⇧⌃]/g, '');
    if (!key) return null;
    return {
      key: key.toUpperCase(),
      primary: text.includes('⌘'),
      shift: text.includes('⇧'),
      alt: text.includes('⌥'),
      ctrlOnly: text.includes('⌃') && !text.includes('⌘'),
    };
  }
  const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase());
  if (!mods.includes('ctrl') && !mods.includes('cmd')) return null;
  return {
    key: key.toUpperCase(),
    primary: true,
    shift: mods.includes('shift'),
    alt: mods.includes('alt'),
    ctrlOnly: false,
  };
}

/**
 * The `aria-keyshortcuts` value for a displayed shortcut label, or undefined when the label is not
 * a shortcut. It is read through parseShortcutLabel, so it names the same key combination the
 * label binds and follows any remap of the label: "⌥⇧⌘S" is "Alt+Shift+Meta+S", "Ctrl+Shift+F" is
 * "Control+Shift+F" and "⌘=" is "Meta+=". The modifiers use the ARIA names (Control, Alt, Shift,
 * Meta) and come before the key. A bare function key ("F1") is its own value.
 */
export function shortcutLabelToAriaKeyshortcuts(label: string | undefined): string | undefined {
  const text = label?.trim() ?? '';
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(text)) return text;
  const parsed = parseShortcutLabel(text);
  if (!parsed) return undefined;
  // A macOS label's primary modifier is ⌘ (Meta); a Windows or Linux label's is Ctrl.
  const macLabel = /[⌘⌥⇧⌃]/.test(text);
  const control = parsed.ctrlOnly || (parsed.primary && !macLabel);
  const meta = parsed.primary && macLabel && !parsed.ctrlOnly;
  // parseShortcutLabel upper-cases the key; a named key keeps its KeyboardEvent.key spelling.
  const key = parsed.key.length > 1 && !/^F\d+$/.test(parsed.key)
    ? parsed.key[0] + parsed.key.slice(1).toLowerCase()
    : parsed.key;
  return [control ? 'Control' : null, parsed.alt ? 'Alt' : null, parsed.shift ? 'Shift' : null, meta ? 'Meta' : null, key]
    .filter(Boolean)
    .join('+');
}

const SHIFTED_DIGITS: Record<string, string> = {
  ')': '0', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9',
};

/**
 * Key of the event normalised like ParsedShortcut.key.
 *
 * The *printed* character wins, so Ctrl+A means the key labelled A on every
 * layout (on AZERTY that key reports code "KeyQ"; matching by code would have
 * fired Ctrl+Q / Quit). The physical code is only a fallback when the
 * produced character is not a plain letter or digit — e.g. macOS ⌥ turns ⌥I
 * into "ˆ", and Shift+0 produces ")" on US layouts.
 */
export function normalisedEventKey(ev: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const k = ev.key ?? '';
  if (/^[A-Za-z0-9]$/.test(k)) return k.toUpperCase();
  if (ev.code && /^Key[A-Z]$/.test(ev.code)) return ev.code.slice(3);
  if (ev.code && /^Digit[0-9]$/.test(ev.code)) return ev.code.slice(5);
  if (k.length === 1) return (SHIFTED_DIGITS[k] ?? k).toUpperCase();
  return k.toUpperCase();
}

export function eventMatchesShortcut(
  ev: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> &
    Partial<Pick<KeyboardEvent, 'getModifierState'>>,
  sc: ParsedShortcut,
  os: SupportedOS
): boolean {
  // Windows/Linux AltGr is reported as Ctrl+Alt. When the chord produced a
  // printable non-ASCII-alphanumeric character (AltGr+S → "ś" on Polish
  // layouts) the user is typing text, not invoking a Ctrl+Alt menu command.
  if (os !== 'macos' && ev.ctrlKey && ev.altKey) {
    const k = ev.key ?? '';
    const altGraph = typeof ev.getModifierState === 'function' && ev.getModifierState('AltGraph');
    if (altGraph || (k.length === 1 && !/^[A-Za-z0-9]$/.test(k))) return false;
  }
  const primaryPressed = os === 'macos' ? ev.metaKey : ev.ctrlKey;
  const strayModifier = os === 'macos' ? ev.ctrlKey && !sc.ctrlOnly : ev.metaKey;
  if (sc.ctrlOnly) {
    if (!(os === 'macos' && ev.ctrlKey && !ev.metaKey)) return false;
  } else if (primaryPressed !== sc.primary || strayModifier) {
    return false;
  }
  return (
    ev.shiftKey === sc.shift &&
    ev.altKey === sc.alt &&
    normalisedEventKey(ev) === sc.key
  );
}

/** Minimal structural view of a menu node (avoids importing React components). */
export interface ShortcutMenuNode {
  kind: string;
  id?: string;
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  children?: ShortcutMenuNode[];
  onSelect?: () => void;
  onToggle?: () => void;
}

export interface MenuShortcutBinding {
  id: string;
  label: string;
  shortcut: ParsedShortcut;
  /** Disabled by the item itself or by any ancestor submenu. */
  disabled: boolean;
  run: () => void;
}

/** A bound menu item met by walkBoundShortcuts, with the submenu labels above it. */
interface BoundShortcutItem {
  node: ShortcutMenuNode;
  /** The labels of the submenus that hold it, outermost first. */
  submenus: string[];
  shortcut: ParsedShortcut;
  disabled: boolean;
  run: () => void;
}

/**
 * Every menu item a key combination runs, in menu order: an item with a handler and a shortcut label
 * parseShortcutLabel reads, and only the first item that displays a given combination.
 */
function walkBoundShortcuts(trees: readonly (readonly ShortcutMenuNode[])[], visit: (item: BoundShortcutItem, tree: number) => void): void {
  const seen = new Set<string>();
  const walk = (nodes: readonly ShortcutMenuNode[], ancestorDisabled: boolean, submenus: string[], tree: number) => {
    for (const node of nodes) {
      const disabled = ancestorDisabled || Boolean(node.disabled);
      if (node.kind === 'submenu' && node.children) {
        walk(node.children, disabled, [...submenus, node.label ?? ''], tree);
        continue;
      }
      const run = node.kind === 'checkbox' ? node.onToggle : node.kind === 'command' ? node.onSelect : undefined;
      const parsed = parseShortcutLabel(node.shortcut);
      if (!run || !parsed) continue;
      const key = `${parsed.primary}|${parsed.ctrlOnly}|${parsed.alt}|${parsed.shift}|${parsed.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      visit({ node, submenus, shortcut: parsed, disabled, run }, tree);
    }
  };
  trees.forEach((tree, i) => walk(tree, false, [], i));
}

/** Flatten menu trees into shortcut bindings; the first definition of a combination wins. */
export function collectMenuShortcutBindings(trees: readonly (readonly ShortcutMenuNode[])[]): MenuShortcutBinding[] {
  const out: MenuShortcutBinding[] = [];
  walkBoundShortcuts(trees, ({ node, shortcut, disabled, run }) => {
    out.push({ id: node.id ?? '', label: node.label ?? '', shortcut, disabled, run });
  });
  return out;
}

/** One row of the Preferences Keyboard tab: where the command is, and the keys that run it. */
export interface MenuShortcutRow {
  /** The menu item's id ('' for an explicit row). */
  id: string;
  /** The item's menu path, 'File > Export Sequences > Export GenBank'. */
  path: string;
  /** The shortcut label, as the menu shows it ('⌘S' on macOS, 'Ctrl+S' elsewhere). */
  label: string;
}

/**
 * Shortcuts the App binds outside the menu trees, listed after the menu rows. `primary` rows take the
 * platform's command key (⌘K on macOS, Ctrl+K elsewhere); the others are the bare key.
 */
export const EXPLICIT_SHORTCUT_ROWS: readonly { path: string; key: string; primary: boolean }[] = [
  // App.tsx's Command Palette listener; no menu item displays it. ⌘K has one name everywhere (D0280, D0281).
  { path: 'Command Palette', key: 'K', primary: true },
  // App.tsx's own F1 listener. Help > Guides shows "F1", but parseShortcutLabel binds no bare key.
  { path: 'Help > Guides > Show or Hide Help Panel', key: 'F1', primary: false },
];

/**
 * The Preferences Keyboard tab's rows: each menu item a combination runs, found by the walk
 * collectMenuShortcutBindings dispatches from (so a combination bound twice is listed once, under
 * its first definition), then EXPLICIT_SHORTCUT_ROWS formatted for `os`. `topLabels` names each tree
 * (the menu bar's "File", "View", ...) and starts its rows' paths; when given it must name every tree.
 */
export function menuShortcutRows(
  trees: readonly (readonly ShortcutMenuNode[])[],
  opts: { topLabels?: readonly string[]; os: SupportedOS }
): MenuShortcutRow[] {
  const { topLabels, os } = opts;
  if (topLabels && topLabels.length !== trees.length) {
    throw new Error(`menuShortcutRows was given ${trees.length} menu trees but ${topLabels.length} labels for them`);
  }
  const rows: MenuShortcutRow[] = [];
  walkBoundShortcuts(trees, ({ node, submenus }, tree) => {
    const path = [...(topLabels ? [topLabels[tree]] : []), ...submenus, node.label ?? ''].join(' > ');
    rows.push({ id: node.id ?? '', path, label: node.shortcut?.trim() ?? '' });
  });
  for (const row of EXPLICIT_SHORTCUT_ROWS) {
    rows.push({ id: '', path: row.path, label: row.primary ? formatPlatformShortcut(row.key, os) : row.key });
  }
  return rows;
}

/** Find the menu binding for a key event, if any. */
export function findMenuShortcut(
  bindings: readonly MenuShortcutBinding[],
  ev: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> &
    Partial<Pick<KeyboardEvent, 'getModifierState'>>,
  os: SupportedOS
): MenuShortcutBinding | undefined {
  return bindings.find((b) => eventMatchesShortcut(ev, b.shortcut, os));
}
