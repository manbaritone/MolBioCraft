// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6VF33: back-translation keeps every residue, and every translation the app shows reads the
 * engine, so an ambiguous codon is B, Z or J as Biopython reads it.
 *
 * Wrong implementations, and the case that catches each:
 * - AC4: the ambiguous mode's silent NNN for a residue with no degenerate codon (U would be NNN, not
 *   TGA), the most-frequent mode dropping the engine's warnings (no Warnings: block), or an internal
 *   stop in the ambiguous mode written as the table's TRR, which also reads TGG (Trp);
 * - AC5: the frame line's own 64-codon table (RAY, SAR and MTY would be X);
 * - AC6: the Translation Statistics loop's own 64-codon table (GCN would be X and weigh as X), or
 *   an X counted but never named on the panel;
 * - AC7: the alignment translation's own TCAG table (RAY would be X), a TS copy of the B/Z/J rule
 *   (the engine is asked, as the spy on its one sync entry point shows), and three-letter codes
 *   missing for U, O, B, Z and J.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { runBackTranslate } from '../core/operationRunners';
import { threeLetterCode, translateAlignedRow, translateCodon } from '../core/alignmentViewModel';
import { analyzeProteinSequence } from '../core/bioEngine';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import { mountApp, type AppHarness } from './appHarness';

vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return { ...actual, invokeRustBioSync: vi.fn(actual.invokeRustBioSync) };
});

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'Protein', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z', features: [], primers: [], history: [],
};
const protein = (sequence: string): SequenceDocument => ({ ...BLANK, id: `p-${sequence}`, name: 'p', accession: 'p', sequence });

const U_SENTENCE =
  'Residue 3 is selenocysteine (U), written as TGA: TGA reads as Sec only with a SECIS element downstream, and as a stop without one.';
const DEGENERATE: [string, string, string][] = [
  ['B', 'RAY', 'Residue 3 (B: D or N) has no single codon: written as the degenerate codon RAY.'],
  ['Z', 'SAR', 'Residue 3 (Z: E or Q) has no single codon: written as the degenerate codon SAR.'],
  ['J', 'MTH', 'Residue 3 (J: I or L) has no single codon: written as the degenerate codon MTH.'],
  ['X', 'NNN', 'Residue 3 (X) has no codon: written as NNN.'],
];

/** The warning lines of a document's Notes `Warnings:` block. */
function warningBlock(doc: SequenceDocument): string[] {
  const notes = String(doc.docMetadata?.Notes ?? '');
  const at = notes.indexOf('Warnings:\n');
  expect(at, `a Warnings: block in ${JSON.stringify(notes)}`).toBeGreaterThanOrEqual(0);
  return notes.slice(at + 'Warnings:\n'.length).split('\n').filter(Boolean);
}

describe('US-01M6VF33 AC4 back-translation writes every residue, with the engine codon and warning', () => {
  it('US-01M6VF33 AC4 most-frequent and ambiguous modes keep U, and the ambiguous mode writes B, Z, J and X', () => {
    const likely = runBackTranslate([protein('MKUW')], { mode: 'likely', host: 'ecoli' }, { sourceLabel: 'x' }).created[0];
    expect(likely.sequence).toBe('ATGAAATGATGG');
    expect(likely.features[0].qualifiers?.translation).toBe('MKUW');
    expect(warningBlock(likely)).toEqual([`- ${U_SENTENCE}`]);

    const ambiguous = runBackTranslate([protein('MKUW')], { mode: 'ambiguous', host: 'ecoli' }, { sourceLabel: 'x' }).created[0];
    expect(ambiguous.sequence).toBe('ATGAARTGATGG');
    expect(ambiguous.features[0].qualifiers?.translation).toBe('MKUW');
    expect(warningBlock(ambiguous)).toEqual([`- ${U_SENTENCE}`]);

    for (const [aa, codon, sentence] of DEGENERATE) {
      const doc = runBackTranslate([protein(`MK${aa}W`)], { mode: 'ambiguous', host: 'ecoli' }, { sourceLabel: 'x' }).created[0];
      expect(doc.sequence, aa).toBe(`ATGAAR${codon}TGG`);
      expect(warningBlock(doc), aa).toEqual([`- ${sentence}`]);
    }

    // an internal stop in the ambiguous mode is the engine's stop, warned of; a final one stays the table's
    const stop = runBackTranslate([protein('MK*W')], { mode: 'ambiguous', host: 'ecoli' }, { sourceLabel: 'x' }).created[0];
    expect(stop.sequence).toBe('ATGAARTAATGG');
    expect(warningBlock(stop)).toEqual(['- Residue 3 is a stop (*): written as TAA, so the CDS ends there.']);
    const ended = runBackTranslate([protein('MKW*')], { mode: 'ambiguous', host: 'ecoli' }, { sourceLabel: 'x' }).created[0];
    expect(ended.sequence).toBe('ATGAARTGGTRR');
    expect(ended.docMetadata?.Notes).toBeUndefined();

    // a protein of the 20 alone owes no warning
    const plain = runBackTranslate([protein('MKW')], { mode: 'likely', host: 'ecoli' }, { sourceLabel: 'x' }).created[0];
    expect(plain.sequence).toBe('ATGAAATGG');
    expect(plain.docMetadata?.Notes).toBeUndefined();
  });
});

const DISPLAY = {
  showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
  showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
};

async function showDna(app: AppHarness, id: string, sequence: string, cdsEnd?: number): Promise<void> {
  const dna: SequenceDocument = {
    ...BLANK, id, name: id, accession: id, moleculeType: 'DNA', folder: 'Genomes/Bacteria', sequence,
    features: cdsEnd ? [{ id: `${id}-cds`, name: 'VF33', type: 'CDS', start: 1, end: cdsEnd, strand: 1, color: '#d93025' }] : [],
  };
  await app.restoreSession({
    documents: [dna], activeDocId: dna.id, viewerTab: 'sequence-view',
    workspace: { displaySettings: DISPLAY } as never,
  });
  await app.settle();
}

describe('US-01M6VF33 AC5 the Translate Frames line reads the engine', () => {
  it('US-01M6VF33 AC5 shows M, B, Z, J and * for ATGRAYSARMTYTAA in frame +1', async () => {
    const app = await mountApp();
    try {
      await showDna(app, 'vf33-frames', 'ATGRAYSARMTYTAA');
      const lines = app.all('.aa-frame-line').filter((l) => words(l.querySelectorAll('.coord-gutter')[0]?.textContent) === 'Frame +1');
      expect(lines.length, 'the sequence view shows frame +1').toBeGreaterThan(0);
      const track = lines[0].querySelectorAll('.aa-track')[0]?.textContent ?? '';
      expect([1, 4, 7, 10, 13].map((i) => track[i])).toEqual(['M', 'B', 'Z', 'J', '*']);
      expect(track.replace(/\s/g, '')).toBe('MBZJ*');
    } finally {
      app.unmount();
    }
  });
});

describe('US-01M6VF33 AC6 Translation Statistics read the engine', () => {
  it('US-01M6VF33 AC6 counts GCN as A, weighs MAA, and names a codon counted as X', async () => {
    const app = await mountApp();
    try {
      const panelOf = async (id: string, cds: string) => {
        await showDna(app, id, `${cds}GGATCCAAGCTTGAATTC`, cds.length);
        const panels = app.all('details').filter((d) => words(d.querySelectorAll('summary')[0]?.textContent).startsWith('Translation Statistics'));
        expect(panels.length, 'the App shows Translation Statistics').toBeGreaterThan(0);
        const panel = panels[0];
        const freq = panel.querySelectorAll('div').find((d) => words(d.textContent).startsWith('20 Amino Acid Frequencies:'));
        expect(freq, 'the frequency line').toBeDefined();
        const counts = Object.fromEntries(
          words(freq!.textContent).replace('20 Amino Acid Frequencies:', '').split('·').map((kv) => kv.trim().split(':')).map(([k, v]) => [k, Number(v)]),
        );
        const kv = Object.fromEntries(panel.querySelectorAll('.stat-kv').map((row) => [
          words(row.querySelectorAll('span')[0]?.textContent), words(row.querySelectorAll('strong')[0]?.textContent),
        ]));
        const notes = panel.querySelectorAll('p.mbc-summary-note').map((p) => words(p.textContent));
        return { counts, kv, notes };
      };
      const kda = (p: string) => `${analyzeProteinSequence(p, false, 9).molecularWeightKda.toFixed(2)} kDa`;
      expect(kda('MAA'), 'fixture: MAA and MXA weigh differently').not.toBe(kda('MXA'));

      const gcn = await panelOf('vf33-gcn', 'ATGGCNGCTTAA');
      expect([gcn.counts.A, gcn.counts.M]).toEqual([2, 1]);
      expect(gcn.counts.X, 'no X').toBeUndefined();
      expect(gcn.kv['Molecular weight (mean):']).toBe(kda('MAA'));
      expect(gcn.notes.filter((n) => n.includes('counted as X'))).toEqual([]);

      const nnn = await panelOf('vf33-nnn', 'ATGNNNGCTTAA');
      expect([nnn.counts.X, nnn.counts.A, nnn.counts.M]).toEqual([1, 1, 1]);
      expect(nnn.notes).toContain('1 codon could not be read as one amino acid and is counted as X.');
      expect(nnn.kv['Molecular weight (mean):']).toBe(kda('MXA'));

      const two = await panelOf('vf33-two', 'ATGNNNTANGCTTAA');
      expect(two.counts.X).toBe(2);
      expect(two.notes).toContain('2 codons could not be read as one amino acid and are counted as X.');
    } finally {
      app.unmount();
    }
  });
});

describe('US-01M6VF33 AC7 the alignment translation reads the engine', () => {
  it('US-01M6VF33 AC7 translates RAY and SAR as B and Z across a gap, asks the engine, and names U, O, B, Z and J', () => {
    const tr = translateAlignedRow('ATG---RAYSAR', 0, 'Standard (1)');
    expect([tr.aaAtCol[1], tr.aaAtCol[7], tr.aaAtCol[10]]).toEqual(['M', 'B', 'Z']);
    expect([tr.aaIndexAtCol[1], tr.aaIndexAtCol[7], tr.aaIndexAtCol[10]]).toEqual([1, 2, 3]);
    expect(tr.aaAtCol.filter(Boolean)).toHaveLength(3);

    const spy = vi.mocked(invokeRustBioSync);
    spy.mockClear();
    expect(translateCodon('RAY', 'Standard (1)')).toBe('B');
    expect(translateCodon('MTY', 'Bacterial / Plastid (11)')).toBe('J');
    expect(translateCodon('MTY', 'Yeast Mitochondrial (3)')).toBe('X');
    expect(translateCodon('CTN', 'Standard (1)')).toBe('L');
    expect(translateCodon('TGA', 'Vertebrate Mitochondrial')).toBe('W');
    const asked = spy.mock.calls.filter(([op]) => op === 'translate_sequence').map(([, p]) => p as { dna: string; tableId: number });
    expect(asked.some((p) => p.dna === 'MTY' && p.tableId === 3), `the engine read MTY under table 3: ${JSON.stringify(asked)}`).toBe(true);

    expect(['U', 'O', 'B', 'Z', 'J', 'X', '*'].map(threeLetterCode)).toEqual(['Sec', 'Pyl', 'Asx', 'Glx', 'Xle', 'Xaa', 'Ter']);
    expect(['u', 'b'].map(threeLetterCode)).toEqual(['Sec', 'Asx']);
  });
});
