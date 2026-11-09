// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * RCSB PDB client (D0008): file downloads (coordinates, FASTA, ligands), the Data API REST v1 and
 * the Search API v2.
 *
 * The client contacts RCSB only when a caller asks it to; nothing here runs at import. Requests go
 * to the four hosts in `RCSB_HOSTS` and nowhere else. What comes back is handed over as text or
 * JSON: the client parses no structure itself (D0008 has the Rust engine read it like an opened file).
 *
 * Every id is validated before a URL is built, so a malformed id never reaches the network. A
 * download is `rcsbText(entryFileUrl(id))`; a Data API object is `rcsbJson(entryDataUrl(id))`.
 * A search is `searchRcsb(fullTextQuery(text))` (or `sequenceQuery`, `seqmotifQuery`,
 * `structureQuery`, `sequenceDocumentQuery`): the builder validates its inputs before any request
 * exists, and `searchRcsb` POSTs the body through the same `rcsbFetch`.
 */

import type { SequenceDocument } from '../types/bio';

/** The only origins the client sends requests to; the Tauri CSP connect-src lists the same four. */
export const RCSB_HOSTS = ['https://files.rcsb.org', 'https://data.rcsb.org', 'https://search.rcsb.org', 'https://www.rcsb.org'] as const;

const FILES = 'https://files.rcsb.org';
const DATA = 'https://data.rcsb.org/rest/v1/core';
const FASTA = 'https://www.rcsb.org/fasta';

export type RcsbStructureFormat = 'cif' | 'pdb';
export type RcsbLigandFormat = 'cif' | 'sdf';

// ---------------------------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------------------------

/**
 * A PDB entry id: four characters, a digit 1-9 then three letters or digits, in any case and with
 * surrounding whitespace ignored. Returned upper-case. The extended `pdb_0000XXXX` form is refused.
 */
export function normalizeEntryId(raw: string): string {
  const id = String(raw).trim();
  if (/^pdb_[0-9a-z]{8}$/i.test(id)) {
    throw new Error(`Extended PDB entry id ${JSON.stringify(raw)} is not supported yet; use the four-character id.`);
  }
  if (!/^[1-9][0-9a-z]{3}$/i.test(id)) {
    throw new Error(`${JSON.stringify(raw)} is not a PDB entry id (four characters: a digit 1-9, then three letters or digits).`);
  }
  return id.toUpperCase();
}

function positiveInteger(raw: number | string, what: string): string {
  const text = String(raw).trim();
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`${JSON.stringify(raw)} is not an RCSB ${what} (a positive whole number).`);
  return text;
}

/** An mmCIF label_asym_id: one to four letters or digits, used as given. */
function chainId(raw: string): string {
  if (!/^[0-9a-z]{1,4}$/i.test(raw)) throw new Error(`${JSON.stringify(raw)} is not a chain id (one to four letters or digits).`);
  return raw;
}

function formatOf<T extends string>(format: T, allowed: readonly T[]): T {
  if (!allowed.includes(format)) throw new Error(`${JSON.stringify(format)} is not a file format RCSB serves here (${allowed.join(' or ')}).`);
  return format;
}

/** A Chemical Component Dictionary id: one to five letters or digits, returned upper-case. */
function ligandId(raw: string): string {
  const id = String(raw).trim();
  if (!/^[0-9a-z]{1,5}$/i.test(id)) throw new Error(`${JSON.stringify(raw)} is not a ligand id (one to five letters or digits).`);
  return id.toUpperCase();
}

// ---------------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------------

/** Entry coordinates, uncompressed mmCIF (default) or legacy PDB. */
export const entryFileUrl = (entry: string, format: RcsbStructureFormat = 'cif'): string =>
  `${FILES}/download/${normalizeEntryId(entry)}.${formatOf(format, ['cif', 'pdb'])}`;

/** A biological assembly's coordinates as mmCIF. */
export const assemblyFileUrl = (entry: string, assembly: number | string): string =>
  `${FILES}/download/${normalizeEntryId(entry)}-assembly${positiveInteger(assembly, 'assembly id')}.cif`;

/** FASTA of every polymer entity in the entry. */
export const entryFastaUrl = (entry: string): string => `${FASTA}/entry/${normalizeEntryId(entry)}/download`;

/** FASTA of one polymer entity. */
export const entityFastaUrl = (entry: string, entity: number | string): string =>
  `${FASTA}/entity/${normalizeEntryId(entry)}_${positiveInteger(entity, 'entity id')}/download`;

/** FASTA of one chain, by its label_asym_id. */
export const chainFastaUrl = (entry: string, asymId: string): string =>
  `${FASTA}/chain/${normalizeEntryId(entry)}.${chainId(asymId)}/download`;

/** A Chemical Component Dictionary ligand: the ideal-coordinate SDF (default) or its mmCIF definition. */
export const ligandFileUrl = (ccd: string, format: RcsbLigandFormat = 'sdf'): string =>
  `${FILES}/ligands/download/${ligandId(ccd)}${formatOf(format, ['cif', 'sdf']) === 'cif' ? '.cif' : '_ideal.sdf'}`;

/** Data API: the entry object. */
export const entryDataUrl = (entry: string): string => `${DATA}/entry/${normalizeEntryId(entry)}`;

/** Data API: one polymer entity. */
export const polymerEntityDataUrl = (entry: string, entity: number | string): string =>
  `${DATA}/polymer_entity/${normalizeEntryId(entry)}/${positiveInteger(entity, 'entity id')}`;

/** Data API: one polymer entity instance (chain), by its label_asym_id. */
export const polymerEntityInstanceDataUrl = (entry: string, asymId: string): string =>
  `${DATA}/polymer_entity_instance/${normalizeEntryId(entry)}/${chainId(asymId)}`;

/** Data API: one biological assembly. */
export const assemblyDataUrl = (entry: string, assembly: number | string): string =>
  `${DATA}/assembly/${normalizeEntryId(entry)}/${positiveInteger(assembly, 'assembly id')}`;

/** Data API: one chemical component. */
export const chemCompDataUrl = (ccd: string): string => `${DATA}/chemcomp/${ligandId(ccd)}`;

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

export interface RcsbFetchOptions {
  /** The fetch to call (default `globalThis.fetch`). */
  fetch?: typeof globalThis.fetch;
  /** Retries after an HTTP 429, so `retries + 1` attempts at most (default 3). */
  retries?: number;
  /** The first wait after a 429 in ms, doubled for each later one (default 1000). */
  baseDelayMs?: number;
  /** How to wait (default `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
}

/** RCSB answered with an HTTP error status. */
export class RcsbHttpError extends Error {
  constructor(readonly url: string, readonly status: number, readonly attempts: number, statusText = '') {
    const label = status === 429 ? ' (rate limited)' : statusText ? ` ${statusText}` : '';
    super(`RCSB request to ${url} failed with HTTP ${status}${label} after ${attempts} attempt${attempts === 1 ? '' : 's'}.`);
    this.name = 'RcsbHttpError';
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The wait a Retry-After header asks for, in ms, or null when it is absent or unreadable. */
function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const text = header.trim();
  if (/^[0-9]+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function assertRcsbHost(url: string): void {
  let origin: string;
  try { origin = new URL(url).origin; } catch { origin = ''; }
  if (!(RCSB_HOSTS as readonly string[]).includes(origin)) throw new Error(`${url} is not one of the RCSB hosts the client may contact.`);
}

/**
 * Sends one request to an RCSB host and returns the response once its status is 2xx. HTTP 429 is
 * retried after `baseDelayMs`, then twice that, and so on, or after the Retry-After the response
 * names; once the retries are spent, or on any other non-2xx status, it throws `RcsbHttpError`.
 * A network failure is thrown at once, naming the URL. A 204 is returned as is, body unread.
 */
export async function rcsbFetch(url: string, init?: RequestInit, options: RcsbFetchOptions = {}): Promise<Response> {
  const { fetch = globalThis.fetch, retries = 3, baseDelayMs = 1000, sleep = wait } = options;
  if (!Number.isInteger(retries) || retries < 0) throw new Error(`retries must be a whole number of zero or more, not ${retries}.`);
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) throw new Error(`baseDelayMs must be zero or more, not ${baseDelayMs}.`);
  assertRcsbHost(url);
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      throw new Error(`RCSB request to ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
    if (res.ok) return res;
    if (res.status !== 429 || attempt > retries) throw new RcsbHttpError(url, res.status, attempt, res.statusText);
    await sleep(retryAfterMs(res.headers.get('Retry-After')) ?? baseDelayMs * 2 ** (attempt - 1));
  }
}

/** A response's body as text; an empty body is an error, not a file. */
async function bodyText(res: Response, url: string): Promise<string> {
  const text = await res.text();
  if (text.trim() === '') throw new Error(`RCSB returned an empty response from ${url}.`);
  return text;
}

function parseJson(text: string, url: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`RCSB returned a response that is not JSON from ${url}.`);
  }
}

/** GETs an RCSB file as text; an empty body is an error, not a file. */
export async function rcsbText(url: string, options?: RcsbFetchOptions): Promise<string> {
  return bodyText(await rcsbFetch(url, undefined, options), url);
}

/** GETs an RCSB Data API object as parsed JSON. */
export async function rcsbJson(url: string, options?: RcsbFetchOptions): Promise<unknown> {
  return parseJson(await rcsbText(url, options), url);
}

// ---------------------------------------------------------------------------------------------
// Entry summary
// ---------------------------------------------------------------------------------------------

export interface RcsbEntrySummary {
  id: string;
  /** struct.title, or null when the entry has none. */
  title: string | null;
  /** exptl[].method, e.g. "X-RAY DIFFRACTION". */
  methods: string[];
  /** rcsb_entry_info.resolution_combined in Å; empty when the entry reports none (e.g. NMR). */
  resolution: number[];
  /** rcsb_accession_info.initial_release_date as YYYY-MM-DD, or null when absent. */
  releaseDate: string | null;
  /** rcsb_entry_container_identifiers.polymer_entity_ids. */
  polymerEntityIds: string[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value at `path`; undefined when any step is absent or null, an error when a step is not an object. */
function at(root: Json, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (node === undefined || node === null) return undefined;
    if (!isObject(node)) throw new Error(`RCSB entry: ${path} is malformed.`);
    node = node[key];
  }
  return node ?? undefined;
}

function listAt<T>(root: Json, path: string, item: (v: unknown) => T | undefined): T[] {
  const value = at(root, path);
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value.map(item) : undefined;
  if (!items || items.some((v) => v === undefined)) throw new Error(`RCSB entry: ${path} is malformed.`);
  return items as T[];
}

function stringAt(root: Json, path: string): string | null {
  const value = at(root, path);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`RCSB entry: ${path} is malformed.`);
  return value;
}

const asString = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Title, methods, resolution, release date and polymer entity ids of a Data API entry object. */
export function summarizeEntry(entry: unknown): RcsbEntrySummary {
  if (!isObject(entry)) throw new Error('RCSB entry: the response is not a JSON object.');
  const id = stringAt(entry, 'rcsb_id');
  if (!id) throw new Error('RCSB entry: rcsb_id is missing.');
  const released = stringAt(entry, 'rcsb_accession_info.initial_release_date');
  if (released !== null && !/^\d{4}-\d{2}-\d{2}/.test(released)) throw new Error('RCSB entry: rcsb_accession_info.initial_release_date is malformed.');
  return {
    id,
    title: stringAt(entry, 'struct.title'),
    methods: listAt(entry, 'exptl', (e) => (isObject(e) ? asString(e.method) : undefined)),
    resolution: listAt(entry, 'rcsb_entry_info.resolution_combined', (r) => (typeof r === 'number' && Number.isFinite(r) ? r : undefined)),
    releaseDate: released === null ? null : released.slice(0, 10),
    polymerEntityIds: listAt(entry, 'rcsb_entry_container_identifiers.polymer_entity_ids', asString),
  };
}

/** Fetches a Data API entry object and summarises it. */
export async function fetchEntrySummary(entry: string, options?: RcsbFetchOptions): Promise<RcsbEntrySummary> {
  return summarizeEntry(await rcsbJson(entryDataUrl(entry), options));
}

// ---------------------------------------------------------------------------------------------
// Search API v2
// ---------------------------------------------------------------------------------------------

/** The Search API v2 endpoint; every search is one JSON POST to it. */
export const RCSB_SEARCH_URL = 'https://search.rcsb.org/rcsbsearch/v2/query';

/** What a search returns, from whole entries down to chemical component definitions. */
export const RCSB_RETURN_TYPES = ['entry', 'polymer_entity', 'assembly', 'polymer_instance', 'non_polymer_entity', 'mol_definition'] as const;
export type RcsbReturnType = (typeof RCSB_RETURN_TYPES)[number];

const SEQUENCE_TYPES = ['protein', 'dna', 'rna'] as const;
export type RcsbSequenceType = (typeof SEQUENCE_TYPES)[number];
const PATTERN_TYPES = ['simple', 'prosite', 'regex'] as const;
export type RcsbPatternType = (typeof PATTERN_TYPES)[number];
const SHAPE_OPERATORS = ['strict_shape_match', 'relaxed_shape_match'] as const;
export type RcsbShapeOperator = (typeof SHAPE_OPERATORS)[number];

/**
 * The cutoffs a sequence search uses unless the caller states others: an E-value of 0.1 (the one
 * fetch.sh's recorded sequence search used) and 30 % identity (`identityCutoff` is a fraction, 0 to
 * 1), chosen to keep distant homologues where the recording's 0.9 keeps only near-identical chains.
 */
export const RCSB_SEQUENCE_SEARCH_DEFAULTS = { evalueCutoff: 0.1, identityCutoff: 0.3 } as const;

/** The most rows the Search API returns in one page. */
const MAX_ROWS = 10000;

export interface RcsbSearchOptions {
  /** What the result set lists; each builder states its default. */
  returnType?: RcsbReturnType;
  /** The first result to return, counted from 0 (default 0). */
  start?: number;
  /** How many results to return, 1 to 10000 (default 10, the page RCSB returns when none is asked for). */
  rows?: number;
}

export interface RcsbSequenceSearchOptions extends RcsbSearchOptions {
  /** How RCSB reads the sequence; required, since ACGT read as protein is alanine, cysteine, glycine, threonine. */
  sequenceType: RcsbSequenceType;
  /** Hits with an E-value above this are dropped (default 0.1); greater than 0. */
  evalueCutoff?: number;
  /** Hits below this sequence identity, as a fraction 0 to 1, are dropped (default 0.3). */
  identityCutoff?: number;
}

export interface RcsbMotifSearchOptions extends RcsbSearchOptions {
  /** How RCSB reads the pattern: plain residues (`simple`), PROSITE syntax or a regular expression. */
  patternType: RcsbPatternType;
  sequenceType: RcsbSequenceType;
}

export interface RcsbShapeSearchOptions extends RcsbSearchOptions {
  /** The query entry's biological assembly (default 1). */
  assemblyId?: number | string;
  /** Strict or relaxed 3D shape match. */
  operator: RcsbShapeOperator;
}

type RcsbSearchService = 'full_text' | 'sequence' | 'seqmotif' | 'structure';

/** A Search API v2 request body: one terminal query, what to return, and the page. */
export interface RcsbSearchRequest {
  query: { type: 'terminal'; service: RcsbSearchService; parameters: Record<string, unknown> };
  return_type: RcsbReturnType;
  request_options: { paginate: { start: number; rows: number }; scoring_strategy?: 'sequence' };
}

export interface RcsbSearchHit {
  /** The entry, entity (`4HHB_1`), assembly (`4HHB-1`), instance or component id, as RCSB writes it. */
  identifier: string;
  /** RCSB's relevance score, 1 for the best hit. */
  score: number;
}

export interface RcsbSearchResult {
  /** The query_id RCSB assigned; null when it answered HTTP 204 (no hits). */
  queryId: string | null;
  resultType: RcsbReturnType;
  /** Every hit RCSB found, of which `hits` is the requested page. */
  totalCount: number;
  hits: RcsbSearchHit[];
}

function oneOf<T extends string>(value: T, allowed: readonly T[], what: string): T {
  if (!allowed.includes(value)) throw new Error(`${JSON.stringify(value) ?? String(value)} is not an RCSB ${what} (${allowed.join(', ')}).`);
  return value;
}

function nonEmpty(raw: string, what: string): string {
  const text = String(raw).trim();
  if (text === '') throw new Error(`The ${what} is empty.`);
  return text;
}

/**
 * The letters a search sequence of each type may hold. DNA takes the IUPAC nucleotide codes A C G T
 * R Y S W K M B D H V N, and RNA the same with U in place of T; protein takes the 20 standard
 * residues plus B (Asx), Z (Glx), X (any), U (selenocysteine) and O (pyrrolysine).
 */
const SEQUENCE_ALPHABETS: Record<RcsbSequenceType, { letters: string; label: string; article: string; takes: string }> = {
  protein: { letters: 'ACDEFGHIKLMNPQRSTVWYBZXUO', label: 'protein', article: 'a', takes: 'the 20 standard residues and B, Z, X, U, O' },
  dna: { letters: 'ACGTRYSWKMBDHVN', label: 'DNA', article: 'a', takes: 'the IUPAC nucleotide codes A C G T R Y S W K M B D H V N' },
  rna: { letters: 'ACGURYSWKMBDHVN', label: 'RNA', article: 'an', takes: 'the IUPAC nucleotide codes A C G U R Y S W K M B D H V N' },
};

/**
 * A sequence as RCSB takes it: whitespace removed, upper-case, and every letter in the alphabet of
 * its declared type (`SEQUENCE_ALPHABETS`, either case). Anything else is refused before a request
 * exists, naming the first offending character and its position, counted from 1 with whitespace removed.
 */
function residues(raw: string, type: RcsbSequenceType): string {
  const seq = String(raw).replace(/\s+/g, '');
  if (seq === '') throw new Error('The search sequence is empty.');
  const { letters, label, article, takes } = SEQUENCE_ALPHABETS[type];
  const bad = new RegExp(`[^${letters}${letters.toLowerCase()}]`, 'u').exec(seq);
  if (bad) throw new Error(`The ${label} search sequence has ${JSON.stringify(bad[0])} at position ${bad.index + 1}; ${article} ${label} sequence takes ${takes} only.`);
  return seq.toUpperCase();
}

function cutoff(value: number, what: string, ok: (v: number) => boolean, range: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !ok(value)) throw new Error(`The ${what} must be ${range}, not ${value}.`);
  return value;
}

function paginate({ start = 0, rows = 10 }: RcsbSearchOptions): { start: number; rows: number } {
  if (!Number.isInteger(start) || start < 0) throw new Error(`The search start must be a whole number of zero or more, not ${start}.`);
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) throw new Error(`The search rows must be a whole number from 1 to ${MAX_ROWS}, not ${rows}.`);
  return { start, rows };
}

function searchRequest(service: RcsbSearchService, parameters: Record<string, unknown>, returnType: RcsbReturnType,
  options: RcsbSearchOptions, scoring?: 'sequence'): RcsbSearchRequest {
  const return_type = oneOf(returnType, RCSB_RETURN_TYPES, 'return type');
  const paginated = paginate(options);
  return {
    query: { type: 'terminal', service, parameters },
    return_type,
    request_options: scoring ? { paginate: paginated, scoring_strategy: scoring } : { paginate: paginated },
  };
}

/** A full-text keyword search (default: return entries). */
export function fullTextQuery(text: string, options: RcsbSearchOptions = {}): RcsbSearchRequest {
  const value = nonEmpty(text, 'search text');
  return searchRequest('full_text', { value }, options.returnType ?? 'entry', options);
}

/**
 * An MMseqs2 sequence search (default: return polymer entities), ranked by sequence score, with the
 * cutoffs given or else `RCSB_SEQUENCE_SEARCH_DEFAULTS`. The sequence must be in the alphabet of the
 * declared `sequenceType` (`SEQUENCE_ALPHABETS`).
 */
export function sequenceQuery(sequence: string, options: RcsbSequenceSearchOptions): RcsbSearchRequest {
  const sequenceType = oneOf(options.sequenceType, SEQUENCE_TYPES, 'sequence type');
  const value = residues(sequence, sequenceType);
  const evalue = cutoff(options.evalueCutoff ?? RCSB_SEQUENCE_SEARCH_DEFAULTS.evalueCutoff, 'E-value cutoff', (v) => v > 0, 'greater than 0');
  const identity = cutoff(options.identityCutoff ?? RCSB_SEQUENCE_SEARCH_DEFAULTS.identityCutoff, 'identity cutoff', (v) => v >= 0 && v <= 1, 'a fraction from 0 to 1');
  return searchRequest('sequence', { evalue_cutoff: evalue, identity_cutoff: identity, sequence_type: sequenceType, value },
    options.returnType ?? 'polymer_entity', options, 'sequence');
}

/**
 * A sequence search with the active document's sequence, as protein. Refuses a missing document,
 * and a DNA, RNA or empty one by its name, before any request exists.
 */
export function sequenceDocumentQuery(doc: SequenceDocument | null | undefined,
  options: Omit<RcsbSequenceSearchOptions, 'sequenceType'> = {}): RcsbSearchRequest {
  if (!doc) throw new Error('There is no active document to search RCSB with.');
  const name = JSON.stringify(doc.name);
  if (doc.moleculeType !== 'Protein') throw new Error(`${name} holds ${doc.moleculeType}; RCSB sequence search here takes a protein document.`);
  if (String(doc.sequence ?? '').trim() === '') throw new Error(`${name} has no sequence to search RCSB with.`);
  return sequenceQuery(doc.sequence, { ...options, sequenceType: 'protein' });
}

/** A sequence motif search (default: return polymer entities). */
export function seqmotifQuery(pattern: string, options: RcsbMotifSearchOptions): RcsbSearchRequest {
  const value = nonEmpty(pattern, 'motif pattern');
  const patternType = oneOf(options.patternType, PATTERN_TYPES, 'pattern type');
  const sequenceType = oneOf(options.sequenceType, SEQUENCE_TYPES, 'sequence type');
  return searchRequest('seqmotif', { value, pattern_type: patternType, sequence_type: sequenceType }, options.returnType ?? 'polymer_entity', options);
}

/** A 3D shape search from one assembly of an entry (default: return assemblies). */
export function structureQuery(entry: string, options: RcsbShapeSearchOptions): RcsbSearchRequest {
  const value = { entry_id: normalizeEntryId(entry), assembly_id: positiveInteger(options.assemblyId ?? 1, 'assembly id') };
  const operator = oneOf(options.operator, SHAPE_OPERATORS, 'shape operator');
  return searchRequest('structure', { value, operator }, options.returnType ?? 'assembly', options);
}

/** A Search API response as its result set; anything that is not one is refused, naming the field. */
export function parseSearchResponse(response: unknown): RcsbSearchResult {
  if (!isObject(response)) throw new Error('RCSB search: the response is not a JSON object.');
  const { query_id: queryId, result_type: resultType, total_count: totalCount, result_set: resultSet } = response;
  if (queryId === undefined || queryId === null) throw new Error('RCSB search: query_id is missing.');
  if (typeof queryId !== 'string') throw new Error('RCSB search: query_id is malformed.');
  if (queryId.trim() === '') throw new Error('RCSB search: query_id is empty.');
  if (!(RCSB_RETURN_TYPES as readonly unknown[]).includes(resultType)) throw new Error(`RCSB search: result_type ${JSON.stringify(resultType) ?? 'undefined'} is not a known result type.`);
  if (typeof totalCount !== 'number' || !Number.isInteger(totalCount) || totalCount < 0) throw new Error('RCSB search: total_count is malformed.');
  if (!Array.isArray(resultSet)) throw new Error('RCSB search: result_set is malformed.');
  const hits = resultSet.map((hit: unknown, i) => {
    if (!isObject(hit) || typeof hit.identifier !== 'string' || hit.identifier === '' || typeof hit.score !== 'number' || !Number.isFinite(hit.score)) {
      throw new Error(`RCSB search: result_set[${i}] is malformed.`);
    }
    return { identifier: hit.identifier, score: hit.score };
  });
  if (totalCount < hits.length) throw new Error(`RCSB search: total_count ${totalCount} is less than the ${hits.length} hits returned.`);
  return { queryId, resultType: resultType as RcsbReturnType, totalCount, hits };
}

/**
 * Sends a search and returns its result set. HTTP 204 is RCSB's answer for no hits and comes back
 * as an empty result; an empty or non-JSON 200, an error status, or a result set of another type
 * than the one asked for is an error.
 */
export async function searchRcsb(request: RcsbSearchRequest, options?: RcsbFetchOptions): Promise<RcsbSearchResult> {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) };
  const res = await rcsbFetch(RCSB_SEARCH_URL, init, options);
  if (res.status === 204) return { queryId: null, resultType: request.return_type, totalCount: 0, hits: [] };
  const result = parseSearchResponse(parseJson(await bodyText(res, RCSB_SEARCH_URL), RCSB_SEARCH_URL));
  if (result.resultType !== request.return_type) {
    throw new Error(`RCSB search: asked for ${request.return_type} results but RCSB returned ${result.resultType}.`);
  }
  return result;
}
