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
 * the rustflags it runs cargo with and the rustflags check (src/__tests__/buildRustWasmGuard.test.ts),
 * and the walk and record of the engine's inputs (src/__tests__/crisprScoreProvenance.test.tsx).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

/**
 * The sidecar, beside the emitted engine, that records the inputs it was built from (BG-01M7FA80,
 * BG-01M7FGTR). `src/__tests__/crisprScoreProvenance.test.tsx` walks the tree again at test time,
 * through `engineInputs` below, and fails naming every file whose digest differs, so a compute
 * change with no rebuild is red on a developer's machine instead of leaving a stale artifact that
 * agrees with itself (LC-009).
 */
export const SOURCE_DIGEST_SIDECAR = 'public/molbiocraft_wasm.wasm.sources.sha256';

/**
 * The workspace manifests the engine is resolved from: cargo builds `-p molbiocraft-wasm` from the
 * root workspace, so its `Cargo.toml` (members, `[workspace.dependencies]`, the release profile)
 * and its `Cargo.lock` (every dependency's exact version) decide the engine's bytes as much as any
 * `.rs` does. `src-tauri/` is excluded from the workspace and its own manifests do not build the
 * engine, so they are not here.
 */
export const WORKSPACE_MANIFESTS = ['Cargo.toml', 'Cargo.lock'];

const toRel = (rootDir, p) => path.relative(rootDir, p).split(path.sep).join('/');
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
const isIdent = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);

/**
 * A Rust source read as code: every comment and character literal blanked to spaces and every
 * string literal to `"` (newlines kept, so offsets and line numbers still hold), with its text
 * kept aside by the offset it starts at. A brace or a macro name inside a comment or a literal is
 * therefore never read as code. Lifetimes and labels (`'a`) are code; `'x'`, `'\n'`, `'\u{..}'`,
 * `b'x'` are literals; `"..."`, `b"..."` and raw `r#"..."#` strings are literals. A block comment
 * or a string that never closes - which rustc refuses - is refused here too, at the line it opens,
 * rather than read as swallowing the rest of the file.
 *
 * @param {string} text the source
 * @param {string} file its repo-relative path, for a refusal
 * @returns {{ code: string, literals: Map<number, { text: string, end: number, raw: boolean }> }}
 *   each string literal by the offset of its first character: its text between the quotes, the
 *   offset just past it, and whether it is raw (so its backslashes are not escapes)
 */
function rustCode(text, file) {
  const unterminated = (what, at) =>
    new Error(`${file}:${lineOf(text, at)}: ${what} opened here never closes, so the engine inputs after it cannot be read`);
  const out = text.split('');
  const literals = new Map();
  const blank = (from, to, fill = ' ') => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = fill;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = text.length;
      blank(i, j);
      i = j;
    } else if (c === '/' && text[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') (depth++, (j += 2));
        else if (text[j] === '*' && text[j + 1] === '/') (depth--, (j += 2));
        else j++;
      }
      if (depth > 0) throw unterminated('the block comment', i);
      blank(i, j);
      i = j;
    } else if ((c === 'r' || c === 'b' || c === 'c') && !isIdent(text[i - 1]) && /^(?:[bc]?r)(#*)"/.test(text.slice(i, i + 260))) {
      const [opener, hashes] = /^(?:[bc]?r)(#*)"/.exec(text.slice(i, i + 260));
      const close = `"${hashes}`;
      const end = text.indexOf(close, i + opener.length);
      if (end < 0) throw unterminated('the raw string literal', i);
      literals.set(i, { text: text.slice(i + opener.length, end), end: end + close.length, raw: true });
      blank(i, end + close.length, '"');
      i = end + close.length;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) throw unterminated('the string literal', i);
      literals.set(i, { text: text.slice(i + 1, j), end: j + 1, raw: false });
      blank(i, j + 1, '"');
      i = j + 1;
    } else if (c === "'") {
      let end = -1;
      if (text[i + 1] === '\\') {
        end = i + 3;
        while (end < text.length && text[end] !== "'") end++;
      } else if (text[i + 2] === "'") end = i + 2;
      else if (/[\uD800-\uDBFF]/.test(text[i + 1] ?? '') && text[i + 3] === "'") end = i + 3;
      if (end < 0) i++; // a lifetime or a label: code
      else {
        blank(i, end + 1);
        i = end + 1;
      }
    } else i++;
  }
  return { code: out.join(''), literals };
}

/**
 * The spans of `#[cfg(test)] mod <name> { ... }` items in code read by `rustCode`. cargo compiles
 * them only into the test harness, never into the cdylib, so what they include is no input of the
 * engine. Only an inline `mod` block is a span: any other `#[cfg(test)]` item is left in, which
 * records a file the engine may not need (a red that costs a rebuild) rather than miss one it does.
 */
function testModuleSpans(code, file) {
  const spans = [];
  const attr = /#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/g;
  for (let m; (m = attr.exec(code)) !== null; ) {
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') depth--;
    }
    if (depth !== 0) {
      throw new Error(`${file}:${lineOf(code, m.index)}: the #[cfg(test)] module opened here never closes, so the engine inputs it hides cannot be told from the ones it does not`);
    }
    spans.push([m.index, j]);
    attr.lastIndex = j;
  }
  return spans;
}

/**
 * The files one Rust source pulls into its crate by `include_str!`, `include_bytes!` or `include!`,
 * written with any of the three delimiters rustc accepts for a macro call - `(...)`, `[...]` or
 * `{...}` (BG-01M7FQN5) - resolved as rustc resolves them (relative to the including file's
 * directory), outside any `#[cfg(test)]` module. A site rustc could follow but this cannot - an
 * argument that is not one string literal closed by its own delimiter, a target missing from the
 * tree or outside the checkout - is refused by file and line rather than left out of the record.
 *
 * Before any of that, the source is refused if it loads a module from a file the walk does not
 * follow (refuseModulesFromElsewhere).
 *
 * @param {boolean} [buildScript] whether `abs` is a crate's build script rather than a source of
 *   the library
 * @returns {{ path: string, rust: boolean, bytes: boolean }[]} absolute paths; `rust` for an
 *   `include!` target, `bytes` for an `include_bytes!` one
 */
function includedFiles(rootDir, abs, buildScript = false) {
  const file = toRel(rootDir, abs);
  const text = fs.readFileSync(abs, 'utf8');
  const { code, literals } = rustCode(text, file);
  refuseModulesFromElsewhere(code, text, file, buildScript);
  const spans = testModuleSpans(code, file);
  const found = [];
  const site = /(?<![A-Za-z0-9_])(include_str|include_bytes|include)\s*!\s*([([{])\s*/g;
  const closer = { '(': ')', '[': ']', '{': '}' };
  for (let m; (m = site.exec(code)) !== null; ) {
    if (spans.some(([from, to]) => m.index >= from && m.index < to)) continue;
    const at = `${file}:${lineOf(text, m.index)}`;
    const literal = literals.get(m.index + m[0].length);
    const closed = literal !== undefined && code.slice(literal.end).replace(/^\s*,?\s*/, '').startsWith(closer[m[2]]);
    const plain = closed && (literal.raw || !/\\(?![\\"])/.test(literal.text));
    if (!plain) {
      throw new Error(`${at}: ${m[1]}! takes something other than one plain string literal, so the engine input it reads cannot be recorded`);
    }
    const target = path.resolve(path.dirname(abs), literal.raw ? literal.text : literal.text.replace(/\\([\\"])/g, '$1'));
    const rel = toRel(rootDir, target);
    if (rel.startsWith('../') || path.isAbsolute(rel)) {
      throw new Error(`${at}: ${m[1]}!${m[2]}"${literal.text}"${closer[m[2]]} reads ${target}, outside this checkout, so it cannot be recorded`);
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`${at}: ${m[1]}!${m[2]}"${literal.text}"${closer[m[2]]} reads ${rel}, which is not a file in this tree`);
    }
    found.push({ path: target, rust: m[1] === 'include', bytes: m[1] === 'include_bytes' });
  }
  return found;
}

/**
 * Refuses, by file, line and name, a Rust source that loads a module from a file the walk does not
 * follow (BG-01M7FQHB), read from code that `rustCode` has lexed - so one written in a comment or a
 * string literal is never read as code:
 * - a `path = ...` inside any attribute - `#[path = "..."]`, or the same key under `#[cfg_attr(...)]`.
 *   It can point a module at any file, inside `src/` or outside it, and where it lands depends on
 *   rustc's rules for the module it sits in; refusing it is simpler and surer than resolving it, and
 *   the tree has none. It is refused inside a `#[cfg(test)]` module too: a red there costs a reword,
 *   not a missed input;
 * - in a build script, an out-of-line `mod name;`, which loads a file beside the script that no
 *   other rule records. In a library source the same item loads a file under `src/`, which the walk
 *   already records.
 */
function refuseModulesFromElsewhere(code, text, file, buildScript) {
  const attribute = /#\s*!?\s*\[/g;
  for (let m; (m = attribute.exec(code)) !== null; ) {
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === '[') depth++;
      else if (code[j] === ']') depth--;
    }
    if (/(?<![A-Za-z0-9_])path\s*=/.test(code.slice(m.index + m[0].length, j))) {
      throw new Error(
        `${file}:${lineOf(text, m.index)}: a #[path] attribute (${text.slice(m.index, j)}) points a module at a file the engine-input walk does not follow, so that input cannot be recorded; move the module under src/ where its name puts it`
      );
    }
  }
  if (!buildScript) return;
  const outOfLine = /(?<![A-Za-z0-9_])mod\s+((?:r#)?[A-Za-z_][A-Za-z0-9_]*)\s*;/g;
  for (let m; (m = outOfLine.exec(code)) !== null; ) {
    throw new Error(
      `${file}:${lineOf(text, m.index)}: the build script's \`mod ${m[1]};\` loads a module file beside it that the engine-input walk does not follow, so that input cannot be recorded; write the module inline or include!() it`
    );
  }
}

/**
 * The keys of one crate manifest that move what cargo compiles out of the walk's sight, by the line
 * each is written on: `package.build` and `lib.path`, in any of TOML's spellings of them - under a
 * `[package]` / `[lib]` header, as a dotted key, or in an inline table - with quoted key parts
 * unquoted. A line scan rather than a TOML parser: the lines inside a `"""` or `'''` multi-line
 * string are skipped, and so is the rest of the line that closes one.
 *
 * @returns {{ key: string, value: string, line: number }[]} `value` as written, comment stripped
 */
function manifestTargetKeys(toml) {
  const found = [];
  // Splits on `sep` outside quotes and brackets: TOML key parts on '.', inline-table pairs on ','.
  const split = (text, sep) => {
    const parts = [];
    let depth = 0;
    let quote = '';
    let from = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\' && quote === '"') i++;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === '#' && sep !== '#') return [...parts, text.slice(from, i)];
      else if (c === sep && depth === 0) (parts.push(text.slice(from, i)), (from = i + 1));
    }
    return [...parts, text.slice(from)];
  };
  const keyOf = (text) => split(text, '.').map((part) => part.trim().replace(/^(["'])(.*)\1$/, '$2'));
  const pairs = (prefix, text, line) => {
    const [body] = split(text, '#');
    const at = split(body, '=');
    if (at.length < 2) return;
    const key = [...prefix, ...keyOf(at[0])].join('.');
    const value = body.slice(at[0].length + 1).trim();
    if (value.startsWith('{') && value.endsWith('}')) {
      for (const pair of split(value.slice(1, -1), ',')) pairs(key.split('.'), pair, line);
    } else if (key === 'package.build' || key === 'lib.path') found.push({ key, value, line });
  };
  let table = [];
  let multiline = '';
  toml.split(/\r?\n/).forEach((raw, index) => {
    // The lines inside a multi-line string are text: a `[x]` there is no header, a `k = v` no key.
    if (multiline) {
      if (raw.includes(multiline)) multiline = '';
      return;
    }
    for (const delimiter of ['"""', "'''"]) {
      if (raw.split(delimiter).length % 2 === 0) multiline = delimiter;
    }
    const line = split(raw, '#')[0].trim();
    const header = /^\[\[([^\]]*)\]\]$|^\[([^\]]*)\]$/.exec(line);
    if (header) table = header[1] !== undefined ? ['[[array]]'] : keyOf(header[2]);
    else pairs(table, line, index + 1);
  });
  return found;
}

/**
 * The build scripts of one crate, which cargo compiles and runs before the library and whose
 * output (cfgs, generated code, link flags) can change the engine (BG-01M7FQHB). Recorded rather
 * than refused, since cargo runs a crate-root `build.rs` with no manifest change at all:
 * - `build.rs` at the crate root, whenever it exists - even under `build = false`, where it records
 *   a file the engine does not need (a red that costs a rebuild) rather than read the key wrong;
 * - the file a `package.build` key names, resolved against the crate directory.
 * A `[lib]` `path` moves the library root, and with it where every `mod` resolves, so it is refused
 * rather than followed; so is a `package.build` that is not one plain string, or that names a file
 * missing from the tree or outside the checkout. `[[bin]]` targets are not compiled into the cdylib
 * and are not read.
 *
 * @returns {string[]} absolute paths of the build scripts
 */
function buildScripts(rootDir, crateDir, manifest) {
  const rel = toRel(rootDir, manifest);
  const scripts = [];
  const atRoot = path.join(crateDir, 'build.rs');
  if (fs.existsSync(atRoot) && fs.statSync(atRoot).isFile()) scripts.push(atRoot);
  for (const { key, value, line } of manifestTargetKeys(fs.readFileSync(manifest, 'utf8'))) {
    const at = `${rel}:${line}`;
    if (key === 'lib.path') {
      throw new Error(`${at}: [lib] path = ${value} moves the library root out of src/, where the engine-input walk does not follow its modules, so those inputs cannot be recorded`);
    }
    if (value === 'true' || value === 'false') continue;
    const plain = /^"([^"\\]*)"$|^'([^']*)'$/.exec(value);
    if (!plain) {
      throw new Error(`${at}: package.build = ${value} is not one plain string naming a build script, so the build script cannot be recorded`);
    }
    const script = path.resolve(crateDir, plain[1] ?? plain[2]);
    const scriptRel = toRel(rootDir, script);
    if (scriptRel.startsWith('../') || path.isAbsolute(scriptRel)) {
      throw new Error(`${at}: package.build = ${value} names ${script}, outside this checkout, so it cannot be recorded`);
    }
    if (!fs.existsSync(script) || !fs.statSync(script).isFile()) {
      throw new Error(`${at}: package.build = ${value} names ${scriptRel}, which is not a file in this tree`);
    }
    scripts.push(script);
  }
  return scripts;
}

/**
 * Every input the engine is built from, discovered from the tree - not an enumeration, so a file
 * added tomorrow is covered the day it is added - and the one walk of the crate tree, which both
 * the build's record and the vitest that checks it read (BG-01M7FGTR folded the vitest's own walker
 * into this one):
 * - every `.rs` below each crate's `src`, to any depth (`tests/` and `benches/` are left out: cargo
 *   compiles them as their own targets, not into the cdylib);
 * - each crate's build scripts (buildScripts) - a crate-root `build.rs` and a `package.build`
 *   target - which cargo runs before compiling the engine (BG-01M7FQHB);
 * - every file those sources `include_str!`, `include_bytes!` or `include!` outside a
 *   `#[cfg(test)]` module - such as the two `.pdb` files `molbiocraft-cloning/src/sample_structures.rs`
 *   embeds, which are build inputs of the engine, not test data - and what an `include!`-ed file
 *   includes in turn;
 * - every crate's `Cargo.toml` (its dependencies and features), and the WORKSPACE_MANIFESTS.
 * A crate is a directory under `crates/` holding a `Cargo.toml`. A missing workspace manifest is
 * refused by name rather than left out, and so is each way of compiling code from outside the walk
 * that is not recorded - a `[lib]` `path`, a `#[path]` attribute, a build script's out-of-line
 * `mod` (buildScripts, refuseModulesFromElsewhere). `raw` names the inputs to digest over their exact bytes:
 * every `include_bytes!` target, which the engine embeds byte for byte (BG-01M7FQN4) - including a
 * file some other site also reads with `include_str!`, since one digest per path must be the one
 * that misses no change. Every other input is text (rustc reads `.rs`, `include_str!` and
 * `include!` targets only as UTF-8, and the manifests are TOML).
 *
 * @param {string} rootDir the checkout root
 * @returns {{ files: string[], crates: string[], raw: string[] }} repo-relative, forward-slash
 *   paths, crate directory names, and the paths of `files` to digest as bytes, each sorted
 */
export function engineInputs(rootDir) {
  const found = new Set();
  const rust = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.rs')) rust.push(full);
    }
  };
  const crates = [];
  const scripts = new Set();
  const cratesDir = path.join(rootDir, 'crates');
  for (const crate of fs.readdirSync(cratesDir, { withFileTypes: true })) {
    const manifest = path.join(cratesDir, crate.name, 'Cargo.toml');
    if (!crate.isDirectory() || !fs.existsSync(manifest)) continue;
    crates.push(crate.name);
    found.add(manifest);
    for (const script of buildScripts(rootDir, path.join(cratesDir, crate.name), manifest)) {
      scripts.add(script);
      rust.push(script);
    }
    const src = path.join(cratesDir, crate.name, 'src');
    if (fs.existsSync(src)) walk(src);
  }
  for (const manifest of WORKSPACE_MANIFESTS) {
    const at = path.join(rootDir, manifest);
    if (!fs.existsSync(at)) {
      throw new Error(`the workspace ${manifest} is missing from ${rootDir}: the dependencies the engine is built against cannot be recorded`);
    }
    found.add(at);
  }
  const lexed = new Set();
  const raw = new Set();
  while (rust.length > 0) {
    const abs = rust.pop();
    if (lexed.has(abs)) continue;
    lexed.add(abs);
    found.add(abs);
    for (const included of includedFiles(rootDir, abs, scripts.has(abs))) {
      found.add(included.path);
      if (included.rust) rust.push(included.path);
      if (included.bytes) raw.add(included.path);
    }
  }
  const rel = (paths) => [...paths].map((p) => toRel(rootDir, p)).sort();
  return { files: rel(found), crates: crates.sort(), raw: rel(raw) };
}

/**
 * The sha256 of one source, with CRLF collapsed to LF so the digest is the same on every platform
 * whatever a checkout did to the line endings (.gitattributes asks for LF; this does not rely on it).
 *
 * @param {string} text the file, as UTF-8
 * @returns {string} hex
 */
export const sourceDigest = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

/**
 * The sha256 of an `include_bytes!` target over its exact bytes - no UTF-8 decode, which would turn
 * any two invalid sequences into the same character, and no line-ending fold, which would drop a CR
 * the engine embeds (BG-01M7FQN4).
 *
 * @param {Uint8Array} bytes the file
 * @returns {string} hex
 */
export const rawDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The sidecar's text for a checkout: a `# ` header, then one `<sha256>  <path>` line per input
 * `engineInputs` discovers, sorted by path - `rawDigest` for its `raw` inputs, `sourceDigest` for
 * the rest. Refuses to write a manifest with no `.rs` source, which
 * would make the digest a constant and the guard vacuous.
 *
 * @param {string} rootDir the checkout root
 * @returns {string}
 */
export function sourceDigestManifest(rootDir) {
  const { files, raw } = engineInputs(rootDir);
  if (!files.some((file) => file.endsWith('.rs'))) {
    throw new Error(`no .rs source found under ${path.join(rootDir, 'crates')}/*/src: refusing to write an empty ${SOURCE_DIGEST_SIDECAR}`);
  }
  const digestOf = (rel) =>
    raw.includes(rel) ? rawDigest(fs.readFileSync(path.join(rootDir, rel))) : sourceDigest(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
  const lines = files.map((rel) => `${digestOf(rel)}  ${rel}`);
  return [
    `# The inputs public/molbiocraft_wasm.wasm beside this file was built from (BG-01M7FA80, BG-01M7FGTR,`,
    `# BG-01M7FQHB): every .rs under crates/*/src, each crate's build script (a build.rs at its root or`,
    `# the file its package.build names), each file they include_str!/include_bytes!/include! outside a`,
    `# #[cfg(test)] module, every crate's Cargo.toml, and the workspace Cargo.toml and Cargo.lock.`,
    `# Written by \`npm run wasm:build\`; checked by src/__tests__/crisprScoreProvenance.test.tsx,`,
    `# which walks the tree again and names every file that differs. Do not edit by hand.`,
    ...lines,
    '',
  ].join('\n');
}

/**
 * Writes the sidecar beside the engine and returns what it wrote.
 *
 * @param {string} rootDir the checkout root
 * @returns {{ path: string, files: number }}
 */
export function writeSourceDigestSidecar(rootDir) {
  const manifest = sourceDigestManifest(rootDir);
  const out = path.join(rootDir, ...SOURCE_DIGEST_SIDECAR.split('/'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, manifest, 'utf8');
  return { path: out, files: manifest.split('\n').filter((l) => !l.startsWith('#') && l !== '').length };
}

function main() {
  const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  // `--sources-only` rewrites the provenance sidecar alone, without rebuilding the engine, for the
  // CI staleness check (.github/workflows/ci.yml), which regenerates the record and diffs it against
  // the committed one. Run on its own it would attest to a build that never happened, so it is not a
  // remedy for a stale engine and says so on every run (BG-01M7FGPW).
  if (process.argv.includes('--sources-only')) {
    const { path: out, files } = writeSourceDigestSidecar(ROOT_DIR);
    console.log(
      `[MolBioCraft WASM] Recorded ${files} engine inputs -> ${path.relative(ROOT_DIR, out)} without rebuilding the engine. ` +
        `This is for the CI staleness check; it does not bring public/molbiocraft_wasm.wasm up to date - ` +
        `run \`npm run wasm:build\` and commit the result for that.`
    );
    return;
  }
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

  // The engine's provenance, beside the engine: the sources this build compiled (BG-01M7FA80). An
  // `--emit-only` run compiled nothing (it re-emits whatever target/ already holds, which is how
  // src/__tests__/buildRustWasmGuard.test.ts drives this script over a fixture tree with no
  // crates/), so it records nothing rather than claim a provenance it did not establish: the check
  // then stays red until a real build, or `--sources-only`, writes it.
  const sidecar = skipCargo ? null : writeSourceDigestSidecar(ROOT_DIR);

  // Clean up legacy generated TS base64 file if present
  const legacyTsDir = path.join(ROOT_DIR, 'src', 'wasm');
  if (fs.existsSync(legacyTsDir)) {
    fs.rmSync(legacyTsDir, { recursive: true, force: true });
  }

  console.log(
    `[MolBioCraft WASM] Verified 0 imports, no build-machine paths & smoke-tested RPC! Wrote ${(wasmBytes.length / 1024).toFixed(1)} KiB WASM -> ${path.relative(ROOT_DIR, outWasmPath)}${sidecar === null ? '' : ` (+ ${sidecar.files} input digests -> ${path.relative(ROOT_DIR, sidecar.path)})`}`
  );
}

if (process.argv[1] !== undefined && realPathOr(path.resolve(process.argv[1])) === realPathOr(fileURLToPath(import.meta.url))) {
  main();
}
