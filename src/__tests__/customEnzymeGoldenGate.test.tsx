// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7J165: Golden Gate assembly with a stored custom Type IIS definition. The cloning studio's
 * and the Clone Insert into Vector window's Type IIS menus offer every definition marked Type IIS,
 * marked "(custom)" and keyed by its id; the run assembles through the real WASM op with the
 * definition's own sites and overhangs; a definition that is not Type IIS is refused by its label;
 * and the catalogue's own results are untouched.
 *
 * Driven through the rendered App over the live DOM, with the committed WASM engine, whose entry
 * point is watched, not replaced. The studio's definition is created through the Restriction
 * Enzymes window's own Type IIS checkbox, so that path is the one a user walks; the window's tests
 * start from a store an earlier session left, which is their own path. Every expected sequence,
 * length, overhang, warning and option string is a literal written here from the fixture's
 * construction and the definition's own offsets, never read back from the op [LC-002]; the id the
 * window allocates is the one it shows, read from the option it offers.
 *
 * The one clause no fixture of the App can reach - the opening Type IIS value when the list holds
 * no BsaI-HFv2 - is driven against the window itself, rendered over a list of its own.
 */

import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CloningOperationDialog } from '../components/CloningAssemblyOperationDialogs';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { saveLastUsed } from '../core/optionProfiles';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { LiveDocument, LiveElement, memoryStorage, parseMarkup, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** Every cloning call the engine receives, with its payload and its reply. */
const engine = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; payload: Record<string, unknown>; reply?: unknown }>,
}));
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return {
    ...actual,
    invokeRustBioSync: (op: string, payload?: unknown) => {
      const reply = actual.invokeRustBioSync(op, payload);
      if (op === 'simulate_molecular_cloning') {
        engine.calls.push({ op, payload: (payload ?? {}) as Record<string, unknown>, reply });
      }
      return reply;
    },
  };
});
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

// ─── The definitions ───

/**
 * Adaeze's own Type IIS enzyme: a 7-nt motif, the top-strand cut 1 nt past it (`cutFwd` 8) and the
 * bottom-strand cut 4 nt further (`cutRev` 12), so it leaves a 4-nt 5' overhang outside its
 * recognition site - BsaI-HFv2's geometry over a motif of her own.
 */
const IIS: CustomEnzymeInput = { name: 'AdaIIS', recognitionSeq: 'CTGCCGA', cutFwd: 8, cutRev: 12, isTypeIIS: true };
/** The same definition NOT marked Type IIS, so only the flag differs from the one above. */
const FLAT: CustomEnzymeInput = { name: 'AdaFlat', recognitionSeq: 'CTGCCGA', cutFwd: 8, cutRev: 12 };
const MOTIF = 'CTGCCGA';
/** Its reverse complement, as the top strand reads a site on the other strand. */
const RC_MOTIF = 'TCGGCAG';

// ─── The Golden Gate fixtures ───

const C = (n: number) => 'C'.repeat(n);
/** The 16 bp the construct opens with, and the 22 bp it closes with: the vector's backbone. */
const X = C(16);
const Y = C(22);
/**
 * The part's own 16 bp between its overhangs. It opens "GA", which with the backbone's last C and
 * the TGCC overhang spells CTGCCGA once the two are joined - the residual site, in neither input
 * (the vector reads C TGCC A there, the part A TGCC GA).
 */
const INNER = 'GATGAAACCCGGGTAA';
/**
 * The vector, 70 bp circular: a reverse-strand site whose 4-nt overhang is TGCC and a
 * forward-strand site whose overhang is GCTT, pointing at each other, so the backbone between them
 * carries no recognition site. Poly-C filler holds no motif, and none across the circular junction.
 */
const IIS_VEC = `${X}TGCCA${RC_MOTIF}${C(8)}${MOTIF}AGCTT${Y}`;
/** The part, 41 bp linear: its two sites release TGCC + INNER + GCTT, the vector's own overhangs. */
const IIS_PART = `TT${MOTIF}ATGCC${INNER}GCTTA${RC_MOTIF}TT`;
/**
 * The construct: the vector's backbone with the part's fragment between its two stretches, both
 * recognition sites excised - 16 + (4 + 16 + 4) + 22 = 62 bp, written from the vector's own origin.
 */
const IIS_CONSTRUCT = `${X}TGCC${INNER}GCTT${Y}`;
/**
 * Each piece runs from cut to cut, so one overhang travels with each: the part's fragment is
 * TGCC + INNER (20 bp) and the backbone GCTT + Y + X (42 bp), 62 bp once they are joined.
 */
const IIS_SUMMARY =
  'AdaIIS (custom) Golden Gate: 20 bp part joined to the 42 bp backbone through TGCC/GCTT overhangs: 62 bp construct.';
const IIS_WARNING = 'The product still contains a AdaIIS (custom) site and would be re-cut during cycling.';

/** The same geometry over the catalogue's BsaI-HFv2 (GGTCTC, 1-nt spacer, 4-nt overhang). */
const BSA_VEC = `AAAACCCCGGGGTTTTTGCCAGAGACCAAAAAAAAGGTCTCAGCTTACGTACGTACGTACGTACGTAC`;
const BSA_PART = 'TTGGTCTCATGCCATGAAACCCGGGTAAGCTTAGAGACCTT';
/** 16 + (4 + 15 + 4) + 22 = 61 bp, and no site survives to re-cut it. */
const BSA_CONSTRUCT = `AAAACCCCGGGGTTTTTGCCATGAAACCCGGGTAAGCTTACGTACGTACGTACGTACGTAC`;
const BSA_SUMMARY =
  'BsaI-HFv2 Golden Gate: 19 bp part joined to the 42 bp backbone through TGCC/GCTT overhangs: 61 bp construct.';

const docOf = (id: string, sequence: string, topology: 'circular' | 'linear'): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence, topology, features: [], primers: [],
});
const IIS_DOCS = [docOf('pIIS', IIS_VEC, 'circular'), docOf('pPart', IIS_PART, 'linear')];
const BSA_DOCS = [docOf('bVec', BSA_VEC, 'circular'), docOf('bPart', BSA_PART, 'linear')];

const OPTIONS_KEY = 'molbiocraft.optionProfiles.v1';

/** `storage` with these definitions stored under ids `custom:seed-1`, `custom:seed-2`, … */
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
function lastUsedValues(storage: LiveStorage, values: Record<string, string>): LiveStorage {
  storage.setItem(OPTIONS_KEY, JSON.stringify({ lastUsed: { 'clone-insert': values }, profiles: [] }));
  return storage;
}

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const optionsOf = (select: LiveElement) =>
  select.querySelectorAll('option').map((o) => ({ value: o.getAttribute('value') ?? '', label: words(o.textContent) }));

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

/** A label's own words: what it says beside the control it holds, not the control's own text. */
const ownWords = (label: LiveElement) =>
  words(label.childNodes.map((n) => (n instanceof LiveElement && (n.tagName === 'SELECT' || n.tagName === 'INPUT') ? '' : n.textContent)).join(''));
/** The studio's reaction fields, by the words that name them. */
const field = (app: AppHarness, name: string): LiveElement => {
  const found = app.all('select').filter((c) => c.getAttribute('aria-label') === name || c.labels.some((l) => ownWords(l) === name));
  expect(found, `one "${name}" control`).toHaveLength(1);
  return found[0];
};
const TYPE_IIS = 'Type IIS Restriction Endonuclease:';
const VECTOR = 'Recipient Vector Backbone:';
const DONOR = 'Donor Insert Fragment:';

/** Clicks the studio's method pill, as a user does. */
async function openMethod(app: AppHarness, method: string): Promise<void> {
  const hit = app.all('.cloning-method-tabs button').filter((b) => words(b.textContent) === method);
  expect(hit, `one "${method}" method pill`).toHaveLength(1);
  await app.click(hit[0]);
  await app.settle();
}
/** Presses the studio's Simulate button for `method`. */
async function simulate(app: AppHarness, method: string): Promise<void> {
  const b = app.all('button.btn-primary').filter((x) => words(x.textContent) === `Simulate ${method} Reaction`);
  expect(b, 'one Simulate button').toHaveLength(1);
  engine.calls.length = 0;
  await app.click(b[0]);
  await app.settle();
}
/** The studio's result box: its headline, summary, the two overhangs and every warning note. */
function studioResult(app: AppHarness) {
  const box = app.all('.cloning-result-box').filter((b) => words(b.textContent).startsWith('Construct Preview:'));
  expect(box, 'one construct preview').toHaveLength(1);
  return {
    headline: words(box[0].querySelectorAll('.result-headline')[0].textContent),
    summary: words(box[0].querySelectorAll('.result-summary-text')[0].textContent),
    overhangs: box[0].querySelectorAll('.junction-card code').map((c) => words(c.textContent)),
    warnings: box[0].querySelectorAll('.cloning-warning-note').map((w) => words(w.textContent)),
  };
}

/** Opens the Clone Insert into Vector window on `vector` and `insert`, in Golden Gate. */
async function openGoldenGate(app: AppHarness, vector: string, insert: string): Promise<void> {
  await app.menu('actions:clone-dialog');
  await app.settle();
  await app.change(app.one('#opdlg-cl-method', 'the method select'), 'Golden Gate (Type IIS)');
  await app.change(app.one('#opdlg-cl-vector', 'the vector select'), vector);
  await app.change(app.one('#opdlg-cl-insert', 'the insert select'), insert);
  await app.settle();
}
const iisMenu = (app: AppHarness) => app.one('#opdlg-cl-iis', 'the window\'s Type IIS menu');
/** Presses the window's Clone button and lets the run start (the window paints first). */
async function pressClone(app: AppHarness): Promise<void> {
  const b = app.all('button.btn-primary-sm').find((x) => words(x.textContent) === 'Clone');
  if (!b) throw new Error('no "Clone" button');
  engine.calls.length = 0;
  await app.click(b);
  await act(async () => { vi.advanceTimersByTime(50); });
  await app.settle();
}
const clonings = () =>
  engine.calls.map((c) => ({
    payload: c.payload as { goldenGateEnzyme: string; customEnzymes: RestrictionEnzyme[] | null },
    reply: c.reply as {
      success: boolean;
      summary: string;
      warnings: string[];
      constructDocument: SequenceDocument;
      overhangOrHomologyLeft: string;
      overhangOrHomologyRight: string;
    },
  }));

/** Creates a definition through the Restriction Enzymes window, the Type IIS checkbox included. */
async function createThroughTheWindow(app: AppHarness, d: CustomEnzymeInput): Promise<void> {
  await app.menu('tools:enzyme-database');
  await app.settle();
  const win = app.one('[role="dialog"][aria-labelledby="enzyme-db-title"]', 'the Restriction Enzymes window');
  const button = (name: string) => {
    const found = win.querySelectorAll('button').filter((b) => b.getAttribute('aria-label') === name || words(b.textContent) === name);
    expect(found, `one "${name}" button`).toHaveLength(1);
    return found[0];
  };
  await app.click(button('Add custom enzyme'));
  await app.settle();
  const formField = (label: string) => app.one(`[role="dialog"][aria-labelledby="enzyme-db-title"] form [aria-label="${label}"]`, label);
  await app.input(formField('Name'), d.name);
  await app.input(formField("Recognition motif (5' → 3')"), d.recognitionSeq);
  await app.input(formField('Top-strand cut (bases from the motif start)'), String(d.cutFwd));
  await app.input(formField('Bottom-strand cut (bases from the motif start)'), String(d.cutRev));
  if (d.isTypeIIS) await app.change(formField('Type IIS'), true);
  await app.settle();
  await app.click(button('Save Enzyme'));
  await app.settle();
  await app.click(button('Close Restriction Enzymes'));
  await app.settle();
}

// ─── AC1 ───

describe('US-01M7J165 AC1: Golden Gate assembles with a stored custom Type IIS definition', () => {
  it('US-01M7J165 AC1 the studio assembles with a definition created through the Restriction Enzymes window, by its own sites and overhangs', async () => {
    await withDocs(memoryStorage(), IIS_DOCS, 'cloning-gel', async (app) => {
      // Nothing is stored yet: the Type IIS menu is the catalogue's alone.
      await openMethod(app, 'Golden Gate (Type IIS)');
      expect(optionsOf(field(app, TYPE_IIS)).filter((o) => o.value.startsWith('custom:'))).toEqual([]);

      // Adaeze defines her enzyme in the Restriction Enzymes window, Type IIS ticked.
      await createThroughTheWindow(app, IIS);
      const custom = optionsOf(field(app, TYPE_IIS)).filter((o) => o.value.startsWith('custom:'));
      expect(custom.map((o) => o.label), 'her definition is offered, marked, with its own motif').toEqual([
        'AdaIIS (custom) (CTGCCGA) —',
      ]);
      const key = custom[0].value;

      // Her enzyme, her vector and her part: the construct is her definition's own.
      await app.change(field(app, VECTOR), 'pIIS');
      await app.change(field(app, DONOR), 'pPart');
      await app.change(field(app, TYPE_IIS), key);
      await app.settle();
      await simulate(app, 'Golden Gate (Type IIS)');
      const runs = clonings();
      expect(runs, 'one cloning run').toHaveLength(1);
      expect(runs[0].payload.goldenGateEnzyme).toBe(key);
      expect((runs[0].payload.customEnzymes ?? []).map((e) => [e.name, e.recognitionSeq, e.cutFwd, e.cutRev, e.isTypeIIS])).toEqual([
        ['AdaIIS', MOTIF, 8, 12, true],
      ]);
      const out = runs[0].reply;
      expect(out.success, out.summary).toBe(true);
      expect(out.constructDocument.sequence).toBe(IIS_CONSTRUCT);
      expect(out.constructDocument.sequence.length).toBe(62);
      expect(out.overhangOrHomologyLeft).toBe("5'-TGCC-3'");
      expect(out.overhangOrHomologyRight).toBe("5'-GCTT-3'");
      expect(out.summary).toBe(IIS_SUMMARY);
      expect(out.warnings).toEqual([IIS_WARNING]);
      expect(out.constructDocument.history.at(-1)?.operation).toBe('Golden Gate Assembly (AdaIIS (custom))');

      // And that is what the studio shows: her label, her overhangs, her residual-site warning.
      const shown = studioResult(app);
      expect(shown.headline).toBe('Construct Preview: pIIS-pPart (62 bp, circular)');
      expect(shown.summary).toBe(IIS_SUMMARY);
      expect(shown.overhangs).toEqual(["5'-TGCC-3'", "5'-GCTT-3'"]);
      expect(shown.warnings).toEqual([`⚠ ${IIS_WARNING}`]);
    });
  });

  it('US-01M7J165 AC1 the clone window assembles with the definition, and the catalogue cases keep their own literal results', async () => {
    await withDocs(seeded([IIS]), [...IIS_DOCS, ...BSA_DOCS], 'sequence-view', async (app) => {
      await openGoldenGate(app, 'pIIS', 'pPart');
      expect(optionsOf(iisMenu(app)).filter((o) => o.value.startsWith('custom:'))).toEqual([
        { value: 'custom:seed-1', label: 'AdaIIS (custom)' },
      ]);
      await app.change(iisMenu(app), 'custom:seed-1');
      await app.settle();
      await pressClone(app);
      const runs = clonings();
      expect(runs, 'one cloning run').toHaveLength(1);
      expect(runs[0].payload.goldenGateEnzyme).toBe('custom:seed-1');
      expect((runs[0].payload.customEnzymes ?? []).map((e) => [e.id, e.name, e.isTypeIIS])).toEqual([
        ['custom:seed-1', 'AdaIIS', true],
      ]);
      expect(runs[0].reply.success, runs[0].reply.summary).toBe(true);
      expect(runs[0].reply.constructDocument.sequence).toBe(IIS_CONSTRUCT);
      expect(runs[0].reply.summary).toBe(IIS_SUMMARY);
      expect(runs[0].reply.warnings).toEqual([IIS_WARNING]);
      expect(app.all('[aria-label^="Close "]').map((b) => b.getAttribute('aria-label'))).toContain('Close pIIS-pPart');

      // The catalogue's BsaI-HFv2 on its own fixture: today's literal result, with a custom
      // Type IIS definition stored and no definition sent.
      await openGoldenGate(app, 'bVec', 'bPart');
      // The window reopens on her definition, the run before having chosen it; BsaI-HFv2 is back
      // in a menu that offers both.
      expect(iisMenu(app).value, 'the choice the last run left').toBe('custom:seed-1');
      await app.change(iisMenu(app), 'BsaI-HFv2');
      await app.settle();
      await pressClone(app);
      const bsa = clonings();
      expect(bsa).toHaveLength(1);
      expect(bsa[0].payload.goldenGateEnzyme).toBe('BsaI-HFv2');
      expect(bsa[0].payload.customEnzymes, 'no definition is sent for a catalogue run').toBeNull();
      expect(bsa[0].reply.success, bsa[0].reply.summary).toBe(true);
      expect(bsa[0].reply.constructDocument.sequence).toBe(BSA_CONSTRUCT);
      expect(bsa[0].reply.constructDocument.sequence.length).toBe(61);
      expect(bsa[0].reply.summary).toBe(BSA_SUMMARY);
      expect(bsa[0].reply.warnings).toEqual([]);
      expect(bsa[0].reply.overhangOrHomologyLeft).toBe("5'-TGCC-3'");
      expect(bsa[0].reply.overhangOrHomologyRight).toBe("5'-GCTT-3'");
      expect(bsa[0].reply.constructDocument.sequence).not.toBe(IIS_CONSTRUCT);
    });
  });

  it('US-01M7J165 AC1 the "BsaI" prefix case keeps the catalogue result, and a definition that is not Type IIS is refused by its label', async () => {
    // An earlier session left "BsaI" chosen: the catalogue's dash-prefix fallback, unchanged.
    await withDocs(
      seeded([IIS, FLAT], lastUsedValues(memoryStorage(), { typeIIS: 'BsaI' })),
      BSA_DOCS,
      'sequence-view',
      async (app) => {
        await openGoldenGate(app, 'bVec', 'bPart');
        expect(optionsOf(iisMenu(app))[0], 'the chosen name, as it was chosen').toEqual({ value: 'BsaI', label: 'BsaI' });
        await pressClone(app);
        const runs = clonings();
        expect(runs).toHaveLength(1);
        expect(runs[0].payload.goldenGateEnzyme).toBe('BsaI');
        expect(runs[0].reply.success, runs[0].reply.summary).toBe(true);
        expect(runs[0].reply.constructDocument.sequence).toBe(BSA_CONSTRUCT);
        expect(runs[0].reply.summary, '"BsaI" is the catalogue\'s BsaI-HFv2, which names itself').toBe(BSA_SUMMARY);
        expect(runs[0].reply.warnings).toEqual([]);
      }
    );

    // The same definition's twin, not marked Type IIS, chosen in an earlier session: the Golden
    // Gate menu says so, and the run is refused by its label, never by a bare id.
    await withDocs(
      seeded([IIS, FLAT], lastUsedValues(memoryStorage(), { typeIIS: 'custom:seed-2' })),
      IIS_DOCS,
      'sequence-view',
      async (app) => {
        await openGoldenGate(app, 'pIIS', 'pPart');
        expect(optionsOf(iisMenu(app))[0]).toEqual({
          value: 'custom:seed-2',
          label: 'AdaFlat (custom) (not a Type IIS enzyme)',
        });
        await pressClone(app);
        const runs = clonings();
        expect(runs).toHaveLength(1);
        expect(runs[0].reply.success).toBe(false);
        expect(runs[0].reply.warnings[0]).toBe('AdaFlat (custom) is not a Type IIS enzyme.');
        const alert = app.all('[role="alert"]').map((a) => words(a.textContent));
        expect(alert, 'the window says why, in the definition\'s own words').toEqual([
          'Golden Gate (Type IIS) could not be simulated: AdaFlat (custom) is not a Type IIS enzyme.',
        ]);
        for (const a of alert) expect(a).not.toContain('custom:');
        // Nothing was assembled.
        expect(app.all('[aria-label^="Close "]').map((b) => b.getAttribute('aria-label'))).not.toContain('Close pIIS-pPart');
      }
    );
  });
});

// ─── AC2 ───

/** The Type IIS options the catalogue alone gives the studio, as it has always drawn them. */
const CATALOGUE_STUDIO_OPTIONS = REBASE_ENZYMES.filter((e) => e.isTypeIIS).map((e) => ({
  value: e.name,
  label: `${e.name} (${e.recognitionSeq}) — ${e.tempC}°C`,
}));

describe('US-01M7J165 AC2: what both Type IIS menus say, and what they open on', () => {
  it('US-01M7J165 AC2 the custom option\'s full text in both menus, and a chosen key whose definition is gone', async () => {
    await withDocs(seeded([IIS, FLAT]), IIS_DOCS, 'cloning-gel', async (app) => {
      // Each definition's home is one menu: the Type IIS one marked Type IIS, the other the 5'/3'
      // selects the studio opens on.
      for (const name of ["5' Restriction Enzyme:", "3' Restriction Enzyme:"]) {
        const five = optionsOf(field(app, name)).filter((o) => o.value.startsWith('custom:'));
        expect(five, `${name}: the Type IIS definition is not offered here`).toEqual([
          { value: 'custom:seed-2', label: 'AdaFlat (custom) (CTGCCGA) —' },
        ]);
      }

      // The studio: the definition's own motif, and nothing where a built-in's temperature stands,
      // because a definition records none.
      await openMethod(app, 'Golden Gate (Type IIS)');
      const studio = optionsOf(field(app, TYPE_IIS));
      expect(studio.filter((o) => o.value.startsWith('custom:'))).toEqual([
        { value: 'custom:seed-1', label: 'AdaIIS (custom) (CTGCCGA) —' },
      ]);
      expect(studio.slice(0, 2), "the catalogue's own options are as they were").toEqual([
        { value: 'BsaI-HFv2', label: 'BsaI-HFv2 (GGTCTC) — 37°C' },
        { value: 'BsmBI-v2', label: 'BsmBI-v2 (CGTCTC) — 55°C' },
      ]);
      // The definition that is not Type IIS is not offered here, nor is any 5'/3' enzyme.
      expect(studio.map((o) => o.value)).not.toContain('custom:seed-2');
      expect(studio.map((o) => o.value)).not.toContain('EcoRI');
      expect(studio.map((o) => o.label)).toEqual(studio.map((o) => o.label).filter((l) => !l.includes('custom:')));
      // The studio opens on the catalogue's own BsaI-HFv2 with a definition stored.
      expect(field(app, TYPE_IIS).value).toBe('BsaI-HFv2');

      // Chosen, and then edited in the Restriction Enzymes window until it is no longer a Type IIS
      // enzyme: the choice that has left the menu is still named by its label, never by its id.
      await app.change(field(app, TYPE_IIS), 'custom:seed-1');
      await app.settle();
      expect(field(app, TYPE_IIS).value).toBe('custom:seed-1');
      await app.menu('tools:enzyme-database');
      await app.settle();
      const named = (name: string) => {
        const found = app.all('button').filter((b) => b.getAttribute('aria-label') === name);
        expect(found, `one "${name}" button`).toHaveLength(1);
        return found[0];
      };
      await app.click(named('Edit AdaIIS'));
      await app.settle();
      await app.change(
        app.one('[role="dialog"][aria-labelledby="enzyme-db-title"] form [aria-label="Type IIS"]', 'the Type IIS checkbox'),
        false
      );
      await app.settle();
      await app.click(app.all('button').filter((b) => words(b.textContent) === 'Save Changes')[0]);
      await app.settle();
      await app.click(named('Close Restriction Enzymes'));
      await app.settle();
      const after = optionsOf(field(app, TYPE_IIS));
      expect(field(app, TYPE_IIS).value, 'the choice is as it was').toBe('custom:seed-1');
      expect(after.filter((o) => o.value === 'custom:seed-1').map((o) => o.label), 'still named, by her own label').toEqual([
        'AdaIIS (custom)',
      ]);
      for (const o of after) expect(o.label).not.toContain('custom:');
    });

    // The window: the same definition by its id, and a key stored in an earlier session whose
    // definition is gone, in words.
    await withDocs(
      seeded([IIS], lastUsedValues(memoryStorage(), { typeIIS: 'custom:gone' })),
      IIS_DOCS,
      'sequence-view',
      async (app) => {
        await openGoldenGate(app, 'pIIS', 'pPart');
        expect(optionsOf(iisMenu(app))[0]).toEqual({ value: 'custom:gone', label: 'A custom enzyme no longer stored' });
        expect(optionsOf(iisMenu(app)).filter((o) => o.value.startsWith('custom:seed-'))).toEqual([
          { value: 'custom:seed-1', label: 'AdaIIS (custom)' },
        ]);
        for (const o of optionsOf(iisMenu(app))) expect(o.label).not.toContain('custom:');
      }
    );
  });

  it('US-01M7J165 AC2 the window opens on BsaI-HFv2 whatever the list\'s order, and falls back to the first entry only when it is absent', async () => {
    const dialogPage = (enzymes: RestrictionEnzyme[]): LiveElement => {
      const html = renderToStaticMarkup(
        React.createElement(CloningOperationDialog, {
          candidates: IIS_DOCS, enzymes, onCreate: () => {}, onClose: () => {},
        })
      );
      const doc = new LiveDocument();
      const page = doc.createElement('div');
      doc.body.appendChild(page);
      for (const n of parseMarkup(html, doc)) page.appendChild(n);
      return page;
    };
    const mine: RestrictionEnzyme = {
      id: 'custom:first', source: 'custom', name: IIS.name, recognitionSeq: MOTIF, cutFwd: 8, cutRev: 12,
      isTypeIIS: true, suppliers: [], methylationSensitivity: [], bufferNEB: '', tempC: 37, provenance: '', notes: '',
    };

    const previous = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
    try {
      // An earlier session left the window on Golden Gate, with no Type IIS enzyme of its own.
      saveLastUsed('clone-insert', { method: 'Golden Gate (Type IIS)' });
      // Her definition first in the list: the window still opens on the catalogue's BsaI-HFv2.
      const iis = (page: LiveElement) => {
        const found = page.querySelectorAll('#opdlg-cl-iis');
        expect(found, "one Type IIS menu").toHaveLength(1);
        return found[0];
      };
      const withBsa = iis(dialogPage([mine, ...REBASE_ENZYMES]));
      expect(withBsa.value).toBe('BsaI-HFv2');
      expect(optionsOf(withBsa)[0].value, 'her definition is offered first all the same').toBe('custom:first');

      // And with no BsaI-HFv2 in the list at all, on the first Type IIS enzyme there is.
      expect(iis(dialogPage([mine, ...REBASE_ENZYMES.filter((e) => e.name !== 'BsaI-HFv2')])).value).toBe('custom:first');
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = previous;
    }
  });

  it('US-01M7J165 AC2 with nothing stored both Type IIS menus are the catalogue\'s own literals', async () => {
    await withDocs(memoryStorage(), IIS_DOCS, 'cloning-gel', async (app) => {
      await openMethod(app, 'Golden Gate (Type IIS)');
      expect(optionsOf(field(app, TYPE_IIS))).toEqual(CATALOGUE_STUDIO_OPTIONS);
      expect(optionsOf(field(app, TYPE_IIS)).slice(0, 3).map((o) => o.label)).toEqual([
        'BsaI-HFv2 (GGTCTC) — 37°C',
        'BsmBI-v2 (CGTCTC) — 55°C',
        'BbsI-HF (GAAGAC) — 37°C',
      ]);
      expect(field(app, TYPE_IIS).value).toBe('BsaI-HFv2');

      await openGoldenGate(app, 'pIIS', 'pPart');
      expect(optionsOf(iisMenu(app))).toEqual(CATALOGUE_STUDIO_OPTIONS.map((o) => ({ value: o.value, label: o.value })));
      expect(iisMenu(app).value).toBe('BsaI-HFv2');
    });
  });
});
