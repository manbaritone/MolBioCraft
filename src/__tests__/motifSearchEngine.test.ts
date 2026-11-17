// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVBH AC6: the IUPAC motif search reached the way the app reaches it, through
 * `searchIupacMotifRust` over the tracked public/molbiocraft_wasm.wasm. The expected hits are the
 * same hand scans crates/molbiocraft-core/tests/motif_search_known_answers.rs pins for AC1 and
 * AC3, written out again here rather than read from the engine, so a stale or wrongly wired engine
 * fails: an engine without the op throws "Unknown MolBioCraft Rust bioinformatics RPC operation",
 * an arm that drops `circular` misses the origin-crossing hits, one that drops `searchBothStrands`
 * or `mode` reports the wrong strands, and one that answers a refusal with an empty list fails the
 * refusal cases.
 */
import { describe, expect, it } from 'vitest';
import { searchIupacMotifRust, type IupacMotifSearch } from '../lib/rustBioEngine';

type Row = [start: number, end: number, strand: 1 | -1, certainty: 'definite' | 'possible', palindromic: boolean];

const rows = (r: IupacMotifSearch): Row[] =>
  r.hits.map((h) => [h.start, h.end, h.strand, h.certainty, h.palindromic]);

const fwd = { mode: 'nucleotide' as const, circular: false, searchBothStrands: false };

describe('US-01M7DVBH AC6: search_iupac_motif through the rebuilt engine', () => {
  it('US-01M7DVBH AC6 returns AC1 hits on ACGTNRACGT, definite and possible told apart', () => {
    const t = 'ACGTNRACGT';
    expect(rows(searchIupacMotifRust(t, 'ACG', fwd))).toEqual([
      [1, 3, 1, 'definite', false],
      [7, 9, 1, 'definite', false],
    ]);
    expect(rows(searchIupacMotifRust(t, 'AAA', fwd))).toEqual([[5, 7, 1, 'possible', false]]);
    const nra = searchIupacMotifRust(t, 'NRA', fwd);
    expect(nra).toEqual({
      hits: [
        { start: 4, end: 6, strand: 1, certainty: 'possible', palindromic: false },
        { start: 5, end: 7, strand: 1, certainty: 'definite', palindromic: false },
      ],
      totalHits: 2,
      definiteHits: 1,
      possibleHits: 1,
      warnings: [],
    });
  });

  it('US-01M7DVBH AC6 returns AC3 hits across the origin of a circular molecule, and none when linear', () => {
    const eco = `TTC${'A'.repeat(2994)}GAA`;
    const bsa = `CTC${'A'.repeat(2994)}GGT`;
    expect(eco).toHaveLength(3000);
    const both = { mode: 'nucleotide' as const, searchBothStrands: true };
    expect(rows(searchIupacMotifRust(eco, 'GAATTC', { ...both, circular: true }))).toEqual([
      [2998, 3, 1, 'definite', true],
    ]);
    expect(rows(searchIupacMotifRust(bsa, 'GAGACC', { ...both, circular: true }))).toEqual([
      [2998, 3, -1, 'definite', false],
    ]);
    for (const [seq, query] of [
      [eco, 'GAATTC'],
      [bsa, 'GAGACC'],
    ]) {
      const linear = searchIupacMotifRust(seq, query, { ...both, circular: false });
      expect(linear).toEqual({ hits: [], totalHits: 0, definiteHits: 0, possibleHits: 0, warnings: [] });
    }
    // With both strands off, the -1 site across the origin is not reported.
    expect(searchIupacMotifRust(bsa, 'GAGACC', { ...both, circular: true, searchBothStrands: false }).hits).toEqual([]);
  });

  it('US-01M7DVBH AC6 refuses with the engine reason rather than an empty list', () => {
    expect(() => searchIupacMotifRust('ACGTAC', 'ACGTACG', { mode: 'nucleotide', circular: true })).toThrow(
      /\] query longer than the sequence \(7 > 6\)$/
    );
    expect(() => searchIupacMotifRust('ACGT', '   ', { mode: 'nucleotide' })).toThrow(/\] query is empty$/);
    expect(() => searchIupacMotifRust('ACGT', 'AC GT', { mode: 'nucleotide' })).toThrow(
      /\] query letter ' ' is not a nucleotide code$/
    );
    expect(() => searchIupacMotifRust('MKV', 'MK1', { mode: 'protein' })).toThrow(
      /\] query letter '1' is not a protein code$/
    );
    expect(() => searchIupacMotifRust('', 'ACG', { mode: 'nucleotide' })).toThrow(/\] sequence is empty$/);
    // An unknown mode is refused, never read as nucleotide.
    expect(() =>
      searchIupacMotifRust('ACGT', 'ACG', { mode: 'dna' as unknown as 'nucleotide' })
    ).toThrow(/motif mode 'dna' is neither 'nucleotide' nor 'protein'/);
  });

  it('US-01M7DVBH AC6 reads protein mode, the cut and its warning through the payload', () => {
    // GAC reverse-complements to GTC at 1-3; as protein it is never reverse-complemented.
    expect(rows(searchIupacMotifRust('GTCGAC', 'GAC', { mode: 'protein', searchBothStrands: true }))).toEqual([
      [4, 6, 1, 'definite', false],
    ]);
    // X covers U and O, and not *.
    expect(searchIupacMotifRust('BZJXUO*', 'X', { mode: 'protein' }).definiteHits).toBe(6);
    // Both strands collected before the cut (AC5's fixture): the first two by start are +1, -1.
    const cut = searchIupacMotifRust('GACAGTCAAAAGACAAGRCAAGTCA', 'GAC', { mode: 'nucleotide', maxHits: 2 });
    expect(rows(cut)).toEqual([
      [1, 3, 1, 'definite', false],
      [5, 7, -1, 'definite', false],
    ]);
    expect([cut.totalHits, cut.definiteHits, cut.possibleHits]).toEqual([5, 4, 1]);
    expect(cut.warnings).toEqual(['Showing the first 2 of 5 hits.']);
  });
});
