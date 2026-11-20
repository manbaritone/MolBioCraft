// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1GB: the phylogenetics studio and the evolution-analysis reports state how much of each
 * list they show, from the total the engine returns beside it.
 *
 * The engine lists every internal node, site and variable codon (it used to stop at 60 nodes,
 * 2,000 sites, 500 codons and 10,000 sites without saying so). The studio draws at most 10,000
 * rows of a per-site or per-codon table and says "the first 10,000 of M" through ResultWarnings;
 * the reports list everything and say so. Every M below is counted here from the input (columns,
 * variable codons, the n - 1 internal nodes of the binary midpoint-rooted tree on n tips), never
 * taken from the studio's constant. The engine's own total is pinned by handing the studio and the
 * report a real engine report whose list is cut short: the label must still read the engine's total.
 *
 * Inputs are generated from fixed seeds and run through the real WASM engine (the spies below keep
 * the real implementation unless a test hands back a report).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PhylogeneticsStudio } from '../components/AlignmentAndPhyloStudio';
import { ALIGNED_MEMBER_METADATA_KEY } from '../core/documentViews';
import { runEvolutionAnalysis } from '../core/evolutionAnalyses';
import {
  estimateGammaAndSiteRates, inferAncestralSequences, runMolecularClockAndTimetree, runSelectionAndNeutralityTests,
  type AncestralReconstructionReport, type MolecularClockAndTimetreeReport, type SelectionAndNeutralityReport, type SiteRatesReport,
} from '../core/phyloEvoEngine';
import type { SequenceDocument } from '../types/bio';
import type { FigureTable } from '../core/figureExport';
import { evaluateTableRowFilters, type SmartTableExportView } from '../components/WorkbenchSmartTable';

/**
 * BG-01M6T6XF: what each smart table's export button would write. The export button and the table
 * render as they ship; these pass-throughs only keep, by table label, the button's `table` closure
 * (the shared export path: the table's rows on screen, handed to its host's exportTable), the
 * host's exportTable, and the view the table last handed it.
 */
const tables = vi.hoisted(() => ({
  exportOf: new Map<string, () => FigureTable | null>(),
  hostOf: new Map<string, (ids: string[], view: SmartTableExportView) => FigureTable | null>(),
  viewOf: new Map<string, SmartTableExportView>(),
}));
vi.mock('../components/FigureExportButton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/FigureExportButton')>();
  const { createElement } = await import('react');
  const FigureExportButton = (props: Parameters<typeof actual.FigureExportButton>[0]) => {
    if (typeof props.table === 'function') tables.exportOf.set(props.title ?? props.baseName, props.table);
    return createElement(actual.FigureExportButton, props);
  };
  return { ...actual, FigureExportButton };
});
vi.mock('../components/WorkbenchSmartTable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/WorkbenchSmartTable')>();
  const { createElement } = await import('react');
  const WorkbenchSmartTable = (props: Parameters<typeof actual.WorkbenchSmartTable>[0]) => {
    const label = props.tableLabel ?? props.tableId;
    const host = props.exportTable;
    if (host) tables.hostOf.set(label, host);
    return createElement(actual.WorkbenchSmartTable, {
      ...props,
      ...(host ? { exportTable: (ids: string[], view: SmartTableExportView) => { tables.viewOf.set(label, view); return host(ids, view); } } : {}),
    });
  };
  return { ...actual, WorkbenchSmartTable };
});

vi.mock('../core/phyloEvoEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/phyloEvoEngine')>();
  return {
    ...actual,
    inferAncestralSequences: vi.fn(actual.inferAncestralSequences),
    runSelectionAndNeutralityTests: vi.fn(actual.runSelectionAndNeutralityTests),
    estimateGammaAndSiteRates: vi.fn(actual.estimateGammaAndSiteRates),
    runMolecularClockAndTimetree: vi.fn(actual.runMolecularClockAndTimetree),
  };
});
const ancestors = vi.mocked(inferAncestralSequences);
const selection = vi.mocked(runSelectionAndNeutralityTests);
const rates = vi.mocked(estimateGammaAndSiteRates);
const clock = vi.mocked(runMolecularClockAndTimetree);

// ─── Inputs from fixed seeds ───

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const BASES = 'ACGT';

/**
 * `n` rows of a `block`-column block evolved by random binary splits (each child changes each base
 * with probability `p`, except in the first `shared` columns), then the block repeated to `total`
 * columns, so few site patterns keep the likelihood fits fast.
 */
function tiledAlignment(seed: number, n: number, block: number, shared: number, total: number, p: number): string[] {
  const rnd = mulberry32(seed);
  const pick = () => BASES[Math.floor(rnd() * 4)];
  let pool: string[][] = [Array.from({ length: block }, pick)];
  while (pool.length < n) {
    const [parent] = pool.splice(Math.floor(rnd() * pool.length), 1);
    for (let k = 0; k < 2; k++) pool.push(parent.map((b, c) => (c >= shared && rnd() < p ? pick() : b)));
  }
  pool = pool.slice(0, n);
  return pool.map((row) => Array.from({ length: total }, (_, c) => row[c % block]).join(''));
}

/** Coding rows of `codons` GCN (Ala) codons; rows 0 and 1 differ at every third position, so every codon varies. */
function codingAlignment(seed: number, rows: number, codons: number): string[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: codons }, () => `GC${r === 0 ? 'A' : r === 1 ? 'C' : BASES[Math.floor(rnd() * 4)]}`).join(''));
}

const docs = (rows: string[]): SequenceDocument[] => rows.map((sequence, i) => ({
  id: `row-${i}`, name: `t${String(i).padStart(2, '0')}`, accession: '', description: '', moleculeType: 'DNA', topology: 'linear',
  sequence, features: [], primers: [], history: [], createdAt: '', updatedAt: '', folder: 'Alignments',
  docMetadata: { [ALIGNED_MEMBER_METADATA_KEY]: String(i + 1) },
} as SequenceDocument));

/** Codons (from column 1) holding two or more distinct ACGT triplets, counted here. */
function variableCodons(rows: string[]): number {
  let count = 0;
  for (let k = 0; 3 * k + 3 <= rows[0].length; k++) {
    const seen = new Set(rows.map((s) => s.slice(3 * k, 3 * k + 3)).filter((c) => /^[ACGT]{3}$/.test(c)));
    if (seen.size >= 2) count++;
  }
  return count;
}

// 64 tips (63 internal nodes, past the old 60) and 2,120 columns (past the old 2,000).
const TREE = tiledAlignment(0x0a11, 64, 40, 4, 2_120, 0.06);
// 4 rows of 10,050 codons: 30,150 sites and 10,050 variable codons, past the studio's 10,000 rows.
const LONG = codingAlignment(0x0c0d, 4, 10_050);
// 6 rows of 1,040 codons: every one varies (past the old 500), under the studio's 10,000 rows.
const CODING = codingAlignment(0x0c0e, 6, 1_040);

const fmt = (v: number) => v.toLocaleString('en-US');

// ─── Reading the rendered studio ───

type Tab = 'ancestors' | 'selection' | 'rates' | 'clocks';
const studio = (rows: string[], tab: Tab) => {
  const documents = docs(rows);
  return renderToStaticMarkup(
    <PhylogeneticsStudio documents={documents} activeDoc={documents[0]} initialPhyloTab={tab} initialTreeAlgorithm="Neighbor-Joining (NJ)" />,
  );
};
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The sentences of the ResultWarnings region named `label`, or [] when it is not rendered. */
function warningsIn(html: string, label: string): string[] {
  const at = html.indexOf(`aria-label="${label}" data-mbc-result-warnings`);
  if (at < 0) return [];
  const region = html.slice(at, html.indexOf('</div>', at));
  return [...region.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => decode(m[1]));
}

/** The body rows of the table whose region is named `label`, as the text of their first cell. */
function rowsIn(html: string, label: string): string[] {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at, `the ${label} table is drawn`).toBeGreaterThan(-1);
  const body = html.slice(html.indexOf('<tbody', at), html.indexOf('</tbody>', at));
  return [...body.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')).trim());
}

/** The ancestral node cards of the ancestors module, by node name. */
function nodeCards(html: string): string[] {
  const start = html.indexOf('Infer Ancestral Sequences (MRCA');
  const end = html.indexOf('Root State Probabilities Per Site', start);
  return [...html.slice(start, end).matchAll(/<div class="primer-detail-card">[\s\S]*?<strong>([^<]*)<\/strong>/g)].map((m) => m[1]);
}

/** What the real engine returns for `args`, called through the spy's own implementation. */
function realReport<T>(fn: { getMockImplementation(): unknown }, args: unknown[]): T {
  const impl = fn.getMockImplementation() as (...a: unknown[]) => T;
  return impl(...args);
}

// ─── The studio ───

describe('the phylogenetics studio', () => {
  it('labels capped phylogenetics lists with their totals', () => {
    const longSites = LONG[0].length;
    const longCodons = variableCodons(LONG);
    expect([longSites, longCodons]).toEqual([30_150, 10_050]);

    // Past the studio's 10,000 rows: the table draws the first 10,000, in order, and says of how many.
    const ratesHtml = studio(LONG, 'rates');
    const rateRows = rowsIn(ratesHtml, 'Position-by-Position Evolutionary Rates');
    expect(rateRows).toEqual(Array.from({ length: 10_000 }, (_, i) => `Site #${i + 1}`));
    expect(warningsIn(ratesHtml, 'Site rate warnings')).toEqual([`The table lists the first 10,000 of ${fmt(longSites)} sites.`]);

    const selHtml = studio(LONG, 'selection');
    expect(rowsIn(selHtml, 'Site-by-Site Codon Selection Profile')).toEqual(Array.from({ length: 10_000 }, (_, i) => `#${i + 1}`));
    expect(warningsIn(selHtml, 'Variable codon warnings')).toEqual([`The table lists the first 10,000 of ${fmt(longCodons)} variable codons.`]);

    const longAnc = studio(LONG, 'ancestors');
    expect(rowsIn(longAnc, 'Per-Site Evolutionary Probabilities')).toEqual(Array.from({ length: 10_000 }, (_, i) => `#${i + 1}`));
    expect(warningsIn(longAnc, 'Root state probability warnings')).toEqual([`The table lists the first 10,000 of ${fmt(longSites)} sites.`]);
    expect(nodeCards(longAnc)).toHaveLength(LONG.length - 1);
    expect(warningsIn(longAnc, 'Ancestral node warnings')).toEqual([]);

    // Past the engine's old bounds, under the studio's: every row, and nothing said.
    const anc = studio(TREE, 'ancestors');
    const cards = nodeCards(anc);
    expect(cards).toHaveLength(TREE.length - 1);
    expect(new Set(cards).size).toBe(TREE.length - 1);
    expect(rowsIn(anc, 'Per-Site Evolutionary Probabilities')).toHaveLength(TREE[0].length);
    expect(warningsIn(anc, 'Ancestral node warnings')).toEqual([]);
    expect(warningsIn(anc, 'Root state probability warnings')).toEqual([]);

    const clockHtml = studio(TREE, 'clocks');
    expect(rowsIn(clockHtml, 'Strict-clock node ages')).toHaveLength(TREE.length - 1);
    expect(warningsIn(clockHtml, 'Timetree warnings')).toEqual([]);

    const codingSel = studio(CODING, 'selection');
    expect(rowsIn(codingSel, 'Site-by-Site Codon Selection Profile')).toHaveLength(variableCodons(CODING));
    expect(warningsIn(codingSel, 'Variable codon warnings')).toEqual([]);

    // An engine list shorter than the engine's total: each label reads the total the engine sent.
    const names = TREE.map((_, i) => `t${String(i).padStart(2, '0')}`);
    const fullAnc = realReport<AncestralReconstructionReport>(ancestors, [names, TREE, 'Maximum Likelihood (Empirical Bayes)']);
    expect([fullAnc.totalInternalNodes, fullAnc.totalSites]).toEqual([TREE.length - 1, TREE[0].length]);
    ancestors.mockReturnValueOnce({ ...fullAnc, nodes: fullAnc.nodes.slice(0, 60), siteEvolutionaryProbabilities: fullAnc.siteEvolutionaryProbabilities.slice(0, 2_000) });
    const cut = studio(TREE, 'ancestors');
    expect(nodeCards(cut)).toHaveLength(60);
    expect(warningsIn(cut, 'Ancestral node warnings')).toEqual([`The list shows the first 60 of ${TREE.length - 1} internal nodes.`]);
    expect(warningsIn(cut, 'Root state probability warnings')).toEqual([`The table lists the first 2,000 of ${fmt(TREE[0].length)} sites.`]);

    // An engine that sends no total (a stale build): the studio does not claim the list is whole.
    ancestors.mockReturnValueOnce({ ...fullAnc, totalInternalNodes: undefined as unknown as number });
    expect(warningsIn(studio(TREE, 'ancestors'), 'Ancestral node warnings'))
      .toEqual([`The list shows ${TREE.length - 1} internal nodes; the engine did not report how many there are.`]);

    const fullClock = realReport<MolecularClockAndTimetreeReport>(clock, [names, TREE, 'RelTime-ML', 42.5]);
    expect(fullClock.totalInternalNodes).toBe(TREE.length - 1);
    clock.mockReturnValueOnce({ ...fullClock, divergenceNodes: fullClock.divergenceNodes.slice(0, 60) });
    expect(warningsIn(studio(TREE, 'clocks'), 'Timetree warnings')).toEqual([`The timetree shows the first 60 of ${TREE.length - 1} internal nodes.`]);

    const fullSel = realReport<SelectionAndNeutralityReport>(selection, [CODING]);
    expect(fullSel.totalVariableCodons).toBe(variableCodons(CODING));
    selection.mockReturnValueOnce({ ...fullSel, codonSiteSelection: fullSel.codonSiteSelection.slice(0, 500) });
    expect(warningsIn(studio(CODING, 'selection'), 'Variable codon warnings')).toEqual([`The table lists the first 500 of ${fmt(variableCodons(CODING))} variable codons.`]);

    const fullRates = realReport<SiteRatesReport>(rates, [TREE, 5]);
    expect(fullRates.totalSites).toBe(TREE[0].length);
    rates.mockReturnValueOnce({ ...fullRates, siteRates: fullRates.siteRates.slice(0, 2_000) });
    expect(warningsIn(studio(TREE, 'rates'), 'Site rate warnings')).toEqual([`The table lists the first 2,000 of ${fmt(TREE[0].length)} sites.`]);
  });
});

// ─── The evolution-analysis reports ───

const ctx = { sourceLabel: 'Fixture' };
const reportOf = (rows: string[], kind: 'ancestors' | 'selection' | 'rates', v: Record<string, string | number | boolean>) => {
  const r = runEvolutionAnalysis(docs(rows), kind, v, ctx);
  return { r, text: String(r.created[0].docMetadata?.Notes) };
};
/** The line after `heading` and its blank line. */
const lineAfter = (text: string, heading: RegExp) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => heading.test(l));
  expect(at, `the report has ${heading}`).toBeGreaterThan(-1);
  return lines[at + 2];
};
/** The FASTA records of the report's ancestral sequences, as name and whole sequence. */
function fastaRecords(text: string): { name: string; seq: string }[] {
  const block = text.split('## Ancestral sequences (FASTA)')[1].split('\n## ')[0];
  return block.split('\n>').slice(1).map((rec) => {
    const [name, ...seq] = rec.split('\n');
    return { name, seq: seq.join('').trim() };
  });
}
/** The data rows of the tab-separated root-probability table. */
function rootRows(text: string): string[] {
  const block = text.split('## Root state probabilities per site')[1];
  const lines = block.split('\n');
  const head = lines.findIndex((l) => l.startsWith('Site\tConsensus'));
  return lines.slice(head + 1).filter((l) => /^\d+\t/.test(l));
}

describe('the evolution-analysis reports', () => {
  it('states totals in the evolution analysis reports', () => {
    const nodes = TREE.length - 1;
    const sites = TREE[0].length;

    // Every internal node, every site: the report lists them all and says so.
    const { r, text } = reportOf(TREE, 'ancestors', { method: 'ml', siteProbabilities: true });
    expect(lineAfter(text, /^## Maximum Likelihood marginal reconstruction/)).toBe(`All ${nodes} internal nodes are listed.`);
    expect(lineAfter(text, /^## Ancestral sequences \(FASTA\)$/)).toBe(`All ${nodes} internal nodes are listed.`);
    const fasta = fastaRecords(text);
    expect(fasta).toHaveLength(nodes);
    expect(new Set(fasta.map((f) => f.name)).size).toBe(nodes);
    for (const f of fasta) expect(f.seq).toHaveLength(sites);
    expect(lineAfter(text, /^## Root state probabilities per site$/)).toBe(`All ${fmt(sites)} sites are listed.`);
    expect(rootRows(text).map((l) => Number(l.split('\t')[0]))).toEqual(Array.from({ length: sites }, (_, i) => i + 1));
    expect(r.summary).toBe(`${nodes} ancestral nodes reconstructed`);
    expect(r.created[0].docMetadata?.['Ancestral nodes']).toBe(String(nodes));

    const codons = variableCodons(CODING);
    const sel = reportOf(CODING, 'selection', { test: 'codons' });
    expect(lineAfter(sel.text, /^## Codon-by-codon pN − pS/)).toBe(`All ${fmt(codons)} variable codons are listed.`);
    const tsvRows = sel.text.split('Tab-separated, for spreadsheets:')[1].split('\n').filter((l) => /^\d+\t/.test(l));
    expect(tsvRows.map((l) => Number(l.split('\t')[0]))).toEqual(Array.from({ length: codons }, (_, i) => i + 1));
    expect(sel.r.summary).toBe(`${fmt(codons)} variable codons`);

    const rateReport = reportOf(LONG, 'rates', { categories: 4 });
    expect(lineAfter(rateReport.text, /^## Relative rate of each site$/)).toBe(`All ${fmt(LONG[0].length)} sites are listed.`);
    const rateRows = rateReport.text.split('Tab-separated, for spreadsheets:')[1].split('\n').filter((l) => /^\d+\t/.test(l));
    expect(rateRows.map((l) => Number(l.split('\t')[0]))).toEqual(Array.from({ length: LONG[0].length }, (_, i) => i + 1));

    // An engine list shorter than the engine's total: the report states the total the engine sent.
    const names = TREE.map((_, i) => `t${String(i).padStart(2, '0')}`);
    const full = realReport<AncestralReconstructionReport>(ancestors, [names, TREE, 'Maximum Likelihood (Empirical Bayes)']);
    ancestors.mockReturnValueOnce({ ...full, nodes: full.nodes.slice(0, 60), siteEvolutionaryProbabilities: full.siteEvolutionaryProbabilities.slice(0, 2_000) });
    const cut = reportOf(TREE, 'ancestors', { method: 'ml', siteProbabilities: true });
    expect(lineAfter(cut.text, /^## Maximum Likelihood marginal reconstruction/)).toBe(`The first 60 of ${nodes} internal nodes are listed.`);
    expect(lineAfter(cut.text, /^## Ancestral sequences \(FASTA\)$/)).toBe(`The first 60 of ${nodes} internal nodes are listed.`);
    expect(fastaRecords(cut.text)).toHaveLength(60);
    expect(lineAfter(cut.text, /^## Root state probabilities per site$/)).toBe(`The first 2,000 of ${fmt(sites)} sites are listed.`);
    expect(cut.r.summary).toBe(`60 of ${nodes} ancestral nodes reconstructed`);
    expect(cut.r.created[0].docMetadata?.['Ancestral nodes']).toBe(`60 of ${nodes}`);

    const fullSel = realReport<SelectionAndNeutralityReport>(selection, [CODING]);
    selection.mockReturnValueOnce({ ...fullSel, codonSiteSelection: fullSel.codonSiteSelection.slice(0, 500) });
    const cutSel = reportOf(CODING, 'selection', { test: 'codons' });
    expect(lineAfter(cutSel.text, /^## Codon-by-codon pN − pS/)).toBe(`The first 500 of ${fmt(codons)} variable codons are listed.`);
    expect(cutSel.r.summary).toBe(`500 of ${fmt(codons)} variable codons`);

    // Two sequences: the engine reconstructs nothing (it needs three), and the report says none.
    const none = reportOf(TREE.slice(0, 2), 'ancestors', { method: 'ml' });
    expect(lineAfter(none.text, /^## Maximum Likelihood \(Empirical Bayes\): needs/)).toBe('No internal nodes are listed.');
    expect(fastaRecords(none.text)).toHaveLength(0);

    // An engine that sends no total (a stale build): the report does not claim the list is whole.
    ancestors.mockReturnValueOnce({ ...full, totalInternalNodes: undefined as unknown as number });
    const stale = reportOf(TREE, 'ancestors', { method: 'ml' });
    expect(lineAfter(stale.text, /^## Maximum Likelihood marginal reconstruction/)).toBe(`${nodes} internal nodes are listed; the engine did not report how many there are.`);
  });
});

// ─── BG-01M6T6XF: the export of a capped table ───

/** What the export button of the table labelled `label` writes, as it would on a click now. */
function exported(label: string): FigureTable {
  const table = tables.exportOf.get(label);
  expect(table, `the ${label} table has an export button`).toBeDefined();
  const file = table!();
  expect(file, `the ${label} export`).not.toBeNull();
  return file!;
}

describe('the export of a capped phylogenetics table', () => {
  it('exports every site of a capped evolutionary-rates table', () => {
    const label = 'Position-by-Position Evolutionary Rates';
    rates.mockClear();
    const html = studio(LONG, 'rates');
    const report = rates.mock.results.at(-1)!.value as SiteRatesReport;
    expect(report.siteRates).toHaveLength(30_150);
    expect(rowsIn(html, label), 'the table draws 10,000').toHaveLength(10_000);
    const cells = (r: SiteRatesReport['siteRates'][number]) => [`Site #${r.position}`, String(r.relativeRate), String(r.entropyBits), `Category ${r.rateCategory}`];

    // the header and one row per site the result holds, not the 10,000 drawn
    const file = exported(label);
    expect(file.headers).toEqual(['Site Position', 'Relative Rate (r_i)', 'Shannon Entropy (bits)', 'Gamma Category']);
    expect(file.rows).toHaveLength(30_150);
    expect(file.rows).toEqual(report.siteRates.map(cells));
    expect(file.caption, 'nothing is left out, so the caption says nothing more').toBe(label);

    // With a filter in force: every row it keeps, the drawn ones the table hands over, then those
    // past the cut. The quick filter 'Category 1' (the table's own predicate) keeps the category-1 sites.
    expect(report.numCategories).toBeLessThan(10);
    const view = tables.viewOf.get(label)!;
    expect(view.filterActive).toBe(false);
    const keepsCat1 = (textOf: (colId: string) => string) => evaluateTableRowFilters(textOf, view.columns.map((c) => c.id), 'Category 1', [], 'all');
    const wanted = report.siteRates.filter((r) => r.rateCategory === 1);
    const drawnKept = wanted.filter((r) => r.position <= 10_000);
    expect(drawnKept.length, 'the filter keeps some drawn rows').toBeGreaterThan(0);
    expect(wanted.length - drawnKept.length, 'and some past the cut').toBeGreaterThan(0);
    expect(wanted.length, 'and hides some').toBeLessThan(30_150);
    const filtered = tables.hostOf.get(label)!(drawnKept.map((r) => String(r.position)), { ...view, filterActive: true, keeps: keepsCat1 });
    expect(filtered!.rows).toEqual(wanted.map(cells));
    // the rows the table hands over keep its on-screen order (here sorted by site, descending),
    // then the rows past the cut follow in the result's order
    const sortedDown = report.siteRates.slice(0, 10_000).reverse();
    const sorted = tables.hostOf.get(label)!(sortedDown.map((r) => String(r.position)), view);
    expect(sorted!.rows).toEqual([...sortedDown, ...report.siteRates.slice(10_000)].map(cells));
    // a hidden column is left out of the header and of every row, and the filter still reads it
    const noEntropy = { ...view, columns: view.columns.filter((c) => c.index !== 2) };
    const hidden = tables.hostOf.get(label)!(report.siteRates.slice(0, 10_000).map((r) => String(r.position)), noEntropy);
    expect(hidden!.headers).toEqual(['Site Position', 'Relative Rate (r_i)', 'Gamma Category']);
    expect(hidden!.rows).toEqual(report.siteRates.map((r) => [cells(r)[0], cells(r)[1], cells(r)[3]]));
    const entropyCol = view.allColumns.find((c) => c.index === 2)!.id;
    const byEntropy = (textOf: (colId: string) => string) => evaluateTableRowFilters(textOf, [], '', [{ id: 'r', colId: entropyCol, operator: 'equals', value: cells(report.siteRates[10_002])[2] }], 'all');
    const sameEntropy = report.siteRates.filter((r) => String(r.entropyBits) === String(report.siteRates[10_002].entropyBits));
    expect(sameEntropy.length).toBeLessThan(30_150);
    const onHidden = tables.hostOf.get(label)!([], { ...noEntropy, filterActive: true, keeps: byEntropy });
    expect(onHidden!.rows).toEqual(sameEntropy.filter((r) => r.position > 10_000).map((r) => [cells(r)[0], cells(r)[1], cells(r)[3]]));

    // A result that holds fewer sites than the engine's total, or no total: the file says so.
    const names = TREE.map((_, i) => `t${String(i).padStart(2, '0')}`);
    const full = realReport<SiteRatesReport>(rates, [TREE, 5]);
    rates.mockReturnValueOnce({ ...full, siteRates: full.siteRates.slice(0, 2_000) });
    studio(TREE, 'rates');
    const short = exported(label);
    expect(short.rows).toHaveLength(2_000);
    expect(short.caption).toBe(`${label}\nThe file lists the first 2,000 of ${fmt(TREE[0].length)} sites.`);
    rates.mockReturnValueOnce({ ...full, totalSites: undefined as unknown as number });
    studio(TREE, 'rates');
    expect(exported(label).caption).toBe(`${label}\nThe file lists ${fmt(TREE[0].length)} sites; the engine did not report how many there are.`);
    expect(names).toHaveLength(TREE.length);
  }, 120_000);

  it('exports every row of the capped ancestral-site and codon-selection tables', () => {
    const ancLabel = 'Per-Site Evolutionary Probabilities';
    ancestors.mockClear();
    const anc = studio(LONG, 'ancestors');
    const ancReport = ancestors.mock.results.at(-1)!.value as AncestralReconstructionReport;
    expect(ancReport.siteEvolutionaryProbabilities).toHaveLength(30_150);
    expect(rowsIn(anc, ancLabel)).toHaveLength(10_000);
    const ancFile = exported(ancLabel);
    expect(ancFile.headers).toEqual(['Site', 'Root State', 'Majority (tips)', 'P(A)', 'P(C)', 'P(G)', 'P(T)']);
    expect(ancFile.rows).toEqual(ancReport.siteEvolutionaryProbabilities.map((p) =>
      [`#${p.position}`, p.ancestralStateRoot, p.consensusState, String(p.probA), String(p.probC), String(p.probG), String(p.probT)]));
    expect(ancFile.caption).toBe(ancLabel);

    const selLabel = 'Site-by-Site Codon Selection Profile';
    selection.mockClear();
    const sel = studio(LONG, 'selection');
    const selReport = selection.mock.results.at(-1)!.value as SelectionAndNeutralityReport;
    expect(selReport.codonSiteSelection).toHaveLength(10_050);
    expect(rowsIn(sel, selLabel)).toHaveLength(10_000);
    const selFile = exported(selLabel);
    expect(selFile.headers).toEqual(['Codon #', 'Observed Codons', 'Residues', 'p_N − p_S', 'Pattern']);
    expect(selFile.rows).toEqual(selReport.codonSiteSelection.map((c) =>
      [`#${c.codonIndex}`, c.codonsObserved, c.aminoAcidsObserved, String(c.dNMinusDS), c.selectionRegime]));
    expect(selFile.caption).toBe(selLabel);

    // a result cut short of the engine's total says so in the file
    const fullSel = realReport<SelectionAndNeutralityReport>(selection, [CODING]);
    selection.mockReturnValueOnce({ ...fullSel, codonSiteSelection: fullSel.codonSiteSelection.slice(0, 500) });
    studio(CODING, 'selection');
    expect(exported(selLabel).caption).toBe(`${selLabel}\nThe file lists the first 500 of ${fmt(variableCodons(CODING))} variable codons.`);
    const names = TREE.map((_, i) => `t${String(i).padStart(2, '0')}`);
    const fullAnc = realReport<AncestralReconstructionReport>(ancestors, [names, TREE, 'Maximum Likelihood (Empirical Bayes)']);
    ancestors.mockReturnValueOnce({ ...fullAnc, siteEvolutionaryProbabilities: fullAnc.siteEvolutionaryProbabilities.slice(0, 2_000) });
    studio(TREE, 'ancestors');
    expect(exported(ancLabel).caption).toBe(`${ancLabel}\nThe file lists the first 2,000 of ${fmt(TREE[0].length)} sites.`);
  }, 120_000);
});
