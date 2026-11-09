// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RAMACHANDRAN_FRAME, RamachandranPlot, placeOutlierLabels, type LabelBox } from '../components/RamachandranPlot';
import type { FigureExportButtonProps } from '../components/FigureExportButton';
import { MIN_FIGURE_HEIGHT_PX, MIN_FIGURE_WIDTH_PX } from '../core/figureCapture';
import { delimitedText, finalizeSvgMarkup, plainTextTable } from '../core/figureExport';
import {
  OUTLIER_ADVICE, REGION_CAVEAT, REGION_COLUMN, backboneTorsions, modelPhrase, plottedModelOf, ramachandranOutliers,
  ramachandranPoints, ramachandranTable, residueLabel,
  type BackboneTorsionReport, type PlottedModel, type RamachandranRegion, type ResidueTorsions,
} from '../core/ramachandran';
import { parseStructure, residueNumberLabel, type Structure } from '../core/structureView';
import { dataPath, haveTestData } from './testData';

const nodeFs: string = 'node:fs';
const fs = await import(/* @vite-ignore */ nodeFs).catch(() => null) as null | { readFileSync: (p: string, e: string) => string };
const read = (rel: string): string => fs!.readFileSync(dataPath(rel), 'utf8');

const UBQ_CIF = 'rcsb/1UBQ.cif';
const A5R_CIF = 'rcsb/1A5R.cif';
const HHB_CIF = 'rcsb/4HHB.cif';
const MBN_CIF = 'rcsb/1MBN.cif';
const REF = 'reference/structure.json';
interface RefTorsion { seq_id: number; resname: string; phi: number | null; psi: number | null }

// ─── A synthetic chain (no engine call, so these run without reference data) ───

const res = (over: Partial<ResidueTorsions> & Pick<ResidueTorsions, 'resName' | 'labelSeqId' | 'authSeqId'>): ResidueTorsions => ({
  chain: 'H', insCode: null, phi: -60, psi: -45, omega: 180, ramachandranClass: 'general', region: 'favoured', ...over,
});
const reportOf = (residues: ResidueTorsions[]): BackboneTorsionReport => {
  const count = (r: RamachandranRegion) => residues.filter((x) => x.region === r).length;
  return {
    chain: 'H', labelChain: 'B', residues,
    counts: { favoured: count('favoured'), allowed: count('allowed'), outlier: count('outlier'), unclassified: residues.filter((x) => x.region === null).length },
    chainBreaks: 1, peptideBondMaxAngstrom: 1.8, regionRule: 'synthetic rule',
  };
};

/**
 * Author chain H (label chain B), numbered from 100, with the insertion 102A and a chain break after
 * 103. Two residues sit on an angle of exactly 0, which a truthiness test on the angles would drop;
 * one sits on the -180/180 corner. Plotted: 101, 102A, 106 and 107. Outliers: 102A ASN and 107 VAL.
 */
const SYNTHETIC = reportOf([
  res({ resName: 'MET', labelSeqId: 1, authSeqId: 100, phi: null, omega: null, psi: 150, region: null }),
  res({ resName: 'LYS', labelSeqId: 2, authSeqId: 101, phi: -120, psi: 130 }),
  res({ resName: 'ASN', labelSeqId: 3, authSeqId: 102, insCode: 'A', phi: 0, psi: -60, region: 'outlier' }),
  res({ resName: 'ALA', labelSeqId: 4, authSeqId: 103, phi: -65, psi: null, region: null }),
  res({ resName: 'SER', labelSeqId: 5, authSeqId: 105, phi: null, omega: null, psi: 140, region: null }),
  res({ resName: 'PRO', labelSeqId: 6, authSeqId: 106, phi: -70, psi: 0, ramachandranClass: 'trans-proline', region: 'allowed' }),
  res({ resName: 'VAL', labelSeqId: 7, authSeqId: 107, phi: -180, psi: 180, ramachandranClass: 'ile-val', region: 'outlier' }),
  res({ resName: 'TRP', labelSeqId: 8, authSeqId: 108, phi: -100, psi: null, region: null }),
]);

/** A structure of one model, as an X-ray entry is. */
const ONE_MODEL: PlottedModel = { modelNum: 1, count: 1 };

const render = (report: BackboneTorsionReport, name = 'Test structure', model: PlottedModel = ONE_MODEL): string =>
  renderToStaticMarkup(React.createElement(RamachandranPlot, { report, name, model }));
/** The words a stretch of markup shows: tags dropped, the entities React writes decoded. */
const wordsOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

/** The plot's own drawing out of a rendered figure: what the export control saves as SVG, PNG or PDF. */
const svgOf = (html: string): string => {
  const at = html.search(/<svg\b[^>]*aria-label="Ramachandran plot/);
  expect(at, 'the plot SVG').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</svg>', at) + '</svg>'.length);
};
const attrsOf = (tag: string): Record<string, string> =>
  Object.fromEntries(Array.from(tag.matchAll(/([\w:-]+)="([^"]*)"/g)).map((a) => [a[1], a[2]]));
/** Every <text> of a drawing: its attributes and the words it shows. */
const textsOf = (svg: string) => Array.from(svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g))
  .map((m) => ({ attrs: attrsOf(m[1]), words: wordsOf(m[2]).trim() }));
/** Every <line> of a drawing, by its end points. */
const linesOf = (svg: string) => Array.from(svg.matchAll(/<line\b([^>]*)\/?>/g)).map((m) => {
  const a = attrsOf(m[1]);
  return { x1: Number(a.x1), y1: Number(a.y1), x2: Number(a.x2), y2: Number(a.y2), stroke: a.stroke };
});
/** The outlier labels a drawing shows, in drawing order. */
const outlierLabelsOf = (svg: string) => textsOf(svg).filter((t) => 'data-mbc-outlier-label' in t.attrs);

/** Split comma-separated text into rows of cells, undoing RFC 4180 quoting. */
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

const overlap = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const within = (a: LabelBox, area: LabelBox): boolean =>
  a.x >= area.x - 1e-9 && a.y >= area.y - 1e-9 && a.x + a.width <= area.x + area.width + 1e-9 && a.y + a.height <= area.y + area.height + 1e-9;
const PLOT_AREA: LabelBox = { x: RAMACHANDRAN_FRAME.x, y: RAMACHANDRAN_FRAME.y, width: RAMACHANDRAN_FRAME.width, height: RAMACHANDRAN_FRAME.height };
/** The room an outlier's marker takes (radius 3.4). */
const markOf = (p: { x: number; y: number }): LabelBox => ({ x: p.x - 3.4, y: p.y - 3.4, width: 6.8, height: 6.8 });

/**
 * Check that a set of outlier labels names each outlier once, stays inside the plot, keeps clear
 * of the other labels and of every other outlier's marker, and sits on its point's row unless a
 * leader line joins it to its point.
 */
function expectReadableLabels(points: { text: string; x: number; y: number }[], where: string): ReturnType<typeof placeOutlierLabels> {
  const labels = placeOutlierLabels(points, PLOT_AREA);
  expect(labels.map((l) => l.text), where).toEqual(points.map((p) => p.text));
  labels.forEach((l, i) => {
    const p = points[i];
    expect(within(l.box, PLOT_AREA), `${where}: ${l.text} inside the plot`).toBe(true);
    labels.forEach((other, j) => {
      if (j > i) expect(overlap(l.box, other.box), `${where}: ${l.text} clear of ${other.text}`).toBe(false);
    });
    points.forEach((q, j) => {
      if (j !== i) expect(overlap(l.box, markOf(q)), `${where}: ${l.text} clear of the marker of ${q.text}`).toBe(false);
    });
    expect(overlap(l.box, markOf(p)), `${where}: ${l.text} clear of its own marker`).toBe(false);
    if (l.leader) {
      expect([l.leader.x1, l.leader.y1], `${where}: ${l.text} leader starts at its point`).toEqual([p.x, p.y]);
      expect(l.leader.x2, `${where}: ${l.text} leader ends at its label`).toBeCloseTo(l.anchor === 'start' ? l.box.x : l.box.x + l.box.width, 9);
    } else {
      expect(l.box.y + l.box.height / 2, `${where}: ${l.text} on its point's row`).toBeCloseTo(p.y, 9);
    }
    // A label stays near its point: no further than a few rows of labels away.
    expect(Math.abs(l.box.y + l.box.height / 2 - p.y), `${where}: ${l.text} near its point`).toBeLessThanOrEqual(80);
  });
  return labels;
}

/** The point markers of a rendered plot: residue label, region and drawn position. */
const circlesOf = (html: string) => Array.from(html.matchAll(/<circle\b[^>]*\bdata-residue="([^"]*)"[^>]*>/g)).map((m) => ({
  residue: m[1],
  region: /\bdata-region="([^"]*)"/.exec(m[0])?.[1],
  cx: Number(/\bcx="([^"]*)"/.exec(m[0])?.[1]),
  cy: Number(/\bcy="([^"]*)"/.exec(m[0])?.[1]),
}));

describe('reading the torsions', () => {
  it('throws the engine error for text it cannot read, rather than plotting nothing', () => {
    expect(() => backboneTorsions('', null)).toThrow(/backbone_torsions.*No structure text/);
    expect(() => backboneTorsions('HEADER    not mmCIF\n')).toThrow(/need an mmCIF structure/);
  });
});

describe('plots every residue with both torsions', () => {
  it('keeps an angle of zero and drops every residue missing phi or psi (synthetic chain with a break)', () => {
    const points = ramachandranPoints(SYNTHETIC);
    expect(points.map((p) => residueLabel(p.residue))).toEqual(['H 101 LYS', 'H 102A ASN', 'H 106 PRO', 'H 107 VAL']);
    expect(points.map((p) => [p.phi, p.psi, p.region])).toEqual([[-120, 130, 'favoured'], [0, -60, 'outlier'], [-70, 0, 'allowed'], [-180, 180, 'outlier']]);

    // The figure draws those four and no others, each where its angles put it on axes of -180..180.
    const circles = circlesOf(render(SYNTHETIC));
    expect(Object.fromEntries(circles.map((c) => [c.residue, c.region]))).toEqual({
      'H 101 LYS': 'favoured', 'H 102A ASN': 'outlier', 'H 106 PRO': 'allowed', 'H 107 VAL': 'outlier',
    });
    expect(circles).toHaveLength(4);
    const at = (label: string) => circles.find((c) => c.residue === label)!;
    const F = RAMACHANDRAN_FRAME;
    expect(at('H 102A ASN').cx).toBeCloseTo(F.x + F.width / 2, 6); // phi 0: the middle
    expect(at('H 106 PRO').cy).toBeCloseTo(F.y + F.height / 2, 6); // psi 0: the middle
    expect(at('H 107 VAL').cx).toBeCloseTo(F.x, 6); // phi -180: the left edge
    expect(at('H 107 VAL').cy).toBeCloseTo(F.y, 6); // psi 180: the top edge (psi rises upward)
    expect(at('H 101 LYS').cx).toBeCloseTo(F.x + (60 / 360) * F.width, 6); // phi -120
    expect(at('H 101 LYS').cy).toBeCloseTo(F.y + (50 / 360) * F.height, 6); // psi 130
  });

  it('draws phi across and psi up, each axis ticked and gridded every 60 degrees from -180 to 180', () => {
    const F = RAMACHANDRAN_FRAME;
    const below = F.y + F.height;
    const svg = svgOf(render(SYNTHETIC));
    const texts = textsOf(svg);
    const STEPS = [-180, -120, -60, 0, 60, 120, 180];

    // Tick labels: phi's under the plot, centred on their x; psi's left of it, ending at the axis, on their y.
    const numbers = texts.filter((t) => /^-?\d+$/.test(t.words));
    const phiTicks = numbers.filter((t) => t.attrs['text-anchor'] === 'middle');
    const psiTicks = numbers.filter((t) => t.attrs['text-anchor'] === 'end');
    expect(phiTicks.length + psiTicks.length, 'every number in the drawing is a tick').toBe(numbers.length);
    expect(phiTicks.map((t) => Number(t.words))).toEqual(STEPS);
    expect(psiTicks.map((t) => Number(t.words))).toEqual(STEPS);
    for (const t of phiTicks) {
      const v = Number(t.words);
      expect(Number(t.attrs.x), `phi tick ${v}`).toBeCloseTo(F.x + ((v + 180) / 360) * F.width, 6);
      expect(Number(t.attrs.y), `phi tick ${v}`).toBeGreaterThan(below);
    }
    for (const t of psiTicks) {
      const v = Number(t.words);
      expect(Number(t.attrs.y), `psi tick ${v}`).toBeCloseTo(F.y + ((180 - v) / 360) * F.height + 3.5, 6); // 180 at the top
      expect(Number(t.attrs.x), `psi tick ${v}`).toBeLessThan(F.x);
    }

    // Grid lines through every tick, across the whole plot.
    const lines = linesOf(svg).filter((l) => l.stroke !== 'var(--mbc-text-secondary)'); // not a leader line
    const vertical = lines.filter((l) => l.x1 === l.x2 && l.y1 === F.y && l.y2 === below).map((l) => l.x1);
    const horizontal = lines.filter((l) => l.y1 === l.y2 && l.x1 === F.x && l.x2 === F.x + F.width).map((l) => l.y1);
    expect(vertical.map((x) => Math.round(((x - F.x) / F.width) * 360 - 180))).toEqual(STEPS);
    expect(horizontal.map((y) => Math.round(180 - ((y - F.y) / F.height) * 360))).toEqual(STEPS);

    // The axis titles: phi under the plot and level, psi left of it and turned upright.
    const phiTitle = texts.find((t) => t.words === 'φ (degrees)')!;
    const psiTitle = texts.find((t) => t.words === 'ψ (degrees)')!;
    expect(phiTitle).toBeDefined();
    expect(psiTitle).toBeDefined();
    expect(phiTitle.attrs.transform).toBeUndefined();
    expect(Number(phiTitle.attrs.x)).toBeCloseTo(F.x + F.width / 2, 6);
    expect(Number(phiTitle.attrs.y)).toBeGreaterThan(Math.max(...phiTicks.map((t) => Number(t.attrs.y))));
    expect(psiTitle.attrs.transform).toBe(`rotate(-90 ${psiTitle.attrs.x} ${psiTitle.attrs.y})`);
    expect(Number(psiTitle.attrs.x)).toBeLessThan(Math.min(...psiTicks.map((t) => Number(t.attrs.x))) - 20);
    expect(Number(psiTitle.attrs.y)).toBeCloseTo(F.y + F.height / 2, 6);
  });

  it('names the model it plots: model 1 of the 10 in the 1A5R NMR ensemble, and no model for single-model 1UBQ', () => {
    if (!haveTestData(A5R_CIF, UBQ_CIF)) return;
    const a5r = read(A5R_CIF);
    const ensemble = plottedModelOf(parseStructure(a5r));
    expect(ensemble).toEqual({ modelNum: 1, count: 10 });
    expect(modelPhrase(ensemble)).toBe('model 1 of 10');
    const report = backboneTorsions(a5r, 'A');
    const html = render(report, '1A5R', ensemble);
    // In the drawing the export saves, in the figure's heading, and in the name the export gives the file.
    const title = textsOf(svgOf(html)).filter((t) => 'data-mbc-plot-title' in t.attrs);
    expect(title.map((t) => t.words)).toEqual(['1A5R — chain A, model 1 of 10']);
    expect(Number(title[0].attrs.y)).toBeLessThan(RAMACHANDRAN_FRAME.y);
    expect(wordsOf(/<figcaption\b[\s\S]*?<\/figcaption>/.exec(html)![0])).toContain('Ramachandran plot — chain A, model 1 of 10');
    expect(html).toContain('title="Export &quot;1A5R — Ramachandran plot, chain A, model 1 of 10&quot; as an image');
    expect(/<svg\b[^>]*aria-label="([^"]*)"/.exec(html)![1]).toBe(
      `Ramachandran plot of 1A5R, chain A, model 1 of 10: ${ramachandranPoints(report).length} residues, 1 outlier`,
    );

    // An entry of one model needs no saying.
    const ubq = read(UBQ_CIF);
    const single = plottedModelOf(parseStructure(ubq));
    expect(single).toEqual({ modelNum: 1, count: 1 });
    expect(modelPhrase(single)).toBe('');
    const ubqHtml = render(backboneTorsions(ubq, 'A'), '1UBQ', single);
    expect(textsOf(svgOf(ubqHtml)).filter((t) => 'data-mbc-plot-title' in t.attrs).map((t) => t.words)).toEqual(['1UBQ — chain A']);
    expect(ubqHtml).toContain('title="Export &quot;1UBQ — Ramachandran plot, chain A&quot; as an image');
    expect(wordsOf(ubqHtml)).not.toMatch(/\bmodel\b/i);
  });

  it('reads the plotted model as the first of the structure, numbered as the file numbers it', () => {
    const structure = (nums: number[]): Structure => ({
      models: nums.map((modelNum) => ({ modelNum, atomRecordCount: 0, hetatmRecordCount: 0, chains: [] })), helices: [], strands: [],
    });
    expect(plottedModelOf(structure([1, 2, 3]))).toEqual({ modelNum: 1, count: 3 });
    expect(modelPhrase(plottedModelOf(structure([1, 2, 3])))).toBe('model 1 of 3');
    // A file whose models are numbered from 3 still has its first model plotted, and says so.
    expect(plottedModelOf(structure([3, 4]))).toEqual({ modelNum: 3, count: 2 });
    expect(modelPhrase(plottedModelOf(structure([3, 4])))).toBe('model 3, the first of 2');
    expect(modelPhrase(plottedModelOf(structure([7])))).toBe('');
    expect(() => plottedModelOf(structure([]))).toThrow(/no model/);
  });

  it('plots the 74 residues of 1UBQ chain A that have both, at the angles Biopython reports', () => {
    if (!haveTestData(UBQ_CIF, REF)) return;
    const report = backboneTorsions(read(UBQ_CIF), 'A');
    const ref = (JSON.parse(read(REF)) as { ramachandran: Record<string, RefTorsion[]> }).ramachandran['1UBQ.A'];
    const expected = ref.filter((r) => r.phi !== null && r.psi !== null);
    expect(report.residues).toHaveLength(76);
    expect(expected).toHaveLength(74); // MET 1 has no phi, GLY 76 no psi

    const points = ramachandranPoints(report);
    expect(points).toHaveLength(74);
    expect(points.map((p) => [p.residue.authSeqId, p.residue.resName])).toEqual(expected.map((r) => [r.seq_id, r.resname]));
    points.forEach((p, i) => {
      expect(Math.abs(p.phi - expected[i].phi!), `phi of ${residueLabel(p.residue)}`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(p.psi - expected[i].psi!), `psi of ${residueLabel(p.residue)}`).toBeLessThanOrEqual(0.1);
    });

    const circles = circlesOf(render(report, '1UBQ'));
    expect(circles).toHaveLength(74);
    expect(circles.map((c) => c.residue)).not.toContain('A 1 MET');
    expect(circles.map((c) => c.residue)).not.toContain('A 76 GLY');
  });
});

describe('lists outliers with residue numbers', () => {
  it('names each outlier by chain, author number with insertion code, and residue name (synthetic chain)', () => {
    const outliers = ramachandranOutliers(SYNTHETIC);
    expect(outliers).toEqual([
      { chain: 'H', labelSeqId: 3, number: '102A', resName: 'ASN', phi: 0, psi: -60, ramachandranClass: 'general' },
      { chain: 'H', labelSeqId: 7, number: '107', resName: 'VAL', phi: -180, psi: 180, ramachandranClass: 'ile-val' },
    ]);
    expect(outliers.map(residueLabel)).toEqual(['H 102A ASN', 'H 107 VAL']);

    // The figure lists them, in chain order, under a note that the regions are approximate.
    const html = render(SYNTHETIC);
    const list = /<ol\b[^>]*data-mbc-outliers[^>]*>([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? '';
    expect(Array.from(list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)).map((m) => m[1].replace(/<[^>]+>/g, ''))).toEqual([
      'H 102A ASN (φ 0.0°, ψ -60.0°, general)',
      'H 107 VAL (φ -180.0°, ψ 180.0°, ile-val)',
    ]);
    const note = html.indexOf('data-mbc-outlier-note');
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(html.indexOf('data-mbc-outliers'));
    const noteWords = wordsOf(html.slice(note, html.indexOf('data-mbc-outliers')));
    expect(noteWords).toContain('coarse approximation of MolProbity');
    expect(noteWords).toContain("not MolProbity's own classifier");
    // The one thing the note asks the reader to do.
    expect(OUTLIER_ADVICE).toBe('Check each outlier against MolProbity before reporting it.');
    expect(noteWords).toContain('Check each outlier against MolProbity before reporting it.');

    // No outlier is said in words, not shown as an empty list.
    const clean = reportOf(SYNTHETIC.residues.filter((r) => r.region !== 'outlier'));
    const cleanHtml = render(clean);
    expect(ramachandranOutliers(clean)).toEqual([]);
    expect(cleanHtml).not.toContain('data-mbc-outliers');
    expect(cleanHtml).toContain('No residue falls in an outlier region');
  });

  it('lists the outliers of real entries by author numbering (1A5R chain A, 4HHB chains A-D)', () => {
    if (!haveTestData(A5R_CIF, HHB_CIF)) return;
    // 1A5R's author numbering starts at -1, so every residue's author number differs from its label
    // number: a list numbered by label, or by position, names the wrong residues.
    const a5r = read(A5R_CIF);
    const report = backboneTorsions(a5r, 'A');
    const outliers = ramachandranOutliers(report);
    expect(outliers.length, 'the fixture must hold an outlier to test the list').toBeGreaterThan(0);
    expect(outliers).toHaveLength(report.counts.outlier);
    const chain = parseStructure(a5r).models[0].chains.find((c) => c.authAsymId === 'A' && c.residues.some((r) => r.labelSeqId !== null))!;
    for (const o of outliers) {
      const residue = chain.residues.find((r) => r.labelSeqId === o.labelSeqId)!;
      expect(residue, `residue ${o.labelSeqId} of 1A5R chain A`).toBeDefined();
      expect([o.chain, o.number, o.resName]).toEqual(['A', residueNumberLabel(residue), residue.resName]);
      expect(o.number).not.toBe(String(o.labelSeqId));
    }

    const hhb = read(HHB_CIF);
    let total = 0;
    for (const id of ['A', 'B', 'C', 'D']) {
      const r = backboneTorsions(hhb, id);
      const listed = ramachandranOutliers(r);
      expect(listed, `4HHB chain ${id}`).toHaveLength(r.counts.outlier);
      expect(listed.every((o) => o.chain === id), `4HHB chain ${id}`).toBe(true);
      total += listed.length;
    }
    expect(total).toBeGreaterThan(0);
  });

  it('labels each outlier in the drawing by chain, author number and residue name, as the list does (synthetic chain)', () => {
    const html = render(SYNTHETIC);
    const svg = svgOf(html);
    const labels = outlierLabelsOf(svg);
    expect(labels.map((l) => l.words)).toEqual(['H 102A ASN', 'H 107 VAL']);
    expect(labels.map((l) => l.attrs['data-mbc-outlier-label'])).toEqual(ramachandranOutliers(SYNTHETIC).map(residueLabel));
    // Only outliers are labelled.
    expect(svg).not.toContain('H 101 LYS</text>');
    expect(svg).not.toContain('H 106 PRO</text>');

    // Each label is drawn where the layout put it, beside its own point.
    const circles = circlesOf(html);
    const points = ['H 102A ASN', 'H 107 VAL'].map((text) => {
      const c = circles.find((x) => x.residue === text)!;
      return { text, x: c.cx, y: c.cy };
    });
    const placed = expectReadableLabels(points, 'synthetic');
    labels.forEach((l, i) => {
      expect([Number(l.attrs.x), Number(l.attrs.y), l.attrs['text-anchor']], l.words).toEqual([placed[i].x, placed[i].y, placed[i].anchor]);
    });
    // 107 VAL sits on the top-left corner, so its label drops a row to stay inside, joined by a leader.
    expect(placed[1].leader).not.toBeNull();
    const leaders = linesOf(svg).filter((l) => l.stroke === 'var(--mbc-text-secondary)');
    expect(leaders).toEqual(placed.filter((p) => p.leader).map((p) => ({ ...p.leader!, stroke: 'var(--mbc-text-secondary)' })));
  });

  it('keeps the labels of a crowd of outliers apart, clear of the markers and inside the plot', () => {
    // Nine outliers within three degrees of each other, and one on the bottom-right corner.
    const crowd = reportOf([
      ...Array.from({ length: 9 }, (_, i) => res({
        resName: 'LYS', labelSeqId: i + 1, authSeqId: 200 + i, phi: -40 + (i % 3), psi: -70 + Math.floor(i / 3), region: 'outlier',
      })),
      res({ resName: 'GLY', labelSeqId: 10, authSeqId: 300, phi: 180, psi: -180, ramachandranClass: 'glycine', region: 'outlier' }),
      res({ resName: 'ALA', labelSeqId: 11, authSeqId: 301, phi: -60, psi: -45 }),
    ]);
    const html = render(crowd);
    const circles = circlesOf(html);
    const points = ramachandranOutliers(crowd).map((o) => {
      const c = circles.find((x) => x.residue === residueLabel(o))!;
      return { text: residueLabel(o), x: c.cx, y: c.cy };
    });
    expect(points).toHaveLength(10);
    const placed = expectReadableLabels(points, 'crowd');
    expect(placed.filter((p) => p.leader).length, 'a crowd needs leader lines').toBeGreaterThan(0);
    expect(placed[9].anchor, 'the corner label goes left of its point').toBe('end');
    // What is drawn is that layout.
    const labels = outlierLabelsOf(svgOf(html));
    expect(labels.map((l) => [l.words, Number(l.attrs.x), Number(l.attrs.y), l.attrs['text-anchor']]))
      .toEqual(placed.map((p) => [p.text, p.x, p.y, p.anchor]));
  });

  it('labels every outlier of real entries readably (1MBN chain A, whose outliers crowd one corner; 4HHB chains A-D)', () => {
    if (!haveTestData(MBN_CIF, HHB_CIF)) return;
    const F = RAMACHANDRAN_FRAME;
    const check = (text: string, chain: string, name: string) => {
      const report = backboneTorsions(text, chain);
      const outliers = ramachandranOutliers(report);
      const svg = svgOf(render(report, name, plottedModelOf(parseStructure(text))));
      const labels = outlierLabelsOf(svg);
      expect(labels.map((l) => l.words), `${name} chain ${chain}`).toEqual(outliers.map(residueLabel));
      const points = outliers.map((o) => ({ text: residueLabel(o), x: F.xOf(o.phi, -180, 180), y: F.yOf(o.psi, -180, 180) }));
      const placed = expectReadableLabels(points, `${name} chain ${chain}`);
      expect(labels.map((l) => [Number(l.attrs.x), Number(l.attrs.y)])).toEqual(placed.map((p) => [p.x, p.y]));
      return outliers.length;
    };
    expect(check(read(MBN_CIF), 'A', '1MBN')).toBe(11);
    const hhb = read(HHB_CIF);
    expect(['A', 'B', 'C', 'D'].map((c) => check(hhb, c, '4HHB')).reduce((a, b) => a + b)).toBeGreaterThan(0);
  });
});

describe('exports through the figure export button', () => {
  it('draws the plot in a figure container beside the shared export control', () => {
    const html = render(SYNTHETIC, '1ABC');
    expect(html).toMatch(/^<figure\b[^>]*\bdata-mbc-figure\b/);
    // The shared control (FigureExportButton), once, named for this figure.
    expect(html.match(/class="mbc-figure-export[ "]/g)).toHaveLength(1);
    expect(html).toContain('title="Export &quot;1ABC — Ramachandran plot, chain H&quot; as an image, a document or a table"');

    // The plot is the SVG the control saves: outside the control, and large enough for it to pick.
    const svg = /<svg\b[^>]*aria-label="Ramachandran plot[^"]*"[^>]*>/.exec(html)?.[0];
    expect(svg).toBeDefined();
    const [, , w, h] = (/viewBox="([^"]*)"/.exec(svg!)?.[1] ?? '').split(/\s+/).map(Number);
    expect(w).toBeGreaterThanOrEqual(MIN_FIGURE_WIDTH_PX);
    expect(h).toBeGreaterThanOrEqual(MIN_FIGURE_HEIGHT_PX);
    const controlAt = html.indexOf('class="mbc-figure-export');
    const control = html.slice(controlAt, html.indexOf('</div>', controlAt));
    expect(control).toContain('Export');
    expect(control).not.toContain('<svg viewBox');
    expect(html.indexOf(svg!)).toBeGreaterThan(controlAt + control.length);

    // The exported drawing carries its own title, legend, caveat and advice, and names its outliers,
    // so the file says what it shows and what the colours mean.
    const drawing = wordsOf(svgOf(html));
    for (const words of [
      '1ABC — chain H', 'Favoured', 'Allowed', 'Outlier', 'coarse approximation of MolProbity', "not MolProbity's own classifier",
      OUTLIER_ADVICE, 'boundaries are not drawn', 'H 102A ASN', 'H 107 VAL',
    ]) {
      expect(drawing, words).toContain(words);
    }
  });

  it('writes the model, the outlier names and the MolProbity advice into the drawing the SVG, PNG and PDF are made from (1A5R)', () => {
    if (!haveTestData(A5R_CIF)) return;
    // The export saves the plot's <svg> as the SVG file and rasterises the same markup for PNG and PDF.
    const text = read(A5R_CIF);
    const report = backboneTorsions(text, 'A');
    const model = plottedModelOf(parseStructure(text));
    const F = RAMACHANDRAN_FRAME;
    const file = finalizeSvgMarkup(svgOf(render(report, '1A5R', model)), {
      width: F.w, height: F.h, title: '1A5R — Ramachandran plot, chain A, model 1 of 10',
    });
    expect(file).toContain('<title>1A5R — Ramachandran plot, chain A, model 1 of 10</title>');
    const texts = textsOf(file);
    expect(texts.filter((t) => 'data-mbc-plot-title' in t.attrs).map((t) => t.words)).toEqual(['1A5R — chain A, model 1 of 10']);
    expect(outlierLabelsOf(file).map((t) => t.words)).toEqual(['A 78 LYS']);
    expect(texts.map((t) => t.words).join(' ')).toContain(`${REGION_CAVEAT} ${OUTLIER_ADVICE}`);
  });

  it('carries the region caveat and the plotted model into what the CSV, TSV and TXT writers emit', () => {
    const HEADINGS = ['Model', 'Models in entry', 'Chain', 'Residue', 'Name', 'Phi (deg)', 'Psi (deg)', 'Omega (deg)', 'Class', REGION_COLUMN];
    const expectCaveat = (heading: string, where: string) => {
      for (const words of ['Region', 'coarse approximation of MolProbity', "not MolProbity's own classifier", 'check each outlier against MolProbity']) {
        expect(heading, `${where}: ${words}`).toContain(words);
      }
    };
    /** What each writer emits for a table: CSV and TSV parsed back into cells, TXT as text. */
    const written = (table: ReturnType<typeof ramachandranTable>) => {
      const csv = parseCsv(delimitedText(table, 'csv'));
      const tsv = delimitedText(table, 'tsv').replace(/\n$/, '').split('\n').map((line) => line.split('\t'));
      for (const [format, cells] of [['csv', csv], ['tsv', tsv]] as const) {
        expect(cells[0], format).toEqual(HEADINGS);
        expectCaveat(cells[0][9], format);
        expect(cells.every((row) => row.length === HEADINGS.length), `${format}: every row has every column`).toBe(true);
      }
      expect(tsv).toEqual(csv);
      return { rows: csv.slice(1), txt: plainTextTable(table) };
    };

    // The synthetic chain: one model.
    const synthetic = written(ramachandranTable(SYNTHETIC, '1ABC', ONE_MODEL));
    expect(synthetic.rows).toEqual([
      ['1', '1', 'H', '101', 'LYS', '-120.00', '130.00', '180.00', 'general', 'favoured'],
      ['1', '1', 'H', '102A', 'ASN', '0.00', '-60.00', '180.00', 'general', 'outlier'],
      ['1', '1', 'H', '106', 'PRO', '-70.00', '0.00', '180.00', 'trans-proline', 'allowed'],
      ['1', '1', 'H', '107', 'VAL', '-180.00', '180.00', '180.00', 'ile-val', 'outlier'],
    ]);
    const lines = synthetic.txt.split('\n');
    expect(lines[0]).toBe(`1ABC — chain H: 4 of 8 residues have both phi and psi (1 favoured, 1 allowed, 2 outlier). ${REGION_CAVEAT} ${OUTLIER_ADVICE}`);
    const head = lines.find((l) => l.startsWith('Model'))!;
    expect(head.endsWith(REGION_COLUMN), 'txt heading').toBe(true);
    expectCaveat(head, 'txt');

    if (!haveTestData(A5R_CIF, UBQ_CIF)) return;
    // 1A5R: model 1 of the 10 in the ensemble, on every row and in the text form's caption.
    const a5r = read(A5R_CIF);
    const ensemble = written(ramachandranTable(backboneTorsions(a5r, 'A'), '1A5R', plottedModelOf(parseStructure(a5r))));
    expect(ensemble.rows).toHaveLength(101);
    expect(ensemble.rows.every((r) => r[0] === '1' && r[1] === '10')).toBe(true);
    expect(ensemble.rows.filter((r) => r[9] === 'outlier').map((r) => r.slice(2, 5))).toEqual([['A', '78', 'LYS']]);
    expect(ensemble.txt.split('\n')[0]).toMatch(/^1A5R — chain A, model 1 of 10: 101 of 103 residues have both phi and psi/);
    expect(ensemble.txt.split('\n')[0]).toContain(OUTLIER_ADVICE);

    // 1UBQ: one model, said in the rows and not in the caption.
    const ubq = read(UBQ_CIF);
    const single = written(ramachandranTable(backboneTorsions(ubq, 'A'), '1UBQ', plottedModelOf(parseStructure(ubq))));
    expect(single.rows).toHaveLength(74);
    expect(single.rows.every((r) => r[0] === '1' && r[1] === '1')).toBe(true);
    expect(single.txt.split('\n')[0]).toMatch(/^1UBQ — chain A: 74 of 76 residues/);
  });

  it('hands the export control the plotted values as its table', async () => {
    const seen: FigureExportButtonProps[] = [];
    vi.resetModules();
    vi.doMock('../components/FigureExportButton', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../components/FigureExportButton')>()),
      FigureExportButton: (props: FigureExportButtonProps) => { seen.push(props); return null; },
    }));
    const ENSEMBLE: PlottedModel = { modelNum: 1, count: 10 };
    try {
      const { RamachandranPlot: Plot } = await import('../components/RamachandranPlot');
      renderToStaticMarkup(React.createElement(Plot, { report: SYNTHETIC, name: '1ABC', model: ONE_MODEL }));
      renderToStaticMarkup(React.createElement(Plot, { report: SYNTHETIC, name: '1ABC', model: ENSEMBLE }));
    } finally {
      vi.doUnmock('../components/FigureExportButton');
      vi.resetModules();
    }
    expect(seen).toHaveLength(2);
    expect(seen[0].baseName).toBe('1ABC — Ramachandran plot, chain H');
    // The file name, the SVG title and the PDF title (which default to the base name) name the model.
    expect(seen[1].baseName).toBe('1ABC — Ramachandran plot, chain H, model 1 of 10');
    expect(seen.map((s) => s.title)).toEqual([undefined, undefined]);
    // No writer of its own: CSV and TSV go through the shared delimitedText.
    expect(seen.map((s) => s.delimitedWriter)).toEqual([undefined, undefined]);
    const table = typeof seen[0].table === 'function' ? seen[0].table() : seen[0].table;
    expect(table).toEqual(ramachandranTable(SYNTHETIC, '1ABC', ONE_MODEL));
    expect(table!.headers).toEqual(['Model', 'Models in entry', 'Chain', 'Residue', 'Name', 'Phi (deg)', 'Psi (deg)', 'Omega (deg)', 'Class', REGION_COLUMN]);
    expect(table!.rows).toEqual([
      ['1', '1', 'H', '101', 'LYS', '-120.00', '130.00', '180.00', 'general', 'favoured'],
      ['1', '1', 'H', '102A', 'ASN', '0.00', '-60.00', '180.00', 'general', 'outlier'],
      ['1', '1', 'H', '106', 'PRO', '-70.00', '0.00', '180.00', 'trans-proline', 'allowed'],
      ['1', '1', 'H', '107', 'VAL', '-180.00', '180.00', '180.00', 'ile-val', 'outlier'],
    ]);
    expect(table!.caption).toContain(REGION_CAVEAT);
    const ensembleTable = typeof seen[1].table === 'function' ? seen[1].table() : seen[1].table;
    expect(ensembleTable).toEqual(ramachandranTable(SYNTHETIC, '1ABC', ENSEMBLE));
    expect(ensembleTable!.rows.map((r) => r.slice(0, 2))).toEqual(Array(4).fill(['1', '10']));
    expect(ensembleTable!.caption).toMatch(/^1ABC — chain H, model 1 of 10: /);
  });
});
