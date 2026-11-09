// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q1Z0: Cloning & Gel and the Phylogenetics "phylogeny" module lay out figure first.
 *
 * Every check renders the real studio inside the viewer canvas it runs in (`.mbc-viewer-canvas`)
 * and parses the markup into an element tree. The structure checks (AC3-AC5) read that tree: which
 * column an element sits in, the order of the result column, whether a disclosure is open.
 *
 * The layout checks (AC1, AC2) run App.css against the rendered tree at a given canvas width, the
 * way a browser resolves a property: every rule whose selector matches the rendered element and
 * whose @container / @media condition holds at that width competes, and the cascade (importance,
 * specificity, source order, inline style) picks the value. Container queries are answered by the
 * ancestor that App.css makes the named container. So a two-column rule that the studio's markup
 * never matches, one that also applies below the breakpoint, or a column that "scrolls" without a
 * height to scroll in, each fails, which reading the CSS text alone would not catch. A selector or
 * condition this reader cannot evaluate fails the test by name instead of being guessed.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CloningAndGelStudio } from '../components/CloningAndGelStudio';
import { PhylogeneticsStudio, treeMethodHeading } from '../components/AlignmentAndPhyloStudio';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { phylogenySourceDocuments } from '../core/documentViews';
import { constructPhylogeneticTree } from '../core/phyloEvoEngine';
import { exportFigure } from '../core/figureCapture';
import { evaluateMultiDigestBufferPlanRust } from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

// ─── The element probe: sees each element a studio creates, with its props, as it renders ───
// It drives a studio through the handlers its own render hands its elements (an enzyme chip's
// click, the gel's ref, which measures the size the gel is drawn at), as accessibilityFloor does.

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({ onElement: null as null | ElementProbe }));
type JsxFn = (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => unknown;
const watch = vi.hoisted(() => (fn: JsxFn): JsxFn => (type, props, ...rest) => {
  probe.onElement?.(type, props ?? {});
  return fn(type, props, ...rest);
});
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-dev-runtime');
  return { ...actual, jsxDEV: watch(actual.jsxDEV) };
});
vi.mock('react/jsx-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-runtime');
  return { ...actual, jsx: watch(actual.jsx), jsxs: watch(actual.jsxs) };
});

// CSS `?raw` imports are stubbed by Vitest's CSS handling, so read the stylesheet from disk.
const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as {
  readFileSync: (p: URL, enc: string) => string;
};
const APP_CSS = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');

// ─── The rendered element tree ───

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
  parent: El | null;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, (_, e: string) => ENTITIES[e]);

/** Parses React's static markup (well-formed, quoted attributes, `/>` on void elements). */
function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const token = /<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let at = 0;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    if (m.index !== at) throw new Error(`markup not understood at ${at}: ${html.slice(at, at + 80)}`);
    at = token.lastIndex;
    if (m[1]) {
      if (cur.tag !== m[1].toLowerCase()) throw new Error(`</${m[1]}> closes <${cur.tag}>`);
      cur = cur.parent!;
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
      const el: El = { tag: m[2].toLowerCase(), attrs, children: [], parent: cur };
      cur.children.push(el);
      if (!m[4] && !VOID.has(el.tag)) cur = el;
    } else {
      cur.children.push(decode(m[5]));
    }
  }
  if (at !== html.length || cur !== root) throw new Error('markup ended inside an element');
  return root;
}

const isEl = (n: El | string | null | undefined): n is El => typeof n === 'object' && n !== null && n.tag !== '#root';
const kids = (el: El): El[] => el.children.filter(isEl);
const classesOf = (el: El): string[] => (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
const hasClass = (el: El, c: string) => classesOf(el).includes(c);
const textOf = (n: El | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''));
const words = (n: El | string) => textOf(n).replace(/\s+/g, ' ').trim();
function findAll(el: El, pred: (e: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (e: El) => {
    for (const k of kids(e)) {
      if (pred(k)) out.push(k);
      walk(k);
    }
  };
  walk(el);
  return out;
}
const find = (el: El, pred: (e: El) => boolean): El | null => findAll(el, pred)[0] ?? null;
const contains = (outer: El, inner: El): boolean => {
  for (let p: El | null = inner; p; p = p.parent) if (p === outer) return true;
  return false;
};
const describeEl = (el: El) => `<${el.tag}${el.attrs.class ? ` class="${el.attrs.class}"` : ''}>`;

/** Renders a studio inside the viewer canvas App.tsx renders it in, and returns that canvas. */
function inCanvas(studio: React.ReactElement): El {
  const html = renderToStaticMarkup(
    <div className="mbc-split-host">
      <div className="mbc-viewer-canvas ">{studio}</div>
    </div>,
  );
  const canvas = find(parseHtml(html), (e) => hasClass(e, 'mbc-viewer-canvas'));
  if (!canvas) throw new Error('the canvas host did not render');
  return canvas;
}

// ─── App.css: rules, and the cascade at a given canvas width ───

interface Decl { prop: string; value: string; important: boolean }
interface Rule { selector: string; decls: Decl[]; conds: string[]; order: number }

function parseCss(text: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  const skipComment = () => {
    const end = text.indexOf('*/', i + 2);
    if (end < 0) throw new Error('App.css: unterminated comment');
    i = end + 2;
  };
  const readChunk = (): { out: string; stop: string } => {
    let out = '';
    let depth = 0;
    while (i < text.length) {
      if (text.startsWith('/*', i)) {
        skipComment();
        continue;
      }
      const c = text[i];
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
        out += text.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth === 0 && (c === ';' || c === '{' || c === '}')) return { out, stop: c };
      out += c;
      i++;
    }
    return { out, stop: '' };
  };
  const skipBlock = () => {
    let depth = 1;
    while (i < text.length && depth > 0) {
      const { stop } = readChunk();
      if (stop === '{') depth++;
      if (stop === '}') depth--;
      i++;
    }
  };
  const block = (conds: string[], selector: string | null): void => {
    const decls: Decl[] = [];
    while (i < text.length) {
      const { out, stop } = readChunk();
      const chunk = out.trim().replace(/\s+/g, ' ');
      if (stop === '{') {
        i++;
        if (selector !== null) throw new Error(`App.css: a rule nested in "${selector}" is not read`);
        if (/^@(font-face|(-webkit-)?keyframes|property|page|counter-style)\b/.test(chunk)) skipBlock();
        else if (chunk.startsWith('@')) block([...conds, chunk], null);
        else block(conds, chunk);
        continue;
      }
      if (chunk) {
        if (selector === null) throw new Error(`App.css: a declaration outside a rule: ${chunk}`);
        const colon = chunk.indexOf(':');
        const raw = chunk.slice(colon + 1).trim();
        const important = /!\s*important$/i.test(raw);
        decls.push({ prop: chunk.slice(0, colon).trim().toLowerCase(), value: raw.replace(/!\s*important$/i, '').trim(), important });
      }
      if (stop === '}') {
        i++;
        break;
      }
      if (stop === ';') i++;
      if (stop === '') break;
    }
    if (selector !== null) rules.push({ selector, decls, conds, order: rules.length });
  };
  block([], null);
  return rules;
}

/** Splits on `sep` outside parentheses, brackets and quotes. */
function splitTop(text: string, isSep: (c: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && isSep(c)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Selectors: compounds joined by combinators, matched right to left against the element tree.
interface AttrSel { name: string; op: string; value: string }
interface Compound { tag: string | null; ids: string[]; classes: string[]; attrs: AttrSel[]; pseudos: { name: string; arg: string }[]; pseudoElement: boolean; scope?: El }
interface Complex { parts: Compound[]; combs: string[]; leading: string | null }

function parseComplex(sel: string): Complex {
  const s = sel.trim();
  const parts: Compound[] = [];
  const combs: string[] = [];
  let leading: string | null = null;
  let pending: string | null = null;
  let i = 0;
  const ident = () => {
    let out = '';
    while (i < s.length && /[\w\-\\ -￿]/.test(s[i])) {
      if (s[i] === '\\') {
        out += s[i + 1];
        i += 2;
      } else out += s[i++];
    }
    return out;
  };
  const balanced = (open: string, close: string) => {
    let depth = 0;
    const start = i;
    for (; i < s.length; i++) {
      if (s[i] === open) depth++;
      if (s[i] === close && --depth === 0) {
        i++;
        return s.slice(start + 1, i - 1);
      }
    }
    throw new Error(`unbalanced ${open} in "${sel}"`);
  };
  while (i < s.length) {
    let ws = false;
    while (i < s.length && /\s/.test(s[i])) {
      i++;
      ws = true;
    }
    if (i >= s.length) break;
    if ('>+~'.includes(s[i])) {
      pending = s[i++];
      continue;
    }
    if (ws && parts.length && pending === null) pending = ' ';
    const c: Compound = { tag: null, ids: [], classes: [], attrs: [], pseudos: [], pseudoElement: false };
    while (i < s.length && !/[\s>+~]/.test(s[i])) {
      const ch = s[i];
      if (ch === '*') i++;
      else if (ch === '.') {
        i++;
        c.classes.push(ident());
      } else if (ch === '#') {
        i++;
        c.ids.push(ident());
      } else if (ch === '[') {
        const body = balanced('[', ']').trim();
        const m = /^([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?$/.exec(body);
        if (!m) throw new Error(`attribute selector not read: [${body}] in "${sel}"`);
        c.attrs.push({ name: m[1], op: m[2] ?? '', value: m[3] ?? m[4] ?? m[5] ?? '' });
      } else if (ch === ':') {
        i++;
        if (s[i] === ':') {
          i++;
          ident();
          if (s[i] === '(') balanced('(', ')');
          c.pseudoElement = true;
          continue;
        }
        const name = ident().toLowerCase();
        const arg = s[i] === '(' ? balanced('(', ')') : '';
        if (['before', 'after', 'first-line', 'first-letter'].includes(name)) c.pseudoElement = true;
        else c.pseudos.push({ name, arg });
      } else if (/[\w-]/.test(ch)) c.tag = ident().toLowerCase();
      else throw new Error(`selector not read at "${s.slice(i)}" in "${sel}"`);
    }
    if (parts.length) combs.push(pending ?? ' ');
    else if (pending) leading = pending;
    pending = null;
    parts.push(c);
  }
  return { parts, combs, leading };
}

const selectorCache = new Map<string, Complex[]>();
const complexesOf = (selector: string): Complex[] => {
  let list = selectorCache.get(selector);
  if (!list) {
    list = splitTop(selector, (c) => c === ',').map(parseComplex);
    selectorCache.set(selector, list);
  }
  return list;
};

const prevSibling = (el: El): El | null => {
  const sibs = el.parent ? kids(el.parent) : [];
  return sibs[sibs.indexOf(el) - 1] ?? null;
};
const nthMatches = (formula: string, pos: number): boolean => {
  const f = formula.trim().toLowerCase();
  if (f === 'odd') return pos % 2 === 1;
  if (f === 'even') return pos % 2 === 0;
  const m = /^([+-]?\d*)n\s*(?:([+-])\s*(\d+))?$/.exec(f);
  if (!m) return /^[+-]?\d+$/.test(f) && Number(f) === pos;
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
  const b = m[2] ? Number(`${m[2]}${m[3]}`) : 0;
  if (a === 0) return pos === b;
  return (pos - b) / a >= 0 && (pos - b) % a === 0;
};
const FORM = new Set(['button', 'input', 'select', 'textarea', 'option', 'optgroup', 'fieldset']);
const DYNAMIC = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'target', 'popover-open', 'modal', 'fullscreen', 'user-invalid', 'autofill', '-webkit-autofill']);

function matchCompound(el: El, c: Compound): boolean {
  if (!isEl(el) || c.pseudoElement) return false;
  if (c.scope) return el === c.scope;
  if (c.tag && el.tag !== c.tag) return false;
  if (c.ids.some((id) => el.attrs.id !== id)) return false;
  const cls = classesOf(el);
  if (c.classes.some((k) => !cls.includes(k))) return false;
  for (const a of c.attrs) {
    const v = el.attrs[a.name];
    if (v === undefined) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
    if (a.op === '|=' && v !== a.value && !v.startsWith(`${a.value}-`)) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
  }
  const sibs = el.parent ? kids(el.parent) : [el];
  const pos = sibs.indexOf(el) + 1;
  const ofType = sibs.filter((k) => k.tag === el.tag);
  const posOfType = ofType.indexOf(el) + 1;
  for (const p of c.pseudos) {
    const list = () => complexesOf(p.arg);
    let ok: boolean;
    switch (p.name) {
      case 'not': ok = !list().some((cx) => matchesComplex(el, cx)); break;
      case 'is': case 'where': case 'matches': case '-webkit-any': ok = list().some((cx) => matchesComplex(el, cx)); break;
      case 'has': ok = list().some((cx) => hasRelative(el, cx)); break;
      case 'first-child': ok = pos === 1; break;
      case 'last-child': ok = pos === sibs.length; break;
      case 'only-child': ok = sibs.length === 1; break;
      case 'nth-child': ok = nthMatches(p.arg, pos); break;
      case 'nth-last-child': ok = nthMatches(p.arg, sibs.length - pos + 1); break;
      case 'first-of-type': ok = posOfType === 1; break;
      case 'last-of-type': ok = posOfType === ofType.length; break;
      case 'only-of-type': ok = ofType.length === 1; break;
      case 'nth-of-type': ok = nthMatches(p.arg, posOfType); break;
      case 'empty': ok = el.children.length === 0; break;
      case 'root': case 'scope': ok = false; break;
      case 'disabled': ok = FORM.has(el.tag) && 'disabled' in el.attrs; break;
      case 'enabled': ok = FORM.has(el.tag) && !('disabled' in el.attrs); break;
      case 'checked': ok = 'checked' in el.attrs || (el.tag === 'option' && 'selected' in el.attrs); break;
      case 'link': case 'any-link': ok = el.tag === 'a' && 'href' in el.attrs; break;
      case 'defined': ok = true; break;
      default:
        if (DYNAMIC.has(p.name)) ok = false; // a static render is never hovered, focused or pressed
        else throw new Error(`selector feature not evaluated: :${p.name} (${describeEl(el)})`);
    }
    if (!ok) return false;
  }
  return true;
}

function matchFrom(el: El, cx: Complex, k: number): boolean {
  if (!matchCompound(el, cx.parts[k])) return false;
  if (k === 0) return true;
  const comb = cx.combs[k - 1];
  if (comb === '>') return isEl(el.parent) && matchFrom(el.parent, cx, k - 1);
  if (comb === '+') {
    const prev = prevSibling(el);
    return !!prev && matchFrom(prev, cx, k - 1);
  }
  if (comb === '~') {
    for (let p = prevSibling(el); p; p = prevSibling(p)) if (matchFrom(p, cx, k - 1)) return true;
    return false;
  }
  for (let p = el.parent; isEl(p); p = p.parent) if (matchFrom(p, cx, k - 1)) return true;
  return false;
}
const matchesComplex = (el: El, cx: Complex) => (cx.leading ? false : matchFrom(el, cx, cx.parts.length - 1));

/** `:has(<relative selector>)`: the anchor stands in for `:scope` in front of the relative selector. */
function hasRelative(anchor: El, rel: Complex): boolean {
  const scoped: Complex = {
    parts: [{ tag: null, ids: [], classes: [], attrs: [], pseudos: [], pseudoElement: false, scope: anchor }, ...rel.parts],
    combs: [rel.leading ?? ' ', ...rel.combs],
    leading: null,
  };
  const pool = rel.leading === '+' || rel.leading === '~'
    ? (anchor.parent ? kids(anchor.parent) : [])
    : findAll(anchor, () => true);
  return pool.some((e) => matchFrom(e, scoped, scoped.parts.length - 1));
}

function specificityOf(cx: Complex): [number, number, number] {
  const spec: [number, number, number] = [0, 0, 0];
  const add = (s: [number, number, number]) => s.forEach((v, k) => (spec[k] += v));
  for (const c of cx.parts) {
    spec[0] += c.ids.length;
    spec[1] += c.classes.length + c.attrs.length;
    if (c.tag) spec[2] += 1;
    if (c.pseudoElement) spec[2] += 1;
    for (const p of c.pseudos) {
      if (p.name === 'where') continue;
      if (['not', 'is', 'matches', '-webkit-any', 'has'].includes(p.name)) {
        const inner = complexesOf(p.arg).map(specificityOf).sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
        if (inner.length) add(inner[inner.length - 1]);
      } else spec[1] += 1;
    }
  }
  return spec;
}

/** The scenario a value is resolved in: the viewer canvas's inline size and the window width. */
interface At { canvas: number; viewport: number }
/** The window is the canvas plus the project sidebar and gutters (measured: 1440 -> 1170). */
const at = (canvas: number): At => ({ canvas, viewport: canvas + 270 });
const px = (v: string): number => {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim());
  if (!m) throw new Error(`length not read: ${v}`);
  return Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1);
};

/** A size feature such as `(min-width: 900px)` or `(width >= 900px)`, against a width. */
function sizeFeatureHolds(feature: string, width: number): boolean {
  const f = feature.trim().replace(/^\(|\)$/g, '').trim();
  let m = /^(min|max)-(width|inline-size)\s*:\s*(.+)$/.exec(f);
  if (m) return m[1] === 'min' ? width >= px(m[3]) : width <= px(m[3]);
  m = /^(width|inline-size)\s*(>=|<=|>|<)\s*(.+)$/.exec(f);
  if (m) {
    const n = px(m[3]);
    return m[2] === '>=' ? width >= n : m[2] === '<=' ? width <= n : m[2] === '>' ? width > n : width < n;
  }
  throw new Error(`size feature not evaluated: (${f})`);
}

const MEDIA_FALSE = /^(prefers-reduced-motion\s*:\s*reduce|forced-colors\s*:\s*active|prefers-contrast\s*:\s*(more|less)|prefers-color-scheme\s*:\s*dark)$/;
function mediaHolds(query: string, viewport: number): boolean {
  return splitTop(query, (c) => c === ',').some((q) => {
    let rest = q.trim();
    let negate = false;
    if (/^not\s/.test(rest)) {
      negate = true;
      rest = rest.slice(4);
    }
    const terms = rest.replace(/^only\s+/, '').split(/\s+and\s+/);
    const holds = terms.every((t) => {
      const term = t.trim();
      if (term === 'screen' || term === 'all') return true;
      if (term === 'print') return false;
      const body = term.replace(/^\(|\)$/g, '').trim();
      if (MEDIA_FALSE.test(body)) return false;
      if (/^prefers-color-scheme\s*:\s*light$/.test(body)) return true;
      return sizeFeatureHolds(term, viewport);
    });
    return negate ? !holds : holds;
  });
}

const css = parseCss(APP_CSS);
const rulesDeclaring = new Map<string, Rule[]>();
for (const r of css) for (const d of r.decls) {
  const list = rulesDeclaring.get(d.prop) ?? [];
  if (!list.includes(r)) list.push(r);
  rulesDeclaring.set(d.prop, list);
}

type Extract = (value: string) => string;
const first: Extract = (v) => splitTop(v, (c) => /\s/.test(c))[0];
const flexPart = (k: 0 | 2): Extract => (v) => {
  const parts = splitTop(v, (c) => /\s/.test(c));
  if (v === 'none') return k === 0 ? '0' : 'auto';
  if (v === 'auto') return k === 0 ? '1' : 'auto';
  if (parts.length === 1 && /^[\d.]+$/.test(parts[0])) return k === 0 ? parts[0] : '0%';
  if (parts.length === 3) return parts[k];
  throw new Error(`flex shorthand not read: ${v}`);
};
const unread = (prop: string): Extract => (v) => {
  throw new Error(`the ${prop} shorthand is not read (${v})`);
};

/** Each property: its longhand and the shorthands (or logical/physical twins) that also set it. */
const SOURCES: Record<string, [string, Extract][]> = {
  display: [['display', (v) => v]],
  position: [['position', (v) => v]],
  top: [['top', (v) => v], ['inset', first], ['inset-block-start', (v) => v], ['inset-block', first]],
  'box-shadow': [['box-shadow', (v) => v]],
  background: [['background', (v) => v], ['background-color', (v) => v]],
  'overflow-y': [['overflow-y', (v) => v], ['overflow-block', (v) => v], ['overflow', (v) => { const p = splitTop(v, (c) => /\s/.test(c)); return p[1] ?? p[0]; }]],
  'grid-template-columns': [['grid-template-columns', (v) => v], ['grid-template', unread('grid-template')], ['grid', unread('grid')]],
  'grid-template-rows': [['grid-template-rows', (v) => v], ['grid-template', unread('grid-template')], ['grid', unread('grid')]],
  'align-items': [['align-items', (v) => v], ['place-items', first]],
  'align-self': [['align-self', (v) => v], ['place-self', first]],
  'flex-direction': [['flex-direction', (v) => v], ['flex-flow', (v) => splitTop(v, (c) => /\s/.test(c)).find((p) => /^(row|column)/.test(p)) ?? 'row']],
  'flex-grow': [['flex-grow', (v) => v], ['flex', flexPart(0)]],
  'flex-basis': [['flex-basis', (v) => v], ['flex', flexPart(2)]],
  'block-size': [['block-size', (v) => v], ['height', (v) => v]],
  'min-block-size': [['min-block-size', (v) => v], ['min-height', (v) => v]],
  'max-block-size': [['max-block-size', (v) => v], ['max-height', (v) => v]],
  'container-name': [['container-name', (v) => v], ['container', (v) => v.split('/')[0].trim()]],
  'container-type': [['container-type', (v) => v], ['container', (v) => (v.includes('/') ? v.split('/')[1].trim() : 'normal')]],
};
const BLOCK_TAGS = new Set(['div', 'section', 'header', 'footer', 'main', 'aside', 'nav', 'form', 'p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'details', 'summary', 'fieldset', 'pre']);
const INITIAL: Record<string, (el: El) => string> = {
  display: (el) => (BLOCK_TAGS.has(el.tag) ? 'block' : el.tag === 'table' ? 'table' : 'inline'),
  position: () => 'static', top: () => 'auto', 'box-shadow': () => 'none', background: () => 'transparent',
  'overflow-y': () => 'visible', 'grid-template-columns': () => 'none', 'grid-template-rows': () => 'none',
  'align-items': () => 'normal', 'align-self': () => 'auto', 'flex-direction': () => 'row', 'flex-grow': () => '0',
  'flex-basis': () => 'auto', 'block-size': () => 'auto', 'min-block-size': () => 'auto', 'max-block-size': () => 'none',
  'container-name': () => 'none', 'container-type': () => 'normal',
};

interface Resolved { value: string; rule: Rule | null }
/** Whether key `a` outranks key `b`, compared position by position. */
const outranks = (a: readonly number[], b: readonly number[]): boolean => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k];
  return false;
};
const matchCache = new Map<Rule, Map<El, [number, number, number] | null>>();
/** The specificity of the most specific selector in the rule's list that matches `el`, or null. */
function matchedSpecificity(rule: Rule, el: El): [number, number, number] | null {
  let byEl = matchCache.get(rule);
  if (!byEl) matchCache.set(rule, (byEl = new Map()));
  if (!byEl.has(el)) {
    let best: [number, number, number] | null = null;
    for (const cx of complexesOf(rule.selector)) {
      if (!matchesComplex(el, cx)) continue;
      const s = specificityOf(cx);
      if (!best || outranks(s, best)) best = s;
    }
    byEl.set(el, best);
  }
  return byEl.get(el)!;
}

/** Whether a rule's at-rule conditions hold for `el` in scenario `w`. */
function conditionsHold(rule: Rule, el: El, w: At): boolean {
  return rule.conds.every((cond) => {
    if (cond.startsWith('@media')) return mediaHolds(cond.slice(6), w.viewport);
    if (cond.startsWith('@supports')) return !/^@supports\s+not\b/.test(cond);
    const m = /^@container\s+([a-zA-Z][\w-]*)\s+(\(.*\))$/.exec(cond);
    if (!m) throw new Error(`container query not evaluated for ${describeEl(el)}: ${cond}`);
    const [, name, query] = m;
    let host: El | null = null;
    for (let p = el.parent; isEl(p) && !host; p = p.parent) {
      const names = value(p, 'container-name', w).value.split(/\s+/);
      if (names.includes(name) && /inline-size|size/.test(value(p, 'container-type', w).value)) host = p;
    }
    if (!host) return false;
    if (!hasClass(host, 'mbc-viewer-canvas')) throw new Error(`the ${name} container is ${describeEl(host)}, whose width is not known`);
    return splitTop(query, () => false)[0].split(/\s+and\s+/).every((f) => sizeFeatureHolds(f, w.canvas));
  });
}

const parseInline = (style: string): Decl[] =>
  splitTop(style, (c) => c === ';').map((d) => {
    const colon = d.indexOf(':');
    const raw = d.slice(colon + 1).trim();
    return { prop: d.slice(0, colon).trim().toLowerCase(), value: raw.replace(/!\s*important$/i, '').trim(), important: /!\s*important$/i.test(raw) };
  });

/** The value of `prop` on the rendered element `el` at scenario `w`, and the rule it came from. */
function value(el: El, prop: string, w: At): Resolved {
  const sources = SOURCES[prop];
  if (!sources) throw new Error(`property not resolved by this test: ${prop}`);
  // Cascade key: !important, inline style, specificity (a, b, c), rule order, declaration order.
  let best: { key: number[]; value: string; rule: Rule | null } | null = null;
  const consider = (key: number[], v: string, rule: Rule | null) => {
    if (!best || outranks(key, best.key)) best = { key, value: v, rule };
  };
  for (const [declProp, extract] of sources) {
    for (const rule of rulesDeclaring.get(declProp) ?? []) {
      const spec = matchedSpecificity(rule, el);
      if (!spec || !conditionsHold(rule, el, w)) continue;
      rule.decls.forEach((d, idx) => {
        if (d.prop === declProp) consider([d.important ? 1 : 0, 0, ...spec, rule.order, idx], extract(d.value), rule);
      });
    }
    parseInline(el.attrs.style ?? '').forEach((d, idx) => {
      if (d.prop === declProp) consider([d.important ? 1 : 0, 1, 0, 0, 0, Number.MAX_SAFE_INTEGER, idx], extract(d.value), null);
    });
  }
  const resolved = best as { value: string; rule: Rule | null } | null;
  if (!resolved || ['initial', 'unset', 'revert'].includes(resolved.value)) return { value: INITIAL[prop](el), rule: resolved?.rule ?? null };
  return { value: resolved.value.replace(/\s+/g, ' '), rule: resolved.rule };
}

/** The top-level tracks of a `grid-template-columns` value (line names dropped). */
const tracksOf = (v: string): string[] =>
  v === 'none' ? [] : splitTop(v, (c) => /\s/.test(c)).filter((t) => !t.startsWith('['));

/** The smallest and largest size a track can take, for the fixed-size track forms. */
function trackBounds(track: string): [number, number] {
  let m = /^minmax\(\s*([\d.]+(?:px|rem))\s*,\s*([\d.]+(?:px|rem))\s*\)$/.exec(track);
  if (m) return [px(m[1]), px(m[2])];
  m = /^clamp\(\s*([\d.]+(?:px|rem))\s*,.*,\s*([\d.]+(?:px|rem))\s*\)$/.exec(track);
  if (m) return [px(m[1]), px(m[2])];
  if (/^[\d.]+(px|rem)$/.test(track)) return [px(track), px(track)];
  throw new Error(`the first track is not a bounded length: ${track}`);
}

/**
 * Why `el`'s block size is (or is not) bound to the viewer canvas's height: each step from the
 * canvas down hands its definite height to the next. Returns the steps, or the reason it breaks.
 */
function boundToCanvas(el: El, w: At): string[] | string {
  const parent = el.parent;
  if (!isEl(parent)) return `${describeEl(el)} is not inside the canvas`;
  if (hasClass(parent, 'mbc-viewer-canvas')) {
    const size = value(el, 'block-size', w).value;
    return size === '100%' ? [`${describeEl(el)}: block-size 100% of the canvas`] : `${describeEl(el)} sits in the canvas with block-size ${size}`;
  }
  const up = boundToCanvas(parent, w);
  if (typeof up === 'string') return up;
  const display = value(parent, 'display', w).value;
  const minSize = value(el, 'min-block-size', w).value;
  if (display === 'grid') {
    const rows = value(parent, 'grid-template-rows', w).value;
    let align = value(el, 'align-self', w).value;
    if (align === 'auto') align = value(parent, 'align-items', w).value;
    if (rows !== 'minmax(0, 1fr)') return `${describeEl(parent)} has grid rows "${rows}", not one minmax(0, 1fr) row`;
    if (align !== 'stretch') return `${describeEl(el)} is aligned "${align}" in its grid row, not stretched`;
    if (!/^0(px)?$/.test(minSize)) return `${describeEl(el)} has min-block-size ${minSize}, so its content can outgrow the row`;
    return [...up, `${describeEl(el)}: stretched in the minmax(0, 1fr) row`];
  }
  if (/flex$/.test(display) && /^column/.test(value(parent, 'flex-direction', w).value)) {
    const grow = Number(value(el, 'flex-grow', w).value);
    const basis = value(el, 'flex-basis', w).value;
    if (!(grow > 0) || !/^0(px|%)?$/.test(basis) || !/^0(px)?$/.test(minSize)) {
      return `${describeEl(el)} does not flex into its column's height (grow ${grow}, basis ${basis}, min ${minSize})`;
    }
    return [...up, `${describeEl(el)}: flexes into what its column leaves`];
  }
  return `${describeEl(parent)} (display ${display}) does not hand its height to ${describeEl(el)}`;
}

// ─── Fixtures ───

const noop = () => {};
const byId = (id: string) => {
  const d = SAMPLE_LIBRARY.find((doc) => doc.id === id);
  if (!d) throw new Error(`sample ${id} is missing`);
  return d;
};
const plasmid = byId('doc-pet28-egfp');
const coxii = byId('doc-aln-coxii-cds');
/** Eight rows of the COXII CDS alignment, as the App hands them to the studio. */
const treeInputs = phylogenySourceDocuments(coxii, [], SAMPLE_LIBRARY).slice(0, 8);

const doc = (id: string, sequence: string, moleculeType: 'DNA' | 'Protein' = 'DNA'): SequenceDocument => ({
  id, name: id, accession: '', description: '', moleculeType, topology: 'linear', sequence,
  features: [], primers: [], history: [], createdAt: '', updatedAt: '', folder: 'Alignments',
});

const cloning = (initialSubTool?: 'mutagenesis') =>
  inCanvas(<CloningAndGelStudio documents={SAMPLE_LIBRARY} activeDoc={plasmid} onAddConstruct={noop} {...(initialSubTool ? { initialSubTool } : {})} />);
const phylo = (documents: SequenceDocument[], tab: 'phylogeny' | 'usertree' = 'phylogeny') =>
  inCanvas(<PhylogeneticsStudio documents={documents} activeDoc={documents[0]} initialPhyloTab={tab} initialTreeAlgorithm="Maximum Likelihood (ML)" />);

/** A box the gel's SVG is drawn in on screen, in CSS pixels, as the browser measures it. */
interface Box { width: number; height: number }

/**
 * The cloning studio driven through its own handlers while it renders: each enzyme chip named in
 * `untick` is clicked once, and the gel's ref is handed `gelElement`, or an SVG element measured
 * at `gelBox`.
 */
function drivenCloning(opts: { untick?: string[]; gelBox?: Box; gelElement?: object; activeDoc?: SequenceDocument }) {
  const clicked: string[] = [];
  let measured = false;
  probe.onElement = (type, props) => {
    const cls = typeof props.className === 'string' ? props.className.split(/\s+/) : [];
    const label = props.children;
    if (type === 'button' && cls.includes('enz-chip') && typeof label === 'string' && opts.untick?.includes(label) && !clicked.includes(label)) {
      clicked.push(label);
      (props.onClick as () => void)();
    }
    if (type === 'svg' && cls.includes('virtual-gel-svg') && (opts.gelBox || opts.gelElement) && !measured) {
      measured = true;
      const ref = props.ref;
      if (typeof ref !== 'function') throw new Error(`the gel's ref is ${typeof ref}, not a callback that measures the drawn gel`);
      const { width, height } = opts.gelBox ?? { width: 0, height: 0 };
      ref(opts.gelElement ?? { getBoundingClientRect: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }) });
    }
  };
  try {
    const canvas = inCanvas(<CloningAndGelStudio documents={SAMPLE_LIBRARY} activeDoc={opts.activeDoc ?? plasmid} onAddConstruct={noop} />);
    return { canvas, clicked, measured };
  } finally {
    probe.onElement = null;
  }
}

/** The studio grid that holds `inner` (the closest `.studio-split-grid` around it). */
function gridAround(inner: El | null): El | null {
  for (let p = inner?.parent ?? null; isEl(p); p = p.parent) if (hasClass(p, 'studio-split-grid')) return p;
  return null;
}
const cloningRoot = (canvas: El) => gridAround(find(canvas, (e) => hasClass(e, 'virtual-gel-svg')));
const treeRoot = (canvas: El) => gridAround(find(canvas, (e) => e.tag === 'svg' && e.attrs.role === 'img') ?? find(canvas, (e) => e.tag === 'select' && words(e).includes('Neighbor-Joining (NJ)')));

/** The two columns of a figure-first grid, or why it does not have them. */
function columnsOf(root: El | null): { controls: El; result: El } | string {
  if (!root) return 'the studio grid was not found';
  const [controls, result, ...extra] = kids(root);
  if (!controls || !result || extra.length) return `${describeEl(root)} has ${kids(root).length} children, not a controls and a result column`;
  if (!hasClass(controls, 'studio-controls-column')) return `its first child is ${describeEl(controls)}, not the controls column`;
  if (!hasClass(result, 'studio-result-column')) return `its second child is ${describeEl(result)}, not the result column`;
  return { controls, result };
}
function mustColumns(root: El | null) {
  const cols = columnsOf(root);
  if (typeof cols === 'string') expect.fail(cols);
  return cols;
}

const WIDE = at(1170); // the canvas at 1440x900 with the project sidebar open
const LAPTOP = at(1010); // 1280x800
/**
 * The same two windows with the inspector open at its default 288px and its 5px resizer, then also
 * with US-01M6Q1BD's planned 56px studio rail: the canvas narrows and the window does not, so the
 * @media rules still see the whole window (D0063 ruling a).
 */
const INSPECTOR_PX = 288 + 5;
const RAIL_PX = 56;
const beside = (w: At, rail: boolean): At => ({ canvas: w.canvas - INSPECTOR_PX - (rail ? RAIL_PX : 0), viewport: w.viewport });
const LAPTOP_INSPECTOR = beside(LAPTOP, false); // 717
const LAPTOP_INSPECTOR_RAIL = beside(LAPTOP, true); // 661
const WIDE_INSPECTOR = beside(WIDE, false); // 877
const WIDE_INSPECTOR_RAIL = beside(WIDE, true); // 821
const INSPECTOR_OPEN = [LAPTOP_INSPECTOR_RAIL, LAPTOP_INSPECTOR, WIDE_INSPECTOR_RAIL, WIDE_INSPECTOR];
const NARROW = at(600); // below the figure-first breakpoint: an 870px window with the sidebar open

// ─── AC1 ───

describe('figure-first layout: columns (US-01M6Q1Z0 AC1)', () => {
  it('lays out figure-first studios in two columns on a wide canvas', () => {
    // Wrong implementations this fails: a two-column rule on every `.studio-split-grid` (the other
    // modules change too); one outside the canvas container query (it also applies narrow); a
    // breakpoint other than 660px (D0072, inside D0063 ruling a's 640-660px: above 661px the gel
    // drops under its controls at 1280x800 once the inspector and the planned rail are open, and
    // below 660px the gel beside them draws its lane labels over each other); a controls track
    // that is not 300-340px; a second band of two columns below the breakpoint; the modifier left
    // off the studio markup (the rule never matches what renders).
    expect(INSPECTOR_OPEN.map((w) => w.canvas), 'the canvases beside the open inspector').toEqual([661, 717, 821, 877]);
    const studios = { 'Cloning & Gel': cloningRoot(cloning()), 'Phylogenetics › phylogeny': treeRoot(phylo(treeInputs)) };
    for (const [name, root] of Object.entries(studios)) {
      if (!root) expect.fail(`${name}: the studio grid was not found`);
      const columnsAt = (canvas: number) => tracksOf(value(root, 'grid-template-columns', at(canvas)).value).length;
      const twoColumnWidths: number[] = [];
      for (let canvas = 320; canvas <= 1600; canvas++) if (columnsAt(canvas) === 2) twoColumnWidths.push(canvas);
      expect(twoColumnWidths.length, `${name}: some canvas width between 320 and 1600px gives two columns`).toBeGreaterThan(0);
      const breakpoint = twoColumnWidths[0];
      // Two columns from the breakpoint up, one below it: a container minimum, not a band.
      expect(twoColumnWidths.length, `${name}: two columns at every width from ${breakpoint}px`).toBe(1600 - breakpoint + 1);
      expect(breakpoint, `${name}: the breakpoint (D0072)`).toBe(660);
      for (const canvas of [659, breakpoint - 1, NARROW.canvas]) {
        expect(value(root, 'grid-template-columns', at(canvas)).value, `${name}: one column at ${canvas}px`).toBe('minmax(0, 1fr)');
      }

      for (const w of [WIDE, LAPTOP, ...INSPECTOR_OPEN]) {
        const wide = value(root, 'grid-template-columns', w);
        expect(value(root, 'display', w).value, `${name} at ${w.canvas}px: the studio root is a grid`).toBe('grid');
        expect(wide.rule?.conds.some((c) => /^@container viewer-canvas\s/.test(c)), `${name} at ${w.canvas}px: the two columns come from the viewer-canvas container query (${wide.rule?.conds.join(' ')})`).toBe(true);
        expect(tracksOf(wide.value), `${name} at ${w.canvas}px: two columns (${wide.value})`).toHaveLength(2);
        const [controlsTrack, resultTrack] = tracksOf(wide.value);
        const [lo, hi] = trackBounds(controlsTrack);
        expect(lo, `${name} at ${w.canvas}px: the controls track's minimum (${controlsTrack})`).toBeGreaterThanOrEqual(300);
        expect(hi, `${name} at ${w.canvas}px: the controls track's maximum (${controlsTrack})`).toBeLessThanOrEqual(340);
        expect(resultTrack, `${name} at ${w.canvas}px: the result track`).toBe('minmax(0, 1fr)');
      }
    }

    // The other studio grids keep one column at every width (here, the user-tree module).
    const otherGrid = find(phylo(treeInputs, 'usertree'), (e) => hasClass(e, 'studio-split-grid'));
    if (!otherGrid) expect.fail('the user-tree module grid was not found');
    expect(hasClass(otherGrid, 'is-figure-first')).toBe(false);
    for (const w of [NARROW, WIDE, at(1600)]) {
      expect(value(otherGrid, 'grid-template-columns', w).value, `user tree at ${w.canvas}px`).toBe('minmax(0, 1fr)');
    }
  });
});

// ─── AC2 ───

describe('figure-first layout: the figure stays, the controls scroll (US-01M6Q1Z0 AC2)', () => {
  it('keeps the figure in view and scrolls the controls on their own', () => {
    // Wrong implementations this fails: controls with overflow but no height to scroll in (the
    // column grows with its content, so the canvas scrolls everything); a height bound to the
    // window rather than the canvas; the phylogeny wrapper left at its content height; a sticky
    // rule whose selector misses the rendered figure (a wrapper between it and the column); a
    // sticky figure with a shadow or no background; any of it applying below the breakpoint.
    const studios = { 'Cloning & Gel': cloningRoot(cloning()), 'Phylogenetics › phylogeny': treeRoot(phylo(treeInputs)) };
    for (const [name, root] of Object.entries(studios)) {
      const { controls, result } = mustColumns(root);
      const figure = kids(result)[0];
      expect(figure && 'data-mbc-figure' in figure.attrs, `${name}: the result column starts with the figure`).toBe(true);

      for (const w of [WIDE, LAPTOP, ...INSPECTOR_OPEN]) {
        expect(value(controls, 'overflow-y', w).value, `${name} at ${w.canvas}px: the controls scroll`).toBe('auto');
        const bound = boundToCanvas(controls, w);
        if (typeof bound === 'string') expect.fail(`${name} at ${w.canvas}px: the controls column's height is not bound to the canvas: ${bound}`);
        expect(value(figure, 'position', w).value, `${name} at ${w.canvas}px: the figure is sticky`).toBe('sticky');
        expect(value(figure, 'top', w).value, `${name} at ${w.canvas}px: the figure sticks at the top`).toMatch(/^0(px)?$/);
        expect(value(figure, 'box-shadow', w).value, `${name} at ${w.canvas}px: the sticky figure carries no shadow`).toBe('none');
        // Content scrolling under the figure must not show through it.
        expect(value(figure, 'background', w).value, `${name} at ${w.canvas}px: the figure has a surface`).not.toMatch(/^(transparent|none)$/);
      }

      // Narrow canvas: the columns stack, the canvas scrolls, and the figure is not sticky.
      expect(value(controls, 'overflow-y', NARROW).value, `${name}: narrow controls do not scroll on their own`).toBe('visible');
      expect(value(figure, 'position', NARROW).value, `${name}: the narrow figure is not sticky`).toBe('static');
    }
  });
});

// ─── AC3 ───

/**
 * The gel drawn in each box keeps every label 11px or more on screen, keeps its full-size labels
 * where those already reach 11px, and keeps neighbouring ladder and band labels a label apart.
 * `undefined` is a gel the layout never measured.
 */
function expectGelLabelsReadable(boxes: [string, Box | undefined][]): void {
  const FLOOR_PX = 11; // the text floor US-01M6Q193 set
  const FULL_SIZE_UNITS = 10.5; // the gel's label size before this layout shrank it
  // Five digest fragments of 0.9-1.1 kb, whose bands sit close, so their size labels are pushed
  // apart at the label gap (the sample plasmid's two fragments are far apart).
  const filler = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n);
  const closeBands = doc('Close bands', [filler(900), 'GGATCC', filler(950), 'GGATCC', filler(1000), 'CTCGAG', filler(1050), 'GGATCC', filler(1100)].join(''));
  for (const [where, box] of boxes) {
    for (const activeDoc of [plasmid, closeBands]) {
      const label = `${where}, ${activeDoc.name}`;
      const { canvas, measured } = drivenCloning({ gelBox: box, activeDoc });
      expect(measured, `${label}: the gel was measured`).toBe(box !== undefined);
      const gel = find(canvas, (e) => e.tag === 'svg' && hasClass(e, 'virtual-gel-svg'));
      if (!gel) expect.fail(`${label}: no gel`);
      const [, , viewW, viewH] = gel.attrs.viewBox.split(/\s+/).map(Number);
      const scale = box ? Math.min(box.width / viewW, box.height / viewH) : 1;
      const texts = findAll(gel, (e) => e.tag === 'text');
      expect(texts.length, `${label}: the gel draws its lane, ladder and band labels`).toBeGreaterThan(8);
      for (const t of texts) {
        const units = Number(t.attrs['font-size']);
        expect(units * scale, `${label}: "${words(t)}" on screen (${units} units x ${scale.toFixed(3)})`).toBeGreaterThanOrEqual(FLOOR_PX - 1e-9);
        if (FULL_SIZE_UNITS * scale >= FLOOR_PX) expect(units, `${label}: "${words(t)}" keeps its full-size units`).toBe(FULL_SIZE_UNITS);
      }
      // The ladder sizes (x=46) and the band sizes (x=363) each stand in a column: neighbours
      // stay at least a label's height apart, however large the labels are drawn.
      for (const x of ['46', '363']) {
        const column = texts.filter((t) => t.attrs.x === x).map((t) => ({ y: Number(t.attrs.y), units: Number(t.attrs['font-size']), text: words(t) })).sort((a, b) => a.y - b.y);
        expect(column.length, `${label}: labels at x=${x}`).toBeGreaterThan(1);
        for (let k = 1; k < column.length; k++) {
          expect(column[k].y - column[k - 1].y, `${label}: "${column[k - 1].text}" to "${column[k].text}"`).toBeGreaterThanOrEqual(column[k].units);
        }
      }
    }
  }
}

describe('Cloning & Gel puts the gel first (US-01M6Q1Z0 AC3)', () => {
  it('puts the gel first in the cloning result column', () => {
    // Wrong implementations this fails: the gel left under the tools (or after its table); the gel
    // shown only while the gel tab is open; the tool tabs or the gel controls in the result
    // column; the buffer plan left open or outside a disclosure.
    for (const tool of [undefined, 'mutagenesis'] as const) {
      const canvas = cloning(tool);
      const root = kids(canvas)[0];
      const label = tool ?? 'gel tab';
      expect(root && classesOf(root), `${label}: the studio root`).toEqual(expect.arrayContaining(['studio-split-grid', 'is-figure-first']));
      const { controls, result } = mustColumns(root);

      const tablist = (aria: string) => find(canvas, (e) => e.attrs.role === 'tablist' && e.attrs['aria-label'] === aria);
      for (const [what, el] of [
        ['the cloning-method tablist', tablist('Cloning Methods')],
        ['the gel and tool tab strip', tablist('Gel and Enzyme Utilities')],
        ['the Simulate button', find(canvas, (e) => e.tag === 'button' && /^Simulate .+ Reaction$/.test(words(e)))],
      ] as const) {
        expect(el && contains(controls, el), `${label}: ${what} is in the controls column`).toBe(true);
      }
      if (!tool) {
        const ladder = find(canvas, (e) => e.tag === 'label' && words(e).startsWith('MW Ladder:'));
        const chips = find(canvas, (e) => hasClass(e, 'enzyme-picker-strip'));
        expect(ladder && contains(controls, ladder), 'the ladder, agarose, buffer and stain controls are in the controls column').toBe(true);
        expect(chips && contains(controls, chips), 'the digest enzymes are in the controls column').toBe(true);
      } else {
        const sdm = find(canvas, (e) => e.tag === 'label' && words(e).startsWith('Mutagenesis Type:'));
        expect(sdm && contains(controls, sdm), 'the open tool (mutagenesis) shows in the controls column').toBe(true);
      }

      const [figure, table, ...rest] = kids(result);
      const disclosure = rest[rest.length - 1];
      expect(figure && 'data-mbc-figure' in figure.attrs, `${label}: the result column's first element is the figure`).toBe(true);
      expect(find(figure, (e) => e.tag === 'svg' && hasClass(e, 'virtual-gel-svg')), `${label}: the figure holds the gel`).not.toBeNull();
      expect(find(figure, (e) => hasClass(e, 'mbc-figure-export')), `${label}: the figure holds its export button`).not.toBeNull();
      expect(findAll(canvas, (e) => hasClass(e, 'virtual-gel-svg')), `${label}: one gel`).toHaveLength(1);
      expect(table && find(table, (e) => e.attrs.role === 'region' && e.attrs['aria-label'] === 'Restriction Digest Fragments'), `${label}: the digest fragment table follows the figure`).toBeTruthy();
      expect(rest, `${label}: only the buffer plan follows the table`).toHaveLength(1);
      expect(disclosure?.tag, `${label}: the result column ends with a disclosure`).toBe('details');
      expect('open' in (disclosure?.attrs ?? {}), `${label}: the disclosure starts closed`).toBe(false);
      expect(words(disclosure!), `${label}: it holds the co-digest buffer plan`).toMatch(/Co-Digest Buffer Plan: .+°C • \d+% min activity/);
      expect(contains(controls, find(canvas, (e) => e.tag === 'details')!), `${label}: no disclosure in the controls`).toBe(false);
    }
  });

  it('puts the gel first in the cloning result column with its labels 11px or more on screen', () => {
    // Wrong implementations this fails: labels left at their full-size 10.5 gel units, which the
    // gel shrunk beside the controls draws near 8px; a scale taken from the larger of the two fits
    // (the view is fitted to the smaller); labels enlarged but the gaps between them not, so
    // neighbouring ladder or band labels overlap; labels enlarged on a gel drawn at full size.
    // Boxes measured in the app (shots-1Z0/after2): beside the controls at 1280x800, 1440x900 and
    // 1280x720 (held at its minimum), then under them at 870x768, a 600px canvas below the
    // breakpoint (re-measured for US-01M6TA1H, which moved the breakpoint below 1024x768's canvas;
    // the three boxes beside the controls measured the same again); then one smaller than the
    // layout draws it (0.56 of its view; the 75% cap alone drew it at 0.59 at 1280x720). Unmeasured, 1.
    expectGelLabelsReadable([
      ['unmeasured', undefined],
      ['1280x800', { width: 560, height: 266.5 }],
      ['1440x900', { width: 560, height: 341.5 }],
      ['1280x720', { width: 560, height: 252 }],
      ['870x768 (stacked)', { width: 560, height: 455.8 }],
      ['smaller than the layout draws it', { width: 430, height: 195 }],
    ]);
    // Beside the controls the gel keeps a minimum height, below which its enlarged labels would
    // crowd its lanes (measured in the app: 0.72 of its view at 1280x720 and 1366x768, where they
    // stand apart); stacked under the controls it draws at its natural size.
    const gelFigure = kids(mustColumns(cloningRoot(cloning())).result)[0];
    for (const w of [WIDE, LAPTOP]) {
      expect(value(gelFigure, 'min-block-size', w).value, `at ${w.canvas}px the gel figure keeps a minimum height`).toMatch(/^[1-9]\d*(\.\d+)?px$/);
    }
    expect(value(gelFigure, 'min-block-size', NARROW).value, 'stacked, the gel figure has no minimum').toBe('auto');
  });

  it('puts the gel first in the cloning result column with its labels 11px or more beside an open inspector', () => {
    // Wrong implementations this fails: a breakpoint above the canvas the open inspector leaves,
    // so the gel drops under its controls (D0063 ruling a); the figure-first rules split across
    // two container queries, so beside the inspector the columns hold but the gel is not sticky or
    // loses its minimum height; labels sized for the 560px gel drawn without the inspector, which
    // this narrower gel draws under 11px; a box recorded from a guess, which the layout below
    // (canvas, controls track, gap and figure frame) does not give the gel.
    //
    // Boxes measured in the built app (US-01M6TA1H: vite preview in Chromium, pUC19 after Simulate,
    // the project sidebar open): the gel's SVG box beside the inspector at 288px, without and with
    // the planned 56px studio rail. The Cloning tab claims no inspector yet, so the inspector's
    // 5px + 288px tracks were set on its body split, which leaves the canvas the real inspector
    // leaves on the Sequence tab (717px at 1280x800, 877px at 1440x900); the rail took 56px more.
    // Beside the inspector at 1280x800 the gel's header wraps onto a second line and the height
    // left binds: the gel is drawn at 0.69 of its view, down from 0.76 beside the controls alone.
    // With the rail too, its width binds at 0.66.
    const boxes: [At, string, Box][] = [
      [LAPTOP_INSPECTOR, '1280x800 beside the inspector', { width: 341, height: 241.11 }],
      [LAPTOP_INSPECTOR_RAIL, '1280x800 beside the inspector and the rail', { width: 285, height: 231.97 }],
      [WIDE_INSPECTOR, '1440x900 beside the inspector', { width: 501, height: 341.5 }],
      [WIDE_INSPECTOR_RAIL, '1440x900 beside the inspector and the rail', { width: 445, height: 341.5 }],
    ];
    const root = cloningRoot(cloning());
    const { result } = mustColumns(root);
    const gelFigure = kids(result)[0];
    expect(gelFigure && find(gelFigure, (e) => e.tag === 'svg' && hasClass(e, 'virtual-gel-svg')), "the result column's first element is the gel's figure").toBeTruthy();
    for (const [w, where, box] of boxes) {
      const columns = value(root!, 'grid-template-columns', w).value;
      expect(tracksOf(columns), `${where} (${w.canvas}px canvas): the gel beside its controls (${columns})`).toHaveLength(2);
      expect(value(gelFigure, 'position', w).value, `${where}: the gel stays in view`).toBe('sticky');
      expect(value(gelFigure, 'min-block-size', w).value, `${where}: the gel figure keeps its minimum height`).toMatch(/^[1-9]\d*(\.\d+)?px$/);
      // The width the layout gives the gel's SVG: the canvas (its inline size, inside its padding),
      // less the controls track at its maximum, the 14px column gap, and the figure's 10px padding
      // and 1px border each side, up to the gel's own 560px cap.
      const [, controlsMax] = trackBounds(tracksOf(columns)[0]);
      const laidOut = Math.min(560, w.canvas - controlsMax - 14 - 22);
      expect(Math.abs(box.width - laidOut), `${where}: the measured ${box.width}px is the ${laidOut}px the layout gives`).toBeLessThanOrEqual(1);
    }
    // Narrower than the 560px gel drawn without the inspector: the labels are enlarged here.
    expect(Math.min(...boxes.map(([, , b]) => Math.min(b.width / 430, b.height / 350))) * 10.5, 'full-size labels would fall under 11px on these boxes').toBeLessThan(11);
    expectGelLabelsReadable(boxes.map(([, where, box]): [string, Box] => [where, box]));
  });
});

// ─── AC4 ───

describe('Phylogenetics puts the tree first (US-01M6Q1Z0 AC4)', () => {
  it('puts the tree first in the phylogeny result column', () => {
    // Wrong implementations this fails: the tree card left after the method card; the metrics
    // before the tree; the method note or the Newick string left open; the selectors in the result
    // column; two headings naming the figure, or the method heading dropped.
    expect(treeInputs.length).toBeGreaterThanOrEqual(4);
    const canvas = phylo(treeInputs);
    const root = treeRoot(canvas);
    expect(root && classesOf(root), 'the phylogeny module root').toEqual(expect.arrayContaining(['studio-split-grid', 'is-figure-first']));
    const { controls, result } = mustColumns(root);

    for (const field of ['Tree Inference Method:', 'Distance Model:', 'Bootstrap Replicates:']) {
      const label = find(canvas, (e) => e.tag === 'label' && words(e).startsWith(field));
      expect(label && find(label, (e) => e.tag === 'select') && contains(controls, label), `the "${field}" selector is in the controls column`).toBeTruthy();
    }

    const [figure, kpis, disclosure, ...extra] = kids(result);
    expect(figure && 'data-mbc-figure' in figure.attrs, "the result column's first element is the figure").toBe(true);
    expect(find(figure, (e) => e.tag === 'svg' && e.attrs.role === 'img'), 'the figure holds the tree').not.toBeNull();
    expect(find(figure, (e) => hasClass(e, 'mbc-figure-export')), 'the figure holds its export button').not.toBeNull();
    expect(kpis && hasClass(kpis, 'thermo-kpi-grid'), 'the metrics follow the figure').toBe(true);
    expect(findAll(kpis, (e) => hasClass(e, 'kpi-label')).map(words)).toEqual([
      'lnL (JC69, this tree)', 'Sum of Branch Lengths (S)', 'Parsimony Steps', 'CI / RI Indices',
    ]);
    expect(extra, 'nothing follows the disclosure').toHaveLength(0);
    expect(disclosure?.tag, 'a disclosure follows the metrics').toBe('details');
    expect('open' in (disclosure?.attrs ?? {}), 'the disclosure starts closed').toBe(false);
    const note = find(disclosure!, (e) => hasClass(e, 'info-callout'));
    expect(note && words(note), 'the method note is behind the disclosure').toMatch(/^Maximum Likelihood \(ML\) is not run here: the topology is Neighbor-Joining/);
    const newick = find(disclosure!, (e) => hasClass(e, 'newick-box'));
    expect(newick && words(find(newick, (e) => e.tag === 'code')!), 'the Newick string is behind the disclosure').toMatch(/^\(.+\);$/);

    // One heading names the figure, and the method that ran still heads the controls (US-01M6Q1G1).
    const figureHeadings = findAll(figure, (e) => /^h[1-6]$/.test(e.tag)).map(words);
    expect(figureHeadings).toEqual(['Tree (phylogram)']);
    const controlHeading = find(controls, (e) => e.tag === 'h3');
    expect(controlHeading && words(controlHeading)).toBe(treeMethodHeading(words(note!)));
    // It names a method for this fixture: not empty, and not the generic fallback heading.
    expect(words(controlHeading!), 'the controls heading names the method that ran').not.toMatch(/^(|Phylogenetic tree)$/);
  });
});

// ─── AC5 ───

describe('Warnings stay in view (US-01M6Q1Z0 AC5)', () => {
  it('keeps warnings outside the method disclosure', () => {
    // Wrong implementation this fails: moving the whole method callout, warnings and the
    // "No tree was built" line with it, behind the disclosure.
    //
    // Two gapped rows that share no site: the engine builds no tree and warns that the distance is
    // undefined. The warning is read from the engine, so the fixture is shown to reach it.
    const noSharedSites = [doc('Taxon A', 'ACGTACGTACGTAC--------------'), doc('Taxon B', '--------------ACGTACGTACGTAC')];
    const engine = constructPhylogeneticTree(noSharedSites.map((d) => d.name), noSharedSites.map((d) => d.sequence), 'Maximum Likelihood (ML)', 'Tamura-Nei (TN93)', 500);
    expect(engine.warnings.length, 'the engine warns on this input').toBeGreaterThan(0);
    // A nucleotide and a protein sequence cannot be aligned, so no tree is built at all.
    const unalignable = [doc('Nucleotide', 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCC'), doc('Protein', 'MASKGEELFTGVVPILVELDGDVNGHKF', 'Protein')];

    const cases: [string, SequenceDocument[], string[]][] = [
      ['undefined distance', noSharedSites, engine.warnings],
      ['alignment failed', unalignable, ['No tree was built: the input sequences could not be aligned (see the message above).']],
    ];
    for (const [name, docs, messages] of cases) {
      const canvas = phylo(docs);
      const root = treeRoot(canvas);
      const { result } = mustColumns(root);
      const disclosure = kids(result).find((e) => e.tag === 'details');
      if (!disclosure) expect.fail(`${name}: the result column has no method disclosure`);
      expect('open' in disclosure.attrs, `${name}: the method disclosure starts closed`).toBe(false);
      for (const message of messages) {
        const holder = findAll(result, (e) => words(e) === message)[0];
        expect(holder, `${name}: "${message}" is shown in the result column`).toBeTruthy();
        expect(contains(disclosure, holder), `${name}: "${message}" is outside the disclosure`).toBe(false);
        expect(words(disclosure), `${name}: and not repeated inside it`).not.toContain(message);
        // Beside the figure or the metrics: in the result column, ahead of the disclosure.
        const block = kids(result).find((k) => contains(k, holder))!;
        expect(kids(result).indexOf(block), `${name}: "${message}" comes before the disclosure`).toBeLessThan(kids(result).indexOf(disclosure));
      }
      // The figure slot says there is no tree.
      expect(words(kids(result)[0]), `${name}: the figure slot`).toMatch(/^No tree to display/);
    }
  });

  it('keeps warnings outside the method disclosure: the co-digest caution beside the gel and on its summary', () => {
    // Wrong implementations this fails: the star-activity caution left only inside the closed
    // co-digest plan; a summary flag shown for every digest, or for none; the caution placed after
    // the fragment table, below the result column's fold at 1280x800, rather than in the sticky
    // figure; a caution not drawn as the studio's warning note.
    //
    // The engine flags BamHI (not HF) for star activity and not XhoI: the default digest raises
    // the caution, and the same digest with BamHI unticked does not.
    const flagged = (enzymes: string[]) => evaluateMultiDigestBufferPlanRust(enzymes).enzymes.filter((r) => r.starActivityRisk).map((r) => r.enzymeName);
    expect(flagged(['BamHI', 'XhoI'])).toEqual(['BamHI']);
    expect(flagged(['XhoI'])).toEqual([]);

    const cases = [
      { name: 'BamHI + XhoI (the default)', untick: [], lane: 'BamHI+XhoI', summary: 'Co-digest buffer plan: watch star activity', flags: ['watch star activity'], cautions: ['Watch star activity (BamHI)'] },
      { name: 'XhoI (BamHI unticked)', untick: ['BamHI'], lane: 'XhoI', summary: 'Co-digest buffer plan', flags: [], cautions: [] },
    ];
    for (const c of cases) {
      const { canvas, clicked } = drivenCloning({ untick: c.untick });
      expect(clicked, `${c.name}: the chips clicked`).toEqual(c.untick);
      const { controls, result } = mustColumns(cloningRoot(canvas));
      const [figure, , disclosure] = kids(result);
      // The digest lane is labelled with the enzymes the gel was drawn with: the click took effect.
      const gel = find(figure, (e) => hasClass(e, 'virtual-gel-svg'));
      expect(gel && findAll(gel, (e) => e.tag === 'text').map(words), `${c.name}: the digest lane`).toContain(c.lane);

      expect(disclosure?.tag, `${c.name}: the plan's disclosure`).toBe('details');
      expect('open' in disclosure.attrs, `${c.name}: the plan starts closed`).toBe(false);
      const summary = kids(disclosure).find((k) => k.tag === 'summary');
      if (!summary) expect.fail(`${c.name}: the plan has no summary line`);
      expect(words(summary), `${c.name}: the plan's summary line`).toBe(c.summary);
      const summaryFlags = findAll(summary, (e) => hasClass(e, 'cloning-warning-note'));
      expect(summaryFlags.map(words), `${c.name}: the summary's warning flag`).toEqual(c.flags);

      // Beside the gel: in the figure's header with its title and export button, outside the plan.
      const cautions = findAll(result, (e) => hasClass(e, 'cloning-warning-note') && !contains(disclosure, e));
      expect(cautions.map(words), `${c.name}: the caution outside the closed plan`).toEqual(c.cautions);
      // The studio's own warning note, as its cloning warnings are drawn, with nothing overriding its surface.
      const studioNote: El = { tag: 'div', attrs: { class: 'cloning-warning-note' }, children: [], parent: controls };
      for (const note of [...summaryFlags, ...cautions]) {
        for (const w of [WIDE, LAPTOP, NARROW]) {
          expect(value(note, 'background', w).value, `${c.name}: "${words(note)}" is drawn as the warning note`).toBe(value(studioNote, 'background', w).value);
        }
      }
      for (const note of cautions) {
        expect(contains(figure, note), `${c.name}: the caution is in the gel figure`).toBe(true);
        const header = note.parent!;
        expect(kids(header).some((k) => k.tag === 'h4' && words(k) === 'Virtual Agarose Gel'), `${c.name}: beside the gel's title`).toBe(true);
        expect(find(header, (e) => hasClass(e, 'mbc-figure-export')), `${c.name}: and its export button`).toBeTruthy();
        // That figure stays at the top of the result column, so the caution is never scrolled away.
        for (const w of [WIDE, LAPTOP]) expect(value(figure, 'position', w).value, `${c.name} at ${w.canvas}px: the figure is sticky`).toBe('sticky');
      }
    }
  });
});

// ─── BG-01M6RJZB: an exported gel is the same from every window ───

/** A stand-in for the font the page sets, which the gel inherits and an exported file has to carry. */
const PAGE_FONT = 'Google Sans, system-ui, sans-serif';
const INHERITED = new Set(['font-family', 'font-size', 'font-weight', 'fill', 'text-anchor']);

/**
 * Just enough of a rendered element for the figure export to measure, clone, style and serialize,
 * since the suite runs in node with no DOM library. The gel's ref is handed one of these, empty,
 * measured at a window's box; once the studio has rendered it is filled with the gel that window
 * shows, so an export that clones the live drawing writes exactly what is on screen there.
 */
class ExportNode {
  parentElement: ExportNode | null = null;
  readonly nodes: (ExportNode | string)[] = [];
  constructor(
    readonly tagName: string,
    readonly attrs: [string, string][] = [],
    private readonly box: Box = { width: 0, height: 0 },
  ) {}
  get children(): ExportNode[] {
    return this.nodes.filter((n): n is ExportNode => typeof n !== 'string');
  }
  append(...nodes: (ExportNode | string)[]): void {
    for (const n of nodes) {
      if (typeof n !== 'string') n.parentElement = this;
      this.nodes.push(n);
    }
  }
  /** Take on the attributes and content of a rendered element. */
  fill(el: El): this {
    this.attrs.push(...Object.entries(el.attrs));
    this.append(...el.children.map((c) => (typeof c === 'string' ? c : new ExportNode(c.tag).fill(c))));
    return this;
  }
  getAttribute(name: string): string | null {
    return this.attrs.find(([n]) => n === name)?.[1] ?? null;
  }
  setAttribute(name: string, value: string): void {
    const hit = this.attrs.find(([n]) => n === name);
    if (hit) hit[1] = value;
    else this.attrs.push([name, value]);
  }
  getBoundingClientRect() {
    const { width, height } = this.box;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 };
  }
  cloneNode(deep = false): ExportNode {
    const copy = new ExportNode(this.tagName, this.attrs.map(([n, v]): [string, string] => [n, v]), this.box);
    if (deep) copy.append(...this.nodes.map((n) => (typeof n === 'string' ? n : n.cloneNode(true))));
    return copy;
  }
  serialize(): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const attrs = this.attrs.map(([n, v]) => ` ${n}="${esc(v).replace(/"/g, '&quot;')}"`).join('');
    const inner = this.nodes.map((n) => (typeof n === 'string' ? esc(n) : n.serialize())).join('');
    return inner ? `<${this.tagName}${attrs}>${inner}</${this.tagName}>` : `<${this.tagName}${attrs}/>`;
  }
  /** The computed `prop` as the export reads it: the attribute set here (or inherited, for text properties), else the page's. */
  computed(prop: string): string {
    for (let n: ExportNode | null = this; n; n = INHERITED.has(prop) ? n.parentElement : null) {
      const v = n.getAttribute(prop);
      if (v !== null) return prop === 'font-size' ? `${v}px` : v;
    }
    return prop === 'font-family' ? PAGE_FONT : prop === 'font-size' ? '13px' : '';
  }
}

/** The value of `prop` an exported file gives `el`: its inline style, its attribute, or an ancestor's. */
function fileValue(el: El, prop: string): string | null {
  for (let n: El | null = el; isEl(n); n = n.parent) {
    const styled = parseInline(n.attrs.style ?? '').find((d) => d.prop === prop);
    if (styled) return styled.value;
    if (n.attrs[prop] !== undefined) return n.attrs[prop];
  }
  return null;
}

/** An element's drawing, for comparing two renders of it: tags, attributes (no style) and text. */
type Drawn = string | { tag: string; attrs: Record<string, string>; children: Drawn[] };
const drawn = (n: El | string): Drawn => {
  if (typeof n === 'string') return n;
  const attrs = Object.fromEntries(Object.entries(n.attrs).filter(([name]) => name !== 'style'));
  return { tag: n.tag, attrs, children: n.children.map(drawn) };
};

describe('An exported gel is the same from every window (BG-01M6RJZB AC1)', () => {
  it('exports the same gel figure at every window size', async () => {
    // Wrong implementations this fails: the live, screen-scaled gel cloned into the file (labels
    // of 14.45 units from 1280x800, 11.28 from 1440x900, 10.5 stacked, band labels spread by the
    // same factor); labels set to 10.5 in the file while the gaps between them keep the screen's
    // scale; the file drawn for the unmeasured gel (11-unit labels) rather than at full size; the
    // file drawn from a stale state (the digest before a chip click); the file's drawing without
    // the font it inherits from the page; label attributes rewritten while the style inlined from
    // the screen keeps its font size.
    const FULL_SIZE_UNITS = 10.5; // the gel's label size drawn at full size
    // The boxes the AC3 label check above draws the gel in, then a gel scrolled out of view, which
    // measures nothing and keeps the scale it was last drawn at.
    const windows: [string, Box][] = [
      ['1280x800', { width: 560, height: 266.5 }],
      ['1440x900', { width: 560, height: 341.5 }],
      ['1280x720', { width: 560, height: 252 }],
      ['870x768 (stacked, drawn at full size)', { width: 560, height: 455.8 }],
      ['smaller than the layout draws it', { width: 430, height: 195 }],
      ['scrolled out of view (not measured)', { width: 0, height: 0 }],
    ];
    const FULL_SIZE_WINDOW = windows[3][0];
    const filler = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n);
    const closeBands = doc('Close bands', [filler(900), 'GGATCC', filler(950), 'GGATCC', filler(1000), 'CTCGAG', filler(1050), 'GGATCC', filler(1100)].join(''));
    const cases: { name: string; activeDoc: SequenceDocument; untick: string[] }[] = [
      { name: 'pUC19, BamHI + XhoI', activeDoc: byId('doc-puc19'), untick: [] },
      // A state change through the studio's own chip: the file draws the digest the screen shows.
      { name: 'pET-28a eGFP, XhoI unticked', activeDoc: plasmid, untick: ['XhoI'] },
      // Five close bands, whose size labels are pushed apart at the label gap.
      { name: 'five close bands', activeDoc: closeBands, untick: [] },
    ];

    const html = new ExportNode('html');
    const saved: Record<string, unknown>[] = [];
    vi.stubGlobal('document', { documentElement: html });
    vi.stubGlobal('getComputedStyle', (node: ExportNode) => ({
      backgroundColor: node === html ? 'rgb(9, 13, 22)' : 'rgba(0, 0, 0, 0)',
      getPropertyValue: (prop: string) => node.computed(prop),
    }));
    vi.stubGlobal('XMLSerializer', class { serializeToString(node: ExportNode) { return node.serialize(); } });
    // The app's own save path: the macOS bundle's native Save panel is handed the file's contents.
    vi.stubGlobal('__MBC_MACOS_APP_BUNDLE__', true);
    vi.stubGlobal('webkit', { messageHandlers: { mbcNative: { postMessage: (m: Record<string, unknown>) => saved.push(m) } } });
    try {
      for (const c of cases) {
        const exported: { where: string; file: string; svg: El; screen: El }[] = [];
        for (const [where, box] of windows) {
          const label = `${c.name}, from ${where}`;
          const live = new ExportNode('svg', [], box);
          const { canvas, clicked, measured } = drivenCloning({ untick: c.untick, gelElement: live, activeDoc: c.activeDoc });
          expect(measured, `${label}: the gel's ref was handed its element`).toBe(true);
          expect(clicked, `${label}: the chips clicked`).toEqual(c.untick);
          const screen = find(canvas, (e) => e.tag === 'svg' && hasClass(e, 'virtual-gel-svg'));
          if (!screen) expect.fail(`${label}: no gel`);
          live.fill(screen);

          saved.length = 0;
          const result = await exportFigure({ svg: live as unknown as SVGSVGElement, baseName: `${c.activeDoc.name} — Virtual Gel`, title: `${c.activeDoc.name} — virtual agarose gel` }, 'svg');
          expect(result.outcome, `${label}: the export was handed to the Save panel (${result.error ?? 'no error'})`).toBe('native');
          expect(saved.map((m) => m.type), `${label}: one file saved`).toEqual(['saveFile']);
          const file = String(saved[0].content);
          const svg = find(parseHtml(file.replace(/^<\?xml[^>]*\?>\s*/, '')), (e) => e.tag === 'svg');
          if (!svg) expect.fail(`${label}: the file holds no <svg>`);
          exported.push({ where, file, svg, screen });
        }

        // The fixture reaches the screen's scaling: the screen draws its labels at different sizes
        // in these windows, so a file that copied the screen could not be the same from each.
        const screenSizes = new Set(exported.flatMap((x) => findAll(x.screen, (e) => e.tag === 'text').map((t) => t.attrs['font-size'])));
        expect(screenSizes.size, `${c.name}: the screen draws labels at ${[...screenSizes].join(', ')} units across these windows`).toBeGreaterThan(2);

        const labelsOf = (svg: El) => findAll(svg, (e) => e.tag === 'text').map((t) => ({
          text: words(t), x: Number(t.attrs.x), y: Number(t.attrs.y), size: Number.parseFloat(fileValue(t, 'font-size') ?? 'NaN'),
        }));
        const [reference, ...others] = exported;
        for (const x of others) {
          expect(labelsOf(x.svg), `${c.name}: the labels exported from ${x.where} are those exported from ${reference.where}`).toEqual(labelsOf(reference.svg));
          expect(x.file, `${c.name}: the file exported from ${x.where} is the file exported from ${reference.where}`).toBe(reference.file);
        }

        // That one file is the gel drawn at full size: every label at its full-size units and the
        // gaps between them unscaled, exactly as the screen draws the gel where it has the room.
        const full = exported.find((x) => x.where === FULL_SIZE_WINDOW)!;
        const fileLabels = labelsOf(reference.svg);
        expect(fileLabels.length, `${c.name}: the file draws the lane, ladder and band labels`).toBeGreaterThan(8);
        for (const l of fileLabels) expect(l.size, `${c.name}: "${l.text}" in the file`).toBe(FULL_SIZE_UNITS);
        const fileDrawing = kids(reference.svg).filter((k) => k.tag !== 'title').slice(1); // after the file's background
        expect(fileDrawing.map(drawn), `${c.name}: the file draws the gel the screen shows at full size`).toEqual(kids(full.screen).map(drawn));
        expect(reference.svg.attrs.viewBox, `${c.name}: in the gel's own view`).toBe('0 0 430 350');
        expect([reference.svg.attrs.width, reference.svg.attrs.height], `${c.name}: at the view's size`).toEqual(['430', '350']);
        for (const t of findAll(reference.svg, (e) => e.tag === 'text')) {
          expect(fileValue(t, 'font-family'), `${c.name}: "${words(t)}" keeps the page's font in the file`).toBe(PAGE_FONT);
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
