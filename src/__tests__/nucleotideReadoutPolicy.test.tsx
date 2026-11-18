// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6VFP8: every nucleotide readout counts A/C/G/T, N and the other IUPAC codes, inosine (I)
 * and letters that are no nucleotide code apart, and says how it treated each.
 *
 * Wrong implementations, and the case that catches each:
 * - AC4: a TS sentence that calls inosine or X an ambiguity base (today's), or one that drifts from
 *   the engine's words: each sentence is compared with the engine's own `tmNoAnswerReason`;
 * - AC5: a masses note or Tm reason that still reads `counts.N` as every non-A/C/G/T letter, or a
 *   note that names a part whose count is 0 (the I/X/Z fixture has no N and no code); the cockpit
 *   or quickbar counting I as N; a TS letter sort that differs from the engine's for any letter, in
 *   either case (all 52 are checked against `analyze_sequence_composition`);
 * - AC6: I and X skipped (today: their masses equal ACGT's), weighed as something other than N, or
 *   weighed with no mark or note on the alignment Statistics.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { analyzeSequenceComposition, calculatePrimerMetrics, nucleotideLetterKind, tmNoAnswerSentence } from '../core/bioEngine';
import { meanNucleotideMolecularWeightKda } from '../core/alignmentViewModel';
import { ConstructCockpitBar } from '../components/ConstructCockpitBar';
import { LinearSequenceView } from '../components/LinearSequenceView';
import { mountApp, type AppHarness } from './appHarness';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const TAIL = '; Tm is computed on A/C/G/T only, as Primer3 does';

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z', features: [], primers: [], history: [],
};
const DISPLAY = {
  showOrfs: false, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: false,
  showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
};

describe('US-01M6VFP8 AC4 the Tm reason names inosine and foreign letters', () => {
  it('US-01M6VFP8 AC4 tmNoAnswerSentence writes the engine sentence for the same counts', () => {
    const cases: [string, [number, number, number], string][] = [
      ['ACGTACGTACGTACGTACGI', [0, 1, 0], `Tm n/a: the span holds 1 inosine (I)${TAIL}`],
      ['ACGTACGTACGTACGTACXX', [0, 0, 2], `Tm n/a: the span holds 2 letters that are not nucleotide codes${TAIL}`],
      [
        'ACGTNNACGTACGTACGTIX',
        [2, 1, 1],
        `Tm n/a: the span holds 2 N or other ambiguity bases, 1 inosine (I) and 1 letter that is not a nucleotide code${TAIL}`,
      ],
      ['ACGTACGTACGTACGTNNRY', [4, 0, 0], `Tm n/a: the span holds 4 N or other ambiguity bases${TAIL}`],
    ];
    for (const [oligo, [codes, inosine, other], sentence] of cases) {
      expect(calculatePrimerMetrics(oligo).tmNoAnswerReason, `the engine, ${oligo}`).toBe(sentence);
      expect(tmNoAnswerSentence(codes, inosine, other), `the app, ${oligo}`).toBe(sentence);
    }
    // The codes-only call BG-01M6SHQ0's readers make is unchanged.
    expect(tmNoAnswerSentence(1)).toBe(`Tm n/a: the span holds 1 N or other ambiguity base${TAIL}`);
  });
});

const KIND_KEYS = ['A', 'C', 'G', 'T', 'N', 'ambiguity', 'inosine', 'other'] as const;

/** The Sequence Statistics section of the mounted App, opened: its label/value rows and its notes. */
async function sequenceStatistics(app: AppHarness) {
  const section = () => app.inspectorAside()!.querySelectorAll('.mbc-accordion-section')
    .filter((s) => s.querySelectorAll('button.mbc-accordion-header').some((h) => words(h.textContent) === 'Sequence Statistics'));
  expect(section(), 'one Sequence Statistics section').toHaveLength(1);
  const header = section()[0].querySelectorAll('button.mbc-accordion-header')[0];
  if (header.getAttribute('aria-expanded') !== 'true') await app.click(header);
  // The whole-sequence count runs in a timer task of its own (BG-01M6RTP1); the harness fakes timers.
  for (let i = 0; i < 20; i++) {
    await React.act(async () => { vi.advanceTimersByTime(10); });
    await app.settle();
    const notes = section()[0].querySelectorAll('p.mbc-summary-note').map((p) => words(p.textContent));
    if (!notes.includes('Counting the whole sequence…')) break;
  }
  const s = section()[0];
  return {
    kv: Object.fromEntries(s.querySelectorAll('.stat-kv').map((row) => [
      words(row.querySelectorAll('span')[0]?.textContent), words(row.querySelectorAll('strong')[0]?.textContent),
    ])),
    notes: s.querySelectorAll('p.mbc-summary-note').map((p) => words(p.textContent)),
  };
}

async function showDna(app: AppHarness, id: string, sequence: string): Promise<void> {
  const doc: SequenceDocument = { ...BLANK, id, name: id, accession: id, sequence };
  await app.restoreSession({
    documents: [doc], activeDocId: id, viewerTab: 'sequence-view',
    workspace: { displaySettings: DISPLAY, selectedRange: { start: 1, end: sequence.length } } as never,
  });
  await app.settle();
}

describe('US-01M6VFP8 AC5 the sequence readouts name each kind of letter', () => {
  it('US-01M6VFP8 AC5 nucleotideLetterKind sorts every letter as the engine composition counts it', () => {
    const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'abcdefghijklmnopqrstuvwxyz'];
    const kinds = new Set<string>();
    for (const letter of letters) {
      const counts = analyzeSequenceComposition(letter).counts as unknown as Record<string, number | undefined>;
      const engine = KIND_KEYS.filter((k) => (counts[k] ?? 0) === 1);
      expect(engine, `the engine counts ${letter} once`).toHaveLength(1);
      expect(nucleotideLetterKind(letter.charCodeAt(0)), letter).toBe(engine[0]);
      kinds.add(engine[0]);
    }
    expect([...kinds].sort(), 'every kind is reached').toEqual([...KIND_KEYS].sort());
    for (const symbol of ['-', '*', '?', '.', '1', ' ']) expect(nucleotideLetterKind(symbol.charCodeAt(0)), symbol).toBeNull();
  });

  it('US-01M6VFP8 AC5 Statistics, the status bar, the cockpit and the quickbar say how N, codes, I and X were read', async () => {
    const seq = 'ACGTACGTACGTACGTNNRYIX';
    const reason = `Tm n/a: the span holds 4 N or other ambiguity bases, 1 inosine (I) and 1 letter that is not a nucleotide code${TAIL}`;
    const app = await mountApp();
    try {
      await showDna(app, 'vfp8-mixed', seq);
      const stats = await sequenceStatistics(app);
      expect(stats.notes).toContain(
        'Masses are approximate: 2 bases are N, 2 are other IUPAC codes, 1 is inosine (I) and 1 letter is not a nucleotide code (X); each is weighed as the mean of A, C, G and T.',
      );
      expect(stats.kv['dsDNA mass:']).toMatch(/^≈ /);
      expect(stats.kv['Melting temp:']).toBe('n/a');
      expect(stats.notes).toContain(reason);

      const status = app.all('footer.mbc-statusbar span').filter((s) => /^Selection: /.test(words(s.textContent)));
      expect(status.length, 'the status bar selection').toBeGreaterThan(0);
      expect(words(status[0].textContent)).toMatch(/\| Tm: n\/a\)$/);
      const titles = status[0].querySelectorAll('span').filter((s) => words(s.textContent) === 'n/a').map((s) => s.getAttribute('title'));
      expect(titles).toEqual([reason]);

      // parts only for counts above 0: no N and no code here
      await showDna(app, 'vfp8-ixz', 'ACGTACGTACGTACGTIXZ');
      const ixz = await sequenceStatistics(app);
      expect(ixz.notes).toContain(
        'Masses are approximate: 1 base is inosine (I) and 2 letters are not nucleotide codes (X, Z); each is weighed as the mean of A, C, G and T.',
      );
      expect(ixz.notes).toContain(`Tm n/a: the span holds 1 inosine (I) and 2 letters that are not nucleotide codes${TAIL}`);
      // inosine with no foreign letter, and a foreign letter with no inosine, each take the new form
      await showDna(app, 'vfp8-ni', 'ACGTACGTACGTACGTNI');
      expect((await sequenceStatistics(app)).notes).toContain(
        'Masses are approximate: 1 base is N and 1 is inosine (I); each is weighed as the mean of A, C, G and T.',
      );
      await showDna(app, 'vfp8-rx', 'ACGTACGTACGTACGTRX');
      expect((await sequenceStatistics(app)).notes).toContain(
        'Masses are approximate: 1 base is another IUPAC code and 1 letter is not a nucleotide code (X); each is weighed as the mean of A, C, G and T.',
      );
      // N and other codes alone keep the sentence the note had before, as the Tm reason does
      await showDna(app, 'vfp8-nr', 'ACGTACGTACGTACGTNR');
      expect((await sequenceStatistics(app)).notes).toContain(
        'Masses are approximate: 2 bases are N or another IUPAC code, weighed as the mean of A, C, G and T.',
      );
    } finally {
      app.unmount();
    }

    // The cockpit and the quickbar, each over the whole sequence, give the same words.
    const doc: SequenceDocument = { ...BLANK, id: 'vfp8-c', name: 'c', accession: 'c', sequence: seq };
    const range = { start: 1, end: seq.length };
    const cockpit = renderToStaticMarkup(<ConstructCockpitBar doc={doc} cutSites={[]} selectedRange={range} onSelectRange={() => {}} />);
    const cockpitReason = /<span class="mbc-cockpit-tm-reason">([^<]*)<\/span>/.exec(cockpit)?.[1];
    expect(cockpitReason, 'the cockpit reason').toBe(reason);
    const linear = renderToStaticMarkup(
      <LinearSequenceView doc={doc} cutSites={[]} selectedRange={range} onSelectRange={() => {}} onUpdateDocument={() => {}} />,
    );
    const summary = /<div class="seq-selection-quickbar-summary">([\s\S]*?)<\/div>/.exec(linear)?.[1] ?? '';
    expect(/<span title="([^"]*)">n\/a<\/span>/.exec(summary)?.[1], 'the quickbar title').toBe(reason);
  });
});

describe('US-01M6VFP8 AC6 the alignment masses weigh I and X as N and say so', () => {
  it('US-01M6VFP8 AC6 meanNucleotideMolecularWeightKda weighs I and X as N and counts them', () => {
    const rows = ['ACGTIIIIII', 'ACGTIIIIXX'];
    const mw = meanNucleotideMolecularWeightKda(rows);
    const asN = meanNucleotideMolecularWeightKda(['ACGTNNNNNN', 'ACGTNNNNNN']);
    const acgt = meanNucleotideMolecularWeightKda(['ACGT', 'ACGT']);
    expect(asN.ssKda, 'fixture: N weighs').not.toBeCloseTo(acgt.ssKda, 6);
    expect(mw.ssKda).toBeCloseTo(asN.ssKda, 9);
    expect(mw.dsKda).toBeCloseTo(asN.dsKda, 9);
    expect(mw.weighedAsMean).toBe(12);
    expect(asN.weighedAsMean, 'N is an IUPAC code, weighed by its members').toBe(0);
    // gaps and missing data are no letter, and lower case reads as upper
    expect(meanNucleotideMolecularWeightKda(['AC-GT?i.x']).weighedAsMean).toBe(2);
  });

  it('US-01M6VFP8 AC6 the alignment Statistics mark both masses and name the letters', async () => {
    const app = await mountApp();
    try {
      const aln = {
        ...BLANK, id: 'vfp8-aln', name: 'VFP8 Alignment', accession: 'VFP8_0001', folder: 'Alignments', sequence: 'ACGTIIIIII',
        documentKind: 'alignment',
        alignmentMeta: { isAligned: true, sequences: [{ id: 'vfp8-a', name: 'Row A', sequence: 'ACGTIIIIII' }, { id: 'vfp8-b', name: 'Row B', sequence: 'ACGTIIIIXX' }] },
      } as SequenceDocument;
      await app.restoreSession({ documents: [aln], activeDocId: aln.id, viewerTab: 'sequence-alignment' });
      await app.settle();
      const box = () => app.all('div').filter((d) => d.querySelectorAll('div').some((h) => words(h.textContent) === 'Molecular weight (mean):')
        && d.querySelectorAll('.mbc-aln-stat-kv').length === 2);
      if (box().length === 0) {
        await app.click(app.one('button.mbc-aln-rail-btn[aria-label="Statistics"]', 'the Statistics rail button'));
        await app.settle();
      }
      expect(box(), 'the nucleotide mass box').toHaveLength(1);
      const kv = Object.fromEntries(box()[0].querySelectorAll('.mbc-aln-stat-kv').map((row) => [
        words(row.querySelectorAll('span')[0]?.textContent), words(row.querySelectorAll('strong')[0]?.textContent),
      ]));
      const mw = meanNucleotideMolecularWeightKda(['ACGTIIIIII', 'ACGTIIIIXX']);
      expect(kv).toEqual({ 'ssDNA:': `≈ ${mw.ssKda.toFixed(3)} kDa`, 'dsDNA:': `≈ ${mw.dsKda.toFixed(3)} kDa` });
      expect(box()[0].querySelectorAll('p.mbc-summary-note').map((p) => words(p.textContent))).toEqual([
        '12 letters are weighed as the mean of A, C, G and T: 10 inosine (I) and 2 that are not nucleotide codes (X).',
      ]);
    } finally {
      app.unmount();
    }
  });
});
