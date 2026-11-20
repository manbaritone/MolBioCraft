// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M7DXRN: the document table's Residues rule, through the mounted App (appHarness). The rule is
 * decided by the IUPAC motif engine (search_iupac_motif): the field offers only the two operators that
 * engine can answer, and a document the engine refuses is matched by neither, with the engine's
 * reason under the rule.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

vi.setConfig({ testTimeout: 240_000 });

const FOLDER = 'Lab Residues';
const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// 600 bases of C, A and G: no GAATTC on either strand.
const FILLER = 'CAGCCAGACAGGCAAGCCAG'.repeat(30);
const doc = (id: string, name: string, sequence: string, more: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id, name, accession: `ACC-${id.toUpperCase()}`, description: `${name}, built in the test`, sequence,
  moleculeType: 'DNA', topology: 'linear', folder: FOLDER,
  createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z',
  features: [], primers: [], history: [], ...more,
} as SequenceDocument);

// GAATTC split across base 1 of the circle (ATTC ... GA), and the same bases as a linear molecule.
const CIRC = doc('rcirc', 'Origin_Site', `ATTC${FILLER}GA`, { topology: 'circular' });
const LIN = doc('rlin', 'Linear_Twin', `ATTC${FILLER}GA`);
const EMPTY = doc('rempty', 'Empty_Record', '');
const PROT = doc('rprot', 'Protein_Record', 'MKTAYIAKQRQISFVKSHFSRQ'.repeat(5), { moleculeType: 'Protein' });
const DOCS = [CIRC, LIN, EMPTY, PROT];

const tableRows = (app: AppHarness) => app.all('table.mbc-document-table tbody tr').filter((r) => r.querySelectorAll('input[type="checkbox"]').length === 1);
const shown = (app: AppHarness) =>
  tableRows(app).map((r) => DOCS.filter((d) => words(r.textContent).includes(d.accession)).map((d) => d.name)).flat().sort();
const ruleRow = (app: AppHarness) => app.one('.mbc-filter-rule-row', 'the filter rule row');
const inRule = (app: AppHarness, label: string): LiveElement => {
  const found = ruleRow(app).querySelectorAll('[aria-label]').filter((e) => e.getAttribute('aria-label') === label);
  expect(found, `one "${label}" in the rule row`).toHaveLength(1);
  return found[0];
};
const operatorChoices = (app: AppHarness) => inRule(app, 'Filter operator').querySelectorAll('option').map((o) => words(o.textContent));
const notes = (app: AppHarness) => app.all('.mbc-filter-rule-note').map((n) => words(n.textContent));

describe('BG-01M7DXRN the document table Residues rule in the App', () => {
  it('BG-01M7DXRN AC3 in the App, the Residues field offers only contains and does not contain, and a refused document is not matched and the rule names why', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({
        documents: DOCS, activeDocId: CIRC.id, viewerTab: 'sequence-view',
        workspace: { selectedFolder: FOLDER, projectExplorer: { customFolders: [FOLDER], folderParents: {} } } as never,
      });
      expect(shown(app), 'every record is listed before any rule').toEqual(DOCS.map((d) => d.name).sort());
      await app.click(app.one('button.mbc-filter-trigger-btn', 'the table filter button'));
      const add = app.all('button').filter((b) => words(b.textContent) === '+ Column Rule');
      expect(add).toHaveLength(1);
      await app.click(add[0]);

      // A column rule offers every operator; picking 'equals' and then Residues falls back to contains.
      expect(operatorChoices(app).length, 'a column rule offers the comparison operators').toBeGreaterThan(2);
      await app.change(inRule(app, 'Filter operator'), 'equals');
      await app.change(inRule(app, 'Filter column'), '__residues__');
      expect(operatorChoices(app), 'Residues offers only the two operators the engine answers').toEqual(['contains', 'does not contain']);
      expect(inRule(app, 'Filter operator').value).toBe('contains');

      await app.change(inRule(app, 'Filter condition value'), 'GAATTC');
      expect(shown(app), 'the site across base 1 of the circle; the linear twin has none; the empty record is refused').toEqual([CIRC.name]);
      expect(notes(app), 'the rule names the refused record and the engine\'s reason').toEqual([
        `Not searched, so not matched: ${EMPTY.name} (sequence is empty).`,
      ]);

      await app.change(inRule(app, 'Filter operator'), 'not-contains');
      expect(shown(app), 'does not contain: the linear twin and the protein, never the refused record').toEqual([LIN.name, PROT.name].sort());
      expect(notes(app)).toEqual([`Not searched, so not matched: ${EMPTY.name} (sequence is empty).`]);

      // Q is a protein letter only: the engine refuses it for every nucleotide record and searches the protein.
      await app.change(inRule(app, 'Filter operator'), 'contains');
      await app.change(inRule(app, 'Filter condition value'), 'QRQISF');
      expect(shown(app), 'only the protein holds QRQISF; the refused records are not matched').toEqual([PROT.name]);
      // The engine reads the query before the sequence, so the empty record is refused for the letter too.
      const refusedQ = `query letter 'Q' is not a nucleotide code`;
      expect(notes(app)).toEqual([
        `Not searched, so not matched: ${EMPTY.name} (${refusedQ}); ${LIN.name} (${refusedQ}); ${CIRC.name} (${refusedQ}).`,
      ]);
      await app.change(inRule(app, 'Filter operator'), 'not-contains');
      expect(shown(app), 'nor matched by does not contain').toEqual([]);
    } finally {
      app.unmount();
    }
  });
});
