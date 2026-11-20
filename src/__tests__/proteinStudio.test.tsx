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
  // First in AC3: the App mounts before any studio or React DOM's server renderer is loaded (see the imports).
  it('US-01M6Q164 AC3 an older session saved on genomics-ngs with a plain protein reopens in the Protein studio, and a DNA record keeps genomics-ngs', async () => {
    expect(PLAIN.docMetadata?.PDBText, 'the fixture has no structure').toBeUndefined();
    const app = await mountApp();
    try {
      // The harness restores the session, then refuses any tab other than the one saved: here, by design.
      await expect(app.restoreSession({ documents: LIBRARY, activeDocId: PLAIN.id, viewerTab: 'genomics-ngs' }),
        'the App restores the session, on protein-3d').rejects.toThrow('the App restored the session on the protein-3d tab, not genomics-ngs');
      await app.settle();
      expect(app.activeTab(), 'the restored plain protein opens the protein-3d tab').toBe('protein-3d');
      expect(railCurrent(app), 'the rail marks Protein & 3D').toBe('protein-3d');
      await app.restoreSession({ documents: LIBRARY, activeDocId: DNA.id, viewerTab: 'genomics-ngs' });
      await app.settle();
      expect(app.activeTab(), 'a DNA record restored on genomics-ngs stays there').toBe('genomics-ngs');
      expect(railCurrent(app)).toBe('pipelines-ngs');
    } finally {
      app.unmount();
    }

    const { parseMbcWorkbench, serializeMbcWorkbench, resolveViewerTab } = await load();
    const legacy = parseMbcWorkbench(serializeMbcWorkbench(snapshot('genomics-ngs', PLAIN.id)));
    expect(legacy.envelope.workspace.viewerTab, 'the codec keeps a legacy genomics-ngs').toBe('genomics-ngs');
    expect(resolveViewerTab(PLAIN, legacy.envelope.workspace.viewerTab), 'a plain protein on genomics-ngs opens the Protein studio').toBe('protein-3d');
    expect(resolveViewerTab(DNA, 'genomics-ngs'), 'a DNA record keeps genomics-ngs').toBe('genomics-ngs');
    expect(resolveViewerTab({ ...PLAIN, id: 'q164-empty', sequence: '' }, 'genomics-ngs'),
      'a protein record with no residues, which the Protein studio does not take, falls back to its preferred view').toBe('document-info');
  });

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

// ─── US-01M7QC8Q: History is provenance only; its other panels have their own hosts ───

const Q8Q_RNA: SequenceDocument = {
  ...BASE, id: 'q8q-rna', name: 'Q8Q_Hairpin_RNA', accession: 'Q8Q_R', moleculeType: 'RNA',
  sequence: 'GGGAAACCCAUAUGGGCGCAAGCCCAUAUGGGUUUCCC',
};
const Q8Q_SET: SequenceDocument = {
  ...BASE, id: 'q8q-set', name: 'Q8Q_Enzyme_Set', accession: 'Q8Q_SET', folder: 'Enzyme Sets',
  description: '2 enzymes', docMetadata: { 'Document Type': 'Enzyme Set', '# Enzymes': 2, 'Enzyme Names': 'EcoRI, BamHI' },
};
const Q8Q_TREE: SequenceDocument = {
  ...BASE, id: 'q8q-tree', name: 'Q8Q_Tree', accession: 'Q8Q_T', documentKind: 'tree', docMetadata: { Newick: '((A:1,B:1):1,C:2);' },
};
const Q8Q_LIBRARY = [DNA, Q8Q_RNA, CHAIN, Q8Q_SET, Q8Q_TREE];
const FOLD_HEADING = 'Nucleic-Acid Fold';
const ENZYMES_HEADING = 'Enzymes View — Restriction Sets & Overhang Cleavage Diagrams';
const RUNNER_HEADING = 'Workflow Automation & Bioinformatics Plugin Runner';
/** What History must never show again, each in the words its panel draws. */
const NOT_PROVENANCE = ['Protein Analysis', 'Molecular Weight', 'Secondary Structure', FOLD_HEADING, 'Enzymes View', 'Sequence Alerts',
  'Bacterial Transformation Strain', '[Reading Frame]', 'Document Info Panel', 'Created / Modified', 'Workflow', 'Genetic Code', 'protein-3d-viewer'];
const canvasText = (app: AppHarness) => text(app.canvas().innerHTML);
const enzymeTableNames = (app: AppHarness) => app.canvas().querySelectorAll('[aria-label="Restriction Enzymes Cleavage Sites Table"] tbody tr')
  .map((tr) => words(tr.querySelectorAll('td')[0]?.querySelectorAll('strong')[0]?.textContent));

describe('US-01M7QC8Q AC1: History shows only provenance', () => {
  it('US-01M7QC8Q AC1 History shows only provenance for every molecule type, with no sub-tab strip', async () => {
    // In the App (mounted first: React DOM loads after the live DOM), each kind opens History on its provenance alone.
    const app = await mountApp();
    try {
      for (const doc of Q8Q_LIBRARY) {
        if (doc === Q8Q_SET) {
          // A set restored on History reopens in Cloning & Gel (D0220, AC2); the user's click opens its History.
          await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: doc.id, viewerTab: 'cloning-gel' });
          await app.click(app.railTabs().filter((el) => el.getAttribute('data-studio') === 'history')[0]);
          await app.settle();
        } else {
          await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: doc.id, viewerTab: 'history-hybrid' });
        }
        expect(app.activeTab(), doc.name).toBe('history-hybrid');
        const shown = canvasText(app);
        expect(shown, doc.name).toContain('Construct History Tree & History Colors');
        for (const absent of NOT_PROVENANCE) expect(shown.includes(absent), `${doc.name} in the App: no "${absent}"`).toBe(false);
        expect(app.canvas().querySelectorAll('[role="tab"]'), `${doc.name}: no sub-tab in History`).toHaveLength(0);
      }
    } finally {
      app.unmount();
    }
    const { renderToStaticMarkup, HybridToolsAndHistoryStudio } = await load();
    const { hybridTabsForDocument, defaultHybridSubTab } = await import('../core/analysisContext');
    for (const doc of Q8Q_LIBRARY) {
      expect(hybridTabsForDocument(doc), doc.name).toEqual(['lineage']);
      expect(defaultHybridSubTab(doc), doc.name).toBe('lineage');
      const html = renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={doc} allDocuments={Q8Q_LIBRARY} />);
      const shown = text(html);
      expect(shown, `${doc.name}: the history tree`).toContain('Construct History Tree & History Colors');
      expect(html, `${doc.name}: the lineage graph`).toContain('aria-label="Construct history provenance graph"');
      for (const absent of NOT_PROVENANCE) expect(shown.includes(absent) || html.includes(absent), `${doc.name}: no "${absent}"`).toBe(false);
      expect(html, `${doc.name}: no sub-tab strip`).not.toContain('role="tablist"');
      expect(html, `${doc.name}: no sub-tab`).not.toContain('role="tab"');
    }
  }, 120_000);
});

describe('US-01M7QC8Q AC2: the Enzymes view opens in Sequence Map and Cloning & Gel', () => {
  it('US-01M7QC8Q AC2 Choose Enzymes and view:enzymes open the Enzymes view in Sequence Map or Cloning & Gel, and an Enzyme Set opens Cloning & Gel on it', async () => {
    const { preferredViewerTab, supportedViewerTabs } = await import('../core/documentViews');
    expect(preferredViewerTab(Q8Q_SET), 'D0220: an Enzyme Set prefers Cloning & Gel').toBe('cloning-gel');
    expect(supportedViewerTabs(Q8Q_SET)).toEqual(['cloning-gel', 'history-hybrid', 'document-info']);
    const app = await mountApp();
    try {
      const routes: [string, () => Promise<void>][] = [
        ['Cloning > Enzymes > Enzyme Views > Choose Enzymes', () => inWindowMenu(app, 'Cloning', ['Enzymes', 'Enzyme Views', 'Choose Enzymes'])],
        ['view:enzymes', () => app.menu('view:enzymes')],
      ];
      for (const [name, run] of routes) {
        for (const host of ['sequence-view', 'cloning-gel'] as const) {
          await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: DNA.id, viewerTab: host });
          expect(canvasText(app).includes(ENZYMES_HEADING), `${name} from ${host}: not shown before`).toBe(false);
          await run();
          await app.settle();
          expect(app.activeTab(), `${name} from ${host}: the view opens in its host, never History`).toBe(host);
          expect(canvasText(app), `${name} from ${host}`).toContain(ENZYMES_HEADING);
          expect(app.canvas().querySelectorAll('section[aria-label="Enzymes view"]'), `${name} from ${host}: one hosted view`).toHaveLength(1);
        }
      }
      // The Enzyme Set opens Cloning & Gel, from its own preferred tab, on the view, with its enzymes listed.
      await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: Q8Q_SET.id, viewerTab: preferredViewerTab(Q8Q_SET) });
      expect(app.activeTab()).toBe('cloning-gel');
      expect(canvasText(app)).toContain(ENZYMES_HEADING);
      expect(enzymeTableNames(app).sort(), 'the set\'s enzymes').toEqual(['BamHI', 'EcoRI']);
      await app.menu('view:enzymes');
      expect(app.activeTab(), 'view:enzymes on an Enzyme Set').toBe('cloning-gel');
    } finally {
      app.unmount();
    }
  }, 120_000);

  it('US-01M7QC8Q AC2 an older session saved with an Enzyme Set on History reopens in Cloning & Gel on its Enzymes view, and History stays one click away', async () => {
    // Before US-01M7QC8Q an Enzyme Set's preferred tab was history-hybrid, so every older session with a
    // set active was saved there; History now draws only the lineage (D0220, round-1 LC-002 finding).
    const app = await mountApp();
    try {
      // The harness restores the session, then refuses any tab other than the one saved: here, by design.
      await expect(app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: Q8Q_SET.id, viewerTab: 'history-hybrid' }),
        'the App restores the older set session on cloning-gel').rejects.toThrow('the App restored the session on the cloning-gel tab, not history-hybrid');
      await app.settle();
      expect(app.activeTab(), 'an Enzyme Set saved on History reopens in Cloning & Gel').toBe('cloning-gel');
      expect(canvasText(app), 'its Enzymes view').toContain(ENZYMES_HEADING);
      expect(enzymeTableNames(app).sort(), 'the set\'s enzymes').toEqual(['BamHI', 'EcoRI']);
      // History stays supported for the set: the user's own click opens its lineage.
      const history = app.railTabs().filter((el) => el.getAttribute('data-studio') === 'history');
      expect(history, 'the rail lists History once').toHaveLength(1);
      await app.click(history[0]);
      await app.settle();
      expect(app.activeTab(), 'History on the set, by the user').toBe('history-hybrid');
      expect(canvasText(app), 'the set\'s lineage').toContain('Construct History Tree & History Colors');
      // A DNA record restored on History stays there.
      await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: DNA.id, viewerTab: 'history-hybrid' });
      expect(app.activeTab(), 'a DNA record restored on History stays there').toBe('history-hybrid');
    } finally {
      app.unmount();
    }
  }, 120_000);
});

describe('US-01M7QC8Q AC3: folding opens in Sequence Map for RNA and Primers & CRISPR for DNA', () => {
  it('US-01M7QC8Q AC3 Secondary Structure and view:secondary-structure fold an RNA in Sequence Map and a DNA in Primers & CRISPR, only once shown', async () => {
    const app = await mountApp();
    try {
      const routes: [string, () => Promise<void>][] = [
        ['View > Studio Views > Secondary Structure', () => inWindowMenu(app, 'View', ['Studio Views', 'Secondary Structure'])],
        ['view:secondary-structure', () => app.menu('view:secondary-structure')],
      ];
      for (const [name, run] of routes) {
        for (const [doc, host] of [[Q8Q_RNA, 'sequence-view'], [DNA, 'primers-pcr']] as const) {
          await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: doc.id, viewerTab: 'sequence-view' });
          // Not computed until shown: no fold or ΔG anywhere in the page.
          expect(text(app.doc.body.innerHTML).includes('MFE ΔG'), `${name} on ${doc.name}: no fold before`).toBe(false);
          await run();
          await app.settle();
          expect(app.activeTab(), `${name} on ${doc.name}`).toBe(host);
          const shown = canvasText(app);
          expect(shown, `${name} on ${doc.name}: the fold`).toContain(`${FOLD_HEADING} — ${doc.name}`);
          expect(shown, `${name} on ${doc.name}: its ΔG`).toMatch(/MFE ΔG = -?\d+(\.\d+)? kcal\/mol/);
        }
      }
    } finally {
      app.unmount();
    }
  }, 120_000);

  it('US-01M7QC8Q AC3 a guided-pipeline folding step aimed at Primers & CRISPR opens it on the folding panel, and a primer step opens it without', async () => {
    // US-01M6Q164 aimed the folding step at primers-pcr: following it must land on the fold, not on primer design.
    const { BIO_PIPELINE_CATALOG, executeBioPipelineAsync } = await load();
    const cases: { def: (typeof BIO_PIPELINE_CATALOG)[number]; idx: number; label: string; folds: boolean }[] = [];
    for (const def of BIO_PIPELINE_CATALOG) {
      const report = await executeBioPipelineAsync(DNA, def.id);
      report.steps.forEach((s, idx) => {
        if (s.targetStudio !== 'primers-pcr') return;
        const folds = FOLD_LABEL.test(s.targetStudioLabel);
        if (!cases.some((c) => c.folds === folds)) cases.push({ def, idx, label: s.targetStudioLabel, folds });
      });
    }
    expect(cases.map((c) => c.folds).sort(), 'a folding step and a primer step, both aimed at Primers & CRISPR').toEqual([false, true]);
    const app = await mountApp();
    try {
      for (const c of cases) {
        const where = `${c.def.id} step ${c.idx + 1} (${c.label})`;
        await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: DNA.id, viewerTab: 'sequence-view' });
        await app.clickStudio('pipelines-ngs');
        expect(app.activeTab()).toBe('guided-pipelines');
        const picks = app.canvas().querySelectorAll('button.mbc-pipeline-card, button.method-tab-btn')
          .filter((b) => b.getAttribute('title') === c.def.title || words(b.querySelectorAll('.mbc-pipeline-card-name')[0]?.textContent) === c.def.title);
        expect(picks, `${where}: one pick for the pipeline`).toHaveLength(1);
        await app.click(picks[0]);
        const steps = () => app.canvas().querySelectorAll('[aria-label="Pipeline Steps"] button[role="tab"], [role="tablist"][aria-label="Pipeline Steps"] button[role="tab"]');
        for (let i = 0; i < 40 && steps().length <= c.idx; i++) await app.settle();
        expect(steps().length, `${where}: the report's steps`).toBeGreaterThan(c.idx);
        await app.click(steps()[c.idx]);
        const cta = app.canvas().querySelectorAll('button.mbc-pipe-btn.primary').filter((b) => words(b.textContent) === c.label);
        expect(cta, `${where}: the step's button`).toHaveLength(1);
        expect(text(app.doc.body.innerHTML).includes(`${FOLD_HEADING} — ${DNA.name}`), `${where}: no fold before`).toBe(false);
        await app.click(cta[0]);
        await app.settle();
        expect(app.activeTab(), where).toBe('primers-pcr');
        const fold = app.canvas().querySelectorAll('section[aria-label="Folding"]');
        if (c.folds) {
          expect(fold, `${where}: the folding panel`).toHaveLength(1);
          expect(canvasText(app), `${where}: the fold`).toContain(`${FOLD_HEADING} — ${DNA.name}`);
          expect(canvasText(app), `${where}: its ΔG`).toMatch(/MFE ΔG = -?\d+(\.\d+)? kcal\/mol/);
        } else {
          expect(fold, `${where}: primer design, not the fold`).toHaveLength(0);
          expect(canvasText(app).includes(FOLD_HEADING), `${where}: no fold`).toBe(false);
        }
      }
    } finally {
      app.unmount();
    }
  }, 120_000);
});

describe('US-01M7QC8Q AC4: sequence alerts and the host strain show in Info, for DNA only', () => {
  it('US-01M7QC8Q AC4 a plasmid with Dam sites shows the strain picker and alerts that change with the strain; a protein shows neither', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: DNA.id, viewerTab: 'document-info' });
      const info = () => app.one('section[aria-label="Document information"]', 'the Info panel');
      const strain = () => info().querySelectorAll('select').filter((s) => s.querySelectorAll('option').some((o) => o.getAttribute('value') === 'DH5α (dam+ dcm+)'));
      const alerts = () => info().querySelectorAll('.info-callout strong').map((s) => words(s.textContent));
      expect(strain(), 'one strain picker in Info').toHaveLength(1);
      expect(strain()[0].value, 'the default strain').toBe('DH5α (dam+ dcm+)');
      const dh5a = alerts();
      expect(dh5a.length, 'alerts for the plasmid').toBeGreaterThan(0);
      await app.change(strain()[0], 'JM110 / SCS110 (dam- dcm-)');
      const jm110 = alerts();
      expect(jm110, 'the alerts change with the strain').not.toEqual(dh5a);
      await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: CHAIN.id, viewerTab: 'document-info' });
      expect(strain(), 'no strain picker for a protein').toHaveLength(0);
      expect(text(info().innerHTML)).not.toContain('Sequence Alerts');
      expect(info().querySelectorAll('.info-callout'), 'no alerts for a protein').toHaveLength(0);
    } finally {
      app.unmount();
    }
    const { renderToStaticMarkup, DocumentInfoPanel } = await load();
    const html = renderToStaticMarkup(<DocumentInfoPanel doc={CHAIN} onUpdateDocument={() => {}} alerts={<p>ALERTS SLOT</p>} />);
    expect(html, 'Info draws the alerts for DNA only').not.toContain('ALERTS SLOT');
  }, 120_000);
});

describe('US-01M7QC8Q AC5: workflows in Pipelines & NGS, genetic-code tables in the Sequence Map inspector', () => {
  it('US-01M7QC8Q AC5 the plugin runner runs on the active document in Pipelines & NGS and the genetic-code tables sit beside translation', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: Q8Q_LIBRARY, activeDocId: DNA.id, viewerTab: 'sequence-view' });
      await app.clickStudio('pipelines-ngs');
      expect(app.activeTab()).toBe('guided-pipelines');
      const tab = app.canvas().querySelectorAll('button[role="tab"]').filter((b) => words(b.textContent) === 'Workflow Plugins');
      expect(tab, 'the Workflow Plugins view').toHaveLength(1);
      await app.click(tab[0]);
      const shown = canvasText(app);
      expect(shown).toContain(RUNNER_HEADING);
      expect(shown, 'the built-in plugin ran').toContain('Status: SUCCESS');
      expect(shown, 'on the active document').toContain(`Run Tool on ${DNA.name}`);

      await app.clickTab('sequence-view');
      const aside = app.inspectorAside();
      expect(aside, 'the Sequence Map inspector').not.toBeNull();
      const header = aside!.querySelectorAll('button.mbc-accordion-header').find((b) => words(b.textContent) === 'Display & Color Scheme')!;
      if (header.getAttribute('aria-expanded') !== 'true') await app.click(header);
      const tables = app.inspectorAside()!.querySelectorAll('[aria-label="Genetic code tables"]');
      expect(tables, 'the genetic-code tables in the inspector').toHaveLength(1);
      expect(tables[0].querySelectorAll('li').map((li) => words(li.textContent))).toContain('Standard (1)');
      const body = tables[0].closest('.mbc-accordion-body')!;
      expect(words(body.textContent), 'beside translation').toContain('Show 3-Frame Translation');

      await app.menu('tools:workflows');
      expect(app.activeTab(), 'Tools > Pipelines > Workflows & Lineage opens History').toBe('history-hybrid');
      const history = canvasText(app);
      expect(history).toContain('Construct History Tree & History Colors');
      expect(history.includes(RUNNER_HEADING) || history.includes('Genetic Code'), 'History shows neither').toBe(false);
    } finally {
      app.unmount();
    }
  }, 120_000);
});

// ─── BG-01M6VZRS ───

/** Deterministic letters (LCG), so the fixture reads the same every run. */
function seeded(seed: number, n: number, alphabet: string): string {
  let st = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    out += alphabet[Math.floor((st / 2 ** 32) * alphabet.length)];
  }
  return out;
}
/**
 * ATG, `codons` codons drawn from `sense`, TAA: one ORF of `codons + 1` aa. The G/P/S/T codons hold
 * no ATG in any frame on either strand, and give a protein with no coiled coil (the empty state).
 */
const senseGene = (codons: number, seed: number, sense = ['GCT', 'GAA', 'CTG', 'AAA', 'GTT', 'TCC', 'CGT', 'GGC']) =>
  `ATG${[...seeded(seed, codons, '01234567'.slice(0, sense.length))].map((k) => sense[Number(k)]).join('')}TAA`;
const revComp = (s: string) => [...s].reverse().map((b) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[b]).join('');
/** No CDS: 30 bases with no ATG on either strand, a 20-aa ORF (frame 1), 31 such bases, a 286-aa ORF (frame 2), 30 more. */
const SHORT_ORF = senseGene(19, 0x2b1);
const LONG_ORF = senseGene(285, 0x2b2, ['GGC', 'CCT', 'TCC', 'ACC']);
const LONG_AT = 31 + SHORT_ORF.length + 31;
const ORFS_ONLY = `${seeded(0x2b3, 30, 'CGT')}${SHORT_ORF}${seeded(0x2b4, 31, 'CGT')}${LONG_ORF}${seeded(0x2b5, 30, 'CGT')}`;
const NO_CDS: SequenceDocument = { ...BASE, id: 'vzrs-orfs', name: 'Two_ORFs', sequence: ORFS_ONLY };

describe('BG-01M6VZRS the Coiled-Coils card names the protein it analysed', () => {
  it('BG-01M6VZRS AC3 the Coiled-Coils card names the protein it analysed: the annotated CDS or the longest ORF with its frame and bases', async () => {
    const { genomics, translateSequence } = { ...(await load()), translateSequence: (await import('../core/bioEngine')).translateSequence };
    const longProtein = translateSequence(LONG_ORF, 0).replace(/\*$/, '');
    expect(longProtein).toHaveLength(286);
    const minusEnd = ORFS_ONLY.length - LONG_AT + 1;
    const minusFrame = (await import('../core/bioEngine')).findORFs(revComp(ORFS_ONLY), 15, false)[0];
    expect([minusFrame.start, minusFrame.end, minusFrame.strand]).toEqual([minusEnd - LONG_ORF.length + 1, minusEnd, -1]);
    // [what, record, the source named, the protein analysed, whether it has no coiled coil (the empty state)]
    const cases: [string, SequenceDocument, string, string, boolean][] = [
      ['an annotated CDS', DNA, 'annotated CDS GFP', translateSequence(CDS_DNA, 0).replace(/\*$/, ''), false],
      ['the longest ORF', NO_CDS, `longest ORF, frame +2, bases ${LONG_AT}-${LONG_AT + LONG_ORF.length - 1}`, longProtein, true],
      ['a minus-strand ORF', { ...NO_CDS, sequence: revComp(ORFS_ONLY) },
        `longest ORF, frame ${minusFrame.frame}, bases ${minusEnd - LONG_ORF.length + 1}-${minusEnd}`, longProtein, true],
      ['a protein record', PLAIN, "the record's own residues", PLAIN.sequence, false],
    ];
    expect(minusFrame.frame).toBeLessThan(0);
    for (const [what, doc, source, analysed, empty] of cases) {
      const topology = vi.spyOn(genomics, 'predictCoiledCoilsAndTransmembrane');
      const html = await protein(doc);
      expect(topology, `${what}: the card analyses that protein`).toHaveBeenCalledWith(analysed);
      const report = topology.mock.results[0].value as { lengthAa: number; coiledCoils: unknown[] };
      topology.mockRestore();
      const header = /<h3>Coiled-Coils \(Lupas\)[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
      // beside its aa count, which protein that was and why
      expect(text(header), what).toContain(`${report.lengthAa} aa Analyzed from ${source}`);
      expect(report.lengthAa).toBe(analysed.length);
      // and its empty state names the same protein, not a 'primary ORF'
      expect(report.coiledCoils.length === 0, `${what}: whether the protein has no coiled coil`).toBe(empty);
      const emptyLine = `No extended heptad coiled-coil domains (P ≥ 0.64) detected in ${source}.`;
      if (empty) expect(text(html), what).toContain(emptyLine);
      else expect(text(html), what).not.toContain('No extended heptad coiled-coil domains');
      expect(text(html), what).not.toContain('primary ORF');
    }
  }, 60_000);
});
