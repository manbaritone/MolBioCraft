// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { columnRuns, columnsToMask, parseCharset, stripColumns, translationAlign, type MaskOptions } from '../core/alignmentTools';
import { ConsensusDialog, MaskAlignmentDialog, alignmentRowsOf } from '../components/AlignmentToolDialogs';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { runEvolutionAnalysis } from '../core/evolutionAnalyses';
import type { SequenceDocument } from '../types/bio';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});
const noop = () => undefined;
const base: MaskOptions = { content: 'none', gapPct: 50, codonPositions: [], charset: '' };

describe('NEXUS CHARSET', () => {
  it('reads standard, stride, "." and vector styles (manual example: sites 2, 4-6)', () => {
    expect([...parseCharset('2 4-6', 10)].sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
    expect([...parseCharset('0101110000', 10)].sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
    expect([...parseCharset('1-.\\3', 10)]).toEqual([0, 3, 6, 9]);
    expect(() => parseCharset('2 x', 10)).toThrow(/not a site/);
    expect(() => parseCharset('0101', 10)).toThrow(/4 sites/);
    expect(() => parseCharset('11-12', 10)).toThrow(/outside/);
  });
});

describe('mask alignment', () => {
  const rows = ['AC-GTA', 'AC-GTN', 'ACTG-A'];
  it('selects columns by content and codon position', () => {
    const sel = (o: Partial<MaskOptions>) => [...columnsToMask(rows, false, { ...base, ...o })].sort((a, b) => a - b);
    expect(sel({ content: 'any-gaps' })).toEqual([2, 4]);
    expect(sel({ content: 'gap-pct', gapPct: 60 })).toEqual([2]);
    expect(sel({ content: 'identical' })).toEqual([0, 1, 3]);
    expect(sel({ content: 'ambiguities' })).toEqual([5]);
    expect(sel({ codonPositions: [3] })).toEqual([2, 5]);
    expect(sel({ content: 'all-gaps' })).toEqual([]);
  });
  it('strips columns and reports contiguous runs', () => {
    expect(stripColumns(rows, new Set([2, 4]))).toEqual(['ACGA', 'ACGN', 'ACGA']);
    expect(columnRuns(new Set([0, 1, 2, 5, 7, 8]))).toEqual([[1, 3], [6, 6], [8, 9]]);
  });
  it('the window needs an aligned document', () => {
    const coxii = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    expect(alignmentRowsOf(coxii)).not.toBeNull();
    const plasmid = SAMPLE_LIBRARY.find((d) => d.topology === 'circular')!;
    expect(renderToStaticMarkup(<MaskAlignmentDialog doc={plasmid} onCreate={noop} onUpdate={noop} onClose={noop} />)).toContain('works on an aligned document');
    expect(renderToStaticMarkup(<ConsensusDialog doc={coxii} onCreate={noop} onClose={noop} />)).toContain('residues)');
  });
});

describe('translation alignment', () => {
  it('keeps every codon intact and inserts gaps in whole codons', () => {
    const a = 'ATGGCTAAAGGTTGA';         // M A K G *
    const b = 'ATGGCTGGTTGA';            // M A G *   (K codon deleted)
    const c = 'CATGGCTAAAGGTTGA';        // extra base before frame 2 start? used with frame 1 below
    const res = translationAlign([{ id: 'a', name: 'a', sequence: a }, { id: 'b', name: 'b', sequence: b }, { id: 'c', name: 'c', sequence: c.slice(1) }], 1, 'Standard', '');
    expect(res.error).toBeNull();
    const nt = Object.fromEntries(res.rows.map((r) => [r.id, r.nucleotide]));
    expect(new Set(Object.values(nt).map((s) => s.length)).size).toBe(1);
    expect(nt.b.replace(/-/g, '')).toBe(b);
    // gaps come in multiples of three inside the coding part
    for (const s of Object.values(nt)) for (const g of s.match(/-+/g) ?? []) expect(g.length % 3).toBe(0);
    expect(nt.b).toContain('---');
  });
  it('keeps RNA as RNA', () => {
    const res = translationAlign([{ id: 'r', name: 'r', sequence: 'AUGGCUAAA' }, { id: 's', name: 's', sequence: 'AUGAAA' }], 1, 'Standard', '');
    expect(res.rows.find((x) => x.id === 'r')!.nucleotide.replace(/-/g, '')).toBe('AUGGCUAAA');
  });
  it('reports sequences with no complete codon', () => {
    expect(translationAlign([{ id: 'x', name: 'x', sequence: 'AT' }, { id: 'y', name: 'y', sequence: 'ATGAAA' }], 1, 'Standard', '').error).toMatch(/no complete codon/);
  });

  // BG-01M6X9NE: the bases after the last full codon (an incomplete stop codon, common in
  // mitochondrial coding sequences) take one 3-column slot of their own, so the width stays a
  // multiple of 3. Padding only to the longest tail gave 3k + 1 or 3k + 2.
  it('gives a trailing partial codon its own codon slot', () => {
    const inputs = [
      { id: 'two', name: 'two', sequence: 'ATGGCTAAAGG' }, // M A K + GG
      { id: 'none', name: 'none', sequence: 'ATGGCTAAA' }, // M A K
      { id: 'one', name: 'one', sequence: 'ATGGCTAAAG' }, // M A K + G
    ];
    const res = translationAlign(inputs, 1, 'Standard', '');
    expect(res.error).toBeNull();
    const nt = Object.fromEntries(res.rows.map((r) => [r.id, r.nucleotide]));
    // The trail is left-aligned in the one slot after the codon columns.
    expect(nt).toEqual({ two: 'ATGGCTAAAGG-', none: 'ATGGCTAAA---', one: 'ATGGCTAAAG--' });
    for (const d of inputs) expect(nt[d.id].replace(/-/g, ''), d.id).toBe(d.sequence);
    // With no partial codon anywhere there is no trailing slot at all.
    const whole = translationAlign([{ id: 'a', name: 'a', sequence: 'ATGGCTAAA' }, { id: 'b', name: 'b', sequence: 'ATGAAA' }], 1, 'Standard', '');
    expect(whole.rows.map((r) => r.nucleotide)).toEqual(['ATGGCTAAA', 'ATG---AAA']);
  });

  it('gives the bases before the frame their own codon slot', () => {
    // Frame 3: two bases before the frame; frame 2: one. The lead is right-aligned against the
    // first codon, so every codon of every row starts at a column that is a multiple of 3.
    const f3 = translationAlign([{ id: 'a', name: 'a', sequence: 'CCATGGCTAAA' }, { id: 'b', name: 'b', sequence: 'TCATGAAA' }], 3, 'Standard', '');
    expect(f3.error).toBeNull();
    expect(f3.rows.map((r) => r.nucleotide)).toEqual(['CCATGGCTAAA'.padStart(12, '-'), '-TCATG---AAA']);
    const f2 = translationAlign([{ id: 'a', name: 'a', sequence: 'CATGGCTAAAT' }, { id: 'b', name: 'b', sequence: 'ATGGCTAAA' }], 2, 'Standard', '');
    expect(f2.error).toBeNull();
    // b's frame-2 reading is TGG CTA AA: its lead "A" and trail "AA" each take a slot too.
    const rows = f2.rows.map((r) => r.nucleotide);
    for (const row of rows) expect(row.length % 3, row).toBe(0);
    expect(rows[0].slice(0, 3)).toBe('--C');
    expect(rows[1].slice(0, 3)).toBe('--A');
    for (const row of [...f3.rows.map((r) => r.nucleotide), ...rows]) {
      // Columns 3.. hold whole codons or whole gaps up to the trailing slot.
      const body = row.slice(3, row.length - (row.length > 12 ? 3 : 0));
      for (let c = 0; c + 3 <= body.length; c += 3) {
        const codon = body.slice(c, c + 3);
        expect(codon === '---' || !codon.includes('-'), `${row} codon at ${c + 3}`).toBe(true);
      }
    }
  });

  it('codon usage accepts a translation alignment with a trailing partial codon', () => {
    // Four coding sequences ending in incomplete stop codons (T, TA), as mitochondrial CDSs do.
    const inputs = [
      { id: 'a', name: 'a', sequence: 'ATGGCTAAAGGTCTGT' },
      { id: 'b', name: 'b', sequence: 'ATGGCCAAGGGACTTTA' },
      { id: 'c', name: 'c', sequence: 'ATGGCAAAAGGCCTCT' },
      { id: 'd', name: 'd', sequence: 'ATGGCGAAGGGGTTATA' },
    ];
    const res = translationAlign(inputs, 1, 'Standard', '');
    expect(res.error).toBeNull();
    const base = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    const docs = res.rows.map((r) => ({ ...base, id: r.id, name: r.name, sequence: r.nucleotide, alignmentMeta: undefined, features: [], documentKind: undefined } as SequenceDocument));
    expect(docs[0].sequence.length % 3).toBe(0);
    const out = runEvolutionAnalysis(docs, 'models', { analysis: 'rscu' }, { sourceLabel: 'partial' });
    // Five full codons in each of four rows, read in frame; the partial stops are not codons.
    expect(out.summary).toBe('Codon usage of 20 codons');
  });
});
