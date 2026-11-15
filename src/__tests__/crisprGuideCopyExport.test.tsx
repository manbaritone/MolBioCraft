// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DV5P: the CRISPR tab had no way to take a guide out of it. Adaeze retyped a spacer into an
 * order form from the screen, and the tab's table export was the shared one, which writes the cells
 * on screen and so carried neither the coordinates' convention, nor the nuclease preset, nor what
 * the heuristic rank and the seed count are counts of.
 *
 * The tab now copies the spacer alone (AC1) or the spacer and its PAM labelled, in the order the
 * nuclease's PAM side dictates (AC2); a copy the environment refuses says nothing was copied and
 * leaves the text to read (AC3); and the export writes each guide's coordinates, scores and
 * provenance as TSV and CSV (AC4), the row's own coordinates - `start > end` across the origin, with
 * the convention stated in the file (AC5).
 *
 * Every guide record here comes from this launch's own WASM engine (`scanCrisprGuides`); no spacer,
 * PAM, coordinate, rank or seed count is written into a fixture by hand, and the heuristic rank's
 * rule is read from the engine's own description, never restated here (BG-01M7E61C). AC1 to AC3 are
 * read through the real App over the live DOM (the US-01M6TB6G harness), driven through the CRISPR
 * tab's own controls, so a helper that no control reaches fails here (LC-003). Rows are found by the
 * guide's id or name, never by position in the table, and the row driven is never the first one
 * (LC-002).
 *
 * Wrong implementations these kill:
 * - AC1: a copy that appends the PAM (the site's 23 bases instead of the spacer's 20); a labelled or
 *   FASTA-wrapped spacer; the top row's spacer copied whatever row was asked.
 * - AC2: the PAM blindly appended for every nuclease, which puts Cas12a's 5' PAM after the spacer;
 *   the two parts concatenated into one 23- or 24-base run a reader could order as one oligo; a part
 *   with no label or no 5'/3' marks; the spacer length or the PAM length hard-coded to SpCas9's 20
 *   and 3 (BG-01M7EXRW), which Cas12a's 4-nt PAM contradicts.
 * - AC3: a refused copy reported as a copy; a refusal that hides the text; a missing clipboard and a
 *   clipboard that refuses told as the same thing (LC-006).
 * - AC4: an export of the visible cells alone (no preset, no convention, no scopes, no revision); a
 *   seed count exported without its scope, or an interval scan's count exported as a sequence-wide
 *   one; the heuristic rule restated instead of read from the engine; an export of every row while
 *   rows are selected, or of a selection it does not declare.
 * - AC5: an origin-crossing guide exported as a swapped pair (12..290), as a negative length, or
 *   with no convention stated in the file.
 *
 * BG-01M7EZVV adds the cases those fixtures could not reach, each at the end of this file: the
 * export's `-` strand branch (every fixture above lists forward guides alone), a 5'-PAM nuclease's
 * whole export row, and a copy report taken from a `writeText` that resolved rather than from the
 * clipboard - plus two clicks that finish out of order.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

// Each criterion launches the App afresh, with the real WASM engine behind it.
import { vi } from 'vitest';
vi.setConfig({ testTimeout: 120_000 });

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Documents built in the test ───

/**
 * Filler bases that hold no SpCas9 PAM on either strand (no G at all, no two C in a row) and no
 * Cas12a TTTV on either strand (no TTT, no AAA), and cannot make one at a join: it begins and ends
 * with A.
 */
const FILLER_UNIT = 'ATCATACTAATCTAACATTA';
const filler = (n: number) => FILLER_UNIT.repeat(Math.ceil(n / FILLER_UNIT.length)).slice(0, n);

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear',
  folder: 'Local', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z',
  features: [], primers: [], history: [],
};

const dnaDoc = (
  id: string,
  name: string,
  sequence: string,
  topology: 'linear' | 'circular'
): SequenceDocument => ({ ...BLANK, id, name, accession: `MBC_${id}`, sequence, topology });

/** Writes `bases` at the 1-based `start` of a circular draft, wrapping the origin once. */
function plant(draft: string[], start: number, bases: string): void {
  for (let i = 0; i < bases.length; i++) draft[(start - 1 + i) % draft.length] = bases[i];
}

const PLASMID_LEN = 300;
/**
 * Four forward SpCas9 sites in a 300-bp circle - spacer then NGG PAM - one of them across the
 * origin, at 290..300 + 1..12. No spacer here holds GG or CC, so the planted PAMs are the only ones.
 */
const PLASMID_SITES = [
  { start: 31, spacer: 'ACGTATCAGTCAGTCATCAG', pam: 'AGG' },
  { start: 131, spacer: 'TTACGATCATCAGATCGATA', pam: 'TGG' },
  { start: 211, spacer: 'GCATCGATCGATCAGCATCG', pam: 'AGG' },
  { start: 290, spacer: 'TACGTTACGATCAGTTACGT', pam: 'AGG' },
];
const plasmidSeq = (() => {
  const draft = filler(PLASMID_LEN).split('');
  for (const site of PLASMID_SITES) plant(draft, site.start, site.spacer + site.pam);
  return draft.join('');
})();
const PLASMID = dnaDoc('dv5p-plasmid', 'pDV5P_Guides', plasmidSeq, 'circular');

/**
 * One SpCas9 site (spacer then AGG) and one Cas12a site (TTTA then spacer) in one linear record, so
 * one launch can copy a 3'-PAM guide and a 5'-PAM guide. Neither site holds the other's PAM.
 */
const DUAL_SPCAS9 = { start: 41, spacer: 'TTACGATCATCAGATCGATA', pam: 'TGG' };
const DUAL_CAS12A = { start: 141, pam: 'TTTA', spacer: 'ACGTATCAGTCAGTCATCAG' };
const dualSeq = (() => {
  const draft = filler(240).split('');
  plant(draft, DUAL_SPCAS9.start, DUAL_SPCAS9.spacer + DUAL_SPCAS9.pam);
  plant(draft, DUAL_CAS12A.start, DUAL_CAS12A.pam + DUAL_CAS12A.spacer);
  return draft.join('');
})();
const DUAL = dnaDoc('dv5p-dual', 'pDV5P_Dual', dualSeq, 'linear');

/** The other strand of `bases`, read 5'->3' - how a minus-strand guide's own spacer reads. */
const revComp = (bases: string): string =>
  [...bases]
    .reverse()
    .map((b) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[b] ?? 'N')
    .join('');

/**
 * One forward SpCas9 site and one on the minus strand (BG-01M7EZVV AC1). The reverse site is
 * planted as the reverse complement of `spacer + TGG`, so the plus strand reads `CCA` then the
 * complement of the spacer and the guide the engine finds is on the minus strand: its spacer is
 * `STRANDS_REVERSE.spacer`, read 5'->3' off that strand, and the export's strand cell has a `-`
 * branch to exercise. Neither planted 23-mer spells a second NGG on either strand (no other GG,
 * no other CC), and the filler spells none at all, so these two sites are the only candidates.
 */
const STRANDS_FORWARD = { start: 41, spacer: 'TTACGATCATCAGATCGATA', pam: 'TGG' };
const STRANDS_REVERSE = { start: 141, spacer: 'ACGTATCAGTCAGTCATCAG', pam: 'TGG' };
const strandsSeq = (() => {
  const draft = filler(240).split('');
  plant(draft, STRANDS_FORWARD.start, STRANDS_FORWARD.spacer + STRANDS_FORWARD.pam);
  plant(draft, STRANDS_REVERSE.start, revComp(STRANDS_REVERSE.spacer + STRANDS_REVERSE.pam));
  return draft.join('');
})();
const STRANDS = dnaDoc('ezvv-strands', 'pEZVV_Strands', strandsSeq, 'linear');

const SPCAS9 = 'SpCas9 (NGG)';
const CAS12A = 'Cas12a / Cpf1 (TTTV)';

// ─── The engine's own answer ───

/** This launch's engine (loaded after the App, one module at a time, as the harness requires). */
async function engineScan(doc: SequenceDocument, nuclease: string, interval?: { start: number; end: number }) {
  const { scanCrisprGuides } = await import('../core/bioEngine');
  return scanCrisprGuides(doc.sequence, nuclease, 25, doc.topology === 'circular', interval ?? null);
}

/** The engine's own words for the heuristic rank's rule, which no surface restates (BG-01M7E61C). */
async function engineRankRule(doc: SequenceDocument): Promise<string> {
  const { executeBuiltinWorkflowMacroRust } = await import('../lib/rustBioEngine');
  const reply = executeBuiltinWorkflowMacroRust('js-crispr-spcas9-scanner', doc) as {
    scoreModels: Record<string, string>;
  };
  return reply.scoreModels.onTargetScore;
}

/** The revision token of the molecule the guides were found on, as the workbench writes it. */
async function engineRevision(doc: SequenceDocument): Promise<string> {
  const { sequenceRevision } = await import('../core/restrictionDisplay');
  return sequenceRevision(doc.sequence, doc.topology === 'circular' ? 'circular' : 'linear');
}

// ─── Reading and driving the App ───

const onCrisprTab = async (
  app: AppHarness,
  doc: SequenceDocument,
  selectedRange?: { start: number; end: number; label?: string }
) => {
  await app.restoreSession({
    documents: [doc],
    activeDocId: doc.id,
    viewerTab: 'primers-pcr',
    ...(selectedRange ? { workspace: { selectedRange: { label: 'Selection', ...selectedRange } } } : {}),
  });
  await app.menu('primers:crispr');
};

/** The guide ids the table lists, in the order it draws them. */
const listedGuideIds = (app: AppHarness) =>
  app.all('[data-crispr-guide-row]').map((r) => r.getAttribute('data-crispr-guide-row') ?? '');

/** Chooses `nuclease` in the tab's own chooser, opening the inspector that holds it if need be. */
async function chooseNuclease(app: AppHarness, nuclease: string): Promise<void> {
  if (app.all('select[aria-label="Nuclease / PAM:"]').length === 0) {
    const toggle = app.inspectorButton();
    if (!toggle) throw new Error('the CRISPR tab offers no nuclease chooser and no inspector to open');
    await app.click(toggle);
  }
  await app.change(app.one('select[aria-label="Nuclease / PAM:"]', 'the nuclease chooser'), nuclease);
}

/** What the clipboard holds now, read through the same API the tab writes with. */
async function clipboardText(): Promise<string> {
  const nav = globalThis.navigator as unknown as { clipboard?: { readText?: () => Promise<string> } };
  if (!nav.clipboard?.readText) throw new Error('this launch has no clipboard to read');
  return nav.clipboard.readText();
}

/** The clipboard of the launch, swapped for one that refuses every write, or for none at all. */
function breakClipboard(mode: 'refuses' | 'absent', why = 'Write permission denied.'): void {
  const nav = globalThis.navigator as unknown as { clipboard?: unknown };
  if (mode === 'absent') {
    nav.clipboard = undefined;
    return;
  }
  nav.clipboard = {
    writeText: () => Promise.reject(new Error(why)),
    readText: () => Promise.resolve(''),
  };
}

/**
 * A clipboard whose `writeText` resolves without writing (BG-01M7EZVV AC4): it takes the call,
 * refuses nothing, and goes on holding `held`. With `readable` the build lets the page read the
 * clipboard back and so can tell; without it, the page cannot tell at all.
 */
function droppingClipboard(held: string, readable: boolean): void {
  const nav = globalThis.navigator as unknown as { clipboard?: unknown };
  nav.clipboard = {
    writeText: () => Promise.resolve(),
    ...(readable ? { readText: () => Promise.resolve(held) } : {}),
  };
}

/**
 * A clipboard that really writes, but only when the test lets a write finish (BG-01M7EZVV AC4), so
 * two clicks can be made to finish in either order - as a real clipboard, which answers over IPC,
 * may.
 */
function deferredClipboard(): { finish: (write: number) => void; writes: () => string[] } {
  const waiting: { text: string; resolve: () => void }[] = [];
  let held = '';
  const nav = globalThis.navigator as unknown as { clipboard?: unknown };
  nav.clipboard = {
    writeText: (text: string) =>
      new Promise<void>((resolve) => {
        waiting.push({
          text,
          resolve: () => {
            held = text;
            resolve();
          },
        });
      }),
    readText: () => Promise.resolve(held),
  };
  return {
    finish: (write: number) => {
      if (!waiting[write]) throw new Error(`no write ${write} is waiting (${waiting.length} are)`);
      waiting[write].resolve();
    },
    writes: () => waiting.map((w) => w.text),
  };
}

/** The tab's report of the last copy: whether it copied, what it said and the text it left to read. */
function copyReport(app: AppHarness): { status: string | null; words: string; text: string } {
  const panel = app.one('[data-crispr-copy-status]', 'the copy report');
  const text = app.one('[data-crispr-copy-text]', 'the copied text');
  return {
    status: panel.getAttribute('data-crispr-copy-status'),
    words: panel.textContent.replace(/\s+/g, ' ').trim(),
    text: text.textContent,
  };
}

const copyButton = (app: AppHarness, kind: 'spacer' | 'spacer-pam', guideId: string): LiveElement =>
  app.one(`[data-crispr-copy-${kind}="${guideId}"]`, `the Copy ${kind} control of ${guideId}`);

/** Saves the guide table in `format` through the table's own Export control and returns the file's text. */
async function exportGuides(app: AppHarness, format: 'TSV' | 'CSV'): Promise<{ filename: string; text: string }> {
  const before = app.downloads().length;
  await app.click(app.one('.mbc-figure-export-trigger', 'the guide table Export control'));
  const items = app.all('.mbc-figure-export-item').filter((b) => b.textContent.trim().startsWith(format));
  expect(items, `the Export menu offers ${format}`).toHaveLength(1);
  await app.click(items[0]);
  const files = app.downloads();
  expect(files.length, `one ${format} file saved`).toBe(before + 1);
  const file = files[files.length - 1];
  return { filename: file.filename, text: await file.text() };
}

/** A delimited export as a header list and rows keyed by column name. */
function parseDelimited(text: string, delimiter: '\t' | ','): { headers: string[]; rows: Record<string, string>[] } {
  const split = (line: string): string[] => {
    if (delimiter === '\t') return line.split('\t');
    const out: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cell); cell = ''; } else cell += ch;
    }
    out.push(cell);
    return out;
  };
  const lines = text.replace(/\n$/, '').split('\n');
  const headers = split(lines[0] ?? '');
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
  return { headers, rows };
}

/**
 * The scan callout as a researcher reads it on screen: the one sentence that states what the seed
 * count counted. Found by what it says, so no production markup exists only for this test.
 */
function seedMatchesCallout(app: AppHarness): string {
  const shown = app.all('.info-callout').filter((e) => e.textContent.includes('Seed matches'));
  expect(shown, 'the CRISPR tab states its seed matches once').toHaveLength(1);
  return shown[0].textContent.replace(/\s+/g, ' ').trim();
}

/**
 * The files the app's seed sentences live in (BG-01M7EZVV AC3). Both are swept, because the number
 * was hand-written in both and a guard that read one would pass a tree that still wrote it in the
 * other.
 */
const SEED_SENTENCE_FILES = ['src/core/crisprGuideText.ts', 'src/components/PrimerAndPCRStudio.tsx'];
/** A seed length written out as digits, in any wording - what no surface may do again. */
const DIGITS_BEFORE_SEED = /[0-9]+-nt [A-Za-z-]*\s*seed/;
/** A file of this tree, as it stands now. */
const treeSource = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The one exported row for the guide named `name`; any other count throws. */
function rowOf(rows: Record<string, string>[], name: string): Record<string, string> {
  const hits = rows.filter((r) => r.Guide === name);
  if (hits.length !== 1) throw new Error(`the export holds ${hits.length} rows for ${name}, not one`);
  return hits[0];
}

// ─── AC1: the spacer alone ───

describe('US-01M7DV5P AC1: Copy spacer puts the row\'s spacer bases alone on the clipboard', () => {
  it('US-01M7DV5P AC1 copies exactly the spacer bases, 5\'->3\', with no PAM and no label', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineScan(PLASMID, SPCAS9);
      expect(scan.report?.candidateCount, 'the fixture holds the four planted sites and nothing else').toBe(4);
      const listed = listedGuideIds(app);
      expect(listed, 'every planted guide is listed').toHaveLength(4);

      // Never the first row: a copy of the top-ranked spacer would pass that one by luck.
      for (const guideId of [listed[listed.length - 1], listed[1]]) {
        const guide = scan.guides.find((g) => g.id === guideId)!;
        expect(guide, `the engine's record for ${guideId}`).toBeTruthy();
        await app.click(copyButton(app, 'spacer', guideId));

        expect(await clipboardText(), `the clipboard holds ${guide.name}'s spacer and nothing else`).toBe(
          guide.spacerSeq
        );
        const onClipboard = await clipboardText();
        // No PAM: the site's own bases are 3 longer than this.
        expect(onClipboard).toHaveLength(guide.spacerSeq.length);
        expect(onClipboard, 'no label, no end marks, no FASTA header, no newline').toMatch(/^[ACGT]+$/);
        const report = copyReport(app);
        expect(report.status).toBe('copied');
        expect(report.words).toContain(guide.name);
        expect(report.text).toBe(guide.spacerSeq);
      }
    });
  });

  it('US-01M7DV5P AC1 copies a 5\'-PAM nuclease\'s spacer without its PAM either', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, DUAL);
      await chooseNuclease(app, CAS12A);
      const scan = await engineScan(DUAL, CAS12A);
      expect(scan.report?.candidateCount, 'one planted Cas12a site').toBe(1);
      const guide = scan.guides[0];
      expect(listedGuideIds(app)).toEqual([guide.id]);

      await app.click(copyButton(app, 'spacer', guide.id));
      const onClipboard = await clipboardText();
      expect(onClipboard).toBe(guide.spacerSeq);
      // The PAM leads this site, so a copy of the site's bases would start with it.
      expect(onClipboard.startsWith(guide.pamSeq), 'the leading PAM is not on the clipboard').toBe(false);
      expect(onClipboard).toHaveLength(guide.spacerSeq.length);
    });
  });
});

// ─── AC2: the spacer and its PAM, labelled, in the nuclease's own order ───

describe('US-01M7DV5P AC2: Copy spacer + PAM puts the parts in the nuclease\'s own order, labelled', () => {
  it('US-01M7DV5P AC2 writes spacer then PAM for a 3\'-PAM nuclease and PAM then spacer for a 5\'-PAM one, each part marked 5\'->3\' and never one oligo', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, DUAL);

      for (const nuclease of [SPCAS9, CAS12A]) {
        await chooseNuclease(app, nuclease);
        const scan = await engineScan(DUAL, nuclease);
        expect(scan.report?.candidateCount, `one planted ${nuclease} site`).toBe(1);
        const guide = scan.guides[0];
        expect(listedGuideIds(app), `the ${nuclease} row`).toEqual([guide.id]);

        await app.click(copyButton(app, 'spacer-pam', guide.id));
        const text = await clipboardText();

        // Each part is bracketed by its own 5' and 3' ends, in the order the PAM side dictates.
        const bracketed = [...text.matchAll(/5'-([ACGT]+)-3'/g)].map((m) => m[1]);
        const pamLeads = guide.pamSide.startsWith("5'");
        expect(bracketed, `${nuclease}: the parts and their order`).toEqual(
          pamLeads ? [guide.pamSeq, guide.spacerSeq] : [guide.spacerSeq, guide.pamSeq]
        );

        // Each part is labelled for what it is, with its own length - the record's, not SpCas9's.
        const lines = text.split('\n');
        const spacerLine = lines.find((l) => l.includes(`5'-${guide.spacerSeq}-3'`));
        const pamLine = lines.find((l) => l.includes(`5'-${guide.pamSeq}-3'`));
        expect(spacerLine, `${nuclease}: a line of its own for the spacer`).toBeDefined();
        expect(pamLine, `${nuclease}: a line of its own for the PAM`).toBeDefined();
        expect(spacerLine!.toLowerCase()).toContain('spacer');
        expect(spacerLine!).toContain(`${guide.spacerSeq.length} nt`);
        expect(pamLine!).toContain('PAM');
        expect(pamLine!).toContain(guide.pamSide);
        expect(pamLine!).toContain(`${guide.pamSeq.length} nt`);
        expect(pamLine!, 'the PAM says it is read, not ordered').toMatch(/not ordered|not part of the spacer/i);

        // It cannot be read as one oligo: the two parts are nowhere joined, and the longest run of
        // bases in the text is the spacer's own length - never the site's 23 or 24.
        expect(text).not.toContain(guide.spacerSeq + guide.pamSeq);
        expect(text).not.toContain(guide.pamSeq + guide.spacerSeq);
        const runs = text.match(/[ACGT]{8,}/g) ?? [];
        expect(runs, `${nuclease}: the only long run of bases is the spacer`).toEqual([guide.spacerSeq]);
        expect(text).toContain(guide.name);
        expect(copyReport(app).status).toBe('copied');
      }
    });
  });
});

// ─── AC3: a copy the environment refuses ───

describe('US-01M7DV5P AC3: a refused copy says nothing was copied and leaves the text to read', () => {
  it('US-01M7DV5P AC3 reports a clipboard that refuses and a build with no clipboard apart, and never reports a successful copy', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineScan(PLASMID, SPCAS9);
      const listed = listedGuideIds(app);
      const guideId = listed[listed.length - 1];
      const guide = scan.guides.find((g) => g.id === guideId)!;

      // A clipboard that refuses the write (no permission).
      breakClipboard('refuses', 'Write permission denied.');
      await app.click(copyButton(app, 'spacer', guideId));
      const refused = copyReport(app);
      expect(refused.status, 'a refused copy is never reported as a copy').toBe('not-copied');
      expect(refused.words).toMatch(/nothing was copied/i);
      expect(refused.words, 'the refusal itself is named').toMatch(/refus|permission/i);
      expect(refused.text, 'the text is still there to read').toBe(guide.spacerSeq);
      expect(app.doc.body.textContent, 'nowhere does the page claim a copy').not.toMatch(
        /Copied [^.]*to the clipboard/
      );

      // A build whose environment provides no clipboard at all (the standalone HTML build, PRD F31).
      breakClipboard('absent');
      await app.click(copyButton(app, 'spacer-pam', guideId));
      const missing = copyReport(app);
      expect(missing.status).toBe('not-copied');
      expect(missing.words).toMatch(/nothing was copied/i);
      expect(missing.words, 'a clipboard that is not there is not a clipboard that refused').toMatch(
        /no clipboard|clipboard is not available|provides no clipboard/i
      );
      expect(missing.words, 'the two are told apart (LC-006)').not.toBe(refused.words);
      expect(missing.text, 'the labelled text is still there to read').toContain(guide.spacerSeq);
      expect(missing.text).toContain(guide.pamSeq);
      expect(app.doc.body.textContent).not.toMatch(/Copied [^.]*to the clipboard/);
    });
  });
});

// ─── AC4: the export ───

/** The columns AC4 names, by the heading the export writes them under. */
const REQUIRED_COLUMNS = [
  'Guide',
  "Spacer (5'->3')",
  'PAM',
  'PAM Side',
  'Strand',
  'Start',
  'End',
  'Cut Position',
  'Cut Convention',
  'GC%',
  'Heuristic Rank',
  'Heuristic Rank Rule',
  'Exact Seed Matches',
  'Seed Match Scope',
  'Nuclease Preset',
  'Interval Searched',
  'Sequence Revision',
  'Rows Exported',
];

describe('US-01M7DV5P AC4: the export carries each guide with its coordinates and score provenance', () => {
  it('US-01M7DV5P AC4 writes TSV and CSV of the selected rows, and of every row shown when none is selected, saying which', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineScan(PLASMID, SPCAS9);
      const rule = await engineRankRule(PLASMID);
      const revision = await engineRevision(PLASMID);
      const listed = listedGuideIds(app);
      expect(listed).toHaveLength(4);

      // No row selected: every row the table shows, and the file says that is why.
      const tsv = await exportGuides(app, 'TSV');
      expect(tsv.filename).toMatch(/\.tsv$/i);
      expect(tsv.filename.toLowerCase()).toContain('crispr');
      const all = parseDelimited(tsv.text, '\t');
      for (const column of REQUIRED_COLUMNS) {
        expect(all.headers, `the export carries a ${column} column`).toContain(column);
      }
      expect(all.rows.map((r) => r.Guide).sort()).toEqual(scan.guides.map((g) => g.name).sort());
      for (const row of all.rows) {
        expect(row['Rows Exported']).toMatch(/no row was selected/i);
        expect(row['Rows Exported']).toContain('4');
      }

      // Every cell of one row is the engine's own answer for that guide, not the cell on screen.
      const guide = scan.guides.find((g) => g.id === listed[listed.length - 1])!;
      const row = rowOf(all.rows, guide.name);
      expect(row["Spacer (5'->3')"]).toBe(guide.spacerSeq);
      expect(row.PAM).toContain(guide.pamSeq);
      expect(row['PAM Side']).toContain(guide.pamSide);
      expect(row.Strand).toMatch(guide.strand === 1 ? /forward|\+/i : /reverse|-/i);
      expect(Number(row.Start)).toBe(guide.start);
      expect(Number(row.End)).toBe(guide.end);
      expect(Number(row['Cut Position'])).toBe(guide.cutPosition);
      expect(row['Cut Convention']).toBe(guide.cutConvention);
      expect(Number(row['GC%'])).toBe(guide.gcPercent);
      expect(Number(row['Heuristic Rank'])).toBe(guide.onTargetScore);
      expect(row['Heuristic Rank Rule'], 'the rule is the engine\'s own description').toBe(
        rule.replace(/\s+/g, ' ').trim()
      );
      expect(Number(row['Exact Seed Matches'])).toBe(guide.offTargetCount);
      // The scope in the formatter's own words (BG-01M7FH8K AC3): a shape match here passed any
      // wording at all that named the seed.
      const { crisprScanReadAs } = await import('../core/crisprGuideText');
      expect(row['Seed Match Scope']).toContain(`seed across ${crisprScanReadAs(scan.report!, PLASMID.topology)}`);
      expect(row['Seed Match Scope'], 'the count is not a genome-wide one').toMatch(/genome-wide/i);
      expect(row['Nuclease Preset']).toContain(guide.nuclease);
      expect(row['Interval Searched']).toMatch(/no interval/i);
      expect(row['Interval Searched']).toContain('300');
      expect(row['Sequence Revision']).toBe(revision);
      // A blunt cutter has no second cut, and it is never exported as 0 (US-01M7DV29 AC4).
      expect(all.headers).toContain('Second Cut (Target Strand)');
      expect(row['Second Cut (Target Strand)']).not.toMatch(/^0$/);
      expect(row['Second Cut (Target Strand)']).toMatch(/\D/);

      // Two rows selected - never the first - and only those are written, in both forms.
      const chosen = [listed[1], listed[3]].map((id) => scan.guides.find((g) => g.id === id)!);
      for (const g of chosen) {
        await app.change(app.one(`[data-crispr-select="${g.id}"]`, `the selection box of ${g.id}`), true);
      }
      const selectedTsv = parseDelimited((await exportGuides(app, 'TSV')).text, '\t');
      expect(selectedTsv.rows.map((r) => r.Guide).sort()).toEqual(chosen.map((g) => g.name).sort());
      for (const r of selectedTsv.rows) {
        expect(r['Rows Exported']).toMatch(/2 of the 4 rows/i);
        expect(r['Rows Exported']).not.toMatch(/no row was selected/i);
      }
      const csv = await exportGuides(app, 'CSV');
      expect(csv.filename).toMatch(/\.csv$/i);
      const selectedCsv = parseDelimited(csv.text, ',');
      expect(selectedCsv.headers).toEqual(selectedTsv.headers);
      expect(selectedCsv.rows.map((r) => r.Guide).sort()).toEqual(chosen.map((g) => g.name).sort());
      expect(rowOf(selectedCsv.rows, chosen[0].name)['Cut Convention']).toBe(chosen[0].cutConvention);
    });
  });

  it('US-01M7DV5P AC4 exports an interval scan as the interval it is, with a seed count scoped to it', async () => {
    await withApp(async (app) => {
      // The chooser prefers the span on screen (D0135), so this scan searched 101..240 alone.
      await onCrisprTab(app, PLASMID, { start: 101, end: 240 });
      const scan = await engineScan(PLASMID, SPCAS9, { start: 101, end: 240 });
      const interval = scan.report?.searchedInterval;
      expect(interval, 'the engine searched the interval asked for').toBeDefined();
      expect(listedGuideIds(app).length, 'the sites inside the interval').toBe(scan.guides.length);

      const rows = parseDelimited((await exportGuides(app, 'TSV')).text, '\t').rows;
      expect(rows).toHaveLength(scan.guides.length);
      for (const row of rows) {
        expect(row['Interval Searched']).toContain(`${interval!.start}..${interval!.end}`);
        expect(row['Interval Searched']).toContain(`${interval!.lengthBp} bp`);
        expect(row['Seed Match Scope'], 'an interval specificity, not a sequence-wide one').toMatch(
          /interval searched/i
        );
        expect(row['Seed Match Scope']).toContain(`${interval!.start}..${interval!.end}`);
        expect(row['Seed Match Scope']).not.toMatch(/all 300 bases/);
      }
    });
  });
});

// ─── AC5: the row's own coordinates ───

describe('US-01M7DV5P AC5: the exported coordinates are the row\'s own', () => {
  it('US-01M7DV5P AC5 exports a guide across the origin as start > end, with the convention in the file and a length counted round the origin', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineScan(PLASMID, SPCAS9);
      const crossing = scan.guides.filter((g) => g.start > g.end);
      expect(crossing, 'the fixture plants one site across the origin').toHaveLength(1);
      const guide = crossing[0];

      const table = parseDelimited((await exportGuides(app, 'TSV')).text, '\t');
      const row = rowOf(table.rows, guide.name);
      expect(Number(row.Start), 'the start is the row\'s own').toBe(guide.start);
      expect(Number(row.End)).toBe(guide.end);
      expect(Number(row.Start), 'not a swapped pair').toBeGreaterThan(Number(row.End));
      expect(table.headers).toContain('Site Length (bp)');
      // 23 bases round the origin, never a negative length and never the long way round.
      const siteLength = Number(row['Site Length (bp)']);
      expect(siteLength).toBe(PLASMID_LEN - guide.start + 1 + guide.end);
      expect(siteLength).toBe(guide.spacerSeq.length + guide.pamSeq.length);
      expect(siteLength).toBeGreaterThan(0);
      expect(siteLength).not.toBe(Number(row.End) - Number(row.Start) + 1);

      // The convention is stated in the file, on the row it applies to.
      expect(table.headers).toContain('Coordinate Convention');
      expect(row['Coordinate Convention']).toMatch(/1-based/i);
      expect(row['Coordinate Convention']).toMatch(/inclusive/i);
      expect(row['Coordinate Convention']).toMatch(/plus strand/i);
      expect(row['Coordinate Convention']).toMatch(/across the origin/i);

      // Every other row ascends, and says so under the same convention.
      for (const other of table.rows.filter((r) => r.Guide !== guide.name)) {
        expect(Number(other.Start)).toBeLessThan(Number(other.End));
        expect(Number(other['Site Length (bp)'])).toBe(Number(other.End) - Number(other.Start) + 1);
        expect(other['Coordinate Convention']).toMatch(/1-based/i);
      }
    });
  });
});

/*
 * BG-01M7EZVV: the four claims above were right in the code and held by nothing a fixture could
 * exercise. Every fixture of US-01M7DV5P listed forward SpCas9 guides alone, so the export's
 * `-` strand branch and its whole 5'-PAM nuclease row were never read, and the copy report was
 * taken on trust from a `writeText` that resolved. Each test below names the mutant it kills.
 */

// ─── AC1: the strand cell, on both of its branches ───

describe("BG-01M7EZVV AC1: the export's strand cell is held on both branches", () => {
  it("BG-01M7EZVV AC1 a reverse-strand guide exports its own strand, and a forward one its own", async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, STRANDS);
      const scan = await engineScan(STRANDS, SPCAS9);
      expect(scan.report?.candidateCount, 'the two planted sites and nothing else').toBe(2);
      const reverse = scan.guides.find((g) => g.strand === -1);
      const forward = scan.guides.find((g) => g.strand === 1);
      expect(reverse, 'the fixture reaches the minus strand').toBeDefined();
      expect(forward, 'and the plus strand, so both branches are read').toBeDefined();
      // The minus-strand guide is read off its own strand: its spacer is the planted one, not the
      // plus-strand bases its coordinates span.
      expect(reverse!.spacerSeq).toBe(STRANDS_REVERSE.spacer);
      expect(forward!.spacerSeq).toBe(STRANDS_FORWARD.spacer);
      expect(listedGuideIds(app).slice().sort()).toEqual(scan.guides.map((g) => g.id).sort());

      const rows = parseDelimited((await exportGuides(app, 'TSV')).text, '\t').rows;
      const reverseRow = rowOf(rows, reverse!.name);
      const forwardRow = rowOf(rows, forward!.name);

      // Kills `'Reverse (-)'` -> `'Forward (+)'`, the swap of the two arms, and one label for both.
      expect(reverseRow.Strand, 'the minus-strand row says the strand it is on').toBe('Reverse (-)');
      expect(forwardRow.Strand).toBe('Forward (+)');
      expect(reverseRow.Strand, 'the two branches are not the same cell').not.toBe(forwardRow.Strand);

      // The rest of the reverse row is that guide's own too, not its plus-strand reading.
      expect(reverseRow["Spacer (5'->3')"]).toBe(reverse!.spacerSeq);
      expect(reverseRow.PAM).toContain(reverse!.pamSeq);
      expect(Number(reverseRow.Start)).toBe(reverse!.start);
      expect(Number(reverseRow.End)).toBe(reverse!.end);
      expect(Number(reverseRow['Site Length (bp)'])).toBe(
        reverse!.spacerSeq.length + reverse!.pamSeq.length
      );
      expect(Number(reverseRow['Cut Position'])).toBe(reverse!.cutPosition);
    });
  });
});

// ─── AC2: a 5'-PAM nuclease's own site facts ───

describe("BG-01M7EZVV AC2: the export carries a Cas12a guide's own site facts", () => {
  it('BG-01M7EZVV AC2 a Cas12a guide exports its own PAM side, pattern, site length and second cut', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, DUAL);
      // The same record read by both presets, so the 3'-PAM nuclease's own answer is on hand to
      // contradict every cell a hard-coded SpCas9 literal would write (LC-002).
      const spcas9 = await engineScan(DUAL, SPCAS9);
      const blunt = spcas9.guides[0];
      await chooseNuclease(app, CAS12A);
      const scan = await engineScan(DUAL, CAS12A);
      expect(scan.report?.candidateCount, 'one planted Cas12a site').toBe(1);
      const guide = scan.guides[0];
      expect(listedGuideIds(app), 'the Cas12a row the chooser listed').toEqual([guide.id]);

      const rows = parseDelimited((await exportGuides(app, 'TSV')).text, '\t').rows;
      expect(rows).toHaveLength(1);
      const row = rowOf(rows, guide.name);

      // The PAM side and pattern are the record's own. Kills the literal
      // `3' of the spacer (pattern NGG)`, which is what the other preset on this record says.
      expect(row['PAM Side']).toBe(`${guide.pamSide} of the spacer (pattern ${guide.pamPattern})`);
      expect(guide.pamSide, "Cas12a reads its PAM on the other side").not.toBe(blunt.pamSide);
      expect(guide.pamPattern, 'and by another pattern').not.toBe(blunt.pamPattern);
      expect(row['PAM Side'], "never the 3'-PAM nuclease's cell").not.toBe(
        `${blunt.pamSide} of the spacer (pattern ${blunt.pamPattern})`
      );
      expect(row.PAM).toContain(guide.pamSeq);

      // Its own site length, counted from its own spacer and PAM - never the other preset's.
      const siteSpan = guide.spacerSeq.length + guide.pamSeq.length;
      expect(Number(row['Site Length (bp)'])).toBe(siteSpan);
      expect(siteSpan, "the 5'-PAM site is not the 3'-PAM one").not.toBe(
        blunt.spacerSeq.length + blunt.pamSeq.length
      );

      // A staggered cutter reports a second cut, and the cell is that coordinate, not a word.
      expect(guide.cutPositionTargetStrand, "the engine reports Cas12a's second cut").toBeDefined();
      expect(row['Second Cut (Target Strand)']).toBe(String(guide.cutPositionTargetStrand));
      expect(Number(row['Second Cut (Target Strand)']), 'the cut is staggered').not.toBe(
        guide.cutPosition
      );
      // And the blunt cutter on the same record reports none, which is never written as a number.
      expect(blunt.cutPositionTargetStrand, 'SpCas9 reports one cut position').toBeUndefined();

      // The preset cell and the cut convention are this nuclease's own as well.
      expect(row['Nuclease Preset']).toContain(guide.nuclease);
      expect(row['Nuclease Preset']).toContain(guide.pamPattern);
      expect(row['Nuclease Preset']).toContain(String(siteSpan));
      expect(row['Cut Convention']).toBe(guide.cutConvention);
      expect(row['Cut Convention'], "not the blunt cutter's convention").not.toBe(
        blunt.cutConvention
      );
    });
  });
});

// ─── AC3: one source for the seed length ───

describe('BG-01M7EZVV AC3: the seed length is stated from one source', () => {
  it('BG-01M7EZVV AC3 every CRISPR seed sentence states its length from one source', async () => {
    const { CRISPR_SEED_LENGTH_BP } = await import('../core/crisprGuideText');
    // Every figure asserted below is this constant, read from the module the surfaces read. A test
    // that restated the number would pass a surface that had drifted away from it, which is the
    // defect this criterion is about.
    const stated = `${CRISPR_SEED_LENGTH_BP}-nt PAM-proximal seed`;

    // A whole-sequence scan: the sentence on screen, and the export's own cell.
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      expect(seedMatchesCallout(app), 'the panel states the seed it counted').toContain(stated);
      const rows = parseDelimited((await exportGuides(app, 'TSV')).text, '\t').rows;
      expect(rows.length, 'rows to read the cell of').toBeGreaterThan(0);
      for (const row of rows) expect(row['Seed Match Scope']).toContain(stated);
    });

    // An interval scan: the other arm of both sentences (the chooser prefers the span on screen,
    // D0135), so neither file's interval branch keeps a number of its own.
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID, { start: 101, end: 240 });
      const panel = seedMatchesCallout(app);
      expect(panel, "the panel's interval arm").toContain(stated);
      expect(panel, 'and it is the interval arm that was read').toMatch(/interval searched/i);
      const rows = parseDelimited((await exportGuides(app, 'TSV')).text, '\t').rows;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row['Seed Match Scope']).toContain(stated);
        expect(row['Seed Match Scope']).toMatch(/interval searched/i);
      }
    });

    // And the sweep, over both files. Four of the five sentences are driven above; the fifth is the
    // panel's bounded-prefix arm, which needs a record longer than the engine's scan bound, and the
    // sweep is all that holds it. A guard scoped to one file would pass a tree that had removed
    // the export's two literals and kept the studio's three - the repair this criterion names.
    for (const path of SEED_SENTENCE_FILES) {
      const source = treeSource(path);
      expect(
        source.match(DIGITS_BEFORE_SEED),
        `${path} states the seed length from the constant, never as digits`
      ).toBeNull();
      expect(source.includes('${CRISPR_SEED_LENGTH_BP}-nt'), `${path} reads that constant`).toBe(
        true
      );
    }
    const declared = SEED_SENTENCE_FILES.map(
      (path) => treeSource(path).match(/const CRISPR_SEED_LENGTH_BP\b/g)?.length ?? 0
    ).reduce((a, b) => a + b, 0);
    expect(declared, 'the number is declared once in the tree, not once per file').toBe(1);
  });
});

// ─── AC4: a copy reported only as far as the page can tell ───

describe('BG-01M7EZVV AC4: a copy is reported only as far as the page can tell', () => {
  it('BG-01M7EZVV AC4 a write that resolves without writing is not reported as a copy, and the last click is the report on screen', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineScan(PLASMID, SPCAS9);
      const listed = listedGuideIds(app);
      const first = scan.guides.find((g) => g.id === listed[1])!;
      const last = scan.guides.find((g) => g.id === listed[listed.length - 1])!;
      expect(first.spacerSeq, 'two rows with text of their own').not.toBe(last.spacerSeq);

      // (a) The write resolves, the clipboard goes on holding other text, and the build lets the
      // page read it back: the page can tell, and says nothing was copied. Kills treating a
      // resolved `writeText` as proof of a write.
      const kept = 'WHATEVER THE CLIPBOARD HELD BEFORE';
      droppingClipboard(kept, true);
      await app.click(copyButton(app, 'spacer', last.id));
      const dropped = copyReport(app);
      expect(dropped.status, 'a write that did not land is not a copy').toBe('not-copied');
      expect(dropped.words).toMatch(/nothing was copied/i);
      expect(dropped.words, 'and why: the clipboard held other text').toMatch(/other text/i);
      expect(dropped.words, 'the clipboard refused nothing, so it is not called a refusal').not.toMatch(
        /refused it/i
      );
      expect(dropped.text, 'the text is still there to take by hand').toBe(last.spacerSeq);
      expect(app.doc.body.textContent, 'nowhere does the page claim a copy').not.toMatch(
        /Copied [^.]*to the clipboard/
      );

      // (b) The write resolves and no read-back is permitted: the page cannot tell, says so, and
      // still never claims a copy (LC-006).
      droppingClipboard(kept, false);
      await app.click(copyButton(app, 'spacer-pam', last.id));
      const unconfirmed = copyReport(app);
      expect(unconfirmed.status, 'a copy the page cannot confirm is not reported as one').not.toBe(
        'copied'
      );
      expect(unconfirmed.words, 'the panel states the limit').toMatch(/cannot confirm/i);
      expect(unconfirmed.words, 'and names what it cannot do').toMatch(/read the clipboard back/i);
      expect(unconfirmed.words, 'not told as a refusal either (LC-006)').not.toMatch(/refused it/i);
      expect(
        unconfirmed.words,
        'and not in the words of the write the page could read back as other text'
      ).not.toBe(dropped.words);
      expect(unconfirmed.text).toContain(last.spacerSeq);
      expect(app.doc.body.textContent).not.toMatch(/Copied [^.]*to the clipboard/);

      // (c) Two copies in quick succession, finishing in the order a real clipboard could: the
      // later click finishes first, the earlier one last. Kills leaving the `setCrisprCopy` calls
      // unsequenced, which leaves the earlier click's report on screen as the answer to the later.
      const clipboard = deferredClipboard();
      await app.click(copyButton(app, 'spacer', first.id));
      await app.click(copyButton(app, 'spacer', last.id));
      expect(clipboard.writes(), 'both clicks reached the clipboard, neither has finished').toEqual([
        first.spacerSeq,
        last.spacerSeq,
      ]);
      // The finish order is the whole proof, and it is reversed on purpose: the later click's
      // write (1) finishes first, the earlier click's (0) last. Measured - with these two lines in
      // click order instead, the unsequenced `setCrisprCopy` passes this test, because the later
      // click would then also report last and nothing would tell the two implementations apart.
      // Tidying them into ascending order silently voids this case.
      clipboard.finish(1);
      await app.settle();
      clipboard.finish(0);
      await app.settle();
      const latest = copyReport(app);
      expect(latest.text, "the later click's text is the report on screen").toBe(last.spacerSeq);
      expect(latest.text, "not the earlier click's, which finished last").not.toBe(first.spacerSeq);
      expect(latest.words).toContain(last.name);
      expect(latest.words, "the earlier click's guide is not named").not.toContain(first.name);
      expect(latest.status, 'and it is reported as the copy it was read back as').toBe('copied');
    });
  });
});

// ─── BG-01M7FH8K: the export's scope cell reads the one formatter, on every branch ───

/**
 * The export's `Seed Match Scope` cell wrote a seed count's scope in its own words (`seedScopeText`)
 * while the callout and the Top 5 annotation note read the studio's formatter - so a cell edited
 * alone, `inside the interval searched` to `within the range read`, left every test green and the
 * spreadsheet a researcher sends on describing the count differently from the screen. The cell now
 * reads `crisprScanReadAs` in src/core/crisprGuideText.ts, the formatter lifted beside it, and
 * these three cases hold it there on every branch the formatter can print.
 *
 * Wrong implementations these kill:
 * - AC1: an export cell, callout or note that words any branch of the scope otherwise - a frame of
 *   the export's own, a dropped `across the origin` - and an export that keeps the scope but
 *   loses a fact the formatter does not carry
 *   (the interval specificity, `no copy outside it`, `No genome-wide off-target search was run.`).
 * - AC2: a fixed list of four fixtures, so a fifth branch added to the formatter goes unread; and a
 *   derivation that silently finds fewer arms than the formatter returns.
 * - AC3: `seedScopeText`'s or `scannedRangeText`'s own scope literals left in the file, live or
 *   dead; a cell whose words outside the formatter's phrase state a scope of their own; a report the
 *   engine never sent exported as a scope.
 */

/** Seeded pseudo-random DNA (LCG): the bases BG-01M7FCDY's fixtures reach all four branches with. */
function seededBases(length: number, seed: number): string {
  let x = seed >>> 0;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = 'ACGT'[x >>> 30];
  }
  return out.join('');
}

const SCOPE_LINEAR = dnaDoc('fh8k-linear', 'pFH8K_Linear', seededBases(300, 0x15_7a01), 'linear');
const SCOPE_CIRCULAR = dnaDoc('fh8k-circular', 'pFH8K_Circular', seededBases(400, 0x15_7b02), 'circular');
/**
 * A plasmid shorter than an SpCas9 site: the engine reads it straight, not round its origin
 * (`scannedCircular` false), and finds no guide - the one shape in which the shipped engine reports
 * a circular record read without crossing its origin.
 */
const SCOPE_UNDER_SITE = dnaDoc('fh8k-under-site', 'pFH8K_Under_Site', seededBases(20, 0x15_7e05), 'circular');
/** 100 bases past the engine's scan bound: the one shape the studio shows a bounded prefix in. */
const SCOPE_PAST_BOUND = dnaDoc('fh8k-past-bound', 'pFH8K_Past_Bound', seededBases(8_000_100, 0x15_7d04), 'linear');

/** A count of bases as every surface in the app writes it. */
const basesText = (n: number) => n.toLocaleString('en-US');

/** The callout's seed-match sentence alone: what it says between `Seed matches:` and its genome-wide note. */
function calloutSeedSentence(app: AppHarness): string {
  const m = /Seed matches:\s*([\s\S]*?)\(no genome-wide off-target search\)/.exec(seedMatchesCallout(app));
  if (!m) throw new Error('the CRISPR callout holds no "Seed matches" sentence');
  return m[1].trim();
}

/** Presses the tab's own `+ Annotate Top 5 Guides` button. */
async function annotateTopFive(app: AppHarness): Promise<void> {
  const buttons = app
    .all('button')
    .filter((b) => b.textContent.replace(/\s+/g, ' ').includes('+ Annotate Top 5 Guides'));
  expect(buttons, 'the CRISPR tab shows one "+ Annotate Top 5 Guides" button').toHaveLength(1);
  await app.click(buttons[0]);
}

/** The scope clause of every seed-count note in the document the App saves (File > Save Session). */
async function savedNoteScopes(app: AppHarness, docId: string): Promise<string[]> {
  const before = app.downloads().length;
  await app.menu('file:save-session');
  const files = app.downloads();
  expect(files.length, 'File > Save Session saves one file').toBe(before + 1);
  const payload = JSON.parse(await files[files.length - 1].text()) as {
    documents: { id: string; features: { notes?: string }[] }[];
  };
  const saved = payload.documents.find((d) => d.id === docId);
  if (!saved) throw new Error(`the saved session holds no document "${docId}"`);
  return saved.features
    .map((f) => /seed matches=\d+[,.]?\s*counted over ([\s\S]*?)(?: — an interval specificity|$)/.exec(f.notes ?? '')?.[1])
    .filter((s): s is string => s !== undefined);
}

/**
 * The formatter's phrase as an exported cell holds it: everything after `seed across` up to the
 * export's own claims. Read by the cell's frame, not by the formatter, so AC2 decides which branch
 * the CELL printed rather than which one the formatter would have.
 */
const cellPhrase = (cell: string): string =>
  /PAM-proximal seed across ([\s\S]*?)(?:, and no copy outside it|\. No genome-wide)/.exec(cell)?.[1] ?? '';

/** One scan shape, as the export, the callout and the saved note each state it. */
type ExportedBranch = {
  branch: string;
  /** Set where the case is a second reading of an arm another case already reaches. */
  variantOf?: string;
  /** The molecule and the report the exported cells were written from. */
  doc: SequenceDocument;
  report: NonNullable<Awaited<ReturnType<typeof engineScan>>['report']>;
  /** The molecule and the report the callout was read from: the same, but for the synthetic case. */
  seedDoc: SequenceDocument;
  seedReport: NonNullable<Awaited<ReturnType<typeof engineScan>>['report']>;
  cells: string[];
  intervalCells: string[];
  seedSaid: string;
  noteScopes: string[];
};

let exportedBranchesOnce: Promise<ExportedBranch[]> | undefined;

/** Every scan shape the formatter can print, read from one launch of the real App. */
const exportedBranches = (): Promise<ExportedBranch[]> =>
  (exportedBranchesOnce ??= (async () => {
    const cases: {
      branch: string;
      variantOf?: string;
      doc: SequenceDocument;
      interval?: { start: number; end: number };
    }[] = [
      { branch: 'interval', doc: SCOPE_CIRCULAR, interval: { start: 101, end: 300 } },
      // The interval arm's other side: an interval across the origin, which must say so.
      { branch: 'interval across the origin', variantOf: 'interval', doc: SCOPE_CIRCULAR, interval: { start: 380, end: 140 } },
      { branch: 'bounded prefix', doc: SCOPE_PAST_BOUND },
      { branch: 'circular whole', doc: SCOPE_CIRCULAR },
      { branch: 'linear whole', doc: SCOPE_LINEAR },
    ];
    const app = await mountApp();
    try {
      const read: ExportedBranch[] = [];
      // The fifth arm, a circular record read without crossing its origin. The shipped engine
      // reaches it only on a plasmid shorter than a site, which the studio shows - its callout is
      // read here - but which holds no guide to export. Its cells are written by the export itself
      // from the whole plasmid's own guides under that plasmid's report with the origin read
      // cleared: the one synthetic report in these cases, and named as one.
      {
        const branch = 'circular not read across its origin';
        await onCrisprTab(app, SCOPE_UNDER_SITE);
        const under = await engineScan(SCOPE_UNDER_SITE, SPCAS9);
        expect(under.report, `${branch}: the engine read the plasmid straight`).toMatchObject({
          scannedCircular: false,
          originSpanBp: 0,
        });
        expect(under.guides, `${branch}: a plasmid under one site holds no guide`).toHaveLength(0);
        const seedSaid = calloutSeedSentence(app);
        const whole = await engineScan(SCOPE_CIRCULAR, SPCAS9);
        const report = { ...whole.report!, scannedCircular: false, originSpanBp: 0 };
        const { crisprGuideExportTable } = await import('../core/crisprGuideText');
        const table = crisprGuideExportTable({
          guides: whole.guides,
          document: SCOPE_CIRCULAR,
          scan: report,
          heuristicRule: await engineRankRule(SCOPE_CIRCULAR),
          scope: { selectedCount: 0, shownCount: whole.guides.length },
        });
        const column = (name: string) => table.rows.map((r) => r[table.headers.indexOf(name)]);
        read.push({
          branch,
          doc: SCOPE_CIRCULAR,
          report,
          seedDoc: SCOPE_UNDER_SITE,
          seedReport: under.report!,
          cells: column('Seed Match Scope'),
          intervalCells: column('Interval Searched'),
          seedSaid,
          noteScopes: [],
        });
      }
      for (const { branch, variantOf, doc, interval } of cases) {
        await onCrisprTab(app, doc, interval);
        const scan = await engineScan(doc, SPCAS9, interval);
        expect(scan.report, `${branch}: the engine sent a scan report`).toBeTruthy();
        expect(scan.guides.length, `${branch}: the fixture holds guides to export`).toBeGreaterThan(0);
        const seedSaid = calloutSeedSentence(app);
        const rows = parseDelimited((await exportGuides(app, 'TSV')).text, '\t').rows;
        expect(rows.length, `${branch}: the export writes the rows shown`).toBe(listedGuideIds(app).length);
        await annotateTopFive(app);
        const noteScopes = await savedNoteScopes(app, doc.id);
        expect(noteScopes.length, `${branch}: one seed count stated per guide annotated`).toBe(
          Math.min(5, scan.guides.length)
        );
        read.push({
          branch,
          ...(variantOf ? { variantOf } : {}),
          doc,
          report: scan.report!,
          seedDoc: doc,
          seedReport: scan.report!,
          cells: rows.map((r) => r['Seed Match Scope']),
          intervalCells: rows.map((r) => r['Interval Searched']),
          seedSaid,
          noteScopes,
        });
      }
      return read;
    } finally {
      app.unmount();
    }
  })());

/** The formatter's declaration, as src/core/crisprGuideText.ts holds it now. */
const formatterSource = (): string => {
  const decl = /export function crisprScanReadAs\([\s\S]*?\n}\n/.exec(treeSource('src/core/crisprGuideText.ts'));
  if (!decl) throw new Error('src/core/crisprGuideText.ts declares no `crisprScanReadAs` to derive from');
  return decl[0];
};

/**
 * The formatter's arms, read out of its own source - one regular expression per branch it can
 * print, each `${...}` left free - with the count of its `return`s beside them, counted apart so a
 * derivation that finds fewer arms than the formatter returns fails rather than passing on the arms
 * it did find.
 */
const formatterArms = (): { arms: string[]; patterns: RegExp[]; returns: number } => {
  const source = formatterSource();
  const arms = source.match(/`[^`]*`/g) ?? [];
  const returns = (source.match(/\breturn\b/g) ?? []).length;
  const patterns = arms.map(
    (arm) =>
      new RegExp(
        `^${arm
          .slice(1, -1)
          .split(/\$\{[^}]*\}/)
          .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[\\s\\S]*?')}$`
      )
  );
  return { arms, patterns, returns };
};

describe("BG-01M7FH8K AC1: the export's scope cell, the callout and the note state one phrase", () => {
  it("BG-01M7FH8K AC1 the exported scope cell states the formatter's phrase on every branch", async () => {
    const { crisprScanReadAs } = await import('../core/crisprGuideText');
    // One formatter, in core: the studio calls it and the specificity clause, and keeps no copy.
    const studio = treeSource('src/components/PrimerAndPCRStudio.tsx');
    expect(studio, 'the studio reads the scope from core').toMatch(/crisprScanReadAs\(crisprScan, doc\.topology\)/);
    expect(studio, 'and the interval specificity too').toMatch(/crisprIntervalSpecificityText\(crisprScan\)/);
    for (const { branch, doc, report, seedDoc, seedReport, cells, seedSaid, noteScopes } of await exportedBranches()) {
      const phrase = crisprScanReadAs(report, doc.topology);
      // The identical phrase on all three surfaces: the cell that travels in the file, the sentence
      // on screen and the note the saved document carries.
      expect(cells.length, `${branch}: there are exported cells to read`).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cellPhrase(cell), `${branch}: the exported cell states the formatter's phrase`).toBe(phrase);
      }
      expect(seedSaid, `${branch}: the callout states the formatter's phrase`).toContain(
        `seed across ${crisprScanReadAs(seedReport, seedDoc.topology)}`
      );
      for (const scope of noteScopes) {
        expect(scope, `${branch}: the saved note states the formatter's phrase`).toBe(phrase);
      }
      // The facts the formatter does not carry and the cell did before this fix, each still there.
      const readPartOfIt =
        report.searchedInterval !== undefined || report.scannedLengthBp < report.sequenceLengthBp;
      for (const cell of cells) {
        expect(cell, `${branch}: the count is not a genome-wide one`).toContain(
          'No genome-wide off-target search was run.'
        );
        expect(
          cell.includes('and no copy outside it'),
          `${branch}: a scan of part of the record says no copy lies outside it, and only that one`
        ).toBe(readPartOfIt);
        expect(
          cell.includes('across the origin'),
          `${branch}: an interval says it runs across the origin where it does, and only there`
        ).toBe(report.searchedInterval?.crossesOrigin === true);
        expect(
          cell.includes(`an interval specificity, not one over the whole ${basesText(report.sequenceLengthBp)} bases`),
          `${branch}: an interval count says it is not one over the whole sequence, and only it`
        ).toBe(report.searchedInterval !== undefined);
      }
    }
  }, 600_000);
});

describe("BG-01M7FH8K AC2: the export's branch list is the formatter's own", () => {
  it("BG-01M7FH8K AC2 the exported branch list is derived from the formatter's source", async () => {
    const { arms, patterns, returns } = formatterArms();
    expect(arms.length, 'the derivation finds an arm for every `return` the formatter makes').toBe(returns);
    // A variant re-reads an arm another case reaches; it is not a branch of its own.
    const branches = (await exportedBranches()).filter((b) => b.variantOf === undefined);
    expect(
      (await exportedBranches()).some((b) => b.variantOf === 'interval' && b.report.searchedInterval?.crossesOrigin),
      'the origin-crossing variant searched an interval across the origin'
    ).toBe(true);
    expect(
      patterns.length,
      'every branch the formatter can print is exported by a case here - add one for a new branch'
    ).toBe(branches.length);
    const reached = new Map<number, string>();
    for (const { branch, cells } of branches) {
      const printed = new Set(cells.map(cellPhrase));
      expect(printed.size, `${branch}: every exported row states the one scope`).toBe(1);
      const [phrase] = [...printed];
      const matched = patterns.flatMap((pattern, i) => (pattern.test(phrase) ? [i] : []));
      expect(matched.length, `${branch}: the exported scope "${phrase}" is exactly one arm of the formatter`).toBe(1);
      expect(reached.get(matched[0]), `${branch}: no two cases export the same arm`).toBeUndefined();
      reached.set(matched[0], branch);
    }
    expect([...reached.keys()].sort(), 'every arm of the formatter is exported by one of these cases').toEqual(
      patterns.map((_, i) => i)
    );
  }, 600_000);
});

describe('BG-01M7FH8K AC3: the export writes no scope wording of its own', () => {
  it('BG-01M7FH8K AC3 the export holds no second scope literal', async () => {
    const { crisprScanReadAs, crisprGuideExportTable } = await import('../core/crisprGuideText');
    // (a) The file, outside the formatter and its comments: no scope wording is written there, live
    // or dead. The wording is the formatter's own fragments, plus the frames seedScopeText wrote.
    const { arms } = formatterArms();
    const specificity = /export function crisprIntervalSpecificityText\([\s\S]*?\n}\n/.exec(
      treeSource('src/core/crisprGuideText.ts')
    );
    expect(specificity, 'core states the interval specificity once').not.toBeNull();
    const fragments = [...arms, ...(specificity![0].match(/`[^`]*`/g) ?? [])]
      .flatMap((arm) => arm.slice(1, -1).split(/\$\{[^}]*\}/))
      .map((literal) => literal.trim())
      .filter((literal) => literal.length >= 12);
    expect(fragments.length, 'the formatter states fragments for the sweep to look for').toBeGreaterThan(3);
    const uncommented = (source: string) =>
      source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
    const rest = uncommented(
      treeSource('src/core/crisprGuideText.ts').replace(formatterSource(), '').replace(specificity![0], '')
    );
    const studioRest = uncommented(treeSource('src/components/PrimerAndPCRStudio.tsx'));
    for (const fragment of fragments) {
      expect(rest.includes(fragment), `the file outside the formatter writes "${fragment}" again`).toBe(false);
      // The studio's range chooser says a selection is "not inside the N bases of this sequence" -
      // a sentence about the selection, not a seed scope - so the bare joint is not swept there.
      if (fragment === 'bases of this') continue;
      expect(studioRest.includes(fragment), `the studio writes "${fragment}" of its own`).toBe(false);
    }
    expect(rest, 'no frame of the export\'s own names the range it covered').not.toMatch(
      /interval searched|range searched|bases 1 to|bases of this|on both strands/
    );

    // (b) Each exported cell, the formatter's phrase taken out: what is left states no scope.
    for (const { branch, doc, report, cells, intervalCells } of await exportedBranches()) {
      const phrase = crisprScanReadAs(report, doc.topology);
      for (const cell of [...cells, ...intervalCells]) {
        expect(cell, `${branch}: the cell reads the formatter`).toContain(phrase);
        expect(cell.replace(phrase, ''), `${branch}: the rest of the cell states no scope of its own`).not.toMatch(
          /interval searched|range searched|bases 1 to|bases of this|on both strands|across its origin/
        );
      }
    }

    // (c) A report the engine never sent is stated as such, never exported as a scope (LC-006).
    const scan = await engineScan(SCOPE_LINEAR, SPCAS9);
    const table = crisprGuideExportTable({
      guides: scan.guides.slice(0, 1),
      document: SCOPE_LINEAR,
      heuristicRule: 'rule',
      scope: { selectedCount: 0, shownCount: 1 },
    });
    const cell = table.rows[0][table.headers.indexOf('Seed Match Scope')];
    expect(cell, 'a missing report is said to be missing').toMatch(/^Not stated: the engine sent no scan report/);
    expect(cell, 'and no scope is claimed for it').not.toMatch(/bases of this|bases 1 to|interval searched|seed across/);
  }, 600_000);
});

describe('BG-01M7FH8K AC4: a circular record is never called linear, on screen or in the export', () => {
  /**
   * At base the export named the record's own topology and the screen called a plasmid read without
   * crossing its origin a linear sequence; sharing the screen's formatter would have carried that
   * false fact into the file (D0141). The arm now states the record's own topology and what the scan
   * did not do - no guide or seed match spanning the origin was searched - in place of "all N bases
   * of this circular sequence", which alone would claim a coverage the scan did not have.
   */
  it('BG-01M7FH8K AC4 a circular record is never called linear', async () => {
    const notAcrossOrigin = /no guide or seed match spanning the origin was searched/;
    await withApp(async (app) => {
      const { crisprScanReadAs, crisprGuideExportTable } = await import('../core/crisprGuideText');

      // (a) On screen, through the real engine: a plasmid shorter than a site is read straight.
      await onCrisprTab(app, SCOPE_UNDER_SITE);
      const under = await engineScan(SCOPE_UNDER_SITE, SPCAS9);
      expect(under.report, 'the engine read this plasmid straight').toMatchObject({ scannedCircular: false, originSpanBp: 0 });
      const said = seedMatchesCallout(app);
      expect(said, 'the screen never calls a plasmid linear').not.toMatch(/linear/);
      expect(said, 'it names the record as circular').toContain('of this circular sequence');
      expect(said, 'and says the origin was not searched across').toMatch(notAcrossOrigin);
      expect(said, 'in the one formatter\'s words').toContain(crisprScanReadAs(under.report!, 'circular'));

      // (b) In the export, each sub-case the arm covers: a plasmid read straight, and one read as a
      // circle with no base across its origin. The shipped engine returns no guide in either, so
      // both are this plasmid's own scan with the origin read cleared - synthetic reports, said so.
      const whole = await engineScan(SCOPE_CIRCULAR, SPCAS9);
      expect(whole.report, 'the control: the plasmid read whole wraps its origin').toMatchObject({ scannedCircular: true });
      expect(whole.report!.originSpanBp).toBeGreaterThan(0);
      const subCases = [
        { name: 'read straight', report: { ...whole.report!, scannedCircular: false, originSpanBp: 0 } },
        { name: 'read as a circle, no base across its origin', report: { ...whole.report!, scannedCircular: true, originSpanBp: 0 } },
      ];
      for (const { name, report } of subCases) {
        const table = crisprGuideExportTable({
          guides: whole.guides,
          document: SCOPE_CIRCULAR,
          scan: report,
          heuristicRule: 'rule',
          scope: { selectedCount: 0, shownCount: whole.guides.length },
        });
        expect(table.rows.length, `${name}: rows to read`).toBeGreaterThan(0);
        for (const column of ['Seed Match Scope', 'Interval Searched']) {
          for (const row of table.rows) {
            const cell = row[table.headers.indexOf(column)];
            expect(cell, `${name}: the ${column} cell never calls a plasmid linear`).not.toMatch(/linear/);
            expect(cell, `${name}: it names the record as circular`).toContain('400 bases of this circular sequence');
            expect(cell, `${name}: it says the origin was not searched across`).toMatch(notAcrossOrigin);
            expect(cell, `${name}: and claims no origin bases it did not read`).not.toMatch(/including the \S+ across its origin/);
          }
        }
        // The screen reads the same function with the same report, so it says the same.
        expect(crisprScanReadAs(report, 'circular'), `${name}: the screen's words`).not.toMatch(/linear/);
        expect(crisprScanReadAs(report, 'circular')).toMatch(notAcrossOrigin);
      }

      // (c) The controls: a plasmid read round its origin claims no gap, and a line is still a line.
      const round = crisprScanReadAs(whole.report!, 'circular');
      expect(round).toContain(`including the ${basesText(whole.report!.originSpanBp)} across its origin`);
      expect(round).not.toMatch(notAcrossOrigin);
      const line = await engineScan(SCOPE_LINEAR, SPCAS9);
      const lineSaid = crisprScanReadAs(line.report!, 'linear');
      expect(lineSaid).toContain('300 bases of this linear sequence');
      expect(lineSaid, 'a line has no origin to cross').not.toMatch(/origin/);
    });
  }, 600_000);
});
