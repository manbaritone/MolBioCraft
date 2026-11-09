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

import type { SupportedOS } from '../platform/osPlatform';

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

/** Flatten menu trees into shortcut bindings; the first definition of a combination wins. */
export function collectMenuShortcutBindings(trees: readonly (readonly ShortcutMenuNode[])[]): MenuShortcutBinding[] {
  const out: MenuShortcutBinding[] = [];
  const seen = new Set<string>();
  const walk = (nodes: readonly ShortcutMenuNode[], ancestorDisabled: boolean) => {
    for (const node of nodes) {
      const disabled = ancestorDisabled || Boolean(node.disabled);
      if (node.kind === 'submenu' && node.children) {
        walk(node.children, disabled);
        continue;
      }
      const run = node.kind === 'checkbox' ? node.onToggle : node.kind === 'command' ? node.onSelect : undefined;
      const parsed = parseShortcutLabel(node.shortcut);
      if (!run || !parsed) continue;
      const key = `${parsed.primary}|${parsed.ctrlOnly}|${parsed.alt}|${parsed.shift}|${parsed.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: node.id ?? '', label: node.label ?? '', shortcut: parsed, disabled, run });
    }
  };
  for (const tree of trees) walk(tree, false);
  return out;
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
