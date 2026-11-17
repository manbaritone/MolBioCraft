// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The document split's divider arithmetic (US-01M7DVB1), read through src/core/documentSplit.ts:
 * the axis a drag reads, the minimum each expanded pane keeps along it, the drawn ratio a narrower
 * window clamps while the chosen one is kept, the keys, and each case of a saved size restored.
 * The same behaviour is driven through the mounted App in splitDocumentPane.test.tsx.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_SPLIT_DIVIDER_PX,
  DOCUMENT_SPLIT_MIN_PX,
  UNREADABLE_DOCUMENT_SPLIT_SIZE_NOTICE,
  documentSplitForSession,
  documentSplitHostClass,
  documentSplitKey,
  documentSplitValueNow,
  dragDocumentSplit,
  parseDocumentSplit,
  renderedDocumentSplitRatio,
  type DocumentSplitSize,
} from '../core/documentSplit';
import { PANE_COLLAPSE_FRACTION, PANE_SPLIT_KEY_STEP_LARGE_PX, PANE_SPLIT_KEY_STEP_PX } from '../core/paneSplit';

const HALF: DocumentSplitSize = { ratio: 0.5, collapsed: null };
/** A host 1,006 x 606: 1,000 px wide and 600 px tall left for the two panes beside the 6 px divider. */
const BOX = { left: 0, top: 0, width: 1000 + DOCUMENT_SPLIT_DIVIDER_PX, height: 600 + DOCUMENT_SPLIT_DIVIDER_PX };
const HALF_DIVIDER = DOCUMENT_SPLIT_DIVIDER_PX / 2;
/** The pointer that puts the divider's centre so the main pane is `mainPx` along the axis. */
const at = (mainPx: number) => mainPx + HALF_DIVIDER;

describe('US-01M7DVB1 AC1: a drag sets the ratio along the active axis, clamped to each pane\'s minimum', () => {
  it('US-01M7DVB1 AC1 the minimums are 320 px wide side by side and 200 px tall top and bottom', () => {
    expect(DOCUMENT_SPLIT_MIN_PX).toEqual({ 'side-by-side': 320, 'top-bottom': 200 });
  });

  it('US-01M7DVB1 AC1 side by side reads the pointer\'s x against the width, top and bottom its y against the height', () => {
    // The same pointer: x gives 0.4 of the width, y gives 0.6 of the height.
    const point = { x: at(400), y: at(360) };
    expect(dragDocumentSplit(HALF, point, BOX, 'side-by-side')).toEqual({ ratio: 0.4, collapsed: null });
    expect(dragDocumentSplit(HALF, point, BOX, 'top-bottom')).toEqual({ ratio: 0.6, collapsed: null });
    // Measured from the host's own edge, not the page's.
    const moved = { ...BOX, left: 200, top: 50 };
    expect(dragDocumentSplit(HALF, { x: 200 + at(350), y: 50 + at(300) }, moved, 'side-by-side').ratio).toBeCloseTo(0.35, 12);
    expect(dragDocumentSplit(HALF, { x: 200 + at(350), y: 50 + at(300) }, moved, 'top-bottom').ratio).toBeCloseTo(0.5, 12);
  });

  it('US-01M7DVB1 AC1 a drag is clamped so each expanded pane keeps the minimum of its axis', () => {
    // 250 px: under side by side's 320, over top and bottom's 200, and over half of either (no collapse).
    const drag = (point: { x: number; y: number }, o: 'side-by-side' | 'top-bottom') => {
      const r = dragDocumentSplit(HALF, point, BOX, o);
      expect(r.collapsed, `${o} ${JSON.stringify(point)} stays expanded`).toBeNull();
      return r.ratio;
    };
    expect(drag({ x: at(250), y: 0 }, 'side-by-side')).toBeCloseTo(320 / 1000, 12);
    expect(drag({ x: 0, y: at(250) }, 'top-bottom')).toBeCloseTo(250 / 600, 12);
    expect(drag({ x: 0, y: at(450) }, 'top-bottom')).toBeCloseTo(400 / 600, 12);
    expect(drag({ x: at(800), y: 0 }, 'side-by-side')).toBeCloseTo(680 / 1000, 12);
    expect(drag({ x: at(120), y: at(120) }, 'top-bottom')).toBeCloseTo(200 / 600, 12);
  });

  it('US-01M7DVB1 AC1 a drag that leaves a pane under half its minimum folds it away and keeps the ratio it began with', () => {
    const start: DocumentSplitSize = { ratio: 0.42, collapsed: null };
    const sideFold = 320 * PANE_COLLAPSE_FRACTION;
    expect(dragDocumentSplit(start, { x: at(sideFold - 1), y: 300 }, BOX, 'side-by-side')).toEqual({ ratio: 0.42, collapsed: 'main' });
    expect(dragDocumentSplit(start, { x: at(1000 - sideFold + 1), y: 300 }, BOX, 'side-by-side')).toEqual({ ratio: 0.42, collapsed: 'second' });
    expect(dragDocumentSplit(start, { x: at(sideFold + 1), y: 300 }, BOX, 'side-by-side').collapsed).toBeNull();
    const stackFold = 200 * PANE_COLLAPSE_FRACTION;
    expect(dragDocumentSplit(start, { x: 500, y: at(stackFold - 1) }, BOX, 'top-bottom')).toEqual({ ratio: 0.42, collapsed: 'main' });
    expect(dragDocumentSplit(start, { x: 500, y: at(stackFold + 1) }, BOX, 'top-bottom').collapsed).toBeNull();
  });

  it('US-01M7DVB1 AC1 a narrower window clamps the drawn ratio only, and an unmeasured host draws the chosen one', () => {
    // Side by side 806 px: 800 for the panes, so 0.3 (240 px) draws at 320 / 800.
    expect(renderedDocumentSplitRatio(0.3, 806, 'side-by-side')).toBeCloseTo(0.4, 12);
    expect(renderedDocumentSplitRatio(0.3, 1206, 'side-by-side')).toBeCloseTo(0.3, 12);
    expect(renderedDocumentSplitRatio(0.3, 806, 'top-bottom')).toBeCloseTo(0.3, 12);
    expect(renderedDocumentSplitRatio(0.9, 806, 'top-bottom')).toBeCloseTo(600 / 800, 12);
    expect(renderedDocumentSplitRatio(0.3, null, 'side-by-side')).toBe(0.3);
    expect(renderedDocumentSplitRatio(0.3, 0, 'side-by-side')).toBe(0.3);
    // Too narrow for both minimums: half each.
    expect(renderedDocumentSplitRatio(0.3, 500, 'side-by-side')).toBe(0.5);
  });

  it('US-01M7DVB1 AC1 the session saves a chosen ratio and a collapsed pane, and nothing more while they are the default', () => {
    const docs = [{ id: 'a', name: 'Doc_A' }];
    expect(documentSplitForSession('side-by-side', 'a', docs, HALF)).toEqual({ orientation: 'side-by-side', docId: 'a', docName: 'Doc_A' });
    expect(documentSplitForSession('side-by-side', 'a', docs)).toEqual({ orientation: 'side-by-side', docId: 'a', docName: 'Doc_A' });
    expect(documentSplitForSession('top-bottom', 'a', docs, { ratio: 0.3, collapsed: null }))
      .toEqual({ orientation: 'top-bottom', docId: 'a', docName: 'Doc_A', ratio: 0.3 });
    expect(documentSplitForSession('top-bottom', 'a', docs, { ratio: 0.5, collapsed: 'second' }))
      .toEqual({ orientation: 'top-bottom', docId: 'a', docName: 'Doc_A', collapsed: 'second' });
    expect(documentSplitForSession('single', 'a', docs, { ratio: 0.25, collapsed: 'main' }))
      .toEqual({ orientation: 'single', docId: 'a', docName: 'Doc_A', ratio: 0.25, collapsed: 'main' });
    expect(documentSplitForSession('single', null, docs, { ratio: 0.25, collapsed: null })).toBeUndefined();
  });

  const docs = [{ id: 'a' }];
  const base = { orientation: 'side-by-side', docId: 'a', docName: 'Doc_A' };

  it('US-01M7DVB1 AC1 a saved ratio and collapse come back; an absent ratio opens at half each with no message', () => {
    expect(parseDocumentSplit({ ...base, ratio: 0.3, collapsed: 'second' }, docs)).toEqual({
      orientation: 'side-by-side', docId: 'a', notice: null, size: { ratio: 0.3, collapsed: 'second' }, sizeNotice: null,
    });
    for (const edge of [0, 1]) expect(parseDocumentSplit({ ...base, ratio: edge }, docs).size).toEqual({ ratio: edge, collapsed: null });
    expect(parseDocumentSplit({ ...base, collapsed: null }, docs).size).toEqual(HALF);
    const absent = parseDocumentSplit(base, docs);
    expect(absent.size).toEqual(HALF);
    expect(absent.sizeNotice).toBeNull();
    expect(absent.notice).toBeNull();
    // A session saved before the split at all: half each, nothing said.
    expect(parseDocumentSplit(undefined, docs)).toMatchObject({ size: HALF, sizeNotice: null, notice: null });
  });

  it('US-01M7DVB1 AC1 an unreadable ratio or collapse opens at half each, not collapsed, and says exactly so', () => {
    expect(UNREADABLE_DOCUMENT_SPLIT_SIZE_NOTICE).toBe('The saved split size could not be read; the panes open at half each.');
    for (const bad of [
      { ratio: '0.3' }, { ratio: null }, { ratio: Number.NaN }, { ratio: Number.POSITIVE_INFINITY },
      { ratio: -0.01 }, { ratio: 1.01 }, { ratio: 0.3, collapsed: 'left' }, { ratio: 0.3, collapsed: 1 },
      { collapsed: 'circular' },
    ]) {
      const r = parseDocumentSplit({ ...base, ...bad }, docs);
      expect(r.size, JSON.stringify(bad)).toEqual(HALF);
      expect(r.sizeNotice, JSON.stringify(bad)).toBe(UNREADABLE_DOCUMENT_SPLIT_SIZE_NOTICE);
      // The orientation and document are read apart from the size.
      expect(r.orientation, JSON.stringify(bad)).toBe('side-by-side');
      expect(r.docId).toBe('a');
      expect(r.notice).toBeNull();
    }
    // A missing document still names its size problem once; a split that cannot be read at all says only that.
    expect(parseDocumentSplit({ ...base, docId: 'gone', ratio: 'x' }, docs).sizeNotice).toBe(UNREADABLE_DOCUMENT_SPLIT_SIZE_NOTICE);
    const whole = parseDocumentSplit({ orientation: 'diagonal', docId: 'a', ratio: 'x' }, docs);
    expect(whole.size).toEqual(HALF);
    expect(whole.sizeNotice).toBeNull();
  });
});

describe('US-01M7DVB1 AC2: the keys move the divider along its own axis', () => {
  const W = 1000 + DOCUMENT_SPLIT_DIVIDER_PX;
  it('US-01M7DVB1 AC2 side by side takes Left and Right, top and bottom Up and Down, Shift the large step', () => {
    expect(documentSplitKey(HALF, 'ArrowRight', false, W, 'side-by-side')!.ratio).toBeCloseTo(0.5 + PANE_SPLIT_KEY_STEP_PX / 1000, 12);
    expect(documentSplitKey(HALF, 'ArrowLeft', true, W, 'side-by-side')!.ratio).toBeCloseTo(0.5 - PANE_SPLIT_KEY_STEP_LARGE_PX / 1000, 12);
    expect(documentSplitKey(HALF, 'ArrowDown', false, W, 'top-bottom')!.ratio).toBeCloseTo(0.5 + PANE_SPLIT_KEY_STEP_PX / 1000, 12);
    expect(documentSplitKey(HALF, 'ArrowUp', true, W, 'top-bottom')!.ratio).toBeCloseTo(0.5 - PANE_SPLIT_KEY_STEP_LARGE_PX / 1000, 12);
    for (const k of ['ArrowUp', 'ArrowDown']) expect(documentSplitKey(HALF, k, false, W, 'side-by-side'), k).toBeNull();
    for (const k of ['ArrowLeft', 'ArrowRight']) expect(documentSplitKey(HALF, k, false, W, 'top-bottom'), k).toBeNull();
    expect(documentSplitKey(HALF, 'Home', false, W, 'side-by-side')).toEqual({ ratio: 0.5, collapsed: 'main' });
    expect(documentSplitKey({ ratio: 0.3, collapsed: null }, 'End', false, W, 'top-bottom')).toEqual({ ratio: 0.3, collapsed: 'second' });
    expect(documentSplitKey({ ratio: 0.3, collapsed: 'main' }, 'Enter', false, W, 'top-bottom')).toEqual({ ratio: 0.3, collapsed: null });
    // A step is clamped to the minimum, from the ratio as drawn.
    expect(documentSplitKey({ ratio: 0.33, collapsed: null }, 'ArrowLeft', true, W, 'side-by-side')!.ratio).toBeCloseTo(0.32, 12);
    expect(documentSplitKey({ ratio: 0.1, collapsed: null }, 'ArrowRight', false, W, 'side-by-side')!.ratio).toBeCloseTo(0.32 + 0.016, 12);
  });

  it('US-01M7DVB1 AC2 the value is the main pane\'s drawn share in whole percent, 0 and 100 when a pane is folded', () => {
    expect(documentSplitValueNow({ ratio: 0.3333, collapsed: null })).toBe(33);
    expect(documentSplitValueNow({ ratio: 0.3333, collapsed: 'main' })).toBe(0);
    expect(documentSplitValueNow({ ratio: 0.3333, collapsed: 'second' })).toBe(100);
  });

  it('US-01M7DVB1 AC2 a folded pane gives the host its class while the split shows', () => {
    expect(documentSplitHostClass('side-by-side', 'main')).toBe('mbc-split-host is-split is-side-by-side is-collapsed-main');
    expect(documentSplitHostClass('top-bottom', 'second')).toBe('mbc-split-host is-split is-top-bottom is-collapsed-second');
    expect(documentSplitHostClass('top-bottom', null)).toBe('mbc-split-host is-split is-top-bottom');
    expect(documentSplitHostClass('single', 'main')).toBe('mbc-split-host');
  });
});

describe('US-01M7DVB1 AC5: the step and collapse constants come from paneSplit', () => {
  it('US-01M7DVB1 AC5 documentSplit.ts imports them from ./paneSplit and defines none of its own', () => {
    const src = readFileSync(new URL('../core/documentSplit.ts', import.meta.url), 'utf8');
    const imported = /import\s*\{([^}]*)\}\s*from '\.\/paneSplit'/.exec(src)?.[1] ?? '';
    for (const name of ['PANE_COLLAPSE_FRACTION', 'PANE_SPLIT_KEY_STEP_PX', 'PANE_SPLIT_KEY_STEP_LARGE_PX']) {
      expect(imported, name).toContain(name);
    }
    expect(src).not.toMatch(/\b(?:const|let)\s+\w*(?:STEP|COLLAPSE_FRACTION)\w*\s*=/);
    expect(src).not.toMatch(/\b(?:16|80)\b/);
  });
});
