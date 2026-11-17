// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6VFRY AC3: the four TypeScript classifiers ask the engine's one alphabet rule
 * (`classify_sequence_alphabet`, the real WASM engine) instead of counting letters themselves.
 * Each is checked on every audit input against the engine's call, and the engine's call is pinned,
 * so neither side can drift alone. Wrong implementations, and the case that catches each:
 * - `alignmentMolecule`'s old 90%-ACGTUN test: ACGTBDHVACGTACGT, the R/Y-rich row and MKVAGCATNG
 *   turn Protein;
 * - `isNucleotideAlignmentRows`' old copy (no inosine in the shared group): GCIGCIACIGGNAAYGG
 *   turns protein;
 * - the NEXUS inference's old all-IUPAC test: ACGTACGTACGTACGTACXX (two X) and GCIGCIACIGGNAAYGG
 *   turn Protein;
 * - `assessRawSequenceText`'s old IUPAC-symbols-only test: codon-spaced ACGTACGTACGTACGTACXX and
 *   GCIGCIACIGGNAAYGG are refused as prose;
 * - a no-letter input given a default molecule: '', '---' and '*' must have none.
 */

import { describe, expect, it } from 'vitest';
import { classifySequenceAlphabet } from '../core/bioEngine';
import { alignmentMolecule, textAlignmentToDocument } from '../core/alignmentFormats';
import { isNucleotideAlignmentRows } from '../core/alignmentViewModel';
import { assessRawSequenceText, parseNexusAlignment } from '../core/fileParsers';
import type { MoleculeType } from '../types/bio';

const AUDIT: [string, MoleculeType | null, boolean][] = [
  ['ACGTBDHVACGTACGT', 'DNA', true],
  ['GCIGCIACIGGNAAYGG', 'DNA', true],
  ['MKV*', 'Protein', false],
  ['GAGAGTCCAN', 'DNA', false],
  ['ACGTXXXACGT', 'Protein', true],
  ['ACGTACGTACGTRYRYRY', 'DNA', true],
  ['MKVAGCATNG', 'DNA', true],
  ['ACGTACGTACGTACGTACXX', 'DNA', false],
  ['ACGUACGUAC', 'RNA', false],
  ['', null, false],
  ['---', null, false],
  ['*', null, false],
];

const nucleotide = (m: MoleculeType | null) => m === 'DNA' || m === 'RNA';

/** A NEXUS file with two identical taxa of `row` and no DATATYPE. */
const nexus = (row: string) => [
  '#NEXUS', 'BEGIN DATA;', `DIMENSIONS NTAX=2 NCHAR=${row.length};`, 'FORMAT MISSING=? GAP=-;', 'MATRIX',
  `one ${row}`, `two ${row}`, ';', 'END;', '',
].join('\n');

/** The input as header-less text in codon-spaced groups, twice over (the rule's proportions are unchanged). */
const codonSpaced = (row: string) => {
  const groups = row.match(/.{1,3}/g) ?? [];
  return [...groups, ...groups].join(' ');
};

describe('the one alphabet rule in the TypeScript classifiers (US-01M6VFRY AC3)', () => {
  it('US-01M6VFRY AC3 the engine op makes the audit calls', () => {
    for (const [row, molecule, uncertain] of AUDIT) {
      const call = classifySequenceAlphabet([row]);
      expect([call.molecule, call.uncertain], row).toEqual([molecule, uncertain]);
    }
  });

  it('US-01M6VFRY AC3 alignmentMolecule and isNucleotideAlignmentRows give the engine call on every audit input', () => {
    for (const [row, molecule] of AUDIT) {
      const engine = classifySequenceAlphabet([row, row]).molecule;
      expect(engine, row).toBe(molecule);
      expect(alignmentMolecule([row, row]), row).toBe(engine);
      expect(isNucleotideAlignmentRows([row, row]), row).toBe(nucleotide(engine));
    }
    // Rows are read together, as the engine reads them.
    expect(alignmentMolecule(['ACGTXXXACGT'])).toBe('Protein');
    expect(alignmentMolecule(['ACGTXXXACGT', 'ACGTACGTACGTACGTACGTACGT'])).toBe('DNA');
    expect(isNucleotideAlignmentRows(['ACGTXXXACGT', 'ACGTACGTACGTACGTACGTACGT'])).toBe(true);
    // Tildes and stops are not letters: they neither count for nor against a nucleotide call.
    expect(classifySequenceAlphabet(['ACGTACGT~~', 'ACGTACGT**']).molecule).toBe('DNA');
    expect(isNucleotideAlignmentRows(['ACGTACGT~~', 'ACGTACGT**'])).toBe(true);
    expect(alignmentMolecule(['ACGTACGT~~', 'ACGTACGT**'])).toBe('DNA');
    // An alignment with no residue letter is refused rather than given a molecule.
    expect(() => textAlignmentToDocument({ names: ['a', 'b'], sequences: ['---', '---'], format: 'Clustal' }, 'gaps.aln'))
      .toThrow('The Clustal alignment has no residue letters to read as DNA, RNA or protein.');
    expect(textAlignmentToDocument({ names: ['a', 'b'], sequences: ['ACGTBDHVACGTACGT', 'ACGTBDHVACGTACGT'], format: 'Clustal' }, 'deg.aln').moleculeType)
      .toBe('DNA');
  });

  it('US-01M6VFRY AC3 the NEXUS inference of a matrix with no DATATYPE gives the engine call', () => {
    for (const [row, molecule] of AUDIT) {
      if (!row) continue; // a matrix row needs a character
      const engine = classifySequenceAlphabet([row, row]).molecule;
      expect(engine, row).toBe(molecule);
      if (engine) {
        expect(parseNexusAlignment(nexus(row)).moleculeType, row).toBe(engine);
      } else {
        expect(() => parseNexusAlignment(nexus(row)), row).toThrow('NEXUS MATRIX has no residue letters, and no DATATYPE names the molecule');
      }
    }
    // A declared DATATYPE still decides.
    expect(parseNexusAlignment(nexus('ACGTACGTAC').replace('FORMAT ', 'FORMAT DATATYPE=PROTEIN ')).moleculeType).toBe('Protein');
  });

  it("US-01M6VFRY AC3 assessRawSequenceText's nucleotide test gives the engine call", () => {
    for (const [row] of AUDIT) {
      const text = codonSpaced(row);
      const engine = classifySequenceAlphabet([text]).molecule;
      // Short groups are a sequence only when the rule reads them as nucleotide; otherwise prose.
      expect(assessRawSequenceText(text).ok, JSON.stringify(text)).toBe(nucleotide(engine));
    }
    expect(assessRawSequenceText(codonSpaced('ACGTACGTACGTACGTACXX'))).toEqual({ ok: true });
    expect(assessRawSequenceText(codonSpaced('MKVLEQFP'))).toEqual({ ok: false, reason: 'it looks like prose rather than a sequence' });
    expect(assessRawSequenceText('a cat had a bad day')).toEqual({ ok: false, reason: 'it looks like prose rather than a sequence' });
    expect(assessRawSequenceText('GCI GCI ACI GGN AAY GG')).toEqual({ ok: true });
  });
});
