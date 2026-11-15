// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVAS: Find CRISPR Sites searched the whole record and nothing else, so the span Adaeze had
 * selected could not be searched - a 100-bp window inside a plasmid meant scanning the plasmid, and
 * every seed count was a count over the whole of it.
 *
 * AC1 is the offer: the whole sequence or the interval on screen, with that interval's own 1-based
 * bounds, and a selection the engine cannot search named rather than quietly widened or emptied.
 * AC4 is the report: what was searched, how long it is, how long the whole sequence is, whether any
 * base outside the interval was read, and a seed-match sentence that says the counts cover the
 * searched range alone.
 *
 * Every number here comes from the real WASM engine through the studio's own `scanCrisprGuides`
 * call; nothing is mocked and no count is written into a fixture by hand. The studio is rendered on
 * the server, as the other studio tests render it, and its markup is read as text.
 *
 * Wrong implementations these catch:
 * - the interval offered but never searched (the callout then reads "all 300 bases of this linear
 *   sequence", which the AC4 cases forbid);
 * - an interval scan printed in the words of a bounded prefix scan ("bases 1 to 100 of the 300"),
 *   which is what `scannedLengthBp < sequenceLengthBp` meant before this story;
 * - the seed-match sentence left claiming the whole sequence while the scan counted an interval (an
 *   interval specificity read as a sequence-wide one);
 * - a selection outside the sequence, reversed on a linear record, or shorter than the nuclease's
 *   site span, read as the whole sequence or as an empty interval instead of being named;
 * - an interval offered when there is no selection at all;
 * - an origin-crossing selection measured as `end - start` (the circular case is 161 bp, not a
 *   negative or a 240-bp span - BG-01M7CG2W);
 * - the bases of PAM context read outside the interval left unsaid.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrimerAndPCRStudio } from '../components/PrimerAndPCRStudio';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

/** Seeded pseudo-random DNA (LCG), so every run reads the same bases. */
function randomDna(length: number, seed: number): string {
  let x = seed >>> 0;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = 'ACGT'[x >>> 30];
  }
  return out.join('');
}

const dnaDoc = (
  id: string,
  sequence: string,
  topology: 'linear' | 'circular' = 'linear'
): SequenceDocument => ({
  ...EMPTY_WORKSPACE_DOCUMENT,
  id,
  name: id,
  sequence,
  topology,
});

/** The text a reader sees: tags and comments stripped, entities decoded, runs of space collapsed. */
const text = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ');

/** The CRISPR tab of the studio, rendered on `doc` with the selection the App holds (or none). */
const crisprTab = (doc: SequenceDocument, selectedRange?: { start: number; end: number } | null) =>
  renderToStaticMarkup(
    <PrimerAndPCRStudio
      doc={doc}
      allDocuments={[doc]}
      onUpdateDocument={() => undefined}
      onAddConstruct={() => undefined}
      initialSubTab="crispr"
      selectedRange={selectedRange ?? null}
    />
  );

/** The scopes the search-range chooser offers, in order, as `value` and the words beside it. */
const rangeOptions = (html: string): { value: string; label: string }[] => {
  const select = /<select[^>]*aria-label="Search range:"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (!select) return [];
  return [...select[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)].map((m) => ({
    value: m[1],
    label: text(m[2]).trim(),
  }));
};

/** What the chooser says about a selection it does not offer as an interval, or '' where it says nothing. */
const rangeNote = (html: string) => {
  const m = /<span[^>]*data-crispr-range-note[^>]*>([\s\S]*?)<\/span>/.exec(html);
  return m ? text(m[1]).trim() : '';
};

/** The info callout above the guide table, as a reader reads it. */
const callout = (html: string) => {
  const m = /<div class="info-callout">([\s\S]*?)<\/div>/.exec(html);
  return m ? text(m[1]).trim() : '';
};

/** Every sentence of the shared warnings region (ResultWarnings) for the guide scan. */
const warnings = (html: string) =>
  [...html.matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) =>
    text(p[1]).trim()
  );

const linear300 = dnaDoc('Crispr_Interval_Linear', randomDna(300, 0x15_7a01));
const circular400 = dnaDoc('Crispr_Interval_Circular', randomDna(400, 0x15_7b02), 'circular');

describe('US-01M7DVAS AC1: Find CRISPR Sites offers the whole sequence or the interval on screen', () => {
  it('offers both scopes, naming the selected interval by its own 1-based bounds', () => {
    const html = crisprTab(linear300, { start: 101, end: 200 });
    const options = rangeOptions(html);
    expect(options.map((o) => o.value)).toEqual(['interval', 'whole']);
    const [interval, whole] = options;
    expect(interval.label).toContain('101..200');
    expect(interval.label).toContain('100 bp');
    expect(whole.label).toContain('300 bp');
    expect(rangeNote(html)).toBe('');
  });

  it('names an origin-crossing selection as the interval it is, counting both sides of the origin', () => {
    const html = crisprTab(circular400, { start: 380, end: 140 });
    const interval = rangeOptions(html).find((o) => o.value === 'interval');
    expect(interval).toBeDefined();
    // 400 - 380 + 1 + 140 = 161 bases, not 140 - 380.
    expect(interval!.label).toContain('380..140');
    expect(interval!.label).toContain('161 bp');
    expect(interval!.label).toContain('across the origin');
  });

  it('offers only the whole sequence when there is no selection, and says so', () => {
    const html = crisprTab(linear300, null);
    expect(rangeOptions(html).map((o) => o.value)).toEqual(['whole']);
    const note = rangeNote(html);
    expect(note).toMatch(/no (bases are selected|selection)/i);
    // The scan that ran is the whole sequence, said as it always was.
    expect(callout(html)).toContain('all 300 bases of this linear sequence');
    expect(callout(html)).not.toContain('interval');
  });

  it('never reads a selection outside the sequence as the whole sequence or as an empty interval', () => {
    const outside = crisprTab(linear300, { start: 280, end: 400 });
    expect(rangeOptions(outside).map((o) => o.value)).toEqual(['whole']);
    const note = rangeNote(outside);
    expect(note).toContain('280..400');
    expect(note).toContain('300');
    expect(note).toMatch(/not (inside|offered)/i);
    // A whole-sequence scan ran, and the callout says that is what it was.
    expect(callout(outside)).toContain('all 300 bases of this linear sequence');

    // Reversed on a linear record: an interval across the origin, which a line has not.
    const reversed = crisprTab(linear300, { start: 200, end: 101 });
    expect(rangeOptions(reversed).map((o) => o.value)).toEqual(['whole']);
    expect(rangeNote(reversed)).toContain('200..101');
    expect(rangeNote(reversed)).toMatch(/linear|origin/i);
  });

  it('never offers a selection shorter than the nuclease site it would be searched for', () => {
    const html = crisprTab(linear300, { start: 10, end: 20 });
    expect(rangeOptions(html).map((o) => o.value)).toEqual(['whole']);
    const note = rangeNote(html);
    expect(note).toContain('10..20');
    expect(note).toContain('11 bp');
    expect(note).toContain('23');
  });
});

describe('US-01M7DVAS AC4: the scan report names the interval searched, never the whole sequence', () => {
  it('names the interval, its length, the sequence length and the context read outside it', () => {
    const html = crisprTab(linear300, { start: 101, end: 200 });
    const said = callout(html);
    expect(said).toContain('101..200');
    expect(said).toContain('100 bp');
    expect(said).toContain('300 bases');
    // An interval scan is never presented as a scan of the whole sequence, nor in the words of a
    // bounded prefix scan.
    expect(said).not.toContain('all 300 bases of this linear sequence');
    expect(said).not.toContain('bases 1 to 100');
    // Whether context outside the interval was read: 3 bases either side of a 23-bp SpCas9 site.
    expect(said).toContain('6 bases outside the interval');
    // The seed counts cover the searched range alone - an interval specificity.
    expect(said).toMatch(/seed[\s\S]*interval searched/i);
    expect(said).toContain('no copy outside it');
    // The engine's own sentence says the same, in the warnings region the tab shares.
    expect(warnings(html).join(' | ')).toMatch(/bases 101\.\.200 — the 100 bp interval asked for/);
  });

  it('says an origin-crossing interval runs across the origin, with both sides counted', () => {
    const html = crisprTab(circular400, { start: 380, end: 140 });
    const said = callout(html);
    expect(said).toContain('380..140');
    expect(said).toContain('161 bp');
    expect(said).toContain('across the origin');
    expect(said).toContain('400 bases');
    expect(said).not.toContain('all 400 bases of this circular sequence');
  });

  it('keeps the whole-sequence wording, and claims no interval, when the whole sequence was searched', () => {
    const said = callout(crisprTab(circular400, null));
    expect(said).toContain('all 400 bases of this circular sequence');
    expect(said).toContain('across its origin');
    expect(said).not.toContain('interval');
  });
});
