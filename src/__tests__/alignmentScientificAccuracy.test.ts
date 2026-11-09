// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  alignPairwiseTypeScript,
  buildNeighborJoiningNewick,
  buildUPGMANewick,
  computeDotplotHits,
  runMultipleSequenceAlignment,
} from '../core/bioEngine';
import {
  computeAlignmentConsensusAndIdentity,
  computeNonEndGapPairwiseMetric,
} from '../core/alignmentAnalysis';
import {
  IUPAC_NUCLEOTIDE_MEMBERS,
  meanNucleotideMolecularWeightKda,
  meanPairwiseIdentity,
  translateCodon,
  countDifferences,
  translateAlignedRow,
  residueCellStyle,
  residueSolidColor,
  colorSchemesFor,
  defaultColorScheme,
} from '../core/alignmentViewModel';
import { AlignmentCanvas, type AlignmentCanvasSettings } from '../components/AlignmentCanvas';
import {
  invokeRustBioSync,
  layoutNewickPhylogeneticTreeRust,
} from '../lib/rustBioEngine';
import { AA_GROUP_DEFINITIONS, formatAnnotationTypeLabel, SequenceAlignmentStudio } from '../components/AlignmentAndPhyloStudio';
import type { SequenceDocument } from '../types/bio';

interface NodeFsRead { readFileSync: (p: string | URL, e: string) => string }
interface NodeCrypto { createHash: (alg: string) => { update: (s: string, e: string) => { digest: (e: string) => string } } }
const nodeSpec = (m: string): string => `node:${m}`;
const fs = (await import(/* @vite-ignore */ nodeSpec('fs'))) as NodeFsRead;
const crypto = (await import(/* @vite-ignore */ nodeSpec('crypto'))) as NodeCrypto;

/**
 * The independent computation of the sample statistics: scripts/outside-data/ref_align.py
 * (`--samples`) reads the rows the library ships and records, per sample, `samples` in
 * test-data/reference/align.json (a tracked file, read from the repository).
 */
interface SampleReference {
  rows_sha256: string;
  aligned: boolean;
  ids: string[];
  composition: Record<string, number>;
  residues: number;
  lengths: { mean: number; sd: number; min: number; max: number };
  width?: number;
  pairwise_identity?: { same: number; compared: number; pct: number };
  identical_sites?: { count: number; pct: number };
  identity_matrix?: [number, number, number][];
  codon_usage?: Record<string, number>;
  translated_composition?: Record<string, number>;
}
const SAMPLE_REFERENCE = (JSON.parse(fs.readFileSync(new URL('../../test-data/reference/align.json', import.meta.url), 'utf8')) as {
  samples: Record<string, SampleReference>;
}).samples;
const refOf = (id: string): SampleReference => {
  const r = SAMPLE_REFERENCE[id];
  expect(r, `align.json records ${id}`).toBeDefined();
  return r;
};

describe('Scientific Accuracy: 7 Alignment Sample Documents', () => {
  const alignmentDocs = SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments');

  it('contains exactly the 7 curated alignment documents with proper metadata', () => {
    // 7 since US-01M6TGKH dropped the fictitious-character People set (D0094).
    expect(alignmentDocs).toHaveLength(7);
    const ids = alignmentDocs.map((d) => d.id).sort();
    expect(ids).toEqual([
      'doc-aln-coxii-cds',
      'doc-aln-hiv-env',
      'doc-aln-ig-variable',
      'doc-aln-lysr-family',
      'doc-aln-pairwise-protein',
      'doc-aln-three-kingdoms',
      'doc-aln-transcript-variants',
    ]);
  });

  // 1. COXII CDS (MolBioCraft's MSA of 50 vertebrate mitochondrial COX2 coding sequences)
  it('validates doc-aln-coxii-cds (vertebrate mitochondrial COX2 alignment)', () => {
    const doc = alignmentDocs.find((d) => d.id === 'doc-aln-coxii-cds')!;
    expect(doc).toBeDefined();
    expect(doc.alignmentMeta?.isAligned).toBe(true);
    const ref = refOf(doc.id);
    expect(doc.sequence.length).toBe(ref.width);

    const members = doc.alignmentMeta?.sequences ?? [];
    expect(members).toHaveLength(50);
    // Every member in an aligned document must have the exact same length as the alignment
    for (const m of members) {
      expect(m.sequence.length).toBe(ref.width);
    }

    // Verify consensus & identical sites
    const { consensus, identicalSitesCount } = computeAlignmentConsensusAndIdentity(
      members,
      'Majority',
      true,
      false
    );
    expect(consensus.length).toBe(ref.width);
    // Identical sites: columns every spanning row agrees on, as ref_align.py counts them.
    expect(identicalSitesCount).toBe(ref.identical_sites!.count);
    expect(doc.alignmentMeta?.identicalSitesPct).toBe(ref.identical_sites!.pct);

    // Verify genetic code: Vertebrate Mitochondrial (Code 2)
    expect(doc.alignmentMeta?.geneticCodeLabel).toBe('Vertebrate Mitochondrial');

    // Biological validation: Human COX2 sequence starts with ATG (Met) in vertebrate mitochondria
    const human = members.find((m) => m.name.toLowerCase().includes('human'))!;
    expect(human).toBeDefined();
    const humanUngapped = human.sequence.replace(/-/g, '');
    expect(humanUngapped.startsWith('ATG')).toBe(true);

    // Verify translation with Vertebrate Mitochondrial code
    const firstNonGapIdx = human.sequence.search(/[A-Za-z]/);
    expect(firstNonGapIdx).toBeGreaterThanOrEqual(0);
    const trans = translateAlignedRow(human.sequence, 0, 'Vertebrate Mitochondrial (2)', 1, human.sequence.length, 1);
    expect(trans.aaCoverAtCol[firstNonGapIdx]).toBe('M');
    expect(trans.aaAtCol[firstNonGapIdx + 1]).toBe('M');
  });

  // 2. HIV env (20 unaligned envelope RNA genes)
  it('validates doc-aln-hiv-env (unaligned envelope genes)', () => {
    const doc = alignmentDocs.find((d) => d.id === 'doc-aln-hiv-env')!;
    expect(doc).toBeDefined();
    expect(doc.alignmentMeta?.isAligned).toBe(false);

    const members = doc.alignmentMeta?.sequences ?? [];
    expect(members).toHaveLength(20);

    // Check sequence length range: 2,520 to 2,628 bp
    const lengths = members.map((m) => m.sequence.length);
    const minLen = Math.min(...lengths);
    const maxLen = Math.max(...lengths);
    expect(minLen).toBeGreaterThanOrEqual(2520);
    expect(maxLen).toBeLessThanOrEqual(2630);

    // Total nucleotides should be 51,597
    const totalNt = lengths.reduce((a, b) => a + b, 0);
    expect(totalNt).toBe(51597);

    // Biological validation: Envelope sequences contain HIV-1 subtype C features
    for (const m of members) {
      expect(m.sequence.includes('AUG')).toBe(true); // RNA start
    }
  });

  // 3. Ig variable region (5 unaligned human VH regions)
  it('validates doc-aln-ig-variable (human heavy chain variable domains)', () => {
    const doc = alignmentDocs.find((d) => d.id === 'doc-aln-ig-variable')!;
    expect(doc).toBeDefined();
    expect(doc.alignmentMeta?.isAligned).toBe(false);

    const members = doc.alignmentMeta?.sequences ?? [];
    expect(members).toHaveLength(5);
    const lengths = members.map((m) => m.sequence.length);
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(260);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(320);

    // Total nucleotides: 1,414 bp
    const totalNt = lengths.reduce((a, b) => a + b, 0);
    expect(totalNt).toBe(1414);
  });

  // 4. LysR family (7 unaligned bacterial transcription factor proteins)
  it('validates doc-aln-lysr-family (bacterial HTH transcription factors)', () => {
    const doc = alignmentDocs.find((d) => d.id === 'doc-aln-lysr-family')!;
    expect(doc).toBeDefined();
    expect(doc.alignmentMeta?.isAligned).toBe(false);
    expect(doc.moleculeType).toBe('Protein');

    const members = doc.alignmentMeta?.sequences ?? [];
    expect(members).toHaveLength(7);
    const lengths = members.map((m) => m.sequence.length);
    expect(Math.min(...lengths)).toBe(306);
    expect(Math.max(...lengths)).toBe(353);

    // All sequences are valid amino acids
    for (const m of members) {
      expect(m.sequence).toMatch(/^[ACDEFGHIKLMNPQRSTVWY]+$/);
    }
  });

  // 5. Pairwise protein (Kiwifruit 2ACT vs Papaya 1BP4, 221 aa)
  it('validates doc-aln-pairwise-protein (actinidin 2ACT vs papain 1BP4)', () => {
    const doc = alignmentDocs.find((d) => d.id === 'doc-aln-pairwise-protein')!;
    expect(doc).toBeDefined();
    expect(doc.alignmentMeta?.isAligned).toBe(true);
    expect(doc.moleculeType).toBe('Protein');
    expect(doc.sequence.length).toBe(221);

    const members = doc.alignmentMeta?.sequences ?? [];
    expect(members).toHaveLength(2);
    expect(members[0].sequence.length).toBe(221);
    expect(members[1].sequence.length).toBe(221);

    // Pairwise identity: MolBioCraft's value on its alignment of PDB 2ACT chain A (which records
    // Cys25 as X, US-01M6TGKH, D0094) and 1BP4 chain A, as ref_align.py computes it.
    const pwId = meanPairwiseIdentity([members[0].sequence, members[1].sequence]);
    expect(pwId).toBe(refOf(doc.id).pairwise_identity!.pct);

    // Verify catalytic Cys is aligned in both proteins
    // In papain (1BP4), Cys25 is the catalytic nucleophile
    const act = members.find((m) => m.name.includes('Actinidin') || m.name.includes('2ACT'))!;
    const pap = members.find((m) => m.name.includes('Papain') || m.name.includes('1BP4'))!;
    expect(act).toBeDefined();
    expect(pap).toBeDefined();

    // Check for conserved active site cysteine motif CGSCWAF / CGGCWAF; 2ACT chain A records the
    // actinidin Cys25 as an unknown residue (X)
    expect(act.sequence).toContain('CGGXWA');
    expect(pap.sequence).toContain('CGSCWA');
  });

  // 6. (The fictitious-character People set is dropped, US-01M6TGKH, D0094: no sample is made up.)

  // 7. Three Kingdoms (35 aligned Alanyl-tRNA synthetase proteins, 1,156 aa)
  it('validates doc-aln-three-kingdoms (universal AlaRS across 3 domains of life)', () => {
    const doc = alignmentDocs.find((d) => d.id === 'doc-aln-three-kingdoms')!;
    expect(doc).toBeDefined();
    expect(doc.alignmentMeta?.isAligned).toBe(true);
    expect(doc.moleculeType).toBe('Protein');
    const ref = refOf(doc.id);
    expect(doc.sequence.length).toBe(ref.width);

    const members = doc.alignmentMeta?.sequences ?? [];
    expect(members).toHaveLength(35);
    for (const m of members) {
      expect(m.sequence.length).toBe(ref.width);
    }

    // Deep evolutionary divergence: identical over compared positions, pooled over all pairs
    // inside each pair's overlap (end gaps excluded), the value stored in the metadata.
    const pwId = meanPairwiseIdentity(members.map((m) => m.sequence));
    expect(pwId).toBe(ref.pairwise_identity!.pct);
    expect(pwId).toBeLessThan(50);
    expect(doc.alignmentMeta?.pairwiseIdentityPct).toBe(ref.pairwise_identity!.pct);
  });

  // 8. Transcript variants (MolBioCraft's MSA of 4 MAPK10 transcript variants)
  it('validates doc-aln-transcript-variants (alternative splicing isoforms of MAPK10)', () => {
    const doc = alignmentDocs.find((d) => d.id === 'doc-aln-transcript-variants')!;
    expect(doc).toBeDefined();
    expect(doc.alignmentMeta?.isAligned).toBe(true);
    const ref = refOf(doc.id);
    expect(doc.sequence.length).toBe(ref.width);

    const members = doc.alignmentMeta?.sequences ?? [];
    expect(members).toHaveLength(4);
    for (const m of members) {
      expect(m.sequence.length).toBe(ref.width);
    }

    // Each pair's identity over its overlap (end gaps not compared), as ref_align.py's matrix has it.
    const byPair = new Map((ref.identity_matrix ?? []).map(([i, j, v]) => [`${i},${j}`, v]));
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const id = computeNonEndGapPairwiseMetric(members[i].sequence, members[j].sequence, 'identity');
        expect(id, `${members[i].name} / ${members[j].name}`).toBeCloseTo(byPair.get(`${i},${j}`)!, 9);
      }
    }

    // The pooled statistic does not compare the end gaps of either sequence, so truncated exons
    // are not counted as differences.
    const pwId = meanPairwiseIdentity(members.map((m) => m.sequence));
    expect(pwId).toBe(ref.pairwise_identity!.pct);
  });
});

describe('sample alignment statistics', () => {
  // Each aligned sample stores MolBioCraft's "% Pairwise Identity" and "% Identical Sites" of its
  // rows; ref_align.py computes both independently (PRD F12). Contigs are excluded here: their
  // statistics mask the "Trimmed" regions, which the alignment studio does separately.
  const docs = SAMPLE_LIBRARY.filter(
    (d) =>
      d.folder === 'Alignments' &&
      d.documentKind !== 'contig' &&
      d.alignmentMeta?.pairwiseIdentityPct !== undefined &&
      d.alignmentMeta?.identicalSitesPct !== undefined
  );

  it('covers every aligned sample', () => {
    expect(docs.map((d) => d.id).sort()).toEqual(
      SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments' && d.alignmentMeta?.isAligned).map((d) => d.id).sort()
    );
    expect(docs.length).toBe(4);
  });

  for (const doc of docs) {
    it(`${doc.name}: pairwise identity and identical sites match the independent computation`, () => {
      const ref = refOf(doc.id);
      const rows = (doc.alignmentMeta?.sequences ?? []).map((m) => ({ sequence: m.sequence }));
      expect(sha256Rows(doc), `align.json describes ${doc.id}'s rows`).toBe(ref.rows_sha256);
      const pw = meanPairwiseIdentity(rows.map((r) => r.sequence));
      expect(pw, 'MolBioCraft = ref_align.py').toBe(ref.pairwise_identity!.pct);
      expect(doc.alignmentMeta!.pairwiseIdentityPct, 'stored').toBe(ref.pairwise_identity!.pct);
      expect(doc.docMetadata?.['% Pairwise Identity'], 'stored').toBe(`${ref.pairwise_identity!.pct.toFixed(1)}%`);
      const { identicalSitesCount } = computeAlignmentConsensusAndIdentity(
        rows,
        'majority',
        false,
        doc.moleculeType === 'Protein'
      );
      expect(identicalSitesCount, 'MolBioCraft = ref_align.py').toBe(ref.identical_sites!.count);
      const width = Math.max(...rows.map((r) => r.sequence.length));
      expect(width).toBe(ref.width);
      expect(Math.round((1000 * identicalSitesCount) / width) / 10).toBe(ref.identical_sites!.pct);
      expect(doc.alignmentMeta!.identicalSitesPct, 'stored').toBe(ref.identical_sites!.pct);
      expect(doc.docMetadata?.['% Identical Sites'], 'stored').toBe(`${ref.identical_sites!.pct.toFixed(1)}%`);
    });
  }
});

/** SHA-256 of one "id<TAB>row" line per member, in order, as ref_align.py records `rows_sha256`. */
function sha256Rows(doc: SequenceDocument): string {
  const text = (doc.alignmentMeta?.sequences ?? []).map((m) => `${m.id}\t${m.sequence}`).join('\n');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('Scientific Accuracy: Alignment Algorithms and Mathematical Rigor', () => {
  // Gotoh Affine Gap Needleman-Wunsch & Smith-Waterman
  it('computes exact affine-gap scores under Needleman-Wunsch Gotoh', () => {
    const s1 = 'ACGTACGTACGTACGT';
    const s2 = 'ACGTACGTACGTACGT';
    const res = alignPairwiseTypeScript(s1, s2, false, 2, -1, -4, -1, 'DNA');
    // 16 matches * 2 = 32, 0 gaps, 0 mismatches, 100% identity
    expect(res.score).toBe(32);
    expect(res.matches).toBe(16);
    expect(res.mismatches).toBe(0);
    expect(res.gaps).toBe(0);
    expect(res.identityPct).toBe(100);
    expect(res.alignedSeq1).toBe(s1);
    expect(res.alignedSeq2).toBe(s2);
  });

  it('correctly handles affine gap opening vs extension penalties', () => {
    // Sequence with a 3-bp deletion
    const s1 = 'ACGTNNNACGT';
    const s2 = 'ACGTACGT';
    // Match=2, Mismatch=-2, GapOpen=-4, GapExtend=-1
    const res = alignPairwiseTypeScript(s1, s2, false, 2, -2, -4, -1, 'DNA');
    expect(res.matches).toBe(8);
    expect(res.gaps).toBe(3);
    // Under NCBI BLAST / rust-bio affine convention: cost(k) = open + k * extend
    // Score should be 8 * 2 + (-4 + 3 * -1) = 16 - 7 = 9
    expect(res.score).toBe(9);
    expect(res.alignedSeq1.length).toBe(res.alignedSeq2.length);
  });

  it('correctly scores protein alignments using BLOSUM62 matrix', () => {
    const p1 = 'MVSKGEELFTG';
    const p2 = 'MVSKGEELFTG';
    const res = alignPairwiseTypeScript(p1, p2, false, 2, -1, -11, -1, 'Protein');
    expect(res.matches).toBe(11);
    expect(res.identityPct).toBe(100);
    expect(res.score).toBeGreaterThan(50); // sum of diagonal BLOSUM62 values
  });

  it('evaluates conservative vs radical amino acid substitutions in midline', () => {
    // I (Ile) vs L (Leu) is conservative (BLOSUM62 score +2 -> ':')
    // W (Trp) vs D (Asp) is radical (BLOSUM62 score -4 -> '.')
    const p1 = 'MIW';
    const p2 = 'MLD';
    const res = alignPairwiseTypeScript(p1, p2, false, 2, -1, -11, -1, 'Protein');
    expect(res.midline[0]).toBe('|'); // M == M
    expect(res.midline[1]).toBe(':'); // I ~ L (conservative)
    expect(res.midline[2]).toBe('.'); // W != D (radical)
  });

  // Multiple Sequence Alignment Center-Star Engine
  it('executes center-star profile MSA with zero residue loss and strict column alignment', () => {
    const input = [
      { id: 'seq1', name: 'Seq 1', sequence: 'ATGCATGC' },
      { id: 'seq2', name: 'Seq 2', sequence: 'ATGCAATGC' }, // 1 insertion
      { id: 'seq3', name: 'Seq 3', sequence: 'ATGC--TGC'.replace(/-/g, '') }, // 2 deletion
    ];
    const msa = runMultipleSequenceAlignment(input);
    expect(msa.rows).toHaveLength(3);

    // All rows must have identical column length
    const colLen = msa.rows[0].alignedSeq.length;
    for (const r of msa.rows) {
      expect(r.alignedSeq.length).toBe(colLen);
      // Stripping gaps must perfectly restore the original unaligned sequence
      const orig = input.find((i) => i.id === r.id)!;
      expect(r.alignedSeq.replace(/-/g, '')).toBe(orig.sequence);
    }

    // Conservation values must be between 0.0 and 1.0
    for (const c of msa.conservation) {
      expect(c).toBeGreaterThanOrEqual(0.0);
      expect(c).toBeLessThanOrEqual(1.0);
    }

    // Shannon entropy must be >= 0.0 bits if present
    if (msa.shannonEntropyBits) {
      for (const h of msa.shannonEntropyBits) {
        expect(h).toBeGreaterThanOrEqual(0.0);
        expect(Number.isNaN(h)).toBe(false);
      }
    }
  });

  // Guide Tree Building: Neighbor-Joining (Saitou-Nei) & UPGMA
  it('constructs valid Newick guide trees with Saitou-Nei Neighbor-Joining', () => {
    const names = ['Human', 'Chimpanzee', 'Gorilla', 'Mouse'];
    // Sequences with known phylogenetic distances: Human & Chimp are closest
    const seqs = [
      'ATGCGATCGATCGATC',
      'ATGCGATCGATCGATT', // 1 diff from Human
      'ATGCGATCGATCGCTT', // 2 diffs from Human
      'TTGCGATCGTTCGCTT', // 4 diffs from Human
    ];
    const njNewick = buildNeighborJoiningNewick(names, seqs);
    expect(njNewick.endsWith(';')).toBe(true);
    for (const name of names) {
      expect(njNewick).toContain(name);
    }

    // UPGMA tree
    const upgmaNewick = buildUPGMANewick(names, seqs);
    expect(upgmaNewick.endsWith(';')).toBe(true);
    for (const name of names) {
      expect(upgmaNewick).toContain(name);
    }
  });

  // Dotplot computation
  it('computes dotplot hits along main diagonal for self-alignment and reverse strand', () => {
    const seq = 'ATGCGATCGATC';
    const hits = computeDotplotHits(seq, seq, 5, 5);
    expect(hits.length).toBeGreaterThan(0);
    // For identical self-alignment, there must be hits where x == y
    const onDiag = hits.some((h) => h.x === h.y);
    expect(onDiag).toBe(true);
  });

  // Substitution Models (JC69, K2P)
  it('evaluates non-end-gap distance metrics (p-distance, JC69, K2P)', () => {
    const s1 = '---ACGTACGT---';
    const s2 = '---ACGAACGT---'; // 1 transition (T -> A is transversion; G -> A is transition)
    // Between pos 3 and 10 (length 8): pos 6 has T vs A (transversion)
    const pDist = computeNonEndGapPairwiseMetric(s1, s2, 'p-dist');
    expect(pDist).toBeCloseTo(1 / 8, 3);

    const jc = computeNonEndGapPairwiseMetric(s1, s2, 'jc69');
    expect(jc).toBeGreaterThan(0);
    expect(Number.isFinite(jc)).toBe(true);

    const k2p = computeNonEndGapPairwiseMetric(s1, s2, 'k2p');
    expect(k2p).toBeGreaterThan(0);
    expect(Number.isFinite(k2p)).toBe(true);
  });

  // Local Alignment: Smith-Waterman Gotoh
  it('isolates local High-Scoring Pairs (HSPs) without penalty from unrelated flanking sequences', () => {
    const motif = 'ACGTACGTACGT';
    const s1 = 'TTTTTTTTTT' + motif + 'AAAAAAAAAA';
    const s2 = 'GGGGGGGGGG' + motif + 'CCCCCCCCCC';
    const local = alignPairwiseTypeScript(s1, s2, true, 2, -3, -5, -2, 'DNA');
    expect(local.score).toBe(motif.length * 2); // 24
    expect(local.matches).toBe(motif.length);
    expect(local.mismatches).toBe(0);
    expect(local.gaps).toBe(0);
    expect(local.identityPct).toBe(100);
    expect(local.alignedSeq1).toBe(motif);
    expect(local.alignedSeq2).toBe(motif);
  });

  // Semiglobal Alignment: Free-End Gaps
  it('executes semiglobal alignment with unpenalized terminal overhangs', () => {
    const target = 'TTTTACGTACGTTTTT';
    const query = 'ACGTACGT';
    const semi = invokeRustBioSync<any>('align_pairwise', {
      seq1: target,
      seq2: query,
      mode: 'semiglobal',
      matchScore: 2,
      mismatchPenalty: -2,
      gapOpen: -5,
      gapExtend: -1,
    });
    expect(semi.matches).toBe(query.length);
    expect(semi.mismatches).toBe(0);
    expect(semi.alignedSeq1.length).toBe(semi.alignedSeq2.length);
    // Semiglobal: the query is placed inside the target with unpenalised terminal gaps, so the
    // aligned query is the 8-mer flanked by gaps and the whole target is kept. (A global
    // alignment would instead be charged for both overhangs.)
    expect(semi.alignedSeq1).toBe(target);
    expect(semi.alignedSeq2).toBe('----ACGTACGT----');
    expect(semi.alignmentMode ?? semi.algorithm).toMatch(/semi/i);
  });

  // Alignment of unaligned real sample dataset: LysR family (7 bacterial proteins)
  it('aligns the unaligned LysR family sample dataset preserving 100% of amino acids', () => {
    const lysrDoc = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-lysr-family')!;
    const members = lysrDoc.alignmentMeta?.sequences ?? [];
    expect(members).toHaveLength(7);

    const inputDocs = members.map((m) => ({
      id: m.id,
      name: m.name,
      sequence: m.sequence,
    }));
    const msaResult = runMultipleSequenceAlignment(inputDocs);
    expect(msaResult.rows).toHaveLength(7);

    // Every row must have identical length
    const colCount = msaResult.rows[0].alignedSeq.length;
    expect(colCount).toBeGreaterThanOrEqual(353); // max sequence length
    for (const r of msaResult.rows) {
      expect(r.alignedSeq.length).toBe(colCount);
      const original = members.find((m) => m.id === r.id)!;
      // Zero amino acids lost or mutated during alignment
      expect(r.alignedSeq.replace(/-/g, '')).toBe(original.sequence);
    }

    // Guide tree generated with valid Newick format
    expect(msaResult.newickTree.endsWith(';')).toBe(true);
    for (const m of members) {
      expect(msaResult.newickTree).toContain(m.name.replace(/[^a-zA-Z0-9_.-]/g, '_'));
    }
  });

  // Karlin-Altschul BLAST search & E-value statistics
  it('computes Karlin-Altschul bit-score and E-value scaling in local BLAST search', () => {
    const pET28 = SAMPLE_LIBRARY[0];
    const query = pET28.sequence.slice(100, 300); // 200 bp query
    const blastDocs = SAMPLE_LIBRARY.slice(0, 10).map((d) => ({
      id: d.id,
      name: d.name,
      sequence: d.sequence.slice(0, 5000), // bounded slice for test speed
    }));

    const hits = invokeRustBioSync<any[]>('run_local_blast', {
      querySeq: query,
      docs: blastDocs,
      program: 'blastn',
      databaseName: 'Test Benchmark DB',
    });
    expect(hits.length).toBeGreaterThan(0);

    // Top hit must be pET28 (self-match)
    const topHit = hits[0];
    expect(topHit.id).toBe(`blast-hit-${pET28.id}`);
    expect(topHit.identityPct).toBe(100);
    // Exact 200 bp match must have highly significant E-value (0.0 or << 1e-10)
    const eNum = parseFloat(topHit.eValue);
    expect(eNum).toBeLessThan(1e-10);
    expect(topHit.bitScore).toBeGreaterThan(200);
  });

  // Bit-parallel Myers approximate matching
  it('executes bit-parallel Myers approximate matching with edit distance bounding', () => {
    const seq = 'AAAAACGTACGTGGGGG';
    const pattern = 'ACGTTCGT'; // 1 mismatch at pos 4 (T instead of A)
    const hits = invokeRustBioSync<any[]>('search_approximate_myers', {
      seq,
      pattern,
      maxEditDist: 1,
      searchRevcomp: false,
      maxHits: 10,
    });
    expect(hits.length).toBe(1);
    expect(hits[0].editDistance).toBe(1);
    expect(hits[0].strand).toBe(1);
  });
});

describe('Accurate Scientific Visualizations & Layouts', () => {
  const alignmentDocs = SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments');

  it('renders authentic phylogenetic tree layouts in phylogram, cladogram, and radial modes', () => {
    const newick = '((Human:0.0120,Chimpanzee:0.0140):0.0350,(Mouse:0.0820,Rat:0.0780):0.0450);';
    
    // Phylogram: branch lengths proportional to evolutionary distances
    const phylogram = layoutNewickPhylogeneticTreeRust(newick, 'phylogram', 800, 300);
    expect(phylogram.tipCount).toBe(4);
    expect(phylogram.totalNodes).toBe(7); // 4 tips + 3 internal/root
    expect(phylogram.maxRootToTipDistance).toBeGreaterThan(0.04);
    expect(phylogram.svgPaths.length).toBeGreaterThan(0);
    expect(phylogram.scaleBar).not.toBeNull();
    expect(phylogram.scaleBar?.label).toContain('subst./site');

    // Cladogram: branching topology with uniform step distances
    const cladogram = layoutNewickPhylogeneticTreeRust(newick, 'cladogram', 800, 300);
    expect(cladogram.tipCount).toBe(4);
    expect(cladogram.svgPaths.length).toBeGreaterThan(0);

    // Radial: circular polar tree projection
    const radial = layoutNewickPhylogeneticTreeRust(newick, 'radial', 500, 500);
    expect(radial.tipCount).toBe(4);
    expect(radial.svgPaths.length).toBeGreaterThan(0);
  });

  it.each([
    'doc-aln-coxii-cds',
    'doc-aln-hiv-env',
    'doc-aln-ig-variable',
    'doc-aln-lysr-family',
    'doc-aln-pairwise-protein',
    'doc-aln-three-kingdoms',
    'doc-aln-transcript-variants',
  ])('renders SequenceAlignmentStudio accurately for sample %s', (sampleId) => {
    const sampleDoc = alignmentDocs.find((d) => d.id === sampleId)!;
    expect(sampleDoc).toBeDefined();

    const html = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, {
        activeDoc: sampleDoc,
        documents: SAMPLE_LIBRARY,
      })
    );
    expect(html.length).toBeGreaterThan(1000);
    // The grid draws the members' rows (the first two are always in its first window), and the
    // Lengths Graph analysis is on the inspector rail.
    expect(html).toContain('mbc-aln-canvas-pane');
    const members = sampleDoc.alignmentMeta?.sequences ?? [];
    expect(members.length).toBeGreaterThanOrEqual(2);
    for (const member of members.slice(0, 2)) {
      expect(html).toContain(`class="mbc-aln-name `);
      expect(html).toContain(`title="${member.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}`);
    }
    const rail = html.slice(html.indexOf('aria-label="Alignment Inspector Tabs"'));
    expect(rail).toMatch(/<button[^>]*role="tab"[^>]*aria-label="Lengths Graph"/);
  });

  it('provides scientifically accurate biochemical residue color palettes', () => {
    // Clustal scheme (Clustal X convention):
    // Cys is orange-pink (#f08080) for disulfide bonding
    expect(residueSolidColor('C', { scheme: 'Clustal', isProtein: true })).toBe('#f08080');

    // Basic Lys (K) / Arg (R) are red (#f01505)
    expect(residueSolidColor('K', { scheme: 'Clustal', isProtein: true })).toBe('#f01505');

    // Acidic Asp (D) / Glu (E) are magenta (#c048c0)
    expect(residueSolidColor('D', { scheme: 'Clustal', isProtein: true })).toBe('#c048c0');

    // Cell styling has proper tint
    const cysStyle = residueCellStyle('C', { scheme: 'Clustal', isProtein: true }, false);
    expect(cysStyle.background.startsWith('#f08080')).toBe(true);

    // Kyte-Doolittle Hydrophobicity palette:
    // Hydrophobic Ile (I, +4.5) has high hydrophobicity warm tone
    // Hydrophilic Arg (R, -4.5) has low hydrophobicity cool tone
    const ileColor = residueSolidColor('I', { scheme: 'Hydrophobicity', isProtein: true });
    const argColor = residueSolidColor('R', { scheme: 'Hydrophobicity', isProtein: true });
    expect(ileColor).not.toBe(argColor);
  });
});

describe('sample alignment statistics match the independent computation', () => {
  // The values pinned here are ref_align.py's (align.json `samples`), computed from the rows the
  // library holds; the first test checks that they describe exactly those rows.
  const docByName = (name: string) =>
    SAMPLE_LIBRARY.find((d) => d.folder === 'Alignments' && d.name === name)!;
  const memberSeqs = (name: string) =>
    (docByName(name).alignmentMeta?.sequences ?? []).map((m) => m.sequence);

  it('align.json describes every sample alignment as the library holds it', () => {
    const samples = SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments');
    expect(Object.keys(SAMPLE_REFERENCE).sort()).toEqual(samples.map((d) => d.id).sort());
    for (const doc of samples) {
      const ref = refOf(doc.id);
      expect(ref.ids, `${doc.id} members`).toEqual((doc.alignmentMeta?.sequences ?? []).map((m) => m.id));
      expect(sha256Rows(doc), `${doc.id} rows`).toBe(ref.rows_sha256);
      expect(ref.aligned, `${doc.id} aligned`).toBe(doc.alignmentMeta?.isAligned === true);
    }
  });

  it('reproduces every sample alignment\'s residue composition', () => {
    for (const doc of SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments')) {
      const { counts, total } = residueCounts(memberSeqs(doc.name));
      const ref = refOf(doc.id);
      expect(total, doc.name).toBe(ref.residues);
      expect(Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))), doc.name).toEqual(ref.composition);
    }
  });
  const residueCounts = (seqs: readonly string[]) => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const seq of seqs) {
      for (const raw of seq.toUpperCase()) {
        if (raw === '-') continue;
        counts.set(raw, (counts.get(raw) ?? 0) + 1);
        total++;
      }
    }
    return { counts, total };
  };
  const groupCount = (counts: Map<string, number>, label: string) => {
    const group = AA_GROUP_DEFINITIONS.find((g) => g.label === label)!;
    expect(group).toBeDefined();
    return group.chars.reduce((sum, ch) => sum + (counts.get(ch) ?? 0), 0);
  };

  // COXII CDS "Nucleotide Statistics": lengths and base composition as ref_align.py computes them.
  it('reproduces the COXII CDS nucleotide statistics exactly', () => {
    const seqs = memberSeqs('COXII CDS');
    expect(seqs).toHaveLength(50);
    const ref = refOf('doc-aln-coxii-cds');

    const ungapped = seqs.map((s) => s.replace(/-/g, '').length);
    const mean = ungapped.reduce((a, b) => a + b, 0) / ungapped.length;
    const variance =
      ungapped.reduce((s, v) => s + (v - mean) ** 2, 0) / (ungapped.length - 1);
    expect(mean).toBeCloseTo(ref.lengths.mean, 9);
    expect(Math.sqrt(variance)).toBeCloseTo(ref.lengths.sd, 9);
    expect(Math.min(...ungapped)).toBe(ref.lengths.min);
    expect(Math.max(...ungapped)).toBe(ref.lengths.max);

    const { counts, total } = residueCounts(seqs);
    expect(total).toBe(ref.residues);
    for (const base of ['A', 'C', 'G', 'T', 'W', 'K']) expect(counts.get(base), base).toBe(ref.composition[base]);
    const gc = (counts.get('G') ?? 0) + (counts.get('C') ?? 0);
    expect(gc).toBe(ref.composition.G + ref.composition.C);

    // Molecular weight must be composition-weighted; a flat mass per base would report 210.892.
    // (The composition is unchanged by the realignment, so the weight is too.)
    const mw = meanNucleotideMolecularWeightKda(seqs);
    expect(mw.ssKda.toFixed(3)).toBe('210.326');
    expect(mw.dsKda.toFixed(3)).toBe('423.824');
  });

  // BG-01M6XST3: the 2.07 / 4.78 Da difference between MolBioCraft's 210.326 / 423.824 kDa COXII
  // figure and Biopython 1.88's water-free 210.324 / 423.819 kDa figure is the rounding of the
  // two-decimal residue masses in alignmentViewModel.ts, and closes to 0.000000 Da when those
  // masses are replaced by Biopython's exact ones (IUPACData.unambiguous_dna_weights minus 18.0153).
  it('accounts for the COXII CDS molecular-weight difference from Biopython by residue mass rounding', () => {
    const seqs = memberSeqs('COXII CDS');
    expect(seqs).toHaveLength(50);

    // Biopython 1.88 IUPACData.unambiguous_dna_weights (dNMP, Da) and water removed per bond (Da).
    const BIOPYTHON_WATER_DA = 18.0153;
    const BIOPYTHON_DNMP_DA: Record<'A' | 'C' | 'G' | 'T', number> = {
      A: 331.2218,
      C: 307.1971,
      G: 347.2212,
      T: 322.2085,
    };
    const COMPLEMENT_BASE: Record<'A' | 'C' | 'G' | 'T', 'A' | 'C' | 'G' | 'T'> = {
      A: 'T',
      C: 'G',
      G: 'C',
      T: 'A',
    };
    const biopythonResidueDa: Record<'A' | 'C' | 'G' | 'T', number> = {
      A: BIOPYTHON_DNMP_DA.A - BIOPYTHON_WATER_DA,
      C: BIOPYTHON_DNMP_DA.C - BIOPYTHON_WATER_DA,
      G: BIOPYTHON_DNMP_DA.G - BIOPYTHON_WATER_DA,
      T: BIOPYTHON_DNMP_DA.T - BIOPYTHON_WATER_DA,
    };

    // MolBioCraft's two-decimal residue masses as meanNucleotideMolecularWeightKda applies them.
    const mbcResidueDa: Record<'A' | 'C' | 'G' | 'T', number> = {
      A: meanNucleotideMolecularWeightKda(['A']).ssKda * 1000,
      C: meanNucleotideMolecularWeightKda(['C']).ssKda * 1000,
      G: meanNucleotideMolecularWeightKda(['G']).ssKda * 1000,
      T: meanNucleotideMolecularWeightKda(['T']).ssKda * 1000,
    };
    expect(mbcResidueDa).toEqual({ A: 313.21, C: 289.18, G: 329.21, T: 304.2 });

    // Biopython's molecular_weight refuses W and K, so each row is averaged over its unambiguous
    // DNA readings (1 reading for the 49 unambiguous rows, 4 readings for the row carrying W and K).
    const unambiguousReadings = (ungapped: string): string[] => {
      let readings = [''];
      for (const raw of ungapped.toUpperCase()) {
        const members = IUPAC_NUCLEOTIDE_MEMBERS[raw];
        if (!members) continue;
        readings = readings.flatMap((prefix) => [...members].map((m) => prefix + m));
      }
      return readings;
    };
    let bioWithWaterSsDa = 0;
    let bioWithWaterDsDa = 0;
    for (const seq of seqs) {
      const ungapped = seq.replace(/-/g, '');
      const readings = unambiguousReadings(ungapped);
      let rowSs = 0;
      let rowDs = 0;
      for (const reading of readings) {
        const bondsWater = (reading.length - 1) * BIOPYTHON_WATER_DA;
        let ss = -bondsWater;
        let comp = -bondsWater;
        for (const ch of reading as Iterable<'A' | 'C' | 'G' | 'T'>) {
          ss += BIOPYTHON_DNMP_DA[ch];
          comp += BIOPYTHON_DNMP_DA[COMPLEMENT_BASE[ch]];
        }
        rowSs += ss;
        rowDs += ss + comp;
      }
      bioWithWaterSsDa += rowSs / readings.length;
      bioWithWaterDsDa += rowDs / readings.length;
    }
    bioWithWaterSsDa /= seqs.length;
    bioWithWaterDsDa /= seqs.length;

    const bioWaterFreeSsDa = bioWithWaterSsDa - BIOPYTHON_WATER_DA;
    const bioWaterFreeDsDa = bioWithWaterDsDa - 2 * BIOPYTHON_WATER_DA;
    expect((bioWithWaterSsDa / 1000).toFixed(3)).toBe('210.342');
    expect((bioWithWaterDsDa / 1000).toFixed(3)).toBe('423.855');
    expect((bioWaterFreeSsDa / 1000).toFixed(3)).toBe('210.324');
    expect((bioWaterFreeDsDa / 1000).toFixed(3)).toBe('423.819');

    // MolBioCraft's formula with its two-decimal residue masses vs Biopython's exact residue masses.
    const mw = meanNucleotideMolecularWeightKda(seqs);
    expect(mw.ssKda.toFixed(3)).toBe('210.326');
    expect(mw.dsKda.toFixed(3)).toBe('423.824');
    expect((mw.ssKda * 1000 - bioWaterFreeSsDa).toFixed(2)).toBe('2.07');
    expect((mw.dsKda * 1000 - bioWaterFreeDsDa).toFixed(2)).toBe('4.78');

    const counts = { A: 0, C: 0, G: 0, T: 0 };
    for (const seq of seqs) {
      for (const raw of seq) {
        const members = IUPAC_NUCLEOTIDE_MEMBERS[raw.toUpperCase()];
        if (!members) continue;
        for (const m of members) counts[m as 'A' | 'C' | 'G' | 'T'] += 1 / members.length;
      }
    }
    const strandWith = (table: Record<'A' | 'C' | 'G' | 'T', number>, a: number, c: number, g: number, t: number) =>
      (a * table.A + c * table.C + g * table.G + t * table.T) / seqs.length;
    const exactSsDa = strandWith(biopythonResidueDa, counts.A, counts.C, counts.G, counts.T);
    const exactCompDa = strandWith(biopythonResidueDa, counts.T, counts.G, counts.C, counts.A);
    const exactDsDa = exactSsDa + exactCompDa;
    expect(Math.abs(exactSsDa - bioWaterFreeSsDa).toFixed(6)).toBe('0.000000');
    expect(Math.abs(exactDsDa - bioWaterFreeDsDa).toFixed(6)).toBe('0.000000');

    // The doc comment on meanNucleotideMolecularWeightKda states this rounding account and drops the
    // unverified third-party claim.
    const source = fs.readFileSync(new URL('../core/alignmentViewModel.ts', import.meta.url), 'utf8');
    const fnAt = source.indexOf('export function meanNucleotideMolecularWeightKda');
    const docStart = source.lastIndexOf('/**', fnAt);
    expect(fnAt).toBeGreaterThan(0);
    const doc = source.slice(docStart, fnAt);
    expect(doc).not.toContain('reference value recorded from third-party software output');
    expect(doc).toContain('rounding of the two-decimal residue masses');
    expect(doc).toContain('2.07 / 4.78 Da');
    expect(doc).toContain('0.000000');
  });

  // LysR family protein statistics: residue counts as ref_align.py computes them, and the group
  // totals re-derived by hand from that composition and the published group sets (US-01M6TDGW).
  it('reproduces the LysR family amino-acid statistics and group totals exactly', () => {
    const { counts, total } = residueCounts(memberSeqs('LysR family'));
    const ref = refOf('doc-aln-lysr-family');
    expect(total).toBe(ref.residues);
    expect(Object.keys(ref.composition).length).toBe(20);
    for (const [residue, count] of Object.entries(ref.composition)) {
      expect(counts.get(residue), `residue ${residue}`).toBe(count);
    }
    expect(groupCount(counts, 'Acidic')).toBe(267);
    expect(groupCount(counts, 'Basic')).toBe(318);
    expect(groupCount(counts, 'Charged')).toBe(585);
    // N 57 + Q 134 + S 132 + T 101 + Y 45
    expect(groupCount(counts, 'Polar Uncharged')).toBe(469);
    // A 215 + C 34 + F 75 + I 112 + L 284 + M 40 + V 157 + W 43
    expect(groupCount(counts, 'Hydrophobic')).toBe(960);
    // A 215 + G 124 + P 130 + R 169
    expect(groupCount(counts, 'GC-rich')).toBe(638);
    // F 75 + I 112 + K 69 + M 40 + N 57 + Y 45
    expect(groupCount(counts, 'AT-rich')).toBe(398);
  });

  // HIV env translated statistics: the standard-code translation, as Biopython's Seq.translate
  // gives it in ref_align.py, and the group totals re-derived by hand from that composition and the
  // published group sets (US-01M6TDGW).
  it('reproduces the HIV env translated amino-acid statistics exactly', () => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const seq of memberSeqs('HIV env')) {
      const clean = seq.replace(/-/g, '').toUpperCase().replace(/U/g, 'T');
      for (let i = 0; i + 2 < clean.length; i += 3) {
        const aa = translateCodon(clean.slice(i, i + 3), 'Standard');
        if (!aa) continue;
        counts.set(aa, (counts.get(aa) ?? 0) + 1);
        total++;
      }
    }
    const ref = refOf('doc-aln-hiv-env').translated_composition!;
    expect(total).toBe(Object.values(ref).reduce((a, b) => a + b, 0));
    expect(Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)))).toEqual(ref);
    // D 663 + E 933
    expect(groupCount(counts, 'Acidic')).toBe(1596);
    // H 233 + K 854 + R 1025
    expect(groupCount(counts, 'Basic')).toBe(2112);
    expect(groupCount(counts, 'Charged')).toBe(3708);
    // N 1256 + Q 801 + S 1044 + T 1198 + Y 462
    expect(groupCount(counts, 'Polar Uncharged')).toBe(4761);
    // A 945 + C 472 + F 524 + I 1441 + L 1644 + M 327 + V 1036 + W 548
    expect(groupCount(counts, 'Hydrophobic')).toBe(6937);
    // A 945 + G 1192 + P 581 + R 1025
    expect(groupCount(counts, 'GC-rich')).toBe(3743);
    // F 524 + I 1441 + K 854 + M 327 + N 1256 + Y 462
    expect(groupCount(counts, 'AT-rich')).toBe(4864);
  });

  // The Distances tab's "% Identity" matrix: every pair of every aligned sample, as ref_align.py
  // computes it (over each pair's overlap, gap-gap columns skipped), and shown to 3 decimals.
  it('reproduces the % identity distance matrix of every aligned sample', () => {
    for (const doc of SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments' && d.alignmentMeta?.isAligned)) {
      const members = doc.alignmentMeta!.sequences!;
      const matrix = refOf(doc.id).identity_matrix!;
      expect(matrix.length, `${doc.name} pairs`).toBe((members.length * (members.length - 1)) / 2);
      for (const [i, j, want] of matrix) {
        const got = computeNonEndGapPairwiseMetric(members[i].sequence, members[j].sequence, 'identity');
        expect(got, `${doc.name}: ${members[i].name}/${members[j].name}`).toBeCloseTo(want, 9);
      }
    }
    const members = docByName('COXII CDS').alignmentMeta!.sequences!;
    const at = members.findIndex((m) => m.name === 'Chimpanzee');
    const bt = members.findIndex((m) => m.name === 'Human');
    const [, , want] = refOf('doc-aln-coxii-cds').identity_matrix!.find(([i, j]) => i === Math.min(at, bt) && j === Math.max(at, bt))!;
    expect(computeNonEndGapPairwiseMetric(members[at].sequence, members[bt].sequence, 'identity').toFixed(3)).toBe(want.toFixed(3));
  });

  // HIV env codon-usage table: every codon count, as ref_align.py counts the codons of each Bio.Seq.
  it('reproduces the HIV env codon usage counts', () => {
    const counts = new Map<string, number>();
    for (const member of docByName('HIV env').alignmentMeta!.sequences!) {
      const clean = member.sequence.replace(/-/g, '').toUpperCase().replace(/U/g, 'T');
      for (let i = 0; i + 2 < clean.length; i += 3) {
        const codon = clean.slice(i, i + 3);
        counts.set(codon, (counts.get(codon) ?? 0) + 1);
      }
    }
    const ref = refOf('doc-aln-hiv-env').codon_usage!;
    expect(Object.keys(ref).length).toBeGreaterThan(60);
    expect(Object.fromEntries(counts)).toEqual(ref);
  });

  // US-01M6TDGW AC2. Each set is written out from its source, so the code is checked against the
  // table and not against itself:
  //  - IMGT 'Physicochemical' classes (Pommié C. et al., J. Mol. Recognit. 2004, 17:17-32;
  //    imgt.org IMGTeducation Aide-memoire 'IMGT classes of the 20 common amino acids'):
  //    charge positive R H K, negative D E; polarity polar R N D Q E H K S T Y; hydropathy
  //    hydrophobic A C I L M F W V.
  //  - Singer G.A.C. & Hickey D.A., Mol. Biol. Evol. 2000, 17(11):1581: GARP (G A R P), encoded by
  //    GC-rich codons, and FYMINK (F Y M I N K), encoded by AT-rich codons.
  it('amino-acid groups follow their published definitions', () => {
    const IMGT_POSITIVE = ['R', 'H', 'K'];
    const IMGT_NEGATIVE = ['D', 'E'];
    const IMGT_POLAR = ['R', 'N', 'D', 'Q', 'E', 'H', 'K', 'S', 'T', 'Y'];
    const IMGT_HYDROPHOBIC = ['A', 'C', 'I', 'L', 'M', 'F', 'W', 'V'];
    const GARP = ['G', 'A', 'R', 'P'];
    const FYMINK = ['F', 'Y', 'M', 'I', 'N', 'K'];
    const sorted = (xs: readonly string[]) => [...xs].sort();
    const group = (label: string) => {
      const g = AA_GROUP_DEFINITIONS.find((d) => d.label === label);
      expect(g, `the ${label} group`).toBeDefined();
      expect(new Set(g!.chars).size, `${label}: no residue listed twice`).toBe(g!.chars.length);
      return sorted(g!.chars);
    };

    // The seven groups the Statistics panel reports, in its order.
    expect(AA_GROUP_DEFINITIONS.map((g) => g.label)).toEqual([
      'Acidic', 'Basic', 'Charged', 'Polar Uncharged', 'Hydrophobic', 'GC-rich', 'AT-rich',
    ]);
    // Each membership, literally.
    expect(group('Acidic')).toEqual(['D', 'E']);
    expect(group('Basic')).toEqual(['H', 'K', 'R']);
    expect(group('Charged')).toEqual(['D', 'E', 'H', 'K', 'R']);
    expect(group('Polar Uncharged')).toEqual(['N', 'Q', 'S', 'T', 'Y']);
    expect(group('Hydrophobic')).toEqual(['A', 'C', 'F', 'I', 'L', 'M', 'V', 'W']);
    expect(group('GC-rich')).toEqual(['A', 'G', 'P', 'R']);
    expect(group('AT-rich')).toEqual(['F', 'I', 'K', 'M', 'N', 'Y']);
    // And each as its table defines it: the IMGT charge classes, Charged their union, Polar
    // uncharged the IMGT polar class less the charged residues, the IMGT hydrophobic class, GARP
    // and FYMINK.
    expect(group('Acidic')).toEqual(sorted(IMGT_NEGATIVE));
    expect(group('Basic')).toEqual(sorted(IMGT_POSITIVE));
    expect(group('Charged')).toEqual(sorted([...IMGT_NEGATIVE, ...IMGT_POSITIVE]));
    expect(group('Polar Uncharged')).toEqual(sorted(IMGT_POLAR.filter((r) => !IMGT_NEGATIVE.includes(r) && !IMGT_POSITIVE.includes(r))));
    expect(group('Hydrophobic')).toEqual(sorted(IMGT_HYDROPHOBIC));
    expect(group('GC-rich')).toEqual(sorted(GARP));
    expect(group('AT-rich')).toEqual(sorted(FYMINK));

    // The doc comment above the definitions names each table it follows.
    const source = fs.readFileSync(new URL('../components/AlignmentAndPhyloStudio.tsx', import.meta.url), 'utf8');
    const at = source.indexOf('export const AA_GROUP_DEFINITIONS');
    const docStart = source.lastIndexOf('/**', at);
    expect(at, 'AA_GROUP_DEFINITIONS is declared').toBeGreaterThan(0);
    const doc = source.slice(docStart, at);
    expect(doc.trimEnd().endsWith('*/'), 'the doc comment sits directly above the definitions').toBe(true);
    for (const cite of ['IMGT', 'Pommié', 'J. Mol. Recognit.', '17:17-32', 'charge', 'polarity', 'hydropathy',
      'Singer', 'Hickey', 'Mol. Biol. Evol.', '17(11):1581', 'GARP', 'FYMINK']) {
      expect(doc, `the doc comment cites ${cite}`).toContain(cite);
    }

    // The Statistics panel reports these totals: LysR family, re-derived by hand from its
    // composition in align.json (A 215, C 34, D 118, E 149, F 75, G 124, H 80, I 112, K 69,
    // L 284, M 40, N 57, P 130, Q 134, R 169, S 132, T 101, V 157, W 43, Y 45; 2,268 residues).
    const lysr = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-lysr-family')!;
    const html = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, { activeDoc: lysr, documents: [lysr], initialInspectorTab: 'statistics' })
    );
    const table = html.slice(html.indexOf('<th>AA Group</th>'));
    expect(table.length, 'the Statistics panel draws its AA Group table').toBeGreaterThan(0);
    const rows = [...table.slice(0, table.indexOf('</table>')).matchAll(/<strong>([^<]+):<\/strong><\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td>/g)]
      .map((m) => [m[1], m[2], m[3]]);
    expect(rows).toEqual([
      ['Acidic', '267', '11.8%'],
      ['Basic', '318', '14.0%'],
      ['Charged', '585', '25.8%'],
      ['Polar Uncharged', '469', '20.7%'],
      ['Hydrophobic', '960', '42.3%'],
      ['GC-rich', '638', '28.1%'],
      ['AT-rich', '398', '17.5%'],
    ]);
  });
});

describe('View parity with the reference alignment export', () => {
  const alignedDocs = SAMPLE_LIBRARY.filter(
    (d) => d.folder === 'Alignments' && d.alignmentMeta?.isAligned
  );
  const docByName = (name: string) =>
    SAMPLE_LIBRARY.find((d) => d.folder === 'Alignments' && d.name === name)!;

  // Text View, where the document's own sequence is the consensus of MolBioCraft's alignment
  // (note the IUPAC W at COXII column 15).
  it('stores the majority consensus as each aligned document sequence', () => {
    // 4 since US-01M6TGKH dropped the fictitious-character People alignment (D0094).
    expect(alignedDocs.length).toBe(4);
    for (const doc of alignedDocs) {
      const rows = (doc.alignmentMeta?.sequences ?? []).map((m) => ({ sequence: m.sequence }));
      const { consensus } = computeAlignmentConsensusAndIdentity(
        rows,
        'Majority',
        false,
        doc.moleculeType === 'Protein'
      );
      expect(consensus.length, `${doc.name} length`).toBe(doc.sequence.length);
      expect(consensus, `${doc.name} consensus`).toBe(doc.sequence.toUpperCase());
    }
    expect(docByName('COXII CDS').sequence.slice(0, 60).toUpperCase()).toBe(
      'ATGGCATACCCCTTWCAACTAGGTTTCCAAGACGCAACATCCCCTATCATAGAAGAACTA'
    );
  });

  // LysR annotation tracks: 49 features in 5 types, as the member records carry them.
  it('reproduces the LysR family annotation track counts', () => {
    const types = new Map<string, number>();
    for (const member of docByName('LysR family').alignmentMeta!.sequences!) {
      for (const feature of member.features ?? []) {
        types.set(feature.type, (types.get(feature.type) ?? 0) + 1);
      }
    }
    expect(types.get('CDS')).toBe(7);
    expect(types.get('Protein')).toBe(7);
    expect(types.get('Region')).toBe(21);
    expect(types.get('Site')).toBe(7);
    expect(types.get('source')).toBe(7);
    expect([...types.values()].reduce((a, b) => a + b, 0)).toBe(49);
    // The track label is capitalised even though the GenBank key is lower-case.
    expect(formatAnnotationTypeLabel('source')).toBe('Source');
    expect(formatAnnotationTypeLabel('CDS')).toBe('CDS');
  });

  // US-01M6TDGW AC1. Zappo as Jalview publishes it (Jalview documentation, Colour Schemes > Zappo,
  // https://www.jalview.org/help/html/colourSchemes/zappo.html): seven physicochemical groups,
  // each with its own colour, written out here from that table.
  it('colours proteins by a published scheme by default', () => {
    const ZAPPO: [string, string, string][] = [
      ['Aliphatic/hydrophobic', 'ILVAM', '#ffafaf'],
      ['Aromatic', 'FWY', '#ffc800'],
      ['Positive', 'KRH', '#6464ff'],
      ['Negative', 'DE', '#ff0000'],
      ['Hydrophilic', 'STNQ', '#00ff00'],
      ['Conformationally special', 'PG', '#ff00ff'],
      ['Cysteine', 'C', '#ffff00'],
    ];
    // The table covers the 20 standard residues once each.
    expect(ZAPPO.map(([, rs]) => rs).join('').split('').sort().join('')).toBe('ACDEFGHIKLMNPQRSTVWY');

    // The default protein scheme is Zappo; the nucleotide default is unchanged.
    expect(defaultColorScheme(true)).toBe('Zappo');
    expect(defaultColorScheme(false)).toBe('ACGT - Default');
    expect(colorSchemesFor(true)[0].value, 'Zappo heads the protein scheme list').toBe('Zappo');

    const zappoOf = (aa: string) => ZAPPO.find(([, rs]) => rs.includes(aa))![2];
    for (const [name, residues, hex] of ZAPPO) {
      for (const aa of residues) {
        expect(residueSolidColor(aa, { scheme: 'Zappo', isProtein: true }), `Zappo ${name}: ${aa}`).toBe(hex);
        expect(residueSolidColor(aa.toLowerCase(), { scheme: 'Zappo', isProtein: true }), `Zappo ${name}: ${aa.toLowerCase()}`).toBe(hex);
        // By Translation colours a codon by the Zappo colour of the residue it encodes.
        expect(residueSolidColor('A', { scheme: 'By Translation', isProtein: false, translatedAa: aa }), `By Translation: ${aa}`).toBe(hex);
        // A protein drawn under a scheme that is not a protein scheme takes Zappo too.
        expect(residueSolidColor(aa, { scheme: 'ACGT - Default', isProtein: true }), `protein fallback: ${aa}`).toBe(hex);
      }
    }
    // A stop codon keeps its own dark fill under By Translation.
    expect(residueSolidColor('T', { scheme: 'By Translation', isProtein: false, translatedAa: '*' })).toBe('#111827');

    // The studio opens a protein alignment in Zappo: the scheme menu shows it selected.
    const lysr = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-lysr-family')!;
    const studio = renderToStaticMarkup(React.createElement(SequenceAlignmentStudio, { activeDoc: lysr, documents: [lysr] }));
    expect(studio).toContain('<option value="Zappo" selected="">Zappo (physicochemical)</option>');

    // The grid's translation track colours each amino acid in Zappo too: GAC AAA TGG translates to
    // D K W, each drawn over its codon's three columns on a wash of the residue's Zappo colour.
    const settings = {
      colorScheme: 'ACGT - Default', isProtein: false, showLetters: true, showConsensus: false, consensusLabel: 'Consensus',
      showHighlighting: false, highlightMode: 'All Disagreements', highlightRef: 'Consensus', useDotsForAgreements: false,
      showComplement: false, showTranslation: true, translationFrame: '1', geneticCode: 'Standard',
      threeLetterAminoAcids: false, showAminoAcidNumbering: false, showAnnotations: false,
      hiddenAnnotationTypes: new Set<string>(), annotationFilter: '', annotationLabels: 'None', annotationArrowTips: false,
      annotationHideExcessiveLabels: false, annotationCompress: false, annotationLabelSize: 10, annotationThickness: 8,
      showGraphs: false, graphCoverage: false, coverageLogScale: false, coverageHighlightGapped: false,
      graphIdentity: false, identityWindow: 1, graphGc: false, graphAt: false, gcWindow: 10, graphFramePlot: false,
      graphLogo: false, graphHydrophobicity: false, hydrophobicityWindow: 9, graphPi: false, piWindow: 10,
      restrictionSites: null, highlightDam: false, highlightDcm: false, wrap: false, visibleCols: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      spacesEvery: 0, numbering: 'Standard', miniMap: false, outlineZoomedOut: false, showSequenceIcons: false,
      nameFontSize: 11, numberFontSize: 10, letterFontSize: 12, zoomedOutRowHeight: 8,
    } satisfies AlignmentCanvasSettings;
    const canvas = renderToStaticMarkup(React.createElement(AlignmentCanvas, {
      rows: [{ id: 'r1', label: 'r1', alignedSeq: 'GACAAATGG', strand: 1, features: [] }],
      consensus: 'GACAAATGG', conservation: [1, 1, 1, 1, 1, 1, 1, 1, 1], settings, zoomPct: 400,
      cursorCol: 1, selectedRowIdx: 0, onCursorChange: () => {}, onSelectRow: () => {},
      scrollRequest: null, fitRequestNonce: 0, onRequestZoom: () => {},
    }));
    const washes = [...canvas.matchAll(/class="mbc-aln-aa-bg"[^>]*background:([^;"]+)/g)].map((m) => m[1].trim());
    expect(washes, 'one wash per column, in the Zappo colour of its codon\'s residue').toEqual(
      ['D', 'D', 'D', 'K', 'K', 'K', 'W', 'W', 'W'].map((aa) => `${zappoOf(aa)}55`));
  });

  // BG-01M6XP1Q AC1. Zappo's table (Jalview documentation, Colour Schemes > Zappo) gives a colour
  // only to the 20 standard residues, so a stop ('*') and the non-standard residues X, U, B and Z
  // take none: they are drawn in the neutral slate (#cbd5e1) that Clustal, Polarity and Zappo here
  // give a residue outside their tables. A protein drawn under a scheme that is not a protein
  // scheme falls back to Zappo, and leaves them uncoloured too.
  it('zappo leaves stops and non-standard residues uncoloured', () => {
    const UNCOLOURED = '#cbd5e1';
    const zappoColours = new Set('ACDEFGHIKLMNPQRSTVWY'.split('').map((aa) => residueSolidColor(aa, { scheme: 'Zappo', isProtein: true })));
    expect(zappoColours.has(UNCOLOURED), 'no Zappo group is drawn in the neutral slate').toBe(false);
    for (const ch of ['*', 'X', 'U', 'B', 'Z', 'x', 'u', 'b', 'z']) {
      expect(residueSolidColor(ch, { scheme: 'Zappo', isProtein: true }), `Zappo: "${ch}"`).toBe(UNCOLOURED);
      expect(residueSolidColor(ch, { scheme: 'ACGT - Default', isProtein: true }), `protein fallback to Zappo: "${ch}"`).toBe(UNCOLOURED);
    }
    // The grid cell is the neutral slate's wash, so a stop is not drawn dark.
    expect(residueCellStyle('*', { scheme: 'Zappo', isProtein: true }, false).background).toBe(`${UNCOLOURED}66`);
  });
});
