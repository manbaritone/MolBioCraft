// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVJK: the CRISPR tab scanned the whole record on the UI thread whenever the Primers & PCR
 * studio mounted, on any sub-tab, and again on every edit. A search now has a name and runs only
 * when Run is pressed, as one `scan_crispr_guides` call off the UI thread (D0171), with a Stop that
 * abandons the reply; a completed result is held for the app session per document (D0172) and shown
 * only while the document and its sequence revision are the ones it ran on.
 *
 * Everything runs through the real App (LC-003): the menu, the CRISPR sub-tab, its Run and Stop
 * buttons, the document table and the Edit / Sequence menu commands. The engine's calls are
 * counted where the engine module is entered: every `scan_crispr_guides` the App asks for, by
 * either transport, is recorded with its payload, so a scan on render, a scan per step or a second
 * call per Run is counted (LC-002). The running state and Stop are pinned on a macOS desktop host
 * whose `cmd_rust_bio_invoke` is held on a promise the test resolves (the engineWarnings stub), so
 * the transport and Stop are the shipped code.
 *
 * Wrong implementations these kill:
 * - AC1: scanning on mount or on opening the tab and hiding the rows; scanning after an edit; two
 *   calls per Run; a tab label still carrying a count before any run.
 * - AC2: N read as `end - start` (or its absolute value) of an origin-crossing interval; M read as
 *   the length asked for (8,000,100) instead of the report's `scannedLengthBp` (8,000,000).
 * - AC3: a reply that arrives after Stop rendered, or after a new Run began; Stop clearing the
 *   previous result; a rerun that differs from an unstopped run.
 * - AC4: a stepped or sub-range scan (seed copies sit in both halves of the scope, so a half-scope
 *   count differs); rows of the tab's own assembly; a payload missing an interval bound.
 * - AC5: a thrown call or a reportless reply shown as 0 candidates or an empty completed search; a
 *   stale interval widened to the whole sequence; the previous result dropped on a failure.
 * - AC6: a result shown over another document or an edited sequence; Annotate / Top 5 / export
 *   from a withdrawn result; a result lost on a guide jump; export labelled from the chooser.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { macHost, mountApp, type AppHarness, type MountOptions } from './appHarness';
import type { LiveElement } from './liveDom';

vi.mock('../lib/tauriIpc', async (importOriginal) =>
  (await import('./appHarness')).tauriIpcMock(await importOriginal<object>())
);

/** Every `scan_crispr_guides` call the App made, with its payload; and a reply the test may choose. */
const engine = vi.hoisted(() => ({
  calls: [] as { via: 'sync' | 'async'; payload: Record<string, unknown> }[],
  /** While set, the test's own oracle calls are not counted as the App's. */
  quiet: false,
  asyncReply: null as
    | null
    | ((payload: Record<string, unknown>, real: (op: string, payload?: unknown) => unknown) => Promise<unknown>),
}));

vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return {
    ...real,
    invokeRustBioSync: <T,>(op: string, payload?: unknown): T => {
      if (op === 'scan_crispr_guides' && !engine.quiet) {
        engine.calls.push({ via: 'sync', payload: payload as Record<string, unknown> });
      }
      return real.invokeRustBioSync<T>(op, payload);
    },
    invokeRustBioNativeAsync: async <T,>(op: string, payload?: unknown): Promise<T> => {
      if (op === 'scan_crispr_guides') {
        engine.calls.push({ via: 'async', payload: payload as Record<string, unknown> });
        if (engine.asyncReply) {
          return (await engine.asyncReply(payload as Record<string, unknown>, (o, p) =>
            real.invokeRustBioSync<unknown>(o, p)
          )) as T;
        }
      }
      return real.invokeRustBioNativeAsync<T>(op, payload);
    },
  };
});

// Each criterion launches the App afresh, with the real WASM engine behind it (LC-038).
vi.setConfig({ testTimeout: 120_000 });

async function withApp(run: (app: AppHarness) => Promise<void>, opts: MountOptions = {}): Promise<void> {
  engine.calls.length = 0;
  engine.asyncReply = null;
  const app = await mountApp(opts);
  try {
    await run(app);
  } finally {
    app.unmount();
    engine.asyncReply = null;
  }
}

// ─── Documents built in the test ───

/** Bases with no G and no CC: no SpCas9 PAM on either strand, and none made at a join. */
const FILLER_UNIT = 'ATCATACTAATCTAACATTA';
const filler = (n: number) => FILLER_UNIT.repeat(Math.ceil(n / FILLER_UNIT.length)).slice(0, n);

const dnaDoc = (id: string, sequence: string, topology: 'linear' | 'circular' = 'linear'): SequenceDocument => ({
  id, name: id, accession: '', description: '', sequence, moleculeType: 'DNA', topology,
  folder: 'Local', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  features: [], primers: [], history: [],
});

/** `bases` written over `seq` from 1-based `at`. */
const plant = (seq: string, at: number, bases: string) => seq.slice(0, at - 1) + bases + seq.slice(at - 1 + bases.length);

/** Guide G: its spacer, whose 12-nt PAM-proximal seed is planted twice more, once in each half. */
const G_SPACER = 'ACGTACTGATCAGTCATGCA';
const G_SEED = G_SPACER.slice(-12);
const H_SPACER = 'TACGTCATAGTCAGTACTCA';
const runSeq = (() => {
  let s = filler(4000);
  s = plant(s, 501, `${G_SPACER}AGG`);
  s = plant(s, 2501, `${H_SPACER}TGG`);
  s = plant(s, 1001, G_SEED);
  s = plant(s, 3001, G_SEED);
  return s;
})();
const RUN_DOC = dnaDoc('pDVJK_Run', runSeq);
const OTHER_DOC = dnaDoc('pDVJK_Other', plant(filler(1200), 301, `${H_SPACER}AGG`));
/** The scope of the interval cases: both seed copies inside it, and G's site too. */
const SCOPE = { start: 101, end: 3900 };

/** A 400-bp plasmid with a guide just past its origin, and the 60-bp interval 381..40 across it. */
const CIRCLE = dnaDoc('pDVJK_Circle', plant(filler(400), 5, `${G_SPACER}TGG`), 'circular');
const ACROSS = { start: 381, end: 40 };

const SPCAS9 = 'SpCas9 (NGG)';
const CAS12A = 'Cas12a / Cpf1 (TTTV)';
const bp = (n: number) => n.toLocaleString('en-US');

// ─── The engine's own answer ───

/** This launch's engine, called directly through the synchronous scan, never counted as the App's. */
async function engineScan(doc: SequenceDocument, nuclease = SPCAS9, interval?: { start: number; end: number } | null) {
  const { scanCrisprGuides } = await import('../core/bioEngine');
  engine.quiet = true;
  try {
    return scanCrisprGuides(doc.sequence, nuclease, 25, doc.topology === 'circular', interval ?? null);
  } finally {
    engine.quiet = false;
  }
}

// ─── Reading and driving the App ───

const words = (s: string) => s.replace(/\s+/g, ' ').trim();

async function openStudio(
  app: AppHarness,
  docs: SequenceDocument[],
  selectedRange?: { start: number; end: number }
): Promise<void> {
  await app.restoreSession({
    documents: docs,
    activeDocId: docs[0].id,
    viewerTab: 'primers-pcr',
    ...(selectedRange ? { workspace: { selectedRange: { label: 'Selection', ...selectedRange } } } : {}),
  });
}

const subTabs = (app: AppHarness) =>
  app.all('[role="tablist"][aria-label="Primer and CRISPR Tools"] button[role="tab"]');
const crisprSubTab = (app: AppHarness): LiveElement => {
  const found = subTabs(app).filter((b) => words(b.textContent).startsWith('Find CRISPR Sites'));
  expect(found, 'one CRISPR sub-tab').toHaveLength(1);
  return found[0];
};
const tabLabel = (app: AppHarness) => words(crisprSubTab(app).textContent);
const runButton = (app: AppHarness) => app.one('[data-crispr-run]', 'the Run button');
const pressRun = (app: AppHarness) => app.click(runButton(app));
const pressStop = (app: AppHarness) => app.click(app.one('[data-crispr-stop]', 'the Stop button'));
const statusText = (app: AppHarness) => app.all('[data-crispr-run-status]').map((e) => words(e.textContent)).join(' | ');
/** The line that names the result shown, by its own name (empty where none is shown). */
const shownText = (app: AppHarness) => app.all('[data-crispr-shown-result]').map((e) => words(e.textContent)).join(' | ');
/** Everything the CRISPR tab and the inspector say, as one reads it. */
const tabWords = (app: AppHarness) =>
  words(app.one('.alignment-studio-wrapper', 'the studio').textContent + ' ' + (app.inspectorAside()?.textContent ?? ''));
const withdrawnText = (app: AppHarness) => app.all('[data-crispr-withdrawn]').map((e) => words(e.textContent)).join(' | ');
const listedGuideIds = (app: AppHarness) =>
  app.all('[data-crispr-guide-row]').map((r) => r.getAttribute('data-crispr-guide-row') ?? '');
const callout = (app: AppHarness) => {
  const found = app.all('.info-callout').filter((e) => e.textContent.includes('Genome-wide specificity'));
  expect(found, 'one scan callout').toHaveLength(1);
  return words(found[0].textContent);
};
const top5Button = (app: AppHarness) => {
  const found = app.all('button').filter((b) => words(b.textContent).startsWith('+ Annotate Top 5 Guides'));
  expect(found, 'one Annotate Top 5 Guides button').toHaveLength(1);
  return found[0];
};
const nameField = (app: AppHarness) => app.one('input[aria-label="Search name:"]', 'the search name field');
const scanCount = () => engine.calls.length;

async function chooseNuclease(app: AppHarness, nuclease: string): Promise<void> {
  await app.change(app.one('select[aria-label="Nuclease / PAM:"]', 'the nuclease chooser'), nuclease);
}
async function chooseSearchRange(app: AppHarness, value: 'interval' | 'whole'): Promise<void> {
  await app.change(app.one('select[aria-label="Search range:"]', 'the search-range chooser'), value);
}

/** A row of the document table, by the document's name (never a guide row). */
function documentRow(app: AppHarness, name: string): LiveElement {
  const rows = app
    .all('tr')
    .filter((r) => r.parentElement?.tagName === 'TBODY' && !r.getAttribute('data-crispr-guide-row'))
    .filter((r) => r.textContent.includes(name));
  expect(rows, `one document-table row for ${name}`).toHaveLength(1);
  return rows[0];
}

/** Each guide row as the engine record fields it shows: id, region and seed-match cell. */
const rowFacts = (app: AppHarness) =>
  app.all('[data-crispr-guide-row]').map((r) => {
    const cells = r.querySelectorAll('td').map((c) => words(c.textContent));
    return { id: r.getAttribute('data-crispr-guide-row'), name: cells[0], region: cells[4], seeds: cells[8] };
  });

async function exportTsv(app: AppHarness): Promise<Record<string, string>[]> {
  const before = app.downloads().length;
  await app.click(app.one('.mbc-figure-export-trigger', 'the guide table Export control'));
  const items = app.all('.mbc-figure-export-item').filter((b) => b.textContent.trim().startsWith('TSV'));
  expect(items, 'the Export menu offers TSV').toHaveLength(1);
  await app.click(items[0]);
  const files = app.downloads();
  expect(files.length, 'one TSV file saved').toBe(before + 1);
  const lines = (await files[files.length - 1].text()).replace(/\n$/, '').split('\n');
  const headers = lines[0].split('\t');
  return lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((c, i) => [headers[i], c])));
}

/**
 * The desktop transport held: `cmd_rust_bio_invoke` for `scan_crispr_guides` waits on a promise the
 * test resolves with the real engine's reply to that call's own payload; every other command is
 * refused, so it falls back to the in-process engine.
 */
function holdDesktopScans(app: AppHarness) {
  const g = globalThis as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } };
  const pending: { payload: Record<string, unknown>; resolve: (v: unknown) => void }[] = [];
  g.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => {
      if (cmd === 'cmd_rust_bio_invoke' && args.op === 'scan_crispr_guides') {
        return new Promise((resolve) => pending.push({ payload: args.payload as Record<string, unknown>, resolve }));
      }
      return Promise.reject(new Error(`not held: ${cmd}`));
    },
  };
  return {
    pending,
    reply: async (i: number) => {
      const { invokeRustBioSync } = await import('../lib/rustBioEngine');
      engine.quiet = true;
      let reply: unknown;
      try {
        reply = invokeRustBioSync('scan_crispr_guides', pending[i].payload);
      } finally {
        engine.quiet = false;
      }
      pending[i].resolve(reply);
      await app.settle();
    },
    release: () => {
      delete g.__TAURI_INTERNALS__;
    },
  };
}

// ─── The criteria ───

describe('a CRISPR search runs when Run is pressed, by name, and can be stopped (US-01M7DVJK)', () => {
  it('US-01M7DVJK AC1 nothing is scanned on opening the studio, the CRISPR tab or after an edit; each Run is one scan', async () => {
    await withApp(async (app) => {
      await openStudio(app, [RUN_DOC]);
      const design = subTabs(app).filter((b) => b.getAttribute('aria-selected') === 'true');
      expect(words(design[0]?.textContent ?? ''), 'the studio opened on its design sub-tab').toMatch(/^Design New Primers/);
      expect(scanCount(), 'no scan on opening the studio on its design sub-tab').toBe(0);

      await app.menu('primers:crispr');
      expect(crisprSubTab(app).getAttribute('aria-selected')).toBe('true');
      expect(scanCount(), 'no scan on opening the CRISPR tab').toBe(0);
      expect(listedGuideIds(app), 'no guide row before the first run').toEqual([]);
      expect(tabLabel(app), 'the sub-tab label carries no guide count').toBe('Find CRISPR Sites & Off-Targets (no search run)');
      expect(tabLabel(app)).not.toMatch(/\d/);
      expect(callout(app), 'the tab says no search has been run').toContain(`No search has been run on ${RUN_DOC.name}`);
      expect(statusText(app)).toBe('');

      await pressRun(app);
      expect(scanCount(), 'exactly one scan per Run').toBe(1);
      const scan = await engineScan(RUN_DOC);
      expect(listedGuideIds(app)).toEqual(scan.guides.map((g) => g.id));
      expect(scan.guides.length, 'the fixture holds its two guides').toBe(2);
      expect(tabLabel(app)).toBe('Find CRISPR Sites & Off-Targets (2 Guides)');

      // An edit to the bases (Reverse Complement, from the Sequence menu, with the studio still open).
      await app.menu('sequence:reverse-complement');
      expect(scanCount(), 'no scan after an edit').toBe(1);
      await app.menu('sequence:toggle-topology');
      expect(scanCount(), 'nor after a topology change').toBe(1);
      await app.menu('primers:crispr');
      expect(scanCount(), 'nor on opening the tab again on the edited record').toBe(1);
      await pressRun(app);
      expect(scanCount(), 'and one more for the second Run').toBe(2);
    });
  });

  it('US-01M7DVJK AC2 the running and finished sentences read the scope asked for and the report, by the search name', async () => {
    await withApp(async (app) => {
      await openStudio(app, [CIRCLE], ACROSS);
      await app.menu('primers:crispr');
      const name = words(nameField(app).value);
      expect(name, 'the name defaults from the document, the nuclease and the interval').toBe(
        `${CIRCLE.name}, ${SPCAS9}, bases 381..40`
      );
      const held = holdDesktopScans(app);
      try {
        await pressRun(app);
        // 60 bases across the origin: never end - start (-341) or its absolute value (341).
        expect(statusText(app)).toBe(`Running "${name}": the engine was asked for 60 bp.`);
        expect(listedGuideIds(app), 'nothing is shown while it runs').toEqual([]);
        expect(held.pending, 'one call on the desktop transport').toHaveLength(1);
        await held.reply(0);
        const scan = await engineScan(CIRCLE, SPCAS9, ACROSS);
        expect(scan.report?.scannedLengthBp).toBe(60);
        expect(shownText(app)).toBe(`"${name}" searched ${bp(scan.report!.scannedLengthBp)} bp.`);
        expect(statusText(app), 'nothing is left running').toBe('');
        expect(listedGuideIds(app)).toEqual(scan.guides.map((g) => g.id));

        // A name of the user's own is the one the sentences use.
        await app.input(nameField(app), 'Origin guides, run two');
        await pressRun(app);
        expect(statusText(app)).toBe('Running "Origin guides, run two": the engine was asked for 60 bp.');
        await held.reply(1);
        expect(shownText(app)).toBe('"Origin guides, run two" searched 60 bp.');
      } finally {
        held.release();
      }
    }, macHost());

    // A whole-sequence search past the engine's bound: asked for 8,000,100, searched 8,000,000.
    const big = dnaDoc('pDVJK_8Mb', filler(8_000_100));
    await withApp(async (app) => {
      await openStudio(app, [big]);
      await app.menu('primers:crispr');
      const name = words(nameField(app).value);
      expect(name).toBe(`${big.name}, ${SPCAS9}, whole sequence`);
      const held = holdDesktopScans(app);
      try {
        await pressRun(app);
        expect(statusText(app)).toBe(`Running "${name}": the engine was asked for 8,000,100 bp.`);
        await held.reply(0);
        expect(shownText(app)).toBe(`"${name}" searched 8,000,000 bp.`);
      } finally {
        held.release();
      }
    }, macHost());
  });

  it('US-01M7DVJK AC3 Stop abandons the reply, keeps the previous result, and a rerun gives the unstopped result', async () => {
    await withApp(async (app) => {
      await openStudio(app, [RUN_DOC]);
      await app.menu('primers:crispr');
      const held = holdDesktopScans(app);
      try {
        // Stopped with no result before it: nothing is shown, and no count either.
        await pressRun(app);
        const first = words(nameField(app).value);
        await pressStop(app);
        expect(statusText(app)).toBe(
          `Stopped "${first}" before the engine replied: ${bp(RUN_DOC.sequence.length)} bp were asked for and no result is shown.`
        );
        expect(listedGuideIds(app)).toEqual([]);
        expect(tabLabel(app)).not.toMatch(/\d/);
        await held.reply(0);
        expect(listedGuideIds(app), 'the reply after Stop never reaches the table').toEqual([]);
        expect(statusText(app)).toContain('Stopped');

        // A completed SpCas9 search, then a Cas12a one stopped.
        await pressRun(app);
        await held.reply(1);
        const spcas9 = await engineScan(RUN_DOC, SPCAS9);
        expect(listedGuideIds(app)).toEqual(spcas9.guides.map((g) => g.id));
        // The completed search's name, as the tab states it beside its rows: the default the name
        // field offered (document, nuclease, scope), written out here rather than read back.
        const doneName = `${RUN_DOC.name}, ${SPCAS9}, whole sequence`;
        const named = `"${doneName}" searched ${bp(spcas9.report!.scannedLengthBp)} bp.`;
        expect(shownText(app), 'the tab names the result it shows').toBe(named);

        await chooseNuclease(app, CAS12A);
        await app.input(nameField(app), 'Cas12a sweep');
        await pressRun(app);
        expect(shownText(app), 'while the next search runs, the result shown is still named').toBe(named);
        expect(tabWords(app)).toContain(`"${doneName}"`);
        await pressStop(app);
        expect(statusText(app)).toBe(
          `Stopped "Cas12a sweep" before the engine replied: ${bp(RUN_DOC.sequence.length)} bp were asked for and no result is shown. The result of "${doneName}" is left as it was.`
        );
        expect(shownText(app), 'after Stop, the result shown keeps its name').toBe(named);
        expect(listedGuideIds(app), 'the previous search stays as it was').toEqual(spcas9.guides.map((g) => g.id));
        expect(callout(app)).toContain(`candidate ${SPCAS9} guides`);

        // A new Run from the same criteria; the stopped reply resolves while it is running.
        await pressRun(app);
        expect(statusText(app)).toBe(`Running "Cas12a sweep": the engine was asked for ${bp(RUN_DOC.sequence.length)} bp.`);
        expect(shownText(app), 'during the rerun too').toBe(named);
        await held.reply(2);
        expect(listedGuideIds(app), 'the stopped reply, resolved after a new Run began, is dropped').toEqual(
          spcas9.guides.map((g) => g.id)
        );
        expect(statusText(app)).toContain('Running "Cas12a sweep"');
        await held.reply(3);
        const cas12a = await engineScan(RUN_DOC, CAS12A);
        expect(listedGuideIds(app), 'the rerun gives what an unstopped run gives').toEqual(cas12a.guides.map((g) => g.id));
        expect(shownText(app)).toBe(`"Cas12a sweep" searched ${bp(cas12a.report!.scannedLengthBp)} bp.`);
        expect(tabWords(app), 'the replaced result is no longer named').not.toContain(`"${doneName}"`);
      } finally {
        held.release();
      }
    }, macHost());
  });

  it('US-01M7DVJK AC4 a Run shows the engine\'s own scan of the whole scope, from one call carrying both bounds or neither', async () => {
    // The fixture discriminates a part-scope count: G's seed is copied once in each half.
    const whole = await (async () => {
      let out: Awaited<ReturnType<typeof engineScan>> | undefined;
      await withApp(async () => {
        out = await engineScan(RUN_DOC);
      });
      return out!;
    })();
    const gWhole = whole.guides.find((g) => g.spacerSeq === G_SPACER)!;
    expect(gWhole.offTargetCount, 'both planted copies of the seed are counted').toBe(2);

    for (const interval of [null, SCOPE]) {
      await withApp(async (app) => {
        await openStudio(app, [RUN_DOC], interval ?? undefined);
        await app.menu('primers:crispr');
        await pressRun(app);
        expect(engine.calls, 'one scan_crispr_guides call').toHaveLength(1);
        const payload = engine.calls[0].payload;
        if (interval) {
          expect([payload.start1Based, payload.end1Based], 'both bounds of the scope').toEqual([interval.start, interval.end]);
        } else {
          expect('start1Based' in payload || 'end1Based' in payload, 'neither bound').toBe(false);
        }
        const scan = await engineScan(RUN_DOC, SPCAS9, interval);
        const firstHalf = await engineScan(RUN_DOC, SPCAS9, interval ? { start: interval.start, end: 2000 } : { start: 1, end: 2000 });
        const g = scan.guides.find((x) => x.spacerSeq === G_SPACER)!;
        expect(firstHalf.guides.find((x) => x.spacerSeq === G_SPACER)?.offTargetCount, 'half the scope counts fewer').not.toBe(
          g.offTargetCount
        );
        const { crisprIntervalSpecificityText } = await import('../core/crisprGuideText');
        expect(rowFacts(app)).toEqual(
          scan.guides.map((x) => ({
            id: x.id,
            name: x.name,
            region: expect.stringContaining(`(DSB @ ${bp(x.cutPosition)})`),
            seeds: x.offTargetCount === 0 ? 'No other seed copy' : `${x.offTargetCount} seed match${x.offTargetCount > 1 ? 'es' : ''}`,
          }))
        );
        for (const [row, x] of rowFacts(app).map((r, i) => [r, scan.guides[i]] as const)) {
          expect(row.region, `${x.name}: its coordinates`).toContain(`${bp(x.start)}..${bp(x.end)}`);
        }
        expect(callout(app)).toContain(`Lists all ${bp(scan.report!.candidateCount)} candidate ${SPCAS9} guides found.`);
        if (interval) expect(callout(app)).toContain(crisprIntervalSpecificityText(scan.report!));
        else expect(callout(app)).not.toContain('interval searched');
      });
    }
  });

  it('US-01M7DVJK AC5 a failed run reports the engine\'s reason, keeps the previous result, and never widens a stale interval', async () => {
    // A call that throws, and a reply with no scan report: before and after a completed run.
    await withApp(async (app) => {
      await openStudio(app, [RUN_DOC]);
      await app.menu('primers:crispr');
      engine.asyncReply = async () => {
        throw new Error('the desktop engine stopped');
      };
      await pressRun(app);
      const name = words(nameField(app).value);
      expect(callout(app)).toContain('CRISPR scan report unavailable (the scan could not be run: the desktop engine stopped)');
      expect(statusText(app)).toContain(`"${name}" failed: the CRISPR scan report is unavailable (the scan could not be run: the desktop engine stopped)`);
      expect(listedGuideIds(app)).toEqual([]);
      expect(tabLabel(app)).toBe('Find CRISPR Sites & Off-Targets (scan report unavailable)');

      engine.asyncReply = async (payload, real) => real('find_crispr_guides', payload);
      await pressRun(app);
      expect(callout(app)).toContain('CRISPR scan report unavailable (the engine returned no scan report)');
      expect(callout(app), 'never 0 candidates').not.toMatch(/0 of the candidates|candidate guides found/);
      expect(listedGuideIds(app), 'never an empty list as a completed search').toEqual([]);

      engine.asyncReply = null;
      await pressRun(app);
      const scan = await engineScan(RUN_DOC);
      expect(listedGuideIds(app)).toEqual(scan.guides.map((g) => g.id));
      const shownName = words(nameField(app).value);

      engine.asyncReply = async () => {
        throw new Error('the desktop engine stopped');
      };
      await app.input(nameField(app), 'Will fail');
      await pressRun(app);
      expect(statusText(app)).toBe(
        `"Will fail" failed: the CRISPR scan report is unavailable (the scan could not be run: the desktop engine stopped) The result of "${shownName}" is left as it was.`
      );
      expect(listedGuideIds(app), 'the previous result is left as it was').toEqual(scan.guides.map((g) => g.id));
      expect(tabLabel(app)).toBe('Find CRISPR Sites & Off-Targets (2 Guides)');
    });

    // The record set linear under an origin-crossing interval: the held bounds go as chosen.
    await withApp(async (app) => {
      await openStudio(app, [CIRCLE], ACROSS);
      await app.menu('primers:crispr');
      await app.menu('sequence:toggle-topology');
      expect(app.one('select[aria-label="Search range:"]').value, 'the interval is still the scope').toBe('interval');
      await pressRun(app);
      expect(engine.calls).toHaveLength(1);
      expect([engine.calls[0].payload.start1Based, engine.calls[0].payload.end1Based], 'the held bounds').toEqual([381, 40]);
      expect(engine.calls[0].payload.circular).toBe(false);
      const refusal = (await engineScan({ ...CIRCLE, topology: 'linear' }, SPCAS9, ACROSS)).report?.intervalRefusal;
      expect(refusal, 'the engine refuses it').toEqual(expect.any(String));
      expect(callout(app)).toContain(`No range was searched: ${refusal}`);
      expect(statusText(app)).toContain(`failed: the engine searched no range: ${refusal}`);
      expect(listedGuideIds(app)).toEqual([]);
    });

    // The sequence shortened under the interval (the record restored shorter, its selection kept).
    await withApp(async (app) => {
      await openStudio(app, [RUN_DOC], SCOPE);
      await app.menu('primers:crispr');
      const short = { ...RUN_DOC, sequence: RUN_DOC.sequence.slice(0, 3000) };
      await openStudio(app, [short], SCOPE);
      await app.menu('primers:crispr');
      await pressRun(app);
      expect(engine.calls).toHaveLength(1);
      expect([engine.calls[0].payload.start1Based, engine.calls[0].payload.end1Based], 'never widened to the whole').toEqual([
        SCOPE.start,
        SCOPE.end,
      ]);
      const refusal = (await engineScan(short, SPCAS9, SCOPE)).report?.intervalRefusal;
      expect(refusal).toEqual(expect.any(String));
      expect(callout(app)).toContain(`No range was searched: ${refusal}`);
      expect(listedGuideIds(app)).toEqual([]);
    });
  });

  it('US-01M7DVJK AC6 a result is shown only on its document and revision, survives leaving the tab, and reads its own preset', async () => {
    await withApp(async (app) => {
      await openStudio(app, [RUN_DOC, OTHER_DOC]);
      await app.menu('primers:crispr');
      await pressRun(app);
      const scan = await engineScan(RUN_DOC);
      const ids = scan.guides.map((g) => g.id);
      const name = words(nameField(app).value);
      expect(listedGuideIds(app)).toEqual(ids);
      const withdrawn = () => {
        expect(listedGuideIds(app), 'none of its rows').toEqual([]);
        expect(app.all('[data-crispr-annotate]'), 'no Annotate').toHaveLength(0);
        expect(top5Button(app).disabled, 'no Annotate Top 5 Guides').toBe(true);
        expect(tabLabel(app), 'no count').toBe('Find CRISPR Sites & Off-Targets (result withdrawn)');
        expect(statusText(app), 'no searched-bp count').not.toMatch(/searched/);
        expect(shownText(app), 'and no result named as shown').toBe('');
      };

      // Another document chosen in the document table, and the CRISPR tab opened on it.
      await app.click(documentRow(app, OTHER_DOC.name));
      await app.menu('primers:crispr');
      withdrawn();
      expect(withdrawnText(app)).toBe(
        `"${name}" ran on another document ("${RUN_DOC.name}"), so none of its guides is shown here: press Run to search ${OTHER_DOC.name}.`
      );
      await app.click(documentRow(app, RUN_DOC.name));
      await app.menu('primers:crispr');
      expect(listedGuideIds(app), 'shown again on its own document').toEqual(ids);

      // A topology change, then undone back to the revision.
      await app.menu('sequence:toggle-topology');
      withdrawn();
      expect(withdrawnText(app)).toBe(
        `"${name}" ran on an earlier sequence of ${RUN_DOC.name}: its bases or topology have changed since, so none of its guides is shown: press Run to search it again.`
      );
      await app.menu('edit:undo');
      expect(listedGuideIds(app), 'undo back to its revision shows it again').toEqual(ids);

      // An edit to the bases, then undone.
      await app.menu('sequence:reverse-complement');
      withdrawn();
      await app.menu('edit:undo');
      expect(listedGuideIds(app)).toEqual(ids);

      // Features added keep the revision: Annotate Top 5 and its undo leave the result shown.
      await app.click(top5Button(app));
      expect(listedGuideIds(app)).toEqual(ids);
      await app.menu('edit:undo');
      expect(listedGuideIds(app)).toEqual(ids);

      // A guide jump to the Sequence view and back: the same result, with no rerun.
      const before = scanCount();
      await app.click(app.one(`[data-crispr-guide-row="${ids[1]}"]`));
      expect(app.activeTab()).toBe('sequence-view');
      await app.menu('primers:crispr');
      expect(listedGuideIds(app), 'the result survives the studio unmounting').toEqual(ids);
      expect(shownText(app)).toBe(`"${name}" searched ${bp(scan.report!.scannedLengthBp)} bp.`);
      expect(scanCount(), 'no scan_crispr_guides call on the way back').toBe(before);

      // The chooser set to Cas12a without Run: the shown SpCas9 rows export labelled SpCas9.
      await chooseNuclease(app, CAS12A);
      expect(listedGuideIds(app)).toEqual(ids);
      expect(callout(app)).toContain(`candidate ${SPCAS9} guides`);
      expect(callout(app)).not.toContain(CAS12A);
      const rows = await exportTsv(app);
      expect(rows.length).toBe(ids.length);
      const { crisprNucleasePresets } = await import('../core/bioEngine');
      const facts = (id: string) => {
        const p = crisprNucleasePresets().find((n) => n.id === id)!;
        return `${p.id} — ${p.pamSide} PAM ${p.pamPattern}`;
      };
      for (const row of rows) {
        const said = Object.values(row).join(' ');
        expect(said, 'labelled with the preset the run was made with, with its own facts').toContain(facts(SPCAS9));
        expect(said, 'never the chooser\'s current preset').not.toContain(facts(CAS12A));
      }
      expect(scanCount()).toBe(before);
    });

    // A run over an interval, the chooser then set to the whole sequence without Run: the seed-scope
    // words stay the interval's.
    await withApp(async (app) => {
      await openStudio(app, [RUN_DOC], SCOPE);
      await app.menu('primers:crispr');
      await pressRun(app);
      const scan = await engineScan(RUN_DOC, SPCAS9, SCOPE);
      const { crisprIntervalSpecificityText } = await import('../core/crisprGuideText');
      await chooseSearchRange(app, 'whole');
      expect(callout(app)).toContain(crisprIntervalSpecificityText(scan.report!));
      const rows = await exportTsv(app);
      expect(rows.map((r) => Object.values(r).join(' ')).join('\n')).toMatch(/interval/i);
    });
  });

  it('US-01M7DVJK AC3 a search running on one document is not shown, or offered to Stop, on another', async () => {
    await withApp(async (app) => {
      await openStudio(app, [RUN_DOC, OTHER_DOC]);
      await app.menu('primers:crispr');
      const held = holdDesktopScans(app);
      try {
        await pressRun(app);
        const name = words(nameField(app).value);
        const running = `Running "${name}": the engine was asked for ${bp(RUN_DOC.sequence.length)} bp.`;
        expect(statusText(app)).toBe(running);

        await app.click(documentRow(app, OTHER_DOC.name));
        await app.menu('primers:crispr');
        expect(statusText(app), "another document's run is not this tab's").toBe('');
        expect(tabWords(app)).not.toContain(`"${name}"`);
        expect(app.all('[data-crispr-stop]'), 'no Stop for a search on another document').toHaveLength(0);
        expect(tabLabel(app)).toBe('Find CRISPR Sites & Off-Targets (no search run)');

        await app.click(documentRow(app, RUN_DOC.name));
        await app.menu('primers:crispr');
        expect(statusText(app), 'back on its own document, it is running still').toBe(running);
        expect(app.all('[data-crispr-stop]')).toHaveLength(1);
        expect(tabLabel(app)).toBe('Find CRISPR Sites & Off-Targets (running)');
        await held.reply(0);
        expect(shownText(app)).toBe(`"${name}" searched ${bp(RUN_DOC.sequence.length)} bp.`);
      } finally {
        held.release();
      }
    }, macHost());
  });

  it('US-01M7DVJK AC6 a result shown again on its own document after a run on another one keeps its name', async () => {
    await withApp(async (app) => {
      await openStudio(app, [RUN_DOC, OTHER_DOC]);
      await app.menu('primers:crispr');
      await pressRun(app);
      const scan = await engineScan(RUN_DOC);
      const named = `"${RUN_DOC.name}, ${SPCAS9}, whole sequence" searched ${bp(scan.report!.scannedLengthBp)} bp.`;
      expect(shownText(app)).toBe(named);

      await app.click(documentRow(app, OTHER_DOC.name));
      await app.menu('primers:crispr');
      await pressRun(app);
      expect(shownText(app)).toBe(`"${OTHER_DOC.name}, ${SPCAS9}, whole sequence" searched ${bp(OTHER_DOC.sequence.length)} bp.`);

      await app.click(documentRow(app, RUN_DOC.name));
      await app.menu('primers:crispr');
      expect(listedGuideIds(app)).toEqual(scan.guides.map((g) => g.id));
      expect(shownText(app), "named from its own document's search, not the last one run").toBe(named);
    });
  });
});
