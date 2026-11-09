// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { mapReadsToReference } from '../core/referenceMapping';
import { samToContigs } from '../core/importFormats';
import { reverseComplement } from '../core/bioEngine';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

let x = 777;
const rnd = (n: number) => Array.from({ length: n }, () => {
  x = (Math.imul(x, 1103515245) + 12345) >>> 0;
  return 'ACGT'[(x >>> 16) & 3];
}).join('');
const doc = (id: string, sequence: string): SequenceDocument => ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name: id, sequence, moleculeType: 'DNA', topology: 'linear' });

const ref = rnd(1200);
const mut = (s: string, i: number, b: string) => s.slice(0, i) + b + s.slice(i + 1);
const opts = { minIdentityPct: 80, minAlignedLength: 50, minVariantFrequencyPct: 25, minVariantCoverage: 1 };

describe('map to reference', () => {
  const snpPos = 300; // 0-based
  const alt = ref[snpPos] === 'A' ? 'C' : 'A';
  const r1 = doc('r1', mut(ref.slice(100, 600), snpPos - 100, alt));
  const r2 = doc('r2', mut(ref.slice(200, 700), snpPos - 200, alt));
  const r3 = doc('r3', ref.slice(250, 550));
  const ins = doc('ins', ref.slice(600, 800) + 'GGGG' + ref.slice(800, 1000));
  const rev = doc('rev', reverseComplement(ref.slice(900, 1150)));
  const junk = doc('junk', rnd(300));
  const c = mapReadsToReference(doc('ref', ref), [r1, r2, r3, ins, rev, junk], opts);

  it('maps related reads (both strands) and rejects an unrelated one', () => {
    expect(c.mapped.map((m) => m.doc.id).sort()).toEqual(['ins', 'r1', 'r2', 'r3', 'rev']);
    expect(c.unmapped.map((u) => u.doc.id)).toEqual(['junk']);
    expect(c.mapped.find((m) => m.doc.id === 'rev')!.strand).toBe(-1);
    expect(c.mapped.find((m) => m.doc.id === 'r1')!.strand).toBe(1);
  });

  it('builds equal-length rows that keep every base and reference base', () => {
    expect(new Set(c.rows.map((r) => r.sequence.length)).size).toBe(1);
    expect(c.rows[0].sequence.replace(/-/g, '')).toBe(ref);
    const row = (id: string) => c.rows.find((r) => r.id === id)!.sequence.replace(/-/g, '');
    expect(row('r1')).toBe(r1.sequence);
    expect(row('ins')).toBe(ins.sequence);
    expect(row('rev')).toBe(ref.slice(900, 1150));
    expect(c.columns).toBe(1204);
  });

  it('reports the SNP (2 of 3 reads) and the 4-bp insertion', () => {
    const snp = c.variants.find((v) => v.type === 'SNP' && v.refPosition === snpPos + 1)!;
    expect(snp).toMatchObject({ altBase: alt, supporting: 2, coverage: 3 });
    expect(snp.frequencyPct).toBeCloseTo(66.7, 1);
    expect(c.variants.filter((v) => v.type === 'Insertion').length).toBeGreaterThanOrEqual(1);
    expect(c.consensus[snp.column - 1]).toBe(alt);
    expect(c.breadthPct).toBeGreaterThan(80);

    // The 4-bp insertion: 'ins' carries GGGG after reference base 800 (1-based), and the reference
    // there reads T798 G799 G800 A801, so inserting GGGG before 799, 800 or 801 gives the same read:
    // one event, with three placements.
    // Oracle for the placement: VCF left-normalisation. Shift the insertion left while the
    // reference base just before it equals the run's last base: from after G800 to after G799,
    // then to after T798, where T stops it. So the normalised call is POS 798, REF T, ALT TGGGG:
    // the insertion sits before base 799.
    // Biopython 1.84 PairwiseAligner (global, match 2, mismatch -1, gap open -3, extend -1, free
    // end gaps on the read; score 794) confirms only the event: its three co-optimal alignments
    // each carry one 4-bp GGGG insertion, before base 799, 800 or 801. It does not pick a placement.
    expect(ref.slice(797, 801)).toBe('TGGA'); // 1-based 798-801: the context the normalisation reads
    // The engine reports each inserted base as an Insertion at the reference base it precedes.
    const insCalls = c.mapped.find((m) => m.doc.id === 'ins')!.variants.filter((v) => v.type === 'Insertion');
    expect(insCalls.map((v) => v.position)).toEqual([799, 799, 799, 799]);
    expect(insCalls.map((v) => v.altBase).join('')).toBe('GGGG');
    // The contig opens exactly four shared insertion columns, 799-802, and they hold GGGG.
    const gapColumns = [...c.rows[0].sequence].flatMap((ch, i) => (ch === '-' ? [i + 1] : []));
    expect(gapColumns).toEqual([799, 800, 801, 802]);
    expect(c.rows.find((r) => r.id === 'ins')!.sequence.slice(798, 802)).toBe('GGGG');
    expect(c.consensus.slice(798, 802)).toBe('GGGG');
    // The variant table lists the run once, as one allele carrying all four bases, at that
    // position and the first of those columns (its read counts: 'reports a multi-base insertion
    // as one allele').
    const insVariants = c.variants.filter((v) => v.type === 'Insertion');
    expect(insVariants.map(({ refPosition, column, refBase, altBase }) => ({ refPosition, column, refBase, altBase }))).toEqual([
      { refPosition: 799, column: 799, refBase: '-', altBase: 'GGGG' },
    ]);
  });

  // Oracle for the insertion rows below: pysam 0.24.1 pileup at the insertion's anchor base (the
  // reference base before it, VCF POS) over a SAM of the same reads, each CIGAR written by hand
  // from how the read was built, never from this engine's output. The pileup's depth there is the
  // coverage; its reads with an insertion of those bases after that base are the support.
  it('reports a multi-base insertion as one allele', () => {
    // 'ins' is the one read covering the anchor T798, and it inserts GGGG after it: one allele,
    // one read of one. (pysam: insertion GGGG after 798, 1 of depth 1.)
    expect(c.variants.filter((v) => v.type === 'Insertion')).toEqual([
      { refPosition: 799, column: 799, type: 'Insertion', refBase: '-', altBase: 'GGGG', supporting: 1, coverage: 1, frequencyPct: 100, meanQuality: null },
    ]);
    // Mixed bases too: GATC between G444 and A445 is one row, not one per base. Neither flank
    // matches the run's end bases (G444 is not C, A445 is not G), so it has one placement: before
    // base 445, in the first of four new columns after column 444. (pysam: GATC after 444, 1 of 1.)
    expect(ref.slice(443, 445)).toBe('GA');
    const g = mapReadsToReference(doc('ref', ref), [doc('gatc', ref.slice(250, 444) + 'GATC' + ref.slice(444, 650))], opts);
    expect(g.mapped[0].variants.filter((v) => v.type === 'Insertion').map((v) => v.altBase).join('')).toBe('GATC');
    expect(g.variants).toEqual([
      { refPosition: 445, column: 445, type: 'Insertion', refBase: '-', altBase: 'GATC', supporting: 1, coverage: 1, frequencyPct: 100, meanQuality: null },
    ]);
  });

  it('insertion frequency counts reads, not bases', () => {
    // AAA between C448 and G449 has one placement (neither flank is an A): before base 449.
    // 'starts' begins at G449, so it does not cover the anchor C448 and is not counted.
    expect(ref.slice(447, 449)).toBe('CG');
    const carrier = (id: string, from: number, to: number) => doc(id, ref.slice(from, 448) + 'AAA' + ref.slice(448, to));
    const spans = doc('spans', ref.slice(300, 700));
    const starts = doc('starts', ref.slice(448, 748));
    const insertions = (reads: SequenceDocument[]) => mapReadsToReference(doc('ref', ref), reads, opts).variants
      .filter((v) => v.type === 'Insertion')
      .map(({ refPosition, altBase, supporting, coverage, frequencyPct }) => ({ refPosition, altBase, supporting, coverage, frequencyPct }));
    // pysam at C448: depth 2, one read inserts AAA -> 50%.
    expect(insertions([carrier('c1', 250, 650), spans, starts])).toEqual([
      { refPosition: 449, altBase: 'AAA', supporting: 1, coverage: 2, frequencyPct: 50 },
    ]);
    // pysam at C448: depth 3, two reads insert AAA -> 66.7%.
    expect(insertions([carrier('c1', 250, 650), carrier('c2', 200, 600), spans, starts])).toEqual([
      { refPosition: 449, altBase: 'AAA', supporting: 2, coverage: 3, frequencyPct: 66.7 },
    ]);

    // SAM import counts the same way at a read's edge. 'trail' ends on C448 with AAA after it (a
    // carrier); 'ends' ends on C448 without one (covers the anchor); 'edge' starts with AAA before
    // G449, so it has no anchor base in it and, as in the pileup, is not counted at all.
    // pysam at C448: depth 3 (trail, spans, ends), AAA in 1 -> 33.3%; the carrier's three inserted
    // bases are Q30, Q20, Q10 ('?', '5', '+'), so the allele's mean quality is 20.
    const sam = [
      '@SQ\tSN:ref\tLN:1200',
      ['edge', 0, 'ref', 449, 60, '3I100M', '*', 0, 0, 'AAA' + ref.slice(448, 548), '*'].join('\t'),
      ['trail', 0, 'ref', 301, 60, '148M3I', '*', 0, 0, ref.slice(300, 448) + 'AAA', 'I'.repeat(148) + '?5+'].join('\t'),
      ['spans', 0, 'ref', 301, 60, '400M', '*', 0, 0, ref.slice(300, 700), '*'].join('\t'),
      ['ends', 0, 'ref', 201, 60, '248M', '*', 0, 0, ref.slice(200, 448), '*'].join('\t'),
    ].join('\n');
    const imported = samToContigs(sam, 'edges.sam', [doc('ref', ref)], opts).contigs[0].contig;
    expect(imported.variants.map(({ refPosition, type, altBase, supporting, coverage, frequencyPct, meanQuality }) => ({ refPosition, type, altBase, supporting, coverage, frequencyPct, meanQuality }))).toEqual([
      { refPosition: 449, type: 'Insertion', altBase: 'AAA', supporting: 1, coverage: 3, frequencyPct: 33.3, meanQuality: 20 },
    ]);
  });
});
