// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVD5: in the cloning studio a stored custom enzyme digests as itself. Its chip is keyed by
 * its id and labelled "(custom)"; the gel's lanes, the fragments table, the jump labels and the
 * exported rows report its own sites, ends and overhangs, never those of a built-in of the same
 * name; the buffer plan is never given its name; and an enzyme the digest cannot use is named
 * beside the gel, by its label, with the reason, its lane not drawn as a complete digest.
 *
 * The checks run in the real App over the live DOM (appHarness), with the store in the page's own
 * storage and the committed WASM engine, whose entry point is watched (not replaced).
 *
 * Every expected fragment is a literal written from the fixture's construction below (segment
 * lengths, each motif's offsets), never computed by either digest op [LC-002].
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** Every digest-by-id and buffer-plan call the engine receives, with its payload. */
const engine = vi.hoisted(() => ({ calls: [] as Array<{ op: string; payload: Record<string, unknown>; reply?: unknown }> }));
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rustBioEngine')>();
  const watched = new Set(['simulate_enzyme_digest', 'simulate_restriction_digest']);
  return {
    ...actual,
    // The studio calls the planner by this export (its own call to the engine is inside the module).
    evaluateMultiDigestBufferPlanRust: (enzymes: string[]) => {
      engine.calls.push({ op: 'evaluate_multi_digest_buffer_plan', payload: { enzymes } });
      return actual.evaluateMultiDigestBufferPlanRust(enzymes);
    },
    invokeRustBioSync: (op: string, payload?: unknown) => {
      const reply = actual.invokeRustBioSync(op, payload);
      if (watched.has(op)) engine.calls.push({ op, payload: (payload ?? {}) as Record<string, unknown>, reply });
      return reply;
    },
  };
});
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

// ─── The fixture ───

const ENZ_KEY = 'molbiocraft.enzymeDatabase';
/** Adaeze's own "EcoRI": another motif and other offsets, under the built-in's name. */
const MINE: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'TGGTGGTGA', cutFwd: 3, cutRev: 7, provenance: 'own isolate' };
const PREFIXED: CustomEnzymeInput = { name: 'EcoRI-mine', recognitionSeq: 'TGTTGTTGTA', cutFwd: 4, cutRev: 6 };
const HF: CustomEnzymeInput = { name: 'Mine-HF', recognitionSeq: 'TGTGGATTGTG', cutFwd: 5, cutRev: 5 };
/** A twin with the built-in EcoRI's motif and cuts (G^AATTC). */
const SAME: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'GAATTC', cutFwd: 1, cutRev: 5 };
/** A twin with the built-in EcoRI's motif and top cut but another bottom cut: its ends differ. */
const CLASH: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'GAATTC', cutFwd: 1, cutRev: 3 };

/**
 * A 2,983 bp circle of C (no site of any enzyme below lies in it or across its junctions):
 *   1..400 C | 401..406 GGATCC (BamHI, cut before 402, GATC) | 407..906 C |
 *   907..912 GAATTC (EcoRI, cut before 908, AATT) | 913..1512 C |
 *   1513..1518 CTCGAG (XhoI, cut before 1514, TCGA) | 1519..2218 C |
 *   2219..2227 TGGTGGTGA (the custom "EcoRI", cut 3 in: before 2222, TGGT) | 2228..2527 C |
 *   2528..2533 GAATTC (EcoRI, cut before 2529) | 2534..2983 C
 */
const SEQ = [
  'C'.repeat(400), 'GGATCC', 'C'.repeat(500), 'GAATTC', 'C'.repeat(600), 'CTCGAG', 'C'.repeat(700),
  MINE.recognitionSeq, 'C'.repeat(300), 'GAATTC', 'C'.repeat(450),
].join('');
const DOC: SequenceDocument = {
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id: 'pAda', name: 'pAda', sequence: SEQ, topology: 'circular', features: [], primers: [],
};

/** The 14 digest chips the studio has always offered (cloningInspector.test.tsx DIGEST_CHIPS). */
const DIGEST_CHIPS = ['EcoRI', 'BamHI', 'HindIII', 'NotI', 'XhoI', 'NdeI', 'NcoI', 'XbaI', 'SpeI', 'PstI', 'SalI', 'KpnI', 'SacI', 'SmaI'];

function seeded(inputs: CustomEnzymeInput[], storage: LiveStorage = memoryStorage()): LiveStorage {
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => '2026-01-01T00:00:00.000Z', newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function onStudio(storage: LiveStorage, run: (app: AppHarness) => Promise<void>): Promise<void> {
  engine.calls.length = 0;
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({ documents: [DOC], activeDocId: DOC.id, viewerTab: 'cloning-gel' });
    await app.settle();
    await run(app);
  } finally {
    app.unmount();
  }
}

const chips = (app: AppHarness) =>
  app.all('button.enz-chip').map((b) => ({ name: words(b.textContent), on: b.classList.contains('active'), el: b }));
const ticked = (app: AppHarness) => chips(app).filter((c) => c.on).map((c) => c.name);
async function toggle(app: AppHarness, name: string) {
  const hit = chips(app).filter((c) => c.name === name);
  expect(hit, `one "${name}" chip`).toHaveLength(1);
  await app.click(hit[0].el);
  await app.settle();
}
const gel = (app: AppHarness) => app.one('svg.virtual-gel-svg', "the gel's drawing");
const bands = (app: AppHarness, x: number) => gel(app).querySelectorAll('rect').filter((r) => r.getAttribute('x') === String(x)).length;
/** The combined lane's size callouts, top (largest) first. */
const multiLabels = (app: AppHarness) => gel(app).querySelectorAll('text').filter((t) => t.getAttribute('x') === '363').map((t) => words(t.textContent));
const laneLabels = (app: AppHarness) => gel(app).querySelectorAll('g > text').filter((t) => t.getAttribute('y') === '14').map((t) => words(t.textContent));
function rows(app: AppHarness) {
  const region = app.one('[role="region"][aria-label="Restriction Digest Fragments"]', 'the digest fragments table');
  return region.querySelectorAll('tbody tr').map((tr) => {
    const td = tr.querySelectorAll('td');
    return [words(td[0].textContent), words(td[1].querySelectorAll('strong')[0]?.textContent), words(td[1].querySelectorAll('button')[0]?.textContent), words(td[2].textContent), words(td[3].textContent)];
  });
}
const unresolvedNote = (app: AppHarness) => {
  const found = app.all('.cloning-digest-unresolved');
  return found.length ? words(found[0].textContent) : null;
};
const planCallout = (app: AppHarness) => {
  const details = app.all('details.mbc-progressive-details').filter((d) => words(d.textContent).startsWith('Co-digest buffer plan'));
  expect(details, 'one buffer plan disclosure').toHaveLength(1);
  return details[0];
};
/** The plan's text: its first line, then one line per custom enzyme in it. */
const planText = (app: AppHarness) => {
  const callout = planCallout(app).querySelectorAll('.info-callout')[0];
  const custom = callout.querySelectorAll('.cloning-buffer-plan-custom').map((d) => words(d.textContent));
  let head = callout.textContent ?? '';
  for (const d of callout.querySelectorAll('.cloning-buffer-plan-custom')) head = head.replace(d.textContent ?? '', '');
  return [words(head), ...custom].join(' | ');
};
const planSummary = (app: AppHarness) => words(planCallout(app).querySelectorAll('summary')[0].textContent);
const starFlag = (app: AppHarness) => app.all('[data-mbc-figure] .studio-caution-flag').map((f) => words(f.textContent));
const enzymeDigests = () => engine.calls.filter((c) => c.op === 'simulate_enzyme_digest');
const planCalls = () => engine.calls.filter((c) => c.op === 'evaluate_multi_digest_buffer_plan').map((c) => c.payload.enzymes as string[]);

/** Opens the Restriction Enzymes window and imports `text` as a backup file. */
async function importInWindow(app: AppHarness, text: string) {
  const input = app.one('[role="dialog"][aria-labelledby="enzyme-db-title"] input[type="file"]', 'the backup file input');
  (input as unknown as { files: unknown[] }).files = [{ name: 'backup.json', text: async () => text }];
  await act(async () => {
    dispatchLiveEvent(input, 'change');
  });
  await app.settle();
}

// ─── AC1 ───

describe('US-01M7DVD5 AC1: the custom "EcoRI" chip digests with its own sites and offsets', () => {
  it('US-01M7DVD5 AC1 with nothing stored the chips, the default BamHI + XhoI lanes and the fragments table are the literal values', async () => {
    await onStudio(memoryStorage(), async (app) => {
      expect(chips(app).map((c) => c.name)).toEqual(DIGEST_CHIPS);
      expect(ticked(app)).toEqual(['BamHI', 'XhoI']);
      expect(laneLabels(app)).toEqual(['1 kb Plus', 'Uncut (TBE)', 'BamHI', 'BamHI+XhoI']);
      // BamHI before 402, XhoI before 1514: 402..1513 (1,112 bp) and 1514..401 (1,871 bp).
      expect(rows(app)).toEqual([
        ['2', '1,871 bp', '1514..401', 'XhoI TCGA', 'BamHI GATC'],
        ['1', '1,112 bp', '402..1513', 'BamHI GATC', 'XhoI TCGA'],
      ]);
      expect(multiLabels(app)).toEqual(['1871 bp', '1112 bp']);
      expect(bands(app, 228), 'the single cutter (BamHI) opens the circle once').toBe(1);
      expect(unresolvedNote(app)).toBeNull();
    });
  });

  it('US-01M7DVD5 AC1 choosing "EcoRI (custom)" digests through simulate_enzyme_digest at its own site, never the built-in EcoRI\'s two', async () => {
    await onStudio(seeded([MINE]), async (app) => {
      expect(chips(app).map((c) => c.name)).toEqual([...DIGEST_CHIPS, 'EcoRI (custom)']);
      await toggle(app, 'BamHI');
      await toggle(app, 'XhoI');
      engine.calls.length = 0;
      await toggle(app, 'EcoRI (custom)');
      expect(ticked(app)).toEqual(['EcoRI (custom)']);
      // The custom cut before 2222 opens the circle once: 2222..2221, 2,983 bp, TGGT at both ends.
      // The built-in EcoRI would give two: 908..2528 (1,621 bp) and 2529..907 (1,362 bp).
      expect(rows(app)).toEqual([['1', '2,983 bp', '2222..2221', 'EcoRI (custom) TGGT', 'EcoRI (custom) TGGT']]);
      expect(multiLabels(app)).toEqual(['2983 bp']);
      expect(bands(app, 228), 'the single-cutter lane is the custom enzyme too').toBe(1);
      expect(laneLabels(app).slice(2)).toEqual(['EcoRI (custom)', 'EcoRI (custom)']);
      const sent = enzymeDigests().map((c) => c.payload.selection as Array<string | { id: string; name: string }>);
      expect(sent.length, 'the digest went through the digest by id').toBeGreaterThan(0);
      for (const selection of sent) {
        expect(selection.map((s) => (typeof s === 'string' ? s : s.id))).toEqual(['custom:seed-1']);
      }
      expect(engine.calls.filter((c) => c.op === 'simulate_restriction_digest' && (c.payload.selectedEnzymeNames as string[]).length > 0)).toEqual([]);

      // Beside BamHI and XhoI: cuts before 402, 1514 and 2222.
      await toggle(app, 'BamHI');
      await toggle(app, 'XhoI');
      expect(rows(app)).toEqual([
        ['3', '1,163 bp', '2222..401', 'EcoRI (custom) TGGT', 'BamHI GATC'],
        ['1', '1,112 bp', '402..1513', 'BamHI GATC', 'XhoI TCGA'],
        ['2', '708 bp', '1514..2221', 'XhoI TCGA', 'EcoRI (custom) TGGT'],
      ]);
      expect(multiLabels(app)).toEqual(['1163 bp', '1112 bp', '708 bp']);
      expect(laneLabels(app).slice(2)).toEqual(['EcoRI (custom)', 'EcoRI (custom)+BamHI+1']);
    });
  });
});

// ─── AC2b ───

describe('US-01M7DVD5 AC2b: a chosen custom enzyme that leaves the active list stays chosen and is named beside the gel', () => {
  it('US-01M7DVD5 AC2b the store read failing: "EcoRI (custom)" stays chosen, is named with the reason, and its lane is not drawn', async () => {
    const base = seeded([MINE]);
    let failing = false;
    const storage = {
      ...base,
      getItem: (k: string) => {
        if (failing && k === ENZ_KEY) throw new Error('SecurityError: storage is blocked');
        return base.getItem(k);
      },
      setItem: (k: string, v: string) => {
        if (failing && k === ENZ_KEY) throw new Error('SecurityError: storage is blocked');
        base.setItem(k, v);
      },
    } as LiveStorage;
    await onStudio(storage, async (app) => {
      await toggle(app, 'EcoRI (custom)');
      expect(rows(app)).toHaveLength(3);
      await app.menu('tools:enzyme-database');
      await app.settle();
      // The storage fails, then the window asks the store for a write: the App reads the store
      // again, cannot, and falls back to the catalogue.
      failing = true;
      await importInWindow(app, '{}');
      expect(chips(app).filter((c) => c.name === 'EcoRI (custom)').map((c) => c.on), 'still chosen, under its own label').toEqual([true]);
      expect(ticked(app)).toEqual(['BamHI', 'XhoI', 'EcoRI (custom)']);
      const note = unresolvedNote(app);
      expect(note).toContain('Lane 4 (BamHI+XhoI+1) not drawn');
      expect(note).toContain('EcoRI (custom): it is no longer in the active enzyme list (the enzyme database could not be read, or no longer holds it), so the digest did not use it');
      expect(note).not.toContain('custom:');
      expect(bands(app, 312), 'the combined lane is not drawn as a complete digest').toBe(0);
      expect(multiLabels(app)).toEqual([]);
      expect(rows(app), 'no fragment of a digest that is not the one chosen').toEqual([]);
      expect(bands(app, 228), 'the single cutter (BamHI) is still whole').toBe(1);
      // Never filled with the built-in EcoRI's two cuts.
      for (const c of enzymeDigests().slice(-2)) {
        expect(JSON.stringify(c.payload.selection)).not.toContain('EcoRI');
      }
    });
  });
});

// ─── AC5 ───

describe('US-01M7DVD5 AC5: the buffer plan is never given a custom enzyme\'s name', () => {
  it('US-01M7DVD5 AC5 a catalogue-only plan is as before; a custom twin, a prefixed and an -HF one are activity unknown; custom only plans nothing', async () => {
    await onStudio(seeded([MINE, PREFIXED, HF]), async (app) => {
      // The catalogue-only default, as the studio has always written it.
      expect(planText(app)).toBe('Co-Digest Buffer Plan: 1× rCutSmart Buffer (37°C • 100% min activity • Watch star activity)');
      expect(starFlag(app)).toEqual(['Watch star activity (BamHI)']);
      expect(planSummary(app)).toBe('Co-digest buffer plan: watch star activity');

      // XhoI (no star activity) with the three custom enzymes: the plan is XhoI's alone.
      await toggle(app, 'BamHI');
      engine.calls.length = 0;
      for (const name of ['EcoRI (custom)', 'EcoRI-mine (custom)', 'Mine-HF (custom)']) await toggle(app, name);
      expect(planCalls().length).toBeGreaterThan(0);
      for (const sent of planCalls()) expect(sent).toEqual(['XhoI']);
      expect(planText(app)).toBe(
        'Co-Digest Buffer Plan for XhoI only: 1× rCutSmart Buffer (37°C • 100% min activity)' +
          " | EcoRI (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart." +
          " | EcoRI-mine (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart." +
          " | Mine-HF (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart."
      );
      expect(starFlag(app), 'no star activity on a custom enzyme\'s behalf').toEqual([]);
      expect(planSummary(app)).toBe('Co-digest buffer plan');

      // Custom enzymes only: no buffer, no temperature, no co-digest sentence.
      engine.calls.length = 0;
      await toggle(app, 'XhoI');
      expect(ticked(app)).toEqual(['EcoRI (custom)', 'EcoRI-mine (custom)', 'Mine-HF (custom)']);
      expect(planCalls(), 'the planner is not asked').toEqual([]);
      const text = planText(app);
      expect(text).toBe(
        'Co-Digest Buffer Plan: none. The built-in buffer table holds no custom enzyme, so no buffer or incubation is planned for this digest.' +
          " | EcoRI (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart." +
          " | EcoRI-mine (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart." +
          " | Mine-HF (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart."
      );
      for (const absent of ['°C', 'rCutSmart', 'Buffer r', 'min activity', 'star', 'methyl', 'CpG', 'co-digest in']) expect(text).not.toContain(absent);
      expect(starFlag(app)).toEqual([]);
    });
  });
});

// ─── AC6 ───

describe('US-01M7DVD5 AC6: a custom enzyme and a same-named built-in stay apart in the digest', () => {
  it('US-01M7DVD5 AC6 two chips, toggled apart; ends, jump labels, export rows and lane labels mark the custom one', async () => {
    await onStudio(seeded([MINE]), async (app) => {
      await toggle(app, 'BamHI');
      await toggle(app, 'XhoI');
      await toggle(app, 'EcoRI (custom)');
      expect(chips(app).filter((c) => c.name.startsWith('EcoRI')).map((c) => [c.name, c.on])).toEqual([['EcoRI', false], ['EcoRI (custom)', true]]);
      await toggle(app, 'EcoRI');
      expect(ticked(app)).toEqual(['EcoRI', 'EcoRI (custom)']);
      // Cuts before 908 (EcoRI), 2222 (the custom one) and 2529 (EcoRI).
      expect(rows(app)).toEqual([
        ['3', '1,362 bp', '2529..907', 'EcoRI AATT', 'EcoRI AATT'],
        ['1', '1,314 bp', '908..2221', 'EcoRI AATT', 'EcoRI (custom) TGGT'],
        ['2', '307 bp', '2222..2528', 'EcoRI (custom) TGGT', 'EcoRI AATT'],
      ]);
      expect(laneLabels(app).slice(2)).toEqual(['EcoRI (custom)', 'EcoRI (custom)+EcoRI']);
      // Toggling the built-in leaves the custom one as it was, and the other way round.
      await toggle(app, 'EcoRI (custom)');
      expect(ticked(app)).toEqual(['EcoRI']);
      expect(laneLabels(app).slice(2)).toEqual(['EcoRI', 'EcoRI']);
      await toggle(app, 'EcoRI (custom)');
      expect(laneLabels(app).slice(2)).toEqual(['EcoRI', 'EcoRI+EcoRI (custom)']);

      // The export of the gel's rows.
      const exportButton = app.one('[data-mbc-figure] button.mbc-figure-export-trigger', "the gel's Export");
      await app.click(exportButton);
      const tsv = app.all('[role="menuitem"]').filter((m) => words(m.textContent).startsWith('TSV'));
      expect(tsv).toHaveLength(1);
      await app.click(tsv[0]);
      await app.settle();
      const saved = app.downloads().filter((f) => f.filename.endsWith('.tsv'));
      expect(saved).toHaveLength(1);
      const text = await saved[0].text();
      expect(text.split('\n').filter((l) => /^\d\t/.test(l))).toEqual([
        '3\t1362\t2529\t907\tEcoRI\tEcoRI',
        '1\t1314\t908\t2221\tEcoRI\tEcoRI (custom)',
        '2\t307\t2222\t2528\tEcoRI (custom)\tEcoRI',
      ]);

      // The jump label, last (the jump opens the Sequence view).
      const jump = app.all('[role="region"][aria-label="Restriction Digest Fragments"] button.mbc-coord-jump-btn').filter((b) => words(b.textContent) === '908..2221');
      expect(jump).toHaveLength(1);
      await app.click(jump[0]);
      await app.settle();
      expect(words(app.doc.body.textContent)).toContain('Jumped to Digest Fragment #1 (EcoRI–EcoRI (custom)) (908..2,221 bp)');
    });
  });

  it('US-01M7DVD5 AC6 a twin cutting like the built-in keeps the built-in\'s end in either order; a twin with another bottom cut is a clash named by both labels', async () => {
    // The same motif and cuts: the shared cut is the built-in's, whichever chip is chosen first.
    await onStudio(seeded([SAME]), async (app) => {
      await toggle(app, 'BamHI');
      await toggle(app, 'XhoI');
      await toggle(app, 'EcoRI (custom)');
      expect(rows(app), 'the custom twin alone: its own ends, marked').toEqual([
        ['1', '1,621 bp', '908..2528', 'EcoRI (custom) AATT', 'EcoRI (custom) AATT'],
        ['2', '1,362 bp', '2529..907', 'EcoRI (custom) AATT', 'EcoRI (custom) AATT'],
      ]);
      await toggle(app, 'EcoRI');
      expect(ticked(app)).toEqual(['EcoRI', 'EcoRI (custom)']);
      expect(rows(app), 'both: the built-in leads at a shared cut').toEqual([
        ['1', '1,621 bp', '908..2528', 'EcoRI AATT', 'EcoRI AATT'],
        ['2', '1,362 bp', '2529..907', 'EcoRI AATT', 'EcoRI AATT'],
      ]);
      expect(unresolvedNote(app)).toBeNull();
    });
    // The built-in's top cut with another bottom cut (AA, not AATT): the digest lists the clash.
    await onStudio(seeded([CLASH]), async (app) => {
      await toggle(app, 'BamHI');
      await toggle(app, 'XhoI');
      await toggle(app, 'EcoRI (custom)');
      await toggle(app, 'EcoRI');
      const note = unresolvedNote(app);
      expect(note).toContain('Lane 4 (EcoRI (custom)+EcoRI) not drawn');
      expect(note).toContain(
        "EcoRI and EcoRI (custom): EcoRI and EcoRI (custom) both cut the top strand before base 908 but leave different ends (a 5' overhang AATT and a 5' overhang AA), so the digest cannot say which end that fragment has"
      );
      expect(note).not.toMatch(/5prime|3prime/);
      expect(note).toContain('before base 2529');
      expect(bands(app, 312), 'not drawn as a complete digest').toBe(0);
      expect(rows(app)).toEqual([]);
      expect(bands(app, 228), 'the single cutter (the custom twin alone) is whole').toBe(2);
    });
  });
  it('US-01M7DVD5 AC6 built-ins alone sharing a cut (SacI + XbaI on GAGCTCTAGA) keep the old dedupe: lane 4, the table and the export are drawn, complete', async () => {
    // D0151. A 1,222 bp circle of C: GAGCTCTAGA at 301..310, where SacI (GAGCT^C, AGCT) and XbaI
    // (T^CTAGA, CTAG) both cut before 306 and the old op keeps SacI (recognised first); SacI's
    // GAGCTC again at 711..716 (cut before 716) and XbaI's TCTAGA at 1017..1022 (cut before 1018).
    const seq = ['C'.repeat(300), 'GAGCTCTAGA', 'C'.repeat(400), 'GAGCTC', 'C'.repeat(300), 'TCTAGA', 'C'.repeat(200)].join('');
    expect(seq.length).toBe(1222);
    const poly: SequenceDocument = { ...DOC, id: 'pPoly', name: 'pPoly', sequence: seq };
    engine.calls.length = 0;
    const app = await mountApp({ storage: memoryStorage() });
    try {
      await app.restoreSession({ documents: [poly], activeDocId: poly.id, viewerTab: 'cloning-gel' });
      await app.settle();
      await toggle(app, 'BamHI');
      await toggle(app, 'XhoI');
      await toggle(app, 'SacI');
      await toggle(app, 'XbaI');
      expect(ticked(app)).toEqual(['XbaI', 'SacI']);
      const last = enzymeDigests().filter((c) => JSON.stringify(c.payload.selection) === '["SacI","XbaI"]').pop();
      expect(last?.reply, 'the digest by id of the two built-ins').toMatchObject({ complete: true, unresolvedEnzymes: [] });
      expect(unresolvedNote(app)).toBeNull();
      expect(laneLabels(app).slice(2)).toEqual(['SacI', 'SacI+XbaI']);
      expect(multiLabels(app)).toEqual(['510 bp', '410 bp', '302 bp']);
      expect(bands(app, 312)).toBe(3);
      expect(rows(app)).toEqual([
        ['3', '510 bp', '1018..305', 'XbaI CTAG', 'SacI AGCT'],
        ['1', '410 bp', '306..715', 'SacI AGCT', 'SacI AGCT'],
        ['2', '302 bp', '716..1017', 'SacI AGCT', 'XbaI CTAG'],
      ]);
      await app.click(app.one('[data-mbc-figure] button.mbc-figure-export-trigger', "the gel's Export"));
      const tsv = app.all('[role="menuitem"]').filter((m) => words(m.textContent).startsWith('TSV'));
      expect(tsv).toHaveLength(1);
      await app.click(tsv[0]);
      await app.settle();
      const saved = app.downloads().filter((f) => f.filename.endsWith('.tsv'));
      expect(saved).toHaveLength(1);
      expect((await saved[0].text()).split('\n').filter((l) => /^\d\t/.test(l))).toEqual([
        '3\t510\t1018\t305\tXbaI\tSacI',
        '1\t410\t306\t715\tSacI\tSacI',
        '2\t302\t716\t1017\tSacI\tXbaI',
      ]);
    } finally {
      app.unmount();
    }
  });
});
