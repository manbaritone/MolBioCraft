// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TAKR: each Genomics sub-tab's parameters in App's shared inspector, titled "Genomics
 * Controls" ("3D Structure Controls" for a protein record), with the documents compared and the
 * GenBank submission fields left in the cards:
 * - NGS: Read Trimming (BBDuk k, min end Q), Read Mapping (the mapper) and De Novo Assembly (the
 *   engine and min overlap); the reference and read pickers stay in the mapper's card;
 * - Genome & variants: Genome Alignment (the engine) and STR Genotyping (min repeats); the genome
 *   compared against stays in the alignment card;
 * - Genes, CpG & repeats: Gene Prediction, CpG Islands, Genomic Repeats and TF Motif Scan, one
 *   minimum each;
 * - 3D: a Structure section with Show all chains, only for the record's own multi-chain structure
 *   with no file loaded over it, and no section (and no button) otherwise;
 * - Transform & submit: Benchmark Generator (mode, mutation rate, PRNG seed).
 *
 * Every check but the last five mounts the real App over the live DOM with the US-01M6TB6G harness,
 * restores records built here on the Genomics tab, and reads App's own header button, pane title
 * and aside.mbc-right-controls; a setting is driven by editing it in that column. Each result a
 * moved setting changes is compared with this launch's engine called with the values the test
 * chose, never with what the studio shows, and each fixture is checked to give a different result
 * for the values compared, so a control wired to nothing cannot pass. No check builds a provider,
 * reads component source or reads test-data.
 *
 * Wrong implementations, and the check that fails for each: a setting left in the canvas, drawn
 * twice, in another section or drawn in the inspector with its standalone inline look; a picker or
 * a GenBank field moved into the inspector; sections out of order; a button offered on the 3D
 * sub-tab of a DNA record, a single-chain structure or a file loaded over the record (AC2), or the
 * 3D viewer's own style and colour moved off the figure; a moved control wired to nothing, a result
 * left on the old value, or a value kept in the section rather than the studio, so a sub-tab switch
 * or a close loses it (AC3, AC4); a repeat scan per keystroke, or the draft or its settle timer kept
 * in the inspector's field, so a close drops it (AC4); a menu command that opens the wrong sub-tab,
 * or whose repeat (commandNonce) no longer re-applies it (AC7).
 *
 * The studio drawn on its own (AC8), with no provider, is checked by the "keeps its settings in
 * place when rendered on its own" tests: every moved setting drawn once, in its card's own row,
 * beside the same neighbours and with the same inline look as before, with no inspector wrapper.
 * They fail for a setting dropped on its own, drawn twice (a section drawn there as well) or in
 * another row, and for an inWorkbench guard dropped (the inspector's labelled field, or a box
 * without its fixed width, drawn on its own).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent, LiveElement } from './liveDom';

/**
 * The repeat scans the studio runs (BG-01M6SQ9T): the engine's own scan, recorded with its arm.
 * Vitest runs a vi.mock factory once per test file, so every launch shares this one wrapper.
 */
const repeatScans = vi.hoisted(() => ({ calls: [] as { seq: string; arm: number }[] }));
vi.mock('../core/genomicsAndStructureSuite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/genomicsAndStructureSuite')>();
  return {
    ...actual,
    findGenomicRepeats: (seq: string, arm?: number) => {
      repeatScans.calls.push({ seq, arm: arm ?? 10 });
      return actual.findGenomicRepeats(seq, arm);
    },
  };
});

// Each check launches the App afresh.
vi.setConfig({ testTimeout: 90_000 });

async function withApp(run: (app: AppHarness) => Promise<void>): Promise<void> {
  const app = await mountApp();
  try {
    await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Records built in the test ───

/** Deterministic letters (LCG) from `alphabet`, the same for the same seed. */
function lettersFrom(seed: number, n: number, alphabet = 'ACGT'): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((s / 2 ** 32) * alphabet.length)];
  }
  return out;
}
const plant = (seq: string, at: number, piece: string) => seq.slice(0, at) + piece + seq.slice(at + piece.length);
const SWAP: Record<string, string> = { A: 'C', C: 'G', G: 'T', T: 'A' };
/** `seq` with every `every`th base (from `from`) swapped for another. */
const substituted = (seq: string, every: number, from: number) => [...seq].map((b, i) => (i % every === from ? SWAP[b] : b)).join('');
/** An open reading frame behind a Shine-Dalgarno site: ATG, `codons` sense codons, TAA. */
function readingFrame(seed: number, codons: number): string {
  const stops = new Set(['TAA', 'TAG', 'TGA']);
  let body = '';
  for (let k = 0; body.length < codons * 3; k++) {
    const codon = lettersFrom(seed + k, 3);
    if (!stops.has(codon)) body += codon;
  }
  return `AGGAGGTAACACATG${body}TAA`;
}

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};

/**
 * A 6,000 bp genome: a 500 bp C/G-only stretch (CpG islands), three STRs of 5, 6 and 8 copies, a
 * 120-codon reading frame, a 40 bp direct repeat, and an 11-mer from inside the Illumina TruSeq
 * adapter at 5,201 (found as an adapter with k = 11 only). Its Phred scores are 12 over the first 10
 * bases and 18 over the next 10, so the trimmer keeps different 5' ends at Q 20 and Q 15.
 */
const GENOME_SEQ = (() => {
  let g = lettersFrom(0x7a4b, 6000);
  g = plant(g, 300, lettersFrom(0xc9c9, 500, 'CG'));
  g = plant(g, 1200, 'AC'.repeat(5));
  g = plant(g, 1300, 'TG'.repeat(6));
  g = plant(g, 1400, 'GATA'.repeat(8));
  g = plant(g, 2000, readingFrame(0x0f0f, 120));
  g = plant(g, 3400, g.slice(2600, 2640));
  return plant(g, 5200, 'GCACGTCTGAACG');
})();
const PHRED = [...GENOME_SEQ].map((_, i) => (i < 10 ? 12 : i < 20 ? 18 : 35));
const GENOME: SequenceDocument = {
  ...BLANK, id: 'takr-genome', name: 'TAKR_Genome', accession: 'TAKR_0001', description: 'A genome built in the test', sequence: GENOME_SEQ,
  chromatogram: { traceA: [], traceC: [], traceG: [], traceT: [], peakLocations: [], phredScores: PHRED, baseCalls: GENOME_SEQ },
};
/** The genome with one base in 97 substituted: the partner it is compared against. */
const PARTNER: SequenceDocument = { ...BLANK, id: 'takr-partner', name: 'TAKR_Partner', accession: 'TAKR_0002', sequence: substituted(GENOME_SEQ, 97, 50) };
/** 400 bp of the genome (1,001..1,400) with one base in 12 substituted: BBMap's 9-mer seeds place it, Minimap2's 13-mers cannot. */
const READ: SequenceDocument = { ...BLANK, id: 'takr-read', name: 'TAKR_Read', accession: 'TAKR_0003', sequence: substituted(GENOME_SEQ.slice(1000, 1400), 12, 6) };
/** Two unrelated reads that overlap by 30 bp: joined at a minimum overlap of 19, not of 40. */
const READ_A_SEQ = lettersFrom(0xaaaa, 300);
const READ_A: SequenceDocument = { ...BLANK, id: 'takr-read-a', name: 'TAKR_ReadA', accession: 'TAKR_0004', sequence: READ_A_SEQ };
const READ_B: SequenceDocument = { ...BLANK, id: 'takr-read-b', name: 'TAKR_ReadB', accession: 'TAKR_0005', sequence: READ_A_SEQ.slice(270) + lettersFrom(0xbbbb, 270) };
const DNA_DOCS = [GENOME, PARTNER, READ, READ_A, READ_B];

/** Cα records in fixed-column PDB, one helix per chain, as caAtomsToPdb writes them. */
const THREE: Record<string, string> = {
  A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY', H: 'HIS', I: 'ILE',
  L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL',
};
const col = (s: string | number, w: number) => String(s).padStart(w).slice(0, w);
function caPdb(chains: { id: string; seq: string; dx: number }[]): string {
  let serial = 0;
  const lines: string[] = [];
  for (const { id, seq, dx } of chains) {
    [...seq].forEach((aa, i) => {
      const t = (i * 100 * Math.PI) / 180;
      const [x, y, z] = [dx + 2.3 * Math.cos(t), 2.3 * Math.sin(t), 1.5 * i];
      lines.push(`ATOM  ${col(++serial, 5)}  CA  ${THREE[aa]} ${id}${col(i + 1, 4)}    ${col(x.toFixed(3), 8)}${col(y.toFixed(3), 8)}${col(z.toFixed(3), 8)}  1.00 20.00           C`);
    });
    lines.push('TER');
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}
const CHAIN_A = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLI';
const CHAIN_B = 'GSHMLEDPVRAELQKLLEEAKRLAEEGNVA';
/** A two-chain structure, imported as one document per chain: this is chain A's. */
const PROTEIN_2: SequenceDocument = {
  ...BLANK, id: 'takr-dimer-a', name: 'TAKR_Dimer_A', accession: 'TAKR_0006', moleculeType: 'Protein', folder: 'Protein Documents', sequence: CHAIN_A,
  docMetadata: { PDBText: caPdb([{ id: 'A', seq: CHAIN_A, dx: 0 }, { id: 'B', seq: CHAIN_B, dx: 15 }]), Chain: 'A' },
};
/** A one-chain structure. */
const PROTEIN_1: SequenceDocument = {
  ...BLANK, id: 'takr-monomer', name: 'TAKR_Monomer', accession: 'TAKR_0007', moleculeType: 'Protein', folder: 'Protein Documents', sequence: CHAIN_B,
  docMetadata: { PDBText: caPdb([{ id: 'A', seq: CHAIN_B, dx: 0 }]), Chain: 'A' },
};

const onGenomics = (app: AppHarness, viewerTab: 'genomics-ngs' | 'sequence-view' = 'genomics-ngs') =>
  app.restoreSession({ documents: DNA_DOCS, activeDocId: GENOME.id, viewerTab });
const onStructure = (app: AppHarness, active: SequenceDocument) =>
  app.restoreSession({ documents: [PROTEIN_2, PROTEIN_1, GENOME], activeDocId: active.id, viewerTab: 'genomics-ngs' });

/** This launch's engine, loaded after the App (one module at a time). */
async function engine() {
  const suite = await import('../core/genomicsAndStructureSuite');
  const rust = await import('../lib/rustBioEngine');
  return { suite, rust };
}
type Engine = Awaited<ReturnType<typeof engine>>;

// ─── Time and the scans that run after a paint ───

/** Moves the App's fake clock on by `ms` and lets the page settle. */
async function wait(app: AppHarness, ms: number) {
  const React = await import('react');
  await React.act(async () => { vi.advanceTimersByTime(ms); });
  await app.settle();
}
const busyScans = (app: AppHarness) => app.all('[data-mbc-scan][aria-busy="true"]');
/** Lets every scan that waits for a painted frame (synteny, genes, CpG; BG-01M6T6HW) land. */
async function landScans(app: AppHarness) {
  for (let round = 0; round < 8 && busyScans(app).length; round++) await wait(app, 0);
  expect(busyScans(app).map((s) => s.getAttribute('data-mbc-scan')), 'every scan has landed').toEqual([]);
}

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
/** The value an element's inline style declares for `prop`. */
const declared = (el: LiveElement, prop: string) => el.style.getPropertyValue(prop);
/** Every declaration of an element's inline style, by CSS name. */
const inlineStyle = (el: LiveElement) => Object.fromEntries(el.style.entries());
const sectionTitle = (s: LiveElement) => words(s.querySelectorAll('button.mbc-accordion-header')[0]?.textContent ?? '');

/** The inspector as App shows it: the button's label, the pane title and its sections' titles in their CSS order. */
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
const OPEN = { button: 'Hide Genomics Controls Inspector', title: 'Genomics Controls' };
const CLOSED = { button: 'Show Genomics Controls Inspector', title: null, sections: [] };
const OPEN_3D = { button: 'Hide 3D Structure Controls Inspector', title: '3D Structure Controls' };
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

// ─── The studio's sub-tabs, sections and settings ───

type SubTab = 'ngs' | 'genome' | 'genes' | '3d' | 'transform';
const SUB_TAB_LABELS: Record<SubTab, string> = {
  ngs: 'NGS Trim, Map & Assemble',
  genome: 'Whole-Genome, Variants, STR & 16S',
  genes: 'Glimmer Genes, CpG & Repeats',
  '3d': 'Coiled-Coils, Transmembrane & 3D PDB',
  transform: 'Transform, Mutate/Shuffle & GenBank Submit',
};
const subTabButtons = (scope: LiveElement) =>
  scope.querySelectorAll('[role="tablist"][aria-label="Genomics and Structure Modules"] button[role="tab"]');
function selectedSubTab(app: AppHarness): string {
  const on = subTabButtons(app.canvas()).filter((b) => b.getAttribute('aria-selected') === 'true');
  expect(on, 'one selected Genomics sub-tab').toHaveLength(1);
  return words(on[0].textContent);
}
/** Clicks the studio's own sub-tab, as a user does, and lets its scans land. */
async function openSubTab(app: AppHarness, tab: SubTab) {
  const hit = subTabButtons(app.canvas()).filter((b) => words(b.textContent) === SUB_TAB_LABELS[tab] && !b.hasAttribute('hidden'));
  expect(hit, `one "${SUB_TAB_LABELS[tab]}" sub-tab`).toHaveLength(1);
  await app.click(hit[0]);
  await landScans(app);
  expect(selectedSubTab(app)).toBe(SUB_TAB_LABELS[tab]);
}

const K = 'BBDuk Adapter K-mer Length (k):';
const MIN_Q = 'Min End Phred Quality (Q):';
const MAPPER = 'Mapping Algorithm:';
const ASSEMBLER = 'Built-In Assembly Engine:';
const OVERLAP = 'Min Overlap / K-mer Size (bp):';
const SYNTENY_ENGINE = 'Genome Alignment Engine:';
const MIN_STR = 'Min STR Repeats:';
const MIN_AA = 'Min Protein Length (aa):';
const MIN_CPG = 'Min CpG Island (bp):';
const MIN_ARM = 'Min Repeat Arm:';
const MIN_SCORE = 'Min Score:';
const MODE = 'Benchmark Generator Mode:';
const RATE = 'Mutation Rate (%):';
const SEED = 'PRNG Seed:';
const ALL_CHAINS = 'Show all 2 chains of the structure';

/** Each sub-tab's sections, in order, and the settings each holds, in order. */
const SECTIONS: Record<SubTab, [string, string[]][]> = {
  ngs: [['Read Trimming', [K, MIN_Q]], ['Read Mapping', [MAPPER]], ['De Novo Assembly', [ASSEMBLER, OVERLAP]]],
  genome: [['Genome Alignment', [SYNTENY_ENGINE]], ['STR Genotyping', [MIN_STR]]],
  genes: [['Gene Prediction', [MIN_AA]], ['CpG Islands', [MIN_CPG]], ['Genomic Repeats', [MIN_ARM]], ['TF Motif Scan', [MIN_SCORE]]],
  '3d': [],
  transform: [['Benchmark Generator', [MODE, RATE, SEED]]],
};
const EVERY_SETTING = Object.values(SECTIONS).flatMap((s) => s.flatMap(([, names]) => names));
/** The pickers and fields each sub-tab keeps in its cards. */
const KEPT_IN_CARDS: Record<SubTab, string[]> = {
  ngs: ['Reference Sequence:', 'Query Read / Amplicon:'],
  genome: [`Compare ${GENOME.name} Against:`],
  genes: [],
  '3d': [],
  transform: ['Source Organism:', 'Strain / Isolate:', 'Molecule Type ([moltype]):', 'NCBI Genetic Code ([gcode]):'],
};
/** The words a control's label gives it (the span a labelled field opens with). */
const controlName = (c: LiveElement) => (c.labels[0] ? ownWords(c.labels[0]) : c.getAttribute('aria-label'));

/**
 * The sub-tab's sections as App shows them, each holding its settings and nothing else, each drawn
 * as a labelled field of the inspector (no inline look or fixed width), and its pickers in the canvas.
 */
function expectSections(app: AppHarness, tab: SubTab) {
  expect(shown(app), tab).toEqual({ ...OPEN, sections: SECTIONS[tab].map(([title]) => title) });
  for (const [title, names] of SECTIONS[tab]) {
    for (const name of names) {
      const control = inSection(app, title, name);
      const label = control.labels[0];
      expect(label.classList.contains('form-field') && Object.keys(inlineStyle(label)).length === 0,
        `${name}: a labelled field of the inspector`).toBe(true);
      expect(declared(control, 'width'), `${name}: no fixed width in the inspector`).toBe('');
    }
    expect(sectionBody(app, title).querySelectorAll('input, select').map(controlName), `the ${title} section holds its settings alone`).toEqual(names);
  }
  for (const name of KEPT_IN_CARDS[tab]) {
    field(app.canvas(), name);
    expect(fields(app.inspectorAside()!, name), `${name} stays in its card`).toHaveLength(0);
  }
  const elsewhere = EVERY_SETTING.filter((n) => !SECTIONS[tab].some(([, names]) => names.includes(n)));
  for (const name of elsewhere) expect(fields(app.doc.body, name), `${tab}: no ${name}`).toHaveLength(0);
}

// ─── Reading the cards ───

/** The studio card in the canvas whose heading starts with `heading`. */
function card(app: AppHarness, heading: string): LiveElement {
  const found = app.canvas().querySelectorAll('.studio-card').filter((c) => words(c.querySelectorAll('.studio-card-header h3')[0]?.textContent ?? '').startsWith(heading));
  expect(found, `one "${heading}" card`).toHaveLength(1);
  return found[0];
}
/** The key figures a card shows, by their labels. */
const kpis = (scope: LiveElement) =>
  Object.fromEntries(scope.querySelectorAll('.kpi-box').map((k) => [words(k.querySelectorAll('.kpi-label')[0].textContent), words(k.querySelectorAll('.kpi-val')[0].textContent)]));
const pick = (all: Record<string, string>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, all[k]]));
/** The words of the one element in `scope` matching `selector` whose words start with `start`. */
function textOf(scope: LiveElement, selector: string, start: string): string {
  const found = scope.querySelectorAll(selector).filter((e) => words(e.textContent).startsWith(start));
  expect(found, `one ${selector} reading "${start}…"`).toHaveLength(1);
  return words(found[0].textContent);
}

const TRIMMER = 'BBDuk Adapter/Quality Trimmer';
const ASSEMBLER_CARD = 'De Novo & Contig Assembler';
const ALIGNMENT_CARD = 'Whole-Genome Alignment';
const VARIANT_CARD = 'Sequence Variant Finder';
const GENE_CARD = 'Glimmer Microbial Gene Predictor';
const CPG_CARD = 'CpG Islands & Genomic Repeat Finder';
const GENERATOR_CARD = 'Complement / Reverse Only & Mutate / Shuffle Generator';
const GENBANK_CARD = 'NCBI GenBank Direct Submission Validator';
const n = (v: number) => v.toLocaleString('en-US');

/** What the trimmer card says for k and Q, from the engine. */
function trimmed(e: Engine, k: number, q: number) {
  const r = e.suite.runBbdukReadTrimming(GENOME_SEQ, PHRED, { kmerLen: k, minPhredQuality: q });
  return {
    [`Trimmed Read (${GENOME.name})`]: `${r.trimmedLengthBp.toLocaleString()} / ${r.originalLengthBp.toLocaleString()} bp (${r.retainedPercent}%)`,
    "5' / 3' Bases Trimmed": `${r.basesRemoved5Prime} bp / ${r.basesRemoved3Prime} bp`,
    'Adapter Hits Detected': String(r.adapterMatches.length),
  };
}
/** What the trimmer card says of the read mapped with `mapper`, from the engine. */
function mapped(e: Engine, mapper: 'Minimap2' | 'Bowtie2' | 'BBMap') {
  const r = e.suite.runNgsReferenceMapping(GENOME_SEQ, READ.sequence, mapper);
  return {
    'Mapped Span & Strand': `${r.refStartBp}..${r.refEndBp} (${r.strand})`,
    'Identity & MAPQ': `${r.identityPercent}% (MAPQ ${r.mapqScore})`,
    'CIGAR & Breadth': `${r.cigar} (${r.coverageBreadthPercent}%)`,
  };
}
/** What the assembler card says, and the contigs it lists, from the engine (no reads ticked: every document). */
function assembled(e: Engine, engineName: 'CAP3' | 'Velvet' | 'Flye' | 'MIRA', overlap: number) {
  const r = e.suite.runDeNovoAssembly(DNA_DOCS.map((d) => ({ name: d.name, sequence: d.sequence })), engineName, overlap);
  return {
    kpis: {
      'Contigs Assembled': `${r.contigCount} (from ${r.inputReadCount} inputs)`,
      'N50 / L50': `${r.n50Bp.toLocaleString()} bp / L50=${r.l50Count}`,
      'Total Assembled': `${r.totalAssembledBp.toLocaleString()} bp`,
    },
    contigs: r.contigs.map((c) => c.name),
  };
}
const contigNames = (app: AppHarness) =>
  app.one('[role="region"][aria-label="Assembled Contigs"]', 'the contigs table').querySelectorAll('tbody th[scope="row"]').map((t) => words(t.textContent));
/** The repeat table's caption for an arm, from the engine, as BG-01M6SQ9T's suite builds it. */
function repeatCaption(e: Engine, arm: number): string {
  const scan = e.suite.findGenomicRepeats(GENOME_SEQ, arm);
  const count = scan.repeats.length < scan.totalRepeats ? `top ${n(scan.repeats.length)} of ${n(scan.totalRepeats)}` : n(scan.totalRepeats);
  return `Direct, Inverted & Palindromic Repeats (arms ≥ ${arm} bp, ${count})`;
}
const shownRepeatCaption = (app: AppHarness) => textOf(app.canvas(), '.mbc-table-caption', 'Direct, Inverted & Palindromic Repeats');
/** What the generator card says, from the engine. */
function generated(e: Engine, mode: 'shuffle-dinucleotide' | 'shuffle-mononucleotide' | 'point-mutate', rate: number, seed: number) {
  const r = e.suite.mutateAndShuffleSequence(GENOME_SEQ, { mode, mutationRatePercent: rate, seed });
  return {
    'Positions Changed': `${r.mutationsApplied.toLocaleString()} / ${r.originalLengthBp.toLocaleString()} bp`,
    '%GC (Original → Output)': `${r.gcOriginalPct}% → ${r.gcOutputPct}%`,
    'Dinucleotide Conservation': `${(r.dinucleotideCorrelation * 100).toFixed(1)}%`,
  };
}
const distinct = (...xs: unknown[]) => new Set(xs.map((x) => JSON.stringify(x))).size === xs.length;

/** The genome's repeat scans the studio has run since the last clear, by arm. */
const armsScanned = () => repeatScans.calls.filter((c) => c.seq === GENOME_SEQ).map((c) => c.arm);
const clearScans = () => { repeatScans.calls.length = 0; };

// ─── AC1 ───

describe("each sub-tab's parameters in App's inspector (AC1)", () => {
  it("puts each sub-tab's parameters in App's inspector", async () => {
    await withApp(async (app) => {
      await onGenomics(app);
      await landScans(app);
      expect(app.activeTab()).toBe('genomics-ngs');
      expect(selectedSubTab(app), 'the studio opens on NGS').toBe(SUB_TAB_LABELS.ngs);

      // App's own header button, pane title and column, holding the NGS sections.
      const aside = app.inspectorAside()!;
      expect(aside.closest('.mbc-viewer-body-split') === app.bodySplit() && aside.localName === 'aside' && aside.classList.contains('mbc-right-controls'),
        "the sections sit in App's aside.mbc-right-controls").toBe(true);
      expectSections(app, 'ngs');
      expect([K, MIN_Q].map((name) => inSection(app, 'Read Trimming', name).value), 'BBDuk k and Q as the studio opens').toEqual(['11', '20']);
      expect(inSection(app, 'Read Mapping', MAPPER).value).toBe('Minimap2');
      expect([ASSEMBLER, OVERLAP].map((name) => inSection(app, 'De Novo Assembly', name).value)).toEqual(['CAP3', '19']);
      // The reference and read pickers stay in the trimmer's card, beside the results they choose.
      for (const name of KEPT_IN_CARDS.ngs) expect(card(app, TRIMMER).contains(field(app.canvas(), name)), `${name} in the trimmer's card`).toBe(true);

      await openSubTab(app, 'genome');
      expectSections(app, 'genome');
      expect([inSection(app, 'Genome Alignment', SYNTENY_ENGINE).value, inSection(app, 'STR Genotyping', MIN_STR).value]).toEqual(['Mauve', '4']);
      expect(card(app, ALIGNMENT_CARD).contains(field(app.canvas(), KEPT_IN_CARDS.genome[0])), 'the genome compared against stays with the alignment').toBe(true);

      await openSubTab(app, 'genes');
      expectSections(app, 'genes');
      expect(SECTIONS.genes.map(([title, [name]]) => inSection(app, title, name).value)).toEqual(['45', '200', '10', '0.84']);

      await openSubTab(app, 'transform');
      expectSections(app, 'transform');
      expect([MODE, RATE, SEED].map((name) => inSection(app, 'Benchmark Generator', name).value)).toEqual(['shuffle-dinucleotide', '2.5', '20261030']);
      // The GenBank submission fields stay in their own card.
      const genbank = card(app, GENBANK_CARD);
      for (const name of KEPT_IN_CARDS.transform) expect(genbank.contains(field(app.canvas(), name)), `${name} in the GenBank card`).toBe(true);

      // The 3D sub-tab of a DNA record has nothing to set: no button, no column.
      await openSubTab(app, '3d');
      expect(shown(app), '3D on a DNA record').toEqual(NONE);
      expect(app.inspectorAside(), 'no column').toBeNull();
      for (const name of [...EVERY_SETTING, ALL_CHAINS]) expect(fields(app.doc.body, name), `3D: no ${name}`).toHaveLength(0);

      // Closed, the settings are drawn nowhere and the button stays; the cards keep their results.
      await openSubTab(app, 'genes');
      expectSections(app, 'genes');
      await app.click(app.inspectorButton()!);
      expect(shown(app), 'closed').toEqual(CLOSED);
      expect(app.inspectorAside(), 'no column while closed').toBeNull();
      for (const name of EVERY_SETTING) expect(fields(app.doc.body, name), `${name} not drawn while closed`).toHaveLength(0);
      card(app, GENE_CARD);
      card(app, CPG_CARD);
      await app.click(app.inspectorButton()!);
      expectSections(app, 'genes');
    });
  });
});

// ─── AC2 ───

describe('the chain toggle (AC2)', () => {
  it('offers the chain toggle only for a multi-chain structure', async () => {
    await withApp(async (app) => {
      // A chain of a two-chain structure: the record's own tab is the 3D Structure tab, with one sub-tab.
      await onStructure(app, PROTEIN_2);
      await landScans(app);
      expect(subTabButtons(app.canvas()).filter((b) => !b.hasAttribute('hidden')).map((b) => words(b.textContent)), 'a protein record has the 3D sub-tab alone')
        .toEqual([SUB_TAB_LABELS['3d']]);
      expect(shown(app), 'a two-chain structure').toEqual({ ...OPEN_3D, sections: ['Structure'] });
      const toggle = inSection(app, 'Structure', ALL_CHAINS);
      expect([toggle.getAttribute('type'), toggle.checked]).toEqual(['checkbox', false]);
      expect(sectionBody(app, 'Structure').querySelectorAll('input, select').map(controlName), 'the toggle alone').toEqual([ALL_CHAINS]);
      // The pickers and the 3D viewer's own style and colour stay on the figure.
      const figure = card(app, '3D Structure & Superposition');
      for (const name of ['Compare with:', '3D Representation Style', '3D Color Scheme']) {
        expect(figure.contains(field(app.canvas(), name)), `${name} on the 3D card`).toBe(true);
        expect(fields(app.inspectorAside()!, name), `${name} not in the inspector`).toHaveLength(0);
      }

      // Ticked in the inspector, the viewer draws both chains; cleared, chain A again.
      const viewerTitle = () => {
        const head = figure.querySelectorAll('strong').filter((s) => words(s.textContent).startsWith(PROTEIN_2.name));
        expect(head, "the viewer's title").toHaveLength(1);
        const badge = head[0].parentElement!.querySelectorAll('.badge-accent').filter((b) => / Cα$/.test(words(b.textContent)));
        return [words(head[0].textContent), words(badge[0]?.textContent ?? '')];
      };
      expect(viewerTitle(), 'chain A alone').toEqual([PROTEIN_2.name, `${CHAIN_A.length} Cα`]);
      await app.change(toggle, true);
      expect(inSection(app, 'Structure', ALL_CHAINS).checked).toBe(true);
      expect(viewerTitle(), 'both chains').toEqual([`${PROTEIN_2.name} (all chains)`, `${CHAIN_A.length + CHAIN_B.length} Cα`]);
      await app.change(inSection(app, 'Structure', ALL_CHAINS), false);
      expect(viewerTitle(), 'chain A again').toEqual([PROTEIN_2.name, `${CHAIN_A.length} Cα`]);

      // A structure file loaded over the record: nothing to set, so no section and no button.
      const React = await import('react');
      const replace = figure.querySelectorAll('input[type="file"]').filter((i) => words(i.parentElement!.textContent).startsWith('Replace structure'));
      expect(replace, 'the Replace structure file input').toHaveLength(1);
      const file = new File([caPdb([{ id: 'A', seq: CHAIN_B, dx: 3 }])], 'takr_loaded.pdb', { type: 'chemical/x-pdb' });
      Object.defineProperty(replace[0], 'files', { configurable: true, value: [file] });
      await React.act(async () => { dispatchLiveEvent(replace[0], 'change'); });
      await app.settle();
      expect(figure.querySelectorAll('strong').map((s) => words(s.textContent)), 'the loaded file is drawn').toContain('takr_loaded.pdb');
      expect(shown(app), 'a file loaded over the record').toEqual(NONE);
      expect(fields(app.doc.body, ALL_CHAINS), 'no toggle anywhere').toHaveLength(0);
      // Back to the record's own structure: the toggle is offered again.
      const back = figure.querySelectorAll('button').filter((b) => words(b.textContent) === `Back to ${PROTEIN_2.name}`);
      expect(back).toHaveLength(1);
      await app.click(back[0]);
      expect(shown(app), 'back to the record').toEqual({ ...OPEN_3D, sections: ['Structure'] });
      inSection(app, 'Structure', ALL_CHAINS);

      // A one-chain structure: nothing to set.
      await onStructure(app, PROTEIN_1);
      await landScans(app);
      card(app, '3D Structure & Superposition');
      expect(shown(app), 'a one-chain structure').toEqual(NONE);
      expect(app.doc.body.querySelectorAll('input[type="checkbox"]').filter((c) => /^Show all \d+ chains/.test(controlName(c) ?? '')), 'no chain toggle').toHaveLength(0);

      // The 3D sub-tab of a DNA record: nothing to set.
      await app.restoreSession({ documents: [PROTEIN_2, GENOME], activeDocId: GENOME.id, viewerTab: 'genomics-ngs' });
      await openSubTab(app, '3d');
      expect(shown(app), '3D on a DNA record').toEqual(NONE);
    });
  });
});

// ─── AC3 ───

describe('a scan re-run from the inspector (AC3)', () => {
  it('re-runs a scan from the inspector and keeps values across sub-tabs', async () => {
    await withApp(async (app) => {
      await onGenomics(app);
      await landScans(app);
      const e = await engine();

      // NGS. BBDuk k and Q: the fixture trims differently for each pair the test sets.
      const trim = { opened: trimmed(e, 11, 20), k15: trimmed(e, 15, 20), q15: trimmed(e, 15, 15) };
      expect(distinct(trim.opened, trim.k15, trim.q15), 'the fixture trims differently for k 11/15 and Q 20/15').toBe(true);
      const trimKeys = Object.keys(trim.opened);
      expect(pick(kpis(card(app, TRIMMER)), trimKeys)).toEqual(trim.opened);
      await app.change(inSection(app, 'Read Trimming', K), '15');
      expect(pick(kpis(card(app, TRIMMER)), trimKeys), 'k = 15').toEqual(trim.k15);
      await app.change(inSection(app, 'Read Trimming', MIN_Q), '15');
      expect(pick(kpis(card(app, TRIMMER)), trimKeys), 'Q = 15').toEqual(trim.q15);

      // The mapper, on the read picked in the card.
      await app.change(field(card(app, TRIMMER), 'Query Read / Amplicon:'), READ.id);
      const map = { minimap2: mapped(e, 'Minimap2'), bbmap: mapped(e, 'BBMap') };
      expect(distinct(map.minimap2, map.bbmap), 'the fixture maps differently with Minimap2 and BBMap').toBe(true);
      const mapKeys = Object.keys(map.minimap2);
      expect(pick(kpis(card(app, TRIMMER)), mapKeys)).toEqual(map.minimap2);
      await app.change(inSection(app, 'Read Mapping', MAPPER), 'BBMap');
      expect(pick(kpis(card(app, TRIMMER)), mapKeys), 'mapped with BBMap').toEqual(map.bbmap);

      // The assembler and its minimum overlap.
      const asm = { opened: assembled(e, 'CAP3', 19), overlap40: assembled(e, 'CAP3', 40), mira: assembled(e, 'MIRA', 40) };
      expect(distinct(asm.opened.kpis, asm.overlap40.kpis), 'the fixture assembles differently at 19 and 40 bp').toBe(true);
      expect(distinct(asm.overlap40.contigs, asm.mira.contigs), 'each engine names its contigs').toBe(true);
      expect([kpis(card(app, ASSEMBLER_CARD)), contigNames(app)]).toEqual([expect.objectContaining(asm.opened.kpis), asm.opened.contigs]);
      await app.change(inSection(app, 'De Novo Assembly', OVERLAP), '40');
      expect([kpis(card(app, ASSEMBLER_CARD)), contigNames(app)], 'overlap 40').toEqual([expect.objectContaining(asm.overlap40.kpis), asm.overlap40.contigs]);
      await app.change(inSection(app, 'De Novo Assembly', ASSEMBLER), 'MIRA');
      expect(textOf(card(app, ASSEMBLER_CARD), 'h3', ASSEMBLER_CARD)).toBe('De Novo & Contig Assembler (MIRA)');
      expect([kpis(card(app, ASSEMBLER_CARD)), contigNames(app)], 'MIRA').toEqual([expect.objectContaining(asm.mira.kpis), asm.mira.contigs]);

      // Genome & variants. The synteny engine: a new scan runs (Scanning…), and lands for LASTZ.
      await openSubTab(app, 'genome');
      const syntenyNote = (engineName: string) => `Computed for ${GENOME.name} (6,000 bp) against ${PARTNER.name} (6,000 bp) with ${engineName}`;
      const blocks = (engineName: 'Mauve' | 'LASTZ') => String(e.suite.runWholeGenomeSynteny(GENOME_SEQ, PARTNER.sequence, engineName).blocks.length);
      expect(textOf(app.canvas(), '.studio-panel-note', 'Computed for')).toBe(syntenyNote('Mauve'));
      expect(kpis(card(app, ALIGNMENT_CARD))['Collinear Blocks (LCBs)']).toBe(blocks('Mauve'));
      await app.change(inSection(app, 'Genome Alignment', SYNTENY_ENGINE), 'LASTZ');
      expect(busyScans(app).map((s) => s.getAttribute('data-mbc-scan')), 'the synteny scan runs again').toEqual(['synteny']);
      await landScans(app);
      expect(textOf(app.canvas(), '.studio-panel-note', 'Computed for'), 'computed with LASTZ').toBe(syntenyNote('LASTZ'));
      expect(textOf(card(app, ALIGNMENT_CARD), 'h3', ALIGNMENT_CARD)).toBe('Whole-Genome Alignment (LASTZ) & 16S/ITS Classifier');
      expect(kpis(card(app, ALIGNMENT_CARD))['Collinear Blocks (LCBs)']).toBe(blocks('LASTZ'));
      // The STR minimum.
      const strs = (min: number) => String(e.suite.scanMicrosatelliteStrs(GENOME_SEQ, min).length);
      expect(strs(4), 'the fixture counts different STR loci at 4 and 7 copies').not.toBe(strs(7));
      const strKey = `STR Loci in ${GENOME.name}`;
      expect(kpis(card(app, VARIANT_CARD))[strKey]).toBe(strs(4));
      await app.change(inSection(app, 'STR Genotyping', MIN_STR), '7');
      expect(kpis(card(app, VARIANT_CARD))[strKey], '7 copies').toBe(strs(7));

      // Genes, CpG & repeats: each minimum's scan, run again for its new value.
      await openSubTab(app, 'genes');
      const genes = (min: number) => `${n(e.suite.predictGlimmerMicrobialGenes(GENOME_SEQ, min).totalPredictedCds)} Predicted CDS`;
      const islands = (min: number) => `Gardiner-Garden & Frommer CpG Islands (${e.suite.findCpGIslands(GENOME_SEQ, min).islands.length})`;
      const motifs = (score: number) => {
        const r = e.rust.scanJasparPssmMotifsRust(GENOME_SEQ, score);
        return `Transcription-factor motif scan, JASPAR PWMs (${r.totalHits} hits across ${r.motifsEvaluated} matrices)`;
      };
      expect(distinct(genes(45), genes(150)) && distinct(islands(200), islands(600)) && distinct(motifs(0.84), motifs(0.92)) && distinct(repeatCaption(e, 10), repeatCaption(e, 16)),
        'the fixture gives each scan a different result for the two values').toBe(true);
      const geneBadge = () => textOf(card(app, GENE_CARD), '.studio-card-header .badge-accent', '');
      const notes = () => app.canvas().querySelectorAll('.studio-panel-note').map((p) => words(p.textContent)).filter((t) => t.startsWith('Computed for'));
      expect([geneBadge(), notes()]).toEqual([genes(45), [`Computed for ${GENOME.name} (6,000 bp), proteins ≥ 45 aa`, `Computed for ${GENOME.name} (6,000 bp), islands ≥ 200 bp`]]);
      await app.change(inSection(app, 'Gene Prediction', MIN_AA), '150');
      expect(busyScans(app).map((s) => s.getAttribute('data-mbc-scan')), 'the gene scan runs again').toEqual(['genes']);
      await landScans(app);
      expect([geneBadge(), notes()[0]], '150 aa').toEqual([genes(150), `Computed for ${GENOME.name} (6,000 bp), proteins ≥ 150 aa`]);
      expect(textOf(app.canvas(), '.mbc-table-caption', 'Gardiner-Garden')).toBe(islands(200));
      await app.change(inSection(app, 'CpG Islands', MIN_CPG), '600');
      expect(busyScans(app).map((s) => s.getAttribute('data-mbc-scan')), 'the CpG scan runs again').toEqual(['cpg']);
      await landScans(app);
      expect([textOf(app.canvas(), '.mbc-table-caption', 'Gardiner-Garden'), notes()[1]], '600 bp').toEqual([islands(600), `Computed for ${GENOME.name} (6,000 bp), islands ≥ 600 bp`]);
      expect(shownRepeatCaption(app)).toBe(repeatCaption(e, 10));
      await app.change(inSection(app, 'Genomic Repeats', MIN_ARM), '16');
      await wait(app, 400);
      expect(shownRepeatCaption(app), 'arms ≥ 16 bp').toBe(repeatCaption(e, 16));
      expect(textOf(app.canvas(), 'h4', 'Transcription-factor motif scan')).toBe(motifs(0.84));
      await app.change(inSection(app, 'TF Motif Scan', MIN_SCORE), '0.92');
      expect(textOf(app.canvas(), 'h4', 'Transcription-factor motif scan'), 'score 0.92').toBe(motifs(0.92));

      // Transform & submit: the mode, then the rate it enables, then the seed.
      await openSubTab(app, 'transform');
      const gen = {
        opened: generated(e, 'shuffle-dinucleotide', 2.5, 20261030), point: generated(e, 'point-mutate', 2.5, 20261030),
        rate10: generated(e, 'point-mutate', 10, 20261030), seed7: generated(e, 'point-mutate', 10, 7),
      };
      expect(distinct(gen.opened, gen.point, gen.rate10, gen.seed7), 'the generator gives a different output for each value set').toBe(true);
      const genKeys = Object.keys(gen.opened);
      expect(pick(kpis(card(app, GENERATOR_CARD)), genKeys)).toEqual(gen.opened);
      expect(inSection(app, 'Benchmark Generator', RATE).hasAttribute('disabled'), 'the rate is for point mutation only').toBe(true);
      await app.change(inSection(app, 'Benchmark Generator', MODE), 'point-mutate');
      expect(pick(kpis(card(app, GENERATOR_CARD)), genKeys), 'point mutation').toEqual(gen.point);
      await app.change(inSection(app, 'Benchmark Generator', RATE), '10');
      expect(pick(kpis(card(app, GENERATOR_CARD)), genKeys), 'rate 10%').toEqual(gen.rate10);
      await app.change(inSection(app, 'Benchmark Generator', SEED), '7');
      expect(pick(kpis(card(app, GENERATOR_CARD)), genKeys), 'seed 7').toEqual(gen.seed7);

      // Every value is kept across sub-tab switches (the 3D sub-tab, with no sections, among them),
      // and so is the result each card shows for it.
      await openSubTab(app, '3d');
      expect(shown(app)).toEqual(NONE);
      await openSubTab(app, 'ngs');
      expect([K, MIN_Q].map((name) => inSection(app, 'Read Trimming', name).value)).toEqual(['15', '15']);
      expect([inSection(app, 'Read Mapping', MAPPER).value, inSection(app, 'De Novo Assembly', ASSEMBLER).value, inSection(app, 'De Novo Assembly', OVERLAP).value])
        .toEqual(['BBMap', 'MIRA', '40']);
      expect(pick(kpis(card(app, TRIMMER)), [...trimKeys, ...mapKeys]), 'NGS results kept').toEqual({ ...trim.q15, ...map.bbmap });
      expect(contigNames(app)).toEqual(asm.mira.contigs);
      await openSubTab(app, 'genome');
      expect([inSection(app, 'Genome Alignment', SYNTENY_ENGINE).value, inSection(app, 'STR Genotyping', MIN_STR).value]).toEqual(['LASTZ', '7']);
      expect(textOf(app.canvas(), '.studio-panel-note', 'Computed for')).toBe(syntenyNote('LASTZ'));
      expect(kpis(card(app, VARIANT_CARD))[strKey]).toBe(strs(7));
      await openSubTab(app, 'transform');
      expect([MODE, RATE, SEED].map((name) => inSection(app, 'Benchmark Generator', name).value)).toEqual(['point-mutate', '10', '7']);
      expect(pick(kpis(card(app, GENERATOR_CARD)), genKeys)).toEqual(gen.seed7);
      await openSubTab(app, 'genes');
      expect(SECTIONS.genes.map(([title, [name]]) => inSection(app, title, name).value)).toEqual(['150', '600', '16', '0.92']);
      expect([geneBadge(), textOf(app.canvas(), '.mbc-table-caption', 'Gardiner-Garden'), shownRepeatCaption(app), textOf(app.canvas(), 'h4', 'Transcription-factor')])
        .toEqual([genes(150), islands(600), repeatCaption(e, 16), motifs(0.92)]);
    });
  });
});

// ─── AC4 ───

describe('the repeat arm typed in the inspector (AC4, BG-01M6SQ9T)', () => {
  it('scans repeats once per settled arm length typed in the inspector, and keeps a draft across a close', async () => {
    await withApp(async (app) => {
      await onGenomics(app);
      await openSubTab(app, 'genes');
      const e = await engine();
      const at = { 10: repeatCaption(e, 10), 12: repeatCaption(e, 12), 16: repeatCaption(e, 16), 18: repeatCaption(e, 18), 20: repeatCaption(e, 20) };
      expect(new Set(Object.values(at)).size, 'each arm gives its own caption').toBe(5);
      clearScans();
      const arm = () => inSection(app, 'Genomic Repeats', MIN_ARM);
      const toggleInspector = async () => app.click(app.inspectorButton()!);
      expect([arm().value, shownRepeatCaption(app)]).toEqual(['10', at[10]]);

      // "1" then "2", 200 ms apart: no scan while the arm is typed, then one, at 12, 400 ms after the "2".
      await app.input(arm(), '1');
      await wait(app, 200);
      await app.input(arm(), '12');
      await wait(app, 399);
      expect(armsScanned(), 'no scan while typing').toEqual([]);
      expect(shownRepeatCaption(app), 'the list is still the one at 10 bp').toBe(at[10]);
      await wait(app, 1);
      expect(armsScanned(), 'one scan, at 12').toEqual([12]);
      expect(shownRepeatCaption(app)).toBe(at[12]);
      await wait(app, 5_000);
      expect(armsScanned(), 'and no other').toEqual([12]);

      // Enter scans at once, and the 400 ms passing scans nothing more.
      clearScans();
      await app.click(arm());
      await app.input(arm(), '20');
      await app.press('Enter');
      expect(armsScanned(), 'Enter: a scan at once, at 20').toEqual([20]);
      expect(shownRepeatCaption(app)).toBe(at[20]);
      await wait(app, 5_000);
      expect(armsScanned()).toEqual([20]);

      // Closed mid-typing ("1", then "16" 100 ms later, closed 100 ms after that): the field goes,
      // its draft and timer stay the studio's, so the scan runs once, for 16, 400 ms after the "6".
      clearScans();
      await app.input(arm(), '1');
      await wait(app, 100);
      await app.input(arm(), '16');
      await wait(app, 100);
      await toggleInspector();
      expect(shown(app), 'closed mid-typing').toEqual(CLOSED);
      expect(fields(app.doc.body, MIN_ARM), 'the field is drawn nowhere').toHaveLength(0);
      await wait(app, 299);
      expect(armsScanned(), 'not yet').toEqual([]);
      await wait(app, 1);
      expect(armsScanned(), 'once, for 16').toEqual([16]);
      expect(shownRepeatCaption(app), "the card shows the typed arm's list").toBe(at[16]);
      await toggleInspector();
      expect(arm().value, 'reopened, the field shows the typed value').toBe('16');
      await wait(app, 5_000);
      expect(armsScanned(), 'and the scan ran once for it').toEqual([16]);

      // Closed and reopened within the 400 ms: still one scan, 400 ms after the last keystroke.
      clearScans();
      await app.input(arm(), '18');
      await wait(app, 100);
      await toggleInspector();
      await wait(app, 100);
      await toggleInspector();
      expect(arm().value).toBe('18');
      await wait(app, 199);
      expect(armsScanned(), 'a close and reopen start no scan').toEqual([]);
      await wait(app, 1);
      expect(armsScanned(), 'once, for 18').toEqual([18]);
      expect(shownRepeatCaption(app)).toBe(at[18]);

      // A partial "1" left across a close: no scan for it, and the field shows it on reopening.
      clearScans();
      await app.input(arm(), '1');
      await toggleInspector();
      await wait(app, 5_000);
      expect(armsScanned(), 'a lone "1" is no arm to scan at').toEqual([]);
      expect(shownRepeatCaption(app), 'the list stays the one at 18 bp').toBe(at[18]);
      await toggleInspector();
      expect(arm().value, 'the draft survives the close').toBe('1');
      await app.input(arm(), '12');
      await wait(app, 400);
      expect(armsScanned(), 'finished after reopening: one scan, at 12').toEqual([12]);
      expect(shownRepeatCaption(app)).toBe(at[12]);
    });
  });
});

// ─── AC7 ───

describe('a menu command that opens a sub-tab (AC7)', () => {
  it('shows the sub-tab a menu command opens, with its sections', async () => {
    await withApp(async (app) => {
      await onGenomics(app, 'sequence-view');
      const routes: [string, SubTab][] = [
        ['tools:ngs-suite', 'ngs'],
        ['tools:genome-variants', 'genome'],
        ['annotate:cpg-repeats', 'genes'],
        ['annotate:coils-tm-pdb', '3d'],
        ['sequence:mutate-shuffle', 'transform'],
      ];
      const expectOn = async (tab: SubTab, where: string) => {
        await landScans(app);
        expect(app.activeTab(), where).toBe('genomics-ngs');
        expect(selectedSubTab(app), where).toBe(SUB_TAB_LABELS[tab]);
        if (tab === '3d') expect(shown(app), where).toEqual(NONE);
        else expectSections(app, tab);
      };
      // From the Sequence tab.
      for (const [command, tab] of routes) {
        await app.clickTab('sequence-view');
        expect(app.activeTab()).toBe('sequence-view');
        await app.menu(command);
        await expectOn(tab, `${command}, from the Sequence tab`);
      }
      // From inside the studio, on another sub-tab, and the same command twice: its repeat
      // (commandNonce) opens the sub-tab again after the user has left it.
      for (const [command, tab] of routes) {
        const other: SubTab = tab === 'genes' ? 'transform' : 'genes';
        await openSubTab(app, other);
        await app.menu(command);
        await expectOn(tab, `${command}, from ${other}`);
        await openSubTab(app, other);
        await app.menu(command);
        await expectOn(tab, `${command} again, from ${other}`);
      }
      // A protein record: the 3D command shows its Structure section.
      await app.restoreSession({ documents: [PROTEIN_2, GENOME], activeDocId: PROTEIN_2.id, viewerTab: 'sequence-view' });
      await app.menu('annotate:coils-tm-pdb');
      await landScans(app);
      expect([app.activeTab(), selectedSubTab(app)]).toEqual(['genomics-ngs', SUB_TAB_LABELS['3d']]);
      expect(shown(app)).toEqual({ ...OPEN_3D, sections: ['Structure'] });
      inSection(app, 'Structure', ALL_CHAINS);
    });
  });
});

// ─── AC8 ───

/**
 * The studio drawn on its own: its own React root in the launched App's window, with no
 * WorkbenchInspectorProvider above it, from this launch's module (imported after the launch, which
 * loads React DOM under the live DOM). Its effects run, so its scans land as they do in the app.
 */
async function drawnOnItsOwn(app: AppHarness, props: { activeDoc: SequenceDocument; documents: SequenceDocument[]; proteinDocuments?: SequenceDocument[]; initialSubTab: string }, check: (probe: LiveElement) => void) {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { GenomicsNgsAndPredictionStudio } = await import('../components/GenomicsNgsAndPredictionStudio');
  const probe = app.doc.createElement('div');
  app.doc.body.appendChild(probe);
  const root = createRoot(probe as unknown as Element);
  const noop = () => {};
  try {
    await React.act(async () => {
      root.render(React.createElement(GenomicsNgsAndPredictionStudio, {
        ...props, initialSubTab: props.initialSubTab as never, onCreateDocument: noop, onUpdateActiveSequence: noop, onAppendFeatures: noop,
      }));
    });
    await landScans(app);
    expect(probe.querySelectorAll('.mbc-inspector-sections, .mbc-accordion-section, .mbc-accordion-header, .mbc-accordion-body'), 'no inspector wrapper, section or header on its own').toHaveLength(0);
    const titles = Object.values(SECTIONS).flatMap((s) => s.map(([title]) => title)).concat('Structure');
    expect(probe.querySelectorAll('*').filter((el) => titles.includes(words(el.textContent))).map((el) => words(el.textContent)), 'no section title on its own').toEqual([]);
    check(probe);
  } finally {
    await React.act(async () => { root.unmount(); });
    probe.remove();
  }
}
/** The studio card in `scope` whose heading starts with `heading`. */
function cardIn(scope: LiveElement, heading: string): LiveElement {
  const found = scope.querySelectorAll('.studio-card').filter((c) => words(c.querySelectorAll('.studio-card-header h3')[0]?.textContent ?? '').startsWith(heading));
  expect(found, `one "${heading}" card`).toHaveLength(1);
  return found[0];
}
/** The control named `name`: drawn once in the whole page, and its label a child of `row`. */
function inRow(page: LiveElement, row: LiveElement, name: string): LiveElement {
  const found = fields(page, name);
  expect(found, `${name}: drawn once on its own`).toHaveLength(1);
  expect(found[0].labels[0]?.parentElement === row, `${name}: its label sits in its row`).toBe(true);
  expect(found[0].closest('.mbc-accordion-body, .mbc-right-controls'), `${name}: no inspector wrapper`).toBeNull();
  return found[0];
}
/** A row's children: a label by its own words, any other element by its tag and words. */
const rowParts = (row: LiveElement) => row.children.map((c) => (c.localName === 'label' ? ownWords(c) : `${c.localName}: ${words(c.textContent)}`));
/** A labelled field row: its labels' words, each a .form-field, and nothing else. */
function fieldRow(row: LiveElement, names: string[], what: string) {
  expect(rowParts(row), what).toEqual(names);
  expect(row.children.every((c) => c.localName === 'label' && c.classList.contains('form-field')), `${what}: labelled fields`).toBe(true);
}
/**
 * An inline setting as it was drawn on its own: a label of its row with no class, its words and box
 * side by side in the inline style it always had, and the box's fixed width (none for a select).
 */
function inlineSetting(page: LiveElement, row: LiveElement, name: string, look: { gap: string; size: string; width?: string }) {
  const control = inRow(page, row, name);
  const label = control.labels[0];
  expect([label.getAttribute('class'), inlineStyle(label)], `${name}: the inline label`)
    .toEqual([null, { display: 'inline-flex', 'align-items': 'center', gap: look.gap, 'font-size': look.size }]);
  expect(inlineStyle(control), `${name}: the box's own style`).toEqual(look.width ? { width: look.width } : {});
  return control;
}
const classesOf = (el: LiveElement) => el.children.map((c) => c.getAttribute('class'));

describe('the studio drawn on its own keeps its settings in place (AC8)', () => {
  it('keeps its settings in place when rendered on its own, NGS', async () => {
    await withApp(async (app) => {
      await drawnOnItsOwn(app, { activeDoc: GENOME, documents: DNA_DOCS, initialSubTab: 'ngs-assembly' }, (page) => {
        // The trimmer's card: its header, the k and Q row, the trim figures, the save row, then the
        // mapper beside the reference and read pickers, then the mapping figures.
        const trimmer = cardIn(page, TRIMMER);
        expect(classesOf(trimmer), "the trimmer card's rows").toEqual(['studio-card-header', 'form-grid-2col', 'thermo-kpi-grid', 'cloning-action-row', 'form-grid-3col', 'thermo-kpi-grid']);
        const [, trimRow, , , mapRow] = trimmer.children;
        fieldRow(trimRow, [K, MIN_Q], 'the k and Q row');
        expect([inRow(page, trimRow, K).value, inRow(page, trimRow, MIN_Q).value]).toEqual(['11', '20']);
        fieldRow(mapRow, [MAPPER, 'Reference Sequence:', 'Query Read / Amplicon:'], 'the mapper, then the reference and read');
        expect(inRow(page, mapRow, MAPPER).value).toBe('Minimap2');
        // The assembler's card: its header, the engine and overlap row, then the input note.
        const assembler = cardIn(page, ASSEMBLER_CARD);
        expect(classesOf(assembler).slice(0, 3), "the assembler card's first rows").toEqual(['studio-card-header', 'form-grid-2col', 'info-callout']);
        const asmRow = assembler.children[1];
        fieldRow(asmRow, [ASSEMBLER, OVERLAP], 'the engine and overlap row');
        expect([inRow(page, asmRow, ASSEMBLER).value, inRow(page, asmRow, OVERLAP).value]).toEqual(['CAP3', '19']);
      });
    });
  });

  it('keeps its settings in place when rendered on its own, Genome & variants', async () => {
    await withApp(async (app) => {
      await drawnOnItsOwn(app, { activeDoc: GENOME, documents: DNA_DOCS, initialSubTab: 'genome-variants' }, (page) => {
        // The engine beside the genome it compares against, the alignment card's first row.
        const alignment = cardIn(page, ALIGNMENT_CARD);
        expect(classesOf(alignment).slice(0, 2)).toEqual(['studio-card-header', 'form-grid-2col']);
        const engineRow = alignment.children[1];
        fieldRow(engineRow, [SYNTENY_ENGINE, `Compare ${GENOME.name} Against:`], 'the engine, then the genome compared against');
        expect(inRow(page, engineRow, SYNTENY_ENGINE).value).toBe('Mauve');
        // The STR minimum, inline after the variant card's two buttons.
        const variants = cardIn(page, VARIANT_CARD);
        const rows = variants.children.filter((c) => c.classList.contains('cloning-action-row'));
        expect(rows, "the variant card's action row").toHaveLength(1);
        expect(rowParts(rows[0])).toEqual(['button: + Annotate Variants on Reference', 'button: Export VCF (.vcf)', MIN_STR]);
        expect(inlineSetting(page, rows[0], MIN_STR, { gap: '6px', size: '11.5px', width: '56px' }).value).toBe('4');
      });
    });
  });

  it('keeps its settings in place when rendered on its own, Genes CpG & repeats', async () => {
    await withApp(async (app) => {
      await drawnOnItsOwn(app, { activeDoc: GENOME, documents: DNA_DOCS, initialSubTab: 'genes-cpg-repeats' }, (page) => {
        // The gene minimum, inline before its Annotate button, the gene card's first action row.
        const genesCard = cardIn(page, GENE_CARD);
        expect(classesOf(genesCard)[1], "the gene card's first row").toBe('cloning-action-row');
        const geneRow = genesCard.children[1];
        expect(rowParts(geneRow)).toEqual([MIN_AA, `button: + Annotate Glimmer Genes onto ${GENOME.name}`]);
        expect(inlineSetting(page, geneRow, MIN_AA, { gap: '6px', size: '12px', width: '70px' }).value).toBe('45');
        // The CpG and repeat minimums, each inline before its Annotate button, in one row.
        const cpgCard = cardIn(page, CPG_CARD);
        expect(classesOf(cpgCard)[1], "the CpG card's first row").toBe('cloning-action-row');
        const cpgRow = cpgCard.children[1];
        expect(rowParts(cpgRow)).toEqual([MIN_CPG, 'button: + Annotate CpG Islands', MIN_ARM, 'button: + Annotate Repeats']);
        expect(inlineSetting(page, cpgRow, MIN_CPG, { gap: '6px', size: '12px', width: '68px' }).value).toBe('200');
        expect(inlineSetting(page, cpgRow, MIN_ARM, { gap: '6px', size: '12px', width: '56px' }).value).toBe('10');
        // The motif score, inline in the motif scan's own header, beside its heading and before its button.
        const scan = page.querySelectorAll('.mbc-studio-isolated-region > .studio-card-header').filter((h) => words(h.querySelectorAll('h4')[0]?.textContent ?? '').startsWith('Transcription-factor motif scan'));
        expect(scan, "the motif scan's header").toHaveLength(1);
        expect(scan[0].children.map((c) => c.localName)).toEqual(['h4', 'div']);
        const scoreRow = scan[0].children[1];
        expect(rowParts(scoreRow).map((p) => p.replace(/^button: .*/, 'button'))).toEqual([MIN_SCORE, 'button']);
        expect(inlineSetting(page, scoreRow, MIN_SCORE, { gap: '5px', size: '11.5px' }).value).toBe('0.84');
      });
    });
  });

  it('keeps its settings in place when rendered on its own, 3D', async () => {
    await withApp(async (app) => {
      const props = (doc: SequenceDocument) => ({ activeDoc: doc, documents: [GENOME], proteinDocuments: [PROTEIN_2, PROTEIN_1], initialSubTab: 'protein-3d' });
      await drawnOnItsOwn(app, props(PROTEIN_2), (page) => {
        // The toggle beside the Compare with picker, the 3D card's first row, aligned to its end.
        const figure = cardIn(page, '3D Structure & Superposition');
        expect(classesOf(figure).slice(0, 2)).toEqual(['studio-card-header', 'form-grid-2col']);
        const row = figure.children[1];
        expect(rowParts(row)).toEqual(['Compare with:', ALL_CHAINS]);
        const toggle = inRow(page, row, ALL_CHAINS);
        const label = toggle.labels[0];
        expect([label.getAttribute('class'), inlineStyle(label), toggle.checked], 'the check row as it was').toEqual(['mbc-check-row', { 'align-self': 'end' }, false]);
      });
      // A one-chain structure has no toggle on its own either.
      await drawnOnItsOwn(app, props(PROTEIN_1), (page) => {
        const row = cardIn(page, '3D Structure & Superposition').children[1];
        expect(rowParts(row)).toEqual(['Compare with:']);
        expect(page.querySelectorAll('input[type="checkbox"]').filter((c) => /^Show all/.test(controlName(c) ?? ''))).toHaveLength(0);
      });
    });
  });

  it('keeps its settings in place when rendered on its own, Transform & submit', async () => {
    await withApp(async (app) => {
      await drawnOnItsOwn(app, { activeDoc: GENOME, documents: DNA_DOCS, initialSubTab: 'transform-submit' }, (page) => {
        // The mode, rate and seed row, under the strand buttons and above the generator's figures.
        const generator = cardIn(page, GENERATOR_CARD);
        expect(classesOf(generator)).toEqual(['studio-card-header', 'cloning-action-row', 'form-grid-3col', 'thermo-kpi-grid', 'cloning-action-row']);
        const row = generator.children[2];
        fieldRow(row, [MODE, RATE, SEED], 'the mode, rate and seed row');
        expect([MODE, RATE, SEED].map((name) => inRow(page, row, name).value)).toEqual(['shuffle-dinucleotide', '2.5', '20261030']);
        // The GenBank fields stay in their card.
        const genbank = cardIn(page, GENBANK_CARD);
        for (const name of KEPT_IN_CARDS.transform) expect(genbank.contains(field(page, name)), name).toBe(true);
      });
    });
  });
});
