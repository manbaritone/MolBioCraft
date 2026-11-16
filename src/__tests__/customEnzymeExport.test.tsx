// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7GRYW: the Enzymes view's "Export table" CSV holds each custom enzyme row with what it is
 * (D0155). With no custom row exported the file is today's six columns, byte for byte; with one it
 * gains Source, Top Cut Offset, Bottom Cut Offset and Provenance. A cell is RFC 4180-quoted only
 * where it holds a comma, a double quote or a line break, and an enzyme the scan did not read
 * exports as "not scanned", never as 0 or null.
 *
 * The checks run in the real App over the live DOM (appHarness) and read the file the App handed
 * the browser (`app.downloads()`), never a mocked save, and the restriction engine is not replaced.
 */

import React, { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { parseDelimited } from '../core/metadataImport';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** The engine's core set over 100,000 bp scanned (read from the map's module once React DOM is loaded). */
let CORE_CATALOG_LEN = 0;
let HybridToolsAndHistoryStudio: typeof import('../components/HybridToolsAndHistoryStudio').HybridToolsAndHistoryStudio;
beforeAll(async () => {
  const app = await mountApp();
  app.unmount();
  CORE_CATALOG_LEN = (await import('../components/CircularPlasmidMap')).CORE_CATALOG_LEN;
  HybridToolsAndHistoryStudio = (await import('../components/HybridToolsAndHistoryStudio')).HybridToolsAndHistoryStudio;
});

// ─── The fixture (customEnzymeEverywhere.test.tsx's construct: A/C filler with planted sites) ───

const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};
const ADA_MOTIF = 'TGTTGTTGTA';
const MINE_MOTIF = 'TGGTGGTGA';
/** The built-in EcoRI's GAATTC twice, BamHI once, ADA_MOTIF once and MINE_MOTIF once. */
function construct(fill: number, extra = 0): string {
  return [
    filler(fill, 1), 'GAATTC', filler(fill, 2), ADA_MOTIF, filler(fill, 3), MINE_MOTIF, filler(fill, 4), 'GAATTC',
    filler(fill, 5), 'GGATCC', filler(fill + extra, 8),
  ].join('');
}
const SMALL = construct(300);

/**
 * Adaeze's own "EcoRI": another motif under the built-in's name, a negative top-strand offset (-3),
 * and a provenance holding a line break and no comma or quote (quoted for the break alone).
 */
const MINE: CustomEnzymeInput = {
  name: 'EcoRI', recognitionSeq: MINE_MOTIF, cutFwd: -3, cutRev: 2, methylationSensitivity: ['Dam'], provenance: 'Nwosu lab\nisolate 4',
};
/** A second definition whose name holds a comma and a double quote, and whose provenance a comma, a quote and a line break. */
const ODD: CustomEnzymeInput = {
  name: 'Ada, "Q"I', recognitionSeq: ADA_MOTIF, cutFwd: 4, cutRev: 6, provenance: 'Gift of Dr. "Obi", Lagos\nre-sequenced 2026',
};
/** A scanned custom noncutter: its motif holds a T and a G, so the A/C filler never holds it. */
const NONE: CustomEnzymeInput = { name: 'NoneI', recognitionSeq: 'GATTACAGATTAC', cutFwd: 6, cutRev: 6 };

const docOf = (id: string, sequence: string): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence, topology: 'circular', features: [], primers: [],
});

function seeded(inputs: CustomEnzymeInput[], storage: LiveStorage = memoryStorage()): LiveStorage {
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => '2026-01-01T00:00:00.000Z', newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function withDoc(storage: LiveStorage, doc: SequenceDocument, run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'sequence-view' });
    await app.settle();
    await run(app);
  } finally {
    app.unmount();
  }
}

/** Opens the Enzymes view and chooses the filter tab whose label passes `tab`. */
async function enzymesTab(app: AppHarness, scope: () => LiveElement, tab: (label: string) => boolean): Promise<void> {
  const t = scope().querySelectorAll('button.method-tab-btn').find((b) => tab(words(b.textContent)));
  if (!t) throw new Error(`no such tab: ${scope().querySelectorAll('button.method-tab-btn').map((b) => words(b.textContent)).join(' | ')}`);
  await app.click(t);
  await app.settle();
}
const ALL = (l: string) => l === 'All REBASE Commercial';
const UNIQUE = (l: string) => /^(Cutting once|Unique Cutters)/.test(l);

/**
 * Presses "Export table" and returns the file the App handed the browser, and the status line it then
 * shows. The text is the file's bytes decoded as they are: `SavedFile.text()` decodes as a browser
 * does and drops a byte-order mark, so the blob the App made is also kept here, to read a BOM too.
 */
async function exportTable(app: AppHarness, scope: () => LiveElement): Promise<{ filename: string; type: string; text: string; status: string }> {
  const before = app.downloads().length;
  const found = scope().querySelectorAll('button').filter((b) => words(b.textContent) === 'Export table');
  expect(found, 'one Export table button').toHaveLength(1);
  const made = new Map<string, Blob>();
  const harnessUrl = URL.createObjectURL;
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = harnessUrl(obj);
    if (obj instanceof Blob) made.set(url, obj);
    return url;
  };
  try {
    await app.click(found[0]);
    await app.settle();
  } finally {
    URL.createObjectURL = harnessUrl;
  }
  const saved = app.downloads();
  expect(saved.length, 'one file saved').toBe(before + 1);
  const file = saved[saved.length - 1];
  const blob = made.get(file.href);
  if (!blob) throw new Error(`the App saved "${file.filename}" from ${file.href}, not from a blob it made on Export table`);
  const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(await blob.arrayBuffer());
  expect(await file.text(), 'the harness reads the same file').toBe(text.replace(/^\uFEFF/, ''));
  const spans = (found[0].parentElement as LiveElement).querySelectorAll('span');
  return { filename: file.filename, type: file.type, text, status: words(spans[spans.length - 1]?.textContent) };
}

const HEADER6 = 'Name,Recognition Sequence,Effective Length (nt),Overhang,Methylation,# Cuts';
const HEADER10 = `${HEADER6},Source,Top Cut Offset,Bottom Cut Offset,Provenance`;
const lines = (text: string) => text.split('\n');

// ─── AC1 ───

/** The whole `unique` export of SMALL with nothing stored, captured at 2d3817d before any code change. */
const UNIQUE_AT_BASE = [
  "Name,Recognition Sequence,Effective Length (nt),Overhang,Methylation,# Cuts",
  "BamHI,GGATCC,6,5' Overhang,None,1",
  "DpnI,GATC,4,Blunt,None,1",
  "BstYI,RGATCY,6,5' Overhang,None,1",
  "PflMI,CCANNNNNTGG,6,3' Overhang,Dcm,1",
  "MboI,GATC,4,5' Overhang,Dam,1",
  "Sau3AI,GATC,4,5' Overhang,CpG,1",
  "DpnII,GATC,4,5' Overhang,Dam,1",
  "NlaIII,CATG,4,3' Overhang,None,1",
  "CviAII,CATG,4,5' Overhang,None,1",
  "FatI,CATG,4,5' Overhang,None,1",
].join('\n');

describe('US-01M7GRYW AC1: a catalogue-only export is unchanged from today\'s', () => {
  it('US-01M7GRYW AC1 with nothing stored the unique export equals the file captured at 2d3817d and the all export keeps its header, rows and row count', async () => {
    await withDoc(memoryStorage(), docOf('pPlain', SMALL), async (app) => {
      await app.menu('view:enzymes');
      await app.settle();
      await enzymesTab(app, () => app.canvas(), UNIQUE);
      const unique = await exportTable(app, () => app.canvas());
      expect(unique.filename).toBe('pPlain_Enzymes.csv');
      expect(unique.text).toBe(UNIQUE_AT_BASE);
      expect(unique.status).toBe('Exported 10 enzyme row(s) to CSV');

      await enzymesTab(app, () => app.canvas(), ALL);
      const all = await exportTable(app, () => app.canvas());
      const rows = lines(all.text);
      expect(rows[0]).toBe(HEADER6);
      expect(rows.length - 1).toBe(REBASE_ENZYMES.length);
      expect(rows).toContain("EcoRI,GAATTC,6,5' Overhang,CpG,2");
      expect(rows).toContain("BamHI,GGATCC,6,5' Overhang,None,1");
      expect(rows).toContain("BsaI-HFv2,GGTCTC,6,5' Overhang,Dcm;CpG,0");
      for (const text of [unique.text, all.text]) {
        expect(text.split(/[,\n]/)).not.toContain('null');
        expect(text).not.toContain('not scanned');
      }
      expect(all.status).toBe(`Exported ${REBASE_ENZYMES.length} enzyme row(s) to CSV`);
    });
  });

  it('US-01M7GRYW AC1 with definitions stored but no custom row exported the file is the same six columns and rows', async () => {
    // NoneI is scanned and cuts nowhere, so the unique filter leaves it out; the file is today's.
    await withDoc(seeded([NONE]), docOf('pPlain', SMALL), async (app) => {
      await app.menu('view:enzymes');
      await app.settle();
      await enzymesTab(app, () => app.canvas(), UNIQUE);
      const unique = await exportTable(app, () => app.canvas());
      expect(unique.text).toBe(UNIQUE_AT_BASE);
      expect(unique.status).toBe(`Exported ${lines(unique.text).length - 1} enzyme row(s) to CSV`);
    });
  });
});

// ─── AC2 ───

describe('US-01M7GRYW AC2: a custom row exports with its definition beside the built-in it is named like', () => {
  it('US-01M7GRYW AC2 the all export writes the extended header, the custom "EcoRI" and the built-in apart, and quotes only where needed', async () => {
    await withDoc(seeded([MINE, ODD]), docOf('pTwoEco', SMALL), async (app) => {
      await app.menu('view:enzymes');
      await app.settle();
      await enzymesTab(app, () => app.canvas(), ALL);
      const out = await exportTable(app, () => app.canvas());
      const rows = lines(out.text);
      expect(rows[0]).toBe(HEADER10);
      expect(out.text).toContain(`\nEcoRI (custom),${MINE_MOTIF},9,5' Overhang,Dam,1,custom,-3,2,"Nwosu lab\nisolate 4"\n`);
      expect(rows).toContain("EcoRI,GAATTC,6,5' Overhang,CpG,2,built-in,1,5,");
      expect(rows).toContain("BamHI,GGATCC,6,5' Overhang,None,1,built-in,1,5,");
      // The quoted row: its provenance's line break is inside the quotes, so it spans two lines of text.
      expect(out.text).toContain(`"Ada, ""Q""I (custom)",${ADA_MOTIF},10,5' Overhang,None,1,custom,4,6,"Gift of Dr. ""Obi"", Lagos\nre-sequenced 2026"`);
      // Read back with the App's own CSV parser: one record per enzyme, and the odd cells as stored.
      const sheet = parseDelimited(out.text);
      expect(sheet.headers).toEqual(HEADER10.split(','));
      expect(sheet.rows).toHaveLength(REBASE_ENZYMES.length + 2);
      const odd = sheet.rows.filter((r) => r[6] === 'custom' && r[1] === ADA_MOTIF);
      expect(odd).toHaveLength(1);
      expect([odd[0][0], odd[0][9]]).toEqual([`${ODD.name} (custom)`, ODD.provenance]);
      const mine = sheet.rows.filter((r) => r[0] === 'EcoRI (custom)');
      expect(mine).toEqual([['EcoRI (custom)', MINE_MOTIF, '9', "5' Overhang", 'Dam', '1', 'custom', '-3', '2', MINE.provenance]]);
      // A built-in's provenance cell is empty because the catalogue holds none (D0155).
      expect(REBASE_ENZYMES.filter((e) => e.provenance)).toEqual([]);
      expect(sheet.rows.every((r) => r.length === 10 && r[6] === (r[0].endsWith(' (custom)') ? 'custom' : 'built-in'))).toBe(true);
      expect(sheet.rows.filter((r) => r[6] === 'built-in').every((r) => r[9] === '')).toBe(true);
      expect(out.status).toBe(`Exported ${REBASE_ENZYMES.length + 2} enzyme row(s) to CSV`);
    });
  });
});

// ─── AC3 ───

describe('US-01M7GRYW AC3: an enzyme the scan did not read exports as not scanned', () => {
  it('US-01M7GRYW AC3 on a 120,000 bp document each non-core built-in exports as not scanned and each core one keeps its count', async () => {
    const big = docOf('pCore120k', construct(300, 118_000));
    expect(big.sequence.length).toBeGreaterThan(100_000);
    await withDoc(memoryStorage(), big, async (app) => {
      await app.menu('view:enzymes');
      await app.settle();
      await enzymesTab(app, () => app.canvas(), ALL);
      const out = await exportTable(app, () => app.canvas());
      const rows = lines(out.text);
      expect(rows[0]).toBe(HEADER6);
      expect(rows.slice(1).map((r) => r.split(',')[0])).toEqual(REBASE_ENZYMES.map((e) => e.name));
      expect(CORE_CATALOG_LEN).toBeGreaterThan(0);
      const last = rows.slice(1).map((r) => r.split(',').slice(5));
      expect(last.slice(0, CORE_CATALOG_LEN).every((c) => c.length === 1 && /^\d+$/.test(c[0]))).toBe(true);
      expect(last.slice(CORE_CATALOG_LEN).every((c) => c.length === 1 && c[0] === 'not scanned')).toBe(true);
      expect(rows).toContain("EcoRI,GAATTC,6,5' Overhang,CpG,2");
    });
  });

  it('US-01M7GRYW AC3 an unread custom motif exports as not scanned and a scanned custom noncutter as 0', async () => {
    // customEnzymeEverywhere.test.tsx:343-348's list: a motif the scan cannot read never reaches the
    // store, so the view is handed the list, drawn in the live page beside a mounted App.
    const unreadable: RestrictionEnzyme = {
      id: 'custom:bad-1', source: 'custom', name: 'BadI', recognitionSeq: 'GAAXTC', cutFwd: 1, cutRev: 5, isTypeIIS: false,
      suppliers: [], methylationSensitivity: [], bufferNEB: '', tempC: 37, provenance: '', notes: '',
    };
    const noneEnzyme: RestrictionEnzyme = { ...unreadable, id: 'custom:none-1', name: 'NoneI', recognitionSeq: NONE.recognitionSeq, cutFwd: 6, cutRev: 6 };
    const doc = docOf('pAda', SMALL);
    await withDoc(memoryStorage(), doc, async (app) => {
      const { createRoot } = await import('react-dom/client');
      const host = app.doc.createElement('div');
      app.doc.body.appendChild(host);
      const root = createRoot(host as unknown as Element);
      try {
        await act(async () => {
          root.render(<HybridToolsAndHistoryStudio doc={doc} allDocuments={[doc]} initialSubTab="enzymes-view" enzymes={[...REBASE_ENZYMES, noneEnzyme, unreadable]} />);
        });
        await enzymesTab(app, () => host, ALL);
        const out = await exportTable(app, () => host);
        const rows = lines(out.text);
        expect(rows[0]).toBe(HEADER10);
        expect(rows.slice(-2)).toEqual([
          'NoneI (custom),GATTACAGATTAC,13,Blunt,None,0,custom,6,6,',
          "BadI (custom),GAAXTC,6,5' Overhang,None,not scanned,custom,1,5,",
        ]);
        expect(out.text.split(/[,\n]/)).not.toContain('null');
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    });
  });
});
