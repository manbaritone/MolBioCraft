// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * User-assigned keyboard shortcuts and toolbar buttons for operations that open an
 * options window. Both are set from the settings menu of that operation's window.
 */

import { PLATFORM_SHORTCUTS, registryShortcuts } from './commandRegistry';

export const OPERATION_LABELS = {
  'align-multiple': 'Multiple Alignment',
  'align-pairwise': 'Pairwise Alignment',
  'build-tree': 'Build Tree',
  'digest-fragments': 'Digest into Fragments',
  'design-primers': 'Design Primers',
  'find-orfs': 'Find ORFs',
  'clone-insert': 'Clone Insert into Vector',
  'de-novo-assemble': 'De Novo Assemble',
  'map-to-reference': 'Map to Reference',
  'find-duplicates': 'Find Duplicates',
  'batch-rename': 'Batch Rename',
  'translation-align': 'Translation Alignment',
  'mask-alignment': 'Mask Alignment',
  'generate-consensus': 'Generate Consensus',
  'consensus-tree': 'Consensus Tree',
  'test-saved-primers': 'Test with Saved Primers',
  'trim-ends': 'Trim Ends',
  'back-translate': 'Back-Translate',
  'add-to-alignment': 'Add Sequences to Alignment',
  'validate-clone': 'Validate Clone',
  'import-metadata': 'Import Metadata from Spreadsheet',
  'merge-pairs': 'Merge Paired Reads',
  'compare-annotations': 'Compare Annotations',
  'read-qc': 'Read QC Report',
  'compute-distances': 'Compute Distances',
  'condense-tree': 'Condense Tree',
  'gene-duplications': 'Gene Duplication Inference',
  'highlight-sites': 'Highlight Sites',
  'evo-models': 'Models',
  'evo-diversity': 'Diversity',
  'evo-selection': 'Selection',
  'evo-rates': 'Site Rates',
  'evo-ancestors': 'Ancestral Sequences',
  'evo-clocks': 'Molecular Clock Tests',
  timetree: 'Compute Timetree',
  'degenerate-primers': 'Design Degenerate Primers',
  'annotate-from-documents': 'Annotate from Documents',
  'import-primers': 'Import Primers from Spreadsheet',
  'annotate-by-blast': 'Annotate by BLAST',
  'crispr-editing': 'CRISPR Editing Analysis',
  expression: 'Compare Expression Levels',
  'make-blast-db': 'Make BLAST Database from Selection',
  'expression-levels': 'Calculate Expression Levels',
  'structural-variants': 'Find Structural Variants',
  microsatellites: 'Microsatellite Analysis',
  'align-structures': 'Align Structures',
} as const;

export type OperationId = keyof typeof OPERATION_LABELS;

export const IS_MAC_PLATFORM = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function isOperationId(id: string): id is OperationId {
  return id in OPERATION_LABELS;
}

interface Store {
  shortcuts: Partial<Record<OperationId, string>>;
  toolbar: OperationId[];
}

const KEY = 'molbiocraft.operationShortcuts.v1';
export const OPERATION_SHORTCUTS_EVENT = 'molbiocraft:operation-shortcuts';

/**
 * Shortcuts the workbench already uses, which an operation cannot take: every key of the command
 * registry (its commands' shortcuts and second keys) plus the platform's own keys (US-01M6Q1N2). It
 * is derived, never kept by hand, so a key the menus gain or lose is reserved or freed with them.
 */
export const RESERVED_SHORTCUTS: ReadonlySet<string> = new Set([...registryShortcuts(), ...PLATFORM_SHORTCUTS]);

export function readOperationShortcuts(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Store>;
      const shortcuts: Store['shortcuts'] = {};
      for (const [k, v] of Object.entries(p.shortcuts ?? {})) {
        if (isOperationId(k) && typeof v === 'string' && v) shortcuts[k] = v;
      }
      const toolbar = Array.isArray(p.toolbar) ? p.toolbar.filter((x): x is OperationId => typeof x === 'string' && isOperationId(x)) : [];
      return { shortcuts, toolbar: Array.from(new Set(toolbar)) };
    }
  } catch {
    // ignore unreadable storage
  }
  return { shortcuts: {}, toolbar: [] };
}

function write(store: Store) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // storage unavailable
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(OPERATION_SHORTCUTS_EVENT, { detail: store }));
  } catch {
    // no event target
  }
}

/** Canonical "Mod+Shift+K" form; `Mod` is ⌘ on macOS and Ctrl elsewhere. Null for bare keys. */
export function shortcutFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & { code?: string },
  isMac: boolean
): string | null {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod) return null;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  // Use the physical key for letters and digits: on macOS ⌥ changes e.key (⌥P → "π").
  const physical = /^Key([A-Z])$/.exec(e.code ?? '')?.[1] ?? /^Digit([0-9])$/.exec(e.code ?? '')?.[1];
  const k = physical ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return ['Mod', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', k].filter(Boolean).join('+');
}

export function formatShortcut(s: string, isMac: boolean): string {
  return s.split('+').map((p) => {
    if (p === 'Mod') return isMac ? '⌘' : 'Ctrl+';
    if (p === 'Alt') return isMac ? '⌥' : 'Alt+';
    if (p === 'Shift') return isMac ? '⇧' : 'Shift+';
    return p;
  }).join('');
}

/** Assigns (or clears with null) a shortcut. Returns an error message instead of saving on a conflict. */
export function setOperationShortcut(op: OperationId, shortcut: string | null): string | null {
  const store = readOperationShortcuts();
  if (shortcut) {
    if (RESERVED_SHORTCUTS.has(shortcut)) return 'That shortcut is already used by MolBioCraft.';
    const clash = (Object.entries(store.shortcuts) as [OperationId, string][]).find(([k, v]) => v === shortcut && k !== op);
    if (clash) return `That shortcut is already assigned to ${OPERATION_LABELS[clash[0]]}.`;
    store.shortcuts[op] = shortcut;
  } else {
    delete store.shortcuts[op];
  }
  write(store);
  return null;
}

/**
 * Releases every saved operation shortcut the workbench now uses itself (a key that became an app key,
 * such as ⌘9 or ⌥⌘1 for US-01M6Q1CF), saving the store without them, and returns what it released.
 */
export function releaseReservedOperationShortcuts(): { op: OperationId; shortcut: string }[] {
  const store = readOperationShortcuts();
  const released = (Object.entries(store.shortcuts) as [OperationId, string][])
    .filter(([, shortcut]) => RESERVED_SHORTCUTS.has(shortcut))
    .map(([op, shortcut]) => ({ op, shortcut }));
  if (released.length === 0) return [];
  for (const { op } of released) delete store.shortcuts[op];
  write(store);
  return released;
}

export function setOperationInToolbar(op: OperationId, shown: boolean): void {
  const store = readOperationShortcuts();
  store.toolbar = shown ? Array.from(new Set([...store.toolbar, op])) : store.toolbar.filter((x) => x !== op);
  write(store);
}

/** The operation whose shortcut matches `combo`, if any. */
export function operationForShortcut(combo: string): OperationId | null {
  const hit = (Object.entries(readOperationShortcuts().shortcuts) as [OperationId, string][]).find(([, v]) => v === combo);
  return hit ? hit[0] : null;
}
