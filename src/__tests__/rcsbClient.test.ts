// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The RCSB PDB client (D0008): URL builders, the 429-retrying transport and the entry summary.
 * No test touches the network: before each test the global `fetch` is replaced by one that throws,
 * and every request goes to a stub; the summary and download tests serve the recorded files in
 * test-data/rcsb.
 *
 * The Search API unit (US-01M6PBT2) is to send through the same `rcsbFetch`; the transport tests
 * below (retry, host guard, POST passed through, 204 handed back) are the contract it must not regress.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RCSB_HOSTS, RcsbHttpError, assemblyDataUrl, assemblyFileUrl, chainFastaUrl, chemCompDataUrl, entityFastaUrl,
  entryDataUrl, entryFastaUrl, entryFileUrl, fetchEntrySummary, ligandFileUrl, normalizeEntryId,
  polymerEntityDataUrl, polymerEntityInstanceDataUrl, rcsbFetch, rcsbJson, rcsbText, summarizeEntry,
} from '../core/rcsbClient';
import { dataPath, haveTestData } from './testData';

const nodeFs: string = 'node:fs';
const fs = await import(/* @vite-ignore */ nodeFs) as { readFileSync: (p: string | URL, e: string) => string };

type FetchFn = typeof globalThis.fetch;
const urlOf = (input: Parameters<FetchFn>[0]): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/** A fetch stub that answers each URL in `routes` with its recorded file, anything else with 404. */
function recordedFetch(routes: Record<string, string>) {
  return vi.fn<FetchFn>(async (input) => {
    const rel = routes[urlOf(input)];
    return rel ? new Response(fs.readFileSync(dataPath(rel), 'utf8')) : new Response('not found', { status: 404 });
  });
}

/** A fetch stub that answers the queued responses in order. */
function queuedFetch(...responses: Array<() => Response>) {
  let i = 0;
  return vi.fn<FetchFn>(async () => {
    if (i >= responses.length) throw new Error('stub fetch called more often than expected');
    return responses[i++]();
  });
}

const tooMany = (headers?: Record<string, string>) => () => new Response('slow down', { status: 429, headers });
const ok = (body: string) => () => new Response(body, { status: 200 });

/** A sleep stub that records each delay and returns at once. */
function recordingSleep() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => { delays.push(ms); } };
}

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('a test reached the real fetch'); }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('RCSB PDB client', () => {
  it('builds RCSB download and Data API URLs', () => {
    expect(entryFileUrl('4hhb', 'cif')).toBe('https://files.rcsb.org/download/4HHB.cif');
    expect(entryFileUrl('4HHB', 'pdb')).toBe('https://files.rcsb.org/download/4HHB.pdb');
    expect(entryFileUrl('1crn')).toBe('https://files.rcsb.org/download/1CRN.cif');
    expect(assemblyFileUrl('4hhb', 1)).toBe('https://files.rcsb.org/download/4HHB-assembly1.cif');
    expect(assemblyFileUrl('6vxx', '2')).toBe('https://files.rcsb.org/download/6VXX-assembly2.cif');
    expect(entryFastaUrl('4hhb')).toBe('https://www.rcsb.org/fasta/entry/4HHB/download');
    expect(entityFastaUrl('4hhb', 1)).toBe('https://www.rcsb.org/fasta/entity/4HHB_1/download');
    expect(chainFastaUrl('4hhb', 'A')).toBe('https://www.rcsb.org/fasta/chain/4HHB.A/download');
    expect(chainFastaUrl('4v6x', 'Ab')).toBe('https://www.rcsb.org/fasta/chain/4V6X.Ab/download');
    expect(ligandFileUrl('hem', 'sdf')).toBe('https://files.rcsb.org/ligands/download/HEM_ideal.sdf');
    expect(ligandFileUrl('HEM', 'cif')).toBe('https://files.rcsb.org/ligands/download/HEM.cif');
    expect(ligandFileUrl('atp')).toBe('https://files.rcsb.org/ligands/download/ATP_ideal.sdf');
    expect(entryDataUrl('4hhb')).toBe('https://data.rcsb.org/rest/v1/core/entry/4HHB');
    expect(polymerEntityDataUrl('4hhb', 1)).toBe('https://data.rcsb.org/rest/v1/core/polymer_entity/4HHB/1');
    expect(polymerEntityInstanceDataUrl('4hhb', 'A')).toBe('https://data.rcsb.org/rest/v1/core/polymer_entity_instance/4HHB/A');
    expect(assemblyDataUrl('4hhb', 1)).toBe('https://data.rcsb.org/rest/v1/core/assembly/4HHB/1');
    expect(chemCompDataUrl('hem')).toBe('https://data.rcsb.org/rest/v1/core/chemcomp/HEM');
  });

  const ENTRY = 'rcsb/api/entry_4HHB.json';
  it.skipIf(!haveTestData(ENTRY))('summarises the recorded 4HHB entry', async () => {
    const expected = {
      id: '4HHB',
      title: 'THE CRYSTAL STRUCTURE OF HUMAN DEOXYHAEMOGLOBIN AT 1.74 ANGSTROMS RESOLUTION',
      methods: ['X-RAY DIFFRACTION'],
      resolution: [1.74],
      releaseDate: '1984-07-17',
      polymerEntityIds: ['1', '2'],
    };
    const recorded = JSON.parse(fs.readFileSync(dataPath(ENTRY), 'utf8')) as Record<string, Record<string, unknown>>;
    expect(summarizeEntry(recorded)).toEqual(expected);
    // The same entry with its title and polymer entities edited: the summary follows the payload.
    const edited = { ...recorded, struct: { title: 'EDITED' }, rcsb_entry_container_identifiers: { ...recorded.rcsb_entry_container_identifiers, polymer_entity_ids: ['2'] } };
    expect(summarizeEntry(edited)).toEqual({ ...expected, title: 'EDITED', polymerEntityIds: ['2'] });

    const fetch = recordedFetch({ 'https://data.rcsb.org/rest/v1/core/entry/4HHB': ENTRY });
    expect(await fetchEntrySummary('4hhb', { fetch })).toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(urlOf(fetch.mock.calls[0][0])).toBe('https://data.rcsb.org/rest/v1/core/entry/4HHB');
  });

  it('summarises an entry without a resolution, and refuses a payload that is not an entry', () => {
    const nmr = {
      rcsb_id: '1D3Z', struct: { title: 'UBIQUITIN NMR STRUCTURE' }, exptl: [{ method: 'SOLUTION NMR' }],
      rcsb_entry_info: {}, rcsb_accession_info: { initial_release_date: '1999-11-01T00:00:00.000+00:00' },
      rcsb_entry_container_identifiers: { polymer_entity_ids: ['1'] },
    };
    expect(summarizeEntry(nmr)).toEqual({
      id: '1D3Z', title: 'UBIQUITIN NMR STRUCTURE', methods: ['SOLUTION NMR'], resolution: [],
      releaseDate: '1999-11-01', polymerEntityIds: ['1'],
    });
    const empty = { id: '9ABC', title: null, methods: [], resolution: [], releaseDate: null, polymerEntityIds: [] };
    expect(summarizeEntry({ rcsb_id: '9ABC' })).toEqual(empty);
    expect(summarizeEntry({ rcsb_id: '9ABC', struct: null, exptl: null, rcsb_entry_info: { resolution_combined: null } })).toEqual(empty);
    expect(() => summarizeEntry(null)).toThrow(/not a JSON object/);
    expect(() => summarizeEntry([])).toThrow(/not a JSON object/);
    expect(() => summarizeEntry({ struct: { title: 'no id' } })).toThrow(/rcsb_id/);
    expect(() => summarizeEntry({ rcsb_id: '9ABC', rcsb_entry_info: { resolution_combined: '1.74' } })).toThrow(/resolution_combined/);
    expect(() => summarizeEntry({ rcsb_id: '9ABC', exptl: [{ method: 7 }] })).toThrow(/exptl/);
    expect(() => summarizeEntry({ rcsb_id: '9ABC', rcsb_accession_info: { initial_release_date: 'July 1984' } })).toThrow(/initial_release_date/);
  });

  it('retries rate-limited requests with exponential backoff', async () => {
    const url = 'https://files.rcsb.org/download/4HHB.cif';

    // Rate limited three times, then served: three waits, each twice the last.
    const recovering = queuedFetch(tooMany(), tooMany(), tooMany(), ok('data_4HHB\n'));
    const waited = recordingSleep();
    expect(await rcsbText(entryFileUrl('4hhb'), { fetch: recovering, sleep: waited.sleep, baseDelayMs: 10 })).toBe('data_4HHB\n');
    expect(waited.delays).toEqual([10, 20, 40]);
    expect(recovering).toHaveBeenCalledTimes(4);
    recovering.mock.calls.forEach(([input]) => expect(urlOf(input)).toBe(url));

    // Rate limited on every attempt: 1 + 3 retries, no wait after the last, then an error naming URL and status.
    const exhausted = queuedFetch(tooMany(), tooMany(), tooMany(), tooMany());
    const gaveUp = recordingSleep();
    const error = await rcsbText(url, { fetch: exhausted, sleep: gaveUp.sleep, baseDelayMs: 10 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RcsbHttpError);
    expect(error).toMatchObject({ url, status: 429, attempts: 4 });
    expect((error as Error).message).toContain(url);
    expect((error as Error).message).toContain('HTTP 429');
    expect((error as Error).message).toContain('after 4 attempts');
    expect(exhausted).toHaveBeenCalledTimes(4);
    expect(gaveUp.delays).toEqual([10, 20, 40]);

    // The retry count is the caller's: one retry is two attempts.
    const once = queuedFetch(tooMany(), tooMany());
    const short = recordingSleep();
    await expect(rcsbText(url, { fetch: once, sleep: short.sleep, baseDelayMs: 5, retries: 1 })).rejects.toMatchObject({ status: 429, attempts: 2 });
    expect(short.delays).toEqual([5]);

    // By default the first wait is one second.
    const defaults = recordingSleep();
    await rcsbText(url, { fetch: queuedFetch(tooMany(), tooMany(), ok('x')), sleep: defaults.sleep });
    expect(defaults.delays).toEqual([1000, 2000]);
  });

  it('waits as long as Retry-After asks, in seconds or as an HTTP date', async () => {
    const url = entryDataUrl('4hhb');
    const seconds = recordingSleep();
    const inSeconds = queuedFetch(tooMany({ 'Retry-After': '2' }), tooMany(), ok('{"rcsb_id":"4HHB"}'));
    expect(await rcsbJson(url, { fetch: inSeconds, sleep: seconds.sleep, baseDelayMs: 10 })).toEqual({ rcsb_id: '4HHB' });
    expect(seconds.delays).toEqual([2000, 20]);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    const date = recordingSleep();
    const atDate = queuedFetch(tooMany({ 'Retry-After': 'Fri, 06 Nov 2026 12:00:07 GMT' }), ok('{}'));
    await rcsbJson(url, { fetch: atDate, sleep: date.sleep, baseDelayMs: 10 });
    expect(date.delays).toEqual([7000]);

    const past = recordingSleep();
    const inThePast = queuedFetch(tooMany({ 'Retry-After': 'Fri, 06 Nov 2026 11:00:00 GMT' }), ok('{}'));
    await rcsbJson(url, { fetch: inThePast, sleep: past.sleep, baseDelayMs: 10 });
    expect(past.delays).toEqual([0]);

    const garbled = recordingSleep();
    const unreadable = queuedFetch(tooMany({ 'Retry-After': 'soon' }), ok('{}'));
    await rcsbJson(url, { fetch: unreadable, sleep: garbled.sleep, baseDelayMs: 10 });
    expect(garbled.delays).toEqual([10]);
  });

  it('reports other HTTP errors, network failures and unusable bodies at once, naming the URL', async () => {
    const url = entryFileUrl('9zzz', 'pdb');
    const sleep = vi.fn(async () => {});

    const missing = queuedFetch(() => new Response('', { status: 404, statusText: 'Not Found' }));
    const notFound = await rcsbText(url, { fetch: missing, sleep }).catch((e: unknown) => e);
    expect(notFound).toBeInstanceOf(RcsbHttpError);
    expect(notFound).toMatchObject({ url, status: 404, attempts: 1 });
    expect((notFound as Error).message).toContain(url);
    expect((notFound as Error).message).toContain('HTTP 404');
    expect(missing).toHaveBeenCalledTimes(1);

    const down = queuedFetch(() => new Response('', { status: 503 }));
    await expect(rcsbText(url, { fetch: down, sleep })).rejects.toMatchObject({ status: 503, attempts: 1 });
    expect(down).toHaveBeenCalledTimes(1);

    const offline = vi.fn<FetchFn>(async () => { throw new TypeError('Failed to fetch'); });
    await expect(rcsbText(url, { fetch: offline, sleep })).rejects.toThrow(`RCSB request to ${url} failed: Failed to fetch`);
    expect(offline).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();

    await expect(rcsbText(url, { fetch: queuedFetch(ok('  \n')) })).rejects.toThrow(`RCSB returned an empty response from ${url}`);
    await expect(rcsbJson(url, { fetch: queuedFetch(ok('<html>')) })).rejects.toThrow(`RCSB returned a response that is not JSON from ${url}`);
  });

  it('rejects malformed entry ids before fetching', async () => {
    const fetch = vi.fn<FetchFn>(async () => new Response('should not be fetched'));
    const malformed = [
      '', '   ', '4HH', '4HHBB', 'HHHB', 'A4HB', '4HH-', '4HH/', '../4', '4HH%', '4 HB', '4hhb.cif', '0ABC', '0000', 'pdb_00004hhb', 'PDB_00004HHB',
      // A well-formed id with junk in front: only the start anchor refuses these.
      '14HHB', 'x4hhb', '04HHB', '../4HHB', '/4HHB', '%4HHB', '_4HHB', 'x 4HHB', 'pdb_4HHB',
      // A well-formed id with junk behind: only the end anchor refuses these.
      '4HHB1', '4HHB/x', '4HHB?', '4HHB#', '4HHB_1', '4HHB.A', '4HHB x', '4HHB/../1CRN',
    ];
    for (const id of malformed) {
      expect(() => normalizeEntryId(id), id).toThrow(/PDB entry id/);
      expect(() => entryFileUrl(id), id).toThrow(/PDB entry id/);
      expect(() => chainFastaUrl(id, 'A'), id).toThrow(/PDB entry id/);
      await expect(fetchEntrySummary(id, { fetch }), id).rejects.toThrow(/PDB entry id/);
    }
    expect(() => normalizeEntryId('pdb_00004hhb')).toThrow(/Extended PDB entry id .* is not supported/);
    expect(fetch).not.toHaveBeenCalled();

    // Well-formed ids are accepted in any case and used upper-case. Whitespace around the id is not
    // malformed: it is trimmed (a pasted ' 4HHB' works); whitespace inside it is ('4 HB', '4HHB x').
    expect(['4hhb', '4HHB', ' 1crn\n', '6VxX', '1a5r', ' 4HHB', '4hhb\t'].map(normalizeEntryId)).toEqual(['4HHB', '4HHB', '1CRN', '6VXX', '1A5R', '4HHB', '4HHB']);
    expect(entryFileUrl(' 4hhb ')).toBe('https://files.rcsb.org/download/4HHB.cif');
  });

  it('rejects malformed entity, chain, assembly and ligand ids, and URLs off the four RCSB hosts, before fetching', async () => {
    const fetch = vi.fn<FetchFn>(async () => new Response('should not be fetched'));
    for (const entity of [0, -1, 1.5, '', 'A', '1/2', NaN]) {
      expect(() => entityFastaUrl('4hhb', entity as number), String(entity)).toThrow(/entity id/);
      expect(() => polymerEntityDataUrl('4hhb', entity as number), String(entity)).toThrow(/entity id/);
    }
    for (const n of [0, -1, 2.5, '', 'x', '1;2']) {
      expect(() => assemblyFileUrl('4hhb', n as number), String(n)).toThrow(/assembly id/);
      expect(() => assemblyDataUrl('4hhb', n as number), String(n)).toThrow(/assembly id/);
    }
    for (const asym of ['', 'A/B', 'A B', '../A', 'ABCDE', 'A.']) {
      expect(() => chainFastaUrl('4hhb', asym), asym).toThrow(/chain id/);
      expect(() => polymerEntityInstanceDataUrl('4hhb', asym), asym).toThrow(/chain id/);
    }
    for (const ccd of ['', 'HEME00', 'HE M', 'HE/M', 'H.M']) {
      expect(() => ligandFileUrl(ccd), ccd).toThrow(/ligand id/);
      expect(() => chemCompDataUrl(ccd), ccd).toThrow(/ligand id/);
    }
    for (const url of ['https://example.org/download/4HHB.cif', 'http://files.rcsb.org/download/4HHB.cif', 'https://files.rcsb.org.evil.example/x', 'https://rcsb.org/x', 'not a url']) {
      await expect(rcsbFetch(url, undefined, { fetch }), url).rejects.toThrow(/not one of the RCSB hosts/);
    }
    for (const format of ['mmcif', 'CIF', 'pdb1', '']) {
      expect(() => entryFileUrl('4hhb', format as 'cif'), format).toThrow(/not a file format/);
    }
    for (const format of ['mol', 'SDF', 'pdb', '']) {
      expect(() => ligandFileUrl('hem', format as 'sdf'), format).toThrow(/not a file format/);
    }
    await expect(rcsbText(entryFileUrl('4hhb'), { fetch, retries: -1 })).rejects.toThrow(/retries/);
    await expect(rcsbText(entryFileUrl('4hhb'), { fetch, baseDelayMs: -5 })).rejects.toThrow(/baseDelayMs/);
    expect(fetch).not.toHaveBeenCalled();

    // Neighbouring well-formed ids are accepted.
    expect(entityFastaUrl('4hhb', '2')).toBe('https://www.rcsb.org/fasta/entity/4HHB_2/download');
    expect(polymerEntityInstanceDataUrl('4hhb', 'AAA')).toBe('https://data.rcsb.org/rest/v1/core/polymer_entity_instance/4HHB/AAA');
    expect(chemCompDataUrl('a1ab2')).toBe('https://data.rcsb.org/rest/v1/core/chemcomp/A1AB2');
    expect(ligandFileUrl('0', 'cif')).toBe('https://files.rcsb.org/ligands/download/0.cif');
  });

  it('passes a request through to fetch unchanged and hands back a 204 unread', async () => {
    const fetch = vi.fn<FetchFn>(async () => new Response(null, { status: 204 }));
    const init: RequestInit = { method: 'POST', body: '{"query":{}}', headers: { 'Content-Type': 'application/json' } };
    const res = await rcsbFetch('https://search.rcsb.org/rcsbsearch/v2/query', init, { fetch });
    expect(res.status).toBe(204);
    expect(res.bodyUsed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual(['https://search.rcsb.org/rcsbsearch/v2/query', init]);
  });

  it('uses the global fetch and setTimeout when none are given', async () => {
    const global = queuedFetch(tooMany(), ok('data_1CRN\n'));
    vi.stubGlobal('fetch', global);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let settled = false;
    const text = rcsbText(entryFileUrl('1crn'), { baseDelayMs: 50 }).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await text).toBe('data_1CRN\n');
    expect(global).toHaveBeenCalledTimes(2);
    expect(urlOf(global.mock.calls[1][0])).toBe('https://files.rcsb.org/download/1CRN.cif');
  });

  /**
   * A FASTA text as its records, in file order. RCSB returns an entry's records in no fixed order
   * (4HHB comes back beta-first in about one download in three), so the tests look for a whole
   * record, header and sequence, wherever it falls rather than reading the first line.
   */
  const fastaRecords = (text: string) => text.split(/^>/m).slice(1).map((chunk) => {
    const [header, ...lines] = chunk.split(/\r?\n/);
    return { header: `>${header}`, sequence: lines.join('') };
  });
  const HBA_4HHB_1 = {
    header: '>4HHB_1|Chains A, C|Hemoglobin subunit alpha|Homo sapiens (9606)',
    sequence: 'VLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR',
  };

  const FILES = {
    'https://files.rcsb.org/download/4HHB.cif': 'rcsb/4HHB.cif',
    'https://files.rcsb.org/download/4HHB.pdb': 'rcsb/4HHB.pdb',
    'https://files.rcsb.org/download/4HHB-assembly1.cif': 'rcsb/4HHB-assembly1.cif',
    'https://www.rcsb.org/fasta/entry/4HHB/download': 'rcsb/fasta/4HHB.fasta',
    'https://www.rcsb.org/fasta/entity/4HHB_1/download': 'rcsb/fasta/4HHB_1.fasta',
    'https://www.rcsb.org/fasta/chain/4HHB.A/download': 'rcsb/fasta/4HHB.A.fasta',
    'https://files.rcsb.org/ligands/download/HEM.cif': 'rcsb/ligands/HEM.cif',
    'https://files.rcsb.org/ligands/download/HEM_ideal.sdf': 'rcsb/ligands/HEM_ideal.sdf',
    'https://data.rcsb.org/rest/v1/core/polymer_entity/4HHB/1': 'rcsb/api/polymer_entity_4HHB_1.json',
    'https://data.rcsb.org/rest/v1/core/polymer_entity_instance/4HHB/A': 'rcsb/api/polymer_entity_instance_4HHB_A.json',
    'https://data.rcsb.org/rest/v1/core/assembly/4HHB/1': 'rcsb/api/assembly_4HHB_1.json',
    'https://data.rcsb.org/rest/v1/core/chemcomp/HEM': 'rcsb/api/chemcomp_HEM.json',
  };
  it.skipIf(!haveTestData(...Object.values(FILES)))('downloads the recorded coordinates, FASTA, ligand files and Data API objects verbatim', async () => {
    const fetch = recordedFetch(FILES);
    const text = (url: string) => rcsbText(url, { fetch });
    const recorded = (url: keyof typeof FILES) => fs.readFileSync(dataPath(FILES[url]), 'utf8');

    expect(await text(entryFileUrl('4hhb', 'cif'))).toBe(recorded('https://files.rcsb.org/download/4HHB.cif'));
    expect(await text(entryFileUrl('4hhb', 'pdb'))).toBe(recorded('https://files.rcsb.org/download/4HHB.pdb'));
    expect(await text(assemblyFileUrl('4hhb', 1))).toBe(recorded('https://files.rcsb.org/download/4HHB-assembly1.cif'));
    expect(fastaRecords(await text(entryFastaUrl('4hhb')))).toContainEqual(HBA_4HHB_1);
    expect((await text(entityFastaUrl('4hhb', 1))).startsWith('>4HHB_1|')).toBe(true);
    expect((await text(chainFastaUrl('4hhb', 'A'))).startsWith('>4HHB.A|')).toBe(true);
    expect((await text(ligandFileUrl('hem', 'cif'))).startsWith('data_HEM')).toBe(true);
    expect((await text(ligandFileUrl('hem', 'sdf'))).split('\n')[0]).toBe('HEM');

    expect(await rcsbJson(polymerEntityDataUrl('4hhb', 1), { fetch })).toMatchObject({ rcsb_id: '4HHB_1' });
    expect(await rcsbJson(polymerEntityInstanceDataUrl('4hhb', 'A'), { fetch })).toMatchObject({ rcsb_id: '4HHB.A' });
    expect(await rcsbJson(assemblyDataUrl('4hhb', 1), { fetch })).toMatchObject({ rcsb_id: '4HHB-1' });
    expect(await rcsbJson(chemCompDataUrl('hem'), { fetch })).toMatchObject({ rcsb_id: 'HEM' });
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it.skipIf(!haveTestData('rcsb/fasta/4HHB.fasta'))('FASTA download contains the 4HHB_1 record in any order', async () => {
    // The downloaded entry FASTA as recorded, and the same records in the opposite order: between them
    // both orders RCSB has been seen to return (alpha first, beta first).
    const downloaded = fs.readFileSync(dataPath('rcsb/fasta/4HHB.fasta'), 'utf8');
    const records = fastaRecords(downloaded);
    expect(records.map((r) => r.header.split('|')[0])).toEqual(expect.arrayContaining(['>4HHB_1', '>4HHB_2']));
    const reversed = [...records].reverse().map((r) => `${r.header}\n${r.sequence}\n`).join('');
    expect(fastaRecords(reversed)[0].header).not.toBe(records[0].header);
    for (const body of [downloaded, reversed]) {
      const fetch = queuedFetch(ok(body));
      expect(fastaRecords(await rcsbText(entryFastaUrl('4hhb'), { fetch }))).toContainEqual(HBA_4HHB_1);
      expect(urlOf(fetch.mock.calls[0][0])).toBe('https://www.rcsb.org/fasta/entry/4HHB/download');
    }
  });

  it('the Tauri CSP connect-src lists exactly the four RCSB hosts the client may contact', () => {
    expect([...RCSB_HOSTS]).toEqual(['https://files.rcsb.org', 'https://data.rcsb.org', 'https://search.rcsb.org', 'https://www.rcsb.org']);
    const conf = JSON.parse(fs.readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as { app: { security: { csp: string } } };
    const connects = conf.app.security.csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0] === 'connect-src');
    expect(connects).toHaveLength(1);
    const sources = connects[0].slice(1);
    expect(sources.filter((source) => source.includes('rcsb')).sort()).toEqual([...RCSB_HOSTS].sort());
    // The whole source list: what connect-src allowed before D0008, plus the four RCSB hosts and
    // nothing else, so a scheme (`https:`), a wildcard (`*`, `https://*.rcsb.org`) or any other added
    // host fails here. A unit that changes the pre-existing sources (US-01M6P2QG drops the
    // 127.0.0.1 pair) updates this list with it.
    const beforeRcsb = [
      "'self'", 'ipc:', 'http://ipc.localhost', 'https://ipc.localhost', 'http://127.0.0.1:18420', 'http://127.0.0.1:*',
      'https://eutils.ncbi.nlm.nih.gov', 'https://rest.uniprot.org',
    ];
    expect([...sources].sort()).toEqual([...beforeRcsb, ...RCSB_HOSTS].sort());
  });
});
