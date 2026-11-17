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
import { isContigSummaryRecord } from './contigSummary';

export interface CommandDocumentContext {
  id: string;
  moleculeType: MoleculeType;
  topology: Topology;
  sequenceLength: number;
  /** Annotation count; an annotation-only (contig summary) record is still exportable. */
  featureCount?: number;
  /**
   * Whether the document is a contig-summary record (annotations with no bases), which the Sequence
   * view shows as a summary with no sequence map. A caller that does not know leaves it out.
   */
  contigSummary?: boolean;
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
  /**
   * The Sequence view's map layout as drawn (the chosen one, or Linear for a document that has no
   * circular map). A caller that does not know leaves it out, and the map commands then follow the
   * document alone.
   */
  mapLayout?: 'split' | 'circular' | 'linear';
  /** Whether the circular map is collapsed in Split; left out, it is not. */
  circleCollapsed?: boolean;
  /**
   * The split view's second pane, given only while it is the focused pane (US-01M7DV10): whether it
   * shows a circular map, and whether it shows a sequence map at all (US-01M7DVEN). The map commands
   * (`zoom-map`, `rotate-map`, `fit-view`) then answer for that pane; left out, the main view is
   * focused and every rule answers for it.
   */
  focusedSplitPane?: { circularMapShown: boolean; sequenceMapShown: boolean };
  /**
   * The rows checked in the document table that the table shows (US-01M7DVS2), which the Map Gallery
   * opens on (`multi-record-view`). A caller that does not count them leaves it out, and the gallery
   * is then refused, not opened on records nobody counted.
   */
  checkedRecordCount?: number;
}

export type CommandId =
  | 'undo'
  | 'redo'
  | 'strand-transform'
  | 'convert-dna-rna'
  | 'set-origin'
  | 'rotate-map'
  | 'nucleotide-analysis'
  | 'document-edit'
  | 'export-active-document'
  | 'export-sequence';

/**
 * Commands that open on the workbench's documents rather than on the active one (their window
 * picks the documents): their rules read the workbench, not `activeDoc`. View › Map Gallery and the
 * table toolbar's Map Gallery button (`multi-record-view`, US-01M7DVS2) read the checked rows.
 */
export type WorkbenchCommandId = 'align-structures' | 'multi-record-view';

/**
 * Commands on the focused pane's view rather than on a document (US-01M7DV10): View › Zoom In, Zoom
 * Out and Actual Size (`zoom-map`); View › Fit and Reset View (`fit-view`, US-01M7DVEN). Their rules
 * read the session, the main view's map and `focusedSplitPane`. View › Map Layout's Split Map &
 * Sequence and Circular Map (`map-layout-circle`, US-01M7DVEN) read the main view's document.
 */
export type ViewCommandId = 'zoom-map' | 'fit-view' | 'map-layout-circle' | TrackCommandId;

/**
 * The tracks View › Tracks shows or hides (US-01M7DV8W). Each one's availability is
 * {@link trackAvailability}, the one rule its in-app item, its native id (`view:track-<id>`, under the
 * command `track-<id>`) and its inspector control read.
 */
export type TrackId = 'features' | 'primers' | 'restriction-sites' | 'orfs' | 'translation' | 'gc-graph' | 'hydropathy-graph';
export type TrackCommandId = `track-${TrackId}`;
export const TRACK_IDS: readonly TrackId[] = ['features', 'primers', 'restriction-sites', 'orfs', 'translation', 'gc-graph', 'hydropathy-graph'];

export interface CommandAvailability {
  enabled: boolean;
  reason?: string;
}

const ENABLED: CommandAvailability = { enabled: true };
const off = (reason: string): CommandAvailability => ({ enabled: false, reason });

const NO_SESSION = 'No active session — start a New Session first.';
const NO_DOCUMENT = 'Open or create a sequence document first.';
/** Why the map commands are off while the focused split pane draws no circle (US-01M7DV10). */
export const FOCUSED_SPLIT_PANE_NO_CIRCLE = 'The focused split pane shows no circular map.';
/** Why View › Zoom In, Zoom Out and Actual Size are off while the main view draws no circular map (US-01M7DVEN). */
export const CIRCULAR_ONLY_HINT = 'Applies to the circular map (switch View › Map Layout to Circular or Split)';
/** Why View › Fit and Reset View are off for a main-view document that has no sequence map (US-01M7DVEN). */
export const NO_SEQUENCE_MAP = 'This record has no sequence map.';
/** Why View › Fit and Reset View are off while the focused split pane draws no sequence map (US-01M7DVEN). */
export const FOCUSED_SPLIT_PANE_NO_SEQUENCE_MAP = 'The focused split pane shows no sequence map.';

function requireDocument(ctx: CommandContext): CommandAvailability | CommandDocumentContext {
  if (!ctx.sessionActive) return off(NO_SESSION);
  if (!ctx.activeDoc || !ctx.activeDoc.id) return off(NO_DOCUMENT);
  return ctx.activeDoc;
}

function isAvailability(v: CommandAvailability | CommandDocumentContext): v is CommandAvailability {
  return typeof (v as CommandAvailability).enabled === 'boolean';
}

const RULES: Record<CommandId | WorkbenchCommandId | ViewCommandId, (ctx: CommandContext) => CommandAvailability> = {
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
  // Rotate Circular Map… and Reset Rotation turn the circular map (US-01M7DVG4): they are offered
  // exactly where the Sequence view draws a circle (the App's canShowCircularMap, in a layout that
  // shows it, not collapsed), so neither is offered where there is no circle to turn.
  // With the split pane focused (US-01M7DV10) they turn its map, offered only while it draws one.
  'rotate-map': (ctx) => {
    if (ctx.sessionActive && ctx.focusedSplitPane) {
      return ctx.focusedSplitPane.circularMapShown ? ENABLED : off(FOCUSED_SPLIT_PANE_NO_CIRCLE);
    }
    const doc = requireDocument(ctx);
    if (isAvailability(doc)) return doc;
    const cannotDraw = circularMapUnavailableReason(doc);
    if (cannotDraw) return off(cannotDraw);
    if (ctx.mapLayout === 'linear') return off('Map Layout is Linear; choose Split or Circular Map to rotate the map.');
    if (ctx.circleCollapsed) return off('The circular map is collapsed; restore it to rotate the map.');
    return ENABLED;
  },
  // View › Zoom In, Zoom Out and Actual Size (US-01M7DV10) zoom the focused pane's circular map, so
  // they are offered only while it draws one: on the split pane by `focusedSplitPane`; on the main
  // view while its layout as drawn is Split or Circular and its document can draw a circle
  // (US-01M7DVEN). The viewer header's −, % and + read this rule too.
  'zoom-map': (ctx) => {
    if (!ctx.sessionActive) return off(NO_SESSION);
    if (ctx.focusedSplitPane) {
      return ctx.focusedSplitPane.circularMapShown ? ENABLED : off(FOCUSED_SPLIT_PANE_NO_CIRCLE);
    }
    if (ctx.mapLayout === 'linear') return off(CIRCULAR_ONLY_HINT);
    if (!ctx.activeDoc || circularMapUnavailableReason(ctx.activeDoc)) return off(CIRCULAR_ONLY_HINT);
    return ENABLED;
  },
  // View › Fit and Reset View (US-01M7DVEN) fit the focused pane's sequence map: offered wherever it
  // draws one, circular or linear. The main view draws none for a document with no bases (a contig
  // summary has none either); the split pane none in Info, for a tree, an alignment, a text document
  // or no document.
  'fit-view': (ctx) => {
    if (!ctx.sessionActive) return off(NO_SESSION);
    if (ctx.focusedSplitPane) {
      return ctx.focusedSplitPane.sequenceMapShown ? ENABLED : off(FOCUSED_SPLIT_PANE_NO_SEQUENCE_MAP);
    }
    if (!ctx.activeDoc || ctx.activeDoc.sequenceLength === 0) return off(NO_SEQUENCE_MAP);
    return ENABLED;
  },
  // View › Map Layout's Split Map & Sequence and Circular Map (US-01M7DVEN) draw a circle, so they are
  // offered only for a document that can draw one, with the sentence circularMapUnavailableReason gives.
  'map-layout-circle': (ctx) => {
    const doc = requireDocument(ctx);
    if (isAvailability(doc)) return doc;
    const cannotDraw = circularMapUnavailableReason(doc);
    return cannotDraw ? off(cannotDraw) : ENABLED;
  },
  'track-features': (ctx) => trackAvailability('features', ctx),
  'track-primers': (ctx) => trackAvailability('primers', ctx),
  'track-restriction-sites': (ctx) => trackAvailability('restriction-sites', ctx),
  'track-orfs': (ctx) => trackAvailability('orfs', ctx),
  'track-translation': (ctx) => trackAvailability('translation', ctx),
  'track-gc-graph': (ctx) => trackAvailability('gc-graph', ctx),
  'track-hydropathy-graph': (ctx) => trackAvailability('hydropathy-graph', ctx),
  // Align Structures… aligns chains of structure documents, two of them or two chains of one.
  'align-structures': (ctx) => {
    if (!ctx.sessionActive) return off(NO_SESSION);
    return ctx.structureDocumentCount === 0
      ? off('Import a structure (PDB or mmCIF) first: Align Structures aligns chains of structure documents.')
      : ENABLED;
  },
  // Map Gallery (US-01M7DVS2) shows two or more of the table's checked rows. It counts rows only, so
  // DNA mixed with protein is allowed (unlike checkMultiDocumentSelection, which refuses the mix).
  'multi-record-view': (ctx) => {
    if (!ctx.sessionActive) return off(NO_SESSION);
    if (ctx.checkedRecordCount === undefined) return off('The checked rows of the document table are not known.');
    return ctx.checkedRecordCount >= 2 ? ENABLED : off(`Check two or more records in the document table (now ${ctx.checkedRecordCount}).`);
  },
};

/**
 * Why a document cannot draw a circular map, or null when it can (US-01M7DVQG): the one rule that
 * View › Rotate Circular Map… (`rotate-map`), the split pane's 'Circular Map' view, and View › Map
 * Layout's circle items and View › Zoom's zoom items (`map-layout-circle`, `zoom-map`, US-01M7DVEN)
 * read, in this order: a contig summary, a protein, RNA, a linear molecule. A caller that does not know
 * whether the document is a contig summary leaves `contigSummary` out.
 */
export function circularMapUnavailableReason(
  doc: Pick<CommandDocumentContext, 'moleculeType' | 'topology'> & { contigSummary?: boolean }
): string | null {
  if (doc.contigSummary) return 'This record has no sequence map.';
  if (doc.moleculeType === 'Protein') return 'Circular maps are drawn for DNA only; this document is a protein.';
  if (doc.moleculeType === 'RNA') return 'Circular maps are drawn for DNA only; this document is RNA.';
  if (doc.topology !== 'circular') return 'Circular maps are drawn for circular DNA; this document is linear.';
  return null;
}

/** What each track a protein has no use for says, naming the molecule type (US-01M7DV8W). */
const TRACK_ON_NUCLEOTIDES: Partial<Record<TrackId, string>> = {
  'restriction-sites': 'Restriction sites are drawn on DNA and RNA only',
  orfs: 'ORFs are drawn on DNA and RNA only',
  translation: 'Translation is drawn on DNA and RNA only',
  'gc-graph': 'The GC graph is drawn on DNA and RNA only',
};

/**
 * Whether View › Tracks' `track` can be shown or hidden on the main view's document (US-01M7DV8W),
 * the one rule its in-app item, its native id and its inspector control read; the split pane's
 * focus does not change it. Features and Hydropathy Graph apply to every document; Translation, GC
 * Graph, Restriction Sites and ORFs not to a protein, and Primers to DNA only, each saying the
 * molecule type. Primers and ORFs are drawn only on the circle, so they are off with
 * CIRCULAR_ONLY_HINT where the main view draws none: Map Layout Linear, or a document that cannot
 * draw a circle (circularMapUnavailableReason).
 */
export function trackAvailability(track: TrackId, ctx: CommandContext): CommandAvailability {
  const doc = requireDocument(ctx);
  if (isAvailability(doc)) return doc;
  const molecule = doc.moleculeType === 'Protein' ? 'a protein' : doc.moleculeType === 'RNA' ? 'RNA' : 'DNA';
  if (track === 'primers' && doc.moleculeType !== 'DNA') return off(`Primers are drawn on DNA only; this document is ${molecule}.`);
  const nucleotidesOnly = TRACK_ON_NUCLEOTIDES[track];
  if (nucleotidesOnly && doc.moleculeType === 'Protein') return off(`${nucleotidesOnly}; this document is ${molecule}.`);
  if ((track === 'primers' || track === 'orfs') && (ctx.mapLayout === 'linear' || circularMapUnavailableReason(doc))) {
    return off(CIRCULAR_ONLY_HINT);
  }
  return ENABLED;
}

export function commandAvailability(id: CommandId | WorkbenchCommandId | ViewCommandId, ctx: CommandContext): CommandAvailability {
  return RULES[id](ctx);
}

export function buildCommandDocumentContext(
  doc:
    | (Pick<SequenceDocument, 'id' | 'moleculeType' | 'topology' | 'sequence'> &
        Partial<Pick<SequenceDocument, 'docMetadata'>> & { features?: readonly unknown[] })
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
    contigSummary: isContigSummaryRecord(doc as SequenceDocument),
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
  'tools:enzyme-database',
  'tools:local-blast-dbs',
  'tools:preferences',
  'tools:primer-database',
  'view:search-tools',
  'view:toggle-sidebar',
];

/** Native ids whose availability follows a specific command rule (not just "session active"). */
export const NATIVE_MENU_COMMAND_RULES: Record<string, CommandId | WorkbenchCommandId | ViewCommandId> = {
  'edit:undo': 'undo',
  'edit:redo': 'redo',
  'sequence:reverse-complement': 'strand-transform',
  'sequence:complement-only': 'strand-transform',
  'sequence:reverse-only': 'strand-transform',
  'sequence:convert-dna-rna': 'convert-dna-rna',
  'view:set-origin': 'set-origin',
  // US-01M7DVNS: the native View > Zoom items run the in-app View items' handler, under its rule.
  'view:rotate-map': 'rotate-map',
  // US-01M7DV10: View > Zoom's three items, on the focused pane.
  'view:zoom-in': 'zoom-map',
  'view:zoom-out': 'zoom-map',
  'view:zoom-reset': 'zoom-map',
  'view:reset-rotation': 'rotate-map',
  // US-01M7DVEN: Fit and Reset View, on the focused pane, under Fit's rule; Map Layout's circle items.
  'view:fit': 'fit-view',
  'view:reset-view': 'fit-view',
  'view:layout-split': 'map-layout-circle',
  'view:layout-circular': 'map-layout-circle',
  // US-01M7DV8W: View > Tracks, each under its track's rule.
  'view:track-features': 'track-features',
  'view:track-primers': 'track-primers',
  'view:track-restriction-sites': 'track-restriction-sites',
  'view:track-orfs': 'track-orfs',
  'view:track-translation': 'track-translation',
  'view:track-gc-graph': 'track-gc-graph',
  'view:track-hydropathy-graph': 'track-hydropathy-graph',
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
