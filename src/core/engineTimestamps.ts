// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';

/**
 * The Rust engine runs as `wasm32-unknown-unknown`, which has no clock
 * (`SystemTime::now()` panics there), so documents it creates or edits carry a
 * fixed placeholder date (2026-10-31…). Edited documents' "updated" time then
 * went backwards and date sorting was wrong. Replace the placeholder with the
 * real time when a document enters the workbench or is edited.
 */
const ENGINE_PLACEHOLDER_DATE = /^2026-10-31(?:[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?Z?)?)?$/;

export function isEnginePlaceholderTimestamp(value: string | undefined): boolean {
  return typeof value === 'string' && ENGINE_PLACEHOLDER_DATE.test(value.trim());
}

/**
 * Stamp placeholder timestamps with `nowIso`. With `previous`, only history
 * entries added since that version are restamped (older history is kept).
 */
export function stampEngineTimestamps(
  doc: SequenceDocument,
  nowIso: string,
  previous?: Pick<SequenceDocument, 'history' | 'createdAt'>
): SequenceDocument {
  const knownHistory = new Set((previous?.history ?? []).map((h) => h.id));
  const historyStamp = nowIso.slice(0, 16).replace('T', ' ');
  let changed = false;
  const history = doc.history.map((h) => {
    if (!knownHistory.has(h.id) && isEnginePlaceholderTimestamp(h.timestamp)) {
      changed = true;
      return { ...h, timestamp: historyStamp };
    }
    return h;
  });
  // An edit keeps the document's original creation time; a new document gets now.
  const createdAt = isEnginePlaceholderTimestamp(doc.createdAt)
    ? previous?.createdAt || nowIso
    : doc.createdAt;
  const updatedAt = isEnginePlaceholderTimestamp(doc.updatedAt) ? nowIso : doc.updatedAt;
  if (!changed && createdAt === doc.createdAt && updatedAt === doc.updatedAt) return doc;
  return { ...doc, createdAt, updatedAt, history };
}
