#!/usr/bin/env node
// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Regenerates `crates/molbiocraft-wasm/tests/ts_rpc_payloads.json`, the list of RPC payload keys the
 * app sends, which `rpc_contract.rs` checks the Rust dispatcher reads (`npm run rpc:capture`).
 *
 * Runs the full Vitest suite once with `MOLBIOCRAFT_RPC_CAPTURE` pointing at a fresh temporary
 * directory, so `src/lib/rustBioEngine.ts` records every (op, payload keys) pair it sends; then
 * merges the records into `{ op: [keys] }` with ops and keys sorted, written as
 * `JSON.stringify(snapshot, null, 1)` with no trailing newline. Re-running it on the same tree
 * writes byte-identical output.
 *
 * The run is pinned to what a fresh checkout has: `MOLBIOCRAFT_TEST_DATA_DIR` points at an empty
 * directory (and `MOLBIOCRAFT_REQUIRE_TEST_DATA=0`), so the git-ignored reference-data suites are
 * skipped whether or not `test-data/` exists locally, and a local run matches a fresh checkout (and CI).
 *
 * Writes nothing and exits non-zero if Vitest fails, if no RPC call was recorded, or if a record
 * cannot be read. The temporary directory is removed either way.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT_DIR, 'crates', 'molbiocraft-wasm', 'tests', 'ts_rpc_payloads.json');
const VITEST_BIN = path.join(ROOT_DIR, 'node_modules', 'vitest', 'vitest.mjs');

function fail(message) {
  console.error(`rpc:capture: ${message}`);
  process.exitCode = 1;
}

function capture(workDir) {
  if (!fs.existsSync(VITEST_BIN)) {
    return fail(`Vitest not found at ${VITEST_BIN} (run npm ci first); snapshot not written`);
  }
  const recordDir = path.join(workDir, 'records');
  const noTestData = path.join(workDir, 'no-test-data');
  fs.mkdirSync(recordDir);
  fs.mkdirSync(noTestData);

  const run = spawnSync(process.execPath, [VITEST_BIN, 'run'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      MOLBIOCRAFT_RPC_CAPTURE: recordDir,
      MOLBIOCRAFT_TEST_DATA_DIR: noTestData,
      MOLBIOCRAFT_REQUIRE_TEST_DATA: '0',
    },
  });
  if (run.error) {
    return fail(`could not start Vitest: ${run.error.message}; snapshot not written`);
  }
  if (run.status !== 0) {
    return fail(`Vitest exited with ${run.status ?? `signal ${run.signal}`}; snapshot not written`);
  }

  const files = fs.readdirSync(recordDir).filter((f) => f.endsWith('.jsonl')).sort();
  if (files.length === 0) {
    return fail(`Vitest passed but recorded no RPC call in ${recordDir} (MOLBIOCRAFT_RPC_CAPTURE not honoured?); snapshot not written`);
  }

  const keysByOp = new Map();
  for (const file of files) {
    const lines = fs.readFileSync(path.join(recordDir, file), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      if (line === '') continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (err) {
        return fail(`unreadable record ${file}:${i + 1} (${err.message}); snapshot not written`);
      }
      if (typeof record?.op !== 'string' || !Array.isArray(record.keys) || !record.keys.every((k) => typeof k === 'string')) {
        return fail(`malformed record ${file}:${i + 1}: ${line}; snapshot not written`);
      }
      if (!keysByOp.has(record.op)) keysByOp.set(record.op, new Set());
      for (const key of record.keys) keysByOp.get(record.op).add(key);
    }
  }

  const snapshot = {};
  for (const op of [...keysByOp.keys()].sort()) {
    snapshot[op] = [...keysByOp.get(op)].sort();
  }
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 1));
  const keyCount = Object.values(snapshot).reduce((n, keys) => n + keys.length, 0);
  console.log(`rpc:capture: ${keysByOp.size} ops, ${keyCount} keys -> ${path.relative(ROOT_DIR, SNAPSHOT)}`);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molbiocraft-rpc-capture-'));
try {
  capture(workDir);
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
