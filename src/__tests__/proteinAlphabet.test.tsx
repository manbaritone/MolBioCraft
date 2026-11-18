// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6VF2M: the protein figures the app shows are the engine's ProtParam report, which weighs
 * and charges U, O, B, Z, J and X as ExPASy Compute pI/Mw and Biopython do and says so.
 *
 * Every view is read through the mounted App with the real WASM engine:
 * - The Protein tab of a selenoprotein shows the engine's MW, pI and charge with U an acid of
 *   pKa 5.2, the engine's warning about U, and the pK scale it used (D0190); a digest peptide
 *   holding X has no m/z and reads 'n/a'.
 * - The alignment Statistics read pI, charge and MW from the engine, not from an EMBOSS pK set of
 *   the view's own (which gave pI 9.30 and charge 0.97 for MKWVTFISLLFLFSSAYS).
 * - Translation Statistics read the charge from the engine, not from K+R+0.1H-D-E (which gave 1.00).
 * The expected figures are the story's: MKWVTFISLLFLFSSAYS has MW 2140.57 Da, pI 8.34 and charge
 * 0.50 (ExPASy ProtParam), and with U appended MW 2290.61 Da, pI 6.11 and charge -0.49.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const LABEL = "pI and charge: Bjellqvist pK scale (ExPASy ProtParam's), selenocysteine pKa 5.2";
const BASE = 'MKWVTFISLLFLFSSAYS';
const U_SENTENCE =
  '1 selenocysteine (U): weighed as 150.04 Da and charged with a selenol pKa of 5.2; it has no GRAVY, aliphatic or instability value, so those indices leave it out.';

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'Protein', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z', features: [], primers: [], history: [],
};
const protein = (id: string, sequence: string): SequenceDocument => ({ ...BLANK, id, name: id, accession: id, sequence });

// ─── The Protein tab ───

async function onProteinTab(app: AppHarness, doc: SequenceDocument): Promise<LiveElement> {
  await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'history-hybrid' });
  await app.settle();
  const tab = app.canvas().querySelectorAll('button[role="tab"]').filter((b) => b.textContent.trim() === 'Protein Analysis');
  expect(tab, `one Protein sub-tab among ${JSON.stringify(app.all('button[role="tab"]').map((b) => words(b.textContent)))} on ${app.activeTab()}`).toHaveLength(1);
  await app.click(tab[0]);
  await app.settle();
  const cards = app.canvas().querySelectorAll('.studio-card')
    .filter((c) => words(c.querySelectorAll('h3')[0]?.textContent).startsWith('EMBOSS Protein Analysis'));
  expect(cards, 'one protein analysis card').toHaveLength(1);
  return cards[0];
}
/** The value of the card's one KPI box labelled `label`. */
function kpi(card: LiveElement, label: string): string {
  const boxes = card.querySelectorAll('.kpi-box').filter((b) => words(b.querySelectorAll('.kpi-label')[0]?.textContent) === label);
  expect(boxes, `one "${label}" box`).toHaveLength(1);
  return words(boxes[0].querySelectorAll('.kpi-val')[0]?.textContent);
}
/** The sentences of the page's warnings regions named `label`. */
const warningsNamed = (app: AppHarness, label: string) =>
  app.all('[data-mbc-result-warnings]').filter((r) => r.getAttribute('aria-label') === label)
    .map((r) => r.querySelectorAll('p').map((p) => words(p.textContent)));
const notes = (el: LiveElement) => el.querySelectorAll('p.mbc-summary-note').map((p) => words(p.textContent));

describe('the protein views read the engine (US-01M6VF2M)', () => {
  it('US-01M6VF2M AC5 shows a selenoprotein weighed and charged by the engine, its warning and its pK scale', async () => {
    const app = await mountApp();
    try {
      const card = await onProteinTab(app, protein('sec_protein', `${BASE}U`));
      expect(kpi(card, 'Molecular Weight')).toBe('2.29 kDa (19 aa)');
      expect(kpi(card, 'Isoelectric Point (pI)')).toBe('pH 6.11');
      expect(kpi(card, 'Charge at pH 7')).toBe('-0.49');
      expect(warningsNamed(app, 'Protein analysis warnings')).toEqual([[U_SENTENCE]]);
      // The label sits in the card the KPI boxes are in, right above them.
      expect(notes(card)).toContain(LABEL);
      const kids = card.children;
      const at = kids.findIndex((k) => k.tagName.toLowerCase() === 'p' && words(k.textContent) === LABEL);
      expect(kids[at + 1]?.getAttribute('class'), 'the label is beside the KPI grid').toBe('thermo-kpi-grid');

      const plain = await onProteinTab(app, protein('plain_protein', BASE));
      expect(kpi(plain, 'Molecular Weight')).toBe('2.14 kDa (18 aa)');
      expect(kpi(plain, 'Isoelectric Point (pI)')).toBe('pH 8.34');
      expect(warningsNamed(app, 'Protein analysis warnings'), 'no warnings list for the 20 standard residues').toEqual([]);
      expect(notes(plain)).toContain(LABEL);

      await onProteinTab(app, protein('x_digest', 'GGGGGGXKGGGGGGIK'));
      const mz = (peptide: string) => {
        const rows = app.canvas().querySelectorAll('tr').filter((r) => {
          const cells = r.querySelectorAll('td');
          return cells.length === 5 && words(cells[1].textContent) === peptide;
        });
        expect(rows, `one digest row for ${peptide}`).toHaveLength(1);
        return words(rows[0].querySelectorAll('td')[3].textContent);
      };
      expect(mz('GGGGGGXK'), 'X has no single composition, so no m/z').toBe('n/a');
      expect(mz('GGGGGGIK')).toMatch(/^\d+\.\d{3}$/);
      expect(warningsNamed(app, 'Digest warnings').flat()).toContain(
        'Peptide GGGGGGXK holds X, which has no single elemental composition: its monoisotopic mass and m/z are not given.',
      );
    } finally {
      app.unmount();
    }
  });

  it('US-01M6VF2M AC6 reads the alignment Statistics pI, charge and weight from the engine, with its pK scale', async () => {
    const app = await mountApp();
    try {
      const aln = {
        ...BLANK, id: 'vf2m-aln', name: 'VF2M Protein Alignment', accession: 'VF2M_0001', folder: 'Alignments', sequence: BASE,
        documentKind: 'alignment',
        alignmentMeta: { isAligned: true, sequences: [{ id: 'vf2m-a', name: 'Row A', sequence: BASE }, { id: 'vf2m-b', name: 'Row B', sequence: BASE }] },
      } as SequenceDocument;
      await app.restoreSession({ documents: [aln], activeDocId: aln.id, viewerTab: 'sequence-alignment' });
      await app.settle();
      const rail = app.all('button.mbc-aln-rail-btn[aria-label="Statistics"]');
      expect(rail, 'one Statistics rail button').toHaveLength(1);
      await app.click(rail[0]);
      await app.settle();
      const boxes = app.all('.mbc-aln-group-box').filter((b) => words(b.querySelectorAll('strong')[0]?.textContent) === 'Protein Statistics');
      expect(boxes, 'one Protein Statistics box').toHaveLength(1);
      const kv = Object.fromEntries(boxes[0].querySelectorAll('.mbc-aln-stat-kv').map((row) => [
        words(row.querySelectorAll('span')[0]?.textContent), words(row.querySelectorAll('strong')[0]?.textContent),
      ]));
      expect(kv['Isoelectric Point:'], 'the engine pI, not the EMBOSS 9.30').toBe('8.34');
      expect(kv['Charge at pH 7:'], 'the engine charge, not 0.97').toBe('0.50');
      expect(kv['Molecular Weight:']).toBe('2.14 kDa');
      expect(notes(boxes[0])).toContain(LABEL);
    } finally {
      app.unmount();
    }
  });

  it('US-01M6VF2M AC7 reads the Translation Statistics charge from the engine, with its pK scale', async () => {
    const app = await mountApp();
    try {
      const cds = 'ATGAAATGGGTTACCTTTATTTCTCTGCTGTTTCTGTTTAGCAGCGCGTATAGCTAA';
      const sequence = `${cds}GGATCCAAGCTTGAATTC`;
      const dna: SequenceDocument = {
        ...BLANK, id: 'vf2m-dna', name: 'VF2M_CDS', accession: 'VF2M_0002', moleculeType: 'DNA', folder: 'Genomes/Bacteria', sequence,
        features: [{ id: 'vf2m-cds', name: 'VF2M', type: 'CDS', start: 1, end: cds.length, strand: 1, color: '#d93025' }],
      };
      await app.restoreSession({ documents: [dna], activeDocId: dna.id, viewerTab: 'sequence-view' });
      await app.settle();
      const panels = app.all('details').filter((d) => words(d.querySelectorAll('summary')[0]?.textContent).startsWith('Translation Statistics'));
      expect(panels.length, 'the App shows Translation Statistics').toBeGreaterThan(0);
      for (const panel of panels) {
        const kv = Object.fromEntries(panel.querySelectorAll('.stat-kv').map((row) => [
          words(row.querySelectorAll('span')[0]?.textContent), words(row.querySelectorAll('strong')[0]?.textContent),
        ]));
        expect(kv['Charge at pH 7:'], 'the engine charge, not K+R+0.1H-D-E = 1.00').toBe('0.50');
        expect(kv['Isoelectric point (mean):']).toBe('8.34');
        // ε280: one Trp (5500) and one Tyr (1490), no cystine; A280 is that over the engine's 2140.57 Da.
        expect(kv['Extinction Coefficient (mean):']).toBe('6,990 M⁻¹cm⁻¹');
        expect(kv['A[280] of 1 mg/ml (mean):']).toBe((6990 / 2140.57).toFixed(3));
        expect(notes(panel)).toContain(LABEL);
      }
    } finally {
      app.unmount();
    }
  });
});
