// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';

/** Internal rendering context only; never inserted into a project's documents. */
export const EMPTY_WORKSPACE_DOCUMENT: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '',
  moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '', updatedAt: '', features: [], primers: [], history: [],
};

/** Retire only the untouched automatic starter; keep user-edited constructs. */
export function removeUntouchedLegacyStarter(documents: SequenceDocument[]): SequenceDocument[] {
  return documents.filter((doc) => !(
    doc.id === 'doc-blank-starter' && doc.name === 'Untitled_Construct' &&
    doc.accession === 'MBC_NEW_001' &&
    doc.description === 'Blank starter DNA construct (45 bp standard polylinker MCS). Paste or create your sequence via New Session.' &&
    doc.sequence === 'GAATTCGCGGCCGCTTCTAGAGGTACCGGATCCAAGCTTCTCGAG' &&
    doc.moleculeType === 'DNA' && doc.topology === 'linear' && doc.folder === 'Local' &&
    doc.createdAt === doc.updatedAt && doc.primers.length === 0 &&
    doc.features.length === 1 && doc.features[0].id === 'feat-blank-mcs' &&
    doc.features[0].name === 'Starter MCS Polylinker' &&
    doc.features[0].type === 'misc_feature' && doc.features[0].start === 1 &&
    doc.features[0].end === doc.sequence.length && doc.features[0].strand === 1 &&
    doc.features[0].color === '#1a73e8' &&
    doc.features[0].notes === 'EcoRI - NotI - XbaI - KpnI - BamHI - HindIII - XhoI polylinker' &&
    doc.history.length === 1 && doc.history[0].id === 'hist-blank-init' &&
    doc.history[0].operation === 'Initialized Blank Session' &&
    doc.history[0].description === 'Created blank starter sequence construct for new session.' &&
    doc.history[0].parentIds.length === 0 && doc.history[0].lengthBp === doc.sequence.length &&
    doc.history[0].topology === 'linear' &&
    !doc.chromatogram && !doc.alignmentMeta && !doc.docMetadata
  ));
}
