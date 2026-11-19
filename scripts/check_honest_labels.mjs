#!/usr/bin/env node
// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Fails when a user-visible string names a tool the app does not run (D0002, US-01M6P23M).
 *
 *   node scripts/check_honest_labels.mjs [--names 'Minimap2,CAP3,…'] [--root <dir>]
 *
 * It reads every file under <root>/src and <root>/crates/<crate>/src, except src/__tests__ (the
 * crates' tests/ folders are not under src), so no folder is silently exempt (LL0013), and prints
 * how many files it read. In .ts/.tsx/.js/.jsx/.mjs/.cjs it reads string literals, template parts,
 * JSX text and JSX attribute strings, parsed with the TypeScript compiler; in .rs it reads "…",
 * b"…" and r#"…"# literals. Comments are never read, so a doc comment such as "minimap2-style
 * chaining" stays legal. Each line holding a name is printed as `path:line: …`.
 *
 * A name matches case-sensitively, as a whole word: no letter or digit just before or after it.
 * The names are product names, written as their authors write them; the default list holds both
 * LastZ and LASTZ for that reason (D0234). A lower-case word such as the icon keys 'velvet' and
 * 'mauve' in MolBioIcons.tsx matches text to an icon and claims no tool, so it is not a match.
 *
 * Allowed: in src/plugins/pluginEngine.ts, the external tools the app runs when they are installed,
 * which are honest. A string is allowed there when an object literal around it has a
 * `binaryCandidates` property (the binary it runs) or a `name` that starts with "External ", or it
 * sits under a `reproducibleCommands` property (the CLI command templates). The same name anywhere
 * else fails.
 *
 * Exit status: 0 when no string names a tool, 1 when one does, 2 when the check cannot run (an
 * empty name list, a root with no src/ or crates/ folder, no file to read, an unreadable file).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const DEFAULT_NAMES = ['Minimap2', 'Bowtie2', 'BBMap', 'CAP3', 'Velvet', 'Flye', 'MIRA', 'Mauve', 'LastZ', 'LASTZ'];
const PLUGIN_ENGINE = 'src/plugins/pluginEngine.ts';
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SCRIPT_DIR = path.dirname(url.fileURLToPath(import.meta.url));

function fail(message) {
  console.error(`check_honest_labels: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  let names = DEFAULT_NAMES;
  let root = path.resolve(SCRIPT_DIR, '..');
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--names' && flag !== '--root') fail(`unknown option ${JSON.stringify(flag)}; use --names and --root`);
    const value = argv[++i];
    if (value === undefined) fail(`${flag} needs a value`);
    if (flag === '--names') names = value.split(',').map((n) => n.trim()).filter(Boolean);
    else root = path.resolve(value);
  }
  if (names.length === 0) fail('--names holds no name');
  return { names, root };
}

/** Every file to read under `root`, as paths relative to it with forward slashes. */
function filesUnder(root) {
  const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
  const src = path.join(root, 'src');
  const crates = path.join(root, 'crates');
  if (!isDir(src) && !isDir(crates)) fail(`no src/ or crates/ folder under ${root}`);
  const out = [];
  const walk = (dir, keep) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (rel !== 'src/__tests__') walk(full, keep);
      } else if (entry.isFile() && keep(entry.name)) out.push(rel);
    }
  };
  if (isDir(src)) walk(src, (n) => TS_EXTENSIONS.has(path.extname(n)) || n.endsWith('.rs'));
  if (isDir(crates)) {
    for (const crate of fs.readdirSync(crates, { withFileTypes: true })) {
      const crateSrc = path.join(crates, crate.name, 'src');
      if (crate.isDirectory() && isDir(crateSrc)) walk(crateSrc, (n) => n.endsWith('.rs'));
    }
  }
  if (out.length === 0) fail(`no .ts, .tsx, .js or .rs file under ${root}/src or ${root}/crates/*/src`);
  return out.sort();
}

function loadTypeScript(root) {
  for (const base of [path.join(root, 'package.json'), path.join(SCRIPT_DIR, '..', 'package.json')]) {
    try {
      return createRequire(base)('typescript');
    } catch {
      // try the next place
    }
  }
  fail('the typescript package is not installed (run npm ci)');
}

/** The offset each line starts at, to turn an offset into a 1-based line. */
function lineOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** The [start, end) spans of the string literals and JSX text in a TS/JS source. */
function tsSpans(ts, rel, text) {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : rel.endsWith('.ts') ? ts.ScriptKind.TS
    : rel.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const literal = new Set([
    ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText,
  ]);
  const propName = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);
  const allowedPlugin = (node) => {
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isPropertyAssignment(n) && propName(n) === 'reproducibleCommands') return true;
      if (!ts.isObjectLiteralExpression(n)) continue;
      for (const p of n.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        if (propName(p) === 'binaryCandidates') return true;
        if (propName(p) === 'name' && ts.isStringLiteralLike(p.initializer) && p.initializer.text.startsWith('External ')) return true;
      }
    }
    return false;
  };
  const spans = [];
  const visit = (node) => {
    if (literal.has(node.kind) && !(rel === PLUGIN_ENGINE && allowedPlugin(node))) {
      spans.push([node.getStart(sf), node.end]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return spans;
}

/** The [start, end) spans of the string literals in a Rust source, outside every comment. */
function rustSpans(text) {
  const spans = [];
  const ident = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl + 1;
    } else if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2; }
        else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
    } else if (c === 'r' && (next === '"' || next === '#') && (!ident(text[i - 1]) || (text[i - 1] === 'b' && !ident(text[i - 2])))) {
      let j = i + 1;
      while (text[j] === '#') j++;
      if (text[j] !== '"') { i++; continue; }
      const close = `"${'#'.repeat(j - i - 1)}`;
      const end = text.indexOf(close, j + 1);
      const stop = end < 0 ? text.length : end + close.length;
      spans.push([i, stop]);
      i = stop;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      spans.push([i, j + 1]);
      i = j + 1;
    } else if (c === "'") {
      // a char literal ('"', '\'', '\u{1F600}') or a lifetime ('a, 'static)
      if (next === '\\') {
        const end = text.indexOf("'", i + 3);
        i = end < 0 ? text.length : end + 1;
      } else if (text[i + 2] === "'") i += 3;
      else if (text[i + 3] === "'" && next.charCodeAt(0) >= 0xd800 && next.charCodeAt(0) < 0xdc00) i += 4;
      else i++;
    } else i++;
  }
  return spans;
}

function main() {
  const { names, root } = parseArgs(process.argv.slice(2));
  const files = filesUnder(root);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![A-Za-z0-9])(?:${escaped.join('|')})(?![A-Za-z0-9])`, 'g');
  let ts = null;
  const hits = [];
  for (const rel of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (e) {
      fail(`cannot read ${rel}: ${e.message}`);
    }
    if (!rel.endsWith('.rs')) ts ??= loadTypeScript(root);
    const spans = rel.endsWith('.rs') ? rustSpans(text) : tsSpans(ts, rel, text);
    const line = lineOf(text);
    const seen = new Set();
    for (const [start, end] of spans) {
      for (const m of text.slice(start, end).matchAll(pattern)) {
        const at = line(start + m.index);
        const key = `${at}:${m[0]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const shown = text.split('\n')[at - 1].trim();
        hits.push(`${rel}:${at}: "${m[0]}" in ${shown.length > 120 ? `${shown.slice(0, 117)}...` : shown}`);
      }
    }
  }
  const read = `${files.length.toLocaleString('en-US')} files read`;
  if (hits.length) {
    for (const h of hits) console.log(h);
    console.log(`${read}; ${hits.length} user-visible ${hits.length === 1 ? 'string names' : 'strings name'} a tool the app does not run (${names.join(', ')}).`);
    process.exit(1);
  }
  console.log(`${read}; no user-visible string names ${names.join(', ')}.`);
}

main();
