// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Database Explorer's RCSB PDB panel (US-01M6PB7M, D0008): hits listed with each entry's
 * title, method and resolution; an opened entry handed to the workbench's file import as its mmCIF;
 * failures shown with a heading that names what happened; no request before the user acts; at most
 * four at once and five starting in any second, for every explorer in the app together.
 *
 * No test touches the network: the global fetch is replaced by one that throws, and every request
 * goes to a stub. Recorded files come from test-data/rcsb through ./testData. The repo has no DOM
 * test environment, so the panel is checked two ways: its markup through renderToStaticMarkup, and
 * its controls through `RcsbExplorerView`, a plain function of the session's state and the
 * controller's handlers (`rcsbPanelActions`), whose returned elements the tests read and whose
 * handlers they call the way a browser would.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import appSrc from '../App.tsx?raw';
import modalSrc from '../components/DatabaseExplorerModal.tsx?raw';
import { RcsbExplorerPanel, RcsbExplorerView } from '../components/DatabaseExplorerModal';
import { parsePdbCaCoordinates } from '../core/genomicsAndStructureSuite';
import { RCSB_SEARCH_URL } from '../core/rcsbClient';
import {
  RCSB_MAX_IN_FLIGHT, RCSB_MAX_STARTS_PER_SECOND, RcsbExplorerSession, createLimiter, createStartGate, errorHeading,
  rcsbPanelActions, resetRcsbRequestBudget, type FileImportResult, type ImportFiles, type RcsbExplorerError,
  type RcsbPanelActions,
} from '../core/rcsbExplorer';
import type { MoleculeType, SequenceDocument } from '../types/bio';
import { dataPath, haveTestData } from './testData';

const nodeFs: string = 'node:fs';
const fs = await import(/* @vite-ignore */ nodeFs) as { readFileSync: (p: string, e: string) => string };
const read = (rel: string) => fs.readFileSync(dataPath(rel), 'utf8');

const ENTRY = 'rcsb/api/entry_4HHB.json';
const SEARCH = 'rcsb/api/search_full_text.json';
const CIF = 'rcsb/4HHB.cif';
/** SUMO-1 by solution NMR: ten models of one 103-residue chain. */
const NMR_CIF = 'rcsb/1A5R.cif';

type FetchFn = typeof globalThis.fetch;
const urlOf = (input: Parameters<FetchFn>[0]): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
const entryUrl = (id: string) => `https://data.rcsb.org/rest/v1/core/entry/${id}`;
const fileUrl = (id: string) => `https://files.rcsb.org/download/${id}.cif`;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const searchedFor = (init: RequestInit | undefined): string => JSON.parse(init!.body as string).query.parameters.value as string;

/** A Search API entry result set listing `ids` in rank order. */
const searchResponse = (ids: string[], totalCount = ids.length) => ({
  query_id: 'test', result_type: 'entry', total_count: totalCount,
  result_set: ids.map((identifier, i) => ({ identifier, score: 1 - i / 100 })),
});

/** A synthetic Data API entry object with the fields the summary reads. */
const entryObject = (id: string, title: string, methods: string[], resolution?: number[]) => ({
  rcsb_id: id,
  struct: { title },
  exptl: methods.map((method) => ({ method })),
  rcsb_entry_info: resolution ? { resolution_combined: resolution } : {},
  rcsb_accession_info: { initial_release_date: '2001-01-01T00:00:00+0000' },
  rcsb_entry_container_identifiers: { polymer_entity_ids: ['1'] },
});

/** Human ubiquitin (1UBQ). */
const UBQ = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';

function document(moleculeType: MoleculeType, sequence: string, name: string): SequenceDocument {
  return {
    id: `doc-${name}`, name, accession: '', description: '', moleculeType, topology: 'linear', sequence,
    features: [], primers: [], history: [], createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z',
    folder: 'Protein Documents',
  };
}

const imports = () => vi.fn<ImportFiles>(async (files: File[]): Promise<FileImportResult> => ({ imported: files.length, failed: [] }));

const panel = (session: RcsbExplorerSession, documents: SequenceDocument[] = [], onImportFiles?: ImportFiles) =>
  renderToStaticMarkup(<RcsbExplorerPanel session={session} documents={documents} onImportFiles={onImportFiles} />);
const ENTITIES: Record<string, string> = { '&quot;': '"', '&#x27;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
/** The text a reader sees: tags dropped, entities decoded, whitespace collapsed. */
const text = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&(quot|#x27|lt|gt|amp);/g, (e) => ENTITIES[e]).replace(/\s+/g, ' ').trim();

/** Each listed hit's id and markup, in the order shown. */
const rows = (html: string): Array<[string, string]> =>
  html.split('data-rcsb-entry="').slice(1).map((chunk) => [chunk.slice(0, chunk.indexOf('"')), chunk.slice(chunk.indexOf('>') + 1)]);

/** The text of the panel's error banner, or null when it shows none. */
function alertText(html: string): string | null {
  const at = html.indexOf('<div role="alert"');
  return at < 0 ? null : text(html.slice(at, html.indexOf('</div>', at)));
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

// --- The panel's elements, read without a DOM ----------------------------------------------------

type Element = React.ReactElement<Record<string, unknown>> & { ref?: unknown };

/** Every element `node` holds, depth first; a component's own output is not expanded. */
function elements(node: React.ReactNode): Element[] {
  const out: Element[] = [];
  const visit = (n: React.ReactNode) => {
    if (Array.isArray(n)) n.forEach(visit);
    else if (React.isValidElement(n)) {
      out.push(n as Element);
      visit((n.props as { children?: React.ReactNode }).children);
    }
  };
  visit(node);
  return out;
}

/** The one element that matches. */
function only(node: React.ReactNode, match: (e: Element) => boolean): Element {
  const found = elements(node).filter(match);
  expect(found, 'exactly one element matches').toHaveLength(1);
  return found[0];
}

const isForm = (e: Element) => e.type === 'form';
const isKeywords = (e: Element) => e.props['aria-label'] === 'RCSB PDB keywords';
const isMode = (e: Element) => e.props['aria-label'] === 'Search RCSB PDB by';
const isOpen = (id: string) => (e: Element) => e.type === 'button' && e.props.type === 'button' && e.props.value === id;

/** The panel as a browser would hold it: the view of the session's state, with the controller's handlers. */
const controls = (session: RcsbExplorerSession, documents: SequenceDocument[], actions: RcsbPanelActions) =>
  RcsbExplorerView({ state: session.getSnapshot(), documents, actions });

/** Each event handler on the panel's elements, as [element, prop, which controller function it is]. */
function handlers(node: React.ReactNode, actions: RcsbPanelActions): Array<[string, string, string]> {
  return elements(node).flatMap((e) => Object.entries(e.props)
    .filter(([prop, value]) => /^on[A-Z]/.test(prop) && typeof value === 'function')
    .map(([prop, value]): [string, string, string] => [
      typeof e.type === 'string' ? e.type : 'component', prop,
      Object.entries(actions).find(([, f]) => f === value)?.[0] ?? 'not the controller\'s',
    ]));
}

/** What a click on an Open button sends its handler: the button itself as the current target. */
const click = (button: Element) => (button.props.onClick as (e: unknown) => void)({ currentTarget: { value: button.props.value } });

// --- AC5 scenarios, run under fake timers by "caps concurrent RCSB requests" ---------------------

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const entryIds = (n: number, prefix = '1X') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);
const syntheticEntry = (url: string) => {
  const id = url.slice(url.lastIndexOf('/') + 1);
  return json(entryObject(id, `ENTRY ${id}`, ['X-RAY DIFFRACTION'], [2]));
};

/** The most starts in any one-second window [t, t + 1000 ms). */
const busiestSecond = (times: number[]) => Math.max(...times.map((t) => times.filter((u) => u >= t && u < t + 1000).length));

/** How many starts fell in each whole second, counted from the first start. */
function perSecond(times: number[]): number[] {
  const counts: number[] = [];
  for (const t of times) {
    const second = Math.floor((t - times[0]) / 1000);
    counts[second] = (counts[second] ?? 0) + 1;
  }
  return Array.from(counts, (c) => c ?? 0);
}

/** At most four requests run at once, Open included, and a failed request frees its slot. */
async function concurrencyCapped() {
  const ids = ['1A00', '1A01', '1A0U', '1A0Z', '1A3N', '2HHB', '3HHB', '4HHB', '1GZX', '2DN2'];
  const waiting: Array<() => void> = [];
  const started: string[] = [];
  let inFlight = 0;
  let peak = 0;
  let answered = 0;
  // Every request waits until the test answers it, so the requests the session has running pile up.
  const fetch = vi.fn<FetchFn>(async (input) => {
    const url = urlOf(input);
    started.push(url);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((resolve) => waiting.push(resolve));
    inFlight--;
    answered++;
    if (url === RCSB_SEARCH_URL) return json(searchResponse(ids, 359));
    if (url === fileUrl('4HHB')) return new Response('data_4HHB\n#\n');
    if (url === entryUrl('1A01')) return new Response('oops', { status: 500 }); // a failed request frees its slot too
    return syntheticEntry(url);
  });
  const session = new RcsbExplorerSession({ fetch });
  const importFiles = imports();
  session.setQuery('hemoglobin');
  const searched = session.search();
  await tick();
  expect(started).toEqual([RCSB_SEARCH_URL]);
  waiting.shift()!();
  await tick();

  // Ten hits: four summary requests run, six wait; opening an entry meanwhile waits for a slot too.
  expect(inFlight).toBe(4);
  const opened = session.open('4HHB', importFiles);
  await tick();
  expect(started).toHaveLength(5);
  expect(started).not.toContain(fileUrl('4HHB'));

  // Answer one at a time, advancing the clock a second each time so the start gate has let every
  // request it held through before the check: each answer frees one slot and the next waiting
  // request takes it.
  const total = 1 + ids.length + 1;
  while (waiting.length > 0) {
    waiting.shift()!();
    await tick(1000);
    expect(inFlight).toBe(Math.min(4, total - answered));
  }
  await Promise.all([searched, opened]);

  expect(peak).toBe(4);
  expect(started).toHaveLength(total);
  expect(started.filter((url) => url.startsWith('https://data.rcsb.org/')).sort()).toEqual(ids.map(entryUrl).sort());
  expect(started.at(-1)).toBe(fileUrl('4HHB'));
  // All ten completed: nine summaries listed, and the one RCSB refused shows its status.
  const hits = session.getSnapshot().hits;
  expect(hits.map((h) => h.id)).toEqual(ids);
  expect(hits.map((h) => h.summary.state)).toEqual(ids.map((id) => (id === '1A01' ? 'failed' : 'loaded')));
  expect(hits[1].summary).toMatchObject({ state: 'failed', error: { kind: 'http', status: 500 } });
  expect(importFiles).toHaveBeenCalledTimes(1);
}

/** Twenty requests that answer at once (a search, its ten summaries, nine Opens) start five a second. */
async function startRateCapped() {
  const hits = entryIds(10);
  const opens = entryIds(19).slice(10);
  const starts: number[] = [];
  const fetch = vi.fn<FetchFn>(async (input) => {
    starts.push(Date.now());
    const url = urlOf(input);
    if (url === RCSB_SEARCH_URL) return json(searchResponse(hits));
    if (url.startsWith('https://files.rcsb.org/')) return new Response('data_X\n#\n');
    return syntheticEntry(url);
  });
  const session = new RcsbExplorerSession({ fetch });
  const importFiles = imports();
  session.setQuery('hemoglobin');
  const done = Promise.all([session.search(), ...opens.map((id) => session.open(id, importFiles))]);
  await tick(10_000);
  await done;

  expect(starts).toHaveLength(20);
  expect(busiestSecond(starts)).toBe(5);
  // Five in each second, not fewer: the limit holds requests back only as long as it must.
  expect(perSecond(starts)).toEqual([5, 5, 5, 5]);
  // All twenty completed.
  expect(session.getSnapshot().hits.map((h) => h.summary.state)).toEqual(hits.map(() => 'loaded'));
  expect(importFiles).toHaveBeenCalledTimes(opens.length);
}

/** A 429 retry is a request too, so it counts against the five a second. */
async function retriesCountAsStarts() {
  const hits = entryIds(8);
  const limited = new Set(hits.slice(0, 4).map(entryUrl));
  const starts: number[] = [];
  const fetch = vi.fn<FetchFn>(async (input) => {
    starts.push(Date.now());
    const url = urlOf(input);
    if (url === RCSB_SEARCH_URL) return json(searchResponse(hits));
    if (limited.delete(url)) return new Response('slow down', { status: 429 }); // once each, then answered
    return syntheticEntry(url);
  });
  const session = new RcsbExplorerSession({ fetch });
  session.setQuery('hemoglobin');
  const searched = session.search();
  await tick(10_000);
  await searched;

  // The search and four summaries; a second later the four retries and one more summary; then the rest.
  expect(starts).toHaveLength(1 + hits.length + 4);
  expect(busiestSecond(starts)).toBe(5);
  expect(perSecond(starts)).toEqual([5, 5, 3]);
  expect(session.getSnapshot().hits.map((h) => h.summary.state)).toEqual(hits.map(() => 'loaded'));
}

/**
 * Two explorers searching at once (the modal closed and opened again, say) share the one budget:
 * together they never have more than four requests running or start more than five in a second.
 */
async function sharedAcrossSessions() {
  const hitsFor: Record<string, string[]> = { kinase: entryIds(10, '1K'), globin: entryIds(10, '2G') };
  const starts: number[] = [];
  const held: Array<() => void> = [];
  let hold = false;
  let inFlight = 0;
  let peak = 0;
  // A search answers at once; a summary too, unless `hold` keeps it running until the test answers it.
  const fetch = vi.fn<FetchFn>(async (input, init) => {
    const url = urlOf(input);
    starts.push(Date.now());
    inFlight++;
    peak = Math.max(peak, inFlight);
    if (hold && url !== RCSB_SEARCH_URL) await new Promise<void>((resolve) => held.push(resolve));
    inFlight--;
    return url === RCSB_SEARCH_URL ? json(searchResponse(hitsFor[searchedFor(init)])) : syntheticEntry(url);
  });
  const searchBoth = () => {
    const sessions = [new RcsbExplorerSession({ fetch }), new RcsbExplorerSession({ fetch })];
    sessions[0].setQuery('kinase');
    sessions[1].setQuery('globin');
    return { sessions, done: Promise.all(sessions.map((s) => s.search())) };
  };
  const listed = (sessions: RcsbExplorerSession[]) => sessions.map((s) => s.getSnapshot().hits.map((h) => [h.id, h.summary.state]));
  const allLoaded = [hitsFor.kinase.map((id) => [id, 'loaded']), hitsFor.globin.map((id) => [id, 'loaded'])];

  // Answered at once: together they start five requests a second, not five each.
  let { sessions, done } = searchBoth();
  await tick(10_000);
  await done;
  expect(starts).toHaveLength(2 + 20);
  expect(busiestSecond(starts)).toBe(5);
  expect(listed(sessions)).toEqual(allLoaded);

  // Held: together they have four requests running, not four each.
  resetRcsbRequestBudget();
  starts.length = 0;
  peak = 0;
  hold = true;
  ({ sessions, done } = searchBoth());
  await tick(10_000);
  expect(inFlight).toBe(4);
  while (held.length > 0) {
    held.shift()!();
    await tick(1000);
  }
  await done;
  expect(starts).toHaveLength(2 + 20);
  expect(peak).toBe(4);
  expect(listed(sessions)).toEqual(allLoaded);
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('a test reached the real fetch'); });
  // The budget is shared by every session in the app, so each test starts with an unused one.
  resetRcsbRequestBudget();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('RCSB PDB in the Database Explorer', () => {
  it.skipIf(!haveTestData(ENTRY, SEARCH))('lists RCSB search hits with title, method and resolution', async () => {
    const recorded = JSON.parse(read(SEARCH)) as ReturnType<typeof searchResponse>;
    // 4HHB is the recorded entry; the NMR and two-method entries are synthetic, to reach the other shapes.
    const nmr = entryObject('1D3Z', 'UBIQUITIN, SOLUTION STRUCTURE', ['SOLUTION NMR']);
    const joint = entryObject('5XNL', 'A JOINT X-RAY AND NEUTRON STRUCTURE', ['X-RAY DIFFRACTION', 'NEUTRON DIFFRACTION'], [1.9]);
    const hhbLate = deferred();
    const fetch = vi.fn<FetchFn>(async (input) => {
      const url = urlOf(input);
      if (url === RCSB_SEARCH_URL) return json({ ...recorded, result_set: searchResponse(['4HHB', '1D3Z', '5XNL']).result_set });
      if (url === entryUrl('4HHB')) { await hhbLate.promise; return new Response(read(ENTRY)); }
      if (url === entryUrl('1D3Z')) return json(nmr);
      if (url === entryUrl('5XNL')) return json(joint);
      throw new Error(`unexpected request ${url}`);
    });
    const session = new RcsbExplorerSession({ fetch });
    session.setQuery('hemoglobin');
    const searching = session.search();
    await flush();

    // Listed in rank order as soon as the search answers; 4HHB's summary is still on its way.
    expect(rows(panel(session)).map(([id]) => id)).toEqual(['4HHB', '1D3Z', '5XNL']);
    expect(text(rows(panel(session))[0][1])).toContain('Loading entry summary');
    hhbLate.resolve();
    await searching;

    // One Search API request for entries matching the keywords, then one Data API entry request per hit.
    const urls = fetch.mock.calls.map(([input]) => urlOf(input));
    expect(urls[0]).toBe(RCSB_SEARCH_URL);
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.query).toEqual({ type: 'terminal', service: 'full_text', parameters: { value: 'hemoglobin' } });
    expect(body.return_type).toBe('entry');
    expect(urls.slice(1).sort()).toEqual([entryUrl('1D3Z'), entryUrl('4HHB'), entryUrl('5XNL')]);

    const html = panel(session);
    expect(text(html)).toMatch(new RegExp(`Showing 3 of ${recorded.total_count.toLocaleString()} RCSB entries`));
    const listed = rows(html);
    // Still in rank order although 4HHB's summary arrived last, and each row carries its own entry.
    expect(listed.map(([id]) => id)).toEqual(['4HHB', '1D3Z', '5XNL']);
    const [hhb, ubq, both] = listed.map(([, row]) => text(row));
    expect(hhb).toContain('THE CRYSTAL STRUCTURE OF HUMAN DEOXYHAEMOGLOBIN AT 1.74 ANGSTROMS RESOLUTION');
    expect(hhb).toContain('X-RAY DIFFRACTION');
    expect(hhb).toContain('1.74 Å');
    expect(hhb).toContain('Released 1984-07-17');
    expect(ubq).toContain('UBIQUITIN, SOLUTION STRUCTURE');
    expect(ubq).toContain('SOLUTION NMR');
    expect(ubq).toContain('No resolution reported');
    expect(ubq).not.toContain('Å');
    expect(both).toContain('A JOINT X-RAY AND NEUTRON STRUCTURE');
    expect(both).toContain('X-RAY DIFFRACTION, NEUTRON DIFFRACTION');
    expect(both).toContain('1.90 Å');
    expect(session.getSnapshot().error).toBeNull();
  });

  it("searches with a protein document's sequence, dropping one trailing stop", async () => {
    const fetch = vi.fn<FetchFn>(async () => new Response(null, { status: 204 }));
    const docs = [document('Protein', `${UBQ}*`, 'ubq'), document('Protein', `${UBQ}**`, 'ubq2'), document('DNA', 'ACGT', 'insert')];
    const session = new RcsbExplorerSession({ fetch });
    expect(panel(session, docs)).toContain('Sequence of ubq');
    expect(panel(session, docs)).not.toContain('Sequence of insert');

    session.setSequenceDocument('doc-ubq');
    await session.search(docs);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.query.parameters).toMatchObject({ sequence_type: 'protein', value: UBQ });
    expect(body.return_type).toBe('entry');
    expect(session.getSnapshot()).toMatchObject({ error: null, totalCount: 0, hits: [] });

    // Only one stop is dropped; a second, a DNA document or a removed one is refused before any
    // request, and headed as a search that was never sent.
    const refused: Array<[string, RegExp]> = [
      ['doc-ubq2', /"\*" at position 77/],
      ['doc-insert', /"insert" holds DNA/],
      ['doc-gone', /no longer in the workspace/],
    ];
    for (const [id, message] of refused) {
      session.setSequenceDocument(id);
      await session.search(docs);
      expect(session.getSnapshot().error).toMatchObject({ kind: 'input', status: null, message: expect.stringMatching(message) });
      expect(alertText(panel(session, docs))).toMatch(new RegExp(`^Not sent to RCSB .*${message.source}`));
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.skipIf(!haveTestData(CIF))('opening an entry creates the same documents as importing its mmCIF', async () => {
    const cif = read(CIF);
    const fetch = vi.fn<FetchFn>(async (input) => {
      const url = urlOf(input);
      if (url === RCSB_SEARCH_URL) return json(searchResponse(['4HHB']));
      if (url === entryUrl('4HHB')) return json(entryObject('4HHB', 'HAEMOGLOBIN', ['X-RAY DIFFRACTION'], [1.74]));
      if (url === fileUrl('4HHB')) return new Response(cif);
      throw new Error(`unexpected request ${url}`);
    });
    const importFiles = imports();
    const session = new RcsbExplorerSession({ fetch });
    session.setQuery('4HHB');
    await session.search();
    fetch.mockClear();
    await session.open('4hhb', importFiles);

    // One download: the entry's mmCIF from files.rcsb.org, never FASTA from www.rcsb.org (BG-01M6PDXC).
    expect(fetch.mock.calls.map(([input]) => urlOf(input))).toEqual([fileUrl('4HHB')]);
    // The import is handed the file a user would open: the name and the bytes of test-data/rcsb/4HHB.cif.
    expect(importFiles).toHaveBeenCalledTimes(1);
    const [files] = importFiles.mock.calls[0];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe(CIF.slice(CIF.lastIndexOf('/') + 1));
    expect(await files[0].text()).toBe(cif);
    expect(session.getSnapshot()).toMatchObject({ error: null, opening: [], notice: 'Opened 4HHB.cif from RCSB PDB in the workspace.' });

    // Open is live only when the explorer is given the workbench's import, and the modal passes it on.
    const button = (html: string) => /<button[^>]*>/.exec(rows(html)[0][1])![0];
    expect(button(panel(session, [], importFiles))).not.toContain('disabled');
    expect(button(panel(session))).toContain('disabled=""');
    expect(modalSrc).toMatch(/<RcsbExplorerPanel[^>]*onImportFiles=\{onImportFiles\}/);

    // The workbench must hand the explorer the route the Import menu uses. That route builds a
    // structure's documents from the file's name and text alone, so the same file gives the same
    // documents (their ids and timestamps aside, which differ between any two imports of one file).
    expect(appSrc).toMatch(/const handleImportFile = [\s\S]{0,300}?importIncomingFilesBatch\(fileList, 'replace', 'imported'\)/);
    const element = /<DatabaseExplorerModal\b[\s\S]*?\/>/.exec(appSrc)?.[0] ?? '';
    expect(element, 'App.tsx passes the Database Explorer its file import as onImportFiles')
      .toMatch(/onImportFiles=\{\(files\) => importIncomingFilesBatch\(files, 'replace', 'imported'\)\}/);
    // 'replace' is the mode for .mbc session files only: the route hands it to nothing else, and a
    // structure's chains go to the workspace activation that adds them to the open session.
    const route = appSrc.slice(appSrc.indexOf('const processIncomingFile = async ('), appSrc.indexOf('const importIncomingFilesBatch = async ('));
    expect(route.match(/\bmbcMode\b/g)).toHaveLength(3);
    expect(route.match(/applyParsedMbcSession\(.*\bmbcMode\);/g)).toHaveLength(2);
    expect(route).toMatch(/lowerName\.endsWith\('\.cif'\)[\s\S]*?activateImportedDocumentsInWorkspace\(chainDocs\);/);
  });

  it('reports network failures in the explorer', async () => {
    // The search answered with an error status: shown with it, once, and nothing listed.
    let session = new RcsbExplorerSession({ fetch: vi.fn<FetchFn>(async () => new Response('down', { status: 503, statusText: 'Service Unavailable' })) });
    session.setQuery('kinase');
    await expect(session.search()).resolves.toBeUndefined();
    expect(session.getSnapshot()).toMatchObject({ searching: false, totalCount: null, hits: [], error: { kind: 'http', status: 503 } });
    expect(alertText(panel(session))).toBe(`RCSB answered HTTP 503 RCSB request to ${RCSB_SEARCH_URL} failed after 1 attempt.`);

    // Rate limited on every attempt: rcsbFetch backed off before each retry, then the 429 is shown.
    const delays: number[] = [];
    session = new RcsbExplorerSession({ fetch: vi.fn<FetchFn>(async () => new Response('slow down', { status: 429 })), sleep: async (ms) => { delays.push(ms); } });
    session.setQuery('kinase');
    await session.search();
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(alertText(panel(session))).toBe(`RCSB answered HTTP 429 (rate limited) RCSB request to ${RCSB_SEARCH_URL} failed after 4 attempts.`);

    // One hit's summary failed: its row says so with the status, the other row is listed in full.
    session = new RcsbExplorerSession({
      fetch: vi.fn<FetchFn>(async (input) => {
        const url = urlOf(input);
        if (url === RCSB_SEARCH_URL) return json(searchResponse(['4HHB', '1D3Z']));
        if (url === entryUrl('4HHB')) return new Response('oops', { status: 500 });
        return json(entryObject('1D3Z', 'UBIQUITIN, SOLUTION STRUCTURE', ['SOLUTION NMR']));
      }),
    });
    session.setQuery('globin');
    await session.search();
    const [hhb, ubq] = rows(panel(session)).map(([, row]) => text(row));
    expect(hhb).toContain(`Summary unavailable (RCSB answered HTTP 500): RCSB request to ${entryUrl('4HHB')} failed after 1 attempt.`);
    expect(ubq).toContain('SOLUTION NMR');
    expect(session.getSnapshot().error).toBeNull();

    // Opening: a failed download is shown and nothing reaches the import.
    const importFiles = imports();
    session = new RcsbExplorerSession({ fetch: vi.fn<FetchFn>(async () => new Response('missing', { status: 404, statusText: 'Not Found' })) });
    await expect(session.open('4HHB', importFiles)).resolves.toBeUndefined();
    expect(importFiles).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ opening: [], notice: null, error: { kind: 'http', status: 404 } });
    expect(alertText(panel(session))).toBe(`RCSB answered HTTP 404 RCSB request to ${fileUrl('4HHB')} failed after 1 attempt.`);

    // Offline: no HTTP answer at all, shown as such with the cause.
    session = new RcsbExplorerSession({ fetch: vi.fn<FetchFn>(async () => { throw new TypeError('Failed to fetch'); }) });
    await session.open('4HHB', importFiles);
    expect(session.getSnapshot().error).toMatchObject({ kind: 'network', status: null });
    expect(alertText(panel(session))).toBe(`No response from RCSB RCSB request to ${fileUrl('4HHB')} failed: Failed to fetch`);

    // RCSB answered 200 with something that is not a search result: an answer, not a network failure.
    session = new RcsbExplorerSession({ fetch: vi.fn<FetchFn>(async () => new Response('<html>maintenance</html>')) });
    session.setQuery('kinase');
    await session.search();
    expect(session.getSnapshot().error).toMatchObject({ kind: 'response', status: null });
    expect(alertText(panel(session))).toBe(`RCSB's answer could not be read RCSB returned a response that is not JSON from ${RCSB_SEARCH_URL}.`);

    // An empty keyword box is refused before any request, and headed as never sent.
    const unused = vi.fn<FetchFn>();
    session = new RcsbExplorerSession({ fetch: unused });
    session.setQuery('   ');
    await session.search();
    expect(unused).not.toHaveBeenCalled();
    expect(session.getSnapshot().error).toMatchObject({ kind: 'input', status: null });
    expect(alertText(panel(session))).toBe('Not sent to RCSB The search text is empty.');

    // The import refused the file RCSB sent with HTTP 200: its reason is shown, not a success and not a network failure.
    session = new RcsbExplorerSession({ fetch: vi.fn<FetchFn>(async () => new Response('data_4HHB\n#\n')) });
    const refusing = vi.fn<ImportFiles>(async () => ({ imported: 0, failed: [{ name: '4HHB.cif', message: '"4HHB.cif" has no protein Cα coordinates' }] }));
    await session.open('4HHB', refusing);
    expect(session.getSnapshot()).toMatchObject({ notice: null, error: { kind: 'import', status: null } });
    expect(alertText(panel(session))).toBe('RCSB sent the file but it could not be imported 4HHB.cif: "4HHB.cif" has no protein Cα coordinates');
    // ... and so is an import that threw.
    session = new RcsbExplorerSession({ fetch: vi.fn<FetchFn>(async () => new Response('data_4HHB\n#\n')) });
    await session.open('4HHB', async () => { throw new Error('the workspace is read-only'); });
    expect(session.getSnapshot().error).toMatchObject({ kind: 'import', status: null });
    expect(alertText(panel(session))).toBe('RCSB sent the file but it could not be imported 4HHB.cif: the workspace is read-only');

    // Each kind has its own heading, and only an HTTP error names a status.
    const heading = (kind: RcsbExplorerError['kind'], status: number | null = null) => errorHeading({ kind, status, message: '' });
    expect([heading('input'), heading('network'), heading('http', 503), heading('response'), heading('import')]).toEqual([
      'Not sent to RCSB', 'No response from RCSB', 'RCSB answered HTTP 503', "RCSB's answer could not be read",
      'RCSB sent the file but it could not be imported',
    ]);
  });

  it('makes no RCSB request until the user acts', async () => {
    const spy = vi.fn<FetchFn>(async (input) => {
      const url = urlOf(input);
      if (url === RCSB_SEARCH_URL) return json(searchResponse(['4HHB']));
      return url === entryUrl('4HHB') ? syntheticEntry(url) : new Response('data_4HHB\n#\n');
    });
    vi.stubGlobal('fetch', spy);
    vi.resetModules();

    // Import: loading the explorer and the modal afresh sends nothing.
    const explorer = await import('../core/rcsbExplorer');
    const modal = await import('../components/DatabaseExplorerModal');
    expect(spy).not.toHaveBeenCalled();

    // Mount: the modal opened on RCSB PDB renders its search form and sends nothing.
    const docs = [document('Protein', UBQ, 'ubq')];
    const noop = () => {};
    const html = renderToStaticMarkup(
      <modal.DatabaseExplorerModal initialCategory="rcsb-pdb" documents={docs} localDatabases={[]} onAddLocalDatabase={noop}
        onRemoveLocalDatabase={noop} onImportDocument={noop} onImportFiles={imports()} onOpenBlastModal={noop} onClose={noop} />,
    );
    expect(html).toContain('aria-label="RCSB PDB keywords"');
    expect(html).toContain('Sequence of ubq');
    // That render runs no effects and calls no refs, so the modal must have neither: nothing that
    // could send a request on mount.
    expect(modalSrc).not.toMatch(/\buse(Layout|Insertion)?Effect\b/);
    expect(modalSrc).not.toMatch(/\bref=|\buseRef\b|\bcreateRef\b|\buseImperativeHandle\b/);
    // The session the modal keeps is only handed to the panel: the modal calls none of its methods.
    expect(modalSrc.match(/\brcsbSession\b/g)).toHaveLength(2);
    expect(modalSrc).not.toMatch(/\.(search|open|setQuery|setSequenceDocument)\(/);
    expect(spy).not.toHaveBeenCalled();

    // Typing: each keystroke in the keyword box, and choosing what to search by, through the
    // panel's own controls, changes only what is shown.
    const session = new explorer.RcsbExplorerSession();
    const actions = explorer.rcsbPanelActions(session, docs, imports());
    const view = () => modal.RcsbExplorerView({ state: session.getSnapshot(), documents: docs, actions });
    const type = (value: string) => (only(view(), isKeywords).props.onChange as (e: unknown) => void)({ target: { value } });
    const choose = (value: string) => (only(view(), isMode).props.onChange as (e: unknown) => void)({ target: { value } });
    const words = 'hemoglobin';
    for (let i = 1; i <= words.length; i++) type(words.slice(0, i));
    choose('doc-ubq');
    choose('');
    await flush();
    expect(session.getSnapshot()).toMatchObject({ query: 'hemoglobin', sequenceDocumentId: null, searching: false, hits: [] });
    expect(renderToStaticMarkup(<modal.RcsbExplorerPanel session={session} documents={docs} />)).toContain('value="hemoglobin"');
    expect(spy).not.toHaveBeenCalled();

    // Acting: submitting the form sends the search (and then its hit's summary), and the hit's
    // Open button one more request, all through the global fetch.
    (only(view(), isForm).props.onSubmit as (e: unknown) => void)({ preventDefault: noop });
    await flush();
    expect(spy.mock.calls.map(([input]) => urlOf(input))).toEqual([RCSB_SEARCH_URL, entryUrl('4HHB')]);
    click(only(view(), isOpen('4HHB')));
    await flush();
    expect(spy.mock.calls.map(([input]) => urlOf(input))).toEqual([RCSB_SEARCH_URL, entryUrl('4HHB'), fileUrl('4HHB')]);
  });

  it('caps concurrent RCSB requests', async () => {
    expect(RCSB_MAX_IN_FLIGHT).toBe(4);
    expect(RCSB_MAX_STARTS_PER_SECOND).toBe(5);
    // The clock and the waits are fake, so the start-rate limit is measured, not slept through.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      for (const scenario of [concurrencyCapped, startRateCapped, retriesCountAsStarts, sharedAcrossSessions]) {
        resetRcsbRequestBudget();
        await scenario();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the results of a search a newer one replaced', async () => {
    const firstAnswer = deferred();
    const fetch = vi.fn<FetchFn>(async (input, init) => {
      const url = urlOf(input);
      if (url === RCSB_SEARCH_URL) {
        if (searchedFor(init) === 'old') { await firstAnswer.promise; return json(searchResponse(['1A00'])); }
        return json(searchResponse(['4HHB']));
      }
      const id = url.slice(url.lastIndexOf('/') + 1);
      return json(entryObject(id, `ENTRY ${id}`, ['X-RAY DIFFRACTION'], [2]));
    });
    const session = new RcsbExplorerSession({ fetch });
    session.setQuery('old');
    const older = session.search();
    await flush();
    session.setQuery('new');
    await session.search();
    firstAnswer.resolve();
    await older;
    expect(session.getSnapshot().hits.map((h) => [h.id, h.summary.state])).toEqual([['4HHB', 'loaded']]);
    expect(fetch.mock.calls.map(([input]) => urlOf(input))).not.toContain(entryUrl('1A00'));
  });

  it("keeps a replaced search's late summary off the new search's rows", async () => {
    const oldSummary = deferred();
    // This fetch ignores the abort signal, so the old entry's summary still arrives after the new
    // search has listed and summarised its own hit: only the session's own check keeps it off the
    // new rows. (With a fetch that honours the abort, "cancels a replaced search's requests" checks
    // that the aborted summaries' failures write no row either.)
    const fetch = vi.fn<FetchFn>(async (input, init) => {
      const url = urlOf(input);
      if (url === RCSB_SEARCH_URL) return json(searchResponse([searchedFor(init) === 'old' ? '1OLD' : '2NEW']));
      if (url === entryUrl('1OLD')) { await oldSummary.promise; return json(entryObject('1OLD', 'THE OLD ENTRY', ['SOLUTION NMR'])); }
      return json(entryObject('2NEW', 'THE NEW ENTRY', ['X-RAY DIFFRACTION'], [2.5]));
    });
    const session = new RcsbExplorerSession({ fetch });
    session.setQuery('old');
    const older = session.search();
    await flush();
    expect(session.getSnapshot().hits.map((h) => [h.id, h.summary.state])).toEqual([['1OLD', 'loading']]);
    session.setQuery('new');
    await session.search();
    expect(session.getSnapshot().hits.map((h) => [h.id, h.summary.state])).toEqual([['2NEW', 'loaded']]);

    oldSummary.resolve();
    await older;
    await flush();
    expect(fetch.mock.calls.map(([input]) => urlOf(input))).toContain(entryUrl('1OLD'));
    const [hit] = session.getSnapshot().hits;
    expect(hit).toMatchObject({ id: '2NEW', summary: { state: 'loaded', summary: { id: '2NEW', title: 'THE NEW ENTRY' } } });
    const [[id, row]] = rows(panel(session));
    expect(id).toBe('2NEW');
    expect(text(row)).toContain('THE NEW ENTRY');
    expect(text(row)).not.toContain('THE OLD ENTRY');
  });

  it("cancels a replaced search's requests", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const hitsFor: Record<string, string[]> = { first: entryIds(10, '1A'), second: entryIds(10, '2B'), third: entryIds(10, '3C') };
      const started: Array<{ url: string; at: number; searched?: string }> = [];
      const aborted: string[] = [];
      const t0 = Date.now();
      // A search answers at once; a summary after 300 ms, unless its request is aborted first, as a browser's fetch is.
      const fetch = vi.fn<FetchFn>(async (input, init) => {
        const url = urlOf(input);
        if (url === RCSB_SEARCH_URL) {
          started.push({ url, at: Date.now() - t0, searched: searchedFor(init) });
          return json(searchResponse(hitsFor[searchedFor(init)]));
        }
        started.push({ url, at: Date.now() - t0 });
        await new Promise<void>((resolve, reject) => {
          const answer = setTimeout(resolve, 300);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(answer);
            aborted.push(url);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
        return syntheticEntry(url);
      });
      const session = new RcsbExplorerSession({ fetch });
      const summaries = (prefix: string) => started.filter(({ url }) => url.startsWith(entryUrl(prefix)));

      // The first search lists ten hits: four summaries start (five starts fill the second), six wait.
      session.setQuery('first');
      const first = session.search();
      await tick();
      expect(summaries('1A')).toHaveLength(4);

      // The second search replaces it at once: the four running summaries are aborted and the six
      // waiting ones never start. Its own search waits for the next second's starts.
      session.setQuery('second');
      const second = session.search();
      await tick();
      expect(aborted.sort()).toEqual(summaries('1A').map(({ url }) => url).sort());
      // The aborted summaries' failures belong to the replaced search: no row is written for them.
      expect(session.getSnapshot()).toMatchObject({ searching: true, hits: [], error: null });
      // The third replaces the second while the second's search is still waiting to start: it never starts.
      await tick(500);
      session.setQuery('third');
      const third = session.search();
      await tick(10_000);
      await Promise.all([first, second, third]);

      expect(started.filter(({ searched }) => searched).map(({ searched, at }) => [searched, at])).toEqual([['first', 0], ['third', 1000]]);
      expect(summaries('1A')).toHaveLength(4);
      expect(summaries('2B')).toHaveLength(0);
      expect(summaries('3C')).toHaveLength(10);
      expect(aborted.filter((url) => !url.startsWith(entryUrl('1A')))).toEqual([]);
      expect(started).toHaveLength(2 + 4 + 10);
      expect(session.getSnapshot().hits.map((h) => [h.id, h.summary.state])).toEqual(hitsFor.third.map((id) => [id, 'loaded']));
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a request whose search was replaced from the queue and the start gate', async () => {
    // The limiter: a waiting task whose signal aborts is dropped at once and never runs; a running
    // one gives its slot up at once, so the next task need not wait for it to wind down.
    /** Whether a promise has been fulfilled or rejected yet, read without waiting for it. */
    const outcome = (p: Promise<unknown>) => {
      const seen = { state: 'pending' };
      p.then(() => { seen.state = 'fulfilled'; }, () => { seen.state = 'rejected'; });
      return seen;
    };
    const limit = createLimiter(1);
    const ran: string[] = [];
    const holder = deferred();
    void limit(async () => { ran.push('holder'); await holder.promise; });
    const replaced = new AbortController();
    const stale = outcome(limit(async () => { ran.push('stale'); }, replaced.signal));
    void limit(async () => { ran.push('next'); });
    replaced.abort();
    await flush();
    expect(stale.state).toBe('rejected');
    holder.resolve();
    await flush();
    expect(ran).toEqual(['holder', 'next']);

    const stuck = new AbortController();
    void limit(() => new Promise<void>(() => {}), stuck.signal).catch(() => {});
    const after = outcome(limit(async () => 'after'));
    await flush();
    expect(after.state).toBe('pending');
    stuck.abort();
    await flush();
    expect(after.state).toBe('fulfilled');
    const late = outcome(limit(async () => { ran.push('late'); }, stuck.signal));
    await flush();
    expect(late.state).toBe('rejected');
    // A running and a waiting task of one search: the abort frees the running one's slot first, and
    // the waiting one, handed that slot by the same abort, passes it on instead of running.
    const search = new AbortController();
    void limit(() => new Promise<void>(() => {}), search.signal).catch(() => {});
    await flush();
    const sameSearch = outcome(limit(async () => { ran.push('same search'); }, search.signal));
    search.abort();
    await flush();
    expect(sameSearch.state).toBe('rejected');
    const free = outcome(limit(async () => { ran.push('free'); }));
    await flush();
    expect(free.state).toBe('fulfilled');
    expect(ran).toEqual(['holder', 'next', 'free']);

    // The start gate: a waiting start whose signal aborts is dropped at once and uses no start, so
    // the start behind it is not held back.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const gate = createStartGate(1, 1000);
      const t0 = Date.now();
      const admitted: number[] = [];
      const admit = (signal?: AbortSignal) => outcome(gate(signal).then(() => { admitted.push(Date.now() - t0); }));
      admit();
      await tick();
      const waiting = new AbortController();
      const dropped = admit(waiting.signal);
      admit();
      waiting.abort();
      await tick();
      expect(dropped.state).toBe('rejected');
      await tick(1000);
      expect(admitted).toEqual([0, 1000]);
      // ... and a start already aborted is refused without waiting or using a start.
      const refused = admit(waiting.signal);
      admit();
      await tick();
      expect(refused.state).toBe('rejected');
      await tick(1000);
      expect(admitted).toEqual([0, 1000, 2000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs every panel control through its controller', async () => {
    const file = deferred();
    const fetch = vi.fn<FetchFn>(async (input, init) => {
      const url = urlOf(input);
      if (url === RCSB_SEARCH_URL) return json(searchResponse(searchedFor(init) === 'kinase' ? ['4HHB', '1D3Z'] : []));
      if (url.startsWith('https://files.rcsb.org/')) { await file.promise; return new Response(`data_${url.slice(-8, -4)}\n#\n`); }
      return syntheticEntry(url);
    });
    const docs = [document('Protein', UBQ, 'ubq')];
    const session = new RcsbExplorerSession({ fetch });
    const importFiles = imports();
    const actions = rcsbPanelActions(session, docs, importFiles);
    const view = () => controls(session, docs, actions);

    // Every handler on the panel is the controller's own function, there are no others, and no
    // element carries a ref (a ref callback runs on mount).
    expect(handlers(view(), actions)).toEqual([
      ['form', 'onSubmit', 'onSubmit'], ['select', 'onChange', 'onModeChange'], ['input', 'onChange', 'onQueryChange'],
    ]);
    expect(elements(view()).filter((e) => e.ref != null || e.props.ref != null)).toEqual([]);

    // Typing fetches nothing; submitting searches exactly once, with the query as it stands.
    for (const value of ['k', 'kin', 'kinase']) (only(view(), isKeywords).props.onChange as (e: unknown) => void)({ target: { value } });
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ query: 'kinase', searching: false });
    const preventDefault = vi.fn();
    (only(view(), isForm).props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await flush();
    const searches = fetch.mock.calls.filter(([input]) => urlOf(input) === RCSB_SEARCH_URL);
    expect(searches.map(([, init]) => searchedFor(init))).toEqual(['kinase']);
    expect(fetch).toHaveBeenCalledTimes(1 + 2);

    // Each listed hit has an Open button whose handler is the controller's and whose value is its entry.
    expect(handlers(view(), actions)).toEqual([
      ['form', 'onSubmit', 'onSubmit'], ['select', 'onChange', 'onModeChange'], ['input', 'onChange', 'onQueryChange'],
      ['button', 'onClick', 'onOpen'], ['button', 'onClick', 'onOpen'],
    ]);

    // Open on the second row downloads that entry's mmCIF, and only it; while it downloads the row's
    // button is disabled, and a second click on it sends nothing more.
    fetch.mockClear();
    click(only(view(), isOpen('1D3Z')));
    await flush();
    expect(fetch.mock.calls.map(([input]) => urlOf(input))).toEqual([fileUrl('1D3Z')]);
    expect(only(view(), isOpen('1D3Z')).props.disabled).toBe(true);
    expect(only(view(), isOpen('4HHB')).props.disabled).toBe(false);
    click(only(view(), isOpen('1D3Z')));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    file.resolve();
    await flush();
    await flush();
    expect(importFiles).toHaveBeenCalledTimes(1);
    expect(importFiles.mock.calls[0][0].map((f) => f.name)).toEqual(['1D3Z.cif']);
    expect(session.getSnapshot()).toMatchObject({ opening: [], error: null, notice: 'Opened 1D3Z.cif from RCSB PDB in the workspace.' });

    // Choosing a protein document to search by disables the keyword box, and the next submit
    // searches with that document's sequence; choosing Keywords again goes back to the query.
    fetch.mockClear();
    const choose = (value: string) => (only(view(), isMode).props.onChange as (e: unknown) => void)({ target: { value } });
    choose('doc-ubq');
    expect(session.getSnapshot().sequenceDocumentId).toBe('doc-ubq');
    expect(only(view(), isKeywords).props.disabled).toBe(true);
    (only(view(), isForm).props.onSubmit as (e: unknown) => void)({ preventDefault });
    await flush();
    expect(fetch.mock.calls.map(([, init]) => searchedFor(init))).toEqual([UBQ]);
    choose('');
    expect(session.getSnapshot()).toMatchObject({ sequenceDocumentId: null, query: 'kinase' });
    expect(only(view(), isKeywords).props.disabled).toBe(false);

    // Without the workbench's import, Open is disabled and a click on it sends nothing.
    session.setQuery('kinase');
    await session.search(docs);
    fetch.mockClear();
    const bare = rcsbPanelActions(session, docs);
    const button = only(controls(session, docs, bare), isOpen('4HHB'));
    expect(button.props.disabled).toBe(true);
    click(button);
    await flush();
    expect(fetch).not.toHaveBeenCalled();

    // The panel the modal mounts is that view, given the session's state and the controller's
    // handlers, and nothing else.
    const start = modalSrc.indexOf('export const RcsbExplorerPanel');
    const wrapper = modalSrc.slice(start, modalSrc.indexOf('\n};\n', start) + 3).replace(/\s+/g, ' ');
    expect(wrapper).toBe(
      'export const RcsbExplorerPanel: React.FC<RcsbExplorerPanelProps> = ({ session, documents, onImportFiles }) => { '
      + 'const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot); '
      + 'return <RcsbExplorerView state={state} documents={documents} actions={rcsbPanelActions(session, documents, onImportFiles)} />; };',
    );
  });

  it.skipIf(!haveTestData(NMR_CIF))("opens an NMR entry as its first model's chain", () => {
    // The file holds ten models of chain A's 103 residues: reading every model would give 1030.
    const cif = read(NMR_CIF);
    const models = new Map<string, number>();
    for (const line of cif.split('\n')) {
      const f = line.trim().split(/\s+/);
      if (f[0] === 'ATOM' && f[3] === 'CA') models.set(f[20], (models.get(f[20]) ?? 0) + 1);
    }
    expect([...models.values()]).toEqual(Array(10).fill(103));

    // Opening an entry hands its .cif to the route that reads C-alpha atoms with this engine call and
    // makes one document per chain id; for an NMR ensemble that is the first model's chain alone.
    const route = appSrc.slice(appSrc.indexOf('const processIncomingFile = async ('), appSrc.indexOf('const importIncomingFilesBatch = async ('));
    expect(route).toMatch(/lowerName\.endsWith\('\.cif'\)[\s\S]{0,80}?\) \{\s*const caAtoms = parsePdbCaCoordinates\(text\);/);
    expect(route).toMatch(/const chainIds = \[\.\.\.new Set\(caAtoms\.map\(\(a\) => a\.chainId \|\| 'A'\)\)\];/);
    const chains = new Map<string, number>();
    for (const atom of parsePdbCaCoordinates(cif)) chains.set(atom.chainId || 'A', (chains.get(atom.chainId || 'A') ?? 0) + 1);
    expect([...chains]).toEqual([['A', 103]]);
  });
});
