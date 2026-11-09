// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { reverseComplement } from '../core/bioEngine';
import { rotateToReference } from '../core/circularAlignment';
import { annotateFromDocuments } from '../core/annotateFromDocuments';
import { degeneracyOf, designDegeneratePrimers, DEGENERATE_DEFAULTS, iupacOf, reverseComplementIupac } from '../core/degeneratePrimers';
import { runAnnotateFromDocuments, runDesignDegeneratePrimers, runMultipleAlignment } from '../core/operationRunners';
import { calculatePrimerMetrics } from '../core/bioEngine';
import type { SequenceDocument } from '../types/bio';

const puc = SAMPLE_LIBRARY.find((d) => d.id === 'doc-puc19')!;

describe('circular alignment', () => {
  it('finds the origin of a rotated, reverse-complemented copy', () => {
    const rot = puc.sequence.slice(1000) + puc.sequence.slice(0, 1000);
    const r1 = rotateToReference(puc.sequence, rot);
    expect(r1.reversed).toBe(false);
    expect(r1.sequence.toUpperCase()).toBe(puc.sequence.toUpperCase());
    const r2 = rotateToReference(puc.sequence, reverseComplement(rot));
    expect(r2.reversed).toBe(true);
    expect(r2.sequence.toUpperCase()).toBe(puc.sequence.toUpperCase());
  });
  it('Multiple Alignment with the circular option gives a gap-free alignment of rotated copies', () => {
    const a = { ...puc, id: 'a', name: 'pUC19 a' };
    const b = { ...puc, id: 'b', name: 'pUC19 b', sequence: puc.sequence.slice(700) + puc.sequence.slice(0, 700) };
    const r = runMultipleAlignment([a, b], { circular: true }, { sourceLabel: 'pUC19' });
    const rows = r.created[0].alignmentMeta!.sequences!;
    expect(rows[1].sequence.toUpperCase()).toBe(rows[0].sequence.toUpperCase());
    expect(String(r.created[0].docMetadata?.['Circular rotation'])).toMatch(new RegExp(`origin moved to ${puc.sequence.length - 700 + 1}`));
  });
});

describe('annotate from documents', () => {
  it('places every pUC19 feature on a rotated, reverse-complemented unannotated copy', () => {
    const rot = 900;
    const seq = reverseComplement(puc.sequence.slice(rot) + puc.sequence.slice(0, rot));
    const target: SequenceDocument = { ...puc, id: 't', name: 'unknown plasmid', sequence: seq, features: [] };
    const hits = annotateFromDocuments(target, [puc], 95);
    const n = puc.sequence.length;
    const wanted = puc.features.filter((f) => f.type !== 'source' && Math.abs(f.end - f.start) + 1 >= 15);
    for (const f of wanted) {
      const lo = Math.min(f.start, f.end);
      const hi = Math.max(f.start, f.end);
      // expected position: rotate then reverse-complement
      const rLo = ((lo - 1 - rot + n) % n) + 1;
      const rHi = ((hi - 1 - rot + n) % n) + 1;
      if (rHi < rLo) continue; // spans the new origin
      const eStart = n - rHi + 1;
      const eEnd = n - rLo + 1;
      const h = hits.find((x) => x.feature.name === f.name && x.feature.type === f.type);
      expect(h, f.name).toBeTruthy();
      expect(h!.start).toBe(eStart);
      expect(h!.end).toBe(eEnd);
      expect(h!.identityPct).toBeCloseTo(100, 6);
    }
  });
  it('runner adds annotations with their source and replaces earlier transfers', () => {
    const target: SequenceDocument = { ...puc, id: 't', name: 'copy', features: [] };
    const r = runAnnotateFromDocuments([target], [puc], { minIdentity: 90 });
    const f = r.updated[0].features;
    expect(f.length).toBeGreaterThan(3);
    expect(f[0].notes).toMatch(/Annotated from pUC19_Standard_Vector \(100\.0% identity\)/);
    const again = runAnnotateFromDocuments([r.updated[0]], [puc], { minIdentity: 90 });
    expect(again.updated[0]?.features.length ?? f.length).toBe(f.length);
  });
});

describe('degenerate primers', () => {
  it('IUPAC helpers', () => {
    expect(iupacOf('AG')).toBe('R');
    expect(iupacOf('ACGT')).toBe('N');
    expect(reverseComplementIupac('ACGR')).toBe('YCGT');
    expect(degeneracyOf('ARYN')).toBe(16);
  });
  it('designs pairs on a variable alignment within the limits', () => {
    const aln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    const rows = aln.alignmentMeta!.sequences!.slice(0, 12).map((m) => m.sequence);
    const o = { ...DEGENERATE_DEFAULTS, maxDegeneracy: 256, tmMin: 45, tmMax: 65, exact3Prime: 2, productMin: 150, productMax: 700 };
    const r = designDegeneratePrimers(rows, o, (s) => calculatePrimerMetrics(s).tmC);
    expect(r.pairs.length).toBeGreaterThan(0);
    for (const p of r.pairs) {
      for (const x of [p.forward, p.reverse]) {
        expect(x.degeneracy).toBeLessThanOrEqual(256);
        expect(degeneracyOf(x.sequence.slice(-2))).toBe(1);
        expect(x.sequence.length).toBeGreaterThanOrEqual(18);
      }
      expect(p.productLength).toBeGreaterThanOrEqual(150);
      expect(p.productLength).toBeLessThanOrEqual(700);
      // the forward primer, expanded, matches every sequence at its columns (ignoring gaps)
      const f = p.forward;
      for (const row of rows) {
        const site = row.slice(f.start - 1, f.end).toUpperCase();
        // a base is covered when adding it to the code's bases leaves the code unchanged
        const bases: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT' };
        let covered = 0;
        let total = 0;
        [...site].forEach((b, i) => {
          if (!'ACGT'.includes(b)) return;
          total++;
          if (iupacOf(bases[f.sequence[i]] + b) === f.sequence[i]) covered++;
        });
        // bases rarer than the 5% inclusion threshold may be left out; with 12 sequences that is none
        expect(covered).toBe(total);
      }
    }
  });
  it('runner saves a report, primers on the alignment and optional primer documents', () => {
    const aln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    const small = { ...aln, alignmentMeta: { ...aln.alignmentMeta!, sequences: aln.alignmentMeta!.sequences!.slice(0, 8) } };
    const r = runDesignDegeneratePrimers(small, { maxDegeneracy: 256, tmMin: 45, tmMax: 65, exact3Prime: 2, pairs: 2, savePrimerDocs: true }, { sourceLabel: 'COXII' });
    expect(String(r.created[0].docMetadata?.Notes)).toMatch(/Degenerate consensus/);
    expect(r.created.filter((d) => d.documentKind === 'primer').length).toBe(2 * (r.updated[0].primers.length / 2));
    expect(r.updated[0].primers.every((p) => p.notes?.startsWith('Degenerate primer'))).toBe(true);
  });
});

describe('degenerate primer pairs are distinct', () => {
  it('no two pairs sit within 5 columns of each other at both ends', () => {
    const aln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
    const rows = aln.alignmentMeta!.sequences!.map((m) => m.sequence);
    const r = designDegeneratePrimers(rows, { ...DEGENERATE_DEFAULTS, maxDegeneracy: 1024, exact3Prime: 2, inclusionPct: 20 }, (s) => calculatePrimerMetrics(s).tmC);
    expect(r.pairs.length).toBeGreaterThan(1);
    for (let i = 0; i < r.pairs.length; i++) {
      for (let j = i + 1; j < r.pairs.length; j++) {
        const a = r.pairs[i];
        const b = r.pairs[j];
        expect(Math.abs(a.forward.start - b.forward.start) >= 5 || Math.abs(a.reverse.end - b.reverse.end) >= 5).toBe(true);
      }
    }
  });
});

describe('annotate from documents: one annotation per site', () => {
  it('two references naming the same element differently give one annotation', () => {
    const renamed: SequenceDocument = { ...puc, id: 'ref2', name: 'renamed copy', features: puc.features.map((f) => ({ ...f, name: `${f.name} (alt)` })) };
    const target: SequenceDocument = { ...puc, id: 't', name: 'copy', features: [] };
    const hits = annotateFromDocuments(target, [puc, renamed], 95);
    const single = annotateFromDocuments(target, [puc], 95);
    expect(hits.length).toBe(single.length);
  });
});
