// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q1CC: Split view shows the circular and linear maps side by side, under one zoom.
 *
 * The layout is read from src/App.css the way a browser applies it to the viewer canvas: every
 * rule for the Split grid, top-level or inside an `@container` query on the canvas, cascaded by
 * source order at a given canvas inline size. Everything else renders the real components. The App
 * is driven through its own command dispatcher and the handlers its render hands to its own
 * elements (the in-render harness of structureToolsWiring.test.tsx): a state update made while the
 * App renders re-renders it with that update, so each step acts on the state the one before left.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Probes, installed before the modules under test load ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
type Collect = (trees: readonly (readonly unknown[])[]) => import('../core/menuShortcuts').MenuShortcutBinding[];
const probe = vi.hoisted(() => ({
  /** The App's native-menu dispatcher ref, as its render last assigned it. */
  dispatcher: null as null | { current: AppDispatcher },
  /** Called from inside each App render with the web menu tables it builds. */
  onMenus: null as null | ((menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void),
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  /** The real shortcut collector: the bindings a key press is looked up in. */
  collect: null as null | Collect,
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
  return { ...actual, default: { ...actual, useRef }, useRef };
});

vi.mock('../core/menuShortcuts', async () => {
  const actual = await vi.importActual<typeof import('../core/menuShortcuts')>('../core/menuShortcuts');
  probe.collect = actual.collectMenuShortcutBindings as unknown as Collect;
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

const { App } = await import('../App');
const circularMap = await import('../components/CircularPlasmidMap');
const { CircularPlasmidMap } = circularMap;
const linearView = await import('../components/LinearSequenceView');
const { LinearSequenceView } = linearView;
const menuShortcuts = await import('../core/menuShortcuts');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { findRestrictionCutSites, findORFs } = await import('../core/bioEngine');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');

const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as { readFileSync: (p: URL, enc: string) => string };
const APP_CSS = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');

const puc19 = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;
const puc19Cuts = findRestrictionCutSites(puc19.sequence, puc19.topology);

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

afterEach(() => {
  probe.onMenus = null;
  probe.onElement = null;
});

// ─── Rendered markup as a tree of plain objects ───

interface El { tag: string; attrs: Record<string, string>; classes: Set<string>; parent: El | null; children: (El | string)[] }
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k];
});
function parseMarkup(html: string): El {
  const root: El = { tag: '#root', attrs: {}, classes: new Set(), parent: null, children: [] };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) { cur.children.push(decode(m[5])); continue; }
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      if (cur.tag !== tag.toLowerCase()) throw new Error(`markup closes <${tag}> inside <${cur.tag}>`);
      cur = cur.parent!;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const node: El = { tag: tag.toLowerCase(), attrs, classes: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)), parent: cur, children: [] };
    cur.children.push(node);
    if (!selfClosing && !VOID.has(node.tag)) cur = node;
  }
  if (cur !== root) throw new Error(`markup leaves <${cur.tag}> open`);
  return root;
}
const kids = (e: El) => e.children.filter((c): c is El => typeof c !== 'string');
function* walk(e: El): Generator<El> { yield e; for (const c of kids(e)) yield* walk(c); }
const textOf = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const findAll = (root: El, pred: (e: El) => boolean) => [...walk(root)].filter(pred);
const byClass = (root: El, cls: string) => findAll(root, (e) => e.classes.has(cls));
const buttons = (root: El) => findAll(root, (e) => (e.tag === 'button' && !e.attrs.role) || e.attrs.role === 'button');
/** What a control is called: its aria-label, its title and its words. */
const callOf = (b: El) => `${b.attrs['aria-label'] ?? ''} | ${b.attrs.title ?? ''} | ${textOf(b).trim()}`;
/** The scale of the circular map's zoomed view group, as drawn. */
const circleScale = (root: El) => {
  const group = findAll(root, (e) => e.tag === 'g' && e.classes.has('plasmid-viewport-group'))[0];
  expect(group, 'the circular map is drawn').toBeDefined();
  return Number(/scale\(([\d.]+)\)/.exec(group.attrs.transform ?? '')?.[1] ?? 1);
};
/**
 * The circular map's view, from the transform of its zoomed view group: its scale, and how far its
 * centre (340, 270) is moved, in map units. No transform is the fitted view, centred at 1.
 */
const viewOf = (transform: string | undefined) => {
  if (transform === undefined) return { scale: 1, dx: 0, dy: 0 };
  const m = /^translate\(([-\d.]+), ([-\d.]+)\) scale\(([\d.]+)\) translate\(-340, -270\)$/.exec(transform);
  expect(m, `the view transform "${transform}"`).not.toBeNull();
  return { scale: Number(m![3]), dx: Number(m![1]) - 340, dy: Number(m![2]) - 270 };
};

// ─── The App, driven from inside its own renders ───

type AppStep = (menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void;
function driveApp(steps: readonly AppStep[]): { html: string; ran: number } {
  let ran = 0;
  let passes = 0;
  probe.onMenus = (menus, dispatch) => {
    passes++;
    if (passes > 40) throw new Error('the App kept re-rendering');
    if (ran < steps.length) steps[ran++](menus, dispatch);
  };
  const html = renderToStaticMarkup(<App />);
  return { html, ran };
}

/** An autosaved session holding pUC19, open in Split view (or `mapLayoutMode`) at `zoomLevel`. */
function autosavePuc19(zoomLevel: number, mapLayoutMode: 'split' | 'circular' | 'linear' = 'split') {
  expect(saveWorkbenchToLocalAutosave({
    sessionName: 'Zoom_Session',
    documents: [puc19],
    workspace: {
      activeDocId: puc19.id, selectedFolder: 'All Project Files', navHistory: [puc19.id], navIndex: 0,
      viewerTab: 'sequence-view', mapLayoutMode, zoomLevel, textFormat: 'genbank', colorScheme: 'standard',
      darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
      displaySettings: {
        showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
        showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: true,
      },
    },
  }), 'the autosave is written').toBe(true);
}

// ─── The stylesheet, cascaded for the Split grid at a canvas width ───

interface CssRule { selectors: string[]; decls: Map<string, { value: string; important: boolean }>; at: string[]; order: number }
function parseCss(text: string): CssRule[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let order = 0;
  const scan = (s: string, at: string[]) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const prelude = s.slice(i, open).replace(/^[\s;]+/, '').trim();
      let depth = 1;
      let j = open + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') depth--;
        j++;
      }
      const body = s.slice(open + 1, j - 1);
      if (prelude.startsWith('@')) {
        if (/^@(container|media|supports|layer)\b/.test(prelude)) scan(body, [...at, prelude.replace(/\s+/g, ' ')]);
      } else {
        const decls = new Map<string, { value: string; important: boolean }>();
        for (const d of body.split(';')) {
          const k = d.indexOf(':');
          if (k < 0) continue;
          const raw = d.slice(k + 1).trim();
          decls.set(d.slice(0, k).trim(), { value: raw.replace(/\s*!important$/, '').replace(/\s+/g, ' '), important: /!important$/.test(raw) });
        }
        rules.push({ selectors: prelude.split(',').map((x) => x.trim().replace(/\s+/g, ' ').replace(/\s*>\s*/g, ' > ')), decls, at, order: order++ });
      }
      i = j;
    }
  };
  scan(src, []);
  return rules;
}
const CSS_RULES = parseCss(APP_CSS);

/** Whether an at-rule applies to the Split grid on a viewer canvas `width` px wide (content box). */
function appliesAt(at: string, width: number): boolean {
  if (at.startsWith('@media') || at.startsWith('@supports') || at.startsWith('@layer')) {
    throw new Error(`a Split grid rule sits inside "${at}", which this test does not evaluate`);
  }
  const m = /^@container\s+(?:([a-zA-Z][\w-]*)\s+)?(.+)$/.exec(at);
  if (!m) throw new Error(`unread container rule "${at}"`);
  // An unnamed query reads the nearest container, which for the Split grid is the viewer canvas.
  if (m[1] && m[1] !== 'viewer-canvas') return false;
  if (/^scroll-state\(/.test(m[2])) return false;
  return m[2].split(/\s+and\s+/).every((c) => {
    const f = /^\(\s*(min-width|max-width|min-inline-size|max-inline-size)\s*:\s*([\d.]+)px\s*\)$/.exec(c.trim());
    if (f) return f[1].startsWith('min') ? width >= Number(f[2]) : width <= Number(f[2]);
    const r = /^\(\s*(?:width|inline-size)\s*(>=|>|<=|<)\s*([\d.]+)px\s*\)$/.exec(c.trim());
    if (!r) throw new Error(`unread container condition "${c}"`);
    const v = Number(r[2]);
    return r[1] === '>=' ? width >= v : r[1] === '>' ? width > v : r[1] === '<=' ? width <= v : width < v;
  });
}

/** The cascaded value of `prop` on `selector` (same specificity, so the last applicable rule wins). */
function cascaded(selector: string, prop: string, width: number): { value: string; rule: CssRule } | null {
  const hits = CSS_RULES.filter((r) => r.selectors.includes(selector) && r.decls.has(prop) && r.at.every((a) => appliesAt(a, width)));
  if (hits.length === 0) return null;
  hits.sort((a, b) => Number(a.decls.get(prop)!.important) - Number(b.decls.get(prop)!.important) || a.order - b.order);
  const rule = hits[hits.length - 1];
  return { value: rule.decls.get(prop)!.value, rule };
}

/** Grid tracks split at the top level (not inside minmax(), repeat() or calc()). */
function tracksOf(value: string): string[] {
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

const SPLIT = '.map-seq-grid.mode-split';
// The viewer canvas content box at 1440x900 with the inspector open: 879px as the story measured it
// (2026-11-05), 877px in this unit's capture; and with US-01M6Q1BD's studio rail about 56px narrower.
const CANVAS_DEFAULT = 879;
const CANVAS_MEASURED = 877;
const CANVAS_WITH_RAIL = 823;

describe('Split view side by side (US-01M6Q1CC)', () => {
  it('puts circle and linear map side by side on a wide canvas', () => {
    // Wrong implementations this catches: the figure-first breakpoint (900px), which the default
    // 879px canvas never reaches; side by side in a rule the base rule follows (so the cascade
    // drops it); one track; a circle track whose minimum is below 320px; a `1fr` linear track
    // (min-content minimum, so a long row widens it past the canvas); the base rule replaced
    // (no stacked fallback); and the cards left at their stacked heights.
    const base = CSS_RULES.filter((r) => r.at.length === 0 && r.selectors.includes(SPLIT) && r.decls.has('grid-template-columns'));
    expect(base.length, 'the base Split rule').toBeGreaterThan(0);
    expect(base[base.length - 1].decls.get('grid-template-columns')!.value).toBe('minmax(0, 1fr)');

    for (const width of [CANVAS_DEFAULT, CANVAS_MEASURED, CANVAS_WITH_RAIL]) {
      const cols = cascaded(SPLIT, 'grid-template-columns', width);
      expect(cols, `a Split grid rule applies at ${width}px`).not.toBeNull();
      const tracks = tracksOf(cols!.value);
      expect(tracks, `two tracks at ${width}px: ${cols!.value}`).toHaveLength(2);
      const circleMin = /^minmax\(\s*([\d.]+)px\s*,/.exec(tracks[0])?.[1] ?? /^([\d.]+)px$/.exec(tracks[0])?.[1];
      expect(circleMin, `the circle track has a px minimum: ${tracks[0]}`).toBeDefined();
      expect(Number(circleMin), 'the circle track is at least 320px').toBeGreaterThanOrEqual(320);
      expect(tracks[1], 'the linear track can shrink to the column').toMatch(/^minmax\(\s*0(px)?\s*,/);

      // The deciding rule is a viewer-canvas container query from at most 820px.
      const at = cols!.rule.at;
      expect(at, 'side by side comes from a container query').toHaveLength(1);
      const min = /\(\s*(?:min-width|min-inline-size)\s*:\s*([\d.]+)px\s*\)|\(\s*(?:width|inline-size)\s*>=?\s*([\d.]+)px\s*\)/.exec(at[0]);
      expect(min, `a minimum inline size: ${at[0]}`).not.toBeNull();
      const breakpoint = Number(min![1] ?? min![2]);
      expect(breakpoint, 'the breakpoint admits the default canvas with the rail').toBeLessThanOrEqual(820);
      // Just below it, the stacked fallback.
      expect(cascaded(SPLIT, 'grid-template-columns', breakpoint - 1)?.value).toBe('minmax(0, 1fr)');

      // Both cards take the row height: one row that cannot grow past the grid, and the circle
      // card no longer held at its stacked height.
      expect(cascaded(SPLIT, 'grid-template-rows', width)?.value, 'one shared row').toBe('minmax(0, 1fr)');
      const circleHeight = cascaded(`${SPLIT} > .plasmid-map-wrapper`, 'block-size', width)?.value;
      expect(circleHeight, 'the circle card takes the row height').toBe('auto');
      const linearMin = cascaded(`${SPLIT} > .linear-seq-container`, 'min-block-size', width)?.value;
      expect(linearMin, 'the linear card takes the row height').toBe('0');
    }

    // The App draws the circle first, so it takes the first (circle) track, and the linear map second.
    const { html } = driveApp([(_m, d) => d('new-session:sample-library')]);
    const grid = byClass(parseMarkup(html), 'map-seq-grid');
    expect(grid, 'one Split grid').toHaveLength(1);
    expect(grid[0].classes.has('mode-split')).toBe(true);
    expect(kids(grid[0]).map((k) => [...k.classes][0])).toEqual(['plasmid-map-wrapper', 'linear-seq-container']);
  });

  it('offers one zoom control for the sequence map', () => {
    // Wrong implementations this catches: the map's own − / + buttons kept (two zoom-ins on the
    // view), kept under another name, or kept hidden in the markup; the HUD or its SVG export lost
    // with them; a second readout.
    const isZoomOut = (b: El) => /zoom\s*out/i.test(callOf(b)) || ['−', '-'].includes(textOf(b).trim());
    const isZoomIn = (b: El) => /zoom\s*in/i.test(callOf(b)) || textOf(b).trim() === '+';
    const isReadoutOrReset = (b: El) => /^\d+(\.\d+)?\s*%$/.test(textOf(b).trim()) || /reset\b.*\bzoom|zoom\b.*\breset/i.test(callOf(b));

    // The map alone: no zoom control of its own, and the HUD with its exports.
    const map = parseMarkup(renderToStaticMarkup(
      <CircularPlasmidMap doc={puc19} cutSites={puc19Cuts} orfs={findORFs(puc19.sequence, 50)} selectedRange={null}
        onSelectRange={() => {}} showOrfs showPrimers showUniqueCuttersOnly zoomLevel={100} onZoomChange={() => {}} />,
    ));
    const hud = byClass(map, 'circular-map-hud-bar');
    expect(hud, 'the HUD bar').toHaveLength(1);
    const hudButtons = buttons(hud[0]);
    expect(hudButtons.some((b) => /Export circular map as vector SVG/.test(b.attrs.title ?? '') && textOf(b).trim() === 'SVG'), 'the SVG export').toBe(true);
    expect(hudButtons.some((b) => /^Export/.test(textOf(b).trim())), 'the figure export').toBe(true);
    const mapZoom = buttons(map).filter((b) => isZoomOut(b) || isZoomIn(b) || isReadoutOrReset(b) || /zoom/i.test(callOf(b)));
    expect(mapZoom.map(callOf), 'the map draws no zoom control').toEqual([]);

    // The App in Sequence view (sample library, Split): exactly one of each, in the viewer header.
    const { html } = driveApp([(_m, d) => d('new-session:sample-library')]);
    const app = parseMarkup(html);
    expect(byClass(app, 'map-seq-grid')[0]?.classes.has('mode-split'), 'Split view with the circle').toBe(true);
    const all = buttons(app);
    const header = byClass(app, 'mbc-viewer-zoom-controls');
    expect(header, 'the viewer header zoom controls').toHaveLength(1);
    for (const [what, pick] of [['zoom-out', isZoomOut], ['zoom-in', isZoomIn], ['readout', isReadoutOrReset]] as const) {
      const found = all.filter(pick);
      expect(found.map(callOf), `one ${what} control`).toHaveLength(1);
      expect([...walk(header[0])].includes(found[0]), `the ${what} control is in the viewer header`).toBe(true);
    }
    // They keep the names and shortcuts US-01M6Q193 gave them.
    const named = (label: string) => all.find((b) => b.attrs['aria-label'] === label);
    expect(named('Zoom In')?.attrs['aria-keyshortcuts']).toMatch(/^(Meta|Control)\+=$/);
    expect(named('Zoom Out')?.attrs['aria-keyshortcuts']).toMatch(/^(Meta|Control)\+-$/);
    expect(all.find(isReadoutOrReset)?.attrs['aria-keyshortcuts']).toMatch(/^(Meta|Control)\+0$/);

    // The zoom acts on the circle, so in Linear View Only, where no circle is drawn, all three are
    // disabled; in Split they are not.
    const linearOnly = parseMarkup(driveApp([(_m, d) => d('new-session:sample-library'), (_m, d) => d('view:layout-linear')]).html);
    expect(byClass(linearOnly, 'map-seq-grid')[0]?.classes.has('mode-linear'), 'Linear View Only').toBe(true);
    const disabledOf = (root: El) => {
      const own = buttons(byClass(root, 'mbc-viewer-zoom-controls')[0]);
      return [isZoomOut, isReadoutOrReset, isZoomIn].map((pick) => own.filter(pick).map((b) => 'disabled' in b.attrs));
    };
    expect(disabledOf(linearOnly), 'zoom out, readout, zoom in in Linear View Only').toEqual([[true], [true], [true]]);
    expect(disabledOf(app), 'zoom out, readout, zoom in in Split').toEqual([[false], [false], [false]]);
  });

  it('routes wheel, keys and restore to one zoom range', () => {
    const { SEQUENCE_ZOOM_MIN, SEQUENCE_ZOOM_MAX, SEQUENCE_ZOOM_DEFAULT, clampSequenceZoom, stepSequenceZoom, wheelSequenceZoom } = circularMap;
    // The range, written here so a different one in the module fails: the header's old 70-140%
    // and the map's old 0.65-2.6x, as one percentage.
    expect([SEQUENCE_ZOOM_MIN, SEQUENCE_ZOOM_MAX, SEQUENCE_ZOOM_DEFAULT]).toEqual([65, 260, 100]);

    // ── The shared helpers: wheel and button/key steps reach the same ends and stay inside them.
    const run = (from: number, next: (z: number) => number, n: number) => {
      const seen = [from];
      for (let i = 0; i < n; i++) seen.push(next(seen[seen.length - 1]));
      return seen;
    };
    const stepsUp = run(100, (z) => stepSequenceZoom(z, 1), 30);
    const stepsDown = run(100, (z) => stepSequenceZoom(z, -1), 30);
    const wheelUp = run(100, (z) => wheelSequenceZoom(z, -100), 40);
    const wheelDown = run(100, (z) => wheelSequenceZoom(z, 100), 40);
    for (const [what, seen] of Object.entries({ stepsUp, stepsDown, wheelUp, wheelDown })) {
      for (const z of seen) {
        expect(z, `${what}: ${seen.join(' ')}`).toBeGreaterThanOrEqual(65);
        expect(z, `${what}: ${seen.join(' ')}`).toBeLessThanOrEqual(260);
      }
    }
    expect(stepsUp.slice(0, 3)).toEqual([100, 110, 120]);
    expect(wheelUp[1], 'a wheel notch moves the zoom').toBeGreaterThan(100);
    expect(wheelDown[1]).toBeLessThan(100);
    // The same ends, whichever input reaches them.
    expect([stepsUp.at(-1), wheelUp.at(-1)]).toEqual([260, 260]);
    expect([stepsDown.at(-1), wheelDown.at(-1)]).toEqual([65, 65]);
    // A session's value: kept inside the range, clamped outside it.
    expect([125, 30, 400].map(clampSequenceZoom)).toEqual([125, 65, 260]);

    // ── The map keeps no zoom of its own: a ⌘/Ctrl/⌥ wheel and a double-click are reported to the
    // caller, a plain wheel is not, and the circle is drawn at the caller's zoom alone. The map's
    // own handlers are called while it renders, so any state they set would show in this render.
    const reports: ((z: number) => number)[] = [];
    let driven = false;
    probe.onElement = (type, props) => {
      if (driven || type !== 'div' || props.className !== 'plasmid-canvas-scroll') return;
      driven = true;
      const wheel = props.onWheel as (e: object) => void;
      const ev = (mods: object, deltaY: number) => ({ ctrlKey: false, metaKey: false, altKey: false, ...mods, deltaY, preventDefault() {} });
      wheel(ev({}, -100));
      (props.onDoubleClick as (e: object) => void)({});
      wheel(ev({ ctrlKey: true }, -100));
      wheel(ev({ metaKey: true }, 100));
      wheel(ev({ altKey: true }, -100));
    };
    const drawMap = (zoomLevel: number) => parseMarkup(renderToStaticMarkup(
      <CircularPlasmidMap doc={puc19} cutSites={puc19Cuts} orfs={[]} selectedRange={null} onSelectRange={() => {}}
        showOrfs={false} showPrimers showUniqueCuttersOnly zoomLevel={zoomLevel} onZoomChange={(u) => reports.push(u)} />,
    ));
    const at150 = drawMap(150);
    probe.onElement = null;
    expect(driven, 'the map handed its view its wheel and double-click handlers').toBe(true);
    expect(reports.length, 'double-click and three modified wheel notches were reported').toBe(4);
    expect(reports.map((u) => u(150))).toEqual([100, wheelSequenceZoom(150, -100), wheelSequenceZoom(150, 100), wheelSequenceZoom(150, -100)]);
    expect(reports.map((u) => u(150))).toEqual([100, 162, 139, 162]);
    // At the ends the map's reports stay inside the range.
    expect(reports[1](260)).toBe(260);
    expect(reports[2](65)).toBe(65);
    expect(circleScale(at150), 'drawn at the caller zoom, with no multiplier of its own').toBeCloseTo(1.5, 4);
    expect(circleScale(drawMap(65))).toBeCloseTo(0.65, 4);
    expect(circleScale(drawMap(260))).toBeCloseTo(2.6, 4);

    // ── Through the App: a restored session, the keys (the web menu binding a ⌘/Ctrl press finds,
    // and the native menu's command), the header buttons and the map's reports all move the one
    // readout, and the circle is drawn at it.
    // Each render pass first runs one step (from inside the App's render), then draws the state
    // the step before it left: the controls drawn in pass n show the result of step n - 1.
    const captured: {
      zoomIn?: () => void; zoomOut?: () => void; reset?: () => void;
      map?: { zoomLevel: number; onZoomChange?: (u: (z: number) => number) => void };
    } = {};
    let pass = 0;
    let shown: { readout?: string; mapZoom?: number; mapProps?: Record<string, unknown> }[] = [];
    probe.onElement = (type, props) => {
      if (type === 'button' && props['aria-label'] === 'Zoom In') captured.zoomIn = props.onClick as () => void;
      if (type === 'button' && props['aria-label'] === 'Zoom Out') captured.zoomOut = props.onClick as () => void;
      if (type === 'button' && String(props.className ?? '').includes('zoom-pct-btn')) {
        captured.reset = props.onClick as () => void;
        shown[pass] = { ...shown[pass], readout: React.Children.toArray(props.children as React.ReactNode).join('') };
      }
      if (type === CircularPlasmidMap) {
        captured.map = props as unknown as NonNullable<typeof captured.map>;
        shown[pass] = { ...shown[pass], mapZoom: captured.map.zoomLevel, mapProps: props };
      }
    };
    const key = (k: string, code: string): AppStep => (menus) => {
      const binding = menuShortcuts.findMenuShortcut(probe.collect!(menus), { key: k, code, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, 'macos');
      expect(binding, `⌘${k} is bound`).toBeDefined();
      binding!.run();
    };
    const drive = (zoomLevel: number, inputs: [string, AppStep][]) => {
      autosavePuc19(zoomLevel);
      const steps: AppStep[] = [(_m, d) => d('file:restore-autosave'), ...inputs.map(([, step]) => step)];
      const names = ['restore', ...inputs.map(([name]) => name)];
      pass = 0;
      shown = [];
      probe.onMenus = (menus, dispatch) => {
        pass++;
        if (pass > 40) throw new Error('the App kept re-rendering');
        if (pass <= steps.length) steps[pass - 1](menus, dispatch);
      };
      const html = renderToStaticMarkup(<App />);
      expect(pass, 'one render pass per step, and the one that draws the last').toBe(steps.length + 1);
      // Step i runs in pass i + 1 and shows in pass i + 2.
      const seen = names.map((after, i) => ({ after, readout: shown[i + 2]?.readout ?? '(none)', mapZoom: shown[i + 2]?.mapZoom ?? NaN, mapProps: shown[i + 2]?.mapProps }));
      return { seen, html: parseMarkup(html) };
    };
    const wheelOnMap = (deltaY: number): AppStep => () => captured.map!.onZoomChange!((z) => wheelSequenceZoom(z, deltaY));
    const doubleClickOnMap: AppStep = () => captured.map!.onZoomChange!(() => SEQUENCE_ZOOM_DEFAULT);
    const click = (which: 'zoomIn' | 'zoomOut' | 'reset'): AppStep => () => captured[which]!();
    const native = (id: string): AppStep => (_m, d) => d(id);

    const restored125 = drive(125, []);
    expect(restored125.seen.map((s) => s.readout)).toEqual(['125%']);
    expect(circleScale(restored125.html)).toBeCloseTo(1.25, 4);

    const restored400 = drive(400, [
      ['⌘=', key('=', 'Equal')], ['View › Zoom In (native)', native('view:zoom-in')], ['header Zoom In', click('zoomIn')],
      ['wheel up', wheelOnMap(-100)], ['wheel down', wheelOnMap(100)], ['header Zoom Out', click('zoomOut')],
      ['View › Zoom Out (native)', native('view:zoom-out')], ['⌘-', key('-', 'Minus')], ['double-click', doubleClickOnMap],
      ['header Zoom In', click('zoomIn')], ['⌘0', key('0', 'Digit0')], ['⌘=', key('=', 'Equal')], ['the % readout', click('reset')],
    ]);
    expect(restored400.seen.map((s) => `${s.after} → ${s.readout}`)).toEqual([
      'restore → 260%', '⌘= → 260%', 'View › Zoom In (native) → 260%', 'header Zoom In → 260%', 'wheel up → 260%',
      'wheel down → 241%', 'header Zoom Out → 231%', 'View › Zoom Out (native) → 221%', '⌘- → 211%', 'double-click → 100%',
      'header Zoom In → 110%', '⌘0 → 100%', '⌘= → 110%', 'the % readout → 100%',
    ]);
    for (const s of restored400.seen) expect(s.mapZoom, `the circle follows the readout after ${s.after}`).toBe(Number(s.readout.replace('%', '')));

    const restored30 = drive(30, [
      ['⌘-', key('-', 'Minus')], ['View › Zoom Out (native)', native('view:zoom-out')], ['header Zoom Out', click('zoomOut')],
      ['wheel down', wheelOnMap(100)], ['wheel up', wheelOnMap(-100)], ['⌘=', key('=', 'Equal')],
    ]);
    expect(restored30.seen.map((s) => `${s.after} → ${s.readout}`)).toEqual([
      'restore → 65%', '⌘- → 65%', 'View › Zoom Out (native) → 65%', 'header Zoom Out → 65%', 'wheel down → 65%',
      'wheel up → 70%', '⌘= → 80%',
    ]);
    for (const s of restored30.seen) expect(s.mapZoom).toBe(Number(s.readout.replace('%', '')));
    expect(circleScale(restored30.html)).toBeCloseTo(0.8, 4);

    // ── Restore recentres the circle as well: ⌘0, the native View › Actual Size and the header's %
    // readout, also at 100% already (so it is the restore that recentres, not a zoom change), while
    // a zoom step keeps the pan. Each input's run through the App gives the props the App then draws
    // the map with. The map, panned by a drag on its own canvas under the props before an input, is
    // then drawn with the props after it, as a mounted map is when the App re-renders.
    const restores = drive(150, [
      ['⌘=', key('=', 'Equal')], ['⌘0', key('0', 'Digit0')], ['⌘0 at 100%', key('0', 'Digit0')],
      ['header Zoom Out', click('zoomOut')], ['the % readout', click('reset')], ['the % readout at 100%', click('reset')],
      ['View › Actual Size (native)', native('view:zoom-reset')], ['View › Zoom In (native)', native('view:zoom-in')],
      ['wheel up', wheelOnMap(-100)],
    ]);
    expect(restores.seen.map((s) => `${s.after} → ${s.readout}`)).toEqual([
      'restore → 150%', '⌘= → 160%', '⌘0 → 100%', '⌘0 at 100% → 100%', 'header Zoom Out → 90%', 'the % readout → 100%',
      'the % readout at 100% → 100%', 'View › Actual Size (native) → 100%', 'View › Zoom In (native) → 110%', 'wheel up → 119%',
    ]);
    const dragCanvas = (canvas: Record<string, unknown>, dx: number, dy: number) => {
      const on = (name: string) => canvas[name] as (e: object) => void;
      const el = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
      const at = (x: number, y: number) => ({ pointerId: 7, clientX: x, clientY: y, target: { closest: () => null }, currentTarget: el });
      on('onPointerDown')(at(200, 200));
      on('onPointerMove')(at(200 + dx, 200 + dy));
      on('onPointerUp')(at(200 + dx, 200 + dy));
    };
    /** The view drawn with the props the App gave the map after `before`, dragged 40 right and 30 up, and then after `after`. */
    const panAcross = (before: string, after: string) => {
      const props = [before, after].map((name) => restores.seen.find((s) => s.after === name)!.mapProps!);
      let stage = 0;
      let setStage: (n: number) => void = () => {};
      let transform: string | undefined;
      let canvases = 0;
      const drawn: (string | undefined)[] = [];
      probe.onElement = (type, p) => {
        // The view group is created before the canvas that holds it, so each canvas closes a pass.
        if (type === 'g' && p.className === 'plasmid-viewport-group') transform = p.transform as string | undefined;
        if (type !== 'div' || p.className !== 'plasmid-canvas-scroll') return;
        drawn[stage] = transform;
        canvases++;
        if (canvases === 1) dragCanvas(p, 40, -30);
        else if (stage === 0) setStage(1);
      };
      // The map called from one host's render: its state is the host's, so its pan lives across the
      // host's re-renders as a mounted map's lives across the App's, and each re-render passes the
      // next props.
      const Host = () => {
        const [s, set] = React.useState(0);
        stage = s;
        setStage = set;
        return CircularPlasmidMap(props[s] as unknown as Parameters<typeof CircularPlasmidMap>[0]) as React.ReactElement;
      };
      renderToStaticMarkup(<Host />);
      probe.onElement = null;
      expect(drawn, `drawn under the props after ${before}, then after ${after}`).toHaveLength(2);
      return drawn.map(viewOf);
    };
    const panned = (scale: number) => ({ scale, dx: 40, dy: -30 });
    const centred = { scale: 1, dx: 0, dy: 0 };
    expect(panAcross('restore', '⌘='), 'a zoom step keeps the pan').toEqual([panned(1.5), panned(1.6)]);
    expect(panAcross('⌘=', '⌘0'), 'pan at 160%, then ⌘0').toEqual([panned(1.6), centred]);
    expect(panAcross('⌘0', '⌘0 at 100%'), 'pan at 100%, then ⌘0').toEqual([panned(1), centred]);
    expect(panAcross('⌘0 at 100%', 'header Zoom Out'), 'header Zoom Out keeps the pan').toEqual([panned(1), panned(0.9)]);
    expect(panAcross('header Zoom Out', 'the % readout'), 'pan at 90%, then the header readout').toEqual([panned(0.9), centred]);
    expect(panAcross('the % readout', 'the % readout at 100%'), 'pan at 100%, then the header readout').toEqual([panned(1), centred]);
    expect(panAcross('the % readout at 100%', 'View › Actual Size (native)'), 'pan at 100%, then View › Actual Size').toEqual([panned(1), centred]);
    expect(panAcross('View › Actual Size (native)', 'View › Zoom In (native)'), 'View › Zoom In keeps the pan').toEqual([panned(1), panned(1.1)]);
    expect(panAcross('View › Zoom In (native)', 'wheel up'), 'a wheel notch keeps the pan').toEqual([panned(1.1), panned(1.19)]);
  });

  it('wraps linear sequence rows to fit the column', () => {
    const { linearRowLength, RESIDUE_ADVANCE_PX, LINEAR_ROW_GUTTER_PX, LINEAR_ROW_MIN_BASES, LINEAR_ROW_MAX_BASES } = linearView;
    // The residue advance and the row's gutters, read from the stylesheet: residues are 12px
    // (`.seq-strand-line` at --font-size-label) Google Sans Code, whose advance is 1200/2000 em, plus
    // `.mono-bases`' letter spacing; the start gutter is `.coord-gutter`'s width, and the end
    // coordinate (`.coord-gutter-right`, 11px) follows an 8px margin with room for "12345678 3'".
    /** The value the last top-level rule for `sel` that sets `prop` gives it. */
    const valueOf = (sel: string, prop: string) => CSS_RULES.filter((r) => r.at.length === 0 && r.selectors.includes(sel) && r.decls.has(prop)).pop()?.decls.get(prop)?.value;
    const remOf = (v: string | undefined) => Number(/calc\(\s*([\d.]+)rem/.exec(v ?? '')?.[1] ?? /^([\d.]+)rem/.exec(v ?? '')?.[1]) * 16;
    expect(valueOf('.seq-strand-line', 'font-size')).toBe('var(--font-size-label)');
    const residuePx = remOf(valueOf(':root', '--font-size-label'));
    const captionPx = remOf(valueOf(':root', '--font-size-caption'));
    expect([residuePx, captionPx]).toEqual([12, 11]);
    expect(valueOf(':root', '--font-mono')).toMatch(/^'Google Sans Code'/);
    const spacing = Number(/^([\d.]+)px$/.exec(valueOf('.mono-bases', 'letter-spacing') ?? '')?.[1]);
    expect(RESIDUE_ADVANCE_PX).toBeCloseTo(residuePx * 0.6 + spacing, 6);
    expect(valueOf('.coord-gutter', 'width')).toBe('68px');
    expect(valueOf('.coord-gutter-right', 'margin-left')).toBe('8px');
    expect(valueOf('.coord-gutter-right', 'font-size')).toBe('var(--font-size-caption)');
    expect(LINEAR_ROW_GUTTER_PX).toBeCloseTo(68 + 8 + "12345678 3'".length * captionPx * 0.6, 6);

    // The criterion's columns.
    expect([620, 540, 460, 300].map((w) => linearRowLength(w, RESIDUE_ADVANCE_PX))).toEqual([60, 50, 40, 30]);
    expect([LINEAR_ROW_MIN_BASES, LINEAR_ROW_MAX_BASES]).toEqual([30, 60]);
    // Every width: a multiple of 10 from 30 to 60, the longest row that fits (30 when none does).
    for (let w = 120; w <= 1600; w += 7) {
      const n = linearRowLength(w);
      expect(n % 10, `${w}px`).toBe(0);
      expect(n).toBeGreaterThanOrEqual(30);
      expect(n).toBeLessThanOrEqual(60);
      if (n > 30) expect(LINEAR_ROW_GUTTER_PX + n * RESIDUE_ADVANCE_PX, `${n} bases fit in ${w}px`).toBeLessThanOrEqual(w);
      if (n < 60) expect(LINEAR_ROW_GUTTER_PX + (n + 10) * RESIDUE_ADVANCE_PX, `${n + 10} bases do not fit in ${w}px`).toBeGreaterThan(w);
    }

    // The view reads it: its rows' scroll area, measured at 540px, lays out 50-base rows, pages of
    // 20 such rows, and a jump to 1,100 lands on the page that holds it. The measuring callback and
    // the jump form are the ones the view hands its own elements, called while it renders.
    const rowsOf = (html: string) => byClass(parseMarkup(html), 'seq-row-block').map((row) => {
      const top = findAll(row, (e) => e.classes.has('top-strand'))[0];
      const bases = findAll(top, (e) => e.classes.has('base-ch')).length;
      // The start gutter reads "5'      1" and the end gutter "60 3'".
      const start = Number(/(\d+)\s*$/.exec(textOf(findAll(top, (e) => e.classes.has('coord-gutter'))[0]))?.[1]);
      const end = Number(/^\s*(\d+)/.exec(textOf(findAll(top, (e) => e.classes.has('coord-gutter-right'))[0]))?.[1]);
      return { start, end, bases };
    });
    const pageOf = (html: string) => textOf(byClass(parseMarkup(html), 'page-indicator')[0]).replace(/\s+/g, ' ').trim();
    const draw = (opts: { width?: number; jumpTo?: string; selectedRange?: { start: number; end: number; label?: string } }) => {
      const selections: { start: number; end: number }[] = [];
      let measured = false;
      let typed = false;
      let jumped = false;
      probe.onElement = (type, props) => {
        if (opts.width !== undefined && !measured && type === 'div' && props.className === 'sequence-blocks-scroll') {
          expect(typeof props.ref, 'the rows area is measured through a callback ref').toBe('function');
          measured = true;
          (props.ref as (el: object) => void)({ clientWidth: opts.width });
        }
        if (opts.jumpTo && !typed && type === 'input' && props['aria-label'] === 'Jump to bp coordinate') {
          typed = true;
          (props.onChange as (e: object) => void)({ target: { value: opts.jumpTo } });
        } else if (opts.jumpTo && typed && !jumped && type === 'form' && props.className === 'coord-jump-form' && props.onSubmit && (props.children as unknown[]).length) {
          // The form after the typed value: its submit handler now holds the coordinate.
          const input = React.Children.toArray(props.children as React.ReactNode).find((c) => React.isValidElement(c) && c.type === 'input') as React.ReactElement<{ value: string }> | undefined;
          if (input?.props.value === opts.jumpTo) {
            jumped = true;
            (props.onSubmit as (e: object) => void)({ preventDefault() {} });
          }
        }
      };
      const html = renderToStaticMarkup(
        <LinearSequenceView doc={puc19} cutSites={puc19Cuts} selectedRange={opts.selectedRange ?? null}
          onSelectRange={(r) => selections.push(r)} onUpdateDocument={() => {}} />,
      );
      probe.onElement = null;
      if (opts.width !== undefined) expect(measured, 'the rows area was drawn').toBe(true);
      if (opts.jumpTo) expect(jumped, 'the jump was submitted').toBe(true);
      return { html, selections };
    };

    // No width known (a static render): rows of 60, as before.
    const unmeasured = draw({});
    expect(rowsOf(unmeasured.html).slice(0, 3)).toEqual([{ start: 1, end: 60, bases: 60 }, { start: 61, end: 120, bases: 60 }, { start: 121, end: 180, bases: 60 }]);
    expect(pageOf(unmeasured.html)).toBe('1–1,200 of 2,686 bp');

    const at540 = draw({ width: 540 });
    const rows540 = rowsOf(at540.html);
    expect(rows540).toHaveLength(20);
    expect(rows540.slice(0, 3)).toEqual([{ start: 1, end: 50, bases: 50 }, { start: 51, end: 100, bases: 50 }, { start: 101, end: 150, bases: 50 }]);
    expect(rows540.at(-1)).toEqual({ start: 951, end: 1000, bases: 50 });
    expect(pageOf(at540.html)).toBe('1–1,000 of 2,686 bp');

    const at300 = draw({ width: 300 });
    expect(rowsOf(at300.html)[1]).toEqual({ start: 31, end: 60, bases: 30 });
    expect(pageOf(at300.html)).toBe('1–600 of 2,686 bp');

    // Jump to 1,100: on 50-base rows it is row 22, so page 2 (1,001-2,000); 60-base paging would
    // leave the view on page 1, which ends at 1,000.
    const jumped = draw({ width: 540, jumpTo: '1100' });
    expect(jumped.selections[0]).toMatchObject({ start: 1100, end: 1119 });
    expect(pageOf(jumped.html)).toBe('1,001–2,000 of 2,686 bp');
    expect(rowsOf(jumped.html)[0]).toEqual({ start: 1001, end: 1050, bases: 50 });
    expect(rowsOf(jumped.html).find((r) => r.start <= 1100 && r.end >= 1100), 'the row holding 1,100 is drawn').toBeDefined();
  });

  it('brings a selection made on the circle onto the linear page', () => {
    // AmpR, the feature a click on the circle selects (1,626..2,486), starts past the first page.
    // The linear view turns to the page that holds its first base when the selection arrives, and
    // again whenever its rows rewrap to a new length while it is selected: mounting unmeasured (60
    // bases) and then measured, or its column narrowing or widening later (the inspector opening).
    // With nothing selected, a rewrap keeps the page on the first base it showed.
    const ampR = puc19.features.find((f) => /^AmpR \(bla/.test(f.name))!;
    expect([ampR.start, ampR.end]).toEqual([1626, 2486]);
    const { linearRowLength } = linearView;
    /** The page (from 0, 20 rows each) that holds base `pos` on rows of `n` bases. */
    const pageHolding = (pos: number, n: number) => Math.floor(Math.floor((pos - 1) / n) / 20);
    /** The page the wrong rewrap reaches: the one that keeps the page's first base, from AmpR's page at 60. */
    const firstBasePage = (lengths: number[]) => {
      let n = 60;
      let page = pageHolding(ampR.start, 60);
      for (const m of lengths) {
        page = Math.floor((page * n) / m);
        n = m;
      }
      return page;
    };
    /** What the linear view shows: its page, how many bases are drawn selected, and whether AmpR's first row is drawn. */
    const shown = (root: El, n: number) => {
      const view = byClass(root, 'linear-seq-container')[0];
      expect(view, 'the linear map is drawn').toBeDefined();
      return {
        page: textOf(byClass(view, 'page-indicator')[0]).replace(/\s+/g, ' ').trim(),
        selected: byClass(view, 'sel-base').length,
        rowOfStart: byClass(view, 'seq-row-block').some((r) => Number(r.attrs['data-row-start']) === Math.floor((ampR.start - 1) / n) * n + 1),
      };
    };
    /**
     * The view drawn with AmpR selected (or nothing), running `script` one entry per render pass:
     * a width measures the rows' scroll area through its callback ref (the column resizing between
     * passes), and 'next' clicks Next ▶.
     */
    const draw = (script: readonly (number | 'next')[], selected = true) => {
      let pass = 0;
      let next: (() => void) | undefined;
      probe.onElement = (type, props) => {
        if (type === 'button' && props.className === 'btn-page' && props.children === 'Next ▶') next = props.onClick as () => void;
        if (type !== 'div' || props.className !== 'sequence-blocks-scroll') return;
        const entry = script[pass++];
        if (entry === 'next') next!();
        else if (entry !== undefined) (props.ref as (el: object) => void)({ clientWidth: entry });
      };
      const html = renderToStaticMarkup(
        <LinearSequenceView doc={puc19} cutSites={puc19Cuts} selectedRange={selected ? { start: ampR.start, end: ampR.end, label: ampR.name } : null}
          onSelectRange={() => {}} onUpdateDocument={() => {}} />,
      );
      probe.onElement = null;
      expect(pass, `every entry of [${script.join(', ')}] ran`).toBeGreaterThanOrEqual(script.length);
      const widths = script.filter((e): e is number => typeof e === 'number');
      return shown(parseMarkup(html), widths.length ? linearRowLength(widths[widths.length - 1]) : 60);
    };
    const onPage = (page: string, lastBase: number) => ({ page, selected: lastBase - ampR.start + 1, rowOfStart: true });

    expect(draw([]), 'unmeasured, 60 bases').toEqual(onPage('1,201–2,400 of 2,686 bp', 2400));
    expect(draw([540]), '60 → 50 bases').toEqual(onPage('1,001–2,000 of 2,686 bp', 2000));
    // The rewraps where keeping the page's first base leaves AmpR off the page: ending at 40, 30 and
    // 60 bases. 460px is the rows' width at 1440x900 with the inspector open, 622px with it closed.
    const rewraps: [what: string, script: number[], page: string, lastBase: number][] = [
      ['mounted, then measured at 460px: 60 → 40 bases', [460], '1,601–2,400 of 2,686 bp', 2400],
      ['the inspector opened after the click: 60 → 40 bases', [622, 460], '1,601–2,400 of 2,686 bp', 2400],
      ['30 → 40 bases', [300, 460], '1,601–2,400 of 2,686 bp', 2400],
      ['50 → 30 bases', [540, 300], '1,201–1,800 of 2,686 bp', 1800],
      ['50 → 60 bases', [540, 622], '1,201–2,400 of 2,686 bp', 2400],
    ];
    for (const [what, script, page, lastBase] of rewraps) {
      const lengths = script.map((w) => linearRowLength(w));
      expect(firstBasePage(lengths), `${what}: the case keeping the first base would get wrong`).not.toBe(pageHolding(ampR.start, lengths[lengths.length - 1]));
      expect(draw(script), what).toEqual(onPage(page, lastBase));
    }
    expect(new Set(rewraps.map(([, script]) => linearRowLength(script[script.length - 1]))), 'the row lengths they end at').toEqual(new Set([30, 40, 60]));

    // Nothing selected: page 1,201-2,400 at 60 bases, rewrapped to 30, keeps its first base 1,201.
    expect(draw([622, 'next', 300], false)).toEqual({ page: '1,201–1,800 of 2,686 bp', selected: 0, rowOfStart: true });

    // ── The two probes, through the App. What a click on the AmpR arc reports is read from the
    // arc's own handler and handed to the App through the circle it draws. The linear map the App
    // draws next mounts with that selection and is measured through its rows' ref callback, once
    // per render pass, as the ResizeObserver measures it in the app when it is drawn and resized.
    let report: { start: number; end: number; label?: string } | undefined;
    probe.onElement = (type, props) => {
      if (report === undefined && type === 'path' && /^Select AmpR \(bla/.test(String(props['aria-label'] ?? ''))) (props.onClick as () => void)();
    };
    renderToStaticMarkup(
      <CircularPlasmidMap doc={puc19} cutSites={puc19Cuts} orfs={[]} selectedRange={null} onSelectRange={(r) => { report = r; }}
        showOrfs={false} showPrimers showUniqueCuttersOnly />,
    );
    probe.onElement = null;
    expect(report, 'a click on the AmpR arc').toEqual({ start: ampR.start, end: ampR.end, label: `${ampR.name} (${ampR.type})` });

    const live: { map?: { onSelectRange: (r: object) => void }; linearAt: number[]; inspectorAt: string[] } = { linearAt: [], inspectorAt: [] };
    const clickAmpR: AppStep = () => live.map!.onSelectRange(report!);
    const command = (id: string): AppStep => (_m, d) => d(id);
    /** pUC19 restored in `layout`, then `steps`, one per App render pass; the linear rows measured at `widths`. */
    const throughApp = (layout: 'split' | 'circular', steps: AppStep[], widths: number[]) => {
      autosavePuc19(100, layout);
      Object.assign(live, { map: undefined, linearAt: [], inspectorAt: [] });
      const all: AppStep[] = [command('file:restore-autosave'), ...steps];
      let pass = 0;
      let measured = 0;
      probe.onElement = (type, props) => {
        if (type === CircularPlasmidMap) live.map = props as unknown as NonNullable<typeof live.map>;
        if (type === LinearSequenceView) live.linearAt.push(pass);
        if (type === 'button' && /Sequence View Controls Inspector$/.test(String(props['aria-label'] ?? ''))) live.inspectorAt[pass] = String(props['aria-label']);
        if (type === 'div' && props.className === 'sequence-blocks-scroll' && measured < widths.length) {
          (props.ref as (el: object) => void)({ clientWidth: widths[measured++] });
        }
      };
      probe.onMenus = (menus, dispatch) => {
        pass++;
        if (pass > 40) throw new Error('the App kept re-rendering');
        if (pass <= all.length) all[pass - 1](menus, dispatch);
      };
      const html = renderToStaticMarkup(<App />);
      probe.onElement = null;
      probe.onMenus = null;
      expect(pass, 'one render pass per step, and the one that draws the last').toBe(all.length + 1);
      expect(measured, 'the rows were measured at every width').toBe(widths.length);
      return parseMarkup(html);
    };

    // AmpR clicked in Circular View Only (pass 3), then shown in Split (pass 5) at 1440x900 with the
    // inspector open: the linear map mounts with the selection, unmeasured, then measures 460px.
    const fromCircular = throughApp('circular', [command('view:layout-circular'), clickAmpR, command('view:layout-split')], [460]);
    expect(live.linearAt, 'the linear map is drawn only once Split is').toEqual([5]);
    expect(shown(fromCircular, 40), 'Circular View Only, AmpR, then Split').toEqual(onPage('1,601–2,400 of 2,686 bp', 2400));

    // AmpR clicked in Split with the inspector closed (rows 622px wide, 60 bases), then the inspector
    // opened (460px, 40 bases).
    const inspectorOpened = throughApp('split', [command('view:toggle-inspector'), clickAmpR, command('view:toggle-inspector')], [622, 460]);
    expect([live.inspectorAt[3], live.inspectorAt[5]], 'closed at the click, open after').toEqual(['Show Sequence View Controls Inspector', 'Hide Sequence View Controls Inspector']);
    expect(shown(inspectorOpened, 40), 'AmpR, then the inspector opened').toEqual(onPage('1,601–2,400 of 2,686 bp', 2400));
  });
});

