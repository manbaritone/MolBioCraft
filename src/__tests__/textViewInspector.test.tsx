// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TAZ7: the Text tab's view choices in App's shared inspector. A sequence record's Flatfile
 * tab puts its GenBank / FASTA / EMBL / GFF3 choice in a Record Format section, with Download left on
 * the text; an alignment's text puts its Format select in a Text Format section, with Copy and Export
 * left on its toolbar; a fragment-analysis run puts its dye-channel toggles in a Dye Channels section,
 * with the From/To range, Full range and the figure export left on the trace. Newick, PDB/mmCIF
 * source text, notes and expression results have nothing to set, so their Text tab shows no button,
 * and the expression table keeps its Significant only filter (D0060 ruling 3).
 *
 * Every check but the last two runs in the real App over the live DOM (the US-01M6TB6G harness,
 * appHarness.tsx): records built here are restored on the Text tab, and the checks read App's own
 * header button, its pane title, its inspector column (aside.mbc-right-controls) and its viewer
 * canvas, and drive the settings by editing them in that column. The last two draw the alignment text
 * and the electropherogram on their own (a React root of their own in the launched App's window, no
 * WorkbenchInspectorProvider above them), where each setting stays where it sat (D0063 ruling f).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

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

/** Deterministic letters (LCG) from `alphabet`, so every run reads the same sequence. */
function lettersFrom(seed: number, n: number, alphabet = 'ACGT'): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((s / 2 ** 32) * alphabet.length)];
  }
  return out;
}
/** `seq` with the letter at each 1-based column in `cols` moved one step along ACGT. */
function substituted(seq: string, cols: number[]): string {
  const out = seq.split('');
  for (const c of cols) out[c - 1] = 'ACGT'[('ACGT'.indexOf(out[c - 1]) + 1) % 4];
  return out.join('');
}

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};

/** A circular plasmid with one CDS: each record format writes it differently. */
const PLASMID: SequenceDocument = {
  ...BLANK, id: 'taz7-plasmid', name: 'TAZ7_Plasmid', accession: 'TAZ7_0001', description: 'A plasmid built in the test',
  sequence: lettersFrom(0x7a27, 240), topology: 'circular', documentKind: 'circular-dna',
  features: [{ id: 'taz7-cds', name: 'taz7A', type: 'CDS', start: 31, end: 120, strand: 1, color: '#1a73e8' }],
} as SequenceDocument;

const DNA_A = lettersFrom(0x7a28, 90);
/** An alignment of three 90 nt members, never imported from a file: its Text tab draws AlignmentTextStream. */
const ALN: SequenceDocument = {
  ...BLANK, id: 'taz7-aln', name: 'TAZ7 Alignment', accession: 'TAZ7_0002', description: 'An alignment built in the test',
  sequence: DNA_A, documentKind: 'alignment', folder: 'Alignments',
  alignmentMeta: {
    isAligned: true,
    sequences: [['taz7-a', 'TAZ7_Member_A', DNA_A], ['taz7-b', 'TAZ7_Member_B', substituted(DNA_A, [7, 33, 61])], ['taz7-c', 'TAZ7_Member_C', substituted(DNA_A, [12, 80])]]
      .map(([id, name, sequence]) => ({ id, name, sequence })),
  },
} as SequenceDocument;

/** Four dye channels, each with one peak of its own, over 300 scans (not sized: scan numbers). */
const DYES = ['6-FAM', 'VIC', 'NED', 'LIZ'];
/** The colour the electropherogram draws each dye's trace in (dyeColor, src/core/fragmentAnalysis.ts). */
const DYE_STROKES: Record<string, string> = { '6-FAM': '#2f7de1', VIC: '#1f9d55', NED: '#c7a514', LIZ: '#ee7d20' };
const peak = (at: number, height: number) => Array.from({ length: 300 }, (_, s) => Math.round(height * Math.exp(-(((s - at) / 4) ** 2))) + 5);
/** A fragment-analysis run as fragmentDocumentFromFsa (src/core/operationRunners.ts) makes one: a text document carrying the trace. */
const FSA: SequenceDocument = {
  ...BLANK, id: 'taz7-fsa', name: 'TAZ7_Run', description: 'Fragment analysis run, 4 dyes', folder: 'Sequencing Reads (Sanger/NGS)',
  docMetadata: {
    'Document Type': 'Text Document', 'Source Format': 'ABIF fragment analysis (.fsa)', Notes: '# TAZ7_Run\n\nNot sized yet.\n',
    'Fragment trace': JSON.stringify({ channels: DYES.map((dye, i) => ({ dye, data: peak(60 + 60 * i, 800 + 100 * i) })), dataKind: 'analysed' }),
    Dyes: DYES.join(', '),
  },
} as SequenceDocument;

const TREE: SequenceDocument = {
  ...BLANK, id: 'taz7-tree', name: 'TAZ7_Tree', description: 'Imported phylogenetic tree from TAZ7_Tree.nwk', folder: 'Tree Documents', documentKind: 'tree',
  docMetadata: { Newick: '((Alpha:0.1,Beta:0.2)90:0.05,(Gamma:0.3,Delta:0.1)75:0.2);', 'No. tips': 4, 'Source Format': 'Newick' },
} as SequenceDocument;
const PDB_TEXT = 'HEADER    TEST PROTEIN                            07-NOV-26   TAZ7              \nATOM      1  N   MET A   1      11.104   6.134  -6.504  1.00  0.00           N  \nEND\n';
const PDB: SequenceDocument = {
  ...BLANK, id: 'taz7-pdb', name: 'TAZ7_Structure', moleculeType: 'Protein', sequence: 'MKTAYIAKQR', documentKind: 'protein',
  docMetadata: { PDBText: PDB_TEXT, 'Source Format': 'PDB' },
} as SequenceDocument;
const CIF: SequenceDocument = {
  ...BLANK, id: 'taz7-cif', name: 'TAZ7_Model', moleculeType: 'Protein', sequence: 'MKTAYIAKQR', documentKind: 'protein',
  docMetadata: { PDBText: 'data_TAZ7\n_entry.id TAZ7\n', 'Source Format': 'mmCIF' },
} as SequenceDocument;
const NOTES: SequenceDocument = {
  ...BLANK, id: 'taz7-notes', name: 'TAZ7_Notes', docMetadata: { 'Document Type': 'Text Document', Notes: '# Bench notes\n\nDigest at 37 C.\n' },
} as SequenceDocument;
const EXPRESSION: SequenceDocument = {
  ...BLANK, id: 'taz7-expr', name: 'TAZ7 Treated vs Control', folder: 'Alignments',
  docMetadata: {
    'Document Type': 'Text Document', Notes: '# Treated vs Control\n',
    'Expression results': JSON.stringify({
      conditionA: 'Control', conditionB: 'Treated', samplesA: ['c1', 'c2'], samplesB: ['t1', 't2'], alpha: 0.05, lfcThreshold: 0,
      pca: [{ sample: 'c1', group: 'Control', pc1: -1.2, pc2: 0.3 }, { sample: 'c2', group: 'Control', pc1: -0.9, pc2: -0.4 }, { sample: 't1', group: 'Treated', pc1: 1.1, pc2: 0.2 }, { sample: 't2', group: 'Treated', pc1: 1.0, pc2: -0.1 }],
      pcaVariance: [71, 18],
      rows: [['geneA', 120, 2.4, 0.3, 1e-6, 1e-5], ['geneB', 80, -1.9, 0.4, 1e-4, 5e-4], ['geneC', 300, 0.1, 0.2, 0.6, 0.8], ['geneD', 45, 0.4, 0.5, 0.3, 0.5]],
    }),
  },
} as SequenceDocument;

const onTextTab = (app: AppHarness, doc: SequenceDocument) =>
  app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'text-view' });

// ─── Reading the App ───

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const label = (el: LiveElement | null) => el?.getAttribute('aria-label') ?? null;
/** The aside's section titles, in the page's order. */
const sectionTitles = (aside: LiveElement | null) => aside ? aside.querySelectorAll('button.mbc-accordion-header').map((b) => words(b.textContent)) : [];
/** The one accordion section titled `title` in App's inspector column. */
function sectionOf(app: AppHarness, title: string): LiveElement {
  const aside = app.inspectorAside();
  expect(aside, 'the inspector column is drawn').not.toBeNull();
  expect(aside!.localName === 'aside' && aside!.classList.contains('mbc-right-controls'), "App's aside.mbc-right-controls").toBe(true);
  const found = aside!.querySelectorAll('.mbc-accordion-section').filter((s) => words(s.querySelectorAll('button.mbc-accordion-header')[0]?.textContent ?? '') === title);
  expect(found, `one ${title} section in the inspector`).toHaveLength(1);
  return found[0];
}
const paneTitle = (app: AppHarness) => app.inspectorAside()?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null;
/** The buttons in `scope` whose words are `text`. */
const buttonsIn = (scope: LiveElement, text: string) => scope.querySelectorAll('button').filter((b) => words(b.textContent).replace(/\s*▾$/, '') === text);
function button(scope: LiveElement, text: string): LiveElement {
  const found = buttonsIn(scope, text);
  expect(found, `one "${text}" button`).toHaveLength(1);
  return found[0];
}
/** Whether no inspector wrapper (an accordion section or body, or the sections' column) holds `el`. */
const unwrapped = (el: LiveElement) => el.closest('.mbc-accordion-section, .mbc-accordion-body, .mbc-inspector-sections, .mbc-right-controls') === null;

// The Flatfile tab's record formats, the text each writes first, and the file each downloads as.
const FORMATS = [
  { button: 'GenBank (.gb)', name: 'GenBank', head: 'LOCUS', ext: 'gb' },
  { button: 'FASTA (.fasta)', name: 'FASTA', head: '>', ext: 'fasta' },
  { button: 'EMBL-EBI (.embl)', name: 'EMBL-EBI', head: 'ID ', ext: 'embl' },
  { button: 'GFF3 Annotations (.gff3)', name: 'GFF3 Annotations', head: '##gff-version 3', ext: 'gff3' },
];
const flatfileText = (app: AppHarness) => app.one('.mbc-flatfile-pre', 'the flat-file text').textContent;
const textToolbar = (app: AppHarness) => app.one('.mbc-text-toolbar', 'the text toolbar');
/** The text toolbar's items, each by its words. */
const toolbarWords = (app: AppHarness) => textToolbar(app).children.map((c) => words(c.textContent));

// ─── AC1 ───

describe("the Flatfile tab's record format (AC1)", () => {
  it("chooses the flatfile format in App's inspector", async () => {
    await withApp(async (app) => {
      await onTextTab(app, PLASMID);
      expect(app.activeTab()).toBe('text-view');

      // App's own header button, its pane title and one section in its aside.
      expect(label(app.inspectorButton())).toBe('Hide Flatfile Controls Inspector');
      expect(paneTitle(app)).toBe('Flatfile Controls');
      expect(sectionTitles(app.inspectorAside()), 'the Record Format section alone').toEqual(['Record Format']);
      const section = sectionOf(app, 'Record Format');
      const group = section.querySelectorAll('[role="group"][aria-label="Flatfile record format"]');
      expect(group, 'the four formats, as one group').toHaveLength(1);
      expect(group[0].querySelectorAll('button').map((b) => words(b.textContent)), 'GenBank, FASTA, EMBL and GFF3, in that order').toEqual(FORMATS.map((f) => f.button));
      for (const f of FORMATS) {
        expect(buttonsIn(app.doc.body, f.button), `${f.button}: drawn once in the page`).toHaveLength(1);
        expect(section.contains(button(app.doc.body, f.button)), `${f.button}: in the Record Format section`).toBe(true);
        expect(buttonsIn(app.canvas(), f.button), `${f.button}: not in the canvas`).toHaveLength(0);
      }
      const pressed = () => FORMATS.map((f) => button(sectionOf(app, 'Record Format'), f.button).getAttribute('aria-pressed'));
      expect(pressed(), 'GenBank chosen').toEqual(['true', 'false', 'false', 'false']);

      // The text toolbar stays above the text, in the canvas: it names the format and keeps Download.
      const toolbar = textToolbar(app);
      expect(app.canvas().contains(toolbar) && !app.inspectorAside()!.contains(toolbar), 'the toolbar in the canvas').toBe(true);
      expect(toolbarWords(app), 'its label, the format shown, and Download').toEqual(['Flatfile Record Format:', 'GenBank', 'Download .gb']);
      expect(flatfileText(app).startsWith('LOCUS'), 'a GenBank record').toBe(true);

      // Each format chosen in the inspector: the text, the toolbar and the downloaded file follow it.
      for (const f of [...FORMATS.slice(1), FORMATS[0]]) {
        await app.click(button(sectionOf(app, 'Record Format'), f.button));
        expect(pressed(), `${f.name} chosen`).toEqual(FORMATS.map((g) => String(g === f)));
        const text = flatfileText(app);
        expect(text.startsWith(f.head), `${f.name}: the text written as ${f.name}`).toBe(true);
        expect(toolbarWords(app), `${f.name}: the toolbar names it`).toEqual(['Flatfile Record Format:', f.name, `Download .${f.ext}`]);
        const before = app.downloads().length;
        await app.click(button(app.canvas(), `Download .${f.ext}`));
        const files = app.downloads();
        expect(files, `${f.name}: one file saved`).toHaveLength(before + 1);
        expect(files[before].filename).toBe(`TAZ7_Plasmid.${f.ext}`);
        expect(await files[before].text(), `${f.name}: the file is the text shown`).toBe(text);
      }
      const genbank = flatfileText(app);

      // Closed: the formats are drawn nowhere, the button stays, and Download keeps the choice.
      await app.click(button(sectionOf(app, 'Record Format'), 'FASTA (.fasta)'));
      await app.click(app.inspectorButton()!);
      expect(label(app.inspectorButton())).toBe('Show Flatfile Controls Inspector');
      expect(app.inspectorAside(), 'no column while closed').toBeNull();
      for (const f of FORMATS) expect(buttonsIn(app.doc.body, f.button), `${f.button}: not drawn while closed`).toHaveLength(0);
      expect(toolbarWords(app)).toEqual(['Flatfile Record Format:', 'FASTA', 'Download .fasta']);
      expect(flatfileText(app).startsWith('>') && flatfileText(app) !== genbank, 'still FASTA').toBe(true);
      // Opened again, the section is back with FASTA chosen.
      await app.click(app.inspectorButton()!);
      expect([label(app.inspectorButton()), paneTitle(app)]).toEqual(['Hide Flatfile Controls Inspector', 'Flatfile Controls']);
      expect(pressed()).toEqual(['false', 'true', 'false', 'false']);
    });
  });
});

// ─── AC2 ───

/** The alignment text's Format selects in `scope`: a select offering NEXUS. */
const formatSelects = (scope: LiveElement) => scope.querySelectorAll('select').filter((s) => s.options.some((o) => o.getAttribute('value') === 'NEXUS'));
/** The inspector as the App shows it: the button, the pane title, the column's sections, and the alignment grid's own panel. */
const shown = (app: AppHarness) => ({
  button: label(app.inspectorButton()),
  title: paneTitle(app),
  sections: sectionTitles(app.inspectorAside()),
  shell: app.all('.mbc-aln-inspector-shell').length,
});
const TEXT_OPEN = { button: 'Hide Flatfile Controls Inspector', title: 'Flatfile Controls', sections: ['Text Format'], shell: 0 };
const TEXT_CLOSED = { button: 'Show Flatfile Controls Inspector', title: null, sections: [], shell: 0 };
const GRID_OPEN = { button: 'Hide Alignment Controls Inspector', title: null, sections: [], shell: 1 };
const GRID_CLOSED = { button: 'Show Alignment Controls Inspector', title: null, sections: [], shell: 0 };
const alignmentText = (app: AppHarness) => {
  const pre = app.canvas().querySelectorAll('.mbc-aln-textview-scroll pre');
  expect(pre, 'the alignment text, as a file would hold it').toHaveLength(1);
  return pre[0].textContent;
};

describe("the alignment text's format (AC2)", () => {
  it("chooses the alignment text format in App's inspector", async () => {
    await withApp(async (app) => {
      await onTextTab(app, ALN);
      expect(app.activeTab()).toBe('text-view');
      expect(shown(app)).toEqual(TEXT_OPEN);

      // The Format select: drawn once, in the Text Format section, none in the canvas.
      const section = sectionOf(app, 'Text Format');
      expect(formatSelects(app.doc.body), 'one Format select in the page').toHaveLength(1);
      const select = () => formatSelects(sectionOf(app, 'Text Format'))[0];
      expect(section.contains(select()), 'in the Text Format section').toBe(true);
      expect(formatSelects(app.canvas()), 'none in the canvas').toHaveLength(0);
      expect(words(select().closest('label')?.querySelectorAll('span')[0]?.textContent ?? ''), 'labelled Format').toBe('Format:');
      expect(select().options.map((o) => o.getAttribute('value'))).toEqual(['Custom', 'GenBank', 'FASTA', 'Clustal', 'PHYLIP', 'NEXUS']);
      expect(select().value).toBe('Custom');

      // Copy, Export (and Display options, D0082) stay on the text's toolbar in the canvas.
      const toolbars = app.canvas().querySelectorAll('.mbc-aln-action-toolbar');
      expect(toolbars, "the text's toolbar in the canvas").toHaveLength(1);
      for (const text of ['Display options', 'Copy full sequence', 'Export as *.txt']) {
        expect(toolbars[0].contains(button(app.doc.body, text)), `${text}: on the toolbar`).toBe(true);
        expect(buttonsIn(app.inspectorAside()!, text), `${text}: not in the inspector`).toHaveLength(0);
      }

      // A format chosen in the inspector: the text, Copy and Export all use it.
      for (const [format, head] of [['Clustal', 'CLUSTAL'], ['FASTA', '>TAZ7_Member_A'], ['NEXUS', '#NEXUS']] as const) {
        await app.change(select(), format);
        expect(select().value).toBe(format);
        const text = alignmentText(app);
        expect(text.startsWith(head), `${format}: the text written as ${format}`).toBe(true);
        await app.click(button(app.canvas(), 'Copy full sequence'));
        expect(await navigator.clipboard.readText(), `${format}: Copy puts the text shown on the clipboard`).toBe(text);
        expect(words(toolbars[0].textContent)).toContain(`Copied 3 sequences (${format})`);
        const before = app.downloads().length;
        await app.click(button(app.canvas(), 'Export as *.txt'));
        const files = app.downloads();
        expect(files, `${format}: one file saved`).toHaveLength(before + 1);
        expect(files[before].filename).toBe(`TAZ7_Alignment_${format}.txt`);
        expect(await files[before].text(), `${format}: Export saves the text shown`).toBe(text);
      }

      // One inspector at a time (D0060, D0075): the MSA grid draws its own panel, the Text tab App's column.
      await app.clickTab('sequence-alignment');
      expect(shown(app), 'the MSA grid').toEqual(GRID_OPEN);
      expect(formatSelects(app.doc.body), 'no Format select beside the grid').toHaveLength(0);
      await app.click(app.inspectorButton()!);
      expect(shown(app), 'the grid closed').toEqual(GRID_CLOSED);
      await app.clickTab('text-view');
      expect(shown(app), 'the Text tab, still closed').toEqual(TEXT_CLOSED);
      expect(app.inspectorAside(), 'no column').toBeNull();
      expect(formatSelects(app.doc.body), 'the Format select drawn nowhere while closed').toHaveLength(0);
      expect(app.canvas().querySelectorAll('.mbc-aln-action-toolbar'), 'the toolbar stays').toHaveLength(1);
      await app.click(app.inspectorButton()!);
      expect(shown(app), 'the Text tab opened').toEqual(TEXT_OPEN);
      expect(formatSelects(app.doc.body)).toHaveLength(1);
      await app.clickTab('sequence-alignment');
      expect(shown(app), 'the grid opened with it').toEqual(GRID_OPEN);
    });
  });
});

// ─── AC3 ───

/** The electropherogram's dye-channel toggles in `scope`, by dye. */
const dyeToggles = (scope: LiveElement) =>
  scope.querySelectorAll('label.mbc-check-row').filter((l) => DYES.includes(words(l.textContent))).flatMap((l) => l.querySelectorAll('input[type="checkbox"]'));
const dyeToggle = (scope: LiveElement, dye: string) => {
  const found = scope.querySelectorAll('label.mbc-check-row').filter((l) => words(l.textContent) === dye).flatMap((l) => l.querySelectorAll('input[type="checkbox"]'));
  expect(found, `one ${dye} toggle`).toHaveLength(1);
  return found[0];
};
/** The dyes the electropherogram draws a trace for, by their stroke. */
function tracesDrawn(scope: LiveElement): string[] {
  const svgs = scope.querySelectorAll('svg[role="img"]').filter((s) => s.getAttribute('aria-label') === 'Electropherogram of TAZ7_Run');
  expect(svgs, 'one electropherogram').toHaveLength(1);
  const strokes = svgs[0].querySelectorAll('path').map((p) => p.getAttribute('stroke'));
  return DYES.filter((d) => strokes.includes(DYE_STROKES[d]));
}
/** The trace's head: the figure toolbar above the electropherogram. */
const traceHead = (scope: LiveElement) => {
  const heads = scope.querySelectorAll('section.mbc-fragment > .mbc-expr-head');
  expect(heads, "the trace's head").toHaveLength(1);
  return heads[0];
};
const rangeField = (scope: LiveElement, name: 'From' | 'To') => {
  const found = scope.querySelectorAll(`input[aria-label="${name}"]`);
  expect(found, `one ${name} field`).toHaveLength(1);
  return found[0];
};

describe("the fragment trace's dye channels (AC3)", () => {
  it("chooses the fragment trace's dye channels in App's inspector", async () => {
    await withApp(async (app) => {
      await onTextTab(app, FSA);
      expect(app.activeTab()).toBe('text-view');
      expect(label(app.inspectorButton())).toBe('Hide Text Controls Inspector');
      expect(paneTitle(app)).toBe('Text Controls');
      expect(sectionTitles(app.inspectorAside()), 'the Dye Channels section alone').toEqual(['Dye Channels']);

      // The four toggles: each drawn once, in the Dye Channels section, none on the trace.
      const section = sectionOf(app, 'Dye Channels');
      expect(dyeToggles(app.doc.body), 'four toggles in the page').toHaveLength(4);
      for (const dye of DYES) {
        const toggle = dyeToggle(app.doc.body, dye);
        expect(section.contains(toggle), `${dye}: in the Dye Channels section`).toBe(true);
        expect(toggle.checked, `${dye}: drawn`).toBe(true);
      }
      expect(dyeToggles(app.canvas()), 'no toggle in the canvas').toHaveLength(0);
      expect(tracesDrawn(app.canvas())).toEqual(DYES);

      // The range, Full range and the figure export stay on the trace's head, in the canvas.
      const head = traceHead(app.canvas());
      for (const name of ['From', 'To'] as const) expect(head.contains(rangeField(app.doc.body, name)), `${name}: on the trace`).toBe(true);
      const exportMenu = head.querySelectorAll('.mbc-figure-export');
      expect(exportMenu.length === 1 && button(exportMenu[0], 'Export') !== null, 'the figure export on the trace').toBe(true);
      expect(buttonsIn(app.inspectorAside()!, 'Export'), 'no export in the inspector').toHaveLength(0);
      expect(head.querySelectorAll('input[type="checkbox"]'), 'no toggle left in the head').toHaveLength(0);
      await app.input(rangeField(app.canvas(), 'From'), '100');
      const full = button(app.doc.body, 'Full range');
      expect(traceHead(app.canvas()).contains(full) && !app.inspectorAside()!.contains(full), 'Full range on the trace').toBe(true);
      await app.click(full);
      expect(buttonsIn(app.doc.body, 'Full range'), 'the whole run again').toHaveLength(0);

      // A dye cleared in the inspector leaves the trace, and comes back when ticked.
      await app.change(dyeToggle(sectionOf(app, 'Dye Channels'), 'VIC'), false);
      expect(tracesDrawn(app.canvas()), 'VIC hidden').toEqual(['6-FAM', 'NED', 'LIZ']);
      await app.change(dyeToggle(sectionOf(app, 'Dye Channels'), 'VIC'), true);
      expect(tracesDrawn(app.canvas()), 'VIC back').toEqual(DYES);
      await app.change(dyeToggle(sectionOf(app, 'Dye Channels'), 'NED'), false);
      expect(tracesDrawn(app.canvas())).toEqual(['6-FAM', 'VIC', 'LIZ']);

      // Closed, no toggle is drawn and the trace keeps the choice; opened again, NED is still cleared.
      await app.click(app.inspectorButton()!);
      expect(label(app.inspectorButton())).toBe('Show Text Controls Inspector');
      expect(app.inspectorAside()).toBeNull();
      expect(dyeToggles(app.doc.body), 'no toggle while closed').toHaveLength(0);
      expect(tracesDrawn(app.canvas())).toEqual(['6-FAM', 'VIC', 'LIZ']);
      for (const name of ['From', 'To'] as const) rangeField(traceHead(app.canvas()), name);
      await app.click(app.inspectorButton()!);
      expect(DYES.map((d) => dyeToggle(sectionOf(app, 'Dye Channels'), d).checked)).toEqual([true, true, false, true]);
    });
  });
});

// ─── AC4 ───

describe('the Text tab with nothing to set (AC4)', () => {
  it('offers no inspector on source text and notes', async () => {
    await withApp(async (app) => {
      const nothingToSet = async (doc: SequenceDocument, source: string | null) => {
        await onTextTab(app, doc);
        expect(app.activeTab(), doc.name).toBe('text-view');
        expect(app.inspectorButton(), `${doc.name}: no inspector button`).toBeNull();
        expect(app.inspectorAside(), `${doc.name}: no inspector column`).toBeNull();
        expect(app.all('[aria-label$=" Inspector"]'), `${doc.name}: no inspector control anywhere`).toHaveLength(0);
        expect(app.all('.mbc-accordion-section'), `${doc.name}: no section anywhere`).toHaveLength(0);
        if (source !== null) {
          // Its source text, as stored, with Download source beside its name.
          expect(app.one('.mbc-flatfile-pre').textContent, `${doc.name}: its source text`).toBe(source);
          button(app.canvas(), 'Download source');
        }
      };
      await nothingToSet(TREE, String(TREE.docMetadata!.Newick));
      await nothingToSet(PDB, PDB_TEXT);
      await nothingToSet(CIF, String(CIF.docMetadata!.PDBText));
      await nothingToSet(NOTES, null);
      await nothingToSet(EXPRESSION, null);

      // The expression table keeps its Significant only filter, a filter of the table (D0060 ruling 3).
      const bars = app.canvas().querySelectorAll('section.mbc-expr .mbc-expr-table-bar');
      expect(bars, "the expression table's bar").toHaveLength(1);
      const significant = app.all('label.mbc-check-row').filter((l) => words(l.textContent) === 'Significant only');
      expect(significant, 'one Significant only filter').toHaveLength(1);
      expect(bars[0].contains(significant[0]), 'beside its table').toBe(true);
      const filter = significant[0].querySelectorAll('input[type="checkbox"]')[0];
      expect(filter.checked).toBe(true);
      const rows = () => app.canvas().querySelectorAll('table.mbc-expr-table tbody tr').map((r) => words(r.querySelectorAll('td')[0].textContent));
      expect(rows().sort(), 'the significant genes').toEqual(['geneA', 'geneB']);
      await app.change(filter, false);
      expect(rows().sort(), 'every gene').toEqual(['geneA', 'geneB', 'geneC', 'geneD']);
      expect(app.inspectorButton(), 'still no button').toBeNull();

      // The same Text tab on a sequence record has a setting, so its button comes back.
      await onTextTab(app, PLASMID);
      expect(label(app.inspectorButton())).toBe('Hide Flatfile Controls Inspector');
    });
  });
});

// ─── AC7 ───

/** Draws `element` on its own: its own React root in the launched App's window, with no WorkbenchInspectorProvider above it. */
async function drawnOnItsOwn(app: AppHarness, element: (React: typeof import('react')) => import('react').ReactElement, check: (probe: LiveElement) => Promise<void> | void) {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const probe = app.doc.createElement('div');
  app.doc.body.appendChild(probe);
  const root = createRoot(probe as unknown as Element);
  try {
    await React.act(async () => { root.render(element(React)); });
    await app.settle();
    expect(probe.querySelectorAll('.mbc-inspector-sections, .mbc-accordion-section, .mbc-accordion-header, .mbc-accordion-body'), 'drawn on its own: no inspector wrapper, section or header').toHaveLength(0);
    await check(probe);
  } finally {
    await React.act(async () => { root.unmount(); });
    probe.remove();
  }
}
/** No element in `probe` whose own words are a section title. */
const noSectionTitle = (probe: LiveElement, title: string) =>
  expect(probe.querySelectorAll('*').filter((e) => words(e.textContent) === title), `no "${title}" title on its own`).toHaveLength(0);

// Drawn on its own, each setting stays where it sat before this story, drawn once, with no inspector
// wrapper (D0063 ruling f). These fail for a setting dropped from the standalone path, one drawn twice,
// and one wrapped in inspector markup on its own.
describe('drawn on its own (AC7)', () => {
  it('keeps its settings in place when rendered on its own, AlignmentTextStream', async () => {
    await withApp(async (app) => {
      const { AlignmentTextStream } = await import('../components/AlignmentAndPhyloStudio');
      await drawnOnItsOwn(app, (React) => React.createElement(AlignmentTextStream, { doc: ALN }), async (probe) => {
        noSectionTitle(probe, 'Text Format');
        const selects = formatSelects(probe);
        expect(selects, 'the Format select: drawn once').toHaveLength(1);
        const select = selects[0];
        expect(unwrapped(select), 'no inspector wrapper').toBe(true);
        // First on the text's toolbar: its label, then Display options, Copy and Export.
        const field = select.closest('label');
        expect(field !== null && field.classList.contains('mbc-aln-inline-select') && words(field.querySelectorAll('span')[0].textContent) === 'Format:', 'in its Format label').toBe(true);
        const left = field!.parentElement!;
        expect(left.classList.contains('mbc-aln-toolbar-left') && left.parentElement!.classList.contains('mbc-aln-action-toolbar') && left.parentElement!.parentElement!.classList.contains('mbc-aln-text-stream'),
          "in the left of the text's toolbar").toBe(true);
        expect(left.children.map((c) => (c === field ? 'Format' : words(c.textContent))), 'the Format label, then the buttons').toEqual(['Format', 'Display options', 'Copy full sequence', 'Export as *.txt']);
        expect(select.value).toBe('Custom');
        // It still sets the text drawn beside it.
        await app.change(select, 'FASTA');
        const pre = probe.querySelectorAll('.mbc-aln-textview-scroll pre');
        expect(pre.length === 1 && pre[0].textContent.startsWith('>TAZ7_Member_A'), 'the text, as FASTA').toBe(true);
        expect(formatSelects(probe), 'still one Format select').toHaveLength(1);
      });
    });
  });

  it('keeps its settings in place when rendered on its own, FragmentTraceView', async () => {
    await withApp(async (app) => {
      const { FragmentTraceView } = await import('../components/FragmentViews');
      await drawnOnItsOwn(app, (React) => React.createElement(FragmentTraceView, { doc: FSA }), async (probe) => {
        noSectionTitle(probe, 'Dye Channels');
        expect(dyeToggles(probe), 'four toggles, each drawn once').toHaveLength(4);
        // In the trace's head, between its sizing note and its range: the head as it was.
        const head = traceHead(probe);
        const kids = head.children;
        expect(kids.map((k) => k.localName), "the head's children").toEqual(['strong', 'span', 'label', 'label', 'label', 'label', 'span', 'div']);
        expect(words(kids[0].textContent)).toBe('Electropherogram');
        expect(kids.slice(2, 6).map((k) => words(k.textContent)), 'one toggle per dye, in channel order').toEqual(DYES);
        for (const [i, dye] of DYES.entries()) {
          const toggle = dyeToggle(probe, dye);
          expect(kids[2 + i].contains(toggle) && unwrapped(toggle), `${dye}: in its row of the head, no inspector wrapper`).toBe(true);
          expect(toggle.checked).toBe(true);
        }
        expect(kids[6].classList.contains('prefs-row') && kids[6].contains(rangeField(probe, 'From')), 'the range after the toggles').toBe(true);
        expect(kids[7].classList.contains('mbc-figure-export'), 'the figure export last').toBe(true);
        // A toggle still hides its trace.
        expect(tracesDrawn(probe)).toEqual(DYES);
        await app.change(dyeToggle(probe, 'LIZ'), false);
        expect(tracesDrawn(probe)).toEqual(['6-FAM', 'VIC', 'NED']);
      });
    });
  });
});
