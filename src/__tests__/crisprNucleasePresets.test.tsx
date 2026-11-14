// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DV29: the CRISPR tab offers the nucleases the engine scans for, each with its PAM side,
 * PAM pattern, spacer length, site span and cut convention beside the choice, and every guide row
 * names the preset that found it and that preset's PAM side.
 *
 * Every number and every word comes from the real WASM engine, through the studio's own
 * `crisprNucleasePresets` and `scanCrisprGuides` calls; nothing is mocked and no fact is written
 * into a fixture by hand. The studio is rendered on the server, as the other studio tests render
 * it, and the markup it returns is read as text.
 *
 * Wrong implementations this catches:
 * - a chooser with its nucleases written into the component (it would keep offering them whatever
 *   the engine supports, and the ids are compared with the engine's list here);
 * - a chooser that names a nuclease but not its site rule (the PAM side, pattern, spacer length,
 *   site span and cut convention are each read out of the markup);
 * - rows that name no nuclease, so a 5'-PAM guide and a 3'-PAM guide read alike;
 * - a Cas12a row that shows one cut position, which reads as a blunt cut (D0131);
 * - an N in a returned PAM shown as a base that was read (US-01M7DV29 AC5's row mark).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrimerAndPCRStudio } from '../components/PrimerAndPCRStudio';
import { crisprNucleasePresets, scanCrisprGuides } from '../core/bioEngine';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

const dnaDoc = (id: string, sequence: string): SequenceDocument => ({
  ...EMPTY_WORKSPACE_DOCUMENT,
  id,
  name: id,
  sequence,
});

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
    .replace(/\s+/g, ' ');

/** The CRISPR tab of the studio, rendered on `doc`. */
const crisprTab = (doc: SequenceDocument) =>
  renderToStaticMarkup(
    <PrimerAndPCRStudio
      doc={doc}
      allDocuments={[doc]}
      onUpdateDocument={() => undefined}
      onAddConstruct={() => undefined}
      initialSubTab="crispr"
    />
  );

/** The nuclease chooser's markup, and the option labels it offers. */
function nucleaseControl(html: string): { select: string; options: string[]; facts: string } {
  const select = /<select aria-label="Nuclease \/ PAM:"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
  const options = [...select.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/g)].map((m) => text(m[1]).trim());
  const facts = text(/<span class="mbc-opdlg-muted" data-nuclease-facts="[^"]*">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? '').trim();
  return { select, options, facts };
}
const optionValues = (select: string) =>
  [...select.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&'));

/** The rows of the guide table, as a reader reads each one. */
const guideRows = (html: string) =>
  [...html.matchAll(/<tr><td><strong>(?:gRNA|crRNA)[\s\S]*?<\/tr>/g)].map((m) => text(m[0]).trim());

/** A 20-nt spacer free of GG and CC: one candidate per planted site. */
const SPACER20 = 'GACGTTACCGATTGCAATCG';
/** One SpCas9 site at 6..28 (AGG PAM), flanked by alternating bases, so no TTTV is spelled. */
const spcas9Doc = dnaDoc('Dv29_SpCas9', `ACACA${SPACER20}AGGACACA`);
/** One Cas12a site at 6..29 (TTTA PAM 5' of the spacer). */
const cas12aDoc = dnaDoc('Dv29_Cas12a', `ACACATTTA${SPACER20}ACACA`);
/** The same SpCas9 site with an N where the PAM is unconstrained. */
const ambiguousPamDoc = dnaDoc('Dv29_AmbiguousPam', `ACACA${SPACER20}NGGACACA`);

describe('the CRISPR tab offers the nucleases the engine scans for (US-01M7DV29)', () => {
  it('US-01M7DV29 AC1 the engine lists each preset with its PAM side, pattern, spacer length, site span and cut convention, and the control offers exactly that list', () => {
    const presets = crisprNucleasePresets();
    // The engine's own list: every fact the criterion names, for each preset.
    expect(presets).toEqual([
      {
        id: 'SpCas9 (NGG)',
        pamSide: "3'",
        pamPattern: 'NGG',
        spacerLengthBp: 20,
        siteSpanBp: 23,
        cutConvention: expect.stringContaining('Blunt cut 3 bp'),
      },
      {
        id: 'Cas12a / Cpf1 (TTTV)',
        pamSide: "5'",
        pamPattern: 'TTTV',
        spacerLengthBp: 20,
        siteSpanBp: 24,
        cutConvention: expect.stringContaining('Staggered cut leaving a 5-nt 5'),
      },
    ]);

    const html = crisprTab(spcas9Doc);
    const control = nucleaseControl(html);
    // Exactly the engine's presets, in its order, by the id the engine resolves.
    expect(optionValues(control.select)).toEqual(presets.map((n) => n.id));
    expect(control.options).toEqual([
      "SpCas9 (NGG) — 5'-N20-NGG-3' (3' PAM, 20-nt spacer, 23-bp site)",
      "Cas12a / Cpf1 (TTTV) — 5'-TTTV-N20-3' (5' PAM, 20-nt spacer, 24-bp site)",
    ]);
    // And the chosen preset's facts, including its cut convention, beside the choice.
    expect(control.facts).toBe(
      `PAM NGG on the 3' side, 20-nt spacer, 23-bp site. ${presets[0].cutConvention}`
    );
    expect(control.facts).toContain('between spacer nt 17 and nt 18');

    // The other preset, chosen: its own facts, not the first one's.
    const cas12aHtml = renderToStaticMarkup(
      <PrimerAndPCRStudio
        doc={cas12aDoc}
        allDocuments={[cas12aDoc]}
        onUpdateDocument={() => undefined}
        onAddConstruct={() => undefined}
        initialSubTab="crispr"
      />
    );
    // The default choice is the engine's first preset, so the facts shown are SpCas9's here too.
    expect(nucleaseControl(cas12aHtml).facts).toContain("PAM NGG on the 3' side");
    // Every option the control offers is a preset the engine scans for: it refuses nothing offered.
    for (const id of optionValues(control.select)) {
      expect(scanCrisprGuides(spcas9Doc.sequence, id, 5, false).report, id).toBeDefined();
    }
  }, 55_000);

  it('US-01M7DV29 AC6 each row names the preset and its PAM side, with the staggered second cut and an ambiguous PAM base marked', () => {
    // SpCas9's own site: the row names the preset, its 3' PAM, and one cut position.
    const spRows = guideRows(crisprTab(spcas9Doc));
    expect(spRows).toHaveLength(1);
    expect(spRows[0]).toContain("SpCas9 (NGG) (3' PAM)");
    expect(spRows[0], 'a blunt cutter has no second cut').not.toContain('staggered cut');
    expect(spRows[0]).toContain('6..28 (DSB @ 22)');

    // The guide record carries the same facts, from the engine.
    const spGuide = scanCrisprGuides(spcas9Doc.sequence, 'SpCas9 (NGG)', 5, false).guides[0];
    expect([spGuide.nuclease, spGuide.pamSide, spGuide.pamPattern]).toEqual([
      'SpCas9 (NGG)',
      "3'",
      'NGG',
    ]);
    expect(spGuide.cutPositionTargetStrand).toBeUndefined();

    // Cas12a's own site, scanned as Cas12a: the row names the 5' PAM and the staggered second cut,
    // so the single position is not read as a blunt one (D0131).
    const cas12aGuide = scanCrisprGuides(cas12aDoc.sequence, 'Cas12a / Cpf1 (TTTV)', 5, false)
      .guides[0];
    expect([cas12aGuide.nuclease, cas12aGuide.pamSide, cas12aGuide.pamPattern]).toEqual([
      'Cas12a / Cpf1 (TTTV)',
      "5'",
      'TTTV',
    ]);
    expect([cas12aGuide.cutPosition, cas12aGuide.cutPositionTargetStrand]).toEqual([27, 32]);
    expect(cas12aGuide.cutConvention).toContain('AsCas12a/LbCas12a');
    // A 5'-PAM guide and a 3'-PAM guide are told apart by the row, without reading the bases.
    expect(`${cas12aGuide.nuclease} (${cas12aGuide.pamSide} PAM)`).not.toBe(
      `${spGuide.nuclease} (${spGuide.pamSide} PAM)`
    );

    // An N where the PAM is unconstrained is returned, and the row marks it as not a read base.
    const ambiguous = scanCrisprGuides(ambiguousPamDoc.sequence, 'SpCas9 (NGG)', 5, false).guides[0];
    expect(ambiguous.pamSeq).toBe('NGG');
    expect(ambiguous.pamAmbiguityNote).toContain('N at PAM position 1');
    const ambiguousRows = guideRows(crisprTab(ambiguousPamDoc));
    expect(ambiguousRows[0]).toContain('ambiguity code, base not read');
    // And a PAM read base by base is not marked.
    expect(spGuide.pamAmbiguityNote).toBeUndefined();
    expect(spRows[0]).not.toContain('ambiguity code');
  }, 55_000);

  it('US-01M7DV29 AC4 a staggered target-strand cut past the end of a linear sequence has no position and says why, and a circle read whole wraps it', () => {
    // The Cas12a site ends the molecule, so its target-strand cut (record base 32) lies past base 29.
    const endSeq = `TTTTTTTTA${SPACER20}`;
    const linear = scanCrisprGuides(endSeq, 'Cas12a / Cpf1 (TTTV)', 5, false).guides;
    const atEnd = linear.find((g) => g.strand === 1 && g.start === 6)!;
    expect(atEnd.cutPosition, 'the PAM-strand cut is inside the molecule').toBe(27);
    expect(atEnd.cutPositionTargetStrand, 'never wrapped to the start of a linear molecule').toBeUndefined();
    expect(atEnd.cutPositionTargetStrandNote).toContain('past the end');
    // Mid-sequence, the same site keeps its second coordinate and has no note.
    const mid = scanCrisprGuides(cas12aDoc.sequence, 'Cas12a / Cpf1 (TTTV)', 5, false).guides[0];
    expect([mid.cutPositionTargetStrand, mid.cutPositionTargetStrandNote]).toEqual([32, undefined]);
    // A circle read whole does wrap it: base 32 of a 29-base circle is base 3.
    const circle = scanCrisprGuides(endSeq, 'Cas12a / Cpf1 (TTTV)', 5, true).guides.find(
      (g) => g.strand === 1 && g.start === 6
    )!;
    expect([circle.cutPositionTargetStrand, circle.cutPositionTargetStrandNote]).toEqual([3, undefined]);
  }, 55_000);
});
