// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { findDuplicateGroups, regexError, renamedValue, type BatchRenameOptions } from '../core/documentManagement';
import { BatchRenameDialog, FindDuplicatesDialog } from '../components/DocumentManagementDialogs';
import { MapToReferenceDialog } from '../components/CloningAssemblyOperationDialogs';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

const d = (id: string, name: string, sequence: string, updatedAt: string, accession = ''): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, accession, updatedAt, moleculeType: 'DNA' });
const docs = [
  d('a', 'Alpha', 'acgtACGT', '2026-01-01T00:00:00Z', 'X1'),
  d('b', 'alpha ', 'ACGT-ACGT', '2026-03-01T00:00:00Z', 'X2'),
  d('c', 'Gamma', 'ACGTACGT', '2026-02-01T00:00:00Z', 'X1'),
  d('e', 'Delta', 'TTTT', '2026-02-01T00:00:00Z'),
];
const noop = () => undefined;

describe('find duplicates', () => {
  it('matches residues ignoring case and gaps, keeping the newest copy', () => {
    const [g] = findDuplicateGroups(docs, 'sequence', 'newest');
    expect(g.keep.id).toBe('b');
    expect(g.duplicates.map((x) => x.id).sort()).toEqual(['a', 'c']);
    expect(findDuplicateGroups(docs, 'sequence', 'oldest')[0].keep.id).toBe('a');
  });
  it('matches names (trimmed, any case) and accessions, ignoring empty keys', () => {
    expect(findDuplicateGroups(docs, 'name', 'newest')[0].duplicates.map((x) => x.id)).toEqual(['a']);
    expect(findDuplicateGroups(docs, 'accession', 'newest')[0].duplicates.map((x) => x.id)).toEqual(['a']);
    expect(findDuplicateGroups([d('p', 'p', '', ''), d('q', 'q', '', '')], 'sequence', 'newest')).toEqual([]);
  });
  it('the window lists the groups found', () => {
    const html = renderToStaticMarkup(<FindDuplicatesDialog selected={[]} folderDocs={docs} folderLabel="Test" onSelect={noop} onClose={noop} />);
    expect(html).toContain('1 groups, 2 duplicate copies');
  });
});

describe('batch rename', () => {
  const o = (p: Partial<BatchRenameOptions>): BatchRenameOptions =>
    ({ field: 'name', template: '{name}', prefix: '', suffix: '', find: '', replace: '', counterStart: 1, ...p });
  it('fills templates, counters, prefix/suffix and regex replacements', () => {
    expect(renamedValue(docs[0], 0, o({ template: '{accession}_{name}_{n:3}' }))).toBe('X1_Alpha_001');
    expect(renamedValue(docs[3], 4, o({ prefix: 'S-', suffix: '-v2', counterStart: 10 }))).toBe('S-Delta-v2');
    expect(renamedValue(docs[2], 0, o({ find: '^(G)a', replace: '$1A' }))).toBe('GAmma');
    expect(renamedValue(docs[0], 0, o({ template: '{length} bp' }))).toBe('8 bp');
  });
  it('reports invalid regular expressions instead of throwing', () => {
    expect(regexError('(')).toMatch(/Invalid regular expression/);
    expect(regexError('a+')).toBeNull();
    expect(renamedValue(docs[0], 0, o({ find: '(' }))).toBe('Alpha');
  });
  it('previews the change and blocks a no-op', () => {
    const html = renderToStaticMarkup(<BatchRenameDialog docs={[docs[0], docs[2]]} onApply={noop} onClose={noop} />);
    expect(html).toContain('These settings change nothing.');
    expect(html).toContain('→ Alpha');
  });
});

describe('map to reference window', () => {
  it('defaults the reference to the longest selected sequence and needs reads', () => {
    const ref = d('ref', 'Ref', 'ACGT'.repeat(300), '');
    const r = d('r', 'Read', 'ACGT'.repeat(50), '');
    const html = renderToStaticMarkup(<MapToReferenceDialog inputs={[r, ref]} candidates={[]} sourceLabel="x" onCreate={noop} onClose={noop} />);
    expect(html).toMatch(/<option value="ref" selected="">Ref/);
    expect(html).toContain('1 read will be mapped');
    const none = renderToStaticMarkup(<MapToReferenceDialog inputs={[ref]} candidates={[]} sourceLabel="x" onCreate={noop} onClose={noop} />);
    expect(none).toContain('Select the reads to map');
  });
});
