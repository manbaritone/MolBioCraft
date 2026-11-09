// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { parsePrimerSpreadsheet } from '../core/primerImport';
import { searchFieldText, upsertSavedSearch } from '../core/savedSearches';
import { evaluateTableRowFilters } from '../components/WorkbenchSmartTable';
import { runAnnotateByBlast, runImportPrimers } from '../core/operationRunners';
import type { SequenceDocument } from '../types/bio';

const puc = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;

describe('primer spreadsheet import', () => {
  it('reads a CSV with a header, quotes, modifications and duplicate names', () => {
    const csv = 'Primer name,Sequence (5\'-3\'),Notes\nM13F,GTAAAACGACGGCCAGT,"universal, forward"\nM13F,5\'-CAGGAAACAGCTATGAC-3\',dup\nbad,HELLO WORLD,x\nshort,ACG,\n';
    const r = parsePrimerSpreadsheet(csv);
    expect(r.rows.map((x) => x.name)).toEqual(['M13F', 'M13F_2']);
    expect(r.rows[0].description).toBe('universal, forward');
    expect(r.rows[1].sequence).toBe('CAGGAAACAGCTATGAC');
    expect(r.skipped.map((s) => s.line)).toEqual([4, 5]);
  });
  it('reads a header-less TSV and strips /5Phos/ style modifications', () => {
    const r = parsePrimerSpreadsheet('p1\t/5Phos/ACGTACGTACGT\np2\tGGGCCCAAATTT\n');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].sequence).toBe('ACGTACGTACGT');
  });
  it('runner creates primer documents with Tm', () => {
    const r = runImportPrimers('name,seq\nF1,ACGTGACTGACTGATCGATG\n', {});
    expect(r.created[0].documentKind).toBe('primer');
    expect(Number(r.created[0].docMetadata?.['Tm (°C)'])).toBeGreaterThan(40);
  });
});

describe('advanced search fields', () => {
  it('residues match either strand; annotations and metadata are searchable', () => {
    const doc = { ...puc, docMetadata: { Organism: 'Escherichia coli' } } as SequenceDocument;
    const motif = puc.sequence.slice(100, 120).toUpperCase();
    const rcMotif = [...motif].reverse().map((c) => ({ A: 'T', T: 'A', G: 'C', C: 'G' } as Record<string, string>)[c]).join('');
    const get = (col: string) => searchFieldText(doc, col);
    const rule = (colId: string, value: string) => [{ id: 'r', colId, operator: 'contains' as const, value }];
    expect(evaluateTableRowFilters(get, [], '', rule('__residues__', motif), 'all')).toBe(true);
    expect(evaluateTableRowFilters(get, [], '', rule('__residues__', rcMotif), 'all')).toBe(true);
    expect(evaluateTableRowFilters(get, [], '', rule('__residues__', 'ACGTTTTTTTTTTTTTTTTTTTACG'), 'all')).toBe(false);
    expect(evaluateTableRowFilters(get, [], '', rule('__annotations__', puc.features.find((f) => f.type !== 'source')!.name), 'all')).toBe(true);
    expect(evaluateTableRowFilters(get, [], '', rule('__metadata__', 'escherichia'), 'all')).toBe(true);
  });
  it('saving a search with an existing name replaces it', () => {
    const base = { quickFilter: '', rules: [], matchMode: 'all' as const, wholeProject: true };
    let list = upsertSavedSearch([], { ...base, name: 'Kan plasmids' });
    list = upsertSavedSearch(list, { ...base, name: 'kan PLASMIDS', quickFilter: 'kan' });
    expect(list).toHaveLength(1);
    expect(list[0].quickFilter).toBe('kan');
  });
});

describe('annotate by BLAST', () => {
  it('finds pUC19 as the top hit for an unannotated copy and transfers its features', () => {
    const target: SequenceDocument = { ...puc, id: 'unk', name: 'unknown', features: [] };
    const db = SAMPLE_LIBRARY.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0 && d.sequence.length < 20000).slice(0, 40);
    if (!db.some((d) => d.id === puc.id)) db.push(puc);
    const r = runAnnotateByBlast([target], db, { maxHits: 3, minHitIdentity: 90, minIdentity: 95 });
    expect(r.updated).toHaveLength(1);
    expect(r.updated[0].features.length).toBeGreaterThan(3);
    expect(r.updated[0].history.at(-1)!.operation).toBe('Annotate by BLAST');
    expect(r.summary).toMatch(/pUC19/);
  });
});
