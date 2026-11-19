// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7Q97X AC2: imported and engine-made documents carry the caller's time, through the shipped
 * wrappers, with no interface step patching dates afterwards. Each wrapper sends `nowIso` (default:
 * now), and the engine writes it into createdAt, updatedAt and the new history entry's minute. An op
 * called without `nowIso` writes blank dates, never a fixed one (D0203).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseGff3Sequences } from '../core/bioEngine';
import { parseDnaBinaryPacket, parseEMBL, parseFasta, parseGenBank } from '../core/fileParsers';
import { concatenateSequenceDocuments } from '../core/workbenchBatchOperations';
import {
  extractRegionWithAnnotationsRust,
  invokeRustBioSync,
  parseRemoteDatabasePayloadRust,
} from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

// A mocked clock far from any date the engine ever used as a placeholder.
const NOW = '2027-03-04T10:05:06.789Z';
const NOW_MINUTE = '2027-03-04 10:05';

const SEQ_60 = 'GAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGC';

const GENBANK = [
  'LOCUS       MCS60                     60 bp    DNA     linear   SYN 01-JAN-2000',
  'FEATURES             Location/Qualifiers',
  '     misc_feature    7..12',
  '                     /label="SacI"',
  'ORIGIN',
  `        1 ${SEQ_60.toLowerCase().replace(/(.{10})(?=.)/g, '$1 ')}`,
  '//',
  '',
].join('\n');

// A GFF3 file carrying its sequence under ##FASTA (the US-01M7NMB6 import path).
const GFF3 = [
  '##gff-version 3',
  'MCS60\tfixture\tmisc_feature\t7\t12\t.\t+\t.\tID=sacI;Name=SacI',
  '##FASTA',
  '>MCS60',
  SEQ_60,
  '',
].join('\n');

const EMBL = [
  'ID   MCS60; SV 1; linear; genomic DNA; STD; SYN; 60 BP.',
  'DE   A synthetic 60 bp layout fixture.',
  'SQ   Sequence 60 BP;',
  `     ${SEQ_60.toLowerCase().replace(/(.{10})(?=.)/g, '$1 ')}`,
  '//',
  '',
].join('\n');

/** The dates a new document carries, and the minute of its newest history entry. */
function stamps(doc: SequenceDocument) {
  return {
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    history: doc.history[doc.history.length - 1]?.timestamp,
  };
}

const AT_NOW = { createdAt: NOW, updatedAt: NOW, history: NOW_MINUTE };
const BLANK = { createdAt: '', updatedAt: '', history: '' };

describe('US-01M7Q97X AC2: documents carry the caller time', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('US-01M7Q97X AC2: a GenBank import made at a mocked Date carries that time', () => {
    const doc = parseGenBank(GENBANK, 'MCS60');
    expect(doc.sequence).toBe(SEQ_60);
    expect(doc.history.length).toBeGreaterThan(0);
    expect(stamps(doc)).toEqual(AT_NOW);
  });

  it('US-01M7Q97X AC2: FASTA, EMBL and trace-file imports carry that time', () => {
    const fasta = parseFasta(`>one\n${SEQ_60}\n>two\nACGTACGT\n`);
    expect(fasta).toHaveLength(2);
    for (const d of fasta) expect(stamps(d)).toEqual(AT_NOW);
    const embl = parseEMBL(EMBL, 'MCS60');
    expect(embl.sequence).toBe(SEQ_60);
    expect(stamps(embl)).toEqual(AT_NOW);
    // Plain-text bases saved under a trace extension are read as a sequence (no binary fixture needed).
    const trace = parseDnaBinaryPacket(new TextEncoder().encode(`${SEQ_60}\n`).buffer, 'read.ab1');
    expect(trace.sequence).toBe(SEQ_60);
    expect(stamps(trace)).toEqual(AT_NOW);
    // The sequences of a GFF3 file's ##FASTA section, opened with their features.
    const gff = parseGff3Sequences(GFF3);
    expect(gff.documents).toHaveLength(1);
    expect(gff.documents[0].features.length).toBeGreaterThan(0);
    expect(stamps(gff.documents[0])).toEqual(AT_NOW);
    // A record fetched from a database, GenBank and FASTA alike.
    const fetchedGb = parseRemoteDatabasePayloadRust(GENBANK, 'MCS60', false, 'Sample Documents');
    expect(fetchedGb).toHaveLength(1);
    expect(stamps(fetchedGb[0])).toEqual(AT_NOW);
    const fetchedFa = parseRemoteDatabasePayloadRust(`>MCS60\n${SEQ_60}\n`, 'MCS60', false, 'Sample Documents');
    expect(stamps(fetchedFa[0])).toEqual(AT_NOW);
  });

  it('US-01M7Q97X AC2: a cloning result and a batch concatenation made at a mocked Date carry that time', () => {
    const source = parseGenBank(GENBANK, 'MCS60');
    // Give the source an older creation date, so a result that copied it would show.
    const older = { ...source, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' };
    const region = extractRegionWithAnnotationsRust(older, 1, 30);
    expect(region.sequence).toBe(SEQ_60.slice(0, 30));
    expect(stamps(region)).toEqual(AT_NOW);
    const joined = concatenateSequenceDocuments([older, { ...older, id: 'second' }]);
    expect(joined.sequence).toBe(SEQ_60 + SEQ_60);
    expect(stamps(joined)).toEqual(AT_NOW);
  });

  it('US-01M7Q97X AC2: an op called without nowIso writes blank dates, never a fixed one (D0203)', () => {
    const gb = invokeRustBioSync<SequenceDocument>('parse_genbank', { text: GENBANK, fallbackName: 'MCS60' });
    expect(stamps(gb)).toEqual(BLANK);
    const fasta = invokeRustBioSync<SequenceDocument[]>('parse_fasta', { text: `>one\n${SEQ_60}\n`, defaultName: 'x' });
    expect(stamps(fasta[0])).toEqual(BLANK);
    const embl = invokeRustBioSync<SequenceDocument>('parse_embl', { text: EMBL, fallbackName: 'MCS60' });
    expect(stamps(embl)).toEqual(BLANK);
    const trace = invokeRustBioSync<SequenceDocument>('parse_binary_packet', {
      bytes: Array.from(new TextEncoder().encode(`${SEQ_60}\n`)),
      fileName: 'read.ab1',
    });
    expect(stamps(trace)).toEqual(BLANK);
    const gffBare = invokeRustBioSync<{ documents: SequenceDocument[] }>('parse_gff3_sequences', { text: GFF3 });
    expect(stamps(gffBare.documents[0])).toEqual(BLANK);
    const fetched = invokeRustBioSync<SequenceDocument[]>('parse_remote_database_payload', {
      rawText: GENBANK,
      accession: 'MCS60',
      isProteinHint: false,
      targetFolder: 'Sample Documents',
    });
    expect(stamps(fetched[0])).toEqual(BLANK);
    const region = invokeRustBioSync<SequenceDocument>('extract_region_with_annotations_rust', {
      doc: gb,
      start1Based: 1,
      end1Based: 30,
    });
    expect(stamps(region)).toEqual(BLANK);
    const preset = invokeRustBioSync<SequenceDocument>('build_ncbi_reference_preset_document', { preset: 'cas9' });
    expect(preset.createdAt).toBe('');
    expect(preset.updatedAt).toBe('');
  });
});
