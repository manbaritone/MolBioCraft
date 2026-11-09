// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { VECTOR_CATALOG } from '../data/vectorCatalog';
import { MODULAR_VECTOR_PARTS } from '../data/modularVectorParts';
import { HOST_STRAIN_GUIDES, VECTOR_SYSTEM_GUIDES } from '../data/vectorSystemsAndStrains';
import {
  assembleModularCustomVector,
  auditTwistCustomVectorOnboarding,
  buildCatalogVectorDocument,
  checkCoTransformationCompatibility,
  exportVectorCatalogCsv,
  generateCatalogCircularSvg,
  simulateTwistClonalGeneInsertion,
} from '../core/vectorDesignerEngine';
import {
  isMbcFileOrPayload,
  MBC_FORMAT_MAGIC,
  parseMbcWorkbench,
  serializeMbcWorkbench,
} from '../core/mbcSessionFormat';
import {
  alignPairwiseTypeScript,
  analyzeProteinSequence,
  analyzeSequenceComposition,
  analyzeSilentMutations,
  annealComplementaryOligos,
  auditSequenceAlerts,
  buildNeighborJoiningNewick,
  buildUPGMANewick,
  calculatePrimerMetrics,
  computeDnaAndLigationCalculations,
  computeDotplotHits,
  convertDnaRna,
  designPCRPrimers,
  detectCommonFeatures,
  findCrisprGuides,
  findNonCuttingEnzymes,
  findORFs,
  findRestrictionCutSites,
  mapReadAndCallVariants,
  predictSecondaryStructure,
  reverseComplement,
  runLocalBlastSearch,
  runMultipleSequenceAlignment,
  setCircularOrigin,
  simulateMolecularCloning,
  simulateRestrictionDigest,
  simulateSiteDirectedMutagenesis,
  testSavedPrimersOnSequence,
} from '../core/bioEngine';
import {
  exportToEMBL,
  exportToFasta,
  exportToGenBank,
  exportToGFF3,
  parseFasta,
  parseGenBank,
} from '../core/fileParsers';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { CrisprGuideRecord } from '../types/bio';
import { BUILTIN_JS_PLUGINS, executeJavaScriptPlugin } from '../plugins/pluginEngine';
import {
  analyzeUserTree,
  computeEvolutionaryDistances,
  computeNucleotideCompositionByCodonPos,
  computePopulationDiversity,
  computeRelativeSynonymousCodonUsage,
  computeSubstitutionRateMatrix,
  constructPhylogeneticTree,
  diagnoseMissenseMutation,
  estimateGammaAndSiteRates,
  exploreActiveAlignmentData,
  findBestSubstitutionModels,
  inferAncestralSequences,
  runMolecularClockAndTimetree,
  runSelectionAndNeutralityTests,
} from '../core/phyloEvoEngine';

describe('MolBioCraft Core Bioinformatics Engine & Hybrid Modules', () => {
  const pet28Doc = SAMPLE_LIBRARY[0];
  const puc19Doc = SAMPLE_LIBRARY[1];
  const insertDoc = SAMPLE_LIBRARY[2];
  const sangerDoc = SAMPLE_LIBRARY[3];
  // Vectors that actually support the Type IIS / Gateway methods.
  const px459Doc = SAMPLE_LIBRARY.find((d) => d.name.includes('PX459'))!;
  const entryVectorDoc = SAMPLE_LIBRARY.find((d) => d.name.includes('ENTR'))!;
  const linearDoc = (name: string, sequence: string) => ({
    ...insertDoc, id: `t-${name}`, name, sequence, topology: 'linear' as const,
    features: [], primers: [], history: [], alignmentMeta: undefined,
  });

  it('computes accurate sequence composition, molecular weight, and Dam/Dcm sites', () => {
    const stats = analyzeSequenceComposition(pet28Doc.sequence);
    expect(stats.length).toBeGreaterThan(5900);
    expect(stats.gcPercent).toBeGreaterThan(45);
    expect(stats.gcPercent).toBeLessThan(65);
    expect(stats.mwDsDnaDa).toBeGreaterThan(3_500_000);
    expect(stats.damSites.length).toBeGreaterThan(5);
  });

  it('computes IUPAC reverse complement and discovers 6-frame ORFs', () => {
    expect(reverseComplement('GAATTCATGGTG')).toBe('CACCATGAATTC');
    const orfs = findORFs(pet28Doc.sequence, 100, false);
    expect(orfs.length).toBeGreaterThanOrEqual(3); // eGFP, KanR, lacI
    expect(orfs[0].proteinSeq.startsWith('M')).toBe(true);
  });

  it('detects restriction cut sites and simulates circular and linear restriction digests', () => {
    const sites = findRestrictionCutSites(pet28Doc.sequence, 'circular');
    expect(sites.length).toBeGreaterThan(10);
    const frags = simulateRestrictionDigest(pet28Doc, ['EcoRI', 'XhoI']);
    expect(frags.length).toBe(2);
    const totalLen = frags.reduce((acc, f) => acc + f.lengthBp, 0);
    expect(totalLen).toBe(pet28Doc.sequence.length);
  });

  it('calculates SantaLucia 1998 primer thermodynamics and designs tailed PCR primers', () => {
    const metrics = calculatePrimerMetrics('TAATACGACTCACTATAGGG');
    expect(metrics.length).toBe(20);
    expect(metrics.tmC).toBeGreaterThan(45);
    expect(metrics.tmC).toBeLessThan(65);
    expect(metrics.gcClamp3Prime).toBe(true);

    const pcr = designPCRPrimers(pet28Doc, 5192, 5911, 60, 'GCGGAATTC', 'CGCCTCGAG');
    expect(pcr.forward.sequence.startsWith('GCGGAATTC')).toBe(true);
    expect(pcr.reverse.sequence.startsWith('CGCCTCGAG')).toBe(true);
    expect(pcr.ampliconLength).toBe(5911 - 5192 + 1 + 18);
  });

  it('simulates Restriction Ligation, Gibson Assembly, and Golden Gate Type IIS cloning', () => {
    const lig = simulateMolecularCloning(
      pet28Doc,
      insertDoc,
      'Restriction Ligation',
      'EcoRI',
      'XhoI'
    );
    expect(lig.success).toBe(true);
    expect(lig.constructDocument.topology).toBe('circular');
    expect(lig.constructDocument.history.length).toBeGreaterThan(pet28Doc.history.length);

    const gib = simulateMolecularCloning(pet28Doc, insertDoc, 'Gibson Assembly');
    expect(gib.success).toBe(true);

    // pET-28a has no BsaI site, so Golden Gate is refused instead of inventing an insertion point.
    const noSites = simulateMolecularCloning(pet28Doc, insertDoc, 'Golden Gate (Type IIS)', 'EcoRI', 'XhoI', 'BsaI-HFv2');
    expect(noSites.success).toBe(false);
    expect(noSites.summary).toContain('BsaI');
    expect(noSites.constructDocument.sequence).toBe(pet28Doc.sequence);

    // The real case: an annealed sgRNA duplex into the BbsI sites of PX459 (CACC / GTTT overhangs).
    const spacer = 'GGGTGGGGGGAGTTTGCTCC';
    const gg = simulateMolecularCloning(
      px459Doc,
      linearDoc('sgRNA_duplex', `TTGAAGACAACACC${spacer}GTTTTTGTCTTCAA`),
      'Golden Gate (Type IIS)', '', '', 'BbsI-HF'
    );
    expect(gg.success).toBe(true);
    expect(gg.overhangOrHomologyLeft).toBe("5'-CACC-3'");
    // The 22-bp BbsI drop-out is replaced by the 24-bp CACC-spacer-GTTT fragment.
    expect(gg.constructDocument.sequence.length).toBe(px459Doc.sequence.length - 22 + 24);
    expect(gg.constructDocument.sequence).toContain(`CACC${spacer}GTTT`);
    expect(gg.constructDocument.sequence).not.toContain('GAAGAC');
  });

  it('performs Needleman-Wunsch, Smith-Waterman, MSA, Dotplot, and Neighbor-Joining Tree construction', () => {
    const nw = alignPairwiseTypeScript(
      'ATGGTGAGCAAGGGCGAGGAG',
      'ATGGTGAGCAAGGGCGAGCTG',
      false
    );
    expect(nw.matches).toBe(19);
    expect(nw.mismatches).toBe(2);
    expect(nw.identityPct).toBeCloseTo(90.48, 1);

    const msa = runMultipleSequenceAlignment([
      { id: '1', name: 'eGFP', sequence: 'ATGGTGAGCAAGGGCGAGGAGCTGTTC' },
      { id: '2', name: 'EYFP', sequence: 'ATGGTGAGCAAGGGCGAGGAGCTGTTC' },
      { id: '3', name: 'ECFP', sequence: 'ATGGTGAGCAAGGGCGAGCTGCTGTTC' },
    ]);
    expect(msa.rows.length).toBe(3);
    expect(msa.newickTree).toContain('eGFP');

    const dots = computeDotplotHits('GAATTCATGGTGAGCAAG', 'GAATTCATGGTGAGCAAG', 6, 5);
    expect(dots.length).toBeGreaterThan(5);

    const tree = buildNeighborJoiningNewick(
      ['SeqA', 'SeqB', 'SeqC'],
      ['ATGGTGAGCAAG', 'ATGGTGAGCAAG', 'ATGGTGAGelle']
    );
    expect(tree.endsWith(';')).toBe(true);
  });

  it('maps Sanger AB1 chromatogram reads to reference plasmid and calls SNP variants', () => {
    const res = mapReadAndCallVariants(pet28Doc, sangerDoc);
    expect(res.variants.length).toBeGreaterThanOrEqual(1);
    expect(res.variants[0].type).toBe('SNP');
  });

  it('round-trips GenBank (.gb) and FASTA (.fasta) import and export cleanly', () => {
    const gbText = exportToGenBank(puc19Doc);
    expect(gbText).toContain('LOCUS');
    expect(gbText).toContain('FEATURES');
    expect(gbText).toContain('ORIGIN');

    const reimportedGb = parseGenBank(gbText);
    expect(reimportedGb.sequence.length).toBe(puc19Doc.sequence.length);
    // GenBank requires a source feature; it is written on export and read back.
    expect(reimportedGb.features.filter((f) => String(f.type) !== 'source').length).toBe(puc19Doc.features.length);

    const faText = exportToFasta(puc19Doc);
    const reimportedFa = parseFasta(faText);
    expect(reimportedFa[0].sequence.length).toBe(puc19Doc.sequence.length);
  });

  it('executes built-in JavaScript BioJS workflow plugins (CRISPR, Golden Gate, RBS)', () => {
    for (const plugin of BUILTIN_JS_PLUGINS) {
      const res = executeJavaScriptPlugin(plugin.code, pet28Doc);
      expect(res.ok).toBe(true);
      expect(res.output).toBeDefined();
    }
  });

  it('simulates Directional TOPO Cloning and Gateway BP/LR Recombination', () => {
    // A linearized TOPO vector takes a CACC-tailed PCR product directionally.
    const topoVector = linearDoc('pENTR-D-TOPO (linearized)', pet28Doc.sequence);
    const topo = simulateMolecularCloning(topoVector, linearDoc('ins', `CACC${insertDoc.sequence}`), 'TOPO Cloning');
    expect(topo.success).toBe(true);
    expect(topo.constructDocument.sequence.length).toBe(pet28Doc.sequence.length + insertDoc.sequence.length + 4);
    expect(topo.overhangOrHomologyRight).toContain('CACC');
    // A circular pET-28a is not a TOPO vector.
    expect(simulateMolecularCloning(pet28Doc, insertDoc, 'TOPO Cloning').success).toBe(false);

    // Gateway needs att sites: pET-28a has none, the Twist ENTR entry vector does.
    expect(simulateMolecularCloning(pet28Doc, insertDoc, 'Gateway BP/LR Recombination').success).toBe(false);
    const gw = simulateMolecularCloning(entryVectorDoc, insertDoc, 'Gateway BP/LR Recombination');
    expect(gw.success).toBe(true);
    expect(gw.constructDocument.features.some((f) => f.name.includes('attB1'))).toBe(true);
    expect(gw.constructDocument.features.some((f) => f.name.includes('attB2'))).toBe(true);
    expect(gw.constructDocument.sequence).toContain(insertDoc.sequence);
  });

  it('discovers and scores SpCas9 (NGG) and Cas12a (TTTV) CRISPR guides and screens saved primers', () => {
    const cas9Guides = findCrisprGuides(pet28Doc.sequence, 'SpCas9 (NGG)', 15);
    expect(cas9Guides.length).toBe(15);
    expect(cas9Guides[0].pamSeq.endsWith('GG')).toBe(true);
    expect(cas9Guides[0].onTargetScore).toBeGreaterThanOrEqual(8);
    expect(cas9Guides[0].specificityScore).toBeLessThanOrEqual(100);

    const cas12Guides = findCrisprGuides(pet28Doc.sequence, 'Cas12a / Cpf1 (TTTV)', 10);
    expect(cas12Guides.length).toBeGreaterThan(0);
    expect(cas12Guides[0].pamSeq.startsWith('TTT')).toBe(true);

    const primerHits = testSavedPrimersOnSequence(pet28Doc.sequence, pet28Doc.primers, 0);
    expect(primerHits.length).toBeGreaterThanOrEqual(2);
    expect(primerHits[0].mismatches).toBe(0);
  });

  /**
   * BG-01M6T6GQ. The guide scan is told which molecule it is reading. On the circular pUC19 the
   * extra candidates a circle has are exactly the sites that straddle its origin — the ones the
   * straight read of the same bases cannot see — every one of them reported inside 1..length, and a
   * linear read of the same sequence gains none of them.
   *
   * This runs through the shipped RPC (`circular` on the `find_crispr_guides` payload), so a
   * topology the dispatcher never reads fails it, as does a wrap whose coordinates stay in the
   * extended string.
   */
  it('scans a circular plasmid across its origin and reads a linear record end to end', () => {
    type ScannedGuide = CrisprGuideRecord & {
      candidateCount: number;
      scannedCircular: boolean;
      originSpanBp: number;
    };
    const len = puc19Doc.sequence.length;
    expect(puc19Doc.topology).toBe('circular');
    const asCircle = findCrisprGuides(puc19Doc.sequence, 'SpCas9 (NGG)', 5_000, true) as ScannedGuide[];
    const asLine = findCrisprGuides(puc19Doc.sequence, 'SpCas9 (NGG)', 5_000, false) as ScannedGuide[];
    // Every candidate is listed, so the two sets can be compared whole.
    expect(asCircle.length).toBe(asCircle[0].candidateCount);
    expect(asLine.length).toBe(asLine[0].candidateCount);
    expect([asCircle[0].scannedCircular, asCircle[0].originSpanBp]).toEqual([true, 22]);
    expect([asLine[0].scannedCircular, asLine[0].originSpanBp]).toEqual([false, 0]);

    const key = (g: CrisprGuideRecord) => `${g.start}..${g.end}/${g.strand}/${g.spacerSeq}/${g.cutPosition}`;
    const straight = new Set(asLine.map(key));
    const extra = asCircle.filter((g) => !straight.has(key(g)));
    expect(extra.length, 'a circle holds more candidate sites than the same bases cut open').toBeGreaterThan(0);
    expect(asCircle.length - asLine.length).toBe(extra.length);
    for (const g of extra) {
      expect(g.start, `${g.name} is an extra candidate that does not cross the origin`).toBeGreaterThan(g.end);
    }
    for (const g of asCircle) {
      for (const coord of [g.start, g.end, g.cutPosition]) {
        expect(coord, `${g.name} leaves the record`).toBeGreaterThanOrEqual(1);
        expect(coord, `${g.name} leaves the record`).toBeLessThanOrEqual(len);
      }
    }
    // A linear record gains nothing across its ends.
    expect(asLine.filter((g) => g.start > g.end)).toEqual([]);
  });

  it('computes EMBOSS protein analysis metrics (MW, pI, Hydropathy, GOR Secondary Structure, Antigenicity) and UPGMA/GFF3/EMBL exports', () => {
    const prot = analyzeProteinSequence(insertDoc.sequence, true, 9);
    expect(prot.lengthAa).toBeGreaterThan(200);
    expect(prot.molecularWeightKda).toBeGreaterThan(20);
    expect(prot.isoelectricPointPi).toBeGreaterThan(4.0);
    expect(prot.isoelectricPointPi).toBeLessThan(10.5);
    expect(prot.hydrophobicityProfile.length).toBe(prot.lengthAa);
    expect(
      prot.secondaryStructureSummary.helixPercent +
        prot.secondaryStructureSummary.sheetPercent +
        prot.secondaryStructureSummary.coilPercent
    ).toBeCloseTo(100, 0);

    const upgma = buildUPGMANewick(
      ['eGFP', 'EYFP', 'ECFP'],
      ['ATGGTGAGCAAG', 'ATGGTGAGCAAG', 'ATGGTGAGelle']
    );
    expect(upgma.endsWith(';')).toBe(true);

    const gff3 = exportToGFF3(pet28Doc);
    expect(gff3).toContain('##gff-version 3');
    expect(gff3).toContain('eGFP');

    const embl = exportToEMBL(pet28Doc);
    expect(embl).toContain('ID   MBC_VEC_001');
    expect(embl).toContain('SQ   Sequence');
  });

  it('simulates In-Fusion Cloning, Parts Cloning, Non-Cutting Enzymes, Silent Mutations, and Local BLAST', () => {
    const inf = simulateMolecularCloning(pet28Doc, insertDoc, 'In-Fusion Cloning', 'EcoRI', 'XhoI');
    expect(inf.success).toBe(true);
    expect(inf.overhangOrHomologyLeft).toContain('15 bp');
    expect(inf.constructDocument.sequence).toContain(insertDoc.sequence);

    // Parts Cloning is BsaI MoClo: pET-28a carries no BsaI site.
    const parts = simulateMolecularCloning(pet28Doc, insertDoc, 'Parts Cloning');
    expect(parts.success).toBe(false);
    expect(parts.summary).toContain('BsaI');

    const nonCutters = findNonCuttingEnzymes(puc19Doc.sequence);
    expect(nonCutters.length).toBeGreaterThan(2);

    const silentMuts = analyzeSilentMutations(insertDoc.sequence, 10);
    expect(silentMuts.length).toBeGreaterThan(0);
    expect(silentMuts[0].mutationLabel).toContain('→');

    const blastHits = runLocalBlastSearch(insertDoc.sequence, SAMPLE_LIBRARY, 'blastn');
    // Only significant hits (E ≤ 10) are reported, like BLAST; unrelated subjects are not padded in.
    expect(blastHits.length).toBeGreaterThan(0);
    expect(blastHits.length).toBeLessThanOrEqual(SAMPLE_LIBRARY.filter((d) => d.sequence.length > 0).length);
    expect(blastHits.every((h) => Number(h.eValue) <= 10)).toBe(true);
    expect(blastHits[0].bitScore).toBeGreaterThan(20);

    expect(convertDnaRna('ATGCGTA', true)).toBe('AUGCGUA');
    expect(convertDnaRna('AUGCGUA', false)).toBe('ATGCGTA');
  });

  it('executes all 12 Evolutionary Genetics & Phylogenetics modules (Data, Models, Distance, Diversity, Phylogeny, User Tree, Ancestors, Selection, Rates, Clocks, Diagnose)', () => {
    // Four homologous GFP-family coding sequences (an unaligned mCherry would saturate every
    // corrected distance, and the engine now refuses to build a tree from undefined distances).
    const taxaNames = ['EYFP_T203Y', 'EYFP_variant', 'ECFP_Y66W', 'ECFP_variant'];
    const alignedSeqs = [
      SAMPLE_LIBRARY[4].sequence.slice(0, 360),
      SAMPLE_LIBRARY[4].sequence.slice(0, 360).replace(/GAG/g, 'GAA'),
      SAMPLE_LIBRARY[5].sequence.slice(0, 360),
      SAMPLE_LIBRARY[5].sequence
        .slice(0, 360)
        .replace(/CTG/g, 'ATC')
        .replace(/GAC/g, 'AAT'),
    ];

    // 1. Data Explorer
    const dataSummary = exploreActiveAlignmentData(alignedSeqs);
    expect(dataSummary.numTaxa).toBe(4);
    expect(dataSummary.conservedSites + dataSummary.variableSites).toBe(dataSummary.numSites);
    expect(dataSummary.fourFoldDegenerateSites).toBeGreaterThan(20);

    // 2. Substitution Models, Rate Matrix (MCL), Codon Composition, RSCU
    const models = findBestSubstitutionModels(alignedSeqs);
    expect(models.length).toBe(24); // JC/K2/T92/HKY/TN93/GTR × (none, +G, +I, +G+I), ML-fitted
    expect(models[0].bic).toBeLessThanOrEqual(models[1].bic);
    const lnl = (m: string) => models.find((r) => r.model === m)!.logLikelihood;
    expect(lnl('GTR+G+I')).toBeGreaterThanOrEqual(lnl('JC') - 0.05); // nested models never fit worse

    const mcl = computeSubstitutionRateMatrix(taxaNames, alignedSeqs);
    expect(mcl.matrix4x4.length).toBe(4);
    const offDiagonal = mcl.matrix4x4.flatMap((r) => [r.toA, r.toT, r.toC, r.toG]).filter((v): v is number => v !== null);
    expect(offDiagonal.length).toBe(12);
    expect(offDiagonal.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0); // the 12 off-diagonal rates sum to 100
    expect(mcl.disparityPairs.length).toBe(6);

    const comp = computeNucleotideCompositionByCodonPos(taxaNames, alignedSeqs);
    expect(comp.length).toBe(4);

    const rscu = computeRelativeSynonymousCodonUsage(alignedSeqs);
    expect(rscu.length).toBe(64);

    // 3. Evolutionary Distances
    const groups = ['YFP', 'YFP', 'CFP', 'CFP'];
    const ungrouped = computeEvolutionaryDistances(taxaNames, alignedSeqs, 'Tamura-Nei (TN93)');
    expect(ungrouped.withinGroupMeans).toEqual([]); // no invented groups
    const dist = computeEvolutionaryDistances(taxaNames, alignedSeqs, 'Tamura-Nei (TN93)', groups);
    expect(dist.pairwiseMatrix.length).toBe(4);
    expect(dist.overallMeanDistance).toBeGreaterThan(0);
    expect(dist.withinGroupMeans.map((g) => g.groupName)).toEqual(['YFP', 'CFP']);
    expect(dist.betweenGroupMeans.length).toBe(1);

    // 4. Population Diversity
    const div = computePopulationDiversity(taxaNames, alignedSeqs, 'Tamura-Nei (TN93)', groups);
    expect(div.entirePopulationPiT!).toBeGreaterThan(0);
    expect(computePopulationDiversity(taxaNames, alignedSeqs, 'Tamura-Nei (TN93)').withinSubpopulationPiS).toBeNull();
    expect(div.haplotypeDiversityHd).toBe(1);

    // 5. Construct Phylogenetic Trees (ML, NJ, ME, UPGMA, MP)
    for (const method of [
      'Maximum Likelihood (ML)',
      'Neighbor-Joining (NJ)',
      'Minimum-Evolution (ME)',
      'UPGMA',
      'Maximum Parsimony (MP)',
    ] as const) {
      const tree = constructPhylogeneticTree(
        taxaNames,
        alignedSeqs,
        method,
        'Tamura-Nei (TN93)',
        500
      );
      expect(tree.newick.endsWith(';')).toBe(true);
      expect(tree.warnings).toEqual([]);
      // 4 taxa have exactly one non-trivial split: {EYFP, EYFP_variant} | {ECFP, ECFP_variant}
      expect(tree.cladeBootstraps.length).toBe(1);
      expect(tree.cladeBootstraps[0].supportPct).toBeGreaterThan(50);
    }

    // 6. User Tree Analysis & Gene Duplication Detection
    const mlTree = constructPhylogeneticTree(
      taxaNames,
      alignedSeqs,
      'Maximum Likelihood (ML)',
      'Tamura-Nei (TN93)',
      500
    );
    expect(mlTree.methodNote).toContain('Neighbor-Joining'); // no ML search is claimed
    const userTreeRes = analyzeUserTree(mlTree.newick, taxaNames, alignedSeqs);
    expect(userTreeRes.duplicationNodes).toEqual([]); // needs a species tree; none invented
    expect(userTreeRes.olsRSquared!).toBeGreaterThan(0.8);
    expect(userTreeRes.parsimonyLengthSteps).toBe(mlTree.parsimonySteps);

    // 7. Ancestral Sequence Reconstruction (ML / MP)
    const anc = inferAncestralSequences(
      taxaNames,
      alignedSeqs,
      'Maximum Likelihood (Empirical Bayes)'
    );
    expect(anc.nodes.length).toBeGreaterThanOrEqual(3);
    expect(anc.siteEvolutionaryProbabilities.length).toBeGreaterThan(20);

    // 8. Selection & Neutrality Tests (dN/dS Z-test, Tajima's D)
    const sel = runSelectionAndNeutralityTests(alignedSeqs);
    expect(sel.tajimaNeutrality.segregatingSitesS).toBeGreaterThan(0);
    expect(sel.codonSiteSelection.length).toBeGreaterThan(0);
    expect(sel.dS).not.toBeNull();

    // 9. Gamma Parameter & Site-by-Site Evolutionary Rates
    const rates = estimateGammaAndSiteRates(alignedSeqs, 5);
    expect(rates.categoryRates.length).toBe(5);
    expect(rates.siteRates.length).toBeGreaterThan(20);

    // 10. Molecular Clock & RelTime Timetree
    const clock = runMolecularClockAndTimetree(taxaNames, alignedSeqs, 'RelTime-ML', 520);
    expect(clock.divergenceNodes.length).toBe(3);
    expect(clock.divergenceNodes[0].divergenceTimeMya).toBe(520);
    expect(clock.calibrationAgeMya).toBe(520);
    expect(clock.clockTestML.lnLWithClock!).toBeLessThanOrEqual(clock.clockTestML.lnLWithoutClock! + 1e-6);

    // 11. Diagnose Missense Mutation Impact (EP)
    const diag = diagnoseMissenseMutation(66, 'Y', 'H', alignedSeqs);
    expect(diag.homologsCompared).toBe(3);
    expect(diag.evolutionaryProbabilityMutant).not.toBeNull();
    expect(diagnoseMissenseMutation(66, 'Y', 'H').evolutionaryProbabilityMutant).toBeNull();
    expect(['Neutral / Benign', 'Moderately Disruptive', 'Pathogenic / Damaging']).toContain(
      diag.clinicalImpact
    );
  });

  it('executes HiFi DNA Assembly, TA/GC Cloning, Overlap Extension PCR, Mutagenesis, Oligo Annealing, Secondary Structure MFE, DNA Ligation Calculations, and Enhanced Alerts', () => {
    // 1. NEBuilder HiFi Assembly, TA / GC Cloning, Overlap Extension PCR
    const hifi = simulateMolecularCloning(pet28Doc, insertDoc, 'NEBuilder HiFi Assembly', 'EcoRI', 'XhoI');
    expect(hifi.success).toBe(true);
    expect(hifi.constructDocument.history[hifi.constructDocument.history.length - 1].historyColor).toBeDefined();

    const ta = simulateMolecularCloning(linearDoc('pGEM-T (linearized)', puc19Doc.sequence), insertDoc, 'TA / GC Cloning');
    expect(ta.success).toBe(true);
    expect(ta.overhangOrHomologyLeft).toContain("3'-dA");
    expect(ta.warnings.some((w) => w.includes('non-directional'))).toBe(true);

    const soe = simulateMolecularCloning(pet28Doc, insertDoc, 'Overlap Extension PCR');
    expect(soe.success).toBe(true);
    expect(soe.constructDocument.topology).toBe('linear');

    // 2. Site-Directed Mutagenesis (Substitution, Insertion, Deletion)
    const mutSub = simulateSiteDirectedMutagenesis(pet28Doc, 'Substitution', 5250, 'ATC', 3);
    expect(mutSub.mutantDocument.sequence.slice(5249, 5252)).toBe('ATC');
    expect(mutSub.forwardMutagenicPrimer.length).toBeGreaterThan(20);
    expect(mutSub.primerTmC).toBeGreaterThan(50);

    const mutIns = simulateSiteDirectedMutagenesis(
      pet28Doc,
      'Insertion',
      5250,
      'CACCACCACCACCACCAC',
      0
    );
    expect(mutIns.mutantDocument.sequence.length).toBe(pet28Doc.sequence.length + 18);

    const mutDel = simulateSiteDirectedMutagenesis(pet28Doc, 'Deletion', 5250, '', 6);
    expect(mutDel.mutantDocument.sequence.length).toBe(pet28Doc.sequence.length - 6);

    // 3. Anneal Complementary Oligos with 5'/3' Sticky Overhangs
    const duplex = annealComplementaryOligos(
      'Flag_Adapter',
      'AATTCGACTACAAGGACGACGATGACAAGC',
      'TCGAGCTTGTCATCGTCGTCCTTGTAGTCG',
      true
    );
    expect(duplex.duplexLengthBp).toBeGreaterThan(25);
    expect(duplex.phosphorylated5Prime).toBe(true);
    expect(duplex.annealedDocument.features.length).toBe(1);

    // 4. Circular Origin Rotation & Auto-Detect Common Features
    const rotated = setCircularOrigin(puc19Doc, 250);
    expect(rotated.sequence.length).toBe(puc19Doc.sequence.length);
    expect(rotated.sequence.startsWith(puc19Doc.sequence.slice(249, 270))).toBe(true);

    const strippedDoc = { ...pet28Doc, features: [] };
    const detectedFeats = detectCommonFeatures(strippedDoc);
    expect(detectedFeats.length).toBeGreaterThanOrEqual(1);

    // 5. Nucleic Acid Secondary Structure MFE Folding (⌘7)
    const fold = predictSecondaryStructure(
      'GGGAAAUCCCGCCAUUGGCGGGAAAUCCCGCCAUUGGC',
      'RNA'
    );
    expect(fold.dotBracket.length).toBe(38);
    expect(fold.minimumFreeEnergyKcalMol).toBeLessThan(0);

    // 6. DNA Mass, Molarity, Copy Number & Ligation Molar Ratios (⇧⌘M)
    const calc = computeDnaAndLigationCalculations(
      pet28Doc.sequence.length,
      150,
      20,
      50,
      insertDoc.sequence.length
    );
    expect(calc.mwDsDnaDa).toBeGreaterThan(3_500_000);
    expect(calc.ligationRatios.length).toBe(4);
    expect(calc.ligationRatios[1].ratioLabel).toContain('1 : 3');
    expect(calc.ligationRatios[1].requiredInsertMassNg).toBeGreaterThan(0);

    // 7. Enhanced Sequence Alerts & Bacterial Strain Methylation Audit (⌘8)
    const cutSites = findRestrictionCutSites(pet28Doc.sequence, pet28Doc.topology);
    const alerts = auditSequenceAlerts(pet28Doc, cutSites, 'DH5α (dam+ dcm+ EcoKI+)');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('builds authentic annotated SequenceDocuments from Twist Bioscience, Modular Vector Systems, and ConductScience Vector Catalog entries', () => {
    expect(VECTOR_CATALOG.length).toBeGreaterThanOrEqual(60);
    expect(MODULAR_VECTOR_PARTS.length).toBeGreaterThanOrEqual(60);
    expect(VECTOR_SYSTEM_GUIDES.length).toBeGreaterThanOrEqual(10);
    expect(HOST_STRAIN_GUIDES.length).toBeGreaterThanOrEqual(10);

    const twistHigg1 = VECTOR_CATALOG.find((v) => v.id === 'twist-cmv-higg1-lalapgyte')!;
    const doc = buildCatalogVectorDocument(twistHigg1);
    expect(doc.topology).toBe('circular');
    expect(doc.sequence.length).toBe(twistHigg1.nominalSizeBp);
    expect(doc.features.some((f) => f.name.includes('CMV'))).toBe(true);
    expect(doc.features.some((f) => f.name.includes('IgG1'))).toBe(true);

    // Auto-detect common features recognizes newly added motifs (CMV, IgG1 Fc, bGH pA, AmpR, pUC ori)
    const stripped = { ...doc, features: [] };
    const autoDetected = detectCommonFeatures(stripped);
    expect(autoDetected.length).toBeGreaterThanOrEqual(4);

    const svg = generateCatalogCircularSvg(twistHigg1);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Twist Bioscience');

    const escapedSvg = generateCatalogCircularSvg({
      ...twistHigg1,
      name: 'pET&GFP<Test>',
    });
    expect(escapedSvg).toContain('pET&amp;GFP&lt;Test&gt;');
    expect(escapedSvg).not.toContain('pET&GFP');

    const csv = exportVectorCatalogCsv(VECTOR_CATALOG.slice(0, 5));
    expect(csv.split('\n').length).toBe(6);
  });

  it('assembles combinatorial modular vectors and enforces AAV 4.7 kb packaging capacity warnings', () => {
    const aavSys = VECTOR_SYSTEM_GUIDES.find((s) => s.deliveryType === 'AAV')!;
    const compactAav = assembleModularCustomVector({
      vectorName: 'pAAV-hSyn1-NanoLuc-WPRE3',
      systemGuideId: aavSys.id,
      promoterPartId: 'prom-syn1',
      signalOrInitPartId: 'sig-kozak',
      nTagPartId: 'tag-flag',
      proteasePartId: 'none',
      cargoMode: 'part',
      cargoPartId: 'orf-nanoluc',
      linker2APartId: 'none',
      eukaryoticMarkerPartId: 'none',
      regulatoryWprePartId: 'reg-wpre3',
      polyAOrTermPartId: 'reg-sv40pa',
      originPartId: 'ori-puc',
      bacterialMarkerPartId: 'sel-ampr',
    });
    expect(compactAav.overCapacity).toBe(false);
    expect(compactAav.document.features.some((f) => f.name.includes('AAV2'))).toBe(true);

    const oversizedAav = assembleModularCustomVector({
      vectorName: 'pAAV-Oversized-Test',
      systemGuideId: aavSys.id,
      promoterPartId: 'prom-cag',
      cargoMode: 'custom-dna',
      customCargoName: 'Huge_4kb_ORF',
      customCargoSeq: 'ATG' + 'GCT'.repeat(1200) + 'TAA',
      polyAOrTermPartId: 'reg-bghpa',
      originPartId: 'ori-puc',
      bacterialMarkerPartId: 'sel-ampr',
    });
    expect(oversizedAav.overCapacity).toBe(true);
    expect(oversizedAav.warnings.some((w) => w.includes('exceeds'))).toBe(true);
  });

  it('audits Twist Custom Vector Onboarding QC rules, simulates Clonal Gene Insertion, and checks Co-Transformation Compatibility', () => {
    const twistCmvEntry = VECTOR_CATALOG.find((v) => v.id === 'twist-cmv')!;
    const twistCmvDoc = buildCatalogVectorDocument(twistCmvEntry);
    const mcsFeat = twistCmvDoc.features.find((f) => f.name.includes('Insertion') || f.name.includes('MCS'))!;

    const passReport = auditTwistCustomVectorOnboarding(twistCmvDoc, mcsFeat.start + 4, 120, 150);
    expect(passReport.overallStatus).toBe('Ready for Onboarding');
    expect(passReport.nearbyLinearizationEnzymes.length).toBeGreaterThan(0);

    // Injecting a 14-bp poly-A homopolymer & ccdB should trigger blocked status
    const badDoc = {
      ...twistCmvDoc,
      name: 'pDEST-ccdB-Homopolymer',
      sequence:
        twistCmvDoc.sequence.slice(0, mcsFeat.start) +
        'AAAAAAAAAAAAAA' +
        twistCmvDoc.sequence.slice(mcsFeat.start),
    };
    const failReport = auditTwistCustomVectorOnboarding(badDoc, mcsFeat.start + 5, 50, 50);
    expect(failReport.overallStatus).toBe('Action Required (Blocked)');
    expect(failReport.checks.find((c) => c.id === 'homopolymer')?.status).toBe('fail');
    expect(failReport.checks.find((c) => c.id === 'ccdb')?.status).toBe('fail');

    // Simulate Twist Clonal Gene Insertion (igg-variable-inframe strips stop codon)
    const iggClone = simulateTwistClonalGeneInsertion(
      twistCmvDoc,
      mcsFeat.start,
      'VH_Domain',
      'ATGGTGAGCAAGTAA',
      'igg-variable-inframe'
    );
    expect(iggClone.sequence.length).toBe(twistCmvDoc.sequence.length + 12);

    // Co-transformation compatibility check
    const pet28 = VECTOR_CATALOG.find((v) => v.id === 'twist-pet28a')!;
    const chlorMed = VECTOR_CATALOG.find((v) => v.id === 'twist-chlor-med')!;
    const puc19 = VECTOR_CATALOG.find((v) => v.id === 'cs-puc19')!;
    const ampHigh = VECTOR_CATALOG.find((v) => v.id === 'twist-amp-high')!;

    expect(checkCoTransformationCompatibility(pet28, chlorMed).compatible).toBe(true);
    expect(checkCoTransformationCompatibility(puc19, ampHigh).compatible).toBe(false);
  });

  it('serializes and restores full MolBioCraft Workbench Sessions (.mbc) with FNV-1a integrity verification', () => {
    const docs = SAMPLE_LIBRARY.slice(0, 4);
    const mbcText = serializeMbcWorkbench({
      sessionName: 'CAR_T_and_AAV_Study.mbc',
      documents: docs,
      workspace: {
        activeDocId: docs[1].id,
        selectedFolder: 'Plasmids & Vectors',
        navHistory: [docs[0].id, docs[1].id],
        navIndex: 1,
        viewerTab: 'vector-library',
        mapLayoutMode: 'circular',
        zoomLevel: 125,
        textFormat: 'genbank',
        colorScheme: 'gc_heatmap',
        darkMode: true,
        sidebarOpen: true,
        docTableCollapsed: false,
        selectedRange: { start: 100, end: 420, label: 'CMV Promoter' },
        displaySettings: {
          showOrfs: true,
          minOrfAa: 75,
          allowAltStartCodons: true,
          showPrimers: true,
          showTranslation: true,
          showGcGraph: true,
          showHydropathyGraph: true,
          showUniqueCuttersOnly: true,
        },
      },
    });

    expect(isMbcFileOrPayload('project.mbc')).toBe(true);
    expect(isMbcFileOrPayload('project.txt', mbcText)).toBe(true);
    expect(mbcText).toContain(MBC_FORMAT_MAGIC);

    const restored = parseMbcWorkbench(mbcText);
    expect(restored.checksumVerified).toBe(true);
    expect(restored.warnings.length).toBe(0);
    expect(restored.envelope.sessionName).toBe('CAR_T_and_AAV_Study');
    expect(restored.envelope.documentCount).toBe(4);
    expect(restored.envelope.workspace.activeDocId).toBe(docs[1].id);
    expect(restored.envelope.workspace.viewerTab).toBe('vector-library');
    expect(restored.envelope.workspace.zoomLevel).toBe(125);
    expect(restored.envelope.workspace.colorScheme).toBe('gc_heatmap');
    expect(restored.envelope.workspace.darkMode).toBe(true);
    expect(restored.envelope.workspace.displaySettings.minOrfAa).toBe(75);

    // Tamper with sequence after serialization -> checksum warning flagged cleanly
    const tampered = mbcText.replace(docs[0].sequence.slice(0, 12), 'CCCCCCCCCCCC');
    const tamperedParsed = parseMbcWorkbench(tampered);
    expect(tamperedParsed.checksumVerified).toBe(false);
    expect(tamperedParsed.warnings[0]).toContain('Checksum mismatch');

    // Invalid non-MBC JSON is rejected cleanly
    expect(() => parseMbcWorkbench('{"hello":"world"}')).toThrow(/magic header/);
  });
});
