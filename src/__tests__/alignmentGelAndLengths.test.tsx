// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6S7ZF: the alignment studio's Virtual Gel and Lengths Graph fit the inspector panel they
 * open in, whole and legible.
 *
 * The gel is drawn in one fixed view, wider than tall, that holds the gel and its lane key; it is
 * drawn at its panel's width with that aspect, so from the cathode label to the key it fits the
 * panel's height at 1280x800 and 1440x900, and its export draws the same view at its full-size
 * label scale from every window. The lengths chart is drawn in screen pixels at its panel's width:
 * 11px axis text, a count axis in whole-number steps from 0, a length axis from the shortest member
 * to the longest, and the statistics across the panel under it. Each view shows one title.
 *
 * Every check renders the real studio and reads the markup that results; none reads source text.
 * Controls are operated by calling the handlers the studio's render hands to its own elements, and
 * a drawing's ref is handed an element measured at the size the panel draws it, as the browser would.
 * The documents are the bundled sample library and alignments built here, so no reference data is
 * needed.
 *
 * US-01M6T9QY: each stain button under the gel shows its stain's own colours (a swatch of the
 * stain's gel background holding a band in its band colour) and its short name, with no emoji or
 * icon, and says whether it is pressed. Choosing one draws the gel in that stain, light bands on a
 * dark gel for a fluorescent stain and dark bands on a white gel for the print stain.
 *
 * BG-01M6TA8Q: each stain button's accessible name begins with the short name it shows, then the
 * stain's full name, which is also its title. At rest it is a DESIGN.md secondary button (Canvas
 * White, Ink, a Strong Rule border) and the chosen one a selected toggle (Signal Blue), in both
 * themes, each colour read through App.css's cascade (its top-level rules and the custom properties
 * they set); DESIGN.md's front matter gives the colours. The stain is the only state a press
 * changes, so no colour scheme is held that nothing draws from.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Probes, installed before the modules under test load ───

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  /** Every file the workbench was asked to save, in order. */
  saved: [] as { name: string; content: unknown; mime: string }[],
  /**
   * Sees every useState call while a component renders: the state's initial value, its current one,
   * and its setter (the same function on every pass of one render, so it names the state).
   */
  onState: null as null | ((initial: unknown, value: unknown, setter: unknown) => void),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useState = ((initial: unknown) => {
    const pair = actual.useState(initial);
    probe.onState?.(initial, pair[0], pair[1]);
    return pair;
  }) as typeof actual.useState;
  return { ...actual, default: { ...actual, useState }, useState };
});

vi.mock('../platform/macosMenuBridge', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../platform/macosMenuBridge');
  return {
    ...actual,
    saveWorkbenchFile: (name: string, content: unknown, mime: string) => {
      probe.saved.push({ name, content, mime });
      return 'native';
    },
  };
});

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

const { SequenceAlignmentStudio, VIRTUAL_GEL_STAINS } = await import('../components/AlignmentAndPhyloStudio');
const { exportFigure } = await import('../core/figureCapture');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { EMPTY_WORKSPACE_DOCUMENT } = await import('../core/emptyWorkspace');
type SequenceDocument = import('../types/bio').SequenceDocument;
type StudioProps = React.ComponentProps<typeof SequenceAlignmentStudio>;

// CSS `?raw` imports are stubbed by Vitest's CSS handling, so the stylesheet is read from disk.
const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as { readFileSync: (p: URL, enc: string) => string };
const APP_CSS = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');
/** The visual contract: its front matter names every colour the interface may use. */
const DESIGN_MD = nodeFs.readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8');

afterEach(() => {
  probe.onElement = null;
  probe.onState = null;
  probe.saved = [];
  vi.unstubAllGlobals();
});

// ─── Rendered markup as a tree ───

interface El { tag: string; attrs: Record<string, string>; classes: Set<string>; parent: El | null; children: (El | string)[] }

function el(tag: string, attrs: Record<string, string> = {}, parent: El | null = null): El {
  const node: El = { tag: tag.toLowerCase(), attrs, classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)), parent, children: [] };
  if (parent) parent.children.push(node);
  return node;
}
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});

/** Parses React's static markup, or an exported SVG file (well formed, quoted attributes). */
function parse(html: string): El {
  const root = el('root');
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--') || m[0].startsWith('<?')) continue;
    if (m[5] !== undefined) {
      cur.children.push(decode(m[5]));
      continue;
    }
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      if (cur.tag !== tag.toLowerCase()) throw new Error(`markup closes <${tag}> inside <${cur.tag}>`);
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const node = el(tag, attrs, cur);
    if (tag.toLowerCase() === 'style' || tag.toLowerCase() === 'script') {
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      node.children.push(html.slice(re.lastIndex, end));
      re.lastIndex = end + tag.length + 3;
      continue;
    }
    if (!selfClosing && !VOID.has(tag.toLowerCase())) cur = node;
  }
  if (cur !== root) throw new Error(`markup leaves <${cur.tag}> open`);
  return root;
}

const kids = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');
function* walk(e: El): Generator<El> {
  yield e;
  for (const c of kids(e)) yield* walk(c);
}
const findAll = (root: El, pred: (e: El) => boolean) => [...walk(root)].filter(pred);
const hasClass = (cls: string) => (e: El) => e.classes.has(cls);
const within = (e: El, outer: El) => {
  for (let p: El | null = e; p; p = p.parent) if (p === outer) return true;
  return false;
};
const text = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : text(c))).join('');
/** The text an element itself holds, not its children's. */
const ownText = (e: El) => e.children.filter((c): c is string => typeof c === 'string').join('').trim();
const num = (v: string | undefined) => Number.parseFloat(v ?? 'NaN');
const viewBoxOf = (svg: El) => (svg.attrs.viewBox ?? '').split(/[\s,]+/).map(Number);

/** An inline style as a property map. */
function inlineStyle(e: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (e.attrs.style ?? '').split(';')) {
    const at = decl.indexOf(':');
    if (at > 0) out[decl.slice(0, at).trim().toLowerCase()] = decl.slice(at + 1).trim();
  }
  return out;
}

// ─── What the stylesheet says about an element's width ───

/** App.css as rules: each rule's selector list and its declarations (rules inside at-rules included). */
function cssRules(css: string): { selectors: string[]; decls: [string, string][] }[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selectors: string[]; decls: [string, string][] }[] = [];
  let prelude = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '{') {
      const head = prelude.trim();
      prelude = '';
      if (head.startsWith('@')) continue; // an at-rule's block: the rules inside it are read as rules
      const end = source.indexOf('}', i);
      const decls = source.slice(i + 1, end).split(';').flatMap((d): [string, string][] => {
        const at = d.indexOf(':');
        return at > 0 ? [[d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim()]] : [];
      });
      rules.push({ selectors: head.split(',').map((s) => s.trim()), decls });
      i = end;
    } else if (c === '}' || c === ';') {
      prelude = '';
    } else {
      prelude += c;
    }
  }
  return rules;
}
const RULES = cssRules(APP_CSS);

/** The classes a selector's subject (its last compound) requires. */
const subjectClasses = (selector: string) => {
  const subject = selector.split(/\s*[\s>+~]\s*/).filter(Boolean).pop() ?? '';
  return [...subject.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
};

/**
 * The declarations that hold an element to a fixed width rather than letting it take its
 * container's: a width, inline size or maximum set in absolute units, or a flex basis in absolute
 * units that does not grow. Read from its inline style and from every stylesheet rule whose subject
 * classes it carries (whatever the rule's ancestors or at-rule), so none can slip by.
 */
function fixedWidths(e: El): string[] {
  const absolute = /^-?[\d.]+(px|em|rem|ch|pt|cm|mm|in)$/;
  const flagged: string[] = [];
  const check = (where: string, prop: string, value: string) => {
    const v = value.replace(/\s*!important$/, '').trim();
    if (/^(width|inline-size|max-width|max-inline-size|min-width|min-inline-size)$/.test(prop) && absolute.test(v) && !/^0(px)?$/.test(v)) {
      flagged.push(`${where} { ${prop}: ${v} }`);
    }
    if (prop === 'flex-basis' && absolute.test(v)) flagged.push(`${where} { ${prop}: ${v} }`);
    if (prop === 'flex') {
      const parts = v.split(/\s+/);
      if (parts.length === 3 && Number(parts[0]) === 0 && absolute.test(parts[2])) flagged.push(`${where} { flex: ${v} }`);
    }
  };
  for (const [prop, value] of Object.entries(inlineStyle(e))) check(`<${e.tag} style>`, prop, value);
  for (const rule of RULES) {
    for (const selector of rule.selectors) {
      const need = subjectClasses(selector);
      if (need.length && need.every((c) => e.classes.has(c))) for (const [prop, value] of rule.decls) check(selector, prop, value);
    }
  }
  return flagged;
}

/** The elements from `e` up to, but not including, `stop`. */
function pathUpTo(e: El, stop: El): El[] {
  const path: El[] = [];
  for (let p: El | null = e; p && p !== stop; p = p.parent) path.push(p);
  return path;
}

// ─── The studio ───

const byId = (id: string) => {
  const doc = SAMPLE_LIBRARY.find((d) => d.id === id);
  if (!doc) throw new Error(`sample library has no ${id}`);
  return doc;
};
const coxii = byId('doc-aln-coxii-cds'); // aligned, 50 nucleotide members of 684-705 bp

/** An aligned DNA set whose members have these ungapped lengths, padded with gaps to one width. */
function alignmentOfLengths(id: string, lengths: number[], name = (i: number) => `Member_${i + 1}`): SequenceDocument {
  const width = Math.max(...lengths);
  const base = 'ATGGCTAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAG';
  const residues = (n: number) => base.repeat(Math.ceil(n / base.length)).slice(0, n);
  return {
    ...EMPTY_WORKSPACE_DOCUMENT, id, name: id, sequence: residues(width), folder: 'Alignments', moleculeType: 'DNA', documentKind: 'alignment',
    alignmentMeta: { isAligned: true, sequences: lengths.map((n, i) => ({ id: `${id}-${i}`, name: name(i), sequence: residues(n).padEnd(width, '-') })) },
  } as unknown as SequenceDocument;
}

/** Seven members whose names are 30 characters long, as an imported GenBank set names them. */
const longNames = alignmentOfLengths('long-names', [120, 114, 120, 114, 120, 114, 120], (i) => `gi|62732${80 + i}|gb|AF1916${50 + i}.1|AF191`);

const studioProps = (doc: SequenceDocument, more: Partial<StudioProps> = {}): StudioProps =>
  ({ documents: [doc], projectDocuments: SAMPLE_LIBRARY, activeDoc: doc, ...more }) as StudioProps;

const box = (width: number, height: number) => ({
  getBoundingClientRect: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }),
});

/** The text a React element's children spell, for finding a control by its label. */
const childText = (children: unknown): string =>
  React.Children.toArray(children as React.ReactNode)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : React.isValidElement(c) ? childText((c.props as { children?: unknown }).children) : ''))
    .join('');

interface GelControls {
  ladder?: string;
  stain?: string;
  digest?: boolean;
}

/**
 * The studio with the gel open, its controls set through the handlers its render hands them, and
 * its ref handed `element` (or one measured `width` pixels wide). The Export Gel (SVG) button's
 * handler from the last render is returned with the markup.
 */
function renderGel(doc: SequenceDocument, opts: { width?: number; element?: object; controls?: GelControls }) {
  const c = opts.controls ?? {};
  let measured = false;
  let exportGelSvg: (() => void) | null = null;
  const done = { ladder: false, stain: false, digest: false };
  probe.onElement = (type, p) => {
    if (type === 'svg' && p.id === 'mbc-virtual-gel-svg' && !measured) {
      measured = true;
      if (typeof p.ref !== 'function') throw new Error(`the gel's ref is ${typeof p.ref}, not a callback that measures the drawn gel`);
      const width = opts.width ?? 0;
      (p.ref as (e: unknown) => void)(opts.element ?? box(width, width));
    }
    if (c.ladder && !done.ladder && type === 'select' && p.value === '10bp DNA Ladder') {
      done.ladder = true;
      (p.onChange as (e: unknown) => void)({ target: { value: c.ladder } });
    }
    if (c.stain && !done.stain && type === 'button' && childText(p.children).includes(c.stain)) {
      done.stain = true;
      (p.onClick as () => void)();
    }
    if (c.digest && !done.digest && type === 'label' && childText(p.children) === 'Digest by single enzymes') {
      const input = React.Children.toArray(p.children as React.ReactNode).find((k) => React.isValidElement(k) && k.type === 'input') as React.ReactElement | undefined;
      done.digest = true;
      ((input?.props as { onChange: (e: unknown) => void }).onChange)({ target: { checked: true } });
    }
    if (type === 'button' && childText(p.children) === 'Export Gel (SVG)') exportGelSvg = p.onClick as () => void;
  };
  let root: El;
  try {
    root = parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc, { initialInspectorTab: 'virtual-gel' } as Partial<StudioProps>)} />));
  } finally {
    probe.onElement = null;
  }
  expect(measured, `${doc.name}: the gel's ref was handed its element`).toBe(true);
  for (const k of Object.keys(done) as (keyof GelControls)[]) if (c[k]) expect(done[k], `${doc.name}: the ${k} control was set`).toBe(true);
  const svg = findAll(root, (e) => e.tag === 'svg' && e.attrs.id === 'mbc-virtual-gel-svg');
  expect(svg, `${doc.name}: one gel`).toHaveLength(1);
  return { root, svg: svg[0], exportGelSvg: exportGelSvg as (() => void) | null };
}

/** The studio with the Lengths Graph open, its chart measured `width` pixels wide, its Bins set to `bins`. */
function renderLengths(doc: SequenceDocument, width: number, bins?: number) {
  let measured = false;
  let binsSet = false;
  probe.onElement = (type, p) => {
    const cls = String(p.className ?? '');
    if (type === 'svg' && cls.split(/\s+/).includes('mbc-aln-lengths-chart') && !measured) {
      measured = true;
      if (typeof p.ref !== 'function') throw new Error(`the chart's ref is ${typeof p.ref}, not a callback that measures it`);
      (p.ref as (e: unknown) => void)(box(width, 240));
    }
    if (bins !== undefined && !binsSet && type === 'input' && p.type === 'number' && p.min === 4 && p.max === 24) {
      binsSet = true;
      (p.onChange as (e: unknown) => void)({ target: { value: String(bins) } });
    }
  };
  let root: El;
  try {
    root = parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(doc, { initialInspectorTab: 'lengths-graph' } as Partial<StudioProps>)} />));
  } finally {
    probe.onElement = null;
  }
  expect(measured, `${doc.name}: the lengths chart is drawn and measured at its panel's width`).toBe(true);
  if (bins !== undefined) expect(binsSet, `${doc.name}: the Bins field was set`).toBe(true);
  return root;
}

const inspectorBody = (root: El) => {
  const bodies = findAll(root, hasClass('mbc-aln-inspector-body'));
  expect(bodies).toHaveLength(1);
  return bodies[0];
};

/**
 * The inspector at the two window sizes the story names, measured in Chromium on the app with
 * COXII CDS open (project sidebar open, the document table at its default height) and the inspector
 * scrolled to the top of the studio's canvas: the gel's and the chart's drawn widths, how far below
 * the inspector's top the gel's drawing starts (the inspector's padding, the gel box's padding, and
 * the gel's heading and Export; its readout is under it), and the height of canvas the inspector is
 * seen in (rounded down).
 */
const WINDOWS = [
  { name: '1280x800', gelWidth: 470, gelTop: 56, chartWidth: 492, visible: 446 },
  { name: '1440x900', gelWidth: 478, gelTop: 56, chartWidth: 500, visible: 546 },
] as const;
/** Panel widths a resizable inspector can take, narrower and wider than the default. */
const OTHER_WIDTHS = [300, 700];

/** A label's box in drawing units, from the attributes it is drawn with (a generous width per character). */
function boxOf(t: El) {
  const size = num(t.attrs['font-size']);
  const x = num(t.attrs.x);
  const y = num(t.attrs.y);
  const chars = [...text(t)].length;
  const mono = /mono/.test(t.attrs['font-family'] ?? '');
  const w = chars * size * (mono ? 0.75 : 0.7) + chars * (num(t.attrs['letter-spacing']) || 0);
  const anchor = t.attrs['text-anchor'] ?? 'start';
  const [x0, x1] = anchor === 'end' ? [x - w, x] : anchor === 'middle' ? [x - w / 2, x + w / 2] : [x, x + w];
  const rotate = /rotate\(\s*-90\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(t.attrs.transform ?? '');
  if (rotate) return { left: x - 0.95 * size, right: x + 0.3 * size, top: y - (x1 - x), bottom: y - (x0 - x) };
  return { left: x0, right: x1, top: y - 0.95 * size, bottom: y + 0.3 * size };
}
const meet = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;

// ─── AC1 ───

describe('AC1: the whole virtual gel fits its panel', () => {
  // Wrong implementations this fails: the gel's view grown downward by its lane key (440 wide and
  // about 500 tall for five lanes, so at the inspector's width it is taller than the canvas it is
  // seen in, and its key falls off the bottom); a view whose height follows the label size (its
  // aspect changes with the panel's width); the figure held to 480px (a panel wider than that is
  // not filled); the key drawn below the figure in HTML (not part of the drawing); labels below the
  // 11px floor at a narrow panel, or meeting one another as the run shortens; a two-column key whose
  // long names run into the next column.
  it('fits the virtual gel and its lane key to the panel', () => {
    const cases: { name: string; doc: SequenceDocument; controls?: GelControls; lanes: string[] }[] = [
      { name: 'COXII CDS', doc: coxii, lanes: ['10bp DNA Ladder', ...coxii.alignmentMeta!.sequences!.slice(0, 4).map((m) => m.name)] },
      { name: 'COXII CDS, 1kb ladder', doc: coxii, controls: { ladder: '1kb DNA Ladder' }, lanes: ['1kb DNA Ladder', ...coxii.alignmentMeta!.sequences!.slice(0, 4).map((m) => m.name)] },
      // Six lanes, each named with its enzyme: the most the gel draws.
      { name: 'COXII CDS digested', doc: coxii, controls: { digest: true }, lanes: ['10bp DNA Ladder', ...coxii.alignmentMeta!.sequences!.slice(0, 5).map((m) => `${m.name} (EcoRI)`)] },
      { name: '30-character names', doc: longNames, lanes: ['10bp DNA Ladder', ...longNames.alignmentMeta!.sequences!.slice(0, 4).map((m) => m.name)] },
    ];
    for (const c of cases) {
      const viewBoxes = new Set<string>();
      const widths = [...WINDOWS.map((w) => w.gelWidth), ...OTHER_WIDTHS];
      for (const width of widths) {
        const window = WINDOWS.find((w) => w.gelWidth === width);
        const where = `${c.name}, gel ${width}px wide${window ? ` (${window.name})` : ''}`;
        const { root, svg } = renderGel(c.doc, { width, controls: c.controls });
        const body = inspectorBody(root);
        expect(within(svg, body), `${where}: the gel is in the inspector`).toBe(true);

        // It scales to the panel's width with its aspect kept: as wide as its container, its height
        // following its view, and nothing between it and the panel holding it to a fixed width.
        const [vx, vy, vw, vh] = viewBoxOf(svg);
        expect([vx, vy], `${where}: the view starts at the origin`).toEqual([0, 0]);
        expect(vw > vh, `${where}: the view (${vw}x${vh}) is wider than tall, so the gel fits the panel's height`).toBe(true);
        viewBoxes.add(svg.attrs.viewBox);
        const style = inlineStyle(svg);
        expect(style.width, `${where}: the gel fills its container`).toBe('100%');
        expect(style.height ?? 'auto', `${where}: its height follows its view`).toBe('auto');
        expect(svg.attrs.preserveAspectRatio ?? '', `${where}: its aspect is kept`).not.toBe('none');
        expect(pathUpTo(svg, body).flatMap(fixedWidths), `${where}: nothing holds the gel to a fixed width`).toEqual([]);
        expect('data-mbc-figure' in svg.parent!.attrs, `${where}: the gel is the figure its Export saves`).toBe(true);

        // The lane key sits inside the drawing: a row per lane, number and name, within the view.
        const lanesDrawn = findAll(svg, (e) => e.tag === 'rect' && e.attrs.height === '10' && e.attrs.rx === '2').length;
        const keyRows = findAll(svg, hasClass('mbc-virtual-gel-key-row'));
        expect(keyRows.length, `${where}: one key row per lane`).toBe(lanesDrawn);
        // A name the key's width cannot hold is cut short with an ellipsis; any other is in full.
        const named = (name: string) => (shown: string) => shown === name || (shown.endsWith('…') && shown.length >= 5 && name.startsWith(shown.slice(0, -1)));
        const rowsShown = keyRows.map((r) => findAll(r, (e) => e.tag === 'text').map(text));
        expect(rowsShown.map((r) => r[0]), `${where}: each row numbers its lane`).toEqual(c.lanes.map((_, i) => String(i + 1)));
        rowsShown.forEach((r, i) => expect(named(c.lanes[i])(r[1] ?? ''), `${where}: row ${i + 1} names "${c.lanes[i]}" (shows "${r[1]}")`).toBe(true));
        if (width >= WINDOWS[0].gelWidth) {
          expect(rowsShown.map((r) => r[1]), `${where}: at the inspector's width every lane is named in full`).toEqual(c.lanes);
        }
        const labels = findAll(svg, (e) => e.tag === 'text' && text(e).trim() !== '');
        const cathode = labels.filter((t) => text(t).trim() === '(-) CATHODE');
        expect(cathode, `${where}: the cathode label is drawn`).toHaveLength(1);
        for (const t of labels) {
          const b = boxOf(t);
          expect(b.top, `${where}: "${text(t)}" starts inside the view`).toBeGreaterThanOrEqual(0);
          expect(b.bottom, `${where}: "${text(t)}" ends inside the view`).toBeLessThanOrEqual(vh);
          expect(b.left, `${where}: "${text(t)}" starts inside the view`).toBeGreaterThanOrEqual(0);
        }
        const keyBottom = Math.max(...keyRows.flatMap((r) => findAll(r, (e) => e.tag === 'rect').map((r2) => num(r2.attrs.y) + num(r2.attrs.height))));
        expect(keyBottom, `${where}: the key's last row is inside the view`).toBeLessThanOrEqual(vh);

        // Legible at the width it is drawn: every label at least 11px on screen, and none meet.
        const scale = width / vw;
        for (const t of labels) expect(num(t.attrs['font-size']) * scale, `${where}: "${text(t)}" on screen (px)`).toBeGreaterThanOrEqual(11 - 1e-9);
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            expect(meet(boxOf(labels[i]), boxOf(labels[j])), `${where}: "${text(labels[i])}" and "${text(labels[j])}" do not meet`).toBe(false);
          }
        }

        // Whole in the panel without scrolling: from the top of the inspector to the key's last row.
        if (window) {
          const drawnHeight = width * (vh / vw);
          expect(window.gelTop + drawnHeight, `${where}: the gel's bottom, below the inspector's top (px), within the ${window.visible}px it is seen in`).toBeLessThanOrEqual(window.visible);
        }
      }
      expect([...viewBoxes], `${c.name}: one view at every width, so the aspect is kept`).toHaveLength(1);
    }
  });
});

// ─── AC2 ───

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
    private readonly size: { width: number; height: number } = { width: 0, height: 0 },
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
  fill(e: El): this {
    this.attrs.push(...Object.entries(e.attrs));
    this.append(...e.children.map((c) => (typeof c === 'string' ? c : new ExportNode(c.tag).fill(c))));
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
    const { width, height } = this.size;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 };
  }
  cloneNode(deep = false): ExportNode {
    const copy = new ExportNode(this.tagName, this.attrs.map(([n, v]): [string, string] => [n, v]), this.size);
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

/** The value of `prop` an exported file gives `e`: its inline style, its attribute, or an ancestor's. */
function fileValue(e: El, prop: string): string | null {
  for (let n: El | null = e; n && n.tag !== 'root'; n = n.parent) {
    const styled = inlineStyle(n)[prop];
    if (styled !== undefined) return styled;
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

describe('AC2: an exported gel is the same from every window', () => {
  it('exports the same virtual gel from every window size', async () => {
    // Wrong implementations this fails: the live, screen-scaled gel cloned into the file (its
    // labels 11.2 units from 1280x800, 11.05 from 1440x900, 17.6 from a narrow panel and 10 from a
    // wide one); the Export Gel (SVG) button still serializing the live gel while the Export menu
    // draws it at full size; labels set to full size while the gaps that keep them apart (and the
    // run they leave) keep the screen's scale; the file drawn for the unmeasured gel (11-unit
    // labels) rather than at full size; the file drawn from a stale state (the ladder, stain or
    // digest before the control was set); the file's drawing without the font it inherits from the
    // page; a view that follows the window, so the files differ in size.
    const FULL_SIZE_UNITS = 10; // the gel's label size drawn at full size
    const windows: [string, number][] = [
      ['1280x800', WINDOWS[0].gelWidth],
      ['1440x900', WINDOWS[1].gelWidth],
      ['a narrow panel', 300],
      ['a wide panel (drawn at full size)', 700],
      ['scrolled out of view (not measured)', 0],
    ];
    const FULL_SIZE_WINDOW = windows[3][0];
    const inverted = VIRTUAL_GEL_STAINS.find((s) => s.id === 'inverted')!;
    const cases: { name: string; doc: SequenceDocument; controls?: GelControls }[] = [
      { name: 'COXII CDS', doc: coxii },
      // State changes through the studio's own controls: the file draws the gel the screen shows.
      { name: 'COXII CDS, 1kb ladder on the light stain', doc: coxii, controls: { ladder: '1kb DNA Ladder', stain: inverted.shortName } },
      { name: 'COXII CDS digested, six lanes', doc: coxii, controls: { digest: true } },
      { name: '30-character names', doc: longNames },
    ];

    const html = new ExportNode('html');
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal('document', { documentElement: html });
    vi.stubGlobal('getComputedStyle', (node: ExportNode) => ({
      backgroundColor: node === html ? 'rgb(9, 13, 22)' : 'rgba(0, 0, 0, 0)',
      getPropertyValue: (prop: string) => node.computed(prop),
    }));
    vi.stubGlobal('XMLSerializer', class { serializeToString(node: ExportNode) { return node.serialize(); } });
    // The app's own save path: the macOS bundle's native Save panel is handed the file's contents.
    vi.stubGlobal('__MBC_MACOS_APP_BUNDLE__', true);
    vi.stubGlobal('webkit', { messageHandlers: { mbcNative: { postMessage: (m: Record<string, unknown>) => posted.push(m) } } });

    const svgOf = (file: string, label: string) => {
      const svg = findAll(parse(file), (e) => e.tag === 'svg')[0];
      if (!svg) expect.fail(`${label}: the file holds no <svg>`);
      return svg;
    };
    const labelsOf = (svg: El) => findAll(svg, (e) => e.tag === 'text').map((t) => ({
      text: text(t), x: num(t.attrs.x), y: num(t.attrs.y), size: num(fileValue(t, 'font-size') ?? undefined),
    }));

    for (const c of cases) {
      const exported: { where: string; file: string; button: string; svg: El; screen: El }[] = [];
      for (const [where, width] of windows) {
        const label = `${c.name}, from ${where}`;
        const live = new ExportNode('svg', [], { width, height: width * (340 / 480) });
        const { svg: screen, exportGelSvg } = renderGel(c.doc, { element: live, controls: c.controls });
        live.fill(screen);

        // The figure's Export menu, saving SVG.
        posted.length = 0;
        const result = await exportFigure({ svg: live as unknown as SVGSVGElement, baseName: 'Virtual Gel', title: 'Virtual gel' }, 'svg');
        expect(result.outcome, `${label}: the export was handed to the Save panel (${result.error ?? 'no error'})`).toBe('native');
        expect(posted.map((m) => m.type), `${label}: one file saved`).toEqual(['saveFile']);
        const file = String(posted[0].content);

        // The panel's Export Gel (SVG) button.
        probe.saved = [];
        if (!exportGelSvg) expect.fail(`${label}: no Export Gel (SVG) button`);
        exportGelSvg();
        expect(probe.saved.map((s) => s.mime), `${label}: the button saved one SVG file`).toEqual(['image/svg+xml;charset=utf-8']);
        const button = String(probe.saved[0].content);

        exported.push({ where, file, button, svg: svgOf(file, label), screen });
      }

      // The fixture reaches the screen's scaling: the screen draws its labels at different sizes
      // in these windows, so a file that copied the screen could not be the same from each.
      const screenSizes = new Set(exported.flatMap((x) => findAll(x.screen, (e) => e.tag === 'text').map((t) => t.attrs['font-size'])));
      expect(screenSizes.size, `${c.name}: the screen draws labels at ${[...screenSizes].join(', ')} units across these windows`).toBeGreaterThan(2);

      const [reference, ...others] = exported;
      for (const x of others) {
        expect(labelsOf(x.svg), `${c.name}: the labels exported from ${x.where} are those exported from ${reference.where}`).toEqual(labelsOf(reference.svg));
        expect(x.file, `${c.name}: the file exported from ${x.where} is the file exported from ${reference.where}`).toBe(reference.file);
      }
      for (const x of exported) {
        // The button's file is the gel the Export menu saves (its title aside, which names its source).
        const body = (f: string) => kids(svgOf(f, c.name)).filter((k) => k.tag !== 'title').map(drawn);
        expect(body(x.button), `${c.name}: Export Gel (SVG) from ${x.where} saves the gel the Export menu saves`).toEqual(body(reference.file));
      }

      // That one file is the gel drawn at its full-size label scale: every label at its full-size
      // units and every gap unscaled, exactly as the screen draws the gel where it has the room.
      const full = exported.find((x) => x.where === FULL_SIZE_WINDOW)!;
      const fileLabels = labelsOf(reference.svg);
      expect(fileLabels.length, `${c.name}: the file draws the lane, ladder and key labels`).toBeGreaterThan(10);
      for (const l of fileLabels) expect(l.size, `${c.name}: "${l.text}" in the file`).toBe(FULL_SIZE_UNITS);
      const fileDrawing = kids(reference.svg).filter((k) => k.tag !== 'title').slice(1); // after the file's background
      // The file carries the page's values for the stylesheet variables a drawing names (this page
      // sets none, so each takes its fallback).
      const pageValues = (d: Drawn): Drawn =>
        typeof d === 'string'
          ? d
          : { ...d, attrs: Object.fromEntries(Object.entries(d.attrs).map(([k, v]) => [k, v.replace(/var\(\s*--[\w-]+\s*(?:,\s*([^)]*))?\)/g, (_m, fb: string | undefined) => (fb ?? '').trim())])), children: d.children.map(pageValues) };
      expect(fileDrawing.map(drawn), `${c.name}: the file draws the gel the screen shows at full size`).toEqual(kids(full.screen).map(drawn).map(pageValues));
      expect(reference.svg.attrs.viewBox, `${c.name}: in the gel's own view`).toBe(full.screen.attrs.viewBox);
      const [, , vw, vh] = viewBoxOf(full.screen);
      expect([reference.svg.attrs.width, reference.svg.attrs.height], `${c.name}: at the view's size`).toEqual([String(vw), String(vh)]);
      for (const t of findAll(reference.svg, (e) => e.tag === 'text')) {
        // Ladder sizes name their own (monospaced) face; every other label keeps the page's font.
        const own = t.attrs['font-family'];
        expect(fileValue(t, 'font-family'), `${c.name}: "${text(t)}" keeps its font in the file`).toBe(own ?? PAGE_FONT);
        if (own) expect(own, `${c.name}: "${text(t)}" names a face the file can use`).not.toMatch(/var\(/);
      }
    }
  });
});

// ─── AC3 ───

/** The lengths chart's parts, read back from its markup. */
function readChart(root: El) {
  const charts = findAll(root, (e) => e.tag === 'svg' && e.classes.has('mbc-aln-lengths-chart'));
  expect(charts, 'one lengths chart').toHaveLength(1);
  const svg = charts[0];
  const countAxis = findAll(svg, hasClass('mbc-aln-lengths-count-axis'));
  const lengthAxis = findAll(svg, hasClass('mbc-aln-lengths-length-axis'));
  expect([countAxis.length, lengthAxis.length], 'one count axis and one length axis').toEqual([1, 1]);
  const plot = { left: num(lengthAxis[0].attrs.x1), right: num(lengthAxis[0].attrs.x2), top: num(countAxis[0].attrs.y1), bottom: num(countAxis[0].attrs.y2) };
  expect(num(countAxis[0].attrs.x1), 'the axes meet at the origin').toBe(plot.left);
  expect(num(lengthAxis[0].attrs.y1), 'the axes meet at the origin').toBe(plot.bottom);
  const countTicks = findAll(svg, hasClass('mbc-aln-lengths-count-tick')).map((t) => ({ label: text(t), y: num(t.attrs.y) }));
  const lengthTicks = findAll(svg, hasClass('mbc-aln-lengths-length-tick')).map((t) => ({ label: text(t), x: num(t.attrs.x) }));
  const bars = findAll(svg, hasClass('mbc-aln-lengths-bar')).map((r) => {
    const title = findAll(r, (e) => e.tag === 'title').map(text)[0] ?? '';
    const m = /^([\d,]+)(?:–([\d,]+))? (bp|aa): (\d+) sequences?$/.exec(title);
    if (!m) expect.fail(`a bar's tooltip reads "${title}"`);
    const n = (s: string) => Number(s.replace(/,/g, ''));
    return { x: num(r.attrs.x), y: num(r.attrs.y), width: num(r.attrs.width), height: num(r.attrs.height), first: n(m[1]), last: n(m[2] ?? m[1]), count: Number(m[4]) };
  });
  return { svg, plot, countTicks, lengthTicks, bars };
}

const ungapped = (s: string) => s.replace(/[-.]/g, '').length;
/** The gap, in pixels, a bar keeps from each edge of its bin so neighbouring bars read apart. */
const BAR_GUTTER = 1;
const lengthsOf = (doc: SequenceDocument) => doc.alignmentMeta!.sequences!.map((m) => ungapped(m.sequence));

describe('AC3: the lengths graph is readable and spans the data', () => {
  // Wrong implementations this fails: the chart drawn in a fixed 720-unit view (its 10-unit text is
  // about 6.8px in a 492px panel), or held to 720px or 820px; count ticks at round(i/6 x max)
  // (6, 13, 19, 25, 32, 38 for COXII); whole-number tick labels over bars still scaled to the
  // largest bin rather than to the axis; a length axis from the shortest rounded down to ten (680)
  // or the longest rounded up (710); bins over that rounded range, so a bar is not over the lengths
  // its tooltip names; fractional bins that hold no whole length.
  it('draws the lengths graph with readable whole-number axes over the data range', () => {
    const cases: { name: string; doc: SequenceDocument; bins?: number }[] = [
      { name: 'COXII CDS', doc: coxii },
      { name: 'COXII CDS, 24 bins', doc: coxii, bins: 24 },
      // A largest bin of 7, so the count axis steps by 2 to 8.
      { name: 'seven of one length', doc: alignmentOfLengths('seven-of-one', [100, 100, 100, 100, 100, 100, 100, 117, 117, 140, 140, 140]) },
      // Lengths in the thousands, written with separators on the axis.
      { name: 'lengths in the thousands', doc: alignmentOfLengths('thousands', [120, 480, 950, 1234, 1234, 2345, 1777]) },
      // Every member one length: the axis is that length.
      { name: 'one length', doc: alignmentOfLengths('one-length', [250, 250, 250, 250]) },
    ];
    const coxiiLengths = lengthsOf(coxii);
    // The fixture reaches the reported defects: COXII's shortest member is not a multiple of ten.
    expect(Math.min(...coxiiLengths) % 10, 'COXII CDS: the shortest member is not a round ten').not.toBe(0);
    expect(Math.max(...coxiiLengths) % 10, 'COXII CDS: the longest member is not a round ten').not.toBe(0);

    for (const c of cases) {
      const lengths = lengthsOf(c.doc);
      const shortest = Math.min(...lengths);
      const longest = Math.max(...lengths);
      for (const width of [...WINDOWS.map((w) => w.chartWidth), ...OTHER_WIDTHS]) {
        const where = `${c.name}, chart ${width}px wide`;
        const root = renderLengths(c.doc, width, c.bins);
        const body = inspectorBody(root);
        const { svg, plot, countTicks, lengthTicks, bars } = readChart(root);
        expect(within(svg, body), `${where}: the chart is in the inspector`).toBe(true);

        // It fills the panel's width, drawn at one unit to a pixel.
        const [, , vw] = viewBoxOf(svg);
        expect(vw, `${where}: the chart's view is as wide as its panel`).toBe(width);
        expect(inlineStyle(svg).width, `${where}: the chart fills its container`).toBe('100%');
        expect(pathUpTo(svg, body).flatMap(fixedWidths), `${where}: nothing holds the chart to a fixed width`).toEqual([]);
        expect(plot.right - plot.left, `${where}: the plot spans most of the chart`).toBeGreaterThan(width * 0.75);

        // Its axis text is at least 11px.
        const texts = findAll(svg, (e) => e.tag === 'text');
        expect(texts.length, `${where}: the axes are labelled`).toBeGreaterThan(4);
        for (const t of texts) expect(num(t.attrs['font-size']) * (width / vw), `${where}: "${text(t)}" on screen (px)`).toBeGreaterThanOrEqual(11);

        // The count axis: whole numbers from 0 in one 1, 2 or 5 x 10^k step, evenly placed, over the largest bin.
        const counts = countTicks.map((t) => Number(t.label.replace(/,/g, '')));
        for (const t of countTicks) expect(t.label, `${where}: count tick`).toMatch(/^\d{1,3}(,\d{3})*$/);
        expect(counts[0], `${where}: the count axis starts at 0`).toBe(0);
        const step = counts[1] - counts[0];
        expect(step, `${where}: the count step`).toBeGreaterThanOrEqual(1);
        expect(String(step), `${where}: the count step is 1, 2 or 5 times a power of ten`).toMatch(/^[125]0*$/);
        counts.forEach((v, i) => expect(v, `${where}: count tick ${i}`).toBe(i * step));
        const maxCount = Math.max(...bars.map((b) => b.count));
        const top = counts[counts.length - 1];
        expect(top, `${where}: the top tick is over the largest bin (${maxCount})`).toBeGreaterThanOrEqual(maxCount);
        expect(top - step, `${where}: the axis ends at the first tick over the largest bin`).toBeLessThan(maxCount);
        const pxPerCount = (plot.bottom - plot.top) / top;
        countTicks.forEach((t, i) => expect(t.y - 4, `${where}: count tick ${counts[i]} sits at its height`).toBeCloseTo(plot.bottom - counts[i] * pxPerCount, 6));

        // The length axis: from the shortest member at its left end to the longest at its right.
        const values = lengthTicks.map((t) => Number(t.label.replace(/,/g, '')));
        for (const t of lengthTicks) expect(t.label, `${where}: length tick`).toBe(Number(t.label.replace(/,/g, '')).toLocaleString());
        expect(values[0], `${where}: the length axis starts at the shortest member`).toBe(shortest);
        expect(values[values.length - 1], `${where}: and ends at the longest`).toBe(longest);
        const xOf = (v: number) => (shortest === longest ? (plot.left + plot.right) / 2 : plot.left + ((v - shortest) / (longest - shortest)) * (plot.right - plot.left));
        lengthTicks.forEach((t, i) => expect(t.x, `${where}: length tick ${t.label} sits at its length`).toBeCloseTo(xOf(values[i]), 6));
        if (shortest !== longest) {
          expect(lengthTicks[0].x, `${where}: the shortest member is at the axis's left end`).toBeCloseTo(plot.left, 6);
          expect(lengthTicks[lengthTicks.length - 1].x, `${where}: the longest at its right end`).toBeCloseTo(plot.right, 6);
        }
        for (let i = 1; i < lengthTicks.length; i++) {
          const gap = lengthTicks[i].x - lengthTicks[i - 1].x;
          const room = ((lengthTicks[i].label.length + lengthTicks[i - 1].label.length) / 2) * 0.62 * 11;
          expect(gap, `${where}: length labels ${lengthTicks[i - 1].label} and ${lengthTicks[i].label} clear each other`).toBeGreaterThan(room);
        }

        // Every bar stands over the whole lengths it holds, and is as tall as its count on the axis.
        expect(bars.reduce((s, b) => s + b.count, 0), `${where}: the bars hold every member`).toBe(lengths.length);
        for (const b of bars) {
          const held = lengths.filter((v) => v >= b.first && v <= b.last).length;
          expect(b.count, `${where}: the bar for ${b.first}-${b.last} counts the members of those lengths`).toBe(held);
          expect(b.height, `${where}: the bar for ${b.first}-${b.last} is ${b.count} on the count axis`).toBeCloseTo(b.count * pxPerCount, 6);
          expect(b.y + b.height, `${where}: the bar stands on the length axis`).toBeCloseTo(plot.bottom, 6);
          // Neighbouring bars are drawn a gutter apart, so a bar's edge may sit that far inside its range's.
          expect(b.x - BAR_GUTTER, `${where}: the bar for ${b.first}-${b.last} starts at or before ${b.first}`).toBeLessThanOrEqual(xOf(b.first) + 1e-6);
          expect(b.x + b.width + BAR_GUTTER, `${where}: and ends at or after ${b.last}`).toBeGreaterThanOrEqual(xOf(b.last) - 1e-6);
          expect(b.x, `${where}: the bar is on the plot`).toBeGreaterThanOrEqual(plot.left);
          expect(b.x + b.width, `${where}: the bar is on the plot`).toBeLessThanOrEqual(plot.right);
        }
        const firsts = bars.map((b) => b.first);
        expect(firsts, `${where}: the bars are in length order`).toEqual([...firsts].sort((a, b) => a - b));
        for (let i = 1; i < bars.length; i++) expect(bars[i].first, `${where}: no length falls between two bars`).toBeGreaterThan(bars[i - 1].last);
        if (c.bins !== undefined) {
          // Asked for more bins than there are lengths in the range: one bin to a length.
          expect(bars.every((b) => b.first === b.last), `${where}: ${c.bins} bins over ${longest - shortest + 1} lengths`).toBe(true);
        }
      }
    }
  });
});

// ─── AC4 ───

describe('AC4: one title per view, and the statistics across the panel', () => {
  /** The headings in the inspector body: heading elements, heading roles and the inspector's title row. */
  const headings = (body: El) =>
    findAll(body, (e) => /^h[1-6]$/.test(e.tag) || e.attrs.role === 'heading' || e.classes.has('mbc-aln-inspector-title')).map((e) => text(e).trim());

  // Wrong implementations this fails: the inspector's title row kept over the view's own heading
  // ("Lengths Graph" or "Virtual Gel" twice); a chart title inside the drawing ("Sequence Lengths
  // for 50 Sequences"); a box heading that repeats the view's name; the statistics in a 220px card
  // beside the chart (half the panel, below the fold), or before the chart.
  it('shows one title and full-width length statistics', () => {
    for (const width of WINDOWS.map((w) => w.chartWidth)) {
      // The Lengths Graph.
      const root = renderLengths(coxii, width);
      const body = inspectorBody(root);
      expect(headings(body), `lengths graph at ${width}px: one title`).toEqual(['Sequence Length Distribution']);
      const { svg } = readChart(root);
      const axisWords = new Set(['Number of Sequences', 'Sequence Length (bp)']);
      for (const t of findAll(svg, (e) => e.tag === 'text')) {
        const words = text(t).trim();
        const isTick = t.classes.has('mbc-aln-lengths-count-tick') || t.classes.has('mbc-aln-lengths-length-tick');
        expect(isTick || axisWords.has(words), `lengths graph at ${width}px: "${words}" in the chart is an axis label, not a title`).toBe(true);
      }
      const titleLike = findAll(body, (e) => /distribution|lengths? (graph|for)/i.test(ownText(e)));
      expect(titleLike.map((e) => `<${e.tag}> ${ownText(e)}`), `lengths graph at ${width}px: nothing else titles the view`).toEqual(['<h4> Sequence Length Distribution']);

      // Its statistics: under the chart, in the same column, with nothing holding them to a width.
      const rows = findAll(body, hasClass('mbc-aln-stat-kv'));
      expect(rows.map((r) => text(kids(r)[0])), `lengths graph at ${width}px: the statistics`).toEqual(['Sequences:', 'Minimum:', 'Maximum:', 'Mean:', 'Std Dev:']);
      const stats = rows[0].parent!;
      expect(rows.every((r) => r.parent === stats), `lengths graph at ${width}px: the statistics sit together`).toBe(true);
      const figure = svg.parent!;
      expect('data-mbc-figure' in figure.attrs, `lengths graph at ${width}px: the chart's figure`).toBe(true);
      expect(stats.parent, `lengths graph at ${width}px: the statistics share the chart's column`).toBe(figure.parent);
      const column = kids(figure.parent!);
      expect(column.indexOf(stats), `lengths graph at ${width}px: the statistics come under the chart`).toBeGreaterThan(column.indexOf(figure));
      expect(pathUpTo(stats, body).flatMap(fixedWidths), `lengths graph at ${width}px: nothing holds the statistics to a fixed width`).toEqual([]);
      const columnRule = RULES.filter((r) => r.selectors.some((s) => { const need = subjectClasses(s); return need.length > 0 && need.every((cl) => figure.parent!.classes.has(cl)); }));
      const declared = Object.fromEntries(columnRule.flatMap((r) => r.decls));
      expect([declared.display, declared['flex-direction']], `lengths graph at ${width}px: the chart and its statistics stack in one column, each across it`).toEqual(['flex', 'column']);
      expect(declared['align-items'] ?? 'stretch', `lengths graph at ${width}px: each stretches across the column`).toBe('stretch');

      // The Virtual Gel.
      const gel = renderGel(coxii, { width: WINDOWS.find((w) => w.chartWidth === width)!.gelWidth });
      const gelBody = inspectorBody(gel.root);
      expect(headings(gelBody), `virtual gel: one title`).toEqual(['Virtual Gel']);
      const named = findAll(gelBody, (e) => /virtual gel/i.test(ownText(e)));
      expect(named.map((e) => `<${e.tag}> ${ownText(e)}`), 'virtual gel: nothing else titles the view').toEqual(['<h4> Virtual Gel']);
    }
  });
});

// ─── US-01M6T9QY: each stain button is its stain's colour and name ───

type GelStainConfig = import('../components/AlignmentAndPhyloStudio').GelStainConfig;
/** `npx tsc --noEmit` fails on this line if GelStainConfig carries a badge field again. */
const STAIN_CONFIG_HAS_BADGE: 'badge' extends keyof GelStainConfig ? true : false = false;

/**
 * The stain buttons in Gel & Darkroom Controls, in the order they are drawn: each button in the box
 * whose text holds one stain's short name, so a button that has lost its accessible name is still found.
 */
function stainButtons(root: El, label: string) {
  const boxes = findAll(root, hasClass('mbc-aln-gel-controls'));
  expect(boxes, `${label}: one Gel & Darkroom Controls box`).toHaveLength(1);
  const buttons = findAll(boxes[0], (e) => e.tag === 'button')
    .map((b) => ({ b, stains: VIRTUAL_GEL_STAINS.filter((s) => text(b).includes(s.shortName)) }))
    .filter((x) => x.stains.length > 0);
  expect(buttons.map((x) => x.stains.map((s) => s.id)), `${label}: one button per stain, in the presets' order`)
    .toEqual(VIRTUAL_GEL_STAINS.map((s) => [s.id]));
  return buttons.map((x) => x.b);
}

/** A length in px from an inline style value (`14px`), or NaN. */
const px = (v: string | undefined) => (/^[\d.]+px$/.test(v ?? '') ? Number.parseFloat(v!) : Number.NaN);
/** The colour an element is filled with by its inline style. */
const fillOf = (e: El) => {
  const s = inlineStyle(e);
  return s['background-color'] ?? s.background;
};

interface PressedRender {
  root: El;
  svg: El;
  /** The studio's own state on each pass of the render: each state's setter to its initial and current value. */
  passes: Map<unknown, { initial: unknown; value: unknown }>[];
  /** The pass (an index into `passes`) each stain was pressed in. */
  pressedIn: number[];
}

/**
 * The studio with the gel open after pressing these stains' buttons in turn, one on each pass of the
 * render, through the handlers its render hands them (found by their short name). A pass begins
 * when the studio's first state is read again; a child's state comes after the studio's last pass.
 */
function renderPressing(stains: GelStainConfig[]): PressedRender {
  const passes: PressedRender['passes'] = [];
  const pressedIn: number[] = [];
  let firstSetter: unknown = null;
  let measured = false;
  probe.onState = (initial, value, setter) => {
    if (firstSetter === null) firstSetter = setter;
    if (setter === firstSetter) passes.push(new Map());
    passes[passes.length - 1]?.set(setter, { initial, value });
  };
  probe.onElement = (type, p) => {
    if (type === 'svg' && p.id === 'mbc-virtual-gel-svg' && !measured) {
      measured = true;
      (p.ref as (e: unknown) => void)(box(WINDOWS[0].gelWidth, WINDOWS[0].gelWidth));
    }
    const next = stains[pressedIn.length];
    const pass = passes.length - 1;
    if (next && pass > (pressedIn.length ? pressedIn[pressedIn.length - 1] : -1) && type === 'button' && childText(p.children).includes(next.shortName)) {
      pressedIn.push(pass);
      (p.onClick as () => void)();
    }
  };
  let root: El;
  try {
    root = parse(renderToStaticMarkup(<SequenceAlignmentStudio {...studioProps(coxii, { initialInspectorTab: 'virtual-gel' } as Partial<StudioProps>)} />));
  } finally {
    probe.onElement = null;
    probe.onState = null;
  }
  expect(pressedIn.length, `each of ${stains.map((s) => s.shortName).join(', ') || 'no stain'} was pressed in turn`).toBe(stains.length);
  const svg = findAll(root, (e) => e.tag === 'svg' && e.attrs.id === 'mbc-virtual-gel-svg');
  expect(svg, 'one gel').toHaveLength(1);
  return { root, svg: svg[0], passes, pressedIn };
}

// ─── How an element is coloured in each theme, from App.css as the browser resolves it ───

const normColour = (v: string) => {
  const s = v.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : s;
};

/** DESIGN.md's front-matter colours, by name. */
const DESIGN_COLOURS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const lines = DESIGN_MD.split(/\r?\n/);
  let inColours = false;
  for (const line of lines.slice(1)) {
    if (line === '---') break;
    if (/^\S/.test(line)) {
      inColours = line.startsWith('colors:');
      continue;
    }
    const m = inColours ? /^\s+([\w-]+):\s*"(#[0-9a-f]{3,8})"/i.exec(line) : null;
    if (m) out[m[1]] = normColour(m[2]);
  }
  return out;
})();
const design = (name: string) => {
  const v = DESIGN_COLOURS[name];
  if (!v) throw new Error(`DESIGN.md's front matter names no colour ${name}`);
  return v;
};

/**
 * One compound of a selector (`button.method-tab-btn.active`, `[aria-pressed="true"]`, `:root`), or
 * null for one this reader does not model: a state the static render cannot be in (:hover,
 * :focus-visible), :not(), an id or the universal selector. Such a selector is taken not to match.
 */
function compoundOf(sel: string) {
  const m = /^([a-z][\w-]*)?((?:\.[\w-]+|\[[\w-]+(?:=(?:"[^"]*"|'[^']*'))?\]|:root)*)$/i.exec(sel);
  if (!m || !sel) return null;
  const parts = m[2];
  return {
    tag: m[1]?.toLowerCase(),
    classes: [...parts.matchAll(/\.([\w-]+)/g)].map((x) => x[1]),
    attrs: [...parts.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/g)].map((x) => [x[1], x[2] ?? x[3]] as const),
    root: parts.includes(':root'),
  };
}
type Compound = NonNullable<ReturnType<typeof compoundOf>>;
/** A selector as its compounds (descendant combinators only), or null for one this reader does not model. */
function selectorOf(text: string): Compound[] | null {
  if (/[>+~*#]/.test(text)) return null;
  const compounds = text.split(/\s+/).map(compoundOf);
  return compounds.some((c) => c === null) ? null : (compounds as Compound[]);
}

interface TopRule {
  selectors: { text: string; compounds: Compound[] | null }[];
  decls: { prop: string; value: string; important: boolean }[];
}
/**
 * App.css's rules outside every at-rule, in source order. An @media or @supports block applies only
 * under its condition (a window width, forced colours, more contrast, the system theme), so its rules
 * are left out; @font-face and @property hold no rule.
 */
function topLevelRules(css: string): TopRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: TopRule[] = [];
  let prelude = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c !== '{') {
      prelude = c === ';' || c === '}' ? '' : prelude + c;
      continue;
    }
    const head = prelude.trim();
    prelude = '';
    let depth = 1;
    let j = i + 1;
    for (; j < src.length && depth > 0; j++) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
    if (!head.startsWith('@')) {
      const decls = src.slice(i + 1, j - 1).split(';').flatMap((d) => {
        const at = d.indexOf(':');
        if (at <= 0) return [];
        const raw = d.slice(at + 1).trim();
        return [{ prop: d.slice(0, at).trim().toLowerCase(), value: raw.replace(/\s*!important$/, ''), important: /!important$/.test(raw) }];
      });
      rules.push({ selectors: head.split(',').map((s) => s.trim()).map((text) => ({ text, compounds: selectorOf(text) })), decls });
    }
    i = j - 1;
  }
  return rules;
}
const TOP_RULES = topLevelRules(APP_CSS);

const compoundMatches = (c: Compound, e: El, isRoot: boolean) =>
  (!c.root || isRoot) && (!c.tag || c.tag === e.tag) && c.classes.every((k) => e.classes.has(k))
  && c.attrs.every(([a, v]) => (v === undefined ? a in e.attrs : e.attrs[a] === v));

/** The specificity [classes, tags] of a selector that matches `path`'s last element, or null. */
function specificityAt(cs: Compound[] | null, path: El[]): [number, number] | null {
  if (!cs) return null;
  let k = path.length - 1;
  if (!compoundMatches(cs[cs.length - 1], path[k], k === 0)) return null;
  for (let ci = cs.length - 2; ci >= 0; ci--) {
    do k--; while (k >= 0 && !compoundMatches(cs[ci], path[k], k === 0));
    if (k < 0) return null;
  }
  return [cs.reduce((n, c) => n + c.classes.length + c.attrs.length + (c.root ? 1 : 0), 0), cs.filter((c) => c.tag).length];
}

/** A value's space-separated parts, keeping each function call (`var(--a, #fff)`) whole. */
function valueParts(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const NOT_A_BORDER_COLOUR = /^(-?[\d.]+(px|em|rem)?|thin|medium|thick|none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i;

/** A declaration as the longhands this reader resolves: a background's colour, a border's colour. */
function longhands(prop: string, value: string): [string, string][] {
  if (prop === 'background') {
    const parts = valueParts(value);
    return [['background-color', parts.length === 1 && !/gradient\(|url\(/i.test(parts[0]) ? parts[0] : 'transparent']];
  }
  if (prop === 'border') return [['border-color', valueParts(value).filter((t) => !NOT_A_BORDER_COLOUR.test(t)).join(' ') || 'currentcolor']];
  if (prop === 'border-color') return [['border-color', valueParts(value)[0] ?? value]];
  return [[prop, value]];
}

/** Whether rank `a` beats rank `b`, compared element by element. */
const outranks = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/** Each declared property's cascaded value on `path`'s last element: importance, then inline, then specificity, then source order. */
function cascaded(path: El[]): Map<string, string> {
  const best = new Map<string, { value: string; rank: number[] }>();
  const offer = (prop: string, value: string, rank: number[]) => {
    const had = best.get(prop);
    if (!had || outranks(rank, had.rank)) best.set(prop, { value, rank });
  };
  let order = 0;
  for (const rule of TOP_RULES) {
    const specs = rule.selectors.map((s) => specificityAt(s.compounds, path)).filter((s): s is [number, number] => s !== null);
    const spec = specs.sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
    for (const d of rule.decls) {
      order++;
      if (spec) for (const [p, v] of longhands(d.prop, d.value)) offer(p, v, [d.important ? 1 : 0, 0, spec[0], spec[1], order]);
    }
  }
  for (const [prop, raw] of Object.entries(inlineStyle(path[path.length - 1]))) {
    order++;
    const important = /!important$/.test(raw);
    for (const [p, v] of longhands(prop, raw.replace(/\s*!important$/, ''))) offer(p, v, [important ? 1 : 0, 1, 0, 0, order]);
  }
  return new Map([...best].map(([p, w]) => [p, w.value]));
}

/** `value` with each var() replaced from `lookup` (or its fallback), or undefined if one has neither. */
function substitute(value: string, lookup: (name: string) => string | undefined): string | undefined {
  const at = value.indexOf('var(');
  if (at < 0) return value;
  let depth = 0;
  let end = at + 4;
  for (; end < value.length; end++) {
    if (value[end] === '(') depth++;
    else if (value[end] === ')' && depth-- === 0) break;
  }
  const inner = value.slice(at + 4, end);
  const comma = inner.indexOf(',');
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
  const got = lookup(name) ?? (fallback === undefined ? undefined : substitute(fallback, lookup));
  if (got === undefined) return undefined;
  return substitute(value.slice(0, at) + got + value.slice(end + 1), lookup);
}

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];
/** The document above the studio in each theme: the workbench (App.tsx) takes `mbc-dark-mode` in the dark. */
const ABOVE_STUDIO: Record<Theme, El[]> = (() => {
  const top = (theme: Theme) => {
    const html = el('html');
    const body = el('body', {}, html);
    return [html, body, el('div', { class: theme === 'dark' ? 'mbc-workbench mbc-dark-mode' : 'mbc-workbench' }, body)];
  };
  return { light: top('light'), dark: top('dark') };
})();

interface Computed { own: Map<string, string>; custom: Map<string, string>; color: string }
const COMPUTED: Record<Theme, WeakMap<El, Computed>> = { light: new WeakMap(), dark: new WeakMap() };

/** The cascaded declarations, resolved custom properties and text colour of `path`'s last element. */
function computedAt(path: El[], theme: Theme): Computed {
  const e = path[path.length - 1];
  const hit = COMPUTED[theme].get(e);
  if (hit) return hit;
  const parent: Computed = path.length > 1 ? computedAt(path.slice(0, -1), theme) : { own: new Map(), custom: new Map(), color: 'canvastext' };
  const own = cascaded(path);
  // Custom properties inherit; one declared here resolves its var() here.
  const raw = new Map(parent.custom);
  for (const [p, v] of own) if (p.startsWith('--')) raw.set(p, v);
  const custom = new Map<string, string>();
  const resolving = new Set<string>();
  const get = (name: string): string | undefined => {
    if (custom.has(name)) return custom.get(name);
    if (!raw.has(name) || resolving.has(name)) return undefined;
    resolving.add(name);
    const v = substitute(raw.get(name)!, get);
    resolving.delete(name);
    if (v !== undefined) custom.set(name, v);
    return v;
  };
  for (const name of raw.keys()) get(name);
  const c = own.get('color');
  const cv = c === undefined ? undefined : substitute(c, (n) => custom.get(n));
  const out = { own, custom, color: cv === undefined || cv === 'inherit' ? parent.color : cv };
  COMPUTED[theme].set(e, out);
  return out;
}

/** An element's fill, text and border colours in a theme, from its inline style and App.css's rules. */
function coloursOf(e: El, theme: Theme) {
  const studio: El[] = [];
  for (let p: El | null = e; p && p.tag !== 'root'; p = p.parent) studio.unshift(p);
  const { own, custom, color } = computedAt([...ABOVE_STUDIO[theme], ...studio], theme);
  const value = (prop: string, initial: string) => {
    const v = own.get(prop);
    const sv = v === undefined ? undefined : substitute(v, (n) => custom.get(n));
    return normColour(sv === undefined || /^currentcolor$/i.test(sv) ? (initial === 'currentcolor' ? color : initial) : sv);
  };
  return { background: value('background-color', 'transparent'), color: normColour(color), border: value('border-color', 'currentcolor') };
}

/** A custom property App.css sets on the workbench in a theme: its top-level :root, then .mbc-dark-mode in the dark. */
function themeToken(name: string, theme: Theme) {
  const holders = theme === 'dark' ? [':root', '.mbc-dark-mode'] : [':root'];
  let v: string | undefined;
  for (const holder of holders) {
    for (const rule of TOP_RULES) if (rule.selectors.some((s) => s.text === holder)) for (const d of rule.decls) if (d.prop === name) v = d.value;
  }
  return v === undefined ? undefined : normColour(v);
}

describe('US-01M6T9QY AC1: each stain button is its colour and name, with no icon', () => {
  // Wrong implementations this fails: the emoji badge kept beside the name (🔥 ✨ 🌿 🔴 📄); the
  // badge swapped for a lucide icon (an <svg>) or an image; one swatch colour for every button, or
  // the pressed stain's colours on every swatch (currentStain for stain); the swatch filled with the
  // button's active colour or the band's glow rather than the gel's background; a swatch with no
  // band, or a band that fills it; the band's colour outside and the gel's inside; the name before
  // the swatch, or dropped; the accessible name left as the short name; the badge field kept on the
  // presets. Rendered at rest (EtBr pressed) and with the print stain pressed, so every swatch is
  // checked whichever stain is pressed.
  it('shows each stain button as its colour and name with no icon', () => {
    expect(new Set(VIRTUAL_GEL_STAINS.map((s) => s.gelBg)).size, 'the stains have five distinct gel colours').toBe(VIRTUAL_GEL_STAINS.length);
    expect(new Set(VIRTUAL_GEL_STAINS.map((s) => s.bandBody)).size, 'the stains have five distinct band colours').toBe(VIRTUAL_GEL_STAINS.length);
    expect(VIRTUAL_GEL_STAINS.filter((s) => 'badge' in s).map((s) => s.id), 'no stain preset carries a badge').toEqual([]);
    expect(STAIN_CONFIG_HAS_BADGE, 'the GelStainConfig type has no badge field').toBe(false);

    const inverted = VIRTUAL_GEL_STAINS.find((s) => s.id === 'inverted')!;
    const renders: [string, GelControls | undefined][] = [['at rest', undefined], ['with the print stain pressed', { stain: inverted.shortName }]];
    for (const [label, controls] of renders) {
      const { root } = renderGel(coxii, { width: WINDOWS[0].gelWidth, controls });
      stainButtons(root, label).forEach((button, i) => {
        const stain = VIRTUAL_GEL_STAINS[i];
        const where = `${label}, ${stain.shortName}`;
        // BG-01M6TA8Q: the accessible name begins with the short name shown, then the full name.
        expect(button.attrs['aria-label'], `${where}: its accessible name is its short name, then the stain's full name`).toBe(`${stain.shortName}, ${stain.name}`);
        expect(findAll(button, (e) => e.tag === 'svg' || e.tag === 'img').map((e) => e.tag), `${where}: no icon or image`).toEqual([]);
        expect(text(button).trim(), `${where}: its text is its short name alone, with no badge character`).toBe(stain.shortName);
        expect(/\p{Extended_Pictographic}/u.test(text(button)), `${where}: no emoji`).toBe(false);

        const parts = kids(button);
        expect(parts, `${where}: a swatch, then the name`).toHaveLength(2);
        const [swatch, name] = parts;
        expect(text(name).trim(), `${where}: the name comes after the swatch`).toBe(stain.shortName);
        expect(text(swatch), `${where}: the swatch holds no text`).toBe('');
        expect(fillOf(swatch), `${where}: the swatch is the stain's gel background`).toBe(stain.gelBg);
        const sw = inlineStyle(swatch);
        expect(px(sw.width) > 0 && px(sw.height) > 0, `${where}: the swatch has a drawn size (${sw.width} x ${sw.height})`).toBe(true);
        const bands = kids(swatch);
        expect(bands, `${where}: the swatch holds one band`).toHaveLength(1);
        expect(fillOf(bands[0]), `${where}: the band is the stain's band colour`).toBe(stain.bandBody);
        const bandHeight = px(inlineStyle(bands[0]).height);
        expect(bandHeight > 0 && bandHeight < px(sw.height), `${where}: the band is a stripe inside the swatch (${bandHeight}px in ${sw.height})`).toBe(true);
      });
    }
  });
});

/** The gel's slab drawn in this stain: its gel colour inside its border. */
const slabsOf = (svg: El, s: GelStainConfig) => findAll(svg, (e) => e.tag === 'rect' && e.attrs.fill === s.gelBg && e.attrs.stroke === s.gelBorder);
/** The gel's bands: each a pointer group of rects. */
const bandGroupsOf = (svg: El) => findAll(svg, (e) => e.tag === 'g' && inlineStyle(e).cursor === 'pointer' && kids(e).some((k) => k.tag === 'rect'));
/** The colours a stain draws its bands in, and the one every band holds. */
const bandColoursOf = (s: GelStainConfig) => ({ all: s.isDark ? [s.bandGlow, s.bandBody, s.bandCore] : [s.bandCore], body: s.isDark ? s.bandBody : s.bandCore });
/** WCAG relative luminance of a #rrggbb colour. */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(normColour(hex).slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('US-01M6T9QY AC2: a stain button still applies its stain, and says it is pressed', () => {
  // Wrong implementations this fails: no aria-pressed; aria-pressed on every button, or on the first;
  // the chosen button drawn at rest, or the one before left drawn chosen; the gel left in the stain
  // that was showing, or drawn in the other scheme (dark bands on a dark gel). Each stain is chosen
  // after a stain of the other scheme, so a press that changes nothing (EtBr is the default) still shows.
  it('choosing a colour stain button applies its stain and marks it pressed', () => {
    const etbr = VIRTUAL_GEL_STAINS.find((s) => s.id === 'etbr')!;
    const sybr = VIRTUAL_GEL_STAINS.find((s) => s.id === 'sybr')!;
    const inverted = VIRTUAL_GEL_STAINS.find((s) => s.id === 'inverted')!;
    const cases: { label: string; presses: GelStainConfig[]; chosen: GelStainConfig }[] = [
      { label: 'at rest', presses: [], chosen: etbr },
      ...VIRTUAL_GEL_STAINS.map((s) => {
        const before = s.isDark ? inverted : sybr;
        return { label: `${s.shortName} chosen after ${before.shortName}`, presses: [before, s], chosen: s };
      }),
    ];
    for (const { label, presses, chosen } of cases) {
      const { root, svg } = renderPressing(presses);
      const buttons = stainButtons(root, label);
      expect(buttons.map((b) => b.attrs['aria-pressed']), `${label}: only ${chosen.shortName} is pressed`)
        .toEqual(VIRTUAL_GEL_STAINS.map((s) => String(s.id === chosen.id)));
      // BG-01M6TA8Q: the chosen one a selected toggle (Signal Blue), the rest secondary buttons (Canvas White).
      expect(buttons.map((b) => coloursOf(b, 'light').background), `${label}: only ${chosen.shortName} is drawn chosen`)
        .toEqual(VIRTUAL_GEL_STAINS.map((s) => design(s.id === chosen.id ? 'signal-blue' : 'canvas-white')));

      // The gel is drawn in the chosen stain: its slab, and every band.
      expect(VIRTUAL_GEL_STAINS.map((s) => [s.id, slabsOf(svg, s).length]), `${label}: the gel slab is ${chosen.shortName}'s`)
        .toEqual(VIRTUAL_GEL_STAINS.map((s) => [s.id, s.id === chosen.id ? 1 : 0]));
      const bandGroups = bandGroupsOf(svg);
      expect(bandGroups.length, `${label}: the gel draws bands`).toBeGreaterThan(0);
      const bands = bandColoursOf(chosen);
      for (const g of bandGroups) {
        const fills = kids(g).filter((k) => k.tag === 'rect').map((r) => r.attrs.fill);
        expect(fills.every((f) => bands.all.includes(f)) && fills.includes(bands.body), `${label}: a band drawn in ${fills.join(', ')}, not ${chosen.shortName}'s`).toBe(true);
      }

      // The colour scheme it draws: White on Black (light bands on a dark gel) for a fluorescent
      // stain, Black on White (dark bands on a white gel) for the print stain.
      const [slab] = slabsOf(svg, chosen);
      const drawn = luminance(bands.body) > luminance(slab.attrs.fill) ? 'White on Black' : 'Black on White';
      expect(drawn, `${label}: the gel colour scheme drawn`).toBe(chosen.isDark ? 'White on Black' : 'Black on White');
    }
  });
});

// ─── BG-01M6TA8Q: each stain button is named by what it shows, and drawn in DESIGN.md's tokens ───

describe('BG-01M6TA8Q AC1: each stain button is named by its visible name first', () => {
  // Wrong implementations this fails: the accessible name left as the full name (the WCAG 2.5.3
  // Label in Name failure: 'EtBr Amber' is not in 'Ethidium Bromide (UV Amber)'); the full name
  // first and the short name after; the short name alone (the full name lost to assistive
  // technology); every button named for the first stain or the chosen one; no title, or a title of
  // the short name; an aria-labelledby that would take the name from elsewhere. The visible name
  // is read from the rendered button, not from the presets, and the buttons are rendered with
  // EtBr and then the print stain chosen.
  it('names each stain button by its visible name first', () => {
    const inverted = VIRTUAL_GEL_STAINS.find((s) => s.id === 'inverted')!;
    for (const [label, presses] of [['at rest', []], ['with the print stain chosen', [inverted]]] as [string, GelStainConfig[]][]) {
      const { root } = renderPressing(presses);
      stainButtons(root, label).forEach((button, i) => {
        const stain = VIRTUAL_GEL_STAINS[i];
        const where = `${label}, ${stain.shortName}`;
        const visible = text(button).trim();
        const name = button.attrs['aria-label'] ?? '';
        expect(visible, `${where}: the button shows its short name`).toBe(stain.shortName);
        expect(name.startsWith(visible), `${where}: its accessible name "${name}" begins with what it shows, "${visible}"`).toBe(true);
        expect(name, `${where}: its accessible name is its short name, then the stain's full name`).toBe(`${stain.shortName}, ${stain.name}`);
        expect(button.attrs['aria-labelledby'], `${where}: nothing else names it`).toBeUndefined();
        expect(button.attrs.title, `${where}: its title is the stain's full name`).toBe(stain.name);
      });
    }
  });
});

describe('BG-01M6TA8Q AC2: the stain buttons are DESIGN.md secondary buttons and selected toggles', () => {
  // Wrong implementations this fails: the tokens App.css never defines (--mbc-btn-secondary-bg,
  // --mbc-text), whose fallbacks draw dark slate in the light theme; a hex in place of a token, so
  // the dark theme keeps the light colours; the Slate Rule border in place of the Strong Rule; the
  // chosen stain in its status hue (#ea580c, #16a34a, #e11d48) or its swatch colour rather than
  // Signal Blue; a chosen fill that stays light-theme blue in the dark theme, or keeps white text on
  // Night Sky Blue; the swatch lost or filled from the button. Every stain is rendered chosen once,
  // and each button is read in both themes as App.css's cascade resolves it.
  it('styles the stain buttons with the design tokens in both themes', () => {
    const nightStrongRule = themeToken('--mbc-border-strong', 'dark');
    expect(nightStrongRule, 'App.css gives the Strong Rule a night value').toBeDefined();
    expect(nightStrongRule, 'the night Strong Rule is not the day one').not.toBe(themeToken('--mbc-border-strong', 'light'));
    const want: Record<Theme, Record<'rest' | 'chosen', { background: string; color: string; border: string[] }>> = {
      light: {
        rest: { background: design('canvas-white'), color: design('ink'), border: [design('strong-rule')] },
        chosen: { background: design('signal-blue'), color: design('canvas-white'), border: [design('signal-blue'), design('signal-blue-deep')] },
      },
      dark: {
        rest: { background: design('night-canvas'), color: design('night-ink'), border: [nightStrongRule!] },
        chosen: { background: design('signal-blue-night'), color: design('selection-ink'), border: [design('signal-blue-night')] },
      },
    };
    for (const chosen of VIRTUAL_GEL_STAINS) {
      const { root } = renderPressing(chosen.id === 'etbr' ? [] : [chosen]);
      stainButtons(root, `${chosen.shortName} chosen`).forEach((button, i) => {
        const stain = VIRTUAL_GEL_STAINS[i];
        const state = stain.id === chosen.id ? 'chosen' : 'rest';
        for (const theme of THEMES) {
          const where = `${chosen.shortName} chosen, ${stain.shortName} (${state}), ${theme} theme`;
          const got = coloursOf(button, theme);
          const w = want[theme][state];
          expect([got.background, got.color], `${where}: fill and text`).toEqual([w.background, w.color]);
          expect(w.border, `${where}: border ${got.border}`).toContain(got.border);
        }
        // The swatch is still the stain's own colour cue: its gel, holding a band in its band colour.
        const [swatch] = kids(button);
        expect([fillOf(swatch), fillOf(kids(swatch)[0])], `${chosen.shortName} chosen, ${stain.shortName}: the swatch`).toEqual([stain.gelBg, stain.bandBody]);
      });
    }
  });
});

describe('BG-01M6TA8Q AC3: choosing a stain changes the gel it draws, and nothing it does not draw', () => {
  // Wrong implementations this fails: a press that sets a gel colour scheme beside the stain, which
  // nothing draws from (the state this unit removes); a press that sets nothing, or sets the stain
  // that was showing; a gel drawn from anything but the chosen stain. Each stain is chosen after a
  // stain of the other scheme, so a scheme held beside the stain would change with the press.
  it('choosing a stain changes the gel it draws', () => {
    const sybr = VIRTUAL_GEL_STAINS.find((s) => s.id === 'sybr')!;
    const inverted = VIRTUAL_GEL_STAINS.find((s) => s.id === 'inverted')!;
    for (const chosen of VIRTUAL_GEL_STAINS) {
      const before = chosen.isDark ? inverted : sybr;
      const label = `${chosen.shortName} chosen after ${before.shortName}`;
      const first = renderPressing([before]);
      const then = renderPressing([before, chosen]);

      // The gel it draws changes from the stain before to the chosen one.
      expect([slabsOf(first.svg, before).length, slabsOf(then.svg, before).length, slabsOf(then.svg, chosen).length], `${label}: the slab drawn`)
        .toEqual([1, 0, 1]);
      const bands = bandColoursOf(chosen);
      const fills = bandGroupsOf(then.svg).flatMap((g) => kids(g).filter((k) => k.tag === 'rect').map((r) => r.attrs.fill));
      expect(fills.length > 0 && fills.every((f) => bands.all.includes(f)), `${label}: every band in the chosen stain's colours`).toBe(true);

      // The studio's state between the pass the chosen stain was pressed in and the last: the stain
      // is the one thing the press changed.
      const pressedPass = then.passes[then.pressedIn[1]];
      const last = then.passes[then.passes.length - 1];
      const changed = [...last].filter(([setter, st]) => pressedPass.has(setter) && !Object.is(pressedPass.get(setter)!.value, st.value))
        .map(([setter, st]) => [pressedPass.get(setter)!.value, st.value]);
      expect(changed, `${label}: the state the press changed`).toEqual([[before.id, chosen.id]]);
    }
  });
});
