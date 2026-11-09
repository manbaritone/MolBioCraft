// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Read QC report in the style of FastQC (FastQC chapter): basic statistics, per-base
 * quality, per-read quality, N content, GC content, length distribution, duplication,
 * adapter content and overrepresented sequences, each with PASS / WARN / FAIL.
 * Thresholds follow FastQC's documented defaults where a module has one.
 */

export type QcFlag = 'PASS' | 'WARN' | 'FAIL';

export interface QcRead { name: string; sequence: string; qualities?: number[] }

export interface QcModule { title: string; flag: QcFlag | 'INFO'; lines: string[] }

export const ADAPTERS: { name: string; seq: string }[] = [
  { name: 'Illumina Universal', seq: 'AGATCGGAAGAG' },
  { name: 'Illumina Small RNA 3′', seq: 'TGGAATTCTCGG' },
  { name: 'Nextera Transposase', seq: 'CTGTCTCTTATA' },
  { name: 'SOLiD', seq: 'CGCCTTGGCCGT' },
];

const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);
const f1 = (x: number) => x.toFixed(1);

export function readQcModules(reads: QcRead[], binSize = 10): QcModule[] {
  const seqs = reads.map((r) => r.sequence.toUpperCase().replace(/[^A-Z]/g, ''));
  const n = seqs.length;
  const lens = seqs.map((s) => s.length);
  const total = lens.reduce((a, b) => a + b, 0);
  const maxLen = Math.max(0, ...lens);
  const gcPerRead = seqs.map((s) => pct((s.match(/[GC]/g) ?? []).length, (s.match(/[ACGT]/g) ?? []).length || 1));
  const gcAll = pct(seqs.reduce((a, s) => a + (s.match(/[GC]/g) ?? []).length, 0), seqs.reduce((a, s) => a + (s.match(/[ACGT]/g) ?? []).length, 0));
  const withQ = reads.filter((r) => r.qualities?.length);
  const modules: QcModule[] = [];

  modules.push({
    title: 'Basic statistics', flag: 'PASS', lines: [
      `Reads: ${n.toLocaleString()}`,
      `Total bases: ${total.toLocaleString()}`,
      `Read length: ${Math.min(...lens)}–${maxLen} (mean ${f1(total / Math.max(1, n))})`,
      `GC: ${f1(gcAll)}%`,
      `Reads with base qualities: ${withQ.length.toLocaleString()}`,
    ],
  });

  // Per-base quality (mean per position bin) — FastQC: warn if any bin lower quartile < 10 or median < 25; we use the mean.
  if (withQ.length) {
    const bins: { sum: number; count: number }[] = [];
    for (const r of withQ) r.qualities!.forEach((q, i) => {
      const b = Math.floor(i / binSize);
      bins[b] = bins[b] ?? { sum: 0, count: 0 };
      bins[b].sum += q;
      bins[b].count += 1;
    });
    const means = bins.map((b) => b.sum / b.count);
    const worst = Math.min(...means);
    modules.push({
      title: 'Per-base sequence quality (mean Phred per position)',
      flag: worst < 20 ? 'FAIL' : worst < 28 ? 'WARN' : 'PASS',
      lines: means.map((m, i) => `${String(i * binSize + 1).padStart(5)}–${String(Math.min((i + 1) * binSize, maxLen)).padEnd(5)} ${f1(m).padStart(5)}  ${'█'.repeat(Math.round(m / 2))}`),
    });
    const perRead = withQ.map((r) => r.qualities!.reduce((a, b) => a + b, 0) / r.qualities!.length);
    const low = perRead.filter((q) => q < 20).length;
    const mid = perRead.filter((q) => q >= 20 && q < 30).length;
    const high = perRead.length - low - mid;
    const modeQ = perRead.sort((a, b) => a - b)[Math.floor(perRead.length / 2)];
    modules.push({
      title: 'Per-read quality',
      flag: modeQ < 20 ? 'FAIL' : modeQ < 27 ? 'WARN' : 'PASS',
      lines: [`Mean quality < Q20: ${low} reads (${f1(pct(low, perRead.length))}%)`, `Q20–Q30: ${mid} (${f1(pct(mid, perRead.length))}%)`, `≥ Q30: ${high} (${f1(pct(high, perRead.length))}%)`, `Median of read means: Q${f1(modeQ)}`],
    });
  } else {
    modules.push({ title: 'Per-base sequence quality', flag: 'INFO', lines: ['No base qualities in these reads (FASTA or plain sequences).'] });
  }

  // N content per position — FastQC: warn > 5%, fail > 20%.
  const nByPos = new Array(maxLen).fill(0);
  const covByPos = new Array(maxLen).fill(0);
  for (const s of seqs) for (let i = 0; i < s.length; i++) { covByPos[i]++; if (s[i] === 'N') nByPos[i]++; }
  const worstN = Math.max(0, ...nByPos.map((x, i) => pct(x, covByPos[i])));
  modules.push({ title: 'Per-base N content', flag: worstN > 20 ? 'FAIL' : worstN > 5 ? 'WARN' : 'PASS', lines: [`Highest N fraction at any position: ${f1(worstN)}%`] });

  // GC distribution — FastQC compares to a normal fit; we report the spread and flag a wide one.
  const meanGc = gcPerRead.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sdGc = Math.sqrt(gcPerRead.reduce((a, b) => a + (b - meanGc) ** 2, 0) / Math.max(1, n));
  const hist = new Array(10).fill(0);
  gcPerRead.forEach((g) => { hist[Math.min(9, Math.floor(g / 10))]++; });
  modules.push({
    title: 'Per-read GC content',
    flag: n >= 20 && sdGc > 15 ? 'WARN' : 'PASS',
    lines: [`Mean ${f1(meanGc)}%, SD ${f1(sdGc)}%`, ...hist.map((c, i) => `${String(i * 10).padStart(3)}–${String(i * 10 + 10).padEnd(3)}% ${String(c).padStart(6)}  ${'█'.repeat(Math.round(pct(c, n) / 2))}`)],
  });

  // Length distribution — FastQC warns when lengths differ, fails on zero-length reads.
  const zero = lens.filter((l) => l === 0).length;
  const distinct = new Set(lens).size;
  modules.push({ title: 'Read length distribution', flag: zero ? 'FAIL' : distinct > 1 ? 'WARN' : 'PASS', lines: [`${distinct} distinct length${distinct === 1 ? '' : 's'}${zero ? `; ${zero} empty reads` : ''}`] });

  // Duplication — FastQC: warn > 20% non-unique, fail > 50%.
  const counts = new Map<string, number>();
  seqs.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
  const unique = counts.size;
  const dupPct = pct(n - unique, n);
  modules.push({ title: 'Sequence duplication', flag: dupPct > 50 ? 'FAIL' : dupPct > 20 ? 'WARN' : 'PASS', lines: [`${unique.toLocaleString()} distinct sequences; ${f1(dupPct)}% of reads are duplicates`] });

  // Overrepresented sequences — FastQC: warn > 0.1% of reads, fail > 1% (needs a meaningful read count).
  const over = Array.from(counts).filter(([, c]) => n >= 100 && pct(c, n) > 0.1).sort((a, b) => b[1] - a[1]).slice(0, 10);
  modules.push({
    title: 'Overrepresented sequences',
    flag: over.some(([, c]) => pct(c, n) > 1) ? 'FAIL' : over.length ? 'WARN' : 'PASS',
    lines: n < 100 ? ['Not assessed (fewer than 100 reads).'] : over.length ? over.map(([s, c]) => `${f1(pct(c, n))}%  ${s.slice(0, 50)}${s.length > 50 ? '…' : ''}`) : ['None above 0.1% of reads.'],
  });

  // Adapter content — FastQC: warn > 5% of reads, fail > 10%.
  const adapterLines = ADAPTERS.map((a) => {
    const hits = seqs.filter((s) => s.includes(a.seq)).length;
    return { name: a.name, p: pct(hits, n) };
  });
  const worstA = Math.max(...adapterLines.map((a) => a.p));
  modules.push({ title: 'Adapter content', flag: worstA > 10 ? 'FAIL' : worstA > 5 ? 'WARN' : 'PASS', lines: adapterLines.map((a) => `${a.name}: ${f1(a.p)}% of reads`) });

  return modules;
}

export function formatQcReport(title: string, modules: QcModule[]): string {
  const summary = modules.map((m) => `${m.flag.padEnd(4)}  ${m.title}`).join('\n');
  const body = modules.map((m) => `## [${m.flag}] ${m.title}\n${m.lines.join('\n')}`).join('\n\n');
  return `# ${title}\n\n## Summary\n${summary}\n\n${body}\n`;
}
