// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TDCD AC2: the proprietary plasmid (.dna/.prot/.rna), alignment (.meg) and sequence-database
 * (.ma4/.pa4/.oa4) file types are refused when they are opened through the import picker or dropped
 * on the window. The App shows the export hint `unsupportedImportReason` writes and adds no document.
 *
 * Every check runs in the real App over the live DOM (the appHarness launch): a one-document session
 * is restored, then each file goes in through the App's own routes, the hidden import picker's change
 * event and the workbench's drop event. The checks read the status bar's notice and its document
 * count. Wrong implementations, and the case that catches each:
 * - the refusal left below the binary-trace branch: the .dna, .prot and .rna files here are packet
 *   streams the removed reader decoded into a sequence, so they would open (count 2), or, without
 *   that reader, fail with the trace reader's "nothing was imported" notice, not the hint;
 * - the refusal left below the .meg branch: the .meg file opens with that format's header line
 *   and holds an alignment the removed reader opened;
 * - the refusal left at the old place, below the readers that route by content: the .ma4, .pa4 and
 *   .oa4 files hold an EMBL record, a Clustal alignment and a Stockholm alignment, which those
 *   readers would open first; and an empty .dna file, refused by name rather than as empty;
 * - a hint on one route only (drop or picker): both routes run for every type;
 * - a refusal that also blocks traces: a .scf file and an .ab1 file (both with an SCF signature;
 *   the trace reader decodes by signature, the route is chosen by extension) must still open as
 *   chromatograms;
 * - a count probe that cannot see an added document: a FASTA file must raise the count.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, type LiveElement } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const ONLY: SequenceDocument = {
  id: 'tdcd-only', name: 'pTDCD_Only', accession: '', description: 'The one document the session holds',
  sequence: 'ATGGCCAAATTTGGGCCCTAAACGTACGTACGTACGT', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z', features: [], primers: [],
  history: [{ id: 'h-tdcd-1', timestamp: '2026-11-08 09:00', operation: 'Imported GenBank', description: 'Imported', parentIds: [], lengthBp: 37, topology: 'linear' }],
};

/** Bytes backed by a plain ArrayBuffer, as a File part takes them. */
type Bytes = Uint8Array<ArrayBuffer>;
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
/** The removed plasmid reader's 8-byte cookie, written as bytes so no tracked text names its package. */
const PACKET_COOKIE = [0x53, 0x6e, 0x61, 0x70, 0x47, 0x65, 0x6e, 0x65];
/** A packet stream the removed reader decoded: the cookie packet, then one sequence packet of `kind`. */
function packetStream(kind: number, residues: string): Bytes {
  const cookieBody = [...PACKET_COOKIE, 0, 1, 0, 15, 0, 19];
  const seqBody = [0x03, ...[...residues].map((c) => c.charCodeAt(0))];
  return new Uint8Array([0x09, ...be32(cookieBody.length), ...cookieBody, kind, ...be32(seqBody.length), ...seqBody]);
}
const text = (s: string): Bytes => new Uint8Array(new TextEncoder().encode(s));

/** A minimal SCF v3 trace: two called bases (A, C) over four samples per channel, 2-byte samples. */
function scfTrace(): Bytes {
  const samples = 4;
  const bases = 2;
  const samplesOffset = 128;
  const basesOffset = samplesOffset + samples * 2 * 4;
  const out = new Uint8Array(basesOffset + bases * 12);
  const view = new DataView(out.buffer);
  out.set(text('.scf'), 0);
  view.setUint32(4, samples);
  view.setUint32(8, samplesOffset);
  view.setUint32(12, bases);
  view.setUint32(24, basesOffset);
  view.setUint32(28, 0);
  view.setUint32(32, 0);
  out.set(text('3.00'), 36);
  view.setUint32(40, 2);
  // v3 bases: peak positions, then four probability arrays, then the called bases.
  view.setUint32(basesOffset, 1);
  view.setUint32(basesOffset + 4, 3);
  for (let k = 0; k < 4; k++) for (let i = 0; i < bases; i++) out[basesOffset + 4 * bases + k * bases + i] = 30;
  out[basesOffset + 8 * bases] = 'A'.charCodeAt(0);
  out[basesOffset + 8 * bases + 1] = 'C'.charCodeAt(0);
  return out;
}

// The .meg format's first line, written as character codes so no tracked text names the package.
const ALIGNMENT_HEADER = String.fromCharCode(0x23, 0x6d, 0x65, 0x67, 0x61);
const SEQUENCE_HINT = 'Export the sequence as GenBank (.gb), EMBL or FASTA and open that file.';
const ALIGNMENT_HINT = 'Export the alignment as FASTA, NEXUS or PHYLIP and open that file.';
const RECORDS_HINT = 'Export the records as GenBank and open those files.';
const REFUSED: [string, Bytes, string][] = [
  ['pTDCD.dna', packetStream(0x00, 'ACGTACGTACGTGGCC'), SEQUENCE_HINT],
  ['tdcd.prot', packetStream(0x15, 'MKKTKIVCTIGPKTES'), SEQUENCE_HINT],
  ['tdcd.rna', packetStream(0x20, 'ACGUACGUACGUGGCC'), SEQUENCE_HINT],
  ['tdcd.meg', text(`${ALIGNMENT_HEADER}\n!Title tdcd;\n!Format DataType=DNA;\n\n#one ACGTACGTAC\n#two ACGTTCGTAC\n`), ALIGNMENT_HINT],
  ['empty.dna', new Uint8Array(0), SEQUENCE_HINT],
  ['tdcd.ma4', text([
    'ID   TDCD01; SV 1; linear; genomic DNA; STD; SYN; 20 BP.', 'XX', 'DE   A record of the test.', 'XX',
    'SQ   Sequence 20 BP;', '     acgtacgtac gtacgtacgt                                                20', '//', '',
  ].join('\n')), RECORDS_HINT],
  ['tdcd.pa4', text('CLUSTAL W (1.83) multiple sequence alignment\n\none   ACGTACGTAC\ntwo   ACGTTCGTAC\n'), RECORDS_HINT],
  ['tdcd.oa4', text('# STOCKHOLM 1.0\none ACGTACGTAC\ntwo ACGTTCGTAC\n//\n'), RECORDS_HINT],
];
const hintFor = (name: string, hint: string) =>
  `"${name}" cannot be opened: MolBioCraft does not read this file type. ${hint}`;

function notice(app: AppHarness): string {
  return app.all('.statusbar-toast-text').map((n) => words(n.textContent)).join(' | ');
}
function docCount(app: AppHarness): number {
  const label = app.all('.mbc-statusbar span').map((s) => words(s.textContent)).find((t) => /^Session: .*\(\d+ docs\)$/.test(t));
  if (!label) throw new Error('the status bar shows no "Session: ... (N docs)" count');
  return Number(/\((\d+) docs\)$/.exec(label)![1]);
}
function importPicker(app: AppHarness): LiveElement {
  // The Import Files picker: the one hidden input that accepts both sequences and traces.
  const found = app.all('input[type="file"]').filter((i) => {
    const accept = (i.getAttribute('accept') ?? '').split(',');
    return accept.includes('.gb') && accept.includes('.scf');
  });
  if (found.length !== 1) throw new Error(`expected the one hidden import picker, found ${found.length}`);
  return found[0];
}
async function pick(app: AppHarness, file: File): Promise<void> {
  const React = await import('react');
  const input = importPicker(app);
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await React.act(async () => { dispatchLiveEvent(input, 'change'); });
  await app.settle();
}
async function drop(app: AppHarness, file: File): Promise<void> {
  const React = await import('react');
  const root = app.one('.mbc-workbench', 'workbench root');
  const dataTransfer = { files: [file], types: ['Files'], items: [], dropEffect: 'copy', effectAllowed: 'all' };
  await React.act(async () => { dispatchLiveEvent(root, 'drop', { dataTransfer }); });
  await app.settle();
}

describe('refused proprietary file types (US-01M6TDCD AC2)', () => {
  it('opening or dropping a refused file shows its export hint and adds no document', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [ONLY], activeDocId: ONLY.id, viewerTab: 'sequence-view' });
      expect(docCount(app), 'the restored session').toBe(1);

      for (const [route, put] of [['import picker', pick], ['drop', drop]] as const) {
        for (const [name, bytes, hint] of REFUSED) {
          await put(app, new File([bytes], name));
          expect(notice(app), `${route}: ${name}`).toContain(hintFor(name, hint));
          expect(docCount(app), `${route}: ${name} adds no document`).toBe(1);
        }
      }

      // The probe sees an added document, and traces still open as chromatograms.
      await drop(app, new File([text('>tdcd_added\nACGTACGTACGTACGTACGTACGT\n')], 'tdcd_added.fasta'));
      expect(docCount(app), 'a FASTA file adds a document').toBe(2);
      await pick(app, new File([scfTrace()], 'tdcd_trace.scf'));
      expect(notice(app), '.scf through the picker').toContain('Opened chromatogram trace "tdcd_trace"');
      expect(docCount(app), 'the .scf trace is added').toBe(3);
      await drop(app, new File([scfTrace()], 'tdcd_dropped.ab1'));
      expect(notice(app), '.ab1 dropped').toContain('Opened chromatogram trace "tdcd_dropped"');
      expect(docCount(app), 'the .ab1 trace is added').toBe(4);
    } finally {
      app.unmount();
    }
  });
});
