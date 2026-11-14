// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CC6H: the circular map zooms around the pointer on wheel and pinch, sharing its zoom with
 * the toolbar, the keys and View › Zoom.
 *
 * There is no DOM here. The map is rendered on the server with its effects recorded, then those
 * effects are run by hand against fake elements put into the refs the map handed its own elements:
 * the wheel listener the map registers is the one these tests fire. The App is driven from inside
 * its own renders (the harness of sequenceSplitView.test.tsx).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface AppDispatcher { onMenuAction: (actionId: string) => void }
type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  dispatcher: null as null | { current: AppDispatcher },
  onMenus: null as null | ((menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void),
  onElement: null as null | ElementProbe,
  /** While set, every effect a component declares is kept here, to be run by hand. */
  effects: null as null | (() => unknown)[],
  /** While set, every state update a component's setters make later is logged here. */
  sets: null as null | unknown[],
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
  const useEffect = ((effect: () => unknown, deps?: unknown[]) => {
    probe.effects?.push(effect);
    return actual.useEffect(effect as React.EffectCallback, deps);
  }) as typeof actual.useEffect;
  const useState = ((initial: unknown) => {
    const [value, set] = actual.useState(initial);
    const log = probe.sets;
    if (!log) return [value, set];
    return [value, (next: unknown) => { log.push(next); set(next); }];
  }) as typeof actual.useState;
  const patched = { useRef, useEffect, useState };
  return { ...actual, ...patched, default: { ...actual, ...patched } };
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
const { CircularPlasmidMap, circularMapWheelStep, bindCircularMapWheel, sequenceZoomLabel, SEQUENCE_ZOOM_MAX, SEQUENCE_ZOOM_MIN } = circularMap;
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { findRestrictionCutSites } = await import('../core/bioEngine');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');

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
  probe.effects = null;
  probe.sets = null;
  delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

const puc19 = deepFreeze(structuredClone(SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!));
const puc19Cuts = deepFreeze(findRestrictionCutSites(puc19.sequence, puc19.topology));

// ─── The map's geometry, written out here: the 680x540 view drawn "xMidYMid meet" in the svg's
// box, and the zoomed group's translate(340 + pan.x, 270 + pan.y) scale(s) translate(-340, -270).
// A map point p is on screen at  left + (width - 680k)/2 + k(340 + pan.x + s(p.x - 340)).

/** An svg box whose meet scale is 1.5 and which is letterboxed 90 px on each side. */
const RECT = { left: 100, top: 50, width: 1200, height: 810 };
const K = 1.5;
const OX = (RECT.width - 680 * K) / 2;
const OY = (RECT.height - 540 * K) / 2;
type Pt = { x: number; y: number };
const mapPointAt = (client: Pt, zoom: number, pan: Pt): Pt => ({
  x: 340 + ((client.x - RECT.left - OX) / K - 340 - pan.x) / (zoom / 100),
  y: 270 + ((client.y - RECT.top - OY) / K - 270 - pan.y) / (zoom / 100),
});

interface FakeEvent {
  deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; altKey: boolean;
  clientX: number; clientY: number; scale?: number; preventDefault: () => void;
}
function wheel(p: Partial<FakeEvent>): FakeEvent & { prevented: () => number } {
  let prevented = 0;
  return {
    deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, clientX: 500, clientY: 300,
    ...p,
    preventDefault() { prevented++; },
    prevented: () => prevented,
  };
}

type Listener = (e: unknown) => void;
function fakeTarget() {
  const added: { type: string; listener: Listener; options: unknown }[] = [];
  const removed: { type: string; listener: Listener; options: unknown }[] = [];
  const live = (type: string) => added.filter((a) => a.type === type && !removed.some((r) => r.type === type && r.listener === a.listener));
  return {
    added,
    removed,
    live,
    addEventListener(type: string, listener: Listener, options?: unknown) { added.push({ type, listener, options }); },
    removeEventListener(type: string, listener: Listener, options?: unknown) { removed.push({ type, listener, options }); },
    fire(type: string, ev: unknown) { for (const a of live(type)) a.listener(ev); },
  };
}

/** Frames queued by the map, run when the test says a frame has passed. */
function fakeFrames() {
  const queue = new Map<number, () => void>();
  let next = 1;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => { queue.set(next, cb); return next++; };
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => { queue.delete(id); };
  return {
    pending: () => queue.size,
    frame() { const cbs = [...queue.values()]; queue.clear(); for (const cb of cbs) cb(); },
  };
}

/**
 * Renders the map, then runs the effects it declared against a fake scroll pane and svg in the refs
 * it handed those elements, as a browser's commit would.
 */
function mountMap(opts: { zoom?: number; selectedRange?: { start: number; end: number } | null } = {}) {
  const effects: (() => unknown)[] = [];
  const sets: unknown[] = [];
  const reports: ((z: number) => number)[] = [];
  const selections: unknown[] = [];
  let paneProps: Record<string, unknown> | undefined;
  let svgRef: { current: unknown } | undefined;
  probe.effects = effects;
  probe.sets = sets;
  probe.onElement = (type, props) => {
    if (type === 'div' && props.className === 'plasmid-canvas-scroll') paneProps = props;
    if (type === 'svg' && props.className === 'plasmid-svg') svgRef = props.ref as { current: unknown };
  };
  const selectedRange = opts.selectedRange === undefined ? null : opts.selectedRange;
  const html = renderToStaticMarkup(
    <CircularPlasmidMap doc={puc19} cutSites={puc19Cuts} orfs={[]} selectedRange={selectedRange}
      onSelectRange={(r) => selections.push(r)} showOrfs={false} showPrimers showUniqueCuttersOnly
      zoomLevel={opts.zoom ?? 100} onZoomChange={(u) => reports.push(u)} />,
  );
  probe.onElement = null;
  probe.effects = null;
  probe.sets = null;
  expect(paneProps, 'the map draws its scroll pane').toBeDefined();
  expect(svgRef, 'the map hands its svg a ref').toBeDefined();
  const pane = fakeTarget();
  (paneProps!.ref as { current: unknown }).current = pane;
  svgRef!.current = { getBoundingClientRect: () => ({ ...RECT, right: RECT.left + RECT.width, bottom: RECT.top + RECT.height, x: RECT.left, y: RECT.top }) };
  // The map's other effects listen on the window, which Node has not got: lend them one.
  const withWindow = <T,>(fn: () => T): T => {
    const g = globalThis as { window?: unknown };
    const hadWindow = 'window' in g;
    if (!hadWindow) g.window = { addEventListener() {}, removeEventListener() {} };
    try {
      return fn();
    } finally {
      if (!hadWindow) delete g.window;
    }
  };
  const cleanups = withWindow(() => effects.map((e) => e()).filter((c): c is () => void => typeof c === 'function'));
  const pans = () => sets.filter((s): s is Pt => !!s && typeof s === 'object' && 'x' in s && 'y' in s && Object.keys(s).length === 2);
  return { html, pane, paneProps: paneProps!, reports, selections, pans, unmount: () => withWindow(() => cleanups.forEach((c) => c())) };
}

const viewGroupTransform = (html: string) => /class="plasmid-viewport-group"[^>]*transform="([^"]*)"|transform="([^"]*)"[^>]*class="plasmid-viewport-group"/.exec(html);

// ─── AC1 ───

describe('US-01M7CC6H AC1 a wheel over the circle zooms around the pointer', () => {
  it('the map model this file uses is the transform the map draws', () => {
    const m = viewGroupTransform(mountMap({ zoom: 150 }).html);
    expect(m?.[1] ?? m?.[2]).toBe('translate(340.00, 270.00) scale(1.5000) translate(-340, -270)');
  });

  it('keeps the map point under the pointer still for plain, Ctrl, Cmd and Alt wheels', () => {
    const pointers: Pt[] = [{ x: 260, y: 140 }, { x: 900, y: 700 }, { x: 640, y: 455 }, { x: 1250, y: 60 }];
    const starts: { zoom: number; pan: Pt }[] = [{ zoom: 100, pan: { x: 0, y: 0 } }, { zoom: 137.25, pan: { x: -42, y: 31 } }, { zoom: 230, pan: { x: 120, y: -80 } }];
    const mods = [{}, { ctrlKey: true }, { metaKey: true }, { altKey: true }];
    for (const pointer of pointers) for (const start of starts) for (const mod of mods) for (const deltaY of [-100, -37, 3, 120]) {
      const step = circularMapWheelStep(wheel({ ...mod, deltaY, clientX: pointer.x, clientY: pointer.y }), { ...start, rect: RECT });
      const what = `${JSON.stringify(mod)} ${deltaY} at ${pointer.x},${pointer.y} from ${start.zoom}`;
      expect(step.handled, what).toBe(true);
      expect(step.zoom, what).not.toBe(start.zoom);
      const before = mapPointAt(pointer, start.zoom, start.pan);
      const after = mapPointAt(pointer, step.zoom, step.pan);
      expect(after.x, what).toBeCloseTo(before.x, 6);
      expect(after.y, what).toBeCloseTo(before.y, 6);
    }
  });

  it('steps by the shared helper, multiplicatively and without rounding', () => {
    const at = (deltaY: number, zoom = 100, deltaMode = 0) => circularMapWheelStep(wheel({ deltaY, deltaMode }), { zoom, pan: { x: 0, y: 0 }, rect: RECT }).zoom;
    expect(at(-100)).toBeCloseTo(108, 10);
    expect(at(100)).toBeCloseTo(100 / 1.08, 10);
    expect(at(-3)).toBeCloseTo(100 * Math.pow(1.08, 0.03), 10);
    expect(at(-3)).not.toBe(100);
    expect(at(-1, 100, 1)).toBeCloseTo(100 * Math.pow(1.08, 0.16), 10); // a line is 16 px
    expect(at(-100, SEQUENCE_ZOOM_MAX)).toBe(SEQUENCE_ZOOM_MAX);
    expect(at(100, SEQUENCE_ZOOM_MIN)).toBe(SEQUENCE_ZOOM_MIN);
    // Equal and opposite steps return to the start, and to the start's pan.
    const there = circularMapWheelStep(wheel({ deltaY: -100, clientX: 300, clientY: 200 }), { zoom: 120, pan: { x: 10, y: -5 }, rect: RECT });
    const back = circularMapWheelStep(wheel({ deltaY: 100, clientX: 300, clientY: 200 }), { zoom: there.zoom, pan: there.pan, rect: RECT });
    expect(back.zoom).toBeCloseTo(120, 9);
    expect(back.pan.x).toBeCloseTo(10, 9);
    expect(back.pan.y).toBeCloseTo(-5, 9);
  });

  it('a pointer away from the centre pans the view; with no measured box it zooms about the view centre', () => {
    const off = circularMapWheelStep(wheel({ deltaY: -100, clientX: 200, clientY: 120 }), { zoom: 100, pan: { x: 0, y: 0 }, rect: RECT });
    expect(Math.abs(off.pan.x) + Math.abs(off.pan.y)).toBeGreaterThan(10);
    const blind = circularMapWheelStep(wheel({ deltaY: -100, clientX: 200, clientY: 120 }), { zoom: 100, pan: { x: 20, y: -10 }, rect: { left: 0, top: 0, width: 0, height: 0 } });
    expect(blind.pan.x).toBeCloseTo(20 * 1.08, 9);
    expect(blind.pan.y).toBeCloseTo(-10 * 1.08, 9);
    const none = circularMapWheelStep(wheel({ deltaY: -100 }), { zoom: 100, pan: { x: 0, y: 0 }, rect: null });
    expect(none.handled).toBe(true);
    expect(none.zoom).toBeCloseTo(108, 10);
    expect(none.pan).toEqual({ x: 0, y: 0 });
    // A pointer that is not a number is no anchor: the view centre is, and the pan stays finite.
    const nan = circularMapWheelStep(wheel({ deltaY: -100, clientX: Number.NaN, clientY: 120 }), { zoom: 100, pan: { x: 20, y: -10 }, rect: RECT });
    expect(nan.pan.x).toBeCloseTo(20 * 1.08, 9);
    expect(nan.pan.y).toBeCloseTo(-10 * 1.08, 9);
  });

  it('the rendered map wheel-zooms through its own listener, reporting the zoom and the anchored pan', () => {
    const map = mountMap({ zoom: 125 });
    const pointer = { x: 330, y: 610 };
    const ev = wheel({ deltaY: -100, clientX: pointer.x, clientY: pointer.y });
    map.pane.fire('wheel', ev);
    const expected = circularMapWheelStep(ev, { zoom: 125, pan: { x: 0, y: 0 }, rect: RECT });
    expect(map.reports.length).toBe(1);
    expect(map.reports[0](40)).toBeCloseTo(expected.zoom, 10);
    expect(map.pans().at(-1)).toEqual(expected.pan);
    const before = mapPointAt(pointer, 125, { x: 0, y: 0 });
    const after = mapPointAt(pointer, map.reports[0](0), map.pans().at(-1)!);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // The next wheel starts from where the last one left the view, not from the last render.
    const ev2 = wheel({ ctrlKey: true, deltaY: -50, clientX: pointer.x, clientY: pointer.y });
    map.pane.fire('wheel', ev2);
    const expected2 = circularMapWheelStep(ev2, { zoom: expected.zoom, pan: expected.pan, rect: RECT });
    expect(map.reports[1](40)).toBeCloseTo(expected2.zoom, 10);
    expect(map.pans().at(-1)!.x).toBeCloseTo(expected2.pan.x, 9);
    expect(map.pans().at(-1)!.y).toBeCloseTo(expected2.pan.y, 9);
    map.unmount();
  });
});

// ─── AC2 ───

function autosavePuc19(zoomLevel: number) {
  expect(saveWorkbenchToLocalAutosave({
    sessionName: 'Wheel_Session',
    documents: [SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!],
    workspace: {
      activeDocId: 'doc-puc19', selectedFolder: 'All Project Files', navHistory: ['doc-puc19'], navIndex: 0,
      viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel, textFormat: 'genbank', colorScheme: 'standard',
      darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
      displaySettings: {
        showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
        showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: true,
      },
    },
  }), 'the autosave is written').toBe(true);
}

type AppStep = (dispatch: (id: string) => void) => void;

describe('US-01M7CC6H AC2 wheel, toolbar, keys and View › Zoom move one zoom', () => {
  it('labels the zoom as its rounded percentage', () => {
    expect([100, 103.4, 103.5, 137.6, 259.6, 65.2].map(sequenceZoomLabel)).toEqual(['100%', '103%', '104%', '138%', '260%', '65%']);
  });

  it('a fractional wheel zoom reaches the App readout rounded and the circle exactly, then the toolbar and menu step from it', () => {
    const captured: { zoomIn?: () => void; zoomOut?: () => void; map?: { zoomLevel: number; onZoomChange?: (u: (z: number) => number) => void } } = {};
    let pass = 0;
    const shown: { readout?: string; mapZoom?: number }[] = [];
    probe.onElement = (type, props) => {
      if (type === 'button' && props['aria-label'] === 'Zoom In') captured.zoomIn = props.onClick as () => void;
      if (type === 'button' && props['aria-label'] === 'Zoom Out') captured.zoomOut = props.onClick as () => void;
      if (type === 'button' && String(props.className ?? '').includes('zoom-pct-btn')) {
        shown[pass] = { ...shown[pass], readout: React.Children.toArray(props.children as React.ReactNode).join('') };
      }
      if (type === CircularPlasmidMap) {
        captured.map = props as unknown as NonNullable<typeof captured.map>;
        shown[pass] = { ...shown[pass], mapZoom: captured.map.zoomLevel };
      }
    };
    // The map's own wheel report: what its listener hands onZoomChange for a fractional step.
    // (A step runs before this pass draws the map, so it reads the App's zoom through the updater.)
    const wheelOnMap = (deltaY: number): AppStep => () => {
      captured.map!.onZoomChange!((z) => circularMapWheelStep(wheel({ deltaY }), { zoom: z, pan: { x: 0, y: 0 }, rect: RECT }).zoom);
    };
    // Each step must change the state, or the App stops re-rendering; the map is drawn after the
    // menus, so the first step after the restore is a menu one.
    const steps: AppStep[] = [
      (d) => d('file:restore-autosave'),
      (d) => d('view:zoom-in'),
      wheelOnMap(-30),
      (() => captured.zoomIn!()) as AppStep,
      wheelOnMap(45),
      (() => captured.zoomOut!()) as AppStep,
      (d) => d('view:zoom-out'),
    ];
    autosavePuc19(137.6);
    probe.onMenus = (_menus, dispatch) => {
      pass++;
      if (pass > 40) throw new Error('the App kept re-rendering');
      if (pass <= steps.length) steps[pass - 1](dispatch);
    };
    renderToStaticMarkup(<App />);
    expect(pass).toBe(steps.length + 1);
    // Step i runs in pass i + 1 and shows in pass i + 2.
    const seen = steps.map((_s, i) => shown[i + 2]);
    const z1 = 147.6 * Math.pow(1.08, 0.3);
    const z2 = (z1 + 10) * Math.pow(1.08, -0.45);
    const expectedZoom = [137.6, 147.6, z1, z1 + 10, z2, z2 - 10, z2 - 20];
    seen.forEach((s, i) => {
      expect(s?.mapZoom, `circle after step ${i}`).toBeCloseTo(expectedZoom[i], 9);
      expect(s?.readout, `readout after step ${i}`).toBe(`${Math.round(expectedZoom[i])}%`);
    });
    // The readout really is rounded, not the raw state.
    expect(seen.map((s) => s?.readout)).toContain('138%');
  });
});

// ─── AC3 ───

describe('US-01M7CC6H AC3 zooming leaves the selection, cut sites and features alone', () => {
  it('a wheel zoom reports a zoom and a pan only, and the selection reads the same at the new zoom', () => {
    const range = deepFreeze({ start: 120, end: 980 });
    const map = mountMap({ zoom: 100, selectedRange: range });
    for (const deltaY of [-100, -100, 40, -7]) map.pane.fire('wheel', wheel({ deltaY, clientX: 410, clientY: 260 }));
    map.pane.fire('wheel', wheel({ ctrlKey: true, deltaY: -12, clientX: 900, clientY: 500 }));
    expect(map.selections, 'no selection change').toEqual([]);
    expect(map.reports.length).toBe(5);
    const zoom = map.reports.at(-1)!(0);
    const pill = (html: string) => /class="circular-hover-pill"[^>]*>([^<]*)</.exec(html)?.[1];
    const zoomed = mountMap({ zoom, selectedRange: range });
    expect(pill(zoomed.html)).toBe(pill(map.html));
    expect(pill(map.html)).toContain('Selected 120..980');
    // The features and cut sites the map was given are the ones it still holds (both are frozen,
    // so a zoom that wrote to them would have thrown), and the zoom only scales the view group.
    expect(Object.isFrozen(puc19.features) && Object.isFrozen(puc19Cuts)).toBe(true);
    expect(viewGroupTransform(zoomed.html)?.[0]).toContain(`scale(${(zoom / 100).toFixed(4)})`);
    map.unmount();
    zoomed.unmount();
  });

  it('double-click resets the zoom to 100% and the pan to the centre, and the next wheel starts there', () => {
    const map = mountMap({ zoom: 100 });
    const ev = () => wheel({ deltaY: -100, clientX: 260, clientY: 700 });
    map.pane.fire('wheel', ev());
    const first = { zoom: map.reports[0](0), pan: map.pans().at(-1)! };
    map.pane.fire('wheel', ev());
    (map.paneProps.onDoubleClick as (e: object) => void)({});
    expect(map.reports.at(-1)!(173)).toBe(100);
    expect(map.pans().at(-1)).toEqual({ x: 0, y: 0 });
    map.pane.fire('wheel', ev());
    expect(map.reports.at(-1)!(0)).toBeCloseTo(first.zoom, 10);
    expect(map.pans().at(-1)).toEqual(first.pan);
    map.unmount();
  });
});

// ─── AC4 ───

describe('US-01M7CC6H AC4 a non-passive listener takes only the gestures the map handles', () => {
  it('registers a non-passive wheel listener on the scroll pane, and removes it on unmount', () => {
    const map = mountMap();
    expect(map.paneProps.onWheel, 'no passive React onWheel as well, or a wheel would zoom twice').toBeUndefined();
    const wheels = map.pane.added.filter((a) => a.type === 'wheel');
    expect(wheels.length).toBe(1);
    expect((wheels[0].options as { passive?: boolean } | undefined)?.passive).toBe(false);
    map.unmount();
    expect(map.pane.live('wheel')).toEqual([]);
    expect(map.pane.live('gesturestart')).toEqual([]);
    expect(map.pane.live('gesturechange')).toEqual([]);
    const ev = wheel({ deltaY: -100 });
    map.pane.fire('wheel', ev);
    expect(ev.prevented()).toBe(0);
  });

  it('prevents the default of a zoom gesture only, never of a horizontal scroll', () => {
    const map = mountMap();
    const cases: [Partial<FakeEvent>, boolean][] = [
      [{ deltaY: -100 }, true],
      [{ deltaY: 4 }, true],
      [{ ctrlKey: true, deltaY: -2.5 }, true],
      [{ metaKey: true, deltaY: 100 }, true],
      [{ altKey: true, deltaY: -100 }, true],
      [{ deltaX: 80, deltaY: 0 }, false],
      [{ deltaX: -60, deltaY: 20 }, false],
      [{ ctrlKey: true, deltaX: 90, deltaY: 10 }, false],
      [{ deltaX: 0, deltaY: 0 }, false],
    ];
    for (const [p, zooms] of cases) {
      const before = map.reports.length;
      const ev = wheel(p);
      map.pane.fire('wheel', ev);
      expect(ev.prevented(), JSON.stringify(p)).toBe(zooms ? 1 : 0);
      expect(map.reports.length - before, JSON.stringify(p)).toBe(zooms ? 1 : 0);
    }
    map.unmount();
  });

  it('a pinch zooms the map once: deltas within a frame are summed into one step', () => {
    const frames = fakeFrames();
    const map = mountMap({ zoom: 100 });
    const pinch = [-3, -4.5, -2, -6].map((deltaY) => wheel({ ctrlKey: true, deltaY, clientX: 700, clientY: 400 }));
    for (const ev of pinch) map.pane.fire('wheel', ev);
    expect(pinch.map((e) => e.prevented())).toEqual([1, 1, 1, 1]);
    expect(map.reports.length, 'nothing until the frame').toBe(0);
    expect(frames.pending()).toBe(1);
    frames.frame();
    expect(map.reports.length).toBe(1);
    expect(map.reports[0](0)).toBeCloseTo(100 * Math.pow(1.08, 0.155), 10);
    map.unmount();
    expect(frames.pending(), 'unmount cancels a queued frame').toBe(0);
  });

  it('a WebKit pinch (gesture events) zooms by its scale, once, and its ctrl-wheel twin is not applied again', () => {
    const map = mountMap({ zoom: 120 });
    const start = wheel({ clientX: 700, clientY: 400, scale: 1 });
    map.pane.fire('gesturestart', start);
    const change = wheel({ clientX: 700, clientY: 400, scale: 1.5 });
    map.pane.fire('gesturechange', change);
    const twin = wheel({ ctrlKey: true, deltaY: -10, clientX: 700, clientY: 400 });
    map.pane.fire('wheel', twin);
    map.pane.fire('gestureend', wheel({ scale: 1.5 }));
    expect([start.prevented(), change.prevented(), twin.prevented()]).toEqual([1, 1, 1]);
    expect(map.reports.length).toBe(1);
    expect(map.reports[0](0)).toBeCloseTo(180, 10);
    const before = mapPointAt({ x: 700, y: 400 }, 120, { x: 0, y: 0 });
    const after = mapPointAt({ x: 700, y: 400 }, 180, map.pans().at(-1)!);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // After the gesture a ctrl-wheel zooms again.
    map.pane.fire('wheel', wheel({ ctrlKey: true, deltaY: -10, clientX: 700, clientY: 400 }));
    expect(map.reports.length).toBe(2);
    map.unmount();
  });

  it('bindCircularMapWheel registers and removes the same listeners with the same options', () => {
    const target = fakeTarget();
    const unbind = bindCircularMapWheel(target as unknown as Parameters<typeof bindCircularMapWheel>[0], { read: () => ({ zoom: 100, pan: { x: 0, y: 0 }, rect: RECT }), apply: () => {} });
    for (const a of target.added) expect((a.options as { passive?: boolean }).passive, a.type).toBe(false);
    unbind();
    expect(target.removed.map((r) => r.listener)).toEqual(target.added.map((a) => a.listener));
  });
});
