// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DQ0X: Import Primers into the Primer Database. Every criterion is driven through the
 * shipped ImportPrimersDialog: it is rendered statically (the repo carries no DOM library), with
 * probes that hand its own state the text a user pasted and the choices they made, and its Import
 * is the dialog's own `onRun`, captured from the OperationDialog it renders. The store is the real
 * openPrimerDatabase over an in-memory storage that counts writes.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationResult } from '../core/operationRunners';
import type { OperationDialogProps } from '../components/OperationDialog';
import type { DuplicateChoice, DuplicateChoices } from '../core/primerImport';

const probe = vi.hoisted(() => ({
  texts: [] as string[],
  classChoices: null as null | Partial<Record<string, string>>,
  rowChoices: null as null | Record<number, string>,
  dialog: null as null | { onRun: (values: Record<string, unknown>, signal: AbortSignal) => unknown; validate?: (values: Record<string, unknown>) => string | null },
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const { DEFAULT_DUPLICATE_CHOICES, NO_ROW_CHOICES } = await import('../core/primerImport');
  const useState = ((initial: unknown) => actual.useState(() => {
    const v = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    if (v === '' && probe.texts.length) return probe.texts.shift();
    if (v === DEFAULT_DUPLICATE_CHOICES && probe.classChoices) return { ...DEFAULT_DUPLICATE_CHOICES, ...probe.classChoices };
    if (v === NO_ROW_CHOICES && probe.rowChoices) return probe.rowChoices;
    return v;
  })) as typeof actual.useState;
  return { ...actual, default: { ...actual, useState }, useState };
});

vi.mock('../components/OperationDialog', async () => {
  const actual = await vi.importActual<typeof import('../components/OperationDialog')>('../components/OperationDialog');
  const R = await vi.importActual<typeof import('react')>('react');
  const OperationDialog = (props: OperationDialogProps) => {
    probe.dialog = props as unknown as NonNullable<typeof probe.dialog>;
    return R.createElement(actual.OperationDialog, props);
  };
  return { ...actual, OperationDialog };
});

const { ImportPrimersDialog, ImportPrimersToDatabaseDialog } = await import('../components/SequenceAnalysisToolDialogs');
const { openPrimerDatabase, PRIMER_DATABASE_KEY } = await import('../core/primerDatabase');
const { runImportPrimers } = await import('../core/operationRunners');
const { classifyPrimerRows, readPrimerSpreadsheet } = await import('../core/primerImport');
type PrimerDatabase = import('../core/primerDatabase').PrimerDatabase;
type DatabasePrimer = import('../types/bio').DatabasePrimer;

afterEach(() => {
  probe.texts = [];
  probe.classChoices = null;
  probe.rowChoices = null;
  probe.dialog = null;
});

/** A localStorage stand-in that counts writes and reads. */
class MemoryStorage {
  map = new Map<string, string>();
  writes = 0;
  reads = 0;
  getItem(key: string): string | null { this.reads++; return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.writes++; this.map.set(key, String(value)); }
}

/**
 * Full the way a nearly full localStorage is: it keeps a database of at most `limit` records and
 * throws QuotaExceededError on a larger one. Saving rows one at a time would get the first ones in
 * before failing; one write gets none in.
 */
class NearlyFullStorage extends MemoryStorage {
  constructor(private limit: number) { super(); }
  setItem(key: string, value: string): void {
    if ((JSON.parse(value) as { records: unknown[] }).records.length > this.limit) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    super.setItem(key, value);
  }
}

let clock = 0;
function seededStore(storage: MemoryStorage): PrimerDatabase {
  let n = 0;
  const db = openPrimerDatabase({ storage, now: () => `2026-11-15T00:00:${String(clock++ % 60).padStart(2, '0')}.000Z`, newId: () => `seed-${++n}` });
  for (const input of [
    { name: 'M13F', sequence: 'GTAAAACGACGGCCAGT', labels: ['seq'], description: '' },
    { name: 'T7', sequence: 'TAATACGACTCACTATAGGG', labels: [], description: 'T7 promoter' },
    { name: 'GC1', sequence: 'GGGCCCAAAGGGCCCA', molecule: 'RNA' as const, labels: [], description: '' },
  ]) expect(db.add(input).ok).toBe(true);
  storage.writes = 0;
  storage.reads = 0;
  return db;
}

const records = (storage: MemoryStorage): DatabasePrimer[] => (JSON.parse(storage.map.get(PRIMER_DATABASE_KEY)!) as { records: DatabasePrimer[] }).records;

const decode = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});

interface Rendered {
  html: string;
  /** Row number -> the "In the database" cell of the preview. */
  classCell: Map<number, string>;
  /** The rows listed under each duplicate class. */
  classRows: (cls: string) => number[];
  selected: (id: string) => string | null;
  options: (id: string) => string[];
  text: (attr: string) => string[];
  validate: () => string | null;
  run: (values?: Record<string, unknown>) => Promise<void>;
}

function render(element: React.ReactElement, text: string, choices: { byClass?: Partial<DuplicateChoices>; byRow?: Record<number, DuplicateChoice> } = {}): Rendered {
  probe.texts = [text];
  probe.classChoices = choices.byClass ?? null;
  probe.rowChoices = choices.byRow ?? null;
  const html = renderToStaticMarkup(element);
  expect(probe.texts, 'the dialog read the pasted text').toEqual([]);
  const dialog = probe.dialog!;
  const classCell = new Map([...html.matchAll(/<tr data-ip-row="(\d+)">([\s\S]*?)<\/tr>/g)].map((m) => [Number(m[1]), decode(/<td data-ip-col="class">([\s\S]*?)<\/td>/.exec(m[2])?.[1] ?? '')] as const));
  const select = (id: string) => new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html)?.[1] ?? null;
  return {
    html,
    classCell,
    classRows: (cls) => {
      const block = new RegExp(`<div data-ip-class="${cls}"[^>]*>([\\s\\S]*?)</div>`).exec(html);
      return block ? [...block[1].matchAll(/data-ip-dup-row="(\d+)"/g)].map((m) => Number(m[1])) : [];
    },
    selected: (id) => {
      const body = select(id);
      const opt = body && /<option[^>]*selected=""[^>]*>([\s\S]*?)<\/option>/.exec(body);
      return opt ? decode(opt[1]) : null;
    },
    options: (id) => [...(select(id) ?? '').matchAll(/<option[^>]*>([\s\S]*?)<\/option>/g)].map((m) => decode(m[1])),
    text: (attr) => [...html.matchAll(new RegExp(`<(\\w+)[^>]*${attr}[^>]*>([\\s\\S]*?)</\\1>`, 'g'))].map((m) => decode(m[2])),
    validate: () => dialog.validate?.({ folder: 'Primers' }) ?? null,
    run: async (values = { folder: 'Primers' }) => { await dialog.onRun(values, new AbortController().signal); },
  };
}

/** Rows 2-4 meet the database, 5-7 are new against it, and 8-11 meet each other. */
const SHEET = [
  'name,sequence,description,labels',
  ' m13f ,GTAAAACGACGGCCAGT,from the sheet,"pcr;seq"', // 2 exact: the stored M13F, name trimmed and in another case
  'M13F,ACGTACGTACGTACGT,another oligo,', // 3 same name as the stored M13F, different oligo
  'T7 promoter primer,TAATACGACTCACTATAGGG,sheet text,t7', // 4 same oligo as the stored T7, different name
  'M13F-rc,ACTGGCCGTCGTTTTAC,,', // 5 reverse complement of M13F: new
  'GC1-DNA,GGGCCCAAAGGGCCCA,,', // 6 the stored RNA GC1's letters as DNA: new
  'M13F-phos,/5Phos/GTAAAACGACGGCCAGT,,', // 7 M13F's bases with a modification: new
  'Fresh,CCCCGGGGAAAATTTT,,a', // 8 new
  'FRESH,CCCCGGGGAAAATTTT,,b', // 9 exact duplicate of row 8
  'Fresh2,CCCCGGGGAAAATTTT,,', // 10 same oligo as row 8
  'fresh ,GGGGCCCCAAAATTTT,,', // 11 same name as row 8, different oligo
].join('\n') + '\n';

describe('US-01M7DQ0X Import Primers into the Primer Database', () => {
  // Wrong classifications these fail on: names compared case-sensitively, the oligo compared by
  // sequence alone (row 7 would be M13F, row 6 the RNA GC1) or on either strand (row 5 would be
  // M13F), and rows compared only with the database or only with the rest of the sheet. (Sheet cells
  // and stored names are trimmed before they meet, so an untrimmed compare is not isolated here.)
  it('US-01M7DQ0X AC1 rows are classed by name and by oligo against the database and the rest of the sheet', () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />, SHEET);
    expect([...d.classCell.entries()]).toEqual([
      [2, 'Exact duplicate'], [3, 'Same name, different oligo'], [4, 'Same oligo, different name'],
      [5, 'New'], [6, 'New'], [7, 'New'], [8, 'New'],
      [9, 'Exact duplicate'], [10, 'Same oligo, different name'], [11, 'Same name, different oligo'],
    ]);
    expect([d.classRows('exact'), d.classRows('sameName'), d.classRows('sameOligo')]).toEqual([[2, 9], [3, 11], [4, 10]]);
    expect(d.text('data-ip-dup-row=')).toEqual([
      expect.stringMatching(/^Row 2 m13f: matches M13F in the database/),
      expect.stringMatching(/^Row 9 FRESH: matches Fresh on row 8/),
      expect.stringMatching(/^Row 3 M13F: matches M13F in the database/),
      expect.stringMatching(/^Row 11 fresh: matches Fresh on row 8/),
      expect.stringMatching(/^Row 4 T7 promoter primer: matches T7 in the database/),
      expect.stringMatching(/^Row 10 Fresh2: matches Fresh on row 8/),
    ]);
    // The same classes from the core function the dialog renders.
    const core = classifyPrimerRows(readPrimerSpreadsheet(SHEET).rows, records(storage));
    expect(core.classified.map((c) => [c.row.row, c.cls])).toEqual([...d.classCell.entries()].map(([row, label]) => [row, ({ 'Exact duplicate': 'exact', 'Same name, different oligo': 'sameName', 'Same oligo, different name': 'sameOligo', New: 'new' } as Record<string, string>)[label]]));
    expect([core.classified.find((c) => c.row.row === 6)!.row.molecule, records(storage)[2].molecule]).toEqual(['DNA', 'RNA']);
  });

  // Wrong choices these fail on: a class with fewer than the three choices, exact duplicates
  // imported by default, a class choice that leaves rows behind, and a row's own choice ignored.
  it('US-01M7DQ0X AC2 each duplicate class offers skip, keep separately or merge; exact duplicates default to skip; a class choice covers the class', () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />, SHEET);
    for (const cls of ['exact', 'sameName', 'sameOligo']) expect(d.options(`opdlg-ip-class-${cls}`)).toEqual(['Skip (every row)', 'Keep separately (every row)', 'Merge metadata (every row)']);
    for (const row of [2, 3, 4, 9, 10, 11]) expect(d.options(`opdlg-ip-row-${row}`)).toEqual(['Skip', 'Keep separately', 'Merge metadata']);
    for (const row of [5, 6, 7, 8]) expect(d.options(`opdlg-ip-row-${row}`), `new row ${row} offers no choice`).toEqual([]);
    expect([d.selected('opdlg-ip-class-exact'), d.selected('opdlg-ip-row-2'), d.selected('opdlg-ip-row-9')]).toEqual(['Skip (every row)', 'Skip', 'Skip']);

    const chosen = render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />, SHEET,
      { byClass: { exact: 'merge', sameName: 'skip', sameOligo: 'keep' }, byRow: { 9: 'keep' } });
    expect([2, 9, 3, 11, 4, 10].map((r) => chosen.selected(`opdlg-ip-row-${r}`))).toEqual(['Merge metadata', 'Keep separately', 'Skip', 'Skip', 'Keep separately', 'Keep separately']);
    expect(chosen.text('data-ip-db-counts=')).toEqual(['If saved: 8 imported (7 new, 1 merged), 2 skipped, 0 rejected.']);
  });

  // Wrong merges these fail on: the sheet's name or sequence written over the stored one, a filled
  // description replaced, labels replaced rather than added, and a same-name row written over the
  // stored record instead of kept beside it.
  it('US-01M7DQ0X AC2 merge adds labels and fills empty fields only; nothing is overwritten by name', async () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    const before = records(storage);
    const reports: string[] = [];
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, SHEET,
      { byClass: { exact: 'merge', sameName: 'keep', sameOligo: 'merge' }, byRow: { 9: 'skip', 10: 'skip', 11: 'skip' } });
    await d.run();
    const after = records(storage);
    const m13f = after.filter((r) => r.name === 'M13F');
    const stored = m13f.find((r) => r.id === before[0].id)!;
    // Row 2 merged into the stored M13F: its name stays M13F (not ' m13f '), its sequence stays, the
    // empty description is filled and 'pcr' is added after 'seq'.
    expect([stored.name, stored.sequence, stored.description, stored.labels]).toEqual(['M13F', 'GTAAAACGACGGCCAGT', 'from the sheet', ['seq', 'pcr']]);
    // Row 3 (same name, different oligo) kept beside it: two M13F records, the stored one untouched by it.
    expect(m13f.map((r) => r.sequence).sort()).toEqual(['ACGTACGTACGTACGT', 'GTAAAACGACGGCCAGT']);
    // Row 4 merged into T7: the filled description stays, the label is added, the name stays T7.
    const t7 = after.find((r) => r.id === before[1].id)!;
    expect([t7.name, t7.sequence, t7.description, t7.labels]).toEqual(['T7', 'TAATACGACTCACTATAGGG', 'T7 promoter', ['t7']]);
    expect(after.find((r) => r.id === before[2].id)).toEqual(before[2]);
    expect(reports).toEqual(['Saved to the Primer Database: 7 imported (5 new, 2 merged), 3 skipped, 0 rejected.']);
  });

  // A wrong merge this fails on: merging into a row that is itself not saved, which has no record.
  it('US-01M7DQ0X AC2 a merge into a row that is not saved is skipped with the reason', async () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    // Row 2 has T7's oligo (skipped by default); row 3 has row 2's name and another oligo.
    const sheet = 'name,sequence,labels\nX,TAATACGACTCACTATAGGG,\nx,CCCCGGGGAAAATTTT,a\nY,ACGTACGTACGTAAAA,\n';
    const reports: string[] = [];
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, sheet, { byClass: { sameName: 'merge' } });
    expect([...d.classCell.entries()]).toEqual([[2, 'Same oligo, different name'], [3, 'Same name, different oligo'], [4, 'New']]);
    expect(d.text('data-ip-outcome-row=')).toEqual(['Row 2 X: skipped: same oligo, different name', 'Row 3 x: not merged: row 2 it matches is not saved']);
    await d.run();
    expect(records(storage).map((r) => r.name)).toEqual(['M13F', 'T7', 'GC1', 'Y']);
    expect(reports).toEqual(['Saved to the Primer Database: 1 imported (1 new, 0 merged), 2 skipped, 0 rejected.']);
  });

  // Wrong saves these fail on: a write per row (several writes, and on a nearly full store the
  // first rows saved before the failure), rejected or skipped rows written, a failed write reported
  // as a success, and an unreadable store read as empty and overwritten.
  it('US-01M7DQ0X AC3 only reviewed valid rows are saved, in one write, with imported, skipped and rejected counts', async () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    const sheet = `${SHEET}bad,ACGTXACGT,,\n,ACGTACGTACGT,,\nmixed,ACGTUACGU,,\n`;
    const reports: string[] = [];
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, sheet);
    expect(d.text('data-ip-db-counts=')).toEqual(['If saved: 6 imported (6 new, 0 merged), 4 skipped, 3 rejected.']);
    expect(d.text('data-ip-outcome-row=')).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Row 12 bad: rejected: 'X' at position 5/),
      'Row 13 : rejected: A primer needs a name.',
      expect.stringMatching(/^Row 14 mixed: rejected: the sequence holds both T and U/),
    ]));
    expect(d.validate()).toBeNull();
    await d.run();
    expect(storage.writes, 'one store write').toBe(1);
    const names = records(storage).map((r) => r.name);
    // New rows 5-8 and the kept same-name rows 3 and 11; the skipped exact and same-oligo rows and
    // the rejected rows are not written.
    expect(names).toEqual(['M13F', 'T7', 'GC1', 'M13F', 'M13F-rc', 'GC1-DNA', 'M13F-phos', 'Fresh', 'fresh']);
    const phos = records(storage).find((r) => r.name === 'M13F-phos')!;
    expect([phos.sequence, phos.modifications, phos.provenance]).toEqual(['GTAAAACGACGGCCAGT', '/5Phos/', 'Imported from a pasted primer list, row 7']);
    expect(reports).toEqual(['Saved to the Primer Database: 6 imported (6 new, 0 merged), 4 skipped, 3 rejected.']);
  });

  it('US-01M7DQ0X AC3 a failed write saves nothing and says so; an unreadable store is never read as empty', async () => {
    const full = new NearlyFullStorage(4);
    const db = seededStore(full);
    const before = full.map.get(PRIMER_DATABASE_KEY);
    const reports: string[] = [];
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, SHEET);
    await expect(d.run()).rejects.toThrow(/^Nothing was saved to the Primer Database: The change was not saved \(QuotaExceededError/);
    expect(full.map.get(PRIMER_DATABASE_KEY), 'none of the rows was saved').toBe(before);
    expect(reports, 'no success was reported').toEqual([]);

    const broken = new MemoryStorage();
    broken.map.set(PRIMER_DATABASE_KEY, '{"schema":1,"records":[{"id":"x"}]}');
    const unreadable = render(<ImportPrimersToDatabaseDialog database={openPrimerDatabase({ storage: broken })} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, SHEET);
    expect(unreadable.text('data-ip-db-problem=')).toEqual([expect.stringMatching(/^The Primer Database cannot be read, so nothing can be imported into it: The stored primer database/)]);
    expect(unreadable.validate()).toMatch(/^The Primer Database cannot be read/);
    expect(unreadable.text('data-ip-db-counts='), 'no plan is made against an unreadable store').toEqual([]);
    await expect(unreadable.run()).rejects.toThrow(/^Nothing was saved to the Primer Database: The stored primer database/);
    expect([broken.writes, broken.map.get(PRIMER_DATABASE_KEY)]).toEqual([0, '{"schema":1,"records":[{"id":"x"}]}']);
    expect(reports).toEqual([]);

    // Every row skipped: the dialog will not run a save that saves nothing.
    const db2 = seededStore(new MemoryStorage());
    const none = render(<ImportPrimersToDatabaseDialog database={db2} onSaved={() => undefined} onClose={() => undefined} />, 'name,sequence\nM13F,GTAAAACGACGGCCAGT\n');
    expect(none.validate()).toBe('Nothing to import into the Primer Database: 0 imported (0 new, 0 merged), 1 skipped, 0 rejected.');
  });

  // Wrong implementations these fail on: the Documents destination also writing (or reading) the
  // store, documents made from the database plan instead of runImportPrimers, and a window that
  // offers only Documents showing a destination it cannot honour.
  it('US-01M7DQ0X AC4 the Documents destination makes the documents it made before and leaves the database alone', async () => {
    const sheet = 'Primer name,Sequence (5\'-3\'),Notes\nM13F,GTAAAACGACGGCCAGT,"universal, forward"\nM13F,5\'-CAGGAAACAGCTATGAC-3\',dup\nbad,HELLO WORLD,x\nshort,ACG,\n';
    const shape = (r: OperationResult) => ({ summary: r.summary, docs: r.created.map((x) => [x.name, x.sequence, x.description, x.folder, x.docMetadata?.['Tm (°C)'], x.documentKind]) });
    const pinned = { summary: 'Imported 2 primers (2 rows skipped)', docs: [['M13F', 'GTAAAACGACGGCCAGT', 'universal, forward', 'Primers', 58.2, 'primer'], ['M13F_2', 'CAGGAAACAGCTATGAC', 'dup', 'Primers', 52.6, 'primer']] };
    expect(shape(runImportPrimers(sheet, { folder: 'Primers' }))).toEqual(pinned);

    // As the app opens it (Documents only): no destination choice, the folder option, the same documents.
    const made: OperationResult[] = [];
    const app = render(<ImportPrimersDialog onCreate={(r) => made.push(r)} onClose={() => undefined} />, sheet);
    expect(app.html).not.toContain('opdlg-ip-destination');
    expect(app.html).toContain('opdlg-ip-folder');
    await app.run();
    expect(made.map(shape)).toEqual([pinned]);

    // With both destinations offered and Documents chosen: the same documents, and the store neither read nor written.
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    const before = storage.map.get(PRIMER_DATABASE_KEY);
    const both: OperationResult[] = [];
    const saved: string[] = [];
    const d = render(<ImportPrimersDialog onCreate={(r) => both.push(r)} onDatabaseSaved={(r) => saved.push(r)} database={db} onClose={() => undefined} />, sheet);
    expect(d.options('opdlg-ip-destination')).toEqual(['Documents', 'Primer Database']);
    expect(d.selected('opdlg-ip-destination')).toBe('Documents');
    await d.run();
    expect(both.map(shape)).toEqual([pinned]);
    expect([storage.writes, storage.reads, storage.map.get(PRIMER_DATABASE_KEY), saved]).toEqual([0, 0, before, []]);

    // The Primer Database window's dialog offers no Documents destination at all.
    const dbOnly = render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />, sheet);
    expect(dbOnly.html).not.toContain('opdlg-ip-destination');
    expect(dbOnly.html).not.toContain('opdlg-ip-folder');
  });
});

describe('US-01M7DQ0X an RNA oligo written with r prefixes', () => {
  it('US-01M7DQ0X AC1 is the same oligo as the stored RNA, while r bases in a DNA oligo are modifications', () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />,
      'name,sequence\nGC1 again,rGrGrGrCrCrCrArArArGrGrGrCrCrCrA\nchimera,GTAAAACGACGGCCrAGT\n');
    // The chimera has M13F's letters, but its RNA base makes it another oligo.
    expect([...d.classCell.entries()]).toEqual([[2, 'Same oligo, different name'], [3, 'New']]);
  });
});
