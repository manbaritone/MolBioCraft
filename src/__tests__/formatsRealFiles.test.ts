// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Import paths exercised through the WASM bridge with trace files the tests write (traceFixtures.ts). */

import { describe, expect, it } from 'vitest';
import { parseDnaBinaryPacket } from '../core/fileParsers';
import { scfV3Bytes, seededChromatogram } from './traceFixtures';

describe('binary formats through the app bridge', () => {
  it('opens an SCF trace with real traces, peaks and qualities', () => {
    // A seeded read of 400 calls with irregular peak spacing, written as SCF v3. No two of its
    // channels are equal, so a channel read into the wrong slot fails on that channel.
    const written = seededChromatogram(0x5cf30001, 400);
    const channels = [written.traceA, written.traceC, written.traceG, written.traceT];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(channels[i], `channels ${i} and ${j}`).not.toEqual(channels[j]);
    const doc = parseDnaBinaryPacket(scfV3Bytes(written, 'COI fwd read'), 'COI fwd read.scf');
    expect(doc.name).toBe('COI fwd read');
    expect(doc.sequence).toBe(written.baseCalls);
    expect(doc.topology).toBe('linear');
    expect(doc.documentKind).toBe('trace');
    expect(doc.docMetadata?.['Sample Name']).toBe('COI fwd read');
    const c = doc.chromatogram!;
    expect(c.baseCalls).toBe(written.baseCalls);
    expect(c.phredScores).toEqual(written.phredScores);
    expect(c.peakLocations).toEqual(written.peakLocations);
    expect(c.traceA, 'A channel').toEqual(written.traceA);
    expect(c.traceC, 'C channel').toEqual(written.traceC);
    expect(c.traceG, 'G channel').toEqual(written.traceG);
    expect(c.traceT, 'T channel').toEqual(written.traceT);
  });
});
