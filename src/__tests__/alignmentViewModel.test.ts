// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  IUPAC_NUCLEOTIDE_MEMBERS,
  colorSchemesFor,
  complementAligned,
  countDifferences,
  coverageByColumn,
  findDisagreement,
  findOrfsInSequence,
  findRestrictionSitesAligned,
  formatPairwiseIdentityPct,
  isSchemeValidFor,
  logoByColumn,
  meanNucleotideMolecularWeightKda,
  meanPairwiseIdentity,
  motifColumns,
  packLanes,
  pairwiseIdentitySampling,
  proteinIsoelectricPoint,
  proteinMolecularWeight,
  residueCellStyle,
  residueSolidColor,
  reverseComplementAligned,
  rowCoordinateMaps,
  rulerStep,
  smooth,
  transferAnnotations,
  translateAlignedRow,
  translateCodon,
  visibleColumns,
} from '../core/alignmentViewModel';

interface NodeFsRead { readFileSync: (p: string | URL, e: string) => string }
const nodeSpec = (m: string): string => `node:${m}`;
const fs = (await import(/* @vite-ignore */ nodeSpec('fs'))) as NodeFsRead;

describe('alignment view model', () => {
  it('offers molecule-appropriate colour schemes', () => {
    const prot = colorSchemesFor(true).map((s) => s.value);
    const nt = colorSchemesFor(false).map((s) => s.value);
    expect(prot).toContain('Clustal');
    expect(prot).not.toContain('ACGT - Default');
    expect(nt).toContain('ACGT - Default');
    expect(nt).not.toContain('Hydrophobicity');
    expect(isSchemeValidFor('ACGT - Default', true)).toBe(false);
  });

  it('colours residues per scheme and treats gaps as empty', () => {
    expect(residueSolidColor('-', { scheme: 'Clustal', isProtein: true })).toBeNull();
    const clustalK = residueSolidColor('K', { scheme: 'Clustal', isProtein: true });
    const clustalL = residueSolidColor('L', { scheme: 'Clustal', isProtein: true });
    expect(clustalK).not.toBe(clustalL);
    // Hydrophobic I is red-ish, charged R is blue-ish
    expect(residueSolidColor('I', { scheme: 'Hydrophobicity', isProtein: true })).toMatch(/^#d|^#e/);
    expect(residueSolidColor('R', { scheme: 'Hydrophobicity', isProtein: true })).toMatch(/^#2/);
    expect(residueSolidColor('G', { scheme: 'GC vs AT', isProtein: false })).toBe('#2563eb');
    expect(residueSolidColor('A', { scheme: 'Similarity', isProtein: false, refChar: 'A' })).toBe('#64748b');
    expect(residueSolidColor('C', { scheme: 'Similarity', isProtein: false, refChar: 'A' })).toBe('#ef4444');
    expect(residueCellStyle('A', { scheme: 'ACGT - Text', isProtein: false }, false).background).toBe('transparent');
  });

  it('maps ungapped coordinates to alignment columns', () => {
    const { posAt, colOfPos } = rowCoordinateMaps('-AC--G');
    expect(Array.from(posAt)).toEqual([0, 1, 2, 2, 2, 3]);
    expect(Array.from(colOfPos)).toEqual([0, 1, 2, 5]);
  });

  it('hides gap-rich columns only when requested', () => {
    const seqs = ['A-C', 'A-C', 'AGC'];
    expect(visibleColumns(seqs, 3, false, 50)).toEqual([0, 1, 2]);
    expect(visibleColumns(seqs, 3, true, 50)).toEqual([0, 2]);
  });

  it('navigates to real disagreements in both directions', () => {
    const ref = 'ACGTACGT';
    const row = 'ACGAACTT';
    expect(findDisagreement(row, ref, 1, 1)).toBe(4);
    expect(findDisagreement(row, ref, 4, 1)).toBe(7);
    expect(findDisagreement(row, ref, 7, 1)).toBeNull();
    expect(findDisagreement(row, ref, 7, -1)).toBe(4);
    expect(countDifferences(row, ref)).toBe(2);
  });

  it('translates aligned rows across gaps with the chosen genetic code', () => {
    expect(translateCodon('TGA', 'Standard (1)')).toBe('*');
    expect(translateCodon('TGA', 'Vertebrate Mitochondrial')).toBe('W');
    const tr = translateAlignedRow('AT-GAAA--TAA', 0, 'Standard (1)');
    // codons: ATG (cols 0,1,3) -> M at col 1; AAA (4,5,6) -> K at col 5; TAA (9,10,11) -> * at col 10
    expect(tr.aaAtCol[1]).toBe('M');
    expect(tr.aaAtCol[5]).toBe('K');
    expect(tr.aaAtCol[10]).toBe('*');
    expect(tr.aaIndexAtCol[10]).toBe(3);
  });

  it('complements and reverse-complements while keeping gaps', () => {
    expect(complementAligned('AC-gT')).toBe('TG-cA');
    expect(reverseComplementAligned('AAC-G')).toBe('C-GTT');
  });

  it('computes coverage, smoothing and logo information', () => {
    expect(coverageByColumn(['A-', 'AA'], 2)).toEqual([2, 1]);
    expect(smooth([0, 3, 0], 3)).toEqual([1.5, 1, 1.5]);
    const logo = logoByColumn(['AA', 'AC', 'AG', 'AT'], 2, false);
    expect(logo[0]).toEqual({ letter: 'A', info: 1 });
    expect(logo[1].info).toBeCloseTo(0, 5);
  });

  it('finds IUPAC motifs and restriction sites across gaps', () => {
    expect([...motifColumns('GA-TC', 'GATC')]).toEqual([0, 1, 3, 4]);
    const hits = findRestrictionSitesAligned('TTGAA--TTCAA', [{ name: 'EcoRI', recognitionSeq: 'GAATTC' }]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ enzyme: 'EcoRI', col: 2, position: 3 });
  });

  it('finds ORFs on both strands', () => {
    const fwd = 'CCATGAAATTTGGGTAACC';
    const orfs = findOrfsInSequence(fwd, 12, ['ATG'], 'Standard (1)');
    expect(orfs).toContainEqual({ start: 3, end: 17, strand: 1, lengthBp: 15 });
    const rev = reverseComplementAligned(fwd);
    const revOrfs = findOrfsInSequence(rev, 12, ['ATG'], 'Standard (1)');
    expect(revOrfs.some((o) => o.strand === -1 && o.lengthBp === 15)).toBe(true);
  });

  it('transfers annotations only above the identity threshold', () => {
    const aligned = ['ACGTACGT', 'ACGTACGA', 'TTTTTTTT'];
    const feats = [[{ id: 'f', name: 'site', type: 'misc_feature', start: 1, end: 8, strand: 1 as const, color: '#f00' }], [], []];
    const out = transferAnnotations(aligned, feats, [0], 80);
    expect(out.get(1)?.[0]).toMatchObject({ start: 1, end: 8 });
    expect(out.has(2)).toBe(false);
  });

  it('packs annotation lanes', () => {
    const items = [
      { startCol: 0, endCol: 5 },
      { startCol: 6, endCol: 9 },
      { startCol: 3, endCol: 7 },
    ];
    expect(Math.max(...packLanes(items, true).map((i) => i.lane))).toBe(1);
    expect(Math.max(...packLanes(items, false).map((i) => i.lane))).toBe(2);
  });

  it('computes real alignment and protein statistics', () => {
    expect(meanPairwiseIdentity(['ACGT', 'ACGA', 'ACGT'])).toBeCloseTo(83.3, 1);
    // Glycine dipeptide: 2 * 57.0519 + 18.015
    expect(proteinMolecularWeight('GG')).toBeCloseTo(132.12, 1);
    expect(proteinIsoelectricPoint('DDDD')).toBeLessThan(4);
    expect(proteinIsoelectricPoint('KKKK')).toBeGreaterThan(10);
    expect(rulerStep(10, 56)).toBe(10);
  });

  it('names the pairs pairwise identity reads past 4,000 and labels the value approximate', () => {
    // BG-01M6S1AA. Up to 4,000 pairs (89 sequences) every pair is read; past it, every k-th.
    expect(pairwiseIdentitySampling(89)).toEqual({ totalPairs: 3_916, comparedPairs: 3_916, stride: 1 });
    expect(pairwiseIdentitySampling(90)).toEqual({ totalPairs: 4_005, comparedPairs: 2_003, stride: 2 });
    expect(pairwiseIdentitySampling(200)).toEqual({ totalPairs: 19_900, comparedPairs: 3_980, stride: 5 });
    expect(pairwiseIdentitySampling(1)).toEqual({ totalPairs: 0, comparedPairs: 0, stride: 1 });

    // The pairs it names are the ones meanPairwiseIdentity reads. 200 rows of two kinds that share
    // no base: X for the first row and every row j with j % 5 === 1, Y for the rest. Pair (0, j) is
    // the (j - 1)th, so every 5th pair holds each of row 0's pairs with an X row and none with a Y
    // row, while every pair, every 4th and every 6th do not: a function reading other pairs than
    // every 5th gives another value.
    const [X, Y] = ['ACGTACGTACGT', 'TGCATGCATGCA'];
    const rows = Array.from({ length: 200 }, (_, i) => (i === 0 || i % 5 === 1 ? X : Y));
    const everyKth = (k: number) => {
      let same = 0;
      let compared = 0;
      let pair = 0;
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++, pair++) {
        if (pair % k !== 0) continue;
        for (let c = 0; c < 12; c++) { compared++; if (rows[i][c] === rows[j][c]) same++; }
      }
      return Math.round((same / compared) * 1000) / 10;
    };
    const byFive = everyKth(5);
    for (const other of [1, 4, 6]) expect(everyKth(other), `fixture: every ${other}th pair gives another value`).not.toBe(byFive);
    expect(meanPairwiseIdentity(rows)).toBe(byFive);

    // A value read from fewer pairs than there are says so, with the pairs it read.
    expect(formatPairwiseIdentityPct(69.8, pairwiseIdentitySampling(90))).toBe('69.8% (approx., 2,003 of 4,005 pairs sampled)');
    expect(formatPairwiseIdentityPct(69.8, pairwiseIdentitySampling(89))).toBe('69.8%');
    expect(formatPairwiseIdentityPct(69.8)).toBe('69.8%');
    expect(formatPairwiseIdentityPct(Number.NaN, pairwiseIdentitySampling(90))).toBe('N/A (no overlapping pairs)');
  });

  it('accounts for the COXII CDS molecular-weight difference from Biopython by residue mass rounding', () => {
    const coxii = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    const seqs = (coxii.alignmentMeta?.sequences ?? []).map((m) => m.sequence);
    expect(seqs).toHaveLength(50);

    const BIOPYTHON_WATER_DA = 18.0153;
    const BIOPYTHON_DNMP_DA: Record<'A' | 'C' | 'G' | 'T', number> = {
      A: 331.2218,
      C: 307.1971,
      G: 347.2212,
      T: 322.2085,
    };
    const biopythonResidueDa: Record<'A' | 'C' | 'G' | 'T', number> = {
      A: BIOPYTHON_DNMP_DA.A - BIOPYTHON_WATER_DA,
      C: BIOPYTHON_DNMP_DA.C - BIOPYTHON_WATER_DA,
      G: BIOPYTHON_DNMP_DA.G - BIOPYTHON_WATER_DA,
      T: BIOPYTHON_DNMP_DA.T - BIOPYTHON_WATER_DA,
    };
    const mbcResidueDa: Record<'A' | 'C' | 'G' | 'T', number> = {
      A: meanNucleotideMolecularWeightKda(['A']).ssKda * 1000,
      C: meanNucleotideMolecularWeightKda(['C']).ssKda * 1000,
      G: meanNucleotideMolecularWeightKda(['G']).ssKda * 1000,
      T: meanNucleotideMolecularWeightKda(['T']).ssKda * 1000,
    };
    expect(mbcResidueDa).toEqual({ A: 313.21, C: 289.18, G: 329.21, T: 304.2 });

    const counts = { A: 0, C: 0, G: 0, T: 0 };
    for (const seq of seqs) {
      for (const raw of seq) {
        const members = IUPAC_NUCLEOTIDE_MEMBERS[raw.toUpperCase()];
        if (!members) continue;
        for (const m of members) counts[m as 'A' | 'C' | 'G' | 'T'] += 1 / members.length;
      }
    }
    const strandWith = (table: Record<'A' | 'C' | 'G' | 'T', number>, a: number, c: number, g: number, t: number) =>
      (a * table.A + c * table.C + g * table.G + t * table.T) / seqs.length;
    const bioWaterFreeSsDa = strandWith(biopythonResidueDa, counts.A, counts.C, counts.G, counts.T);
    const bioWaterFreeDsDa =
      bioWaterFreeSsDa + strandWith(biopythonResidueDa, counts.T, counts.G, counts.C, counts.A);
    const mw = meanNucleotideMolecularWeightKda(seqs);
    expect(mw.ssKda.toFixed(3)).toBe('210.326');
    expect(mw.dsKda.toFixed(3)).toBe('423.824');
    expect((bioWaterFreeSsDa / 1000).toFixed(3)).toBe('210.324');
    expect((bioWaterFreeDsDa / 1000).toFixed(3)).toBe('423.819');
    expect(((bioWaterFreeSsDa + BIOPYTHON_WATER_DA) / 1000).toFixed(3)).toBe('210.342');
    expect(((bioWaterFreeDsDa + 2 * BIOPYTHON_WATER_DA) / 1000).toFixed(3)).toBe('423.855');
    expect((mw.ssKda * 1000 - bioWaterFreeSsDa).toFixed(2)).toBe('2.07');
    expect((mw.dsKda * 1000 - bioWaterFreeDsDa).toFixed(2)).toBe('4.78');

    const deltaDa: Record<'A' | 'C' | 'G' | 'T', number> = {
      A: mbcResidueDa.A - biopythonResidueDa.A,
      C: mbcResidueDa.C - biopythonResidueDa.C,
      G: mbcResidueDa.G - biopythonResidueDa.G,
      T: mbcResidueDa.T - biopythonResidueDa.T,
    };
    const roundingSsDa = strandWith(deltaDa, counts.A, counts.C, counts.G, counts.T);
    const roundingDsDa = roundingSsDa + strandWith(deltaDa, counts.T, counts.G, counts.C, counts.A);
    expect(Math.abs(mw.ssKda * 1000 - roundingSsDa - bioWaterFreeSsDa).toFixed(6)).toBe('0.000000');
    expect(Math.abs(mw.dsKda * 1000 - roundingDsDa - bioWaterFreeDsDa).toFixed(6)).toBe('0.000000');

    const source = fs.readFileSync(new URL('../core/alignmentViewModel.ts', import.meta.url), 'utf8');
    const fnAt = source.indexOf('export function meanNucleotideMolecularWeightKda');
    const docStart = source.lastIndexOf('/**', fnAt);
    const doc = source.slice(docStart, fnAt);
    expect(doc).not.toContain('reference value recorded from third-party software output');
    expect(doc).toContain('rounding of the two-decimal residue masses');
    expect(doc).toContain('2.07 / 4.78 Da');
    expect(doc).toContain('0.000000');
  });
});
