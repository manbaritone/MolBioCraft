// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6SHQ0: an oligo holding N, or any base other than A, C, G or T, has no Tm (primer3-py 2.4.0
 * `calc_tm` refuses it), and every reader of its Tm shows the one shared reason in its place:
 *
 *   "Tm n/a: the span holds <k> N or other ambiguity base(s); Tm is computed on A/C/G/T only, as
 *   Primer3 does"
 *
 * The Primer studio's custom-oligo Tm and the cloning studio's Gibson arm read the engine's
 * `tmNoAnswerReason`; the Oligo calculator, the primer import and primer records keep the ambiguity
 * codes instead of deleting them or rewriting them to A; and the degenerate designer still gives
 * its Tm only to expanded A/C/G/T versions. Components are rendered with renderToStaticMarkup and
 * read as the words they show; every number comes from the real WASM engine.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Probes, installed before the modules under test load ───

type ElementProbe = (type: unknown, props: Record<string, unknown>) => void;
const probe = vi.hoisted(() => ({
  /** Sees every element a component creates, with its props, while it renders. */
  onElement: null as null | ElementProbe,
  /** The custom oligo the Primer studio opens with in place of its default, when set. */
  customOligo: null as null | string,
  /** How many times the studio asked for its default custom oligo. */
  customOligoSeen: 0,
  /** Every sequence the degenerate designer handed to its `tmOf`. */
  tmOfArgs: [] as string[],
}));

// The Primer studio keeps its custom oligo in state, so the test opens it on another oligo by
// answering the studio's own `useState` for its default.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useState = ((initial: unknown) => {
    if (initial === 'GGAATTCCATATGGTGAGCAAGGGCGAGGAG') {
      probe.customOligoSeen++;
      if (probe.customOligo !== null) return actual.useState(probe.customOligo);
    }
    return actual.useState(initial);
  }) as typeof actual.useState;
  return { ...actual, default: { ...actual, useState }, useState };
});

type JsxFn = (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => unknown;
const watch = vi.hoisted(() => (fn: JsxFn): JsxFn => (type, props, ...rest) => {
  probe.onElement?.(type, props ?? {});
  return fn(type, props, ...rest);
});
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-dev-runtime');
  return { ...actual, jsxDEV: watch(actual.jsxDEV) };
});
vi.mock('react/jsx-runtime', async () => {
  const actual = await vi.importActual<Record<string, JsxFn>>('react/jsx-runtime');
  return { ...actual, jsx: watch(actual.jsx), jsxs: watch(actual.jsxs) };
});

// A Gibson arm with no Tm has its number replaced by one whose toFixed throws, so the callout
// proves it never formats a Tm that is no answer.
vi.mock('../lib/rustBioEngine', async () => {
  const actual = await vi.importActual<typeof import('../lib/rustBioEngine')>('../lib/rustBioEngine');
  const noAnswerTm = {
    toFixed: () => {
      throw new TypeError('toFixed ran on a Gibson arm Tm that has no answer');
    },
  } as unknown as number;
  return {
    ...actual,
    analyzeGibsonOverlapJunctionRust: (overlapSeq: string) => {
      const reply = actual.analyzeGibsonOverlapJunctionRust(overlapSeq);
      return reply.tmNoAnswerReason ? { ...reply, tmC: noAnswerTm } : reply;
    },
  };
});

// The degenerate designer as it is, with a spy on the `tmOf` the runner hands it.
vi.mock('../core/degeneratePrimers', async () => {
  const actual = await vi.importActual<typeof import('../core/degeneratePrimers')>('../core/degeneratePrimers');
  return {
    ...actual,
    designDegeneratePrimers: (rows: string[], o: Parameters<typeof actual.designDegeneratePrimers>[1], tmOf: (seq: string) => number) =>
      actual.designDegeneratePrimers(rows, o, (seq) => {
        probe.tmOfArgs.push(seq);
        return tmOf(seq);
      }),
  };
});

const { PrimerAndPCRStudio } = await import('../components/PrimerAndPCRStudio');
const { CloningAndGelStudio } = await import('../components/CloningAndGelStudio');
const { NewSequenceModal, computeOligoTmSantaLucia } = await import('../components/MenusPreferencesAndBlastModal');
const { LinearSequenceView } = await import('../components/LinearSequenceView');
const { calculatePrimerMetrics } = await import('../core/bioEngine');
const { analyzeGibsonOverlapJunctionRust } = await import('../lib/rustBioEngine');
const { primerRecordFromDoc, runDesignDegeneratePrimers, runImportPrimers, runTestSavedPrimers } = await import('../core/operationRunners');
type SequenceDocument = import('../types/bio').SequenceDocument;
type PrimerRecord = import('../types/bio').PrimerRecord;

afterEach(() => {
  probe.onElement = null;
  probe.customOligo = null;
  probe.customOligoSeen = 0;
  probe.tmOfArgs = [];
});

// ─── Helpers ───

/** The shared reason, in the product seat's words, written out here rather than taken from the app. */
const reason = (k: string, plural: boolean) =>
  `Tm n/a: the span holds ${k} N or other ambiguity base${plural ? 's' : ''}; Tm is computed on A/C/G/T only, as Primer3 does`;
const ONE = reason('1', false);

/** A fixed-seed A/C/G/T run, so no fixture files are needed. */
const acgt = (len: number, seed: number) => {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[x >>> 30];
  }
  return out;
};

const docOf = (name: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id: `doc-${name}`, name, accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence,
  features: [], primers: [], history: [], createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
  folder: 'Plasmids & Vectors' as SequenceDocument['folder'], ...more,
});

/** The words markup shows: tags and comments dropped, entities decoded, spaces collapsed. */
const wordsOf = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const noop = () => {};

/** The Primer studio's custom-oligo Tm KPI, as it reads, opened on `oligo` (null: its default). */
const customOligoTm = (oligo: string | null) => {
  probe.customOligo = oligo;
  probe.customOligoSeen = 0;
  const html = renderToStaticMarkup(
    <PrimerAndPCRStudio doc={docOf('template', acgt(1_200, 3))} onUpdateDocument={noop} onAddConstruct={noop} />,
  );
  expect(probe.customOligoSeen, 'the studio opened its custom oligo through the probe').toBeGreaterThan(0);
  const kpi = /<span class="kpi-label">Salt-Corrected Tm<\/span>([\s\S]*?)<\/div>/.exec(html);
  expect(kpi, 'the Salt-Corrected Tm KPI is drawn').not.toBeNull();
  return wordsOf(kpi![1]);
};

/** The cloning studio's Gibson arm callout, as it reads, for an insert whose first 28 bases are `arm`. */
const gibsonArm = (arm: string) => {
  const insert = docOf('insert', `${arm}${acgt(600, 5)}`, { folder: 'Cloning Inserts & PCR' as SequenceDocument['folder'] });
  const vector = docOf('vector', acgt(3_000, 7), { topology: 'circular' });
  const html = renderToStaticMarkup(
    <CloningAndGelStudio documents={[insert, vector]} activeDoc={vector} onAddConstruct={noop} initialMethod="Gibson Assembly" />,
  );
  const callout = /Arm \(28 bp\):([\s\S]*?)kcal\/mol/.exec(wordsOf(html));
  expect(callout, 'the Gibson arm callout is drawn').not.toBeNull();
  return callout![1].trim();
};

/**
 * The sequence view's primer labels and their titles, for a document carrying `primers`, each once
 * (a primer across a row break is labelled on both rows).
 */
const primerPills = (doc: SequenceDocument) => {
  const html = renderToStaticMarkup(
    <LinearSequenceView doc={doc} cutSites={[]} selectedRange={null} onSelectRange={noop} onUpdateDocument={noop} />,
  );
  const pills = [...html.matchAll(/<span class="primer-pill"( title="([^"]*)")?>([\s\S]*?)<\/span>/g)].map((m) => ({
    title: m[2] ?? null,
    text: wordsOf(m[3]),
  }));
  return pills.filter((p, i) => pills.findIndex((q) => q.text === p.text && q.title === p.title) === i);
};

describe('the Tm of an oligo holding an ambiguity code (BG-01M6SHQ0)', () => {
  it('reads Tm n/a in the Primer studio and the Gibson arm for an oligo holding an ambiguity code', () => {
    // ── The Primer studio's custom-oligo Tm (PrimerAndPCRStudio.tsx) ──
    // Wrong implementation: printing `tmC` whatever the engine says (68 °C-style numbers for N).
    const nOligo = 'GGAATTCCATATGNTGAGCAAGGGCGAGGAG';
    expect(calculatePrimerMetrics(nOligo).tmNoAnswerReason, "the engine's reason for one N").toBe(ONE);
    expect(Number.isFinite(calculatePrimerMetrics(nOligo).tmC), 'tmC stays a number').toBe(true);
    expect(customOligoTm(nOligo), 'one N').toBe(`n/a ${ONE}`);
    expect(customOligoTm('GGAATTCCATATGRTGAGCAAGGGCGAGGAY'), 'an R and a Y').toBe(`n/a ${reason('2', true)}`);
    // An A/C/G/T oligo keeps its number: the studio's default oligo.
    const plain = calculatePrimerMetrics('GGAATTCCATATGGTGAGCAAGGGCGAGGAG');
    expect(plain.tmNoAnswerReason).toBeUndefined();
    expect(customOligoTm(null), 'the default A/C/G/T oligo').toBe(`${plain.tmC} °C`);

    // ── The cloning studio's Gibson arm (CloningAndGelStudio.tsx) ──
    // The callout reads the insert's first 28 bases. Wrong implementation: `tmC.toFixed(1)` run on
    // the reply whatever its reason, which throws here on the no-answer value.
    const nArm = 'GTCCAGGAGCNCACCATCTTCTTCAGGA';
    expect(gibsonArm(nArm), 'an arm holding one N').toMatch(new RegExp(`^${ONE.replace(/[/.()]/g, '\\$&')}, ΔG -?\\d+\\.\\d$`));
    expect(gibsonArm(nArm)).not.toMatch(/Tm -?\d/);
    const plainArm = 'GTCCAGGAGCGCACCATCTTCTTCAGGA';
    const plainReply = analyzeGibsonOverlapJunctionRust(plainArm);
    expect(plainReply.tmNoAnswerReason).toBeUndefined();
    expect(gibsonArm(plainArm), 'an A/C/G/T arm keeps its Tm')
      .toBe(`Tm ${plainReply.tmC.toFixed(1)}°C, ΔG ${plainReply.hairpinDeltaG.toFixed(1)}`);
  });

  it('keeps ambiguity codes in the Oligo calculator, the primer import and primer records', () => {
    // ── The Oligo calculator of the new-sequence dialog (computeOligoTmSantaLucia) ──
    // Wrong implementation: deleting the N first, which gave ACGTACGTNACGTACGTACG the Tm of the
    // 19-base ACGTACGTACGTACGTACG.
    const nOligo = 'ACGTACGTNACGTACGTACG';
    const calc = computeOligoTmSantaLucia(nOligo, 250, 50, 1.5, 0.2);
    expect([calc.length, calc.tmNoAnswerReason], 'the N is kept').toEqual([20, ONE]);
    expect(Number.isFinite(calc.tmC)).toBe(true);
    expect(computeOligoTmSantaLucia('acgtacgtnacgtacgtacg').tmNoAnswerReason, 'lower case too').toBe(ONE);
    const plainCalc = computeOligoTmSantaLucia('ACGTACGTACGTACGTACG', 250, 50, 1.5, 0.2);
    expect(plainCalc.tmNoAnswerReason).toBeUndefined();
    expect(plainCalc.tmC).toBe(calculatePrimerMetrics('ACGTACGTACGTACGTACG', 50, 1.3, 250).tmC);
    // The dialog saves an N-holding primer: its description, metadata and primer record carry the
    // reason. The save is the handler the dialog hands its own OK button.
    const saveOligo = (sequence: string) => {
      let save: (() => void) | null = null;
      probe.onElement = (type, p) => {
        if (type === 'button' && String(p.className ?? '').includes('newseq-btn-ok')) save = p.onClick as () => void;
      };
      const created: SequenceDocument[] = [];
      renderToStaticMarkup(
        <NewSequenceModal defaultFolder="Primers" initialSequence={sequence} initialType="Primer" onClose={noop} onCreateDoc={(d) => created.push(d)} />,
      );
      probe.onElement = null;
      expect(save, 'the dialog drew its OK button').not.toBeNull();
      save!();
      expect(created, 'one document saved').toHaveLength(1);
      return created[0];
    };
    const saved = saveOligo(nOligo);
    expect(saved.sequence).toBe(nOligo);
    expect(saved.primers[0].tmNoAnswerReason, "the saved primer record").toBe(ONE);
    expect(Number.isFinite(saved.primers[0].tmAnnealC)).toBe(true);
    expect(saved.docMetadata?.Tm, "the document's Tm row").toBe(ONE);
    expect(saved.description, 'the description').toBe(`Manual oligonucleotide primer (20 nt, ${ONE})`);
    const savedPlain = saveOligo('ACGTACGTACGTACGTACG');
    expect(savedPlain.primers[0].tmNoAnswerReason).toBeUndefined();
    expect(savedPlain.docMetadata?.Tm).toBe(`${plainCalc.tmC.toFixed(1)} °C`);

    // ── The primer-spreadsheet import (runImportPrimers) ──
    // Wrong implementation: rewriting N to A, which gave the primer the Tm of a different oligo.
    const imported = runImportPrimers('name\tsequence\nwithN\tACGTACGTNACGTACGTACG\nplain\tACGTACGTACGTACGTACG\nwithW\tacgtacgtwacgtacgtacg\n', {});
    const tmRow = (name: string) => imported.created.find((d) => d.name === name)?.docMetadata?.['Tm (°C)'];
    expect(tmRow('withN'), 'an imported primer holding N').toBe(ONE);
    expect(tmRow('withW'), 'an imported primer holding a lower-case w').toBe(ONE);
    expect(tmRow('plain'), 'an A/C/G/T primer keeps its Tm').toBe(Number(calculatePrimerMetrics('ACGTACGTACGTACGTACG').tmC.toFixed(1)));
    expect(calculatePrimerMetrics('ACGTACGTAACGTACGTACG').tmNoAnswerReason, 'the oligo the N was rewritten to has a Tm').toBeUndefined();

    // ── Primer records from documents (primerRecordFromDoc), and the sequence view's label ──
    const nDoc = docOf('primerN', nOligo, { documentKind: 'primer' });
    let record: PrimerRecord | null = null;
    expect(() => { record = primerRecordFromDoc(nDoc); }, 'a record for an N-holding primer document').not.toThrow();
    expect(record!.tmNoAnswerReason).toBe(ONE);
    expect(Number.isFinite(record!.tmAnnealC) && Number.isFinite(record!.tmFullC)).toBe(true);
    const plainRecord = primerRecordFromDoc(docOf('primerPlain', 'ACGTACGTACGTACGTACG', { documentKind: 'primer' }));
    expect(plainRecord.tmNoAnswerReason).toBeUndefined();
    const template = docOf('template', `${acgt(30, 11)}${nOligo}${acgt(100, 13)}`, {
      primers: [
        { ...record!, bindStart: 31, bindEnd: 50 },
        { ...plainRecord, id: 'plain-primer', bindStart: 60, bindEnd: 78 },
      ],
    });
    expect(primerPills(template), 'the sequence view reads Tm n/a for the N primer only').toEqual([
      { title: ONE, text: '▶ primerN (Tm n/a)' },
      { title: null, text: `▶ primerPlain (Tm ${plainRecord.tmAnnealC}°C)` },
    ]);
    // Test with Saved Primers places the N primer where it binds, carrying the reason, and says its
    // effective Tm is n/a.
    const tested = runTestSavedPrimers([template], [nDoc], { maxMismatches: 0 });
    const placed = tested.updated[0].primers.filter((p) => p.notes?.startsWith('Binding site from Test with Saved Primers'));
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) {
      expect(p.tmNoAnswerReason).toBe(ONE);
      expect(p.notes).toMatch(/effective Tm n\/a$/);
    }
  });

  it("passes only A/C/G/T variants to the degenerate designer's Tm", () => {
    // A seeded alignment of 8 rows x 520 columns: a template with a varied base every 11th column
    // in some rows, so the consensus holds R, Y, S, W, K and M columns, and one row also holding N
    // and R bases of its own. Wrong implementation: the designer, or the runner's tmOf, given the
    // degenerate primer itself (a sequence holding those codes), which has no Tm.
    const base = acgt(520, 17);
    const rows = Array.from({ length: 8 }, (_, r) => {
      let x = (r + 1) * 7919;
      return [...base].map((b, c) => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        if (c % 11 === 5 && x >>> 31) return 'ACGT'[('ACGT'.indexOf(b) + 1 + (x >>> 29) % 3) % 4];
        if (r === 3 && c % 97 === 40) return c % 2 ? 'N' : 'R';
        return b;
      }).join('');
    });
    const aln = docOf('aln', '', {
      alignmentMeta: { isAligned: true, sequences: rows.map((sequence, i) => ({ id: `r${i}`, name: `row ${i}`, sequence })) },
    });
    const r = runDesignDegeneratePrimers(aln, { maxDegeneracy: 256, tmMin: 45, tmMax: 70, exact3Prime: 2, pairs: 3 }, { sourceLabel: 'seeded' });
    const records = r.updated[0].primers.filter((p) => p.notes?.startsWith('Degenerate primer from Design Degenerate Primers'));
    expect(records.length, 'primer pairs were designed').toBeGreaterThan(0);
    expect(records.some((p) => /[^ACGT]/.test(p.sequence)), 'the designed primers hold ambiguity codes').toBe(true);
    expect(probe.tmOfArgs.length, 'the designer asked for Tms').toBeGreaterThan(0);
    const notAcgt = probe.tmOfArgs.filter((s) => !/^[ACGT]+$/.test(s));
    expect(notAcgt, 'every tmOf argument is an expanded A/C/G/T version').toEqual([]);
    for (const p of records) {
      expect(p.tmNoAnswerReason, `${p.name}: no reason on a degenerate primer`).toBeUndefined();
      expect(Number.isFinite(p.tmAnnealC) && Number.isFinite(p.tmFullC), `${p.name}: a numeric Tm`).toBe(true);
      expect(p.notes, `${p.name}: its Tm range`).toMatch(/; Tm \d+\.\d(–\d+\.\d)? °C;/);
    }
  });
});
