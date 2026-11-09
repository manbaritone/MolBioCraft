// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6T6GK: the variant caller removed N and every other letter but A, C, G and T from both
 * sequences before calling. A reference holding 10 N at 4,990-4,999 then read as a 10-bp insertion
 * at the run, and every later variant moved 10 bases left: a SNP at 8,001 showed in the Genomics
 * studio's Variant Calls table, its exported VCF and the features Annotate Variants adds to the
 * reference at 7,991, under a button whose tooltip says the coordinates are the reference's.
 *
 * The studio is rendered over the real WASM engine (public/molbiocraft_wasm.wasm), which it asks
 * while it renders, with the reference and sample of the engine test
 * n_in_the_reference_keeps_reference_coordinates (crates/molbiocraft-align/tests/variant_caller_cap.rs),
 * made here from the same seed by the same generator. The markup is read as the words it shows; the
 * Export VCF and Annotate Variants buttons are pressed by calling the handlers its render hands
 * them, and the file saved and the features added are captured. No reference data is needed.
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

/** variant_caller_cap.rs `genome`: a 64-bit LCG from `seed`, each base 'ACGT'[(x >> 33) % 4]. */
function genome(len: number, seed: bigint): string[] {
  const mask = (1n << 64n) - 1n;
  let x = seed;
  const out: string[] = new Array(len);
  for (let i = 0; i < len; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) & mask;
    out[i] = 'ACGT'[Number((x >> 33n) % 4n)];
  }
  return out;
}

const TRANSITION: Record<string, string> = { A: 'G', G: 'A', C: 'T', T: 'C' };

/**
 * variant_caller_cap.rs `reference_n_pair`: a 10 kb genome (seed 0x6B0010) whose bases 4,990-4,999
 * hold no A (each A there made a G); the sample, its bases 301-9,700 with base 8,001 replaced by its
 * transition; and the reference, the genome with bases 4,990-4,999 made N. The sample holds real
 * bases other than A opposite the run, so reading N as A would call SNPs there.
 */
function referenceNPair() {
  const bases = genome(10_000, 0x6b_0010n);
  for (let p = 4_989; p < 4_999; p++) if (bases[p] === 'A') bases[p] = 'G';
  const snp: [number, string, string] = [8_001, bases[8_000], TRANSITION[bases[8_000]]];
  const sample = bases.slice(300, 9_700);
  sample[8_000 - 300] = snp[2];
  const reference = bases.map((b, p) => (p >= 4_989 && p < 4_999 ? 'N' : b));
  return { reference: reference.join(''), sample: sample.join(''), snp };
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

/** Every warnings region in the markup: its accessible name and its sentences in order. */
function warningRegions(html: string): { label: string; sentences: string[] }[] {
  return [...html.matchAll(/<div([^>]*data-mbc-result-warnings[^>]*)>([\s\S]*?)<\/div>/g)].map((m) => ({
    label: /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? '',
    sentences: [...m[2].matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) => wordsOf(p[1])),
  }));
}

/** The table in the region named `label`: its header cells and its body rows, each cell as its words. */
function table(html: string, label: string): { headers: string[]; rows: string[][] } {
  const at = html.indexOf(`role="region" aria-label="${label}"`);
  expect(at, `a table region named ${label}`).toBeGreaterThan(-1);
  const markup = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html.slice(at))?.[1] ?? '';
  const cells = (row: string) => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => wordsOf(c[1]));
  const head = /<thead[^>]*>([\s\S]*?)<\/thead>/.exec(markup)?.[1] ?? '';
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(markup)?.[1] ?? '';
  return { headers: cells(head), rows: [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) => cells(tr[1])) };
}

/** The data rows of a VCF, as (POS, REF, ALT). */
const vcfRows = (vcf: string): [number, string, string][] =>
  vcf.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const f = l.split('\t');
    return [Number(f[1]), f[3], f[4]];
  });

/**
 * The variants tab of the studio, with `sample` the active document, called against `reference`
 * (the first document, so the reference picker starts on it), its Export VCF and Annotate Variants
 * buttons pressed: the markup, the Annotate button's tooltip, the VCF saved, and the features added
 * to the reference.
 */
function variantsTab(reference: SequenceDocument, sample: SequenceDocument) {
  let exportVcf: (() => void) | null = null;
  let annotate: (() => void) | null = null;
  let annotateTitle = '';
  probe.onElement = (type, p) => {
    if (type !== 'button') return;
    if (childText(p.children) === 'Export VCF (.vcf)') exportVcf = p.onClick as () => void;
    if (childText(p.children) === '+ Annotate Variants on Reference') {
      annotate = p.onClick as () => void;
      annotateTitle = String(p.title ?? '');
    }
  };
  const added: { docId: string; features: SequenceFeature[] }[] = [];
  let html: string;
  try {
    html = renderToStaticMarkup(
      <GenomicsNgsAndPredictionStudio activeDoc={sample} documents={[reference, sample]} initialSubTab="genome-variants"
        onCreateDocument={() => {}} onUpdateActiveSequence={() => {}} onAppendFeatures={() => {}}
        onAppendFeaturesToDocument={(docId, features) => added.push({ docId, features })} />
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
  return { html, annotateTitle, vcf: String(probe.saved[0].content), annotated: added[0] };
}

describe('variant coordinates across N', () => {
  it('reads a SNP after a reference N run at its reference coordinate in the studio', () => {
    const pair = referenceNPair();
    // the engine test's pair, base for base: its SNP, and the sample's bases opposite the run
    expect(pair.snp, 'fixture').toEqual([8_001, 'C', 'T']);
    expect(pair.reference.slice(4_989, 4_999), 'fixture').toBe('NNNNNNNNNN');
    expect(pair.sample.slice(4_989 - 300, 4_999 - 300), 'fixture: real bases other than A opposite the run').toBe('GCGGTTGGGT');
    expect([pair.reference.length, pair.sample.length], 'fixture').toEqual([10_000, 9_400]);

    const reference = doc('ref', 'Reference with N run', pair.reference);
    const sample = doc('sample', 'Sample with SNP', pair.sample);
    const tab = variantsTab(reference, sample);

    // 1. the Variant Calls table: one row, the SNP, its Pos (bp) cell 8001
    const calls = table(tab.html, 'Variant Calls');
    expect(calls.headers).toEqual(['Pos (bp)', 'REF > ALT', 'Type', 'Class', 'GT']);
    expect(calls.rows).toEqual([['8001', 'C > T', 'SNP', 'Transition', '1']]);
    // 2. the VCF the Export VCF button writes: one record, at POS 8001
    expect(vcfRows(tab.vcf)).toEqual([[8_001, 'C', 'T']]);
    // 3. the feature Annotate Variants adds to the reference: the SNP's base, 8,001
    expect(tab.annotated.docId).toBe('ref');
    expect(tab.annotated.features.map((f) => [f.start, f.end, f.name])).toEqual([[8_001, 8_001, 'SNP C>T']]);
    // and the run is named where the caller's warnings are shown
    expect(warningRegions(tab.html).filter((r) => r.label === 'Variant calling warnings').map((r) => r.sentences)).toEqual([
      ['The reference holds 10 N at 4,990-4,999; no variant is called there.'],
    ]);
    // so the button's own tooltip, which the three places above bear out, is true
    expect(tab.annotateTitle).toBe('Variant coordinates are relative to the reference "Reference with N run"; they are added to that document.');
  }, 60_000);

  /**
   * BG-01M6TE8J: an empty reference read "100% identical across mapped interval (0 variants)" with
   * no warning, and so did an empty sample: the caller compared nothing and its report of no
   * variants looked like a perfect match. Each now reads as no variants called, under the engine's
   * warning naming the empty input; a sample that does match its reference still reads as 100%
   * identical, with no warning.
   *
   * The studio starts its reference picker on the first document and its sample picker on the first
   * under 1,500 characters, so an empty first document is both inputs until the user picks a sample,
   * and both are named. A reference that holds no bases (only digits and spaces, as a numbered
   * listing does) is 1,600 characters long, so the picker passes it over for the sample.
   */
  it('warns and shows no identity for an empty reference or sample', () => {
    const bases = genome(2_000, 0x6b_e8a1n).join('');
    const named = (name: string, sequence: string) => doc(name.toLowerCase().replace(/ /g, '-'), name, sequence);
    const notCompared = 'No variants called; the warnings above say what was not compared.';
    const emptyReference = 'The reference is empty, so there is nothing to compare and no variant is called.';
    const emptySample = 'The sample is empty, so there is nothing to compare and no variant is called.';
    const cases = [
      { reference: named('Empty reference', ''), sample: named('Sample', bases), row: notCompared,
        warnings: [[emptyReference, emptySample]] },
      { reference: named('Numbering only', ' 1 2 3 4 5 6 7 8'.repeat(100)), sample: named('Short sample', bases.slice(0, 1_400)),
        row: notCompared, warnings: [[emptyReference]] },
      { reference: named('Reference', bases), sample: named('Empty sample', ''), row: notCompared,
        warnings: [[emptySample]] },
      { reference: named('Reference', bases), sample: named('Same sample', bases), row: '100% identical across mapped interval (0 variants).',
        warnings: [] },
    ];
    for (const c of cases) {
      const tab = variantsTab(c.reference, c.sample);
      const label = `${c.reference.name} vs ${c.sample.name}`;
      // the Variant Calls table holds the one row that says what was found
      expect(table(tab.html, 'Variant Calls').rows, label).toEqual([[c.row]]);
      // and nowhere else on the tab is an identity claimed for it
      expect(wordsOf(tab.html).includes('100% identical'), label).toBe(c.warnings.length === 0);
      // the engine's warning, naming the empty input, is shown where the caller's warnings are
      expect(warningRegions(tab.html).filter((r) => r.label === 'Variant calling warnings').map((r) => r.sentences), label)
        .toEqual(c.warnings);
      // nothing is exported or annotated as a variant
      expect(vcfRows(tab.vcf), label).toEqual([]);
      expect(tab.annotated.features, label).toEqual([]);
    }
  }, 60_000);
});
