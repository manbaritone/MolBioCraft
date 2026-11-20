// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6W06S: the status bar's notice text ellipsises when it is longer than the bar (App.css keeps
 * `.statusbar-toast-text` on one line with `text-overflow: ellipsis`), so the span carries the whole
 * notice as its `title`, and a long import refusal is readable on hover.
 *
 * Each check runs in the real App over the live DOM (the appHarness launch) and drops a refused
 * `.dna` file on the workbench, whose refusal notice is longer than the bar holds. The status bar
 * draws its notice in one of two branches, one for a session and one with no session, each with its
 * own `.statusbar-toast-text` span. Wrong implementations, and the check that catches each:
 * - a title on one branch's span only: AC1 reads the session branch and AC2 the no-session branch,
 *   and each first proves which branch it is reading (the "Session: ... docs" label shown or absent);
 * - a title on the role=status pill rather than on the text span: both read the span's own attribute;
 * - a title that is not the whole notice (a fixed word, a cut-down text): both require the title to
 *   equal the span's text and to hold the whole refusal sentence, its export hint included;
 * - the text moved out of the pill: both require the role=status pill to still hold the full text.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const ONLY: SequenceDocument = {
  id: 'w06s-only', name: 'pW06S_Only', accession: '', description: 'The one document the session holds',
  sequence: 'ATGGCCAAATTTGGGCCCTAAACGTACGTACGTACGT', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', features: [], primers: [],
  history: [{ id: 'h-w06s-1', timestamp: '2026-11-20 09:00', operation: 'Imported GenBank', description: 'Imported', parentIds: [], lengthBp: 37, topology: 'linear' }],
};

/** The whole notice the App writes for a dropped `.dna` file: the drop route's prefix, then the refusal hint. */
const REFUSAL = 'Drop import error: "x.dna" cannot be opened: MolBioCraft does not read this file type. '
  + 'Export the sequence as GenBank (.gb), EMBL or FASTA and open that file.';

async function drop(app: AppHarness, file: File): Promise<void> {
  const React = await import('react');
  const root = app.one('.mbc-workbench', 'workbench root');
  const dataTransfer = { files: [file], types: ['Files'], items: [], dropEffect: 'copy', effectAllowed: 'all' };
  await React.act(async () => { dispatchLiveEvent(root, 'drop', { dataTransfer }); });
  await app.settle();
}

function hasSessionLabel(app: AppHarness): boolean {
  return app.all('.mbc-statusbar span').some((s) => /^Session: .*\(\d+ docs\)$/.test(words(s.textContent)));
}

/** The one notice span: its title equals its text, which is the whole refusal, and the pill holds it. */
function expectWholeNoticeAsTitle(app: AppHarness): void {
  const span = app.one('.statusbar-toast-text', 'status-bar notice text');
  const text = words(span.textContent);
  expect(text, 'the notice text is the whole refusal').toBe(REFUSAL);
  expect(span.getAttribute('title'), 'the notice span carries its whole text as its title').toBe(span.textContent);
  expect(words(span.getAttribute('title')), 'the title is the whole refusal').toBe(REFUSAL);
  const pill = app.one('.statusbar-toast-pill[role="status"]', 'status-bar notice pill');
  expect(words(pill.textContent), 'the role=status pill still holds the full text').toContain(REFUSAL);
}

describe('status-bar notice tooltip (BG-01M6W06S)', () => {
  it('BG-01M6W06S AC1 in a session the status-bar notice carries its whole text as a tooltip', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [ONLY], activeDocId: ONLY.id, viewerTab: 'sequence-view' });
      expect(hasSessionLabel(app), 'the session branch of the status bar is shown').toBe(true);
      await drop(app, new File([new Uint8Array(0)], 'x.dna'));
      expect(hasSessionLabel(app), 'the refusal leaves the session branch shown').toBe(true);
      expectWholeNoticeAsTitle(app);
    } finally {
      app.unmount();
    }
  });

  it('BG-01M6W06S AC2 with no session the status-bar notice carries its whole text as a tooltip', async () => {
    const app = await mountApp();
    try {
      expect(hasSessionLabel(app), 'no session: the no-session branch of the status bar is shown').toBe(false);
      await drop(app, new File([new Uint8Array(0)], 'x.dna'));
      expect(hasSessionLabel(app), 'the refusal opens no session').toBe(false);
      expectWholeNoticeAsTitle(app);
    } finally {
      app.unmount();
    }
  });
});
