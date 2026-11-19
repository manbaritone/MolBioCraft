// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';
import { isContigSummaryRecord } from './contigSummary';
import { STUDIO_ENTRIES, VIEWER_TAB_ORDER, studioAvailability, studioForTab, type StudioAvailability, type StudioEntry } from './studioRegistry';
import type { GenomicsSubTabId } from './analysisContext';

export type ViewerTab =
  | 'sequence-view' | 'annotations-table' | 'text-view' | 'vector-library'
  | 'cloning-gel' | 'primers-pcr' | 'sequence-alignment' | 'phylogenetics'
  | 'sanger-contig' | 'protein-3d' | 'genomics-ngs' | 'history-hybrid' | 'guided-pipelines'
  | 'document-info';

// The viewer tabs in rail order, and the names they show, come from the studio registry
// (US-01M6Q16Q, D0237): each studio's tab, then History, then Info. Re-exported so that nothing
// here reads the registry while this module loads (the two modules import each other). The
// status messages, the redirect and the error boundary name a tab by viewerTabLabel.
export { VIEWER_TAB_ORDER };

/**
 * The viewer header's label for a tab, which also names a studio tab's inspector (D0208): the name
 * of the studio or panel the tab belongs to, from the studio registry - one name per studio,
 * whatever the record (D0237). The Protein studio has its own tab, protein-3d, and genomics-ngs
 * belongs to Pipelines & NGS in every view (US-01M6Q164).
 */
export function viewerTabLabel(tab: ViewerTab, doc?: SequenceDocument, view?: GenomicsSubTabId): string {
  return studioForTab(tab, doc, view).name;
}

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
  if (doc.docMetadata?.['Document Type'] === 'Enzyme Set') return ['cloning-gel', 'history-hybrid', 'document-info'];
  if (isTreeDocument(doc)) return ['phylogenetics', 'text-view', 'history-hybrid', 'document-info',
    ...((doc.alignmentMeta?.sequences?.length ?? 0) > 1 ? ['sequence-alignment' as const] : [])];
  // Annotation-only genome summaries: a genome-scale map, the annotation table, the flat-file
  // header (a summary has no ORIGIN block), the provenance trail and record info.
  if (isContigSummaryRecord(doc)) return ['sequence-view', 'annotations-table', 'text-view', 'history-hybrid', 'document-info'];
  if (!hasBiologicalSequence(doc)) return ['document-info'];
  // The Protein studio takes every biological sequence (a DNA or RNA one through its CDS); the
  // genomics tab's NGS and genome views are not offered for a protein (US-01M6Q164).
  const tabs: ViewerTab[] = ['sequence-view', 'annotations-table', 'text-view',
    'sequence-alignment', 'phylogenetics', 'protein-3d', 'history-hybrid', 'guided-pipelines', 'document-info'];
  if (doc.moleculeType !== 'Protein') tabs.push('genomics-ngs');
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
  if (doc.docMetadata?.PDBText || doc.docMetadata?.['PDB name']) tabs.add('protein-3d');
  return VIEWER_TAB_ORDER.filter((tab) => tabs.has(tab) && supported.includes(tab));
}

export function preferredViewerTab(doc: SequenceDocument): ViewerTab {
  if (doc.docMetadata?.['Document Type'] === 'Text Document') return 'text-view';
  // D0220: an Enzyme Set opens Cloning & Gel on its Enzymes view (US-01M7QC8Q).
  if (doc.docMetadata?.['Document Type'] === 'Enzyme Set') return 'cloning-gel';
  if (isTreeDocument(doc)) return 'phylogenetics';
  if (isContigSummaryRecord(doc)) return 'sequence-view';
  if (!hasBiologicalSequence(doc)) return 'document-info';
  if (doc.moleculeType === 'DNA' && (doc.chromatogram || doc.documentKind === 'trace')) return 'sanger-contig';
  if (doc.documentKind === 'alignment' || doc.documentKind === 'contig' ||
      (doc.alignmentMeta?.sequences?.length ?? 0) > 1) return 'sequence-alignment';
  if (doc.docMetadata?.PDBText) return 'protein-3d';
  return 'sequence-view';
}

export function resolveViewerTab(doc: SequenceDocument, requested: ViewerTab): ViewerTab {
  // Blank session: the vector catalog / architect needs no active document, so
  // an explicit request (New Session › Vector Catalog, Vectors toolbar) opens it
  // even though it is not listed as one of the (empty) workspace's own tabs.
  if (!doc.id && requested === 'vector-library') return requested;
  // A protein's older home was genomics-ngs: a session saved there opens the Protein studio (US-01M6Q164 delta row 7).
  if (requested === 'genomics-ngs' && doc.moleculeType === 'Protein' && supportedViewerTabs(doc).includes('protein-3d')) return 'protein-3d';
  return supportedViewerTabs(doc).includes(requested) ? requested : preferredViewerTab(doc);
}

/** One entry of the studio rail: a studio or panel, whether it applies to the document, and whether it is the one showing. */
export interface StudioRailItem { readonly entry: StudioEntry; readonly availability: StudioAvailability; readonly current: boolean }

/**
 * The studio rail's entries (US-01M6Q1BD, D0015): every studio, then History and Info, in registry
 * order, whatever the document - a studio is never dropped, only disabled with its registry reason.
 * The current entry is the one studio resolved from (tab, doc, view) (D0239, D0241). A blank session
 * shows Info and offers the vector catalogue (resolveViewerTab opens it with no document); every
 * other entry says to open or add a document first.
 */
export function studioRailItems(doc: SequenceDocument, tab: ViewerTab, view?: GenomicsSubTabId): StudioRailItem[] {
  const shown = studioForTab(tab, doc, view).id;
  return STUDIO_ENTRIES.map((entry) => {
    const current = entry.id === shown;
    const availability: StudioAvailability = current || (!doc.id && entry.opens.tab === 'vector-library') ? { ok: true }
      : !doc.id ? { ok: false, reason: `Open or add a document first: ${entry.name} needs ${entry.needs}.` }
      : studioAvailability(entry, doc);
    return { entry, availability, current };
  });
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

/** The history operation that pairs an imported tree with an alignment of its taxa (US-01M6P2EZ). */
export const PAIR_ALIGNMENT_OPERATION = 'Pair Alignment';

/**
 * The document a tree's rows come from, read from its history from the latest entry back: the
 * first entry whose parentIds name one of `liveDocuments` with at least two alignment rows decides,
 * so a later pairing wins over an earlier one and an 'Edit Tree' entry (which names the tree
 * itself) is passed over. A 'Pair Alignment' entry whose alignment does not give two rows ends the
 * walk, so an older pairing is not used in its place: the tree has no rows, and either `fewRows`
 * is the alignment (among `liveDocuments`, with fewer than two rows; BG-01M7RNMJ) or `missingId`
 * names it (in the trash or erased).
 */
export function treeSourceAlignment(tree: SequenceDocument, liveDocuments: readonly SequenceDocument[]): { doc: SequenceDocument | null; missingId: string | null; fewRows: SequenceDocument | null } {
  for (let i = tree.history.length - 1; i >= 0; i--) {
    const entry = tree.history[i];
    const doc = liveDocuments.find((candidate) => entry.parentIds.includes(candidate.id) && (candidate.alignmentMeta?.sequences?.length ?? 0) > 1);
    if (doc) return { doc, missingId: null, fewRows: null };
    if (entry.operation === PAIR_ALIGNMENT_OPERATION) {
      const pairedId = entry.parentIds[0] ?? null;
      const fewRows = liveDocuments.find((candidate) => candidate.id === pairedId) ?? null;
      return { doc: null, missingId: fewRows ? null : pairedId, fewRows };
    }
  }
  return { doc: null, missingId: null, fewRows: null };
}

export function phylogenySourceDocuments(activeDoc: SequenceDocument, selectedDocuments: readonly SequenceDocument[], projectDocuments: readonly SequenceDocument[]): SequenceDocument[] {
  const sources = activeDoc.alignmentMeta?.sequences ?? (isTreeDocument(activeDoc)
    ? treeSourceAlignment(activeDoc, projectDocuments).doc?.alignmentMeta?.sequences : undefined);
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
