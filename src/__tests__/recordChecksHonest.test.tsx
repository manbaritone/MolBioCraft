// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1B3: the record bar's status says what the record checks found, or that they did not
 * run. A record whose checks did not run (DNA over 50,000 bp for the scan-based checks, a record
 * with no bases, a protein) shows no OK badge and no all-clear text; a record whose checks all ran
 * and found nothing still shows OK.
 *
 * Every case renders the real record bar over the real engine's table metrics.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SequenceDocument, SequenceFeature } from '../types/bio';
import { DocumentRecordBar } from '../components/DocumentRecordBar';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  computeDocumentTableMetrics,
  exportDelimitedTableViaRust,
  getDocumentColumnDisplayValue,
  recordCheckVerdict,
  sortDocumentsByColumn,
} from '../core/workbenchBatchOperations';

/** A reproducible pseudo-random sequence over `alphabet` (mulberry32, fixed seed). */
function randomFrom(length: number, seed: number, alphabet: string): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out += alphabet[((t ^ (t >>> 14)) >>> 0) % alphabet.length];
  }
  return out;
}

/** A reproducible pseudo-random DNA sequence (mulberry32, fixed seed). */
const randomDna = (length: number, seed: number) => randomFrom(length, seed, 'ACGT');

/** A 5 kb tail of A and T holding one Dam-blocked BclI site (TGATCA) at base 2,500. */
const atTailWithBclI = () => {
  const tail = randomFrom(5_000, 0xa7a7, 'AT');
  return `${tail.slice(0, 2_499)}TGATCA${tail.slice(2_505)}`;
};

const cds = (id: string, start: number, end: number): SequenceFeature => ({
  id, name: id, type: 'CDS', start, end, strand: 1, color: '#000000',
});

const dnaDoc = (id: string, sequence: string, features: SequenceFeature[]): SequenceDocument => ({
  id, name: id, accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence, features,
  primers: [], history: [], createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', folder: 'Cloning',
});

const sample = (id: string): SequenceDocument => {
  const doc = SAMPLE_LIBRARY.find((d) => d.id === id);
  if (!doc) throw new Error(`the sample library no longer holds ${id}`);
  return doc;
};

/** The record bar's status as rendered: its icon classes, its words and its hover text. */
function statusOf(doc: SequenceDocument) {
  const html = renderToStaticMarkup(<DocumentRecordBar doc={doc} onShowTable={() => {}} />);
  const open = html.indexOf('<span class="mbc-record-bar-status"');
  expect(open, `${doc.id}: the bar shows a status`).toBeGreaterThanOrEqual(0);
  const end = html.indexOf('</p>', open);
  const status = html.slice(open, end);
  const title = /^<span class="mbc-record-bar-status" title="([^"]*)"/.exec(status)?.[1] ?? '';
  const words = /<span class="mbc-record-bar-status-text">([^<]*)<\/span>/.exec(status)?.[1] ?? '';
  const svgClasses = [...status.matchAll(/<svg[^>]*class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
  const svg = /<svg[\s\S]*?<\/svg>/.exec(status)?.[0] ?? '';
  return { title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"'), words, svgClasses, svg };
}

/** What an icon draws: its markup without its class names, which no reader sees. */
const drawing = (svg: string) => svg.replace(/\sclass="[^"]*"/g, '');

/** No pass icon, no "OK", and no hover or visible text that calls the checks clear or verified. */
function expectNoClearClaim(doc: SequenceDocument, how: string) {
  const s = statusOf(doc);
  expect(s.svgClasses, `${how}: no OK badge`).not.toContain('is-ok');
  expect(s.svgClasses, `${how}: the neutral not-run icon`).toContain('is-unchecked');
  expect(s.words, `${how}: no "OK"`).not.toMatch(/\bOK\b/);
  expect(`${s.words} ${s.title}`, `${how}: no all-clear text`).not.toMatch(/clear|verified/i);
  return s;
}

describe('the record bar never reads unrun checks as clear (BG-01M6S1B3)', () => {
  it('shows no OK badge when the checks did not run', () => {
    // DNA over 50,000 bp: the restriction scan the methylation and Type IIS checks need does not
    // run, the annotation checks do and find nothing here (the CDS is 1,002 bp, in frame).
    const long = dnaDoc('bac-60k', randomDna(60_000, 0xb1b3), [cds('cds-in-frame', 1_001, 2_002)]);
    const l = computeDocumentTableMetrics(long);
    expect(l.alertsCount, 'the fixture is a long record with no alert found').toBe(0);
    const ls = expectNoClearClaim(long, 'DNA over 50,000 bp');
    expect(ls.words).toBe('Partly checked');
    expect(ls.title, 'the skipped checks and why, on hover').toMatch(/methylation and Type IIS site checks/);
    expect(ls.title).toMatch(/50,000 bp/);

    // A record that holds no bases (a genome summary record), and a protein: no check ran.
    const genome = sample('doc-genome-ecoli-k12-mg1655');
    expect(genome.sequence, 'the genome record holds no bases').toBe('');
    expect(expectNoClearClaim(genome, 'a record with no bases').words).toBe('Not checked');
    expect(statusOf(genome).title).toMatch(/holds no bases/);
    const protein = sample('doc-prot-egfp-1ema');
    expect(expectNoClearClaim(protein, 'a protein').words).toBe('Not checked');
    expect(statusOf(protein).title).toMatch(/protein record/);

    // A record under 50,000 bp whose restriction scan stopped at its 12,000-site cap: 25 kb of
    // (GTCTC)n, two Type IIS sites a repeat, then an A/T tail whose Dam-blocked BclI site the scan
    // never reached. Its checks did not finish, so it is partly checked, not OK.
    const capped = dnaDoc('gtctc-25k-at-5k', 'GTCTC'.repeat(5_000) + atTailWithBclI(), []);
    const cs = expectNoClearClaim(capped, 'a scan stopped at its cap');
    expect(cs.words).toBe('Partly checked');
    expect(cs.title, 'why, on hover').toMatch(/restriction-site scan that stopped at its 12,000-site cap before the end of the record/);
    // The product review's 13 kb record (8 kb of (GCGC)n, then that tail), where the whole-catalogue
    // scan stopped inside the repeat: the checks read the whole record and find the blocked site.
    const thirteen = dnaDoc('gcgc-8k-at-5k', 'GCGC'.repeat(2_000) + atTailWithBclI(), []);
    const ts = statusOf(thirteen);
    expect([ts.svgClasses.includes('is-warn'), ts.words], 'the tail is checked').toEqual([true, '1 alert(s)']);
    expect(ts.title).toMatch(/^Methylation: 3 Restriction Site\(s\) Blocked by Dam\/Dcm Methylation/);
    // A 5 kb run of N holds no base the scan can read, so no check ran on it.
    const allN = dnaDoc('n-5k', 'N'.repeat(5_000), [cds('cds-out-of-frame', 1, 1_001)]);
    expect(expectNoClearClaim(allN, 'a run of N').words).toBe('Not checked');
    expect(statusOf(allN).title).toMatch(/holds no bases the checks can read/);

    // Partly checked and Not checked draw different icons, both in muted ink, so the bar tells
    // them apart without hovering.
    const partly = statusOf(long);
    const none = statusOf(protein);
    expect(partly.svgClasses, 'some checks ran').toContain('is-partial');
    expect(none.svgClasses, 'no check ran').toContain('is-not-run');
    expect(drawing(partly.svg), 'two different drawings').not.toBe(drawing(none.svg));
    expect([/<circle\b/.test(partly.svg), /<circle\b/.test(none.svg)], 'a dot inside the dashed ring where some checks ran, none where none did').toEqual([true, false]);
    for (const s of [partly, none, statusOf(capped), statusOf(allN)]) expect(s.svg).toMatch(/style="color:var\(--mbc-text-muted\)"/);
    expect(drawing(statusOf(capped).svg), 'a stopped scan reads as partly checked').toBe(drawing(partly.svg));
    expect(drawing(statusOf(allN).svg), 'a run of N reads as not checked').toBe(drawing(none.svg));

    // The controls: the same bar shows OK for a record whose checks all ran and found nothing,
    // and a warning that also names the skipped checks for a long record with an alert.
    const clean = dnaDoc('clean-short', 'ACGT'.repeat(300), [cds('cds-ok', 1, 300)]);
    const c = statusOf(clean);
    expect([c.svgClasses.includes('is-ok'), c.words], 'a record every check passed reads OK').toEqual([true, 'OK']);
    expect(c.title).toMatch(/nothing found/);
    const frameshift = { ...long, id: 'bac-60k-frameshift', features: [cds('cds-out-of-frame', 1_001, 2_001)] };
    const f = statusOf(frameshift);
    expect([f.svgClasses.includes('is-warn'), f.words], 'the reading-frame check runs on long DNA').toEqual([true, '1 alert(s)']);
    expect(f.title).toMatch(/Reading Frame: Non-Triplet Reading Frame Length in CDS "cds-out-of-frame"/);
    expect(f.title, 'the skipped checks are named beside the alert').toMatch(/Not run: the methylation and Type IIS site checks/);

    // A metrics reply that does not say how far the checks got (an older engine) is not clear.
    expect(recordCheckVerdict({ alertsCount: 0 })).toBe('not-run');
    expect(recordCheckVerdict({ alertsCount: 0, checksState: 'complete' })).toBe('clear');
  });

  it('exports and sorts the check state, never OK for checks that did not run', () => {
    // One record of each state: every check ran and passed, the scan-based checks skipped (60 kb),
    // no check ran (a protein, a record with no bases), and one and three alerts.
    const clean = dnaDoc('clean-short', 'ACGT'.repeat(300), [cds('cds-ok', 1, 300)]);
    const long = dnaDoc('bac-60k', randomDna(60_000, 0xb1b3), [cds('cds-in-frame', 1_001, 2_002)]);
    const protein = { ...dnaDoc('protein-record', 'MVSKGEELFTGVVPILVELDGDVNGHKFSV', []), moleculeType: 'Protein' as const };
    const noBases = dnaDoc('summary-record', '', [cds('cds-out-of-frame', 1, 1_001)]);
    const frameshift = { ...long, id: 'bac-60k-frameshift', name: 'bac-60k-frameshift', features: [cds('cds-out-of-frame', 1_001, 2_001)] };
    const puc19 = sample('doc-puc19');
    const status = (d: SequenceDocument) => getDocumentColumnDisplayValue(d, computeDocumentTableMetrics(d), 'status');
    expect(computeDocumentTableMetrics(puc19).alertsCount, 'pUC19 carries three alerts').toBe(3);
    expect([clean, long, protein, noBases, frameshift].map((d) => computeDocumentTableMetrics(d).alertsCount), 'four records with no alert, one with one')
      .toEqual([0, 0, 0, 0, 1]);

    // The table's own Status value is the check state, so a CSV or TSV of the table carries it.
    const records = [clean, long, protein, noBases, frameshift];
    const rows = records.map((d) => [d.name, status(d)]);
    const expected = ['OK', 'Partly checked', 'Not checked', 'Not checked', '1 alert(s)'];
    expect(rows.map((r) => r[1])).toEqual(expected);
    expect(status(puc19)).toBe('3 alert(s)');
    for (const delimiter of [',', '\t'] as const) {
      const sep = delimiter;
      const lines = exportDelimitedTableViaRust(['Name', 'Status'], rows, delimiter).trim().split(/\r?\n/);
      expect(lines, `${delimiter === ',' ? 'CSV' : 'TSV'} export`).toEqual([
        ['Name', 'Status'].join(sep),
        ...records.map((d, i) => [d.name, expected[i]].join(sep)),
      ]);
      expect(lines.filter((l) => l.split(sep)[1] === 'OK'), 'OK only for the record every check passed').toEqual([[clean.name, 'OK'].join(sep)]);
    }

    // Sorting by Status orders by check state: OK, partly checked, not checked, then alerts by
    // count; descending is the reverse. The input is shuffled so a sort on the alert count alone,
    // which ties every record with no alert, keeps the wrong order.
    const shuffled = [puc19, protein, frameshift, long, noBases, clean];
    const ascending = sortDocumentsByColumn(shuffled, 'status', 'asc', new Set()).map(status);
    expect(ascending).toEqual(['OK', 'Partly checked', 'Not checked', 'Not checked', '1 alert(s)', '3 alert(s)']);
    expect(sortDocumentsByColumn(shuffled, 'status', 'desc', new Set()).map(status)).toEqual([...ascending].reverse());
  });

  it('reports no mean coverage for a chromatogram nothing measured', () => {
    const read = sample('doc-sanger-ab1-fwd');
    expect(read.chromatogram?.phredScores.length, 'the fixture is a read with Phred scores').toBeGreaterThan(0);
    expect(read.alignmentMeta?.meanCoverageX, 'and no measured coverage').toBeUndefined();
    const m = computeDocumentTableMetrics(read);
    expect([m.meanCoverageX, m.meanCoverageLabel]).toEqual([null, '—']);
  });
});
