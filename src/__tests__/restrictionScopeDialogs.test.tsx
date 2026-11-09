// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6S1D2. The engine scans a sequence of more than 100,000 bp with its core catalog only
 * (CORE_CATALOG_LEN enzymes, the Rust constant in rebase_catalog.rs), so the Digest dialog's
 * "N enzymes cut this sequence" and the Clone dialog's "N enzymes cut the vector exactly once"
 * are then counts over those enzymes, not over the catalog. Each count line names that scope in
 * the words the map, the Restriction Analysis header and the Enzymes view use
 * (restrictionScopeWords, BG-01M6RPWR), and a scan of the whole catalog keeps its line as it was.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { findRestrictionCutSites } from '../core/bioEngine';
import { CORE_CATALOG_LEN, restrictionScanScope, restrictionScopeWords } from '../components/CircularPlasmidMap';
import { DigestOperationDialog } from '../components/SequenceOperationDialogs';
import { CloningOperationDialog } from '../components/CloningAssemblyOperationDialogs';
import type { SequenceDocument } from '../types/bio';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

const noop = () => undefined;
const CORE = CORE_CATALOG_LEN;
const coreNames = new Set(REBASE_ENZYMES.slice(0, CORE).map((e) => e.name));
const plasmid = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.topology === 'circular' && d.sequence.length > 2000)!;
const insert = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.id !== plasmid.id && d.sequence.length > 200 && d.sequence.length < 5000)!;

/**
 * A seeded random DNA of `length` bp (the same bases on every run, no file committed) with one
 * HindIII site (AAGCTT), at 1-based 50,001, so the vector has a single cutter to offer.
 */
const randomDna = (length: number, seed: number) => {
  let x = seed >>> 0;
  let seq = Array.from({ length }, () => 'ACGT'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 30]).join('');
  while (seq.includes('AAGCTT')) seq = seq.replace(/AAGCTT/g, 'AAGCTA');
  return `${seq.slice(0, 50_000)}AAGCTT${seq.slice(50_006)}`;
};
const dnaDoc = (id: string, sequence: string): SequenceDocument => ({
  ...plasmid, id, name: id, accession: '', description: '', sequence, topology: 'circular', features: [], primers: [], history: [],
});

/** The scan the dialogs run, per enzyme: [cuts, methylation-blocked sites]. */
const perEnzyme = (doc: SequenceDocument) => {
  const by = new Map<string, [number, number]>();
  for (const s of findRestrictionCutSites(doc.sequence, 'circular')) {
    const e = by.get(s.enzyme.name) ?? [0, 0];
    e[s.methylationBlocked ? 1 : 0] += 1;
    by.set(s.enzyme.name, e);
  }
  return by;
};

/** The text of every option hint in a dialog's markup, entities decoded. */
const hints = (html: string) =>
  [...html.matchAll(/<div class="mbc-opdlg-hint">([^<]*)<\/div>/g)].map((m) =>
    m[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
const hintWith = (html: string, words: string) => {
  const found = hints(html).filter((h) => h.includes(words));
  expect(found, `one hint holds "${words}"`).toHaveLength(1);
  return found[0];
};

// 100,001 bp is the shortest the engine scans with the core enzymes; 100,000 bp it scans whole.
const big = dnaDoc('BAC_120kb', randomDna(120_000, 120_000));
const edgeOver = dnaDoc('Edge_100001', randomDna(100_001, 100_001));
const edgeUnder = dnaDoc('Edge_100000', randomDna(100_000, 100_000));

describe('the operation dialogs name the core-enzyme scope of their restriction counts', () => {
  it('the digest dialog names the core-enzyme scope over 100 kb', () => {
    // The scope words the map and the Restriction Analysis header print for a 120 kb molecule.
    const words = restrictionScopeWords(restrictionScanScope(big.sequence.length), big.sequence.length)!;
    expect(words.once).toBe(`among ${CORE} core enzymes`);
    expect(words.detail).toBe(`Only ${CORE} core enzymes were scanned: other enzymes may also cut this sequence.`);

    for (const doc of [big, edgeOver]) {
      const scan = perEnzyme(doc);
      expect([...scan.keys()].filter((n) => !coreNames.has(n)), `${doc.name}: the engine scanned the core enzymes only`).toEqual([]);
      const html = renderToStaticMarkup(<DigestOperationDialog doc={doc} onCreate={noop} onClose={noop} />);
      expect(hintWith(html, 'cut this sequence'), `${doc.name}: the count line names the scope`).toBe(
        `${scan.size} enzymes cut this sequence among ${CORE} core enzymes; sorted by number of cuts. ` +
          `Only ${CORE} core enzymes were scanned: other enzymes may also cut this sequence. Methylation-blocked sites are not cut.`,
      );
    }

    // A whole-catalog scan keeps its line: 100,000 bp, and a sample plasmid.
    for (const doc of [edgeUnder, plasmid]) {
      const scan = perEnzyme(doc);
      expect([...scan.keys()].some((n) => !coreNames.has(n)), `${doc.name}: the engine scanned past the core enzymes`).toBe(true);
      const html = renderToStaticMarkup(<DigestOperationDialog doc={doc} onCreate={noop} onClose={noop} />);
      expect(hintWith(html, 'cut this sequence'), `${doc.name}: the count line names no scope`).toBe(
        `${scan.size} enzymes cut this sequence; sorted by number of cuts. Methylation-blocked sites are not cut.`,
      );
    }
  });

  it('the clone dialog names the core-enzyme scope over 100 kb', () => {
    const onceIn = (doc: SequenceDocument) => [...perEnzyme(doc)].filter(([, [cuts]]) => cuts === 1).map(([n]) => n).sort();
    /** The Clone dialog for `vector` and `ins`, with its single-cutter line and the 5' enzyme menu. */
    const clone = (vector: SequenceDocument, ins: SequenceDocument) => {
      const html = renderToStaticMarkup(
        <CloningOperationDialog candidates={[vector, ins]} initialVectorId={vector.id} initialInsertId={ins.id} onCreate={noop} onClose={noop} />);
      const menu = /<select aria-label="5&#x27; enzyme"[^>]*>(.*?)<\/select>/.exec(html);
      expect(menu, `${vector.name}: the 5' enzyme menu is drawn`).not.toBeNull();
      const options = [...menu![1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => ({ value: m[1], label: m[2] }));
      return { line: hintWith(html, 'cut the vector exactly once'), options };
    };

    for (const vector of [big, edgeOver]) {
      const once = onceIn(vector);
      expect(once.filter((n) => !coreNames.has(n)), `${vector.name}: its single cutters come from the core enzymes`).toEqual([]);
      const { line, options } = clone(vector, insert);
      expect(line, `${vector.name}: the single-cutter line names the scope`).toBe(
        `${once.length} enzymes cut the vector exactly once among ${CORE} core enzymes. ` +
          `Only ${CORE} core enzymes were scanned: other enzymes may also cut this sequence.`,
      );
      expect(once, `${vector.name}: HindIII cuts it once`).toContain('HindIII');
      // The default 5' enzyme, EcoRI, cuts the random vector more than once: its menu entry names the scope too.
      expect(perEnzyme(vector).get('EcoRI')?.[0], `${vector.name}: EcoRI cuts it more than once`).toBeGreaterThan(1);
      expect(options[0], `${vector.name}: the chosen enzyme's entry`).toEqual({ value: 'EcoRI', label: `EcoRI (not a unique cutter among ${CORE} core enzymes)` });
      expect(options.slice(1).map((o) => o.value), `${vector.name}: the menu lists the single cutters`).toEqual(once);
    }

    // The scope follows the vector, not the insert or the largest document offered.
    let unscopedEntries = 0;
    for (const [vector, ins] of [[edgeUnder, insert], [plasmid, big]] as const) {
      const once = onceIn(vector);
      if (vector === edgeUnder) expect(once, `${vector.name}: HindIII cuts it once`).toContain('HindIII');
      const { line, options } = clone(vector, ins);
      expect(line, `${vector.name} with ${ins.name}: the single-cutter line names no scope`).toBe(`${once.length} enzymes cut the vector exactly once.`);
      expect(options.filter((o) => once.includes(o.value)).map((o) => o.label), `${vector.name}: the menu lists the single cutters`).toEqual(once);
      for (const o of options.filter((x) => !once.includes(x.value))) {
        expect(o.label, `${vector.name}: ${o.value}'s entry`).toBe(`${o.value} (not a unique cutter in the vector)`);
        unscopedEntries += 1;
      }
    }
    expect(unscopedEntries, 'a non-unique chosen enzyme was drawn at 100,000 bp').toBeGreaterThan(0);
  });
});
