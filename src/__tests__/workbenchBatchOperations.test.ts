// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CircularCalloutInput,
  CircularPlasmidMap,
  layoutCircularCallouts,
} from '../components/CircularPlasmidMap';
import {
  DatabaseExplorerModal,
  LocalSequenceDbEntry,
  ReferenceDatabaseCategoryId,
} from '../components/DatabaseExplorerModal';
import {
  evaluateSingleFilterRule,
  evaluateTableRowFilters,
  WorkbenchColumnsPopover,
  SequenceDocKindIcon,
  WorkbenchFilterPanel,
  WorkbenchSmartTable,
  TableFilterRule,
} from '../components/WorkbenchSmartTable';
import {
  PhylogeneticsStudio,
  SequenceAlignmentStudio,
} from '../components/AlignmentAndPhyloStudio';
import {
  ConstructCockpitBar,
  OKABE_ITO_FEATURE_PALETTE,
} from '../components/ConstructCockpitBar';
import {
  BlastSearchModal,
  PreferencesModal,
} from '../components/MenusPreferencesAndBlastModal';
import {
  GenomeInspectorExtras,
  layoutLinearSchematicFeatures,
  LinearSequenceView,
  NucleotideColorOptionsModal,
} from '../components/LinearSequenceView';
import {
  MolBioAttributeCellValue,
  MolBioColumnHeaderIcon,
  MolBioDocTypeIcon,
  MolBioFeatureTypeBadge,
  MolBioSidebarNodeIcon,
  MolBioSortChevron,
  MolBioStarIcon,
  MolBioStatusBadgeIcon,
  MolBioStrandBadge,
  MolBioViewerTabIcon,
  MolBioVisualDocKind,
  resolveSequenceDocumentVisualKind,
} from '../components/MolBioIcons';
import { findORFs, findRestrictionCutSites, reverseComplement } from '../core/bioEngine';
import { primerRecordFromDoc } from '../core/operationRunners';

const EXCLUDED_COMMERCIAL_SW_B64 =
  'c25hcGdlbmV8ZG90bWF0aWNzfGxhYmFyY2hpdmVzfGdlbmVpb3VzfGJpb21hdHRlcnN8bHVtYXx2ZWN0b3JidWlsZGVyfGJlbmNobGluZ3xkbmFzdGFyfG1hY3ZlY3RvcnxsYXNlcmdlbmV8cHltb2w=';
const EXCLUDED_VENDOR_ONLY_RE = new RegExp(`\\b(${atob(EXCLUDED_COMMERCIAL_SW_B64)})\\b`, 'i');
const EXCLUDED_UI_AND_VENDOR_RE = new RegExp(
  `\\b(video|videos|purchase|${atob(EXCLUDED_COMMERCIAL_SW_B64)})\\b`,
  'i'
);
const EXCLUDED_DB_MODAL_RE = new RegExp(
  `\\b(video|videos|purchase|orders|ordering|${atob(EXCLUDED_COMMERCIAL_SW_B64)})\\b`,
  'i'
);
import {
  addAttBSitesToSequence,
  annotateGatewayAttSites,
  batchModifyAnnotationIntervals,
  batchSetCdsTranslationProperty,
  computeDocumentTableMetrics,
  concatenateSequenceDocuments,
  convertSelectionToOligoPrimer,
  DOC_TABLE_COLUMN_DEFS,
  DOC_TABLE_COLUMN_PRESETS,
  exportLineageBundleGenBank,
  extractAnnotatedFeaturesToDocuments,
  generateConsensusDocument,
  getDefaultVisibleColumnsForFolder,
  getDocumentColumnDisplayValue,
  getFolderAwareDocumentColumns,
  groupDocumentsByPrefix,
  inferDocumentIconKind,
  inferDocumentTypeLabel,
  maskSequenceRegions,
  parseSortableNumericValue,
  randomlySampleDocuments,
  sortColumnsAsciiAlphabetical,
  sortDocumentsByColumn,
} from '../core/workbenchBatchOperations';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { SequenceDocument, SequenceDocumentIconKind } from '../types/bio';

function makeTestDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    id: 'doc-test-1',
    name: 'Test_Construct_A',
    accession: 'MBC_TEST_01',
    description: 'Bacterial test plasmid construct',
    moleculeType: 'DNA',
    topology: 'linear',
    sequence: 'ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAC',
    folder: 'Plasmids & Vectors',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-15T14:30:00.000Z',
    features: [
      {
        id: 'f-cds-1',
        name: 'eGFP_Nterm',
        type: 'CDS',
        start: 1,
        end: 30,
        strand: 1,
        color: '#10b981',
      },
    ],
    primers: [
      {
        id: 'p-1',
        name: 'Fwd_1',
        sequence: 'ATGGTGAGCAAGGGCGAG',
        annealSequence: 'ATGGTGAGCAAGGGCGAG',
        tail5Prime: '',
        bindStart: 1,
        bindEnd: 18,
        strand: 1,
        length: 18,
        gcPercent: 61.1,
        tmAnnealC: 58.4,
        tmFullC: 58.4,
        deltaG37: -22.5,
        hairpinDeltaG: -1.1,
        selfDimerDeltaG: -2.3,
        gcClamp3Prime: true,
      },
    ],
    history: [],
    ...overrides,
  };
}

describe('Customizable Document Table Columns, Sorting & Alignment Metrics', () => {
  it('defines 19 table columns with Name locked visible and 4 domain presets', () => {
    expect(DOC_TABLE_COLUMN_DEFS).toHaveLength(19);
    const nameCol = DOC_TABLE_COLUMN_DEFS.find((c) => c.id === 'name');
    expect(nameCol?.alwaysVisible).toBe(true);

    expect(DOC_TABLE_COLUMN_PRESETS['standard-cloning'].columns).toContain('topology');
    expect(DOC_TABLE_COLUMN_PRESETS['alignment-phylogeny'].columns).toEqual(
      expect.arrayContaining(['numSequences', 'pairwiseIdentity', 'identicalSites', 'treeBuilder'])
    );
    expect(DOC_TABLE_COLUMN_PRESETS['genomics-sequencing'].columns).toContain('meanCoverage');
    expect(DOC_TABLE_COLUMN_PRESETS['all-columns'].columns).toHaveLength(19);
  });

  it('computes document table metrics and infers document type labels across nucleotide, protein, chromatogram, and alignment records', () => {
    const plasmid = makeTestDoc({ topology: 'circular', name: 'pET28a_Test' });
    const plasmidMetrics = computeDocumentTableMetrics(plasmid);
    expect(inferDocumentTypeLabel(plasmid)).toBe('Plasmid / Vector');
    expect(plasmidMetrics.lengthNum).toBe(60);
    expect(plasmidMetrics.lengthLabel).toBe('60 bp');
    expect(plasmidMetrics.annotationsCount).toBe(2);
    expect(plasmidMetrics.geneticCodeLabel).toBe('Bacterial / Plastid (11)');

    const protein = makeTestDoc({
      id: 'doc-prot',
      name: 'SpCas9_Peptide',
      description: 'Purified endonuclease',
      moleculeType: 'Protein',
      sequence: 'MDKKYSIGLDIGTNSVGWAVITDEYKVPSKKFKVLGNTDRHSIKKNLIGALLFDSGETAE',
      features: [],
      primers: [],
    });
    const protMetrics = computeDocumentTableMetrics(protein);
    expect(protMetrics.docTypeLabel).toBe('Protein Sequence');
    expect(protMetrics.lengthLabel).toBe('60 aa');
    expect(protMetrics.gcLabel).toBe('—');

    const treeAligned = makeTestDoc({
      id: 'doc-aln',
      alignmentMeta: {
        sequenceCount: 4,
        pairwiseIdentityPct: 92.4,
        identicalSitesPct: 86.5,
        geneticCodeLabel: 'Standard (1)',
        meanCoverageX: 48.5,
        treeBuilder: 'Neighbor-Joining',
      },
    });
    const alnMetrics = computeDocumentTableMetrics(treeAligned);
    expect(alnMetrics.docTypeLabel).toBe('Phylogenetic Tree');
    expect(alnMetrics.numSequences).toBe(4);
    expect(alnMetrics.pairwiseIdentityLabel).toBe('92.4%');
    expect(alnMetrics.identicalSitesLabel).toBe('86.5%');
    expect(alnMetrics.meanCoverageLabel).toBe('48.5×');
    expect(alnMetrics.treeBuilderLabel).toBe('Neighbor-Joining');
  });

  it('sorts documents deterministically by length, name, pairwiseIdentity, and favorite star status', () => {
    const dShort = makeTestDoc({ id: 'd-short', name: 'Beta_Short', sequence: 'ATGCATGCAT' });
    const dLong = makeTestDoc({
      id: 'd-long',
      name: 'Alpha_Long',
      sequence: 'ATGC'.repeat(25),
      alignmentMeta: { sequenceCount: 3, pairwiseIdentityPct: 97.2 },
    });
    const dMid = makeTestDoc({
      id: 'd-mid',
      name: 'Gamma_Mid',
      sequence: 'ATGC'.repeat(10),
      alignmentMeta: { sequenceCount: 2, pairwiseIdentityPct: 81.0 },
    });

    const byLengthDesc = sortDocumentsByColumn([dShort, dLong, dMid], 'length', 'desc', new Set());
    expect(byLengthDesc.map((d) => d.id)).toEqual(['d-long', 'd-mid', 'd-short']);

    const byNameAsc = sortDocumentsByColumn([dShort, dLong, dMid], 'name', 'asc', new Set());
    expect(byNameAsc.map((d) => d.name)).toEqual(['Alpha_Long', 'Beta_Short', 'Gamma_Mid']);

    const byIdentityDesc = sortDocumentsByColumn(
      [dShort, dLong, dMid],
      'pairwiseIdentity',
      'desc',
      new Set()
    );
    expect(byIdentityDesc.map((d) => d.id)).toEqual(['d-long', 'd-mid', 'd-short']);

    const favs = new Set<string>(['d-mid']);
    const byFavAsc = sortDocumentsByColumn([dShort, dLong, dMid], 'favorite', 'asc', favs);
    expect(byFavAsc[0].id).toBe('d-mid');
  });
});

describe('Batch Sequence, Alignment, Gateway, Lineage & Workflow Operations', () => {
  it('concatenates multiple SequenceDocuments with optional spacer while shifting feature and primer coordinates', () => {
    const partA = makeTestDoc({
      id: 'part-a',
      name: 'Promoter_A',
      sequence: 'AAACCCGGGTTT', // 12 bp
      features: [
        { id: 'fa', name: 'CorePromoter', type: 'promoter', start: 2, end: 10, strand: 1, color: '#2563eb' },
      ],
      primers: [],
    });
    const partB = makeTestDoc({
      id: 'part-b',
      name: 'Reporter_B',
      sequence: 'ATGGCCAAATTTGGGCCC', // 18 bp
      features: [
        { id: 'fb', name: 'ReporterCDS', type: 'CDS', start: 1, end: 18, strand: 1, color: '#10b981' },
      ],
      primers: [
        {
          id: 'pb',
          name: 'Rep_Fwd',
          sequence: 'ATGGCCAAATTT',
          annealSequence: 'ATGGCCAAATTT',
          tail5Prime: '',
          bindStart: 1,
          bindEnd: 12,
          strand: 1,
          length: 12,
          gcPercent: 41.7,
          tmAnnealC: 36.0,
          tmFullC: 36.0,
          deltaG37: -14.0,
          hairpinDeltaG: 0,
          selfDimerDeltaG: -1.0,
          gcClamp3Prime: false,
        },
      ],
    });

    const joined = concatenateSequenceDocuments([partA, partB], 'GAATTC');
    // 12 + 6 + 18 = 36 bp
    expect(joined.sequence).toBe('AAACCCGGGTTTGAATTCATGGCCAAATTTGGGCCC');
    expect(joined.sequence).toHaveLength(36);
    expect(joined.alignmentMeta?.sequenceCount).toBe(2);
    expect(joined.history[0].parentIds).toEqual(['part-a', 'part-b']);

    const shiftedCds = joined.features.find((f) => f.name === 'ReporterCDS');
    expect(shiftedCds?.start).toBe(19);
    expect(shiftedCds?.end).toBe(36);
    expect(joined.primers[0].bindStart).toBe(19);
    expect(joined.primers[0].bindEnd).toBe(30);
  });

  it('generates thresholded IUPAC consensus sequences with pairwise identity and identical sites metrics', () => {
    const s1 = makeTestDoc({ id: 's1', name: 'Isolate_1', sequence: 'ATGGTGAGCAAGGGCGAGGAG' });
    const s2 = makeTestDoc({ id: 's2', name: 'Isolate_2', sequence: 'ATGGTGAGCAAGGGCGAGGAG' });
    const s3 = makeTestDoc({ id: 's3', name: 'Isolate_3', sequence: 'ATGGTGAGCAATGGCGAGGAG' });

    const consensus75 = generateConsensusDocument([s1, s2, s3], 75);
    expect(consensus75.sequence).toHaveLength(21);
    // Position 12 (1-based, index 11) has 2 'G' and 1 'T' (66.7% < 75%) -> IUPAC 'K' (GT)
    expect(consensus75.sequence[11]).toBe('K');
    expect(consensus75.alignmentMeta?.sequenceCount).toBe(3);
    expect(consensus75.alignmentMeta?.pairwiseIdentityPct).toBeGreaterThan(90);
    expect(consensus75.alignmentMeta?.identicalSitesPct).toBeCloseTo((20 / 21) * 100, 1);
  });

  it('masks selected ranges and low-complexity homopolymer tracts cleanly', () => {
    const doc = makeTestDoc({
      sequence: 'ATGCGAAAAAAATCGGGGGGCATGC',
      features: [],
    });

    const selMasked = maskSequenceRegions(doc, 'selection', { start: 3, end: 6 });
    expect(selMasked.maskedBases).toBe(4);
    expect(selMasked.updated.sequence.slice(0, 8)).toBe('ATNNNNAA');

    const homopolymerMasked = maskSequenceRegions(doc, 'low-complexity');
    // 'AAAAAAA' (7) + 'GGGGGG' (6) = 13 masked bases
    expect(homopolymerMasked.maskedBases).toBe(13);
    expect(homopolymerMasked.updated.sequence).toBe('ATGCGNNNNNNNTCNNNNNNCATGC');
  });

  it('extracts forward, reverse-strand, and spliced multi-segment annotations into standalone SequenceDocuments', () => {
    const fwdMotif = 'ATGGCCCTGAAATTTTAG'; // 18 bp
    const revCoding = 'ATGAAACCCGGGTTTTAA'; // 18 bp -> stored as revComp on template
    const templateSeq = `GGGG${fwdMotif}CCCC${reverseComplement(revCoding)}TTTT`;
    const doc = makeTestDoc({
      name: 'Dual_ORF_Vector',
      sequence: templateSeq,
      features: [
        {
          id: 'f-fwd',
          name: 'OrfFwd',
          type: 'CDS',
          start: 5,
          end: 22,
          strand: 1,
          color: '#10b981',
        },
        {
          id: 'f-rev',
          name: 'OrfRev',
          type: 'CDS',
          start: 27,
          end: 44,
          strand: -1,
          color: '#ef4444',
        },
      ],
    });

    const extracted = extractAnnotatedFeaturesToDocuments(doc, 'CDS');
    expect(extracted).toHaveLength(2);
    expect(extracted[0].sequence).toBe(fwdMotif);
    expect(extracted[1].sequence).toBe(revCoding);
    expect(extracted[1].history.at(-1)?.parentIds).toContain(doc.id);
  });

  it('converts selected subsequence regions into forward or reverse PrimerRecords with thermodynamic metrics', () => {
    const doc = makeTestDoc({ primers: [] });
    const { updatedDoc, primer } = convertSelectionToOligoPrimer(doc, { start: 1, end: 20 }, -1);
    expect(primer.strand).toBe(-1);
    expect(primer.length).toBe(20);
    expect(primer.sequence).toBe(reverseComplement(doc.sequence.slice(0, 20)));
    expect(primer.tmAnnealC).toBeGreaterThan(40);
    expect(updatedDoc.primers).toHaveLength(1);
  });

  it('flanks inserts with Gateway attB1/attB2 sites and detects Gateway att recombination motifs without duplicates', () => {
    const insertDoc = makeTestDoc({
      name: 'eGFP_ORF',
      sequence: 'ATGGTGAGCAAGGGCGAGGAGCTGTTCACC',
      features: [],
    });

    const amplicon = addAttBSitesToSequence(insertDoc);
    expect(amplicon.sequence.startsWith('GGGGACAAGTTTGTACAAAAAAGCAGGCTAA')).toBe(true);
    expect(amplicon.sequence.endsWith('TTACCCAGCTTTCTTGTACAAAGTGGTCCCC')).toBe(true);
    expect(amplicon.features.map((f) => f.name)).toEqual(['attB1', 'eGFP_ORF_Insert', 'attB2']);

    // Strip pre-existing features to verify de-novo Gateway att site scanning
    const unannotatedAmplicon: SequenceDocument = { ...amplicon, features: [] };
    const scan1 = annotateGatewayAttSites(unannotatedAmplicon);
    expect(scan1.addedCount).toBeGreaterThanOrEqual(2);
    expect(scan1.updatedDoc.features.some((f) => f.name === 'attB1')).toBe(true);
    expect(scan1.updatedDoc.features.some((f) => f.name.includes('attB2'))).toBe(true);

    // Re-scanning an already annotated construct should not add duplicate attB1/attB2 features at same coordinates
    const scan2 = annotateGatewayAttSites(scan1.updatedDoc);
    expect(scan2.addedCount).toBe(0);
  });

  it('exports full ancestor and descendant lineage bundles in multi-record GenBank format', () => {
    const grandparent = makeTestDoc({ id: 'gp-1', name: 'Parent_Vector' });
    const child = makeTestDoc({
      id: 'ch-1',
      name: 'Cloned_Construct',
      history: [
        {
          id: 'h1',
          timestamp: '2026-10-30 10:00',
          operation: 'Gibson Assembly',
          description: 'Assembled from Parent_Vector',
          parentIds: ['gp-1'],
          lengthBp: 60,
          topology: 'circular',
        },
      ],
    });
    const grandchild = makeTestDoc({
      id: 'gc-1',
      name: 'Mutated_Derivative',
      history: [
        {
          id: 'h2',
          timestamp: '2026-10-30 11:00',
          operation: 'SDM',
          description: 'Point mutation on Cloned_Construct',
          parentIds: ['ch-1'],
          lengthBp: 60,
          topology: 'circular',
        },
      ],
    });
    const unrelated = makeTestDoc({ id: 'unrel-1', name: 'Unrelated_Control' });

    const bundle = exportLineageBundleGenBank(child, [grandparent, child, grandchild, unrelated]);
    expect(bundle.includedNames).toEqual([
      'Parent_Vector',
      'Cloned_Construct',
      'Mutated_Derivative',
    ]);
    expect(bundle.content).toContain('LOCUS');
    expect((bundle.content.match(/^LOCUS\s+/gm) || []).length).toBe(3);
  });

  it('executes batch workflow operations: interval modification, CDS translation qualifiers, random sampling, and prefix grouping', () => {
    const doc = makeTestDoc({
      sequence: 'AAACCCATGGTGAGCAAGGGCGAGGAGCTGTTCACCTAA', // CDS at 7..39 (33 bp = 10 aa + stop)
      features: [
        { id: 'f1', name: 'MiniORF', type: 'CDS', start: 7, end: 39, strand: 1, color: '#10b981' },
      ],
    });

    const translated = batchSetCdsTranslationProperty(doc);
    expect(translated.features[0].qualifiers?.translation).toBe('MVSKGEELFT');

    const widened = batchModifyAnnotationIntervals(doc, -3, 0);
    expect(widened.features[0].start).toBe(4);
    expect(widened.features[0].end).toBe(39);

    const pool = [
      makeTestDoc({ id: '1', name: 'BRCA1_Exon1' }),
      makeTestDoc({ id: '2', name: 'BRCA1_Exon2' }),
      makeTestDoc({ id: '3', name: 'TP53_Exon4' }),
      makeTestDoc({ id: '4', name: 'TP53_Exon5' }),
      makeTestDoc({ id: '5', name: 'SingletonConstruct' }),
    ];

    const sampledA = randomlySampleDocuments(pool, 3, 42);
    const sampledB = randomlySampleDocuments(pool, 3, 42);
    expect(sampledA).toHaveLength(3);
    expect(sampledA.map((d) => d.id)).toEqual(sampledB.map((d) => d.id));

    const grouped = groupDocumentsByPrefix(pool);
    expect(grouped.groupsCreated).toEqual(['Group_BRCA1', 'Group_TP53']);
    expect(grouped.updatedDocs[0].folder).toBe('Group_BRCA1');
    expect(grouped.updatedDocs[2].folder).toBe('Group_TP53');
    expect(grouped.updatedDocs[4].folder).toBe('Plasmids & Vectors');
  });

  it('renders DatabaseExplorerModal statically across all 8 NCBI, UniProt, and Local BLAST categories with zero forbidden terms', () => {
    const categories: ReferenceDatabaseCategoryId[] = [
      'ncbi-gene',
      'ncbi-nucleotide',
      'ncbi-protein',
      'ncbi-pubmed',
      'ncbi-structure',
      'ncbi-taxonomy',
      'uniprot',
      'local-blast-dbs',
    ];
    const sampleLocalDbs: LocalSequenceDbEntry[] = [
      {
        id: 'ldb-1',
        name: 'Active_Project_Nucleotide_DB',
        moleculeType: 'Nucleotide',
        sourceFolder: 'All Project Files',
        sequenceCount: SAMPLE_LIBRARY.length,
      },
    ];
    const noop = () => {};

    for (const cat of categories) {
      const html = renderToStaticMarkup(
        React.createElement(DatabaseExplorerModal, {
          initialCategory: cat,
          documents: SAMPLE_LIBRARY,
          localDatabases: sampleLocalDbs,
          onAddLocalDatabase: noop,
          onRemoveLocalDatabase: noop,
          onImportDocument: noop,
          onOpenBlastModal: noop,
          onClose: noop,
        })
      );
      expect(html).toContain('<dialog');
      expect(html).toContain('closedby="any"');
      expect(html).toContain('class="prefs-modal-window modal-size-db"');
      expect(html).not.toMatch(EXCLUDED_DB_MODAL_RE);
    }
  });
});

describe('Collision-Free Circular Plasmid Map & Linear Schematic Typography Layouts', () => {
  it('separates dense CircularPlasmidMap callout labels without vertical overlap or crossing leader lines', () => {
    const plasmid = SAMPLE_LIBRARY[0]; // pET-28a(+)-eGFP (6,061 bp, clustered T7/lacO/RBS/6xHis + 46 cut sites)
    const cutSites = findRestrictionCutSites(plasmid.sequence, plasmid.topology);
    const orfs = findORFs(plasmid.sequence, 50);

    const denseInputs: CircularCalloutInput[] = [
      ...plasmid.features.map((f) => ({
        id: `feat-${f.id}`,
        kind: 'feature' as const,
        priority: 1,
        angleDeg: (((f.start + f.end) / 2 / plasmid.sequence.length) * 360) % 360,
        anchorRadius: f.strand === -1 ? 135.5 : 156.5,
        label: f.name,
        color: '#0f172a',
        lineColor: f.color,
        bold: true,
        hoverText: f.name,
        selectRange: { start: f.start, end: f.end, label: f.name },
      })),
      ...plasmid.primers.map((p) => ({
        id: `prm-${p.id}`,
        kind: 'primer' as const,
        priority: 2,
        angleDeg: (((p.bindStart + p.bindEnd) / 2 / plasmid.sequence.length) * 360) % 360,
        anchorRadius: 158,
        label: p.name,
        color: '#15803d',
        lineColor: '#16a34a',
        bold: true,
        hoverText: p.name,
        selectRange: { start: p.bindStart, end: p.bindEnd, label: p.name },
      })),
      ...cutSites.map((cs) => ({
        id: `cut-${cs.id}`,
        kind: 'enzyme-multi' as const,
        priority: 3,
        angleDeg: ((cs.position / plasmid.sequence.length) * 360) % 360,
        anchorRadius: 148,
        label: `${cs.enzyme.name} (${cs.cutTop})`,
        color: '#1d4ed8',
        lineColor: '#2563eb',
        bold: false,
        hoverText: cs.enzyme.name,
        selectRange: {
          start: cs.position,
          end: cs.position + cs.enzyme.recognitionSeq.length - 1,
          label: cs.enzyme.name,
        },
      })),
    ];

    const placed = layoutCircularCallouts(denseInputs, {
      cx: 340,
      cy: 270,
      viewHeight: 540,
      rKnee: 170,
      rEnvelope: 186,
      minGapY: 17.5,
      marginY: 22,
      maxPerSide: 25,
    });

    expect(placed.length).toBeGreaterThan(20);

    for (const side of ['right', 'left'] as const) {
      const sideItems = placed.filter((p) => p.side === side);
      for (let i = 0; i < sideItems.length; i++) {
        expect(sideItems[i].labelY).toBeGreaterThanOrEqual(21.9);
        expect(sideItems[i].labelY).toBeLessThanOrEqual(518.1);
        if (i > 0) {
          // Strictly monotonic downward and separated by >= minGapY so labels never collide
          expect(sideItems[i].labelY - sideItems[i - 1].labelY).toBeGreaterThanOrEqual(17.4);
        }
      }
    }

    const noop = () => {};
    const mapHtml = renderToStaticMarkup(
      React.createElement(CircularPlasmidMap, {
        doc: plasmid,
        cutSites,
        orfs,
        selectedRange: { start: 5192, end: 5911 },
        onSelectRange: noop,
        showOrfs: true,
        showPrimers: true,
        showUniqueCuttersOnly: false,
      })
    );
    expect(mapHtml).toContain('viewBox="0 0 680 540"');
    expect(mapHtml).not.toMatch(/font-size="[0-9](\.[0-9]+)?"/);
  });

  it('packs LinearSequenceView schematic annotations into non-overlapping lanes clamped within SVG bounds', () => {
    const plasmid = SAMPLE_LIBRARY[0]; // pET-28a(+)-eGFP
    const cutSites = findRestrictionCutSites(plasmid.sequence, plasmid.topology);
    const { placed, laneCount } = layoutLinearSchematicFeatures(
      plasmid.features,
      plasmid.sequence.length,
      3
    );

    expect(placed).toHaveLength(plasmid.features.length);
    expect(laneCount).toBeGreaterThanOrEqual(2);
    expect(laneCount).toBeLessThanOrEqual(3);

    for (let lane = 0; lane < laneCount; lane++) {
      const labeledInLane = placed
        .filter((p) => p.lane === lane && p.labelMode !== 'none')
        .sort((a, b) => a.occStart - b.occStart);
      for (let i = 0; i < labeledInLane.length; i++) {
        expect(labeledInLane[i].occStart).toBeGreaterThanOrEqual(8);
        expect(labeledInLane[i].occEnd).toBeLessThanOrEqual(792);
        if (i > 0) {
          expect(labeledInLane[i].occStart).toBeGreaterThanOrEqual(
            labeledInLane[i - 1].occEnd + 5.9
          );
        }
      }
    }

    const noop = () => {};
    const linearHtml = renderToStaticMarkup(
      React.createElement(LinearSequenceView, {
        doc: plasmid,
        cutSites,
        selectedRange: { start: 5192, end: 5911, label: 'eGFP' },
        onSelectRange: noop,
        onUpdateDocument: noop,
        showTranslation: true,
        showGcGraph: true,
        showHydropathyGraph: true,
      })
    );
    expect(linearHtml).toContain('viewBox="0 0 800 66"');
    expect(linearHtml).not.toMatch(/font-size="[0-9](\.[0-9]+)?"/);
  });
});

describe('Folder-Aware Dynamic Columns, Universal Table Filter & Column Popover Suite', () => {
  it('populates SAMPLE_LIBRARY across all project folders and all 5 Genomes subfolders with authentic metadata and zero forbidden vendor names', () => {
    const folders = new Set(SAMPLE_LIBRARY.map((d) => d.folder));
    for (const requiredFolder of [
      'Alignments',
      'Cloning',
      'Contig Assembly',
      'Plasmids & Vectors',
      'Primers',
      'Protein Documents',
      'Tree Documents',
      'Genomes/Bacteria',
      'Genomes/Eukaryotes',
      'Genomes/Human',
      'Genomes/Plants',
      'Genomes/Viruses',
    ] as const) {
      expect(folders.has(requiredFolder)).toBe(true);
    }

    for (const doc of SAMPLE_LIBRARY) {
      const combinedText = `${doc.name} ${doc.description} ${JSON.stringify(doc.docMetadata ?? {})}`;
      expect(combinedText).not.toMatch(EXCLUDED_VENDOR_ONLY_RE);
    }
  });

  it('expands folder-driven dynamic columns, discovers custom docMetadata keys, and sorts checklists in strict ASCII-alphabetical order with Name locked', () => {
    const alignmentsDocs = SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments');
    const alnCols = getFolderAwareDocumentColumns(alignmentsDocs, 'Alignments');
    const alnLabels = alnCols.map((c) => c.label);
    expect(alnLabels).toContain('Icon');
    expect(alnLabels).toContain('Name');
    expect(alnLabels).toContain('# Sequences');
    expect(alnLabels).toContain('% Identical Sites');
    expect(alnLabels).toContain('% Pairwise Identity');
    expect(alnLabels).toContain('Alignment method');
    expect(alnCols.find((c) => c.id === 'name')?.alwaysVisible).toBe(true);
    expect(alnCols.find((c) => c.id === 'icon')?.alwaysVisible).toBeFalsy();

    // Verify strict ASCII code-point order: '#' (35) < '%' (37) < '0'-'9' < 'A'-'Z' < 'a'-'z' < '★'
    const sortedChecklist = sortColumnsAsciiAlphabetical([
      { id: 'name', label: 'Name' },
      { id: 'pctId', label: '% Pairwise Identity' },
      { id: 'numSeq', label: '# Sequences' },
      { id: 'fav', label: '★' },
      { id: 'chr', label: 'chromosome' },
      { id: 'fivePrime', label: "5' Extension" },
      { id: 'acc', label: 'Accession' },
    ]);
    expect(sortedChecklist.map((c) => c.label)).toEqual([
      '# Sequences',
      '% Pairwise Identity',
      "5' Extension",
      'Accession',
      'Name',
      'chromosome',
      '★',
    ]);

    // Verify Genomes parent folder aggregates all 5 Genomes/* subfolders and discovers custom docMetadata keys
    const customGenome = makeTestDoc({
      id: 'g-custom',
      folder: 'Genomes/Bacteria',
      docMetadata: {
        Organism: 'Escherichia coli',
        'Custom Biosafety Tier': 'BSL-1',
      },
    });
    const genomeDocs = [
      ...SAMPLE_LIBRARY.filter((d) => d.folder.startsWith('Genomes/')),
      customGenome,
    ];
    const genomeCols = getFolderAwareDocumentColumns(genomeDocs, 'Genomes');
    const genomeLabels = genomeCols.map((c) => c.label);
    expect(genomeLabels).toContain('Organism');
    expect(genomeLabels).toContain('Sequencing Technology (Genome-Assembly-Data)');
    expect(genomeLabels).toContain('chromosome');
    expect(genomeLabels).toContain('Custom Biosafety Tier');

    const customCol = genomeCols.find((c) => c.label === 'Custom Biosafety Tier')!;
    expect(customCol).toBeDefined();
    expect(
      getDocumentColumnDisplayValue(
        customGenome,
        computeDocumentTableMetrics(customGenome),
        customCol.id,
        false
      )
    ).toBe('BSL-1');
    expect(
      getDocumentColumnDisplayValue(
        SAMPLE_LIBRARY[0],
        computeDocumentTableMetrics(SAMPLE_LIBRARY[0]),
        customCol.id,
        false
      )
    ).toBe('-');

    // Verify folder-specific default visible column sets always keep Name and Icon visible
    for (const folder of [
      'Alignments',
      'Cloning',
      'Contig Assembly',
      'Primers',
      'Protein Documents',
      'Tree Documents',
      'Genomes',
      'Genomes/Human',
    ]) {
      const folderCols = getFolderAwareDocumentColumns(SAMPLE_LIBRARY, folder);
      const defaults = getDefaultVisibleColumnsForFolder(folder, folderCols);
      expect(defaults).toContain('name');
      expect(defaults).toContain('icon');
    }

    // Verify distinct document-type icon inference across all 8 biological kinds
    const observedKinds = new Set(SAMPLE_LIBRARY.map((d) => inferDocumentIconKind(d)));
    for (const k of [
      'circular-dna',
      'linear-dna',
      'primer',
      'alignment',
      'contig',
      'trace',
      'protein',
      'tree',
    ] as SequenceDocumentIconKind[]) {
      expect(observedKinds.has(k)).toBe(true);
      const svgHtml = renderToStaticMarkup(React.createElement(SequenceDocKindIcon, { kind: k }));
      expect(svgHtml).toContain('mbc-doc-svg-icon');
    }

    // Verify sorting by folder-specific / dynamic metadata columns
    const sortedGenomes = sortDocumentsByColumn(genomeDocs, 'organism', 'asc', new Set());
    expect(sortedGenomes.length).toBe(genomeDocs.length);
  });

  it('evaluates quick search and multi-rule structured column filters with unit-aware numeric comparisons', () => {
    expect(parseSortableNumericValue('6,061 bp')).toBe(6061);
    expect(parseSortableNumericValue('58.4 °C')).toBe(58.4);
    expect(parseSortableNumericValue('-8.2 kcal/mol')).toBe(-8.2);
    expect(parseSortableNumericValue('1.5e-42')).toBeCloseTo(1.5e-42);
    expect(parseSortableNumericValue('-')).toBeNull();

    expect(evaluateSingleFilterRule('6,061 bp', 'gt', '5000')).toBe(true);
    expect(evaluateSingleFilterRule('6,061 bp', 'lt', '5000')).toBe(false);
    expect(evaluateSingleFilterRule('58.4 °C', 'lte', '60')).toBe(true);
    expect(evaluateSingleFilterRule('pET-28a(+)-eGFP', 'starts-with', 'pet-28')).toBe(true);
    expect(evaluateSingleFilterRule('Circular', 'not-contains', 'linear')).toBe(true);

    const rowCells: Record<string, string> = {
      name: 'pET-28a(+)-eGFP',
      topology: 'Circular',
      length: '6,061 bp',
      gc: '53.8%',
    };
    const cols = ['name', 'topology', 'length', 'gc'];

    const rulesAllPass: TableFilterRule[] = [
      { id: 'r1', colId: 'topology', operator: 'equals', value: 'circular' },
      { id: 'r2', colId: 'length', operator: 'gte', value: '6000' },
    ];
    expect(
      evaluateTableRowFilters((c) => rowCells[c] ?? '', cols, 'egfp', rulesAllPass, 'all')
    ).toBe(true);

    const rulesOneFail: TableFilterRule[] = [
      ...rulesAllPass,
      { id: 'r3', colId: 'gc', operator: 'gt', value: '60' },
    ];
    expect(
      evaluateTableRowFilters((c) => rowCells[c] ?? '', cols, '', rulesOneFail, 'all')
    ).toBe(false);
    expect(
      evaluateTableRowFilters((c) => rowCells[c] ?? '', cols, '', rulesOneFail, 'any')
    ).toBe(true);
  });

  it('renders Filter & Columns sub-toolbar, ASCII-alphabetical Columns popover, and inline Filter panel cleanly across workbench tables', () => {
    const noop = () => {};

    const smartTableHtml = renderToStaticMarkup(
      React.createElement(
        WorkbenchSmartTable,
        {
          tableId: 'unit-test-table',
          tableLabel: 'Restriction Digest Fragments',
          className: 'bio-table',
        },
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            null,
            React.createElement('th', null, 'Fragment'),
            React.createElement('th', null, 'Length (bp)'),
            React.createElement('th', null, '%GC')
          )
        ),
        React.createElement(
          'tbody',
          null,
          React.createElement(
            'tr',
            null,
            React.createElement('td', null, 'Frag_A'),
            React.createElement('td', null, '4,210 bp'),
            React.createElement('td', null, '52.4%')
          ),
          React.createElement(
            'tr',
            null,
            React.createElement('td', null, 'Frag_B'),
            React.createElement('td', null, '1,851 bp'),
            React.createElement('td', null, '56.9%')
          )
        )
      )
    );
    expect(smartTableHtml).toContain('mbc-table-subtoolbar');
    expect(smartTableHtml).toContain('mbc-filter-trigger-btn');
    expect(smartTableHtml).toContain('>Filter</span>');
    expect(smartTableHtml).toContain('2 rows');
    expect(smartTableHtml).toContain('mbc-columns-trigger-btn');
    expect(smartTableHtml).toContain('>Columns</span>');
    expect(smartTableHtml).toContain('role="region"');
    expect(smartTableHtml).toContain('tabindex="0"');

    const popoverHtml = renderToStaticMarkup(
      React.createElement(WorkbenchColumnsPopover, {
        anchorRect: null,
        columns: [
          { id: 'name', label: 'Name', alwaysVisible: true },
          { id: 'icon', label: 'Icon' },
          { id: 'pctGc', label: '%GC' },
          { id: 'numSeq', label: '# Sequences' },
        ],
        visibleColIds: ['icon', 'name', 'pctGc'],
        lockColumnOrder: false,
        onToggleColumn: noop,
        onToggleLockColumnOrder: noop,
        onLoadColumnState: noop,
        onSaveColumnState: noop,
        onClose: noop,
      })
    );
    expect(popoverHtml).toContain('Lock Column Order');
    expect(popoverHtml).toContain('Load Column State...');
    expect(popoverHtml).toContain('Save Current State...');
    expect(popoverHtml).toContain('locked-primary');
    expect(popoverHtml).toContain('disabled=""');
    // Verify ASCII order inside rendered popover: '# Sequences' -> '%GC' -> 'Icon' -> 'Name'
    expect(popoverHtml.indexOf('# Sequences')).toBeLessThan(popoverHtml.indexOf('%GC'));
    expect(popoverHtml.indexOf('%GC')).toBeLessThan(popoverHtml.indexOf('>Icon<'));
    expect(popoverHtml.indexOf('>Icon<')).toBeLessThan(popoverHtml.indexOf('>Name<'));

    const filterPanelHtml = renderToStaticMarkup(
      React.createElement(WorkbenchFilterPanel, {
        columns: [
          { id: 'name', label: 'Name', alwaysVisible: true },
          { id: 'length', label: 'Sequence Length' },
        ],
        quickFilter: 'eGFP',
        onQuickFilterChange: noop,
        rules: [{ id: 'r1', colId: 'length', operator: 'gt', value: '1000' }],
        onRulesChange: noop,
        matchMode: 'all',
        onMatchModeChange: noop,
      })
    );
    expect(filterPanelHtml).toContain('+ Column Rule');
    expect(filterPanelHtml).toContain('Clear');

    // Verify upgraded tables across PhylogeneticsStudio, BlastSearchModal, and PreferencesModal render Filter + Columns sub-toolbars with zero forbidden terms
    const phyloDataHtml = renderToStaticMarkup(
      React.createElement(PhylogeneticsStudio, {
        documents: SAMPLE_LIBRARY,
        activeDoc: SAMPLE_LIBRARY[0],
        initialPhyloTab: 'data',
      })
    );
    expect(phyloDataHtml).toContain('mbc-table-subtoolbar');
    expect(phyloDataHtml).toContain('>Filter</span>');
    expect(phyloDataHtml).toContain('>Columns</span>');

    const phyloClocksHtml = renderToStaticMarkup(
      React.createElement(PhylogeneticsStudio, {
        documents: SAMPLE_LIBRARY,
        activeDoc: SAMPLE_LIBRARY[0],
        initialPhyloTab: 'clocks',
      })
    );
    expect(phyloClocksHtml).toContain('aria-label="Molecular Clock Maximum Likelihood LRT"');
    expect(phyloClocksHtml).not.toContain('rowspan=');

    const blastHtml = renderToStaticMarkup(
      React.createElement(BlastSearchModal, {
        activeDoc: SAMPLE_LIBRARY[0],
        allDocs: SAMPLE_LIBRARY,
        onClose: noop,
        onSelectHitDoc: noop,
      })
    );
    expect(blastHtml).toContain('mbc-table-subtoolbar');

    const prefsKeyboardHtml = renderToStaticMarkup(
      React.createElement(PreferencesModal, {
        initialTab: 'Keyboard',
        onClose: noop,
        themeMode: 'system',
        onChangeTheme: noop,
      })
    );
    expect(prefsKeyboardHtml).toContain('mbc-table-subtoolbar');

    for (const html of [
      smartTableHtml,
      popoverHtml,
      filterPanelHtml,
      phyloDataHtml,
      phyloClocksHtml,
      blastHtml,
      prefsKeyboardHtml,
    ]) {
      expect(html).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);
    }
  });

  it('populates all 12 Sample Documents leaf folders with >= 5 distinct biological subjects each (102 total) and exposes them in the sidebar tree', async () => {
    // 102 since US-01M6TGKH dropped the fictitious-character People alignment and its tree (D0094).
    expect(SAMPLE_LIBRARY.length).toBe(102);

    const expectedLeafFolders = [
      'Alignments',
      'Cloning',
      'Contig Assembly',
      'Genomes/Bacteria',
      'Genomes/Eukaryotes',
      'Genomes/Human',
      'Genomes/Plants',
      'Genomes/Viruses',
      'Plasmids & Vectors',
      'Primers',
      'Protein Documents',
      'Tree Documents',
    ];

    const seenIds = new Set<string>();
    for (const folder of expectedLeafFolders) {
      const docsInFolder = SAMPLE_LIBRARY.filter((d) => d.folder === folder);
      // Every tree must carry a real stored topology; the reference set has only a few: two,
      // COXII and Three Kingdoms, since US-01M6TGKH dropped the People tree with its alignment (D0094).
      expect(docsInFolder.length).toBeGreaterThanOrEqual(folder === 'Tree Documents' ? 2 : 5);
    }

    const genomesAggregate = SAMPLE_LIBRARY.filter((d) => d.folder.startsWith('Genomes/'));
    expect(genomesAggregate.length).toBe(33);

    // Subjects that must NOT be duplicated in MolBioCraft's Sample Documents.
    // Deliberately absent from this list: yadF (the CDS and its four BioBrick / Gateway primers
    // are curated Cloning samples) and 1A4Y / 1D66 (curated Protein Documents carrying measured
    // C-alpha coordinates). 1A4Y's tracked C-alpha trace is also the geometry-validation fixture
    // in molbiocraft-protein, which reads the same trace the sample library carries.
    const referenceSubjectsRe =
      /\b(pCRII-TOPO|pDEST15|pDONR201|pSB1C3|TetR repressiple|Oryza sativa|NADH2)\b/i;

    for (const doc of SAMPLE_LIBRARY) {
      expect(seenIds.has(doc.id)).toBe(false);
      seenIds.add(doc.id);
      // Contig-summary genome records carry annotations only: no invented bases, and features
      // placed on the declared chromosome length rather than squeezed onto a placeholder.
      const isSummary = Boolean(doc.docMetadata?.['Is Contig Summary']);
      const span = isSummary ? Number(doc.docMetadata?.['Declared Length']) : doc.sequence.length;
      if (isSummary) expect(doc.sequence).toBe('');
      else expect(doc.sequence.length).toBeGreaterThanOrEqual(15);
      expect(span).toBeGreaterThan(0);

      for (const feat of doc.features) {
        expect(feat.start).toBeGreaterThanOrEqual(1);
        expect(feat.start).toBeLessThanOrEqual(span);
        expect(feat.end).toBeGreaterThanOrEqual(1);
        expect(feat.end).toBeLessThanOrEqual(span);
      }

      const serializedMeta = JSON.stringify({
        name: doc.name,
        description: doc.description,
        accession: doc.accession,
        docMetadata: doc.docMetadata,
      });
      expect(serializedMeta).not.toMatch(EXCLUDED_DB_MODAL_RE);
      expect(serializedMeta).not.toMatch(referenceSubjectsRe);
    }

    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appSrc = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const appCss = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    const treeSrc = readFileSync(new URL('../components/ProjectFolderTree.tsx', import.meta.url), 'utf8');
    expect(appSrc).toContain("id: 'Sample Documents', label: 'Sample Documents'");
    expect(appSrc).toContain('<ProjectFolderTree');
    expect(appSrc).toContain('counts={explorerFolderCounts}');
    expect(treeSrc).toContain('aria-expanded={hasChildren ? open : undefined}');
    expect(appSrc).toContain("matchFolders: ['Cloning', 'Cloning Inserts & PCR']");
    expect(appCss).toContain('.tree-leaf-spacer');
  });

  it('populates the 7 Alignments sample documents, 23 Alignments table columns, and the SequenceAlignmentStudio grid with its analyses on the inspector rail', () => {
    const alignmentDocs = SAMPLE_LIBRARY.filter((d) => d.folder === 'Alignments');
    expect(alignmentDocs.map((d) => d.name)).toEqual([
      'COXII CDS',
      'HIV env',
      'Ig variable region',
      'LysR family',
      'Pairwise protein',
      'Three Kingdoms',
      'Transcript variants',
    ]);

    const coxiiDoc = alignmentDocs.find((d) => d.id === 'doc-aln-coxii-cds')!;
    expect(coxiiDoc).toBeDefined();
    expect(coxiiDoc.alignmentMeta?.isAligned).toBe(true);
    expect(coxiiDoc.alignmentMeta?.sequences?.length).toBe(50);

    const coxiiMetrics = computeDocumentTableMetrics(coxiiDoc);
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'length')).toBe('729');
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'numSequences')).toBe('50');
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'pairwiseIdentity')).toBe('72.2%');
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'identicalSites')).toBe('33.2%');
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'geneticCode')).toBe(
      'Vertebrate Mitochondrial'
    );
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'maxSeqLength')).toBe('705');
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'minSeqLength')).toBe('684');
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'freeEndGaps')).toBe('-');
    expect(getDocumentColumnDisplayValue(coxiiDoc, coxiiMetrics, 'numNucleotides')).toBe('34,300');

    const threeKingdomsDoc = alignmentDocs.find((d) => d.id === 'doc-aln-three-kingdoms')!;
    const tkMetrics = computeDocumentTableMetrics(threeKingdomsDoc);
    expect(getDocumentColumnDisplayValue(threeKingdomsDoc, tkMetrics, 'numSequences')).toBe('35');
    expect(getDocumentColumnDisplayValue(threeKingdomsDoc, tkMetrics, 'alignmentMethod')).toBe(
      'MolBioCraft MSA'
    );

    const alignmentsFolderCols = getFolderAwareDocumentColumns(alignmentDocs, 'Alignments');
    const colLabels = alignmentsFolderCols.map((c) => c.label);
    for (const expectedLabel of [
      'Name',
      'Description',
      'Modified',
      'Sequence Length',
      '# Sequences',
      '% Pairwise Identity',
      '% Identical Sites',
      'Genetic Code',
      'Alignment method',
      'Max Sequence Length',
      'Min Sequence Length',
      'Free end gaps',
      'Alignment options',
      'Alignment score',
      '# Nucleotides',
    ]) {
      expect(colLabels).toContain(expectedLabel);
    }

    const defaultVisible = getDefaultVisibleColumnsForFolder('Alignments', alignmentsFolderCols);
    expect(defaultVisible.slice(0, 10)).toEqual([
      'icon',
      'name',
      'description',
      'modified',
      'length',
      'numSequences',
      'pairwiseIdentity',
      'identicalSites',
      'geneticCode',
      'alignmentMethod',
    ]);

    const studioHtml = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, {
        activeDoc: coxiiDoc,
        documents: SAMPLE_LIBRARY,
      })
    );
    // The analyses are inspector rail entries (US-01M6Q177). The Feature Intervals table of the
    // members' annotations is the Member Annotations panel.
    const inspectorRail = studioHtml.slice(studioHtml.indexOf('aria-label="Alignment Inspector Tabs"'));
    for (const label of ['Member Annotations', 'Substitution Distances', 'Lengths Graph', 'Virtual Gel', 'Fragments']) {
      expect(inspectorRail).toMatch(new RegExp(`<button[^>]*role="tab"[^>]*aria-label="${label}"`));
    }
    const featureIntervalsHtml = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, {
        activeDoc: coxiiDoc,
        documents: SAMPLE_LIBRARY,
        initialInspectorTab: 'member-annotations',
      })
    );
    expect(featureIntervalsHtml).toContain('Export table (CSV)');
    expect(featureIntervalsHtml).toContain('<th style="text-align:right"># Intervals</th>');
    expect(studioHtml).toContain('Consensus');
    expect(studioHtml).toContain('Identity');
    expect(studioHtml).toContain('Orangutan');
    expect(studioHtml).toContain('Chimpanzee');
    expect(studioHtml).toContain('Human');
    expect(studioHtml).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);

    // Verify authentic descriptions across all 7 Alignments sample documents and stacked Sequence View on HIV env
    expect(coxiiDoc.description).toBe(
      'MolBioCraft translation alignment of 50 vertebrate cytochrome c oxidase subunit II coding sequences'
    );
    const hivDoc = SAMPLE_LIBRARY.find((d) => d.name === 'HIV env')!;
    expect(hivDoc.description).toBe('20 HIV envelope genes');
    expect(hivDoc.alignmentMeta?.sequences?.[0]?.description).toContain(
      'Human immunodeficiency virus 1 subtype C envelope glycoprotein'
    );
    const hivStudioHtml = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, {
        activeDoc: hivDoc,
        documents: SAMPLE_LIBRARY,
      })
    );
    expect(hivStudioHtml).toContain('env gene');
    expect(hivStudioHtml).toContain('env CDS');
    expect(hivStudioHtml).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);

    const lysrDoc = SAMPLE_LIBRARY.find((d) => d.name === 'LysR family')!;
    expect(lysrDoc).toBeDefined();
    const lysrStudioHtml = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, {
        activeDoc: lysrDoc,
        documents: SAMPLE_LIBRARY,
      })
    );
    // A protein alignment opens in the default protein scheme, Zappo (US-01M6TDGW).
    expect(lysrStudioHtml).toContain('<option value="Zappo" selected="">Zappo (physicochemical)</option>');
    expect(lysrStudioHtml).toContain('Legend');
    expect(lysrStudioHtml).toContain('LysR substrate-binding domain protein');
    expect(lysrStudioHtml).toContain('HTH 1');
    expect(lysrStudioHtml).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);
  });

  it('populates the 7 Contig Assembly sample documents, 39 Contig Assembly table columns, and the Dotplot / Chromatogram / QC Report modes', () => {
    const contigDocs = SAMPLE_LIBRARY.filter((d) => d.folder === 'Contig Assembly');
    expect(contigDocs.map((d) => d.name)).toEqual([
      'COI Assembly',
      'COI fwd read',
      'COI rev read',
      'yghJ CDS (divergent reference)',
      'yghJ CDS (reference)',
      'yghJ Ion Torrent reads',
      'yghJ paired Illumina reads',
    ]);

    const coiAssembly = contigDocs.find((d) => d.id === 'doc-contig-coi-assembly')!;
    expect(coiAssembly).toBeDefined();
    expect(coiAssembly.alignmentMeta?.sequences?.length).toBe(2);
    const coiMetrics = computeDocumentTableMetrics(coiAssembly);
    expect(getDocumentColumnDisplayValue(coiAssembly, coiMetrics, 'pctHq')).toBe('99.8%');
    expect(getDocumentColumnDisplayValue(coiAssembly, coiMetrics, 'length')).toBe('757');
    expect(getDocumentColumnDisplayValue(coiAssembly, coiMetrics, 'postTrimLength')).toBe('757 bp');
    expect(getDocumentColumnDisplayValue(coiAssembly, coiMetrics, 'numSequences')).toBe('2');

    const coiFwd = contigDocs.find((d) => d.id === 'doc-contig-coi-fwd')!;
    const coiFwdMetrics = computeDocumentTableMetrics(coiFwd);
    expect(getDocumentColumnDisplayValue(coiFwd, coiFwdMetrics, 'pctHq')).toBe('-');
    expect(getDocumentColumnDisplayValue(coiFwd, coiFwdMetrics, 'length')).toBe('724');
    expect(getDocumentColumnDisplayValue(coiFwd, coiFwdMetrics, 'postTrimLength')).toBe('-');
    expect(getDocumentColumnDisplayValue(coiFwd, coiFwdMetrics, 'numSequences')).toBe('1');

    const ionTorrent = contigDocs.find((d) => d.id === 'doc-contig-yghj-ion-torrent')!;
    const ionMetrics = computeDocumentTableMetrics(ionTorrent);
    expect(getDocumentColumnDisplayValue(ionTorrent, ionMetrics, 'length')).toBe('-');
    expect(getDocumentColumnDisplayValue(ionTorrent, ionMetrics, 'numSequences')).toBe('24');
    expect(getDocumentColumnDisplayValue(ionTorrent, ionMetrics, 'readTechnology')).toBe(
      'Ion Torrent (simulated)'
    );

    const illumina = contigDocs.find((d) => d.id === 'doc-contig-yghj-illumina')!;
    const illuminaMetrics = computeDocumentTableMetrics(illumina);
    expect(getDocumentColumnDisplayValue(illumina, illuminaMetrics, 'length')).toBe('-');
    expect(getDocumentColumnDisplayValue(illumina, illuminaMetrics, 'numSequences')).toBe('24');
    expect(getDocumentColumnDisplayValue(illumina, illuminaMetrics, 'pairedDataType')).toBe(
      'Paired End'
    );

    const contigFolderCols = getFolderAwareDocumentColumns(contigDocs, 'Contig Assembly');
    expect(contigFolderCols.length).toBeGreaterThanOrEqual(39);
    const contigColLabels = contigFolderCols.map((c) => c.label);
    for (const expectedCol of [
      '# Disagreements',
      '# Indel Disagreements',
      '# Nucleotides',
      '# Sequences',
      '% GC',
      '% HQ',
      '% Identical Sites',
      '% LQ',
      '% MQ',
      '% Pairwise Identity',
      'Ambiguities',
      'Approx. Consensus Length',
      'Bin',
      'Created',
      'Description',
      'Failed Binning Fields',
      'First Residues',
      'Free end gaps',
      'Icon',
      'Is Forward Read',
      'Max Sequence Length',
      'Mean Coverage',
      'Min Sequence Length',
      'Modified',
      'Molecule Type',
      'Name',
      'Organism',
      'Paired Data Type',
      'Post-Trim Length',
      'Read Technology',
      'Ref Seq Index',
      'Ref Seq Length',
      'Ref Seq Name',
      'Sequence Length',
      'Size',
      'Taxonomy',
      'Topology',
      'Trim Parameters',
      'URN',
    ]) {
      expect(contigColLabels).toContain(expectedCol);
    }
    const defaultContigVisible = getDefaultVisibleColumnsForFolder(
      'Contig Assembly',
      contigFolderCols
    );
    expect(defaultContigVisible.slice(0, 9)).toEqual([
      'icon',
      'name',
      'description',
      'modified',
      'organism',
      'pctHq',
      'length',
      'postTrimLength',
      'numSequences',
    ]);

    const contigStudioHtml = renderToStaticMarkup(
      React.createElement(SequenceAlignmentStudio, {
        activeDoc: coiAssembly,
        documents: SAMPLE_LIBRARY,
      })
    );
    // Dotplot, Chromatogram and QC Report are on the mode strip (US-01M6Q177).
    const modeStrip = contigStudioHtml.slice(
      contigStudioHtml.indexOf('aria-label="Sequence Alignment Modes"'),
      contigStudioHtml.indexOf('class="cloning-action-row"')
    );
    expect(modeStrip).toContain('Dotplot');
    expect(modeStrip).toContain('Chromatogram');
    expect(modeStrip).toContain('QC Report');
    expect(contigStudioHtml).toContain('Coverage');
    expect(contigStudioHtml).toContain('0 – 2');
    // strand icons: reverse read and forward read
    expect(contigStudioHtml).toContain('mbc-aln-seq-icon rev');
    expect(contigStudioHtml).toContain('▶');
    expect(contigStudioHtml).toContain('COI rev read');
    expect(contigStudioHtml).toContain('COI fwd read');
    // MolBioCraft's assembler trims the reads before it assembles them (US-01M6TDSV), so the rows
    // carry no "Trimmed" annotation of another program's.
    expect(contigStudioHtml).not.toContain('Trimmed');
    expect(contigStudioHtml).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);
  });

  it('renders 14 distinct MolBioCraft biological document icons and inline attribute data micro-icons/meters across table cells and sidebar nodes', () => {
    const allVisualKinds: MolBioVisualDocKind[] = [
      'circular-plasmid',
      'circular-genome',
      'linear-dsdna',
      'linear-rna',
      'primer-fwd',
      'primer-rev',
      'alignment-nt',
      'alignment-aa',
      'contig-assembly',
      'sanger-trace',
      'ngs-reads',
      'protein-seq',
      'structure-3d',
      'phylo-tree',
    ];

    const renderedIconMarkups = new Set<string>();
    for (const vKind of allVisualKinds) {
      const html = renderToStaticMarkup(
        React.createElement(MolBioDocTypeIcon, {
          kind: 'linear-dna',
          visualOverride: vKind,
        })
      );
      expect(html).toContain('mbc-doc-svg-icon');
      expect(html).toContain('mbc-duotone-icon');
      expect(html).toContain(`data-visual-kind="${vKind}"`);
      renderedIconMarkups.add(html);
    }
    // Every one of the 14 biological visual archetypes renders unique SVG geometry
    expect(renderedIconMarkups.size).toBe(14);

    // Verify document-aware visual archetype resolution on real SAMPLE_LIBRARY documents
    const observedSampleVisuals = new Set(
      SAMPLE_LIBRARY.map((d) =>
        resolveSequenceDocumentVisualKind(inferDocumentIconKind(d), d)
      )
    );
    expect(observedSampleVisuals.has('circular-plasmid')).toBe(true);
    expect(observedSampleVisuals.has('circular-genome')).toBe(true);
    expect(observedSampleVisuals.has('linear-dsdna')).toBe(true);
    expect(observedSampleVisuals.has('primer-fwd')).toBe(true);
    expect(observedSampleVisuals.has('primer-rev')).toBe(true);
    expect(observedSampleVisuals.has('alignment-nt')).toBe(true);
    expect(observedSampleVisuals.has('contig-assembly')).toBe(true);
    expect(observedSampleVisuals.has('sanger-trace')).toBe(true);
    expect(observedSampleVisuals.has('protein-seq')).toBe(true);
    expect(observedSampleVisuals.has('structure-3d')).toBe(true);
    expect(observedSampleVisuals.has('phylo-tree')).toBe(true);

    // Verify RNA and paired NGS read resolution
    const baseSample = SAMPLE_LIBRARY[0];
    expect(
      resolveSequenceDocumentVisualKind('linear-dna', {
        ...baseSample,
        moleculeType: 'RNA',
        topology: 'linear',
        name: 'Synthetic_mRNA_Construct',
      })
    ).toBe('linear-rna');
    expect(
      resolveSequenceDocumentVisualKind('contig', {
        ...baseSample,
        folder: 'Contig Assembly',
        name: 'Paired Illumina Reads R1/R2',
        description: 'Paired short reads',
      })
    ).toBe('ngs-reads');
    expect(
      resolveSequenceDocumentVisualKind('alignment', {
        ...baseSample,
        moleculeType: 'Protein',
        folder: 'Alignments',
        name: 'Globin_Protein_MSA',
      })
    ).toBe('alignment-aa');

    // Verify attribute cell rendering preserves exact underlying text while rendering micro-icons/meters
    const metrics = computeDocumentTableMetrics(baseSample);
    const attrChecks: Array<[string, string, string]> = [
      ['topology', 'Circular', 'mbc-attr-pill'],
      ['type', 'Plasmid dsDNA', 'mbc-doc-svg-icon'],
      ['gc', '53.8%', 'mbc-attr-meter-fill'],
      ['pairwiseIdentity', '94.2%', 'mbc-attr-meter-fill'],
      ['annotations', '12', 'mbc-attr-inline'],
      ['oligoType', 'Reverse Primer', 'data-visual-kind="primer-rev"'],
      ['tm', '60.4 °C', 'data-glyph="oligo-thermo"'],
      ['organism', 'Homo sapiens', 'mbc-attr-italic'],
      ['taxonomy', 'Bacteria; Proteobacteria', 'mbc-attr-micro-svg'],
      ['pdbName', '4EUL', 'data-visual-kind="structure-3d"'],
      ['alignmentMethod', 'MAFFT L-INS-i', 'data-glyph="align-msa"'],
      ['treeBuilder', 'RAxML-NG ML', 'data-glyph="tree-cladogram"'],
      ['sequencingTechnology', 'ABI 3730xl Sanger', 'data-visual-kind="sanger-trace"'],
      ['meanCoverage', '48.5x', 'data-visual-kind="contig-assembly"'],
      ['isForwardRead', 'Yes', 'data-visual-kind="primer-fwd"'],
    ];

    for (const [colId, rawVal, expectedMarker] of attrChecks) {
      const cellHtml = renderToStaticMarkup(
        React.createElement(MolBioAttributeCellValue, {
          colId,
          rawValue: rawVal,
          doc: baseSample,
          metrics,
        })
      );
      expect(cellHtml).toContain(rawVal);
      expect(cellHtml).toContain(expectedMarker);
    }

    // Verify favorite star, status shield, sort chevrons, column header icons, and annotation table badges
    expect(
      renderToStaticMarkup(React.createElement(MolBioStarIcon, { active: true }))
    ).toContain('is-active');
    expect(
      renderToStaticMarkup(React.createElement(MolBioStatusBadgeIcon, { ok: true }))
    ).toContain('is-ok');
    expect(
      renderToStaticMarkup(React.createElement(MolBioSortChevron, { direction: 'asc' }))
    ).toContain('mbc-sort-chevron-svg');
    expect(
      renderToStaticMarkup(React.createElement(MolBioColumnHeaderIcon, { colId: 'gc' }))
    ).toContain('mbc-th-col-icon');
    expect(
      renderToStaticMarkup(React.createElement(MolBioStrandBadge, { strand: 1 }))
    ).toContain('Forward (+)');
    expect(
      renderToStaticMarkup(React.createElement(MolBioFeatureTypeBadge, { featureType: 'CDS' }))
    ).toContain('CDS');

    // Verify distinct sidebar node icons (including all 5 genome taxonomic branches and 6 NCBI sub-databases)
    const genomeBranchHtmls = new Set(
      ['Genomes/Bacteria', 'Genomes/Eukaryotes', 'Genomes/Human', 'Genomes/Plants', 'Genomes/Viruses'].map(
        (k) => renderToStaticMarkup(React.createElement(MolBioSidebarNodeIcon, { nodeKey: k }))
      )
    );
    expect(genomeBranchHtmls.size).toBe(5);

    const ncbiBranchHtmls = new Set(
      [
        'ncbi-gene',
        'ncbi-nucleotide',
        'ncbi-protein',
        'ncbi-pubmed',
        'ncbi-structure',
        'ncbi-taxonomy',
      ].map((k) =>
        renderToStaticMarkup(React.createElement(MolBioSidebarNodeIcon, { nodeKey: k }))
      )
    );
    expect(ncbiBranchHtmls.size).toBe(6);

    // Verify all 12 viewer studio tabs render SVG icons cleanly
    for (const tabId of [
      'sequence-view',
      'annotations-table',
      'text-view',
      'vector-library',
      'cloning-gel',
      'primers-pcr',
      'sequence-alignment',
      'phylogenetics',
      'genomics-structure-suite',
      'sanger-contig',
      'protein-biochem',
      'history-lineage',
    ]) {
      const tabIconHtml = renderToStaticMarkup(
        React.createElement(MolBioViewerTabIcon, { tabId })
      );
      expect(tabIconHtml).toContain('<svg');
    }
  });

  it('renders Scale-Continuous ConstructCockpitBar with Okabe-Ito colorblind-safe feature ribbon, SantaLucia Tm HUD, and Provenance Lineage trail', () => {
    const doc = SAMPLE_LIBRARY[0];
    const cockpitHtml = renderToStaticMarkup(
      React.createElement(ConstructCockpitBar, {
        doc,
        cutSites: [],
        selectedRange: { start: 1, end: 24, label: 'Test Oligo Window' },
        onSelectRange: () => {},
        onJumpToStudio: () => {},
        onExtractSelection: () => {},
        colorblindSafe: true,
      })
    );
    expect(cockpitHtml).toContain('mbc-cockpit-bar');
    expect(cockpitHtml).toContain('Duplex Tm:');
    expect(cockpitHtml).toContain('PCR / Oligo Cell');
    expect(cockpitHtml).toContain('Digest / Assemble Cell');
    expect(cockpitHtml).toContain('Homology Cell');
    expect(OKABE_ITO_FEATURE_PALETTE.CDS).toBe('#0072B2');
  });

  it('populates all 5 Genomes folders (Bacteria, Eukaryotes, Human, Plants, Viruses), Contig Summary banner, Color Options modal, wrapped genome map, and Genome-Annotation-Data columns', () => {
    const bacteria = SAMPLE_LIBRARY.filter((d) => d.folder === 'Genomes/Bacteria');
    const eukaryotes = SAMPLE_LIBRARY.filter((d) => d.folder === 'Genomes/Eukaryotes');
    const human = SAMPLE_LIBRARY.filter((d) => d.folder === 'Genomes/Human');
    const plants = SAMPLE_LIBRARY.filter((d) => d.folder === 'Genomes/Plants');
    const viruses = SAMPLE_LIBRARY.filter((d) => d.folder === 'Genomes/Viruses');

    expect(bacteria.slice(0, 3).map((d) => d.name)).toEqual([
      'E. coli K12 MG1655',
      'P. aeruginosa PAO1',
      'P. fluorescens SBW25',
    ]);
    expect(eukaryotes.map((d) => d.name)).toEqual([
      'Bovine Chr1',
      'Bovine Chr2',
      'Bovine Chr3',
      'Drosophila ChrM',
      'Drosophila Chr2L',
      'Yeast ChrI',
      'Equus Chr1',
    ]);
    expect(human.map((d) => d.name)).toEqual([
      'chr1',
      'chr2',
      'chr3',
      'chr4',
      'chrX',
      'chrY',
      'chrM',
    ]);
    expect(plants.map((d) => d.name)).toEqual([
      'Arabidopsis Chr1',
      'Arabidopsis Chr2',
      'Arabidopsis Chr3',
      'Arabidopsis Chr4',
      'Arabidopsis Chr5',
      'Arabidopsis ChrC',
      'Arabidopsis ChrM',
    ]);
    expect(viruses.map((d) => d.name)).toEqual([
      'Ebola',
      'HIV',
      'HPV',
      'Phage lambda',
      'Phage T7',
      'SARS',
      'SARS-CoV-2',
    ]);

    const ecoli = bacteria[0];
    const ecoliMetrics = computeDocumentTableMetrics(ecoli);
    expect(getDocumentColumnDisplayValue(ecoli, ecoliMetrics, 'length')).toBe('4,641,652');
    expect(getDocumentColumnDisplayValue(ecoli, ecoliMetrics, 'accession')).toBe('NC_000913');
    expect(getDocumentColumnDisplayValue(ecoli, ecoliMetrics, 'gid')).toBe('556503834');
    expect(getDocumentColumnDisplayValue(ecoli, ecoliMetrics, 'topology')).toBe('Circular');

    const chr1 = human[0];
    const chr1Metrics = computeDocumentTableMetrics(chr1);
    expect(getDocumentColumnDisplayValue(chr1, chr1Metrics, 'length')).toBe('248,956,422');
    expect(getDocumentColumnDisplayValue(chr1, chr1Metrics, 'accession')).toBe('NC_000001.11');
    expect(getDocumentColumnDisplayValue(chr1, chr1Metrics, 'gid')).toBe('568815597');
    expect(chr1.features.some((f) => f.name === 'NT_077402.3' && f.qualifiers?.genomic_start === '10001')).toBe(
      true
    );

    // An alignment whose record carries its own Modified field shows it. No sample carries one
    // since US-01M6TDSV rebuilt the alignments (D0091), so the field is added to a copy here; the
    // sample itself shows MolBioCraft's own date.
    const pairwiseAln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-pairwise-protein')!;
    expect(pairwiseAln.docMetadata?.Modified).toBeUndefined();
    expect(getDocumentColumnDisplayValue(pairwiseAln, computeDocumentTableMetrics(pairwiseAln), 'modified')).toBe('2026-11-08 09:00');
    const imported = { ...pairwiseAln, docMetadata: { ...pairwiseAln.docMetadata, Modified: '22 Mar 2011 3:54 AM' } };
    expect(getDocumentColumnDisplayValue(imported, computeDocumentTableMetrics(imported), 'modified')).toBe(
      '22 Mar 2011 3:54 AM'
    );

    // Verify Contig Summary banner on E. coli K12 MG1655
    const ecoliHtml = renderToStaticMarkup(
      React.createElement(LinearSequenceView, {
        doc: ecoli,
        cutSites: [],
        selectedRange: null,
        onSelectRange: () => {},
        onUpdateDocument: () => {},
      })
    );
    expect(ecoliHtml).toContain('Selected sequences are only summaries');
    expect(ecoliHtml).toContain('Download Full Sequence(s)');
    expect(ecoliHtml).toContain('?: 100.0%');
    expect(ecoliHtml).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);

    // Verify Wrapped 5-row Genome Schematic and Translation Statistics on Ebola
    const ebola = viruses[0];
    expect(ebola.sequence.length).toBe(18959);
    const ebolaHtml = renderToStaticMarkup(
      React.createElement(LinearSequenceView, {
        doc: ebola,
        cutSites: [],
        selectedRange: null,
        onSelectRange: () => {},
        onUpdateDocument: () => {},
      })
    );
    expect(ebolaHtml).toContain('mbc-wrapped-genome-svg');
    expect(ebolaHtml).toContain('Translation Statistics');
    expect(ebolaHtml).toContain('Isoelectric point (mean):');
    expect(ebolaHtml).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);

    // Verify Color Options modal
    const colorModalHtml = renderToStaticMarkup(
      React.createElement(NucleotideColorOptionsModal, { onClose: () => {} })
    );
    expect(colorModalHtml).toContain('Color Options');
    expect(colorModalHtml).toContain('Used as the block color when zoomed out');
    expect(colorModalHtml).toContain('Restore Defaults');
    expect(colorModalHtml).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);

    // Verify GenomeInspectorExtras standalone render
    const extrasHtml = renderToStaticMarkup(
      React.createElement(GenomeInspectorExtras, {
        doc: plants[5], // Arabidopsis ChrC
        selectedRange: null,
        onSelectRange: () => {},
      })
    );
    expect(extrasHtml).toContain('154,478 bp');
    expect(extrasHtml).toContain('Organelle Base Counts (A/C/G/T):');
    expect(extrasHtml).not.toMatch(EXCLUDED_UI_AND_VENDOR_RE);
  });

  it('correctly maps chromosome-scale contig summaries in ConstructCockpitBar and LinearSequenceView', () => {
    const bovine = SAMPLE_LIBRARY.find((d) => d.name === 'Bovine Chr1')!;
    expect(bovine).toBeDefined();

    // 1. Cockpit bar displays Chromosome Summary badge and Reference Span
    const cockpitHtml = renderToStaticMarkup(
      React.createElement(ConstructCockpitBar, {
        doc: bovine,
        cutSites: [],
        selectedRange: null,
        onSelectRange: () => {},
      })
    );
    expect(cockpitHtml).toContain('158.34 Mbp Chromosome Summary');
    expect(cockpitHtml).toContain('Reference Span:');
    expect(cockpitHtml).toContain('158,337,067 bp declared');

    // 2. Cockpit peptide preview uses Frame +1 (offset 0), not Frame +2 (*NALAPPLPPP..)
    const syntheticDoc = {
      ...bovine,
      sequence: 'ATGAAACGCATTAGCACCACCATTACCACCACCATCACCATTACCACAGGTAACGGTGCGGGCTGA',
    };
    const syntheticCockpitHtml = renderToStaticMarkup(
      React.createElement(ConstructCockpitBar, {
        doc: syntheticDoc,
        cutSites: [],
        selectedRange: null,
        onSelectRange: () => {},
      })
    );
    expect(syntheticCockpitHtml).toContain('MKRISTTITTTI');
    expect(syntheticCockpitHtml).not.toContain('*NALAPPLPPP');

    // 3. LinearSequenceView overview layout scales genomic qualifiers across declaredLen
    const { placed } = layoutLinearSchematicFeatures(
      bovine.features,
      Number(bovine.docMetadata?.['Declared Length']),
      3
    );
    const sourceFeat = placed.find((p) => p.feature.name === 'source Bos taurus');
    expect(sourceFeat).toBeDefined();
    // Spans essentially the full width of the overview track (724px)
    expect(sourceFeat!.boxWidth).toBeGreaterThan(700);

    // 4. Eukaryotic chromosome does not render the viral 5-row wrapped map
    const viewHtml = renderToStaticMarkup(
      React.createElement(LinearSequenceView, {
        doc: bovine,
        cutSites: [],
        selectedRange: null,
        onSelectRange: () => {},
        onUpdateDocument: () => {},
      })
    );
    expect(viewHtml).not.toContain('mbc-wrapped-genome-svg');
  });

  it('supports left sidebar folder right-click options, removes reload function, and prevents cross-folder selection', async () => {
    const nodeFsSpec: string = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const appSrc = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const mainSrc = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    const menuSrc = readFileSync(new URL('../components/CascadingMenu.tsx', import.meta.url), 'utf8');
    const { toggleVisibleSelection } = await import('../core/projectExplorer');

    // 1. Sidebar right-click context menu options
    expect(appSrc).toContain("id: 'folder-new',");
    expect(appSrc).toContain("label: 'New Folder…',");
    expect(appSrc).toContain("shortcut: isDarwin ? '⇧⌘N' : 'Ctrl+Shift+N',");
    expect(appSrc).toContain("id: 'folder-export',");
    expect(appSrc).toContain("label: 'Export Folder…',");
    expect(appSrc).toContain("id: 'folder-delete',");
    expect(appSrc).toContain("label: 'Delete Folder',");
    expect(appSrc).toContain("id: 'folder-rename',");
    expect(appSrc).toContain("label: 'Rename Folder…',");
    expect(appSrc).toContain("id: 'folder-color',");
    expect(appSrc).toContain("label: 'Set Folder Color…',");
    expect(appSrc).toContain("id: 'folder-separator'");
    expect(appSrc).toContain("id: 'folder-move',");
    expect(appSrc).toContain("label: 'Move Folder…',");
    expect(appSrc).toContain("id: 'folder-read',");
    expect(appSrc).toContain("label: 'Mark All as Read',");
    expect(appSrc).toContain("id: 'folder-favorite',");
    expect(appSrc).toContain("label: favoriteFolders.includes(target) ? 'Remove from Favorites' : 'Add to Favorites',");
    expect(appSrc).toContain("id: 'folder-size',");
    expect(appSrc).toContain("label: 'Show Folder Size',");

    // Right-clicking a folder selects it and opens the context menu
    expect(appSrc).toContain('handleSelectProjectFolder(folder);');
    expect(appSrc).toContain('computeViewportClampedContextMenuPosition(');

    // CascadingMenuPopup supports isContextMenu to hide Function Info and suppress auto-icons
    expect(menuSrc).toContain('isContextMenu?: boolean;');
    expect(menuSrc).toContain('depth === 0 && !isContextMenu');
    expect(appSrc).toContain('folderContextMenu && <CascadingMenuPopup');
    expect(appSrc).toContain('isContextMenu={true}');

    // 2. Removal of Reload Function
    // Global contextmenu preventDefault eliminates the native browser context menu containing "Reload"
    expect(mainSrc).toContain("window.addEventListener('contextmenu', (e) => {");
    expect(mainSrc).toContain('e.preventDefault();');
    expect(appSrc).toContain("document.addEventListener('contextmenu', onGlobalContextMenu);");

    // Cmd+R, Ctrl+R, F5 are prevented completely. Both blockers use the shared
    // shouldBlockReloadChord predicate (behaviour tested in menuShortcuts.test.ts).
    expect(mainSrc).toContain('shouldBlockReloadChord(e, nativeMacMenuBar)');
    expect(mainSrc).toContain("e.key === 'F5'");
    expect(appSrc).toContain('shouldBlockReloadChord(ev, nativeMacMenuBarRef.current)');
    expect(appSrc).toContain("ev.key === 'F5'");

    // 3. Selection Scoping: Selection CANNOT select across other folders
    // handleSelectProjectFolder scopes activeDocId and checkedDocIds to the selected folder
    expect(appSrc).toContain('// Selection object cannot select across other folders:');
    expect(appSrc).toContain('setCheckedDocIds([targetDocId]);');

    // selectedAnalysisDocuments is strictly scoped to docsInSelectedFolder
    expect(appSrc).toContain('() => docsInSelectedFolder.filter((doc) => checkedIdsSet.has(doc.id))');

    // toggleVisibleSelection does not cross folders
    const visibleCloning = ['doc-cloning-1', 'doc-cloning-2'];
    const selectedAcrossFolders = ['doc-alignment-99', 'doc-cloning-1'];
    // Toggling select-all in Cloning selects only visible cloning docs, discarding doc-alignment-99
    const allSelectedInCloning = toggleVisibleSelection(selectedAcrossFolders, visibleCloning);
    expect(allSelectedInCloning).toEqual(['doc-cloning-1', 'doc-cloning-2']);
    expect(allSelectedInCloning).not.toContain('doc-alignment-99');

    // Unselecting all in Cloning clears selection completely
    const unselected = toggleVisibleSelection(visibleCloning, visibleCloning);
    expect(unselected).toEqual([]);

    // Table controls summary label does not show cross-folder totals
    expect(appSrc).toContain('summaryLabel={`${selectedInFilteredDocs.length} of ${filteredDocuments.length} selected`}');
    expect(appSrc).not.toContain('total across folders');
  });

  it('computes Tm when the document stores none, along with Hairpin and Primer-Dimer', () => {
    const barePrimer = makeTestDoc({
      id: 'doc-primer-bare',
      name: 'Bare_Design_Primer',
      sequence: 'CGCAAATGGGCGGTAGGCGTG',
      folder: 'Primers',
      documentKind: 'primer',
      docMetadata: undefined,
      primers: [],
    });
    const bareMetrics = computeDocumentTableMetrics(barePrimer);
    const bareRecord = primerRecordFromDoc(barePrimer);
    expect(getDocumentColumnDisplayValue(barePrimer, bareMetrics, 'tm')).toBe(
      `${bareRecord.tmFullC.toFixed(1)} °C`
    );
    expect(getDocumentColumnDisplayValue(barePrimer, bareMetrics, 'hairpin')).toBe(
      `${bareRecord.hairpinDeltaG.toFixed(1)} kcal/mol`
    );
    expect(getDocumentColumnDisplayValue(barePrimer, bareMetrics, 'primerDimer')).toBe(
      `${bareRecord.selfDimerDeltaG.toFixed(1)} kcal/mol`
    );

    const samplePrimers = SAMPLE_LIBRARY.filter((d) => d.folder === 'Primers');
    expect(samplePrimers).toHaveLength(19);
    const designPrimers = samplePrimers.filter((d) => !d.id.startsWith('doc-primer-seq-'));
    expect(designPrimers).toHaveLength(7);

    for (const doc of designPrimers) {
      expect(doc.docMetadata?.Tm).toBeUndefined();
      expect(doc.docMetadata?.Hairpin).toBeUndefined();
      expect(doc.docMetadata?.['Primer-Dimer']).toBeUndefined();
      expect(doc.primers).toEqual([]);

      const metrics = computeDocumentTableMetrics(doc);
      const record = primerRecordFromDoc(doc);
      expect(getDocumentColumnDisplayValue(doc, metrics, 'tm')).toBe(
        `${record.tmFullC.toFixed(1)} °C`
      );
      expect(getDocumentColumnDisplayValue(doc, metrics, 'hairpin')).toBe(
        `${record.hairpinDeltaG.toFixed(1)} kcal/mol`
      );
      expect(getDocumentColumnDisplayValue(doc, metrics, 'primerDimer')).toBe(
        `${record.selfDimerDeltaG.toFixed(1)} kcal/mol`
      );
    }

    for (const doc of samplePrimers) {
      const metrics = computeDocumentTableMetrics(doc);
      const tmCell = getDocumentColumnDisplayValue(doc, metrics, 'tm');
      const hairpinCell = getDocumentColumnDisplayValue(doc, metrics, 'hairpin');
      const dimerCell = getDocumentColumnDisplayValue(doc, metrics, 'primerDimer');
      expect(tmCell).toMatch(/^-?\d+\.\d °C$/);
      expect(hairpinCell).toMatch(/^-?\d+\.\d kcal\/mol$/);
      expect(dimerCell).toMatch(/^-?\d+\.\d kcal\/mol$/);
      expect(parseSortableNumericValue(tmCell)).not.toBeNull();
      expect(parseSortableNumericValue(hairpinCell)).not.toBeNull();
      expect(parseSortableNumericValue(dimerCell)).not.toBeNull();
    }

    const nonPrimer = makeTestDoc({
      id: 'doc-non-primer',
      name: 'NonPrimer_Construct',
      folder: 'Cloning',
      documentKind: 'linear-dna',
      docMetadata: undefined,
      primers: [],
    });
    const nonPrimerMetrics = computeDocumentTableMetrics(nonPrimer);
    expect(getDocumentColumnDisplayValue(nonPrimer, nonPrimerMetrics, 'tm')).toBe('-');
    expect(getDocumentColumnDisplayValue(nonPrimer, nonPrimerMetrics, 'hairpin')).toBe('-');
    expect(getDocumentColumnDisplayValue(nonPrimer, nonPrimerMetrics, 'primerDimer')).toBe('-');

    const withStoredPrimer = makeTestDoc({ docMetadata: undefined });
    const storedMetrics = computeDocumentTableMetrics(withStoredPrimer);
    expect(getDocumentColumnDisplayValue(withStoredPrimer, storedMetrics, 'tm')).toBe('58.4 °C');
    expect(getDocumentColumnDisplayValue(withStoredPrimer, storedMetrics, 'hairpin')).toBe(
      '-1.1 kcal/mol'
    );
    expect(getDocumentColumnDisplayValue(withStoredPrimer, storedMetrics, 'primerDimer')).toBe(
      '-2.3 kcal/mol'
    );

    const withStoredMeta = makeTestDoc({
      docMetadata: {
        Tm: '61.2 °C',
        Hairpin: '-0.8 kcal/mol',
        'Primer-Dimer': '-1.9 kcal/mol',
      },
    });
    const metaMetrics = computeDocumentTableMetrics(withStoredMeta);
    expect(getDocumentColumnDisplayValue(withStoredMeta, metaMetrics, 'tm')).toBe('61.2 °C');
    expect(getDocumentColumnDisplayValue(withStoredMeta, metaMetrics, 'hairpin')).toBe(
      '-0.8 kcal/mol'
    );
    expect(getDocumentColumnDisplayValue(withStoredMeta, metaMetrics, 'primerDimer')).toBe(
      '-1.9 kcal/mol'
    );
  });
});
