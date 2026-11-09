// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1Q9, the surfaces a researcher reads: Annotate from Documents left out every reference
 * feature over 5,000 bp and every match that ran across the target's origin, the silent-mutation
 * list offered its own 24 rows as the whole answer, and the Extract Annotations banner called 12
 * feature documents the extraction of a 50-feature record. Once those features are transferred, a
 * joined one must still go across as its exons, in the target's coordinates, and a hit across the
 * origin must still reach a document that holds features of its own.
 *
 * The totals here are counted in this file - its own standard genetic code, its own window
 * arithmetic, and the enzyme catalog as data - never read from the constant the UI prints, so a
 * list that printed its own length as the total fails. The reference records are GenBank text
 * parsed through the shipped parseGenBank, so the features have the shape the importer writes
 * (joined parts in `segments`, start <= end), not a shape hand-built here. Sequences are generated
 * from fixed seeds.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── App probes (installed before the App module is loaded) ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
const probe = vi.hoisted(() => ({
  dispatcher: null as null | { current: AppDispatcher },
  onMenus: null as null | ((menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void),
  /**
   * Options an operation dialog's first render starts from, as the user would leave them after
   * ticking its checkboxes: merged into the option values the dialog's own state starts from (the
   * one state object holding a `references` key). The repo carries no DOM library, so a static
   * render cannot click; everything from these values to the markup is the dialog's own code.
   */
  dialogOptions: null as null | Record<string, string | number | boolean>,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useRef = ((initial: unknown) => {
    const ref = actual.useRef(initial);
    if (initial && typeof initial === 'object' && 'onMenuAction' in initial && 'onNativeFileOpen' in initial) {
      probe.dispatcher = ref as unknown as { current: AppDispatcher };
    }
    return ref;
  }) as typeof actual.useRef;
  const useState = ((initial: unknown) => {
    if (!probe.dialogOptions) return actual.useState(initial);
    const options = probe.dialogOptions;
    return actual.useState(() => {
      const v = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return v && typeof v === 'object' && 'references' in v ? { ...v, ...options } : v;
    });
  }) as typeof actual.useState;
  return { ...actual, default: { ...actual, useRef, useState }, useRef, useState };
});

vi.mock('../core/menuShortcuts', async () => {
  const actual = await vi.importActual<typeof import('../core/menuShortcuts')>('../core/menuShortcuts');
  return {
    ...actual,
    collectMenuShortcutBindings: (trees: Parameters<typeof actual.collectMenuShortcutBindings>[0]) => {
      probe.onMenus?.(trees, (id) => {
        if (!probe.dispatcher) throw new Error('the App rendered no native-menu dispatcher');
        probe.dispatcher.current.onMenuAction(id);
      });
      return actual.collectMenuShortcutBindings(trees);
    },
  };
});

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const { App } = await import('../App');
const { CloningAndGelStudio, SILENT_MUTATION_LIST_LIMIT } = await import('../components/CloningAndGelStudio');
const { AnnotateFromDocumentsDialog } = await import('../components/SequenceAnalysisToolDialogs');
const { annotateFromDocuments, MAX_TRANSFERRED_FEATURE_BP } = await import('../core/annotateFromDocuments');
const { runAnnotateFromDocuments } = await import('../core/operationRunners');
const { parseGenBank } = await import('../core/fileParsers');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');
type SequenceDocument = import('../types/bio').SequenceDocument;
type SequenceFeature = import('../types/bio').SequenceFeature;

afterEach(() => {
  probe.onMenus = null;
  probe.dialogOptions = null;
  storage.clear();
});

// ─── Markup, read as a tree ───

interface El { tag: string; attrs: Record<string, string>; classes: Set<string>; parent: El | null; children: (El | string)[] }
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});

/** Parses React's static markup (well formed, quoted attributes). */
function parse(html: string): El {
  const root: El = { tag: '#root', attrs: {}, classes: new Set(), parent: null, children: [] };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) { cur.children.push(decode(m[5])); continue; }
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      if (cur.tag !== tag.toLowerCase()) throw new Error(`markup closes <${tag}> inside <${cur.tag}>`);
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const node: El = { tag: tag.toLowerCase(), attrs, classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)), parent: cur, children: [] };
    cur.children.push(node);
    if (node.tag === 'style' || node.tag === 'script') {
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      node.children.push(html.slice(re.lastIndex, end));
      re.lastIndex = end + tag.length + 3;
      continue;
    }
    if (!selfClosing && !VOID.has(node.tag)) cur = node;
  }
  if (cur !== root) throw new Error(`markup leaves <${cur.tag}> open`);
  return root;
}
function* walk(e: El): Generator<El> {
  yield e;
  for (const c of e.children) if (typeof c !== 'string') yield* walk(c);
}
const textOf = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const findAll = (root: El, pred: (e: El) => boolean) => [...walk(root)].filter(pred);
const childrenOf = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');
/** The one element `pred` accepts. */
function one(root: El, pred: (e: El) => boolean, what: string): El {
  const found = findAll(root, pred);
  expect(found.length, `exactly one ${what}`).toBe(1);
  return found[0];
}
/** The sentences of the result warnings labelled `label` (ResultWarnings), inside `root`. */
const warningsIn = (root: El, label: string) =>
  findAll(root, (e) => 'data-mbc-result-warnings' in e.attrs && e.attrs['aria-label'] === label)
    .map((w) => findAll(w, (p) => p.tag === 'p').map((p) => textOf(p).trim()));

// ─── Sequences, the genetic code, and the direct silent-mutation count ───

/** Seeded random DNA of `length` bases (the same bases on every run). */
const randomDna = (length: number, seed: number) => {
  let x = seed >>> 0;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) out[i] = 'ACGT'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 30];
  return out.join('');
};

/** NCBI translation table 1, amino acids in TCAG x TCAG x TCAG codon order. */
const TABLE_1 = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const aminoAcid = (codon: string): string => {
  const i = [...codon.toUpperCase()].map((b) => 'TCAG'.indexOf(b === 'U' ? 'T' : b));
  if (codon.length !== 3 || i.some((x) => x < 0)) return 'X';
  return TABLE_1[16 * i[0] + 4 * i[1] + i[2]];
};

/** A coding sequence of `codons` codons: ATG, random sense codons, then TAA. */
const randomCds = (codons: number, seed: number) => {
  let x = seed >>> 0;
  const base = () => 'ACGT'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 30];
  let out = 'ATG';
  while (out.length < (codons - 1) * 3) {
    const c = base() + base() + base();
    if (aminoAcid(c) !== '*') out += c;
  }
  return `${out}TAA`;
};

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' };
const reverseComplementDna = (s: string) => [...s].reverse().map((b) => COMPLEMENT[b] ?? b).join('');

/**
 * Every silent-mutation candidate of `cds`, read in frame from its first base, counted here: for
 * each codon from the second to the third from last, each single-base change at the third or the
 * first base of the codon that leaves the amino acid unchanged, and each enzyme whose
 * exactly-spelled recognition site of 6 bp or more appears in the mutated window
 * [codon start - 8, codon start + 11) while the wild-type window holds none of it.
 */
function directSilentCandidates(cds: string): { codon: number; enzyme: string }[] {
  const sites = REBASE_ENZYMES
    .filter((e) => e.recognitionSeq.length >= 6 && /^[ACGT]+$/.test(e.recognitionSeq))
    .map((e) => [e.name, e.recognitionSeq] as const);
  const out: { codon: number; enzyme: string }[] = [];
  const codons = Math.floor(cds.length / 3);
  for (let codonIdx = 1; codonIdx < Math.max(0, codons - 2); codonIdx++) {
    const pos0 = codonIdx * 3;
    const wtCodon = cds.slice(pos0, pos0 + 3);
    const wtAa = aminoAcid(wtCodon);
    if (wtAa === '*' || wtAa === 'X') continue;
    const winStart = Math.max(0, pos0 - 8);
    const wtWindow = cds.slice(winStart, Math.min(pos0 + 11, cds.length));
    for (const offset of [2, 0]) {
      for (const alt of 'ACGT') {
        if (alt === wtCodon[offset]) continue;
        const mutCodon = wtCodon.slice(0, offset) + alt + wtCodon.slice(offset + 1);
        if (aminoAcid(mutCodon) !== wtAa) continue;
        const at = pos0 + offset - winStart;
        const mutWindow = wtWindow.slice(0, at) + alt + wtWindow.slice(at + 1);
        for (const [name, site] of sites) {
          if (wtWindow.includes(site)) continue;
          if (mutWindow.includes(site)) out.push({ codon: codonIdx + 1, enzyme: name });
        }
      }
    }
  }
  return out;
}

// ─── Documents ───

const template = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.topology === 'circular')!;
const dnaDoc = (id: string, sequence: string, topology: 'circular' | 'linear', features: SequenceFeature[] = []): SequenceDocument => ({
  ...template, id, name: id, accession: '', description: '', sequence, topology, features, primers: [], history: [],
  docMetadata: {},
});

/** A GenBank flatfile for `sequence` with one line per feature, as `key  location  /label=name`. */
function genbankText(name: string, sequence: string, topology: 'circular' | 'linear', features: readonly { key: string; location: string; label: string }[]): string {
  const lines = [
    `LOCUS       ${name.padEnd(16)}${sequence.length} bp    DNA     ${topology}  SYN 07-NOV-2026`,
    `DEFINITION  ${name} test record.`,
    'FEATURES             Location/Qualifiers',
  ];
  for (const f of features) {
    lines.push(`     ${f.key.padEnd(16)}${f.location}`);
    lines.push(`                     /label="${f.label}"`);
  }
  lines.push('ORIGIN');
  for (let i = 0; i < sequence.length; i += 60) {
    const row = sequence.slice(i, i + 60).match(/.{1,10}/g)!.join(' ');
    lines.push(`${String(i + 1).padStart(9)} ${row}`);
  }
  lines.push('//');
  return lines.join('\n');
}

// ─── AC4: Annotate from Documents transfers long and origin-spanning features ───

describe('Annotate from Documents (BG-01M6S1Q9)', () => {
  it('transfers long and origin-spanning features', () => {
    // An 8 kb circular reference, imported from GenBank text: a 6,000 bp operon (over the 5,000 bp
    // the transfer used to stop at), a 400 bp element written across the reference's own origin as
    // a join (the importer keeps its parts in `segments`), and a 400 bp tag that will land across
    // the target's origin once the molecule is rotated. None overlaps another by 90%, so the
    // one-annotation-per-site rule keeps them all.
    const refSeq = randomDna(8_000, 0x8_0004);
    const reference = parseGenBank(genbankText('REF8KB', refSeq, 'circular', [
      { key: 'misc_feature', location: '2001..8000', label: 'big_operon' },
      { key: 'CDS', location: 'join(7951..8000,1..350)', label: 'origin_element' },
      { key: 'promoter', location: '1001..1400', label: 'rotated_tag' },
    ]), 'REF8KB.gb');
    expect(reference.sequence).toBe(refSeq);
    expect(reference.topology).toBe('circular');
    const refFeature = (label: string) => reference.features.find((f) => f.name === label)!;
    expect(refFeature('big_operon').end - refFeature('big_operon').start + 1).toBe(6_000);
    // The importer's shape for the origin-spanning element: the two parts, each start <= end.
    expect(refFeature('origin_element').segments?.map((s) => [s.start, s.end])).toEqual([[7_951, 8_000], [1, 350]]);
    expect(refFeature('origin_element').start).toBeLessThan(refFeature('origin_element').end);

    // The target: the same molecule with its origin moved 1,200 bases on, unannotated.
    const rot = 1_200;
    const targetSeq = refSeq.slice(rot) + refSeq.slice(0, rot);
    const target = dnaDoc('rotated_target', targetSeq, 'circular');
    const at = (p: number) => ((p - 1 - rot + 8_000) % 8_000) + 1;

    const hits = annotateFromDocuments(target, [reference], 95);
    const hit = (label: string) => {
      const h = hits.find((x) => x.feature.name === label);
      expect(h, `${label} is transferred (got ${hits.map((x) => x.feature.name).join(', ')})`).toBeTruthy();
      return h!;
    };

    // The 6,000 bp operon, placed whole.
    const operon = hit('big_operon');
    expect([operon.start, operon.end]).toEqual([at(2_001), at(8_000)]);
    expect(operon.end - operon.start + 1).toBe(6_000);
    expect(operon.identityPct).toBeCloseTo(100, 6);
    expect(operon.feature.segments, 'a contiguous match carries no segments').toBeUndefined();
    expect(targetSeq.slice(operon.start - 1, operon.end)).toBe(refSeq.slice(2_000, 8_000));

    // The element written across the reference's origin: its spliced bases are searched for, and
    // they lie in one block on this target.
    const element = hit('origin_element');
    const elementBases = refSeq.slice(7_950, 8_000) + refSeq.slice(0, 350);
    expect(element.end - element.start + 1).toBe(400);
    expect(targetSeq.slice(element.start - 1, element.end)).toBe(elementBases);
    expect(element.feature.segments).toBeUndefined();

    // The tag that lands across the target's origin: kept as the two parts it covers, with the
    // molecule as its span, and those parts hold exactly the reference feature's bases.
    const tag = hit('rotated_tag');
    expect(tag.feature.segments?.map((s) => [s.start, s.end])).toEqual([[7_801, 8_000], [1, 200]]);
    expect([tag.start, tag.end], 'the span of a feature across the origin').toEqual([1, 8_000]);
    const tagBases = tag.feature.segments!.map((s) => targetSeq.slice(s.start - 1, s.end)).join('');
    expect(tagBases).toBe(refSeq.slice(1_000, 1_400));
    expect(tag.identityPct).toBeCloseTo(100, 6);

    // The operation the dialog runs writes all three onto the document, the origin-spanning one
    // with its parts.
    const run = runAnnotateFromDocuments([target], [reference], { minIdentity: 90, minLength: 15 });
    const written = run.updated[0].features;
    for (const label of ['big_operon', 'origin_element', 'rotated_tag']) {
      expect(written.map((f) => f.name), `${label} reaches the document`).toContain(label);
    }
    const writtenTag = written.find((f) => f.name === 'rotated_tag')!;
    expect(writtenTag.segments?.map((s) => [s.start, s.end])).toEqual([[7_801, 8_000], [1, 200]]);
    expect(written.find((f) => f.name === 'big_operon')!.segments).toBeUndefined();

    // A feature longer than the transfer reads is left out, and the dialog says so rather than
    // dropping it in silence: the rule, and how many features of the chosen references it hits.
    const longSeq = randomDna(MAX_TRANSFERRED_FEATURE_BP + 4_000, 0x2_0006);
    const tooLongRef = parseGenBank(genbankText('REFLONG', longSeq, 'linear', [
      { key: 'misc_feature', location: `1..${MAX_TRANSFERRED_FEATURE_BP + 1}`, label: 'too_long' },
      { key: 'misc_feature', location: '1..400', label: 'short_enough' },
    ]), 'REFLONG.gb');
    const longHits = annotateFromDocuments(dnaDoc('long_target', longSeq, 'linear'), [tooLongRef], 95);
    expect(longHits.map((h) => h.feature.name), 'the over-long feature is not transferred').toEqual(['short_enough']);

    const dialog = parse(renderToStaticMarkup(
      <AnnotateFromDocumentsDialog targets={[target]} candidates={[reference, tooLongRef]} onApply={() => undefined} onClose={() => undefined} />
    ));
    const words = findAll(dialog, (e) => e.tag === 'span' || e.tag === 'div').map((e) => textOf(e)).join(' | ');
    expect(words).toContain(`Features longer than ${MAX_TRANSFERRED_FEATURE_BP.toLocaleString()} bp are not transferred.`);
    // With both references ticked (the dialog's own run would), the count of features left out.
    const hint = findAll(dialog, (e) => textOf(e).includes('annotated nucleotide documents in the project')).map((e) => textOf(e));
    expect(hint.length, 'the reference-list hint').toBeGreaterThan(0);
  }, 180_000);

  it('transfers long and origin-spanning features: a joined feature as its exons, in the target\'s coordinates', () => {
    // A 16 kb circular reference, imported from GenBank text, with four joined features: a
    // minus-strand CDS and an mRNA whose introns (400 and 1,000 bp) are longer than a fifth of
    // their exons, a feature with a 100 bp intron, and a gene whose 8,200 bp intron is longer than
    // the 7,200 bases the other way round the origin (written in ascending order, so it does not
    // cross the origin); and one more mRNA, of one range, nested in the long-intron mRNA's intron.
    // Every exon is 300 bp.
    const n = 16_000;
    const refSeq = randomDna(n, 0x1_6001);
    const reference = parseGenBank(genbankText('REF16KB', refSeq, 'circular', [
      { key: 'CDS', location: 'complement(join(10001..10300,10701..11000))', label: 'cds_long_intron' },
      { key: 'misc_feature', location: 'join(12001..12300,12401..12700)', label: 'short_intron' },
      { key: 'mRNA', location: 'join(13001..13300,14301..14600)', label: 'mrna_long_intron' },
      { key: 'mRNA', location: '13501..14100', label: 'nested_gene' },
      { key: 'gene', location: 'join(501..800,9001..9300)', label: 'far_exons' },
    ]), 'REF16KB.gb');
    expect(reference.sequence).toBe(refSeq);
    const refParts = (label: string) => reference.features.find((f) => f.name === label)!.segments!.map((s) => [s.start, s.end]);
    // the importer's shape: the parts, in the order written, on the feature's strand
    expect(refParts('cds_long_intron')).toEqual([[10_001, 10_300], [10_701, 11_000]]);
    expect(reference.features.find((f) => f.name === 'cds_long_intron')!.strand).toBe(-1);
    expect(refParts('mrna_long_intron')).toEqual([[13_001, 13_300], [14_301, 14_600]]);

    const rotated = (by: number) => refSeq.slice(by) + refSeq.slice(0, by);
    // The bases each exon holds, in the record's order, read from the reference.
    const exonBases = (label: string) => refParts(label).map(([a, b]) => refSeq.slice(a - 1, b)).join('');
    type Placed = { span: [number, number]; strand: 1 | -1; parts: number[][] };
    /**
     * Each target, read from GenBank text, with where each joined feature must land on it: its span
     * (start..end, `1..n` across the origin), strand and parts. Every span of the CDS, the
     * short-intron feature and the mRNA below that does not run across the origin is the span the
     * base ref (before BG-01M6S1Q9) gives on the same target, which kept the reference's own parts;
     * the parts here are the target's. The base ref never transferred the 8,800 bp gene.
     */
    const cases: { name: string; sequence: string; topology: 'circular' | 'linear'; reversed?: boolean; want: Record<string, Placed | undefined> }[] = [
      {
        name: 'an identical copy', sequence: refSeq, topology: 'circular', want: {
          cds_long_intron: { span: [10_001, 11_000], strand: -1, parts: [[10_001, 10_300], [10_701, 11_000]] },
          short_intron: { span: [12_001, 12_700], strand: 1, parts: [[12_001, 12_300], [12_401, 12_700]] },
          mrna_long_intron: { span: [13_001, 14_600], strand: 1, parts: [[13_001, 13_300], [14_301, 14_600]] },
          far_exons: { span: [501, 9_300], strand: 1, parts: [[501, 800], [9_001, 9_300]] },
        },
      },
      {
        name: 'a copy rotated 5 kb', sequence: rotated(5_000), topology: 'circular', want: {
          cds_long_intron: { span: [5_001, 6_000], strand: -1, parts: [[5_001, 5_300], [5_701, 6_000]] },
          short_intron: { span: [7_001, 7_700], strand: 1, parts: [[7_001, 7_300], [7_401, 7_700]] },
          mrna_long_intron: { span: [8_001, 9_600], strand: 1, parts: [[8_001, 8_300], [9_301, 9_600]] },
          // the gene's intron now holds the target's origin
          far_exons: { span: [1, n], strand: 1, parts: [[11_501, 11_800], [4_001, 4_300]] },
        },
      },
      {
        name: 'a linear copy', sequence: refSeq, topology: 'linear', want: {
          cds_long_intron: { span: [10_001, 11_000], strand: -1, parts: [[10_001, 10_300], [10_701, 11_000]] },
          short_intron: { span: [12_001, 12_700], strand: 1, parts: [[12_001, 12_300], [12_401, 12_700]] },
          mrna_long_intron: { span: [13_001, 14_600], strand: 1, parts: [[13_001, 13_300], [14_301, 14_600]] },
        },
      },
      {
        // The base ref transfers no mRNA here or in the next case: it skipped every match across
        // the target's origin.
        name: 'a copy whose origin falls in the mRNA intron', sequence: rotated(13_999), topology: 'circular', want: {
          cds_long_intron: { span: [12_002, 13_001], strand: -1, parts: [[12_002, 12_301], [12_702, 13_001]] },
          short_intron: { span: [14_002, 14_701], strand: 1, parts: [[14_002, 14_301], [14_402, 14_701]] },
          mrna_long_intron: { span: [1, n], strand: 1, parts: [[15_002, 15_301], [302, 601]] },
        },
      },
      {
        name: 'a copy whose origin falls in the first mRNA exon', sequence: rotated(13_149), topology: 'circular', want: {
          mrna_long_intron: { span: [1, n], strand: 1, parts: [[15_852, n], [1, 151], [1_152, 1_451]] },
        },
      },
      {
        name: 'the reverse complement', sequence: reverseComplementDna(refSeq), topology: 'circular', reversed: true, want: {
          far_exons: { span: [6_701, 15_500], strand: -1, parts: [[6_701, 7_000], [15_201, 15_500]] },
          cds_long_intron: { span: [5_001, 6_000], strand: 1, parts: [[5_001, 5_300], [5_701, 6_000]] },
          short_intron: { span: [3_301, 4_000], strand: -1, parts: [[3_301, 3_600], [3_701, 4_000]] },
          mrna_long_intron: { span: [1_401, 3_000], strand: -1, parts: [[1_401, 1_700], [2_701, 3_000]] },
        },
      },
    ];
    for (const c of cases) {
      const target = parseGenBank(genbankText('TARGET', c.sequence, c.topology, []), 'TARGET.gb');
      expect(target.sequence).toBe(c.sequence);
      const hits = annotateFromDocuments(target, [reference], 95);
      for (const [label, want] of Object.entries(c.want)) {
        const h = hits.find((x) => x.feature.name === label);
        expect(h, `${c.name}: ${label} is transferred (got ${hits.map((x) => x.feature.name).join(', ')})`).toBeTruthy();
        expect([h!.start, h!.end], `${c.name}: ${label}'s span`).toEqual(want!.span);
        expect(h!.strand, `${c.name}: ${label}'s strand`).toBe(want!.strand);
        expect(h!.feature.segments?.map((s) => [s.start, s.end]), `${c.name}: ${label} as its parts, never one range over an intron`).toEqual(want!.parts);
        expect(h!.identityPct, `${c.name}: ${label}'s identity`).toBeCloseTo(100, 6);
        // and the parts hold the exons' bases, read on the feature's strand of the target
        const read = want!.parts.map(([a, b]) => c.sequence.slice(a - 1, b)).join('');
        expect(c.reversed ? reverseComplementDna(read) : read, `${c.name}: ${label}'s parts hold its exons`).toBe(exonBases(label));
      }
      // the gene in the mRNA's intron is a site of its own, not a copy of the mRNA
      if (c.want.mrna_long_intron && c.want.mrna_long_intron.span[0] > 1) {
        expect(hits.map((x) => x.feature.name), `${c.name}: the nested gene`).toContain('nested_gene');
      }
    }

    // An intron that has diverged (random bases in place of the mRNA's 1,000 bp intron): the
    // identity is read over the exons, which are unchanged, so the mRNA is still transferred (the
    // base ref read it over the introns too, and transferred no mRNA here or in the next case).
    const diverged = refSeq.slice(0, 13_300) + randomDna(1_000, 0xd_1000) + refSeq.slice(14_300);
    const divergedHits = annotateFromDocuments(parseGenBank(genbankText('DIVERGED', diverged, 'linear', []), 'DIVERGED.gb'), [reference], 95);
    const divergedMrna = divergedHits.find((x) => x.feature.name === 'mrna_long_intron');
    expect(divergedMrna?.feature.segments?.map((s) => [s.start, s.end]), 'the mRNA over a diverged intron').toEqual([[13_001, 13_300], [14_301, 14_600]]);
    expect(divergedMrna!.identityPct).toBeCloseTo(100, 6);
    // An intron 150 bp shorter on the target (bases 13801..13950 deleted): the second exon lies
    // 150 bases nearer the first than on the reference, and is placed where it lies.
    const shorter = refSeq.slice(0, 13_800) + refSeq.slice(13_950);
    const shorterHits = annotateFromDocuments(parseGenBank(genbankText('SHORTER', shorter, 'linear', []), 'SHORTER.gb'), [reference], 95);
    const shorterMrna = shorterHits.find((x) => x.feature.name === 'mrna_long_intron');
    expect(shorterMrna?.feature.segments?.map((s) => [s.start, s.end]), 'the mRNA over a shorter intron').toEqual([[13_001, 13_300], [14_151, 14_450]]);
    expect([shorterMrna!.start, shorterMrna!.end]).toEqual([13_001, 14_450]);
    expect(shorterMrna!.identityPct).toBeCloseTo(100, 6);

    // The operation writes the parts onto a document that already holds a user's gene in the
    // mRNA's intron, which is not the mRNA's site.
    const annotated = parseGenBank(genbankText('ANNOTATED', refSeq, 'circular', [
      { key: 'mRNA', location: '13501..14100', label: 'users_nested_gene' },
    ]), 'ANNOTATED.gb');
    const written = runAnnotateFromDocuments([annotated], [reference], { minIdentity: 90, minLength: 15 }).updated[0].features;
    const writtenMrna = written.filter((f) => f.name === 'mrna_long_intron');
    expect(writtenMrna.length, 'the mRNA is written once').toBe(1);
    expect(writtenMrna[0].segments?.map((s) => [s.start, s.end])).toEqual([[13_001, 13_300], [14_301, 14_600]]);
    expect([writtenMrna[0].start, writtenMrna[0].end]).toEqual([13_001, 14_600]);
    const writtenCds = written.find((f) => f.name === 'cds_long_intron')!;
    expect(writtenCds.strand).toBe(-1);
    expect(writtenCds.segments?.map((s) => [s.start, s.end])).toEqual([[10_001, 10_300], [10_701, 11_000]]);
    // the reference's nested gene is the user's own gene, so it is not written a second time
    expect(written.map((f) => f.name)).not.toContain('nested_gene');
  }, 120_000);

  it('transfers long and origin-spanning features: a hit is written unless a feature already covers its parts', () => {
    // An 8 kb circular reference with a misc_feature that lands across the target's origin once
    // the molecule is rotated 1,200 bases, and a CDS that does not.
    const n = 8_000;
    const refSeq = randomDna(n, 0x8_0008);
    const reference = parseGenBank(genbankText('REF8KB', refSeq, 'circular', [
      { key: 'misc_feature', location: '1001..1400', label: 'tag' },
      { key: 'CDS', location: '3001..3600', label: 'cds2' },
    ]), 'REF8KB.gb');
    const rot = 1_200;
    const rotatedSeq = refSeq.slice(rot) + refSeq.slice(0, rot);
    const run = (target: SequenceDocument) => runAnnotateFromDocuments([target], [reference], { minIdentity: 90, minLength: 15 });

    // The target already holds one unrelated misc_feature: the tag, whose span is the whole
    // molecule, is written with its two parts all the same.
    const withMisc = parseGenBank(genbankText('ROTATED', rotatedSeq, 'circular', [
      { key: 'misc_feature', location: '5000..5100', label: 'users_misc' },
    ]), 'ROTATED.gb');
    expect(withMisc.features.map((f) => [f.name, f.start, f.end])).toEqual([['users_misc', 5_000, 5_100]]);
    const one = run(withMisc);
    expect(one.updated.length).toBe(1);
    const tag = one.updated[0].features.filter((f) => f.name === 'tag');
    expect(tag.length, 'the tag across the origin is written').toBe(1);
    expect([tag[0].start, tag[0].end]).toEqual([1, n]);
    expect(tag[0].segments?.map((s) => [s.start, s.end])).toEqual([[7_801, n], [1, 200]]);
    expect(one.updated[0].features.find((f) => f.name === 'cds2')).toMatchObject({ start: 1_801, end: 2_400 });
    expect(one.updated[0].features.find((f) => f.name === 'users_misc')).toMatchObject({ start: 5_000, end: 5_100 });
    expect(one.summary).toBe('2 annotations added to 1 of 1 sequence from 1 reference');

    // The target's only feature is a CDS written across its origin (the importer gives it the
    // span 1..n): a CDS elsewhere is not at its site, and is written.
    const withWrappedCds = parseGenBank(genbankText('WRAPPED', refSeq, 'circular', [
      { key: 'CDS', location: 'join(7951..8000,1..50)', label: 'users_wrapped_cds' },
    ]), 'WRAPPED.gb');
    expect(withWrappedCds.features.map((f) => [f.start, f.end])).toEqual([[1, n]]);
    const two = run(withWrappedCds);
    expect(two.updated[0].features.find((f) => f.name === 'cds2'), 'the CDS beside a CDS across the origin').toMatchObject({ start: 3_001, end: 3_600 });

    // A feature that does cover a hit's parts still stands for it: nothing is written twice.
    const alreadyThere = parseGenBank(genbankText('ALREADY', rotatedSeq, 'circular', [
      { key: 'misc_feature', location: 'join(7801..8000,1..200)', label: 'users_tag' },
      { key: 'CDS', location: '1801..2400', label: 'users_cds' },
    ]), 'ALREADY.gb');
    const three = run(alreadyThere);
    expect(three.updated, 'no feature is added').toEqual([]);
    expect(three.summary).toBe('0 annotations added to 0 of 1 sequence from 1 reference');
  }, 120_000);

  it('transfers long and origin-spanning features: the dialog counts the features too long to transfer', () => {
    // Features over the limit, counted here from the locations written below (first base to last,
    // introns included, read across a circular reference's origin):
    //   linear 24 kb reference:    1..20001 (20,001 bp)            over
    //                              join(1..300,20201..20500)        over (20,500 bp, 600 of exons)
    //                              2001..22000 (20,000 bp)          not over: the limit itself
    //                              1..400                           not over
    //   circular 24 kb reference:  join(23901..24000,1..300)        not over (400 bp; the importer spans it 1..24000)
    //                              1001..22000 (21,000 bp)          over
    //                              join(1..300,23001..23300)        over (23,300 bp written in ascending order,
    //                                                               though the other way round the origin is 1,300)
    const limit = MAX_TRANSFERRED_FEATURE_BP;
    expect(limit).toBe(20_000);
    const linearSeq = randomDna(24_000, 0x2_4001);
    const circularSeq = randomDna(24_000, 0x2_4002);
    const linearRef = parseGenBank(genbankText('LONGLINEAR', linearSeq, 'linear', [
      { key: 'misc_feature', location: '1..20001', label: 'over_a' },
      { key: 'mRNA', location: 'join(1..300,20201..20500)', label: 'over_joined' },
      { key: 'misc_feature', location: '2001..22000', label: 'at_limit' },
      { key: 'misc_feature', location: '1..400', label: 'short' },
    ]), 'LONGLINEAR.gb');
    const circularRef = parseGenBank(genbankText('LONGCIRC', circularSeq, 'circular', [
      { key: 'misc_feature', location: 'join(23901..24000,1..300)', label: 'across_origin' },
      { key: 'misc_feature', location: '1001..22000', label: 'over_b' },
      { key: 'misc_feature', location: 'join(1..300,23001..23300)', label: 'over_the_long_way' },
    ]), 'LONGCIRC.gb');
    expect(circularRef.features.find((f) => f.name === 'across_origin')).toMatchObject({ start: 1, end: 24_000 });
    const over = ['over_a', 'over_joined', 'over_b', 'over_the_long_way'];

    // What the transfer does with them on identical copies: the counted ones are left out, every
    // other one is transferred.
    const transferred = [
      ...annotateFromDocuments(dnaDoc('linear_copy', linearSeq, 'linear'), [linearRef], 95),
      ...annotateFromDocuments(dnaDoc('circular_copy', circularSeq, 'circular'), [circularRef], 95),
    ].map((h) => h.feature.name).sort();
    expect(transferred).toEqual(['across_origin', 'at_limit', 'short']);

    // The dialog, with both references ticked, states that count.
    const target = dnaDoc('dialog_target', randomDna(2_000, 0x2_4003), 'circular');
    const candidates = [target, linearRef, circularRef];
    probe.dialogOptions = { references: JSON.stringify([linearRef.id, circularRef.id]) };
    const dialog = parse(renderToStaticMarkup(
      <AnnotateFromDocumentsDialog targets={[target]} candidates={candidates} onApply={() => undefined} onClose={() => undefined} />
    ));
    probe.dialogOptions = null;
    const hint = one(dialog, (e) => e.classes.has('mbc-opdlg-hint') && textOf(e).includes('annotated nucleotide documents'), 'reference-list hint');
    expect(textOf(hint)).toBe(
      `2 annotated nucleotide documents in the project; 2 chosen. ${over.length} of their features are longer than ${limit.toLocaleString()} bp and will not be transferred.`
    );
    // Only the ticked references are counted.
    probe.dialogOptions = { references: JSON.stringify([circularRef.id]) };
    const circularOnly = parse(renderToStaticMarkup(
      <AnnotateFromDocumentsDialog targets={[target]} candidates={candidates} onApply={() => undefined} onClose={() => undefined} />
    ));
    probe.dialogOptions = null;
    expect(textOf(one(circularOnly, (e) => e.classes.has('mbc-opdlg-hint') && textOf(e).includes('annotated nucleotide documents'), 'hint'))).toBe(
      `2 annotated nucleotide documents in the project; 1 chosen. 2 of their features are longer than ${limit.toLocaleString()} bp and will not be transferred.`
    );
  }, 120_000);
});

// ─── BG-01M6SMBS AC5: Annotate from Documents reads the stored order of a per-part complement join ───

describe('Annotate from Documents and a per-part complement join (BG-01M6SMBS)', () => {
  it('transfers a per-part complement join as its complement join form', () => {
    // The layout reads a circular reference's stretch from its first stored part
    // (annotateFromDocuments.ts, featureLayout), so the stored order decides what is searched for.
    // Each pair of references is the same 600 bp circular record (randomDna(600, 41), the
    // sequenceSearchStats.test.tsx SEQ_600) holding one CDS, the same label, written two ways that
    // Biopython 1.88 reads as one location. Wrong imports this reaches: the base (+ strand, parts
    // as listed: perPartMinus then spans the origin the long way, perPartAscending sits on the
    // wrong strand), parts reversed but still numbered as listed (the layout sorts by index, so
    // that is the base's order), and parts sorted ascending (perPartAscending stays as listed).
    const n = 600;
    const refSeq = randomDna(n, 41);
    const reference = (location: string) => parseGenBank(genbankText('REF600', refSeq, 'circular', [
      { key: 'CDS', location, label: 'spliced_cds' },
    ]), 'REF600.gb');
    const rot = 300;
    const targets = [
      { name: 'an identical copy', sequence: refSeq, at: (p: number) => p },
      { name: `a copy rotated ${rot} bases`, sequence: refSeq.slice(rot) + refSeq.slice(0, rot), at: (p: number) => ((p - 1 - rot + n) % n) + 1 },
    ];
    type Written = { type: string; name: string; strand: number; start: number; end: number; segments?: [number, string, number, number][] };
    const written = (ref: SequenceDocument, sequence: string): Written | undefined => {
      const target = parseGenBank(genbankText('TARGET', sequence, 'circular', []), 'TARGET.gb');
      expect(target.sequence).toBe(sequence);
      const run = runAnnotateFromDocuments([target], [ref], { minIdentity: 90, minLength: 15 });
      const hits = (run.updated[0]?.features ?? []).filter((f) => f.name === 'spliced_cds');
      expect(hits.length, 'the CDS is written once').toBeLessThanOrEqual(1);
      const f = hits[0];
      return f && {
        type: f.type, name: f.name, strand: f.strand, start: f.start, end: f.end,
        segments: f.segments?.map((s) => [s.index, s.name, s.start, s.end] as [number, string, number, number]),
      };
    };
    const cases = [
      {
        perPart: 'join(complement(101..160),complement(11..40))',
        joined: 'complement(join(11..40,101..160))',
        // where it lands on each target: the reference's 11..40 and 101..160, on the - strand
        want: (at: (p: number) => number): Written => ({
          type: 'CDS', name: 'spliced_cds', strand: -1, start: at(11), end: at(160),
          segments: [[1, 'spliced_cds part 1', at(11), at(40)], [2, 'spliced_cds part 2', at(101), at(160)]],
        }),
      },
      {
        // 101..160 is its first part, so its stretch runs from 101 around the origin to 40, on
        // either target across the target's origin too: the molecule is its span.
        perPart: 'join(complement(11..40),complement(101..160))',
        joined: 'complement(join(101..160,11..40))',
        want: (at: (p: number) => number): Written => ({
          type: 'CDS', name: 'spliced_cds', strand: -1, start: 1, end: n,
          segments: [[1, 'spliced_cds part 1', at(101), at(160)], [2, 'spliced_cds part 2', at(11), at(40)]],
        }),
      },
    ];
    for (const c of cases) {
      const joinedRef = reference(c.joined);
      const perPartRef = reference(c.perPart);
      for (const t of targets) {
        const fromJoined = written(joinedRef, t.sequence);
        expect(fromJoined, `${t.name}: ${c.joined} is transferred where it lies`).toEqual(c.want(t.at));
        expect(written(perPartRef, t.sequence), `${t.name}: ${c.perPart} is transferred as ${c.joined}`).toEqual(fromJoined);
      }
    }

    // The fixture tells the stored shapes apart: each wrong import's shape, where it differs from
    // the right one, is another transfer on the identical copy, and each wrong import differs on
    // some case. Parts reversed but numbered as listed read, after the layout's sort by index, as
    // the parts as listed on the - strand.
    const asStored = (ref: SequenceDocument, strand: 1 | -1, parts: readonly (readonly [number, number])[]): SequenceDocument => ({
      ...ref,
      features: ref.features.map((f) => (f.type !== 'CDS' ? f : {
        ...f, strand, segments: parts.map(([a, b], i) => ({ index: i + 1, name: `${f.name} part ${i + 1}`, start: a, end: b, color: f.color })),
      })),
    });
    const shapes = [
      { right: [[11, 40], [101, 160]], listed: [[101, 160], [11, 40]] },
      { right: [[101, 160], [11, 40]], listed: [[11, 40], [101, 160]] },
    ] as const;
    const wrongImports: Record<string, (s: (typeof shapes)[number]) => [1 | -1, readonly (readonly [number, number])[]]> = {
      'the base: + strand, parts as listed': (s) => [1, s.listed],
      'parts as listed, or reversed but numbered as listed, on the - strand': (s) => [-1, s.listed],
      'parts sorted ascending on the - strand': (s) => [-1, [...s.listed].sort((x, y) => x[0] - y[0])],
    };
    const told = new Set<string>();
    shapes.forEach((s, i) => {
      const ref = reference(cases[i].joined);
      expect(ref.features.find((f) => f.type === 'CDS')!.segments!.map((g) => [g.start, g.end]), `${cases[i].joined}: its stored parts`).toEqual(s.right);
      const right = written(ref, refSeq);
      for (const [how, shape] of Object.entries(wrongImports)) {
        const [strand, parts] = shape(s);
        if (strand === -1 && JSON.stringify(parts) === JSON.stringify(s.right)) continue; // the right shape
        expect(written(asStored(ref, strand, parts), refSeq), `${cases[i].perPart}: ${how} is another transfer`).not.toEqual(right);
        told.add(how);
      }
    });
    expect([...told].sort(), 'each wrong import differs on some case').toEqual(Object.keys(wrongImports).sort());
  }, 120_000);
});

// ─── AC5: the silent-mutation list says which of how many it shows ───

describe('the silent-mutation list (BG-01M6S1Q9)', () => {
  it('labels the silent-mutation list with its total', () => {
    // A 4,800 bp gene - longer than the 3,600 bases the scan used to read - inside a 6 kb
    // construct, so a total read from a shorter scan is a different number.
    const gene = randomCds(1_600, 0x5_1600);
    expect(gene.length).toBe(4_800);
    const flank = randomDna(600, 0x6_0001);
    const sequence = `${flank}${gene}${randomDna(600, 0x6_0002)}`;
    const cds: SequenceFeature = {
      id: 'f-gene', name: 'long_gene', type: 'CDS', start: flank.length + 1, end: flank.length + gene.length,
      strand: 1, color: '#16a34a',
    };
    const doc = dnaDoc('Silent_6kb', sequence, 'circular', [cds]);

    // The total, counted here over the whole gene.
    const direct = directSilentCandidates(gene);
    const total = direct.length;
    const inFirst3600 = direct.filter((c) => (c.codon - 1) * 3 + 1 <= 3_600).length;
    expect(total, 'the fixture holds far more candidates than the list shows').toBeGreaterThan(SILENT_MUTATION_LIST_LIMIT * 4);
    expect(inFirst3600, 'and more than a scan of its first 3,600 bases would find').toBeLessThan(total);

    const studio = parse(renderToStaticMarkup(
      <CloningAndGelStudio documents={[doc]} activeDoc={doc} onAddConstruct={() => undefined} initialSubTool="silent-mutations" />
    ));

    // The caption over the list: which of how many, with the total counted here.
    const caption = one(studio, (e) => 'data-mbc-silent-mutation-caption' in e.attrs, 'silent-mutation caption');
    expect(textOf(caption)).toBe(
      `Showing the first ${SILENT_MUTATION_LIST_LIMIT.toLocaleString()} of ${total.toLocaleString()} candidates, in codon order, first CDS first.`
    );
    // The tab counts every candidate, not the rows below it.
    const tabs = findAll(studio, (e) => e.tag === 'span').map((e) => textOf(e)).filter((t) => /^Silent Mutations \(/.test(t));
    expect(tabs).toEqual([`Silent Mutations (${total.toLocaleString()})`]);
    // The list itself holds the first candidates, one row each.
    const region = one(studio, (e) => e.attrs.role === 'region' && e.attrs['aria-label'] === 'Synonymous Silent Mutation Restriction Sites', 'silent-mutation table');
    const rows = findAll(region, (e) => e.tag === 'tr' && e.parent?.tag === 'tbody');
    expect(rows.length).toBe(SILENT_MUTATION_LIST_LIMIT);
    const firstRow = childrenOf(rows[0]).filter((c) => c.tag === 'td');
    expect(textOf(firstRow[0]).trim()).toBe(direct[0].enzyme);
    expect(textOf(firstRow[3])).toContain(`Codon #${direct[0].codon}`);
    // And the engine's own sentence beside the result.
    expect(warningsIn(studio, 'Silent mutation warnings')).toEqual([[
      `Silent-mutation list capped: it shows the first ${SILENT_MUTATION_LIST_LIMIT.toLocaleString()} of the ${total.toLocaleString()} candidates found over the whole length of 1 annotated CDS.`,
    ]]);

    // A short gene with fewer candidates than the list holds: every one is shown, and nothing
    // claims a cap.
    const shortGene = randomCds(30, 0x5_0030);
    const shortDoc = dnaDoc('Silent_short', shortGene, 'linear', [
      { id: 'f-s', name: 'short_gene', type: 'CDS', start: 1, end: shortGene.length, strand: 1, color: '#16a34a' },
    ]);
    const shortTotal = directSilentCandidates(shortGene).length;
    expect(shortTotal, 'the short fixture fits in the list').toBeLessThan(SILENT_MUTATION_LIST_LIMIT);
    const shortStudio = parse(renderToStaticMarkup(
      <CloningAndGelStudio documents={[shortDoc]} activeDoc={shortDoc} onAddConstruct={() => undefined} initialSubTool="silent-mutations" />
    ));
    expect(textOf(one(shortStudio, (e) => 'data-mbc-silent-mutation-caption' in e.attrs, 'caption'))).toBe(
      `Showing all ${shortTotal.toLocaleString()} candidate${shortTotal === 1 ? '' : 's'}, in codon order, first CDS first.`
    );
    expect(warningsIn(shortStudio, 'Silent mutation warnings')).toEqual([]);
  }, 180_000);
});

// ─── AC6: the Extract Annotations banner states what it left out ───

/** The App restored on `doc`, running one menu action per render, and the status banner it shows. */
function bannerAfter(doc: SequenceDocument, steps: readonly string[]): string[] {
  expect(saveWorkbenchToLocalAutosave({
    sessionName: 'Extract_Caps_Session',
    documents: [doc],
    workspace: {
      activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
      viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
      darkMode: false, sidebarOpen: true, docTableCollapsed: true, selectedRange: null,
      displaySettings: {
        showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: false, showTranslation: false,
        showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
      },
    },
  }), 'the autosave is written').toBe(true);
  let ran = 0;
  let passes = 0;
  probe.onMenus = (_menus, dispatch) => {
    if (++passes > 30) throw new Error('the App kept re-rendering');
    if (ran < steps.length) dispatch(steps[ran++]);
  };
  const root = parse(renderToStaticMarkup(<App />));
  expect(ran, 'every step ran').toBe(steps.length);
  return findAll(root, (e) => e.classes.has('statusbar-toast-text')).map((e) => textOf(e).trim());
}

describe('the Extract Annotations banner (BG-01M6S1Q9)', () => {
  it('states how many features extraction left out', () => {
    // A record annotated with more features than one run extracts documents for. The cap is read
    // from the run itself (how many documents arrived), never named here.
    const seq = randomDna(60_000, 0x6_0006);
    const many = (count: number, id: string) => dnaDoc(id, seq, 'linear', Array.from({ length: count }, (_, i) => ({
      id: `g${i}`, name: `gene_${String(i).padStart(5, '0')}`, type: 'CDS' as const,
      start: 1 + i * 25, end: 1 + i * 25 + 59, strand: 1 as const, color: '#16a34a',
    })));

    // 50 features: every one is extracted, and the banner claims no more than it did.
    const fifty = bannerAfter(many(50, 'Fifty_Features'), ['file:restore-autosave', 'tools:extract-annotations']);
    expect(fifty).toEqual(['Extracted 50 annotated feature sequences from "Fifty_Features"']);

    // Past the cap: the banner names how many of the record's features were left out, and the
    // numbers add up to the record's own feature count.
    const huge = bannerAfter(many(2_400, 'Huge_Features'), ['file:restore-autosave', 'tools:extract-annotations']);
    expect(huge.length, 'one banner').toBe(1);
    const m = /^Extracted ([\d,]+) annotated feature sequences from "Huge_Features" — ([\d,]+) of its ([\d,]+) features were left out \(one run extracts at most ([\d,]+)\)$/.exec(huge[0]);
    expect(m, `the banner states what was left out: ${huge[0]}`).toBeTruthy();
    const [extracted, leftOut, held, cap] = m!.slice(1).map((n) => Number(n.replace(/,/g, '')));
    expect(held, "the record's own feature count").toBe(2_400);
    expect(extracted + leftOut, 'every feature is either extracted or counted as left out').toBe(2_400);
    expect(cap).toBe(extracted);
    expect(leftOut).toBeGreaterThan(0);
  }, 300_000);
});
