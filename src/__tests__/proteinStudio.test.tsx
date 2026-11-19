// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q164: proteins get a studio of their own. The Protein studio (viewer tab `protein-3d`)
 * holds ProtParam, hydropathy, the 3D viewer and the coiled-coil and TM predictions; History keeps
 * a protein's provenance only, in aa; every route to protein tools opens the Protein studio; a
 * session keeps it through the Rust codec; no guided-pipeline step sends the user to History.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';

/** Every set of props the 3D viewer is drawn with, so a test reads what the viewer was handed. */
const viewer = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock('../components/ProteinStructure3DViewer', async () => {
  const actual = await vi.importActual<typeof import('../components/ProteinStructure3DViewer')>('../components/ProteinStructure3DViewer');
  const ProteinStructure3DViewer = (props: Record<string, unknown>) => {
    viewer.props.push(props);
    return React.createElement('div', { 'data-probe': 'protein-3d-viewer' });
  };
  return { ...actual, ProteinStructure3DViewer };
});

// The App is mounted through appHarness, which needs React DOM to load after its live DOM exists: the
// studios and React DOM's server renderer are loaded inside each test, and the App tests run first.
import { mountApp, type AppHarness } from './appHarness';
import type { ProteinStudioProps } from '../components/ProteinStudio';
const load = async () => ({
  renderToStaticMarkup: (await import('react-dom/server')).renderToStaticMarkup,
  genomics: await import('../core/genomicsAndStructureSuite'),
  ProteinStudio: (await import('../components/ProteinStudio')).ProteinStudio,
  analyzeProteinSequence: (await import('../core/bioEngine')).analyzeProteinSequence,
  HybridToolsAndHistoryStudio: (await import('../components/HybridToolsAndHistoryStudio')).HybridToolsAndHistoryStudio,
  DocumentInfoPanel: (await import('../components/DocumentInfoPanel')).DocumentInfoPanel,
  ...(await import('../core/mbcSessionFormat')),
  ...(await import('../core/documentViews')),
  ...(await import('../core/bioPipelineEngine')),
});

afterEach(() => {
  vi.restoreAllMocks();
  viewer.props.length = 0;
});

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (html: string) => words(html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'"));

// ─── Fixtures ───

const THREE: Record<string, string> = { M: 'MET', K: 'LYS', T: 'THR', A: 'ALA', Y: 'TYR', I: 'ILE', Q: 'GLN', R: 'ARG', L: 'LEU', E: 'GLU' };
const CHAIN_SEQ = 'MKTAYIAKQRQLEEAKRL';

/** A one-chain mmCIF entry (N, CA, C of an ideal alpha helix), generated here: no file is read. */
function helixCif(seq: string): string {
  const rows: string[] = [];
  let id = 0;
  const at = (i: number, phase: number, r: number, dz: number) => {
    const t = ((100 * i + phase) * Math.PI) / 180;
    return [r * Math.cos(t), r * Math.sin(t), 1.5 * i + dz].map((v) => v.toFixed(3)).join(' ');
  };
  [...seq].forEach((aa, i) => {
    for (const [name, phase, r, dz] of [['N', -28, 1.55, -0.6], ['CA', 0, 2.3, 0], ['C', 28, 1.65, 0.6]] as const) {
      rows.push(`ATOM ${++id} ${name[0]} ${name} . ${THREE[aa]} A ${i + 1} ? ${at(i, phase, r, dz)} 1.00 20.00 ${i + 1} A 1`);
    }
  });
  return ['data_9PRT', 'loop_',
    ...['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_seq_id',
      'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'auth_seq_id', 'auth_asym_id',
      'pdbx_PDB_model_num'].map((c) => `_atom_site.${c}`),
    ...rows, '#', ''].join('\n');
}

const BASE: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', features: [], primers: [], history: [],
};
const CIF = helixCif(CHAIN_SEQ);
const CHAIN: SequenceDocument = {
  ...BASE, id: 'q164-chain', name: '9PRT chain A', accession: '9PRT_A', moleculeType: 'Protein', sequence: CHAIN_SEQ,
  folder: 'Protein Documents', docMetadata: { 'Source Format': 'mmCIF', PDBText: CIF, Chain: 'A' },
};
const PLAIN: SequenceDocument = {
  ...BASE, id: 'q164-plain', name: 'Plain_Protein', accession: 'PP_1', moleculeType: 'Protein',
  sequence: 'MKWVTFISLLFLFSSAYSRGVFRRDTHKSEIAHRFKDLGEEHFKGLVLIAFSQYLQQCPFDEHVKLVNEL', folder: 'Protein Documents',
};
const CDS_DNA = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCTACATACGGAAAGCTTACCCTTAAATTTATTTGCACTACTGGAAAACTACCTGTTCCATGGCCAACACTTGTCACTACTTTCTCTTATGGTGTTCAATGCTTTTCCCGTTATCCGGATCATATGAAACGGCATGACTTTTTCAAGAGTGCCATGCCCGAAGGTTATGTACAGGAACGCACTATATCTTTCAAAGATGACGGGAACTACAAGACGCGTGCTGAAGTCAAGTTTGAAGGTGATACCCTTGTTAATCGTATCGAGTTAAAAGGTATTGATTTTAAAGAAGATGGAAACATTCTCGGACACAAACTCGAGTACAACTATAACTCACACAATGTATACATCACGGCAGACAAACAAAAGAATGGAATCAAAGCTAACTTCAAAATTCGCCACAACATTGAAGATGGATCCGTTCAACTAGCAGACCATTATCAACAAAATACTCCAATTGGCGATGGCCCTGTCCTTTTACCAGACAACCATTACCTGTCGACACAATCTGCCCTTTCGAAAGATCCCAACGAAAAGCGTGACCACATGGTCCTTCTTGAGTTTGTAACTGCTGCTGGGATTACACATGGCATGGATGAGCTCTACAAATAA';
const DNA: SequenceDocument = {
  ...BASE, id: 'q164-dna', name: 'Q164_GFP_Construct', accession: 'Q164_1', topology: 'circular',
  sequence: `${'GATC'.repeat(10)}${CDS_DNA}${'CCGG'.repeat(10)}`,
  features: [{ id: 'cds', name: 'GFP', type: 'CDS', start: 41, end: 40 + CDS_DNA.length, strand: 1, color: '#16a34a' }],
};

const CODON_OPTIMISER = 'Back-Translate & Multi-Host Codon Optimizer';
const PROTPARAM = ['Molecular Weight', 'Isoelectric Point (pI)', 'ε₂₈₀ reduced / cystines', 'GRAVY / Aliphatic', 'Instability Index'];

/** The value of the one KPI box labelled `label`, in the text a reader sees. */
function kpi(html: string, label: string): string {
  const found = [...html.matchAll(/<div class="kpi-box"><span class="kpi-label"[^>]*>([\s\S]*?)<\/span><strong class="kpi-val"[^>]*>([\s\S]*?)<\/strong><\/div>/g)]
    .filter((m) => text(m[1]) === label);
  expect(found, `one "${label}" box`).toHaveLength(1);
  return text(found[0][2]);
}
/**
 * The instability index the studio shows for a protein is the engine's own (Guruprasad DIWV, ExPASy-checked
 * in outsideDataSeqTools.test.ts), and the fixture's value differs from every other ProtParam figure, so a
 * box reading another field cannot pass.
 */
async function expectInstability(html: string, seq: string) {
  const { analyzeProteinSequence } = await load();
  const r = analyzeProteinSequence(seq, false, 9) as ReturnType<typeof analyzeProteinSequence> & { instabilityIndex: number };
  expect(Number.isFinite(r.instabilityIndex), 'the engine reports an instability index for the fixture').toBe(true);
  const others = [r.gravyHydropathy, r.aliphaticIndex, r.isoelectricPointPi, r.molecularWeightKda, r.chargeAtPh7].map(String);
  expect(others, 'the fixture tells the instability index from the other figures').not.toContain(String(r.instabilityIndex));
  expect(kpi(html, 'Instability Index'), 'the engine\'s instability index').toBe(String(r.instabilityIndex));
}

const protein = async (doc: SequenceDocument, more: Partial<ProteinStudioProps> = {}) => {
  const { renderToStaticMarkup, ProteinStudio } = await load();
  return renderToStaticMarkup(<ProteinStudio activeDoc={doc} proteinDocuments={[CHAIN, PLAIN]} {...more} />);
};

// ─── AC2 ───

const LIBRARY = [DNA, CHAIN, PLAIN];
const railCurrent = (app: AppHarness) => app.one('.mbc-studio-rail-list').getAttribute('data-current-studio');
async function expectProteinStudio(app: AppHarness, route: string) {
  await app.settle();
  expect(app.activeTab(), `${route} opens the protein-3d tab`).toBe('protein-3d');
  expect(railCurrent(app), `${route}: the rail marks Protein & 3D`).toBe('protein-3d');
  expect(text(app.canvas().textContent ?? ''), `${route}: the studio is drawn`).toContain('3D Structure & Superposition');
}
async function inWindowMenu(app: AppHarness, top: string, path: string[]) {
  const trigger = app.all('.mbc-menubar [role="menuitem"]').find((b) => words(b.getAttribute('aria-label') ?? b.textContent) === top);
  if (!trigger) throw new Error(`no ${top} menu`);
  await app.click(trigger);
  for (const [depth, label] of path.entries()) {
    const item = app.all('.desktop-menu-popup')[depth]?.querySelectorAll('button').find((b) => words(b.textContent).startsWith(label));
    if (!item) throw new Error(`no ${label} under ${top} > ${path.slice(0, depth).join(' > ')}`);
    await app.click(item);
  }
}

describe('US-01M6Q164 AC2: every route to protein tools', () => {
  it('US-01M6Q164 AC2 the rail, ⌘K, the Annotate menu and the native id open the Protein studio', async () => {
    const app = await mountApp();
    try {
      const reset = async () => {
        await app.restoreSession({ documents: LIBRARY, activeDocId: CHAIN.id, viewerTab: 'sequence-view' });
        expect(app.activeTab()).toBe('sequence-view');
      };
      await reset();
      await app.clickStudio('protein-3d');
      await expectProteinStudio(app, 'the rail');

      await reset();
      await app.press('k', { mod: true });
      const item = app.all('.mbc-cmd-palette-item').filter((el) => el.getAttribute('data-studio') === 'protein-3d');
      expect(item, '⌘K lists Protein & 3D once').toHaveLength(1);
      expect(words(item[0].textContent)).toContain('Protein & 3D');
      await app.click(item[0]);
      await expectProteinStudio(app, '⌘K Protein & 3D');

      await reset();
      await inWindowMenu(app, 'Sequence', ['Annotate', 'Protein & 3D', '3D Structure & Coils']);
      await expectProteinStudio(app, 'Sequence > Annotate > Protein & 3D > 3D Structure & Coils');

      await reset();
      await app.menu('annotate:coils-tm-pdb');
      await expectProteinStudio(app, 'annotate:coils-tm-pdb');
      // On a DNA record too, where the genomics tab is offered: the route names the Protein studio, not a fallback.
      await app.restoreSession({ documents: LIBRARY, activeDocId: DNA.id, viewerTab: 'sequence-view' });
      await app.menu('annotate:coils-tm-pdb');
      await expectProteinStudio(app, 'annotate:coils-tm-pdb on DNA');
      await app.restoreSession({ documents: LIBRARY, activeDocId: DNA.id, viewerTab: 'sequence-view' });
      await inWindowMenu(app, 'Sequence', ['Annotate', 'Protein & 3D', '3D Structure & Coils']);
      await expectProteinStudio(app, 'Sequence > Annotate > Protein & 3D > 3D Structure & Coils on DNA');

      // Back-translation and the protein analysis routes reach the same studio.
      await reset();
      await app.menu('sequence:back-translate');
      await expectProteinStudio(app, 'sequence:back-translate');

      // Protein Domains still runs the motif search, which for a protein shows its analysis in the Protein studio.
      await reset();
      await app.menu('annotate:protein-domains');
      await expectProteinStudio(app, 'annotate:protein-domains');
      expect(text(app.all('.statusbar-toast-text').map((s) => s.textContent).join(' '))).toContain('Protein Domains: motif and domain scanning is available for DNA/RNA');

      // Align Structures still opens the structure alignment window.
      await reset();
      await app.menu('align:structures-dialog');
      await app.settle();
      expect(app.all('dialog[aria-labelledby="opdlg-structure-alignment"]'), 'the Align Structures window').toHaveLength(1);
    } finally {
      app.unmount();
    }
  });

  it('US-01M6Q164 AC2 genomics-ngs is not offered for a protein and a DNA record keeps it for Pipelines & NGS', async () => {
    const app = await mountApp();
    try {
      // A protein is not offered genomics-ngs (a session saved on it opens the Protein studio, AC3).
      await app.restoreSession({ documents: LIBRARY, activeDocId: CHAIN.id, viewerTab: 'sequence-view' });
      expect(app.railTabs().filter((b) => b.getAttribute('data-view') === 'genomics-ngs'), 'no rail entry opens genomics-ngs').toHaveLength(0);
      await app.restoreSession({ documents: LIBRARY, activeDocId: DNA.id, viewerTab: 'genomics-ngs' });
      expect(app.activeTab()).toBe('genomics-ngs');
      expect(railCurrent(app)).toBe('pipelines-ngs');
      expect(text(app.canvas().textContent ?? ''), 'the genomics studio has no 3D sub-view').not.toContain('Coiled-Coils, Transmembrane & 3D PDB');
    } finally {
      app.unmount();
    }
  });
});

// ─── AC1 ───

describe('US-01M6Q164 AC1: the Protein studio', () => {
  it('US-01M6Q164 AC1 the Protein studio shows ProtParam, hydropathy, the 3D viewer and coiled-coil and TM predictions', async () => {
    const { genomics } = await load();
    const topology = vi.spyOn(genomics, 'predictCoiledCoilsAndTransmembrane');
    const html = await protein(CHAIN);
    const shown = text(html);
    for (const label of PROTPARAM) expect(shown, `the chain's ${label}`).toContain(label);
    expect(shown, 'the Kyte-Doolittle profile').toContain('Kyte-Doolittle');
    expect(shown).toContain('Coiled-Coils (Lupas) & Transmembrane Helix Topology');
    expect(shown).toContain('Transmembrane Helices');
    expect(shown).toContain(`${CHAIN_SEQ.length} aa Analyzed`);
    expect(topology, 'the predictions run once').toHaveBeenCalledTimes(1);
    expect(topology, 'on the protein sequence').toHaveBeenCalledWith(CHAIN_SEQ);
    // One viewer, handed the parsed full-atom model of the file, and drawn first.
    expect(viewer.props, 'one 3D viewer').toHaveLength(1);
    const [props] = viewer.props;
    expect(props.structure, 'the parsed structure').toBeTruthy();
    expect((props.structure as { chains?: unknown[] }).chains ?? props.structure).toBeTruthy();
    expect(props.structureText).toBe(CIF);
    expect((props.primaryAtoms as unknown[]).length, 'one C-alpha per residue').toBe(CHAIN_SEQ.length);
    expect(props.activeChainId).toBe('A');
    const at = (needle: string) => { const i = html.indexOf(needle); expect(i, needle).toBeGreaterThanOrEqual(0); return i; };
    expect(at('data-probe="protein-3d-viewer"'), 'the viewer comes before the predictions').toBeLessThan(at('Coiled-Coils (Lupas)'));
    expect(at('data-probe="protein-3d-viewer"'), 'and before the protein analysis').toBeLessThan(at('EMBOSS Protein Analysis'));
    expect(shown, 'no codon optimiser for a protein').not.toContain(CODON_OPTIMISER);
    expect(html).not.toContain('has no 3D coordinates');
    await expectInstability(html, CHAIN_SEQ);
  });

  it('US-01M6Q164 AC1 a plain protein shows the same analyses and the import-a-structure callout, with no viewer', async () => {
    const { genomics } = await load();
    const topology = vi.spyOn(genomics, 'predictCoiledCoilsAndTransmembrane');
    const html = await protein(PLAIN);
    const shown = text(html);
    for (const label of PROTPARAM) expect(shown, `the plain protein's ${label}`).toContain(label);
    await expectInstability(html, PLAIN.sequence);
    expect(shown).toContain('Kyte-Doolittle');
    expect(shown).toContain(`${PLAIN.sequence.length} aa Analyzed`);
    expect(topology).toHaveBeenCalledTimes(1);
    expect(topology).toHaveBeenCalledWith(PLAIN.sequence);
    expect(shown).toContain(`${PLAIN.name} has no 3D coordinates. Import a structure file`);
    expect(viewer.props, 'no empty viewer').toHaveLength(0);
    expect(shown).not.toContain(CODON_OPTIMISER);
  });

  it('US-01M6Q164 AC1 the instability index reads n/a where the engine has none, as GRAVY and aliphatic do', async () => {
    const doc = (id: string, sequence: string): SequenceDocument => ({ ...PLAIN, id, name: id, sequence });
    // No standard residue: no GRAVY, aliphatic or instability value.
    const none = await protein(doc('only_x', 'XXXX'));
    expect(kpi(none, 'GRAVY / Aliphatic')).toBe('n/a: no standard residue');
    expect(kpi(none, 'Instability Index')).toBe('n/a: no standard residue');
    // One standard residue: GRAVY and aliphatic have a value, the instability index (a dipeptide sum) has none.
    const one = await protein(doc('one_m', 'XMX'));
    expect(kpi(one, 'GRAVY / Aliphatic')).toMatch(/\d/);
    expect(kpi(one, 'Instability Index')).toBe('n/a: fewer than two standard residues');
  });

  it('US-01M6Q164 AC1 a DNA document is analysed through its CDS translation and keeps the codon optimiser', async () => {
    const shown = text(await protein(DNA));
    expect(shown).toContain('EMBOSS Protein Analysis — GFP (41..');
    expect(shown).toContain(CODON_OPTIMISER);
    expect(shown).toContain('Molecular Weight');
  });
});

// ─── AC3 ───

const snapshot = (viewerTab: string, activeDocId: string) => ({
  sessionName: 'Q164_Session',
  documents: LIBRARY,
  workspace: {
    activeDocId, selectedFolder: 'All Project Files', navHistory: [activeDocId], navIndex: 0,
    viewerTab, mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
    darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
    displaySettings: { showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true, showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false },
  },
}) as unknown as import('../core/mbcSessionFormat').MbcWorkbenchSnapshot;

describe('US-01M6Q164 AC3: a session keeps the Protein studio', () => {
  it('US-01M6Q164 AC3 protein-3d round-trips through the WASM codec and a legacy genomics-ngs protein opens the Protein studio', async () => {
    const { parseMbcWorkbench, serializeMbcWorkbench, resolveViewerTab } = await load();
    const saved = parseMbcWorkbench(serializeMbcWorkbench(snapshot('protein-3d', CHAIN.id)));
    expect(saved.envelope.workspace.viewerTab, 'protein-3d round-trips').toBe('protein-3d');
    expect(resolveViewerTab(CHAIN, saved.envelope.workspace.viewerTab)).toBe('protein-3d');

    const legacy = parseMbcWorkbench(serializeMbcWorkbench(snapshot('genomics-ngs', CHAIN.id)));
    expect(legacy.envelope.workspace.viewerTab, 'the codec keeps a legacy genomics-ngs').toBe('genomics-ngs');
    expect(resolveViewerTab(CHAIN, legacy.envelope.workspace.viewerTab), 'a structure on genomics-ngs opens the Protein studio').toBe('protein-3d');

    // A tab the codec does not know still falls back to Sequence view, as an older build reads protein-3d.
    const unknown = parseMbcWorkbench(serializeMbcWorkbench(snapshot('protein-4d', CHAIN.id)));
    expect(unknown.envelope.workspace.viewerTab).toBe('sequence-view');
  });
});

// ─── AC8 ───

describe('US-01M6Q164 AC8: a protein reads in aa', () => {
  it('US-01M6Q164 AC8 a 141-residue chain reads 141 aa in History and Info, with no topology and no strain picker', async () => {
    const seq = 'VLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR';
    expect(seq).toHaveLength(141);
    const chain: SequenceDocument = {
      ...BASE, id: 'q164-4hhb-a', name: '4HHB chain A', accession: '4HHB_A', moleculeType: 'Protein', topology: 'linear', sequence: seq,
      folder: 'Protein Documents',
      history: [{ id: 'h1', timestamp: '2026-11-19 10:00', operation: 'Imported', description: 'Imported from 4HHB.cif', parentIds: [], lengthBp: 141, topology: 'linear' }],
    } as SequenceDocument;
    const { renderToStaticMarkup, HybridToolsAndHistoryStudio, DocumentInfoPanel } = await load();
    const history = text(renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={chain} allDocuments={[chain]} />));
    const info = text(renderToStaticMarkup(<DocumentInfoPanel doc={chain} onUpdateDocument={() => {}} />));
    for (const [where, shown] of [['History', history], ['Info', info]] as const) {
      expect(shown, `${where} reads 141 aa`).toContain('141 aa');
      expect(shown.match(/.{0,50}\bbp\b.{0,20}/)?.[0] ?? 'none', `${where} says no bp`).toBe('none');
      expect(shown.match(/.{0,50}(linear|LINEAR|circular|CIRCULAR|Topology).{0,20}/)?.[0] ?? 'none', `${where} names no topology`).toBe('none');
      expect(shown, `${where} has no strain picker`).not.toContain('Transformation Strain');
      expect(shown).not.toContain('DH5α');
    }
    expect(history, 'History holds no protein analysis').not.toContain('EMBOSS Protein Analysis');
  });
});

// ─── AC9 ───

const PROTEIN_LABEL = /Protein|Biophysics|Codon|Hydropathy/;
const FOLD_LABEL = /Fold/;

describe('US-01M6Q164 AC9: no guided-pipeline step sends the user to History', () => {
  it('US-01M6Q164 AC9 every step and zone of the four pipelines, run by the WASM engine, targets the studio hosting its tool', async () => {
    const { BIO_PIPELINE_CATALOG, executeBioPipelineAsync } = await load();
    expect(BIO_PIPELINE_CATALOG).toHaveLength(4);
    const seen = { protein: 0, fold: 0, zones: 0 };
    for (const def of BIO_PIPELINE_CATALOG) {
      const report = await executeBioPipelineAsync(DNA, def.id);
      for (const step of report.steps) {
        const where = `${def.id} step ${step.stepNumber} (${step.targetStudioLabel})`;
        expect(step.targetStudio, where).not.toBe('history-hybrid');
        if (FOLD_LABEL.test(step.targetStudioLabel)) {
          seen.fold++;
          expect(step.targetStudio, where).toBe('primers-pcr');
        } else if (PROTEIN_LABEL.test(step.targetStudioLabel) && !/Primer|CRISPR|Vector|Clon/.test(step.targetStudioLabel)) {
          seen.protein++;
          expect(step.targetStudio, where).toBe('protein-3d');
        }
      }
      for (const zone of report.visualZones) {
        seen.zones++;
        expect(zone.targetStudio, `${def.id} zone ${zone.label}`).not.toBe('history-hybrid');
        if (/5'.*(leader|fold)|fold/i.test(zone.label)) expect(zone.targetStudio, `${def.id} zone ${zone.label}`).toBe('primers-pcr');
      }
    }
    expect(seen.protein, 'the protein, biophysics, codon and hydropathy steps were read').toBeGreaterThanOrEqual(4);
    expect(seen.fold, 'the folding step was read').toBeGreaterThanOrEqual(1);
    // The Protein studio hosts the tools those labels name: ProtParam (biophysics), the Kyte-Doolittle and GOR plots, and the codon optimiser.
    const shown = text(await protein(DNA));
    for (const tool of ['EMBOSS Protein Analysis', 'Molecular Weight', 'Kyte-Doolittle', 'α-Helix (GOR H)', CODON_OPTIMISER]) expect(shown, tool).toContain(tool);
  });
});
