// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { normalizePrimerSequence, parsePrimerSpreadsheet, readPrimerSpreadsheet, type PrimerColumnMapping } from '../core/primerImport';
import { ImportPrimersDialog } from '../components/SequenceAnalysisToolDialogs';
import { searchFieldText, upsertSavedSearch } from '../core/savedSearches';
import { evaluateTableRowFilters } from '../components/WorkbenchSmartTable';
import { runAnnotateByBlast, runImportPrimers } from '../core/operationRunners';
import type { SequenceDocument } from '../types/bio';

/**
 * The Import Primers dialog is rendered statically (the repo carries no DOM library, so nothing can
 * be typed into it). These probes hand its own state the text a user would have pasted and the
 * columns they would have chosen; everything from there to the markup is the dialog's own code.
 */
const probe = vi.hoisted(() => ({ texts: [] as string[], mapping: null as null | Partial<Record<string, number>> }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const { NO_COLUMN_MAPPING } = await import('../core/primerImport');
  const useState = ((initial: unknown) => actual.useState(() => {
    const v = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    if (v === '' && probe.texts.length) return probe.texts.shift();
    if (v === NO_COLUMN_MAPPING && probe.mapping) return probe.mapping;
    return v;
  })) as typeof actual.useState;
  return { ...actual, default: { ...actual, useState }, useState };
});

afterEach(() => {
  probe.texts = [];
  probe.mapping = null;
});

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

// ─── US-01M7DQHR: the faithful reading of a primer sheet, and what Import Primers still makes ───

const decode = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});

interface PreviewRow { row: number; cells: Record<string, string> }

/** The Import Primers dialog as it renders with `text` pasted (and, optionally, columns chosen). */
function renderImportDialog(text: string, mapping?: Partial<PrimerColumnMapping>) {
  probe.texts = [text];
  probe.mapping = mapping ?? null;
  const html = renderToStaticMarkup(React.createElement(ImportPrimersDialog, { onCreate: () => undefined, onClose: () => undefined }));
  expect(probe.texts, 'the dialog read the pasted text').toEqual([]);
  const rows: PreviewRow[] = [...html.matchAll(/<tr data-ip-row="(\d+)">([\s\S]*?)<\/tr>/g)].map((m) => ({
    row: Number(m[1]),
    cells: Object.fromEntries([...m[2].matchAll(/<td data-ip-col="(\w+)"[^>]*>([\s\S]*?)<\/td>/g)].map((c) => [c[1], decode(c[2])])),
  }));
  const problem = /<div[^>]*data-ip-problem=""[^>]*>([\s\S]*?)<\/div>/.exec(html);
  const selected = (key: string) => {
    const sel = new RegExp(`<select id="opdlg-ip-map-${key}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
    const opt = sel && /<option[^>]*selected=""[^>]*>([\s\S]*?)<\/option>/.exec(sel[1]);
    return opt ? decode(opt[1]) : null;
  };
  return { html, rows, problem: problem ? decode(problem[1]) : null, selected };
}

const QUOTED_CSV = '\uFEFFName,Sequence,Description,Labels\r\nM13F,GTAAAACGACGGCCAGT,"universal, ""forward""\r\nsecond line","pcr;seq, sanger"\r\nM13R,CAGGAAACAGCTATGAC,reverse,\r\n';

describe('US-01M7DQHR primer sheet reading', () => {
  // Wrong readings these fail on: one record per physical line (the old reader made a third, broken
  // record of the description's second line), a doubled quote read as a closing one, labels split on
  // ';' only, and a mapping the dialog or the documents path ignores. (A byte-order mark left in would
  // also be trimmed off the first cell, so the test shows it ignored without isolating the strip.)
  it('US-01M7DQHR AC1 quoted CSV: embedded separators, doubled quotes, a description spanning lines, a BOM, and labels', () => {
    const r = readPrimerSpreadsheet(QUOTED_CSV);
    expect(r.problem).toBeNull();
    expect(r.separator).toBe(',');
    expect(r.header).toEqual(['Name', 'Sequence', 'Description', 'Labels']);
    expect(r.mapping).toEqual({ name: 0, sequence: 1, description: 2, labels: 3 });
    expect(r.rows.map((x) => [x.row, x.name, x.sequence, x.description, x.labels, x.errors])).toEqual([
      [2, 'M13F', 'GTAAAACGACGGCCAGT', 'universal, "forward"\nsecond line', ['pcr', 'seq', 'sanger'], []],
      [4, 'M13R', 'CAGGAAACAGCTATGAC', 'reverse', [], []],
    ]);
    const dialog = renderImportDialog(QUOTED_CSV);
    expect(dialog.rows.map((x) => [x.row, x.cells.name, x.cells.labels, x.cells.import])).toEqual([
      [2, 'M13F', 'pcr, seq, sanger', 'as M13F'],
      [4, 'M13R', '', 'as M13R'],
    ]);
    expect(dialog.selected('name')).toBe('Name (column 1)');
    expect(dialog.selected('labels')).toBe('Labels (column 4)');
  });

  it('US-01M7DQHR AC1 TSV and semicolon-separated sheets read quoted cells the same way', () => {
    const tsv = 'Name\tSequence\tDescription\tLabels\nM13F\tGTAAAACGACGGCCAGT\t"universal\t""forward""\nsecond line"\tpcr,seq\n';
    const semi = 'Name;Sequence;Description;Labels\rM13F;GTAAAACGACGGCCAGT;"universal; ""forward""\rsecond line";"pcr;seq"\r';
    const tr = readPrimerSpreadsheet(tsv);
    const sr = readPrimerSpreadsheet(semi);
    expect(tr.separator).toBe('\t');
    expect(sr.separator).toBe(';');
    expect(tr.rows.map((x) => [x.row, x.name, x.description, x.labels])).toEqual([[2, 'M13F', 'universal\t"forward"\nsecond line', ['pcr', 'seq']]]);
    expect(sr.rows.map((x) => [x.row, x.name, x.description, x.labels])).toEqual([[2, 'M13F', 'universal; "forward"\nsecond line', ['pcr', 'seq']]]);
    for (const text of [tsv, semi]) {
      expect(renderImportDialog(text).rows.map((x) => [x.row, x.cells.name, x.cells.labels, x.cells.import])).toEqual([[2, 'M13F', 'pcr, seq', 'as M13F']]);
    }
  });

  it('US-01M7DQHR AC1 the user maps the name, sequence, description and label columns', () => {
    const text = 'ACGTACGTACGTAA,X1,first note,lab1;lab2\nGGGGCCCCAAAATTTT,X2,second note,lab3\n';
    const mapping = { name: 1, sequence: 0, description: 2, labels: 3 };
    // Unmapped, the first two columns are name and sequence: the sequence column holds names.
    expect(readPrimerSpreadsheet(text).rows[0].name).toBe('ACGTACGTACGTAA');
    const r = readPrimerSpreadsheet(text, mapping);
    expect(r.rows.map((x) => [x.name, x.sequence, x.description, x.labels])).toEqual([
      ['X1', 'ACGTACGTACGTAA', 'first note', ['lab1', 'lab2']],
      ['X2', 'GGGGCCCCAAAATTTT', 'second note', ['lab3']],
    ]);
    const dialog = renderImportDialog(text, mapping);
    expect(dialog.rows.map((x) => [x.cells.name, x.cells.normalized, x.cells.labels, x.cells.import])).toEqual([
      ['X1', 'ACGTACGTACGTAA', 'lab1, lab2', 'as X1'],
      ['X2', 'GGGGCCCCAAAATTTT', 'lab3', 'as X2'],
    ]);
    expect([dialog.selected('name'), dialog.selected('sequence'), dialog.selected('description'), dialog.selected('labels')]).toEqual(['column 2', 'column 1', 'column 3', 'column 4']);
    // The documents follow the same mapping.
    const made = runImportPrimers(text, {}, mapping);
    expect(made.created.map((d) => [d.name, d.sequence, d.description])).toEqual([['X1', 'ACGTACGTACGTAA', 'first note'], ['X2', 'GGGGCCCCAAAATTTT', 'second note']]);
  });

  // Wrong readings: a quote never closed swallowing the rest of the sheet into one cell and importing
  // what is left, a long row cut to the header's width, and a workbook read as rows of garbage.
  it('US-01M7DQHR AC1 an unterminated quote, a row wider than the header and binary or .xlsx input are rejected with row and field', () => {
    const open = 'name,sequence,notes\nM13F,GTAAAACGACGGCCAGT,"never closed\nM13R,CAGGAAACAGCTATGAC,x\n';
    expect(readPrimerSpreadsheet(open).problem).toEqual({ row: 2, field: 3, message: 'a quote opened here is never closed' });
    expect(() => runImportPrimers(open, {})).toThrow('Cannot read the spreadsheet: row 2, field 3: a quote opened here is never closed.');
    expect(renderImportDialog(open).problem).toBe('Cannot read the spreadsheet: row 2, field 3: a quote opened here is never closed.');

    const wide = 'name,sequence\nM13F,GTAAAACGACGGCCAGT,extra\nM13R,CAGGAAACAGCTATGAC,\n';
    const wr = readPrimerSpreadsheet(wide);
    expect(wr.rows[0].errors).toEqual([{ field: 'row', column: 3, message: 'the row has 3 cells but the header has 2' }]);
    expect(wr.rows[1].errors, 'an empty trailing cell is not an extra one').toEqual([]);
    expect(parsePrimerSpreadsheet(wide).skipped).toEqual([{ line: 2, reason: 'the row has 3 cells but the header has 2' }]);
    expect(runImportPrimers(wide, {}).created.map((d) => d.name)).toEqual(['M13R']);
    expect(renderImportDialog(wide).rows.map((x) => [x.row, x.cells.import])).toEqual([
      [2, 'column 3: the row has 3 cells but the header has 2'],
      [3, 'as M13R'],
    ]);

    const xlsx = 'PK\u0003\u0004\u0014\u0000\u0006\u0000[Content_Types].xml';
    expect(readPrimerSpreadsheet(xlsx).problem).toMatchObject({ row: 1, field: 1, message: expect.stringContaining('.xlsx') });
    expect(() => runImportPrimers(xlsx, {})).toThrow(/^Cannot read the spreadsheet: row 1, field 1: .*\.xlsx/);
    const binary = 'name,sequence\nM13F,GTAA\u0000CGGCCAGT\n';
    expect(readPrimerSpreadsheet(binary).problem).toMatchObject({ row: 2, field: 2, message: expect.stringContaining('U+0000') });
    expect(readPrimerSpreadsheet(binary).rows).toEqual([]);
    expect(renderImportDialog(binary).problem).toMatch(/^Cannot read the spreadsheet: row 2, field 2: character U\+0000/);
  });

  // Wrong readings: U written as T in the faithful row (an RNA record turned DNA), a T-and-U sequence
  // quietly made all-T, the original input replaced by the normalized one in the preview, a terminal
  // modification dropped, and an internal one deleted with its base or placed one base off.
  it('US-01M7DQHR AC2 the preview shows original and normalized sequences; RNA keeps U, DNA keeps T, T with U is refused', () => {
    const text = "name,sequence\nF1,5'- acgt ACGT acgt -3'\nR1,acgu ACGU acgu\nmix,ACGTUACGTU\n";
    const r = readPrimerSpreadsheet(text);
    expect(r.rows.map((x) => [x.original, x.sequence, x.molecule])).toEqual([
      ["5'- acgt ACGT acgt -3'", 'ACGTACGTACGT', 'DNA'],
      ['acgu ACGU acgu', 'ACGUACGUACGU', 'RNA'],
      ['ACGTUACGTU', 'ACGTUACGTU', 'DNA'],
    ]);
    expect(r.rows[2].errors).toEqual([{ field: 'sequence', column: 2, message: 'the sequence holds both T and U: a DNA oligo has T and an RNA one U' }]);
    const dialog = renderImportDialog(text);
    expect(dialog.rows.map((x) => [x.row, x.cells.original, x.cells.normalized, x.cells.molecule, x.cells.import])).toEqual([
      [2, "5'- acgt ACGT acgt -3'", 'ACGTACGTACGT', 'DNA', 'as F1'],
      [3, 'acgu ACGU acgu', 'ACGUACGUACGU', 'RNA', 'as R1'],
      [4, 'ACGTUACGTU', 'ACGTUACGTU', 'DNA', 'sequence (column 2): the sequence holds both T and U: a DNA oligo has T and an RNA one U'],
    ]);
  });

  it('US-01M7DQHR AC2 terminal modifications are kept with no thermodynamic calculation; an internal one keeps its base and position', () => {
    const text = 'name,sequence\nphos,/5Phos/GTAAAACGACGGCCAGT/3Phos/\nbio,ACGTAC/iBiodT/ACGTACG\nspacer,ACGTAC/iSp18/ACGTAC\n';
    const r = readPrimerSpreadsheet(text);
    expect(r.rows.map((x) => [x.sequence, x.modifications])).toEqual([
      ['GTAAAACGACGGCCAGT', [
        { text: '/5Phos/', placement: "5'", position: 1, base: null, noThermodynamics: true },
        { text: '/3Phos/', placement: "3'", position: 17, base: null, noThermodynamics: true },
      ]],
      ['ACGTACTACGTACG', [{ text: '/iBiodT/', placement: 'internal', position: 7, base: 'T', noThermodynamics: true }]],
      ['ACGTACACGTAC', [{ text: '/iSp18/', placement: 'internal', position: 6, base: null, noThermodynamics: true }]],
    ]);
    expect(r.rows[1].sequence[6], 'the base /iBiodT/ stands for, at its position').toBe('T');
    const dialog = renderImportDialog(text);
    expect(dialog.rows.map((x) => [x.cells.original, x.cells.normalized, x.cells.modifications])).toEqual([
      ['/5Phos/GTAAAACGACGGCCAGT/3Phos/', 'GTAAAACGACGGCCAGT', "/5Phos/ 5' end, no Tm calculation; /3Phos/ 3' end, no Tm calculation"],
      ['ACGTAC/iBiodT/ACGTACG', 'ACGTACTACGTACG', '/iBiodT/ at 7 (T), no Tm calculation'],
      ['ACGTAC/iSp18/ACGTAC', 'ACGTACACGTAC', '/iSp18/ at 6, no Tm calculation'],
    ]);
  });

  it('US-01M7DQHR AC2 a long sheet previews its first 200 rows and still counts every one', () => {
    const text = `name,sequence\n${Array.from({ length: 205 }, (_x, k) => `P${k + 1},ACGTACGTAC${'ACGT'[k % 4]}GT`).join('\n')}\n`;
    const dialog = renderImportDialog(text);
    expect(dialog.rows).toHaveLength(200);
    expect(dialog.rows[199].cells.name).toBe('P200');
    expect(decode(dialog.html)).toContain('The first 200 of 205 rows are shown; the count above covers every row.');
    expect(decode(dialog.html)).toContain('205 primers (P1, P2, P3, …)');
  });

  // Wrong readings: the cell uppercased before the prefixes are read (rArUrG becomes the IUPAC codes
  // RARURG), an RNA oligo written as DNA, IUPAC codes refused, and an invalid character reported
  // without the row, the field or the character itself.
  it('US-01M7DQHR AC3 IDT per-base prefixes are read as modifications, never as IUPAC R or M; an RNA oligo stays RNA', () => {
    const rna = normalizePrimerSequence('rArUrGrCrArUrGrC');
    expect(rna.error).toBeNull();
    expect([rna.sequence, rna.molecule]).toEqual(['AUGCAUGC', 'RNA']);
    expect(rna.modifications.map((m) => [m.text, m.position, m.base])).toEqual([['rA', 1, 'A'], ['rU', 2, 'U'], ['rG', 3, 'G'], ['rC', 4, 'C'], ['rA', 5, 'A'], ['rU', 6, 'U'], ['rG', 7, 'G'], ['rC', 8, 'C']]);
    // An RNA oligo with no U is still RNA when every base is written as an RNA base.
    const noU = normalizePrimerSequence('rArCrGrArCrG');
    expect([noU.sequence, noU.molecule, noU.error]).toEqual(['ACGACG', 'RNA', null]);
    const ome = normalizePrimerSequence('mAmCmGmU');
    expect([ome.sequence, ome.molecule, ome.modifications.map((m) => m.text)]).toEqual(['ACGU', 'RNA', ['mA', 'mC', 'mG', 'mU']]);
    const lna = normalizePrimerSequence('+A+CGT*A*CGTACG');
    expect([lna.sequence, lna.molecule, lna.error]).toEqual(['ACGTACGTACG', 'DNA', null]);
    expect(lna.modifications.map((m) => [m.text, m.position, m.base])).toEqual([['+A', 1, 'A'], ['+C', 2, 'C'], ['*', 4, null], ['*', 5, null]]);
    // A prefix that cannot be read is refused, never guessed.
    expect(normalizePrimerSequence('ACGTACGTAC*').error).toMatchObject({ character: '*' });
    expect(normalizePrimerSequence('ACG+-TACGT').error).toMatchObject({ character: '+' });

    const text = 'name,sequence\nsiRNA,rArUrGrCrArUrGrC\nchimera,ACGTmAmCGTACG\nlna,+A+CGT*A*CGTACG\n';
    const dialog = renderImportDialog(text);
    expect(dialog.rows.map((x) => [x.cells.original, x.cells.normalized, x.cells.molecule])).toEqual([
      ['rArUrGrCrArUrGrC', 'AUGCAUGC', 'RNA'],
      ['ACGTmAmCGTACG', 'ACGTACGTACG', 'DNA'],
      ['+A+CGT*A*CGTACG', 'ACGTACGTACG', 'DNA'],
    ]);
    expect(dialog.html).not.toContain('RARURG');
    // The documents path writes the RNA as DNA letters, as it always has, but never as IUPAC codes.
    expect(runImportPrimers(text, {}).created.map((d) => d.sequence)).toEqual(['ATGCATGC', 'ACGTACGTACG', 'ACGTACGTACG']);
  });

  it('US-01M7DQHR AC3 IUPAC ambiguity codes are accepted and an invalid character is reported with row, field and character', () => {
    for (const seq of ['ACGTRYSWKMBDHVN', 'acgtryswkmbdhvn']) {
      const n = normalizePrimerSequence(seq);
      expect([n.sequence, n.molecule, n.error]).toEqual(['ACGTRYSWKMBDHVN', 'DNA', null]);
    }
    const text = 'Primer,Oligo sequence\nok,ACGTRYACGTAC\nbad,ACGTXACGT\n';
    const r = readPrimerSpreadsheet(text);
    expect(r.rows[1].errors).toEqual([{ field: 'sequence', column: 2, message: "'X' at position 5 is not a nucleotide or IUPAC code", character: 'X' }]);
    const dialog = renderImportDialog(text);
    expect(dialog.rows.map((x) => [x.row, x.cells.import])).toEqual([
      [2, 'as ok'],
      [3, "Oligo sequence (column 2): 'X' at position 5 is not a nucleotide or IUPAC code"],
    ]);
    expect(() => runImportPrimers('name,sequence\nbad,ACGTXACGT\n', {})).toThrow("No primers imported: line 2 not a nucleotide sequence: 'X' at position 5 is not a nucleotide or IUPAC code.");
  });

  /**
   * What Import Primers made at 77728aa, captured by running that commit's runImportPrimers on each
   * sheet: [name, sequence, description, Tm (°C), GC %]. Every row here is on one line, and every
   * row the old reader accepted is read the same way now, so the documents must not change: M13F_2 renaming, the A / A / A_2 quirk,
   * Primer_<n> for a blank name, U written as T, slash modifications removed (with the base
   * /iBiodT/ stands for), 5'-/-3' marks, spaces and hyphens removed, and the Tm or its reason.
   */
  const BEFORE: Record<string, { text: string; summary: string; docs: [string, string, string, number | string, number][] }> = {
    existingCsv: { text: 'Primer name,Sequence (5\'-3\'),Notes\nM13F,GTAAAACGACGGCCAGT,"universal, forward"\nM13F,5\'-CAGGAAACAGCTATGAC-3\',dup\nbad,HELLO WORLD,x\nshort,ACG,\n', summary: 'Imported 2 primers (2 rows skipped)', docs: [
      ['M13F', 'GTAAAACGACGGCCAGT', 'universal, forward', 58.2, 52.9],
      ['M13F_2', 'CAGGAAACAGCTATGAC', 'dup', 52.6, 47.1],
    ] },
    existingTsv: { text: 'p1\t/5Phos/ACGTACGTACGT\np2\tGGGCCCAAATTT\n', summary: 'Imported 2 primers', docs: [
      ['p1', 'ACGTACGTACGT', 'Imported primer (12 nt)', 45.6, 50],
      ['p2', 'GGGCCCAAATTT', 'Imported primer (12 nt)', 43.1, 50],
    ] },
    existingRunner: { text: 'name,seq\nF1,ACGTGACTGACTGATCGATG\n', summary: 'Imported 1 primer', docs: [
      ['F1', 'ACGTGACTGACTGATCGATG', 'Imported primer (20 nt)', 60.6, 50],
    ] },
    existingTmNoAnswer: { text: 'name\tsequence\nwithN\tACGTACGTNACGTACGTACG\nplain\tACGTACGTACGTACGTACG\nwithW\tacgtacgtwacgtacgtacg\n', summary: 'Imported 3 primers', docs: [
      ['withN', 'ACGTACGTNACGTACGTACG', 'Imported primer (20 nt)', 'Tm n/a: the span holds 1 N or other ambiguity base; Tm is computed on A/C/G/T only, as Primer3 does', 50],
      ['plain', 'ACGTACGTACGTACGTACG', 'Imported primer (19 nt)', 60, 52.6],
      ['withW', 'ACGTACGTWACGTACGTACG', 'Imported primer (20 nt)', 'Tm n/a: the span holds 1 N or other ambiguity base; Tm is computed on A/C/G/T only, as Primer3 does', 50],
    ] },
    semicolonMixed: { text: 'name;sequence;description\nPhosF;/5Phos/GTAAAACGACGGCCAGT;phosphorylated\nRNA1;ACGUACGUACGUAGCU;an RNA oligo\nM13F;GTAAAACGACGGCCAGT;first\nM13F;CAGGAAACAGCTATGAC;second\nM13F;TGTAAAACGACGGCCAGTG;third\n;ACGTACGTACGT;nameless\nBio;ACGTAC/iBiodT/ACGTACG;biotin\nThree;ACGTACGTACGTACG/3Phos/;\n# a comment\n\nlower;acgtacgtacgtacgt;lower case\nspaced;ACGT ACGT-ACGT ACGT;spaces and dashes\n', summary: 'Imported 10 primers', docs: [
      ['PhosF', 'GTAAAACGACGGCCAGT', 'phosphorylated', 58.2, 52.9],
      ['RNA1', 'ACGTACGTACGTAGCT', 'an RNA oligo', 54.7, 50],
      ['M13F', 'GTAAAACGACGGCCAGT', 'first', 58.2, 52.9],
      ['M13F_2', 'CAGGAAACAGCTATGAC', 'second', 52.6, 47.1],
      ['M13F_3', 'TGTAAAACGACGGCCAGTG', 'third', 61.6, 52.6],
      ['Primer_6', 'ACGTACGTACGT', 'nameless', 45.6, 50],
      ['Bio', 'ACGTACACGTACG', 'biotin', 47.6, 53.8],
      ['Three', 'ACGTACGTACGTACG', 'Imported primer (15 nt)', 52.7, 53.3],
      ['lower', 'ACGTACGTACGTACGT', 'lower case', 56.3, 50],
      ['spaced', 'ACGTACGTACGTACGT', 'spaces and dashes', 56.3, 50],
    ] },
    csvLabelsCrlf: { text: 'Oligo,Seq,Labels,Notes\r\nX1,ACGTACGTACGTAA,"pcr;seq",note x\r\nA,GGGGCCCCAAAATTTT,,\r\nA,GGGGCCCCAAAATTTA,,\r\nA_2,GGGGCCCCAAAATTTC,,again\r\n,/5Phos/UUUUAAAACCCCGGGG,,\r\n', summary: 'Imported 5 primers', docs: [
      ['X1', 'ACGTACGTACGTAA', 'note x', 46.9, 42.9],
      ['A', 'GGGGCCCCAAAATTTT', 'Imported primer (16 nt)', 55.3, 50],
      ['A_2', 'GGGGCCCCAAAATTTA', 'Imported primer (16 nt)', 54.2, 50],
      ['A_2', 'GGGGCCCCAAAATTTC', 'again', 56, 56.3],
      ['Primer_5', 'TTTTAAAACCCCGGGG', 'Imported primer (16 nt)', 54.2, 50],
    ] },
    headerlessCsvDegenerate: { text: 'deg1,ACGTRYSWKMBDHVNACG\nrc,5\'-GGATCC-3\'\ndesc-less,ACGTACGTACGTACGTAC,extra,cols\n', summary: 'Imported 3 primers', docs: [
      ['deg1', 'ACGTRYSWKMBDHVNACG', 'Imported primer (18 nt)', 'Tm n/a: the span holds 11 N or other ambiguity bases; Tm is computed on A/C/G/T only, as Primer3 does', 22.2],
      ['rc', 'GGATCC', 'Imported primer (6 nt)', -1, 66.7],
      ['desc-less', 'ACGTACGTACGTACGTAC', 'Imported primer (18 nt)', 57, 50],
    ] },
  };

  // Wrong implementations these fail on: duplicate names left as they are or numbered by row, U kept
  // in a DNA document, the base /iBiodT/ stands for written into the document, a modification left in,
  // the description fallback or the Tm reason changed, and a comment or blank line read as a row.
  it.each(Object.keys(BEFORE))('US-01M7DQHR AC4 Import Primers makes the documents it made at 77728aa: %s', (key) => {
    const { text, summary, docs } = BEFORE[key];
    const made = runImportPrimers(text, { folder: '' });
    expect(made.summary).toBe(summary);
    expect(made.created.map((d) => [d.name, d.sequence, d.description, d.docMetadata?.['Tm (°C)'], d.docMetadata?.['GC %']])).toEqual(docs);
    for (const d of made.created) {
      expect([d.moleculeType, d.topology, d.documentKind, d.folder, d.docMetadata?.['Source Format']]).toEqual(['DNA', 'linear', 'primer', 'Primers', 'Primer spreadsheet']);
      expect(d.history.map((h) => [h.operation, h.description, h.lengthBp])).toEqual([['Import Primers', 'Imported from a primer spreadsheet', d.sequence.length]]);
    }
  });

  it('US-01M7DQHR AC4 a quoted description spanning lines is one row, not a broken row and a skipped one', () => {
    // At 77728aa this made M13F with the description 'universal' and skipped line 3 ('no sequence').
    const text = 'name,sequence,notes\nM13F,GTAAAACGACGGCCAGT,"universal\nforward primer"\nM13R,CAGGAAACAGCTATGAC,reverse\n';
    const made = runImportPrimers(text, {});
    expect(made.summary).toBe('Imported 2 primers');
    expect(made.created.map((d) => [d.name, d.sequence, d.description])).toEqual([
      ['M13F', 'GTAAAACGACGGCCAGT', 'universal\nforward primer'],
      ['M13R', 'CAGGAAACAGCTATGAC', 'reverse'],
    ]);
    expect(parsePrimerSpreadsheet(text).rows.map((x) => x.row)).toEqual([2, 4]);
  });
});
