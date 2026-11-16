// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7J1WY: a workflow digest step's enzymes are chosen from a multi-select of the active enzyme
 * list, labelled by name with custom ones marked "(custom)", in the Run and the Manage windows; a
 * saved key the list lacks stays selected under words that say so; step summaries and the run log
 * label a custom key instead of printing its id.
 *
 * Driven through the rendered App (its local storage holding the enzyme store, the last-used
 * values and the saved workflows) and the committed WASM engine. The test DOM has no
 * `selectedOptions` and its `change` replaces a selection, so a choice is made by toggling an
 * option's `selected` and firing `change`. Every expected fragment, refusal and custom or stale label
 * is a literal; the catalogue's names and order, and the one stored value that depends on that order,
 * are read from `REBASE_ENZYMES`.
 */

import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { activeEnzymeList } from '../core/bioEngine';
import { describeSettings, runWorkflow, type Workflow, type WorkflowStep } from '../core/workflows';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { SequenceDocument } from '../types/bio';
import type { OperationResult } from '../core/operationRunners';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, LiveElement, memoryStorage, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * React DOM makes a multi-select by setting its `multiple` property, which a browser reflects to the
 * attribute; the test DOM reads only the attribute (its select type and option selection), so the
 * property is reflected here as a browser does. Left alone if the test DOM ever defines it.
 */
if (!Object.getOwnPropertyDescriptor(LiveElement.prototype, 'multiple')) {
  Object.defineProperty(LiveElement.prototype, 'multiple', {
    configurable: true,
    get(this: LiveElement) { return this.hasAttribute('multiple'); },
    set(this: LiveElement, v: boolean) { if (v) this.setAttribute('multiple', ''); else this.removeAttribute('multiple'); },
  });
}

/** Each `runDigest` outcome (watched, not replaced). */
const watch = vi.hoisted(() => ({ digests: [] as Array<{ result?: OperationResult; error?: string }> }));
vi.mock('../core/operationRunners', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/operationRunners')>();
  return {
    ...actual,
    runDigest: (...args: Parameters<typeof actual.runDigest>) => {
      try {
        const result = actual.runDigest(...args);
        watch.digests.push({ result });
        return result;
      } catch (e) {
        watch.digests.push({ error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
  };
});
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

beforeAll(async () => {
  const app = await mountApp();
  app.unmount();
});

// ─── The fixtures (TWO_ECO, MINE and MINE_FRAGMENTS copied from customEnzymeDigestDialog.test.tsx) ───

/** A/C filler: it holds no T or G, so no motif planted below occurs in it. */
const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};

const OPTIONS_KEY = 'molbiocraft.optionProfiles.v1';
const WORKFLOWS_KEY = 'molbiocraft.workflows.v1';
/** Adaeze's own "EcoRI": another motif and other offsets, under the built-in's name. */
const MINE: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'TGGTGGTGA', cutFwd: 3, cutRev: 7 };
/** EcoRI's GAATTC twice, the custom "EcoRI"'s motif once between them: 141 bp, linear. */
const TWO_ECO = [filler(30, 11), 'GAATTC', filler(30, 12), MINE.recognitionSeq, filler(30, 13), 'GAATTC', filler(30, 14)].join('');

const docOf = (id: string, sequence: string): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence, topology: 'linear', features: [], primers: [],
});

/** A store holding MINE as `custom:seed-1`. */
function seeded(storage: LiveStorage = memoryStorage()): LiveStorage {
  const db = openEnzymeDatabase({ storage, now: () => '2026-01-01T00:00:00.000Z', newId: () => 'custom:seed-1' });
  const r = db.add(MINE, { confirmedClash: builtInNameClash(MINE.name) });
  if (!r.ok) throw new Error(r.error.message);
  return storage;
}
function lastUsed(storage: LiveStorage, enzymes: string): LiveStorage {
  storage.setItem(OPTIONS_KEY, JSON.stringify({ lastUsed: { 'digest-fragments': { enzymes, keepAnnotations: true } }, profiles: [] }));
  return storage;
}
const digestStep = (settings: WorkflowStep['settings']): WorkflowStep => ({ op: 'digest-fragments', settings });
const asked = (): WorkflowStep => digestStep({ kind: 'ask' });
const setHere = (enzymes: string): WorkflowStep => digestStep({ kind: 'custom', values: { enzymes, keepAnnotations: true } });
function withWorkflow(storage: LiveStorage, step: WorkflowStep): LiveStorage {
  storage.setItem(WORKFLOWS_KEY, JSON.stringify([{ id: 'wf-mine', name: 'Digest mine', description: '', keepIntermediate: true, steps: [step] }]));
  return storage;
}
const storedValue = (storage: LiveStorage) => {
  const saved = JSON.parse(storage.getItem(WORKFLOWS_KEY) ?? '[]') as Workflow[];
  const s = saved.find((w) => w.name === 'Digest mine')?.steps[0].settings;
  return s?.kind === 'custom' ? s.values.enzymes : undefined;
};

/** The custom "EcoRI" on TWO_ECO: one cut, after base 69 (its motif at 67, top cut 3 in), two fragments. */
const MINE_FRAGMENTS = [
  {
    "name": "pMine EcoRI (custom)–3' Terminus (72 bp)",
    "sequence": "TGGTGAAACAAACCAACCAACCCCAACCAACACCCAGAATTCACAACAAACAAAAAAACCCAAACACAAACC",
    "length": 72,
    "topology": "linear",
    "description": "Fragment 1 of 2 from EcoRI (custom) digest of pMine (70–141)",
    "metadata": {
      "Digest enzymes": "EcoRI (custom)",
      "5' end": "EcoRI (custom) (5prime TGGT)",
      "3' end": "3' Terminus (blunt)",
      "Source coordinates": "70–141"
    },
    "history": [
      "Digest into Fragments: EcoRI (custom); fragment 1 of 2 (70–141)"
    ]
  },
  {
    "name": "pMine 5' Terminus–EcoRI (custom) (69 bp)",
    "sequence": "AAAACCACAACAAACCAACAACCAAACAACGAATTCAAAAACCCCAACAACACACACAAAACACACTGG",
    "length": 69,
    "topology": "linear",
    "description": "Fragment 2 of 2 from EcoRI (custom) digest of pMine (1–69)",
    "metadata": {
      "Digest enzymes": "EcoRI (custom)",
      "5' end": "5' Terminus (blunt)",
      "3' end": "EcoRI (custom) (5prime TGGT)",
      "Source coordinates": "1–69"
    },
    "history": [
      "Digest into Fragments: EcoRI (custom); fragment 2 of 2 (1–69)"
    ]
  }
];

/** The joined refusals of the gone custom key (operationRunners) and the unknown catalogue id (the engine). */
const STALE_REFUSAL = 'Step 1 (Digest into Fragments) failed: The digest was not run, so no fragment was made: A custom enzyme no longer stored: it is no longer in the active enzyme list (the enzyme database could not be read, or no longer holds it); BsaI: the built-in catalogue holds no enzyme with the id "BsaI".';

// ─── Reading and driving the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const fragmentOf = (d: SequenceDocument) => ({
  name: d.name,
  sequence: d.sequence,
  length: d.sequence.length,
  topology: d.topology,
  description: d.description,
  metadata: d.docMetadata,
  history: d.history.map((h) => `${h.operation}: ${h.description}`),
});
const created = () => watch.digests.flatMap((d) => d.result?.created ?? []).map(fragmentOf);
const alerts = (app: AppHarness) => app.all('.info-callout[role="alert"]').map((h) => words(h.textContent));
/** Everything the App shows, its modal windows included. */
const bodyText = (app: AppHarness) => words(app.all('div').filter((d) => !d.parentElement?.closest('div')).map((d) => d.textContent).join(' '));
const textInputValues = (app: AppHarness) => app.all('input').filter((i) => i.type === 'text').map((i) => i.value);
const openDocs = (app: AppHarness) => app.all('[aria-label^="Close "]').map((b) => (b.getAttribute('aria-label') ?? '').slice('Close '.length));
const fragmentsInWorkspace = (app: AppHarness, doc: string) => openDocs(app).filter((n) => n.startsWith(`${doc} `) && n.endsWith(' bp)'));

async function withDoc(storage: LiveStorage, doc: SequenceDocument, run: (app: AppHarness) => Promise<void>): Promise<void> {
  watch.digests.length = 0;
  const app = await mountApp({ storage });
  try {
    await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'sequence-view' });
    await app.settle();
    await run(app);
  } finally {
    app.unmount();
  }
}
const button = (app: AppHarness, label: string, cls = 'button') => {
  const b = app.all(cls).find((x) => words(x.textContent) === label);
  if (!b) throw new Error(`no "${label}" button`);
  return b;
};
async function openRun(app: AppHarness): Promise<void> {
  await app.menu('workflows:run');
  await app.settle();
  const select = app.all('select').find((s) => s.querySelectorAll('option').some((o) => words(o.textContent) === 'Digest mine'));
  if (!select) throw new Error('the Run Workflow window offers no "Digest mine"');
  await app.change(select, 'wf-mine');
  await app.settle();
}
async function pressRun(app: AppHarness): Promise<void> {
  await app.click(button(app, 'Run', 'button.btn-primary-sm'));
  await act(async () => { vi.advanceTimersByTime(50); });
  await app.settle();
}
async function openManage(app: AppHarness): Promise<void> {
  await app.menu('workflows:manage');
  await app.settle();
  const item = app.all('button[role="option"]').find((b) => words(b.textContent) === 'Digest mine');
  if (!item) throw new Error('the Manage Workflows window lists no "Digest mine"');
  await app.click(item);
  await app.settle();
}
const pickers = (app: AppHarness) => app.all('select[aria-label="enzymes"]');
const picker = (app: AppHarness) => {
  const all = pickers(app);
  if (all.length !== 1) throw new Error(`expected one enzymes picker, found ${all.length}`);
  return all[0];
};
const labels = (select: LiveElement) => select.options.map((o) => words(o.textContent));
const chosen = (select: LiveElement) => select.options.filter((o) => o.selected).map((o) => words(o.textContent));
/** Toggles the options labelled `labels` in one change, as a ctrl/cmd-click (one) or a shift-click (a range) does. */
async function toggle(app: AppHarness, labels: string | string[], on: boolean): Promise<void> {
  const select = picker(app);
  const options = [labels].flat().map((label) => {
    const option = select.options.find((o) => words(o.textContent) === label);
    if (!option) throw new Error(`the picker offers no "${label}"`);
    return option;
  });
  await act(async () => {
    for (const option of options) option.selected = on;
    dispatchLiveEvent(select, 'change');
  });
  await app.settle();
}
/** The summary beside each step in the Manage window, and each step's summary in the Run window. */
const manageSummaries = (app: AppHarness) => app.all('.mbc-wf-step-head .mbc-opdlg-muted').map((s) => words(s.textContent));
const runSummaries = (app: AppHarness) => app.all('.mbc-wf-steps-compact li .mbc-opdlg-muted').map((s) => words(s.textContent));

// ─── The criteria ───

describe('US-01M7J1WY AC1: the Run window\'s ask step chooses enzymes from the active list, custom ones marked', () => {
  it('US-01M7J1WY AC1 the picker lists the catalogue then "EcoRI (custom)", and choosing the custom one alone digests with its definition', async () => {
    await withDoc(withWorkflow(seeded(), asked()), docOf('pMine', TWO_ECO), async (app) => {
      await openRun(app);
      const select = picker(app);
      expect(select.hasAttribute('multiple')).toBe(true);
      expect(labels(select)).toEqual([...REBASE_ENZYMES.map((e) => e.name), 'EcoRI (custom)']);
      expect(select.options.find((o) => words(o.textContent) === 'EcoRI (custom)')?.value).toBe('custom:seed-1');
      expect(chosen(select)).toEqual([]);
      await toggle(app, 'EcoRI (custom)', true);
      expect(chosen(picker(app))).toEqual(['EcoRI (custom)']);
      expect(bodyText(app)).not.toContain('custom:');
      expect(textInputValues(app).filter((v) => v.includes('custom:'))).toEqual([]);
      await pressRun(app);
      expect(alerts(app)).toEqual([]);
      expect(created()).toEqual(MINE_FRAGMENTS);
      expect(fragmentsInWorkspace(app, 'pMine').sort()).toEqual(MINE_FRAGMENTS.map((f) => f.name).sort());
    });
  });

  it('US-01M7J1WY AC1 a last-used custom key opens selected under its label, never its id', async () => {
    await withDoc(withWorkflow(lastUsed(seeded(), 'custom:seed-1'), asked()), docOf('pMine', TWO_ECO), async (app) => {
      await openRun(app);
      expect(chosen(picker(app))).toEqual(['EcoRI (custom)']);
      expect(bodyText(app)).not.toContain('custom:');
      expect(textInputValues(app).filter((v) => v.includes('custom:'))).toEqual([]);
    });
  });
});

describe('US-01M7J1WY AC2: a saved key the list lacks stays selected, is named, and is still refused', () => {
  it('US-01M7J1WY AC2 the Run picker opens with the deleted custom key, BsaI and EcoRI selected and labelled', async () => {
    await withDoc(withWorkflow(lastUsed(seeded(), 'custom:gone,BsaI,EcoRI'), asked()), docOf('pStale', TWO_ECO), async (app) => {
      await openRun(app);
      expect(chosen(picker(app))).toEqual(['A custom enzyme no longer stored', 'BsaI (not in the catalogue)', 'EcoRI']);
      expect(bodyText(app)).not.toContain('custom:');
    });
  });

  it('US-01M7J1WY AC2 running the stale value unchanged is refused by name and makes no document', async () => {
    await withDoc(withWorkflow(lastUsed(seeded(), 'custom:gone,BsaI,EcoRI'), asked()), docOf('pStale', TWO_ECO), async (app) => {
      await openRun(app);
      await pressRun(app);
      expect(alerts(app)).toEqual([STALE_REFUSAL]);
      expect(watch.digests.map((d) => d.result)).toEqual([undefined]);
      expect(fragmentsInWorkspace(app, 'pStale')).toEqual([]);
    });
  });

  it('US-01M7J1WY AC2 Manage keeps the stale keys, adds BamHI after them, and deselecting the deleted one removes only it', async () => {
    const storage = withWorkflow(seeded(), setHere('custom:gone,BsaI,EcoRI'));
    await withDoc(storage, docOf('pStale', TWO_ECO), async (app) => {
      await openManage(app);
      expect(chosen(picker(app))).toEqual(['A custom enzyme no longer stored', 'BsaI (not in the catalogue)', 'EcoRI']);
      await toggle(app, 'BamHI', true);
      await app.click(button(app, 'Save', 'button.btn-secondary-sm'));
      await app.settle();
      expect(storedValue(storage)).toBe('custom:gone,BsaI,EcoRI,BamHI');
      await toggle(app, 'A custom enzyme no longer stored', false);
      await app.click(button(app, 'Save', 'button.btn-secondary-sm'));
      await app.settle();
      expect(storedValue(storage)).toBe('BsaI,EcoRI,BamHI');
    });
  });

  it('US-01M7J1WY AC2 a change keeps the stored keys in their stored order, then adds new ones in list order', async () => {
    // Four catalogue enzymes sorted into the list's own order: two stored against it, two added in one change.
    const at = (name: string) => REBASE_ENZYMES.findIndex((e) => e.name === name);
    const [a, b, c, d] = ['EcoRI', 'BamHI', 'HindIII', 'PstI'].sort((x, y) => at(x) - at(y));
    expect([a, b, c, d].map(at).every((i) => i >= 0)).toBe(true);
    const storage = withWorkflow(seeded(), setHere(`${b},${a}`));
    await withDoc(storage, docOf('pOrder', TWO_ECO), async (app) => {
      await openManage(app);
      await toggle(app, [d, c], true);
      await app.click(button(app, 'Save', 'button.btn-secondary-sm'));
      await app.settle();
      expect(storedValue(storage)).toBe(`${b},${a},${c},${d}`);
    });
  });
});

describe('US-01M7J1WY AC3: Manage uses the same picker, and summaries and the run log label custom keys', () => {
  it('US-01M7J1WY AC3 an Options set here step with a custom key reads enzymes=EcoRI (custom) in Manage and Run, never the id', async () => {
    await withDoc(withWorkflow(seeded(), setHere('custom:seed-1')), docOf('pMine', TWO_ECO), async (app) => {
      await openManage(app);
      expect(picker(app).hasAttribute('multiple')).toBe(true);
      expect(chosen(picker(app))).toEqual(['EcoRI (custom)']);
      expect(manageSummaries(app)).toEqual(['enzymes=EcoRI (custom)']);
      expect(bodyText(app)).not.toContain('custom:');
      expect(textInputValues(app).filter((v) => v.includes('custom:'))).toEqual([]);
      await app.click(button(app, 'Run…', 'button.btn-secondary-sm'));
      await app.settle();
      expect(runSummaries(app)).toEqual(['(enzymes=EcoRI (custom))']);
      expect(bodyText(app)).not.toContain('custom:');
    });
  });

  it('US-01M7J1WY AC3 a step with no custom key keeps its stored text in both summaries', async () => {
    for (const value of ['EcoRI, BamHI', 'EcoRI, BsaI']) {
      await withDoc(withWorkflow(seeded(), setHere(value)), docOf('pCat', TWO_ECO), async (app) => {
        await openManage(app);
        expect(manageSummaries(app)).toEqual([`enzymes=${value}`]);
        await app.click(button(app, 'Run…', 'button.btn-secondary-sm'));
        await app.settle();
        expect(runSummaries(app)).toEqual([`(enzymes=${value})`]);
      });
    }
  });

  it('US-01M7J1WY AC3 describeSettings labels only with a list, and the run log holds the same label', async () => {
    const storage = seeded();
    const read = openEnzymeDatabase({ storage }).read();
    if (!read.ok) throw new Error('the seeded store is unreadable');
    const list = activeEnzymeList(read.definitions);
    expect(describeSettings(setHere('custom:seed-1'), list)).toBe('enzymes=EcoRI (custom)');
    expect(describeSettings(setHere('custom:seed-1'))).toBe('enzymes=custom:seed-1');
    expect(describeSettings(setHere('EcoRI, BamHI'), list)).toBe('enzymes=EcoRI, BamHI');
    expect(describeSettings(setHere('EcoRI, BsaI'), list)).toBe('enzymes=EcoRI, BsaI');
    expect(describeSettings(setHere('custom:seed-1, BsaI'), list)).toBe('enzymes=EcoRI (custom),BsaI');
    const w: Workflow = { id: 'wf', name: 'Digest mine', description: '', keepIntermediate: true, steps: [setHere('custom:seed-1')] };
    const result = await runWorkflow(w, [docOf('pMine', TWO_ECO)], { sourceLabel: 'pMine', enzymes: list });
    expect(result.log[0].settings).toBe('enzymes=EcoRI (custom)');
    expect(result.created.map(fragmentOf)).toEqual(MINE_FRAGMENTS);
  });
});
