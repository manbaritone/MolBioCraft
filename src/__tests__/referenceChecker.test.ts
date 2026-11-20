// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The reference check's local-only rule (D0010, BG-01M6QDEV): scripts/check_reference_suite.mjs,
 * the command release.yml and nightly.yml run, here with `--only vitest` and its Vitest replaced by
 * the stand-in below (MOLBIOCRAFT_REFERENCE_VITEST). Its exemption covers one test, named by file
 * and title, and only while that test's data folder holds none of its files; every other skip fails.
 */

import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');
const CHECK = path.join(REPO, 'scripts', 'check_reference_suite.mjs');
const FILE = 'src/__tests__/fragmentAnalysisRealRuns.test.ts';
const TITLE = 'matches all 16 GeneScan 500 LIZ peaks on the 3730xl runs';
const DATA = 'All_Cnu_microsatellites_combined';
const SELF = 'src/__tests__/referenceChecker.test.ts';

// Stands in for node_modules/vitest/vitest.mjs. It logs its arguments and the
// MOLBIOCRAFT_REQUIRE_TEST_DATA it saw, and writes a JSON report in which every test file it was
// asked to run (the files named, else every test file under --dir but the --exclude ones) passed
// one test, 'stub', and FILE also holds TITLE. TITLE is skipped while DATA is absent from
// MOLBIOCRAFT_TEST_DATA_DIR, with the resolver's skip line naming the folder printed and handed to
// the check's console reporter, as its it.skipIf does, and passes while it exists. STUB_PLAN
// (JSON) changes that: `skip` lists [file, title] pairs reported skipped (a title the file does
// not hold is added to it), `drop` removes TITLE from FILE, and `extraSkipLines` prints that many
// more skip lines naming DATA.
const VITEST_STUB = `
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ args, require: process.env.MOLBIOCRAFT_REQUIRE_TEST_DATA }) + '\\n');
const plan = JSON.parse(process.env.STUB_PLAN || '{}');
const after = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const named = args.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--dir' && all[i - 1] !== '--exclude');
const excluded = after('--exclude').map((p) => path.basename(p));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\\.(test|spec)\\.[cm]?[jt]sx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = named.length ? named.map((f) => path.resolve(f)) : walk(after('--dir')[0]).filter((f) => !excluded.includes(path.basename(f)));
const rel = (f) => path.relative(fs.realpathSync('.'), fs.realpathSync(f)).split(path.sep).join('/');
const folder = path.join(path.resolve(process.env.MOLBIOCRAFT_TEST_DATA_DIR), ${JSON.stringify(DATA)});
const skipLines = [];
const testResults = files.map((f) => {
  const r = rel(f);
  const titles = ['stub'];
  if (r === ${JSON.stringify(FILE)} && !plan.drop) titles.push(${JSON.stringify(TITLE)});
  for (const [file, title] of plan.skip ?? []) if (file === r && !titles.includes(title)) titles.push(title);
  const assertionResults = titles.map((title) => {
    let status = 'passed';
    if (r === ${JSON.stringify(FILE)} && title === ${JSON.stringify(TITLE)} && !fs.existsSync(folder)) {
      skipLines.push('skipped: reference data absent (' + folder + ')');
      status = 'skipped';
    }
    if ((plan.skip ?? []).some(([file, t]) => file === r && t === title)) status = 'skipped';
    return { title, fullName: title, status };
  });
  return { name: f, status: 'passed', message: '', assertionResults };
});
if (testResults.some((t) => rel(t.name) === ${JSON.stringify(FILE)})) for (let i = 0; i < (plan.extraSkipLines ?? 0); i++) skipLines.push('skipped: reference data absent (' + folder + ')');
if (skipLines.length) {
  const reporter = args.map((a) => (a.startsWith('--reporter=') ? a.slice('--reporter='.length) : '')).find((x) => x && x !== 'default' && x !== 'json');
  const Reporter = (await import(pathToFileURL(reporter).href)).default;
  const rep = new Reporter();
  rep.onInit({ state: { idMap: new Map() } });
  for (const line of skipLines) {
    console.error(line);
    rep.onUserConsoleLog({ content: line });
  }
}
const all = testResults.flatMap((t) => t.assertionResults);
const passed = all.filter((t) => t.status === 'passed').length;
const out = args.find((a) => a.startsWith('--outputFile.json=')).slice('--outputFile.json='.length);
fs.writeFileSync(out, JSON.stringify({ success: true, numFailedTestSuites: 0, numPassedTests: passed, numFailedTests: 0, numPendingTests: all.length - passed, numTodoTests: 0, testResults }));
`;

interface Run { status: number | null; stdout: string; stderr: string; ran: { args: string[]; require?: string }[] }

/** The check's last lines: its PASS line, or its FAIL line and one line per reason. */
const verdict = (stdout: string): string => stdout.slice(stdout.lastIndexOf('\nreference suite'));
const localLine = (outcome: string) => `\nlocal-only (private data not in CI): ${FILE} > ${TITLE}: ${outcome}\n`;

function withCheck(body: (check: (data: string, plan?: object) => Run, dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-reference-checker-'));
  try {
    const stub = path.join(dir, 'vitest-stub.mjs');
    fs.writeFileSync(stub, VITEST_STUB);
    const log = path.join(dir, 'stub-runs.jsonl');
    // This environment without the variables the check or the stub reads, plus the stand-in.
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MOLBIOCRAFT_REFERENCE_|STUB_|MOLBIOCRAFT_TEST_DATA_DIR$|MOLBIOCRAFT_REQUIRE_TEST_DATA$)/.test(k)));
    const check = (data: string, plan: object = {}): Run => {
      fs.rmSync(log, { force: true });
      const r = cp.spawnSync(process.execPath, [CHECK, '--only', 'vitest'], {
        cwd: REPO,
        encoding: 'utf8',
        env: { ...base, MOLBIOCRAFT_REFERENCE_VITEST: stub, MOLBIOCRAFT_TEST_DATA_DIR: data, STUB_LOG: log, STUB_PLAN: JSON.stringify(plan) },
      });
      const ran = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
      return { status: r.status, stdout: r.stdout, stderr: r.stderr, ran };
    };
    body(check, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('reference check: the local-only rule', () => {
  it('exempts exactly the one local-only test', { timeout: 120_000 }, () => {
    withCheck((check, dir) => {
      const absent = path.join(dir, 'data-absent');
      fs.mkdirSync(absent);
      const present = path.join(dir, 'data-present');
      fs.mkdirSync(path.join(present, DATA), { recursive: true });
      fs.writeFileSync(path.join(present, DATA, 'run01.fsa'), 'stand-in run\n');
      const folder = path.join(absent, DATA);

      // The one exempt test, as the check names it before any step runs.
      const clean = check(absent);
      expect(clean.stdout.split('\n').filter((l) => l.startsWith('local-only (private data not in CI): ') && l.includes('(may skip only when'))).toEqual([
        `local-only (private data not in CI): ${FILE} > ${TITLE} (may skip only when ${DATA}/ is absent or holds no .fsa file)`,
      ]);
      // Its folder absent: it skips, with one skip line naming the folder, and the check passes.
      expect(verdict(clean.stdout), clean.stdout + clean.stderr).toBe('\nreference suite (only vitest): PASS\n');
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain(localLine(`skipped, ${DATA}/ is absent`));
      // Its file is left out of the main run, which requires the data, and runs alone without it.
      expect(clean.ran.map((x) => x.require)).toEqual(['1', '0']);
      expect(clean.ran[0].args.flatMap((a, i, all) => (all[i - 1] === '--exclude' ? [a] : []))).toEqual(['**/fragmentAnalysisRealRuns.test.ts']);
      expect(clean.ran[1].args.filter((a, i, all) => i > 0 && !a.startsWith('--') && all[i - 1] !== '--dir').map((f) => path.relative(fs.realpathSync(REPO), f).split(path.sep).join('/'))).toEqual([FILE]);

      // Its folder present: it must pass, and does.
      const ran = check(present);
      expect(verdict(ran.stdout), ran.stdout + ran.stderr).toBe('\nreference suite (only vitest): PASS\n');
      expect(ran.stdout).toContain(localLine(`passed, ${DATA}/ is present`));

      // A folder holding none of its .fsa files counts as absent: there it may not pass.
      const bare = path.join(dir, 'data-bare');
      fs.mkdirSync(path.join(bare, DATA), { recursive: true });
      fs.writeFileSync(path.join(bare, DATA, 'notes.txt'), 'not a run\n');
      const vacuous = check(bare);
      expect(vacuous.status).toBe(1);
      expect(verdict(vacuous.stdout)).toBe(`\nreference suite (only vitest): FAIL\n  - vitest local-only ${FILE} > ${TITLE}: passed while ${DATA}/ holds no .fsa file, so it ran without its data; put its .fsa files in the folder, or remove the folder so that the test skips\n`);

      // The exemption is per test, not per file: another test of the same file may not skip.
      const sibling = check(absent, { skip: [[FILE, 'stub']] });
      expect(sibling.status).toBe(1);
      expect(verdict(sibling.stdout)).toBe(`\nreference suite (only vitest): FAIL\n  - vitest ${FILE}: 1 skipped of 2 tests ('stub' skipped)\n`);

      // By file and title, not by title: a test of that name in another file may not skip.
      const namesake = check(absent, { skip: [[SELF, TITLE]] });
      expect(namesake.status).toBe(1);
      expect(verdict(namesake.stdout)).toBe(`\nreference suite (only vitest): FAIL\n  - vitest ${SELF}: 1 skipped of 2 tests ('${TITLE}' skipped)\n`);

      // Only while its data is missing: with the folder present it may not skip.
      const early = check(present, { skip: [[FILE, TITLE]] });
      expect(early.status).toBe(1);
      expect(early.stdout).toContain(localLine(`skipped, ${DATA}/ is present (see the reasons below)`));
      expect(verdict(early.stdout)).toBe(`\nreference suite (only vitest): FAIL\n  - vitest ${FILE}: 1 skipped of 2 tests ('${TITLE}' skipped)\n`);

      // The exempt test must still exist under its name.
      const gone = check(absent, { drop: true });
      expect(gone.status).toBe(1);
      expect(verdict(gone.stdout)).toBe(`\nreference suite (only vitest): FAIL\n  - vitest local-only ${FILE} > ${TITLE}: no test has this name (renamed or removed? update LOCAL_ONLY)\n`);

      // Its folder is named by its own skip line only: one more means something else reads it.
      const reader = check(absent, { extraSkipLines: 1 });
      expect(reader.status).toBe(1);
      expect(verdict(reader.stdout)).toBe(`\nreference suite (only vitest): FAIL\n  - vitest local-only: 2 skip lines name ${folder}, but only its 1 skipped local-only test may (one each): another test or hook reads the folder, so it would pass early or skip without the data\n`);
    });
  });
});

describe('sample library', () => {
  it('asks the engine for the samples on first use, not while its module loads', async () => {
    vi.resetModules();
    const engine = vi.fn((op: string) => (op === 'get_sample_library' ? [{ id: 's1', name: 'one' }, { id: 's2', name: 'two' }] : []));
    vi.doMock('../lib/rustBioEngine', () => ({
      invokeRustBioSync: engine,
      generateLargeGenomeBenchmarkRust: vi.fn(),
      generateLargeProteinBenchmarkRust: vi.fn(),
    }));
    try {
      const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
      expect(engine).not.toHaveBeenCalled();
      expect(SAMPLE_LIBRARY.length).toBe(2);
      expect(Array.isArray(SAMPLE_LIBRARY)).toBe(true);
      expect(SAMPLE_LIBRARY.map((d) => d.id)).toEqual(['s1', 's2']);
      expect([...SAMPLE_LIBRARY].map((d) => d.name)).toEqual(['one', 'two']);
      expect(SAMPLE_LIBRARY[1].id).toBe('s2');
      expect(Object.keys(SAMPLE_LIBRARY)).toEqual(['0', '1']);
      expect(JSON.parse(JSON.stringify(SAMPLE_LIBRARY))).toEqual([{ id: 's1', name: 'one' }, { id: 's2', name: 'two' }]);
      SAMPLE_LIBRARY.push({ id: 's3', name: 'three' } as (typeof SAMPLE_LIBRARY)[number]);
      expect(SAMPLE_LIBRARY.map((d) => d.id)).toEqual(['s1', 's2', 's3']);
      expect(engine.mock.calls).toEqual([['get_sample_library']]);
    } finally {
      vi.doUnmock('../lib/rustBioEngine');
      vi.resetModules();
    }
  });
});

// BG-01M6QDEV round 2 (D0275). sampleScientificAccuracy once failed at collection with
// 'invokeRustBioSync is not a function': the engine module's namespace reached a data module without
// that binding while the data module loaded. The engine imports nothing back from src/ and Vite hoists
// its export getters above its code, so no import cycle or load order hands out a half-built engine;
// the registries below make collection independent of the binding by calling the engine on first use.
describe('data registries with the engine unbound while they load', () => {
  const docs = () => [{ id: 's1', name: 'one' }, { id: 's2', name: 'two' }];
  const parts = () => [{ id: 'p1', name: 'lacZ' }, { id: 'p2', name: 'bla' }];
  type Engine = { invokeRustBioSync: ((op: string) => unknown) | undefined; generateLargeGenomeBenchmarkRust: undefined; generateLargeProteinBenchmarkRust: undefined };
  async function loadUnbound() {
    vi.resetModules();
    const engine: Engine = { invokeRustBioSync: undefined, generateLargeGenomeBenchmarkRust: undefined, generateLargeProteinBenchmarkRust: undefined };
    vi.doMock('../lib/rustBioEngine', () => engine);
    const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
    const { MODULAR_VECTOR_PARTS } = await import('../data/modularVectorParts');
    const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
    const { COMMON_PLASMID_FEATURES } = await import('../core/bioEngine');
    return { engine, SAMPLE_LIBRARY, MODULAR_VECTOR_PARTS, REBASE_ENZYMES, COMMON_PLASMID_FEATURES };
  }
  const unmock = () => {
    vi.doUnmock('../lib/rustBioEngine');
    vi.resetModules();
  };

  it('imports both registries while the engine binding is undefined, binds it on first use, and asks once each', async () => {
    try {
      const { engine, SAMPLE_LIBRARY, MODULAR_VECTOR_PARTS } = await loadUnbound();
      // Still unbound: first use fails loudly, naming the missing binding, rather than reading as empty.
      expect(() => MODULAR_VECTOR_PARTS.length).toThrow(/invokeRustBioSync is not a function/);
      expect(() => SAMPLE_LIBRARY.length).toThrow(/invokeRustBioSync is not a function/);
      const calls: string[] = [];
      engine.invokeRustBioSync = (op) => {
        calls.push(op);
        return op === 'get_sample_library' ? docs() : op === 'get_modular_vector_parts' ? parts() : [];
      };
      expect(MODULAR_VECTOR_PARTS.map((p) => p.id)).toEqual(['p1', 'p2']);
      expect(MODULAR_VECTOR_PARTS.find((p) => p.name === 'bla')?.id).toBe('p2');
      expect(SAMPLE_LIBRARY.map((d) => d.id)).toEqual(['s1', 's2']);
      expect([...MODULAR_VECTOR_PARTS, ...SAMPLE_LIBRARY]).toHaveLength(4);
      expect(calls).toEqual(['get_modular_vector_parts', 'get_sample_library']);
    } finally {
      unmock();
    }
  });

  it('sends delete and defineProperty to the loaded array, refuses structuredClone of the stand-in itself, and survives a refused freeze', async () => {
    try {
      const { engine, SAMPLE_LIBRARY, MODULAR_VECTOR_PARTS, REBASE_ENZYMES, COMMON_PLASMID_FEATURES } = await loadUnbound();
      engine.invokeRustBioSync = (op) => (op === 'get_sample_library' ? docs() : parts());
      for (const list of [SAMPLE_LIBRARY, MODULAR_VECTOR_PARTS, REBASE_ENZYMES, COMMON_PLASMID_FEATURES] as unknown as { id: string; name: string }[][]) {
        delete list[0];
        expect(list[0]).toBeUndefined();
        expect(0 in list).toBe(false);
        expect(list.length).toBe(2);
        Object.defineProperty(list, 0, { value: { id: 'x', name: 'x' }, writable: true, enumerable: true, configurable: true });
        expect(list.map((d) => d.id)).toEqual(['x', list[1].id]);
        expect(() => structuredClone(list)).toThrow(/could not be cloned/);
        expect(structuredClone([...list])).toEqual([{ id: 'x', name: 'x' }, list[1]]);
        expect(() => Object.freeze(list)).toThrow(TypeError);
        expect(() => Object.defineProperty(list, 5, { value: 1, configurable: false })).toThrow(TypeError);
        expect(Object.isFrozen(list) || !Object.isExtensible(list)).toBe(false);
        expect(Object.keys(list)).toEqual(['0', '1']);
      }
    } finally {
      unmock();
    }
  });

  it("imports sampleScientificAccuracy's whole import chain with every engine function unbound, and binds it on first use", async () => {
    vi.resetModules();
    const real = await vi.importActual<Record<string, unknown>>('../lib/rustBioEngine');
    // Every function the engine module exports is undefined while the chain loads, so any import-time
    // engine call (through invokeRustBioSync or any wrapper) fails the import.
    const engine: Record<string, unknown> = Object.fromEntries(Object.entries(real).map(([k, v]) => [k, typeof v === 'function' ? undefined : v]));
    vi.doMock('../lib/rustBioEngine', () => engine);
    try {
      const chain = ['../data/sampleLibrary', '../data/modularVectorParts', '../core/bioEngine', '../core/contigSummary', '../core/operationRunners', '../data/rebaseEnzymes'];
      for (const m of chain) await expect(import(m), m).resolves.toBeDefined();
      const { REBASE_ENZYMES, builtInEnzymeNamed } = await import('../data/rebaseEnzymes');
      const { COMMON_PLASMID_FEATURES } = await import('../core/bioEngine');
      expect(() => REBASE_ENZYMES.length).toThrow(/invokeRustBioSync is not a function/);
      expect(() => COMMON_PLASMID_FEATURES.length).toThrow(/invokeRustBioSync is not a function/);
      const calls: string[] = [];
      engine.invokeRustBioSync = (op: string, payload?: unknown) => {
        calls.push(op);
        return (real.invokeRustBioSync as (o: string, p?: unknown) => unknown)(op, payload);
      };
      expect(builtInEnzymeNamed('ecori')?.name).toBe('EcoRI');
      expect(REBASE_ENZYMES.length).toBeGreaterThan(100);
      expect(COMMON_PLASMID_FEATURES.length).toBeGreaterThan(0);
      expect(COMMON_PLASMID_FEATURES.every((f) => typeof f.name === 'string')).toBe(true);
      expect(calls).toEqual(['get_rebase_enzymes', 'get_common_plasmid_features']);
    } finally {
      unmock();
    }
  });
});
