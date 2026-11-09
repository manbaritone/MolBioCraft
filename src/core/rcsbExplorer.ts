// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Database Explorer's RCSB PDB search and open, without the UI (US-01M6PB7M, D0008).
 *
 * `RcsbExplorerSession` holds what the explorer shows: the query, the hits of the last search with
 * each entry's summary, and the last notice or error. It contacts RCSB only from `search()` and
 * `open()`, the two things a user does; creating it, reading it and typing into it send nothing.
 * `rcsbPanelActions` is the panel's controller: every handler the panel's controls carry, as plain
 * functions over a session, so what each control does is tested without a DOM.
 *
 * Every request goes through `rcsbClient` (so through `rcsbFetch`'s host guard and 429 backoff),
 * through one limiter, so the app never has more than `RCSB_MAX_IN_FLIGHT` explorer requests
 * running (an aborted one gives its slot up as it is aborted, which the browser's fetch stops at
 * once), and through one start gate, so no more than `RCSB_MAX_STARTS_PER_SECOND` begin in any
 * one-second window (D0008's "a handful of requests per second"). The limiter and the gate belong
 * to the module, not to a session, so every explorer the app opens shares them. The gate sits on
 * the fetch itself, so each retry after a 429 counts as the request it is. A newer search aborts
 * the requests of the one it replaces: those still waiting never start, and those running are
 * cancelled and give their slot up.
 *
 * A search returns identifiers only, so each hit's title, methods and resolution come from its
 * Data API entry object, fetched after the search. Opening an entry downloads its mmCIF from
 * files.rcsb.org (FASTA from www.rcsb.org would fail CORS in the webview: BG-01M6PDXC) and hands it,
 * named `<ID>.cif` as in its download URL, to the file import the caller passes in.
 */

import {
  RcsbHttpError, entryFileUrl, fetchEntrySummary, fullTextQuery, rcsbText, searchRcsb, sequenceDocumentQuery,
  type RcsbEntrySummary, type RcsbFetchOptions, type RcsbSearchRequest,
} from './rcsbClient';
import type { SequenceDocument } from '../types/bio';

/** The most RCSB requests the app's explorers have running at once (a cap on concurrency, not on rate). */
export const RCSB_MAX_IN_FLIGHT = 4;

/** The most RCSB requests the app's explorers start in any one-second window. */
export const RCSB_MAX_STARTS_PER_SECOND = 5;

/** How many hits one search lists. */
export const RCSB_EXPLORER_ROWS = 10;

/** Runs `task` once a slot is free; a task whose `signal` aborts first never runs. */
export type Limiter = <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

/**
 * Runs tasks with at most `limit` running at once; the others wait, in the order they arrived. A
 * finished task, fulfilled or rejected, hands its slot straight to the next waiting one. A task
 * whose `signal` aborts while it waits leaves the queue at once, rejected with the abort reason and
 * never run; one whose `signal` aborts while it runs gives its slot up at once (its own promise
 * still settles when the task does).
 */
export function createLimiter(limit: number): Limiter {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`The request limit must be a whole number of 1 or more, not ${limit}.`);
  let running = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
  return async (task, signal) => {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      if (running < limit) {
        running++;
        return resolve();
      }
      const drop = () => {
        waiting.splice(waiting.indexOf(take), 1);
        reject(signal!.reason);
      };
      // Handed a slot during the very abort that is about to drop it: pass the slot on instead.
      const take = () => {
        signal?.removeEventListener('abort', drop);
        if (signal?.aborted) {
          release();
          reject(signal.reason);
        } else resolve();
      };
      waiting.push(take);
      signal?.addEventListener('abort', drop, { once: true });
    });
    let held = true;
    const giveUp = () => {
      if (!held) return;
      held = false;
      release();
    };
    signal?.addEventListener('abort', giveUp, { once: true });
    try {
      return await task();
    } finally {
      signal?.removeEventListener('abort', giveUp);
      giveUp();
    }
  };
}

/** Resolves when one more request may start; rejects at once, using no start, if `signal` aborts first. */
export type StartGate = (signal?: AbortSignal) => Promise<void>;

/**
 * A start gate: each call resolves when one more start is allowed, in the order the calls were made,
 * so that no more than `maxStarts` starts fall in any window [t, t + `windowMs`). A start waits
 * until the `maxStarts`-th start before it is `windowMs` old. A call whose `signal` is aborted, or
 * aborts while it waits, is refused at once and uses no start. Reads the clock with `Date.now` and
 * waits with `setTimeout`.
 */
export function createStartGate(maxStarts: number, windowMs: number): StartGate {
  if (!Number.isInteger(maxStarts) || maxStarts < 1) throw new Error(`The start limit must be a whole number of 1 or more, not ${maxStarts}.`);
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error(`The start window must be more than 0 ms, not ${windowMs}.`);
  const recent: number[] = [];
  const waiting: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const admit = () => {
    timer = null;
    while (waiting.length > 0) {
      const now = Date.now();
      while (recent.length > 0 && recent[0] <= now - windowMs) recent.shift();
      if (recent.length >= maxStarts) {
        timer = setTimeout(admit, recent[0] + windowMs - now);
        return;
      }
      recent.push(now);
      waiting.shift()!();
    }
  };
  return (signal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const drop = () => {
      waiting.splice(waiting.indexOf(start), 1);
      reject(signal!.reason);
    };
    const start = () => {
      signal?.removeEventListener('abort', drop);
      resolve();
    };
    waiting.push(start);
    signal?.addEventListener('abort', drop, { once: true });
    if (timer === null) admit();
  });
}

/** The limiter and start gate every explorer session shares, so the caps hold for the app. */
let budget = { limit: createLimiter(RCSB_MAX_IN_FLIGHT), startGate: createStartGate(RCSB_MAX_STARTS_PER_SECOND, 1000) };

/** Replaces the app's shared request budget with an unused one (for tests: one test's requests must not hold up the next). */
export function resetRcsbRequestBudget(): void {
  budget = { limit: createLimiter(RCSB_MAX_IN_FLIGHT), startGate: createStartGate(RCSB_MAX_STARTS_PER_SECOND, 1000) };
}

/**
 * What went wrong, which decides how the explorer heads it:
 * - `input`: refused before any request was sent (an empty keyword box, a DNA or removed document);
 * - `network`: a request was sent and no HTTP answer came back (offline, connection refused, CORS);
 * - `http`: RCSB answered with an error status;
 * - `response`: RCSB answered 2xx with something that is not what was asked for (empty, not JSON, malformed);
 * - `import`: RCSB sent the file and the workbench's import refused it.
 */
export type RcsbExplorerErrorKind = 'input' | 'network' | 'http' | 'response' | 'import';

export interface RcsbExplorerError {
  kind: RcsbExplorerErrorKind;
  /** What happened, without the HTTP status (the heading carries it). */
  message: string;
  /** The HTTP status RCSB answered with; null for every kind but `http`. */
  status: number | null;
}

/** The fetch itself failed: no HTTP answer arrived. rcsbFetch keeps it as the cause of the error it throws. */
class NoHttpAnswer extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'NoHttpAnswer';
  }
}

function causedByNoHttpAnswer(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) if (e instanceof NoHttpAnswer) return true;
  return false;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * An error as the explorer shows it. An HTTP error status is `http` and a fetch that got no answer
 * is `network`, whatever step they came from; anything else is the `kind` of the step that failed.
 */
export function explorerError(err: unknown, kind: 'input' | 'response' | 'import'): RcsbExplorerError {
  if (err instanceof RcsbHttpError) {
    return { kind: 'http', status: err.status, message: `RCSB request to ${err.url} failed after ${err.attempts} attempt${err.attempts === 1 ? '' : 's'}.` };
  }
  return { kind: causedByNoHttpAnswer(err) ? 'network' : kind, status: null, message: messageOf(err) };
}

/** The heading an error is shown under: what happened, and the HTTP status only when RCSB answered with one. */
export function errorHeading(error: RcsbExplorerError): string {
  switch (error.kind) {
    case 'input': return 'Not sent to RCSB';
    case 'network': return 'No response from RCSB';
    case 'http': return `RCSB answered HTTP ${error.status}${error.status === 429 ? ' (rate limited)' : ''}`;
    case 'response': return "RCSB's answer could not be read";
    case 'import': return 'RCSB sent the file but it could not be imported';
  }
}

export type RcsbHitSummary =
  | { state: 'loading' }
  | { state: 'loaded'; summary: RcsbEntrySummary }
  | { state: 'failed'; error: RcsbExplorerError };

export interface RcsbExplorerHit {
  /** The entry id as RCSB returned it. */
  id: string;
  score: number;
  summary: RcsbHitSummary;
}

export interface RcsbExplorerState {
  /** The keyword text. */
  query: string;
  /** The protein document whose sequence is searched instead of the keywords, or null. */
  sequenceDocumentId: string | null;
  searching: boolean;
  /** Entries being downloaded and opened. */
  opening: readonly string[];
  /** Every entry the last search found, of which `hits` is the first page; null when no search result is shown. */
  totalCount: number | null;
  hits: readonly RcsbExplorerHit[];
  error: RcsbExplorerError | null;
  notice: string | null;
}

/** What the workbench's file import answers: how many files it imported, and why each other one failed. */
export interface FileImportResult {
  imported: number;
  failed: { name: string; message: string }[];
}
export type ImportFiles = (files: File[]) => Promise<FileImportResult>;

/** A trailing stop (`*`) dropped, once: RCSB sequence search refuses any `*`. */
export function withoutTrailingStop(doc: SequenceDocument): SequenceDocument {
  const sequence = String(doc.sequence ?? '').replace(/\s+$/, '');
  return sequence.endsWith('*') ? { ...doc, sequence: sequence.slice(0, -1) } : doc;
}

/** Resolution as listed: "1.74 Å", or null when the entry reports none (e.g. NMR). */
export function formatResolution(summary: RcsbEntrySummary): string | null {
  return summary.resolution.length ? `${summary.resolution.map((r) => r.toFixed(2)).join(', ')} Å` : null;
}

const INITIAL: RcsbExplorerState = {
  query: '', sequenceDocumentId: null, searching: false, opening: [], totalCount: null, hits: [], error: null, notice: null,
};

export class RcsbExplorerSession {
  private state: RcsbExplorerState = INITIAL;
  private readonly listeners = new Set<() => void>();
  /** Counts searches, so the results of one a newer search replaced are dropped. */
  private generation = 0;
  /** Aborts the requests of the search on show when a newer one replaces it. */
  private searchAbort: AbortController | null = null;

  /** `options` go to every rcsbClient call (tests pass a stub fetch and sleep). */
  constructor(private readonly options: RcsbFetchOptions = {}) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getSnapshot = (): RcsbExplorerState => this.state;

  private update(patch: Partial<RcsbExplorerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  setQuery(query: string): void {
    this.update({ query });
  }

  setSequenceDocument(id: string | null): void {
    this.update({ sequenceDocumentId: id });
  }

  /**
   * Runs one rcsbClient call within the app's budget: it takes a limiter slot, and each fetch it
   * makes waits at the start gate and carries `signal`. A fetch that throws is marked as having had
   * no HTTP answer, so `explorerError` can tell it from an answer that failed.
   */
  private send<T>(call: (client: RcsbFetchOptions) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const { options } = this;
    const client: RcsbFetchOptions = {
      ...options,
      fetch: async (input, init) => {
        await budget.startGate(signal);
        try {
          return await (options.fetch ?? globalThis.fetch)(input, signal ? { ...init, signal } : init);
        } catch (err) {
          throw new NoHttpAnswer(err);
        }
      },
    };
    return budget.limit(() => call(client), signal);
  }

  private request(documents: readonly SequenceDocument[]): RcsbSearchRequest {
    const { query, sequenceDocumentId } = this.state;
    if (sequenceDocumentId === null) return fullTextQuery(query, { rows: RCSB_EXPLORER_ROWS });
    const doc = documents.find((d) => d.id === sequenceDocumentId);
    if (!doc) throw new Error('The protein document chosen to search with is no longer in the workspace.');
    return sequenceDocumentQuery(withoutTrailingStop(doc), { returnType: 'entry', rows: RCSB_EXPLORER_ROWS });
  }

  /**
   * Searches RCSB for entries with the keywords, or with the chosen protein document's sequence (one
   * of `documents`), lists the hits, then fills in each one's summary as it arrives. Replaces the
   * search on show: its requests are aborted and its late answers dropped. Never rejects: a refused
   * query or a failed request is the state's `error`, a failed summary its hit's.
   */
  async search(documents: readonly SequenceDocument[] = []): Promise<void> {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.searchAbort?.abort();
    const { signal } = (this.searchAbort = new AbortController());
    this.update({ searching: true, totalCount: null, hits: [], error: null, notice: null });
    let hits: RcsbExplorerHit[];
    let step: 'input' | 'response' = 'input';
    try {
      const request = this.request(documents);
      step = 'response';
      const result = await this.send((client) => searchRcsb(request, client), signal);
      if (!current()) return;
      hits = result.hits.map((hit) => ({ id: hit.identifier, score: hit.score, summary: { state: 'loading' } }));
      this.update({ searching: false, totalCount: result.totalCount, hits });
    } catch (err) {
      if (current()) this.update({ searching: false, error: explorerError(err, step) });
      return;
    }
    const settle = (index: number, summary: RcsbHitSummary) => {
      if (!current()) return;
      const next = this.state.hits.slice();
      next[index] = { ...next[index], summary };
      this.update({ hits: next });
    };
    await Promise.all(hits.map((hit, index) => this.send((client) => fetchEntrySummary(hit.id, client), signal).then(
      (summary) => settle(index, { state: 'loaded', summary }),
      (err: unknown) => settle(index, { state: 'failed', error: explorerError(err, 'response') }),
    )));
  }

  /**
   * Downloads the entry's mmCIF and hands it to `importFiles` as `<ID>.cif`. An entry already being
   * opened is not opened again. Never rejects: a failed download or import is the state's `error`,
   * a success its `notice`.
   */
  async open(entryId: string, importFiles: ImportFiles): Promise<void> {
    if (this.state.opening.includes(entryId)) return;
    this.update({ opening: [...this.state.opening, entryId], error: null, notice: null });
    const done = (patch: Partial<RcsbExplorerState>) =>
      this.update({ ...patch, opening: this.state.opening.filter((id) => id !== entryId) });
    let step: 'input' | 'response' | 'import' = 'input';
    try {
      const url = entryFileUrl(entryId, 'cif');
      const name = url.slice(url.lastIndexOf('/') + 1);
      step = 'response';
      const text = await this.send((client) => rcsbText(url, client));
      step = 'import';
      let result: FileImportResult;
      try {
        result = await importFiles([new File([text], name, { type: 'chemical/x-mmcif' })]);
      } catch (err) {
        throw new Error(`${name}: ${messageOf(err)}`);
      }
      if (result.failed.length > 0 || result.imported < 1) {
        throw new Error(`${name}: ${result.failed.map((f) => f.message).join('; ') || 'the workbench imported nothing'}`);
      }
      done({ notice: `Opened ${name} from RCSB PDB in the workspace.` });
    } catch (err) {
      done({ error: explorerError(err, step) });
    }
  }
}

/** The event shapes the panel's handlers read: the field's value, the form's default action, the clicked button's value. */
export interface PanelFieldEvent { target: { value: string } }
export interface PanelSubmitEvent { preventDefault(): void }
export interface PanelButtonEvent { currentTarget: { value: string } }

/** Every handler the RCSB panel's controls carry; the panel passes them through untouched. */
export interface RcsbPanelActions {
  /** Whether Open can import anything (the window was given the workbench's file import). */
  canOpen: boolean;
  /** The keyword box changed: the query is shown, nothing is sent. */
  onQueryChange: (event: PanelFieldEvent) => void;
  /** "Search RCSB PDB by" changed: '' is keywords, anything else a protein document's id; nothing is sent. */
  onModeChange: (event: PanelFieldEvent) => void;
  /** The search form was submitted (Search RCSB or Enter): one search with the query as it stands. */
  onSubmit: (event: PanelSubmitEvent) => void;
  /** An Open mmCIF button was pressed: opens the entry the button's value names, unless it is already opening. */
  onOpen: (event: PanelButtonEvent) => void;
}

/** The RCSB panel's controller: what each of its controls does to `session`. */
export function rcsbPanelActions(session: RcsbExplorerSession, documents: readonly SequenceDocument[], importFiles?: ImportFiles): RcsbPanelActions {
  return {
    canOpen: importFiles !== undefined,
    onQueryChange: (event) => session.setQuery(event.target.value),
    onModeChange: (event) => session.setSequenceDocument(event.target.value || null),
    onSubmit: (event) => {
      event.preventDefault();
      void session.search(documents);
    },
    onOpen: (event) => {
      if (importFiles) void session.open(event.currentTarget.value, importFiles);
    },
  };
}
