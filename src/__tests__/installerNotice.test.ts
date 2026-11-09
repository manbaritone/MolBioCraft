// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * NOTICE (the third-party notices: section 6 is the CC BY 4.0 attribution the Ramachandran region
 * maps owe the Richardson Lab Top8000 data) and PROVENANCE.md reach every installer the release
 * publishes (BG-01M6Q7F7, US01M6TK7V), and the reference check re-runs the Ramachandran derivation.
 *
 * The installers are built by the Tauri bundler, each on its own runner (.github/workflows/
 * release.yml), from tauri.conf.json: bundle.resources puts both files in the macOS app's
 * Contents/Resources, the MSI's install folder and the .deb's /usr/lib/MolBioCraft, and
 * bundle.linux.deb.files puts them in the .deb's /usr/share/doc/molbiocraft. The portable EXE is a
 * bare executable, so NOTICE.txt and PROVENANCE.md are published beside it as release assets. Each
 * is checked through what checks the built package, run on stand-in packages:
 * - macOS: scripts/build_installers.sh runs whole, with stubs for npm, npx (the Tauri CLI) and the
 *   macOS tools it calls by absolute path. The npx stub writes the .app and .dmg a universal build
 *   writes. The script must pass when Contents/Resources holds the repo's NOTICE and PROVENANCE.md,
 *   in the .app and in the .app inside the .dmg, and fail, naming the file, when either lacks one or
 *   holds another text.
 * - Windows and Linux: the bash self-check steps of release.yml (read as YAML by Ruby's Psych, offline)
 *   run as GitHub runs a bash step, on the tree msiexec /a unpacks from the MSI and on a .deb that a
 *   dpkg-deb stub reads as a tar archive, with the same pass and fail cases.
 * - The release assets: the checksums step of release.yml writes NOTICE.txt and PROVENANCE.md from
 *   the checkout, and the publish step attaches them.
 * Each file must be the repo's own NOTICE and PROVENANCE.md, by path or byte for byte. The scripts
 * need a POSIX shell, so on Windows they are not run, with a line saying so; the macOS and Linux CI
 * runs run them.
 *
 * The reference check is run as nightly.yml and release.yml run it,
 * `node scripts/check_reference_suite.mjs` with no options and with their
 * MOLBIOCRAFT_REQUIRE_TEST_DATA=1 and MOLBIOCRAFT_TEST_DATA_DIR, and must run every step: the src-tauri scan, Vitest, cargo and the Ramachandran derivation. What
 * its steps spawn is replaced through its MOLBIOCRAFT_REFERENCE_* variables, so it runs in seconds
 * and offline: Vitest and cargo by stubs that log that they ran and pass, and the derivation by the
 * real script under a wrapper, run by the check's default interpreter, `python3` from PATH (on
 * Windows without it, by the `python` found), on six fixture grids made from the committed maps,
 * with its SHA-256 pins swapped for the fixtures' digests and its network cut off. The same command
 * fails on a copy of the maps with one cell changed. `--only ramachandran` is checked to run that
 * step alone, and the real script is run on the fixtures, to show its pins hold.
 */
import { expect, it } from 'vitest';

interface NodeFs {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (p: string, o?: { recursive: boolean }) => void;
  copyFileSync: (from: string, to: string) => void;
  writeFileSync: (p: string, data: string | Uint8Array) => void;
  readFileSync: (p: string) => Uint8Array;
  readdirSync: (p: string) => string[];
  existsSync: (p: string) => boolean;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
  chmodSync: (p: string, mode: number) => void;
}
interface NodePath {
  join: (...p: string[]) => string;
  resolve: (...p: string[]) => string;
  dirname: (p: string) => string;
  basename: (p: string) => string;
}
interface NodeOs { tmpdir: () => string }
interface NodeUrl { fileURLToPath: (u: string) => string }
interface SpawnResult { status: number | null; stdout: string; stderr: string; error?: Error }
interface NodeChildProcess {
  spawnSync: (cmd: string, args: string[], o: { cwd?: string; env?: Record<string, string | undefined>; encoding: 'utf8' }) => SpawnResult;
}
interface NodeCrypto { createHash: (algorithm: string) => { update: (data: Uint8Array) => { digest: (enc: 'hex') => string } } }
interface NodeProcess { execPath: string; platform: string; env: Record<string, string | undefined> }

const load = <T,>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const [fs, path, os, url, cp, crypto] = await Promise.all([
  load<NodeFs>('node:fs'),
  load<NodePath>('node:path'),
  load<NodeOs>('node:os'),
  load<NodeUrl>('node:url'),
  load<NodeChildProcess>('node:child_process'),
  load<NodeCrypto>('node:crypto'),
]);
const proc = (globalThis as unknown as { process: NodeProcess }).process;

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const repo = (rel: string): string => path.join(REPO, ...rel.split('/'));
const text = (file: string): string => new TextDecoder().decode(fs.readFileSync(file));
const sha256 = (file: string): string =>
  fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : `absent: ${file}`;

const NOTICE = repo('NOTICE');
const PROVENANCE = repo('PROVENANCE.md');
const NOTICE_TEXT = text(NOTICE);
const PROVENANCE_TEXT = text(PROVENANCE);
const VERSION = (JSON.parse(text(repo('src-tauri/tauri.conf.json'))) as { version: string }).version;

/** A Python 3 on PATH (`python3`, else `python` as on Windows runners), or undefined. */
const PYTHON = ['python3', 'python'].find((c) => {
  const r = cp.spawnSync(c, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === '3';
});
const python = (): string => {
  if (PYTHON === undefined) throw new Error('no Python 3 on PATH (python3 or python): the reference check needs it');
  return PYTHON;
};

/** Runs `body` with a fresh temporary folder, deleted afterwards. */
function inTemp<T>(prefix: string, body: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const put = (file: string, data: string | Uint8Array, mode?: number): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  if (mode !== undefined) fs.chmodSync(file, mode);
};
const writeExecutable = (file: string, body: string): void => put(file, body, 0o755);
/** The checkout files the checks compare against: the repo's NOTICE and PROVENANCE.md. */
const putCheckout = (root: string): void => {
  fs.copyFileSync(NOTICE, path.join(root, 'NOTICE'));
  fs.copyFileSync(PROVENANCE, path.join(root, 'PROVENANCE.md'));
};
const tarDir = (archive: string, dir: string): void => {
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  const r = cp.spawnSync('tar', ['-cf', archive, '-C', dir, '.'], { encoding: 'utf8', env: { ...proc.env, COPYFILE_DISABLE: '1' } });
  expect(r.status, `tar: ${r.stderr}`).toBe(0);
};

/** What a package holds in place of NOTICE or PROVENANCE.md: the repo's text, another text, or nothing. */
type Copy = 'repo' | 'other' | 'absent';
const copyOf = (file: 'NOTICE' | 'PROVENANCE.md', c: Copy): string | null =>
  c === 'absent' ? null : c === 'other' ? `${file === 'NOTICE' ? NOTICE_TEXT : PROVENANCE_TEXT}\nedited\n` : file === 'NOTICE' ? NOTICE_TEXT : PROVENANCE_TEXT;
const putCopy = (dir: string, file: 'NOTICE' | 'PROVENANCE.md', c: Copy): void => {
  const body = copyOf(file, c);
  if (body !== null) put(path.join(dir, file), body);
};

interface Step { id?: string; uses?: string; run?: string; shell?: string; env?: Record<string, string>; with?: Record<string, unknown> }
interface Workflow { env?: Record<string, string>; jobs: Record<string, { env?: Record<string, string>; steps: Step[] }> }

/** release.yml as Ruby's Psych reads it: an offline YAML parser every GitHub runner and macOS carry. */
let workflow: Workflow | undefined;
function releaseWorkflow(): Workflow {
  if (workflow !== undefined) return workflow;
  const r = cp.spawnSync('ruby', ['-ryaml', '-rjson', '-e', 'print JSON.generate(YAML.safe_load(File.read(ARGV[0])))', repo('.github/workflows/release.yml')], { encoding: 'utf8' });
  if (r.error !== undefined || r.status !== 0) {
    throw new Error(`could not read .github/workflows/release.yml as YAML with ruby -ryaml (Ruby must be on PATH): ${r.error?.message ?? r.stderr}`);
  }
  workflow = JSON.parse(r.stdout) as Workflow;
  return workflow;
}

/** Runs the bash step `id` of release.yml job `job` in `cwd`, as GitHub runs one (bash -eo pipefail). */
function runStep(wf: Workflow, job: string, id: string, cwd: string, o: { stubs?: string; env?: Record<string, string> } = {}): SpawnResult {
  const s = wf.jobs[job]?.steps.find((x) => x.id === id);
  expect(s?.run, `release.yml job ${job} has a bash step with id ${id}`).toBeTypeOf('string');
  expect(s?.shell ?? 'bash', `${job}.${id} runs in bash`).toBe('bash');
  const env: Record<string, string | undefined> = { ...proc.env, ...wf.env, ...wf.jobs[job].env, ...s?.env, VERSION, ...o.env };
  if (o.stubs !== undefined) env.PATH = `${o.stubs}:${proc.env.PATH ?? ''}`;
  const script = path.join(cwd, `.step-${job}-${id}.sh`);
  fs.writeFileSync(script, s?.run as string);
  return cp.spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], { cwd, env, encoding: 'utf8' });
}
const output = (r: SpawnResult): string => r.stdout + r.stderr;

/** A stand-in x86-64 executable: a PE32+ header (Windows) or a 64-bit ELF header (Linux). */
function pe64(): Uint8Array {
  const b = new Uint8Array(512);
  const v = new DataView(b.buffer);
  v.setUint16(0, 0x5a4d, true);
  v.setUint32(0x3c, 0x80, true);
  v.setUint32(0x80, 0x4550, true);
  v.setUint16(0x84, 0x8664, true);
  v.setUint16(0x98, 0x20b, true);
  return b;
}
function elf64(): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  new DataView(b.buffer).setUint16(18, 62, true);
  return b;
}

interface Copies { notice: Copy; provenance: Copy }
const BOTH: Copies = { notice: 'repo', provenance: 'repo' };
/** The cases each check is run on: both files present, then each absent or another text. */
const BROKEN: Array<[string, Copies]> = [
  ['NOTICE absent', { notice: 'absent', provenance: 'repo' }],
  ['NOTICE another text', { notice: 'other', provenance: 'repo' }],
  ['PROVENANCE.md absent', { notice: 'repo', provenance: 'absent' }],
  ['PROVENANCE.md another text', { notice: 'repo', provenance: 'other' }],
];

// macOS: build_installers.sh with its tools stubbed.
const MAC_TOOLS: Record<string, string> = {
  '/usr/libexec/PlistBuddy': `#!/bin/sh\nfor last; do :; done\nawk '/<key>CFBundleExecutable<\\/key>/ { getline; gsub(/.*<string>|<\\/string>.*/, ""); print; found = 1 } END { exit found ? 0 : 1 }' "$last"\n`,
  '/usr/bin/lipo': `#!/bin/sh\ncat "$2"\n`,
  '/usr/bin/codesign': `#!/bin/sh\nexit 0\n`,
  '/usr/bin/hdiutil': `#!/bin/sh\ncat >/dev/null &\ncase "$1" in\n  attach) for last; do :; done; while [ $# -gt 0 ]; do [ "$1" = -mountpoint ] && mnt="$2"; shift; done; tar -xf "$last" -C "$mnt" ;;\n  detach) find "$2" -mindepth 1 -delete ;;\nesac\n`,
};

/** A universal stand-in MolBioCraft.app in `dir` holding the copies given in Contents/Resources. */
function putApp(dir: string, c: Copies): void {
  const app = path.join(dir, 'MolBioCraft.app', 'Contents');
  put(path.join(app, 'Info.plist'), '<plist><dict>\n<key>CFBundleExecutable</key>\n<string>molbiocraft-desktop</string>\n</dict></plist>\n');
  put(path.join(app, 'MacOS', 'molbiocraft-desktop'), 'x86_64 arm64\n', 0o755);
  putCopy(path.join(app, 'Resources'), 'NOTICE', c.notice);
  putCopy(path.join(app, 'Resources'), 'PROVENANCE.md', c.provenance);
}

/** Runs build_installers.sh on a bundle whose .app and whose .dmg's .app hold the copies given. */
function macos(app: Copies, dmgApp: Copies): SpawnResult & { release: string[] } {
  return inTemp('mbc-notice-macos-', (root) => {
    putCheckout(root);
    put(path.join(root, 'src-tauri', 'tauri.conf.json'), text(repo('src-tauri/tauri.conf.json')));
    const made = path.join(root, 'made-bundle');
    putApp(path.join(made, 'macos'), app);
    const dmgRoot = path.join(root, 'dmg-root');
    putApp(dmgRoot, dmgApp);
    tarDir(path.join(made, 'dmg', `MolBioCraft_${VERSION}_universal.dmg`), dmgRoot);
    const stubs = path.join(root, 'stubs');
    const bundleDir = 'src-tauri/target/universal-apple-darwin/release/bundle';
    writeExecutable(path.join(stubs, 'npm'), '#!/bin/sh\nexit 0\n');
    writeExecutable(path.join(stubs, 'npx'), `#!/bin/sh\nmkdir -p ${bundleDir} && cp -R "$MBC_MADE/." ${bundleDir}/\n`);
    let source = text(repo('scripts/build_installers.sh'));
    for (const [abs, body] of Object.entries(MAC_TOOLS)) {
      expect(source.includes(abs), `build_installers.sh calls ${abs}`).toBe(true);
      const stub = path.join(stubs, path.basename(abs));
      writeExecutable(stub, body);
      source = source.split(abs).join(`"${stub}"`);
    }
    const zsh = cp.spawnSync('zsh', ['-c', 'true'], { encoding: 'utf8' }).status === 0;
    if (!zsh) source = source.split('\n').filter((l) => !/^setopt /.test(l)).join('\n');
    put(path.join(root, 'scripts', 'build_installers.sh'), source, 0o755);
    const r = cp.spawnSync(zsh ? 'zsh' : 'bash', [path.join(root, 'scripts', 'build_installers.sh')], {
      cwd: root,
      env: { ...proc.env, PATH: `${stubs}:${proc.env.PATH ?? ''}`, MBC_MADE: made, TMPDIR: root },
      encoding: 'utf8',
    });
    const rel = path.join(root, 'release');
    return { ...r, release: fs.existsSync(rel) ? fs.readdirSync(rel) : [] };
  });
}

// Windows: the self-check of the windows job, on the folder msiexec /a unpacks from the MSI.
function windows(c: Copies): SpawnResult {
  return inTemp('mbc-notice-windows-', (root) => {
    putCheckout(root);
    put(path.join(root, 'release', `MolBioCraft-${VERSION}-Windows-x64-Portable.exe`), pe64());
    put(path.join(root, 'release', `MolBioCraft-${VERSION}-Windows-x64.msi`), 'stand-in msi\n');
    const installDir = path.join(root, 'msi-admin', 'PFiles', 'MolBioCraft');
    put(path.join(installDir, 'molbiocraft-desktop.exe'), pe64());
    putCopy(installDir, 'NOTICE', c.notice);
    putCopy(installDir, 'PROVENANCE.md', c.provenance);
    return runStep(releaseWorkflow(), 'windows', 'self-check', root);
  });
}

// Linux: the self-check of the linux job, on a .deb (a tar archive for the dpkg-deb stub) holding
// the copies given in /usr/lib/MolBioCraft and in /usr/share/doc/molbiocraft.
const DPKG_DEB_STUB = `#!/bin/sh
case "$1" in
  --field) if [ "$3" = Architecture ]; then echo amd64; else echo "stub-$3"; fi ;;
  -c) exec tar -tvf "$2" ;;
  -x) mkdir -p "$3" && exec tar -xf "$2" -C "$3" ;;
  *) exit 2 ;;
esac
`;
function linux(lib: Copies, doc: Copies): SpawnResult {
  return inTemp('mbc-notice-linux-', (root) => {
    putCheckout(root);
    const tree = path.join(root, 'deb-tree');
    put(path.join(tree, 'usr', 'bin', 'molbiocraft-desktop'), elf64());
    for (const [dir, c] of [[path.join(tree, 'usr', 'lib', 'MolBioCraft'), lib], [path.join(tree, 'usr', 'share', 'doc', 'molbiocraft'), doc]] as const) {
      fs.mkdirSync(dir, { recursive: true });
      putCopy(dir, 'NOTICE', c.notice);
      putCopy(dir, 'PROVENANCE.md', c.provenance);
    }
    tarDir(path.join(root, 'src-tauri', 'target', 'x86_64-unknown-linux-gnu', 'release', 'bundle', 'deb', `MolBioCraft_${VERSION}_amd64.deb`), tree);
    fs.rmSync(tree, { recursive: true, force: true });
    const stubs = path.join(root, 'stubs');
    writeExecutable(path.join(stubs, 'dpkg-deb'), DPKG_DEB_STUB);
    return runStep(releaseWorkflow(), 'linux', 'self-check', root, { stubs });
  });
}

it('every installer the build scripts produce carries NOTICE', { timeout: 120_000 }, () => {
  // tauri.conf.json: bundle.resources maps exactly the repo's NOTICE and PROVENANCE.md (the .app's
  // Contents/Resources, the MSI's install folder, the .deb's /usr/lib/MolBioCraft), and
  // bundle.linux.deb.files maps them into /usr/share/doc/molbiocraft of the .deb.
  const srcTauri = repo('src-tauri');
  const bundle = (JSON.parse(text(repo('src-tauri/tauri.conf.json'))) as { bundle?: { resources?: unknown; linux?: { deb?: { files?: unknown } } } }).bundle;
  const resources = bundle?.resources;
  expect(resources !== null && typeof resources === 'object' && !Array.isArray(resources), 'bundle.resources is a map of source to target').toBe(true);
  const entries = Object.entries(resources as Record<string, unknown>);
  const sourcesOf = (target: string): string[] => entries.filter(([, to]) => to === target).map(([from]) => path.resolve(srcTauri, from));
  expect(sourcesOf('NOTICE'), 'the source Tauri bundles as NOTICE').toEqual([NOTICE]);
  expect(sourcesOf('PROVENANCE.md'), 'the source Tauri bundles as PROVENANCE.md').toEqual([PROVENANCE]);
  expect(entries.map(([from]) => from).filter((from) => !fs.existsSync(path.resolve(srcTauri, from))), 'bundle.resources sources that do not exist').toEqual([]);
  const debFiles = bundle?.linux?.deb?.files as Record<string, string> | undefined;
  expect(
    Object.fromEntries(Object.entries(debFiles ?? {}).map(([to, from]) => [to, path.resolve(srcTauri, from)])),
    'bundle.linux.deb.files: the .deb path each repo file is installed at'
  ).toEqual({ '/usr/share/doc/molbiocraft/NOTICE': NOTICE, '/usr/share/doc/molbiocraft/PROVENANCE.md': PROVENANCE });

  // The release assets: the checksums step stages the checkout's NOTICE and PROVENANCE.md as
  // NOTICE.txt and PROVENANCE.md, uploads both, and the publish step attaches both.
  const wf = releaseWorkflow();
  const publish = wf.jobs.publish.steps.find((s) => s.uses === 'softprops/action-gh-release@v2');
  const attached = String(publish?.with?.files ?? '').split('\n').map((l) => l.trim());
  expect(attached, 'the release assets').toEqual(expect.arrayContaining(['assets/NOTICE.txt', 'assets/PROVENANCE.md']));
  const uploaded = wf.jobs.checksums.steps.filter((s) => s.uses === 'actions/upload-artifact@v4').map((s) => s.with?.path);
  expect(uploaded, 'the artifacts the checksums job uploads').toEqual(expect.arrayContaining(['release/NOTICE.txt', 'release/PROVENANCE.md']));

  if (proc.platform === 'win32') {
    console.warn('skipped on win32: build_installers.sh and the bash steps of release.yml need a POSIX shell; the macOS and Linux CI runs run them');
    return;
  }

  const staged = inTemp('mbc-notice-assets-', (root) => {
    putCheckout(root);
    for (const n of [`MolBioCraft-${VERSION}-macOS-universal.dmg`, `MolBioCraft-${VERSION}-Windows-x64.msi`, `MolBioCraft-${VERSION}-Windows-x64-Portable.exe`, `MolBioCraft-${VERSION}-Linux-x86_64.deb`]) {
      put(path.join(root, 'release', n), `stand-in ${n}\n`);
    }
    const r = runStep(wf, 'checksums', 'checksums', root);
    expect(r.status, output(r)).toBe(0);
    return { notice: sha256(path.join(root, 'release', 'NOTICE.txt')), provenance: sha256(path.join(root, 'release', 'PROVENANCE.md')) };
  });
  expect(staged, 'NOTICE.txt and PROVENANCE.md published beside the installers').toEqual({ notice: sha256(NOTICE), provenance: sha256(PROVENANCE) });

  // macOS: the .app's Contents/Resources, in the built bundle and in the .dmg.
  const mac = macos(BOTH, BOTH);
  expect(mac.status, output(mac)).toBe(0);
  expect(mac.release).toEqual([`MolBioCraft-${VERSION}-macOS-universal.dmg`]);
  for (const [what, c] of BROKEN) {
    const file = c.notice !== 'repo' ? 'NOTICE' : 'PROVENANCE.md';
    const why = (c.notice === 'absent' || c.provenance === 'absent') ? 'is missing' : `differs from this checkout's ${file}`;
    const built = macos(c, BOTH);
    expect(built.status, `.app with ${what}`).not.toBe(0);
    expect(output(built)).toContain(`MolBioCraft.app/Contents/Resources/${file} ${why}`);
    expect(built.release, `nothing reaches release/ for a .app with ${what}`).toEqual([]);
    const imaged = macos(BOTH, c);
    expect(imaged.status, `.dmg whose .app has ${what}`).not.toBe(0);
    expect(output(imaged)).toContain(`the MolBioCraft.app in src-tauri/target/universal-apple-darwin/release/bundle/dmg/MolBioCraft_${VERSION}_universal.dmg fails the check above`);
  }

  // Windows: beside the exe the MSI installs.
  const win = windows(BOTH);
  expect(win.status, output(win)).toBe(0);
  expect(output(win)).toContain('with NOTICE and PROVENANCE.md beside it');
  for (const [what, c] of BROKEN) {
    const file = c.notice !== 'repo' ? 'NOTICE' : 'PROVENANCE.md';
    const r = windows(c);
    expect(r.status, `MSI with ${what}`).not.toBe(0);
    expect(output(r)).toContain(c.notice === 'absent' || c.provenance === 'absent' ? `the MSI installs no ${file} beside` : `the ${file} the MSI installs`);
  }

  // Linux: /usr/lib/MolBioCraft and /usr/share/doc/molbiocraft of the .deb.
  const deb = linux(BOTH, BOTH);
  expect(deb.status, output(deb)).toBe(0);
  for (const [what, c] of BROKEN) {
    const file = c.notice !== 'repo' ? 'NOTICE' : 'PROVENANCE.md';
    for (const [dir, r] of [['usr/lib/MolBioCraft', linux(c, BOTH)], ['usr/share/doc/molbiocraft', linux(BOTH, c)]] as const) {
      expect(r.status, `.deb with ${what} in /${dir}`).not.toBe(0);
      expect(output(r)).toContain(c.notice === 'absent' || c.provenance === 'absent' ? `lists no ${dir}/${file}` : `/${dir}/${file} in release/MolBioCraft-${VERSION}-Linux-x86_64.deb differs from this checkout's ${file}`);
    }
  }
});

const RAMA_SCRIPT = repo('scripts/outside-data/derive_ramachandran_maps.py');
const BACKBONE = repo('crates/molbiocraft-protein/src/backbone.rs');

// Writes the six grids into argv[3] so that each 10-degree cell derives the class the committed
// map in argv[2] gives it: all 25 nodes favoured (0.5), allowed (0.01, above every allowed cutoff
// and below the favoured one) or absent (0, an outlier).
const MAKE_GRIDS = `
import importlib.util, os, sys
script, maps, out = sys.argv[1:4]
spec = importlib.util.spec_from_file_location('derive_ramachandran_maps', script)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
committed = mod.committed_maps(maps)
value = {'#': '0.5', '+': '0.01'}
for const, (name, _, _) in mod.GRIDS.items():
    rows = committed[const][0]
    lines = ['# Number of dimensions: 2', '#   x1: -180.0 180.0 180 true', '#   x2: -180.0 180.0 180 true']
    for r in range(36):
        psis = [p for p in mod.NODES if 170 - 10 * r <= p < 180 - 10 * r]
        for c in range(36):
            phis = [p for p in mod.NODES if -180 + 10 * c <= p < -170 + 10 * c]
            if rows[r][c] in value:
                lines += [f'{f}.0 {s}.0 {value[rows[r][c]]}' for f in phis for s in psis]
    with open(os.path.join(out, name), 'w') as fh:
        fh.write('\\n'.join(lines) + '\\n')
`;

// The real derivation script, run on the fixture grids: its SHA-256 pins become the fixtures' own
// digests, any download raises, and it prints the MOLBIOCRAFT_REQUIRE_TEST_DATA it was given.
const wrapper = (grids: string): string => `
import hashlib, importlib.util, os, sys, urllib.request
spec = importlib.util.spec_from_file_location('derive_ramachandran_maps', ${JSON.stringify(RAMA_SCRIPT)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
def offline(*args, **kwargs):
    raise OSError('the test allows no download')
urllib.request.urlopen = offline
for const, (name, allowed, _) in list(mod.GRIDS.items()):
    with open(os.path.join(${JSON.stringify(grids)}, name), 'rb') as fh:
        mod.GRIDS[const] = (name, allowed, hashlib.sha256(fh.read()).hexdigest())
print('MOLBIOCRAFT_REQUIRE_TEST_DATA=' + os.environ.get('MOLBIOCRAFT_REQUIRE_TEST_DATA', '(unset)'), file=sys.stderr)
mod.main()
`;

/** backbone.rs with one cell of GENERAL_REGIONS (row 0, column 0) changed, and that cell's two classes. */
function flipOneCell(): { text: string; committed: string; derived: string } {
  const src = text(BACKBONE);
  const at = src.indexOf('"', src.indexOf('pub const GENERAL_REGIONS: [&str; 36] = ['));
  expect(at, 'GENERAL_REGIONS in backbone.rs').toBeGreaterThan(0);
  const derived = src[at + 1];
  const committed = derived === '#' ? '.' : '#';
  return { text: src.slice(0, at + 1) + committed + src.slice(at + 2), committed, derived };
}

const CHECK = repo('scripts/check_reference_suite.mjs');

/** The check's LOCAL_ONLY tests, read from its source: the Vitest stub must report each by name. */
const LOCAL_ONLY = [...(/\nconst LOCAL_ONLY = \[([\s\S]*?)\n\];/.exec(text(CHECK))?.[1] ?? '').matchAll(/file: '([^']+)',\s*test: '([^']+)',\s*data: '([^']+)',\s*needs: '([^']+)'/g)].map((m) => ({
  file: m[1],
  test: m[2],
  data: m[3],
  needs: m[4],
}));

// Stands in for node_modules/vitest/vitest.mjs. It logs its arguments and the
// MOLBIOCRAFT_REQUIRE_TEST_DATA it was given, and writes a JSON report in which each test file it
// was asked to run (the files named, else every test file under --dir but the --exclude ones)
// passed one test, plus the local-only tests of that file by name. A local-only test whose folder
// is absent from MOLBIOCRAFT_TEST_DATA_DIR is skipped instead, as its it.skipIf skips it, and the
// resolver's skip line naming that folder is printed and handed to the check's console reporter
// (the --reporter that is neither default nor json), as Vitest hands it the real one. A folder
// that exists passes the test whatever it holds, as the resolver lets the real test run and its
// walk of an empty folder passes. With REFERENCE_STUB_VACUOUS=1 it reports them passed even while
// the folder is absent, as a test that ran without its data.
const VITEST_STUB = `
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.REFERENCE_STUB_LOG, JSON.stringify({ tool: 'vitest', args, require: process.env.MOLBIOCRAFT_REQUIRE_TEST_DATA }) + '\\n');
const after = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const named = args.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--dir' && all[i - 1] !== '--exclude');
const excluded = after('--exclude').map((p) => path.basename(p));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\\.(test|spec)\\.[cm]?[jt]sx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = named.length ? named.map((f) => path.resolve(f)) : walk(after('--dir')[0]).filter((f) => !excluded.includes(path.basename(f)));
const titles = JSON.parse(process.env.REFERENCE_STUB_TITLES);
const folders = JSON.parse(process.env.REFERENCE_STUB_DATA);
const dataDir = path.resolve(process.env.MOLBIOCRAFT_TEST_DATA_DIR || 'test-data');
const rel = (f) => path.relative(fs.realpathSync('.'), fs.realpathSync(f)).split(path.sep).join('/');
const skipLines = [];
const outcome = (title) => {
  if (!(title in folders) || fs.existsSync(path.join(dataDir, folders[title])) || process.env.REFERENCE_STUB_VACUOUS === '1') return 'passed';
  skipLines.push('skipped: reference data absent (' + path.join(dataDir, folders[title]) + ')');
  return 'skipped';
};
const testResults = files.map((f) => ({
  name: f,
  status: 'passed',
  message: '',
  assertionResults: ['stub', ...(titles[rel(f)] ?? [])].map((title) => ({ title, fullName: title, status: outcome(title) })),
}));
const all = testResults.flatMap((t) => t.assertionResults);
const passed = all.filter((t) => t.status === 'passed').length;
if (skipLines.length) {
  const reporter = args.map((a) => (a.startsWith('--reporter=') ? a.slice('--reporter='.length) : '')).find((r) => r && r !== 'default' && r !== 'json');
  const Reporter = (await import(pathToFileURL(reporter).href)).default;
  const r = new Reporter();
  r.onInit({ state: { idMap: new Map() } });
  for (const line of skipLines) {
    console.error(line);
    r.onUserConsoleLog({ content: line });
  }
}
const out = args.find((a) => a.startsWith('--outputFile.json=')).slice('--outputFile.json='.length);
fs.writeFileSync(out, JSON.stringify({ success: true, numFailedTestSuites: 0, numPassedTests: passed, numFailedTests: 0, numPendingTests: all.length - passed, numTodoTests: 0, testResults }));
console.log('vitest stub: ' + files.length + ' test files passed');
`;

// Stands in for cargo: logs its arguments and MOLBIOCRAFT_REQUIRE_TEST_DATA, and prints one test
// target in which one test passed.
const CARGO_STUB = `
import fs from 'node:fs';
fs.appendFileSync(process.env.REFERENCE_STUB_LOG, JSON.stringify({ tool: 'cargo', args: process.argv.slice(2), require: process.env.MOLBIOCRAFT_REQUIRE_TEST_DATA }) + '\\n');
console.log(['     Running unittests src/lib.rs (target/debug/deps/reference_stub-0123456789abcdef)', '', 'running 1 test', 'test stub ... ok', '', 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s'].join('\\n'));
`;

interface StubRun { tool: string; args: string[]; require?: string }

/** The check's last lines: its PASS line, or its FAIL line and one line per reason. */
const verdict = (stdout: string): string => stdout.slice(stdout.lastIndexOf('\nreference suite'));

it('the reference check runs the Ramachandran derivation and fails on drift', { timeout: 180_000 }, () => {
  inTemp('mbc-notice-rama-', (dir) => {
    const grids = path.join(dir, 'grids');
    fs.mkdirSync(grids);
    const made = cp.spawnSync(python(), ['-I', '-c', MAKE_GRIDS, RAMA_SCRIPT, BACKBONE, grids], { encoding: 'utf8' });
    expect(made.status, `making the fixture grids failed:\n${made.stderr}`).toBe(0);
    const pinned = path.join(dir, 'pinned_to_fixtures.py');
    fs.writeFileSync(pinned, wrapper(grids));
    const flip = flipOneCell();
    const drifted = path.join(dir, 'backbone.rs');
    fs.writeFileSync(drifted, flip.text);
    const silent = path.join(dir, 'silent.py');
    fs.writeFileSync(silent, 'pass\n');
    const vitestStub = path.join(dir, 'vitest-stub.mjs');
    fs.writeFileSync(vitestStub, VITEST_STUB);
    const cargoStub = path.join(dir, 'cargo-stub.mjs');
    fs.writeFileSync(cargoStub, CARGO_STUB);
    const log = path.join(dir, 'stub-runs.jsonl');

    // Each run starts from this environment without the MOLBIOCRAFT_REFERENCE_* variables (a check
    // run around this test may set them), plus what the stubs read.
    const titles: Record<string, string[]> = {};
    for (const t of LOCAL_ONLY) (titles[t.file] ??= []).push(t.test);
    const base = {
      ...Object.fromEntries(Object.entries(proc.env).filter(([k]) => !k.startsWith('MOLBIOCRAFT_REFERENCE_'))),
      REFERENCE_STUB_LOG: log,
      REFERENCE_STUB_TITLES: JSON.stringify(titles),
      REFERENCE_STUB_DATA: JSON.stringify(Object.fromEntries(LOCAL_ONLY.map((t) => [t.test, t.data]))),
    };
    const check = (args: string[], env: Record<string, string>): SpawnResult & { ran: StubRun[] } => {
      fs.rmSync(log, { recursive: false, force: true });
      const r = cp.spawnSync(proc.execPath, [CHECK, ...args], { cwd: REPO, env: { ...base, ...env }, encoding: 'utf8' });
      const ran = fs.existsSync(log) ? text(log).split('\n').filter(Boolean).map((l) => JSON.parse(l) as StubRun) : [];
      return { ...r, ran };
    };
    const stubs = {
      MOLBIOCRAFT_REFERENCE_VITEST: vitestStub,
      MOLBIOCRAFT_REFERENCE_CARGO: `"${proc.execPath}" "${cargoStub}"`,
      MOLBIOCRAFT_REFERENCE_RAMA_SCRIPT: pinned,
      MOLBIOCRAFT_REFERENCE_RAMA_GRIDS: grids,
    };

    // The interpreter the check runs by default is python3 from PATH. On Windows, where Python 3
    // may be on PATH only as `python` and no workflow runs the check, that one is named instead.
    const defaultPython: Record<string, string> = {};
    if (PYTHON !== 'python3' && proc.platform === 'win32') {
      console.warn(`python3 is not on PATH here (win32), so the check's default interpreter is replaced by ${python()}; the macOS and Linux CI runs check the default`);
      defaultPython.MOLBIOCRAFT_REFERENCE_PYTHON = python();
    } else {
      expect(PYTHON, 'python3 on PATH, the interpreter the check runs by default').toBe('python3');
    }
    const interpreter = defaultPython.MOLBIOCRAFT_REFERENCE_PYTHON ?? 'python3';

    // As nightly.yml and release.yml run it: no options, and their environment.
    const workflow = { MOLBIOCRAFT_REQUIRE_TEST_DATA: '1', MOLBIOCRAFT_TEST_DATA_DIR: 'test-data', ...stubs, ...defaultPython };
    const clean = check([], workflow);
    expect(verdict(clean.stdout), clean.stdout + clean.stderr).toBe('\nreference suite: PASS\n');
    expect(clean.status).toBe(0);
    // Every step ran: the src-tauri scan, the two Vitest runs (the local-only files on their own,
    // with the data not required), cargo, and the derivation on the committed maps.
    expect(clean.stdout).toMatch(/^== src-tauri: [1-9]\d* Rust sources read, 0 name the reference data$/m);
    expect(clean.ran.map((x) => [x.tool, x.require]), 'what the check ran, and the MOLBIOCRAFT_REQUIRE_TEST_DATA each saw').toEqual([
      ['vitest', '1'],
      ...(LOCAL_ONLY.length ? [['vitest', '0']] : []),
      ['cargo', '1'],
    ]);
    expect(clean.ran[0].args.slice(0, 3), 'the main Vitest run').toEqual(['run', '--dir', repo('src/__tests__')]);
    expect(clean.ran[clean.ran.length - 1].args, 'the cargo run').toEqual(['test', '--workspace', '--no-fail-fast', '--', '--include-ignored']);
    expect(clean.stdout, 'the derivation, run by the default interpreter').toContain(`\n== ${interpreter} -I ${pinned} --fetch ${grids} --check crates/molbiocraft-protein/src/backbone.rs\n`);
    expect(clean.stdout).toContain('ramachandran totals: 7776 cells checked; 0 differ; 0 doc comment mismatches');

    // The same command on maps with one cell drifted from the derivation: the step names the cell,
    // every other step still runs and passes, and the check fails for that one reason.
    const drift = check([], { ...workflow, MOLBIOCRAFT_REFERENCE_RAMA_MAPS: drifted });
    expect(drift.status, drift.stdout + drift.stderr).toBe(1);
    expect(drift.stdout).toContain(`GENERAL_REGIONS row 0 (psi 170..180) column 0 (phi -180..-170): committed '${flip.committed}', derived '${flip.derived}'`);
    expect(verdict(drift.stdout)).toBe(
      `\nreference suite: FAIL\n  - ramachandran derivation (${pinned}): 1 of 7776 cells of ${drifted} differ from the derivation and 0 doc comments mismatch (each is listed above)\n`
    );
    expect(drift.ran.map((x) => x.tool)).toEqual(clean.ran.map((x) => x.tool));

    // The local-only tests (BG-01M6QFHR), on a data folder without and with their folders, so both
    // cases run wherever the test does: each skips while its folder is absent and passes while it
    // holds a file of the kind it reads (here in a subfolder, its ending in upper case), and a pass
    // while its folder is absent, a test that ran without its data, fails.
    expect(LOCAL_ONLY.length, 'the local-only tests read from the check').toBeGreaterThan(0);
    const absentData = path.join(dir, 'data-absent');
    const presentData = path.join(dir, 'data-present');
    fs.mkdirSync(absentData);
    for (const t of LOCAL_ONLY) {
      fs.mkdirSync(path.join(presentData, t.data, 'plate 1'), { recursive: true });
      fs.writeFileSync(path.join(presentData, t.data, 'plate 1', `run01${t.needs.toUpperCase()}`), 'stand-in run\n');
    }
    for (const [data, outcome] of [[absentData, 'skipped, %s/ is absent'], [presentData, 'passed, %s/ is present']]) {
      const r = check(['--only', 'vitest'], { ...workflow, MOLBIOCRAFT_TEST_DATA_DIR: data });
      expect(verdict(r.stdout), r.stdout + r.stderr).toBe('\nreference suite (only vitest): PASS\n');
      for (const t of LOCAL_ONLY) expect(r.stdout).toContain(`\nlocal-only (private data not in CI): ${t.file} > ${t.test}: ${outcome.replace('%s', t.data)}\n`);
    }
    const vacuous = check(['--only', 'vitest'], { ...workflow, MOLBIOCRAFT_TEST_DATA_DIR: absentData, REFERENCE_STUB_VACUOUS: '1' });
    expect(vacuous.status, vacuous.stdout + vacuous.stderr).toBe(1);
    for (const t of LOCAL_ONLY) expect(vacuous.stdout).toContain(`\nlocal-only (private data not in CI): ${t.file} > ${t.test}: passed, ${t.data}/ is absent (see the reasons below)\n`);
    expect(verdict(vacuous.stdout)).toBe(
      `\nreference suite (only vitest): FAIL\n${LOCAL_ONLY.map((t) => `  - vitest local-only ${t.file} > ${t.test}: passed while ${t.data}/ is absent, so it ran without its data; while the folder is absent it must skip, with it.skipIf(!haveTestData(<folder>))\n`).join('')}`
    );

    // A folder that exists but holds no file the test reads: the resolver lets the test run, its
    // walk finds nothing and it passes, so the check fails it as a test that ran without its data.
    // Once with nothing in the folder, once with only other files: one whose name has the ending
    // inside it but not at its end, another file, and an empty subfolder.
    const bareData = path.join(dir, 'data-bare');
    const otherData = path.join(dir, 'data-other');
    for (const t of LOCAL_ONLY) {
      fs.mkdirSync(path.join(bareData, t.data), { recursive: true });
      fs.mkdirSync(path.join(otherData, t.data, 'plate 1'), { recursive: true });
      fs.mkdirSync(path.join(otherData, t.data, 'plate 2'));
      fs.writeFileSync(path.join(otherData, t.data, 'plate 1', `run01${t.needs}.bak`), 'not a run\n');
      fs.writeFileSync(path.join(otherData, t.data, 'notes.txt'), 'not a run\n');
    }
    for (const data of [bareData, otherData]) {
      const empty = check(['--only', 'vitest'], { ...workflow, MOLBIOCRAFT_TEST_DATA_DIR: data });
      expect(empty.status, empty.stdout + empty.stderr).toBe(1);
      for (const t of LOCAL_ONLY) expect(empty.stdout).toContain(`\nlocal-only (private data not in CI): ${t.file} > ${t.test}: passed, ${t.data}/ holds no ${t.needs} file (see the reasons below)\n`);
      expect(verdict(empty.stdout), data).toBe(
        `\nreference suite (only vitest): FAIL\n${LOCAL_ONLY.map((t) => `  - vitest local-only ${t.file} > ${t.test}: passed while ${t.data}/ holds no ${t.needs} file, so it ran without its data; put its ${t.needs} files in the folder, or remove the folder so that the test skips\n`).join('')}`
      );
    }

    // --only ramachandran runs that step alone and says so, by the interpreter named (by its full
    // path, so it differs from the default). The caller asks for the data not to be required, which
    // the check overrides.
    const executable = cp.spawnSync(python(), ['-I', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
    expect(path.resolve(executable), 'the full path of the Python 3 on PATH').toBe(executable);
    const only = (env: Record<string, string>): SpawnResult & { ran: StubRun[] } =>
      check(['--only', 'ramachandran'], { MOLBIOCRAFT_REQUIRE_TEST_DATA: '0', ...stubs, MOLBIOCRAFT_REFERENCE_PYTHON: executable, ...env });
    const alone = only({});
    expect(verdict(alone.stdout), alone.stdout + alone.stderr).toBe('\nreference suite (only ramachandran): PASS\n');
    expect(alone.status).toBe(0);
    expect(alone.stdout, 'the derivation, run by the interpreter named').toContain(`\n== ${executable} -I ${pinned} --fetch ${grids} --check crates/molbiocraft-protein/src/backbone.rs\n`);
    expect(alone.stdout).toContain('ramachandran totals: 7776 cells checked; 0 differ; 0 doc comment mismatches');
    expect(alone.stderr, 'the REQUIRE flag the derivation ran with').toContain('MOLBIOCRAFT_REQUIRE_TEST_DATA=1');
    expect(alone.ran, 'Vitest and cargo did not run').toEqual([]);
    expect(alone.stdout, 'only the Ramachandran step ran').not.toMatch(/^== (src-tauri|vitest|cargo)/m);

    // The real script (an empty override keeps the default) on grids that are not the pinned
    // files: its SHA-256 check fails it.
    const unpinned = only({ MOLBIOCRAFT_REFERENCE_RAMA_SCRIPT: '' });
    expect(unpinned.status, unpinned.stdout + unpinned.stderr).toBe(1);
    expect(verdict(unpinned.stdout)).toMatch(
      /^\nreference suite \(only ramachandran\): FAIL\n {2}- ramachandran derivation \(scripts\/outside-data\/derive_ramachandran_maps\.py\) exited with code 1 \(derive_ramachandran_maps: .*rama8000-[A-Za-z-]+\.data: SHA-256 [0-9a-f]{64}, expected [0-9a-f]{64} \(the file at [0-9a-f]{40}\)\)\n$/
    );

    // A derivation that checks nothing and exits 0 does not pass.
    const nothing = only({ MOLBIOCRAFT_REFERENCE_RAMA_SCRIPT: silent });
    expect(nothing.status).toBe(1);
    expect(nothing.stdout).toContain(`ramachandran derivation (${silent}) printed no 'total:' line, so it checked nothing`);

    // A misspelt step runs nothing and is refused.
    const typo = check(['--only', 'ramachandrn'], stubs);
    expect(typo.status).toBe(2);
    expect(typo.stderr).toContain("--only: unknown step 'ramachandrn'");
    expect(typo.ran).toEqual([]);
  });
});

// Stands in for cargo as the release and nightly jobs run it, whose environment sets
// CARGO_TERM_COLOR=always (BG-01M6V3SC). Cargo writes its own status lines to stderr: with
// CARGO_TERM_COLOR=always it wraps the status word in the codes release run 42376014227 logged,
// ESC[1m ESC[92m `     Running` ESC[0m, and to a pipe it otherwise writes it plain. Each test
// binary's results go to stdout, uncoloured, as libtest writes them to a pipe. The stub runs one
// unit-test target holding the test `stub`, which passes; with REFERENCE_STUB_FAIL=<name> that
// target also runs the test <name>, which fails, and the stub exits 101 as cargo does. With
// REFERENCE_STUB_DOCTESTS=1 a doc-test target with one passing test follows. Each write is
// synchronous, so the lines reach the check in the order the stub writes them.
const COLOURED_CARGO_STUB = `
import fs from 'node:fs';
const always = process.env.CARGO_TERM_COLOR === 'always';
const status = (word, rest) => fs.writeSync(2, (always ? '\\x1b[1m\\x1b[92m' + word + '\\x1b[0m' : word) + ' ' + rest + '\\n');
const results = (lines) => fs.writeSync(1, lines.join('\\n') + '\\n');
const failing = process.env.REFERENCE_STUB_FAIL || null;
status('     Running', 'unittests src/lib.rs (target/debug/deps/reference_stub-0123456789abcdef)');
results([
  '', 'running ' + (failing ? 2 : 1) + ' test' + (failing ? 's' : ''), 'test stub ... ok',
  ...(failing ? ['test ' + failing + ' ... FAILED', '', 'failures:', '', '---- ' + failing + ' stdout ----', "thread '" + failing + "' panicked at src/lib.rs:1:1:", 'stand-in failure', '', 'failures:', '    ' + failing] : []),
  '', 'test result: ' + (failing ? 'FAILED. 1 passed; 1 failed' : 'ok. 1 passed; 0 failed') + '; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s', '',
]);
if (failing) fs.writeSync(2, (always ? '\\x1b[1m\\x1b[91merror\\x1b[0m\\x1b[1m:\\x1b[0m' : 'error:') + ' test failed, to rerun pass \`--lib\`\\n');
if (process.env.REFERENCE_STUB_DOCTESTS === '1') {
  status('   Doc-tests', 'reference_stub');
  results(['', 'running 1 test', 'test src/lib.rs - stub (line 1) ... ok', '', 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s', '']);
}
process.exitCode = failing ? 101 : 0;
`;

it("counts cargo's test targets from coloured output", { timeout: 60_000 }, () => {
  inTemp('mbc-cargo-colour-', (dir) => {
    const stub = path.join(dir, 'cargo-stub.mjs');
    fs.writeFileSync(stub, COLOURED_CARGO_STUB);
    const base = Object.fromEntries(Object.entries(proc.env).filter(([k]) => !k.startsWith('MOLBIOCRAFT_REFERENCE_') && !k.startsWith('REFERENCE_STUB_') && k !== 'CARGO_TERM_COLOR'));
    const cargo = (env: Record<string, string>): SpawnResult =>
      cp.spawnSync(proc.execPath, [CHECK, '--only', 'cargo'], { cwd: REPO, env: { ...base, MOLBIOCRAFT_REFERENCE_CARGO: `"${proc.execPath}" "${stub}"`, ...env }, encoding: 'utf8' });
    const ESC = '\u001b';
    const colouredRunning = `${ESC}[1m${ESC}[92m     Running${ESC}[0m unittests src/lib.rs (`;

    // The target cargo ran, its Running line coloured as the release run logged it: one target, one
    // test passed, and the check passes. The check echoes cargo's output, so the line it read is shown
    // to carry the codes.
    const coloured = cargo({ CARGO_TERM_COLOR: 'always' });
    expect(coloured.stdout, 'the stub wrote the coloured Running line').toContain(colouredRunning);
    expect(verdict(coloured.stdout), coloured.stdout + coloured.stderr).toBe('\nreference suite (only cargo): PASS\n');
    expect(coloured.stdout).toContain('\ncargo totals: 1 test targets; 1 passed\n');
    expect(coloured.status).toBe(0);

    // Uncoloured, as cargo writes to a pipe by default: the same totals and verdict.
    const plain = cargo({ CARGO_TERM_COLOR: 'never' });
    expect(plain.stdout).not.toContain(ESC);
    expect(verdict(plain.stdout), plain.stdout + plain.stderr).toBe('\nreference suite (only cargo): PASS\n');
    expect(plain.stdout).toContain('\ncargo totals: 1 test targets; 1 passed\n');

    // The coloured Doc-tests line opens a target too: two targets, two passed.
    const doc = cargo({ CARGO_TERM_COLOR: 'always', REFERENCE_STUB_DOCTESTS: '1' });
    expect(doc.stdout, 'the stub wrote the coloured Doc-tests line').toContain(`${ESC}[1m${ESC}[92m   Doc-tests${ESC}[0m reference_stub\n`);
    expect(verdict(doc.stdout), doc.stdout + doc.stderr).toBe('\nreference suite (only cargo): PASS\n');
    expect(doc.stdout).toContain('\ncargo totals: 2 test targets; 2 passed\n');

    // The same coloured stub with one failed test: the check fails and names the target and the test.
    const failed = cargo({ CARGO_TERM_COLOR: 'always', REFERENCE_STUB_FAIL: 'colour::stub_fails' });
    expect(failed.stdout, 'the stub wrote the coloured Running line').toContain(colouredRunning);
    expect(failed.status, failed.stdout + failed.stderr).toBe(1);
    expect(failed.stdout).toContain('\ncargo totals: 1 test targets; 1 passed\n');
    expect(verdict(failed.stdout)).toBe(
      '\nreference suite (only cargo): FAIL\n  - cargo test exited with code 101\n  - cargo reference_stub (src/lib.rs): test colour::stub_fails FAILED\n'
    );
  });
});

it('states CC BY-NC 4.0 across LICENSE, NOTICE, PROVENANCE.md and build manifests, and retains third-party MPL-2.0 and MIT attributions', () => {
  const licenseText = text(repo('LICENSE'));
  expect(licenseText).toContain('Creative Commons Attribution-NonCommercial 4.0 International');
  expect(licenseText).toContain('Copyright (c) 2026 Bundit Boonyarit (@manbaritone)');
  expect(licenseText).not.toContain('Apache License');

  const pkg = JSON.parse(text(repo('package.json'))) as { license: string };
  expect(pkg.license).toBe('CC-BY-NC-4.0');
  expect(text(repo('Cargo.toml'))).toMatch(/^license = "CC-BY-NC-4.0"$/m);
  expect(text(repo('src-tauri/Cargo.toml'))).toMatch(/^license = "CC-BY-NC-4.0"$/m);
  expect(text(repo('CITATION.cff'))).toMatch(/^license: "CC-BY-NC-4.0"$/m);
  expect(text(repo('README.md'))).toContain('CC BY-NC 4.0');
  expect(text(repo('PRODUCT.md'))).toContain('CC BY-NC 4.0');
  expect(text(repo('CONTRIBUTING.md'))).toContain('CC BY-NC 4.0');
  if (fs.existsSync(repo('AGENTS.md'))) {
    expect(text(repo('AGENTS.md'))).toContain('CC-BY-NC-4.0 SPDX header');
  }

  expect(NOTICE_TEXT).toContain('CC BY-NC 4.0');
  expect(PROVENANCE_TEXT).toContain('CC BY-NC 4.0');
  expect(PROVENANCE_TEXT).not.toContain('Apache License, Version 2.0 (`SPDX-License-Identifier: ' + 'Apache-2.0`)');
  expect(PROVENANCE_TEXT).not.toContain('compatible with `Apache-2.0`');

  for (const [crate, sourceUrl] of [
    ['cssparser', 'https://github.com/servo/rust-cssparser'],
    ['cssparser-macros', 'https://github.com/servo/rust-cssparser'],
    ['selectors', 'https://github.com/servo/stylo'],
    ['dtoa-short', 'https://github.com/upsuper/dtoa-short'],
    ['option-ext', 'https://github.com/soc/option-ext'],
    ['r-efi', 'https://github.com/r-efi/r-efi'],
  ] as const) {
    expect(NOTICE_TEXT, `NOTICE lists ${crate}`).toContain(crate);
    expect(NOTICE_TEXT, `NOTICE lists source URL for ${crate}`).toContain(sourceUrl);
    expect(PROVENANCE_TEXT, `PROVENANCE.md lists ${crate}`).toContain(crate);
  }
  expect(NOTICE_TEXT).toMatch(/r-efi[\s\S]*?taken under MIT/);
});
