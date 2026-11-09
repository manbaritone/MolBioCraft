// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The release packaging (US01M6TK7V, D0071): the four installers, each built by the Tauri bundler on
 * its own OS runner, self-checked for its architecture, uploaded as workflow artifacts and published
 * only for a pushed v* tag.
 *
 * - The tauri.conf.json strings that Tauri's WiX template writes into the MSI source unescaped must
 *   hold no & < > or " (BG01M6V9Q0, D0079).
 * - tauri.conf.json is read as JSON. release.yml is read as YAML by Ruby's Psych (`ruby -ryaml`),
 *   which every GitHub runner image and macOS carry, so the test works offline; without Ruby it
 *   fails and says so.
 * - The bash steps of release.yml that stage and check the Windows and Linux packages and write
 *   SHA256SUMS.txt are run as GitHub runs a bash step (`bash -eo pipefail`), in a throwaway folder
 *   holding the files the bundler would have written: stand-in executables carrying a real PE or
 *   ELF header, and a .deb that a dpkg-deb stub reads as a tar archive. Each check must pass on
 *   x86-64 files and fail, naming the problem, on an arm64 one.
 * - scripts/build_installers.sh is run whole with stubs for npm and npx (the Tauri CLI) and for the
 *   macOS tools it calls by absolute path (PlistBuddy, lipo, codesign, hdiutil): the npx stub writes
 *   the bundle a universal build writes, and the lipo stub reports the slices the stand-in binary
 *   names. It must build the universal .app and .dmg, write only release/MolBioCraft-<v>-macOS-
 *   universal.dmg, and fail unless lipo lists both arm64 and x86_64.
 * The scripts need a POSIX shell, so on Windows they are not run, with a line saying so (the macOS
 * and Linux CI runs run them); the rest of each test runs everywhere.
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
}
interface NodeOs { tmpdir: () => string }
interface NodeUrl { fileURLToPath: (u: string) => string }
interface SpawnResult { status: number | null; stdout: string; stderr: string; error?: Error }
interface NodeChildProcess {
  spawnSync: (cmd: string, args: string[], o: { cwd?: string; env?: Record<string, string | undefined>; encoding: 'utf8'; input?: string }) => SpawnResult;
}
interface NodeCrypto { createHash: (algorithm: string) => { update: (data: Uint8Array) => { digest: (enc: 'hex') => string } } }
interface NodeProcess { platform: string; env: Record<string, string | undefined> }

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
const sha256 = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const TAURI_CLI = '@tauri-apps/cli@2.12.4';
const VERSION = (JSON.parse(text(repo('src-tauri/tauri.conf.json'))) as { version: string }).version;
const INSTALLERS = (v: string): string[] => [
  `MolBioCraft-${v}-macOS-universal.dmg`,
  `MolBioCraft-${v}-Windows-x64.msi`,
  `MolBioCraft-${v}-Windows-x64-Portable.exe`,
  `MolBioCraft-${v}-Linux-x86_64.deb`,
];
const POSIX = proc.platform !== 'win32';
const skipLine = (what: string): void => console.warn(`skipped on win32: ${what} needs a POSIX shell; the macOS and Linux CI runs run it`);

interface Step { id?: string; name?: string; uses?: string; run?: string; shell?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown>; 'working-directory'?: string }
interface Job { 'runs-on'?: string; needs?: string | string[]; if?: string; env?: Record<string, string>; permissions?: Record<string, string>; outputs?: Record<string, string>; steps: Step[] }
interface Workflow { env?: Record<string, string>; permissions?: Record<string, string>; jobs: Record<string, Job>; [key: string]: unknown }

/** release.yml as Ruby's Psych reads it (YAML 1.1, so the `on` key reads as the boolean true). */
function releaseWorkflow(): Workflow {
  const r = cp.spawnSync('ruby', ['-ryaml', '-rjson', '-e', 'print JSON.generate(YAML.safe_load(File.read(ARGV[0])))', repo('.github/workflows/release.yml')], { encoding: 'utf8' });
  if (r.error !== undefined || r.status !== 0) {
    throw new Error(`could not read .github/workflows/release.yml as YAML with ruby -ryaml (the offline parser this test uses; Ruby must be on PATH): ${r.error?.message ?? r.stderr}`);
  }
  return JSON.parse(r.stdout) as Workflow;
}

function step(wf: Workflow, job: string, id: string): Step {
  const s = wf.jobs[job]?.steps.find((x) => x.id === id);
  if (s === undefined) throw new Error(`release.yml job ${job} has no step with id ${id}`);
  return s;
}

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

/** The checkout files the steps compare against: the repo's NOTICE and PROVENANCE.md. */
const putCheckout = (root: string): void => {
  for (const f of ['NOTICE', 'PROVENANCE.md']) fs.copyFileSync(repo(f), path.join(root, f));
};

/** A stand-in Windows executable: MZ header, PE signature at e_lfanew 0x80, the machine and optional-header magic given. */
function pe(machine: number, magic: number): Uint8Array {
  const b = new Uint8Array(512);
  const v = new DataView(b.buffer);
  v.setUint16(0, 0x5a4d, true);
  v.setUint32(0x3c, 0x80, true);
  v.setUint32(0x80, 0x4550, true);
  v.setUint16(0x84, machine, true);
  v.setUint16(0x80 + 24, magic, true);
  return b;
}
const PE_X64 = pe(0x8664, 0x20b);
const PE_ARM64 = pe(0xaa64, 0x20b);
const PE_X86 = pe(0x14c, 0x10b);

/** A stand-in Linux executable: a 64-byte ELF header with the class, byte order and machine given. */
function elf(machine: number, cls = 2, data = 1): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x7f, 0x45, 0x4c, 0x46, cls, data, 1], 0);
  new DataView(b.buffer).setUint16(18, machine, true);
  return b;
}
const ELF_X86_64 = elf(62);
const ELF_AARCH64 = elf(183);

const writeExecutable = (file: string, body: string): void => put(file, body, 0o755);

/**
 * Runs a bash step of release.yml in `cwd` as GitHub runs one (`bash -eo pipefail`), with the
 * workflow, job and step env, VERSION set, and `stubs` first on PATH.
 */
function runStep(wf: Workflow, job: string, id: string, cwd: string, o: { version: string; stubs?: string; env?: Record<string, string> }): SpawnResult {
  const s = step(wf, job, id);
  expect(s.run, `${job}.${id} has a run script`).toBeTypeOf('string');
  expect(s.shell ?? 'bash', `${job}.${id} runs in bash`).toBe('bash');
  const env: Record<string, string | undefined> = { ...proc.env, ...wf.env, ...wf.jobs[job].env, ...s.env, VERSION: o.version, ...o.env };
  if (o.stubs !== undefined) env.PATH = `${o.stubs}:${proc.env.PATH ?? ''}`;
  const script = path.join(cwd, `.step-${job}-${id}.sh`);
  fs.writeFileSync(script, s.run as string);
  const r = cp.spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], { cwd, env, encoding: 'utf8' });
  fs.rmSync(script, { recursive: false, force: true });
  return r;
}
const output = (r: SpawnResult): string => r.stdout + r.stderr;

/** A stub that appends its name and arguments, one JSON line, to $MBC_LOG and exits with $2. */
const logStub = (name: string, exit = 0, extra = ''): string =>
  `#!/bin/sh\nnode -e 'require("fs").appendFileSync(process.env.MBC_LOG, JSON.stringify(process.argv.slice(1)) + "\\n")' ${name} "$@"\n${extra}exit ${exit}\n`;

/** The commands the logStubs ran, in order. */
const logged = (log: string): string[][] => (fs.existsSync(log) ? text(log).split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);

// ---------------------------------------------------------------------------------------------
// The Windows job: stage the MSI and the portable EXE, then check the PE headers and the install.

/** The bundler's Windows output for `version`, and the msi-admin/ tree msiexec /a unpacks. */
function windowsTree(root: string, version: string, o: { portable?: Uint8Array; installed?: Uint8Array | null; notice?: string | null; provenance?: string | null } = {}): void {
  putCheckout(root);
  const out = path.join(root, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release');
  put(path.join(out, 'molbiocraft-desktop.exe'), o.portable ?? PE_X64);
  put(path.join(out, 'bundle', 'msi', `MolBioCraft_${version}_x64_en-US.msi`), 'stand-in msi\n');
  const installDir = path.join(root, 'msi-admin', 'PFiles', 'MolBioCraft');
  fs.mkdirSync(installDir, { recursive: true });
  if (o.installed !== null) put(path.join(installDir, 'molbiocraft-desktop.exe'), o.installed ?? PE_X64);
  if (o.notice !== null) put(path.join(installDir, 'NOTICE'), o.notice ?? text(repo('NOTICE')));
  if (o.provenance !== null) put(path.join(installDir, 'PROVENANCE.md'), o.provenance ?? text(repo('PROVENANCE.md')));
}

// ---------------------------------------------------------------------------------------------
// The Linux job: a dpkg-deb stub that reads a tar archive as the .deb.

const DPKG_DEB_STUB = `#!/bin/sh
case "$1" in
  --field) if [ "$3" = Architecture ]; then printf '%s\\n' "\${MBC_DEB_ARCH:-amd64}"; else printf 'stub-%s\\n' "$3"; fi; exit 0 ;;
  -c) exec tar -tvf "$2" ;;
  -x) mkdir -p "$3" && exec tar -xf "$2" -C "$3" ;;
esac
echo "dpkg-deb stub: unsupported arguments: $*" >&2
exit 2
`;

/** The .deb the bundler writes for `version`, as a tar of `files` (path in the package -> content), and a dpkg-deb stub. */
function linuxTree(root: string, version: string, files: Record<string, string | Uint8Array>): string {
  putCheckout(root);
  const tree = path.join(root, 'deb-tree');
  for (const [p, data] of Object.entries(files)) put(path.join(tree, ...p.split('/')), data);
  const deb = path.join(root, 'src-tauri', 'target', 'x86_64-unknown-linux-gnu', 'release', 'bundle', 'deb', `MolBioCraft_${version}_amd64.deb`);
  fs.mkdirSync(path.dirname(deb), { recursive: true });
  const tar = cp.spawnSync('tar', ['-cf', deb, '-C', tree, '.'], { encoding: 'utf8', env: { ...proc.env, COPYFILE_DISABLE: '1' } });
  expect(tar.status, `tar: ${tar.stderr}`).toBe(0);
  fs.rmSync(tree, { recursive: true, force: true });
  const stubs = path.join(root, 'stubs');
  writeExecutable(path.join(stubs, 'dpkg-deb'), DPKG_DEB_STUB);
  return stubs;
}

const DEB_FILES = (): Record<string, string | Uint8Array> => ({
  'usr/bin/molbiocraft-desktop': ELF_X86_64,
  'usr/lib/MolBioCraft/NOTICE': text(repo('NOTICE')),
  'usr/lib/MolBioCraft/PROVENANCE.md': text(repo('PROVENANCE.md')),
  'usr/share/doc/molbiocraft/NOTICE': text(repo('NOTICE')),
  'usr/share/doc/molbiocraft/PROVENANCE.md': text(repo('PROVENANCE.md')),
  'usr/share/applications/molbiocraft-desktop.desktop': '[Desktop Entry]\n',
});

// ---------------------------------------------------------------------------------------------
// scripts/build_installers.sh with stubs.

/** The absolute-path macOS tools build_installers.sh calls, each replaced by a stub. */
const MAC_TOOLS: Record<string, string> = {
  '/usr/libexec/PlistBuddy': 'PlistBuddy',
  '/usr/bin/lipo': 'lipo',
  '/usr/bin/codesign': 'codesign',
  '/usr/bin/hdiutil': 'hdiutil',
};

const MAC_STUBS: Record<string, string> = {
  // Print :CFBundleExecutable PLIST -> the <string> after that key.
  PlistBuddy: `#!/bin/sh\nfor last; do :; done\nawk '/<key>CFBundleExecutable<\\/key>/ { getline; gsub(/.*<string>|<\\/string>.*/, ""); print; found = 1 } END { exit found ? 0 : 1 }' "$last"\n`,
  // -archs FILE -> the slices the stand-in binary names (its content).
  lipo: `#!/bin/sh\n[ "$1" = -archs ] || { echo "lipo stub: only -archs" >&2; exit 2; }\ncat "$2"\n`,
  // --verify ... APP -> verifies when the stand-in bundle carries _CodeSignature/CodeResources.
  codesign: `#!/bin/sh\nfor last; do :; done\n[ -f "$last/Contents/_CodeSignature/CodeResources" ] || { echo "$last: code object is not signed at all" >&2; exit 1; }\n`,
  // attach ... -mountpoint DIR IMAGE -> the stand-in image is a tar of its root; detach DIR empties DIR.
  hdiutil: `#!/bin/sh\ncat >/dev/null &\ncase "$1" in\n  attach) for last; do :; done; while [ $# -gt 0 ]; do [ "$1" = -mountpoint ] && mnt="$2"; shift; done; tar -xf "$last" -C "$mnt" ;;\n  detach) find "$2" -mindepth 1 -delete ;;\n  *) echo "hdiutil stub: unsupported $1" >&2; exit 2 ;;\nesac\n`,
};

interface AppSpec { archs: string; signed?: boolean; notice?: string | null; provenance?: string | null }

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>molbiocraft-desktop</string>
  <key>CFBundleName</key>
  <string>MolBioCraft</string>
</dict>
</plist>
`;

/** A stand-in MolBioCraft.app in `dir`. */
function putApp(dir: string, spec: AppSpec): void {
  const app = path.join(dir, 'MolBioCraft.app', 'Contents');
  put(path.join(app, 'Info.plist'), INFO_PLIST);
  put(path.join(app, 'MacOS', 'molbiocraft-desktop'), `${spec.archs}\n`, 0o755);
  if (spec.signed !== false) put(path.join(app, '_CodeSignature', 'CodeResources'), 'sealed\n');
  if (spec.notice !== null) put(path.join(app, 'Resources', 'NOTICE'), spec.notice ?? text(repo('NOTICE')));
  if (spec.provenance !== null) put(path.join(app, 'Resources', 'PROVENANCE.md'), spec.provenance ?? text(repo('PROVENANCE.md')));
}

interface MacRun { r: SpawnResult; ran: string[][]; release: string[]; dmgDigest?: string; builtDigest: string }

/**
 * Runs scripts/build_installers.sh in a copy of its inputs. The npx stub writes `bundle` (the .app
 * and a .dmg holding `dmgApp`) where tauri build --target universal-apple-darwin writes it.
 */
function buildMac(bundle: { app: AppSpec; dmgApp?: AppSpec; dmg?: boolean }): MacRun {
  return inTemp('mbc-release-macos-', (root) => {
    putCheckout(root);
    put(path.join(root, 'src-tauri', 'tauri.conf.json'), text(repo('src-tauri/tauri.conf.json')));
    const stubs = path.join(root, 'stubs');
    const log = path.join(root, 'ran.jsonl');
    // What the bundler writes, prepared beside the checkout; the npx stub copies it into place.
    const made = path.join(root, 'made-bundle');
    putApp(path.join(made, 'macos'), bundle.app);
    const dmgRoot = path.join(root, 'dmg-root');
    putApp(dmgRoot, bundle.dmgApp ?? bundle.app);
    fs.mkdirSync(path.join(made, 'dmg'), { recursive: true });
    const dmg = path.join(made, 'dmg', `MolBioCraft_${VERSION}_universal.dmg`);
    if (bundle.dmg !== false) {
      const tar = cp.spawnSync('tar', ['-cf', dmg, '-C', dmgRoot, '.'], { encoding: 'utf8', env: { ...proc.env, COPYFILE_DISABLE: '1' } });
      expect(tar.status, tar.stderr).toBe(0);
    }
    const builtDigest = bundle.dmg !== false ? sha256(dmg) : '';
    const bundleDir = 'src-tauri/target/universal-apple-darwin/release/bundle';
    writeExecutable(path.join(stubs, 'npm'), logStub('npm'));
    writeExecutable(path.join(stubs, 'npx'), logStub('npx', 0, `mkdir -p ${bundleDir} && cp -R "$MBC_MADE/." ${bundleDir}/\n`));
    for (const tool of ['cargo', 'python3', 'python', 'makensis', 'rustup']) writeExecutable(path.join(stubs, tool), logStub(tool, 1));
    for (const [name, body] of Object.entries(MAC_STUBS)) writeExecutable(path.join(stubs, name), body);

    let source = text(repo('scripts/build_installers.sh'));
    for (const [abs, name] of Object.entries(MAC_TOOLS)) {
      expect(source.includes(abs), `build_installers.sh calls ${abs}`).toBe(true);
      source = source.split(abs).join(`"$MBC_STUBS/${name}"`);
    }
    const zsh = cp.spawnSync('zsh', ['-c', 'true'], { encoding: 'utf8' }).status === 0;
    if (!zsh) source = source.split('\n').filter((l) => !/^setopt /.test(l)).join('\n');
    put(path.join(root, 'scripts', 'build_installers.sh'), source, 0o755);
    const r = cp.spawnSync(zsh ? 'zsh' : 'bash', [path.join(root, 'scripts', 'build_installers.sh')], {
      cwd: root,
      env: { ...proc.env, PATH: `${stubs}:${proc.env.PATH ?? ''}`, MBC_STUBS: stubs, MBC_LOG: log, MBC_MADE: made, TMPDIR: root },
      encoding: 'utf8',
    });
    const releaseDir = path.join(root, 'release');
    const release = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).sort() : [];
    const out = path.join(releaseDir, `MolBioCraft-${VERSION}-macOS-universal.dmg`);
    return { r, ran: logged(log), release, dmgDigest: fs.existsSync(out) ? sha256(out) : undefined, builtDigest };
  });
}

// =============================================================================================

it('bundles exactly the app, dmg, msi and deb targets', () => {
  const srcTauri = repo('src-tauri');
  const conf = JSON.parse(text(repo('src-tauri/tauri.conf.json'))) as { bundle: { active?: boolean; targets?: unknown; resources?: unknown } };
  expect(conf.bundle.active, 'bundle.active').toBe(true);
  // A list, not "all", so the bundler builds no nsis, rpm or appimage package.
  expect(Array.isArray(conf.bundle.targets), 'bundle.targets is a list').toBe(true);
  expect(conf.bundle.targets, 'bundle.targets').toEqual(['app', 'dmg', 'msi', 'deb']);

  const resources = conf.bundle.resources;
  expect(resources !== null && typeof resources === 'object' && !Array.isArray(resources), 'bundle.resources is a map of source to target').toBe(true);
  const entries = Object.entries(resources as Record<string, unknown>);
  const sourcesOf = (target: string): string[] => entries.filter(([, to]) => to === target).map(([from]) => path.resolve(srcTauri, from));
  expect(sourcesOf('NOTICE'), 'the source bundle.resources maps to NOTICE').toEqual([repo('NOTICE')]);
  expect(sourcesOf('PROVENANCE.md'), 'the source bundle.resources maps to PROVENANCE.md').toEqual([repo('PROVENANCE.md')]);
});

// ---------------------------------------------------------------------------------------------
// The strings the bundler writes into the MSI's WiX source (BG01M6V9Q0, D0079).

type Json = Record<string, unknown>;
const asRecord = (v: unknown): Json => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * The tauri.conf.json strings this check covers, each with its field path. The tauri-bundler
 * shipped with @tauri-apps/cli 2.12.4 renders its main.wxs template with Handlebars' no_escape, so
 * the strings it interpolates go into the WiX source unescaped. An & < or " in one of them leaves
 * the source malformed and candle rejects it (CNDL0104, for the & in release run 42380677315); a >
 * is legal there, but BG01M6V9Q0's AC1 rules it out too. The template interpolates productName,
 * version, identifier (also the manufacturer when bundle.publisher is unset), mainBinaryName (in
 * the main binary's path), bundle.publisher, bundle.homepage, bundle.licenseFile (when it is an
 * .rtf), the file names in bundle.externalBin (in each binary's path), each file association's
 * description and ext, bundle.windows.minimumWebview2Version, the bundle.windows.wix version,
 * image file names and ref lists, and the deep-link plugin's desktop schemes. productName also goes
 * unescaped into the locale.wxl that light reads, and bundle.longDescription is handed to the
 * template. AC1 also names each file association's name, bundle.copyright and
 * bundle.shortDescription.
 */
function msiSourceStrings(conf: Json): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const add = (field: string, value: unknown): void => {
    if (typeof value === 'string') out.push([field, value]);
  };
  const addEach = (field: string, values: unknown): void => asList(values).forEach((v, i) => add(`${field}[${i}]`, v));
  for (const k of ['productName', 'version', 'identifier', 'mainBinaryName']) add(k, conf[k]);
  const bundle = asRecord(conf.bundle);
  for (const k of ['publisher', 'copyright', 'shortDescription', 'longDescription', 'homepage', 'licenseFile']) add(`bundle.${k}`, bundle[k]);
  addEach('bundle.externalBin', bundle.externalBin);
  asList(bundle.fileAssociations).forEach((a, i) => {
    const association = asRecord(a);
    add(`bundle.fileAssociations[${i}].name`, association.name);
    add(`bundle.fileAssociations[${i}].description`, association.description);
    addEach(`bundle.fileAssociations[${i}].ext`, association.ext);
  });
  const windows = asRecord(bundle.windows);
  add('bundle.windows.minimumWebview2Version', windows.minimumWebview2Version);
  const wix = asRecord(windows.wix);
  for (const k of ['version', 'bannerPath', 'dialogImagePath']) add(`bundle.windows.wix.${k}`, wix[k]);
  for (const k of ['componentGroupRefs', 'componentRefs', 'featureGroupRefs', 'featureRefs', 'mergeRefs']) addEach(`bundle.windows.wix.${k}`, wix[k]);
  // plugins.deep-link.desktop is one protocol or a list of them.
  const desktop = asRecord(asRecord(conf.plugins)['deep-link']).desktop;
  if (Array.isArray(desktop)) desktop.forEach((p, i) => addEach(`plugins.deep-link.desktop[${i}].schemes`, asRecord(p).schemes));
  else addEach('plugins.deep-link.desktop.schemes', asRecord(desktop).schemes);
  return out;
}

/** Each string in the MSI source that holds & < > or ", as "field: value". */
const xmlSpecialFields = (conf: Json): string[] =>
  msiSourceStrings(conf).filter(([, v]) => /[&<>"]/.test(v)).map(([field, v]) => `${field}: ${JSON.stringify(v)}`);

/** A config holding every field msiSourceStrings must check, two entries wherever there is a list. */
const MSI_FIXTURE = (): Json => ({
  productName: 'App',
  version: '1.2.3',
  identifier: 'org.example.app',
  mainBinaryName: 'app',
  bundle: {
    publisher: 'Publisher',
    copyright: 'Copyright',
    shortDescription: 'Short',
    longDescription: 'Long',
    homepage: 'https://example.org/',
    licenseFile: 'LICENSE.rtf',
    externalBin: ['bin/tool-a', 'bin/tool-b'],
    fileAssociations: [
      { ext: ['a1', 'a2'], name: 'Name A', description: 'Description A' },
      { ext: ['b1', 'b2'], name: 'Name B', description: 'Description B' },
    ],
    windows: {
      minimumWebview2Version: '110.0.1531.0',
      wix: {
        version: '1.2.3',
        bannerPath: 'banner.bmp',
        dialogImagePath: 'dialog.bmp',
        componentGroupRefs: ['G1', 'G2'],
        componentRefs: ['C1', 'C2'],
        featureGroupRefs: ['FG1', 'FG2'],
        featureRefs: ['F1', 'F2'],
        mergeRefs: ['M1', 'M2'],
      },
    },
  },
  plugins: { 'deep-link': { desktop: [{ schemes: ['s1', 's2'] }, { schemes: ['t1', 't2'] }] } },
});

/** Every field of MSI_FIXTURE the check must cover, listed here rather than taken from msiSourceStrings. */
const MSI_FIELDS = [
  'productName', 'version', 'identifier', 'mainBinaryName',
  'bundle.publisher', 'bundle.copyright', 'bundle.shortDescription', 'bundle.longDescription', 'bundle.homepage', 'bundle.licenseFile',
  'bundle.externalBin[0]', 'bundle.externalBin[1]',
  'bundle.fileAssociations[0].name', 'bundle.fileAssociations[0].description', 'bundle.fileAssociations[0].ext[0]', 'bundle.fileAssociations[0].ext[1]',
  'bundle.fileAssociations[1].name', 'bundle.fileAssociations[1].description', 'bundle.fileAssociations[1].ext[0]', 'bundle.fileAssociations[1].ext[1]',
  'bundle.windows.minimumWebview2Version', 'bundle.windows.wix.version', 'bundle.windows.wix.bannerPath', 'bundle.windows.wix.dialogImagePath',
  'bundle.windows.wix.componentGroupRefs[1]', 'bundle.windows.wix.componentRefs[1]', 'bundle.windows.wix.featureGroupRefs[1]',
  'bundle.windows.wix.featureRefs[1]', 'bundle.windows.wix.mergeRefs[1]',
  'plugins.deep-link.desktop[0].schemes[0]', 'plugins.deep-link.desktop[1].schemes[1]',
];

/** MSI_FIXTURE with the string at `field` replaced by `value`. */
function fixtureWith(field: string, value: string): Json {
  const conf = MSI_FIXTURE();
  const keys = field.replace(/\[(\d+)\]/g, '.$1').split('.');
  const parent = keys.slice(0, -1).reduce<Json>((o, k) => o[k] as Json, conf);
  const last = keys[keys.length - 1];
  expect(typeof parent[last], `MSI_FIXTURE holds a string at ${field}`).toBe('string');
  parent[last] = value;
  return conf;
}

it('keeps the strings the bundler writes into the MSI source free of XML-special characters', () => {
  const conf = JSON.parse(text(repo('src-tauri/tauri.conf.json'))) as Json;
  expect(xmlSpecialFields(conf), 'tauri.conf.json strings the bundler writes unescaped into main.wxs that hold & < > or "').toEqual([]);
  const mbc = asList(asRecord(conf.bundle).fileAssociations).map(asRecord).find((a) => asList(a.ext).includes('mbc'));
  expect(mbc?.description, 'the .mbc file association description').toBe('MolBioCraft Session and Workbench File (.mbc)');

  // The check passes a clean config and fails each special character in each field, naming that field alone.
  expect(xmlSpecialFields(MSI_FIXTURE())).toEqual([]);
  for (const field of MSI_FIELDS) {
    for (const ch of ['&', '<', '>', '"']) {
      const value = `a ${ch} b`;
      expect(xmlSpecialFields(fixtureWith(field, value)), `${ch} in ${field}`).toEqual([`${field}: ${JSON.stringify(value)}`]);
    }
  }
  expect(xmlSpecialFields({ plugins: { 'deep-link': { desktop: { schemes: ['a&b'] } } } }), 'one deep-link protocol rather than a list').toEqual(['plugins.deep-link.desktop.schemes[0]: "a&b"']);
});

// ---------------------------------------------------------------------------------------------
// The OS file associations (BG01M6VMWS, D0084), as the tauri-bundler shipped with @tauri-apps/cli
// 2.12.4 writes them from tauri.conf.json:
// - Linux: freedesktop/mod.rs joins every bundle.fileAssociations mimeType with ";" into the .deb's
//   MimeType=, rendering bundle.linux.deb.desktopTemplate (Handlebars, no escaping) when one is set,
//   else its own main.desktop. That one takes Categories= from bundle.category, and no category maps
//   to Science and Biology (category.rs), so a template sets them.
// - macOS: tauri_utils::config::file_associations_plist renders CFBundleDocumentTypes, and
//   UTExportedTypeDeclarations only for an association with an exportedType. app.rs then sets each
//   top-level key of src-tauri/Info.plist and of bundle.macOS.infoPlist over them (merge_plist).
// - Windows: main.wxs writes a ProgId MolBioCraft.<ext> and an Extension for every ext.

const readConf = (): Json => JSON.parse(text(repo('src-tauri/tauri.conf.json'))) as Json;
const associationsOf = (conf: Json): Json[] => asList(asRecord(conf.bundle).fileAssociations).map(asRecord);
/** An association's extensions as the bundler reads them (AssociationExt drops a leading "."). */
const extsOf = (a: Json): string[] => asList(a.ext).map((e) => String(e).replace(/^\./, ''));
const strings = (v: unknown): string[] => asList(v).filter((s): s is string => typeof s === 'string');

/** A MIME type that names no format, so claiming it offers MolBioCraft for files of every kind. */
const isGenericMime = (m: string): boolean =>
  m.includes('*') || /^(application\/(x-)?(octet-stream|unknown|binary|zip|json|xml)|binary\/octet-stream|text\/(plain|xml)|inode\/.+)$/i.test(m.trim());
/** A uniform type identifier that names no format: the same claim on macOS. */
const isGenericUti = (u: string): boolean =>
  u === 'com.pkware.zip-archive' ||
  /^public\.(item|content|composite-content|data|text|plain-text|utf8-plain-text|utf16-plain-text|json|xml|archive|zip-archive|image|movie|audio|audiovisual-content|database|source-code|script)$/.test(u);

/** tauri-utils' extension_to_uti and mime_type_to_uti (config.rs), which fill LSItemContentTypes. */
const EXT_UTI: Record<string, string> = {
  png: 'public.png', jpg: 'public.jpeg', jpeg: 'public.jpeg', gif: 'com.compuserve.gif', bmp: 'com.microsoft.bmp', tiff: 'public.tiff', tif: 'public.tiff',
  ico: 'com.microsoft.ico', heic: 'public.heif-standard-image', heif: 'public.heif-standard-image', webp: 'org.webmproject.webp', svg: 'public.svg-image',
  mp4: 'public.mpeg-4', mov: 'com.apple.quicktime-movie', avi: 'public.avi', mkv: 'public.mpeg-4', mp3: 'public.mp3', wav: 'com.microsoft.waveform-audio',
  aac: 'public.aac-audio', m4a: 'public.mpeg-4-audio', pdf: 'com.adobe.pdf', txt: 'public.plain-text', rtf: 'public.rtf', html: 'public.html', htm: 'public.html',
  json: 'public.json', xml: 'public.xml',
};
const MIME_UTI: Record<string, string> = {
  'image/png': 'public.png', 'image/jpeg': 'public.jpeg', 'image/jpg': 'public.jpeg', 'image/gif': 'com.compuserve.gif', 'image/bmp': 'com.microsoft.bmp',
  'image/tiff': 'public.tiff', 'image/heic': 'public.heif-standard-image', 'image/heif': 'public.heif-standard-image', 'image/webp': 'org.webmproject.webp',
  'image/svg+xml': 'public.svg-image', 'video/mp4': 'public.mpeg-4', 'video/quicktime': 'com.apple.quicktime-movie', 'video/x-msvideo': 'public.avi',
  'audio/mpeg': 'public.mp3', 'audio/mp3': 'public.mp3', 'audio/wav': 'com.microsoft.waveform-audio', 'audio/wave': 'com.microsoft.waveform-audio',
  'audio/aac': 'public.aac-audio', 'audio/mp4': 'public.mpeg-4-audio', 'application/pdf': 'com.adobe.pdf', 'text/plain': 'public.plain-text',
  'text/rtf': 'public.rtf', 'text/html': 'public.html', 'application/json': 'public.json', 'application/xml': 'public.xml', 'text/xml': 'public.xml',
};
const mimeUti = (m: string): string | undefined =>
  MIME_UTI[m] ?? (m.startsWith('image/') ? 'public.image' : m.startsWith('video/') ? 'public.movie' : m.startsWith('audio/') ? 'public.audio' : undefined);

/** FileAssociation::infer_content_types: the exported type alone, else contentTypes plus the UTIs its ext and mimeType infer. */
function inferContentTypes(a: Json): string[] {
  if (a.exportedType != null) return [String(asRecord(a.exportedType).identifier)];
  const out = new Set(strings(a.contentTypes));
  for (const e of extsOf(a)) {
    const u = EXT_UTI[e.toLowerCase()];
    if (u !== undefined) out.add(u);
  }
  const u = typeof a.mimeType === 'string' ? mimeUti(a.mimeType) : undefined;
  if (u !== undefined) out.add(u);
  return [...out].sort();
}

/** file_associations_plist: the two Info.plist keys the bundler renders from bundle.fileAssociations. */
function bundlerAssociationKeys(conf: Json): Json {
  const associations = associationsOf(conf);
  const out: Json = {};
  const exported = associations.filter((a) => a.exportedType != null).map((a) => {
    const t = asRecord(a.exportedType);
    const entry: Json = { UTTypeIdentifier: t.identifier };
    if (typeof a.description === 'string') entry.UTTypeDescription = a.description;
    if (t.conformsTo != null) entry.UTTypeConformsTo = strings(t.conformsTo);
    const tags: Json = { 'public.filename-extension': extsOf(a) };
    if (typeof a.mimeType === 'string') tags['public.mime-type'] = a.mimeType;
    entry.UTTypeTagSpecification = tags;
    return entry;
  });
  if (exported.length > 0) out.UTExportedTypeDeclarations = exported;
  const documents = associations.map((a) => {
    const entry: Json = {};
    const exts = extsOf(a);
    if (exts.length > 0) entry.CFBundleTypeExtensions = exts;
    const contentTypes = inferContentTypes(a);
    if (contentTypes.length > 0) entry.LSItemContentTypes = contentTypes;
    entry.CFBundleTypeName = typeof a.name === 'string' ? a.name : (exts[0] ?? '');
    entry.CFBundleTypeRole = typeof a.role === 'string' ? a.role : 'Editor';
    entry.LSHandlerRank = typeof a.rank === 'string' ? a.rank : 'Default';
    return entry;
  });
  if (documents.length > 0) out.CFBundleDocumentTypes = documents;
  return out;
}

/** An XML property list: dict, array, key, string, integer, true and false. Anything else throws. */
function parsePlist(xml: string): unknown {
  const tokens = (xml.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, '').match(/<[^>]+>|[^<]+/g) ?? []).filter((t) => t.trim() !== '');
  let i = 0;
  const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const next = (): string => {
    if (i >= tokens.length) throw new Error('the property list ends early');
    return tokens[i++];
  };
  const textUntil = (close: string): string => {
    let s = '';
    for (let t = next(); t !== close; t = next()) {
      if (t.startsWith('<')) throw new Error(`unexpected ${t} before ${close}`);
      s += t;
    }
    return unescape(s);
  };
  const value = (tag: string): unknown => {
    switch (tag) {
      case '<dict>': {
        const d: Json = {};
        for (let t = next(); t !== '</dict>'; t = next()) {
          if (t !== '<key>') throw new Error(`a dict holds ${t} where a <key> belongs`);
          const k = textUntil('</key>');
          d[k] = value(next());
        }
        return d;
      }
      case '<array>': {
        const a: unknown[] = [];
        for (let t = next(); t !== '</array>'; t = next()) a.push(value(t));
        return a;
      }
      case '<dict/>': return {};
      case '<array/>': return [];
      case '<string>': return textUntil('</string>');
      case '<string/>': return '';
      case '<integer>': return Number(textUntil('</integer>'));
      case '<true/>': return true;
      case '<false/>': return false;
      default: throw new Error(`unsupported property-list element ${tag}`);
    }
  };
  if (!/^<plist\b/.test(next())) throw new Error('not a <plist> document');
  const root = value(next());
  if (next() !== '</plist>') throw new Error('the <plist> holds more than one value');
  return root;
}

/**
 * The keys src-tauri/Info.plist and then bundle.macOS.infoPlist set, merged key by key as tauri-cli's
 * merge_plist does. The CLI runs in src-tauri, so infoPlist is relative to it.
 */
function macUserPlist(conf: Json): Json {
  const files = [repo('src-tauri/Info.plist')].filter((f) => fs.existsSync(f));
  const named = asRecord(asRecord(conf.bundle).macOS).infoPlist;
  if (typeof named === 'string') files.push(path.resolve(repo('src-tauri'), named));
  const merged: Json = {};
  for (const f of files) Object.assign(merged, asRecord(parsePlist(text(f))));
  return merged;
}

/**
 * The extensions macOS opens with MolBioCraft. A document type's CFBundleTypeExtensions count only
 * when it lists no LSItemContentTypes (macOS ignores its extensions otherwise) or lists an exported
 * type carrying the extension, and only for an Editor or Viewer not ranked None.
 */
function macRegisteredExtensions(mac: Json): Set<string> {
  const exportedExts = new Map(
    asList(mac.UTExportedTypeDeclarations).map(asRecord).map((t) => [String(t.UTTypeIdentifier), strings(asRecord(t.UTTypeTagSpecification)['public.filename-extension'])])
  );
  const out = new Set<string>();
  for (const d of asList(mac.CFBundleDocumentTypes).map(asRecord)) {
    if (!['Editor', 'Viewer'].includes(String(d.CFBundleTypeRole)) || d.LSHandlerRank === 'None') continue;
    const contentTypes = strings(d.LSItemContentTypes);
    for (const e of strings(d.CFBundleTypeExtensions)) {
      if (contentTypes.length === 0 || contentTypes.some((u) => exportedExts.get(u)?.includes(e) === true)) out.add(e);
    }
  }
  return out;
}

/** A plist value with its dict keys sorted and LSItemContentTypes (a set) sorted, for comparing entries. */
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Json).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, k === 'LSItemContentTypes' ? strings(x).sort() : canonical(x)]))
      : v;

/** The bundler's own main.desktop, used when bundle.linux.deb.desktopTemplate is unset. */
const BUNDLER_DESKTOP_TEMPLATE = `[Desktop Entry]
Categories={{categories}}
{{#if comment}}
Comment={{comment}}
{{/if}}
Exec={{exec}}
StartupWMClass={{exec}}
Icon={{icon}}
Name={{name}}
Terminal=false
Type=Application
{{#if mime_type}}
MimeType={{mime_type}}
{{/if}}
`;

type TemplateVars = Record<string, () => string | undefined>;

/**
 * The variables freedesktop/mod.rs hands the desktop template (DesktopTemplateParams). The config
 * sets no deep-link plugin, whose schemes would join MimeType= as x-scheme-handler/<scheme>.
 */
function desktopTemplateVars(conf: Json): TemplateVars {
  const bundle = asRecord(conf.bundle);
  const mimeTypes = strings(associationsOf(conf).map((a) => a.mimeType));
  // The release .deb installs the binary as usr/bin/molbiocraft-desktop (release.yml checks it).
  const bin = typeof conf.mainBinaryName === 'string' ? conf.mainBinaryName : 'molbiocraft-desktop';
  return {
    categories: () => {
      if (bundle.category === undefined) return '';
      if (bundle.category === 'Education') return 'Education;';
      throw new Error(`the desktop template reads categories: port category.rs's freedesktop_categories for bundle.category ${String(bundle.category)}`);
    },
    comment: () => (typeof bundle.shortDescription === 'string' && bundle.shortDescription !== '' ? bundle.shortDescription : undefined),
    exec: () => bin,
    icon: () => bin,
    name: () => String(conf.productName),
    mime_type: () => (mimeTypes.length > 0 ? mimeTypes.join(';') : undefined),
    long_description: () => (typeof bundle.longDescription === 'string' ? bundle.longDescription : ''),
  };
}

/**
 * Renders a desktop template as the bundler's Handlebars does, for the forms a template here uses:
 * comments, {{#if v}}...{{/if}} on lines of their own, and {{v}}. Any other form, or a variable the
 * bundler does not provide, throws.
 */
function renderDesktopTemplate(template: string, vars: TemplateVars): string {
  const get = (name: string): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new Error(`the desktop template uses {{${name}}}, which the bundler does not provide (it provides ${Object.keys(vars).join(', ')})`);
    }
    return vars[name]();
  };
  const out = template
    .replace(/\{\{!--[\s\S]*?--\}\}\n?|\{\{![^}]*\}\}\n?/g, '')
    .replace(/\{\{#if (\w+)\}\}\n?([\s\S]*?)\{\{\/if\}\}\n?/g, (_m, name: string, body: string) => (get(name) ? body : ''))
    .replace(/\{\{(\w+)\}\}/g, (_m, name: string) => get(name) ?? '');
  const left = /\{\{|\}\}/.exec(out);
  if (left !== null) throw new Error(`the desktop template holds a form this check does not render: ${JSON.stringify(out.slice(left.index, left.index + 40))}`);
  return out;
}

/** The [Desktop Entry] group of a .desktop file, key -> value, skipping comments and blank lines. */
function desktopEntryGroup(desktop: string): Record<string, string> {
  const lines = desktop.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  expect(lines[0], 'the .desktop file opens with the [Desktop Entry] group').toBe('[Desktop Entry]');
  const entry: Record<string, string> = {};
  for (const l of lines.slice(1)) {
    if (l.startsWith('[')) break;
    const eq = l.indexOf('=');
    expect(eq > 0, `a key=value line: ${l}`).toBe(true);
    const key = l.slice(0, eq).trim();
    expect(entry[key], `${key}= is set once`).toBeUndefined();
    entry[key] = l.slice(eq + 1).trim();
  }
  return entry;
}
const desktopList = (v: string | undefined): string[] => (v ?? '').split(';').map((s) => s.trim()).filter(Boolean);

/** The [Desktop Entry] the bundler writes into the .deb (usr/share/applications/<productName>.desktop). */
function linuxDesktopEntry(conf: Json): Record<string, string> {
  const template = asRecord(asRecord(asRecord(conf.bundle).linux).deb).desktopTemplate;
  const source = typeof template === 'string' ? text(path.resolve(repo('src-tauri'), template)) : BUNDLER_DESKTOP_TEMPLATE;
  return desktopEntryGroup(renderDesktopTemplate(source, desktopTemplateVars(conf)));
}

/** IMPORTABLE_EXTENSIONS in src-tauri/src/commands/fs_commands.rs: the file types the desktop shell opens. */
function importableExtensions(): string[] {
  const m = /const IMPORTABLE_EXTENSIONS: &\[&str\] = &\[([\s\S]*?)\];/.exec(text(repo('src-tauri/src/commands/fs_commands.rs')));
  if (m === null) throw new Error('src-tauri/src/commands/fs_commands.rs declares no IMPORTABLE_EXTENSIONS list');
  const list = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (list.length === 0) throw new Error('IMPORTABLE_EXTENSIONS in fs_commands.rs lists no extension');
  return list;
}

it('claims no generic file type and sets Linux categories', () => {
  // The classifiers and the renderer, on cases they must tell apart.
  const generic = ['application/octet-stream', 'text/plain', 'application/json', 'application/xml', 'text/xml', 'application/zip', '*/*', 'text/*', 'inode/directory'];
  expect(generic.filter((m) => !isGenericMime(m)), 'generic MIME types the check misses').toEqual([]);
  const specific = ['chemical/x-genbank', 'text/x-fasta', 'chemical/x-pdb', 'application/vnd.molbiocraft.workbench+json'];
  expect(specific.filter(isGenericMime), 'specific MIME types the check calls generic').toEqual([]);
  expect(['public.data', 'public.item', 'public.content', 'public.text', 'public.plain-text', 'public.json'].filter((u) => !isGenericUti(u)), 'generic UTIs the check misses').toEqual([]);
  expect(isGenericUti('org.molbiocraft.workbench'), 'org.molbiocraft.workbench is generic').toBe(false);
  const vars: TemplateVars = { name: () => 'N', mime_type: () => undefined };
  expect(renderDesktopTemplate('A={{name}}\n{{#if mime_type}}\nM={{mime_type}}\n{{/if}}\nB=1\n', vars)).toBe('A=N\nB=1\n');
  expect(renderDesktopTemplate('{{#if name}}\nM={{name}};\n{{/if}}\n', vars)).toBe('M=N;\n');
  expect(() => renderDesktopTemplate('MimeType={{mimeType}}\n', vars)).toThrow(/does not provide/);

  const conf = readConf();
  const associations = associationsOf(conf);
  const label = (a: Json): string => extsOf(a).map((e) => `.${e}`).join(' ');
  // Each mimeType goes into the .deb's MimeType=, and an exported type's into its macOS public.mime-type.
  expect(
    associations.filter((a) => typeof a.mimeType === 'string' && isGenericMime(a.mimeType)).map((a) => `${label(a)}: ${String(a.mimeType)}`),
    'associations whose mimeType names no format'
  ).toEqual([]);
  expect(associations.filter((a) => extsOf(a).includes('*')).map(label), 'associations claiming every extension').toEqual([]);
  const ab1 = associations.filter((a) => extsOf(a).includes('ab1'));
  expect(ab1.length, 'associations registering .ab1').toBe(1);
  const ab1Mime = ab1[0].mimeType;
  expect(ab1Mime === undefined || (typeof ab1Mime === 'string' && !isGenericMime(ab1Mime)), `.ab1's mimeType ${JSON.stringify(ab1Mime)} is specific or absent`).toBe(true);

  // Linux: the .deb's desktop entry.
  const entry = linuxDesktopEntry(conf);
  const mimeTypes = desktopList(entry.MimeType);
  expect(mimeTypes.filter(isGenericMime), 'generic types in the .deb MimeType=').toEqual([]);
  expect(mimeTypes, "the .deb MimeType= holds the associations' mimeTypes, no more and no fewer").toEqual(strings(associations.map((a) => a.mimeType)));
  expect(desktopList(entry.Categories), 'the .deb Categories=').toEqual(expect.arrayContaining(['Science', 'Biology']));
  // Without a file field code the desktop opens MolBioCraft without the file the user opened.
  expect(entry.Exec, 'the .deb Exec= passes the opened files').toMatch(/\s%[FfUu]$/);

  // macOS: no document type claims a generic type or every extension, and no exported type a generic MIME type.
  const mac = { ...bundlerAssociationKeys(conf), ...macUserPlist(conf) };
  const docs = asList(mac.CFBundleDocumentTypes).map(asRecord);
  expect(
    docs.flatMap((d) => [
      ...strings(d.LSItemContentTypes).filter(isGenericUti),
      ...strings(d.CFBundleTypeMIMETypes).filter(isGenericMime),
      ...strings(d.CFBundleTypeExtensions).filter((e) => e === '*'),
    ].map((t) => `${String(d.CFBundleTypeName)}: ${t}`)),
    'macOS document types claiming a generic type'
  ).toEqual([]);
  expect(
    asList(mac.UTExportedTypeDeclarations).map(asRecord).flatMap((t) => {
      const m = asRecord(t.UTTypeTagSpecification)['public.mime-type'];
      return typeof m === 'string' && isGenericMime(m) ? [`${String(t.UTTypeIdentifier)}: ${m}`] : [];
    }),
    'macOS exported types with a generic MIME type'
  ).toEqual([]);
});

/** The 16 extensions Sprint 4's packaging/macos/Info.plist registered besides .mbc (commit dc98822). */
const SPRINT4_MAC_EXTENSIONS = ['gb', 'gbk', 'fasta', 'fa', 'fna', 'faa', 'embl', 'gff3', 'dna', 'ab1', 'pdb', 'cif', 'vcf', 'fastq', 'sam', 'bed'];
/**
 * A Sprint 4 extension dropped on purpose -> the decision in sdlc-studio/decisions.md that records it.
 * .dna: MolBioCraft no longer reads the proprietary plasmid file type (CR-01M6T9MT, US-01M6TDCD).
 */
const DROPPED_BY_DECISION: Record<string, string> = { dna: 'D0087' };

it('exports the mbc type and registers every Sprint 4 extension', () => {
  // The registration rule, on cases it must tell apart: macOS ignores y's extension beside a content
  // type that does not carry it, and opens nothing for role None or rank None.
  const rule: Json = {
    UTExportedTypeDeclarations: [{ UTTypeIdentifier: 'org.x', UTTypeTagSpecification: { 'public.filename-extension': ['x'] } }],
    CFBundleDocumentTypes: [
      { CFBundleTypeExtensions: ['x', 'y'], LSItemContentTypes: ['org.x'], CFBundleTypeRole: 'Editor', LSHandlerRank: 'Owner' },
      { CFBundleTypeExtensions: ['z'], CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate' },
      { CFBundleTypeExtensions: ['n'], CFBundleTypeRole: 'None', LSHandlerRank: 'Default' },
      { CFBundleTypeExtensions: ['r'], CFBundleTypeRole: 'Editor', LSHandlerRank: 'None' },
    ],
  };
  expect([...macRegisteredExtensions(rule)].sort(), 'the extensions the registration rule counts').toEqual(['x', 'z']);

  const conf = readConf();
  const own = bundlerAssociationKeys(conf);
  const user = macUserPlist(conf);
  // Any other key would replace the bundler's own in the built app (CFBundleExecutable, the version).
  expect(Object.keys(user).sort(), 'the keys src-tauri/Info.plist and bundle.macOS.infoPlist set').toEqual(['CFBundleDocumentTypes', 'UTExportedTypeDeclarations']);
  const mac = { ...own, ...user };

  // .mbc: exported as org.molbiocraft.workbench, conforming to public.json and public.data, and claimed as its owner.
  const workbench = asList(mac.UTExportedTypeDeclarations).map(asRecord).filter((t) => t.UTTypeIdentifier === 'org.molbiocraft.workbench');
  expect(workbench.length, 'exported org.molbiocraft.workbench declarations').toBe(1);
  expect(strings(workbench[0].UTTypeConformsTo).sort(), 'what org.molbiocraft.workbench conforms to').toEqual(['public.data', 'public.json']);
  expect(strings(asRecord(workbench[0].UTTypeTagSpecification)['public.filename-extension']), 'the extensions of org.molbiocraft.workbench').toEqual(['mbc']);
  const mbcDocs = asList(mac.CFBundleDocumentTypes).map(asRecord).filter((d) => strings(d.CFBundleTypeExtensions).includes('mbc') || strings(d.LSItemContentTypes).includes('org.molbiocraft.workbench'));
  expect(mbcDocs.map((d) => [strings(d.LSItemContentTypes), d.LSHandlerRank]), 'the .mbc document type: its content types and rank').toEqual([[['org.molbiocraft.workbench'], 'Owner']]);

  // tauri.conf.json exports the type itself, and the macOS Info.plist file drops or changes nothing
  // the bundler renders from it, so macOS adds to the associations the other platforms get.
  expect(asList(own.UTExportedTypeDeclarations).map((t) => asRecord(t).UTTypeIdentifier), 'the types tauri.conf.json exports').toEqual(['org.molbiocraft.workbench']);
  const keeps = (list: unknown, entry: unknown): boolean => asList(list).some((x) => JSON.stringify(canonical(x)) === JSON.stringify(canonical(entry)));
  for (const key of ['UTExportedTypeDeclarations', 'CFBundleDocumentTypes']) {
    expect(asList(own[key]).filter((e) => !keeps(mac[key], e)), `${key} entries from tauri.conf.json that macOS drops or changes`).toEqual([]);
  }

  // Every Sprint 4 extension opens on macOS, or a decision records dropping it.
  const registered = macRegisteredExtensions(mac);
  expect(['mbc', ...SPRINT4_MAC_EXTENSIONS].filter((e) => !registered.has(e) && DROPPED_BY_DECISION[e] === undefined), 'Sprint 4 extensions macOS does not open with MolBioCraft').toEqual([]);
  if (fs.existsSync(repo('sdlc-studio/decisions.md'))) {
    const decisions = text(repo('sdlc-studio/decisions.md')).split('\n');
    for (const [e, id] of Object.entries(DROPPED_BY_DECISION)) {
      expect(decisions.find((l) => l.startsWith(`| ${id} |`)) ?? '', `${id}, the decision dropping .${e}`).toContain(`.${e}`);
    }
  }

  // Each extension registered on any platform is one the desktop shell opens.
  const confExts = associationsOf(conf).flatMap(extsOf);
  const importable = importableExtensions();
  expect([...new Set([...registered, ...confExts])].filter((e) => !importable.includes(e)).sort(), 'registered extensions the shell will not open').toEqual([]);
  // Windows: one ProgId MolBioCraft.<ext> per extension, so none may repeat; and .pdb (program
  // databases) and .vcf (contact cards) belong to other programs there, so they stay macOS-only.
  expect(confExts.filter((e, i) => confExts.indexOf(e) !== i), 'extensions bundle.fileAssociations lists twice').toEqual([]);
  expect(confExts.filter((e) => e === 'pdb' || e === 'vcf'), 'bundle.fileAssociations extensions Windows gives to other programs').toEqual([]);
});

it('builds each installer on its own OS runner and publishes exactly the four files', { timeout: 120_000 }, () => {
  const wf = releaseWorkflow();
  const trigger = (wf.on ?? wf.true) as { push?: { tags?: unknown; branches?: unknown }; workflow_dispatch?: unknown } | undefined;
  expect(trigger !== undefined && Object.keys(trigger).sort(), 'release.yml triggers').toEqual(['push', 'workflow_dispatch']);
  expect(trigger?.push, 'a push runs it for v* tags only').toEqual({ tags: ['v*'] });
  expect(wf.env?.TAURI_CLI, 'the Tauri CLI the builds run').toBe(TAURI_CLI);
  expect(wf.permissions, 'the workflow token reads only').toEqual({ contents: 'read' });

  // One job per OS, each after the reference check, plus the checksums and publish jobs.
  expect(Object.keys(wf.jobs).sort()).toEqual(['checksums', 'linux', 'macos', 'publish', 'reference-check', 'windows']);
  const runner = (j: string): string | undefined => wf.jobs[j]['runs-on'];
  expect({ macos: runner('macos'), windows: runner('windows'), linux: runner('linux') }).toEqual({ macos: 'macos-latest', windows: 'windows-latest', linux: 'ubuntu-22.04' });
  for (const j of ['macos', 'windows', 'linux']) {
    expect(wf.jobs[j].needs, `${j} needs the reference check`).toBe('reference-check');
    expect(wf.jobs[j].if, `${j} always runs after the check`).toBeUndefined();
    expect(wf.jobs[j].env?.VERSION, `${j} names its files with the checked version`).toBe('${{ needs.reference-check.outputs.version }}');
  }
  const check = wf.jobs['reference-check'].steps.find((s) => s.run === 'node scripts/check_reference_suite.mjs');
  expect(check !== undefined && check.if === undefined && !('continue-on-error' in check), 'the reference check is a plain step').toBe(true);
  expect(wf.jobs['reference-check'].outputs?.version).toBe('${{ steps.version.outputs.version }}');

  // Every step that uploads, and what: one artifact per file, named after it.
  const uploads = (j: string): Array<[unknown, unknown]> =>
    wf.jobs[j].steps.filter((s) => s.uses === 'actions/upload-artifact@v4').map((s) => [s.with?.name, s.with?.path]);
  const asUploaded = (names: string[], dir: string): Array<[string, string]> => names.map((n) => [n, `${dir}/${n}`]);
  const v = '${{ env.VERSION }}';
  const [dmgName, msiName, portableName, debName] = INSTALLERS(v);
  expect(uploads('macos')).toEqual(asUploaded([dmgName], 'release'));
  expect(uploads('windows')).toEqual(asUploaded([msiName, portableName], 'release'));
  expect(uploads('linux')).toEqual(asUploaded([debName], 'release'));
  expect(uploads('checksums')).toEqual(asUploaded(['SHA256SUMS.txt', 'NOTICE.txt', 'PROVENANCE.md'], 'release'));
  for (const j of ['macos', 'windows', 'linux', 'checksums']) {
    for (const s of wf.jobs[j].steps.filter((x) => x.uses === 'actions/upload-artifact@v4')) expect(s.with?.['if-no-files-found'], `${j}: ${s.name}`).toBe('error');
  }
  expect(uploads('publish')).toEqual([]);

  // Only the publish job publishes, only for a pushed v* tag, and it attaches exactly the seven files.
  const publishers = Object.entries(wf.jobs).flatMap(([j, job]) =>
    job.steps.filter((s) => (s.uses ?? '').startsWith('softprops/action-gh-release') || /\bgh\s+release\b/.test(s.run ?? '')).map(() => j)
  );
  expect(publishers, 'the jobs with a step that publishes a release').toEqual(['publish']);
  const writers = Object.entries(wf.jobs).filter(([, job]) => job.permissions?.contents === 'write').map(([j]) => j);
  expect(writers, 'the jobs whose token can write contents').toEqual(['publish']);
  const publish = wf.jobs.publish;
  expect(publish.if, 'publish runs for a pushed v* tag only, never for workflow_dispatch').toBe("github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
  expect(publish.needs).toEqual(['reference-check', 'checksums']);
  expect(wf.jobs.checksums.needs).toEqual(['reference-check', 'macos', 'windows', 'linux']);
  const release = publish.steps.find((s) => s.uses === 'softprops/action-gh-release@v2');
  expect(release?.with?.fail_on_unmatched_files, 'a missing file fails the release').toBe(true);
  const attached = String(release?.with?.files ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  expect(attached).toEqual([...INSTALLERS(v), 'SHA256SUMS.txt', 'NOTICE.txt', 'PROVENANCE.md'].map((n) => `assets/${n}`));
  const download = publish.steps.find((s) => s.uses === 'actions/download-artifact@v4');
  expect(download?.with).toEqual({ path: 'assets', 'merge-multiple': true });
  expect(publish.steps.find((s) => s.run === 'sha256sum --check --strict SHA256SUMS.txt')?.['working-directory'], 'the checksums are verified before publishing').toBe('assets');

  // macOS: the job runs build_installers.sh (its checks are run in the next test) on the Apple
  // targets, and the app is ad-hoc signed.
  expect(wf.jobs.macos.steps.map((s) => s.run).filter(Boolean)).toEqual(['npm ci', './scripts/build_installers.sh']);
  const macToolchain = wf.jobs.macos.steps.find((s) => s.uses === 'dtolnay/rust-toolchain@stable');
  expect(String(macToolchain?.with?.targets).split(',').sort()).toEqual(['aarch64-apple-darwin', 'wasm32-unknown-unknown', 'x86_64-apple-darwin']);
  const macOS = (JSON.parse(text(repo('src-tauri/tauri.conf.json'))) as { bundle: { macOS?: { signingIdentity?: string } } }).bundle.macOS;
  expect(macOS?.signingIdentity, 'the macOS app is ad-hoc signed').toBe('-');
  expect(wf.jobs.windows.steps.find((s) => s.uses === 'dtolnay/rust-toolchain@stable')?.with?.targets).toBe('x86_64-pc-windows-msvc,wasm32-unknown-unknown');
  expect(wf.jobs.linux.steps.find((s) => s.uses === 'dtolnay/rust-toolchain@stable')?.with?.targets).toBe('x86_64-unknown-linux-gnu,wasm32-unknown-unknown');
  const apt = wf.jobs.linux.steps.map((s) => s.run ?? '').find((r) => r.includes('apt-get install')) ?? '';
  for (const pkg of ['libwebkit2gtk-4.1-dev', 'libgtk-3-dev', 'librsvg2-dev']) expect(apt.split(/\s+/), `the Linux build installs ${pkg}`).toContain(pkg);

  if (!POSIX) {
    skipLine('running the Windows, Linux and checksums steps of release.yml');
    return;
  }

  // The version every file name carries comes from tauri.conf.json, and a tag must be v<version>.
  const versionStep = (refType: string, refName: string): { r: SpawnResult; out: string } =>
    inTemp('mbc-release-version-', (root) => {
      put(path.join(root, 'src-tauri', 'tauri.conf.json'), text(repo('src-tauri/tauri.conf.json')));
      const out = path.join(root, 'github-output');
      put(out, '');
      const r = runStep(wf, 'reference-check', 'version', root, { version: VERSION, env: { GITHUB_OUTPUT: out, GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: refName } });
      return { r, out: text(out) };
    });
  for (const [type, name] of [['branch', 'sdlc/sprint-05'], ['tag', `v${VERSION}`]]) {
    const ok = versionStep(type, name);
    expect(ok.r.status, output(ok.r)).toBe(0);
    expect(ok.out, `the version a ${type} run publishes`).toBe(`version=${VERSION}\n`);
  }
  const wrongTag = versionStep('tag', 'v99.0.0');
  expect(wrongTag.r.status, 'a tag that is not v<version>').not.toBe(0);
  expect(output(wrongTag.r)).toContain(`the tag v99.0.0 is not v${VERSION}, the version in src-tauri/tauri.conf.json`);

  // The build steps run the pinned Tauri CLI with the target and bundle each AC names.
  for (const [job, target, bundles] of [['windows', 'x86_64-pc-windows-msvc', 'msi'], ['linux', 'x86_64-unknown-linux-gnu', 'deb']]) {
    inTemp(`mbc-release-${job}-build-`, (root) => {
      const stubs = path.join(root, 'stubs');
      writeExecutable(path.join(stubs, 'npx'), logStub('npx'));
      const r = runStep(wf, job, 'build', root, { version: VERSION, stubs, env: { MBC_LOG: path.join(root, 'ran.jsonl') } });
      expect(r.status, output(r)).toBe(0);
      expect(logged(path.join(root, 'ran.jsonl'))).toEqual([['npx', '--yes', `--package=${TAURI_CLI}`, '--', 'tauri', 'build', '--target', target, '--bundles', bundles, '--ci']]);
    });
  }

  // Windows: stage, then check. The portable EXE is the release molbiocraft-desktop.exe.
  const windows = (o: Parameters<typeof windowsTree>[2]): { r: SpawnResult; release: string[]; portable: string } =>
    inTemp('mbc-release-windows-', (root) => {
      windowsTree(root, VERSION, o);
      const staged = runStep(wf, 'windows', 'stage', root, { version: VERSION });
      expect(staged.status, output(staged)).toBe(0);
      const r = runStep(wf, 'windows', 'self-check', root, { version: VERSION });
      const portable = path.join(root, 'release', `MolBioCraft-${VERSION}-Windows-x64-Portable.exe`);
      return { r, release: fs.readdirSync(path.join(root, 'release')).sort(), portable: sha256(portable) };
    });
  const win = windows({});
  expect(win.r.status, output(win.r)).toBe(0);
  expect(win.release).toEqual([`MolBioCraft-${VERSION}-Windows-x64-Portable.exe`, `MolBioCraft-${VERSION}-Windows-x64.msi`]);
  expect(output(win.r)).toContain(`release/MolBioCraft-${VERSION}-Windows-x64-Portable.exe: PE32+ x86-64`);
  expect(output(win.r)).toMatch(/msi-admin\/PFiles\/MolBioCraft\/molbiocraft-desktop\.exe: PE32\+ x86-64/);
  const armPortable = windows({ portable: PE_ARM64 });
  expect(armPortable.r.status).not.toBe(0);
  expect(output(armPortable.r)).toContain('PE machine 0xaa64, not x86-64 (0x8664)');
  const x86Installed = windows({ installed: PE_X86 });
  expect(x86Installed.r.status).not.toBe(0);
  expect(output(x86Installed.r)).toContain('PE machine 0x14c, not x86-64 (0x8664)');
  const pe32Header = windows({ portable: pe(0x8664, 0x10b) });
  expect(pe32Header.r.status).not.toBe(0);
  expect(output(pe32Header.r)).toContain('optional-header magic 0x10b, not PE32+ (0x20b)');
  const noExe = windows({ installed: null });
  expect(noExe.r.status).not.toBe(0);
  expect(output(noExe.r)).toContain('the MSI must install one molbiocraft-desktop.exe, and installs 0');

  // Linux: stage and check the .deb.
  const linux = (files: Record<string, string | Uint8Array>, arch = 'amd64'): { r: SpawnResult; release: string[] } =>
    inTemp('mbc-release-linux-', (root) => {
      const stubs = linuxTree(root, VERSION, files);
      const r = runStep(wf, 'linux', 'self-check', root, { version: VERSION, stubs, env: { MBC_DEB_ARCH: arch } });
      return { r, release: fs.existsSync(path.join(root, 'release')) ? fs.readdirSync(path.join(root, 'release')).sort() : [] };
    });
  const deb = linux(DEB_FILES());
  expect(deb.r.status, output(deb.r)).toBe(0);
  expect(deb.release).toEqual([`MolBioCraft-${VERSION}-Linux-x86_64.deb`]);
  expect(output(deb.r)).toMatch(/usr\/bin\/molbiocraft-desktop: ELF 64-bit LSB x86-64/);
  const armDeb = linux({ ...DEB_FILES(), 'usr/bin/molbiocraft-desktop': ELF_AARCH64 });
  expect(armDeb.r.status).not.toBe(0);
  expect(output(armDeb.r)).toContain('ELF machine 183, not x86-64 (62)');
  const elf32 = linux({ ...DEB_FILES(), 'usr/bin/molbiocraft-desktop': elf(62, 1) });
  expect(elf32.r.status).not.toBe(0);
  expect(output(elf32.r)).toContain('not a 64-bit ELF (EI_CLASS 1)');
  const arm64Field = linux(DEB_FILES(), 'arm64');
  expect(arm64Field.r.status).not.toBe(0);
  expect(output(arm64Field.r)).toContain(`release/MolBioCraft-${VERSION}-Linux-x86_64.deb is for arm64, not amd64`);
  const { 'usr/bin/molbiocraft-desktop': _binary, ...noBinary } = DEB_FILES();
  const missing = linux(noBinary);
  expect(missing.r.status).not.toBe(0);
  expect(output(missing.r)).toContain('lists no usr/bin/molbiocraft-desktop');

  // checksums: the four downloaded installers, NOTICE.txt and PROVENANCE.md, and nothing else.
  const checksums = (names: string[]): { r: SpawnResult; sums: string; dir: Record<string, string> } =>
    inTemp('mbc-release-checksums-', (root) => {
      putCheckout(root);
      for (const n of names) put(path.join(root, 'release', n), `stand-in ${n}\n`);
      const r = runStep(wf, 'checksums', 'checksums', root, { version: VERSION });
      const rel = path.join(root, 'release');
      const sums = fs.existsSync(path.join(rel, 'SHA256SUMS.txt')) ? text(path.join(rel, 'SHA256SUMS.txt')) : '';
      return { r, sums, dir: Object.fromEntries(fs.readdirSync(rel).sort().map((n) => [n, sha256(path.join(rel, n))])) };
    });
  const sums = checksums(INSTALLERS(VERSION));
  expect(sums.r.status, output(sums.r)).toBe(0);
  const listed = Object.fromEntries(sums.sums.split('\n').filter(Boolean).map((l) => { const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l); return [m?.[2] ?? l, m?.[1] ?? 'unparsed']; }));
  const { 'SHA256SUMS.txt': _sumsFile, ...covered } = sums.dir;
  expect(listed, 'SHA256SUMS.txt lists every other published file with its SHA-256').toEqual(covered);
  expect(Object.keys(sums.dir).sort()).toEqual([...INSTALLERS(VERSION), 'NOTICE.txt', 'PROVENANCE.md', 'SHA256SUMS.txt'].sort());
  const extra = checksums([...INSTALLERS(VERSION), `MolBioCraft-${VERSION}-Windows-x64-Setup.exe`]);
  expect(extra.r.status, 'an installer outside the four fails the checksums step').not.toBe(0);
  const short = checksums(INSTALLERS(VERSION).slice(0, 3));
  expect(short.r.status, 'a missing installer fails the checksums step').not.toBe(0);
});

it('builds only the macOS installers locally', { timeout: 120_000 }, () => {
  // package:installers still runs the script; the hand-assembled MSI/.deb writer and the NSIS
  // and WiX sources are gone.
  const pkg = JSON.parse(text(repo('package.json'))) as { scripts: Record<string, string> };
  expect(pkg.scripts['package:installers']).toBe('./scripts/build_installers.sh');
  const removed = ['scripts/build_msi_and_linux.py', 'packaging/windows/installer.nsi', 'packaging/windows/launcher.nsi', 'packaging/windows/molbiocraft.wxs'];
  expect(removed.filter((f) => fs.existsSync(repo(f))), 'removed packaging files that still exist').toEqual([]);

  if (!POSIX) {
    skipLine('running scripts/build_installers.sh');
    return;
  }
  const universal = buildMac({ app: { archs: 'x86_64 arm64' } });
  expect(universal.r.status, output(universal.r)).toBe(0);
  // It builds the engine, then the universal .app and .dmg with the pinned Tauri CLI, and nothing
  // else: no cargo, Python, makensis or rustup of its own.
  expect(universal.ran).toEqual([
    ['npm', 'run', 'wasm:build'],
    ['npx', '--yes', `--package=${TAURI_CLI}`, '--', 'tauri', 'build', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg', '--ci'],
  ]);
  expect(universal.release, 'what release/ holds').toEqual([`MolBioCraft-${VERSION}-macOS-universal.dmg`]);
  expect(universal.dmgDigest, 'release/ holds the .dmg the bundler wrote').toBe(universal.builtDigest);
  expect(output(universal.r)).toContain('molbiocraft-desktop is universal (x86_64 arm64)');

  // lipo -archs must list both slices, in the built .app and in the .app inside the .dmg.
  for (const [archs, missing] of [['arm64', 'x86_64'], ['x86_64', 'arm64']]) {
    const single = buildMac({ app: { archs } });
    expect(single.r.status, `a ${archs}-only binary`).not.toBe(0);
    expect(output(single.r)).toContain(`molbiocraft-desktop has no ${missing} slice (lipo -archs: ${archs})`);
    expect(single.release, `nothing is copied to release/ for a ${archs}-only build`).toEqual([]);
  }
  const thinImage = buildMac({ app: { archs: 'x86_64 arm64' }, dmgApp: { archs: 'arm64' } });
  expect(thinImage.r.status, 'a .dmg holding an arm64-only app').not.toBe(0);
  expect(output(thinImage.r)).toContain('has no x86_64 slice');
  const unsigned = buildMac({ app: { archs: 'x86_64 arm64', signed: false } });
  expect(unsigned.r.status, 'an unsigned .app').not.toBe(0);
  expect(output(unsigned.r)).toContain('does not verify');
  const noImage = buildMac({ app: { archs: 'x86_64 arm64' }, dmg: false });
  expect(noImage.r.status, 'no .dmg').not.toBe(0);
  expect(output(noImage.r)).toContain(`the bundler wrote no src-tauri/target/universal-apple-darwin/release/bundle/dmg/MolBioCraft_${VERSION}_universal.dmg`);
});

/** The README's install section: from its Downloads & Installation heading to the next ## heading. */
function installSection(): string {
  const readme = text(repo('README.md'));
  const start = readme.search(/^## .*Downloads &(amp;)? Installation/m);
  expect(start, 'README.md has a Downloads & Installation section').toBeGreaterThanOrEqual(0);
  const rest = readme.slice(start + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

it('documents the four downloads and the unsigned first-launch steps', () => {
  const section = installSection();
  for (const name of INSTALLERS('<version>')) expect(section, `the install section names ${name}`).toContain(name);
  expect(section, 'no NSIS Setup.exe, rpm or AppImage is offered').not.toMatch(/Setup\.exe|\.rpm\b|AppImage/);
  // Unsigned builds: how to open each the first time.
  expect(section).toMatch(/Control-click[^\n]*\bOpen\b/);
  expect(section).toContain('xattr -dr com.apple.quarantine /Applications/MolBioCraft.app');
  expect(section).toMatch(/SmartScreen[^\n]*More info[^\n]*Run anyway/);
  expect(section).toMatch(/Portable[^\n]*WebView2[^\n]*Windows 10 and 11/);
  expect(section).toContain('sudo apt install ./MolBioCraft-<version>-Linux-x86_64.deb');
  expect(section, 'the checksums and notices published beside them').toMatch(/SHA256SUMS\.txt[\s\S]*NOTICE\.txt[\s\S]*PROVENANCE\.md/);
});

it('names the three runners and four artifacts in AGENTS.md and the TRD', () => {
  const runners = ['macos-latest', 'windows-latest', 'ubuntu-22.04'];
  const artifacts = INSTALLERS('<v>');
  const describes = (where: string, block: string): void => {
    for (const s of [...runners, ...artifacts]) expect(block, `${where} names ${s}`).toContain(s);
    expect(block, `${where} names no NSIS Setup.exe or makensis`).not.toMatch(/Setup\.exe|makensis|NSIS/);
  };

  // AGENTS.md: the Deploy & CI bullet, up to the next bullet.
  if (fs.existsSync(repo('AGENTS.md'))) {
    const agents = text(repo('AGENTS.md'));
    const deploy = /^- \*\*Deploy & CI:\*\*[\s\S]*?(?=^- \*\*)/m.exec(agents)?.[0] ?? '';
    expect(deploy, 'AGENTS.md has a Deploy & CI bullet').not.toBe('');
    describes('AGENTS.md Deploy & CI', deploy);
    expect(deploy).toContain('workflow_dispatch');
  }

  // The TRD: its Release service row, and one Deployment Topology row per artifact naming its runner.
  if (fs.existsSync(repo('sdlc-studio/trd.md'))) {
    const trd = text(repo('sdlc-studio/trd.md'));
    const rows = trd.split('\n').filter((l) => l.startsWith('|'));
    const releaseRow = rows.find((l) => /^\| Release \| GitHub Actions `release\.yml` \|/.test(l)) ?? '';
    expect(releaseRow, 'the TRD Release service row').not.toBe('');
    for (const r of runners) expect(releaseRow, `the TRD Release row names ${r}`).toContain(r);
    expect(releaseRow).not.toMatch(/macOS runner only|Setup\.exe/);
    const builtOn = ['macos-latest', 'windows-latest', 'windows-latest', 'ubuntu-22.04'];
    artifacts.forEach((a, i) => {
      const row = rows.find((l) => l.includes(`\`${a}\``)) ?? '';
      expect(row, `a TRD row for ${a}`).not.toBe('');
      expect(row, `the TRD row for ${a} names its runner`).toContain(builtOn[i]);
      expect(row, `the TRD row for ${a} says the Tauri bundler builds it`).toMatch(/[Tt]auri bundler|tauri build/);
    });
    expect(rows.filter((l) => /Setup\.exe|\bnsis\b|rpm|appimage/i.test(l)), 'TRD rows that still name NSIS, rpm or AppImage packages').toEqual([]);
  }

  // CHANGELOG.md: an entry for this change naming the four downloads, in a section newer than
  // 0.2.0 - under Unreleased until a release, then under that release's heading (BG-01M6ZGN1).
  const changelog = text(repo('CHANGELOG.md'));
  const before020 = changelog.indexOf('\n## [0.2.0]');
  expect(before020, 'CHANGELOG.md has a [0.2.0] section').toBeGreaterThan(0);
  const entry = changelog.slice(0, before020).split('\n').find((l) => l.startsWith('- ') && l.includes('US-01M6TK7V')) ?? '';
  expect(entry, 'the CHANGELOG entry for US-01M6TK7V, newer than 0.2.0').not.toBe('');
  for (const a of INSTALLERS('<version>')) expect(entry, `the CHANGELOG entry names ${a}`).toContain(a);
});
