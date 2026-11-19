// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6P23M (D0002, D0204, D0234): no user-visible string names a tool the app does not run.
 *
 * scripts/check_honest_labels.mjs is run as CI runs it, by node on the repository, and on fixture
 * folders laid out as the repository is (src/ and crates/<name>/src), so each case is the command
 * people run. It reads TS/TSX string literals, template parts and JSX text, and Rust "…" / r#"…"#
 * literals; it skips comments. It walks every file under src/ and crates/*\/src except src/__tests__
 * and crates/*\/tests (LL0013), and says how many it read. The names are matched case-sensitively
 * (D0234: the list holds both LastZ and LASTZ; the lower-case icon keys in MolBioIcons.tsx are not
 * tool claims). External plugins in src/plugins/pluginEngine.ts that name a binary to run
 * (binaryCandidates) are honest and allowed; the same name elsewhere is not.
 */
import { afterAll, describe, expect, it } from 'vitest';

interface NodeFs {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (p: string, o?: { recursive: boolean }) => void;
  writeFileSync: (p: string, data: string) => void;
  readdirSync: (p: string, o?: { recursive: boolean }) => string[];
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
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
  spawnSync: (cmd: string, args: string[], o: { cwd?: string; encoding: 'utf8' }) => SpawnResult;
}
interface NodeProcess { execPath: string }

const load = <T,>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const [fs, path, os, url, cp] = await Promise.all([
  load<NodeFs>('node:fs'),
  load<NodePath>('node:path'),
  load<NodeOs>('node:os'),
  load<NodeUrl>('node:url'),
  load<NodeChildProcess>('node:child_process'),
]);
const proc = (globalThis as unknown as { process: NodeProcess }).process;

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'check_honest_labels.mjs');
const NAMES = 'Minimap2,Bowtie2,BBMap,CAP3,Velvet,Flye,MIRA,Mauve,LastZ,LASTZ';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/** A fixture folder holding `files` (relative path -> content). */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-honest-labels-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function check(...args: string[]) {
  const r = cp.spawnSync(proc.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
/** The `file:line` locations the checker names. */
const named = (out: string) => [...out.matchAll(/^(\S+:\d+):/gm)].map((m) => m[1]).sort();

describe('US-01M6P23M AC1: the honest-label check', () => {
  it('US-01M6P23M AC1 passes the repository, read whole, and says how many files it read', () => {
    const r = check('--names', NAMES);
    expect(r.out).not.toMatch(/^\S+:\d+:/m);
    expect(r.status, r.out).toBe(0);
    const count = /(\d[\d,]*) files read/.exec(r.out);
    expect(count, r.out).not.toBeNull();
    // every source file under src/ (but src/__tests__) and crates/*/src, counted here on its own
    const sources = fs.readdirSync(path.join(REPO, 'src'), { recursive: true })
      .map((f) => f.split('\\').join('/'))
      .filter((f) => !f.startsWith('__tests__/') && /\.(ts|tsx|js|jsx|mjs|cjs|rs)$/.test(f)).length;
    const crates = fs.readdirSync(path.join(REPO, 'crates'))
      .flatMap((c) => fs.readdirSync(path.join(REPO, 'crates', c), { recursive: true }).map((f) => f.split('\\').join('/')))
      .filter((f) => f.startsWith('src/') && f.endsWith('.rs')).length;
    expect(sources, 'fixture: src/ holds source files').toBeGreaterThan(100);
    expect(crates, 'fixture: crates/*/src holds Rust files').toBeGreaterThan(50);
    expect(Number(count![1].replace(/,/g, ''))).toBe(sources + crates);
  });

  it('US-01M6P23M AC1 fails a TSX option and a Rust literal naming a tool, line by line, and passes comments', () => {
    const root = fixture({
      'src/components/Mapper.tsx': [
        '// minimap2-style seeds, and a Minimap2 note in a comment',
        '/* CAP3 in a block comment */',
        'export const M = () => (',
        '  <select>',
        '    <option>Minimap2</option>',
        '  </select>',
        ');',
      ].join('\n'),
      'crates/demo/src/lib.rs': [
        '//! "Minimap2"-style chaining, in a doc comment',
        '/* a block comment naming Mauve /* nested */ "CAP3" still in the outer comment */',
        'pub fn f() -> &\'static str {',
        '    // "CAP3" quoted in a line comment',
        '    "CAP3"',
        '}',
      ].join('\n'),
    });
    const r = check('--names', NAMES, '--root', root);
    expect(r.status, r.out).toBe(1);
    expect(named(r.out)).toEqual(['crates/demo/src/lib.rs:5', 'src/components/Mapper.tsx:5']);
    expect(r.out).toMatch(/2 files read/);
  });

  it('US-01M6P23M AC1 reads string literals, template parts, JSX text and attributes, and Rust raw strings', () => {
    const root = fixture({
      'src/core/labels.ts': [
        "export const a = 'Bowtie2 mapper';",
        'export const b = `${a} with Velvet`;',
        'export const c = `assembled by Flye`;',
        "export const ok = 'lower-case flye is an icon key, not a claim';",
        "export const word = 'a MIRAGE screen and CAP3D are other words';",
      ].join('\n'),
      'src/components/Card.tsx': [
        'export const Card = () => (',
        '  <div title="MIRA run">',
        '    <h3>Whole-Genome Alignment (Mauve)</h3>',
        '  </div>',
        ');',
      ].join('\n'),
      'crates/demo/src/raw.rs': [
        'pub const R: &str = r#"say "LASTZ" here"#;',
        "pub const Q: char = '\"';",
        'pub const S: &str = "LastZ\\" escaped";',
        "pub fn g<'a>(x: &'a str) -> &'a str { x }",
        'pub const B: &[u8] = b"BBMap";',
      ].join('\n'),
    });
    const r = check('--names', NAMES, '--root', root);
    expect(r.status, r.out).toBe(1);
    expect(named(r.out)).toEqual([
      'crates/demo/src/raw.rs:1', 'crates/demo/src/raw.rs:3', 'crates/demo/src/raw.rs:5',
      'src/components/Card.tsx:2', 'src/components/Card.tsx:3',
      'src/core/labels.ts:1', 'src/core/labels.ts:2', 'src/core/labels.ts:3',
    ]);
  });

  it('US-01M6P23M AC1 allows the external plugins that run a binary, and skips only the test folders', () => {
    const root = fixture({
      'src/plugins/pluginEngine.ts': [
        'export const TOOLS = [',
        "  { id: 'cli-flye', name: 'Flye (runs if installed)', binaryCandidates: ['flye'] },",
        "  { id: 'built-in', name: 'Flye-like built-in assembler' },",
        '];',
      ].join('\n'),
      'src/__tests__/a.test.ts': "export const t = 'Minimap2';",
      'crates/demo/tests/t.rs': 'const T: &str = "CAP3";',
      'crates/demo/src/ok.rs': 'pub const OK: &str = "seed mapper";',
    });
    const r = check('--names', NAMES, '--root', root);
    expect(r.status, r.out).toBe(1);
    expect(named(r.out)).toEqual(['src/plugins/pluginEngine.ts:3']);
    expect(r.out).toMatch(/2 files read/);
  });

  it('US-01M6P23M AC1 fails loud on a missing root, a root with no files and an empty name list', () => {
    const missing = path.join(os.tmpdir(), 'mbc-honest-labels-absent-xyz');
    const a = check('--names', NAMES, '--root', missing);
    expect(a.status, a.out).toBe(2);
    expect(a.out).toMatch(/no src\/ or crates\/ folder/);

    const empty = fixture({ 'README.md': 'nothing to read' });
    const b = check('--names', NAMES, '--root', empty);
    expect(b.status, b.out).toBe(2);
    expect(b.out).toMatch(/no src\/ or crates\/ folder/);

    const c = check('--names', ' , ');
    expect(c.status, c.out).toBe(2);
    expect(c.out).toMatch(/--names/);
  });

  it('US-01M6P23M AC1 checks every name by default, as CI runs it', () => {
    const root = fixture({ 'src/x.ts': ["export const a = 'Mauve';", "export const b = 'LastZ';"].join('\n') });
    const r = check('--root', root);
    expect(r.status, r.out).toBe(1);
    expect(named(r.out)).toEqual(['src/x.ts:1', 'src/x.ts:2']);
  });
});
