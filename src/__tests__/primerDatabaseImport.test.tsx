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
  reviewBasis: null as null | { records: unknown[] | null },
  /** What the dialog's own setters were called with, applied to the state they were called on. */
  classSets: [] as unknown[],
  rowSets: [] as unknown[],
  reviewSets: [] as unknown[],
  dialog: null as null | {
    onRun: (values: Record<string, unknown>, signal: AbortSignal) => unknown;
    validate?: (values: Record<string, unknown>) => string | null;
    renderOptions: (values: Record<string, unknown>, set: (k: string, v: unknown) => void) => unknown;
  },
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const { DEFAULT_DUPLICATE_CHOICES, NO_ROW_CHOICES, REVIEW_AT_OPEN } = await import('../core/primerImport');
  const useState = ((initial: unknown) => {
    const marker = typeof initial === 'function' ? undefined : initial;
    const [value, set] = actual.useState(() => {
      const v = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      if (v === '' && probe.texts.length) return probe.texts.shift();
      if (v === DEFAULT_DUPLICATE_CHOICES && probe.classChoices) return { ...DEFAULT_DUPLICATE_CHOICES, ...probe.classChoices };
      if (v === NO_ROW_CHOICES && probe.rowChoices) return probe.rowChoices;
      if (v === REVIEW_AT_OPEN && probe.reviewBasis) return probe.reviewBasis;
      return v;
    });
    // A static render cannot re-render, so the dialog's own setters are recorded, applied to the
    // value they were called on, rather than run.
    const log = marker === DEFAULT_DUPLICATE_CHOICES ? probe.classSets : marker === NO_ROW_CHOICES ? probe.rowSets : marker === REVIEW_AT_OPEN ? probe.reviewSets : null;
    if (!log) return [value, set];
    return [value, (u: unknown) => log.push(typeof u === 'function' ? (u as (v: unknown) => unknown)(value) : u)];
  }) as typeof actual.useState;
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
const { classifyPrimerRows, DEFAULT_DUPLICATE_CHOICES, readPrimerSpreadsheet } = await import('../core/primerImport');
type PrimerDatabase = import('../core/primerDatabase').PrimerDatabase;
type DatabasePrimer = import('../types/bio').DatabasePrimer;

afterEach(() => {
  probe.reviewBasis = null;
  probe.classSets = [];
  probe.rowSets = [];
  probe.reviewSets = [];
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
    // Merge only where the oligo matches (D0122): a same-name row with another oligo can be skipped or kept.
    for (const cls of ['exact', 'sameOligo']) expect(d.options(`opdlg-ip-class-${cls}`)).toEqual(['Skip (every row)', 'Keep separately (every row)', 'Merge metadata (every row)']);
    expect(d.options('opdlg-ip-class-sameName')).toEqual(['Skip (every row)', 'Keep separately (every row)']);
    for (const row of [2, 4, 9, 10]) expect(d.options(`opdlg-ip-row-${row}`)).toEqual(['Skip', 'Keep separately', 'Merge metadata']);
    for (const row of [3, 11]) expect(d.options(`opdlg-ip-row-${row}`)).toEqual(['Skip', 'Keep separately']);
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
    // Row 2 has M13F's name and a new oligo (skipped by choice); row 3 has row 2's oligo under another name.
    const sheet = 'name,sequence,labels\nM13F,CCCCGGGGAAAATTTT,\nZ,CCCCGGGGAAAATTTT,a\nY,ACGTACGTACGTAAAA,\n';
    const reports: string[] = [];
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, sheet, { byClass: { sameName: 'skip', sameOligo: 'merge' } });
    expect([...d.classCell.entries()]).toEqual([[2, 'Same name, different oligo'], [3, 'Same oligo, different name'], [4, 'New']]);
    expect(d.text('data-ip-outcome-row=')).toEqual(['Row 2 M13F: skipped: same name, different oligo', 'Row 3 Z: not merged: row 2 it matches is not saved']);
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

/** Every element in a React element tree (props.children followed, function components not called). */
function elementsOf(node: unknown): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!React.isValidElement(node)) return [];
  const props = node.props as { children?: unknown };
  return [node, ...elementsOf(props.children)];
}

/** Reads that run `race` once, just before answering the `at`-th read after `arm()`, as another window writing would. */
class RacingStorage extends MemoryStorage {
  private armed = -1;
  private race: (() => void) | null = null;
  arm(at: number, race: () => void) { this.armed = at; this.race = race; }
  getItem(key: string): string | null {
    if (this.armed > 0 && --this.armed === 0 && this.race) { const r = this.race; this.race = null; r(); }
    return super.getItem(key);
  }
}

describe('US-01M7DQ0X duplicates under D0122', () => {
  // Wrong merges (the review's probes): a same-name row with another oligo merged into the stored
  // record, writing its /5Phos/ or /iBiodT/ onto it, as merge on a name match did; merge offered for
  // that class; a forced merge choice on it followed rather than refused.
  it('US-01M7DQ0X AC2 a same-name row with another oligo never changes the stored primer: merge is not offered and it is kept beside it', async () => {
    for (const [seq, mods] of [['/5Phos/GTAAAACGACGGCCAGT', '/5Phos/'], ['ACGTAC/iBiodT/ACGTACG', '/iBiodT/@7']] as const) {
      const storage = new MemoryStorage();
      const db = seededStore(storage);
      const before = records(storage)[0];
      expect([before.name, before.modifications, before.description]).toEqual(['M13F', '', '']);
      const reports: string[] = [];
      const sheet = `name,sequence,description,labels\nM13F,${seq},a row with a modification,mod\n`;
      // The row's own choice is set to merge, as no menu offers it: it falls back to the class's default, keep.
      const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, sheet, { byRow: { 2: 'merge' } });
      expect(d.classCell.get(2), seq).toBe('Same name, different oligo');
      expect(d.options('opdlg-ip-row-2')).toEqual(['Skip', 'Keep separately']);
      expect(d.selected('opdlg-ip-row-2')).toBe('Keep separately');
      await d.run();
      const after = records(storage);
      expect(after[0], 'the stored M13F is untouched').toEqual(before);
      expect(after.slice(3).map((r) => [r.name, r.modifications, r.description, r.labels])).toEqual([['M13F', mods, 'a row with a modification', ['mod']]]);
      expect(reports).toEqual(['Saved to the Primer Database: 1 imported (1 new, 0 merged), 0 skipped, 0 rejected.']);
    }
  });

  // Wrong classifications: a row with one record's name and another's oligo classed as same name only
  // (its oligo match lost, and kept by default as a second copy of T7 under M13F's name).
  it('US-01M7DQ0X AC1 a row matching one record by name and another by oligo shows both and defaults to skip', async () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    const sheet = 'name,sequence\nM13F,TAATACGACTCACTATAGGG\n';
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />, sheet);
    expect(d.classCell.get(2)).toBe('Matches two primers');
    expect(d.classRows('both')).toEqual([2]);
    expect(d.text('data-ip-dup-row=')).toEqual([expect.stringMatching(/^Row 2 M13F: matches M13F in the database by name and T7 in the database by oligo/)]);
    expect([d.options('opdlg-ip-class-both'), d.selected('opdlg-ip-row-2')]).toEqual([['Skip (every row)', 'Keep separately (every row)'], 'Skip']);
    expect(d.validate()).toBe('Nothing to import into the Primer Database: 0 imported (0 new, 0 merged), 1 skipped, 0 rejected.');
    const core = classifyPrimerRows(readPrimerSpreadsheet(sheet).rows, records(storage)).classified[0];
    expect([core.cls, core.nameMatch, core.oligoMatch]).toEqual(['both', { kind: 'database', id: 'seed-1', name: 'M13F' }, { kind: 'database', id: 'seed-2', name: 'T7' }]);
  });

  // Wrong classification: a trashed record matched as if it were active.
  it('US-01M7DQ0X AC1 a trashed record is never matched', () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    expect(db.trash('seed-2').ok).toBe(true);
    const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />, 'name,sequence\nT7,TAATACGACTCACTATAGGG\n');
    expect(d.classCell.get(2)).toBe('New');
  });

  // Wrong saves: the save planned against the open-time read, so a record another window added or
  // deleted meanwhile goes unseen and the reviewed choices are applied to rows whose class changed.
  it('US-01M7DQ0X AC3 at save the rows are classed again; a changed class is shown again for review and nothing is written', async () => {
    for (const [what, change, row, now] of [
      ['added', (other: PrimerDatabase) => expect(other.add({ name: 'Elsewhere', sequence: 'CCCCGGGGAAAATTTT' }).ok).toBe(true), 8, 'same oligo, different name (Elsewhere in the database)'],
      ['deleted', (other: PrimerDatabase) => { expect(other.trash('seed-1').ok).toBe(true); expect(other.emptyTrash().ok).toBe(true); }, 2, 'new'],
    ] as const) {
      probe.reviewSets = [];
      const storage = new MemoryStorage();
      const db = seededStore(storage);
      const reports: string[] = [];
      const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, SHEET);
      change(openPrimerDatabase({ storage }));
      const stored = storage.map.get(PRIMER_DATABASE_KEY);
      const writes = storage.writes;
      const failure = await d.run().then(() => null, (e: Error) => e.message);
      expect(failure, what).toMatch(/^Nothing was saved to the Primer Database: it changed since you reviewed the rows \(.*\)\. They are shown again with their classes now; review them and import again\.$/);
      expect(failure, what).toContain(`row ${row}: `);
      expect(failure, what).toContain(` → ${now}`);
      expect([storage.writes, storage.map.get(PRIMER_DATABASE_KEY), reports], what).toEqual([writes, stored, []]);
      // The dialog moves its review to the store as it stands, and shows the row's class now.
      expect(probe.reviewSets, what).toEqual([{ records: records(storage) }]);
      const again = render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />, SHEET);
      expect(again.classCell.get(row)).toBe(now === 'new' ? 'New' : 'Same oligo, different name');
      expect(failure, 'a row whose match moved to another record is shown too').toContain(what === 'added' ? 'row 10: same oligo, different name (Fresh on row 8) → same oligo, different name (Elsewhere in the database)' : 'row 2: exact duplicate (M13F in the database) → new');
      probe.reviewBasis = probe.reviewSets[0] as { records: unknown[] };
      const reviewed = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, SHEET);
      probe.reviewBasis = null;
      await reviewed.run();
      expect(reports, what).toEqual([expect.stringMatching(/^Saved to the Primer Database: /)]);
    }
  });

  // Wrong class-wide choice: the class's own row choices left in place, so the rows the user had set
  // one by one ignore the choice made for their whole class.
  it("US-01M7DQ0X AC2 a choice for a whole class replaces that class's row choices", () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    render(<ImportPrimersToDatabaseDialog database={db} onSaved={() => undefined} onClose={() => undefined} />, SHEET, { byRow: { 2: 'keep', 9: 'merge', 3: 'skip' } });
    const tree = elementsOf(probe.dialog!.renderOptions({ folder: 'Primers' }, () => undefined));
    const select = tree.find((e) => (e.props as { id?: string }).id === 'opdlg-ip-class-exact')!;
    (select.props as { onChange: (e: { target: { value: string } }) => void }).onChange({ target: { value: 'merge' } });
    expect(probe.classSets).toEqual([{ ...DEFAULT_DUPLICATE_CHOICES, exact: 'merge' }]);
    // Rows 2 and 9 are exact duplicates: their own choices go; row 3's (same name) stays.
    expect(probe.rowSets).toEqual([{ 3: 'skip' }]);
  });

  // Wrong saves (BG-01M7DT7A): a merge target another window trashes or deletes between the
  // dialog's save-time read and the store's commit is brought back by the replace (the trash
  // undone, or the deleted record written back), and the import is reported as saved.
  for (const [ac, what, change, reason, nowClass] of [
    ['AC1', 'trashed', (env: { records: DatabasePrimer[] }) => ({ ...env, records: env.records.map((r) => (r.name === 'T7' ? { ...r, trashedAt: '2026-11-16T00:00:00.000Z' } : r)) }), 'T7 (seed-2) is in the trash', 'New'],
    ['AC2', 'deleted', (env: { records: DatabasePrimer[] }) => ({ ...env, records: env.records.filter((r) => r.name !== 'T7') }), 'T7 (seed-2) is no longer in the database', 'New'],
  ] as const) {
    it(`BG-01M7DT7A ${ac} an import merging into a record another window ${what} between the two reads writes nothing and shows the rows again`, async () => {
      const storage = new RacingStorage();
      const db = seededStore(storage);
      const reports: string[] = [];
      const sheet = 'name,sequence,labels\nT7 copy,TAATACGACTCACTATAGGG,t7\nNew one,ACGTACGTACGTAAAA,\n';
      const d = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, sheet, { byClass: { sameOligo: 'merge' } });
      expect(d.classCell.get(2)).toBe('Same oligo, different name');
      // The dialog's save-time read (1) sees T7; the other window changes it before the store's own read (2).
      storage.arm(2, () => storage.map.set(PRIMER_DATABASE_KEY, JSON.stringify(change(JSON.parse(storage.map.get(PRIMER_DATABASE_KEY)!) as { records: DatabasePrimer[] }))));
      const writes = storage.writes;
      const failure = await d.run().then(() => null, (e: Error) => e.message);
      expect(failure).toBe(`Nothing was saved to the Primer Database: another window changed a record this import merges into. The change was not saved: ${reason}. The primer database is as it was. The rows are shown again with their classes now; review them and import again.`);
      const after = storage.map.get(PRIMER_DATABASE_KEY)!;
      expect(storage.writes, 'nothing written, not even the new row').toBe(writes);
      expect(reports).toEqual([]);
      const stored = records(storage);
      expect(stored.map((r) => r.name)).toEqual(what === 'trashed' ? ['M13F', 'T7', 'GC1'] : ['M13F', 'GC1']);
      if (what === 'trashed') expect([stored[1].trashedAt, stored[1].labels], 'T7 stays trashed and unmerged').toEqual(['2026-11-16T00:00:00.000Z', []]);
      // The dialog moves its review to the store as it stands, where row 2 no longer matches T7.
      expect(probe.reviewSets).toEqual([{ records: JSON.parse(after).records }]);
      probe.reviewBasis = probe.reviewSets[0] as { records: unknown[] };
      const again = render(<ImportPrimersToDatabaseDialog database={db} onSaved={(r) => reports.push(r)} onClose={() => undefined} />, sheet, { byClass: { sameOligo: 'merge' } });
      probe.reviewBasis = null;
      expect(again.classCell.get(2)).toBe(nowClass);
    });
  }

  // Wrong restores (BG-01M7DT7A): a ticked record trashed or deleted since the restore was shown
  // brought out of the trash or written back, or dropped without a word; the other ticked records
  // left unreplaced.
  it('BG-01M7DT7A AC3 Restore from Backup lists a ticked record that is trashed or gone as not replaced, with the reason, and replaces the rest', () => {
    const storage = new MemoryStorage();
    const db = seededStore(storage);
    const before = records(storage);
    const backup = JSON.stringify({ format: 'molbiocraft-primer-database-backup', schema: 1, exportedAt: '2026-11-16T00:00:00.000Z',
      records: before.map((r) => ({ ...r, description: `${r.name} from the backup` })) });
    const shown = db.importBackup(backup);
    expect(shown.ok && shown.value.conflicts.map((c) => c.id)).toEqual(['seed-1', 'seed-2', 'seed-3']);
    // Another window trashes T7 and deletes GC1 before the user presses Replace Chosen.
    const other = openPrimerDatabase({ storage });
    expect([other.trash('seed-3').ok, other.emptyTrash().ok, other.trash('seed-2').ok]).toEqual([true, true, true]);
    const trashedT7 = records(storage).find((r) => r.id === 'seed-2')!;
    const result = db.importBackup(backup, { replace: ['seed-1', 'seed-2', 'seed-3'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.replaced).toEqual(['seed-1']);
    expect(result.value.added).toEqual([]);
    expect(result.value.notReplaced).toEqual([
      { id: 'seed-2', reason: 'T7 (seed-2) is in the trash' },
      { id: 'seed-3', reason: 'GC1 (seed-3) is no longer in the database' },
    ]);
    const stored = records(storage);
    expect(stored.map((r) => [r.id, r.description])).toEqual([['seed-1', 'M13F from the backup'], ['seed-2', 'T7 promoter']]);
    expect(stored[1]).toEqual(trashedT7);
    // Asked for all-or-nothing, as the import asks, the same restore writes nothing.
    const writes = storage.writes;
    const strict = db.importBackup(backup, { replace: ['seed-1', 'seed-2'], allOrNothing: true });
    expect(strict.ok ? null : [strict.error.kind, strict.error.message]).toEqual(['stale', 'The change was not saved: T7 (seed-2) is in the trash. The primer database is as it was.']);
    expect(storage.writes).toBe(writes);
    // "Replace all" names every stored id: the trashed T7 stays trashed and is listed; GC1, gone from
    // the store, is not named by "all" and is restored as a new id, as a restore always adds one.
    const all = db.importBackup(backup, { replace: 'all' });
    expect(all.ok && [all.value.added, all.value.notReplaced]).toEqual([['seed-3'], [{ id: 'seed-2', reason: 'T7 (seed-2) is in the trash' }]]);
    expect(records(storage).find((r) => r.id === 'seed-2')).toEqual(trashedT7);
  });
});
