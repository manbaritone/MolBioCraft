// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it, vi } from 'vitest';
import {
  alignPdbStructuresKabsch,
  callFreeBayesVariants,
  classifySequenceTaxonomy,
  complementOnlySequence,
  extractTargetProteinSequence,
  findCpGIslands,
  findGenomicRepeats,
  mutateAndShuffleSequence,
  parsePdbCaCoordinates,
  predictCoiledCoilsAndTransmembrane,
  predictGlimmerMicrobialGenes,
  prepareGenBankSubmissionPackage,
  reverseOnlySequence,
  runBbdukReadTrimming,
  runDeNovoAssembly,
  runNgsReferenceMapping,
  runWholeGenomeSynteny,
  scanMicrosatelliteStrs,
  synthesizeAlphaHelicalCaPdbFromProtein,
} from '../core/genomicsAndStructureSuite';
import { constructPhylogeneticTree } from '../core/phyloEvoEngine';
import * as bioEngine from '../core/bioEngine';
import { findORFs, reverseComplement, runMultipleSequenceAlignment, translateSequence } from '../core/bioEngine';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  DE_NOVO_ASSEMBLER_METHODS, NGS_MAPPER_METHODS, SYNTENY_ENGINE_METHODS,
  type DeNovoAssemblerEngine, type NgsMapperEngine, type SyntenyEngine, type WholeGenomeSyntenyReport,
  type NgsReferenceMappingReport, type DeNovoAssemblyReport,
} from '../core/genomicsAndStructureSuite';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

describe('Built-In Genomics, NGS, Gene/Repeat Prediction, Protein Topology & 3D PDB Suite', () => {
  const pet28 = SAMPLE_LIBRARY[0];

  it('performs exact Complement-Only and Reverse-Only transformations whose composition equals Reverse-Complement', () => {
    const seq = 'ATGCGRYSWK';
    const comp = complementOnlySequence(seq);
    const rev = reverseOnlySequence(seq);
    expect(comp).toBe('TACGCYRSWM');
    expect(rev).toBe('KWSYRGCGTA');
    expect(reverseOnlySequence(comp)).toBe(reverseComplement(seq));
    expect(complementOnlySequence('AUGC', true)).toBe('UACG');
  });

  it('trims Illumina adapters with BBDuk, maps reads with each seed length, and assembles contigs by overlap and de Bruijn graph', () => {
    const cleanCore = pet28.sequence.slice(200, 380);
    const contaminatedRead = `NN${cleanCore}AGATCGGAAGAGCACACGTCTGAACTCCAGTCACAAAAAAAA`;
    const trimRep = runBbdukReadTrimming(contaminatedRead, undefined, { kmerLen: 11 });
    expect(trimRep.adapterMatches.length).toBeGreaterThan(0);
    expect(trimRep.trimmedLengthBp).toBe(cleanCore.length);
    expect(trimRep.trimmedSequence).toBe(cleanCore);

    for (const mapper of ['seed-13', 'seed-11', 'seed-9'] as const) {
      const mapRep = runNgsReferenceMapping(pet28.sequence, reverseComplement(cleanCore), mapper);
      expect(mapRep.warnings, mapper).toEqual([]);
      expect(mapRep.strand).toBe('-');
      expect(mapRep.refStartBp).toBe(201);
      expect(mapRep.identityPercent).toBe(100);
      expect(mapRep.mapqScore).toBeGreaterThanOrEqual(50);
    }

    const frag1 = pet28.sequence.slice(100, 260);
    const frag2 = pet28.sequence.slice(220, 390);
    const frag3 = reverseComplement(pet28.sequence.slice(350, 510));
    for (const asm of ['overlap', 'debruijn'] as const) {
      const asmRep = runDeNovoAssembly(
        [
          { name: 'read_1', sequence: frag1 },
          { name: 'read_2', sequence: frag2 },
          { name: 'read_3_rc', sequence: frag3 },
        ],
        asm,
        25
      );
      expect(asmRep.warnings, asm).toEqual([]);
      expect(asmRep.contigCount).toBe(1);
      expect(asmRep.largestContigBp).toBe(410);
      expect(asmRep.n50Bp).toBe(410);
    }
  });

  it('detects seed-and-extend synteny & inversions, calls FreeBayes variants, genotypes STRs, and classifies 16S/ITS taxonomy', () => {
    const blockA = pet28.sequence.slice(0, 180);
    const invertedBlockB = reverseComplement(pet28.sequence.slice(200, 380));
    const rearrangedGenome = `${blockA}ACGTACGT${invertedBlockB}`;

    const synteny = runWholeGenomeSynteny(pet28.sequence.slice(0, 420), rearrangedGenome, 'seed-13');
    expect(synteny.blocks.length).toBeGreaterThanOrEqual(2);
    expect(synteny.inversionCount).toBeGreaterThanOrEqual(1);

    // FreeBayes SNP calling
    const refSlice = pet28.sequence.slice(500, 660);
    const mutSlice =
      refSlice.slice(0, 40) +
      (refSlice[40] === 'A' ? 'G' : 'A') +
      refSlice.slice(41, 95) +
      (refSlice[95] === 'C' ? 'A' : 'C') +
      refSlice.slice(96);
    const fb = callFreeBayesVariants('pET28a', refSlice, mutSlice);
    expect(fb.totalVariants).toBe(2);
    expect(fb.snpCount).toBe(2);
    expect(fb.vcfText).toContain('##fileformat=VCFv4.2');

    // Microsatellite STR locus genotyping
    const strSeq = 'GGCCAATT' + 'CA'.repeat(9) + 'TTACGGCC' + 'AGAT'.repeat(6) + 'CCGGTTAA';
    const strs = scanMicrosatelliteStrs(strSeq, 4);
    expect(strs.some((s) => s.alleleCall === '(CA)9')).toBe(true);
    expect(strs.some((s) => s.alleleCall === '(AGAT)6')).toBe(true);

    // 16S / Replicon taxonomic classification
    const taxa = classifySequenceTaxonomy(pet28.sequence);
    expect(taxa.length).toBeGreaterThan(0);
    expect(taxa[0].confidencePct).toBeGreaterThan(50);
  });

  it('predicts Glimmer microbial genes, Gardiner-Garden CpG islands, and direct/inverted genomic repeats', () => {
    const glimmer = predictGlimmerMicrobialGenes(pet28.sequence, 50);
    expect(glimmer.genes.length).toBeGreaterThan(0);
    expect(glimmer.annotations[0].type).toBe('CDS');
    // BG-01M6S1P2: the report counts every CDS it predicted, and warns only when it lists fewer
    expect(glimmer.totalPredictedCds).toBeGreaterThanOrEqual(glimmer.genes.length);
    expect(glimmer.warnings).toEqual(
      glimmer.totalPredictedCds > glimmer.genes.length
        ? [`Gene list capped: it shows the 24 highest-scoring of the ${glimmer.totalPredictedCds} predicted CDS, and only these are annotated.`]
        : []
    );

    const cpgRich = 'CGCGATGCCGCGCGTACGCGCGATGCCGCGCG'.repeat(9);
    const cpg = findCpGIslands(cpgRich, 200);
    expect(cpg.islands.length).toBe(1);
    expect(cpg.islands[0].gcPercent).toBeGreaterThanOrEqual(50);
    expect(cpg.islands[0].obsExpRatio).toBeGreaterThanOrEqual(0.6);

    const arm = 'GCTAGCTAGCTA';
    const invTest = `AAACCC${arm}TTTTGGGGCCCCAAAA${reverseComplement(arm)}GGGTTT`;
    const reps = findGenomicRepeats(invTest, 10);
    expect(reps.repeats.length).toBeGreaterThan(0);
    // BG-01M6S1P2: the scan object reaches the caller. The fixture's spacer and flanks pair too,
    // so the whole 52 bp is one palindrome, reported once with its arms extended to the middle;
    // the arm and its reverse complement also share GCTAGCTAGC and TAGCTAGCTA, each a direct repeat
    expect(reps.repeats.map((r) => [r.repeatType, r.arm1StartBp, r.arm1EndBp, r.arm2StartBp, r.arm2EndBp])).toEqual([
      ['Palindromic Site', 1, 26, 27, 52],
      ['Direct Repeat', 7, 16, 37, 46],
      ['Direct Repeat', 9, 18, 35, 44],
    ]);
    expect([reps.totalRepeats, reps.scannedLengthBp, reps.sequenceLengthBp]).toEqual([3, 52, 52]);
    expect(reps.warnings).toEqual([]);
    // BG-01M6SQ9T: an exact scan's total is not a lower bound, and the report names its arm length
    expect([reps.totalIsLowerBound, reps.minArmBp]).toEqual([false, 10]);
    expect(findGenomicRepeats(invTest, 12).minArmBp).toBe(12);
    // an inverted repeat with a spacer that does not pair: reported once, as an inverted repeat,
    // with the whole arm and the flanks that pair as well (6 + 12 bp)
    const hairpin = `AAACCC${arm}ACGTTGCAGTACCTGA${reverseComplement(arm)}GGGTTT`;
    const inverted = findGenomicRepeats(hairpin, 10);
    expect(inverted.repeats.filter((r) => r.repeatType !== 'Direct Repeat').map((r) => [r.repeatType, r.armLengthBp, r.spacerBp]))
      .toEqual([['Inverted Repeat', 18, 16]]);
  });

  it('predicts Lupas coiled-coils, transmembrane helices, and 3D PDB C-alpha RMSD / TM-score', () => {
    // Canonical GCN4-like leucine-zipper heptad repeat (LxxEEKK)4 + 21-aa hydrophobic TM helix
    const zipperAndTm =
      'MKQLEDKVEELLSKNYHLENEVARLKKLVGER' +
      'GGSGGSKKK' +
      'LLLLIIIIVVVVLLLLIIIIV' +
      'DDGSGS';
    const topo = predictCoiledCoilsAndTransmembrane(zipperAndTm);
    expect(topo.coiledCoils.length).toBeGreaterThanOrEqual(1);
    expect(topo.transmembraneHelices.length).toBe(1);
    expect(topo.transmembraneHelices[0].orientation).toBe('In -> Out');

    const pdbA = synthesizeAlphaHelicalCaPdbFromProtein('ModelA', zipperAndTm, 45);
    const pdbSame = synthesizeAlphaHelicalCaPdbFromProtein('ModelA_Copy', zipperAndTm, 45);
    const selfAlign = alignPdbStructuresKabsch(pdbA, pdbSame);
    expect(selfAlign.alignedResiduePairs).toBe(45);
    expect(selfAlign.rmsdAngstrom).toBe(0);
    expect(selfAlign.tmScore).toBe(1);
  });

  it('reports the chains it superposed, how it paired them, and the matrix that moves B onto A', () => {
    const seq = 'MKQLEDKVEELLSKNYHLENEVARLKKLVGER';
    const part = seq.slice(4, 28);
    const pdbA = synthesizeAlphaHelicalCaPdbFromProtein('A', seq, 60);
    const pdbB = synthesizeAlphaHelicalCaPdbFromProtein('B', part, 60);
    const r = alignPdbStructuresKabsch(pdbA, pdbB);
    expect([r.chainA, r.chainB]).toEqual(['A', 'A']);
    expect(r.pairingMethod).toMatch(/^Residues paired by a global sequence alignment/);
    // B is a stretch of A: the alignment gaps B at both ends and pairs every residue of B with its own letter.
    expect(r.alignedSequenceA.length).toBe(r.alignedSequenceB.length);
    expect(r.alignedSequenceA.replace(/-/g, '')).toBe(seq);
    expect(r.alignedSequenceB.replace(/-/g, '')).toBe(part);
    const columns = [...r.alignedSequenceA].map((c, i) => [c, r.alignedSequenceB[i]]);
    expect(columns.filter(([a, b]) => a !== '-' && b !== '-').length).toBe(r.alignedResiduePairs);
    expect(r.alignedResiduePairs).toBe(part.length);
    expect(r.sequenceIdentity).toBe(1);
    expect(r.alignmentScore).toBeGreaterThan(0);
    // The 4x4 matrix moves B's own atoms to where the report draws them over A.
    const m = r.transformationMatrix;
    expect(m.map((row) => row.length)).toEqual([4, 4, 4, 4]);
    expect(m[3]).toEqual([0, 0, 0, 1]);
    const b = parsePdbCaCoordinates(pdbB);
    expect(r.superimposedAtomsB).toHaveLength(b.length);
    b.forEach((atom, i) => {
      const moved = [0, 1, 2].map((k) => m[k][0] * atom.x + m[k][1] * atom.y + m[k][2] * atom.z + m[k][3]);
      const drawn = r.superimposedAtomsB![i];
      expect(Math.hypot(moved[0] - drawn.x, moved[1] - drawn.y, moved[2] - drawn.z)).toBeLessThan(0.01);
    });
  });

  it('preserves dinucleotide composition during shuffling, validates NCBI GenBank submissions, and runs FastTree/PhyML/RAxML/MrBayes', () => {
    const sampleSeq = pet28.sequence.slice(0, 600);
    const dinucShuf = mutateAndShuffleSequence(sampleSeq, {
      mode: 'shuffle-dinucleotide',
      seed: 42,
    });
    expect(dinucShuf.outputLengthBp).toBe(sampleSeq.length);
    expect(dinucShuf.gcOutputPct).toBe(dinucShuf.gcOriginalPct);
    expect(dinucShuf.dinucleotideCorrelation).toBe(1);

    const gbSub = prepareGenBankSubmissionPackage(pet28, {
      organism: 'Escherichia coli',
      strainOrIsolate: 'BL21(DE3)',
      molType: 'other DNA',
      geneticCodeId: 11,
    });
    expect(gbSub.readyForSubmission).toBe(true);
    expect(gbSub.fastaFsaText).toContain('[organism=Escherichia coli]');
    expect(gbSub.featureTableTblText).toContain('>Feature ');

    const msa = runMultipleSequenceAlignment(
      SAMPLE_LIBRARY.slice(0, 4).map((d) => ({
        id: d.id,
        name: d.name,
        sequence: d.sequence.slice(0, 240),
      }))
    );
    const names = msa.rows.map((r) => r.name);
    const seqs = msa.rows.map((r) => r.alignedSeq);
    for (const algo of [
      'FastTree (Approx-ML)',
      'PhyML (ML + SH-aLRT)',
      'RAxML (GTR+G Rapid ML)',
      'MrBayes (Bayesian MCMC)',
    ] as const) {
      // An external program runs only as the program (runExternalTree); the distance-tree op
      // refuses its name rather than answer with a Neighbor-Joining tree under it (US-01M6P2HD, D0206).
      expect(() => constructPhylogeneticTree(names, seqs, algo, 'Tamura-Nei (TN93)', 500), algo)
        .toThrow(`${algo} runs only as the installed program, through runExternalTree; this operation builds distance trees.`);
    }
    const nj = constructPhylogeneticTree(names, seqs, 'Neighbor-Joining (NJ)', 'Tamura-Nei (TN93)', 500);
    expect(nj.algorithm).toBe('Neighbor-Joining (NJ)');
    expect(nj.newick.endsWith(';')).toBe(true);
  });
});

// ─── US-01M6P23M: the options name their method (D0204, D0005) ───

/** The genomicsInspector fixtures, built the same way: a seeded LCG genome with planted features. */
function lettersFrom(seed: number, n: number, alphabet = 'ACGT'): string {
  let st = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((st / 2 ** 32) * alphabet.length)];
  }
  return out;
}
const plant = (seq: string, at: number, piece: string) => seq.slice(0, at) + piece + seq.slice(at + piece.length);
const SWAP: Record<string, string> = { A: 'C', C: 'G', G: 'T', T: 'A' };
const substituted = (seq: string, every: number, from: number) => [...seq].map((b, i) => (i % every === from ? SWAP[b] : b)).join('');
const GENOME_SEQ = (() => {
  let g = lettersFrom(0x7a4b, 6000);
  g = plant(g, 300, lettersFrom(0xc9c9, 500, 'CG'));
  g = plant(g, 1200, 'AC'.repeat(5));
  g = plant(g, 1300, 'TG'.repeat(6));
  return plant(g, 1400, 'GATA'.repeat(8));
})();
/** genomicsInspector's READ: 400 bp of the genome (1,001..1,400) with one base in 12 substituted. */
const READ_1_IN_12 = substituted(GENOME_SEQ.slice(1000, 1400), 12, 6);

const MAPPER_LABEL = (k: number, step: number) => `Built-in seed mapper (${k}-mer seeds, step ${step})`;
const without = <T extends { warnings: string[] }>(r: T) => ({ ...r, warnings: [] });

describe('US-01M6P23M mapping, assembly and synteny name their method', () => {
  it('US-01M6P23M AC3 seed-9 names its 9-mer seeds and step 2, and maps the 1-in-12 read that 13-mers miss', () => {
    const nine = runNgsReferenceMapping(GENOME_SEQ, READ_1_IN_12, 'seed-9');
    expect(nine.mapper).toBe('Built-in seed mapper (9-mer seeds, step 2)');
    expect(nine.warnings).toEqual([]);
    expect([nine.strand, nine.refStartBp, nine.refEndBp]).toEqual(['+', 1001, 1400]);
    expect(nine.seedHits).toBeGreaterThan(0);
    // the fixture: no 13-mer of the read is in the genome, so 13-mer seeds find nothing
    const thirteen = runNgsReferenceMapping(GENOME_SEQ, READ_1_IN_12, 'seed-13');
    expect(thirteen.mapper).toBe(MAPPER_LABEL(13, 3));
    expect(thirteen.seedHits).toBe(0);
    expect(runNgsReferenceMapping(GENOME_SEQ, READ_1_IN_12, 'seed-11').mapper).toBe(MAPPER_LABEL(11, 2));
    // the default is seed-13, in TypeScript and in the engine when the payload names no mapper
    expect(runNgsReferenceMapping(GENOME_SEQ, READ_1_IN_12)).toEqual(thirteen);
    expect(invokeRustBioSync<NgsReferenceMappingReport>('run_ngs_mapping', { referenceSeq: GENOME_SEQ, readSeq: READ_1_IN_12 })).toEqual(thirteen);
    // the studio's option labels are the engine's own names for each value
    for (const value of Object.keys(NGS_MAPPER_METHODS) as NgsMapperEngine[]) {
      expect(runNgsReferenceMapping(GENOME_SEQ, READ_1_IN_12, value).mapper, value).toBe(NGS_MAPPER_METHODS[value]);
    }
  });

  it('US-01M6P23M AC4 an unknown mapper, an old tool name among them, maps with seed-13 and warns once naming both', () => {
    const fallback = runNgsReferenceMapping(GENOME_SEQ, READ_1_IN_12, 'seed-13');
    for (const unknown of ['minimap2', 'Minimap2', 'BBMap', 'seed-7', '']) {
      const r = runNgsReferenceMapping(GENOME_SEQ, READ_1_IN_12, unknown as NgsMapperEngine);
      expect(without(r), unknown).toEqual(fallback);
      expect(r.warnings, unknown).toEqual([
        `Unknown mapper "${unknown}"; mapped with the default, seed-13 (${MAPPER_LABEL(13, 3)}).`,
      ]);
    }
  });

  it('US-01M6P23M AC4 an unknown assembler, an old tool name among them, assembles by overlap and warns once naming both', () => {
    // two reads that overlap by 35 bp: joined at k = 31 (de Bruijn, the odd minimum clamped to 15-31), not at an overlap of 40
    const a = lettersFrom(0x1111, 200);
    const reads = [{ name: 'a', sequence: a }, { name: 'b', sequence: a.slice(165) + lettersFrom(0x2222, 200) }];
    const overlap = runDeNovoAssembly(reads, 'overlap', 40);
    const debruijn = runDeNovoAssembly(reads, 'debruijn', 40);
    expect([overlap.contigCount, debruijn.contigCount], 'fixture: the methods differ').toEqual([2, 1]);
    expect([overlap.assembler, overlap.kmerOrOverlapBp, overlap.contigs[0].name]).toEqual(['Greedy overlap (≥ 40 bp)', 40, 'Overlap_Contig_1']);
    expect([debruijn.assembler, debruijn.kmerOrOverlapBp, debruijn.contigs[0].name]).toEqual(['Greedy overlap (≥ 31 bp)', 31, 'DeBruijn_Contig_1']);
    expect(runDeNovoAssembly(reads, undefined, 40)).toEqual(overlap);
    expect(invokeRustBioSync<DeNovoAssemblyReport>('run_de_novo_assembly', { inputs: reads, minOverlapBp: 40 })).toEqual(overlap);
    expect(Object.keys(DE_NOVO_ASSEMBLER_METHODS)).toEqual(['overlap', 'debruijn']);
    for (const unknown of ['CAP3', 'Velvet', 'cap3', 'olc', '']) {
      const r = runDeNovoAssembly(reads, unknown as DeNovoAssemblerEngine, 40);
      expect(without(r), unknown).toEqual(overlap);
      expect(r.warnings, unknown).toEqual([`Unknown assembler "${unknown}"; assembled with the default, overlap.`]);
    }
  });

  it('US-01M6P23M AC4 an unknown synteny engine, an old tool name among them, seeds 13-mers and warns once naming both', () => {
    // B is the genome without every 13th base: they share only 12-base stretches, which 11-mers seed and 13-mers cannot
    const b = [...GENOME_SEQ].filter((_, i) => i % 13 !== 12).join('');
    const s13 = runWholeGenomeSynteny(GENOME_SEQ, b, 'seed-13');
    const s11 = runWholeGenomeSynteny(GENOME_SEQ, b, 'seed-11');
    expect([s13.engine, s11.engine]).toEqual(['Built-in seed-and-extend synteny (13-mer seeds)', 'Built-in seed-and-extend synteny (11-mer seeds)']);
    expect(s13.totalAlignedBp, 'fixture: 11-mers align what 13-mers cannot').not.toBe(s11.totalAlignedBp);
    expect([s13.warnings, s11.warnings]).toEqual([[], []]);
    expect(runWholeGenomeSynteny(GENOME_SEQ, b)).toEqual(s13);
    // the engine's own default when the payload names no engine (it was "LastZ", which matched nothing)
    expect(invokeRustBioSync<WholeGenomeSyntenyReport>('run_whole_genome_synteny', { seqA: GENOME_SEQ, seqB: b })).toEqual(s13);
    for (const value of Object.keys(SYNTENY_ENGINE_METHODS) as SyntenyEngine[]) {
      expect(runWholeGenomeSynteny(GENOME_SEQ, b, value).engine, value).toBe(SYNTENY_ENGINE_METHODS[value]);
    }
    for (const unknown of ['Mauve', 'LASTZ', 'LastZ', 'lastz', '']) {
      const r = runWholeGenomeSynteny(GENOME_SEQ, b, unknown as SyntenyEngine);
      expect(without(r), unknown).toEqual(s13);
      expect(r.warnings, unknown).toEqual([
        `Unknown synteny engine "${unknown}"; aligned with the default, seed-13 (Built-in seed-and-extend synteny (13-mer seeds)).`,
      ]);
    }
  });
});

// BG-01M6VZRS: the protein Coiled-Coils analyses. With no CDS that translates to 20 aa or more it
// took the first ORF the engine listed, not the longest: a 20-aa ORF over a 286-aa one.

/** A gene of `codons` sense codons after its ATG, then TAA: one ORF of `codons + 1` aa. */
const orfGene = (codons: number, seed: number) => {
  const sense = ['GCT', 'GAA', 'CTG', 'AAA', 'GTT', 'TCC', 'CGT', 'GGC'];
  return `ATG${[...lettersFrom(seed, codons, '01234567')].map((k) => sense[Number(k)]).join('')}TAA`;
};
/** Bases from C, G and T only: no ATG on either strand (the reverse complement has no T). */
const noAtg = (seed: number, n: number) => lettersFrom(seed, n, 'CGT');
const SHORT_GENE = orfGene(19, 0x2a1);
const LONG_GENE = orfGene(285, 0x2a2);
/** 30 bases, the 20-aa ORF in frame 1, 31 bases, the 286-aa ORF in frame 2, 30 bases. */
const SHORT_START = 31;
const LONG_START = SHORT_START + SHORT_GENE.length + 31;
const TWO_ORFS = `${noAtg(0x2a3, 30)}${SHORT_GENE}${noAtg(0x2a4, 31)}${LONG_GENE}${noAtg(0x2a5, 30)}`;
const proteinOf = (gene: string) => translateSequence(gene, 0).replace(/\*$/, '');
const dnaDoc = (sequence: string, features: SequenceDocument['features'] = []): SequenceDocument => ({
  id: 'vzrs', name: 'Two_ORFs', accession: '', description: '', sequence, moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', features, primers: [], history: [],
});

describe('BG-01M6VZRS the protein Coiled-Coils analyses', () => {
  it('BG-01M6VZRS AC1 with no CDS the target protein is the longest ORF, not the first one found', () => {
    expect(TWO_ORFS.slice(LONG_START - 1, LONG_START - 1 + LONG_GENE.length)).toBe(LONG_GENE);
    expect((LONG_START - 1) % 3, 'the long ORF is in another frame').toBe(1);
    // The engine finds both ORFs, and today lists the longest first (translation_orf.rs sorts by
    // length), so its first ORF and its longest agree here.
    const orfs = findORFs(TWO_ORFS, 15, false);
    expect(orfs.map((o) => [o.frame, o.start, o.lengthAa])).toEqual([[2, LONG_START, 286], [1, SHORT_START, 20]]);
    expect(orfs[1].proteinSeq).toBe(proteinOf(SHORT_GENE));
    expect(extractTargetProteinSequence(dnaDoc(TWO_ORFS))).toBe(proteinOf(LONG_GENE));
    expect(proteinOf(LONG_GENE)).toHaveLength(286);
    // The rule is the longest ORF, not whichever the reply lists first: given the same ORFs with
    // the 20-aa one first, as the engine listed them when the bug was filed, it is still the 286-aa one.
    const real = bioEngine.findORFs;
    const firstFound = vi.spyOn(bioEngine, 'findORFs').mockImplementation((...args) =>
      [...real(...args)].sort((a, b) => a.start - b.start));
    try {
      expect(bioEngine.findORFs(TWO_ORFS, 15, false)[0].lengthAa, 'the reply lists the 20-aa ORF first').toBe(20);
      expect(extractTargetProteinSequence(dnaDoc(TWO_ORFS))).toBe(proteinOf(LONG_GENE));
      expect(firstFound).toHaveBeenCalledWith(TWO_ORFS, 15, false);
      // of two as long, the first-starting, listed last here
      const twin = orfGene(285, 0x2a6);
      const tie = `${noAtg(0x2a3, 30)}${twin}${noAtg(0x2a4, 31)}${LONG_GENE}${noAtg(0x2a5, 30)}`;
      firstFound.mockImplementation((...args) => [...real(...args)].sort((a, b) => b.start - a.start));
      expect(bioEngine.findORFs(tie, 15, false).map((o) => [o.lengthAa, o.proteinSeq])).toEqual([[286, proteinOf(LONG_GENE)], [286, proteinOf(twin)]]);
      expect(extractTargetProteinSequence(dnaDoc(tie))).toBe(proteinOf(twin));
    } finally {
      firstFound.mockRestore();
    }
    // listed the other way round, it is still the longest
    const swapped = `${noAtg(0x2a3, 30)}${LONG_GENE}${noAtg(0x2a4, 31)}${SHORT_GENE}${noAtg(0x2a5, 30)}`;
    expect(extractTargetProteinSequence(dnaDoc(swapped))).toBe(proteinOf(LONG_GENE));
    // on the minus strand too: the reverse complement holds the same two ORFs
    expect(extractTargetProteinSequence(dnaDoc(reverseComplement(TWO_ORFS)))).toBe(proteinOf(LONG_GENE));
  });

  it('BG-01M6VZRS AC2 an annotated CDS of 20 aa or more is analysed before a longer ORF', () => {
    const cds = (end: number) => [{ id: 'c', name: 'short', type: 'CDS' as const, start: SHORT_START, end, strand: 1 as const, color: '#000' }];
    // the 20-aa CDS is analysed although the 286-aa ORF is longer
    expect(extractTargetProteinSequence(dnaDoc(TWO_ORFS, cds(SHORT_START + SHORT_GENE.length - 1)))).toBe(proteinOf(SHORT_GENE));
    expect(proteinOf(SHORT_GENE)).toHaveLength(20);
    // a CDS one codon short of that (19 aa) is not used: the longest ORF is
    expect(extractTargetProteinSequence(dnaDoc(TWO_ORFS, cds(SHORT_START + SHORT_GENE.length - 7)))).toBe(proteinOf(LONG_GENE));
    // a protein record is its own residues
    const own = proteinOf(LONG_GENE);
    expect(extractTargetProteinSequence({ ...dnaDoc(own), moleculeType: 'Protein' })).toBe(own);
  });
});
