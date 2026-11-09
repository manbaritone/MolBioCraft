/// <reference types="vite/client" />
// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CircularPlasmidMap,
  computeAdaptiveCircularTicks,
} from '../components/CircularPlasmidMap';
import { LinearSequenceView } from '../components/LinearSequenceView';
import { StaticModalDialog } from '../components/MenusPreferencesAndBlastModal';
import {
  ProteinStructure3DViewer,
  synthesizeFoldedCaAtomsFromStates,
} from '../components/ProteinStructure3DViewer';
import {
  alignPdbStructuresKabsch,
  synthesizeAlphaHelicalCaPdbFromProtein,
} from '../core/genomicsAndStructureSuite';
import {
  computeDocumentTableMetrics,
  sortDocumentsByColumn,
} from '../core/workbenchBatchOperations';
import {
  isMbcFileOrPayload,
  parseMbcWorkbench,
  serializeMbcWorkbench,
} from '../core/mbcSessionFormat';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  alignLargeGenomesMinimizerChainRust,
  alignPairwiseBandedSparseRust,
  analyzeGibsonOverlapJunctionRust,
  analyzePdb3dGeometryRust,
  annotateVcfCodingConsequencesNoodlesRust,
  assembleSangerContigPoaRust,
  buildConstructLineageDagRust,
  buildCuratedDatabaseDocumentRust,
  buildNcbiReferencePresetDocumentRust,
  compareTreeTopologiesRobinsonFouldsRust,
  computeAgaroseGelPhysicsRust,
  computeChromatogramViewportRust,
  computeDocumentTableMetricsRust,
  computeMashMinimizerDistanceRust,
  computeMbcPayloadChecksumRust,
  computeSamPileupAndCoverageNoodlesRust,
  ensureResidentSequenceRust,
  evaluateGoldenGateFidelityRust,
  evaluateMultiDigestBufferPlanRust,
  evictResidentSequenceRust,
  executeBuiltinWorkflowMacroRust,
  exportTableDelimitedCsvRust,
  extractRegionWithAnnotationsRust,
  generateLargeGenomeBenchmarkRust,
  generateLargeProteinBenchmarkRust,
  getBuiltinWorkflowMacrosRust,
  getReferenceDatabaseCategoriesRust,
  getResidentStoreStatsRust,
  getResidentTrackOverviewRust,
  getRustEngineDiagnostics,
  intersectGenomicIntervalsNoodlesRust,
  layoutNewickPhylogeneticTreeRust,
  parseFastqNoodlesRust,
  parseGff3NoodlesRust,
  parseVcfNoodlesRust,
  queryCuratedDatabaseRecordsRust,
  scanFuzzySubsequenceSimdRust,
  scanJasparPssmMotifsRust,
  scanPostTranslationalModificationsRust,
  scanProteinFunctionalMotifsRust,
  searchProteomeBlosum62HspsRust,
  searchResidentMotifFmIndexRust,
  segmentGenomeHmmViterbiRust,
  simulatePeptideMs2SpectrumRust,
  simulateProteolyticDigestMsRust,
  sliceResidentViewportRust,
  spliceModularPartIntoDocumentRust,
  trimSangerTraceMottPhredRust,
} from '../lib/rustBioEngine';

// The engine runs here on a 500,000 bp genome and a 10,000 aa protein. The file sets its timeout as
// the App-mounting suites beside it do (BG-01M6T68N); Vitest times out only its one async test, and
// no check below reads the clock.
vi.setConfig({ testTimeout: 60_000 });

describe('Rust Multi-Crate Bioinformatics Engine, Resident Sequence Store & 3D Protein Viewer', () => {
  it('reports compiled Rust engine diagnostics with rust-bio, noodles, nalgebra, statrs, petgraph, and aho-corasick', () => {
    const diag = getRustEngineDiagnostics();
    expect(diag.isWasm).toBe(true);
    expect(diag.libraries.join(' ')).toContain('rust-bio');
    expect(diag.libraries.join(' ')).toContain('noodles');
    expect(diag.libraries.join(' ')).toContain('nalgebra');
  });

  it('registers 500,000 bp chromosomes and 10,000 aa polyproteins in the Resident Rust Store with sub-millisecond viewport slicing and FM-Index search', () => {
    const genome500k = generateLargeGenomeBenchmarkRust(500_000, 'Escherichia coli K-12');
    expect(genome500k.sequence.length).toBe(500_000);
    expect(genome500k.features.length).toBeGreaterThan(100);

    const ack1 = ensureResidentSequenceRust(genome500k, 180);
    expect(ack1.sequenceLength).toBe(500_000);
    // Chromosomes > 256 kbp skip eager SA/BWT construction on open for < 1 ms registration
    expect(ack1.hasPrebuiltFmIndex).toBe(false);

    // Sequences <= 256 kbp prebuild the full rust-bio FM-Index
    const plasmidAck = ensureResidentSequenceRust(SAMPLE_LIBRARY[0], 180);
    expect(plasmidAck.hasPrebuiltFmIndex).toBe(true);

    // Second ensure hits revision cache immediately
    const ack2 = ensureResidentSequenceRust(genome500k, 180);
    expect(ack2.cacheHit).toBe(true);

    // The slice is cut from the resident chromosome, not from one sent again (BG-01M6T68N). It was
    // timed (under 15 ms), which a loaded machine missed with the work unchanged; the work is read
    // instead, at the engine's boundary and in its store. One call goes in, carrying the window's
    // coordinates and no sequence; one reply comes back, the window's size; and the store holds what
    // it held. Wrong implementations: a slice that registers the chromosome again, or that sends its
    // 500,000 bp with the window, sends the sequence in; one that answers with the chromosome sends
    // it back; and one that leaves more in the store (another entry, or an FM-Index, which the store
    // counts in its bytes) changes what it holds.
    const storeBeforeSlice = getResidentStoreStatsRust();
    const encodeInto = vi.spyOn(TextEncoder.prototype, 'encodeInto');
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    let slice: ReturnType<typeof sliceResidentViewportRust>;
    let sent: string[];
    let received: string[];
    try {
      slice = sliceResidentViewportRust(genome500k, 120_001, 121_200);
    } finally {
      sent = encodeInto.mock.calls.map(([json]) => json);
      received = decode.mock.results.map((r) => String(r.value));
      encodeInto.mockRestore();
      decode.mockRestore();
    }
    expect(sent.map((json) => JSON.parse(json)), 'one call, the window and no sequence').toEqual([
      { docId: genome500k.id, startPos: 120_001, endPos: 121_200 },
    ]);
    expect(received, 'one reply').toHaveLength(1);
    // Its two 1,200-base strands and a few fields (2,633 characters when written), not 500,000 bp.
    expect(received[0].length, "the window's size").toBeLessThan(3 * 1_200);
    expect(slice.topStrand.length).toBe(1_200);
    expect(slice.bottomStrand.length).toBe(1_200);
    expect(getResidentStoreStatsRust(), 'the store holds what it held').toEqual(storeBeforeSlice);

    const overview = getResidentTrackOverviewRust(genome500k, 180);
    expect(overview.binCount).toBe(180);
    expect(overview.predictedOricBp).toBeGreaterThanOrEqual(1);
    expect(overview.predictedTercBp).toBeGreaterThanOrEqual(1);

    // The reply is { hits, totalHits, warnings } (BG-01M6S17C); the hits are its list.
    const { hits } = searchResidentMotifFmIndexRust(genome500k, 'GAATTC', true, 40);
    expect(hits.length).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].start).toBeGreaterThanOrEqual(hits[i - 1].start);
    }

    // Giant 10,000 aa protein support with GOR 2°SS and biochemical class tracks
    const protein10k = generateLargeProteinBenchmarkRust(10_000, 'Titin_Ig_Polyprotein');
    expect(protein10k.sequence.length).toBe(10_000);
    expect(protein10k.moleculeType).toBe('Protein');

    const protSlice = sliceResidentViewportRust(protein10k, 1, 120);
    expect(protSlice.topStrand.length).toBe(120);
    expect((protSlice.proteinSecondaryStates ?? '').length).toBe(120);
    expect((protSlice.proteinResidueClasses ?? '').length).toBe(120);

    const statsBeforeEvict = getResidentStoreStatsRust();
    expect(statsBeforeEvict.residentDocCount).toBeGreaterThanOrEqual(2);

    // Eviction + automatic transparent re-registration on subsequent viewport slice
    expect(evictResidentSequenceRust(protein10k.id)).toBe(true);
    const recoveredSlice = sliceResidentViewportRust(protein10k, 61, 120);
    expect(recoveredSlice.topStrand.length).toBe(60);
  });

  it('executes Rust scientific algorithms: protein motifs/signal peptides, 3D Rg/RCO/SASA/Kabsch, Mash ANI, Robinson-Foulds, reaction buffers, and Golden Gate fidelity', () => {
    // 1. Protein functional motif & von Heijne signal-peptide scanner
    const engineeredProtein =
      'MKKTAIAIAVALAGFATVAQA' +
      'MKHHHHHHENLYFQG' +
      'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTT' +
      'GKSGKT' +
      'RGDS' +
      'PKKKRKV' +
      'KDEL';
    const motifReport = scanProteinFunctionalMotifsRust(engineeredProtein);
    expect(motifReport.signalPeptide.hasSignalPeptide).toBe(true);
    expect(motifReport.totalHits).toBeGreaterThanOrEqual(4);
    expect(motifReport.affinityTagsCount).toBeGreaterThanOrEqual(1);
    expect(motifReport.proteaseSitesCount).toBeGreaterThanOrEqual(1);

    // 2. 3D PDB structural geometry (Rg, inertia principal moments, RCO, SASA) & Kabsch SVD
    const samplePdb = synthesizeAlphaHelicalCaPdbFromProtein(
      'eGFP_Core',
      'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTG',
      48
    );
    const geom = analyzePdb3dGeometryRust(samplePdb);
    expect(geom.residueCount).toBe(48);
    expect(geom.radiusOfGyrationAngstrom).toBeGreaterThan(2.5);
    expect(geom.totalEstimatedSasaAngstrom2).toBeGreaterThan(100);

    const selfSuper = alignPdbStructuresKabsch(samplePdb, samplePdb);
    expect(selfSuper.rmsdAngstrom).toBeLessThan(0.01);
    expect(selfSuper.tmScore).toBeGreaterThan(0.99);

    // 3. Mash k-mer minimizer sketch ANI & asymmetric containment
    const refSeq = SAMPLE_LIBRARY[0].sequence;
    const subContig = refSeq.slice(500, 2500);
    const mash = computeMashMinimizerDistanceRust(subContig, refSeq, 13, 5, 1024);
    expect(mash.containmentAInB).toBeGreaterThan(0.95);
    expect(mash.pValue).toBeLessThan(1e-4);

    // 4. Robinson-Foulds phylogenetic tree topology congruence
    const rfSame = compareTreeTopologiesRobinsonFouldsRust(
      '((TaxA:0.1,TaxB:0.1):0.2,(TaxC:0.1,TaxD:0.1):0.2);',
      '((TaxB:0.3,TaxA:0.2):0.1,(TaxD:0.4,TaxC:0.1):0.1);'
    );
    expect(rfSame.robinsonFouldsDistance).toBe(0);
    expect(rfSame.normalizedRf).toBe(0);

    const rfDiff = compareTreeTopologiesRobinsonFouldsRust(
      '((TaxA:0.1,TaxB:0.1):0.2,(TaxC:0.1,TaxD:0.1):0.2);',
      '((TaxA:0.1,TaxC:0.1):0.2,(TaxB:0.1,TaxD:0.1):0.2);'
    );
    expect(rfDiff.robinsonFouldsDistance).toBe(2);
    expect(rfDiff.normalizedRf).toBe(1);

    // 5. Multi-digest reaction buffer matrix, Golden Gate overhang fidelity & Gibson overlap
    const bufPlan = evaluateMultiDigestBufferPlanRust(['EcoRI', 'BamHI']);
    expect(bufPlan.minimumSharedActivityPct).toBeGreaterThanOrEqual(50);
    expect(bufPlan.enzymes.length).toBe(2);

    // Rule-based screen: a clean MoClo set has no flags; no numeric fidelity is claimed.
    const ggFidelity = evaluateGoldenGateFidelityRust(['GGAG', 'TACT', 'AATG', 'GCTT']);
    expect(ggFidelity.overallFidelityPct).toBeNull();
    expect(ggFidelity.palindromicOverhangs.length).toBe(0);
    expect(ggFidelity.riskyPairs.length).toBe(0);
    const ggBad = evaluateGoldenGateFidelityRust(['AATT', 'GGAG', 'CTCC']);
    expect(ggBad.palindromicOverhangs).toEqual(['AATT']);
    expect(ggBad.riskyPairs.some((r) => r.issue.includes('cross-ligate'))).toBe(true);

    const gibson = analyzeGibsonOverlapJunctionRust('GCGTACGTAGCTAGCTAGCGATCGATCG');
    expect(gibson.lengthBp).toBe(28);
    expect(gibson.tmC).toBeGreaterThan(50);

    // 6. Ferguson-Ogston agarose gel physics
    const bands = computeAgaroseGelPhysicsRust([10000, 3000, 1000, 250], 1.0, 'TAE', 80);
    expect(bands.length).toBe(4);
    expect(bands[3].migrationMm).toBeGreaterThan(bands[0].migrationMm);
  });

  it('parses noodles bioinformatics formats, reference databases, .mbc FNV-1a checksums, chromatograms, and built-in macros in Rust', () => {
    const fastq = parseFastqNoodlesRust(
      '@read1\nACGTACGTACGTACGT\n+\nIIIIIIIIIIIIIIII\n@read2\nTTTTCCCCAAAAGGGG\n+\nHHHHHHHHHHHHHHHH\n',
      10
    );
    expect(fastq.readCount).toBe(2);
    expect(fastq.q30BasePct).toBeGreaterThan(95);

    const gffFeats = parseGff3NoodlesRust(
      '##gff-version 3\nchr1\tMolBioCraft\tCDS\t10\t90\t.\t+\t0\tName=egfp_cds\n'
    );
    expect(gffFeats.length).toBe(1);
    expect(gffFeats[0].name).toBe('egfp_cds');

    const vcfVars = parseVcfNoodlesRust(
      '##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t145\t.\tA\tG\t99\tPASS\t.\n'
    );
    expect(vcfVars.length).toBe(1);
    expect(vcfVars[0].position).toBe(145);

    const cats = getReferenceDatabaseCategoriesRust();
    expect(cats.length).toBe(8);
    const records = queryCuratedDatabaseRecordsRust('uniprot', 'GFP');
    expect(records.length).toBeGreaterThanOrEqual(1);
    const builtDoc = buildCuratedDatabaseDocumentRust(records[0].id);
    expect(builtDoc).not.toBeNull();

    const checksum = computeMbcPayloadChecksumRust([
      {
        id: 'd1',
        name: 'Test',
        topology: 'circular',
        moleculeType: 'DNA',
        sequence: 'GAATTC',
        featureCount: 1,
        primerCount: 0,
      },
    ]);
    expect(checksum).toMatch(/^[0-9a-f]{8}$/);

    const sangerDoc = SAMPLE_LIBRARY.find((d) => Boolean(d.chromatogram));
    expect(sangerDoc?.chromatogram).toBeDefined();
    if (sangerDoc?.chromatogram) {
      const vp = computeChromatogramViewportRust(
        sangerDoc.chromatogram,
        0,
        40,
        false,
        true,
        1.0,
        152,
        132
      );
      expect(vp.pathA.startsWith('M')).toBe(true);
      expect(vp.hqTrimEnd1based).toBeGreaterThanOrEqual(vp.hqTrimStart1based);
    }

    const macroRes = executeBuiltinWorkflowMacroRust('js-crispr-spcas9', SAMPLE_LIBRARY[0]);
    expect(macroRes).toBeDefined();
  });

  it('memoizes computeDocumentTableMetrics via WeakMap and sorts documents in O(N) Schwartzian precomputation', () => {
    const doc = SAMPLE_LIBRARY[0];
    const m1 = computeDocumentTableMetrics(doc);
    const m2 = computeDocumentTableMetrics(doc);
    expect(m2).toBe(m1);

    const sortedAsc = sortDocumentsByColumn(
      SAMPLE_LIBRARY,
      'length',
      'asc',
      new Set<string>()
    );
    const sortedDesc = sortDocumentsByColumn(
      SAMPLE_LIBRARY,
      'length',
      'desc',
      new Set<string>()
    );
    expect(sortedAsc[0].sequence.length).toBeLessThanOrEqual(
      sortedAsc[sortedAsc.length - 1].sequence.length
    );
    expect(sortedDesc[0].sequence.length).toBeGreaterThanOrEqual(
      sortedDesc[sortedDesc.length - 1].sequence.length
    );
  });

  it('renders React UI components cleanly: ProteinStructure3DViewer, LinearSequenceView (Colorblind-Safe & 10k aa Protein), and CircularPlasmidMap (500 kbp adaptive ticks)', () => {
    const atoms = synthesizeFoldedCaAtomsFromStates(
      'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTG',
      Array.from({ length: 52 }, (_, i) => (i < 18 ? 'H' : i < 36 ? 'E' : 'C'))
    );
    expect(atoms.length).toBe(52);

    const viewer3dHtml = renderToStaticMarkup(
      React.createElement(ProteinStructure3DViewer, {
        primaryAtoms: atoms,
        title: 'eGFP Beta-Barrel 3D Fold',
        rmsdAngstrom: 0.42,
        tmScore: 0.96,
      })
    );
    expect(viewer3dHtml).toContain('protein-3d-viewer-stage');
    expect(viewer3dHtml).toContain('protein-3d-canvas-viewport');
    expect(viewer3dHtml).toContain('eGFP Beta-Barrel 3D Fold');

    // Okabe-Ito colorblind-safe DNA LinearSequenceView
    const linearCbHtml = renderToStaticMarkup(
      React.createElement(LinearSequenceView, {
        doc: SAMPLE_LIBRARY[0],
        cutSites: [],
        selectedRange: { start: 1, end: 20, label: 'Start' },
        onSelectRange: () => {},
        onUpdateDocument: () => {},
        colorScheme: 'colorblind-safe',
      })
    );
    expect(linearCbHtml).toContain('scheme-colorblind-safe');
    expect(linearCbHtml).toContain('seq-row-deferred');

    // 10,000 aa giant protein LinearSequenceView
    const protein10k = generateLargeProteinBenchmarkRust(10_000, 'Titin_Ig_Polyprotein');
    const linearProtHtml = renderToStaticMarkup(
      React.createElement(LinearSequenceView, {
        doc: protein10k,
        cutSites: [],
        selectedRange: null,
        onSelectRange: () => {},
        onUpdateDocument: () => {},
      })
    );
    expect(linearProtHtml).toContain('molecule-protein');
    expect(linearProtHtml).toContain('GOR 2°SS');
    expect(linearProtHtml).toContain('Biochem');
    expect(linearProtHtml).toContain('10,000 aa');

    // 500,000 bp chromosome adaptive circular ticks (never 500 overlapping labels!)
    const ticks500k = computeAdaptiveCircularTicks(500_000);
    expect(ticks500k.length).toBeGreaterThanOrEqual(5);
    expect(ticks500k.length).toBeLessThanOrEqual(14);
    expect(ticks500k[0].label).toContain('kb');

    const genome500k = generateLargeGenomeBenchmarkRust(500_000, 'Escherichia coli K-12');
    const circular500kHtml = renderToStaticMarkup(
      React.createElement(CircularPlasmidMap, {
        doc: genome500k,
        cutSites: [],
        orfs: [],
        selectedRange: null,
        onSelectRange: () => {},
        showOrfs: true,
        showPrimers: true,
        showUniqueCuttersOnly: true,
      })
    );
    expect(circular500kHtml).toContain('500,000 bp');
    expect(circular500kHtml).toContain('Predicted oriC');
  });

  it('executes Noodles SAM CIGAR pileup, VCF HGVS annotator, interval algebra, large-genome minimizer chaining, and proteomics MS2 in Rust WASM', () => {
    const refSeq = 'GAATTCATGGTGAGCAAGGGCGAGGAGTAACTCGAG';
    const sam = [
      '@HD\tVN:1.6\tSO:coordinate',
      '@SQ\tSN:chr1\tLN:36',
      'r1\t0\tchr1\t1\t60\t30M\t*\t0\t30\tGAATTCATGGCGAGCAAGGGCGAGGAGTAA\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII',
      'r2\t16\tchr1\t1\t60\t30M\t*\t0\t30\tGAATTCATGGCGAGCAAGGGCGAGGAGTAA\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII',
      'r3\t0\tchr1\t1\t60\t30M\t*\t0\t30\tGAATTCATGGCGAGCAAGGGCGAGGAGTAA\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIII',
    ].join('\n');
    const pileup = computeSamPileupAndCoverageNoodlesRust(refSeq, sam, 8);
    expect(pileup.mappedReads).toBe(3);
    expect(pileup.pileupVariants.some((v) => v.positionBp === 11 && v.altAllele === 'C')).toBe(true);

    const vcf = [
      '##fileformat=VCFv4.3',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
      'chr1\t16\t.\tA\tG\t99\tPASS\t.',
    ].join('\n');
    const vcfRep = annotateVcfCodingConsequencesNoodlesRust(
      refSeq,
      [{ id: 'cds1', name: 'eGFP_Mini', type: 'CDS', start: 7, end: 30, strand: 1, color: '#10b981' }],
      vcf,
      11
    );
    expect(vcfRep.annotatedVariants[0]?.consequenceTerm).toBe('missense_variant');
    expect(vcfRep.annotatedVariants[0]?.hgvsProtein).toBe('p.Lys4Glu');

    const ivRep = intersectGenomicIntervalsNoodlesRust('chr1\t0\t20\n', 'chr1\t10\t30\n');
    expect(ivRep.intersectionBp).toBe(10);
    expect(ivRep.unionBp).toBe(30);

    const gA = generateLargeGenomeBenchmarkRust(50_000, 'Escherichia coli K-12').sequence;
    const gB = gA.slice(0, 25_000) + gA.slice(25_015);
    const chainRep = alignLargeGenomesMinimizerChainRust(gA, gB, 10, 15, 64);
    expect(chainRep.targetCoveredPct).toBeGreaterThan(95);

    const prot = 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPT';
    const hsp = searchProteomeBlosum62HspsRust(prot, [{ id: 't1', name: 'eGFP', sequence: prot }]);
    expect(hsp.hits[0]?.identityPct).toBe(100);

    const digest = simulateProteolyticDigestMsRust(prot, 'Trypsin', 1);
    expect(digest.observablePeptideCount).toBeGreaterThan(2);
    const ms2 = simulatePeptideMs2SpectrumRust('GEELFTGVVPILVELDGDVNGHK');
    expect(ms2.peaks.some((p) => p.label === 'y14+')).toBe(true);

    const ptm = scanPostTranslationalModificationsRust('MGSSKSKPKDPSQRRASVNYSKDEL');
    expect(ptm.predictedSubcellularCompartment).toContain('KDEL');
  });

  it('executes newly migrated Rust libraries: Viterbi HMM, JASPAR PSSM, triple_accel SIMD fuzzy search, Mott PHREDProb trim, POA contig assembly, Banded DP, petgraph Newick & Lineage DAGs, csv export, and .mbc CRC32 codec', () => {
    // 1. rust-bio Viterbi 3-state HMM genome compositional segmentation
    const mosaicGenome =
      'AATTAATATTAATTAATATTAATTAATATTAATTAATATT'.repeat(8) +
      'ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGC'.repeat(8) +
      'CGCGCGCGCCGGCGCGCGCGCCGGCGCGCGCGCCGGCGCG'.repeat(8);
    const hmm = segmentGenomeHmmViterbiRust(mosaicGenome);
    expect(hmm.sequenceLengthBp).toBe(mosaicGenome.length);
    expect(hmm.segments.length).toBeGreaterThanOrEqual(2);
    expect(hmm.gcIslandFractionPct).toBeGreaterThan(20);

    // 2. rust-bio DNAMotif JASPAR PSSM/PWM scanner & triple_accel SIMD fuzzy search
    const regSeq = 'GCGTATAAAAGGCGCACGTGACCCTAATACGACTCACTATAGGGAA';
    const pssm = scanJasparPssmMotifsRust(regSeq, 0.85);
    expect(pssm.totalHits).toBeGreaterThanOrEqual(2);
    expect(pssm.hits.some((h) => h.tfName.includes('T7') || h.tfName.includes('TBP'))).toBe(true);

    const fuzzyHits = scanFuzzySubsequenceSimdRust(regSeq, 'TAATACGACTCACTATAG', 1, true, 10);
    expect(fuzzyHits.length).toBeGreaterThanOrEqual(1);
    expect(fuzzyHits[0].editDistance).toBeLessThanOrEqual(1);

    // 3. Mott PHREDProb trace trimming & rust-bio POA multi-read Sanger contig assembly
    const traceDoc = SAMPLE_LIBRARY.find((d) => Boolean(d.chromatogram));
    expect(traceDoc?.chromatogram).toBeDefined();
    if (traceDoc?.chromatogram) {
      const mott = trimSangerTraceMottPhredRust(traceDoc.chromatogram, 0.05);
      expect(mott.trimmedLengthBp).toBeGreaterThan(20);
      expect(mott.expectedErrorsTrimmed).toBeLessThanOrEqual(mott.expectedErrorsRaw + 1e-6);
    }

    const template = 'GAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTC';
    const revCompTemplate = template
      .split('')
      .reverse()
      .map((c) => (c === 'A' ? 'T' : c === 'T' ? 'A' : c === 'G' ? 'C' : 'G'))
      .join('');
    const poa = assembleSangerContigPoaRust(
      [
        { id: 'r1', name: 'Read_Fwd_1', sequence: template.slice(0, 75) },
        { id: 'r2', name: 'Read_Rev_2', sequence: revCompTemplate.slice(0, 75) },
        { id: 'r3', name: 'Read_Fwd_3', sequence: template.slice(12) },
      ],
      'eGFP_POA_Verified',
      false
    );
    expect(poa.consensusLengthBp).toBeGreaterThanOrEqual(75);
    expect(poa.reverseComplementedReads).toBe(1);
    expect(poa.contigDocument.documentKind).toBe('contig');

    // 4. rust-bio Banded Sparse K-mer Pairwise DP
    const banded = alignPairwiseBandedSparseRust(
      template,
      template.slice(0, 30) + 'C' + template.slice(31),
      'global',
      6,
      16
    );
    expect(banded.identityPct).toBeGreaterThan(95);
    expect(banded.cigar.length).toBeGreaterThan(3);

    // 5. petgraph Newick Phylogenetic Tree SVG Layout (phylogram, cladogram, radial)
    const nwk = '((eGFP:0.04,EYFP:0.05)96:0.08,(ECFP:0.06,mCherry:0.22)89:0.11);';
    for (const style of ['phylogram', 'cladogram', 'radial'] as const) {
      const treeSvg = layoutNewickPhylogeneticTreeRust(nwk, style, 640, 320);
      expect(treeSvg.tipCount).toBe(4);
      expect(treeSvg.svgPaths.length).toBeGreaterThanOrEqual(6);
    }

    // 6. Table metrics, csv crate RFC-4180 export, IntervalTree region extraction, modular splicing, petgraph Lineage DAG & macros
    const rowMetrics = computeDocumentTableMetricsRust(SAMPLE_LIBRARY[0]);
    expect(rowMetrics.lengthNum).toBe(SAMPLE_LIBRARY[0].sequence.length);
    expect(rowMetrics.iconKind).toBe('circular-dna');

    const csvText = exportTableDelimitedCsvRust(
      ['Construct', 'Description'],
      [['pET-28a(+)', 'Contains "comma, quote" test']],
      ','
    );
    expect(csvText).toContain('"Contains ""comma, quote"" test"');

    const extracted = extractRegionWithAnnotationsRust(SAMPLE_LIBRARY[0], 1, 600);
    expect(extracted.sequence.length).toBe(600);
    expect(extracted.topology).toBe('linear');

    const spliced = spliceModularPartIntoDocumentRust(
      extracted,
      {
        id: 'part-his6',
        name: '6xHis_Tag',
        category: 'Affinity Tag',
        subCategory: 'Purification Tag',
        hostSystem: 'Bacterial',
        nominalBp: 18,
        featureType: 'CDS',
        source: 'Curated',
        sequence: 'CATCACCATCACCATCAC',
        color: '#2563eb',
        summary: 'Hexahistidine affinity tag',
      },
      10
    );
    expect(spliced.sequence.length).toBe(618);

    const dag = buildConstructLineageDagRust(spliced, [SAMPLE_LIBRARY[0], extracted, spliced]);
    expect(dag.isAcyclic).toBe(true);
    expect(dag.ancestorDocumentCount).toBeGreaterThanOrEqual(1);
    expect(dag.nodes.length).toBeGreaterThanOrEqual(2);

    const macros = getBuiltinWorkflowMacrosRust();
    expect(macros.length).toBeGreaterThanOrEqual(4);
    const pssmMacro = executeBuiltinWorkflowMacroRust(
      'js-jaspar-pssm-tf-scanner',
      SAMPLE_LIBRARY[0]
    );
    expect(pssmMacro).toBeDefined();

    const spikeDoc = buildNcbiReferencePresetDocumentRust('spike');
    expect(spikeDoc.accession).toBe('NC_045512.2');

    // 7. Rust .mbc session format serializer & parser with dual FNV-1a + IEEE CRC32 verification
    const mbcRaw = serializeMbcWorkbench({
      sessionName: 'Rust_Codec_Test',
      documents: [SAMPLE_LIBRARY[0]],
      workspace: {
        activeDocId: SAMPLE_LIBRARY[0].id,
        selectedFolder: 'Sample Documents',
        navHistory: [SAMPLE_LIBRARY[0].id],
        navIndex: 0,
        viewerTab: 'sequence-view',
        mapLayoutMode: 'split',
        zoomLevel: 100,
        textFormat: 'genbank',
        colorScheme: 'standard',
        darkMode: false,
        sidebarOpen: true,
        docTableCollapsed: false,
        selectedRange: null,
        displaySettings: {
          showOrfs: true,
          minOrfAa: 50,
          allowAltStartCodons: false,
          showPrimers: true,
          showTranslation: true,
          showGcGraph: true,
          showHydropathyGraph: false,
          showUniqueCuttersOnly: true,
        },
      },
    });
    expect(isMbcFileOrPayload('Rust_Codec_Test.mbc', mbcRaw)).toBe(true);
    expect(mbcRaw).toContain('"checksumCrc32"');
    const parsedMbc = parseMbcWorkbench(mbcRaw);
    expect(parsedMbc.checksumVerified).toBe(true);
    expect(parsedMbc.warnings.length).toBe(0);
    expect(parsedMbc.envelope.sessionName).toBe('Rust_Codec_Test');
  });

  it('renders accessible CircularPlasmidMap HUD, LinearSequenceView Selection Quick-Action Bar, and declarative light-dismiss StaticModalDialog', () => {
    const sampleDoc = SAMPLE_LIBRARY[0];

    const circHtml = renderToStaticMarkup(
      React.createElement(CircularPlasmidMap, {
        doc: sampleDoc,
        cutSites: [],
        orfs: [],
        selectedRange: { start: 100, end: 135 },
        onSelectRange: () => {},
        showOrfs: true,
        showPrimers: true,
        showUniqueCuttersOnly: true,
        zoomLevel: 100,
      })
    );
    expect(circHtml).toContain('circular-map-hud-bar');
    expect(circHtml).toContain('aria-live="polite"');
    expect(circHtml).toContain('role="button"');
    expect(circHtml).toContain('tabindex="0"');
    expect(circHtml).toContain('>SVG<');

    const linHtml = renderToStaticMarkup(
      React.createElement(LinearSequenceView, {
        doc: sampleDoc,
        cutSites: [],
        selectedRange: { start: 100, end: 135, label: 'Oligo Candidate' },
        onSelectRange: () => {},
        onUpdateDocument: () => {},
        onClearSelection: () => {},
        onExtractSelection: () => {},
        onConvertSelectionToOligo: () => {},
      })
    );
    expect(linHtml).toContain('seq-selection-quickbar');
    expect(linHtml).toContain('Copy RevComp');
    expect(linHtml).toContain('+ Annotate');
    expect(linHtml).toContain('Extract Region');
    expect(linHtml).toContain('+ Save Oligo');
    expect(linHtml).toContain('Clear');

    const modalHtml = renderToStaticMarkup(
      React.createElement(StaticModalDialog, {
        titleId: 'test-modal-title',
        title: 'Scientific Dialog Test',
        sizeClass: 'modal-size-newseq',
        onClose: () => {},
        children: React.createElement('p', null, 'Dialog content'),
      })
    );
    expect(modalHtml).toContain('closedby="any"');
    expect(modalHtml).toContain('aria-labelledby="test-modal-title"');
  });

  it('defines centralized scientific design tokens, user-invalid form rules, high-contrast/forced-colors overrides, and targeted reduced-motion rules', async () => {
    const nodeFsModName = 'node:fs';
    const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as {
      readFileSync: (path: URL, enc: string) => string;
    };
    const appCssRaw = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    expect(appCssRaw).toContain('--mbc-focus-ring:');
    expect(appCssRaw).toContain('--mbc-cb-blue:');
    expect(appCssRaw).toContain('--mbc-nt-a:');
    expect(appCssRaw).toContain(':user-invalid');
    expect(appCssRaw).toContain('@media (prefers-contrast: more)');
    expect(appCssRaw).toContain('@media (forced-colors: active)');
    expect(appCssRaw).toContain('@media (prefers-reduced-motion: reduce)');
    expect(appCssRaw).not.toContain('animation-duration: 0.01ms');
  });
});
