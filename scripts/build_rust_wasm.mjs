#!/usr/bin/env node
// Copyright 2026 MolBioCraft Contributors
// Licensed under the MolBioCraft Personal & Academic Research License v1.0 (Non-Commercial)

/**
 * Compiles `crates/molbiocraft-wasm` (`wasm32-unknown-unknown --release`) with this machine's
 * source paths remapped (`--remap-path-prefix`), asserts the binary names none of them,
 * asserts zero external WASI/JS imports (`WebAssembly.Module.imports(mod).length === 0`),
 * performs an immediate synchronous smoke-test RPC invocation in Node.js,
 * and emits `public/molbiocraft_wasm.wasm` for Vite's `virtual:molbiocraft-wasm-bytes`
 * inline/SSR loader across React, Vitest, Vite browser bundles, standalone HTML, and native WebViews.
 *
 * Run as a script it builds; imported, it only exports the path guard, the remaps it checks for,
 * the rustflags it runs cargo with and the rustflags check (src/__tests__/buildRustWasmGuard.test.ts).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const realPathOr = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

// Rust's PathBuf::push, which cargo and rustup use to place a toolchain home: a value that is
// absolute (on Windows, one with a drive or UNC prefix) replaces the base; on Windows a value that
// starts with a separator keeps only the base's drive; anything else follows a separator, unless
// the base is empty, a bare drive or already ends in one. The value is written as given, so on
// Windows `/root/.cargo` pushed onto `D:\a` reads `D:/root/.cargo`.
const pushPath = (base, value, p) => {
  const win = p.sep === '\\';
  if (win ? /^(?:[A-Za-z]:|[\\/]{2})/.test(value) : value.startsWith('/')) return value;
  if (win && /^[\\/]/.test(value)) return p.parse(base).root.replace(/[\\/]$/, '') + value;
  const needSep = base !== '' && !(win ? /[\\/]$|^[A-Za-z]:$/ : /\/$/).test(base);
  return needSep ? base + p.sep + value : base + value;
};

// A toolchain home as cargo finds it (the `home` crate): an unset or empty variable means `.cargo`
// or `.rustup` under the user's home, and a set one is pushed onto the build directory. Returned in
// the form cargo writes into source paths, then normalised where that differs.
const toolchainHome = (value, defaultDir, { cwd, homedir }, p) => {
  const home = value ? pushPath(cwd, value, p) : pushPath(homedir, defaultDir, p);
  return [...new Set([home, p.resolve(cwd, home)])];
};

// A Windows path (one with a drive letter or any backslash) in its given, forward-slash and
// backslash forms, since cargo can write either separator after the home it was handed.
const slashForms = (p) => (/\\|^[A-Za-z]:/.test(p) ? [p, p.replaceAll('\\', '/'), p.replaceAll('/', '\\')] : [p]);

/**
 * The `--remap-path-prefix` pairs for a build: the workspace root to nothing (its sources then
 * read workspace-relative, as cargo already names them), CARGO_HOME to /cargo and RUSTUP_HOME to
 * /rustup. std's own sources already read /rustc/<commit>/... and its crates.io dependencies
 * /rust/deps/..., so they need none. Each prefix is listed in every form given, as its real path
 * and, for a Windows path, with each separator, shortest first, because rustc applies the last
 * remapping that matches and CARGO_HOME can sit inside the workspace root (it does with the local
 * .toolchain).
 *
 * @param {{ root: string | string[], cargoHome: string | string[], rustupHome: string | string[] }} homes absolute paths
 * @returns {Array<[string, string]>} [from, to] pairs
 */
export function hostPathRemaps({ root, cargoHome, rustupHome }) {
  return [
    [root, ''],
    [cargoHome, '/cargo'],
    [rustupHome, '/rustup'],
  ]
    .flatMap(([from, to]) => {
      const forms = [from].flat().flatMap((p) => [p, realPathOr(p)]).flatMap(slashForms);
      return [...new Set(forms)].map((p) => [p, to]);
    })
    .sort(([a], [b]) => a.length - b.length);
}

/**
 * The remaps this build passes for a checkout at `root` under `env`. CARGO_HOME and RUSTUP_HOME are
 * placed as cargo places them (pushPath), so the guard looks for the string cargo writes on the OS
 * whose path rules `p` follows.
 *
 * @param {{ root: string, env: Record<string, string | undefined>, homedir: string }} build
 * @param {{ join: (...p: string[]) => string, resolve: (...p: string[]) => string, parse: (p: string) => { root: string }, sep: string }} [p] the path rules, path.win32 or path.posix (default: this platform's)
 * @returns {Array<[string, string]>} [from, to] pairs, as hostPathRemaps
 */
export function buildMachineRemaps({ root, env, homedir }, p = path) {
  const at = { cwd: root, homedir };
  return hostPathRemaps({
    root,
    cargoHome: toolchainHome(env.CARGO_HOME, '.cargo', at, p),
    rustupHome: toolchainHome(env.RUSTUP_HOME, '.rustup', at, p),
  });
}

const isSeparator = (b) => b === 0x2f || b === 0x5c; // '/' or '\'
const isAlnum = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
// A byte that can continue a path to its left: a name character (UTF-8 included) or a separator.
const isPathByte = (b) => isAlnum(b) || isSeparator(b) || b >= 0x80 || '._-~+@'.includes(String.fromCharCode(b));
// The paths a clean engine names that a short checkout root such as /rust, /rustc or /cargo begins:
// std's sources at /rustc/<commit>/ and its crates.io dependencies at /rust/deps/, and what the
// CARGO_HOME and RUSTUP_HOME remaps write (/cargo/registry/, /cargo/git/, /rustup/toolchains/,
// which rustc joins on with `\` on Windows).
const CLEAN_PATH = /^\/(?:rustc[\\/][0-9a-f]{40}|rust[\\/]deps|cargo[\\/](?:registry|git)|rustup[\\/]toolchains)[\\/]/;

/**
 * The longest build-machine prefix the engine still names, or null. A prefix counts only as a whole
 * path prefix: followed by a path separator, a NUL (rustc ends its source paths with one) or the
 * end of the bytes, and not continuing a longer path to its left. So a checkout at /src does not
 * refuse an engine for its own `crates/x/src/lib.rs` or for `/cargo/registry/src/...`. Nor does a
 * checkout at /rust, /rustc or /cargo refuse it for the std and remapped paths in CLEAN_PATH,
 * though its own unremapped sources (`/rust/crates/...`) are still refused. A drive prefix
 * (`C:\...`) is a boundary after anything but a letter or digit, so a `\\?\C:\` form is still
 * caught. A remapping onto itself (CARGO_HOME already /cargo) names nothing to hide.
 *
 * @param {Uint8Array} bytes the engine
 * @param {Array<[string, string]>} remaps the pairs from hostPathRemaps
 * @returns {string | null}
 */
export function findHostPath(bytes, remaps) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const [prefix, to] of [...remaps].sort(([a], [b]) => b.length - a.length)) {
    if (prefix === to || prefix === '') continue;
    const needle = Buffer.from(prefix, 'utf8');
    const drive = /^[A-Za-z]:/.test(prefix);
    for (let i = buf.indexOf(needle); i !== -1; i = buf.indexOf(needle, i + 1)) {
      const after = i + needle.length < buf.length ? buf[i + needle.length] : null;
      const wholePrefix = after === null || after === 0 || isSeparator(after);
      const before = i > 0 ? buf[i - 1] : null;
      const atBoundary = before === null || (drive ? !isAlnum(before) : !isPathByte(before));
      if (wholePrefix && atBoundary && !CLEAN_PATH.test(buf.toString('latin1', i, i + 64))) return prefix;
    }
  }
  return null;
}

/**
 * The CARGO_ENCODED_RUSTFLAGS this build runs cargo with: the caller's CARGO_ENCODED_RUSTFLAGS
 * (0x1f-separated) or, when that is unset, RUSTFLAGS (whitespace-separated), then the remap flags,
 * last so that they win over any remapping of the caller's own.
 *
 * @param {Record<string, string | undefined>} env the caller's environment
 * @param {Array<[string, string]>} remaps the pairs from hostPathRemaps
 * @returns {string}
 */
export function cargoEncodedRustflags(env, remaps) {
  const callerFlags =
    env.CARGO_ENCODED_RUSTFLAGS !== undefined
      ? env.CARGO_ENCODED_RUSTFLAGS.split('\x1f')
      : (env.RUSTFLAGS ?? '').split(/\s+/);
  return [
    ...callerFlags.filter(Boolean),
    ...remaps.map(([from, to]) => `--remap-path-prefix=${from}=${to}`),
  ].join('\x1f');
}

// The cfg values of wasm32-unknown-unknown that its target spec fixes, as `rustc --print cfg`
// prints them (rustc 1.99), and that no -C flag changes. Any other name, such as target_feature,
// target_has_atomic, panic or debug_assertions, is taken as unknown. `unix` and `windows` name
// target families it is not in.
const WASM32_CFG = {
  target_arch: 'wasm32',
  target_family: 'wasm',
  target_os: 'unknown',
  target_env: '',
  target_vendor: 'unknown',
  target_pointer_width: '32',
  target_endian: 'little',
};

// Whether a `target.'cfg(...)'` expression holds for wasm32-unknown-unknown: true, false, or null
// when that depends on the toolchain or the expression is not understood (so the table may apply).
const cfgHoldsForWasm32 = (expr) => {
  const tokens = expr.match(/[A-Za-z_]\w*|"(?:[^"\\]|\\.)*"|\S/g) ?? [];
  let i = 0;
  const predicate = () => {
    const name = tokens[i++];
    if (!/^[A-Za-z_]\w*$/.test(name ?? '')) throw new SyntaxError(expr);
    if (tokens[i] === '(' && ['all', 'any', 'not'].includes(name)) {
      i++;
      const args = [];
      while (tokens[i] !== ')') {
        args.push(predicate());
        if (tokens[i] === ',') i++;
        else if (tokens[i] !== ')') throw new SyntaxError(expr);
      }
      i++;
      if (name === 'not') {
        if (args.length !== 1) throw new SyntaxError(expr);
        return args[0] === null ? null : !args[0];
      }
      const [decides, otherwise] = name === 'all' ? [false, true] : [true, false];
      return args.includes(decides) ? decides : args.includes(null) ? null : otherwise;
    }
    if (tokens[i] === '=') {
      const literal = tokens[i + 1] ?? '';
      i += 2;
      if (!literal.startsWith('"')) throw new SyntaxError(expr);
      return Object.hasOwn(WASM32_CFG, name) ? WASM32_CFG[name] === literal.slice(1, -1) : null;
    }
    return name === 'unix' || name === 'windows' ? false : null;
  };
  try {
    const holds = predicate();
    return i === tokens.length ? holds : null;
  } catch {
    return null;
  }
};

// A TOML key path with its inline-table and dotted-key punctuation as dots and its whitespace
// dropped, inside quoted keys too, so `target = { 'cfg(all(unix, x))' = {` reads
// `target.'cfg(all(unix,x))'.`.
const keyPath = (text) =>
  text.replace(/('[^']*'|"(?:[^"\\]|\\.)*")|[\s={,]+/g, (run, quoted) => (quoted === undefined ? '.' : quoted.replace(/\s+/g, '')));

// The config keys in one cargo config file that set rustflags a wasm32-unknown-unknown build reads:
// `build.rustflags`, `target.wasm32-unknown-unknown.rustflags`, and `target.'cfg(...)'.rustflags`
// unless its cfg cannot hold for that target (cfgHoldsForWasm32). A line scan, not a TOML parser.
const wasmRustflagsKeys = (toml) => {
  const keys = [];
  let table = '';
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const header = /^\[\[?([^\]]*)\]\]?$/.exec(line);
    if (header) {
      table = keyPath(header[1]);
      continue;
    }
    const at = line.search(/\brustflags\s*=/);
    if (at === -1) continue;
    const key = `${table}.${keyPath(line.slice(0, at))}.rustflags`.replace(/\.{2,}/g, '.').replace(/^\./, '');
    const cfg = /^target\.(?:'cfg\(([^']*)\)'|"cfg\(((?:[^"\\]|\\.)*)\)")\.rustflags$/.exec(key);
    const applies = cfg
      ? cfgHoldsForWasm32(cfg[1] ?? cfg[2].replace(/\\(.)/g, '$1')) !== false
      : /^build\./.test(key) || /^target\.(['"]?)wasm32-unknown-unknown\1\./.test(key);
    if (applies) keys.push(key);
  }
  return keys;
};

/**
 * The rustflags cargo would have used for this build that setting CARGO_ENCODED_RUSTFLAGS drops.
 * Cargo takes its extra rustc flags from the first source that is set among
 * CARGO_ENCODED_RUSTFLAGS, RUSTFLAGS, the target's config rustflags and `build.rustflags`, so with
 * either variable already set nothing is dropped. Otherwise every cargo config file cargo reads
 * (`.cargo/config.toml` and `.cargo/config` in the build directory and each parent, then
 * CARGO_HOME's) and the CARGO_BUILD_RUSTFLAGS / CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS
 * variables are checked; a `target.'cfg(...)'` table counts unless its cfg cannot hold for
 * wasm32-unknown-unknown (so `cfg(windows)` does not). A config file that exists but cannot be
 * read throws.
 *
 * @param {{ cwd: string, cargoHome: string, env: Record<string, string | undefined> }} build
 * @returns {string[]} one description per source, empty when nothing is dropped
 */
export function droppedConfigRustflags({ cwd, cargoHome, env }) {
  if (env.CARGO_ENCODED_RUSTFLAGS !== undefined || env.RUSTFLAGS !== undefined) return [];
  const dropped = ['CARGO_BUILD_RUSTFLAGS', 'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS']
    .filter((name) => env[name] !== undefined)
    .map((name) => `the ${name} environment variable`);
  const files = [];
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    files.push(path.join(dir, '.cargo', 'config.toml'), path.join(dir, '.cargo', 'config'));
    if (path.dirname(dir) === dir) break;
  }
  files.push(path.join(cargoHome, 'config.toml'), path.join(cargoHome, 'config'));
  for (const file of new Set(files)) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') continue;
      throw new Error(`cannot read the cargo config ${file} to check its rustflags: ${err.message}`);
    }
    for (const key of wasmRustflagsKeys(text)) dropped.push(`${key} in ${file}`);
  }
  return dropped;
}

function main() {
  const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const LOCAL_RUSTUP = path.join(ROOT_DIR, '.toolchain', 'rustup');
  const LOCAL_CARGO = path.join(ROOT_DIR, '.toolchain', 'cargo');
  const LOCAL_CARGO_BIN = path.join(LOCAL_CARGO, 'bin', 'cargo');

  const skipCargo = process.argv.includes('--emit-only');

  const env = { ...process.env };
  if (fs.existsSync(LOCAL_CARGO_BIN)) {
    env.RUSTUP_HOME = LOCAL_RUSTUP;
    env.CARGO_HOME = LOCAL_CARGO;
    env.PATH = `${path.join(LOCAL_CARGO, 'bin')}:${env.PATH ?? ''}`;
  }

  // A release build must not carry this machine's paths. rustc writes the source path of every
  // panic location into the binary, and for crates.io dependencies that path is absolute, under
  // CARGO_HOME. Cargo's `trim-paths` profile option is not stable, so the build-machine prefixes
  // are remapped here (buildMachineRemaps) and the emitted engine is checked for them (findHostPath).
  const REMAPS = buildMachineRemaps({ root: ROOT_DIR, env, homedir: os.homedir() });
  const cargoHome = toolchainHome(env.CARGO_HOME, '.cargo', { cwd: ROOT_DIR, homedir: os.homedir() }, path).at(-1);

  if (!skipCargo) {
    const cargoCmd = fs.existsSync(LOCAL_CARGO_BIN) ? LOCAL_CARGO_BIN : 'cargo';
    // The remap flags go in CARGO_ENCODED_RUSTFLAGS (0x1f-separated), which carries a path with
    // spaces where RUSTFLAGS cannot. Cargo uses only the first rustflags source set among
    // CARGO_ENCODED_RUSTFLAGS, RUSTFLAGS, the target's config rustflags and build.rustflags, so
    // setting it overrides the rest. The caller's CARGO_ENCODED_RUSTFLAGS or RUSTFLAGS are carried
    // over (with either set, cargo already ignores config rustflags); with neither set, the build
    // refuses to start while a cargo config or CARGO_BUILD_/CARGO_TARGET_ variable sets rustflags
    // for this target, rather than drop them silently. (Merging them would need `cargo config get`,
    // which is nightly-only on cargo 1.99.)
    const dropped = droppedConfigRustflags({ cwd: ROOT_DIR, cargoHome, env });
    if (dropped.length !== 0) {
      throw new Error(
        `This build passes its --remap-path-prefix flags in CARGO_ENCODED_RUSTFLAGS, which makes cargo ignore config rustflags, so it would silently drop: ${dropped.join('; ')}. Pass those flags in RUSTFLAGS instead (this script carries RUSTFLAGS over), or set RUSTFLAGS= (empty) to build without them.`
      );
    }
    env.CARGO_ENCODED_RUSTFLAGS = cargoEncodedRustflags(env, REMAPS);
    const args = [
      'build',
      '-p',
      'molbiocraft-wasm',
      '--target',
      'wasm32-unknown-unknown',
      '--release',
    ];
    if (fs.existsSync(path.join(LOCAL_CARGO, 'registry'))) {
      args.push('--offline');
    }
    console.log(`[MolBioCraft WASM] Compiling Rust workspace -> wasm32-unknown-unknown...`);
    execFileSync(cargoCmd, args, { cwd: ROOT_DIR, env, stdio: 'inherit' });
  }

  const wasmPath = path.join(
    ROOT_DIR,
    'target',
    'wasm32-unknown-unknown',
    'release',
    'molbiocraft_wasm.wasm'
  );
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Compiled WASM binary not found at ${wasmPath}`);
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  const leaked = findHostPath(wasmBytes, REMAPS);
  if (leaked !== null) {
    throw new Error(
      `${wasmPath} embeds the build-machine path ${leaked}; it was built without this script's --remap-path-prefix flags`
    );
  }
  const wasmMod = new WebAssembly.Module(wasmBytes);
  const imports = WebAssembly.Module.imports(wasmMod);
  if (imports.length !== 0) {
    throw new Error(
      `Expected ZERO WebAssembly imports for synchronous instantiation, found ${imports.length}: ${JSON.stringify(imports)}`
    );
  }

  // Synchronous instantiation & smoke test
  const instance = new WebAssembly.Instance(wasmMod, {});
  const exp = instance.exports;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const opBytes = enc.encode('reverse_complement');
  const payloadBytes = enc.encode(JSON.stringify({ seq: 'GAATTCATGGTG', isRna: false }));
  const scratchPtr = exp.mbc_wasm_scratch_ptr(opBytes.length + payloadBytes.length);
  const mem = new Uint8Array(exp.memory.buffer);
  mem.set(opBytes, scratchPtr);
  mem.set(payloadBytes, scratchPtr + opBytes.length);
  const outPtr = exp.mbc_wasm_invoke_scratch(opBytes.length, payloadBytes.length);
  const outLen = exp.mbc_wasm_last_len();
  const isErr = exp.mbc_wasm_last_is_err();
  const outJson = dec.decode(new Uint8Array(exp.memory.buffer, outPtr, outLen));
  if (isErr !== 0 || JSON.parse(outJson) !== 'CACCATGAATTC') {
    throw new Error(`WASM smoke test failed (isErr=${isErr}): ${outJson}`);
  }

  const publicDir = path.join(ROOT_DIR, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  const outWasmPath = path.join(publicDir, 'molbiocraft_wasm.wasm');
  fs.copyFileSync(wasmPath, outWasmPath);

  // Clean up legacy generated TS base64 file if present
  const legacyTsDir = path.join(ROOT_DIR, 'src', 'wasm');
  if (fs.existsSync(legacyTsDir)) {
    fs.rmSync(legacyTsDir, { recursive: true, force: true });
  }

  console.log(
    `[MolBioCraft WASM] Verified 0 imports, no build-machine paths & smoke-tested RPC! Wrote ${(wasmBytes.length / 1024).toFixed(1)} KiB WASM -> ${path.relative(ROOT_DIR, outWasmPath)}`
  );
}

if (process.argv[1] !== undefined && realPathOr(path.resolve(process.argv[1])) === realPathOr(fileURLToPath(import.meta.url))) {
  main();
}
