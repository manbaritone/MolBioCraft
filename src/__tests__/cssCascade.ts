// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * src/App.css as the cascade applies it to an element of the live DOM (liveDom.ts) in a window of a
 * given width, with the viewer canvas (and any other size container) at a given width. Copied from
 * the App.css reader of alignmentPaneResize.test.tsx (rules, at-rule test, selector matching,
 * cascaded) and the nested @container parse of sequenceSplitView.test.tsx, which keep their own
 * copies, and extended:
 *
 * - at-rules nest (`@media` inside `@supports` and so on); `@keyframes`, `@font-face` and `@property`
 *   bodies hold no rules for elements and are skipped;
 * - `@media` is evaluated in the live window's environment (liveDom.ts: light theme, no motion or
 *   contrast preference, a fine pointer that hovers) at `view.window` x `view.height`;
 * - `@container` finds the element's nearest ancestor that App.css makes a query container (its
 *   `container` or `container-type`), by name when the rule names one, and tests its width:
 *   `view.canvas` for the viewer canvas (`viewer-canvas`), `view.containers` by container name or by a
 *   class of the container element. With no such ancestor the condition is false, as in a browser;
 * - `@supports` holds for every declaration and selector test (the model's engine supports what
 *   App.css tests for);
 * - selectors are matched by the live DOM's selector engine, the page at rest (no pointer over or
 *   pressing anything, focus where the document has it);
 * - specificity, `!important`, source order and the element's inline style decide the winner, and a
 *   physical property shares its declarations with its logical twin (width and inline-size, left and
 *   inset-inline-start, ...) in the horizontal, left-to-right writing mode;
 * - a shorthand that sets the property is expanded where the reader knows how (flex, container,
 *   gap, overflow, inset, margin, padding, place-*), and named in a thrown error where it does not.
 *
 * It fails by name, rather than guess, when a rule that may set the property on the element depends
 * on a selector part or an at-rule condition it cannot evaluate (a pseudo-class it does not model, a
 * scroll-state or style container query, a container width the view does not give, cascade layers, a
 * media feature it does not model). The value it returns is the cascaded value as declared, `var()`
 * and all; inheritance is not applied.
 */

import {
  compareSpecificity,
  evaluateCondition,
  evaluateMediaQuery,
  LiveElement,
  matchSelector,
  parseSelectorList,
  sizeFeature,
  specificity,
  splitTopLevel,
  type ComplexSelector,
  type Tri,
} from './liveDom';

const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as { readFileSync: (p: URL, enc: string) => string };

// ─── The stylesheet, parsed ───

export interface CssDeclaration { name: string; value: string; important: boolean }
export interface CssRule {
  /** The rule's selector list, as written. */
  selectorText: string;
  decls: CssDeclaration[];
  /** The at-rules it sits in, outermost first (`@media (max-width: 1150px)`). */
  at: string[];
  order: number;
}

/** At-rules whose bodies hold no style rules for elements. */
const NON_STYLE_AT_RULES = /^@(-webkit-|-moz-)?(keyframes|font-face|property|page|counter-style|font-feature-values|font-palette-values|view-transition)\b/i;

/** Finds the `}` that closes the block opened at `open`, past quoted strings. */
function blockEnd(src: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  throw new Error('the stylesheet leaves a block open');
}

/** Parses a stylesheet into its style rules, each with the at-rules it sits in. */
export function parseCss(text: string): CssRule[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const scan = (s: string, at: string[]) => {
    let i = 0;
    while (i < s.length) {
      let j = i;
      let quote = '';
      while (j < s.length) {
        const c = s[j];
        if (quote) { if (c === '\\') j++; else if (c === quote) quote = ''; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '{' || c === ';' || c === '}') break;
        j++;
      }
      if (j >= s.length) break;
      const prelude = s.slice(i, j).trim().replace(/\s+/g, ' ');
      if (s[j] !== '{') {
        if (/^@import\b/i.test(prelude)) throw new Error(`the stylesheet imports another sheet (${prelude}), which the reader does not load`);
        i = j + 1;
        continue;
      }
      const end = blockEnd(s, j);
      const body = s.slice(j + 1, end);
      if (prelude.startsWith('@')) {
        if (!NON_STYLE_AT_RULES.test(prelude)) scan(body, [...at, prelude]);
      } else {
        if (body.includes('{')) throw new Error(`the stylesheet nests rules inside "${prelude}", which the reader does not read`);
        const decls = splitTopLevel(body, ';').flatMap((d): CssDeclaration[] => {
          const k = d.indexOf(':');
          if (k <= 0) return [];
          const rawName = d.slice(0, k).trim();
          const raw = d.slice(k + 1).trim().replace(/\s+/g, ' ');
          const important = /!\s*important$/i.test(raw);
          return [{ name: rawName.startsWith('--') ? rawName : rawName.toLowerCase(), value: raw.replace(/\s*!\s*important$/i, '').trim(), important }];
        });
        rules.push({ selectorText: prelude, decls, at, order: rules.length });
      }
      i = end + 1;
    }
  };
  scan(src, []);
  return rules;
}

let appRules: CssRule[] | null = null;
/** src/App.css, read and parsed once. */
export function appCssRules(): CssRule[] {
  appRules ??= parseCss(nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8'));
  return appRules;
}

// ─── Properties: logical twins and shorthands ───

/** Physical and logical properties that set the same thing in the horizontal, left-to-right writing mode. */
const TWINS: string[][] = [
  ['width', 'inline-size'], ['height', 'block-size'],
  ['min-width', 'min-inline-size'], ['max-width', 'max-inline-size'], ['min-height', 'min-block-size'], ['max-height', 'max-block-size'],
  ...['margin', 'padding'].flatMap((box) => [[`${box}-left`, `${box}-inline-start`], [`${box}-right`, `${box}-inline-end`], [`${box}-top`, `${box}-block-start`], [`${box}-bottom`, `${box}-block-end`]]),
  ['left', 'inset-inline-start'], ['right', 'inset-inline-end'], ['top', 'inset-block-start'], ['bottom', 'inset-block-end'],
];
const twinsOf = (prop: string) => TWINS.find((g) => g.includes(prop)) ?? [prop];

const SIDES = ['top', 'right', 'bottom', 'left'];
/** Each shorthand and the longhands it sets; `expand` gives their values where the reader knows how. */
const SHORTHANDS: Record<string, { longhands: string[]; expand?: (tokens: string[]) => string[] | null }> = {
  flex: { longhands: ['flex-grow', 'flex-shrink', 'flex-basis'], expand: expandFlex },
  container: { longhands: ['container-name', 'container-type'], expand: expandContainer },
  gap: { longhands: ['row-gap', 'column-gap'], expand: (t) => pair(t) },
  'grid-gap': { longhands: ['row-gap', 'column-gap'], expand: (t) => pair(t) },
  overflow: { longhands: ['overflow-x', 'overflow-y'], expand: (t) => pair(t) },
  'place-items': { longhands: ['align-items', 'justify-items'], expand: (t) => pair(t) },
  'place-content': { longhands: ['align-content', 'justify-content'], expand: (t) => pair(t) },
  'place-self': { longhands: ['align-self', 'justify-self'], expand: (t) => pair(t) },
  inset: { longhands: SIDES, expand: fourSides },
  'inset-inline': { longhands: ['inset-inline-start', 'inset-inline-end'], expand: (t) => pair(t) },
  'inset-block': { longhands: ['inset-block-start', 'inset-block-end'], expand: (t) => pair(t) },
  ...Object.fromEntries(['margin', 'padding'].flatMap((box) => [
    [box, { longhands: SIDES.map((s) => `${box}-${s}`), expand: fourSides }],
    [`${box}-inline`, { longhands: [`${box}-inline-start`, `${box}-inline-end`], expand: (t: string[]) => pair(t) }],
    [`${box}-block`, { longhands: [`${box}-block-start`, `${box}-block-end`], expand: (t: string[]) => pair(t) }],
  ])),
  'flex-flow': { longhands: ['flex-direction', 'flex-wrap'] },
  grid: { longhands: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas', 'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow'] },
  'grid-template': { longhands: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'] },
  'grid-area': { longhands: ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'] },
  'grid-row': { longhands: ['grid-row-start', 'grid-row-end'] },
  'grid-column': { longhands: ['grid-column-start', 'grid-column-end'] },
  border: { longhands: SIDES.flatMap((s) => ['width', 'style', 'color'].map((k) => `border-${s}-${k}`)) },
  ...Object.fromEntries(SIDES.map((s) => [`border-${s}`, { longhands: ['width', 'style', 'color'].map((k) => `border-${s}-${k}`) }])),
  ...Object.fromEntries(['width', 'style', 'color'].map((k) => [`border-${k}`, { longhands: SIDES.map((s) => `border-${s}-${k}`) }])),
  'border-radius': { longhands: ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] },
  background: { longhands: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'] },
  font: { longhands: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'] },
  'text-decoration': { longhands: ['text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness'] },
  outline: { longhands: ['outline-color', 'outline-style', 'outline-width'] },
  'list-style': { longhands: ['list-style-type', 'list-style-position', 'list-style-image'] },
  transition: { longhands: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'] },
  animation: { longhands: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'] },
  columns: { longhands: ['column-width', 'column-count'] },
};
function pair(t: string[]): string[] | null { return t.length === 1 ? [t[0], t[0]] : t.length === 2 ? t : null; }
function fourSides(t: string[]): string[] | null {
  if (t.length === 1) return [t[0], t[0], t[0], t[0]];
  if (t.length === 2) return [t[0], t[1], t[0], t[1]];
  if (t.length === 3) return [t[0], t[1], t[2], t[1]];
  return t.length === 4 ? t : null;
}
function expandFlex(t: string[]): string[] | null {
  const num = (s: string) => /^[\d.]+$/.test(s);
  if (t.length === 1) {
    if (t[0] === 'none') return ['0', '0', 'auto'];
    if (t[0] === 'auto') return ['1', '1', 'auto'];
    if (t[0] === 'initial') return ['0', '1', 'auto'];
    return num(t[0]) ? [t[0], '1', '0%'] : ['1', '1', t[0]];
  }
  if (t.length === 2) return num(t[1]) ? [t[0], t[1], '0%'] : [t[0], '1', t[1]];
  return t.length === 3 ? t : null;
}
function expandContainer(t: string[]): string[] | null {
  const slash = t.indexOf('/');
  const names = slash < 0 ? t : t.slice(0, slash);
  const type = slash < 0 ? 'normal' : t.slice(slash + 1).join(' ');
  return names.length ? [names.join(' '), type || 'normal'] : null;
}
/** The value tokens of a declaration, split at the top level (not inside functions). */
export function gridTracks(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const tokensOf = (value: string) => gridTracks(value.replace(/\s*\/\s*/g, ' / '));

/** Which of `names` a shorthand declaration sets, and to what; throws, naming it, where it cannot tell. */
function fromShorthand(decl: CssDeclaration, names: string[], where: string): string | undefined {
  const sh = SHORTHANDS[decl.name];
  const at = sh.longhands.findIndex((l) => names.includes(l));
  if (at < 0) return undefined;
  const tokens = tokensOf(decl.value);
  if (/^(inherit|initial|unset|revert|revert-layer)$/.test(decl.value)) return decl.value;
  const values = sh.expand && !decl.value.includes('var(') ? sh.expand(tokens) : null;
  if (!values) throw new Error(`${where} sets ${names[0]} through the shorthand "${decl.name}: ${decl.value}", which the reader does not expand`);
  return values[at];
}

// ─── At-rule conditions ───

/** The window and container sizes a cascade is read at. */
export interface CascadeView {
  /** The window's inner width, for `@media`. */
  window: number;
  /** The window's inner height (800 unless given). */
  height?: number;
  /** The viewer canvas's inline size, for `@container viewer-canvas` and the unnamed queries it answers. */
  canvas?: number;
  /** Other query containers' inline sizes, by container name or by a class of the container element. */
  containers?: Record<string, number>;
}

const describe = (el: LiveElement) => `<${el.localName}${el.getAttribute('class') ? ` class="${el.getAttribute('class')}"` : ''}>`;

interface Container { el: LiveElement; names: string[]; type: string }
/** The query container App.css makes of `el`, if it makes one. */
function containerOf(el: LiveElement, view: CascadeView, rules: readonly CssRule[]): Container | null {
  const type = cascaded(el, 'container-type', view, rules) ?? 'normal';
  if (type === 'normal') return null;
  const name = cascaded(el, 'container-name', view, rules) ?? 'none';
  return { el, names: name === 'none' ? [] : name.split(/\s+/), type };
}
/** The nearest ancestor of `el` that is a query container of `kind`, named `name` when one is given. */
function nearestContainer(el: LiveElement, kind: 'size' | 'scroll-state', name: string | null, view: CascadeView, rules: readonly CssRule[]): Container | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const c = containerOf(n, view, rules);
    if (!c) continue;
    const types = c.type.split(/\s+/);
    const fits = kind === 'size' ? types.includes('inline-size') || types.includes('size') : types.includes('scroll-state');
    if (fits && (!name || c.names.includes(name))) return c;
  }
  return null;
}
function containerWidth(c: Container, view: CascadeView): number | undefined {
  for (const n of c.names) {
    if (n === 'viewer-canvas' && view.canvas !== undefined) return view.canvas;
    if (view.containers?.[n] !== undefined) return view.containers[n];
  }
  for (const cls of c.el.classList) if (view.containers?.[cls] !== undefined) return view.containers[cls];
  return undefined;
}

/** Whether an at-rule holds for `el` at `view`; `why` collects what an unknown answer could not evaluate. */
function atRuleHolds(at: string, el: LiveElement, view: CascadeView, rules: readonly CssRule[], why: string[]): Tri {
  const m = /^@([a-z-]+)\s*(.*)$/i.exec(at);
  const kind = m?.[1].toLowerCase();
  const rest = m?.[2] ?? '';
  const unknown = (reason: string): Tri => { why.push(reason); return 'unknown'; };
  if (kind === 'media') {
    const r = evaluateMediaQuery(rest, { width: view.window, height: view.height ?? 800 });
    return r === 'unknown' ? unknown(`the media query "${rest}"`) : r;
  }
  if (kind === 'supports') {
    const r = evaluateCondition(rest, (test) => (/^\(\s*[-a-z]+\s*:/i.test(test) || /^selector\(/i.test(test) ? true : 'unknown'));
    return r === 'unknown' ? unknown(`the feature query "${rest}"`) : r;
  }
  if (kind === 'container') {
    const named = /^([a-zA-Z_][\w-]*)\s+(?!and\b|or\b)(.+)$/.exec(rest);
    const name = named && !/^not$/i.test(named[1]) ? named[1] : null;
    const condition = name ? named![2] : rest;
    return evaluateCondition(condition, (test) => {
      if (/^scroll-state\(/i.test(test)) {
        const c = nearestContainer(el, 'scroll-state', name, view, rules);
        return c ? unknown(`the scroll-state query "${test}" on ${describe(c.el)}`) : false;
      }
      if (/^style\(/i.test(test)) return unknown(`the style query "${test}"`);
      const c = nearestContainer(el, 'size', name, view, rules);
      if (!c) return false;
      const width = containerWidth(c, view);
      if (width === undefined) {
        return unknown(`"${at}", which queries ${describe(c.el)}${c.names.length ? ` (container ${c.names.join(' ')})` : ''}, a container whose width the view does not give`);
      }
      const r = sizeFeature(test, { width, height: Number.NaN }, { width: ['width', 'inline-size'], height: ['height', 'block-size'] });
      if (r === null || r === 'unknown' || /\b(height|block-size)\b/.test(test)) return unknown(`the container condition "${test}"`);
      return r;
    });
  }
  return unknown(`the at-rule "${at}"${kind === 'layer' ? ' (cascade layers are not modelled)' : ''}`);
}

// ─── The cascade ───

const INDEX = new WeakMap<readonly CssRule[], Map<string, CssRule[]>>();
function rulesDeclaring(rules: readonly CssRule[], names: Iterable<string>): CssRule[] {
  let index = INDEX.get(rules);
  if (!index) {
    index = new Map();
    for (const r of rules) for (const d of r.decls) { const list = index.get(d.name) ?? []; if (list[list.length - 1] !== r) list.push(r); index.set(d.name, list); }
    INDEX.set(rules, index);
  }
  const hit = new Set<CssRule>();
  for (const n of names) for (const r of index.get(n) ?? []) hit.add(r);
  return [...hit].sort((a, b) => a.order - b.order);
}

/** Whether a rule's selector list matches `el`, with the specificity of its most specific matching selector. */
function selectorListMatch(rule: CssRule, el: LiveElement, why: string[]): { match: Tri; spec: [number, number, number] } {
  let match: Tri = false;
  let spec: [number, number, number] = [0, 0, 0];
  for (const text of splitTopLevel(rule.selectorText)) {
    let sel: ComplexSelector;
    try {
      [sel] = parseSelectorList(text.trim());
    } catch {
      why.push(`the selector "${text.trim()}"`);
      match = match === true ? true : 'unknown';
      continue;
    }
    const r = matchSelector(el, sel);
    if (r === false) continue;
    if (r === 'unknown') { why.push(`the selector "${text.trim()}"`); if (match !== true) match = 'unknown'; continue; }
    match = true;
    const s = specificity(sel);
    if (compareSpecificity(s, spec) > 0) spec = s;
  }
  return { match, spec };
}

interface Candidate { value: string; important: boolean; inline: boolean; spec: [number, number, number]; order: number }
const beats = (a: Candidate, b: Candidate) => {
  if (a.important !== b.important) return a.important;
  if (a.inline !== b.inline) return a.inline;
  const s = compareSpecificity(a.spec, b.spec);
  return s !== 0 ? s > 0 : a.order >= b.order;
};

/**
 * The value of `prop` the cascade gives `el` from App.css (or `rules`) in a window `view.window` wide
 * with the given containers, or undefined when no declaration applies. Throws, naming the rule and
 * the part, when a rule that may set `prop` on `el` depends on a selector part or condition the
 * reader cannot evaluate, or sets it through a shorthand it does not expand.
 */
export function cascaded(el: LiveElement, prop: string, view: CascadeView, rules: readonly CssRule[] = appCssRules()): string | undefined {
  const names = twinsOf(prop.startsWith('--') ? prop : prop.toLowerCase());
  const shorthands = Object.keys(SHORTHANDS).filter((s) => SHORTHANDS[s].longhands.some((l) => names.includes(l)));
  let best: Candidate | undefined;
  const offer = (c: Candidate) => { if (!best || beats(c, best)) best = c; };
  for (const rule of rulesDeclaring(rules, [...names, ...shorthands])) {
    const why: string[] = [];
    const sel = selectorListMatch(rule, el, why);
    if (sel.match === false) continue;
    let cond: Tri = true;
    for (const at of rule.at) {
      const r = atRuleHolds(at, el, view, rules, why);
      if (r === false) { cond = false; break; }
      if (r === 'unknown') cond = 'unknown';
    }
    if (cond === false) continue;
    const where = `the App.css rule "${rule.selectorText}"${rule.at.length ? ` in ${rule.at.join(' ')}` : ''}`;
    if (sel.match === 'unknown' || cond === 'unknown') {
      throw new Error(`${where} may set ${prop} on ${describe(el)}, but the reader cannot evaluate ${why.join(' or ')}`);
    }
    rule.decls.forEach((d, i) => {
      const value = names.includes(d.name) ? d.value : d.name in SHORTHANDS ? fromShorthand(d, names, where) : undefined;
      if (value !== undefined) offer({ value, important: d.important, inline: false, spec: sel.spec, order: rule.order * 1000 + i });
    });
  }
  // The element's own inline style (as React writes it) beats any rule that is not !important.
  for (const name of [...names, ...shorthands]) {
    const raw = el.style.getPropertyValue(name);
    if (!raw) continue;
    const value = names.includes(name) ? raw : fromShorthand({ name, value: raw, important: false }, names, `the inline style of ${describe(el)}`);
    if (value !== undefined) offer({ value, important: false, inline: true, spec: [0, 0, 0], order: Number.MAX_SAFE_INTEGER });
  }
  return best?.value;
}
