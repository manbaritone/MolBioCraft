// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { formatQcReport, readQcModules } from '../core/readQc';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';

const flag = (mods: ReturnType<typeof readQcModules>, t: string) => mods.find((m) => m.title.startsWith(t))!.flag;

describe('read QC report', () => {
  it('flags duplication, adapters and N content using FastQC thresholds', () => {
    const adapter = 'ACGTTGCAAGATCGGAAGAGCACACGTCT';
    const reads = [
      ...Array.from({ length: 6 }, () => ({ name: 'd', sequence: 'ACGTACGTACGTACGTACGT' })),
      { name: 'a', sequence: adapter }, { name: 'n', sequence: 'NNNNNACGTACGTACGTACG' }, { name: 'x', sequence: 'GGGCCCAAATTTGGGCCCAA' }, { name: 'y', sequence: 'TTTAAACCCGGGTTTAAACC' },
    ];
    const m = readQcModules(reads);
    expect(flag(m, 'Sequence duplication')).toBe('WARN'); // 5 of 10 duplicates = 50% (fail is > 50%)
    expect(flag(m, 'Adapter content')).toBe('WARN'); // 1 of 10 = 10% → warn (fail is > 10%)
    expect(flag(m, 'Per-base N content')).toBe('WARN'); // 10% N at positions 1–5
    expect(flag(m, 'Per-base sequence quality')).toBe('INFO');

    // Each threshold at its boundary, on 100 distinct adapter-free 30-mers. FastQC compares
    // strictly (NContent / AdapterContent: percentage > limit; DuplicationLevel: % remaining after
    // deduplication < limit), with limits.txt n_content 5 / 20 and adapter 5 / 10, and its
    // Duplicate Sequences help page: warn when non-unique reads are > 20%, fail when > 50%. (The
    // shipped limits.txt has duplication warn 70% remaining, i.e. > 30% non-unique: the 20% warn
    // here follows the help page; the 50% fail agrees with both.)
    let s = 4242;
    const base = Array.from({ length: 100 }, () => Array.from({ length: 30 }, () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return 'ACGT'[(s >>> 16) & 3];
    }).join(''));
    expect(new Set(base).size).toBe(100);
    const clean = readQcModules(base.map((sequence, i) => ({ name: `r${i}`, sequence })));
    expect(['Sequence duplication', 'Adapter content', 'Per-base N content'].map((t) => flag(clean, t))).toEqual(['PASS', 'PASS', 'PASS']);
    const withEdit = (k: number, edit: (q: string) => string) => base.map((q, i) => ({ name: `r${i}`, sequence: i < k ? edit(q) : q }));
    const dup = (k: number) => flag(readQcModules(base.map((q, i) => ({ name: `r${i}`, sequence: i < k ? base[99] : q }))), 'Sequence duplication');
    expect([20, 21, 50, 51].map(dup)).toEqual(['PASS', 'WARN', 'WARN', 'FAIL']); // k of 100 reads are duplicates
    const adapt = (k: number) => flag(readQcModules(withEdit(k, (q) => q.slice(0, 10) + 'AGATCGGAAGAG' + q.slice(22))), 'Adapter content');
    expect([5, 6, 10, 11].map(adapt)).toEqual(['PASS', 'WARN', 'WARN', 'FAIL']); // k% of reads carry the adapter
    const nAt1 = (k: number) => flag(readQcModules(withEdit(k, (q) => 'N' + q.slice(1))), 'Per-base N content');
    expect([5, 6, 20, 21].map(nAt1)).toEqual(['PASS', 'WARN', 'WARN', 'FAIL']); // k% N at position 1
  });
  it('uses trace qualities when present', () => {
    const traces = SAMPLE_LIBRARY.filter((d) => d.chromatogram?.phredScores?.length)
      .map((d) => ({ name: d.name, sequence: d.chromatogram!.baseCalls || d.sequence, qualities: d.chromatogram!.phredScores }));
    const m = readQcModules(traces);
    expect(['PASS', 'WARN', 'FAIL']).toContain(flag(m, 'Per-base sequence quality'));
    const text = formatQcReport('QC', m);
    expect(text).toMatch(/## Summary/);
    expect(text).toMatch(/Reads with base qualities: 3/);
  });
});
