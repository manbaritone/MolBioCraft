// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7HRV4: restriction cloning with a stored custom enzyme. The Clone Insert into Vector window
 * and the cloning studio offer every custom definition as its own option, marked "(custom)", keyed
 * by its id; the run ligates through the real WASM op with the definition's own sites and
 * overhangs; and neither buffer plan is ever given a custom enzyme's name or key.
 *
 * Driven through the rendered App (its local storage holding the enzyme store and the window's
 * last-used values) over the live DOM, with the committed WASM engine, whose entry point is watched,
 * not replaced. Every expected sequence, length, junction, overhang and option string is a literal
 * written here from the fixture's construction and the definition's own offsets [LC-002].
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { LiveElement, memoryStorage, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** Every cloning, scan and buffer-plan call the engine receives, with its payload and its reply. */
const engine = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; payload: Record<string, unknown>; reply?: unknown }>,
}));
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rustBioEngine')>();
  const watched = new Set(['simulate_molecular_cloning', 'find_restriction_cut_sites']);
  return {
    ...actual,
    // The studio and App call the planner by this export (its own engine call is inside the module).
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

// ─── The fixtures ───

const OPTIONS_KEY = 'molbiocraft.optionProfiles.v1';
/** Adaeze's own "EcoRI": the built-in's name over another motif and other offsets (5' TGGT). */
const MINE: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'TGGTGGTGA', cutFwd: 3, cutRev: 7, provenance: 'own isolate' };
/** A definition whose name starts with a built-in's, as the buffer table matches names. */
const PREFIXED: CustomEnzymeInput = { name: 'EcoRI-mine', recognitionSeq: 'TGTTGTTGTA', cutFwd: 4, cutRev: 6 };
/** A definition whose name holds "-HF", the other thing the buffer table matches. */
const HF: CustomEnzymeInput = { name: 'Mine-HF', recognitionSeq: 'TGTGGATTGTG', cutFwd: 5, cutRev: 5 };
/** A custom Type IIS definition: its home is the Type IIS menu (US-01M7J165), not the 5'/3' ones. */
const IIS: CustomEnzymeInput = { name: 'AdaIIS', recognitionSeq: 'TGATGATGC', cutFwd: 5, cutRev: 9, isTypeIIS: true };

const C = (n: number) => 'C'.repeat(n);

/**
 * The vector, 1,421 bp circular (C holds no site of anything below, nor across its junction):
 *   1..400 C | 401..406 GAATTC (EcoRI, cuts after 401, 5' AATT) | 407..706 C |
 *   707..715 TGGTGGTGA (the custom "EcoRI", cuts 3 in: after 709, 5' TGGT) | 716..1015 C |
 *   1016..1021 CTCGAG (XhoI, cuts after 1016, 5' TCGA) | 1022..1421 C
 */
const VEC = [C(400), 'GAATTC', C(300), MINE.recognitionSeq, C(300), 'CTCGAG', C(400)].join('');
/**
 * The insert, 86 bp linear: one EcoRI site (cuts after 21), one custom "EcoRI" site (after 39) and
 * one XhoI site (after 61), so each 5' choice releases its own fragment.
 */
const INS = [C(20), 'GAATTC', C(10), MINE.recognitionSeq, 'ATGAAAGGGTTTTAA', 'CTCGAG', C(20)].join('');

/** The construct the CUSTOM "EcoRI" + XhoI run must make: 1,136 bp. */
const CUSTOM_FRAGMENT = 'TGGTGAATGAAAGGGTTTTAAC';
const CUSTOM_CONSTRUCT = `${VEC.slice(0, 709)}${CUSTOM_FRAGMENT}${VEC.slice(1016)}`;
/** The construct the BUILT-IN EcoRI + XhoI run makes instead: 846 bp, another fragment. */
const BUILTIN_FRAGMENT = `AATTC${C(10)}${MINE.recognitionSeq}ATGAAAGGGTTTTAAC`;
const BUILTIN_CONSTRUCT = `${VEC.slice(0, 401)}${BUILTIN_FRAGMENT}${VEC.slice(1016)}`;

const docOf = (id: string, sequence: string, topology: 'circular' | 'linear'): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence, topology, features: [], primers: [],
});
const VECTOR_DOC = docOf('pVec', VEC, 'circular');
const INSERT_DOC = docOf('pIns', INS, 'linear');

function seeded(inputs: CustomEnzymeInput[], storage: LiveStorage = memoryStorage()): LiveStorage {
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => '2026-01-01T00:00:00.000Z', newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}
/** `storage` with the clone window's last-used values set, as an earlier session leaves them. */
function lastUsed(storage: LiveStorage, values: Record<string, string>): LiveStorage {
  storage.setItem(OPTIONS_KEY, JSON.stringify({ lastUsed: { 'clone-insert': values }, profiles: [] }));
  return storage;
}

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function withDocs(
  storage: LiveStorage,
  docs: SequenceDocument[],
  tab: 'sequence-view' | 'cloning-gel',
  run: (app: AppHarness) => Promise<void>
): Promise<void> {
  engine.calls.length = 0;
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({ documents: docs, activeDocId: docs[0].id, viewerTab: tab });
    await app.settle();
    await run(app);
  } finally {
    app.unmount();
  }
}

/** Opens the Clone Insert into Vector window on `vector` and `insert`. */
async function openClone(app: AppHarness, vector: string, insert: string): Promise<void> {
  await app.menu('actions:clone-dialog');
  await app.settle();
  await app.change(app.one('#opdlg-cl-vector', 'the vector select'), vector);
  await app.change(app.one('#opdlg-cl-insert', 'the insert select'), insert);
  await app.settle();
}
const enzMenu = (app: AppHarness, side: "5'" | "3'") => app.one(`select[aria-label="${side} enzyme"]`, `the ${side} enzyme menu`);
const menuOptions = (app: AppHarness, side: "5'" | "3'") =>
  enzMenu(app, side).querySelectorAll('option').map((o) => ({ value: o.getAttribute('value') ?? '', label: words(o.textContent) }));
const cloneHint = (app: AppHarness) =>
  app.all('.mbc-opdlg-hint').map((h) => words(h.textContent)).filter((t) => t.includes('cut the vector exactly once'));
/** Presses the window's Clone button and lets the run start (the window paints first). */
async function pressClone(app: AppHarness): Promise<void> {
  const b = app.all('button.btn-primary-sm').find((x) => words(x.textContent) === 'Clone');
  if (!b) throw new Error('no "Clone" button');
  await app.click(b);
  await act(async () => { vi.advanceTimersByTime(50); });
  await app.settle();
}
const clonings = () =>
  engine.calls.filter((c) => c.op === 'simulate_molecular_cloning').map((c) => ({
    payload: c.payload as { enzyme5Prime: string; enzyme3Prime: string; goldenGateEnzyme: string; customEnzymes: RestrictionEnzyme[] | null },
    reply: c.reply as {
      success: boolean;
      summary: string;
      warnings: string[];
      constructDocument: SequenceDocument;
      leftJunctionSeq: string;
      rightJunctionSeq: string;
      overhangOrHomologyLeft: string;
      overhangOrHomologyRight: string;
    },
  }));
const scanLists = () =>
  engine.calls.filter((c) => c.op === 'find_restriction_cut_sites').map((c) => (c.payload.customEnzymes as RestrictionEnzyme[] | null));

/** A label's own words: what it says beside the control it holds, not the control's own text. */
const ownWords = (label: LiveElement) =>
  words(label.childNodes.map((n) => (n instanceof LiveElement && (n.tagName === 'SELECT' || n.tagName === 'INPUT') ? '' : n.textContent)).join(''));
/** The studio's reaction fields, by the words that name them. */
const field = (app: AppHarness, name: string): LiveElement => {
  const found = app
    .all('select')
    .filter((c) => c.getAttribute('aria-label') === name || c.labels.some((l) => ownWords(l) === name));
  expect(found, `one "${name}" control`).toHaveLength(1);
  return found[0];
};
const ENZYME_5 = "5' Restriction Enzyme:";
const ENZYME_3 = "3' Restriction Enzyme:";
const studioOptions = (app: AppHarness, name: string) =>
  field(app, name).querySelectorAll('option').map((o) => ({ value: o.getAttribute('value') ?? '', label: words(o.textContent) }));
/** The reaction's buffer-compatibility callout: its line, then one line per custom enzyme in it. */
const bufferLine = (app: AppHarness) => {
  const found = app.all('.info-callout').filter((c) => words(c.textContent).startsWith('Reaction Buffer Compatibility'));
  expect(found, 'one buffer-compatibility callout').toHaveLength(1);
  const custom = found[0].querySelectorAll('.cloning-buffer-plan-custom').map((d) => words(d.textContent));
  let head = found[0].textContent ?? '';
  for (const d of found[0].querySelectorAll('.cloning-buffer-plan-custom')) head = head.replace(d.textContent ?? '', '');
  return [words(head), ...custom].join(' | ');
};
const planCalls = () => engine.calls.filter((c) => c.op === 'evaluate_multi_digest_buffer_plan').map((c) => c.payload.enzymes as string[]);
const chips = (app: AppHarness) =>
  app.all('button.enz-chip').map((b) => ({ name: words(b.textContent), on: b.classList.contains('active'), el: b }));
async function toggleChip(app: AppHarness, name: string) {
  const hit = chips(app).filter((c) => c.name === name);
  expect(hit, `one "${name}" chip`).toHaveLength(1);
  await app.click(hit[0].el);
  await app.settle();
}

// ─── AC1 ───

describe('US-01M7HRV4 AC1: the clone window ligates with the definition\'s own sites and overhangs', () => {
  it('US-01M7HRV4 AC1 choosing "EcoRI (custom)" as the 5\' enzyme makes the definition\'s literal construct, and the built-in EcoRI another', async () => {
    await withDocs(seeded([MINE]), [VECTOR_DOC, INSERT_DOC], 'sequence-view', async (app) => {
      await openClone(app, 'pVec', 'pIns');
      // Both "EcoRI"s are offered, each its own option: the custom one by its id, marked.
      expect(menuOptions(app, "5'").filter((o) => o.label.startsWith('EcoRI'))).toEqual([
        { value: 'EcoRI', label: 'EcoRI' },
        { value: 'custom:seed-1', label: 'EcoRI (custom)' },
      ]);

      // The custom "EcoRI" with XhoI: its own site (after base 709 of the vector, after 39 of the
      // insert) and its own 5' TGGT overhang.
      await app.change(enzMenu(app, "5'"), 'custom:seed-1');
      await app.change(enzMenu(app, "3'"), 'XhoI');
      engine.calls.length = 0;
      await pressClone(app);
      const runs = clonings();
      expect(runs, 'one cloning run').toHaveLength(1);
      expect([runs[0].payload.enzyme5Prime, runs[0].payload.enzyme3Prime]).toEqual(['custom:seed-1', 'XhoI']);
      expect((runs[0].payload.customEnzymes ?? []).map((e) => [e.id, e.name, e.recognitionSeq, e.cutFwd, e.cutRev])).toEqual([
        ['custom:seed-1', 'EcoRI', MINE.recognitionSeq, 3, 7],
      ]);
      const out = runs[0].reply;
      expect(out.success, out.summary).toBe(true);
      expect(out.constructDocument.sequence).toBe(CUSTOM_CONSTRUCT);
      expect(out.constructDocument.sequence.length).toBe(1136);
      // The insert's fragment sits at 710..731, so the junctions are the 12 bases either side.
      expect(out.leftJunctionSeq).toBe(CUSTOM_CONSTRUCT.slice(697, 721));
      expect(out.rightJunctionSeq).toBe(CUSTOM_CONSTRUCT.slice(719, 743));
      expect(out.overhangOrHomologyLeft).toBe("EcoRI (custom) 5'-TGGT-3' (5prime)");
      expect(out.overhangOrHomologyRight).toBe("XhoI 5'-TCGA-3' (5prime)");
      expect(out.summary).toBe(
        'EcoRI (custom)/XhoI-cut insert (22 bp) ligated into the EcoRI (custom)/XhoI-opened pVec backbone (1114 bp): 1136 bp circular construct.'
      );
      expect(out.constructDocument.history.at(-1)?.operation).toBe('Restriction Ligation (EcoRI (custom) / XhoI)');
      // The construct reached the workspace.
      expect(app.all('[aria-label^="Close "]').map((b) => b.getAttribute('aria-label'))).toContain('Close pVec-pIns');

      // The same run with the same-named BUILT-IN chosen instead: another construct.
      await openClone(app, 'pVec', 'pIns');
      await app.change(enzMenu(app, "5'"), 'EcoRI');
      await app.change(enzMenu(app, "3'"), 'XhoI');
      engine.calls.length = 0;
      await pressClone(app);
      const second = clonings();
      expect(second).toHaveLength(1);
      expect(second[0].payload.enzyme5Prime).toBe('EcoRI');
      expect(second[0].payload.customEnzymes, 'no definition is sent for a catalogue pair').toBeNull();
      expect(second[0].reply.success, second[0].reply.summary).toBe(true);
      expect(second[0].reply.constructDocument.sequence).toBe(BUILTIN_CONSTRUCT);
      expect(second[0].reply.constructDocument.sequence.length).toBe(846);
      expect(second[0].reply.constructDocument.sequence).not.toBe(CUSTOM_CONSTRUCT);
      expect(second[0].reply.overhangOrHomologyLeft).toBe("EcoRI 5'-AATT-3' (5prime)");
    });
  });
});

// ─── AC4 ───

describe('US-01M7HRV4 AC4: a custom enzyme and a same-named built-in stay apart in every cloning picker', () => {
  it('US-01M7HRV4 AC4 the window\'s 5\' and 3\' menus key by id and label by name, and each choice is its own', async () => {
    await withDocs(seeded([MINE, PREFIXED]), [VECTOR_DOC, INSERT_DOC], 'sequence-view', async (app) => {
      await openClone(app, 'pVec', 'pIns');
      const five = menuOptions(app, "5'");
      expect(five.map((o) => o.label).filter((l) => l.startsWith('EcoRI'))).toEqual(['EcoRI', 'EcoRI (custom)']);
      expect(five.find((o) => o.label === 'EcoRI (custom)')?.value).toBe('custom:seed-1');
      // Both menus offer the same enzymes; each also carries its own chosen-but-not-unique entry.
      const unique = (side: "5'" | "3'") => menuOptions(app, side).filter((o) => !o.label.includes('not a unique cutter'));
      expect(unique("3'")).toEqual(unique("5'"));
      expect(unique("5'").map((o) => o.label)).toContain('EcoRI (custom)');
      // No option anywhere carries a bare id as its words.
      for (const o of [...five, ...menuOptions(app, "3'")]) expect(o.label).not.toContain('custom:');

      // Choosing one leaves the other's choice as it was.
      await app.change(enzMenu(app, "5'"), 'custom:seed-1');
      await app.change(enzMenu(app, "3'"), 'XhoI');
      expect([enzMenu(app, "5'").value, enzMenu(app, "3'").value]).toEqual(['custom:seed-1', 'XhoI']);
      await app.change(enzMenu(app, "5'"), 'EcoRI');
      expect(enzMenu(app, "3'").value, "the 3' choice is untouched").toBe('XhoI');
    });
  });

  it('US-01M7HRV4 AC4 a chosen key that is not a unique cutter, and one whose definition is no longer stored, are named by words', async () => {
    // "EcoRI-mine" does not cut this vector, and custom:gone is not stored at all.
    await withDocs(
      seeded([MINE, PREFIXED], lastUsed(memoryStorage(), { enzyme5: 'custom:gone', enzyme3: 'custom:seed-2' })),
      [VECTOR_DOC, INSERT_DOC],
      'sequence-view',
      async (app) => {
        await openClone(app, 'pVec', 'pIns');
        expect(menuOptions(app, "5'")[0]).toEqual({
          value: 'custom:gone',
          label: 'A custom enzyme no longer stored (not a unique cutter in the vector)',
        });
        expect(menuOptions(app, "3'")[0]).toEqual({
          value: 'custom:seed-2',
          label: 'EcoRI-mine (custom) (not a unique cutter in the vector)',
        });
      }
    );
  });

  it('US-01M7HRV4 AC4 over 100,000 bp the single cutters come from the core built-ins plus every definition, and the words say so', async () => {
    // 120,000 bp: one custom "EcoRI" site, one EcoRI-mine site and one XhoI site, nothing else.
    const big = [C(40_000), MINE.recognitionSeq, C(39_975), PREFIXED.recognitionSeq, C(20_000), 'CTCGAG', C(20_000)].join('');
    expect(big.length).toBe(120_000);
    await withDocs(seeded([MINE, PREFIXED]), [docOf('pBig', big, 'circular'), INSERT_DOC], 'sequence-view', async (app) => {
      engine.calls.length = 0;
      await openClone(app, 'pBig', 'pIns');
      const sent = scanLists().filter((l) => l !== null) as RestrictionEnzyme[][];
      expect(sent.length, 'the vector was scanned with a list of its own').toBeGreaterThan(0);
      for (const list of sent) {
        expect(list.filter((e) => e.source === 'custom').map((e) => e.id)).toEqual(['custom:seed-1', 'custom:seed-2']);
        expect(list.filter((e) => e.source !== 'custom')).toHaveLength(28);
      }
      const five = menuOptions(app, "5'");
      expect(five.filter((o) => o.label.endsWith('(custom)')).map((o) => o.label)).toEqual(['EcoRI (custom)', 'EcoRI-mine (custom)']);
      expect(five.map((o) => o.label)).toContain('XhoI');
      expect(cloneHint(app)).toEqual([
        '3 enzymes cut the vector exactly once among 28 core enzymes plus 2 custom. ' +
          'Only 28 core enzymes and your 2 custom enzymes were scanned: other built-in enzymes may also cut this sequence.',
      ]);
    });
  });

  it('US-01M7HRV4 AC4 the studio\'s 5\'/3\' selects list every non-Type-IIS definition, by id and label, with its own words', async () => {
    await withDocs(seeded([MINE, IIS]), [VECTOR_DOC, INSERT_DOC], 'cloning-gel', async (app) => {
      for (const name of [ENZYME_5, ENZYME_3]) {
        const options = studioOptions(app, name);
        // The custom option's full text, the empty buffer field included.
        expect(options.filter((o) => o.label.endsWith('(custom)'))).toEqual([]);
        expect(options.filter((o) => o.value.startsWith('custom:'))).toEqual([
          { value: 'custom:seed-1', label: 'EcoRI (custom) (TGGTGGTGA) —' },
        ]);
        expect(options.filter((o) => o.label.startsWith('EcoRI'))).toEqual([
          { value: 'EcoRI', label: 'EcoRI (GAATTC) — rCutSmart / NEBuffer EcoRI' },
          { value: 'custom:seed-1', label: 'EcoRI (custom) (TGGTGGTGA) —' },
        ]);
        // The custom Type IIS definition's home is the Type IIS menu, not these.
        expect(options.map((o) => o.value)).not.toContain('custom:seed-2');
        expect(options.map((o) => o.value)).not.toContain('BsaI-HFv2');
      }
      // Choosing one leaves the other as it was.
      await app.change(field(app, ENZYME_5), 'custom:seed-1');
      await app.settle();
      expect([field(app, ENZYME_5).value, field(app, ENZYME_3).value]).toEqual(['custom:seed-1', 'XhoI']);
    });
  });
});

// ─── AC6 ───

/** The catalogue line the studio has always drawn for its opening EcoRI + XhoI pair. */
const CATALOGUE_BUFFER_LINE = 'Reaction Buffer Compatibility: 1× rCutSmart Buffer at 37°C (100% shared activity • Single-tube co-digest)';

describe('US-01M7HRV4 AC6: neither buffer plan is ever given a custom enzyme\'s name or key', () => {
  it('US-01M7HRV4 AC6 a custom twin, a prefix-named one and an "-HF" one read as activity unknown, and two custom enzymes plan nothing', async () => {
    await withDocs(seeded([MINE, PREFIXED, HF]), [VECTOR_DOC, INSERT_DOC], 'cloning-gel', async (app) => {
      // The catalogue pair, as the studio has always drawn it, once.
      expect(bufferLine(app)).toBe(CATALOGUE_BUFFER_LINE);
      for (const sent of planCalls()) for (const n of sent) expect(n).not.toContain('custom:');

      // One custom enzyme beside XhoI: the plan is XhoI's alone, the custom one activity unknown.
      for (const [key, label] of [['custom:seed-1', 'EcoRI (custom)'], ['custom:seed-2', 'EcoRI-mine (custom)'], ['custom:seed-3', 'Mine-HF (custom)']] as const) {
        engine.calls.length = 0;
        await app.change(field(app, ENZYME_5), key);
        await app.change(field(app, ENZYME_3), 'XhoI');
        await app.settle();
        // The reaction's plan is XhoI's alone; the gel's own digest plan (the BamHI + XhoI chips)
        // is the other caller, and no call anywhere carries a custom name or key.
        expect(planCalls(), `${label}: the reaction is planned over XhoI alone`).toContainEqual(['XhoI']);
        for (const sent of planCalls()) {
          for (const n of sent) expect(n, `${label}: no custom enzyme reaches the planner`).not.toMatch(/custom:|\(custom\)/);
        }
        expect(bufferLine(app)).toBe(
          'Reaction Buffer Compatibility for XhoI only: 1× rCutSmart Buffer at 37°C (100% shared activity • Single-tube co-digest)' +
            ` | ${label}: activity unknown. It is not in the built-in buffer table; check its supplier's chart.`
        );
      }

      // Both enzymes custom: no buffer, no temperature, no caution taken on their behalf.
      await app.change(field(app, ENZYME_5), 'custom:seed-1');
      await app.change(field(app, ENZYME_3), 'custom:seed-3');
      await app.settle();
      // Cleared only once both are custom, so no call below was made for a pair holding a built-in.
      engine.calls.length = 0;
      await app.change(field(app, ENZYME_5), 'custom:seed-2');
      await app.change(field(app, ENZYME_5), 'custom:seed-1');
      await app.settle();
      const line = bufferLine(app);
      expect(line).toBe(
        'Reaction Buffer Compatibility: none. The built-in buffer table holds no custom enzyme, so no buffer or incubation is planned for this reaction.' +
          " | EcoRI (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart." +
          " | Mine-HF (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart."
      );
      for (const absent of ['°C', 'rCutSmart', 'min activity', 'shared activity', 'star', 'methyl', 'CpG', 'Sequential digest']) {
        expect(line, `${absent} is not planned for a custom pair`).not.toContain(absent);
      }
      // Nothing is planned for the reaction: the only calls left are the gel's own digest chips.
      for (const sent of planCalls()) {
        expect(sent, 'the digest chips are the only caller left').toEqual(['BamHI', 'XhoI']);
      }
    });
  });

  it('US-01M7HRV4 AC6 with no digest chip chosen the digest plan falls back through the active list, so no custom: id reaches the planner', async () => {
    await withDocs(seeded([MINE]), [VECTOR_DOC, INSERT_DOC], 'cloning-gel', async (app) => {
      await app.change(field(app, ENZYME_5), 'custom:seed-1');
      await app.change(field(app, ENZYME_3), 'XhoI');
      await app.settle();
      // Clear both opening chips: the digest plan then follows the 5'/3' choice.
      for (const name of ['BamHI', 'XhoI']) await toggleChip(app, name);
      expect(chips(app).filter((c) => c.on)).toEqual([]);
      engine.calls.length = 0;
      await app.change(field(app, ENZYME_3), 'BamHI');
      await app.settle();
      expect(planCalls().length).toBeGreaterThan(0);
      for (const sent of planCalls()) {
        expect(sent, 'the planner is given the chosen built-ins only').toEqual(['BamHI']);
        for (const n of sent) expect(n).not.toContain('custom:');
      }
      const plan = app.all('details.mbc-progressive-details').filter((d) => words(d.textContent).startsWith('Co-digest buffer plan'));
      expect(plan, 'one digest buffer plan').toHaveLength(1);
      expect(words(plan[0].textContent)).toContain('Co-Digest Buffer Plan for BamHI only:');
      expect(words(plan[0].textContent)).toContain(
        "EcoRI (custom): activity unknown. It is not in the built-in buffer table; check its supplier's chart."
      );
      expect(words(plan[0].textContent)).not.toContain('custom:seed-1');
    });
  });

  it('US-01M7HRV4 AC6 with nothing stored the studio\'s opening line is the catalogue one, drawn once', async () => {
    await withDocs(memoryStorage(), [VECTOR_DOC, INSERT_DOC], 'cloning-gel', async (app) => {
      expect(bufferLine(app)).toBe(CATALOGUE_BUFFER_LINE);
      expect(app.all('.info-callout').filter((c) => words(c.textContent).startsWith('Reaction Buffer Compatibility'))).toHaveLength(1);
      expect(studioOptions(app, ENZYME_5).filter((o) => o.value.startsWith('custom:'))).toEqual([]);
      expect(studioOptions(app, ENZYME_5).length).toBe(REBASE_ENZYMES.filter((e) => !e.isTypeIIS).length);
      expect([field(app, ENZYME_5).value, field(app, ENZYME_3).value]).toEqual(['EcoRI', 'XhoI']);
    });
  });
});
