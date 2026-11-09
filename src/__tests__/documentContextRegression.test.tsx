import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { relevantViewerTabs, preferredViewerTab, supportedViewerTabs, resolveViewerTab, visibleDocumentTabs, phylogenySourceDocuments, originalDocumentText } from '../core/documentViews';
import { DocumentInfoPanel } from '../components/DocumentInfoPanel';
import { ChromatogramAndContigStudio } from '../components/ChromatogramAndContigStudio';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import { parseMbcWorkbench, serializeMbcWorkbench, type MbcWorkbenchSnapshot } from '../core/mbcSessionFormat';
import * as bio from '../core/bioEngine';
import * as rust from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

const dna: SequenceDocument = { ...EMPTY_WORKSPACE_DOCUMENT, id: 'dna', name: 'DNA reference', sequence: 'ACGTACGT', folder: 'Local' };
const protein: SequenceDocument = { ...dna, id: 'protein', name: 'Protein', moleculeType: 'Protein', sequence: 'MALWMRLL' };
afterEach(() => vi.restoreAllMocks());

describe('document context follows actual input data', () => {
  it.each(['Tree Documents', 'Contig Assembly', 'Alignments', 'Genomes/Human', 'Primers'])('does not turn a protein moved into %s into a different record', (folder) => {
    const doc = { ...protein, folder };
    expect(preferredViewerTab(doc)).toBe('sequence-view');
    expect(relevantViewerTabs(doc)).toEqual(['sequence-view', 'annotations-table', 'text-view', 'history-hybrid', 'document-info']);
    expect(supportedViewerTabs(doc)).not.toContain('primers-pcr');
    expect(resolveViewerTab(doc, 'cloning-gel')).toBe('sequence-view');
  });

  it('keeps tools available on request without adding them to every DNA record', () => {
    expect(relevantViewerTabs(dna)).not.toContain('cloning-gel');
    expect(visibleDocumentTabs(dna, [dna], 'cloning-gel')).toContain('cloning-gel');
    expect(visibleDocumentTabs(protein, [protein], 'cloning-gel')).not.toContain('cloning-gel');
    expect(supportedViewerTabs(EMPTY_WORKSPACE_DOCUMENT)).toEqual([]);
    // Regression: New Session › Vector Catalog in a blank session used to fall
    // back to Document Info, so the catalog never opened.
    expect(resolveViewerTab(EMPTY_WORKSPACE_DOCUMENT, 'vector-library')).toBe('vector-library');
    expect(resolveViewerTab(EMPTY_WORKSPACE_DOCUMENT, 'cloning-gel')).not.toBe('cloning-gel');
  });

  it('uses stored members and rejects heterogeneous selections instead of silently dropping records', () => {
    const second = { ...dna, id: 'second' };
    expect(phylogenySourceDocuments(dna, [dna, second, protein], [dna, second, protein])).toEqual([]);
    expect(phylogenySourceDocuments(dna, [dna, dna], [dna])).toEqual([]);
    const alignment = { ...dna, documentKind: 'alignment' as const, alignmentMeta: { sequences: [
      { id: 'member1', name: 'First', sequence: 'ACGT' }, { id: 'member2', name: 'Second', sequence: 'ACGA' },
    ] } };
    expect(phylogenySourceDocuments(alignment, [protein], [protein]).map((doc) => doc.id)).toEqual(['member1', 'member2']);
    expect(visibleDocumentTabs(alignment, [], 'sequence-alignment')[0]).toBe('sequence-alignment');
  });

  it('keeps tree topology and notes as source text rather than synthesizing biological flatfiles', () => {
    const tree = { ...dna, sequence: '', documentKind: 'tree' as const, docMetadata: { Newick: '(A:1,B:2);' } };
    expect(originalDocumentText(tree)?.text).toBe('(A:1,B:2);');
    expect(resolveViewerTab(tree, 'primers-pcr')).toBe('phylogenetics');
    const notes = { ...dna, docMetadata: { 'Document Type': 'Text Document', Notes: 'Observed sample' } };
    expect(originalDocumentText(notes)?.text).toBe('Observed sample');
    expect(preferredViewerTab(notes)).toBe('text-view');
    expect(supportedViewerTabs(notes)).not.toContain('sequence-view');
  });

  it('renders real metadata and molecule units without DNA topology or fabricated values for proteins', () => {
    const html = renderToStaticMarkup(<DocumentInfoPanel doc={{ ...protein, docMetadata: { Organism: 'Test species' } }} onUpdateDocument={() => {}} />);
    expect(html).toContain('8 aa'); expect(html).toContain('Test species');
    expect(html).not.toContain('<dt>Topology</dt>'); expect(html).not.toContain('bp');
  });

  it('opens the active Sanger read without auto-mapping or assembling unrelated project records', () => {
    const mapping = vi.spyOn(bio, 'mapReadAndCallVariants');
    const assembly = vi.spyOn(rust, 'assembleSangerContigPoaRust');
    const read = { ...dna, id: 'active-read', name: 'Selected read', documentKind: 'trace' as const };
    const html = renderToStaticMarkup(<ChromatogramAndContigStudio documents={[dna, protein, read]} activeDoc={read} selectedDocuments={[read]} />);
    expect(html).toContain('value="active-read" selected=""');
    expect(html).not.toContain('value="protein"');
    expect(mapping).not.toHaveBeenCalled(); expect(assembly).not.toHaveBeenCalled();
    expect(html).toContain('No reference comparison has been run');
    expect(() => renderToStaticMarkup(<ChromatogramAndContigStudio documents={[]} />)).not.toThrow();
  });

  it('preserves the Info tab through a real Rust session round trip', () => {
    const snapshot = { sessionName: 'Context', documents: [dna], workspace: {
      activeDocId: dna.id, viewerTab: 'document-info', selectedFolder: 'All Project Files', navHistory: [dna.id], navIndex: 0,
      mapLayoutMode: 'linear', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
      darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
      displaySettings: { showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: false,
        showTranslation: false, showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false },
    } } as MbcWorkbenchSnapshot;
    expect(parseMbcWorkbench(serializeMbcWorkbench(snapshot)).envelope.workspace.viewerTab).toBe('document-info');
  });
});
