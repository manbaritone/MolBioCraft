// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S15R: the CRISPR tab of the Primer & PCR studio called its own list of 25 the answer — the
 * tab read "Find CRISPR Sites & Off-Targets (25 Guides)" on a 100 kb record with over thirteen
 * thousand candidates — and its callout said the seed matches were counted "in this sequence" even
 * when the scan had read only part of it.
 *
 * Every guide here comes from the real WASM engine, through the studio's own `findCrisprGuides`
 * call; nothing is mocked and no count is written into a fixture by hand. The sequences are
 * generated from fixed seeds, never committed. The studio is rendered on the server, as the other
 * studio tests render it, and the markup it returns is read as text.
 *
 * Wrong implementations this catches:
 * - the listed count passed off as the total (the 100 kb record has 13,000-odd candidates and lists
 *   25, so a label reading its own length says "25 Guides" and never "top 25 of 13,…");
 * - the total shown but the engine's `candidateCount` ignored, e.g. a length multiplied by a guess
 *   (the exact total is asserted against the engine's own reply);
 * - "in this sequence" kept for a scan that read less than the sequence (the 8,000,100-base record
 *   is longer than `GUIDE_SCAN_MAX_BP`, so its scan stops short and the callout must name the range
 *   it read);
 * - the range named on every record whether or not the scan was bounded (the 100 kb record is read
 *   whole, and its callout must not name a shorter range or raise a scan warning);
 * - the engine's warnings dropped, or shown in markup of the tab's own instead of `ResultWarnings`
 *   (they are read through the shared component's `data-mbc-result-warnings` region).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrimerAndPCRStudio } from '../components/PrimerAndPCRStudio';
import { findCrisprGuides } from '../core/bioEngine';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { CrisprGuideRecord, SequenceDocument } from '../types/bio';

/**
 * The scan facts the engine repeats on every guide record (BG-01M6S15R): the reply to
 * `find_crispr_guides` is the guide list alone, so each guide carries how many candidates were
 * found, the range read, and the scan's warnings. `src/types/bio.ts` does not yet name them.
 */
type ScannedGuide = CrisprGuideRecord & {
  candidateCount: number;
  scannedLengthBp: number;
  sequenceLengthBp: number;
  /** Whether the scan read the record as a circle, and the bases across its origin it then read. */
  scannedCircular: boolean;
  originSpanBp: number;
  warnings: string[];
};

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

const dnaDoc = (id: string, sequence: string): SequenceDocument => ({
  ...EMPTY_WORKSPACE_DOCUMENT,
  id,
  name: id,
  sequence,
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

/** Every warnings region in the markup (ResultWarnings): its accessible name and its sentences. */
const warningRegions = (html: string) =>
  [...html.matchAll(/(<div[^>]*data-mbc-result-warnings[^>]*>)([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => ({
    label: /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? '',
    sentences: [...m[2].matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) =>
      text(p[1]).trim()
    ),
  }));

/** The CRISPR tab of the studio, rendered on `doc`. */
const crisprTab = (doc: SequenceDocument) =>
  renderToStaticMarkup(
    <PrimerAndPCRStudio
      doc={doc}
      allDocuments={[doc]}
      onUpdateDocument={() => undefined}
      onAddConstruct={() => undefined}
      initialSubTab="crispr"
    />
  );

/** The label of the tab button that opens the CRISPR list. */
const tabLabel = (html: string) =>
  text(html)
    .match(/Find CRISPR Sites & Off-Targets \([^)]*\)/g)
    ?.join(' | ') ?? '';

/** The info callout above the guide table, as a reader reads it. */
const callout = (html: string) => {
  const m = /<div class="info-callout">([\s\S]*?)<\/div>/.exec(html);
  return m ? text(m[1]).trim() : '';
};

const fmt = (n: number) => n.toLocaleString('en-US');

/** 100 kb of random bases: thousands of candidate guides, read whole (it is far under the bound). */
const hundredKb = dnaDoc('Crispr_Cap_100kb', randomDna(100_000, 0x15_6e01));
/**
 * 100 bases past `GUIDE_SCAN_MAX_BP` (8,000,000), the largest range the engine reads exactly: the
 * only shape in which the shipped studio sees a scan that covered less than its sequence.
 */
const pastTheBound = dnaDoc('Crispr_Cap_8Mb', randomDna(8_000_100, 0x15_6e02));

describe('the CRISPR tab says how many guides there are and what was searched (BG-01M6S15R)', () => {
  it('shows the total number of candidate guides beside the listed 25', () => {
    // The engine's own reply, through the same call the studio makes.
    const guides = findCrisprGuides(hundredKb.sequence, 'SpCas9 (NGG)', 25) as ScannedGuide[];
    expect(guides).toHaveLength(25);
    const total = guides[0].candidateCount;
    expect(total, 'the fixture holds far more candidates than the 25 listed').toBeGreaterThan(10_000);
    expect(
      [guides[0].scannedLengthBp, guides[0].sequenceLengthBp],
      '100 kb is read whole'
    ).toEqual([100_000, 100_000]);

    const html = crisprTab(hundredKb);
    // The tab names both numbers, so its own length is never the total.
    expect(tabLabel(html)).toBe(`Find CRISPR Sites & Off-Targets (top 25 of ${fmt(total)} Guides)`);
    // And so does the callout, beside the table that lists the 25.
    expect(callout(html)).toContain(`Lists the 25 highest-scoring of the ${fmt(total)} candidate SpCas9 (NGG) guides found.`);
    expect(callout(html), 'a list of 25 is not called all of them').not.toMatch(/Lists all/);
    // The cap on the list is the engine's own sentence, shown with the result.
    expect(warningRegions(html)).toEqual([
      {
        label: 'CRISPR guide warnings',
        sentences: [
          `Guide list capped: it shows the 25 highest-scoring of the ${fmt(total)} candidate guides found.`,
        ],
      },
    ]);
    // 25 guides are listed: one row each, each with its own Annotate button.
    expect(
      html.match(/<button class="btn-secondary-sm">\+ Annotate<\/button>/g) ?? [],
      'a row per listed guide'
    ).toHaveLength(25);
  }, 55_000);

  it('names the scanned range in the CRISPR callout', () => {
    const guides = findCrisprGuides(pastTheBound.sequence, 'SpCas9 (NGG)', 25) as ScannedGuide[];
    expect(
      [guides[0].scannedLengthBp, guides[0].sequenceLengthBp],
      'the fixture is longer than the engine reads, so the scan is a partial one'
    ).toEqual([8_000_000, 8_000_100]);

    const html = crisprTab(pastTheBound);
    const shown = callout(html);
    expect(shown, 'the range read, not "in this sequence"').toContain(
      'other exact copies of the 12-nt PAM-proximal seed in bases 1 to 8,000,000 of the 8,000,100 bases of this sequence'
    );
    expect(shown, 'and it does not claim the whole sequence').not.toMatch(
      /seed in this sequence|across all [\d,]+ bases/
    );
    // The bound is the engine's own sentence too, beside the result.
    expect(warningRegions(html).map((r) => r.label)).toEqual(['CRISPR guide warnings']);
    expect(warningRegions(html)[0].sentences[0]).toBe(
      'Guides were searched for in bases 1 to 8,000,000 of the 8,000,100 bases of this sequence, on both strands, and seed matches counted there: a guide or a seed match outside that range is not in this result.'
    );

    // A sequence read whole says so instead, and raises no scan warning about its range.
    const whole = callout(crisprTab(hundredKb));
    expect(whole).toContain(
      'other exact copies of the 12-nt PAM-proximal seed across all 100,000 bases of this linear sequence, on both strands'
    );
    expect(whole).not.toMatch(/bases 1 to/);
    expect(
      warningRegions(crisprTab(hundredKb))[0].sentences.some((s) => s.includes('were searched for in bases')),
      'a scan that read everything does not warn that it read part'
    ).toBe(false);
  }, 55_000);

  it('calls a short list what it is, and says nothing of a range when no guide was found', () => {
    // Every candidate listed: no cap, no warning, and the total is not called a top-of.
    const tiny = dnaDoc('Crispr_Cap_tiny', `TTTT${'ATCGTACTGATCAGTCATGAAGG'}TTTT`);
    const listed = findCrisprGuides(tiny.sequence, 'SpCas9 (NGG)', 25);
    expect(listed).toHaveLength(1);
    const html = crisprTab(tiny);
    expect(tabLabel(html)).toBe('Find CRISPR Sites & Off-Targets (1 Guides)');
    expect(callout(html)).toContain('Lists all 1 candidate SpCas9 (NGG) guides found.');
    expect(warningRegions(html), 'nothing was cut, so nothing is warned about').toEqual([]);

    // No guide at all: the tab says so and claims no searched range, rather than reporting one it
    // never got from the engine.
    const noPam = dnaDoc('Crispr_Cap_nopam', 'ATATATATATATATATATATATATATATATATATAT');
    expect(findCrisprGuides(noPam.sequence, 'SpCas9 (NGG)', 25)).toEqual([]);
    const none = crisprTab(noPam);
    expect(tabLabel(none)).toBe('Find CRISPR Sites & Off-Targets (0 Guides)');
    expect(callout(none)).toContain('No SpCas9 (NGG) guide in this sequence.');
    expect(callout(none)).not.toMatch(/bases of this sequence|Lists/);
    expect(warningRegions(none)).toEqual([]);
  });
});

/**
 * BG-01M6T6GQ: the same tab claimed every base of both strands on a circular record and read the
 * sequence as a straight string, so the guides whose site straddles the origin — up to 22 start
 * positions per strand — were missing from a list that called itself complete.
 *
 * The document's own topology now goes to the engine with the scan, and the callout says which
 * molecule was read. Every number below comes from the real WASM engine through the studio's own
 * call; the fixture is generated from a fixed seed and holds A and T only, so it spells no NGG PAM
 * but the two that are planted and the candidate list is known exactly.
 *
 * Wrong implementations this catches:
 * - the shipped straight read (the guide at the origin is absent and the tab lists one guide, not
 *   two);
 * - a studio that passes `circular` whatever the document is (the linear render would then list the
 *   origin guide and read "circular");
 * - a range that marks every guide as crossing the origin (the ordinary guide in the middle reads
 *   2,001..2,023 with no such note);
 * - coordinates left in the extended string (the origin guide would read 4,980..5,002, and its cut
 *   site would sit past base 4,990);
 * - the callout's wording hardcoded either way (both renders are read).
 */

/** Seeded pseudo-random A/T bases (LCG): neither strand of this background spells GG or CC. */
function atOnlyDna(length: number, seed: number): string {
  let x = seed >>> 0;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 31 === 0 ? 'A' : 'T';
  }
  return out.join('');
}

/** A 20-nt spacer free of GG and CC, followed by an NGG PAM: one candidate site, forward strand. */
const PLANTED_SITE = 'ATCGTACTGATCAGTCATGAAGG';

/** `block` written over `seq` from the 0-based offset `at`, wrapping past the last base. */
function plantWrapping(seq: string, at: number, block: string): string {
  const bases = seq.split('');
  for (let k = 0; k < block.length; k++) {
    bases[(at + k) % bases.length] = block[k];
  }
  return bases.join('');
}

/** The rows of the guide table, as a reader reads each one. */
const guideRows = (html: string) =>
  [...html.matchAll(/<tr><td><strong>(gRNA|crRNA)[\s\S]*?<\/tr>/g)].map((m) => text(m[0]).trim());

const ORIGIN_RECORD_BP = 4_990;
/** 4,990 bases of A and T with one site across the origin (4,980..12) and one at 2,001..2,023. */
const originSequence = plantWrapping(
  plantWrapping(atOnlyDna(ORIGIN_RECORD_BP, 0x15_6f01), 2_000, PLANTED_SITE),
  ORIGIN_RECORD_BP - 11,
  PLANTED_SITE
);

describe('the CRISPR tab reads a plasmid as the circle it is (BG-01M6T6GQ)', () => {
  it('scans a circular document across its origin, and a linear one only end to end', () => {
    const circularDoc: SequenceDocument = { ...dnaDoc('Crispr_Origin_circular', originSequence), topology: 'circular' };
    const linearDoc: SequenceDocument = { ...dnaDoc('Crispr_Origin_linear', originSequence), topology: 'linear' };

    // The engine's own reply, through the call the studio makes: the circular scan finds the site at
    // the origin, inside 1..4,990, and the straight read does not.
    const circularGuides = findCrisprGuides(originSequence, 'SpCas9 (NGG)', 25, true) as ScannedGuide[];
    const linearGuides = findCrisprGuides(originSequence, 'SpCas9 (NGG)', 25, false) as ScannedGuide[];
    expect(circularGuides.map((g) => [g.start, g.end, g.cutPosition])).toEqual(
      expect.arrayContaining([[4_980, 12, 6]])
    );
    expect(linearGuides.map((g) => [g.start, g.end])).toEqual([[2_001, 2_023]]);
    for (const g of circularGuides) {
      for (const coord of [g.start, g.end, g.cutPosition]) {
        expect(coord, `${g.name} leaves the record`).toBeGreaterThanOrEqual(1);
        expect(coord, `${g.name} leaves the record`).toBeLessThanOrEqual(ORIGIN_RECORD_BP);
      }
    }
    // The reply says how it was read, and the bases across the origin are the site's own span less
    // one — 22 for SpCas9's 23-base site, 23 for Cas12a's 24-base one.
    expect([circularGuides[0].scannedCircular, circularGuides[0].originSpanBp]).toEqual([true, 22]);
    expect([linearGuides[0].scannedCircular, linearGuides[0].originSpanBp]).toEqual([false, 0]);
    const cas12a = findCrisprGuides(originSequence, 'Cas12a / Cpf1 (TTTV)', 5, true) as ScannedGuide[];
    expect(
      cas12a[0].originSpanBp,
      "the bases across the origin are the nuclease's own site less one, not a constant"
    ).toBe(23);

    // The tab lists both guides, and the one at the origin says it is there.
    const circularHtml = crisprTab(circularDoc);
    expect(tabLabel(circularHtml)).toBe('Find CRISPR Sites & Off-Targets (2 Guides)');
    const rows = guideRows(circularHtml);
    expect(rows.some((r) => r.includes('4,980..12 (across the origin) (DSB @ 6)')), rows.join(' | ')).toBe(true);
    expect(
      rows.some((r) => r.includes('2,001..2,023 (DSB @ 2,017)') && !r.includes('across the origin')),
      'an ordinary guide is not marked as crossing the origin'
    ).toBe(true);
    expect(callout(circularHtml)).toContain(
      'other exact copies of the 12-nt PAM-proximal seed across all 4,990 bases of this circular sequence, including the 22 across its origin, on both strands'
    );
    expect(callout(circularHtml)).toContain('Lists all 2 candidate SpCas9 (NGG) guides found.');
    expect(warningRegions(circularHtml), 'the whole record was read, so nothing is warned about').toEqual([]);

    // The same bases as a linear document: the origin guide is not there, and the callout says so.
    const linearHtml = crisprTab(linearDoc);
    expect(tabLabel(linearHtml)).toBe('Find CRISPR Sites & Off-Targets (1 Guides)');
    expect(guideRows(linearHtml)).toEqual([expect.stringContaining('2,001..2,023 (DSB @ 2,017)')]);
    expect(linearHtml, 'a straight read has no site across the origin').not.toContain('across the origin');
    expect(callout(linearHtml)).toContain(
      'other exact copies of the 12-nt PAM-proximal seed across all 4,990 bases of this linear sequence, on both strands'
    );
    expect(callout(linearHtml)).not.toContain('circular');
  }, 55_000);
});
