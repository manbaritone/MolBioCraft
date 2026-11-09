// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { addSequencesToAlignment } from '../core/alignmentTools';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';

describe('add sequences to an alignment', () => {
  const rows = [
    { name: 'a', sequence: 'ATGGCT--AAAGGT' },
    { name: 'b', sequence: 'ATGGCTCCAAAGGT' },
    { name: 'c', sequence: 'ATGGCT--AAACGT' },
  ];
  it('keeps the existing rows unchanged apart from new gap columns', () => {
    const r = addSequencesToAlignment(rows, [{ name: 'new', sequence: 'ATGGCTCCTTTAAAGGT' }], false);
    const w = r.rows[0].sequence.length;
    expect(r.rows.every((x) => x.sequence.length === w)).toBe(true);
    // existing rows keep their residues and relative gaps
    for (const [i, row] of rows.entries()) expect(r.rows[i].sequence.replace(/-/g, '')).toBe(row.sequence.replace(/-/g, ''));
    expect(r.rows[3].sequence.replace(/-/g, '')).toBe('ATGGCTCCTTTAAAGGT');
    expect(r.rows[3].added).toBe(true);
    // an insertion of 3 bases opened 3 new columns
    expect(w).toBe(rows[0].sequence.length + 3);
  });
  it('adds a sequence with a deletion without new columns', () => {
    const r = addSequencesToAlignment(rows, [{ name: 'del', sequence: 'ATGGCTAAAGGT' }], false);
    expect(r.rows[0].sequence.length).toBe(rows[0].sequence.length);
    expect(r.rows[3].sequence).toBe('ATGGCT--AAAGGT');
  });
  it('works on a real alignment (COXII + one of its own rows, ungapped)', () => {
    const cox = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!.alignmentMeta!.sequences!;
    const base = cox.slice(0, 10).map((m) => ({ name: m.name, sequence: m.sequence }));
    const extra = { name: 'extra', sequence: cox[20].sequence.replace(/-/g, '') };
    const r = addSequencesToAlignment(base, [extra], false);
    expect(r.rows[10].sequence.replace(/-/g, '')).toBe(extra.sequence.toUpperCase());
    expect(r.identities[0]).toBeGreaterThan(60);
  });
});
