// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6P2EZ: an imported tree analysed against an alignment of its taxa. An imported tree (a
 * Newick and no rows of its own) is paired with an alignment through a 'Paired alignment' picker
 * above the tree viewer, which records a 'Pair Alignment' history entry; phylo:usertree (and every
 * phylo:* command that opens a module) then opens the Phylogenetics studio on the paired rows, its
 * user-tree module evaluating the tree's own Newick, with a 'Back to tree' button. A tree built in
 * the app opens the studio on its own rows and gets no picker (D0199).
 *
 * Every App check mounts the real App with the harness, restores sessions built here through its
 * autosave restore and drives it through its own menu commands, picker and tabs. The figures each
 * check reads are compared with the engine's own (analyzeUserTree), so a module that evaluated the
 * studio's own tree, or another alignment, reads wrong.
 */

import { describe, expect, it, vi } from 'vitest';
import { ALIGNED_MEMBER_METADATA_KEY, phylogenySourceDocuments } from '../core/documentViews';
import { parseMbcWorkbench } from '../core/mbcSessionFormat';
import { runBuildTree } from '../core/operationRunners';
import { analyzeUserTree } from '../core/phyloEvoEngine';
import type { HistoryTreeNode, SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness, type MountOptions } from './appHarness';
import { memoryStorage, type LiveElement } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

async function withApp<T>(run: (app: AppHarness) => Promise<T>, opts: MountOptions = {}): Promise<T> {
  const app = await mountApp(opts);
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

// ─── Documents built in the test ───

const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Tree Documents',
  createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', features: [], primers: [], history: [],
};

/** Each listed (1-based) column moved one letter on in ACGT. */
function substituted(seq: string, cols: number[]): string {
  const out = seq.split('');
  for (const c of cols) out[c - 1] = 'ACGT'[('ACGT'.indexOf(out[c - 1]) + 1) % 4];
  return out.join('');
}
const BASE = 'ACGTTGCAACGTAGCTAGGCTTACGATCGATCGGATCCAA';
/** Ta and Tb differ in two columns, Tc and Td share four others: NJ joins (Ta,Tb) and (Tc,Td). */
const SEQ: Record<string, string> = {
  Ta: BASE,
  Tb: substituted(BASE, [1, 2]),
  Tc: substituted(BASE, [10, 11, 12, 13]),
  Td: substituted(substituted(BASE, [10, 11, 12, 13]), [20]),
  Te: substituted(BASE, [30, 31]),
  Tf: substituted(BASE, [35]),
};

const alignment = (id: string, name: string, rows: [string, string][]): SequenceDocument => ({
  ...BLANK, id, name, folder: 'Alignments', documentKind: 'alignment', sequence: rows[0][1], description: 'An alignment built in the test',
  alignmentMeta: { isAligned: true, sequenceCount: rows.length, sequences: rows.map(([n, s], i) => ({ id: `${id}-m${i + 1}`, name: n, sequence: s })) },
} as SequenceDocument);
const rowsOf = (names: string[]): [string, string][] => names.map((n) => [n, SEQ[n]]);

const ALN4 = alignment('ez-aln4', 'EZ Four Taxa', rowsOf(['Ta', 'Tb', 'Tc', 'Td']));
const ALN2 = alignment('ez-aln2', 'EZ Two Taxa', rowsOf(['Ta', 'Tb']));
const ALN1 = alignment('ez-aln1', 'EZ One Row', rowsOf(['Ta']));
const ALN_TRASHED = alignment('ez-aln-trash', 'EZ Trashed Taxa', rowsOf(['Ta', 'Tb', 'Tc']));

/** A tree record as createTreeDocument makes one from an imported Newick file: no rows, no parent. */
const importedTree = (id: string, name: string, newick: string, history: HistoryTreeNode[] = []): SequenceDocument => ({
  ...BLANK, id, name, description: `Imported phylogenetic tree from ${name}.nwk`, documentKind: 'tree', history,
  docMetadata: { Newick: newick, 'No. tips': newick.split(',').length, 'Source Format': 'Newick' },
});
let entryNo = 0;
/** A pairing as the picker records it. */
const pairing = (aln: Pick<SequenceDocument, 'id' | 'name'>): HistoryTreeNode => ({
  id: `hist-ez-pair-${++entryNo}`, timestamp: '2026-11-19T00:00:00Z', operation: 'Pair Alignment',
  description: `Paired with alignment ${aln.name}`, parentIds: [aln.id], lengthBp: 0, topology: 'linear',
});
/** An edit as the tree viewer's Save changes records it (ImportedTreeViewer: parentIds is the tree itself). */
const treeEdit = (treeId: string): HistoryTreeNode => ({
  id: `hist-ez-edit-${++entryNo}`, timestamp: '2026-11-19T00:00:00Z', operation: 'Edit Tree',
  description: 'Tree Explorer edits (1)', parentIds: [treeId], lengthBp: 0, topology: 'linear',
});

/** A topology other than the NJ tree's: (Ta,Tc) and (Tb,Td). */
const CROSSED = '((Ta:0.1,Tc:0.1):0.05,(Tb:0.1,Td:0.1):0.05);';
const TREE = importedTree('ez-tree', 'EZ Imported Tree', CROSSED);

// ─── Reading the App ───

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const pairedPicker = (app: AppHarness) => app.all('select[aria-label="Paired alignment"]');
function onePairedPicker(app: AppHarness): LiveElement {
  const found = pairedPicker(app);
  expect(found, 'one Paired alignment picker').toHaveLength(1);
  return found[0];
}
const optionTexts = (select: LiveElement) => select.querySelectorAll('option').map((o) => words(o.textContent));
const chosenText = (select: LiveElement) => words(select.querySelectorAll('option').find((o) => o.getAttribute('value') === select.value)?.textContent ?? '');
const viewerShown = (app: AppHarness) => app.canvas().querySelectorAll('.mbc-imported-tree-viewer').length > 0;
const modulePicker = (app: AppHarness) => app.all('select[aria-label="Active Phylogenetic Analysis"]');
const moduleShown = (app: AppHarness) => modulePicker(app)[0]?.value ?? null;
const buttonsNamed = (app: AppHarness, text: string) => app.canvas().querySelectorAll('button').filter((b) => words(b.textContent) === text);
const statusText = (app: AppHarness) => app.all('.statusbar-toast-text').map((s) => words(s.textContent));
/** The words of every status or alert line the canvas shows. */
const notices = (app: AppHarness) => app.canvas().querySelectorAll('[role="status"], [role="alert"]').map((e) => words(e.textContent));
const userTreeText = (app: AppHarness) => {
  const areas = app.canvas().querySelectorAll('textarea');
  expect(areas, 'one user-tree Newick field').toHaveLength(1);
  return areas[0].value;
};
/** The parsimony steps the user-tree module draws. */
const parsimonyShown = (app: AppHarness) => {
  const boxes = app.canvas().querySelectorAll('.kpi-box').filter((b) => words(b.querySelectorAll('.kpi-label')[0]?.textContent ?? '') === 'Parsimony Length');
  expect(boxes, 'one Parsimony Length figure').toHaveLength(1);
  return words(boxes[0].querySelectorAll('.kpi-val')[0].textContent);
};
/** Whether the module draws any figure: the likelihood, parsimony and fit figures, site coverage or the topology. */
const figuresDrawn = (app: AppHarness) => {
  const text = words(app.canvas().textContent);
  return {
    kpis: app.canvas().querySelectorAll('.kpi-box').length,
    parsimony: text.includes('Parsimony Length'),
    likelihood: text.includes('lnL (JC69)'),
    coverage: text.includes('Compute Site Coverage'),
    topology: text.includes('User tree topology'),
  };
};
const NO_FIGURES = { kpis: 0, parsimony: false, likelihood: false, coverage: false, topology: false };
const restore = (app: AppHarness, documents: SequenceDocument[], activeDocId: string, deleted: string[] = []) =>
  app.restoreSession({
    documents, activeDocId, viewerTab: 'phylogenetics',
    ...(deleted.length ? { workspace: { projectExplorer: { deletedDocIds: deleted } } as never } : {}),
  });
const engine = (newick: string, aln: SequenceDocument) => {
  const rows = aln.alignmentMeta!.sequences!;
  return analyzeUserTree(newick, rows.map((r) => r.name), rows.map((r) => r.sequence.toUpperCase()));
};
const MISMATCH = 'The tree and the paired alignment do not hold the same taxa.';

// ─── AC1 ───

describe('US-01M6P2EZ AC1: pairing an imported tree with an alignment', () => {
  it('the source rows are those of the latest pairing, and an edit after it does not undo it', () => {
    const names = (docs: SequenceDocument[]) => docs.map((d) => d.name);
    const project = [ALN2, ALN4];
    // The later pairing wins, whichever comes first in the project.
    const later4 = importedTree('ez-t1', 't1', CROSSED, [pairing(ALN2), pairing(ALN4), treeEdit('ez-t1')]);
    expect(names(phylogenySourceDocuments(later4, [], [...project, later4]))).toEqual(['Ta', 'Tb', 'Tc', 'Td']);
    const later2 = importedTree('ez-t2', 't2', CROSSED, [pairing(ALN4), pairing(ALN2), treeEdit('ez-t2')]);
    expect(names(phylogenySourceDocuments(later2, [], [...project, later2]))).toEqual(['Ta', 'Tb']);
    // The rows are the alignment's own, used as given.
    const rows = phylogenySourceDocuments(later4, [], [...project, later4]);
    expect(rows.map((r) => r.sequence)).toEqual(['Ta', 'Tb', 'Tc', 'Td'].map((n) => SEQ[n]));
    expect(rows.every((r) => r.docMetadata?.[ALIGNED_MEMBER_METADATA_KEY] !== undefined)).toBe(true);
    // No pairing, no rows.
    expect(phylogenySourceDocuments(TREE, [], [...project, TREE])).toEqual([]);
  });

  it('lists the session\'s live alignments, records the choice, shows it as Parent and keeps it through an autosave restore', async () => {
    const storage = memoryStorage();
    const built = (await runBuildTree(phylogenySourceDocuments(ALN4, [], [ALN4]), { method: 'Neighbor-Joining (NJ)' }, { sourceLabel: 'EZ Four Taxa' })).created[0];
    let saved = '';
    await withApp(async (app) => {
      await restore(app, [TREE, ALN4, ALN2, ALN1, ALN_TRASHED, built], TREE.id, [ALN_TRASHED.id]);
      expect(viewerShown(app), 'the tree viewer is drawn').toBe(true);
      const picker = onePairedPicker(app);
      expect(app.canvas().contains(picker), 'the picker is in the tab').toBe(true);
      // Alignments of at least two rows, not in the trash; no tree, no single row.
      expect(optionTexts(picker)).toEqual(['Choose an alignment…', 'EZ Four Taxa', 'EZ Two Taxa']);
      expect(picker.value, 'none chosen').toBe('');

      await app.change(onePairedPicker(app), ALN4.id);
      expect(onePairedPicker(app).value).toBe(ALN4.id);
      expect(viewerShown(app), 'the viewer stays after a choice').toBe(true);

      // The History tab names the alignment as the tree's Parent.
      const parents = async () => {
        await app.clickTab('history-hybrid');
        const lists = app.all('ul[aria-label="Linked documents"]');
        expect(lists, 'the History tab lists linked documents').toHaveLength(1);
        const linked = lists[0].querySelectorAll('li').map((li) => [
          words(li.querySelectorAll('.mbc-lineage-link-relation')[0]?.textContent ?? ''),
          words(li.querySelectorAll('.mbc-lineage-link-name')[0]?.textContent ?? ''),
        ]);
        await app.clickTab('phylogenetics');
        return linked.filter(([relation]) => relation === 'Parent').map(([, name]) => name).sort();
      };
      expect(await parents()).toEqual(['EZ Four Taxa']);

      // A later choice wins.
      await app.change(onePairedPicker(app), ALN2.id);
      expect(onePairedPicker(app).value).toBe(ALN2.id);
      await app.change(onePairedPicker(app), ALN4.id);
      expect(onePairedPicker(app).value).toBe(ALN4.id);
      expect(await parents(), 'each alignment the tree was paired with').toEqual(['EZ Four Taxa', 'EZ Two Taxa']);

      // The App's own autosave of the session.
      vi.advanceTimersByTime(1_000);
      await app.settle();
      saved = storage.getItem('molbiocraft.workbench.autosave.v1') ?? '';
    }, { storage });

    expect(saved, 'the App wrote an autosave').not.toBe('');
    const parsed = parseMbcWorkbench(saved, 'EZ');
    const docs = parsed.envelope.documents;
    const tree = docs.find((d) => d.id === TREE.id)!;
    const pairings = tree.history.filter((h) => h.operation === 'Pair Alignment');
    expect(pairings.map((h) => h.parentIds), 'one entry per choice, each naming its alignment').toEqual([[ALN4.id], [ALN2.id], [ALN4.id]]);
    expect(phylogenySourceDocuments(tree, [], docs).map((d) => d.name)).toEqual(['Ta', 'Tb', 'Tc', 'Td']);

    // A fresh launch restores that autosave: the pairing is still there.
    await withApp(async (app) => {
      await app.menu('file:restore-autosave');
      expect(words(app.doc.body.textContent)).toContain('Restored workbench');
      expect(onePairedPicker(app).value, 'still paired after the restore').toBe(ALN4.id);
      await app.menu('phylo:usertree');
      expect(moduleShown(app)).toBe('usertree');
      expect(parsimonyShown(app)).toBe(`${engine(CROSSED, ALN4).parsimonyLengthSteps} steps`);
    }, { storage: memoryStorage({ 'molbiocraft.workbench.autosave.v1': saved }) });

    // A built tree keeps its own rows and gets no picker.
    expect(phylogenySourceDocuments(built, [], [built, ALN2]).map((d) => d.name)).toEqual(['Ta', 'Tb', 'Tc', 'Td']);
    await withApp(async (app) => {
      await restore(app, [built, ALN2], built.id);
      expect(viewerShown(app)).toBe(true);
      expect(pairedPicker(app), 'no picker on a built tree').toHaveLength(0);
    });
  });
});

// ─── AC2 ───

describe('US-01M6P2EZ AC2: phylo commands on a paired tree', () => {
  it('opens the user-tree module on the paired alignment, evaluating the tree\'s own Newick, with a way back', async () => {
    const own = engine(CROSSED, ALN4);
    const nj = engine('', ALN4);
    expect(own.parsimonyLengthSteps, 'the fixture: the imported topology scores otherwise than NJ').not.toBe(nj.parsimonyLengthSteps);
    await withApp(async (app) => {
      // Unpaired: no module, and the status bar says why.
      await restore(app, [TREE, ALN4], TREE.id);
      await app.menu('phylo:usertree');
      expect(modulePicker(app), 'no module opens').toHaveLength(0);
      expect(viewerShown(app)).toBe(true);
      expect(statusText(app)).toContain('Pair this tree with an alignment of the same taxa first.');

      await app.change(onePairedPicker(app), ALN4.id);
      expect(viewerShown(app), 'opening the tab still shows the viewer').toBe(true);
      await app.menu('phylo:usertree');
      expect(moduleShown(app)).toBe('usertree');
      expect(viewerShown(app), 'not the tree viewer').toBe(false);
      expect(words(app.canvas().textContent)).toContain('Analyze & Edit User Tree');
      expect(userTreeText(app), 'the tree\'s own Newick').toBe(CROSSED);
      expect(parsimonyShown(app)).toBe(`${own.parsimonyLengthSteps} steps`);
      expect(parsimonyShown(app)).not.toBe(`${nj.parsimonyLengthSteps} steps`);

      // Back to tree: the viewer again.
      expect(buttonsNamed(app, 'Back to tree')).toHaveLength(1);
      await app.click(buttonsNamed(app, 'Back to tree')[0]);
      expect(viewerShown(app)).toBe(true);
      expect(modulePicker(app)).toHaveLength(0);

      // Another phylo command opens its own module on the paired rows.
      await app.menu('phylo:distance');
      expect(moduleShown(app)).toBe('distance');
      expect(viewerShown(app)).toBe(false);
      // The distance matrix's rows are the paired alignment's, in its order.
      const matrixRows = app.canvas().querySelectorAll('tbody tr td strong').map((e) => words(e.textContent)).filter((t) => /^\[\d+\] /.test(t));
      expect(matrixRows).toEqual(['[1] Ta', '[2] Tb', '[3] Tc', '[4] Td']);

      // Leaving the tab and opening it again shows the viewer.
      await app.clickTab('text-view');
      await app.clickTab('phylogenetics');
      expect(viewerShown(app)).toBe(true);
      expect(modulePicker(app)).toHaveLength(0);
    });
  });
});

// ─── AC3 ───

describe('US-01M6P2EZ AC3: a tree and an alignment of different taxa', () => {
  it('names every tip and row each lacks, in order, and draws no figure', async () => {
    const cases: { tree: string; rows: string[]; said: string | null; alnName: string }[] = [
      { tree: '((Td,Tc),(Tb,Ta));', rows: ['Ta', 'Tb'], said: `${MISMATCH} In the tree only: Td, Tc.`, alnName: 'tree tips missing' },
      { tree: '((Ta,Tb),Tc);', rows: ['Tf', 'Ta', 'Te', 'Tb', 'Tc'], said: `${MISMATCH} In the alignment only: Tf, Te.`, alnName: 'rows missing' },
      { tree: "(('Pan troglodytes',Tb),(Tc,Td));", rows: ['Homo sapiens', 'Tb', 'Tc', 'Td'],
        said: `${MISMATCH} In the tree only: Pan troglodytes. In the alignment only: Homo sapiens.`, alnName: 'both missing' },
      { tree: "(('Homo sapiens',Tb),(Tc,Td));", rows: ['Homo sapiens', 'Tb', 'Tc', 'Td'], said: null, alnName: 'quoted match' },
      // Written otherwise, the same after sanitizeNewickLabel: no mismatch either.
      { tree: "((Homo_sapiens,Tb),('Tc',Td));", rows: ['Homo sapiens', 'Tb', 'Tc', 'Td'], said: null, alnName: 'sanitized match' },
    ];
    await withApp(async (app) => {
      for (const [i, c] of cases.entries()) {
        const aln = alignment(`ez-aln-c${i}`, `EZ ${c.alnName}`, c.rows.map((n) => [n, SEQ[n] ?? (n === 'Homo sapiens' ? SEQ.Ta : SEQ.Tf)]));
        const tree = importedTree(`ez-tree-c${i}`, `EZ tree ${i}`, c.tree, [pairing(aln)]);
        await restore(app, [tree, aln], tree.id);
        await app.menu('phylo:usertree');
        expect(moduleShown(app), c.alnName).toBe('usertree');
        const said = notices(app).filter((n) => n.startsWith(MISMATCH));
        if (c.said) {
          expect(said, c.alnName).toEqual([c.said]);
          expect(figuresDrawn(app), `${c.alnName}: no figure`).toEqual(NO_FIGURES);
        } else {
          expect(said, `${c.alnName}: a quoted label that matches a row is no mismatch`).toEqual([]);
          expect(parsimonyShown(app)).toBe(`${engine(c.tree, aln).parsimonyLengthSteps} steps`);
        }
      }
    });
  });
});

// ─── AC4 ───

describe('US-01M6P2EZ AC4: a paired alignment gone, and a Newick that does not parse', () => {
  it('says the paired alignment is no longer in the session and runs nothing on it', async () => {
    const sentence = (name: string) => `The paired alignment ${name} is no longer in the session; choose another.`;
    await withApp(async (app) => {
      // In the trash, with an earlier pairing still live: the latest pairing is the one named, and
      // no module runs on either.
      const trashedPair = importedTree('ez-tree-trash', 'EZ tree trash', CROSSED, [pairing(ALN2), pairing(ALN4)]);
      await restore(app, [trashedPair, ALN4, ALN2], trashedPair.id, [ALN4.id]);
      expect(chosenText(onePairedPicker(app))).toBe('Choose an alignment…');
      expect(onePairedPicker(app).value).toBe('');
      expect(notices(app)).toContain(sentence('EZ Four Taxa'));
      await app.menu('phylo:usertree');
      expect(modulePicker(app), 'no module runs').toHaveLength(0);
      expect(statusText(app)).toContain('Pair this tree with an alignment of the same taxa first.');

      // Erased from the session: named as the pairing recorded it.
      const erasedPair = importedTree('ez-tree-gone', 'EZ tree gone', CROSSED, [pairing({ id: 'ez-aln-gone', name: 'EZ Gone Alignment' })]);
      await restore(app, [erasedPair, ALN2], erasedPair.id);
      expect(chosenText(onePairedPicker(app))).toBe('Choose an alignment…');
      expect(notices(app)).toContain(sentence('EZ Gone Alignment'));
      await app.menu('phylo:usertree');
      expect(modulePicker(app)).toHaveLength(0);

      // A live pairing says nothing of the kind.
      const live = importedTree('ez-tree-live', 'EZ tree live', CROSSED, [pairing(ALN4)]);
      await restore(app, [live, ALN4], live.id);
      expect(notices(app).filter((n) => n.includes('no longer in the session'))).toEqual([]);
    });
  });

  it('shows the engine\'s reason for a Newick that does not parse, and no figure', async () => {
    const broken = '((Ta:x,Tb),(Tc,Td));';
    const reason = engine(broken, ALN4).notes.find((n) => n.startsWith('Tree not evaluated: '));
    expect(reason, 'the engine refuses the fixture').toBeDefined();
    await withApp(async (app) => {
      const tree = importedTree('ez-tree-broken', 'EZ tree broken', broken, [pairing(ALN4)]);
      await restore(app, [tree, ALN4], tree.id);
      await app.menu('phylo:usertree');
      expect(moduleShown(app)).toBe('usertree');
      expect(notices(app)).toContain(reason);
      expect(notices(app).filter((n) => n.startsWith(MISMATCH)), 'its taxa match').toEqual([]);
      expect(figuresDrawn(app)).toEqual(NO_FIGURES);
    });
  });
});

// ─── AC5 ───

describe('US-01M6P2EZ AC5: a tree built in the app', () => {
  it('opens the user-tree module on the tree\'s own rows, with no picker', async () => {
    const built = (await runBuildTree(phylogenySourceDocuments(ALN4, [], [ALN4]), { method: 'Neighbor-Joining (NJ)' }, { sourceLabel: 'EZ Four Taxa' })).created[0];
    const newick = String(built.docMetadata!.Newick);
    await withApp(async (app) => {
      await restore(app, [built, ALN2], built.id);
      expect(pairedPicker(app)).toHaveLength(0);
      await app.menu('phylo:usertree');
      expect(moduleShown(app)).toBe('usertree');
      expect(viewerShown(app)).toBe(false);
      expect(pairedPicker(app)).toHaveLength(0);
      expect(userTreeText(app)).toBe(newick);
      expect(parsimonyShown(app)).toBe(`${engine(newick, built).parsimonyLengthSteps} steps`);
      expect(buttonsNamed(app, 'Back to tree')).toHaveLength(1);
    });
  });
});
