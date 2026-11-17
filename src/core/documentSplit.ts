// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The document split (US-01M7DVR0): whether the viewer shows one document (Single Pane) or a second
 * document beside it (Side by Side) or below it (Top and Bottom), and which document that second pane
 * shows. One rule per fact: this module owns the orientations, the class each one gives the split
 * host, the value a session saves, and `parseDocumentSplit`, the only reader of a saved value.
 */

export type DocumentSplitOrientation = 'single' | 'side-by-side' | 'top-bottom';

/** The orientations in the order the chooser and the View › Document Split submenu list them, with their labels. */
export const DOCUMENT_SPLIT_CHOICES: readonly { orientation: DocumentSplitOrientation; label: string }[] = [
  { orientation: 'single', label: 'Single Pane' },
  { orientation: 'side-by-side', label: 'Side by Side' },
  { orientation: 'top-bottom', label: 'Top and Bottom' },
];

const isOrientation = (v: unknown): v is DocumentSplitOrientation =>
  DOCUMENT_SPLIT_CHOICES.some((c) => c.orientation === v);

/** The split host's classes: `is-split` while a second pane shows, with the orientation's own class. */
export function documentSplitHostClass(orientation: DocumentSplitOrientation): string {
  if (orientation === 'side-by-side') return 'mbc-split-host is-split is-side-by-side';
  if (orientation === 'top-bottom') return 'mbc-split-host is-split is-top-bottom';
  return 'mbc-split-host';
}

/** What a session saves: the orientation, and the second pane's document by id and by name (to name it if it is gone). */
export interface SavedDocumentSplit {
  orientation: DocumentSplitOrientation;
  docId: string | null;
  docName: string | null;
}

/**
 * The value a session saves, or undefined while the split was never opened in it (Single Pane with
 * no document chosen), so a session that never used the split saves what it saved before.
 * `docId` is the App's pane document: null before one is chosen, '' while the pane asks for one.
 */
export function documentSplitForSession(
  orientation: DocumentSplitOrientation,
  docId: string | null,
  docs: readonly { id: string; name: string }[]
): SavedDocumentSplit | undefined {
  if (orientation === 'single' && docId === null) return undefined;
  const id = docId ? docId : null;
  return { orientation, docId: id, docName: id === null ? null : docs.find((d) => d.id === id)?.name ?? null };
}

export const UNREADABLE_DOCUMENT_SPLIT_NOTICE =
  'The saved document split could not be read; the viewer opens in Single Pane.';

export function missingSplitDocumentNotice(docName: string): string {
  return `The split pane's document "${docName}" is no longer in this session; the viewer opens in Single Pane.`;
}

/**
 * The split a restored session opens with, from the parser's `workspace.documentSplit` (`raw`) and the
 * documents the restored session can show (`available`), told apart by case:
 * - absent (a session saved before the field): Single Pane, no document, no notice;
 * - not an object, an orientation that is not one of the three, or a docId that is neither a string
 *   nor null: Single Pane, no document, and UNREADABLE_DOCUMENT_SPLIT_NOTICE;
 * - a docId no available document has: Single Pane, no document, and the notice naming it (by its
 *   saved name, or its id when the name was not saved);
 * - otherwise the saved orientation and document; a docId of null (or '') with a split orientation
 *   reopens the pane asking for a document ('').
 * `docId` is in the App's terms: null for no document, '' for the pane's "Choose a document…".
 */
export function parseDocumentSplit(
  raw: unknown,
  available: readonly { id: string }[]
): { orientation: DocumentSplitOrientation; docId: string | null; notice: string | null } {
  const single = (notice: string | null) => ({ orientation: 'single' as const, docId: null, notice });
  if (raw === undefined) return single(null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return single(UNREADABLE_DOCUMENT_SPLIT_NOTICE);
  const v = raw as Record<string, unknown>;
  if (!isOrientation(v.orientation)) return single(UNREADABLE_DOCUMENT_SPLIT_NOTICE);
  if (v.docId !== null && typeof v.docId !== 'string') return single(UNREADABLE_DOCUMENT_SPLIT_NOTICE);
  const orientation = v.orientation;
  if (!v.docId) return { orientation, docId: orientation === 'single' ? null : '', notice: null };
  const docId = v.docId;
  if (!available.some((d) => d.id === docId)) {
    const name = typeof v.docName === 'string' && v.docName.trim() ? v.docName : docId;
    return single(missingSplitDocumentNotice(name));
  }
  return { orientation, docId, notice: null };
}
