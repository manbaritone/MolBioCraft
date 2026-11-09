// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6PXRX: the approved structure tools are reached from the studio and from both menus.
 *
 * Every check renders the real component, or drives the real App command dispatcher and web menu
 * table, and reads the markup that results; none reads source text. The App is rendered on the
 * server, where a state update made while the App itself is rendering re-renders it with that
 * update: the probes below act from inside the App's render (the dispatcher it has just assigned,
 * the web menu tables it hands the shortcut collector), so choosing a menu item there is followed
 * by the render that shows what the choice opened.
 *
 * The structures are synthetic mmCIF text built here (an ideal backbone placed residue by residue),
 * so these tests need no reference data.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuNode } from '../components/CascadingMenu';

// ─── App probes (installed before the App module is loaded) ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
const probe = vi.hoisted(() => ({
  /** The App's native-menu dispatcher ref, as its render last assigned it. */
  dispatcher: null as null | { current: AppDispatcher },
  /** Called from inside each App render with the web menu tables it builds. */
  onMenus: null as null | ((menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useRef = ((initial: unknown) => {
    const ref = actual.useRef(initial);
    if (initial && typeof initial === 'object' && 'onMenuAction' in initial && 'onNativeFileOpen' in initial) {
      probe.dispatcher = ref as unknown as { current: AppDispatcher };
    }
    return ref;
  }) as typeof actual.useRef;
  return { ...actual, default: { ...actual, useRef }, useRef };
});

vi.mock('../core/menuShortcuts', async () => {
  const actual = await vi.importActual<typeof import('../core/menuShortcuts')>('../core/menuShortcuts');
  return {
    ...actual,
    collectMenuShortcutBindings: (trees: Parameters<typeof actual.collectMenuShortcutBindings>[0]) => {
      probe.onMenus?.(trees, (id) => {
        if (!probe.dispatcher) throw new Error('the App rendered no native-menu dispatcher');
        probe.dispatcher.current.onMenuAction(id);
      });
      return actual.collectMenuShortcutBindings(trees);
    },
  };
});

const { App } = await import('../App');
const { GenomicsNgsAndPredictionStudio } = await import('../components/GenomicsNgsAndPredictionStudio');
const structureView = await import('../core/structureView');
const { alignPdbStructuresKabsch, parsePdbCaCoordinates } = await import('../core/genomicsAndStructureSuite');
const { caAtomsToPdb, structureAtomsOf } = await import('../core/structureModels');
const {
  buildCommandDocumentContext, buildNativeMenuState, commandAvailability, NATIVE_MENU_COMMAND_RULES, resolveNativeMenuItemEnabled,
} = await import('../core/commandAvailability');
const { saveWorkbenchToLocalAutosave } = await import('../core/mbcSessionFormat');
const { resolveMenuNodeFunctionDescription } = await import('../data/menuFunctionDescriptions');
type SequenceDocument = import('../types/bio').SequenceDocument;

afterEach(() => {
  probe.onMenus = null;
  vi.restoreAllMocks();
});

// ─── Synthetic structures ───

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => scale(a, 1 / Math.hypot(...a));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Atom D placed from A, B, C by bond C-D, angle B-C-D and torsion A-B-C-D (NeRF). */
function place(a: V, b: V, c: V, bond: number, angle: number, torsion: number): V {
  const bc = unit(sub(c, b));
  const n = unit(cross(sub(b, a), bc));
  const m = cross(n, bc);
  const d: V = [-bond * Math.cos(rad(angle)), bond * Math.sin(rad(angle)) * Math.cos(rad(torsion)), bond * Math.sin(rad(angle)) * Math.sin(rad(torsion))];
  return add(c, add(scale(bc, d[0]), add(scale(m, d[1]), scale(n, d[2]))));
}

/** N, CA, C of `n` residues of an ideal right-handed helix (phi -57, psi -47), starting at `origin`. */
function helixBackbone(n: number, origin: V): { N: V; CA: V; C: V }[] {
  const out: { N: V; CA: V; C: V }[] = [];
  let N: V = origin;
  let CA: V = add(origin, [1.458, 0, 0]);
  let C: V = add(CA, [1.525 * Math.cos(rad(180 - 111.2)), 1.525 * Math.sin(rad(180 - 111.2)), 0]);
  out.push({ N, CA, C });
  for (let i = 1; i < n; i++) {
    const nextN = place(N, CA, C, 1.329, 116.2, -47);
    const nextCA = place(CA, C, nextN, 1.458, 121.7, 180);
    const nextC = place(C, nextN, nextCA, 1.525, 111.2, -57);
    [N, CA, C] = [nextN, nextCA, nextC];
    out.push({ N, CA, C });
  }
  return out;
}

const THREE: Record<string, string> = {
  A: 'ALA', I: 'ILE', K: 'LYS', L: 'LEU', M: 'MET', Q: 'GLN', R: 'ARG', T: 'THR', Y: 'TYR',
};

interface ChainSpec { label: string; auth: string; firstAuth: number; seq: string; origin: V }
/**
 * Label chain A is author chain B; label chain B is author chain H. So the author id of one chain
 * is the label id of the other: a chain named by its label id but looked up by author id is the
 * wrong chain.
 */
const CHAIN_A: ChainSpec = { label: 'A', auth: 'B', firstAuth: 1, seq: 'AYIAKQRQ', origin: [0, 0, 0] };
const CHAIN_B: ChainSpec = { label: 'B', auth: 'H', firstAuth: 101, seq: 'MKTAYIAKQRQL', origin: [18, 4, -3] };

/** An mmCIF entry of chains A and B, a heme bound to author chain H, a sulfate on author chain B, a water, and a helix on chain B. */
function entryCif(models: number, chains: readonly ChainSpec[] = [CHAIN_A, CHAIN_B]): string {
  const rows: string[] = [];
  let id = 0;
  const f = (v: number) => v.toFixed(3);
  for (let model = 1; model <= models; model++) {
    const shift = (model - 1) * 0.4;
    for (const chain of chains) {
      helixBackbone(chain.seq.length, chain.origin).forEach((r, i) => {
        for (const [name, at] of [['N', r.N], ['CA', r.CA], ['C', r.C]] as const) {
          rows.push(`ATOM ${++id} ${name[0]} ${name} . ${THREE[chain.seq[i]]} ${chain.label} ${i + 1} ? ${f(at[0] + shift)} ${f(at[1])} ${f(at[2])} 1.00 20.00 ${chain.firstAuth + i} ${chain.auth} ${model}`);
        }
      });
    }
    rows.push(`HETATM ${++id} FE FE . HEM C . ? ${f(24 + shift)} 9.000 1.000 1.00 30.00 201 H ${model}`);
    rows.push(`HETATM ${++id} N NA . HEM C . ? ${f(25 + shift)} 9.500 1.500 1.00 30.00 201 H ${model}`);
    rows.push(`HETATM ${++id} S S . SO4 D . ? ${f(2 + shift)} -6.000 2.000 1.00 30.00 301 B ${model}`);
    rows.push(`HETATM ${++id} O O . HOH E . ? ${f(30 + shift)} 1.000 1.000 1.00 30.00 401 H ${model}`);
  }
  return [
    'data_9XYZ',
    'loop_',
    '_struct_conf.conf_type_id',
    '_struct_conf.id',
    '_struct_conf.beg_label_comp_id',
    '_struct_conf.beg_label_asym_id',
    '_struct_conf.beg_label_seq_id',
    '_struct_conf.end_label_comp_id',
    '_struct_conf.end_label_asym_id',
    '_struct_conf.end_label_seq_id',
    'HELX_P HELX_P1 THR B 3 ARG B 10',
    'loop_',
    ...['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_seq_id',
      'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'auth_seq_id', 'auth_asym_id',
      'pdbx_PDB_model_num'].map((c) => `_atom_site.${c}`),
    ...rows,
    '#',
    '',
  ].join('\n');
}

/** A structure document as File › Import builds one per chain: the file in PDBText, the chain's label id in Chain. */
function chainDoc(text: string, chain: ChainSpec, format: 'mmCIF' | 'PDB', name = `9XYZ chain ${chain.label}`): SequenceDocument {
  return {
    id: `doc-${format}-${chain.label}-${name}`, name, accession: '', description: '', moleculeType: 'Protein', topology: 'linear',
    sequence: chain.seq, features: [], primers: [], history: [], createdAt: '', updatedAt: '', folder: 'Protein Documents',
    docMetadata: { 'Source Format': format, PDBText: text, Chain: chain.label },
  };
}

const studio = (props: Partial<React.ComponentProps<typeof GenomicsNgsAndPredictionStudio>> & { activeDoc: SequenceDocument }) =>
  renderToStaticMarkup(
    <GenomicsNgsAndPredictionStudio
      documents={[]} initialSubTab="protein-3d"
      onCreateDocument={() => {}} onUpdateActiveSequence={() => {}} onAppendFeatures={() => {}}
      {...props}
    />,
  );

/** The words a stretch of markup shows: tags dropped, the entities React writes decoded. */
const wordsOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const decode = (s: string) => wordsOf(s);

/** The 3D viewer's header badges: their words and titles. */
function viewerBadges(html: string): { words: string; title: string }[] {
  const at = html.indexOf('protein-3d-viewer-stage');
  expect(at, 'the 3D viewer is drawn').toBeGreaterThan(-1);
  const stage = html.slice(at, html.indexOf('<select', at));
  return Array.from(stage.matchAll(/<span class="badge-accent"([^>]*)>([\s\S]*?)<\/span>/g)).map((m) => ({
    words: wordsOf(m[2]),
    title: decode(/title="([^"]*)"/.exec(m[1])?.[1] ?? ''),
  }));
}

/** The KPI boxes of the 3D card, label to value. */
function kpis(html: string): Map<string, string> {
  return new Map(Array.from(html.matchAll(/<span class="kpi-label">([\s\S]*?)<\/span><strong class="kpi-val">([\s\S]*?)<\/strong>/g))
    .map((m) => [wordsOf(m[1]), wordsOf(m[2])]));
}

/** The Ramachandran figure of a render, or null. */
function ramachandranFigure(html: string): { label: string; residues: string[]; words: string } | null {
  const m = /<figure\b[^>]*aria-label="(Ramachandran plot of [^"]*)"[^>]*>([\s\S]*?)<\/figure>/.exec(html);
  if (!m) return null;
  return {
    label: decode(m[1]),
    residues: Array.from(m[2].matchAll(/data-residue="([^"]*)"/g), (r) => decode(r[1])),
    words: wordsOf(m[2]),
  };
}

// ─── AC1 ───

describe('the structure studio (GenomicsNgsAndPredictionStudio, 3D tab)', () => {
  const cif = entryCif(1);
  const docB = chainDoc(cif, CHAIN_B, 'mmCIF');
  const docA = chainDoc(cif, CHAIN_A, 'mmCIF');

  it('renders the superposition KPIs as sequence-alignment pairing', () => {
    // Model A is chain B (the open document), model B the other structure ticked beside it.
    const html = studio({ activeDoc: docB, proteinDocuments: [docA, docB], selectedDocuments: [docB, docA] });
    const engine = alignPdbStructuresKabsch(caAtomsToPdb(structureAtomsOf(docB)), caAtomsToPdb(structureAtomsOf(docA)));
    expect([engine.chainA, engine.chainB, engine.alignedResiduePairs]).toEqual(['B', 'A', 8]);
    expect(engine.pairingMethod).toMatch(/global sequence alignment/);

    const k = kpis(html);
    expect(k.get('Cα pairs (sequence alignment)')).toBe(String(engine.alignedResiduePairs));
    // The engine names the chains by label id (B and A); the tab names a chain by its author id, as
    // the Ramachandran figure beside it does (label chain B is author chain H), with the label id
    // beside it where the two differ.
    expect(k.get('Chain pair (A / B)')).toBe('H (label B) / B (label A)');
    expect(ramachandranFigure(html)!.label).toBe(`Ramachandran plot of ${docB.name}, chain H`);
    expect(k.get('TM≈ (approximate TM-score)')).toBe(String(engine.tmScore));
    expect(k.get('Sequence identity')).toBe(`${(engine.sequenceIdentity * 100).toFixed(1)}%`);
    expect(k.get('Cα RMSD')).toBe(`${engine.rmsdAngstrom} Å`);
    expect([...k.keys()].some((label) => /TM-Score$/.test(label)), 'no unqualified TM-Score label').toBe(false);

    const words = wordsOf(html);
    expect(words).not.toMatch(/by position/i);
    const verdict = /Verdict: [^]*?Align Structures…[^.]*\./.exec(words)?.[0] ?? '';
    expect(verdict, 'the verdict callout').not.toBe('');
    expect(verdict).toContain(`Chain H (label B) of ${docB.name} is paired with chain B (label A) of ${docA.name}`);
    expect(verdict).toContain(`by sequence alignment: ${engine.pairingMethod}`);
    // Counted over the two chains the engine paired (12 and 8 residues), not over every Cα drawn.
    expect(verdict).toContain(`${engine.alignedResiduePairs} of their 12 vs 8 residues are paired`);
    expect(verdict).toMatch(/TM≈ is approximate/);

    // The viewer's own pair badge names the method too.
    const badges = viewerBadges(html);
    expect(badges).toContainEqual({ words: `${engine.alignedResiduePairs} Cα pairs`, title: engine.pairingMethod });
    expect(badges.map((b) => b.words)).toContain(`TM≈ ${engine.tmScore}`);

    // A document of the whole entry (no chain of its own) draws every chain, and the engine
    // superposes its first protein chain: the chain pair named is the one the engine paired.
    const entry: SequenceDocument = { ...docA, id: 'doc-entry', name: '9XYZ', docMetadata: { 'Source Format': 'mmCIF', PDBText: cif } };
    const whole = studio({ activeDoc: entry, proteinDocuments: [entry, docB], selectedDocuments: [entry, docB] });
    const wholeEngine = alignPdbStructuresKabsch(caAtomsToPdb(structureAtomsOf(entry)), caAtomsToPdb(structureAtomsOf(docB)));
    expect([wholeEngine.chainA, wholeEngine.chainB]).toEqual(['A', 'B']);
    expect(kpis(whole).get('Chain pair (A / B)')).toBe('B (label A) / H (label B)');
    expect(wordsOf(whole)).toContain(`Chain B (label A) of 9XYZ is paired with chain H (label B) of ${docB.name} by sequence alignment: ${wholeEngine.pairingMethod}`);
    // 20 Cα are drawn for model A, but the pairs are counted over its chain A (8 residues).
    expect(wordsOf(whole)).toContain(`${wholeEngine.alignedResiduePairs} of their 8 vs 12 residues are paired`);

    // Where a chain's author and label ids agree, it is named once.
    const sameIds = entryCif(1, [{ ...CHAIN_A, auth: 'A' }, { ...CHAIN_B, auth: 'B' }]);
    const sameB = chainDoc(sameIds, CHAIN_B, 'mmCIF', '9XYS chain B');
    const sameA = chainDoc(sameIds, CHAIN_A, 'mmCIF', '9XYS chain A');
    const same = studio({ activeDoc: sameB, proteinDocuments: [sameA, sameB], selectedDocuments: [sameB, sameA] });
    expect(kpis(same).get('Chain pair (A / B)')).toBe('B / A');
    expect(wordsOf(same)).toContain(`Chain B of ${sameB.name} is paired with chain A of ${sameA.name} by sequence alignment`);
    // Each chain is named from its own entry: label chain A is author B in 9XYZ but author A in 9XYS.
    const cross = studio({ activeDoc: docB, proteinDocuments: [sameA, docB], selectedDocuments: [docB, sameA] });
    expect(kpis(cross).get('Chain pair (A / B)')).toBe('H (label B) / A');
    // The engine keeps one letter of a chain id; a two-letter label id is still named in full.
    const twoLetter: ChainSpec = { ...CHAIN_A, label: 'AA' };
    const docAA = chainDoc(entryCif(1, [twoLetter, CHAIN_B]), twoLetter, 'mmCIF', '9XYW chain AA');
    const long = studio({ activeDoc: docB, proteinDocuments: [docAA, docB], selectedDocuments: [docB, docAA] });
    expect(alignPdbStructuresKabsch(caAtomsToPdb(structureAtomsOf(docB)), caAtomsToPdb(structureAtomsOf(docAA))).chainB).toBe('A');
    expect(kpis(long).get('Chain pair (A / B)')).toBe('H (label B) / B (label AA)');
    // Legacy PDB text has one chain id, the one its records carry.
    const pdbOf = (chain: ChainSpec) => chainDoc(caAtomsToPdb(parsePdbCaCoordinates(cif).filter((a) => a.chainId === chain.label)), chain, 'PDB');
    const legacy = studio({ activeDoc: pdbOf(CHAIN_B), proteinDocuments: [pdbOf(CHAIN_A), pdbOf(CHAIN_B)], selectedDocuments: [pdbOf(CHAIN_B), pdbOf(CHAIN_A)] });
    expect(kpis(legacy).get('Chain pair (A / B)')).toBe('B / A');
  });

  it('shows no superposition KPIs for one structure on its own', () => {
    const html = studio({ activeDoc: docB, proteinDocuments: [docA, docB], selectedDocuments: [docB] });
    expect(kpis(html).has('Cα pairs (sequence alignment)')).toBe(false);
    expect(wordsOf(html)).not.toMatch(/Verdict:/);
  });

  // ─── AC3 ───

  it('the studio hands the viewer the parsed structure and the selected feature', () => {
    const html = studio({ activeDoc: docB, selectedRange: { start: 2, end: 5, label: 'Loop' } });
    const badges = viewerBadges(html).map((b) => b.words);
    // The file's own helix (_struct_conf), not the Cα-geometry guess.
    expect(badges).toContain('SS from file');
    // The heme bound to this chain (author chain H), not the sulfate on the other chain.
    const ligand = viewerBadges(html).find((b) => /ligand/.test(b.words));
    expect(ligand).toEqual({ words: '1 ligand', title: 'HEM H201' });
    // The selection on the sequence (residues 2-5 of chain B), placed on the chain's author numbers.
    expect(badges).toContain('Loop: 4 residues (H 102–105)');
  });

  it('places the selection on the open chain, not on the first chain of the file', () => {
    const html = studio({ activeDoc: docA, selectedRange: { start: 1, end: 3, label: 'Start' } });
    const badges = viewerBadges(html).map((b) => b.words);
    expect(badges).toContain('Start: 3 residues (B 1–3)');
    expect(viewerBadges(html).find((b) => /ligand/.test(b.words))).toEqual({ words: '1 ligand', title: 'SO4 B301' });
  });

  it('says why legacy PDB text shows no ligands, file secondary structure or feature, and still draws it', () => {
    const pdb = caAtomsToPdb(parsePdbCaCoordinates(cif).filter((a) => a.chainId === 'B'));
    const html = studio({ activeDoc: chainDoc(pdb, CHAIN_B, 'PDB'), selectedRange: { start: 2, end: 5, label: 'Loop' } });
    const words = viewerBadges(html).map((b) => b.words);
    expect(words).toContain('12 Cα');
    expect(words.some((w) => /ligand|SS from file|SS inferred/.test(w))).toBe(false);
    expect(words).toContain('Feature not placed: No full-atom model is loaded, so the feature cannot be placed.');
    expect(wordsOf(html)).toContain('legacy PDB text');
  });

  it('does not hand the viewer a model whose label ids are author ids', () => {
    const real = structureView.parseStructure(cif);
    vi.spyOn(structureView, 'parseStructure').mockReturnValue({ ...real, labelIdsFromAuthor: true } as typeof real);
    const html = studio({ activeDoc: docB, selectedRange: { start: 2, end: 5, label: 'Loop' } });
    const words = viewerBadges(html).map((b) => b.words);
    expect(words.some((w) => /ligand|SS from file/.test(w))).toBe(false);
    expect(wordsOf(html)).toMatch(/label ids are the author ids/);
  });

  // ─── AC4 ───

  it('the studio shows the Ramachandran figure for the open chain, naming the plotted model of a multi-model entry', () => {
    const nmr = chainDoc(entryCif(2), CHAIN_B, 'mmCIF', '9XYZ NMR chain B');
    const fig = ramachandranFigure(studio({ activeDoc: nmr }));
    expect(fig, 'a Ramachandran figure').not.toBeNull();
    // Chain B is author chain H, numbered from 101; its first and last residues have no phi or psi.
    expect(fig!.label).toBe('Ramachandran plot of 9XYZ NMR chain B, chain H, model 1 of 2');
    expect(fig!.residues).toHaveLength(10);
    expect(fig!.residues.every((r) => /^H 1(0[2-9]|1[01]) [A-Z]{3}$/.test(r))).toBe(true);
    expect(fig!.words).toContain('10 of 12 residues plotted');

    const xray = ramachandranFigure(studio({ activeDoc: docB }));
    expect(xray!.label).toBe('Ramachandran plot of 9XYZ chain B, chain H');

    const other = ramachandranFigure(studio({ activeDoc: docA }));
    expect(other!.label).toBe('Ramachandran plot of 9XYZ chain A, chain B');
    expect(other!.words).toContain('6 of 8 residues plotted');
  });

  it('shows no Ramachandran figure for legacy PDB text, and says why', () => {
    const pdb = caAtomsToPdb(parsePdbCaCoordinates(cif).filter((a) => a.chainId === 'B'));
    const html = studio({ activeDoc: chainDoc(pdb, CHAIN_B, 'PDB') });
    expect(ramachandranFigure(html)).toBeNull();
    expect(wordsOf(html)).toMatch(/Ramachandran plot/);
  });
});

// ─── AC2 ───

/** The command of a web menu table labelled `label`, with the labels of the submenus it is in. */
function findCommand(menus: readonly (readonly unknown[])[], label: string): { node: MenuNode & { kind: 'command' }; path: string[] } | null {
  const walk = (nodes: readonly MenuNode[], path: string[]): { node: MenuNode & { kind: 'command' }; path: string[] } | null => {
    for (const n of nodes) {
      if (n.kind === 'command' && n.label === label) return { node: n, path };
      if (n.kind === 'submenu') {
        const hit = walk(n.children, [...path, n.label]);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const tree of menus) {
    const hit = walk(tree as readonly MenuNode[], []);
    if (hit) return hit;
  }
  return null;
}

/**
 * Renders the App, starting a session from the sample library (which holds two structure
 * documents) or a blank one from inside its first render, then running `choose` on the next render
 * that has a session. Returns the final markup and what each step saw.
 */
function renderApp(session: 'sample-library' | 'blank', choose?: (menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void) {
  let step: 'start' | 'choose' | 'done' = 'start';
  let item: ReturnType<typeof findCommand> = null;
  let passes = 0;
  probe.onMenus = (menus, dispatch) => {
    passes++;
    if (passes > 20) throw new Error('the App kept re-rendering');
    item = findCommand(menus, 'Align Structures…');
    if (step === 'start') {
      dispatch(`new-session:${session}`);
      step = 'choose';
    } else if (step === 'choose') {
      step = 'done';
      choose?.(menus, dispatch);
    }
  };
  const html = renderToStaticMarkup(<App />);
  return { html, item: item as ReturnType<typeof findCommand>, step };
}

const alignmentWindowOpen = (html: string) => /<dialog[^>]*aria-labelledby="opdlg-structure-alignment"/.test(html)
  && wordsOf(html).includes('Superposes chain B onto chain A');

type AppStep = (menus: readonly (readonly unknown[])[], dispatch: (id: string) => void) => void;

/**
 * Renders the App, running `steps[0]` inside its first render and each later step inside the
 * render the one before it caused, so each step acts on the state the previous one left. Returns
 * the markup of the render after the last step and how many steps ran.
 */
function driveApp(steps: readonly AppStep[]): { html: string; ran: number } {
  let ran = 0;
  let passes = 0;
  probe.onMenus = (menus, dispatch) => {
    passes++;
    if (passes > 20) throw new Error('the App kept re-rendering');
    if (ran < steps.length) steps[ran++](menus, dispatch);
  };
  const html = renderToStaticMarkup(<App />);
  return { html, ran };
}

/**
 * `driveApp` until the Genomics & 3D Structure Studio is drawn. The App loads that studio as a lazy
 * chunk: the first render that reaches it requests the chunk and shows the loading line in its
 * place, and a render after the chunk has arrived draws the studio.
 */
async function driveAppToStudio(steps: readonly AppStep[]): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { html, ran } = driveApp(steps);
    expect(ran, 'every step ran').toBe(steps.length);
    if (!html.includes('Loading Genomics &amp; 3D Structure Studio')) return html;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the Genomics & 3D Structure Studio chunk never loaded');
}

/** localStorage for one test (the App's autosave lives there), removed after it. */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
async function withLocalStorage<T>(run: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as { localStorage?: MemoryStorage };
  const before = g.localStorage;
  g.localStorage = new MemoryStorage();
  try {
    return await run();
  } finally {
    if (before === undefined) delete g.localStorage;
    else g.localStorage = before;
  }
}

describe('Align Structures on the menus', () => {
  it('the Align Structures menu item is on the web and native menus and opens the window', () => {
    // Web menu: Tools › Alignment › Align Structures…, enabled once the session holds a structure.
    const before = renderApp('sample-library');
    expect(before.step).toBe('done');
    expect(before.item, 'Align Structures… on the web menu').not.toBeNull();
    expect(before.item!.path).toEqual(['Alignment']);
    expect(before.item!.node.disabled).toBe(false);
    expect(alignmentWindowOpen(before.html), 'the window is closed until the item is chosen').toBe(false);

    const web = renderApp('sample-library', (menus) => findCommand(menus, 'Align Structures…')!.node.onSelect());
    expect(alignmentWindowOpen(web.html), 'choosing the web menu item opens the window').toBe(true);
    // It offers the session's structure documents (the sample library's 1D66 and 1A4Y entries).
    const options = Array.from(/<select id="opdlg-sa-doc-A"[^>]*>([\s\S]*?)<\/select>/.exec(web.html)?.[1].matchAll(/<option[^>]*>([^<]*)<\/option>/g) ?? [], (m) => decode(m[1]));
    expect(options.length).toBeGreaterThanOrEqual(2);

    // Native menu: the item's id is routed by the App's own dispatcher to the same window.
    const nativeId = Object.keys(NATIVE_MENU_COMMAND_RULES).find((id) => NATIVE_MENU_COMMAND_RULES[id] === 'align-structures');
    expect(nativeId).toBe('align:structures-dialog');
    const native = renderApp('sample-library', (_menus, dispatch) => dispatch(nativeId!));
    expect(alignmentWindowOpen(native.html), 'the native menu id opens the window').toBe(true);
  });

  it('enables the item on both menus by one rule: a session that holds a structure', () => {
    const blank = renderApp('blank');
    expect(blank.item!.node.disabled, 'web item with no structure document').toBe(true);

    const protein = buildCommandDocumentContext({ id: 'p', moleculeType: 'Protein', topology: 'linear', sequence: 'MKT' });
    const ctx = (sessionActive: boolean, structureDocumentCount?: number) =>
      ({ sessionActive, activeDoc: protein, selection: null, undoDepth: 0, redoDepth: 0, structureDocumentCount });
    const nativeEnabled = (c: ReturnType<typeof ctx>) => resolveNativeMenuItemEnabled('align:structures-dialog', buildNativeMenuState(c));
    expect(nativeEnabled(ctx(false, 2))).toBe(false);
    expect(nativeEnabled(ctx(true, 0))).toBe(false);
    expect(commandAvailability('align-structures', ctx(true, 0)).reason).toMatch(/structure \(PDB or mmCIF\)/);
    expect(nativeEnabled(ctx(true, 1))).toBe(true);
    // A caller that does not count structure documents does not get the command disabled for it.
    expect(nativeEnabled(ctx(true))).toBe(true);
  });

  it('the greyed Align Structures… item says why it is unavailable', () => {
    // A blank session holds no structure: the item is greyed and carries the rule's reason, which
    // is what the menu shows as the item's hint (its tooltip, the element aria-describedby names).
    const blank = renderApp('blank');
    const reason = commandAvailability('align-structures', {
      sessionActive: true, activeDoc: null, selection: null, undoDepth: 0, redoDepth: 0, structureDocumentCount: 0,
    }).reason;
    expect(reason).toMatch(/^Import a structure \(PDB or mmCIF\) first/);
    expect(blank.item!.node.disabled).toBe(true);
    expect(blank.item!.node.description).toBe(reason);
    expect(resolveMenuNodeFunctionDescription(blank.item!.node.id, blank.item!.node.label, blank.item!.node.description)).toBe(reason);

    // Once the session holds a structure the item is enabled, and no reason is given.
    const samples = renderApp('sample-library');
    expect(samples.item!.node.disabled).toBe(false);
    expect(samples.item!.node.description).toBeUndefined();
  });
});

// ─── AC3, through the App ───

describe("the App's selection reaches the 3D viewer", () => {
  it('the studio hands the viewer the parsed structure and the selected feature, from the selection made in the App', async () => {
    // A session holding an imported mmCIF entry, one document per chain as File › Import makes
    // them; chain B's sequence carries a feature. It is restored from the autosave, the App's own
    // synchronous way into a session holding given documents.
    const cif = entryCif(1);
    const loop = { id: 'f-loop', name: 'Loop', type: 'misc_feature' as const, start: 2, end: 5, strand: 1 as const, color: '#888888' };
    const docB = { ...chainDoc(cif, CHAIN_B, 'mmCIF'), features: [loop] };
    const docA = chainDoc(cif, CHAIN_A, 'mmCIF');
    const html = await withLocalStorage(async () => {
      expect(saveWorkbenchToLocalAutosave({
        sessionName: '9XYZ_Session',
        documents: [docB, docA],
        workspace: {
          activeDocId: docB.id, selectedFolder: 'All Project Files', navHistory: [docB.id], navIndex: 0,
          viewerTab: 'sequence-view', mapLayoutMode: 'split', zoomLevel: 100, textFormat: 'genbank', colorScheme: 'standard',
          darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
          displaySettings: {
            showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true,
            showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false,
          },
        },
      }), 'the autosave is written').toBe(true);
      return driveAppToStudio([
        (_menus, dispatch) => dispatch('file:restore-autosave'),
        // Next Feature (Edit menu): the App selects the feature's range on chain B's sequence.
        (_menus, dispatch) => dispatch('edit:next-feature'),
        // 3D Structure & Coils (Annotate menu): the App opens the studio on its 3D tab.
        (_menus, dispatch) => dispatch('annotate:coils-tm-pdb'),
      ]);
    });

    const badges = viewerBadges(html);
    // The parsed full-atom model reached the viewer: the file's own helix and chain B's heme.
    expect(badges.map((b) => b.words)).toContain('SS from file');
    expect(badges.find((b) => /ligand/.test(b.words))).toEqual({ words: '1 ligand', title: 'HEM H201' });
    // The App's selection (residues 2-5 of chain B, named after the feature) is the viewer's
    // selected feature, placed on the chain's author numbers.
    expect(badges.map((b) => b.words)).toContain('Loop (misc_feature): 4 residues (H 102–105)');
  });
});
