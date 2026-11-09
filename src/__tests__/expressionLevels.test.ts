// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { countReads, normalise, type GeneRegion } from '../core/expressionLevels';
import { COUNT_TABLE_KEY, runCalculateExpressionLevels, runMapToReferences } from '../core/operationRunners';
import { parseCountTable } from '../core/expression';
import type { SequenceDocument } from '../types/bio';

const puc = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;

function reads(prefix: string, plan: [number, number, number][]): SequenceDocument[] {
  // plan: [count, regionStart, regionEnd] — 120-bp reads tiled across the region
  const out: SequenceDocument[] = [];
  let k = 0;
  for (const [n, s, e] of plan) {
    for (let i = 0; i < n; i++) {
      const start = s + Math.floor(((e - s - 120) * i) / Math.max(1, n - 1));
      out.push({ ...puc, id: `${prefix}${k}`, name: `${prefix}_r${k++}`, sequence: puc.sequence.slice(start - 1, start - 1 + 120), features: [], topology: 'linear', documentKind: undefined } as SequenceDocument);
    }
  }
  return out;
}

describe('expression levels', () => {
  it('counts, splits ambiguous reads, and normalises', () => {
    const genes: GeneRegion[] = [{ name: 'a', start: 1, end: 1000, length: 1000 }, { name: 'b', start: 900, end: 2900, length: 2001 }];
    const r = countReads([{ start: 10, end: 100 }, { start: 950, end: 1050 }, { start: 2000, end: 2100 }, { start: 5000, end: 5100 }], genes, 10, 'split');
    expect(r.counts).toEqual([1.5, 1.5]);
    expect(r.unassigned).toBe(1);
    expect(r.ambiguous).toBe(1);
    const { tpm, fpkm } = normalise([10, 20], genes, 30);
    expect(tpm[0] + tpm[1]).toBeCloseTo(1e6, 3);
    expect(fpkm[0]).toBeCloseTo(10 / 1 / (30 / 1e6), 3);
  });
  it('counts mapped reads per gene on a real mapping and builds a count table', () => {
    const map = (prefix: string, plan: [number, number, number][]) =>
      runMapToReferences([puc], reads(prefix, plan), { minIdentity: 90, minLength: 50 }, { sourceLabel: prefix }).created[0];
    // sample A: AmpR 20, ori 10; sample B: AmpR 5, ori 30
    const a = { ...map('A', [[20, 1640, 2470], [10, 880, 1440]]), name: 'sampleA contig' };
    const b = { ...map('B', [[5, 1640, 2470], [30, 880, 1440]]), name: 'sampleB contig' };
    const docs = new Map([[puc.id, puc]]);
    const r = runCalculateExpressionLevels([a, b], (id) => docs.get(id), { featureTypes: 'CDS,rep_origin', minOverlap: 10 }, { sourceLabel: 'x' });
    const table = parseCountTable(String(r.created[0].docMetadata?.[COUNT_TABLE_KEY]));
    expect(table.samples).toEqual(['sampleA', 'sampleB']);
    const row = (g: string) => table.counts[table.genes.indexOf(g)];
    expect(row('AmpR (bla TEM-1)')).toEqual([20, 5]);
    expect(row('pMB1 / ColE1 ori')).toEqual([10, 30]);
    expect(row('lacZ-alpha')).toEqual([0, 0]);
    expect(String(r.created[0].docMetadata?.Notes)).toMatch(/TPM/);
  });
});
