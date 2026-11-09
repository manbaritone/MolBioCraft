// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6XPWT: a restored alignment opens in its molecule type's default colour scheme (Zappo for a
 * protein, ACGT - Default for a nucleotide), read in the real App.
 *
 * The scheme a document opens in comes from defaultColorScheme twice in AlignmentAndPhyloStudio.tsx:
 * the colour scheme state's initial value, and the open-document effect on activeDoc.id, which runs
 * after the first render and overrides it. Server-side rendering never runs that effect, so every
 * check here mounts the App over the live DOM (the appHarness.tsx harness), restores a session
 * through File > Restore Autosave on the Alignment tab, and reads the studio's Colors select.
 * mountApp refuses a test file that has already loaded React DOM, so this file imports nothing but
 * the harness, and types.
 *
 * App mounts the studio keyed by the open document's id, so each document gets a fresh studio whose
 * initial state already holds the default: an effect that set no scheme at all would leave that
 * default in place, and no check here can tell it apart. What these checks fail is an effect that
 * sets any scheme other than defaultColorScheme's.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

// Each check launches the App afresh.
vi.setConfig({ testTimeout: 60_000 });

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Documents built in the test ───

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Alignments',
  createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z', features: [], primers: [], history: [],
};

const alignment = (id: string, moleculeType: SequenceDocument['moleculeType'], members: string[]): SequenceDocument => ({
  ...BLANK, id, name: `${id} alignment`, accession: id.toUpperCase(), description: 'An alignment built in the test',
  sequence: members[0], moleculeType, documentKind: 'alignment',
  alignmentMeta: { isAligned: true, sequences: members.map((sequence, i) => ({ id: `${id}-${i + 1}`, name: `${id} member ${i + 1}`, sequence })) },
}) as SequenceDocument;

/** A protein alignment carrying every residue Zappo groups. */
const PROTEIN = alignment('xpwt-protein', 'Protein', [
  'MKDERHSTNQILVAFWYPGCKDERHSTNQILVAF',
  'MKDERHSTNQILVAFWYPGCKDEKHSTNQILVAF',
  'MKDERHSTNQLLVAFWYPGCRDERHSTNQILVAF',
]);
/** A nucleotide alignment, so a check can tell a fixed scheme from the molecule type's default. */
const DNA = alignment('xpwt-dna', 'DNA', [
  'ATGGCTAGCAAGGAGGAACTGTTCACCGGCGTGGTG',
  'ATGGCTAGCAAGGAGGAACTGTTTACCGGCGTGGTG',
  'ATGGCAAGCAAGGAGGAACTGTTCACCGGTGTGGTG',
]);

// ─── Reading the App ───

/** The studio's Colors select: the one select in the page offering a colour scheme of either molecule type. */
function colorsSelect(app: AppHarness): LiveElement {
  const found = app.all('select').filter((s) => s.querySelectorAll('option').some((o) => ['Zappo', 'ACGT - Default'].includes(o.getAttribute('value') ?? '')));
  expect(found, 'one Colors select in the alignment studio').toHaveLength(1);
  return found[0];
}
const shownScheme = (app: AppHarness) => (colorsSelect(app) as unknown as { value: string }).value;
const offered = (app: AppHarness) => colorsSelect(app).querySelectorAll('option').map((o) => o.getAttribute('value'));

describe('BG-01M6XPWT: a restored alignment opens in its molecule type\'s default scheme, in the live App', () => {
  it('a restored protein alignment opens with Zappo selected', async () => {
    // Wrong implementations this fails: the open-document effect giving a protein any scheme it is
    // offered but Zappo (Clustal, Hydrophobicity, Similarity ...) instead of defaultColorScheme(true),
    // and defaultColorScheme naming anything but Zappo for a protein. A scheme a protein is not
    // offered is replaced by the studio's validity guard, so it is not a scheme the user can see.
    await withApp(async (app) => {
      await app.restoreSession({ documents: [PROTEIN], activeDocId: PROTEIN.id, viewerTab: 'sequence-alignment' });
      expect(offered(app), 'the select offers the protein schemes').toContain('Clustal');
      expect(shownScheme(app), 'the Colors select shows Zappo').toBe('Zappo');
    });
  });

  it('a restored nucleotide alignment opens with ACGT - Default selected', async () => {
    // Wrong implementations this fails: the open-document effect giving every document one fixed
    // scheme both molecule types are offered (Similarity, By Direction ...), which the protein check
    // alone cannot tell from Zappo's default when that fixed scheme is a protein-only one.
    await withApp(async (app) => {
      await app.restoreSession({ documents: [DNA], activeDocId: DNA.id, viewerTab: 'sequence-alignment' });
      expect(offered(app), 'the select offers the nucleotide schemes').toContain('MacClade');
      expect(shownScheme(app), 'the Colors select shows ACGT - Default').toBe('ACGT - Default');
    });
  });

  it('a scheme picked for one document does not carry to the protein alignment opened next', async () => {
    // Wrong implementations this fails: the scheme the user picked for the document open before
    // carried to the next one (as it would be if App stopped keying the studio by document and the
    // open-document effect then set no scheme), and the effect giving the protein opened next any
    // scheme but Zappo. The pick is read back first, so a select that never reached the studio
    // cannot pass.
    await withApp(async (app) => {
      await app.restoreSession({ documents: [PROTEIN, DNA], activeDocId: DNA.id, viewerTab: 'sequence-alignment' });
      await app.change(colorsSelect(app), 'Similarity');
      expect(shownScheme(app), 'the pick reached the studio').toBe('Similarity');
      await app.restoreSession({ documents: [PROTEIN, DNA], activeDocId: PROTEIN.id, viewerTab: 'sequence-alignment' });
      expect(shownScheme(app), 'the protein alignment opened next shows Zappo').toBe('Zappo');
    });
  });
});
