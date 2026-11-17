// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVFD: a CRISPR search result can be kept as a named guide set, in a user-local store of
 * its own (`src/core/guideSetDatabase.ts`, D0119's storage ruling), with the nuclease preset, the
 * interval and result cap it ran with, the engine's own report and every row as the engine returned
 * it, keyed to a document id and sequence revision and never written into the document.
 *
 * Every scan here is the real WASM engine's (`scanCrisprGuides`); nothing in a row or a report is
 * written by the test. A second store opened over the same storage stands for a restart.
 *
 * Wrong implementations these kill (LC-002):
 * - AC1: a copied field list that drifts from `CrisprScanGuide` / `CrisprScanReport` (the
 *   `satisfies` pins fail `tsc --noEmit`); a row or report rebuilt field by field that drops an
 *   optional field (the staggered second cut, its note, the PAM-ambiguity note, the interval and its
 *   context note); an engine version written as a literal (the diagnostics probe below).
 * - AC2: a save that writes onto the document (deep-equal before and after), that copies the
 *   document's bases into the store, or a list that returns every document's sets.
 * - AC3: an unreadable store read as an empty list; an empty result refused or saved without its
 *   report.
 * - AC5: malformed and newer-schema read as the same kind or as no saved searches; a save over
 *   either that overwrites the stored bytes; a refused or silently dropped write reported as saved.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CrisprScanGuide, CrisprScanReport, CrisprScanResult } from '../core/bioEngine';
import { crisprNucleasePresets, scanCrisprGuides } from '../core/bioEngine';
import {
  GUIDE_SET_DATABASE_KEY,
  openGuideSetDatabase,
  type GuideSetRun,
  type GuideSetStorage,
} from '../core/guideSetDatabase';
import { sequenceRevision } from '../core/restrictionDisplay';
import type { SequenceDocument } from '../types/bio';

/** While `version` is set, the engine's diagnostics report it in place of the real one. */
const diag = vi.hoisted(() => ({ version: null as string | null }));
vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return {
    ...real,
    getRustEngineDiagnostics: () => {
      const d = real.getRustEngineDiagnostics();
      return diag.version === null ? d : { ...d, version: diag.version };
    },
  };
});

vi.setConfig({ testTimeout: 120_000 });

// ─── The fields, pinned to the engine's own types ───

/** Every field of a guide row. `tsc --noEmit` refuses this when `CrisprScanGuide` gains a field it lacks. */
const GUIDE_FIELDS = {
  id: true,
  name: true,
  spacerSeq: true,
  pamSeq: true,
  nuclease: true,
  start: true,
  end: true,
  cutPosition: true,
  strand: true,
  gcPercent: true,
  onTargetScore: true,
  specificityScore: true,
  offTargetCount: true,
  pamSide: true,
  pamPattern: true,
  cutConvention: true,
  cutPositionTargetStrand: true,
  cutPositionTargetStrandNote: true,
  pamAmbiguityNote: true,
  searchedInterval: true,
  intervalContextNote: true,
} satisfies Record<keyof CrisprScanGuide, true>;

/** Every field of the scan's report, pinned the same way. */
const REPORT_FIELDS = {
  candidateCount: true,
  scannedLengthBp: true,
  sequenceLengthBp: true,
  scannedCircular: true,
  originSpanBp: true,
  searchedInterval: true,
  intervalRefusal: true,
  contextOutsideIntervalBp: true,
  warnings: true,
  seedLengthBp: true,
} satisfies Record<keyof CrisprScanReport, true>;

// ─── Fixtures ───

/** A 20-nt spacer free of GG and CC: one candidate per planted site. */
const SPACER20 = 'GACGTTACCGATTGCAATCG';
/** Bases with no G and no CC: no SpCas9 PAM on either strand. */
const FILLER = 'ATCATACTAATCTAACATTA'.repeat(10);

const dnaDoc = (id: string, sequence: string, topology: 'linear' | 'circular' = 'linear'): SequenceDocument => ({
  id, name: `${id} name`, accession: '', description: '', sequence, moleculeType: 'DNA', topology,
  folder: 'Local', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
  features: [{ id: 'f1', name: 'ori', type: 'rep_origin', start: 1, end: 10, strand: 1 } as SequenceDocument['features'][number]],
  primers: [],
  history: [],
});

const SPCAS9 = 'SpCas9 (NGG)';
const CAS12A = 'Cas12a / Cpf1 (TTTV)';
const CAP = 25;

interface Fixture {
  label: string;
  doc: SequenceDocument;
  nuclease: string;
  interval: { start: number; end: number } | null;
}

const FIXTURES: Fixture[] = [
  // Cas12a mid-sequence: the staggered second cut has a position.
  { label: 'Cas12a staggered cut', doc: dnaDoc('fvd_cas12a', `ACACATTTA${SPACER20}ACACA`), nuclease: CAS12A, interval: null },
  // Cas12a at the end of a linear record: the second cut has no position, and a note says why.
  { label: 'Cas12a cut past the end', doc: dnaDoc('fvd_cas12a_end', `TTTTTTTTA${SPACER20}`), nuclease: CAS12A, interval: null },
  // An N where the PAM is unconstrained: the row carries the ambiguity note.
  { label: 'PAM ambiguity', doc: dnaDoc('fvd_ambiguous', `ACACA${SPACER20}NGGACACA`), nuclease: SPCAS9, interval: null },
  // The interval holds the spacer and not its PAM: the row carries the interval and its context note.
  { label: 'interval with PAM outside', doc: dnaDoc('fvd_interval', `ACACA${SPACER20}AGGACACA`), nuclease: SPCAS9, interval: { start: 1, end: 25 } },
];

const scan = (f: Fixture): CrisprScanResult & { report: CrisprScanReport } => {
  const r = scanCrisprGuides(f.doc.sequence, f.nuclease, CAP, f.doc.topology === 'circular', f.interval);
  if (!r.report) throw new Error(`the engine sent no report for ${f.label}: ${r.reportUnavailableReason}`);
  return r as CrisprScanResult & { report: CrisprScanReport };
};

const revisionOf = (doc: SequenceDocument) => sequenceRevision(doc.sequence, doc.topology === 'circular' ? 'circular' : 'linear');

const runOf = (f: Fixture, result: CrisprScanResult & { report: CrisprScanReport }, name = `${f.label} search`): GuideSetRun => {
  const preset = crisprNucleasePresets().find((p) => p.id === f.nuclease);
  if (!preset) throw new Error(`the engine offers no ${f.nuclease} preset`);
  const interval = f.interval
    ? { ...f.interval, lengthBp: f.interval.end - f.interval.start + 1, crossesOrigin: false }
    : null;
  return {
    name,
    ranAt: '2026-11-17T09:30:00.000Z',
    criteria: { nuclease: preset, topology: f.doc.topology === 'circular' ? 'circular' : 'linear', interval, resultCap: CAP },
    report: result.report,
    guides: result.guides,
    scoreNames: { onTargetScore: 'Heuristic Rank', specificityScore: 'Specificity', offTargetCount: 'Exact Seed Matches' },
    heuristicRule: 'The rank is a rule of thumb.',
  };
};

const docRef = (doc: SequenceDocument) => ({ id: doc.id, name: doc.name, revision: revisionOf(doc) });

/** Storage kept in memory, with every write counted. */
function memory(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  const writes: string[] = [];
  const storage: GuideSetStorage = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(k);
      m.set(k, String(v));
    },
  };
  return { storage, writes, raw: () => m.get(GUIDE_SET_DATABASE_KEY) ?? null };
}

let serial = 0;
const ids = () => `set-${(serial += 1)}`;
const clock = () => '2026-11-17T10:00:00.000Z';

// ─── The criteria ───

describe('a guide set is kept with its criteria, report, rows and provenance (US-01M7DVFD)', () => {
  it('US-01M7DVFD AC1 every field of the set, its report and its rows comes back identical after a restart, pinned to the engine types', async () => {
    const { getRustEngineDiagnostics } = await import('../lib/rustBioEngine');
    const realVersion = getRustEngineDiagnostics().version;
    expect(realVersion, 'the engine reports a version').toMatch(/\S/);

    const mem = memory();
    const first = openGuideSetDatabase({ storage: mem.storage, now: clock, newId: ids });
    const seenKeys = new Set<string>();
    for (const f of FIXTURES) {
      const result = scan(f);
      expect(result.guides.length, `${f.label}: the fixture yields a guide`).toBeGreaterThan(0);
      for (const g of result.guides) for (const k of Object.keys(g)) seenKeys.add(k);
      const run = runOf(f, result);
      const saved = first.save(run, docRef(f.doc));
      if (!saved.ok) throw new Error(`${f.label}: ${saved.error.message}`);

      // The restart: a second store over the same storage.
      const second = openGuideSetDatabase({ storage: mem.storage });
      const listed = second.listForDocument(f.doc.id);
      expect(listed.kind, f.label).toBe('saved');
      if (listed.kind !== 'saved') continue;
      expect(listed.sets).toHaveLength(1);
      const set = listed.sets[0];
      expect(set, `${f.label}: field-for-field what the save returned`).toEqual(saved.value);
      expect(set.id).toBe(saved.value.id);
      expect(set.id).toMatch(/^set-\d+$/);
      expect([set.name, set.documentId, set.documentName, set.sequenceRevision]).toEqual([
        run.name, f.doc.id, f.doc.name, revisionOf(f.doc),
      ]);
      expect(set.ranAt).toBe(run.ranAt);
      expect(set.savedAt).toBe(clock());
      expect(set.engineVersion, 'the version the engine diagnostics report').toBe(realVersion);
      expect(set.criteria).toEqual(run.criteria);
      expect(set.criteria.nuclease, 'the preset with its PAM side, pattern, spacer, site span and cut convention').toEqual(
        crisprNucleasePresets().find((p) => p.id === f.nuclease)
      );
      expect(set.criteria.resultCap).toBe(CAP);
      expect(set.scoreNames).toEqual(run.scoreNames);
      expect(set.heuristicRule).toBe(run.heuristicRule);

      // The rows and the report as the engine's own reply gives them, scanned again here.
      const again = scan(f);
      expect(set.guides).toEqual(again.guides);
      expect(set.report).toEqual(again.report);
      for (const [i, g] of set.guides.entries()) {
        expect(Object.keys(g).sort(), `${f.label} row ${i}: no field dropped or added`).toEqual(Object.keys(again.guides[i]).sort());
      }
      const reportKeys = Object.keys(again.report).filter((k) => (again.report as unknown as Record<string, unknown>)[k] !== undefined);
      expect(Object.keys(set.report).sort(), `${f.label}: no report field dropped`).toEqual(reportKeys.sort());
      for (const k of Object.keys(set.report)) expect(REPORT_FIELDS, `report field ${k} is a CrisprScanReport field`).toHaveProperty(k);
      for (const name of ['candidateCount', 'scannedLengthBp', 'sequenceLengthBp', 'scannedCircular', 'originSpanBp', 'contextOutsideIntervalBp', 'warnings', 'seedLengthBp']) {
        expect(set.report, `${f.label}: the report keeps ${name}`).toHaveProperty(name);
      }
      if (f.interval) expect(set.report.searchedInterval, `${f.label}: the interval searched`).toEqual(again.report.searchedInterval);

      // Clear the store for the next fixture, through a fresh storage.
      mem.storage.setItem(GUIDE_SET_DATABASE_KEY, JSON.stringify({ schema: 1, sets: [] }));
    }
    // Between them, the fixtures' rows carry every field a guide row can have.
    // (The engine's rows also carry fields the type does not declare; they are stored as sent, and
    // the toEqual above holds them.)
    expect(Object.keys(GUIDE_FIELDS).filter((k) => !seenKeys.has(k)), 'every CrisprScanGuide field is reached').toEqual([]);

    // The version is read from the diagnostics at save time, never written as a literal.
    diag.version = 'engine-probe-7.3.1';
    try {
      const probe = openGuideSetDatabase({ storage: mem.storage });
      const f = FIXTURES[0];
      const saved = probe.save(runOf(f, scan(f), 'probe'), docRef(f.doc));
      expect(saved.ok && saved.value.engineVersion).toBe('engine-probe-7.3.1');
    } finally {
      diag.version = null;
    }
  });

  it('US-01M7DVFD AC2 a save writes no document and lists the set under its document id only', () => {
    const mem = memory();
    const db = openGuideSetDatabase({ storage: mem.storage, newId: ids });
    expect(db.save.length, 'the save takes the run and the document reference, and no document writer').toBe(2);
    const [a, , , d] = FIXTURES;
    // The whole document object, with its revision beside it, is what the tab could hand over.
    const docA = { ...structuredClone(a.doc), revision: revisionOf(a.doc) };
    const before = structuredClone(docA);
    const savedA = db.save(runOf(a, scan(a)), docA);
    expect(savedA.ok).toBe(true);
    expect(docA, 'the document passed in is deep-equal after the save').toEqual(before);
    const docD = { ...structuredClone(d.doc), revision: revisionOf(d.doc) };
    expect(db.save(runOf(d, scan(d)), docD).ok).toBe(true);
    expect(mem.writes.every((k) => k === GUIDE_SET_DATABASE_KEY), 'the store writes only its own key').toBe(true);
    expect(mem.raw(), 'the document\'s bases are not copied into the store').not.toContain(a.doc.sequence);
    expect(mem.raw(), 'nor its features').not.toContain('rep_origin');

    const reopened = openGuideSetDatabase({ storage: mem.storage });
    const listA = reopened.listForDocument(a.doc.id);
    expect(listA.kind === 'saved' && listA.sets.map((s) => [s.documentId, s.name])).toEqual([[a.doc.id, `${a.label} search`]]);
    const listD = reopened.listForDocument(d.doc.id);
    expect(listD.kind === 'saved' && listD.sets.map((s) => s.documentId)).toEqual([d.doc.id]);
    expect(reopened.listForDocument('fvd_never_saved').kind, 'and under no other document').toBe('none');
  });

  it('US-01M7DVFD AC3 an empty result is kept with zero rows, and no saved set and an unreadable store are told apart by name', () => {
    const mem = memory();
    const empty: Fixture = { label: 'empty', doc: dnaDoc('fvd_empty', FILLER), nuclease: SPCAS9, interval: null };
    const result = scan(empty);
    expect(result.report.candidateCount, 'the fixture holds no site').toBe(0);
    const saved = openGuideSetDatabase({ storage: mem.storage, newId: ids }).save(runOf(empty, result, 'Nothing here'), docRef(empty.doc));
    expect(saved.ok).toBe(true);

    const reopened = openGuideSetDatabase({ storage: mem.storage });
    const ran = reopened.listForDocument(empty.doc.id);
    expect(ran.kind, 'a set that ran and found no guide').toBe('saved');
    if (ran.kind !== 'saved') return;
    expect(ran.sets[0].guides).toEqual([]);
    expect(ran.sets[0].report.candidateCount).toBe(0);
    expect(ran.sets[0].report).toEqual(result.report);
    expect([ran.sets[0].name, ran.sets[0].sequenceRevision, ran.sets[0].criteria.nuclease.id]).toEqual([
      'Nothing here', revisionOf(empty.doc), SPCAS9,
    ]);

    expect(reopened.listForDocument('fvd_other'), 'no saved set for this document').toEqual({ kind: 'none' });
    expect(openGuideSetDatabase({ storage: memory().storage }).listForDocument(empty.doc.id).kind, 'an empty store').toBe('none');

    const unreadable = openGuideSetDatabase({ storage: memory({ [GUIDE_SET_DATABASE_KEY]: '{"schema":1,"sets":[' }).storage });
    const listed = unreadable.listForDocument(empty.doc.id);
    expect(listed.kind, 'a store that could not be read').toBe('unreadable');
    expect(listed.kind === 'unreadable' && listed.error.message).toMatch(/cannot be read/);
    expect(listed.kind === 'unreadable' && listed.error.message).not.toMatch(/no saved/i);
  });

  it('US-01M7DVFD AC5 malformed and newer-schema values are named apart, a save over either keeps the bytes, and a refused write saves nothing', () => {
    const f = FIXTURES[0];
    const run = runOf(f, scan(f));
    const cases: { label: string; raw: string; kind: 'malformed' | 'futureSchema'; why: RegExp }[] = [
      { label: 'unparseable', raw: '{"schema":1,"sets":[{"id":', kind: 'malformed', why: /not valid JSON/ },
      { label: 'not an envelope', raw: '{"schema":1,"sets":"none"}', kind: 'malformed', why: /no list of guide sets/ },
      { label: 'a set that cannot be read', raw: '{"schema":1,"sets":[{"id":"x"}]}', kind: 'malformed', why: /set 1/ },
      { label: 'newer schema', raw: '{"schema":2,"sets":[]}', kind: 'futureSchema', why: /schema 2, newer than the schema 1/ },
    ];
    for (const c of cases) {
      const mem = memory({ [GUIDE_SET_DATABASE_KEY]: c.raw });
      const db = openGuideSetDatabase({ storage: mem.storage, newId: ids });
      const read = db.read();
      expect(read.ok, c.label).toBe(false);
      if (read.ok) continue;
      expect(read.error.kind, `${c.label} is named ${c.kind}`).toBe(c.kind);
      expect(read.error.message, c.label).toMatch(c.why);
      expect(read.error.storedValue, c.label).toBe(c.raw);
      expect(db.listForDocument(f.doc.id).kind, `${c.label}: never no saved searches`).toBe('unreadable');

      const saved = db.save(run, docRef(f.doc));
      expect(saved.ok, `${c.label}: the save refuses`).toBe(false);
      if (saved.ok) continue;
      expect(saved.error.kind).toBe(c.kind);
      expect(saved.error.message, `${c.label}: says nothing was saved and why`).toMatch(/^Nothing was saved: /);
      expect(saved.error.message).toMatch(c.why);
      expect(mem.writes, `${c.label}: nothing written`).toEqual([]);
      expect(mem.raw(), `${c.label}: the stored value byte for byte`).toBe(c.raw);
    }

    // A write the storage throws on, and one it silently drops.
    const thrown: GuideSetStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      },
    };
    const refused = openGuideSetDatabase({ storage: thrown }).save(run, docRef(f.doc));
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.kind).toBe('notSaved');
    expect(!refused.ok && refused.error.message).toMatch(/^Nothing was saved/);
    const dropped: GuideSetStorage = { getItem: () => null, setItem: () => undefined };
    const lost = openGuideSetDatabase({ storage: dropped }).save(run, docRef(f.doc));
    expect(!lost.ok && lost.error.kind, 'a write the storage did not keep is not reported as saved').toBe('notSaved');

    // Storage that cannot be read at all is unreadable too, never empty.
    const blocked: GuideSetStorage = {
      getItem: () => {
        throw new Error('SecurityError: storage is blocked');
      },
      setItem: () => undefined,
    };
    const list = openGuideSetDatabase({ storage: blocked }).listForDocument(f.doc.id);
    expect(list.kind === 'unreadable' && list.error.kind).toBe('unavailable');
  });
});
