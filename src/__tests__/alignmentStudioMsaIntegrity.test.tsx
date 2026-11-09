// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  contigFolderShowsSingleRead,
  effectiveTextViewFormat,
  formatPairwiseIdentityPct,
  meanPairwiseIdentity,
  parseRootCalibrationMya,
  resolveMsaMenuCommand,
} from '../core/alignmentViewModel';
import { AlignmentCanvas, type AlignmentCanvasSettings } from '../components/AlignmentCanvas';
import { AlignmentTextStream, SequenceAlignmentStudio } from '../components/AlignmentAndPhyloStudio';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

const base: SequenceDocument = { ...EMPTY_WORKSPACE_DOCUMENT, id: 'a', name: 'Read A', sequence: 'ACGTACGTAA', folder: 'Local' };

describe('contig folder selection shows the MSA of all selected reads', () => {
  it('only collapses to a single read when it is the sole input', () => {
    expect(contigFolderShowsSingleRead(true, ['a'])).toBe(true);
    expect(contigFolderShowsSingleRead(true, ['a', 'a'])).toBe(true);
    expect(contigFolderShowsSingleRead(true, ['a', 'b'])).toBe(false);
    expect(contigFolderShowsSingleRead(false, ['a'])).toBe(false);
  });

  it('renders every selected Contig Assembly read in the alignment', () => {
    const r1 = { ...base, id: 'r1', name: 'ReadOneFwd', folder: 'Contig Assembly' };
    const r2 = { ...base, id: 'r2', name: 'ReadTwoRev', sequence: 'ACGTACGTTA', folder: 'Contig Assembly' };
    const html = renderToStaticMarkup(<SequenceAlignmentStudio documents={[r1, r2]} activeDoc={r1} />);
    expect(html).toContain('ReadOneFwd');
    expect(html).toContain('ReadTwoRev');
  });
});

describe('alignment menu MSA preset commands', () => {
  const common = { subMode: 'msa', docId: 'list', hasEmbeddedMembers: true, consumed: null };
  it('runs the alignment on an unaligned list', () => {
    const r = resolveMsaMenuCommand({ ...common, commandNonce: 3, isAligned: false });
    expect(r.action).toBe('run-on-list');
    expect(r.consumed).toEqual({ nonce: 3, docId: 'list' });
    // StrictMode re-run of the same command on the same document stays a run.
    expect(resolveMsaMenuCommand({ ...common, commandNonce: 3, isAligned: false, consumed: r.consumed }).action)
      .toBe('run-on-list');
  });
  it('reports stored alignments instead of silently ignoring the preset', () => {
    expect(resolveMsaMenuCommand({ ...common, commandNonce: 1, isAligned: true }).action).toBe('stored-alignment');
    expect(resolveMsaMenuCommand({ ...common, commandNonce: 1, isAligned: undefined }).action).toBe('stored-alignment');
  });
  it('does nothing without a command, outside MSA mode, or for a stale nonce on another document', () => {
    expect(resolveMsaMenuCommand({ ...common, commandNonce: 0, isAligned: false }).action).toBe('none');
    expect(resolveMsaMenuCommand({ ...common, subMode: 'pairwise', commandNonce: 2, isAligned: false }).action).toBe('none');
    expect(resolveMsaMenuCommand({
      ...common, commandNonce: 2, isAligned: false, consumed: { nonce: 2, docId: 'other' },
    }).action).toBe('none');
  });
});

describe('unaligned lists are not reported as alignments', () => {
  const unalignedList: SequenceDocument = {
    ...base,
    id: 'list',
    name: 'Unaligned list',
    alignmentMeta: {
      isAligned: false,
      sequences: [
        { id: 'm1', name: 'MemberOne', sequence: 'ACGTACGTACGT' },
        { id: 'm2', name: 'MemberTwo', sequence: 'TTGCA' },
      ],
    } as SequenceDocument['alignmentMeta'],
  };

  it('labels the distance matrix "align first" instead of computing it on padded sequences', () => {
    const html = renderToStaticMarkup(
      <SequenceAlignmentStudio documents={[unalignedList]} activeDoc={unalignedList} initialInspectorTab="distances" />
    );
    expect(html).toContain('Align first');
    expect(html).not.toContain('mbc-aln-matrix-table');
  });

  it('exports the original unpadded sequences and offers no alignment layouts', () => {
    expect(effectiveTextViewFormat('Clustal', true)).toBe('FASTA');
    expect(effectiveTextViewFormat('Custom', true)).toBe('FASTA');
    expect(effectiveTextViewFormat('GenBank', true)).toBe('GenBank');
    expect(effectiveTextViewFormat('PHYLIP', false)).toBe('PHYLIP');
    // The alignment text stream (shown on the Flatfile tab of alignment documents).
    const html = renderToStaticMarkup(<AlignmentTextStream doc={unalignedList} />);
    expect(html).toContain('&gt;MemberTwo\nTTGCA');
    expect(html).not.toContain('TTGCA-------');
    expect(html).toContain('Clustal (align first)');
  });
});

describe('alignment canvas highlighting of rows identical to the reference', () => {
  const settings: AlignmentCanvasSettings = {
    colorScheme: 'ACGT - Default', isProtein: false, showLetters: true, showConsensus: false, consensusLabel: 'Consensus',
    showHighlighting: true, highlightMode: 'All Disagreements', highlightRef: 'Reference', useDotsForAgreements: true,
    showComplement: false, showTranslation: false, translationFrame: '1', geneticCode: 'Standard',
    threeLetterAminoAcids: false, showAminoAcidNumbering: false, showAnnotations: false,
    hiddenAnnotationTypes: new Set(), annotationFilter: '', annotationLabels: 'None', annotationArrowTips: false,
    annotationHideExcessiveLabels: false, annotationCompress: false, annotationLabelSize: 10, annotationThickness: 8,
    showGraphs: false, graphCoverage: false, coverageLogScale: false, coverageHighlightGapped: false,
    graphIdentity: false, identityWindow: 1, graphGc: false, graphAt: false, gcWindow: 10, graphFramePlot: false,
    graphLogo: false, graphHydrophobicity: false, hydrophobicityWindow: 9, graphPi: false, piWindow: 10,
    restrictionSites: null, highlightDam: false, highlightDcm: false, wrap: false, visibleCols: [0, 1, 2, 3],
    spacesEvery: 0, numbering: 'Standard', miniMap: false, outlineZoomedOut: false, showSequenceIcons: false,
    nameFontSize: 11, numberFontSize: 10, letterFontSize: 12, zoomedOutRowHeight: 8,
  };
  const row = (id: string, alignedSeq: string) => ({ id, label: id, alignedSeq, strand: 1 as const, features: [] });
  const cellText = (html: string) =>
    [...html.matchAll(/class="mbc-aln-cell"[^>]*>([^<]*)</g)].map((m) => m[1]).join('');

  it('dots a row identical to the reference while leaving the reference row itself as letters', () => {
    const html = renderToStaticMarkup(
      <AlignmentCanvas
        rows={[row('ref', 'ACGT'), row('same', 'ACGT'), row('diff', 'ACTT')]}
        consensus="ACGT" conservation={[1, 1, 0.6, 1]} settings={settings} zoomPct={400}
        cursorCol={1} selectedRowIdx={0} onCursorChange={() => {}} onSelectRow={() => {}}
        scrollRequest={null} fitRequestNonce={0} onRequestZoom={() => {}}
      />
    );
    expect(cellText(html)).toBe('ACGT' + '....' + '..T.');
  });
});

describe('P3 honesty fixes', () => {
  it('mean pairwise identity is N/A when no pair overlaps', () => {
    const v = meanPairwiseIdentity(['AC----', '----GT']);
    expect(Number.isNaN(v)).toBe(true);
    expect(formatPairwiseIdentityPct(v)).toContain('N/A');
    expect(formatPairwiseIdentityPct(75)).toBe('75%');
  });
  it('root-age calibration rejects zero, negative and non-numeric ages', () => {
    expect(parseRootCalibrationMya('0')).toBeNull();
    expect(parseRootCalibrationMya('-5')).toBeNull();
    expect(parseRootCalibrationMya('')).toBeNull();
    expect(parseRootCalibrationMya('abc')).toBeNull();
    expect(parseRootCalibrationMya('0.5')).toBe(0.5);
    expect(parseRootCalibrationMya('42.5')).toBe(42.5);
  });
});

describe('nucleotide alignment classification matches the engine', () => {
  it('treats DNA with IUPAC ambiguity codes as nucleotide and proteins as protein', async () => {
    const { isNucleotideAlignmentRows } = await import('../core/alignmentViewModel');
    // Same rows as the engine regression test (25/29 unambiguous bases).
    expect(
      isNucleotideAlignmentRows([
        'ACGTRACGTYACGTWACGTSACGTACGTA',
        'ACGTYACGTRACGTSACGTWACGTACGTA',
      ])
    ).toBe(true);
    expect(isNucleotideAlignmentRows(['MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMF'])).toBe(false);
    expect(isNucleotideAlignmentRows(['----'])).toBe(false);
  });
});
