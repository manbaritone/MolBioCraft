// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S17C: the Sequence View's motif search says how many hits the sequence holds and that the
 * list is cut, and Translation Statistics names the range it translated, reads a minus-strand CDS
 * from its reverse complement, and shows all 64 codons in its 64-Codon Table.
 *
 * The real components render with the real engine (the WASM the frontend embeds). The search box
 * is typed into from inside the view's own render, by calling the onChange its render hands to its
 * input, so the view re-renders with that query as it does when a researcher types. Every hit,
 * count and residue expected is a hand scan or a hand count of a fixture generated here from a
 * fixed seed, or what Biopython 1.88 gives for the same bases (Bio.Seq.Seq(...).reverse_complement()
 * .translate(), Bio.Data.CodonTable.unambiguous_dna_by_id[1] for the Standard code, and
 * Bio.SeqUtils.ProtParam.ProteinAnalysis(...).molecular_weight() for the masses). A joined CDS is
 * written here as a GenBank record, read through the shipped parseGenBank, and checked against
 * Biopython's SeqIO.read of the same text and that CDS's feature.extract(record).seq.translate().
 *
 * BG-01M6SMBS: a join of complemented parts, join(complement(101..160),complement(11..40)), is read
 * as Biopython reads it, as the CDS complement(join(11..40,101..160)) is; a join that mixes strands
 * is imported with a warning in the document's Notes; and the export writes the per-part form as
 * the complement(join(...)) location Biopython extracts as the same protein.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SequenceDocument, SequenceFeature } from '../types/bio';

// ─── Probe, installed before the modules under test load ───

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({ onElement: null as null | ElementProbe }));
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

const { LinearSequenceView, GenomeInspectorExtras } = await import('../components/LinearSequenceView');
const { DocumentInfoPanel } = await import('../components/DocumentInfoPanel');
const { exportToGenBank, parseGenBank } = await import('../core/fileParsers');
const { withWarningNotes } = await import('../core/operationRunners');

afterEach(() => {
  probe.onElement = null;
});

// ─── Rendered markup as a tree of plain objects ───

interface El { tag: string; attrs: Record<string, string>; classes: Set<string>; parent: El | null; children: (El | string)[] }
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});
function parseMarkup(html: string): El {
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
    if (!selfClosing && !VOID.has(node.tag)) cur = node;
  }
  if (cur !== root) throw new Error(`markup leaves <${cur.tag}> open`);
  return root;
}
const kids = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');
function* walk(e: El): Generator<El> { yield e; for (const c of kids(e)) yield* walk(c); }
const textOf = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const findAll = (root: El, pred: (e: El) => boolean) => [...walk(root)].filter(pred);

// ─── Fixtures and hand oracles ───

/** Seeded ACGT (an LCG's top two bits), the generator crates/molbiocraft-wasm/tests/motif_search_cap.rs uses. */
function seededDna(length: number, seed: number): string {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out += 'ACGT'[x >>> 30];
  }
  return out;
}

const PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
/** Watson-Crick reverse complement by a hand table; fixtures are plain ACGT. */
function handRevcomp(s: string): string {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) {
    const c = PAIR[s[i]];
    if (!c) throw new Error(`fixture holds a non-ACGT base ${s[i]}`);
    out += c;
  }
  return out;
}

/** A count with a comma every three digits, written out by hand. */
function withCommas(n: number): string {
  const d = String(n);
  let out = '';
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out += ',';
    out += d[i];
  }
  return out;
}

interface Hit { start: number; end: number; strand: 1 | -1 }
/**
 * Every hit, overlapping ones included, by a base-by-base scan, 1-based, in position order. A
 * palindrome (its reverse complement is itself) is one hit per site, on the + strand.
 */
function handHits(seq: string, pat: string): Hit[] {
  const rc = handRevcomp(pat);
  const out: Hit[] = [];
  for (let i = 0; i + pat.length <= seq.length; i++) {
    const w = seq.slice(i, i + pat.length);
    if (w === pat) out.push({ start: i + 1, end: i + pat.length, strand: 1 });
    if (rc !== pat && w === rc) out.push({ start: i + 1, end: i + pat.length, strand: -1 });
  }
  return out;
}

/** The Standard code (NCBI table 1) in TCAG order, as Biopython 1.88 gives it. */
const TABLE1_TCAG = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const ALL_64 = [...'TCAG'].flatMap((a) => [...'TCAG'].flatMap((b) => [...'TCAG'].map((c) => a + b + c)));
const aaOf = (codon: string) => TABLE1_TCAG[ALL_64.indexOf(codon)];
const codonsOf = (dna: string) => Array.from({ length: Math.floor(dna.length / 3) }, (_, i) => dna.slice(3 * i, 3 * i + 3));
const tally = (items: readonly string[]) => {
  const m: Record<string, number> = {};
  for (const x of items) m[x] = (m[x] ?? 0) + 1;
  return m;
};

const STAMP = '2026-11-07T00:00:00Z';
const dnaDoc = (id: string, sequence: string, features: SequenceFeature[], topology: 'linear' | 'circular' = 'linear'): SequenceDocument => ({
  id, name: id, accession: '', description: '', moleculeType: 'DNA', topology, sequence, features,
  primers: [], history: [], createdAt: STAMP, updatedAt: STAMP, folder: 'Plasmids & Vectors',
});
const feature = (id: string, name: string, type: SequenceFeature['type'], start: number, end: number, strand: 1 | -1): SequenceFeature =>
  ({ id, name, type, start, end, strand, color: '#10b981' });

// ─── The search panel, typed into from inside the view's render ───

function searchPanel(doc: SequenceDocument, query: string) {
  let typed = false;
  probe.onElement = (type, p) => {
    if (type !== 'input' || p.id !== 'mbc-seq-search-input' || typed) return;
    typed = true;
    (p.onChange as (e: { target: { value: string } }) => void)({ target: { value: query } });
  };
  let html: string;
  try {
    html = renderToStaticMarkup(
      <LinearSequenceView doc={doc} cutSites={[]} selectedRange={null} onSelectRange={() => {}} onUpdateDocument={() => {}} />,
    );
  } finally {
    probe.onElement = null;
  }
  const root = parseMarkup(html);
  const groups = findAll(root, (e) => e.classes.has('search-box-group'));
  expect(groups, 'the view draws one search box').toHaveLength(1);
  const group = groups[0];
  const input = findAll(group, (e) => e.tag === 'input' && e.attrs.id === 'mbc-seq-search-input')[0];
  expect(input?.attrs.value, 'the search box holds the query typed').toBe(query);
  const row = kids(group);
  const pillsAt = row.findIndex((e) => e.classes.has('search-hit-pills'));
  const warnAt = row.findIndex((e) => 'data-mbc-result-warnings' in e.attrs);
  return {
    badge: pillsAt < 0 ? null : textOf(findAll(row[pillsAt], (e) => e.classes.has('hit-count-badge'))[0]).trim(),
    pills: pillsAt < 0 ? [] : findAll(row[pillsAt], (e) => e.tag === 'button' && e.classes.has('hit-jump-btn')).map((b) => textOf(b).trim()),
    warnings: warnAt < 0 ? [] : findAll(row[warnAt], (e) => e.tag === 'p').map((p) => textOf(p).trim()),
    warningsLabel: warnAt < 0 ? null : row[warnAt].attrs['aria-label'],
    /** Where the warnings sit: -1 none, else their place after the hit list (1 is right after it). */
    warningsAfterPills: warnAt < 0 ? -1 : warnAt - pillsAt,
    regions: findAll(root, (e) => 'data-mbc-result-warnings' in e.attrs).length,
  };
}
const pillOf = (h: Hit) => `${withCommas(h.start)}..${withCommas(h.end)} (${h.strand === 1 ? '+' : '-'})`;

// ─── Translation Statistics, as the panel reads ───

function translationPanel(doc: SequenceDocument, selectedRange: { start: number; end: number } | null) {
  const root = parseMarkup(renderToStaticMarkup(
    <GenomeInspectorExtras doc={doc} selectedRange={selectedRange} onSelectRange={() => {}} />,
  ));
  const panels = findAll(root, (e) => e.tag === 'details'
    && findAll(e, (s) => s.tag === 'summary').some((s) => textOf(s).trim().startsWith('Translation Statistics')));
  expect(panels, 'one Translation Statistics panel').toHaveLength(1);
  const panel = panels[0];
  const kv: Record<string, string> = {};
  for (const row of findAll(panel, (e) => e.classes.has('stat-kv'))) {
    const [k, v] = kids(row);
    kv[textOf(k).trim()] = textOf(v).trim();
  }
  /** The text that follows a bold label, in the block that the label opens. */
  const after = (label: string) => {
    const block = findAll(panel, (e) => e.tag === 'div' && kids(e)[0]?.tag === 'strong' && textOf(kids(e)[0]).trim() === label)[0];
    return block === undefined ? null : textOf(block).slice(label.length).trim();
  };
  const freqText = after('20 Amino Acid Frequencies:');
  const codonText = after('64-Codon Table:');
  return {
    summary: textOf(findAll(panel, (e) => e.tag === 'summary')[0]).trim(),
    kv,
    text: textOf(panel),
    notes: findAll(panel, (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')).map((p) => textOf(p).trim()),
    aa: freqText === null ? null : Object.fromEntries(freqText.split(' · ').map((x) => {
      const [k, v] = x.split(':');
      return [k, Number(v)];
    })),
    codons: codonText === null ? null : [...codonText.matchAll(/([ACGT]{3})\(([A-Z*])\):(\d+)/g)].map((m) => ({ codon: m[1], aa: m[2], count: Number(m[3]) })),
  };
}
/** The amino-acid line's counts for `protein`: each of its 21 symbols, absent ones as 0. */
const AA_SYMBOLS = [...'ACDEFGHIKLMNPQRSTVWY*'];
const aaLine = (protein: string) => Object.fromEntries(AA_SYMBOLS.map((a) => [a, [...protein].filter((c) => c === a).length]));

// The fixture for Translation Statistics: 600 bp whose first feature is a promoter, whose first CDS
// is on the - strand (91..390, 100 codons) and whose second is on the + strand.
const SEQ_600 = seededDna(600, 41);
const CDS_MINUS = feature('cds-rev', 'revGene', 'CDS', 91, 390, -1);
const STRANDED = dnaDoc('bg-s17c-stats', SEQ_600, [
  feature('prom', 'Pfix', 'promoter', 1, 60, 1),
  CDS_MINUS,
  feature('cds-fwd', 'fwdGene', 'CDS', 421, 540, 1),
]);
// Biopython 1.88: Seq(SEQ_600[90:390]).reverse_complement().translate()
const BIOPY_CDS_MINUS = 'LSERIKR*VALVGMPISGLTASHQRSTTSDLRRC*YTVGPRNTEIWRIGDGTGSSQRGLFTADDL**RRSIAGA*WRL*VLTLLYPRC*AYNGFFAKVTA';
// Biopython 1.88: Seq(SEQ_600[10:40]).translate()
const BIOPY_SELECTION_11_40 = 'LSLMYRALPL';
// Biopython 1.88: Seq(SEQ_600[570:] + SEQ_600[:30]).translate()
const BIOPY_WRAP_571_30 = '*GTVYILMSPLSNSVVDVSS';
/**
 * A GenBank flat file of `seq` holding a source and one CDS at `location`, named by its /gene, laid
 * out as INSDC writes it (Biopython 1.88 reads it with no warning).
 */
function genbankRecord(gene: string, seq: string, topology: 'linear' | 'circular', location: string): string {
  const origin: string[] = [];
  for (let i = 0; i < seq.length; i += 60) {
    origin.push(`${String(i + 1).padStart(9)} ${seq.slice(i, i + 60).toLowerCase().match(/.{1,10}/g)!.join(' ')}`);
  }
  return [
    `LOCUS       ${gene.padEnd(16)} ${String(seq.length).padStart(11)} bp    DNA     ${topology.padEnd(8)} SYN 07-NOV-2026`,
    `DEFINITION  Synthetic ${topology} record holding the CDS ${gene}.`,
    `ACCESSION   ${gene}`,
    `VERSION     ${gene}`,
    'KEYWORDS    .',
    'SOURCE      synthetic DNA construct',
    '  ORGANISM  synthetic DNA construct',
    '            other sequences; artificial sequences.',
    'FEATURES             Location/Qualifiers',
    `     source          1..${seq.length}`,
    '                     /mol_type="other DNA"',
    `     CDS             ${location}`,
    `                     /gene="${gene}"`,
    'ORIGIN',
    ...origin,
    '//',
    '',
  ].join('\n');
}
// Biopython 1.88, for each record genbankRecord(gene, seq, topology, location) writes (seq is
// SEQ_600 unless named): SeqIO.read(..., 'genbank'), then the CDS's
// feature.extract(record).seq.translate(), and ProteinAnalysis(that protein without its stops)
// .molecular_weight().
const BIOPY_JOINED_CDS = {
  // join(941..1000,1..30) on a circular record of SEQ_1000: 3,387.71 Da
  wrapKb: { protein: 'LPYRTRSTTLHSSFNGEKAIHHYTVAIDTA', mass: '3.39 kDa' },
  // join(571..600,1..30) on a circular record: 1,968.23 Da
  wrapPlus: { protein: '*GTVYILMSPLSNSVVDVSS', mass: '1.97 kDa' },
  // complement(join(571..600,1..30)) on a circular record: 2,520.91 Da
  wrapMinus: { protein: 'ARYINDRVAKWRHKYINCTL', mass: '2.52 kDa' },
  // complement(join(11..40,101..160)) on a linear record: 3,327.84 Da
  splicedMinus: { protein: 'IIGTNAIVPPLLSVQRLFREQR*GSIHQRQ', mass: '3.33 kDa' },
  // join(570..600,1..29) on a circular record, its join inside a codon: 2,195.56 Da
  wrapPhasePlus: { protein: 'LRYSLYTYVAT*QLCR*CIE', mass: '2.20 kDa' },
  // complement(join(570..600,1..29)) on a circular record, its join inside a codon: 1,862.04 Da
  wrapPhaseMinus: { protein: 'LDTSTTELLSGDISI*TVP*', mass: '1.86 kDa' },
} as const;
const SEQ_1000 = seededDna(1_000, 43);
// Biopython 1.88: Seq(SEQ_1000[:900]).translate()
const BIOPY_FIRST_900 =
  'HHYTVAIDTAGHRCGNSKT*LTGLLLRFYPLCTRQLVTAGQ*C*L*CFYLLPVL*SDGRDPHYLDNVTLIHLLVNY*VRDRAIPSLAMRRRD*VASTPGSLKITRFYVQGWKATDLVSRPPACAF*SRGGNYTPDG*PDRSIN*IKLFPVTFTAFFPTCRRYQPTAVYPWVNVAPRSITCDGYASISQIVTYHLERDICSCNLLK*GLR*VTTRTLHEAFAGHNESTCVWPVTATLRIF*PAMHVIPECKEGITRRCLCPRKEPWKHRKL*PDFEPRGHKYSTDQIFKQGQSCPPLPRSV';

describe('BG-01M6S17C: the Sequence View search panel and Translation Statistics', () => {
  it('shows first 100 of N when motif hits are capped', () => {
    // 300,000 bp: past the 262,144 bp FM index, so the engine scans. CACA is not a palindrome (its
    // reverse complement is TGTG). Wrong implementations this fixture reaches: the base, whose
    // forward strand filled the 100 before the reverse strand was read and whose badge counted the
    // list ("100 FM-Index hits"); a badge that counts the list; a warning written in the view's own
    // markup, or none; and a hit row that offers a jump to only the first 6 of the 100 hits listed.
    const seq = seededDna(300_000, 17);
    const doc = dnaDoc('bg-s17c-view-long', seq, []);
    const expected = handHits(seq, 'CACA');
    expect(expected.length, 'the total needs a comma').toBeGreaterThan(1_000);
    expect(expected.slice(0, 100).some((h) => h.strand === -1), 'the first 100 hold - strand hits').toBe(true);

    const capped = searchPanel(doc, 'CACA');
    expect(capped.badge, 'the badge counts every hit in the sequence').toBe(`${withCommas(expected.length)} FM-Index hits:`);
    expect(capped.pills, 'a jump to each of the first 100 hits by position, both strands').toEqual(expected.slice(0, 100).map(pillOf));
    expect(capped.warnings, 'the cut list says so').toEqual([`Showing the first 100 of ${withCommas(expected.length)} hits.`]);
    expect(capped.warningsLabel).toBe('Search warnings');
    expect(capped.warningsAfterPills, 'the warning sits right after the hit list').toBe(1);
    expect(capped.regions, 'one warnings region in the view').toBe(1);

    // A list that holds every hit says nothing: GAATTC, a palindrome, is each site once.
    const sites = handHits(seq, 'GAATTC');
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThan(100);
    const whole = searchPanel(doc, 'GAATTC');
    expect(whole.badge).toBe(`${withCommas(sites.length)} FM-Index hits:`);
    expect(whole.pills).toEqual(sites.map(pillOf));
    expect(whole.warnings).toEqual([]);
    expect(whole.regions).toBe(0);
  });

  it('translates a minus-strand CDS and names the range', () => {
    // The oracles agree: the hand reverse complement, read through the Standard code, is Biopython's
    // protein, and the reads the wrong implementations make give other proteins.
    const minusDna = handRevcomp(SEQ_600.slice(90, 390));
    const translate = (dna: string) => codonsOf(dna).map(aaOf).join('');
    expect(translate(minusDna)).toBe(BIOPY_CDS_MINUS);
    expect(translate(SEQ_600.slice(10, 40))).toBe(BIOPY_SELECTION_11_40);
    const wrong = {
      'read forwards (the base)': SEQ_600.slice(90, 390),
      'reversed, not complemented': [...SEQ_600.slice(90, 390)].reverse().join(''),
      'complemented, not reversed': [...SEQ_600.slice(90, 390)].map((c) => PAIR[c]).join(''),
      'the first feature (the promoter)': SEQ_600.slice(0, 60),
      'the + strand CDS': SEQ_600.slice(420, 540),
    };
    for (const [how, dna] of Object.entries(wrong)) {
      expect(aaLine(translate(dna)), how).not.toEqual(aaLine(BIOPY_CDS_MINUS));
    }

    // No selection: the first CDS, from its reverse complement, named.
    const cds = translationPanel(STRANDED, null);
    expect(cds.kv['Translated range:']).toBe('CDS revGene, 91..390, - strand, read from its reverse complement');
    expect(cds.summary).toBe('Translation Statistics (100 aa / codons)');
    expect(cds.kv['Length (mean):']).toBe('100 aa (codons)');
    expect(cds.aa, 'Biopython\'s protein, residue for residue counted').toEqual(aaLine(BIOPY_CDS_MINUS));
    // Biopython 1.88: ProteinAnalysis(BIOPY_CDS_MINUS without its stops).molecular_weight() = 10,302.7 Da
    expect(cds.kv['Molecular weight (mean):'], 'the mass of that protein').toBe('10.30 kDa');
    expect(Object.fromEntries((cds.codons ?? []).filter((c) => c.count > 0).map((c) => [c.codon, c.count])))
      .toEqual(tally(codonsOf(minusDna)));

    // A selection that is exactly that CDS is read as the CDS.
    const picked = translationPanel(STRANDED, { start: 91, end: 390 });
    expect(picked.kv['Translated range:']).toBe('CDS revGene, 91..390, - strand, read from its reverse complement');
    expect(picked.aa).toEqual(aaLine(BIOPY_CDS_MINUS));

    // Any other selection is read on its + strand, and named as a selection.
    const sel = translationPanel(STRANDED, { start: 11, end: 40 });
    expect(sel.kv['Translated range:']).toBe('Selection 11..40, + strand');
    expect(sel.summary).toBe('Translation Statistics (10 aa / codons)');
    expect(sel.aa).toEqual(aaLine(BIOPY_SELECTION_11_40));

    // A range with no complete codon says so, and measures no protein ("1 aa" of M before).
    const empty = translationPanel(STRANDED, { start: 5, end: 6 });
    expect(empty.kv['Translated range:']).toBe('Selection 5..6, + strand');
    expect(empty.summary).toBe('Translation Statistics (0 aa / codons)');
    expect(empty.notes).toEqual(['This range holds no complete codon to translate.']);
    expect(empty.text).not.toMatch(/\b1 aa\b/);
    expect(empty.kv['Molecular weight (mean):'], 'no protein is measured').toBeUndefined();
    expect(empty.codons, 'no codon table for no codons').toBeNull();
    // One stop codon is a codon with no residue: it is counted, and no protein is weighed (the base
    // weighed an M in its place).
    const stopAt = SEQ_600.search(/TAA|TAG|TGA/);
    expect(stopAt, 'the fixture holds a stop codon').toBeGreaterThanOrEqual(0);
    const stop = translationPanel(STRANDED, { start: stopAt + 1, end: stopAt + 3 });
    expect(stop.summary).toBe('Translation Statistics (1 aa / codons)');
    expect(stop.aa).toEqual(aaLine('*'));
    expect(stop.kv['Molecular weight (mean):'], 'no residue, no mass').toBeUndefined();

    // A CDS across the origin of a circular molecule reads its two pieces in order.
    const wrapDoc = dnaDoc('bg-s17c-wrap', SEQ_600, [feature('cds-wrap', 'wrapGene', 'CDS', 571, 30, 1)], 'circular');
    expect(translate(SEQ_600.slice(570) + SEQ_600.slice(0, 30))).toBe(BIOPY_WRAP_571_30);
    const wrap = translationPanel(wrapDoc, null);
    expect(wrap.kv['Translated range:']).toBe('CDS wrapGene, 571..30, + strand');
    expect(wrap.summary).toBe('Translation Statistics (20 aa / codons)');
    expect(wrap.aa).toEqual(aaLine(BIOPY_WRAP_571_30));

    // No selection and no CDS: the first 900 bp, named; a shorter molecule is read whole.
    const plain = translationPanel(dnaDoc('bg-s17c-plain', SEQ_1000, [feature('p', 'P1', 'promoter', 101, 160, -1)]), null);
    expect(plain.kv['Translated range:']).toBe('First 900 bp, 1..900, + strand');
    expect(plain.summary).toBe('Translation Statistics (300 aa / codons)');
    expect(plain.aa).toEqual(aaLine(BIOPY_FIRST_900));
    const short = translationPanel(dnaDoc('bg-s17c-short', SEQ_600, []), null);
    expect(short.kv['Translated range:']).toBe('Whole sequence, 1..600, + strand');
    expect(short.summary).toBe('Translation Statistics (200 aa / codons)');
  });

  it('translates a minus-strand CDS and names the range: a joined CDS parsed from GenBank reads its exons alone', () => {
    // The GenBank importer keeps a joined CDS as its bounding span (start the lowest base, end the
    // highest) and its parts, in the order the record lists them, as segments (a join of
    // complemented parts in the reverse of that order: see the BG-01M6SMBS tests below); it never
    // writes a start past an end. Each record here is read through the shipped parseGenBank, so the panel
    // sees the shape a researcher's file gives it. The expected protein and mass are Biopython's.
    type Part = [number, number];
    interface Case {
      gene: keyof typeof BIOPY_JOINED_CDS;
      seq: string;
      topology: 'linear' | 'circular';
      location: string;
      strand: 1 | -1;
      parts: Part[];
      label: string;
    }
    const cases: Case[] = [
      { gene: 'wrapPlus', seq: SEQ_600, topology: 'circular', location: 'join(571..600,1..30)', strand: 1, parts: [[571, 600], [1, 30]],
        label: 'CDS wrapPlus, join(571..600,1..30), + strand' },
      { gene: 'wrapMinus', seq: SEQ_600, topology: 'circular', location: 'complement(join(571..600,1..30))', strand: -1, parts: [[571, 600], [1, 30]],
        label: 'CDS wrapMinus, join(571..600,1..30), - strand, read from its reverse complement' },
      { gene: 'splicedMinus', seq: SEQ_600, topology: 'linear', location: 'complement(join(11..40,101..160))', strand: -1, parts: [[11, 40], [101, 160]],
        label: 'CDS splicedMinus, join(11..40,101..160), - strand, read from its reverse complement' },
      { gene: 'wrapPhasePlus', seq: SEQ_600, topology: 'circular', location: 'join(570..600,1..29)', strand: 1, parts: [[570, 600], [1, 29]],
        label: 'CDS wrapPhasePlus, join(570..600,1..29), + strand' },
      { gene: 'wrapPhaseMinus', seq: SEQ_600, topology: 'circular', location: 'complement(join(570..600,1..29))', strand: -1, parts: [[570, 600], [1, 29]],
        label: 'CDS wrapPhaseMinus, join(570..600,1..29), - strand, read from its reverse complement' },
      // Inside join() a position is written as INSDC writes it, with no thousands separator, since
      // "join(941..1,000,1..30)" cannot be read back.
      { gene: 'wrapKb', seq: SEQ_1000, topology: 'circular', location: 'join(941..1000,1..30)', strand: 1, parts: [[941, 1000], [1, 30]],
        label: 'CDS wrapKb, join(941..1000,1..30), + strand' },
    ];
    const translate = (dna: string) => codonsOf(dna).map(aaOf).join('');
    const piece = (c: Case, [a, b]: Part) => c.seq.slice(a - 1, b);
    const onStrand = (c: Case, dna: string) => (c.strand === -1 ? handRevcomp(dna) : dna);
    // Plausible wrong reads of a joined CDS. The panel reports composition and mass, which do not
    // change when whole codons trade places, so the two records whose join falls inside a codon are
    // what separates the position-order and per-exon reads from the right one.
    const wrongReads: Record<string, (c: Case) => string> = {
      'the bounding span (round 1)': (c) => onStrand(c, c.seq.slice(Math.min(...c.parts.flat()) - 1, Math.max(...c.parts.flat()))),
      'the exons in position order': (c) => onStrand(c, [...c.parts].sort((x, y) => x[0] - y[0]).map((p) => piece(c, p)).join('')),
      'each exon reverse-complemented, in the order listed': (c) =>
        c.parts.map((p) => onStrand(c, piece(c, p))).join(''),
      'the exons read forwards whatever the strand': (c) => c.parts.map((p) => piece(c, p)).join(''),
    };
    const reached = new Set<string>();

    for (const c of cases) {
      const want = BIOPY_JOINED_CDS[c.gene];
      const read = onStrand(c, c.parts.map((p) => piece(c, p)).join(''));
      expect(translate(read), `${c.gene}: the hand read is Biopython's protein`).toBe(want.protein);
      for (const [how, wrong] of Object.entries(wrongReads)) {
        if (JSON.stringify(aaLine(translate(wrong(c)))) !== JSON.stringify(aaLine(want.protein))) reached.add(how);
      }

      const doc = parseGenBank(genbankRecord(c.gene, c.seq, c.topology, c.location), c.gene);
      const cdsFeatures = doc.features.filter((f) => f.type === 'CDS');
      expect(cdsFeatures, `${c.gene}: one CDS`).toHaveLength(1);
      const [f] = cdsFeatures;
      expect(
        { topology: doc.topology, start: f.start, end: f.end, strand: f.strand, parts: f.segments?.map((s) => [s.start, s.end]) },
        `${c.gene}: the importer's shape`,
      ).toEqual({ topology: c.topology, start: Math.min(...c.parts.flat()), end: Math.max(...c.parts.flat()), strand: c.strand, parts: c.parts });

      // With no selection the first CDS is read; the annotation cursor selects a CDS by its
      // bounding span, and that selection is read as the CDS too.
      const views: [string, { start: number; end: number } | null][] = [
        ['no selection', null],
        ['the CDS selected', { start: f.start, end: f.end }],
      ];
      for (const [how, selection] of views) {
        const panel = translationPanel(doc, selection);
        const at = `${c.gene}, ${how}`;
        expect(panel.kv['Translated range:'], at).toBe(c.label);
        expect(panel.summary, at).toBe(`Translation Statistics (${want.protein.length} aa / codons)`);
        expect(panel.kv['Length (mean):'], at).toBe(`${want.protein.length} aa (codons)`);
        expect(panel.aa, `${at}: Biopython's protein, residue for residue counted`).toEqual(aaLine(want.protein));
        expect(panel.kv['Molecular weight (mean):'], `${at}: Biopython's mass`).toBe(want.mass);
        expect(Object.fromEntries((panel.codons ?? []).filter((x) => x.count > 0).map((x) => [x.codon, x.count])), at)
          .toEqual(tally(codonsOf(read)));
      }
    }
    expect([...reached].sort(), 'each wrong read gives another protein on some record').toEqual(Object.keys(wrongReads).sort());
  });

  it('shows all 64 codons in the 64-codon table', () => {
    // The base showed the first 16 of its 64-codon list. Wrong implementations: any slice of the
    // list, a codon shown twice, a codon under the wrong amino acid, or counts of another read.
    const { codons } = translationPanel(STRANDED, null);
    expect(codons, 'the table is drawn').not.toBeNull();
    expect(codons!.map((c) => c.codon).sort(), 'each of the 64 codons, once').toEqual([...ALL_64].sort());
    for (const c of codons!) expect(c.aa, c.codon).toBe(aaOf(c.codon));
    const counts = tally(codonsOf(handRevcomp(SEQ_600.slice(90, 390))));
    for (const c of codons!) expect(c.count, c.codon).toBe(counts[c.codon] ?? 0);
    expect(codons!.reduce((n, c) => n + c.count, 0), 'every codon of the CDS is counted').toBe(100);
    expect(codons!.filter((c) => c.count === 0).length, 'the table lists codons the CDS lacks').toBeGreaterThan(0);
  });
});

// BG-01M6SMBS. Biopython 1.88 on the records genbankRecord(gene, SEQ_600, 'linear', location)
// writes: SeqIO.read(text, 'genbank'), the CDS's feature.extract(record).seq.translate(), and
// ProteinAnalysis(that protein without its stops).molecular_weight(), recorded 2026-11-07. Each
// per-part form's `exported` location is the complement(join(...)) record Biopython extracts as the
// same protein (splicedMinus, exportMinus3 and exportAscending in the bug's table).
const BIOPY_PER_PART = {
  // 3,327.84 Da; listed 101..160 then 11..40
  perPartMinus: {
    location: 'join(complement(101..160),complement(11..40))', listed: [[101, 160], [11, 40]],
    protein: 'IIGTNAIVPPLLSVQRLFREQR*GSIHQRQ', mass: '3.33 kDa', exported: 'complement(join(11..40,101..160))',
  },
  // 5,236.15 Da; its parts (60, 59 and 31 bp) are not all whole codons
  perPartMinus3: {
    location: 'join(complement(201..260),complement(101..159),complement(11..41))', listed: [[201, 260], [101, 159], [11, 41]],
    protein: 'KYGELVMGLGRPKGGCLPPTL*VLTLLYPRC*AYNGFFAKQR*GSIHQRQ', mass: '5.24 kDa', exported: 'complement(join(11..41,101..159,201..260))',
  },
  // 3,327.84 Da; listed in ascending order, so a reader that sorts the parts leaves them as listed
  perPartAscending: {
    location: 'join(complement(11..40),complement(101..160))', listed: [[11, 40], [101, 160]],
    protein: 'QR*GSIHQRQIIGTNAIVPPLLSVQRLFRE', mass: '3.33 kDa', exported: 'complement(join(101..160,11..40))',
  },
} as const;
type PerPartGene = keyof typeof BIOPY_PER_PART;
type Parts = readonly (readonly [number, number])[];
const PER_PART_GENES = Object.keys(BIOPY_PER_PART) as PerPartGene[];
// Biopython 1.88 reads join(11..40,complement(101..160)) as join{[10:40](+), [100:160](-)} and
// translates it to this (3,395.11 Da), the protein the one-strand import does not give.
const BIOPY_MIXED_STRAND = 'LSLMYRALPLIIGTNAIVPPLLSVQRLFRE';

const translateDna = (dna: string) => codonsOf(dna).map(aaOf).join('');
/** The parts' bases joined in the order given, reverse-complemented by hand on the - strand. */
const readParts = (seq: string, strand: number, parts: Parts) => {
  const forward = parts.map(([a, b]) => seq.slice(a - 1, b)).join('');
  return strand === -1 ? handRevcomp(forward) : forward;
};
/** The one CDS of an imported document, with its parts in stored order, numbered 1..n in that order. */
function importedCds(doc: SequenceDocument) {
  const cds = doc.features.filter((f) => f.type === 'CDS');
  expect(cds, `${doc.name}: one CDS`).toHaveLength(1);
  const [f] = cds;
  const segments = f.segments ?? [];
  expect(segments.map((s) => s.index), `${doc.name}: parts numbered in stored order`).toEqual(segments.map((_, i) => i + 1));
  const parts = segments.length > 1 ? segments.map((s): [number, number] => [s.start, s.end]) : [[f.start, f.end] as [number, number]];
  return { f, parts, residues: translateDna(readParts(doc.sequence, f.strand, parts)) };
}
const joinName = (parts: Parts) => `join(${parts.map(([a, b]) => `${a}..${b}`).join(',')})`;

describe('BG-01M6SMBS: a join of complemented parts imports as the minus-strand CDS it is', () => {
  it('translates a per-part complement join as Biopython does', () => {
    // Wrong reads of a per-part complement join, each from the parts as listed. Translation
    // Statistics shows composition and mass, which whole codons trading places leave unchanged,
    // so the residue string is what tells them apart on perPartAscending.
    const sortedAscending = (parts: Parts) => [...parts].sort((x, y) => x[0] - y[0]);
    const wrongReads: Record<string, (gene: PerPartGene) => string> = {
      'the base: the + strand, the parts as listed': (g) => readParts(SEQ_600, 1, BIOPY_PER_PART[g].listed),
      'the - strand, the parts as listed': (g) => readParts(SEQ_600, -1, BIOPY_PER_PART[g].listed),
      'every part complemented, so minus strand with segments sorted ascending': (g) => readParts(SEQ_600, -1, sortedAscending(BIOPY_PER_PART[g].listed)),
      'the + strand, the parts reversed': (g) => readParts(SEQ_600, 1, [...BIOPY_PER_PART[g].listed].reverse()),
    };
    const reached = new Set<string>();
    for (const gene of PER_PART_GENES) {
      const want = BIOPY_PER_PART[gene];
      // the hand read of Biopython's location (each listed part reverse-complemented, in the
      // order listed) is Biopython's protein
      expect(translateDna(want.listed.map(([a, b]) => handRevcomp(SEQ_600.slice(a - 1, b))).join('')), gene).toBe(want.protein);
      for (const [how, wrong] of Object.entries(wrongReads)) {
        if (translateDna(wrong(gene)) !== want.protein) reached.add(how);
      }
      const doc = parseGenBank(genbankRecord(gene, SEQ_600, 'linear', want.location), gene);
      expect(doc.sequence).toBe(SEQ_600);
      const { f, parts, residues } = importedCds(doc);
      expect(f.strand, `${gene}: every part is complemented`).toBe(-1);
      expect(residues, `${gene}: its imported strand and stored parts read as Biopython reads ${want.location}`).toBe(want.protein);

      const panel = translationPanel(doc, null);
      expect(panel.kv['Translated range:'], gene).toBe(`CDS ${gene}, ${joinName(parts)}, - strand, read from its reverse complement`);
      expect(panel.summary, gene).toBe(`Translation Statistics (${want.protein.length} aa / codons)`);
      expect(panel.kv['Length (mean):'], gene).toBe(`${want.protein.length} aa (codons)`);
      expect(panel.aa, `${gene}: Biopython's composition`).toEqual(aaLine(want.protein));
      expect(panel.kv['Molecular weight (mean):'], `${gene}: Biopython's mass`).toBe(want.mass);
    }
    expect([...reached].sort(), 'each wrong read gives another protein on some record').toEqual(Object.keys(wrongReads).sort());
    expect(PER_PART_GENES.map((g) => BIOPY_PER_PART[g].protein.length)).toEqual([30, 50, 30]);

    // On perPartAscending the sorted read is another residue string with the same composition, and
    // so the same mass: the panel cannot tell it from the right one, only the string can.
    const asc = BIOPY_PER_PART.perPartAscending;
    const sorted = translateDna(readParts(SEQ_600, -1, sortedAscending(asc.listed)));
    expect(sorted).not.toBe(asc.protein);
    expect(aaLine(sorted)).toEqual(aaLine(asc.protein));
    const sortedDoc = parseGenBank(genbankRecord('perPartAscending', SEQ_600, 'linear', 'complement(join(11..40,101..160))'), 'sorted');
    const sortedPanel = translationPanel(sortedDoc, null);
    expect([sortedPanel.summary, sortedPanel.kv['Molecular weight (mean):'], sortedPanel.aa]).toEqual([
      `Translation Statistics (${asc.protein.length} aa / codons)`, asc.mass, aaLine(asc.protein),
    ]);
  });

  it('warns in the imported document\'s notes when a join mixes strands', () => {
    const location = 'join(11..40,complement(101..160))';
    const warning = (name: string) =>
      `CDS ${name} ${location} mixes plus- and minus-strand parts, which one feature here cannot hold; it was imported on the plus strand in the listed order, so its translation is not the annotated protein.`;
    const text = genbankRecord('mixedStrand', SEQ_600, 'linear', location);
    const doc = parseGenBank(text, 'mixedStrand');
    const { f, parts, residues } = importedCds(doc);
    expect({ strand: f.strand, parts }, 'one CDS, on the plus strand in the listed order').toEqual({ strand: 1, parts: [[11, 40], [101, 160]] });
    // what the warning says is so: the import does not read Biopython's protein
    expect(translateDna(SEQ_600.slice(10, 40) + handRevcomp(SEQ_600.slice(100, 160)))).toBe(BIOPY_MIXED_STRAND);
    expect(residues).not.toBe(BIOPY_MIXED_STRAND);
    expect(translationPanel(doc, null).aa).not.toEqual(aaLine(BIOPY_MIXED_STRAND));

    // The Notes are the D0005 block withWarningNotes writes for that one warning.
    const { Notes: notes, ...rest } = doc.docMetadata ?? {};
    expect(notes).toBe(withWarningNotes({ ...doc, docMetadata: rest }, [warning('mixedStrand')]).docMetadata?.Notes);
    expect(notes).toBe(`Warnings:\n- ${warning('mixedStrand')}\n`);
    // and the Info tab shows them, in its Notes box
    const info = parseMarkup(renderToStaticMarkup(<DocumentInfoPanel doc={doc} onUpdateDocument={() => {}} />));
    const box = findAll(info, (e) => e.tag === 'textarea' && e.attrs.id === 'document-notes');
    expect(box).toHaveLength(1);
    expect(textOf(box[0])).toBe(notes);

    // By /gene, else /locus_tag; /gene wins over a /label that names the feature.
    const tagged = parseGenBank(text.replace('/gene="mixedStrand"', '/locus_tag="MS_0001"'), 'tagged');
    expect(tagged.docMetadata?.Notes).toBe(`Warnings:\n- ${warning('MS_0001')}\n`);
    const labelled = parseGenBank(text.replace('/gene="mixedStrand"', '/label="shown"\n                     /locus_tag="MS_0001"\n                     /gene="mixG"'), 'labelled');
    expect(importedCds(labelled).f.name).toBe('shown');
    expect(labelled.docMetadata?.Notes).toBe(`Warnings:\n- ${warning('mixG')}\n`);

    // The all-minus forms carry no Warnings block.
    const allMinus: [string, string][] = [...PER_PART_GENES.map((g): [string, string] => [g, BIOPY_PER_PART[g].location]), ['splicedMinus', 'complement(join(11..40,101..160))']];
    for (const [gene, at] of allMinus) {
      const clean = parseGenBank(genbankRecord(gene, SEQ_600, 'linear', at), gene);
      expect(clean.docMetadata?.Notes, `${gene}: no Notes`).toBeUndefined();
      expect(JSON.stringify(clean.docMetadata ?? {}), gene).not.toContain('Warnings');
    }
  });

  it('exports a per-part complement join to a location Biopython extracts as the same protein', () => {
    /** The CDS location an exported record writes, its continuation lines joined. */
    const cdsLocation = (gb: string) => {
      const lines = gb.split('\n');
      const at = lines.findIndex((l) => l.startsWith('     CDS '));
      expect(at, 'the export writes the CDS').toBeGreaterThan(-1);
      let loc = lines[at].slice(21).trim();
      for (let i = at + 1; i < lines.length && /^ {21}[^/ ]/.test(lines[i]); i++) loc += lines[i].trim();
      return loc;
    };
    for (const gene of PER_PART_GENES) {
      const want = BIOPY_PER_PART[gene];
      const doc = parseGenBank(genbankRecord(gene, SEQ_600, 'linear', want.location), gene);
      const gb = exportToGenBank(doc);
      // the location Biopython 1.88 extracts as want.protein (the bug's table)
      expect(cdsLocation(gb), `${gene}: exported as`).toBe(want.exported);
      const back = parseGenBank(gb, gene);
      expect(back.sequence).toBe(SEQ_600);
      expect(importedCds(back).residues, `${gene}: re-imported from its export`).toBe(want.protein);
    }
  });
});
