// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M7DMDN AC3 (D0288, amending the D0265 reading): an enzyme's own REBASE m5C record outranks its
 * isoschizomer's. REBASE (msget?BmtI) shows BmtI cut with m5C on its site's last C on both strands
 * (MS#2393) and on one strand (MS#3612), where an overlapping CpG (GCTAGCG) methylates, though NheI on
 * the same site is not cut (MS#810). So the Enzymes view gives BmtI-HF no CpG state at all, NheI its
 * 'CpG' tag (D0116), and BsmFI its Dcm tag only; and no 'CpG?' state, nor its TS copy of a catalogue
 * ruling, is left anywhere in src/. The ruling itself lives on BmtI-HF's Rust catalogue entry, where
 * rebase_catalog::tests reads it.
 *
 * The view is drawn in the live page beside a mounted App (customEnzymeExport.test.tsx's pattern),
 * from the engine's own catalogue; the restriction engine is not replaced.
 */

import React, { act } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import type { RestrictionEnzyme, SequenceDocument } from '../types/bio';
import { mountApp } from './appHarness';
import { memoryStorage, type LiveElement } from './liveDom';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let EnzymesViewPanel: typeof import('../components/HybridToolsAndHistoryStudio').EnzymesViewPanel;
beforeAll(async () => {
  const app = await mountApp();
  app.unmount();
  EnzymesViewPanel = (await import('../components/HybridToolsAndHistoryStudio')).EnzymesViewPanel;
});

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const builtIn = (name: string): RestrictionEnzyme => {
  const e = REBASE_ENZYMES.find((x) => x.name === name);
  if (!e) throw new Error(`the catalogue holds no ${name}`);
  return e;
};

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** A small circular construct: GCTAGC flanked by G on both sides (GCTAGCG, so CpG overlaps it), and GGGAC. */
const SEQ = 'ACACACACACGCTAGCGACACACACACACAGGGACACACACACACACACACACACAC';
const doc: SequenceDocument = {
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id: 'pCpg', name: 'pCpg', sequence: SEQ, topology: 'circular', features: [], primers: [],
};

describe('BG-01M7DMDN CpG states in the Enzymes view', () => {
  it('BG-01M7DMDN AC3 the Enzymes view gives BmtI-HF no CpG state, as REBASE shows it cut with m5C where NheI is not, and marks NheI CpG', async () => {
    // The engine's catalogue: BmtI-HF and NheI share GCTAGC; NheI carries the CpG tag, BmtI-HF none,
    // and BsmFI only Dcm.
    const bmti = builtIn('BmtI-HF');
    const nhei = builtIn('NheI');
    const bsmfi = builtIn('BsmFI');
    expect(bmti.recognitionSeq).toBe(nhei.recognitionSeq);
    expect(nhei.methylationSensitivity).toContain('CpG');
    expect(bmti.methylationSensitivity).toEqual([]);
    expect(bsmfi.methylationSensitivity).toEqual(['Dcm']);

    // No 'CpG?' state and no TS copy of a catalogue CpG ruling remain in src/, this file aside.
    const gone = ['CpG?', 'CPG_UNTESTED_ISOSCHIZOMER_BLOCKED', 'cpgUntestedRuling'];
    const src = resolve(process.cwd(), 'src');
    const self = resolve(src, '__tests__/enzymeCpgState.test.tsx');
    const holders = filesUnder(src)
      .filter((path) => path !== self && /\.(tsx?|css|html|json)$/.test(path))
      .flatMap((path) => {
        const text = readFileSync(path, 'utf8');
        return gone.filter((name) => text.includes(name)).map((name) => `${relative(src, path)}: ${name}`);
      });
    expect(holders).toEqual([]);

    // The Enzymes view, over the whole catalogue.
    const app = await mountApp({ storage: memoryStorage() });
    try {
      await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'sequence-view' });
      await app.settle();
      const { createRoot } = await import('react-dom/client');
      const host = app.doc.createElement('div');
      app.doc.body.appendChild(host);
      const root = createRoot(host as unknown as Element);
      try {
        await act(async () => {
          root.render(<EnzymesViewPanel doc={doc} allDocuments={[doc]} enzymes={[...REBASE_ENZYMES]} />);
        });
        await app.settle();
        const all = (host as unknown as LiveElement).querySelectorAll('button.method-tab-btn').find((b) => words(b.textContent) === 'All REBASE Commercial');
        if (!all) throw new Error('no All REBASE Commercial tab');
        await app.click(all);
        await app.settle();
        const header = (host as unknown as LiveElement).querySelectorAll('th').map((th) => words(th.textContent));
        const col = header.findIndex((h) => /^Methylation/.test(h));
        expect(col).toBeGreaterThanOrEqual(0);
        const cell = (name: string): LiveElement => {
          const row = (host as unknown as LiveElement).querySelectorAll('tr').find((tr) => words(tr.querySelector('strong')?.textContent) === name);
          if (!row) throw new Error(`no row for ${name}`);
          return row.querySelectorAll('td')[col];
        };
        // BmtI-HF: no CpG state of any kind, and nothing hovering over the cell.
        expect(words(cell('BmtI-HF').textContent)).toBe('None');
        expect(cell('BmtI-HF').querySelectorAll('[title]')).toHaveLength(0);
        // NheI: its CpG tag.
        expect(words(cell('NheI').textContent)).toBe('CpG');
        expect(cell('NheI').querySelectorAll('[title]')).toHaveLength(0);
        // BsmFI: its Dcm tag only.
        expect(words(cell('BsmFI').textContent)).toBe('Dcm');
        expect(cell('BsmFI').querySelectorAll('[title]')).toHaveLength(0);
        // No row in the view shows a 'CpG?' state.
        const states = (host as unknown as LiveElement).querySelectorAll('tr')
          .map((tr) => tr.querySelectorAll('td')[col])
          .filter((td) => td !== undefined)
          .map((td) => words(td.textContent));
        expect(states.length).toBeGreaterThan(100);
        expect(states.filter((s) => s.includes('CpG?'))).toEqual([]);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    } finally {
      app.unmount();
    }
  });
});
