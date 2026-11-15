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
