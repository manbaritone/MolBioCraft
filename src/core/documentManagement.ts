// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Find Duplicates and Batch Rename (Edit menu). */

import { reverseComplement } from './bioEngine';
import type { SequenceDocument } from '../types/bio';

export type DuplicateKey = 'sequence' | 'name' | 'accession';

const keyOf = (d: SequenceDocument, by: DuplicateKey, orientationFree = false): string => {
  if (by === 'sequence') {
    const s = d.sequence.toUpperCase().replace(/[^A-Z]/g, '');
    if (!orientationFree || !s || d.moleculeType === 'Protein') return s;
    // Same molecule read from either strand: key on the smaller of the two orientations.
    const rc = reverseComplement(s, d.moleculeType === 'RNA');
    return rc < s ? rc : s;
  }
  if (by === 'name') return d.name.trim().toLowerCase();
  return (d.accession ?? '').trim().toUpperCase();
};

const timeOf = (d: SequenceDocument) => Date.parse(d.updatedAt || d.createdAt || '') || 0;

export interface DuplicateGroup {
  key: string;
  /** The copy that is kept. */
  keep: SequenceDocument;
  /** The other copies (the ones selected for removal). */
  duplicates: SequenceDocument[];
}

/**
 * Groups documents that share a sequence, name or accession. Empty keys (no sequence,
 * no accession) never match. `keep` chooses which copy stays unselected.
 */
export function findDuplicateGroups(
  docs: readonly SequenceDocument[],
  by: DuplicateKey,
  keep: 'newest' | 'oldest',
  orientationFree = false
): DuplicateGroup[] {
  const map = new Map<string, SequenceDocument[]>();
  for (const d of docs) {
    const k = keyOf(d, by, orientationFree);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), d]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, list] of map) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (keep === 'newest' ? timeOf(b) - timeOf(a) : timeOf(a) - timeOf(b)));
    groups.push({ key, keep: sorted[0], duplicates: sorted.slice(1) });
  }
  return groups.sort((a, b) => b.duplicates.length - a.duplicates.length || a.keep.name.localeCompare(b.keep.name));
}

export type RenameField = 'name' | 'description';

export interface BatchRenameOptions {
  field: RenameField;
  /** Template with {name} {accession} {description} {organism} {length} {n} {n:3}. */
  template: string;
  prefix: string;
  suffix: string;
  /** Optional regular expression applied after the template (empty = off). */
  find: string;
  replace: string;
  counterStart: number;
}

export function organismOf(d: SequenceDocument): string {
  const meta = d.docMetadata ?? {};
  const fromMeta = meta.Organism ?? meta.organism ?? meta['Source organism'];
  if (fromMeta) return String(fromMeta);
  const src = d.features.find((f) => f.type === 'source');
  return src?.qualifiers?.organism ?? '';
}

/** Validates a regular expression; returns an error message or null. */
export function regexError(pattern: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern, 'g');
    return null;
  } catch (e) {
    return `Invalid regular expression: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function renamedValue(d: SequenceDocument, index: number, o: BatchRenameOptions): string {
  const n = o.counterStart + index;
  let out = o.template.replace(/\{(\w+)(?::(\d+))?\}/g, (whole, token: string, pad?: string) => {
    switch (token.toLowerCase()) {
      case 'name': return d.name;
      case 'accession': return d.accession ?? '';
      case 'description': return d.description ?? '';
      case 'organism': return organismOf(d);
      case 'length': return String(d.sequence.length);
      case 'n': return pad ? String(n).padStart(Number(pad), '0') : String(n);
      default: return whole;
    }
  });
  if (o.find && !regexError(o.find)) out = out.replace(new RegExp(o.find, 'g'), o.replace);
  return `${o.prefix}${out}${o.suffix}`.trim();
}
