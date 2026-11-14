// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CCQ6: the Export control tells preparing, saved, cancelled and failed apart, and never
 * saves a figure that measures zero.
 *
 * The control is driven through its own trigger and menu items. React's state hooks are replaced
 * by a small slot store, so the component can be called as a function and re-rendered after each
 * click without a DOM; the save itself runs through the real `exportFigure`, with the desktop's
 * Tauri `invoke` (or the browser download) stubbed at the global it is read from.
 */

import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── A slot store standing in for React's hooks ───

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], i: 0 }));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useState = (init: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof init === 'function' ? (init as () => unknown)() : init;
    const set = (next: unknown) => {
      hooks.slots[i] = typeof next === 'function' ? (next as (p: unknown) => unknown)(hooks.slots[i]) : next;
    };
    return [hooks.slots[i], set];
  };
  const useRef = (init: unknown) => {
    const i = hooks.i++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: init };
    return hooks.slots[i];
  };
  const useCallback = (fn: unknown) => fn;
  const useEffect = () => undefined;
  const mocked = { ...actual, useState, useRef, useCallback, useEffect };
  return { ...mocked, default: mocked };
});

const { FigureExportButton } = await import('../components/FigureExportButton');
const capture = await import('../core/figureCapture');

type Props = React.ComponentProps<typeof FigureExportButton>;
interface El { type: unknown; props: Record<string, unknown> }

function render(props: Props): El {
  hooks.i = 0;
  return FigureExportButton(props) as unknown as El;
}

function all(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => all(n, out));
  else if (node && typeof node === 'object' && 'props' in node) {
    const el = node as El;
    out.push(el);
    all(el.props.children, out);
  }
  return out;
}

function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'object' && 'props' in node) return text((node as El).props.children);
  return '';
}

const hasClass = (el: El, name: string) => String(el.props.className ?? '').split(/\s+/).includes(name);

/** The control as the user sees it after the last click. */
function view(props: Props) {
  const tree = all(render(props));
  const trigger = tree.find((e) => hasClass(e, 'mbc-figure-export-trigger'));
  if (!trigger) throw new Error('the control rendered no trigger');
  const note = tree.find((e) => hasClass(e, 'mbc-figure-export-note'));
  const items = tree.filter((e) => e.props.role === 'menuitem');
  return {
    trigger: { label: text(trigger.props.children), disabled: Boolean(trigger.props.disabled), click: trigger.props.onClick as () => void },
    note: note ? text(note.props.children) : '',
    item: (ext: string) => {
      const hit = items.find((e) => text(e.props.children).startsWith(ext));
      if (!hit) throw new Error(`the menu offers no ${ext}; it offers ${items.map((e) => text(e.props.children)).join(', ')}`);
      return hit.props.onClick as () => void;
    },
    offers: items.map((e) => text(e.props.children).slice(0, 3)),
  };
}

// ─── Fake host elements ───

/**
 * A drawing with a rendered box of `width` x `height`. One that measures nothing has no layout box
 * either, as in a hidden or collapsed pane, unless `laidOut` says it keeps one (scrolled out of view).
 */
function fakeSvg(width: number, height: number, viewBox: string | null = null, laidOut = width > 0 && height > 0) {
  const rect = { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 };
  return {
    tagName: 'svg',
    getBoundingClientRect: () => rect,
    getClientRects: () => (laidOut ? [rect] : []),
    getAttribute: (name: string) => (name === 'viewBox' ? viewBox : null),
    closest: () => null,
  };
}

function fakeHost(svgs: unknown[]) {
  return {
    querySelectorAll: (sel: string) => (sel === 'svg' ? svgs : []),
    querySelector: () => null,
  } as unknown as HTMLElement;
}

const TABLE = { headers: ['Feature', 'Start'], rows: [['lacZ', '146']] };

// ─── Runtime stubs ───

interface Dialog { invoke: ReturnType<typeof vi.fn>; settle: (path: string | null) => void; fail: (msg: string) => void; events: string[] }

/** The desktop app: a Tauri `invoke` whose save dialog the test closes by hand. */
function desktop(): Dialog {
  const d: Dialog = { invoke: vi.fn(), settle: () => undefined, fail: () => undefined, events: [] };
  d.invoke.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        d.settle = resolve;
        d.fail = (msg) => reject(new Error(msg));
      })
  );
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke: d.invoke });
  vi.stubGlobal('window', {
    dispatchEvent: (e: Event) => {
      d.events.push(`${e.type}:${String((e as CustomEvent).detail)}`);
      return true;
    },
    setTimeout,
  });
  return d;
}

/** A browser tab: no native bridge, an anchor download. */
function browser() {
  const clicks: string[] = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const a = { href: '', download: '', rel: '', click: () => clicks.push(a.download) };
      return a;
    },
  });
  vi.stubGlobal('window', { setTimeout: () => 0, dispatchEvent: () => true });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:figure');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
  return clicks;
}

async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Open the menu and choose one format, as a user does. */
function choose(props: Props, ext: string) {
  view(props).trigger.click();
  view(props).item(ext)();
}

afterEach(() => {
  hooks.slots = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('US-01M7CCQ6 AC1: preparing, then the outcome the runtime can know', () => {
  it('US-01M7CCQ6 AC1 desktop: Preparing, then the save dialog, then Saved with the name the user chose', async () => {
    const d = desktop();
    const props: Props = { baseName: 'pUC19 — Features', table: TABLE, targetRef: { current: fakeHost([]) } };
    choose(props, 'CSV');

    const preparing = view(props);
    expect(preparing.trigger.label).toMatch(/Preparing/);
    expect(preparing.trigger.disabled).toBe(true);
    expect(preparing.note).toMatch(/Preparing/);

    await until(() => d.invoke.mock.calls.length === 1, 'the native save dialog');
    const dialog = view(props);
    expect(dialog.note).toBe('Choose where to save "pUC19_—_Features.csv"');
    expect(dialog.note).not.toMatch(/Saved/);

    d.settle('/Users/ada/Desktop/lacZ features.csv');
    await until(() => /Saved/.test(view(props).note), 'the saved report');
    const saved = view(props);
    expect(saved.note).toBe('Saved "lacZ features.csv"');
    expect(saved.trigger.disabled).toBe(false);
    expect(saved.trigger.label).toMatch(/Export/);
    // The rest of the app still hears about the save, as it did through the bridge.
    expect(d.events).toEqual(['mbc:native-file-saved:/Users/ada/Desktop/lacZ features.csv']);
  });

  it('US-01M7CCQ6 AC1 desktop: a cancelled save dialog is reported as cancelled, never as saved', async () => {
    const d = desktop();
    const said: string[] = [];
    const props: Props = { baseName: 'pUC19 — Features', table: TABLE, onStatus: (m) => said.push(m), targetRef: { current: fakeHost([]) } };
    choose(props, 'CSV');
    await until(() => d.invoke.mock.calls.length === 1, 'the native save dialog');
    d.settle(null);
    await until(() => said.length === 3, 'the dialog outcome');

    expect(said[0]).toMatch(/^Preparing/);
    expect(said[1]).toBe('Choose where to save "pUC19_—_Features.csv"');
    expect(said[2]).toMatch(/^Save cancelled/);
    expect(said.join('\n')).not.toMatch(/Saved|Exported/);
    expect(d.events).toEqual([]);
    expect(view(props).trigger.disabled).toBe(false);
  });

  it('US-01M7CCQ6 AC1 desktop: a save the dialog could not write is a failure with its reason', async () => {
    const d = desktop();
    const props: Props = { baseName: 'pUC19 — Features', table: TABLE, targetRef: { current: fakeHost([]) } };
    choose(props, 'TSV');
    await until(() => d.invoke.mock.calls.length === 1, 'the native save dialog');
    d.fail('disk is full');
    await until(() => /failed/.test(view(props).note), 'the failure report');
    expect(view(props).note).toMatch(/^Export failed: .*disk is full/);
    expect(view(props).note).not.toMatch(/Saved/);
    expect(view(props).trigger.disabled).toBe(false);
  });

  it('US-01M7CCQ6 AC1 browser: the download is reported as started, not as saved', async () => {
    const clicks = browser();
    const said: string[] = [];
    const props: Props = { baseName: 'pUC19 — Features', table: TABLE, onStatus: (m) => said.push(m), targetRef: { current: fakeHost([]) } };
    choose(props, 'CSV');
    await until(() => said.length === 2, 'the download report');
    expect(clicks).toEqual(['pUC19_—_Features.csv']);
    expect(said).toEqual([said[0], 'Download started for "pUC19_—_Features.csv"']);
    expect(said[0]).toMatch(/^Preparing/);
    expect(view(props).trigger.disabled).toBe(false);
  });

  it('US-01M7CCQ6 AC1 every status reads as what happened', () => {
    const base = { filename: 'map.png', format: 'png' as const };
    const say = capture.describeFigureExportStatus;
    expect(say({ ...base, phase: 'preparing' })).toBe('Preparing "map.png"…');
    expect(say({ ...base, phase: 'dialog', settling: true })).toBe('Choose where to save "map.png"');
    expect(say({ ...base, phase: 'saved', path: 'C:\\Users\\ada\\map copy.png' })).toBe('Saved "map copy.png"');
    expect(say({ ...base, phase: 'cancelled' })).toBe('Save cancelled: "map.png" was not saved');
    expect(say({ ...base, phase: 'downloaded' })).toBe('Download started for "map.png"');
    expect(say({ ...base, phase: 'failed', error: 'no canvas' })).toBe('Export failed: no canvas');
    expect(capture.figureExportBusy({ ...base, phase: 'preparing' })).toBe(true);
    expect(capture.figureExportBusy({ ...base, phase: 'dialog', settling: true })).toBe(true);
    expect(capture.figureExportBusy({ ...base, phase: 'dialog', settling: false })).toBe(false);
    for (const phase of ['saved', 'cancelled', 'downloaded', 'failed'] as const) {
      expect(capture.figureExportBusy({ ...base, phase, path: 'x', error: 'x' } as never)).toBe(false);
    }
  });
});

describe('US-01M7CCQ6 AC2: a rejection is caught at the button', () => {
  it('US-01M7CCQ6 AC2 a throw while gathering the export is shown as a failure and the button can retry', async () => {
    const clicks = browser();
    let calls = 0;
    const table = () => {
      calls += 1;
      if (calls === 2) throw new Error('the table went away');
      return TABLE;
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const props: Props = { baseName: 'Features', table, targetRef: { current: fakeHost([]) } };
      choose(props, 'CSV'); // the menu reads the table once (call 1); the export reads it again (call 2)
      await until(() => /failed/.test(view(props).note), 'the failure report');
      const failed = view(props);
      expect(failed.note).toBe('Export failed: the table went away');
      expect(failed.trigger.disabled).toBe(false);
      expect(failed.trigger.label).toMatch(/Export/);
      expect(clicks).toEqual([]);

      // Retry from the same control.
      choose(props, 'CSV');
      await until(() => /Download started/.test(view(props).note), 'the retried export');
      expect(clicks).toEqual(['Features.csv']);
      await new Promise((r) => setTimeout(r, 5));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('US-01M7CCQ6 AC2 an exporter that rejects, or a dialog promise that rejects, ends as failed', async () => {
    const seen: string[] = [];
    const report = (s: { phase: string }) => seen.push(s.phase);
    const rejecting = await capture.runFigureExport({
      baseName: 'Map',
      format: 'png',
      prepare: () => ({ baseName: 'Map' }),
      report,
      exporter: () => Promise.reject(new Error('canvas tainted')),
    });
    expect(rejecting).toMatchObject({ phase: 'failed', error: 'canvas tainted', filename: 'Map.png' });
    expect(seen).toEqual(['preparing', 'failed']);

    seen.length = 0;
    const dialogRejects = await capture.runFigureExport({
      baseName: 'Map',
      format: 'png',
      prepare: () => ({ baseName: 'Map' }),
      report,
      exporter: async () => ({ outcome: 'native', filename: 'Map.png', saved: Promise.reject(new Error('IPC closed')) }),
    });
    expect(dialogRejects).toMatchObject({ phase: 'failed', error: 'IPC closed' });
    expect(seen).toEqual(['preparing', 'dialog', 'failed']);
  });
});

describe('US-01M7CCQ6 AC3: a figure that measures zero is not exported', () => {
  it('US-01M7CCQ6 AC3 a collapsed figure is refused with the reason, and nothing reaches the save dialog', async () => {
    const d = desktop();
    // Collapsed pane: the drawing has a viewBox but no rendered box.
    const said: string[] = [];
    const props: Props = { baseName: 'pUC19 — Map', onStatus: (m) => said.push(m), targetRef: { current: fakeHost([fakeSvg(0, 0, '0 0 600 400')]) } };
    view(props).trigger.click();
    expect(view(props).offers).toContain('PNG');
    for (const [k, ext] of ['PNG', 'SVG', 'PDF'].entries()) {
      view(props).item(ext)();
      await until(() => said.length === 2 * (k + 1), `the ${ext} refusal`);
      expect(said[2 * k]).toMatch(/^Preparing/);
      expect(said[2 * k + 1]).toMatch(/^Export failed: .*measures 0 × 0.*Show the figure to export it/);
      expect(view(props).trigger.disabled).toBe(false);
      view(props).trigger.click();
    }
    expect(d.invoke).not.toHaveBeenCalled();
  });

  it('US-01M7CCQ6 AC3 exportFigure refuses a zero-measure or missing figure in every image format', async () => {
    const d = desktop();
    for (const format of ['png', 'jpeg', 'svg', 'pdf'] as const) {
      const zero = await capture.exportFigure({ svg: fakeSvg(0, 0, '0 0 600 400') as unknown as SVGSVGElement, baseName: 'Map' }, format);
      expect(zero.outcome, format).toBe(false);
      expect(zero.error, format).toMatch(/measures 0 × 0.*Show the figure to export it/);
      const flat = await capture.exportFigure({ svg: fakeSvg(480, 0, '0 0 600 400') as unknown as SVGSVGElement, baseName: 'Map' }, format);
      expect(flat.error, `${format}: zero height`).toMatch(/Show the figure to export it/);
      const none = await capture.exportFigure({ svg: null, baseName: 'Map' }, format);
      expect(none.outcome, format).toBe(false);
      expect(none.error, format).toMatch(/Show the figure to export it/);
      // A figure that is on screen gets past the check (it then fails later only for want of a DOM here).
      const shown = await capture.exportFigure({ svg: fakeSvg(600, 400, '0 0 600 400') as unknown as SVGSVGElement, baseName: 'Map' }, format);
      expect(shown.error ?? '', `${format}: a visible figure is not refused`).not.toMatch(/Show the figure/);
    }
    expect(d.invoke).not.toHaveBeenCalled();
  });

  it('US-01M7CCQ6 AC3 a figure scrolled out of view keeps its layout box and is not refused (BG-01M6RJZB)', async () => {
    desktop();
    const scrolled = fakeSvg(0, 0, '0 0 480 340', true);
    expect(capture.figureNotShowingReason(scrolled as unknown as SVGSVGElement)).toBeNull();
    const hidden = fakeSvg(0, 0, '0 0 480 340');
    expect(capture.figureNotShowingReason(hidden as unknown as SVGSVGElement)).toMatch(/measures 0 × 0/);
    const result = await capture.exportFigure({ svg: scrolled as unknown as SVGSVGElement, baseName: 'Gel' }, 'svg');
    expect(result.error ?? '').not.toMatch(/Show the figure/);
  });

  it('US-01M7CCQ6 AC3 the figure on screen is chosen over a larger hidden one', () => {
    const hidden = fakeSvg(0, 0, '0 0 2000 2000');
    const shown = fakeSvg(400, 300, '0 0 400 300');
    expect(capture.findFigureSvg(fakeHost([hidden, shown]))).toBe(shown);
    // With nothing on screen the hidden drawing is still found, so the export can say why it refuses.
    expect(capture.findFigureSvg(fakeHost([hidden]))).toBe(hidden);
  });
});
