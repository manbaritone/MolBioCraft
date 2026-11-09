// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Core sequence tools against outside references in `test-data/reference/seqtools.json`
 * (`scripts/outside-data/ref_seqtools.py`): Biopython translation and restriction analysis,
 * EMBOSS getorf, ExPASy ProtParam, Primer3, ViennaRNA, pyteomics and NCBI BLAST+.
 * Skipped when the reference file is absent.
 */

import { describe, expect, it } from 'vitest';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { SecondaryStructureReport } from '../types/bio';
import { dataPath, haveTestData } from './testData';

interface NodeFs { existsSync: (p: string) => boolean; readFileSync: (p: string, e: string) => string }
let fs: NodeFs | null = null;
try { const spec: string = 'node:fs'; fs = (await import(/* @vite-ignore */ spec)) as NodeFs; } catch { fs = null; }
const FILE = dataPath('reference/seqtools.json');
const have = haveTestData(FILE);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R: any = have ? JSON.parse(fs!.readFileSync(FILE, 'utf8')) : null;
const call = <T,>(op: string, payload: unknown) => invokeRustBioSync<T>(op, payload);

describe.skipIf(!have)('sequence tools against Biopython / EMBOSS / ExPASy / Primer3 / ViennaRNA / BLAST+', () => {
  it('translates with every NCBI genetic code as Biopython', () => {
    const bad: string[] = [];
    for (const c of R.translate) {
      // the reply is { protein, warnings } (D0005); an NCBI table warns of nothing
      const { protein: got, warnings } = call<{ protein: string; warnings: string[] }>('translate_sequence', { dna: c.dna, frameOffset: c.frame, tableId: c.table });
      if (got !== c.protein) bad.push(`table ${c.table} frame ${c.frame}: ${[...got].findIndex((ch, i) => ch !== c.protein[i])}`);
      if (warnings.length) bad.push(`table ${c.table}: ${warnings.join(' ')}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('finds the ATG→stop ORFs of EMBOSS getorf (≥ 100 codons)', () => {
    const report: string[] = [];
    for (const [acc, ref] of Object.entries(R.orfs) as [string, { circular: boolean; seq: string; orfs: { start: number; end: number; reverse: boolean }[] }][]) {
      const got = call<{ orfs: { start: number; end: number; strand: number; lengthBp: number }[] }>('find_orfs', { seq: ref.seq, minLengthAa: 100, tableId: 1, circular: ref.circular }).orfs;
      // getorf reports the stop-excluded span; key ORFs by strand and stop end
      // (getorf writes ends past the origin of a circular sequence as positions > length)
      const L = ref.seq.length;
      const mod = (x: number) => ((x - 1) % L + L) % L + 1;
      const key = (s: number, e: number, rev: boolean) => `${rev ? '-' : '+'}${mod(rev ? Math.min(s, e) : Math.max(s, e))}`;
      const refKeys = new Set(ref.orfs.filter((o) => Math.abs(o.end - o.start) + 1 >= 300 && Math.abs(o.end - o.start) < ref.seq.length / 2).map((o) => key(o.start, o.end, o.reverse)));
      const gotKeys = new Set(got.map((o) => (o.strand > 0 ? `+${mod(o.end - 3)}` : `-${mod(o.start + 3)}`)));
      const missing = [...refKeys].filter((k) => !gotKeys.has(k));
      const extra = [...gotKeys].filter((k) => !refKeys.has(k));
      report.push(`${acc}: getorf ${refKeys.size}, app ${gotKeys.size}, missing ${missing.slice(0, 6)}, extra ${extra.slice(0, 6)}`);
      expect(missing.length, report.join('\n')).toBe(0);
      expect(extra.length, report.join('\n')).toBe(0);
    }
  });

  it('cuts at the positions of Biopython Restriction (linear and circular)', () => {
    const bad: string[] = [];
    for (const [acc, ref] of Object.entries(R.restriction) as [string, { circular: boolean; cuts: Record<string, number[]> }][]) {
      const seq = R.orfs[acc]?.seq ?? R.dnastats.find((d: { acc: string }) => d.acc === acc)?.seq ?? R.blast.blastn.subjects[acc];
      const sites = call<{ enzyme: { name: string }; cutTop: number }[]>('find_restriction_cut_sites', { seq, topology: ref.circular ? 'circular' : 'linear' });
      for (const [enz, pos] of Object.entries(ref.cuts)) {
        // NEB product names carry suffixes (BsaI-HFv2, ScaI-HF, TaqI-v2)
        const base = (n: string) => n.replace(/-(HFv2|HF|v2)$/, '');
        const got = [...new Set(sites.filter((s) => base(s.enzyme.name) === enz).map((s) => s.cutTop))].sort((a, b) => a - b);
        if (JSON.stringify(got) !== JSON.stringify(pos)) bad.push(`${acc} ${enz}: app ${JSON.stringify(got.slice(0, 8))}${got.length > 8 ? '…' : ''} (${got.length}) vs Biopython ${JSON.stringify(pos.slice(0, 8))}${pos.length > 8 ? '…' : ''} (${pos.length})`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('protein parameters match ExPASy ProtParam', () => {
    const bad: string[] = [];
    for (const [acc, ref] of Object.entries(R.protparam) as [string, Record<string, number> & { seq: string }][]) {
      const p = call<Record<string, number>>('analyze_protein_sequence', { seq: ref.seq, isDna: false });
      const checks: [string, number, number, number][] = [
        ['MW', p.molecularWeightDa, ref.mw, 0.02], ['pI', p.isoelectricPointPi, ref.pI, 0.01], ['ε cystine', p.extinctionCoeff280Cystine, ref.ext_cystine, 0.5],
        ['ε reduced', p.extinctionCoeff280Reduced, ref.ext_reduced, 0.5], ['instability', p.instabilityIndex, ref.instability, 0.011], ['aliphatic', p.aliphaticIndex, ref.aliphatic, 0.06], ['GRAVY', p.gravyHydropathy, ref.gravy, 0.0011],
      ];
      for (const [k, got, want, tol] of checks) if (want != null && !(Math.abs(got - want) <= tol)) bad.push(`${acc} ${k}: app ${got} vs ExPASy ${want}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('primer Tm matches Primer3 (SantaLucia 1998 nearest neighbour)', () => {
    const bad: string[] = [];
    for (const c of R.tm) {
      const r = call<{ tmC: number }>('calculate_primer_metrics', { seq: c.seq, naMm: c.na_mm, mgMm: c.mg_mm, primerNm: c.primer_nm });
      if (Math.abs(r.tmC - c.tm) > 0.6) bad.push(`${c.seq} Mg ${c.mg_mm}: app ${r.tmC} vs Primer3 ${c.tm.toFixed(2)}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('RNA minimum free energy matches ViennaRNA RNAfold', () => {
    const bad: string[] = [];
    for (const c of R.rnafold) {
      const r = call<{ dotBracket: string; minimumFreeEnergyKcalMol: number }>('predict_secondary_structure', { seq: c.seq, moleculeType: 'RNA' });
      if (Math.abs(r.minimumFreeEnergyKcalMol - c.mfe) > 0.6) bad.push(`${c.name}: app ${r.minimumFreeEnergyKcalMol} ${r.dotBracket}\n      vs ViennaRNA ${c.mfe.toFixed(2)} ${c.structure}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('the fold options reach the engine: temperature, dangling ends and the ensemble', () => {
    // ViennaRNA 2.7.2 `RNAfold -p -d0 [-T 65]` on the same sequence.
    const seq = 'GCGCUUCGCCCUGGCGAGAAGCGC';
    const at37 = call<SecondaryStructureReport>('predict_secondary_structure', {
      seq,
      moleculeType: 'RNA',
      temperatureC: 37,
      danglingEnds: false,
    });
    expect(at37.minimumFreeEnergyKcalMol).toBeCloseTo(-11.1, 2);
    expect(at37.ensembleFreeEnergyKcalMol).toBeCloseTo(-11.74, 2);
    expect(at37.mfeFrequency).toBeCloseTo(0.356, 2);
    expect(at37.ensembleDiversity).toBeGreaterThan(3);
    expect(at37.ensembleDiversity).toBeLessThan(3.8);
    expect(at37.sampledStructures).toBeGreaterThan(100);

    // Warmer, so the same molecule is less folded and its ensemble broader.
    const at65 = call<SecondaryStructureReport>('predict_secondary_structure', {
      seq,
      moleculeType: 'RNA',
      temperatureC: 65,
      danglingEnds: false,
    });
    expect(at65.temperatureC).toBe(65);
    expect(at65.danglingEnds).toBe(false);
    expect(at65.minimumFreeEnergyKcalMol).toBeCloseTo(-5.28, 2);
    expect(at65.ensembleFreeEnergyKcalMol).toBeCloseTo(-5.97, 2);

    // Dangling ends are stacking energies on helix ends that face an unpaired neighbour, so they
    // only show on a molecule with an exterior loop between its hairpins: -14.40 at -d0 against
    // -16.70 at -d2 for this one, both from `RNAfold`.
    const twoHairpins = 'GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC';
    const bare = call<SecondaryStructureReport>('predict_secondary_structure', {
      seq: twoHairpins,
      moleculeType: 'RNA',
      danglingEnds: false,
    });
    const dangling = call<SecondaryStructureReport>('predict_secondary_structure', {
      seq: twoHairpins,
      moleculeType: 'RNA',
      danglingEnds: true,
    });
    expect(bare.danglingEnds).toBe(false);
    expect(dangling.danglingEnds).toBe(true);
    expect(bare.minimumFreeEnergyKcalMol).toBeCloseTo(-14.4, 2);
    expect(dangling.minimumFreeEnergyKcalMol).toBeCloseTo(-16.7, 2);

    // Joining the ends turns what hung open at both of them into one loop, which costs: -11.60
    // against -14.40 for the same helices, both from `RNAfold -c -d0`.
    const circle = call<SecondaryStructureReport>('predict_secondary_structure', {
      seq: twoHairpins,
      moleculeType: 'RNA',
      danglingEnds: false,
      circular: true,
    });
    expect(circle.circular).toBe(true);
    expect(bare.circular).toBe(false);
    expect(circle.dotBracket).toBe(bare.dotBracket);
    expect(circle.minimumFreeEnergyKcalMol).toBeCloseTo(-11.6, 2);
    expect(circle.ensembleFreeEnergyKcalMol).toBeCloseTo(-11.94, 2);
    expect(circle.mfeFrequency).toBeCloseTo(0.58, 2);
  });

  it('tryptic peptides and masses match pyteomics', () => {
    const bad: string[] = [];
    for (const c of R.digest) {
      const r = call<{ peptides: { sequence: string; mzCharge1: number }[] }>('simulate_proteolytic_digest_ms', { proteinSeq: c.seq, protease: 'Trypsin', maxMissedCleavages: 1, minMassDa: 400, maxMassDa: 4500, carbamidomethylCys: true });
      const got = new Map(r.peptides.map((p) => [p.sequence, p.mzCharge1]));
      for (const p of c.peptides) {
        const m = got.get(p.peptide);
        if (m === undefined) bad.push(`${c.acc}: missing ${p.peptide} (${p.mh.toFixed(4)})`);
        else if (Math.abs(m - p.mh) > 0.002) bad.push(`${c.acc} ${p.peptide}: app ${m} vs ${p.mh.toFixed(4)}`);
      }
      const want = new Set(c.peptides.map((p: { peptide: string }) => p.peptide));
      for (const s of got.keys()) if (!want.has(s)) bad.push(`${c.acc}: extra ${s}`);
    }
    expect(bad, bad.slice(0, 30).join('\n')).toEqual([]);
  });

  it('GC content and DNA molecular weight match Biopython', () => {
    for (const c of R.dnastats) {
      const r = call<{ gc_percent: number; mw_ssdna_da: number; mw_dsdna_da: number }>('compute_sequence_stats', { seq: c.seq });
      expect(r.gc_percent).toBeCloseTo(c.gc * 100, 6);
      expect(Math.abs(r.mw_ssdna_da - c.mw_ss) / c.mw_ss, `ss MW app ${r.mw_ssdna_da} vs ${c.mw_ss}`).toBeLessThan(1e-4);
      expect(Math.abs(r.mw_dsdna_da - c.mw_ds) / c.mw_ds, `ds MW app ${r.mw_dsdna_da} vs ${c.mw_ds}`).toBeLessThan(1e-4);
    }
  });

  it('local BLAST reports the BLAST+ HSPs (blastn, blastp, blastx, tblastn) with the same coordinates, identity and bit score', () => {
    type Hit = { accession: string; identityPct: number; bitScore: number; eValue: string; queryStart: number; queryEnd: number; subjectStart: number; subjectEnd: number };
    const report: string[] = [];
    for (const prog of ['blastn', 'blastp', 'blastx', 'tblastn'] as const) {
      const b = R.blast[prog];
      const protDb = prog === 'blastp' || prog === 'blastx';
      const docs = Object.entries(b.subjects).map(([id, sequence]) => ({ id, name: id, accession: id, sequence, moleculeType: protDb ? 'Protein' : 'DNA' }));
      const hits = call<Hit[]>('run_local_blast', { querySeq: b.query, docs, program: prog });
      for (const r of b.hits.slice(0, 3)) {
        const [qs, qe, ss, se] = [r.qstart, r.qend, r.sstart, r.send].map(Number);
        const near = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol;
        const tol = prog === 'blastn' ? 3 : 9; // translated coordinates are in nucleotides
        const h = hits.find((x) => x.accession === r.sseqid && near(x.queryStart, qs, tol * 4) && near(x.queryEnd, qe, tol * 4) && near(x.subjectStart, ss, tol * 4) && near(x.subjectEnd, se, tol * 4));
        if (!h) { report.push(`${prog} ${r.sseqid} ${qs}-${qe} / ${ss}-${se}: not found (app: ${hits.filter((x) => x.accession === r.sseqid).map((x) => `${x.queryStart}-${x.queryEnd}/${x.subjectStart}-${x.subjectEnd}`).join(', ')})`); continue; }
        const bad: string[] = [];
        if (!(near(h.queryStart, qs, tol) && near(h.queryEnd, qe, tol) && near(h.subjectStart, ss, tol) && near(h.subjectEnd, se, tol))) bad.push(`coords ${h.queryStart}-${h.queryEnd}/${h.subjectStart}-${h.subjectEnd}`);
        if (Math.abs(h.identityPct - Number(r.pident)) > 2) bad.push(`identity ${h.identityPct} vs ${r.pident}`);
        if (Math.abs(h.bitScore - Number(r.bitscore)) / Number(r.bitscore) > 0.05) bad.push(`bits ${h.bitScore} vs ${r.bitscore}`);
        if (bad.length) report.push(`${prog} ${r.sseqid} ${qs}-${qe}/${ss}-${se}: ${bad.join('; ')}`);
      }
    }
    expect(report, report.join('\n')).toEqual([]);
  });
});
