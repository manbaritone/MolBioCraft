// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6P2KY AC3: GenBank export through the shipped wrappers. `exportToGenBank` writes the day it
 * runs as the LOCUS date (D0200), and `parseGenBank` of its text gives back the document's primers
 * (D0201), name (D0202) and primer numbers from the engine's `calculatePrimerMetrics`.
 *
 * BG-01M7Q9BP AC3: `parseEMBL` of `exportToEMBL`'s text gives back the same primers, with the same
 * engine numbers `parseGenBank` gives them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculatePrimerMetrics } from '../core/bioEngine';
import { exportToEMBL, exportToGenBank, parseEMBL, parseGenBank } from '../core/fileParsers';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { PrimerRecord, SequenceDocument } from '../types/bio';

// A 60-bp synthetic layout fixture; nothing depends on the bases being any vector's own.
const MCS_60 = 'GAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGC';

const revcomp = (s: string) =>
  [...s].reverse().map((c) => ({ A: 'T', T: 'A', G: 'C', C: 'G' })[c] ?? c).join('');

function mcsDoc(name: string, primers: PrimerRecord[]): SequenceDocument {
  const text = [
    'LOCUS       MCS60                     60 bp    DNA     linear   SYN 01-JAN-2000',
    'FEATURES             Location/Qualifiers',
    '     misc_feature    7..12',
    '                     /label="SacI"',
    'ORIGIN',
    `        1 ${MCS_60.toLowerCase().replace(/(.{10})(?=.)/g, '$1 ')}`,
    '//',
    '',
  ].join('\n');
  return { ...parseGenBank(text, 'MCS60'), name, primers };
}

/** A primer whose numbers are all wrong, so only a recomputation gives the engine's. */
function primer(over: Partial<PrimerRecord> & Pick<PrimerRecord, 'name' | 'sequence' | 'annealSequence' | 'bindStart' | 'bindEnd' | 'strand'>): PrimerRecord {
  return {
    id: over.name,
    tail5Prime: over.sequence.slice(0, over.sequence.length - over.annealSequence.length),
    length: over.sequence.length,
    gcPercent: -1,
    tmAnnealC: -1,
    tmFullC: -1,
    deltaG37: 99,
    hairpinDeltaG: 99,
    selfDimerDeltaG: 99,
    gcClamp3Prime: false,
    ...over,
  };
}

const FWD_ANNEAL = MCS_60.slice(0, 20);
const REV_ANNEAL = revcomp(MCS_60.slice(40, 60));
// N inside the anneal sequence: Primer3 gives no Tm for it (BG-01M6SHQ0).
const N_ANNEAL = 'GGATCCTCTAGANTCGACCT';
const PRIMERS = [
  primer({ name: 'MCS fwd tailed', sequence: `GCGGCCGCTT${FWD_ANNEAL}`, annealSequence: FWD_ANNEAL, bindStart: 1, bindEnd: 20, strand: 1 }),
  primer({ name: 'MCS_rev', sequence: REV_ANNEAL, annealSequence: REV_ANNEAL, bindStart: 41, bindEnd: 60, strand: -1 }),
  primer({ name: 'with N', sequence: N_ANNEAL, annealSequence: N_ANNEAL, bindStart: 23, bindEnd: 42, strand: 1 }),
];

afterEach(() => {
  vi.useRealTimers();
});

describe('US-01M6P2KY AC3: GenBank export through the shipped wrappers', () => {
  it('US-01M6P2KY AC3 writes the day of the export as the LOCUS date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const doc = mcsDoc('MCS60', []);
    // Shortly after local midnight: the local calendar day, whatever the UTC day is.
    vi.setSystemTime(new Date(2027, 2, 5, 0, 30));
    const locus = exportToGenBank(doc).split('\n')[0];
    expect(locus.endsWith(' SYN 05-MAR-2027')).toBe(true);
    expect(locus.slice(68, 79)).toBe('05-MAR-2027');
    vi.setSystemTime(new Date(2026, 10, 19, 12, 0));
    const text = exportToGenBank(doc);
    expect(text.split('\n')[0].endsWith(' SYN 19-NOV-2026')).toBe(true);
    expect(text).not.toContain('31-OCT-2026');
  });

  it('US-01M6P2KY AC3 reads the primers back with the engine Tm of their anneal sequence', () => {
    const doc = mcsDoc('pUC19 MCS v2', PRIMERS);
    const back = parseGenBank(exportToGenBank(doc), 'fallback');
    expect(back.name).toBe('pUC19 MCS v2');
    // GenBank requires a source feature, which the export adds; the primers become no feature.
    expect(back.features.map((f) => f.type)).toEqual(['source', ...doc.features.map((f) => f.type)]);
    expect(back.primers.map((p) => [p.name, p.sequence, p.annealSequence, p.tail5Prime, p.bindStart, p.bindEnd, p.strand])).toEqual(
      PRIMERS.map((p) => [p.name, p.sequence, p.annealSequence, p.tail5Prime, p.bindStart, p.bindEnd, p.strand])
    );
    for (const p of back.primers) {
      const anneal = calculatePrimerMetrics(p.annealSequence);
      const full = calculatePrimerMetrics(p.sequence);
      expect(p.tmAnnealC, p.name).toBe(anneal.tmC);
      expect(p.tmFullC, p.name).toBe(full.tmC);
      expect([p.length, p.gcPercent, p.deltaG37, p.hairpinDeltaG, p.selfDimerDeltaG], p.name).toEqual([
        p.sequence.length,
        full.gcPercent,
        full.deltaG37,
        full.hairpinDeltaG,
        full.selfDimerDeltaG,
      ]);
      expect(p.gcClamp3Prime, p.name).toBe(anneal.gcClamp3Prime);
      expect(p.tmNoAnswerReason, p.name).toBe(anneal.tmNoAnswerReason);
    }
    // The tailed primer's two Tms differ, so the full Tm is not the anneal Tm copied.
    expect(back.primers[0].tmFullC).not.toBe(back.primers[0].tmAnnealC);
    expect(back.primers[2].tmNoAnswerReason).toMatch(/^Tm n\/a/);
    expect(back.primers[0].tmNoAnswerReason).toBeUndefined();
  });

  it('US-01M6P2KY AC3 the export op refuses a missing or unreadable date rather than invent one', () => {
    const doc = mcsDoc('MCS60', []);
    expect(() => invokeRustBioSync<string>('export_genbank', { doc })).toThrow(/exportDate/);
    expect(() => invokeRustBioSync<string>('export_genbank', { doc, exportDate: '2027-02-30' })).toThrow(/exportDate/);
    expect(invokeRustBioSync<string>('export_genbank', { doc, exportDate: '2027-03-04' }).split('\n')[0]).toMatch(/ SYN 04-MAR-2027$/);
  });
});

describe('BG-01M7Q9BP AC3: EMBL export through the shipped wrappers', () => {
  it('BG-01M7Q9BP AC3 reads EMBL primers back with the engine Tm of their anneal sequence', () => {
    // The two AC1 primers (a forward one with a 5' tail, a reverse one on strand -1) and one with N.
    const doc = mcsDoc('MCS60', PRIMERS);
    const back = parseEMBL(exportToEMBL(doc), 'fallback');
    // The EMBL export adds no source feature; the primers become no feature.
    expect(back.features.map((f) => f.type)).toEqual(doc.features.map((f) => f.type));
    expect(back.primers.map((p) => [p.name, p.sequence, p.annealSequence, p.tail5Prime, p.bindStart, p.bindEnd, p.strand])).toEqual(
      PRIMERS.map((p) => [p.name, p.sequence, p.annealSequence, p.tail5Prime, p.bindStart, p.bindEnd, p.strand])
    );
    for (const p of back.primers) {
      const anneal = calculatePrimerMetrics(p.annealSequence);
      const full = calculatePrimerMetrics(p.sequence);
      expect(p.tmAnnealC, p.name).toBe(anneal.tmC);
      expect(p.tmFullC, p.name).toBe(full.tmC);
      expect([p.length, p.gcPercent, p.deltaG37, p.hairpinDeltaG, p.selfDimerDeltaG], p.name).toEqual([
        p.sequence.length,
        full.gcPercent,
        full.deltaG37,
        full.hairpinDeltaG,
        full.selfDimerDeltaG,
      ]);
      expect(p.gcClamp3Prime, p.name).toBe(anneal.gcClamp3Prime);
      expect(p.tmNoAnswerReason, p.name).toBe(anneal.tmNoAnswerReason);
    }
    // The tailed primer's two Tms differ, so the full Tm is not the anneal Tm copied.
    expect(back.primers[0].tmFullC).not.toBe(back.primers[0].tmAnnealC);
    expect(back.primers[2].tmNoAnswerReason).toMatch(/^Tm n\/a/);
    // A primer imported from EMBL shows the numbers one imported from GenBank shows.
    expect(back.primers).toEqual(parseGenBank(exportToGenBank(doc), 'fallback').primers);
  });
});
