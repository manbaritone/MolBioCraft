// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Where the reference-data ("outside data") suites find the git-ignored `test-data/` folder, and
 * what they do when it is missing. Every suite that reads that folder goes through here.
 *
 * - `MOLBIOCRAFT_TEST_DATA_DIR` overrides the folder (a relative value is read from the repo
 *   root); the default is `<repo>/test-data`.
 * - A suite whose files are absent is skipped, and `skipped: reference data absent` is printed
 *   with the missing paths.
 * - With `MOLBIOCRAFT_REQUIRE_TEST_DATA=1`, an absent file throws instead, so the suite fails.
 *   Any value other than `1`, `0` or empty is refused rather than read as "not required".
 */

interface NodeFs { statSync: (p: string, o: { throwIfNoEntry: false }) => object | undefined }
interface NodePath { resolve: (...p: string[]) => string }
interface NodeUrl { fileURLToPath: (u: string) => string }
const load = <T,>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const [fs, path, url] = await Promise.all([load<NodeFs>('node:fs'), load<NodePath>('node:path'), load<NodeUrl>('node:url')]);
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const REQUIRE = env.MOLBIOCRAFT_REQUIRE_TEST_DATA ?? '';
if (!['', '0', '1'].includes(REQUIRE)) throw new Error(`MOLBIOCRAFT_REQUIRE_TEST_DATA must be 1, 0 or unset, not ${JSON.stringify(REQUIRE)}`);
const REPO_ROOT = path.resolve(url.fileURLToPath(import.meta.url), '..', '..', '..');
const SKIPPED = 'skipped: reference data absent';

/** The reference-data folder. */
export const TEST_DATA_DIR = path.resolve(REPO_ROOT, env.MOLBIOCRAFT_TEST_DATA_DIR || 'test-data');

/** A path inside the reference-data folder (an absolute path is returned unchanged). */
export const dataPath = (rel: string): string => path.resolve(TEST_DATA_DIR, rel);

/**
 * Whether every named file or folder (relative to the reference-data folder) exists. When one is
 * absent: throws under `MOLBIOCRAFT_REQUIRE_TEST_DATA=1`, else prints the skip line and returns
 * false. A path that cannot be inspected (e.g. permission denied) throws either way.
 */
export function haveTestData(...paths: string[]): boolean {
  const missing = paths.map((p) => dataPath(p)).filter((p) => fs.statSync(p, { throwIfNoEntry: false }) === undefined);
  if (missing.length === 0) return true;
  if (REQUIRE === '1') throw new Error(`reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: ${missing.join(', ')}`);
  console.warn(`${SKIPPED} (${missing.join(', ')})`);
  return false;
}
