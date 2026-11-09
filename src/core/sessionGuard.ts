// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Session data-loss guard.
 *
 * Every action that replaces the workbench contents (New Session presets,
 * sample tutorials, opening a .mbc in replace mode, restoring the autosave,
 * Close Session) consults these pure predicates before it runs, so the user
 * is asked before unsaved work or an unrecovered autosave is discarded.
 *
 * Dirtiness is tracked by reference: the content slices of the session are
 * captured whenever the session becomes pristine (fresh start, load, save)
 * and any later state update that produces a new array/object reference marks
 * the session as modified. This is conservative (a no-op update that still
 * allocates a new array reads as "modified") but never misses a real edit,
 * because all state updates in the app are immutable.
 */

export interface SessionContentSnapshot {
  documents: unknown;
  deletedDocIds: unknown;
  customFolders: unknown;
  folderNames: unknown;
  folderParents: unknown;
  sessionName: string;
}

export function isSessionContentDirty(
  baseline: SessionContentSnapshot | null,
  current: SessionContentSnapshot
): boolean {
  if (!baseline) return false;
  return (
    baseline.documents !== current.documents ||
    baseline.deletedDocIds !== current.deletedDocIds ||
    baseline.customFolders !== current.customFolders ||
    baseline.folderNames !== current.folderNames ||
    baseline.folderParents !== current.folderParents ||
    baseline.sessionName !== current.sessionName
  );
}

export type SessionReplacementDecision =
  | { kind: 'proceed' }
  | { kind: 'confirm-unsaved-changes' }
  | { kind: 'confirm-discard-autosave' };

export interface SessionReplacementContext {
  /** The in-memory session (active or closed-but-resumable) has edits that were never saved. */
  hasUnsavedChanges: boolean;
  /** An autosave from a previous run exists that the user has neither restored nor discarded. */
  pendingAutosaveRecovery: boolean;
}

/**
 * Decide whether an action that would replace the in-memory workbench may run
 * immediately or must first be confirmed by the user.
 */
export function decideSessionReplacement(
  ctx: SessionReplacementContext
): SessionReplacementDecision {
  if (ctx.hasUnsavedChanges) return { kind: 'confirm-unsaved-changes' };
  if (ctx.pendingAutosaveRecovery) return { kind: 'confirm-discard-autosave' };
  return { kind: 'proceed' };
}
