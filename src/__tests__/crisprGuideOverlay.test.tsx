// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7DVA6: a CRISPR guide row jumped to one span covering the spacer and its PAM together, so
 * Adaeze could not see which bases were the spacer she would order and which were the PAM the
 * nuclease only reads - and annotating the guide wrote that one span as a single feature.
 *
 * Clicking a row now highlights the guide in the linear base view and in the circular map with the
 * two parts apart, and Annotate writes a spacer feature and a PAM feature in one undoable step.
 *
 * Every number here comes from this launch's own engine (`scanCrisprGuides`) over documents built in
 * the test, and every expected span is found from the document's **bases** - the one plus-strand span
 * whose letters read as the row's spacer on the guide's own strand - never from the component's own
 * arithmetic. The App is the real App over the live DOM (the US-01M6TB6G harness), driven through its
 * own CRISPR tab, so a mechanism that reaches no row or no view fails here (LC-003).
 *
 * The fixtures are written so the engine finds a known, small set of candidates (asserted against
 * the scan's own `candidateCount`), and every row is found by the guide's id - never by its position
 * in the table (LC-002).
 *
 * Wrong implementations these kill:
 * - AC1: a highlight of the whole site with no parts; the spacer and the PAM drawn as one span; the
 *   top-ranked guide highlighted whatever row was clicked (the row clicked here is never the first);
 *   a highlight that reaches the studio but no view.
 * - AC2: the spacer of a reverse-strand guide read as the plus-strand letters, or as their
 *   complement instead of their reverse complement; the spacer span taken as `start..start+19` on a
 *   reverse guide (that is the PAM's first base and 19 of the spacer's).
 * - AC3: a guide across the origin (start > end) whose highlight is drawn from the lower coordinate
 *   to the higher one - the complementary arc, the long way round (BG-01M7CG2W, LC-018); the sector
 *   on the map measured as `end - start`.
 * - AC4: one feature spanning both parts; two features written as two undo steps (undo then leaves
 *   the PAM behind); the strand, the nuclease preset or the cut position left off the record.
 * - AC5: a click that writes the document - a feature added on selection, bases rewritten, a primer
 *   dropped.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrimerRecord, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

// Each criterion launches the App afresh, with the real WASM engine behind it.
vi.setConfig({ testTimeout: 90_000 });

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Documents built in the test ───

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
/** The reverse complement, as a reader of the other strand reads it 5'->3'. */
const rc = (s: string) => s.split('').reverse().map((c) => COMPLEMENT[c] ?? c).join('');
/** The complement without the reverse: the wrong reading of the other strand, which AC2 forbids. */
const complementOnly = (s: string) => s.split('').map((c) => COMPLEMENT[c] ?? c).join('');

/**
 * Filler bases that carry no G at all and no two C in a row, so they hold no SpCas9 PAM on either
 * strand (a plus-strand candidate needs GG, a reverse-strand one needs CC) and cannot make one at a
 * join: it begins and ends with A.
 */
const FILLER_UNIT = 'ATCATACTAATCTAACATTA';
const filler = (n: number) => FILLER_UNIT.repeat(Math.ceil(n / FILLER_UNIT.length)).slice(0, n);

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear',
  folder: 'Local', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z',
  features: [], primers: [], history: [],
};

const dnaDoc = (
  id: string,
  name: string,
  sequence: string,
  topology: 'linear' | 'circular',
  more: Partial<SequenceDocument> = {}
): SequenceDocument => ({ ...BLANK, id, name, accession: `MBC_${id}`, sequence, topology, ...more });

/** Three forward SpCas9 sites in a 300-bp circle: spacer then PAM, at 31, 131 and 211. */
const FWD_SITES = [
  { start: 31, spacer: 'ACGTATCAGTCAGTCATCAG', pam: 'AGG' },
  { start: 131, spacer: 'TTACGATCATCAGATCGATA', pam: 'TGG' },
  { start: 211, spacer: 'GCATCGATCGATCAGCATCG', pam: 'AGG' },
];
const PLASMID_LEN = 300;
const plasmidSeq = (() => {
  let seq = '';
  for (const site of FWD_SITES) {
    seq += filler(site.start - 1 - seq.length) + site.spacer + site.pam;
  }
  return seq + filler(PLASMID_LEN - seq.length);
})();

/** A primer record kept on the fixture, so AC5 can see it survive a click. */
const oligo = (id: string, name: string, sequence: string, bindStart: number): PrimerRecord => ({
  id, name, sequence, annealSequence: sequence, tail5Prime: '', bindStart, bindEnd: bindStart + sequence.length - 1,
  strand: 1, length: sequence.length, gcPercent: 40, tmAnnealC: 58, tmFullC: 58, deltaG37: -28,
  hairpinDeltaG: 0, selfDimerDeltaG: 0, gcClamp3Prime: false,
});

const PLASMID = dnaDoc('dva6-plasmid', 'pDVA6_Guides', plasmidSeq, 'circular', {
  features: [{ id: 'f-dva6-cds', name: 'DVA6_CDS', type: 'CDS', start: 61, end: 120, strand: 1, color: '#d93025' }],
  primers: [oligo('p-dva6', 'DVA6_Fwd', plasmidSeq.slice(0, 20), 1)],
});

/** One reverse-strand SpCas9 site in a 120-bp linear record: its PAM (CCA on the plus strand, TGG read on the minus) at 41..43, its spacer at 44..63. */
const REVERSE_SPACER_PLUS = 'TACGATCAGTTACGATCAGT';
const reverseSeq = `${filler(40)}CCA${REVERSE_SPACER_PLUS}${filler(57)}`;
const REVERSE_DOC = dnaDoc('dva6-reverse', 'pDVA6_Reverse', reverseSeq, 'linear');

/** One forward SpCas9 site across the origin of a 60-bp circle: 50..60 then 1..12. */
const ORIGIN_SITE = `${'TACGTTACGATCAGTTACGT'}AGG`;
const originSeq = `${ORIGIN_SITE.slice(11)}${filler(37)}${ORIGIN_SITE.slice(0, 11)}`;
const ORIGIN_DOC = dnaDoc('dva6-origin', 'pDVA6_Origin', originSeq, 'circular');

// ─── The engine's own answer, and the spans read from the bases ───

/** This launch's engine (loaded after the App, one module at a time, as the harness requires). */
async function engineGuides(doc: SequenceDocument) {
  const { scanCrisprGuides } = await import('../core/bioEngine');
  return scanCrisprGuides(doc.sequence, 'SpCas9 (NGG)', 25, doc.topology === 'circular');
}

/** 1-based positions of the interval `start..end`, in reading order, a circular wrap included. */
function positionsOf(start: number, end: number, length: number): number[] {
  const out: number[] = [];
  for (let p = start; ; p = (p % length) + 1) {
    out.push(p);
    if (p === end) break;
    if (out.length > length) throw new Error(`${start}..${end} never reaches its end on ${length} bases`);
  }
  return out;
}

/** The bases at `start..end` of the plus strand, read round the origin where it crosses. */
const basesAt = (sequence: string, start: number, end: number) =>
  positionsOf(start, end, sequence.length).map((p) => sequence[p - 1]).join('');

/**
 * The one span inside the guide's own site whose plus-strand bases read as `sub` on the guide's
 * strand: found from the document's bases alone, so it is not the component's arithmetic checked
 * against itself. Throws unless exactly one span of the site matches.
 */
function spanByBases(
  sequence: string,
  site: { start: number; end: number },
  sub: string,
  strand: 1 | -1
): { start: number; end: number } {
  const length = sequence.length;
  const sitePositions = positionsOf(site.start, site.end, length);
  const hits = sitePositions
    .slice(0, sitePositions.length - sub.length + 1)
    .map((start, i) => ({ start, end: sitePositions[i + sub.length - 1] }))
    .filter((span) => {
      const plus = basesAt(sequence, span.start, span.end);
      return (strand === 1 ? plus : rc(plus)) === sub;
    });
  if (hits.length !== 1) {
    throw new Error(`"${sub}" reads at ${hits.length} spans of the site ${site.start}..${site.end}, not one`);
  }
  return hits[0];
}

/** The spacer span and the PAM span of a guide, both read from the document's bases. */
function partsByBases(
  sequence: string,
  g: { start: number; end: number; strand: 1 | -1; spacerSeq: string; pamSeq: string }
) {
  const spacer = spanByBases(sequence, g, g.spacerSeq, g.strand);
  const pam = spanByBases(sequence, g, g.pamSeq, g.strand);
  return { spacer, pam };
}

// ─── Reading the App ───

const onCrisprTab = async (app: AppHarness, doc: SequenceDocument) => {
  await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'primers-pcr' });
  await app.menu('primers:crispr');
};

/** The guide table's row for `guideId`. */
const guideRow = (app: AppHarness, guideId: string): LiveElement =>
  app.one(`[data-crispr-guide-row="${guideId}"]`, `the guide row for ${guideId}`);

/** The guide ids the table lists, in the order it draws them. */
const listedGuideIds = (app: AppHarness) =>
  app.all('[data-crispr-guide-row]').map((r) => r.getAttribute('data-crispr-guide-row') ?? '');

/** The linear base view's guide ribbon: the attributes it states about the highlighted guide. */
function guideRibbon(app: AppHarness): Record<string, string | null> {
  const el = app.one('[data-guide-highlight]', 'the linear view guide ribbon');
  return {
    name: el.getAttribute('data-guide-highlight'),
    strand: el.getAttribute('data-guide-strand'),
    site: el.getAttribute('data-guide-site'),
    spacer: el.getAttribute('data-guide-spacer'),
    pam: el.getAttribute('data-guide-pam'),
    spacerBases: el.getAttribute('data-guide-spacer-bases'),
    pamBases: el.getAttribute('data-guide-pam-bases'),
    cut: el.getAttribute('data-guide-cut'),
    text: el.textContent.replace(/\s+/g, ' ').trim(),
  };
}

/** The 1-based positions the base rows mark as `part`, ascending. */
const markedBases = (app: AppHarness, part: 'spacer' | 'pam'): number[] =>
  app
    .all(`[data-pos][data-guide-part="${part}"]`)
    .map((el) => Number(el.getAttribute('data-pos')))
    .sort((a, b) => a - b);

/** The plus-strand letters the base rows draw at `positions`. */
const lettersAt = (app: AppHarness, positions: number[]): string =>
  positions.map((p) => app.one(`[data-pos="${p}"]`, `base ${p}`).textContent.trim()).join('');

/** The circular map's guide arcs for `part`: the span each states and the angles it is drawn at. */
const guideArcs = (app: AppHarness, part: 'spacer' | 'pam') =>
  app.all(`[data-guide-arc="${part}"]`).map((el) => ({
    span: el.getAttribute('data-guide-arc-span'),
    startAngle: Number(el.getAttribute('data-start-angle')),
    endAngle: Number(el.getAttribute('data-end-angle')),
    fill: el.getAttribute('fill'),
  }));

/** The active document as the App saves it (File > Save Session): its bases, features and primers. */
async function savedDocument(app: AppHarness, docId: string) {
  const before = app.downloads().length;
  await app.menu('file:save-session');
  const files = app.downloads();
  if (files.length !== before + 1) throw new Error(`File > Save Session saved ${files.length - before} files, not one`);
  const payload = JSON.parse(await files[files.length - 1].text()) as {
    documents: { id: string; sequence: string; features: unknown[]; primers: unknown[] }[];
  };
  const doc = payload.documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`the saved session holds no document "${docId}"`);
  return { sequence: doc.sequence, features: doc.features, primers: doc.primers };
}

// ─── The criteria ───

describe('CRISPR guide spacer and PAM overlay (US-01M7DVA6)', () => {
  it('US-01M7DVA6 AC1: clicking a guide row highlights that guide, spacer and PAM apart, in the base view and on the map', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineGuides(PLASMID);
      expect(scan.report?.candidateCount, 'the fixture holds the three planted sites and nothing else').toBe(3);
      const listed = listedGuideIds(app);
      expect(listed.length, 'all three guides are listed').toBe(3);

      // Never the first row: a highlight of the top-ranked guide would pass that one by luck.
      const clickedId = listed[listed.length - 1];
      const guide = scan.guides.find((g) => g.id === clickedId)!;
      expect(guide, `the engine's record for ${clickedId}`).toBeTruthy();
      const parts = partsByBases(PLASMID.sequence, guide);

      await app.click(guideRow(app, clickedId));
      expect(app.activeTab(), 'the click brings the sequence view forward').toBe('sequence-view');

      const ribbon = guideRibbon(app);
      expect(ribbon.name, 'the ribbon names the guide clicked').toBe(guide.name);
      expect(ribbon.site).toBe(`${guide.start}..${guide.end}`);
      expect(ribbon.spacer, 'the spacer span the row reports').toBe(`${parts.spacer.start}..${parts.spacer.end}`);
      expect(ribbon.pam, 'the PAM span the row reports').toBe(`${parts.pam.start}..${parts.pam.end}`);
      expect(ribbon.spacerBases).toBe(guide.spacerSeq);
      expect(ribbon.pamBases).toBe(guide.pamSeq);
      expect(ribbon.cut).toBe(String(guide.cutPosition));
      expect(ribbon.text, 'the ribbon says which part is which').toMatch(/spacer/i);
      expect(ribbon.text).toMatch(/PAM/);

      // The bases marked are exactly the guide's reported spacer and PAM coordinates, and the two
      // parts are marked apart: no base is both.
      const spacerPositions = positionsOf(parts.spacer.start, parts.spacer.end, PLASMID_LEN);
      const pamPositions = positionsOf(parts.pam.start, parts.pam.end, PLASMID_LEN);
      expect(markedBases(app, 'spacer')).toEqual([...spacerPositions].sort((a, b) => a - b));
      expect(markedBases(app, 'pam')).toEqual([...pamPositions].sort((a, b) => a - b));
      expect(lettersAt(app, spacerPositions), 'the bases drawn as the spacer').toBe(guide.spacerSeq);
      expect(lettersAt(app, pamPositions), 'the bases drawn as the PAM').toBe(guide.pamSeq);

      // The map draws the same two spans as its own arcs, each distinguishable from the other.
      const spacerArcs = guideArcs(app, 'spacer');
      const pamArcs = guideArcs(app, 'pam');
      expect(spacerArcs.map((a) => a.span)).toEqual([`${parts.spacer.start}..${parts.spacer.end}`]);
      expect(pamArcs.map((a) => a.span)).toEqual([`${parts.pam.start}..${parts.pam.end}`]);
      expect(spacerArcs[0].fill, 'the spacer and the PAM are not drawn in one colour').not.toBe(pamArcs[0].fill);
      const degPerBase = 360 / PLASMID_LEN;
      expect(spacerArcs[0].endAngle - spacerArcs[0].startAngle).toBeCloseTo(20 * degPerBase, 6);
      expect(pamArcs[0].endAngle - pamArcs[0].startAngle).toBeCloseTo(3 * degPerBase, 6);
    });
  });

  it('US-01M7DVA6 AC2: a reverse-strand guide is highlighted at the plus-strand coordinates the row reports, and its spacer reads 5\'->3\' on its own strand', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, REVERSE_DOC);
      const scan = await engineGuides(REVERSE_DOC);
      expect(scan.report?.candidateCount, 'the fixture holds one reverse-strand site and nothing else').toBe(1);
      const guide = scan.guides[0];
      expect(guide.strand, 'the planted site is on the reverse strand').toBe(-1);
      const parts = partsByBases(REVERSE_DOC.sequence, guide);
      // The site opens with the PAM in plus-strand order, so start..start+19 is not the spacer.
      expect(parts.pam.start).toBe(guide.start);
      expect(parts.spacer.start).toBe(guide.start + 3);

      await app.click(guideRow(app, guide.id));

      const ribbon = guideRibbon(app);
      expect(ribbon.strand).toBe('-1');
      expect(ribbon.spacer, 'the plus-strand coordinates of the spacer').toBe(`${parts.spacer.start}..${parts.spacer.end}`);
      expect(ribbon.pam).toBe(`${parts.pam.start}..${parts.pam.end}`);
      // Read on the guide's own strand: the reverse complement of the plus-strand letters, never
      // the plus letters and never their complement alone.
      const plusSpacer = basesAt(REVERSE_DOC.sequence, parts.spacer.start, parts.spacer.end);
      expect(ribbon.spacerBases, "the spacer as the row reports it, 5'->3' on the guide's strand").toBe(guide.spacerSeq);
      expect(guide.spacerSeq).toBe(rc(plusSpacer));
      expect(ribbon.spacerBases).not.toBe(plusSpacer);
      expect(ribbon.spacerBases).not.toBe(complementOnly(plusSpacer));
      expect(ribbon.pamBases).toBe(guide.pamSeq);
      expect(guide.pamSeq).toBe(rc(basesAt(REVERSE_DOC.sequence, parts.pam.start, parts.pam.end)));

      const spacerPositions = positionsOf(parts.spacer.start, parts.spacer.end, REVERSE_DOC.sequence.length);
      const pamPositions = positionsOf(parts.pam.start, parts.pam.end, REVERSE_DOC.sequence.length);
      expect(markedBases(app, 'spacer')).toEqual(spacerPositions);
      expect(markedBases(app, 'pam')).toEqual(pamPositions);
      // The bases shown at those positions are the plus strand's own letters, and they read as the
      // row's spacer on the guide's strand.
      expect(rc(lettersAt(app, spacerPositions))).toBe(guide.spacerSeq);
    });
  });

  it('US-01M7DVA6 AC3: a guide across the origin is highlighted on both arcs, never the long way round', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, ORIGIN_DOC);
      const scan = await engineGuides(ORIGIN_DOC);
      expect(scan.report?.candidateCount, 'the fixture holds one site, across the origin').toBe(1);
      const guide = scan.guides[0];
      expect(guide.start, 'the site runs from a start past its end').toBeGreaterThan(guide.end);
      const len = ORIGIN_DOC.sequence.length;
      const parts = partsByBases(ORIGIN_DOC.sequence, guide);

      await app.click(guideRow(app, guide.id));

      const ribbon = guideRibbon(app);
      expect(ribbon.site).toBe(`${guide.start}..${guide.end}`);
      expect(ribbon.spacer).toBe(`${parts.spacer.start}..${parts.spacer.end}`);
      expect(ribbon.pam).toBe(`${parts.pam.start}..${parts.pam.end}`);
      expect(ribbon.spacerBases, 'the spacer read across the origin, not the arc between its ends').toBe(guide.spacerSeq);
      expect(ribbon.spacerBases!.length).toBe(20);

      // Both arcs of the spacer are marked - the end of the molecule and then its start - and not
      // one base of the complementary arc between them.
      const spacerPositions = positionsOf(parts.spacer.start, parts.spacer.end, len);
      const pamPositions = positionsOf(parts.pam.start, parts.pam.end, len);
      expect(spacerPositions.some((p) => p >= parts.spacer.start), 'bases before the origin').toBe(true);
      expect(spacerPositions.some((p) => p <= parts.spacer.end), 'bases after the origin').toBe(true);
      expect(markedBases(app, 'spacer')).toEqual([...spacerPositions].sort((a, b) => a - b));
      expect(markedBases(app, 'pam')).toEqual([...pamPositions].sort((a, b) => a - b));
      const complementaryArc = positionsOf(parts.spacer.end + 1, parts.spacer.start - 1, len);
      expect(markedBases(app, 'spacer').filter((p) => complementaryArc.includes(p)), 'no base of the complementary arc').toEqual([]);
      expect(lettersAt(app, spacerPositions)).toBe(guide.spacerSeq);

      // The map's own arcs: 20 bases of spacer and 3 of PAM, measured round the origin, not
      // `end - start` (which on this guide is negative).
      const degPerBase = 360 / len;
      const spacerArc = guideArcs(app, 'spacer');
      const pamArc = guideArcs(app, 'pam');
      expect(spacerArc.length, 'one sector for the spacer').toBe(1);
      expect(spacerArc[0].endAngle - spacerArc[0].startAngle).toBeCloseTo(20 * degPerBase, 6);
      expect(spacerArc[0].endAngle, 'the spacer sector runs past twelve o\'clock').toBeGreaterThan(360);
      expect(pamArc[0].endAngle - pamArc[0].startAngle).toBeCloseTo(3 * degPerBase, 6);
    });
  });

  it('US-01M7DVA6 AC4: annotating records the spacer span and the PAM span in one undoable step', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, REVERSE_DOC);
      const scan = await engineGuides(REVERSE_DOC);
      const guide = scan.guides[0];
      const parts = partsByBases(REVERSE_DOC.sequence, guide);
      const before = await savedDocument(app, REVERSE_DOC.id);
      expect(before.features, 'the fixture starts with no annotation').toEqual([]);

      await app.click(app.one(`[data-crispr-annotate="${guide.id}"]`, `the Annotate button for ${guide.id}`));

      const during = await savedDocument(app, REVERSE_DOC.id);
      expect(during.sequence, 'annotating rewrites no base').toBe(before.sequence);
      const added = during.features as {
        name: string; type: string; start: number; end: number; strand: number;
        notes?: string; qualifiers?: Record<string, string>;
      }[];
      expect(added.length, 'a spacer feature and a PAM feature').toBe(2);
      const spacerFeat = added.find((f) => /spacer/i.test(f.name))!;
      const pamFeat = added.find((f) => /PAM/.test(f.name))!;
      expect(spacerFeat, 'the spacer annotation').toBeTruthy();
      expect(pamFeat, 'the PAM annotation').toBeTruthy();
      expect([spacerFeat.start, spacerFeat.end]).toEqual([parts.spacer.start, parts.spacer.end]);
      expect([pamFeat.start, pamFeat.end]).toEqual([parts.pam.start, parts.pam.end]);
      for (const f of [spacerFeat, pamFeat]) {
        expect(f.strand, `${f.name} carries the guide's strand`).toBe(guide.strand);
        expect(`${f.notes ?? ''} ${Object.values(f.qualifiers ?? {}).join(' ')}`, `${f.name} names the nuclease preset`).toContain(guide.nuclease);
        expect(`${f.notes ?? ''} ${Object.values(f.qualifiers ?? {}).join(' ')}`, `${f.name} names the cut position`).toContain(String(guide.cutPosition));
      }
      expect(spacerFeat.name).toContain(guide.name);
      expect(pamFeat.name).toContain(guide.pamSeq);

      // One step: a single undo takes both annotations away and leaves the bases as they were.
      await app.menu('edit:undo');
      const after = await savedDocument(app, REVERSE_DOC.id);
      expect(after.features, 'undo removes exactly those two annotations').toEqual([]);
      expect(after.sequence, 'the bases are identical before, during and after').toBe(before.sequence);
      expect(after.primers).toEqual(before.primers);
    });
  });

  it('US-01M7DVA6 AC5: clicking a row never changes the document', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineGuides(PLASMID);
      const before = await savedDocument(app, PLASMID.id);
      expect(before.features.length, 'the fixture carries an annotation and a primer to lose').toBe(1);
      expect(before.primers.length).toBe(1);

      const listed = listedGuideIds(app);
      const clickedId = listed[listed.length - 1];
      await app.click(guideRow(app, clickedId));
      // The highlight is shown, so the click did reach the view, with no annotation action taken.
      expect(guideRibbon(app).name).toBe(scan.guides.find((g) => g.id === clickedId)!.name);

      const afterClick = await savedDocument(app, PLASMID.id);
      expect(afterClick, 'the bases, features and primers after a click').toEqual(before);

      await app.menu('primers:crispr');
      await app.clickTab('sequence-view');
      const afterSwitch = await savedDocument(app, PLASMID.id);
      expect(afterSwitch, 'the bases, features and primers after a view switch').toEqual(before);
    });
  });
});

/**
 * BG-01M7EQAA AC2 and AC3: `+ Annotate Top 5 Guides` wrote one feature per guide spanning the
 * spacer and its PAM together, so one document could hold two shapes of `crispr_guide` annotation
 * depending on which button was pressed, and a downstream reader could not tell a whole-site
 * annotation from a spacer-only one without inspecting its span. Both buttons now write the same two
 * features per guide, through `crisprGuideParts`.
 *
 * Wrong implementations these kill:
 * - AC2: the one-feature-per-guide shape; a Top 5 pair that agrees with the single-guide button but
 *   not with the document's bases (every span and name here is asserted against the bases too, not
 *   only against the other button, which two callers of one helper agree on by construction); a
 *   qualifier left off the Top 5 pair; a pair written for only the first of the guides.
 * - AC3: either feature intersected with the interval searched, which clips the PAM of a guide whose
 *   spacer is inside the selection and whose PAM is not (the selection here ends at the spacer's
 *   last base, so a clipped PAM is 3 bases short, empty or clamped to the bound).
 */

/** One forward SpCas9 site at 41..63 of a 240-bp line: spacer 41..60, PAM 61..63, nothing else. */
const EDGE_SITE = { start: 41, spacer: 'TTACGATCATCAGATCGATA', pam: 'TGG' };
const edgeSeq = `${filler(40)}${EDGE_SITE.spacer}${EDGE_SITE.pam}${filler(177)}`;
const EDGE_DOC = dnaDoc('eqaa-edge', 'pEQAA_Edge', edgeSeq, 'linear');
/** The selection that holds the whole spacer and not one base of its PAM. */
const EDGE_SELECTION = { start: 1, end: 60 };

/** The CRISPR tab on `doc`, with `selectedRange` held as the App holds a selection. */
const onCrisprTabWithSelection = async (
  app: AppHarness,
  doc: SequenceDocument,
  selectedRange: { start: number; end: number }
) => {
  await app.restoreSession({
    documents: [doc],
    activeDocId: doc.id,
    viewerTab: 'primers-pcr',
    workspace: { selectedRange: { label: 'Selection', ...selectedRange } },
  });
  await app.menu('primers:crispr');
};

/** This launch's engine over `interval` alone, as the tab asks it when a span is selected. */
async function engineGuidesIn(doc: SequenceDocument, interval: { start: number; end: number }) {
  const { scanCrisprGuides } = await import('../core/bioEngine');
  return scanCrisprGuides(doc.sequence, 'SpCas9 (NGG)', 25, doc.topology === 'circular', interval);
}

/** Presses the tab's own `+ Annotate Top 5 Guides` button. */
async function annotateTop5(app: AppHarness): Promise<void> {
  const buttons = app
    .all('button')
    .filter((b) => b.textContent.replace(/\s+/g, ' ').includes('+ Annotate Top 5 Guides'));
  if (buttons.length !== 1) {
    throw new Error(`the CRISPR tab shows ${buttons.length} "+ Annotate Top 5 Guides" buttons, not one`);
  }
  await app.click(buttons[0]);
}

/** An annotation as a downstream reader of the document reads it: everything but its id. */
type WrittenFeature = {
  id: string; name: string; type: string; start: number; end: number; strand: number;
  color?: string; notes?: string; qualifiers?: Record<string, string>;
};
const withoutId = (f: WrittenFeature) => {
  const { id: _id, ...rest } = f;
  return rest;
};

describe('CRISPR Top 5 annotation shape (BG-01M7EQAA)', () => {
  it('BG-01M7EQAA AC2: Annotate Top 5 writes the same annotation shape as the single-guide button', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineGuides(PLASMID);
      const listed = listedGuideIds(app);
      expect(listed.length, 'the fixture lists its three guides').toBe(3);
      // Never the first row: a pair written for the top-ranked guide alone would pass that by luck.
      const guide = scan.guides.find((g) => g.id === listed[listed.length - 1])!;
      expect(guide, 'the engine\'s record for the row driven').toBeTruthy();
      const parts = partsByBases(PLASMID.sequence, guide);
      const fixtureFeatures = (await savedDocument(app, PLASMID.id)).features as WrittenFeature[];
      expect(fixtureFeatures.length, 'the fixture carries its one CDS annotation').toBe(1);

      // The single-guide button's pair for that guide.
      await app.click(app.one(`[data-crispr-annotate="${guide.id}"]`, `the Annotate button for ${guide.id}`));
      const single = ((await savedDocument(app, PLASMID.id)).features as WrittenFeature[]).filter(
        (f) => f.type === 'crispr_guide'
      );
      expect(single.length, 'one guide, annotated as its spacer and its PAM').toBe(2);
      await app.menu('edit:undo');
      expect(((await savedDocument(app, PLASMID.id)).features as WrittenFeature[]).length, 'undone').toBe(1);

      // The Top 5 button's pairs: two features per guide listed, none of them the old whole-site one.
      await annotateTop5(app);
      const top = ((await savedDocument(app, PLASMID.id)).features as WrittenFeature[]).filter(
        (f) => f.type === 'crispr_guide'
      );
      expect(top.length, 'a spacer feature and a PAM feature for each of the guides').toBe(
        2 * Math.min(5, listed.length)
      );
      for (const g of scan.guides.slice(0, 5)) {
        const pair = top.filter((f) => f.qualifiers?.guide_name === g.name);
        expect(pair.length, `${g.name} is annotated as two features`).toBe(2);
        expect(pair.map((f) => f.qualifiers?.guide_part).sort()).toEqual(['PAM', 'spacer']);
      }

      // The shape itself, read from the document's bases - not only from the other button, which
      // two callers of one helper agree with by construction.
      const spacerFeat = top.find((f) => f.qualifiers?.guide_name === guide.name && f.qualifiers?.guide_part === 'spacer')!;
      const pamFeat = top.find((f) => f.qualifiers?.guide_name === guide.name && f.qualifiers?.guide_part === 'PAM')!;
      expect(spacerFeat.name).toBe(`${guide.name} spacer`);
      expect(pamFeat.name).toBe(`${guide.name} PAM (${guide.pamSeq})`);
      expect([spacerFeat.start, spacerFeat.end]).toEqual([parts.spacer.start, parts.spacer.end]);
      expect([pamFeat.start, pamFeat.end]).toEqual([parts.pam.start, parts.pam.end]);
      for (const f of [spacerFeat, pamFeat]) {
        expect(f.strand, `${f.name} carries the guide's strand`).toBe(guide.strand);
        expect(f.qualifiers, `${f.name} carries the guide's qualifiers`).toMatchObject({
          guide_name: guide.name,
          nuclease: guide.nuclease,
          pam_side: guide.pamSide,
          spacer_span: `${parts.spacer.start}..${parts.spacer.end}`,
          pam_span: `${parts.pam.start}..${parts.pam.end}`,
          cut_position: String(guide.cutPosition),
        });
      }

      // And the two buttons agree, down to every field but the feature's own id.
      const sortByName = (fs: WrittenFeature[]) => [...fs].sort((a, b) => a.name.localeCompare(b.name));
      expect(
        sortByName(top.filter((f) => f.qualifiers?.guide_name === guide.name)).map(withoutId),
        'the two buttons write one shape for the same guide'
      ).toEqual(sortByName(single).map(withoutId));
    });
  });

  it('BG-01M7EQAA AC3: a guide whose PAM lies outside the selection is annotated over its whole site', async () => {
    await withApp(async (app) => {
      await onCrisprTabWithSelection(app, EDGE_DOC, EDGE_SELECTION);
      const scan = await engineGuidesIn(EDGE_DOC, EDGE_SELECTION);
      expect(scan.report?.searchedInterval?.end, 'the scan read the selected span').toBe(EDGE_SELECTION.end);
      expect(scan.guides.length, 'the span holds the planted site and nothing else').toBe(1);
      const guide = scan.guides[0];
      const parts = partsByBases(EDGE_DOC.sequence, guide);
      expect(parts.spacer.end, 'the spacer ends on the selection\'s last base').toBe(EDGE_SELECTION.end);
      expect(parts.pam.start, 'the PAM lies outside the selection').toBeGreaterThan(EDGE_SELECTION.end);

      await annotateTop5(app);
      const written = ((await savedDocument(app, EDGE_DOC.id)).features as WrittenFeature[]).filter(
        (f) => f.type === 'crispr_guide'
      );
      const spacerFeat = written.find((f) => f.qualifiers?.guide_part === 'spacer')!;
      const pamFeat = written.find((f) => f.qualifiers?.guide_part === 'PAM')!;
      expect(spacerFeat, 'the spacer annotation').toBeTruthy();
      expect(pamFeat, 'the PAM annotation').toBeTruthy();
      // Neither feature is clipped to the interval searched: the PAM is written where it is.
      expect([pamFeat.start, pamFeat.end], 'the PAM is annotated past the selection, whole').toEqual([
        parts.pam.start,
        parts.pam.end,
      ]);
      expect(pamFeat.end, 'the PAM feature extends past the selection').toBeGreaterThan(EDGE_SELECTION.end);
      expect(pamFeat.end - pamFeat.start + 1, 'all of the PAM is annotated').toBe(guide.pamSeq.length);
      expect([spacerFeat.start, spacerFeat.end]).toEqual([parts.spacer.start, parts.spacer.end]);
      expect(pamFeat.qualifiers?.pam_span).toBe(`${parts.pam.start}..${parts.pam.end}`);

      // The row's own Annotate is held to the same site, so neither writer may clip it.
      await app.menu('edit:undo');
      await app.click(app.one(`[data-crispr-annotate="${guide.id}"]`, `the Annotate button for ${guide.id}`));
      const fromRow = ((await savedDocument(app, EDGE_DOC.id)).features as WrittenFeature[]).filter(
        (f) => f.type === 'crispr_guide'
      );
      const rowPam = fromRow.find((f) => f.qualifiers?.guide_part === 'PAM')!;
      expect([rowPam.start, rowPam.end]).toEqual([parts.pam.start, parts.pam.end]);
    });
  });
});

/**
 * BG01M7EXRW: two guards over this overlay held less than they appeared to, and one id source was
 * no source of uniqueness at all.
 *
 * - AC1: `crisprGuideParts` takes each part's length from the record's own `spacerSeq`/`pamSeq`,
 *   which is right - but hard-coding `spacerLen = 20; pamLen = 3` passed every criterion above and
 *   the whole frontend suite, because nothing here exercised a 5'-PAM nuclease. The cases below do,
 *   on both strands, and assert each span against the record's own lengths.
 * - AC2: "a staggered second cut with no position stays absent rather than being drawn as 0" was
 *   true by reading and exercised by no test, because only a staggered cutter reaches it.
 * - AC3: both features of an annotation took `feat-<guide>-<part>-${Date.now()}`, so annotating one
 *   guide twice inside a millisecond wrote two features with one id.
 *
 * Wrong implementations these kill:
 * - AC1: `spacerLen = 20` / `pamLen = 3` in place of the record's lengths. A 5'-PAM record is where
 *   that bites: on the forward strand the spacer is placed `pamLen` past the site's first base, so
 *   it opens and closes one base early and reads the wrong letters, and the PAM comes out 3 bases
 *   long instead of 4; on the reverse strand the spacer happens to survive (Cas12a's spacer is 20
 *   too), and the PAM alone is a base short. Both cases are asserted, so neither carries the
 *   criterion alone. Also killed: the PAM-leads rule read off the strand alone or off the PAM side
 *   alone (either swaps one of the two cases); a 23-nt spacer measured as 20.
 * - AC2: `data-guide-cut-target` given `?? 0` or any fallback, so an absent second cut is drawn at
 *   base 0; the conditional spread in `crisprGuideHighlight` made unconditional, which puts the key
 *   on the record the views are handed; a ribbon that is simply missing (the primary cut and the
 *   note are both asserted present here, and a guide that does have a second cut is asserted to
 *   write the attribute, so absence is never read off an empty page - LC-006).
 * - AC3: `Date.now()` as the only source of uniqueness (the clock is held at one value here, so a
 *   timestamp cannot tell the two annotations apart); a serial shared by both annotations.
 */

/** The engine's only 5'-PAM preset, as its chooser names it: a 4-nt PAM, where SpCas9's is 3. */
const CAS12A = 'Cas12a / Cpf1 (TTTV)';

/**
 * A 128-bp line holding exactly two Cas12a sites and nothing else - the filler carries no `TTT` and
 * no `AAA`, so it holds no `TTTV` on either strand:
 * - one reverse-strand site at 41..64: its spacer on the plus strand at 41..60, its PAM `CAAA` at
 *   61..64 (read `TTTG` on the minus strand, 5' of the spacer);
 * - one forward-strand site at 105..128, flush with the last base: its PAM `TTTG` at 105..108 and
 *   its spacer at 109..128. Flush is what AC2 needs: Cas12a's target-strand cut falls 3 bases past
 *   the site's end, which on a record read straight is past the last base, so the engine withholds
 *   its position and says why.
 */
const CAS12A_REVERSE_SITE = `${'TTACGATCATCAGATCGATA'}CAAA`;
const CAS12A_FORWARD_SITE = `TTTG${'ACGTATCAGTCAGTCATCAG'}`;
const cas12aSeq = `${filler(40)}${CAS12A_REVERSE_SITE}${filler(40)}${CAS12A_FORWARD_SITE}`;
const CAS12A_DOC = dnaDoc('exrw-cas12a', 'pEXRW_Cas12a', cas12aSeq, 'linear');

/** This launch's engine over the fixture, asked for the same preset the tab is set to. */
async function cas12aGuides(doc: SequenceDocument) {
  const { scanCrisprGuides } = await import('../core/bioEngine');
  return scanCrisprGuides(doc.sequence, CAS12A, 25, doc.topology === 'circular');
}

/** The CRISPR tab on `doc`, with the nuclease chooser set to Cas12a through its own select. */
const onCas12aTab = async (app: AppHarness, doc: SequenceDocument) => {
  await onCrisprTab(app, doc);
  await app.change(app.one('select[aria-label="Nuclease / PAM:"]', 'the nuclease chooser'), CAS12A);
  await app.settle();
  expect(
    app.one(`[data-nuclease-facts]`, 'the chosen preset\'s facts').getAttribute('data-nuclease-facts'),
    'the tab is scanning for the 5\'-PAM preset'
  ).toBe(CAS12A);
};

/**
 * The Cas12a scan opened afresh and `guideId`'s row clicked: the linear view's ribbon for it.
 * Showing a guide jumps to the sequence view, so each guide is shown from its own scan rather than
 * from whatever the last click left on screen.
 */
const showCas12aGuide = async (app: AppHarness, guideId: string): Promise<LiveElement> => {
  await onCas12aTab(app, CAS12A_DOC);
  await app.click(guideRow(app, guideId));
  return app.one('[data-guide-highlight]', 'the linear view guide ribbon');
};

/** The bases a span covers, counting both bounds and a wrap of the origin. */
const spanLength = (span: { start: number; end: number }, length: number) =>
  positionsOf(span.start, span.end, length).length;

/** `start..end` as the ribbon and the arcs write it. */
const spanText = (span: { start: number; end: number }) => `${span.start}..${span.end}`;

describe('CRISPR guide parts, a withheld second cut and annotation ids (BG01M7EXRW)', () => {
  it("BG01M7EXRW AC1: a Cas12a guide's parts are spanned from the record's own lengths", async () => {
    // Part 1: the shipped surface, on both strands, for the engine's own 5'-PAM preset.
    await withApp(async (app) => {
      await onCas12aTab(app, CAS12A_DOC);
      const scan = await cas12aGuides(CAS12A_DOC);
      expect(scan.report?.candidateCount, 'the fixture holds its two planted sites and nothing else').toBe(2);
      const listed = listedGuideIds(app);
      expect(listed.length, 'the tab lists both of them').toBe(2);

      const byStrand = (strand: 1 | -1) => {
        const hits = scan.guides.filter((g) => g.strand === strand && listed.includes(g.id));
        expect(hits.length, `one listed ${strand === 1 ? 'forward' : 'reverse'} Cas12a guide`).toBe(1);
        return hits[0];
      };

      for (const strand of [1, -1] as const) {
        const g = byStrand(strand);
        const where = `${g.name} (${strand === 1 ? 'forward' : 'reverse'})`;
        // The record's own lengths, which are not SpCas9's: a 4-nt PAM.
        expect(g.pamSeq.length, `${where}: the record's PAM is 4 nt, not 3`).toBe(4);
        expect(g.spacerSeq.length, `${where}: the record's spacer`).toBe(
          scan.guides[0].spacerSeq.length
        );

        // The spans read from the document's own bases, independent of the component's arithmetic.
        const parts = partsByBases(CAS12A_DOC.sequence, g);
        await showCas12aGuide(app, g.id);
        const ribbon = guideRibbon(app);
        expect(ribbon.name, `${where} is the guide highlighted`).toBe(g.name);
        expect(ribbon.spacer, `${where}: the spacer span drawn`).toBe(spanText(parts.spacer));
        expect(ribbon.pam, `${where}: the PAM span drawn`).toBe(spanText(parts.pam));
        // And each drawn span is exactly as long as the record's own part, never a constant.
        expect(
          spanLength({ start: Number(ribbon.spacer!.split('..')[0]), end: Number(ribbon.spacer!.split('..')[1]) }, CAS12A_DOC.sequence.length),
          `${where}: the spacer drawn is ${g.spacerSeq.length} bases, the record's own spacer length`
        ).toBe(g.spacerSeq.length);
        expect(
          spanLength({ start: Number(ribbon.pam!.split('..')[0]), end: Number(ribbon.pam!.split('..')[1]) }, CAS12A_DOC.sequence.length),
          `${where}: the PAM drawn is ${g.pamSeq.length} bases, the record's own PAM length`
        ).toBe(g.pamSeq.length);
        // The letters drawn as each part are the record's own, on the guide's strand.
        expect(ribbon.spacerBases, `${where}: the letters marked as the spacer`).toBe(g.spacerSeq);
        expect(ribbon.pamBases, `${where}: the letters marked as the PAM`).toBe(g.pamSeq);
      }
    });

    // Part 2: a 5'-PAM nuclease whose spacer is 23 nt and whose PAM is 4. No preset the engine
    // offers has a 23-nt spacer (Cas12a's is 20, and SpCas9's is 20 with a 3-nt PAM), so this
    // length can only be put through `crisprGuideParts` as a record - which is the unit AC1 names,
    // and the one place a hard-coded 20 would be read.
    const { crisprGuideParts } = await import('../components/PrimerAndPCRStudio');
    const LEN = 400;
    for (const strand of [1, -1] as const) {
      const g = {
        start: 10,
        end: 36,
        strand,
        spacerSeq: 'ACGTACGTACGTACGTACGTACG', // 23 nt
        pamSeq: 'TTTA', // 4 nt
        pamSide: "5'",
      };
      expect([g.spacerSeq.length, g.pamSeq.length], 'the record this case asserts against').toEqual([23, 4]);
      const parts = crisprGuideParts(g, LEN);
      expect(
        spanLength(parts.spacer, LEN),
        `a ${g.spacerSeq.length}-nt spacer on the ${strand === 1 ? 'forward' : 'reverse'} strand spans its own length`
      ).toBe(g.spacerSeq.length);
      expect(
        spanLength(parts.pam, LEN),
        `a ${g.pamSeq.length}-nt PAM on the ${strand === 1 ? 'forward' : 'reverse'} strand spans its own length`
      ).toBe(g.pamSeq.length);
      // The two parts tile the site, in the order a 5'-PAM nuclease puts them in on that strand:
      // the PAM leads the plus-strand site of a forward guide and trails it on a reverse one.
      const leading = strand === 1 ? parts.pam : parts.spacer;
      const trailing = strand === 1 ? parts.spacer : parts.pam;
      expect([leading.start, trailing.end], 'the two parts cover the whole site').toEqual([g.start, g.end]);
      expect(trailing.start, 'and meet with no gap and no overlap').toBe(leading.end + 1);
    }
  });

  it('BG01M7EXRW AC2: a withheld staggered second cut is drawn nowhere', async () => {
    await withApp(async (app) => {
      await onCas12aTab(app, CAS12A_DOC);
      const scan = await cas12aGuides(CAS12A_DOC);
      const withheld = scan.guides.find((g) => g.strand === 1)!;
      const held = scan.guides.find((g) => g.strand === -1)!;
      // The case is reached: the engine really does withhold this guide's second cut, and says why.
      expect(withheld, 'the forward guide flush with the last base').toBeTruthy();
      expect(withheld.cutPositionTargetStrand, 'its target-strand cut has no position').toBeUndefined();
      expect(withheld.cutPositionTargetStrandNote, 'and the engine says why').toBeTruthy();
      // And the contrast is reachable, so an absent attribute is not absent for want of a case.
      expect(held.cutPositionTargetStrand, 'the reverse guide does have a second cut').toEqual(
        expect.any(Number)
      );

      const ribbon = await showCas12aGuide(app, withheld.id);
      expect(ribbon.getAttribute('data-guide-highlight')).toBe(withheld.name);
      // The attribute is not written at all - not written with the value 0, or '', or 'undefined'.
      expect(
        ribbon.hasAttribute('data-guide-cut-target'),
        'no target-strand cut attribute is written for a cut that has no position'
      ).toBe(false);
      expect(
        ribbon.getAttributeNames().filter((n) => n === 'data-guide-cut-target'),
        'and none under that name at all'
      ).toEqual([]);
      // The ribbon is there and says what it does know: the reported cut, and why the second is absent.
      expect(ribbon.getAttribute('data-guide-cut'), 'the reported cut is still drawn').toBe(
        String(withheld.cutPosition)
      );
      expect(ribbon.getAttribute('data-guide-cut-target-note'), 'with the engine\'s own reason beside it').toBe(
        withheld.cutPositionTargetStrandNote
      );
      expect(ribbon.textContent.replace(/\s+/g, ' '), 'and the words say it too').toContain(
        `target strand: ${withheld.cutPositionTargetStrandNote}`
      );

      // The guide that has a second cut writes it, so the assertion above is about this case alone.
      const second = await showCas12aGuide(app, held.id);
      expect(second.getAttribute('data-guide-cut-target'), 'a second cut that has a position is drawn').toBe(
        String(held.cutPositionTargetStrand)
      );
      expect(second.hasAttribute('data-guide-cut-target-note'), 'and then carries no reason').toBe(false);

      // The record the views are handed carries no key for the absent cut either, so the absence
      // cannot be reintroduced one layer up by spreading it unconditionally.
      const { crisprGuideHighlight } = await import('../components/PrimerAndPCRStudio');
      const highlight = crisprGuideHighlight(withheld, CAS12A_DOC.sequence.length);
      expect(
        Object.prototype.hasOwnProperty.call(highlight, 'cutPositionTargetStrand'),
        'the highlight handed to the views has no target-strand cut key'
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(
          crisprGuideHighlight(held, CAS12A_DOC.sequence.length),
          'cutPositionTargetStrand'
        ),
        'and does carry it for the guide that has one'
      ).toBe(true);
    });
  });

  it('BG01M7EXRW AC3: annotating one guide twice in the same millisecond gives distinct ids', async () => {
    await withApp(async (app) => {
      await onCrisprTab(app, PLASMID);
      const scan = await engineGuides(PLASMID);
      const listed = listedGuideIds(app);
      // Never the first row: ids that collide only for the top-ranked guide would pass that by luck.
      const guide = scan.guides.find((g) => g.id === listed[listed.length - 1])!;
      const parts = partsByBases(PLASMID.sequence, guide);

      // One clock reading for both annotations, so a timestamp cannot tell them apart.
      const FROZEN = 1_763_200_000_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(FROZEN);
      try {
        const annotate = () =>
          app.click(app.one(`[data-crispr-annotate="${guide.id}"]`, `the Annotate button for ${guide.id}`));
        await annotate();
        await annotate();
        expect(new Set(clock.mock.results.map((r) => r.value)), 'the clock read one value throughout').toEqual(
          new Set([FROZEN])
        );
      } finally {
        clock.mockRestore();
      }

      const written = ((await savedDocument(app, PLASMID.id)).features as WrittenFeature[]).filter(
        (f) => f.type === 'crispr_guide'
      );
      // Both annotations landed: two features each, the same guide twice over.
      expect(written.length, 'the guide is annotated twice, as its spacer and its PAM each time').toBe(4);
      expect(written.filter((f) => f.qualifiers?.guide_part === 'spacer').length).toBe(2);
      expect(written.filter((f) => f.qualifiers?.guide_part === 'PAM').length).toBe(2);
      for (const f of written) {
        expect(f.qualifiers?.guide_name, 'every one of them is this guide').toBe(guide.name);
      }
      // The spans are the same annotation twice, not two different guides smuggled in.
      for (const f of written.filter((f) => f.qualifiers?.guide_part === 'spacer')) {
        expect([f.start, f.end]).toEqual([parts.spacer.start, parts.spacer.end]);
      }
      // And no two features share an id.
      const ids = written.map((f) => f.id);
      expect(new Set(ids).size, `four distinct feature ids, not ${ids.join(', ')}`).toBe(4);
    });
  });
});
