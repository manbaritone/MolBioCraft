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
 * - the bases of PAM context read outside the interval left unsaid;
 * - a base of context read on both sides of an interval that nearly closes on itself counted once
 *   per side, which claimed 4 bases outside a 120-bp circle that leaves only 2 outside it.
 *
 * BG-01M7EQAA AC1 is the annotation: `+ Annotate Top 5 Guides` wrote `seed matches=N` into each
 * guide feature's note with nothing saying what N counted, so the default path since D0135 (a
 * selected span, preferred by the chooser) persisted an interval specificity as a bare number into
 * the document and into its GenBank export. The note now carries the scope in the words the callout
 * above the table already uses, read from the scan's own report. That case runs the real App over
 * the live DOM (the US-01M6TB6G harness), presses the tab's own button and reads the note back out
 * of the document the App saves, so a scope that reaches no writer fails here (LC-003). Wrong
 * implementations it kills: the bare count; a scope inferred from whether a selection exists (the
 * third case selects a span and then asks for the whole sequence); a note whose words have drifted
 * from the callout's (the scope sentence is asserted to be text that is on screen, not a literal
 * written out here). A scan that sent no report is said to have no known scope rather than read as a
 * whole-sequence scan (LC-006), in the writer itself; no case here reaches that branch.
 *
 * BG-01M7EQAA AC4 is the topology: AC1's only whole-sequence fixture was `linear300`, so of the four
 * branches of `crisprReadAs` the notes exercised two - the interval and the linear whole - and a
 * hand-written "all N bases of this linear sequence" in the note's place passed all of AC1 while
 * writing "linear" onto a plasmid. The AC4 case runs the same button on a circular record read whole
 * and on a record longer than the engine reads, and asserts each note against the branch's own
 * words. Wrong implementations it kills: the scope sentence hand-written in any one branch's words
 * rather than read from the one formatter the callout reads (the circular case then says "linear",
 * the bounded case claims all 8,000,100 bases); the origin bases dropped from the circular wording;
 * a bounded prefix described as the whole sequence. Every number in the wording asserted is built
 * from the scan report's own (`originSpanBp`, `scannedLengthBp`, `sequenceLengthBp`) rather than
 * written out - the literals here are the engine's bound, asserted as a precondition, and the
 * whole-sequence claim the bounded note must not make. On the circular branch the note's scope is
 * asserted to be text the callout holds, so the two surfaces cannot drift apart; on the bounded
 * branch the callout wraps the range in a sentence of its own (US-01M7DVAS AC4), so what the two
 * share is the range, and the note is held to the formatter's full branch wording instead.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';

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

/**
 * The CRISPR tab of the studio, rendered on `doc` with the selection the App holds (or none).
 *
 * React DOM and the studio are loaded on demand, never at module scope: the live-DOM harness the
 * BG-01M7EQAA case mounts the real App with refuses a process that has already loaded React DOM,
 * and that case runs first in this file.
 */
const crisprTab = async (
  doc: SequenceDocument,
  selectedRange?: { start: number; end: number } | null
): Promise<string> => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PrimerAndPCRStudio } = await import('../components/PrimerAndPCRStudio');
  return renderToStaticMarkup(
    <PrimerAndPCRStudio
      doc={doc}
      allDocuments={[doc]}
      onUpdateDocument={() => undefined}
      onAddConstruct={() => undefined}
      initialSubTab="crispr"
      selectedRange={selectedRange ?? null}
    />
  );
};

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
/** A circle an interval can nearly close: 118 of its 120 bases are searched, two lie outside. */
const circular120 = dnaDoc('Crispr_Interval_Near_Full_Circle', randomDna(120, 0x15_7c03), 'circular');

// ─── BG-01M7EQAA AC1: what the Top 5 annotation says its seed count covered ───

// This criterion launches the App afresh, with the real WASM engine behind it.
vi.setConfig({ testTimeout: 120_000 });

/** The CRISPR tab of the real App on `doc`, with `selectedRange` held as the App holds a selection. */
async function appOnCrisprTab(
  app: AppHarness,
  doc: SequenceDocument,
  selectedRange?: { start: number; end: number }
): Promise<void> {
  await app.restoreSession({
    documents: [doc],
    activeDocId: doc.id,
    viewerTab: 'primers-pcr',
    ...(selectedRange ? { workspace: { selectedRange: { label: 'Selection', ...selectedRange } } } : {}),
  });
  await app.menu('primers:crispr');
}

/** This launch's engine (loaded after the App, one module at a time, as the harness requires). */
async function engineScan(doc: SequenceDocument, interval?: { start: number; end: number }) {
  const { scanCrisprGuides } = await import('../core/bioEngine');
  return scanCrisprGuides(
    doc.sequence,
    'SpCas9 (NGG)',
    25,
    doc.topology === 'circular',
    interval ?? null
  );
}

/** The guide table's own info callout - the one that says what a seed count counts - as it reads. */
const calloutWords = (app: AppHarness): string => {
  const found = app
    .all('.info-callout')
    .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
    .filter((said) => said.includes('12-nt PAM-proximal seed'));
  if (found.length !== 1) {
    throw new Error(`the CRISPR tab shows ${found.length} callouts about the seed count, not one`);
  }
  return found[0];
};

/** Presses the tab's own `+ Annotate Top 5 Guides` button. */
async function annotateTop5(app: AppHarness): Promise<void> {
  const buttons = app
    .all('button')
    .filter((b) => b.textContent.replace(/\s+/g, ' ').includes('+ Annotate Top 5 Guides'));
  if (buttons.length !== 1) {
    throw new Error(`the CRISPR tab shows ${buttons.length} "+ Annotate Top 5 Guides" buttons, not one`);
  }
  await app.click(buttons[0]);
}

/** Chooses `value` in the tab's own search-range chooser, opening the inspector that holds it if need be. */
async function chooseSearchRange(app: AppHarness, value: 'interval' | 'whole'): Promise<void> {
  if (app.all('select[aria-label="Search range:"]').length === 0) {
    const toggle = app.inspectorButton();
    if (!toggle) throw new Error('the CRISPR tab offers no search-range chooser and no inspector to open');
    await app.click(toggle);
  }
  await app.change(app.one('select[aria-label="Search range:"]', 'the search-range chooser'), value);
}

/** The features of `docId` in the document the App saves (File > Save Session), as it saves them. */
async function savedFeatures(
  app: AppHarness,
  docId: string
): Promise<{ name: string; notes?: string; qualifiers?: Record<string, string> }[]> {
  const before = app.downloads().length;
  await app.menu('file:save-session');
  const files = app.downloads();
  if (files.length !== before + 1) {
    throw new Error(`File > Save Session saved ${files.length - before} files, not one`);
  }
  const payload = JSON.parse(await files[files.length - 1].text()) as {
    documents: { id: string; features: { name: string; notes?: string; qualifiers?: Record<string, string> }[] }[];
  };
  const found = payload.documents.find((d) => d.id === docId);
  if (!found) throw new Error(`the saved session holds no document "${docId}"`);
  return found.features;
}

/** Every seed-count sentence the annotations hold: `seed matches=N` and everything said after it. */
function seedNotes(features: { name: string; notes?: string }[]): string[] {
  return features
    .map((f) => /seed matches=[\s\S]*/.exec(f.notes ?? '')?.[0] ?? '')
    .filter((s) => s.length > 0);
}

describe('BG-01M7EQAA AC1: the Top 5 annotation carries the scope of the count it states', () => {
  it('the Top 5 annotation note says which bases its seed count covered', async () => {
    const app = await mountApp();
    try {
      // (a) The default path since D0135: a span is selected, so the scan reads that interval.
      await appOnCrisprTab(app, linear300, { start: 101, end: 200 });
      const intervalScan = await engineScan(linear300, { start: 101, end: 200 });
      expect(intervalScan.report?.searchedInterval?.start, 'the engine searched the selected span').toBe(101);
      expect(intervalScan.guides.length, 'the selected span holds guides to annotate').toBeGreaterThan(0);
      const intervalSaid = calloutWords(app);
      await annotateTop5(app);
      const intervalNotes = seedNotes(await savedFeatures(app, linear300.id));
      expect(intervalNotes.length, 'one seed count stated per guide annotated').toBe(
        Math.min(5, intervalScan.guides.length)
      );
      for (const note of intervalNotes) {
        // The bases the count covered, and that it is an interval specificity - not a bare number.
        expect(note, 'the note names the interval the count was measured over').toContain('101..200');
        expect(note).toContain('100 bp interval searched');
        expect(note).toContain('an interval specificity');
        expect(note, 'the count is not left as a bare number').not.toMatch(/seed matches=\d+\s*$/);
        // The same words the surfaces on screen use: the scope sentence is text the callout holds,
        // so a note whose wording drifts from the row's fails here.
        const scope = /seed matches=\d+[,.]?\s*(.*?)(?: — an interval specificity|$)/.exec(note)?.[1] ?? '';
        expect(scope.length, 'the note says something about the scope').toBeGreaterThan(20);
        expect(intervalSaid, 'the scope is stated in the words the callout uses').toContain(
          scope.replace(/^counted over /, '')
        );
      }
      // Each count is the engine's own number for that guide, not one of them repeated.
      const annotated = await savedFeatures(app, linear300.id);
      for (const g of intervalScan.guides.slice(0, 5)) {
        const spacerFeat = annotated.find((f) => f.name === `${g.name} spacer`);
        expect(spacerFeat, `an annotation for ${g.name}`).toBeTruthy();
        expect(spacerFeat!.notes ?? '').toContain(`seed matches=${g.offTargetCount}`);
      }

      // (b) A whole-sequence scan says so, in the same place.
      await appOnCrisprTab(app, linear300);
      const wholeScan = await engineScan(linear300);
      expect(wholeScan.report?.searchedInterval, 'no interval was searched').toBeUndefined();
      const wholeSaid = calloutWords(app);
      await annotateTop5(app);
      const wholeNotes = seedNotes(await savedFeatures(app, linear300.id));
      expect(wholeNotes.length, 'the whole-sequence scan annotated guides too').toBeGreaterThan(0);
      for (const note of wholeNotes) {
        expect(note).toContain('all 300 bases of this linear sequence');
        expect(note, 'no interval is claimed where none was searched').not.toContain('interval searched');
        expect(note, 'a sequence-wide count is not called an interval specificity').not.toContain(
          'an interval specificity'
        );
        expect(note, 'the count is not left as a bare number').not.toMatch(/seed matches=\d+\s*$/);
        expect(wholeSaid, 'the scope is stated in the words the callout uses').toContain(
          'all 300 bases of this linear sequence'
        );
      }

      // (c) The scope is the scan's, not the selection's: a span is selected and the whole sequence
      // is asked for, so the note says the whole sequence.
      await appOnCrisprTab(app, linear300, { start: 101, end: 200 });
      await chooseSearchRange(app, 'whole');
      await annotateTop5(app);
      const chosenNotes = seedNotes(await savedFeatures(app, linear300.id));
      expect(chosenNotes.length, 'the whole-sequence scan annotated guides').toBeGreaterThan(0);
      for (const note of chosenNotes) {
        expect(note, 'the scope is read from the scan, not from the selection').toContain(
          'all 300 bases of this linear sequence'
        );
        expect(note).not.toContain('101..200');
        expect(note, 'the count asked for over the whole sequence is not an interval specificity').not.toContain(
          'an interval specificity'
        );
      }
    } finally {
      app.unmount();
    }
  });
});

// ─── BG-01M7EQAA AC4: the scope sentence on a circle, and on a record read in part ───

/**
 * 100 bases past `GUIDE_SCAN_MAX_BP` (8,000,000, the largest range the engine reads): the only shape
 * in which the shipped studio sees a scan that covered less than its sequence, and so the only
 * fixture that reaches the bounded-prefix branch of the scope sentence.
 */
const pastTheBound = dnaDoc('Crispr_Interval_Past_Bound', randomDna(8_000_100, 0x15_7d04));

/** The scope sentence a note states, as the note states it: everything after `seed matches=N, `. */
const scopeOf = (note: string) =>
  /seed matches=\d+[,.]?\s*counted over ([\s\S]*?)(?: — an interval specificity|$)/.exec(note)?.[1] ?? '';

describe('BG-01M7EQAA AC4: the note states the scope of the branch the scan actually took', () => {
  it('the Top 5 annotation note names the topology and the origin bases the callout names', async () => {
    const app = await mountApp();
    try {
      // (a) A plasmid read whole: the note says the circle it is, and names the bases across its
      // origin that only a circular read covers. AC1's linear fixture reached neither.
      await appOnCrisprTab(app, circular400);
      const circularScan = await engineScan(circular400);
      expect(circularScan.report?.searchedInterval, 'the whole plasmid was read').toBeUndefined();
      expect(circularScan.report?.scannedCircular, 'and read as the circle it is').toBe(true);
      const originBp = circularScan.report?.originSpanBp ?? 0;
      expect(originBp, 'so bases across its origin were read').toBeGreaterThan(0);
      expect(circularScan.guides.length, 'the plasmid holds guides to annotate').toBeGreaterThan(0);
      const circularWords = `all 400 bases of this circular sequence, including the ${originBp} across its origin`;
      const circularSaid = calloutWords(app);
      expect(circularSaid, 'the callout names the circle and its origin bases').toContain(circularWords);

      await annotateTop5(app);
      const circularNotes = seedNotes(await savedFeatures(app, circular400.id));
      expect(circularNotes.length, 'one seed count stated per guide annotated').toBe(
        Math.min(5, circularScan.guides.length)
      );
      for (const note of circularNotes) {
        expect(note, 'the note names the topology, and the origin bases, the callout names').toContain(
          circularWords
        );
        expect(note, 'a plasmid read whole is never called a linear sequence').not.toContain('linear sequence');
        expect(note, 'no interval is claimed where none was searched').not.toContain('interval searched');
        expect(note, 'a sequence-wide count is not called an interval specificity').not.toContain(
          'an interval specificity'
        );
        // The words are the callout's own on this branch too, so the two surfaces cannot diverge.
        const scope = scopeOf(note);
        expect(scope.length, 'the note says what the count covered').toBeGreaterThan(20);
        expect(circularSaid, 'in the words the callout uses').toContain(scope);
      }

      // (b) A record longer than the engine reads: the note names the prefix that was read, never
      // the whole sequence and never a topology in place of the range.
      await appOnCrisprTab(app, pastTheBound);
      const boundedScan = await engineScan(pastTheBound);
      expect(
        [boundedScan.report?.scannedLengthBp, boundedScan.report?.sequenceLengthBp],
        'the fixture is longer than the engine reads, so this scan stopped short'
      ).toEqual([8_000_000, 8_000_100]);
      expect(boundedScan.report?.searchedInterval, 'no interval was asked for').toBeUndefined();
      expect(boundedScan.guides.length, 'the prefix read holds guides to annotate').toBeGreaterThan(0);
      // The range as the scan reports it, and the whole branch wording the one formatter gives it —
      // both built from the report's own numbers, neither copied out of the component.
      const boundedRange = `bases 1 to ${boundedScan.report!.scannedLengthBp.toLocaleString('en-US')} of the ${boundedScan.report!.sequenceLengthBp.toLocaleString('en-US')} bases of this sequence`;
      const boundedWords = `${boundedRange}, on both strands`;
      const boundedSaid = calloutWords(app);
      // The callout's seed sentence wraps this range in words of its own ("— the range searched …
      // and no copy outside it", US-01M7DVAS AC4), so the range is what the two surfaces share.
      expect(boundedSaid, 'the callout names the range read').toContain(boundedRange);
      expect(boundedSaid, 'and claims none of the bases past it').not.toContain('all 8,000,100 bases');

      await annotateTop5(app);
      const boundedNotes = seedNotes(await savedFeatures(app, pastTheBound.id));
      expect(boundedNotes.length, 'one seed count stated per guide annotated').toBe(
        Math.min(5, boundedScan.guides.length)
      );
      for (const note of boundedNotes) {
        // The formatter's own wording for this branch, in full: a note that states its scope in any
        // other branch's words fails here even where the range happens to be named.
        expect(note, 'the note states the prefix read in the formatter\'s own words').toContain(
          `counted over ${boundedWords}`
        );
        expect(note, 'a scan that read part of the record claims none of the rest').not.toContain(
          'all 8,000,100 bases'
        );
        expect(note, 'and does not call a bounded prefix a whole sequence of either topology').not.toMatch(
          /this (linear|circular) sequence/
        );
        expect(note, 'no interval is claimed where none was searched').not.toContain('interval searched');
        const scope = scopeOf(note);
        expect(scope, 'the scope sentence is the branch wording and nothing else').toBe(boundedWords);
      }
    } finally {
      app.unmount();
    }
  }, 600_000);
});

describe('US-01M7DVAS AC1: Find CRISPR Sites offers the whole sequence or the interval on screen', () => {
  it('offers both scopes, naming the selected interval by its own 1-based bounds', async () => {
    const html = await crisprTab(linear300, { start: 101, end: 200 });
    const options = rangeOptions(html);
    expect(options.map((o) => o.value)).toEqual(['interval', 'whole']);
    const [interval, whole] = options;
    expect(interval.label).toContain('101..200');
    expect(interval.label).toContain('100 bp');
    expect(whole.label).toContain('300 bp');
    expect(rangeNote(html)).toBe('');
  });

  it('names an origin-crossing selection as the interval it is, counting both sides of the origin', async () => {
    const html = await crisprTab(circular400, { start: 380, end: 140 });
    const interval = rangeOptions(html).find((o) => o.value === 'interval');
    expect(interval).toBeDefined();
    // 400 - 380 + 1 + 140 = 161 bases, not 140 - 380.
    expect(interval!.label).toContain('380..140');
    expect(interval!.label).toContain('161 bp');
    expect(interval!.label).toContain('across the origin');
  });

  it('offers only the whole sequence when there is no selection, and says so', async () => {
    const html = await crisprTab(linear300, null);
    expect(rangeOptions(html).map((o) => o.value)).toEqual(['whole']);
    const note = rangeNote(html);
    expect(note).toMatch(/no (bases are selected|selection)/i);
    // The scan that ran is the whole sequence, said as it always was.
    expect(callout(html)).toContain('all 300 bases of this linear sequence');
    expect(callout(html)).not.toContain('interval');
  });

  it('never reads a selection outside the sequence as the whole sequence or as an empty interval', async () => {
    const outside = await crisprTab(linear300, { start: 280, end: 400 });
    expect(rangeOptions(outside).map((o) => o.value)).toEqual(['whole']);
    const note = rangeNote(outside);
    expect(note).toContain('280..400');
    expect(note).toContain('300');
    expect(note).toMatch(/not (inside|offered)/i);
    // A whole-sequence scan ran, and the callout says that is what it was.
    expect(callout(outside)).toContain('all 300 bases of this linear sequence');

    // Reversed on a linear record: an interval across the origin, which a line has not.
    const reversed = await crisprTab(linear300, { start: 200, end: 101 });
    expect(rangeOptions(reversed).map((o) => o.value)).toEqual(['whole']);
    expect(rangeNote(reversed)).toContain('200..101');
    expect(rangeNote(reversed)).toMatch(/linear|origin/i);
  });

  it('never offers a selection shorter than the nuclease site it would be searched for', async () => {
    const html = await crisprTab(linear300, { start: 10, end: 20 });
    expect(rangeOptions(html).map((o) => o.value)).toEqual(['whole']);
    const note = rangeNote(html);
    expect(note).toContain('10..20');
    expect(note).toContain('11 bp');
    expect(note).toContain('23');
  });
});

describe('US-01M7DVAS AC4: the scan report names the interval searched, never the whole sequence', () => {
  it('names the interval, its length, the sequence length and the context read outside it', async () => {
    const html = await crisprTab(linear300, { start: 101, end: 200 });
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

  it('says an origin-crossing interval runs across the origin, with both sides counted', async () => {
    const html = await crisprTab(circular400, { start: 380, end: 140 });
    const said = callout(html);
    expect(said).toContain('380..140');
    expect(said).toContain('161 bp');
    expect(said).toContain('across the origin');
    expect(said).toContain('400 bases');
    expect(said).not.toContain('all 400 bases of this circular sequence');
  });

  it('counts a base of context read on both sides of a near-full-circle interval once', async () => {
    // 118 of these 120 bases are the interval searched, so bases 1 and 2 are the only ones outside
    // it - and each of them is read twice, once as the PAM context off either bound of an interval
    // that nearly closes on itself. Two bases of this sequence were read outside the interval, not
    // four: the number says what was read, not how often it was read.
    const html = await crisprTab(circular120, { start: 3, end: 120 });
    const said = callout(html);
    expect(said).toContain('3..120');
    expect(said).toContain('118 bp');
    expect(said).toContain('2 bases outside the interval were read as PAM context only');
    expect(said).not.toContain('4 bases outside the interval');
    // The engine's own sentence counts them the same way, and says why they were read twice.
    expect(warnings(html).join(' | ')).toContain(
      '2 bases outside that interval were read as PAM context only — all of the bases outside it'
    );
  });

  it('keeps the whole-sequence wording, and claims no interval, when the whole sequence was searched', async () => {
    const said = callout(await crisprTab(circular400, null));
    expect(said).toContain('all 400 bases of this circular sequence');
    expect(said).toContain('across its origin');
    expect(said).not.toContain('interval');
  });
});
