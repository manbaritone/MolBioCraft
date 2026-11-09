// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { parseDelimited, planMetadataImport } from '../core/metadataImport';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';

const doc = (id: string, name: string, accession = '', meta: Record<string, string | number> = {}) =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, accession, docMetadata: meta });

describe('spreadsheet parsing', () => {
  it('reads quoted CSV and TSV', () => {
    expect(parseDelimited('Name,Host,Note\r\nA,"E. coli, K-12","say ""hi"""\n').rows).toEqual([['A', 'E. coli, K-12', 'say "hi"']]);
    expect(parseDelimited('Accession\tDepth\nX1\t30\n')).toEqual({ headers: ['Accession', 'Depth'], rows: [['X1', '30']] });
    expect(() => parseDelimited('only header\n')).toThrow(/at least one data row/);
  });
});

describe('metadata import', () => {
  const docs = [doc('a', 'Sample A', 'X1', { Host: 'old' }), doc('b', 'Sample B', 'X2')];
  const sheet = parseDelimited('Name,Host,Depth\nsample a,Mouse,30\nSample B,Human,\nMissing,Rat,5\n');
  it('matches names case-insensitively, keeps existing values unless overwriting, and lists unmatched rows', () => {
    const keep = planMetadataImport(docs, sheet, { keyColumn: 'Name', matchBy: 'name', overwrite: false });
    const a = keep.updated.find((d) => d.id === 'a')!;
    expect(a.docMetadata).toEqual({ Host: 'old', Depth: 30 });
    expect(keep.unmatched).toEqual(['Missing']);
    expect(keep.matchedRows).toBe(2);
    const over = planMetadataImport(docs, sheet, { keyColumn: 'Name', matchBy: 'name', overwrite: true });
    expect(over.updated.find((d) => d.id === 'a')!.docMetadata!.Host).toBe('Mouse');
    expect(over.updated.find((d) => d.id === 'b')!.docMetadata).toEqual({ Host: 'Human' });
  });
  it('matches by accession and rejects an unknown key column', () => {
    const p = planMetadataImport(docs, parseDelimited('Acc,Lab\nX2,North\n'), { keyColumn: 'Acc', matchBy: 'accession', overwrite: false });
    expect(p.updated.map((d) => d.id)).toEqual(['b']);
    expect(() => planMetadataImport(docs, sheet, { keyColumn: 'Nope', matchBy: 'name', overwrite: false })).toThrow(/not in the spreadsheet/);
  });
});
