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
 * The notice and status bar are read for any checksum wording after each drop. Since BG-01M7RG7D the
 * notice carries the first read's checksum mismatch, so a reader taking a filled blank id for an
 * edit would fail it; the Rust test blank_ids_do_not_trigger_a_checksum_mismatch pins that rule too.
 *
 * BG-01M7RG7D AC1: a session whose bytes were edited after saving says so when it is dropped, by
 * the gzip and the PKZIP route alike. Wrong implementations, and the check that catches each:
 * - the restore sentence carries only the re-read's warning: the re-read hashes the envelope it was
 *   just handed and verifies, so a tampered drop shows no 'Checksum mismatch';
 * - the sentence takes any first-read warning: the untampered drop of each route must name none;
 * - the fix on one route only: a tampered gzip and a tampered PKZIP session are each dropped;
 * - a gzip branch keyed on `.mbc` / `.mbc.gz` only: a gzip `.mcb` is dropped and must open;
 * - a magic check on the first byte only: `1f 00` must not read as gzip.
 */

import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import {
  createZipArchiveBytes,
  extractZipArchiveEntries,
  isMbcGzipBytes,
  serializeMbcFolderZip,
  serializeMbcWorkbench,
  type MbcWorkbenchSnapshot,
} from '../core/mbcSessionFormat';
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

const FIRST_SEQUENCE = 'ATGAAACCCGGGTTTTAAGGATCCGAATTC';
/** The first document's sequence with one base changed, as an edit made after saving would. */
const EDITED_SEQUENCE = 'ATGAAACCCGGGTTTTAAGGATCCGAATTA';

/** A two-document session; the second document is saved with a blank id and name. */
function sessionSnapshot(sessionName: string, firstName: string): MbcWorkbenchSnapshot {
  return {
    sessionName,
    documents: [
      doc('gz-first', firstName, FIRST_SEQUENCE),
      doc('', '', 'GGGCCCAAATTTCCCGGGAAATTTGGG'),
    ],
    workspace: { activeDocId: 'gz-first' },
  } as unknown as MbcWorkbenchSnapshot;
}

const FEATURES_UNREADABLE = 'The saved Features track setting could not be read; features are shown.';

/**
 * The saved session text, with one base of the first document edited after saving when `tampered`,
 * and its Features track setting saved unreadable when `unreadable` (a first-read warning that is
 * not a checksum mismatch; the checksum covers the documents only).
 */
function sessionText(sessionName: string, firstName: string, tampered = false, unreadable = false): string {
  let text = serializeMbcWorkbench(sessionSnapshot(sessionName, firstName));
  if (unreadable) {
    const envelope = JSON.parse(text) as { workspace?: { displaySettings?: Record<string, unknown> } };
    const settings = envelope.workspace?.displaySettings;
    if (!settings) throw new Error('the fixture holds no display settings to make unreadable');
    settings.showFeatures = 'no';
    text = JSON.stringify(envelope, null, 2);
  }
  if (!tampered) return text;
  const edited = text.replace(`"${FIRST_SEQUENCE}"`, `"${EDITED_SEQUENCE}"`);
  if (edited === text) throw new Error('the fixture holds no first-document sequence to edit');
  return edited;
}

function arrayBufferBytes(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(source.length));
  bytes.set(source);
  return bytes;
}

/** The gzip bytes of the two-document session. */
function gzipSession(sessionName: string, firstName: string, tampered = false): Uint8Array<ArrayBuffer> {
  return arrayBufferBytes(gzipSync(Buffer.from(sessionText(sessionName, firstName, tampered), 'utf8')));
}

/** The PKZIP folder archive of the session, its workbench entry edited after saving when `tampered`. */
function zipSession(sessionName: string, firstName: string, tampered = false, unreadable = false): Uint8Array<ArrayBuffer> {
  const entries = extractZipArchiveEntries(serializeMbcFolderZip(sessionSnapshot(sessionName, firstName)));
  const workbench = entries.filter((e) => e.path.endsWith('/workbench.mbc.json'));
  if (workbench.length !== 1) throw new Error('the archive holds no single workbench entry');
  workbench[0].data = new TextEncoder().encode(sessionText(sessionName, firstName, tampered, unreadable));
  return arrayBufferBytes(createZipArchiveBytes(entries));
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

describe('a session edited after saving says so when it is dropped (BG-01M7RG7D AC1)', () => {
  it('BG-01M7RG7D AC1: a tampered gzip or PKZIP session shows the checksum mismatch, an untampered one none, and a gzip .mcb opens', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [EARLIER], activeDocId: EARLIER.id, viewerTab: 'sequence-view' });
      const cases = [
        ['study.mbc.gz', 'Gz_Plain', 'pGz_Plain', gzipSession('Gz_Plain', 'pGz_Plain'), false],
        ['study.mbc.gz', 'Gz_Edited', 'pGz_Edited', gzipSession('Gz_Edited', 'pGz_Edited', true), true],
        ['archive.mcb', 'Gz_Mcb', 'pGz_Mcb', gzipSession('Gz_Mcb', 'pGz_Mcb'), false],
        ['archive.mcb', 'Gz_Mcb_Edited', 'pGz_Mcb_Edited', gzipSession('Gz_Mcb_Edited', 'pGz_Mcb_Edited', true), true],
        ['folder.mcb', 'Zip_Plain', 'pZip_Plain', zipSession('Zip_Plain', 'pZip_Plain'), false],
        ['folder.mbc', 'Zip_Edited', 'pZip_Edited', zipSession('Zip_Edited', 'pZip_Edited', true), true],
        ['folder.zip', 'Zip_Track', 'pZip_Track', zipSession('Zip_Track', 'pZip_Track', false, true), false, true],
        ['folder.zip', 'Zip_Track_Edited', 'pZip_Track_Edited', zipSession('Zip_Track_Edited', 'pZip_Track_Edited', true, true), true, true],
      ] as const;
      for (const [fileName, sessionName, firstName, bytes, tampered, unreadable = false] of cases) {
        const label = `${fileName} (${sessionName})`;
        await drop(app, new File([bytes], fileName));

        const shown = notice(app);
        expect(shown, label).toContain(`Restored workbench "${sessionName}.mbc" — 2 documents`);
        expect(docCount(app), `${label} opens both documents`).toBe(2);
        expect(words(app.one('.mbc-workbench', 'workbench root').textContent), label).toContain(firstName);
        if (tampered) {
          expect(shown, `${label}: edited after saving`).toMatch(/— 2 documents \([\d,]+ bp\) \(Checksum mismatch/);
          expect(shown.match(/Checksum mismatch/g), `${label}: named once`).toHaveLength(1);
        } else {
          expect(shown, `${label}: unedited`).not.toMatch(/checksum/i);
          expect(statusBar(app), `${label}: unedited`).not.toMatch(/checksum/i);
        }
        // Only a checksum mismatch is carried in the sentence; an unreadable track setting is named
        // once, after it, as before (US-01M7DV8W).
        expect(shown, `${label}: the sentence carries no track-setting warning`).not.toMatch(/bp\) \(The saved/);
        expect(shown.split(FEATURES_UNREADABLE).length - 1, `${label}: the track warning`).toBe(unreadable ? 1 : 0);
      }
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7RG7D AC1: a file starting 1f but not 8b is not taken as gzip', () => {
    expect(isMbcGzipBytes(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);
    expect(isMbcGzipBytes(new Uint8Array([0x1f, 0x00, 0x08, 0x00]))).toBe(false);
    expect(isMbcGzipBytes(new Uint8Array([0x00, 0x8b, 0x08, 0x00]))).toBe(false);
    expect(isMbcGzipBytes(new Uint8Array([0x1f]))).toBe(false);
    expect(isMbcGzipBytes(new Uint8Array([0x1f, 0x00, 0x08, 0x00]).buffer)).toBe(false);
  });
});
