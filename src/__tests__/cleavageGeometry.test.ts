// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7CC6K: the two-strand cleavage picture of one cut site. Every site here is the real
 * engine's record (findRestrictionCutSites over public/molbiocraft_wasm.wasm), never a record
 * written from the helper's own formula; the expected strands are written out by hand from the
 * enzymes' published cleavage (AciI C^CGC, EcoRI G^AATTC, PstI CTGCA^G, SmaI CCC^GGG,
 * BsaI GGTCTC(1/5), XbaI T^CTAGA, NlaIII CATG^).
 */
import { describe, expect, it } from 'vitest';
import { findRestrictionCutSites } from '../core/bioEngine';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { cleavagePicture, cutSiteDisplayPosition, type CleavagePicture } from '../core/restrictionDisplay';
import type { RestrictionCutSite } from '../types/bio';

/** The engine's one site of `enzyme` on `seq`. */
function engineSite(seq: string, topology: 'circular' | 'linear', enzyme: string): RestrictionCutSite {
  const enz = REBASE_ENZYMES.find((e) => e.name === enzyme);
  if (!enz) throw new Error(`no catalogue enzyme ${enzyme}`);
  const sites = findRestrictionCutSites(seq, topology, [enz]);
  expect(sites).toHaveLength(1);
  return sites[0];
}

/** A strand of the window with `^` at the cut boundary. */
const split = (strand: string, boundary: number) => `${strand.slice(0, boundary)}^${strand.slice(boundary)}`;
const topWithCut = (p: CleavagePicture) => split(p.top, p.topCut.boundary);
const bottomWithCut = (p: CleavagePicture) => split(p.bottom, p.bottomCut.boundary);
const reverse = (s: string) => [...s].reverse().join('');

/** The enzymes the engine-agreement sweeps plant: short-, long-reach Type IIS and Type II. */
const SWEEP_ENZYMES = ['BsaI-HFv2', 'AcuI', 'BsgI', 'BsmFI', 'EcoRI', 'PstI', 'SmaI', 'AciI'];
const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const revComp = (s: string) => [...s].reverse().map((b) => COMPLEMENT[b]).join('');

/**
 * Deterministic test molecules of `len` bases: a pseudo-random background with each sweep enzyme's
 * motif planted forward in one and reverse-complemented in another, at the start, middle and end.
 */
function sweepMolecules(len: number): string[] {
  let state = len * 7919 + 17;
  const background = () =>
    Array.from({ length: len }, () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return 'ACGT'[(state >> 16) & 3];
    }).join('');
  const out: string[] = [];
  for (const name of SWEEP_ENZYMES) {
    const motif = REBASE_ENZYMES.find((e) => e.name === name)!.recognitionSeq;
    for (const planted of [motif, revComp(motif)]) {
      for (const at of [0, Math.floor((len - motif.length) / 2), len - motif.length]) {
        const bg = background();
        out.push(bg.slice(0, at) + planted + bg.slice(at + motif.length));
      }
    }
  }
  return out;
}

/**
 * The independent oracle: a site's unwrapped 0-based top and bottom cut boundaries from the
 * enzyme's published offsets (crates/molbiocraft-cloning rebase_catalog.rs raw_cut_offsets).
 */
function oracleCuts(site: RestrictionCutSite): { top: number; bottom: number } {
  const idx = site.position - 1;
  const m = site.enzyme.recognitionSeq.length;
  return site.strand === 1
    ? { top: idx + site.enzyme.cutFwd, bottom: idx + site.enzyme.cutRev }
    : { top: idx + m - site.enzyme.cutRev, bottom: idx + m - site.enzyme.cutFwd };
}

/** Every engine record of the sweep enzymes over molecules of each length in `lengths`. */
function sweepRecords(topology: 'circular' | 'linear', lengths: number[]) {
  const enzymes = SWEEP_ENZYMES.map((n) => REBASE_ENZYMES.find((e) => e.name === n)!);
  return lengths.flatMap((len) =>
    sweepMolecules(len).flatMap((seq) => findRestrictionCutSites(seq, topology, enzymes).map((site) => ({ seq, site })))
  );
}

describe('US-01M7CC6K AC1 cut boundaries, end type and overhang of AciI, EcoRI, PstI and SmaI', () => {
  const cases = [
    { enzyme: 'AciI', seq: 'TTTTCCGCTTTT', top: 'TTC^CGCTT', bottom: 'AAGGC^GAA', end: '5prime', len: 2, oh: 'CG' },
    { enzyme: 'EcoRI', seq: 'TTTTGAATTCTTTT', top: 'TTG^AATTCTT', bottom: 'AACTTAA^GAA', end: '5prime', len: 4, oh: 'AATT' },
    { enzyme: 'PstI', seq: 'TTTTCTGCAGTTTT', top: 'TTCTGCA^GTT', bottom: 'AAG^ACGTCAA', end: '3prime', len: 4, oh: 'TGCA' },
    { enzyme: 'SmaI', seq: 'TTTTCCCGGGTTTT', top: 'TTCCC^GGGTT', bottom: 'AAGGG^CCCAA', end: 'blunt', len: 0, oh: '' },
  ] as const;

  for (const c of cases) {
    it(`${c.enzyme}: both strands, both cuts, ${c.end} ${c.len}-nt ${c.oh || 'blunt'} end`, () => {
      const site = engineSite(c.seq, 'linear', c.enzyme);
      const p = cleavagePicture(site, c.seq, false, 2);
      expect(topWithCut(p)).toBe(c.top);
      expect(bottomWithCut(p)).toBe(c.bottom);
      expect(p.endType).toBe(c.end);
      expect(p.overhangLength).toBe(c.len);
      expect(p.overhangSeq).toBe(c.oh);
      // It agrees with the engine's own record of the site.
      expect(p.endType).toBe(site.overhangType);
      expect(p.overhangSeq).toBe(site.overhangSeq);
      expect(p.topCut.firstBaseAfter).toBe(site.cutTop);
      expect(p.bottomCut.firstBaseAfter).toBe(site.cutBottom);
      // The motif sits where the engine found it, read on the top strand.
      expect(p.recognitionStrand).toBe('top');
      expect(p.top.slice(p.motif.start, p.motif.end)).toBe(site.enzyme.recognitionSeq);
      expect(p.coordinates[p.motif.start]).toBe(site.position);
    });
  }

  it('agrees with the engine on end type and overhang for every linear record of eight enzymes', () => {
    const records = sweepRecords('linear', [20, 30, 34, 36, 50, 80]);
    const names = new Set(records.map((r) => r.site.enzyme.name));
    expect(names).toEqual(new Set(SWEEP_ENZYMES));
    expect(records.some((r) => r.site.strand === -1 && r.site.enzyme.isTypeIIS)).toBe(true);
    expect(records.length).toBeGreaterThan(100);
    for (const { seq, site } of records) {
      const p = cleavagePicture(site, seq, false);
      const label = `${site.id} on ${seq.length} bp`;
      expect(p.endType, label).toBe(site.overhangType);
      expect(p.overhangSeq, label).toBe(site.overhangSeq);
      expect(p.topCut.available && p.bottomCut.available, label).toBe(true);
      const o = oracleCuts(site);
      expect(p.topCut.boundary - p.motif.start, label).toBe(o.top - (site.position - 1));
      expect(p.bottomCut.boundary - p.motif.start, label).toBe(o.bottom - (site.position - 1));
    }
  });
});

describe('US-01M7CC6K AC2 a reverse-strand match is read on the bottom strand', () => {
  it('AciI found as GCGG on the top strand cuts C^CGC read 5\'->3\' on the bottom strand', () => {
    const seq = 'TTTTGCGGTTTT';
    const site = engineSite(seq, 'linear', 'AciI');
    expect(site.strand).toBe(-1);
    const p = cleavagePicture(site, seq, false, 2);
    expect(p.recognitionStrand).toBe('bottom');
    // The bottom strand, read 5'->3', carries the motif; the top strand does not.
    expect(reverse(p.bottom.slice(p.motif.start, p.motif.end))).toBe('CCGC');
    expect(p.top.slice(p.motif.start, p.motif.end)).toBe('GCGG');
    expect(topWithCut(p)).toBe('TTG^CGGTT');
    expect(bottomWithCut(p)).toBe('AACGC^CAA');
    // On the recognition strand 5'->3' the cut follows the motif's first base (C^CGC).
    const motifEndOnBottom = p.motif.end;
    expect(motifEndOnBottom - p.bottomCut.boundary).toBe(site.enzyme.cutFwd);
    expect(p.endType).toBe('5prime');
    expect(p.overhangSeq).toBe('CG');
    expect(p.overhangSeq).toBe(site.overhangSeq);
  });

  it('reports the 1-based numbers the site list shows, as cutSiteDisplayPosition gives them', () => {
    const seq = 'TTTTGCGGTTTT';
    const site = engineSite(seq, 'linear', 'AciI');
    const p = cleavagePicture(site, seq, false);
    expect(p.topCut.position).toBe(cutSiteDisplayPosition(site.cutTop, seq.length, false));
    expect(p.bottomCut.position).toBe(cutSiteDisplayPosition(site.cutBottom, seq.length, false));
    expect(p.topCut.position).toBe(5);
    expect(p.bottomCut.position).toBe(7);
    expect(p.topCut.firstBaseAfter).toBe(6);
    expect(p.bottomCut.firstBaseAfter).toBe(8);
  });

  it('a reverse-strand BsaI site puts its 1-nt gap on the bottom strand and its 5-nt gap on the top', () => {
    const seq = 'AAAAAAAAAAAAAAGAGACCAAAA';
    const site = engineSite(seq, 'linear', 'BsaI-HFv2');
    expect(site.strand).toBe(-1);
    const p = cleavagePicture(site, seq, false, 2);
    expect(p.recognitionStrand).toBe('bottom');
    expect(p.bottomCut.gapFromMotif).toBe(1);
    expect(p.topCut.gapFromMotif).toBe(5);
    expect(p.topCut.boundary).toBeLessThan(p.motif.start);
    expect(p.bottomCut.boundary).toBeLessThan(p.motif.start);
    expect(p.topCut.position).toBe(cutSiteDisplayPosition(site.cutTop, seq.length, false));
    expect(p.bottomCut.position).toBe(cutSiteDisplayPosition(site.cutBottom, seq.length, false));
    expect(p.overhangSeq).toBe(site.overhangSeq);
  });
});

describe('US-01M7CC6K AC3 a Type IIS site cuts outside its motif', () => {
  it('BsaI GGTCTC(1/5) cuts 1 and 5 nt past the motif, never clamped into it', () => {
    const seq = 'AAAAGGTCTCAAAAAAAAAAAAAA';
    const site = engineSite(seq, 'linear', 'BsaI-HFv2');
    const p = cleavagePicture(site, seq, false, 2);
    expect(p.typeIIS).toBe(true);
    expect(topWithCut(p)).toBe('AAGGTCTCA^AAAAAA');
    expect(bottomWithCut(p)).toBe('TTCCAGAGTTTTT^TT');
    expect(p.topCut.boundary).toBeGreaterThan(p.motif.end);
    expect(p.bottomCut.boundary).toBeGreaterThan(p.motif.end);
    expect(p.topCut.gapFromMotif).toBe(1);
    expect(p.bottomCut.gapFromMotif).toBe(5);
    expect(p.top.slice(p.motif.start, p.motif.end)).toBe('GGTCTC');
    expect(p.endType).toBe('5prime');
    expect(p.overhangLength).toBe(4);
    expect(p.overhangSeq).toBe(site.overhangSeq);
    expect(p.topCut.firstBaseAfter).toBe(site.cutTop);
    expect(p.bottomCut.firstBaseAfter).toBe(site.cutBottom);
  });

  it('a Type II site cutting inside its motif reports no gap', () => {
    const seq = 'TTTTGAATTCTTTT';
    const p = cleavagePicture(engineSite(seq, 'linear', 'EcoRI'), seq, false);
    expect(p.typeIIS).toBe(false);
    expect(p.topCut.gapFromMotif).toBe(0);
    expect(p.bottomCut.gapFromMotif).toBe(0);
  });
});

describe('US-01M7CC6K AC4 origin wrap on a circular molecule, unavailable flank on a linear one', () => {
  it('an EcoRI site spanning base 1 wraps its coordinates and context', () => {
    const seq = 'ATTCAAAAAAAAAAAAAAAAGA'; // GAATTC = bases 21, 22, 1, 2, 3, 4
    const site = engineSite(seq, 'circular', 'EcoRI');
    expect(site.position).toBe(21);
    const p = cleavagePicture(site, seq, true, 2);
    expect(p.crossesOrigin).toBe(true);
    expect(p.coordinates).toEqual([19, 20, 21, 22, 1, 2, 3, 4, 5, 6]);
    expect(topWithCut(p)).toBe('AAG^AATTCAA');
    expect(bottomWithCut(p)).toBe('TTCTTAA^GTT');
    expect(p.topCut.position).toBe(21);
    expect(p.bottomCut.position).toBe(3);
    expect(p.topCut.position).toBe(cutSiteDisplayPosition(site.cutTop, seq.length, true));
    expect(p.bottomCut.position).toBe(cutSiteDisplayPosition(site.cutBottom, seq.length, true));
    expect(p.overhangSeq).toBe('AATT');
    expect(p.overhangSeq).toBe(site.overhangSeq);
    expect(p.unavailableFlank).toEqual({ left: 0, right: 0 });
  });

  it('an EcoRI cut before base 1 is numbered by the last base, as the site list numbers it', () => {
    const seq = 'AATTCTTTTTTTTTTTTTTTTTTG';
    const site = engineSite(seq, 'circular', 'EcoRI');
    expect(site.cutTop).toBe(1);
    const p = cleavagePicture(site, seq, true, 1);
    expect(p.crossesOrigin).toBe(true);
    expect(p.topCut.position).toBe(24);
    expect(p.topCut.position).toBe(cutSiteDisplayPosition(site.cutTop, seq.length, true));
    expect(topWithCut(p)).toBe('TG^AATTCT');
    expect(p.coordinates).toEqual([23, 24, 1, 2, 3, 4, 5, 6]);
  });

  it('a reverse BsaI site at base 1 cuts behind the origin and reads its overhang across it', () => {
    const seq = 'GAGACCAAAAAAAAAAAAAACGTT'; // overhang ACGT, then the 1-nt gap T
    const site = engineSite(seq, 'circular', 'BsaI-HFv2');
    expect(site.position).toBe(1);
    expect(site.strand).toBe(-1);
    const p = cleavagePicture(site, seq, true, 1);
    expect(p.crossesOrigin).toBe(true);
    // Recognition strand (bottom) cuts 1 nt before the motif; the top strand 5 nt before it.
    expect(p.bottomCut.gapFromMotif).toBe(1);
    expect(p.topCut.gapFromMotif).toBe(5);
    expect(p.topCut.position).toBe(19);
    expect(p.bottomCut.position).toBe(23);
    expect(p.overhangLength).toBe(4);
    expect(p.overhangSeq).toBe('ACGT');
    // BG-01M7CDFB: the engine's own record carries the same 4-nt overhang, not an empty one.
    expect([site.overhangSeq, site.overhangType]).toEqual(['ACGT', '5prime']);
    expect(p.coordinates.slice(0, 8)).toEqual([19, 20, 21, 22, 23, 24, 1, 2]);
    expect(p.coordinates[p.motif.start]).toBe(1);
  });

  it('a linear molecule shows no base past its ends: the flank there is unavailable', () => {
    const seq = 'GAATTCTTTT';
    const site = engineSite(seq, 'linear', 'EcoRI');
    const p = cleavagePicture(site, seq, false, 3);
    expect(p.crossesOrigin).toBe(false);
    expect(p.unavailableFlank).toEqual({ left: 3, right: 0 });
    expect(p.coordinates.slice(0, 4)).toEqual([null, null, null, 1]);
    expect(p.top.slice(0, 3)).toBe('   ');
    expect(p.bottom.slice(0, 3)).toBe('   ');
    expect(topWithCut(p)).toBe('   G^AATTCTTT');
    expect(p.topCut.available).toBe(true);
  });

  it('a long-reach AcuI site on a short linear oligo keeps both cuts after its motif', () => {
    const seq = 'ATGCTGAAGCGCTGCATCTGTCTTGACCGTGACGCA'; // 36 bp, AcuI CTGAAG(16/14) at base 4
    const site = engineSite(seq, 'linear', 'AcuI');
    expect([site.cutTop, site.cutBottom, site.overhangType, site.overhangSeq]).toEqual([26, 24, '3prime', 'TG']);
    const p = cleavagePicture(site, seq, false, 1);
    expect(p.endType).toBe(site.overhangType);
    expect(p.overhangSeq).toBe(site.overhangSeq);
    expect(p.overhangLength).toBe(2);
    expect(p.topCut.available).toBe(true);
    expect(p.bottomCut.available).toBe(true);
    expect(p.topCut.gapFromMotif).toBe(16);
    expect(p.bottomCut.gapFromMotif).toBe(14);
    expect(p.topCut.position).toBe(25);
    expect(p.bottomCut.position).toBe(23);
    expect(p.unavailableFlank).toEqual({ left: 0, right: 0 });
  });

  it('a long-reach BsgI site on a 34-nt linear primer keeps both cuts in the molecule', () => {
    const seq = 'TAGTGCAGT' + 'T'.repeat(25); // BsgI GTGCAG(16/14) at base 3
    const site = engineSite(seq, 'linear', 'BsgI');
    expect([site.cutTop, site.cutBottom, site.overhangType, site.overhangSeq]).toEqual([25, 23, '3prime', 'TT']);
    const p = cleavagePicture(site, seq, false, 2);
    expect(p.endType).toBe('3prime');
    expect(p.overhangSeq).toBe('TT');
    expect(p.topCut.available && p.bottomCut.available).toBe(true);
    expect(p.topCut.firstBaseAfter).toBe(25);
    expect(p.bottomCut.firstBaseAfter).toBe(23);
    expect(p.topCut.boundary).toBeGreaterThan(p.motif.end);
  });

  it('a reverse BsmFI site on a 28-bp circle cuts behind its motif, across base 1', () => {
    // BsmFI GGGAC(10/14) read as GTCCC at base 4: its cuts lie 10 and 14 nt before the motif.
    const seq = 'AAAGTCCC' + 'TTTTTTTTT' + 'ACGT' + 'TTTTTAA';
    const site = engineSite(seq, 'circular', 'BsmFI');
    expect([site.position, site.strand, site.cutTop, site.cutBottom, site.overhangType]).toEqual([4, -1, 18, 22, '5prime']);
    const p = cleavagePicture(site, seq, true, 1);
    expect(p.topCut.boundary).toBeLessThan(p.motif.start);
    expect(p.bottomCut.boundary).toBeLessThan(p.motif.start);
    expect(p.topCut.gapFromMotif).toBe(14);
    expect(p.bottomCut.gapFromMotif).toBe(10);
    expect(p.endType).toBe('5prime');
    expect(p.overhangSeq).toBe('ACGT');
    expect(p.crossesOrigin).toBe(true);
    expect(p.topCut.position).toBe(17);
    expect(p.bottomCut.position).toBe(21);
  });

  it('places every circular record of eight enzymes where the enzyme cuts, small circles included', () => {
    const records = sweepRecords('circular', [24, 28, 30, 36, 50]);
    expect(new Set(records.map((r) => r.site.enzyme.name))).toEqual(new Set(SWEEP_ENZYMES));
    let behindOrigin = 0;
    for (const { seq, site } of records) {
      const p = cleavagePicture(site, seq, true);
      const o = oracleCuts(site);
      const label = `${site.id} on a ${seq.length}-bp circle`;
      expect(p.topCut.boundary - p.motif.start, label).toBe(o.top - (site.position - 1));
      expect(p.bottomCut.boundary - p.motif.start, label).toBe(o.bottom - (site.position - 1));
      expect(p.endType, label).toBe(site.overhangType);
      // BG-01M7CDFB: the engine reads an overhang before or across base 1 through the wrap too.
      expect(p.overhangSeq, label).toBe(site.overhangSeq);
      expect(site.overhangSeq.length, label).toBe(Math.abs(o.top - o.bottom));
      if (Math.min(o.top, o.bottom) < 0) behindOrigin++;
    }
    expect(behindOrigin).toBeGreaterThan(10);
  });

  it('rests on every catalogue enzyme cutting at or after its motif start on the recognition strand', () => {
    for (const e of REBASE_ENZYMES) {
      expect(e.cutFwd, e.name).toBeGreaterThanOrEqual(0);
      expect(e.cutRev, e.name).toBeGreaterThanOrEqual(0);
    }
  });

  it('a cut exactly at the junction of the last base and base 1 sits on the origin without crossing it', () => {
    // NlaIII CATG^ ending at the last base: its top cut is the junction, its motif and overhang before it.
    const atEnd = 'TTTTTTTTCATG';
    const end = engineSite(atEnd, 'circular', 'NlaIII');
    expect(end.cutTop).toBe(1);
    const pe = cleavagePicture(end, atEnd, true, 2);
    expect(pe.crossesOrigin).toBe(false);
    expect(pe.topCut.position).toBe(12);
    expect(topWithCut(pe)).toBe('TTCATG^TT');
    expect(pe.coordinates).toEqual([7, 8, 9, 10, 11, 12, 1, 2]);
    expect(pe.overhangSeq).toBe('CATG');
    // NlaIII starting at base 1: its bottom cut is the junction.
    const atStart = 'CATGTTTTTTTT';
    const start = engineSite(atStart, 'circular', 'NlaIII');
    const ps = cleavagePicture(start, atStart, true, 2);
    expect(ps.crossesOrigin).toBe(false);
    expect(ps.bottomCut.position).toBe(12);
    expect(bottomWithCut(ps)).toBe('AA^GTACAA');
  });
  it('a cut after the last base of a linear molecule is numbered by that base, with no base after it', () => {
    // NlaIII CATG^ at the end of a linear fragment: no base follows the cut, so the engine's
    // cutTop lies past the end (BG-01M7CDM1), never wrapped to 1.
    const seq = 'TTTTCATG';
    const site = engineSite(seq, 'linear', 'NlaIII');
    expect(site.cutTop).toBe(9);
    const p = cleavagePicture(site, seq, false, 1);
    expect(p.topCut.available).toBe(true);
    expect(p.topCut.position).toBe(8);
    expect(p.topCut.firstBaseAfter).toBeNull();
    expect(p.bottomCut.position).toBe(4);
    expect(topWithCut(p)).toBe('TCATG^ ');
    expect(p.endType).toBe('3prime');
    expect(p.endType).toBe(site.overhangType);
    expect(p.overhangSeq).toBe('CATG');
    expect(p.overhangSeq).toBe(site.overhangSeq);
    expect(p.unavailableFlank).toEqual({ left: 0, right: 1 });
  });
});

describe('BG-01M7CDM1 a cut after the last base of a linear molecule is numbered by that base', () => {
  it('the engine reports an NlaIII cut after the last base as len + 1 and the marker reads len, not 0', () => {
    const seq = 'TTTTTTTTCATG';
    const site = engineSite(seq, 'linear', 'NlaIII');
    expect([site.cutTop, site.cutBottom]).toEqual([13, 9]);
    expect(cutSiteDisplayPosition(site.cutTop, seq.length, false)).toBe(12);
    expect(cutSiteDisplayPosition(site.cutBottom, seq.length, false)).toBe(8);
  });

  it('a bottom-strand Sau3AI cut after the last base is len + 1 too, numbered by the last base', () => {
    const seq = 'TTTTTTTTGATC';
    const site = engineSite(seq, 'linear', 'Sau3AI');
    expect([site.cutTop, site.cutBottom]).toEqual([9, 13]);
    expect(cutSiteDisplayPosition(site.cutBottom, seq.length, false)).toBe(12);
  });

  it('a circle keeps its wrap: the same NlaIII cut is before base 1, numbered by the last base', () => {
    const seq = 'TTTTTTTTCATG';
    const site = engineSite(seq, 'circular', 'NlaIII');
    expect([site.cutTop, site.cutBottom]).toEqual([1, 9]);
    expect(cutSiteDisplayPosition(site.cutTop, seq.length, true)).toBe(12);
  });

  it('a linear cut before base 1 stays 1, with no base before it to number it by', () => {
    const seq = 'GATCTTTTTTTT';
    const site = engineSite(seq, 'linear', 'Sau3AI');
    expect([site.cutTop, site.cutBottom]).toEqual([1, 5]);
    expect(cutSiteDisplayPosition(site.cutTop, seq.length, false)).toBe(0);
  });
});

describe('US-01M7CC6K AC5 a methylation-blocked site is not a guaranteed cut', () => {
  it('a Dam-blocked XbaI site is reported as blocked', () => {
    const seq = 'TTTTCTCTAGATCTTTTT';
    const site = engineSite(seq, 'linear', 'XbaI');
    expect(site.methylationBlocked).toBe(true);
    expect(cleavagePicture(site, seq, false).cleavage).toBe('methylation-blocked');
  });

  it('a Dcm-blocked BsaI site is reported as blocked', () => {
    const seq = 'CCAGGTCTCAAAAAAAAAAAAA';
    const site = engineSite(seq, 'linear', 'BsaI-HFv2');
    expect(site.methylationBlocked).toBe(true);
    expect(cleavagePicture(site, seq, false).cleavage).toBe('methylation-blocked');
  });

  it('an unmethylated XbaI site cuts', () => {
    const seq = 'TTTTCTCTAGAAAAAAAA';
    const site = engineSite(seq, 'linear', 'XbaI');
    expect(site.methylationBlocked).toBe(false);
    expect(cleavagePicture(site, seq, false).cleavage).toBe('cuts');
  });
});
