// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { runBuildTree } from '../core/operationRunners';
import { leafNames, parseNewick, toNewick } from '../core/treeConsensus';
import { midpointRoot } from '../core/treeLayout';
import { fromTreeNode, splitsOf } from '../core/treeSearch';
import type { PhyloTreeInferenceReport } from '../core/phyloEvoEngine';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

/** Every report the tree engine hands back, recorded as the studio receives it (the engine itself runs). */
const engineReports = vi.hoisted(() => [] as { algorithm: string; report: PhyloTreeInferenceReport }[]);
vi.mock('../core/phyloEvoEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../core/phyloEvoEngine')>();
  return {
    ...real,
    constructPhylogeneticTree: (...args: Parameters<typeof real.constructPhylogeneticTree>) => {
      const report = real.constructPhylogeneticTree(...args);
      engineReports.push({ algorithm: String(args[2]), report });
      return report;
    },
  };
});

const aln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
const members: SequenceDocument[] = aln.alignmentMeta!.sequences!.slice(0, 12).map((m, i) => ({
  ...aln, id: `m${i}`, name: m.name, sequence: m.sequence, alignmentMeta: undefined, features: [], documentKind: undefined,
} as SequenceDocument));

describe('Build Tree: built-in maximum likelihood', () => {
  it('saves an ML tree with its likelihood, model parameters and bootstrap support', async () => {
    const r = await runBuildTree(members, { method: 'Maximum Likelihood (ML)', mlModel: 'HKY', mlGamma: true, resampling: 'bootstrap', replicates: 5 }, { sourceLabel: 'COXII' });
    const doc = r.created[0];
    const meta = doc.docMetadata!;
    expect(String(meta['Tree method'])).toMatch(/Maximum Likelihood \(NNI search\), HKY\+G/);
    expect(Number(meta['ML log likelihood'])).toBeGreaterThanOrEqual(Number(meta['Starting tree ln L (NJ)']));
    expect(String(meta['Model parameters'])).toMatch(/Γ shape α = /);
    expect(String(meta['Branch support'])).toMatch(/bootstrap, 5 replicates/);
    const tree = parseNewick(String(meta.Newick));
    expect(leafNames(tree)).toHaveLength(12);
    expect(String(meta.Newick)).toMatch(/\)\d+:/);
  }, 120000);
  it('builds protein trees with the built-in LG / WAG / JTT models (no external program)', async () => {
    const globins = [
      ['HBB_HUMAN', 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH'],
      ['HBB_HORSE', 'VQLSGEEKAAVLALWDKVNEEEVGGEALGRLLVVYPWTQRFFDSFGDLSNPGAVMGNPKVKAHGKKVLHSFGEGVHHLDNLKGTFAALSELHCDKLHVDPENFRLLGNVLVVVLARHFGKDFTPELQASYQKVVAGVANALAHKYH-'],
      ['HBA_HUMAN', 'VLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHF-DLSH-----GSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR--'],
      ['HBA_HORSE', 'VLSAADKTNVKAAWSKVGGHAGEYGAEALERMFLGFPTTKTYFPHF-DLSH-----GSAQVKAHGKKVGDALTLAVGHLDDLPGALSNLSDLHAHKLRVDPVNFKLLSHCLLSTLAVHLPNDFTPAVHASLDKFLSSVSTVLTSKYR--'],
      ['MYG_HUMAN', 'GLSDGEWQLVLNVWGKVEADIPGHGQEVLIRLFKGHPETLEKFDKFKHLKSEDEMKASEDLKKHGATVLTALGGILKKKGHHEAEIKPLAQSHATKHKIPVKYLEFISECIIQVLQSKHPGDFGADAQGAMNKALELFRKDMASNYKELG'],
    ].map(([name, sequence]) => ({ ...members[0], id: name, name, sequence, moleculeType: 'Protein' as const }));
    for (const model of ['LG', 'WAG', 'JTT']) {
      const r = await runBuildTree(globins, { method: 'Maximum Likelihood (ML)', mlProteinModel: model, preAligned: true }, { sourceLabel: 'x' });
      const meta = r.created[0].docMetadata ?? {};
      expect(String(meta.Newick)).toContain('MYG_HUMAN');
      expect(JSON.stringify(meta)).toContain(model);
    }
  }, 120000);
});

// ─── US-01M6P2HD: Maximum Likelihood runs the ML search wherever it is offered (D0003, D0205, D0206) ───

/** Deterministic letters (LCG), so every run reads the same sequence. */
function lettersFrom(seed: number, n: number): string {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[Math.floor((x / 2 ** 32) * 4)];
  }
  return out;
}
/** `seq` with the base at each 1-based column in `cols` moved one step along ACGT. */
function substituted(seq: string, cols: number[]): string {
  const out = seq.split('');
  for (const c of cols) out[c - 1] = 'ACGT'[('ACGT'.indexOf(out[c - 1]) + 1) % 4];
  return out.join('');
}
const cols = (from: number, step: number, count: number) => Array.from({ length: count }, (_, i) => from + i * step);
const ROOT = lettersFrom(0x2d4b, 240);
const A = substituted(ROOT, cols(3, 23, 10));
const B = substituted(ROOT, cols(11, 21, 10));
/** Eight members: two clades of four, each of two pairs, with uneven branches so the tree is resolved. */
const ROWS: [string, string][] = [
  ['HD_1', substituted(A, cols(5, 47, 4))],
  ['HD_2', substituted(A, cols(9, 41, 3))],
  ['HD_3', substituted(substituted(A, cols(14, 31, 6)), cols(200, 7, 3))],
  ['HD_4', substituted(substituted(A, cols(17, 29, 6)), cols(202, 9, 2))],
  ['HD_5', substituted(B, cols(6, 43, 5))],
  ['HD_6', substituted(B, cols(8, 37, 2))],
  ['HD_7', substituted(substituted(B, cols(13, 33, 6)), cols(205, 6, 4))],
  ['HD_8', substituted(substituted(B, cols(19, 27, 7)), cols(207, 8, 2))],
];
function alignmentOf(id: string, rows: [string, string][]): SequenceDocument {
  return {
    id, name: `${id} alignment`, accession: id, description: 'An alignment built in the test', sequence: rows[0][1],
    moleculeType: 'DNA', topology: 'linear', folder: 'Alignments', documentKind: 'alignment',
    createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', features: [], primers: [], history: [],
    alignmentMeta: { isAligned: true, sequences: rows.map(([name, sequence], i) => ({ id: `${id}-m${i + 1}`, name, sequence })) },
  } as SequenceDocument;
}
const EIGHT = alignmentOf('hd-eight', ROWS);
const THREE = alignmentOf('hd-three', ROWS.slice(0, 3));
/** The member documents Build Tree is handed for an alignment (as the App's phylogeny source reads them). */
const membersOf = (aln: SequenceDocument): SequenceDocument[] => aln.alignmentMeta!.sequences!.map((m) => ({
  ...aln, id: m.id, name: m.name, sequence: m.sequence, alignmentMeta: undefined, documentKind: undefined,
} as SequenceDocument));

const words = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
const EXTERNAL = ['FastTree (Approx-ML)', 'PhyML (ML + SH-aLRT)', 'RAxML (GTR+G Rapid ML)', 'MrBayes (Bayesian MCMC)'] as const;
const PROGRAM: Record<(typeof EXTERNAL)[number], string> = {
  'FastTree (Approx-ML)': 'FastTree', 'PhyML (ML + SH-aLRT)': 'PhyML', 'RAxML (GTR+G Rapid ML)': 'RAxML', 'MrBayes (Bayesian MCMC)': 'MrBayes',
};
const DISTANCE = ['Neighbor-Joining (NJ)', 'UPGMA', 'Minimum-Evolution (ME)', 'Maximum Parsimony (MP)'];
/** A name for a search the built-in engine did not run. */
const CLAIMS_A_SEARCH = /Maximum[- ]Likelihood|\bML\b|FastTree|PhyML|RAxML|MrBayes|Bayesian/i;

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}
const onTree = (app: AppHarness, aln: SequenceDocument) => app.restoreSession({ documents: [aln], activeDocId: aln.id, viewerTab: 'phylogenetics' });
/** The studio's tree-method select (the one select offering Maximum Likelihood among the distance trees). */
function methodSelect(app: AppHarness): LiveElement {
  const found = app.all('select').filter((s) => s.options.some((o) => o.value === 'Maximum Likelihood (ML)') && s.options.some((o) => o.value === 'UPGMA'));
  expect(found, 'one tree-method select').toHaveLength(1);
  return found[0];
}
/** The heading card: the h3 that names the tree method above the tree. */
function heading(app: AppHarness): string {
  const hs = app.canvas().querySelectorAll('.studio-card-header h3').map((h) => words(h.textContent)).filter((t) => /tree\b/i.test(t));
  expect(hs, 'one tree heading').toHaveLength(1);
  return hs[0];
}
const newickLabel = (app: AppHarness) => words(app.canvas().querySelectorAll('.newick-box span')[0]?.textContent);
const shownNewick = (app: AppHarness) => words(app.canvas().querySelectorAll('.newick-box code')[0]?.textContent);
/** The lnL card: its label and its full-precision value (the card shows two decimals; its title holds the number). */
function lnlCard(app: AppHarness): { label: string; value: number } {
  const box = app.canvas().querySelectorAll('.kpi-box').find((k) => /^lnL\b/.test(words(k.querySelectorAll('.kpi-label')[0]?.textContent)));
  expect(box, 'the lnL card').toBeDefined();
  return { label: words(box!.querySelectorAll('.kpi-label')[0]?.textContent), value: Number(box!.querySelectorAll('.kpi-val')[0]?.getAttribute('title')) };
}
/** The search starts on the task after the press draws its running state (the harness fakes the timers). */
async function searchRuns(app: AppHarness) {
  const React = await import('react');
  await React.act(async () => { vi.advanceTimersByTime(0); });
  await app.settle();
}
const runButtons = (app: AppHarness) => app.all('button').filter((b) => words(b.textContent) === 'Run ML search');
const callouts = (app: AppHarness) => app.canvas().querySelectorAll('.info-callout').map((c) => words(c.textContent));
/** The unrooted topology: the bipartitions of the tree's internal edges over `names`. */
function unrootedSplits(newick: string, names: string[]): string[] {
  return [...splitsOf(fromTreeNode(parseNewick(newick), names.length, (nm) => names.indexOf(nm)))].sort();
}

describe('US-01M6P2HD AC2: the studio runs the ML search from Run ML search', () => {
  it('US-01M6P2HD AC2 opens on Neighbor-Joining and, on Run ML search, shows Build Tree\'s GTR+G tree and lnL on 8 taxa', async () => {
    const names = ROWS.map(([n]) => n);
    const built = (await runBuildTree(membersOf(EIGHT), { method: 'Maximum Likelihood (ML)', mlModel: 'GTR', mlGamma: true }, { sourceLabel: 'HD' })).created[0].docMetadata!;
    expect(String(built['Tree method'])).toBe('Maximum Likelihood (NNI search), GTR+G');
    const buildNewick = String(built.Newick);
    const buildLnL = Number(built['ML log likelihood']);
    expect(Number.isFinite(buildLnL)).toBe(true);
    // The fixture's ML tree is not its Neighbor-Joining tree, so a Neighbor-Joining tree shown as ML fails the Newick check below.
    const nj = (await runBuildTree(membersOf(EIGHT), { method: 'Neighbor-Joining (NJ)' }, { sourceLabel: 'HD' })).created[0].docMetadata!;
    expect(String(nj.Newick)).not.toBe(buildNewick);

    await withApp(async (app) => {
      await onTree(app, EIGHT);
      expect(methodSelect(app).value, 'the studio opens on Neighbor-Joining (D0205)').toBe('Neighbor-Joining (NJ)');
      expect(heading(app)).toBe('Neighbor-Joining tree');
      expect(runButtons(app), 'no Run ML search on Neighbor-Joining').toHaveLength(0);

      // Choosing Maximum Likelihood runs nothing: the Neighbor-Joining tree stays, named as such, until Run.
      engineReports.length = 0;
      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      expect(heading(app), 'before Run').toBe('Neighbor-Joining tree');
      expect(lnlCard(app).label, 'before Run').toBe('lnL (JC69, this tree)');
      expect(engineReports.every((r) => r.algorithm === 'Neighbor-Joining (NJ)'), 'the tree shown before Run is the engine\'s Neighbor-Joining tree').toBe(true);
      expect(runButtons(app), 'one Run ML search button').toHaveLength(1);

      // Pressed, the button says it is running before the search starts (on the next task).
      await app.click(runButtons(app)[0]);
      expect(callouts(app).some((c) => /^Running the maximum-likelihood search \(GTR\+G\) on 8 sequences × 240 sites… The Neighbor-Joining tree is shown until it finishes\.Cancel$/.test(c)), `the running state, with its Cancel (BG-01M7RREM): ${callouts(app).join(' | ')}`).toBe(true);
      expect(heading(app), 'while running').toBe('Neighbor-Joining tree');
      await searchRuns(app);

      expect(heading(app)).toBe('Maximum-likelihood tree (built-in, GTR+G)');
      expect(newickLabel(app)).toBe('Export Newick Tree String (Maximum-likelihood tree (built-in, GTR+G)):');
      const shown = shownNewick(app);
      expect(unrootedSplits(shown, names), 'the unrooted topology of Build Tree\'s ML tree').toEqual(unrootedSplits(buildNewick, names));
      expect(shown, 'midpoint-rooted as Build Tree roots it').toBe(buildNewick);
      const lnl = lnlCard(app);
      expect(lnl.label).toBe('lnL (GTR+G, ML search)');
      expect(Math.abs(lnl.value - buildLnL), `studio lnL ${lnl.value} vs Build Tree ${buildLnL}`).toBeLessThan(1e-6);
      expect(runButtons(app), 'no Run ML search once the search has run on these rows').toHaveLength(0);
    });
  });

  it('US-01M6P2HD AC2 opens on Neighbor-Joining when the studio is drawn on its own, with no method given', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { PhylogeneticsStudio } = await import('../components/AlignmentAndPhyloStudio');
    const docs = membersOf(EIGHT);
    const html = renderToStaticMarkup(React.createElement(PhylogeneticsStudio, { documents: docs, activeDoc: docs[0], initialPhyloTab: 'phylogeny' }));
    const selected = [...html.matchAll(/<option value="([^"]+)" selected="">/g)].map((m) => m[1]);
    expect(selected, 'the selected options').toContain('Neighbor-Joining (NJ)');
    expect(selected).not.toContain('Maximum Likelihood (ML)');
    expect(html, 'no Run ML search button on Neighbor-Joining').not.toMatch(/<button[^>]*>Run ML search<\/button>/);
  });

  it('US-01M6P2HD AC2 shows the engine\'s refusal on 3 taxa and keeps the Neighbor-Joining tree', async () => {
    await withApp(async (app) => {
      await onTree(app, THREE);
      expect(methodSelect(app).value).toBe('Neighbor-Joining (NJ)');
      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      await app.click(runButtons(app)[0]);
      await searchRuns(app);
      const alerts = app.canvas().querySelectorAll('.info-callout[role="alert"]').map((c) => words(c.textContent));
      expect(alerts, 'the engine\'s refusal').toEqual(['Maximum-likelihood search needs at least 4 sequences. The Neighbor-Joining tree is shown instead.Run ML search']);
      // That sentence is the engine's own, for these rows.
      const { mlTreeSearch } = await import('../core/phyloEvoEngine');
      const rows = THREE.alignmentMeta!.sequences!;
      expect(() => mlTreeSearch(rows.map((m) => m.name), rows.map((m) => m.sequence), 'GTR+G')).toThrow('Maximum-likelihood search needs at least 4 sequences.');
      expect(heading(app)).toBe('Neighbor-Joining tree');
      expect(lnlCard(app).label).toBe('lnL (JC69, this tree)');
    });
  });
});

describe('US-01M6P2HD AC3: no report or saved tree names a search that did not run', () => {
  it('US-01M6P2HD AC3 keeps Neighbor-Joining in the report and heading of each method the studio did not search, the browser fallback for each external name among them', async () => {
    await withApp(async (app) => {
      await onTree(app, EIGHT);
      // UPGMA first, so the opening Neighbor-Joining tree is asked for again when it is chosen.
      for (const method of ['UPGMA', ...DISTANCE, 'Maximum Likelihood (ML)', ...EXTERNAL]) {
        await app.change(methodSelect(app), method);
        expect(methodSelect(app).value).toBe(method);
        const h = heading(app);
        expect(h, `${method}: the heading`).not.toMatch(CLAIMS_A_SEARCH);
        expect(newickLabel(app), `${method}: the Newick label`).not.toMatch(CLAIMS_A_SEARCH);
        // The tree shown is the engine's last report (the studio's one call to the tree engine).
        const shown = engineReports.at(-1)!;
        expect(shown.report.newick.replace(/\s/g, ''), `${method}: the tree shown is that report's`).not.toBe('();');
        const fallback = (EXTERNAL as readonly string[]).includes(method) || method === 'Maximum Likelihood (ML)';
        expect(shown.report.algorithm, `${method}: the report's algorithm`).toBe(fallback ? 'Neighbor-Joining (NJ)' : method);
        if (fallback) expect(h, `${method}: the fallback heading`).toBe('Neighbor-Joining tree');
        if ((EXTERNAL as readonly string[]).includes(method)) {
          expect(runButtons(app), `${method}: no Run ML search for an external program`).toHaveLength(0);
          const program = PROGRAM[method as (typeof EXTERNAL)[number]];
          expect(callouts(app), `${method}: the callout names the program it could not run`)
            .toContain(`${program} can only be run from the MolBioCraft desktop app. Showing the built-in Neighbor-Joining tree instead.`);
        }
      }
      // No report the studio received names a search, or says a method is not run.
      expect(engineReports.length).toBeGreaterThan(0);
      for (const { algorithm, report } of engineReports) {
        expect(DISTANCE, `the engine was asked for a distance tree, not ${algorithm}`).toContain(algorithm);
        expect(report.algorithm).not.toMatch(CLAIMS_A_SEARCH);
        expect(report.methodNote).not.toMatch(/is not run here/);
      }
    });
  });

  it('US-01M6P2HD AC3 saves no Build Tree document under a search that did not run', async () => {
    const rows = membersOf(EIGHT);
    for (const method of DISTANCE) {
      const meta = (await runBuildTree(rows, { method }, { sourceLabel: 'HD' })).created[0].docMetadata!;
      expect(String(meta['Tree method']), method).not.toMatch(CLAIMS_A_SEARCH);
    }
    // Without the desktop backend an external program is not run, and no tree is saved under its name.
    for (const method of EXTERNAL) {
      await expect(runBuildTree(rows, { method }, { sourceLabel: 'HD' }), method).rejects.toThrow();
    }
    // The ML tree Build Tree saves is the search's own.
    const ml = (await runBuildTree(rows, { method: 'Maximum Likelihood (ML)' }, { sourceLabel: 'HD' })).created[0].docMetadata!;
    expect(String(ml['Tree method'])).toMatch(/^Maximum Likelihood \(NNI search\), /);
    expect(Number(ml['ML log likelihood'])).toBeGreaterThanOrEqual(Number(ml['Starting tree ln L (NJ)']));
  });

  it('US-01M6P2HD AC3 opens the Build Tree dialog with Maximum Likelihood chosen on Ctrl+Alt+T on a Linux host', async () => {
    await withApp(async (app) => {
      expect(app.host).toBe('linux');
      await app.restoreSession({ documents: [EIGHT], activeDocId: EIGHT.id, viewerTab: 'sequence-alignment' });
      await app.press('t', { mod: true, alt: true });
      const method = app.one('#opdlg-tree-method', 'the Build Tree dialog\'s method');
      expect(method.value).toBe('Maximum Likelihood (ML)');
      expect(words(app.one('#opdlg-build-tree', 'the Build Tree dialog\'s title').textContent)).toBe('Build Tree');
      expect(app.activeTab(), 'the shortcut does not open the studio instead').toBe('sequence-alignment');
    });
  });
});

// ─── BG-01M7RR52: the ML option and callouts name the model the engine fits; the studio's two ML result guards ───

/** Five globins (the Build Tree protein case above), gap-padded to one length: the engine fits LG+G to them (ml_search.rs ml_tree_search). */
const GLOBINS: [string, string][] = ([
  ['HBB_HUMAN', 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH'],
  ['HBB_HORSE', 'VQLSGEEKAAVLALWDKVNEEEVGGEALGRLLVVYPWTQRFFDSFGDLSNPGAVMGNPKVKAHGKKVLHSFGEGVHHLDNLKGTFAALSELHCDKLHVDPENFRLLGNVLVVVLARHFGKDFTPELQASYQKVVAGVANALAHKYH-'],
  ['HBA_HUMAN', 'VLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHF-DLSH-----GSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR--'],
  ['HBA_HORSE', 'VLSAADKTNVKAAWSKVGGHAGEYGAEALERMFLGFPTTKTYFPHF-DLSH-----GSAQVKAHGKKVGDALTLAVGHLDDLPGALSNLSDLHAHKLRVDPVNFKLLSHCLLSTLAVHLPNDFTPAVHASLDKFLSSVSTVLTSKYR--'],
  ['MYG_HUMAN', 'GLSDGEWQLVLNVWGKVEADIPGHGQEVLIRLFKGHPETLEKFDKFKHLKSEDEMKASEDLKKHGATVLTALGGILKKKGHHEAEIKPLAQSHATKHKIPVKYLEFISECIIQVLQSKHPGDFGADAQGAMNKALELFRKDMASNYKELG'],
] as [string, string][]).map(([n, s], _i, all) => [n, s.padEnd(Math.max(...all.map(([, t]) => t.length)), '-')]);
const PROTEIN = { ...alignmentOf('rr52-globins', GLOBINS), moleculeType: 'Protein' } as SequenceDocument;
/** A second nucleotide alignment, of other rows than EIGHT's. */
const SIX = alignmentOf('rr52-six', ROWS.slice(2));
const mlOptionText = (app: AppHarness) => words(methodSelect(app).options.find((o) => o.value === 'Maximum Likelihood (ML)')?.textContent);

describe('BG-01M7RR52 AC1: the ML option and callouts name the model the engine fits', () => {
  it('BG-01M7RR52 AC1 says LG+G on a protein alignment in the option, the idle and running callouts, and the finished tree', async () => {
    // The engine's own model for these rows: asked for GTR+G, it fits LG+G to a protein alignment.
    const { mlTreeSearch } = await import('../core/phyloEvoEngine');
    expect(mlTreeSearch(GLOBINS.map(([n]) => n), GLOBINS.map(([, s]) => s), 'GTR+G').model, 'the engine fits LG+G to a protein alignment').toBe('LG+G');
    await withApp(async (app) => {
      await onTree(app, PROTEIN);
      expect(mlOptionText(app)).toBe('Maximum Likelihood — built-in ML search (LG+G), on Run ML search');
      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      expect(callouts(app), 'the idle callout').toContain('The maximum-likelihood search (LG+G) runs when you press Run ML search; the Neighbor-Joining tree is shown until then.Run ML search');
      await app.click(runButtons(app)[0]);
      expect(callouts(app), 'the running callout').toContain(`Running the maximum-likelihood search (LG+G) on 5 sequences × ${GLOBINS[0][1].length} sites… The Neighbor-Joining tree is shown until it finishes.Cancel`);
      await searchRuns(app);
      expect(heading(app)).toBe('Maximum-likelihood tree (built-in, LG+G)');
      expect(lnlCard(app).label).toBe('lnL (LG+G, ML search)');
      expect(callouts(app)).toContain('Tree from the built-in maximum-likelihood search (LG+G).');
      expect(callouts(app).join(' | '), 'no label names GTR+G on a protein alignment').not.toMatch(/GTR\+G/);
      expect(mlOptionText(app)).not.toMatch(/GTR\+G/);
    });
  }, 120000);

  it('BG-01M7RR52 AC1 says GTR+G on a nucleotide alignment in the option and the idle callout', async () => {
    await withApp(async (app) => {
      await onTree(app, EIGHT);
      expect(mlOptionText(app)).toBe('Maximum Likelihood — built-in ML search (GTR+G), on Run ML search');
      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      expect(callouts(app)).toContain('The maximum-likelihood search (GTR+G) runs when you press Run ML search; the Neighbor-Joining tree is shown until then.Run ML search');
    });
  });
});

describe('BG-01M7RR52 AC1: the ML tree is shown only for Maximum Likelihood and only for the rows it ran on', () => {
  it('BG-01M7RR52 AC1 shows the UPGMA tree on choosing UPGMA after a run, and the kept ML tree on choosing ML again', async () => {
    await withApp(async (app) => {
      await onTree(app, EIGHT);
      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      await app.click(runButtons(app)[0]);
      await searchRuns(app);
      expect(heading(app), 'the search ran').toBe('Maximum-likelihood tree (built-in, GTR+G)');
      const mlNewick = shownNewick(app);

      engineReports.length = 0;
      await app.change(methodSelect(app), 'UPGMA');
      expect(heading(app)).not.toMatch(CLAIMS_A_SEARCH);
      const upgma = engineReports.at(-1)!;
      expect(upgma.algorithm, 'the engine was asked for the UPGMA tree').toBe('UPGMA');
      expect(shownNewick(app), 'the tree shown is the UPGMA tree').toBe(words(upgma.report.newick));
      expect(shownNewick(app)).not.toBe(mlNewick);
      expect(lnlCard(app).label).toBe('lnL (JC69, this tree)');
      expect(callouts(app).join(' | '), 'no ML callout on UPGMA').not.toMatch(/maximum-likelihood search/);

      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      expect(heading(app), 'the search is kept for these rows').toBe('Maximum-likelihood tree (built-in, GTR+G)');
      expect(shownNewick(app)).toBe(mlNewick);
      expect(runButtons(app)).toHaveLength(0);
    });
  });

  it('BG-01M7RR52 AC1 shows Neighbor-Joining with Run ML search offered again on opening a different alignment after a run', async () => {
    await withApp(async (app) => {
      await onTree(app, EIGHT);
      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      await app.click(runButtons(app)[0]);
      await searchRuns(app);
      expect(heading(app), 'the search ran on EIGHT').toBe('Maximum-likelihood tree (built-in, GTR+G)');
      expect(shownNewick(app)).toContain('HD_1');

      // Restoring a session holding the other alignment, on this tab (File > Restore Autosave): the studio stays open.
      await app.restoreSession({ documents: [SIX], activeDocId: SIX.id, viewerTab: 'phylogenetics' });
      expect(methodSelect(app).value, 'Maximum Likelihood stays chosen').toBe('Maximum Likelihood (ML)');
      expect(shownNewick(app), 'the tree shown is of the other alignment').not.toContain('HD_1');
      expect(shownNewick(app)).toContain('HD_3');
      expect(heading(app)).toBe('Neighbor-Joining tree');
      expect(lnlCard(app).label).toBe('lnL (JC69, this tree)');
      expect(runButtons(app), 'Run ML search is offered again').toHaveLength(1);
      expect(callouts(app)).toContain('The maximum-likelihood search (GTR+G) runs when you press Run ML search; the Neighbor-Joining tree is shown until then.Run ML search');
    });
  });
});

// ─── BG-01M7RREM: the studio's ML search runs off the interface thread, and Cancel stops it (D0171, D0005) ───

const KINGDOMS = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-three-kingdoms')!;
type MlPayload = { names: string[]; alignedSeqs: string[]; model: string };
type MlReport = import('../core/phyloEvoEngine').MlSearchReport;
/**
 * Holds every `ml_tree_search` the studio sends the desktop's worker pool (`cmd_rust_bio_invoke`)
 * until the test replies, as the pool replies while the interface keeps running; any other command
 * is refused, so it falls back to the in-process engine.
 */
function holdDesktopMlSearches() {
  const g = globalThis as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } };
  const pending: { payload: MlPayload; resolve: (v: unknown) => void }[] = [];
  g.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => {
      if (cmd === 'cmd_rust_bio_invoke' && args.op === 'ml_tree_search') {
        return new Promise((resolve) => pending.push({ payload: args.payload as MlPayload, resolve }));
      }
      return Promise.reject(new Error(`not held: ${cmd}`));
    },
  };
  return { pending, release: () => { delete g.__TAURI_INTERNALS__; } };
}
/** Today's search: the synchronous call the studio made on the interface thread, on the same rows and model. */
let todaysKingdoms: { payload: MlPayload; report: MlReport } | null = null;
async function todaysSearch(payload: MlPayload): Promise<MlReport> {
  const { mlTreeSearch } = await import('../core/phyloEvoEngine');
  if (!todaysKingdoms) todaysKingdoms = { payload, report: mlTreeSearch(payload.names, payload.alignedSeqs, payload.model) };
  expect(todaysKingdoms.payload, 'today\'s search ran on these rows').toEqual(payload);
  return todaysKingdoms.report;
}
/** The press's search task: the time it holds the interface thread, in real milliseconds. */
async function startSearchTask(): Promise<number> {
  const React = await import('react');
  const t0 = performance.now();
  await React.act(async () => { vi.advanceTimersByTime(0); });
  return performance.now() - t0;
}
const rowsOf = (d: SequenceDocument) => d.alignmentMeta!.sequences!;

describe('BG-01M7RREM AC1: the ML search runs off the interface thread, can be cancelled, and finds today\'s tree', () => {
  it('BG-01M7RREM AC1 keeps a timer firing while the three-kingdoms search runs on the desktop worker, and shows today\'s tree and lnL when it replies', async () => {
    const { invokeRustBioSync } = await import('../lib/rustBioEngine');
    const React = await import('react');
    await withApp(async (app) => {
      await onTree(app, KINGDOMS);
      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      const held = holdDesktopMlSearches();
      let ticks = 0;
      const timer = setInterval(() => { ticks += 1; }, 100);
      try {
        await app.click(runButtons(app)[0]);
        const heldMs = await startSearchTask();
        expect(heldMs, `the search task held the interface thread for ${heldMs.toFixed(0)} ms`).toBeLessThan(1000);
        expect(held.pending, 'the search was sent to the desktop worker pool as one ml_tree_search').toHaveLength(1);
        const payload = held.pending[0].payload;
        expect(payload.names, 'the 35 rows of the sample').toEqual(rowsOf(KINGDOMS).map((m) => m.name));
        expect(payload.alignedSeqs.map((s) => s.length), 'each row its 1,168 columns').toEqual(rowsOf(KINGDOMS).map(() => 1168));
        expect(payload.alignedSeqs, 'the rows as aligned').toEqual(rowsOf(KINGDOMS).map((m) => m.sequence));
        // Today's model for the sample (mlSearchModel): GTR+G on nucleotides, LG+G on protein.
        expect(payload.model, `the model for a ${KINGDOMS.moleculeType} alignment`).toBe(KINGDOMS.moleculeType === 'Protein' ? 'LG+G' : 'GTR+G');

        // The interface runs while the worker searches: the timer fires, and the running state stays drawn.
        await React.act(async () => { vi.advanceTimersByTime(1000); });
        await app.settle();
        expect(ticks, 'the timer kept firing during the search').toBeGreaterThanOrEqual(10);
        expect(callouts(app).some((c) => /^Running the maximum-likelihood search \(/.test(c)), `still running: ${callouts(app).join(' | ')}`).toBe(true);
        expect(heading(app), 'while running').toBe('Neighbor-Joining tree');

        // The worker replies with the engine's own search on what it was sent.
        const today = await todaysSearch(payload);
        held.pending[0].resolve(invokeRustBioSync('ml_tree_search', payload));
        await app.settle();
        expect(heading(app)).toBe(`Maximum-likelihood tree (built-in, ${today.model})`);
        expect(shownNewick(app), 'today\'s tree, midpoint-rooted as the studio roots it').toBe(toNewick(midpointRoot(parseNewick(today.newick))));
        expect(lnlCard(app).value, 'today\'s lnL, to the bit').toBe(today.logLikelihood);
        expect(lnlCard(app).label).toBe(`lnL (${today.model}, ML search)`);
      } finally {
        clearInterval(timer);
        held.release();
      }
    });
  }, 120000);

  it('BG-01M7RREM AC1 stops the search on Cancel, says it was cancelled, and shows nothing from its late reply', async () => {
    await withApp(async (app) => {
      await onTree(app, KINGDOMS);
      await app.change(methodSelect(app), 'Maximum Likelihood (ML)');
      const njNewick = shownNewick(app);
      const held = holdDesktopMlSearches();
      try {
        await app.click(runButtons(app)[0]);
        await startSearchTask();
        expect(held.pending, 'the search is running on the desktop worker').toHaveLength(1);
        const cancel = app.all('button').filter((b) => words(b.textContent) === 'Cancel');
        expect(cancel, `one Cancel beside the running search: ${callouts(app).join(' | ')}`).toHaveLength(1);
        await app.click(cancel[0]);
        const cancelled = 'The maximum-likelihood search was cancelled; the Neighbor-Joining tree is shown.Run ML search';
        expect(callouts(app), 'it says it was cancelled').toContain(cancelled);
        expect(callouts(app).join(' | '), 'no longer running').not.toMatch(/^Running the maximum-likelihood search|\| Running the maximum-likelihood search/);

        // The search's reply, arriving after Cancel, is not read: no tree, lnL or note from it is shown.
        const today = await todaysSearch(held.pending[0].payload);
        held.pending[0].resolve(today);
        await app.settle();
        expect(heading(app), 'after the late reply').toBe('Neighbor-Joining tree');
        expect(shownNewick(app), 'the Neighbor-Joining tree is kept').toBe(njNewick);
        expect(lnlCard(app).label).toBe('lnL (JC69, this tree)');
        expect(callouts(app), 'still says it was cancelled').toContain(cancelled);
        expect(app.downloads(), 'nothing was saved').toEqual([]);

        // Run ML search is offered again, and runs a new search.
        await app.click(runButtons(app)[0]);
        await startSearchTask();
        expect(held.pending, 'a new search').toHaveLength(2);
      } finally {
        held.release();
      }
    });
  }, 120000);
});
