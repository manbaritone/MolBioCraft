// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6VZT1 AC4: in the mounted App, a NEXUS file holding a character matrix and two trees opens
 * the tree and the matrix as an alignment, and the status banner says so, with the alignment's
 * sequence count and that one more tree in the file was not opened.
 *
 * Wrong implementations, and what catches each: the App opening only `imported.doc` (the old route)
 * - the saved session must hold both documents, the alignment with the matrix's rows as the NEXUS
 * reader gives them (MATCHCHAR resolved, MISSING read as N); the banner naming only the tree - it
 * must name the alignment and its 4 sequences; the skipped tree kept out of the banner - the banner
 * must carry the sentence; the posterior comment on the first tree dropped - its Newick keeps 0.95.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import { dispatchLiveEvent } from './liveDom';

vi.setConfig({ testTimeout: 120_000 });

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const banner = (app: AppHarness) => app.all('.statusbar-toast-text').map((e) => words(e.textContent));

async function drop(app: AppHarness, name: string, text: string): Promise<void> {
  const React = await import('react');
  const root = app.one('.mbc-workbench', 'workbench root');
  const file = new File([new TextEncoder().encode(text)], name);
  const dataTransfer = { files: [file], types: ['Files'], items: [], dropEffect: 'copy', effectAllowed: 'all' };
  await React.act(async () => { dispatchLiveEvent(root, 'drop', { dataTransfer }); });
  await app.settle();
}

async function savedDocuments(app: AppHarness): Promise<SequenceDocument[]> {
  const before = app.downloads().length;
  await app.menu('file:export-mbc-json');
  await app.settle();
  const files = app.downloads().slice(before).filter((f) => f.filename.endsWith('.mbc'));
  expect(files).toHaveLength(1);
  const { parseMbcWorkbench } = await import('../core/mbcSessionFormat');
  const { envelope } = parseMbcWorkbench(await files[0].text());
  return envelope.documents as SequenceDocument[];
}

const matrixAndTwoTrees = `#NEXUS
BEGIN DATA;
  DIMENSIONS NTAX=4 NCHAR=8;
  FORMAT DATATYPE=DNA MISSING=? GAP=- MATCHCHAR=.;
  MATRIX
    Alpha      ACGTACGT
    'Beta two' ..A.AC-?
    Gamma      ACGTTCGA
    Delta      ACGAACGT
  ;
END;
BEGIN TREES;
  TREE best = ((Alpha:0.1,'Beta two':0.2)[&posterior=0.95]:0.05,Gamma:0.3,Delta:0.4);
  TREE other = ((Alpha:0.1,Gamma:0.2):0.05,Delta:0.4);
END;
`;

describe('BG-01M6VZT1 NEXUS matrix and trees in the App', () => {
  it('BG-01M6VZT1 AC4 in the App, dropping a NEXUS file with a matrix and two trees opens the tree and the alignment and says one tree was not opened', async () => {
    const app = await mountApp();
    try {
      await drop(app, 'primates.nex', matrixAndTwoTrees);
      const shown = banner(app).join(' ');
      expect(shown).toContain('Opened phylogenetic tree "primates"');
      expect(shown).toContain('NEXUS alignment "primates" (4 sequences)');
      expect(shown).toContain('1 more tree in the file was not opened');

      const docs = (await savedDocuments(app)).filter((d) => d.name === 'primates');
      expect(docs.map((d) => d.documentKind).sort()).toEqual(['alignment', 'tree']);
      const tree = docs.find((d) => d.documentKind === 'tree')!;
      const aln = docs.find((d) => d.documentKind === 'alignment')!;
      expect(tree.docMetadata?.Newick).toBe("((Alpha:0.1,'Beta two':0.2)0.95:0.05,Gamma:0.3,Delta:0.4);");
      expect(tree.docMetadata?.['Trees in file']).toBe(2);
      expect(aln.alignmentMeta?.sequences?.map((s) => [s.name, s.sequence])).toEqual([
        ['Alpha', 'ACGTACGT'], ['Beta two', 'ACATAC-N'], ['Gamma', 'ACGTTCGA'], ['Delta', 'ACGAACGT'],
      ]);
    } finally {
      app.unmount();
    }
  });
});
