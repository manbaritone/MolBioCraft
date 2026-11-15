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
 * The guided pipeline shows the same numbers through strings the engine writes, and AC5's
 * vocabulary rule below reads this studio's render alone - which is how the gRNA-ranking step came
 * to call the rank an "activity" heuristic with nothing failing (BG-01M7EGF6). That step's own
 * rationale, summary and metrics and the pipeline's catalogue entry are held to the same rule where
 * they are written, over the whole sample library, by
 * `bg_01m7egf6_ac2_no_pipeline_crispr_surface_calls_the_heuristic_rank_an_activity` in
 * `crates/molbiocraft-cloning/tests/cloning_pipelines_buffers.rs`.
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
import {
  crisprHeuristicRankDescriptionRust,
  executeBuiltinWorkflowMacroRust,
  getBuiltinWorkflowMacrosRust,
} from '../lib/rustBioEngine';
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

/**
 * The rank's rule as a reader reads it: its own callout beside the guide table, which holds the
 * engine's own sentence and nothing this component wrote about the scan (BG-01M7EYED).
 */
const rankRule = (html: string) =>
  text(/<div[^>]*data-crispr-rank-rule[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '');

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

/** The Rust file that declares the rank's range - the source the committed wasm is built from. */
const RUST_RANK_RANGE_SOURCE = new URL(
  '../../crates/molbiocraft-cloning/src/cloning_crispr.rs',
  import.meta.url
);

/**
 * The range `CRISPR_HEURISTIC_RANK_RANGE` declares in current Rust source, read out of the file
 * itself (BG-01M7EKMJ AC1).
 *
 * A missing, unreadable, empty, re-shaped or ambiguous source file is told apart from an answer and
 * named: none of them may read as "the range agrees" (LC-006, BG-01M7FAQZ).
 */
function declaredRankRange(at: URL = RUST_RANK_RANGE_SOURCE): [number, number] {
  const path = decodeURIComponent(at.pathname);
  let source: string;
  try {
    source = readFileSync(at, 'utf8');
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    throw new Error(
      `the Rust source declaring the rank range is ${code === 'ENOENT' ? 'missing' : `unreadable (${code ?? cause})`}: ${path}`
    );
  }
  if (source.trim() === '') throw new Error(`the Rust source declaring the rank range is empty: ${path}`);
  // A candidate is a line that begins with the declaration (`m`), which is how the source writes it
  // (cloning_crispr.rs, column 0), so the same text inside a `///` comment is not a candidate at
  // all - while `^` alone, matching only at the start of the file, would find nothing there and
  // read as "no declaration". An indented declaration inside a `mod` would be missed too, and is
  // the zero-candidate refusal below rather than an agreement. Every candidate is counted (`g`),
  // because a second spelling - one a `/* */` block hides from a line-anchored pattern - means this
  // reader cannot tell which pair the wasm must agree with, and taking the first match would adopt
  // whichever is written higher up (BG-01M7FAQZ).
  const declared = [
    ...source.matchAll(
      /^pub const CRISPR_HEURISTIC_RANK_RANGE:\s*\(i32,\s*i32\)\s*=\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*;/gm
    ),
  ];
  if (declared.length === 0) {
    throw new Error(
      `no \`pub const CRISPR_HEURISTIC_RANK_RANGE: (i32, i32) = (lo, hi);\` declaration in ${path}: this test cannot tell whether the committed wasm is current`
    );
  }
  if (declared.length > 1) {
    throw new Error(
      `${declared.length} \`pub const CRISPR_HEURISTIC_RANK_RANGE: (i32, i32) = (lo, hi);\` declarations in ${path}: ` +
        `this test cannot tell which one the committed wasm must agree with, and adopts neither. Leave exactly one ` +
        `(a commented-out range inside a \`/* */\` block is one of these).`
    );
  }
  return [Number(declared[0][1]), Number(declared[0][2])];
}

describe('every CRISPR number says what it is (US-01M7DVVR)', () => {
  /**
   * BG-01M7EKMJ AC1: the committed wasm this suite calls is the one current Rust source says it is.
   *
   * Every other check of the range here reads it from the engine (`engineRankRange`), and the engine
   * the frontend has is the prebuilt artifact behind `virtual:molbiocraft-wasm-bytes`
   * (`src/lib/rustBioEngine.ts`) - not this checkout's Rust. So changing
   * `CRISPR_HEURISTIC_RANK_RANGE` and skipping `npm run wasm:build` left the whole suite green
   * locally while the constant's own doc promised it would turn red; it only fired in CI, where the
   * wasm build runs first. That is the LC-009 trap one step removed: not a stale artifact, but a
   * guard whose firing depends on one.
   *
   * Wrong implementations this kills: reading the range only from the wasm, which agrees with
   * itself whatever the source says; and reading the source but treating an absent, empty or
   * re-shaped file as agreement (`declaredRankRange` names each instead).
   */
  it('BG-01M7EKMJ AC1 the committed wasm reports the rank range the Rust source declares', () => {
    const [lo, hi] = declaredRankRange();
    expect(
      engineRankRange(),
      `the committed wasm reports a rank range this checkout's Rust source does not declare. ` +
        `crates/molbiocraft-cloning/src/cloning_crispr.rs says (${lo}, ${hi}); run \`npm run wasm:build\` ` +
        `so public/molbiocraft_wasm.wasm carries the source it is built from.`
    ).toEqual([lo, hi]);
  }, 55_000);

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
    // It is read from the rank's own callout, and the window bounds carry the engine's own dashes:
    // that callout states the engine's sentence itself, not a retyped copy of it (BG-01M7EYED).
    const rule = rankRule(html);
    for (const phrase of [
      'GC content',
      '40-65 %',
      '30-75 %',
      'position 20',
      'position 16',
      'position 4',
      'TTTT run',
      'GGG',
      `${lo} to ${hi}`,
      'seed-match',
      'Cas12a',
    ]) {
      expect(rule, `the rank callout does not name ${phrase}`).toContain(phrase);
    }
    expect(`${rule} ${shown}`).not.toContain('0–100');
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
    // And the rank's own callout beside the table says it is held to the same range, with no
    // "/ 100" anywhere in the guide table a reader could read it against.
    expect(rankRule(html)).toContain(`held to ${lo} to ${hi}`);
    const table = html.slice(html.lastIndexOf('<table', html.indexOf('<span>Guide Name</span>')));
    expect(text(table.slice(0, table.indexOf('</table>')))).not.toMatch(/\/\s*100/);
  }, 55_000);

  /**
   * BG-01M7EYED AC3: the rule a researcher reads beside the guide table is the engine's own
   * sentence, read from the engine, not a copy of it typed here.
   *
   * The callout used to restate the whole rule, weights and all, as a TSX literal - the third
   * statement of one rule. `us_01m7dvvr_ac2_the_rank_the_engine_reports_is_the_rule_its_description_names`
   * (workbench_table_and_lineage.rs) re-scores every guide from the engine description's own prose,
   * so the engine's two statements cannot drift; nothing held this literal to either of them. The
   * drift that permitted is the second step of a legitimate weight change - change the scorer, do
   * what that Rust test asks and update the description - which left this callout, the surface a
   * researcher actually reads, as the only wrong one with every test in the repo green.
   *
   * Wrong implementations this kills: a callout that states the rule from a literal of its own
   * (which is not the engine's sentence word for word, so this fails the moment either is edited
   * without the other); and the failure mode that reading from the engine introduces, which a
   * literal did not have - an accessor returning an empty or an error string, leaving the callout
   * silent about the rule while every "does not say what it must not" check still passes.
   */
  it('BG-01M7EYED AC3 the callout states the rule the engine runs, read from the engine', () => {
    // The engine's own words, from the dedicated accessor that states them without scanning.
    const stated = crisprHeuristicRankDescriptionRust();
    const [lo, hi] = engineRankRange();
    // Each feature the scorer reads, and the range the engine reports. An empty or error string
    // names none of them, so this is also what makes a silent callout a failure below.
    const features = [
      'Heuristic rank',
      'a rule of thumb over the spacer and its PAM',
      'GC content',
      'position 20',
      'position 16',
      'position 4',
      'TTTT',
      'GGG',
      'seed-match',
      'Cas12a',
      `${lo} to ${hi}`,
    ];
    for (const phrase of features) {
      expect(stated, `the engine's own rank description does not name ${phrase}`).toContain(phrase);
    }

    const html = crisprTab();
    const rule = rankRule(html);
    // The reader reads the engine's sentence itself, word for word.
    expect(
      rule,
      `the callout does not state the engine's rule.\n  engine: ${stated}\n  callout: ${rule}`
    ).toContain(stated);
    // And every feature and the range are there in the render, not only in the accessor's reply.
    for (const phrase of features) {
      expect(rule, `the rank callout does not name ${phrase}`).toContain(phrase);
    }

    // What the callouts must never call the rank (US-01M7DVVR AC3, AC5): no sentence names a
    // measured quality except to deny it, the rule claims no activity and no specificity, and
    // genome-wide specificity is still the one thing reported as not evaluated.
    const read = `${rule} ${callout(html)}`;
    for (const sentence of read.split(/(?<=[.!?])\s+/).filter((s) => /efficien|activity/i.test(s))) {
      expect(sentence, 'a heuristic is never called efficiency or activity').toMatch(
        /not a measured or predicted cutting efficiency/
      );
    }
    expect(stated, 'the rank is not an activity and not a specificity').not.toMatch(/activity|specificit/i);
    expect(read).toContain('Genome-wide specificity : Not evaluated');
  }, 55_000);

  it('US-01M7DVVR AC5 no CRISPR surface calls a heuristic number efficiency, activity or genome-wide specificity, and an uncomputed number is unavailable, never 0 or 100', () => {
    const html = crisprTab();
    const all = text(html);
    // Any word for a measured quality appears only where the sentence says the number is not it.
    // The same rule over the guided pipeline's CRISPR surfaces is `bg_01m7egf6_ac2` in
    // crates/molbiocraft-cloning/tests/cloning_pipelines_buffers.rs (BG-01M7EGF6): these engine
    // strings reach a reader through the pipeline report, not through this render.
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

/* ------------------------------------------------------------------------------------------------
 * BG-01M7FA80: the committed engine carries the sources it was built from.
 *
 * Every check above reads its numbers from the engine the frontend has - the prebuilt
 * `public/molbiocraft_wasm.wasm` behind `virtual:molbiocraft-wasm-bytes` - never from this
 * checkout's Rust. BG-01M7EKMJ AC1 closed one keyhole in that wall by reading
 * `CRISPR_HEURISTIC_RANK_RANGE` out of the source and asserting the artifact agrees; its own
 * reviewer then changed `on_target += 14` to `+= 9` in `cloning_crispr.rs` and a label, skipped
 * `npm run wasm:build`, and watched 7 tests pass. A guard whose firing depends on a stale artifact
 * is LC-009 one step removed.
 *
 * So the build records a digest of every Rust source it compiled beside the engine it emits
 * (`public/molbiocraft_wasm.wasm.sources.sha256`, written by `scripts/build_rust_wasm.mjs`), and
 * this suite walks `crates/<crate>/src` again here and names every file that differs.
 *
 * Wrong implementations this kills:
 * - digesting only the files some criterion happens to name (today's keyhole): the set is walked,
 *   and the record must cover exactly what the walk finds, so a file nobody named is still covered;
 * - digesting the wasm bytes alone, which agree with themselves whatever the source says: nothing
 *   here reads the engine's bytes;
 * - comparing modification times, which a fresh checkout reorders: nothing here reads an mtime;
 * - a glob that matches nothing, which makes the digest a constant and the guard vacuous;
 * - a missing, empty or unparseable record read as "the artifact is current" (LC-006).
 */

const nodeCryptoSpec = 'node:crypto';
const nodeOsSpec = 'node:os';
const nodeUrlSpec = 'node:url';
const { createHash } = (await import(/* @vite-ignore */ nodeCryptoSpec)) as {
  createHash: (algorithm: 'sha256') => {
    update: (data: string, encoding: 'utf8') => { digest: (encoding: 'hex') => string };
  };
};
const { tmpdir } = (await import(/* @vite-ignore */ nodeOsSpec)) as { tmpdir: () => string };
const { pathToFileURL } = (await import(/* @vite-ignore */ nodeUrlSpec)) as {
  pathToFileURL: (path: string) => URL;
};
const nodeFs = (await import(/* @vite-ignore */ nodeFsSpec)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string;
  readdirSync: (
    path: URL,
    options: { withFileTypes: true }
  ) => Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  existsSync: (path: URL) => boolean;
  writeFileSync: (path: string, data: string, encoding: 'utf8') => void;
  mkdirSync: (path: string, options: { recursive: true }) => void;
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string, options: { recursive: true; force: true }) => void;
};

/** This checkout's root, from this file's own location. */
const REPO_ROOT = new URL('../../', import.meta.url);

/** The record the build writes beside the engine (`scripts/build_rust_wasm.mjs`). */
const SOURCE_DIGEST_SIDECAR = 'public/molbiocraft_wasm.wasm.sources.sha256';

/** What every failure here asks for, and the only thing that rewrites the record. */
const REBUILD = 'npm run wasm:build';

/**
 * The sha256 of one source, with CRLF collapsed to LF, so the digest is the same on every platform
 * whatever a checkout did to the line endings. The same rule the build writes with.
 */
const digestOf = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

/** The digest of a whole set of sources: its `<sha256>  <path>` lines, sorted. */
const digestOfAll = (digests: Map<string, string>) =>
  digestOf(
    [...digests]
      .map(([file, digest]) => `${digest}  ${file}`)
      .sort()
      .join('\n') + '\n'
  );

/**
 * Every Rust source the engine is built from, discovered by walking the tree at test time - so a
 * compute file added tomorrow is covered the day it is added, and no list is maintained anywhere.
 * Each crate's `src` is walked to any depth; `tests/` and `benches/` are not compiled into the
 * cdylib and are left out.
 */
function walkCrateSources(root: URL = REPO_ROOT): { files: string[]; crates: string[] } {
  const files: string[] = [];
  const crates: string[] = [];
  const walk = (dir: string) => {
    for (const entry of nodeFs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
      else if (entry.isFile() && entry.name.endsWith('.rs')) files.push(`${dir}${entry.name}`);
    }
  };
  for (const entry of nodeFs.readdirSync(new URL('crates/', root), { withFileTypes: true })) {
    if (!entry.isDirectory() || !nodeFs.existsSync(new URL(`crates/${entry.name}/Cargo.toml`, root))) continue;
    crates.push(entry.name);
    if (nodeFs.existsSync(new URL(`crates/${entry.name}/src/`, root))) walk(`crates/${entry.name}/src/`);
  }
  return { files: files.sort(), crates: crates.sort() };
}

/** Each walked source, as the tree holds it now. */
const readCrateSources = (files: string[]) =>
  new Map(files.map((file) => [file, nodeFs.readFileSync(new URL(file, REPO_ROOT), 'utf8')] as const));

/** The digest of each walked source, as the tree holds it now. */
const currentSourceDigests = (sources: Map<string, string>) =>
  new Map([...sources].map(([file, text]) => [file, digestOf(text)] as const));

/**
 * The record beside the engine, parsed. A missing, unreadable, empty, unparseable or entry-less
 * record is told apart from an answer and named, and none of them may read as "the artifact is
 * current" (LC-006, and the shape BG-01M7EKMJ AC1's own reader was written to avoid).
 */
function readRecordedSourceDigests(at: URL, label = SOURCE_DIGEST_SIDECAR): {
  digests: Map<string, string>;
  digest: string;
} {
  const refuse = (why: string) =>
    new Error(
      `the Rust sources recorded beside public/molbiocraft_wasm.wasm are ${why}. ` +
        `This suite cannot tell whether the committed engine is the one this checkout's Rust says it is; ` +
        `run \`${REBUILD}\` to record them. An unreadable record is not "the artifact is current".`
    );
  let text: string;
  try {
    text = nodeFs.readFileSync(at, 'utf8');
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    throw refuse(`${code === 'ENOENT' ? 'missing' : `unreadable (${code ?? String(cause)})`}: ${label}`);
  }
  if (text.trim() === '') throw refuse(`empty: ${label}`);
  const digests = new Map<string, string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith('#')) continue;
    const entry = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line);
    if (entry === null) {
      throw refuse(`unparseable: ${label} line ${i + 1} is not \`<sha256>  <path>\` but "${line}"`);
    }
    digests.set(entry[2], entry[1]);
  }
  if (digests.size === 0) throw refuse(`unparseable: ${label} records no source at all`);
  return { digests, digest: digestOfAll(digests) };
}

/** Every source whose current content the record does not account for, each said one way. */
function differingSources(recorded: Map<string, string>, current: Map<string, string>): string[] {
  const differ: string[] = [];
  for (const [file, digest] of current) {
    const was = recorded.get(file);
    if (was === undefined) differ.push(`${file} (added since the engine was built)`);
    else if (was !== digest) differ.push(`${file} (changed since the engine was built)`);
  }
  for (const file of recorded.keys()) {
    if (!current.has(file)) differ.push(`${file} (recorded, but no longer in the tree)`);
  }
  return differ.sort();
}

/** What a reader is told when the engine lags its sources: which files, and what to run. */
const staleMessage = (differ: string[]) =>
  `public/molbiocraft_wasm.wasm was built from Rust sources this checkout no longer holds, so every ` +
  `number this suite reads from the engine is the old code's. ${differ.length} file(s) differ:\n  ` +
  `${differ.join('\n  ')}\nRun \`${REBUILD}\` (and commit the engine with the change), or ` +
  `\`node scripts/build_rust_wasm.mjs --sources-only\` for a change that cannot alter codegen.`;

describe('the committed engine carries the sources it was built from (BG-01M7FA80)', () => {
  it('BG-01M7FA80 AC1 a changed Rust compute source without a rebuild fails by name', () => {
    const { files } = walkCrateSources();
    const current = currentSourceDigests(readCrateSources(files));
    const recorded = readRecordedSourceDigests(new URL(SOURCE_DIGEST_SIDECAR, REPO_ROOT));

    // The engine beside the record was built from the sources this checkout holds.
    const differ = differingSources(recorded.digests, current);
    expect(differ, staleMessage(differ)).toEqual([]);

    // And this is the failure a changed compute source gets: the file named, and the rebuild to
    // run. The scorer's own weight - the mutation (`on_target += 14` to `+= 9`) that left 7 tests
    // green for BG-01M7EKMJ's reviewer - is one line of one of these files, so changing it changes
    // that file's digest and nothing else can absorb it.
    const scorer = 'crates/molbiocraft-cloning/src/cloning_crispr.rs';
    expect(current.has(scorer), `${scorer} is not among the ${files.length} digested sources`).toBe(true);
    expect(readCrateSources([scorer]).get(scorer)).toContain('on_target += 14;');
    const mutated = new Map(current).set(
      scorer,
      digestOf((readCrateSources([scorer]).get(scorer) ?? '').replace('on_target += 14;', 'on_target += 9;'))
    );
    const named = differingSources(recorded.digests, mutated);
    expect(named).toEqual([`${scorer} (changed since the engine was built)`]);
    expect(staleMessage(named)).toContain(scorer);
    expect(staleMessage(named)).toContain(REBUILD);
  });

  it('BG-01M7FA80 AC2 the digested source set is discovered by walking crates', () => {
    const { files, crates } = walkCrateSources();
    const recorded = readRecordedSourceDigests(new URL(SOURCE_DIGEST_SIDECAR, REPO_ROOT));

    // A walk that matched nothing would make the digest a constant and the guard vacuous.
    expect(crates.length, 'the walk found no crate under crates/').toBeGreaterThan(0);
    expect(files.length, 'the walk found no .rs source: the digest would be a constant').toBeGreaterThan(0);

    // Every crate the tree holds contributes, so an enumeration that named four of seven
    // (BG-01M7FC2X) cannot pass: the crates are the walk's, not a list written here.
    for (const crate of crates) {
      const ofCrate = files.filter((file) => file.startsWith(`crates/${crate}/src/`));
      expect(ofCrate.length, `no source of crates/${crate} is digested`).toBeGreaterThan(0);
    }
    // The walk is a walk, shown on a tree built here, because this checkout happens to keep every
    // crate's sources flat (its one directory below a `src` holds .pdb fixtures) - so the real tree
    // cannot tell a recursive walk from a single readdir, and a crate added tomorrow with its
    // modules in directories would be digested by one and missed by the other.
    const tree = nodeFs.mkdtempSync(`${tmpdir()}/BG01M7FA80-walk-`);
    try {
      for (const [file, text] of [
        ['crates/new-crate/Cargo.toml', '[package]\nname = "new-crate"\n'],
        ['crates/new-crate/src/lib.rs', 'pub mod deep;\n'],
        ['crates/new-crate/src/deep/mod.rs', 'pub mod deeper;\n'],
        ['crates/new-crate/src/deep/deeper/compute.rs', 'pub fn rank() -> i32 { 68 }\n'],
        ['crates/new-crate/src/notes.md', 'not a source\n'],
        ['crates/new-crate/tests/integration.rs', '#[test] fn t() {}\n'],
        ['crates/not-a-crate/src/lib.rs', 'pub fn stray() {}\n'],
      ] as const) {
        nodeFs.mkdirSync(`${tree}/${file.slice(0, file.lastIndexOf('/'))}`, { recursive: true });
        nodeFs.writeFileSync(`${tree}/${file}`, text, 'utf8');
      }
      const walked = walkCrateSources(pathToFileURL(`${tree}/`));
      expect(walked.crates, 'a directory with no Cargo.toml is not a crate').toEqual(['new-crate']);
      expect(walked.files, 'the walk digests every .rs below a crate\'s src/, and only those').toEqual([
        'crates/new-crate/src/deep/deeper/compute.rs',
        'crates/new-crate/src/deep/mod.rs',
        'crates/new-crate/src/lib.rs',
      ]);
    } finally {
      nodeFs.rmSync(tree, { recursive: true, force: true });
    }

    // The crates the rank is computed in, found in what the walk read rather than named one by one.
    const sources = readCrateSources(files);
    for (const symbol of ['CRISPR_HEURISTIC_RANK_RANGE', 'crispr_heuristic_rank_description', 'on_target +=']) {
      const holders = [...sources].filter(([, text]) => text.includes(symbol)).map(([file]) => file);
      expect(holders.length, `no digested source names ${symbol}`).toBeGreaterThan(0);
      for (const file of holders) {
        expect(recorded.digests.has(file), `${file} names ${symbol} but is not in ${SOURCE_DIGEST_SIDECAR}`).toBe(true);
      }
    }

    // And the record covers exactly the walk - neither side may be a hand-written list.
    expect([...recorded.digests.keys()].sort()).toEqual(files);
  });

  it('BG-01M7FA80 AC3 a clean tree passes and an unreadable digest refuses by name', () => {
    // Silent on a clean tree, and it reports the digest it matched.
    const recorded = readRecordedSourceDigests(new URL(SOURCE_DIGEST_SIDECAR, REPO_ROOT));
    const { files } = walkCrateSources();
    const current = currentSourceDigests(readCrateSources(files));
    expect(recorded.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOfAll(current)).toBe(recorded.digest);
    console.info(
      `BG-01M7FA80: public/molbiocraft_wasm.wasm matches sha256 ${recorded.digest} over ${recorded.digests.size} Rust sources`
    );

    // And it refuses, by name, rather than agreeing when it cannot tell.
    const dir = nodeFs.mkdtempSync(`${tmpdir()}/BG01M7FA80-provenance-`);
    try {
      const cases: Array<{ as: string; file: string; text: string | null; names: RegExp }> = [
        { as: 'missing', file: 'absent.sha256', text: null, names: /are missing: / },
        { as: 'empty', file: 'empty.sha256', text: '', names: /are empty: / },
        { as: 'whitespace only', file: 'blank.sha256', text: '\n  \n\n', names: /are empty: / },
        {
          as: 'unparseable',
          file: 'garbled.sha256',
          text: '# a header\nnot-a-digest crates/molbiocraft-core/src/lib.rs\n',
          names: /are unparseable: .* line 2 is not /,
        },
        { as: 'entry-less', file: 'comments.sha256', text: '# a header and nothing else\n', names: /records no source at all/ },
      ];
      for (const { as, file, text, names } of cases) {
        const path = `${dir}/${file}`;
        if (text !== null) nodeFs.writeFileSync(path, text, 'utf8');
        let thrown: unknown;
        try {
          readRecordedSourceDigests(pathToFileURL(path), file);
        } catch (cause) {
          thrown = cause;
        }
        const message = thrown instanceof Error ? thrown.message : `nothing was thrown: ${String(thrown)}`;
        // Named as what it is, never defaulted into agreement, and it says how to fix it.
        expect(message, `a ${as} record must refuse by name`).toMatch(names);
        expect(message, `a ${as} record must not read as agreement`).toContain(REBUILD);
        expect(message, `a ${as} record must not be answered with a default`).not.toMatch(/nothing was thrown/);
      }
    } finally {
      nodeFs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the declared rank range comes from one unambiguous declaration (BG-01M7FAQZ)', () => {
  /** A Rust source to read instead of the checkout's own, so no case here can touch the real file. */
  const asSource = (text: string, read: (at: URL, path: string) => void) => {
    const dir = nodeFs.mkdtempSync(`${tmpdir()}/BG01M7FAQZ-rank-range-`);
    try {
      const path = `${dir}/cloning_crispr.rs`;
      nodeFs.writeFileSync(path, text, 'utf8');
      read(pathToFileURL(path), path);
    } finally {
      nodeFs.rmSync(dir, { recursive: true, force: true });
    }
  };

  /** What `declaredRankRange` answered, and with what - either arm, never both. */
  const answerFor = (at: URL): { got?: [number, number]; message: string } => {
    try {
      return { got: declaredRankRange(at), message: '' };
    } catch (cause) {
      return { message: cause instanceof Error ? cause.message : `a non-Error was thrown: ${String(cause)}` };
    }
  };

  it('BG-01M7FAQZ AC1 an ambiguous rank-range declaration is refused by name', () => {
    // Two spellings, both at the start of a line - the first inside a block comment, which a
    // line-anchored pattern cannot tell from code. A reader that takes the first match answers with
    // the stale pair, which is what would let BG-01M7EKMJ AC1 agree with a comment rather than with
    // the constant the committed wasm was built from.
    asSource(
      [
        '//! The CRISPR scorer.',
        '',
        '/* The range this scorer used to report, kept for the changelog:',
        'pub const CRISPR_HEURISTIC_RANK_RANGE: (i32, i32) = (0, 100);',
        '*/',
        'pub const CRISPR_HEURISTIC_RANK_RANGE: (i32, i32) = (8, 98);',
        '',
        'pub fn rank() -> i32 { 68 }',
        '',
      ].join('\n'),
      (at, path) => {
        const { got, message } = answerFor(at);
        // It refuses, rather than answering with either pair.
        expect(got, `an ambiguous source must be refused, not answered with ${JSON.stringify(got)}`).toBeUndefined();
        expect(message, 'the refusal names the file it could not read').toContain(path);
        expect(message, 'the refusal says how many declarations it found').toMatch(/\b2\b/);
        expect(message, 'the refusal is an Error, not a stringified something else').not.toMatch(/non-Error/);
      }
    );
  });

  it('BG-01M7FAQZ AC2 a declaration spelled inside a comment is not a candidate', () => {
    // A `///` line is not the start of a declaration, so the old pair written there is not one of
    // the candidates: the helper answers with the constant's own numbers and does not refuse.
    const commented: [number, number] = [8, 98];
    const declared: [number, number] = [12, 91];
    expect(
      declared,
      "the fixture's own constant must hold a different pair from its comment, or either answer passes"
    ).not.toEqual(commented);
    asSource(
      [
        '//! The CRISPR scorer.',
        '',
        `/// The range was once \`pub const CRISPR_HEURISTIC_RANK_RANGE: (i32, i32) = (${commented.join(', ')});\`.`,
        `pub const CRISPR_HEURISTIC_RANK_RANGE: (i32, i32) = (${declared.join(', ')});`,
        '',
      ].join('\n'),
      (at) => {
        const { got, message } = answerFor(at);
        expect(
          got,
          `the commented line is not a declaration, so this source is not ambiguous: ${message}`
        ).toEqual(declared);
      }
    );

    // The other direction: anchoring to the start of the file instead of the start of a line finds
    // nothing in the real source, whose declaration is a few hundred lines down - a refusal that
    // reads as "no declaration" on a correct tree. So the real file must answer, with the numbers
    // its own declaration line carries, found here by reading lines rather than by this helper's
    // pattern.
    const path = decodeURIComponent(RUST_RANK_RANGE_SOURCE.pathname);
    const onItsOwnLine = readFileSync(RUST_RANK_RANGE_SOURCE, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('pub const CRISPR_HEURISTIC_RANK_RANGE'));
    expect(onItsOwnLine.length, `${path} declares the rank range once`).toBe(1);
    const pair = /\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*;/.exec(onItsOwnLine[0].split('=')[1]);
    expect(pair, `the declaration states a pair: ${onItsOwnLine[0]}`).not.toBeNull();
    const { got, message } = answerFor(RUST_RANK_RANGE_SOURCE);
    expect(got, `the real source declares a rank range this helper must find: ${message}`).toEqual([
      Number(pair![1]),
      Number(pair![2]),
    ]);
  });
});
