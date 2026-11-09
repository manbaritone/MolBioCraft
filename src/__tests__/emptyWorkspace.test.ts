// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { EMPTY_WORKSPACE_DOCUMENT, removeUntouchedLegacyStarter } from '../core/emptyWorkspace';
import { parseMbcWorkbench, serializeMbcWorkbench, parseMbcFolderZip, serializeMbcFolderZip, type MbcWorkbenchSnapshot } from '../core/mbcSessionFormat';
import type { SequenceDocument } from '../types/bio';

const legacy: SequenceDocument = {
  ...EMPTY_WORKSPACE_DOCUMENT,
  id: 'doc-blank-starter', name: 'Untitled_Construct', accession: 'MBC_NEW_001',
  description: 'Blank starter DNA construct (45 bp standard polylinker MCS). Paste or create your sequence via New Session.',
  sequence: 'GAATTCGCGGCCGCTTCTAGAGGTACCGGATCCAAGCTTCTCGAG',
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  features: [{ id: 'feat-blank-mcs', name: 'Starter MCS Polylinker', type: 'misc_feature',
    start: 1, end: 44, strand: 1, color: '#1a73e8',
    notes: 'EcoRI - NotI - XbaI - KpnI - BamHI - HindIII - XhoI polylinker' }],
  history: [{ id: 'hist-blank-init', timestamp: '2026-11-01 00:00', operation: 'Initialized Blank Session',
    description: 'Created blank starter sequence construct for new session.', parentIds: [], lengthBp: 44, topology: 'linear' }],
};
legacy.features[0].end = legacy.sequence.length;
legacy.history[0].lengthBp = legacy.sequence.length;

describe('empty projects', () => {
  it('removes the untouched automatic construct while keeping ordinary documents', () => {
    const realDocument = { ...legacy, id: 'user-document' };
    expect(removeUntouchedLegacyStarter([legacy, realDocument])).toEqual([realDocument]);
  });

  it.each([
    { ...legacy, sequence: legacy.sequence + 'A' },
    { ...legacy, name: 'My construct' },
    { ...legacy, updatedAt: '2026-11-01T01:00:00Z' },
    { ...legacy, features: [{ ...legacy.features[0], notes: 'My annotation' }] },
    { ...legacy, docMetadata: { Notes: 'Keep this construct' } },
  ])('preserves an edited legacy construct (%#)', (edited) => {
    expect(removeUntouchedLegacyStarter([edited])).toEqual([edited]);
  });

  it('round-trips a zero-document session without manufacturing a document or history', () => {
    const snapshot: MbcWorkbenchSnapshot = {
      sessionName: 'Empty Project', documents: [],
      workspace: {
        activeDocId: 'stale-id', selectedFolder: 'All Project Files', navHistory: ['stale-id'], navIndex: 5,
        viewerTab: 'sequence-view', mapLayoutMode: 'linear', zoomLevel: 100, textFormat: 'genbank',
        colorScheme: 'standard', darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
        displaySettings: { showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true,
          showTranslation: true, showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false },
      },
    };
    const parsed = parseMbcWorkbench(serializeMbcWorkbench(snapshot));
    expect(parsed.checksumVerified).toBe(true);
    expect(parsed.envelope.documents).toEqual([]);
    expect(parsed.envelope.documentCount).toBe(0);
    expect(parsed.envelope.workspace.activeDocId).toBe('');
    expect(parsed.envelope.workspace.navHistory).toEqual([]);
    expect(parsed.envelope.workspace.navIndex).toBe(0);
    expect(parseMbcFolderZip(serializeMbcFolderZip(snapshot)).envelope.documents).toEqual([]);
    const oldSession = parseMbcWorkbench(serializeMbcWorkbench({ ...snapshot, documents: [legacy] }));
    expect(removeUntouchedLegacyStarter(oldSession.envelope.documents)).toEqual([]);
  });
});
