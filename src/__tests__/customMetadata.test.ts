// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { fieldDefinitionError, parseFieldValue, type CustomField } from '../core/customMetadata';

describe('custom metadata fields', () => {
  const existing: CustomField[] = [{ id: '1', name: 'Plate', kind: 'text' }];
  it('validates definitions', () => {
    expect(fieldDefinitionError('', 'text', [], existing)).toMatch(/name/);
    expect(fieldDefinitionError('plate', 'text', [], existing)).toMatch(/already exists/);
    expect(fieldDefinitionError('Notes', 'text', [], existing)).toMatch(/built-in/);
    expect(fieldDefinitionError('Status', 'choice', ['done'], existing)).toMatch(/two choices/);
    expect(fieldDefinitionError('Status', 'choice', ['done', 'failed'], existing)).toBeNull();
  });
  it('parses values by type', () => {
    expect(parseFieldValue({ id: 'a', name: 'Conc', kind: 'number' }, '12,5')).toEqual({ value: 12.5 });
    expect('error' in parseFieldValue({ id: 'a', name: 'Well', kind: 'integer' }, '3.5')).toBe(true);
    expect(parseFieldValue({ id: 'a', name: 'Date', kind: 'date' }, '2026-11-05')).toEqual({ value: '2026-11-05' });
    expect('error' in parseFieldValue({ id: 'a', name: 'Date', kind: 'date' }, '5/11/26')).toBe(true);
    expect(parseFieldValue({ id: 'a', name: 'Status', kind: 'choice', choices: ['done', 'failed'] }, 'done')).toEqual({ value: 'done' });
    expect('error' in parseFieldValue({ id: 'a', name: 'Status', kind: 'choice', choices: ['done'] }, 'maybe')).toBe(true);
    expect(parseFieldValue({ id: 'a', name: 'X', kind: 'text' }, '  ')).toEqual({ value: null });
  });
});
