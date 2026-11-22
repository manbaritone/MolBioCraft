// SPDX-License-Identifier: CC-BY-NC-4.0
// US-01M80F5R: the app is called version 1.1.0 everywhere it is named, while the .mbc session
// schema stays 1.0.0 (the file format did not change).
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { describe, expect, it } from 'vitest';
import { MBC_SCHEMA_VERSION, serializeMbcWorkbench } from '../core/mbcSessionFormat';
import { serializeMbcWorkbenchRust } from '../lib/rustBioEngine';

const VERSION = '1.1.0';
const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, ...rel.split('/')), 'utf8');
const json = (rel: string): Record<string, unknown> => JSON.parse(read(rel)) as Record<string, unknown>;

// The `version = "..."` of each [[package]] block in a Cargo.lock whose name starts with molbiocraft-.
const lockVersions = (rel: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const block of read(rel).split('[[package]]')) {
    const name = /^name = "(molbiocraft-[^"]+)"$/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"$/m.exec(block)?.[1];
    if (name && version) out[name] = version;
  }
  return out;
};

const CRATES = ['align', 'cloning', 'core', 'formats', 'phylo', 'protein', 'wasm'].map((c) => `molbiocraft-${c}`);

describe('US-01M80F5R the app version is 1.1.0', () => {
  it('appVersion AC1 every manifest names version 1.1.0', () => {
    const pkg = json('package.json');
    expect(pkg.version, 'package.json').toBe(VERSION);
    const lock = json('package-lock.json') as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version, 'package-lock.json root').toBe(VERSION);
    expect(lock.packages[''].version, 'package-lock.json packages[""]').toBe(VERSION);

    const workspace = /\[workspace\.package\][^[]*?^version = "([^"]+)"$/ms.exec(read('Cargo.toml'))?.[1];
    expect(workspace, 'Cargo.toml [workspace.package] version').toBe(VERSION);
    const rootLock = lockVersions('Cargo.lock');
    for (const c of CRATES) expect(rootLock[c], `Cargo.lock ${c}`).toBe(VERSION);

    const desktop = /\[package\][^[]*?^version = "([^"]+)"$/ms.exec(read('src-tauri/Cargo.toml'))?.[1];
    expect(desktop, 'src-tauri/Cargo.toml [package] version').toBe(VERSION);
    const tauriLock = lockVersions('src-tauri/Cargo.lock');
    for (const c of [...CRATES, 'molbiocraft-desktop']) expect(tauriLock[c], `src-tauri/Cargo.lock ${c}`).toBe(VERSION);

    expect(json('src-tauri/tauri.conf.json').version, 'src-tauri/tauri.conf.json').toBe(VERSION);
  });

  it('appVersion AC2 every place the app shows its version says 1.1.0', () => {
    const sites: Array<[string, RegExp]> = [
      ['index.html', /<div>Version (\d+\.\d+\.\d+)<\/div>/],
      ['src/components/AppStartupSplash.tsx', /version = '(\d+\.\d+\.\d+)'/],
      ['src/components/MenusPreferencesAndBlastModal.tsx', /about-version-line">MolBioCraft v(\d+\.\d+\.\d+)</],
      ['src/components/ProjectFirstPageHome.tsx', /mbc-home-version-pill">Version (\d+\.\d+\.\d+)</],
    ];
    for (const [file, pattern] of sites) {
      const source = read(file);
      expect(pattern.exec(source)?.[1], `${file} shows the version`).toBe(VERSION);
      expect(source, `${file} names no 1.0.0`).not.toContain('1.0.0');
    }
  });

  it('appVersion AC3 a saved session names app version 1.1.0 and schema 1.0.0', () => {
    const snapshot = { sessionName: 'Version_Check', documents: [], workspace: {} };
    const saved = serializeMbcWorkbench(snapshot as never);
    expect(saved).toMatch(new RegExp(`"appVersion"\\s*:\\s*"${VERSION.replaceAll('.', '\\.')}"`));
    expect(saved).toMatch(/"schemaVersion"\s*:\s*"1\.0\.0"/);
    expect(MBC_SCHEMA_VERSION, 'the session format is unchanged').toBe('1.0.0');

    const direct = serializeMbcWorkbenchRust(snapshot);
    expect(direct).toMatch(new RegExp(`"appVersion"\\s*:\\s*"${VERSION.replaceAll('.', '\\.')}"`));

    // Every appVersion default in the session writers (serializeMbcWorkbench, serializeMbcFolderZip,
    // serializeMbcWorkbenchRust) is the package version.
    const defaults = ['src/core/mbcSessionFormat.ts', 'src/lib/rustBioEngine.ts'].flatMap((f) =>
      [...read(f).matchAll(/appVersion = '([^']+)'/g)].map((m) => `${f}: ${m[1]}`),
    );
    expect(defaults).toHaveLength(3);
    for (const d of defaults) expect(d.endsWith(`: ${VERSION}`), d).toBe(true);
  });

  it('appVersion AC6 the citation and the docs name version 1.1.0', () => {
    const cff = read('CITATION.cff');
    expect(cff).toMatch(/^version: 1\.1\.0$/m);
    expect(cff).toMatch(/^date-released: "2026-11-22"$/m);
    const readme = read('README.md');
    expect(readme).toContain('https://img.shields.io/badge/version-1.1.0-0284c7.svg" alt="Version 1.1.0"');
    expect(readme).toContain('version = {1.1.0},');
    expect(read('NOTICE')).toContain('(v1.1.0) [Computer software]');
    expect(read('PRODUCT.md')).toContain('- Version 1.1.0 with local universal macOS build output in `release/`');
    const security = read('SECURITY.md');
    expect(security).toContain('| `1.1.x` | :white_check_mark: Active Support |');
    expect(security).toContain('| `< 1.1.0` | :x: Upgrade to `v1.1.0+` |');
    expect(read('.github/ISSUE_TEMPLATE/bug_report.md')).toContain('- **MolBioCraft Version:** `v1.1.0`');
    for (const f of ['CITATION.cff', 'README.md', 'NOTICE', 'PRODUCT.md', 'SECURITY.md', '.github/ISSUE_TEMPLATE/bug_report.md']) {
      expect(read(f), `${f} names no v1.0.0 / 1.0.0 version`).not.toMatch(/(?<![\d.])v?1\.0\.0(?![\d.])/);
    }
  });
});
