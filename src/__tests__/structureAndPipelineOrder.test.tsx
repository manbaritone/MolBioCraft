// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q1ZR: a studio opens on what the user came for. A structure opens on its 3D viewer, a
 * protein without coordinates opens on its coiled-coil and transmembrane predictions, and a guided
 * pipeline report shows its steps before its blueprint, with the four-card catalogue folded into a
 * one-row picker.
 *
 * Every check renders the real component and reads the order of the markup it writes; none reads
 * source text. The pipeline report is computed asynchronously in an effect, which a server render
 * never runs, so the studio is given a report at the one place it picks the report to show
 * (`selectCurrentPipelineReport`), and the layout that draws a report is rendered with the same
 * report directly; its element tree is walked (not rendered) to call the picker's own click
 * handlers. The documents are the shipped sample library, so no reference data is needed.
 *
 * BG-01M6REVT: the 3D card's badge says whether the coordinates are measured or predicted, from
 * what the structure file states about itself. Its fixtures are the shipped sample library,
 * AlphaFold DB's own files cut to five residues (CC BY 4.0, attributed in NOTICE section 6 and
 * PROVENANCE.md), headers constructed around them, and the RCSB X-ray, NMR and electron
 * microscopy entries in the reference data, which are read through `testData.ts` and skipped
 * (visibly) without it. A file loaded into the tab cannot be reached by a server render, so the
 * badge's decision is also checked on its own (`coordinateSourceBadge`).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({
  /** When set, the report the pipeline studio is told is current; otherwise its own choice. */
  report: undefined as unknown,
}));

vi.mock('../core/pipelineReportFreshness', async () => {
  const actual = await vi.importActual<typeof import('../core/pipelineReportFreshness')>('../core/pipelineReportFreshness');
  const select = ((...args: Parameters<typeof actual.selectCurrentPipelineReport>) =>
    probe.report === undefined ? actual.selectCurrentPipelineReport(...args) : probe.report) as typeof actual.selectCurrentPipelineReport;
  return { ...actual, selectCurrentPipelineReport: select };
});

const { GenomicsNgsAndPredictionStudio, coordinateSourceBadge } = await import('../components/GenomicsNgsAndPredictionStudio');
const pipelineModule = await import('../components/WorkflowPipelineStudio');
const { WorkflowPipelineStudio } = pipelineModule;
const { BIO_PIPELINE_CATALOG, executeBioPipelineAsync } = await import('../core/bioPipelineEngine');
const { extractTargetProteinSequence, predictCoiledCoilsAndTransmembrane } = await import('../core/genomicsAndStructureSuite');
const { structureAtomsOf, hasStructure } = await import('../core/structureModels');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { dataPath, haveTestData } = await import('./testData');
type SequenceDocument = import('../types/bio').SequenceDocument;
type BioPipelineId = import('../core/bioPipelineEngine').BioPipelineId;

afterEach(() => {
  probe.report = undefined;
});

const noop = () => {};
const byId = (id: string): SequenceDocument => {
  const d = SAMPLE_LIBRARY.find((doc) => doc.id === id);
  if (!d) throw new Error(`sample ${id} is missing`);
  return d;
};

/** The words a stretch of markup shows: tags dropped, the entities React writes decoded. */
const wordsOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

// ─── AC1: the protein tab ───

/** 1D66 (GAL4 bound to DNA): a C-alpha trace of chains A and B from RCSB, as legacy PDB text. */
const entry1d66 = byId('doc-prot-1d66-gal4-dna');
/** A structure document as File › Import builds one per chain: the file in PDBText, the chain id in Chain. */
const chainA1d66: SequenceDocument = {
  ...entry1d66, id: 'doc-1d66-chain-A', name: '1D66 chain A',
  docMetadata: { ...entry1d66.docMetadata, Chain: 'A' },
};
/** 1A4Y, the second structure to superpose on. */
const entry1a4y = byId('doc-prot-1a4y-rnase-angiogenin');
/** eGFP names its PDB entry (1EMA) but carries no coordinates. */
const egfp = byId('doc-prot-egfp-1ema');
/** A protein whose attached structure file holds no atom records: a file, but nothing measured. */
const egfpEmptyFile: SequenceDocument = {
  ...egfp, id: 'doc-egfp-empty-structure-file', name: 'eGFP (structure file without atoms)',
  docMetadata: { ...egfp.docMetadata, PDBText: 'HEADER    NO ATOM RECORDS\nEND\n' },
};

const proteinTab = (activeDoc: SequenceDocument, extra: Partial<React.ComponentProps<typeof GenomicsNgsAndPredictionStudio>> = {}) =>
  renderToStaticMarkup(
    <GenomicsNgsAndPredictionStudio
      activeDoc={activeDoc} documents={[activeDoc]} initialSubTab="protein-3d"
      onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop}
      {...extra}
    />,
  );

const CARD = '<div class="studio-card">';
const TOPOLOGY_MARK = '<span class="kpi-label">Coiled-Coil Domains</span>';
const CALLOUT_MARK = 'has no 3D coordinates';

/**
 * Where the protein tab's two cards open in the markup: the 3D card (the one holding the viewer
 * stage, or the import callout when there is nothing to draw) and the coiled-coil/TM card.
 */
function proteinCards(html: string) {
  const grid = html.indexOf('<div class="studio-split-grid">');
  const viewer = html.indexOf('protein-3d-viewer-stage');
  const callout = html.indexOf(CALLOUT_MARK);
  const topologyAt = html.indexOf(TOPOLOGY_MARK);
  expect(grid, 'the protein tab draws its grid').toBeGreaterThan(-1);
  expect(viewer >= 0 || callout >= 0, 'the 3D card shows a viewer or the import callout').toBe(true);
  expect(topologyAt, 'the coiled-coil/TM card is drawn').toBeGreaterThan(-1);
  const cardOf = (at: number) => html.lastIndexOf(CARD, at);
  const structure = cardOf(viewer >= 0 ? viewer : callout);
  const topology = cardOf(topologyAt);
  expect(structure, 'the 3D card opens inside the grid').toBeGreaterThan(grid);
  expect(topology, 'the coiled-coil/TM card opens inside the grid').toBeGreaterThan(grid);
  expect(structure, 'the two are different cards').not.toBe(topology);
  // Each card runs to the next card (or the end of the render).
  const end = (start: number) => {
    const next = html.indexOf(CARD, start + CARD.length);
    return next < 0 ? html.length : next;
  };
  return {
    viewer, callout, structureFirst: structure < topology,
    structureCard: html.slice(structure, end(structure)),
    topologyCard: html.slice(topology, end(topology)),
  };
}

/** The KPI boxes of a stretch of markup, label to value. */
const kpis = (html: string) => new Map(Array.from(
  html.matchAll(/<span class="kpi-label">([\s\S]*?)<\/span><strong class="kpi-val">([\s\S]*?)<\/strong>/g),
  (m) => [wordsOf(m[1]), wordsOf(m[2])] as const,
));

/** The coiled-coil/TM card keeps what it showed before: the engine's topology, counts and both lists. */
function expectTopologyCard(card: string, doc: SequenceDocument) {
  const topology = predictCoiledCoilsAndTransmembrane(extractTargetProteinSequence(doc));
  const k = kpis(card);
  expect(k.get('N-Terminus Topology')).toBe(wordsOf(String(topology.nTerminusLocation)));
  expect(k.get('Coiled-Coil Domains')).toBe(String(topology.coiledCoils.length));
  expect(k.get('Transmembrane Helices')).toBe(String(topology.transmembraneHelices.length));
  const words = wordsOf(card);
  expect(words).toContain('Predicted Coiled-Coil Heptad Domains (Lupas Algorithm):');
  expect(words).toContain('Predicted Transmembrane Helices & Membrane Orientation:');
  expect(words).toContain(`${topology.lengthAa} aa Analyzed`);
}

// ─── AC2: the guided pipelines ───

const puc19 = SAMPLE_LIBRARY.find((d) => d.name === 'pUC19_Standard_Vector');
if (!puc19) throw new Error('the sample library has no pUC19_Standard_Vector');

const studioProps = {
  activeDoc: puc19, allDocuments: [puc19], hostOs: 'macos' as const,
  onSelectDocument: noop, onSelectRange: noop, onNavigateStudio: noop,
};

/** Every element of a React element tree (without rendering components), depth first in order. */
function elementsOf(node: React.ReactNode): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  const walk = (n: React.ReactNode) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    out.push(n);
    walk((n.props as { children?: React.ReactNode }).children);
  };
  walk(node);
  return out;
}
const classOf = (el: React.ReactElement) => String((el.props as { className?: string }).className ?? '');

/** Where the first element carrying class `cls` opens in the markup, or -1. */
const sectionAt = (html: string, cls: string) => html.search(new RegExp(`class="(?:[^"]* )?${cls}(?: [^"]*)?"`));

/** The pipeline picker's buttons in a studio render (its slide arrows left out). */
function pickerChoices(html: string) {
  const picker = html.slice(sectionAt(html, 'mbc-pipeline-picker'), sectionAt(html, 'mbc-stepper-section'));
  return Array.from(picker.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g))
    .filter((m) => !/aria-label="Slide pipelines/.test(m[1]))
    .map((m) => ({ words: wordsOf(m[2]), pressed: /aria-pressed="true"/.test(m[1]), title: /title="([^"]*)"/.exec(m[1])?.[1] }));
}
const stepHeading = (html: string) => {
  const m = /<h4 class="mbc-step-heading">([\s\S]*?)<\/h4>/.exec(html);
  return m ? wordsOf(m[1]) : null;
};

describe('structure and pipeline order (US-01M6Q1ZR)', () => {
  it('leads the protein tab with the 3D viewer when the structure has coordinates', () => {
    // The fixtures reach both branches: each "with" document has measured C-alpha atoms, and both
    // "without" documents have none, one of them although a structure file is attached.
    for (const doc of [chainA1d66, entry1d66]) expect(structureAtomsOf(doc).length, doc.name).toBeGreaterThan(0);
    expect(structureAtomsOf(egfp)).toEqual([]);
    expect([hasStructure(egfpEmptyFile), structureAtomsOf(egfpEmptyFile)]).toEqual([true, []]);

    // With coordinates (one chain of an entry, and the whole entry): the 3D card leads.
    for (const doc of [chainA1d66, entry1d66]) {
      const cards = proteinCards(proteinTab(doc));
      expect(cards.viewer, `${doc.name}: the viewer is drawn`).toBeGreaterThan(-1);
      expect(cards.callout, `${doc.name}: no import callout`).toBe(-1);
      expect(cards.structureFirst, `${doc.name}: the 3D card comes before the coiled-coil/TM card`).toBe(true);
      expect(cards.structureCard).toContain('protein-3d-viewer-stage');
      expectTopologyCard(cards.topologyCard, doc);
    }

    // Comparing two structures: the 3D card, with its superposition KPIs, still leads.
    const compared = proteinCards(proteinTab(chainA1d66, { proteinDocuments: [chainA1d66, entry1a4y], selectedDocuments: [chainA1d66, entry1a4y] }));
    expect(compared.structureFirst, 'the superposition card leads').toBe(true);
    expect([...kpis(compared.structureCard).keys()]).toEqual(expect.arrayContaining(['Cα RMSD', 'TM≈ (approximate TM-score)', 'Cα pairs (sequence alignment)']));
    expectTopologyCard(compared.topologyCard, chainA1d66);

    // Without coordinates: the predictions lead and the import callout follows.
    for (const doc of [egfp, egfpEmptyFile]) {
      const cards = proteinCards(proteinTab(doc));
      expect(cards.viewer, `${doc.name}: no viewer`).toBe(-1);
      expect(cards.callout, `${doc.name}: the import callout`).toBeGreaterThan(-1);
      expect(cards.structureFirst, `${doc.name}: the coiled-coil/TM card comes before the 3D card`).toBe(false);
      expect(wordsOf(cards.structureCard)).toContain(`${doc.name} has no 3D coordinates`);
      expectTopologyCard(cards.topologyCard, doc);
    }
  });

  it('puts the pipeline steps before the blueprint and folds the catalogue', async () => {
    const report = await executeBioPipelineAsync(puc19, 'cloning-expression-qc', { hostOs: 'macos' });
    expect(report.steps.length).toBeGreaterThan(1);
    expect(report.visualZones.length).toBeGreaterThan(0);
    const ids = BIO_PIPELINE_CATALOG.map((p) => p.id);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe('cloning-expression-qc');

    // ── The studio, as the App mounts it, with the current report ──
    probe.report = report;
    const withReport = renderToStaticMarkup(<WorkflowPipelineStudio {...studioProps} />);
    probe.report = undefined;
    const order = ['mbc-pipeline-header', 'mbc-pipeline-picker', 'mbc-stepper-section', 'mbc-step-heading', 'mbc-blueprint-card', 'mbc-deferred-os-diagnostics']
      .map((cls) => [cls, sectionAt(withReport, cls)] as const);
    for (const [cls, at] of order) expect(at, `${cls} is drawn with a report`).toBeGreaterThan(-1);
    expect(order.map(([cls]) => cls), 'header, picker, steps and the focused step, blueprint, diagnostics')
      .toEqual([...order].sort((a, b) => a[1] - b[1]).map(([cls]) => cls));
    expect(sectionAt(withReport, 'mbc-pipeline-catalog-grid'), 'the four-card catalogue is folded').toBe(-1);
    expect(sectionAt(withReport, 'mbc-pipeline-card'), 'no catalogue card is drawn').toBe(-1);
    // The focused step is the first one, and its heading sits in the step section.
    expect(stepHeading(withReport)).toBe(report.steps[0].title);

    // The picker is one row of the four pipelines, by category, the selected one pressed.
    const buttons = pickerChoices(withReport);
    expect(buttons.map((b) => b.words)).toEqual(BIO_PIPELINE_CATALOG.map((p) => wordsOf(p.category)));
    expect(buttons.map((b) => b.pressed)).toEqual(ids.map((id) => id === 'cloning-expression-qc'));
    expect(buttons.map((b) => b.title && wordsOf(b.title))).toEqual(BIO_PIPELINE_CATALOG.map((p) => wordsOf(p.title)));
    expect(withReport.slice(sectionAt(withReport, 'mbc-pipeline-picker'), sectionAt(withReport, 'mbc-stepper-section'))).not.toContain('mbc-pipeline-card-desc');

    // ── The studio before any report: the catalogue shows as it did ──
    const noReport = renderToStaticMarkup(<WorkflowPipelineStudio {...studioProps} />);
    expect(sectionAt(noReport, 'mbc-pipeline-catalog-grid'), 'the catalogue is drawn before a report').toBeGreaterThan(-1);
    for (const cls of ['mbc-pipeline-picker', 'mbc-stepper-section', 'mbc-blueprint-card']) expect(sectionAt(noReport, cls), `no ${cls} without a report`).toBe(-1);
    const cards = Array.from(noReport.matchAll(/<button type="button" class="(mbc-pipeline-card[^"]*)">([\s\S]*?)<\/button>/g), (m) => ({ cls: m[1].trim(), body: m[2] }));
    expect(cards.map((c) => c.cls)).toEqual(ids.map((id) => (id === 'cloning-expression-qc' ? 'mbc-pipeline-card active' : 'mbc-pipeline-card')));
    expect(cards.map((c) => wordsOf(/<div class="mbc-pipeline-card-name">([\s\S]*?)<\/div>/.exec(c.body)?.[1] ?? ''))).toEqual(BIO_PIPELINE_CATALOG.map((p) => wordsOf(p.title)));
    expect(cards.map((c) => wordsOf(/<div class="mbc-pipeline-card-desc">([\s\S]*?)<\/div>/.exec(c.body)?.[1] ?? ''))).toEqual(BIO_PIPELINE_CATALOG.map((p) => wordsOf(p.description)));
    expect(sectionAt(noReport, 'mbc-pipeline-catalog-grid')).toBeLessThan(sectionAt(noReport, 'mbc-deferred-os-diagnostics'));

    // ── The layout the studio draws a report with, given the same report ──
    const { GuidedPipelineLayout } = pipelineModule as unknown as {
      GuidedPipelineLayout?: (props: Record<string, unknown>) => React.ReactElement;
    };
    expect(typeof GuidedPipelineLayout, 'WorkflowPipelineStudio exports the layout it draws a report with').toBe('function');
    const chosen: BioPipelineId[] = [];
    const layoutProps = (r: typeof report | null, notices?: React.ReactNode, keepPickerFolded = false) => ({
      report: r, selectedPipelineId: 'cloning-expression-qc' as BioPipelineId,
      onSelectPipeline: (id: BioPipelineId) => chosen.push(id),
      activeStepIdx: 0, onSelectStep: noop, onSelectRange: noop, onNavigateStudio: noop,
      copiedLabel: null, onCopySequence: noop, notices, keepPickerFolded,
    });
    // Each picker button selects its own pipeline.
    const tree = GuidedPipelineLayout!(layoutProps(report));
    const pickerEl = elementsOf(tree).find((el) => classOf(el).split(/\s+/).includes('mbc-pipeline-picker'));
    expect(pickerEl, 'the layout draws the picker with a report').toBeDefined();
    const pickerButtons = elementsOf((pickerEl!.props as { children?: React.ReactNode }).children).filter((el) => el.type === 'button');
    expect(pickerButtons).toHaveLength(4);
    for (const b of pickerButtons) (b.props as { onClick: () => void }).onClick();
    expect(chosen).toEqual(ids);
    // Without a report the catalogue's cards choose the same four.
    chosen.length = 0;
    const catalogueCards = elementsOf(GuidedPipelineLayout!(layoutProps(null))).filter((el) => el.type === 'button' && classOf(el).includes('mbc-pipeline-card'));
    expect(catalogueCards).toHaveLength(4);
    for (const b of catalogueCards) (b.props as { onClick: () => void }).onClick();
    expect(chosen).toEqual(ids);
    // A notice (a run's error) shows above the steps, below the picker.
    const withNotice = renderToStaticMarkup(GuidedPipelineLayout!(layoutProps(report, <div className="mbc-pipeline-error" role="alert">Batch run failed</div>)));
    expect(sectionAt(withNotice, 'mbc-pipeline-picker')).toBeLessThan(sectionAt(withNotice, 'mbc-pipeline-error'));
    expect(sectionAt(withNotice, 'mbc-pipeline-error')).toBeLessThan(sectionAt(withNotice, 'mbc-stepper-section'));
    expect(sectionAt(withNotice, 'mbc-stepper-section')).toBeLessThan(sectionAt(withNotice, 'mbc-blueprint-card'));
    // While a run replaces a report already shown, the picker stays folded (no report to draw yet),
    // so the catalogue does not flash open between the two reports.
    const rerun = renderToStaticMarkup(GuidedPipelineLayout!(layoutProps(null, <div className="mbc-pipeline-progress-bar" role="status">Running</div>, true)));
    expect(sectionAt(rerun, 'mbc-pipeline-picker'), 'the picker stays while a run replaces a report').toBeGreaterThan(-1);
    expect(sectionAt(rerun, 'mbc-pipeline-catalog-grid'), 'the catalogue stays folded while a run replaces a report').toBe(-1);
    expect(sectionAt(rerun, 'mbc-pipeline-picker')).toBeLessThan(sectionAt(rerun, 'mbc-pipeline-progress-bar'));
    for (const cls of ['mbc-stepper-section', 'mbc-blueprint-card']) expect(sectionAt(rerun, cls), `no ${cls} before the new report`).toBe(-1);

    // ── The studio hands the layout its own choices ──
    // A server render re-runs a component whose state is set while it renders (structureToolsWiring
    // relies on the same for the App), so the studio runs inside a probe whose first render picks the
    // second pipeline and the second step through the callbacks the studio gave its layout.
    let firstPass = true;
    const StudioProbe = () => {
      const studioTree = (WorkflowPipelineStudio as unknown as (p: typeof studioProps) => React.ReactElement)(studioProps);
      const layout = elementsOf(studioTree).find((el) => el.type === GuidedPipelineLayout);
      if (!layout) throw new Error('the studio draws no GuidedPipelineLayout');
      if (firstPass) {
        firstPass = false;
        const props = layout.props as { onSelectPipeline: (id: BioPipelineId) => void; onSelectStep: (idx: number) => void };
        props.onSelectPipeline(ids[1]);
        props.onSelectStep(1);
      }
      return studioTree;
    };
    probe.report = report;
    const chosenInStudio = renderToStaticMarkup(<StudioProbe />);
    probe.report = undefined;
    expect(firstPass, 'the probe made its choices').toBe(false);
    expect(pickerChoices(chosenInStudio).map((b) => b.pressed), 'the picked pipeline is pressed').toEqual(ids.map((id) => id === ids[1]));
    expect(stepHeading(chosenInStudio), 'the picked step is the focused one').toBe(report.steps[1].title);
  });
});

// ─── BG-01M6REVT: the 3D card's badge says where its coordinates come from ───

/**
 * The `_atom_site` loop of AlphaFold DB entry AF-P69905-F1 (human haemoglobin subunit alpha, model
 * v6), cut to the Cα atoms of residues 1-5: B_iso_or_equiv holds each residue's pLDDT, as AlphaFold
 * DB writes it. From https://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v6.cif (fetched
 * 2026-11-06). ALPHAFOLD DATA, COPYRIGHT (2021) DEEPMIND TECHNOLOGIES LIMITED (AlphaFold DB's
 * copyright notice, as NOTICE section 6 quotes it). AlphaFold DB data, by Google DeepMind and
 * EMBL-EBI, are licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The attribution of these three fixtures, and of
 * the same five records under the constructed headers below, is in NOTICE section 6 and in
 * PROVENANCE.md ("Embedded third-party data").
 */
const AF_P69905_ATOM_SITE = [
  'loop_',
  ...['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_entity_id',
    'label_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'pdbx_formal_charge',
    'auth_seq_id', 'auth_comp_id', 'auth_asym_id', 'auth_atom_id', 'pdbx_PDB_model_num', 'pdbx_sifts_xref_db_acc',
    'pdbx_sifts_xref_db_name', 'pdbx_sifts_xref_db_num', 'pdbx_sifts_xref_db_res'].map((item) => `_atom_site.${item}`),
  'ATOM 2    C CA  . MET A 1 1   ? 2.296   10.344  14.712  1.00 65.38 ? 1   MET A CA  1 P69905 UNP 1   M',
  'ATOM 10   C CA  . VAL A 1 2   ? 0.139   7.746   16.585  1.00 91.12 ? 2   VAL A CA  1 P69905 UNP 2   V',
  'ATOM 17   C CA  . LEU A 1 3   ? -3.207  6.745   14.984  1.00 97.94 ? 3   LEU A CA  1 P69905 UNP 3   L',
  'ATOM 25   C CA  . SER A 1 4   ? -6.226  7.505   17.211  1.00 98.50 ? 4   SER A CA  1 P69905 UNP 4   S',
  'ATOM 31   C CA  . PRO A 1 5   ? -9.026  4.888   17.627  1.00 98.50 ? 5   PRO A CA  1 P69905 UNP 5   P',
  '#',
].join('\n');

/**
 * AF-P69905-F1 as AlphaFold DB's mmCIF file states what it is: the records that say so, kept from
 * the file above verbatim and in its order (trailing spaces trimmed). It is a ModelCIF file
 * (`_audit_conform` names mmcif_ma.dic, and the `_ma_` categories), it has no `_exptl` category,
 * its `_entry.id` is AF-P69905-F1, and its `_software` names AlphaFold.
 */
const AF_P69905_CIF = [
  'data_AF-P69905-F1', '#', '_entry.id AF-P69905-F1', '#',
  '_audit_conform.dict_location https://raw.githubusercontent.com/ihmwg/ModelCIF/master/dist/mmcif_ma.dic',
  '_audit_conform.dict_name     mmcif_ma.dic',
  '_audit_conform.dict_version  1.3.9', '#',
  '_ma_model_list.data_id          1',
  '_ma_model_list.model_group_id   1',
  '_ma_model_list.model_group_name "AlphaFold Monomer v2.0 model"',
  '_ma_model_list.model_id         1',
  '_ma_model_list.model_name       "Top ranked model"',
  '_ma_model_list.model_type       "Ab initio model"',
  '_ma_model_list.ordinal_id       1', '#',
  'loop_', '_ma_qa_metric.id', '_ma_qa_metric.mode', '_ma_qa_metric.name', '_ma_qa_metric.software_group_id', '_ma_qa_metric.type',
  '1 global pLDDT 1 pLDDT', '2 local  pLDDT 1 pLDDT', '#',
  'loop_', '_software.classification', '_software.date', '_software.description', '_software.name', '_software.pdbx_ordinal',
  '_software.type', '_software.version',
  'other ? "Structure prediction" AlphaFold 1 package v2.0',
  'other ? "Secondary structure"  dssp      2 library 4', '#',
  AF_P69905_ATOM_SITE,
].join('\n') + '\n';

/**
 * The same model as AlphaFold DB's PDB file (…/AF-P69905-F1-model_v6.pdb): its HEADER, TITLE and
 * MODEL records and the Cα records of residues 1-5, verbatim (trailing spaces trimmed). The file
 * has no EXPDTA record, and its TITLE opens "ALPHAFOLD MONOMER V2.0 PREDICTION FOR".
 */
const AF_P69905_PDB = [
  'HEADER                                            01-AUG-25',
  'TITLE     ALPHAFOLD MONOMER V2.0 PREDICTION FOR HEMOGLOBIN SUBUNIT ALPHA',
  'TITLE    2 (P69905)',
  'MODEL        1',
  'ATOM      2  CA  MET A   1       2.296  10.344  14.712  1.00 65.38           C',
  'ATOM     10  CA  VAL A   2       0.139   7.746  16.585  1.00 91.12           C',
  'ATOM     17  CA  LEU A   3      -3.207   6.745  14.984  1.00 97.94           C',
  'ATOM     25  CA  SER A   4      -6.226   7.505  17.211  1.00 98.50           C',
  'ATOM     31  CA  PRO A   5      -9.026   4.888  17.627  1.00 98.50           C',
  'ENDMDL', 'END',
].join('\n') + '\n';

/** An mmCIF file of the same five Cα atoms under the header given (a constructed fixture, laid out as RCSB writes one). */
const cifOf = (id: string, header: string[]) => [`data_${id}`, '#', `_entry.id ${id}`, '#', ...header, '#', AF_P69905_ATOM_SITE].join('\n') + '\n';
/** An mmCIF file whose method is ELECTRON MICROSCOPY, with the `_em_` records given. */
const emCif = (id: string, records: string[]) => cifOf(id, [`_exptl.entry_id ${id}`, "_exptl.method 'ELECTRON MICROSCOPY'", '#', ...records]);

/** `text` with `edit` applied; the edit must change it, so no fixture silently stays the one it was made from. */
const edited = (text: string, edit: (text: string) => string) => {
  const out = edit(text);
  expect(out, 'the fixture edit changed its text').not.toBe(text);
  return out;
};
/** The shipped 1D66 Cα trace (legacy PDB text with one TITLE record and no EXPDTA record), with `edit` applied. */
const trace1d66 = (edit: (text: string) => string) => edited(String(entry1d66.docMetadata?.PDBText ?? ''), edit);
/** The 1D66 trace with an EXPDTA record after its title. */
const traceWithMethod = (method: string) => trace1d66((t) => t.replace(/^(TITLE .*\n)/m, `$1EXPDTA    ${method}\n`));
/** The 1D66 trace under another TITLE (lines after the first as continuation records), still with no EXPDTA record. */
const traceTitled = (...lines: string[]) => trace1d66((t) => t.replace(/^TITLE .*$/m,
  lines.map((line, i) => (i ? `TITLE   ${String(i + 1).padStart(2)} ${line}` : `TITLE     ${line}`)).join('\n')));

/** A structure document as File › Import builds one: the file and its format, and nothing about where it came from. */
const importedStructure = (name: string, text: string, metadata: Record<string, unknown> = {}): SequenceDocument => ({
  ...entry1d66, id: `doc-${name.replace(/\W+/g, '-')}`, name,
  docMetadata: { 'Source Format': text.includes('_atom_site.') ? 'mmCIF' : 'PDB', PDBText: text, ...metadata },
});

/** The words of the 3D card's header badge, or null when the header has none. */
function coordinateBadge(html: string): string | null {
  const header = /<div class="studio-card-header"><h3>3D Structure &amp; Superposition<\/h3>([\s\S]*?)<\/div>/.exec(html);
  expect(header, 'the 3D card has its header').not.toBeNull();
  const badge = /<span class="badge-accent">([\s\S]*?)<\/span>/.exec(header![1]);
  return badge ? wordsOf(badge[1]) : null;
}

const MEASURED = (method: string) => `Measured Cα coordinates (${method})`;
const ALPHAFOLD = 'Predicted model (AlphaFold, pLDDT in B-factor)';
const PREDICTED = 'Predicted model';
const NOT_STATED = 'Cα coordinates (source not stated)';
const SHOWN = (methods: string) => `Cα coordinates (method: ${methods})`;

describe('the 3D card badge (BG-01M6REVT)', () => {
  it('badges a predicted model as predicted and an experimental structure as measured', async () => {
    // Each row is one document opened on the protein tab, and the badge its 3D card must show. The
    // wrong readers each group of rows fails:
    // - the constant "Measured Cα coordinates" fails every predicted and unstated row; a reader that
    //   takes a missing `_exptl` for a prediction fails the unstated rows; one that reads the
    //   document's Experiment field before the file fails the rows whose file outranks it, and one
    //   that ignores the field fails the shipped samples;
    // - one that reads an mmCIF value only on its item's line, or reads a `;` text field as words,
    //   or drops the values after a text field's closing `;`, or lets a keyword or an item name be a
    //   value, or compares item names by case, fails the mmCIF layout rows;
    // - one that classes only X-ray and NMR fails the neutron, fiber, powder, electron
    //   crystallography and scattering rows, and one that classes every name fails the EPR rows;
    // - one that badges every ELECTRON MICROSCOPY entry cryo-EM fails the EM rows, as does one that
    //   reads the `_em_vitrification` category before the stated flag, or takes a record of ids and
    //   nulls for vitrification, or presumes a negative stain from a specimen only not vitrified or
    //   only stained, or a stain the file rules out, or lets one specimen of two decide;
    // - one that badges a model only on the exact method THEORETICAL MODEL fails the SWISS-MODEL,
    //   MODELLER and PREDICTED MODEL rows;
    // - one that calls a file a prediction because its TITLE or `_software` or entry id mentions
    //   AlphaFold fails the rows that only mention it; one whose TITLE test is bare ALPHAFOLD, or
    //   unanchored, or drops the FOR of PREDICTION FOR, fails one of the three false TITLEs; one
    //   that knows ModelCIF only misses AlphaFold DB's PDB file.
    const rows: [SequenceDocument, string | null][] = [
      // The shipped samples: the trace states no method, the document records the experiment.
      [entry1d66, MEASURED('X-ray')],
      [chainA1d66, MEASURED('X-ray')],
      [entry1a4y, MEASURED('X-ray')],
      // The same trace imported as a file: nothing says where its coordinates came from.
      [importedStructure('1D66 trace, imported', String(entry1d66.docMetadata?.PDBText)), NOT_STATED],
      [importedStructure('mmCIF with a null method', cifOf('NULLMETHOD', ['_exptl.entry_id NULLMETHOD', '_exptl.method ?'])), NOT_STATED],
      [importedStructure('mmCIF whose method item has no value', cifOf('NOVALUE', ['_exptl.entry_id NOVALUE', '_exptl.method', '_exptl.details ?'])), NOT_STATED],
      // The method the file states, in PDB EXPDTA.
      [importedStructure('1D66 trace, X-ray', traceWithMethod('X-RAY DIFFRACTION')), MEASURED('X-ray')],
      [importedStructure('1D66 trace, NMR', traceWithMethod('SOLUTION NMR')), MEASURED('NMR')],
      [importedStructure('1D66 trace, solid-state NMR', traceWithMethod('SOLID-STATE NMR')), MEASURED('NMR')],
      [importedStructure('1D66 trace, X-ray and NMR', traceWithMethod('X-RAY DIFFRACTION; SOLUTION NMR')), MEASURED('X-ray, NMR')],
      [importedStructure('1D66 trace, solution and solid-state NMR', traceWithMethod('SOLUTION NMR; SOLID-STATE NMR')), MEASURED('NMR')],
      // The other experimental methods on wwPDB's list are measured too, each by its own name.
      [importedStructure('1D66 trace, X-ray and neutron', traceWithMethod('X-RAY DIFFRACTION; NEUTRON DIFFRACTION')), MEASURED('X-ray, neutron')],
      [importedStructure('1D66 trace, neutron', traceWithMethod('NEUTRON DIFFRACTION')), MEASURED('neutron')],
      [importedStructure('1D66 trace, fiber diffraction', traceWithMethod('FIBER DIFFRACTION')), MEASURED('fiber diffraction')],
      [importedStructure('1D66 trace, powder diffraction', traceWithMethod('POWDER DIFFRACTION')), MEASURED('powder diffraction')],
      [importedStructure('1D66 trace, electron crystallography', traceWithMethod('ELECTRON CRYSTALLOGRAPHY')), MEASURED('electron crystallography')],
      [importedStructure('1D66 trace, scattering', traceWithMethod('SOLUTION SCATTERING')), MEASURED('solution scattering')],
      [importedStructure('mmCIF, electron crystallography', cifOf('ECRYST', ['_exptl.entry_id ECRYST', "_exptl.method 'ELECTRON CRYSTALLOGRAPHY'"])),
        MEASURED('electron crystallography')],
      // A method the badge does not class is shown as the file states it, without "Measured".
      [importedStructure('1D66 trace, X-ray and EPR', traceWithMethod('X-RAY DIFFRACTION; EPR')), SHOWN('X-RAY DIFFRACTION; EPR')],
      // The method the file states, in mmCIF `_exptl.method`: as a pair or a loop, the value on
      // its item's line or a later one, quoted, bare or a `;` text field.
      [importedStructure('mmCIF, X-ray and neutron loop', cifOf('JOINT', ['loop_', '_exptl.entry_id', '_exptl.method',
        "JOINT 'X-RAY DIFFRACTION'", "JOINT 'NEUTRON DIFFRACTION'"])), MEASURED('X-ray, neutron')],
      // (The atom_site `loop_` follows this one-column loop's only value.)
      [importedStructure('mmCIF, a one-column method loop', cifOf('ONECOLUMN', ['loop_', '_exptl.method', "'SOLUTION NMR'"])), MEASURED('NMR')],
      [importedStructure('mmCIF, the method on the line after its item',
        cifOf('NEXTLINE', ['_exptl.entry_id NEXTLINE', '_exptl.method', "'SOLUTION NMR'"])), MEASURED('NMR')],
      [importedStructure('mmCIF, the method in a text field over two lines',
        cifOf('FIELD', ['_exptl.entry_id FIELD', '_exptl.method', ';X-RAY', 'DIFFRACTION', ';'])), MEASURED('X-ray')],
      [importedStructure('mmCIF, a loop of text fields, each closing line going on with the next value',
        cifOf('FIELDS', ['loop_', '_exptl.method', '_exptl.entry_id', ';X-RAY DIFFRACTION', '; FIELDS', ';EPR', '; FIELDS'])),
        SHOWN('X-RAY DIFFRACTION; EPR')],
      [importedStructure('mmCIF, item names in upper case', cifOf('UPPER', ['_EXPTL.ENTRY_ID UPPER', "_EXPTL.METHOD 'SOLUTION NMR'"])), MEASURED('NMR')],
      // Electron microscopy is named only as precisely as the file states the specimen. EXPDTA
      // has no specimen record, so a PDB file is plain electron microscopy.
      [importedStructure('1D66 trace, EM', traceWithMethod('ELECTRON MICROSCOPY')), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, no specimen records', emCif('EMPLAIN', [])), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, vitrified', emCif('EMVIT', ['_em_specimen.id 1', '_em_specimen.vitrification_applied YES'])), MEASURED('cryo-EM')],
      [importedStructure('EM mmCIF, a vitrification record only', emCif('EMCAT', ['_em_vitrification.id 1', '_em_vitrification.cryogen_name ETHANE'])),
        MEASURED('cryo-EM')],
      [importedStructure('EM mmCIF, vitrified and negatively stained', emCif('EMCRYONEG', ['_em_specimen.id 1', '_em_specimen.vitrification_applied YES',
        '#', '_em_staining.id 1', '_em_staining.type NEGATIVE'])), MEASURED('cryo-EM')],
      // Not being vitrified, or being stained, states no stain type: a negative stain is named only
      // by `_em_staining.type`.
      [importedStructure('EM mmCIF, not vitrified', emCif('EMNOTVIT', ['_em_specimen.id 1', '_em_specimen.vitrification_applied NO'])),
        MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, a stained resin section, no stain type', emCif('EMRESIN', ['_em_specimen.id 1',
        '_em_specimen.embedding_applied YES', '_em_specimen.staining_applied YES', '_em_specimen.vitrification_applied NO'])),
        MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, a negative stain', emCif('EMSTAIN', ['_em_staining.id 1', '_em_staining.type NEGATIVE',
        "_em_staining.material 'Uranyl Acetate'"])), MEASURED('negative-stain EM')],
      [importedStructure('EM mmCIF, not vitrified, stained, a negative stain', emCif('EMNEG', ['_em_specimen.id 1',
        '_em_specimen.staining_applied YES', '_em_specimen.vitrification_applied NO', '#', '_em_staining.id 1', '_em_staining.type NEGATIVE'])),
        MEASURED('negative-stain EM')],
      // An `_em_vitrification` record states vitrification only by a value besides its ids, and the
      // specimen's own flag outranks it.
      [importedStructure('EM mmCIF, a negative stain and a vitrification record with ids only', emCif('EMNULLVIT', ['_em_staining.id 1',
        '_em_staining.type NEGATIVE', '#', '_em_vitrification.entry_id EMNULLVIT', '_em_vitrification.id 1', '_em_vitrification.specimen_id 1',
        '_em_vitrification.citation_id ?', '_em_vitrification.cryogen_name ?', '_em_vitrification.humidity ?', '_em_vitrification.temp ?',
        '_em_vitrification.details ?'])), MEASURED('negative-stain EM')],
      [importedStructure('EM mmCIF, a negative stain and an all-null vitrification loop', emCif('EMNULLLOOP', ['_em_staining.id 1',
        '_em_staining.type NEGATIVE', '#', 'loop_', '_em_vitrification.id', '_em_vitrification.cryogen_name', '_em_vitrification.method', '? ? .'])),
        MEASURED('negative-stain EM')],
      [importedStructure('EM mmCIF, no stain, a vitrification record with ids only', emCif('EMIDSONLY', ['_em_vitrification.entry_id EMIDSONLY',
        '_em_vitrification.id 1', '_em_vitrification.specimen_id 1', '_em_vitrification.cryogen_name ?'])), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, not vitrified, with an empty vitrification record', emCif('EMNOTVITCAT', ['_em_specimen.id 1',
        '_em_specimen.vitrification_applied NO', '#', '_em_vitrification.id 1', '_em_vitrification.cryogen_name ?'])), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, not vitrified, a negative stain, a vitrification record', emCif('EMNOTVITSTATED', ['_em_specimen.id 1',
        '_em_specimen.vitrification_applied NO', '#', '_em_staining.id 1', '_em_staining.type NEGATIVE', '#',
        '_em_vitrification.id 1', '_em_vitrification.cryogen_name ETHANE'])), MEASURED('negative-stain EM')],
      [importedStructure('EM mmCIF, neither vitrified nor stained', emCif('EMBARE', ['_em_specimen.id 1', '_em_specimen.vitrification_applied NO',
        '_em_specimen.staining_applied NO'])), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, not vitrified, stain type NONE', emCif('EMNONE', ['_em_specimen.id 1', '_em_specimen.vitrification_applied NO',
        '#', '_em_staining.id 1', '_em_staining.type NONE'])), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, two specimens, one vitrified', emCif('EMMIXED', ['loop_', '_em_specimen.id', '_em_specimen.vitrification_applied',
        '1 YES', '2 NO'])), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, two specimens, one vitrified, one negative stain', emCif('EMMIXEDNEG', ['loop_', '_em_specimen.id',
        '_em_specimen.vitrification_applied', '1 YES', '2 NO', '#', '_em_staining.id 1', '_em_staining.specimen_id 2', '_em_staining.type NEGATIVE'])),
        MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, two stains, one negative', emCif('EMMIXEDSTAIN', ['loop_', '_em_staining.id', '_em_staining.type',
        '1 NEGATIVE', '2 NONE'])), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, two specimens not vitrified, one unstained', emCif('EMMIXEDSTAINED', ['loop_', '_em_specimen.id',
        '_em_specimen.vitrification_applied', '_em_specimen.staining_applied', '1 NO YES', '2 NO NO'])), MEASURED('electron microscopy')],
      [importedStructure('EM mmCIF, two specimens not vitrified, one unstained, one negative stain', emCif('EMMIXEDSTAINEDNEG', ['loop_',
        '_em_specimen.id', '_em_specimen.vitrification_applied', '_em_specimen.staining_applied', '1 NO YES', '2 NO NO', '#',
        '_em_staining.id 1', '_em_staining.specimen_id 1', '_em_staining.type NEGATIVE'])), MEASURED('electron microscopy')],
      // The file outranks the document's own record.
      [{ ...entry1d66, id: 'doc-1d66-nmr-file-in-an-x-ray-record', name: 'NMR file in an X-ray record',
        docMetadata: { ...entry1d66.docMetadata, PDBText: traceWithMethod('SOLUTION NMR') } }, MEASURED('NMR')],
      // An X-ray structure that names AlphaFold (a search model, or its title) is still measured.
      [importedStructure('X-ray mmCIF phased on an AlphaFold model', cifOf('XTAL', ['_exptl.entry_id XTAL', "_exptl.method 'X-RAY DIFFRACTION'",
        '#', 'loop_', '_software.name', '_software.classification', 'PHENIX refinement', 'AlphaFold phasing'])), MEASURED('X-ray')],
      [importedStructure('1D66 trace titled after AlphaFold', trace1d66((t) => t.replace(/^TITLE .*$/m,
        'TITLE     CRYSTAL STRUCTURE THAT CONFIRMS AN ALPHAFOLD PREDICTION').replace(/^(TITLE .*\n)/m, '$1EXPDTA    X-RAY DIFFRACTION\n'))), MEASURED('X-ray')],
      // A file that states no method and is not ModelCIF says nothing about its coordinates, whatever
      // it says about AlphaFold: three TITLEs that are not AlphaFold DB's, AlphaFold in `_software`
      // (for phasing), and an AlphaFold DB entry id.
      [importedStructure('crystal PDB titled after an AlphaFold prediction, no EXPDTA',
        traceTitled('CRYSTAL STRUCTURE OF KINASE X CONFIRMS THE ALPHAFOLD PREDICTION')), NOT_STATED],
      [importedStructure('crystal PDB titled after an AlphaFold prediction for a loop, no EXPDTA',
        traceTitled('CRYSTAL STRUCTURE OF KINASE X CONFIRMS THE ALPHAFOLD PREDICTION FOR', 'ITS ACTIVATION LOOP')), NOT_STATED],
      [importedStructure('PDB titled with an AlphaFold prediction confirmed, no EXPDTA',
        traceTitled('ALPHAFOLD PREDICTION CONFIRMED BY THE CRYSTAL STRUCTURE OF KINASE X')), NOT_STATED],
      [importedStructure('mmCIF with no method, phased on an AlphaFold model', cifOf('PHASED', ['loop_', '_software.name', '_software.classification',
        'PHENIX refinement', 'AlphaFold phasing'])), NOT_STATED],
      [importedStructure('mmCIF with no method, an AlphaFold DB id, not ModelCIF', cifOf('AF-P69905-F1', [])), NOT_STATED],
      // Predicted models: AlphaFold DB's two files, and each sign on its own.
      [importedStructure('AF-P69905-F1 (mmCIF)', AF_P69905_CIF), ALPHAFOLD],
      [importedStructure('AF-P69905-F1 (PDB)', AF_P69905_PDB), ALPHAFOLD],
      [importedStructure('AlphaFold DB id, no software loop', edited(AF_P69905_CIF, (t) => t.replace(/^loop_\n_software\.[\s\S]*?\n#\n/m, ''))), ALPHAFOLD],
      [importedStructure('AlphaFold software, another id', edited(AF_P69905_CIF, (t) => t.replace(/AF-P69905-F1/g, 'model_1'))), ALPHAFOLD],
      [importedStructure('ModelCIF from another predictor',
        edited(AF_P69905_CIF, (t) => t.replace(/AF-P69905-F1/g, 'model_1').replace(/AlphaFold/g, 'Modeller'))), PREDICTED],
      [{ ...entry1d66, id: 'doc-1d66-holding-an-alphafold-model', name: 'AlphaFold model in an X-ray record', docMetadata: { ...entry1d66.docMetadata, PDBText: AF_P69905_CIF } }, ALPHAFOLD],
      // A stated method that begins THEORETICAL MODEL or PREDICTED MODEL, in either format.
      [importedStructure('1D66 trace, theoretical model', traceWithMethod('THEORETICAL MODEL')), PREDICTED],
      [importedStructure('1D66 trace, SWISS-MODEL', traceWithMethod('THEORETICAL MODEL (SWISS-MODEL SERVER)')), PREDICTED],
      [importedStructure('1D66 trace, MODELLER', traceWithMethod('THEORETICAL MODEL, MODELLER 10.4')), PREDICTED],
      [importedStructure('1D66 trace, predicted model', traceWithMethod('PREDICTED MODEL')), PREDICTED],
      [importedStructure('mmCIF, SWISS-MODEL', cifOf('SWISS', ["_exptl.method 'THEORETICAL MODEL (SWISS-MODEL SERVER)'"])), PREDICTED],
      [importedStructure('mmCIF, MODELLER', cifOf('MODELLER', ["_exptl.method 'THEORETICAL MODEL, MODELLER 10.4'"])), PREDICTED],
      // A model names AlphaFold only by AlphaFold DB's TITLE, an AlphaFold DB id, or a ModelCIF file's software.
      [importedStructure('1D66 trace, theoretical model titled as AlphaFold DB titles its files', trace1d66((t) => t
        .replace(/^TITLE .*$/m, 'TITLE     ALPHAFOLD MONOMER V2.0 PREDICTION FOR GAL4').replace(/^(TITLE .*\n)/m, '$1EXPDTA    THEORETICAL MODEL\n'))), ALPHAFOLD],
      [importedStructure('1D66 trace, theoretical model titled after an AlphaFold prediction', trace1d66((t) => t
        .replace(/^TITLE .*$/m, 'TITLE     GAL4 MODEL CHECKED AGAINST THE ALPHAFOLD PREDICTION FOR GAL4')
        .replace(/^(TITLE .*\n)/m, '$1EXPDTA    THEORETICAL MODEL\n'))), PREDICTED],
      [importedStructure('mmCIF theoretical model listing AlphaFold, not ModelCIF', cifOf('THEORY', ["_exptl.method 'THEORETICAL MODEL'", '#',
        'loop_', '_software.name', '_software.classification', 'AlphaFold other'])), PREDICTED],
      // No coordinates, no claim about them.
      [egfp, null],
      [egfpEmptyFile, null],
    ];

    // The real files: the method RCSB records for each entry, in both formats. 6VXX.cif states that
    // its specimen was vitrified; 6VXX.pdb's EXPDTA says only ELECTRON MICROSCOPY.
    if (haveTestData('rcsb/4HHB.cif', 'rcsb/4HHB.pdb', 'rcsb/1A5R.cif', 'rcsb/1A5R.pdb', 'rcsb/6VXX.cif', 'rcsb/6VXX.pdb')) {
      const nodeFs: string = 'node:fs';
      const fs = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync: (p: string, e: string) => string };
      const read = (file: string) => importedStructure(file, fs.readFileSync(dataPath(`rcsb/${file}`), 'utf8'));
      rows.push(
        [read('4HHB.cif'), MEASURED('X-ray')], [read('4HHB.pdb'), MEASURED('X-ray')],
        [read('1A5R.cif'), MEASURED('NMR')], [read('1A5R.pdb'), MEASURED('NMR')],
        [read('6VXX.cif'), MEASURED('cryo-EM')], [read('6VXX.pdb'), MEASURED('electron microscopy')],
      );
    }

    // Each document's 3D card: the viewer is drawn exactly when there are coordinates, and the badge says what they are.
    for (const [doc, badge] of rows) {
      const html = proteinTab(doc);
      expect(proteinCards(html).viewer >= 0, `${doc.name}: the viewer is drawn exactly when there are coordinates`).toBe(badge !== null);
      expect(coordinateBadge(html), doc.name).toBe(badge);
    }

    // A file loaded into the tab takes the place of the document's own structure, so the
    // document's Experiment record says nothing about it. A server render cannot load a file (the
    // tab reads one asynchronously), so the badge's decision is checked on its own, given the file,
    // whether it was loaded, and the 1D66 sample's record: a model file with no header records is
    // unstated when it is loaded, and read as the record when it is the document's own file.
    const xrayRecord = entry1d66.docMetadata?.Experiment;
    expect(xrayRecord, 'the 1D66 sample records its experiment').toBe('X-ray diffraction');
    const headerless = edited(AF_P69905_PDB, (t) => t.replace(/^(HEADER|TITLE) .*\n/gm, ''));
    expect(coordinateSourceBadge(headerless, true, xrayRecord), 'a headerless model loaded into the 1D66 sample').toBe(NOT_STATED);
    expect(coordinateSourceBadge(headerless, false, xrayRecord), 'the same file as the 1D66 document\'s own').toBe(MEASURED('X-ray'));
    expect(coordinateSourceBadge(AF_P69905_PDB, true, xrayRecord), 'AlphaFold DB\'s PDB file loaded into the 1D66 sample').toBe(ALPHAFOLD);
    expect(coordinateSourceBadge(traceWithMethod('SOLUTION NMR'), true, xrayRecord), 'an NMR file loaded into the 1D66 sample').toBe(MEASURED('NMR'));
  });
});
