// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6VFRY AC4-AC6: a FASTA file dropped on the mounted App opens each record as the molecule
 * the one alphabet rule calls it, and the record's Notes (the D0005 `Warnings:` block the Info tab
 * shows) say what the rule doubts and what the reader left out or changed. Each record is read
 * twice: from the session the App itself saves, and from the Info tab of its document.
 *
 * Wrong implementations, and the case that catches each:
 * - the old reader (B, D, H, V and I counted as protein letters): `deg` and `ino` open as Protein;
 * - a reader that reads only the first 4,096 bytes: `long` (5,000 bases, then protein) opens as DNA;
 * - the uncertain sentence missing, or written for certain calls: `deg`, `ino`, `mix` have it,
 *   `pep`, `gappy`, `masked` and `lower` do not;
 * - a protein's final stop warned, or kept as a residue: `pep` opens as 'MKV' with no Notes;
 * - gaps, stops or foreign letters dropped without a word: `gappy` and `prot` name each, with
 *   counts and positions built from the record (one more gap gives '4 gap characters');
 * - lower case flagged for any lower-case letter: `lower` is all lower case and has no Notes.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function drop(app: AppHarness, name: string, text: string): Promise<void> {
  const React = await import('react');
  const root = app.one('.mbc-workbench', 'workbench root');
  const file = new File([new TextEncoder().encode(text)], name);
  const dataTransfer = { files: [file], types: ['Files'], items: [], dropEffect: 'copy', effectAllowed: 'all' };
  await React.act(async () => { dispatchLiveEvent(root, 'drop', { dataTransfer }); });
  await app.settle();
}

/** The documents of the session the App saves, by name. */
async function savedDocuments(app: AppHarness): Promise<Map<string, SequenceDocument>> {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files).toHaveLength(1);
  const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
  const { envelope } = parseMbcWorkbench(await files[0].text());
  return new Map(envelope.documents.map((d) => [d.name, d as SequenceDocument]));
}

/** What the Info tab shows for the document whose tab is titled `name`: its fields and its Notes. */
async function infoTab(app: AppHarness, name: string): Promise<{ molecule: string; length: string; notes: string }> {
  const tab = app.all('button.mbc-doc-tab-trigger').filter((b) => words(b.querySelectorAll('.mbc-doc-tab-title')[0]?.textContent) === name);
  expect(tab, `the document tab of ${name}`).toHaveLength(1);
  await app.click(tab[0]);
  await app.clickTab('document-info');
  const fields = Object.fromEntries(app.all('.mbc-document-info dl div').map((row) => [
    words(row.querySelector('dt')?.textContent), words(row.querySelector('dd')?.textContent),
  ]));
  expect(fields.Name, 'the Info tab shows the document clicked').toBe(name);
  const box = app.one('textarea#document-notes', 'the Notes box');
  return { molecule: fields.Molecule, length: fields['Sequence length'], notes: (box as unknown as { value: string }).value };
}

interface Expected { molecule: 'DNA' | 'RNA' | 'Protein'; sequence: string; notes: string | undefined }

async function expectRecords(app: AppHarness, expected: Record<string, Expected>): Promise<void> {
  const saved = await savedDocuments(app);
  for (const [name, want] of Object.entries(expected)) {
    const doc = saved.get(name);
    expect(doc, `${name} opened`).toBeDefined();
    expect(doc!.moleculeType, `${name} molecule`).toBe(want.molecule);
    expect(doc!.sequence, `${name} sequence`).toBe(want.sequence);
    expect(doc!.docMetadata?.Notes, `${name} Notes`).toBe(want.notes);
    const info = await infoTab(app, name);
    expect(info.molecule, `${name} on the Info tab`).toBe(want.molecule);
    expect(info.length, `${name} length on the Info tab`).toBe(`${want.sequence.length.toLocaleString()} ${want.molecule === 'Protein' ? 'aa' : want.molecule === 'RNA' ? 'nt' : 'bp'}`);
    expect(info.notes, `${name} Notes on the Info tab`).toBe(want.notes ?? '');
  }
}

const doubt = (count: string, letters: string) =>
  `Warnings:\n- Read as DNA, though ${count} letters (${letters}) are also amino-acid letters: set the molecule type to Protein if this is a protein.\n`;

describe('FASTA import by the one alphabet rule (US-01M6VFRY)', () => {
  it('US-01M6VFRY AC4 opens each record as the rule calls it, with the sentence an uncertain call owes', async () => {
    const app = await mountApp();
    try {
      await drop(app, 'alphabet_cases.fasta', '>deg\nACGTBDHVACGTACGT\n>ino\nGCIGCIACIGGNAAYGG\n>mix\nACGTXXXACGT\n>pep\nMKV*\n');
      await expectRecords(app, {
        deg: { molecule: 'DNA', sequence: 'ACGTBDHVACGTACGT', notes: doubt('4 of 16', 'B, D, H, V') },
        ino: { molecule: 'DNA', sequence: 'GCIGCIACIGGNAAYGG', notes: doubt('4 of 17', 'I, Y') },
        mix: {
          molecule: 'Protein', sequence: 'ACGTXXXACGT',
          notes: 'Warnings:\n- Read as protein, though 8 of 11 letters are A, C, G, T, U or N: set the molecule type to DNA or RNA if this is a nucleotide sequence.\n',
        },
        pep: { molecule: 'Protein', sequence: 'MKV', notes: undefined },
      });

      // The whole record is read: 5,000 bases and then 3,000 protein letters is not DNA.
      const longProtein = `${'ACGT'.repeat(1250)}${'LEQF'.repeat(750)}`;
      const longDna = `${'ACGT'.repeat(1250)}${'GCIRY'.repeat(10)}`;
      await drop(app, 'long_cases.fasta', `>long\n${longProtein}\n>longdna\n${longDna}\n`);
      const saved = await savedDocuments(app);
      expect(saved.get('long')?.moleculeType).toBe('Protein');
      expect(saved.get('long')?.docMetadata?.Notes).toBe(
        'Warnings:\n- Read as protein, though 5000 of 8000 letters are A, C, G, T, U or N: set the molecule type to DNA or RNA if this is a nucleotide sequence.\n',
      );
      expect(saved.get('longdna')?.moleculeType).toBe('DNA');
      expect(saved.get('longdna')?.docMetadata?.Notes, 'a certain call gets no classifier sentence').toBeUndefined();
    } finally {
      app.unmount();
    }
  });

  it('US-01M6VFRY AC5 names the foreign letters it kept and the gaps and internal stops it left out', async () => {
    const app = await mountApp();
    try {
      await drop(app, 'gaps_and_stops.fasta', '>gappy\nACGTA-CGTAC.GTACG~TACGTXX\n>prot\nMKWVUTFIS*LLFX-XX*\n>gappier\nACGTA-CGTAC.GTACG~TACGTXX-\n');
      await expectRecords(app, {
        gappy: {
          molecule: 'DNA', sequence: 'ACGTACGTACGTACGTACGTXX',
          notes: 'Warnings:\n- 2 letters are not nucleotide codes and were kept: X at 21 and 22.\n- 3 gap characters (-, ., ~) were left out; positions count the letters kept.\n',
        },
        prot: {
          molecule: 'Protein', sequence: 'MKWVUTFISLLFXXX',
          notes: 'Warnings:\n- 1 internal stop (*) after residue 9 was left out, so the residues on either side read as one chain.\n- 1 gap character (-) was left out; positions count the letters kept.\n',
        },
        gappier: {
          molecule: 'DNA', sequence: 'ACGTACGTACGTACGTACGTXX',
          notes: 'Warnings:\n- 2 letters are not nucleotide codes and were kept: X at 21 and 22.\n- 4 gap characters (-, ., ~) were left out; positions count the letters kept.\n',
        },
      });

      // At most ten positions are listed, then how many more.
      await drop(app, 'many_foreign.fasta', `>manyx\n${'ACGT'.repeat(30)}${'X'.repeat(12)}\n`);
      const saved = await savedDocuments(app);
      expect(saved.get('manyx')?.docMetadata?.Notes).toBe(
        'Warnings:\n- 12 letters are not nucleotide codes and were kept: X at 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, and 2 more.\n',
      );
    } finally {
      app.unmount();
    }
  });

  it('US-01M6VFRY AC6 says when a mixed-case record loses its soft-mask, and not when it is all lower case', async () => {
    const app = await mountApp();
    try {
      await drop(app, 'masking.fasta', '>masked\nACGTacgtACGT\n>lower\nacgtacgt\n');
      await expectRecords(app, {
        masked: {
          molecule: 'DNA', sequence: 'ACGTACGTACGT',
          notes: 'Warnings:\n- 4 lower-case (soft-masked) letters were read as upper case; the soft-mask is not kept.\n',
        },
        lower: { molecule: 'DNA', sequence: 'ACGTACGT', notes: undefined },
      });
    } finally {
      app.unmount();
    }
  });
});
