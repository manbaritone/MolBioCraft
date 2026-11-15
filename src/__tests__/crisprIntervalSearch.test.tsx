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
 * whole-sequence claim the bounded note must not make. On both branches the note's scope is
 * asserted to be text the callout holds, in the branch's whole wording, so the two surfaces cannot
 * drift apart.
 *
 * BG-01M7FCDY is where those words come from: the callout's seed sentence read the one formatter
 * (`crisprReadAs`) on its whole-sequence branch alone and hand-wrote a frame of its own on the
 * other two - the bounded one a second copy of the formatter's own bounded wording - while the
 * `Searched:` line that would have supplied shared text renders only for an interval. So the
 * adjectival frame of a sentence could drift from the note's on one branch with every test green:
 * the reviewer's M15 said a bounded prefix was read "over the whole record, on one strand - and
 * copies outside it too" and survived both criteria above. The two cases below close that. AC1
 * reads the callout's seed sentence apart from the rest of the callout and requires it to be this
 * file's own words plus the formatter's phrase verbatim, on each of the five branches. AC2 derives
 * the branch list from the source of `crisprScanReadAs` in core (src/core/crisprGuideText.ts) - its
 * five arms, one per template literal - and holds the note and the callout to the identical phrase
 * on each of five fixtures, with every arm asserted to be reached by exactly one of them - so a
 * sixth arm, or a fixture that stops reaching one, fails here rather than going unread. On the
 * under-site arm (a plasmid shorter than one SpCas9 site, read without crossing its origin) the
 * scan finds no guide, so no note can be saved for that record: its note side is computed by the
 * formatter itself, `crisprScanReadAs` over the scan's own report, and only the callout there is
 * read off the App. The numbers in each phrase are asserted against the scan report's own, so a branch
 * whose wording keeps its shape while drifting a number (a bounded prefix claiming the whole
 * record) fails too. Wrong implementations they kill: the frame drift M15; the callout's range
 * literal drifting from the note's; the formatter's bounded branch drifting; and a guard that holds
 * only the branch a fixture happens to reach. The scope sentence's one other outcome - the engine
 * sent no report, so the scope is unknown (LC-006) - is no arm of `crisprScanReadAs`, is reached by
 * no fixture here and is BG-01M7FD7R's.
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
      const circularWords = `all 400 bases of this circular sequence, including the ${originBp} across its origin, on both strands`;
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
      // The callout states the scope in the one formatter's words on this branch too
      // (BG-01M7FCDY AC1), so the whole branch wording is what the two surfaces share - not the
      // range alone, which left the sentence's frame free to drift (the reviewer's M15).
      expect(boundedSaid, "the callout names the prefix read in the formatter's own words").toContain(
        boundedWords
      );
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

// ─── BG-01M7FCDY: the callout's seed sentence reads the one formatter, on every branch ───

/** A count of bases as every surface in the app writes it. */
const bpText = (n: number) => n.toLocaleString('en-US');

/**
 * The seed-match sentence of the guide table's callout: what the callout says between
 * `Seed matches:` and its genome-wide note.
 *
 * Read apart from the rest of the callout on purpose. The callout also prints `Searched: <scope>`
 * on its interval branch, so a guard that asks only whether the callout somewhere holds the
 * formatter's words passes while the seed sentence hand-writes a scope of its own - which is the
 * defect BG-01M7FCDY closes.
 */
const seedSentence = (said: string): string => {
  const m = /Seed matches:\s*([\s\S]*?)\(no genome-wide off-target search\)/.exec(said);
  if (!m) throw new Error(`the CRISPR callout holds no "Seed matches" sentence: ${said}`);
  return m[1].trim();
};

/** One scan shape as the two surfaces state it, with the scan report that produced it. */
type BranchSurfaces = {
  /** What the fixture is, for a failure message. */
  branch: string;
  doc: SequenceDocument;
  report: NonNullable<Awaited<ReturnType<typeof engineScan>>['report']>;
  /** The callout's seed-match sentence. */
  seedSaid: string;
  /** The scope sentence each Top 5 note carries, as the saved document carries it. */
  noteScopes: string[];
};

let branchSurfacesOnce: Promise<BranchSurfaces[]> | undefined;

/**
 * A plasmid shorter than an SpCas9 site: the engine reads its bases straight, not round its origin
 * (`scannedCircular` false), and finds no guide - the one shape in which the shipped studio shows a
 * circular record read without crossing its origin (BG-01M7FH8K AC4).
 */
const circularUnderASite = dnaDoc('Crispr_Interval_Circle_Under_Site', randomDna(20, 0x15_7e05), 'circular');

/**
 * Every scan shape the studio can show, read from one launch of the real App: an interval of a
 * plasmid, the prefix of a record longer than the engine reads, a plasmid read whole, a plasmid read
 * without crossing its origin and a linear record read whole - the five branches `crisprScanReadAs`
 * can print. The scope sentence is read out of the document the App saves, so a scope that reaches
 * no writer fails here (LC-003). The plasmid read without crossing its origin holds no guide, so it
 * has no note to save: its callout is read against the formatter alone.
 */
const branchSurfaces = (): Promise<BranchSurfaces[]> =>
  (branchSurfacesOnce ??= (async () => {
    const cases: { branch: string; doc: SequenceDocument; interval?: { start: number; end: number } }[] = [
      { branch: 'interval', doc: circular400, interval: { start: 101, end: 300 } },
      { branch: 'bounded prefix', doc: pastTheBound },
      { branch: 'circular whole', doc: circular400 },
      { branch: 'linear whole', doc: linear300 },
      { branch: 'circular not read across its origin', doc: circularUnderASite },
    ];
    const app = await mountApp();
    try {
      const read: BranchSurfaces[] = [];
      for (const { branch, doc, interval } of cases) {
        await appOnCrisprTab(app, doc, interval);
        const scan = await engineScan(doc, interval);
        expect(scan.report, `${branch}: the engine sent a scan report`).toBeTruthy();
        const seedSaid = seedSentence(calloutWords(app));
        if (scan.guides.length === 0) {
          expect(branch, 'only the plasmid under one site holds no guide').toBe('circular not read across its origin');
          const { crisprScanReadAs } = await import('../core/crisprGuideText');
          read.push({ branch, doc, report: scan.report!, seedSaid, noteScopes: [crisprScanReadAs(scan.report!, doc.topology)] });
          continue;
        }
        await annotateTop5(app);
        const noteScopes = seedNotes(await savedFeatures(app, doc.id)).map(scopeOf);
        expect(noteScopes.length, `${branch}: one seed count stated per guide annotated`).toBe(
          Math.min(5, scan.guides.length)
        );
        read.push({ branch, doc, report: scan.report!, seedSaid, noteScopes });
      }
      return read;
    } finally {
      app.unmount();
    }
  })());

describe("BG-01M7FCDY AC1: the callout's seed sentence reads the one formatter, not a copy of it", () => {
  it("BG-01M7FCDY AC1 the callout states the scope in the formatter's own words on every branch", async () => {
    for (const { branch, report, seedSaid, noteScopes } of await branchSurfaces()) {
      const scope = noteScopes[0];
      // The seed's length is the one this branch's scan reported (BG-01M7FF3B), never a number of
      // this test's or the app's own: a report without it fails here rather than reading as 12.
      const seedLength = report.seedLengthBp;
      expect(Number.isInteger(seedLength) && (seedLength as number) > 0, `${branch}: the scan reports its seed length`).toBe(true);
      expect(scope.length, `${branch}: the note says what the count covered`).toBeGreaterThan(20);
      expect(new Set(noteScopes).size, `${branch}: every note states the one scope`).toBe(1);
      // The callout's own words, then the formatter's, with nothing of the scope written out here:
      // a frame of the callout's own invention cannot sit between the two.
      expect(seedSaid, `${branch}: the callout states the scope in the formatter's own words`).toContain(
        `other exact copies of the ${seedLength}-nt PAM-proximal seed across ${scope}`
      );
      // The three frames the branches hand-wrote before this fix, and the drift the reviewer's M15
      // slipped past both BG-01M7EQAA criteria, in none of them now.
      expect(seedSaid, `${branch}: no branch keeps a frame of its own`).not.toMatch(
        /seed inside the interval searched|seed in bases 1 to|the range searched|on one strand|copies outside it too/
      );
      // What is genuinely the callout's own claim: a scan of part of the record says that the rest
      // of it holds no copy, and a scan of the whole record claims no such thing.
      const readPartOfIt =
        report.searchedInterval !== undefined || report.scannedLengthBp < report.sequenceLengthBp;
      expect(
        seedSaid.includes('and no copy outside it'),
        `${branch}: only a scan of part of the record says no copy lies outside it`
      ).toBe(readPartOfIt);
    }
  }, 600_000);
});

/**
 * The arms of `crisprScanReadAs`, the one scope formatter, read out of its own source in
 * src/core/crisprGuideText.ts (BG-01M7FH8K: the studio reads it and keeps no copy) - one regular
 * expression per branch it can print, with each `${...}` left free. The branch list is derived here rather than
 * written out, so a branch added to the formatter without a case below fails this guard instead of
 * going unread: BG-01M7EQAA AC1 passed for a year of plasmids while calling them linear precisely
 * because its fixtures reached two of the four branches and nothing said so.
 */
const readAsBranchPatterns = async (): Promise<RegExp[]> => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../core/crisprGuideText.ts', import.meta.url), 'utf8');
  const decl = /export function crisprScanReadAs\([\s\S]*?\n}\n/.exec(source);
  if (!decl) throw new Error('core declares no `crisprScanReadAs`, so this guard has nothing to derive');
  const arms = decl[0].match(/`[^`]*`/g) ?? [];
  if (arms.length === 0) throw new Error('`crisprScanReadAs` states no branch this guard can read');
  return arms.map(
    (arm) =>
      new RegExp(
        arm
          .slice(1, -1)
          .split(/\$\{[^}]*\}/)
          .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[\\s\\S]*?')
      )
  );
};

describe('BG-01M7FCDY AC2: one guard holds every branch of the formatter to a single source', () => {
  it("BG-01M7FCDY AC2 note and callout share the formatter's phrase on every branch", async () => {
    const patterns = await readAsBranchPatterns();
    const surfaces = await branchSurfaces();
    expect(
      patterns.length,
      'every branch `crisprScanReadAs` can print is read by a case here - add one for a new branch'
    ).toBe(surfaces.length);

    const reached = new Map<number, string>();
    for (const { branch, doc, report, seedSaid, noteScopes } of surfaces) {
      const scope = noteScopes[0];
      // (i) The identical phrase on both surfaces - not a paraphrase, and not merely a shared number.
      expect(seedSaid, `${branch}: the callout's seed sentence holds the note's scope phrase`).toContain(
        scope
      );
      // (ii) Which branch printed it, decided by the formatter's own source rather than by this file.
      const matched = patterns.flatMap((pattern, i) => (pattern.test(scope) ? [i] : []));
      expect(matched.length, `${branch}: the scope "${scope}" is exactly one branch of crisprScanReadAs`).toBe(
        1
      );
      expect(reached.get(matched[0]), `${branch}: no two cases read the same branch`).toBeUndefined();
      reached.set(matched[0], branch);
      // (iii) The numbers in the phrase are the scan report's own, so a branch that drifts one - a
      // bounded prefix claiming the whole record - fails here even though its shape still fits.
      const stated = [bpText(report.sequenceLengthBp)];
      if (report.searchedInterval !== undefined) {
        stated.push(bpText(report.searchedInterval.lengthBp), `${report.searchedInterval.start}`);
      } else if (report.scannedLengthBp < report.sequenceLengthBp) {
        stated.push(bpText(report.scannedLengthBp));
      } else if (report.scannedCircular === true && (report.originSpanBp ?? 0) > 0) {
        stated.push(bpText(report.originSpanBp!));
      }
      for (const number of stated) {
        expect(scope, `${branch}: the phrase states the scan's own ${number}`).toContain(number);
      }
      // A bounded prefix is a range and claims no topology; every other branch names the one the
      // document has, read from the document rather than written out per branch.
      const topologyWords =
        report.searchedInterval === undefined && report.scannedLengthBp < report.sequenceLengthBp
          ? 'bases of this sequence'
          : `this ${doc.topology === 'circular' ? 'circular' : 'linear'} sequence`;
      expect(scope, `${branch}: the phrase names the topology the document has`).toContain(topologyWords);
    }
    expect(
      [...reached.keys()].sort(),
      'every branch of crisprScanReadAs is read by one of these cases'
    ).toEqual(patterns.map((_, i) => i));
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
