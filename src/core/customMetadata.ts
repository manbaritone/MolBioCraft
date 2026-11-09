// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Custom metadata types: user-defined fields with a
 * value type, filled in per document from the Info panel. Values are stored in the document's
 * metadata under the field name, so they also appear as table columns, in searches and in
 * exports. Definitions live in this browser's local storage.
 */

export type CustomFieldKind = 'text' | 'number' | 'integer' | 'date' | 'choice' | 'boolean';

export interface CustomField {
  id: string;
  name: string;
  kind: CustomFieldKind;
  /** For 'choice'. */
  choices?: string[];
}

export const CUSTOM_FIELD_KINDS: Record<CustomFieldKind, string> = {
  text: 'Text', number: 'Decimal number', integer: 'Whole number', date: 'Date', choice: 'Choice list', boolean: 'Yes / No',
};

const KEY = 'molbiocraft.customMetadataFields.v1';
export const CUSTOM_FIELDS_EVENT = 'molbiocraft:custom-metadata-fields';

const RESERVED = new Set(['notes', 'newick', 'document type', 'created', 'modified', 'pdbtext', 'tree display', 'name', 'description', 'accession', 'folder']);

export function loadCustomFields(): CustomField[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as CustomField[]) : [];
    return Array.isArray(list) ? list.filter((f) => f && typeof f.name === 'string' && f.kind in CUSTOM_FIELD_KINDS) : [];
  } catch {
    return [];
  }
}

export function storeCustomFields(list: CustomField[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(CUSTOM_FIELDS_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Error message for a new field definition, or null. */
export function fieldDefinitionError(name: string, kind: CustomFieldKind, choices: string[], existing: CustomField[]): string | null {
  const n = name.trim();
  if (!n) return 'Give the field a name.';
  if (n.length > 40) return 'Keep field names to 40 characters.';
  if (RESERVED.has(n.toLowerCase())) return `"${n}" is a built-in field name.`;
  if (existing.some((f) => f.name.toLowerCase() === n.toLowerCase())) return `A field named "${n}" already exists.`;
  if (kind === 'choice' && choices.filter((c) => c.trim()).length < 2) return 'A choice list needs at least two choices.';
  return null;
}

/** Parses an entered value for a field: { value } (null = clear) or { error }. */
export function parseFieldValue(f: CustomField, raw: string): { value: string | number | null } | { error: string } {
  const s = raw.trim();
  if (!s) return { value: null };
  switch (f.kind) {
    case 'number': {
      const v = Number(s.replace(',', '.'));
      return Number.isFinite(v) ? { value: v } : { error: `${f.name}: enter a number.` };
    }
    case 'integer': {
      const v = Number(s);
      return Number.isInteger(v) ? { value: v } : { error: `${f.name}: enter a whole number.` };
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? { value: s } : { error: `${f.name}: enter a date as YYYY-MM-DD.` };
    case 'choice':
      return (f.choices ?? []).includes(s) ? { value: s } : { error: `${f.name}: choose one of the listed values.` };
    case 'boolean':
      return s === 'Yes' || s === 'No' ? { value: s } : { error: `${f.name}: choose Yes or No.` };
    default:
      return { value: s };
  }
}
