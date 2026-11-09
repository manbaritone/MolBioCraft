// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { runMapToReferences, runValidateClone } from '../core/operationRunners';

const coi = SAMPLE_LIBRARY.find((d) => d.name === 'COI Assembly')!;
const coiReads = SAMPLE_LIBRARY.filter((d) => /^COI (fwd|rev) read$/.test(d.name));
const egfpRead = SAMPLE_LIBRARY.find((d) => d.name === 'eGFP_Clone3_Sanger_Fwd.ab1')!;
const pet = SAMPLE_LIBRARY.find((d) => d.name === 'pET-28a(+)-eGFP')!;

describe('map to several references', () => {
  it('sends each read to the reference it matches and makes one contig per reference', () => {
    const r = runMapToReferences([coi, pet], [...coiReads, egfpRead], {}, { sourceLabel: 'x' });
    expect(r.created).toHaveLength(2);
    const byRef = Object.fromEntries(r.created.map((d) => [d.docMetadata?.Reference, d.alignmentMeta!.sequences!.length - 1]));
    expect(byRef['COI Assembly']).toBe(2);
    expect(byRef['pET-28a(+)-eGFP']).toBe(1);
  });
});

describe('validate clone', () => {
  it('reports coverage and discrepancies against the expected construct', () => {
    const r = runValidateClone(coi, coiReads, { requiredCoverage: 95 }, { sourceLabel: 'x' });
    const meta = r.created[0].docMetadata!;
    expect(String(meta.Validation)).toMatch(/^(Confirmed|Not confirmed)/);
    expect(r.summary).toBe(meta.Validation);
    expect(r.created[0].history[0].operation).toBe('Validate Clone');
  });
  it('flags a construct that the reads only partly cover', () => {
    const r = runValidateClone(pet, [egfpRead], {}, { sourceLabel: 'x' });
    expect(String(r.created[0].docMetadata?.Validation)).toMatch(/Not confirmed: .*bp not covered/);
  });
});
