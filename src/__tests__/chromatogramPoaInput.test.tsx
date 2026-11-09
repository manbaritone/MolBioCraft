// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S17N: the chromatogram studio's consensus contig is built from every ticked read over its
 * whole (pre-trimmed) length, and where the assembler leaves a read out or cuts it, the studio and
 * the saved contig say which read and how much of it.
 *
 * Each check renders the real studio over the real WASM engine, ticks the reads, opens the Contig
 * Assembly panel, runs the assembly and saves the contig, then reads the markup and the document
 * the studio handed over. The renders run on the server, where a state update made while a
 * component renders re-renders it with the update, so a click calls the real onClick of the button
 * it names, once, from inside the render that creates that button (the harness of
 * plainLanguageLabels.test.tsx). Reads are generated here from a fixed seed (rule 16).
 *
 * Wrong implementations, and the check that catches each: the old first-6 cut (the read count and
 * the read rows of the 1,400 bp sets); the old 1,200-base cut (the rows' raw and post-trim
 * lengths); the
 * semiglobal POA traceback that loops on partly overlapping reads (the partial-overlap set, which
 * traps the old engine); a read dropped by the pre-trim without a word, warnings not shown beside
 * the contig, or not kept in the saved contig's notes (the all-Q0 read and the long reads); a
 * read count that hides the dropped read (the "of 9" count); a warning shown when nothing was cut
 * (the whole sets).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/** Buttons to click, in order: each fires once, on the first button whose words match it. */
const clicker = vi.hoisted(() => {
  const textOf = (n: unknown): string => {
    if (n === null || n === undefined || typeof n === 'boolean') return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(textOf).join('');
    if (typeof n === 'object' && 'props' in n) return textOf((n as { props: { children?: unknown } }).props.children);
    return '';
  };
  const steps: { label: RegExp; done: boolean }[] = [];
  const event = { preventDefault() {}, stopPropagation() {} };
  const wrap = <F,>(create: F): F =>
    ((type: unknown, props: { onClick?: unknown; children?: unknown; disabled?: unknown } | null, ...rest: unknown[]) => {
      if (type === 'button' && props && typeof props.onClick === 'function' && !props.disabled) {
        const next = steps.find((s) => !s.done);
        if (next && next.label.test(textOf(props.children).replace(/\s+/g, ' ').trim())) {
          next.done = true;
          (props.onClick as (e: unknown) => void)(event);
        }
      }
      return (create as unknown as (...a: unknown[]) => unknown)(type, props, ...rest);
    }) as unknown as F;
  return { steps, wrap };
});

vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<typeof import('react/jsx-dev-runtime')>('react/jsx-dev-runtime');
  return { ...actual, jsxDEV: clicker.wrap(actual.jsxDEV) };
});

vi.mock('react/jsx-runtime', async () => {
  const actual = await vi.importActual<typeof import('react/jsx-runtime')>('react/jsx-runtime');
  return { ...actual, jsx: clicker.wrap(actual.jsx), jsxs: clicker.wrap(actual.jsxs) };
});

const { ChromatogramAndContigStudio } = await import('../components/ChromatogramAndContigStudio');
type SequenceDocument = import('../types/bio').SequenceDocument;

// ─── Fixed-seed reads ───

/** mulberry32: a small, fixed-seed generator. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomDna = (r: () => number, n: number) => Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join('');
/** `seq` with about 1% of its bases substituted (never an indel, so every read keeps its length). */
const withSubstitutions = (r: () => number, seq: string) =>
  Array.from(seq, (b) => (r() < 0.01 ? 'ACGT'[('ACGT'.indexOf(b) + 1) % 4] : b)).join('');
const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
const reverseComplement = (seq: string) => Array.from(seq).reverse().map((b) => COMPLEMENT[b]).join('');

/** A trace with these base calls, each under a clean peak (an N call under none) and scored at this Phred value. */
function traceDoc(id: string, calls: string, phred: number): SequenceDocument {
  const spacing = 12;
  const n = calls.length;
  const len = (n + 1) * spacing;
  const channels: Record<string, number[]> = { A: [], C: [], G: [], T: [] };
  for (const b of 'ACGT') channels[b] = new Array(len).fill(0);
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const at = i * spacing + spacing / 2;
    peaks.push(at);
    const channel = channels[calls[i]];
    if (!channel) continue;
    for (let x = at - 5; x <= at + 5; x++) channel[x] = Math.round(1000 * Math.exp(-((x - at) ** 2) / 4));
  }
  return {
    id, name: `${id}.ab1`, accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence: calls,
    features: [], primers: [], history: [], createdAt: '', updatedAt: '', folder: 'Sequencing Reads (Sanger/NGS)',
    documentKind: 'trace',
    chromatogram: {
      traceA: channels.A, traceC: channels.C, traceG: channels.G, traceT: channels.T,
      peakLocations: peaks, phredScores: new Array(n).fill(phred), baseCalls: calls,
    },
  };
}

/**
 * Eight Q40 reads of 1,400 bp, alternately forward and reverse: over one amplicon of 1,400 bp
 * (`overlap` 'whole'), or, when 'partial', the forward reads over its first 1,400 bases and the
 * reverse reads over its last 1,400 of 2,000.
 */
function eightReads(overlap: 'whole' | 'partial') {
  const r = rng(overlap === 'whole' ? 0x5eed : 0x0b17);
  const template = randomDna(r, overlap === 'whole' ? 1400 : 2000);
  const reads = Array.from({ length: 8 }, (_, i) => {
    const span = i % 2 === 0 ? template.slice(0, 1400) : template.slice(template.length - 1400);
    const s = withSubstitutions(r, span);
    return traceDoc(`read${i}`, i % 2 === 0 ? s : reverseComplement(s), 40);
  });
  return { template, reads };
}

// ─── Reading a render ───

const wordsOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** Ticks `docs`, runs the assembly and saves the contig; returns the markup and what was saved. */
function assemble(docs: SequenceDocument[]): { html: string; saved: SequenceDocument } {
  const saved: SequenceDocument[] = [];
  clicker.steps.length = 0;
  clicker.steps.push(...[/^Contig Assembly$/, /^Run assembly preview$/, /^\+ Save POA Consensus Contig/].map((label) => ({ label, done: false })));
  const html = renderToStaticMarkup(
    <ChromatogramAndContigStudio documents={docs} activeDoc={docs[0]} selectedDocuments={docs} onCreateDocument={(d) => saved.push(d)} />);
  for (const s of clicker.steps) expect(s.done, `a button matching ${s.label} was clicked`).toBe(true);
  clicker.steps.length = 0;
  expect(saved, 'the contig was saved once').toHaveLength(1);
  return { html, saved: saved[0] };
}

/** The POA card's consensus length and read count KPI, as words. */
function consensusKpi(html: string): string {
  const m = /<span class="kpi-label">POA Consensus Length<\/span>\s*<strong class="kpi-val">([\s\S]*?)<\/strong>/.exec(html);
  expect(m, 'the consensus KPI is drawn').not.toBeNull();
  return wordsOf(m![1]);
}

/** Each row of the assembled-reads table: [read name, raw / post-trim length]. */
function readRows(html: string): [string, string][] {
  const at = html.indexOf('aria-label="POA Assembled Sequencing Reads"');
  expect(at, 'the assembled-reads table is drawn').toBeGreaterThan(-1);
  const body = html.slice(html.indexOf('<tbody', at), html.indexOf('</tbody>', at));
  return Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g), (row) => {
    const cells = Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g), (c) => wordsOf(c[1]));
    return [cells[0], cells[2]] as [string, string];
  });
}

/** The sentences of the contig's warnings region, or null when the studio drew none. */
function contigWarnings(html: string): string[] | null {
  const at = html.indexOf('aria-label="Contig assembly warnings"');
  if (at === -1) return html.includes('data-mbc-result-warnings') ? [] : null;
  const region = html.slice(at, html.indexOf('</div>', at));
  return Array.from(region.matchAll(/<span>([^<]*)<\/span>/g), (m) => wordsOf(m[1]));
}

/** The `- sentence` lines of the saved contig's Warnings block in its notes; none without the block. */
const savedWarnings = (doc: SequenceDocument): string[] => {
  const notes = String(doc.docMetadata?.Notes ?? '');
  const at = notes.indexOf('Warnings:\n');
  if (at === -1) return [];
  return notes.slice(at).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
};

// ─── AC1 ───

describe('BG-01M6S17N contig assembly input', () => {
  it('uses every ticked read or says which reads were used: eight 1,400 bp reads of one amplicon, all at full length', () => {
    const { template, reads } = eightReads('whole');
    const { html, saved } = assemble(reads);
    expect(consensusKpi(html)).toBe('1,400 bp (8 reads)');
    expect(readRows(html)).toEqual(reads.map((d) => [d.name, '1400 / 1400 bp']));
    expect(contigWarnings(html), 'nothing was left out or cut, so nothing is warned').toBeNull();
    // The saved contig is the whole amplicon, from all eight reads.
    expect(saved.sequence).toBe(template);
    expect(saved.alignmentMeta?.sequenceCount).toBe(8);
    expect([...(saved.history[0]?.parentIds ?? [])].sort()).toEqual(reads.map((d) => d.id).sort());
    expect(savedWarnings(saved)).toEqual([]);
  });

  it('uses every ticked read or says which reads were used: eight 1,400 bp reads that only partly overlap', () => {
    const { reads } = eightReads('partial');
    const { html, saved } = assemble(reads);
    expect(consensusKpi(html)).toMatch(/^[\d,]+ bp \(8 reads\)$/);
    expect(readRows(html)).toEqual(reads.map((d) => [d.name, '1400 / 1400 bp']));
    expect(contigWarnings(html)).toBeNull();
    expect(saved.alignmentMeta?.sequenceCount).toBe(8);
  });

  it('uses every ticked read or says which reads were used: a read the pre-trim keeps nothing of', () => {
    const { reads } = eightReads('whole');
    // Q0 at every call: no base's error probability is below the pre-trim's 0.05 (BG-01M6RPCA).
    const allBad = traceDoc('allbad', randomDna(rng(9), 1400), 0);
    const ticked = [reads[0], allBad, ...reads.slice(1)];
    const { html, saved } = assemble(ticked);
    const said = 'allbad.ab1: the Mott quality pre-trim at P(err) 0.05 kept none of its 1,400 bases, so it was left out of the contig.';
    expect(consensusKpi(html)).toBe('1,400 bp (8 of 9 reads)');
    expect(readRows(html).map(([name]) => name)).toEqual(reads.map((d) => d.name));
    expect(contigWarnings(html)).toEqual([said]);
    expect(savedWarnings(saved)).toEqual([said]);
    expect(saved.alignmentMeta?.sequenceCount).toBe(8);
  });

  it('uses every ticked read or says which reads were used: reads past the per-read bound', () => {
    const r = rng(0x1ea);
    const template = randomDna(r, 2600);
    const fwd = traceDoc('fwd', template, 40);
    const rev = traceDoc('rev', reverseComplement(template), 40);
    const { html, saved } = assemble([fwd, rev]);
    const said = (name: string) =>
      `${name}: only the first 2,500 of its 2,600 bases after the quality pre-trim were assembled; the assembler aligns at most 2,500 bases of a read.`;
    expect(readRows(html)).toEqual([['fwd.ab1', '2600 / 2500 bp'], ['rev.ab1', '2600 / 2500 bp']]);
    expect(contigWarnings(html)).toEqual([said('fwd.ab1'), said('rev.ab1')]);
    expect(savedWarnings(saved)).toEqual([said('fwd.ab1'), said('rev.ab1')]);
    expect(consensusKpi(html)).toMatch(/\(2 reads\)$/);
  });
});

// ─── BG-01M6SQ2Y: partly overlapping forward and reverse reads ───

/**
 * The edit distance (substitutions plus inserted and deleted bases) of a global alignment of
 * `a` (the contig) to `b` (the amplicon), with its traceback: `at[p]` is the contig base the
 * alignment puts against amplicon base `p`, or '-' where the contig has none. Written here, never
 * the engine's aligner, so the engine cannot grade itself.
 */
function editAlignment(a: string, b: string): { distance: number; at: string[] } {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const d = new Uint32Array((n + 1) * w);
  for (let i = 0; i <= n; i++) d[i * w] = i;
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = d[(i - 1) * w + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      d[i * w + j] = Math.min(diag, d[(i - 1) * w + j] + 1, d[i * w + j - 1] + 1);
    }
  }
  const at: string[] = new Array(m).fill('-');
  let edits = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = d[i * w + j];
    if (i > 0 && j > 0 && here === d[(i - 1) * w + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      at[j - 1] = a[i - 1];
      if (a[i - 1] !== b[j - 1]) edits++;
      i--; j--;
    } else if (i > 0 && here === d[(i - 1) * w + j] + 1) {
      edits++; i--; // a contig base the amplicon does not have
    } else {
      edits++; j--; // an amplicon base the contig dropped
    }
  }
  expect(edits, 'the traceback accounts for every edit').toBe(d[n * w + m]);
  return { distance: d[n * w + m], at };
}

/**
 * The 8 fixed seeds every layout is assembled on, one case each: the first eight from 1 up whose
 * reads leave at most 2 positions undecided on both AC1 layouts (`undecided` below). An undecided
 * position is a 2-against-2 tie (withSubstitutions always substitutes the same base) or a
 * substitution carried by most reads, which no consensus can call from Q40 reads; the bound of 2
 * edits allows two such ties. Seeds 4 and 7 leave 3 and 5 undecided, so they are not used.
 */
const SEEDS = [1, 2, 3, 5, 6, 8, 9, 10];

/**
 * Eight Q40 reads of one 1,400 bp amplicon, forward and reverse alternating: the forward reads
 * over amplicon bases `fwd` and the reverse reads over `rev` (1-based, inclusive), each with about
 * 1% substitutions. As the generator made them: `carriers[p]` counts the reads whose base at
 * amplicon position p (0-based) is the amplicon's own, and `undecided` lists the positions where
 * those are not more than half the reads covering p.
 */
function ampliconReads(seed: number, fwd: [number, number], rev: [number, number]) {
  const r = rng(seed);
  const template = randomDna(r, 1400);
  const carriers = new Array<number>(template.length).fill(0);
  const depth = new Array<number>(template.length).fill(0);
  const reads = Array.from({ length: 8 }, (_, i) => {
    const [from, to] = i % 2 === 0 ? fwd : rev;
    const s = withSubstitutions(r, template.slice(from - 1, to));
    for (let k = 0; k < s.length; k++) {
      depth[from - 1 + k]++;
      if (s[k] === template[from - 1 + k]) carriers[from - 1 + k]++;
    }
    return traceDoc(`read${i}`, i % 2 === 0 ? s : reverseComplement(s), 40);
  });
  const undecided = carriers.flatMap((c, p) => (2 * c <= depth[p] ? [p + 1] : []));
  return { template, reads, carriers, undecided };
}

const LAYOUTS: { overlap: number; fwd: [number, number]; rev: [number, number] }[] = [
  { overlap: 600, fwd: [1, 1000], rev: [401, 1400] },
  { overlap: 100, fwd: [1, 750], rev: [651, 1400] },
];

/** A Q40 read named `id`, of `bases` (no substitutions unless the caller made them). */
const q40 = (id: string, bases: string) => traceDoc(id, bases, 40);

/**
 * Wrong implementations, and the check that catches each: the old end-to-end (global) POA of each
 * read against a graph seeded by one read, which folds the overhang of a read that runs past the
 * graph onto unrelated graph bases (the length and the edit distance: about 1,060 bp on the
 * 600-bp layout and 800 bp on the 100-bp one); an overlap finder that needs a long overlap (the
 * 100-bp layout); a junction that duplicates or drops bases, or an end error taken for an overhang
 * (the length and the edit distance, which a substitution count would miss); a consensus no
 * better than one read, about 10 to 14 false variants (the bound of 2, and every position 3 or
 * more reads agree on); a read left out or cut that is not said (the read count, the rows and the
 * warnings); a contig grown from the first or longest read when that read is the odd one out (the
 * foreign read ticked first); a placement rule looser or stricter than 50 bases at 90% identity
 * (the reads at 49 and 50 bases, 89% and 90%); left-out reads named in length order rather than
 * input order (the two foreign reads).
 */
describe('BG-01M6SQ2Y contig of partly overlapping reads', () => {
  const cases = LAYOUTS.flatMap((layout) => SEEDS.map((seed) => ({ ...layout, seed })));
  it.each(cases)('assembles partly overlapping forward and reverse reads to the amplicon: a $overlap-bp overlap, seed $seed', ({ seed, fwd, rev }) => {
    const { template, reads, carriers, undecided } = ampliconReads(seed, fwd, rev);
    expect(undecided.length, `the fixture leaves at most 2 positions undecided (${undecided.join(', ')})`).toBeLessThanOrEqual(2);
    const { html, saved } = assemble(reads);
    expect(consensusKpi(html)).toBe('1,400 bp (8 reads)');
    expect(contigWarnings(html), 'every read was placed whole, so nothing is warned').toBeNull();
    // Q40 at every call: the Mott pre-trim keeps every base of every read, so the contig owes the
    // amplicon's whole length.
    expect(readRows(html).map(([, len]) => len)).toEqual(reads.map((d) => `${d.sequence.length} / ${d.sequence.length} bp`));
    expect(saved.sequence).toHaveLength(1400);
    const { distance, at } = editAlignment(saved.sequence, template);
    expect(distance, 'edits between the saved contig and the amplicon').toBeLessThanOrEqual(2);
    const outvoted = carriers.flatMap((c, p) => (c >= 3 && at[p] !== template[p] ? [`${p + 1}: ${at[p]} for ${template[p]} (${c} reads agree)`] : []));
    expect(outvoted, 'positions where 3 or more reads carry the amplicon base').toEqual([]);
    expect(saved.alignmentMeta?.sequenceCount).toBe(8);
  });

  // An overlap alignment that let a read run past the draft at no cost would score a read whose
  // first two bases are errors better as one base "before" the others plus a gap than as two
  // mismatches: here the amplicon starts AT and read 2 starts CA (A for the T matches the
  // amplicon's first A), and it ends TA where read 5 ends AC. Taken for overhangs, those would add
  // a base at each end of the contig.
  it('assembles partly overlapping forward and reverse reads to the amplicon: reads whose two end bases are errors', () => {
    const template = `AT${randomDna(rng(0xe4d), 1396)}TA`;
    const next = (b: string) => 'ACGT'[('ACGT'.indexOf(b) + 1) % 4];
    const reads = Array.from({ length: 8 }, (_, i) => {
      let s = i % 2 === 0 ? template.slice(0, 1000) : template.slice(400);
      if (i === 2) s = next(s[0]) + next(s[1]) + s.slice(2);
      if (i === 5) s = s.slice(0, -2) + next(s[s.length - 2]) + next(s[s.length - 1]);
      return q40(`read${i}`, i % 2 === 0 ? s : reverseComplement(s));
    });
    expect([reads[2].sequence.slice(0, 2), reverseComplement(reads[5].sequence).slice(-2)]).toEqual(['CA', 'AC']);
    const { html, saved } = assemble(reads);
    expect(consensusKpi(html)).toBe('1,400 bp (8 reads)');
    expect(contigWarnings(html)).toBeNull();
    expect(saved.sequence).toBe(template);
  });

  // A read that runs only a few bases past the others still extends the layout's draft, and its
  // bases there belong in the contig. The longest read (over 11-1,100) grows the layout, and a
  // reverse read over 401-1,388 extends it; then one forward read starts 10 bases earlier (1-900)
  // and one reverse read ends 12 bases later (700-1,400), the only reads over those bases. Bases
  // 1,388 and 1,400 are both A, so were the 12 left to be aligned as inserted bases, they could go
  // just before base 1,388 at the same cost as after it, on a side branch the consensus drops.
  it('assembles partly overlapping forward and reverse reads to the amplicon: a read 10 bases before the others and one 12 past them', () => {
    const bases = Array.from(randomDna(rng(0x5b0a), 1400));
    bases[1387] = 'A';
    bases[1399] = 'A';
    const template = bases.join('');
    const spans: [number, number, boolean][] = [
      [11, 1100, true], [401, 1388, false], [11, 1000, true], [401, 1388, false],
      [11, 1000, true], [401, 1388, false], [1, 900, true], [700, 1400, false],
    ];
    const reads = spans.map(([from, to, fwd], i) => {
      const s = template.slice(from - 1, to);
      return q40(`read${i}`, fwd ? s : reverseComplement(s));
    });
    const { html, saved } = assemble(reads);
    expect(consensusKpi(html)).toBe('1,400 bp (8 reads)');
    expect(contigWarnings(html)).toBeNull();
    expect(saved.sequence).toBe(template);
  });

  it.each(SEEDS.map((seed, k) => ({ seed, at: k, nth: k + 1 })))('names and leaves out a read it cannot place: seed $seed, the foreign read ticked $nth of 9', ({ seed, at }) => {
    const { reads } = ampliconReads(seed, LAYOUTS[0].fwd, LAYOUTS[0].rev);
    // A 1,000 bp Q40 read of an unrelated amplicon, ticked among the others; ticked first, it is
    // also the first of the longest reads, so a contig grown from that read would be it alone.
    const foreignBases = randomDna(rng(seed ^ 0x9e3779b9), 1400).slice(0, 1000);
    const ticked = [...reads.slice(0, at), q40('foreign', foreignBases), ...reads.slice(at)];
    const { html, saved } = assemble(ticked);
    const alone = assemble(reads).saved;
    const said = 'Reads foreign.ab1 could not be placed in one contig with the others and were left out; the contig is built from the other 8 reads.';
    expect(contigWarnings(html)).toEqual([said]);
    expect(consensusKpi(html)).toBe('1,400 bp (8 of 9 reads)');
    expect(readRows(html).map(([name]) => name).sort()).toEqual(reads.map((d) => d.name).sort());
    expect(saved.sequence, 'the contig the 8 reads give without the foreign read').toBe(alone.sequence);
    const strands = [foreignBases, reverseComplement(foreignBases)];
    const stretches = strands.flatMap((s) => Array.from({ length: s.length - 19 }, (_, i) => s.slice(i, i + 20)));
    expect(stretches.filter((s) => saved.sequence.includes(s)), '20-base stretches of the foreign read in the contig').toEqual([]);
    expect(savedWarnings(saved)).toEqual([said]);
    expect(saved.alignmentMeta?.sequenceCount).toBe(8);
  });

  // The rule's edges: four forward reads over bases 1-1,000 of an amplicon, and one reverse read
  // over its 3' end that overlaps them by `overlap` bases, with `substituted` of the overlap's
  // bases substituted, every third base from its 41st, and every other base exact. Spaced so, no
  // gapped alignment beats the straight one (a run of substitutions can: shifted a base, some of
  // its substituted bases match by chance), so the overlap's identity is
  // (overlap - substituted) / overlap.
  it.each([
    { overlap: 49, substituted: 0, placed: false, edge: '49 bases at 100% identity is left out' },
    { overlap: 50, substituted: 0, placed: true, edge: '50 bases at 100% identity is placed' },
    { overlap: 100, substituted: 11, placed: false, edge: '100 bases at 89% identity is left out' },
    { overlap: 100, substituted: 10, placed: true, edge: '100 bases at 90% identity is placed' },
  ])('names and leaves out a read it cannot place: a reverse read overlapping the others by $edge', ({ overlap, substituted, placed }) => {
    const template = randomDna(rng(0x5ee0), 1400);
    const probe = Array.from(template.slice(1000 - overlap), (b, k) =>
      (k >= 40 && k < 40 + 3 * substituted && (k - 40) % 3 === 0 ? 'ACGT'[('ACGT'.indexOf(b) + 1) % 4] : b)).join('');
    const ticked = [0, 1, 2, 3].map((i) => q40(`fwd${i}`, template.slice(0, 1000))).concat(q40('probe', reverseComplement(probe)));
    const { html, saved } = assemble(ticked);
    if (placed) {
      expect(consensusKpi(html)).toBe('1,400 bp (5 reads)');
      expect(contigWarnings(html)).toBeNull();
      expect(saved.sequence, 'four reads outvote the substitutions in the overlap').toBe(template);
    } else {
      const said = 'Reads probe.ab1 could not be placed in one contig with the others and were left out; the contig is built from the other 4 reads.';
      expect(consensusKpi(html)).toBe('1,000 bp (4 of 5 reads)');
      expect(contigWarnings(html)).toEqual([said]);
      expect(savedWarnings(saved)).toEqual([said]);
      expect(saved.sequence).toBe(template.slice(0, 1000));
    }
  });

  it('names and leaves out a read it cannot place: two foreign reads, named in the order they were ticked', () => {
    const { reads } = ampliconReads(SEEDS[0], LAYOUTS[0].fwd, LAYOUTS[0].rev);
    // The read ticked first is the shorter, so length order would name them the other way round.
    const short = q40('foreignShort', randomDna(rng(0xa11), 900));
    const long = q40('foreignLong', randomDna(rng(0xb22), 1200));
    const { html, saved } = assemble([reads[0], short, ...reads.slice(1, 5), long, ...reads.slice(5)]);
    const said = 'Reads foreignShort.ab1, foreignLong.ab1 could not be placed in one contig with the others and were left out; the contig is built from the other 8 reads.';
    expect(contigWarnings(html)).toEqual([said]);
    expect(consensusKpi(html)).toBe('1,400 bp (8 of 10 reads)');
    expect(savedWarnings(saved)).toEqual([said]);
  });

  it.each(SEEDS)('keeps the contig of reads spanning one amplicon: seed %s', (seed) => {
    const { template, reads } = ampliconReads(seed, [1, 1400], [1, 1400]);
    const { html, saved } = assemble(reads);
    expect(consensusKpi(html)).toBe('1,400 bp (8 reads)');
    expect(contigWarnings(html)).toBeNull();
    expect(saved.sequence).toBe(template);
    expect(savedWarnings(saved)).toEqual([]);
  });
});

// ─── BG-01M6TD2N: repeats, low-complexity and N overlaps, the two-sided count, orientation ───

/**
 * The fewest edits (substitutions plus inserted and deleted bases) that turn `a` (the contig) into
 * some stretch of `b` (the amplicon): `a` aligned whole, `b`'s ends free. A contig that dropped
 * repeat copies inside itself is no stretch of the amplicon and costs a unit's length per copy.
 * Written here, never the engine's aligner. `start` is where that stretch begins in `b` (0-based).
 */
function stretchEdits(a: string, b: string): { distance: number; start: number } {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const d = new Uint32Array((n + 1) * w);
  for (let i = 0; i <= n; i++) d[i * w] = i;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i * w + j] = Math.min(d[(i - 1) * w + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), d[(i - 1) * w + j] + 1, d[i * w + j - 1] + 1);
    }
  }
  let end = 0;
  for (let j = 1; j <= m; j++) if (d[n * w + j] < d[n * w + end]) end = j;
  // Walk back to where the stretch starts: the first row is free, so the walk ends there.
  let i = n;
  let j = end;
  while (i > 0) {
    const here = d[i * w + j];
    if (j > 0 && here === d[(i - 1) * w + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { i--; j--; } else if (here === d[(i - 1) * w + j] + 1) i--; else j--;
  }
  return { distance: d[n * w + end], start: j };
}

/**
 * Q40 reads of `template` over `spans` ([from, to] 1-based inclusive, forward or not), as the
 * caller lists them, each with about 1% substitutions drawn from `r`. `undecided` lists, for all
 * the reads, the forward reads alone and the reverse reads alone (either may be all a contig is
 * built from), the amplicon positions (1-based) where the reads carrying the amplicon's base are
 * not more than half the reads over it.
 */
function noisyReads(r: () => number, template: string, spans: [number, number, boolean][]) {
  const sense = spans.map(([from, to]) => withSubstitutions(r, template.slice(from - 1, to)));
  const reads = sense.map((s, i) => traceDoc(`read${i}`, spans[i][2] ? s : reverseComplement(s), 40));
  const undecidedOf = (pick: (i: number) => boolean) => {
    const carriers = new Array<number>(template.length).fill(0);
    const depth = new Array<number>(template.length).fill(0);
    sense.forEach((s, i) => {
      if (!pick(i)) return;
      for (let k = 0; k < s.length; k++) {
        depth[spans[i][0] - 1 + k]++;
        if (s[k] === template[spans[i][0] - 1 + k]) carriers[spans[i][0] - 1 + k]++;
      }
    });
    return carriers.flatMap((c, p) => (depth[p] > 0 && 2 * c <= depth[p] ? [p + 1] : []));
  };
  const undecided = { all: undecidedOf(() => true), forward: undecidedOf((i) => spans[i][2]), reverse: undecidedOf((i) => !spans[i][2]) };
  return { reads, undecided };
}

/** A base other than any of `avoid`. */
const otherThan = (...avoid: string[]) => 'ACGT'.split('').find((b) => !avoid.includes(b))!;

/**
 * A 1,400 bp amplicon holding `copies` exact copies of a random `unit`-bp unit from base `at`
 * (1-based), between random flanks whose bases next to the repeat do not continue it.
 */
function tandemAmplicon(seed: number, unit: number, copies: number, at: number) {
  const r = rng(seed);
  const u = randomDna(r, unit);
  const left = Array.from(randomDna(r, at - 1));
  const right = Array.from(randomDna(r, 1400 - (at - 1) - unit * copies));
  left[left.length - 1] = otherThan(u[unit - 1]);
  right[0] = otherThan(u[0]);
  return { r, template: left.join('') + u.repeat(copies) + right.join(''), from: at, to: at + unit * copies - 1 };
}

/** Every cell of each row of the assembled-reads table, as words. */
function rowCells(html: string): string[][] {
  const at = html.indexOf('aria-label="POA Assembled Sequencing Reads"');
  expect(at, 'the assembled-reads table is drawn').toBeGreaterThan(-1);
  const body = html.slice(html.indexOf('<tbody', at), html.indexOf('</tbody>', at));
  return Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g), (row) =>
    Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g), (c) => wordsOf(c[1])));
}

/** A KPI box's value, as words. */
function kpi(html: string, label: string): string {
  const m = new RegExp(`<span class="kpi-label">${label}</span>\\s*<strong class="kpi-val">([\\s\\S]*?)</strong>`).exec(html);
  expect(m, `the ${label} KPI is drawn`).not.toBeNull();
  return wordsOf(m![1]);
}

const F = true;
const R = false;
const alternate = (fwd: [number, number][], rev: [number, number][]): [number, number, boolean][] =>
  fwd.flatMap((f, k) => [[...f, F], [...rev[k], R]] as [number, number, boolean][]);

/**
 * A forward/reverse pair whose whole overlap lies inside an exact tandem repeat cannot tell how
 * many copies the repeat holds: shifted by a unit, the overlap matches as well. The old layout
 * took the longest such overlap and dropped copies without a word (on the two layouts below that
 * no read spans, 1,325 bp for the 40-bp unit and 1,250 bp for the 150-bp one). The contig must
 * either be the amplicon's exact length within 2 edits, every read in it, or leave out the reads
 * it cannot place and name the repeat; the kept contig is then a stretch of the amplicon within 2
 * edits, so no copy is lost inside it. Wrong implementations, and the check that catches each:
 * the longest overlap kept (the stretch and the length); a warning given but the read placed
 * anyway (the stretch); every read touching a repeat left out (the cases where one read spans the
 * repeat, which assemble exactly); a repeat named by the wrong unit (the unit); a read left out
 * but not named (the names against the rows).
 */
const TANDEM_CASES = [
  {
    name: 'a 40-bp unit x8 at 601-920, forward reads 1-750 and reverse reads 651-1,400',
    seed: 2, unit: 40, copies: 8, at: 601, assembled: false,
    spans: alternate([[1, 750], [1, 750], [1, 750], [1, 750]], [[651, 1400], [651, 1400], [651, 1400], [651, 1400]]),
  },
  {
    name: 'a 40-bp unit x8 at 601-920, one forward read across it to 1,000',
    seed: 2, unit: 40, copies: 8, at: 601, assembled: true,
    spans: alternate([[1, 750], [1, 750], [1, 750], [1, 1000]], [[651, 1400], [651, 1400], [651, 1400], [651, 1400]]),
  },
  {
    name: 'a 150-bp unit x4 at 401-1,000, ragged reads that all end inside it',
    seed: 2, unit: 150, copies: 4, at: 401, assembled: false,
    spans: alternate([[1, 700], [1, 750], [1, 800], [1, 850]], [[600, 1400], [650, 1400], [700, 1400], [750, 1400]]),
  },
  {
    name: 'a 150-bp unit x4 at 401-1,000, one forward read across it to 1,100',
    seed: 2, unit: 150, copies: 4, at: 401, assembled: true,
    spans: alternate([[1, 700], [1, 750], [1, 800], [1, 1100]], [[600, 1400], [650, 1400], [700, 1400], [750, 1400]]),
  },
];

/** Four Q40 copies of amplicon bases 1-1,000 and a Q40 reverse read `probe` (given 5' to 3' on the amplicon's strand). */
const fourForwardAndProbe = (template: string, probe: string) =>
  [0, 1, 2, 3].map((i) => q40(`fwd${i}`, template.slice(0, 1000))).concat(q40('probe', reverseComplement(probe)));

const leftOutProbe = 'Reads probe.ab1 could not be placed in one contig with the others and were left out; the contig is built from the other 4 reads.';

/**
 * A 1,400 bp amplicon of random flanks around `block` at base 501, read by four exact Q40 reads of
 * the whole amplicon (two forward, two reverse) and one Q40 read of `inside` bases of the block,
 * from its 21st base, forward or reverse.
 */
function blockAndShortRead(seed: number, block: string, inside: number, forward: boolean) {
  const r = rng(seed);
  const template = randomDna(r, 500) + block + randomDna(r, 900 - block.length);
  const whole = [0, 1, 2, 3].map((i) => q40(`whole${i}`, i % 2 === 0 ? template : reverseComplement(template)));
  const short = template.slice(520, 520 + inside);
  return { template, reads: [...whole, q40('short', forward ? short : reverseComplement(short))] };
}

/**
 * A reverse read overlapping four forward reads over 1-1,000 by the amplicon's bases 901-1,000,
 * with overlap bases 11-30 called N and `substituted` of its bases substituted, every third from
 * the 41st (spaced so no gapped alignment beats the straight one).
 */
function nProbe(substituted: number) {
  const template = randomDna(rng(0x5ee0), 1400);
  const probe = Array.from(template.slice(900), (b, k) => {
    if (k >= 10 && k < 30) return 'N';
    return k >= 40 && k < 40 + 3 * substituted && (k - 40) % 3 === 0 ? 'ACGT'[('ACGT'.indexOf(b) + 1) % 4] : b;
  }).join('');
  return { template, reads: fourForwardAndProbe(template, probe) };
}

/**
 * Wrong implementations, and the check that catches each: k-mers the draft holds more than 32
 * times proposing nothing, as before (every low-complexity case: the read is left out and named);
 * an N counted as a mismatch (the N-run reads, and 20 Ns with 8 substitutions, 72 of 100); an N
 * counted as a match (20 Ns with 9 substitutions: 91 of 100 would place it, 71 of 80 does not); an
 * N scored as a mismatch in the overlap alignment (the read of 60 called bases and 140 Ns: its
 * exact place inside the others sinks from 120 to -160, below a 93% copy at their end, which
 * would add its Ns past them, and it is left out as fitting in two places).
 */
const LOW_COMPLEXITY_CASES = [
  { name: '(CA)n: an 80-base read inside a (CA)100 run', make: () => blockAndShortRead(0xca, 'CA'.repeat(100), 80, R), placed: true },
  { name: 'ACGT repeats: an 80-base read inside (ACGT)50', make: () => blockAndShortRead(0xac, 'ACGT'.repeat(50), 80, F), placed: true },
  { name: 'homopolymer: a 60-base read inside a 120-base poly-A run', make: () => blockAndShortRead(0xaa, 'A'.repeat(120), 60, R), placed: true },
  {
    name: 'homopolymer: a reverse read whose 50-base overlap is the poly-A run that ends the others',
    placed: true,
    make: () => {
      const bases = Array.from(randomDna(rng(0x9a), 1400));
      for (let p = 950; p < 1000; p++) bases[p] = 'A';
      [947, 948, 949, 1000, 1001, 1002].forEach((p, k) => { bases[p] = 'CGTCGT'[k]; });
      const template = bases.join('');
      return { template, reads: fourForwardAndProbe(template, template.slice(950)) };
    },
  },
  {
    name: 'N runs: eight reads, each with a 100-base N run inside the 600-base overlap',
    placed: true,
    make: () => {
      const template = randomDna(rng(0x4e), 1400);
      const reads = Array.from({ length: 8 }, (_, k) => {
        const [from, to] = k % 2 === 0 ? [1, 1000] : [401, 1400];
        const n0 = 401 + 75 * k;
        const s = Array.from(template.slice(from - 1, to), (b, i) => (from + i >= n0 && from + i < n0 + 100 ? 'N' : b)).join('');
        return q40(`read${k}`, k % 2 === 0 ? s : reverseComplement(s));
      });
      return { template, reads };
    },
  },
  { name: 'N runs: 20 Ns and 8 substitutions in a 100-base overlap is 72 of 80 called bases, placed', make: () => nProbe(8), placed: true },
  { name: 'N runs: 20 Ns and 9 substitutions in a 100-base overlap is 71 of 80 called bases, left out', make: () => nProbe(9), placed: false },
  {
    name: 'N runs: a read of 60 called bases exactly inside the others and 140 Ns, though a 93% copy of the 60 ends the others',
    placed: true,
    span: 1000,
    make: () => {
      const bases = Array.from(randomDna(rng(0xd1), 1400));
      for (let k = 0; k < 60; k++) bases[940 + k] = k % 15 === 7 ? 'ACGT'[('ACGT'.indexOf(bases[500 + k]) + 1) % 4] : bases[500 + k];
      const template = bases.join('');
      const reads = [0, 1, 2, 3].map((i) => q40(`fwd${i}`, template.slice(0, 1000))).concat(q40('probe', template.slice(500, 560) + 'N'.repeat(140)));
      return { template, reads };
    },
  },
];

/**
 * A reverse read overlapping four forward reads over 1-1,000 by `draft` amplicon bases, with one
 * base inserted after its 25th overlap base or its 25th overlap base deleted: 49 draft bases and
 * 50 read bases, and so on. Wrong implementations, and the case that catches each: the overlap
 * counted on the read only (49 draft bases + 1 inserted, placed); on the draft only (50 draft
 * bases with 1 deleted, placed); a gap column that blocks placement (50 + 1 and 51 - 1, left out).
 */
/**
 * Four forward reads over 1-900 and four longer reverse reads over 401-1,400 of one amplicon (the
 * first seed), read 0 lacking 3 bases and read 1 carrying 2 extra; `sense` holds each read on the
 * amplicon's strand.
 */
function longReverseReads() {
  const { template, reads: given, undecided } = ampliconReads(SEEDS[0], [1, 900], [401, 1400]);
  expect(undecided, 'the fixture leaves no position undecided').toEqual([]);
  const sense = given.map((d, k) => (k % 2 === 0 ? d.sequence : reverseComplement(d.sequence)));
  sense[0] = sense[0].slice(0, 449) + sense[0].slice(452);
  sense[1] = sense[1].slice(0, 300) + otherThan(sense[1][299], sense[1][300]).repeat(2) + sense[1].slice(300);
  const reads = sense.map((s, k) => q40(`read${k}`, k % 2 === 0 ? s : reverseComplement(s)));
  return { template, sense, reads };
}

/** The saved contig's note on its orientation: the first line of its notes. */
const orientationNote = (doc: SequenceDocument) => String(doc.docMetadata?.Notes ?? '').split('\n')[0];

/** What that note says when the contig follows the read `name`. */
const orientation = (name: string) =>
  `Orientation: the contig reads along ${name}, the first read listed whose strand on the layout is known; reads on the other strand are reverse-complemented onto it.`;

const TWO_SIDED_CASES = [
  { draft: 49, edit: 'insert', placed: false, edge: '49 draft bases and 50 read bases (1 inserted) is left out' },
  { draft: 50, edit: 'delete', placed: false, edge: '50 draft bases and 49 read bases (1 deleted) is left out' },
  { draft: 50, edit: 'insert', placed: true, edge: '50 draft bases and 51 read bases (1 inserted) is placed' },
  { draft: 51, edit: 'delete', placed: true, edge: '51 draft bases and 50 read bases (1 deleted) is placed' },
] as const;

describe('BG-01M6TD2N contig layout across repeats, low-complexity and N overlaps', () => {
  it.each(TANDEM_CASES)('never silently collapses a tandem repeat that holds the overlap: $name', ({ seed, unit, copies, at, spans, assembled }) => {
    const { r, template, from, to } = tandemAmplicon(seed, unit, copies, at);
    const { reads, undecided } = noisyReads(r, template, spans);
    for (const [group, positions] of Object.entries(undecided)) {
      expect(positions.length, `the ${group} reads leave at most 2 positions undecided (${positions.join(', ')})`).toBeLessThanOrEqual(2);
    }
    const { html, saved } = assemble(reads);
    const warned = contigWarnings(html) ?? [];
    const named = warned.filter((w) => w.includes('tandem repeat'));
    const inContig = readRows(html).map(([name]) => name);
    if (named.length === 0) {
      // Assembled: the amplicon's exact length within 2 edits, from every read, with nothing to say.
      expect(saved.sequence.length, 'the contig is the amplicon\'s length').toBe(template.length);
      expect(editAlignment(saved.sequence, template).distance, 'edits between the contig and the amplicon').toBeLessThanOrEqual(2);
      expect(consensusKpi(html)).toBe('1,400 bp (8 reads)');
      expect(warned).toEqual([]);
    } else {
      // Left out and named: the reads not in the contig are the ones the warning names, it names
      // the repeat by its unit and where it lies in the contig, and the contig is a stretch of the
      // amplicon within 2 edits, so no copy is lost inside it.
      expect(named).toHaveLength(1);
      const m = /^Reads? (.+?) overlaps? the other reads only inside a tandem repeat of a ([\d,]+)-bp unit \(contig bases ([\d,]+)-([\d,]+)\)/.exec(named[0]);
      expect(m, named[0]).not.toBeNull();
      const [names, unitSaid, a, b] = [m![1].split(', '), Number(m![2]), Number(m![3].replace(/,/g, '')), Number(m![4].replace(/,/g, ''))];
      expect(unitSaid, 'the repeat\'s unit').toBe(unit);
      expect([...names, ...inContig].sort(), 'every read is in the contig or named').toEqual(reads.map((d) => d.name).sort());
      expect(names.length, 'reads were left out').toBeGreaterThan(0);
      const { distance, start } = stretchEdits(saved.sequence, template);
      expect(distance, 'edits between the contig and the stretch of the amplicon it covers').toBeLessThanOrEqual(2);
      // The named bases lie in the repeat (within 2 bases, for a substitution at its edge) and hold a whole unit.
      expect(start + a, 'the named range starts in the repeat').toBeGreaterThanOrEqual(from - 2);
      expect(start + b, 'the named range ends in the repeat').toBeLessThanOrEqual(to + 2);
      expect(b - a + 1, 'the named range holds a whole unit').toBeGreaterThanOrEqual(unit);
      expect(savedWarnings(saved)).toEqual(warned);
    }
    expect(named.length === 0, 'the outcome this layout gives').toBe(assembled);
  });

  it.each(LOW_COMPLEXITY_CASES)('places low-complexity and N-holding overlaps by the 90% rule: $name', (c) => {
    const { make, placed } = c;
    const { template, reads } = make();
    const { html, saved } = assemble(reads);
    const n = reads.length;
    if (placed) {
      // The contig the reads span: the amplicon, or its first `span` bases.
      const contig = template.slice(0, (c as { span?: number }).span);
      expect(consensusKpi(html)).toBe(`${contig.length.toLocaleString('en-US')} bp (${n} reads)`);
      expect(contigWarnings(html), 'every read was placed, so nothing is warned').toBeNull();
      expect(readRows(html).map(([name]) => name).sort()).toEqual(reads.map((d) => d.name).sort());
      expect(saved.sequence, 'the reads outvote each read\'s Ns').toBe(contig);
    } else {
      expect(consensusKpi(html)).toBe(`1,000 bp (${n - 1} of ${n} reads)`);
      expect(contigWarnings(html)).toEqual([leftOutProbe]);
      expect(saved.sequence).toBe(template.slice(0, 1000));
    }
  });

  it.each(TWO_SIDED_CASES)('counts the 50-base overlap on both the draft and the read: $edge', ({ draft, edit, placed }) => {
    const template = randomDna(rng(0x2b5), 1400);
    const s = template.slice(1000 - draft);
    const probe = edit === 'insert' ? s.slice(0, 25) + otherThan(s[24], s[25]) + s.slice(25) : s.slice(0, 24) + s.slice(25);
    const { html, saved } = assemble(fourForwardAndProbe(template, probe));
    if (placed) {
      expect(consensusKpi(html)).toBe('1,400 bp (5 reads)');
      expect(contigWarnings(html)).toBeNull();
      expect(saved.sequence, 'four reads outvote the probe\'s edit in the overlap').toBe(template);
    } else {
      expect(consensusKpi(html)).toBe('1,000 bp (4 of 5 reads)');
      expect(contigWarnings(html)).toEqual([leftOutProbe]);
      expect(savedWarnings(saved)).toEqual([leftOutProbe]);
      expect(saved.sequence).toBe(template.slice(0, 1000));
    }
  });

  /**
   * Four forward reads over 1-900 and four reverse reads over 401-1,400, so the reverse reads are
   * the longest and the old layout grew from one of them: the saved contig was the amplicon's
   * reverse complement. Read 0 also lacks 3 bases and read 1 carries 2 extra, so a read's identity
   * counts its gap columns. Wrong implementations, and what catches each: the contig on the
   * longest read's strand (the sequence, the strands); identity over the whole consensus (a
   * 900-base read on a 1,400 bp contig, about 64%); over its aligned bases only (the read lacking 3
   * bases, whose 3 missing columns would not count); its inserted bases left out (the read with 2
   * extra). The expected
   * identities come from an alignment written here, of each read to the amplicon's bases it covers.
   * The saved contig's notes say which read it follows: read 0, the first listed.
   */
  it('keeps the forward orientation and reports identity over each read\'s span: reverse reads the longest', () => {
    const { template, sense, reads } = longReverseReads();
    expect(reads[1].sequence.length, 'a reverse read is the longest').toBeGreaterThan(reads[0].sequence.length);
    const { html, saved } = assemble(reads);
    expect(consensusKpi(html)).toBe('1,400 bp (8 reads)');
    expect(contigWarnings(html)).toBeNull();
    expect(saved.sequence, 'the saved contig reads along the forward reads').toBe(template);
    expect(orientationNote(saved)).toBe(orientation('read0.ab1'));
    expect(kpi(html, 'Strand Orientation')).toBe('4 Fwd / 4 Auto-RevComp');
    const rows = rowCells(html);
    expect(rows.map((c) => `${c[0]} ${c[1]}`).sort(), 'each read\'s strand on the contig')
      .toEqual(reads.map((d, k) => `${d.name} ${k % 2 === 0 ? 'Forward (+)' : 'Auto-RevComp (-)'}`).sort());
    const expected = new Map(sense.map((s, k) => {
      const span = k % 2 === 0 ? template.slice(0, 900) : template.slice(400);
      const { distance, at } = editAlignment(s, span);
      const matches = at.filter((c, p) => c === span[p]).length;
      const dropped = at.filter((c) => c === '-').length;
      const substituted = at.length - matches - dropped;
      const columns = span.length + (distance - substituted - dropped);
      return [reads[k].name, Math.round((matches / columns) * 10000) / 100];
    }));
    for (const c of rows) expect(c[4], `${c[0]}'s identity over its span`).toBe(`${expected.get(c[0])!.toFixed(1)}%`);
    const mean = Math.round((rows.reduce((sum, c) => sum + expected.get(c[0])!, 0) / rows.length) * 10) / 10;
    expect(kpi(html, 'Mean Depth &amp; Identity')).toMatch(new RegExp(` ${mean.toFixed(1).replace('.', '\\.')}%$`));
    expect(saved.alignmentMeta?.pairwiseIdentityPct).toBe(mean);
  });

  /**
   * Traces carry no strand of their own, so the contig follows the first read listed whose strand
   * on the layout is known. The same reads with reverse read 1 listed first give the amplicon's
   * reverse complement, every read's strand turned, and notes that name read 1. Wrong
   * implementations, and what catches each: a note naming a fixed or the longest read, or none
   * (the note); the contig kept forward while the note names a reverse read (the sequence).
   */
  it('keeps the forward orientation and reports identity over each read\'s span: a reverse read listed first, which the contig then follows and its notes name', () => {
    const { template, reads } = longReverseReads();
    const listed = [reads[1], reads[0], ...reads.slice(2)];
    const { html, saved } = assemble(listed);
    expect(consensusKpi(html)).toBe('1,400 bp (8 reads)');
    expect(contigWarnings(html)).toBeNull();
    expect(saved.sequence, 'the saved contig reads along read 1').toBe(reverseComplement(template));
    expect(orientationNote(saved)).toBe(orientation('read1.ab1'));
    expect(rowCells(html).map((c) => `${c[0]} ${c[1]}`).sort(), 'each read\'s strand on the contig')
      .toEqual(reads.map((d, k) => `${d.name} ${k % 2 === 1 ? 'Forward (+)' : 'Auto-RevComp (-)'}`).sort());
  });

  /**
   * A read is left out as fitting in more than one place only when the other place fits it about
   * as well (at most 2 more errors). Here the probe, amplicon bases 501-630, lies exactly inside
   * the four reads over 1-1,000, whose last 100 bases are a copy of bases 501-600 with 6 of them
   * substituted: placed there, at 94%, the probe would run 30 bases past the reads. Wrong
   * implementation, and what catches it: a second place counted however many more errors it has
   * (the probe left out, as if its place could not be told).
   */
  it('places a read in its one exact place though a 94% copy at the end of the others also fits it', () => {
    const bases = Array.from(randomDna(rng(0xd1), 1400));
    for (let k = 0; k < 100; k++) bases[900 + k] = k % 16 === 8 ? 'ACGT'[('ACGT'.indexOf(bases[500 + k]) + 1) % 4] : bases[500 + k];
    const template = bases.join('');
    const reads = [0, 1, 2, 3].map((i) => q40(`fwd${i}`, template.slice(0, 1000))).concat(q40('probe', template.slice(500, 630)));
    const { html, saved } = assemble(reads);
    expect(consensusKpi(html)).toBe('1,000 bp (5 reads)');
    expect(contigWarnings(html)).toBeNull();
    expect(saved.sequence).toBe(template.slice(0, 1000));
  });
});

// ─── BG-01M6TD2N round 2: self-complementary repeats, called overlap bases ───

/** A 1,400 bp amplicon of random flanks around `block` from base `at` (1-based); the generator goes on to draw the reads. */
function blockAmplicon(seed: number, block: string, at: number) {
  const r = rng(seed);
  const left = randomDna(r, at - 1);
  const right = randomDna(r, 1400 - (at - 1) - block.length);
  return { r, template: left + block + right };
}

const REPLICATES: [number, number, boolean][] = [[1, 1000, F], [1, 990, F], [1, 980, F], [1, 970, F]];

/**
 * Reads ending in a self-complementary tandem repeat: turned round, such a read runs off the
 * draft's end inside the repeat, and that placement on the other strand left every replicate but
 * the seed out ("1,000 bp (1 of 4 reads)", the contig one read's raw calls). Each case gives the
 * reads that must be kept (`kept`, by index), the repeat's unit, and whether nothing may be warned.
 * Every other read is in the contig or named; every sentence of a read that fits in more than one
 * place names a tandem repeat of that unit, never "a repeat"; the notes name the read the contig
 * follows, the first listed that is placed or named so; and the contig, on the amplicon's strand,
 * is within 2 edits of a stretch of it by the edit distance written here. Wrong implementations,
 * and what catches each: every other-strand placement a rival (the (AT)60 and (ACGT)100 cases);
 * the discount on the other strand only (the two (CA)60s, whose rivals lie on the replicates' own
 * strand); a same-placement window of 40 bases for 2 (the (CA)150 cases: the forward and reverse
 * reads overlap by 41 bases, under the 50-base rule, and every overlap that places a forward read
 * lies a unit or more off inside the repeat; with the wider window they joined silently, 1,374
 * and 1,362 bp, 27 and 38 edits from a stretch, and the (AT)60 shape joined all 8 reads too). A best
 * fixed by bases it matches only by chance is pinned natively, over more seeds
 * (crates/molbiocraft-align/tests/sanger_contig_layout.rs).
 */
const SELF_COMPLEMENTARY_CASES = [
  {
    name: 'an (AT)60 at 901-1,020 and four forward replicates over 1-1,000, 990, 980 and 970',
    make: () => blockAmplicon(1, 'AT'.repeat(60), 901), spans: REPLICATES, kept: [0, 1, 2, 3], unit: 2, quiet: true,
  },
  {
    name: 'the overlap inside an (AT)60 at 901-1,020, forward reads 1-1,000 and reverse reads 961-1,400',
    make: () => blockAmplicon(1, 'AT'.repeat(60), 901), spans: alternate([[1, 1000], [1, 1000], [1, 1000], [1, 1000]], [[961, 1400], [961, 1400], [961, 1400], [961, 1400]]),
    kept: [0, 2, 4, 6], unit: 2, quiet: false,
  },
  {
    name: 'the overlap inside an (ACGT)100 at 601-1,000, forward reads 1-750 and reverse reads 651-1,400',
    make: () => blockAmplicon(1, 'ACGT'.repeat(100), 601), spans: alternate([[1, 750], [1, 750], [1, 750], [1, 750]], [[651, 1400], [651, 1400], [651, 1400], [651, 1400]]),
    kept: [0, 2, 4, 6], unit: 4, quiet: false,
  },
  {
    name: 'four forward replicates that start in a (CA)60 and end in another at 901-1,020',
    make: () => {
      const r = rng(1);
      const template = 'CA'.repeat(60) + randomDna(r, 780) + 'CA'.repeat(60) + randomDna(r, 380);
      return { r, template };
    },
    spans: REPLICATES, kept: [0, 1, 2, 3], unit: 2, quiet: true,
  },
  ...[58, 70].map((h) => ({
    name: `a (CA)150 ending ${h} bases into reverse reads over 560-1,400, forward reads over 1-600`,
    make: () => blockAmplicon(1, 'CA'.repeat(150), 560 + h - 300),
    spans: alternate([[1, 600], [1, 600], [1, 600], [1, 600]], [[560, 1400], [560, 1400], [560, 1400], [560, 1400]]),
    kept: [] as number[], unit: 2, quiet: false,
  })),
];

/**
 * A read is placed only on at least 50 called overlap bases (a column with an N on either side
 * counts on neither). A foreign read of 42 Ns, then the draft's last 8 bases, then 400 bases of
 * its own shares one 8-mer with the draft, so its one candidate place is the 50-column overlap of
 * 8 called bases; counting the N columns placed it there and appended its 400 bases ("1,400 bp (5
 * reads)", no warning). With 20 Ns among its overlap bases 11-30, a reverse read overlapping by 70
 * bases (50 called) is placed, by 69 (49 called) left out. Wrong implementations, and what catches
 * each: N columns counted toward the 50 (the foreign read, the 69-base overlap); more than 50
 * called bases asked for (the 70-base overlap).
 */
const CALLED_BASE_CASES = [
  {
    name: 'a foreign read of 42 Ns, the draft\'s last 8 bases and 400 bases of its own, left out',
    placed: false,
    make: () => {
      const r = rng(34);
      const template = randomDna(r, 1400);
      const probe = 'N'.repeat(42) + template.slice(992, 1000) + randomDna(r, 400);
      const kmers = (s: string) => new Set(Array.from({ length: s.length - 7 }, (_, i) => s.slice(i, i + 8)).filter((k) => !k.includes('N')));
      const draft = kmers(template.slice(0, 1000));
      expect([...kmers(probe)].filter((k) => draft.has(k)), 'the foreign read\'s one seed is the draft\'s last 8 bases').toEqual([template.slice(992, 1000)]);
      return { template, reads: fourForwardAndProbe(template, probe) };
    },
  },
  ...[[70, true], [69, false]].map(([overlap, placed]) => ({
    name: `an overlap of ${overlap} bases with 20 Ns, ${Number(overlap) - 20} called, ${placed ? 'placed' : 'left out'}`,
    placed: Boolean(placed),
    make: () => {
      const template = randomDna(rng(0x5ee0), 1400);
      const probe = Array.from(template.slice(1000 - Number(overlap)), (b, k) => (k >= 10 && k < 30 ? 'N' : b)).join('');
      return { template, reads: fourForwardAndProbe(template, probe) };
    },
  })),
];

describe('BG-01M6TD2N self-complementary repeats and called overlap bases', () => {
  it.each(SELF_COMPLEMENTARY_CASES)('keeps replicates that end in a self-complementary repeat and places reads only on called overlap bases: $name', ({ make, spans, kept, unit, quiet }) => {
    const { r, template } = make();
    const { reads, undecided } = noisyReads(r, template, spans);
    for (const [group, positions] of Object.entries(undecided)) {
      expect(positions.length, `the ${group} reads leave at most 2 positions undecided (${positions.join(', ')})`).toBeLessThanOrEqual(2);
    }
    const { html, saved } = assemble(reads);
    const warned = contigWarnings(html) ?? [];
    const inContig = new Set(readRows(html).map(([name]) => name));
    const name = (i: number) => reads[i].name;
    for (const i of kept) expect(inContig.has(name(i)), `${name(i)} is kept; ${warned.join(' | ')}`).toBe(true);
    for (const d of reads.filter((x) => !inContig.has(x.name))) {
      expect(warned.some((w) => w.includes(d.name)), `${d.name} is named`).toBe(true);
    }
    const repeats = warned.filter((w) => w.includes('fits in more than one place'));
    for (const w of repeats) expect(w).toContain(`inside a tandem repeat of a ${unit}-bp unit (`);
    if (quiet) {
      expect(warned).toEqual([]);
      expect(consensusKpi(html)).toBe(`1,000 bp (${reads.length} reads)`);
    } else {
      expect(inContig.size, 'reads were left out').toBeLessThan(reads.length);
      expect(repeats.length, 'the repeat is named').toBeGreaterThan(0);
      expect(savedWarnings(saved)).toEqual(warned);
    }
    const follows = reads.findIndex((d) => inContig.has(d.name) || repeats.some((w) => w.includes(d.name)));
    expect(orientationNote(saved)).toBe(orientation(name(follows)));
    const contig = spans[follows][2] ? saved.sequence : reverseComplement(saved.sequence);
    expect(stretchEdits(contig, template).distance, 'edits between the contig and the stretch of the amplicon it covers').toBeLessThanOrEqual(2);
  });

  it.each(CALLED_BASE_CASES)('keeps replicates that end in a self-complementary repeat and places reads only on called overlap bases: $name', ({ make, placed }) => {
    const { template, reads } = make();
    const { html, saved } = assemble(reads);
    if (placed) {
      expect(consensusKpi(html)).toBe('1,400 bp (5 reads)');
      expect(contigWarnings(html)).toBeNull();
      expect(saved.sequence).toBe(template);
    } else {
      expect(consensusKpi(html)).toBe('1,000 bp (4 of 5 reads)');
      expect(contigWarnings(html)).toEqual([leftOutProbe]);
      expect(savedWarnings(saved)).toEqual([leftOutProbe]);
      expect(saved.sequence).toBe(template.slice(0, 1000));
    }
  });
});
