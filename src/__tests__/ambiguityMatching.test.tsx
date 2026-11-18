// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6VF1T: an enzyme that may cut where the sequence holds N or another ambiguity code is named
 * beside the Cloning studio's noncutter list rather than listed in it; the pairwise alignment
 * counts only identical A, C, G and T as identities and says how many columns it did not count; and
 * Test with Saved Primers says how many sites came from degenerate primers.
 *
 * The App is mounted with the harness (appHarness.tsx) and driven through its own routes: the
 * studio tab and its tool tabs, the document table's check boxes, the Alignment menu and the
 * dialog's Align button. The expected noncutters and possible cutters come from this file's own
 * scan of the catalogue (each site's letters read as base sets against the sequence's, on both
 * strands, the cuts kept inside the linear molecule), not from the engine.
 *
 * Wrong implementations this catches: an N in the sequence that matches only a site N, so EcoRI on
 * GAANTC is listed as a noncutter; a possible cutter dropped from the list with no note, or noted
 * out of catalogue order; a note on a sequence of A, C, G and T; a tab count read from another
 * list; the dialog dropping the engine's warnings; an identity that still counts N/N columns; and a
 * saved-primer summary that does not tell degenerate sites apart, or changes for exact primers.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { parseMbcWorkbench } from '../core/mbcSessionFormat';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

const FOLDER = 'Ambiguity Lab';
const doc = (id: string, name: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id, name, accession: `ACC-${id.toUpperCase()}`, description: `${name}, built in the test`, sequence,
  moleculeType: 'DNA', topology: 'linear', folder: FOLDER,
  createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z', features: [], primers: [], history: [],
  ...more,
});
const T = (n: number) => 'T'.repeat(n);

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const AUTOSAVE_KEY = 'molbiocraft.workbench.autosave.v1';

async function withApp<R>(run: (app: AppHarness) => Promise<R>): Promise<R> {
  const app = await mountApp();
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

// ─── This file's own scan: D0181's set rule, base by base ───

const SET: Record<string, number> = {
  A: 1, C: 2, G: 4, T: 8, U: 8, R: 5, Y: 10, S: 6, W: 9, K: 12, M: 3, B: 14, D: 13, H: 11, V: 7, N: 15,
};
const complement = (s: number) => ((s & 1) << 3) | ((s & 8) >> 3) | ((s & 2) << 1) | ((s & 4) >> 1);

/** (definite, possible) sites of `e` on the linear `seq`, both strands, each cut inside the molecule. */
function directSites(seq: string, e: RestrictionEnzyme): { definite: number; possible: number } {
  const fwd = [...e.recognitionSeq.toUpperCase()].map((c) => SET[c] ?? 0);
  const rev = [...fwd].reverse().map(complement);
  const strands: [number[], 1 | -1][] = fwd.join() === rev.join() ? [[fwd, 1]] : [[fwd, 1], [rev, -1]];
  const bases = [...seq.toUpperCase()].map((c) => SET[c] ?? 0);
  const m = fwd.length;
  let definite = 0;
  let possible = 0;
  for (const [pattern, strand] of strands) {
    for (let i = 0; i + m <= bases.length; i++) {
      let hit: 'definite' | 'possible' | null = 'definite';
      for (let k = 0; k < m && hit; k++) {
        const t = bases[i + k];
        const q = pattern[k];
        if ((t & q) === 0) hit = null;
        else if (t & ~q) hit = 'possible';
      }
      if (!hit) continue;
      const [top, bottom] = strand === 1 ? [i + e.cutFwd, i + e.cutRev] : [i + m - e.cutRev, i + m - e.cutFwd];
      if (top < 0 || top > bases.length || bottom < 0 || bottom > bases.length) continue;
      if (hit === 'definite') definite += 1;
      else possible += 1;
    }
  }
  return { definite, possible };
}

// ─── The Noncutters tool ───

const toolButtons = (app: AppHarness) =>
  app.canvas().querySelectorAll('[role="tablist"][aria-label="Gel and Enzyme Utilities"] button[role="tab"]');
async function openNoncutters(app: AppHarness, d: SequenceDocument) {
  await app.restoreSession({ documents: [d], activeDocId: d.id, viewerTab: 'cloning-gel' });
  await app.settle();
  const tab = toolButtons(app).filter((b) => words(b.textContent).startsWith('Noncutters ('));
  expect(tab, 'one Noncutters tool tab').toHaveLength(1);
  await app.click(tab[0]);
  return tab[0];
}
function noncutterNames(app: AppHarness): string[] {
  const region = app.canvas().querySelectorAll('[role="region"][aria-label="Non-Cutting Restriction Enzymes"]');
  expect(region, 'one Noncutters table').toHaveLength(1);
  return region[0].querySelectorAll('tbody tr').map((tr: LiveElement) => words(tr.querySelectorAll('strong')[0]?.textContent));
}
const notes = (app: AppHarness) => app.canvas().querySelectorAll('.cloning-noncutters-possible').map((n) => words(n.textContent));
const tabCount = (tab: LiveElement) => Number(/^Noncutters \((\d+)\)/.exec(words(tab.textContent))?.[1] ?? NaN);

describe('US-01M6VF1T AC2: the Noncutters tool names the enzymes that may cut under an ambiguity code', () => {
  it('US-01M6VF1T AC2 leaves EcoRI out of the list on GAANTC and names it, in catalogue order, and adds no note on GAATTC', async () => {
    await withApp(async (app) => {
      const masked = doc('masked', 'Masked_EcoRI', `${T(10)}GAANTC${T(10)}`);
      const direct = REBASE_ENZYMES.map((e) => ({ e, ...directSites(masked.sequence, e) }));
      const possibleCutters = direct.filter((d) => d.definite === 0 && d.possible > 0).map((d) => d.e.name);
      const noncutters = direct.filter((d) => d.definite === 0 && d.possible === 0).map((d) => d.e.name);
      expect(possibleCutters, 'the fixture makes EcoRI a possible cutter').toContain('EcoRI');

      const tab = await openNoncutters(app, masked);
      const shown = noncutterNames(app);
      expect(shown, 'EcoRI is not listed').not.toContain('EcoRI');
      expect(shown, 'the list is the enzymes with neither a site nor a possible site').toEqual(noncutters);
      expect(tabCount(tab), 'the tab counts the list shown').toBe(shown.length);
      const k = possibleCutters.length;
      expect(notes(app), 'one note naming the possible cutters in catalogue order').toEqual([
        k === 1
          ? `1 enzyme may cut where the sequence holds N or another ambiguity code and is not listed: ${possibleCutters[0]}.`
          : `${k} enzymes may cut where the sequence holds N or another ambiguity code and are not listed: ${possibleCutters.join(', ')}.`,
      ]);
    });

    await withApp(async (app) => {
      const exact = doc('exact', 'Exact_EcoRI', `${T(10)}GAATTC${T(10)}`);
      const tab = await openNoncutters(app, exact);
      const shown = noncutterNames(app);
      expect(shown).not.toContain('EcoRI');
      expect(shown).toEqual(REBASE_ENZYMES.filter((e) => directSites(exact.sequence, e).definite === 0).map((e) => e.name));
      expect(tabCount(tab)).toBe(shown.length);
      expect(notes(app), 'no note on a sequence of A, C, G and T').toEqual([]);
    });
  });
});

// ─── Align Two Sequences ───

const autosaved = async (app: AppHarness) => {
  await React.act(async () => { vi.advanceTimersByTime(600); });
  await app.settle();
  const raw = app.win.localStorage.getItem(AUTOSAVE_KEY);
  expect(raw, 'the App autosaved the session').toBeTruthy();
  return parseMbcWorkbench(raw!, 'Reopened').envelope;
};

describe('US-01M6VF1T AC5: Align Two Sequences keeps the identity warning in the alignment\'s Notes', () => {
  it('US-01M6VF1T AC5 ends the Notes with the Warnings block and reads Identity (%) from the engine', async () => {
    await withApp(async (app) => {
      const n20 = 'N'.repeat(20);
      const a = doc('pw-a', 'Masked_A', `ACGT${n20}ACGT`);
      const b = doc('pw-b', 'Masked_B', `TGCA${n20}TGCA`);
      await app.restoreSession({ documents: [a, b], activeDocId: a.id, viewerTab: 'sequence-view', workspace: { selectedFolder: FOLDER } as never });
      await app.settle();
      await app.change(app.one('input[aria-label="Select or deselect all documents in current folder"]'), true);
      await app.menu('align:pairwise-dialog');
      await app.settle();
      const align = app.all('button.btn-primary-sm').filter((x) => words(x.textContent) === 'Align');
      expect(align, 'one Align button').toHaveLength(1);
      await app.click(align[0]);
      await React.act(async () => { vi.advanceTimersByTime(50); });
      await app.settle();

      const saved = (await autosaved(app)).documents.filter((d) => d.documentKind === 'alignment');
      expect(saved, 'one alignment document').toHaveLength(1);
      const aln = saved[0];
      const [r1, r2] = (aln.alignmentMeta?.sequences ?? []).map((m) => m.sequence);
      expect([r1.replace(/-/g, ''), r2.replace(/-/g, '')]).toEqual([a.sequence, b.sequence]);
      const cols = [...r1].map((x, i) => [x, r2[i]] as const);
      const identical = cols.filter(([x, y]) => x === y && 'ACGT'.includes(x)).length;
      const ambiguous = cols.filter(([x, y]) => x !== '-' && y !== '-' && !('ACGT'.includes(x) && 'ACGT'.includes(y))).length;
      expect(ambiguous, 'the N20 columns pair N with N').toBe(20);
      const sentence = `Identity counts only identical A, C, G and T/U; ${ambiguous} columns pair N or another ambiguity code and are not counted as identities.`;
      expect(String(aln.docMetadata?.Notes ?? '').endsWith(`Warnings:\n- ${sentence}\n`), String(aln.docMetadata?.Notes)).toBe(true);
      const pct = Number(((identical / r1.length) * 100).toFixed(2));
      expect(aln.docMetadata?.['Identity (%)'], 'identity over the alignment length, N/N not counted').toBe(pct);
      expect(aln.alignmentMeta?.pairwiseIdentityPct).toBeCloseTo(identical / r1.length * 100, 2);
      expect(pct).toBeLessThan(71.43);
    });
  });
});

// ─── Test with Saved Primers ───

describe('US-01M6VF1T AC7: the saved-primer summary names the sites from degenerate primers', () => {
  it('US-01M6VF1T AC7 counts 3 degenerate sites of 4 and keeps the exact-only summary', async () => {
    const { runTestSavedPrimers } = await import('../core/operationRunners');
    const template = doc('tmpl', 'Template', `${T(20)}GGATCCAAGCTTGCATGC${T(20)}`);
    const primers = [
      ['exact', 'GGATCCAAGCTTGCATGC'],
      ['r', 'GGATCCRAGCTTGCATGC'],
      ['n3', 'GGATCCAAGCTTGCATGN'],
      ['i-over-t', 'GGATCCAAGCITGCATGC'],
    ].map(([id, s]) => doc(`p-${id}`, `Primer_${id}`, s, { documentKind: 'primer' }));
    const all = runTestSavedPrimers([template], primers, { maxMismatches: 0 });
    expect(all.summary).toBe('4 primer binding sites on 1 sequence (4 primers, ≤ 0 mismatches; 3 from degenerate primers, matched by IUPAC codes)');
    expect(all.updated[0].primers.map((p) => [p.name, p.bindStart, p.strand])).toEqual(
      primers.map((p) => [p.name, 21, 1]),
    );
    const exactOnly = runTestSavedPrimers([template], [primers[0]], { maxMismatches: 0 });
    expect(exactOnly.summary).toBe('1 primer binding site on 1 sequence (1 primers, ≤ 0 mismatches)');
  });
});
