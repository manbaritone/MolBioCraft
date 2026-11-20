// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7HRCD: the Digest dialog, and a saved workflow's digest step, digest with a custom enzyme
 * by its id through the engine's digest by id, mark its ends "(custom)", and refuse by name a
 * digest the engine cannot complete, creating no document.
 *
 * Driven through the rendered App (its local storage holding the enzyme store, the dialog's
 * last-used values and the saved workflows) and the committed WASM engine, whose entry point is
 * watched, not replaced. The documents a digest makes are read twice: as `runDigest` returns them
 * (watched, not replaced) and as rows of the App's document table. Every expected fragment, row,
 * count sentence and refusal is a literal here, never computed by either digest op.
 */

import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { builtInNameClash, openEnzymeDatabase, type CustomEnzymeInput } from '../core/enzymeDatabase';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import type { OperationResult } from '../core/operationRunners';
import { mountApp, type AppHarness } from './appHarness';
import { memoryStorage, type LiveElement, type LiveStorage } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** The engine's restriction calls (scan and digest), with the list or selection each was sent; and each `runDigest` outcome. */
const watch = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; seqLen: number; custom: RestrictionEnzyme[] | null; selection?: unknown; names?: unknown }>,
  digests: [] as Array<{ result?: OperationResult; error?: string }>,
}));
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rustBioEngine')>();
  const watched = new Set(['scan_restriction_sites', 'simulate_enzyme_digest', 'simulate_restriction_digest']);
  return {
    ...actual,
    invokeRustBioSync: (op: string, payload?: unknown) => {
      if (watched.has(op)) {
        const p = (payload ?? {}) as { seq?: string; doc?: SequenceDocument; customEnzymes?: RestrictionEnzyme[] | null; selection?: unknown; selectedEnzymeNames?: unknown };
        watch.calls.push({ op, seqLen: String(p.seq ?? p.doc?.sequence ?? '').length, custom: p.customEnzymes ?? null, selection: p.selection, names: p.selectedEnzymeNames });
      }
      return actual.invokeRustBioSync(op, payload);
    },
  };
});
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

let ui: {
  renderToStaticMarkup: typeof import('react-dom/server').renderToStaticMarkup;
  DigestOperationDialog: typeof import('../components/SequenceOperationDialogs').DigestOperationDialog;
  runDigest: typeof import('../core/operationRunners').runDigest;
};
beforeAll(async () => {
  const app = await mountApp();
  app.unmount();
  ui = {
    renderToStaticMarkup: (await import('react-dom/server')).renderToStaticMarkup,
    DigestOperationDialog: (await import('../components/SequenceOperationDialogs')).DigestOperationDialog,
    runDigest: (await import('../core/operationRunners')).runDigest,
  };
});

// ─── The fixtures ───

/** A/C filler: it holds no T or G, so no motif planted below occurs in it. */
const filler = (n: number, seed: number) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => 'AC'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 31]).join('');
};

const ENZ_KEY = 'molbiocraft.enzymeDatabase';
const OPTIONS_KEY = 'molbiocraft.optionProfiles.v1';
const WORKFLOWS_KEY = 'molbiocraft.workflows.v1';
/** Adaeze's own "EcoRI": another motif and other offsets, under the built-in's name. */
const MINE: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'TGGTGGTGA', cutFwd: 3, cutRev: 7 };
/** A twin of the built-in EcoRI: its motif and top cut, but a blunt bottom cut (D0151). */
const TWIN: CustomEnzymeInput = { name: 'EcoRI', recognitionSeq: 'GAATTC', cutFwd: 1, cutRev: 1 };
/** A custom enzyme that cuts none of the fixtures. */
const NONE: CustomEnzymeInput = { name: 'NoneI', recognitionSeq: 'GATTACAGATTAC', cutFwd: 6, cutRev: 6 };
const ADA: CustomEnzymeInput = { name: 'AdaI', recognitionSeq: 'TGTTGTTGTA', cutFwd: 4, cutRev: 6 };

/** EcoRI's GAATTC twice, the custom "EcoRI"'s motif once between them: 141 bp, linear. */
const TWO_ECO = [filler(30, 11), 'GAATTC', filler(30, 12), MINE.recognitionSeq, filler(30, 13), 'GAATTC', filler(30, 14)].join('');
/** EcoRI's GAATTC and BamHI's GGATCC once each: 102 bp, linear. */
const ECO_BAM = [filler(30, 21), 'GAATTC', filler(30, 22), 'GGATCC', filler(30, 23)].join('');
/** SacI's GAGCTC and XbaI's TCTAGA sharing a top-strand cut: 70 bp, linear. */
const SAC_XBA = [filler(30, 31), 'GAGCTCTAGA', filler(30, 32)].join('');

const docOf = (id: string, sequence: string, topology: 'circular' | 'linear' = 'linear'): SequenceDocument => ({
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id, name: id, sequence, topology, features: [], primers: [],
});

function seeded(inputs: CustomEnzymeInput[], storage: LiveStorage = memoryStorage()): LiveStorage {
  let n = 0;
  const db = openEnzymeDatabase({ storage, now: () => '2026-01-01T00:00:00.000Z', newId: () => `custom:seed-${++n}` });
  for (const input of inputs) {
    const r = db.add(input, { confirmedClash: builtInNameClash(input.name) });
    if (!r.ok) throw new Error(r.error.message);
  }
  return storage;
}
/** `storage` with the Digest dialog's last-used enzymes set, as an earlier session leaves them. */
function lastUsed(storage: LiveStorage, enzymes: string): LiveStorage {
  storage.setItem(OPTIONS_KEY, JSON.stringify({ lastUsed: { 'digest-fragments': { enzymes, keepAnnotations: true } }, profiles: [] }));
  return storage;
}
/** A store the App cannot read at start-up: its active list is then the catalogue (D0147: the store has no delete). */
const unreadableStore = () => memoryStorage({ [ENZ_KEY]: '{"schema": 1, "definitions": [' });

// ─── Reading the App ───

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function withDoc(storage: LiveStorage, doc: SequenceDocument, run: (app: AppHarness) => Promise<void>): Promise<void> {
  watch.calls.length = 0;
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

const GROUP = '[role="group"][aria-label="Enzymes to digest with"]';
async function openDigest(app: AppHarness): Promise<LiveElement> {
  await app.menu('enzymes:digest-dialog');
  await app.settle();
  return app.one(GROUP, 'the Digest dialog\'s enzymes');
}
const dialogOf = (app: AppHarness) => {
  const root = app.one(GROUP, 'the Digest dialog\'s enzymes').closest('.modal-size-operation');
  if (!root) throw new Error('the Digest dialog has no window around it');
  return root;
};
/** Everything the App shows, its modal windows included. */
const bodyText = (app: AppHarness) => words(app.all('div').filter((d) => !d.parentElement?.closest('div')).map((d) => d.textContent).join(' '));
const rows = (app: AppHarness) => app.all(`${GROUP} label.mbc-check-row`).map((r) => r.querySelectorAll('span').map((x) => words(x.textContent)).join(' '));
const countLine = (app: AppHarness) => app.all('.mbc-opdlg-hint').map((h) => words(h.textContent)).filter((t) => t.includes('enzymes cut this sequence'));
const selectedLine = (app: AppHarness) => app.all('.mbc-opdlg-muted').map((h) => words(h.textContent)).filter((t) => t.startsWith('Selected:'));
const problems = (app: AppHarness) => app.all('.info-callout[role="status"]').map((h) => words(h.textContent));
const alerts = (app: AppHarness) => app.all('.info-callout[role="alert"]').map((h) => words(h.textContent));
const runButton = (app: AppHarness, label: string) => {
  const b = app.all('button.btn-primary-sm').find((x) => words(x.textContent) === label);
  if (!b) throw new Error(`no "${label}" button`);
  return b;
};
async function tick(app: AppHarness, label: string): Promise<void> {
  const row = app.all(`${GROUP} label.mbc-check-row`).find((r) => words(r.querySelectorAll('span')[0]?.textContent) === label);
  if (!row) throw new Error(`the Digest dialog lists no "${label}" row; it lists ${rows(app).join(' | ')}`);
  await app.click(row.querySelectorAll('input')[0]);
  await app.settle();
}
/** Presses the window's run button and lets its run start: the window waits 30 ms (on the harness's fake timers) to paint first. */
async function press(app: AppHarness, label: string): Promise<void> {
  await app.click(runButton(app, label));
  await act(async () => { vi.advanceTimersByTime(50); });
  await app.settle();
}
const digest = (app: AppHarness) => press(app, 'Digest');
/** The documents open in the workspace, by their tabs' close buttons. */
const openDocs = (app: AppHarness) => app.all('[aria-label^="Close "]').map((b) => (b.getAttribute('aria-label') ?? '').slice('Close '.length));
const fragmentsInWorkspace = (app: AppHarness, doc: string) => openDocs(app).filter((n) => n.startsWith(`${doc} `) && n.endsWith(' bp)'));

/** What a fragment document says of itself: every field the criteria name, ids and times left out. */
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

// ─── The literals ───

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
/** The built-in EcoRI on TWO_ECO, for contrast: three fragments. */
const BUILTIN_ECO_FRAGMENTS = [
  {
    "name": "pMine EcoRI–EcoRI (75 bp)",
    "sequence": "AATTCAAAAACCCCAACAACACACACAAAACACACTGGTGGTGAAACAAACCAACCAACCCCAACCAACACCCAG",
    "length": 75,
    "topology": "linear",
    "description": "Fragment 1 of 3 from EcoRI digest of pMine (32–106)",
    "metadata": {
      "Digest enzymes": "EcoRI",
      "5' end": "EcoRI (5prime AATT)",
      "3' end": "EcoRI (5prime AATT)",
      "Source coordinates": "32–106"
    },
    "history": [
      "Digest into Fragments: EcoRI; fragment 1 of 3 (32–106)"
    ]
  },
  {
    "name": "pMine EcoRI–3' Terminus (35 bp)",
    "sequence": "AATTCACAACAAACAAAAAAACCCAAACACAAACC",
    "length": 35,
    "topology": "linear",
    "description": "Fragment 2 of 3 from EcoRI digest of pMine (107–141)",
    "metadata": {
      "Digest enzymes": "EcoRI",
      "5' end": "EcoRI (5prime AATT)",
      "3' end": "3' Terminus (blunt)",
      "Source coordinates": "107–141"
    },
    "history": [
      "Digest into Fragments: EcoRI; fragment 2 of 3 (107–141)"
    ]
  },
  {
    "name": "pMine 5' Terminus–EcoRI (31 bp)",
    "sequence": "AAAACCACAACAAACCAACAACCAAACAACG",
    "length": 31,
    "topology": "linear",
    "description": "Fragment 3 of 3 from EcoRI digest of pMine (1–31)",
    "metadata": {
      "Digest enzymes": "EcoRI",
      "5' end": "5' Terminus (blunt)",
      "3' end": "EcoRI (5prime AATT)",
      "Source coordinates": "1–31"
    },
    "history": [
      "Digest into Fragments: EcoRI; fragment 3 of 3 (1–31)"
    ]
  }
];

describe('US-01M7HRCD AC1: a custom "EcoRI" is its own row and digests with its own sites and offsets', () => {
  it('US-01M7HRCD AC1 the rendered App lists "EcoRI (custom)" beside "EcoRI", and its digest makes the custom definition\'s fragments', async () => {
    await withDoc(seeded([MINE]), docOf('pMine', TWO_ECO), async (app) => {
      await openDigest(app);
      const eco = rows(app).filter((r) => r.startsWith('EcoRI'));
      expect(eco).toEqual(['EcoRI (custom) TGGTGGTGA · 1 cut', 'EcoRI GAATTC · 2 cuts']);
      await tick(app, 'EcoRI (custom)');
      expect(selectedLine(app)).toEqual(['Selected: EcoRI (custom)']);
      await digest(app);
      expect(alerts(app)).toEqual([]);
      const sent = watch.calls.filter((c) => c.op === 'simulate_enzyme_digest');
      expect(sent, 'one digest by id').toHaveLength(1);
      expect((sent[0].selection as RestrictionEnzyme[]).map((e) => [e.id, e.name, e.recognitionSeq])).toEqual([['custom:seed-1', 'EcoRI', 'TGGTGGTGA']]);
      expect(watch.calls.filter((c) => c.op === 'simulate_restriction_digest'), 'never the digest by name').toEqual([]);
      expect(created()).toEqual(MINE_FRAGMENTS);
      expect(created()).not.toEqual(BUILTIN_ECO_FRAGMENTS);
      expect(fragmentsInWorkspace(app, 'pMine')).toHaveLength(2);
      expect(fragmentsInWorkspace(app, 'pMine').sort()).toEqual((MINE_FRAGMENTS as Array<{ name: string }>).map((f) => f.name).sort());
    });
  });
});

/** The rows the dialog lists for ECO_BAM with nothing stored, as before. */
const CATALOGUE_ROWS = [
  "DpnII GATC · 0 cuts, 1 blocked",
  "MboI GATC · 0 cuts, 1 blocked",
  "BamHI GGATCC · 1 cut",
  "BstYI RGATCY · 1 cut",
  "DpnI GATC · 1 cut",
  "EcoRI GAATTC · 1 cut",
  "MluCI AATT · 1 cut",
  "Sau3AI GATC · 1 cut"
];
const CATALOGUE_COUNT_LINE = "8 enzymes cut this sequence; sorted by number of cuts. Methylation-blocked sites are not cut.";
const ECO_BAM_FRAGMENTS = [
  {
    "name": "pCat EcoRI–BamHI (36 bp)",
    "sequence": "AATTCAACAAACCCCCCACACACCACCACCCAAACG",
    "length": 36,
    "topology": "linear",
    "description": "Fragment 1 of 3 from EcoRI + BamHI digest of pCat (32–67)",
    "metadata": {
      "Digest enzymes": "EcoRI, BamHI",
      "5' end": "EcoRI (5prime AATT)",
      "3' end": "BamHI (5prime GATC)",
      "Source coordinates": "32–67"
    },
    "history": [
      "Digest into Fragments: EcoRI + BamHI; fragment 1 of 3 (32–67)"
    ]
  },
  {
    "name": "pCat BamHI–3' Terminus (35 bp)",
    "sequence": "GATCCAACCCCACACAAACAAACAAAACCCACAAA",
    "length": 35,
    "topology": "linear",
    "description": "Fragment 2 of 3 from EcoRI + BamHI digest of pCat (68–102)",
    "metadata": {
      "Digest enzymes": "EcoRI, BamHI",
      "5' end": "BamHI (5prime GATC)",
      "3' end": "3' Terminus (blunt)",
      "Source coordinates": "68–102"
    },
    "history": [
      "Digest into Fragments: EcoRI + BamHI; fragment 2 of 3 (68–102)"
    ]
  },
  {
    "name": "pCat 5' Terminus–EcoRI (31 bp)",
    "sequence": "AAAAAAACACAAACCACCCAAAACACCCAAG",
    "length": 31,
    "topology": "linear",
    "description": "Fragment 3 of 3 from EcoRI + BamHI digest of pCat (1–31)",
    "metadata": {
      "Digest enzymes": "EcoRI, BamHI",
      "5' end": "5' Terminus (blunt)",
      "3' end": "EcoRI (5prime AATT)",
      "Source coordinates": "1–31"
    },
    "history": [
      "Digest into Fragments: EcoRI + BamHI; fragment 3 of 3 (1–31)"
    ]
  }
];

describe('US-01M7HRCD AC2: with nothing stored, the dialog and its documents are as before', () => {
  it('US-01M7HRCD AC2 the rows, the count sentence and every fragment document of a catalogue digest are the literal values', async () => {
    await withDoc(memoryStorage(), docOf('pCat', ECO_BAM), async (app) => {
      await openDigest(app);
      expect(rows(app)).toEqual(CATALOGUE_ROWS);
      expect(countLine(app)).toEqual([CATALOGUE_COUNT_LINE]);
      await tick(app, 'EcoRI');
      await tick(app, 'BamHI');
      expect(selectedLine(app)).toEqual(['Selected: EcoRI, BamHI']);
      await digest(app);
      expect(alerts(app)).toEqual([]);
      expect(created()).toEqual(ECO_BAM_FRAGMENTS);
      expect(JSON.stringify(created())).not.toContain('(custom)');
      expect(bodyText(app)).not.toContain('(custom)');
      expect(fragmentsInWorkspace(app, 'pCat')).toHaveLength(3);
    });
  });

  it('US-01M7HRCD AC2 the dialog rendered without an enzymes prop sends the catalogue as null to the scan', () => {
    watch.calls.length = 0;
    const html = ui.renderToStaticMarkup(<ui.DigestOperationDialog doc={docOf('pCat', ECO_BAM)} onCreate={() => {}} onClose={() => {}} />);
    const scans = watch.calls.filter((c) => c.op === 'scan_restriction_sites');
    expect(scans).toHaveLength(1);
    expect(scans[0].custom).toBeNull();
    expect(html).not.toContain('(custom)');
  });
});

/** The refusal of a custom key the active list no longer holds: the dialog never knew its label. */
const GONE_REFUSAL =
  'The digest was not run, so no fragment was made: A custom enzyme no longer stored: it is no longer in the active enzyme list (the enzyme database could not be read, or no longer holds it).';
/** The refusal of the twin beside the built-in EcoRI at both GAATTC sites (D0151): both labels, both ends. */
const CLASH_REFUSAL =
  'The digest was not run, so no fragment was made: ' +
  'EcoRI and EcoRI (custom): EcoRI and EcoRI (custom) both cut the top strand before base 32 but leave different ends (a 5\' overhang AATT and a blunt end), so the digest cannot say which end that fragment has; ' +
  'EcoRI and EcoRI (custom): EcoRI and EcoRI (custom) both cut the top strand before base 107 but leave different ends (a 5\' overhang AATT and a blunt end), so the digest cannot say which end that fragment has.';
/** SacI + XbaI on GAGCTCTAGA, both built-ins, as the digest by name made them before (D0151). */
const SAC_XBA_FRAGMENTS = [
  {
    "name": "pSX 5' Terminus–SacI (35 bp)",
    "sequence": "AAACACCAAACCCAACACCACCAACCCACAGAGCT",
    "length": 35,
    "topology": "linear",
    "description": "Fragment 1 of 2 from SacI + XbaI digest of pSX (1–35)",
    "metadata": {
      "Digest enzymes": "SacI, XbaI",
      "5' end": "5' Terminus (blunt)",
      "3' end": "SacI (3prime AGCT)",
      "Source coordinates": "1–35"
    },
    "history": [
      "Digest into Fragments: SacI + XbaI; fragment 1 of 2 (1–35)"
    ]
  },
  {
    "name": "pSX SacI–3' Terminus (35 bp)",
    "sequence": "CTAGAAACCCCACCAACCAAACCCACCCCCAAAAC",
    "length": 35,
    "topology": "linear",
    "description": "Fragment 2 of 2 from SacI + XbaI digest of pSX (36–70)",
    "metadata": {
      "Digest enzymes": "SacI, XbaI",
      "5' end": "SacI (3prime AGCT)",
      "3' end": "3' Terminus (blunt)",
      "Source coordinates": "36–70"
    },
    "history": [
      "Digest into Fragments: SacI + XbaI; fragment 2 of 2 (36–70)"
    ]
  }
];

describe('US-01M7HRCD AC3: a digest the engine cannot complete is refused by name and creates nothing', () => {
  it('US-01M7HRCD AC3 a custom enzyme chosen in an earlier session and no longer stored is kept, named, and refused', async () => {
    await withDoc(lastUsed(unreadableStore(), 'custom:seed-1'), docOf('pGone', TWO_ECO), async (app) => {
      await openDigest(app);
      expect(selectedLine(app)).toEqual(['Selected: A custom enzyme no longer stored']);
      expect(problems(app)).toEqual([]);
      expect(runButton(app, 'Digest').disabled).toBe(false);
      expect(words(dialogOf(app).textContent)).not.toContain('custom:');
      await digest(app);
      expect(alerts(app)).toEqual([GONE_REFUSAL]);
      expect(words(dialogOf(app).textContent)).not.toContain('custom:');
      expect(watch.digests.map((d) => d.result)).toEqual([undefined]);
      expect(fragmentsInWorkspace(app, 'pGone')).toEqual([]);
      expect(bodyText(app)).not.toContain('Digest created');
    });
  });

  for (const [why, chosen, storage] of [
    ['an empty selection', '', () => memoryStorage()],
    ['a built-in that cuts this document zero times', 'NotI', () => memoryStorage()],
    ['a catalogue name the catalogue does not hold', 'NotAnEnzyme', () => memoryStorage()],
    ['a stored custom enzyme that cuts this document zero times', 'custom:seed-1', () => seeded([NONE])],
  ] as const) {
    it(`US-01M7HRCD AC3 ${why} keeps "Choose at least one enzyme that cuts this sequence." with Digest disabled`, async () => {
      await withDoc(lastUsed(storage(), chosen), docOf('pNone', TWO_ECO), async (app) => {
        await openDigest(app);
        expect(problems(app)).toEqual(['Choose at least one enzyme that cuts this sequence.']);
        expect(runButton(app, 'Digest').disabled).toBe(true);
        expect(words(dialogOf(app).textContent)).not.toContain('custom:');
      });
    });
  }

  it('US-01M7HRCD AC3 a custom twin with another bottom cut at the built-in\'s top cut is refused naming both labels', async () => {
    await withDoc(seeded([TWIN]), docOf('pTwin', TWO_ECO), async (app) => {
      await openDigest(app);
      expect(rows(app).filter((r) => r.startsWith('EcoRI'))).toEqual(['EcoRI GAATTC · 2 cuts', 'EcoRI (custom) GAATTC · 2 cuts']);
      await tick(app, 'EcoRI');
      await tick(app, 'EcoRI (custom)');
      expect(selectedLine(app)).toEqual(['Selected: EcoRI, EcoRI (custom)']);
      await digest(app);
      expect(alerts(app)).toEqual([CLASH_REFUSAL]);
      expect(watch.digests.map((d) => d.result)).toEqual([undefined]);
      expect(fragmentsInWorkspace(app, 'pTwin')).toEqual([]);
    });
  });

  it('US-01M7HRCD AC3 SacI + XbaI sharing a top-strand cut on GAGCTCTAGA is not refused and makes the literal documents', async () => {
    await withDoc(seeded([MINE]), docOf('pSX', SAC_XBA), async (app) => {
      await openDigest(app);
      await tick(app, 'SacI');
      await tick(app, 'XbaI');
      await digest(app);
      expect(alerts(app)).toEqual([]);
      expect(created()).toEqual(SAC_XBA_FRAGMENTS);
      expect(fragmentsInWorkspace(app, 'pSX')).toHaveLength(SAC_XBA_FRAGMENTS.length);
    });
  });
});

const BIG = [filler(100_050, 41), 'GAATTC', filler(60, 42), ADA.recognitionSeq, filler(60, 43), 'GGATCC', filler(60, 44)].join('');
/** The core built-ins that cut BIG, and AdaI (custom) among them. */
const BIG_ROWS = [
  "AdaI (custom) TGTTGTTGTA · 1 cut",
  "BamHI GGATCC · 1 cut",
  "DpnI GATC · 1 cut",
  "EcoRI GAATTC · 1 cut"
];
const BIG_COUNT_LINE = '4 enzymes cut this sequence among 28 core enzymes plus 1 custom; sorted by number of cuts. Only 28 core enzymes and your 1 custom enzyme were scanned: other built-in enzymes may also cut this sequence. Methylation-blocked sites are not cut.';

describe('US-01M7HRCD AC4: over 100,000 bp the dialog scans the core built-ins plus every custom definition and says so', () => {
  it('US-01M7HRCD AC4 with one stored definition the count line names "core enzymes plus 1 custom" and the scan sends the core plus it', async () => {
    await withDoc(seeded([ADA]), docOf('pBig', BIG, 'circular'), async (app) => {
      watch.calls.length = 0;
      await openDigest(app);
      expect(rows(app)).toEqual(BIG_ROWS);
      expect(countLine(app)).toEqual([BIG_COUNT_LINE]);
      const scans = watch.calls.filter((c) => c.op === 'scan_restriction_sites' && c.seqLen === BIG.length);
      expect(scans.length).toBeGreaterThan(0);
      const core = REBASE_ENZYMES.slice(0, 28).map((e) => e.id ?? e.name);
      for (const s of scans) expect((s.custom ?? []).map((e) => e.id ?? e.name)).toEqual([...core, 'custom:seed-1']);
    });
  });

  it('US-01M7HRCD AC4 with nothing stored the dialog sends no list, so the engine scans its core alone, and names the core only', () => {
    watch.calls.length = 0;
    const html = ui.renderToStaticMarkup(<ui.DigestOperationDialog doc={docOf('pBig', BIG, 'circular')} onCreate={() => {}} onClose={() => {}} />);
    const scans = watch.calls.filter((c) => c.op === 'scan_restriction_sites');
    expect(scans.map((s) => s.custom)).toEqual([null]);
    expect(html).toContain(' enzymes cut this sequence among 28 core enzymes; sorted by number of cuts. Only 28 core enzymes were scanned: other enzymes may also cut this sequence. Methylation-blocked sites are not cut.');
    expect(html).not.toContain('custom');
  });
});

/** A step naming an enzyme the catalogue does not hold, refused by the engine's own words for an unknown id. */
const UNKNOWN_REFUSAL = 'The digest was not run, so no fragment was made: NotAnEnzyme: the built-in catalogue holds no enzyme with the id "NotAnEnzyme".';

describe('US-01M7HRCD AC5: a saved workflow\'s digest step digests with a custom enzyme by its id, or is refused by name', () => {
  const workflows = (enzymes: string) => JSON.stringify([{
    id: 'wf-mine', name: 'Digest mine', description: '', keepIntermediate: true,
    steps: [{ op: 'digest-fragments', settings: { kind: 'custom', values: { enzymes, keepAnnotations: true } } }],
  }]);
  async function runWorkflow(app: AppHarness): Promise<void> {
    await app.menu('workflows:run');
    await app.settle();
    const select = app.all('select').find((s) => s.querySelectorAll('option').some((o) => words(o.textContent) === 'Digest mine'));
    if (!select) throw new Error('the Run Workflow window offers no "Digest mine"');
    await app.change(select, 'wf-mine');
    await app.settle();
    await press(app, 'Run');
  }
  const withWorkflow = (storage: LiveStorage, enzymes: string) => { storage.setItem(WORKFLOWS_KEY, workflows(enzymes)); return storage; };

  it('US-01M7HRCD AC5 a step naming a stored custom enzyme by id makes the custom definition\'s fragments', async () => {
    await withDoc(withWorkflow(seeded([MINE]), 'custom:seed-1'), docOf('pMine', TWO_ECO), async (app) => {
      await runWorkflow(app);
      expect(alerts(app)).toEqual([]);
      expect(created()).toEqual(MINE_FRAGMENTS);
      expect(fragmentsInWorkspace(app, 'pMine')).toHaveLength(2);
    });
  });

  it('US-01M7HRCD AC5 a step naming a custom enzyme no longer stored fails at that step by name and creates nothing', async () => {
    await withDoc(withWorkflow(unreadableStore(), 'custom:seed-1'), docOf('pGone', TWO_ECO), async (app) => {
      await runWorkflow(app);
      expect(alerts(app)).toEqual([`Step 1 (Digest into Fragments) failed: ${GONE_REFUSAL}`]);
      expect(watch.digests.map((d) => d.result)).toEqual([undefined]);
      expect(fragmentsInWorkspace(app, 'pGone')).toEqual([]);
    });
  });

  it('US-01M7HRCD AC5 a step naming an enzyme the catalogue does not hold is refused at that step by name', async () => {
    await withDoc(withWorkflow(memoryStorage(), 'NotAnEnzyme'), docOf('pUnknown', TWO_ECO), async (app) => {
      await runWorkflow(app);
      expect(alerts(app)).toEqual([`Step 1 (Digest into Fragments) failed: ${UNKNOWN_REFUSAL}`]);
      expect(fragmentsInWorkspace(app, 'pUnknown')).toEqual([]);
    });
  });

  it('US-01M7HRCD AC5 a step naming catalogue enzymes makes the literal documents it made before', async () => {
    await withDoc(withWorkflow(memoryStorage(), 'EcoRI,BamHI'), docOf('pCat', ECO_BAM), async (app) => {
      await runWorkflow(app);
      expect(alerts(app)).toEqual([]);
      expect(created()).toEqual(ECO_BAM_FRAGMENTS);
    });
  });

  it('US-01M7HRCD AC5 a resolvable digest keeps the 200-fragment error word for word', () => {
    const many = Array.from({ length: 201 }, (_, i) => `${filler(6, 50 + i)}AGCT`).join('');
    expect(() => ui.runDigest(docOf('pMany', many), { enzymes: 'AluI', keepAnnotations: true })).toThrow(
      'The digest would create 202 fragments; choose enzymes that cut less often (limit 200).',
    );
  });
});


// ─── BG-01M7J3DP: a chosen key with no row is removable in the dialog ───

/** The dialog's entries for chosen keys that have no row in the checklist, by their labels. */
const NOT_LISTED = '[role="group"][aria-label="Chosen enzymes not listed above"]';
const notListed = (app: AppHarness) => app.all(`${NOT_LISTED} label.mbc-check-row`).map((r) => words(r.querySelectorAll('span')[0]?.textContent));
async function untickNotListed(app: AppHarness, label: string): Promise<void> {
  const row = app.all(`${NOT_LISTED} label.mbc-check-row`).find((r) => words(r.querySelectorAll('span')[0]?.textContent) === label);
  if (!row) throw new Error(`the Digest dialog offers no "${label}" entry to untick; it offers ${notListed(app).join(' | ') || 'none'}`);
  const box = row.querySelectorAll('input')[0];
  expect(box.checked).toBe(true);
  await app.click(box);
  await app.settle();
}
const lastUsedEnzymes = (storage: LiveStorage) => JSON.parse(storage.getItem(OPTIONS_KEY) ?? '{}')?.lastUsed?.['digest-fragments']?.enzymes;

describe('BG-01M7J3DP AC1: a chosen key with no row can be removed in the dialog, which then digests with the rest', () => {
  for (const [why, chosen, storage, labels] of [
    ['a custom enzyme no longer stored', 'custom:seed-1', unreadableStore, ['A custom enzyme no longer stored']],
    ['a name the catalogue does not hold', 'NotAnEnzyme', () => memoryStorage(), ['NotAnEnzyme']],
    ['a built-in that does not cut this document', 'NotI', () => memoryStorage(), ['NotI']],
    ['both at once', 'custom:seed-1,NotAnEnzyme', unreadableStore, ['A custom enzyme no longer stored', 'NotAnEnzyme']],
  ] as const) {
    it(`BG-01M7J3DP AC1 a chosen key with no row can be removed: ${why}, then EcoRI digests and is the last-used choice`, async () => {
      const store = lastUsed(storage(), chosen);
      await withDoc(store, docOf('pMine', TWO_ECO), async (app) => {
        await openDigest(app);
        expect(selectedLine(app)).toEqual([`Selected: ${labels.join(', ')}`]);
        expect(notListed(app)).toEqual([...labels]);
        await tick(app, 'EcoRI');
        expect(selectedLine(app)).toEqual([`Selected: ${[...labels, 'EcoRI'].join(', ')}`]);
        for (const label of labels) await untickNotListed(app, label);
        expect(notListed(app)).toEqual([]);
        expect(selectedLine(app)).toEqual(['Selected: EcoRI']);
        expect(words(dialogOf(app).textContent)).not.toContain('custom:');
        await digest(app);
        expect(alerts(app)).toEqual([]);
        expect(created()).toEqual(BUILTIN_ECO_FRAGMENTS);
        expect(fragmentsInWorkspace(app, 'pMine')).toHaveLength(BUILTIN_ECO_FRAGMENTS.length);
        expect(lastUsedEnzymes(store)).toBe('EcoRI');
      });
    });
  }

  it('BG-01M7J3DP AC1 a chosen key with no row can be removed, and left in place it is still refused by name (AC3 of US-01M7HRCD kept)', async () => {
    await withDoc(lastUsed(unreadableStore(), 'custom:seed-1'), docOf('pKept', TWO_ECO), async (app) => {
      await openDigest(app);
      await tick(app, 'EcoRI');
      await digest(app);
      expect(alerts(app)).toEqual([GONE_REFUSAL]);
      expect(fragmentsInWorkspace(app, 'pKept')).toEqual([]);
    });
  });
});
