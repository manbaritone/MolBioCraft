// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The WASM build's host-path guard, the remaps it checks for, the rustflags it runs cargo with and
 * its rustflags check (scripts/build_rust_wasm.mjs, BG-01M6PVZB).
 *
 * The guard is exercised three ways. Directly, on byte buffers holding the cargo homes of a local
 * toolchain, a Windows runner, a Docker root user and the rust image. Through the remaps the build
 * computes for a checkout under each CI OS's path rules (path.posix for ubuntu-latest and
 * macos-latest, path.win32 for windows-latest), against the strings cargo writes on that OS, so one
 * OS checks the others. And through the build's own entry point (`--emit-only`), run from a
 * throwaway copy of the script with a CARGO_HOME that is absolute on the OS running it, so the test
 * fails if the build stops calling the guard. No Windows machine has run the path.win32 cases.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMachineRemaps,
  cargoEncodedRustflags,
  droppedConfigRustflags,
  findHostPath,
  hostPathRemaps,
} from '../../scripts/build_rust_wasm.mjs';

interface NodeFs {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (p: string, o?: { recursive: boolean }) => void;
  copyFileSync: (from: string, to: string) => void;
  writeFileSync: (p: string, data: string | Uint8Array) => void;
  readFileSync: (p: string) => Uint8Array;
  existsSync: (p: string) => boolean;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
  symlinkSync: (target: string, p: string, type: string) => void;
  chmodSync: (p: string, mode: number) => void;
  realpathSync: { native: (p: string) => string };
}
interface PathRules {
  join: (...p: string[]) => string;
  resolve: (...p: string[]) => string;
  parse: (p: string) => { root: string };
  sep: string;
}
interface NodePath extends PathRules {
  posix: PathRules;
  win32: PathRules;
}
interface NodeOs { tmpdir: () => string }
interface NodeUrl { fileURLToPath: (u: URL) => string }
interface SpawnResult { status: number | null; stdout: string; stderr: string }
interface NodeChildProcess {
  spawnSync: (cmd: string, args: string[], o: { env: Record<string, string | undefined>; encoding: 'utf8' }) => SpawnResult;
}
interface NodeProcess { execPath: string; platform: string; env: Record<string, string | undefined> }

const load = <T,>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const [fs, path, os, url, cp] = await Promise.all([
  load<NodeFs>('node:fs'),
  load<NodePath>('node:path'),
  load<NodeOs>('node:os'),
  load<NodeUrl>('node:url'),
  load<NodeChildProcess>('node:child_process'),
]);
const proc = (globalThis as unknown as { process: NodeProcess }).process;

const SCRIPT = url.fileURLToPath(new URL('../../scripts/build_rust_wasm.mjs', import.meta.url));
const ENGINE = url.fileURLToPath(new URL('../../public/molbiocraft_wasm.wasm', import.meta.url));

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

// A crates.io panic-location path as rustc writes it: NUL-terminated, after other rodata.
const registryPath = (home: string, sep = '/'): string =>
  [home, 'registry', 'src', 'index.crates.io-1949cf8c6b5b557f', 'memchr-2.7.5', 'src', 'memchr.rs'].join(sep);
const rodata = (...paths: string[]): Uint8Array => bytes(`capacity overflow\0${paths.join('\0')}\0`);

// The paths a clean engine names: remapped crates.io sources (as rustc joins them on Linux, macOS
// and Windows) and git sources, a workspace-relative source, std's own sources and its vendored
// dependencies (both as the committed engine names them), a remapped rustup path, and a name /src
// only begins.
const clean = rodata(
  registryPath('/cargo'),
  registryPath('/cargo', '\\'),
  '/cargo/git/checkouts/noodles-3c1b4f7e9a2d5f60/0a1b2c3/noodles-fasta/src/lib.rs',
  'crates/x/src/lib.rs',
  '/rustc/58cf8f9c35b355199727627d07ae34a4e2846d67/library/core/src/fmt/mod.rs',
  '/rust/deps/hashbrown-0.17.1/src/raw/mod.rs',
  '/rust/deps/dlmalloc-0.2.14/src/dlmalloc.rs',
  '/rustup/toolchains/stable/lib/rustlib/src/rust/library/std/src/lib.rs',
  '/srcdir/notes.txt'
);

// An engine with one extra custom section: still a valid module, so only the path guard can refuse it.
const leb128 = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
};
const withCustomSection = (engine: Uint8Array, text: string): Uint8Array => {
  const name = bytes('mbc-guard-test');
  const body = [...leb128(name.length), ...name, ...bytes(text)];
  const tail = Uint8Array.from([0, ...leb128(body.length), ...body]);
  const out = new Uint8Array(engine.length + tail.length);
  out.set(engine, 0);
  out.set(tail, engine.length);
  return out;
};

const RUSTFLAGS_VARS = ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS', 'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS'];

/**
 * Runs a throwaway copy of the build script from its own root; returns its exit, whether it wrote
 * public/, the root's real path and the text of the file `read` (relative to the root) if any.
 */
function runBuildCopy(opts: {
  engine?: Uint8Array;
  args: string[];
  cargoHome: string;
  files?: Record<string, string>;
  executables?: string[];
  env?: Record<string, string>;
  read?: string;
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-wasm-guard-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'build_rust_wasm.mjs'));
    if (opts.engine) {
      const release = path.join(root, 'target', 'wasm32-unknown-unknown', 'release');
      fs.mkdirSync(release, { recursive: true });
      fs.writeFileSync(path.join(release, 'molbiocraft_wasm.wasm'), opts.engine);
    }
    for (const [rel, text] of Object.entries(opts.files ?? {})) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.join(file, '..'), { recursive: true });
      fs.writeFileSync(file, text);
    }
    for (const rel of opts.executables ?? []) fs.chmodSync(path.join(root, rel), 0o755);
    const env: Record<string, string | undefined> = { ...proc.env, CARGO_HOME: opts.cargoHome, RUSTUP_HOME: path.join(opts.cargoHome, '..', '.rustup') };
    for (const name of RUSTFLAGS_VARS) delete env[name];
    Object.assign(env, opts.env);
    const r = cp.spawnSync(proc.execPath, [path.join(root, 'scripts', 'build_rust_wasm.mjs'), ...opts.args], { env, encoding: 'utf8' });
    const out = path.join(root, 'public', 'molbiocraft_wasm.wasm');
    const read = opts.read === undefined ? null : path.join(root, opts.read);
    return {
      realRoot: fs.realpathSync.native(root),
      status: r.status,
      stderr: r.stderr,
      emitted: fs.existsSync(out) ? fs.readFileSync(out) : null,
      read: read !== null && fs.existsSync(read) ? new TextDecoder().decode(fs.readFileSync(read)) : null,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A checkout on each CI OS, with each way CARGO_HOME reaches cargo there and the home cargo then
// writes before `registry/...` (the `home` crate: unset or empty is `.cargo` under the user's home,
// absolute is kept as given, anything else is pushed onto the build directory as Rust's
// PathBuf::push does it). On Windows a root-relative `/root/.cargo` takes the build directory's
// drive and keeps its own slashes, and a relative one keeps the separator it was written with.
// `bareHomes` are home directories PathBuf::push adds no separator after: empty, or a bare drive.
const CI_OS: Array<{
  os: string;
  p: PathRules;
  root: string;
  homedir: string;
  homes: Array<[string | undefined, string]>;
  bareHomes: Array<[string, string]>;
}> = [
  {
    os: 'posix (ubuntu-latest, macos-latest)',
    p: path.posix,
    root: '/home/runner/work/MolBioCraft/MolBioCraft',
    homedir: '/home/runner',
    bareHomes: [['', '.cargo']],
    homes: [
      [undefined, '/home/runner/.cargo'],
      ['', '/home/runner/.cargo'],
      ['/root/.cargo', '/root/.cargo'],
      ['/usr/local/cargo', '/usr/local/cargo'],
      ['.toolchain/cargo', '/home/runner/work/MolBioCraft/MolBioCraft/.toolchain/cargo'],
      ['/opt/../usr/local/cargo', '/opt/../usr/local/cargo'],
    ],
  },
  {
    os: 'win32 (windows-latest)',
    p: path.win32,
    root: 'D:\\a\\MolBioCraft\\MolBioCraft',
    homedir: 'C:\\Users\\runneradmin',
    bareHomes: [
      ['', '.cargo'],
      ['C:', 'C:.cargo'],
    ],
    homes: [
      [undefined, 'C:\\Users\\runneradmin\\.cargo'],
      ['', 'C:\\Users\\runneradmin\\.cargo'],
      ['C:/Users/runneradmin/.cargo', 'C:/Users/runneradmin/.cargo'],
      // A UNC path has a prefix, so it is absolute and kept as given.
      ['\\\\fileserver\\tools\\cargo', '\\\\fileserver\\tools\\cargo'],
      ['/root/.cargo', 'D:/root/.cargo'],
      ['\\root\\.cargo', 'D:\\root\\.cargo'],
      ['.toolchain/cargo', 'D:\\a\\MolBioCraft\\MolBioCraft\\.toolchain/cargo'],
      // The entry-point case below as it runs on windows-latest: os.tmpdir() is a short-name path.
      ['C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\mbc-guard-cargo-home', 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\mbc-guard-cargo-home'],
    ],
  },
];

describe('scripts/build_rust_wasm.mjs host-path guard', () => {
  it('refuses an engine holding a host prefix and accepts a clean one', () => {
    // Refused: the local toolchain this repo's own engine leaked from.
    const local = hostPathRemaps({ root: '/Volumes/x', cargoHome: '/Volumes/x/.toolchain/cargo', rustupHome: '/Volumes/x/.toolchain/rustup' });
    // rustc applies the last remap that matches, so the cargo home nested in the root comes after it
    // (the other way round its sources would read .toolchain/cargo/registry/...).
    expect(local).toEqual([
      ['/Volumes/x', ''],
      ['/Volumes/x/.toolchain/cargo', '/cargo'],
      ['/Volumes/x/.toolchain/rustup', '/rustup'],
    ]);
    expect(findHostPath(rodata(registryPath('/Volumes/x/.toolchain/cargo')), local)).toBe('/Volumes/x/.toolchain/cargo');

    // Refused: a Windows runner's cargo home, with backslashes, forward slashes and the verbatim \\?\ form.
    const windows = hostPathRemaps({ root: 'D:\\a\\MolBioCraft\\MolBioCraft', cargoHome: 'C:\\Users\\runneradmin\\.cargo', rustupHome: 'C:\\Users\\runneradmin\\.rustup' });
    expect(windows).toContainEqual(['C:\\Users\\runneradmin\\.cargo', '/cargo']);
    expect(windows).toContainEqual(['C:/Users/runneradmin/.cargo', '/cargo']);
    expect(findHostPath(rodata(registryPath('C:\\Users\\runneradmin\\.cargo', '\\')), windows)).toBe('C:\\Users\\runneradmin\\.cargo');
    expect(findHostPath(rodata(registryPath('C:/Users/runneradmin/.cargo')), windows)).toBe('C:/Users/runneradmin/.cargo');
    expect(findHostPath(rodata(registryPath('\\\\?\\C:\\Users\\runneradmin\\.cargo', '\\')), windows)).toBe('C:\\Users\\runneradmin\\.cargo');
    // A drive path given with forward slashes is also looked for with backslashes.
    expect(hostPathRemaps({ root: 'D:/a', cargoHome: 'C:/Users/runneradmin/.cargo', rustupHome: 'C:/r' })).toContainEqual(['C:\\Users\\runneradmin\\.cargo', '/cargo']);

    // Refused: a Docker root user's and the rust image's cargo homes, when they are the CARGO_HOME passed in.
    const docker = hostPathRemaps({ root: '/src', cargoHome: '/root/.cargo', rustupHome: '/root/.rustup' });
    expect(findHostPath(rodata(registryPath('/root/.cargo')), docker)).toBe('/root/.cargo');
    expect(findHostPath(rodata('/root/.cargo'), docker)).toBe('/root/.cargo');
    const rustImage = hostPathRemaps({ root: '/src', cargoHome: '/usr/local/cargo', rustupHome: '/usr/local/rustup' });
    expect(findHostPath(rodata(registryPath('/usr/local/cargo')), rustImage)).toBe('/usr/local/cargo');
    // ...and the /src checkout root itself, at the start of a path or as the whole of one, after
    // a byte that cannot continue a path (`PWD=/src`).
    expect(findHostPath(rodata('/src/crates/molbiocraft-core/src/lib.rs'), rustImage)).toBe('/src');
    expect(findHostPath(bytes('\0/src'), rustImage)).toBe('/src');
    expect(findHostPath(rodata('PWD=/src/lib.rs'), rustImage)).toBe('/src');

    // Refused: a cargo home reached through a symlink, under the real path rustc sees.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-wasm-guard-'));
    try {
      fs.mkdirSync(path.join(tmp, 'real-cargo'));
      fs.symlinkSync(path.join(tmp, 'real-cargo'), path.join(tmp, 'cargo-link'), 'junction');
      const real = fs.realpathSync.native(path.join(tmp, 'real-cargo'));
      const linked = hostPathRemaps({ root: '/src', cargoHome: path.join(tmp, 'cargo-link'), rustupHome: '/usr/local/rustup' });
      expect(findHostPath(rodata(registryPath(real)), linked)).toBe(real);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Accepted: a clean engine under a checkout at /src, whose own paths hold /src only as an inner
    // component or as the start of a longer name.
    expect(findHostPath(clean, rustImage)).toBeNull();
    expect(findHostPath(clean, docker)).toBeNull();
    // Accepted: /src continuing a longer name to its left, after a UTF-8 byte or any of . _ - ~ + @.
    for (const name of ['café', 'v1.', 'my_', 'x-', 'bak~', 'c++', 'user@']) {
      expect(findHostPath(rodata(`${name}/src/lib.rs`), rustImage), name).toBeNull();
    }
    // A CARGO_HOME that already is /cargo remaps onto itself and hides nothing.
    expect(findHostPath(clean, hostPathRemaps({ root: '/src', cargoHome: '/cargo', rustupHome: '/rustup' }))).toBeNull();
    // The committed engine holds hundreds of "/src" substrings and no /src path.
    const engine = fs.readFileSync(ENGINE);
    expect(findHostPath(engine, rustImage)).toBeNull();

    // Accepted: the clean and committed engines under a checkout at a short root that std's paths
    // (/rustc/<commit>/, /rust/deps/) or the remap targets (/cargo, /rustup) begin with...
    for (const root of ['/rust', '/rustc', '/cargo', '/rustup']) {
      const remaps = hostPathRemaps({ root, cargoHome: '/root/.cargo', rustupHome: '/root/.rustup' });
      expect(findHostPath(clean, remaps), root).toBeNull();
      expect(findHostPath(engine, remaps), root).toBeNull();
      // ...while that checkout's own sources, left unremapped, are still refused.
      expect(findHostPath(rodata(`${root}/crates/molbiocraft-core/src/lib.rs`), remaps), root).toBe(root);
    }

    // Through the build's entry point, with a CARGO_HOME that is absolute on the OS running this:
    // an engine naming it, in each separator form cargo can write there, is refused and not emitted...
    const cargoHome = path.join(os.tmpdir(), 'mbc-guard-cargo-home');
    for (const form of new Set([cargoHome, cargoHome.replaceAll('\\', '/')])) {
      const leak = registryPath(form, form.includes('\\') ? '\\' : '/');
      const leaky = runBuildCopy({ engine: withCustomSection(engine, `\0${leak}\0`), args: ['--emit-only'], cargoHome });
      expect(leaky.stderr).toContain(`embeds the build-machine path ${form}`);
      expect(leaky.status).not.toBe(0);
      expect(leaky.emitted).toBeNull();
    }
    // ...and the clean engine is emitted unchanged.
    const emitted = runBuildCopy({ engine, args: ['--emit-only'], cargoHome });
    expect(emitted.stderr).toBe('');
    expect(emitted.status).toBe(0);
    expect(emitted.emitted).toEqual(engine);
  }, 120_000);

  it.each(CI_OS)('refuses an engine holding a host prefix and accepts a clean one under $os path rules', ({ p, root, homedir, homes, bareHomes }) => {
    const engine = fs.readFileSync(ENGINE);
    for (const [CARGO_HOME, written] of homes) {
      const remaps = buildMachineRemaps({ root, env: { CARGO_HOME }, homedir }, p);
      const label = `CARGO_HOME=${CARGO_HOME}`;
      expect(remaps, label).toContainEqual([written, '/cargo']);
      // Refused: the crates.io path cargo writes under that home, with this OS's separator after it.
      expect(findHostPath(rodata(registryPath(written, p.sep)), remaps), label).toBe(written);
      // Accepted: the clean and committed engines.
      expect(findHostPath(clean, remaps), label).toBeNull();
      expect(findHostPath(engine, remaps), label).toBeNull();
    }
    for (const [bare, written] of bareHomes) {
      expect(buildMachineRemaps({ root, env: {}, homedir: bare }, p), `homedir=${bare}`).toContainEqual([written, '/cargo']);
    }
    // RUSTUP_HOME is placed the same way, and the checkout root is refused in each separator form.
    const remaps = buildMachineRemaps({ root, env: {}, homedir }, p);
    expect(remaps).toContainEqual([p.join(homedir, '.rustup'), '/rustup']);
    const source = p.join(root, 'crates', 'molbiocraft-core', 'src', 'lib.rs');
    for (const form of new Set([source, source.replaceAll('\\', '/')])) {
      expect(findHostPath(rodata(form), remaps), form).toBe(form.slice(0, root.length));
    }
  });

  it('refuses a cargo config whose rustflags the build would silently drop', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-wasm-rustflags-'));
    try {
      const member = path.join(tmp, 'ws', 'member');
      const home = path.join(tmp, 'cargo-home');
      fs.mkdirSync(member, { recursive: true });
      fs.mkdirSync(path.join(tmp, 'ws', '.cargo'));
      fs.mkdirSync(home);
      const wsConfig = path.join(tmp, 'ws', '.cargo', 'config.toml');
      fs.writeFileSync(
        wsConfig,
        [
          // A top-level dotted key whose cfg cannot hold for wasm32-unknown-unknown (a comma inside the quoted key).
          `target.'cfg(all(unix, target_arch = "x86_64"))'.rustflags = ["-Ctarget-cpu=x86-64-v3"]`,
          '[build]',
          '# rustflags = ["commented out"]',
          'rustdocflags = ["--cfg", "docs"]',
          'jobs = 4',
          '[target.x86_64-apple-darwin] # host only',
          'rustflags = ["-Ctarget-cpu=native"]',
          `[target.'cfg(target_arch = "wasm32")']`,
          'rustflags = ["-Ctarget-feature=+simd128"]',
          // Tables whose cfg cannot hold for wasm32-unknown-unknown: cargo never applies them to it.
          `[target.'cfg(windows)']`,
          'rustflags = ["-Ctarget-feature=+crt-static"]',
          `[target.'cfg(target_os = "linux")']`,
          'rustflags = ["-Clink-arg=-fuse-ld=lld"]',
          `[target."cfg(not(target_family = \\"wasm\\"))"]`,
          'rustflags = ["-Cforce-frame-pointers=yes"]',
          `[target.'cfg(any())']`,
          'rustflags = ["-Cdebuginfo=2"]',
          // Tables whose cfg holds, or may hold, for it.
          `[target.'cfg(any(windows, target_family = "wasm"))']`,
          'rustflags = ["-Cdebuginfo=1"]',
          `[target."cfg(not(windows))"]`,
          'rustflags = ["-Copt-level=2"]',
          `[target.'cfg(all())']`,
          'rustflags = ["-Copt-level=1"]',
          `[target.'cfg(target_feature = "atomics")']`,
          'rustflags = ["-Clink-arg=--shared-memory"]',
          // debug_assertions is in the default `rustc --print cfg`, so a table testing it may apply.
          `[target.'cfg(debug_assertions)']`,
          'rustflags = ["-Coverflow-checks=off"]',
        ].join('\n')
      );
      const wsLegacyConfig = path.join(tmp, 'ws', '.cargo', 'config');
      fs.writeFileSync(wsLegacyConfig, '[target.wasm32-unknown-unknown]\nrustflags = ["-Clink-arg=--import-memory"]\n');
      const homeConfig = path.join(home, 'config.toml');
      fs.writeFileSync(
        homeConfig,
        ['build.rustflags = ["-Cdebuginfo=0"]', 'target = { wasm32-unknown-unknown = { rustflags = ["-Copt-level=s"] } }'].join('\n')
      );
      const homeLegacyConfig = path.join(home, 'config');
      fs.writeFileSync(homeLegacyConfig, 'build.rustflags = ["-Cembed-bitcode=no"]\n');

      const mine = (found: string[]) => found.filter((d) => d.includes(tmp));
      expect(mine(droppedConfigRustflags({ cwd: member, cargoHome: home, env: {} }))).toEqual([
        `target.'cfg(target_arch="wasm32")'.rustflags in ${wsConfig}`,
        `target.'cfg(any(windows,target_family="wasm"))'.rustflags in ${wsConfig}`,
        `target."cfg(not(windows))".rustflags in ${wsConfig}`,
        `target.'cfg(all())'.rustflags in ${wsConfig}`,
        `target.'cfg(target_feature="atomics")'.rustflags in ${wsConfig}`,
        `target.'cfg(debug_assertions)'.rustflags in ${wsConfig}`,
        `target.wasm32-unknown-unknown.rustflags in ${wsLegacyConfig}`,
        `build.rustflags in ${homeConfig}`,
        `target.wasm32-unknown-unknown.rustflags in ${homeConfig}`,
        `build.rustflags in ${homeLegacyConfig}`,
      ]);
      expect(droppedConfigRustflags({ cwd: member, cargoHome: home, env: { CARGO_BUILD_RUSTFLAGS: '-Cdebuginfo=0' } })).toContain(
        'the CARGO_BUILD_RUSTFLAGS environment variable'
      );
      // With RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS set, even empty, cargo already ignores config rustflags.
      expect(droppedConfigRustflags({ cwd: member, cargoHome: home, env: { RUSTFLAGS: '' } })).toEqual([]);
      expect(droppedConfigRustflags({ cwd: member, cargoHome: home, env: { CARGO_ENCODED_RUSTFLAGS: '' } })).toEqual([]);
      // A config that exists but cannot be read is not taken as "no rustflags".
      fs.mkdirSync(path.join(member, '.cargo', 'config.toml'), { recursive: true });
      expect(() => droppedConfigRustflags({ cwd: member, cargoHome: home, env: {} })).toThrow(/cannot read the cargo config/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Through the build's entry point: it stops before cargo runs, naming the config key and the
    // two ways out (move the flags into RUSTFLAGS, or set RUSTFLAGS= empty to build without them).
    const run = runBuildCopy({ args: [], cargoHome: path.join(os.tmpdir(), 'mbc-no-such-cargo-home'), files: { '.cargo/config.toml': '[build]\nrustflags = ["-Ctarget-cpu=mvp"]\n' } });
    expect(run.stderr).toContain('would silently drop: build.rustflags in ');
    expect(run.stderr).toContain(path.join('.cargo', 'config.toml'));
    expect(run.stderr).toContain('Pass those flags in RUSTFLAGS instead');
    expect(run.stderr).toContain('or set RUSTFLAGS= (empty) to build without them');
    expect(run.status).not.toBe(0);
  }, 60_000);

  it("carries the caller's RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS over alongside the remaps", () => {
    const remaps = hostPathRemaps({ root: '/w', cargoHome: '/w/.toolchain/cargo', rustupHome: '/w/.toolchain/rustup' });
    const remapFlags = ['--remap-path-prefix=/w=', '--remap-path-prefix=/w/.toolchain/cargo=/cargo', '--remap-path-prefix=/w/.toolchain/rustup=/rustup'];
    const encoded = (env: Record<string, string>) => cargoEncodedRustflags(env, remaps).split('\x1f');
    expect(encoded({})).toEqual(remapFlags);
    expect(encoded({ RUSTFLAGS: '' })).toEqual(remapFlags);
    expect(encoded({ RUSTFLAGS: ' -Ctarget-feature=+simd128  -Copt-level=s ' })).toEqual(['-Ctarget-feature=+simd128', '-Copt-level=s', ...remapFlags]);
    // CARGO_ENCODED_RUSTFLAGS wins over RUSTFLAGS, as it does in cargo, and keeps a flag holding a space whole.
    expect(encoded({ CARGO_ENCODED_RUSTFLAGS: '-Clink-arg=--export=a b\x1f-Copt-level=z', RUSTFLAGS: '-Cignored' })).toEqual([
      '-Clink-arg=--export=a b',
      '-Copt-level=z',
      ...remapFlags,
    ]);
  });

  // The stand-in cargo is a shell script, which Windows cannot run as an executable.
  it.skipIf(proc.platform === 'win32')("runs cargo with the caller's RUSTFLAGS and the remaps", () => {
    const run = runBuildCopy({
      args: [],
      cargoHome: path.join(os.tmpdir(), 'mbc-no-such-cargo-home'),
      env: { RUSTFLAGS: '-Ctarget-feature=+simd128' },
      files: { '.toolchain/cargo/bin/cargo': '#!/bin/sh\nprintf "%s" "$CARGO_ENCODED_RUSTFLAGS" > cargo-flags\nexit 3\n' },
      executables: ['.toolchain/cargo/bin/cargo'],
      read: 'cargo-flags',
    });
    expect(run.status).not.toBe(0);
    const flags = (run.read ?? '').split('\x1f');
    expect(flags[0]).toBe('-Ctarget-feature=+simd128');
    expect(flags).toContain(`--remap-path-prefix=${run.realRoot}=`);
    expect(flags).toContain(`--remap-path-prefix=${path.join(run.realRoot, '.toolchain', 'cargo')}=/cargo`);
  }, 60_000);
});
