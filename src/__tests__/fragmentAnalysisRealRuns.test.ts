// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Regression checks against public capillary runs in the git-ignored `test-data/` folder
 * (see each folder's SOURCE.txt): NCBI OSIRIS kit runs and allelic ladders, the CRAN `trace`
 * package runs and the Biopython ABIF samples. Skipped when the folder is absent (CI).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { autoSizeStandard, cleanPeaks, parseFsa, saturatedScans, sizingWarning, type FragmentTrace, type Sizing } from '../core/fragmentAnalysis';
import { TEST_DATA_DIR, haveTestData } from './testData';

interface NodeFs {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc?: string) => Uint8Array & string;
  readdirSync: (p: string, o: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[];
}
const ROOT = TEST_DATA_DIR;
let fs: NodeFs | null = null;
try {
  const spec: string = 'node:fs';
  fs = (await import(/* @vite-ignore */ spec)) as NodeFs;
} catch { fs = null; }
const present = haveTestData('osiris-ncbi/runs');
const CNU = `${ROOT}/All_Cnu_microsatellites_combined`;

const walk = (d: string): string[] => fs!.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const ladderOf = (t: FragmentTrace) => t.channels.find((c) => /liz/i.test(c.dye)) ?? t.channels[t.channels.length - 1];

interface Locus { name: string; channel: number; min: number; max: number; alleles: number[] }
function kitLoci(kit: string, setName: string): Locus[] {
  const file = fs!.readdirSync(`${ROOT}/osiris-ncbi/kits`, { withFileTypes: true }).map((e) => e.name).find((k) => k.toLowerCase() === kit.toLowerCase()) ?? kit;
  const x = String(fs!.readFileSync(`${ROOT}/osiris-ncbi/kits/${file}`, 'latin1'));
  const set = x.split('<Set>').find((s) => s.includes(`<Name>${setName}</Name>`))!;
  return set.split('<Locus>').slice(1).map((l) => ({
    name: /<Name>([^<]+)<\/Name>/.exec(l)![1],
    channel: Number(/<Channel>(\d+)<\/Channel>/.exec(l)![1]),
    min: Number(/<MinBP>([\d.]+)/.exec(l)?.[1] ?? 0),
    max: Number(/<MaxBP>([\d.]+)/.exec(l)?.[1] ?? 0),
    alleles: [...l.matchAll(/<Allele>\s*<Name>[^<]+<\/Name>.*?<BP>([\d.]+)<\/BP>/gs)].map((m) => Number(m[1])),
  }));
}

describe.skipIf(!present)('fragment analysis on public capillary runs', () => {
  const sized = new Map<string, { trace: FragmentTrace; name: string; sizing: Sizing }>();
  let encrypted: string[] = [];
  beforeAll(() => {
    const files = walk(ROOT).filter((f) => /\.(fsa|hid)$/i.test(f) && !f.includes('All_Cnu'));
    encrypted = [];
    for (const f of files) {
      let t: FragmentTrace;
      try { t = parseFsa(new Uint8Array(fs!.readFileSync(f))); } catch (e) { if (/encrypted/.test(String(e))) encrypted.push(f); else throw e; continue; }
      const lad = ladderOf(t);
      const a = autoSizeStandard(lad.data, 100, saturatedScans(t, lad.dye), lad.dye);
      sized.set(f.slice(ROOT.length + 1), { trace: t, ...a });
    }
  }, 600000);

  it('reads every .fsa run and rejects only the encrypted .hid files', () => {
    expect(sized.size).toBeGreaterThanOrEqual(68);
    expect(encrypted.every((f) => f.endsWith('.hid'))).toBe(true);
  });

  it('sizes every run on a near-linear ladder with the right standard', () => {
    for (const [f, s] of sized) {
      if (f.includes('_ILS_too_low')) { expect(sizingWarning(s.sizing)).toMatch(/poor size-standard fit/); continue; }
      expect(s.sizing.rSquared, f).toBeGreaterThan(0.999);
      const dye = ladderOf(s.trace).dye;
      expect(s.name, f).toBe(f.includes('PowerPlex16') ? 'Promega ILS 600' : dye === 'ROX' ? 'GeneScan 500 ROX' : 'GeneScan 500 LIZ');
      expect(sizingWarning(s.sizing), f).toBeNull();
    }
  });

  it('places allelic-ladder alleles at their nominal sizes', () => {
    const expectAtLeast: [string, string, string, number][] = [
      ['osiris-ncbi/runs/Cofiler/STRbaseCOF/COfiler_LADDER.fsa', 'Cofiler_LadderInfo.xml', 'Cofiler', 54],
      ['osiris-ncbi/runs/Identifiler/STRbaseIF/Identifiler LADDER.fsa', 'Identifiler_LadderInfo.xml', 'Identifiler', 170],
      ['osiris-ncbi/runs/ProfilerPlus/STRbasePP/ProfilerPlus LADDER.fsa', 'ProfilerPlus_LadderInfo.xml', 'ProfilerPlus', 105],
    ];
    for (const [file, kit, set, min] of expectAtLeast) {
      const s = sized.get(file)!;
      let ok = 0;
      for (const L of kitLoci(kit, set)) {
        const ch = s.trace.channels[L.channel - 1];
        const pk = cleanPeaks(s.trace, ch.dye, s.sizing, 100).filter((p) => p.size > L.min - 15 && p.size < L.max + 15);
        const near = L.alleles.map((bp) => pk.reduce((b, p) => (Math.abs(p.size - bp) < Math.abs(b - bp) ? p.size : b), Infinity) - bp);
        const off = near.filter(Number.isFinite).sort((x, y) => x - y)[Math.floor(near.length / 2)] ?? 0;
        ok += near.filter((d) => Math.abs(d - off) <= 1).length;
      }
      expect(ok, set).toBeGreaterThanOrEqual(min);
    }
  });

  it('Microsatellite Analysis with the kit file and allelic ladder genotypes the 9947A positive controls', async () => {
    const { fragmentDocumentFromFsa, runMicrosatellites } = await import('../core/operationRunners');
    const P9947A: Record<string, string> = { D8S1179: '13', D21S11: '30', D7S820: '10/11', CSF1PO: '10/12', D3S1358: '14/15', TH01: '8/9.3', D13S317: '11', D16S539: '11/12', D2S1338: '19/23', D19S433: '14/15', vWA: '17/18', TPOX: '8', D18S51: '15/19', AMEL: 'X', D5S818: '11', FGA: '23/24', 'Penta E': '12/13', 'Penta D': '12' };
    const kits: [string, string, string[]][] = [
      ['Identifiler', 'Identifiler/STRbaseIF', ['Identifiler LADDER.fsa', 'Positive Control.fsa', 'MIX05case2_victim.fsa']],
      ['Cofiler', 'Cofiler/STRbaseCOF', ['COfiler_LADDER.fsa', 'positive_control.fsa', 'MIX05case2_victim.fsa']],
      ['ProfilerPlus', 'ProfilerPlus/STRbasePP', ['ProfilerPlus LADDER.fsa', 'positive control.fsa', 'MIX05case2_victim.fsa']],
      ['PowerPlex16', 'PowerPlex16/STRBasePP16', ['PP16 LADDER.fsa', 'positive control.fsa', 'MIX05case2_victim.fsa']],
    ];
    const victim: Record<string, Set<string>> = {};
    for (const [kit, dir, files] of kits) {
      const docs = files.map((f) => fragmentDocumentFromFsa(new Uint8Array(fs!.readFileSync(`${ROOT}/osiris-ncbi/runs/${dir}/${f}`)), f));
      const panel = String(fs!.readFileSync(`${ROOT}/osiris-ncbi/kits/${kit}_LadderInfo.xml`, 'latin1'));
      const r = runMicrosatellites(docs, { standard: 'auto', sizeDye: '', panel, allelicLadder: 'auto', minHeight: 100, stutterPct: 25, balancePct: 30 }, { sourceLabel: 'x' });
      const lines = String(r.created[0].docMetadata?.Notes).split('\n');
      const header = lines.find((l) => l.startsWith('Sample\t'))!.split('\t');
      const row = (name: string) => lines.find((l) => l.startsWith(`${name}\t`))!.split('\t');
      const pos = row(files[1].replace(/\.fsa$/, ''));
      header.forEach((m, i) => { if (P9947A[m]) expect(pos[i], `${kit} ${m}`).toBe(P9947A[m]); });
      const vic = row('MIX05case2_victim');
      header.forEach((m, i) => { if (i >= 2) (victim[m] ??= new Set()).add(vic[i]); });
    }
    // the same victim typed with four kits agrees at every shared locus
    for (const [m, calls] of Object.entries(victim)) expect([...calls], m).toHaveLength(1);
  }, 600000);

  it.skipIf(!present || !haveTestData(CNU))('matches all 16 GeneScan 500 LIZ peaks on the 3730xl runs', () => {
    for (const f of walk(CNU).filter((x) => /\.fsa$/i.test(x))) {
      const t = parseFsa(new Uint8Array(fs!.readFileSync(f)));
      const lad = ladderOf(t);
      const a = autoSizeStandard(lad.data, 100, saturatedScans(t, lad.dye), lad.dye);
      expect(`${a.name} ${a.sizing.matched}`, f).toBe('GeneScan 500 LIZ 16');
    }
  }, 600000);
});
