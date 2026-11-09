// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1ED: the Genomics variants panel and the VCF it exports carry every variant the caller
 * finds, and the panel says how much of a sample longer than the caller's 100,000-bp alignment cap
 * was called. The caller stopped at its 500th variant and annotated 30, so a 30 kb sample with 750
 * SNPs read as 500 polymorphisms and exported a VCF of 500 rows, the last at 19,482 of 29,232; and
 * a 150 kb sample was called over its first 100,000 bp, with an insertion invented at the cut and
 * nothing said.
 *
 * Every number here comes from the real WASM engine (public/molbiocraft_wasm.wasm), asked by the
 * studio itself while it renders. The studio is rendered with renderToStaticMarkup and read as the
 * words it shows; its Export VCF and Annotate buttons are pressed by calling the handlers its
 * render hands them, and the file saved and the features added are captured. The sequences are
 * generated from fixed seeds, so no reference data is needed.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Probes, installed before the modules under test load ───

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  /** Every file the workbench was asked to save, in order. */
  saved: [] as { name: string; content: unknown }[],
}));

vi.mock('../platform/macosMenuBridge', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../platform/macosMenuBridge');
  return {
    ...actual,
    saveWorkbenchFile: (name: string, content: unknown) => {
      probe.saved.push({ name, content });
      return 'native';
    },
  };
});

type JsxFn = (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => unknown;
const watch = vi.hoisted(() => (fn: JsxFn): JsxFn => (type, props, ...rest) => {
  probe.onElement?.(type, props ?? {});
  return fn(type, props, ...rest);
});
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-dev-runtime');
  return { ...actual, jsxDEV: watch(actual.jsxDEV) };
});
vi.mock('react/jsx-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-runtime');
  return { ...actual, jsx: watch(actual.jsx), jsxs: watch(actual.jsxs) };
});

const { GenomicsNgsAndPredictionStudio } = await import('../components/GenomicsNgsAndPredictionStudio');
const { EMPTY_WORKSPACE_DOCUMENT } = await import('../core/emptyWorkspace');
type SequenceDocument = import('../types/bio').SequenceDocument;
type SequenceFeature = import('../types/bio').SequenceFeature;

afterEach(() => {
  probe.onElement = null;
  probe.saved = [];
});

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

const TRANSITION: Record<string, string> = { A: 'G', G: 'A', C: 'T', T: 'C' };
const TRANSVERSION: Record<string, string> = { A: 'C', G: 'C', C: 'A', T: 'A' };

/** A planted SNP: 1-based reference position, REF, ALT. */
type Snp = [position: number, ref: string, alt: string];

/**
 * A copy of `reference.slice(from, to)` with a SNP at each 0-based reference offset in `at`, its
 * transversion when `transversion(i)` for the i-th, its transition otherwise; and the SNPs planted.
 */
function withSnps(reference: string, from: number, to: number, at: number[], transversion: (i: number) => boolean) {
  const bases = reference.slice(from, to).split('');
  const snps: Snp[] = at.map((p, i) => {
    const alt = (transversion(i) ? TRANSVERSION : TRANSITION)[reference[p]];
    bases[p - from] = alt;
    return [p + 1, reference[p], alt];
  });
  return { sample: bases.join(''), snps };
}

const doc = (id: string, name: string, sequence: string): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, moleculeType: 'DNA' });

/** The words a stretch of markup shows: tags dropped, the entities React writes decoded. */
const wordsOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** The text a React element's children spell, for finding a control by its label. */
const childText = (children: unknown): string =>
  React.Children.toArray(children as React.ReactNode)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : React.isValidElement(c) ? childText((c.props as { children?: unknown }).children) : ''))
    .join('');

/** Every warnings region in the markup: its accessible name, where it opens, and its sentences in order. */
function warningRegions(html: string): { label: string; at: number; sentences: string[] }[] {
  return [...html.matchAll(/<div([^>]*data-mbc-result-warnings[^>]*)>([\s\S]*?)<\/div>/g)].map((m) => ({
    label: /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? '',
    at: m.index!,
    sentences: [...m[2].matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) => wordsOf(p[1])),
  }));
}

/** The data rows of a VCF, as SNPs (POS, REF, ALT). */
const vcfRows = (vcf: string): Snp[] =>
  vcf.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const f = l.split('\t');
    return [Number(f[1]), f[3], f[4]];
  });

/**
 * The variants tab of the studio, with `sample` the active document, called against `reference`
 * (the first document, so the reference picker starts on it), its Export VCF and Annotate Variants
 * buttons pressed: the markup, the VCF saved, and the features added to the reference with the
 * summary given.
 */
function variantsTab(reference: SequenceDocument, sample: SequenceDocument) {
  let exportVcf: (() => void) | null = null;
  let annotate: (() => void) | null = null;
  probe.onElement = (type, p) => {
    if (type !== 'button') return;
    if (childText(p.children) === 'Export VCF (.vcf)') exportVcf = p.onClick as () => void;
    if (childText(p.children) === '+ Annotate Variants on Reference') annotate = p.onClick as () => void;
  };
  const added: { docId: string; features: SequenceFeature[]; summary: string }[] = [];
  let html: string;
  try {
    html = renderToStaticMarkup(
      <GenomicsNgsAndPredictionStudio activeDoc={sample} documents={[reference, sample]} initialSubTab="genome-variants"
        onCreateDocument={() => {}} onUpdateActiveSequence={() => {}} onAppendFeatures={() => {}}
        onAppendFeaturesToDocument={(docId, features, summary) => added.push({ docId, features, summary })} />
    );
  } finally {
    probe.onElement = null;
  }
  expect(exportVcf, 'the Export VCF button was drawn').not.toBeNull();
  expect(annotate, 'the Annotate Variants button was drawn').not.toBeNull();
  probe.saved = [];
  exportVcf!();
  expect(probe.saved.map((f) => f.name)).toEqual([`${reference.name}_variants.vcf`]);
  annotate!();
  expect(added).toHaveLength(1);
  return { html, words: wordsOf(html), vcf: String(probe.saved[0].content), annotated: added[0] };
}

const tiTv = (ti: number, tv: number) => Math.round((ti / tv) * 100) / 100;

describe('variant caller cap', () => {
  it('exports every called variant and shows the aligned-length warning', () => {
    // 30 kb with 750 SNPs, 39 bases apart: two transitions to a transversion in the first 500, one
    // to four in the last 250, so Ti/Tv over all 750 (384/366, 1.05) is not the Ti/Tv over the
    // first 500 (2.01), nor one that leaves out the last 250's transitions (0.91) or transversions (2.31)
    const ref30 = randomBases(30_000, 0x5eed_0750);
    const at30 = Array.from({ length: 750 }, (_, i) => 20 + 39 * i);
    const snp30 = withSnps(ref30, 0, 30_000, at30, (i) => (i < 500 ? i % 3 === 2 : i % 5 !== 0));
    const reference = doc('ref', 'Reference 30 kb', ref30);
    const sample = doc('s30', 'Sample 750 SNPs', snp30.sample);
    const tab = variantsTab(reference, sample);
    expect(tab.words).toContain('Polymorphisms (Sample 750 SNPs vs Reference 30 kb) 750 (750 SNPs, 0 MNP/Indel)');
    const transitions = (snps: Snp[]) => snps.filter(([, r, a]) => TRANSITION[r] === a).length;
    expect([transitions(snp30.snps), transitions(snp30.snps.slice(0, 500))], 'fixture').toEqual([384, 334]);
    expect([tiTv(384, 366), tiTv(334, 166), tiTv(334, 366), tiTv(384, 166)]).toEqual([1.05, 2.01, 0.91, 2.31]);
    expect(tab.words).toContain('Ti / Tv Ratio 1.05 ');
    // the exported VCF holds every one, the last at 29,232
    expect(vcfRows(tab.vcf)).toEqual(snp30.snps);
    expect(snp30.snps.at(-1)?.[0]).toBe(29_232);
    // and every one is annotated on the reference, as the summary says
    expect(tab.annotated.docId).toBe('ref');
    expect(tab.annotated.features.map((f) => f.start)).toEqual(snp30.snps.map((s) => s[0]));
    expect(tab.annotated.summary).toBe('Annotated 750 variant(s) on reference "Reference 30 kb"');
    // the whole sample was aligned, so the panel says nothing was left out
    expect(warningRegions(tab.html).filter((r) => r.label === 'Variant calling warnings')).toEqual([]);

    // 150 kb copied from 300 bases into a 160 kb reference, a SNP every 47 bases: the caller
    // aligns its first 100,000 bases, the last of them reference base 100,300, and says so
    const ref160 = randomBases(160_000, 0x5eed_0160);
    // none within 150 bases of the sample's 100,000th base (reference offset 100,299)
    const at150 = Array.from({ length: 3_190 }, (_, i) => 330 + 47 * i).filter((p) => Math.abs(p - 100_299) > 150);
    const snp150 = withSnps(ref160, 300, 150_300, at150, (i) => i % 4 === 3);
    expect(at150.at(-1)).toBeLessThan(150_300 - 30);
    const longRef = doc('ref160', 'Reference 160 kb', ref160);
    const long = doc('s150', 'Sample 150 kb', snp150.sample);
    const longTab = variantsTab(longRef, long);
    // the aligned part's SNPs are its first 100,000 bases': those at reference bases up to 100,300
    const aligned = snp150.snps.filter((s) => s[0] <= 100_300);
    expect(aligned.length, 'fixture: SNPs past the 500 the caller stopped at').toBeGreaterThan(2_000);
    expect(longTab.words).toContain(`Polymorphisms (Sample 150 kb vs Reference 160 kb) ${aligned.length} (${aligned.length} SNPs, 0 MNP/Indel)`);
    expect(vcfRows(longTab.vcf)).toEqual(aligned);
    expect(longTab.annotated.features).toHaveLength(aligned.length);
    const regions = warningRegions(longTab.html).filter((r) => r.label === 'Variant calling warnings');
    expect(regions.map((r) => r.sentences)).toEqual([[
      'Variants were called over the first 100,000 bp of the 150,000-bp sample only (the caller aligns at most 100,000 bp): '
        + 'calling stopped at reference base 100,300, and the last 50,000 bp of the sample were not compared.',
    ]]);
    // beside the counts it qualifies: after the polymorphism count, before the VCF export
    const count = longTab.html.indexOf('Polymorphisms (');
    const exportButton = longTab.html.indexOf('Export VCF (.vcf)');
    expect(count).toBeGreaterThan(-1);
    expect(regions[0].at).toBeGreaterThan(count);
    expect(regions[0].at).toBeLessThan(exportButton);
  }, 60_000);
});
