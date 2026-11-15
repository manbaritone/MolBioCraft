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
 */

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
      expect(row['Seed Match Scope']).toMatch(/12-nt PAM-proximal seed/);
      expect(row['Seed Match Scope']).toMatch(/both strands/);
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
