// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The RCSB Search API v2 (US-01M6PBT2): full_text, sequence, seqmotif and structure requests, the
 * parsed result set, HTTP 204 as no hits, and a sequence search from the active protein document.
 *
 * No test touches the network: the global `fetch` is replaced by one that throws, and every request
 * goes to a stub. The request bodies are compared with the ones scripts/outside-data/fetch.sh sent
 * to record test-data/rcsb/api/search_*.json, read from that script, so the two cannot drift apart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RCSB_SEARCH_URL, RCSB_SEQUENCE_SEARCH_DEFAULTS, RcsbHttpError, fullTextQuery, parseSearchResponse, searchRcsb,
  seqmotifQuery, sequenceDocumentQuery, sequenceQuery, structureQuery, type RcsbReturnType, type RcsbSearchRequest,
} from '../core/rcsbClient';
import type { MoleculeType, SequenceDocument } from '../types/bio';
import { dataPath, haveTestData } from './testData';

const nodeFs: string = 'node:fs';
const fs = await import(/* @vite-ignore */ nodeFs) as { readFileSync: (p: string | URL, e: string) => string };

type FetchFn = typeof globalThis.fetch;
const urlOf = (input: Parameters<FetchFn>[0]): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/** The request bodies fetch.sh recorded the search responses with: `rcsb_search <name> '<json>'`. */
const FETCH_SH = fs.readFileSync(new URL('../../scripts/outside-data/fetch.sh', import.meta.url), 'utf8');
function recordedRequest(name: string): string {
  const match = FETCH_SH.split('\n').map((line) => /^rcsb_search (\w+) '(.*)'$/.exec(line)).find((m) => m?.[1] === name);
  if (!match) throw new Error(`scripts/outside-data/fetch.sh records no rcsb_search ${name} request`);
  return match[2];
}

/** A fetch stub that records every call and answers each with `answer()`. */
function stubFetch(answer: () => Response) {
  return vi.fn<FetchFn>(async () => answer());
}

/** The JSON body a stubbed fetch was called with. */
function sentBody(fetch: ReturnType<typeof stubFetch>, call = 0): unknown {
  const init = fetch.mock.calls[call][1];
  expect(typeof init?.body).toBe('string');
  return JSON.parse(init!.body as string);
}

/** Human haemoglobin alpha (4HHB entity 1), the sequence fetch.sh searched with. */
const HBA = 'VLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR';
/** Human ubiquitin (1UBQ). */
const UBQ = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';
const ZINC_FINGER = 'C-x(2,4)-C-x(3)-[LIVMFYWC]-x(8)-H-x(3,5)-H';

function document(moleculeType: MoleculeType, sequence: string, name = 'query'): SequenceDocument {
  return {
    id: `doc-${name}`, name, accession: '', description: '', moleculeType, topology: 'linear', sequence,
    features: [], primers: [], history: [], createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z',
    folder: 'Protein Documents',
  };
}

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('a test reached the real fetch'); }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('RCSB Search API', () => {
  it('builds full_text, sequence, seqmotif and structure Search API requests that match the recorded request shapes', async () => {
    const recorded = {
      full_text: fullTextQuery('hemoglobin', { rows: 5 }),
      sequence: sequenceQuery(HBA, { sequenceType: 'protein', identityCutoff: 0.9, rows: 5 }),
      seqmotif: seqmotifQuery(ZINC_FINGER, { patternType: 'prosite', sequenceType: 'protein', rows: 5 }),
      structure: structureQuery('4hhb', { operator: 'strict_shape_match', rows: 5 }),
    };
    // The body sent is the recorded body, byte for byte, and goes to the one Search API URL as a JSON POST.
    for (const [name, request] of Object.entries(recorded)) {
      expect(JSON.stringify(request), name).toBe(recordedRequest(name));
      const fetch = stubFetch(() => new Response(null, { status: 204 }));
      await searchRcsb(request, { fetch });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      expect(urlOf(input)).toBe('https://search.rcsb.org/rcsbsearch/v2/query');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
      expect(init?.body, name).toBe(recordedRequest(name));
    }
    expect(RCSB_SEARCH_URL).toBe('https://search.rcsb.org/rcsbsearch/v2/query');

    // Every parameter follows its input, not the recording.
    expect(fullTextQuery('  protein kinase  ', { returnType: 'mol_definition', start: 25, rows: 10000 })).toEqual({
      query: { type: 'terminal', service: 'full_text', parameters: { value: 'protein kinase' } },
      return_type: 'mol_definition', request_options: { paginate: { start: 25, rows: 10000 } },
    });
    expect(sequenceQuery('acgu acgu\nacgu', { sequenceType: 'rna', evalueCutoff: 1e-5, identityCutoff: 0, returnType: 'polymer_instance', start: 10, rows: 1 })).toEqual({
      query: { type: 'terminal', service: 'sequence', parameters: { evalue_cutoff: 1e-5, identity_cutoff: 0, sequence_type: 'rna', value: 'ACGUACGUACGU' } },
      return_type: 'polymer_instance', request_options: { paginate: { start: 10, rows: 1 }, scoring_strategy: 'sequence' },
    });
    expect(sequenceQuery(UBQ, { sequenceType: 'protein', identityCutoff: 1, returnType: 'entry' }).query.parameters)
      .toEqual({ evalue_cutoff: 0.1, identity_cutoff: 1, sequence_type: 'protein', value: UBQ });
    expect(seqmotifQuery(' TATA[AT]A ', { patternType: 'regex', sequenceType: 'dna', returnType: 'non_polymer_entity', start: 3, rows: 7 })).toEqual({
      query: { type: 'terminal', service: 'seqmotif', parameters: { value: 'TATA[AT]A', pattern_type: 'regex', sequence_type: 'dna' } },
      return_type: 'non_polymer_entity', request_options: { paginate: { start: 3, rows: 7 } },
    });
    expect(seqmotifQuery('CXXC', { patternType: 'simple', sequenceType: 'protein' }).query.parameters)
      .toEqual({ value: 'CXXC', pattern_type: 'simple', sequence_type: 'protein' });
    expect(structureQuery(' 1crn ', { assemblyId: '2', operator: 'relaxed_shape_match', returnType: 'entry', start: 5, rows: 50 })).toEqual({
      query: { type: 'terminal', service: 'structure', parameters: { value: { entry_id: '1CRN', assembly_id: '2' }, operator: 'relaxed_shape_match' } },
      return_type: 'entry', request_options: { paginate: { start: 5, rows: 50 } },
    });

    // Unstated, a search asks for the first 10 results: entries for text, assemblies for shape, polymer entities otherwise.
    expect(fullTextQuery('hemoglobin')).toMatchObject({ return_type: 'entry', request_options: { paginate: { start: 0, rows: 10 } } });
    expect(sequenceQuery(HBA, { sequenceType: 'protein' })).toMatchObject({ return_type: 'polymer_entity', request_options: { paginate: { start: 0, rows: 10 } } });
    expect(seqmotifQuery(ZINC_FINGER, { patternType: 'prosite', sequenceType: 'protein' })).toMatchObject({ return_type: 'polymer_entity', request_options: { paginate: { start: 0, rows: 10 } } });
    expect(structureQuery('4HHB', { operator: 'strict_shape_match' })).toMatchObject({ return_type: 'assembly', request_options: { paginate: { start: 0, rows: 10 } } });
  });

  it('rejects malformed search inputs before any request', () => {
    const fails = (build: () => RcsbSearchRequest, message: RegExp, label: string) => expect(build, label).toThrow(message);
    for (const text of ['', '   ', '\n\t']) fails(() => fullTextQuery(text), /search text/, JSON.stringify(text));
    for (const seq of ['', '  \n ', 'MKV-LA', 'MKVLA*', 'MKV1', 'MK.V']) fails(() => sequenceQuery(seq, { sequenceType: 'protein' }), /sequence/, seq);
    for (const sequenceType of ['DNA', 'Protein', 'peptide', '', undefined]) {
      fails(() => sequenceQuery(HBA, { sequenceType: sequenceType as 'protein' }), /sequence type/, String(sequenceType));
      fails(() => seqmotifQuery(ZINC_FINGER, { patternType: 'prosite', sequenceType: sequenceType as 'protein' }), /sequence type/, String(sequenceType));
    }
    for (const evalueCutoff of [0, -1, NaN, Infinity]) fails(() => sequenceQuery(HBA, { sequenceType: 'protein', evalueCutoff }), /E-value cutoff/, String(evalueCutoff));
    for (const identityCutoff of [-0.1, 1.01, 30, NaN]) fails(() => sequenceQuery(HBA, { sequenceType: 'protein', identityCutoff }), /identity cutoff/, String(identityCutoff));
    for (const pattern of ['', '   ']) fails(() => seqmotifQuery(pattern, { patternType: 'prosite', sequenceType: 'protein' }), /motif/, JSON.stringify(pattern));
    for (const patternType of ['PROSITE', 'glob', '', undefined]) {
      fails(() => seqmotifQuery(ZINC_FINGER, { patternType: patternType as 'prosite', sequenceType: 'protein' }), /pattern type/, String(patternType));
    }
    for (const id of ['', '4HH', '4HHBB', '0ABC', '4HH/', 'pdb_00004hhb']) fails(() => structureQuery(id, { operator: 'strict_shape_match' }), /PDB entry id/, id);
    for (const assemblyId of [0, -1, 1.5, '', 'x']) fails(() => structureQuery('4HHB', { assemblyId, operator: 'strict_shape_match' }), /assembly id/, String(assemblyId));
    for (const operator of ['strict', 'shape_match', '', undefined]) fails(() => structureQuery('4HHB', { operator: operator as 'strict_shape_match' }), /shape operator/, String(operator));
    for (const returnType of ['entries', 'Entry', 'polymer_entity_instance', '']) {
      fails(() => fullTextQuery('hemoglobin', { returnType: returnType as 'entry' }), /return type/, returnType);
      fails(() => structureQuery('4HHB', { operator: 'strict_shape_match', returnType: returnType as 'entry' }), /return type/, returnType);
    }
    for (const rows of [0, -1, 10001, 2.5, NaN]) fails(() => fullTextQuery('hemoglobin', { rows }), /rows/, String(rows));
    for (const start of [-1, 0.5, NaN]) fails(() => seqmotifQuery(ZINC_FINGER, { patternType: 'prosite', sequenceType: 'protein', start }), /start/, String(start));

    // The edges are accepted.
    expect(fullTextQuery('x', { rows: 1 }).request_options.paginate.rows).toBe(1);
    expect(fullTextQuery('x', { rows: 10000 }).request_options.paginate.rows).toBe(10000);
    expect(structureQuery('4HHB', { assemblyId: 12, operator: 'strict_shape_match' }).query.parameters).toEqual({ value: { entry_id: '4HHB', assembly_id: '12' }, operator: 'strict_shape_match' });
  });

  it('checks a search sequence against the alphabet of its declared type before any request', () => {
    const refused = (sequence: string, sequenceType: 'protein' | 'dna' | 'rna', message: string) =>
      expect(() => sequenceQuery(sequence, { sequenceType }), `${sequenceType} ${JSON.stringify(sequence)}`).toThrow(message);
    // A protein sent as DNA or RNA, a T in RNA and a U in DNA are refused, naming the first offending letter and its position.
    refused(HBA, 'dna', 'The DNA search sequence has "L" at position 2; a DNA sequence takes the IUPAC nucleotide codes A C G T R Y S W K M B D H V N only.');
    refused(UBQ, 'rna', 'The RNA search sequence has "Q" at position 2; an RNA sequence takes the IUPAC nucleotide codes A C G U R Y S W K M B D H V N only.');
    refused('ACGUACGT', 'rna', 'The RNA search sequence has "T" at position 8;');
    refused('acgu acgu\nacgt', 'rna', 'The RNA search sequence has "t" at position 12;');
    refused('ACGTU', 'dna', 'The DNA search sequence has "U" at position 5;');
    refused('ACGTACGTE', 'dna', 'The DNA search sequence has "E" at position 9;');
    refused('MKVJLA', 'protein', 'The protein search sequence has "J" at position 4; a protein sequence takes the 20 standard residues and B, Z, X, U, O only.');
    refused('MKV-LA', 'protein', 'The protein search sequence has "-" at position 4;');
    refused('ACGT*', 'dna', 'The DNA search sequence has "*" at position 5;');
    // A letter that only upper-cases into the alphabet is not in it (German sharp s is not two serines).
    refused('MKßV', 'protein', 'The protein search sequence has "ß" at position 3;');
    refused('acgé', 'dna', 'The DNA search sequence has "é" at position 4;');
    refused('MK🧬V', 'protein', 'The protein search sequence has "🧬" at position 3;');

    // Each alphabet is exactly its stated letters: every letter A-Z, in either case, is accepted or refused accordingly.
    const ALPHABETS = { protein: 'ACDEFGHIKLMNPQRSTVWYBZXUO', dna: 'ACGTRYSWKMBDHVN', rna: 'ACGURYSWKMBDHVN' } as const;
    const LABELS = { protein: 'protein', dna: 'DNA', rna: 'RNA' } as const;
    for (const [type, letters] of Object.entries(ALPHABETS) as Array<[keyof typeof ALPHABETS, string]>) {
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        for (const typed of [letter, letter.toLowerCase()]) {
          if (letters.includes(letter)) {
            expect(sequenceQuery(`a${typed}`, { sequenceType: type }).query.parameters.value, `${type} ${typed}`).toBe(`A${letter}`);
          } else {
            refused(`a${typed}`, type, `The ${LABELS[type]} search sequence has ${JSON.stringify(typed)} at position 2;`);
          }
        }
      }
    }

    // Valid IUPAC DNA and RNA, and a protein with X (or any of B Z X U O), are sent as given, upper-cased.
    expect(sequenceQuery('acgt rysw\nkmbd hvn', { sequenceType: 'dna' }).query.parameters).toMatchObject({ sequence_type: 'dna', value: 'ACGTRYSWKMBDHVN' });
    expect(sequenceQuery('ACGURYSWKMBDHVN', { sequenceType: 'rna' }).query.parameters).toMatchObject({ sequence_type: 'rna', value: 'ACGURYSWKMBDHVN' });
    expect(sequenceQuery('MKVXLAX', { sequenceType: 'protein' }).query.parameters).toMatchObject({ sequence_type: 'protein', value: 'MKVXLAX' });
    expect(sequenceQuery('mbzxuo', { sequenceType: 'protein' }).query.parameters).toMatchObject({ value: 'MBZXUO' });
    // ACGT is also a protein (alanine, cysteine, glycine, threonine): the declared type decides, not the letters.
    expect(sequenceQuery('ACGT', { sequenceType: 'protein' }).query.parameters).toMatchObject({ sequence_type: 'protein', value: 'ACGT' });

    // Through the document search too: a protein document with a letter outside the protein alphabet sends nothing.
    expect(() => sequenceDocumentQuery(document('Protein', 'MKVJLA', 'ambiguous'))).toThrow('The protein search sequence has "J" at position 4;');
  });

  const RESPONSES = {
    full_text: 'rcsb/api/search_full_text.json',
    sequence: 'rcsb/api/search_sequence.json',
    seqmotif: 'rcsb/api/search_seqmotif.json',
    structure: 'rcsb/api/search_structure.json',
  };
  /**
   * What every recording of a search has, whenever it was made: RCSB issues a new query_id per
   * request and the counts and hits move as the archive grows, so these are the recording's form,
   * not its values.
   */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const IDENTIFIER_FORMS: Partial<Record<RcsbReturnType, RegExp>> = {
    entry: /^[1-9][A-Z0-9]{3}$/, polymer_entity: /^[1-9][A-Z0-9]{3}_\d+$/, assembly: /^[1-9][A-Z0-9]{3}-\d+$/,
  };
  interface RecordedSearch { query_id: string; result_type: RcsbReturnType; total_count: number; result_set: Array<{ identifier: string; score: number }> }

  /** The result a payload should parse to, read from the payload itself, field for field and in order. */
  const resultOf = (raw: RecordedSearch) => ({
    queryId: raw.query_id, resultType: raw.result_type, totalCount: raw.total_count,
    hits: raw.result_set.map(({ identifier, score }) => ({ identifier, score })),
  });

  /**
   * Parses one recording of `request`, directly and through searchRcsb, and checks it has a search
   * response's form. Each check's message carries a [tag], so a failure says which check it was.
   */
  async function expectRecordedSearch(label: string, request: RcsbSearchRequest, text: string): Promise<void> {
    const raw = JSON.parse(text) as RecordedSearch;
    const parsed = parseSearchResponse(raw);
    expect(parsed, `${label} [parse]`).toEqual(resultOf(raw));
    expect(parsed.queryId, `${label} [query_id form]`).toMatch(UUID);
    expect(parsed.resultType, `${label} [result_type]`).toBe(request.return_type);
    expect(parsed.hits.length, `${label} [hits present]`).toBeGreaterThan(0);
    expect(parsed.hits.length, `${label} [rows]`).toBeLessThanOrEqual(request.request_options.paginate.rows);
    expect(parsed.totalCount, `${label} [total_count]`).toBeGreaterThanOrEqual(parsed.hits.length);
    const form = IDENTIFIER_FORMS[parsed.resultType];
    expect(form, `${label} [identifier form] none for ${parsed.resultType}`).toBeDefined();
    for (const { identifier, score } of parsed.hits) {
      expect(identifier, `${label} [identifier form]`).toMatch(form!);
      expect(Number.isFinite(score) && score > 0 && score <= 1, `${label} [score range] ${identifier} ${score}`).toBe(true);
    }
    // End to end: the stub serves this recording only to the request body that produced it.
    const body = JSON.stringify(request);
    const fetch = vi.fn<FetchFn>(async (_input, init) => (init?.body === body
      ? new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('{"status":400,"message":"unexpected request"}', { status: 400 })));
    expect(await searchRcsb(request, { fetch }), `${label} [end to end]`).toEqual(parsed);
    expect(fetch).toHaveBeenCalledTimes(1);
  }

  /** Deterministic draws (mulberry32), so a synthetic recording is the same on every run. */
  function draws(seed: number): () => number {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * A stand-in for re-running fetch.sh: a new UUID, another total, `count` hits (by default another
   * number than recorded) with identifiers of the same form that the recording does not contain, and
   * new scores in (0, 1], the first of them 1.
   */
  function freshRecording(raw: RecordedSearch, seed: number,
    count = raw.result_set.length > 1 ? raw.result_set.length - 1 : raw.result_set.length + 1): RecordedSearch {
    const draw = draws(seed);
    const pick = (chars: string) => chars[Math.floor(draw() * chars.length)];
    const run = (chars: string, n: number) => Array.from({ length: n }, () => pick(chars)).join('');
    const hex = (n: number) => run('0123456789abcdef', n);
    const entry = () => pick('123456789') + run('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 3);
    const serial = () => String(1 + Math.floor(draw() * 12));
    const makers = { entry, polymer_entity: () => `${entry()}_${serial()}`, assembly: () => `${entry()}-${serial()}` };
    const make = makers[raw.result_type as keyof typeof makers];
    if (!make) throw new Error(`no synthetic identifier form for ${raw.result_type}`);
    const taken = new Set(raw.result_set.map((h) => h.identifier));
    const identifier = () => { let id: string; do id = make(); while (taken.has(id)); taken.add(id); return id; };
    let queryId: string;
    do queryId = `${hex(8)}-${hex(4)}-4${hex(3)}-${pick('89ab')}${hex(3)}-${hex(12)}`; while (queryId === raw.query_id);
    return {
      query_id: queryId, result_type: raw.result_type, total_count: raw.total_count + count + 1 + Math.floor(draw() * 500),
      result_set: Array.from({ length: count }, (_, i) => ({ identifier: identifier(), score: i === 0 ? 1 : 1 - (i + draw()) / (count + 1) })),
    };
  }

  it.skipIf(!haveTestData(...Object.values(RESPONSES)))('parses recorded search responses into identifiers, scores and total counts', async () => {
    const recorded = (name: keyof typeof RESPONSES) => fs.readFileSync(dataPath(RESPONSES[name]), 'utf8');
    const requests: Record<keyof typeof RESPONSES, RcsbSearchRequest> = {
      full_text: fullTextQuery('hemoglobin', { rows: 5 }),
      sequence: sequenceQuery(HBA, { sequenceType: 'protein', identityCutoff: 0.9, rows: 5 }),
      seqmotif: seqmotifQuery(ZINC_FINGER, { patternType: 'prosite', sequenceType: 'protein', rows: 5 }),
      structure: structureQuery('4HHB', { operator: 'strict_shape_match', rows: 5 }),
    };
    for (const [seed, name] of (Object.keys(RESPONSES) as Array<keyof typeof RESPONSES>).entries()) {
      // Each response was recorded for exactly this request.
      expect(JSON.stringify(requests[name]), name).toBe(recordedRequest(name));
      const raw = JSON.parse(recorded(name)) as RecordedSearch;
      await expectRecordedSearch(name, requests[name], recorded(name));

      // The same checks pass on another recording of the same search, with another query_id, total,
      // page length and identifiers: nothing above depends on the one recording on disk.
      const fresh = freshRecording(raw, 0x5eed + seed);
      expect(fresh.query_id).not.toBe(raw.query_id);
      expect(fresh.total_count).not.toBe(raw.total_count);
      expect(fresh.result_set.length).not.toBe(raw.result_set.length);
      expect(fresh.result_set.filter((h) => raw.result_set.some((r) => r.identifier === h.identifier))).toEqual([]);
      await expectRecordedSearch(`${name} (fresh)`, requests[name], JSON.stringify(fresh));

      // ...and fail, at the check named, on a recording of another form. (A total below the page has no
      // case here: parseSearchResponse refuses it first, as the malformed cases below show.)
      const other = (edit: (r: RecordedSearch) => void) => { const r = structuredClone(fresh); edit(r); return JSON.stringify(r); };
      const notTheForm: Array<[string, string, string]> = [
        ['id without dashes', other((r) => { r.query_id = r.query_id.replace(/-/g, ''); }), '[query_id form]'],
        ['another granularity', other((r) => { r.result_type = r.result_type === 'entry' ? 'assembly' : 'entry'; }), '[result_type]'],
        ['an empty page', other((r) => { r.result_set = []; }), '[hits present]'],
        ['a page over the rows asked for', other((r) => { while (r.result_set.length <= requests[name].request_options.paginate.rows) r.result_set.push({ ...r.result_set[0] }); r.total_count += 10; }), '[rows]'],
        ['an id with a suffix', other((r) => { r.result_set[0].identifier = `${r.result_set[0].identifier}X`; }), '[identifier form]'],
        ['a zero score', other((r) => { r.result_set[0].score = 0; }), '[score range]'],
        ['a score over 1', other((r) => { r.result_set[0].score = 1.5; }), '[score range]'],
      ];
      for (const [what, text, check] of notTheForm) {
        await expect(expectRecordedSearch(`${name} (${what})`, requests[name], text), `${name}: ${what}`).rejects.toThrow(check);
      }

      // The parse follows the payload: edited counts, scores, identifiers and order come through as edited.
      const [added, replaced] = freshRecording(raw, 0xed17 + seed, 2).result_set.map((h) => h.identifier);
      const edited = structuredClone(raw);
      edited.total_count = raw.total_count + 7;
      edited.result_set.reverse();
      edited.result_set[0] = { identifier: replaced, score: 0.5 };
      edited.result_set.push({ identifier: added, score: 0.25 });
      const parsed = parseSearchResponse(edited);
      expect(parsed.totalCount, name).toBe(raw.total_count + 7);
      expect(parsed.hits, name).toEqual([
        { identifier: replaced, score: 0.5 },
        ...raw.result_set.slice(0, -1).reverse().map(({ identifier, score }) => ({ identifier, score })),
        { identifier: added, score: 0.25 },
      ]);

      // A recording made malformed is refused, naming what is wrong.
      const last = raw.result_set.length - 1;
      const broken = (edit: (r: RecordedSearch) => void) => { const r = structuredClone(raw); edit(r); return r; };
      const malformed: Array<[string, unknown, RegExp]> = [
        ['no query_id', broken((r) => { delete (r as { query_id?: string }).query_id; }), /query_id is missing/],
        ['empty query_id', broken((r) => { r.query_id = ''; }), /query_id is empty/],
        ['blank query_id', broken((r) => { r.query_id = ' \t '; }), /query_id is empty/],
        ['unknown result_type', broken((r) => { r.result_type = `${r.result_type}s` as RcsbReturnType; }), /result_type/],
        ['total_count below the hits', broken((r) => { r.total_count = r.result_set.length - 1; }), /is less than the \d+ hits returned/],
        ['NaN score', broken((r) => { r.result_set[last].score = NaN; }), new RegExp(`result_set\\[${last}\\] is malformed`)],
        ['infinite score', broken((r) => { r.result_set[last].score = Infinity; }), new RegExp(`result_set\\[${last}\\] is malformed`)],
        ['score as text', broken((r) => { (r.result_set[0] as { score: unknown }).score = String(r.result_set[0].score); }), /result_set\[0\] is malformed/],
        ['empty identifier', broken((r) => { r.result_set[0].identifier = ''; }), /result_set\[0\] is malformed/],
      ];
      for (const [what, response, message] of malformed) expect(() => parseSearchResponse(response), `${name}: ${what}`).toThrow(message);
    }
  });

  it('refuses a search response that is not a result set', async () => {
    const good = { query_id: 'q', result_type: 'entry', total_count: 2, result_set: [{ identifier: '4HHB', score: 1 }, { identifier: '1CRN', score: 0.5 }] };
    expect(parseSearchResponse(good)).toEqual({ queryId: 'q', resultType: 'entry', totalCount: 2, hits: [{ identifier: '4HHB', score: 1 }, { identifier: '1CRN', score: 0.5 }] });
    const bad: Array<[unknown, RegExp]> = [
      [null, /not a JSON object/], [[], /not a JSON object/], ['4HHB', /not a JSON object/],
      [{ ...good, query_id: undefined }, /query_id is missing/], [{ ...good, query_id: null }, /query_id is missing/], [{ ...good, query_id: 7 }, /query_id is malformed/],
      [{ ...good, query_id: '' }, /query_id is empty/], [{ ...good, query_id: '   ' }, /query_id is empty/], [{ ...good, query_id: '\n\t' }, /query_id is empty/],
      [{ ...good, result_type: 'entries' }, /result_type/], [{ ...good, result_type: undefined }, /result_type/],
      [{ ...good, total_count: undefined }, /total_count/], [{ ...good, total_count: -1 }, /total_count/], [{ ...good, total_count: 2.5 }, /total_count/], [{ ...good, total_count: '2' }, /total_count/],
      [{ ...good, total_count: 1 }, /total_count 1 is less than the 2 hits/],
      [{ ...good, result_set: undefined }, /result_set is malformed/], [{ ...good, result_set: {} }, /result_set is malformed/],
      [{ ...good, result_set: [{ identifier: '4HHB', score: 1 }, { identifier: '', score: 1 }] }, /result_set\[1\] is malformed/],
      [{ ...good, result_set: [{ identifier: 4, score: 1 }] }, /result_set\[0\] is malformed/],
      [{ ...good, result_set: [{ identifier: '4HHB', score: '1.0' }] }, /result_set\[0\] is malformed/],
      [{ ...good, result_set: [{ identifier: '4HHB', score: 1 }, { identifier: '1CRN', score: NaN }] }, /result_set\[1\] is malformed/],
      [{ ...good, result_set: [{ identifier: '4HHB', score: Infinity }] }, /result_set\[0\] is malformed/],
      [{ ...good, result_set: [{ identifier: '4HHB', score: -Infinity }] }, /result_set\[0\] is malformed/],
      [{ ...good, result_set: [{ identifier: '4HHB', score: null }] }, /result_set\[0\] is malformed/],
      [{ ...good, result_set: [{ identifier: '4HHB' }] }, /result_set\[0\] is malformed/],
      [{ ...good, result_set: ['4HHB'] }, /result_set\[0\] is malformed/],
    ];
    for (const [response, message] of bad) expect(() => parseSearchResponse(response), String(JSON.stringify(response))).toThrow(message);
    // A query_id with surrounding whitespace is still an id, and comes back as RCSB wrote it.
    expect(parseSearchResponse({ ...good, query_id: ' q ' }).queryId).toBe(' q ');

    // Over the wire: a result set of another granularity than the one asked for is refused, not relabelled.
    const polymer = sequenceQuery(UBQ, { sequenceType: 'protein' });
    const asEntries = stubFetch(() => new Response(JSON.stringify(good)));
    await expect(searchRcsb(polymer, { fetch: asEntries })).rejects.toThrow(/asked for polymer_entity results but RCSB returned entry/);
  });

  it('treats HTTP 204 as no hits', async () => {
    const requests: RcsbSearchRequest[] = [
      fullTextQuery('no such protein anywhere'),
      sequenceQuery(UBQ, { sequenceType: 'protein', identityCutoff: 1, returnType: 'polymer_instance' }),
      seqmotifQuery('WWWWWWWWWW', { patternType: 'simple', sequenceType: 'protein', returnType: 'entry' }),
      structureQuery('1CRN', { operator: 'strict_shape_match', returnType: 'mol_definition' }),
    ];
    for (const request of requests) {
      const sleep = vi.fn(async () => {});
      const fetch = stubFetch(() => new Response(null, { status: 204, statusText: 'No Content' }));
      expect(await searchRcsb(request, { fetch, sleep }), request.query.service).toEqual({ queryId: null, resultType: request.return_type, totalCount: 0, hits: [] });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }

    // A 204 after a rate-limited attempt is still no hits, through the same backoff as every RCSB request.
    const answers = [new Response('slow down', { status: 429 }), new Response(null, { status: 204 })];
    const limited = vi.fn<FetchFn>(async () => answers.shift()!);
    const waited: number[] = [];
    expect(await searchRcsb(requests[0], { fetch: limited, baseDelayMs: 10, sleep: async (ms) => { waited.push(ms); } }))
      .toEqual({ queryId: null, resultType: 'entry', totalCount: 0, hits: [] });
    expect(limited).toHaveBeenCalledTimes(2);
    expect(waited).toEqual([10]);

    // Only a 204 means no hits: an empty or unreadable 200 body, and an error status, are failures.
    await expect(searchRcsb(requests[0], { fetch: stubFetch(() => new Response('', { status: 200 })) }))
      .rejects.toThrow(`RCSB returned an empty response from ${RCSB_SEARCH_URL}`);
    await expect(searchRcsb(requests[0], { fetch: stubFetch(() => new Response('<html>', { status: 200 })) }))
      .rejects.toThrow(`RCSB returned a response that is not JSON from ${RCSB_SEARCH_URL}`);
    const badRequest = await searchRcsb(requests[0], { fetch: stubFetch(() => new Response('{"status":400}', { status: 400 })) }).catch((e: unknown) => e);
    expect(badRequest).toBeInstanceOf(RcsbHttpError);
    expect(badRequest).toMatchObject({ url: RCSB_SEARCH_URL, status: 400, attempts: 1 });
  });

  it('sends the active sequence with the stated cutoffs', async () => {
    // The stated defaults: E-value 0.1 and 30 % identity.
    expect(RCSB_SEQUENCE_SEARCH_DEFAULTS).toEqual({ evalueCutoff: 0.1, identityCutoff: 0.3 });

    const ok = () => new Response(JSON.stringify({ query_id: 'q', result_type: 'polymer_entity', total_count: 1, result_set: [{ identifier: '4HHB_1', score: 1 }] }));
    for (const [doc, value] of [
      [document('Protein', HBA, 'HBA_HUMAN'), HBA],
      [document('Protein', UBQ, 'UBQ_HUMAN'), UBQ],
      [document('Protein', `${UBQ.slice(0, 40).toLowerCase()}\n  ${UBQ.slice(40)}\n`, 'pasted ubiquitin'), UBQ],
    ] as const) {
      const fetch = stubFetch(ok);
      expect(await searchRcsb(sequenceDocumentQuery(doc), { fetch })).toEqual({ queryId: 'q', resultType: 'polymer_entity', totalCount: 1, hits: [{ identifier: '4HHB_1', score: 1 }] });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(urlOf(fetch.mock.calls[0][0])).toBe(RCSB_SEARCH_URL);
      expect(sentBody(fetch), doc.name).toEqual({
        query: { type: 'terminal', service: 'sequence', parameters: { evalue_cutoff: 0.1, identity_cutoff: 0.3, sequence_type: 'protein', value } },
        return_type: 'polymer_entity',
        request_options: { paginate: { start: 0, rows: 10 }, scoring_strategy: 'sequence' },
      });
    }

    // Stated cutoffs replace the defaults; with fetch.sh's they give its recorded request exactly.
    const hba = document('Protein', HBA, 'HBA_HUMAN');
    expect(JSON.stringify(sequenceDocumentQuery(hba, { identityCutoff: 0.9, rows: 5 }))).toBe(recordedRequest('sequence'));
    const strict = stubFetch(ok);
    await searchRcsb(sequenceDocumentQuery(hba, { evalueCutoff: 1e-10, identityCutoff: 0.95 }), { fetch: strict });
    expect(sentBody(strict)).toMatchObject({ query: { parameters: { evalue_cutoff: 1e-10, identity_cutoff: 0.95, sequence_type: 'protein', value: HBA } } });
    // A document search is a protein search whatever the options say.
    expect(sequenceDocumentQuery(hba, { sequenceType: 'dna' } as never).query.parameters).toMatchObject({ sequence_type: 'protein' });

    // A nucleotide, empty or missing document is refused by name, and nothing is sent.
    const fetch = stubFetch(ok);
    const refused: Array<[SequenceDocument | null | undefined, RegExp]> = [
      [document('DNA', 'ATGGTGCTGTCTCCTGCCGAC', 'HBA1 CDS'), /"HBA1 CDS" holds DNA; RCSB sequence search here takes a protein document/],
      [document('RNA', 'AUGGUGCUGUCUCCUGCCGAC', 'HBA1 mRNA'), /"HBA1 mRNA" holds RNA; RCSB sequence search here takes a protein document/],
      [document('Protein', '', 'empty'), /"empty" has no sequence to search RCSB with/],
      [document('Protein', ' \n\t', 'blank'), /"blank" has no sequence to search RCSB with/],
      [document('Protein', 'MKVLA*', 'translated'), /sequence/],
      [null, /no active document/],
      [undefined, /no active document/],
    ];
    for (const [doc, message] of refused) {
      await expect(async () => searchRcsb(sequenceDocumentQuery(doc), { fetch }), doc?.name ?? String(doc)).rejects.toThrow(message);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
