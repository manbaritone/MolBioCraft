// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  DesignPrimersOperationDialog, DigestOperationDialog, featuresWithin, PairwiseOperationDialog,
} from '../components/SequenceOperationDialogs';
import {
  formatShortcut, operationForShortcut, readOperationShortcuts, RESERVED_SHORTCUTS,
  setOperationInToolbar, setOperationShortcut, shortcutFromEvent,
} from '../core/operationShortcuts';
import { designPCRPrimers, simulateRestrictionDigest } from '../core/bioEngine';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import type { RestrictionEnzyme, SequenceDocument, SequenceFeature } from '../types/bio';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

const plasmid = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'DNA' && d.topology === 'circular' && d.sequence.length > 2000 && d.features.length > 2)!;
const noop = () => undefined;

/** A seeded random DNA of `length` bp (the same bases on every run). */
const randomDna = (length: number, seed: number) => {
  let x = seed >>> 0;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) out[i] = 'ACGT'[(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 30];
  return out.join('');
};

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGTN',
};
const COMPLEMENT: Record<string, string> = {
  A: 'T', C: 'G', G: 'C', T: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
};

/**
 * A direct count of the sites of `e` on a linear `seq` (upper case), with nothing taken from the
 * engine: its recognition site matched base by base on the top strand, and on the bottom strand when
 * it is not its own reverse complement, where both strands' cuts fall inside the molecule. Returns
 * [sites, blocked]: blocked where `e` is Dam sensitive and a GATC, or Dcm sensitive and a CCAGG or
 * CCTGG, lies within the site or the three bases either side of it.
 */
function directLinearSites(seq: string, e: RestrictionEnzyme): [number, number] {
  const site = e.recognitionSeq.toUpperCase();
  const m = site.length;
  const n = seq.length;
  const rc = [...site].reverse().map((b) => COMPLEMENT[b] ?? 'N').join('');
  const dam = e.methylationSensitivity.includes('Dam');
  const dcm = e.methylationSensitivity.includes('Dcm');
  let sites = 0;
  let blocked = 0;
  for (const [motif, strand] of (rc === site ? [[site, 1]] : [[site, 1], [rc, -1]]) as [string, 1 | -1][]) {
    for (let i = 0; i + m <= n; i++) {
      let k = 0;
      while (k < m && (IUPAC[motif[k]] ?? '').includes(seq[i + k])) k++;
      if (k < m) continue;
      const [top, bottom] = strand === 1 ? [i + e.cutFwd, i + e.cutRev] : [i + m - e.cutRev, i + m - e.cutFwd];
      if (top < 0 || bottom < 0 || top > n || bottom > n) continue;
      sites++;
      const ctx = seq.slice(Math.max(0, i - 3), i + m + 3);
      if ((dam && ctx.includes('GATC')) || (dcm && (ctx.includes('CCAGG') || ctx.includes('CCTGG')))) blocked++;
    }
  }
  return [sites, blocked];
}

describe('operation shortcuts and toolbar buttons', () => {
  it('normalises key events and requires the platform modifier', () => {
    expect(shortcutFromEvent({ key: 'm', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, true)).toBe('Mod+Shift+M');
    expect(shortcutFromEvent({ key: 'm', metaKey: false, ctrlKey: true, altKey: true, shiftKey: false }, false)).toBe('Mod+Alt+M');
    expect(shortcutFromEvent({ key: 'm', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, true)).toBeNull();
    expect(shortcutFromEvent({ key: 'Shift', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, true)).toBeNull();
    expect(shortcutFromEvent({ key: 'π', code: 'KeyP', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }, true)).toBe('Mod+Alt+P');
    expect(formatShortcut('Mod+Shift+M', true)).toBe('⌘⇧M');
    expect(formatShortcut('Mod+Shift+M', false)).toBe('Ctrl+Shift+M');
  });

  it('refuses app shortcuts and duplicates, and finds the operation for a combo', () => {
    expect(RESERVED_SHORTCUTS.has('Mod+E')).toBe(true);
    expect(setOperationShortcut('digest-fragments', 'Mod+E')).toMatch(/already used/);
    expect(setOperationShortcut('digest-fragments', 'Mod+Alt+D')).toBeNull();
    expect(setOperationShortcut('design-primers', 'Mod+Alt+D')).toMatch(/Digest into Fragments/);
    expect(operationForShortcut('Mod+Alt+D')).toBe('digest-fragments');
    setOperationShortcut('digest-fragments', null);
    expect(operationForShortcut('Mod+Alt+D')).toBeNull();
  });

  it('pins and unpins toolbar buttons without duplicates', () => {
    setOperationInToolbar('build-tree', true);
    setOperationInToolbar('build-tree', true);
    setOperationInToolbar('align-pairwise', true);
    expect(readOperationShortcuts().toolbar).toEqual(['build-tree', 'align-pairwise']);
    setOperationInToolbar('build-tree', false);
    expect(readOperationShortcuts().toolbar).toEqual(['align-pairwise']);
  });
});

describe('digest into fragments', () => {
  it('keeps only annotations wholly inside a fragment, in fragment coordinates', () => {
    const f = (id: string, start: number, end: number): SequenceFeature => ({ id, name: id, type: 'misc_feature', start, end, strand: 1, color: '#000' } as SequenceFeature);
    const out = featuresWithin([f('in', 120, 180), f('edge', 90, 130), f('wrap', 900, 20)], 100, 400);
    expect(out.map((x) => [x.name, x.start, x.end])).toEqual([['in', 21, 81]]);
    expect(featuresWithin([f('in', 5, 9)], 50, 10)).toEqual([]);
  });

  it('lists enzymes that cut the sequence and blocks running with none chosen', () => {
    const html = renderToStaticMarkup(<DigestOperationDialog doc={plasmid} onCreate={noop} onClose={noop} />);
    expect(html).toContain('Digest into Fragments');
    expect(html).toMatch(/enzymes cut this sequence/);
    // A plasmid is scanned with the whole catalog, so its count line names no scope (BG-01M6S1D2).
    expect(html).toMatch(/>\d+ enzymes cut this sequence; sorted by number of cuts\. Methylation-blocked sites are not cut\.</);
    expect(html).toContain('Choose at least one enzyme that cuts this sequence.');
  });

  it('lists every cut and every blocked site of each enzyme, past the positions the scan keeps (BG-01M6S1K2)', () => {
    // The scan keeps 2,000 cut-site positions per enzyme, so a cuts column counted from the kept
    // positions stops at 2,000. The fixture: 2,500 AGCT repeats (AluI, NheI and BfaI cut about
    // 2,500 times) and 2,100 GATC repeats (MboI and DpnII sites Dam blocks at every one, and
    // Sau3AI sites it does not), so both columns run past what is kept.
    const doc: SequenceDocument = {
      ...plasmid, id: 'digest-cap', name: 'Digest_Cap_20kb', accession: '', description: '', features: [], primers: [], history: [],
      topology: 'linear',
      sequence: randomDna(1_500, 0xD16E) + 'AGCT'.repeat(2_500) + randomDna(100, 0xD16F) + 'GATC'.repeat(2_100),
    };
    const KEPT = 2_000;
    const direct = new Map(REBASE_ENZYMES.map((e) => [e.name, directLinearSites(doc.sequence, e)] as const));
    for (const name of ['AluI', 'NheI', 'BfaI', 'Sau3AI']) {
      const [sites, blocked] = direct.get(name)!;
      expect({ name, more: sites > KEPT, blocked }, 'the fixture: more cuts than are kept').toEqual({ name, more: true, blocked: 0 });
    }
    for (const name of ['MboI', 'DpnII']) {
      const [sites, blocked] = direct.get(name)!;
      expect({ name, blocked: blocked > KEPT, cuts: sites - blocked }, 'the fixture: more blocked sites than are kept').toEqual({ name, blocked: true, cuts: 0 });
    }
    const expected = REBASE_ENZYMES.filter((e) => direct.get(e.name)![0] > 0)
      .map((e) => {
        const [sites, blocked] = direct.get(e.name)!;
        return { name: e.name, site: e.recognitionSeq, cuts: sites - blocked, blocked };
      })
      .sort((a, b) => a.cuts - b.cuts || a.name.localeCompare(b.name));

    const html = renderToStaticMarkup(<DigestOperationDialog doc={doc} onCreate={noop} onClose={noop} />);
    const rows = [...html.matchAll(/<span>([^<]+)<\/span><span class="mbc-opdlg-muted">([^<]*?) · (\d+) cuts?(?:, (\d+) blocked)?<\/span>/g)]
      .map(([, name, site, cuts, blocked]) => ({ name, site, cuts: Number(cuts), blocked: Number(blocked ?? 0) }));
    expect(rows, 'each enzyme with a site, with all of its cuts and blocked sites').toEqual(expected);
    expect(html).toContain(`>${expected.length} enzymes cut this sequence; sorted by number of cuts. Methylation-blocked sites are not cut.<`);
  });

  it('fragment sequences reassemble to the whole plasmid', () => {
    const frags = simulateRestrictionDigest(plasmid, ['EcoRI', 'HindIII', 'BamHI', 'NdeI', 'XhoI']);
    const cut = frags.filter((x) => x.lengthBp > 0);
    if (cut.length > 1) {
      expect(cut.reduce((n, x) => n + x.lengthBp, 0)).toBe(plasmid.sequence.length);
    }
  });
});

describe('pairwise alignment and primer design windows', () => {
  it('requires exactly two sequences of one molecule type', () => {
    const dna = SAMPLE_LIBRARY.filter((d) => d.moleculeType === 'DNA' && d.sequence.length > 100 && d.sequence.length < 2000).slice(0, 3);
    expect(renderToStaticMarkup(<PairwiseOperationDialog inputs={dna.slice(0, 1)} onCreate={noop} onClose={noop} />))
      .toContain('Select exactly two sequences');
    const ok = renderToStaticMarkup(<PairwiseOperationDialog inputs={dna.slice(0, 2)} onCreate={noop} onClose={noop} />);
    expect(ok).not.toContain('Select exactly two sequences');
    expect(ok).toContain('Gap open / extend');
  });

  it('defaults the primer target region to the selection', () => {
    const html = renderToStaticMarkup(
      <DesignPrimersOperationDialog doc={plasmid} selection={{ start: 101, end: 700 }} onUpdate={noop} onCreate={noop} onClose={noop} />);
    expect(html).toContain('value="101"');
    expect(html).toContain('value="700"');
    expect(html).toContain('Use selection');
  });

  it('designs a primer pair whose product spans the region', () => {
    const r = designPCRPrimers(plasmid, 101, 700, 60);
    expect(r.forward.sequence.length).toBeGreaterThanOrEqual(17);
    expect(r.ampliconLength).toBe(600);
  });
});

describe('primer position slack (GC-rich region ends)', () => {
  it('moves primers outward toward the target Tm and keeps the region in the product', () => {
    const fixed = designPCRPrimers(plasmid, 101, 700, 60, '', '', 0);
    const slid = designPCRPrimers(plasmid, 101, 700, 60, '', '', 50);
    const miss = (r: typeof fixed) => Math.abs(r.forward.tmAnnealC - 60) + Math.abs(r.reverse.tmAnnealC - 60);
    expect(miss(slid)).toBeLessThanOrEqual(miss(fixed));
    expect(slid.forward.bindStart).toBeLessThanOrEqual(101);
    expect(slid.reverse.bindEnd).toBeGreaterThanOrEqual(700);
    expect(slid.ampliconSeq).toContain(plasmid.sequence.slice(100, 700).toUpperCase());
    expect(fixed.forward.bindStart).toBe(101);
  });
});
