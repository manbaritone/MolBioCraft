// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { benjaminiHochberg, differentialExpression, parseCountTable, simulatedCountTable, sizeFactors, twoSidedP } from '../core/expression';

describe('expression statistics', () => {
  it('BH and normal p-values', () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.2]);
    expect(q.map((x) => Number(x.toFixed(4)))).toEqual([0.04, 0.0533, 0.0533, 0.2]);
    expect(twoSidedP(1.959964)).toBeCloseTo(0.05, 4);
    expect(twoSidedP(0)).toBeCloseTo(1, 6);
  });
  it('median-of-ratios size factors recover library sizes', () => {
    // DESeq2 median of ratios (Anders & Huber 2010). A gene's log-ratio in a sample is its log
    // count minus its mean log count (the log of its geometric mean); a gene with a zero anywhere
    // has no finite geometric mean and drops out of every sample; a sample's size factor is
    // exp(median of its log-ratios). So every sample of one table has the same number of usable
    // genes, and two tables run the two median branches: five genes (odd) and six (even). Within
    // each sample every log-ratio is distinct (the closest two are 0.119 apart), so no tie lets an
    // off-by-one order statistic, a trimmed or plain mean, or total counts land on the median.
    //
    // Odd table, library sizes 1 : 2 : 3. Log-ratios by hand, ln(count / geometric mean):
    //   counts          geo. mean   sample 1  sample 2  sample 3
    //   40,  28,  21      28.6514    +0.3337   -0.0230   -0.3107
    //    0,  40,   6         -       (a zero: drops out)
    //    2, 102,  48      21.3939    -2.3700   +1.5619   +0.8081
    //   27,  26, 114      43.0937    -0.4675   -0.5053   +0.9728
    //   10,  20,  30      18.1712    -0.5973   +0.0959   +0.5014   <- exactly 10 * (1, 2, 3)
    //    8,  94,  27      27.2810    -1.2267   +1.2371   -0.0104
    // Sorted, the 10:20:30 gene is the third of five in every sample (sample 1: -2.3700 -1.2267
    // [-0.5973] -0.4675 +0.3337; sample 2: -0.5053 -0.0230 [+0.0959] +1.2371 +1.5619; sample 3:
    // -0.3107 -0.0104 [+0.5014] +0.8081 +0.9728), and its log-ratios are ln((1, 2, 3) / 6^(1/3)),
    // so the size factors are (1, 2, 3) / 6^(1/3) = 0.550321, 1.100642, 1.650964: the library
    // sizes, exactly. PyDESeq2 0.4.12 deseq2_norm on the same counts: 0.5503212081491043,
    // 1.1006424162982082, 1.6509636244473127. Wrong rules miss in every sample: the next order
    // statistic up gives 0.6265, 3.4456, 2.2436 and down 0.2932, 0.9773, 0.9897; the mean without
    // the two extremes 0.4659, 1.5475, 1.5419; the mean 0.4208, 1.6053, 1.4803; total counts over
    // their geometric mean 0.4630, 1.6498, 1.3092.
    const odd = [[40, 28, 21], [0, 40, 6], [2, 102, 48], [27, 26, 114], [10, 20, 30], [8, 94, 27]];
    //
    // Even table, library sizes 2 : 1 : 4 (geometric mean 2):
    //   counts          geo. mean   sample 1  sample 2  sample 3
    //   64,  55,   8      30.4236    +0.7437   +0.5921   -1.3358
    //   40,  10,  80      31.7480    +0.2310   -1.1552   +0.9242   <- 20, 10, 20 per unit library
    //   12,   0,  30         -       (a zero: drops out)
    //   32,  19, 832      79.6787    -0.9123   -1.4336   +2.3458
    //   48,   2,  48      16.6407    +1.0594   -2.1187   +1.0594
    //   20,  20,  40      25.1984    -0.2310   -0.2310   +0.4621   <- 10, 20, 10 per unit library
    //   34, 137,  28      50.7130    -0.3998   +0.9938   -0.5940
    // The two marked genes multiply to 200 * (2, 1, 4)^2, so the mean of their log-ratios is
    // ln((2, 1, 4) / 2), and they are the third and fourth of six in every sample (sample 1: -0.9123
    // -0.3998 [-0.2310 +0.2310] +0.7437 +1.0594; sample 2: -2.1187 -1.4336 [-1.1552 -0.2310]
    // +0.5921 +0.9938; sample 3: -1.3358 -0.5940 [+0.4621 +0.9242] +1.0594 +2.3458), so the
    // even-count median, the mean of those two, gives size factors 1, 0.5, 2: the library sizes,
    // exactly. PyDESeq2 0.4.12 deseq2_norm on the same counts: 0.9999999999999998,
    // 0.49999999999999994, 1.9999999999999993. Wrong rules miss in every sample: the upper middle
    // value gives 1.2599, 0.7937, 2.5198 and the lower 0.7937, 0.3150, 1.5874; the middle pair
    // shifted up one 1.6280, 1.1979, 2.6960; the middle pair averaged as ratios, not logs, 1.0268,
    // 0.5543, 2.0536; the mean without the two extremes 1.0898, 0.5730, 1.5887; the mean 1.0853,
    // 0.5719, 1.6112; total counts over their geometric mean 0.6225, 0.6051, 2.6545.
    const even = [[64, 55, 8], [40, 10, 80], [12, 0, 30], [32, 19, 832], [48, 2, 48], [20, 20, 40], [34, 137, 28]];
    const cases: { counts: number[][]; pydeseq2: number[]; library: number[] }[] = [
      { counts: odd, pydeseq2: [0.5503212081491043, 1.1006424162982082, 1.6509636244473127], library: [1, 2, 3].map((s) => s / 6 ** (1 / 3)) },
      { counts: even, pydeseq2: [0.9999999999999998, 0.49999999999999994, 1.9999999999999993], library: [1, 0.5, 2] },
    ];
    for (const { counts, pydeseq2, library } of cases) {
      const sf = sizeFactors(counts);
      expect(sf).toHaveLength(3);
      sf.forEach((v, j) => {
        expect(v).toBeCloseTo(pydeseq2[j], 9);
        expect(v).toBeCloseTo(library[j], 9);
      });
    }
  });
  it('parses featureCounts output and skips HTSeq summary rows', () => {
    const t = parseCountTable('# Program:featureCounts\nGeneid\tChr\tStart\tEnd\tStrand\tLength\taln/s1.bam\taln/s2.bam\ng1\tchr1\t1\t100\t+\t100\t5\t7\n__no_feature\t\t\t\t\t\t3\t4\n');
    expect(t.format).toBe('featureCounts');
    expect(t.samples).toEqual(['s1', 's2']);
    expect(t.genes).toEqual(['g1']);
    expect(t.skipped).toBe(1);
  });
  it('controls false discoveries and finds most true changes on simulated NB data', () => {
    const { text, truth } = simulatedCountTable(11);
    const t = parseCountTable(text);
    const r = differentialExpression(t, {
      samplesA: ['ctrl_1', 'ctrl_2', 'ctrl_3'], samplesB: ['treat_1', 'treat_2', 'treat_3'], conditionA: 'ctrl', conditionB: 'treat',
      minTotal: 10, alpha: 0.1, lfcThreshold: 0, pcaGenes: 500,
    });
    // size factors follow the simulated library sizes 0.8, 1.0, 1.25, 0.9, 1.1, 1.3
    const sf = r.sizeFactors;
    expect(sf.ctrl_3 / sf.ctrl_1).toBeCloseTo(1.25 / 0.8, 1);
    const calls = r.genes.filter((g) => g.padj < 0.1);
    const falsePos = calls.filter((g) => !truth.has(g.gene)).length;
    const tested = new Set(r.genes.map((g) => g.gene));
    const trueTested = [...truth].filter((g) => tested.has(g)).length;
    expect(falsePos / Math.max(1, calls.length)).toBeLessThan(0.13);
    expect((calls.length - falsePos) / trueTested).toBeGreaterThan(0.6);
    // null p-values roughly uniform
    const nulls = r.genes.filter((g) => !truth.has(g.gene));
    const frac = nulls.filter((g) => g.pvalue < 0.05).length / nulls.length;
    expect(frac).toBeGreaterThan(0.02);
    expect(frac).toBeLessThan(0.09);
    // fold-change direction: GENE0001 (index 0) is 4x up
    const g1 = r.genes.find((g) => g.gene === 'GENE0001');
    if (g1) expect(g1.log2FC).toBeGreaterThan(1);
    // PCA separates the two conditions on PC1
    const a = r.pca.filter((p) => p.group === 'ctrl').map((p) => p.pc1);
    const b = r.pca.filter((p) => p.group === 'treat').map((p) => p.pc1);
    expect(Math.max(...a) < Math.min(...b) || Math.min(...a) > Math.max(...b)).toBe(true);
  });
});
