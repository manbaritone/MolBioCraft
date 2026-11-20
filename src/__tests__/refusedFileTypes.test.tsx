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

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { createZipArchiveBytes, extractZipArchiveEntries, serializeMbcFolderZip, type MbcWorkbenchSnapshot } from '../core/mbcSessionFormat';
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

/**
 * BG-01M6W00X: an .xml file and a ZIP that is not a MolBioCraft archive are refused naming what they
 * are, on both routes; a real MolBioCraft folder archive saved as .zip still opens.
 *
 * Wrong implementations, and the case that catches each:
 * - .xml left to the raw-sequence check: contig_summary.xml would fail as "not a sequence symbol",
 *   and bases.xml (only ACGT letters) would open as a sequence, so both must carry the type hint;
 * - a refusal on one route only: every case runs through the picker and the drop;
 * - the foreign ZIP still sent to the archive reader's old sentence, or refused only when it holds
 *   no .json at all: the fixture holds readme.txt, seq.gb and a JSON file that is no MolBioCraft
 *   document, and must be named as a ZIP archive with the unzip hint;
 * - every .zip refused, or one without a workbench entry refused: a serializeMbcFolderZip archive,
 *   and the same archive with its workbench entry taken out (documents only), still open.
 */
const XML_HINT = 'Export the sequence as GenBank (.gb), EMBL or FASTA and open that file.';
const zipNotArchive = (name: string) =>
  `"${name}" is a ZIP archive, not a MolBioCraft archive: it holds no MolBioCraft session or document. Unzip it and open the files inside.`;
const asBytes = (u: Uint8Array): Bytes => { const b = new Uint8Array(new ArrayBuffer(u.length)); b.set(u); return b; };
const archiveDoc = (id: string, name: string, sequence: string): SequenceDocument => ({
  ...ONLY, id, name, sequence, history: [], description: '',
});
function folderArchive(sessionName: string, names: string[]): Bytes {
  const snapshot = {
    sessionName,
    documents: names.map((n, i) => archiveDoc(`w00x-${n}`, n, `ATGGCCAAATTTGGGCCC${'ACGT'.repeat(i + 1)}`)),
    workspace: { activeDocId: `w00x-${names[0]}` },
  } as unknown as MbcWorkbenchSnapshot;
  return asBytes(serializeMbcFolderZip(snapshot));
}

const unreadableCompressed = (name: string, hint: string) =>
  `"${name}" is a MolBioCraft archive that MolBioCraft cannot read: its entries are stored compressed. ${hint}`;
const COMPRESSED_WITH_WORKBENCH = 'Unzip it and open the workbench.mbc.json inside, or save the archive again from MolBioCraft.';
const COMPRESSED_DOCUMENTS_ONLY = 'Save the archive again from MolBioCraft.';
const unreadableCutShort = (name: string) =>
  `"${name}" is a MolBioCraft archive that MolBioCraft cannot read: it is cut short (the file is incomplete or damaged). Open the original file, or save the archive again from MolBioCraft.`;
const foreignCutShort = (name: string) =>
  `"${name}" is a ZIP archive that is cut short (the file is incomplete or damaged), and the part that remains holds no MolBioCraft session or document. Open the original file.`;

/** CRC-32 (IEEE), as a ZIP header carries it. */
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A ZIP whose entries are deflated (method 8), as `zip -9` or Finder's Compress write them; with
 * `descriptor`, each local header leaves its sizes 0 and a data descriptor follows the data (bit 3),
 * as a streamed ZIP does (`zip - ... | cat`, Java ZipOutputStream, Go archive/zip); with 'sized', the
 * header carries the sizes and the descriptor still follows, as Info-ZIP writes a stored entry to a
 * pipe. `method` 0 stores the entries instead; `signed` false leaves out the descriptor's optional
 * PK 07 08 signature. A central directory and end record close it.
 */
function deflatedZip(entries: { path: string; data: Uint8Array }[], descriptor: boolean | 'sized' = false, method: 0 | 8 = 8, signed = true): Bytes {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  for (const e of entries) {
    const name = [...enc.encode(e.path)];
    const packed = method === 8 ? [...deflateRawSync(e.data, { level: 9 })] : [...e.data];
    const crc = crc32(e.data);
    const offset = parts.length;
    const flags = 0x0800 | (descriptor ? 0x0008 : 0);
    const sizes = descriptor === true ? [...u32(0), ...u32(0), ...u32(0)] : [...u32(crc), ...u32(packed.length), ...u32(e.data.length)];
    parts.push(0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0), ...sizes, ...u16(name.length), ...u16(0), ...name, ...packed);
    if (descriptor) parts.push(...(signed ? [0x50, 0x4b, 0x07, 0x08] : []), ...u32(crc), ...u32(packed.length), ...u32(e.data.length));
    central.push(0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(packed.length), ...u32(e.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset), ...name);
  }
  const cdOffset = parts.length;
  parts.push(...central, 0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(cdOffset), ...u16(0));
  return new Uint8Array(parts);
}

describe('xml files and foreign ZIP archives (BG-01M6W00X)', () => {
  it('BG-01M6W00X AC1 an xml file is refused by its type with an export hint on both routes, never as a sequence symbol', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [ONLY], activeDocId: ONLY.id, viewerTab: 'sequence-view' });
      const cases: [string, Bytes][] = [
        ['contig_summary.xml', text('<?xml version="1.0" encoding="UTF-8"?>\n<ContigSummary name="c1"><Read id="r1"/></ContigSummary>\n')],
        ['bases.xml', text('ACGTACGTACGTACGTACGT\n')],
      ];
      for (const [route, put] of [['import picker', pick], ['drop', drop]] as const) {
        for (const [name, bytes] of cases) {
          await put(app, new File([bytes], name));
          const shown = notice(app);
          expect(shown, `${route}: ${name}`).toContain(hintFor(name, XML_HINT));
          expect(shown, `${route}: ${name}`).not.toContain('not a sequence symbol');
          expect(docCount(app), `${route}: ${name} adds no document`).toBe(1);
        }
      }
    } finally {
      app.unmount();
    }
  });

  it('BG-01M6W00X AC2 a zip that is not a MolBioCraft archive is refused as a zip archive with an unzip hint on both routes', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [ONLY], activeDocId: ONLY.id, viewerTab: 'sequence-view' });
      const enc = new TextEncoder();
      const foreign = asBytes(createZipArchiveBytes([
        { path: 'sampleDocuments/readme.txt', data: enc.encode('Sample documents for a course.\n') },
        { path: 'sampleDocuments/seq.gb', data: enc.encode('LOCUS       seq 12 bp DNA linear\nORIGIN\n        1 acgtacgtac gt\n//\n') },
        { path: 'sampleDocuments/settings.json', data: enc.encode('{"theme":"dark","items":[1,2]}') },
      ]));
      expect(extractZipArchiveEntries(foreign).map((e) => e.path), 'the fixture is a readable ZIP').toHaveLength(3);
      for (const [route, put] of [['import picker', pick], ['drop', drop]] as const) {
        const name = route === 'drop' ? 'sampleDocuments.zip' : 'course files.zip';
        await put(app, new File([foreign], name));
        const shown = notice(app);
        expect(shown, `${route}: ${name}`).toContain(zipNotArchive(name));
        expect(shown, `${route}: ${name}`).not.toContain('did not contain any valid JSON');
        expect(docCount(app), `${route}: ${name} adds no document`).toBe(1);
      }

      // Round 2 (D0274, LC-006): a MolBioCraft archive the reader cannot read is never called "not a
      // MolBioCraft archive". Wrong implementations: compressed or cut-short entries dropped
      // unseen (the round-1 sentence for both probes); every compressed ZIP called a MolBioCraft
      // archive (the deflated foreign ZIPs must keep the not-an-archive sentence); the unzip hint
      // given for a cut-short file (unzipping it does not help) or for an archive with no
      // workbench entry to open (the documents-only probe); a stored but unreadable MolBioCraft
      // entry called compressed (the broken probe).
      const real = serializeMbcFolderZip({
        sessionName: 'W00X_Probe',
        documents: [archiveDoc('w00x-probe', 'pW00X_Probe', 'ATGGCCAAATTTGGGCCCACGTACGT')],
        workspace: { activeDocId: 'w00x-probe' },
      } as unknown as MbcWorkbenchSnapshot);
      const realEntries = extractZipArchiveEntries(real);
      expect(realEntries[0].path, 'the probe archive opens with its workbench entry').toMatch(/\/workbench\.mbc\.json$/);
      const foreignEntries = [
        { path: 'sampleDocuments/readme.txt', data: enc.encode('Sample documents for a course.\n'.repeat(20)) },
        { path: 'sampleDocuments/seq.gb', data: enc.encode('LOCUS       seq 12 bp DNA linear\nORIGIN\n        1 acgtacgtac gt\n//\n') },
      ];
      const truncated = asBytes(real.slice(0, Math.floor(real.length * 0.3)));
      // The foreign ZIP cut exactly after its first entry, before the next header and the central directory.
      const head = new DataView(foreign.buffer);
      const firstEntryEnd = 30 + head.getUint16(26, true) + head.getUint16(28, true) + head.getUint32(18, true);
      const probes: [string, Bytes, string, typeof pick][] = [
        ['rezipped.zip', deflatedZip(realEntries), unreadableCompressed('rezipped.zip', COMPRESSED_WITH_WORKBENCH), drop],
        ['streamed.zip', deflatedZip(realEntries, true), unreadableCompressed('streamed.zip', COMPRESSED_WITH_WORKBENCH), pick],
        ['documents.zip', deflatedZip(realEntries.filter((e) => !e.path.endsWith('/workbench.mbc.json'))),
          unreadableCompressed('documents.zip', COMPRESSED_DOCUMENTS_ONLY), drop],
        ['cut.zip', truncated, unreadableCutShort('cut.zip'), pick],
        ['cut.mbc', truncated, unreadableCutShort('cut.mbc'), drop],
        ['foreign-deflated.zip', deflatedZip(foreignEntries), zipNotArchive('foreign-deflated.zip'), pick],
        ['foreign-streamed.zip', deflatedZip(foreignEntries, true), zipNotArchive('foreign-streamed.zip'), drop],
        ['foreign-cut.zip', asBytes(foreign.slice(0, 60)), foreignCutShort('foreign-cut.zip'), drop],
        ['foreign-cut-at-entry.zip', asBytes(foreign.slice(0, firstEntryEnd)), foreignCutShort('foreign-cut-at-entry.zip'), pick],
        // A stored MolBioCraft-named entry that is no readable document is not called compressed.
        ['broken.zip', asBytes(createZipArchiveBytes([{ path: 'W00X/pBroken.mbc.json', data: enc.encode('{"document": ') }])),
          '"broken.zip" is a MolBioCraft archive that MolBioCraft cannot read: its MolBioCraft entries are not readable sessions or documents. Save the archive again from MolBioCraft.', pick],
      ];
      for (const [name, bytes, sentence, put] of probes) {
        await put(app, new File([bytes], name));
        const shown = notice(app);
        expect(shown, name).toContain(sentence);
        if (sentence !== zipNotArchive(name)) expect(shown, name).not.toContain('not a MolBioCraft archive');
        if (/cut/.test(name) || name === 'documents.zip' || name === 'broken.zip') expect(shown, `${name}: no unzip hint`).not.toMatch(/Unzip/);
        expect(docCount(app), `${name} adds no document`).toBe(1);
      }
    } finally {
      app.unmount();
    }
  });

  it('BG-01M6W00X AC3 a MolBioCraft folder archive saved as zip still opens its documents on both routes', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [ONLY], activeDocId: ONLY.id, viewerTab: 'sequence-view' });
      await drop(app, new File([folderArchive('W00X_Dropped', ['pW00X_A', 'pW00X_B'])], 'dropped.zip'));
      expect(notice(app), 'drop').toContain('Restored workbench "W00X_Dropped.mbc" — 2 documents');
      expect(docCount(app), 'drop opens both documents').toBe(2);
      expect(words(app.one('.mbc-workbench', 'workbench root').textContent), 'drop').toContain('pW00X_A');

      await pick(app, new File([folderArchive('W00X_Picked', ['pW00X_C', 'pW00X_D', 'pW00X_E'])], 'picked.zip'));
      expect(notice(app), 'picker').toContain('Restored workbench "W00X_Picked.mbc" — 3 documents');
      expect(docCount(app), 'the picker opens all three documents').toBe(3);
      expect(words(app.one('.mbc-workbench', 'workbench root').textContent), 'picker').toContain('pW00X_C');

      // The same archive with its workbench entry taken out: the documents alone still open.
      const docsOnly = extractZipArchiveEntries(folderArchive('W00X_Docs', ['pW00X_F', 'pW00X_G']))
        .filter((e) => !e.path.endsWith('/workbench.mbc.json'));
      expect(docsOnly.some((e) => e.path.endsWith('.mbc.json')), 'the fixture keeps document entries').toBe(true);
      await drop(app, new File([asBytes(createZipArchiveBytes(docsOnly))], 'docs_only.zip'));
      expect(docCount(app), 'a documents-only archive opens its two documents').toBe(2);
      expect(words(app.one('.mbc-workbench', 'workbench root').textContent), 'documents only').toContain('pW00X_F');
      expect(notice(app), 'documents only').not.toContain('not a MolBioCraft archive');
    } finally {
      app.unmount();
    }
  });
});

/**
 * BG-01M7VGHZ (the redelivery of BG-01M6W00X after its round-2 REJECT): a ZIP's entries are read from
 * its central directory, so a streamed archive (bit 3: sizes 0 in each local header, a data
 * descriptor after the data) whose first entry is not a MolBioCraft entry is still seen whole; an
 * archive the reader cannot read past is never said to hold nothing (LC-006); and an archive cut
 * short after some of its entries says so when it opens what it read (D0005).
 *
 * Wrong implementations, and the case that catches each:
 * - the forward scan left to stop at the first streamed entry's data (round 2): the reviewer's
 *   probe, Local/pR_A.fasta first, would be called "not a MolBioCraft archive", deflated or
 *   documents-only alike, and the stored streamed archive would not open;
 * - the central directory read but its sizes ignored (the local header's 0 used): the stored
 *   streamed archives would open no document;
 * - a streamed archive with no central directory (cut short) still said to hold nothing: the cut
 *   inside its first entry must say MolBioCraft cannot read past it, and the cut after its
 *   MolBioCraft entry's header must name it a MolBioCraft archive cut short (the scan steps over a
 *   streamed entry by its data descriptor);
 * - the cut-short note left out, or given for every archive: the documents-only and the session
 *   archive cut after some entries carry it, and the same archives whole do not.
 */
const pullAfter = (bytes: Uint8Array, from: number, sig: number[]): number => {
  for (let i = from; i + 4 <= bytes.length; i++) if (sig.every((b, k) => bytes[i + k] === b)) return i;
  throw new Error(`signature ${sig.join(',')} not found after ${from}`);
};
const LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const cannotReadPast = (name: string, entry: string) =>
  `"${name}" is a ZIP archive that is cut short (the file is incomplete or damaged), and MolBioCraft cannot read past its entry "${entry}" to tell whether it holds a MolBioCraft session or document. Open the original file.`;
const cutShortDocuments = (name: string, n: number) =>
  `"${name}" is cut short (the file is incomplete or damaged): it opened the ${n} ${n === 1 ? 'document' : 'documents'} read before the cut, and any entries after the cut were lost. Open the original file, or save the archive again from MolBioCraft.`;
const cutShortSession = (name: string) =>
  `"${name}" is cut short (the file is incomplete or damaged): its session entry was read whole, and any entries after the cut were lost. Open the original file, or save the archive again from MolBioCraft.`;

describe('streamed and cut-short ZIP archives (BG-01M7VGHZ)', () => {
  it('BG-01M7VGHZ AC1 a streamed zip whose first entry is not a MolBioCraft entry is read from its central directory', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [ONLY], activeDocId: ONLY.id, viewerTab: 'sequence-view' });
      // The reviewer's probe: a serializeMbcFolderZip archive unzipped and re-zipped to a pipe,
      // `zip -q - Local/pR_A.fasta Local/pR_A.mbc.json workbench.mbc.json | cat`.
      const unzipped = extractZipArchiveEntries(serializeMbcFolderZip({
        sessionName: 'R_Probe',
        documents: [archiveDoc('vghz-probe', 'pR_A', 'ATGGCCAAATTTGGGCCCACGTACGTTTGA')],
        workspace: { activeDocId: 'vghz-probe' },
      } as unknown as MbcWorkbenchSnapshot)).map((e) => ({ path: e.path.replace(/^[^/]+\//, ''), data: e.data }));
      const byPath = (p: string) => unzipped.find((e) => e.path === p)!;
      const fastaFirst = ['Local/pR_A.fasta', 'Local/pR_A.mbc.json', 'workbench.mbc.json'].map(byPath);
      expect(fastaFirst.every(Boolean), 'the probe holds the three entries the reviewer re-zipped').toBe(true);
      const docsFastaFirst = fastaFirst.slice(0, 2);
      const streamed = deflatedZip(fastaFirst, true);
      expect(streamed[6] & 0x08, 'the probe is streamed (bit 3)').toBe(0x08);
      expect(new DataView(streamed.buffer).getUint32(18, true), 'its first local header leaves the size 0').toBe(0);

      const refused: [string, Bytes, string, typeof pick][] = [
        ['stream_fastafirst.zip', streamed, unreadableCompressed('stream_fastafirst.zip', COMPRESSED_WITH_WORKBENCH), drop],
        ['stream_fastafirst_picked.zip', streamed, unreadableCompressed('stream_fastafirst_picked.zip', COMPRESSED_WITH_WORKBENCH), pick],
        ['stream_docs.zip', deflatedZip(docsFastaFirst, true), unreadableCompressed('stream_docs.zip', COMPRESSED_DOCUMENTS_ONLY), pick],
        // Descriptors without their optional signature: only the central directory tells where each entry ends.
        ['stream_unsigned.zip', deflatedZip(fastaFirst, true, 8, false), unreadableCompressed('stream_unsigned.zip', COMPRESSED_WITH_WORKBENCH), drop],
        // The same, header-sized and cut inside the central directory: past the first entry lie bytes
        // that are no ZIP record, so what follows is unread.
        ['stream_unsigned_cut.zip', (() => { const z = deflatedZip(docsFastaFirst, 'sized', 0, false); return asBytes(z.slice(0, pullAfter(z, 0, [0x50, 0x4b, 0x01, 0x02]) + 10)); })(),
          cannotReadPast('stream_unsigned_cut.zip', 'Local/pR_A.fasta'), pick],
        // Cut inside the first (streamed) entry: no central directory, and nothing past the entry to read.
        ['stream_cut_first.zip', asBytes(streamed.slice(0, 30 + 'Local/pR_A.fasta'.length + 4)),
          cannotReadPast('stream_cut_first.zip', 'Local/pR_A.fasta'), drop],
        // Cut just after the MolBioCraft document's local header: the scan steps over the streamed
        // .fasta by its data descriptor and sees the MolBioCraft entry.
        ['stream_cut_second.zip', asBytes(streamed.slice(0, pullAfter(streamed, 4, LOCAL_HEADER) + 30 + 'Local/pR_A.mbc.json'.length + 3)),
          unreadableCutShort('stream_cut_second.zip'), pick],
      ];
      for (const [name, bytes, sentence, put] of refused) {
        await put(app, new File([bytes], name));
        const shown = notice(app);
        expect(shown, name).toContain(sentence);
        expect(shown, name).not.toContain('not a MolBioCraft archive');
        expect(shown, `${name}: never said to hold nothing`).not.toMatch(/holds no MolBioCraft|remains holds no/);
        expect(docCount(app), `${name} adds no document`).toBe(1);
      }

      // The same streamed entries stored (method 0): the central directory's sizes read them, so it opens.
      await drop(app, new File([deflatedZip(fastaFirst, true, 0)], 'stream_stored.zip'));
      expect(notice(app), 'stored streamed session').toContain('Restored workbench "R_Probe.mbc" — 1 documents');
      expect(docCount(app), 'the stored streamed session opens its document').toBe(1);
      expect(words(app.one('.mbc-workbench', 'workbench root').textContent), 'stored streamed session').toContain('pR_A');
      expect(notice(app), 'a whole streamed archive is not cut short').not.toContain('cut short');

      await pick(app, new File([deflatedZip(docsFastaFirst, true, 0)], 'stream_stored_docs.zip'));
      expect(notice(app), 'stored streamed documents').toContain('Restored workbench "stream_stored_docs.mbc" — 1 documents');
      expect(docCount(app), 'the stored streamed documents open').toBe(1);
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7VGHZ AC2 an archive cut short after some of its entries opens what it read and says the rest was lost', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [ONLY], activeDocId: ONLY.id, viewerTab: 'sequence-view' });
      // Documents only, three documents; the cut falls inside the third document entry's data.
      const docsOnly = asBytes(createZipArchiveBytes(extractZipArchiveEntries(folderArchive('VGHZ_Docs', ['pV_A', 'pV_B', 'pV_C']))
        .filter((e) => !e.path.endsWith('/workbench.mbc.json'))));
      const thirdDoc = pullAfter(docsOnly, 0, [...new TextEncoder().encode('pV_C.mbc.json')]);
      const docsCut = asBytes(docsOnly.slice(0, thirdDoc + 40));
      await drop(app, new File([docsCut], 'docs_cut.zip'));
      expect(docCount(app), 'the two documents read before the cut open').toBe(2);
      expect(notice(app), 'documents only, cut').toContain(cutShortDocuments('docs_cut.zip', 2));

      // Cut inside the central directory's first record (past the 30 bytes a local header needs): every
      // entry was read, but with no end record the file is still incomplete.
      const inCentral = asBytes(docsOnly.slice(0, pullAfter(docsOnly, 0, [0x50, 0x4b, 0x01, 0x02]) + 40));
      await pick(app, new File([inCentral], 'docs_cut_central.zip'));
      expect(docCount(app), 'every document before the central directory opens').toBe(3);
      expect(notice(app), 'cut in the central directory').toContain(cutShortDocuments('docs_cut_central.zip', 3));

      await pick(app, new File([docsOnly], 'docs_whole.zip'));
      expect(docCount(app), 'the whole documents-only archive opens all three').toBe(3);
      expect(notice(app), 'documents only, whole').not.toContain('cut short');

      // A full archive (workbench entry first) cut after its session entry.
      const full = folderArchive('VGHZ_Full', ['pV_D', 'pV_E']);
      const second = pullAfter(full, 4, LOCAL_HEADER);
      const fullCut = asBytes(full.slice(0, second + 40));
      expect(fullCut.length, 'the cut falls inside the archive').toBeLessThan(full.length);
      await pick(app, new File([fullCut], 'full_cut.zip'));
      expect(notice(app), 'full archive, cut').toContain('Restored workbench "VGHZ_Full.mbc" — 2 documents');
      expect(notice(app), 'full archive, cut').toContain(cutShortSession('full_cut.zip'));

      // Info-ZIP's stored pipe output (sizes in each header, a descriptor after each entry's data), documents
      // only with the .fasta first, cut inside its last entry's data descriptor: the scan steps over the first.
      const piped = deflatedZip(extractZipArchiveEntries(folderArchive('VGHZ_Piped', ['pV_F']))
        .filter((e) => !e.path.endsWith('/workbench.mbc.json')).reverse(), 'sized', 0);
      expect(piped[6] & 0x08, 'the piped probe is streamed (bit 3)').toBe(0x08);
      const pipedCut = asBytes(piped.slice(0, pullAfter(piped, 0, [0x50, 0x4b, 0x01, 0x02]) - 5));
      await drop(app, new File([pipedCut], 'piped_cut.zip'));
      expect(docCount(app), 'the piped document read before the cut opens').toBe(1);
      expect(notice(app), 'piped, cut').toContain(cutShortDocuments('piped_cut.zip', 1));

      await drop(app, new File([full], 'full_whole.zip'));
      expect(notice(app), 'full archive, whole').toContain('Restored workbench "VGHZ_Full.mbc" — 2 documents');
      expect(notice(app), 'full archive, whole').not.toContain('cut short');

      // File > Merge Session with the cut archive: the merge says what was lost too.
      await app.menu('file:merge-session');
      const mergePicker = app.all('input[type="file"]').filter((i) => i.getAttribute('accept') === '.mbc,.mcb,application/json,application/zip');
      expect(mergePicker, 'the one session picker').toHaveLength(1);
      const React = await import('react');
      Object.defineProperty(mergePicker[0], 'files', { configurable: true, value: [new File([fullCut], 'merge_cut.zip')] });
      await React.act(async () => { dispatchLiveEvent(mergePicker[0], 'change'); });
      await app.settle();
      expect(notice(app), 'merged cut archive').toContain('Merged 2 sequence documents from "VGHZ_Full.mbc"');
      expect(notice(app), 'merged cut archive').toContain(cutShortSession('merge_cut.zip'));
      expect(docCount(app), 'the merge adds both documents').toBe(4);
    } finally {
      app.unmount();
    }
  });

  it('BG-01M7VGHZ AC1 a whole archive whose end record is found is never called cut short: ZIP64 opens, an unreadable directory is named', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [ONLY], activeDocId: ONLY.id, viewerTab: 'sequence-view' });
      const entries = probeEntries();
      const docsOnly = entries.slice(0, 2);
      // As `zip -fz` writes it (ZIP64 extra fields, the end record's own counts real), and with the
      // end record's fields left 0xFFFF / 0xFFFFFFFF so only the ZIP64 end record holds them.
      for (const [name, bytes] of [['zip64_stored.zip', zip64Zip(entries, 0, false)], ['zip64_sentinel.zip', zip64Zip(entries, 0, true)]] as const) {
        expect(new DataView(bytes.buffer).getUint32(18, true), `${name}: ZIP64 sizes`).toBe(0xffffffff);
        await drop(app, new File([bytes], name));
        expect(notice(app), name).toContain('Restored workbench "R_Probe.mbc" — 1 documents');
        expect(notice(app), name).not.toContain('cut short');
        expect(words(app.one('.mbc-workbench', 'workbench root').textContent), name).toContain('pR_A');
      }
      // Deflated (`zip -9 -fz`): named a MolBioCraft archive stored compressed, never cut short.
      for (const [name, sentinel] of [['zip64_deflated.zip', false], ['zip64_deflated_sentinel.zip', true]] as const) {
        await pick(app, new File([zip64Zip(entries, 8, sentinel)], name));
        expect(notice(app), name).toContain(unreadableCompressed(name, COMPRESSED_WITH_WORKBENCH));
        expect(notice(app), name).not.toContain('cut short');
        expect(docCount(app), `${name} adds no document`).toBe(1);
      }
      // Streamed ZIP64 (local sizes 0, unsigned descriptors): read only from the ZIP64 central directory.
      for (const [name, sentinel] of [['zip64_streamed.zip', true], ['zip64_streamed_end.zip', false]] as const) {
        await drop(app, new File([zip64Zip(entries, 0, sentinel, true)], name));
        expect(notice(app), name).toContain('Restored workbench "R_Probe.mbc" — 1 documents');
      }
      await pick(app, new File([zip64Zip(entries, 8, true, true)], 'zip64_streamed_deflated.zip'));
      expect(notice(app), 'zip64 streamed deflated').toContain(unreadableCompressed('zip64_streamed_deflated.zip', COMPRESSED_WITH_WORKBENCH));
      await pick(app, new File([zip64Zip(docsOnly, 0, true)], 'zip64_docs.zip'));
      expect(notice(app), 'zip64 documents only').toContain('Restored workbench "zip64_docs.mbc" — 1 documents');
      expect(notice(app), 'zip64 documents only').not.toContain('cut short');

      // A ZIP64 archive cut inside its central directory: the walk reads each local ZIP64 extra field.
      const z64 = zip64Zip(docsOnly, 0, true);
      await drop(app, new File([asBytes(z64.slice(0, pullAfter(z64, 0, [0x50, 0x4b, 0x01, 0x02]) + 40))], 'zip64_cut.zip'));
      expect(docCount(app), 'the cut ZIP64 archive opens its document').toBe(1);
      expect(notice(app), 'zip64 cut').toContain(cutShortDocuments('zip64_cut.zip', 1));

      // A central record pointing at another entry's local header: the names differ, so the local walk reads every entry.
      const three = extractZipArchiveEntries(folderArchive('VGHZ_Mismatch', ['pV_G', 'pV_H', 'pV_I'])).filter((e) => !e.path.endsWith('/workbench.mbc.json'));
      const mismatch = asBytes(createZipArchiveBytes(three));
      const mv = new DataView(mismatch.buffer);
      const firstRecord = pullAfter(mismatch, 0, [0x50, 0x4b, 0x01, 0x02]);
      const thirdRecord = pullAfter(mismatch, pullAfter(mismatch, firstRecord + 4, [0x50, 0x4b, 0x01, 0x02]) + 4, [0x50, 0x4b, 0x01, 0x02]);
      expect(new TextDecoder().decode(mismatch.subarray(thirdRecord + 46, thirdRecord + 46 + mv.getUint16(thirdRecord + 28, true))), 'the third record').toMatch(/pV_H\.mbc\.json$/);
      mv.setUint32(thirdRecord + 42, mv.getUint32(firstRecord + 42, true), true);
      await pick(app, new File([mismatch], 'mismatch.zip'));
      expect(docCount(app), 'every document opens despite the misdirected record').toBe(3);
      expect(words(app.one('.mbc-workbench', 'workbench root').textContent), 'mismatch').toContain('pV_H');

      // Whole archives whose central directory cannot be followed (its first record's signature broken).
      const breakDirectory = (z: Bytes): Bytes => { const b = asBytes(z.slice()); b[pullAfter(b, 0, [0x50, 0x4b, 0x01, 0x02]) + 3] = 0x09; return b; };
      const refused: [string, Bytes, string][] = [
        ['bad_dir_foreign.zip', breakDirectory(deflatedZip(docsOnly, true, 8, false)), unreadableDirectory('bad_dir_foreign.zip')],
        ['bad_dir_session.zip', breakDirectory(deflatedZip([entries[2], ...docsOnly], true, 0, false)),
          '"bad_dir_session.zip" is a MolBioCraft archive that MolBioCraft cannot read: its central directory cannot be followed, and its entries cannot be read without it. Save the archive again from MolBioCraft.'],
      ];
      for (const [name, bytes, sentence] of refused) {
        const before = docCount(app);
        await drop(app, new File([bytes], name));
        const shown = notice(app);
        expect(shown, name).toContain(sentence);
        expect(shown, name).not.toContain('cut short');
        expect(shown, `${name}: never said to hold nothing`).not.toMatch(/holds no MolBioCraft|remains holds no/);
        expect(docCount(app), `${name} adds no document`).toBe(before);
      }
      // The same broken directory on archives whose entries the walk reads: they open, and say the rest may be unread.
      await pick(app, new File([breakDirectory(asBytes(createZipArchiveBytes(three)))], 'bad_dir_docs.zip'));
      expect(docCount(app), 'bad directory, documents').toBe(3);
      expect(notice(app), 'bad directory, documents').toContain(directoryDocuments('bad_dir_docs.zip', 3));
      await drop(app, new File([breakDirectory(folderArchive('VGHZ_BadDir', ['pV_J']))], 'bad_dir_full.zip'));
      expect(notice(app), 'bad directory, session').toContain('Restored workbench "VGHZ_BadDir.mbc" — 1 documents');
      expect(notice(app), 'bad directory, session').toContain(directorySession('bad_dir_full.zip'));
      expect(notice(app), 'bad directory, session').not.toContain('cut short');
    } finally {
      app.unmount();
    }
  });
});

/** The reviewer's probe entries, as unzipped from a serializeMbcFolderZip archive: .fasta, document, session. */
function probeEntries(): { path: string; data: Uint8Array }[] {
  const unzipped = extractZipArchiveEntries(serializeMbcFolderZip({
    sessionName: 'R_Probe',
    documents: [archiveDoc('vghz-probe', 'pR_A', 'ATGGCCAAATTTGGGCCCACGTACGTTTGA')],
    workspace: { activeDocId: 'vghz-probe' },
  } as unknown as MbcWorkbenchSnapshot)).map((e) => ({ path: e.path.replace(/^[^/]+\//, ''), data: e.data }));
  return ['Local/pR_A.fasta', 'Local/pR_A.mbc.json', 'workbench.mbc.json'].map((p) => unzipped.find((e) => e.path === p)!);
}

/**
 * A ZIP64 archive as `zip -fz` writes it: each local header and central record carries 0xFFFFFFFF
 * sizes (and the record a 0xFFFFFFFF offset) with the real values in a ZIP64 extra field (id 0x0001),
 * then a ZIP64 end record and its locator before the end record. With `sentinelEnd`, the end
 * record's counts, size and offset are left 0xFFFF / 0xFFFFFFFF too. With `streamed`, as a streaming
 * ZIP64 writer, each local header leaves its sizes 0 (bit 3) and an unsigned ZIP64 data descriptor
 * follows the data, so only the central directory tells where each entry ends.
 */
function zip64Zip(entries: { path: string; data: Uint8Array }[], method: 0 | 8, sentinelEnd: boolean, streamed = false): Bytes {
  const enc = new TextEncoder();
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const u64 = (n: number) => [...u32(n), ...u32(0)];
  const parts: number[] = [];
  const central: number[] = [];
  for (const e of entries) {
    const name = [...enc.encode(e.path)];
    const packed = method === 8 ? [...deflateRawSync(e.data, { level: 9 })] : [...e.data];
    const crc = crc32(e.data);
    const offset = parts.length;
    const localSize = streamed ? 0 : 0xffffffff;
    parts.push(0x50, 0x4b, 0x03, 0x04, ...u16(45), ...u16(streamed ? 0x0808 : 0x0800), ...u16(method), ...u16(0), ...u16(0), ...u32(streamed ? 0 : crc),
      ...u32(localSize), ...u32(localSize), ...u16(name.length), ...u16(20), ...name,
      ...u16(1), ...u16(16), ...u64(streamed ? 0 : e.data.length), ...u64(streamed ? 0 : packed.length), ...packed);
    if (streamed) parts.push(...u32(crc), ...u64(packed.length), ...u64(e.data.length));
    central.push(0x50, 0x4b, 0x01, 0x02, ...u16(45), ...u16(45), ...u16(streamed ? 0x0808 : 0x0800), ...u16(method), ...u16(0), ...u16(0), ...u32(crc),
      ...u32(0xffffffff), ...u32(0xffffffff), ...u16(name.length), ...u16(28), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(0xffffffff), ...name, ...u16(1), ...u16(24), ...u64(e.data.length), ...u64(packed.length), ...u64(offset));
  }
  const cdOffset = parts.length;
  parts.push(...central);
  const z64End = parts.length;
  parts.push(0x50, 0x4b, 0x06, 0x06, ...u64(44), ...u16(45), ...u16(45), ...u32(0), ...u32(0),
    ...u64(entries.length), ...u64(entries.length), ...u64(central.length), ...u64(cdOffset));
  parts.push(0x50, 0x4b, 0x06, 0x07, ...u32(0), ...u64(z64End), ...u32(1));
  const count = sentinelEnd ? 0xffff : entries.length;
  parts.push(0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(count), ...u16(count),
    ...u32(sentinelEnd ? 0xffffffff : central.length), ...u32(sentinelEnd ? 0xffffffff : cdOffset), ...u16(0));
  return new Uint8Array(parts);
}
const unreadableDirectory = (name: string) =>
  `"${name}" is a ZIP archive that MolBioCraft cannot read: its central directory cannot be followed, so MolBioCraft cannot tell whether it holds a MolBioCraft session or document. Open the original file, or unzip it and open the files inside.`;
const directoryDocuments = (name: string, n: number) =>
  `"${name}" has a central directory MolBioCraft cannot follow: it opened the ${n} ${n === 1 ? 'document' : 'documents'} read before it stopped, and any entries after them were not read. Save the archive again from MolBioCraft.`;
const directorySession = (name: string) =>
  `"${name}" has a central directory MolBioCraft cannot follow: its session entry was read whole, and any entries after it were not read. Save the archive again from MolBioCraft.`;
