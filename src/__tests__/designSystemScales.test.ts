// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The design-system scales (US-01M6Q19K): one recorded set of radius, shadow, type, spacing and
 * chrome-height tokens in src/App.css, equal to what DESIGN.md states, with the wordmark lockup
 * kept at its own recorded sizes (D0024).
 *
 * App.css is parsed into declarations (selector, enclosing at-rules, and the comments in front of
 * each one) and DESIGN.md's YAML front matter into a map, so each check reads the declaration or
 * entry it is about. Only the stale-palette words and two DESIGN.md prose lists (the shadow
 * vocabulary and the chrome heights under Layout) are read as text. A token defined twice, a
 * literal left in a rule, or a DESIGN.md value that drifts from the stylesheet each fail by name.
 */

import { describe, expect, it } from 'vitest';

// CSS `?raw` imports are stubbed by Vitest's CSS handling, so read both files from disk.
const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as {
  readFileSync: (p: URL, enc: string) => string;
};
const APP_CSS = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');
const DESIGN_MD = nodeFs.readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------------------------
// A small CSS reader: enough of the syntax to walk App.css block by block (comments, strings,
// parentheses, at-rule blocks), not a validator.
// ---------------------------------------------------------------------------------------------

interface Decl {
  prop: string;
  value: string;
  /** The innermost style rule's selector list, or null for a declaration directly in an at-rule. */
  selector: string | null;
  /** Enclosing at-rule preludes, outermost first (e.g. `@media (forced-colors: active)`). */
  atRules: string[];
  /** Comments between the previous declaration (or the block start) and this one. */
  leadingComments: string[];
  line: number;
}

function parseCss(text: string): Decl[] {
  const decls: Decl[] = [];
  const lineStarts = [0];
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') lineStarts.push(k + 1);
  const lineAt = (pos: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  let i = 0;

  // Reads up to the next `;`, `{` or `}` outside strings, comments and parentheses.
  const readChunk = () => {
    let out = '';
    let depth = 0;
    let start = -1;
    const comments: string[] = [];
    while (i < text.length) {
      if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) throw new Error(`App.css: unterminated comment at line ${lineAt(i)}`);
        if (start < 0) comments.push(text.slice(i + 2, end));
        i = end + 2;
        continue;
      }
      const c = text[i];
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
        if (start < 0) start = i;
        out += text.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth === 0 && (c === ';' || c === '{' || c === '}')) return { out, stop: c, start, comments };
      if (start < 0 && !/\s/.test(c)) start = i;
      out += c;
      i++;
    }
    return { out, stop: '', start, comments };
  };

  const block = (context: string[], depth: number): void => {
    let pending: string[] = [];
    while (i < text.length) {
      const { out, stop, start, comments } = readChunk();
      pending.push(...comments);
      const chunk = out.trim();
      if (stop === '{') {
        i++;
        block([...context, chunk.replace(/\s+/g, ' ')], depth + 1);
        pending = [];
        continue;
      }
      if (chunk) {
        const colon = chunk.indexOf(':');
        if (colon <= 0) throw new Error(`App.css line ${lineAt(start)}: not a declaration: ${chunk.slice(0, 80)}`);
        const styleRules = context.filter((p) => !p.startsWith('@'));
        decls.push({
          prop: chunk.slice(0, colon).trim(),
          value: chunk.slice(colon + 1).trim().replace(/\s+/g, ' '),
          selector: styleRules.length ? styleRules[styleRules.length - 1] : null,
          atRules: context.filter((p) => p.startsWith('@')),
          leadingComments: pending,
          line: lineAt(start),
        });
        pending = [];
      }
      if (stop === ';') {
        i++;
        continue;
      }
      if (stop === '}') {
        if (depth === 0) throw new Error(`App.css line ${lineAt(i)}: unbalanced closing brace`);
        i++;
        return;
      }
      if (depth !== 0) throw new Error('App.css: unclosed block at end of file');
      return;
    }
    if (depth !== 0) throw new Error('App.css: unclosed block at end of file');
  };
  block([], 0);
  return decls;
}

/** Splits on `sep` characters that sit outside parentheses and brackets. */
function splitTopLevel(text: string, isSep: (c: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth === 0 && isSep(c)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** The class names on the element a selector styles (its last compound, outside `:has()` etc.). */
function subjectClasses(selector: string): string[] {
  const compounds = splitTopLevel(selector, (c) => /[\s>+~]/.test(c));
  let subject = compounds[compounds.length - 1] ?? '';
  while (/\([^()]*\)|\[[^[\]]*\]/.test(subject)) subject = subject.replace(/\([^()]*\)|\[[^[\]]*\]/g, '');
  if (/::/.test(subject)) return []; // a pseudo-element is a different box
  return [...subject.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
}

/**
 * The classes on the element a selector styles, for the chrome-bar check: like subjectClasses, but
 * the classes inside `:is()`, `:where()` and `:matches()` count, while those inside `:not()`,
 * `:has()` and attribute selectors do not.
 */
function barSubjectClasses(selector: string): string[] {
  const compounds = splitTopLevel(selector, (c) => /[\s>+~]/.test(c));
  let subject = compounds[compounds.length - 1] ?? '';
  const skip = /:(not|has|nth-[\w-]+|lang|dir)\([^()]*\)|\[[^[\]]*\]/;
  while (skip.test(subject)) subject = subject.replace(skip, '');
  if (/::/.test(subject)) return [];
  return [...subject.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
}

const isTopLevelRule = (d: Decl, selector: string) => d.atRules.length === 0 && d.selector === selector;
const css = parseCss(APP_CSS);
const customProps = (name: RegExp) => css.filter((d) => name.test(d.prop));

// ---------------------------------------------------------------------------------------------
// DESIGN.md: the YAML front matter (a map-only subset, which is all the file uses) and a few
// sections of prose that state values the front matter does not carry.
// ---------------------------------------------------------------------------------------------

type Yaml = { [key: string]: Yaml | string | number };

function parseFrontMatter(md: string): Yaml {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) throw new Error('DESIGN.md has no YAML front matter between --- lines');
  const root: Yaml = {};
  const stack: { indent: number; node: Yaml }[] = [{ indent: -1, node: root }];
  m[1].split(/\r?\n/).forEach((raw, idx) => {
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const indent = raw.length - raw.trimStart().length;
    const kv = raw.trim().match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+)):(?:\s+(.*))?$/);
    if (!kv) throw new Error(`DESIGN.md front matter line ${idx + 2} is not a "key: value" line: ${raw}`);
    const key = kv[1] ?? kv[2] ?? kv[3];
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (key in parent) throw new Error(`DESIGN.md front matter line ${idx + 2} repeats the key "${key}"`);
    const rawValue = kv[4]?.trim();
    if (!rawValue) {
      const child: Yaml = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else if (/^".*"$/.test(rawValue)) parent[key] = rawValue.slice(1, -1).replace(/\\"/g, '"');
    else if (/^'.*'$/.test(rawValue)) parent[key] = rawValue.slice(1, -1).replace(/''/g, "'");
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) parent[key] = Number(rawValue);
    else parent[key] = rawValue;
  });
  return root;
}

const design = parseFrontMatter(DESIGN_MD);
const map = (node: Yaml | string | number | undefined, where: string): Yaml => {
  if (!node || typeof node !== 'object') throw new Error(`DESIGN.md front matter has no map at ${where}`);
  return node;
};
const str = (node: Yaml | string | number | undefined, where: string): string => {
  if (typeof node !== 'string') throw new Error(`DESIGN.md front matter has no string value at ${where}`);
  return node;
};

/** One `## Heading` section of DESIGN.md's body (up to the next `## `). */
function designSection(heading: string): string {
  const start = DESIGN_MD.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`DESIGN.md has no "## ${heading}" section`);
  const next = DESIGN_MD.indexOf('\n## ', start + 4);
  return DESIGN_MD.slice(start, next < 0 ? undefined : next);
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

const ROLES = ['caption', 'label', 'body', 'title', 'headline', 'display'] as const;
const RADII = ['xs', 'sm', 'md', 'lg', 'pill'] as const;
const SHADOWS = ['sm', 'md', 'lg'] as const;
const norm = (v: string) => v.trim().replace(/\s+/g, ' ');

/** The one top-level `:root` definition of a token (fails if there is not exactly one). */
function rootToken(name: string): string {
  const defs = customProps(new RegExp(`^${name}$`));
  const roots = defs.filter((d) => isTopLevelRule(d, ':root'));
  expect(defs.map((d) => `${d.selector} @${d.line}`), `${name} definitions`).toHaveLength(1);
  expect(roots, `${name} must be defined in :root`).toHaveLength(1);
  return roots[0].value;
}

/**
 * A size token's px value at `--p-scale: 1` (`calc(Nrem * var(--p-scale, 1))`, `Nrem` or `Npx`),
 * or the normalised text for anything else (the display clamp).
 */
function sizeOf(value: string): number | string {
  const v = norm(value);
  const scaled = v.match(/^calc\(\s*([\d.]+)rem \* var\(--p-scale(?:, ?1)?\)\s*\)$/);
  if (scaled) return Number(scaled[1]) * 16;
  const rem = v.match(/^([\d.]+)rem$/);
  if (rem) return Number(rem[1]) * 16;
  const px = v.match(/^([\d.]+)px$/);
  if (px) return Number(px[1]);
  return v;
}

const ROLE_TOKEN = new RegExp(`^var\\(--font-size-(${ROLES.join('|')})\\)$`);

/**
 * The MolBioCraft wordmark lockup (D0024) is logo artwork, so it keeps the sizes it had before this
 * story, outside the six type roles. Each lockup element reads its own `--brand-lockup-<name>` token
 * and DESIGN.md records each one as `typography.brand-lockup-<name>`.
 */
const BRAND_LOCKUP: Record<string, { selector: string; size: string }> = {
  'start-wordmark': { selector: '.mbc-home-title', size: '38px' },
  'about-wordmark': { selector: '.about-hero-brand', size: '36px' },
  'about-workbench': { selector: '.about-hero-sub', size: '17px' },
  'splash-wordmark': { selector: '.mbc-splash-title', size: 'clamp(2.4rem, 1.6rem + 3vw, 3.6rem)' },
  'splash-workbench': { selector: '.mbc-splash-subtitle', size: 'clamp(1.5rem, 1rem + 1.9vw, 2.2rem)' },
};
const LOCKUP_PREFIX = 'brand-lockup-';

/** A declaration that reads a lockup token exactly as D0024 allows: its own element's font-size. */
function isLockupRead(d: Decl): boolean {
  const m = d.value.match(/^var\(--brand-lockup-([\w-]+)\)$/);
  return !!m && d.prop === 'font-size' && d.atRules.length === 0 && BRAND_LOCKUP[m[1]]?.selector === d.selector;
}
const RADIUS_TOKEN = /^var\(--mbc-radius-(xs|sm|md|lg|pill)\)$/;
const SPACE_TOKEN = /^var\(--mbc-space-[1-6]\)$/;

const LAYOUT_PRIMITIVES = [
  'hybrid-studio-wrapper',
  'studio-split-grid',
  'studio-card',
  'studio-card-header',
  'form-grid-2col',
  'thermo-kpi-grid',
  'kpi-box',
  'cloning-action-row',
  'doc-table-toolbar',
  'mbc-viewer-header',
  'mbc-viewer-canvas',
];

const CHROME_BARS = [
  { cls: 'mbc-menubar', token: '--mbc-menubar-h', component: 'menubar', layout: /^- menubar (\d+(?:\.\d+)?)px\b/m },
  { cls: 'mbc-project-tabbar', token: '--mbc-tabbar-h', component: 'tab-bar', layout: /^- tab and search bar (\d+(?:\.\d+)?)px\b/m },
  { cls: 'mbc-action-toolbar', token: '--mbc-toolbar-h', component: 'action-toolbar', layout: /^- action toolbar (\d+(?:\.\d+)?)px\b/m },
  { cls: 'mbc-statusbar', token: '--mbc-statusbar-h', component: 'statusbar', layout: /^- status bar (\d+(?:\.\d+)?)px\b/m },
];

// Night shadows are not in DESIGN.md; these are the values the night theme rendered before the
// duplicate `.mbc-dark-mode` blocks were merged (the later block won the cascade).
const NIGHT_SHADOWS: Record<(typeof SHADOWS)[number], string> = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.4)',
  md: '0 6px 16px rgba(0, 0, 0, 0.45)',
  lg: '0 16px 40px rgba(0, 0, 0, 0.55)',
};

describe('design-system scales (US-01M6Q19K)', () => {
  it('defines each radius and shadow token once per theme', () => {
    const expectedRadii = { xs: '4px', sm: '6px', md: '8px', lg: '12px', pill: '999px' };
    for (const r of RADII) {
      const defs = customProps(new RegExp(`^--mbc-radius-${r}$`));
      expect(defs.map((d) => `${d.atRules.join(' ')} ${d.selector} @${d.line}`), `--mbc-radius-${r} definitions`).toHaveLength(1);
      expect(isTopLevelRule(defs[0], ':root'), `--mbc-radius-${r} is defined in light :root`).toBe(true);
      expect(defs[0].value, `--mbc-radius-${r}`).toBe(expectedRadii[r]);
    }

    const elevation = designSection('Elevation & Depth');
    const designShadow = (name: string): string => {
      const m = elevation.match(new RegExp(`\\*\\*${name}\\*\\* \\(\`box-shadow: ([^\`]+)\`\\)`));
      if (!m) throw new Error(`DESIGN.md Elevation & Depth does not state the ${name} shadow`);
      return norm(m[1]);
    };
    const lightShadows = { sm: designShadow('Rest'), md: designShadow('Raised'), lg: designShadow('Floating') };
    for (const s of SHADOWS) {
      const defs = customProps(new RegExp(`^--mbc-shadow-${s}$`));
      const light = defs.filter((d) => isTopLevelRule(d, ':root'));
      const night = defs.filter((d) => isTopLevelRule(d, '.mbc-dark-mode'));
      const where = defs.map((d) => `${d.atRules.join(' ')} ${d.selector} @${d.line}`);
      expect(light, `--mbc-shadow-${s} in light :root (${where.join('; ')})`).toHaveLength(1);
      expect(night, `--mbc-shadow-${s} in .mbc-dark-mode (${where.join('; ')})`).toHaveLength(1);
      expect(defs, `--mbc-shadow-${s} defined outside the two theme blocks (${where.join('; ')})`).toHaveLength(2);
      expect(norm(light[0].value), `light --mbc-shadow-${s}`).toBe(lightShadows[s]);
      expect(norm(night[0].value), `night --mbc-shadow-${s}`).toBe(NIGHT_SHADOWS[s]);
    }
  });

  it('uses only the DESIGN.md radius scale', () => {
    const radii = css.filter((d) => /^border(-(top|bottom)-(left|right)|-(start|end)-(start|end))?-radius$/.test(d.prop));
    expect(radii.length).toBeGreaterThan(100);
    const offScale = radii.filter((d) => {
      if (['0', '50%', 'inherit'].includes(d.value)) return false;
      const corners = splitTopLevel(d.value, (c) => /\s/.test(c)).filter((p) => p !== '/');
      return !corners.every((p) => p === '0' || RADIUS_TOKEN.test(p));
    });
    expect(offScale.map((d) => `${d.line} ${d.selector} { ${d.prop}: ${d.value} }`)).toEqual([]);
  });

  it('names the type tokens for the DESIGN.md roles', () => {
    expect(rootToken('--p-scale')).toBe('1');
    const typeTokens = customProps(/^--font-size-/);
    expect(typeTokens.map((d) => d.prop).sort()).toEqual(ROLES.map((r) => `--font-size-${r}`).sort());
    const expected: Record<(typeof ROLES)[number], number | string> = {
      caption: 11,
      label: 12,
      body: 12.5,
      title: 13.5,
      headline: 15,
      display: norm(str(map(map(design.typography, 'typography').display, 'typography.display').fontSize, 'typography.display.fontSize')),
    };
    for (const role of ROLES) expect(sizeOf(rootToken(`--font-size-${role}`)), `--font-size-${role}`).toBe(expected[role]);

    // The old names are gone, as definitions and as references.
    expect(APP_CSS).not.toMatch(/--font-size-subhead\b/);

    // No --mbc-text-* token is a size: none holds a length or reads a --font-size-* token, directly
    // or through the custom properties it reads (every definition of each one is followed).
    const length = /(^|[^\w#.-])-?(\d+\.?\d*|\.\d+)(px|rem|em|pt|pc|vw|vh|vmin|vmax|ch|ex|lh|rlh|cm|mm|in|q)\b/i;
    const defsOf = (prop: string) => css.filter((d) => d.prop === prop).map((d) => d.value);
    const sizeIn = (value: string, seen: Set<string>): string | null => {
      if (length.test(value)) return value;
      if (/var\(\s*--font-size-/.test(value)) return value;
      for (const [, ref] of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        for (const v of defsOf(ref)) {
          const hit = sizeIn(v, seen);
          if (hit) return `${ref}: ${hit}`;
        }
      }
      return null;
    };
    const mbcText = customProps(/^--mbc-text-/);
    const sized = mbcText.flatMap((d) => {
      const hit = sizeIn(d.value, new Set([d.prop]));
      return hit ? [`${d.prop}: ${d.value} @${d.line} (${hit})`] : [];
    });
    expect(sized, 'an --mbc-text-* token holds a size').toEqual([]);
    // The four colour tokens with that prefix stay.
    for (const name of ['main', 'secondary', 'muted', 'selected']) {
      expect(mbcText.some((d) => d.prop === `--mbc-text-${name}` && isTopLevelRule(d, ':root')), `--mbc-text-${name} in :root`).toBe(true);
    }
    const mbcTextRefs = css.filter((d) => /var\(\s*--mbc-text-[\w-]+/.test(d.value) && /^font(-size)?$/.test(d.prop));
    expect(mbcTextRefs.map((d) => `${d.line} ${d.prop}: ${d.value}`)).toEqual([]);
  });

  it('sets every font size from a type role', () => {
    const sizes = css.filter((d) => d.prop === 'font-size');
    expect(sizes.length).toBeGreaterThan(300);
    const literal = sizes.filter((d) => d.value !== 'inherit' && !ROLE_TOKEN.test(d.value) && !isLockupRead(d));
    expect(literal.map((d) => `${d.line} ${d.selector} { font-size: ${d.value} }`)).toEqual([]);

    // The lockup tokens are read only by the lockup: each lockup element's font-size reads its own
    // token, and nothing else reads one (no other selector, property, at-rule or alias).
    const lockupReads = css.filter((d) => !d.prop.startsWith(`--${LOCKUP_PREFIX}`) && d.value.includes(`--${LOCKUP_PREFIX}`));
    expect(lockupReads.filter((d) => !isLockupRead(d)).map((d) => `${d.line} ${d.atRules.join(' ')} ${d.selector} { ${d.prop}: ${d.value} }`)).toEqual([]);
    // Every rule that sizes a lockup element (any selector whose subject carries its class, in any
    // at-rule) is its one top-level rule reading its own token.
    for (const [name, { selector }] of Object.entries(BRAND_LOCKUP)) {
      const cls = selector.slice(1);
      const own = css.filter(
        (d) => /^font(-size)?$/.test(d.prop) && d.selector && splitTopLevel(d.selector, (c) => c === ',').some((s) => subjectClasses(s).includes(cls))
      );
      expect(own.map((d) => `${d.atRules.join(' ')} ${d.selector} { ${d.prop}: ${d.value} }`.trim()), `${selector} font size`).toEqual([
        `${selector} { font-size: var(--${LOCKUP_PREFIX}${name}) }`,
      ]);
    }

    // The `font` shorthand sets a size too.
    const shorthand = css.filter((d) => d.prop === 'font' && !['inherit', 'initial', 'unset'].includes(d.value));
    const badShorthand = shorthand.filter(
      (d) => /(^|[\s/])-?[\d.]+(px|rem|em|pt|%)(?=$|[\s/])/.test(d.value) || ![...d.value.matchAll(/var\(--font-size-([\w-]+)\)/g)].some((m) => (ROLES as readonly string[]).includes(m[1]))
    );
    expect(badShorthand.map((d) => `${d.line} ${d.selector} { font: ${d.value} }`)).toEqual([]);

    const used = new Set(sizes.filter((d) => d.value !== 'inherit' && !isLockupRead(d)).map((d) => d.value));
    expect(used.size).toBeLessThanOrEqual(ROLES.length);
  });

  it('spaces the shared layout primitives from the spacing scale', () => {
    const spacing = /^(gap|row-gap|column-gap|padding|padding-[a-z-]+|margin|margin-[a-z-]+)$/;
    const found = new Map(LAYOUT_PRIMITIVES.map((p) => [p, 0]));
    const offScale: string[] = [];
    for (const d of css) {
      if (!d.selector || !spacing.test(d.prop)) continue;
      const hits = splitTopLevel(d.selector, (c) => c === ',').flatMap(subjectClasses).filter((c) => found.has(c));
      if (!hits.length) continue;
      for (const h of new Set(hits)) found.set(h, (found.get(h) ?? 0) + 1);
      const parts = splitTopLevel(d.value, (c) => /\s/.test(c));
      if (!parts.every((p) => p === '0' || SPACE_TOKEN.test(p))) offScale.push(`${d.line} ${d.selector} { ${d.prop}: ${d.value} }`);
    }
    // Every primitive is still in the stylesheet with its spacing, so a rename cannot pass silently.
    expect([...found].filter(([, n]) => n === 0).map(([p]) => p)).toEqual([]);
    expect(offScale).toEqual([]);
  });

  it('takes chrome bar heights from the tokens DESIGN.md states', () => {
    const components = map(design.components, 'components');
    const layout = designSection('Layout');
    for (const bar of CHROME_BARS) {
      // Any rule whose subject is the bar sets its height: with a second class, a pseudo-class or
      // `:is()`/`:where()` around it too. Only a pseudo-element (`::before`) is a different box.
      const heights = css.filter(
        (d) => d.selector && /^(min-|max-)?(height|block-size)$/.test(d.prop) && splitTopLevel(d.selector, (c) => c === ',').some((s) => barSubjectClasses(s).includes(bar.cls))
      );
      expect(heights.length, `.${bar.cls} sets a height`).toBeGreaterThan(0);
      for (const d of heights) expect(`${d.prop}: ${d.value}`, `.${bar.cls} @${d.line}`).toBe(`${d.prop}: var(${bar.token})`);

      const token = sizeOf(rootToken(bar.token));
      const stated = sizeOf(str(map(components[bar.component], `components.${bar.component}`).height, `components.${bar.component}.height`));
      expect(stated, `DESIGN.md components.${bar.component}.height vs ${bar.token}`).toBe(token);
      const prose = layout.match(bar.layout);
      if (!prose) throw new Error(`DESIGN.md Layout does not list the ${bar.component} height (${bar.layout})`);
      expect(Number(prose[1]), `DESIGN.md Layout ${bar.component} vs ${bar.token}`).toBe(token);
    }
  });

  it('describes the Benchlight palette in the stylesheet comment', () => {
    for (const stale of ['indigo-violet', 'citron', 'warm paper']) {
      expect(APP_CSS.toLowerCase().includes(stale), `App.css still describes the palette as "${stale}"`).toBe(false);
    }
    // The colour-system comment is the one in front of the first palette token in :root.
    const firstPaletteToken = css.find((d) => isTopLevelRule(d, ':root') && d.prop === '--mbc-accent-light');
    if (!firstPaletteToken) throw new Error('App.css :root no longer defines --mbc-accent-light');
    const comment = firstPaletteToken.leadingComments.join('\n');
    expect(comment).toMatch(/Benchlight Workstation/);
    expect(comment).toMatch(/DESIGN\.md/);
  });

  it('keeps DESIGN.md scales equal to the stylesheet tokens', () => {
    const rounded = map(design.rounded, 'rounded');
    const spacingScale = map(design.spacing, 'spacing');
    const typography = map(design.typography, 'typography');

    const pairs: [string, number | string, number | string][] = [];
    for (const [k, v] of Object.entries(rounded)) pairs.push([`rounded.${k}`, sizeOf(String(v)), sizeOf(rootToken(`--mbc-radius-${k}`))]);
    for (const [k, v] of Object.entries(spacingScale)) pairs.push([`spacing.${k}`, sizeOf(String(v)), sizeOf(rootToken(`--mbc-space-${k}`))]);
    for (const [role, spec] of Object.entries(typography)) {
      // Residue is Google Sans Code at the body size; it has no size token of its own. A brand-lockup
      // entry is the wordmark's own size (D0024), read from its --brand-lockup-* token.
      const token = role === 'residue' ? '--font-size-body' : role.startsWith(LOCKUP_PREFIX) ? `--${role}` : `--font-size-${role}`;
      const size = sizeOf(str(map(spec, `typography.${role}`).fontSize, `typography.${role}.fontSize`));
      pairs.push([`typography.${role}.fontSize`, size, sizeOf(rootToken(token))]);
    }
    for (const [where, stated, token] of pairs) expect(token, where).toBe(stated);

    // And the other way: every scale token in the stylesheet has a DESIGN.md entry.
    const named = (re: RegExp) => [...new Set(customProps(re).map((d) => d.prop.match(re)![1]))].sort();
    const typographyKeys = Object.keys(typography);
    expect(named(/^--mbc-radius-([\w-]+)$/)).toEqual(Object.keys(rounded).sort());
    expect(named(/^--mbc-space-([\w-]+)$/)).toEqual(Object.keys(spacingScale).sort());
    expect(named(/^--font-size-([\w-]+)$/)).toEqual(typographyKeys.filter((r) => r !== 'residue' && !r.startsWith(LOCKUP_PREFIX)).sort());
    expect(named(/^--brand-lockup-([\w-]+)$/)).toEqual(typographyKeys.filter((r) => r.startsWith(LOCKUP_PREFIX)).map((r) => r.slice(LOCKUP_PREFIX.length)).sort());

    // The lockup entries hold the sizes the wordmark had before this story (D0024), so the lockup
    // cannot be resized by moving DESIGN.md and the token together.
    for (const [name, { size }] of Object.entries(BRAND_LOCKUP)) {
      const spec = map(typography[`${LOCKUP_PREFIX}${name}`], `typography.${LOCKUP_PREFIX}${name}`);
      expect(norm(str(spec.fontSize, `typography.${LOCKUP_PREFIX}${name}.fontSize`)), `DESIGN.md typography.${LOCKUP_PREFIX}${name}`).toBe(size);
      expect(norm(rootToken(`--${LOCKUP_PREFIX}${name}`)), `--${LOCKUP_PREFIX}${name}`).toBe(size);
    }
  });
});
