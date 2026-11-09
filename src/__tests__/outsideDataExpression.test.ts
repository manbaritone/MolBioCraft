// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Compare Expression Levels against Bioconductor DESeq2 on the pasilla RNA-seq counts (Brooks et al. 2011;
 * Bioconductor `pasilla`), from `scripts/outside-data/ref_deseq2.R`. Skipped without test-data.
 */

import { describe, expect, it } from 'vitest';
import { differentialExpression, parseCountTable } from '../core/expression';
import { dataPath, haveTestData } from './testData';

interface NodeFs { existsSync: (p: string) => boolean; readFileSync: (p: string, e: string) => string }
let fs: NodeFs | null = null;
try { const spec: string = 'node:fs'; fs = (await import(/* @vite-ignore */ spec)) as NodeFs; } catch { fs = null; }
const REF = dataPath('reference/deseq2_R_pasilla.json');
const COUNTS = dataPath('pasilla/pasilla_gene_counts.tsv');
const have = haveTestData(REF, COUNTS);

describe.skipIf(!have)('differential expression against Bioconductor DESeq2 (pasilla)', () => {
  it('size factors, fold changes, p-values and the significant set agree', () => {
    const ref = JSON.parse(fs!.readFileSync(REF, 'utf8'));
    const t = parseCountTable(fs!.readFileSync(COUNTS, 'utf8'));
    const A = t.samples.filter((s) => s.startsWith('untreated'));
    const B = t.samples.filter((s) => s.startsWith('treated'));
    const r = differentialExpression(t, { samplesA: A, samplesB: B, conditionA: 'untreated', conditionB: 'treated', minTotal: 10, alpha: 0.1, lfcThreshold: 0, pcaGenes: 500 });
    for (const [s, v] of Object.entries(ref.size_factors) as [string, number][]) expect(r.sizeFactors[s], s).toBeCloseTo(v, 6);
    const pairs = r.genes.filter((g) => ref.genes[g.gene] && ref.genes[g.gene].baseMean > 10);
    const corr = (x: number[], y: number[]) => {
      const mx = x.reduce((a, b) => a + b, 0) / x.length; const my = y.reduce((a, b) => a + b, 0) / y.length;
      let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
      return sxy / Math.sqrt(sxx * syy);
    };
    const lfcR = corr(pairs.map((g) => g.log2FC), pairs.map((g) => ref.genes[g.gene].log2FoldChange));
    const lfcMaxDev = Math.max(...pairs.map((g) => Math.abs(g.log2FC - ref.genes[g.gene].log2FoldChange)));
    const lp = (p: number) => -Math.log10(Math.max(p, 1e-300));
    const withP = pairs.filter((g) => ref.genes[g.gene].pvalue != null && Number.isFinite(g.pvalue));
    const pR = corr(withP.map((g) => lp(g.pvalue)), withP.map((g) => lp(ref.genes[g.gene].pvalue)));
    const dispR = corr(pairs.map((g) => Math.log(g.dispersion)), pairs.map((g) => Math.log(ref.dispersions[g.gene])));
    const sigRef = new Set(Object.entries(ref.genes).filter(([, v]) => (v as { padj: number | null }).padj != null && (v as { padj: number }).padj < 0.1).map(([k]) => k));
    const sigApp = new Set(r.genes.filter((g) => g.padj < 0.1).map((g) => g.gene));
    const both = [...sigApp].filter((g) => sigRef.has(g)).length;
    const recall = both / sigRef.size;
    const precision = both / Math.max(1, sigApp.size);
    const summary = `log2FC r ${lfcR.toFixed(4)} (max |Δ| ${lfcMaxDev.toFixed(3)}), −log10 p r ${pR.toFixed(4)}, log dispersion r ${dispR.toFixed(4)}; significant (padj < 0.1): app ${sigApp.size}, DESeq2 ${sigRef.size}, shared ${both} (recall ${recall.toFixed(3)}, precision ${precision.toFixed(3)})`;
    console.log('DESEQ2', summary);
    expect(lfcR, summary).toBeGreaterThan(0.9999);
    expect(lfcMaxDev, summary).toBeLessThan(0.1);
    expect(pR, summary).toBeGreaterThan(0.999);
    expect(dispR, summary).toBeGreaterThan(0.998);
    expect(recall, summary).toBeGreaterThan(0.98);
    expect(precision, summary).toBeGreaterThan(0.98);
  });
});
