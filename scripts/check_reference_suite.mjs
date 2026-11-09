#!/usr/bin/env node
// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Runs every test that can read the git-ignored reference data, with that data required, and
 * fails unless every one of them ran and passed (US-01M6P2SS). Used by the nightly and release
 * workflows. There is no list of reference suites to keep up to date: the check runs everything.
 *
 *   node scripts/check_reference_suite.mjs                      (as the nightly and release run it)
 *   node scripts/check_reference_suite.mjs --only ramachandran  (see OPTIONS and OVERRIDES)
 *
 * 1. The whole Vitest suite: `vitest run --dir src/__tests__` (the directory keeps out copies of
 *    the repo under e.g. .claude/worktrees/), with the JSON reporter. Vitest must exit 0 and report
 *    success. Every test file under src/__tests__ must be in the report, must not fail at
 *    collection, and must run at least one test, and every test in it must pass: none failed,
 *    skipped, pending or todo. A test file anywhere else under src/ fails the check, because this
 *    run would leave it out.
 * 2. Every cargo workspace test: `cargo test --workspace --no-fail-fast -- --include-ignored`, so
 *    the unit, integration and doc tests of every crate run, the `#[ignore]`d slow ones too (the
 *    Pfam MSA test). Cargo must exit 0, and every test target must print `test result: ok.` with
 *    0 failed, 0 ignored and 0 filtered out, and as many passed as it said it was running.
 * 3. The Ramachandran derivation check (BG-01M6Q7F7): `python3 -I
 *    scripts/outside-data/derive_ramachandran_maps.py --fetch <temp dir> --check
 *    crates/molbiocraft-protein/src/backbone.rs`, so the six region maps committed in backbone.rs
 *    are still the ones NOTICE section 6 and PROVENANCE.md say were derived from the Top8000 grids.
 *    fetch.sh does not download the grids: the script fetches the six files from its pinned commit
 *    into a temporary folder, deleted afterwards (or the missing ones into the folder named by
 *    MOLBIOCRAFT_REFERENCE_RAMA_GRIDS, which is kept), and checks each against its SHA-256. The script
 *    must exit 0 and print its `total:` line with 0 cells differing out of more than 0, and 0 doc
 *    comment mismatches.
 *
 * All three run with `MOLBIOCRAFT_REQUIRE_TEST_DATA=1`, whatever the caller set, so absent data
 * fails a test rather than skipping it, and a `skipped: reference data absent` line in the Vitest
 * or cargo output fails the check. The grids are required in the same way: a failed download fails
 * the check and never skips it. `MOLBIOCRAFT_TEST_DATA_DIR` is passed through (a relative value is
 * read from the repo root, as the tests' own resolvers do). Every step runs even if an earlier one
 * fails.
 *
 * The one exception is LOCAL_ONLY below (D0010): named tests that read private data, which is
 * never committed or fetched, so CI cannot hold it. A test file holding one is left out of the
 * main Vitest run and run on its own with `MOLBIOCRAFT_REQUIRE_TEST_DATA=0`: under `1` the resolver
 * would throw while the file is collected, so the file's other tests would not run either. The
 * exemption is per test, not per folder. In that run:
 * - A named test must be skipped (status `skipped` in the JSON report) while its folder is absent
 *   from the data directory, and must pass while it is present. It skips with
 *   `it.skipIf(!haveTestData(<folder>))`, so its skip is visible and the resolver names the folder
 *   once, while the file is collected. A folder that holds no file the test reads (LOCAL_ONLY's
 *   `needs`, in the folder or any subfolder) counts as absent, although the resolver, which only
 *   asks whether the folder exists, lets the test run. A pass while the folder is absent or holds
 *   no such file fails the check: the test ran without its data (e.g. over an empty list of runs).
 * - Every other test in the file must pass: any other skip, todo or failure fails the check.
 * - A reporter added to that run only (CONSOLE_REPORTER below) records which test printed each
 *   console line, from Vitest's own record of the test that was running. A
 *   skip line printed while a test runs fails the check, whatever it names: a test that prints it
 *   checked for absent data and returned early, so it passed without running.
 * - A skip line may name only the absent folder of a local-only test, and each such folder must be
 *   named on exactly as many skip lines as it has skipped local-only tests (one each). One more
 *   means another test, or a hook, reads the folder: it would pass early or skip without the data.
 * - If the reporter did not record every skip line the run printed, the check fails, since it
 *   cannot tell which test printed the rest.
 * What no run can see is a test that returns early on a check that prints nothing while it runs:
 * one made without the resolver (e.g. `fs.existsSync`), a flag shared with the named test's own
 * `it.skipIf`, or a resolver call whose skip line never reaches Vitest's record of the run's
 * output, because the test silenced it around the call: at the console API (e.g.
 * `vi.spyOn(console, 'warn').mockImplementation(() => {})`, an assignment to `console.warn`, or
 * `vi.stubGlobal('console', ...)`), or below it, at the console's own output stream (e.g.
 * replacing `console._stderr.write`, so that `console.warn` runs but its line is dropped). Keep
 * every other test of a local-only file free of such checks. The check prints each local-only test
 * on every run, with what happened to it, and fails if one is no longer in its file.
 *
 * Not run: the tests of the src-tauri desktop shell. src-tauri is outside the cargo workspace,
 * reads no reference data, needs the Tauri system libraries to build on Linux (which the nightly
 * does not install), and ci.yml runs its tests on every push and pull request to main. If a
 * src-tauri source file ever names the reference data, this check fails until it runs those tests
 * too: it reads every Rust source under src-tauri but its target/, gen/ and node_modules/ folders,
 * and prints how many it read and how many name the data.
 *
 * The check ends by printing one `local-only (private data not in CI): <file> > <test>: <outcome>`
 * line per local-only test, then `reference suite: PASS` (exit 0), or `reference suite: FAIL` and
 * then one line per reason (exit 1): one per failing Vitest file, by file name, one per failing
 * cargo test, by test target and test name, and one for a failed Ramachandran derivation check.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO, 'src');
const TESTS_DIR = path.join(SRC, '__tests__');
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/; // Vitest's default `include` pattern
const SKIP_LINE = 'skipped: reference data absent';
const CARGO_ARGS = 'test --workspace --no-fail-fast -- --include-ignored';
const NAMES_DATA = /MOLBIOCRAFT_TEST_DATA_DIR|MOLBIOCRAFT_REQUIRE_TEST_DATA|test-data/;
const RAMA_SCRIPT = 'scripts/outside-data/derive_ramachandran_maps.py';
const RAMA_MAPS = 'crates/molbiocraft-protein/src/backbone.rs';
const RAMA_TOTAL = /^total: (\d+) of (\d+) cells differ; (\d+) doc comment mismatches\s*$/m;

/**
 * Local-only tests (D0010). Each reads a private folder of the data directory that is never
 * committed or fetched; publishing that data is not ours to decide, and doing so lifts the
 * exemption. `file` is relative to the repo, `test` is the test's own name, `data` the folder,
 * and `needs` the ending (in any case) of the names of the files the test reads in it, in the
 * folder or any subfolder.
 */
const LOCAL_ONLY = [
  {
    // 184 3730xl instrument runs with no recorded source or licence
    file: 'src/__tests__/fragmentAnalysisRealRuns.test.ts',
    test: 'matches all 16 GeneScan 500 LIZ peaks on the 3730xl runs',
    data: 'All_Cnu_microsatellites_combined',
    needs: '.fsa',
  },
];

/**
 * What a local-only test's folder holds: `absent`, `empty` when it holds no file whose name ends
 * in `needs` (its own files or any subfolder's), or `present`. A folder that cannot be read throws.
 */
function dataState(dir, needs) {
  if (!fs.existsSync(dir)) return 'absent';
  const ending = needs.toLowerCase();
  return filesUnder(dir, { test: (name) => name.toLowerCase().endsWith(ending) }).length ? 'present' : 'empty';
}

/** Where a local-only test's folder stands, as the check prints it. */
const dataWhere = (t) => `${t.data}/ ${t.state === 'empty' ? `holds no ${t.needs} file` : `is ${t.state}`}`;

/**
 * The source of a Vitest reporter, written to the local-only run's temporary folder and passed as
 * one more `--reporter`. It appends one JSON line to `out` per console write: `test` is the title
 * and full name of the test that was running, or null when none was (the file being collected, or
 * a suite hook), and `content` is what was written.
 */
const CONSOLE_REPORTER = (out) => `import fs from 'node:fs';
export default class {
  onInit(ctx) { this.ctx = ctx; }
  onUserConsoleLog(log) {
    const task = log.taskId ? this.ctx.state.idMap.get(log.taskId) : undefined;
    const names = [];
    for (let t = task; t && t !== task.file; t = t.suite) names.unshift(t.name);
    const test = task && task.type === 'test' ? { title: task.name, fullName: names.join(' > ') } : null;
    fs.appendFileSync(${JSON.stringify(out)}, JSON.stringify({ test, content: String(log.content) }) + '\\n');
  }
}
`;

const env = { ...process.env, MOLBIOCRAFT_REQUIRE_TEST_DATA: '1' };
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/**
 * Runs a command in the repo root, echoing its output live; resolves with its exit and its stdout
 * and stderr, kept apart so a line of one is never split by the other.
 */
function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const r = { code: null, signal: null, stdout: '', stderr: '', error: null };
    const child = spawn(cmd, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    child.stdout.setEncoding('utf8').on('data', (s) => { r.stdout += s; process.stdout.write(s); });
    child.stderr.setEncoding('utf8').on('data', (s) => { r.stderr += s; process.stderr.write(s); });
    child.on('error', (error) => resolve({ ...r, error }));
    child.on('close', (code, signal) => resolve({ ...r, code, signal }));
  });
}

const printedSkipLine = (r) => r.stdout.includes(SKIP_LINE) || r.stderr.includes(SKIP_LINE);

const exitText = (r) => (r.error ? `could not start: ${r.error.message}` : r.signal ? `killed by ${r.signal}` : `exited with code ${r.code}`);

/** Every file under `dir` whose name matches `pattern`, skipping the folders named in `skip`. */
function filesUnder(dir, pattern, skip = []) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return skip.includes(e.name) ? [] : filesUnder(p, pattern, skip);
    return pattern.test(e.name) ? [p] : [];
  });
}

/** The src-tauri tests are not run (see above): fail if a src-tauri source names the reference data. */
function checkTauri() {
  const sources = filesUnder(path.join(REPO, 'src-tauri'), /\.rs$/, ['target', 'gen', 'node_modules']);
  const naming = sources.filter((f) => NAMES_DATA.test(fs.readFileSync(f, 'utf8')));
  console.log(`\n== src-tauri: ${sources.length} Rust sources read, ${naming.length} name the reference data`);
  return naming.map((f) => `${rel(f)} names the reference data, but src-tauri is outside the cargo workspace and this check does not run its tests`);
}

/** The parsed JSON report, or a reason naming why it is missing, empty or unreadable. */
function readReport(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { reason: e.code === 'ENOENT' ? `wrote no JSON report (${file} missing)` : `JSON report unreadable: ${e.message}` };
  }
  if (text.trim() === '') return { reason: `JSON report is empty (${file})` };
  try {
    return { report: JSON.parse(text) };
  } catch (e) {
    return { reason: `JSON report is not valid JSON: ${e.message}` };
  }
}

/**
 * One reason for a Vitest file that did not run cleanly, or null when every test in it passed,
 * apart from the tests named in `maySkip`, which may instead be skipped.
 */
function vitestFileReason(name, entries, maySkip = new Set()) {
  if (entries.length !== 1) return `vitest ${name}: ${entries.length ? 'reported more than once' : 'not in the report (did not run)'}`;
  const { status, message, assertionResults: tests = [] } = entries[0];
  const bad = tests.filter((t) => t.status !== 'passed' && !(t.status === 'skipped' && maySkip.has(t.title)));
  const parts = [];
  const first = String(message ?? '').split('\n')[0];
  if (first) parts.push(tests.length ? `file-level error: ${first}` : `failed at collection: ${first}`);
  else if (tests.length === 0) parts.push(status === 'passed' ? 'ran no tests' : `${status} with no tests`);
  else if (status !== 'passed' && bad.length === 0) parts.push(`file status ${status}`);
  if (bad.length) {
    const by = {};
    for (const t of bad) by[t.status] = (by[t.status] ?? 0) + 1;
    const shown = bad.slice(0, 3).map((t) => `'${t.fullName}' ${t.status}`).join(', ');
    parts.push(`${Object.entries(by).map(([s, k]) => `${k} ${s}`).join(', ')} of ${tests.length} tests (${shown}${bad.length > 3 ? ', ...' : ''})`);
  }
  return parts.length ? `vitest ${name}: ${parts.join('; ')}` : null;
}

/**
 * One Vitest run over src/__tests__ with the default and JSON reporters. Resolves with the run
 * (exit and output) and its parsed report, or a reason naming why the report is missing, empty or
 * unreadable. With `withConsole`, CONSOLE_REPORTER runs too and `logs` holds what it recorded.
 */
async function vitestRun(heading, args, runEnv, withConsole = false) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-reference-suite-'));
  try {
    const reportFile = path.join(tmp, 'vitest.json');
    const logFile = path.join(tmp, 'console.jsonl');
    const reporters = ['--reporter=default', '--reporter=json'];
    if (withConsole) {
      const reporter = path.join(tmp, 'console-reporter.mjs');
      fs.writeFileSync(reporter, CONSOLE_REPORTER(logFile));
      reporters.push(`--reporter=${reporter}`);
    }
    console.log(`\n== ${heading}`);
    const r = await run(process.execPath, [VITEST, 'run', '--dir', TESTS_DIR, ...args, ...reporters, `--outputFile.json=${reportFile}`], { env: runEnv });
    const logs = withConsole && fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { r, logs, ...readReport(reportFile) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const countSkipLines = (text) => text.split(SKIP_LINE).length - 1;

/** The paths one skip line names (the line itself when it names none in the resolver's format). */
function skipLinePaths(line) {
  const m = /^ \((.*)\)\s*$/.exec(line.slice(line.indexOf(SKIP_LINE) + SKIP_LINE.length));
  return m ? m[1].split(', ') : [line.trim()];
}

/** Every skip line CONSOLE_REPORTER recorded: the test that printed it (or null) and its paths. */
const recordedSkipLines = (logs) => logs.flatMap((l) => l.content.split(/\r?\n/).filter((s) => s.includes(SKIP_LINE)).map((s) => ({ test: l.test, paths: skipLinePaths(s) })));

/**
 * The Vitest step: the reasons it fails, and the local-only tests with what happened to each
 * (`status` from the JSON report, `absent` when their data folder is missing).
 */
async function checkVitest(dataDir) {
  const onDisk = filesUnder(SRC, TEST_FILE, ['node_modules']).map(real);
  const testsDir = real(TESTS_DIR) + path.sep;
  const expected = onDisk.filter((f) => f.startsWith(testsDir));
  const reasons = onDisk.filter((f) => !f.startsWith(testsDir)).map((f) => `vitest ${rel(f)}: outside src/__tests__, so this check does not run it`);
  if (expected.length === 0) return { reasons: [...reasons, 'vitest found no test file under src/__tests__'], local: [] };

  // `absent`: the test has none of its data, whether the folder is absent or empty, so it may skip
  // and must not pass.
  const local = LOCAL_ONLY.map((t) => {
    const state = dataState(path.join(dataDir, t.data), t.needs);
    return { ...t, path: real(path.join(REPO, t.file)), state, absent: state !== 'present', status: null };
  });
  for (const t of local.filter((x) => !expected.includes(x.path))) reasons.push(`vitest local-only ${t.file} > ${t.test}: ${t.file} is not a test file under src/__tests__ (update LOCAL_ONLY)`);
  const localFiles = [...new Set(local.map((t) => t.path))].filter((f) => expected.includes(f));
  // Only a folder that is not there is named by the resolver's skip line; an empty one exists.
  const mayName = new Set(local.filter((t) => t.state === 'absent').map((t) => path.resolve(dataDir, t.data)));

  // The main run leaves out the files holding local-only tests; the second runs only those.
  const runs = [{
    label: 'vitest',
    pending: () => 0,
    ...(await vitestRun(`vitest run --dir src/__tests__ (${expected.length - localFiles.length} test files${localFiles.length ? `; ${localFiles.map(rel).join(', ')} next` : ''})`, localFiles.flatMap((f) => ['--exclude', `**/${path.basename(f)}`]), env)),
  }];
  if (localFiles.length) {
    runs.push({
      label: `vitest (local-only files, MOLBIOCRAFT_REQUIRE_TEST_DATA=0)`,
      pending: () => local.filter((t) => t.absent && t.status === 'skipped').length,
      ...(await vitestRun(`vitest run --dir src/__tests__ ${localFiles.map(rel).join(' ')} (they hold local-only tests: MOLBIOCRAFT_REQUIRE_TEST_DATA=0)`, localFiles, { ...env, MOLBIOCRAFT_REQUIRE_TEST_DATA: '0' }, true)),
    });
  }

  const results = [];
  let localSkipLines = [];
  for (const [i, x] of runs.entries()) {
    if (x.r.code !== 0) reasons.push(`${x.label} ${exitText(x.r)}`);
    if (i === 0 && printedSkipLine(x.r)) reasons.push(`${x.label} printed '${SKIP_LINE}'`);
    if (i > 0) {
      localSkipLines = recordedSkipLines(x.logs);
      const printed = countSkipLines(x.r.stdout) + countSkipLines(x.r.stderr);
      if (printed !== localSkipLines.length) reasons.push(`${x.label} printed '${SKIP_LINE}' ${printed} times but its console reporter recorded ${localSkipLines.length}, so the check cannot tell which test printed each`);
      for (const l of localSkipLines) {
        if (l.test) reasons.push(`${x.label}: test '${l.test.fullName}' printed '${SKIP_LINE}' (${l.paths.join(', ')}) while it ran, so it returned early instead of running; only a local-only test may skip, and with it.skipIf, before it runs`);
        for (const p of l.paths) if (!mayName.has(path.resolve(p))) reasons.push(`${x.label} printed '${SKIP_LINE}' for ${p}, which is not the absent data of a local-only test`);
      }
    }
    if (!x.report) reasons.push(`${x.label} ${x.reason}`);
    else results.push(...(Array.isArray(x.report.testResults) ? x.report.testResults : []).map((t) => ({ ...t, file: real(String(t.name)) })));
  }
  if (runs.some((x) => !x.report)) return { reasons, local };

  const perFile = expected.map((f) => vitestFileReason(rel(f), results.filter((t) => t.file === f), new Set(local.filter((t) => t.path === f && t.absent).map((t) => t.test)))).filter(Boolean);
  for (const t of results.filter((x) => !expected.includes(x.file))) perFile.push(`vitest ${t.name}: in the report but not a test file under src/__tests__`);
  for (const t of local.filter((x) => localFiles.includes(x.path))) {
    const entries = results.filter((x) => x.file === t.path);
    if (entries.length !== 1) continue; // reported per file above
    const named = (entries[0].assertionResults ?? []).filter((a) => a.title === t.test);
    if (named.length === 1) {
      t.status = named[0].status;
      if (t.absent && t.status === 'passed') {
        const fix = t.state === 'absent' ? 'while the folder is absent it must skip, with it.skipIf(!haveTestData(<folder>))' : `put its ${t.needs} files in the folder, or remove the folder so that the test skips`;
        perFile.push(`vitest local-only ${t.file} > ${t.test}: passed while ${dataWhere(t)}, so it ran without its data; ${fix}`);
      }
    } else perFile.push(`vitest local-only ${t.file} > ${t.test}: ${named.length ? 'more than one test has this name' : 'no test has this name (renamed or removed? update LOCAL_ONLY)'}`);
  }
  // Each absent folder is named once by each skipped local-only test that reads it (its it.skipIf
  // condition, while the file is collected), and by nothing else.
  for (const f of mayName) {
    const named = localSkipLines.filter((l) => l.paths.some((p) => path.resolve(p) === f)).length;
    const skipped = local.filter((t) => t.absent && t.status === 'skipped' && path.resolve(dataDir, t.data) === f).length;
    if (named > skipped) reasons.push(`vitest local-only: ${named} skip lines name ${f}, but only its ${skipped} skipped local-only test${skipped === 1 ? '' : 's'} may (one each): another test or hook reads the folder, so it would pass early or skip without the data`);
    else if (named < skipped) reasons.push(`vitest local-only: ${skipped} local-only test${skipped === 1 ? '' : 's'} of ${f} skipped but ${named} skip lines name it: a local-only test skips with it.skipIf(!haveTestData(<folder>)), so that its skip names its folder`);
  }

  // The totals only add a reason when no file was named, so a failure is reported once.
  const totals = [];
  for (const x of runs) {
    const n = (k) => (Number.isInteger(x.report[k]) ? x.report[k] : NaN);
    console.log(`${x.label} totals: ${x.report.testResults?.length ?? 0} files; ${n('numPassedTests')} passed, ${n('numFailedTests')} failed, ${n('numPendingTests')} skipped, ${n('numTodoTests')} todo`);
    if (n('numFailedTestSuites') !== 0) totals.push(`${x.label} numFailedTestSuites is ${n('numFailedTestSuites')}, not 0`);
    if (n('numFailedTests') !== 0) totals.push(`${x.label} numFailedTests is ${n('numFailedTests')}, not 0`);
    if (n('numPendingTests') !== x.pending()) totals.push(`${x.label} numPendingTests (skipped) is ${n('numPendingTests')}, not ${x.pending()}`);
    if (n('numTodoTests') !== 0) totals.push(`${x.label} numTodoTests is ${n('numTodoTests')}, not 0`);
    if (!(n('numPassedTests') > 0)) totals.push(`${x.label} numPassedTests is ${n('numPassedTests')}, not above 0`);
    if (x.report.success !== true) totals.push(`${x.label} report success is not true`);
  }
  return { reasons: [...reasons, ...perFile, ...(perFile.length ? [] : totals)], local };
}

/** A CSI escape sequence (ESC [, parameter bytes, intermediate bytes, final byte), e.g. ESC[92m. */
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/**
 * The test targets in cargo test output (stdout and stderr merged, so each `Running` line comes
 * before its own results): their label, the count they said they were running, each test's
 * outcome, and the `test result:` line. Each line is read with its CSI sequences removed, so a
 * `Running` or `Doc-tests` line that cargo colours (CARGO_TERM_COLOR=always, as the release and
 * nightly jobs set it, gives ESC[1m ESC[92m `Running` ESC[0m) is read as the plain one (BG-01M6V3SC).
 */
function cargoTargets(text) {
  const targets = [];
  let t = null;
  const open = (label) => targets.push((t = { label, running: null, tests: [], result: null }));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(CSI, '');
    let m;
    if ((m = /^\s*Running (?:unittests )?(\S+) \((.+)\)\s*$/.exec(line))) {
      const bin = path.posix.basename(m[2].replace(/\\/g, '/')).replace(/\.exe$/, '').replace(/-[0-9a-f]{8,}$/, '');
      open(`${bin} (${m[1].replace(/\\/g, '/')})`);
    } else if ((m = /^\s*Doc-tests (\S+)\s*$/.exec(line))) {
      open(`${m[1]} (doc-tests)`);
    } else if (!t) {
      continue;
    } else if ((m = /^running (\d+) tests?$/.exec(line))) {
      t.running = Number(m[1]);
    } else if ((m = /^test (.+) \.\.\. (ok|FAILED|ignored\b.*)$/.exec(line))) {
      t.tests.push({ name: m[1], outcome: m[2].startsWith('ignored') ? 'ignored' : m[2] });
    } else if ((m = /^test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/.exec(line))) {
      const [passed, failed, ignored, , filtered] = m.slice(2).map(Number);
      t.result = { status: m[1], passed, failed, ignored, filtered };
    }
  }
  return targets;
}

async function checkCargo() {
  const reasons = [];
  console.log(`\n== ${CARGO}`);
  // Through the shell so `2>&1` puts cargo's `Running <target>` lines (stderr) in order with each
  // test binary's results (stdout); the test binaries' own output is captured by libtest.
  const r = await run(`${CARGO} 2>&1`, [], { shell: true });
  if (r.code !== 0) reasons.push(`cargo test ${exitText(r)}`);
  if (printedSkipLine(r)) reasons.push(`cargo test printed '${SKIP_LINE}'`);
  const targets = cargoTargets(r.stdout);
  let passed = 0;
  for (const t of targets) {
    const bad = t.tests.filter((x) => x.outcome !== 'ok');
    for (const x of bad) reasons.push(`cargo ${t.label}: test ${x.name} ${x.outcome === 'FAILED' ? 'FAILED' : `${x.outcome} (did not run)`}`);
    if (!t.result) {
      reasons.push(`cargo ${t.label}: printed no 'test result:' line (the test binary crashed or was killed)`);
      continue;
    }
    const { status, failed, ignored, filtered } = t.result;
    passed += t.result.passed;
    const clean = status === 'ok' && failed === 0 && ignored === 0 && filtered === 0 && t.result.passed === t.running;
    if (!clean && bad.length === 0) {
      reasons.push(`cargo ${t.label}: test result ${status}, ${t.result.passed} passed of ${t.running ?? '?'} run, ${failed} failed, ${ignored} ignored, ${filtered} filtered out`);
    }
  }
  console.log(`cargo totals: ${targets.length} test targets; ${passed} passed`);
  if (targets.length === 0) reasons.push('cargo test ran no test target');
  else if (!(passed > 0)) reasons.push('cargo test passed no test');
  return reasons;
}

/**
 * OPTIONS. With none, every step runs: the command the nightly and release workflows run. `--only
 * STEPS` runs only the named steps (comma-separated, from STEPS) of the same sequence, and the PASS
 * or FAIL line then names them, e.g. `reference suite (only ramachandran): PASS`, so a partial run
 * never reads as the full check. An unknown option, a repeated or missing value or an unknown step
 * exits 2 before any step runs.
 */
const STEPS = ['tauri', 'vitest', 'cargo', 'ramachandran'];
const OPTIONS = ['--only'];
const given = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const [name, value] = [process.argv[i], process.argv[i + 1]];
  const why = !OPTIONS.includes(name) ? `unknown option ${name}` : name in given ? `${name} given twice` : value === undefined || value.startsWith('--') ? `${name} needs a value` : null;
  if (why) {
    console.error(`check_reference_suite: ${why} (options: ${OPTIONS.join(', ')})`);
    process.exit(2);
  }
  given[name] = value;
}
const ONLY = given['--only'] === undefined ? null : new Set(given['--only'].split(',').map((s) => s.trim()));
for (const s of ONLY ?? []) {
  if (!STEPS.includes(s)) {
    console.error(`check_reference_suite: --only: unknown step '${s}' (steps: ${STEPS.join(', ')})`);
    process.exit(2);
  }
}
const runs = (step) => ONLY === null || ONLY.has(step);
const SUITE = ONLY === null ? 'reference suite' : `reference suite (only ${STEPS.filter(runs).join(', ')})`;

/**
 * OVERRIDES (BG-01M6Q7F7): what the steps run and read, from the environment, so that a test can
 * run the command the workflows run, with no options, against stand-ins. Each one that is unset or
 * empty keeps its default, and each one in effect is printed before the steps run:
 * - MOLBIOCRAFT_REFERENCE_VITEST: a Node script run, by this Node and with the same arguments, in
 *   place of node_modules/vitest/vitest.mjs.
 * - MOLBIOCRAFT_REFERENCE_CARGO: the shell words run in place of `cargo` in the cargo step's line.
 * - MOLBIOCRAFT_REFERENCE_PYTHON: the program that runs the derivation script, in place of
 *   `python3` (a bare name is looked up on PATH).
 * - MOLBIOCRAFT_REFERENCE_RAMA_SCRIPT: the script run in place of the derivation script.
 * - MOLBIOCRAFT_REFERENCE_RAMA_MAPS: the file checked in place of backbone.rs.
 * - MOLBIOCRAFT_REFERENCE_RAMA_GRIDS: the folder the six grids are read from, the missing ones
 *   fetched into it, and kept (default: a temporary folder, deleted afterwards).
 * A path in any of them but the cargo words, which the shell runs as written in the repo root, is
 * read from the caller's working directory. MOLBIOCRAFT_REQUIRE_TEST_DATA is 1 whatever is set,
 * and the derivation script checks the grids' SHA-256 wherever they are read from.
 */
const OVERRIDES = ['VITEST', 'CARGO', 'PYTHON', 'RAMA_SCRIPT', 'RAMA_MAPS', 'RAMA_GRIDS'].map((k) => `MOLBIOCRAFT_REFERENCE_${k}`);
const override = (k) => process.env[`MOLBIOCRAFT_REFERENCE_${k}`] || undefined;
const fromCaller = (p) => (p === undefined ? undefined : path.resolve(p));
const VITEST = fromCaller(override('VITEST')) ?? path.join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
const CARGO = `${override('CARGO') ?? 'cargo'} ${CARGO_ARGS}`;
const PYTHON = override('PYTHON') ?? 'python3';
const RAMA = {
  grids: fromCaller(override('RAMA_GRIDS')),
  maps: fromCaller(override('RAMA_MAPS')) ?? RAMA_MAPS,
  script: fromCaller(override('RAMA_SCRIPT')) ?? RAMA_SCRIPT,
  python: /[\\/]/.test(PYTHON) ? path.resolve(PYTHON) : PYTHON,
};

/**
 * The Ramachandran derivation step (step 3 above): the one reason it fails, or none. The script
 * itself prints each differing cell. In order: a `total:` line with any difference; a script that
 * could not start or exited non-zero, with the script's own error line when it printed one (a
 * failed download, a SHA-256 mismatch, a missing file); an exit 0 without a `total:` line, so the
 * step never passes on a check that did not run; and a `total:` line with no cells checked.
 */
async function checkRamachandran() {
  const label = `ramachandran derivation (${RAMA.script})`;
  const grids = RAMA.grids ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-rama8000-'));
  try {
    const args = ['-I', RAMA.script, '--fetch', grids, '--check', RAMA.maps];
    console.log(`\n== ${RAMA.python} ${args.join(' ')}`);
    const r = await run(RAMA.python, args);
    const m = RAMA_TOTAL.exec(r.stdout);
    const [differ, cells, docs] = m ? m.slice(1).map(Number) : [];
    if (m) console.log(`ramachandran totals: ${cells} cells checked; ${differ} differ; ${docs} doc comment mismatches`);
    if (m && (differ !== 0 || docs !== 0)) return [`${label}: ${differ} of ${cells} cells of ${RAMA.maps} differ from the derivation and ${docs} doc comments mismatch (each is listed above)`];
    if (r.code !== 0) {
      const why = r.stderr.split(/\r?\n/).find((l) => l.startsWith('derive_ramachandran_maps: '));
      return [`${label} ${exitText(r)}${why ? ` (${why})` : ''}`];
    }
    if (!m) return [`${label} printed no 'total:' line, so it checked nothing`];
    if (!(cells > 0)) return [`${label} checked no cells`];
    return [];
  } finally {
    if (RAMA.grids === undefined) fs.rmSync(grids, { recursive: true, force: true });
  }
}

const LOCAL_ONLY_LINE = 'local-only (private data not in CI)';
let reasons;
let local = [];
try {
  const dataDir = path.resolve(REPO, env.MOLBIOCRAFT_TEST_DATA_DIR || 'test-data');
  console.log(`reference data: ${dataDir} (MOLBIOCRAFT_REQUIRE_TEST_DATA=1)`);
  for (const k of OVERRIDES.filter((x) => process.env[x])) console.log(`override: ${k}=${process.env[k]}`);
  for (const t of LOCAL_ONLY) console.log(`${LOCAL_ONLY_LINE}: ${t.file} > ${t.test} (may skip only when ${t.data}/ is absent or holds no ${t.needs} file)`);
  const tauri = runs('tauri') ? checkTauri() : [];
  const vitest = runs('vitest') ? await checkVitest(dataDir) : { reasons: [], local: [] };
  local = vitest.local;
  reasons = [...tauri, ...vitest.reasons, ...(runs('cargo') ? await checkCargo() : []), ...(runs('ramachandran') ? await checkRamachandran() : [])];
} catch (e) {
  reasons = [`check crashed: ${e?.stack ?? e}`];
}
console.log('');
for (const t of local) {
  const where = dataWhere(t);
  const what = (t.status === 'passed' && !t.absent) || (t.status === 'skipped' && t.absent) ? `${t.status}, ${where}` : `${t.status ?? 'not run'}, ${where} (see the reasons below)`;
  console.log(`${LOCAL_ONLY_LINE}: ${t.file} > ${t.test}: ${what}`);
}
if (reasons.length === 0) {
  console.log(`\n${SUITE}: PASS`);
  process.exit(0);
}
console.log(`\n${SUITE}: FAIL\n${reasons.map((x) => `  - ${x}`).join('\n')}`);
process.exit(1);
