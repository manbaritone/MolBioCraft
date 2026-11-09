// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Advanced search and saved searches for the document table: extra search fields beyond the
 * table columns — residues on both strands,
 * annotation names/types, any metadata value — a whole-project scope, and named searches kept
 * in this browser's local storage.
 */

import type { SequenceDocument } from '../types/bio';
import type { TableFilterRule } from '../components/WorkbenchSmartTable';

export const SEARCH_FIELDS = [
  { id: '__residues__', label: 'Residues (both strands)' },
  { id: '__annotations__', label: 'Annotation name / type' },
  { id: '__metadata__', label: 'Any metadata value' },
] as const;

export const isSearchField = (colId: string) => SEARCH_FIELDS.some((f) => f.id === colId);

const COMP: Record<string, string> = { A: 'T', T: 'A', U: 'A', G: 'C', C: 'G', N: 'N', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D' };

/** Text a search field matches against. Residues: the sequence and its reverse complement. */
export function searchFieldText(d: SequenceDocument, colId: string): string {
  if (colId === '__residues__') {
    const s = d.sequence.toUpperCase();
    if (d.moleculeType === 'Protein') return s;
    const rc = [...s].reverse().map((c) => COMP[c] ?? c).join('');
    return `${s}\u0000${rc}`;
  }
  if (colId === '__annotations__') return d.features.map((f) => `${f.name} ${f.type}`).join('\u0000');
  if (colId === '__metadata__') {
    return Object.entries(d.docMetadata ?? {}).filter(([k]) => k !== 'Notes' && k !== 'Newick').map(([k, v]) => `${k}: ${String(v)}`).join('\u0000');
  }
  return '';
}

export interface SavedSearch {
  id: string;
  name: string;
  quickFilter: string;
  rules: TableFilterRule[];
  matchMode: 'all' | 'any';
  /** true = whole project, false = the selected folder. */
  wholeProject: boolean;
}

const KEY = 'mbc.savedSearches.v1';

export function loadSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedSearch[]) : [];
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === 'string') : [];
  } catch {
    return [];
  }
}

export function storeSavedSearches(list: SavedSearch[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Adds or replaces (same name, case-insensitive) a saved search. */
export function upsertSavedSearch(list: SavedSearch[], s: Omit<SavedSearch, 'id'>): SavedSearch[] {
  const existing = list.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
  const entry: SavedSearch = { ...s, id: existing?.id ?? `ss-${Date.now().toString(36)}` };
  return existing ? list.map((x) => (x.id === existing.id ? entry : x)) : [...list, entry];
}
