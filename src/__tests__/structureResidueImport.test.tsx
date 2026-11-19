// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7NMQK AC1, AC2, AC4 and AC5: a PDB or mmCIF file dropped on the mounted App opens one
 * document per polymer chain the engine reads (`structure_chain_sequences`, D0211), as Protein, DNA
 * or RNA, with its modified residues read as their parents and named in its Notes. Each document is
 * read back from the session the App itself saves. The fixtures are US-01M6VFMX's
 * (crates/molbiocraft-wasm/tests/structure_residues.rs), written here the same way; the complex
 * fixture's chains A and C carry author numbers that differ from their label numbers, so the
 * document's 'First Residue Number' tells the author number from the label one.
 *
 * Wrong implementations, and the case that catches each:
 * - the old import (a 20-entry map over the C-alpha list): semet reads 'XKXVTFISLL' and sep 'XKXV';
 * - a C-alpha list that takes the calcium ion: a 'chain B' document;
 * - nucleic-acid chains read from the C-alpha list: complex chains B and C are lost;
 * - every chain opened as Protein: chain B must be RNA and chain C DNA;
 * - the modified residues left out of Notes, or their sentence miscounted: the exact sentences;
 * - the engine's warnings dropped, or put on every chain: the XYZ7 sentence is on chain A's Notes
 *   alone, beside an RNA chain B that has none;
 * - a skipped chain dropped without a word: the banner names complex chain D;
 * - 'First Residue Number' from the C-alpha list's label number: chain A is 5, not 1;
 * - a structure file with no chain opened empty or silently: ligand.pdb is refused by name;
 * - the skipped chains left out of that refusal, or joined with a doubled period: sugar.cif's two
 *   NAG-only chains are named in the exact refusal text;
 * - the 3D view opened for any structure, or the view left as it was: an RNA-only file after
 *   semet.pdb opens the Sequence view.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { runStructureAlignment } from '../core/operationRunners';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// ─── Fixtures (US-01M6VFMX's, structure_residues.rs) ───

/** A legacy PDB atom line: chain A, coordinates (x, 1, 2). */
function pdbAtom(record: string, serial: number, name: string, res: string, seq: number, x: number, element: string): string {
  const f = (n: number) => n.toFixed(3).padStart(8);
  return `${record.padEnd(6)}${String(serial).padStart(5)} ${name.padEnd(4)} ${res.padStart(3)} A${String(seq).padStart(4)}    ${f(x)}${f(1)}${f(2)}  1.00 20.00          ${element.padStart(2)}\n`;
}

/** Chain A: HETATM MSE 1 (with its selenium), ATOM LYS 2, HETATM SEC 3, ATOM VAL 4 to LEU 10, then a calcium ion. */
function semetPdb(): string {
  let out = 'HEADER    SYNTHETIC\n';
  out += pdbAtom('HETATM', 1, ' CA', 'MSE', 1, 0, 'C');
  out += pdbAtom('HETATM', 2, 'SE', 'MSE', 1, 0.5, 'SE');
  out += pdbAtom('ATOM', 3, ' CA', 'LYS', 2, 3.8, 'C');
  out += pdbAtom('HETATM', 4, ' CA', 'SEC', 3, 7.6, 'C');
  ['VAL', 'THR', 'PHE', 'ILE', 'SER', 'LEU', 'LEU'].forEach((res, k) => {
    out += pdbAtom('ATOM', 5 + k, ' CA', res, 4 + k, 11.4 + 3.8 * k, 'C');
  });
  out += pdbAtom('HETATM', 12, 'CA', 'CA', 101, 5, 'CA');
  return `${out}END\n`;
}

const CIF_HEADER = [
  'data_T', 'loop_', '_atom_site.group_PDB', '_atom_site.id', '_atom_site.type_symbol', '_atom_site.label_atom_id',
  '_atom_site.label_comp_id', '_atom_site.label_asym_id', '_atom_site.label_seq_id', '_atom_site.auth_asym_id',
  '_atom_site.auth_seq_id', '_atom_site.Cartn_x', '_atom_site.Cartn_y', '_atom_site.Cartn_z', '',
].join('\n');

/** mmCIF rows of (group, element, atom, residue, label chain, label_seq_id, author number); the author chain is the label chain. */
type CifRow = [string, string, string, string, string, string, number];
const cif = (rows: CifRow[]): string =>
  CIF_HEADER + rows.map(([group, el, name, res, chain, seq, auth], k) => `${group} ${k + 1} ${el} ${name} ${res} ${chain} ${seq} ${chain} ${auth} ${k}.000 1.000 2.000\n`).join('');

/** label_asym A: MSE, LYS, SEP, VAL (label_seq_id 1-4); label_asym B: a calcium ion ('.'). */
const sepCif = (): string => cif([
  ['HETATM', 'C', 'CA', 'MSE', 'A', '1', 1],
  ['HETATM', 'SE', 'SE', 'MSE', 'A', '1', 1],
  ['ATOM', 'C', 'CA', 'LYS', 'A', '2', 2],
  ['HETATM', 'C', 'CA', 'SEP', 'A', '3', 3],
  ['ATOM', 'C', 'CA', 'VAL', 'A', '4', 4],
  ['HETATM', 'CA', 'CA', 'CA', 'B', '.', 101],
]);

/**
 * A: ALA, GLY (author numbers 5-6); B: G, PSU, A, C (RNA, P and C1' atoms, author numbers 1-4);
 * C: DA, DC, DG, DT (author numbers 11-14). `only` keeps the named chains.
 */
function complexCif(only?: string[]): string {
  return cif(complexRows(only));
}
function complexRows(only?: string[]): CifRow[] {
  const rows: CifRow[] = [['ATOM', 'C', 'CA', 'ALA', 'A', '1', 5], ['ATOM', 'C', 'CA', 'GLY', 'A', '2', 6]];
  ['G', 'PSU', 'A', 'C'].forEach((res, k) => {
    const group = res === 'PSU' ? 'HETATM' : 'ATOM';
    rows.push([group, 'P', 'P', res, 'B', String(k + 1), k + 1], [group, 'C', '"C1\'"', res, 'B', String(k + 1), k + 1]);
  });
  ['DA', 'DC', 'DG', 'DT'].forEach((res, k) => {
    rows.push(['ATOM', 'P', 'P', res, 'C', String(k + 1), k + 11], ['ATOM', 'C', '"C1\'"', res, 'C', String(k + 1), k + 11]);
  });
  return only ? rows.filter((r) => only.includes(r[4])) : rows;
}

/** Chain A: MET ALA GLY SER THR LYS then XYZ (label_seq_id 7), which the table lacks. */
const unknownRows = (): CifRow[] =>
  ['MET', 'ALA', 'GLY', 'SER', 'THR', 'LYS', 'XYZ'].map((res, k): CifRow => ['ATOM', 'C', 'CA', res, 'A', String(k + 1), k + 1]);
/** Chain A of {@link unknownRows}; chain D: two NAG (1-2). */
const nagCif = (): string => cif([
  ...unknownRows(),
  ['HETATM', 'C', 'C1', 'NAG', 'D', '1', 1],
  ['HETATM', 'C', 'C1', 'NAG', 'D', '2', 2],
]);

/** Only an ATP ligand, as HETATM records. */
const ligandPdb = (): string =>
  `HEADER    SYNTHETIC\n${pdbAtom('HETATM', 1, 'PG', 'ATP', 401, 0, 'P')}${pdbAtom('HETATM', 2, 'O1G', 'ATP', 401, 1.5, 'O')}END\n`;

// ─── The mounted App ───

async function drop(app: AppHarness, name: string, text: string): Promise<void> {
  const React = await import('react');
  const root = app.one('.mbc-workbench', 'workbench root');
  const file = new File([new TextEncoder().encode(text)], name);
  const dataTransfer = { files: [file], types: ['Files'], items: [], dropEffect: 'copy', effectAllowed: 'all' };
  await React.act(async () => { dispatchLiveEvent(root, 'drop', { dataTransfer }); });
  await app.settle();
}

/** The documents of the session the App saves. */
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

const notice = (app: AppHarness): string => app.all('.statusbar-toast-text').map((n) => words(n.textContent)).join(' | ');

/** The status banner the last drop left (read before the session export replaces it). */
let banner = '';

/** Drops the file and returns the documents it added to the saved session, in order. */
async function opened(app: AppHarness, name: string, text: string, sessionOpen: boolean): Promise<SequenceDocument[]> {
  const before = new Set(sessionOpen ? (await savedDocuments(app)).map((d) => d.id) : []);
  await drop(app, name, text);
  banner = notice(app);
  return (await savedDocuments(app)).filter((d) => !before.has(d.id));
}

/** The Notes the Info tab shows for the document whose tab is titled `name`. */
async function infoNotes(app: AppHarness, name: string): Promise<{ molecule: string; notes: string }> {
  const tab = app.all('button.mbc-doc-tab-trigger').filter((b) => words(b.querySelectorAll('.mbc-doc-tab-title')[0]?.textContent) === name);
  expect(tab, `the document tab of ${name}`).toHaveLength(1);
  await app.click(tab[0]);
  await app.clickTab('document-info');
  const fields = Object.fromEntries(app.all('.mbc-document-info dl div').map((row) => [
    words(row.querySelector('dt')?.textContent), words(row.querySelector('dd')?.textContent),
  ]));
  expect(fields.Name, 'the Info tab shows the document clicked').toBe(name);
  const box = app.one('textarea#document-notes', 'the Notes box');
  return { molecule: fields.Molecule, notes: (box as unknown as { value: string }).value };
}

const summary = (d: SequenceDocument) => ({
  name: d.name, molecule: d.moleculeType, sequence: d.sequence, notes: d.docMetadata?.Notes,
  chain: d.docMetadata?.Chain, first: d.docMetadata?.['First Residue Number'],
});

const XYZ_WARNING = 'Residue XYZ7 in chain A has no entry in the residue table: read as X.';

describe('structure import, one document per polymer chain (US-01M7NMQK)', () => {
  it('US-01M7NMQK AC1 reads modified residues as their parents, names them in Notes, and opens no ion chain', async () => {
    const app = await mountApp();
    try {
      const semet = await opened(app, 'semet.pdb', semetPdb(), false);
      expect(semet.map(summary)).toEqual([
        { name: 'semet', molecule: 'Protein', sequence: 'MKUVTFISLL', notes: '1 modified residue read as its parent: MSE1→M.', chain: 'A', first: 1 },
      ]);
      expect(semet[0].docMetadata?.['Source Format']).toBe('PDB');
      expect(semet[0].docMetadata?.PDBText).toBe(semetPdb());
      expect(await infoNotes(app, 'semet'), 'the Info tab reads the Notes').toEqual({ molecule: 'Protein', notes: '1 modified residue read as its parent: MSE1→M.' });

      const sep = await opened(app, 'sep.cif', sepCif(), true);
      expect(sep.map(summary)).toEqual([
        { name: 'sep', molecule: 'Protein', sequence: 'MKSV', notes: '2 modified residues read as their parents: MSE1→M, SEP3→S.', chain: 'A', first: 1 },
      ]);
      expect(sep[0].docMetadata?.['Source Format']).toBe('mmCIF');
      expect([...semet, ...sep].filter((d) => /chain B/.test(d.name)), "no 'chain B' document").toEqual([]);

      // A residue the table lacks: read as X, with the engine's sentence in the chain's Warnings block.
      const unknown = await opened(app, 'unknown.cif', nagCif(), true);
      expect(unknown.map(summary)).toEqual([
        { name: 'unknown chain A', molecule: 'Protein', sequence: 'MAGSTKX', notes: `Warnings:\n- ${XYZ_WARNING}\n`, chain: 'A', first: 1 },
      ]);

      // Beside a chain with no warning, the warning stays on its own chain's Notes.
      const mixed = await opened(app, 'mixed.cif', cif([...unknownRows(), ...complexRows(['B'])]), true);
      expect(mixed.map((d) => [d.name, d.moleculeType, d.sequence, d.docMetadata?.Notes])).toEqual([
        ['mixed chain A', 'Protein', 'MAGSTKX', `Warnings:\n- ${XYZ_WARNING}\n`],
        ['mixed chain B', 'RNA', 'GUAC', '1 modified residue read as its parent: PSU2→U.'],
      ]);

      // 'First Residue Number' is the author number: chain A of the complex fixture is labelled 1-2, authored 5-6.
      const complex = await opened(app, 'complex.cif', complexCif(), true);
      expect(complex.map((d) => [d.name, d.docMetadata?.['First Residue Number']])).toEqual([
        ['complex chain A', 5], ['complex chain B', 1], ['complex chain C', 11],
      ]);
    } finally {
      app.unmount();
    }
  });

  it('US-01M7NMQK AC2 opens nucleic-acid chains as DNA and RNA, refuses a file with no chain, and names a skipped chain', async () => {
    const app = await mountApp();
    try {
      const complex = await opened(app, 'complex.cif', complexCif(), false);
      expect(complex.map(summary)).toEqual([
        { name: 'complex chain A', molecule: 'Protein', sequence: 'AG', notes: undefined, chain: 'A', first: 5 },
        { name: 'complex chain B', molecule: 'RNA', sequence: 'GUAC', notes: '1 modified residue read as its parent: PSU2→U.', chain: 'B', first: 1 },
        { name: 'complex chain C', molecule: 'DNA', sequence: 'ACGT', notes: undefined, chain: 'C', first: 11 },
      ]);
      for (const d of complex) expect([d.docMetadata?.['Source Format'], d.docMetadata?.PDBText]).toEqual(['mmCIF', complexCif()]);

      const ligand = await opened(app, 'ligand.pdb', ligandPdb(), true);
      expect(ligand, 'the ligand file opens nothing').toEqual([]);
      expect(banner).toBe('Drop import error: "ligand.pdb" has no protein or nucleic-acid chain to open');

      const nag = await opened(app, 'complex.cif', nagCif(), true);
      expect(nag.map((d) => [d.name, d.moleculeType, d.sequence])).toEqual([['complex chain A', 'Protein', 'MAGSTKX']]);
      expect(banner.split('complex chain D was not opened: no amino-acid or nucleotide residues.'), banner).toHaveLength(2);
    } finally {
      app.unmount();
    }
  });

  it('US-01M7NMQK AC2 refuses a file whose only chains were skipped, one period after each sentence', async () => {
    // Two NAG-only chains: both are skipped, so the refusal names each, after its own first sentence.
    const app = await mountApp();
    try {
      await opened(app, 'semet.pdb', semetPdb(), false); // a session to export
      const sugar = await opened(app, 'sugar.cif', cif([
        ['HETATM', 'C', 'C1', 'NAG', 'D', '1', 1],
        ['HETATM', 'C', 'C1', 'NAG', 'E', '1', 1],
      ]), true);
      expect(sugar, 'the sugar file opens nothing').toEqual([]);
      expect(banner).toBe('Drop import error: "sugar.cif" has no protein or nucleic-acid chain to open. '
        + 'sugar chain D was not opened: no amino-acid or nucleotide residues. '
        + 'sugar chain E was not opened: no amino-acid or nucleotide residues.');
    } finally {
      app.unmount();
    }
  });

  it('US-01M7NMQK AC4 opens the 3D view for a protein chain and the Sequence view for an RNA-only file', async () => {
    const app = await mountApp();
    try {
      const subTab3d = () => app.all('button[role="tab"]').filter((b) => words(b.textContent) === 'Coiled-Coils, Transmembrane & 3D PDB');
      await drop(app, 'semet.pdb', semetPdb());
      expect(app.activeTab(), 'semet.pdb opens Protein & 3D').toBe('genomics-ngs');
      expect(subTab3d().map((b) => b.getAttribute('aria-selected')), 'on its 3D sub-tab').toEqual(['true']);

      const rna = await opened(app, 'complex_b.cif', complexCif(['B']), true);
      expect(rna.map((d) => [d.name, d.moleculeType, d.sequence])).toEqual([['complex_b', 'RNA', 'GUAC']]);
      expect(app.activeTab(), 'the RNA-only file opens the Sequence view').toBe('sequence-view');
    } finally {
      app.unmount();
    }
  });

  it('US-01M7NMQK AC5 structure alignment refuses the RNA chain document with the no-C-alpha reason', async () => {
    const app = await mountApp();
    try {
      const complex = await opened(app, 'complex.cif', complexCif(), false);
      const semet = await opened(app, 'semet.pdb', semetPdb(), true);
      const rna = complex.find((d) => d.name === 'complex chain B');
      expect(rna?.moleculeType).toBe('RNA');
      let reason = '';
      try {
        runStructureAlignment(rna!, semet[0], { method: 'tm', chainA: '', chainB: '' }, { sourceLabel: 'x' });
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
      }
      expect(reason).toBe('Structure A, T chain B, has no Cα coordinates; a structure alignment superposes Cα atoms.');
    } finally {
      app.unmount();
    }
  });
});
