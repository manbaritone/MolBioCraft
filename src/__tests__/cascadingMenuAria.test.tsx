// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6Q4V1 AC1: a menu row's aria-describedby always names a present, non-hidden element. A
 * submenu row describes itself by its Function Info tooltip while its submenu is closed; once the
 * submenu is open the tooltip is not drawn, so the row must stop naming it, or a screen reader reads
 * nothing (or stale text) for the row.
 *
 * The check runs in the real App over the live DOM (appHarness): the in-window menu bar of a Linux
 * host, the Tools menu, and each submenu row of it. The live DOM's focus() fires no focus events, so
 * the test sends the focusin a browser sends where focus moves to a row.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, type LiveElement } from './liveDom';

vi.setConfig({ testTimeout: 180_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const rowLabel = (b: LiveElement) => words(b.querySelectorAll('.desktop-menu-label')[0]?.textContent ?? b.textContent);
const POINTER = { pointerId: 1, pointerType: 'mouse', isPrimary: true };

async function hover(app: AppHarness, row: LiveElement) {
  await React.act(async () => { dispatchLiveEvent(row, 'pointerover', POINTER); });
  await app.settle();
}
/** Focus arriving at `row` as a browser reports it (keyboard or pointer). */
async function focusRow(app: AppHarness, row: LiveElement) {
  await React.act(async () => {
    row.focus();
    dispatchLiveEvent(row, 'focusin', {});
  });
  await app.settle();
}

/** Whether `el` or an ancestor is out of the accessibility tree or not drawn. */
function hiddenBy(el: LiveElement): string | null {
  for (let n: LiveElement | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden')) return 'the hidden attribute';
    if (n.getAttribute('aria-hidden') === 'true') return 'aria-hidden="true"';
    const style = n.style as unknown as Record<string, unknown>;
    if (style.display === 'none') return 'display: none';
    if (style.visibility === 'hidden') return 'visibility: hidden';
  }
  return null;
}

/** Every menu row whose aria-describedby names an id that is absent or hidden, as "row -> why". */
function danglingDescriptions(app: AppHarness): string[] {
  const out: string[] = [];
  for (const row of app.all('.desktop-menu-row')) {
    const ids = words(row.getAttribute('aria-describedby')).split(' ').filter(Boolean);
    for (const id of ids) {
      const target = app.doc.getElementById(id);
      if (!target) out.push(`${rowLabel(row)} -> #${id} is not in the page`);
      else {
        const why = hiddenBy(target);
        if (why) out.push(`${rowLabel(row)} -> #${id} is hidden by ${why}`);
        else if (!words(target.textContent)) out.push(`${rowLabel(row)} -> #${id} is empty`);
      }
    }
  }
  return out;
}

describe('BG-01M6Q4V1: menu row descriptions', () => {
  it("aria-describedby always names a visible description, before and while a Tools submenu row's submenu is open", async () => {
    const app = await mountApp();
    try {
      await app.settle();
      const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => words(b.getAttribute('aria-label') ?? b.textContent) === 'Tools');
      if (!trigger) throw new Error('the menu bar has no Tools menu');
      await app.click(trigger);
      const topRows = () => app.all('.desktop-menu-popup')[0].querySelectorAll('button.submenu-trigger');
      const labels = topRows().filter((b) => !b.hasAttribute('disabled')).map(rowLabel);
      expect(labels.length, 'Tools holds enabled submenu rows').toBeGreaterThan(0);

      for (const label of labels) {
        const row = () => topRows().find((b) => rowLabel(b) === label)!;

        // Closed, focused: the row names its tooltip, and the tooltip is there (not vacuous).
        await focusRow(app, row());
        expect(row().getAttribute('aria-expanded'), `${label} is closed`).toBe('false');
        expect(row().getAttribute('aria-describedby'), `${label} names its Function Info while closed`).toBeTruthy();
        expect(danglingDescriptions(app), `${label}, closed and focused`).toEqual([]);

        // Hovered: the submenu opens.
        await hover(app, row());
        expect(row().getAttribute('aria-expanded'), `${label} opened on hover`).toBe('true');
        expect(danglingDescriptions(app), `${label}, open after hover`).toEqual([]);

        // Pointer into the submenu's first row, then back onto the open row (focus follows the pointer).
        const childRows = app.all('.desktop-submenu-popup').flatMap((p) => p.querySelectorAll('button'));
        if (!childRows.length) throw new Error(`${label} opened no submenu rows: ${app.all('.desktop-menu-popup').length} popups`);
        const child = childRows.find((b) => !b.hasAttribute('disabled')) ?? childRows[0];
        await hover(app, child);
        await focusRow(app, child);
        await hover(app, row());
        await focusRow(app, row());
        expect(row().getAttribute('aria-expanded'), `${label} is still open`).toBe('true');
        expect(danglingDescriptions(app), `${label}, open and focused again`).toEqual([]);

        await app.press('Escape');
        if (!app.all('.desktop-menu-popup').length) await app.click(trigger);
      }
    } finally {
      app.unmount();
    }
  });
});
