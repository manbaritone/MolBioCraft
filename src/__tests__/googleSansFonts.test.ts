// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6V6VN (D0077, D0078): the workbench's text is set in Google Sans and its sequences,
 * coordinates and code in Google Sans Code.
 *
 * Every check reads the shipped files themselves: App.css, the WOFF2 subsets (their own cmap,
 * name, head, hhea, hmtx, OS/2 and fvar tables, read from the WOFF2 table directory after
 * decompressing its brotli stream), NOTICE, and the UI source through the TypeScript parser. A
 * manifest, a comment or a grep for a font name never stands in for the fonts.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { LINEAR_ROW_GUTTER_PX, RESIDUE_ADVANCE_PX } from '../components/LinearSequenceView';
import { computeAdaptiveCircularTicks, layoutCircularTickLabels } from '../components/CircularPlasmidMap';
import { alignmentImageSource, drawAlignmentImage, type AlignmentImageMember } from '../core/alignmentImage';
import type { SequenceDocument } from '../types/bio';

interface Dirent { name: string; isDirectory(): boolean }
interface NodeFs {
  readFileSync(p: string): Uint8Array;
  readdirSync(p: string, o: { withFileTypes: true }): Dirent[];
  existsSync(p: string): boolean;
}
interface NodePath { join(...p: string[]): string; resolve(...p: string[]): string; dirname(p: string): string }
interface NodeUrl { fileURLToPath(u: string): string }
interface NodeZlib { brotliDecompressSync(b: Uint8Array): Uint8Array }

const load = <T,>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const [fs, path, url, zlib] = await Promise.all([
  load<NodeFs>('node:fs'),
  load<NodePath>('node:path'),
  load<NodeUrl>('node:url'),
  load<NodeZlib>('node:zlib'),
]);

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const at = (rel: string): string => path.join(REPO, ...rel.split('/'));
const read = (rel: string): string => new TextDecoder().decode(fs.readFileSync(at(rel)));
const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

// ─── WOFF2 tables ───

/** The WOFF2 known-table tags, in the order a table directory's 6-bit index names them. */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt',
  'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

interface Woff2 { file: string; bytes: number; tables: Map<string, DataView>; transformed: Set<string> }

const tagAt = (v: DataView, o: number): string =>
  String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

const woff2Cache = new Map<string, Woff2>();
/** A WOFF2 file's tables: the table directory, then the one brotli stream that holds them all. */
function readWoff2(rel: string): Woff2 {
  const cached = woff2Cache.get(rel);
  if (cached) return cached;
  if (!fs.existsSync(at(rel))) throw new Error(`${rel} does not exist`);
  const raw = fs.readFileSync(at(rel));
  if (raw.byteLength < 48) throw new Error(`${rel} is ${raw.byteLength} bytes, shorter than a WOFF2 header`);
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (tagAt(v, 0) !== 'wOF2') throw new Error(`${rel} is not a WOFF2 file (signature ${JSON.stringify(tagAt(v, 0))})`);
  if (tagAt(v, 4) === 'ttcf') throw new Error(`${rel} is a font collection, which this reader does not read`);
  const numTables = v.getUint16(12);
  const compressedLength = v.getUint32(20);
  let o = 48;
  const base128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = v.getUint8(o++);
      if (i === 0 && b === 0x80) throw new Error(`${rel}: a UIntBase128 with a leading zero`);
      value = value * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return value;
    }
    throw new Error(`${rel}: a UIntBase128 longer than five bytes`);
  };
  const directory: { tag: string; length: number; transformed: boolean }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = v.getUint8(o++);
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = tagAt(v, o);
      o += 4;
    }
    const version = flags >> 6;
    const origLength = base128();
    // glyf and loca are transformed unless their version is 3; every other table only when nonzero.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    directory.push({ tag, length: transformed ? base128() : origLength, transformed });
  }
  const stream = zlib.brotliDecompressSync(raw.subarray(o, o + compressedLength));
  const tables = new Map<string, DataView>();
  const transformed = new Set<string>();
  let p = 0;
  for (const t of directory) {
    if (t.transformed) transformed.add(t.tag);
    else tables.set(t.tag, new DataView(stream.buffer, stream.byteOffset + p, t.length));
    p += t.length;
  }
  if (p !== stream.byteLength) {
    throw new Error(`${rel}: the table directory accounts for ${p} bytes of a ${stream.byteLength}-byte stream`);
  }
  const font = { file: rel, bytes: raw.byteLength, tables, transformed };
  woff2Cache.set(rel, font);
  return font;
}

function table(f: Woff2, tag: string): DataView {
  const t = f.tables.get(tag);
  if (t) return t;
  throw new Error(f.transformed.has(tag) ? `${f.file}: its ${tag} table is transformed, which this reader does not decode` : `${f.file} has no ${tag} table`);
}

/** Code point to glyph id, from the format 12 (or else format 4) Unicode subtable. */
function cmapOf(f: Woff2): Map<number, number> {
  const v = table(f, 'cmap');
  const subtables = Array.from({ length: v.getUint16(2) }, (_, i) => ({
    platform: v.getUint16(4 + 8 * i), encoding: v.getUint16(6 + 8 * i), offset: v.getUint32(8 + 8 * i),
  }));
  const pick = (platform: number, encoding: number) => subtables.find((s) => s.platform === platform && s.encoding === encoding);
  const sub = pick(3, 10) ?? pick(0, 4) ?? pick(3, 1) ?? pick(0, 3);
  if (!sub) throw new Error(`${f.file}: its cmap has no Unicode subtable`);
  const map = new Map<number, number>();
  const s = sub.offset;
  const format = v.getUint16(s);
  if (format === 12) {
    for (let g = 0; g < v.getUint32(s + 12); g++) {
      const b = s + 16 + 12 * g;
      const [first, last, glyph] = [v.getUint32(b), v.getUint32(b + 4), v.getUint32(b + 8)];
      for (let cp = first; cp <= last; cp++) map.set(cp, glyph + cp - first);
    }
  } else if (format === 4) {
    const segX2 = v.getUint16(s + 6);
    const ends = s + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const [end, start, delta, rangeOffset] = [v.getUint16(ends + 2 * i), v.getUint16(starts + 2 * i), v.getInt16(deltas + 2 * i), v.getUint16(ranges + 2 * i)];
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        const index = rangeOffset === 0 ? cp : v.getUint16(ranges + 2 * i + rangeOffset + 2 * (cp - start));
        const glyph = rangeOffset !== 0 && index === 0 ? 0 : (index + delta) & 0xffff;
        if (glyph) map.set(cp, glyph);
      }
    }
  } else {
    throw new Error(`${f.file}: cmap format ${format} is not read here`);
  }
  return map;
}

/** The Windows-platform name records, by name ID (English where a record has several languages). */
function namesOf(f: Woff2): Map<number, string> {
  const v = table(f, 'name');
  const strings = v.getUint16(4);
  const out = new Map<number, string>();
  for (let i = 0; i < v.getUint16(2); i++) {
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((k) => v.getUint16(6 + 12 * i + k));
    if (platform !== 3 || (encoding !== 1 && encoding !== 10)) continue;
    if (out.has(id) && language !== 0x409) continue;
    let s = '';
    for (let k = 0; k < length; k += 2) s += String.fromCharCode(v.getUint16(strings + offset + k));
    out.set(id, s);
  }
  return out;
}

function metricsOf(f: Woff2) {
  const head = table(f, 'head');
  const hhea = table(f, 'hhea');
  const hmtx = table(f, 'hmtx');
  const longMetrics = hhea.getUint16(34);
  const cmap = cmapOf(f);
  const advance = (cp: number): number => {
    const glyph = cmap.get(cp);
    if (glyph === undefined) throw new Error(`${f.file} has no glyph for ${hex(cp)}`);
    return hmtx.getUint16(4 * Math.min(glyph, longMetrics - 1));
  };
  return { upm: head.getUint16(18), ascent: hhea.getInt16(4), descent: hhea.getInt16(6), lineGap: hhea.getInt16(8), advance };
}

const isItalic = (f: Woff2): boolean => (table(f, 'OS/2').getUint16(62) & 1) === 1;

function axesOf(f: Woff2): { tag: string; min: number; def: number; max: number }[] {
  if (!f.tables.has('fvar') && !f.transformed.has('fvar')) return [];
  const v = table(f, 'fvar');
  const [offset, count, size] = [v.getUint16(4), v.getUint16(8), v.getUint16(10)];
  return Array.from({ length: count }, (_, i) => {
    const b = offset + i * size;
    return { tag: tagAt(v, b), min: v.getInt32(b + 4) / 65536, def: v.getInt32(b + 8) / 65536, max: v.getInt32(b + 12) / 65536 };
  });
}

const FONTS = 'src/assets/fonts';
const GS = `${FONTS}/google-sans/GoogleSans-VariableFont.subset.woff2`;
const GS_ITALIC = `${FONTS}/google-sans/GoogleSans-Italic-VariableFont.subset.woff2`;
const GSC = `${FONTS}/google-sans-code/GoogleSansCode-VariableFont_wght.subset.woff2`;
const GSC_ITALIC = `${FONTS}/google-sans-code/GoogleSansCode-Italic-VariableFont_wght.subset.woff2`;

/** The code points both faces of a family draw, so an italic run never falls through either. */
const coveredByBoth = (a: string, b: string): Set<number> => {
  const other = cmapOf(readWoff2(b));
  return new Set([...cmapOf(readWoff2(a)).keys()].filter((cp) => other.has(cp)));
};

/** Every WOFF2 file under src/assets/fonts, by folder. */
function bundledWoff2(): { folders: string[]; files: string[] } {
  const folders: string[] = [];
  const files: string[] = [];
  for (const e of fs.readdirSync(at(FONTS), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    folders.push(e.name);
    for (const f of fs.readdirSync(at(`${FONTS}/${e.name}`), { withFileTypes: true })) if (f.name.endsWith('.woff2')) files.push(`${FONTS}/${e.name}/${f.name}`);
  }
  return { folders: folders.sort(), files: files.sort() };
}

// ─── App.css ───

const APP_CSS = read('src/App.css');
const CSS = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** A comma-separated list, split at the commas outside quotes and parentheses. */
function splitList(value: string): string[] {
  const out: string[] = [];
  let [depth, quote, current] = [0, '', ''];
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, '$2');
const familiesOf = (value: string): string[] => splitList(value).map(unquote);

interface FontFace { family: string; d: Map<string, string>; urls: string[] }
const FONT_FACES: FontFace[] = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const d = new Map<string, string>();
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i > 0) d.set(part.slice(0, i).trim(), part.slice(i + 1).trim().replace(/\s+/g, ' '));
  }
  const urls = [...(d.get('src') ?? '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((u) => `src/${u[1].replace(/^\.\//, '')}`);
  return { family: unquote(d.get('font-family') ?? ''), d, urls };
});
const facesOf = (family: string) => FONT_FACES.filter((f) => f.family === family);
/** The stylesheet's rules, without its @font-face blocks. */
const RULES_CSS = CSS.replace(/@font-face\s*\{[^}]*\}/g, '');

/** Every declaration of a font token, wherever the stylesheet sets it (it sets --font-mono twice). */
const tokenValues = (token: string): string[] =>
  [...CSS.matchAll(new RegExp(`${token}\\s*:\\s*([^;]+);`, 'g'))].map((m) => m[1].replace(/\s+/g, ' ').trim());

/** The custom properties the stylesheet defines. */
const DEFINED_PROPS = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

// ─── The UI source ───

const UI_ROOTS = ['src/App.tsx', 'src/components', 'src/core'];
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(at(rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(child);
    }
  };
  for (const root of UI_ROOTS) {
    if (root.endsWith('.tsx')) out.push(root);
    else walk(root);
  }
  return out;
}

interface Literal { file: string; line: number; text: string; node: ts.Node }
const LITERAL_KINDS = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText,
]);
let literalCache: Literal[] | null = null;
/** Every string literal, template piece and JSX text in the UI source, as the parser reads it. */
function uiLiterals(): Literal[] {
  if (literalCache) return literalCache;
  const out: Literal[] = [];
  for (const file of sourceFiles()) {
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (LITERAL_KINDS.has(node.kind)) {
        const text = (node as ts.LiteralLikeNode).text;
        out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text, node });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  literalCache = out;
  return out;
}

/** Every non-ASCII character the UI source's literals hold, with where each first appears. */
function uiCharacters(): Map<number, string> {
  const out = new Map<number, string>();
  for (const l of uiLiterals()) {
    for (const ch of l.text) {
      const cp = ch.codePointAt(0)!;
      if (cp > 0x7e && !out.has(cp)) out.set(cp, `${l.file}:${l.line}`);
    }
  }
  return out;
}

/**
 * Every font-family value the UI source writes: JSX `fontFamily` attributes, `fontFamily:` style
 * properties, `font-family` inside markup or style strings, and the canvas and figure font
 * constants (`LABEL_FONT`, `FONT_SANS`, `FONT_MONO`), whose value may lead with a size.
 */
function uiFontValues(): { where: string; value: string; name?: string }[] {
  const out: { where: string; value: string; name?: string }[] = [];
  for (const l of uiLiterals()) {
    const where = `${l.file}:${l.line}`;
    const parent = l.node.parent;
    if (parent && ts.isJsxAttribute(parent) && parent.name.getText() === 'fontFamily') out.push({ where, value: l.text });
    if (parent && ts.isPropertyAssignment(parent) && parent.initializer === l.node && parent.name.getText() === 'fontFamily') out.push({ where, value: l.text });
    if (parent && ts.isVariableDeclaration(parent) && parent.initializer === l.node && /FONT/.test(parent.name.getText())) {
      out.push({ where, value: l.text.replace(/^\s*\d+(\.\d+)?px\s+/, ''), name: parent.name.getText() });
    }
    for (const m of l.text.matchAll(/font-family\s*=\s*"([^"]*)"|font-family\s*:\s*([^;"]*)/g)) {
      const value = (m[1] ?? m[2] ?? '').trim();
      if (value) out.push({ where, value });
    }
  }
  return out;
}

/** The platform families the stacks may name behind a bundled face. */
const PLATFORM_FAMILIES = new Set([
  '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Helvetica Neue', 'Arial',
  'system-ui', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo',
  'Consolas', 'DejaVu Sans Mono', 'Liberation Mono', 'inherit',
]);
/** The families a font-family value names that are neither bundled nor a platform family. */
function unknownFamilies(value: string, bundled: Set<string>): string[] {
  const bad: string[] = [];
  for (const item of splitList(value)) {
    const v = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(item);
    if (v) {
      if (!DEFINED_PROPS.has(v[1])) bad.push(`${v[1]} (a custom property no rule defines)`);
      if (v[2]) bad.push(...unknownFamilies(v[2], bundled));
      continue;
    }
    const name = unquote(item);
    if (!bundled.has(name) && !PLATFORM_FAMILIES.has(name)) bad.push(name);
  }
  return bad;
}

// ─── What the UI's characters are measured against ───

/**
 * The UI's symbols that Google Sans does not draw, so the platform font draws them, by code point
 * (D0078). Measured from the shipped Google Sans subsets with fontTools 4.54.1. Under Inter, ten
 * of the UI's characters already fell to the platform font (U+21C4, U+21C5, U+22EF, U+23ED,
 * U+23EE, U+2588, U+25BE, U+26A1, U+2715, U+1F50D), and Google Sans draws three of them (U+21C4,
 * U+22EF, U+2715). A symbol the UI starts to use that Google Sans lacks fails the test until it is
 * listed here, so this list is every UI character the platform font draws in running text.
 */
const LEFT_TO_PLATFORM = new Map<number, string>([
  [0x207a, 'superscript plus sign'],
  [0x207b, 'superscript minus'],
  [0x2194, 'left right arrow'],
  [0x21b5, 'downwards arrow with corner leftwards'],
  [0x21c5, 'upwards arrow leftwards of downwards arrow'],
  [0x21e7, 'upwards white arrow'],
  [0x2303, 'up arrowhead'],
  [0x2318, 'place of interest sign'],
  [0x2325, 'option key'],
  [0x23ed, 'black right-pointing double triangle with vertical bar'],
  [0x23ee, 'black left-pointing double triangle with vertical bar'],
  [0x2588, 'full block'],
  [0x25b6, 'black right-pointing triangle'],
  [0x25bc, 'black down-pointing triangle'],
  [0x25be, 'black down-pointing small triangle'],
  [0x25c0, 'black left-pointing triangle'],
  [0x25c6, 'black diamond'],
  [0x2605, 'black star'],
  [0x26a0, 'warning sign'],
  [0x26a1, 'high voltage sign'],
  [0x2717, 'ballot x'],
  [0x1f50d, 'left-pointing magnifying glass'],
]);

/**
 * The UI characters IBM Plex Mono drew: the non-ASCII characters of the UI source that the
 * shipped IBMPlexMono-Regular.subset.woff2 mapped at e84f736, measured with fontTools 4.54.1
 * before the face was removed.
 */
const PLEX_DREW = [
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b5, 0x00b7, 0x00b9, 0x00c5, 0x00cf, 0x00d3, 0x00d7, 0x00e2, 0x00e3,
  0x00e5, 0x00f6, 0x03c0, 0x2013, 0x2014, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x2032, 0x203a, 0x2070,
  0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079, 0x2080, 0x2081, 0x2082, 0x2083, 0x2087, 0x2088, 0x2190,
  0x2191, 0x2192, 0x2193, 0x2194, 0x21c4, 0x2212, 0x221e, 0x2248, 0x2260, 0x2264, 0x2265, 0x2588, 0x2713,
];

/**
 * Of PLEX_DREW, the characters Google Sans Code does not draw, by name. Set in the mono face, they
 * fall to the platform's monospace font (SFMono-Regular, Menlo, Consolas). In running text Google
 * Sans draws all of them but U+2194.
 */
const MONO_GAP = new Map<number, string>([
  [0x03c0, 'greek small letter pi'],
  [0x2070, 'superscript zero'],
  [0x2075, 'superscript five'],
  [0x2076, 'superscript six'],
  [0x2077, 'superscript seven'],
  [0x2078, 'superscript eight'],
  [0x2079, 'superscript nine'],
  [0x2080, 'subscript zero'],
  [0x2081, 'subscript one'],
  [0x2082, 'subscript two'],
  [0x2083, 'subscript three'],
  [0x2087, 'subscript seven'],
  [0x2088, 'subscript eight'],
  [0x2194, 'left right arrow'],
  [0x21c4, 'rightwards arrow over leftwards arrow'],
  [0x221e, 'infinity'],
  [0x2248, 'almost equal to'],
  [0x2260, 'not equal to'],
  [0x2713, 'check mark'],
]);

/** Text, not symbols: letters, digits, punctuation, spaces, Greek, and the arrows U+2190-2193. */
const isText = (cp: number): boolean =>
  /[\p{L}\p{N}\p{P}\p{Zs}]/u.test(String.fromCodePoint(cp)) || (cp >= 0x0370 && cp <= 0x03ff) || (cp >= 0x2190 && cp <= 0x2193);

// ─── Fallback metrics ───

/** The OpenType OS/2 (versions 0-2) xAvgCharWidth weights, per 1000: lowercase a-z and the space. */
const AVG_WIDTH_WEIGHTS: Record<string, number> = {
  a: 64, b: 14, c: 27, d: 35, e: 100, f: 20, g: 14, h: 42, i: 63, j: 3, k: 6, l: 35, m: 20, n: 56, o: 56,
  p: 17, q: 4, r: 49, s: 56, t: 71, u: 31, v: 10, w: 18, x: 3, y: 18, z: 2, ' ': 166,
};
const averageWidthEm = (advance: (cp: number) => number, upm: number): number =>
  Object.entries(AVG_WIDTH_WEIGHTS).reduce((sum, [ch, w]) => sum + advance(ch.codePointAt(0)!) * w, 0) / 1000 / upm;

/**
 * Arial's advances (Arial 5.01.2x, /System/Library/Fonts/Supplemental/Arial.ttf on macOS 26, upm
 * 2048), read with fontTools 4.54.1. Their weighted average is 904.46 units, the 904 that Arial's
 * own OS/2 xAvgCharWidth gives.
 */
const ARIAL_UPM = 2048;
const ARIAL_ADVANCES: Record<string, number> = {
  a: 1139, b: 1139, c: 1024, d: 1139, e: 1139, f: 569, g: 1139, h: 1139, i: 455, j: 455, k: 1024, l: 455,
  m: 1706, n: 1139, o: 1139, p: 1139, q: 1139, r: 682, s: 1024, t: 569, u: 1139, v: 1024, w: 1479, x: 1024,
  y: 1024, z: 1024, ' ': 569,
};
/** Menlo Regular (/System/Library/Fonts/Menlo.ttc, face 0, upm 2048): every glyph advances 1233 units. */
const MENLO_ADVANCE_EM = 1233 / 2048;

const percent = (v: string | undefined): number => {
  const m = /^(-?[\d.]+)%$/.exec(v ?? '');
  if (!m) throw new Error(`${JSON.stringify(v)} is not a percentage`);
  return Number(m[1]);
};

describe('Google Sans and Google Sans Code (US-01M6V6VN)', () => {
  it('declares Google Sans and Google Sans Code as the UI and mono faces', () => {
    // Wrong implementations this catches: an italic rule that loads the upright file (or the other
    // way round), a weight range the file does not have (Google Sans is 400-700), a token that
    // still leads with Inter or IBM Plex Mono, the second --font-mono at the foot of App.css left
    // on Plex, and a face, rule or UI string that still names Inter, Plex or Google Sans Flex.
    const declared = [...facesOf('Google Sans'), ...facesOf('Google Sans Code')].map((f) => [f.family, f.d.get('font-style'), f.d.get('font-weight'), f.urls]);
    expect(declared).toEqual([
      ['Google Sans', 'normal', '400 700', [GS]],
      ['Google Sans', 'italic', '400 700', [GS_ITALIC]],
      ['Google Sans Code', 'normal', '300 800', [GSC]],
      ['Google Sans Code', 'italic', '300 800', [GSC_ITALIC]],
    ]);
    for (const face of [...facesOf('Google Sans'), ...facesOf('Google Sans Code')]) {
      const font = readWoff2(face.urls[0]);
      const where = `${face.family} ${face.d.get('font-style')} (${face.urls[0]})`;
      expect(namesOf(font).get(1), `${where}: the file is that family`).toBe(face.family);
      expect(isItalic(font), `${where}: the file's OS/2 italic bit`).toBe(face.d.get('font-style') === 'italic');
      const wght = axesOf(font).find((a) => a.tag === 'wght');
      expect(wght && `${wght.min} ${wght.max}`, `${where}: the weights the file's wght axis spans`).toBe(face.d.get('font-weight'));
      expect(face.d.get('font-display'), where).toBe('swap');
    }

    const sans = tokenValues('--font-sans');
    const mono = tokenValues('--font-mono');
    expect(sans.length, 'App.css sets --font-sans').toBeGreaterThan(0);
    expect(mono.length, 'App.css sets --font-mono in :root and again in the theme block').toBe(2);
    for (const v of sans) expect(familiesOf(v).slice(0, 2), `--font-sans: ${v}`).toEqual(['Google Sans', 'Google Sans Fallback']);
    for (const v of mono) expect(familiesOf(v).slice(0, 2), `--font-mono: ${v}`).toEqual(['Google Sans Code', 'Google Sans Code Fallback']);
    for (const token of ['--font-display', '--font-logo']) {
      const values = tokenValues(token);
      expect(values.length, token).toBeGreaterThan(0);
      for (const v of values) expect(familiesOf(v).slice(0, 3), `${token}: ${v}`).toEqual(['Space Grotesk', 'Space Grotesk Fallback', 'Google Sans']);
    }

    const retired = /\bInter\b|IBM Plex|Plex Mono|Google Sans Flex|JetBrains Mono/;
    const cssHits = CSS.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => retired.test(l)).map(([n, l]) => `App.css:${n}: ${l.trim()}`);
    const uiHits = uiLiterals().filter((l) => retired.test(l.text)).map((l) => `${l.file}:${l.line}: ${l.text.trim().slice(0, 80)}`);
    expect([...cssHits, ...uiHits], 'faces, tokens, rules and UI strings that name a retired face').toEqual([]);
  });

  it("covers the UI's text from bundled faces and names each symbol left to the platform", () => {
    // Wrong implementations this catches: a subset without Greek or without the arrows (its
    // UNICODES missing U+0370-03FF or U+2190-21FF), a face that drops a character Inter drew, a
    // check that counts Google Sans Code's glyphs for running text (the key glyphs U+2318 and
    // U+2325 are in Google Sans Code, yet --font-sans never reaches it), and a symbol the UI starts
    // to use that nothing bundled draws.
    const chars = uiCharacters();
    // The scan reaches the UI's strings: the arrow labels use, Greek, the key glyphs and degrees.
    for (const cp of [0x2192, 0x03b1, 0x0394, 0x2318, 0x00b0]) expect(chars.has(cp), `the UI source uses ${hex(cp)}`).toBe(true);

    const sans = coveredByBoth(GS, GS_ITALIC);
    const failures: string[] = [];
    for (const [cp, where] of [...chars].sort((a, b) => a[0] - b[0])) {
      const ch = String.fromCodePoint(cp);
      if (sans.has(cp)) continue;
      if (isText(cp)) failures.push(`${hex(cp)} ${ch} (${where}) is text, and Google Sans does not draw it`);
      else if (!LEFT_TO_PLATFORM.has(cp)) failures.push(`${hex(cp)} ${ch} (${where}): Google Sans does not draw it, and it is not listed as left to the platform font`);
    }
    for (const [cp, name] of LEFT_TO_PLATFORM) {
      if (sans.has(cp)) failures.push(`${hex(cp)} (${name}) is listed as left to the platform, but Google Sans draws it`);
      if (isText(cp)) failures.push(`${hex(cp)} (${name}) is text, which may not be left to the platform`);
    }

    const mono = coveredByBoth(GSC, GSC_ITALIC);
    for (const cp of PLEX_DREW) {
      if (!mono.has(cp) && !MONO_GAP.has(cp)) failures.push(`${hex(cp)} ${String.fromCodePoint(cp)}: IBM Plex Mono drew it, Google Sans Code does not, and it is not listed`);
    }
    for (const [cp, name] of MONO_GAP) {
      if (mono.has(cp)) failures.push(`${hex(cp)} (${name}) is listed as a mono gap, but Google Sans Code draws it`);
      if (!PLEX_DREW.includes(cp)) failures.push(`${hex(cp)} (${name}) is listed as a mono gap, but IBM Plex Mono never drew it`);
    }
    // The residue alphabet and the grid's marks are in Google Sans Code.
    for (const ch of 'ACGTUNRYKMSWBDHVacgtun-*.0123456789,') expect(mono.has(ch.codePointAt(0)!), `Google Sans Code draws ${ch}`).toBe(true);
    expect(failures).toEqual([]);
  });

  it("keeps the layouts' mono metrics equal to Google Sans Code's", () => {
    // Wrong implementations this catches: MONO_LINE_EM left at IBM Plex Mono's 1.3 em (the map
    // seats coordinate labels for a box 4% taller than the face draws), and a residue width or
    // callout advance that is not the face's 0.6 em.
    const faces = [GSC, GSC_ITALIC].map((f) => metricsOf(readWoff2(f)));
    const [m] = faces;
    expect(faces.map((f) => [f.upm, f.ascent, f.descent, f.lineGap]), 'both faces share one line box').toEqual([[2000, 1932, -572, 0], [2000, 1932, -572, 0]]);
    const lineEm = (m.ascent - m.descent) / m.upm;
    expect(lineEm).toBeCloseTo(1.252, 12);
    // Every character the mono face sets (printable ASCII and the characters Plex drew that it has)
    // advances the same, in both faces.
    const mono = coveredByBoth(GSC, GSC_ITALIC);
    const sample = [...Array.from({ length: 0x5f }, (_, i) => 0x20 + i), ...PLEX_DREW.filter((cp) => mono.has(cp))];
    const advances = new Set(faces.flatMap((f) => sample.map((cp) => f.advance(cp))));
    expect([...advances], 'one advance for every character').toEqual([1200]);
    const advanceEm = 1200 / m.upm;
    expect(advanceEm).toBe(0.6);

    // LinearSequenceView: 12px residues plus `.mono-bases`' letter spacing, and an 11px end coordinate.
    const spacing = Number(/\.mono-bases\s*\{[^}]*letter-spacing:\s*([\d.]+)px/.exec(CSS)?.[1]);
    expect(Number.isFinite(spacing), '.mono-bases sets a letter spacing').toBe(true);
    expect(RESIDUE_ADVANCE_PX).toBeCloseTo(12 * advanceEm + spacing, 9);
    expect(LINEAR_ROW_GUTTER_PX).toBeCloseTo(68 + 8 + "12345678 3'".length * 11 * advanceEm, 9);

    // CircularPlasmidMap: each coordinate label's box is its characters at the face's advance and
    // the face's line box tall, at every label size the map draws.
    for (const fontSize of [7.5, 10, 13.25]) {
      const labels = layoutCircularTickLabels(computeAdaptiveCircularTicks(2_686), { cx: 340, cy: 270, fontSize, innerTrackRadius: 117 });
      expect(labels.length, `labels at ${fontSize}px`).toBeGreaterThan(0);
      for (const l of labels) {
        expect(l.height / fontSize, `"${l.label}" at ${fontSize}px: its line box`).toBeCloseTo(lineEm, 9);
        expect(l.width / (l.label.length * fontSize), `"${l.label}" at ${fontSize}px: its advance`).toBeCloseTo(advanceEm, 9);
      }
    }
  });

  it('sizes the fallback faces to the Google Sans metrics', () => {
    // Wrong implementations this catches: Inter's or IBM Plex Mono's overrides kept under the new
    // names (107.12% / 90.44% / 22.52%, or Plex's bare 100%), ascent and descent overrides not
    // divided by size-adjust, and a fallback face the token stacks never reach (AC1 checks the
    // stacks name each fallback straight after its face).
    const check = (family: string, local: string[], sizeAdjust: number, ascent: number, descent: number) => {
      const faces = facesOf(family);
      expect(faces.length, `one @font-face for ${family}`).toBe(1);
      const d = faces[0].d;
      expect(d.get('src'), `${family}: its local faces`).toBe(local.map((l) => `local('${l}')`).join(', '));
      const props = ['size-adjust', 'ascent-override', 'descent-override', 'line-gap-override'];
      const want = [sizeAdjust * 100, (ascent / sizeAdjust) * 100, (descent / sizeAdjust) * 100, 0];
      props.forEach((p, i) => {
        const got = percent(d.get(p));
        expect(Math.abs(got - want[i]), `${family}: ${p} ${got}% against ${want[i].toFixed(4)}%`).toBeLessThanOrEqual(0.005 + 1e-9);
      });
    };

    const gs = metricsOf(readWoff2(GS));
    const arial = averageWidthEm((cp) => ARIAL_ADVANCES[String.fromCodePoint(cp)], ARIAL_UPM);
    expect(arial * ARIAL_UPM).toBeCloseTo(904.463, 3);
    expect(gs.lineGap).toBe(0);
    check('Google Sans Fallback', ['Arial', 'Helvetica Neue'], averageWidthEm(gs.advance, gs.upm) / arial, gs.ascent / gs.upm, -gs.descent / gs.upm);

    const code = metricsOf(readWoff2(GSC));
    expect(code.lineGap).toBe(0);
    check('Google Sans Code Fallback', ['Menlo', 'Consolas'], code.advance(0x30) / code.upm / MENLO_ADVANCE_EM, code.ascent / code.upm, -code.descent / code.upm);

    expect(FONT_FACES.filter((f) => /Inter|Plex/.test(f.family)).map((f) => f.family), 'the Inter and Plex fallbacks are gone').toEqual([]);
  });

  it('names the Google Sans faces in exported figures', () => {
    // Wrong implementations this catches: an exported figure that still names Inter or IBM Plex
    // Mono (the file then opens in a system font), 'JetBrains Mono', which the app never bundled,
    // left in a stack, and a style that names var(--mbc-font-mono), which no rule defines.
    const bundled = new Set(FONT_FACES.map((f) => f.family));
    const values = uiFontValues();

    // The alignment image: names and the consensus label in Google Sans, residues, ruler numbers
    // and identities in Google Sans Code.
    const doc = { moleculeType: 'DNA' } as SequenceDocument;
    const rows = [{ name: 'seqA', sequence: 'ACGTACGTAC' }, { name: 'seqB', sequence: 'ACGTTCGTAC' }] as AlignmentImageMember[];
    const drawn = drawAlignmentImage('fixture', alignmentImageSource(doc, rows, { consensus: 'ACGTACGTAC', consensusLabel: 'majority' }));
    if (!drawn.ok) throw new Error(drawn.message);
    const firstFamilies = [...drawn.inner.matchAll(/font-family="([^"]*)"/g)].map((m) => familiesOf(m[1])[0]);
    expect(new Set(firstFamilies), 'the alignment image names only the two faces').toEqual(new Set(['Google Sans', 'Google Sans Code']));
    expect(/<g class="aln-residues" font-family="'Google Sans Code'/.test(drawn.inner), 'the residues are in Google Sans Code').toBe(true);
    for (const name of ['FONT_SANS', 'FONT_MONO']) expect(values.some((v) => v.name === name && v.where.startsWith('src/core/alignmentImage.ts')), `${name} is read`).toBe(true);

    // The summary SVG (App.tsx) and the dotplot's canvas label font.
    const summary = uiLiterals().filter((l) => l.file === 'src/App.tsx' && /font-family="/.test(l.text) && /<text/.test(l.text));
    const summaryFamilies = summary.flatMap((l) => [...l.text.matchAll(/font-family="([^"]*)"/g)].map((m) => familiesOf(m[1])));
    expect(summaryFamilies.map((f) => f[0]), 'the summary SVG: its title, its metrics line, its sequence and its footer').toEqual(['Google Sans', 'Google Sans', 'Google Sans Code', 'Space Grotesk']);
    expect(summaryFamilies[3][1], 'the footer falls back to Google Sans').toBe('Google Sans');
    const dotplot = values.filter((v) => v.name === 'LABEL_FONT' && v.where.startsWith('src/components/AlignmentDotplot.tsx'));
    expect(dotplot.map((v) => familiesOf(v.value)[0]), "the dotplot's canvas labels").toEqual(['Google Sans']);

    // And every font-family the UI source or App.css writes names a bundled face, a platform
    // family, or a custom property the stylesheet defines.
    expect(values.length, 'the scan reads the UI source').toBeGreaterThan(20);
    const failures = values.flatMap((v) => unknownFamilies(v.value, bundled).map((b) => `${v.where}: ${b} in "${v.value}"`));
    const cssValues = [...RULES_CSS.matchAll(/(?:^|[;{\s])font-family\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(cssValues.length, 'the scan reads App.css').toBeGreaterThan(5);
    for (const v of cssValues) failures.push(...unknownFamilies(v, bundled).map((b) => `App.css: ${b} in "${v}"`));
    expect(failures).toEqual([]);
  });

  it('bundles each face once, within budget, with its licence', () => {
    // Wrong implementations this catches: the Google Sans master shipped as WOFF2 uninstanced (its
    // opsz and GRAD axes kept, and five times the size) or unsubset (Cyrillic and Vietnamese
    // glyphs outside the script's ranges), pyftsubset's default --name-IDs, which drops the licence
    // records (13 and 14), and the IBM Plex Mono or Inter files left behind.
    const { folders, files } = bundledWoff2();
    expect(folders).toEqual(['google-sans', 'google-sans-code', 'poppins', 'space-grotesk']);
    expect(FONT_FACES.flatMap((f) => f.urls).sort(), 'each WOFF2 file is declared by exactly one @font-face').toEqual(files);

    const script = read('scripts/subset_fonts.sh');
    const ranges = (/^UNICODES="([^"]+)"/m.exec(script)?.[1] ?? '').split(',').map((r) => r.replace(/^U\+/, '').split('-').map((h) => parseInt(h, 16)));
    expect(ranges.length, "the script's ranges").toBeGreaterThan(5);
    const inRanges = (cp: number) => ranges.some(([lo, hi = lo]) => cp >= lo && cp <= hi);

    let total = 0;
    for (const file of files) {
      const font = readWoff2(file);
      total += font.bytes;
      const names = namesOf(font);
      expect(names.get(0) ?? '', `${file}: its copyright (name ID 0)`).toMatch(/^Copyright \d{4} /);
      expect(names.get(13) ?? '', `${file}: its licence description (name ID 13)`).toContain('SIL Open Font License, Version 1.1');
      expect(names.get(14) ?? '', `${file}: its licence URL (name ID 14)`).toMatch(/^https?:\/\/\S+$/);
      const outside = [...cmapOf(font).keys()].filter((cp) => !inRanges(cp));
      expect(outside.map(hex), `${file}: code points outside the script's ranges`).toEqual([]);
      const folder = file.split('/').slice(0, -1).join('/');
      expect(read(`${folder}/OFL.txt`), `${folder}/OFL.txt`).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    }
    for (const file of [GS, GS_ITALIC]) {
      const font = readWoff2(file);
      expect(font.bytes, `${file} is at most 120 KB`).toBeLessThanOrEqual(120_000);
      expect(axesOf(font).map((a) => [a.tag, a.min, a.def, a.max]), `${file}: instanced to its wght axis`).toEqual([['wght', 400, 400, 700]]);
    }
    expect(total, 'the bundled WOFF2 files total no more than the 692 KB they held before').toBeLessThanOrEqual(692_000);

    for (const folder of ['google-sans', 'google-sans-code']) {
      expect(read(`${FONTS}/${folder}/TRADEMARKS.md`), `${folder}/TRADEMARKS.md`).toMatch(/are trademarks of Google LLC/);
    }
    for (const master of ['google-sans/GoogleSans-VariableFont.ttf', 'google-sans/GoogleSans-Italic-VariableFont.ttf', 'google-sans-code/GoogleSansCode-VariableFont_wght.ttf', 'google-sans-code/GoogleSansCode-Italic-VariableFont_wght.ttf']) {
      expect(fs.existsSync(at(`${FONTS}/${master}`)), `the OFL master ${master}`).toBe(true);
    }
  });

  it('lists every bundled font and its licence in NOTICE', () => {
    // Wrong implementations this catches: a NOTICE that leaves out a bundled face (Poppins and
    // Space Grotesk were never listed), quotes a copyright line the font does not carry, or names
    // Google's marks without saying they only name the fonts.
    const notice = read('NOTICE');
    const start = notice.indexOf('BUNDLED FONTS');
    expect(start, 'NOTICE has a bundled-fonts section').toBeGreaterThan(0);
    const body = notice.indexOf('\n', notice.indexOf('====', start)) + 1;
    const end = notice.indexOf('\n====', body);
    const section = notice.slice(body, end < 0 ? undefined : end);
    const entries = section.split(/\n(?=- )/).slice(1);

    const families = new Map<string, string>();
    for (const file of bundledWoff2().files) {
      const names = namesOf(readWoff2(file));
      families.set(names.get(16) ?? names.get(1)!, names.get(0)!);
    }
    expect([...families.keys()].sort()).toEqual(['Google Sans', 'Google Sans Code', 'Poppins', 'Space Grotesk']);
    for (const [family, copyright] of families) {
      const entry = entries.find((x) => x.startsWith(`- ${family} (`) || x.startsWith(`- ${family}:`));
      expect(entry, `NOTICE lists ${family}`).toBeDefined();
      expect(entry!.replace(/\s+/g, ' '), `${family}: its copyright line`).toContain(copyright);
      expect(entry!.replace(/\s+/g, ' '), `${family}: its licence`).toContain('SIL Open Font License, Version 1.1');
    }
    const flat = section.replace(/\s+/g, ' ');
    expect(flat).toContain('"Google Sans" and "Google Sans Code" are trademarks of Google LLC');
    expect(flat).toContain('used here only to name the fonts');
    expect(flat).toContain('does not imply any affiliation with or endorsement by Google LLC');
    expect(/\bInter\b|IBM Plex/.test(notice), 'NOTICE names no retired face').toBe(false);
  });
});
