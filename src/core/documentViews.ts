// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';
import { isContigSummaryRecord } from './contigSummary';

export type ViewerTab =
  | 'sequence-view' | 'annotations-table' | 'text-view' | 'vector-library'
  | 'cloning-gel' | 'primers-pcr' | 'sequence-alignment' | 'phylogenetics'
  | 'sanger-contig' | 'genomics-ngs' | 'history-hybrid' | 'guided-pipelines'
  | 'document-info';

export const VIEWER_TAB_ORDER: readonly ViewerTab[] = [
  'sequence-view', 'annotations-table', 'text-view', 'vector-library',
  'cloning-gel', 'primers-pcr', 'sequence-alignment', 'phylogenetics',
  'sanger-contig', 'genomics-ngs', 'history-hybrid', 'guided-pipelines', 'document-info',
];

/** Human-readable view names for status messages. */
export const VIEWER_TAB_LABELS: Record<ViewerTab, string> = {
  'sequence-view': 'Sequence view',
  'annotations-table': 'Annotations table',
  'text-view': 'Text view',
  'vector-library': 'Vector Library',
  'cloning-gel': 'Cloning & Gel studio',
  'primers-pcr': 'Primers & PCR studio',
  'sequence-alignment': 'Alignment studio',
  phylogenetics: 'Phylogenetics studio',
  'sanger-contig': 'Chromatogram studio',
  'genomics-ngs': 'Genomics studio',
  'history-hybrid': 'History & tools',
  'guided-pipelines': 'Guided pipelines',
  'document-info': 'Document info',
};

export function isTreeDocument(doc: SequenceDocument): boolean {
  return doc.documentKind === 'tree' || Boolean(doc.docMetadata?.Newick);
}

export function hasBiologicalSequence(doc: SequenceDocument): boolean {
  return doc.sequence.length > 0 && !isTreeDocument(doc) &&
    !['Text Document', 'Enzyme Set'].includes(String(doc.docMetadata?.['Document Type'] ?? ''));
}

/** Folder names organize records; they do not change the record's data type. */
export function supportedViewerTabs(doc: SequenceDocument): ViewerTab[] {
  if (!doc.id) return [];
  if (doc.docMetadata?.['Document Type'] === 'Text Document') return ['text-view', 'document-info'];
  if (doc.docMetadata?.['Document Type'] === 'Enzyme Set') return ['history-hybrid', 'document-info'];
  if (isTreeDocument(doc)) return ['phylogenetics', 'text-view', 'history-hybrid', 'document-info',
    ...((doc.alignmentMeta?.sequences?.length ?? 0) > 1 ? ['sequence-alignment' as const] : [])];
  // Annotation-only genome summaries: a genome-scale map, the annotation table, the flat-file
  // header (a summary has no ORIGIN block), the provenance trail and record info.
  if (isContigSummaryRecord(doc)) return ['sequence-view', 'annotations-table', 'text-view', 'history-hybrid', 'document-info'];
  if (!hasBiologicalSequence(doc)) return ['document-info'];
  const tabs: ViewerTab[] = ['sequence-view', 'annotations-table', 'text-view',
    'sequence-alignment', 'phylogenetics', 'genomics-ngs', 'history-hybrid', 'guided-pipelines', 'document-info'];
  if (doc.moleculeType === 'DNA') {
    tabs.push('vector-library', 'cloning-gel', 'primers-pcr');
    if (doc.chromatogram || doc.documentKind === 'trace') tabs.push('sanger-contig');
  }
  return tabs;
}

/** Persistent document views. Analysis tools join the strip only when explicitly opened. */
export function relevantViewerTabs(doc: SequenceDocument, selectedDocuments: readonly SequenceDocument[] = []): ViewerTab[] {
  const supported = supportedViewerTabs(doc);
  if (isContigSummaryRecord(doc)) return supported;
  if (!hasBiologicalSequence(doc)) return VIEWER_TAB_ORDER.filter((tab) => supported.includes(tab));
  const tabs = new Set<ViewerTab>(['sequence-view', 'annotations-table', 'text-view', 'history-hybrid', 'document-info']);
  const embedded = (doc.alignmentMeta?.sequences?.length ?? 0) > 1;
  const selected = selectedSequenceInputs(doc, selectedDocuments);
  if (doc.documentKind === 'alignment' || doc.documentKind === 'contig' || embedded || selected.length > 1) {
    tabs.add('sequence-alignment');
    // Sequence lists and contigs do not imply that a phylogeny has been requested.
    if (doc.documentKind === 'alignment' && doc.alignmentMeta?.isAligned !== false) tabs.add('phylogenetics');
  }
  if (doc.chromatogram || doc.documentKind === 'trace') tabs.add('sanger-contig');
  if (doc.docMetadata?.PDBText || doc.docMetadata?.['PDB name']) tabs.add('genomics-ngs');
  return VIEWER_TAB_ORDER.filter((tab) => tabs.has(tab) && supported.includes(tab));
}

export function preferredViewerTab(doc: SequenceDocument): ViewerTab {
  if (doc.docMetadata?.['Document Type'] === 'Text Document') return 'text-view';
  if (doc.docMetadata?.['Document Type'] === 'Enzyme Set') return 'history-hybrid';
  if (isTreeDocument(doc)) return 'phylogenetics';
  if (isContigSummaryRecord(doc)) return 'sequence-view';
  if (!hasBiologicalSequence(doc)) return 'document-info';
  if (doc.moleculeType === 'DNA' && (doc.chromatogram || doc.documentKind === 'trace')) return 'sanger-contig';
  if (doc.documentKind === 'alignment' || doc.documentKind === 'contig' ||
      (doc.alignmentMeta?.sequences?.length ?? 0) > 1) return 'sequence-alignment';
  if (doc.docMetadata?.PDBText) return 'genomics-ngs';
  return 'sequence-view';
}

export function resolveViewerTab(doc: SequenceDocument, requested: ViewerTab): ViewerTab {
  // Blank session: the vector catalog / architect needs no active document, so
  // an explicit request (New Session › Vector Catalog, Vectors toolbar) opens it
  // even though it is not listed as one of the (empty) workspace's own tabs.
  if (!doc.id && requested === 'vector-library') return requested;
  return supportedViewerTabs(doc).includes(requested) ? requested : preferredViewerTab(doc);
}

export function visibleDocumentTabs(doc: SequenceDocument, selected: readonly SequenceDocument[], requested: ViewerTab): ViewerTab[] {
  const relevant = relevantViewerTabs(doc, selected);
  const supported = supportedViewerTabs(doc);
  const visible = VIEWER_TAB_ORDER.filter((tab) => supported.includes(tab) && (relevant.includes(tab) || tab === requested));
  const primary = preferredViewerTab(doc);
  return visible.includes(primary) ? [primary, ...visible.filter((tab) => tab !== primary)] : visible;
}

/** Refuse a mixed selection rather than silently dropping incompatible records. */
function selectedSequenceInputs(activeDoc: SequenceDocument, selected: readonly SequenceDocument[]): SequenceDocument[] {
  const unique = [...new Map(selected.map((doc) => [doc.id, doc])).values()];
  if (!unique.every((doc) => hasBiologicalSequence(doc) && doc.moleculeType === activeDoc.moleculeType)) return [];
  return unique;
}

/** Only actual members, a linked source alignment, or explicit same-type selection. */
/** Marks phylogeny inputs that are rows of a stored alignment (used as-is, never realigned). */
export const ALIGNED_MEMBER_METADATA_KEY = 'Aligned Alignment Row';

/**
 * Whether phylogeny inputs can be used column-by-column without realignment:
 * rows taken from a stored alignment, or equal-length rows that carry gaps.
 * Equal length alone is not evidence of alignment (e.g. ticked amplicons of
 * the same size with indels relative to each other).
 */
export function isPreAlignedInputSet(docs: readonly Pick<SequenceDocument, 'sequence' | 'docMetadata'>[]): boolean {
  if (docs.length < 2) return false;
  const width = docs[0].sequence.length;
  if (!docs.every((d) => d.sequence.length === width)) return false;
  return (
    docs.every((d) => d.docMetadata?.[ALIGNED_MEMBER_METADATA_KEY] !== undefined) ||
    docs.some((d) => d.sequence.includes('-'))
  );
}

export function phylogenySourceDocuments(activeDoc: SequenceDocument, selectedDocuments: readonly SequenceDocument[], projectDocuments: readonly SequenceDocument[]): SequenceDocument[] {
  const sources = activeDoc.alignmentMeta?.sequences ?? (isTreeDocument(activeDoc)
    ? projectDocuments.find((candidate) => activeDoc.history.some((entry) => entry.parentIds.includes(candidate.id)) &&
      (candidate.alignmentMeta?.sequences?.length ?? 0) > 1)?.alignmentMeta?.sequences : undefined);
  if (sources && sources.length > 1) {
    // Rows of a stored alignment are aligned by construction unless the source
    // explicitly says otherwise (its alignment metadata sets isAligned to false).
    const sourceDoc = activeDoc.alignmentMeta?.sequences ? activeDoc : undefined;
    const rowsAreAligned = sourceDoc?.alignmentMeta?.isAligned !== false;
    return sources.filter((member) => member.sequence.length > 0).map((member) => ({
      ...activeDoc, id: member.id, name: member.name, sequence: member.sequence,
      accession: member.accession ?? '', description: member.description ?? '',
      features: member.features ?? [], primers: [], chromatogram: undefined,
      documentKind: activeDoc.moleculeType === 'Protein' ? 'protein' : 'linear-dna',
      alignmentMeta: undefined,
      docMetadata: rowsAreAligned ? { [ALIGNED_MEMBER_METADATA_KEY]: 1 } : undefined,
    }));
  }
  const selected = selectedSequenceInputs(activeDoc, selectedDocuments);
  return selected.length > 1 ? selected : [];
}

/** Preserve source text for non-sequence documents; never synthesize a GenBank record for them. */
export function originalDocumentText(doc: SequenceDocument): { label: string; extension: string; text: string } | null {
  if (doc.docMetadata?.['Document Type'] === 'Text Document') {
    return { label: 'Document notes', extension: 'txt', text: String(doc.docMetadata?.Notes ?? '') };
  }
  if (isTreeDocument(doc)) return { label: 'Newick tree', extension: 'nwk', text: String(doc.docMetadata?.Newick ?? '') };
  if (doc.docMetadata?.PDBText) return { label: String(doc.docMetadata['Source Format'] ?? 'PDB'),
    extension: doc.docMetadata['Source Format'] === 'mmCIF' ? 'cif' : 'pdb', text: String(doc.docMetadata.PDBText) };
  return null;
}
