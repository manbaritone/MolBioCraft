// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6SHQ0: the linear view's quickbar reads whether a selection has a Tm from the cockpit's one
 * rule, basicTmHasNoAnswer (ConstructCockpitBar.tsx), and keeps no copy of it. It kept its own
 * (LinearSequenceView.tsx), which read 26 N and 14 A/C/G/T as 37.4 °C after the rule moved.
 *
 * The rule is replaced by a spy that answers what the test tells it, so the quickbar must follow the
 * spy: "Tm n/a" when it says so even on an A/C/G/T selection, a number when it says not even on one
 * holding N. A quickbar with its own copy of the rule reads the other way in both cases.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rule = vi.hoisted(() => ({
  /** What the spy answers; null: the real rule's answer. */
  answer: null as null | boolean,
}));

vi.mock('../components/ConstructCockpitBar', async () => {
  const actual = await vi.importActual<typeof import('../components/ConstructCockpitBar')>('../components/ConstructCockpitBar');
  return {
    ...actual,
    basicTmHasNoAnswer: vi.fn((length: number, acgt: number) => rule.answer ?? actual.basicTmHasNoAnswer(length, acgt)),
  };
});

const { basicTmHasNoAnswer } = await import('../components/ConstructCockpitBar');
const { LinearSequenceView } = await import('../components/LinearSequenceView');
type SequenceDocument = import('../types/bio').SequenceDocument;

const spy = vi.mocked(basicTmHasNoAnswer);

afterEach(() => {
  rule.answer = null;
  spy.mockClear();
});

/** A fixed-seed A/C/G/T run. */
const acgt = (len: number, seed: number) => {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[x >>> 30];
  }
  return out;
};

const docOf = (name: string, sequence: string): SequenceDocument => ({
  id: `doc-${name}`, name, accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence,
  features: [], primers: [], history: [], createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
  folder: 'Plasmids & Vectors' as SequenceDocument['folder'],
});

const noop = () => {};

/** The quickbar's Tm for a selection, as it reads, with the title of an "n/a". */
const quickbarTm = (doc: SequenceDocument, start: number, end: number) => {
  const html = renderToStaticMarkup(
    <LinearSequenceView doc={doc} cutSites={[]} selectedRange={{ start, end }} onSelectRange={noop} onUpdateDocument={noop} />,
  );
  const summary = /<div class="seq-selection-quickbar-summary">([\s\S]*?)<\/div>/.exec(html)?.[1];
  expect(summary, 'the quickbar is drawn').toBeDefined();
  const words = summary!.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  const tm = /· Tm ([^)]*)\)\s*$/.exec(words)?.[1]?.trim();
  const title = /<span title="([^"]*)">n\/a<\/span>/.exec(summary!)?.[1] ?? null;
  return { tm, title };
};

describe("the quickbar's Tm rule (BG-01M6SHQ0)", () => {
  it("the quickbar shares the cockpit's Tm n/a rule", () => {
    // Bases 3..22 of an A/C/G/T record, and of one with an N at base 9 and a lower-case u at 15
    // (read as T), so the selection's length (20) and its A/C/G/T count (20, then 19) differ from
    // the record's (30).
    const plain = docOf('plain', acgt(30, 3));
    const withN = docOf('withN', (() => {
      const s = [...acgt(30, 5)];
      s[8] = 'N';
      s[14] = 'u';
      return s.join('');
    })());
    const NUMBER = /^-?\d+\.\d °C$/;

    // The real rule: a Tm for A/C/G/T, n/a with the shared reason for one N.
    expect(quickbarTm(plain, 3, 22).tm, 'A/C/G/T, the real rule').toMatch(NUMBER);
    expect(quickbarTm(withN, 3, 22), 'one N, the real rule').toEqual({
      tm: 'n/a',
      title: 'Tm n/a: the span holds 1 N or other ambiguity base; Tm is computed on A/C/G/T only, as Primer3 does',
    });

    // Forced true on an A/C/G/T selection: "Tm n/a".
    rule.answer = true;
    spy.mockClear();
    expect(quickbarTm(plain, 3, 22).tm, 'A/C/G/T, the rule forced to no answer').toBe('n/a');
    expect(spy, "called with the selection's length and A/C/G/T count").toHaveBeenCalledWith(20, 20);

    // Forced false on a selection holding N: a number.
    rule.answer = false;
    spy.mockClear();
    const forced = quickbarTm(withN, 3, 22);
    expect(forced.tm, 'one N, the rule forced to an answer').toMatch(NUMBER);
    expect(forced.title, 'no n/a title').toBeNull();
    expect(spy, "called with the selection's length and A/C/G/T count, U counted as T").toHaveBeenCalledWith(20, 19);
  });
});
