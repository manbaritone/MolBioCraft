// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6P2S4 AC4: a gzip-compressed session (`.mbc` holding the bytes `1f 8b`, or `.mbc.gz`)
 * dropped on the mounted App opens every document it holds, through the Rust bytes reader, and the
 * status bar names no checksum mismatch.
 *
 * Wrong implementations, and the check that catches each:
 * - no gzip branch: the file is read as text, the compressed bytes reach the JSON reader and the
 *   drop fails with "JSON syntax error", so no session is restored and the count stays at 1;
 * - a branch keyed on `.mbc` / `.mcb` only: the `.mbc.gz` drop fails the same way;
 * - a branch that opens only the first document: the count and both document names are read
 *   after each drop, and the earlier session's document must be gone.
 *
 * The notice and status bar are read for any checksum wording after each drop. That does not
 * catch the reader reading a filled blank id as an edit: the branch hands the parsed envelope on,
 * as the PKZIP branch does, and its re-read verifies, so the first read's mismatch never reaches
 * the notice. The Rust test blank_ids_do_not_trigger_a_checksum_mismatch pins that rule.
 */

import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { serializeMbcWorkbench, type MbcWorkbenchSnapshot } from '../core/mbcSessionFormat';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const doc = (id: string, name: string, sequence: string): SequenceDocument => ({
  id, name, accession: '', description: '', sequence, moleculeType: 'DNA', topology: 'circular',
  folder: 'Local', createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z',
  features: [], primers: [], history: [],
});

const EARLIER = doc('gz-earlier', 'pEarlier_Only', 'ATGGCCAAATTTGGGCCCTAAACGTACGTACGT');

/** The gzip bytes of a two-document session; the second document is saved with a blank id and name. */
function gzipSession(sessionName: string, firstName: string): Uint8Array<ArrayBuffer> {
  const snapshot = {
    sessionName,
    documents: [
      doc('gz-first', firstName, 'ATGAAACCCGGGTTTTAAGGATCCGAATTC'),
      doc('', '', 'GGGCCCAAATTTCCCGGGAAATTTGGG'),
    ],
    workspace: { activeDocId: 'gz-first' },
  } as unknown as MbcWorkbenchSnapshot;
  const gz = gzipSync(Buffer.from(serializeMbcWorkbench(snapshot), 'utf8'));
  const bytes = new Uint8Array(new ArrayBuffer(gz.length));
  bytes.set(gz);
  return bytes;
}

function notice(app: AppHarness): string {
  return app.all('.statusbar-toast-text').map((n) => words(n.textContent)).join(' | ');
}
function statusBar(app: AppHarness): string {
  return app.all('.mbc-statusbar').map((n) => words(n.textContent)).join(' | ');
}
function docCount(app: AppHarness): number {
  const label = app.all('.mbc-statusbar span').map((s) => words(s.textContent)).find((t) => /^Session: .*\(\d+ docs\)$/.test(t));
  if (!label) throw new Error('the status bar shows no "Session: ... (N docs)" count');
  return Number(/\((\d+) docs\)$/.exec(label)![1]);
}
async function drop(app: AppHarness, file: File): Promise<void> {
  const React = await import('react');
  const root = app.one('.mbc-workbench', 'workbench root');
  const dataTransfer = { files: [file], types: ['Files'], items: [], dropEffect: 'copy', effectAllowed: 'all' };
  await React.act(async () => { dispatchLiveEvent(root, 'drop', { dataTransfer }); });
  await app.settle();
}

describe('gzip sessions open in the app (US-01M6P2S4 AC4)', () => {
  it('US-01M6P2S4 AC4: dropping a gzip session.mbc or .mbc.gz opens both documents with no checksum mismatch', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [EARLIER], activeDocId: EARLIER.id, viewerTab: 'sequence-view' });
      expect(docCount(app), 'the earlier session').toBe(1);

      for (const [fileName, sessionName, firstName] of [
        ['session.mbc', 'Gz_Session', 'pGz_Alpha'],
        ['study.mbc.gz', 'Gz_Study', 'pGz_Beta'],
      ] as const) {
        const bytes = gzipSession(sessionName, firstName);
        expect([bytes[0], bytes[1]], `${fileName} holds gzip bytes`).toEqual([0x1f, 0x8b]);
        await drop(app, new File([bytes], fileName));

        const shown = notice(app);
        expect(shown, fileName).toContain(`Restored workbench "${sessionName}.mbc" — 2 documents`);
        expect(shown, `${fileName}: no checksum warning`).not.toMatch(/checksum/i);
        expect(statusBar(app), `${fileName}: no checksum warning`).not.toMatch(/checksum/i);
        expect(docCount(app), `${fileName} opens both documents`).toBe(2);
        const text = words(app.one('.mbc-workbench', 'workbench root').textContent);
        expect(text, `${fileName}: the first document`).toContain(firstName);
        expect(text, `${fileName}: the blank-named document`).toContain('Sequence_2');
        expect(text, `${fileName}: the earlier session is replaced`).not.toContain(EARLIER.name);
      }
    } finally {
      app.unmount();
    }
  });
});
