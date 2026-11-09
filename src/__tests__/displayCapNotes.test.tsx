// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1AA: a view that draws or lists a subset says how many of the total it shows, the total
 * being the document's or the engine's count, never the length of the list the view cut; and a
 * value computed from a sample of the data says it is approximate.
 *
 * The ORF ring drew the 8 longest ORFs, the circular map the 240 longest feature arcs, the linear
 * schematic the 360 longest features and the contig-summary circle the first 400 annotations, each
 * with no word that it drew fewer; the distance matrix exported its first 150 rows, the split pane
 * drew 200 rows and the consensus site list 200 sites, unsaid; the Genomics chain table drew 16 of
 * the engine's list and its variant, HGVS and segment tables 25, 20 and 24 rows, two of them
 * captioned with a count and one with none; and pairwise identity past 4,000 pairs and mean GC from
 * 4,096 bases a bin were sampled, and read as exact.
 *
 * Every component is rendered with renderToStaticMarkup and read as the words it shows; every
 * number the engine computes comes from the real WASM engine (public/molbiocraft_wasm.wasm). The
 * sequences are generated from fixed seeds, so no reference data is needed.
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

const { CircularPlasmidMap } = await import('../components/CircularPlasmidMap');
const { LinearSequenceView } = await import('../components/LinearSequenceView');
const { ContigSummaryView } = await import('../components/ContigSummaryView');
const { SplitDocumentPane } = await import('../components/SplitDocumentPane');
const { SequenceAlignmentStudio } = await import('../components/AlignmentAndPhyloStudio');
const { GenomicsNgsAndPredictionStudio } = await import('../components/GenomicsNgsAndPredictionStudio');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
const { findORFs } = await import('../core/bioEngine');
const { findRestrictionSitesAligned, meanPairwiseIdentity } = await import('../core/alignmentViewModel');
const { getResidentTrackOverviewRust, segmentGenomeHmmViterbiRust } = await import('../lib/rustBioEngine');
const { EMPTY_WORKSPACE_DOCUMENT } = await import('../core/emptyWorkspace');
type SequenceDocument = import('../types/bio').SequenceDocument;
type SequenceFeature = import('../types/bio').SequenceFeature;
type StudioProps = React.ComponentProps<typeof SequenceAlignmentStudio>;

afterEach(() => {
  probe.onElement = null;
  probe.saved = [];
});

// ─── Fixtures ───

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

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const revcomp = (s: string) => s.split('').reverse().map((b) => COMPLEMENT[b]).join('');

const dna = (id: string, name: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, moleculeType: 'DNA', topology: 'linear', ...more }) as SequenceDocument;

/** `count` features named F0, F1, …, each `lengthOf(i)` bases long, laid along the sequence. */
function features(count: number, lengthOf: (i: number) => number, at: (i: number) => number): SequenceFeature[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `f${i}`, name: `F${i}`, type: 'misc_feature', start: at(i), end: at(i) + lengthOf(i) - 1, strand: 1, color: '#64748b',
  }) as SequenceFeature);
}

/** An aligned set of `rows` members, `S1` …, each `width` columns long and gap-free. */
function alignment(id: string, rows: string[]): SequenceDocument {
  return {
    ...EMPTY_WORKSPACE_DOCUMENT, id, name: id, sequence: rows[0], folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
    alignmentMeta: { isAligned: true, sequences: rows.map((sequence, i) => ({ id: `${id}-${i}`, name: `S${i + 1}`, sequence })) },
  } as unknown as SequenceDocument;
}

/** `count` rows of `width` bases: one random sequence with each row's own scattering of changes. */
function divergedRows(count: number, width: number, seed: number): string[] {
  const base = randomBases(width, seed);
  return Array.from({ length: count }, (_, i) => {
    const noise = randomBases(width, seed + 1 + i);
    // row i differs from the base at about (i % 7) in 14 columns, so pairs differ by row
    return base.split('').map((b, c) => ((c * 31 + i * 17) % 14 < i % 7 ? noise[c] : b)).join('');
  });
}

// ─── Reading the markup ───

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

/** The words of the table caption that opens with `captionStart`. */
function caption(html: string, captionStart: string): string {
  const hit = [...html.matchAll(/<div[^>]*class="mbc-table-caption"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((m) => wordsOf(m[1])).find((w) => w.startsWith(captionStart));
  if (hit === undefined) throw new Error(`no table caption opening "${captionStart}"`);
  return hit;
}

/** The body rows drawn under the table caption that opens with `captionStart`, each as the words it shows. */
function rowsUnder(html: string, captionStart: string): string[] {
  const captions = [...html.matchAll(/<div[^>]*class="mbc-table-caption"[^>]*>([\s\S]*?)<\/div>/g)];
  const hit = captions.find((m) => wordsOf(m[1]).startsWith(captionStart));
  if (!hit) throw new Error(`no table caption opening "${captionStart}"`);
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(html.slice(hit.index! + hit[0].length))?.[1] ?? '';
  return [...body.matchAll(/<tr[\s>][\s\S]*?<\/tr>/g)].map((m) => wordsOf(m[0]));
}

/** The text a React element's children spell, for finding a control by its label. */
const childText = (children: unknown): string =>
  React.Children.toArray(children as React.ReactNode)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : React.isValidElement(c) ? childText((c.props as { children?: unknown }).children) : ''))
    .join('');

/** The names of the features the circular map drew an arc for, from the arcs' titles ("F3 (part 2)" for a second interval). */
const circularArcNames = (html: string) =>
  [...html.matchAll(/<title>(F\d+(?: \(part \d+\))?) \(misc_feature: /g)].map((m) => m[1]);

/** The ORF arcs the circular map drew, from their titles: each ORF's length in aa. */
const orfArcLengths = (html: string) =>
  [...html.matchAll(/<title>ORF Frame -?\d \(\d+\.\.\d+, (\d+) aa\)<\/title>/g)].map((m) => Number(m[1]));

/** The names of the features the linear schematic drew a pill for. */
function schematicPillNames(html: string, docName: string): string[] {
  const open = html.indexOf(`aria-label="Linear schematic overview of ${docName}"`);
  expect(open, 'the schematic was drawn').toBeGreaterThan(-1);
  const svg = html.slice(open, html.indexOf('</svg>', open));
  return [...svg.matchAll(/<title>(F\d+) \[misc_feature\] /g)].map((m) => m[1]);
}

/** The hover pill's text when nothing is hovered or selected. */
const hudPill = (html: string) => wordsOf(/<span class="circular-hover-pill"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1] ?? '');

const noop = () => {};
const circular = (doc: SequenceDocument, orfs: ReturnType<typeof findORFs>, showOrfs = true) =>
  renderToStaticMarkup(
    <CircularPlasmidMap doc={doc} cutSites={[]} orfs={orfs} selectedRange={null} onSelectRange={noop}
      showOrfs={showOrfs} showPrimers={false} showUniqueCuttersOnly={false} />
  );
const linear = (doc: SequenceDocument, showGcGraph = false) =>
  renderToStaticMarkup(
    <LinearSequenceView doc={doc} cutSites={[]} selectedRange={null} onSelectRange={noop} onUpdateDocument={noop} showGcGraph={showGcGraph} />
  );
const studioProps = (doc: SequenceDocument, more: Partial<StudioProps> = {}): StudioProps =>
  ({ documents: [doc], projectDocuments: [doc], activeDoc: doc, ...more }) as StudioProps;
const genomics = (activeDoc: SequenceDocument, documents: SequenceDocument[], tab: 'genes-cpg-repeats' | 'genome-variants') =>
  renderToStaticMarkup(
    <GenomicsNgsAndPredictionStudio activeDoc={activeDoc} documents={documents} initialSubTab={tab}
      onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop} />
  );

const n = (v: number) => v.toLocaleString('en-US');

describe('display cap notes', () => {
  it('labels the ORF ring and feature arcs with N of M', () => {
    // ─── The ORF ring draws the 8 longest ORFs ───
    // Wrong implementations this catches: no note; a note counted against the ring's own 8 ("8 of
    // 8", so none); a note while ORFs are hidden; and a note on a plasmid with 8 ORFs or fewer.
    const pet = SAMPLE_LIBRARY.find((d) => d.name === 'pET-28a(+)-eGFP')!;
    const petOrfs = findORFs(pet.sequence, 50, false, 1, pet.topology === 'circular');
    expect(petOrfs.length, 'fixture: pET-28a has more ORFs than the ring draws').toBeGreaterThan(8);
    const petMap = circular(pet, petOrfs);
    expect(warningsLabelled(petMap, 'Circular map coverage')).toEqual([`The ORF ring draws the 8 longest of ${petOrfs.length} ORFs.`]);
    // the ring draws 8 arcs, the longest 8
    const longest8 = petOrfs.map((o) => o.lengthAa).sort((a, b) => b - a).slice(0, 8);
    expect(orfArcLengths(petMap).sort((a, b) => b - a)).toEqual(longest8);
    // ORFs hidden: no ring, no word about it
    expect(warningsLabelled(circular(pet, petOrfs, false), 'Circular map coverage')).toEqual([]);
    // pUC19 has no more ORFs at 50 aa than the ring draws: every one is drawn, and nothing is said
    const puc19 = SAMPLE_LIBRARY.find((d) => d.name === 'pUC19_Standard_Vector')!;
    const pucOrfs = findORFs(puc19.sequence, 50, false, 1, true);
    expect(pucOrfs.length, 'fixture').toBeLessThanOrEqual(8);
    const pucMap = circular(puc19, pucOrfs);
    expect(orfArcLengths(pucMap)).toHaveLength(pucOrfs.length);
    expect(warningsLabelled(pucMap, 'Circular map coverage')).toEqual([]);

    // ─── The circular map draws the 240 longest feature arcs ───
    const backbone = randomBases(20_000, 0x5eed_aa01);
    // 300 features 20 to 319 bp long (each length once), so the 240 longest are F60 to F299
    const many = dna('many', 'Three hundred features', backbone, { topology: 'circular', features: features(300, (i) => 20 + i, (i) => 1 + i * 60) });
    const manyMap = circular(many, []);
    expect(warningsLabelled(manyMap, 'Circular map coverage')).toEqual(['The map draws the 240 longest of 300 features.']);
    expect(new Set(circularArcNames(manyMap))).toEqual(new Set(Array.from({ length: 240 }, (_, k) => `F${k + 60}`)));
    // 240 features: all drawn, nothing said
    const fit = dna('fit', 'Two hundred forty features', backbone, { topology: 'circular', features: features(240, (i) => 20 + i, (i) => 1 + i * 60) });
    const fitMap = circular(fit, []);
    expect(circularArcNames(fitMap)).toHaveLength(240);
    expect(warningsLabelled(fitMap, 'Circular map coverage')).toEqual([]);
    // 150 joined features of two intervals each: 300 arcs, of which the map draws 240. A note
    // counted against the 150 features would say nothing (240 > 150), or "240 of 150".
    const joined = features(150, () => 1, (i) => 1 + i * 120).map((f, i) => ({
      ...f, start: 1 + i * 120, end: 1 + i * 120 + 99 + i,
      segments: [
        { index: 1, name: `${f.name} part 1`, color: f.color, start: 1 + i * 120, end: 1 + i * 120 + 19 + i },
        { index: 2, name: `${f.name} part 2`, color: f.color, start: 1 + i * 120 + 60, end: 1 + i * 120 + 99 + i },
      ],
    })) as SequenceFeature[];
    const joinedMap = circular(dna('joined', 'Joined features', backbone, { topology: 'circular', features: joined }), []);
    expect(circularArcNames(joinedMap)).toHaveLength(240);
    expect(warningsLabelled(joinedMap, 'Circular map coverage')).toEqual(['The map draws the 240 longest of 300 feature intervals (one arc each).']);
    // both caps at once, in the order the map draws them
    expect(warningsLabelled(circular({ ...many, sequence: pet.sequence.repeat(4) }, petOrfs), 'Circular map coverage')).toEqual([
      `The ORF ring draws the 8 longest of ${petOrfs.length} ORFs.`,
      'The map draws the 240 longest of 300 features.',
    ]);

    // ─── The linear schematic draws the 360 longest features ───
    // 400 features 20 to 419 bp long, so the 360 longest are F40 to F399
    const linearMany = dna('lin', 'Four hundred features', randomBases(30_000, 0x5eed_aa02), { features: features(400, (i) => 20 + i, (i) => 1 + i * 70) });
    const linearHtml = linear(linearMany);
    expect(warningsLabelled(linearHtml, 'Linear map coverage')).toEqual(['The map draws the 360 longest of 400 features.']);
    expect(new Set(schematicPillNames(linearHtml, linearMany.name))).toEqual(new Set(Array.from({ length: 360 }, (_, k) => `F${k + 40}`)));
    const linearFit = { ...linearMany, id: 'lin-fit', name: 'Three hundred sixty features', features: linearMany.features.slice(0, 360) };
    const linearFitHtml = linear(linearFit);
    expect(schematicPillNames(linearFitHtml, linearFit.name)).toHaveLength(360);
    expect(warningsLabelled(linearFitHtml, 'Linear map coverage')).toEqual([]);

    // ─── The contig-summary circle draws the first 400 annotations along the record ───
    // A 5 Mb summary record: a source feature over the whole record, and 450 genes. The circle's
    // count is of the 450 (the source spans the record and is never an arc), not of all 451.
    const genes = features(450, () => 900, (i) => 1 + i * 10_000);
    const source = { id: 'src', name: 'source', type: 'source', start: 1, end: 5_000_000, strand: 1, color: '#94a3b8' } as SequenceFeature;
    const summary = dna('chr', 'Chromosome summary', '', {
      topology: 'circular', features: [source, ...genes],
      docMetadata: { 'Declared Length': 5_000_000, 'Is Contig Summary': 'Yes' },
    });
    const summaryHtml = renderToStaticMarkup(<ContigSummaryView doc={summary} />);
    expect([...summaryHtml.matchAll(/class="mbc-summary-arc"/g)]).toHaveLength(400);
    expect(warningsLabelled(summaryHtml, 'Circular map coverage')).toEqual(['The circle draws the first 400 of 450 annotations along the record.']);
    const smallSummary = { ...summary, id: 'chr-small', features: [source, ...genes.slice(0, 400)] };
    const smallHtml = renderToStaticMarkup(<ContigSummaryView doc={smallSummary} />);
    expect([...smallHtml.matchAll(/class="mbc-summary-arc"/g)]).toHaveLength(400);
    expect(warningsLabelled(smallHtml, 'Circular map coverage')).toEqual([]);
  }, 60_000);

  it('labels the alignment exports and lists with N of M', () => {
    // ─── The distance matrix and its TSV hold the first 150 sequences ───
    // Wrong implementations this catches: a TSV with no line about the rows it leaves out; a line
    // counted against the 150 rows it holds; and a line on a matrix that holds every row.
    const exportTsv = (doc: SequenceDocument) => {
      let exportMatrix: (() => void) | null = null;
      probe.onElement = (type, p) => {
        if (type === 'button' && childText(p.children) === 'Export Matrix (TSV)') exportMatrix = p.onClick as () => void;
      };
      let html: string;
      try {
        html = renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc, { initialInspectorTab: 'distances' })} />);
      } finally {
        probe.onElement = null;
      }
      expect(exportMatrix, 'the Export Matrix button was drawn').not.toBeNull();
      probe.saved = [];
      exportMatrix!();
      expect(probe.saved).toHaveLength(1);
      return { html, lines: String(probe.saved[0].content).split('\n') };
    };
    const rows160 = divergedRows(160, 30, 0x5eed_aa10);
    const big = exportTsv(alignment('aln-160', rows160));
    expect(big.lines[0]).toBe('# The matrix lists the first 150 of 160 sequences.');
    // then the header row of the 150 it holds, and their 150 rows
    expect(big.lines[1].split('\t')).toEqual(['', ...Array.from({ length: 150 }, (_, i) => `S${i + 1}`)]);
    expect(big.lines.slice(2).map((l) => l.split('\t')[0])).toEqual(Array.from({ length: 150 }, (_, i) => `S${i + 1}`));
    // the same sentence beside the matrix
    expect(warningsLabelled(big.html, 'Distance matrix warnings')).toEqual(['The matrix lists the first 150 of 160 sequences.']);
    // 150 sequences: the TSV opens with its header row, and nothing is said
    const whole = exportTsv(alignment('aln-150', rows160.slice(0, 150)));
    expect(whole.lines[0].split('\t')).toEqual(['', ...Array.from({ length: 150 }, (_, i) => `S${i + 1}`)]);
    expect(whole.lines).toHaveLength(151);
    expect(warningsLabelled(whole.html, 'Distance matrix warnings')).toEqual([]);

    // ─── The split pane draws the first 200 rows ───
    const paneOf = (doc: SequenceDocument) => renderToStaticMarkup(
      <SplitDocumentPane doc={doc} choices={[doc]} onChooseDoc={noop} onSwap={noop} onClose={noop} onUpdateDocument={noop} />
    );
    const preLines = (html: string) => (/<pre class="mbc-split-aln-pre">([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? '').split('\n');
    const rows250 = divergedRows(250, 40, 0x5eed_aa11);
    const pane = paneOf(alignment('aln-250', rows250));
    expect(preLines(pane)).toHaveLength(200);
    expect(warningsLabelled(pane, 'Split view coverage')).toEqual(['The pane shows the first 200 of 250 sequences.']);
    const pane200 = paneOf(alignment('aln-200', rows250.slice(0, 200)));
    expect(preLines(pane200)).toHaveLength(200);
    expect(warningsLabelled(pane200, 'Split view coverage')).toEqual([]);

    // ─── The consensus site list shows the first 200 sites by column ───
    // Three identical 5 kb members, so the consensus is that sequence; the studio's default set is
    // the commercial enzymes whose site has six or more defined bases.
    const consensus = randomBases(5_000, 0x5eed_aa12);
    const sixPlus = REBASE_ENZYMES.filter((e) => (e.suppliers?.length ?? 0) > 0 && e.recognitionSeq.replace(/N/gi, '').length >= 6);
    const total = findRestrictionSitesAligned(consensus, sixPlus).length;
    expect(total, 'fixture: more sites than the list shows').toBeGreaterThan(200);
    const sites = renderToStaticMarkup(
      <SequenceAlignmentStudio {...studioProps(alignment('aln-sites', [consensus, consensus, consensus]), { initialInspectorTab: 'restriction' })} />
    );
    expect(wordsOf(sites)).toContain(`${total} site(s) in the consensus`);
    expect([...sites.matchAll(/class="mbc-aln-site-row"/g)]).toHaveLength(200);
    expect(warningsLabelled(sites, 'Consensus site list warnings')).toEqual([`The list shows the first 200 of ${n(total)} sites, by column.`]);
    // a consensus with 200 sites or fewer lists them all, and nothing is said
    const short = consensus.slice(0, 600);
    const shortTotal = findRestrictionSitesAligned(short, sixPlus).length;
    expect(shortTotal, 'fixture').toBeLessThanOrEqual(200);
    const shortSites = renderToStaticMarkup(
      <SequenceAlignmentStudio {...studioProps(alignment('aln-short', [short, short, short]), { initialInspectorTab: 'restriction' })} />
    );
    expect([...shortSites.matchAll(/class="mbc-aln-site-row"/g)]).toHaveLength(shortTotal);
    expect(warningsLabelled(shortSites, 'Consensus site list warnings')).toEqual([]);
  }, 60_000);

  it('labels the genomics tables with their totals', () => {
    // ─── Variant calls and their HGVS consequences: first 25 and first 20 ───
    // Wrong implementations this catches: a caption counting the rows it draws ("25", "first 25
    // of 25"), one with no count, and a "first N of" on a table that shows every row.
    const reference = randomBases(30_000, 0x5eed_aa20);
    const withSnps = (count: number) => {
      const bases = reference.split('');
      for (let i = 0; i < count; i++) {
        const p = 200 + i * 450;
        bases[p] = bases[p] === 'A' ? 'G' : bases[p] === 'G' ? 'A' : bases[p] === 'C' ? 'T' : 'C';
      }
      return bases.join('');
    };
    const ref = dna('ref', 'Reference 30 kb', reference);
    const variantsTab = (snps: number) => {
      const sample = dna(`s${snps}`, `Sample ${snps} SNPs`, withSnps(snps));
      return genomics(sample, [ref, sample], 'genome-variants');
    };
    const sixty = variantsTab(60);
    expect(wordsOf(sixty), 'fixture: the caller finds every SNP').toContain('Polymorphisms (Sample 60 SNPs vs Reference 30 kb) 60 (60 SNPs, 0 MNP/Indel)');
    expect(caption(sixty, 'Variant Calls')).toBe('Variant Calls (first 25 of 60; single sequence vs. reference, no read-depth QUAL)');
    expect(rowsUnder(sixty, 'Variant Calls')).toHaveLength(25);
    // the HGVS caption counts impact tiers (its words are pinned elsewhere), so the note beside it
    // gives the records: every VCF record is annotated, one per variant
    expect(caption(sixty, 'VCF coding consequences, HGVS')).toMatch(/^VCF coding consequences, HGVS \(HIGH: \d+ • MODERATE: \d+ • LOW: \d+\)$/);
    expect(warningsLabelled(sixty, 'HGVS consequence warnings')).toEqual(['The table lists the first 20 of 60 records.']);
    expect(rowsUnder(sixty, 'VCF coding consequences, HGVS')).toHaveLength(20);
    const ten = variantsTab(10);
    expect(caption(ten, 'Variant Calls')).toBe('Variant Calls (10; single sequence vs. reference, no read-depth QUAL)');
    expect(rowsUnder(ten, 'Variant Calls')).toHaveLength(10);
    expect(warningsLabelled(ten, 'HGVS consequence warnings')).toEqual([]);
    expect(rowsUnder(ten, 'VCF coding consequences, HGVS')).toHaveLength(10);

    // ─── Minimizer chains: every chain the engine lists, under the engine's total ───
    // The target is 100 blocks of 4 kb; the query copies 3 kb of 90 of them in reverse block order,
    // then the other 10 as 2 kb reverse complements, so no two blocks chain together: about 100
    // chains, of which the engine lists 64 and says so. The table used to draw 16 of them.
    const target = randomBases(400_000, 0x5eed_aa21);
    let query = '';
    for (let b = 99; b >= 0; b--) if (b % 10 !== 0) query += target.slice(b * 4_000, b * 4_000 + 3_000);
    for (let b = 0; b < 100; b += 10) query += revcomp(target.slice(b * 4_000, b * 4_000 + 2_000));
    const targetDoc = dna('t', 'Target 400 kb', target);
    const queryDoc = dna('q', 'Query blocks', query);
    const read = dna('r', 'Read', target.slice(5_000, 6_000));
    const chained = genomics(targetDoc, [queryDoc, targetDoc, read], 'genome-variants');
    const said = warningsLabelled(chained, 'Minimizer chaining warnings');
    const found = said.map((w) => /^Chain list capped: it lists the 64 highest-scoring of the ([\d,]+) chains found;/.exec(w)?.[1]).find(Boolean);
    expect(found, `fixture: more chains than the engine lists (${said.join(' | ')})`).toBeDefined();
    const totalChains = Number(found!.replace(/,/g, ''));
    expect(totalChains).toBeGreaterThan(64);
    expect(caption(chained, 'Large-Genome (w=8, k=13)-Minimizer Co-Linear Chainer')).toContain(`(${totalChains} chains •`);
    expect(rowsUnder(chained, 'Large-Genome (w=8, k=13)-Minimizer Co-Linear Chainer')).toHaveLength(64);

    // ─── HMM segments: first 24, of the engine's every segment ───
    // 40 blocks of 1.5 kb, AT-rich and GC-rich in turn, so the Viterbi path has more than 24 segments
    const block = (i: number) => randomBases(1_500, 0x5eed_aa30 + i).split('')
      .map((b, k) => (i % 2 === 0 ? (k % 5 === 0 ? b : 'AT'[k % 2]) : (k % 5 === 0 ? b : 'GC'[k % 2]))).join('');
    const banded = Array.from({ length: 40 }, (_, i) => block(i)).join('');
    const segments = segmentGenomeHmmViterbiRust(banded).segments.length;
    expect(segments, 'fixture: more segments than the table draws').toBeGreaterThan(24);
    const bandedDoc = dna('banded', 'Banded composition', banded);
    const genes = genomics(bandedDoc, [bandedDoc], 'genes-cpg-repeats');
    expect(caption(genes, 'Viterbi path segments')).toBe(`Viterbi path segments (first 24 of ${n(segments)})`);
    expect(rowsUnder(genes, 'Viterbi path segments')).toHaveLength(24);
    const fewBanded = Array.from({ length: 4 }, (_, i) => block(i)).join('');
    const fewSegments = segmentGenomeHmmViterbiRust(fewBanded).segments.length;
    expect(fewSegments, 'fixture').toBeLessThanOrEqual(24);
    const fewDoc = dna('few', 'Four blocks', fewBanded);
    const fewGenes = genomics(fewDoc, [fewDoc], 'genes-cpg-repeats');
    expect(caption(fewGenes, 'Viterbi path segments')).toBe(`Viterbi path segments (${fewSegments})`);
    expect(rowsUnder(fewGenes, 'Viterbi path segments')).toHaveLength(fewSegments);
  }, 60_000);

  it('labels sampled identity and strided mean GC as approximate', () => {
    // ─── Pairwise identity past 4,000 pairs ───
    // 90 sequences make 4,005 pairs, past the 4,000 the identity compares, so it reads every second
    // pair: 2,003 of them. 89 make 3,916 and are all compared. Wrong implementations this catches:
    // no label; a label from 91 sequences on, or from 89; and a pair count that is not the one read.
    // Two kinds of member, A and B: the first and every odd-numbered row are A, the rest B. Pair
    // (0, j) is the (j - 1)th pair, so the pairs read with row 0 are its pairs with A rows, and the
    // sampled identity (69.8%) is above the identity over every pair (68.4%).
    const [kindA, kindB] = [randomBases(24, 0x5eed_aa40), randomBases(24, 0x5eed_aa41)];
    const rows90 = Array.from({ length: 90 }, (_, i) => (i === 0 || i % 2 === 1 ? kindA : kindB));
    // the identity the 90 sequences have over every pair, pooled, counted here
    let same = 0;
    let compared = 0;
    for (let i = 0; i < rows90.length; i++) for (let j = i + 1; j < rows90.length; j++) {
      for (let c = 0; c < 24; c++) { compared++; if (rows90[i][c] === rows90[j][c]) same++; }
    }
    const exact = Math.round((same / compared) * 1000) / 10;
    const sampled = meanPairwiseIdentity(rows90);
    expect([sampled, exact], 'fixture: the sampled identity is not the exact one').toEqual([69.8, 68.4]);
    const chip = (html: string) => /<span>Pairwise identity<\/span><strong>([^<]*)<\/strong>/.exec(html)?.[1];
    const statistic = (html: string) => /<span>Pairwise Identity:<\/span><strong>([^<]*)<\/strong>/.exec(html)?.[1];
    const ninety = renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(alignment('aln-90', rows90), { initialInspectorTab: 'statistics' })} />);
    expect(chip(ninety)).toBe(`${sampled}% (approx., 2,003 of 4,005 pairs sampled)`);
    expect(statistic(ninety)).toBe(`${sampled}% (approx., 2,003 of 4,005 pairs sampled)`);
    const rows89 = rows90.slice(0, 89);
    const eightyNine = renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(alignment('aln-89', rows89), { initialInspectorTab: 'statistics' })} />);
    expect(chip(eightyNine)).toBe(`${meanPairwiseIdentity(rows89)}%`);
    expect(statistic(eightyNine)).toBe(`${meanPairwiseIdentity(rows89)}%`);

    // ─── Mean GC from 4,096 bases a bin ───
    // GAGA…: half G, so 50% GC. At 737,280 bp each of the 180 bins is 4,096 bases from an even
    // offset, and the engine reads every second base of each: all G, 100%. At 737,100 bp (4,095 a
    // bin) it reads every base. At 2,211,840 bp (12,288 a bin) it reads 1 in 6, still all G.
    // Wrong implementations this catches: no label; a label by sequence length rather than by the
    // engine's window (both 737 kb sequences would read alike); and a stride that is not the
    // engine's (1 in 2 at both strided lengths).
    const gaga = (length: number, id: string) => dna(id, `GA repeat ${n(length)} bp`, 'GA'.repeat(length / 2), { topology: 'circular' });
    const strided = gaga(737_280, 'ga-737280');
    const whole = gaga(737_100, 'ga-737100');
    const wider = gaga(2_211_840, 'ga-2211840');
    expect([strided, whole, wider].map((d) => getResidentTrackOverviewRust(d, 180).meanGcPercent), 'fixture: the engine strides').toEqual([100, 50, 100]);
    expect(hudPill(circular(strided, [], false))).toBe('Mean GC 100.0% (approx., 1 base in 2 sampled) • 0 features');
    expect(hudPill(circular(whole, [], false))).toBe('Mean GC 50.0% • 0 features');
    expect(hudPill(circular(wider, [], false))).toBe('Mean GC 100.0% (approx., 1 base in 6 sampled) • 0 features');
    const legend = (html: string) => wordsOf(/(Graphs: — %GC[^<]*)</.exec(html)?.[1] ?? '');
    expect(legend(linear(strided, true))).toBe('Graphs: — %GC (100.0%, approx., 1 base in 2 sampled) -- %AT ⋯ Cum. GC-Skew');
    expect(legend(linear(whole, true))).toBe('Graphs: — %GC (50.0%) -- %AT ⋯ Cum. GC-Skew');
  }, 60_000);
});
