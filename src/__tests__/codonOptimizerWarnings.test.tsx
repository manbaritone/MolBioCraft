// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M7Q785 (D0269): the Protein studio's Back-Translate & Multi-Host Codon Optimizer shows the
 * engine's warnings beside its result, through the shared ResultWarnings (D0005). The codon
 * optimiser moved there from Hybrid Tools with US-01M6Q164.
 *
 * Driven through the mounted App and the committed WASM engine (nothing replaced): a DNA record
 * whose CDS ATGAAANNNTGG translates to MKXW is optimised, and the engine writes its X as NNN with a
 * warning. The expected sentence is a literal here, as the engine words it (translation_orf.rs).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** A DNA record whose one CDS, ATG AAA NNN TGG, translates to MKXW. */
const MKXW: SequenceDocument = {
  id: 'mkxw', name: 'pMKXW', accession: '', description: '', sequence: 'ATGAAANNNTGG', moleculeType: 'DNA', topology: 'linear',
  folder: 'Local', createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z',
  features: [{ id: 'cds1', name: 'mkxw', type: 'CDS', start: 1, end: 12, strand: 1, color: '#888' }],
  primers: [], history: [],
};
const X_WARNING = 'Residue 3 (X) has no codon: written as NNN.';

const panel = (app: AppHarness) => app.one('.codon-result-panel', 'the codon optimiser\'s result');
/** The warnings the codon optimiser's result shows beside it, in its own ResultWarnings region. */
const codonWarnings = (app: AppHarness) =>
  panel(app).querySelectorAll('[role="status"][aria-label="Codon optimisation warnings"] p').map((p) => words(p.textContent));
const optimisedDna = (app: AppHarness) => words(panel(app).querySelectorAll('code')[0]?.textContent);

describe('BG-01M7Q785 AC1: the Protein studio\'s codon optimiser shows the engine\'s warnings beside its result', () => {
  it('BG-01M7Q785 AC1 optimising a CDS that translates to MKXW shows the X warning through ResultWarnings, for the first host and a host chosen after', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [MKXW], activeDocId: MKXW.id, viewerTab: 'sequence-view' });
      await app.clickStudio('protein-3d');
      await app.settle();
      expect(app.activeTab()).toBe('protein-3d');
      expect(optimisedDna(app)).toContain('NNN');
      expect(codonWarnings(app)).toEqual([X_WARNING]);

      const human = app.all('button.method-tab-btn').find((b) => words(b.textContent) === 'Human (HEK293)');
      if (!human) throw new Error('the codon optimiser offers no Human (HEK293) host');
      await app.click(human);
      await app.settle();
      expect(words(panel(app).textContent)).toContain('human_hek293');
      expect(codonWarnings(app)).toEqual([X_WARNING]);
    } finally {
      app.unmount();
    }
  });
});
