// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M7N2HE: a document's missing created or modified date stays missing on restore, instead of
 * being stamped with the restore time. A session is written with serializeMbcWorkbench and read
 * back through parseMbcWorkbench (the call the App's .mbc open and autosave restore make) on the
 * real engine, the WASM the frontend embeds, so a stale engine still stamps the dates and fails
 * here. A restored blank Modified date is not applicable under a Modified date filter (D0183), and
 * the Document info panel says "No recorded date" for a blank Created or Modified, in the panel
 * rendered alone and in the mounted App after an autosave restore.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentInfoPanel } from '../components/DocumentInfoPanel';
import { documentDates } from '../components/DocumentInfoPanel';
import { parseMbcWorkbench, serializeMbcWorkbench, type MbcWorkbenchSnapshot } from '../core/mbcSessionFormat';
import { NO_READABLE_MODIFIED_DATE, filterDocument } from '../core/projectSearch';
import type { SequenceDocument } from '../types/bio';
import { mountApp } from './appHarness';

const SET = '2025-01-02T03:04:05.000Z';
const PLACEHOLDER = '2026-10-31T00:00:00.000Z';
const NO_DATE = 'No recorded date';

const docOf = (id: string, createdAt: string, updatedAt: string): SequenceDocument => ({
  id, name: id, accession: `ACC_${id}`, description: `Document ${id}`, moleculeType: 'DNA', topology: 'linear',
  sequence: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGA', features: [], primers: [], history: [],
  createdAt, updatedAt, folder: 'Plasmids & Vectors',
} as SequenceDocument);

const UPDATED_BLANK = docOf('updated-blank', SET, '');
const CREATED_BLANK = docOf('created-blank', '', SET);
const BOTH_SPACES = docOf('both-spaces', '   ', '   ');
const BOTH_SET = docOf('both-set', SET, SET);

const snapshotOf = (documents: SequenceDocument[]): MbcWorkbenchSnapshot => ({
  sessionName: 'Blank_Dates',
  documents,
  workspace: {
    activeDocId: documents[0].id, selectedFolder: 'All Project Files', navHistory: [documents[0].id], navIndex: 0,
    viewerTab: 'sequence-view', mapLayoutMode: 'linear', zoomLevel: 100, textFormat: 'genbank',
    colorScheme: 'standard', darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
    displaySettings: { showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true, showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false },
  },
});

/** The session as the App's open and autosave restore read it back. */
const restored = () => {
  const before = Date.now();
  const parsed = parseMbcWorkbench(serializeMbcWorkbench(snapshotOf([UPDATED_BLANK, CREATED_BLANK, BOTH_SPACES, BOTH_SET])));
  const byId = new Map(parsed.envelope.documents.map((d) => [d.id, d]));
  return { parsed, byId, before, after: Date.now() };
};

/** A set date as the panel renders it today. */
const readable = (iso: string) => new Date(iso).toLocaleString(undefined, {
  day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

/** The panel's value for each field name, from its static markup. */
const panelFields = (doc: SequenceDocument): Record<string, string> => {
  const html = renderToStaticMarkup(<DocumentInfoPanel doc={doc} onUpdateDocument={() => {}} />);
  return Object.fromEntries([...html.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]));
};

describe('BG-01M7N2HE AC2: a restored session keeps a blank created or modified date blank', () => {
  it('BG-01M7N2HE AC2 parseMbcWorkbench keeps each blank date "" and a set date unchanged, on the real engine', () => {
    const { parsed, byId, before, after } = restored();
    expect(parsed.checksumVerified).toBe(true);
    expect(parsed.warnings).toEqual([]);
    const dates = [...byId.values()].map((d) => [d.id, d.createdAt, d.updatedAt]);
    expect(dates).toEqual([
      ['updated-blank', SET, ''],
      ['created-blank', '', SET],
      ['both-spaces', '', ''],
      ['both-set', SET, SET],
    ]);
    // Neither the restore time nor the placeholder appears on any document.
    for (const d of byId.values()) {
      for (const date of [d.createdAt, d.updatedAt]) {
        expect(date).not.toBe(PLACEHOLDER);
        if (date !== SET) expect(Number.isNaN(Date.parse(date)) || Date.parse(date) < before || Date.parse(date) > after).toBe(true);
      }
    }
  });

  it('BG-01M7N2HE AC2 the restored blank-modified document is not applicable under a Modified date filter, never stamped into it', () => {
    const { byId } = restored();
    const modified = { from: '2000-01-01', to: '2099-12-31' };
    expect(filterDocument(byId.get('updated-blank')!, { modified })).toEqual({ notApplicable: NO_READABLE_MODIFIED_DATE });
    // The same range takes in the set date, so a stamped date would pass instead.
    expect(filterDocument(byId.get('both-set')!, { modified })).toBe('passes');
  });

  it('BG-01M7N2HE AC2 the Document info panel says "No recorded date" for the restored blank Modified and Created', () => {
    const { byId } = restored();
    const updatedBlank = panelFields(byId.get('updated-blank')!);
    expect(updatedBlank.Modified).toBe(NO_DATE);
    expect(updatedBlank.Created).toBe(readable(SET));
    const createdBlank = panelFields(byId.get('created-blank')!);
    expect(createdBlank.Created).toBe(NO_DATE);
    expect(createdBlank.Modified).toBe(readable(SET));
  });

  it('BG-01M7N2HE AC2 the panel says "No recorded date" for a whitespace-only date, and renders a set date as before', () => {
    const spaces = panelFields(BOTH_SPACES);
    expect(spaces.Created).toBe(NO_DATE);
    expect(spaces.Modified).toBe(NO_DATE);
    const empty = panelFields(docOf('empty', '', ''));
    expect(empty.Created).toBe(NO_DATE);
    expect(empty.Modified).toBe(NO_DATE);
    const set = panelFields(BOTH_SET);
    expect(set.Created).toBe(readable(SET));
    expect(set.Modified).toBe(readable(SET));
    expect(Object.values(set)).not.toContain(NO_DATE);
    // A set value that is not a date is shown as written, as before: only a blank one is no date.
    const text = panelFields(docOf('free-text', 'lab book', SET));
    expect(text.Created).toBe('lab book');
  });

  it('BG-01M7N2HE AC2 after an autosave restore in the mounted App, the Info tab shows "No recorded date" for the blank Modified', async () => {
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [UPDATED_BLANK, BOTH_SET], activeDocId: UPDATED_BLANK.id, viewerTab: 'document-info' });
      const fields = Object.fromEntries(app.all('.mbc-document-info dl div').map((row) => [
        (row.querySelector('dt')?.textContent ?? '').trim(), (row.querySelector('dd')?.textContent ?? '').trim(),
      ]));
      expect(fields.Name).toBe(UPDATED_BLANK.name);
      expect(fields.Modified).toBe(NO_DATE);
      expect(fields.Created).toBe(readable(SET));
    } finally {
      app.unmount();
    }
  }, 30_000);
});

/**
 * BG-01M7N68F: the history studio's Created / Modified cell reads the same dates as the Info tab,
 * from the one derivation DocumentInfoPanel.tsx exports, so a document with no recorded dates says
 * "No recorded date" there instead of a bare " / ", and never shows a raw ISO timestamp.
 */
const LAB_BOOK = { ...docOf('lab-book', SET, SET), docMetadata: { Created: 'lab book' } } as SequenceDocument;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

describe('BG-01M7N68F AC1: the history studio says the Info tab\'s Created / Modified', () => {
  it('BG-01M7N68F AC1 documentDates is the Info tab\'s Created and Modified, for every case', () => {
    const cases: [SequenceDocument, string, string][] = [
      [UPDATED_BLANK, readable(SET), NO_DATE],
      [CREATED_BLANK, NO_DATE, readable(SET)],
      [BOTH_SPACES, NO_DATE, NO_DATE],
      [BOTH_SET, readable(SET), readable(SET)],
      [LAB_BOOK, 'lab book', readable(SET)],
      [docOf('free-text', 'lab book', SET), 'lab book', readable(SET)],
      [{ ...docOf('recorded-modified', SET, ''), docMetadata: { Modified: '2019-05-06' } } as SequenceDocument, readable(SET), '2019-05-06'],
      // A recorded date left empty is no recorded date: the bookkeeping date is read instead.
      [{ ...docOf('recorded-empty', SET, ''), docMetadata: { Created: '', Modified: '' } } as SequenceDocument, readable(SET), NO_DATE],
    ];
    for (const [doc, created, modified] of cases) {
      expect(documentDates(doc), doc.id).toEqual({ created, modified });
      const panel = panelFields(doc);
      expect([panel.Created, panel.Modified], doc.id).toEqual([created, modified]);
    }
  });

  it('BG-01M7N68F AC1 after an autosave restore in the mounted App, the history studio cell equals the Info tab\'s Created / Modified', async () => {
    const cases: [SequenceDocument, string][] = [
      [UPDATED_BLANK, `${readable(SET)} / ${NO_DATE}`],
      [CREATED_BLANK, `${NO_DATE} / ${readable(SET)}`],
      [BOTH_SPACES, `${NO_DATE} / ${NO_DATE}`],
      [BOTH_SET, `${readable(SET)} / ${readable(SET)}`],
      [LAB_BOOK, `lab book / ${readable(SET)}`],
    ];
    const app = await mountApp();
    try {
      for (const [doc, expected] of cases) {
        await app.restoreSession({ documents: [doc], activeDocId: doc.id, viewerTab: 'history-hybrid' });
        const subTab = app.all('button[role="tab"]').filter((b) => (b.textContent ?? '') === 'History Tree, Alerts & Info (⌘8)');
        expect(subTab.length, doc.id).toBe(1);
        await app.click(subTab[0]);
        const rows = app.all('[aria-label="Document Lineage and Properties"] tr')
          .filter((row) => (row.querySelector('th')?.textContent ?? '').trim() === 'Created / Modified');
        expect(rows.length, doc.id).toBe(1);
        const cell = (rows[0].querySelector('td')?.textContent ?? '').trim();
        expect(cell, doc.id).toBe(expected);
        expect(cell, doc.id).not.toBe('/');
        expect(cell, doc.id).not.toMatch(ISO);
        if (doc !== BOTH_SPACES && doc !== CREATED_BLANK && doc !== UPDATED_BLANK) expect(cell, doc.id).not.toContain(NO_DATE);

        await app.clickTab('document-info');
        const info = Object.fromEntries(app.all('.mbc-document-info dl div').map((row) => [
          (row.querySelector('dt')?.textContent ?? '').trim(), (row.querySelector('dd')?.textContent ?? '').trim(),
        ]));
        expect(info.Name, doc.id).toBe(doc.name);
        expect(cell, doc.id).toBe(`${info.Created} / ${info.Modified}`);
      }
    } finally {
      app.unmount();
    }
  }, 60_000);
});
