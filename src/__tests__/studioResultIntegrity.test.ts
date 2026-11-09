// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { mapReadAndCallVariants } from '../core/bioEngine';
import { mapVariantRefPositionToReadIndex } from '../core/chromatogramVariantNavigation';
import { resolveContactAtomIndices } from '../core/structureContacts';
import { pipelineRunKey, selectCurrentPipelineReport } from '../core/pipelineReportFreshness';
import { pdbTextLoadProblem, trimmedReadSaveBlockReason } from '../core/ngsTrimSave';
import {
  alignPdbStructuresKabsch,
  synthesizeAlphaHelicalCaPdbFromProtein,
} from '../core/genomicsAndStructureSuite';
import type { SequenceDocument } from '../types/bio';

function pseudoRandomDna(len: number, seed: number): string {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[(x >>> 13) & 3];
  }
  return out;
}

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const revComp = (s: string) => s.split('').reverse().map((c) => COMP[c]).join('');

const doc = (id: string, sequence: string): SequenceDocument =>
  ({
    id,
    name: id,
    accession: id,
    description: '',
    moleculeType: 'DNA',
    topology: 'linear',
    sequence,
    features: [],
    primers: [],
    history: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }) as unknown as SequenceDocument;

describe('Chromatogram variant -> trace base navigation', () => {
  const ref = pseudoRandomDna(1200, 7);
  const READ_START = 400; // 0-based reference offset of the read
  const SNP_READ_IDX = 60;

  it('maps a forward read SNP from reference coordinates to the read base index', () => {
    const readArr = ref.slice(READ_START, READ_START + 220).split('');
    readArr[SNP_READ_IDX] = readArr[SNP_READ_IDX] === 'A' ? 'C' : 'A';
    const read = readArr.join('');
    const res = mapReadAndCallVariants(doc('ref', ref), doc('read', read));
    const snp = res.variants.find((v) => v.type === 'SNP');
    expect(snp).toBeDefined();
    expect(snp!.position).toBe(READ_START + SNP_READ_IDX + 1); // reference coordinate
    const idx = mapVariantRefPositionToReadIndex(res, read, snp!.position, snp!.type);
    expect(idx).toBe(SNP_READ_IDX);
    expect(read[idx!]).toBe(snp!.altBase);
  });

  it('mirrors the index back onto the trace for reverse-complemented reads', () => {
    const fwdArr = ref.slice(READ_START, READ_START + 220).split('');
    fwdArr[SNP_READ_IDX] = fwdArr[SNP_READ_IDX] === 'G' ? 'T' : 'G';
    const read = revComp(fwdArr.join(''));
    const res = mapReadAndCallVariants(doc('ref', ref), doc('read', read));
    const snp = res.variants.find((v) => v.type === 'SNP');
    expect(snp).toBeDefined();
    const idx = mapVariantRefPositionToReadIndex(res, read, snp!.position, snp!.type);
    expect(idx).toBe(read.length - 1 - SNP_READ_IDX);
    expect(read[idx!]).toBe(COMP[snp!.altBase]);
  });

  it('returns null for positions outside the alignment', () => {
    const read = ref.slice(READ_START, READ_START + 220);
    const res = mapReadAndCallVariants(doc('ref', ref), doc('read', read));
    expect(mapVariantRefPositionToReadIndex(res, read, 5, 'SNP')).toBeNull();
  });
});

describe('3D viewer intra-chain contacts', () => {
  it('resolves the field names the engine actually returns', () => {
    const pdb = synthesizeAlphaHelicalCaPdbFromProtein(
      'M',
      'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHM',
      40
    );
    const report = alignPdbStructuresKabsch(pdb, pdb);
    const contacts = (report.intraChainContacts ?? []) as unknown as Record<string, number>[];
    expect(contacts.length).toBeGreaterThan(0);
    const atoms = report.atomsA ?? [];
    for (const c of contacts.slice(0, 20)) {
      const r = resolveContactAtomIndices(c as never);
      expect(r).not.toBeNull();
      const [a, b] = r!;
      expect(atoms[a]).toBeDefined();
      expect(atoms[b]).toBeDefined();
      const d = Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y, atoms[a].z - atoms[b].z);
      expect(Math.abs(d - c.distanceAngstrom)).toBeLessThan(0.05);
    }
  });

  it('rejects contacts without any index fields instead of drawing atom 0', () => {
    expect(resolveContactAtomIndices({ distanceAngstrom: 5 })).toBeNull();
    expect(resolveContactAtomIndices({ resA: 3, resB: 9, distanceAngstrom: 5 })).toEqual([2, 8]);
  });
});

describe('Workflow pipeline report freshness', () => {
  const docA = { id: 'a', updatedAt: '1', sequence: 'ACGT' };
  const docB = { id: 'b', updatedAt: '1', sequence: 'ACGTACGT' };
  const reportA = { pipelineId: 'p1', documentId: 'a' };
  const stored = { report: reportA, key: pipelineRunKey(docA, 'p1') };

  it('shows the report only for the document and pipeline it was computed for', () => {
    expect(selectCurrentPipelineReport(stored, pipelineRunKey(docA, 'p1'), false)).toBe(reportA);
    expect(selectCurrentPipelineReport(stored, pipelineRunKey(docB, 'p1'), false)).toBeNull();
    expect(selectCurrentPipelineReport(stored, pipelineRunKey(docA, 'p2'), false)).toBeNull();
    expect(
      selectCurrentPipelineReport(stored, pipelineRunKey({ ...docA, updatedAt: '2' }, 'p1'), false)
    ).toBeNull();
  });

  it('hides the report while a run is in flight', () => {
    expect(selectCurrentPipelineReport(stored, pipelineRunKey(docA, 'p1'), true)).toBeNull();
    expect(selectCurrentPipelineReport(null, pipelineRunKey(docA, 'p1'), false)).toBeNull();
  });
});

describe('BBDuk trimmed-read save and PDB loading guards', () => {
  it('refuses to save when trimming removed every base', () => {
    expect(trimmedReadSaveBlockReason({ trimmedSequence: '', trimmedLengthBp: 0 })).toMatch(/0 bp/);
    expect(trimmedReadSaveBlockReason(null)).not.toBeNull();
    expect(trimmedReadSaveBlockReason({ trimmedSequence: 'ACGT', trimmedLengthBp: 4 })).toBeNull();
  });

  it('reports empty or atom-less PDB files', () => {
    expect(pdbTextLoadProblem('', 0, 'x.pdb')).toMatch(/empty/);
    expect(pdbTextLoadProblem('HEADER', 0, 'x.pdb')).toMatch(/no Cα/);
    expect(pdbTextLoadProblem('ATOM ...', 12, 'x.pdb')).toBeNull();
  });
});

describe('saved-primer binding-site status', () => {
  it('only reports "no binding site" for primers the engine search can check', async () => {
    const { primerSiteStatus } = await import('../core/primerSiteStatus');
    const template = 'ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTC';
    expect(primerSiteStatus('GCCAAGCTTGCATGCC', template, false, 1)).toBe('unique');
    expect(primerSiteStatus('GCCAAGCTTGCATGCC', template, false, 2)).toBe('multiple');
    // Outside the engine scan: short, degenerate, origin-spanning.
    expect(primerSiteStatus('GCCAAGCTTG', template, false, 0)).toBe('not-checked');
    expect(primerSiteStatus('GCCAAGNTTGCATGCC', template, false, 0)).toBe('not-checked');
    // Origin-spanning sites are counted with the engine's rule (exact 3' 5-mer,
    // <= 1 body mismatch), so they are no longer reported as missing.
    const spanning = template.slice(-8) + template.slice(0, 10);
    expect(primerSiteStatus(spanning, template, true, 0)).toBe('unique');
    const oneMismatch = (spanning[0] === 'A' ? 'C' : 'A') + spanning.slice(1);
    expect(primerSiteStatus(oneMismatch, template, true, 0)).toBe('unique');
    // An origin site plus an in-scan site is two sites.
    expect(primerSiteStatus(spanning, template, true, 1)).toBe('multiple');
    // On a linear template the junction does not exist.
    expect(primerSiteStatus(spanning, template, false, 0)).toBe('none');
    // Spaces/dashes are cleaned as the engine does.
    expect(primerSiteStatus('GCCAAGCT TGCATGCC', template, false, 1)).toBe('unique');
    // A genuinely absent ACGT primer.
    expect(primerSiteStatus('TTTTTTTTTTTTTTTTTT', template, true, 0)).toBe('none');
  });
});

describe('GFP reference-variant screening on coding-DNA alignments', () => {
  it('keeps variants whose wild type matches codon N of sequence 1', async () => {
    const { diagnoseMissenseMutation, wildTypeMatchesSequenceOne } = await import('../core/phyloEvoEngine');
    const codon: Record<string, string> = { M: 'ATG', F: 'TTT', S: 'TCT', Y: 'TAT', A: 'GCT' };
    const dna = ('M'.repeat(63) + 'FSY' + 'A'.repeat(20)).split('').map((c) => codon[c]).join('');
    const aligned = [dna, dna, dna];
    expect(wildTypeMatchesSequenceOne(diagnoseMissenseMutation(64, 'F', 'L', aligned))).toBe(true);
    expect(wildTypeMatchesSequenceOne(diagnoseMissenseMutation(66, 'Y', 'H', aligned))).toBe(true);
    expect(wildTypeMatchesSequenceOne(diagnoseMissenseMutation(64, 'Y', 'H', aligned))).toBe(false);
    expect(wildTypeMatchesSequenceOne(diagnoseMissenseMutation(203, 'T', 'Y', aligned))).toBe(false);
  });
});

describe('missense diagnosis on the wasm32 engine', () => {
  it('reports a huge codon position as beyond sequence 1 (no 32-bit wrap)', async () => {
    const { diagnoseMissenseMutation } = await import('../core/phyloEvoEngine');
    const aligned = ['ATGGTGAGCAAGGGCGAGGAG', 'ATGGTGAGCAAGGGCGAGGAG'];
    const r = diagnoseMissenseMutation(1431655767, 'M', 'V', aligned);
    expect(r.rationale).toMatch(/beyond sequence 1/);
    expect(r.homologsCompared).toBe(0);
  });
});
