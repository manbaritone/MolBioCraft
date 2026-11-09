// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TAAR: the Cloning studio's settings in App's shared inspector. A Reaction Enzymes section
 * holds the 5' and 3' restriction enzymes with their buffer-compatibility line (Restriction
 * Ligation, Gibson, In-Fusion, HiFi) or the Type IIS enzyme with its overhang check (Golden Gate);
 * a Gel & Digest section holds the MW ladder, agarose, buffer, stain and the digest enzyme chips of
 * the Virtual Gel & Digest tool. The method strip, the vector, the insert, Simulate and the
 * Mutagenesis, Anneal Oligos and DNA Calculations inputs stay in the canvas's controls column, and a
 * method and tool with nothing to set leave App's header without the inspector button.
 *
 * Every check mounts the real App over the live DOM (the US-01M6TB6G harness), restores a plasmid
 * built here on the Cloning tab, and reads App's own header button, pane title and
 * aside.mbc-right-controls. A setting is driven by editing it in that column; the gel's bands and
 * the fragments table are compared with this launch's engine called with the values the test chose,
 * never with what the studio shows.
 *
 * Wrong implementations these checks fail: a setting left in the canvas, or drawn in both places; a
 * section under the wrong title or out of order; the enzymes shown for a method that has none (or
 * missing for one that has them); a moved control no longer wired to its result (the gel not
 * redrawn for a chip, a ladder or an agarose set in the inspector, or redrawn from the old value);
 * the digest chips moved but the fragments table left on the old digest; a button offered where
 * there is nothing to set, or withheld where there is; and a menu command that opens the wrong
 * method or tool, or one whose repeat (commandNonce) no longer re-applies it.
 *
 * The studio drawn outside the workbench, with no provider, is checked here too (AC8): rendered on
 * the server, as the standalone suites render it, and read through the live DOM's parser. Every
 * setting the inspector moves is drawn once, where it sat before: on Restriction Ligation, Gibson,
 * In-Fusion and HiFi the 5' and 3' enzymes in a two-field row of the cloning card, right after the
 * vector and insert row (or the linearisation note) and followed by the buffer-compatibility line;
 * on Golden Gate the Type IIS enzyme in a row of the cloning card with its overhang check beside it;
 * on Virtual Gel & Digest the ladder, agarose, buffer and stain inline in the tools card's header,
 * after its tool strip, and the 14 digest chips at that card's foot. Wrong implementations these
 * checks fail: a setting dropped on its own (the round-1 review's mutants), drawn twice (a section
 * drawn there too, which with no provider renders its children as passed), drawn once but in
 * another card or row, wrapped in an inspector section or header, or drawn for a method or tool
 * that does not use it.
 *
 * The other suites that render the studio with no provider check less of where its settings sit:
 * figureFirstStudioLayout finds the MW Ladder's label and the chip strip somewhere in the controls
 * column (not the agarose, buffer or stain, nor the reaction's enzymes, nor how many of each) and
 * clicks chips through their handlers; primerTmNoAnswer reads the Gibson arm's Tm; cloningOpCaps renders it on Silent
 * Mutations and restrictionSiteCap on Noncutters; plainLanguageLabels reads its badges and
 * accessibilityFloor its inline font sizes, on the tool it opens on.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CloningMethodType, SequenceDocument } from '../types/bio';
import type { CloningSubToolType } from '../components/CloningAndGelStudio';
import { mountApp, type AppHarness } from './appHarness';
import { LiveDocument, LiveElement, parseMarkup } from './liveDom';

// Each check launches the App afresh.
vi.setConfig({ testTimeout: 60_000 });

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Records built in the test ───

/** Deterministic bases (LCG), so every run reads the same plasmid. */
function basesFrom(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[Math.floor((s / 2 ** 32) * 4)];
  }
  return out;
}

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};

/**
 * A 4,800 bp circular plasmid with two BamHI (GGATCC), one XhoI (CTCGAG), two EcoRI (GAATTC) and
 * one HindIII (AAGCTT) site planted in its deterministic backbone, which carries a few sites of its
 * own as well. The digests it gives are not assumed here: each check reads them from the engine and
 * asserts that the ones it compares differ, so a fixture that stopped separating them fails rather
 * than passing quietly.
 */
const PLASMID_SEQ = (() => {
  const sites: [number, string][] = [
    [300, 'GGATCC'], [1100, 'CTCGAG'], [1900, 'GAATTC'], [2600, 'GGATCC'], [3400, 'AAGCTT'], [4200, 'GAATTC'],
  ];
  let seq = basesFrom(0x5c10, 4800);
  for (const [at, site] of sites) seq = seq.slice(0, at) + site + seq.slice(at + site.length);
  return seq;
})();
const PLASMID: SequenceDocument = {
  ...BLANK, id: 'taar-plasmid', name: 'pTAAR_Vector', accession: 'TAAR_0001',
  description: 'A circular vector built in the test', topology: 'circular', sequence: PLASMID_SEQ,
  features: [{ id: 'f-taar-cds', name: 'TaarCDS', type: 'CDS', start: 201, end: 800, strand: 1, color: '#d93025' }],
};
/** The insert the studio opens with (the first record of the Cloning Inserts & PCR folder). */
const INSERT: SequenceDocument = {
  ...BLANK, id: 'taar-insert', name: 'TAAR_Insert', accession: 'TAAR_0002', description: 'A donor insert',
  folder: 'Cloning Inserts & PCR', sequence: basesFrom(0x11ce, 900),
};

const onCloning = (app: AppHarness) =>
  app.restoreSession({ documents: [PLASMID, INSERT], activeDocId: PLASMID.id, viewerTab: 'cloning-gel' });

/** This launch's engine, loaded after the App (one module at a time). */
async function engine() {
  const bio = await import('../core/bioEngine');
  const rust = await import('../lib/rustBioEngine');
  return { bio, rust };
}
type Engine = Awaited<ReturnType<typeof engine>>;

// ─── Reading the App ───

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A label's own words: its text without the text of the controls inside it (a select's options). */
const ownWords = (label: LiveElement) =>
  words(label.childNodes.map((n) => (n instanceof LiveElement && (n.tagName === 'SELECT' || n.tagName === 'INPUT') ? '' : n.textContent)).join(''));
/** The form controls in `scope` named `name`: by their aria-label, or by the words of the label they sit in. */
const fields = (scope: LiveElement, name: string) =>
  scope.querySelectorAll('input, select').filter((c) => c.getAttribute('aria-label') === name || c.labels.some((l) => ownWords(l) === name));
function field(scope: LiveElement, name: string): LiveElement {
  const found = fields(scope, name);
  expect(found, `one "${name}" control`).toHaveLength(1);
  return found[0];
}

const ENZYME_5 = "5' Restriction Enzyme:";
const ENZYME_3 = "3' Restriction Enzyme:";
const TYPE_IIS = 'Type IIS Restriction Endonuclease:';
const LADDER = 'MW Ladder:';
const AGAROSE = 'Agarose:';
const GEL_BUFFER = 'Buffer:';
const STAIN = 'Stain:';
const VECTOR = 'Recipient Vector Backbone:';
const DONOR = 'Donor Insert Fragment:';
const GEL_SETTINGS = [LADDER, AGAROSE, GEL_BUFFER, STAIN];
const REACTION = 'Reaction Enzymes';
const GEL_AND_DIGEST = 'Gel & Digest';

/** The value an element's inline style declares for `prop` (React writes it into the style object). */
const declared = (el: LiveElement, prop: string) => el.style.getPropertyValue(prop);
const sectionTitle = (s: LiveElement) => words(s.querySelectorAll('button.mbc-accordion-header')[0]?.textContent ?? '');
/**
 * The inspector as App shows it: the button's label, the pane title and, in their CSS order, the
 * titles of the sections the studio portals into App's column.
 */
function shown(app: AppHarness) {
  const aside = app.inspectorAside();
  const sections = aside ? aside.querySelectorAll('.mbc-inspector-sections > .mbc-accordion-section') : [];
  for (const s of sections) expect(declared(s, 'order'), `the "${sectionTitle(s)}" section declares its order`).toMatch(/^\d+$/);
  return {
    button: app.inspectorButton()?.getAttribute('aria-label') ?? null,
    title: aside?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null,
    sections: [...sections].sort((a, b) => Number(declared(a, 'order')) - Number(declared(b, 'order'))).map(sectionTitle),
  };
}
const OPEN = { button: 'Hide Cloning Controls Inspector', title: 'Cloning Controls' };
const CLOSED = { button: 'Show Cloning Controls Inspector', title: null, sections: [] };
const NONE = { button: null, title: null, sections: [] };

/** The body of the column's section titled `title`. */
function sectionBody(app: AppHarness, title: string): LiveElement {
  const aside = app.inspectorAside();
  expect(aside, `the inspector column, for the ${title} section`).not.toBeNull();
  const found = aside!.querySelectorAll('.mbc-inspector-sections > .mbc-accordion-section').filter((s) => sectionTitle(s) === title);
  expect(found, `one "${title}" section`).toHaveLength(1);
  const bodies = found[0].querySelectorAll('.mbc-accordion-body');
  expect(bodies, `the "${title}" section is unfolded`).toHaveLength(1);
  return bodies[0];
}
/** The control named `name`, in the section titled `title` and nowhere else in the page. */
function inSection(app: AppHarness, title: string, name: string): LiveElement {
  const el = field(sectionBody(app, title), name);
  expect(fields(app.canvas(), name), `${name}: none in the viewer canvas`).toHaveLength(0);
  expect(fields(app.doc.body, name), `${name}: one in the whole page`).toHaveLength(1);
  return el;
}
/** The words of the one callout in `scope` that starts with `start`. */
function callout(scope: LiveElement, start: string): string {
  const found = scope.querySelectorAll('.info-callout').filter((c) => words(c.textContent).startsWith(start));
  expect(found, `one "${start}…" callout`).toHaveLength(1);
  return words(found[0].textContent);
}

// ─── The studio's own strips ───

const methodButtons = (app: AppHarness) =>
  app.canvas().querySelectorAll('[role="tablist"][aria-label="Cloning Methods"] button[role="tab"]');
const toolButtons = (app: AppHarness) =>
  app.canvas().querySelectorAll('[role="tablist"][aria-label="Gel and Enzyme Utilities"] button[role="tab"]');
const selectedOf = (buttons: LiveElement[], what: string) => {
  const on = buttons.filter((b) => b.getAttribute('aria-selected') === 'true');
  expect(on, `one selected ${what}`).toHaveLength(1);
  return words(on[0].textContent);
};
const selectedMethod = (app: AppHarness) => selectedOf(methodButtons(app), 'cloning method');
const selectedTool = (app: AppHarness) => selectedOf(toolButtons(app), 'gel or enzyme tool');

/** The tools, by the start of the label each shows (its count or shortcut follows). */
const TOOLS = {
  gel: 'Virtual Gel & Digest',
  mutagenesis: 'Mutagenesis (',
  'anneal-oligos': 'Anneal Oligos',
  'non-cutters': 'Noncutters (',
  'silent-mutations': 'Silent Mutations (',
  'dna-calculations': 'DNA Calculations (',
} as const;
type Tool = keyof typeof TOOLS;

/** Clicks the studio's own method tab, as a user does. */
async function openMethod(app: AppHarness, method: string) {
  const hit = methodButtons(app).filter((b) => words(b.textContent) === method);
  expect(hit, `one "${method}" method tab`).toHaveLength(1);
  await app.click(hit[0]);
  expect(selectedMethod(app)).toBe(method);
}
/** Clicks the studio's own tool tab, as a user does. */
async function openTool(app: AppHarness, tool: Tool) {
  const hit = toolButtons(app).filter((b) => words(b.textContent).startsWith(TOOLS[tool]));
  expect(hit, `one ${tool} tool tab`).toHaveLength(1);
  await app.click(hit[0]);
  expect(selectedTool(app).startsWith(TOOLS[tool]), `the ${tool} tool is open`).toBe(true);
}

// ─── Reading the gel and the digest ───

const gelSvg = (app: AppHarness) => app.one('svg.virtual-gel-svg', "the gel's drawing");
/** The `y` the gel draws each band of the lane at `x` at, in its own 430x350 units. */
const laneBandYs = (app: AppHarness, x: number) =>
  gelSvg(app).querySelectorAll('rect').filter((r) => r.getAttribute('x') === String(x)).map((r) => Number(r.getAttribute('y')));
/** The ladder's lane (x=52) and the combined digest's lane (x=312). */
const ladderBandYs = (app: AppHarness) => laneBandYs(app, 52);
const digestBandYs = (app: AppHarness) => laneBandYs(app, 312);
/** The sizes the combined digest's lane calls out beside its bands (x=363), as its labels read. */
const digestBandLabels = (app: AppHarness) =>
  gelSvg(app).querySelectorAll('text').filter((t) => t.getAttribute('x') === '363').map((t) => words(t.textContent));
/** The four lane labels above the wells: the ladder, uncut, the single cutter, the combined digest. */
const laneLabels = (app: AppHarness) =>
  gelSvg(app).querySelectorAll('g > text').filter((t) => t.getAttribute('y') === '14').map((t) => words(t.textContent));
/** The ladder sizes the gel prints beside its bands ("10k", "500", ...), with the y of each. */
const ladderLabelYs = (app: AppHarness) =>
  gelSvg(app).querySelectorAll('text')
    .filter((t) => t.getAttribute('text-anchor') === 'end')
    .map((t) => ({ label: words(t.textContent), y: Number(t.getAttribute('y')) }));
const ladderLabels = (app: AppHarness) => ladderLabelYs(app).map((l) => l.label);
/** The size a printed ladder label names: "1k" is 1,000 bp. */
const ladderSizeOf = (label: string) => (label.endsWith('k') ? Number(label.slice(0, -1)) * 1000 : Number(label));

/**
 * The y the gel puts a band of `bp` at, from the engine's own migration for the chosen agarose and
 * buffer: the 48-unit well offset plus the migration it reports (clamped to the gel's 6..266 units)
 * and the 4-unit band offset, as `calcMigrationY` lays the lane out.
 */
function expectedBandY(e: Engine, bp: number, agarosePct: number, buffer: 'TBE' | 'TAE' | 'SB', supercoiled = false): number {
  const factor = buffer === 'TBE' ? 0.72 : buffer === 'TAE' ? 0.78 : 0.68;
  const effective = Math.max(50, Math.round(supercoiled ? bp * factor : bp));
  const [band] = e.rust.computeAgaroseGelPhysicsRust([effective], agarosePct, buffer, 270);
  return 48 + Math.max(6, Math.min(266, band.migrationMm)) + 4;
}
/**
 * The digest the engine cuts the plasmid into with `enzymes`, and the bands the gel then draws: the
 * lane is drawn fastest-migrating first, the table in the engine's own fragment order.
 */
function expectedDigest(e: Engine, enzymes: string[], agarosePct = 1.0, buffer: 'TBE' | 'TAE' | 'SB' = 'TBE') {
  const fragments = e.bio.simulateRestrictionDigest(PLASMID, enzymes);
  const placed = fragments
    .map((f) => ({ lengthBp: f.lengthBp, y: expectedBandY(e, f.lengthBp, agarosePct, buffer) }))
    .sort((a, b) => a.y - b.y);
  return {
    fragments,
    labels: placed.map((p) => `${p.lengthBp} bp`),
    bandYs: placed.map((p) => p.y),
    rows: fragments.map((f) => ({
      index: String(f.index),
      size: `${f.lengthBp.toLocaleString()} bp`,
      range: `${f.start}..${f.end}`,
      left: `${f.leftEnzyme} ${f.leftOverhang || f.leftOverhangType}`,
      right: `${f.rightEnzyme} ${f.rightOverhang || f.rightOverhangType}`,
    })),
  };
}
/** The fragments table in the result column, row by row: its number, size, span and two ends. */
function fragmentRows(app: AppHarness) {
  const region = app.one('[role="region"][aria-label="Restriction Digest Fragments"]', 'the digest fragments table');
  return region.querySelectorAll('tbody tr').map((tr) => {
    const cells = tr.querySelectorAll('td');
    expect(cells, 'four cells in a fragment row').toHaveLength(4);
    return {
      index: words(cells[0].textContent),
      size: words(cells[1].querySelectorAll('strong')[0]?.textContent ?? ''),
      range: words(cells[1].querySelectorAll('button')[0]?.textContent ?? ''),
      left: words(cells[2].textContent),
      right: words(cells[3].textContent),
    };
  });
}
/** The digest chips in `scope` and whether each is ticked. */
const chips = (scope: LiveElement) =>
  scope.querySelectorAll('button.enz-chip').map((b) => ({ name: words(b.textContent), on: b.classList.contains('active'), el: b }));
/** The chips shown ticked, in the strip's own (catalogue) order. */
const tickedChips = (scope: LiveElement) => chips(scope).filter((c) => c.on).map((c) => c.name);
/** Clicks the chip named `name` in the inspector's Gel & Digest section. */
async function toggleChip(app: AppHarness, name: string) {
  const hit = chips(sectionBody(app, GEL_AND_DIGEST)).filter((c) => c.name === name);
  expect(hit, `one "${name}" chip in the inspector`).toHaveLength(1);
  await app.click(hit[0].el);
}

// ─── AC1 ───

describe("the reaction's enzymes in App's inspector (AC1)", () => {
  it("puts the reaction enzymes in App's inspector", async () => {
    await withApp(async (app) => {
      await onCloning(app);
      expect(app.activeTab()).toBe('cloning-gel');
      expect(selectedMethod(app), 'the studio opens on Restriction Ligation').toBe('Restriction Ligation');

      // App's own header button, pane title and the two sections of this method and tool, in order.
      expect(shown(app)).toEqual({ ...OPEN, sections: [REACTION, GEL_AND_DIGEST] });
      const aside = app.inspectorAside()!;
      expect(aside.closest('.mbc-viewer-body-split') === app.bodySplit() && aside.localName === 'aside' && aside.classList.contains('mbc-right-controls'),
        "the sections sit in App's aside.mbc-right-controls").toBe(true);

      // Restriction Ligation: the two enzymes and the buffer-compatibility line in Reaction Enzymes.
      expect(inSection(app, REACTION, ENZYME_5).value).toBe('EcoRI');
      expect(inSection(app, REACTION, ENZYME_3).value).toBe('XhoI');
      const reaction = sectionBody(app, REACTION);
      expect(callout(reaction, 'Reaction Buffer Compatibility:'), 'the buffer-compatibility line sits with the enzymes')
        .toMatch(/^Reaction Buffer Compatibility: .+ at \d+°C \(.+\)$/);
      expect(app.canvas().querySelectorAll('.info-callout').filter((c) => words(c.textContent).startsWith('Reaction Buffer Compatibility:')),
        'the buffer line is not in the canvas').toHaveLength(0);
      // Each enzyme select offers the catalogue's Type II enzymes, and no Type IIS enzyme.
      const options = inSection(app, REACTION, ENZYME_5).options.map((o) => o.value);
      expect(options, 'the 5\' enzyme offers the Type II catalogue').toEqual(expect.arrayContaining(['EcoRI', 'BamHI', 'HindIII', 'XhoI']));
      expect(options, 'and no Type IIS enzyme').not.toContain('BsaI-HFv2');

      // The method strip, the vector, the insert and Simulate stay in the canvas's controls column.
      const controls = app.canvas().querySelectorAll('.studio-controls-column');
      expect(controls, 'one controls column in the canvas').toHaveLength(1);
      const strip = app.canvas().querySelectorAll('[role="tablist"][aria-label="Cloning Methods"]');
      expect(strip, 'the method strip is in the canvas').toHaveLength(1);
      expect(controls[0].contains(strip[0]), 'the method strip is in the controls column').toBe(true);
      for (const name of [VECTOR, DONOR]) {
        const control = field(app.canvas(), name);
        expect(controls[0].contains(control), `${name} is in the controls column`).toBe(true);
        expect(fields(aside, name), `${name} is not in the inspector`).toHaveLength(0);
      }
      const simulate = app.canvas().querySelectorAll('button').filter((b) => /^Simulate .+ Reaction$/.test(words(b.textContent)));
      expect(simulate, 'one Simulate button, in the canvas').toHaveLength(1);
      expect(controls[0].contains(simulate[0]), 'Simulate is in the controls column').toBe(true);
      expect(aside.querySelectorAll('button').filter((b) => /^Simulate /.test(words(b.textContent))), 'no Simulate in the inspector').toHaveLength(0);

      // Gibson, In-Fusion and HiFi keep the same section, with their linearisation note.
      for (const method of ['Gibson Assembly', 'In-Fusion Cloning', 'NEBuilder HiFi Assembly'] as const) {
        await openMethod(app, method);
        expect(shown(app), method).toEqual({ ...OPEN, sections: [REACTION, GEL_AND_DIGEST] });
        inSection(app, REACTION, ENZYME_5);
        inSection(app, REACTION, ENZYME_3);
        expect(callout(sectionBody(app, REACTION), 'The circular recipient vector is linearised'), `${method}: the linearisation note`)
          .toBe('The circular recipient vector is linearised with these two enzymes before assembly.');
        expect(fields(app.doc.body, TYPE_IIS), `${method}: no Type IIS enzyme`).toHaveLength(0);
      }

      // Golden Gate: the Type IIS enzyme and its overhang check, in the same section.
      await openMethod(app, 'Golden Gate (Type IIS)');
      expect(shown(app), 'Golden Gate').toEqual({ ...OPEN, sections: [REACTION, GEL_AND_DIGEST] });
      const typeIIs = inSection(app, REACTION, TYPE_IIS);
      expect(typeIIs.value).toBe('BsaI-HFv2');
      expect(typeIIs.options.map((o) => o.value), 'the Type IIS catalogue, and no Type II enzyme').toEqual(expect.arrayContaining(['BsaI-HFv2', 'BsmBI-v2']));
      expect(typeIIs.options.map((o) => o.value)).not.toContain('EcoRI');
      expect(callout(sectionBody(app, REACTION), 'Outward Type IIS cleavage'), "Golden Gate's overhang check sits with its enzyme").toMatch(/Overhang check: \S/);
      for (const name of [ENZYME_5, ENZYME_3]) expect(fields(app.doc.body, name), `Golden Gate: no ${name}`).toHaveLength(0);

      // Closed, the settings are drawn nowhere and the button stays; the canvas keeps its own.
      await app.click(app.inspectorButton()!);
      expect(shown(app)).toEqual(CLOSED);
      expect(app.inspectorAside(), 'no column while the inspector is closed').toBeNull();
      for (const name of [TYPE_IIS, ...GEL_SETTINGS]) expect(fields(app.doc.body, name), `${name} not drawn while closed`).toHaveLength(0);
      field(app.canvas(), VECTOR);
      field(app.canvas(), DONOR);
      await app.click(app.inspectorButton()!);
      expect(shown(app), 'opened again, the sections are back').toEqual({ ...OPEN, sections: [REACTION, GEL_AND_DIGEST] });
      expect(inSection(app, REACTION, TYPE_IIS).value, 'the Type IIS enzyme is as it was').toBe('BsaI-HFv2');
    });
  });
});

// ─── AC2 ───

describe("the gel's conditions and digest enzymes in App's inspector (AC2)", () => {
  it("puts the gel conditions and digest enzymes in App's inspector", async () => {
    await withApp(async (app) => {
      await onCloning(app);
      expect(selectedTool(app).startsWith(TOOLS.gel), 'the studio opens on Virtual Gel & Digest').toBe(true);
      expect(shown(app).sections).toEqual([REACTION, GEL_AND_DIGEST]);

      // The four gel conditions, each in the Gel & Digest section and nowhere else.
      const values = GEL_SETTINGS.map((name) => inSection(app, GEL_AND_DIGEST, name).value);
      expect(values, 'the ladder, agarose, buffer and stain as the studio opens').toEqual(['1 kb Plus DNA Ladder', '1', 'TBE', 'sybr']);
      expect(inSection(app, GEL_AND_DIGEST, LADDER).options.map((o) => o.value), 'the ladders on offer')
        .toEqual(['1 kb Plus DNA Ladder', '1 kb DNA Ladder', '100 bp DNA Ladder']);
      expect(inSection(app, GEL_AND_DIGEST, AGAROSE).options.map((o) => o.value), 'the agarose strengths on offer').toEqual(['0.7', '1', '1.5', '2']);
      expect(inSection(app, GEL_AND_DIGEST, GEL_BUFFER).options.map((o) => o.value), 'the buffers on offer').toEqual(['TBE', 'TAE', 'SB']);
      expect(inSection(app, GEL_AND_DIGEST, STAIN).options.map((o) => o.value), 'the stains on offer').toEqual(['sybr', 'ethidium']);
      expect(app.canvas().querySelectorAll('.gel-controls-inline'), 'no gel controls left in the canvas').toHaveLength(0);

      // The digest enzyme chips: in that section, with the default digest ticked, and none in the canvas.
      const gel = sectionBody(app, GEL_AND_DIGEST);
      expect(chips(gel).map((c) => c.name), 'the chips of the digest').toEqual(
        ['EcoRI', 'BamHI', 'HindIII', 'NotI', 'XhoI', 'NdeI', 'NcoI', 'XbaI', 'SpeI', 'PstI', 'SalI', 'KpnI', 'SacI', 'SmaI']
      );
      expect(tickedChips(gel), 'BamHI and XhoI are ticked').toEqual(['BamHI', 'XhoI']);
      expect(app.canvas().querySelectorAll('button.enz-chip'), 'no chip in the canvas').toHaveLength(0);
      expect(app.canvas().querySelectorAll('.enzyme-picker-strip'), 'no chip strip in the canvas').toHaveLength(0);

      // The gel, its fragments table and the buffer plan stay in the canvas's result column.
      const result = app.canvas().querySelectorAll('.studio-result-column');
      expect(result, 'one result column in the canvas').toHaveLength(1);
      expect(result[0].contains(gelSvg(app)), 'the gel stays in the result column').toBe(true);
      const table = app.one('[role="region"][aria-label="Restriction Digest Fragments"]', 'the fragments table');
      expect(result[0].contains(table), 'the fragments table stays in the result column').toBe(true);
      expect(app.inspectorAside()!.querySelectorAll('svg.virtual-gel-svg, [role="region"]'), 'no gel or table in the inspector').toHaveLength(0);

      // Another tool: the gel section goes, the reaction's enzymes stay, and the tool's own inputs
      // are in the canvas. Back on the gel, its conditions and chips return as they were.
      await openTool(app, 'mutagenesis');
      expect(shown(app), 'Mutagenesis').toEqual({ ...OPEN, sections: [REACTION] });
      for (const name of GEL_SETTINGS) expect(fields(app.doc.body, name), `${name} is not drawn for another tool`).toHaveLength(0);
      expect(app.doc.body.querySelectorAll('button.enz-chip'), 'no chip is drawn for another tool').toHaveLength(0);
      field(app.canvas(), 'Mutagenesis Type:');
      await openTool(app, 'gel');
      expect(shown(app), 'back on the gel').toEqual({ ...OPEN, sections: [REACTION, GEL_AND_DIGEST] });
      expect(GEL_SETTINGS.map((name) => inSection(app, GEL_AND_DIGEST, name).value), 'the conditions are as they were').toEqual(values);
      expect(tickedChips(sectionBody(app, GEL_AND_DIGEST)), 'the digest is as it was').toEqual(['BamHI', 'XhoI']);
    });
  });
});

// ─── AC3 ───

describe('the gel driven from the inspector (AC3)', () => {
  it('redraws the gel from the inspector', async () => {
    await withApp(async (app) => {
      await onCloning(app);
      const e = await engine();

      // What the engine cuts this plasmid into, before and after a chip, and how the gel then
      // draws it: the fixture must digest differently for each, or the checks below prove nothing.
      const twoEnzymes = expectedDigest(e, ['BamHI', 'XhoI']);
      const threeEnzymes = expectedDigest(e, ['BamHI', 'XhoI', 'EcoRI']);
      const withoutBamHI = expectedDigest(e, ['XhoI', 'EcoRI']);
      expect(twoEnzymes.fragments.length, 'BamHI + XhoI cut the plasmid into more than one fragment').toBeGreaterThan(1);
      expect(new Set([twoEnzymes, threeEnzymes, withoutBamHI].map((d) => JSON.stringify(d.labels))).size,
        'the three digests give three different band sets').toBe(3);

      expect(digestBandLabels(app), 'the gel draws the default digest').toEqual(twoEnzymes.labels);
      expect(fragmentRows(app), 'and the table lists it').toEqual(twoEnzymes.rows);
      expect(laneLabels(app)[3], 'the combined lane is named for the digest').toBe('BamHI+XhoI');

      // A chip ticked in the inspector: the gel's bands and the table follow the new digest.
      await toggleChip(app, 'EcoRI');
      expect(tickedChips(sectionBody(app, GEL_AND_DIGEST)), 'EcoRI joins the digest').toEqual(['EcoRI', 'BamHI', 'XhoI']);
      expect(digestBandLabels(app), 'the gel redraws for three enzymes').toEqual(threeEnzymes.labels);
      expect(fragmentRows(app), 'and the table relists it').toEqual(threeEnzymes.rows);
      expect(laneLabels(app)[3], 'the lane names the three enzymes').toBe('BamHI+XhoI+1');

      // A chip unticked: the gel and the table drop that enzyme's cuts.
      await toggleChip(app, 'BamHI');
      expect(tickedChips(sectionBody(app, GEL_AND_DIGEST)), 'BamHI leaves the digest').toEqual(['EcoRI', 'XhoI']);
      expect(digestBandLabels(app), 'the gel redraws without BamHI').toEqual(withoutBamHI.labels);
      expect(fragmentRows(app), 'and so does the table').toEqual(withoutBamHI.rows);
      expect(laneLabels(app)[3], 'the lane names the two left').toBe('XhoI+EcoRI');
      await toggleChip(app, 'BamHI');

      // The agarose set in the inspector: the engine's migration for 2% puts every band elsewhere.
      const atOne = expectedDigest(e, ['XhoI', 'EcoRI', 'BamHI'], 1.0);
      const atTwo = expectedDigest(e, ['XhoI', 'EcoRI', 'BamHI'], 2.0);
      expect(atOne.bandYs.every((y, i) => Math.abs(y - atTwo.bandYs[i]) > 1), 'the fixture migrates differently at 1% and 2%').toBe(true);
      const drawn = digestBandYs(app);
      expect(drawn.length, 'a band for every fragment').toBe(atOne.bandYs.length);
      drawn.forEach((y, i) => expect(y, `band ${i} at 1% agarose`).toBeCloseTo(atOne.bandYs[i], 6));
      /** The ladder's own lane migrates with the agarose too: each printed size, where it is printed. */
      const ladderAt = (pct: number) => {
        const printed = ladderLabelYs(app);
        expect(printed.length, `${pct}% agarose: the ladder prints its sizes`).toBeGreaterThan(2);
        for (const { label, y } of printed) {
          // The label sits 4 units below the band it names, which the engine's migration places.
          expect(y, `the ${label} ladder band at ${pct}% agarose`).toBeCloseTo(expectedBandY(e, ladderSizeOf(label), pct, 'TBE') + 4, 6);
        }
        return printed.map((p) => p.y);
      };
      const ladderBefore = ladderAt(1.0);
      await app.change(inSection(app, GEL_AND_DIGEST, AGAROSE), '2');
      expect(inSection(app, GEL_AND_DIGEST, AGAROSE).value).toBe('2');
      digestBandYs(app).forEach((y, i) => expect(y, `band ${i} at 2% agarose`).toBeCloseTo(atTwo.bandYs[i], 6));
      expect(ladderAt(2.0), 'the ladder is redrawn, not left where 1% put it').not.toEqual(ladderBefore);
      expect(fragmentRows(app), 'the fragments themselves are unchanged by the agarose').toEqual(atOne.rows);
      await app.change(inSection(app, GEL_AND_DIGEST, AGAROSE), '1');

      // The ladder set in the inspector: its own lane is renamed and redrawn with its sizes.
      const before = { lane: laneLabels(app)[0], bands: ladderBandYs(app).length, labels: ladderLabels(app) };
      expect(before.lane, 'the first lane is named for the ladder').toBe('1 kb Plus');
      expect(before.bands, 'the 1 kb Plus ladder draws its sixteen bands').toBe(16);
      await app.change(inSection(app, GEL_AND_DIGEST, LADDER), '100 bp DNA Ladder');
      expect(laneLabels(app)[0], 'the lane is renamed').toBe('100 bp');
      expect(ladderBandYs(app).length, 'the 100 bp ladder draws its twelve bands').toBe(12);
      // The sizes it prints: its 100 bp band runs too close to the 200 bp one at 1% agarose for
      // the gel's own label gap, so that one is left unlabelled.
      expect(ladderLabels(app), 'and prints the sizes it holds').toEqual(['1k', '500', '200']);
      expect(before.labels, 'the 1 kb Plus ladder printed others').not.toEqual(ladderLabels(app));
      // The digest is untouched by the ladder.
      expect(digestBandLabels(app), 'the digest is unchanged by the ladder').toEqual(atOne.labels);
      expect(fragmentRows(app)).toEqual(atOne.rows);
    });
  });
});

// ─── AC4 ───

describe('no inspector where there is nothing to set (AC4)', () => {
  it('offers no inspector when the method and tool have nothing to set', async () => {
    await withApp(async (app) => {
      await onCloning(app);
      expect(shown(app).button, 'the method and tool the studio opens on have settings').toBe(OPEN.button);

      // The five methods that set up no enzymes, with each tool that keeps its inputs in the
      // column: no button, no column, and the inspector is not drawn at all.
      const noSettingMethods = ['TA / GC Cloning', 'Gateway BP/LR Recombination', 'Parts Cloning', 'TOPO Cloning', 'Overlap Extension PCR'] as const;
      const columnTools: [Tool, string][] = [['mutagenesis', 'Mutagenesis Type:'], ['anneal-oligos', 'Annealed Duplex Name:'], ['dna-calculations', 'Sample Concentration (ng/µL):']];
      for (const method of noSettingMethods) {
        await openMethod(app, method);
        for (const [tool, input] of columnTools) {
          await openTool(app, tool);
          const where = `${method} with the ${tool} tool`;
          expect(shown(app), where).toEqual(NONE);
          expect(app.all('[aria-label$=" Inspector"]'), `${where}: no inspector control anywhere, disabled or not`).toHaveLength(0);
          expect(app.bodySplit().classList.contains('inspector-hidden'), `${where}: the body split draws no column`).toBe(true);
          // The tool keeps its own inputs in the canvas's controls column.
          const control = field(app.canvas(), input);
          expect(app.canvas().querySelectorAll('.studio-controls-column')[0].contains(control), `${where}: ${input} is in the controls column`).toBe(true);
        }
        // The two tools that read the document and set nothing have nothing to set either.
        for (const tool of ['non-cutters', 'silent-mutations'] as const) {
          await openTool(app, tool);
          expect(shown(app), `${method} with the ${tool} tool`).toEqual(NONE);
        }
        // The gel's own conditions are settings, whatever the method.
        await openTool(app, 'gel');
        expect(shown(app), `${method} on the gel`).toEqual({ ...OPEN, sections: [GEL_AND_DIGEST] });
        inSection(app, GEL_AND_DIGEST, LADDER);
      }

      // A method that does set up enzymes brings the button back on a tool with nothing of its own.
      await openMethod(app, 'Restriction Ligation');
      await openTool(app, 'mutagenesis');
      expect(shown(app), 'Restriction Ligation with the mutagenesis tool').toEqual({ ...OPEN, sections: [REACTION] });
      inSection(app, REACTION, ENZYME_5);
      // And a method with nothing to set hides it again, with the inspector left open.
      await openMethod(app, 'TA / GC Cloning');
      expect(shown(app), 'back on TA / GC Cloning').toEqual(NONE);
      await openMethod(app, 'Golden Gate (Type IIS)');
      expect(shown(app), 'Golden Gate with the mutagenesis tool').toEqual({ ...OPEN, sections: [REACTION] });
      inSection(app, REACTION, TYPE_IIS);
    });
  });
});

// ─── AC5 ───

describe('the commands that open a method or tool (AC5)', () => {
  it('opens on the method and tool a menu command chooses, with their sections', async () => {
    await withApp(async (app) => {
      await onCloning(app);
      const routes: { command: string; method: string; tool: Tool; sections: string[]; setting: [string, string] }[] = [
        { command: 'actions:golden-gate', method: 'Golden Gate (Type IIS)', tool: 'gel', sections: [REACTION, GEL_AND_DIGEST], setting: [REACTION, TYPE_IIS] },
        { command: 'actions:mutagenesis', method: 'Restriction Ligation', tool: 'mutagenesis', sections: [REACTION], setting: [REACTION, ENZYME_5] },
        { command: 'tools:dna-calc', method: 'Restriction Ligation', tool: 'dna-calculations', sections: [REACTION], setting: [REACTION, ENZYME_3] },
        { command: 'actions:gibson', method: 'Gibson Assembly', tool: 'gel', sections: [REACTION, GEL_AND_DIGEST], setting: [GEL_AND_DIGEST, LADDER] },
        { command: 'actions:ta-gc', method: 'TA / GC Cloning', tool: 'gel', sections: [GEL_AND_DIGEST], setting: [GEL_AND_DIGEST, AGAROSE] },
      ];
      for (const route of routes) {
        // From another tab, and from the Cloning tab left on a method and tool of its own: the
        // repeat is the one commandNonce has to carry.
        for (const from of ['Sequence', 'Cloning, on another method and tool'] as const) {
          if (from === 'Sequence') {
            await app.clickTab('sequence-view');
            expect(shown(app).title, 'on the Sequence tab').toBe('Sequence View Controls');
          } else {
            expect(app.activeTab(), 'on the Cloning tab').toBe('cloning-gel');
            await openMethod(app, 'TOPO Cloning');
            await openTool(app, 'anneal-oligos');
            expect(shown(app), 'TOPO Cloning with the anneal-oligos tool has nothing to set').toEqual(NONE);
          }
          await app.menu(route.command);
          const where = `${route.command}, from ${from}`;
          expect(app.activeTab(), where).toBe('cloning-gel');
          expect(selectedMethod(app), where).toBe(route.method);
          expect(selectedTool(app).startsWith(TOOLS[route.tool]), `${where}: the ${route.tool} tool`).toBe(true);
          expect(shown(app), where).toEqual({ ...OPEN, sections: route.sections });
          inSection(app, route.setting[0], route.setting[1]);
        }
      }
    });
  });
});

// ─── AC8 ───

/**
 * The studio drawn on its own: no WorkbenchInspectorProvider above it, so it is not in the workbench.
 * It is rendered on the server, as the standalone suites render it, from modules loaded afresh with no
 * live DOM in place (after an App launch the module registry still holds that launch's modules), and
 * its markup is read through the live DOM's parser, so the helpers above read it as they read App's
 * page. The studio's own imports load React DOM (WorkbenchInspector takes createPortal from it),
 * which mountApp refuses to find loaded before its first launch, so these checks come after the App's.
 */
type Opens = { initialMethod?: CloningMethodType; initialSubTool?: CloningSubToolType };
async function standaloneStudio(): Promise<(opens: Opens) => LiveElement> {
  vi.resetModules();
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { CloningAndGelStudio } = await import('../components/CloningAndGelStudio');
  return (opens) => {
    const html = renderToStaticMarkup(React.createElement(CloningAndGelStudio, {
      documents: [PLASMID, INSERT], activeDoc: PLASMID, onAddConstruct: () => {}, ...opens,
    }));
    const doc = new LiveDocument();
    const page = doc.createElement('div');
    doc.body.appendChild(page);
    for (const n of parseMarkup(html, doc)) page.appendChild(n);
    return page;
  };
}

const EVERY_SETTING = [ENZYME_5, ENZYME_3, TYPE_IIS, ...GEL_SETTINGS];
const DIGEST_CHIPS = ['EcoRI', 'BamHI', 'HindIII', 'NotI', 'XhoI', 'NdeI', 'NcoI', 'XbaI', 'SpeI', 'PstI', 'SalI', 'KpnI', 'SacI', 'SmaI'];
const BUFFER_LINE = 'Reaction Buffer Compatibility:';
const OVERHANG_CHECK = 'Outward Type IIS cleavage';
/** The info callouts anywhere in `scope` whose words start with `start`. */
const calloutsIn = (scope: LiveElement, start: string) => scope.querySelectorAll('.info-callout').filter((c) => words(c.textContent).startsWith(start));

/**
 * A standalone render opened on `method` and `tool`: those selected, no inspector markup (no
 * wrapper, section, header or section title), and no setting this method and tool do not use.
 */
function drawnOn(page: LiveElement, method: string, tool: Tool, own: string[]) {
  expect(selectedOf(page.querySelectorAll('[role="tablist"][aria-label="Cloning Methods"] button[role="tab"]'), 'cloning method')).toBe(method);
  const toolShown = selectedOf(page.querySelectorAll('[role="tablist"][aria-label="Gel and Enzyme Utilities"] button[role="tab"]'), 'gel or enzyme tool');
  expect(toolShown.startsWith(TOOLS[tool]), `the ${tool} tool is open`).toBe(true);
  expect(page.querySelectorAll('.mbc-inspector-sections, .mbc-accordion-section, .mbc-accordion-header, .mbc-accordion-body'),
    'no inspector wrapper, section or header on its own').toHaveLength(0);
  expect(page.querySelectorAll('*').filter((e) => [REACTION, GEL_AND_DIGEST].includes(words(e.textContent))), 'no section title on its own').toHaveLength(0);
  for (const name of EVERY_SETTING.filter((n) => !own.includes(n))) expect(fields(page, name), `${name}: not drawn on ${method} with the ${tool} tool`).toHaveLength(0);
  if (tool !== 'gel') expect(page.querySelectorAll('button.enz-chip, .enzyme-picker-strip'), `no digest chip with the ${tool} tool`).toHaveLength(0);
}
/** The control named `name`: drawn once in the whole page, and inside `place`. */
function inPlace(page: LiveElement, place: LiveElement, name: string, where: string): LiveElement {
  const found = fields(page, name);
  expect(found, `${name}: drawn once on its own`).toHaveLength(1);
  expect(place.contains(found[0]), `${name}: ${where}`).toBe(true);
  return found[0];
}
/** The cloning card: the studio card titled for the cloning simulator. */
function cloningCard(page: LiveElement): LiveElement {
  const found = page.querySelectorAll('.studio-card').filter((c) => words(c.querySelectorAll('.studio-card-header h3')[0]?.textContent ?? '') === 'Molecular Cloning & Construct Assembly Studio');
  expect(found, 'one cloning card').toHaveLength(1);
  return found[0];
}
/**
 * Where the reaction's settings sit in the cloning card: the row holding `control` is one of the
 * card's own children, and the vector and insert row comes before it and the Simulate row after.
 */
function reactionRow(card: LiveElement, control: LiveElement, what: string) {
  const row = control.closest('.form-grid-2col');
  expect(row !== null && row.parentElement === card, `${what}: a row of the cloning card's own`).toBe(true);
  const kids = card.children;
  const vectorRow = field(card, VECTOR).closest('.form-grid-2col');
  expect(vectorRow !== null && vectorRow.parentElement === card && vectorRow.contains(field(card, DONOR)), 'the vector and insert row').toBe(true);
  const actions = kids.filter((k) => k.classList.contains('cloning-action-row'));
  expect(actions, 'the Simulate row').toHaveLength(1);
  expect(words(actions[0].textContent)).toMatch(/^Simulate .+ Reaction$/);
  const at = kids.indexOf(row!);
  expect(kids.indexOf(vectorRow!) < at && at < kids.indexOf(actions[0]), `${what}: between the vector and insert row and Simulate`).toBe(true);
  return { row: row!, kids, at, vectorRow: vectorRow! };
}

describe('the studio drawn on its own keeps its settings in place (AC8)', () => {
  it('keeps its settings in place when rendered on its own, on the methods that open the vector with two enzymes', async () => {
    const render = await standaloneStudio();
    for (const method of ['Restriction Ligation', 'Gibson Assembly', 'In-Fusion Cloning', 'NEBuilder HiFi Assembly'] as const) {
      const page = render({ initialMethod: method, initialSubTool: 'mutagenesis' });
      drawnOn(page, method, 'mutagenesis', [ENZYME_5, ENZYME_3]);

      // The 5' and 3' enzymes: drawn once each, as the two fields of one row of the cloning card.
      const card = cloningCard(page);
      const five = inPlace(page, card, ENZYME_5, `${method}: in the cloning card`);
      const three = inPlace(page, card, ENZYME_3, `${method}: in the cloning card`);
      const { row, kids, at, vectorRow } = reactionRow(card, five, `${method}: the enzymes`);
      expect(row.children.map(ownWords), `${method}: the 5' then the 3' enzyme, and nothing else in their row`).toEqual([ENZYME_5, ENZYME_3]);
      expect(row.children[0].contains(five) && row.children[1].contains(three), `${method}: each in its own field`).toBe(true);
      expect([five.value, three.value], `${method}: the enzymes the studio opens with`).toEqual(['EcoRI', 'XhoI']);
      expect(five.options.map((o) => o.value), `${method}: the Type II catalogue`).toEqual(expect.arrayContaining(['EcoRI', 'BamHI', 'HindIII', 'XhoI']));
      expect(five.options.map((o) => o.value), `${method}: and no Type IIS enzyme`).not.toContain('BsaI-HFv2');

      // Right before the row: the vector and insert row, or the linearisation note for the three
      // assembly methods. Right after it: the buffer-compatibility line, drawn once.
      const before = kids[at - 1];
      if (method === 'Restriction Ligation') expect(before === vectorRow, 'the enzymes follow the vector and insert row').toBe(true);
      else {
        expect(before.classList.contains('info-callout'), `${method}: the linearisation note comes first`).toBe(true);
        expect(words(before.textContent)).toBe('The circular recipient vector is linearised with these two enzymes before assembly.');
        expect(kids[at - 2] === vectorRow, `${method}: after the vector and insert row`).toBe(true);
      }
      const buffer = calloutsIn(page, BUFFER_LINE);
      expect(buffer, `${method}: one buffer-compatibility line on its own`).toHaveLength(1);
      expect(kids[at + 1] === buffer[0], `${method}: the buffer line right after the enzymes, in the cloning card`).toBe(true);
      expect(words(buffer[0].textContent)).toMatch(/^Reaction Buffer Compatibility: .+ at \d+°C \(.+\)$/);
      expect(calloutsIn(page, OVERHANG_CHECK), `${method}: no overhang check`).toHaveLength(0);
    }
  });

  it('keeps its settings in place when rendered on its own, on Golden Gate', async () => {
    const page = (await standaloneStudio())({ initialMethod: 'Golden Gate (Type IIS)', initialSubTool: 'mutagenesis' });
    drawnOn(page, 'Golden Gate (Type IIS)', 'mutagenesis', [TYPE_IIS]);

    // The Type IIS enzyme: drawn once, in a row of the cloning card right after the vector and
    // insert row, with its overhang check beside it in the same row.
    const card = cloningCard(page);
    const typeIIs = inPlace(page, card, TYPE_IIS, 'in the cloning card');
    const { row, kids, at, vectorRow } = reactionRow(card, typeIIs, 'the Type IIS enzyme');
    expect(kids[at - 1] === vectorRow, 'the Type IIS row follows the vector and insert row').toBe(true);
    const overhang = calloutsIn(page, OVERHANG_CHECK);
    expect(overhang, 'one overhang check on its own').toHaveLength(1);
    expect(row.children.length === 2 && row.children[0].contains(typeIIs) && row.children[1] === overhang[0],
      'the enzyme and then its overhang check, and nothing else in their row').toBe(true);
    expect(words(overhang[0].textContent)).toMatch(/Overhang check: \S/);
    expect(typeIIs.value).toBe('BsaI-HFv2');
    expect(typeIIs.options.map((o) => o.value), 'the Type IIS catalogue').toEqual(expect.arrayContaining(['BsaI-HFv2', 'BsmBI-v2']));
    expect(typeIIs.options.map((o) => o.value), 'and no Type II enzyme').not.toContain('EcoRI');
    expect(calloutsIn(page, BUFFER_LINE), 'no buffer-compatibility line').toHaveLength(0);
  });

  it('keeps its settings in place when rendered on its own, on Virtual Gel & Digest', async () => {
    // As the studio opens: Restriction Ligation, with the gel tool.
    const page = (await standaloneStudio())({});
    drawnOn(page, 'Restriction Ligation', 'gel', [ENZYME_5, ENZYME_3, ...GEL_SETTINGS]);

    // The tools card: the studio card whose header holds the Gel and Enzyme Utilities strip.
    const strip = page.querySelectorAll('[role="tablist"][aria-label="Gel and Enzyme Utilities"]');
    expect(strip, 'one tool strip').toHaveLength(1);
    const tools = strip[0].closest('.studio-card');
    expect(tools, 'the tool strip sits in a studio card').not.toBeNull();
    const header = tools!.children[0];
    expect(header.classList.contains('studio-card-header') && header.contains(strip[0]), "the tool strip is in that card's header").toBe(true);

    // The four conditions: inline in that header, after the tool strip, one label each in order,
    // each drawn once in the whole page.
    const inline = page.querySelectorAll('.gel-controls-inline');
    expect(inline, 'one inline strip of gel conditions').toHaveLength(1);
    expect(inline[0].parentElement === header && header.children[header.children.length - 1] === inline[0],
      "the conditions close the tools card's header, after its tool strip").toBe(true);
    expect(inline[0].children.map((c) => c.localName), 'four labels and nothing else').toEqual(['label', 'label', 'label', 'label']);
    expect(inline[0].children.map(ownWords), 'the ladder, agarose, buffer and stain, in that order').toEqual(GEL_SETTINGS);
    const controls = GEL_SETTINGS.map((name, i) => {
      const control = inPlace(page, inline[0].children[i], name, "in its label in the tools card's header");
      expect(control.localName, name).toBe('select');
      return control;
    });
    expect(controls.map((c) => c.value), 'the conditions the studio opens with').toEqual(['1 kb Plus DNA Ladder', '1', 'TBE', 'sybr']);
    expect(controls.map((c) => c.options.map((o) => o.value)), 'the choices each offers').toEqual([
      ['1 kb Plus DNA Ladder', '1 kb DNA Ladder', '100 bp DNA Ladder'], ['0.7', '1', '1.5', '2'], ['TBE', 'TAE', 'SB'], ['sybr', 'ethidium'],
    ]);

    // The digest chips: one strip, the tools card's last child, with all 14 chips and no others.
    const chipStrips = page.querySelectorAll('.enzyme-picker-strip');
    expect(chipStrips, 'one chip strip on its own').toHaveLength(1);
    expect(tools!.children[tools!.children.length - 1] === chipStrips[0], "the chips sit at the tools card's foot").toBe(true);
    expect(page.querySelectorAll('button.enz-chip'), 'fourteen chips in the whole page').toHaveLength(14);
    expect(chips(chipStrips[0]).map((c) => c.name), 'the chips of the digest, in the strip').toEqual(DIGEST_CHIPS);
    expect(tickedChips(chipStrips[0]), 'BamHI and XhoI are ticked').toEqual(['BamHI', 'XhoI']);
  });
});
