// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q193: the workbench meets the contrast, text-size and target-size floor (WCAG 2.2 AA
 * 1.4.3 and 2.5.8) and names every icon-only button (4.1.2), with displayed shortcuts announced
 * through aria-keyshortcuts.
 *
 * Colours, sizes and target heights are read the way a browser reads them: src/App.css is parsed
 * into rules, each element's declarations are chosen by the cascade (importance, specificity,
 * order, inheritance, var() substitution at the declaring element), in the light theme and under
 * `.mbc-dark-mode`. Backgrounds are composited up the element's ancestors. Names, shortcuts and
 * inline sizes are read from the markup the real components render; the App is driven through its
 * own command dispatcher (the harness of structureToolsWiring.test.tsx), and the alignment
 * studio's controls are operated by calling the handlers its render hands to its own elements.
 */

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuNode } from '../components/CascadingMenu';

// ─── Probes, installed before the modules under test load ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  dispatcher: null as null | { current: AppDispatcher },
  onMenus: null as null | ((menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void),
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  elementsSeen: 0,
  /** True while driveApp renders the App (BG-01M6RTP1). */
  rendering: false,
  /** Sees each composition pass the engine runs, with whether driveApp was rendering then. */
  onComposition: null as null | ((sequence: string, inRender: boolean) => void),
  /** Sees each external store a component subscribes to through useSyncExternalStore, with the snapshot it reads. */
  onExternalStore: null as null | ((subscribe: (listener: () => void) => () => void, getSnapshot: () => unknown) => void),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useRef = ((initial: unknown) => {
    const ref = actual.useRef(initial);
    if (initial && typeof initial === 'object' && 'onMenuAction' in initial && 'onNativeFileOpen' in initial) {
      probe.dispatcher = ref as unknown as { current: AppDispatcher };
    }
    return ref;
  }) as typeof actual.useRef;
  const useSyncExternalStore = ((subscribe, getSnapshot, getServerSnapshot) => {
    probe.onExternalStore?.(subscribe, getSnapshot);
    return actual.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  }) as typeof actual.useSyncExternalStore;
  return { ...actual, default: { ...actual, useRef, useSyncExternalStore }, useRef, useSyncExternalStore };
});

vi.mock('../core/bioEngine', async () => {
  const actual = await vi.importActual<typeof import('../core/bioEngine')>('../core/bioEngine');
  return {
    ...actual,
    analyzeSequenceComposition: (rawSeq: string) => {
      probe.onComposition?.(rawSeq, probe.rendering);
      return actual.analyzeSequenceComposition(rawSeq);
    },
  };
});

vi.mock('../core/menuShortcuts', async () => {
  const actual = await vi.importActual<typeof import('../core/menuShortcuts')>('../core/menuShortcuts');
  return {
    ...actual,
    collectMenuShortcutBindings: (trees: Parameters<typeof actual.collectMenuShortcutBindings>[0]) => {
      probe.onMenus?.(trees, (id) => {
        if (!probe.dispatcher) throw new Error('the App rendered no native-menu dispatcher');
        probe.dispatcher.current.onMenuAction(id);
      });
      return actual.collectMenuShortcutBindings(trees);
    },
  };
});

type JsxFn = (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => unknown;
/** Wraps a JSX factory so the element probe sees each element as it is created. */
const watch = vi.hoisted(() => (fn: JsxFn): JsxFn => (type, props, ...rest) => {
  probe.elementsSeen++;
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

const { App } = await import('../App');
const { SequenceAlignmentStudio } = await import('../components/AlignmentAndPhyloStudio');
const { CloningAndGelStudio } = await import('../components/CloningAndGelStudio');
const { BlastSearchModal } = await import('../components/MenusPreferencesAndBlastModal');
const { CascadingMenuPopup } = await import('../components/CascadingMenu');
const { HybridToolsAndHistoryStudio } = await import('../components/HybridToolsAndHistoryStudio');
// Read through the module objects, so a missing export fails only the criterion that needs it.
const circularMap = await import('../components/CircularPlasmidMap');
const { CircularPlasmidMap } = circularMap;
const { LinearSequenceView } = await import('../components/LinearSequenceView');
const menuShortcuts = await import('../core/menuShortcuts');
const shortcutLabelToAriaKeyshortcuts = (label: string | undefined) => menuShortcuts.shortcutLabelToAriaKeyshortcuts(label);
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { findRestrictionCutSites, findORFs, analyzeSequenceComposition } = await import('../core/bioEngine');
const { REBASE_ENZYMES } = await import('../data/rebaseEnzymes');
const { cutSiteDisplayPosition } = await import('../core/restrictionDisplay');
const { EMPTY_WORKSPACE_DOCUMENT } = await import('../core/emptyWorkspace');
const { saveWorkbenchToLocalAutosave, clearWorkbenchLocalAutosave } = await import('../core/mbcSessionFormat');
const alignmentViewModel = await import('../core/alignmentViewModel');
type AlignmentColorScheme = import('../core/alignmentViewModel').AlignmentColorScheme;
type SequenceDocument = import('../types/bio').SequenceDocument;

// CSS `?raw` imports are stubbed by Vitest's CSS handling, so read the files from disk.
const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as { readFileSync: (p: URL, enc: string) => string };
const APP_CSS = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');
const DESIGN_MD = nodeFs.readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8');
/**
 * The mono face's line box: Google Sans Code's hhea ascent 1932 plus descent 572 per 2000 em
 * (googleSansFonts.test.ts reads them from the shipped WOFF2). The map's labels are this tall.
 */
const MONO_LINE_EM = (1932 + 572) / 2000;

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

// Many checks render the whole App, some at 200,000 bp. On a loaded machine they ran past Vitest's
// 5 s default, and a test that times out keeps running into the next (BG-01M6T68N), so the file
// sets its timeout as the App-mounting suites beside it do.
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  probe.onMenus = null;
  probe.onElement = null;
  probe.onComposition = null;
  probe.onExternalStore = null;
});

/**
 * Lets a waiting task run. The App counts a sequence's Statistics in a task of its own, after the
 * render that asks for them (BG-01M6RTP1), so a test asks with one render, lets the count run, and
 * reads them with the next.
 */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * A DNA's masses in kDa to the 0.1 the Statistics panel prints, as Biopython 1.88 weighs them:
 * `molecular_weight(seq, "DNA", double_stranded, circular)`, each strand the sum of its dNMP masses
 * (A 331.2218, C 307.1971, G 347.2212, T 322.2085) less one water (18.0153) per bond, and one more
 * when the molecule is a closed circle; the double strand adds the complementary strand.
 */
function biopythonDnaMassesKda(seq: string, circular: boolean): { ds: string; ss: string } {
  const W = 18.0153;
  const weight: Record<string, number> = { A: 331.2218, C: 307.1971, G: 347.2212, T: 322.2085 };
  const pair: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
  let ss = 0;
  let complement = 0;
  for (const b of seq) {
    if (!(b in weight)) throw new Error(`Biopython weighs only A, C, G and T, not ${b}`);
    ss += weight[b];
    complement += weight[pair[b]];
  }
  const bonds = (seq.length - 1 + (circular ? 1 : 0)) * W;
  return { ds: ((ss + complement - 2 * bonds) / 1000).toFixed(1), ss: ((ss - bonds) / 1000).toFixed(1) };
}

// ─── A DOM of plain objects: built from paths, or parsed from rendered markup ───

interface El {
  tag: string;
  attrs: Record<string, string>;
  classes: Set<string>;
  parent: El | null;
  children: (El | string)[];
}

function el(tag: string, attrs: Record<string, string> = {}, parent: El | null = null): El {
  const node: El = { tag: tag.toLowerCase(), attrs, classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)), parent, children: [] };
  if (parent) parent.children.push(node);
  return node;
}

const elementChildren = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');

/** html > body > div.mbc-workbench (with .mbc-dark-mode at night): the App's theme root. */
function workbench(theme: Theme): El {
  const html = el('html');
  const body = el('body', {}, html);
  return el('div', { class: theme === 'night' ? 'mbc-workbench mbc-dark-mode' : 'mbc-workbench' }, body);
}

/** Appends a chain like `aside.a > div.b.c > span.d` under `parent` and returns its last element. */
function chain(parent: El, path: string): El {
  let cur = parent;
  for (const step of path.split('>').map((s) => s.trim())) {
    const [tag, ...cls] = step.split('.');
    cur = el(tag, cls.length ? { class: cls.join(' ') } : {}, cur);
  }
  return cur;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});

/** Parses React's static markup (well formed, quoted attributes) under `parent`. */
function parseMarkup(html: string, parent: El): El {
  let cur = parent;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) {
      cur.children.push(decodeEntities(m[5]));
      continue;
    }
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      if (cur.tag !== tag.toLowerCase()) throw new Error(`markup closes <${tag}> inside <${cur.tag}>`);
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decodeEntities(a[2] ?? '');
    const node = el(tag, attrs, cur);
    if (tag.toLowerCase() === 'style' || tag.toLowerCase() === 'script') {
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      node.children.push(html.slice(re.lastIndex, end));
      re.lastIndex = end + tag.length + 3;
      continue;
    }
    if (!selfClosing && !VOID.has(tag.toLowerCase())) cur = node;
  }
  if (cur !== parent) throw new Error(`markup leaves <${cur.tag}> open`);
  return parent;
}

function* walk(e: El): Generator<El> {
  yield e;
  for (const c of elementChildren(e)) yield* walk(c);
}
const textOf = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const findAll = (root: El, pred: (e: El) => boolean) => [...walk(root)].filter(pred);
const hasClass = (cls: string) => (e: El) => e.classes.has(cls);
const ancestors = (e: El) => {
  const out: El[] = [];
  for (let p = e.parent; p; p = p.parent) out.push(p);
  return out;
};
const insideSvg = (e: El) => ancestors(e).some((a) => a.tag === 'svg');

/** Inline style declarations, as React writes them (`a:b;c:d`). */
function inlineStyle(e: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (e.attrs.style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

// ─── App.css: rules, selector matching, specificity and the cascade ───

type Theme = 'light' | 'night';
interface Decl { prop: string; value: string; important: boolean }
interface Rule { selectors: string[]; decls: Decl[]; order: number; line: number }

const VIEWPORT_WIDTH = 1440; // the detector run's 1440x900 window

/** Whether a rule nested in these at-rules applies in a 1440px desktop window with default media features. */
function atRulesApply(preludes: string[]): boolean {
  return preludes.every((p) => {
    if (/^@supports\s+not\b/.test(p)) return false;
    if (/^@supports\b/.test(p)) return true;
    if (/^@media\b/.test(p)) {
      const max = /max-width:\s*(\d+)px/.exec(p);
      const min = /min-width:\s*(\d+)px/.exec(p);
      if (max) return VIEWPORT_WIDTH <= Number(max[1]);
      if (min) return VIEWPORT_WIDTH >= Number(min[1]);
      return false; // prefers-color-scheme (the theme is the .mbc-dark-mode class), reduced motion, forced colours, more contrast
    }
    return false; // @container, @keyframes, @font-face, @property: no style rules that apply here
  });
}

function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  let order = 0;
  const lineAt = (pos: number) => text.slice(0, pos).split('\n').length;
  const skipComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const readUntil = (stops: string): { out: string; stop: string; at: number } => {
    let out = '';
    let depth = 0;
    const at = i;
    while (i < text.length) {
      if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        i = end + 2;
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
      if (depth === 0 && stops.includes(c)) return { out, stop: c, at };
      out += c;
      i++;
    }
    return { out, stop: '', at };
  };
  const block = (preludes: string[]): void => {
    while (i < text.length) {
      const { out, stop, at } = readUntil('{};');
      const head = skipComments(out).trim().replace(/\s+/g, ' ');
      if (stop === '}') { i++; return; }
      if (stop === ';') { i++; continue; } // @import and the like
      if (stop === '') return;
      i++; // past {
      if (head.startsWith('@')) {
        block([...preludes, head]);
        continue;
      }
      // A style rule: declarations up to the matching }.
      const decls: Decl[] = [];
      for (;;) {
        const d = readUntil(';}');
        const raw = skipComments(d.out).trim();
        if (raw) {
          const colon = raw.indexOf(':');
          let value = raw.slice(colon + 1).trim().replace(/\s+/g, ' ');
          const important = /!\s*important$/i.test(value);
          if (important) value = value.replace(/\s*!\s*important$/i, '');
          decls.push({ prop: raw.slice(0, colon).trim().toLowerCase(), value, important });
        }
        i++;
        if (d.stop !== ';') break;
      }
      if (atRulesApply(preludes)) rules.push({ selectors: splitTop(head, ','), decls, order: order++, line: lineAt(at) });
    }
  };
  block([]);
  return rules;
}

/** Splits on `sep` outside parentheses and brackets. */
function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth === 0 && c === sep) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

type Simple =
  | { k: 'tag'; v: string } | { k: 'any' } | { k: 'id'; v: string } | { k: 'class'; v: string }
  | { k: 'attr'; name: string; op: string; v: string; ci: boolean }
  | { k: 'pseudo'; name: string; arg: string | null } | { k: 'element'; name: string };
interface Compound { parts: Simple[]; combinator: ' ' | '>' | '+' | '~' | null }

function parseComplex(sel: string): Compound[] {
  const out: Compound[] = [];
  let i = 0;
  let parts: Simple[] = [];
  let pending: Compound['combinator'] = null;
  const ident = () => {
    let s = '';
    while (i < sel.length && /[\w\-\\ -￿]/.test(sel[i])) {
      if (sel[i] === '\\') { s += sel[i + 1]; i += 2; continue; }
      s += sel[i++];
    }
    return s;
  };
  const push = () => {
    if (parts.length) { out.push({ parts, combinator: pending }); parts = []; pending = null; }
  };
  while (i < sel.length) {
    const c = sel[i];
    if (/\s/.test(c) || c === '>' || c === '+' || c === '~') {
      let comb: Compound['combinator'] = ' ';
      while (i < sel.length && /[\s>+~]/.test(sel[i])) { if (sel[i] !== ' ' && !/\s/.test(sel[i])) comb = sel[i] as Compound['combinator']; i++; }
      if (parts.length) { out.push({ parts, combinator: pending }); parts = []; }
      pending = comb;
      continue;
    }
    if (c === '*') { parts.push({ k: 'any' }); i++; continue; }
    if (c === '#') { i++; parts.push({ k: 'id', v: ident() }); continue; }
    if (c === '.') { i++; parts.push({ k: 'class', v: ident() }); continue; }
    if (c === '[') {
      const end = sel.indexOf(']', i);
      const body = sel.slice(i + 1, end).trim();
      const am = /^([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?$/.exec(body);
      if (!am) throw new Error(`unreadable attribute selector [${body}] in ${sel}`);
      parts.push({ k: 'attr', name: am[1], op: am[2] ?? '', v: am[3] ?? am[4] ?? am[5] ?? '', ci: !!am[6] });
      i = end + 1;
      continue;
    }
    if (c === ':') {
      const isElement = sel[i + 1] === ':';
      i += isElement ? 2 : 1;
      const name = ident().toLowerCase();
      let arg: string | null = null;
      if (sel[i] === '(') {
        let depth = 0;
        const start = i + 1;
        for (; i < sel.length; i++) {
          if (sel[i] === '(') depth++;
          if (sel[i] === ')' && --depth === 0) break;
        }
        arg = sel.slice(start, i).trim();
        i++;
      }
      if (isElement || ['before', 'after', 'first-line', 'first-letter', 'placeholder', 'selection', 'marker', 'backdrop'].includes(name)) {
        parts.push({ k: 'element', name });
      } else parts.push({ k: 'pseudo', name, arg });
      continue;
    }
    const t = ident();
    if (!t) throw new Error(`unreadable selector ${sel} at ${i}`);
    parts.push({ k: 'tag', v: t.toLowerCase() });
  }
  push();
  return out;
}

const parsedSelectors = new Map<string, Compound[]>();
const complex = (s: string) => {
  let c = parsedSelectors.get(s);
  if (!c) { c = parseComplex(s); parsedSelectors.set(s, c); }
  return c;
};

/** Rest-state pseudo-classes: hover, focus and the like never match a static element. */
const STATE_PSEUDO = new Set([
  'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'target', 'placeholder-shown', 'open', 'popover-open',
  'modal', 'fullscreen', 'autofill', '-webkit-autofill', 'invalid', 'valid', 'user-invalid', 'user-valid', 'required', 'optional',
  'read-only', 'read-write', 'indeterminate', 'default', 'in-range', 'out-of-range', 'playing', 'paused', 'host', 'state',
  '-moz-focusring', '-moz-placeholder', '-ms-input-placeholder', 'window-inactive', 'horizontal', 'vertical', 'decrement',
  'increment', 'start', 'end', 'double-button', 'single-button', 'no-button', 'corner-present',
]);

function nth(formula: string, index: number): boolean {
  const f = formula.replace(/\s+/g, '').toLowerCase();
  if (f === 'odd') return index % 2 === 1;
  if (f === 'even') return index % 2 === 0;
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(f);
  if (!m) return index === Number(f);
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
  const b = Number(m[2] ?? 0);
  if (a === 0) return index === b;
  return (index - b) / a >= 0 && Number.isInteger((index - b) / a);
}

function matchSimple(e: El, s: Simple): boolean {
  switch (s.k) {
    case 'any': return true;
    case 'tag': return e.tag === s.v;
    case 'id': return e.attrs.id === s.v;
    case 'class': return e.classes.has(s.v);
    case 'element': return false; // a pseudo-element is a different box
    case 'attr': {
      if (!(s.name in e.attrs)) return false;
      const have = s.ci ? e.attrs[s.name].toLowerCase() : e.attrs[s.name];
      const want = s.ci ? s.v.toLowerCase() : s.v;
      switch (s.op) {
        case '': return true;
        case '=': return have === want;
        case '~=': return have.split(/\s+/).includes(want);
        case '|=': return have === want || have.startsWith(`${want}-`);
        case '^=': return have.startsWith(want);
        case '$=': return have.endsWith(want);
        case '*=': return have.includes(want);
        default: throw new Error(`attribute operator ${s.op}`);
      }
    }
    case 'pseudo': {
      const sibs = e.parent ? elementChildren(e.parent) : [e];
      const idx = sibs.indexOf(e);
      const sameType = sibs.filter((x) => x.tag === e.tag);
      switch (s.name) {
        case 'root': return e.parent === null;
        case 'scope': return e.parent === null;
        case 'not': return !splitTop(s.arg ?? '', ',').some((x) => matches(e, x));
        case 'is': case 'where': case 'matches': case '-webkit-any': return splitTop(s.arg ?? '', ',').some((x) => matches(e, x));
        case 'has': return splitTop(s.arg ?? '', ',').some((x) => hasRelative(e, x));
        case 'first-child': return idx === 0;
        case 'last-child': return idx === sibs.length - 1;
        case 'only-child': return sibs.length === 1;
        case 'first-of-type': return sameType[0] === e;
        case 'last-of-type': return sameType[sameType.length - 1] === e;
        case 'only-of-type': return sameType.length === 1;
        case 'nth-child': return nth(s.arg ?? '', idx + 1);
        case 'nth-last-child': return nth(s.arg ?? '', sibs.length - idx);
        case 'nth-of-type': return nth(s.arg ?? '', sameType.indexOf(e) + 1);
        case 'nth-last-of-type': return nth(s.arg ?? '', sameType.length - sameType.indexOf(e));
        case 'empty': return e.children.every((c) => typeof c === 'string' && c === '');
        case 'disabled': return 'disabled' in e.attrs;
        case 'enabled': return ['button', 'input', 'select', 'textarea'].includes(e.tag) && !('disabled' in e.attrs);
        case 'checked': return 'checked' in e.attrs;
        case 'link': case 'any-link': return e.tag === 'a' && 'href' in e.attrs;
        case 'defined': return true;
        case 'lang': return false;
        case 'dir': return s.arg === 'ltr';
        default:
          if (STATE_PSEUDO.has(s.name) || s.name.startsWith('-webkit-') || s.name.startsWith('-moz-')) return false;
          throw new Error(`the stylesheet uses :${s.name}, which this reader does not know`);
      }
    }
  }
}

function matchCompound(e: El, c: Compound): boolean {
  return c.parts.every((p) => matchSimple(e, p));
}

/** Matches the compounds right to left, from index `k`, at element `e`. */
function matchFrom(e: El, cs: Compound[], k: number): boolean {
  if (!matchCompound(e, cs[k])) return false;
  if (k === 0) return true;
  const comb = cs[k].combinator;
  if (comb === '>') return !!e.parent && matchFrom(e.parent, cs, k - 1);
  if (comb === ' ') {
    for (let p = e.parent; p; p = p.parent) if (matchFrom(p, cs, k - 1)) return true;
    return false;
  }
  const sibs = e.parent ? elementChildren(e.parent) : [];
  const idx = sibs.indexOf(e);
  if (comb === '+') return idx > 0 && matchFrom(sibs[idx - 1], cs, k - 1);
  if (comb === '~') return sibs.slice(0, idx).some((s) => matchFrom(s, cs, k - 1));
  return false;
}

function matches(e: El, selector: string): boolean {
  const cs = complex(selector);
  return cs.length > 0 && matchFrom(e, cs, cs.length - 1);
}

/** `:has()` with a relative selector (`> x`, `+ x`, `~ x` or a descendant `x`). */
function hasRelative(e: El, rel: string): boolean {
  const lead = /^\s*([>+~])/.exec(rel);
  const rest = lead ? rel.slice(lead[0].length) : rel;
  const pool = !lead ? [...walk(e)].slice(1)
    : lead[1] === '>' ? elementChildren(e)
    : (() => { const sibs = e.parent ? elementChildren(e.parent) : []; const i = sibs.indexOf(e); return lead[1] === '+' ? sibs.slice(i + 1, i + 2) : sibs.slice(i + 1); })();
  // An approximation: a relative selector of several compounds may match through ancestors above
  // the anchor. No rule this test reads depends on that.
  const cs = complex(rest);
  return pool.some((x) => matchFrom(x, cs, cs.length - 1));
}

type Spec = [number, number, number];
function specificity(selector: string): Spec {
  const spec: Spec = [0, 0, 0];
  const add = (s: Spec) => { spec[0] += s[0]; spec[1] += s[1]; spec[2] += s[2]; };
  const maxOf = (list: string): Spec => splitTop(list, ',').map(specificity)
    .reduce<Spec>((m, s) => (s[0] > m[0] || (s[0] === m[0] && (s[1] > m[1] || (s[1] === m[1] && s[2] > m[2]))) ? s : m), [0, 0, 0]);
  for (const c of complex(selector)) {
    for (const p of c.parts) {
      if (p.k === 'id') spec[0]++;
      else if (p.k === 'class' || p.k === 'attr') spec[1]++;
      else if (p.k === 'tag' || p.k === 'element') spec[2]++;
      else if (p.k === 'pseudo') {
        if (p.name === 'where') continue;
        if (['not', 'is', 'matches', '-webkit-any', 'has'].includes(p.name)) add(maxOf(p.arg ?? ''));
        else spec[1]++;
      }
    }
  }
  return spec;
}
const cmpSpec = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const RULES = parseRules(APP_CSS);

/** Every property a longhand can be set through: logical aliases and the background shorthand. */
const ALIASES: Record<string, string[]> = {
  color: ['color'],
  'background-color': ['background-color', 'background'],
  'min-block-size': ['min-block-size', 'min-height'],
  'border-color': ['border-color', 'border'],
  display: ['display'],
};

interface Winner { value: string; rule: Rule | null; prop: string }

/** The declaration the cascade picks for `prop` on `e`, or null when no rule sets it. */
function cascaded(e: El, prop: string): Winner | null {
  const props = ALIASES[prop] ?? [prop];
  let best: { d: Decl; spec: Spec; order: number; rule: Rule | null } | null = null;
  const consider = (d: Decl, spec: Spec, order: number, rule: Rule | null) => {
    if (!best) { best = { d, spec, order, rule }; return; }
    if (d.important !== best.d.important) { if (d.important) best = { d, spec, order, rule }; return; }
    const c = cmpSpec(spec, best.spec);
    if (c > 0 || (c === 0 && order > best.order)) best = { d, spec, order, rule };
  };
  for (const rule of RULES) {
    const hits = rule.selectors.filter((s) => matches(e, s));
    if (!hits.length) continue;
    const spec = hits.map(specificity).reduce((m, s) => (cmpSpec(s, m) > 0 ? s : m));
    for (const d of rule.decls) if (props.includes(d.prop)) consider(d, spec, rule.order, rule);
  }
  // The style attribute outranks every rule but an !important one.
  const inline = inlineStyle(e);
  for (const p of props) if (inline[p] !== undefined) consider({ prop: p, value: inline[p], important: false }, [Infinity, 0, 0], Number.MAX_SAFE_INTEGER, null);
  if (!best) return null;
  const b = best as { d: Decl; rule: Rule | null };
  if (b.d.prop === 'background') return { value: backgroundColourOf(b.d.value), rule: b.rule, prop: b.d.prop };
  if (b.d.prop === 'border') {
    const colour = splitTop(b.d.value, ' ').find((t) => /^(#|rgba?\(|hsla?\(|var\(|transparent$|currentcolor$)/i.test(t));
    return { value: colour ?? 'currentcolor', rule: b.rule, prop: b.d.prop };
  }
  return { value: b.d.value, rule: b.rule, prop: b.d.prop };
}

/** The colour layer a `background` shorthand sets (transparent when it names none). */
function backgroundColourOf(value: string): string {
  if (/gradient\(|url\(/.test(value)) return `unresolvable(${value})`;
  const layers = splitTop(value, ' ').filter((t) => !/^(no-repeat|repeat|center|top|left|right|bottom|fixed|scroll|border-box|padding-box|content-box|\d)/.test(t));
  return layers.length ? layers[layers.length - 1] : 'transparent';
}

/** Custom properties on `e`: inherited, then its own declarations resolved where they are declared. */
const customCache = new WeakMap<El, Map<string, string>>();
function customProps(e: El): Map<string, string> {
  const cached = customCache.get(e);
  if (cached) return cached;
  const map = new Map(e.parent ? customProps(e.parent) : []);
  const own = new Map<string, { d: Decl; spec: Spec; order: number }>();
  for (const rule of RULES) {
    const hits = rule.selectors.filter((s) => matches(e, s));
    if (!hits.length) continue;
    const spec = hits.map(specificity).reduce((m, s) => (cmpSpec(s, m) > 0 ? s : m));
    for (const d of rule.decls) {
      if (!d.prop.startsWith('--')) continue;
      const cur = own.get(d.prop);
      const c = cur ? cmpSpec(spec, cur.spec) : 1;
      if (!cur || (d.important && !cur.d.important) || (d.important === cur.d.important && (c > 0 || (c === 0 && rule.order > cur.order)))) {
        own.set(d.prop, { d, spec, order: rule.order });
      }
    }
  }
  for (const [k, v] of Object.entries(inlineStyle(e))) if (k.startsWith('--')) own.set(k, { d: { prop: k, value: v, important: false }, spec: [Infinity, 0, 0], order: Infinity });
  const raw = new Map(map);
  for (const [k, { d }] of own) raw.set(k, d.value);
  const resolving = new Set<string>();
  const resolveProp = (name: string): string | undefined => {
    if (!own.has(name)) return map.get(name);
    if (resolving.has(name)) return undefined; // a cycle makes the property invalid
    resolving.add(name);
    const out = substitute(raw.get(name)!, resolveProp);
    resolving.delete(name);
    return out;
  };
  for (const k of own.keys()) {
    const v = resolveProp(k);
    if (v === undefined) map.delete(k);
    else map.set(k, v);
  }
  customCache.set(e, map);
  return map;
}

function substitute(value: string, lookup: (name: string) => string | undefined): string {
  let out = value;
  for (let guard = 0; guard < 50 && /var\(/.test(out); guard++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/, (_m, name: string, fallback?: string) => {
      const v = lookup(name);
      if (v !== undefined) return v;
      if (fallback !== undefined) return fallback.trim();
      return `unresolved(${name})`;
    });
  }
  return out;
}

const resolveIn = (e: El, value: string) => substitute(value, (n) => customProps(e).get(n));

type RGBA = [number, number, number, number];
const NAMED: Record<string, RGBA> = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
/** The value of a `calc()` body of numbers, + - * / and parentheses (what var() substitution leaves). */
function evalCalc(expr: string, where: string): number {
  const tokens = expr.match(/\d*\.?\d+(?:e[+-]?\d+)?|[-+*/()]/gi) ?? [];
  if (tokens.join('') !== expr.replace(/\s+/g, '')) throw new Error(`${where}: calc(${expr}) is not plain arithmetic`);
  let i = 0;
  const atom = (): number => {
    const t = tokens[i++];
    if (t === '(') { const v = sum(); i++; return v; }
    if (t === '-') return -atom();
    return Number(t);
  };
  const product = (): number => {
    let v = atom();
    while (tokens[i] === '*' || tokens[i] === '/') v = tokens[i++] === '*' ? v * atom() : v / atom();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[i] === '+' || tokens[i] === '-') v = tokens[i++] === '+' ? v + product() : v - product();
    return v;
  };
  return sum();
}

function parseColour(v: string, where: string): RGBA {
  let s = v.trim().toLowerCase();
  // A browser computes calc() in a colour first: channels round to whole numbers, alpha stays.
  for (let guard = 0; guard < 20 && /calc\(/.test(s); guard++) s = s.replace(/calc\(([^()]*)\)/, (_m, body: string) => String(evalCalc(body, where)));
  if (NAMED[s]) return NAMED[s];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s);
  if (fn) {
    const nums = fn[1].split(/[\s,/]+/).filter(Boolean).map((t) => (t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t)));
    const channel = (x: number) => Math.min(255, Math.max(0, Math.round(x)));
    return [channel(nums[0]), channel(nums[1]), channel(nums[2]), Math.min(1, Math.max(0, nums[3] ?? 1))];
  }
  throw new Error(`${where}: "${v}" is not a colour this test can read`);
}
const hexOf = (c: RGBA) => `#${c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;

/** The text colour of `e`: its own cascaded colour, or the one it inherits. */
function textColour(e: El): RGBA {
  const w = cascaded(e, 'color');
  if (!w || w.value === 'inherit' || w.value === 'currentcolor' || w.value === 'currentColor') {
    if (!e.parent) return [0, 0, 0, 1];
    return textColour(e.parent);
  }
  return parseColour(resolveIn(e, w.value), `color of <${e.tag} class="${[...e.classes].join(' ')}">`);
}

/** The colour behind `e`'s text: its own background over its ancestors', down to an opaque one. */
function backdrop(e: El): RGBA {
  const layers: RGBA[] = [];
  for (let cur: El | null = e; cur; cur = cur.parent) {
    const w = cascaded(cur, 'background-color');
    if (!w) continue;
    const resolved = resolveIn(cur, w.value);
    if (resolved.startsWith('unresolvable(')) throw new Error(`the background of <${cur.tag} class="${[...cur.classes].join(' ')}"> is ${resolved}`);
    const c = parseColour(resolved, `background of <${cur.tag} class="${[...cur.classes].join(' ')}">`);
    if (c[3] === 0) continue;
    layers.push(c);
    if (c[3] >= 1) break;
  }
  if (!layers.length || layers[layers.length - 1][3] < 1) throw new Error(`no opaque surface under <${e.tag} class="${[...e.classes].join(' ')}">`);
  let out = layers.pop()!;
  while (layers.length) {
    const top = layers.pop()!;
    out = [0, 1, 2].map((i) => top[3] * top[i] + (1 - top[3]) * out[i]).concat(1) as RGBA;
  }
  return out;
}

const luminance = (c: RGBA) => {
  const lin = (x: number) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
};
const contrast = (a: RGBA, b: RGBA) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** DESIGN.md's front-matter colours. */
const DESIGN_COLOURS: Record<string, string> = (() => {
  const front = /^---\n([\s\S]*?)\n---/.exec(DESIGN_MD)?.[1] ?? '';
  const block = /\ncolors:\n((?: {2}[\w-]+: "#[0-9a-fA-F]{6}"\n)+)/.exec(`\n${front}\n`)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/^ {2}([\w-]+): "(#[0-9a-fA-F]{6})"$/gm)].map((m) => [m[1], m[2].toLowerCase()]));
})();

/** A length in px: `Npx`, `Nrem` (16px), or `calc(Nrem * F)`. */
function px(value: string, where: string): number {
  const v = value.trim();
  const plain = /^(-?[\d.]+)(px|rem)$/.exec(v);
  if (plain) return Number(plain[1]) * (plain[2] === 'rem' ? 16 : 1);
  const calc = /^calc\(\s*([\d.]+)(px|rem)\s*\*\s*([\d.]+)\s*\)$/.exec(v);
  if (calc) return Number(calc[1]) * (calc[2] === 'rem' ? 16 : 1) * Number(calc[3]);
  const clamp = /^clamp\(\s*([\d.]+)(px|rem)\s*,/.exec(v);
  if (clamp) return Number(clamp[1]) * (clamp[2] === 'rem' ? 16 : 1); // a clamp() is never below its minimum
  throw new Error(`${where}: "${value}" is not a length this test can read`);
}

// ─── App, studio and map renders ───

/** Renders the App and runs each step inside the render the previous one caused (see structureToolsWiring). */
function driveApp(steps: readonly ((menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void)[]) {
  let ran = 0;
  let passes = 0;
  let lastMenus: readonly (readonly unknown[])[] = [];
  probe.onMenus = (menus, dispatch) => {
    lastMenus = menus;
    if (++passes > 25) throw new Error('the App kept re-rendering');
    if (ran < steps.length) steps[ran++](menus, dispatch);
  };
  probe.rendering = true;
  let html: string;
  try {
    html = renderToStaticMarkup(<App />);
  } finally {
    probe.rendering = false;
  }
  expect(ran, 'every step ran').toBe(steps.length);
  return { html, menus: lastMenus };
}

/** The App in Sequence view on the sample library's first document, with the inspector open. */
const sequenceView = (...more: string[]) => driveApp([(_m, d) => d('new-session:sample-library'), ...more.map((id) => (_m: unknown, d: (id: string) => void) => d(id))]);

const puc19 = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;

/** An aligned three-member alignment document, so the ruler is drawn. */
function alignedDoc(): SequenceDocument {
  const base = 'ATGGCTAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTG';
  const members = [
    { id: 'm1', name: 'Member_One', sequence: base },
    { id: 'm2', name: 'Member_Two', sequence: `${base.slice(0, 30)}--${base.slice(32, 70)}TT${base.slice(72)}` },
    { id: 'm3', name: 'Member_Three', sequence: `${base.slice(0, 50)}CC${base.slice(52)}` },
  ];
  return {
    ...EMPTY_WORKSPACE_DOCUMENT, id: 'aln-a11y', name: 'Ruler alignment', sequence: base, folder: 'Alignments',
    alignmentMeta: { isAligned: true, sequenceCount: 3, sequences: members },
  } as SequenceDocument;
}

// ─── The criteria ───

describe('accessibility floor (US-01M6Q193)', () => {
  it('meets the AA contrast ratio on the measured low contrast text pairs', () => {
    // Each pair: where the text sits (the components' own markup), and the backdrop the 2026-11-05
    // detector run measured behind it in the light theme, which anchors the path to that surface.
    const PAIRS = [
      { text: '.folder-count', path: 'aside.mbc-sources-pane > div.sources-tree-scroll > button.source-folder-row > span.folder-count', measured: '#deeafa' },
      { text: '.folder-count (selected row)', path: 'aside.mbc-sources-pane > div.sources-tree-scroll > button.source-folder-row.selected > span.folder-count', measured: '#c1d8fb' },
      { text: '.mbc-home-link-btn', path: 'main.mbc-home-layout > aside.mbc-home-sidebar > div.mbc-home-sidebar-empty > button.mbc-home-link-btn', measured: '#f4f7fc' },
      { text: '.kpi-val', path: 'div.thermo-kpi-grid > div.kpi-box > strong.kpi-val', measured: '#f4f7fc' },
      { text: '.map-hover-readout', path: 'div.plasmid-map-wrapper > div.map-footer-bar > span.map-hover-readout', measured: '#f4f7fc' },
      { text: '.mbc-cockpit-scale-badge', path: 'section.mbc-cockpit-bar > div.mbc-cockpit-row-top > span.mbc-cockpit-scale-badge', measured: '#d7e7f3' },
      { text: '.cut-pill.type2s', path: 'div.linear-seq-container > div.sequence-blocks-scroll > div.seq-row-block > div.seq-track-markers > span.cut-pill.type2s', measured: '#fef7e0' },
    ];
    const allowed: Record<Theme, Record<string, string>> = {
      light: { 'Signal Ink': DESIGN_COLOURS['signal-blue-ink'], Ink: DESIGN_COLOURS.ink },
      night: { 'Night Sky Blue': DESIGN_COLOURS['signal-blue-night'], 'Night Ink': DESIGN_COLOURS['night-ink'] },
    };
    for (const names of Object.values(allowed)) for (const [n, v] of Object.entries(names)) expect(v, `DESIGN.md states ${n}`).toMatch(/^#[0-9a-f]{6}$/);

    const results: string[] = [];
    const failures: string[] = [];
    for (const theme of ['light', 'night'] as const) {
      for (const pair of PAIRS) {
        const target = chain(workbench(theme), pair.path);
        const fg = textColour(target);
        const bg = backdrop(target);
        const ratio = contrast(fg, bg);
        const line = `${theme} ${pair.text}: ${hexOf(fg)} on ${hexOf(bg)} = ${ratio.toFixed(2)}:1`;
        results.push(line);
        if (theme === 'light') expect(hexOf(bg), `${pair.text} sits on the backdrop the detector measured`).toBe(pair.measured);
        if (ratio < 4.5) failures.push(`${line} (below 4.5:1)`);
        if (!Object.values(allowed[theme]).includes(hexOf(fg))) failures.push(`${line} (text ${hexOf(fg)} is not ${Object.keys(allowed[theme]).join(' or ')})`);
      }
    }
    expect(failures, results.join('\n')).toEqual([]);

    // The Type IIS pill keeps its amber wash and border in both themes; only its text became Ink.
    for (const theme of ['light', 'night'] as const) {
      const root = workbench(theme);
      const type2s = chain(root, 'div.seq-track-markers > span.cut-pill.type2s');
      const amber = customProps(type2s);
      expect(resolveIn(type2s, cascaded(type2s, 'background-color')!.value), `${theme} Type IIS wash`).toBe(amber.get('--mbc-amber-soft'));
      expect(resolveIn(type2s, cascaded(type2s, 'border-color')?.value ?? ''), `${theme} Type IIS border`).toBe(amber.get('--mbc-amber-border'));
    }
  });

  it('keeps the BLAST identity legend text in ink with coloured swatches', () => {
    // A query and subjects copied from it, some with substitutions, so hits fall in several classes.
    const query = puc19.sequence.slice(0, 1200);
    const mutate = (s: string, every: number, from: number) =>
      [...s].map((b, i) => (i >= from && i % every === 0 ? ({ A: 'C', C: 'G', G: 'T', T: 'A' } as Record<string, string>)[b] ?? b : b)).join('');
    const subject = (id: string, sequence: string): SequenceDocument => ({ ...puc19, id, name: id, accession: id.toUpperCase(), topology: 'linear', sequence, features: [], primers: [], history: [] });
    const activeDoc = { ...puc19, id: 'blast-query', sequence: query, topology: 'linear' as const };
    const allDocs = [
      activeDoc,
      subject('exact', query),
      subject('ninety', mutate(query, 12, 600)),
      subject('eighty', mutate(query, 5, 500)),
      subject('seventy', mutate(query, 3, 400)),
    ];
    const CLASSES = ['≥98%', '≥90%', '≥75%', '<75%'];
    const markup = renderToStaticMarkup(<BlastSearchModal activeDoc={activeDoc} allDocs={allDocs} onClose={() => {}} onSelectHitDoc={() => {}} />);

    const bars: { fill: string; identity: number }[] = [];
    const legends: Record<Theme, El[]> = { light: [], night: [] };
    for (const theme of ['light', 'night'] as const) {
      const root = parseMarkup(markup, workbench(theme));
      // The legend is the line that names the identity classes; each class's key is the innermost
      // element whose words are the class label.
      const legend = findAll(root, (e) => e.children.some((c) => typeof c === 'string' && c.includes('hits on the query')));
      expect(legend, 'one identity legend').toHaveLength(1);
      legends[theme] = CLASSES.map((label) => {
        const holders = findAll(legend[0], (e) => textOf(e).trim() === label);
        expect(holders.length, `the legend shows ${label}`).toBeGreaterThan(0);
        return holders.find((h) => !elementChildren(h).some((c) => textOf(c).trim() === label))!;
      });
      if (theme === 'light') {
        const overview = findAll(root, (e) => e.tag === 'svg' && e.attrs['aria-label'] === 'Query-centric view of BLAST hits');
        expect(overview, 'the query-centric view is drawn').toHaveLength(1);
        for (const g of findAll(overview[0], (e) => e.tag === 'g' && elementChildren(e).some((c) => c.tag === 'title'))) {
          const rect = elementChildren(g).find((c) => c.tag === 'rect')!;
          const title = textOf(elementChildren(g).find((c) => c.tag === 'title')!);
          bars.push({ fill: rect.attrs.fill.toLowerCase(), identity: Number(/, ([\d.]+)% identity/.exec(title)![1]) });
        }
      }
    }
    expect(bars.length, 'the search found hits to draw').toBeGreaterThan(0);

    // The labels print in Ink (Night Ink at night), readable on the result box.
    for (const theme of ['light', 'night'] as const) {
      const ink = theme === 'light' ? DESIGN_COLOURS.ink : DESIGN_COLOURS['night-ink'];
      for (const key of legends[theme]) {
        const label = textOf(key).trim();
        expect(hexOf(textColour(key)), `${theme} ${label} text`).toBe(ink);
        expect(contrast(textColour(key), backdrop(key)), `${theme} ${label} contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }

    // Beside each label, a swatch (no text, hidden from assistive technology) carries the hue.
    const hueOf: Record<string, string> = {};
    for (const key of legends.light) {
      const label = textOf(key).trim();
      const swatches = elementChildren(key).filter((c) => textOf(c).trim() === '' && !!(inlineStyle(c).background ?? inlineStyle(c)['background-color']));
      expect(swatches, `${label} has one swatch`).toHaveLength(1);
      expect(textOf(swatches[0]).trim(), `${label}'s swatch is not text`).toBe('');
      expect(swatches[0].attrs['aria-hidden'], `${label}'s swatch is hidden from assistive technology`).toBe('true');
      const hue = inlineStyle(swatches[0]).background ?? inlineStyle(swatches[0])['background-color'];
      expect(hue, `${label}'s swatch carries a hue`).toMatch(/^#[0-9a-f]{6}$/i);
      hueOf[label] = hue.toLowerCase();
    }
    expect(new Set(Object.values(hueOf)).size, 'four distinct class hues').toBe(4);

    // Every bar takes the hue of its identity class's swatch.
    const classOf = (id: number) => (id >= 98 ? '≥98%' : id >= 90 ? '≥90%' : id >= 75 ? '≥75%' : '<75%');
    for (const bar of bars) expect(bar.fill, `a ${bar.identity}% hit's bar`).toBe(hueOf[classOf(bar.identity)]);
    expect(new Set(bars.map((b) => classOf(b.identity))).size, 'the hits cover more than one class').toBeGreaterThan(1);
  });

  it('sets no stylesheet text below 11px', () => {
    // Every definition of each custom property is a candidate value, so the smallest is checked.
    const defs = new Map<string, string[]>();
    for (const r of parseRules(APP_CSS.replace(/@media[^{]*\{/g, '@supports (x) {'))) {
      for (const d of r.decls) if (d.prop.startsWith('--')) defs.set(d.prop, [...(defs.get(d.prop) ?? []), d.value]);
    }
    const sizesOf = (value: string, seen = new Set<string>()): string[] => {
      const m = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/.exec(value);
      if (!m) return [value];
      if (seen.has(m[1])) throw new Error(`${m[1]} refers to itself`);
      const options = defs.get(m[1]) ?? (m[2] !== undefined ? [m[2]] : []);
      if (!options.length) throw new Error(`${m[1]} is never defined`);
      return options.flatMap((o) => sizesOf(value.replace(m[0], o), new Set([...seen, m[1]])));
    };
    // All rules, in every at-rule (a narrow-window or print rule is still text someone reads).
    const all: { selector: string; value: string; line: number }[] = [];
    const text = APP_CSS;
    for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
      const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
      if (selector.startsWith('@')) continue;
      for (const d of m[2].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
        const colon = d.indexOf(':');
        if (colon < 0) continue;
        const prop = d.slice(0, colon).trim().toLowerCase();
        const value = d.slice(colon + 1).trim().replace(/\s*!important$/, '');
        if (prop === 'font-size') all.push({ selector, value, line: text.slice(0, m.index).split('\n').length });
        if (prop === 'font') {
          const size = /(?:^|\s)((?:var|calc|clamp)\([^)]*\)+|[\d.]+(?:px|rem))(?:\s*\/|\s+[^\s]+$)/.exec(value)?.[1];
          if (size) all.push({ selector, value: size, line: text.slice(0, m.index).split('\n').length });
        }
      }
    }
    expect(all.length).toBeGreaterThan(300);
    const below: string[] = [];
    let smallest = Infinity;
    for (const d of all) {
      if (['inherit', 'initial', 'unset', '100%'].includes(d.value)) continue;
      for (const option of sizesOf(d.value)) {
        const v = px(option.replace(/var\(\s*--p-scale\s*(?:,\s*[\d.]+)?\)/g, () => (defs.get('--p-scale') ?? ['1']).map(Number).reduce((a, b) => Math.min(a, b)).toString()), `${d.line} ${d.selector}`);
        smallest = Math.min(smallest, v);
        if (v < 11) below.push(`${d.line} ${d.selector} { font-size: ${d.value} } = ${v}px`);
      }
    }
    expect(below).toEqual([]);
    expect(smallest).toBe(11);

    // The nine selectors the detector measured below 11px each set a size, and it is the floor or above.
    const NAMED = [
      '.mbc-msa-chip > span', '.mbc-figure-export.compact .mbc-figure-export-trigger', '.mbc-figure-export-ext', '.mbc-pw-ruler .mbc-pw-seq',
      '.mbc-summary-tick-label', '.mbc-summary-feat-label', '.mbc-aln-unaligned-badge', '.mbc-aln-zoom-unit', '.mbc-help-section',
    ];
    for (const sel of NAMED) {
      const own = all.filter((d) => splitTop(d.selector, ',').includes(sel));
      expect(own.length, `${sel} sets a font size`).toBeGreaterThan(0);
      for (const d of own) for (const option of sizesOf(d.value)) expect(px(option.replace(/var\(\s*--p-scale\s*(?:,\s*[\d.]+)?\)/g, '1'), sel), sel).toBeGreaterThanOrEqual(11);
    }
  });

  it('keeps inline interface text at 11px or more', async () => {
    /** Inline font sizes on HTML elements (SVG text excluded), below 11px. */
    const smallInline = (markup: string) => {
      const root = parseMarkup(markup, el('div'));
      const sized = findAll(root, (e) => !insideSvg(e) && e.tag !== 'svg' && inlineStyle(e)['font-size'] !== undefined);
      return {
        sized: sized.length,
        below: sized.filter((e) => px(inlineStyle(e)['font-size'], e.tag) < 11)
          .map((e) => `<${e.tag} class="${e.attrs.class ?? ''}"> ${inlineStyle(e)['font-size']} "${textOf(e).trim().slice(0, 30)}"`),
      };
    };

    // The alignment studio, its Advanced inspector opened from its own tab, its ruler-number
    // setting typed into and restored, all through the handlers its render hands its elements.
    const doc = alignedDoc();
    const seen: number[] = [];
    let step = 0;
    let rulerInput: Record<string, unknown> | null = null;
    probe.onElement = (type, props) => {
      if (type === 'button' && props.role === 'tab' && props['aria-label'] === 'Advanced' && step === 0) {
        step = 1;
        (props.onClick as () => void)();
      }
      if (type === 'label') {
        const kids = React.Children.toArray(props.children as React.ReactNode) as React.ReactElement[];
        const caption = kids.find((k) => k?.type === 'span');
        const words = caption ? React.Children.toArray((caption.props as { children?: React.ReactNode }).children).join('') : '';
        if (words === 'Ruler numbers:') {
          rulerInput = (kids.find((k) => k?.type === 'input')?.props ?? null) as Record<string, unknown> | null;
        }
      }
      if (type === 'button' && rulerInput && step >= 1 && step <= 4) {
        const kids = React.Children.toArray(props.children as React.ReactNode);
        const input = rulerInput as { value: number; onChange: (e: { target: { value: string } }) => void };
        if (kids.includes('Restore Defaults')) {
          seen.push(input.value);
          rulerInput = null;
          if (step === 1) { step = 2; input.onChange({ target: { value: '14' } }); }
          else if (step === 2) { step = 3; (props.onClick as () => void)(); }
          else if (step === 3) { step = 4; input.onChange({ target: { value: '8' } }); }
          else if (step === 4) { step = 5; }
        }
      }
    };
    const studio = renderToStaticMarkup(<SequenceAlignmentStudio documents={[doc]} activeDoc={doc} />);
    probe.onElement = null;
    expect(probe.elementsSeen, 'the element probe saw the render').toBeGreaterThan(0);
    expect(step, 'the Advanced tab opened and the ruler setting was driven').toBe(5);
    // Default 11; 14 typed; Restore Defaults gives 11; 8 typed is held at 11.
    expect(seen).toEqual([11, 14, 11, 11]);
    const rulerField = /<span>Ruler numbers:<\/span><input([^>]*)>/.exec(studio)?.[1] ?? '';
    expect(rulerField, 'the ruler-number field is drawn').not.toBe('');
    expect(/\bmin="(\d+)"/.exec(rulerField)?.[1], 'the field offers no value below 11').toBe('11');
    expect(/\bvalue="(\d+)"/.exec(rulerField)?.[1]).toBe('11');

    const ruler = findAll(parseMarkup(studio, el('div')), hasClass('mbc-aln-tick-label'));
    expect(ruler.length, 'the alignment ruler is drawn').toBeGreaterThan(0);
    for (const tick of ruler) expect(inlineStyle(tick)['font-size'], `ruler number ${textOf(tick)}`).toBe('11px');

    // The studio's virtual gel, whose caliper caption sits under the gel.
    const gel = renderToStaticMarkup(<SequenceAlignmentStudio documents={[puc19]} activeDoc={puc19} initialPrimaryTab="virtual-gel" />);
    expect(gel, 'the virtual gel is drawn with its caliper caption').toContain('Hover gel to measure mobility');
    const cloning = renderToStaticMarkup(<CloningAndGelStudio {...({ documents: SAMPLE_LIBRARY, activeDoc: puc19 } as unknown as React.ComponentProps<typeof CloningAndGelStudio>)} />);
    const app = sequenceView().html;
    expect(app, 'the App is in Sequence view').toContain('mbc-viewer-zoom-controls');

    const report: Record<string, ReturnType<typeof smallInline>> = {
      'alignment studio': smallInline(studio),
      'alignment studio virtual gel': smallInline(gel),
      'cloning studio': smallInline(cloning),
      'App sequence view': smallInline(app),
    };
    expect(report['alignment studio'].sized, 'inline sizes were found to check').toBeGreaterThan(0);
    for (const [where, r] of Object.entries(report)) expect(r.below, where).toEqual([]);
  });

  it('never draws circular map labels below 9px', () => {
    // The map at the App's smallest zoom (70%), measured at 1 pixel per unit, so labels are
    // drawn at 0.7 pixels per unit and must be at least 9 / 0.7 units.
    const plasmid = SAMPLE_LIBRARY[0]; // pET-28a(+)-eGFP: 15 features and dozens of cut sites
    const cutSites = findRestrictionCutSites(plasmid.sequence, plasmid.topology);
    const render = (zoomLevel: number) => parseMarkup(renderToStaticMarkup(
      <CircularPlasmidMap doc={plasmid} cutSites={cutSites} orfs={findORFs(plasmid.sequence, 50)} selectedRange={null}
        onSelectRange={() => {}} showOrfs showPrimers showUniqueCuttersOnly={false} zoomLevel={zoomLevel} />,
    ), el('div'));
    const floor = 9 / 0.7;
    const at70 = render(70);
    const callouts = findAll(at70, (e) => e.tag === 'g' && e.classes.has('clickable-arc') && e.attrs.role === 'button');
    const labels = callouts.map((g) => elementChildren(g).find((c) => c.tag === 'text')!);
    expect(labels.length, 'callouts are drawn').toBeGreaterThan(10);
    for (const t of labels) expect(Number(t.attrs['font-size']), `callout "${textOf(t)}"`).toBeGreaterThanOrEqual(floor - 1e-9);

    // Every other map label (ring coordinates, the identity plate) is at least 9px on screen too.
    const svg = findAll(at70, (e) => e.tag === 'svg' && e.classes.has('plasmid-svg'))[0];
    const mapTexts = findAll(svg, (e) => e.tag === 'text');
    expect(mapTexts.length).toBeGreaterThan(labels.length);
    for (const t of mapTexts) {
      // The zoom is the view group's scale (0.7); any other group scale (the plate's) multiplies in.
      const groupScale = ancestors(t).reduce((m, a) => m * (a.classes.has('plasmid-viewport-group') ? 1 : Number(/scale\(([\d.]+)\)/.exec(a.attrs.transform ?? '')?.[1] ?? 1)), 1);
      expect(Number(t.attrs['font-size']) * groupScale * 0.7, `map text "${textOf(t)}"`).toBeGreaterThanOrEqual(9 - 1e-9);
    }

    expect(circularMap.CIRCULAR_MAP_LABEL_FLOOR_PX).toBe(9);
    // The helper: at every render scale the label is at least 9px on screen, never smaller than
    // its base size, and a map drawn at or above full size keeps the base size.
    for (let s = 0.4; s <= 2.6 + 1e-9; s += 0.05) {
      for (const base of [10, 10.2, 10.4, 10.9, 11.4, 13.5]) {
        const size = circularMap.circularMapLabelSize(base, s);
        expect(size * s, `base ${base} at scale ${s.toFixed(2)}`).toBeGreaterThanOrEqual(9 - 1e-9);
        expect(size, `base ${base} at scale ${s.toFixed(2)} is not shrunk`).toBeGreaterThanOrEqual(base);
        if (base * s >= 9) expect(size, `base ${base} at scale ${s.toFixed(2)} keeps its size`).toBe(base);
      }
    }

    // Callouts that do not fit are left out, not shrunk: the larger labels keep the 24px pitch, so
    // fewer are drawn than at full size, and every one drawn keeps its full height of hit area.
    const at140 = render(140);
    const count140 = findAll(at140, (e) => e.tag === 'g' && e.classes.has('clickable-arc') && e.attrs.role === 'button').length;
    expect(callouts.length, 'fewer callouts at 70% than at 140%').toBeLessThan(count140);
    // WCAG 2.5.8 (Target Size, Minimum): 24 CSS px, written here, not read from the module, so a
    // smaller constant in the component fails this test.
    const WCAG_TARGET_PX = 24;
    const pitch = WCAG_TARGET_PX / 0.7;
    for (const side of ['start', 'end']) {
      const ys = labels.filter((t) => t.attrs['text-anchor'] === side).map((t) => Number(t.attrs.y)).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], `${side} callouts ${i - 1}/${i}`).toBeGreaterThanOrEqual(pitch - 0.01);
    }
    // The enlarged identity plate (top-left corner) sits above the left column, never over a label.
    const plate = findAll(svg, (e) => e.tag === 'g' && /^translate\(18, 20\)/.test(e.attrs.transform ?? ''))[0];
    expect(plate, 'the identity plate is drawn at 70%').toBeDefined();
    const plateBottom = 20 + 54 * Number(/scale\(([\d.]+)\)/.exec(plate.attrs.transform)?.[1] ?? 1);
    for (const t of labels.filter((l) => l.attrs['text-anchor'] === 'end')) {
      expect(Number(t.attrs.y) - Number(t.attrs['font-size']) / 2, `left callout "${textOf(t)}" clears the plate`).toBeGreaterThanOrEqual(plateBottom);
    }
    for (const g of callouts) {
      const hit = elementChildren(g).find((c) => c.tag === 'rect' && c.classes.has('circular-callout-hit'));
      expect(hit, 'each callout has a hit area').toBeDefined();
      expect(Number(hit!.attrs.height) * 0.7).toBeGreaterThanOrEqual(WCAG_TARGET_PX - 0.01);
      expect(Number(hit!.attrs.width) * 0.7).toBeGreaterThanOrEqual(WCAG_TARGET_PX - 0.01);
    }
  });

  // The default pUC19 map as the Sequence view draws it (ORFs, primers and single cutters on), at
  // the screen pixels per map unit Chromium measured for it at 100% zoom (the smaller of light and
  // night): Split view at 1440x900 and 1280x800, and the full view (Circular View Only, project
  // table collapsed) at both. A static render measures nothing, so the zoom stands in for the
  // measured size; everything below is read in map units, where the two are the same.
  const MAP_SCALES = [
    { at: 'Split view, 1440x900', scale: 0.618 },
    { at: 'Split view, 1280x800', scale: 0.534 },
    { at: 'full view, 1440x900', scale: 0.889 },
    { at: 'full view, 1280x800', scale: 0.704 },
  ];
  const renderPuc19 = (scale: number, opts: { uniqueOnly?: boolean; cutSites?: ReturnType<typeof findRestrictionCutSites> } = {}) =>
    parseMarkup(renderToStaticMarkup(
      <CircularPlasmidMap doc={puc19} cutSites={opts.cutSites ?? findRestrictionCutSites(puc19.sequence, puc19.topology)}
        orfs={findORFs(puc19.sequence, 50, false, 1, puc19.topology === 'circular')} selectedRange={null} onSelectRange={() => {}}
        showOrfs showPrimers showUniqueCuttersOnly={opts.uniqueOnly ?? true} zoomLevel={scale * 100} />,
    ), el('div'));
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const boxesMeet = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  it('never draws circular map labels below 9px, and draws every ring coordinate whole, clear of the arcs and of its neighbours', () => {
    // Wrong implementations this catches: the round-1 map, which enlarged the coordinate labels and
    // left them centred on the old radius (103), so the ORF and feature arcs, drawn after them,
    // cover their outer digits (`2,200` reads `,200` in Split view) and `1,400` runs into `1,200`;
    // one fixed radius pulled in for the widest label, never thinned; labels seated by size but
    // never thinned; and labels seated for a one-em box, which the face's 1.252em line box overruns.
    // A coordinate label's box, as getBBox draws it: its characters at Google Sans Code's advance
    // (1200/2000 em), the font's line box tall (hhea ascent 1932 plus descent 572 per 2000; WebKit
    // gives 125.2 at 100px, Chromium 126, rounding each to whole pixels) centred on y by the central
    // baseline, grown by its canvas-coloured halo (half its stroke).
    expect(/^\s*--font-mono:\s*'Google Sans Code'/m.test(APP_CSS), 'the coordinates are set in Google Sans Code').toBe(true);
    const [cx, cy] = [340, 270];
    const ticks = circularMap.computeAdaptiveCircularTicks(puc19.sequence.length);
    const tickText = new Set(ticks.map((t) => t.label));
    expect(ticks.length, 'pUC19 has its 13 ring coordinates').toBe(13);

    // An arc's band: the annular sector its path spans, read from the path (outer and inner radii
    // of its two arcs, and the angles of its four corners), grown by half its stroke.
    const angleOf = (x: number, y: number) => ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90 + 360) % 360;
    const signed = (d: number) => ((d % 360) + 540) % 360 - 180;
    const arcBand = (p: El) => {
      const n = (p.attrs.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      // M x y A r r 0 large 1 x y L x y A r r 0 large 0 x y Z
      expect(/^M [^A]+A [^L]+L [^A]+A [^Z]+Z$/.test(p.attrs.d), `arc path ${p.attrs.d}`).toBe(true);
      const [mx, my, rOut, , , , , ax, ay, lx, ly, rIn, , , , , bx, by] = n;
      const a0 = angleOf(mx, my);
      const mid = a0 + ((angleOf(ax, ay) - a0 + 360) % 360) / 2;
      const offs = [[mx, my], [ax, ay], [lx, ly], [bx, by]].map(([x, y]) => signed(angleOf(x, y) - mid));
      const half = Number(p.attrs['stroke-width'] ?? 0) / 2;
      return { rIn: Math.min(rIn, rOut) - half, rOut: Math.max(rIn, rOut) + half, mid, lo: Math.min(...offs), hi: Math.max(...offs) };
    };
    const boxMeetsBand = (b: Box, band: ReturnType<typeof arcBand>) => {
      const far = Math.max(...[[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      if (far <= band.rIn) return false; // the whole box is inside the band's inner circle
      for (let x = b.x0; x <= b.x1 + 1e-9; x += 0.25) {
        for (let y = b.y0; y <= b.y1 + 1e-9; y += 0.25) {
          const r = Math.hypot(x - cx, y - cy);
          const off = signed(angleOf(x, y) - band.mid);
          if (r >= band.rIn && r <= band.rOut && off >= band.lo && off <= band.hi) return true;
        }
      }
      return false;
    };

    const failures: string[] = [];
    for (const { at, scale } of MAP_SCALES) {
      const svg = findAll(renderPuc19(scale), (e) => e.tag === 'svg' && e.classes.has('plasmid-svg'))[0];
      const labels = findAll(svg, (e) => e.tag === 'text' && tickText.has(textOf(e).trim()));
      const arcs = findAll(svg, (e) => e.tag === 'path' && e.classes.has('clickable-arc')).map((p) => ({ name: p.attrs['aria-label'] ?? 'ORF', band: arcBand(p) }));
      expect(arcs.length, `${at}: the 7 features and the ORFs are drawn`).toBeGreaterThan(7);
      // Thinning may label every second coordinate, never fewer.
      expect(labels.length, `${at}: ring coordinates labelled`).toBeGreaterThanOrEqual(Math.floor(ticks.length / 2));
      const boxes = labels.map((t) => {
        const size = Number(t.attrs['font-size']);
        const style = inlineStyle(t);
        expect(style['font-family'], `${at}: "${textOf(t)}" is set in the mono face`).toBe('var(--font-mono)');
        expect([t.attrs['text-anchor'], t.attrs['dominant-baseline'], style['paint-order']]).toEqual(['middle', 'central', 'stroke']);
        expect(size * scale, `${at}: "${textOf(t)}" on screen`).toBeGreaterThanOrEqual(9 - 1e-9);
        const halo = Number(style['stroke-width'] ?? 0) / 2;
        const [w, h] = [textOf(t).trim().length * 0.6 * size, MONO_LINE_EM * size];
        const [x, y] = [Number(t.attrs.x), Number(t.attrs.y)];
        return { text: textOf(t).trim(), x0: x - w / 2 - halo, x1: x + w / 2 + halo, y0: y - h / 2 - halo, y1: y + h / 2 + halo };
      });
      for (const b of boxes) {
        for (const a of arcs) if (boxMeetsBand(b, a.band)) failures.push(`${at}: "${b.text}" runs under the arc ${a.name}`);
      }
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
        if (boxesMeet(a, b)) failures.push(`${at}: "${a.text}" touches "${b.text}"`);
      }));
    }
    expect(failures).toEqual([]);

    // Longer coordinates (kb and Mb rulers) at any measured size: every corner of every label box
    // stays a third of an em inside the ORF track (r 117), which seating by the radial reach alone
    // misses, because a wide label's corners swing outward off its radius.
    for (const len of [12_345, 186_000, 4_641_652]) {
      for (let s = 0.4; s <= 1.6 + 1e-9; s += 0.05) {
        const size = circularMap.circularMapLabelSize(10, s);
        for (const t of circularMap.layoutCircularTickLabels(circularMap.computeAdaptiveCircularTicks(len), { cx, cy, fontSize: size, innerTrackRadius: 117 })) {
          const [w, h] = [t.label.length * 0.6 * size, MONO_LINE_EM * size];
          const far = Math.max(...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => Math.hypot(t.x + (sx * w) / 2 - cx, t.y + (sy * h) / 2 - cy))));
          if (far > 117 - size / 3 + 1e-6) failures.push(`${len} bp at ${s.toFixed(2)} px/unit: "${t.label}" reaches r ${far.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('never draws circular map labels below 9px, says on the map how many callouts it left out, and drops multi-cutters before single cutters', () => {
    // Wrong implementations this catches: the round-1 map, which left 13 of the base's cutter
    // callouts out (the pUC19 MCS enzymes among them) with nothing on the map saying so; a note
    // that counts only what the layout dropped, not every site the map does not label; a note
    // drawn only when the layout drops a callout; a note under the bottom callouts; and cutters
    // ranked by position alone, single and multi alike.
    const cutSites = findRestrictionCutSites(puc19.sequence, puc19.topology);
    const perEnzyme = new Map<string, number>();
    for (const c of cutSites) perEnzyme.set(c.enzyme.name, (perEnzyme.get(c.enzyme.name) ?? 0) + 1);
    const singleSites = cutSites.filter((c) => perEnzyme.get(c.enzyme.name) === 1);
    const siteSide = (c: (typeof cutSites)[number]) =>
      (cutSiteDisplayPosition(c.cutTop, puc19.sequence.length) / puc19.sequence.length) * 360 <= 180 ? 'start' : 'end';
    const calloutsOf = (svg: El) => findAll(svg, (e) => e.tag === 'g' && e.classes.has('clickable-arc') && e.attrs.role === 'button').map((g) => {
      const text = elementChildren(g).find((c) => c.tag === 'text')!;
      const hit = elementChildren(g).find((c) => c.tag === 'rect' && c.classes.has('circular-callout-hit'))!;
      const enzyme = /^Select (\S+) \(\d+\)$/.exec(g.attrs['aria-label'] ?? '')?.[1];
      return { g, side: text.attrs['text-anchor'], label: g.attrs['aria-label'].replace(/^Select /, ''), enzyme: enzyme && perEnzyme.has(enzyme) ? enzyme : null,
        hit: { x0: Number(hit.attrs.x), x1: Number(hit.attrs.x) + Number(hit.attrs.width), y0: Number(hit.attrs.y), y1: Number(hit.attrs.y) + Number(hit.attrs.height) } };
    });
    const noteOf = (svg: El) => findAll(svg, (e) => e.tag === 'text' && /\bmore\b.*\b(Restriction Analysis|Annotations|not shown)\b/.test(textOf(e)));
    const svgOf = (root: El) => findAll(root, (e) => e.tag === 'svg' && e.classes.has('plasmid-svg'))[0];

    // The note's colour, against the map's canvas, in both themes: a DESIGN.md colour at 4.5:1.
    const noteContrast = (fill: string) => (['light', 'night'] as const).map((theme) => {
      const t = chain(workbench(theme), 'div.plasmid-map-wrapper > div.plasmid-canvas-scroll > svg.plasmid-svg > text');
      const fg = parseColour(resolveIn(t, fill), `${theme} note fill`);
      return { theme, fg: hexOf(fg), ratio: contrast(fg, backdrop(t)) };
    });
    const designHexes = new Set(Object.values(DESIGN_COLOURS));

    // pUC19 has 35 single cutters and the map offers the layout at most 32 sites, single cutters
    // first, so with its own sites no multi-cutter ever reaches the layout. Without its left-hand
    // single cutters, multi-cutters do, and compete with the right-hand single cutters for the
    // right column, which is where ranking by position alone would let them in.
    const cases = [
      { name: 'single cutters', uniqueOnly: true, sites: cutSites },
      { name: 'all cutters', uniqueOnly: false, sites: cutSites },
      { name: 'all cutters, no left-hand single cutters', uniqueOnly: false, sites: cutSites.filter((c) => perEnzyme.get(c.enzyme.name)! > 1 || siteSide(c) === 'start') },
    ];
    for (const { name, uniqueOnly, sites } of cases) {
      for (const { at, scale } of MAP_SCALES) {
        const where = `${at}, ${name}`;
        const svg = svgOf(renderPuc19(scale, { uniqueOnly, cutSites: sites }));
        const callouts = calloutsOf(svg);
        const sitesShown = uniqueOnly ? sites.filter((s) => perEnzyme.get(s.enzyme.name) === 1) : sites;
        const drawnSites = callouts.filter((c) => c.enzyme).length;
        expect(drawnSites, `${where}: some cutters are labelled`).toBeGreaterThan(0);
        // pUC19's 7 features and 2 primers always come first.
        expect(callouts.filter((c) => !c.enzyme).length, `${where}: every feature and primer is labelled`).toBe(puc19.features.length + puc19.primers.length);

        // Single cutters first: on a side that leaves a single cutter out, no multi-cutter is drawn.
        for (const side of ['start', 'end']) {
          const drawn = new Set(callouts.filter((c) => c.side === side && c.enzyme).map((c) => c.label));
          const singleLeftOut = singleSites.filter((s) => siteSide(s) === side && ![...drawn].some((l) => l.startsWith(`${s.enzyme.name} (`)));
          const multiDrawn = callouts.filter((c) => c.side === side && c.enzyme && perEnzyme.get(c.enzyme)! > 1);
          if (singleLeftOut.length) expect(multiDrawn.map((c) => c.label), `${where}, ${side} column: multi-cutters drawn while ${singleLeftOut[0].enzyme.name} is left out`).toEqual([]);
        }

        // The note: there, with the exact count of sites the map does not label.
        const missing = sitesShown.length - drawnSites;
        const notes = noteOf(svg);
        expect(missing, `${where}: sites are left out`).toBeGreaterThan(0);
        expect(notes.map((n) => textOf(n)), `${where}: one note`).toEqual([`${missing} more sites in Restriction Analysis`]);
        const note = notes[0];
        const size = Number(note.attrs['font-size']);
        expect(size * scale, `${where}: the note on screen (DESIGN.md caption, 11px)`).toBeGreaterThanOrEqual(11 - 1e-9);
        expect(inlineStyle(note)['font-family'], 'the note is prose, in Google Sans').toBe('var(--font-sans)');
        for (const c of noteContrast(note.attrs.fill)) {
          expect(designHexes.has(c.fg), `${c.theme}: the note's ${c.fg} is a DESIGN.md colour`).toBe(true);
          expect(c.ratio, `${c.theme}: the note's contrast`).toBeGreaterThanOrEqual(4.5);
        }
        // It sits inside the view, clear of every callout's 24px hit area.
        const [nx, ny] = [Number(note.attrs.x), Number(note.attrs.y)];
        const noteBox = { x0: nx, x1: nx + textOf(note).length * 0.6 * size, y0: ny - size / 2, y1: ny + size / 2 };
        expect(note.attrs['dominant-baseline']).toBe('middle');
        expect(noteBox.x0 >= 0 && noteBox.x1 <= 680 && noteBox.y0 >= 0 && noteBox.y1 <= 540, `${where}: the note is inside the view`).toBe(true);
        for (const c of callouts) expect(boxesMeet(noteBox, c.hit), `${where}: the note meets the callout "${c.label}"`).toBe(false);
      }
    }

    // Nothing left out, no note: pUC19 with no cut sites at full size labels all 9 annotations.
    const quiet = svgOf(renderPuc19(1, { cutSites: [] }));
    expect(calloutsOf(quiet).length).toBe(puc19.features.length + puc19.primers.length);
    expect(noteOf(quiet).map((n) => textOf(n))).toEqual([]);

    // A site the map never offers to the layout (it labels at most 32) is counted too: 33 sites
    // spread round the ring, at a size where every callout the layout is given fits, leave one out.
    const byPosition = [...cutSites].sort((a, b) => a.cutTop - b.cutTop);
    const spread = Array.from({ length: 33 }, (_, i) => byPosition[Math.floor((i * byPosition.length) / 33)]);
    const capped = svgOf(renderPuc19(1.6, { uniqueOnly: false, cutSites: spread }));
    expect(calloutsOf(capped).filter((c) => c.enzyme).length, 'every site offered to the layout is labelled').toBe(32);
    expect(noteOf(capped).map((n) => textOf(n))).toEqual(['1 more site in Restriction Analysis']);

    // The note's other wordings: one site, features and primers (listed under Annotations), both,
    // and the short line when the full one does not fit the view.
    const note = circularMap.circularCalloutNote;
    expect([note(1, 0, 60), note(0, 2, 60), note(13, 2, 60), note(13, 2, 30), note(0, 0, 60)]).toEqual([
      '1 more site in Restriction Analysis',
      '2 more labels in Annotations',
      '13 more sites in Restriction Analysis, 2 in Annotations',
      '15 more labels not shown',
      null,
    ]);
  });

  it('counts every unique site on the identity plate', () => {
    // BG-01M6RH5N. The plate's site count is the one the inspector's Restriction Analysis list
    // gives, read from the App, which hands both the same cut sites. Wrong implementations this
    // catches: the plate counting the map's displayed slice (the 32 sites at most it offers the
    // callout layout, "32 unique sites" on pUC19's 35), every cut site rather than the single
    // cutters, and the cutters the callouts label. pUC19 reaches all three: it has more single
    // cutters than the slice holds, more cut sites than single cutters, and more single cutters
    // than the map labels, so each wrong count differs from the right one.
    const cutSites = findRestrictionCutSites(puc19.sequence, puc19.topology);
    const perEnzyme = new Map<string, number>();
    for (const c of cutSites) perEnzyme.set(c.enzyme.name, (perEnzyme.get(c.enzyme.name) ?? 0) + 1);
    const singleCutters = [...perEnzyme.values()].filter((n) => n === 1).length;

    /** pUC19 restored into the App's Sequence view (Split, 100%), single cutters only or all cutters. */
    const restore = (uniqueOnly: boolean) => {
      expect(saveWorkbenchToLocalAutosave({
        sessionName: 'Plate_Count_Session',
        documents: [puc19],
        workspace: {
          activeDocId: puc19.id, selectedFolder: 'All Project Files', navHistory: [puc19.id], navIndex: 0,
          viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
          darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
          displaySettings: {
            showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
            showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: uniqueOnly,
          },
        },
      }), 'the autosave is written').toBe(true);
      try {
        const root = parseMarkup(driveApp([(_m, d) => d('file:restore-autosave')]).html, el('div'));
        const svg = findAll(root, (e) => e.tag === 'svg' && e.classes.has('plasmid-svg'))[0];
        expect(svg, 'the circular map is drawn').toBeDefined();
        const PLATE = /^(\d+) annotations · ([\d,]+)( unique)? sites$/;
        const plates = findAll(svg, (e) => e.tag === 'text' && PLATE.test(textOf(e)));
        expect(plates.map((t) => textOf(t)), 'the identity plate is drawn, once').toHaveLength(1);
        const [, plateFeatures, plateSites, plateUnique] = PLATE.exec(textOf(plates[0]))!;
        const spans = findAll(root, (e) => e.tag === 'span').map((s) => textOf(s));
        const countIn = (label: string) => {
          const hits = spans.map((t) => new RegExp(`^${label} \\((\\d+)\\)$`).exec(t)).filter(Boolean);
          expect(hits.length, `the inspector shows "${label} (N)" once`).toBe(1);
          return Number(hits[0]![1]);
        };
        const labelled = findAll(svg, (e) => e.tag === 'g' && e.classes.has('clickable-arc') && e.attrs.role === 'button')
          .filter((g) => perEnzyme.has(/^Select (\S+) \(\d+\)$/.exec(g.attrs['aria-label'] ?? '')?.[1] ?? '')).length;
        const note = findAll(svg, (e) => e.tag === 'text' && e.classes.has('circular-callout-note')).map((t) => textOf(t));
        return {
          plate: { features: Number(plateFeatures), sites: Number(plateSites.replace(/,/g, '')), unique: Boolean(plateUnique) },
          listed: { all: countIn('Restriction Analysis'), single: countIn('Unique Single-Cutters') },
          pills: findAll(root, (e) => e.tag === 'button' && e.classes.has('mbc-enz-pill')).length,
          labelled,
          leftOut: Number((/^([\d,]+) more sites? in Restriction Analysis/.exec(note[0] ?? '')?.[1] ?? '0').replace(/,/g, '')),
        };
      } finally {
        clearWorkbenchLocalAutosave();
      }
    };

    // Single cutters: the plate gives the list's count, 35 on pUC19, not the slice, the whole set
    // or the labelled callouts, and agrees with the map's own note on what it leaves out.
    const single = restore(true);
    expect(single.plate.unique, 'the plate says unique').toBe(true);
    expect(single.listed.single, 'the Restriction Analysis list counts the single cutters it lists').toBe(single.pills);
    expect(single.listed.single, 'and they are the single cutters the App cuts pUC19 into').toBe(singleCutters);
    expect(singleCutters, "pUC19's single cutters").toBe(35);
    expect(single.plate.sites, "the plate's unique sites are the list's single cutters").toBe(single.listed.single);
    expect(single.plate.sites, "pUC19's 35").toBe(35);
    expect(single.listed.all, 'pUC19 has more cut sites than single cutters').toBeGreaterThan(single.listed.single);
    expect(single.labelled, 'the map labels some single cutters').toBeGreaterThan(0);
    expect(single.labelled, 'the map labels fewer single cutters than pUC19 has').toBeLessThan(single.listed.single);
    expect(single.labelled + single.leftOut, "the map's note leaves out the rest of the plate's count").toBe(single.plate.sites);

    // All cutters: the plate gives the list's count of every site, past the 32 the map can label.
    const all = restore(false);
    expect(all.plate.unique, 'the plate does not say unique').toBe(false);
    expect(all.listed.all, 'the App cuts pUC19 the same way').toBe(cutSites.length);
    expect(all.listed.all, 'more sites than the map offers its callouts').toBeGreaterThan(32);
    expect(all.plate.sites, "the plate's sites are the Restriction Analysis count").toBe(all.listed.all);
    expect(all.labelled + all.leftOut, "the map's note leaves out the rest of the plate's count").toBe(all.plate.sites);

    // The plate's other count, its annotations, is the document's features in both modes.
    for (const r of [single, all]) expect(r.plate.features, "the plate's annotations").toBe(puc19.features.length);
  });

  describe('says when the restriction scan is partial', () => {
    // BG-01M6RPWR. Over 150,000 bp the App scans only the first 60,000 bp, as a linear sequence,
    // and the engine scans more than 100,000 bp with its core catalog only (CORE_CATALOG_LEN
    // enzymes, a Rust constant). Every count drawn from such a scan (the map's note, the Restriction
    // Analysis header and its once-cutter list, the Hybrid Enzymes view) names what it covered, and
    // none calls an enzyme unique or a single cutter of the molecule.

    // The map's box on screen, measured with Playwright (Chromium 1248) on this branch: the
    // getBoundingClientRect() of svg.plasmid-svg at 100% zoom with the 200 kb probe restored, in
    // Split view and in the circular view alone. The map lays itself out for the box it measures,
    // and is driven here at these boxes (`measuredBox`), not at a zoom standing in for them.
    const MEASURED_MAPS = [
      { at: 'Split view, 1440x900', box: { width: 371, height: 362 } },
      { at: 'Split view, 1280x800', box: { width: 680, height: 289 } },
      { at: 'full view, 1440x900', box: { width: 680, height: 362 } },
      { at: 'full view, 1280x800', box: { width: 680, height: 289 } },
    ];
    /** Screen pixels per map unit in `box`: the 680x540 view fitted whole (preserveAspectRatio meet). */
    const scaleIn = (box: { width: number; height: number }) => Math.min(box.width / 680, box.height / 540);

    /** A seeded random DNA with no EcoRI site (GAATTC) but one at each 1-based start in `ecoRiAt`. */
    const probeDna = (length: number, ecoRiAt: number[], seed: number) => {
      let x = seed >>> 0;
      const base = () => 'ACGT'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 30];
      let seq = Array.from({ length }, base).join('');
      while (seq.includes('GAATTC')) seq = seq.replace(/GAATTC/g, 'GAATTA');
      for (const at of ecoRiAt) seq = `${seq.slice(0, at - 1)}GAATTC${seq.slice(at + 5)}`;
      return seq;
    };
    const probeDoc = (length: number, sequence: string): SequenceDocument => ({
      ...puc19, id: `probe-${length}`, name: `Probe_${length / 1000}kb`, accession: '', description: '',
      sequence, topology: 'circular', features: [], primers: [], history: [],
    });
    /** `doc` carrying `count` 1.5 kb CDS features spread around it (the review's 0, 3 and 12). */
    const withFeatures = (doc: SequenceDocument, count: number): SequenceDocument => ({
      ...doc,
      id: `${doc.id}-f${count}`,
      features: Array.from({ length: count }, (_, i) => {
        const start = 1 + Math.floor((i * doc.sequence.length) / count);
        return { id: `${doc.id}-f${i + 1}`, name: `gene${i + 1}`, type: 'CDS' as const, start, end: start + 1499, strand: (i % 2 ? -1 : 1) as 1 | -1, color: puc19.features[0].color };
      }),
    });
    type Sites = ReturnType<typeof findRestrictionCutSites>;
    const perEnzyme = (sites: Sites) => {
      const n = new Map<string, number>();
      for (const c of sites) n.set(c.enzyme.name, (n.get(c.enzyme.name) ?? 0) + 1);
      return n;
    };
    const onceIn = (sites: Sites) => [...perEnzyme(sites)].filter(([, k]) => k === 1).map(([name]) => name);
    const ecoRiAt = (sites: Sites) => sites.filter((c) => c.enzyme.name === 'EcoRI').map((c) => c.position);
    const CORE = circularMap.CORE_CATALOG_LEN;

    let built: ReturnType<typeof build> | null = null;
    const fixtures = () => (built ??= build());
    function build() {
      // The 200 kb probe: EcoRI cuts the molecule twice, at 10,001 and 100,001, so once in the first
      // 60,000 bp the App scans; the base called it a single cutter. An EcoRI site split across the
      // scan's two ends (GAA at 59,998, TTC at 1) is found by a circular scan of the 60,000 bp and
      // not by the linear one the App says it ran.
      const bigSeq = probeDna(200_000, [10_001, 100_001], 200_000);
      const big = probeDoc(200_000, `TTC${bigSeq.slice(3, 59_997)}GAA${bigSeq.slice(60_000)}`);
      const bigScan = findRestrictionCutSites(big.sequence.slice(0, 60_000), 'linear');
      // The 120 kb probe, scanned whole with the core catalog: EcoRI cuts it once, at 50,001.
      const mid = probeDoc(120_000, probeDna(120_000, [50_001], 120_000));
      const midScan = findRestrictionCutSites(mid.sequence, 'circular');
      const pucScan = findRestrictionCutSites(puc19.sequence, puc19.topology);
      return { big, bigScan, bigOnce: onceIn(bigScan), mid, midScan, midOnce: onceIn(midScan), pucScan, pucOnce: onceIn(pucScan) };
    }

    /** The circular map's markup for `doc`, laid out for `box` (none: full size) at `zoom` percent. */
    const renderMap = (doc: SequenceDocument, cutSites: Sites, opts: { uniqueOnly: boolean; scope: { firstBp?: number; coreEnzymes?: number } | null; box?: { width: number; height: number }; zoom?: number }) => {
      const root = parseMarkup(renderToStaticMarkup(
        <CircularPlasmidMap doc={doc} cutSites={cutSites} orfs={[]} selectedRange={null} onSelectRange={() => {}}
          showOrfs={false} showPrimers showUniqueCuttersOnly={opts.uniqueOnly} restrictionScope={opts.scope}
          measuredBox={opts.box} zoomLevel={opts.zoom ?? 100} />,
      ), el('div'));
      const svg = findAll(root, (e) => e.tag === 'svg' && e.classes.has('plasmid-svg'))[0];
      expect(svg, `${doc.name}: the circular map is drawn`).toBeDefined();
      const callouts = findAll(svg, (e) => e.tag === 'g' && e.classes.has('clickable-arc') && e.attrs.role === 'button').map((g) => {
        const title = textOf(elementChildren(g).find((c) => c.tag === 'title')!);
        return { g, title, enzyme: /^(\S+) \([A-Z]+\) cuts after (\d+)/.exec(title)?.[1] ?? null, feature: /^\S+ \[/.test(title) };
      });
      const plate = findAll(svg, (e) => e.tag === 'g' && /^translate\(18, 20\)/.test(e.attrs.transform ?? ''));
      expect(plate.length, `${doc.name}: at most one plate`).toBeLessThanOrEqual(1);
      return {
        svg,
        callouts,
        notes: findAll(svg, (e) => e.tag === 'text' && e.classes.has('circular-callout-note')),
        plate: plate[0] ? elementChildren(plate[0]).filter((t) => t.tag === 'text') : null,
      };
    };

    it('in the inspector, and on the plate and note of the map the App draws', () => {
      const { big, bigScan, bigOnce, mid, midScan, midOnce, pucScan, pucOnce } = fixtures();
      expect(ecoRiAt(findRestrictionCutSites(big.sequence, 'circular')), 'EcoRI cuts the 200 kb molecule twice').toEqual([10_001, 100_001]);
      expect(ecoRiAt(bigScan), 'and the first 60,000 bp once').toEqual([10_001]);
      expect(ecoRiAt(findRestrictionCutSites(big.sequence.slice(0, 60_000), 'circular')), 'which, read as a circle, would hold two').toEqual([10_001, 59_998]);
      expect(bigOnce, 'so EcoRI cuts once in the scan').toContain('EcoRI');
      const core = new Set(REBASE_ENZYMES.slice(0, CORE).map((e) => e.name));
      expect([...perEnzyme(bigScan).keys()].some((n) => !core.has(n)), 'the 60,000 bp scan uses more than the core enzymes').toBe(true);
      expect([...perEnzyme(midScan).keys()].filter((n) => !core.has(n)), 'the 120 kb scan uses the core enzymes only').toEqual([]);
      expect(midOnce, 'EcoRI cuts the 120 kb probe once').toContain('EcoRI');

      /** `doc` restored into the App's Sequence view (Split, 100%), single cutters only or all cutters. */
      const restore = (doc: SequenceDocument, uniqueOnly: boolean) => {
        expect(saveWorkbenchToLocalAutosave({
          sessionName: 'Partial_Scan_Session',
          documents: [doc],
          workspace: {
            activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
            viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
            darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
            displaySettings: {
              showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
              showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: uniqueOnly,
            },
          },
        }), 'the autosave is written').toBe(true);
        try {
          const root = parseMarkup(driveApp([(_m, d) => d('file:restore-autosave')]).html, el('div'));
          const svg = findAll(root, (e) => e.tag === 'svg' && e.classes.has('plasmid-svg'))[0];
          expect(svg, `${doc.name}: the circular map is drawn`).toBeDefined();
          // The App measures no box here, so its map is laid out at full size, where the plate fits.
          const plate = findAll(svg, (e) => e.tag === 'g' && /^translate\(18, 20\)/.test(e.attrs.transform ?? ''));
          expect(plate, `${doc.name}: the identity plate is drawn, once`).toHaveLength(1);
          const sections = findAll(root, (e) => e.classes.has('mbc-accordion-section')
            && elementChildren(e).some((h) => h.tag === 'button' && h.classes.has('mbc-accordion-header') && /^Restriction Analysis \(/.test(textOf(h))));
          expect(sections, `${doc.name}: the Restriction Analysis section is drawn, once`).toHaveLength(1);
          const section = sections[0];
          return {
            plate: elementChildren(plate[0]).filter((t) => t.tag === 'text').map((t) => textOf(t)),
            mapNote: findAll(svg, (e) => e.tag === 'text' && e.classes.has('circular-callout-note')).map((t) => textOf(t)),
            header: textOf(elementChildren(section).find((h) => h.tag === 'button')!),
            list: findAll(section, (e) => e.tag === 'label' && e.classes.has('mbc-check-row')).map((l) => textOf(l)),
            pills: findAll(section, (e) => e.tag === 'button' && e.classes.has('mbc-enz-pill')).map((b) => /^(\S+) \(/.exec(textOf(b))?.[1]),
            notes: findAll(section, (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')),
            ticks: findAll(root, (e) => e.tag === 'line' && e.classes.has('mbc-cockpit-cutter-tick')).length,
          };
        } finally {
          clearWorkbenchLocalAutosave();
        }
      };

      // The 200 kb probe: the header, the list and the note under it name the first 60,000 bp; the
      // list still offers EcoRI, as cutting once there, not as a single cutter. The plate keeps its
      // annotation count and says "cut once", not "unique"; the map's note, handed the App's scope,
      // names the range.
      const bigOnly = restore(big, true);
      expect(bigOnly.plate, 'the plate keeps its annotation count and claims no unique site').toEqual([
        big.name, '200,000 bp · circular', `0 annotations · ${bigOnce.length} cut once`,
      ]);
      expect(bigOnly.mapNote, "the map's note names the range the App scanned").toEqual(['Cut sites: first 60,000 bp only']);
      expect(bigOnly.header).toBe(`Restriction Analysis (${bigScan.length.toLocaleString()} sites in the first 60,000 bp)`);
      expect(bigOnly.list, 'the list is named for the range it covers').toEqual([`Cutting once in the first 60,000 bp (${bigOnce.length})`]);
      expect(bigOnly.pills, 'and lists the enzymes cutting once in it').toEqual(bigOnce);
      expect(bigOnly.notes.map((p) => textOf(p))).toEqual([
        'Only the first 60,000 of 200,000 bp were scanned, as a linear sequence: an enzyme listed here may cut again past 60,000 bp.',
      ]);
      expect(bigOnly.ticks, 'the cockpit marks no unique cutter from the partial scan').toBe(0);
      const bigAll = restore(big, false);
      expect(bigAll.plate[2], 'all cutters: the plate counts every site of the scan').toBe(`0 annotations · ${bigScan.length.toLocaleString()} sites`);
      expect(bigAll.mapNote).toHaveLength(1);
      expect(bigAll.mapNote[0], "all cutters: the map's note names the range with the sites it leaves out").toMatch(/^[\d,]+ more sites in Restriction Analysis \(first 60,000 bp\)$/);
      expect(bigAll.header).toBe(bigOnly.header);

      // The 120 kb probe, scanned whole with the core enzymes: every count names the catalog. An
      // enzyme cutting once in the whole molecule is a unique cutter of it, so the plate says so.
      const midOnly = restore(mid, true);
      expect(midOnly.plate[2]).toBe(`0 annotations · ${midOnce.length} unique sites`);
      expect(midOnly.mapNote).toEqual([`Cut sites: ${CORE} core enzymes only`]);
      expect(midOnly.header).toBe(`Restriction Analysis (${midScan.length.toLocaleString()} sites from ${CORE} core enzymes)`);
      expect(midOnly.list).toEqual([`Cutting once among ${CORE} core enzymes (${midOnce.length})`]);
      expect(midOnly.notes.map((p) => textOf(p))).toEqual([`Only ${CORE} core enzymes were scanned: other enzymes may also cut this sequence.`]);
      expect(midOnly.ticks, 'the cockpit marks the unique cutters of a whole scan').toBe(Math.min(40, midOnce.length));

      // pUC19, scanned whole with the whole catalog: every label as it was.
      const pucOnly = restore(puc19, true);
      expect(pucOnly.plate[2]).toBe(`${puc19.features.length} annotations · ${pucOnce.length} unique sites`);
      expect(pucOnly.mapNote.every((t) => /^[\d,]+ more (sites? in Restriction Analysis|labels? not shown)/.test(t)), "pUC19's note names no scope").toBe(true);
      expect(pucOnly.header).toBe(`Restriction Analysis (${pucScan.length})`);
      expect(pucOnly.list).toEqual([`Unique Single-Cutters (${pucOnce.length})`]);
      expect(pucOnly.notes, 'no scope note').toEqual([]);
      expect(pucOnly.ticks, 'the cockpit marks every unique cutter').toBe(pucOnce.length);
      expect(restore(puc19, false).plate[2]).toBe(`${puc19.features.length} annotations · ${pucScan.length} sites`);

      // The edges: the engine scans more than 100,000 bp with its core enzymes, and the App scans
      // only the first 60,000 bp of more than 150,000; each side of each edge is labelled as scanned.
      expect([...perEnzyme(findRestrictionCutSites(probeDna(100_001, [], 7), 'circular')).keys()].filter((n) => !core.has(n)), 'the engine at 100,001 bp').toEqual([]);
      expect([...perEnzyme(findRestrictionCutSites(mid.sequence.slice(0, 100_000), 'linear')).keys()].some((n) => !core.has(n)), 'and at 100,000 bp').toBe(true);
      const edges: [number, string | null][] = [[100_000, null], [100_001, `from ${CORE} core enzymes`], [150_000, `from ${CORE} core enzymes`], [150_001, 'in the first 60,000 bp']];
      for (const [length, scope] of edges) {
        expect(restore(probeDoc(length, probeDna(length, [], length)), true).header, `the header at ${length.toLocaleString()} bp`)
          .toMatch(scope ? new RegExp(`^Restriction Analysis \\([\\d,]+ sites? ${scope}\\)$`) : /^Restriction Analysis \(\d+\)$/);
      }

      // The scope note in the inspector: DESIGN.md's caption size, and a DESIGN.md colour at 4.5:1 in
      // both themes, read through the cascade on the App's own ancestry.
      const designHexes = new Set(Object.values(DESIGN_COLOURS));
      for (const theme of ['light', 'night'] as const) {
        const line = [bigOnly.notes[0], ...ancestors(bigOnly.notes[0])];
        const rootAt = line.findIndex((a) => a.classes.has('mbc-workbench'));
        expect(rootAt, 'the note sits under the workbench').toBeGreaterThan(0);
        const note = chain(workbench(theme), line.slice(0, rootAt).reverse().map((a) => [a.tag, ...a.classes].join('.')).join(' > '));
        const size = cascaded(note, 'font-size');
        expect(size && px(resolveIn(note, size.value), 'scope note'), `${theme}: the scope note's size`).toBeGreaterThanOrEqual(11);
        const fg = textColour(note);
        expect(designHexes.has(hexOf(fg)), `${theme}: the scope note's ${hexOf(fg)} is a DESIGN.md colour`).toBe(true);
        expect(contrast(fg, backdrop(note)), `${theme}: the scope note's contrast`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('on the map at the measured Split and full views, with 0, 3 and 12 features', () => {
      // The review's failure: at the default Split view (371x362 at 1440x900, 680x289 at 1280x800,
      // 0.546 and 0.535 px a unit) the plate does not fit, and the note fell back to "N more labels
      // not shown", so nothing on the map named the scan's range. Wrong implementations this
      // catches: a scope only on the plate; only on the note's full line, which does not fit there;
      // a note drawn only when callouts are left out (with single cutters only, all of them fit, so
      // the base drew no note at all); a note that drops the left-out count where the line with it
      // fits; and the plate losing its annotation count, or the place it fits, to the scope.
      const { big, bigScan, mid, midScan, pucScan } = fixtures();
      const designHexes = new Set(Object.values(DESIGN_COLOURS));
      const cases = [
        { base: big, scan: bigScan, scope: { firstBp: 60_000 }, short: 'first 60,000 bp', partial: true },
        { base: mid, scan: midScan, scope: { coreEnzymes: CORE }, short: `${CORE} core enzymes`, partial: false },
      ];
      const plural = (n: number, word: string) => `${n.toLocaleString()} more ${word}${n === 1 ? '' : 's'}`;
      let platesChecked = 0;
      let countsKept = 0;
      let notesWithoutLeftOuts = 0;
      for (const { base, scan, scope, short, partial } of cases) {
        const counts = perEnzyme(scan);
        for (const features of [0, 3, 12]) {
          const doc = withFeatures(base, features);
          for (const uniqueOnly of [true, false]) {
            const shown = uniqueOnly ? scan.filter((c) => counts.get(c.enzyme.name) === 1).length : scan.length;
            for (const { at, box } of MEASURED_MAPS) {
              const where = `${doc.name}, ${features} features, ${uniqueOnly ? 'single cutters' : 'all cutters'}, ${at}`;
              const scale = scaleIn(box);
              const map = renderMap(doc, scan, { uniqueOnly, scope, box });

              // One note, naming the scope, in one of its three lines, with the exact counts left out.
              expect(map.notes.map((t) => textOf(t)), `${where}: one note`).toHaveLength(1);
              const note = map.notes[0];
              const text = textOf(note);
              const sitesLeft = shown - map.callouts.filter((c) => c.enzyme).length;
              const labelsLeft = features - map.callouts.filter((c) => c.feature).length;
              const scopeOnly = `Cut sites: ${short} only`;
              const fullLine = sitesLeft > 0 && labelsLeft > 0
                ? `${plural(sitesLeft, 'site')} in Restriction Analysis (${short}), ${labelsLeft.toLocaleString()} in Annotations`
                : sitesLeft > 0 ? `${plural(sitesLeft, 'site')} in Restriction Analysis (${short})`
                : `${plural(labelsLeft, 'label')} in Annotations; cut sites: ${short} only`;
              const shortLine = `${plural(sitesLeft + labelsLeft, 'label')} not shown, ${short} scanned`;
              const size = Number(note.attrs['font-size']);
              // The map's own measure of a line: Google Sans Code's advance (0.6 em), wider than Google Sans's average.
              const fits = (line: string) => line.length * size * 0.6 <= 680 - 36;
              if (sitesLeft + labelsLeft === 0) {
                notesWithoutLeftOuts++;
                expect(text, `${where}: nothing left out, the note is the scope`).toBe(scopeOnly);
              } else if (fits(fullLine)) {
                expect(text, `${where}: the full line fits`).toBe(fullLine);
              } else if (fits(shortLine)) {
                countsKept++;
                expect(text, `${where}: the line with the count fits`).toBe(shortLine);
              } else {
                expect(text, `${where}: the scope alone`).toBe(scopeOnly);
              }
              // Pinned to the frame: no zoomed or panned group above it, at the caption size on screen,
              // in Google Sans, inside the frame, with a canvas halo.
              expect(ancestors(note).filter((a) => a.attrs.transform).map((a) => a.attrs.transform), `${where}: the note is in the frame`).toEqual([]);
              expect(size * scale, `${where}: the note on screen (DESIGN.md caption, 11px)`).toBeGreaterThanOrEqual(11 - 1e-9);
              const style = inlineStyle(note);
              expect(style['font-family'], 'the note is prose, in Google Sans').toBe('var(--font-sans)');
              expect([style['paint-order'], style.stroke], `${where}: the note's halo`).toEqual(['stroke', 'var(--mbc-bg-canvas)']);
              const [x, y] = [Number(note.attrs.x), Number(note.attrs.y)];
              expect(x, `${where}: the note starts inside the frame`).toBeGreaterThanOrEqual(0);
              expect(x + text.length * size * 0.6, `${where}: and ends inside it`).toBeLessThanOrEqual(680);
              expect(y + size / 2, `${where}: above its bottom edge`).toBeLessThanOrEqual(540);
              if (features === 3 && uniqueOnly) {
                for (const theme of ['light', 'night'] as const) {
                  const t = chain(workbench(theme), 'div.plasmid-map-wrapper > div.plasmid-canvas-scroll > svg.plasmid-svg > text');
                  const fg = parseColour(resolveIn(t, note.attrs.fill), `${theme} note fill`);
                  expect(designHexes.has(hexOf(fg)), `${theme}: the note's ${hexOf(fg)} is a DESIGN.md colour`).toBe(true);
                  expect(contrast(fg, backdrop(t)), `${theme}: the note's contrast`).toBeGreaterThanOrEqual(4.5);
                  expect(contrast(fg, parseColour(resolveIn(t, 'var(--mbc-bg-canvas)'), `${theme} halo`)), `${theme}: the note's contrast on its halo`).toBeGreaterThanOrEqual(4.5);
                }
              }

              // The plate: drawn exactly where pUC19's is (the scope takes no room on it), with its
              // annotation count, and "unique" only for a scan of the whole molecule.
              const pucPlate = renderMap(puc19, pucScan, { uniqueOnly, scope: null, box }).plate;
              expect(Boolean(map.plate), `${where}: the plate is drawn where pUC19's is`).toBe(Boolean(pucPlate));
              if (map.plate) {
                platesChecked++;
                const word = !uniqueOnly ? 'sites' : partial ? 'cut once' : 'unique sites';
                expect(textOf(map.plate[2]), `${where}: the plate's third line`).toBe(`${features} annotations · ${shown.toLocaleString()} ${word}`);
                expect(map.plate[2].attrs['font-size'], `${where}: at the plate's size`).toBe(pucPlate![2].attrs['font-size']);
                // Google Sans's advance averages under half an em; the plate is 212 units wide and the line starts 13 in.
                expect(textOf(map.plate[2]).length * Number(map.plate[2].attrs['font-size']) * 0.5, `${where}: the line fits the plate`).toBeLessThanOrEqual(212 - 13);
              }
            }
          }
        }
      }
      expect(platesChecked, 'the plate is drawn, and checked, at the full 1440x900 view').toBeGreaterThanOrEqual(2 * 3 * 2);
      expect(countsKept, 'the note keeps its count at the Split views').toBeGreaterThan(0);
      expect(notesWithoutLeftOuts, 'a scoped map with nothing left out still has its note').toBeGreaterThan(0);

      // The review's own views, read as it read them: at the default Split view the note names the
      // range, with the count where the line fits.
      const split1440 = renderMap(withFeatures(big, 3), bigScan, { uniqueOnly: false, scope: { firstBp: 60_000 }, box: MEASURED_MAPS[0].box });
      expect(split1440.plate, 'Split view, 1440x900: no plate').toBeNull();
      expect(textOf(split1440.notes[0])).toMatch(/^[\d,]+ more labels not shown, first 60,000 bp scanned$/);
      const split1280 = renderMap(withFeatures(big, 12), bigScan, { uniqueOnly: true, scope: { firstBp: 60_000 }, box: MEASURED_MAPS[1].box });
      expect(split1280.plate, 'Split view, 1280x800: no plate').toBeNull();
      expect(textOf(split1280.notes[0])).toMatch(/first 60,000 bp/);
    });

    it('on the map at every zoom and pan, pinned to the frame', () => {
      // The note is drawn outside the zoomed and panned view group, so neither moves it out of the
      // frame. Wrong implementation this catches: the note left in the view group, which at 260%
      // draws it 500 units left of the frame, and moves it with every pan.
      const { big, bigScan } = fixtures();
      const box = MEASURED_MAPS[0].box;
      for (const zoom of [65, 100, 130, 260]) {
        const map = renderMap(withFeatures(big, 3), bigScan, { uniqueOnly: false, scope: { firstBp: 60_000 }, box, zoom });
        expect(map.notes, `${zoom}%: one note`).toHaveLength(1);
        const note = map.notes[0];
        expect(textOf(note), `${zoom}%: the note names the range`).toMatch(/first 60,000 bp/);
        expect(ancestors(note).filter((a) => a.attrs.transform).map((a) => a.attrs.transform), `${zoom}%: no view transform above the note`).toEqual([]);
        expect(findAll(map.svg, (e) => e.tag === 'g' && e.classes.has('plasmid-viewport-group') && Boolean(e.attrs.transform)).length, `${zoom}%: the view group is transformed`).toBe(zoom === 100 ? 0 : 1);
        expect(Number(note.attrs['font-size']) * scaleIn(box), `${zoom}%: the note on screen`).toBeGreaterThanOrEqual(11 - 1e-9);
        expect(Number(note.attrs.x) + textOf(note).length * Number(note.attrs['font-size']) * 0.6, `${zoom}%: inside the frame`).toBeLessThanOrEqual(680);
      }
    });

    it('and draws no cutter of a partial scan as unique', () => {
      // The map draws a unique single cutter in bold blue (a blue label and leader, a larger anchor
      // dot), as Preferences says. A scan of the first 60,000 bp cannot tell that EcoRI cuts the
      // 200 kb molecule once (it cuts it twice), so there it is drawn plain; a scan of the whole
      // molecule, with the core catalog (the 120 kb probe) or the whole one (pUC19), still draws its
      // unique cutters bold. Wrong implementations this catches: the base, which drew EcoRI bold blue
      // on the 200 kb probe; and emphasis dropped for every scoped scan, the 120 kb one with it.
      const { big, bigScan, mid, midScan, pucScan } = fixtures();
      type Callout = ReturnType<typeof renderMap>['callouts'][number];
      const looksOf = (c: Callout) => {
        const paints = findAll(c.g, () => true).flatMap((e) => [e.attrs.fill, e.attrs.stroke]).filter(Boolean);
        const dot = elementChildren(c.g).find((e) => e.tag === 'circle')!;
        return { blue: paints.includes('var(--mbc-blue)'), dot: Number(dot.attrs.r) };
      };
      const ecoRi = (map: ReturnType<typeof renderMap>, at: string) => {
        const callout = map.callouts.find((c) => c.enzyme === 'EcoRI');
        expect(callout, `${at}: EcoRI is labelled`).toBeDefined();
        return looksOf(callout!);
      };
      for (const box of [undefined, MEASURED_MAPS[0].box]) {
        const at = box ? 'Split view, 1440x900' : 'full size';
        const bigMap = renderMap(big, bigScan, { uniqueOnly: true, scope: { firstBp: 60_000 }, box });
        expect(ecoRi(bigMap, at), `${at}: EcoRI on the 200 kb probe is drawn plain`).toEqual({ blue: false, dot: 1.5 });
        const cutters = bigMap.callouts.filter((c) => c.enzyme);
        expect(cutters.length, `${at}: cutters are labelled`).toBeGreaterThan(1);
        expect(cutters.filter((c) => looksOf(c).blue || looksOf(c).dot !== 1.5).map((c) => c.enzyme), `${at}: no cutter of the partial scan is drawn as unique`).toEqual([]);
        const midMap = renderMap(mid, midScan, { uniqueOnly: true, scope: { coreEnzymes: CORE }, box });
        expect(ecoRi(midMap, at), `${at}: EcoRI cuts the whole 120 kb probe once, and is drawn so`).toEqual({ blue: true, dot: 2.1 });
        const pucCutters = renderMap(puc19, pucScan, { uniqueOnly: true, scope: null, box }).callouts.filter((c) => c.enzyme);
        expect(pucCutters.filter((c) => looksOf(c).blue && looksOf(c).dot === 2.1).length, `${at}: pUC19's labelled single cutters are drawn so`).toBeGreaterThan(0);
      }
    });

    it('in the Hybrid Enzymes view', () => {
      // The view scans the whole molecule, with the core catalog over 100,000 bp, and offered its
      // single cutters as "Unique Cutters (1)" with no word of the catalog. Wrong implementations
      // this catches: the base; a scope keyed on the App's 150,000 bp (the 120 kb probe would read
      // "Unique Cutters"); one at 100,000 bp itself; and a label with no note of what was left out.
      const { mid } = fixtures();
      const view = (doc: SequenceDocument) => {
        const root = parseMarkup(renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={doc} allDocuments={[doc]} initialSubTab="enzymes-view" />), el('div'));
        const tabs = findAll(root, (e) => e.tag === 'button' && e.classes.has('method-tab-btn')).map((b) => textOf(b));
        expect(tabs, `${doc.name}: the enzyme set tabs are drawn`).toContain('6+ Cutters');
        return { tabs, notes: findAll(root, (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')).map((p) => textOf(p)) };
      };
      const reduced = view(mid);
      expect(reduced.tabs).toContain(`Cutting once among ${CORE} core enzymes`);
      expect(reduced.tabs.filter((t) => /unique cutters/i.test(t)), 'no "Unique Cutters" tab').toEqual([]);
      expect(reduced.notes).toEqual([`Only ${CORE} core enzymes were scanned: other enzymes may also cut this sequence.`]);
      const whole = view(probeDoc(100_000, probeDna(100_000, [50_001], 100_000)));
      expect(whole.tabs, 'at 100,000 bp the whole catalog is scanned').toContain('Unique Cutters (1)');
      expect(whole.notes).toEqual([]);
      expect(view(puc19).tabs).toContain('Unique Cutters (1)');
    });

    it('with the core catalog size the engine scans', () => {
      // LC-008. The count the App names ("28 core enzymes") and the engine's slice are one fact: the
      // Rust constant CORE_CATALOG_LEN, which the engine slices by (pinned by its own unit test in
      // rebase_catalog.rs), declared once more on this side and held equal to it here.
      const rust = nodeFs.readFileSync(new URL('../../crates/molbiocraft-cloning/src/rebase_catalog.rs', import.meta.url), 'utf8');
      const declared = [...rust.matchAll(/^pub const CORE_CATALOG_LEN: usize = (\d+);$/gm)].map((m) => Number(m[1]));
      expect(declared, 'the Rust constant is declared once').toHaveLength(1);
      expect(CORE, "the App's CORE_CATALOG_LEN is the engine's").toBe(declared[0]);
      // And the engine this suite runs scans a 120 kb sequence holding one site of every core enzyme
      // with exactly those enzymes. A degenerate base is read as one concrete base it matches.
      const concrete = (rec: string) => rec.toUpperCase().replace(/[RWMDHVN]/g, 'A').replace(/[YB]/g, 'C').replace(/[SK]/g, 'G');
      const planted = REBASE_ENZYMES.map((e) => `${concrete(e.recognitionSeq)}TTTTTTTTTT`).join('');
      const found = new Set(findRestrictionCutSites(planted + 'T'.repeat(120_000 - planted.length), 'circular').map((c) => c.enzyme.name));
      expect([...found].sort()).toEqual(REBASE_ENZYMES.slice(0, CORE).map((e) => e.name).sort());

      // The words, from the one helper the map, the App and the Hybrid view share, for each scope.
      const words = circularMap.restrictionScopeWords;
      expect(words(null, 200_000)).toBeNull();
      expect(words({}, 200_000)).toBeNull();
      expect(circularMap.restrictionScanScope(200_000, 60_000)).toEqual({ firstBp: 60_000 });
      expect(circularMap.restrictionScanScope(120_000)).toEqual({ coreEnzymes: CORE });
      expect(circularMap.restrictionScanScope(100_000)).toBeNull();
      expect(words({ firstBp: 60_000 }, 200_000)).toEqual({
        sites: 'in the first 60,000 bp', once: 'in the first 60,000 bp', short: 'first 60,000 bp',
        detail: 'Only the first 60,000 of 200,000 bp were scanned, as a linear sequence: an enzyme listed here may cut again past 60,000 bp.',
      });
      expect(words({ coreEnzymes: 28 }, 120_000)).toEqual({
        sites: 'from 28 core enzymes', once: 'among 28 core enzymes', short: '28 core enzymes',
        detail: 'Only 28 core enzymes were scanned: other enzymes may also cut this sequence.',
      });
      const note = circularMap.circularCalloutNote;
      expect(note(13, 2, 80, '28 core enzymes')).toBe('13 more sites in Restriction Analysis (28 core enzymes), 2 in Annotations');
      expect(note(9_568, 3, 53, 'first 60,000 bp')).toBe('9,571 more labels not shown, first 60,000 bp scanned');
      expect(note(9_568, 3, 40, 'first 60,000 bp')).toBe('Cut sites: first 60,000 bp only');
      expect(note(0, 0, 80, 'first 60,000 bp')).toBe('Cut sites: first 60,000 bp only');
      expect(note(0, 2, 80, 'first 60,000 bp')).toBe('2 more labels in Annotations; cut sites: first 60,000 bp only');
      expect(note(0, 0, 80, null), 'a whole scan with nothing left out has no note').toBeNull();
      expect(note(13, 2, 40, null)).toBe('15 more labels not shown');
    });
  });

  it('says when a large-sequence panel covers only part of it', async () => {
    // BG-01M6RRSV. Over 150,000 bp the App finds ORFs in the first 60,000 bp only, as a linear
    // sequence, with a minimum of 120 aa when the slider is set lower, and its linear view draws cut
    // sites from a scan of the first 60,000 bp only. Over 60,000 bp the Statistics panel scaled its
    // base counts and masses up from the first 12,000 bp and counted Dam / Dcm sites in them. Now
    // the ORF counts name the range and the minimum, the linear view says where its cut sites stop
    // on every page past that point, and Statistics are computed on the whole sequence. Wrong
    // implementations this catches: the base, whose 200 kb ORF header read "N Found" under a 50 aa
    // slider, whose pages past 60,000 bp showed no sites and no word, and whose 200 kb and 120 kb
    // counts were the AT-rich first 12 kb scaled up; Statistics labelled as estimates but still
    // scaled (the counts are pinned exact); a minimum named from the slider (50 aa) rather than the
    // one used (120 aa), or a fixed 120 aa when the slider is higher (130 aa); a scope on the ORF
    // header but not its note, its minimum, the Annotations and Tracks list or the Annotations table
    // (each is pinned on its own); a cut-site note on every page of the 200 kb sequence, or on none,
    // rather than on the pages past the scan (1-1,200 and 58,801-60,000 have none; 60,001-61,200
    // and 99,601-100,800 have it); a threshold moved off 150,000 bp (both sides are pinned); exact
    // counts but Dam / Dcm counted from the engine's lists, which stop at 4,096 (a 42 kb repeat
    // holds 4,200 of each); and any of it reaching a sequence under 60,000 bp.

    /** Seeded random DNA whose first 12,000 bp are AT-rich (3 in 4 bases A or T), so a 12 kb sample is not the molecule. */
    const seededDna = (length: number, seed: number) => {
      let x = seed >>> 0;
      const next = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0);
      return Array.from({ length }, (_, i) => (i < 12_000 ? 'AATTACGT'[next() >>> 29] : 'ACGT'[next() >>> 30])).join('');
    };
    const dnaDoc = (name: string, sequence: string, topology: 'circular' | 'linear' = 'circular'): SequenceDocument => ({
      ...puc19, id: `bg-rrsv-${name}`, name, accession: '', description: '', sequence, topology, features: [], primers: [], history: [],
    });
    const big = dnaDoc('Big_200kb', seededDna(200_000, 11));
    const mid = dnaDoc('Mid_120kb', seededDna(120_000, 12));
    const small = dnaDoc('Small_50kb', seededDna(50_000, 13));
    const methylated = dnaDoc('Methylated_42kb', 'GATCCCAGGA'.repeat(4_200), 'linear');

    /** `doc` restored into the App (Split, 100%, a 50 aa slider), its linear view on the page holding `at`. */
    const restoreApp = (doc: SequenceDocument, opts: { at?: number; tab?: 'sequence-view' | 'annotations-table'; minOrfAa?: number } = {}) => {
      expect(saveWorkbenchToLocalAutosave({
        sessionName: 'Large_Panels_Session',
        documents: [doc],
        workspace: {
          activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
          viewerTab: opts.tab ?? 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
          darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: opts.at ? { start: opts.at, end: opts.at } : null,
          displaySettings: {
            showOrfs: true, minOrfAa: opts.minOrfAa ?? 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
            showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
          },
        },
      }), 'the autosave is written').toBe(true);
      // The ORFs, Annotations and Tracks and Statistics sections start closed: open each once, by
      // its own header's handler, as a click would.
      const words = (node: unknown): string => (typeof node === 'string' || typeof node === 'number' ? String(node)
        : Array.isArray(node) ? node.map(words).join('')
        : node && typeof node === 'object' && 'props' in node ? words((node as { props: { children?: unknown } }).props.children) : '');
      const opened = new Set<string>();
      probe.onElement = (type, p) => {
        if (type !== 'button' || p.className !== 'mbc-accordion-header' || p['aria-expanded'] !== false) return;
        const title = words(p.children);
        const section = /^ORFs \(/.test(title) ? 'orfs' : ['Annotations and Tracks', 'Sequence Statistics'].find((t) => t === title);
        if (section && !opened.has(section)) {
          opened.add(section);
          (p.onClick as () => void)();
        }
      };
      try {
        return parseMarkup(driveApp([(_m, d) => d('file:restore-autosave')]).html, el('div'));
      } finally {
        probe.onElement = null;
        clearWorkbenchLocalAutosave();
      }
    };
    /** What the Sequence view's panels say about `doc`. */
    const panels = (doc: SequenceDocument, opts: { at?: number; minOrfAa?: number } = {}) => {
      const root = restoreApp(doc, opts);
      const section = (title: RegExp) => {
        const found = findAll(root, (e) => e.classes.has('mbc-accordion-section')
          && elementChildren(e).some((h) => h.tag === 'button' && h.classes.has('mbc-accordion-header') && title.test(textOf(h))));
        expect(found, `${doc.name}: the ${title} section is drawn, once`).toHaveLength(1);
        return found[0];
      };
      const orfs = section(/^ORFs \(/);
      const stats = section(/^Sequence Statistics$/);
      const linear = findAll(root, (e) => e.tag === 'div' && e.classes.has('linear-seq-container'));
      expect(linear, `${doc.name}: the linear view is drawn, once`).toHaveLength(1);
      return {
        orfHeader: textOf(elementChildren(orfs).find((h) => h.tag === 'button')!),
        orfMinimum: findAll(orfs, (e) => e.classes.has('mbc-control-row')).map((r) => textOf(elementChildren(r).find((s) => s.tag === 'span')!)),
        orfNotes: findAll(orfs, (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')),
        predictedOrfs: findAll(section(/^Annotations and Tracks$/), (e) => e.tag === 'label' && e.classes.has('mbc-check-row'))
          .map((l) => textOf(l)).filter((t) => t.startsWith('Predicted ORFs')),
        stats: findAll(stats, (e) => e.classes.has('stat-kv')).map((kv) => elementChildren(kv).map((c) => textOf(c))),
        page: textOf(findAll(linear[0], (e) => e.classes.has('page-indicator'))[0]),
        cutPills: findAll(linear[0], (e) => e.tag === 'span' && e.classes.has('cut-pill')).length,
        cutNotes: findAll(linear[0], (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')),
      };
    };
    /** The Annotations table's count badge for `doc`. */
    const tableBadge = (doc: SequenceDocument) => {
      const sheet = findAll(restoreApp(doc, { tab: 'annotations-table' }), (e) => e.classes.has('mbc-annotations-sheet'));
      expect(sheet, `${doc.name}: the Annotations table is drawn, once`).toHaveLength(1);
      return findAll(sheet[0], (e) => e.tag === 'span' && e.classes.has('badge-accent')).map((b) => textOf(b));
    };

    // ── The ORF list ──
    // The 200 kb probe holds ORFs of 120 aa or more past 60,000 bp, and more of 50 aa or more than
    // of 120 in the scan, so a count named for the molecule, or for the slider's 50 aa, is wrong.
    const scanned = big.sequence.slice(0, 60_000);
    const bigOrfs = findORFs(scanned, 120, false).length;
    expect(bigOrfs, 'the first 60,000 bp hold ORFs of 120 aa or more').toBeGreaterThan(0);
    expect(findORFs(big.sequence, 120, false, 1, true).length, 'and the molecule more').toBeGreaterThan(bigOrfs);
    expect(findORFs(scanned, 50, false).length, 'and the scan more of 50 aa or more').toBeGreaterThan(bigOrfs);
    const scope = (n: number, min = 120) => `${n} of ${min} aa or more in the first 60,000 bp`;
    const bigPage1 = panels(big);
    expect(bigPage1.orfHeader).toBe(`ORFs (${scope(bigOrfs)})`);
    expect(bigPage1.orfMinimum, 'the slider names the minimum used').toEqual(['Minimum ORF Size: 50 aa (120 aa on this sequence)']);
    expect(bigPage1.orfNotes.map((p) => textOf(p))).toEqual([
      'Only the first 60,000 of 200,000 bp were scanned, as a linear sequence, for ORFs of 120 aa or more: ORFs that run past 60,000 bp are not listed.',
    ]);
    expect(bigPage1.predictedOrfs).toEqual([`Predicted ORFs (${scope(bigOrfs)})`]);
    expect(tableBadge(big)).toEqual([`0 Features • 0 Primers • ${bigOrfs} ORFs of 120 aa or more in the first 60,000 bp`]);
    // A slider above 120 aa is the minimum used, and named.
    const big130 = panels(big, { minOrfAa: 130 });
    expect(big130.orfHeader).toBe(`ORFs (${scope(findORFs(scanned, 130, false).length, 130)})`);
    expect(big130.orfMinimum).toEqual(['Minimum ORF Size: 130 aa']);
    expect(big130.orfNotes.map((p) => textOf(p))[0]).toContain('for ORFs of 130 aa or more');
    // Sequences scanned whole, at the slider's minimum, keep every label.
    const midPage1 = panels(mid);
    const smallPage1 = panels(small);
    for (const [doc, r] of [[mid, midPage1], [small, smallPage1]] as const) {
      const n = findORFs(doc.sequence, 50, false, 1, true).length;
      expect(r.orfHeader, doc.name).toBe(`ORFs (${n} Found)`);
      expect(r.orfMinimum, doc.name).toEqual(['Minimum ORF Size: 50 aa']);
      expect(r.orfNotes, `${doc.name}: no scope note`).toEqual([]);
      expect(r.predictedOrfs, doc.name).toEqual([`Predicted ORFs (${n})`]);
    }
    expect(tableBadge(small)).toEqual([`0 Features • 0 Primers • ${findORFs(small.sequence, 50, false, 1, true).length} ORFs`]);
    // The edge: 150,000 bp are scanned whole, 150,001 bp in their first 60,000.
    const edge = (length: number) => dnaDoc(`Edge_${length}`, seededDna(length, length));
    expect(panels(edge(150_000)).orfHeader, 'at 150,000 bp').toMatch(/^ORFs \(\d+ Found\)$/);
    expect(panels(edge(150_001)).orfHeader, 'at 150,001 bp').toMatch(/^ORFs \(\d+ of 120 aa or more in the first 60,000 bp\)$/);

    // ── The linear map ──
    // Its cut sites stop at 60,000 bp on the 200 kb probe: every page that reaches past that says
    // so, though the molecule has sites there, and no page before it does. The 120 kb probe is
    // scanned whole with 28 core enzymes, which every page says; under 60,000 bp, nothing.
    const CUT_NOTE_FIRST = 'Cut sites are shown for the first 60,000 bp only: the rest was not scanned.';
    const CUT_NOTE_CORE = 'Cut sites are shown for 28 core enzymes only: the whole sequence was scanned for them, and not for other enzymes.';
    const bigSites = findRestrictionCutSites(big.sequence, 'circular');
    const pages: [SequenceDocument, number | undefined, string, string | null][] = [
      [big, undefined, '1–1,200', null],
      [big, 60_000, '58,801–60,000', null],
      [big, 60_001, '60,001–61,200', CUT_NOTE_FIRST],
      [big, 100_001, '99,601–100,800', CUT_NOTE_FIRST],
      [mid, undefined, '1–1,200', CUT_NOTE_CORE],
      [mid, 100_001, '99,601–100,800', CUT_NOTE_CORE],
      [small, undefined, '1–1,200', null],
      [small, 40_001, '39,601–40,800', null],
    ];
    const drawnNotes: El[] = [];
    for (const [doc, at, page, note] of pages) {
      const r = at === undefined ? (doc === big ? bigPage1 : doc === mid ? midPage1 : smallPage1) : panels(doc, { at });
      const where = `${doc.name}, page ${page}`;
      expect(r.page, where).toBe(`${page} of ${doc.sequence.length.toLocaleString()} bp`);
      expect(r.cutNotes.map((p) => textOf(p)), where).toEqual(note ? [note] : []);
      drawnNotes.push(...r.cutNotes);
      if (note === CUT_NOTE_FIRST) {
        const [lo, hi] = page.split('–').map((n) => Number(n.replace(/,/g, '')));
        expect(r.cutPills, `${where}: no site is drawn past the scan`).toBe(0);
        expect(bigSites.filter((c) => c.position >= lo && c.position <= hi).length, `${where}: the molecule is cut there`).toBeGreaterThan(0);
      }
    }
    // The App's scan ends on a page boundary at every row length (pages of 600 to 1,200 bp); one
    // that ends inside a page marks that page too.
    const straddle = parseMarkup(renderToStaticMarkup(
      <LinearSequenceView doc={big} cutSites={[]} restrictionScope={{ firstBp: 60_500 }} selectedRange={{ start: 60_001, end: 60_001 }}
        onSelectRange={() => {}} onUpdateDocument={() => {}} />,
    ), el('div'));
    expect(textOf(findAll(straddle, hasClass('page-indicator'))[0])).toBe('60,001–61,200 of 200,000 bp');
    expect(findAll(straddle, (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')).map((p) => textOf(p)), 'a page the scan ends inside')
      .toEqual(['Cut sites are shown for the first 60,500 bp only: the rest was not scanned.']);

    // ── Statistics ──
    // Every count and mass is the whole sequence's. The probes' AT-rich first 12 kb, scaled up,
    // miss each base count and both masses, and hold fewer Dam sites than the molecule.
    for (const doc of [big, mid]) {
      const sample = analyzeSequenceComposition(doc.sequence.slice(0, 12_000));
      const whole = analyzeSequenceComposition(doc.sequence);
      const scale = doc.sequence.length / 12_000;
      for (const b of ['A', 'C', 'G', 'T'] as const) {
        expect(Math.abs(Math.round(sample.counts[b] * scale) - whole.counts[b]), `${doc.name}: ${b} scaled from 12 kb`).toBeGreaterThan(1_000);
      }
      for (const m of ['mwSsDnaDa', 'mwDsDnaDa'] as const) {
        expect((Math.round(sample[m] * scale) / 1000).toFixed(1), `${doc.name}: ${m} scaled from 12 kb`).not.toBe((whole[m] / 1000).toFixed(1));
      }
      expect(sample.damSites.length, `${doc.name}: Dam sites in 12 kb`).toBeLessThan(whole.damSites.length);
    }
    // The engine lists 4,096 Dam and Dcm sites at most; the 42 kb repeat holds 4,200 of each.
    const CAP = 4_096;
    const methylatedComposition = analyzeSequenceComposition(methylated.sequence);
    expect([methylatedComposition.damSites.length, methylatedComposition.dcmSites.length], 'the engine stops each list').toEqual([CAP, CAP]);
    const count = (seq: string, base: string) => seq.split(base).length - 1;
    const sitesOf = (seq: string, motif: RegExp) => (seq.match(motif) ?? []).length;
    expect([sitesOf(methylated.sequence, /GATC/g), sitesOf(methylated.sequence, /CC[AT]GG/g)], 'the repeat holds more').toEqual([4_200, 4_200]);
    const siteCount = (n: number) => (n >= CAP ? `at least ${CAP.toLocaleString()}` : n.toLocaleString());
    /** The Statistics panel of `doc`, from its own bases: the counts, and the whole sequence's masses and Tm. */
    const expectedStats = (doc: SequenceDocument) => {
      const s = doc.sequence;
      const [A, C, G, T] = ['A', 'C', 'G', 'T'].map((b) => count(s, b));
      const whole = analyzeSequenceComposition(s);
      expect(whole.counts, `${doc.name}: the engine's counts are the bases'`).toEqual({ A, C, G, T, N: 0 });
      const masses = biopythonDnaMassesKda(s, doc.topology === 'circular');
      return [
        ['Length:', `${s.length.toLocaleString()} bp`],
        ['%GC / %AT:', `${(((G + C) / s.length) * 100).toFixed(1)}% / ${(((A + T) / s.length) * 100).toFixed(1)}%`],
        ['dsDNA mass:', `${masses.ds} kDa`],
        ['ssDNA mass:', `${masses.ss} kDa`],
        ['Melting temp:', `${whole.meltingTempBasicC.toFixed(1)} °C`],
        ['Dam / Dcm:', `${siteCount(sitesOf(s, /GATC/g))} / ${siteCount(sitesOf(s, /CC[AT]GG/g))} sites`],
        ['A / C / G / T:', `${A} / ${C} / ${G} / ${T}`],
      ];
    };
    // Each sequence is counted in a task of its own after the render that asks (BG-01M6RTP1): ask,
    // let the count run, then read.
    for (const doc of [big, mid, small, methylated]) {
      restoreApp(doc);
      await nextTask();
      expect(panels(doc).stats, `${doc.name}: Statistics`).toEqual(expectedStats(doc));
    }

    // The notes: DESIGN.md's caption size, and a DESIGN.md colour at 4.5:1 in both themes, read
    // through the cascade (with each element's own style attribute) on the App's own ancestry.
    expect(drawnNotes.length, 'the linear notes drawn').toBe(4);
    const designHexes = new Set(Object.values(DESIGN_COLOURS));
    for (const note of [drawnNotes[0], drawnNotes[2], bigPage1.orfNotes[0]]) {
      const line = [note, ...ancestors(note)];
      const rootAt = line.findIndex((a) => a.classes.has('mbc-workbench'));
      expect(rootAt, 'the note sits under the workbench').toBeGreaterThan(0);
      for (const theme of ['light', 'night'] as const) {
        const t = line.slice(0, rootAt).reverse().reduce((parent, a) => el(a.tag, {
          ...(a.attrs.class ? { class: a.attrs.class } : {}), ...(a.attrs.style ? { style: a.attrs.style } : {}),
        }, parent), workbench(theme));
        const size = cascaded(t, 'font-size');
        expect(size && px(resolveIn(t, size.value), 'note'), `${theme}: ${textOf(note)}: size`).toBeGreaterThanOrEqual(11);
        const fg = textColour(t);
        expect(designHexes.has(hexOf(fg)), `${theme}: ${textOf(note)}: ${hexOf(fg)} is a DESIGN.md colour`).toBe(true);
        expect(contrast(fg, backdrop(t)), `${theme}: ${textOf(note)}: contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('sizes small sequence map controls to at least 24px', () => {
    const token = RULES.filter((r) => r.selectors.includes(':root')).flatMap((r) => r.decls).filter((d) => d.prop === '--mbc-control-h-sm');
    expect(token.map((d) => d.value)).toEqual(['24px']);
    const CONTROLS = [
      { name: '.cut-pill', path: 'div.linear-seq-container > div.sequence-blocks-scroll > div.seq-row-block > div.seq-track-markers > span.cut-pill' },
      { name: '.cut-pill.type2s', path: 'div.linear-seq-container > div.sequence-blocks-scroll > div.seq-row-block > div.seq-track-markers > span.cut-pill.type2s' },
      { name: '.primer-pill', path: 'div.linear-seq-container > div.sequence-blocks-scroll > div.seq-row-block > div.seq-track-markers > span.primer-pill' },
      { name: '.mbc-icon-btn', path: 'div.doc-table-toolbar > div > button.mbc-icon-btn' },
      { name: '.mbc-aln-tool-btn', path: 'div.mbc-aln-btn-group > button.mbc-aln-tool-btn' },
      { name: '.mbc-figure-export.compact .mbc-figure-export-trigger', path: 'div.circular-hud-actions > div.mbc-figure-export.compact > button.btn-secondary-sm.mbc-figure-export-trigger' },
    ];
    const failures: string[] = [];
    for (const theme of ['light', 'night'] as const) {
      for (const c of CONTROLS) {
        const target = chain(workbench(theme), c.path);
        const w = cascaded(target, 'min-block-size');
        if (!w) { failures.push(`${theme} ${c.name}: no min-block-size`); continue; }
        if (!/var\(--mbc-control-h-sm\)/.test(w.value)) failures.push(`${theme} ${c.name}: ${w.prop}: ${w.value} does not read --mbc-control-h-sm`);
        const size = px(resolveIn(target, w.value), c.name);
        if (size < 24) failures.push(`${theme} ${c.name}: ${size}px`);
        // A minimum height only holds on a box that is not inline (a flex item is blockified).
        const display = resolveIn(target, cascaded(target, 'display')?.value ?? (target.tag === 'span' ? 'inline' : 'inline-block'));
        const parentDisplay = cascaded(target.parent!, 'display')?.value ?? 'block';
        if (display === 'inline' && !/flex|grid/.test(parentDisplay)) failures.push(`${theme} ${c.name}: display inline in a ${parentDisplay} box ignores min-block-size`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('names every icon-only button in the workbench', () => {
    /** Elements with the button role, outside hidden subtrees. */
    const buttons = (root: El) => findAll(root, (e) => (e.tag === 'button' && !e.attrs.role) || e.attrs.role === 'button')
      .filter((e) => ![e, ...ancestors(e)].some((a) => a.attrs['aria-hidden'] === 'true' || 'hidden' in a.attrs || 'inert' in a.attrs || (a.tag === 'dialog' && !('open' in a.attrs)) || inlineStyle(a).display === 'none'));
    const byId = (root: El) => new Map(findAll(root, (e) => !!e.attrs.id).map((e) => [e.attrs.id, e]));
    const unnamed: string[] = [];
    let iconOnly = 0;
    let total = 0;
    // The default Sequence view (stacked split, table open), and the side-by-side split with the
    // table collapsed, which swap in the stacked-split switch and the show-table toggle.
    const renders = [sequenceView().html, sequenceView('view:split-left-right', 'view:toggle-doctable').html];
    const shown = renders.map((h) => h.includes('mbc-viewer-zoom-controls'));
    expect(shown, 'both renders are in Sequence view with the viewer header').toEqual([true, true]);
    expect(renders[1], 'the second render shows the stacked-split switch').toContain('Switch to Stacked (Top / Bottom) Split View');
    const showTable = findAll(parseMarkup(renders[1], el('div')), (e) => e.tag === 'button' && e.attrs['aria-label'] === 'Show document table');
    expect(showTable.map((b) => b.attrs['aria-expanded']), 'and the show-table toggle').toEqual(['false']);
    for (const html of renders) {
      const root = parseMarkup(html, el('div'));
      const ids = byId(root);
      for (const b of buttons(root)) {
        total++;
        if (textOf(b).trim() !== '') continue;
        iconOnly++;
        const label = (b.attrs['aria-label'] ?? '').trim();
        const labelledBy = (b.attrs['aria-labelledby'] ?? '').split(/\s+/).filter(Boolean).map((id) => ids.get(id));
        const byLabel = labelledBy.length > 0 && labelledBy.every(Boolean) && labelledBy.map((e) => textOf(e!).trim()).join(' ').trim() !== '';
        if (!label && !byLabel) unnamed.push(`<${b.tag} class="${b.attrs.class ?? ''}" title="${b.attrs.title ?? ''}">`);
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(iconOnly, 'icon-only buttons were found to check').toBeGreaterThan(20);
    expect(unnamed).toEqual([]);
  });

  it('announces displayed shortcuts with aria-keyshortcuts', () => {
    // A menu item and a checkbox item with a shortcut carry it; an item without one carries none.
    const items: MenuNode[] = [
      { kind: 'command', id: 'save-as', label: 'Save As…', shortcut: '⌥⇧⌘S', onSelect: () => {} },
      { kind: 'checkbox', id: 'find', label: 'Find Panel', checked: false, shortcut: 'Ctrl+Shift+F', onToggle: () => {} },
      { kind: 'command', id: 'plain', label: 'No Shortcut Here', onSelect: () => {} },
    ];
    const popup = parseMarkup(renderToStaticMarkup(<CascadingMenuPopup items={items} position={{ top: 0, left: 0, maxHeight: 600 }} onCloseAll={() => {}} />), el('div'));
    const row = (label: string) => findAll(popup, (e) => e.tag === 'button' && textOf(e).includes(label))[0];
    expect(row('Save As…').attrs['aria-keyshortcuts']).toBe('Alt+Shift+Meta+S');
    expect(row('Find Panel').attrs['aria-keyshortcuts']).toBe('Control+Shift+F');
    expect(row('No Shortcut Here').attrs['aria-keyshortcuts']).toBeUndefined();

    // The conversion itself.
    expect(shortcutLabelToAriaKeyshortcuts('⌥⇧⌘S')).toBe('Alt+Shift+Meta+S');
    expect(shortcutLabelToAriaKeyshortcuts('Ctrl+Shift+F')).toBe('Control+Shift+F');
    expect(shortcutLabelToAriaKeyshortcuts('⌘=')).toBe('Meta+=');
    expect(shortcutLabelToAriaKeyshortcuts('Ctrl+Alt+Shift+S')).toBe('Control+Alt+Shift+S');
    expect(shortcutLabelToAriaKeyshortcuts('⌃⇧K')).toBe('Control+Shift+K');
    expect(shortcutLabelToAriaKeyshortcuts('F1')).toBe('F1');
    expect(shortcutLabelToAriaKeyshortcuts('')).toBeUndefined();
    expect(shortcutLabelToAriaKeyshortcuts('Enter')).toBeUndefined();

    // The App's own menus, each level drawn by the menu popup: every item that shows a shortcut
    // announces it.
    const { html, menus } = sequenceView();
    const levels: MenuNode[][] = [];
    const collect = (nodes: MenuNode[]) => {
      levels.push(nodes);
      for (const n of nodes) if (n.kind === 'submenu') collect(n.children);
    };
    for (const tree of menus) collect(tree as MenuNode[]);
    let withShortcut = 0;
    for (const level of levels) {
      const drawn = parseMarkup(renderToStaticMarkup(<CascadingMenuPopup items={level} position={{ top: 0, left: 0, maxHeight: 600 }} onCloseAll={() => {}} />), el('div'));
      for (const b of findAll(drawn, (e) => e.tag === 'button' && findAll(e, (k) => k.tag === 'kbd').length > 0)) {
        withShortcut++;
        const shown = textOf(findAll(b, (k) => k.tag === 'kbd')[0]);
        expect(b.attrs['aria-keyshortcuts'], `menu item "${textOf(b).trim()}"`).toBe(shortcutLabelToAriaKeyshortcuts(shown));
      }
    }
    expect(withShortcut, 'the App menus show shortcuts').toBeGreaterThan(30);

    // The shell controls whose titles show a shortcut announce the same one.
    const root = parseMarkup(html, el('div'));
    const header = findAll(root, hasClass('mbc-viewer-zoom-controls'))[0];
    const titled = (re: RegExp, scope: El) => findAll(scope, (e) => e.tag === 'button' && re.test(e.attrs.title ?? ''));
    const CONTROLS = [
      { name: 'zoom out', re: /^Zoom Out \(/, scope: header },
      { name: 'zoom reset', re: /^Reset Zoom to 100% \(/, scope: header },
      { name: 'zoom in', re: /^Zoom In \(/, scope: header },
      { name: 'inspector', re: /Sequence View Controls Inspector \(/, scope: header },
      { name: 'Navigator', re: /^Quick Command Navigator \(/, scope: root },
    ];
    for (const c of CONTROLS) {
      const found = titled(c.re, c.scope);
      expect(found.length, `the ${c.name} control is drawn`).toBeGreaterThan(0);
      for (const b of found) {
        const shown = /\(([^()]+)\)$/.exec(b.attrs.title)![1];
        const aria = shortcutLabelToAriaKeyshortcuts(shown);
        expect(aria, `the ${c.name} title shows a shortcut`).toBeDefined();
        expect(b.attrs['aria-keyshortcuts'], `${c.name}: title "${b.attrs.title}"`).toBe(aria);
      }
    }
  });

  it('gives every alignment residue readable text in both themes', () => {
    const { colorSchemesFor, residueCellStyle, residueSolidColor } = alignmentViewModel;
    const NT = 'ACGTURYSWKMBDHVN';
    const AA = 'ACDEFGHIKLMNPQRSTVWYOUBZJX*?';
    // Every scheme the viewer offers, with the molecule type(s) that offer it, and the two the
    // type declares beyond the menus (they colour as the default palette).
    const schemes = new Map<AlignmentColorScheme, boolean[]>();
    for (const protein of [false, true]) for (const { value } of colorSchemesFor(protein)) schemes.set(value, [...(schemes.get(value) ?? []), protein]);
    schemes.set('ACGT - Base Call Quality', [false]);
    schemes.set('ACGT - # Mapped Locations', [false]);
    // Every annotation colour the sample library carries, and the extremes any colour lies between.
    const annotationColours = [...new Set(SAMPLE_LIBRARY.flatMap((d) => d.features.map((f) => f.color)).filter((c): c is string => /^#[0-9a-f]{6}$/i.test(c ?? '')))];
    const contexts = (scheme: AlignmentColorScheme, protein: boolean) => {
      const letters = [...(protein ? AA : NT)];
      const base = { scheme, isProtein: protein };
      switch (scheme) {
        case 'Similarity': return letters.flatMap((ch) => [{ ch, ctx: { ...base, refChar: ch } }, { ch, ctx: { ...base, refChar: ch === 'A' ? 'C' : 'A' } }, { ch, ctx: { ...base, refChar: '-' } }]);
        case 'By Direction': return letters.flatMap((ch) => [{ ch, ctx: { ...base, strand: 1 as const } }, { ch, ctx: { ...base, strand: -1 as const } }]);
        case 'By Translation': return ['', ...AA].map((aa) => ({ ch: 'A', ctx: { ...base, translatedAa: aa } }));
        // A short hex and a colour name, as an imported record may write them, are covered too.
        case 'By Annotation': return [undefined, ...annotationColours, '#000000', '#ffffff', '#ffff00', '#00ffff', '#808080', '#fc0', 'red'].map((c) => ({ ch: 'A', ctx: { ...base, annotationColor: c } }));
        default: return letters.map((ch) => ({ ch, ctx: base }));
      }
    };

    /** A residue cell in the alignment track, in a plain or a selected row, in a theme. */
    const cellIn = (theme: Theme, selected: boolean, style: { background: string; color: string }) => {
      const track = chain(workbench(theme), `div.mbc-aln-scroll > div.mbc-aln-body > div.mbc-aln-line${selected ? '.selected' : ''} > div.mbc-aln-track.kind-seq > div.mbc-aln-cells`);
      return el('span', { class: 'mbc-aln-cell', style: `background:${style.background};color:${style.color}` }, track);
    };
    const hueAngle = (c: RGBA) => {
      const [r, g, b] = c.slice(0, 3).map((x) => x / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min < 0.15) return null; // too grey for a hue to mean anything
      const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      return (h * 60 + 360) % 360;
    };

    const seen = new Set<string>();
    const failures: string[] = [];
    let checked = 0;
    let weakest = Infinity;
    for (const [scheme, molecules] of schemes) {
      for (const protein of molecules) {
        for (const { ch, ctx } of contexts(scheme, protein)) {
          const solid = residueSolidColor(ch, ctx);
          for (const dimmed of [false, true]) {
            const key = `${scheme}|${solid}|${dimmed}`;
            if (!solid || seen.has(key)) continue;
            seen.add(key);
            const style = residueCellStyle(ch, ctx, dimmed);
            for (const theme of ['light', 'night'] as const) {
              for (const selected of [false, true]) {
                const cell = cellIn(theme, selected, style);
                const ink = textColour(cell);
                const ground = backdrop(cell);
                const ratio = contrast(ink, ground);
                checked++;
                weakest = Math.min(weakest, ratio);
                const where = `${scheme} ${ch}${dimmed ? ' (dimmed)' : ''} ${solid} ${theme}${selected ? ' selected row' : ''}`;
                if (ratio < 4.5) failures.push(`${where}: ${hexOf(ink)} on ${hexOf(ground)} = ${ratio.toFixed(2)}:1`);
                // The residue keeps its own hue: on its wash, or in its letter where the letter carries it.
                if (!dimmed && /^#[0-9a-f]{6}$/i.test(solid)) {
                  const bg = cascaded(cell, 'background-color')!.value;
                  const wash = parseColour(resolveIn(cell, bg), where);
                  const carrier = wash[3] > 0 && scheme !== 'ACGT - Dark' ? wash : ink;
                  const [want, got] = [hueAngle(parseColour(solid, where)), hueAngle(carrier)];
                  if (want !== null && (got === null || Math.min(Math.abs(want - got), 360 - Math.abs(want - got)) > 4)) {
                    failures.push(`${where}: hue ${got === null ? 'grey' : got.toFixed(0)} is not the residue's ${want.toFixed(0)}`);
                  }
                  // A wash may thin or deepen to make the letter read, but stays near its scheme's
                  // strength (40%, Pastel 18%, Bright 100%), so the hue still marks the residue.
                  const schemeAlpha = scheme === 'ACGT - Pastel' ? 0x2e / 255 : scheme === 'ACGT - Bright' ? 1 : scheme === 'ACGT - Dark' || scheme === 'ACGT - Text' ? null : 0x66 / 255;
                  if (schemeAlpha !== null && Math.abs(wash[3] - schemeAlpha) > 0.15 + 1e-6) {
                    failures.push(`${where}: the wash is ${Math.round(wash[3] * 100)}%, not near the scheme's ${Math.round(schemeAlpha * 100)}%`);
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(seen.size, 'residue colours were checked across the schemes').toBeGreaterThan(150);
    expect(failures, `${checked} cells checked, weakest ${weakest.toFixed(2)}:1`).toEqual([]);
  });
});

// ─── BG-01M6RTHN ───

describe('large-sequence surfaces (BG-01M6RTHN)', () => {
  it('keeps the rest of the large-sequence surfaces honest', async () => {
    // BG-01M6RTHN. Over 150,000 bp the split pane scans only the first 60,000 bp for cut sites and
    // the App finds ORFs there only; the status bar's selection readout and the linear view's
    // selection quickbar took GC and Tm from the first 12,000 bp of the selection; RNA Statistics
    // gave the engine's one T count under both T and U; and the ORFs did not follow a change of
    // topology. Now the split pane's linear view says where its cut sites stop, as the main one does;
    // the circular map says its ORF arcs cover only the first 60,000 bp, at the real default Split
    // view too; both readouts are the whole selection's; RNA Statistics names U, once, and T never;
    // and the ORFs follow the topology. Each case below names the wrong implementations it catches.
    const { SplitDocumentPane } = await import('../components/SplitDocumentPane');

    /** Seeded random DNA whose first 12,000 bp are AT-rich (3 in 4 bases A or T), so a 12 kb slice is not the selection. */
    const seededDna = (length: number, seed: number) => {
      let x = seed >>> 0;
      const next = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0);
      return Array.from({ length }, (_, i) => (i < 12_000 ? 'AATTACGT'[next() >>> 29] : 'ACGT'[next() >>> 30])).join('');
    };
    const docOf = (name: string, sequence: string, extra: Partial<SequenceDocument> = {}): SequenceDocument => ({
      ...puc19, id: `bg-rthn-${name}`, name, accession: '', description: '', sequence, topology: 'circular',
      features: [], primers: [], history: [], ...extra,
    });
    // Six features in the map's upper-left quadrant (160-197.5 kb, 288-356 degrees), so the left
    // callout column is filled from its top, where the ORF scope line sits.
    const upperLeft = [160_001, 168_001, 176_001, 184_001, 190_001, 196_001].map((start, i) => ({
      id: `ul-${i + 1}`, name: `Upper_left_${i + 1}`, type: 'misc_feature' as const, start, end: start + 1_500,
      strand: 1 as const, color: puc19.features[i % puc19.features.length].color,
    }));
    const big = docOf('Big_200kb', seededDna(200_000, 21), { features: upperLeft });
    const mid = docOf('Mid_120kb', seededDna(120_000, 22));
    const whole150 = docOf('Whole_150kb', big.sequence.slice(0, 150_000));

    /** `doc` restored into the App (Split view, 100%, ORFs on, a 50 aa slider), then `then` dispatched; `open` sections opened by their own headers. */
    const restore = (doc: SequenceDocument, opts: { selectedRange?: { start: number; end: number }; showOrfs?: boolean; minOrfAa?: number; open?: string[]; then?: string[]; onElement?: (type: unknown, p: Record<string, unknown>) => void } = {}) => {
      expect(saveWorkbenchToLocalAutosave({
        sessionName: 'Large_Surfaces_Session',
        documents: [doc],
        workspace: {
          activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
          viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
          darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: opts.selectedRange ?? null,
          displaySettings: {
            showOrfs: opts.showOrfs ?? true, minOrfAa: opts.minOrfAa ?? 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
            showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
          },
        },
      }), 'the autosave is written').toBe(true);
      const words = (node: unknown): string => (typeof node === 'string' || typeof node === 'number' ? String(node)
        : Array.isArray(node) ? node.map(words).join('')
        : node && typeof node === 'object' && 'props' in node ? words((node as { props: { children?: unknown } }).props.children) : '');
      const opened = new Set<string>();
      probe.onElement = (type, p) => {
        opts.onElement?.(type, p);
        if (type !== 'button' || p.className !== 'mbc-accordion-header' || p['aria-expanded'] !== false) return;
        const title = words(p.children);
        if (opts.open?.includes(title) && !opened.has(title)) {
          opened.add(title);
          (p.onClick as () => void)();
        }
      };
      try {
        return parseMarkup(driveApp([(_m, d) => d('file:restore-autosave'), ...(opts.then ?? []).map((id) => (_m: unknown, d: (id: string) => void) => d(id))]).html, el('div'));
      } finally {
        probe.onElement = null;
        clearWorkbenchLocalAutosave();
      }
    };
    const mapOf = (root: El) => {
      const svg = findAll(root, (e) => e.tag === 'svg' && e.classes.has('plasmid-svg'));
      expect(svg, 'the circular map is drawn, once').toHaveLength(1);
      return svg[0];
    };
    // The arcs hold only ORFs of 120 aa or more (or the slider's minimum, when higher), and the map
    // says so in a second line under the range.
    const ORF_SCOPE = ['ORFs: first 60,000 bp', '(120 aa or more)'];
    const orfScopeLines = (svg: El) => findAll(svg, (e) => e.tag === 'text' && (e.classes.has('circular-orf-scope') || /^ORFs\b|aa or more/.test(textOf(e).trim()))).map((t) => textOf(t).trim());

    // ── The split pane ──
    // Its linear view says where its cut sites stop, in the main linear view's words, on a page
    // past the scan, and draws no site there though the molecule is cut there; on page 1, inside the
    // scan, it says nothing. A 120 kb sequence, scanned whole with 28 core enzymes, says so on page 1.
    // Wrong implementations: the base, which handed its linear view no scope (no note on any page);
    // a scope keyed on the scanned slice's length (60,000 bp, never partial); a scope with the range
    // but not the catalog (the 120 kb page says nothing); and a pane that names the range but scans
    // the whole molecule (sites drawn on the page it says was not scanned).
    const CUT_NOTE_FIRST = 'Cut sites are shown for the first 60,000 bp only: the rest was not scanned.';
    const CUT_NOTE_CORE = 'Cut sites are shown for 28 core enzymes only: the whole sequence was scanned for them, and not for other enzymes.';
    const splitPane = (doc: SequenceDocument, at?: number) => {
      // The pane keeps its own selection: set it once, from inside its render, as a click would.
      let moved = false;
      probe.onElement = (type, p) => {
        if (type !== LinearSequenceView || at === undefined || moved) return;
        moved = true;
        (p.onSelectRange as (r: { start: number; end: number }) => void)({ start: at, end: at });
      };
      try {
        const root = parseMarkup(renderToStaticMarkup(
          <SplitDocumentPane doc={doc} choices={[doc]} onChooseDoc={() => {}} onSwap={() => {}} onClose={() => {}} onUpdateDocument={() => {}} />,
        ), el('div'));
        const linear = findAll(root, (e) => e.tag === 'div' && e.classes.has('linear-seq-container'));
        expect(linear, `${doc.name}: the split pane draws the linear view, once`).toHaveLength(1);
        return {
          page: textOf(findAll(linear[0], hasClass('page-indicator'))[0]),
          notes: findAll(linear[0], (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')).map((p) => textOf(p)),
          pills: findAll(linear[0], (e) => e.tag === 'span' && e.classes.has('cut-pill')).length,
        };
      } finally {
        probe.onElement = null;
      }
    };
    const bigSites = findRestrictionCutSites(big.sequence, 'circular');
    const pastScan = splitPane(big, 60_001);
    expect(pastScan.page).toBe('60,001–61,200 of 200,000 bp');
    expect(pastScan.notes, 'the split pane, past the scan').toEqual([CUT_NOTE_FIRST]);
    expect(pastScan.pills, 'no site is drawn past the scan').toBe(0);
    expect(bigSites.filter((c) => c.position >= 60_001 && c.position <= 61_200).length, 'though the molecule is cut there').toBeGreaterThan(0);
    const inScan = splitPane(big);
    expect(inScan.page).toBe('1–1,200 of 200,000 bp');
    expect(inScan.notes, 'the split pane, inside the scan').toEqual([]);
    expect(inScan.pills, 'sites are drawn inside the scan').toBeGreaterThan(0);
    expect(splitPane(mid).notes, 'the split pane, 28 core enzymes').toEqual([CUT_NOTE_CORE]);
    expect(splitPane(puc19).notes, 'the split pane, pUC19 scanned whole').toEqual([]);
    // The pane and the App scan by one derivation (restrictionScannedBp and restrictionScanScope),
    // so each hands its linear view the same scope on both sides of each threshold. Wrong
    // implementations: a pane or an App with its own copy of either threshold moved (100,000 or
    // 150,000 one base off), or a catalog count other than CORE_CATALOG_LEN.
    const linearScope = (render: (onElement: (type: unknown, p: Record<string, unknown>) => void) => void) => {
      const seen: unknown[] = [];
      render((type, p) => {
        if (type === LinearSequenceView) seen.push(p.restrictionScope ?? null);
      });
      expect(seen.length, 'a linear view is drawn').toBeGreaterThan(0);
      expect(new Set(seen.map((x) => JSON.stringify(x))).size, 'every linear view drawn has one scope').toBe(1);
      return seen[0];
    };
    const { CORE_CATALOG_LEN } = circularMap;
    const thresholdSource = seededDna(150_001, 31);
    for (const [length, expected] of [
      [100_000, null],
      [100_001, { coreEnzymes: CORE_CATALOG_LEN }],
      [150_000, { coreEnzymes: CORE_CATALOG_LEN }],
      [150_001, { firstBp: 60_000 }],
    ] as const) {
      const doc = docOf(`Threshold_${length}`, thresholdSource.slice(0, length), { topology: 'linear' });
      const pane = linearScope((onElement) => {
        probe.onElement = onElement;
        try {
          renderToStaticMarkup(<SplitDocumentPane doc={doc} choices={[doc]} onChooseDoc={() => {}} onSwap={() => {}} onClose={() => {}} onUpdateDocument={() => {}} />);
        } finally {
          probe.onElement = null;
        }
      });
      const app = linearScope((onElement) => void restore(doc, { onElement }));
      expect(pane, `the split pane's scope at ${length.toLocaleString()} bp`).toEqual(expected);
      expect(app, `the App's scope at ${length.toLocaleString()} bp`).toEqual(expected);
    }
    expect(CORE_CATALOG_LEN, 'the core catalog the engine scans with (tied to rebase_catalog.rs elsewhere)').toBe(28);

    // ── The circular map's ORF arcs ──
    // The arcs come from the first 60,000 bp only, and one line on the map says so, at every
    // measured map size: Split view at 1440x900 (the default) and 1280x800, where the identity plate
    // is not drawn, and the full views. The line is DESIGN.md's caption (11px on screen, Google Sans) in a
    // DESIGN.md colour at 4.5:1 in both themes, inside the frame, clear of the ring, the plate, the
    // note and every callout and leader. Wrong implementations: the base (no line); a line drawn on
    // the plate only (gone at 1280x800 Split); a line at 11 map units (6.8px at the default Split
    // view); a line the left callout column runs under (the upper-left features fill it from the
    // top); a line keyed on the length rather than on the scope the App hands the map (the 150 kb
    // sequence, scanned whole, would carry it); one shown with the ORF track off; and an App that
    // does not hand the map the scope (the App renders below).
    const scanned = big.sequence.slice(0, 60_000);
    const bigScan = findRestrictionCutSites(scanned, 'linear');
    const bigOrfs = findORFs(scanned, 120, false);
    expect(bigOrfs.length, 'the first 60,000 bp hold ORFs of 120 aa or more').toBeGreaterThan(0);
    expect(findORFs(big.sequence, 120, false, 1, true).some((o) => Math.max(o.start, o.end) > 60_000), 'and the molecule more, past them').toBe(true);
    const MAP_SIZES = [
      { at: 'Split view, 1440x900', scale: 0.618 },
      { at: 'Split view, 1280x800', scale: 0.534 },
      { at: 'full view, 1440x900', scale: 0.889 },
      { at: 'full view, 1280x800', scale: 0.704 },
      { at: 'full size', scale: 1 },
    ];
    type Box = { x0: number; x1: number; y0: number; y1: number };
    // Boxes that touch (to rounding) do not meet.
    const meet = (a: Box, b: Box) => a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6;
    /** A middle-baseline text's box, as wide as Google Sans Code's advance (wider than Google Sans's average) and MONO_LINE_EM tall. */
    const textBox = (t: El): Box => {
      const size = Number(t.attrs['font-size']);
      const [x, y, w] = [Number(t.attrs.x), Number(t.attrs.y), textOf(t).length * size * 0.6];
      const x0 = t.attrs['text-anchor'] === 'end' ? x - w : t.attrs['text-anchor'] === 'middle' ? x - w / 2 : x;
      return { x0, x1: x0 + w, y0: y - (MONO_LINE_EM / 2) * size, y1: y + (MONO_LINE_EM / 2) * size };
    };
    const designHexes = new Set(Object.values(DESIGN_COLOURS));
    let plateHidden = 0;
    for (const { at, scale } of MAP_SIZES) {
      const svg = mapOf(parseMarkup(renderToStaticMarkup(
        <CircularPlasmidMap doc={big} cutSites={bigScan} orfs={bigOrfs} orfScope={{ firstBp: 60_000, minAa: 120 }} selectedRange={null} onSelectRange={() => {}}
          showOrfs showPrimers showUniqueCuttersOnly={false} restrictionScope={{ firstBp: 60_000 }} zoomLevel={scale * 100} />,
      ), el('div')));
      const arcs = findAll(svg, (e) => e.tag === 'path' && /^ORF Frame /.test(textOf(e)));
      expect(arcs.length, `${at}: ORF arcs are drawn`).toBeGreaterThan(0);
      for (const a of arcs) expect(Number(/\.\.(\d+),/.exec(textOf(a))?.[1]), `${at}: ${textOf(a)} ends in the scan`).toBeLessThanOrEqual(60_000);
      const lines = findAll(svg, (e) => e.tag === 'text' && e.classes.has('circular-orf-scope'));
      expect(lines.map((t) => textOf(t).trim()), `${at}: the ORF scope lines, the range and the length floor`).toEqual(ORF_SCOPE);
      for (const arc of arcs) expect(Number(/, (\d+) aa\)/.exec(textOf(arc))?.[1]), `${at}: ${textOf(arc)} is at or over the floor`).toBeGreaterThanOrEqual(120);
      let plateHiddenHere = false;
      for (const line of lines) {
        // The size on screen: the font size times every group scale above it but the zoom's, times the map's scale.
        const groupScale = ancestors(line).reduce((m, a) => m * (a.classes.has('plasmid-viewport-group') ? 1 : Number(/scale\(([\d.]+)\)/.exec(a.attrs.transform ?? '')?.[1] ?? 1)), 1);
        expect(Number(line.attrs['font-size']) * groupScale * scale, `${at}: the line on screen (DESIGN.md caption, 11px)`).toBeGreaterThanOrEqual(11 - 1e-9);
        expect(inlineStyle(line)['font-family'], `${at}: the line is prose, in Google Sans`).toBe('var(--font-sans)');
        expect(groupScale, `${at}: the line is drawn in the view's own units`).toBe(1);
        const box = textBox(line);
        expect(box.x0 >= 0 && box.x1 <= 680 && box.y0 >= 0 && box.y1 <= 540, `${at}: the line lies inside the frame (${JSON.stringify(box)})`).toBe(true);
        const nearest = { x: Math.min(Math.max(340, box.x0), box.x1), y: Math.min(Math.max(270, box.y0), box.y1) };
        expect(Math.hypot(nearest.x - 340, nearest.y - 270), `${at}: the line clears the ring and its callout knees (r 170)`).toBeGreaterThanOrEqual(170);
        const plate = findAll(svg, (e) => e.tag === 'g' && /^translate\(18, 20\)/.test(e.attrs.transform ?? ''))[0];
        if (plate) {
          const s = Number(/scale\(([\d.]+)\)/.exec(plate.attrs.transform)?.[1] ?? 1);
          expect(meet(box, { x0: 18, x1: 18 + 212 * s, y0: 20, y1: 20 + 54 * s }), `${at}: the line clears the plate`).toBe(false);
        } else {
          plateHiddenHere = true;
        }
        for (const n of findAll(svg, (e) => e.tag === 'text' && e.classes.has('circular-callout-note'))) {
          expect(meet(box, textBox(n)), `${at}: the line clears the note "${textOf(n)}"`).toBe(false);
        }
        const callouts = findAll(svg, (e) => e.tag === 'g' && e.classes.has('clickable-arc') && e.attrs.role === 'button');
        expect(callouts.filter((g) => /^Select Upper_left_/.test(g.attrs['aria-label'] ?? '')).length, `${at}: the upper-left features have callouts`).toBeGreaterThan(0);
        for (const g of callouts) {
          const hit = elementChildren(g).find((c) => c.tag === 'rect' && c.classes.has('circular-callout-hit'))!;
          const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(hit.attrs[k]));
          expect(meet(box, { x0: x, x1: x + w, y0: y, y1: y + h }), `${at}: the line clears the callout ${g.attrs['aria-label']}`).toBe(false);
          const pts = (elementChildren(g).find((c) => c.tag === 'polyline')!.attrs.points).split(' ').map((p) => p.split(',').map(Number));
          for (let i = 1; i < pts.length; i++) {
            for (let k = 0; k <= 40; k++) {
              const [lx, ly] = [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * k) / 40, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * k) / 40];
              expect(lx > box.x0 && lx < box.x1 && ly > box.y0 && ly < box.y1, `${at}: the leader of ${g.attrs['aria-label']} runs clear of the line`).toBe(false);
            }
          }
        }
        for (const theme of ['light', 'night'] as const) {
          const t = chain(workbench(theme), 'div.plasmid-map-wrapper > div.plasmid-canvas-scroll > svg.plasmid-svg > g > text');
          const fg = parseColour(resolveIn(t, line.attrs.fill), `${theme} ORF scope fill`);
          expect(designHexes.has(hexOf(fg)), `${theme}: the line's ${hexOf(fg)} is a DESIGN.md colour`).toBe(true);
          expect(contrast(fg, backdrop(t)), `${theme}: the line's contrast`).toBeGreaterThanOrEqual(4.5);
        }
      }
      if (plateHiddenHere) plateHidden++;
    }
    expect(plateHidden, 'the line is drawn where the plate is not (Split view, 1280x800)').toBeGreaterThanOrEqual(1);
    // Through the App, which hands the map the scope: the 200 kb sequence carries the line in the
    // default Split view; the 150 kb one, scanned whole, and pUC19 carry none; nor does the 200 kb
    // one with the ORF track off.
    expect(orfScopeLines(mapOf(restore(big))), 'the App, 200 kb, at the default 50 aa slider').toEqual(ORF_SCOPE);
    expect(orfScopeLines(mapOf(restore(big, { minOrfAa: 150 }))), 'the App, 200 kb, a 150 aa slider').toEqual(['ORFs: first 60,000 bp', '(150 aa or more)']);
    expect(orfScopeLines(mapOf(restore(whole150))), 'the App, 150 kb scanned whole').toEqual([]);
    expect(orfScopeLines(mapOf(restore(puc19))), 'the App, pUC19').toEqual([]);
    expect(orfScopeLines(mapOf(restore(big, { showOrfs: false }))), 'the App, 200 kb with the ORF track off').toEqual([]);

    // ── The selection readouts: the status bar's and the linear view's quickbar ──
    // Each gives the whole selection's length, GC and Tm, from its own bases. Wrong implementations:
    // the base, where both read the AT-rich first 12,000 bp (the status bar "12001 bp", and the
    // quickbar its full length beside that slice's GC, near 25%, and Tm); a readout of the whole
    // document rather than the selection (the second selection starts at 50,001); and any cap under
    // 200,000 bp. Each readout is pinned on its own.
    const readouts = (range: { start: number; end: number }, doc: SequenceDocument = big) => {
      const root = restore(doc, { selectedRange: range });
      const status = findAll(root, (e) => e.tag === 'footer' && e.classes.has('mbc-statusbar'))
        .flatMap((f) => findAll(f, (e) => e.tag === 'span' && /^Selection: /.test(textOf(e))));
      expect(status, 'the status bar reads the selection, once').toHaveLength(1);
      const quickbar = findAll(root, (e) => e.tag === 'div' && e.classes.has('seq-selection-quickbar-summary'));
      expect(quickbar, 'the linear view reads the selection, once').toHaveLength(1);
      return { status: textOf(status[0]), quickbar: elementChildren(quickbar[0]).map((c) => textOf(c)) };
    };
    /**
     * The engine's rule (analyze_sequence_composition, iupac.rs), from the bases counted here: N and
     * the other IUPAC codes count toward the length only, so GC and the Tm divide by the A/C/G/T
     * count, and the Wallace rule holds below 14 bases.
     */
    const expectedReadouts = (start: number, end: number, doc: SequenceDocument = big) => {
      const s = doc.sequence.slice(start - 1, end);
      const [A, C, G, T] = ['A', 'C', 'G', 'T'].map((b) => s.split(b).length - 1);
      const n = A + C + G + T;
      const tm = s.length < 14 ? 2 * (A + T) + 4 * (G + C) : 64.9 + (41 * (G + C - 16.4)) / n;
      const gc = (((G + C) / n) * 100).toFixed(1);
      // A span holding N or another ambiguity code has no Tm (BG-01M6SHQ0).
      const [statusTm, quickbarTm] = n < s.length ? ['n/a', 'n/a'] : [`${tm.toFixed(1)}°C`, `${tm.toFixed(1)} °C`];
      return {
        acgt: n,
        status: `Selection: ${start}..${end} (${s.length} bp | GC: ${gc}% | Tm: ${statusTm})`,
        quickbar: [`${start.toLocaleString()}..${end.toLocaleString()}`, `(${s.length.toLocaleString()} bp · GC ${gc}% · Tm ${quickbarTm})`],
      };
    };
    const slice12 = analyzeSequenceComposition(big.sequence.slice(0, 12_000));
    const whole = analyzeSequenceComposition(big.sequence);
    expect(slice12.gcPercent.toFixed(1), 'the first 12 kb are not the molecule').not.toBe(whole.gcPercent.toFixed(1));
    const all = readouts({ start: 1, end: 200_000 });
    const allExpected = expectedReadouts(1, 200_000);
    expect(allExpected.acgt, 'the 200 kb is all A, C, G and T').toBe(200_000);
    expect(all.status, 'the status bar, all 200 kb').toBe(allExpected.status);
    expect(all.quickbar, 'the quickbar, all 200 kb').toEqual(allExpected.quickbar);
    expect(allExpected.status, 'the exact GC of the 200 kb').toContain(`GC: ${((whole.counts.G + whole.counts.C) / 2_000).toFixed(1)}%`);
    const tail = readouts({ start: 50_001, end: 200_000 });
    const tailExpected = expectedReadouts(50_001, 200_000);
    expect(tailExpected.status, 'the tail is not the molecule').not.toContain(`GC: ${whole.gcPercent.toFixed(1)}%`);
    expect(tail.status, 'the status bar, the last 150 kb').toBe(tailExpected.status);
    expect(tail.quickbar, 'the quickbar, the last 150 kb').toEqual(tailExpected.quickbar);
    // N and IUPAC codes (one base in seven: N, S, W, R, Y, K, M, B, D, H, V) count toward the
    // length only in GC, in both readouts, and leave the selection no Tm, "n/a" in both
    // (BG-01M6SHQ0). Wrong implementations: a quickbar GC divided by the selection's length rather
    // than its A/C/G/T count, S counted as G or C, or W as A or T, and a Tm read for it.
    const AMBIGUOUS = 'NSWRYKMBDHVNNN';
    const iupac = docOf('Iupac_30kb', [...seededDna(30_000, 41)].map((b, i) => (i % 7 === 3 ? AMBIGUOUS[Math.floor(i / 7) % AMBIGUOUS.length] : b)).join(''), { topology: 'linear' });
    const iupacExpected = expectedReadouts(101, 20_100, iupac);
    expect(iupacExpected.acgt, 'the selection holds N and IUPAC codes').toBeLessThan(20_000 - 2_500);
    expect(new Set(iupac.sequence.slice(100, 20_100).replace(/[ACGT]/g, '')), 'every ambiguity code is in the selection').toEqual(new Set(AMBIGUOUS));
    const iupacRead = readouts({ start: 101, end: 20_100 }, iupac);
    expect(iupacRead.status, 'the status bar, N and IUPAC codes').toBe(iupacExpected.status);
    expect(iupacRead.quickbar, 'the quickbar, N and IUPAC codes').toEqual(iupacExpected.quickbar);
    // Both readouts switch to the Wallace rule below 14 bases, as the engine does: 1..13 by Wallace,
    // 1..14 by the basic formula, the same in both. Wrong implementation: a quickbar that switches at
    // 14 or fewer (1..14 by Wallace there, by the formula in the status bar).
    for (const end of [13, 14]) {
      const expected = expectedReadouts(1, end);
      const read = readouts({ start: 1, end });
      expect(read.status, `the status bar, 1..${end}`).toBe(expected.status);
      expect(read.quickbar, `the quickbar, 1..${end}`).toEqual(expected.quickbar);
    }
    {
      const s14 = big.sequence.slice(0, 14);
      const [A, C, G, T] = ['A', 'C', 'G', 'T'].map((b) => s14.split(b).length - 1);
      expect((2 * (A + T) + 4 * (G + C)).toFixed(1), 'the two rules differ on 1..14 of this fixture').not.toBe((64.9 + (41 * (G + C - 16.4)) / 14).toFixed(1));
    }

    // ── The construct cockpit ──
    // Its GC, skew and duplex Tm are the whole span's, beside "Full Span: 1..200,000 (200,000 bp)",
    // from the bases counted here, N and IUPAC codes left out. Wrong implementations: the base, which
    // read the first 4,000 bp (near 25% GC on the AT-rich head); and a span divided by its length
    // rather than its A/C/G/T count (the IUPAC fixture, whose Tm reads n/a, BG-01M6SHQ0).
    const cockpit = (doc: SequenceDocument) => {
      const bar = findAll(restore(doc), (e) => e.classes.has('mbc-cockpit-bar'));
      expect(bar, `${doc.name}: the cockpit is drawn, once`).toHaveLength(1);
      const text = textOf(bar[0]).replace(/\s+/g, ' ');
      return {
        span: /Full Span: (\S+ \([\d,]+ bp\))/.exec(text)?.[1],
        gc: /GC: ([\d.]+% \(skew [+-]?[\d.]+\))/.exec(text)?.[1],
        tm: /Duplex Tm: (n\/a|[\d.]+ °C)/.exec(text)?.[1],
      };
    };
    const expectedCockpit = (doc: SequenceDocument) => {
      const s = doc.sequence;
      const [A, C, G, T] = ['A', 'C', 'G', 'T'].map((b) => s.split(b).length - 1);
      const gcPct = Number((((G + C) / (A + C + G + T)) * 100).toFixed(1));
      const skew = Number(((G - C) / (G + C)).toFixed(3));
      return {
        span: `1..${s.length.toLocaleString()} (${s.length.toLocaleString()} bp)`,
        gc: `${gcPct}% (skew ${skew >= 0 ? `+${skew}` : skew})`,
        // A span holding N or another ambiguity code has no Tm (BG-01M6SHQ0).
        tm: A + C + G + T < s.length ? 'n/a' : `${Number((81.5 + 0.41 * gcPct - 675 / Math.min(s.length, 10_000)).toFixed(1))} °C`,
      };
    };
    const bigCockpit = expectedCockpit(big);
    expect(bigCockpit.gc, 'the 200 kb is near half GC, as Biopython counts it').toMatch(/^4[89]\.\d% /);
    expect(cockpit(big), 'the cockpit, 200 kb').toEqual(bigCockpit);
    expect(cockpit(iupac), 'the cockpit, N and IUPAC codes').toEqual(expectedCockpit(iupac));

    // ── RNA Statistics ──
    // The engine counts U as T, so an RNA names U once and T never, with each base's own count.
    // Wrong implementations: the base ("A / C / G / T / U:", the U count twice); U counted under a T
    // label; and the AT of DNA named for an RNA.
    let r = 0x5eed;
    const rnaBases = Array.from({ length: 600 }, () => 'AAAACCCGGU'[((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) >>> 16) % 10]).join('');
    const rna = docOf('Probe_RNA', rnaBases, { moleculeType: 'RNA', topology: 'linear' });
    const [rA, rC, rG, rU] = ['A', 'C', 'G', 'U'].map((b) => rnaBases.split(b).length - 1);
    expect(new Set([rA, rC, rG, rU]).size, 'each base has its own count').toBe(4);
    expect(rA + rC + rG + rU).toBe(600);
    const statsOf = (doc: SequenceDocument) => {
      const sections = findAll(restore(doc, { open: ['Sequence Statistics'] }), (e) => e.classes.has('mbc-accordion-section')
        && elementChildren(e).some((h) => h.tag === 'button' && h.classes.has('mbc-accordion-header') && textOf(h) === 'Sequence Statistics'));
      expect(sections, `${doc.name}: the Statistics section is drawn, once`).toHaveLength(1);
      return findAll(sections[0], (e) => e.classes.has('stat-kv')).map((kv) => elementChildren(kv).map((c) => textOf(c)));
    };
    statsOf(rna);
    await nextTask();
    expect(statsOf(rna), 'RNA Statistics').toEqual([
      ['Length:', '600 nt'],
      ['%GC / %AU:', `${(((rG + rC) / 600) * 100).toFixed(1)}% / ${(((rA + rU) / 600) * 100).toFixed(1)}%`],
      ['A / C / G / U:', `${rA} / ${rC} / ${rG} / ${rU}`],
    ]);

    // ── The ORFs follow the topology ──
    // The pLV EF1a sample holds an ORF across its origin: found while it is circular, not once it is
    // linear. Wrong implementation: an ORF list whose memo does not depend on the topology (the
    // header keeps the circular count after the change).
    const plv = SAMPLE_LIBRARY.find((d) => d.id === 'doc-vb-plv-ef1a')!;
    const [circularOrfs, linearOrfs] = [true, false].map((c) => findORFs(plv.sequence, 50, false, 1, c).length);
    expect(circularOrfs, 'an ORF crosses the origin').toBeGreaterThan(linearOrfs);
    const orfHeader = (root: El) => findAll(root, (e) => e.tag === 'button' && e.classes.has('mbc-accordion-header') && /^ORFs \(/.test(textOf(e))).map((b) => textOf(b));
    expect(plv.topology).toBe('circular');
    expect(orfHeader(restore(plv)), 'circular').toEqual([`ORFs (${circularOrfs} Found)`]);
    expect(orfHeader(restore(plv, { then: ['sequence:toggle-topology'] })), 'made linear').toEqual([`ORFs (${linearOrfs} Found)`]);
  });
});

// ─── BG-01M6RWDB ───

describe('construct cockpit ORF badge (BG-01M6RWDB)', () => {
  it('reads the whole selection for the cockpit ORF badge', async () => {
    // BG-01M6RWDB. The cockpit read its ORF badge (codon count, internal stops, last codon) from the
    // first 4,000 bp of a selection, and its peptide preview, cut at 12 residues, said only "…". Now
    // the badge reads the whole selection, and a cut preview names how much of how much it shows,
    // in residues: a terminal stop codon codes none. The status bar and the quickbar give no Tm
    // ("n/a") for a selection of 14 bases or more with fewer than 14 A/C/G/T, where the engine's
    // formula gives 39 N and one A as -607.5 °C and the quickbar clamped that to 0.
    const { ConstructCockpitBar } = await import('../components/ConstructCockpitBar');
    const { translateSequence } = await import('../core/bioEngine');
    // A 9,999 bp ORF (3,333 codons: ATG, 3,331 seeded sense codons, TAA); `stopsAt` puts a TGA at
    // those codon numbers, all past base 4,000.
    const SENSE = ['GCT', 'GAA', 'AAA', 'CTG', 'GGC', 'CGT', 'TCC', 'ACC', 'GTT', 'CAG', 'ATC', 'TTC', 'TGG', 'TAC', 'CAC', 'AAC'];
    const orfDna = (stopsAt: number[] = []) => {
      let x = 0x0f1;
      const codons = Array.from({ length: 3_331 }, () => SENSE[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 28]);
      for (const k of stopsAt) codons[k - 2] = 'TGA';
      return `ATG${codons.join('')}TAA`;
    };
    const docOf = (name: string, sequence: string, moleculeType: SequenceDocument['moleculeType'] = 'DNA'): SequenceDocument => ({
      ...puc19, id: `bg-rwdb-${name}`, name, accession: '', description: '', sequence, topology: 'linear', moleculeType,
      features: [], primers: [], history: [],
    });
    const cockpit = (doc: SequenceDocument, range: { start: number; end: number }) => {
      const root = parseMarkup(renderToStaticMarkup(
        <ConstructCockpitBar doc={doc} cutSites={[]} selectedRange={range} onSelectRange={() => {}} />,
      ), el('div'));
      const pill = findAll(root, (e) => e.tag === 'span' && e.classes.has('mbc-cockpit-orf-pill'));
      const preview = findAll(root, (e) => e.tag === 'span' && e.classes.has('mbc-cockpit-aa-preview'));
      expect(pill, `${doc.name}: the ORF badge is drawn once, and never for a protein`).toHaveLength(doc.moleculeType === 'Protein' ? 0 : 1);
      expect(preview, `${doc.name}: the preview is drawn, once`).toHaveLength(1);
      return { label: pill[0] && textOf(pill[0]), title: pill[0]?.attrs.title, preview: textOf(preview[0]).replace(/\s+/g, ' ').trim() };
    };

    // ── The badge, a 10 kb ORF ──
    // Wrong implementations: the base, which read the first 4,000 bp (1,333 codons and no stop codon
    // at its end, so "3n In-Frame (1333 aa)"); a last codon taken from the slice (3,998..4,000, not
    // TAA); and a codon count from the slice.
    const intact = docOf('Orf_10kb', orfDna());
    expect(intact.sequence.length).toBe(9_999);
    const whole = translateSequence(intact.sequence, 0);
    expect(whole.length, 'the whole selection codes 3,333 residues').toBe(3_333);
    expect(whole.slice(0, -1).includes('*'), 'with no internal stop').toBe(false);
    expect(intact.sequence.slice(3_997, 4_000), 'the 4,000 bp slice ends on no stop codon').not.toMatch(/^(TAA|TAG|TGA)$/);
    const read = cockpit(intact, { start: 1, end: 9_999 });
    expect(read.label, 'an intact 10 kb ORF').toBe('3n Complete ORF (ATG→Stop)');
    expect(read.title).toBe('Intact 3333-codon open reading frame starting with ATG and terminating at TAA');
    // Internal stops past base 4,000 are counted, each one. Wrong implementations: the base (none of
    // them in its slice, so "In-Frame"); and a count that stops at the first stop.
    const stopped = docOf('Orf_10kb_stops', orfDna([2_000, 3_000]));
    expect(translateSequence(stopped.sequence.slice(0, 4_000), 0).includes('*'), 'the first 4,000 bp hold no stop').toBe(false);
    expect(translateSequence(stopped.sequence, 0).slice(0, -1).split('*').length - 1, 'two stops past them').toBe(2);
    const stops = cockpit(stopped, { start: 1, end: 9_999 });
    expect(stops.label, 'two internal stops past 4,000 bp').toBe('Internal Stop (2× *)');
    expect(stops.title).toBe('Contains 2 premature stop codons in frame +1');
    // A selection that starts past the ATG (bases 334..9,999, codons 112..3,333) reads its own count:
    // 3,222 codons in the title, 3,221 residues in the label, as its last codon (TAA) codes none.
    // Wrong implementations: a codon count from the slice; and the stop counted as a residue.
    const tail = cockpit(intact, { start: 334, end: 9_999 });
    expect(tail.label, 'the last 9,666 bp, no start codon').toBe('3n In-Frame (3221 aa)');
    expect(tail.title).toBe('In-frame triplet selection (3222 codons, 0 internal stop codons)');
    // Lower case and RNA (U for T) read as the same intact ORF. Wrong implementations: a whole-span
    // read without the case folding, or without U read as T ("3n In-Frame (...)" for each, as
    // neither "atg" nor "AUG" is a start and neither "taa" nor "UAA" a stop).
    const lower = docOf('Orf_10kb_lower', orfDna().toLowerCase());
    const rna = docOf('Orf_10kb_rna', orfDna().replace(/T/g, 'U'), 'RNA');
    expect(rna.sequence.includes('T') || !rna.sequence.includes('U'), 'the RNA holds U, never T').toBe(false);
    for (const doc of [lower, rna]) {
      const r = cockpit(doc, { start: 1, end: 9_999 });
      expect(r.label, `${doc.name}: an intact 10 kb ORF`).toBe('3n Complete ORF (ATG→Stop)');
      expect(r.title, doc.name).toBe('Intact 3333-codon open reading frame starting with ATG and terminating at TAA');
      expect(r.preview, `${doc.name}: 3,332 residues, the stop codon not one`).toBe(`AA: ${whole.slice(0, 12)}… (first 12 aa of 3,332)`);
    }

    // ── The peptide preview ──
    // A cut preview says how much of how much it shows, in residues; a whole one says nothing. Wrong
    // implementations: the base's bare "…"; a total from the 4,000 bp slice (1,333); the terminal
    // stop counted as a residue (3,333, where Biopython's translate(to_stop=True) gives 3,332); a
    // stop taken off every count (12 for the 39 bp, so no label); and a label on every preview, or
    // the base's `spanLen > 36` test (37 and 38 bp code 12 residues, shown whole).
    expect(read.preview, 'the 10 kb selection').toBe(`AA: ${whole.slice(0, 12)}… (first 12 aa of 3,332)`);
    for (const end of [36, 37, 38]) {
      expect(cockpit(intact, { start: 1, end }).preview, `a ${end} bp selection, 12 residues, shown whole`).toBe(`AA: ${whole.slice(0, 12)}`);
    }
    expect(cockpit(intact, { start: 1, end: 39 }).preview, 'a 39 bp selection, 13 residues').toBe(`AA: ${whole.slice(0, 12)}… (first 12 aa of 13)`);
    // A protein's preview holds its first 18 residues and says when it is cut. Wrong
    // implementations: no total for a protein (a `previewOf` of 0, so no label on 40 residues); and
    // a label on a whole 18-residue preview.
    const protein = docOf('Protein_40aa', 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRV', 'Protein');
    expect(protein.sequence.length).toBe(40);
    expect(cockpit(protein, { start: 1, end: 40 }).preview, 'a 40-residue protein selection').toBe(`AA: ${protein.sequence.slice(0, 18)}… (first 18 aa of 40)`);
    expect(cockpit(protein, { start: 1, end: 18 }).preview, 'an 18-residue protein selection, shown whole').toBe(`AA: ${protein.sequence.slice(0, 18)}`);

    // ── The Tm of a selection with fewer than 14 A/C/G/T bases ──
    // Both readouts, through the App: the status bar's and the linear view's quickbar. The basic
    // formula holds over 14 or more A/C/G/T bases; with fewer in a selection of 14 bases or more it
    // has no answer, so each reads "n/a". Wrong implementations: the round-1 quickbar and the base
    // status bar, which print the engine's -607.5 °C for 39 N and one A; the base quickbar's 0 clamp
    // ("Tm 0.0 °C"); and an n/a that starts at 13 A/C/G/T bases or reaches 14 (the 13 and 14 cases).
    const readouts = (doc: SequenceDocument) => {
      expect(saveWorkbenchToLocalAutosave({
        sessionName: 'Tm_Domain_Session',
        documents: [doc],
        workspace: {
          activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
          viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
          darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: { start: 1, end: doc.sequence.length },
          displaySettings: {
            showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
            showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
          },
        },
      }), 'the autosave is written').toBe(true);
      try {
        const root = parseMarkup(driveApp([(_m, d) => d('file:restore-autosave')]).html, el('div'));
        const status = findAll(root, (e) => e.tag === 'footer' && e.classes.has('mbc-statusbar'))
          .flatMap((f) => findAll(f, (e) => e.tag === 'span' && /^Selection: /.test(textOf(e))));
        const quickbar = findAll(root, (e) => e.tag === 'div' && e.classes.has('seq-selection-quickbar-summary'));
        expect(status, `${doc.name}: the status bar reads the selection, once`).toHaveLength(1);
        expect(quickbar, `${doc.name}: the quickbar reads the selection, once`).toHaveLength(1);
        return { status: textOf(status[0]), quickbar: elementChildren(quickbar[0]).map((c) => textOf(c)) };
      } finally {
        clearWorkbenchLocalAutosave();
      }
    };
    const nDoc = docOf('Almost_all_N', `${'N'.repeat(20)}A${'N'.repeat(19)}`);
    expect(analyzeSequenceComposition(nDoc.sequence).meltingTempBasicC.toFixed(1), "the engine's formula, out of its range").toBe('-607.5');
    expect(readouts(nDoc), '39 N and one A').toEqual({
      status: 'Selection: 1..40 (40 bp | GC: 0.0% | Tm: n/a)',
      quickbar: ['1..40', '(40 bp · GC 0.0% · Tm n/a)'],
    });
    const thirteen = docOf('Acgt_13', `${'N'.repeat(27)}ACGTACGTACGTA`);
    expect(readouts(thirteen), '27 N and 13 A/C/G/T').toEqual({
      status: `Selection: 1..40 (40 bp | GC: ${((6 / 13) * 100).toFixed(1)}% | Tm: n/a)`,
      quickbar: ['1..40', `(40 bp · GC ${((6 / 13) * 100).toFixed(1)}% · Tm n/a)`],
    });
    // 14 A/C/G/T bases beside N have no Tm either (BG-01M6SHQ0): any base that is not A, C, G or T
    // leaves a selection none, where both read 64.9 + 41 x (7 - 16.4) / 14 = 37.4 °C.
    const fourteen = docOf('Acgt_14', `${'N'.repeat(26)}ACGTACGTACGTAC`);
    expect((64.9 + (41 * (7 - 16.4)) / 14).toFixed(1)).toBe('37.4');
    expect(readouts(fourteen), '26 N and 14 A/C/G/T').toEqual({
      status: 'Selection: 1..40 (40 bp | GC: 50.0% | Tm: n/a)',
      quickbar: ['1..40', '(40 bp · GC 50.0% · Tm n/a)'],
    });
    // Below 14 bases the Wallace rule holds, as before: 13 A/C/G/T read 2 x 7 + 4 x 6 = 38.0 °C.
    // Wrong implementation: an n/a on any selection with fewer than 14 A/C/G/T, whatever its length.
    expect(readouts(docOf('Acgt_13_only', 'ACGTACGTACGTA')), 'a 13 bp selection').toEqual({
      status: 'Selection: 1..13 (13 bp | GC: 46.2% | Tm: 38.0°C)',
      quickbar: ['1..13', '(13 bp · GC 46.2% · Tm 38.0 °C)'],
    });
  });
});

// ─── BG-01M6RTP1 ───

/**
 * The node tree React DOM's client renderer writes to, for a test that mounts the App and watches
 * it re-render (BG-01M6RTP1). The repo carries no DOM library (jsdom, happy-dom), so, as
 * US-01M6P25H's re-render test does (engineWarnings.test.tsx), the test runs `createRoot`, the
 * renderer the app itself runs, against the few node operations it uses, with a select's options
 * and an element's inline style. The App's own effects also run on mount; the element calls they
 * make here (a class list toggled, a node looked up with querySelector) do nothing and find
 * nothing. Which nodes React keeps, inserts or removes on a re-render is React's own
 * reconciliation; this only holds the nodes, so a test can ask whether a node shown before is the
 * node shown after.
 */
class ClientNode {
  childNodes: ClientNode[] = [];
  parentNode: ClientNode | null = null;
  constructor(readonly nodeType: number, readonly nodeName: string, readonly ownerDocument: ClientDocument | null) {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(t: string) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = t ? [new ClientText(t, this.ownerDocument!)] : [];
  }
  appendChild(child: ClientNode) { return this.insertBefore(child, null); }
  insertBefore(child: ClientNode, before: ClientNode | null) {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: ClientNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
}
class ClientText extends ClientNode {
  constructor(public nodeValue: string, doc: ClientDocument) { super(3, '#text', doc); }
  override get textContent() { return this.nodeValue; }
  override set textContent(t: string) { this.nodeValue = t; }
}
class ClientElement extends ClientNode {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> = { setProperty(name: string, value: string) { this[name] = value; } };
  readonly classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  constructor(readonly tagName: string, readonly namespaceURI: string, doc: ClientDocument) { super(1, tagName.toUpperCase(), doc); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  /** A select's options, which React DOM marks selected as it mounts the select. */
  get options() { return this.childNodes.filter((c) => c.nodeName === 'OPTION'); }
}
class ClientDocument extends ClientNode {
  constructor() { super(9, '#document', null); }
  createElement(tag: string) { return new ClientElement(tag, 'http://www.w3.org/1999/xhtml', this); }
  createElementNS(ns: string, tag: string) { return new ClientElement(tag, ns, this); }
  createTextNode(t: string) { return new ClientText(t, this); }
}
/** A mounted node tree as the plain-object DOM the markup tests read. */
const asEl = (node: ClientElement, parent: El | null = null): El => {
  const e = el(node.tagName, Object.fromEntries(node.attributes), parent);
  for (const c of node.childNodes) {
    if (c instanceof ClientElement) asEl(c, e);
    else if (c instanceof ClientText) e.children.push(c.nodeValue);
  }
  return e;
};

describe('Statistics masses and the whole-sequence pass (BG-01M6RTP1)', () => {
  /** Seeded bases drawn evenly from `alphabet`. */
  const seededFrom = (alphabet: string, length: number, seed: number) => {
    let x = seed >>> 0;
    const next = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0);
    return Array.from({ length }, () => alphabet[Math.floor(((next() >>> 8) / 2 ** 24) * alphabet.length)]).join('');
  };
  /** BG-01M6RRSV's generator (AT-rich first 12,000 bp), so `seededDna(200_000, 11)` is its 200 kb probe. */
  const seededDna = (length: number, seed: number) => {
    let x = seed >>> 0;
    const next = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0);
    return Array.from({ length }, (_, i) => (i < 12_000 ? 'AATTACGT'[next() >>> 29] : 'ACGT'[next() >>> 30])).join('');
  };
  const docOf = (name: string, sequence: string, topology: 'circular' | 'linear' = 'linear'): SequenceDocument => ({
    ...puc19, id: `bg-rtp1-${name}`, name, accession: '', description: '', sequence, topology, features: [], primers: [], history: [],
  });
  /** Writes `doc` as the autosave the App restores: Sequence view, Split, 100%. */
  const saveSession = (doc: SequenceDocument, at?: number) => expect(saveWorkbenchToLocalAutosave({
    sessionName: 'Statistics_Session',
    documents: [doc],
    workspace: {
      activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
      viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
      darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: at ? { start: at, end: at } : null,
      displaySettings: {
        showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
        showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
      },
    },
  }), 'the autosave is written').toBe(true);
  /** Opens the Statistics section by its own header, the first time the App draws it closed. */
  const openStatistics = () => {
    const words = (node: unknown): string => (typeof node === 'string' || typeof node === 'number' ? String(node)
      : Array.isArray(node) ? node.map(words).join('')
      : node && typeof node === 'object' && 'props' in node ? words((node as { props: { children?: unknown } }).props.children) : '');
    let opened = false;
    probe.onElement = (type, p) => {
      if (opened || type !== 'button' || p.className !== 'mbc-accordion-header' || p['aria-expanded'] !== false) return;
      if (words(p.children) === 'Sequence Statistics') {
        opened = true;
        (p.onClick as () => void)();
      }
    };
  };
  /** `doc` restored into the App (Sequence view, Split, 100%), its Statistics opened by its own header, then `then` dispatched. */
  const restore = (doc: SequenceDocument, opts: { at?: number; then?: string[] } = {}) => {
    saveSession(doc, opts.at);
    openStatistics();
    try {
      return parseMarkup(driveApp([(_m, d) => d('file:restore-autosave'), ...(opts.then ?? []).map((id) => (_m: unknown, d: (id: string) => void) => d(id))]).html, el('div'));
    } finally {
      probe.onElement = null;
      clearWorkbenchLocalAutosave();
    }
  };
  /** The Statistics section of a render: its label / value rows, and its notes. */
  const statistics = (root: El) => {
    const sections = findAll(root, (e) => e.classes.has('mbc-accordion-section')
      && elementChildren(e).some((h) => h.tag === 'button' && h.classes.has('mbc-accordion-header') && textOf(h) === 'Sequence Statistics'));
    expect(sections, 'the Statistics section is drawn, once').toHaveLength(1);
    return {
      rows: findAll(sections[0], (e) => e.classes.has('stat-kv')).map((kv) => elementChildren(kv).map((c) => textOf(c))),
      notes: findAll(sections[0], (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')).map((p) => textOf(p)),
    };
  };
  /**
   * Statistics for `doc` once counted: a render asks, the count runs in its own task, and a render
   * after it reads it. One task was not always enough (BG-01M6T68N): a request for another sequence
   * replaces one whose task has not run yet, and a test that had timed out before this one resumed
   * in a task queued ahead of this one's and asked for its own sequence's Statistics, so the read
   * found the panel still counting. So this reads after each task, asking again, until the panel
   * stops counting, and fails after COUNT_TASKS tasks. That a count lands in the one task after the
   * render that asks for it is checked by 'computes whole-sequence statistics once per sequence
   * outside render'.
   */
  const COUNTING = 'Counting the whole sequence…';
  const COUNT_TASKS = 10;
  const counted = async (doc: SequenceDocument) => {
    restore(doc);
    for (let task = 1; ; task++) {
      await nextTask();
      const read = statistics(restore(doc));
      if (!read.notes.includes(COUNTING)) return read;
      if (task === COUNT_TASKS) expect.fail(`${doc.name}: still counting after ${COUNT_TASKS} tasks`);
    }
  };
  const valueOf = (s: { rows: string[][] }, label: string) => {
    const row = s.rows.filter(([k]) => k === label);
    expect(row, `one ${label} row`).toHaveLength(1);
    return row[0][1];
  };

  it('prints DNA masses as Biopython computes them', async () => {
    // BG-01M6RTP1. Statistics printed the dsDNA mass as the composition-blind 617.96 Da per bp plus
    // 157.9, and the ssDNA mass from 2-decimal residue masses plus a 79 Da end group, to 0.1 kDa,
    // which neither holds. Now both are Biopython's, to the 0.1 kDa printed. Every exact value below
    // was printed by Biopython 1.88 itself, `molecular_weight(seq, "DNA", double_stranded=True|False,
    // circular=<the document's topology>)`, on these very sequences (2026-11-07, generators copied
    // into a script); `molecular_weight` refuses N, so the masses with N come from Biopython's own
    // weights, as each case says. Wrong implementations, each caught by a case named here: the base
    // (the 200 kb probe read 123592.2 and 61780.7); a dsDNA mass of twice the strand, blind to its
    // complement (the A/G fixture would read 1928.5); a closed circle weighed with ends, or a linear
    // chain without them (two fixtures are printed in both topologies, which differ at 0.1 kDa); a
    // water per base rather than per bond (it reads as the circle); an N weighed as if exact; and a
    // mass marked approximate only past one N.
    const masses = (s: { rows: string[][] }) => [valueOf(s, 'dsDNA mass:'), valueOf(s, 'ssDNA mass:')];

    // The 200 kb probe of BG-01M6RRSV (circular; its linear masses round the same).
    const big = await counted(docOf('Big_200kb', seededDna(200_000, 11), 'circular'));
    expect(masses(big), 'the 200 kb probe').toEqual(['123576.1 kDa', '61780.0 kDa']);
    expect(big.notes, 'an exact mass carries no note').toEqual([]);

    // 4,000 bp of evenly drawn A, C, G and T: a closed circle has no ends, so each strand weighs one
    // water (18.0153 Da) less than the linear chain, and here that moves the printed 0.1 kDa.
    const acgt = seededFrom('ACGT', 4_000, 67);
    const acgtLinear = await counted(docOf('Acgt_4kb_linear', acgt));
    expect(masses(acgtLinear), 'linear, 4,000 bp').toEqual(['2471.6 kDa', '1235.9 kDa']);
    expect(acgtLinear.notes, 'no N, no note').toEqual([]);
    expect(masses(await counted(docOf('Acgt_4kb_circular', acgt, 'circular'))), 'circular, 4,000 bp').toEqual(['2471.5 kDa', '1235.8 kDa']);

    // 3,000 bp of A and G only: the complementary strand is all C and T, so the duplex is not twice
    // the strand (twice 964.3 is 1928.5).
    const ag = seededFrom('AG', 3_000, 21);
    expect(masses(await counted(docOf('Ag_3kb_linear', ag))), 'linear, A and G').toEqual(['1853.8 kDa', '964.3 kDa']);
    expect(masses(await counted(docOf('Ag_3kb_circular', ag, 'circular'))), 'circular, A and G').toEqual(['1853.7 kDa', '964.2 kDa']);
    // The test's own reading of Biopython's formula (biopythonDnaMassesKda) agrees with Biopython here.
    expect(biopythonDnaMassesKda(acgt, false)).toEqual({ ds: '2471.6', ss: '1235.9' });
    expect(biopythonDnaMassesKda(ag, true)).toEqual({ ds: '1853.7', ss: '964.2' });

    // 5,000 bp with 52 N: Biopython refuses them ("'N' is not a valid unambiguous letter for DNA"),
    // so the masses are marked approximate and say how N is weighed: as the mean of the four bases,
    // Biopython's avg_ambiguous_dna_weights N (326.96215), from which Biopython's own weights give
    // these values.
    const withN = [...seededFrom('ACGT', 5_000, 1)].map((b, i) => (i % 97 === 50 ? 'N' : b)).join('');
    expect(withN.split('N').length - 1).toBe(52);
    const nStats = await counted(docOf('N_5kb', withN));
    expect(masses(nStats), 'with N').toEqual(['≈ 3089.5 kDa', '≈ 1544.7 kDa']);
    // Below Melting temp, its own note gives the Tm's reason (BG-01M6SHQ0).
    expect(nStats.notes, 'the note says why').toEqual([
      'Masses are approximate: 52 bases are N or another IUPAC code, weighed as the mean of A, C, G and T.',
      'Tm n/a: the span holds 52 N or other ambiguity bases; Tm is computed on A/C/G/T only, as Primer3 does',
    ]);

    // From below: the linear 4,000 bp above, exact with no N, reads approximate with one base made
    // N, and says so in the singular. Wrong implementations: a mark only past one ambiguous base, or
    // past a share of the sequence (one N in 4,000 bp is 0.025%), and the plural "1 bases are". Its
    // masses round as the exact ones do (2471577.7326 and 1235885.6489 Da from Biopython 1.88's
    // avg_ambiguous_dna_weights, against molecular_weight's 2471578.2266 and 1235865.8839 for the
    // sequence without the N), so the mark and the note are all that tell the two apart.
    const oneN = `${acgt.slice(0, 2_000)}N${acgt.slice(2_001)}`;
    expect([oneN.length, oneN.split('N').length - 1, acgt[2_000]]).toEqual([4_000, 1, 'C']);
    const oneNStats = await counted(docOf('One_N_4kb_linear', oneN));
    expect(masses(oneNStats), 'one N').toEqual(['≈ 2471.6 kDa', '≈ 1235.9 kDa']);
    expect(oneNStats.notes, 'one base, said as one').toEqual([
      'Masses are approximate: 1 base is N or another IUPAC code, weighed as the mean of A, C, G and T.',
      'Tm n/a: the span holds 1 N or other ambiguity base; Tm is computed on A/C/G/T only, as Primer3 does',
    ]);
  });

  it('computes whole-sequence statistics once per sequence outside render', async () => {
    // BG-01M6RTP1. The whole-sequence pass ran in render, in a memo keyed on the whole document, so
    // every render that changed the document (and every reopening of the panel) ran it again: a
    // median 84 ms at 10 Mb and about a second at 50 Mb. Now a render only asks for the sequence's
    // counts; the pass runs in a task of its own and is kept for that sequence. A server render
    // cannot re-render when the count lands, so each render here is a fresh App, and the count is
    // kept for the sequence rather than the App (the next test mounts one App and watches it
    // re-render). Wrong implementations: the base (passes in render); a memo keyed on the document
    // (the topology change counts again); one keyed on the length (the second sequence, of the
    // same length, reads the first's counts); an App that does not subscribe to the count (nothing
    // it subscribed to hears it land); a count that is shown for a sequence it was not made for;
    // and a request that leaves the one it replaces to run (the passed-over sequence is counted).
    const calls: { sequence: string; inRender: boolean }[] = [];
    const subscribes = new Set<(listener: () => void) => () => void>();
    probe.onComposition = (sequence, inRender) => calls.push({ sequence, inRender });
    probe.onExternalStore = (subscribe) => subscribes.add(subscribe);
    const passesOver = (s: string) => calls.filter((c) => c.sequence === s);
    const expectedRows = (s: string) => {
      const [A, C, G, T] = ['A', 'C', 'G', 'T'].map((b) => s.split(b).length - 1);
      return [`${(((G + C) / s.length) * 100).toFixed(1)}% / ${(((A + T) / s.length) * 100).toFixed(1)}%`, `${A} / ${C} / ${G} / ${T}`];
    };
    const countsOf = (s: { rows: string[][] }) => [valueOf(s, '%GC / %AT:'), valueOf(s, 'A / C / G / T:')];

    const first = seededFrom('ACGT', 30_000, 0x7e57);
    const doc = docOf('Counted_30kb', first, 'circular');
    const asking = statistics(restore(doc));
    expect(passesOver(first), 'no pass in the render that asks').toEqual([]);
    expect(asking.rows, 'only the length while counting').toEqual([['Length:', '30,000 bp']]);
    expect(asking.notes).toEqual(['Counting the whole sequence…']);
    let heard = 0;
    const unsubscribes = [...subscribes].map((subscribe) => subscribe(() => heard++));
    await nextTask();
    expect(passesOver(first), 'one pass, in a task of its own').toEqual([{ sequence: first, inRender: false }]);
    expect(heard, 'the App hears the count land').toBeGreaterThan(0);
    unsubscribes.forEach((u) => u());

    // Renders, and a change to the document that keeps its sequence, count it no more.
    for (const then of [[], ['sequence:toggle-topology'], []]) {
      statistics(restore(doc, { then }));
      await nextTask();
    }
    expect(passesOver(first).length, 'once for this sequence').toBe(1);
    const read = statistics(restore(doc));
    expect(countsOf(read), "the first sequence's counts").toEqual(expectedRows(first));
    expect(read.notes).toEqual([]);

    // An edit to a sequence of the same length is a new sequence: counted once, outside render, and
    // read as its own; the first is still counted.
    const second = seededFrom('ACGT', 30_000, 0x7e58);
    expect(expectedRows(second), 'the two sequences differ in their counts').not.toEqual(expectedRows(first));
    const edited = { ...doc, sequence: second };
    expect(statistics(restore(edited)).notes, 'a new sequence is counted afresh').toEqual(['Counting the whole sequence…']);
    await nextTask();
    const readSecond = statistics(restore(edited));
    expect(passesOver(second), 'one pass over the edit').toEqual([{ sequence: second, inRender: false }]);
    expect(countsOf(readSecond), "the edit's counts").toEqual(expectedRows(second));
    statistics(restore(doc));
    await nextTask();
    expect(passesOver(first).length, 'the first sequence is not counted again').toBe(1);

    // Sequences asked for before the task runs (two renders in one task, as when a document is
    // passed through on the way to another) are not each counted: a request replaces the one asked
    // before it, so only the last is counted.
    const passedOver = seededFrom('ACGT', 30_000, 0x7e5a);
    const last = seededFrom('ACGT', 30_000, 0x7e5b);
    statistics(restore({ ...doc, sequence: passedOver }));
    statistics(restore({ ...doc, sequence: last }));
    await nextTask();
    expect(passesOver(passedOver), 'a sequence replaced before its task ran is not counted').toEqual([]);
    expect(passesOver(last), 'the last one asked for is counted once').toEqual([{ sequence: last, inRender: false }]);

    // A pass that fails says so, by its error, rather than counting for ever.
    const failing = seededFrom('ACGT', 30_000, 0x7e59);
    probe.onComposition = (sequence, inRender) => {
      calls.push({ sequence, inRender });
      if (sequence === failing) throw new Error('the engine is unavailable');
    };
    const failed = { ...doc, sequence: failing };
    statistics(restore(failed));
    await nextTask();
    const readFailed = statistics(restore(failed));
    expect(readFailed.rows, 'no counts from a failed pass').toEqual([['Length:', '30,000 bp']]);
    expect(readFailed.notes).toEqual(['The whole sequence could not be counted: the engine is unavailable']);
    expect(calls.filter((c) => c.inRender), 'no pass ran in a render').toEqual([]);
  });

  it('computes whole-sequence statistics once per sequence outside render, and the mounted App shows them when they land', async () => {
    // BG-01M6RTP1, in the client render. The render that asks for the counts says it is counting;
    // when they land, the App must render again to show them. The server renders above are each a
    // fresh App, which reads the counts straight from the store, so they pass whether or not a
    // mounted App renders again. Here one App is mounted with React DOM's client renderer, which
    // main.tsx mounts it with, its session restored and its Statistics opened; the test then only
    // lets the count's task run, and the same mounted section must show the counts. Wrong
    // implementations: a store whose snapshot does not change when a count lands (React keeps the
    // render it has), one that does not tell its listeners, and an App that reads the store
    // without subscribing to it.
    const sequence = seededFrom('ACGT', 30_000, 0x7e5c);
    const doc = docOf('Mounted_30kb', sequence, 'circular');
    const calls: { sequence: string; inRender: boolean }[] = [];
    probe.onComposition = (s, inRender) => calls.push({ sequence: s, inRender });
    const stores = new Map<(listener: () => void) => () => void, () => unknown>();
    probe.onExternalStore = (subscribe, getSnapshot) => stores.set(subscribe, getSnapshot);
    saveSession(doc);
    openStatistics();
    let restored = false;
    probe.onMenus = (_menus, dispatch) => {
      if (restored) return;
      restored = true;
      dispatch('file:restore-autosave');
    };
    // The window React DOM reads while it commits (the focused element), and the one the App's
    // effects add their listeners to and set their timers on; and a document for the effects that
    // listen on it or look a node up in it (React creates nodes through the container's own).
    const g = globalThis as { window?: unknown; document?: unknown };
    const document = new ClientDocument();
    const noop = () => {};
    g.window = { HTMLIFrameElement: class {}, addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout };
    g.document = document;
    const container = document.createElement('div');
    const root = createRoot(container as unknown as Element);
    /** The mounted Statistics section: its node, its label / value rows and its notes. */
    const mounted = () => {
      const sections: ClientElement[] = [];
      const visit = (n: ClientNode) => {
        if (n instanceof ClientElement && n.getAttribute('class') === 'mbc-accordion-section'
          && n.childNodes.some((h) => h instanceof ClientElement && h.tagName === 'button' && h.textContent === 'Sequence Statistics')) sections.push(n);
        n.childNodes.forEach(visit);
      };
      visit(container);
      expect(sections, 'the Statistics section is mounted, once').toHaveLength(1);
      return { node: sections[0], ...statistics(asEl(sections[0])) };
    };
    try {
      probe.rendering = true;
      try {
        flushSync(() => root.render(<App />));
      } finally {
        probe.rendering = false;
      }
      expect(restored, 'the session is restored').toBe(true);
      const asking = mounted();
      expect(asking.rows, 'only the length while counting').toEqual([['Length:', '30,000 bp']]);
      expect(asking.notes).toEqual(['Counting the whole sequence…']);
      expect(calls, 'no pass in the render that asks').toEqual([]);
      const before = new Map([...stores].map(([subscribe, getSnapshot]) => [subscribe, getSnapshot()]));
      const heard = new Set<(listener: () => void) => () => void>();
      const unsubscribes = [...stores.keys()].map((subscribe) => subscribe(() => heard.add(subscribe)));

      // The count's task runs; the render it causes is React's, not the test's.
      await nextTask();
      unsubscribes.forEach((u) => u());

      const shown = mounted();
      expect(shown.node, 'the same mounted section, not a new one').toBe(asking.node);
      expect(shown.notes, 'counting no more').toEqual([]);
      expect(shown.rows.map(([label]) => label)).toEqual(['Length:', '%GC / %AT:', 'dsDNA mass:', 'ssDNA mass:', 'Melting temp:', 'Dam / Dcm:', 'A / C / G / T:']);
      const [A, C, G, T] = ['A', 'C', 'G', 'T'].map((b) => sequence.split(b).length - 1);
      const masses = biopythonDnaMassesKda(sequence, true);
      expect(['%GC / %AT:', 'dsDNA mass:', 'ssDNA mass:', 'A / C / G / T:'].map((label) => valueOf(shown, label)), 'the counts, shown').toEqual([
        `${(((G + C) / 30_000) * 100).toFixed(1)}% / ${(((A + T) / 30_000) * 100).toFixed(1)}%`, `${masses.ds} kDa`, `${masses.ss} kDa`, `${A} / ${C} / ${G} / ${T}`,
      ]);
      expect(calls, 'one pass, in a task of its own, and none in the render that shows it').toEqual([{ sequence, inRender: false }]);
      // The App renders again because the store it subscribes to tells it, and the snapshot it
      // reads is new; a render caused by anything else would show the counts without either.
      expect(heard.size, 'a store the App reads hears the count land').toBeGreaterThan(0);
      for (const subscribe of heard) {
        expect(Object.is(stores.get(subscribe)!(), before.get(subscribe)), 'and the snapshot the App reads changes').toBe(false);
      }
    } finally {
      root.unmount();
      delete g.window;
      delete g.document;
      probe.onMenus = null;
      probe.onElement = null;
      clearWorkbenchLocalAutosave();
    }
  });

  it('says the whole sequence was scanned for the core enzymes', () => {
    // BG-01M6RTP1. From 100,001 to 150,000 bp the engine scans the whole sequence with its 28 core
    // enzymes, and the linear map's note read "Cut sites are shown for 28 core enzymes only: the
    // rest was not scanned.", which reads as if part of the sequence went unscanned. Now it says
    // the whole sequence was scanned for them, on every page, and that holds: the far pages draw
    // the sites the engine finds there. Wrong implementations: the base's words; the whole-sequence
    // words where only the first bases were scanned (a scope with both a range and the core
    // catalog, on a page inside the range, says which bases); and the note outside the band (at
    // 100,000 bp the whole catalog is scanned and nothing is said).
    const NOTE = 'Cut sites are shown for 28 core enzymes only: the whole sequence was scanned for them, and not for other enzymes.';
    const linearOf = (root: El) => {
      const linear = findAll(root, (e) => e.tag === 'div' && e.classes.has('linear-seq-container'));
      expect(linear, 'the linear view is drawn, once').toHaveLength(1);
      return {
        page: textOf(findAll(linear[0], hasClass('page-indicator'))[0]),
        notes: findAll(linear[0], (e) => e.tag === 'p' && e.classes.has('mbc-summary-note')).map((p) => textOf(p)),
        pills: findAll(linear[0], (e) => e.tag === 'span' && e.classes.has('cut-pill')).length,
      };
    };
    const mid = docOf('Mid_120kb', seededDna(120_000, 31), 'circular');
    const top = docOf('Top_150kb', seededDna(150_000, 32), 'circular');
    const cases: [SequenceDocument, number | undefined, string][] = [
      [mid, undefined, '1–1,200'],
      [mid, 60_001, '60,001–61,200'],
      [mid, 119_500, '118,801–120,000'],
      [top, 149_500, '148,801–150,000'],
    ];
    for (const [doc, at, page] of cases) {
      const where = `${doc.name}, page ${page}`;
      const r = linearOf(restore(doc, { at }));
      expect(r.page, where).toBe(`${page} of ${doc.sequence.length.toLocaleString()} bp`);
      expect(r.notes, where).toEqual([NOTE]);
      if (at !== undefined && at > 60_000) {
        const [lo, hi] = page.split('–').map((n) => Number(n.replace(/,/g, '')));
        const engineThere = findRestrictionCutSites(doc.sequence, 'circular').filter((c) => c.position >= lo && c.position <= hi).length;
        expect(engineThere, `${where}: the engine cuts there`).toBeGreaterThan(0);
        expect(r.pills, `${where}: and the map draws it`).toBeGreaterThan(0);
      }
    }
    // The band's edges: 100,000 bp is scanned whole with every enzyme (no note), 100,001 bp is not.
    expect(linearOf(restore(docOf('Edge_100000', seededDna(100_000, 33), 'circular'))).notes, 'at 100,000 bp').toEqual([]);
    expect(linearOf(restore(docOf('Edge_100001', seededDna(100_001, 34), 'circular'))).notes, 'at 100,001 bp').toEqual([NOTE]);
    // A scan of the first bases with the core catalog says which bases, inside them and past them.
    const scoped = (at: number) => linearOf(parseMarkup(renderToStaticMarkup(
      <LinearSequenceView doc={mid} cutSites={[]} restrictionScope={{ firstBp: 60_000, coreEnzymes: 28 }} selectedRange={{ start: at, end: at }}
        onSelectRange={() => {}} onUpdateDocument={() => {}} />,
    ), el('div'))).notes;
    expect(scoped(1), 'inside the first 60,000 bp').toEqual(['Cut sites are shown for 28 core enzymes only: the first 60,000 bp were scanned for them, and not for other enzymes.']);
    expect(scoped(60_001), 'past them').toEqual(['Cut sites are shown for the first 60,000 bp and for 28 core enzymes only: the rest was not scanned.']);
  });

  it('reads 4095 Dam sites as an exact count', async () => {
    // BG-01M6RTP1. The engine lists 4,096 Dam and 4,096 Dcm sites at most, so Statistics reads a
    // full list as "at least 4,096"; the threshold was pinned only from above (4,200 sites). Now
    // both sides are, each list on its own: 4,095 sites read exactly, 4,096 and 4,097 as "at
    // least". Wrong implementations: "at least" from 4,095 (a full list one short); an exact 4,096
    // (a cap read as a count); and the Dam threshold applied to the Dcm count, or the reverse.
    const UNIT = 'GATCCCAGGA'; // one GATC and one CCAGG, and none across the joins
    const fixtures: [string, string, [number, number], string][] = [
      ['Sites_4095', UNIT.repeat(4_095), [4_095, 4_095], '4,095 / 4,095 sites'],
      ['Dam_4096', `${UNIT.repeat(4_095)}GATC`, [4_096, 4_095], 'at least 4,096 / 4,095 sites'],
      ['Dcm_4096', `${UNIT.repeat(4_095)}CCAGG`, [4_095, 4_096], '4,095 / at least 4,096 sites'],
      ['Sites_4097', UNIT.repeat(4_097), [4_097, 4_097], 'at least 4,096 / at least 4,096 sites'],
    ];
    const sitesOf = (seq: string, motif: RegExp) => (seq.match(motif) ?? []).length;
    for (const [name, sequence, [dam, dcm], text] of fixtures) {
      expect([sitesOf(sequence, /GATC/g), sitesOf(sequence, /CC[AT]GG/g)], `${name}: the sites it holds`).toEqual([dam, dcm]);
      const listed = analyzeSequenceComposition(sequence);
      expect([listed.damSites.length, listed.dcmSites.length], `${name}: the engine lists 4,096 at most`).toEqual([Math.min(dam, 4_096), Math.min(dcm, 4_096)]);
      expect(valueOf(await counted(docOf(name, sequence)), 'Dam / Dcm:'), name).toBe(text);
    }
  });
});

describe('the bottom document table (US-01M6S7T2)', () => {
  it('rules the stacked layout\'s bottom table off on its top edge, against the handle', () => {
    /** The document table pane and the table / viewer handle of a render, read through the cascade. */
    const regions = (html: string) => {
      const root = parseMarkup(html, workbench('light'));
      const [pane, ...morePanes] = findAll(root, hasClass('mbc-doc-table-pane'));
      const handles = findAll(root, hasClass('mbc-workspace-pane-resizer'));
      expect(morePanes, 'one table pane').toEqual([]);
      return { pane, handle: handles[0] as El | undefined, handles: handles.length };
    };
    // Stacked with the table shown (a new session): the table follows the handle, under the viewer.
    // Its 1px rule moves to its top edge, and the handle's light edge faces the table, as the
    // table-on-top layout drew them the other way up; the status bar's own rule closes it below.
    const below = regions(sequenceView().html);
    expect(below.handles, 'one handle').toBe(1);
    const siblings = elementChildren(below.pane.parent!);
    expect(siblings.indexOf(below.pane), 'the table pane follows the handle').toBe(siblings.indexOf(below.handle!) + 1);
    expect(cascaded(below.pane, 'border-top')?.value, 'the rule on the table\'s top edge').toBe('1px solid var(--mbc-border)');
    expect(cascaded(below.pane, 'border-bottom')?.value, 'none on its bottom edge').toBe('none');
    expect([cascaded(below.handle!, 'border-top-color')?.value, cascaded(below.handle!, 'border-bottom-color')?.value], 'the handle\'s edges').toEqual(['var(--mbc-border)', 'var(--mbc-border-light)']);
    // Folded, the bar on top keeps its bottom rule; side by side nothing changes.
    const folded = regions(sequenceView('view:toggle-doctable').html);
    expect(folded.handles, 'no handle while folded').toBe(0);
    expect([cascaded(folded.pane, 'border-top'), cascaded(folded.pane, 'border-bottom')?.value], 'folded: the rule below the bar').toEqual([null, '1px solid var(--mbc-border)']);
    const side = regions(sequenceView('view:split-left-right').html);
    expect(cascaded(side.pane, 'border-top'), 'side by side: no top rule').toBeNull();
    expect([cascaded(side.handle!, 'border-top-color'), cascaded(side.handle!, 'border-bottom-color')], 'side by side: the handle as it was').toEqual([null, null]);
  });
});

// ─── The four Tm readouts through the App (BG-01M6RZJF, BG-01M6SHQ0) ───

/** A linear DNA record holding only `sequence`. */
const tmRecord = (name: string, sequence: string): SequenceDocument => ({
  ...puc19, id: `bg-rzjf-${name}`, name, accession: '', description: '', sequence, topology: 'linear', moleculeType: 'DNA',
  features: [], primers: [], history: [],
});

/**
 * The status bar, the quickbar, the cockpit and Statistics, for `doc` selected whole through the App:
 * each one's Tm as it reads (`values`), and the reason each gives for an "n/a" (`reasons`): the title
 * of the status bar's and the quickbar's "n/a", the visible text beside the cockpit's and Statistics'.
 */
const tmReadouts = async (doc: SequenceDocument) => {
  const render = () => {
    expect(saveWorkbenchToLocalAutosave({
      sessionName: 'Tm_Rule_Session',
      documents: [doc],
      workspace: {
        activeDocId: doc.id, selectedFolder: 'All Project Files', navHistory: [doc.id], navIndex: 0,
        viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
        darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: { start: 1, end: doc.sequence.length },
        displaySettings: {
          showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
          showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
        },
      },
    }), 'the autosave is written').toBe(true);
    const words = (node: unknown): string => (typeof node === 'string' || typeof node === 'number' ? String(node)
      : Array.isArray(node) ? node.map(words).join('')
      : node && typeof node === 'object' && 'props' in node ? words((node as { props: { children?: unknown } }).props.children) : '');
    let opened = false;
    probe.onElement = (type, p) => {
      if (opened || type !== 'button' || p.className !== 'mbc-accordion-header' || p['aria-expanded'] !== false) return;
      if (words(p.children) === 'Sequence Statistics') {
        opened = true;
        (p.onClick as () => void)();
      }
    };
    try {
      return parseMarkup(driveApp([(_m, d) => d('file:restore-autosave')]).html, el('div'));
    } finally {
      probe.onElement = null;
      clearWorkbenchLocalAutosave();
    }
  };
  // Statistics counts a sequence in a task of its own after the render that asks (BG-01M6RTP1).
  render();
  await nextTask();
  const root = render();
  const one = <T,>(found: T[], what: string) => {
    expect(found, `${doc.name}: ${what}, once`).toHaveLength(1);
    return found[0];
  };
  const bar = one(findAll(root, (e) => e.classes.has('mbc-cockpit-bar')), 'the cockpit');
  const status = one(findAll(root, (e) => e.tag === 'footer' && e.classes.has('mbc-statusbar'))
    .flatMap((f) => findAll(f, (e) => e.tag === 'span' && /^Selection: /.test(textOf(e)))), 'the status bar selection');
  const quickbar = one(findAll(root, (e) => e.tag === 'div' && e.classes.has('seq-selection-quickbar-summary')), 'the quickbar');
  const section = one(findAll(root, (e) => e.classes.has('mbc-accordion-section')
    && elementChildren(e).some((h) => h.tag === 'button' && h.classes.has('mbc-accordion-header') && textOf(h) === 'Sequence Statistics')), 'Statistics');
  const meltingRows = findAll(section, (e) => e.classes.has('stat-kv') && textOf(elementChildren(e)[0] ?? e) === 'Melting temp:');
  const cockpitTm = findAll(bar, (e) => e.tag === 'span' && /^Duplex Tm:/.test(textOf(e)));
  /** The title of each "n/a" a readout shows. */
  const naTitles = (root: El) => findAll(root, (e) => e.tag === 'span' && textOf(e) === 'n/a').map((e) => e.attrs.title ?? null);
  return {
    values: {
      status: /\| Tm: ([^)]*)\)$/.exec(textOf(status))?.[1],
      quickbar: /· Tm ([^)]*)\)$/.exec(textOf(elementChildren(quickbar)[1] ?? quickbar))?.[1],
      cockpit: cockpitTm.map((s) => textOf(s).replace(/^Duplex Tm:\s*/, '').replace(/ \(ΔG .*\)$/, '')),
      statistics: meltingRows.map((kv) => textOf(elementChildren(kv)[1] ?? kv)),
    },
    reasons: {
      status: naTitles(status),
      quickbar: naTitles(quickbar),
      cockpit: findAll(bar, (e) => e.classes.has('mbc-cockpit-tm-reason')).map(textOf),
      // The note directly below Statistics' Melting temp row.
      statistics: meltingRows.flatMap((kv) => {
        const rows = elementChildren(kv.parent!);
        const next = rows[rows.indexOf(kv) + 1];
        return next && next.tag === 'p' && next.classes.has('mbc-summary-note') ? [textOf(next)] : [];
      }),
    },
  };
};

// ─── BG-01M6RZJF ───

describe('construct cockpit residue total and the Tm rule (BG-01M6RZJF)', () => {
  it('counts preview residues to the first stop and shows one Tm rule', async () => {
    // BG-01M6RZJF. The cockpit's cut-preview total was every whole codon less a terminal stop, so
    // internal stops counted as residues: a 10 kb ORF with two in-frame TGA read "(first 12 aa of
    // 3,332)" beside its own "Internal Stop (2× *)". Now the preview and its total are the residues
    // frame +1 codes before its first stop codon, as Biopython's translate(to_stop=True) gives them,
    // and a preview that reaches that stop ends on it (*). Every count, and the twelve frame residues
    // each preview is cut from, was printed by Biopython 1.88 itself,
    // len(Seq(selection).translate(to_stop=True)) and str(Seq(its first 36 bases).translate())[:12],
    // on these very sequences (2026-11-07, the generator copied into a script); a preview that
    // reaches a stop shows those residues up to it and the stop. The cockpit's Tm read 64.8 °C for
    // 39 N and one A where the status bar and the quickbar read "Tm n/a", and Statistics printed the
    // engine's -607.5 °C for such a document; now all four readouts follow one rule.
    const { ConstructCockpitBar } = await import('../components/ConstructCockpitBar');
    const { translateSequence, calculatePrimerMetrics } = await import('../core/bioEngine');
    // BG-01M6RWDB's 9,999 bp ORF: ATG, 3,331 seeded sense codons (or `senseCodons` of them, the same
    // codons first), then `last`; `edits` puts a codon at each codon number given (codon 1 is the ATG).
    const SENSE = ['GCT', 'GAA', 'AAA', 'CTG', 'GGC', 'CGT', 'TCC', 'ACC', 'GTT', 'CAG', 'ATC', 'TTC', 'TGG', 'TAC', 'CAC', 'AAC'];
    const orfDna = (edits: [number, string][] = [], last = 'TAA', senseCodons = 3_331) => {
      let x = 0x0f1;
      const codons = Array.from({ length: senseCodons }, () => SENSE[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 28]);
      for (const [k, codon] of edits) codons[k - 2] = codon;
      return `ATG${codons.join('')}${last}`;
    };
    const docOf = (name: string, sequence: string): SequenceDocument => ({
      ...puc19, id: `bg-rzjf-${name}`, name, accession: '', description: '', sequence, topology: 'linear', moleculeType: 'DNA',
      features: [], primers: [], history: [],
    });
    const cockpit = (doc: SequenceDocument, range: { start: number; end: number } | null) => {
      const root = parseMarkup(renderToStaticMarkup(
        <ConstructCockpitBar doc={doc} cutSites={[]} selectedRange={range} onSelectRange={() => {}} />,
      ), el('div'));
      const pill = findAll(root, (e) => e.tag === 'span' && e.classes.has('mbc-cockpit-orf-pill'));
      const preview = findAll(root, (e) => e.tag === 'span' && e.classes.has('mbc-cockpit-aa-preview'));
      expect(preview, `${doc.name}: the preview is drawn, once`).toHaveLength(1);
      return { preview: textOf(preview[0]).replace(/\s+/g, ' ').trim(), label: pill.length ? textOf(pill[0]) : null };
    };
    const HEAD = 'MRKYQAYLSESK';
    expect(translateSequence(orfDna().slice(0, 36), 0), "the ORF's first 12 residues").toBe(HEAD);
    const cut = (of: string, head = HEAD) => `AA: ${head}… (first 12 aa of ${of})`;

    // ── The residue total: to the first stop ──
    // Each case: the document, the selection (null: none, the whole document), the preview and the
    // ORF badge. Wrong implementations, each caught by a case named here: the base (every whole
    // codon less a terminal stop, 3,332 for the two-stop ORF); every stop dropped from the count
    // (3,330, mutant M7); a count to the last stop (2,999) or with the stop as a residue (2,000);
    // the total fixed for a selection only (no selection); a stop set short of TAA, TAG or TGA, or
    // one of exact strings, blind to TAR and TRA, which can only be stops; a terminal stop read only
    // as TAA (3,333 for the TGA and TAG endings, mutant M5); the span's last three bases taken as
    // its last codon (bases 1..10,000 end on AAG: 3,333, mutant M6), or a trailing part codon
    // counted (3,333 for bases 1..9,997); `fullAa.length - 1` for the In-Frame badge (3,220 for
    // bases 334..9,996, mutant M10); and a scan whose windows lose the residues before the one that
    // holds the stop, or leave the frame (the stops past base 3,000). The scan's two edges, on spans
    // that end mid-record before any stop: a last window of exactly one codon skipped (`to - at > 3`,
    // 1,000 for bases 1..3,003, mutant MA), and windows read past the span's end (no clamp to `to`:
    // 1,000 for bases 1..999 and 2,000 for bases 1..3,003, mutant MB). And the In-Frame badge on a
    // span that ends in a stop with no start codon, where its codons are one more than its residues:
    // labelled with the codon count, bases 4..12,006 of a 4,002-codon ORF read 4,001 (mutant MN).
    const twoStops = docOf('Two_TGA', orfDna([[2_000, 'TGA'], [3_000, 'TGA']]));
    const plusGc = docOf('Orf_plus_GC', `${orfDna()}GC`);
    const intact = docOf('Orf_10kb', orfDna());
    const longOrf = docOf('Orf_12kb', orfDna([], 'TAA', 4_000));
    const cases: [string, SequenceDocument, { start: number; end: number } | null, string, string | null][] = [
      ['two TGA stops, codons 2,000 and 3,000', twoStops, { start: 1, end: 9_999 }, cut('1,999'), 'Internal Stop (2× *)'],
      ['two TGA stops, no selection', twoStops, null, cut('1,999'), null],
      ['TAG at codon 1,500 before TAA at 2,500', docOf('Tag_first', orfDna([[1_500, 'TAG'], [2_500, 'TAA']])), { start: 1, end: 9_999 }, cut('1,499'), 'Internal Stop (2× *)'],
      ...['TAA', 'TAG', 'TGA', 'TAR', 'TRA'].map((codon): [string, SequenceDocument, { start: number; end: number }, string, string] => (
        [`${codon} at codon 1,234`, docOf(`${codon}_1234`, orfDna([[1_234, codon]])), { start: 1, end: 9_999 }, cut('1,233'), 'Internal Stop (1× *)'])),
      ['an ORF ending in TGA', docOf('Ends_TGA', orfDna([], 'TGA')), { start: 1, end: 9_999 }, cut('3,332'), '3n Complete ORF (ATG→Stop)'],
      ['an ORF ending in TAG', docOf('Ends_TAG', orfDna([], 'TAG')), { start: 1, end: 9_999 }, cut('3,332'), '3n Complete ORF (ATG→Stop)'],
      ['bases 1..10,000: the TAA, then one base', plusGc, { start: 1, end: 10_000 }, cut('3,332'), 'Frameshift (+1 nt)'],
      ['bases 1..10,001: the TAA, then two bases', plusGc, { start: 1, end: 10_001 }, cut('3,332'), 'Frameshift (+2 nt)'],
      ['bases 1..9,997: no stop, a part codon', intact, { start: 1, end: 9_997 }, cut('3,332'), 'Frameshift (+1 nt)'],
      ['bases 2..9,999: frame shifted, 50 stops', intact, { start: 2, end: 9_999 }, cut('73', 'CVNTRLTCPNPN'), 'Frameshift (+2 nt)'],
      ['bases 334..9,996: no stop', intact, { start: 334, end: 9_996 }, cut('3,221', 'KHNFQGHFNGYG'), '3n In-Frame (3221 aa)'],
      ['bases 1..9,996: ATG, no stop', intact, { start: 1, end: 9_996 }, cut('3,332'), '3n In-Frame (3332 aa)'],
      ['bases 1..3,003: no stop, a last window of one codon', intact, { start: 1, end: 3_003 }, cut('1,001'), '3n In-Frame (1001 aa)'],
      ['bases 1..999: no stop, the record goes on', intact, { start: 1, end: 999 }, cut('333'), '3n In-Frame (333 aa)'],
      ['bases 4..12,006: no start codon, ends in TAA', longOrf, { start: 4, end: 12_006 }, cut('4,000', 'RKYQAYLSESKW'), '3n In-Frame (4000 aa)'],
    ];
    expect(plusGc.sequence.slice(9_997, 10_000), 'bases 9,998..10,000 are no stop codon').toBe('AAG');
    expect([longOrf.sequence.length, longOrf.sequence.slice(3, 6), longOrf.sequence.slice(-3)], 'the 4,002-codon ORF, from codon 2').toEqual([12_006, 'CGT', 'TAA']);
    expect(longOrf.sequence.slice(0, 9_996), 'its first 3,332 codons are the 10 kb ORF\'s').toBe(intact.sequence.slice(0, 9_996));
    for (const [name, doc, range, preview, label] of cases) {
      expect(cockpit(doc, range), name).toEqual({ preview, label });
    }
    // A preview that reaches the first stop ends on it, whole: the residues before it and the stop,
    // with no total, as there are no more residues. Wrong implementations: the base's twelve frame
    // residues, the stop among them, with "(first 12 aa of 3,332)"; those twelve with no total, as
    // if the selection coded them all; and a total of 12 shown on twelve residues (codon 13).
    const early = (codonNumber: number) => cockpit(docOf(`Tga_${codonNumber}`, orfDna([[codonNumber, 'TGA']])), { start: 1, end: 9_999 });
    expect(early(5), 'TGA at codon 5').toEqual({ preview: 'AA: MRKY*', label: 'Internal Stop (1× *)' });
    expect(early(12), 'TGA at codon 12').toEqual({ preview: 'AA: MRKYQAYLSES*', label: 'Internal Stop (1× *)' });
    expect(early(13), 'TGA at codon 13: twelve residues, all shown').toEqual({ preview: `AA: ${HEAD}`, label: 'Internal Stop (1× *)' });

    // ── One Tm rule, through the App ──
    // The status bar, the quickbar, the cockpit and Statistics, for a document selected whole
    // (tmReadouts). A span holding N or any other base that is not A, C, G or T has no Tm
    // (BG-01M6SHQ0), so every readout reads "n/a". Wrong implementations: the base cockpit (64.8 °C by
    // nearest neighbour for 39 N and one A; 74.8 °C by the long-span formula for 99 N and one A,
    // where a guard on one formula only misses the other); the base Statistics (the engine's
    // -607.5 °C); BG-01M6RZJF's rule, n/a only for 14 bases or more with fewer than 14 A/C/G/T, which
    // read 26 N and 14 A/C/G/T as 37.4 °C (and the cockpit's nearest neighbour), 86 N and 14 A/C/G/T
    // as 95.3 °C in the cockpit, and 4,000 N and 1,000 A/C/G/T as 84.7 °C (the cockpit 101.9 °C); and
    // an n/a that holds below 14 bases on an A/C/G/T span (a 13 bp selection has a Tm: Biopython
    // 1.88's Tm_Wallace gives 38.0 °C).
    const appReadouts = async (doc: SequenceDocument) => (await tmReadouts(doc)).values;
    const na = { status: 'n/a', quickbar: 'n/a', cockpit: ['n/a'], statistics: ['n/a'] };
    // 39 N and one A (the nearest-neighbour span), and 99 N and one A (the long-span formula).
    const n40 = docOf('N39_A1', `${'N'.repeat(20)}A${'N'.repeat(19)}`);
    const n100 = docOf('N99_A1', `${'N'.repeat(99)}A`);
    expect(calculatePrimerMetrics(n40.sequence).tmC.toFixed(1), "nearest neighbour's answer, out of its range").toBe('64.8');
    expect(analyzeSequenceComposition(n40.sequence).meltingTempBasicC.toFixed(1), "the engine's answer, out of its range").toBe('-607.5');
    expect(Number((81.5 - 675 / 100).toFixed(1)), "the long-span formula's answer for 99 N and one A").toBe(74.8);
    expect(await appReadouts(n40), '39 N and one A').toEqual(na);
    expect(await appReadouts(n100), '99 N and one A').toEqual(na);
    expect(await appReadouts(docOf('N27_Acgt13', `${'N'.repeat(27)}ACGTACGTACGTA`)), '27 N and 13 A/C/G/T').toEqual(na);
    expect(await appReadouts(docOf('N13_A1', `${'N'.repeat(13)}A`)), '13 N and one A, 14 bases').toEqual(na);
    // 14 A/C/G/T bases beside N have no Tm either, whatever the formula (BG-01M6SHQ0): the base
    // read 37.4 °C (64.9 + 41 x (7 - 16.4) / 14), the cockpit's nearest neighbour over 40 bases, and
    // its long-span 81.5 + 0.41 x 50.0 - 675 / 100 = 95.3 °C over 100. The engine answers a number
    // there, with its reason, which every readout follows.
    const acgt14 = 'ACGTACGTACGTAC';
    const n26 = docOf('N26_Acgt14', `${'N'.repeat(26)}${acgt14}`);
    expect(Number.isFinite(calculatePrimerMetrics(n26.sequence).tmC), "nearest neighbour's number").toBe(true);
    expect(calculatePrimerMetrics(n26.sequence).tmNoAnswerReason, 'and its reason')
      .toBe('Tm n/a: the span holds 26 N or other ambiguity bases; Tm is computed on A/C/G/T only, as Primer3 does');
    expect(await appReadouts(n26), '26 N and 14 A/C/G/T').toEqual(na);
    expect(Number((81.5 + 0.41 * 50 - 675 / 100).toFixed(1))).toBe(95.3);
    expect(await appReadouts(docOf('N86_Acgt14', `${'N'.repeat(86)}${acgt14}`)), '86 N and 14 A/C/G/T').toEqual(na);
    // Biopython 1.88 printed the base's values: the basic formula over the A/C/G/T bases is
    // Tm_GC(userset=(64.9, 0.41, 672.4, 0), saltcorr=0), 84.7276 °C over the 1,000; the cockpit's
    // long-span 81.5 + 0.41 x 50.0 - 675 / 5,000 is Tm_GC(valueset=2, saltcorr=0, strict=False) over
    // the 5,000 bases, 101.865 °C. Tm_GC(strict=True) refuses the N, as primer3-py 2.4.0 calc_tm does.
    expect(await appReadouts(docOf('N4000_Acgt1000', `${'N'.repeat(4_000)}${'ACGT'.repeat(250)}`)), '4,000 N and 1,000 A/C/G/T').toEqual(na);
    expect(await appReadouts(docOf('N26_Acgu14', `${'N'.repeat(26)}ACGUACGUACGUAC`)), '26 N and 14 A/C/G/U in a DNA record').toEqual(na);
    // Below 14 bases the Wallace rule holds: 13 A/C/G/T read 2 x 7 + 4 x 6 = 38.0 °C, as Biopython
    // 1.88's Tm_Wallace gives them, and the cockpit reads its nearest neighbour.
    const short = docOf('Acgt_13', 'ACGTACGTACGTA');
    expect(await appReadouts(short), 'a 13 bp document')
      .toEqual({ status: '38.0°C', quickbar: '38.0 °C', cockpit: [`${calculatePrimerMetrics(short.sequence).tmC} °C`], statistics: ['38.0 °C'] });
  });
});

// ─── BG-01M6SHQ0 ───

describe('the Tm of a span holding an ambiguity code (BG-01M6SHQ0)', () => {
  /** The shared reason, in the product seat's words, written out here rather than taken from the app. */
  const reason = (k: string, plural: boolean) =>
    `Tm n/a: the span holds ${k} N or other ambiguity base${plural ? 's' : ''}; Tm is computed on A/C/G/T only, as Primer3 does`;

  it('reads Tm n/a for a span holding an ambiguity code', async () => {
    // A span holding N or any other base that is not A, C, G or T, in either case, has no Tm:
    // primer3-py 2.4.0 calc_tm raises ValueError for each fixture (Biopython 1.88's
    // Tm_GC(strict=True) for each but the W, which it reads as A or T). The status bar, the quickbar, the cockpit and Statistics read "n/a"
    // with the one reason: the cockpit and Statistics as visible text beside it, the status bar and
    // the quickbar as the title of their "n/a". The fixtures sit on the Wallace path below 14 bases,
    // the %GC path from 14 up, the cockpit's nearest neighbour (10..65 bp) and its long-span formula.
    // Wrong implementations: a rule keyed to N alone (the R, Y and W); one on upper case only (the
    // n); BG-01M6RZJF's rule, n/a only from 14 bases with fewer than 14 A/C/G/T (every fixture but 12
    // N + A and 13 N + A read a number); a guard on the %GC path only (12 N + A and the R, on the
    // Wallace path); and a guard on the selection readouts only, which leaves the cockpit's nearest
    // neighbour (68 °C for 26 N + 14 A/C/G/T) and its long-span 101.9 °C for 4,000 N + 1,000.
    const fixtures: [string, string, string][] = [
      ['12 N + A, 13 bases', `${'N'.repeat(12)}A`, reason('12', true)],
      ['an R, 13 bases', 'ACGTRACGTACGT', reason('1', false)],
      ['13 N + A, 14 bases', `${'N'.repeat(13)}A`, reason('13', true)],
      ['a Y, 18 bases', 'ACGTACGTYACGTACGTA', reason('1', false)],
      ['a W, 22 bases', 'ACGTACGTACGWACGTACGTAC', reason('1', false)],
      ['a lower-case n, 19 bases', 'acgtacgtnacgtacgtac', reason('1', false)],
      ['26 N + 14 A/C/G/T, 40 bases', `${'N'.repeat(26)}ACGTACGTACGTAC`, reason('26', true)],
      ['86 N + 14 A/C/G/T, 100 bases', `${'N'.repeat(86)}ACGTACGTACGTAC`, reason('86', true)],
      ['4,000 N + 1,000 A/C/G/T', `${'N'.repeat(4_000)}${'ACGT'.repeat(250)}`, reason('4,000', true)],
      // One N among 15 letters, beside a gap and a stop, which are no bases: k is 1, as the engine's
      // composition counts it. Wrong implementation: k counted over the span's length (17 - 14 = 3).
      ['an N beside a gap and a stop', 'ACGT-ACGTNACG*TAC', reason('1', false)],
    ];
    expect(reason('1', false)).toBe('Tm n/a: the span holds 1 N or other ambiguity base; Tm is computed on A/C/G/T only, as Primer3 does');
    for (const [name, sequence, why] of fixtures) {
      expect(await tmReadouts(tmRecord(name.replace(/\W+/g, '_'), sequence)), name).toEqual({
        values: { status: 'n/a', quickbar: 'n/a', cockpit: ['n/a'], statistics: ['n/a'] },
        reasons: { status: [why], quickbar: [why], cockpit: [why], statistics: [why] },
      });
    }

    // Controls keep their Tm in all four, with no reason. The basic Tm is Biopython 1.88's
    // Tm_Wallace below 14 bases (38.0 °C) and Tm_GC(userset=(64.9, 0.41, 672.4, 0), saltcorr=0) from
    // 14 up (37.3714 °C; 85.2655 °C over 5,000 bases at 50% GC). The cockpit's nearest neighbour is
    // Primer3's: primer3-py 2.4.0 calc_tm(mv_conc=50, dv_conc=1.5, dntp_conc=0, dna_conc=250) gives
    // 44.9667 °C and 48.1533 °C, which the engine rounds to 45 and 48.2; its long-span 101.865 °C is
    // Tm_GC(valueset=2, saltcorr=0). Lower case, and U in a DNA record, read as A/C/G/T. Wrong
    // implementations: U left out of the A/C/G/T count (11 of 14, so n/a); the count taken over the
    // cockpit's first 4,000 bases only (4,000 of 5,000, so n/a).
    // A gap ('-') or a stop ('*') is no base: the engine's composition and its primer metrics leave
    // it out, so 14 A/C/G/T beside one read as the 14 alone, and 13 beside a gap as the 13, on the
    // Wallace rule. Wrong implementation: the cockpit and the quickbar reading the span's length as
    // its bases, which gave the first two "n/a: ... holds 1 N" there, and the quickbar 32.1 °C (the
    // 14-base formula) for the third.
    const at13 = { status: '38.0°C', quickbar: '38.0 °C', cockpit: ['45 °C'], statistics: ['38.0 °C'] };
    const at14 = { status: '37.4°C', quickbar: '37.4 °C', cockpit: ['48.2 °C'], statistics: ['37.4 °C'] };
    const controls: [string, string, typeof at14][] = [
      ['13 A/C/G/T', 'ACGTACGTACGTA', at13],
      ['14 A/C/G/T', 'ACGTACGTACGTAC', at14],
      ['14 a/c/g/t', 'acgtacgtacgtac', at14],
      ['14 A/C/G/U in a DNA record', 'ACGUACGUACGUAC', at14],
      ['5,000 A/C/G/T', 'ACGT'.repeat(1_250), { status: '85.3°C', quickbar: '85.3 °C', cockpit: ['101.9 °C'], statistics: ['85.3 °C'] }],
      ['14 A/C/G/T and a gap', 'ACGTACGT-ACGTAC', at14],
      ['14 A/C/G/T and a stop', 'ACGTACGT*ACGTAC', at14],
      ['13 A/C/G/T and a gap', 'ACGTACGT-ACGTA', at13],
    ];
    const none = { status: [], quickbar: [], cockpit: [], statistics: [] };
    for (const [name, sequence, values] of controls) {
      expect(await tmReadouts(tmRecord(name.replace(/\W+/g, '_'), sequence)), name).toEqual({ values, reasons: none });
    }
  });

  it('the four Tm readouts agree across the 13 and 14 base boundary', async () => {
    // Spans of 12 to 16 bases from a fixed seed, each length once all A/C/G/T and once with each of
    // N, R, Y and W at a position that moves with the code and the length (first and last bases
    // included). The status bar, the quickbar, the cockpit and Statistics must agree on every span:
    // all "n/a" where it holds a code, all a Tm where it does not, the basic three on one number
    // (Wallace below 14 bases, 64.9 + 41 x (GC - 16.4) / N from 14 up) and the cockpit on the
    // engine's nearest neighbour. Wrong implementations: BG-01M6RZJF's rule, which read a number for
    // a code in 12, 13, 15 and 16 bases and n/a for one in 14; a readout keeping its own copy of a
    // rule; and the cockpit's nearest neighbour given an N span.
    const { calculatePrimerMetrics } = await import('../core/bioEngine');
    const seeded = (len: number, seed: number) => {
      let x = seed >>> 0;
      let s = '';
      for (let i = 0; i < len; i++) s += 'ACGT'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 30];
      return s;
    };
    const tmNumber = (s: string | undefined) => Number(/^(-?\d+\.\d) ?°C$/.exec(s ?? '')?.[1]);
    let spans = 0;
    let compared = 0;
    for (let len = 12; len <= 16; len++) {
      const base = seeded(len, 31 * len);
      const variants: [string, string][] = [['A/C/G/T', base]];
      ['N', 'R', 'Y', 'W'].forEach((code, i) => {
        const at = (5 * i + len - 1) % len;
        variants.push([`${code} at ${at + 1}`, `${base.slice(0, at)}${code}${base.slice(at + 1)}`]);
      });
      for (const [what, sequence] of variants) {
        const name = `${len} bases, ${what}`;
        const { values } = await tmReadouts(tmRecord(`sweep_${len}_${what.replace(/\W+/g, '_')}`, sequence));
        const readouts = [values.status, values.quickbar, ...values.cockpit, ...values.statistics];
        expect(readouts, `${name}: all four readouts are read`).toHaveLength(4);
        spans++;
        compared += readouts.length;
        if (/[^ACGT]/.test(sequence)) {
          expect(readouts, `${name}: n/a in all four`).toEqual(['n/a', 'n/a', 'n/a', 'n/a']);
          continue;
        }
        const gc = [...sequence].filter((b) => b === 'G' || b === 'C').length;
        const basic = Number((len < 14 ? 2 * (len - gc) + 4 * gc : 64.9 + (41 * (gc - 16.4)) / len).toFixed(1));
        expect([tmNumber(values.status), tmNumber(values.quickbar), tmNumber(values.statistics[0])], `${name}: the basic Tm`)
          .toEqual([basic, basic, basic]);
        expect(values.cockpit, `${name}: the cockpit's nearest neighbour`).toEqual([`${calculatePrimerMetrics(sequence).tmC} °C`]);
      }
    }
    expect([spans, compared], 'every span compared in all four readouts').toEqual([25, 100]);
  });
});
