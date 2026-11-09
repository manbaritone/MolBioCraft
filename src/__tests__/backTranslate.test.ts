// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { degenerateCodons, runBackTranslate } from '../core/operationRunners';
import { translateCodon } from '../core/alignmentViewModel';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';

const prot = { ...EMPTY_WORKSPACE_DOCUMENT, id: 'p', name: 'p', sequence: 'MKWLSR*', moleculeType: 'Protein' as const };

describe('back-translation', () => {
  it('derives IUPAC codons from the genetic code', () => {
    const t = degenerateCodons('Standard');
    expect(t.get('M')).toBe('ATG');
    expect(t.get('W')).toBe('TGG');
    expect(t.get('L')).toBe('YTN');
    expect(t.get('R')).toBe('MGN');
    expect(t.get('S')).toBe('WSN');
  });
  it('most-likely mode encodes the protein exactly and keeps the stop', () => {
    const r = runBackTranslate([prot], { mode: 'likely', host: 'ecoli' }, { sourceLabel: 'x' });
    const dna = r.created[0].sequence;
    expect(dna.length).toBe(21);
    const back = dna.match(/.{3}/g)!.map((c) => translateCodon(c, 'Standard')).join('');
    expect(back).toBe('MKWLSR*');
  });
  it('ambiguous mode gives one degenerate codon per residue', () => {
    const r = runBackTranslate([prot], { mode: 'ambiguous' }, { sourceLabel: 'x' });
    expect(r.created[0].sequence).toBe('ATGAARTGGYTNWSNMGNTRR');
  });
});
