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
 * - a rank described as three spacer features over 0-100 when the scorer reads five features of
 *   the spacer and one of its PAM, six in all (weighed in seven adjustment arms over the spacer
 *   and an eighth for the PAM), and
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
import { engineInputs, sourceDigestManifest } from '../../scripts/build_rust_wasm.mjs';
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
const { pathToFileURL, fileURLToPath } = (await import(/* @vite-ignore */ nodeUrlSpec)) as {
  pathToFileURL: (path: string) => URL;
  fileURLToPath: (url: URL) => string;
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

/** What every failure here asks for: the one command that rebuilds the engine and rewrites its record together. */
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
 * Every input the engine is built from, discovered by walking the tree at test time - so a file
 * added tomorrow is covered the day it is added, and no list is maintained anywhere. This is the
 * build's own walk (`engineInputs` in `scripts/build_rust_wasm.mjs`), not a second one written
 * here: two walkers over one tree can disagree about what counts as an input, and the record and
 * its check would then each be right about a different set (BG-01M7FGTR).
 */
const walkEngineInputs = (root: URL = REPO_ROOT): { files: string[]; crates: string[] } =>
  engineInputs(fileURLToPath(root));

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
  `public/molbiocraft_wasm.wasm was built from inputs this checkout no longer holds, so every ` +
  `number this suite reads from the engine is the old code's. ${differ.length} file(s) differ:\n  ` +
  `${differ.join('\n  ')}\nRun \`${REBUILD}\` and commit the rebuilt engine with the change.`;

describe('the committed engine carries the sources it was built from (BG-01M7FA80)', () => {
  it('BG-01M7FA80 AC1 a changed Rust compute source without a rebuild fails by name', () => {
    const { files } = walkEngineInputs();
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
    const { files, crates } = walkEngineInputs();
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
    // crate's Rust flat (its one directory below a `src` holds the two .pdb files
    // `sample_structures.rs` embeds in the engine, and no `.rs`) - so the real tree
    // cannot tell a recursive walk from a single readdir, and a crate added tomorrow with its
    // modules in directories would be digested by one and missed by the other.
    const tree = nodeFs.mkdtempSync(`${tmpdir()}/BG01M7FA80-walk-`);
    try {
      for (const [file, text] of [
        ['Cargo.toml', '[workspace]\nmembers = ["crates/new-crate"]\n'],
        ['Cargo.lock', 'version = 4\n'],
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
      const walked = walkEngineInputs(pathToFileURL(`${tree}/`));
      expect(walked.crates, 'a directory with no Cargo.toml is not a crate').toEqual(['new-crate']);
      expect(walked.files, 'the walk digests every .rs below a crate\'s src/ and the manifests, and only those').toEqual([
        'Cargo.lock',
        'Cargo.toml',
        'crates/new-crate/Cargo.toml',
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
    const { files } = walkEngineInputs();
    const current = currentSourceDigests(readCrateSources(files));
    expect(recorded.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOfAll(current)).toBe(recorded.digest);
    console.info(
      `BG-01M7FA80: public/molbiocraft_wasm.wasm matches sha256 ${recorded.digest} over ${recorded.digests.size} engine inputs`
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

describe('the record covers every input the engine is built from (BG-01M7FGTR)', () => {
  /** A throwaway checkout holding `files`, handed to `use`, then removed whatever `use` did. */
  const onTree = (prefix: string, files: ReadonlyArray<readonly [string, string]>, use: (tree: string) => void) => {
    const tree = nodeFs.mkdtempSync(`${tmpdir()}/${prefix}-`);
    try {
      for (const [file, text] of files) {
        if (file.includes('/')) nodeFs.mkdirSync(`${tree}/${file.slice(0, file.lastIndexOf('/'))}`, { recursive: true });
        nodeFs.writeFileSync(`${tree}/${file}`, text, 'utf8');
      }
      use(tree);
    } finally {
      nodeFs.rmSync(tree, { recursive: true, force: true });
    }
  };
  const WORKSPACE: ReadonlyArray<readonly [string, string]> = [
    ['Cargo.toml', '[workspace]\nmembers = ["crates/c"]\n'],
    ['Cargo.lock', 'version = 4\n'],
    ['crates/c/Cargo.toml', '[package]\nname = "c"\n'],
  ];
  const SAMPLE_STRUCTURES = 'crates/molbiocraft-cloning/src/sample_structures/';

  it('BG-01M7FGTR AC1 the record holds every .pdb the engine embeds and the workspace manifests', () => {
    const { files, crates } = walkEngineInputs();
    const recorded = readRecordedSourceDigests(new URL(SOURCE_DIGEST_SIDECAR, REPO_ROOT));

    // Each .pdb the directory holds, found by listing it rather than named here.
    const pdbs = nodeFs
      .readdirSync(new URL(SAMPLE_STRUCTURES, REPO_ROOT), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.pdb'))
      .map((entry) => `${SAMPLE_STRUCTURES}${entry.name}`);
    expect(pdbs.length, `${SAMPLE_STRUCTURES} holds no .pdb, so this case proves nothing`).toBeGreaterThan(0);
    const manifests = ['Cargo.toml', 'Cargo.lock', ...crates.map((crate) => `crates/${crate}/Cargo.toml`)];
    for (const input of [...pdbs, ...manifests]) {
      expect(files, `the walk does not find ${input}`).toContain(input);
      expect(recorded.digests.has(input), `${input} is not in ${SOURCE_DIGEST_SIDECAR}`).toBe(true);
    }

    // What does not build the engine is not recorded as if it did: src-tauri is excluded from the
    // workspace and resolves its own lockfile, and a file only a #[cfg(test)] module includes is
    // compiled into the test harness, never into the cdylib.
    expect(files).not.toContain('src-tauri/Cargo.toml');
    expect(files).not.toContain('src-tauri/Cargo.lock');
    const testOnly = 'crates/molbiocraft-cloning/src/workbench_table_and_lineage.rs';
    expect(readCrateSources([testOnly]).get(testOnly), `${testOnly} no longer includes src/types/bio.ts in its tests`).toContain(
      'include_str!("../../../src/types/bio.ts")'
    );
    expect(files).not.toContain('src/types/bio.ts');

    // And the committed record is exactly what the build writes for this tree, byte for byte - the
    // text `node scripts/build_rust_wasm.mjs --sources-only` and `npm run wasm:build` both write.
    expect(nodeFs.readFileSync(new URL(SOURCE_DIGEST_SIDECAR, REPO_ROOT), 'utf8')).toBe(
      sourceDigestManifest(fileURLToPath(REPO_ROOT))
    );
  });

  it('BG-01M7FGTR AC1 an included file is discovered from the code that includes it', () => {
    const lib = [
      '//! include_str!("nope-doc.txt") in a doc comment is no site',
      'pub const A: &str = include_str!("data/a.txt");',
      'pub const B: &[u8] = include_bytes!("../assets/b.bin");',
      'const NOT: &str = "include_str!(\\"nope-string.txt\\")";',
      "const BRACE: char = '{';",
      'const RAW: &str = r#"} "quoted" }"#;',
      "fn f<'a>(x: &'a str) -> &'a str { x }",
      'include!("gen/c.in");',
      '#[cfg(test)]',
      'mod tests {',
      '    // Each line here holds a brace a reader of the code must not count, then a site it must',
      '    // not record, so a lexer that miscounts any one of them ends this module too early.',
      '    #[test] fn t() { let _ = "}"; }',
      '    const T1: &str = include_str!("nope-test.txt");',
      "    const CLOSE: char = '}';",
      '    const T2: &str = include_str!("nope-test.txt");',
      '    const RAW_CLOSE: &str = r#"x "}" y"#;',
      '    const T3: &str = include_str!("nope-test.txt");',
      '    /* } nested /* } */ } */',
      '    const T4: &str = include_str!("nope-test.txt");',
      '}',
      'pub const AFTER: &str = include_str!("data/after.txt");',
      '',
    ].join('\n');
    onTree(
      'BG01M7FGTR-include',
      [
        ...WORKSPACE,
        ['crates/c/src/lib.rs', lib],
        ['crates/c/src/data/a.txt', 'a\n'],
        ['crates/c/src/data/after.txt', 'after\n'],
        ['crates/c/assets/b.bin', 'b\n'],
        ['crates/c/src/gen/c.in', 'pub const D: &str = include_str!("d.txt");\n'],
        ['crates/c/src/gen/d.txt', 'd\n'],
        ['crates/c/src/nope-doc.txt', 'x\n'],
        ['crates/c/src/nope-string.txt', 'x\n'],
        ['crates/c/src/nope-test.txt', 'x\n'],
      ],
      (tree) => {
        const walked = walkEngineInputs(pathToFileURL(`${tree}/`));
        expect(walked.files, 'every file the code includes, outside its tests, and nothing a comment or a string names').toEqual([
          'Cargo.lock',
          'Cargo.toml',
          'crates/c/Cargo.toml',
          'crates/c/assets/b.bin',
          'crates/c/src/data/a.txt',
          'crates/c/src/data/after.txt',
          'crates/c/src/gen/c.in',
          'crates/c/src/gen/d.txt',
          'crates/c/src/lib.rs',
        ]);
        // The record is written from the same walk: one line per input, nothing else.
        const recorded = sourceDigestManifest(tree)
          .split('\n')
          .filter((line) => line !== '' && !line.startsWith('#'))
          .map((line) => line.slice(66));
        expect(recorded).toEqual(walked.files);
      }
    );
  });

  it('BG-01M7FGTR AC1 an input the walk cannot follow is refused by name, not left out', () => {
    const cases: Array<{ as: string; files: ReadonlyArray<readonly [string, string]>; names: RegExp }> = [
      {
        as: 'a missing Cargo.lock',
        files: [WORKSPACE[0], WORKSPACE[2], ['crates/c/src/lib.rs', 'pub fn f() {}\n']],
        names: /the workspace Cargo\.lock is missing/,
      },
      {
        as: 'an include of a file not in the tree',
        files: [...WORKSPACE, ['crates/c/src/lib.rs', 'const G: &str = include_str!("gone.txt");\n']],
        names: /crates\/c\/src\/lib\.rs:1: include_str!\("gone\.txt"\) reads crates\/c\/src\/gone\.txt, which is not a file/,
      },
      {
        as: 'an include whose path is not one literal',
        files: [...WORKSPACE, ['crates/c/src/lib.rs', 'const G: &str = include_str!(concat!(env!("OUT_DIR"), "/g.txt"));\n']],
        names: /crates\/c\/src\/lib\.rs:1: include_str! takes something other than one plain string literal/,
      },
      {
        as: 'an include from outside the checkout',
        files: [...WORKSPACE, ['crates/c/src/lib.rs', 'const G: &[u8] = include_bytes!("../../../../g.bin");\n']],
        names: /crates\/c\/src\/lib\.rs:1: include_bytes!\("\.\.\/\.\.\/\.\.\/\.\.\/g\.bin"\) reads .* outside this checkout/,
      },
      {
        as: 'a test module that never closes',
        files: [...WORKSPACE, ['crates/c/src/lib.rs', 'pub fn f() {}\n#[cfg(test)]\nmod tests {\n    fn t() {}\n']],
        names: /crates\/c\/src\/lib\.rs:2: the #\[cfg\(test\)\] module opened here never closes/,
      },
    ];
    for (const { as, files, names } of cases) {
      onTree('BG01M7FGTR-refuse', files, (tree) => {
        let message = 'nothing was thrown';
        try {
          const walked = walkEngineInputs(pathToFileURL(`${tree}/`));
          message = `nothing was thrown; the walk answered ${JSON.stringify(walked.files)}`;
        } catch (cause) {
          message = cause instanceof Error ? cause.message : String(cause);
        }
        expect(message, `${as} must be refused by name`).toMatch(names);
      });
    }
  });

  it('BG-01M7FGTR AC2 an edited .pdb or lockfile fails the guard and names that file', () => {
    const { files } = walkEngineInputs();
    const recorded = readRecordedSourceDigests(new URL(SOURCE_DIGEST_SIDECAR, REPO_ROOT));
    const current = currentSourceDigests(readCrateSources(files));
    expect(differingSources(recorded.digests, current), 'the tree is not clean to begin with').toEqual([]);
    const pdb = files.find((file) => file.startsWith(SAMPLE_STRUCTURES) && file.endsWith('.pdb'));
    expect(pdb, `no .pdb under ${SAMPLE_STRUCTURES} is walked`).toBeDefined();
    for (const input of [pdb!, 'Cargo.lock']) {
      const edited = new Map(current).set(input, digestOf(`${readCrateSources([input]).get(input)}\nREMARK verify\n`));
      const named = differingSources(recorded.digests, edited);
      expect(named).toEqual([`${input} (changed since the engine was built)`]);
      expect(staleMessage(named)).toContain(input.slice(input.lastIndexOf('/') + 1));
    }
  });
});

describe('a red guard asks for a rebuild, and the record-only flag says it rebuilds nothing (BG-01M7FGPW)', () => {
  const SCRIPT = 'scripts/build_rust_wasm.mjs';
  const nodeChildProcessSpec = 'node:child_process';

  it('BG-01M7FGPW AC1 the stale-engine message names one action: rebuild and commit', () => {
    const message = staleMessage(['crates/c/src/lib.rs (changed since the engine was built)']);
    expect(message).toContain(`Run \`${REBUILD}\``);
    expect(message).toMatch(/commit/i);
    // The record-only flag rewrites the record without building, so offering it to a reader of a
    // red suite silences the guard over the very engine it says is stale.
    expect(message).not.toContain('--sources-only');
    expect(message).not.toMatch(/cannot alter codegen/i);
  });

  it('BG-01M7FGPW AC2 AC3 --sources-only says it rebuilt nothing, writes the record, and leaves the engine alone', async () => {
    const { execFileSync } = (await import(/* @vite-ignore */ nodeChildProcessSpec)) as {
      execFileSync: (file: string, args: string[], options: { encoding: 'utf8'; cwd: string }) => string;
    };
    const tree = nodeFs.mkdtempSync(`${tmpdir()}/BG01M7FGPW-flag-`);
    try {
      const engine = 'stale engine bytes\n';
      for (const [file, text] of [
        ['Cargo.toml', '[workspace]\nmembers = ["crates/c"]\n'],
        ['Cargo.lock', 'version = 4\n'],
        ['crates/c/Cargo.toml', '[package]\nname = "c"\n'],
        ['crates/c/src/lib.rs', 'pub fn f() -> u8 { 1 }\n'],
        ['public/molbiocraft_wasm.wasm', engine],
        [SCRIPT, nodeFs.readFileSync(new URL(SCRIPT, REPO_ROOT), 'utf8')],
      ] as const) {
        nodeFs.mkdirSync(`${tree}/${file.slice(0, file.lastIndexOf('/') + 1) || '.'}`, { recursive: true });
        nodeFs.writeFileSync(`${tree}/${file}`, text, 'utf8');
      }
      // The shipped entry point, run the way CI runs it, on a tree that holds no target/ and no
      // toolchain: a run that tried to build would fail here rather than pass.
      const out = execFileSync(process.execPath, [`${tree}/${SCRIPT}`, '--sources-only'], { encoding: 'utf8', cwd: tree });
      expect(out).toMatch(/Recorded 4 engine inputs/);
      expect(out).toMatch(/without rebuilding the engine/i);
      expect(out).toMatch(/CI staleness check/i);
      expect(out).toContain(REBUILD);

      // The flag still does its job for CI: the record is the build's, byte for byte.
      const treeUrl = pathToFileURL(`${tree}/`);
      expect(nodeFs.readFileSync(new URL(SOURCE_DIGEST_SIDECAR, treeUrl), 'utf8')).toBe(sourceDigestManifest(tree));
      // And it built nothing: the engine is the bytes it found.
      expect(nodeFs.readFileSync(new URL('public/molbiocraft_wasm.wasm', treeUrl), 'utf8')).toBe(engine);
    } finally {
      nodeFs.rmSync(tree, { recursive: true, force: true });
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

// ───────────────────────────────────────────────────────────────────────────────────────────────
// BG-01M7FC2X: wherever the tree states how many things the rank reads, it says what they are.
// ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How a count may be spelled, and the fragments every pattern below is assembled from.
 *
 * No line of this file writes a count next to a noun the sweep reads, because the sweep reads this
 * file: it walks every Rust and TypeScript source under `crates/` and `src/`, and
 * `src/__tests__/crisprScoreProvenance.test.tsx` is one of them. A pattern, a fixture or a plant
 * spelled out here would be a statement in a swept file, and a wrong one would make the sweep red
 * on its own source for ever. So every count a pattern or a fixture needs is joined to its noun at
 * run time - by the regex engine from `COUNT`, or by `saying()` - and the only counts written out
 * in prose here are the correct ones, which the sweep holds to the rule like any other site.
 */
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'] as const;
const COUNT = `(?:${COUNT_WORDS.join('|')}|\\d+)`;
/** The nouns that say what is counted - a property of the guide, or an arm of the scorer. */
const COUNT_NOUN = '(?:features?|propert(?:y|ies)|arms?|adjustments?)';
/** Words that may sit between a count and its noun without being one. */
const COUNT_MODIFIER = '(?:(?:adjustment|adjustments|scored|scoring|distinct)\\s+){0,2}';
/** A count spelled, then whatever it counts - so no forbidden phrase is a literal in this file. */
const saying = (n: number, rest: string) => `${COUNT_WORDS[n]} ${rest}`;
const countValue = (token: string) =>
  COUNT_WORDS.indexOf(token as (typeof COUNT_WORDS)[number]) >= 0
    ? COUNT_WORDS.indexOf(token as (typeof COUNT_WORDS)[number])
    : Number(token);
/** The first count in a matched phrase: the number that phrase states. */
const countIn = (phrase: string) => countValue(new RegExp(`\\b(${COUNT})\\b`).exec(phrase)![1]);

type CountSide = 'spacer' | 'pam' | 'total';
type CountClass = 'features' | 'arms';
type RankCounts = Record<CountClass, Record<CountSide, number>>;

const OF_SIDE: Record<CountSide, string> = {
  spacer: 'of the spacer',
  pam: 'of its PAM',
  total: 'in all',
};

/**
 * How many things the rank reads, and in how many arms, *derived* from the engine's own one
 * statement of the rule - never written here (BG01M7F18J AC2 derives the same numbers in Rust, and
 * this is the same derivation on the shipped WASM string the app reads).
 *
 * Each `raised`/`lowered` is an adjustment; a subject named with no direction of its own inherits
 * the one before it, and a direction with no subject after it belongs to the subject before it. The
 * distinct subjects are the features. A clause this cannot classify fails loudly rather than being
 * counted as nothing (LC-006): a silent undercount is the defect BG01M7F18J existed to kill.
 */
function deriveRankCounts(description: string): RankCounts & { enumeration: string } {
  const OPENS = 'a rule of thumb over the spacer and its PAM: ';
  const CLOSES = ', then held to';
  const from = description.indexOf(OPENS);
  if (from < 0) {
    throw new Error(`the rule's one statement no longer opens its enumeration with "${OPENS}": ${description}`);
  }
  const tail = description.slice(from + OPENS.length);
  const to = tail.indexOf(CLOSES);
  if (to < 0) {
    throw new Error(`the rule's one statement no longer closes its enumeration with "${CLOSES}": ${description}`);
  }
  const enumeration = tail.slice(0, to);
  const words = enumeration
    .split(/\s+/)
    .map((w) => w.replace(/^[,.;:()]+|[,.;:()]+$/g, ''))
    .filter((w) => w !== '');
  const isCount = (w: string) => /^\d+$/.test(w);
  const isBases = (w: string) => /^[ACGT]+$/.test(w);
  const isSpan = (w: string) => /^\d+[-–]\d+$/.test(w);
  // Connectives, directions and the base letters a clause names as a value: vocabulary that
  // introduces no property of its own. Anything outside it is an unclassified subject.
  const CONNECTIVES = [
    'from', 'of', 'raised', 'lowered', 'for', 'and', 'a', 'an', 'at', 'or', 'inside', 'outside',
    'spacer', 'then', 'the', 'its',
  ];
  const subjects: Record<'spacer' | 'pam', Set<string>> = { spacer: new Set(), pam: new Set() };
  const arms: Record<'spacer' | 'pam', number> = { spacer: 0, pam: 0 };
  let pending = 0;
  let lastSide: 'spacer' | 'pam' | null = null;
  const attribute = (side: 'spacer' | 'pam') => {
    arms[side] += pending > 0 ? pending : 1;
    pending = 0;
    lastSide = side;
  };
  for (let i = 0; i < words.length; ) {
    const w = words[i];
    if (w === 'base' && words[i + 1] === 'of' && isCount(words[i + 2] ?? '')) {
      i += 3; // the base the adjustments move, not one of them
    } else if (w === 'GC' && words[i + 1] === 'content') {
      subjects.spacer.add('GC content');
      attribute('spacer');
      i += 2;
    } else if (isSpan(w) && words[i + 1] === '%') {
      // A bound on a composition already named, not a property of its own.
      if (!subjects.spacer.has('GC content')) {
        throw new Error(`the rule bounds a percentage (${w} %) before saying what it is of: ${enumeration}`);
      }
      i += 2;
    } else if (w === 'position' && isCount(words[i + 1] ?? '')) {
      const side = words[i - 1] === 'PAM' ? 'pam' : 'spacer';
      subjects[side].add(`position ${words[i + 1]}`);
      attribute(side);
      i += 2;
    } else if (isBases(w) && w.length > 1 && words[i + 1] === 'run') {
      subjects.spacer.add(`${w} run`);
      attribute('spacer');
      i += 2;
    } else if (w === 'PAM' && words[i + 1] === 'ending' && isBases(words[i + 2] ?? '')) {
      subjects.pam.add(`PAM ending ${words[i + 2]}`);
      attribute('pam');
      i += 3;
    } else if (CONNECTIVES.includes(w) || (isBases(w) && w.length === 1)) {
      if (w === 'raised' || w === 'lowered') pending += 1;
      i += 1;
    } else {
      throw new Error(
        `the rule names a property this derivation cannot classify, at "${w}" in "${enumeration}": teach it the new property instead of letting it count the rank's features short`
      );
    }
  }
  // A direction with no subject after it belongs to the subject before it.
  if (pending > 0) {
    if (lastSide === null) throw new Error(`the rule states adjustments with no subject at all: ${enumeration}`);
    arms[lastSide as 'spacer' | 'pam'] += pending;
  }
  if (subjects.spacer.size === 0 || subjects.pam.size === 0) {
    throw new Error(
      `the rule names ${subjects.spacer.size} properties of the spacer and ${subjects.pam.size} of its PAM, so one of the two was read as nothing: ${enumeration}`
    );
  }
  return {
    features: {
      spacer: subjects.spacer.size,
      pam: subjects.pam.size,
      total: subjects.spacer.size + subjects.pam.size,
    },
    arms: { spacer: arms.spacer, pam: arms.pam, total: arms.spacer + arms.pam },
    enumeration,
  };
}

/**
 * A statement of a count of the rank, in the shapes this tree has written one in.
 *
 * `selfMarking` shapes name the spacer, the PAM or the scorer themselves, so they are read in any
 * sentence of any swept file - which is what makes a count planted in a file nobody listed fail.
 * The weaker shapes ("its N arms") are read only in a sentence that also names the rank, because
 * the word "arms" belongs to other things in this tree (a scan's two arms, a floor and a ceiling).
 */
type CountShape = { side: CountSide; selfMarking: boolean; re: string };
const NAMED_COUNT_SHAPES: CountShape[] = [
  { side: 'spacer', selfMarking: true, re: `${COUNT}\\s+${COUNT_MODIFIER}(${COUNT_NOUN})\\s+of the spacer\\b` },
  { side: 'pam', selfMarking: true, re: `${COUNT}\\s+${COUNT_MODIFIER}(${COUNT_NOUN})\\s+of its pam\\b` },
  { side: 'spacer', selfMarking: true, re: `${COUNT}\\s+${COUNT_MODIFIER}(${COUNT_NOUN})\\s+over the spacer\\b` },
  { side: 'spacer', selfMarking: true, re: `${COUNT}\\s+${COUNT_MODIFIER}(${COUNT_NOUN})\\s+and (?:a|its|the) pam\\b` },
  { side: 'total', selfMarking: true, re: `${COUNT}\\s+${COUNT_MODIFIER}(${COUNT_NOUN})\\s+the (?:scorer|rank) reads\\b` },
  { side: 'total', selfMarking: false, re: `${COUNT}\\s+${COUNT_MODIFIER}(${COUNT_NOUN})\\s+of it\\b` },
  { side: 'total', selfMarking: false, re: `(?:its|the rank's|the scorer's)\\s+${COUNT}\\s+${COUNT_MODIFIER}(${COUNT_NOUN})` },
];
/**
 * A count of the rank stated with no noun between the number and what it is a count over. These are
 * read only in a sentence that names the rank, because "N of its PAM" is also how a single *base*
 * of a guide is spoken of (`LinearSequenceView.tsx`), and "more than 12,000 in all" is a count of
 * something else entirely.
 */
const BARE_COUNT_SHAPES: CountShape[] = [
  { side: 'spacer', selfMarking: true, re: `${COUNT}\\s+of the spacer\\b(?!'s)` },
  { side: 'pam', selfMarking: true, re: `${COUNT}\\s+of its pam\\b` },
  { side: 'spacer', selfMarking: true, re: `${COUNT}\\s+and (?:a|its|the) pam\\b` },
  { side: 'spacer', selfMarking: true, re: `${COUNT}\\s+over the spacer\\b` },
  { side: 'total', selfMarking: false, re: `(?<![\\d,])${COUNT}\\s+in all\\b` },
];
/** The words by which a sentence says it is speaking of this rank. */
const RANK_MARKER = /\branks?\b|\bscorer\b|score_guide|on_target/;
/** `arms` and `adjustments` count the scorer's arms; everything else counts the guide's features. */
const classOfNoun = (noun: string): CountClass => (/^(?:arms?|adjustments?)$/.test(noun) ? 'arms' : 'features');

type CountFinding = { file: string; phrase: string; why: string };

/** Comment markers and line wrapping gone, so a count split over two lines is still one phrase. */
const asProse = (text: string) => text.toLowerCase().replace(/[/*]/g, ' ').replace(/\s+/g, ' ');

/**
 * Every statement of a count of the rank the swept sources make that the rule does not bear out.
 *
 * The sites are discovered, never listed: the input is whatever the walk read. Each sentence is
 * read on its own, so the noun that says what is counted has to be in the statement itself.
 */
function sweepRankCounts(sources: Map<string, string>, derived: RankCounts): CountFinding[] {
  const findings: CountFinding[] = [];
  for (const [file, text] of sources) {
    for (const sentence of asProse(text).split(/[.;]/)) {
      const marked = RANK_MARKER.test(sentence);
      const named: Array<{ at: number; length: number; cls: CountClass }> = [];
      for (const shape of NAMED_COUNT_SHAPES) {
        if (!shape.selfMarking && !marked) continue;
        for (const m of sentence.matchAll(new RegExp(shape.re, 'g'))) {
          const phrase = m[0].trim();
          const cls = classOfNoun(m[1]);
          named.push({ at: m.index, length: m[0].length, cls });
          const expected = derived[cls][shape.side];
          if (countIn(phrase) !== expected) {
            findings.push({
              file,
              phrase,
              why: `says ${countIn(phrase)} where the rule's own enumeration gives ${expected} ${cls} ${OF_SIDE[shape.side]}`,
            });
          }
        }
      }
      named.sort((a, b) => a.at - b.at);
      for (const shape of BARE_COUNT_SHAPES) {
        if (!marked) continue;
        for (const m of sentence.matchAll(new RegExp(shape.re, 'g'))) {
          const phrase = m[0].trim();
          // A bare count inside a statement that does name its noun is that statement, not a
          // second one ("five features of the spacer" holds "of the spacer" inside it).
          if (named.some((n) => n.at <= m.index && m.index < n.at + n.length)) continue;
          const governing = named.filter((n) => n.at < m.index).pop() ?? named[0];
          if (governing === undefined) {
            findings.push({
              file,
              phrase,
              why: `states a count with no noun: nothing in the sentence says what the ${countIn(phrase)} are, so it reads as a count of whatever the reader supplies`,
            });
            continue;
          }
          const expected = derived[governing.cls][shape.side];
          if (countIn(phrase) !== expected) {
            findings.push({
              file,
              phrase,
              why: `says ${countIn(phrase)} where the rule's own enumeration gives ${expected} ${governing.cls} ${OF_SIDE[shape.side]}`,
            });
          }
        }
      }
    }
  }
  return findings;
}

/** Which swept files state a count of the rank with its noun at all - the sweep's own reach. */
function filesStatingACount(sources: Map<string, string>): string[] {
  const holders = new Set<string>();
  for (const [file, text] of sources) {
    for (const sentence of asProse(text).split(/[.;]/)) {
      const marked = RANK_MARKER.test(sentence);
      for (const shape of NAMED_COUNT_SHAPES) {
        if (!shape.selfMarking && !marked) continue;
        if (new RegExp(shape.re).test(sentence)) holders.add(file);
      }
    }
  }
  return [...holders].sort();
}

/** What a reader is told when a site and the rule have parted: the file, the phrase and the rule. */
const countMessage = (findings: CountFinding[]) =>
  `${findings.length} statement(s) of the CRISPR rank's counts do not bear out the rule the engine ` +
  `runs:\n  ${findings.map((f) => `${f.file}: "${f.phrase}" ${f.why}`).join('\n  ')}`;

/** Every Rust and TypeScript source under `crates/` and `src/`, found by walking, not by listing. */
function walkProseSources(root: URL = REPO_ROOT): string[] {
  const files: string[] = [];
  const skip = new Set(['target', 'node_modules', 'dist', '.git']);
  const walk = (dir: string) => {
    for (const entry of nodeFs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(`${dir}${entry.name}/`);
      } else if (entry.isFile() && /\.(?:rs|ts|tsx)$/.test(entry.name)) {
        files.push(`${dir}${entry.name}`);
      }
    }
  };
  for (const top of ['crates/', 'src/']) {
    if (!nodeFs.existsSync(new URL(top, root))) throw new Error(`the sweep has nothing to read: ${top} is not in the tree`);
    walk(top);
  }
  return files.sort();
}

const readProseSources = (files: string[], root: URL = REPO_ROOT) =>
  new Map(files.map((file) => [file, nodeFs.readFileSync(new URL(file, root), 'utf8')] as const));

/** The scorer's arms, counted in its own body - the other half of what the description states. */
function scorerArmCount(): number {
  const path = 'crates/molbiocraft-cloning/src/cloning_crispr.rs';
  const source = nodeFs.readFileSync(new URL(path, REPO_ROOT), 'utf8');
  const OPENS = 'let score_guide = |spacer: &[u8], pam: &[u8]|';
  const CLOSES = "// The scorer's own floor";
  const from = source.indexOf(OPENS);
  if (from < 0) throw new Error(`${path} no longer binds the scorer as "${OPENS}", so its arms cannot be counted`);
  const body = source.slice(from);
  const to = body.indexOf(CLOSES);
  if (to < 0) throw new Error(`${path} no longer ends the scorer's arms at "${CLOSES}", so they cannot be counted`);
  const arms = body.slice(0, to);
  return (arms.match(/on_target \+=/g) ?? []).length + (arms.match(/on_target -=/g) ?? []).length;
}

/** The three sites this bug corrects, and the phrase each one carried instead. */
const CORRECTED_SITES: Array<{ file: string; was: string; now: string }> = [
  {
    file: 'src/__tests__/crisprScoreProvenance.test.tsx',
    now: `the scorer reads ${saying(5, 'features of')}`,
    was: `the scorer reads ${saying(6, 'and a PAM and')}`,
  },
  {
    file: 'crates/molbiocraft-cloning/src/bio_pipelines.rs',
    now: `three of the ${saying(6, 'features the rank reads')}`,
    was: `three of its ${saying(7, 'features')}`,
  },
  {
    file: 'crates/molbiocraft-cloning/tests/cloning_pipelines_buffers.rs',
    now: `three of the ${saying(6, 'features the scorer reads')}`,
    was: `three of the ${saying(7, 'features the scorer reads')}`,
  },
];

describe('every stated count of the rank says what it counts (BG-01M7FC2X)', () => {
  /** The rule's own counts, read from the engine the app reads them from. */
  const rankCounts = () => deriveRankCounts(crisprHeuristicRankDescriptionRust());
  /** The tree as the walk finds it, read fresh so no case here can be answered from a cache. */
  const sweptTree = () => {
    const files = walkProseSources();
    return { files, sources: readProseSources(files) };
  };

  it("BG-01M7FC2X AC1 no statement of the rank's feature count contradicts the scorer", () => {
    const derived = rankCounts();
    const { files, sources } = sweptTree();
    // Nowhere in the tree, not at a list of sites: the input is the walk's.
    expect(files.length, 'the sweep read no source at all, so it proves nothing').toBeGreaterThan(100);
    const findings = sweepRankCounts(sources, derived);
    expect(findings, countMessage(findings)).toEqual([]);

    // And each of the three sites is corrected, both ways round: it states the count the rule gives
    // now, and the phrase it used to carry is one this sweep refuses. The sweep above is what
    // "correcting only the frontend site" fails - it reads the two Rust sites too. The round trip
    // below says the rest: that each site's own former wording, restored on its own, is refused by
    // name, so "those two were merely ambiguous" cannot be said of them.
    for (const { file, was, now } of CORRECTED_SITES) {
      const text = sources.get(file);
      expect(text, `${file} is not among the ${files.length} swept sources`).toBeDefined();
      expect(asProse(text!), `${file} must state the count the rule gives`).toContain(asProse(now));
      const before = asProse(text!).replace(asProse(now), asProse(was));
      expect(before, `${file} no longer holds the phrase this bug was filed for`).not.toEqual(asProse(text!));
      const regressed = sweepRankCounts(new Map([[file, before]]), derived);
      expect(regressed.length, `restoring "${was}" in ${file} must fail the sweep`).toBeGreaterThan(0);
      expect([...new Set(regressed.map((f) => f.file))], 'and the failure names the file').toEqual([file]);
      expect(
        regressed.some((f) => asProse(was).includes(f.phrase)),
        `the restored phrase itself must be what the sweep refuses: ${countMessage(regressed)}`
      ).toBe(true);
    }
  });

  it('BG-01M7FC2X AC2 a wrong count in an unlisted file fails the sweep', () => {
    const derived = rankCounts();
    const { files, sources } = sweptTree();
    // The pattern reaches real statements in several files, so a green sweep is not a vacuous one.
    const holders = filesStatingACount(sources);
    expect(holders.length, 'the sweep matches no statement in the tree, so it would pass on any tree').toBeGreaterThan(3);

    // A wrong count planted in a file no list here names - a crate source that has never spoken of
    // the rank - fails the sweep, and the message names that file.
    const unlisted = 'crates/molbiocraft-core/src/lib.rs';
    expect(files, `${unlisted} is not in the tree any more: plant in another swept file`).toContain(unlisted);
    expect(holders, `${unlisted} already states a count, so planting one there proves less`).not.toContain(unlisted);
    const planted = new Map(sources).set(
      unlisted,
      `${sources.get(unlisted)}\n// ${saying(derived.features.spacer + 1, 'features of the spacer')}\n`
    );
    const found = sweepRankCounts(planted, derived);
    expect(found.map((f) => f.file), countMessage(found)).toEqual([unlisted]);
    expect(countMessage(found)).toContain(unlisted);

    // And the walk itself discovers a file nobody could have listed, at any depth, in either tree.
    const tree = nodeFs.mkdtempSync(`${tmpdir()}/BG01M7FC2X-sweep-`);
    try {
      const plant = `// ${saying(derived.features.spacer + 1, 'features of the spacer')}\n`;
      for (const [file, text] of [
        ['crates/new-crate/src/deep/compute.rs', plant],
        ['crates/new-crate/src/notes.md', plant],
        ['src/components/NewPanel.tsx', plant],
        ['src/__tests__/clean.ts', `// ${saying(derived.features.spacer, 'features of the spacer')}\n`],
      ] as const) {
        nodeFs.mkdirSync(`${tree}/${file.slice(0, file.lastIndexOf('/'))}`, { recursive: true });
        nodeFs.writeFileSync(`${tree}/${file}`, text, 'utf8');
      }
      const root = pathToFileURL(`${tree}/`);
      const walked = walkProseSources(root);
      expect(walked, 'the walk reads Rust and TypeScript at any depth, and nothing else').toEqual([
        'crates/new-crate/src/deep/compute.rs',
        'src/__tests__/clean.ts',
        'src/components/NewPanel.tsx',
      ]);
      const onTree = sweepRankCounts(readProseSources(walked, root), derived);
      expect(onTree.map((f) => f.file).sort(), countMessage(onTree)).toEqual([
        'crates/new-crate/src/deep/compute.rs',
        'src/components/NewPanel.tsx',
      ]);
    } finally {
      nodeFs.rmSync(tree, { recursive: true, force: true });
    }

    // The spelling the sites are held to is the rule's, not a number written here: read the rule as
    // naming one more feature of the spacer and every correct site in the tree fails.
    const shifted: RankCounts = {
      features: { ...derived.features, spacer: derived.features.spacer + 1 },
      arms: derived.arms,
    };
    const underShifted = sweepRankCounts(sources, shifted);
    expect(
      [...new Set(underShifted.map((f) => f.file))].length,
      'no site tracks the derived count, so the sweep is holding them to a constant'
    ).toBeGreaterThan(2);
  });

  it('BG-01M7FC2X AC3 a count stated with no noun is refused', () => {
    const derived = rankCounts();
    // The two counts are different numbers, or neither could be read as the other.
    expect(derived.arms.spacer, 'the arms and the features of the spacer are the same number here').not.toBe(
      derived.features.spacer
    );
    expect(derived.arms.total, 'the arms and the features in all are the same number here').not.toBe(
      derived.features.total
    );
    // And the arms the rule states are the arms the scorer runs, so the arms convention below is
    // the scorer's own shape and not a second claim. (This comment says "N arms", not a number
    // beside the spacer: a bare count written here would be a planted defect in a swept file, and
    // the sweep reads this file. It caught one in this very comment while it was being written.)
    expect(scorerArmCount(), 'the rule states a different number of adjustments from `score_guide`').toBe(
      derived.arms.total
    );

    const sweep = (prose: string) => sweepRankCounts(new Map([['src/fixture.ts', `// ${prose}\n`]]), derived);
    const whys = (prose: string) => sweep(prose).map((f) => f.why).join(' | ');

    // Said with its noun, each count in its own words: accepted.
    const spelled = `the scorer reads ${saying(derived.features.spacer, 'features of the spacer')} and ${saying(
      derived.features.pam,
      'of its PAM'
    )}, ${saying(derived.features.total, 'in all')}`;
    expect(whys(spelled), `"${spelled}" is the spelling the rule gives`).toBe('');
    const asArms = `the scorer runs ${saying(derived.arms.spacer, 'adjustment arms over the spacer')} and an eighth for the PAM`;
    expect(whys(asArms), `"${asArms}" is the other convention, and says which it is`).toBe('');

    // Each count read as the other: refused. This is the ambiguity that produced the original error.
    const armsAsFeatures = `the scorer reads ${saying(derived.arms.spacer, 'features of the spacer')}`;
    expect(whys(armsAsFeatures), `"${armsAsFeatures}" reads the arms as features`).toContain(
      `${derived.features.spacer} features of the spacer`
    );
    const featuresAsArms = `the scorer runs ${saying(derived.features.spacer, 'adjustment arms over the spacer')}`;
    expect(whys(featuresAsArms), `"${featuresAsArms}" reads the features as arms`).toContain(
      `${derived.arms.spacer} arms of the spacer`
    );

    // A bare count - a number with no noun anywhere in its statement - is refused, whatever its
    // value: the reader cannot tell which of the two counts it is, which is the whole defect.
    for (const bare of [
      `the scorer reads ${saying(6, 'and a PAM')}`,
      `the rank is a rule of thumb over ${saying(6, 'of the spacer')}`,
      `the rank is a rule of thumb over ${saying(derived.features.spacer, 'of the spacer')}`,
      `the scorer weighs ${saying(derived.arms.spacer, 'over the spacer')}`,
    ]) {
      expect(whys(bare), `"${bare}" states a count with no noun`).toContain('states a count with no noun');
    }
    // Once the statement says what is counted, the counts it then carries bare are read against it.
    expect(whys(spelled), 'a bare count governed by a noun in its own statement is read, not refused').toBe('');
    const wrongBare = `the scorer reads ${saying(derived.features.spacer, 'features of the spacer')} and ${saying(
      derived.features.pam + 1,
      'of its PAM'
    )}`;
    expect(whys(wrongBare), `"${wrongBare}" miscounts the PAM`).toContain(`${derived.features.pam} features of its PAM`);

    // What it leaves alone: ordinary prose that puts a number beside the word "rank", and a count of
    // something else that borrows the word "arms". Neither states a count of what the rank reads.
    for (const ordinary of [
      'the heuristic rank is 68 before any adjustment, and a rank 72 guide ranks above a rank 60 one',
      `a scan can run to as many bases as lie between the starts of its ${saying(2, 'arms')}`,
      `a base of the shown guide's spacer, and ${saying(1, 'of its PAM:')} the spacer is what you order`,
      'every repeat, more than 12,000 in all, and nothing else the checks read',
    ]) {
      expect(whys(ordinary), `"${ordinary}" states no count of what the rank reads`).toBe('');
    }
    // The cost of that, stated rather than hidden: a possessive count of arms ("its N arms") in a
    // sentence that does name the scorer is read as a count of the rank's arms, and refused.
    const borrowed = `the scorer walks as many bases as lie between the starts of its ${saying(2, 'arms')}`;
    expect(whys(borrowed), `"${borrowed}" is read as a count of the scorer's arms`).toContain(
      `${derived.arms.total} arms in all`
    );
  });
});
