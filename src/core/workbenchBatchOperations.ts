// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import {
  computeDocumentTableMetricsRust,
  ComputedDocumentRowMetricsRust,
  exportTableDelimitedCsvRust,
  invokeRustBioSync,
  type RecordChecksState,
} from '../lib/rustBioEngine';
import {
  PrimerRecord,
  SequenceDocument,
  SequenceDocumentIconKind,
} from '../types/bio';
import { primerRecordFromDoc } from './operationRunners';

export type DocTableColumnId =
  | 'icon'
  | 'favorite'
  | 'name'
  | 'accession'
  | 'type'
  | 'topology'
  | 'length'
  | 'gc'
  | 'annotations'
  | 'numSequences'
  | 'pairwiseIdentity'
  | 'identicalSites'
  | 'geneticCode'
  | 'meanCoverage'
  | 'treeBuilder'
  | 'modified'
  | 'created'
  | 'status'
  | 'description';

export interface DocTableColumnDef {
  id: DocTableColumnId;
  label: string;
  alwaysVisible?: boolean;
  defaultVisible: boolean;
  align?: 'left' | 'right' | 'center';
  minWidth?: number;
}

export const DOC_TABLE_COLUMN_DEFS: DocTableColumnDef[] = [
  { id: 'icon', label: 'Icon', defaultVisible: true, align: 'center', minWidth: 30 },
  { id: 'favorite', label: '★', defaultVisible: true, align: 'center', minWidth: 30 },
  { id: 'name', label: 'Name', alwaysVisible: true, defaultVisible: true, align: 'left', minWidth: 190 },
  { id: 'accession', label: 'Accession', defaultVisible: true, align: 'left', minWidth: 110 },
  { id: 'type', label: 'Type', defaultVisible: true, align: 'left', minWidth: 145 },
  { id: 'topology', label: 'Topology', defaultVisible: true, align: 'left', minWidth: 78 },
  { id: 'length', label: 'Sequence Length', defaultVisible: true, align: 'right', minWidth: 112 },
  { id: 'gc', label: '%GC', defaultVisible: true, align: 'right', minWidth: 68 },
  { id: 'annotations', label: 'Annotations', defaultVisible: true, align: 'right', minWidth: 86 },
  { id: 'numSequences', label: '# Sequences', defaultVisible: false, align: 'right', minWidth: 92 },
  { id: 'pairwiseIdentity', label: '% Pairwise Identity', defaultVisible: false, align: 'right', minWidth: 126 },
  { id: 'identicalSites', label: '% Identical Sites', defaultVisible: false, align: 'right', minWidth: 116 },
  { id: 'geneticCode', label: 'Genetic Code', defaultVisible: false, align: 'left', minWidth: 130 },
  { id: 'meanCoverage', label: 'Mean Coverage', defaultVisible: false, align: 'right', minWidth: 108 },
  { id: 'treeBuilder', label: 'Tree Builder', defaultVisible: false, align: 'left', minWidth: 124 },
  { id: 'modified', label: 'Modified', defaultVisible: false, align: 'left', minWidth: 132 },
  { id: 'created', label: 'Created', defaultVisible: false, align: 'left', minWidth: 132 },
  { id: 'status', label: 'Status', defaultVisible: true, align: 'center', minWidth: 58 },
  { id: 'description', label: 'Description', defaultVisible: true, align: 'left', minWidth: 230 },
];

export type DocTableColumnPresetId =
  | 'standard-cloning'
  | 'alignment-phylogeny'
  | 'genomics-sequencing'
  | 'all-columns';

export const DOC_TABLE_COLUMN_PRESETS: Record<
  DocTableColumnPresetId,
  { label: string; columns: DocTableColumnId[] }
> = {
  'standard-cloning': {
    label: 'Standard Molecular Cloning',
    columns: [
      'icon',
      'favorite',
      'name',
      'accession',
      'type',
      'topology',
      'length',
      'gc',
      'annotations',
      'status',
      'description',
    ],
  },
  'alignment-phylogeny': {
    label: 'Alignment & Phylogenetics',
    columns: [
      'icon',
      'favorite',
      'name',
      'description',
      'modified',
      'length',
      'numSequences',
      'pairwiseIdentity',
      'identicalSites',
      'geneticCode',
      'treeBuilder',
    ],
  },
  'genomics-sequencing': {
    label: 'Genomics & Sequencing',
    columns: [
      'icon',
      'favorite',
      'name',
      'accession',
      'type',
      'length',
      'gc',
      'meanCoverage',
      'geneticCode',
      'modified',
      'description',
    ],
  },
  'all-columns': {
    label: 'Show All Columns',
    columns: DOC_TABLE_COLUMN_DEFS.map((c) => c.id),
  },
};

export interface ComputedDocumentRowMetrics {
  docTypeLabel: string;
  lengthNum: number;
  lengthLabel: string;
  gcPct: number;
  gcLabel: string;
  annotationsCount: number;
  numSequences: number;
  pairwiseIdentityPct: number | null;
  pairwiseIdentityLabel: string;
  identicalSitesPct: number | null;
  identicalSitesLabel: string;
  geneticCodeLabel: string;
  meanCoverageX: number | null;
  meanCoverageLabel: string;
  treeBuilderLabel: string;
  modifiedFormatted: string;
  createdFormatted: string;
  alertsCount: number;
  alertsSummary: string;
  checksState: RecordChecksState;
  checksNotRun: string;
}

/**
 * What a record's checks concluded (BG-01M6S1B3): `alerts` when a check found something, `clear`
 * only when every check ran on the whole record and found nothing, `partial` when some checks did
 * not run or did not finish (a restriction scan stopped at its site cap) and nothing was found, and
 * `not-run` when no check ran. A metrics reply that does not say how far the checks got is never
 * read as clear.
 */
export type RecordCheckVerdict = 'alerts' | 'clear' | 'partial' | 'not-run';

export function recordCheckVerdict(
  metrics: Pick<ComputedDocumentRowMetrics, 'alertsCount'> & Partial<Pick<ComputedDocumentRowMetrics, 'checksState'>>
): RecordCheckVerdict {
  if (metrics.alertsCount > 0) return 'alerts';
  if (metrics.checksState === 'complete') return 'clear';
  if (metrics.checksState === 'partial') return 'partial';
  return 'not-run';
}

/** The Status sort's order: clear, partly checked, not checked, then alerts by count. */
const RECORD_CHECK_SORT_RANK: Record<RecordCheckVerdict, number> = { clear: 0, partial: 1, 'not-run': 2, alerts: 3 };

export function inferDocumentTypeLabel(doc: SequenceDocument): string {
  return computeDocumentTableMetrics(doc).docTypeLabel;
}

export function inferDocumentIconKind(doc: SequenceDocument): SequenceDocumentIconKind {
  const cached = computeDocumentTableMetrics(doc) as ComputedDocumentRowMetricsRust;
  return (cached.iconKind || 'linear-dna') as SequenceDocumentIconKind;
}

export type FolderColumnScope =
  | 'core'
  | 'alignments'
  | 'cloning'
  | 'contig'
  | 'genomes'
  | 'plasmids'
  | 'primers'
  | 'proteins'
  | 'trees';

export interface DynamicDocColumnDef {
  id: string;
  label: string;
  alwaysVisible?: boolean;
  defaultVisible: boolean;
  align?: 'left' | 'right' | 'center';
  minWidth?: number;
  scopes: FolderColumnScope[];
  metaKey?: string;
}

export const WORKBENCH_FOLDER_COLUMN_CATALOG: DynamicDocColumnDef[] = [
  // Core columns available across all folders
  { id: 'icon', label: 'Icon', defaultVisible: true, align: 'center', minWidth: 32, scopes: ['core'] },
  { id: 'favorite', label: '★', defaultVisible: true, align: 'center', minWidth: 30, scopes: ['core'] },
  { id: 'name', label: 'Name', alwaysVisible: true, defaultVisible: true, align: 'left', minWidth: 190, scopes: ['core'] },
  { id: 'accession', label: 'Accession', defaultVisible: true, align: 'left', minWidth: 112, scopes: ['core'] },
  { id: 'type', label: 'Molecule Type', defaultVisible: true, align: 'left', minWidth: 145, scopes: ['core'] },
  { id: 'topology', label: 'Topology', defaultVisible: true, align: 'left', minWidth: 80, scopes: ['core'] },
  { id: 'length', label: 'Sequence Length', defaultVisible: true, align: 'right', minWidth: 116, scopes: ['core'] },
  { id: 'gc', label: '% GC', defaultVisible: true, align: 'right', minWidth: 70, scopes: ['core'] },
  { id: 'annotations', label: 'Annotations', defaultVisible: true, align: 'right', minWidth: 88, scopes: ['core'] },
  { id: 'organism', label: 'Organism', defaultVisible: false, align: 'left', minWidth: 165, scopes: ['core'] },
  { id: 'commonName', label: 'Common Name', defaultVisible: false, align: 'left', minWidth: 128, scopes: ['core'] },
  { id: 'taxonomy', label: 'Taxonomy', defaultVisible: false, align: 'left', minWidth: 195, scopes: ['core'] },
  { id: 'firstResidues', label: 'First Residues', defaultVisible: false, align: 'left', minWidth: 150, scopes: ['core'] },
  { id: 'geneticCode', label: 'Genetic Code', defaultVisible: false, align: 'left', minWidth: 132, scopes: ['core'] },
  { id: 'gid', label: 'GID', defaultVisible: false, align: 'left', minWidth: 108, scopes: ['core'] },
  { id: 'size', label: 'Size', defaultVisible: false, align: 'right', minWidth: 82, scopes: ['core'] },
  { id: 'urn', label: 'URN', defaultVisible: false, align: 'left', minWidth: 175, scopes: ['core'] },
  { id: 'modified', label: 'Modified', defaultVisible: true, align: 'left', minWidth: 132, scopes: ['core'] },
  { id: 'created', label: 'Created', defaultVisible: false, align: 'left', minWidth: 132, scopes: ['core'] },
  { id: 'status', label: 'Status', defaultVisible: true, align: 'center', minWidth: 58, scopes: ['core'] },
  { id: 'description', label: 'Description', defaultVisible: true, align: 'left', minWidth: 230, scopes: ['core'] },

  // Homology & Multiple Sequence Alignment telemetry columns
  { id: 'numNucleotides', label: '# Nucleotides', defaultVisible: true, align: 'right', minWidth: 106, scopes: ['alignments', 'contig'], metaKey: '# Nucleotides' },
  { id: 'numSequences', label: '# Sequences', defaultVisible: true, align: 'right', minWidth: 96, scopes: ['alignments', 'contig'] },
  { id: 'identicalSites', label: '% Identical Sites', defaultVisible: true, align: 'right', minWidth: 118, scopes: ['alignments', 'contig'] },
  { id: 'pairwiseIdentity', label: '% Pairwise Identity', defaultVisible: true, align: 'right', minWidth: 128, scopes: ['alignments', 'contig'] },
  { id: 'alignmentMethod', label: 'Alignment method', defaultVisible: true, align: 'left', minWidth: 145, scopes: ['alignments'], metaKey: 'Alignment method' },
  { id: 'alignmentOptions', label: 'Alignment options', defaultVisible: true, align: 'left', minWidth: 150, scopes: ['alignments'], metaKey: 'Alignment options' },
  { id: 'alignmentScore', label: 'Alignment score', defaultVisible: true, align: 'right', minWidth: 118, scopes: ['alignments'], metaKey: 'Alignment score' },
  { id: 'freeEndGaps', label: 'Free end gaps', defaultVisible: true, align: 'left', minWidth: 108, scopes: ['alignments', 'contig'], metaKey: 'Free end gaps' },
  { id: 'maxSeqLength', label: 'Max Sequence Length', defaultVisible: true, align: 'right', minWidth: 142, scopes: ['alignments', 'contig'], metaKey: 'Max Sequence Length' },
  { id: 'meanCoverage', label: 'Mean Coverage', defaultVisible: false, align: 'right', minWidth: 112, scopes: ['alignments', 'contig'] },
  { id: 'minSeqLength', label: 'Min Sequence Length', defaultVisible: true, align: 'right', minWidth: 142, scopes: ['alignments', 'contig'], metaKey: 'Min Sequence Length' },
  { id: 'refSeqIndex', label: 'Ref Seq Index', defaultVisible: false, align: 'right', minWidth: 108, scopes: ['alignments', 'contig'], metaKey: 'Ref Seq Index' },
  { id: 'refSeqLength', label: 'Ref Seq Length', defaultVisible: false, align: 'right', minWidth: 112, scopes: ['alignments', 'contig'], metaKey: 'Ref Seq Length' },
  { id: 'refSeqName', label: 'Ref Seq Name', defaultVisible: false, align: 'left', minWidth: 128, scopes: ['alignments', 'contig'], metaKey: 'Ref Seq Name' },

  // Cloning & Primers folder columns
  { id: 'tm', label: 'Tm', defaultVisible: true, align: 'right', minWidth: 82, scopes: ['cloning', 'primers'], metaKey: 'Tm' },
  { id: 'gcPrimerBind', label: '%GC Primer Bind', defaultVisible: true, align: 'right', minWidth: 120, scopes: ['cloning', 'primers'], metaKey: '%GC Primer Bind' },
  { id: 'hairpin', label: 'Hairpin', defaultVisible: false, align: 'right', minWidth: 104, scopes: ['cloning', 'primers'], metaKey: 'Hairpin' },
  { id: 'oligoType', label: 'Oligo Type', defaultVisible: true, align: 'left', minWidth: 118, scopes: ['cloning', 'primers'], metaKey: 'Oligo Type' },
  { id: 'primerDimer', label: 'Primer-Dimer', defaultVisible: false, align: 'right', minWidth: 108, scopes: ['cloning', 'primers'], metaKey: 'Primer-Dimer' },
  { id: 'repliconType', label: 'Replicon type', defaultVisible: false, align: 'left', minWidth: 118, scopes: ['cloning', 'plasmids'], metaKey: 'Replicon type' },

  // Contig Assembly folder columns
  { id: 'numDisagreements', label: '# Disagreements', defaultVisible: false, align: 'right', minWidth: 120, scopes: ['contig'], metaKey: '# Disagreements' },
  { id: 'numIndelDisagreements', label: '# Indel Disagreements', defaultVisible: false, align: 'right', minWidth: 148, scopes: ['contig'], metaKey: '# Indel Disagreements' },
  { id: 'pctHq', label: '% HQ', defaultVisible: true, align: 'right', minWidth: 78, scopes: ['contig'], metaKey: '% HQ' },
  { id: 'pctLq', label: '% LQ', defaultVisible: false, align: 'right', minWidth: 78, scopes: ['contig'], metaKey: '% LQ' },
  { id: 'pctMq', label: '% MQ', defaultVisible: false, align: 'right', minWidth: 78, scopes: ['contig'], metaKey: '% MQ' },
  { id: 'ambiguities', label: 'Ambiguities', defaultVisible: false, align: 'right', minWidth: 96, scopes: ['contig'], metaKey: 'Ambiguities' },
  { id: 'approxConsensusLength', label: 'Approx. Consensus Length', defaultVisible: false, align: 'right', minWidth: 168, scopes: ['contig'], metaKey: 'Approx. Consensus Length' },
  { id: 'bin', label: 'Bin', defaultVisible: false, align: 'left', minWidth: 82, scopes: ['contig'], metaKey: 'Bin' },
  { id: 'failedBinningFields', label: 'Failed Binning Fields', defaultVisible: false, align: 'left', minWidth: 142, scopes: ['contig'], metaKey: 'Failed Binning Fields' },
  { id: 'isForwardRead', label: 'Is Forward Read', defaultVisible: false, align: 'center', minWidth: 116, scopes: ['contig'], metaKey: 'Is Forward Read' },
  { id: 'pairedDataType', label: 'Paired Data Type', defaultVisible: false, align: 'left', minWidth: 124, scopes: ['contig'], metaKey: 'Paired Data Type' },
  { id: 'postTrimLength', label: 'Post-Trim Length', defaultVisible: true, align: 'right', minWidth: 120, scopes: ['contig'], metaKey: 'Post-Trim Length' },
  { id: 'readTechnology', label: 'Read Technology', defaultVisible: false, align: 'left', minWidth: 140, scopes: ['contig'], metaKey: 'Read Technology' },
  { id: 'trimParameters', label: 'Trim Parameters', defaultVisible: false, align: 'left', minWidth: 148, scopes: ['contig'], metaKey: 'Trim Parameters' },

  // Protein Documents folder columns
  { id: 'pdbName', label: 'PDB name', defaultVisible: true, align: 'left', minWidth: 96, scopes: ['proteins'], metaKey: 'PDB name' },

  // Tree Documents folder columns
  { id: 'height', label: 'Height', defaultVisible: true, align: 'right', minWidth: 86, scopes: ['trees'], metaKey: 'Height' },
  { id: 'noNodes', label: 'No. nodes', defaultVisible: true, align: 'right', minWidth: 90, scopes: ['trees'], metaKey: 'No. nodes' },
  { id: 'noTips', label: 'No. tips', defaultVisible: true, align: 'right', minWidth: 86, scopes: ['trees'], metaKey: 'No. tips' },
  { id: 'treeBuilder', label: 'Tree builder', defaultVisible: true, align: 'left', minWidth: 155, scopes: ['trees'] },

  // Genomes & Subfolders (Bacteria, Eukaryotes, Human, Plants, Viruses)
  {
    id: 'annotationDate',
    label: 'Annotation Date (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 210,
    scopes: ['genomes'],
    metaKey: 'Annotation Date (Genome-Annotation-Data)',
  },
  {
    id: 'annotationMethod',
    label: 'Annotation Method (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 225,
    scopes: ['genomes'],
    metaKey: 'Annotation Method (Genome-Annotation-Data)',
  },
  {
    id: 'annotationName',
    label: 'Annotation Name (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 215,
    scopes: ['genomes'],
    metaKey: 'Annotation Name (Genome-Annotation-Data)',
  },
  {
    id: 'annotationPipeline',
    label: 'Annotation Pipeline (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 225,
    scopes: ['genomes'],
    metaKey: 'Annotation Pipeline (Genome-Annotation-Data)',
  },
  {
    id: 'annotationProvider',
    label: 'Annotation Provider (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 225,
    scopes: ['genomes'],
    metaKey: 'Annotation Provider (Genome-Annotation-Data)',
  },
  {
    id: 'annotationSoftwareRevision',
    label: 'Annotation Software revision (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 245,
    scopes: ['genomes'],
    metaKey: 'Annotation Software revision (Genome-Annotation-Data)',
  },
  {
    id: 'annotationStatus',
    label: 'Annotation Status (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 215,
    scopes: ['genomes'],
    metaKey: 'Annotation Status (Genome-Annotation-Data)',
  },
  {
    id: 'assemblyDate',
    label: 'Assembly Date (Genome-Assembly-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 205,
    scopes: ['genomes'],
    metaKey: 'Assembly Date (Genome-Assembly-Data)',
  },
  {
    id: 'assemblyMethod',
    label: 'Assembly Method (Genome-Assembly-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 205,
    scopes: ['genomes'],
    metaKey: 'Assembly Method (Genome-Assembly-Data)',
  },
  {
    id: 'assemblyName',
    label: 'Assembly Name (Genome-Assembly-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 205,
    scopes: ['genomes'],
    metaKey: 'Assembly Name (Genome-Assembly-Data)',
  },
  {
    id: 'assemblyProvider',
    label: 'Assembly Provider (Genome-Assembly-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 215,
    scopes: ['genomes'],
    metaKey: 'Assembly Provider (Genome-Assembly-Data)',
  },
  {
    id: 'cdssTotal',
    label: 'CDSs (total) (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 195,
    scopes: ['genomes'],
    metaKey: 'CDSs (total) (Genome-Annotation-Data)',
  },
  {
    id: 'cdssWithProtein',
    label: 'CDSs (with protein) (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 215,
    scopes: ['genomes'],
    metaKey: 'CDSs (with protein) (Genome-Annotation-Data)',
  },
  {
    id: 'featuresAnnotated',
    label: 'Features Annotated (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 220,
    scopes: ['genomes'],
    metaKey: 'Features Annotated (Genome-Annotation-Data)',
  },
  {
    id: 'genesCoding',
    label: 'Genes (coding) (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 205,
    scopes: ['genomes'],
    metaKey: 'Genes (coding) (Genome-Annotation-Data)',
  },
  {
    id: 'genesRna',
    label: 'Genes (RNA) (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 195,
    scopes: ['genomes'],
    metaKey: 'Genes (RNA) (Genome-Annotation-Data)',
  },
  {
    id: 'genesTotal',
    label: 'Genes (total) (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 195,
    scopes: ['genomes'],
    metaKey: 'Genes (total) (Genome-Annotation-Data)',
  },
  {
    id: 'genomeCoverage',
    label: 'Genome Coverage (Genome-Assembly-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 210,
    scopes: ['genomes'],
    metaKey: 'Genome Coverage (Genome-Assembly-Data)',
  },
  {
    id: 'ncRnas',
    label: 'ncRNAs (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 190,
    scopes: ['genomes'],
    metaKey: 'ncRNAs (Genome-Annotation-Data)',
  },
  {
    id: 'pseudoGenesTotal',
    label: 'Pseudo Genes (total) (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 220,
    scopes: ['genomes'],
    metaKey: 'Pseudo Genes (total) (Genome-Annotation-Data)',
  },
  {
    id: 'rRnas',
    label: 'rRNAs (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 190,
    scopes: ['genomes'],
    metaKey: 'rRNAs (Genome-Annotation-Data)',
  },
  {
    id: 'completeRRnas',
    label: 'complete rRNAs (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'left',
    minWidth: 210,
    scopes: ['genomes'],
    metaKey: 'complete rRNAs (Genome-Annotation-Data)',
  },
  {
    id: 'sequencingTechnology',
    label: 'Sequencing Technology (Genome-Assembly-Data)',
    defaultVisible: true,
    align: 'left',
    minWidth: 220,
    scopes: ['genomes'],
    metaKey: 'Sequencing Technology (Genome-Assembly-Data)',
  },
  {
    id: 'tRnas',
    label: 'tRNAs (Genome-Annotation-Data)',
    defaultVisible: false,
    align: 'right',
    minWidth: 190,
    scopes: ['genomes'],
    metaKey: 'tRNAs (Genome-Annotation-Data)',
  },
  { id: 'chromosome', label: 'chromosome', defaultVisible: false, align: 'left', minWidth: 102, scopes: ['genomes'], metaKey: 'chromosome' },
  { id: 'collectionDate', label: 'collection_date', defaultVisible: false, align: 'left', minWidth: 118, scopes: ['genomes'], metaKey: 'collection_date' },
  { id: 'country', label: 'country', defaultVisible: false, align: 'left', minWidth: 112, scopes: ['genomes'], metaKey: 'country' },
  { id: 'cultivar', label: 'cultivar', defaultVisible: false, align: 'left', minWidth: 112, scopes: ['genomes'], metaKey: 'cultivar' },
  { id: 'dbXref', label: 'db_xref', defaultVisible: false, align: 'left', minWidth: 118, scopes: ['genomes'], metaKey: 'db_xref' },
  { id: 'haplotype', label: 'haplotype', defaultVisible: false, align: 'left', minWidth: 110, scopes: ['genomes'], metaKey: 'haplotype' },
  { id: 'host', label: 'host', defaultVisible: false, align: 'left', minWidth: 135, scopes: ['genomes'], metaKey: 'host' },
  { id: 'isolate', label: 'isolate', defaultVisible: false, align: 'left', minWidth: 120, scopes: ['genomes'], metaKey: 'isolate' },
  { id: 'strain', label: 'strain', defaultVisible: false, align: 'left', minWidth: 125, scopes: ['genomes'], metaKey: 'strain' },
  { id: 'subStrain', label: 'sub_strain', defaultVisible: false, align: 'left', minWidth: 118, scopes: ['genomes'], metaKey: 'sub_strain' },
];

export function resolveFolderColumnScopes(selectedFolder: string): FolderColumnScope[] {
  const f = selectedFolder.trim();
  if (
    f === 'All Project Files' ||
    f === 'All Documents' ||
    f === 'Local' ||
    f === 'Sample Documents' ||
    f === 'Favorites' ||
    f === 'Deleted Items'
  ) {
    return ['core', 'alignments', 'cloning', 'contig', 'genomes', 'plasmids', 'primers', 'proteins', 'trees'];
  }
  if (f === 'Alignments') return ['core', 'alignments'];
  if (f === 'Cloning' || f === 'Cloning Inserts & PCR') return ['core', 'cloning'];
  if (f === 'Contig Assembly' || f === 'Contig Assembly & Traces' || f === 'Sequencing Reads (Sanger/NGS)') {
    return ['core', 'contig'];
  }
  if (
    f === 'Genomes' ||
    f === 'Genomes & NGS' ||
    f.startsWith('Genomes/') ||
    f === 'Bacteria' ||
    f === 'Eukaryotes' ||
    f === 'Human' ||
    f === 'Plants' ||
    f === 'Viruses'
  ) {
    return ['core', 'genomes'];
  }
  if (f === 'Plasmids & Vectors') return ['core', 'plasmids'];
  if (f === 'Primers' || f === 'Primers & Guides') return ['core', 'primers'];
  if (f === 'Protein Documents' || f === 'Protein Homologs') return ['core', 'proteins'];
  if (f === 'Tree Documents') return ['core', 'trees'];
  return ['core'];
}

export function getFolderAwareDocumentColumns(
  docsInFolder: SequenceDocument[],
  selectedFolder: string
): DynamicDocColumnDef[] {
  const activeScopes = new Set(resolveFolderColumnScopes(selectedFolder));
  const included: DynamicDocColumnDef[] = [];
  const knownLabels = new Set<string>();
  const knownMetaKeys = new Set<string>([
    'Organism',
    'Common Name',
    'Taxonomy',
    'GID',
    'First Residues',
    'URN',
    'Size',
    'Tree builder',
    'Modified',
    'Created',
    'Sequence Length',
    '# Sequences',
    '% Pairwise Identity',
    '% Identical Sites',
    'Genetic Code',
    'Mean Coverage',
    'Is Contig Summary',
    'Declared Length',
    'Base Count A',
    'Base Count C',
    'Base Count G',
    'Base Count T',
  ]);

  for (const col of WORKBENCH_FOLDER_COLUMN_CATALOG) {
    const scopeMatch = col.scopes.some((s) => activeScopes.has(s));
    const hasMetaInDocs =
      col.metaKey !== undefined &&
      docsInFolder.some((d) => d.docMetadata && col.metaKey! in d.docMetadata);
    if (scopeMatch || hasMetaInDocs) {
      included.push(col);
      knownLabels.add(col.label);
      if (col.metaKey) knownMetaKeys.add(col.metaKey);
    }
  }

  // Dynamically discover any additional docMetadata keys on documents in this folder
  for (const doc of docsInFolder) {
    if (!doc.docMetadata) continue;
    for (const key of Object.keys(doc.docMetadata)) {
      if (!knownMetaKeys.has(key) && !knownLabels.has(key)) {
        knownMetaKeys.add(key);
        knownLabels.add(key);
        included.push({
          id: `meta:${key}`,
          label: key,
          defaultVisible: false,
          align: typeof doc.docMetadata[key] === 'number' ? 'right' : 'left',
          minWidth: 120,
          scopes: ['core'],
          metaKey: key,
        });
      }
    }
  }

  return included;
}

/**
 * Strict ASCII code-point sort for the [⊞ Columns] checklist order:
 * `# ...` -> `% ...` -> `A..Z` -> `a..z` -> symbols (`★`).
 */
export function sortColumnsAsciiAlphabetical<T extends { label: string }>(cols: readonly T[]): T[] {
  return [...cols].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

export function getDefaultVisibleColumnsForFolder(
  selectedFolder: string,
  availableCols: readonly DynamicDocColumnDef[]
): string[] {
  const isAggregateFolder =
    selectedFolder === 'All Project Files' ||
    selectedFolder === 'All Documents' ||
    selectedFolder === 'Local' ||
    selectedFolder === 'Sample Documents' ||
    selectedFolder === 'Favorites' ||
    selectedFolder === 'Deleted Items';

  if (isAggregateFolder) {
    return DOC_TABLE_COLUMN_PRESETS['standard-cloning'].columns;
  }

  if (selectedFolder === 'Alignments') {
    const preferredOrder = [
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
      'maxSeqLength',
      'minSeqLength',
      'freeEndGaps',
      'alignmentOptions',
      'alignmentScore',
      'numNucleotides',
    ];
    const availIds = new Set(availableCols.map((c) => c.id));
    return preferredOrder.filter((id) => availIds.has(id));
  }

  if (selectedFolder === 'Contig Assembly') {
    const preferredOrder = [
      'icon',
      'name',
      'description',
      'modified',
      'organism',
      'pctHq',
      'length',
      'postTrimLength',
      'numSequences',
    ];
    const availIds = new Set(availableCols.map((c) => c.id));
    return preferredOrder.filter((id) => availIds.has(id));
  }

  if (
    selectedFolder === 'Genomes' ||
    selectedFolder === 'Genomes & NGS' ||
    selectedFolder.startsWith('Genomes/') ||
    selectedFolder === 'Bacteria' ||
    selectedFolder === 'Eukaryotes' ||
    selectedFolder === 'Human' ||
    selectedFolder === 'Plants' ||
    selectedFolder === 'Viruses'
  ) {
    const preferredOrder = [
      'icon',
      'name',
      'description',
      'modified',
      'organism',
      'length',
      'accession',
      'gid',
      'topology',
      'sequencingTechnology',
    ];
    const availIds = new Set(availableCols.map((c) => c.id));
    return preferredOrder.filter((id) => availIds.has(id));
  }

  const scopes = resolveFolderColumnScopes(selectedFolder);
  const specificScopes: FolderColumnScope[] = scopes.filter((s) => s !== 'core');
  const cols = availableCols.filter((c) => {
    if (c.alwaysVisible) return true;
    if (c.id === 'organism' && specificScopes.includes('genomes')) return true;
    if (c.scopes.includes('core')) return c.defaultVisible;
    return c.defaultVisible && c.scopes.some((s) => specificScopes.includes(s));
  });
  return cols.map((c) => c.id);
}

/**
 * Returns the document's primary stored primer record, or computes one from the
 * sequence via `primerRecordFromDoc` when the document is itself a primer
 * (`inferDocumentIconKind(doc) === 'primer'`) that stores none (BG-01M6XTJ0).
 */
function documentPrimerRecord(doc: SequenceDocument): PrimerRecord | null {
  if (doc.primers.length > 0) return doc.primers[0];
  return inferDocumentIconKind(doc) === 'primer' ? primerRecordFromDoc(doc) : null;
}

export function getDocumentColumnDisplayValue(
  doc: SequenceDocument,
  metrics: ComputedDocumentRowMetrics,
  colId: string,
  isFavorite: boolean = false
): string {
  switch (colId) {
    case 'icon':
      return inferDocumentIconKind(doc);
    case 'favorite':
      return isFavorite ? '★' : '';
    case 'name':
      return doc.name;
    case 'accession':
      return doc.accession || '-';
    case 'type':
      return metrics.docTypeLabel;
    case 'topology':
      return doc.topology === 'circular' ? 'Circular' : 'Linear';
    case 'length':
      if (doc.docMetadata?.['Sequence Length'] !== undefined) {
        const v = String(doc.docMetadata['Sequence Length']).trim();
        return v || '-';
      }
      return metrics.lengthLabel;
    case 'gc':
      if (doc.docMetadata?.['% GC'] !== undefined) {
        const v = String(doc.docMetadata['% GC']).trim();
        return v || '-';
      }
      return metrics.gcLabel === '—' ? '-' : metrics.gcLabel;
    case 'annotations':
      return metrics.annotationsCount.toLocaleString();
    case 'numSequences':
      if (doc.docMetadata?.['# Sequences'] !== undefined) {
        const v = String(doc.docMetadata['# Sequences']).trim();
        return v || '-';
      }
      return metrics.numSequences.toLocaleString();
    case 'pairwiseIdentity':
      if (doc.docMetadata?.['% Pairwise Identity'] !== undefined) {
        return String(doc.docMetadata['% Pairwise Identity']);
      }
      return metrics.pairwiseIdentityLabel === '—' ? '-' : metrics.pairwiseIdentityLabel;
    case 'identicalSites':
      if (doc.docMetadata?.['% Identical Sites'] !== undefined) {
        return String(doc.docMetadata['% Identical Sites']);
      }
      return metrics.identicalSitesLabel === '—' ? '-' : metrics.identicalSitesLabel;
    case 'geneticCode':
      if (doc.docMetadata?.['Genetic Code'] !== undefined) {
        return String(doc.docMetadata['Genetic Code']);
      }
      return metrics.geneticCodeLabel || '-';
    case 'meanCoverage':
      if (doc.docMetadata?.['Mean Coverage'] !== undefined) {
        return String(doc.docMetadata['Mean Coverage']);
      }
      return metrics.meanCoverageLabel === '—' ? '-' : metrics.meanCoverageLabel;
    case 'treeBuilder':
      return doc.docMetadata?.['Tree builder']
        ? String(doc.docMetadata['Tree builder'])
        : metrics.treeBuilderLabel === '—'
        ? '-'
        : metrics.treeBuilderLabel;
    case 'modified':
      if (doc.docMetadata?.Modified !== undefined) {
        return String(doc.docMetadata.Modified);
      }
      return metrics.modifiedFormatted === '—' ? '-' : metrics.modifiedFormatted;
    case 'created':
      if (doc.docMetadata?.Created !== undefined) {
        return String(doc.docMetadata.Created);
      }
      return metrics.createdFormatted === '—' ? '-' : metrics.createdFormatted;
    case 'status': {
      // The record's check state, never "OK" for checks that did not run (BG-01M6S1B3).
      const verdict = recordCheckVerdict(metrics);
      if (verdict === 'alerts') return `${metrics.alertsCount} alert(s)`;
      if (verdict === 'clear') return 'OK';
      return verdict === 'partial' ? 'Partly checked' : 'Not checked';
    }
    case 'description':
      return doc.description || '-';
    case 'organism':
      return doc.docMetadata?.Organism
        ? String(doc.docMetadata.Organism)
        : doc.topology === 'circular'
        ? 'Escherichia coli / Cloning vector'
        : '-';
    case 'commonName':
      return doc.docMetadata?.['Common Name'] ? String(doc.docMetadata['Common Name']) : '-';
    case 'taxonomy':
      return doc.docMetadata?.Taxonomy ? String(doc.docMetadata.Taxonomy) : '-';
    case 'firstResidues': {
      if (doc.docMetadata?.['First Residues']) return String(doc.docMetadata['First Residues']);
      const clean = doc.sequence.slice(0, 18);
      return clean.length > 0 ? `${clean}${doc.sequence.length > 18 ? '...' : ''}` : '-';
    }
    case 'gid':
      return doc.docMetadata?.GID ? String(doc.docMetadata.GID) : '-';
    case 'size': {
      if (doc.docMetadata?.Size) return String(doc.docMetadata.Size);
      const kb = Math.max(0.4, (doc.sequence.length + doc.features.length * 120) / 1024);
      return `${kb.toFixed(1)} KB`;
    }
    case 'urn':
      return doc.docMetadata?.URN
        ? String(doc.docMetadata.URN)
        : `urn:molbiocraft:local:${doc.id}`;
    case 'tm': {
      if (doc.docMetadata?.Tm !== undefined) return String(doc.docMetadata.Tm);
      const primer = documentPrimerRecord(doc);
      if (primer) return `${primer.tmFullC.toFixed(1)} °C`;
      return '-';
    }
    case 'gcPrimerBind': {
      if (doc.docMetadata?.['%GC Primer Bind'] !== undefined) {
        return String(doc.docMetadata['%GC Primer Bind']);
      }
      if (doc.primers.length > 0) return `${doc.primers[0].gcPercent.toFixed(1)}%`;
      return '-';
    }
    case 'hairpin': {
      if (doc.docMetadata?.Hairpin !== undefined) return String(doc.docMetadata.Hairpin);
      const primer = documentPrimerRecord(doc);
      if (primer) return `${primer.hairpinDeltaG.toFixed(1)} kcal/mol`;
      return '-';
    }
    case 'primerDimer': {
      if (doc.docMetadata?.['Primer-Dimer'] !== undefined) {
        return String(doc.docMetadata['Primer-Dimer']);
      }
      const primer = documentPrimerRecord(doc);
      if (primer) return `${primer.selfDimerDeltaG.toFixed(1)} kcal/mol`;
      return '-';
    }
    case 'repliconType':
      if (doc.docMetadata?.['Replicon type'] !== undefined) {
        return String(doc.docMetadata['Replicon type']);
      }
      return doc.topology === 'circular' ? 'plasmid' : '-';
    default: {
      const catEntry = WORKBENCH_FOLDER_COLUMN_CATALOG.find((c) => c.id === colId);
      const metaKey = catEntry?.metaKey ?? (colId.startsWith('meta:') ? colId.slice(5) : colId);
      const val = doc.docMetadata?.[metaKey];
      if (val === undefined || val === null || val === '') return '-';
      return typeof val === 'number' ? val.toLocaleString() : String(val);
    }
  }
}

export function parseSortableNumericValue(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === '-' || trimmed === '—') return null;
  const cleaned = trimmed.replace(/,/g, '');
  const m = cleaned.match(/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?=\s*(?:%|bp|aa|nt|kb|mb|×|x|°c|c|kcal\/mol|da|kda|mm|nm|µm|ul|ng|pmol)?$)/i);
  if (!m) return null;
  const num = Number(m[0]);
  return Number.isFinite(num) ? num : null;
}

const documentRowMetricsCache = new WeakMap<
  SequenceDocument,
  { key: string; metrics: ComputedDocumentRowMetricsRust }
>();

function buildDocumentMetricsKey(doc: SequenceDocument): string {
  return `${doc.updatedAt}|${doc.sequence.length}|${doc.features.length}|${doc.primers.length}|${doc.topology}|${doc.moleculeType}|${doc.documentKind ?? ''}|${doc.folder}|${doc.name}|${doc.description.length}`;
}

export function computeDocumentTableMetrics(doc: SequenceDocument): ComputedDocumentRowMetrics {
  const cacheKey = buildDocumentMetricsKey(doc);
  const cached = documentRowMetricsCache.get(doc);
  if (cached && cached.key === cacheKey) {
    return cached.metrics;
  }

  const metrics = computeDocumentTableMetricsRust(doc);
  documentRowMetricsCache.set(doc, { key: cacheKey, metrics });
  return metrics;
}

/**
 * Serialize any visible folder/smart-table column slice to RFC-4180 CSV or TSV via Rust (`csv` crate).
 */
export function exportDelimitedTableViaRust(
  headers: string[],
  rows: string[][],
  delimiter: ',' | '\t' = ','
): string {
  return exportTableDelimitedCsvRust(headers, rows, delimiter);
}

export function sortDocumentsByColumn(
  docs: SequenceDocument[],
  columnId: string | null,
  direction: 'asc' | 'desc',
  favoriteIds: ReadonlySet<string>
): SequenceDocument[] {
  if (!columnId || docs.length <= 1) return docs;
  const mult = direction === 'asc' ? 1 : -1;
  // Schwartzian precomputation: compute/fetch row metrics once O(N) instead of O(N log N) inside comparator
  const precomputed = new Map<SequenceDocument, ComputedDocumentRowMetrics>();
  for (const d of docs) {
    precomputed.set(d, computeDocumentTableMetrics(d));
  }
  return [...docs].sort((a, b) => {
    const ma = precomputed.get(a)!;
    const mb = precomputed.get(b)!;
    let cmp = 0;
    switch (columnId) {
      case 'favorite': {
        const fa = favoriteIds.has(a.id) ? 1 : 0;
        const fb = favoriteIds.has(b.id) ? 1 : 0;
        cmp = fb - fa;
        break;
      }
      case 'icon':
        cmp = inferDocumentIconKind(a).localeCompare(inferDocumentIconKind(b));
        break;
      case 'topology':
        cmp = a.topology.localeCompare(b.topology);
        break;
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'accession':
        cmp = a.accession.localeCompare(b.accession);
        break;
      case 'type':
        cmp = ma.docTypeLabel.localeCompare(mb.docTypeLabel);
        break;
      case 'length':
        cmp = ma.lengthNum - mb.lengthNum;
        break;
      case 'gc':
        cmp = ma.gcPct - mb.gcPct;
        break;
      case 'annotations':
        cmp = ma.annotationsCount - mb.annotationsCount;
        break;
      case 'numSequences':
        cmp = ma.numSequences - mb.numSequences;
        break;
      case 'pairwiseIdentity':
        cmp = (ma.pairwiseIdentityPct ?? -1) - (mb.pairwiseIdentityPct ?? -1);
        break;
      case 'identicalSites':
        cmp = (ma.identicalSitesPct ?? -1) - (mb.identicalSitesPct ?? -1);
        break;
      case 'geneticCode':
        cmp = ma.geneticCodeLabel.localeCompare(mb.geneticCodeLabel);
        break;
      case 'meanCoverage':
        cmp = (ma.meanCoverageX ?? -1) - (mb.meanCoverageX ?? -1);
        break;
      case 'treeBuilder':
        cmp = ma.treeBuilderLabel.localeCompare(mb.treeBuilderLabel);
        break;
      case 'modified':
        cmp = a.updatedAt.localeCompare(b.updatedAt);
        break;
      case 'created':
        cmp = a.createdAt.localeCompare(b.createdAt);
        break;
      case 'status':
        cmp =
          RECORD_CHECK_SORT_RANK[recordCheckVerdict(ma)] - RECORD_CHECK_SORT_RANK[recordCheckVerdict(mb)] ||
          ma.alertsCount - mb.alertsCount;
        break;
      case 'description':
        cmp = a.description.localeCompare(b.description);
        break;
      default: {
        const va = getDocumentColumnDisplayValue(a, ma, columnId, favoriteIds.has(a.id));
        const vb = getDocumentColumnDisplayValue(b, mb, columnId, favoriteIds.has(b.id));
        const na = parseSortableNumericValue(va);
        const nb = parseSortableNumericValue(vb);
        if (na !== null && nb !== null) {
          cmp = na - nb;
        } else {
          cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
        }
        break;
      }
    }
    if (cmp === 0) return a.name.localeCompare(b.name);
    return cmp * mult;
  });
}

/**
 * Concatenate 2 or more SequenceDocuments end-to-end via Rust (`molbiocraft-cloning`),
 * shifting all SequenceFeature and PrimerRecord coordinates and recording lineage.
 */
export function concatenateSequenceDocuments(
  docs: SequenceDocument[],
  spacer = ''
): SequenceDocument {
  if (docs.length === 0) {
    throw new Error('At least one sequence document is required to concatenate.');
  }
  return invokeRustBioSync<SequenceDocument>('concatenate_documents', { docs, spacer });
}

/**
 * Align 2+ SequenceDocuments and compute a thresholded IUPAC Consensus SequenceDocument in Rust.
 */
export function generateConsensusDocument(
  docs: SequenceDocument[],
  thresholdPct = 60
): SequenceDocument {
  if (docs.length === 0) {
    throw new Error('Select at least one sequence document to generate a consensus.');
  }
  return invokeRustBioSync<SequenceDocument>('generate_consensus_document', {
    docs,
    thresholdPct,
  });
}

/**
 * Mask either the selected range or low-complexity homopolymer tracts in Rust.
 */
export function maskSequenceRegions(
  doc: SequenceDocument,
  mode: 'selection' | 'low-complexity',
  range?: { start: number; end: number } | null
): { updated: SequenceDocument; maskedBases: number; maskedRuns: number; annotationsOmitted: boolean } {
  return invokeRustBioSync('mask_sequence_regions', {
    doc,
    mode,
    range: range ?? null,
  });
}

/**
 * Extract annotated features (supporting reverse-strand and spliced multi-segment features) in Rust.
 */
export function extractAnnotatedFeaturesToDocuments(
  doc: SequenceDocument,
  filterType: 'CDS' | 'all' = 'CDS'
): SequenceDocument[] {
  return invokeRustBioSync<SequenceDocument[]>('extract_annotated_features', {
    doc,
    filterType,
  });
}

/**
 * Convert a selected subsequence into an attached PrimerRecord with SantaLucia 1998 thermodynamics in Rust.
 */
export function convertSelectionToOligoPrimer(
  doc: SequenceDocument,
  range: { start: number; end: number } | null,
  strand: 1 | -1 = 1
): { updatedDoc: SequenceDocument; primer: PrimerRecord } {
  return invokeRustBioSync('convert_selection_to_oligo', {
    doc,
    range: range ?? null,
    strand,
  });
}

/**
 * Scan a SequenceDocument for Gateway attB / attP / attL / attR recombination sites in Rust.
 */
export function annotateGatewayAttSites(doc: SequenceDocument): {
  updatedDoc: SequenceDocument;
  addedCount: number;
} {
  return invokeRustBioSync('annotate_gateway_att_sites', { doc });
}

/**
 * Flank a selected region (or full linear sequence) with Gateway attB1 and attB2 sites in Rust.
 */
export function addAttBSitesToSequence(
  doc: SequenceDocument,
  range?: { start: number; end: number } | null
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('add_attb_sites', {
    doc,
    range: range ?? null,
  });
}

/**
 * Export a multi-record GenBank bundle containing targetDoc plus all linked parents/descendants in Rust.
 */
export function exportLineageBundleGenBank(
  targetDoc: SequenceDocument,
  allDocs: SequenceDocument[]
): { content: string; includedNames: string[] } {
  return invokeRustBioSync('export_lineage_bundle_genbank', {
    targetDoc,
    allDocs,
  });
}

/**
 * Modify Annotation Intervals across all features in a SequenceDocument in Rust.
 */
export function batchModifyAnnotationIntervals(
  doc: SequenceDocument,
  deltaStartBp: number,
  deltaEndBp: number
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('batch_modify_annotation_intervals', {
    doc,
    deltaStartBp,
    deltaEndBp,
  });
}

/**
 * Set CDS Translation qualifiers on all CDS features in a SequenceDocument in Rust.
 */
export function batchSetCdsTranslationProperty(doc: SequenceDocument): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('batch_set_cds_translation', { doc });
}

/**
 * Deterministic Fisher-Yates random subsample of N documents in Rust.
 */
export function randomlySampleDocuments(
  docs: SequenceDocument[],
  sampleSize: number,
  seed = 20261030
): SequenceDocument[] {
  return invokeRustBioSync<SequenceDocument[]>('randomly_sample_documents', {
    docs,
    sampleSize,
    seed,
  });
}

/**
 * Group sequences into folders based on leading name prefix in Rust.
 */
export function groupDocumentsByPrefix(docs: SequenceDocument[]): {
  updatedDocs: SequenceDocument[];
  groupsCreated: string[];
} {
  return invokeRustBioSync('group_documents_by_prefix', { docs });
}
