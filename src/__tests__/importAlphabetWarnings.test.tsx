// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7NKEM AC3-AC7: every way a sequence comes into the mounted App, not only FASTA, says in
 * the document's Notes (the D0005 `Warnings:` block the Info tab shows) what it left out or could
 * not read, and the alignment Text view says when its NEXUS text will be refused.
 *
 * Wrong implementations, and the case that catches each:
 * - the GenBank reader dropping gaps silently, or never comparing LOCUS with ORIGIN: short.gb
 *   must carry both sentences, and still open (the banner says so);
 * - the New Sequence dialog keeping `*` in a DNA sequence (its old filter) or dropping `-`
 *   without a word: the DNA paste must save 16 letters and show the three sentences before Save;
 *   a protein's internal stop named as a DNA stop character: the Protein paste names it as an
 *   internal stop; a Notes block written for every new document: the A/C/G/T paste has none;
 * - the not-an-alignment sentence on every gapped file: the equal-length file opens as one
 *   alignment without it; written before the record's own gaps: it is compared whole, last;
 * - NEXUS foreign letters counted per position, or by a letter set of fileParsers.ts's own: the
 *   Notes count X (2), the clean matrix (R, Y, N, ?, -) gets none, and the reader asks the engine;
 * - the NEXUS warning shown for every alignment, or the text rewritten to hide X and `*`: the
 *   clean alignment shows none, and the text keeps X and `*` as the rows hold them;
 * - RNA FASTA measured in bp: the engine's export ends '| 10 nt'.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent } from './liveDom';
import { exportToFasta, parseFasta } from '../core/fileParsers';
import { formatAlignmentText } from '../core/alignmentExport';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const AC1_DNA = [
  '2 letters are not nucleotide codes and were kept: X at 15 and J at 16.',
  '1 gap character (-) was left out; positions count the letters kept.',
  '1 stop character (*) was left out; positions count the letters kept.',
];
const AC1_STOP = '1 internal stop (*) after residue 3 was left out, so the residues on either side read as one chain.';
const block = (lines: string[]) => `Warnings:\n${lines.map((l) => `- ${l}`).join('\n')}\n`;

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

async function drop(app: AppHarness, name: string, text: string): Promise<void> {
  const React = await import('react');
  const root = app.one('.mbc-workbench', 'workbench root');
  const file = new File([new TextEncoder().encode(text)], name);
  const dataTransfer = { files: [file], types: ['Files'], items: [], dropEffect: 'copy', effectAllowed: 'all' };
  await React.act(async () => { dispatchLiveEvent(root, 'drop', { dataTransfer }); });
  await app.settle();
}

/** The documents of the session the App saves, in its order. */
async function savedDocuments(app: AppHarness): Promise<SequenceDocument[]> {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files).toHaveLength(1);
  const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
  const { envelope } = parseMbcWorkbench(await files[0].text());
  return envelope.documents as SequenceDocument[];
}

async function savedNamed(app: AppHarness, name: string): Promise<SequenceDocument> {
  const found = (await savedDocuments(app)).filter((d) => d.name === name);
  expect(found, `one document named ${name}`).toHaveLength(1);
  return found[0];
}

/** The Info tab of the document whose tab is titled `name`: its fields and its Notes. */
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

const banner = (app: AppHarness) => app.all('.statusbar-toast-text').map((e) => words(e.textContent));

const GB_20 = 'LOCUS       short                     20 bp    DNA     linear   SYN 01-JAN-2026\nDEFINITION  short.\nFEATURES             Location/Qualifiers\nORIGIN\n        1 acgt-acgt- acgt\n//\n';

describe('US-01M7NKEM AC3 GenBank import', () => {
  it('US-01M7NKEM AC3 opens a short GenBank record with its length and gap sentences in Notes', async () => {
    await withApp(async (app) => {
      await drop(app, 'short.gb', GB_20);
      const want = 'Warnings:\n- The LOCUS line declares 20 bp but ORIGIN holds 12 bases.\n- 2 gap characters (-) were left out; positions count the letters kept.\n';
      // The banner the App shows for a GenBank file it opened, unchanged by the Notes.
      expect(banner(app), 'the banner says the file was opened').toContain('Created "short" (12 bp)');
      const doc = await savedNamed(app, 'short');
      expect([doc.moleculeType, doc.sequence, doc.docMetadata?.Notes]).toEqual(['DNA', 'ACGTACGTACGT', want]);
      expect(await infoTab(app, 'short')).toEqual({ molecule: 'DNA', length: '12 bp', notes: want });
    });
  });
});

/** Opens New Sequence, chooses `type` when given, names and pastes the text; returns the dialog's warnings. */
async function newSequence(app: AppHarness, name: string, text: string, type?: 'Protein'): Promise<string[]> {
  await app.menu('file:new-sequence');
  await app.settle();
  if (type) {
    await app.click(app.one('#mbc-newseq-type-btn', 'the Sequence Type button'));
    const option = app.all('li.newseq-type-option').filter((li) => words(li.querySelector('strong')?.textContent) === type);
    expect(option, `the ${type} option`).toHaveLength(1);
    await app.click(option[0]);
  }
  await app.input(app.one('#mbc-newseq-name', 'the Name field'), name);
  await app.input(app.one('#mbc-newseq-seq-input', 'the sequence box'), text);
  await app.settle();
  const shown = app.all('[aria-label="Sequence warnings"] p').map((p) => words(p.textContent));
  await app.click(app.one('.newseq-btn-ok', 'OK'));
  await app.settle();
  return shown;
}

describe('US-01M7NKEM AC4 New Sequence', () => {
  it('US-01M7NKEM AC4 shows and keeps what the pasted text left out or could not read', async () => {
    await withApp(async (app) => {
      expect(await newSequence(app, 'pasted_dna', 'ACGT-ACGT*NNACGTXJ'), 'the dialog warns before Save').toEqual(AC1_DNA);
      expect(await newSequence(app, 'pasted_protein', 'MKV*W', 'Protein'), 'the dialog warns before Save').toEqual([AC1_STOP]);
      expect(await newSequence(app, 'pasted_clean', 'ACGTACGTAC'), 'a clean paste is not warned').toEqual([]);
      const saved = await savedDocuments(app);
      const by = (n: string) => saved.find((d) => d.name === n);
      expect([by('pasted_dna')?.moleculeType, by('pasted_dna')?.sequence, by('pasted_dna')?.docMetadata?.Notes])
        .toEqual(['DNA', 'ACGTACGTNNACGTXJ', block(AC1_DNA)]);
      expect([by('pasted_protein')?.moleculeType, by('pasted_protein')?.sequence, by('pasted_protein')?.docMetadata?.Notes])
        .toEqual(['Protein', 'MKVW', block([AC1_STOP])]);
      expect(by('pasted_clean')?.sequence).toBe('ACGTACGTAC');
      expect(by('pasted_clean')?.docMetadata?.Notes).toBeUndefined();
    });
  });
});

describe('US-01M7NKEM AC5 gapped FASTA of unequal lengths', () => {
  it('US-01M7NKEM AC5 says why gapped records of different lengths open apart', async () => {
    await withApp(async (app) => {
      await drop(app, 'two.fasta', '>a\nACGT-ACGTAC\n>b\nACGTACG-T\n');
      const why = "The file's records hold gaps but are not all the same length (11, 9), so they open as separate sequences, not as an alignment.";
      const gap = '1 gap character (-) was left out; positions count the letters kept.';
      const a = await savedNamed(app, 'a');
      const b = await savedNamed(app, 'b');
      expect([a.moleculeType, a.sequence, a.docMetadata?.Notes]).toEqual(['DNA', 'ACGTACGTAC', block([gap, why])]);
      expect([b.moleculeType, b.sequence, b.docMetadata?.Notes]).toEqual(['DNA', 'ACGTACGT', block([gap, why])]);
      expect((await infoTab(app, 'b')).notes).toBe(block([gap, why]));

      await drop(app, 'even.fasta', '>c\nACGT-ACGT\n>d\nACGTAC-GT\n');
      const aligned = (await savedDocuments(app)).filter((d) => d.documentKind === 'alignment');
      expect(aligned, 'the equal-length gapped file opens as one alignment').toHaveLength(1);
      expect(aligned[0].alignmentMeta?.sequences?.map((s) => s.sequence)).toEqual(['ACGT-ACGT', 'ACGTAC-GT']);
      expect(String(aligned[0].docMetadata?.Notes ?? '')).not.toContain('not all the same length');
    });
  });
});

const nexus = (t2: string) => `#NEXUS\nBEGIN DATA;\n  DIMENSIONS NTAX=2 NCHAR=8;\n  FORMAT DATATYPE=DNA MISSING=? GAP=-;\n  MATRIX\n  t1 ACGTACGT\n  t2 ${t2}\n  ;\nEND;\n`;

describe('US-01M7NKEM AC6 NEXUS import', () => {
  it('US-01M7NKEM AC6 counts the matrix letters that are not nucleotide codes, by the engine', async () => {
    await withApp(async (app) => {
      await drop(app, 'x.nex', nexus('ACXTAXGT'));
      await drop(app, 'clean.nex', nexus('ACRT?-NY'));
      const x = await savedNamed(app, 'x');
      expect(x.documentKind).toBe('alignment');
      expect(x.alignmentMeta?.sequences?.map((s) => s.sequence)).toEqual(['ACGTACGT', 'ACXTAXGT']);
      expect(x.docMetadata?.Notes).toBe('Warnings:\n- 2 letters in the matrix are not nucleotide codes and were kept: X (2).\n');
      const clean = await savedNamed(app, 'clean');
      expect(clean.documentKind).toBe('alignment');
      expect(clean.docMetadata?.Notes).toBeUndefined();
    });
    // The count is the engine's (check_sequence_alphabet), not a letter set of the reader's own.
    const reader = readFileSync(new URL('../core/fileParsers.ts', import.meta.url), 'utf8');
    const warning = reader.slice(reader.indexOf('function nexusForeignLetterWarning'), reader.indexOf('export function nexusToAlignmentDocument'));
    expect(warning).toContain('checkSequenceAlphabet(nexus.sequences');
    expect(warning).not.toMatch(/\[[^\]]*ACGT/);
  });
});

const ROW = (id: string, sequence: string) => ({ id, name: id, sequence });
const alignment = (id: string, rows: string[]): SequenceDocument => ({
  id, name: id, accession: '', description: 'An alignment built in the test', sequence: rows[0], moleculeType: 'DNA', topology: 'linear',
  folder: 'Alignments', createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z', features: [], primers: [], history: [],
  documentKind: 'alignment',
  alignmentMeta: { isAligned: true, sequenceCount: rows.length, sequences: rows.map((s, i) => ROW(`${id}_${i + 1}`, s)) },
} as SequenceDocument);

async function nexusTextView(app: AppHarness, doc: SequenceDocument): Promise<{ text: string; warnings: string[] }> {
  await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'text-view' });
  const select = app.doc.body.querySelectorAll('select').filter((s) => s.options.some((o) => o.getAttribute('value') === 'NEXUS'));
  expect(select, 'one Format select').toHaveLength(1);
  await app.change(select[0], 'NEXUS');
  await app.settle();
  const pre = app.canvas().querySelectorAll('.mbc-aln-textview-scroll pre');
  expect(pre, 'the alignment text').toHaveLength(1);
  return {
    text: pre[0].textContent ?? '',
    warnings: app.all('[aria-label="NEXUS text warnings"] p').map((p) => words(p.textContent)),
  };
}

describe('US-01M7NKEM AC7 exports', () => {
  it('US-01M7NKEM AC7 measures RNA FASTA in nt, and warns of NEXUS cells strict readers refuse', async () => {
    const header = (fasta: string) => exportToFasta(parseFasta(fasta, 'x')[0]).split('\n')[0];
    expect(header('>r\nACGUACGUAC\n')).toMatch(/\| 10 nt$/);
    expect(header('>d\nACGTACGTAC\n')).toMatch(/\| 10 bp$/);
    expect(header('>p\nMKVLWMKVLW\n')).toMatch(/\| 10 aa$/);

    await withApp(async (app) => {
      const rows = ['ACGTXCGT', 'ACXTAC*T', 'ACGTACGT'];
      const shown = await nexusTextView(app, alignment('foreign_aln', rows));
      expect(shown.warnings).toEqual(['This NEXUS text declares DATATYPE=DNA, but 3 cells hold X or *, which strict NEXUS readers such as MrBayes refuse.']);
      const unchanged = formatAlignmentText(rows.map((s, i) => ROW(`foreign_aln_${i + 1}`, s)), 'NEXUS', 'DNA');
      expect(unchanged, 'fixture: the NEXUS text holds the cells as written').toContain('foreign_aln_2 ACXTAC*T');
      expect(shown.text.trim()).toBe(unchanged.trim());
      // Only NEXUS declares a DATATYPE: the same rows as FASTA are not warned of.
      const select = app.doc.body.querySelectorAll('select').filter((s) => s.options.some((o) => o.getAttribute('value') === 'NEXUS'));
      await app.change(select[0], 'FASTA');
      await app.settle();
      expect(app.canvas().querySelectorAll('.mbc-aln-textview-scroll pre')[0]?.textContent, 'fixture: FASTA is shown').toContain('>foreign_aln_2');
      expect(app.all('[aria-label="NEXUS text warnings"] p')).toHaveLength(0);

      // Every IUPAC nucleotide code, missing (?) and gap (-): a view that warns on any one of them fails.
      const cleanRows = ['ACGTURYSWKMBDHVN?-', 'ACGTACGTACGTACGTAC', 'AC-TACGTACGTACGTAC'];
      expect(new Set(cleanRows[0]), 'fixture: the clean row holds each code once').toEqual(new Set('ACGTURYSWKMBDHVN?-'));
      const clean = await nexusTextView(app, alignment('clean_aln', cleanRows));
      expect(clean.text, 'fixture: the clean text is shown').toContain('NEXUS');
      expect(clean.text, 'fixture: the clean text holds every code as written').toContain('clean_aln_1 ACGTURYSWKMBDHVN?-');
      expect(clean.warnings).toEqual([]);
    });
  });
});
