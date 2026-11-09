// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { EVO_ANALYSIS_TITLES, MODEL_ANALYSES, runEvolutionAnalysis, type EvoAnalysis } from '../core/evolutionAnalyses';
import { EvolutionAnalysisDialog } from '../components/EvolutionAnalysisDialogs';
import { MSA_ALGORITHMS, analysisRows, msaAlgo, normalizeMsaPresetId, runMultipleAlignment, runTranslationAlign } from '../core/operationRunners';
import { MSA_PRESET_INFO, PhylogeneticsStudio, SequenceAlignmentStudio } from '../components/AlignmentAndPhyloStudio';
import { translationAlign } from '../core/alignmentTools';
import { runValidatedAlignment } from '../core/alignmentExecution';
import { isPreAlignedInputSet } from '../core/documentViews';
import { computeRelativeSynonymousCodonUsage } from '../core/phyloEvoEngine';
import type { SequenceDocument } from '../types/bio';
// The engine's own source, read as text so a preset's description can be pinned to its dispatch.
import msaDispatchRs from '../../crates/molbiocraft-align/src/poa_and_banded.rs?raw';
import centerStarRs from '../../crates/molbiocraft-align/src/msa.rs?raw';
import wasmRpcRs from '../../crates/molbiocraft-wasm/src/lib.rs?raw';

type JsxFn = (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => unknown;
const probe = vi.hoisted(() => ({
  onElement: null as null | ((type: unknown, props: Record<string, unknown>) => void),
}));
const watch = vi.hoisted(() => (fn: JsxFn): JsxFn => (type, props, ...rest) => {
  probe.onElement?.(type, props ?? {});
  return fn(type, props, ...rest);
});
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-dev-runtime');
  return { ...actual, jsxDEV: watch(actual.jsxDEV) };
});
vi.mock('react/jsx-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-runtime');
  return { ...actual, jsx: watch(actual.jsx), jsxs: watch(actual.jsxs) };
});

const aln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
const members: SequenceDocument[] = aln.alignmentMeta!.sequences!.slice(0, 12).map((m, i) => ({
  ...aln, id: `m${i}`, name: m.name, sequence: m.sequence, alignmentMeta: undefined, features: [], documentKind: undefined,
} as SequenceDocument));
const ctx = { sourceLabel: 'COXII' };
const notes = (kind: EvoAnalysis, v: Record<string, string | number | boolean>) => {
  const r = runEvolutionAnalysis(members, kind, v, ctx);
  return { r, text: String(r.created[0].docMetadata?.Notes) };
};

describe('evolution analysis windows', () => {
  it.each([
    ['models', { analysis: 'best' }, /BIC/],
    ['models', { analysis: 'matrix' }, /Overall transition\/transversion bias R = \d/],
    ['models', { analysis: 'disparity' }, /pairs reject homogeneity/],
    ['models', { analysis: 'composition' }, /GC3%/],
    ['models', { analysis: 'rscu' }, /RSCU/],
    ['diversity', {}, /Haplotype diversity/],
    ['selection', { test: 'z-neutral' }, /Z statistic = /],
    ['selection', { test: 'fisher' }, /P = /],
    ['selection', { test: 'tajima' }, /D/],
    ['selection', { test: 'codons' }, /pN − pS/],
    ['rates', { categories: 4 }, /Gamma shape α = /],
    ['ancestors', { method: 'ml' }, />/],
    ['ancestors', { method: 'mp' }, />/],
    ['clocks', { test: 'ml' }, /2ΔlnL = /],
    ['clocks', { test: 'relative' }, /relative rate test/],
  ] as [EvoAnalysis, Record<string, string | number>, RegExp][])('%s %o', (kind, v, re) => {
    const { r, text } = notes(kind, v);
    expect(text).toMatch(re);
    expect(r.summary.length).toBeGreaterThan(3);
    expect(r.created[0].history[0].parentIds).toHaveLength(12);
  });
  it('model ranking is sorted by BIC', () => {
    const { text } = notes('models', { analysis: 'best' });
    const tsv = text.split('Tab-separated, for spreadsheets:')[1].trim().split('\n').slice(1).map((l) => Number(l.split('\t')[2]));
    expect(tsv.length).toBeGreaterThan(3);
    for (let i = 1; i < tsv.length; i++) expect(tsv[i]).toBeGreaterThanOrEqual(tsv[i - 1]);
  });
  it('states the total of every list on the sample alignment', () => {
    // The codon scan reads every column, so the variable codons are counted here from the rows:
    // codons holding two or more distinct A/C/G/T triplets.
    const rows = members.map((m) => m.sequence.toUpperCase());
    let variable = 0;
    for (let k = 0; 3 * k + 3 <= rows[0].length; k++) {
      if (new Set(rows.map((s) => s.slice(3 * k, 3 * k + 3)).filter((c) => /^[ACGT]{3}$/.test(c))).size >= 2) variable++;
    }
    const { r: sel, text: codons } = notes('selection', { test: 'codons' });
    expect(codons).toContain(`\nAll ${variable.toLocaleString('en-US')} variable codons are listed.\n`);
    expect(sel.summary).toBe(`${variable.toLocaleString('en-US')} variable codons`);
    // A binary midpoint-rooted tree on 12 tips has 11 internal nodes; the FASTA holds each one.
    for (const method of ['ml', 'mp']) {
      const { r, text } = notes('ancestors', { method });
      expect(text.split('\n').filter((l) => l === `All ${members.length - 1} internal nodes are listed.`)).toHaveLength(2);
      expect(text.split('## Ancestral sequences (FASTA)')[1].split('\n').filter((l) => l.startsWith('>'))).toHaveLength(members.length - 1);
      expect(r.summary).toBe(`${members.length - 1} ancestral nodes reconstructed`);
    }
  });
  // Codon usage reads codons by alignment column, in triplets from column 1, and counts a row's
  // codon only where all three columns hold a base (BG01M6XBAC). Every count below is the engine's.
  const engineCounts = (rows: string[]) =>
    new Map(computeRelativeSynonymousCodonUsage(rows).filter((r) => r.count > 0).map((r) => [r.codon, r.count]));
  const sumOf = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const sameCounts = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([c, n]) => b.get(c) === n);
  const rscuCounts = (docs: SequenceDocument[]) => {
    const r = runEvolutionAnalysis(docs, 'models', { analysis: 'rscu' }, ctx);
    const tsv = String(r.created[0].docMetadata?.Notes).split('Tab-separated, for spreadsheets:')[1].trim().split('\n').slice(1);
    const m = new Map<string, number>();
    for (const [codon, , count] of tsv.map((l) => l.split('\t'))) if (Number(count) > 0) m.set(codon, Number(count));
    return { summary: r.summary, counts: m };
  };
  it('models rscu counts the COXII codons by column, as the gap-stripped read did except in an ambiguity-code slot', () => {
    const ids = aln.alignmentMeta!.sequences!.slice(0, 12).map((m) => m.id);
    const rows = members.map((m) => m.sequence);
    // The old read removed every non-base and read the rest in triplets: the engine given the
    // stripped row reproduces it. A row whose gaps and non-bases fill whole codon slots reads the
    // same codons either way; only Sparrow (coxii-seq-10) carries an ambiguity code inside a slot.
    const stripped = (s: string) => s.toUpperCase().replace(/[^ACGTU]/g, '');
    const perRow = rows.map((s) => engineCounts([s]));
    const oldPerRow = rows.map((s) => engineCounts([stripped(s)]));
    expect(ids.filter((_, i) => !sameCounts(perRow[i], oldPerRow[i]))).toEqual(['coxii-seq-10']);
    expect(perRow.reduce((t, m) => t + sumOf(m), 0)).toBe(2734);
    expect(oldPerRow.reduce((t, m) => t + sumOf(m), 0)).toBe(2735);
    // The report reads the same rows as the engine, row by row.
    const { summary, counts } = rscuCounts(members);
    expect(sumOf(counts)).toBe(2734);
    expect(sameCounts(counts, engineCounts(rows))).toBe(true);
    expect(summary).toBe('Codon usage of 2,734 codons');
    // A codon slot holding an ambiguity code counts no codon: blanking the slot changes nothing,
    // and resolving the code to any base adds exactly that one codon.
    const sparrow = rows[ids.indexOf('coxii-seq-10')].toUpperCase();
    const codes = [...sparrow.matchAll(/[^ACGT-]/g)];
    expect(codes.map((m) => m[0])).toEqual(['K', 'W']);
    for (const m of codes) {
      const start = m.index! - (m.index! % 3);
      expect(sparrow.slice(start, start + 3)).not.toContain('-');
      expect(sameCounts(engineCounts([sparrow.slice(0, start) + '---' + sparrow.slice(start + 3)]), engineCounts([sparrow]))).toBe(true);
      for (const base of 'ACGT') {
        const resolved = sparrow.slice(0, m.index!) + base + sparrow.slice(m.index! + 1);
        expect(sumOf(engineCounts([resolved]))).toBe(sumOf(engineCounts([sparrow])) + 1);
      }
    }
  });
  it('codon usage on unaligned inputs reads each sequence in its own frame', () => {
    // The 12 COXII CDSs without their gaps: equal length and gap-free, so the analysis menu aligns
    // them first with the nucleotide aligner, which puts gaps inside codon slots (D0097).
    const raw = members.map((m) => ({ ...m, sequence: m.sequence.replace(/-/g, '') }));
    expect(isPreAlignedInputSet(raw)).toBe(false);
    const expected = new Map<string, number>();
    for (const d of raw) for (const [c, n] of engineCounts([d.sequence.toUpperCase()])) expected.set(c, (expected.get(c) ?? 0) + n);
    expect(sumOf(expected)).toBe(2734);
    // The realigned rows read by column would give a different, out-of-frame count.
    const exec = runValidatedAlignment(raw.map((d) => ({ id: d.id, name: d.name, sequence: d.sequence, moleculeType: d.moleculeType })), '');
    expect(exec.error).toBeNull();
    expect(sumOf(engineCounts(exec.result.rows.map((r) => r.alignedSeq.toUpperCase())))).toBe(2694);
    const { summary, counts } = rscuCounts(raw);
    expect(summary).toBe('Codon usage of 2,734 codons');
    expect(sameCounts(counts, expected)).toBe(true);
  });
  it('codon usage on unaligned inputs takes no width gate, and a trailing partial codon is no codon', () => {
    // Four unaligned CDSs ending in incomplete stop codons (T, TA), as mitochondrial CDSs do: 16 and
    // 17 bases, so neither the inputs nor any alignment of them need be a multiple of 3 wide.
    const seqs = ['ATGGCTAAAGGTCTGT', 'ATGGCCAAGGGACTTTA', 'ATGGCAAAAGGCCTCT', 'ATGGCGAAGGGGTTATA'];
    const docs = seqs.map((sequence, i) => ({ ...members[0], id: `p${i}`, name: `p${i}`, sequence } as SequenceDocument));
    expect(isPreAlignedInputSet(docs)).toBe(false);
    const { summary, counts } = rscuCounts(docs);
    expect(summary).toBe('Codon usage of 20 codons');
    expect(sameCounts(counts, engineCounts(seqs.map((s) => s.slice(0, 15))))).toBe(true);
  });
  it('codon usage strips gaps from unaligned inputs', () => {
    // Gapped rows of unequal length are no alignment, so each is read on its own: its gaps ('-' and
    // '.') come out first, then the rest reads in triplets from its first base (D0097). Ungapped,
    // the rows hold 3 + 4 + 3 codons; read with its gap, each gapped row goes out of frame after it.
    const seqs = ['ATG-AAACCC', 'ATGAAACCCGGG', 'ATGAA.ACCC'];
    const docs = seqs.map((sequence, i) => ({ ...members[0], id: `g${i}`, name: `g${i}`, sequence } as SequenceDocument));
    expect(isPreAlignedInputSet(docs)).toBe(false);
    expect(sumOf(engineCounts(seqs))).toBeLessThan(10);
    const { summary, counts } = rscuCounts(docs);
    expect(summary).toBe('Codon usage of 10 codons');
    expect(counts).toEqual(new Map([['ATG', 3], ['AAA', 3], ['CCC', 3], ['GGG', 1]]));
  });
  it('the evolution dialog offers Align first only where the analysis aligns', () => {
    const seqs = ['ATGGCTAAAGGTCTGT', 'ATGGCCAAGGGACTTTA', 'ATGGCAAAAGGCCTCT', 'ATGGCGAAGGGGTTATA'];
    const raw = seqs.map((sequence, i) => ({ ...members[0], id: `a${i}`, name: `a${i}`, sequence } as SequenceDocument));
    expect(isPreAlignedInputSet(raw)).toBe(false);
    expect(isPreAlignedInputSet(members)).toBe(true);
    const dialog = (kind: EvoAnalysis, inputs: SequenceDocument[], analysis?: string) => {
      let opened = false;
      probe.onElement = (type, props) => {
        if (!opened && type === 'button' && String(props.className ?? '').includes('mbc-opdlg-more-toggle') && typeof props.onClick === 'function') {
          opened = true;
          (props.onClick as () => void)();
        }
      };
      try {
        return renderToStaticMarkup(React.createElement(EvolutionAnalysisDialog, {
          kind, inputs, sourceLabel: 'COXII', initial: analysis ? { analysis } : undefined, onCreate: () => {}, onClose: () => {},
        }));
      } finally {
        probe.onElement = null;
      }
    };
    const offered = (html: string) => html.includes('id="opdlg-evo-align"');
    const notApplicable = (html: string) => html.includes('Align first with:') && html.includes('Does not apply');
    // Every analysis but codon usage aligns unaligned inputs first, so each offers the choice of aligner.
    const cases: [EvoAnalysis, string | undefined][] = [
      ...Object.keys(MODEL_ANALYSES).map((a) => ['models', a] as [EvoAnalysis, string]),
      ...(Object.keys(EVO_ANALYSIS_TITLES) as EvoAnalysis[]).filter((k) => k !== 'models').map((k) => [k, undefined] as [EvoAnalysis, undefined]),
    ];
    expect(cases).toHaveLength(10);
    for (const [kind, analysis] of cases) {
      const rscu = kind === 'models' && analysis === 'rscu';
      const html = dialog(kind, raw, analysis);
      expect([kind, analysis, offered(html), notApplicable(html)]).toEqual([kind, analysis, !rscu, rscu]);
      // Inputs that are already aligned are aligned by no analysis: neither the choice nor the note.
      const given = dialog(kind, members, analysis);
      expect([kind, analysis, offered(given), given.includes('Align first with:')]).toEqual([kind, analysis, false, false]);
    }
    // Codon usage on unaligned inputs aligns nothing, so every aligner gives the same report.
    const rscuNotes = MSA_ALGORITHMS.map((o) => String(runEvolutionAnalysis(raw, 'models', { analysis: 'rscu', alignFirst: o.value }, ctx).created[0].docMetadata?.Notes));
    expect(rscuNotes[0]).not.toMatch(/aligned first/);
    expect(new Set(rscuNotes).size).toBe(1);
    // An analysis that aligns names the aligner it was given.
    const dataLine = (alignFirst: string) => String(runEvolutionAnalysis(raw, 'diversity', { alignFirst }, ctx).created[0].docMetadata?.Notes).split('\n').find((l) => l.startsWith('Data: '));
    const other = MSA_ALGORITHMS[2];
    expect(dataLine(other.value)).toContain(`aligned first (${other.label})`);
    expect(dataLine('')).toContain(`aligned first (${MSA_ALGORITHMS[0].label})`);
  });
  it('the evolution dialog summary for codon usage on unaligned inputs does not claim an alignment step and updates in place', () => {
    const seqs = ['ATGGCTAAAGGTCTGT', 'ATGGCCAAGGGACTTTA', 'ATGGCAAAAGGCCTCT', 'ATGGCGAAGGGGTTATA'];
    const raw = seqs.map((sequence, i) => ({ ...members[0], id: `s${i}`, name: `s${i}`, sequence } as SequenceDocument));
    expect(isPreAlignedInputSet(raw)).toBe(false);
    expect(isPreAlignedInputSet(members)).toBe(true);

    const summaryText = (html: string) => {
      const m = /<div class="mbc-opdlg-summary">([\s\S]*?)<\/div>\s*<div class="mbc-opdlg-options">/.exec(html);
      expect(m, 'real OperationDialog renders .mbc-opdlg-summary').not.toBeNull();
      return m![1].replace(/<[^>]+>/g, '');
    };
    const renderRealDialog = (
      kind: EvoAnalysis,
      inputs: SequenceDocument[],
      opts?: { initialAnalysis?: string; switchAnalysisTo?: string; openMore?: boolean },
    ) => {
      let switched = !opts?.switchAnalysisTo;
      let opened = !opts?.openMore;
      probe.onElement = (type, props) => {
        if (!switched && type === 'select' && props.id === 'opdlg-evo-what' && typeof props.onChange === 'function') {
          switched = true;
          (props.onChange as (e: { target: { value: string } }) => void)({ target: { value: opts!.switchAnalysisTo! } });
        }
        if (!opened && type === 'button' && String(props.className ?? '').includes('mbc-opdlg-more-toggle') && typeof props.onClick === 'function') {
          opened = true;
          (props.onClick as () => void)();
        }
      };
      try {
        return renderToStaticMarkup(React.createElement(EvolutionAnalysisDialog, {
          kind,
          inputs,
          sourceLabel: 'COXII',
          initial: opts?.initialAnalysis ? { analysis: opts.initialAnalysis } : undefined,
          onCreate: () => {},
          onClose: () => {},
        }));
      } finally {
        probe.onElement = null;
      }
    };

    const cases: [EvoAnalysis, string | undefined][] = [
      ...Object.keys(MODEL_ANALYSES).map((a) => ['models', a] as [EvoAnalysis, string]),
      ...(Object.keys(EVO_ANALYSIS_TITLES) as EvoAnalysis[]).filter((k) => k !== 'models').map((k) => [k, undefined] as [EvoAnalysis, undefined]),
    ];
    for (const [kind, analysis] of cases) {
      const rscu = kind === 'models' && analysis === 'rscu';
      const unalignedHtml = renderRealDialog(kind, raw, { initialAnalysis: analysis });
      // Without clicking More options on the real dialog, neither the aligner select nor "Does not apply" is shown.
      expect(unalignedHtml.includes('id="opdlg-evo-align"')).toBe(false);
      expect(unalignedHtml.includes('Does not apply')).toBe(false);
      const unalignedSummary = summaryText(unalignedHtml);
      expect([kind, analysis, unalignedSummary.includes('will be aligned first'), unalignedSummary.includes('each sequence read in its own frame (not aligned)')]).toEqual([
        kind, analysis, !rscu, rscu,
      ]);

      const alignedSummary = summaryText(renderRealDialog(kind, members, { initialAnalysis: analysis }));
      expect(alignedSummary).not.toContain('will be aligned first');
      expect(alignedSummary).not.toContain('not aligned');
    }

    // Switching Analysis in place (without reopening the dialog) updates both the always-visible summary and More options.
    const switchedToRscu = renderRealDialog('models', raw, { initialAnalysis: 'best', switchAnalysisTo: 'rscu', openMore: true });
    expect(summaryText(switchedToRscu)).not.toContain('will be aligned first');
    expect(summaryText(switchedToRscu)).toContain('each sequence read in its own frame (not aligned)');
    expect(switchedToRscu.includes('id="opdlg-evo-align"')).toBe(false);
    expect(switchedToRscu).toContain('Does not apply');

    const switchedToBest = renderRealDialog('models', raw, { initialAnalysis: 'rscu', switchAnalysisTo: 'best', openMore: true });
    expect(summaryText(switchedToBest)).toContain('will be aligned first');
    expect(summaryText(switchedToBest)).not.toContain('not aligned');
    expect(switchedToBest.includes('id="opdlg-evo-align"')).toBe(true);
    expect(switchedToBest).not.toContain('Does not apply');
  });
  it('the studio and the menu read the same group labels', () => {
    // One label per member: at the start of the description, inside it, followed by more text, in
    // Group metadata (either case), in both (metadata wins), or nowhere.
    const labels: [string, Record<string, string> | undefined, string][] = [
      ['Group: Birds', undefined, 'Birds'],
      ['COII Group: Mammals', undefined, 'Mammals'],
      ['Group: Reptiles; partial cds', undefined, 'Reptiles'],
      ['cytochrome oxidase II, Group: Fish, mitochondrial', undefined, 'Fish'],
      ['', { Group: 'Amphibians' }, 'Amphibians'],
      ['cytochrome oxidase II', { group: 'Insects' }, 'Insects'],
      ['Group: Birds', { Group: 'Mammals' }, 'Mammals'],
      ['line 1\nGroup: Fish', undefined, 'Fish'],
      ['cytochrome oxidase II', undefined, ''],
      ['Grouping not known', undefined, ''],
      ['Group:', undefined, ''],
      ['', undefined, ''],
    ];
    expect(labels).toHaveLength(members.length);
    const labelled = (docs: SequenceDocument[]) => docs.map((d, i) => ({ ...d, description: labels[i][0], docMetadata: { ...(d.docMetadata ?? {}), ...(labels[i][1] ?? {}) } }));
    const expected = new Map(members.map((m, i) => [m.name, labels[i][2]]));
    /** The Group column of the studio's Taxa & Groups table, by taxon. */
    const studioGroups = (docs: SequenceDocument[]) => {
      const html = renderToStaticMarkup(React.createElement(PhylogeneticsStudio, { documents: docs, activeDoc: docs[0], initialPhyloTab: 'data' }));
      const table = html.split('Taxa &amp; Groups')[1] ?? '';
      const rows = [...table.matchAll(/<tr><td><strong>([^<]*)<\/strong><\/td><td>(?:<span class="badge-accent">([^<]*)<\/span>|<span[^>]*>—<\/span>)<\/td>/g)];
      return new Map(rows.map((r) => [r[1], r[2] ?? '']));
    };
    /** The groups every analysis-menu run reads. */
    const menuGroups = (docs: SequenceDocument[]) => {
      const r = analysisRows(docs, { gaps: 'pairwise', coveragePct: 95, pos1: true, pos2: true, pos3: true });
      return new Map(r.names.map((n, i) => [n, r.groups[i]]));
    };
    // An alignment the user gave, and the same CDSs unaligned (both callers then align them first).
    const given = labelled(members);
    const raw = labelled(members.map((m) => ({ ...m, sequence: m.sequence.replace(/-/g, '') })));
    expect(isPreAlignedInputSet(given)).toBe(true);
    expect(isPreAlignedInputSet(raw)).toBe(false);
    for (const docs of [given, raw]) {
      expect(menuGroups(docs)).toEqual(expected);
      expect(studioGroups(docs)).toEqual(expected);
    }
  });
  it('models rscu reads a frame-2 translation alignment in frame', () => {
    const bodies = ['ATGAAACCCGGGTTT', 'ATGAAGCCAGGGTTC', 'ATGAAACCCGGATTT', 'ATGCAACCCGGGTAT'];
    const inputs = bodies.map((b, i) => ({ id: `t${i}`, name: `t${i}`, sequence: 'CTGA'[i] + b + ['GC', '', 'TA', ''][i] }));
    const res = translationAlign(inputs, 2, 'Standard', '');
    expect(res.error).toBeNull();
    const doc = (id: string, sequence: string) => ({ ...members[0], id, name: id, sequence } as SequenceDocument);
    const frame2 = rscuCounts(res.rows.map((r) => doc(r.id, r.nucleotide)));
    const frame1 = rscuCounts(bodies.map((b, i) => doc(`f${i}`, b)));
    expect(frame2.summary).toBe('Codon usage of 20 codons');
    expect(frame2.counts).toEqual(frame1.counts);
  });
  it('refuses protein data for nucleotide-only analyses', () => {
    const prot = members.map((m) => ({ ...m, moleculeType: 'Protein' as const }));
    expect(() => runEvolutionAnalysis(prot, 'selection', { test: 'z-neutral' }, ctx)).toThrow(/nucleotide/);
  });
});

/**
 * What the Align dialog tells the user a preset will run, and what the result document records as
 * its `Alignment method`, read off the engine's own dispatch rather than trusted (BG-01M6XRZ8).
 * Every fact asserted about a preset's text is derived here from
 * crates/molbiocraft-align/src/poa_and_banded.rs, so moving a preset's route without its text -
 * or its text without the route - fails instead of leaving a false provenance claim [LC-002].
 */
describe('MSA preset descriptions', () => {
  /** The algorithm keys a `contains("…")` guard in the dispatch matches on. */
  const guardKeys = (guard: string) => [...guard.matchAll(/contains\("([A-Z-]+)"\)/g)].map((m) => m[1]);
  const group = (re: RegExp, text: string, what: string) => {
    const m = re.exec(text);
    expect(m, `the dispatch still ${what}`).not.toBeNull();
    return m![1];
  };

  it('each MSA preset description names the route the engine takes', () => {
    const body = group(/(pub fn run_multiple_sequence_alignment_with_algorithm\([\s\S]*?\n\}\n)/, msaDispatchRs,
      'holds run_multiple_sequence_alignment_with_algorithm');
    // Which preset names select the UPGMA guide tree, the POA backbone, and the consistency library.
    const upgma = guardKeys(group(/let tree = if ([\s\S]*?)\{\s*MsaTreeBuilder::Upgma/, body, 'picks a guide tree by preset'));
    const poa = guardKeys(group(/let matrix = if ([^{]*)\{/, body, 'picks the POA backbone by preset'));
    const consistency = guardKeys(group(/let consistency = ([^;]+);/, body, 'picks the consistency library by preset'));
    expect([upgma, poa, consistency].map((k) => k.length)).toEqual([2, 1, 2]);
    // The consistency library runs only under a sequence-count gate; above it the progressive route does.
    const maxSeqs = group(/if consistency && n <= (\d+)/, body, 'gates the consistency library on the sequence count');
    expect(body, 'the progressive route is still the fallback above the gate').toContain('progressive_msa(&upper, is_prot, opts)');
    // The center-star result is computed and discarded on every non-POA route.
    // Anchored, so a commented-out discard reads as the discard being gone rather than as itself.
    expect(body, 'the non-POA route still discards the center-star result').toMatch(/^\s*let _ = star;\s*$/m);
    const passes = /consistency_msa\(&upper, is_prot, if algo_upper\.contains\("([A-Z-]+)"\) \{ (\d+) \} else \{ (\d+) \}\)/.exec(body);
    expect(passes, 'the consistency library still takes a refinement-pass count per preset').not.toBeNull();
    const progressivePasses = group(/refine_passes: (\d+)/, body, 'names the progressive route\'s refinement passes');
    // An empty preset never reaches that function: the shipped op sends it to plain center-star.
    expect(wasmRpcRs).toMatch(/if algorithm\.is_empty\(\) \{\s*to_val\(run_multiple_sequence_alignment\(/);
    expect(group(/(pub fn run_multiple_sequence_alignment\([\s\S]*?\n\}\n)/, centerStarRs, 'defines run_multiple_sequence_alignment'))
      .toMatch(/run_center_star_msa\(docs, max_seq_len, MsaTreeBuilder::NeighborJoining\)/);

    expect(MSA_ALGORITHMS).toHaveLength(5);
    for (const o of MSA_ALGORITHMS) {
      const text = `${o.label} ${o.hint}`;
      const where = `${o.value || '(default)'}`;
      const up = o.value.toUpperCase();
      const selects = (keys: string[]) => keys.some((k) => up.includes(k));
      if (!o.value) {
        // Plain center-star with a Neighbor-Joining tree.
        expect(text, `${where} names center-star`).toMatch(/center-star/i);
        expect(text, `${where} names its tree`).toMatch(/neighbor-joining/i);
        continue;
      }
      expect(text, `${where} names its guide tree`).toMatch(selects(upgma) ? /UPGMA/ : /neighbor-joining/i);
      if (selects(poa)) {
        expect(text, `${where} names the partial-order backbone`).toMatch(/partial-order/i);
        expect(text, `${where} names the center-star fallback it is scored against`).toMatch(/center-star/i);
        continue;
      }
      // Every other preset leaves the center-star result unused, so no text may claim it.
      expect(text, `${where} must not claim center-star alignment`).not.toMatch(/center-star/i);
      if (selects(consistency)) {
        expect(text, `${where} names the consistency library`).toMatch(/consistency/i);
        expect(text, `${where} names its refinement passes`)
          .toContain(`${up.includes(passes![1]) ? passes![2] : passes![3]} refinement passes`);
        expect(text, `${where} names the progressive fallback`).toMatch(/falls back[\s\S]*progressive/i);
        expect(text, `${where} names the size gate`).toContain(maxSeqs);
      } else {
        expect(text, `${where} names the progressive route`).toMatch(/progressive/i);
        expect(text, `${where} names its refinement passes`).toContain(`${progressivePasses} refinement passes`);
        expect(text, `${where} must not claim the consistency library`).not.toMatch(/consistency/i);
      }
    }
  });

  it('each preset identifier is a stable non-displayed key that selects its route', () => {
    const canonBody = group(/(pub fn canonical_msa_preset_key\([\s\S]*?\n\}\n)/, msaDispatchRs,
      'defines canonical_msa_preset_key');
    const nonEmpty = MSA_ALGORITHMS.filter((o) => o.value !== '');
    expect(nonEmpty.map((o) => o.value)).toEqual([
      'consistency-nj',
      'consistency-upgma',
      'progressive-upgma',
      'graph-backbone',
    ]);
    expect(Object.keys(MSA_PRESET_INFO).sort()).toEqual(nonEmpty.map((o) => o.value).sort());

    const raw = members.slice(0, 4).map((m) => ({ ...m, sequence: m.sequence.slice(0, 60).replace(/-/g, '') }));
    for (const o of nonEmpty) {
      expect(o.value).not.toBe(o.label);
      expect(o.value).not.toMatch(/^(MAFFT|MUSCLE|Clustal Omega|POA)/i);
      expect(canonBody).toContain(`"${o.value.toUpperCase()}"`);
      const studioEntry = MSA_PRESET_INFO[o.value as keyof typeof MSA_PRESET_INFO];
      expect(studioEntry.label).not.toBe(o.value);
      // Running an alignment or analysis with the identifier records the human label as provenance,
      // never the internal identifier.
      const alnDoc = runMultipleAlignment(raw, { algorithm: o.value }, ctx).created[0];
      expect(alnDoc.docMetadata?.['Alignment method']).toBe(o.label);
      expect(alnDoc.description).toContain(o.label);
      expect(alnDoc.description).not.toContain(o.value);
    }
  });

  it('legacy preset values saved by earlier versions select the same preset and route', () => {
    const canonBody = group(/(pub fn canonical_msa_preset_key\([\s\S]*?\n\}\n)/, msaDispatchRs,
      'defines canonical_msa_preset_key');
    const legacyPairs: [string, string, string][] = [
      ['MAFFT (FFT-NS-i / L-INS-i)', 'consistency-nj', 'MAFFT'],
      ['MUSCLE (Iterative)', 'consistency-upgma', 'MUSCLE'],
      ['Clustal Omega (HMM)', 'progressive-upgma', 'CLUSTAL'],
      ['POA (rust-bio Partial-Order Graph)', 'graph-backbone', 'POA'],
    ];
    const raw = members.slice(0, 4).map((m) => ({ ...m, sequence: m.sequence.slice(0, 60).replace(/-/g, '') }));
    for (const [legacy, id, rustToken] of legacyPairs) {
      expect(normalizeMsaPresetId(legacy)).toBe(id);
      expect(normalizeMsaPresetId(id)).toBe(id);
      expect(msaAlgo(legacy)).toEqual(msaAlgo(id));
      expect(msaAlgo(legacy).value).toBe(id);
      expect(canonBody).toMatch(new RegExp(`upper\\.contains\\("${id.toUpperCase()}"\\)\\s*\\|\\|\\s*upper\\.contains\\("${rustToken}"\\)`));

      const fromLegacy = runMultipleAlignment(raw, { algorithm: legacy }, ctx).created[0];
      const fromId = runMultipleAlignment(raw, { algorithm: id }, ctx).created[0];
      expect(fromLegacy.docMetadata?.['Alignment method']).toBe(fromId.docMetadata?.['Alignment method']);
      expect(fromLegacy.description).toBe(fromId.description);

      const trLegacy = runTranslationAlign(raw, { algorithm: legacy, frame: 1 }, ctx).created[0];
      const trId = runTranslationAlign(raw, { algorithm: id, frame: 1 }, ctx).created[0];
      expect(trLegacy.description).toBe(trId.description);

      const evoLegacy = String(runEvolutionAnalysis(raw, 'diversity', { alignFirst: legacy }, ctx).created[0].docMetadata?.Notes);
      const evoId = String(runEvolutionAnalysis(raw, 'diversity', { alignFirst: id }, ctx).created[0].docMetadata?.Notes);
      expect(evoLegacy.split('\n').find((l) => l.startsWith('Data: '))).toBe(evoId.split('\n').find((l) => l.startsWith('Data: ')));

      const studioLegacy = renderToStaticMarkup(
        React.createElement(SequenceAlignmentStudio, { documents: raw, activeDoc: raw[0], initialSubMode: 'msa', initialMsaAlgorithm: legacy as never }),
      );
      const studioId = renderToStaticMarkup(
        React.createElement(SequenceAlignmentStudio, { documents: raw, activeDoc: raw[0], initialSubMode: 'msa', initialMsaAlgorithm: id as never }),
      );
      expect(studioLegacy).toMatch(new RegExp(`<option value="${id}"[^>]*selected=""`));
      expect(studioId).toMatch(new RegExp(`<option value="${id}"[^>]*selected=""`));
      expect(studioLegacy).toContain(`<strong>${MSA_PRESET_INFO[id as keyof typeof MSA_PRESET_INFO].label}</strong>`);
      expect(studioId).toContain(`<strong>${MSA_PRESET_INFO[id as keyof typeof MSA_PRESET_INFO].label}</strong>`);
    }
  });
});
