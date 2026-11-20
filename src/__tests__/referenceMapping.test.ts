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

// Oracle for the rows below: pysam 0.24.1 (htslib pileup) over the SAM fixtures these tests write,
// converted with pysam.view('-b') and indexed, then read with
//   AlignmentFile(bam).pileup('ref', start, end, truncate=True, stepper='nofilter', min_base_quality=0)
// The column's nsegments is the coverage; a read's PileupRead.indel at a base is the indel after
// it (VCF POS), and its query base there is the SNP call. Every CIGAR is written by hand from how
// the read is built, never from this engine's output.
describe('variant table edge cases against a pysam pileup', () => {
  const rec = (name: string, pos: number, cigar: string, seq: string) => [name, 0, 'ref', pos, 60, cigar, '*', 0, 0, seq, '*'].join('\t');
  const sam = (...records: string[]) => ['@HD\tVN:1.6\tSO:coordinate', '@SQ\tSN:ref\tLN:1200', ...records].join('\n') + '\n';
  const rows = (text: string) => samToContigs(text, 'fixture.sam', [doc('ref', ref)], opts).contigs[0].contig.variants;

  it('reports a multi-base deletion as one allele', () => {
    // 1-based 150-153 read ACCG; deleting CCG (151-153) has one placement: A150 is not G and
    // C151 is not T154, so it neither shifts left nor right.
    expect(ref.slice(149, 154)).toBe('ACCGT');
    // pysam at A150: depth 2, 'del' carries indel -3 -> one allele, VCF POS 150, REF ACCG, ALT A.
    expect(rows(sam(
      rec('del', 101, '50M3D50M', ref.slice(100, 150) + ref.slice(153, 203)),
      rec('plain', 101, '103M', ref.slice(100, 203)),
    ))).toEqual([
      { refPosition: 150, column: 150, type: 'Deletion', refBase: 'ACCG', altBase: 'A', supporting: 1, coverage: 2, frequencyPct: 50, meanQuality: null },
    ]);
    // A shorter deletion at the same anchor is its own allele, and two deletions one read carries
    // apart are two alleles. pysam at A150: depth 4, indel -3 in 'del' and 'twoDel', -2 in 'del2';
    // at G163: depth 4, indel -2 in 'twoDel' (it deletes 164-165, CG).
    expect(ref.slice(162, 165)).toBe('GCG');
    expect(rows(sam(
      rec('del', 101, '50M3D50M', ref.slice(100, 150) + ref.slice(153, 203)),
      rec('del2', 101, '50M2D51M', ref.slice(100, 150) + ref.slice(152, 203)),
      rec('twoDel', 101, '50M3D10M2D40M', ref.slice(100, 150) + ref.slice(153, 163) + ref.slice(165, 205)),
      rec('plain', 101, '103M', ref.slice(100, 203)),
    ))).toEqual([
      { refPosition: 150, column: 150, type: 'Deletion', refBase: 'ACCG', altBase: 'A', supporting: 2, coverage: 4, frequencyPct: 50, meanQuality: null },
      { refPosition: 150, column: 150, type: 'Deletion', refBase: 'ACC', altBase: 'A', supporting: 1, coverage: 4, frequencyPct: 25, meanQuality: null },
      { refPosition: 163, column: 163, type: 'Deletion', refBase: 'GCG', altBase: 'G', supporting: 1, coverage: 4, frequencyPct: 25, meanQuality: null },
    ]);
    // Map to Reference: the engine calls each deleted base on its own; the table joins them.
    const m = mapReadsToReference(doc('ref', ref), [doc('del', ref.slice(100, 150) + ref.slice(153, 300)), doc('plain', ref.slice(100, 300))], opts);
    expect(m.mapped.find((r) => r.doc.id === 'del')!.variants.map((v) => `${v.type}${v.position}${v.refBase}`)).toEqual(['Deletion151C', 'Deletion152C', 'Deletion153G']);
    expect(m.variants).toEqual([
      { refPosition: 150, column: 150, type: 'Deletion', refBase: 'ACCG', altBase: 'A', supporting: 1, coverage: 2, frequencyPct: 50, meanQuality: null },
    ]);
  });

  it('read-edge coverage matches a pysam pileup', () => {
    const a = [...ref.slice(300, 400)];
    a[0] = 'C'; // A301 -> C, the read's first base
    a[99] = 'A'; // G400 -> A, its last base
    expect([ref[300], ref[399], ref.slice(610, 614), ref.slice(800, 802)]).toEqual(['A', 'G', 'CTTA', 'AA']);
    const text = sam(
      rec('before', 201, '100M', ref.slice(200, 300)), // ends at 300, beside snpEdges' first base
      rec('coverFirst', 251, '100M', ref.slice(250, 350)),
      rec('snpEdges', 301, '100M', a.join('')),
      rec('coverLast', 351, '100M', ref.slice(350, 450)),
      rec('after', 401, '100M', ref.slice(400, 500)), // starts at 401, beside snpEdges' last base
      rec('beforeDel', 511, '100M', ref.slice(510, 610)), // ends at 610, beside the deletion's anchor
      rec('endsAtAnchor', 512, '100M', ref.slice(511, 611)), // ends on the anchor: covers it, not the deleted bases
      rec('coverDel', 561, '100M', ref.slice(560, 660)),
      rec('delEdge', 611, '1M3D100M', ref[610] + ref.slice(614, 714)), // anchor C611 is its first base
      rec('beforeIns', 701, '100M', ref.slice(700, 800)), // ends at 800, beside the insertion's anchor
      rec('coverIns', 751, '100M', ref.slice(750, 850)),
      rec('insEdge', 801, '1M3I100M', ref[800] + 'CAG' + ref.slice(801, 901)), // anchor A801 is its first base
      rec('coverLead', 901, '100M', ref.slice(900, 1000)),
      rec('leadIns', 951, '3I100M', 'TTT' + ref.slice(950, 1050)), // no anchor base in the read
      rec('coverLeadDel', 1051, '100M', ref.slice(1050, 1150)),
      rec('leadDel', 1101, '2D50M', ref.slice(1102, 1152)), // nor here: its first base is deleted
    );
    // pysam: 301 depth 2 (coverFirst A, snpEdges C); 400 depth 2 (coverLast G, snpEdges A);
    // 611 depth 3 (coverDel C, delEdge C-3, endsAtAnchor C; 612 has depth 2); 801 depth 2 (coverIns A,
    // insEdge A+CAG); 950 depth 1 (coverLead T, no indel) and 1100 depth 1 (coverLeadDel C, no indel):
    // leadIns and leadDel are not in the pileup at the base before them, so neither is a call.
    // The insertion's row keeps this table's convention: the base it precedes (802), counted at its anchor.
    expect(rows(text)).toEqual([
      { refPosition: 301, column: 301, type: 'SNP', refBase: 'A', altBase: 'C', supporting: 1, coverage: 2, frequencyPct: 50, meanQuality: null },
      { refPosition: 400, column: 400, type: 'SNP', refBase: 'G', altBase: 'A', supporting: 1, coverage: 2, frequencyPct: 50, meanQuality: null },
      { refPosition: 611, column: 611, type: 'Deletion', refBase: 'CTTA', altBase: 'C', supporting: 1, coverage: 3, frequencyPct: 33.3, meanQuality: null },
      { refPosition: 802, column: 802, type: 'Insertion', refBase: '-', altBase: 'CAG', supporting: 1, coverage: 2, frequencyPct: 50, meanQuality: null },
    ]);
  });
});
