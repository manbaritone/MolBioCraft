// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import {
  alignPdbStructuresKabsch,
  callFreeBayesVariants,
  classifySequenceTaxonomy,
  complementOnlySequence,
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
import { reverseComplement, runMultipleSequenceAlignment } from '../core/bioEngine';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';

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

  it('trims Illumina adapters with BBDuk, maps reads via Minimap2/Bowtie2/BBMap, and assembles contigs via CAP3/Velvet/Flye/MIRA', () => {
    const cleanCore = pet28.sequence.slice(200, 380);
    const contaminatedRead = `NN${cleanCore}AGATCGGAAGAGCACACGTCTGAACTCCAGTCACAAAAAAAA`;
    const trimRep = runBbdukReadTrimming(contaminatedRead, undefined, { kmerLen: 11 });
    expect(trimRep.adapterMatches.length).toBeGreaterThan(0);
    expect(trimRep.trimmedLengthBp).toBe(cleanCore.length);
    expect(trimRep.trimmedSequence).toBe(cleanCore);

    for (const mapper of ['Minimap2', 'Bowtie2', 'BBMap'] as const) {
      const mapRep = runNgsReferenceMapping(pet28.sequence, reverseComplement(cleanCore), mapper);
      expect(mapRep.strand).toBe('-');
      expect(mapRep.refStartBp).toBe(201);
      expect(mapRep.identityPercent).toBe(100);
      expect(mapRep.mapqScore).toBeGreaterThanOrEqual(50);
    }

    const frag1 = pet28.sequence.slice(100, 260);
    const frag2 = pet28.sequence.slice(220, 390);
    const frag3 = reverseComplement(pet28.sequence.slice(350, 510));
    for (const asm of ['CAP3', 'Velvet', 'Flye', 'MIRA'] as const) {
      const asmRep = runDeNovoAssembly(
        [
          { name: 'read_1', sequence: frag1 },
          { name: 'read_2', sequence: frag2 },
          { name: 'read_3_rc', sequence: frag3 },
        ],
        asm,
        25
      );
      expect(asmRep.contigCount).toBe(1);
      expect(asmRep.largestContigBp).toBe(410);
      expect(asmRep.n50Bp).toBe(410);
    }
  });

  it('detects Mauve/LASTZ synteny & inversions, calls FreeBayes variants, genotypes STRs, and classifies 16S/ITS taxonomy', () => {
    const blockA = pet28.sequence.slice(0, 180);
    const invertedBlockB = reverseComplement(pet28.sequence.slice(200, 380));
    const rearrangedGenome = `${blockA}ACGTACGT${invertedBlockB}`;

    const synteny = runWholeGenomeSynteny(pet28.sequence.slice(0, 420), rearrangedGenome, 'Mauve');
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
      const tree = constructPhylogeneticTree(names, seqs, algo, 'Tamura-Nei (TN93)', 500);
      expect(tree.algorithm).toBe(algo);
      expect(tree.newick.endsWith(';')).toBe(true);
    }
  });
});
