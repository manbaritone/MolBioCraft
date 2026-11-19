// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The studio registry (US-01M6Q16Q, D0237): the eleven studios and the two document panels, in
 * rail order, each with its one name, its icon, its shortcut digit and the views it owns. Every
 * in-window naming site reads it: the viewer tab strip and the inspector titles (viewerTabLabel,
 * D0208), ⌘K, the header search, the Help panel's view topics, the redirect message and the studio
 * error boundary. Studio ids are their own key space: a session still stores the viewer tab.
 *
 * The registry assigns ⌘1-⌘9 (D0015) as data only; US-01M6Q1CF binds them.
 */

import React from 'react';
import type { SequenceDocument, SequenceDocumentIconKind } from '../types/bio';
import type { GenomicsSubTabId } from './analysisContext';
import { MolBioDocTypeIcon, MolBioMenuGlyph, type MolBioMenuGlyphKind, type MolBioVisualDocKind } from '../components/MolBioIcons';
// A value cycle with documentViews.ts (which derives VIEWER_TAB_ORDER from this list): neither
// module reads the other's values while it loads, only inside functions.
import { hasBiologicalSequence, isTreeDocument, supportedViewerTabs, type ViewerTab } from './documentViews';

export type StudioId =
  | 'sequence-map' | 'annotations' | 'flatfile' | 'cloning-gel' | 'vectors' | 'primers-crispr'
  | 'alignment' | 'phylogenetics' | 'sanger-contig' | 'protein-3d' | 'pipelines-ngs';
export type DocumentPanelId = 'history' | 'info';

/** A key into the existing Precision Duotone set: a menu glyph or a document-type icon. */
export type StudioIcon =
  | { readonly glyph: MolBioMenuGlyphKind }
  | { readonly docKind: SequenceDocumentIconKind; readonly visual: MolBioVisualDocKind };

/** A view of the viewer: a tab, and for genomics-ngs the sub-view shown in it. */
export interface StudioView { readonly tab: ViewerTab; readonly view?: GenomicsSubTabId }

export interface StudioEntry {
  readonly id: StudioId | DocumentPanelId;
  readonly kind: 'studio' | 'panel';
  readonly name: string;
  readonly icon: StudioIcon;
  /** The ⌘-digit (D0015); none for Protein & 3D, Pipelines & NGS and the panels. */
  readonly digit?: number;
  /** The view the studio opens on; its applicability is supportedViewerTabs for this tab. */
  readonly opens: StudioView;
  /** Every view the studio owns. */
  readonly views: readonly StudioView[];
  /** What the studio needs, for the reason given when it does not apply. */
  readonly needs: string;
}

const NGS_VIEWS: readonly GenomicsSubTabId[] = ['ngs-assembly', 'genome-variants', 'genes-cpg-repeats', 'transform-submit'];

const studio = (id: StudioId, name: string, icon: StudioIcon, digit: number | undefined, opens: StudioView, needs: string,
  views: readonly StudioView[] = [opens]): StudioEntry => ({ id, kind: 'studio', name, icon, digit, opens, views, needs });

/** The eleven studios, in rail order (PRODUCT.md's list, D0015). */
export const STUDIOS: readonly StudioEntry[] = [
  studio('sequence-map', 'Sequence Map', { docKind: 'circular-dna', visual: 'circular-plasmid' }, 1, { tab: 'sequence-view' }, 'a sequence'),
  studio('annotations', 'Annotations', { glyph: 'detect-features' }, 2, { tab: 'annotations-table' }, 'a sequence'),
  studio('flatfile', 'Flatfile', { glyph: 'print-pdf' }, 3, { tab: 'text-view' }, 'a sequence, a tree or a text note'),
  studio('cloning-gel', 'Cloning & Gel', { glyph: 'clone-restriction' }, 4, { tab: 'cloning-gel' }, 'a DNA sequence'),
  studio('vectors', 'Vectors & Architect', { glyph: 'clone-parts' }, 5, { tab: 'vector-library' }, 'a DNA sequence'),
  studio('primers-crispr', 'Primers & CRISPR', { glyph: 'primer-design' }, 6, { tab: 'primers-pcr' }, 'a DNA sequence'),
  studio('alignment', 'Alignment', { glyph: 'align-msa' }, 7, { tab: 'sequence-alignment' }, 'a sequence or a set of sequences'),
  studio('phylogenetics', 'Phylogenetics', { glyph: 'tree-cladogram' }, 8, { tab: 'phylogenetics' }, 'a sequence or a tree'),
  studio('sanger-contig', 'Sanger & Contig', { docKind: 'trace', visual: 'sanger-trace' }, 9, { tab: 'sanger-contig' }, 'a Sanger trace'),
  // Interim (US-01M6Q164 gives Protein & 3D a tab of its own): genomics-ngs is shared by sub-view.
  studio('protein-3d', 'Protein & 3D', { docKind: 'protein', visual: 'structure-3d' }, undefined,
    { tab: 'genomics-ngs', view: 'protein-3d' }, 'a protein, DNA or RNA sequence'),
  studio('pipelines-ngs', 'Pipelines & NGS', { glyph: 'workflow-pipeline' }, undefined, { tab: 'guided-pipelines' }, 'a sequence',
    [{ tab: 'guided-pipelines' }, ...NGS_VIEWS.map((view) => ({ tab: 'genomics-ngs' as const, view }))]),
];

/** The two document panels: History and Info (13 tabs = 11 studios + 2 panels). */
export const DOCUMENT_PANELS: readonly StudioEntry[] = [
  { id: 'history', kind: 'panel', name: 'History', icon: { docKind: 'protein', visual: 'protein-seq' }, opens: { tab: 'history-hybrid' },
    views: [{ tab: 'history-hybrid' }], needs: 'a sequence, a tree or an enzyme set' },
  { id: 'info', kind: 'panel', name: 'Info', icon: { glyph: 'text-document' }, opens: { tab: 'document-info' },
    views: [{ tab: 'document-info' }], needs: 'a document' },
];

/** The studios, then the panels. */
export const STUDIO_ENTRIES: readonly StudioEntry[] = [...STUDIOS, ...DOCUMENT_PANELS];

/** The viewer tabs in rail order: each studio's tab once, then History, then Info. */
export const VIEWER_TAB_ORDER: readonly ViewerTab[] = [...new Set(
  [...STUDIOS, ...DOCUMENT_PANELS].flatMap((e) => [e.opens.tab, ...e.views.map((v) => v.tab)]),
)];

/** The studio or panel that owns `tab` (in `view`, for genomics-ngs); undefined for a view nobody owns. */
export function studioForView(tab: ViewerTab, view?: GenomicsSubTabId): StudioEntry | undefined {
  return STUDIO_ENTRIES.find((e) => e.views.some((v) => v.tab === tab && v.view === view));
}

/** The genomics-ngs sub-view a record shows its tab as: a protein or a structure is Protein & 3D, anything else Pipelines & NGS. */
export function genomicsViewForDocument(doc?: SequenceDocument): GenomicsSubTabId {
  if (!doc) return 'protein-3d';
  return doc.moleculeType === 'Protein' || doc.docMetadata?.PDBText || doc.docMetadata?.['PDB name'] ? 'protein-3d' : 'ngs-assembly';
}

/** The studio or panel a tab belongs to for `doc` (genomics-ngs by `view`, or else by the record). */
export function studioForTab(tab: ViewerTab, doc?: SequenceDocument, view?: GenomicsSubTabId): StudioEntry {
  const entry = studioForView(tab, tab === 'genomics-ngs' ? view ?? genomicsViewForDocument(doc) : undefined);
  if (!entry) throw new Error(`the studio registry has no studio for the ${tab} tab`);
  return entry;
}

const isTrace = (doc: SequenceDocument) => Boolean(doc.chromatogram) || doc.documentKind === 'trace';

/** What `doc` is, for a reason: '"p53" is a Protein sequence', '"pUC19" is DNA with no trace'. */
export function describeDocument(doc: SequenceDocument): string {
  if (!doc.id) return 'the session holds no document';
  const name = `"${doc.name}"`;
  const type = doc.docMetadata?.['Document Type'];
  if (type === 'Text Document') return `${name} is a text note`;
  if (type === 'Enzyme Set') return `${name} is an enzyme set`;
  if (isTreeDocument(doc)) return `${name} is a tree`;
  if (!hasBiologicalSequence(doc)) return `${name} holds no sequence`;
  if (doc.moleculeType === 'DNA') return isTrace(doc) ? `${name} is a DNA trace` : `${name} is DNA with no trace`;
  return `${name} is ${doc.moleculeType === 'Protein' ? 'a Protein' : 'an RNA'} sequence`;
}

export type StudioAvailability = { ok: true } | { ok: false; reason: string };

/** Whether `entry` applies to `doc` (supportedViewerTabs for the tab it opens), and if not, why. */
export function studioAvailability(entry: StudioEntry, doc: SequenceDocument): StudioAvailability {
  if (supportedViewerTabs(doc).includes(entry.opens.tab)) return { ok: true };
  return { ok: false, reason: `${entry.name} needs ${entry.needs}: ${describeDocument(doc)}.` };
}

/** Draws a registry icon from the existing multi-tone set (no glyph is drawn or recoloured here). */
export function studioIconElement(icon: StudioIcon, size = 13): React.ReactElement {
  return 'glyph' in icon
    ? React.createElement(MolBioMenuGlyph, { glyph: icon.glyph, size })
    : React.createElement(MolBioDocTypeIcon, { kind: icon.docKind, visualOverride: icon.visual, size });
}
