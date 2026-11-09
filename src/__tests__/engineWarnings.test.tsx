// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6P25H: engine warnings (D0005) are shown beside the result they belong to, through the one
 * shared ResultWarnings component, and kept in the notes of the result document an operation
 * runner saves, through withWarningNotes: the Multiple Alignment, Build Tree (its little-bootstrap
 * support caveat included) and Compute Timetree runners, one convention for all three.
 *
 * Every WASM engine reply here comes from the real engine, read at the boundary the code under test
 * reads it through. Where a studio or runner cannot get a warning today, the test says how it gets
 * one, and which replies it adds to:
 * - an MSA truncation never reaches the alignment studio or a runner, because runValidatedAlignment
 *   (alignmentExecution.ts) stops a cut alignment with two guards: alignmentInputError refuses an
 *   input over the 6,000-residue cap before the engine runs, and the consistency check after the
 *   run rejects a reply whose rows do not hold every input residue, as a cut alignment's rows do
 *   not. So the tests add the sentence the engine itself writes when it cuts (US-01M6P244 AC1),
 *   produced here by the real engine at a lower cap, to the real reply for the whole sequences: a
 *   reply the engine cannot send, whose rows are whole under a sentence saying they were cut;
 * - the MS digest's select offers only proteases the engine knows, so the test asks the engine for
 *   a protease it does not know, in the studio's place, and the studio shows the engine's own reply:
 *   the Trypsin digest, with its fallback warning (US-01M6P2QH AC2);
 * - the tree runner's external programs run in the desktop backend, which a test cannot start, so
 *   the test answers its IPC command with a reply in the shape that backend sends (ExternalTreeResult)
 *   when MrBayes has not converged, its warning worded as crates/molbiocraft-phylo/src/external.rs
 *   writes it;
 * - the built-in tree engine writes its one warning only with an empty tree (a pair whose distance
 *   is undefined), which is not saved as a document: Build Tree stops with that sentence as its
 *   error, and the notes test adds the engine's own sentence to its reply for a tree that is.
 */

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultWarnings } from '../components/ResultWarnings';
import { SequenceAlignmentStudio } from '../components/AlignmentAndPhyloStudio';
import { HybridToolsAndHistoryStudio } from '../components/HybridToolsAndHistoryStudio';
import { runBuildTree, runComputeTimetree, runMultipleAlignment, withWarningNotes } from '../core/operationRunners';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { ExternalTreeResult } from '../core/externalTreePrograms';
import type { PhyloTreeInferenceReport } from '../core/phyloEvoEngine';
import * as engine from '../lib/rustBioEngine';
import type { MSAAlignmentResult, SequenceDocument } from '../types/bio';

/**
 * Warnings the tests add to the engine's real reply, by engine op, after any the engine sent; and
 * the protease the digest is asked for in the studio's place, when a test sets one.
 */
const { injected, withInjected, digestAsked } = vi.hoisted(() => {
  const injected = new Map<string, string[]>();
  const withInjected = <T,>(op: string, reply: T): T => {
    const extra = injected.get(op);
    if (!extra) return reply;
    const own = (reply as { warnings?: string[] }).warnings ?? [];
    return { ...reply, warnings: [...own, ...extra] };
  };
  return { injected, withInjected, digestAsked: { protease: undefined as string | undefined } };
});

vi.mock('../lib/rustBioEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/rustBioEngine')>();
  return {
    ...real,
    // the transport bioEngine.ts runs the MSA and phyloEvoEngine.ts the tree through
    invokeRustBioSync: <T,>(op: string, payload?: unknown): T => withInjected(op, real.invokeRustBioSync<T>(op, payload)),
    // the digest wrapper the hybrid studio calls (it reaches the transport inside its own module):
    // the engine's own reply, for the protease a test asks for in the studio's place
    simulateProteolyticDigestMsRust: (...[seq, protease, ...rest]: Parameters<typeof real.simulateProteolyticDigestMsRust>) =>
      real.simulateProteolyticDigestMsRust(seq, digestAsked.protease ?? protease, ...rest),
  };
});

beforeEach(() => {
  injected.clear();
  digestAsked.protease = undefined;
});

/** Deterministic pseudo-random letters (LCG), so every run aligns the same sequences. */
function randomLetters(n: number, seed: number, alphabet: string): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((s / 2 ** 32) * alphabet.length)];
  }
  return out;
}

const doc = (id: string, name: string, sequence: string, moleculeType: SequenceDocument['moleculeType'] = 'DNA'): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, moleculeType });

/** The text a reader sees: tags stripped, entities decoded. */
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** Every warnings region in the markup: its opening tag, where it starts and ends, and the sentences it shows, in order. */
function regions(html: string): { tag: string; at: number; end: number; sentences: string[] }[] {
  return [...html.matchAll(/(<div[^>]*data-mbc-result-warnings[^>]*>)([\s\S]*?)<\/div>/g)].map((m) => ({
    tag: m[1],
    at: m.index!,
    end: m.index! + m[0].length,
    sentences: [...m[2].matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) => text(p[1])),
  }));
}

/**
 * The node tree React DOM's client renderer writes to, for a test that re-renders. The repo carries
 * no DOM library (jsdom, happy-dom) and package.json is outside this unit, so the test runs
 * `createRoot`, the renderer the app itself runs, against these few node operations. Which nodes
 * React keeps, inserts or removes on a re-render is React's own reconciliation; this only holds the
 * nodes, so a test can ask whether a node shown before is the node shown after.
 */
class TestNode {
  childNodes: TestNode[] = [];
  parentNode: TestNode | null = null;
  constructor(readonly nodeType: number, readonly nodeName: string, readonly ownerDocument: TestDocument | null) {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(t: string) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = t ? [new TestText(t, this.ownerDocument!)] : [];
  }
  appendChild(child: TestNode) { return this.insertBefore(child, null); }
  insertBefore(child: TestNode, before: TestNode | null) {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  addEventListener() {}
  removeEventListener() {}
}
class TestText extends TestNode {
  constructor(public nodeValue: string, doc: TestDocument) { super(3, '#text', doc); }
  override get textContent() { return this.nodeValue; }
  override set textContent(t: string) { this.nodeValue = t; }
}
class TestElement extends TestNode {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> = {};
  constructor(readonly tagName: string, readonly namespaceURI: string, doc: TestDocument) { super(1, tagName.toUpperCase(), doc); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
}
class TestDocument extends TestNode {
  constructor() { super(9, '#document', null); }
  createElement(tag: string) { return new TestElement(tag, 'http://www.w3.org/1999/xhtml', this); }
  createElementNS(ns: string, tag: string) { return new TestElement(tag, ns, this); }
  createTextNode(t: string) { return new TestText(t, this); }
}

/** Renders `ResultWarnings` with each list in turn into one client root, calling `seen` after each commit. */
function clientRenders(lists: (readonly string[])[], seen: (container: TestElement, i: number) => void) {
  // React DOM reads `window` while it commits (the focused element); nothing else here needs one
  const g = globalThis as { window?: unknown };
  g.window = { HTMLIFrameElement: class {} };
  try {
    const container = new TestDocument().createElement('div');
    const root = createRoot(container as unknown as Element);
    lists.forEach((warnings, i) => {
      flushSync(() => root.render(<ResultWarnings warnings={warnings} label="Alignment warnings" />));
      seen(container, i);
    });
    root.unmount();
  } finally {
    delete g.window;
  }
}

// Two related sequences, 90 and 75 nt: whole under the studio's cap, both over a cap of 40.
const base = randomLetters(120, 0x25e1, 'ACGT');
const seqA = doc('a', 'clone-A', base.slice(0, 90));
const seqB = doc('b', 'clone-B', base.slice(10, 85));
/** Four related clones of 82 to 90 nt, which the tree runner aligns first: clone-A to clone-D. */
const fourTaxa = () => [base.slice(0, 90), base.slice(3, 90), base.slice(0, 84), base.slice(6, 88)]
  .map((s, i) => doc(`t${i}`, `clone-${'ABCD'[i]}`, s));
/**
 * Four clones of one 90-nt sequence with 0, 10, 15 and 21 substitutions, so a tree built from them
 * has branch lengths (fourTaxa's clones are identical where they overlap, so theirs are all zero).
 */
const fourDiverged = () => {
  const mutate = (s: string, every: number, offset: number) =>
    [...s].map((c, i) => (i % every === offset ? 'ACGT'[('ACGT'.indexOf(c) + 1) % 4] : c)).join('');
  const a = base.slice(0, 90);
  const c = mutate(a, 6, 1);
  return [a, mutate(a, 9, 0), c, mutate(c, 10, 3)].map((s, i) => doc(`d${i}`, `clone-${'ABCD'[i]}`, s));
};
/** Any metadata row named for a warning: runners once kept them as `Warning 1..n`, `Support warning` or `Warnings` rows. */
const warningRows = (d: SequenceDocument) => Object.keys(d.docMetadata ?? {}).filter((k) => /warning/i.test(k));

/** The warning the real engine writes when its residue cap cuts these inputs (US-01M6P244 AC1). */
function realTruncationWarning(): string {
  const r = engine.invokeRustBioSync<MSAAlignmentResult>('run_msa', {
    docs: [seqA, seqB].map(({ id, name, sequence }) => ({ id, name, sequence })), maxSeqLen: 40, algorithm: '',
  });
  expect(r.warnings).toEqual([
    'MSA input truncated to the length cap of 40 residues: clone-A (90 residues), clone-B (75 residues). Only the first 40 residues of each were aligned.',
  ]);
  return r.warnings![0];
}

describe('ResultWarnings', () => {
  it('renders each engine warning next to the result', () => {
    const cap = 'Folding capped at 600 nt: only nucleotides 1-600 of the 2,400-nt sequence were folded.';
    const fallback = 'Unknown genetic code "99" fell back to table 1 (Standard).';
    const html = renderToStaticMarkup(
      <section>
        <table><tbody><tr><td>result</td></tr></tbody></table>
        <ResultWarnings warnings={[cap, fallback, cap]} label="Fold warnings" />
      </section>
    );
    // right after the result it sits beside, in place: not lifted into a toast or the status bar
    expect(html).toMatch(/<\/table><div role="status" aria-label="Fold warnings"[^>]*data-mbc-result-warnings[^>]*>/);
    const [region, ...others] = regions(html);
    expect(others).toEqual([]);
    // each warning its own plain sentence, whole and in the engine's order; a repeat is shown once
    expect(region.sentences).toEqual([cap, fallback]);
    // in the Caution Amber note, with the warning icon hidden from assistive tech
    expect(html.match(/<p class="cloning-warning-note"[^>]*><svg[^>]*aria-hidden="true"[^>]*>/g)).toHaveLength(2);
    expect(html).toContain('lucide-triangle-alert');

    // a single warning is one sentence too, under the default name
    const one = renderToStaticMarkup(<ResultWarnings warnings={[fallback]} />);
    expect(one).toMatch(/^<div role="status" aria-label="Warnings"/);
    expect(regions(one).map((r) => r.sentences)).toEqual([[fallback]]);
  });

  it('renders nothing when there are no warnings', () => {
    // a reply with no field (BLAST hits leave it out), an empty list, and a list of blank strings
    for (const warnings of [undefined, [], ['', '   ']]) {
      expect(renderToStaticMarkup(<ResultWarnings warnings={warnings} />), JSON.stringify(warnings)).toBe('');
    }
    // the same element with a warning renders, so the empty case is not an element that never renders
    expect(renderToStaticMarkup(<ResultWarnings warnings={['A cut.']} />)).not.toBe('');
  });

  it('keeps each warning node across an identical re-render', () => {
    const cut = realTruncationWarning();
    const fallback = "Unknown protease 'Pepsin A': digested with Trypsin.";
    const later = 'A warning that arrives after the other two, ahead of them in the list.';
    const shown: { region: TestNode | null; notes: TestNode[]; texts: string[] }[] = [];
    // each list is a new array, as each engine reply brings its own
    clientRenders([[cut, fallback], [cut, fallback], [later, cut, fallback], []], (container) => {
      const region = container.firstChild;
      const notes = [...(region?.childNodes ?? [])];
      shown.push({ region, notes, texts: notes.map((n) => n.textContent) });
    });
    const [first, again, grown, none] = shown;
    expect(first.texts).toEqual([cut, fallback]);
    expect((first.region as TestElement).attributes.get('role')).toBe('status');
    // the same warnings again: the same region and the same nodes, none remounted
    expect(again.region).toBe(first.region);
    expect(again.notes.map((n, i) => n === first.notes[i])).toEqual([true, true]);
    // a warning that arrives ahead of them is the one new node; the nodes already shown stay, each
    // with its own sentence
    expect(grown.texts).toEqual([later, cut, fallback]);
    expect(grown.notes.map((n) => first.notes.indexOf(n))).toEqual([-1, 0, 1]);
    // and no warnings removes the region
    expect(none.region).toBeNull();
  });
});

describe('saved results', () => {
  it('keeps engine warnings in the saved result document', () => {
    const warning = realTruncationWarning();
    const ctx = { sourceLabel: '2 selected sequences' };

    // the engine's reply carries the warning: the alignment document the runner saves keeps it
    injected.set('run_msa', [warning]);
    const saved = runMultipleAlignment([seqA, seqB], {}, ctx).created[0];
    expect(saved.alignmentMeta?.sequences?.map((m) => m.sequence.replace(/-/g, ''))).toEqual([seqA.sequence, seqB.sequence]);
    expect(saved.docMetadata?.Notes).toBe(`Warnings:\n- ${warning}\n`);

    // a reply without warnings saves no Warnings block
    injected.clear();
    const clean = runMultipleAlignment([seqA, seqB], {}, ctx).created[0];
    expect(clean.docMetadata?.Notes).toBeUndefined();
    expect(JSON.stringify(clean.docMetadata)).not.toContain('Warnings');

    // the helper the runners share keeps notes already there, lists each warning once, and
    // leaves a document with nothing to add untouched
    const noted = { ...seqA, docMetadata: { Organism: 'E. coli', Notes: 'Picked from plate 3.\n' } };
    expect(withWarningNotes(noted, [warning, 'Second cut.', warning]).docMetadata).toEqual({
      Organism: 'E. coli',
      Notes: `Picked from plate 3.\n\nWarnings:\n- ${warning}\n- Second cut.\n`,
    });
    expect(withWarningNotes(noted, [])).toBe(noted);
    expect(withWarningNotes(noted, undefined)).toBe(noted);
    expect(withWarningNotes(noted, [' '])).toBe(noted);
  });

  it('keeps engine warnings in the saved result document built by the tree runner', async () => {
    const ctx = { sourceLabel: '4 selected sequences' };
    const taxa = fourTaxa();

    // An external program: the desktop backend runs MrBayes and replies to the IPC command, with the
    // tree relabelled to the input names and integer % support. This reply says the runs have not
    // converged, in the words external.rs writes (average SD of split frequencies, here 0.112, after
    // its MRBAYES_GENERATIONS of 100000).
    const notConverged = 'MrBayes runs have not converged (average SD of split frequencies 0.112 > 0.05 after 100000 generations); treat posterior probabilities with caution.';
    const mrBayesReply = (warnings: string[]): ExternalTreeResult => ({
      algorithm: 'MrBayes (Bayesian MCMC)', program: 'MrBayes', version: 'MrBayes 3.2.7a x86_64', executablePath: '/usr/local/bin/mb',
      commandLine: 'mb aln.nex', model: 'GTR+Γ4',
      newick: '((clone-A:0.011,clone-B:0.024)100:0.017,(clone-C:0.009,clone-D:0.031)71:0.017);',
      supportKind: 'posterior probability', programLogLikelihood: null, totalBranchLength: 0.109, runtimeMs: 8123, warnings,
    });
    const g = globalThis as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } };
    let reply = mrBayesReply([notConverged]);
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd !== 'cmd_run_external_tree') throw new Error(`unexpected desktop command ${cmd}`);
        expect(args.algorithm).toBe('MrBayes (Bayesian MCMC)');
        expect(args.names).toEqual(taxa.map((d) => d.name));
        return reply;
      },
    };
    try {
      const saved = (await runBuildTree(taxa, { method: 'MrBayes (Bayesian MCMC)' }, ctx)).created[0];
      expect(saved.docMetadata?.['Tree method']).toBe('MrBayes (MrBayes 3.2.7a x86_64), GTR+Γ4');
      expect(saved.docMetadata?.Command).toBe('mb aln.nex');
      // the warning is in the notes, as the alignment runner keeps it, and in no metadata row
      expect(saved.docMetadata?.Notes).toBe(`Warnings:\n- ${notConverged}\n`);
      expect(warningRows(saved)).toEqual([]);

      // a run that converged saves no Warnings block
      reply = mrBayesReply([]);
      const clean = (await runBuildTree(taxa, { method: 'MrBayes (Bayesian MCMC)' }, ctx)).created[0];
      expect(clean.docMetadata?.Notes).toBeUndefined();
      expect(warningRows(clean)).toEqual([]);
    } finally {
      delete g.__TAURI_INTERNALS__;
    }

    // The built-in engine. Its one tree warning comes only with an empty tree (a pair whose distance
    // is undefined), which is not saved as a document, so the test adds the engine's own sentence to
    // its reply for a tree that is: the built-in branch keeps warnings in the notes too.
    const undefinedDistance = engine.invokeRustBioSync<PhyloTreeInferenceReport>('construct_phylogenetic_tree', {
      names: ['clone-A', 'clone-Z'], alignedSeqs: ['A'.repeat(12), 'C'.repeat(12)],
      algorithm: 'Neighbor-Joining (NJ)', model: 'Tamura-Nei (TN93)', bootstrapReplicates: 0, jackknifePct: 0,
    });
    expect(undefinedDistance.newick).toBe('();');
    expect(undefinedDistance.warnings).toEqual([
      'clone-A vs clone-Z: distance undefined (no shared sites, or too divergent for Tamura-Nei (TN93)). Use p-distance or remove the sequence.',
    ]);
    injected.set('construct_phylogenetic_tree', undefinedDistance.warnings);
    const nj = (await runBuildTree(taxa, { method: 'Neighbor-Joining (NJ)' }, ctx)).created[0];
    expect(nj.docMetadata?.['Tree method']).toBe('Neighbor-Joining, Tamura-Nei (TN93)');
    expect(nj.docMetadata?.Notes).toBe(`Warnings:\n- ${undefinedDistance.warnings[0]}\n`);
    expect(warningRows(nj)).toEqual([]);

    injected.clear();
    const cleanNj = (await runBuildTree(taxa, { method: 'Neighbor-Joining (NJ)' }, ctx)).created[0];
    expect(cleanNj.docMetadata?.Notes).toBeUndefined();
  });

  it('keeps engine warnings in the saved result document built by the tree runner with little bootstraps, by each method that offers them', async () => {
    const ctx = { sourceLabel: '4 selected sequences' };
    // Little bootstraps on this short alignment draw samples of 23 sites, far under the 1,000 sites
    // the support search wants, so it warns that support is underestimated. The runner has three
    // places that take that caveat: the Neighbor-Joining branch, the Minimum-Evolution /
    // Maximum-Parsimony search and the Maximum-Likelihood search; each must keep it in the notes.
    const small = 'Little samples of 23 sites are small: support is underestimated on short alignments. Little bootstraps are meant for long (genome-scale) alignments; the standard bootstrap is more reliable here.';
    const little = { resampling: 'little', replicates: 2, littleSamples: 1, seed: 7 };
    for (const method of ['Neighbor-Joining (NJ)', 'Minimum-Evolution (ME)', 'Maximum Likelihood (ML)']) {
      const saved = (await runBuildTree(fourDiverged(), { method, ...little }, ctx)).created[0];
      // the support really is the little bootstrap, of the sample size the caveat names
      expect(saved.docMetadata?.['Branch support']).toBe('little bootstraps: 1 little samples of 23 sites × 2 replicates, averaged (%)');
      // the caveat is in the notes, the one convention, and in no metadata row
      expect(saved.docMetadata?.Notes).toBe(`Warnings:\n- ${small}\n`);
      expect(warningRows(saved)).toEqual([]);
    }
  });

  it('keeps engine warnings in the saved result documents built by the timetree runner', async () => {
    const ctx = { sourceLabel: '4 selected sequences' };
    const nj = (await runBuildTree(fourDiverged(), { method: 'Neighbor-Joining (NJ)' }, ctx)).created[0];
    expect(nj.docMetadata?.Notes).toBeUndefined();
    const timetree = async (calibrations: unknown[]) => {
      const r = await runComputeTimetree(nj, { calibrations: JSON.stringify(calibrations) }, { sourceLabel: nj.name });
      expect(r.created.map((d) => d.docMetadata?.['Document Type'] ?? d.documentKind)).toEqual(['tree', 'Text Document']);
      return r.created;
    };

    // No calibrations: the ages are relative. The timetree keeps that in its notes, and its
    // divergence-time report ends with the same block, written by the same helper.
    const relative = 'No calibrations: ages are relative (root = 1).';
    const [tree, report] = await timetree([]);
    expect(tree.docMetadata?.Notes).toBe(`Warnings:\n- ${relative}\n`);
    expect(warningRows(tree)).toEqual([]);
    const notes = String(report.docMetadata?.Notes);
    expect(notes.endsWith(`Confidence intervals were not requested.\n\nWarnings:\n- ${relative}\n`)).toBe(true);
    expect(notes.match(/^Warnings:$/gm)).toEqual(['Warnings:']);

    // A calibration on a taxon the tree does not have is ignored (a D0005 fallback): both
    // documents keep that warning and the relative-ages one, each on its own line, in order. Given
    // twice, it is ignored twice and listed once, as withWarningNotes lists each warning (a block
    // written by hand, as the report's once was, lists it twice).
    const ignored = 'Calibration clone-A + clone-Q: taxon not in the ingroup; ignored.';
    const offTree = { taxonA: 'clone-A', taxonB: 'clone-Q', minAge: 10, maxAge: 20 };
    const [tree2, report2] = await timetree([offTree, offTree]);
    expect(tree2.docMetadata?.Notes).toBe(`Warnings:\n- ${ignored}\n- ${relative}\n`);
    expect(warningRows(tree2)).toEqual([]);
    expect(String(report2.docMetadata?.Notes).endsWith(`\n\nWarnings:\n- ${ignored}\n- ${relative}\n`)).toBe(true);

    // A calibration the tree meets: no warning, so neither document has a Warnings block.
    const [tree3, report3] = await timetree([{ taxonA: 'clone-A', taxonB: 'clone-B', minAge: 10, maxAge: 20 }]);
    expect(tree3.docMetadata?.['Root age']).not.toBe('1.0000');
    expect(tree3.docMetadata?.Notes).toBeUndefined();
    expect(warningRows(tree3)).toEqual([]);
    expect(String(report3.docMetadata?.Notes)).not.toMatch(/^Warnings:$/m);
  });

  it('stops Build Tree with the tree engine\'s own warning when the engine returns no tree', async () => {
    const ctx = { sourceLabel: '3 selected sequences' };
    // A twelve-A clone and a twelve-C clone have no base in common, so their Tamura-Nei distance is
    // undefined and the built-in engine replies with an empty tree and a sentence that says which
    // pair and what to do; the Build Tree dialog shows the runner's error (OperationDialog), so the
    // researcher reads that sentence, not that the empty tree is an incomplete Newick tree.
    const set = [doc('x', 'clone-A', 'A'.repeat(12)), doc('y', 'clone-C', 'C'.repeat(12)), doc('z', 'clone-M', 'ACGTACGTAAAA')];
    const noTree = 'clone-A vs clone-C: distance undefined (no shared sites, or too divergent for Tamura-Nei (TN93)). Use p-distance or remove the sequence.';
    for (const method of ['Neighbor-Joining (NJ)', 'UPGMA']) {
      await expect(runBuildTree(set, { method }, ctx)).rejects.toThrow(new Error(noTree));
    }
    // the same sentence is the engine's own, for the alignment the runner builds from these clones
    const aligned = runMultipleAlignment(set, {}, ctx).created[0].alignmentMeta!.sequences!;
    const reply = engine.invokeRustBioSync<PhyloTreeInferenceReport>('construct_phylogenetic_tree', {
      names: aligned.map((m) => m.name), alignedSeqs: aligned.map((m) => m.sequence.toUpperCase()),
      algorithm: 'Neighbor-Joining (NJ)', model: 'Tamura-Nei (TN93)', bootstrapReplicates: 0, jackknifePct: 0,
    });
    expect(reply.newick).toBe('();');
    expect(reply.warnings).toEqual([noTree]);
  });
});

describe('studios', () => {
  it('shows the MSA truncation warning in the alignment studio', () => {
    const warning = realTruncationWarning();
    const render = () => renderToStaticMarkup(<SequenceAlignmentStudio documents={[seqA, seqB]} activeDoc={seqA} />);

    injected.set('run_msa', [warning]);
    const html = render();
    const found = regions(html);
    expect(found.map((r) => r.sentences)).toEqual([[warning]]);
    expect(found[0].tag).toContain('aria-label="Alignment warnings"');
    // beside the alignment it belongs to: in the MSA workbench, directly above the grid's toolbar,
    // not at the top of the studio card where an alignment error shows
    const workbench = html.indexOf('<div class="mbc-aln-workbench">');
    const toolbar = html.indexOf('<div class="mbc-aln-action-toolbar">');
    expect(workbench).toBeGreaterThan(-1);
    expect(found[0].at).toBeGreaterThan(workbench);
    expect(found[0].end).toBe(toolbar);
    // and the alignment is drawn below it: both members' rows
    expect(html.slice(toolbar)).toContain('clone-A');
    expect(html.slice(toolbar)).toContain('clone-B');

    // the same alignment from a reply with no warnings shows no warning
    injected.clear();
    expect(regions(render())).toEqual([]);
  });

  it('shows the protease fallback warning beside the MS digest', () => {
    const protein = doc('p', 'GFP fragment', 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK', 'Protein');
    // the engine's reply for a protease it does not know: the Trypsin digest, saying so (US-01M6P2QH AC2)
    const unknown = engine.simulateProteolyticDigestMsRust(protein.sequence, 'Pepsin A');
    expect(unknown.protease).toBe('Trypsin');
    expect(unknown.warnings).toEqual(["Unknown protease 'Pepsin A': digested with Trypsin."]);
    const fallback = unknown.warnings![0];
    const render = () => renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={protein} allDocuments={[protein]} initialSubTab="protein" />);

    // the studio asks for Trypsin, its default; the engine is asked for Pepsin A in its place
    digestAsked.protease = 'Pepsin A';
    const html = render();
    const found = regions(html);
    expect(found.map((r) => r.sentences)).toEqual([[fallback]]);
    expect(found[0].tag).toContain('aria-label="Digest warnings"');
    // beside the digest: under the digest card's heading and protease choice, above its masses and
    // peptide count
    const heading = html.indexOf('Proteomics LC-MS/MS Digest');
    const select = html.indexOf('<option value="Trypsin"', heading);
    const kpis = html.indexOf('<div class="thermo-kpi-grid">', heading);
    expect(heading).toBeGreaterThan(-1);
    expect(html.slice(kpis)).toMatch(/^<div class="thermo-kpi-grid"><div class="kpi-box"><span class="kpi-label">Intact Mass \(Mono\)/);
    expect(found[0].at).toBeGreaterThan(select);
    expect(found[0].at).toBeLessThan(kpis);

    // the same digest of the protease the studio asked for shows no warning
    digestAsked.protease = undefined;
    const clean = render();
    expect(regions(clean)).toEqual([]);
    expect(clean).toContain('Intact Mass (Mono)');
  });
});
