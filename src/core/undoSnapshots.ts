// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';

/**
 * Apply an undo/redo snapshot to a document.
 *
 * Undo history stores whole-document snapshots of *content* edits. Workspace
 * organisation (which folder the document lives in) is not undoable and may
 * have changed since the snapshot was taken; restoring the snapshot verbatim
 * silently moved the document back to its old folder. Keep the current one.
 */
export function applyHistorySnapshot(current: SequenceDocument, snapshot: SequenceDocument): SequenceDocument {
  return { ...snapshot, folder: current.folder };
}
