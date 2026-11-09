// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1C1: the Genomics studio hands the HMM segmentation, the JASPAR TF motif scan and the
 * minimizer chainer the whole sequence (it used to hand them its first 100, 60 and 120 kb, and
 * show the results as the genome's), and when the engine covers less than the sequence, the
 * result shows the range it covered, in the engine's words, beside it.
 *
 * The expected ranges are the test's own numbers: the documented 12,000,000-bp cap written out
 * here and the bases each document holds, counted here. The numbers the studio shows for a capped
 * result are checked against the engine run on the covered bases alone. Every number comes from
 * the real WASM engine; the sequences are generated from fixed seeds.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GenomicsNgsAndPredictionStudio } from '../components/GenomicsNgsAndPredictionStudio';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import { alignLargeGenomesMinimizerChainRust, scanJasparPssmMotifsRust, segmentGenomeHmmViterbiRust } from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

/** Deterministic pseudo-random bases (LCG), the same for the same seed. */
function randomBases(n: number, seed: number): string {
  let s = seed >>> 0;
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = 'ACGT'[s >>> 30];
  }
  return out.join('');
}

const doc = (id: string, name: string, sequence: string): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, moleculeType: 'DNA' });
const noop = () => {};
/** A count as the studio and the engine's warnings write it: digits grouped in threes. */
const n = (v: number) => v.toLocaleString('en-US');
/** The bases a sequence holds, counted letter by letter. */
const basesIn = (seq: string) => {
  let count = 0;
  for (let i = 0; i < seq.length; i++) if ('ACGTacgt'.includes(seq[i])) count++;
  return count;
};
const studio = (activeDoc: SequenceDocument, documents: SequenceDocument[], tab: 'genes-cpg-repeats' | 'genome-variants') =>
  renderToStaticMarkup(
    <GenomicsNgsAndPredictionStudio activeDoc={activeDoc} documents={documents} initialSubTab={tab}
      onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop} />
  );

/** `seq` with about one base in `per` replaced by a different base, and nothing else changed. */
function substitute(seq: string, per: number, seed: number): string {
  let s = seed >>> 0;
  const next = () => (s = (Math.imul(s, 22695477) + 1) >>> 0) >>> 16;
  const out = seq.split('');
  for (let i = 0; i < out.length; i++) {
    if (next() % per === 0) out[i] = 'ACGT'[('ACGT'.indexOf(out[i]) + 1 + (next() % 3)) % 4];
  }
  return out.join('');
}
const revcomp = (seq: string) => [...seq].reverse().map((b) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[b as 'A']).join('');

/** The words a stretch of markup shows: tags dropped, the entities React writes decoded. */
const wordsOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** The sentences of the warnings region with this accessible name, in order ([] when there is none). */
function warningsLabelled(html: string, label: string): string[] {
  const regions = [...html.matchAll(/<div([^>]*data-mbc-result-warnings[^>]*)>([\s\S]*?)<\/div>/g)]
    .filter((m) => /aria-label="([^"]*)"/.exec(m[1])?.[1] === label);
  expect(regions.length, `at most one "${label}" region`).toBeLessThanOrEqual(1);
  return regions.length ? [...regions[0][2].matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) => wordsOf(p[1])) : [];
}

/** The body rows drawn under the table caption that opens with `captionStart`, each as the words it shows. */
function rowsUnder(html: string, captionStart: string): string[] {
  const captions = [...html.matchAll(/<div[^>]*class="mbc-table-caption"[^>]*>([\s\S]*?)<\/div>/g)];
  const hit = captions.find((m) => wordsOf(m[1]).startsWith(captionStart));
  if (!hit) throw new Error(`no table caption opening "${captionStart}"`);
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(html.slice(hit.index! + hit[0].length))?.[1] ?? '';
  return [...body.matchAll(/<tr[\s>][\s\S]*?<\/tr>/g)].map((m) => wordsOf(m[0]));
}

/** A KPI box's value by its label, as the studio prints it. */
const kpi = (html: string, label: string) =>
  new RegExp(`<span class="kpi-label">${label.replace(/[/]/g, '\\/')}</span><strong class="kpi-val">([^<]*)</strong>`).exec(html)?.[1];

/** The documented cap on the bases the HMM segmentation, the TF scan and the chainer cover. */
const CAP = 12_000_000;

describe('genomics prefix', () => {
  it('shows the covered range for prefix-limited genomics analyses', () => {
    // ─── HMM segmentation and TF scan: a genome 250 kb past the cap ───
    // Its last 250 kb is GC-rich with a T7 promoter every 10 kb, so reading it would change both
    // the state fractions and the hit count.
    const tail = ('GGCGCCGCGGCC'.repeat(831) + 'TAATACGACTCACTATAGGG' + 'GCGCGCGC').repeat(25);
    const genome = randomBases(CAP, 0x5eed_c1c1) + tail;
    expect(scanJasparPssmMotifsRust(tail, 0.84).totalHits, 'fixture: the tail holds hits').toBeGreaterThan(0);
    const whole = basesIn(genome);
    expect(whole, 'fixture: 250,000 bases past the cap').toBe(CAP + 250_000);
    const big = doc('big', 'Genome past the cap', genome);
    const genes = studio(big, [big], 'genes-cpg-repeats');

    expect(warningsLabelled(genes, 'HMM segmentation warnings')).toEqual([
      `HMM segmentation covered only the first ${n(CAP)} bp of the ${n(whole)}-bp sequence; the state fractions and segments describe bases 1-${n(CAP)} only.`,
    ]);
    // the fractions shown are those of the covered bases: the engine on bases 1-12,000,000 alone
    const covered = segmentGenomeHmmViterbiRust(genome.slice(0, CAP));
    expect([kpi(genes, 'AT-Rich / Promoter'), kpi(genes, 'Balanced Coding'), kpi(genes, 'GC-Rich / CpG Island')]).toEqual([
      `${covered.atRichFractionPct}%`, `${covered.balancedCodingFractionPct}%`, `${covered.gcIslandFractionPct}%`,
    ]);

    const tf = warningsLabelled(genes, 'TF motif scan warnings');
    expect(tf[0]).toBe(
      `TF motif scan covered only the first ${n(CAP)} bp of the ${n(whole)}-bp sequence, on both strands; sites past base ${n(CAP)} are not reported.`
    );
    // the count shown is that of the covered bases: the engine on bases 1-12,000,000 alone
    const scanned = scanJasparPssmMotifsRust(genome.slice(0, CAP), 0.84);
    expect(wordsOf(genes)).toContain(`Transcription-factor motif scan, JASPAR PWMs (${scanned.totalHits} hits across ${scanned.motifsEvaluated} matrices)`);
    expect(tf.slice(1)).toEqual([`TF motif hit list capped: it lists the 250 best-scoring of the ${n(scanned.totalHits)} hits found.`]);
    const tfRows = rowsUnder(genes, 'Best-scoring binding sites, every matrix');
    expect(tfRows).toHaveLength(250);
    expect(wordsOf(genes)).toContain(`Best-scoring binding sites, every matrix (top 250 of ${n(scanned.totalHits)})`);

    // a genome inside the cap is covered whole: no range to show
    const plasmidSized = doc('small', 'Inside the cap', randomBases(300_000, 0x5eed_c1c2));
    const inside = studio(plasmidSized, [plasmidSized], 'genes-cpg-repeats');
    expect(warningsLabelled(inside, 'HMM segmentation warnings')).toEqual([]);
    expect(warningsLabelled(inside, 'TF motif scan warnings').filter((w) => w.includes('covered only'))).toEqual([]);
    // 300 kb is past the 100 kb and 60 kb the studio used to hand these scans: the segments run
    // to the end of the sequence, and the hit count is the whole sequence's
    expect(wordsOf(inside)).toContain(`(${scanJasparPssmMotifsRust(plasmidSized.sequence, 0.84).totalHits} hits across`);
    const lastSegmentEnd = segmentGenomeHmmViterbiRust(plasmidSized.sequence).segments.at(-1)?.end;
    expect(lastSegmentEnd).toBe(300_000);

    // ─── Chainer, length cap: a 200 kb genome against a 12.25 Mb one that opens with it ───
    const head = randomBases(200_000, 0x5eed_c1c3);
    const target = doc('t', 'Target 200 kb', head);
    const query = doc('q', 'Query past the cap', head + randomBases(CAP + 50_000, 0x5eed_c1c4));
    const queryBases = basesIn(query.sequence);
    expect(queryBases).toBe(CAP + 250_000);
    const read = doc('r', 'Read', head.slice(5_000, 6_000));
    const paired = studio(target, [query, target, read], 'genome-variants');
    expect(warningsLabelled(paired, 'Minimizer chaining warnings')).toEqual([
      `Minimizer chaining compared only the first ${n(CAP)} bp of the ${n(queryBases)}-bp query; query bases past ${n(CAP)} are not chained.`,
    ]);
    // the target is compared whole: a chain runs past base 120,000, where the studio used to stop
    const chainRows = rowsUnder(paired, 'Large-Genome (w=8, k=13)-Minimizer Co-Linear Chainer');
    const targetEnds = chainRows.map((r) => Number(/^#\d+ \([+-]\) (\d+)\.\.(\d+)/.exec(r)?.[2]));
    expect(Math.max(...targetEnds), `${chainRows.join(' | ')}`).toBeGreaterThan(195_000);

    // ─── Chainer, anchor cap: 60 copies of a 20 kb unit against 20 copies ───
    const unit = randomBases(20_000, 0x5eed_c1c5);
    const dense = doc('dt', 'Sixty copies', unit.repeat(60));
    const denseQuery = doc('dq', 'Twenty copies', unit.repeat(20));
    const denseBases = basesIn(denseQuery.sequence);
    const capped = studio(dense, [denseQuery, dense, read], 'genome-variants');
    const said = warningsLabelled(capped, 'Minimizer chaining warnings');
    const cut = /^Seed anchor cap reached: the chainer stopped at ([\d,]+) seed anchors, so it compared only query bases 1-([\d,]+) of ([\d,]+); query bases past ([\d,]+) are not chained, and both coverage figures count only chains from bases 1-([\d,]+)\.$/.exec(said[0] ?? '');
    expect(cut, said.join(' | ')).not.toBeNull();
    const [anchors, seeded, of, past, from] = cut!.slice(1).map((v) => Number(v.replace(/,/g, '')));
    expect(of).toBe(denseBases);
    expect(anchors).toBeLessThanOrEqual(2_000_000);
    expect(seeded).toBeLessThan(denseBases);
    expect([past, from]).toEqual([seeded, seeded]);
    // the range it names is true: no chain shown reaches past it on the query
    const denseRows = rowsUnder(capped, 'Large-Genome (w=8, k=13)-Minimizer Co-Linear Chainer');
    expect(denseRows.length).toBeGreaterThan(0);
    // the table draws every chain the engine lists, its 64 best, not the first 16 of them
    expect(denseRows).toHaveLength(64);
    for (const row of denseRows) {
      const span = /^#\d+ \([+-]\) \d+\.\.\d+ (\d+)\.\.(\d+)/.exec(row);
      expect(Number(span?.[2]), row).toBeLessThanOrEqual(seeded);
    }
    // more chains were found than the list holds: the caption counts every one, as the warning does
    const listCut = said.map((w) => /^Chain list capped: it lists the 64 highest-scoring of the ([\d,]+) chains found;/.exec(w)?.[1]).find(Boolean);
    expect(listCut, said.join(' | ')).toBeDefined();
    expect(wordsOf(capped)).toContain(`Minimizer Co-Linear Chainer (${listCut!.replace(/,/g, '')} chains •`);
  }, 120_000);

  it('counts in the chainer caption and table only the chains chance would not form', () => {
    // Two 1 Mb genomes 1% apart by substitution alone are one co-linear chain. Round 1 counted
    // every chain of 3 anchors, so on this pair chance seed matches added a minus-strand
    // "inversion" of 4 anchors at 69.9% to the caption ("2 chains") and the table.
    const genome = randomBases(1_000_000, 0x5eed_c1c6);
    const related = substitute(genome, 100, 0x5eed_c1c7);
    const target = doc('ct', 'Genome', genome);
    const read = doc('cr', 'Read', genome.slice(5_000, 6_000));
    const engine = alignLargeGenomesMinimizerChainRust(genome, related, 8, 13, 64) as ReturnType<typeof alignLargeGenomesMinimizerChainRust> & { minChainAnchors?: number };
    expect(engine.minChainAnchors, 'the engine names the fewest anchors a chain needs').toBeGreaterThan(3);
    const colinear = studio(target, [doc('cq', 'Genome, 1% substituted', related), target, read], 'genome-variants');
    expect(wordsOf(colinear)).toContain(
      `Minimizer Co-Linear Chainer (1 chains • ${engine.rawSeedMatches} seed anchors • chains of at least ${engine.minChainAnchors} anchors)`
    );
    const rows = rowsUnder(colinear, 'Large-Genome (w=8, k=13)-Minimizer Co-Linear Chainer');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^#1 \(\+\) \d+\.\.\d+ \d+\.\.\d+ \d+ 99\.\d% \(colinear\)$/);

    // The same pair with a 5 kb inversion planted at bases 400,001-405,000 of the query: the
    // inversion is still reported, once, where it was planted.
    const inverted = related.slice(0, 400_000) + revcomp(related.slice(400_000, 405_000)) + related.slice(405_000);
    const withInversion = studio(target, [doc('ci', 'Genome with an inversion', inverted), target, read], 'genome-variants');
    expect(wordsOf(withInversion)).toContain('Minimizer Co-Linear Chainer (2 chains •');
    const inversions = rowsUnder(withInversion, 'Large-Genome (w=8, k=13)-Minimizer Co-Linear Chainer').filter((r) => r.includes('(inversion)'));
    expect(inversions).toHaveLength(1);
    const [tStart, tEnd, qStart, qEnd] = (/^#\d+ \(-\) (\d+)\.\.(\d+) (\d+)\.\.(\d+) /.exec(inversions[0]) ?? []).slice(1).map(Number);
    for (const [got, want] of [[tStart, 400_001], [tEnd, 405_000], [qStart, 400_001], [qEnd, 405_000]]) {
      expect(Math.abs(got - want), inversions[0]).toBeLessThanOrEqual(60);
    }
  }, 120_000);
});
