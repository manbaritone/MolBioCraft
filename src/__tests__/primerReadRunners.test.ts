// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { runTestSavedPrimers, runTrimEnds, SAVED_PRIMER_NOTE, TRIM_NOTE } from '../core/operationRunners';
import { findDuplicateGroups } from '../core/documentManagement';
import { reverseComplement } from '../core/bioEngine';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';

const primers = SAMPLE_LIBRARY.filter((d) => d.documentKind === 'primer');
const puc19 = SAMPLE_LIBRARY.find((d) => d.name === 'pUC19_Standard_Vector')!;
const traces = SAMPLE_LIBRARY.filter((d) => d.chromatogram?.phredScores?.length);

describe('test with saved primers', () => {
  it('finds the M13 primers on pUC19 and adds them as primers (replacing earlier results)', () => {
    const r = runTestSavedPrimers([puc19], primers, { maxMismatches: 1 });
    const found = r.updated[0].primers.filter((p) => p.notes?.startsWith(SAVED_PRIMER_NOTE));
    const names = found.map((p) => p.name);
    expect(names.some((n) => n.startsWith('M13-F'))).toBe(true);
    expect(names.some((n) => n.startsWith('M13-R'))).toBe(true);
    for (const p of found) expect(p.bindEnd).toBeGreaterThan(p.bindStart);
    const again = runTestSavedPrimers(r.updated, primers, { maxMismatches: 1 });
    expect(again.updated[0].primers.filter((p) => p.notes?.startsWith(SAVED_PRIMER_NOTE)).length).toBe(found.length);
  });
  it('limits the test to the chosen primers', () => {
    const r = runTestSavedPrimers([puc19], primers, { maxMismatches: 0, primerNames: 'T7 promoter' });
    expect(r.updated.flatMap((d) => d.primers).every((p) => !p.notes?.startsWith(SAVED_PRIMER_NOTE) || p.name === 'T7 promoter')).toBe(true);
  });
});

describe('trim ends', () => {
  it('annotates low-quality trace ends without changing the reads', () => {
    const r = runTrimEnds(traces, { minQuality: 20, action: 'annotate' }, { sourceLabel: 'x' });
    expect(r.updated.length).toBe(traces.length);
    for (const d of r.updated) {
      const src = traces.find((t) => t.id === d.id)!;
      expect(d.sequence).toBe(src.sequence);
      expect(d.features.filter((f) => f.notes === TRIM_NOTE).every((f) => f.start >= 1 && f.end <= src.sequence.length)).toBe(true);
    }
  });
  it('creates trimmed copies and drops reads that become too short', () => {
    const r = runTrimEnds(traces, { minQuality: 20, action: 'copy', minLength: 50 }, { sourceLabel: 'x' });
    for (const d of r.created) {
      expect(d.chromatogram).toBeUndefined();
      expect(d.sequence.length).toBeGreaterThanOrEqual(50);
      expect(d.name).toMatch(/\(trimmed\)$/);
    }
    const none = runTrimEnds(traces, { action: 'copy', minLength: 100000 }, { sourceLabel: 'x' });
    expect(none.created).toEqual([]);
    expect(none.summary).toMatch(/not kept/);
  });
});

describe('duplicate reads on either strand', () => {
  it('counts a reverse complement as a duplicate only when asked', () => {
    const s = 'ATGCGTACGTTAGCCGATCGATCGGATCCA';
    const a = { ...EMPTY_WORKSPACE_DOCUMENT, id: 'a', name: 'a', sequence: s, moleculeType: 'DNA' as const };
    const b = { ...a, id: 'b', name: 'b', sequence: reverseComplement(s) };
    expect(findDuplicateGroups([a, b], 'sequence', 'newest')).toEqual([]);
    expect(findDuplicateGroups([a, b], 'sequence', 'newest', true)).toHaveLength(1);
  });
});
