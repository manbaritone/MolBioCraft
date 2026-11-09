// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S13D: the protein tab says what it analysed, the epitope list covers the whole chain, and
 * the 3D contact overlay draws contacts from the whole structure.
 *
 * Every engine reply here comes from the real WASM engine. Inputs are generated from fixed seeds.
 * - The protein tab analysed only residues 1..4,000 of a protein document and said nothing. It now
 *   analyses a protein whole up to 40,000 residues (titin, the longest known protein, is 34,350 aa),
 *   counting residues as the engine does (a stop or gap is not one), and past that says which
 *   residues it covered of how many.
 * - Of a DNA or RNA document the engine analyses the protein of one ORF or frame of the bases it
 *   is given (the CDS, or with no CDS the first 1,200 bp): the longest forward ORF of at least
 *   30 aa, or with none the frame with the fewest stops. The tab now names those bases, in the
 *   document's coordinates, whenever they are not the whole CDS (or, with no CDS, the whole
 *   molecule) as one ORF. The tests find the ORF by the rule written out here and check that the
 *   molecular weight and length shown are those of the translation of exactly the bases named.
 * - The epitope count, the Annotate button and the table read the engine's list, which stopped
 *   after 16 regions; they now show every region along the chain.
 * - The viewer drew at most the first 450 contacts it was given, and the engine gave at most 160
 *   from the first 600 atoms. The viewer test mounts the viewer with React's client renderer (the
 *   one the app runs) on a small node tree, since the repo carries no DOM library, clicks its
 *   Contacts button, and counts the dashed lines its canvas is asked to draw.
 *
 * BG-01M6SQXX: a DNA document the engine translates to no residue ('TAA', 'AC', an empty one)
 * threw on the engine's null charge. The tab now renders, says nothing was translated, and reads
 * each protein KPI with no answer as one shared n/a string, not as the empty protein's zeros and
 * nulls; a count of what was found in no residue stays its zero.
 */

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HybridToolsAndHistoryStudio, NO_RESIDUE_TRANSLATED } from '../components/HybridToolsAndHistoryStudio';
import { CONTACT_DRAW_LIMIT, ProteinStructure3DViewer, contactOverlay } from '../components/ProteinStructure3DViewer';
import * as bio from '../core/bioEngine';
import { analyzeProteinSequence } from '../core/bioEngine';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import { alignPdbStructuresKabsch, type PdbCaAtom } from '../core/genomicsAndStructureSuite';
import { resolveContactAtomIndices, type StructureContactLike } from '../core/structureContacts';
import type { SequenceDocument, SequenceFeature } from '../types/bio';

/** Deterministic pseudo-random letters (LCG), so every run reads the same sequences. */
function randomLetters(n: number, seed: number, alphabet: string): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((s / 2 ** 32) * alphabet.length)];
  }
  return out;
}
const AA = 'ACDEFGHIKLMNPQRSTVWY';

const doc = (id: string, name: string, sequence: string, moleculeType: SequenceDocument['moleculeType'], features: SequenceFeature[] = []): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, moleculeType, features });

/** The text a reader sees: tags and comments stripped, entities decoded. */
const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** Every warnings region in the markup: its accessible name, where it starts, and its sentences. */
function regions(html: string): { label: string; at: number; sentences: string[] }[] {
  return [...html.matchAll(/(<div[^>]*data-mbc-result-warnings[^>]*>)([\s\S]*?)<\/div>/g)].map((m) => ({
    label: /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? '',
    at: m.index!,
    sentences: [...m[2].matchAll(/<p class="cloning-warning-note"[^>]*>([\s\S]*?)<\/p>/g)].map((p) => text(p[1])),
  }));
}
const proteinTab = (d: SequenceDocument) =>
  renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={d} allDocuments={[d]} initialSubTab="protein" />);
/** The protein tab's own coverage region, if it shows one. */
const coverage = (html: string) => regions(html).filter((r) => r.label === 'Protein analysis coverage');
/** The sentences of the tab's coverage region, which it must show exactly once. */
const said = (html: string) => {
  const found = coverage(html);
  expect(found, 'one coverage region').toHaveLength(1);
  return found[0].sentences;
};
/** The left card's heading: what the tab says it analysed. */
const heading = (html: string) => /EMBOSS Protein Analysis — ([^<]*(?:<!--[^>]*-->[^<]*)*)<\/h3>/.exec(html)?.[1].replace(/<!--[\s\S]*?-->/g, '');
/** The Molecular Weight figure: `<kDa> kDa (<length> aa)`. */
const molecularWeight = (html: string) => {
  const at = html.indexOf('>Molecular Weight<');
  return at < 0 ? undefined : text(html.slice(at, html.indexOf('</strong>', at)).replace(/^>Molecular Weight</, '<')).trim();
};
const kda = (seq: string, isDna: boolean) => {
  const r = analyzeProteinSequence(seq, isDna, 9);
  return `${r.molecularWeightKda} kDa (${r.lengthAa} aa)`;
};

// The bases a DNA analysis translated, found here by the rule written out (not by the engine).

/** The standard genetic code (NCBI table 1), codons in TCAG order. */
const STANDARD_CODE = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const asDna = (s: string) => s.toUpperCase().replace(/U/g, 'T');
const codonAa = (c: string) => STANDARD_CODE['TCAG'.indexOf(c[0]) * 16 + 'TCAG'.indexOf(c[1]) * 4 + 'TCAG'.indexOf(c[2])];
const translate = (s: string) => (asDna(s).match(/.../g) ?? []).map(codonAa).join('');
const revComp = (s: string) => [...asDna(s)].reverse().map((b) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[b]).join('');
/** An ORF's first and last base, 1-based, its stop codon included. */
interface Orf { start: number; end: number }
/**
 * Every forward ORF of at least 30 aa: in each frame, from an ATG to the first in-frame stop, the
 * next ATG looked for after that stop; an ATG with no stop before the end starts none.
 */
function forwardOrfs(seq: string): Orf[] {
  const s = asDna(seq);
  const out: Orf[] = [];
  for (let frame = 0; frame < 3; frame++) {
    let i = frame;
    while (i + 3 <= s.length) {
      if (s.slice(i, i + 3) !== 'ATG') { i += 3; continue; }
      let j = i + 3;
      while (j + 3 <= s.length && codonAa(s.slice(j, j + 3)) !== '*') j += 3;
      if (j + 3 > s.length) { i += 3; continue; }
      if ((j - i) / 3 >= 30) out.push({ start: i + 1, end: j + 3 });
      i = j + 3;
    }
  }
  return out;
}
/** The longest forward ORF, the first-starting of two as long. */
const longestOrf = (seq: string) =>
  forwardOrfs(seq).reduce<Orf | null>((best, o) => {
    const [len, bestLen] = [o.end - o.start, best ? best.end - best.start : -1];
    return len > bestLen || (best && len === bestLen && o.start < best.start) ? o : best;
  }, null);
/** The forward frame with the fewest stop codons, the lowest of two with as few, through its last whole codon. */
function fewestStopFrame(seq: string): { frame: number; start: number; end: number; stops: number } {
  const frames = [0, 1, 2].map((f) => {
    const codons = Math.floor((seq.length - f) / 3);
    return { frame: f + 1, start: f + 1, end: f + 3 * codons, stops: [...translate(seq.slice(f, f + 3 * codons))].filter((a) => a === '*').length };
  });
  return frames.reduce((best, f) => (f.stops < best.stops ? f : best));
}
/** A gene of `codons` sense codons between ATG and TAA. */
function gene(codons: number, seed: number): string {
  const sense = ['GCT', 'GAA', 'CTG', 'AAA', 'GTT', 'TCC', 'CGT', 'GGC'];
  return `ATG${[...randomLetters(codons, seed, '01234567')].map((k) => sense[Number(k)]).join('')}TAA`;
}
/**
 * The protein of document bases `from`..`to` (read on the minus strand if asked): an ORF's
 * translation without its closing stop, or a frame's with every stop left out.
 */
function namedProtein(seq: string, from: number, to: number, rule: 'orf' | 'frame', minus = false): string {
  const bases = seq.slice(from - 1, to);
  const protein = translate(minus ? revComp(bases) : bases);
  if (rule === 'frame') return protein.replace(/\*/g, '');
  expect(protein.indexOf('*')).toBe(protein.length - 1);
  return protein.slice(0, -1);
}

// The sentence the tab owes for those bases.
const grouped = (v: number) => v.toLocaleString('en-US');
interface Owed { of: number; slice?: number; cds?: string; minus?: boolean }
const owedBases = (from: number, to: number, o: Owed) =>
  `${o.minus ? 'the minus-strand bases' : 'bases'} ${grouped(from)}–${grouped(to)} of ${grouped(o.of)}${o.cds ? `, not the whole CDS ${o.cds}` : ''}`;
const owedWhere = (o: Owed) => (o.cds ? 'read along the CDS' : `on the forward strand of bases 1–${grouped(o.slice!)}`);
const owedOrf = (from: number, to: number, o: Owed) =>
  `Protein analysis covered ${owedBases(from, to, o)}: ${o.cds ? '' : 'with no CDS feature, '}it analyses the longest ORF (ATG to the first in-frame stop, at least 30 aa) ${owedWhere(o)}, a ${grouped((to - from + 1) / 3 - 1)}-aa protein.`;
const owedFrame = (f: { frame: number; start: number; end: number; stops: number }, o: Owed) =>
  `Protein analysis covered ${owedBases(f.start, f.end, o)}: ${o.cds ? 'with' : 'with no CDS feature and'} no ORF of at least 30 aa ${owedWhere(o)}, it analyses ${o.cds ? "the CDS's " : ''}reading frame ${f.frame}, the frame with the fewest stop codons, as ${grouped((f.end - f.start + 1) / 3 - f.stops)} aa with its ${grouped(f.stops)} stop codon${f.stops === 1 ? '' : 's'} left out.`;

describe('protein analysis coverage', () => {
  it('says which residues protein analysis covered', () => {
    // over the old 4,000 aa cut: analysed whole, and nothing is said to be cut
    const seq = randomLetters(10_000, 0x13d01, AA);
    const html = proteinTab(doc('p10k', 'Long protein', seq, 'Protein'));
    expect(heading(html)).toBe('Long protein (1..10000 aa)');
    expect(molecularWeight(html)).toBe(kda(seq, false));
    expect(molecularWeight(html)).toContain('(10000 aa)');
    expect(coverage(html)).toEqual([]);

    // over the 40,000 aa the tab analyses: it says which residues of how many, beside the result
    const huge = randomLetters(45_000, 0x13d02, AA);
    const cut = proteinTab(doc('p45k', 'Concatemer', huge, 'Protein'));
    expect(heading(cut)).toBe('Concatemer (1..40000 aa)');
    expect(molecularWeight(cut)).toBe(kda(huge.slice(0, 40_000), false));
    const found = coverage(cut);
    expect(found.map((r) => r.sentences)).toEqual([['Protein analysis covered residues 1–40,000 of 45,000: it reads at most 40,000 aa.']]);
    // above both result cards, under the tab strip
    expect(found[0].at).toBeLessThan(cut.indexOf('<div class="studio-split-grid">'));
    expect(found[0].at).toBeGreaterThan(cut.indexOf('Protein analysis and history'));

    // one residue over says so too; exactly 40,000 is whole
    const edge = randomLetters(40_001, 0x13d03, AA);
    expect(said(proteinTab(doc('e1', 'Edge', edge, 'Protein'))))
      .toEqual(['Protein analysis covered residues 1–40,000 of 40,001: it reads at most 40,000 aa.']);
    expect(coverage(proteinTab(doc('e0', 'Edge', edge.slice(0, 40_000), 'Protein')))).toEqual([]);

    // Residues are counted as the engine counts them, so a stop or a gap is not one.
    // 40,000 residues and a closing stop: analysed whole, nothing said
    const stopped = proteinTab(doc('e*', 'Stopped', `${edge.slice(0, 40_000)}*`, 'Protein'));
    expect(coverage(stopped)).toEqual([]);
    expect(heading(stopped)).toBe('Stopped (1..40000 aa)');
    expect(molecularWeight(stopped)).toBe(kda(edge.slice(0, 40_000), false));
    // 40,005 residues with a gap after every 1,000th: the first 40,000 residues, of 40,005
    const gapped = huge.slice(0, 40_000).replace(/.{1000}/g, '$&-') + huge.slice(40_000, 40_005);
    expect(gapped.replace(/[^A-Z]/g, '')).toBe(huge.slice(0, 40_005));
    const gappedTab = proteinTab(doc('e-', 'Gapped', gapped, 'Protein'));
    expect(said(gappedTab)).toEqual(['Protein analysis covered residues 1–40,000 of 40,005: it reads at most 40,000 aa.']);
    expect(heading(gappedTab)).toBe('Gapped (1..40000 aa)');
    expect(molecularWeight(gappedTab)).toBe(kda(huge.slice(0, 40_000), false));
    // and a short protein's heading counts its residues, not its stop
    expect(heading(proteinTab(doc('s*', 'Short', `${seq.slice(0, 100)}*`, 'Protein')))).toBe('Short (1..100 aa)');
  }, 60_000);

  it('says which bases DNA-without-CDS analysis covered', () => {
    // The engine analyses one ORF (or, with none, one frame) of the bases it is given, so the tab
    // must name that ORF in the document's bases. Each case checks the sentence against an ORF
    // found here by the rule written out, and checks that the molecular weight and length shown
    // are those of the translation of exactly the bases the sentence names.
    const dna = randomLetters(5_000, 0x13d04, 'ACGT');
    const html = proteinTab(doc('d5k', 'Contig', dna, 'DNA'));
    expect(heading(html)).toBe('Contig (1..1200)');
    // the analysis is of those bases: the engine's own analysis of the first 1,200 bp
    expect(molecularWeight(html)).toBe(kda(dna.slice(0, 1_200), true));
    expect(molecularWeight(html)).not.toBe(kda(dna, true));
    const found = coverage(html);
    const orf = longestOrf(dna.slice(0, 1_200))!;
    expect(found.map((r) => r.sentences)).toEqual([[owedOrf(orf.start, orf.end, { of: 5_000, slice: 1_200 })]]);
    expect(molecularWeight(html)).toBe(kda(namedProtein(dna, orf.start, orf.end, 'orf'), false));
    expect(found[0].at).toBeLessThan(html.indexOf('<div class="studio-split-grid">'));

    // More seeds: the ORF starts past base 1 every time, and on one the first ORF is not the longest.
    let firstIsNotLongest = false;
    for (const seed of [0x13d04, 0x13d08, 0x13d09, 0x13d0a]) {
      const contig = randomLetters(5_000, seed, 'ACGT');
      const best = longestOrf(contig.slice(0, 1_200))!;
      const tab = proteinTab(doc(`s${seed}`, 'Contig', contig, 'DNA'));
      expect(said(tab)).toEqual([owedOrf(best.start, best.end, { of: 5_000, slice: 1_200 })]);
      expect(molecularWeight(tab)).toBe(kda(namedProtein(contig, best.start, best.end, 'orf'), false));
      expect(best.start).toBeGreaterThan(1);
      firstIsNotLongest ||= Math.min(...forwardOrfs(contig.slice(0, 1_200)).map((o) => o.start)) !== best.start;
    }
    expect(firstIsNotLongest).toBe(true);

    // A longer ORF on the reverse strand is not the one analysed.
    const withReverse = `${randomLetters(150, 0x13d0b, 'ACGT')}${gene(40, 0x13d0c)}${randomLetters(60, 0x13d0d, 'ACGT')}${revComp(gene(250, 0x13d0e))}${randomLetters(2_000, 0x13d0f, 'ACGT')}`;
    const fwd = longestOrf(withReverse.slice(0, 1_200))!;
    const rev = longestOrf(revComp(withReverse.slice(0, 1_200)))!;
    expect(rev.end - rev.start).toBeGreaterThan(fwd.end - fwd.start);
    const reverseTab = proteinTab(doc('rv', 'Contig', withReverse, 'DNA'));
    expect(said(reverseTab)).toEqual([owedOrf(fwd.start, fwd.end, { of: withReverse.length, slice: 1_200 })]);
    expect(molecularWeight(reverseTab)).toBe(kda(namedProtein(withReverse, fwd.start, fwd.end, 'orf'), false));

    // No ATG in the first 1,200 bp: the frame with the fewest stops (here frames 1, 3 and 2).
    let laterFrame = false;
    for (const seed of [0x13d10, 0x13d19, 0x13d1b]) {
      const noAtg = randomLetters(5_000, seed, 'ACGT').replace(/ATG/g, 'ACG');
      expect(forwardOrfs(noAtg.slice(0, 1_200))).toEqual([]);
      const f = fewestStopFrame(noAtg.slice(0, 1_200));
      const tab = proteinTab(doc(`n${seed}`, 'Contig', noAtg, 'DNA'));
      expect(said(tab)).toEqual([owedFrame(f, { of: 5_000, slice: 1_200 })]);
      expect(molecularWeight(tab)).toBe(kda(namedProtein(noAtg, f.start, f.end, 'frame'), false));
      laterFrame ||= f.frame > 1;
    }
    expect(laterFrame).toBe(true);
    // with no stop in any frame, all three tie and the first is read: bases 1–1,200, none left out
    const noStop = randomLetters(5_000, 0x13d13, 'CGT');
    const tied = fewestStopFrame(noStop.slice(0, 1_200));
    expect(tied).toEqual({ frame: 1, start: 1, end: 1_200, stops: 0 });
    expect(said(proteinTab(doc('ns', 'Contig', noStop, 'DNA')))).toEqual([owedFrame(tied, { of: 5_000, slice: 1_200 })]);

    // A molecule under 1,200 bp is still analysed as its longest ORF, and says so; one that is a
    // single ORF from end to end is analysed whole, with nothing to say.
    const short = dna.slice(0, 1_200);
    expect(said(proteinTab(doc('d1k', 'Short', short, 'DNA')))).toEqual([owedOrf(orf.start, orf.end, { of: 1_200, slice: 1_200 })]);
    const oneOrf = gene(120, 0x13d14);
    const oneOrfTab = proteinTab(doc('d1o', 'Gene', oneOrf, 'DNA'));
    expect(coverage(oneOrfTab)).toEqual([]);
    expect(molecularWeight(oneOrfTab)).toBe(kda(namedProtein(oneOrf, 1, oneOrf.length, 'orf'), false));
    expect(molecularWeight(oneOrfTab)).toContain('(121 aa)');
    // Whole needs all three: one ORF, from base 1, to the last base of the whole molecule.
    const tail = gene(120, 0x13d18);
    expect(longestOrf(`CCC${tail}`)).toEqual({ start: 4, end: 369 });
    expect(said(proteinTab(doc('ds', 'Gene', `CCC${tail}`, 'DNA')))).toEqual([owedOrf(4, 369, { of: 369, slice: 369 })]);
    expect(longestOrf(`${tail}CCC`)).toEqual({ start: 1, end: 366 });
    expect(said(proteinTab(doc('de', 'Gene', `${tail}CCC`, 'DNA')))).toEqual([owedOrf(1, 366, { of: 369, slice: 369 })]);
    // the first 1,200 bp as one ORF are not the whole of a longer molecule
    const head = `${gene(398, 0x13d19)}${randomLetters(3_800, 0x13d1a, 'ACGT')}`;
    expect(longestOrf(head.slice(0, 1_200))).toEqual({ start: 1, end: 1_200 });
    expect(said(proteinTab(doc('dh', 'Contig', head, 'DNA')))).toEqual([owedOrf(1, 1_200, { of: 5_000, slice: 1_200 })]);
    // nor is a frame translated from end to end, with no ATG to start it
    const cgt = randomLetters(1_200, 0x13d13, 'CGT');
    expect(said(proteinTab(doc('dg', 'Contig', cgt, 'DNA'))))
      .toEqual([owedFrame({ frame: 1, start: 1, end: 1_200, stops: 0 }, { of: 1_200, slice: 1_200 })]);

    // A CDS is analysed as the longest ORF read along it, named in the document's bases.
    const cds: SequenceFeature = { id: 'c1', name: 'orf1', type: 'CDS', start: 1, end: 4_500, strand: 1, color: '#000' };
    const withCds = proteinTab(doc('dc', 'Contig', dna, 'DNA', [cds]));
    expect(heading(withCds)).toBe('orf1 (1..4500)');
    const inCds = longestOrf(dna.slice(0, 4_500))!;
    expect(said(withCds)).toEqual([owedOrf(inCds.start, inCds.end, { of: 5_000, cds: 'orf1' })]);
    expect(molecularWeight(withCds)).toBe(kda(namedProtein(dna, inCds.start, inCds.end, 'orf'), false));
    // a CDS that starts past base 1: the bases are the document's, not the CDS's own
    const later: SequenceFeature = { ...cds, start: 101, end: 4_600 };
    const inLater = longestOrf(dna.slice(100, 4_600))!;
    const laterTab = proteinTab(doc('dl', 'Contig', dna, 'DNA', [later]));
    expect(said(laterTab)).toEqual([owedOrf(100 + inLater.start, 100 + inLater.end, { of: 5_000, cds: 'orf1' })]);
    expect(molecularWeight(laterTab)).toBe(kda(namedProtein(dna, 100 + inLater.start, 100 + inLater.end, 'orf'), false));
    // a minus-strand CDS is read along its own strand, and its bases counted back from its end
    const minus: SequenceFeature = { ...cds, name: 'orfR', start: 201, end: 4_800, strand: -1 };
    const inMinus = longestOrf(revComp(dna.slice(200, 4_800)))!;
    const [mFrom, mTo] = [4_800 - inMinus.end + 1, 4_800 - inMinus.start + 1];
    const minusTab = proteinTab(doc('dm', 'Contig', dna, 'DNA', [minus]));
    expect(said(minusTab)).toEqual([owedOrf(mFrom, mTo, { of: 5_000, cds: 'orfR', minus: true })]);
    expect(molecularWeight(minusTab)).toBe(kda(namedProtein(dna, mFrom, mTo, 'orf', true), false));
    // a CDS with no ORF of 30 aa: its frame with the fewest stops
    const noAtg = randomLetters(5_000, 0x13d10, 'ACGT').replace(/ATG/g, 'ACG');
    const frameCds: SequenceFeature = { ...cds, name: 'orfF', start: 51, end: 3_050 };
    const f = fewestStopFrame(noAtg.slice(50, 3_050));
    const frameTab = proteinTab(doc('df', 'Contig', noAtg, 'DNA', [frameCds]));
    const shifted = { ...f, start: 50 + f.start, end: 50 + f.end };
    expect(said(frameTab)).toEqual([owedFrame(shifted, { of: 5_000, cds: 'orfF' })]);
    expect(molecularWeight(frameTab)).toBe(kda(namedProtein(noAtg, shifted.start, shifted.end, 'frame'), false));

    // Nothing to say when a CDS is analysed whole, on either strand.
    const g = gene(300, 0x13d15);
    const host = `${randomLetters(300, 0x13d16, 'ACGT')}${g}${randomLetters(700, 0x13d17, 'ACGT')}`;
    const whole: SequenceFeature = { ...cds, name: 'geneW', start: 301, end: 300 + g.length };
    const wholeTab = proteinTab(doc('dw', 'Host', host, 'DNA', [whole]));
    expect(coverage(wholeTab)).toEqual([]);
    expect(molecularWeight(wholeTab)).toBe(kda(namedProtein(host, 301, 300 + g.length, 'orf'), false));
    const hostR = `${randomLetters(300, 0x13d16, 'ACGT')}${revComp(g)}${randomLetters(700, 0x13d17, 'ACGT')}`;
    const wholeR = proteinTab(doc('dwr', 'Host', hostR, 'DNA', [{ ...whole, strand: -1 }]));
    expect(coverage(wholeR)).toEqual([]);
    expect(molecularWeight(wholeR)).toBe(kda(namedProtein(hostR, 301, 300 + g.length, 'orf', true), false));

    // an RNA document without a CDS is cut the same way, and names the same bases
    const rna = dna.replace(/T/g, 'U');
    expect(said(proteinTab(doc('r5k', 'Transcript', rna, 'RNA')))).toEqual([owedOrf(orf.start, orf.end, { of: 5_000, slice: 1_200 })]);

    // an engine build that does not report the bases it translated is not read as a whole analysis
    const real = bio.analyzeProteinSequence;
    const stale = vi.spyOn(bio, 'analyzeProteinSequence').mockImplementation((...args) => {
      const { translatedSpan: _dropped, ...rest } = real(...args) as ReturnType<typeof real> & { translatedSpan?: unknown };
      return rest;
    });
    try {
      expect(said(proteinTab(doc('d1o', 'Gene', oneOrf, 'DNA'))))
        .toEqual([`Protein analysis did not report which of bases 1–${oneOrf.length} of ${oneOrf.length} it translated.`]);
    } finally {
      stale.mockRestore();
    }
  }, 60_000);

  it('lists every antigenic region the engine finds along the whole chain', () => {
    const seq = randomLetters(10_000, 0x13d05, AA);
    const all = analyzeProteinSequence(seq, false, 9).antigenicDeterminants;
    // the fixture reaches past the old 16-region stop and the old 4,000 aa cut
    expect(all.length).toBeGreaterThan(16 * 4);
    const last = all[all.length - 1];
    expect(last.endAa).toBeGreaterThan(9_000);
    const d = doc('ep', 'Epitopes', seq, 'Protein');
    // with a document to annotate, as the app opens the tab, so the Annotate button is shown
    const html = renderToStaticMarkup(
      <HybridToolsAndHistoryStudio doc={d} allDocuments={[d]} initialSubTab="protein" onUpdateDocument={() => {}} />
    );
    expect(text(html)).toContain(`Antigenic Epitopes${all.length} regions`);
    expect(text(html)).toContain(`+ Annotate ${all.length} Predicted Antigenic Epitopes onto Epitopes`);
    // the table holds every region, the last one too
    const rows = [...text(html).matchAll(/aa (\d+)\.\.(\d+)([A-Z]+)(\d+) aa/g)].map((m) => [Number(m[1]), Number(m[2]), m[3]]);
    expect(rows).toEqual(all.map((r) => [r.startAa, r.endAa, r.peptide]));
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// A document the engine translates to no residue

/** Every KPI box on the tab, as its label and the value it reads, in the text a reader sees. */
const kpiBoxes = (html: string) =>
  [...html.matchAll(/<div class="kpi-box"><span class="kpi-label"[^>]*>([\s\S]*?)<\/span><strong class="kpi-val"[^>]*>([\s\S]*?)<\/strong><\/div>/g)]
    .map((m) => [text(m[1]).trim(), text(m[2]).trim()] as const);
/** The value of the one KPI box with this label, which the tab must show exactly once. */
const kpi = (html: string, label: string) => {
  const found = kpiBoxes(html).filter(([l]) => l === label);
  expect(found, `one "${label}" box`).toHaveLength(1);
  return found[0][1];
};
/** DNA documents the engine translates to no residue, and their length: a lone stop, part of a codon, no bases. */
const UNTRANSLATED = [['TAA', 3], ['AC', 2], ['', 0]] as const;
/** The boxes that have no answer when no residue was translated, by their labels on the tab. */
const NO_ANSWER = [
  'Molecular Weight', 'Isoelectric Point (pI)', 'Charge at pH 7', 'ε₂₈₀ reduced / cystines (M⁻¹cm⁻¹)', 'A[280] of 1 mg/ml',
  'GRAVY / Aliphatic', 'α-Helix (GOR H)', 'β-Sheet (GOR E)', 'Random Coil (C)', 'Intact Mass (Mono)',
];

describe('a document that translates to nothing', () => {
  it('renders the protein tab for a document that translates to nothing', () => {
    // the fixtures reach the crash: the engine translated no residue and gives no charge
    for (const [seq] of UNTRANSLATED) {
      expect(analyzeProteinSequence(seq, true, 9)).toMatchObject({ lengthAa: 0, translatedSpan: null, chargeAtPh7: null });
    }
    for (const [seq, of] of UNTRANSLATED.slice(0, 2)) {
      const html = proteinTab(doc(`u${seq}`, 'Stub', seq, 'DNA'));
      expect(said(html)).toEqual([`Protein analysis covered no bases of ${of}: no residue was translated from the molecule.`]);
      // and the result cards are drawn, below the sentence
      expect(heading(html)).toBe(`Stub (1..${of})`);
      expect(html).toContain('<div class="studio-split-grid">');
      expect(coverage(html)[0].at).toBeLessThan(html.indexOf('<div class="studio-split-grid">'));
    }
    // an empty document is said to hold no bases, not to have had none of 0 covered
    const empty = proteinTab(doc('u0', 'Empty', '', 'DNA'));
    expect(said(empty)).toEqual(['The document holds no bases; nothing was translated.']);
    expect(text(empty)).not.toContain('covered no bases of 0');
    expect(kpiBoxes(empty).map(([label]) => label)).toEqual(expect.arrayContaining(NO_ANSWER));
  });

  it('reads n/a for every protein KPI when no residue was translated', () => {
    expect(NO_RESIDUE_TRANSLATED).toBe('n/a: no residue translated');
    for (const [seq] of UNTRANSLATED) {
      const html = proteinTab(doc(`n${seq}`, 'Stub', seq, 'DNA'));
      for (const label of NO_ANSWER) {
        // the string once, in place of the value (of both values, in a two-value box): no figure
        expect(kpi(html, label), `${label} of '${seq}'`).toBe(NO_RESIDUE_TRANSLATED);
        expect(kpi(html, label)).not.toMatch(/\d/);
      }
      // the digest of no residue found no peptide: the count stays, the coverage has no answer
      expect(kpi(html, 'Observable MS1 Peptides')).toBe(`0 (${NO_RESIDUE_TRANSLATED})`);
      // what was found in no residue is nothing, and that zero is the answer
      expect(kpi(html, 'Antigenic Epitopes')).toBe('0 regions');
      expect(kpi(html, 'PTMs / PEST Degrons')).toBe('0 / 0');
      expect(kpi(html, 'Predicted Disulfides')).toBe('0 (0 Cys)');
    }

    // Control: a 30-codon ORF, analysed whole, reads a figure in every one of those boxes, a zero
    // one included (its residues hold no W, Y or C, so its extinction is 0).
    const orf = gene(29, 0x5c0f);
    expect(longestOrf(orf)).toEqual({ start: 1, end: 93 });
    const tab = proteinTab(doc('o30', 'Gene', orf, 'DNA'));
    expect(coverage(tab)).toEqual([]);
    expect(molecularWeight(tab)).toBe(kda(orf, true));
    expect(molecularWeight(tab)).toContain('(30 aa)');
    expect(kpi(tab, 'ε₂₈₀ reduced / cystines (M⁻¹cm⁻¹)')).toBe('0 / 0');
    for (const label of NO_ANSWER) {
      expect(kpi(tab, label), label).toMatch(/\d/);
      expect(kpi(tab, label), label).not.toContain('n/a');
    }
    expect(kpi(tab, 'Observable MS1 Peptides')).toMatch(/^\d+ \(\d+\.\d% cov\)$/);

    // No residue is the engine's count, not an empty first frame: 'TAAA' reads K in frame 2.
    const k = analyzeProteinSequence('TAAA', true, 9);
    expect(k.lengthAa).toBe(1);
    expect(k.aminoAcidCounts).toEqual({ K: 1 });
    const kTab = proteinTab(doc('k1', 'Stub', 'TAAA', 'DNA'));
    expect(molecularWeight(kTab)).toBe(kda('TAAA', true));
    expect(kpi(kTab, 'Charge at pH 7')).toMatch(/\d/);
  });
});

// ---------------------------------------------------------------------------------------------
// The 3D viewer's contact overlay

/** A compact chain: a serpentine walk through a 3.8 Å cubic lattice, each point moved up to 0.3 Å. */
function latticePdb(n: number, side: number, seed: number): string {
  let s = seed >>> 0;
  const jitter = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.6;
  const lines: string[] = [];
  for (let k = 0; k < n; k++) {
    const z = Math.floor(k / (side * side));
    const yy = Math.floor(k / side) % side;
    const xx = k % side;
    const y = z % 2 ? side - 1 - yy : yy;
    const x = (z * side + yy) % 2 ? side - 1 - xx : xx;
    const f = (v: number) => v.toFixed(3).padStart(8);
    lines.push(`ATOM  ${String(k + 1).padStart(5)}  CA  ALA A${String(k + 1).padStart(4)}    ${f(3.8 * x + jitter())}${f(3.8 * y + jitter())}${f(3.8 * z + jitter())}  1.00 50.00           C`);
  }
  return `${lines.join('\n')}\nEND\n`;
}

/**
 * The node tree React DOM's client renderer writes to: the operations it calls on a mount, a
 * re-render and a click, with listeners kept so a click can be dispatched, `options` and `value`
 * for the viewer's selects, and a canvas whose 2D context records what it is asked to draw.
 */
class TestNode {
  childNodes: TestNode[] = [];
  parentNode: TestNode | null = null;
  readonly listeners: { type: string; fn: (e: unknown) => void; capture: boolean }[] = [];
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
  addEventListener(type: string, fn: (e: unknown) => void, opts?: boolean | { capture?: boolean }) {
    this.listeners.push({ type, fn, capture: typeof opts === 'boolean' ? opts : Boolean(opts?.capture) });
  }
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
  selected = false;
  disabled = false;
  constructor(readonly tagName: string, readonly namespaceURI: string, doc: TestDocument) { super(1, tagName.toUpperCase(), doc); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  get value() { return this.attributes.get('value') ?? this.textContent; }
  set value(v: string) { this.attributes.set('value', v); }
  get options() { return this.childNodes.filter((c) => c.nodeName === 'OPTION'); }
}
/** What a canvas was asked to stroke: each path, as its segments, and the dash it was drawn with. */
interface Stroke { dash: number[]; segments: number }
class TestCanvas extends TestElement {
  readonly strokes: Stroke[] = [];
  width = 0;
  height = 0;
  getContext() {
    let dash: number[] = [];
    const saved: number[][] = [];
    let segments = 0;
    const own: Record<string, (...a: number[]) => unknown> = {
      setLineDash: (...a) => { dash = [...(a[0] as unknown as number[])]; },
      save: () => { saved.push(dash); },
      restore: () => { dash = saved.pop() ?? []; },
      beginPath: () => { segments = 0; },
      lineTo: () => { segments += 1; },
      stroke: () => { this.strokes.push({ dash, segments }); },
    };
    const gradient = { addColorStop() {} };
    return new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => (key in own ? own[key as string] : key in target ? target[key] : () => gradient),
      set: (target, key, v) => { target[key] = v; return true; },
    });
  }
}
class TestDocument extends TestNode {
  constructor() { super(9, '#document', null); }
  createElement(tag: string) { return tag === 'canvas' ? new TestCanvas(tag, 'http://www.w3.org/1999/xhtml', this) : new TestElement(tag, 'http://www.w3.org/1999/xhtml', this); }
  createElementNS(ns: string, tag: string) { return new TestElement(tag, ns, this); }
  createTextNode(t: string) { return new TestText(t, this); }
}
const find = (n: TestNode, ok: (e: TestElement) => boolean): TestElement[] =>
  [...(n instanceof TestElement && ok(n) ? [n] : []), ...n.childNodes.flatMap((c) => find(c, ok))];

/**
 * Mounts the viewer with these contacts, then clicks its Contacts button: the dashed strokes the
 * canvas was asked to draw on the last frame before the click and on the frame after, and the text
 * of any warnings region shown before and after.
 */
function viewerWithContacts(atoms: PdbCaAtom[], contacts: StructureContactLike[]) {
  const g = globalThis as { window?: unknown };
  g.window = { HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };
  try {
    const container = new TestDocument().createElement('div');
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(<ProteinStructure3DViewer primaryAtoms={atoms} contacts={contacts} />));
    const [canvas] = find(container, (e) => e instanceof TestCanvas) as TestCanvas[];
    const dashed = () => canvas.strokes.filter((s) => s.dash.join() === '3,3');
    const warnings = () => find(container, (e) => e.hasAttribute('data-mbc-result-warnings')).map((e) => e.textContent);
    const before = { dashed: dashed(), warnings: warnings(), frames: canvas.strokes.length };
    const [button] = find(container, (e) => e.nodeName === 'BUTTON' && e.textContent === 'Contacts (<8Å)');
    expect(button).toBeDefined();
    canvas.strokes.length = 0;
    const click = { type: 'click', target: button, bubbles: true, cancelable: true, defaultPrevented: false, button: 0, timeStamp: 0, preventDefault() {}, stopPropagation() {} };
    const handlers = container.listeners.filter((l) => l.type === 'click').sort((a, b) => Number(b.capture) - Number(a.capture));
    flushSync(() => handlers.forEach((l) => l.fn(click)));
    const after = { dashed: dashed(), warnings: warnings(), button: button.textContent };
    root.unmount();
    return { before, after };
  } finally {
    delete g.window;
  }
}

describe('3D contact overlay', () => {
  // A 300-residue structure, through the engine the 3D tab calls (A against itself)
  const pdb = latticePdb(300, 7, 0x13d06);
  const report = alignPdbStructuresKabsch(pdb, pdb);
  const atoms = report.atomsA ?? [];
  const contacts = (report.intraChainContacts ?? []) as unknown as StructureContactLike[];

  it('draws every contact of a 300-residue structure, the C-terminal half included', () => {
    expect(atoms).toHaveLength(300);
    const pairs = contacts.map((c) => resolveContactAtomIndices(c)!);
    // the engine's contacts span the chain: well over the 160 it once stopped at, from both halves
    expect(contacts.length).toBeGreaterThan(450 * 4);
    expect(pairs.filter(([i]) => i >= 150).length).toBeGreaterThan(450);
    expect(Math.max(...pairs.map(([, j]) => j))).toBe(299);

    expect(contactOverlay(contacts)).toEqual({ drawn: contacts, warning: null });
    const { before, after } = viewerWithContacts(atoms, contacts);
    // off until asked for
    expect(before.frames).toBeGreaterThan(0);
    expect(before.dashed).toEqual([]);
    // on: one dashed path holding a line for every contact, and nothing said to be left out
    expect(after.button).toBe('Hide Contacts');
    expect(after.dashed).toEqual([{ dash: [3, 3], segments: contacts.length }]);
    expect(after.warnings).toEqual([]);
  });

  it('says how many contacts it draws when there are more than it draws', () => {
    // every pair at least 4 apart among 330 atoms: 53,301 contacts, over the 50,000 drawn
    const n = 330;
    const many: StructureContactLike[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 4; j < n; j++) many.push({ resI: i, resJ: j, distanceAngstrom: 7 });
    expect(many.length).toBeGreaterThan(CONTACT_DRAW_LIMIT);
    const atoms330 = alignPdbStructuresKabsch(latticePdb(n, 7, 0x13d07), latticePdb(5, 2, 1)).atomsA ?? [];
    expect(atoms330).toHaveLength(n);

    const overlay = contactOverlay(many);
    const sentence = 'The contact overlay draws 26,651 of the 53,301 Cα contacts within 8 Å: every 2nd in residue order, so the view stays responsive.';
    expect(overlay.warning).toBe(sentence);
    // every 2nd of the whole list, from the first contact to the last, not the first 26,651
    expect(overlay.drawn).toHaveLength(26_651);
    expect(overlay.drawn).toEqual(many.filter((_, i) => i % 2 === 0));
    expect(overlay.drawn[overlay.drawn.length - 1]).toBe(many[many.length - 1]);

    const { before, after } = viewerWithContacts(atoms330, many);
    expect(before.warnings).toEqual([]);
    expect(after.dashed).toEqual([{ dash: [3, 3], segments: 26_651 }]);
    expect(after.warnings).toEqual([sentence]);

    // the ordinal reads as English at every step size
    const ofSize = (count: number) => contactOverlay(Array.from({ length: count }, (_, i) => ({ resI: 0, resJ: i + 4, distanceAngstrom: 1 }))).warning;
    expect(ofSize(CONTACT_DRAW_LIMIT)).toBeNull();
    expect(ofSize(CONTACT_DRAW_LIMIT * 2 + 1)).toContain('every 3rd in');
    expect(ofSize(CONTACT_DRAW_LIMIT * 10 + 1)).toContain('every 11th in');
    expect(ofSize(CONTACT_DRAW_LIMIT * 20 + 1)).toContain('every 21st in');
  }, 60_000);
});
