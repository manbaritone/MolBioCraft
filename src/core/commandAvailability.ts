// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Centralised, declarative command-availability predicates.
 *
 * Menus (in-window and context), toolbar buttons, keyboard shortcuts and the
 * native-menu dispatcher all consult the same rule for a command, so a command
 * cannot be enabled in one entry point and silently ignored (or allowed to
 * corrupt a document) in another. Each rule returns `{ enabled, reason }`;
 * the reason is shown to the user when a disabled command is invoked through
 * an entry point that cannot render a disabled state (native menu, shortcut).
 */

import type { MoleculeType, SequenceDocument, Topology } from '../types/bio';

export interface CommandDocumentContext {
  id: string;
  moleculeType: MoleculeType;
  topology: Topology;
  sequenceLength: number;
  /** Annotation count; an annotation-only (contig summary) record is still exportable. */
  featureCount?: number;
}

export interface CommandContext {
  sessionActive: boolean;
  /** The active document, or null when the session has no real document (blank session). */
  activeDoc: CommandDocumentContext | null;
  /** 1-based inclusive selection on the active document, if any. */
  selection: { start: number; end: number } | null;
  undoDepth: number;
  redoDepth: number;
  /**
   * Documents in the workbench that hold a structure file (PDB or mmCIF), for the commands that
   * work on them. A caller that does not count them leaves it out, and such a command is then not
   * disabled for want of them (its own window says what it needs).
   */
  structureDocumentCount?: number;
  /**
   * Whether the open tab has settings for the right-hand inspector (the Sequence tab's controls, or
   * a studio's). A caller that does not know leaves it out, and the native Toggle Inspector item
   * then follows the session alone.
   */
  inspectorAvailable?: boolean;
}

export type CommandId =
  | 'undo'
  | 'redo'
  | 'strand-transform'
  | 'convert-dna-rna'
  | 'set-origin'
  | 'nucleotide-analysis'
  | 'document-edit'
  | 'export-active-document'
  | 'export-sequence';

/**
 * Commands that open on the workbench's documents rather than on the active one (their window
 * picks the documents): their rules read the workbench, not `activeDoc`.
 */
export type WorkbenchCommandId = 'align-structures';

export interface CommandAvailability {
  enabled: boolean;
  reason?: string;
}

const ENABLED: CommandAvailability = { enabled: true };
const off = (reason: string): CommandAvailability => ({ enabled: false, reason });

const NO_SESSION = 'No active session — start a New Session first.';
const NO_DOCUMENT = 'Open or create a sequence document first.';

function requireDocument(ctx: CommandContext): CommandAvailability | CommandDocumentContext {
  if (!ctx.sessionActive) return off(NO_SESSION);
  if (!ctx.activeDoc || !ctx.activeDoc.id) return off(NO_DOCUMENT);
  return ctx.activeDoc;
}

function isAvailability(v: CommandAvailability | CommandDocumentContext): v is CommandAvailability {
  return typeof (v as CommandAvailability).enabled === 'boolean';
}

const RULES: Record<CommandId | WorkbenchCommandId, (ctx: CommandContext) => CommandAvailability> = {
  undo: (ctx) =>
    !ctx.sessionActive ? off(NO_SESSION) : ctx.undoDepth > 0 ? ENABLED : off('Nothing to undo.'),
  redo: (ctx) =>
    !ctx.sessionActive ? off(NO_SESSION) : ctx.redoDepth > 0 ? ENABLED : off('Nothing to redo.'),
  'document-edit': (ctx) => {
    const doc = requireDocument(ctx);
    return isAvailability(doc) ? doc : ENABLED;
  },
  'export-active-document': (ctx) => {
    const doc = requireDocument(ctx);
    if (isAvailability(doc)) return doc;
    return doc.sequenceLength > 0 || (doc.featureCount ?? 0) > 0
      ? ENABLED
      : off('The active document has no sequence or annotations to export.');
  },
  // FASTA export and Copy Sequence write residues: an annotation-only record
  // has none, so these stay disabled for it (GenBank/EMBL/GFF3 do not).
  'export-sequence': (ctx) => {
    const doc = requireDocument(ctx);
    if (isAvailability(doc)) return doc;
    return doc.sequenceLength > 0
      ? ENABLED
      : off('The active document has no sequence (annotation-only record); export it as GenBank, EMBL or GFF3.');
  },
  'strand-transform': (ctx) => {
    const doc = requireDocument(ctx);
    if (isAvailability(doc)) return doc;
    return doc.moleculeType === 'Protein'
      ? off('Strand operations apply to DNA or RNA documents, not proteins.')
      : ENABLED;
  },
  'convert-dna-rna': (ctx) => {
    const doc = requireDocument(ctx);
    if (isAvailability(doc)) return doc;
    return doc.moleculeType === 'Protein'
      ? off('DNA ⇄ RNA conversion applies to nucleotide documents, not proteins.')
      : ENABLED;
  },
  'nucleotide-analysis': (ctx) => {
    const doc = requireDocument(ctx);
    if (isAvailability(doc)) return doc;
    return doc.moleculeType === 'Protein'
      ? off('This analysis requires a DNA or RNA document.')
      : ENABLED;
  },
  'set-origin': (ctx) => {
    const doc = requireDocument(ctx);
    if (isAvailability(doc)) return doc;
    if (doc.moleculeType === 'Protein') return off('Set Origin applies to circular DNA molecules.');
    if (doc.topology !== 'circular') {
      return off('Set Origin only applies to circular molecules; this document is linear.');
    }
    if (!ctx.selection) return off('Place the cursor or select a base to mark the new origin first.');
    return ENABLED;
  },
  // Align Structures… aligns chains of structure documents, two of them or two chains of one.
  'align-structures': (ctx) => {
    if (!ctx.sessionActive) return off(NO_SESSION);
    return ctx.structureDocumentCount === 0
      ? off('Import a structure (PDB or mmCIF) first: Align Structures aligns chains of structure documents.')
      : ENABLED;
  },
};

export function commandAvailability(id: CommandId | WorkbenchCommandId, ctx: CommandContext): CommandAvailability {
  return RULES[id](ctx);
}

export function buildCommandDocumentContext(
  doc:
    | (Pick<SequenceDocument, 'id' | 'moleculeType' | 'topology' | 'sequence'> & { features?: readonly unknown[] })
    | null
    | undefined
): CommandDocumentContext | null {
  if (!doc || !doc.id) return null;
  return {
    id: doc.id,
    moleculeType: doc.moleculeType,
    topology: doc.topology,
    sequenceLength: doc.sequence.length,
    featureCount: doc.features?.length ?? 0,
  };
}

/** Coarse molecule class used to refuse mixing proteins with nucleotides. */
export function moleculeClassOf(doc: Pick<SequenceDocument, 'moleculeType'>): 'nucleotide' | 'protein' {
  return doc.moleculeType === 'Protein' ? 'protein' : 'nucleotide';
}

/**
 * Validate the target set of a multi-sequence operation (consensus,
 * concatenation): enough documents, all of one molecule class.
 */
export function checkMultiDocumentSelection(
  docs: Pick<SequenceDocument, 'moleculeType'>[],
  minRequired: number
): { ok: true } | { ok: false; reason: string } {
  if (docs.length < minRequired) {
    return {
      ok: false,
      reason: `select at least ${minRequired} sequences in the document table (currently ${docs.length}).`,
    };
  }
  const classes = new Set(docs.map(moleculeClassOf));
  if (classes.size > 1) {
    return { ok: false, reason: 'the selection mixes DNA/RNA with protein documents.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Native (macOS) menu-bar state
// ---------------------------------------------------------------------------

/**
 * Native menu ids that work without an active session (the dispatcher does
 * not wrap them in requireActiveSession). Every other native id is disabled
 * while no session is active. Kept in sync with src-tauri/src/main.rs and the
 * App.tsx dispatcher by src/__tests__/nativeMenuContract.test.ts.
 */
export const NATIVE_MENU_SESSION_INDEPENDENT_PREFIXES = ['app:', 'help:', 'new-session:', 'action-vec:'];
export const NATIVE_MENU_SESSION_INDEPENDENT_IDS = [
  'edit:undo',
  'edit:redo',
  'enzymes:suppliers',
  'file:close-session',
  'file:export-preferences',
  'file:import-clipboard',
  'file:import-files',
  'file:import-folder',
  'file:import-ncbi-db',
  'file:import-ngs',
  'file:import-preferences',
  'file:import-samples',
  'file:import-sanger',
  'file:import-twist-vector',
  'file:import-vector-catalog',
  'file:open-session',
  'file:restore-autosave',
  'file:restore-backup',
  'prefs:gels',
  'primers:preferences',
  'tools:blast-setup',
  'tools:databases-explorer',
  'tools:local-blast-dbs',
  'tools:preferences',
  'view:search-tools',
  'view:toggle-sidebar',
];

/** Native ids whose availability follows a specific command rule (not just "session active"). */
export const NATIVE_MENU_COMMAND_RULES: Record<string, CommandId | WorkbenchCommandId> = {
  'edit:undo': 'undo',
  'edit:redo': 'redo',
  'sequence:reverse-complement': 'strand-transform',
  'sequence:complement-only': 'strand-transform',
  'sequence:reverse-only': 'strand-transform',
  'sequence:convert-dna-rna': 'convert-dna-rna',
  'view:set-origin': 'set-origin',
  'file:save-gb': 'export-active-document',
  'file:save-fasta': 'export-sequence',
  'file:export-embl': 'export-active-document',
  'file:export-gff3': 'export-active-document',
  'edit:copy-sequence': 'export-sequence',
  'align:structures-dialog': 'align-structures',
};

export interface NativeMenuStatePayload {
  sessionActive: boolean;
  sessionIndependentIds: string[];
  sessionIndependentPrefixes: string[];
  overrides: Record<string, boolean>;
}

/** Build the payload the desktop backend applies to the native menu bar. */
export function buildNativeMenuState(ctx: CommandContext): NativeMenuStatePayload {
  const overrides: Record<string, boolean> = {};
  for (const [id, rule] of Object.entries(NATIVE_MENU_COMMAND_RULES)) {
    overrides[id] = commandAvailability(rule, ctx).enabled;
  }
  // Undo/Redo stay enabled inside text fields (the dispatcher routes them to
  // text undo), so they are only disabled when there is no session at all.
  overrides['edit:undo'] = true;
  overrides['edit:redo'] = true;
  // Toggle Inspector is greyed on a tab with nothing to set. Without a session it is greyed with
  // every session command already, so that state carries the command rules alone.
  if (ctx.sessionActive && ctx.inspectorAvailable !== undefined) {
    overrides['view:toggle-inspector'] = ctx.inspectorAvailable;
  }
  return {
    sessionActive: ctx.sessionActive,
    sessionIndependentIds: NATIVE_MENU_SESSION_INDEPENDENT_IDS,
    sessionIndependentPrefixes: NATIVE_MENU_SESSION_INDEPENDENT_PREFIXES,
    overrides,
  };
}

/** Resolve one native item's enabled state exactly as the backend does. */
export function resolveNativeMenuItemEnabled(id: string, state: NativeMenuStatePayload): boolean {
  if (id in state.overrides) return state.overrides[id];
  return (
    state.sessionActive ||
    state.sessionIndependentIds.includes(id) ||
    state.sessionIndependentPrefixes.some((p) => id.startsWith(p))
  );
}

/**
 * Detected feature is an affinity/epitope tag or a protease cleavage site.
 * Uses the engine's own classification (feature type `tag`; `protein_bind`
 * carrying a cleavage site) — a free-text match on names and notes also
 * caught resistance markers ("Kanamycin" contains "myc") and promoters.
 */
export function isTagOrProteaseFeature(f: { type: string; cleavageSite?: string }): boolean {
  return f.type === 'tag' || (f.type === 'protein_bind' && Boolean(f.cleavageSite));
}
