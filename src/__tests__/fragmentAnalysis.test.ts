// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { autoSizeStandard, calibrateLadder, callAlleles, cleanPeaks, nameAllele, encodeFsa, findPeaks, parseFsa, parsePanel, parseKitXml, saturatedScans, scanToBp, SIZE_STANDARDS, sizeStandard, sizingWarning } from '../core/fragmentAnalysis';

/** Synthetic capillary run: nonlinear mobility, Gaussian peaks, primer flare, small noise. */
function syntheticRun(standard: number[]) {
  const N = 9000;
  const scanOf = (bp: number) => 1500 + 11 * bp - 0.003 * bp * bp;
  let x = 3;
  const noise = () => { x = (x * 1103515245 + 12345) % 2147483648; return ((x >>> 16) % 21) - 10; };
  const channel = (peaks: [number, number][], flare = false) => Array.from({ length: N }, (_, i) => {
    let v = 60 + noise();
    for (const [bp, h] of peaks) { const d = i - scanOf(bp); v += h * Math.exp(-(d * d) / (2 * 3.5 * 3.5)); }
    if (flare && i > 300 && i < 700) v += 6000 * Math.exp(-((i - 450) ** 2) / (2 * 60 * 60));
    return Math.max(0, v);
  });
  const fam = channel([[152, 3000], [158, 2600], [150, 350], [320, 1800], [324, 260]], true); // D1 het 152/158 + stutter 150; D3 hom 320 + n+4 noise
  const vic = channel([[210, 2000], [206, 300]], true); // D2 hom 210 (4-bp repeat) + stutter 206
  const ned = channel([], true);
  const pet = channel([[255.5, 900], [263.5, 850]], true); // D4 het 255.5/263.5
  const liz = channel(standard.map((bp) => [bp, 700] as [number, number]), true);
  return { N, scanOf, channels: [{ dye: '6-FAM', data: fam }, { dye: 'VIC', data: vic }, { dye: 'NED', data: ned }, { dye: 'PET', data: pet }, { dye: 'LIZ', data: liz }] };
}

describe('fragment analysis', () => {
  const std = SIZE_STANDARDS['GeneScan 500 LIZ'];
  const run = syntheticRun(std);
  const bytes = encodeFsa({ channels: run.channels, sample: 'Sample_A01', dyeSet: 'G5' });

  it('reads dye channels, names and sample from an ABIF fragment file', () => {
    const t = parseFsa(bytes);
    expect(t.channels.map((c) => c.dye)).toEqual(['6-FAM', 'VIC', 'NED', 'PET', 'LIZ']);
    expect(t.channels[4].data.length).toBe(run.N);
    expect(t.sample).toBe('Sample_A01');
    expect(t.dyeSet).toBe('G5');
    expect(t.dataKind).toBe('raw');
  });

  it('matches every size-standard peak and sizes scans to within half a base', () => {
    const t = parseFsa(bytes);
    const s = sizeStandard(t.channels[4].data, std);
    expect(s.matched).toBe(std.length);
    for (const bp of [60, 152, 210, 333, 480]) expect(Math.abs(scanToBp(s, run.scanOf(bp)) - bp)).toBeLessThan(0.5);
    expect(s.rSquared).toBeGreaterThan(0.99);
  });

  it('also sizes against the 600 LIZ standard', () => {
    const std6 = SIZE_STANDARDS['GeneScan 600 LIZ v2'];
    const r6 = syntheticRun(std6);
    const s = sizeStandard(r6.channels[4].data, std6);
    expect(s.matched).toBe(std6.length);
  });

  it('calls alleles, removing stutter, and flags homozygotes', () => {
    const t = parseFsa(bytes);
    const s = sizeStandard(t.channels[4].data, std);
    const panel = parsePanel('# name, dye, min, max, repeat\nD1, 6-FAM, 140, 170, 2\nD2, VIC, 195, 225, 4\nD3, 6-FAM, 300, 340, 4\nD4, PET, 245, 275, 4\nD5, NED, 100, 400, 2');
    const calls = callAlleles(t, s, panel, { minHeight: 150, stutterPct: 25, balancePct: 30 });
    const by = (m: string) => calls.find((c) => c.marker === m)!;
    expect(by('D1').alleles.map((a) => Math.round(a.size))).toEqual([152, 158]);
    expect(by('D1').note).toBe('heterozygous');
    expect(by('D2').alleles.map((a) => Math.round(a.size))).toEqual([210]);
    expect(by('D2').note).toMatch(/homozygous/);
    expect(by('D3').alleles.map((a) => Math.round(a.size))).toEqual([320]);
    expect(by('D4').alleles.map((a) => a.size).every((v, i) => Math.abs(v - [255.5, 263.5][i]) < 0.5)).toBe(true);
    expect(by('D5').alleles).toEqual([]);

    // At balancePct 30 the balance threshold alone already drops every stutter peak. At 10 it
    // keeps them, so only the stutter rule (a peak one repeat shorter than a taller one and below
    // stutterPct of it) removes them. Measured heights: D1 150 bp 366 vs 152 bp 2991 (12.2%);
    // D2 206 bp 313 vs 210 bp 2005 (15.6%); D3 324 bp 270 vs 320 bp 1799 (15.0%, one repeat LONGER).
    const sizes = (cs: typeof calls, m: string) => cs.find((c) => c.marker === m)!.alleles.map((a) => Math.round(a.size));
    const note = (cs: typeof calls, m: string) => cs.find((c) => c.marker === m)!.note;
    const low = callAlleles(t, s, panel, { minHeight: 150, stutterPct: 25, balancePct: 10 });
    expect(sizes(low, 'D1')).toEqual([152, 158]);
    expect(note(low, 'D1')).toBe('heterozygous'); // the 150 stutter is not counted as a third peak
    expect(sizes(low, 'D2')).toEqual([210]);
    expect(note(low, 'D2')).toMatch(/homozygous/); // the 206 stutter is not a second allele
    expect(sizes(low, 'D3')).toEqual([320, 324]); // only back stutter (n - 1 repeat) is removed
    // stutterPct is the bound: at 10% both stutter peaks (12.2%, 15.6%) stay peaks.
    const strict = callAlleles(t, s, panel, { minHeight: 150, stutterPct: 10, balancePct: 10 });
    expect(sizes(strict, 'D2')).toEqual([206, 210]);
    expect(note(strict, 'D1')).toMatch(/^1 more peak above the balance threshold/);
  });

  it('copes with a missing standard peak and an extra artefact peak', () => {
    const scanOf = run.scanOf;
    const peaks = std.filter((bp) => bp !== 250).map((bp) => [bp, 700] as [number, number]);
    peaks.push([222, 650]); // pull-up / artefact between standards
    const liz = Array.from({ length: run.N }, (_, i) => {
      let v = 60;
      for (const [bp, h] of peaks) { const d = i - scanOf(bp); v += h * Math.exp(-(d * d) / (2 * 3.5 * 3.5)); }
      return v;
    });
    const s = sizeStandard(liz, std);
    const assigned = new Map(s.points.map((p) => [p.bp, p.scan]));
    for (const bp of std) if (bp !== 250 && assigned.has(bp)) expect(Math.abs(assigned.get(bp)! - scanOf(bp))).toBeLessThan(2);
    expect(s.matched).toBeGreaterThanOrEqual(std.length - 1);
    expect(Math.abs(scanToBp(s, scanOf(300)) - 300)).toBeLessThan(0.6);
  });
  it('rejects panel lines without a size range', () => {
    expect(() => parsePanel('bad, FAM, 200, 100, 2')).toThrow(/expected/);
  });
});

describe('microsatellite workflow', () => {
  it('example runs → Microsatellite Analysis → genotype table and sized documents', async () => {
    const { EXAMPLE_DATASETS } = await import('../core/exampleDatasets');
    const { runMicrosatellites, FRAGMENT_SIZING_KEY } = await import('../core/operationRunners');
    const runs = EXAMPLE_DATASETS.find((e) => e.id === 'fragment-runs')!.build([]);
    expect(runs).toHaveLength(3);
    const panel = 'D1S80, 6-FAM, 140, 170, 2\nTH01, VIC, 150, 200, 4\nvWA, NED, 170, 210, 4';
    const r = runMicrosatellites(runs, { standard: 'GeneScan 500 LIZ', sizeDye: 'LIZ', panel, minHeight: 100, stutterPct: 25, balancePct: 30 }, { sourceLabel: 'x' });
    expect(r.updated).toHaveLength(3);
    expect(typeof r.updated[0].docMetadata?.[FRAGMENT_SIZING_KEY]).toBe('string');
    const table = String(r.created[0].docMetadata?.Notes);
    const row = (s: string) => table.split('\n').find((l) => l.startsWith(`Example – ${s}`))!.split('\t');
    const round = (cell: string) => cell.split('/').map((x) => Math.round(Number(x))).join('/');
    expect(row('Sample_01').slice(2).map(round)).toEqual(['152/158', '172', '182/190']);
    expect(row('Sample_02').slice(2).map(round)).toEqual(['154', '168', '186/194']);
    expect(row('Sample_03').slice(2).map(round)).toEqual(['150/160', '176', '182']);
  });
});

describe('artefacts seen in real 3730xl runs', () => {
  // An off-scale VIC allele (clipped at 32,767) bleeds into every other dye at the same scan,
  // including the size standard; its flat top must not become two "alleles".
  const std = SIZE_STANDARDS['GeneScan 500 LIZ'];
  const scanOf = (bp: number) => 1500 + 11 * bp - 0.003 * bp * bp;
  const N = 9000;
  const gauss = (peaks: [number, number][]) => Array.from({ length: N }, (_, i) => {
    let v = 50;
    for (const [bp, h] of peaks) { const d = i - scanOf(bp); v += h * Math.exp(-(d * d) / (2 * 4 * 4)); }
    return Math.min(32767, Math.round(v));
  });
  const vic = gauss([[290, 90000], [295, 70000]]); // both off-scale
  const fam = gauss([[290, 3000], [295, 2500], [180, 4000]]); // pull-up + a real FAM allele
  const pet = gauss([[290, 1500], [295, 1200]]); // pull-up only
  const liz = gauss([...std.map((bp) => [bp, 4000] as [number, number]), [290, 4500], [295, 3500]]); // pull-up in the standard too
  const trace = parseFsa(encodeFsa({ channels: [{ dye: '6-FAM', data: fam }, { dye: 'VIC', data: vic }, { dye: 'NED', data: gauss([]) }, { dye: 'PET', data: pet }, { dye: 'LIZ', data: liz }] }));

  it('an off-scale plateau is one peak', () => {
    const p = findPeaks(trace.channels[1].data, 200).filter((x) => x.saturated);
    expect(p).toHaveLength(2);
  });
  it('pull-up in the size standard is ignored, and sizing stays exact', () => {
    const s = sizeStandard(trace.channels[4].data, std, 100, saturatedScans(trace, 'LIZ'));
    expect(s.matched).toBe(std.length);
    expect(Math.abs(scanToBp(s, scanOf(222)) - 222)).toBeLessThan(0.5);
  });
  it('pull-up peaks in other dyes are removed; the real allele and the off-scale alleles stay', () => {
    const s = sizeStandard(trace.channels[4].data, std, 100, saturatedScans(trace, 'LIZ'));
    expect(cleanPeaks(trace, 'PET', s, 200)).toEqual([]);
    expect(cleanPeaks(trace, '6-FAM', s, 200).map((p) => Math.round(p.size))).toEqual([180]);
    const calls = callAlleles({ ...trace, channels: trace.channels.filter((c) => c.dye !== 'LIZ') }, s, parsePanel('M1, VIC, 280, 305, 5'), { minHeight: 200, stutterPct: 25, balancePct: 30 });
    expect(calls[0].alleles.map((a) => Math.round(a.size))).toEqual([290, 295]);
    expect(calls[0].note).toMatch(/off-scale/);
  });
  it('Auto picks the standard that fits, and a forced wrong standard is flagged', () => {
    const a = autoSizeStandard(trace.channels[4].data, 100, saturatedScans(trace, 'LIZ'));
    expect(a.name).toMatch(/500/);
    const wrong = sizeStandard(trace.channels[4].data, SIZE_STANDARDS['GeneScan 600 LIZ v2'], 100, saturatedScans(trace, 'LIZ'));
    expect(sizingWarning(wrong)).toMatch(/poor size-standard fit|not found/);
  });
});

describe('size-standard matching on difficult runs (cases from a real 3730xl dataset)', () => {
  const std = SIZE_STANDARDS['GeneScan 500 LIZ'];
  const N = 8000;
  const scanOf = (bp: number) => 1300 + 11.6 * bp;
  const gauss = (peaks: [number, number][], width = 4) => Array.from({ length: N }, (_, i) => {
    let v = 50;
    for (const [sc, h] of peaks) { const d = i - sc; v += h * Math.exp(-(d * d) / (2 * width * width)); }
    return Math.min(32767, Math.round(v));
  });
  it('a real standard peak at the same scan as an off-scale peak in another dye is kept', () => {
    const liz = gauss(std.map((bp) => [scanOf(bp), 5000] as [number, number]));
    const other = gauss([[scanOf(50), 90000]]); // off-scale sample peak exactly where the 50-bp standard is
    const trace = parseFsa(encodeFsa({ channels: [{ dye: 'VIC', data: other }, { dye: 'LIZ', data: liz }] }));
    const s = sizeStandard(trace.channels[1].data, std, 100, saturatedScans(trace, 'LIZ'));
    expect(s.points.find((p) => p.bp === 50)!.scan).toBeCloseTo(scanOf(50), 0);
    expect(s.points.find((p) => p.bp === 35)!.scan).toBeCloseTo(scanOf(35), 0);
  });
  it('an early cluster of standard-height artefact peaks is not taken for the small standards', () => {
    const artefacts: [number, number][] = Array.from({ length: 14 }, (_, k) => [1000 + k * 12, 4000 + ((k * 1700) % 6000)]);
    const liz = gauss([...artefacts, ...std.map((bp) => [scanOf(bp) + 180, 5000] as [number, number])]);
    const s = sizeStandard(liz, std);
    expect(s.matched).toBe(std.length);
    for (const p of s.points) expect(Math.abs(p.scan - (scanOf(p.bp) + 180))).toBeLessThan(2);
    expect(s.rSquared).toBeGreaterThan(0.999);
  });
  it('small standards lost in the primer peak, a peak past 500 bp and a weak spike do not shift the match', () => {
    // OSIRIS Identifiler runs: 35/50/75 hidden, an artefact after the 500-bp peak, a spike near 345 bp
    const kept = std.filter((bp) => bp >= 100);
    const liz = gauss([...kept.map((bp) => [scanOf(bp), 5000] as [number, number]), [scanOf(560), 5000], [scanOf(345), 1600]]);
    const s = sizeStandard(liz, std);
    expect(s.points.map((p) => p.bp)).toEqual(kept);
    expect(s.rSquared).toBeGreaterThan(0.999);
    expect(sizingWarning(s)).toBeNull(); // only end standards missing
    expect(scanToBp(s, scanOf(222))).toBeCloseTo(222, 0);
  });
  it('two similar peaks 1 bp apart are both kept; a small −A shoulder is dropped', () => {
    const lizData = gauss(std.map((bp) => [scanOf(bp), 5000] as [number, number]));
    const famData = gauss([[scanOf(150), 3000], [scanOf(151), 2800], [scanOf(210), 4000], [scanOf(209), 900]]);
    const t = parseFsa(encodeFsa({ channels: [{ dye: '6-FAM', data: famData }, { dye: 'LIZ', data: lizData }] }));
    const sizing = sizeStandard(t.channels[1].data, std);
    const sizes = cleanPeaks(t, '6-FAM', sizing, 200).map((p) => Math.round(p.size));
    expect(sizes).toEqual([150, 151, 210]);
  });
});

describe('allelic ladder naming', () => {
  const std = SIZE_STANDARDS['GeneScan 500 LIZ'];
  const N = 8000;
  const scanOf = (bp: number) => 1300 + 11.6 * bp;
  const gauss = (peaks: [number, number][]) => Array.from({ length: N }, (_, i) => {
    let v = 50;
    for (const [bp, h] of peaks) { const d = i - scanOf(bp); v += h * Math.exp(-(d * d) / 32); }
    return Math.round(v);
  });
  // TH01-like locus, nominal 150 + 4 bp per repeat; the instrument runs it 3 bp longer
  const names = ['5', '6', '7', '8', '9', '9.3', '10', '11'];
  const nominal = (n: string) => 150 + 4 * (Number(n.split('.')[0]) - 5) + Number(n.split('.')[1] ?? 0);
  const xml = `<KitData><Kits><Set><Name>Demo</Name><FsaChannelMap><Channel><KitChannelNumber>1</KitChannelNumber><fsaChannelNumber>1</fsaChannelNumber></Channel></FsaChannelMap>
    <Locus><Name>TH01</Name><Channel>1</Channel><MinBP>146</MinBP><MaxBP>182</MaxBP><LadderAlleles>${names.map((n) => `<Allele><Name>${n}</Name><BP>${nominal(n)}</BP></Allele>`).join('')}</LadderAlleles></Locus>
    <Locus><Name>AMEL</Name><Channel>1</Channel><MinBP>103</MinBP><MaxBP>109</MaxBP><LadderAlleles><Allele><Name>1</Name><BP>103</BP></Allele><Allele><Name>2</Name><BP>109</BP></Allele></LadderAlleles></Locus></Set></Kits></KitData>`;
  const run = (fam: [number, number][]) => {
    const t = parseFsa(encodeFsa({ channels: [{ dye: '6-FAM', data: gauss(fam) }, { dye: 'LIZ', data: gauss(std.map((bp) => [bp, 5000])) }] }));
    return { t, s: sizeStandard(t.channels[1].data, std) };
  };
  const markers = parseKitXml(xml)[0].markers;
  const ladder = run([...names.map((n) => [nominal(n) + 3, 3000] as [number, number]), [nominal('5') + 3 - 4, 600], [106, 3000], [112, 3000]]);
  const cal = calibrateLadder(ladder.t, ladder.s, markers);

  it('reads the kit and finds the ladder despite the size offset and a stutter peak', () => {
    expect(markers.map((m) => [m.name, m.dye, m.repeat])).toEqual([['TH01', '#1', 4], ['AMEL', '#1', 6]]);
    expect(cal.problems).toEqual([]);
    expect(cal.bins.TH01.map((b) => b.name)).toEqual(names);
    expect(cal.bins.TH01[0].size).toBeCloseTo(nominal('5') + 3, 0);
    expect(cal.bins.AMEL.map((b) => b.name)).toEqual(['X', 'Y']);
  });
  it('names sample alleles from the ladder, microvariants included, and flags off-ladder peaks', () => {
    const o = { minHeight: 100, stutterPct: 25, balancePct: 30 };
    const a = run([[nominal('8') + 3, 2500], [nominal('9.3') + 3, 2300], [106, 2000]]);
    const calls = callAlleles(a.t, a.s, markers, o, cal.bins);
    expect(calls.map((c) => c.alleles.map((x) => x.name).join(','))).toEqual(['8,9.3', 'X']);
    const b = run([[nominal('11') + 3 + 4, 2500], [106, 2000], [112, 1900]]);
    const cb = callAlleles(b.t, b.s, markers, o, cal.bins);
    expect(cb[0].alleles.map((x) => x.name)).toEqual(['OL']);
    expect(cb[0].note).toMatch(/off-ladder: .*≈ 12\)/);
    expect(cb[1].alleles.map((x) => x.name).join(',')).toBe('X,Y');
    expect(nameAllele(cal.bins.TH01[4].size + 2, cal.bins.TH01, 4).variant).toBe('9.2');
  });
});
