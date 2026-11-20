// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M7DMDN AC3 (D0116): the 'CpG' tag means blocked or impaired per REBASE, so BmtI-HF, which
 * REBASE holds no CpG data for, carries none; but its isoschizomer NheI is not cut on M.SssI-methylated
 * pACYC184 (REBASE msget?NheI, MS#810), so the Enzymes view marks BmtI-HF 'CpG?' with that ruling as
 * the tooltip, NheI 'CpG', and BsmFI (no CpG data, no isoschizomer evidence) neither. No digest or
 * methylation warning treats BmtI-HF as blocked.
 *
 * The view is drawn in the live page beside a mounted App (customEnzymeExport.test.tsx's pattern),
 * from the engine's own catalogue; the restriction engine is not replaced.
 */

import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { scanRestrictionSites } from '../core/bioEngine';
import { CPG_UNTESTED_ISOSCHIZOMER_BLOCKED, cpgUntestedRuling } from '../core/enzymeDatabase';
import { cleavagePicture } from '../core/restrictionDisplay';
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

const RULING = 'no REBASE CpG data; isoschizomer NheI blocked on M.SssI-methylated pACYC184 (MS#810)';
const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const builtIn = (name: string): RestrictionEnzyme => {
  const e = REBASE_ENZYMES.find((x) => x.name === name);
  if (!e) throw new Error(`the catalogue holds no ${name}`);
  return e;
};

/** Each `.cpg_no_data("...")` ruling on a catalogue entry in the engine's source, by enzyme name. */
function engineNoDataRulings(): Map<string, string> {
  const source = readFileSync(resolve(process.cwd(), 'crates/molbiocraft-cloning/src/rebase_catalog.rs'), 'utf8');
  const out = new Map<string, string>();
  for (const m of source.matchAll(/enz\("([^"]+)"[^\n]*\n\s*\.cpg_no_data\("([^"]*)"\)/g)) out.set(m[1], m[2]);
  return out;
}

/** A small circular construct: GCTAGC flanked by G on both sides (GCTAGCG, so CpG overlaps it), and GGGAC. */
const SEQ = 'ACACACACACGCTAGCGACACACACACACAGGGACACACACACACACACACACACAC';
const doc: SequenceDocument = {
  ...SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA')!,
  id: 'pCpg', name: 'pCpg', sequence: SEQ, topology: 'circular', features: [], primers: [],
};

describe('BG-01M7DMDN the CpG? state', () => {
  it('BG-01M7DMDN AC3 the Enzymes view marks BmtI-HF as no CpG data with a blocked isoschizomer, and NheI as CpG', async () => {
    // The engine's catalogue: BmtI-HF and NheI share GCTAGC; NheI carries the CpG tag, BmtI-HF and BsmFI do not.
    const bmti = builtIn('BmtI-HF');
    const nhei = builtIn('NheI');
    const bsmfi = builtIn('BsmFI');
    expect(bmti.recognitionSeq).toBe(nhei.recognitionSeq);
    expect(nhei.methylationSensitivity).toContain('CpG');
    expect(bmti.methylationSensitivity).not.toContain('CpG');
    expect(bsmfi.methylationSensitivity).not.toContain('CpG');

    // The 'CpG?' ruling: BmtI-HF's, and nobody else's in the catalogue; a custom "BmtI-HF" has none.
    expect(cpgUntestedRuling(bmti)).toBe(RULING);
    expect(REBASE_ENZYMES.filter((e) => cpgUntestedRuling(e) !== undefined).map((e) => e.name)).toEqual(['BmtI-HF']);
    expect(cpgUntestedRuling({ ...bmti, id: 'custom:mine-1', source: 'custom' })).toBeUndefined();
    // A payload with no source is custom by its `custom:` id, as isCustomEnzyme reads it.
    expect(cpgUntestedRuling({ name: 'BmtI-HF', id: 'custom:mine-2', source: undefined })).toBeUndefined();

    // The list is the engine's: each ruling is the `cpg_no_data` text on that enzyme's catalogue entry,
    // and every no-data ruling there naming an isoschizomer is in the list.
    const engine = engineNoDataRulings();
    expect(engine.get('BmtI-HF')).toBe(RULING);
    expect(engine.has('BsmFI')).toBe(true);
    expect(Object.entries(CPG_UNTESTED_ISOSCHIZOMER_BLOCKED)).toEqual(
      [...engine].filter(([, ruling]) => ruling.includes('isoschizomer')),
    );

    // No digest or methylation warning treats BmtI-HF as blocked: its site with CpG overlapping it cuts.
    const scan = scanRestrictionSites(SEQ, 'circular', [bmti]);
    const sites = scan.sites.filter((s) => s.enzyme.name === 'BmtI-HF');
    expect(sites.length).toBe(1);
    expect(sites.every((s) => !s.methylationBlocked)).toBe(true);
    expect(cleavagePicture(sites[0], SEQ, true, 8).cleavage).toBe('cuts');

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
        expect(words(cell('BmtI-HF').textContent)).toBe('CpG?');
        const marked = cell('BmtI-HF').querySelectorAll('[title]');
        expect(marked.map((m) => [words(m.textContent), m.getAttribute('title')])).toEqual([['CpG?', RULING]]);
        expect(words(cell('NheI').textContent)).toBe('CpG');
        expect(cell('NheI').querySelectorAll('[title]')).toHaveLength(0);
        // BsmFI keeps its Dcm tag and shows no CpG state at all.
        expect(words(cell('BsmFI').textContent)).toBe(bsmfi.methylationSensitivity.length > 0 ? bsmfi.methylationSensitivity.join(', ') : 'None');
        expect(words(cell('BsmFI').textContent)).not.toMatch(/CpG/);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    } finally {
      app.unmount();
    }
  });
});
