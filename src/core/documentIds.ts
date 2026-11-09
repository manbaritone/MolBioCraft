// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';

/**
 * Return `docs` with ids that collide with `takenIds` (or with each other)
 * rewritten to `<id>-2`, `<id>-3`, … . Documents whose id is already unique
 * are returned unchanged (same object), so callers keep referential equality.
 * `takenIds` is not mutated.
 */
export function assignUniqueDocumentIds(
  docs: SequenceDocument[],
  takenIds: Iterable<string>
): SequenceDocument[] {
  const taken = new Set(takenIds);
  return docs.map((doc) => {
    const base = doc.id || 'doc';
    if (doc.id && !taken.has(doc.id)) {
      taken.add(doc.id);
      return doc;
    }
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    const id = `${base}-${n}`;
    taken.add(id);
    return { ...doc, id };
  });
}
