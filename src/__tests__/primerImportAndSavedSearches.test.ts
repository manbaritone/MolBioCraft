// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { INTERNAL_MODIFICATIONS, normalizePrimerSequence, parsePrimerSpreadsheet, readPrimerSpreadsheet, type PrimerColumnMapping } from '../core/primerImport';
import { ImportPrimersDialog } from '../components/SequenceAnalysisToolDialogs';
import {
  deleteProjectSearch, deleteTableSearch, discardUnreadableSearches, loadSavedSearches, PROJECT_SEARCHES_KEY, readProjectSearches,
  readTableSearches, saveProjectSearch, saveTableSearch, searchFieldText, TABLE_SEARCHES_KEY, upsertSavedSearch, type ProjectSavedSearch, type SavedSearch,
} from '../core/savedSearches';
import { evaluateTableRowFilters } from '../components/WorkbenchSmartTable';
import { runAnnotateByBlast, runImportPrimers, type OperationResult } from '../core/operationRunners';
import type { SequenceDocument } from '../types/bio';

/**
 * The Import Primers dialog is rendered statically (the repo carries no DOM library, so nothing can
 * be typed into it). These probes hand its own state the text a user would have pasted and the
 * columns they would have chosen; everything from there to the markup is the dialog's own code.
 */
const probe = vi.hoisted(() => ({
  texts: [] as string[],
  mapping: null as null | Partial<Record<string, number>>,
  /** The props the dialog gave the OperationDialog it rendered: its `onRun` is what Import calls. */
  dialog: null as null | { onRun: (values: Record<string, unknown>, signal: AbortSignal) => unknown },
}));
vi.mock('../components/OperationDialog', async () => {
  const actual = await vi.importActual<typeof import('../components/OperationDialog')>('../components/OperationDialog');
  const R = await vi.importActual<typeof import('react')>('react');
  const OperationDialog = (props: Parameters<typeof actual.OperationDialog>[0]) => {
    probe.dialog = props as unknown as NonNullable<typeof probe.dialog>;
    return R.createElement(actual.OperationDialog, props);
  };
  return { ...actual, OperationDialog };
});
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
  const created: OperationResult[] = [];
  const html = renderToStaticMarkup(React.createElement(ImportPrimersDialog, { onCreate: (r: OperationResult) => created.push(r), onClose: () => undefined }));
  const dialog = probe.dialog!;
  /** Press Import: the dialog's own onRun, with the folder option at its default. */
  const run = async () => { await dialog.onRun({ folder: 'Primers' }, new AbortController().signal); return created; };
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
  return { html, rows, problem: problem ? decode(problem[1]) : null, selected, run };
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

  it('US-01M7DQHR AC1 the user maps the name, sequence, description and label columns', async () => {
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
    // The documents follow the same mapping, from the runner and from the dialog's own Import.
    const made = runImportPrimers(text, {}, mapping);
    expect(made.created.map((d) => [d.name, d.sequence, d.description])).toEqual([['X1', 'ACGTACGTACGTAA', 'first note'], ['X2', 'GGGGCCCCAAAATTTT', 'second note']]);
    const pressed = await dialog.run();
    expect(pressed.flatMap((r) => r.created.map((d) => [d.name, d.sequence, d.description]))).toEqual([['X1', 'ACGTACGTACGTAA', 'first note'], ['X2', 'GGGGCCCCAAAATTTT', 'second note']]);
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
    expect(readPrimerSpreadsheet(xlsx).problem!.message).toContain('save the sheet as UTF-8 CSV');
    const binary = 'name,sequence\nM13F,GTAA\u0000CGGCCAGT\n';
    expect(readPrimerSpreadsheet(binary).problem).toEqual({ row: 2, field: 2, message: 'the file holds binary data (a NUL byte), so it is not a text sheet; save the sheet as UTF-8 CSV' });
    expect(readPrimerSpreadsheet(binary).rows).toEqual([]);
    expect(renderImportDialog(binary).problem).toBe('Cannot read the spreadsheet: row 2, field 2: the file holds binary data (a NUL byte), so it is not a text sheet; save the sheet as UTF-8 CSV.');
  });

  // Wrong readings (D0121): a whole sheet refused for one undecodable character in a note, as a
  // Windows-1252 export gives, the character dropped or kept without a word, and a FileMaker vertical
  // tab kept as a control character or read as the end of the row.
  it('US-01M7DQHR AC1 a U+FFFD or control character is kept with a warning to save as UTF-8 CSV, and a vertical tab is a line break in its cell', async () => {
    const text = 'name,sequence,notes\nM13F,GTAAAACGACGGCCAGT,25\uFFFDC anneal\nM13R,CAGGAAACAGCTATGAC,line one\u000Bline two\nF1,ACGTGACTGACTGATCGATG,form\u000Cfeed\n';
    const r = readPrimerSpreadsheet(text);
    expect(r.problem).toBeNull();
    expect(r.rows.map((x) => [x.row, x.name, x.description, x.errors, x.warnings])).toEqual([
      [2, 'M13F', '25\uFFFDC anneal', [], ['notes (column 3): character U+FFFD is kept, but it is not readable text; save the sheet as UTF-8 CSV']],
      [3, 'M13R', 'line one\nline two', [], []],
      [4, 'F1', 'form\u000Cfeed', [], ['notes (column 3): character U+000C is kept, but it is not readable text; save the sheet as UTF-8 CSV']],
    ]);
    const dialog = renderImportDialog(text);
    expect(dialog.rows.map((x) => [x.row, x.cells.import])).toEqual([
      [2, 'as M13F; warning: notes (column 3): character U+FFFD is kept, but it is not readable text; save the sheet as UTF-8 CSV'],
      [3, 'as M13R'],
      [4, 'as F1; warning: notes (column 3): character U+000C is kept, but it is not readable text; save the sheet as UTF-8 CSV'],
    ]);
    const made = await dialog.run();
    expect(made.flatMap((m) => m.created.map((d) => [d.name, d.description]))).toEqual([['M13F', '25\uFFFDC anneal'], ['M13R', 'line one\nline two'], ['F1', 'form\u000Cfeed']]);
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

  // Wrong readings: an uppercase R or M before a base read as an IDT prefix (ACGTRACGT losing its
  // degenerate R to an RNA A), as a case-insensitive prefix test would.
  it('US-01M7DQHR AC3 an uppercase R or M before A, C, G or T stays a degenerate IUPAC code', async () => {
    for (const [input, expected] of [['ACGTRACGT', 'ACGTRACGT'], ['MACGTACGTA', 'MACGTACGTA'], ['RCGTMGAA', 'RCGTMGAA'], ['ACMTTARGCC', 'ACMTTARGCC'], ['acgtRACGTmACG', 'ACGTRACGTACG']] as const) {
      const n = normalizePrimerSequence(input);
      expect([n.sequence, n.molecule, n.error], input).toEqual([expected, 'DNA', null]);
      expect(n.modifications.filter((m) => /^[rR]/.test(m.text)), `${input}: no R read as an RNA prefix`).toEqual([]);
    }
    expect(normalizePrimerSequence('acgtRACGTmACG').modifications.map((m) => [m.text, m.position])).toEqual([['mA', 10]]);
    const text = 'name,sequence\nd1,ACGTRACGTMACG\nd2,MACGTACGTA\n';
    const dialog = renderImportDialog(text);
    expect(dialog.rows.map((x) => [x.cells.normalized, x.cells.molecule, x.cells.modifications])).toEqual([['ACGTRACGTMACG', 'DNA', ''], ['MACGTACGTA', 'DNA', '']]);
    // The documents are the ones 77728aa made from these rows.
    const made = await dialog.run();
    expect(made.flatMap((m) => m.created.map((d) => [d.name, d.sequence]))).toEqual([['d1', 'ACGTRACGTMACG'], ['d2', 'MACGTACGTA']]);
  });

  // Wrong readings: an internal modification's base guessed from the last letter of its code
  // (/iBiotinTEG/ gaining a G), a terminal code accepted at the wrong end or inside the sequence,
  // two phosphorothioates at one bond, a spacer given a base, and a lowercase LNA base refused.
  it('US-01M7DQHR AC2 internal modifications come from a table; an unknown or misplaced one is refused with its row', () => {
    const text = 'name,sequence\nteg,ACGTAC/iBiotinTEG/ACGTACG\nphos3,ACGTACGTACGT/5Phos/\nphos5,/3Phos/ACGTACGTACGT\nmid,ACGTAC/5Phos/ACGTAC\nss,A*C**GTACGT\nsp,/iSpC3/ACGTAC\nok,ACGTAC/iSpC3/ACGTAC\n';
    const r = readPrimerSpreadsheet(text);
    expect(r.rows.map((x) => [x.row, x.errors.map((e) => e.message)])).toEqual([
      [2, ['/iBiotinTEG/ at position 7 is not an internal modification MolBioCraft knows, so it cannot tell whether it puts a base there or sits between two']],
      [3, ["/5Phos/ is a 5' modification but is written at the 3' end"]],
      [4, ["/3Phos/ is a 3' modification but is written at the 5' end"]],
      [5, ['/5Phos/ is written inside the sequence, but it is not an internal modification']],
      [6, ["'**' at position 4: one bond between two bases cannot hold two phosphorothioates"]],
      [7, ["/iSpC3/ is an internal modification but is written at the 5' end"]],
      [8, []],
    ]);
    expect(r.rows[6].modifications).toEqual([{ text: '/iSpC3/', placement: 'internal', position: 6, base: null, noThermodynamics: true }]);
    for (const [code, base] of [['iBiodT', 'T'], ['iFluorT', 'T'], ['iAmMC6T', 'T'], ['iMe-dC', 'C'], ['i2OMeA', 'A'], ['iSp9', null], ['iSp18', null], ['idSp', null], ['iSpPC', null], ['iCy3', null]] as const) {
      const n = normalizePrimerSequence(`ACGTAC/${code}/GACGT`);
      expect([n.error, n.modifications[0].base, n.sequence], code).toEqual([null, base, `ACGTAC${base ?? ''}GACGT`]);
    }
    const lna = normalizePrimerSequence('+a+cgtacgt');
    expect([lna.sequence, lna.error, lna.modifications.map((m) => m.text)]).toEqual(['ACGTACGT', null, ['+A', '+C']]);
    const dialog = renderImportDialog(text);
    expect(dialog.rows[0].cells.import).toBe('sequence (column 2): /iBiotinTEG/ at position 7 is not an internal modification MolBioCraft knows, so it cannot tell whether it puts a base there or sits between two');
    expect(parsePrimerSpreadsheet(text).skipped.map((x) => x.line)).toEqual([2, 3, 4, 5, 6, 7]);
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

  // Wrong readings (the review's probe, D0121): a first-line comment read as a one-cell header, so
  // every row is refused as wider than it; a comment choosing the separator.
  it('US-01M7DQHR AC4 a comment line before the rows or the header is never the header', async () => {
    // At 77728aa: the same two documents.
    const text = '# primer list\nM13F,GTAAAACGACGGCCAGT\nM13R,CAGGAAACAGCTATGAC\n';
    const made = runImportPrimers(text, {});
    expect(made.summary).toBe('Imported 2 primers');
    expect(made.created.map((d) => [d.name, d.sequence, d.description, d.docMetadata?.['Tm (°C)'], d.docMetadata?.['GC %']])).toEqual([
      ['M13F', 'GTAAAACGACGGCCAGT', 'Imported primer (17 nt)', 58.2, 52.9],
      ['M13R', 'CAGGAAACAGCTATGAC', 'Imported primer (17 nt)', 52.6, 47.1],
    ]);
    const dialog = renderImportDialog(text);
    expect(dialog.rows.map((x) => [x.row, x.cells.name, x.cells.import])).toEqual([[2, 'M13F', 'as M13F'], [3, 'M13R', 'as M13R']]);
    expect((await dialog.run()).flatMap((m) => m.created.map((d) => d.name))).toEqual(['M13F', 'M13R']);
    // A comment holding a semicolon does not make the sheet semicolon-separated.
    expect(runImportPrimers('# oligo list; v2\nM13F,GTAAAACGACGGCCAGT\n', {}).created.map((d) => d.name)).toEqual(['M13F']);
    // With a real header under the comment, the header is read: names, sequences and Tm as at
    // 77728aa, and the notes column, which 77728aa missed by taking the comment as the header,
    // becomes the description.
    const headed = readPrimerSpreadsheet('# oligo list\nname,sequence,notes\nM13F,GTAAAACGACGGCCAGT,fwd\nM13R,CAGGAAACAGCTATGAC,rev\n');
    expect([headed.header, headed.rows.map((x) => [x.row, x.name, x.sequence, x.description])]).toEqual([['name', 'sequence', 'notes'], [[3, 'M13F', 'GTAAAACGACGGCCAGT', 'fwd'], [4, 'M13R', 'CAGGAAACAGCTATGAC', 'rev']]]);
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

// ─── BG-01M7DTWB: the round-2 findings of US-01M7DQHR ───

describe('BG-01M7DTWB internal IDT codes, vertical tabs and the table itself', () => {
  /**
   * What 77728aa made from these rows, captured by running that commit's parser:
   * [name, sequence, description, Tm (°C), GC %].
   */
  const PROBES_BEFORE: [string, string, string, number | string, number][] = [
    ['zen', 'ACGTACGTACGTACGTACG', 'Imported primer (19 nt)', 60, 52.6],
    ['zen2', 'ACGTACGTACGTACGTACG', 'Imported primer (19 nt)', 60, 52.6],
    ['tao', 'ACGTACGTACGTACGTACG', 'Imported primer (19 nt)', 60, 52.6],
    ['inosine', 'ACGTACACGTACG', 'Imported primer (13 nt)', 47.6, 53.8],
    ['tamra', 'ACGTACACGTACG', 'Imported primer (13 nt)', 47.6, 53.8],
    ['fam', 'ACGTACACGTACG', 'Imported primer (13 nt)', 47.6, 53.8],
    ['sp9', 'ACGTACACGTACG', 'Imported primer (13 nt)', 47.6, 53.8],
  ];
  const PROBES = 'name,sequence\nzen,/56-FAM/ACGTACGTA/iZEN/CGTACGTACG/3IABkFQ/\nzen2,/56-FAM/ACGTACGTA/ZEN/CGTACGTACG/3IABkFQ/\ntao,/5Cy5/ACGTACGTA/iTAO/CGTACGTACG/3IAbRQSp/\ninosine,ACGTAC/ideoxyI/ACGTACG\ntamra,ACGTAC/i6-TAMN/ACGTACG\nfam,ACGTAC/i6-FAMK/ACGTACG\nsp9,ACGTAC/iSp9/ACGTACG\n';

  // Wrong readings (the round-2 regression): a closed table refusing the common internal codes, so
  // a PrimeTime ZEN or TAO probe, a deoxyinosine primer and an internal TAMRA or FAM row import
  // nothing; IDT's own /ZEN/ spelling read as a terminal code written inside the sequence.
  it('BG-01M7DTWB AC1 qPCR probes with ZEN or TAO, deoxyinosine and internal dyes import as 77728aa imported them', async () => {
    const made = runImportPrimers(PROBES, {});
    expect(made.summary).toBe('Imported 7 primers');
    expect(made.created.map((d) => [d.name, d.sequence, d.description, d.docMetadata?.['Tm (°C)'], d.docMetadata?.['GC %']])).toEqual(PROBES_BEFORE);
    const dialog = renderImportDialog(PROBES);
    expect((await dialog.run()).flatMap((m) => m.created.map((d) => d.name))).toEqual(PROBES_BEFORE.map((p) => p[0]));
    // The faithful reading: a quencher adds no base, a dT-linked dye adds its T, deoxyinosine reads as N.
    expect(dialog.rows.map((x) => [x.cells.name, x.cells.normalized, x.cells.modifications])).toEqual([
      ['zen', 'ACGTACGTACGTACGTACG', "/56-FAM/ 5' end, no Tm calculation; /iZEN/ at 9, no Tm calculation; /3IABkFQ/ 3' end, no Tm calculation"],
      ['zen2', 'ACGTACGTACGTACGTACG', "/56-FAM/ 5' end, no Tm calculation; /ZEN/ at 9, no Tm calculation; /3IABkFQ/ 3' end, no Tm calculation"],
      ['tao', 'ACGTACGTACGTACGTACG', "/5Cy5/ 5' end, no Tm calculation; /iTAO/ at 9, no Tm calculation; /3IAbRQSp/ 3' end, no Tm calculation"],
      ['inosine', 'ACGTACNACGTACG', '/ideoxyI/ at 7 (N), no Tm calculation'],
      ['tamra', 'ACGTACTACGTACG', '/i6-TAMN/ at 7 (T), no Tm calculation'],
      ['fam', 'ACGTACTACGTACG', '/i6-FAMK/ at 7 (T), no Tm calculation'],
      ['sp9', 'ACGTACACGTACG', '/iSp9/ at 6, no Tm calculation'],
    ]);
    // A code not in the table is refused, and the reason never claims a base the code may not have.
    const unknown = normalizePrimerSequence('ACGTAC/iQuasar/ACGTACG');
    expect(unknown.error?.message).toBe('/iQuasar/ at position 7 is not an internal modification MolBioCraft knows, so it cannot tell whether it puts a base there or sits between two');
    expect(unknown.error?.message).not.toMatch(/stands for/);
  });

  // Wrong refusals: a row the story's AC4 lists as now refused (a terminal code at the other end or
  // inside the sequence, a spacer or dye at an end, an unknown internal code) imported anyway, or
  // dropped without its reason in the preview and without being counted as skipped.
  it('BG-01M7DTWB AC2 each refusal US-01M7DQHR AC4 discloses shows its reason in the preview and is counted as skipped', () => {
    const text = 'name,sequence\nphos3,ACGTACGTACGT/5Phos/\ninside,ACGTAC/5Phos/ACGTAC\nsp3,ACGTACGTAC/iSpC3/\nunknown,ACGTAC/iQuasar/ACGTACG\nok,ACGTACGTACGTAC\n';
    const dialog = renderImportDialog(text);
    expect(dialog.rows.map((x) => [x.row, x.cells.import])).toEqual([
      [2, "sequence (column 2): /5Phos/ is a 5' modification but is written at the 3' end"],
      [3, 'sequence (column 2): /5Phos/ is written inside the sequence, but it is not an internal modification'],
      [4, "sequence (column 2): /iSpC3/ is an internal modification but is written at the 3' end"],
      [5, 'sequence (column 2): /iQuasar/ at position 7 is not an internal modification MolBioCraft knows, so it cannot tell whether it puts a base there or sits between two'],
      [6, 'as ok'],
    ]);
    expect(runImportPrimers(text, {}).summary).toBe('Imported 1 primer (4 rows skipped)');
  });

  // Wrong tables: an entry's base changed (i2OMeU read as T), a code added or dropped unnoticed.
  it('BG-01M7DTWB AC3 every table entry and its base is pinned', () => {
    expect(Object.fromEntries(INTERNAL_MODIFICATIONS)).toEqual({
      ibiodt: 'T', ifluort: 'T', iammc6t: 'T', 'i6-tamn': 'T', 'i6-famk': 'T', 'ime-dc': 'C',
      i2omea: 'A', i2omec: 'C', i2omeg: 'G', i2omeu: 'U', ideoxyi: 'N',
      izen: '', zen: '', itao: '', tao: '',
      isp9: '', isp18: '', ispc3: '', idsp: '', isppc: '', icy3: '', icy5: '',
    });
    for (const [code, base] of INTERNAL_MODIFICATIONS) {
      const n = normalizePrimerSequence(`ACGAC/${code}/GACG`);
      expect([n.error, n.sequence, n.modifications[0].base], code).toEqual([null, `ACGAC${base}GACG`, base || null]);
    }
    expect(normalizePrimerSequence('ACGAC/i2OMeU/GACG').molecule).toBe('RNA');
  });

  // Wrong readings: a spacer, dye or quencher accepted at the 3' end, where it sits between nothing.
  it("BG-01M7DTWB AC3 a spacer, dye or quencher at the 3' end is refused", () => {
    for (const code of ['iSpC3', 'iCy5', 'iZEN', 'ZEN']) {
      expect(normalizePrimerSequence(`ACGTACGTAC/${code}/`).error?.message, code).toBe(`/${code}/ is an internal modification but is written at the 3' end`);
      expect(normalizePrimerSequence(`/${code}/ACGTACGTAC`).error?.message, code).toBe(`/${code}/ is an internal modification but is written at the 5' end`);
    }
  });

  // Wrong readings: a vertical tab inside a quoted cell kept as U+000B; one in a name cell made a line
  // break inside the document name.
  it('BG-01M7DTWB AC3 a vertical tab inside a quoted cell is a line break; BG-01M7DTWB AC4 in a name it is a space', async () => {
    const quoted = readPrimerSpreadsheet('name,sequence,notes\nM13F,GTAAAACGACGGCCAGT,"one\u000Btwo, three"\n');
    expect(quoted.rows.map((x) => [x.description, x.warnings])).toEqual([['one\ntwo, three', []]]);
    const named = 'name,sequence\n"M13\u000BF",GTAAAACGACGGCCAGT\nM13\u000BR,CAGGAAACAGCTATGAC\n"two\nlines",ACGTACGTACGTAC\n';
    expect(readPrimerSpreadsheet(named).rows.map((x) => x.name)).toEqual(['M13 F', 'M13 R', 'two lines']);
    const made = await renderImportDialog(named).run();
    expect(made.flatMap((m) => m.created.map((d) => d.name))).toEqual(['M13 F', 'M13 R', 'two lines']);
  });
});

// ─── US-01M7DV4Y: the two saved-search stores, read and written apart ───
//
// The store under each key is read as never written, written (perhaps empty) or unreadable, and the
// three are told apart; a store a write would overwrite is re-read first. A storage whose setItem
// throws stands for a browser refusing the write.

describe('US-01M7DV4Y saved-search stores', () => {
  /** Memory storage whose writes can be refused; reads still answer. */
  const storageOf = (seed: Record<string, string> = {}) => {
    const m = new Map(Object.entries(seed));
    let refuse = false;
    const st = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { if (refuse) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      get length() { return m.size; },
      key: (i: number) => [...m.keys()][i] ?? null,
      refuse: (on: boolean) => { refuse = on; },
    };
    vi.stubGlobal('localStorage', st);
    return st;
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  const V1_A: SavedSearch = { id: 'ss-a', name: 'Kan plasmids', quickFilter: 'kan', rules: [], matchMode: 'all', wholeProject: true };
  const V1_B: SavedSearch = { id: 'ss-b', name: 'Bench folder', quickFilter: '', rules: [{ id: 'r1', colId: 'name', operator: 'contains', value: 'x' }], matchMode: 'any', wholeProject: false };
  const PROJECT: Omit<ProjectSavedSearch, 'id'> = {
    name: 'Bench run', conditions: [{ mode: 'Text', query: 'zq' }, { mode: 'Nucleotide motif', query: 'GAATTC' }], combine: 'ANY',
    bothStrands: false, includePrimers: true, scope: 'Folder and subfolders', folderId: 'Assay Bench',
    filters: { documentType: '', topology: 'linear', lengthMin: '10', lengthMax: '', modifiedFrom: '', modifiedTo: '', annotationType: '' },
  };

  it('US-01M7DV4Y AC2 v1 entries still load as before, a nameless one dropped, and a project search never lands in the v1 store', () => {
    const st = storageOf({ [TABLE_SEARCHES_KEY]: JSON.stringify([V1_A, { id: 'ss-x' }, V1_B]) });
    expect(readTableSearches()).toEqual({ state: 'read', searches: [V1_A, V1_B] });
    expect(loadSavedSearches()).toEqual([V1_A, V1_B]);
    const saved = saveProjectSearch(PROJECT);
    expect(saved.ok).toBe(true);
    expect(JSON.parse(st.getItem(TABLE_SEARCHES_KEY)!), 'the v1 store is untouched by a project save').toEqual([V1_A, { id: 'ss-x' }, V1_B]);
    expect(readTableSearches()).toEqual({ state: 'read', searches: [V1_A, V1_B] });
    // An older build's table menu reads the v1 key only, keeping any entry with a name: none of these is one.
    const stored = JSON.parse(st.getItem(PROJECT_SEARCHES_KEY)!);
    expect(stored).toEqual({ schema: 1, searches: [{ ...PROJECT, id: expect.any(String) }] });
    expect(Array.isArray(stored), 'the project store is no list an older table menu would read').toBe(false);
    // A v1 save still writes the v1 list, replacing a same-named entry case-insensitively.
    const t = saveTableSearch({ name: 'KAN plasmids', quickFilter: 'kanR', rules: [], matchMode: 'all', wholeProject: true });
    expect(t).toEqual({ ok: true, searches: [{ ...V1_A, name: 'KAN plasmids', quickFilter: 'kanR' }, V1_B] });
  });

  it('US-01M7DV4Y AC4 never written, written empty and unreadable are three answers, each store by its key and reason', () => {
    storageOf();
    expect(readProjectSearches()).toEqual({ state: 'missing', searches: [] });
    expect(readTableSearches()).toEqual({ state: 'missing', searches: [] });
    storageOf({ [PROJECT_SEARCHES_KEY]: JSON.stringify({ schema: 1, searches: [] }), [TABLE_SEARCHES_KEY]: '[]' });
    expect(readProjectSearches()).toEqual({ state: 'read', searches: [] });
    expect(readTableSearches()).toEqual({ state: 'read', searches: [] });
    const cases: [Record<string, string>, unknown, unknown][] = [
      [{ [PROJECT_SEARCHES_KEY]: '{oops' }, { state: 'unreadable', key: PROJECT_SEARCHES_KEY, reason: 'it is not valid JSON' }, null],
      [{ [PROJECT_SEARCHES_KEY]: JSON.stringify({ schema: 2, searches: [] }) },
        { state: 'unreadable', key: PROJECT_SEARCHES_KEY, reason: 'it was written in schema 2, newer than this build reads (schema 1)' }, null],
      [{ [PROJECT_SEARCHES_KEY]: JSON.stringify({ schema: 1, searches: [{ name: 'half' }] }) },
        { state: 'unreadable', key: PROJECT_SEARCHES_KEY, reason: 'entry 1 is not a saved project search' }, null],
      [{ [TABLE_SEARCHES_KEY]: '[{"name": ' }, null, { state: 'unreadable', key: TABLE_SEARCHES_KEY, reason: 'it is not valid JSON' }],
      [{ [TABLE_SEARCHES_KEY]: JSON.stringify({ schema: 2, searches: [] }) }, null,
        { state: 'unreadable', key: TABLE_SEARCHES_KEY, reason: 'it was written in schema 2, newer than this build reads (schema 1)' }],
    ];
    for (const [seed, project, table] of cases) {
      storageOf(seed);
      if (project) expect(readProjectSearches()).toEqual(project);
      if (table) {
        expect(readTableSearches()).toEqual(table);
        expect(loadSavedSearches(), 'the table menu lists none of an unreadable store').toEqual([]);
      }
    }
  });

  it('US-01M7DV4Y AC4 a save to an unreadable store is refused and keeps the stored value; only the discard replaces it', () => {
    const st = storageOf({ [PROJECT_SEARCHES_KEY]: '{oops', [TABLE_SEARCHES_KEY]: '[{"name": ' });
    expect(saveProjectSearch(PROJECT)).toEqual({ ok: false, sentence: '"Bench run" was not saved: the saved searches cannot be read.' });
    expect(saveTableSearch({ ...V1_A, name: 'Kan' })).toEqual({ ok: false, sentence: '"Kan" was not saved: the saved searches cannot be read.' });
    expect(st.getItem(PROJECT_SEARCHES_KEY)).toBe('{oops');
    expect(st.getItem(TABLE_SEARCHES_KEY)).toBe('[{"name": ');
    expect(discardUnreadableSearches()).toEqual([]);
    expect(readProjectSearches()).toEqual({ state: 'read', searches: [] });
    expect(readTableSearches()).toEqual({ state: 'read', searches: [] });
    expect(saveProjectSearch(PROJECT).ok).toBe(true);
    // A readable store is never discarded.
    expect(discardUnreadableSearches()).toEqual([]);
    expect(readProjectSearches().state === 'read' && readProjectSearches()).toMatchObject({ searches: [{ name: 'Bench run' }] });
  });

  it('US-01M7DV4Y AC4 a save or delete the browser refuses says so and changes no store, the v1 delete included', () => {
    const st = storageOf({ [TABLE_SEARCHES_KEY]: JSON.stringify([V1_A, V1_B]) });
    const saved = saveProjectSearch(PROJECT);
    expect(saved.ok).toBe(true);
    const id = saved.ok ? saved.searches[0].id : '';
    st.refuse(true);
    expect(saveProjectSearch({ ...PROJECT, name: 'Other' })).toEqual({ ok: false, sentence: '"Other" was not saved: browser storage refused the write.' });
    expect(deleteProjectSearch(id, 'Bench run')).toEqual({ ok: false, sentence: '"Bench run" was not deleted: browser storage refused the write.' });
    expect(saveTableSearch({ ...V1_A, name: 'New' })).toEqual({ ok: false, sentence: '"New" was not saved: browser storage refused the write.' });
    expect(deleteTableSearch('ss-a', 'Kan plasmids')).toEqual({ ok: false, sentence: '"Kan plasmids" was not deleted: browser storage refused the write.' });
    expect(loadSavedSearches()).toEqual([V1_A, V1_B]);
    expect(readProjectSearches()).toMatchObject({ state: 'read', searches: [{ name: 'Bench run' }] });
    st.refuse(false);
    expect(deleteTableSearch('ss-a', 'Kan plasmids')).toEqual({ ok: true, searches: [V1_B] });
    expect(deleteProjectSearch(id, 'Bench run')).toEqual({ ok: true, searches: [] });
  });
});

/**
 * BG-01M7MTBQ: a Save to Primer Database from the Primer & PCR studio while the Primer Database
 * window is open. The studio tells the App (onPrimerDatabaseChanged), the App bumps its primer store
 * revision, and the open window takes it as its refreshKey and reads the store again. The window
 * draws a full-page overlay but traps no focus, so the studio's Save stays reachable from the
 * keyboard behind it: the test presses Enter on it, as a keyboard user does, through the mounted App.
 */
describe('BG-01M7MTBQ: an open Primer Database window lists a primer the studio saves', () => {
  it('BG open window refresh: a primer saved from the Primer & PCR studio appears in the already-open Primer Database window without reopening it', async () => {
    const { mountApp } = await import('./appHarness');
    const { memoryStorage } = await import('./liveDom');
    const { openPrimerDatabase } = await import('../core/primerDatabase');
    type LiveElement = import('./liveDom').LiveElement;
    const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const nameOf = (el: LiveElement) => words(el.getAttribute('aria-label') ?? el.textContent);
    // A linear template with one primer of its own, as US-01M7DQFS AC4 saves it.
    let seed = 0x6d7b;
    const template = Array.from({ length: 1200 }, () => 'ACGT'[((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 30)]).join('');
    const site = template.slice(300, 322);
    const doc: SequenceDocument = {
      id: 'mtbq-template', name: 'pMTBQ_Template', accession: 'MTBQ_0001', description: 'A linear template built in the test',
      sequence: template, moleculeType: 'DNA', topology: 'linear', folder: 'Local',
      createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z',
      features: [{ id: 'f-mtbq-cds', name: 'MtbqCDS', type: 'CDS', start: 101, end: 700, strand: 1, color: '#d93025' }],
      primers: [{
        id: 'mtbq-doc-primer', name: 'Mtbq_Fwd', sequence: site, annealSequence: site, tail5Prime: '', bindStart: 301, bindEnd: 322, strand: 1,
        length: 22, gcPercent: 50, tmAnnealC: 60, tmFullC: 60, deltaG37: -30, hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: true,
      }],
      history: [],
    };
    const storage = memoryStorage();
    const stored = () => {
      const read = openPrimerDatabase({ storage }).read();
      if (!read.ok) throw new Error(read.error.message);
      return read.records.map((r) => r.name);
    };
    const app = await mountApp({ storage });
    try {
      await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'primers-pcr' });
      await app.menu('tools:primer-database');
      const windows = () => app.all('[role="dialog"][aria-labelledby="primer-db-title"]');
      expect(windows(), 'the Primer Database window is open').toHaveLength(1);
      const opened = windows()[0];
      const listed = () => windows()[0].querySelectorAll('tbody tr').map((tr) => words(tr.querySelectorAll('td')[0]?.textContent));
      expect(stored(), 'the store starts empty').toEqual([]);
      expect(listed().filter((n) => n === 'Mtbq_Fwd'), 'the window does not list it yet').toEqual([]);

      const save = app.all('button').filter((b) => nameOf(b) === 'Save Mtbq_Fwd to Primer Database' && !opened.contains(b));
      expect(save, "the studio's Save for the document's primer").toHaveLength(1);
      save[0].focus();
      await app.press('Enter');
      expect(stored(), 'the studio saved it').toEqual(['Mtbq_Fwd']);

      // The same window, never closed or reopened, now lists it.
      expect(windows(), 'still one window').toHaveLength(1);
      expect(windows()[0], 'the window that was open').toBe(opened);
      expect(listed(), 'the open window lists the saved primer').toEqual(['Mtbq_Fwd']);
    } finally {
      app.unmount();
    }
  });
});
