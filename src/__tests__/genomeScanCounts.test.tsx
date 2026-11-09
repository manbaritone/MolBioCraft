// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1P2: the Genomics studio gives each genome scan's count as the total the engine found,
 * and a list that shows fewer says how many of how many: "top N of M" for a ranked list (predicted
 * genes, repeats), "first N of M" for one in sequence order (STR loci, synteny blocks). The
 * repeat scan's own warnings (the 250 kb scan cap, US-01M6P244 AC4, and the list cap) are shown
 * beside the repeat list, through the shared ResultWarnings component.
 *
 * BG-01M6SQ9T: the repeat scan stops after comparing 10,000,000 copy pairs (D0055). On a satellite
 * array, which holds far more, the badge and the caption read the total as "at least" that many and
 * the list as the longest found before the scan stopped, and the engine's stop sentence sits beside
 * the list, with its sentence that no inverted or palindromic repeat was compared when the scan
 * stopped among the direct ones. Every repeat caption names the arm length its scan was run at.
 *
 * Every number here comes from the real WASM engine, asked through the same wrappers the studio
 * calls. BG-01M6T6HW: synteny, gene prediction and the CpG island scan run after the studio's first
 * frame, never in render, so the studio is mounted with React's client renderer under fake timers,
 * its scans are let land, and what it then shows is read as markup and as the words it shows. The
 * sequences are generated from fixed seeds, so no reference data is needed.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GenomicsNgsAndPredictionStudio } from '../components/GenomicsNgsAndPredictionStudio';

// BG-01M6SKKV: the synteny wrapper is the real engine call, wrapped so one check can hand the
// studio the engine's own report with its coverage marked as a lower bound (the public scan indexes
// every base of genome B, so it never samples). Every other call, here and in the studio, goes to
// the engine unchanged.
vi.mock('../core/genomicsAndStructureSuite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/genomicsAndStructureSuite')>();
  return { ...actual, runWholeGenomeSynteny: vi.fn(actual.runWholeGenomeSynteny) };
});
import {
  findCpGIslands,
  findGenomicRepeats,
  predictGlimmerMicrobialGenes,
  runWholeGenomeSynteny,
  scanMicrosatelliteStrs,
} from '../core/genomicsAndStructureSuite';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
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

/** The node operations React DOM's client renderer calls, as in repeatArmDebounce.test.tsx, and no more. */
class MarkupNode {
  childNodes: MarkupNode[] = [];
  parentNode: MarkupNode | null = null;
  constructor(readonly nodeType: number, readonly nodeName: string, readonly ownerDocument: MarkupDocument | null) {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const s = this.parentNode?.childNodes ?? []; return s[s.indexOf(this) + 1] ?? null; }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(t: string) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = t ? [new MarkupText(t, this.ownerDocument!)] : [];
  }
  appendChild(child: MarkupNode) { return this.insertBefore(child, null); }
  insertBefore(child: MarkupNode, before: MarkupNode | null) {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: MarkupNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  contains(other: MarkupNode | null) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  addEventListener() {}
  removeEventListener() {}
  /** Finds nothing: the studio's tab strip asks for its active tab only to scroll it into view. */
  querySelector() { return null; }
}
class MarkupText extends MarkupNode {
  constructor(public nodeValue: string, doc: MarkupDocument) { super(3, '#text', doc); }
  override get textContent() { return this.nodeValue; }
  override set textContent(t: string) { this.nodeValue = t; }
}
class MarkupElement extends MarkupNode {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> = { setProperty() {}, removeProperty() {} };
  value = '';
  constructor(readonly tagName: string, doc: MarkupDocument) { super(1, tagName.toUpperCase(), doc); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  get type() { return this.attributes.get('type') ?? 'text'; }
  get options(): MarkupElement[] {
    return this.childNodes.flatMap((c) => (c instanceof MarkupElement ? (c.nodeName === 'OPTION' ? [c] : c.options) : []));
  }
  get classList() {
    const classes = () => (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => classes().includes(c),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !classes().includes(c);
        this.setAttribute('class', [...new Set(on ? [...classes(), c] : classes().filter((x) => x !== c))].join(' '));
        return on;
      },
    };
  }
}
class MarkupDocument extends MarkupNode {
  readonly body: MarkupElement;
  constructor() {
    super(9, '#document', null);
    this.body = this.createElement('body');
    this.appendChild(this.body);
  }
  get activeElement() { return this.body; }
  createElement(tag: string) { return new MarkupElement(tag, this); }
  createElementNS(_ns: string, tag: string) { return new MarkupElement(tag, this); }
  createTextNode(t: string) { return new MarkupText(t, this); }
}

/** A tree as markup, text and attribute values escaped as React's server renderer escapes them. */
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const markupOf = (node: MarkupNode): string => node.childNodes.map((c) => (c instanceof MarkupElement
  ? `<${c.tagName}${[...c.attributes].map(([k, v]) => ` ${k}="${escapeText(v).replace(/"/g, '&quot;')}"`).join('')}>${markupOf(c)}</${c.tagName}>`
  : escapeText((c as MarkupText).nodeValue))).join('');

/** What the studio shows on `tab` once every scan it starts has landed, as markup. */
async function studio(activeDoc: SequenceDocument, documents: SequenceDocument[], tab: 'genes-cpg-repeats' | 'genome-variants'): Promise<string> {
  const g = globalThis as Record<string, unknown>;
  const before = { window: g.window, document: g.document };
  const page = new MarkupDocument();
  Object.assign(g, { window: { document: page, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} }, document: page });
  const { flushSync } = await import('react-dom');
  const { createRoot } = await import('react-dom/client');
  vi.useFakeTimers();
  const container = page.createElement('div');
  page.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  try {
    flushSync(() => root.render(
      <GenomicsNgsAndPredictionStudio activeDoc={activeDoc} documents={documents} initialSubTab={tab}
        onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop} />
    ));
    // each scan runs in a task of its own after the first frame; its result renders as it lands
    for (let round = 0; vi.getTimerCount() > 0; round++) {
      if (round === 20) throw new Error('the studio still had tasks queued after 20 rounds');
      flushSync(() => { vi.runOnlyPendingTimers(); });
    }
    return markupOf(container);
  } finally {
    try { flushSync(() => root.unmount()); } finally {
      for (const [k, v] of Object.entries(before)) if (v === undefined) delete g[k]; else g[k] = v;
      vi.useRealTimers();
    }
  }
}

/** The words a stretch of markup shows: tags dropped, the entities React writes decoded. */
const wordsOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** The caption a table's rows sit under, by the words it opens with, and the body rows drawn after it. */
function tableUnder(html: string, captionStart: string): { caption: string; rows: number } {
  const captions = [...html.matchAll(/<div[^>]*class="mbc-table-caption"[^>]*>([\s\S]*?)<\/div>/g)];
  const hit = captions.find((m) => wordsOf(m[1]).startsWith(captionStart));
  if (!hit) throw new Error(`no table caption opening "${captionStart}"`);
  const after = html.slice(hit.index! + hit[0].length);
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(after)?.[1] ?? '';
  return { caption: wordsOf(hit[1]), rows: (body.match(/<tr[\s>]/g) ?? []).length };
}

/** Every warnings region in the markup: its accessible name, where it opens, and its sentences in order. */
function warningRegions(html: string): { label: string; at: number; sentences: string[] }[] {
  return [...html.matchAll(/<div([^>]*data-mbc-result-warnings[^>]*)>([\s\S]*?)<\/div>/g)].map((m) => ({
    label: /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? '',
    at: m.index!,
    sentences: [...m[2].matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) => wordsOf(p[1])),
  }));
}

/** 60 kb of random bases with a (CA)6 locus, flanked by GG and TT, every 200 bp: 300 loci. */
function strRichGenome(): string {
  const bases = randomBases(60_000, 0x5eed_0001).split('');
  for (let s = 100; s + 14 < bases.length; s += 200) {
    bases.splice(s - 2, 16, ...'GGCACACACACACATT');
  }
  return bases.join('');
}

/** The body rows drawn under the table caption that opens with `captionStart`, each as the words it shows. */
function rowsUnder(html: string, captionStart: string): string[] {
  const captions = [...html.matchAll(/<div[^>]*class="mbc-table-caption"[^>]*>([\s\S]*?)<\/div>/g)];
  const hit = captions.find((m) => wordsOf(m[1]).startsWith(captionStart));
  if (!hit) throw new Error(`no table caption opening "${captionStart}"`);
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(html.slice(hit.index! + hit[0].length))?.[1] ?? '';
  return [...body.matchAll(/<tr[\s>][\s\S]*?<\/tr>/g)].map((m) => wordsOf(m[0]));
}

const PAIRS: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const reverseComplement = (s: string) => s.split('').reverse().map((c) => PAIRS[c] ?? c).join('');

/** A repeat as the studio lists it: its arm length, 0-based arm starts, and whether arm 2 is reversed. */
interface CountedRepeat { arm: number; arm1: number; arm2: number; inverted: boolean }

/**
 * Every repeat in `seq` with arms of at least `k` bases, counted with no k-mer index: each maximal
 * run of the same known base along a diagonal of the dot plot is a direct repeat when it is `k`
 * long and its arms start more than `k` apart (its arm cut where arm 1 would reach arm 2), and
 * each maximal run of pairing bases along an anti-diagonal is an inverted one when it is `k` long
 * and its outer `k`-base arms do not overlap. N pairs and matches with nothing. Best first: longer
 * arm, then earlier arm 1, earlier arm 2, direct before inverted.
 */
function dotPlotRepeats(seq: string, k: number): CountedRepeat[] {
  const n = seq.length;
  const s = Uint8Array.from(seq, (c) => c.charCodeAt(0));
  const known = new Uint8Array(128);
  const pairsWith = new Uint8Array(128);
  for (const [b, p] of Object.entries(PAIRS)) {
    known[b.charCodeAt(0)] = 1;
    pairsWith[b.charCodeAt(0)] = p.charCodeAt(0);
  }
  const out: CountedRepeat[] = [];
  for (let d = 1; d < n; d++) {
    let start = -1;
    for (let a = 0; a <= n - d; a++) {
      const hit = a + d < n && known[s[a]] === 1 && s[a] === s[a + d];
      if (hit && start < 0) start = a;
      if (!hit && start >= 0) {
        const len = a - start;
        if (d > k && len >= k) out.push({ arm: Math.min(len, d), arm1: start, arm2: start + d, inverted: false });
        start = -1;
      }
    }
  }
  for (let sum = 1; sum <= 2 * n - 3; sum++) {
    let start = -1;
    let len = 0;
    const close = () => {
      const b0 = sum - start;
      if (len >= k && b0 + 1 >= start + 2 * k) out.push({ arm: len, arm1: start, arm2: b0 + 1 - len, inverted: true });
      start = -1;
    };
    for (let a = Math.max(0, sum - (n - 1)); a < sum - a; a++) {
      const hit = pairsWith[s[sum - a]] !== 0 && pairsWith[s[sum - a]] === s[a];
      if (hit) {
        if (start < 0) [start, len] = [a, 0];
        len++;
      } else if (start >= 0) close();
    }
    if (start >= 0) close();
  }
  return out.sort((x, y) => y.arm - x.arm || x.arm1 - y.arm1 || x.arm2 - y.arm2 || Number(x.inverted) - Number(y.inverted));
}

/**
 * 9,000 bp holding 20 copies of a 300-bp element, every fourth one reverse-complemented (190 pairs
 * of copies, 115 direct and 75 inverted), then a 150-bp poly-A, a (CA)60 and 120 bp of N.
 */
function highCopyGenome(): string {
  const bases = randomBases(9_000, 0x5eed_0005).split('');
  const element = randomBases(300, 0x5eed_0006);
  for (let c = 0; c < 20; c++) bases.splice(420 * c, 300, ...(c % 4 === 3 ? reverseComplement(element) : element));
  bases.splice(8_399, 152, ...`C${'A'.repeat(150)}G`);
  bases.splice(8_600, 120, ...'CA'.repeat(60));
  bases.splice(8_800, 120, ...'N'.repeat(120));
  return bases.join('');
}

/**
 * `n` bases of `unit` copied end to end, with each base at the given rate replaced by one of the
 * other three (LCG): a satellite array, such as HSat3's diverged (GGAAT)n.
 */
function satelliteArray(unit: string, n: number, rate: number, seed: number): string {
  let s = seed >>> 0;
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = unit[i % unit.length];
    out[i] = next() < rate ? 'ACGT'.replace(base, '')[Math.floor(next() * 3)] : base;
  }
  return out.join('');
}

/** A copy of `seq` with one base inserted every 150 bp: each insertion ends a collinear block. */
function withInsertions(seq: string): string {
  let out = '';
  for (let i = 0; i < seq.length; i += 150) out += seq.slice(i, i + 150) + (seq[i] === 'A' ? 'C' : 'A');
  return out;
}

describe('genome scan counts', () => {
  it('labels capped genome scan lists with their totals', async () => {
    // genes and repeats: a 60 kb random sequence predicts more than 24 CDS and holds more than
    // 80 repeats of a 10-bp arm (the studio's defaults: 45 aa, 10 bp)
    const genome = doc('g', 'Random 60 kb', randomBases(60_000, 0x5eed_0002));
    const genes = predictGlimmerMicrobialGenes(genome.sequence, 45);
    const repeats = findGenomicRepeats(genome.sequence, 10);
    expect(genes.genes).toHaveLength(24);
    expect(genes.totalPredictedCds, 'fixture: more CDS than the list holds').toBeGreaterThan(24);
    expect(repeats.repeats).toHaveLength(80);
    expect(repeats.totalRepeats, 'fixture: more repeats than the list holds').toBeGreaterThan(80);
    // the repeats listed hold both kinds, ranked together
    expect(new Set(repeats.repeats.map((r) => r.repeatType === 'Direct Repeat' ? 'direct' : 'inverted'))).toEqual(new Set(['direct', 'inverted']));

    const html = await studio(genome, [genome], 'genes-cpg-repeats');
    const words = wordsOf(html);
    const geneTable = tableUnder(html, 'Glimmer Predicted Protein-Coding Genes');
    expect(geneTable.caption).toBe(`Glimmer Predicted Protein-Coding Genes (top 24 of ${n(genes.totalPredictedCds)})`);
    expect(geneTable.rows).toBe(24);
    expect(words).toContain(`${n(genes.totalPredictedCds)} Predicted CDS`);
    const repeatTable = tableUnder(html, 'Direct, Inverted & Palindromic Repeats');
    expect(repeatTable.caption).toBe(`Direct, Inverted & Palindromic Repeats (arms ≥ 10 bp, top 80 of ${n(repeats.totalRepeats)})`);
    expect(repeatTable.rows).toBe(80);
    expect(words).toContain(`CpG Islands • ${n(repeats.totalRepeats)} Repeats`);
    // each cut list says so beside it, in the engine's words
    const regions = warningRegions(html);
    expect(regions.find((r) => r.label === 'Gene prediction warnings')?.sentences).toEqual([
      `Gene list capped: it shows the 24 highest-scoring of the ${n(genes.totalPredictedCds)} predicted CDS, and only these are annotated.`,
    ]);
    expect(regions.find((r) => r.label === 'Repeat scan warnings')?.sentences).toEqual([
      `Repeat list capped: it shows the 80 longest of the ${n(repeats.totalRepeats)} repeats found.`,
    ]);

    // many copies of one element, and low-complexity runs: the studio's count is every repeat
    // there is, as a count that walks the dot plot finds it, and the 80 rows are the 80 longest,
    // each pair of copies at its whole arm. The round-1 scan indexed each k-mer at its first 8
    // positions, so it missed most pairs of later copies and still called what it kept the longest.
    const copies = doc('c', 'Element x 20', highCopyGenome());
    const counted = dotPlotRepeats(copies.sequence, 10);
    expect(counted.filter((r) => r.arm >= 300).length, 'fixture: more copy pairs than the list holds').toBeGreaterThan(150);
    expect(counted.slice(0, 80).every((r) => r.arm >= 300), 'fixture: the 80 longest are copy pairs').toBe(true);
    const copiesHtml = await studio(copies, [copies], 'genes-cpg-repeats');
    expect(wordsOf(copiesHtml)).toContain(`CpG Islands • ${n(counted.length)} Repeats`);
    expect(tableUnder(copiesHtml, 'Direct, Inverted & Palindromic Repeats').caption)
      .toBe(`Direct, Inverted & Palindromic Repeats (arms ≥ 10 bp, top 80 of ${n(counted.length)})`);
    expect(warningRegions(copiesHtml).find((r) => r.label === 'Repeat scan warnings')?.sentences).toEqual([
      `Repeat list capped: it shows the 80 longest of the ${n(counted.length)} repeats found.`,
    ]);
    const kind = (r: CountedRepeat) =>
      !r.inverted ? 'Direct Repeat' : r.arm2 - (r.arm1 + r.arm) <= 4 ? 'Palindromic Site' : 'Inverted Repeat';
    expect(rowsUnder(copiesHtml, 'Direct, Inverted & Palindromic Repeats')).toEqual(
      counted.slice(0, 80).map((r) =>
        `${kind(r)} ${r.arm1 + 1}..${r.arm1 + r.arm} ${r.arm2 + 1}..${r.arm2 + r.arm} ${r.arm} bp ${copies.sequence.slice(r.arm1, r.arm1 + Math.min(r.arm, 36))}`)
    );

    // a list that holds everything found gives the count alone, with no warning
    const short = doc('s', 'Random 3 kb', randomBases(3_000, 0x5eed_0003));
    const shortGenes = predictGlimmerMicrobialGenes(short.sequence, 45);
    const shortRepeats = findGenomicRepeats(short.sequence, 10);
    expect(shortGenes.totalPredictedCds, 'fixture').toBe(shortGenes.genes.length);
    expect(shortRepeats.totalRepeats, 'fixture').toBe(shortRepeats.repeats.length);
    const shortHtml = await studio(short, [short], 'genes-cpg-repeats');
    expect(tableUnder(shortHtml, 'Glimmer Predicted Protein-Coding Genes').caption)
      .toBe(`Glimmer Predicted Protein-Coding Genes (${shortGenes.genes.length})`);
    expect(tableUnder(shortHtml, 'Direct, Inverted & Palindromic Repeats').caption)
      .toBe(`Direct, Inverted & Palindromic Repeats (arms ≥ 10 bp, ${shortRepeats.repeats.length})`);
    expect(warningRegions(shortHtml).filter((r) => /Gene prediction|Repeat scan/.test(r.label))).toEqual([]);

    // STR loci and synteny blocks: every one found, the table drawing the first 250
    const genomeA = doc('a', 'Genome A', strRichGenome());
    const genomeB = doc('b', 'Genome B', withInsertions(genomeA.sequence));
    const read = doc('r', 'Read', genomeA.sequence.slice(10_000, 10_600));
    const loci = scanMicrosatelliteStrs(genomeA.sequence, 4);
    const synteny = runWholeGenomeSynteny(genomeA.sequence, genomeB.sequence, 'Mauve');
    expect(loci.length, 'fixture: more STR loci than the table draws').toBeGreaterThan(250);
    expect(loci.filter((l) => l.alleleCall === '(CA)6').length, 'fixture: every planted locus found').toBeGreaterThanOrEqual(299);
    expect(synteny.blocks.length, 'fixture: more blocks than the table draws').toBeGreaterThan(250);

    const variants = await studio(genomeA, [genomeA, genomeB, read], 'genome-variants');
    const variantWords = wordsOf(variants);
    const strTable = tableUnder(variants, 'Microsatellite / STR Genotypes');
    expect(strTable.caption).toBe(`Microsatellite / STR Genotypes (first 250 of ${n(loci.length)})`);
    expect(strTable.rows).toBe(250);
    expect(variantWords).toContain(`STR Loci in Genome A ${loci.length}`);
    const lcbTable = tableUnder(variants, 'Synteny Blocks');
    expect(lcbTable.caption).toBe(`Synteny Blocks (first 250 of ${n(synteny.blocks.length)})`);
    expect(lcbTable.rows).toBe(250);
    expect(variantWords).toContain(`Collinear Blocks (LCBs) ${synteny.blocks.length}`);
    // the coverage is of every block, not of the 250 drawn
    expect(variantWords).toContain(`${synteny.totalAlignedBp.toLocaleString()} bp (${synteny.genomeACoveragePct}%)`);
    expect(synteny.genomeACoveragePct).toBeGreaterThan(95);
  }, 60_000);

  it('shows the repeat-scan warning from the engine reply', async () => {
    // 260,000 bp: the scan reads the first 250,000 and says so; its list is also cut at 80
    const long = doc('l', 'Random 260 kb', randomBases(260_000, 0x5eed_0004));
    const cut = 'Repeat scan covered only the first 250,000 bp of the 260,000-bp sequence; repeats past base 250,000 are not reported.';
    const scan = findGenomicRepeats(long.sequence, 10);
    expect([scan.scannedLengthBp, scan.sequenceLengthBp]).toEqual([250_000, 260_000]);
    expect(scan.warnings).toEqual([cut, `Repeat list capped: it shows the 80 longest of the ${n(scan.totalRepeats)} repeats found.`]);

    const html = await studio(long, [long], 'genes-cpg-repeats');
    const region = warningRegions(html).filter((r) => r.label === 'Repeat scan warnings');
    expect(region).toHaveLength(1);
    expect(region[0].sentences).toEqual(scan.warnings);
    // beside the repeat list: after its caption, before its table
    const caption = html.indexOf('Direct, Inverted &amp; Palindromic Repeats (');
    const table = html.indexOf('<table', caption);
    expect(caption).toBeGreaterThan(-1);
    expect(region[0].at).toBeGreaterThan(caption);
    expect(region[0].at).toBeLessThan(table);

    // a sequence within the scan cap shows no cut warning: only its list cap
    const within = doc('w', 'Random 250 kb', long.sequence.slice(0, 250_000));
    const withinScan = findGenomicRepeats(within.sequence, 10);
    expect(withinScan.warnings).toEqual([`Repeat list capped: it shows the 80 longest of the ${n(withinScan.totalRepeats)} repeats found.`]);
    const withinRegion = warningRegions(await studio(within, [within], 'genes-cpg-repeats')).filter((r) => r.label === 'Repeat scan warnings');
    expect(withinRegion.map((r) => r.sentences)).toEqual([withinScan.warnings]);
  }, 60_000);

  it('labels a bounded repeat total as a lower bound', async () => {
    // BG-01M6SQ9T: 250 kb of (GGAAT)n with 10% of its bases substituted, as HSat3 is diverged. Its
    // copy pairs at a 10-bp arm number more than the 10,000,000 the scan compares, so the scan
    // stops there; the 80 listed are the longest of the pairs compared, not of the whole array
    const hsat3 = doc('h', 'HSat3-like 250 kb', satelliteArray('GGAAT', 250_000, 0.1, 0x5eed_0008));
    const stop = 'The repeat scan stopped after comparing 10,000,000 copy pairs at arms of 10 bp; the total is a lower bound and the list holds the longest repeats found before it stopped.';
    // the scan compares direct repeats first and stops among them, so the list, captioned with all
    // three kinds, holds no inverted or palindromic repeat, and the engine says none was compared
    const notCompared = 'Inverted and palindromic repeats were not compared: the scan compares direct repeats first and stopped before it reached them, so the list holds direct repeats only.';
    const scan = findGenomicRepeats(hsat3.sequence, 10);
    expect([scan.totalRepeats, scan.totalIsLowerBound, scan.minArmBp, scan.repeats.length]).toEqual([10_000_000, true, 10, 80]);
    expect(scan.warnings).toEqual([stop, notCompared]);
    expect(scan.repeats.every((r) => r.repeatType === 'Direct Repeat')).toBe(true);

    const html = await studio(hsat3, [hsat3], 'genes-cpg-repeats');
    const words = wordsOf(html);
    const islands = findCpGIslands(hsat3.sequence, 200).islands.length;
    expect(words).toContain(`CpG Islands & Genomic Repeat Finder ${islands} CpG Islands • at least 10,000,000 Repeats`);
    const table = tableUnder(html, 'Direct, Inverted & Palindromic Repeats');
    expect(table.caption).toBe(
      'Direct, Inverted & Palindromic Repeats (arms ≥ 10 bp, 80 of at least 10,000,000, the longest found before the scan stopped)'
    );
    expect(table.rows).toBe(80);
    // the stop sentence and that no inverted repeat was compared, and no claim that the list is the
    // top or the longest of a total
    const regions = warningRegions(html).filter((r) => r.label === 'Repeat scan warnings');
    expect(regions.map((r) => r.sentences)).toEqual([[stop, notCompared]]);
    expect(words).not.toContain('top 80 of');
    expect(words).not.toContain('Repeat list capped');
    // beside the list it qualifies: after its caption, before its table
    const caption = html.indexOf('Direct, Inverted &amp; Palindromic Repeats (');
    expect(caption).toBeGreaterThan(-1);
    expect(regions[0].at).toBeGreaterThan(caption);
    expect(regions[0].at).toBeLessThan(html.indexOf('<table', caption));

    // the 60 kb random genome of the first check compares fewer pairs than the bound: its total is exact
    const genome = doc('g', 'Random 60 kb', randomBases(60_000, 0x5eed_0002));
    const exact = findGenomicRepeats(genome.sequence, 10);
    expect([exact.totalIsLowerBound, exact.minArmBp]).toEqual([false, 10]);
    expect(exact.totalRepeats, 'fixture: more repeats than the list holds').toBeGreaterThan(80);
    const exactHtml = await studio(genome, [genome], 'genes-cpg-repeats');
    expect(tableUnder(exactHtml, 'Direct, Inverted & Palindromic Repeats').caption)
      .toBe(`Direct, Inverted & Palindromic Repeats (arms ≥ 10 bp, top 80 of ${n(exact.totalRepeats)})`);
    const exactWords = wordsOf(exactHtml);
    expect(exactWords).toContain(` CpG Islands • ${n(exact.totalRepeats)} Repeats`);
    expect(exactWords).not.toMatch(/at least [\d,]+ Repeats|of at least/);
    expect(exactWords).not.toContain('The repeat scan stopped');
    expect(exactWords).not.toContain('were not compared');
    expect(warningRegions(exactHtml).filter((r) => r.label === 'Repeat scan warnings').map((r) => r.sentences)).toEqual([
      [`Repeat list capped: it shows the 80 longest of the ${n(exact.totalRepeats)} repeats found.`],
    ]);
  }, 60_000);

  it('shows the synteny warnings beside the coverage', async () => {
    // BG-01M6SKKV: 60 kb of random bases as genome B, and as genome A the same with its bases
    // 30,001-30,100 an N run: 59,900 A/C/G/T bases, which the engine's coverage is of
    const bases = randomBases(60_000, 0x5eed_0007);
    const gappedA = doc('ga', 'Gapped Genome', `${bases.slice(0, 30_000)}${'N'.repeat(100)}${bases.slice(30_100)}`);
    const partner = doc('gb', 'Partner Genome', bases);
    const synteny = runWholeGenomeSynteny(gappedA.sequence, partner.sequence, 'Mauve');
    expect(synteny.warnings).toEqual([
      'Genome A holds 100 N or other ambiguity bases; no block crosses them, and coverage is of its 59,900 A/C/G/T bases.',
    ]);
    expect(synteny.genomeACoverageIsLowerBound).toBe(false);
    expect(synteny.genomeACoveragePct, 'fixture: the copy covers A').toBeGreaterThan(99);
    const coverage = `${synteny.totalAlignedBp.toLocaleString()} bp (${synteny.genomeACoveragePct}%)`;

    const html = await studio(gappedA, [gappedA, partner], 'genome-variants');
    const regions = warningRegions(html).filter((r) => r.label === 'Synteny warnings');
    expect(regions).toHaveLength(1);
    expect(regions[0].sentences).toEqual(synteny.warnings);
    // beside the coverage: after the Aligned Bases & Coverage KPI, before the Synteny Blocks table
    const kpi = html.indexOf('Aligned Bases &amp; Coverage');
    const caption = html.indexOf('Synteny Blocks (');
    expect(kpi).toBeGreaterThan(-1);
    expect(regions[0].at).toBeGreaterThan(kpi);
    expect(regions[0].at).toBeLessThan(caption);
    expect(regions[0].at).toBeLessThan(html.indexOf('<table', caption));
    // an exact coverage reads as the percentage alone
    expect(wordsOf(html)).toContain(`Aligned Bases & Coverage ${coverage} Inversions Detected`);

    // the N-free pair of the first check shows no synteny warnings
    const plainA = doc('a', 'Genome A', strRichGenome());
    const plainB = doc('b', 'Genome B', withInsertions(plainA.sequence));
    expect(runWholeGenomeSynteny(plainA.sequence, plainB.sequence, 'Mauve').warnings).toEqual([]);
    expect(warningRegions(await studio(plainA, [plainA, plainB], 'genome-variants')).filter((r) => r.label === 'Synteny warnings')).toEqual([]);

    // the engine's report for the N pair with its coverage marked as a lower bound reads "at
    // least" that much of genome A, by name, and keeps its warnings beside it
    const sync = vi.mocked(runWholeGenomeSynteny);
    sync.mockClear();
    sync.mockReturnValueOnce({ ...synteny, genomeACoverageIsLowerBound: true });
    const bounded = await studio(gappedA, [gappedA, partner], 'genome-variants');
    expect(sync.mock.calls).toEqual([[gappedA.sequence, partner.sequence, 'Mauve']]);
    expect(wordsOf(bounded)).toContain(
      `Aligned Bases & Coverage ${synteny.totalAlignedBp.toLocaleString()} bp (at least ${synteny.genomeACoveragePct}% of Gapped Genome) Inversions Detected`
    );
    expect(warningRegions(bounded).filter((r) => r.label === 'Synteny warnings').map((r) => r.sentences)).toEqual([synteny.warnings]);
  }, 60_000);

  it('shows every synteny warning sentence beside the coverage', async () => {
    // BG-01M6TAB2: a report holding two sentences, one per genome. Genome A is 60 kb of random
    // bases with bases 30,001-30,100 an N run, genome B the same bases with 45,001-45,050 an N run.
    // A studio showing only the first sentence, only the last, or the two run into one note fails.
    const bases = randomBases(60_000, 0x5eed_0009);
    const gappedA = doc('na', 'Gapped Genome A', `${bases.slice(0, 30_000)}${'N'.repeat(100)}${bases.slice(30_100)}`);
    const gappedB = doc('nb', 'Gapped Genome B', `${bases.slice(0, 45_000)}${'N'.repeat(50)}${bases.slice(45_050)}`);
    const synteny = runWholeGenomeSynteny(gappedA.sequence, gappedB.sequence, 'Mauve');
    expect(synteny.warnings).toEqual([
      'Genome A holds 100 N or other ambiguity bases; no block crosses them, and coverage is of its 59,900 A/C/G/T bases.',
      'Genome B holds 50 N or other ambiguity bases; no block crosses them, and coverage is of its 59,950 A/C/G/T bases.',
    ]);
    expect(synteny.genomeACoveragePct, 'fixture: the copy covers A').toBeGreaterThan(99);

    const html = await studio(gappedA, [gappedA, gappedB], 'genome-variants');
    const regions = warningRegions(html).filter((r) => r.label === 'Synteny warnings');
    expect(regions).toHaveLength(1);
    // sentence for sentence, in the engine's order, each its own note
    expect(regions[0].sentences).toEqual(synteny.warnings);
    // beside the coverage: after the Aligned Bases & Coverage KPI, before the Synteny Blocks table
    const kpi = html.indexOf('Aligned Bases &amp; Coverage');
    const caption = html.indexOf('Synteny Blocks (');
    expect(kpi).toBeGreaterThan(-1);
    expect(regions[0].at).toBeGreaterThan(kpi);
    expect(regions[0].at).toBeLessThan(caption);
    expect(regions[0].at).toBeLessThan(html.indexOf('<table', caption));
    expect(wordsOf(html)).toContain(
      `Aligned Bases & Coverage ${synteny.totalAlignedBp.toLocaleString()} bp (${synteny.genomeACoveragePct}%) Inversions Detected`
    );
    // and each sentence once, in that region only
    for (const sentence of synteny.warnings) expect(wordsOf(html).split(sentence)).toHaveLength(2);
  }, 60_000);
});
