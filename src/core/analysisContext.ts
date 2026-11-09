// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';

export type GenomicsSubTabId =
  | 'ngs-assembly' | 'genome-variants' | 'genes-cpg-repeats'
  | 'protein-3d' | 'transform-submit';
export type HybridSubTabId =
  | 'protein' | 'secondary-structure' | 'enzymes-view' | 'lineage' | 'workflows';

export function genomicsTabsForDocument(doc: SequenceDocument): GenomicsSubTabId[] {
  if (doc.moleculeType === 'Protein') return ['protein-3d'];
  return ['ngs-assembly', 'genome-variants', 'genes-cpg-repeats', 'protein-3d', 'transform-submit'];
}

export function hybridTabsForDocument(doc: SequenceDocument): HybridSubTabId[] {
  if (doc.docMetadata?.['Document Type'] === 'Enzyme Set') return ['enzymes-view', 'lineage'];
  if (doc.documentKind === 'tree') return ['lineage', 'workflows'];
  if (doc.moleculeType === 'Protein') return ['protein', 'lineage', 'workflows'];
  if (doc.moleculeType === 'RNA') return ['protein', 'secondary-structure', 'lineage', 'workflows'];
  return ['protein', 'secondary-structure', 'enzymes-view', 'lineage', 'workflows'];
}

export function defaultHybridSubTab(doc: SequenceDocument): HybridSubTabId {
  if (doc.docMetadata?.['Document Type'] === 'Enzyme Set') return 'enzymes-view';
  return doc.moleculeType === 'Protein' ? 'protein' : 'lineage';
}
