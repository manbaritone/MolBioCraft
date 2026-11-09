// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Models, Diversity, Selection, Rates, Ancestors and Clocks analyses as operations:
 * options in, a Text Document report out (with tab-separated tables for spreadsheets).
 * The statistics come from the Rust engine (`phyloEvoEngine`).
 */

import {
  computeNucleotideCompositionByCodonPos, computePopulationDiversity, computeRelativeSynonymousCodonUsage,
  computeSubstitutionRateMatrix, estimateGammaAndSiteRates, findBestSubstitutionModels, fmtP, fmtStat,
  inferAncestralSequences, runMolecularClockAndTimetree, runSelectionAndNeutralityTests,
  type SubstitutionModelName,
} from './phyloEvoEngine';
import { isPreAlignedInputSet } from './documentViews';
import { analysisRows, type OperationResult, type RunContext } from './operationRunners';
import type { OptionValues } from './optionProfiles';
import type { SequenceDocument } from '../types/bio';

// The engine returns each list's total beside it (models_selection.rs, BG-01M6S1GB). The report
// types in phyloEvoEngine.ts do not declare the totals, so they are declared here, once, for every
// reader of those reports.
declare module './phyloEvoEngine' {
  interface AncestralReconstructionReport {
    /** Internal nodes of the tree: the length of the complete `nodes` list. */
    totalInternalNodes: number;
    /** Alignment columns: the length of the complete `siteEvolutionaryProbabilities` list. */
    totalSites: number;
  }
  interface SelectionAndNeutralityReport {
    /** Variable codons: the length of the complete `codonSiteSelection` list. */
    totalVariableCodons: number;
  }
  interface SiteRatesReport {
    /** Alignment columns: the length of the complete `siteRates` list. */
    totalSites: number;
  }
  interface MolecularClockAndTimetreeReport {
    /** Internal nodes of the timetree: the length of the complete `divergenceNodes` list. */
    totalInternalNodes: number;
  }
}

export type EvoAnalysis = 'models' | 'diversity' | 'selection' | 'rates' | 'ancestors' | 'clocks';

export const EVO_ANALYSIS_TITLES: Record<EvoAnalysis, string> = {
  models: 'Models',
  diversity: 'Diversity',
  selection: 'Selection',
  rates: 'Site Rates',
  ancestors: 'Ancestral Sequences',
  clocks: 'Molecular Clock Tests',
};

export const MODEL_ANALYSES: Record<string, string> = {
  best: 'Find best substitution models (ML)',
  matrix: 'Substitution pattern (rate matrix, Ts/Tv)',
  disparity: 'Pattern homogeneity (disparity index test)',
  composition: 'Nucleotide composition (by codon position)',
  rscu: 'Codon usage (RSCU)',
};

const f = (x: number | null | undefined, d = 4) => fmtStat(x ?? null, d);
const pct = (x: number | null | undefined) => fmtStat(x ?? null, 1);

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A table as aligned text plus a tab-separated copy. */
function table(header: string[], rows: (string | number)[][]): string[] {
  const cells = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, c) => Math.min(40, Math.max(...cells.map((r) => (r[c] ?? '').length))));
  const line = (r: string[]) => r.map((x, c) => (c === 0 ? x.padEnd(widths[c]) : x.padStart(widths[c]))).join('  ');
  return [line(cells[0]), line(widths.map((w) => '-'.repeat(w))), ...cells.slice(1).map(line)];
}
function tsv(header: string[], rows: (string | number)[][]): string[] {
  return ['', 'Tab-separated, for spreadsheets:', '', header.join('\t'), ...rows.map((r) => r.join('\t'))];
}

/**
 * The sentence that states how much of a list the report holds, from the engine's total: every
 * row, the first rows of a longer list, none (an analysis that could not run), or (an engine that
 * sends no total) the rows alone.
 */
function listedSentence(shown: number, total: number | undefined, noun: string): string {
  const n = (v: number) => v.toLocaleString('en-US');
  if (typeof total !== 'number' || !Number.isFinite(total)) return `${n(shown)} ${noun} are listed; the engine did not report how many there are.`;
  if (shown === 0 && total === 0) return `No ${noun} are listed.`;
  return shown < total ? `The first ${n(shown)} of ${n(total)} ${noun} are listed.` : `All ${n(shown)} ${noun} are listed.`;
}

/** A list's count for a summary line: "63", or "60 of 63" when the engine listed fewer than its total. */
function shownOf(shown: number, total: number | undefined): string {
  const n = (v: number) => v.toLocaleString('en-US');
  return typeof total === 'number' && shown < total ? `${n(shown)} of ${n(total)}` : n(shown);
}

/**
 * Whether an alignment has a coding width (a positive multiple of 3 columns).
 * When `ownFrame` is true (codon usage on unaligned inputs, which reads each sequence
 * on its own in triplets from its first base), no alignment width gate applies.
 * Returns the refusal sentence when the width is not a multiple of 3, or null when valid (BG-01M6XS4G).
 */
export function codingAlignmentRefusal(
  seqs: readonly string[],
  kind: 'rscu' | 'selection',
  opts?: { ownFrame?: boolean },
): string | null {
  if (kind === 'rscu' && opts?.ownFrame) return null;
  if (seqs.length > 0 && seqs[0].length % 3 === 0) return null;
  return kind === 'rscu'
    ? 'Codon usage needs a coding alignment whose length is a multiple of 3.'
    : 'Selection tests need a coding alignment whose length is a multiple of 3 (codons from column 1).';
}

export function runEvolutionAnalysis(inputs: SequenceDocument[], kind: EvoAnalysis, v: OptionValues, ctx: RunContext): OperationResult {
  if (inputs.length < (kind === 'clocks' ? 3 : 2)) throw new Error(`Select at least ${kind === 'clocks' ? 3 : 2} sequences (or an alignment).`);
  const protein = inputs[0]?.moleculeType === 'Protein';
  // Codon-based analyses keep every column so the reading frame stays intact.
  const codonBased = kind === 'selection' || (kind === 'models' && v.analysis === 'rscu');
  // Codon usage is a per-sequence count that needs no alignment. Inputs that are not already
  // aligned would be aligned here with the nucleotide aligner, which puts gaps inside codon slots,
  // so each one is read on its own instead: its ungapped sequence in triplets from its first base
  // (BG01M6XBAC, D0097). Codon usage takes no site subset, so none applies on either path.
  const ownFrame = kind === 'models' && v.analysis === 'rscu' && !isPreAlignedInputSet(inputs);
  const { names, seqs, groups, note } = ownFrame
    ? {
      names: inputs.map((d) => d.name),
      seqs: inputs.map((d) => d.sequence.replace(/[-.\s]/g, '').toUpperCase()),
      groups: [] as string[],
      note: 'unaligned inputs, each read on its own in triplets from its first base',
    }
    : analysisRows(inputs, codonBased ? { ...v, gaps: 'pairwise', pos1: true, pos2: true, pos3: true } : v);
  const title = String(v.resultName ?? '').trim() || `${ctx.sourceLabel} ${EVO_ANALYSIS_TITLES[kind].toLowerCase()}`;
  const out: string[] = [`# ${title}`, '', `Data: ${note}`, `Sequences: ${names.length}`, ''];
  const meta: Record<string, string | number> = {};
  let summary = '';
  const needDna = (what: string) => { if (protein) throw new Error(`${what} needs nucleotide sequences.`); };

  if (kind === 'models') {
    const what = String(v.analysis ?? 'best');
    out.push(`## ${MODEL_ANALYSES[what] ?? what}`, '');
    if (what === 'best') {
      // proteins: LG / WAG / JTT (± Γ) on the NJ topology
      const rows = [...findBestSubstitutionModels(seqs)].sort((a, b) => a.bic - b.bic);
      const header = protein ? ['Model', 'Parameters', 'BIC', 'AICc', 'lnL', 'Gamma (+G)'] : ['Model', 'Parameters', 'BIC', 'AICc', 'lnL', 'Gamma (+G)', 'Invariant (+I)', 'Ts/Tv (R)'];
      const body = rows.map((r) => {
        const row: (string | number)[] = [r.model, r.parametersK, r.bic.toFixed(2), r.aicc.toFixed(2), r.logLikelihood.toFixed(2), r.gammaShapeAlpha];
        return protein ? row : [...row, r.invariantSitesI, Number.isFinite(r.tiTvRatioR) ? r.tiTvRatioR.toFixed(2) : 'n/a'];
      });
      out.push(...table(header, body), '', 'Models are ranked by BIC (lowest is best). AICc is given for comparison.', ...tsv(header, body));
      if (rows[0]) { meta['Best model (BIC)'] = rows[0].model; summary = `Best model by BIC: ${rows[0].model}`; }
    } else if (what === 'matrix') {
      needDna('The substitution pattern');
      const r = computeSubstitutionRateMatrix(names, seqs);
      const header = ['From', 'A', 'T', 'C', 'G'];
      const body = r.matrix4x4.map((m) => [m.from, f(m.toA, 2), f(m.toT, 2), f(m.toC, 2), f(m.toG, 2)]);
      out.push('Rates of instantaneous substitution r(ij) in %; off-diagonal entries sum to 100.', '', ...table(header, body), '',
        `Transition/transversion rate ratios: purines k1 = ${f(r.purineKappa1, 3)}, pyrimidines k2 = ${f(r.pyrimidineKappa2, 3)}`,
        `Overall transition/transversion bias R = ${f(r.overallTiTvRatioR, 3)}`, ...tsv(header, body));
      meta['Ts/Tv bias R'] = f(r.overallTiTvRatioR, 3);
      summary = `Ts/Tv bias R = ${f(r.overallTiTvRatioR, 3)}`;
    } else if (what === 'disparity') {
      needDna('The disparity index test');
      const r = computeSubstitutionRateMatrix(names, seqs);
      const header = ['Sequence A', 'Sequence B', 'Disparity index ID', 'P-value'];
      const body = r.disparityPairs.map((p) => [p.taxonA, p.taxonB, f(p.disparityIndexId, 4), fmtP(p.pValue)]);
      const sig = r.disparityPairs.filter((p) => p.pValue !== null && p.pValue < 0.05).length;
      out.push('Kumar & Gadagkar (2001) test of the homogeneity of substitution patterns between sequences.', `${sig} of ${r.disparityPairs.length} pairs reject homogeneity at P < 0.05.`, '', ...table(header, body), ...tsv(header, body));
      meta['Pairs rejecting homogeneity'] = `${sig} of ${r.disparityPairs.length}`;
      summary = `${sig} of ${r.disparityPairs.length} pairs reject pattern homogeneity (P < 0.05)`;
    } else if (what === 'composition') {
      needDna('Nucleotide composition');
      const rows = computeNucleotideCompositionByCodonPos(names, seqs);
      const header = ['Sequence', 'Length', 'T%', 'C%', 'A%', 'G%', 'GC%', 'GC1%', 'GC2%', 'GC3%'];
      const body = rows.map((r) => [r.taxonName, r.lengthBp, pct(r.pctT), pct(r.pctC), pct(r.pctA), pct(r.pctG), pct(r.pctGC), pct(r.pctGC1), pct(r.pctGC2), pct(r.pctGC3)]);
      out.push(...table(header, body), ...tsv(header, body));
      summary = `Composition of ${rows.length} sequences`;
    } else if (what === 'rscu') {
      needDna('Codon usage');
      // The width gate is for an alignment read by column. Unaligned inputs are read one by one
      // from their first base, where a trailing partial codon (as in mitochondrial CDSs) is no codon.
      const refusal = codingAlignmentRefusal(seqs, 'rscu', { ownFrame });
      if (refusal) throw new Error(refusal);
      const rows = computeRelativeSynonymousCodonUsage(seqs);
      const header = ['Codon', 'Amino acid', 'Count', 'Per thousand', 'RSCU'];
      const body = rows.map((r) => [r.codon, r.aminoAcid, r.count, r.frequencyPerThousand.toFixed(1), r.rscu.toFixed(2)]);
      out.push('RSCU > 1: codon used more often than expected under uniform synonymous usage.', '', ...table(header, body), ...tsv(header, body));
      summary = `Codon usage of ${rows.reduce((s, r) => s + r.count, 0).toLocaleString()} codons`;
    }
  } else if (kind === 'diversity') {
    const model = String(v.model ?? 'Maximum Composite Likelihood (MCL)') as SubstitutionModelName;
    const g = groups.some(Boolean) ? groups : [];
    const r = computePopulationDiversity(names, seqs, model, g);
    out.push(`Model: ${model}`, `Groups: ${g.length ? new Set(g.filter(Boolean)).size : 'none (between-population statistics need groups)'}`, '', '## Nei (1987) diversity', '');
    const header = ['Statistic', 'Value', 'SE'];
    const body: (string | number)[][] = [
      ['Mean diversity within subpopulations (πS)', f(r.withinSubpopulationPiS), f(r.withinSubpopulationSE)],
      ['Mean diversity for the entire population (πT)', f(r.entirePopulationPiT), f(r.entirePopulationSE)],
      ['Mean interpopulational diversity (δST)', f(r.interpopulationDiversityDeltaST), f(r.interpopulationSE)],
      ['Coefficient of differentiation (GST / NST)', f(r.coefficientOfDifferentiationGst), f(r.coefficientSE)],
      ['Haplotype diversity (Hd)', f(r.haplotypeDiversityHd), f(r.haplotypeDiversitySE)],
    ];
    out.push(...table(header, body), ...tsv(header, body));
    meta['πT'] = f(r.entirePopulationPiT);
    summary = `πT = ${f(r.entirePopulationPiT)}, Hd = ${f(r.haplotypeDiversityHd)}`;
  } else if (kind === 'selection') {
    needDna('Selection tests');
    const refusal = codingAlignmentRefusal(seqs, 'selection');
    if (refusal) throw new Error(refusal);
    const r = runSelectionAndNeutralityTests(seqs);
    const test = String(v.test ?? 'z-neutral');
    if (test.startsWith('z-')) {
      const z = test === 'z-positive' ? r.zTestPositive : test === 'z-purifying' ? r.zTestPurifying : r.zTestNeutrality;
      const hyp = test === 'z-positive' ? 'positive selection (dN > dS)' : test === 'z-purifying' ? 'purifying selection (dN < dS)' : 'neutrality (dN = dS)';
      out.push(`## Codon-based Z-test of selection, overall average (H1: ${hyp})`, '',
        `dN = ${f(r.dN)}   dS = ${f(r.dS)}   dN/dS = ${f(r.omegaDnDs, 3)}`,
        `Z statistic = ${f(z.zStat, 3)}   P = ${fmtP(z.pValue)}   ${z.zStat === null || z.pValue === null ? 'test not computable (see notes)' : z.significant ? 'significant at 5%' : 'not significant at 5%'}`);
      summary = `Z-test (${hyp}): Z = ${f(z.zStat, 3)}, P = ${fmtP(z.pValue)}`;
      meta['P-value'] = fmtP(z.pValue);
    } else if (test === 'fisher') {
      out.push("## Fisher's exact test of neutrality (small samples)", '', `P = ${fmtP(r.fisherExactPValue)}  (dN = ${f(r.dN)}, dS = ${f(r.dS)})`);
      summary = `Fisher's exact test: P = ${fmtP(r.fisherExactPValue)}`;
      meta['P-value'] = fmtP(r.fisherExactPValue);
    } else if (test === 'tajima') {
      const t = r.tajimaNeutrality;
      const header = ['m', 'S', 'ps', 'Θ (Watterson)', 'π', 'D'];
      const body = [[t.sampleSizeM, t.segregatingSitesS, f(t.psProportion), f(t.thetaWatterson), f(t.nucleotideDiversityPi), f(t.tajimaD, 4)]];
      out.push("## Tajima's (1989) neutrality test", '', ...table(header, body), '', t.interpretation, ...tsv(header, body));
      summary = `Tajima's D = ${f(t.tajimaD, 4)}`;
      meta["Tajima's D"] = f(t.tajimaD, 4);
    } else {
      const rows = r.codonSiteSelection;
      const header = ['Codon', 'Codons observed', 'Amino acids', 'pN − pS', 'Regime'];
      const body = rows.map((c) => [c.codonIndex, c.codonsObserved, c.aminoAcidsObserved, c.dNMinusDS.toFixed(3), c.selectionRegime]);
      out.push('## Codon-by-codon pN − pS (pair-averaged; descriptive, not a per-site test)', '',
        listedSentence(rows.length, r.totalVariableCodons, 'variable codons'), '', ...table(header, body), ...tsv(header, body));
      summary = `${shownOf(rows.length, r.totalVariableCodons)} variable codons`;
    }
    if (r.notes.length) out.push('', 'Notes:', ...r.notes.map((x) => `- ${x}`));
  } else if (kind === 'rates') {
    const k = Math.max(2, Math.min(16, Number(v.categories ?? 5)));
    const r = estimateGammaAndSiteRates(seqs, k);
    out.push('## Discrete gamma rate heterogeneity', '', `Gamma shape α = ${f(r.gammaShapeAlpha, 3)} with ${r.numCategories} categories`, '');
    const h1 = ['Category', 'Relative rate', 'Probability'];
    const b1 = r.categoryRates.map((c) => [c.category, c.relativeRate.toFixed(3), c.probability.toFixed(3)]);
    out.push(...table(h1, b1), '', '## Relative rate of each site', '', listedSentence(r.siteRates.length, r.totalSites, 'sites'), '');
    const h2 = ['Site', 'Relative rate', 'Entropy (bits)', 'Category'];
    const b2 = r.siteRates.map((s) => [s.position, s.relativeRate.toFixed(3), s.entropyBits.toFixed(3), s.rateCategory]);
    out.push(...table(h2, b2), '', r.note, ...tsv(h2, b2));
    meta['Gamma shape α'] = f(r.gammaShapeAlpha, 3);
    summary = `Gamma shape α = ${f(r.gammaShapeAlpha, 3)} (${r.numCategories} categories)`;
  } else if (kind === 'ancestors') {
    needDna('Ancestral reconstruction');
    const method = v.method === 'mp' ? 'Maximum Parsimony (Fitch)' : 'Maximum Likelihood (Empirical Bayes)';
    const r = inferAncestralSequences(names, seqs, method);
    const nodesListed = listedSentence(r.nodes.length, r.totalInternalNodes, 'internal nodes');
    out.push(`## ${r.method}`, '', nodesListed, '');
    const header = ['Node', 'Descendants', 'Mean confidence'];
    // The engine reports the confidence as a percent already, rounded to 0.1.
    const body = r.nodes.map((n) => [n.nodeName, n.descendants, n.meanPosteriorConfidence === null ? 'n/a' : `${n.meanPosteriorConfidence.toFixed(1)}%`]);
    out.push(...table(header, body), '', '## Ancestral sequences (FASTA)', '', nodesListed, '',
      ...r.nodes.flatMap((n) => [`>${n.nodeName.replace(/\s+/g, '_')}`, ...(n.ancestralSequence.match(/.{1,70}/g) ?? [''])]));
    if (v.siteProbabilities) {
      const h2 = ['Site', 'Consensus', 'P(A)', 'P(C)', 'P(G)', 'P(T)', 'Root state'];
      const b2 = r.siteEvolutionaryProbabilities.map((s) => [s.position, s.consensusState, s.probA.toFixed(3), s.probC.toFixed(3), s.probG.toFixed(3), s.probT.toFixed(3), s.ancestralStateRoot]);
      out.push('', '## Root state probabilities per site', '', listedSentence(b2.length, r.totalSites, 'sites'), '', ...tsv(h2, b2).slice(3));
    }
    summary = `${shownOf(r.nodes.length, r.totalInternalNodes)} ancestral nodes reconstructed`;
    meta['Ancestral nodes'] = shownOf(r.nodes.length, r.totalInternalNodes);
  } else if (kind === 'clocks') {
    needDna('Clock tests');
    const r = runMolecularClockAndTimetree(names, seqs, 'RelTime-ML', 1);
    const test = String(v.test ?? 'ml');
    if (test === 'ml') {
      const c = r.clockTestML;
      out.push('## Molecular clock test (ML likelihood ratio)', '', `lnL with clock = ${f(c.lnLWithClock, 3)}`, `lnL without clock = ${f(c.lnLWithoutClock, 3)}`,
        `2ΔlnL = ${f(c.twoDeltaLnL, 3)} with ${c.degreesOfFreedom} degrees of freedom, P = ${fmtP(c.pValue)}`, '',
        c.clockRejected ? 'The molecular clock is rejected at the 5% level.' : 'The molecular clock is not rejected at the 5% level.');
      summary = `Clock ${c.clockRejected ? 'rejected' : 'not rejected'} (P = ${fmtP(c.pValue)})`;
      meta['Clock test P'] = fmtP(c.pValue);
    } else {
      const t = r.tajimaRelativeRate;
      const header = ['Statistic', 'Value'];
      const body = [['Sequence A', t.taxonA], ['Sequence B', t.taxonB], ['Outgroup C', t.outgroupC], ['Identical sites in all three', t.identicalSites],
        ['Unique differences in A (m1)', t.uniqueToA_m1], ['Unique differences in B (m2)', t.uniqueToB_m2], ['χ²', f(t.chiSquare, 3)], ['P-value', fmtP(t.pValue)]];
      out.push("## Tajima's (1993) relative rate test", '', ...table(header, body), '', t.equalRatesAccepted ? 'Equal rates in A and B are not rejected.' : 'Equal rates in A and B are rejected at the 5% level.');
      summary = `Relative rate test: χ² = ${f(t.chiSquare, 3)}, P = ${fmtP(t.pValue)}`;
    }
    const extra = r.notes.filter((x) => !/calibrat/i.test(x));
    if (extra.length) out.push('', 'Notes:', ...extra.map((x) => `- ${x}`));
  }

  const t = new Date().toISOString();
  const doc: SequenceDocument = {
    id: uid('evo'),
    name: title,
    accession: '',
    description: `${EVO_ANALYSIS_TITLES[kind]}: ${summary}`,
    moleculeType: inputs[0].moleculeType,
    topology: 'linear',
    sequence: '',
    features: [],
    primers: [],
    docMetadata: { 'Document Type': 'Text Document', Notes: out.join('\n') + '\n', Analysis: EVO_ANALYSIS_TITLES[kind], ...meta },
    history: [{ id: uid('hist'), timestamp: t, operation: EVO_ANALYSIS_TITLES[kind], description: `${summary}; ${note}`, parentIds: inputs.map((d) => d.id), lengthBp: 0, topology: 'linear' }],
    createdAt: t,
    updatedAt: t,
    folder: (ctx.folder ?? inputs[0].folder ?? 'Alignments') as SequenceDocument['folder'],
  };
  return { created: [doc], updated: [], summary };
}
