// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVVR: every CRISPR number says what it is. The candidate list is discovery, the ranked
 * number is a heuristic rank whose description is the rule the engine runs - every feature it
 * reads, its real bounds (which the engine owns and reports, BG-01M7E61C), and the
 * rank-plus-seed-matches order of the list - the seed count is
 * exact copies of the 12-nt PAM-proximal seed in the range searched, and genome-wide specificity -
 * which no
 * reference genome or method is configured to compute - is shown as "Not evaluated".
 *
 * Every surface is read as shipped: the CRISPR tab rendered on the server through the studio's own
 * engine calls, the macro catalogue and the CRISPR plugin's reply from the real WASM engine, and the
 * menu descriptions from the source file the App reads them from. Nothing is mocked.
 *
 * Wrong implementations this catches:
 * - the shipped "Hsu Specificity" header, "(Rust Doench 2016 Engine)" plugin name and macro comment;
 * - a model named in a label or header, even where a sentence elsewhere says it is not run;
 * - a seed column named "specificity", which reads as genome-wide;
 * - a heuristic described as activity or efficiency;
 * - genome-wide specificity shown as a number (0 or 100) instead of "Not evaluated" with the reason;
 * - a menu description naming SaCas9, which no preset scans for, or an efficiency model;
 * - a rank described as three spacer features over 0-100 when the scorer reads six and a PAM and
 *   reports only inside CRISPR_HEURISTIC_RANK_RANGE — whose floor the scorer clamps and whose
 *   ceiling is its arithmetic, every raise at once, held by a test rather than by a clamp
 *   (BG-01M7E69W AC1) — or a rank said to order a list the seed count also orders;
 * - a rank printed "/ 100" under a header stating a range it can never reach (BG-01M7E61C AC1).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrimerAndPCRStudio } from '../components/PrimerAndPCRStudio';
import { crisprNucleasePresets } from '../core/bioEngine';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import { resolveMenuNodeFunctionDescription } from '../data/menuFunctionDescriptions';
import { executeBuiltinWorkflowMacroRust, getBuiltinWorkflowMacrosRust } from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

// Same dynamic-import pattern as nativeMenuContract.test.ts (no @types/node in the project).
const nodeFsSpec = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFsSpec)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string;
};

/** The published models this engine never runs. */
const UNRUN_MODELS = ['Doench', 'Hsu', 'Zhang', 'Rule Set'] as const;
const NAMES_A_MODEL = new RegExp(UNRUN_MODELS.join('|'));

/** Seeded pseudo-random DNA (LCG), so every run reads the same bases. */
function randomDna(length: number, seed: number): string {
  let x = seed >>> 0;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = 'ACGT'[x >>> 30];
  }
  return out.join('');
}

const doc: SequenceDocument = {
  ...EMPTY_WORKSPACE_DOCUMENT,
  id: 'Dvvr_Guides',
  name: 'Dvvr_Guides',
  sequence: randomDna(3_000, 0x15_7c01),
};

/** The text a reader sees: tags and comments stripped, entities decoded, runs of space collapsed. */
const text = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

const crisprTab = () =>
  renderToStaticMarkup(
    <PrimerAndPCRStudio
      doc={doc}
      allDocuments={[doc]}
      onUpdateDocument={() => undefined}
      onAddConstruct={() => undefined}
      initialSubTab="crispr"
    />
  );

/** The guide table: its header cells and its rows, cell by cell. */
function guideTable(html: string): { headers: string[]; rows: string[][] } {
  // The workbench table draws each header cell with its own attributes and inner spans.
  const start = html.lastIndexOf('<table', html.indexOf('<span>Guide Name</span>'));
  const table = start < 0 ? '' : html.slice(start, html.indexOf('</table>', start) + '</table>'.length);
  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
  const rows = [...table.matchAll(/<tr[^>]*><td><strong>(?:gRNA|crRNA)[\s\S]*?<\/tr>/g)].map((m) =>
    [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]))
  );
  return { headers, rows };
}

/** The info callout above the guide table, as a reader reads it. */
const callout = (html: string) => text(/<div class="info-callout">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '');

/** The labels of the tab: buttons, option labels, strong labels and headers. */
const labelsOf = (html: string) => [
  ...[...html.matchAll(/<(button|option|strong|th|h3|label)[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2])),
  ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]),
];

/** The sentences of `s` that name an unrun model. */
const sentencesNamingAModel = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => NAMES_A_MODEL.test(x));

/**
 * The rank range the engine itself reports, read from the real WASM engine's rank description
 * rather than written out here (BG-01M7E61C AC4 owns the bound; every surface states it).
 */
function engineRankRange(): [number, number] {
  const model = (
    executeBuiltinWorkflowMacroRust('js-crispr-spcas9-scanner', doc) as {
      scoreModels: Record<string, string>;
    }
  ).scoreModels.onTargetScore;
  const bounds = /Heuristic rank \((\d+) to (\d+)\)/.exec(model);
  expect(bounds, `the engine does not report the rank's range: ${model}`).not.toBeNull();
  return [Number(bounds![1]), Number(bounds![2])];
}

describe('every CRISPR number says what it is (US-01M7DVVR)', () => {
  it('US-01M7DVVR AC1 no label, header, catalogue, plugin or macro string credits a number to an unrun model, and the seed column is named for what it counts', () => {
    const html = crisprTab();
    const { headers, rows } = guideTable(html);
    expect(rows.length, 'the fixture lists guides').toBeGreaterThan(0);

    // No label, header or option of the tab names a model.
    for (const label of labelsOf(html)) {
      expect(label, `the label "${label}"`).not.toMatch(NAMES_A_MODEL);
    }
    // Every model the markup names at all is named in a sentence that says it is not used.
    for (const sentence of sentencesNamingAModel(text(html))) {
      expect(sentence, 'a model is named only to say it is not run').toMatch(/\bnot a trained\b/);
    }
    // The seed column is named for what it counts, and no column is called a specificity score.
    expect(headers).toContain('Exact Seed Matches (range searched)');
    expect(headers).not.toContain('Hsu Specificity');
    // No score cell names a model.
    for (const row of rows) for (const cell of row) expect(cell).not.toMatch(NAMES_A_MODEL);

    // The macro catalogue and the CRISPR plugin's reply, from the real engine.
    const macros = getBuiltinWorkflowMacrosRust();
    expect(macros.some((m) => m.rustMacroId === 'js-crispr-spcas9-scanner')).toBe(true);
    for (const m of macros) {
      expect(JSON.stringify(m), `macro ${m.id}`).not.toMatch(NAMES_A_MODEL);
      expect(JSON.stringify(executeBuiltinWorkflowMacroRust(m.rustMacroId, doc)), `plugin ${m.id}`).not.toMatch(
        NAMES_A_MODEL
      );
    }
    // And the menu descriptions, the catalogue the App's menus read.
    const descriptions = readFileSync(new URL('../data/menuFunctionDescriptions.ts', import.meta.url), 'utf8');
    for (const model of UNRUN_MODELS) expect(descriptions, `menu descriptions name ${model}`).not.toContain(model);
  }, 55_000);

  it('US-01M7DVVR AC3 each score names its model and inputs, and genome-wide specificity is Not evaluated with the reason', () => {
    // The bounds are the engine's own, so the callout and the header move with the scorer and are
    // never read against a number this test wrote down (BG-01M7E61C).
    const [lo, hi] = engineRankRange();
    const html = crisprTab();
    const shown = callout(html);
    // The heuristic rank names the rule, every feature it reads, its real bounds, what orders the
    // list and that these SpCas9 rules of thumb are read off a Cas12a spacer unchanged. A rank
    // described as three features and a 0–100 range is not the rule the engine runs.
    for (const phrase of [
      'GC content',
      '40–65 %',
      '30–75 %',
      'position 20',
      'position 16',
      'position 4',
      'TTTT run',
      'GGG',
      `${lo} to ${hi}`,
      'seed-match',
      'Cas12a',
    ]) {
      expect(shown, `the rank callout does not name ${phrase}`).toContain(phrase);
    }
    expect(shown).not.toContain('0–100');
    // The seed count names the seed length, the range and the strands.
    expect(shown).toContain(
      'other exact copies of the 12-nt PAM-proximal seed across all 3,000 bases of this linear sequence, on both strands'
    );
    // Genome-wide specificity: not evaluated, and why.
    expect(shown).toContain(
      'Genome-wide specificity : Not evaluated — no reference genome or off-target search method is configured, so no genome-wide specificity is computed.'
    );
    const { headers, rows } = guideTable(html);
    expect(headers).toEqual(
      expect.arrayContaining([`Heuristic Rank (${lo}–${hi})`, 'Genome-wide Specificity'])
    );
    const genomeColumn = headers.indexOf('Genome-wide Specificity');
    for (const row of rows) expect(row[genomeColumn]).toBe('Not evaluated');
    // The reason travels with every cell, not with the callout alone.
    const cells = [...html.matchAll(/<td title="([^"]*)">Not evaluated<\/td>/g)].map((m) => m[1]);
    expect(cells).toHaveLength(rows.length);
    for (const reason of cells) expect(reason).toContain('no reference genome or off-target search method is configured');

    // The plugin's reply names each of its numbers the same way.
    const plugin = executeBuiltinWorkflowMacroRust('js-crispr-spcas9-scanner', doc) as {
      scoreModels: Record<string, string>;
      totalCandidatesFound: number;
      guidesListed: number;
    };
    for (const phrase of ['GC content', '40-65 %', '30-75 %', 'position 20', 'position 16', 'position 4', 'TTTT', 'GGG', `${lo} to ${hi}`, 'seed-match', 'Cas12a']) {
      expect(plugin.scoreModels.onTargetScore, `the plugin's rank model does not name ${phrase}`).toContain(phrase);
    }
    expect(plugin.scoreModels.seedMatches).toContain('12-nt PAM-proximal seed in all 3,000 bases of this sequence, on both strands');
    expect(plugin.scoreModels.genomeWideSpecificity).toMatch(/^Not evaluated: no reference genome or off-target search method is configured/);
    // The candidate total is the scan's, not the length of the list it kept.
    expect(plugin.totalCandidatesFound).toBeGreaterThan(plugin.guidesListed);
  }, 55_000);

  it('US-01M7DVVR AC4 the Find CRISPR Sites menu description names only supported nucleases and no efficiency model', () => {
    const description = resolveMenuNodeFunctionDescription('prm-crisp', 'Find CRISPR Sites');
    const presets = crisprNucleasePresets().map((n) => n.id);
    // Every nuclease it names is one a preset scans for.
    const named = description.match(/\b[A-Za-z]*Cas\d+[a-z]?\b/g) ?? [];
    expect(named.length, description).toBeGreaterThan(0);
    for (const nuclease of named) {
      expect(presets.some((id) => id.startsWith(nuclease)), `${nuclease} is not a preset (${presets.join(', ')})`).toBe(true);
    }
    expect(description).not.toContain('SaCas9');
    // And it claims no efficiency model it does not run.
    expect(description).not.toMatch(/efficien|activity|Doench|Rule Set|predicted/i);
    expect(description).toContain('heuristic');
  });

  /**
   * BG-01M7E61C AC1: the rank is printed as the bare number the engine reports, under a column
   * header that states the range the engine itself states - read from the real WASM engine's rank
   * description, never written out here.
   *
   * Wrong implementations this kills: the shipped cell `{g.onTargetScore} / 100` under a
   * "Heuristic Rank (8–99)" header beside a callout saying the rank is "held to 8 to 99", where a
   * reader sees "93 / 100" and cannot tell which bound is real; and a header or callout whose range
   * is a literal that no longer matches the scorer's own bound.
   */
  it('BG-01M7E61C AC1 the guide table prints each rank bare under a header stating the range the engine reports', () => {
    const [lo, hi] = engineRankRange();

    const html = crisprTab();
    const { headers, rows } = guideTable(html);
    expect(rows.length, 'the fixture lists guides').toBeGreaterThan(0);

    // The column states the engine's range, and no column of the table states another one.
    expect(headers).toContain(`Heuristic Rank (${lo}–${hi})`);
    const ranges = headers.flatMap((h) => [...h.matchAll(/\((\d+)[-–](\d+)\)/g)].map((m) => `${m[1]}–${m[2]}`));
    expect(ranges, `a column states a range the engine does not report: ${headers.join(' | ')}`).toEqual([
      `${lo}–${hi}`,
    ]);

    // Every cell is the bare rank: no denominator anywhere in it, and inside the stated range.
    const rankColumn = headers.findIndex((h) => h.startsWith('Heuristic Rank'));
    for (const row of rows) {
      const cell = row[rankColumn];
      expect(cell, `the rank cell "${cell}" is not the bare rank`).toMatch(/^\d+$/);
      expect(Number(cell)).toBeGreaterThanOrEqual(lo);
      expect(Number(cell)).toBeLessThanOrEqual(hi);
    }
    // And the callout beside the table says the rank is held to the same range, with no "/ 100"
    // anywhere in the guide table a reader could read it against.
    expect(callout(html)).toContain(`held to ${lo} to ${hi}`);
    const table = html.slice(html.lastIndexOf('<table', html.indexOf('<span>Guide Name</span>')));
    expect(text(table.slice(0, table.indexOf('</table>')))).not.toMatch(/\/\s*100/);
  }, 55_000);

  it('US-01M7DVVR AC5 no CRISPR surface calls a heuristic number efficiency, activity or genome-wide specificity, and an uncomputed number is unavailable, never 0 or 100', () => {
    const html = crisprTab();
    const all = text(html);
    // Any word for a measured quality appears only where the sentence says the number is not it.
    for (const sentence of all.split(/(?<=[.!?])\s+/).filter((s) => /efficien|activity/i.test(s))) {
      expect(sentence, 'a heuristic is never called efficiency or activity').toMatch(/not a measured or predicted cutting efficiency/);
    }
    // The heuristic is never labelled a specificity, and the seed column is never a percentage.
    const { headers, rows } = guideTable(html);
    expect(headers.filter((h) => /specificity/i.test(h))).toEqual(['Genome-wide Specificity']);
    const seedColumn = headers.indexOf('Exact Seed Matches (range searched)');
    for (const row of rows) expect(row[seedColumn]).toMatch(/^(No other seed copy|\d+ seed match(es)?)$/);
    // Genome-wide specificity, which the engine does not compute, is never a number.
    const genomeColumn = headers.indexOf('Genome-wide Specificity');
    for (const row of rows) expect(row[genomeColumn]).not.toMatch(/\d/);

    // The plugin's genome-wide field is the reason, not a number.
    const plugin = executeBuiltinWorkflowMacroRust('js-crispr-spcas9-scanner', doc) as {
      scoreModels: Record<string, unknown>;
    };
    expect(typeof plugin.scoreModels.genomeWideSpecificity).toBe('string');
    expect(String(plugin.scoreModels.genomeWideSpecificity)).not.toMatch(/^\s*(0|100)\b/);
  }, 55_000);
});
