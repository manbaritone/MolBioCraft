// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Databases > Restriction Enzymes (US-01M7DVDV): the built-in catalogue, read-only, beside the
 * user's own definitions (US-01M7DVMJ's store), with an editor that adds, edits or clones one and
 * shows its double-strand cut before it is saved.
 *
 * The preview is a real engine scan: the definition's motif is planted between fixed flank bases
 * (the probe), scanned with the definition as the one enzyme, and the engine's site at the planted
 * position is drawn by the Enzymes view's own {@link CleavageDrawing}. A site the engine does not
 * report is not drawn, never stood in for by a record built here.
 *
 * The window is also the caller of the store's backup and failure paths (US-01M7GJ5R): Export saves
 * the versioned JSON backup through the platform save path and says Exported only for a file the
 * platform says it wrote; Import adds the new ids and holds each differing id, and each built-in
 * name the store reports as unconfirmed, for a per-id choice; a refused file is named with its
 * reason; an unreadable store is named, never listed as empty, and discarded only on an explicit
 * choice; a write the storage refuses is reported as nothing saved.
 *
 * Below the Custom table the window keeps the named enzyme collections (US-01M7DV72, D0158): New,
 * Rename and Delete, and a member picker over the active list from the window's own read (the
 * catalogue alone when the store cannot be read). A member is named by its label, never by a custom
 * id; one whose definition is gone, or cannot be read, is kept and named for why. A collection write
 * reads no scan, so it does not call `onChange`.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomEnzymeDefinition, MethylationSensitivity, RestrictionCutSite, RestrictionEnzyme } from '../types/bio';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { CUSTOM_ENZYME_NO_LONGER_STORED, activeEnzymeList, enzymeLabel, scanRestrictionSites } from '../core/bioEngine';
import { enzymeKey } from '../core/restrictionDisplay';
import { complementAligned } from '../core/alignmentViewModel';
import {
  MAX_CUSTOM_MOTIF_LENGTH,
  METHYLATION_SENSITIVITIES,
  openEnzymeCollections,
  openEnzymeDatabase,
  validateFields,
  type CustomEnzymeInput,
  type EnzymeDatabase,
  type EnzymeDbError,
  type EnzymeDbRead,
  type EnzymeDbResult,
  type EnzymeField,
  type EnzymeFieldError,
  type EnzymeImportSummary,
} from '../core/enzymeDatabase';
import { CleavageDrawing } from './CleavagePreview';
import { savePlatformFile, type PlatformSaveResult } from './PrimerDatabaseWindow';

// ─── The probe ───

/** Bases the picture shows beyond the motif and both cuts (the CleavageDrawing default). */
export const PREVIEW_CONTEXT_BASES = 4;
/** The longest flank the preview builds, so an offset of millions never builds a probe of millions. */
export const MAX_PREVIEW_FLANK = 1000;

/** Each IUPAC letter's first allowed base in A, C, G, T order (U is read as T, as the scan reads it). */
const FIRST_ALLOWED: Readonly<Record<string, string>> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: 'A', Y: 'C', S: 'C', W: 'A', K: 'G', M: 'A',
  B: 'C', D: 'A', H: 'A', V: 'A', N: 'A',
};

/** The motif with each degenerate letter resolved to the first base it allows (A, C, G, T order). */
export function plantedMotif(motif: string): string {
  return [...motif.toUpperCase()].map((c) => {
    const base = FIRST_ALLOWED[c];
    if (!base) throw new Error(`plantedMotif: ${c} is not an IUPAC nucleotide code`);
    return base;
  }).join('');
}

/** How far the farthest cut lies beyond the motif on each side (0 for cuts within it). */
export function cutReach(motifLength: number, cutFwd: number, cutRev: number): { left: number; right: number } {
  return {
    left: Math.max(0, -Math.min(cutFwd, cutRev)),
    right: Math.max(0, Math.max(cutFwd, cutRev) - motifLength),
  };
}

/** A fixed run of bases: the same `n` bases for the same seed every time (a 32-bit LCG over ACGT). */
function fixedBases(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[s >>> 30];
  }
  return out;
}
const LEFT_SEED = 0x5eed1e;
const RIGHT_SEED = 0x5eed2f;

/**
 * The fixed flank of `n` bases on one side of the motif. Each side's bases are read outward from
 * the motif, so lengthening a flank adds bases at its far end and the bases next to the motif (and
 * any overhang among them) stay as they were.
 */
export function flankBases(side: 'left' | 'right', n: number): string {
  const run = fixedBases(side === 'left' ? LEFT_SEED : RIGHT_SEED, n);
  return side === 'left' ? [...run].reverse().join('') : run;
}

export interface PreviewProbe {
  sequence: string;
  /** 0-based start of the planted motif. */
  motifStart: number;
  motif: string;
  circular: boolean;
}

/** The probe a definition is previewed on: its left flank, its planted motif and its right flank. */
export function buildProbe(recognitionSeq: string, circular: boolean, flanks: { left: number; right: number }): PreviewProbe {
  const motif = plantedMotif(recognitionSeq);
  const left = flankBases('left', flanks.left);
  return { sequence: left + motif + flankBases('right', flanks.right), motifStart: left.length, motif, circular };
}

/**
 * The flank-length control's bounds and default on each side: the default is that side's reach plus
 * the picture's context bases; the minimum is 0 on a linear probe (a flank shorter than the reach is
 * the user's to choose) and the reach on a circular one, so a circle is never shorter than the motif
 * plus its cuts' reach. Neither exceeds {@link MAX_PREVIEW_FLANK}.
 */
export function flankBounds(motifLength: number, cutFwd: number, cutRev: number, circular: boolean) {
  const reach = cutReach(motifLength, cutFwd, cutRev);
  const side = (r: number) => ({
    min: circular ? r : 0,
    default: Math.min(MAX_PREVIEW_FLANK, r + PREVIEW_CONTEXT_BASES),
  });
  return { reach, left: side(reach.left), right: side(reach.right) };
}

export type DefinitionPreview =
  | { kind: 'refused'; errors: EnzymeFieldError[] }
  | { kind: 'site'; probe: PreviewProbe; site: RestrictionCutSite }
  | { kind: 'noSite'; probe: PreviewProbe; message: string }
  | { kind: 'unavailable'; message: string };

/** The engine's definition of a candidate: the fields the scan reads, with no supplier or buffer. */
function engineEnzyme(v: { name: string; recognitionSeq: string; cutFwd: number; cutRev: number; isTypeIIS: boolean; methylationSensitivity: MethylationSensitivity[] }): RestrictionEnzyme {
  return {
    name: v.name,
    recognitionSeq: v.recognitionSeq,
    cutFwd: v.cutFwd,
    cutRev: v.cutRev,
    isTypeIIS: v.isTypeIIS,
    suppliers: [],
    methylationSensitivity: [...v.methylationSensitivity],
    bufferNEB: '',
    tempC: 37,
  };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The preview of a candidate definition: refused when validation refuses it; otherwise the engine's
 * scan of its probe with the definition as the one enzyme, and the forward site the engine reports
 * at the planted motif's position. A site elsewhere in the flanks is never drawn instead; when the
 * engine reports none at the planted position (a linear probe whose end falls inside a cut's reach),
 * the outcome says how far past the probe's end the cut falls.
 */
export function previewDefinition(
  input: Record<string, unknown>,
  circular: boolean,
  flanks: { left: number; right: number },
  checkClonedFrom = true,
): DefinitionPreview {
  const valid = validateFields(input, checkClonedFrom);
  if (!valid.ok) return { kind: 'refused', errors: valid.error.fields };
  const v = valid.value;
  const bounds = flankBounds(v.recognitionSeq.length, v.cutFwd, v.cutRev, circular);
  if (bounds.left.min > MAX_PREVIEW_FLANK || bounds.right.min > MAX_PREVIEW_FLANK) {
    const far = Math.max(bounds.reach.left, bounds.reach.right);
    return { kind: 'unavailable', message: `A cut lies ${plural(far, 'base')} from the motif, beyond the ${MAX_PREVIEW_FLANK}-base flank a circular probe can hold, so it cannot be previewed.` };
  }
  const clampSide = (n: number, b: { min: number }) => Math.min(MAX_PREVIEW_FLANK, Math.max(b.min, Math.floor(n)));
  const probe = buildProbe(v.recognitionSeq, circular, { left: clampSide(flanks.left, bounds.left), right: clampSide(flanks.right, bounds.right) });
  let sites: RestrictionCutSite[];
  try {
    sites = scanRestrictionSites(probe.sequence, circular ? 'circular' : 'linear', [engineEnzyme(v)]).sites;
  } catch (err) {
    return { kind: 'unavailable', message: `The engine could not scan the probe: ${err instanceof Error ? err.message : String(err)}` };
  }
  const site = sites.find((s) => s.strand === 1 && s.position === probe.motifStart + 1);
  if (site) return { kind: 'site', probe, site };
  const len = probe.sequence.length;
  const cuts = [probe.motifStart + v.cutFwd, probe.motifStart + v.cutRev];
  const pastRight = Math.max(0, ...cuts.map((c) => c - len));
  const pastLeft = Math.max(0, ...cuts.map((c) => -c));
  if (!circular && (pastRight > 0 || pastLeft > 0)) {
    const n = Math.max(pastRight, pastLeft);
    const where = pastRight >= pastLeft ? 'after its last base' : 'before its first base';
    return { kind: 'noSite', probe, message: `The cut falls ${plural(n, 'base')} past the probe's end (${where}) and cannot be previewed.` };
  }
  return { kind: 'noSite', probe, message: 'The engine reports no site at the planted motif, so there is no cut to preview.' };
}

// ─── The window ───

/** Whether a query finds an enzyme: in its name (any case), or, with the query's spaces removed, in its motif (any case). */
export function enzymeMatchesSearch(e: { name: string; recognitionSeq: string }, query: string): boolean {
  const q = query.trim();
  if (q === '') return true;
  if (e.name.toLowerCase().includes(q.toLowerCase())) return true;
  const motif = q.replace(/\s+/g, '').toUpperCase();
  return motif !== '' && e.recognitionSeq.toUpperCase().includes(motif);
}

interface FormState {
  /** The stored definition being edited; null for a new one. */
  editId: string | null;
  name: string;
  recognitionSeq: string;
  cutFwd: string;
  cutRev: string;
  isTypeIIS: boolean;
  methylationSensitivity: MethylationSensitivity[];
  clonedFrom?: string;
  provenance: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  editId: null, name: '', recognitionSeq: '', cutFwd: '', cutRev: '', isTypeIIS: false, methylationSensitivity: [], provenance: '', notes: '',
};

/** A typed offset: a whole number as written, otherwise NaN, which validation refuses by name. */
const offsetOf = (text: string) => (/^\s*-?\d+\s*$/.test(text) ? Number(text) : Number.NaN);

function formInput(form: FormState): CustomEnzymeInput {
  const input: CustomEnzymeInput = {
    name: form.name,
    recognitionSeq: form.recognitionSeq,
    cutFwd: offsetOf(form.cutFwd),
    cutRev: offsetOf(form.cutRev),
    isTypeIIS: form.isTypeIIS,
    methylationSensitivity: [...form.methylationSensitivity],
    provenance: form.provenance,
    notes: form.notes,
  };
  if (form.clonedFrom !== undefined) input.clonedFrom = form.clonedFrom;
  return input;
}

/** The fields of `input` that differ from `stored`, as validation would store them. */
function editedFields(stored: CustomEnzymeDefinition, input: CustomEnzymeInput): Partial<CustomEnzymeInput> {
  const changes: Partial<CustomEnzymeInput> = {};
  if (input.name.trim() !== stored.name) changes.name = input.name;
  if (input.recognitionSeq.replace(/\s+/g, '').toUpperCase() !== stored.recognitionSeq) changes.recognitionSeq = input.recognitionSeq;
  if (input.cutFwd !== stored.cutFwd) changes.cutFwd = input.cutFwd;
  if (input.cutRev !== stored.cutRev) changes.cutRev = input.cutRev;
  if ((input.isTypeIIS ?? false) !== stored.isTypeIIS) changes.isTypeIIS = input.isTypeIIS;
  const m = input.methylationSensitivity ?? [];
  if (m.length !== stored.methylationSensitivity.length || m.some((x, i) => x !== stored.methylationSensitivity[i])) {
    changes.methylationSensitivity = m;
  }
  if ((input.provenance ?? '') !== stored.provenance) changes.provenance = input.provenance;
  if ((input.notes ?? '') !== stored.notes) changes.notes = input.notes;
  return changes;
}

const FIELD_LABELS: ReadonlyArray<readonly [keyof FormState & EnzymeField, string]> = [
  ['name', 'Name'],
  ['recognitionSeq', "Recognition motif (5' → 3')"],
  ['cutFwd', 'Top-strand cut (bases from the motif start)'],
  ['cutRev', 'Bottom-strand cut (bases from the motif start)'],
  ['provenance', 'Provenance'],
  ['notes', 'Notes'],
];

/** How the window names a store it cannot read, by the store's own error kind. */
const UNREADABLE_NAME: Readonly<Record<string, string>> = {
  malformed: 'unreadable data (malformed)',
  futureSchema: 'a newer format than this version reads (futureSchema)',
  unavailable: 'storage unavailable (unavailable)',
};

/** What a save reports: a success only for a file the platform says it wrote. */
function describeSave(result: PlatformSaveResult, what: string, filename: string, saved: (where: string) => string): { text: string; kind: 'info' | 'error' } {
  switch (result.kind) {
    case 'saved':
      return { text: saved(result.where), kind: 'info' };
    case 'cancelled':
      return { text: `${what} cancelled: no file was saved.`, kind: 'info' };
    case 'unconfirmed':
      return result.how === 'downloaded'
        ? { text: `${what}: handed to your browser to download as ${filename}; the browser does not say whether it was kept.`, kind: 'info' }
        : { text: `${what}: sent to the save dialog as ${filename}; this build is not told whether it was saved.`, kind: 'info' };
    case 'failed':
      return { text: `${what} failed: ${result.message}. No file was saved.`, kind: 'error' };
    default:
      return { text: `${what} is not possible here: this window has no save path.`, kind: 'error' };
  }
}

/** The words a custom member is shown under while the enzyme database cannot be read. */
const CUSTOM_ENZYME_UNREADABLE = 'A custom enzyme (the enzyme database could not be read)';

/**
 * How a collection member is listed: a built-in's name, a stored definition's label, and for a key
 * neither resolves, why - a `custom:` id is never shown.
 */
function collectionMemberLabel(key: string, read: EnzymeDbRead): string {
  const builtIn = REBASE_ENZYMES.find((e) => enzymeKey(e) === key);
  if (builtIn) return enzymeLabel(builtIn);
  if (read.ok) {
    const d = read.definitions.find((x) => x.id === key);
    if (d) return `${d.name} (custom)`;
  }
  if (key.startsWith('custom:')) return read.ok ? CUSTOM_ENZYME_NO_LONGER_STORED : CUSTOM_ENZYME_UNREADABLE;
  return `${key} (not in the catalogue)`;
}

/**
 * What the window was opened to do from a detected site (US-01M7JPSK, D0160), by the site enzyme's
 * {@link enzymeKey}: view its definition, or add it to a collection. Read once, when the window mounts.
 */
export type EnzymeWindowIntent = { view: string } | { addToCollection: string };

/** One line of the read-only Enzyme definition region. */
const DefinitionLine: React.FC<{ term: string; children: React.ReactNode }> = ({ term, children }) => (
  <p style={{ margin: '2px 0' }}>
    <strong>{term}:</strong> {children}
  </p>
);

/** A backup file whose import left choices open: the ids that differ and the unconfirmed built-in names. */
interface PendingImport {
  file: string;
  text: string;
  summary: EnzymeImportSummary;
  replace: string[];
  confirm: string[];
}

export interface EnzymeDatabaseWindowProps {
  onClose: () => void;
  /** The element focus returns to when the window closes (its opener). */
  returnFocusTo?: HTMLElement | null;
  database?: EnzymeDatabase;
  /**
   * Called after every write the window asks of the store (add, update, importBackup,
   * discardUnreadable), whatever its outcome, so the App reads the store again and its scans use
   * what is stored now (US-01M7DV52).
   */
  onChange?: () => void;
  /**
   * Opened from a detected site (US-01M7JPSK): the region under the header that views the enzyme's
   * definition or adds it to a collection. Read once at mount (the window is modal); absent, none.
   */
  intent?: EnzymeWindowIntent;
}

export const EnzymeDatabaseWindow: React.FC<EnzymeDatabaseWindowProps> = ({ onClose, returnFocusTo = null, database, onChange, intent: intentProp }) => {
  const [intent] = useState<EnzymeWindowIntent | null>(() => intentProp ?? null);
  const db = useMemo(() => database ?? openEnzymeDatabase(), [database]);
  const [version, setVersion] = useState(0);
  /** After a store write: the window reads the store again, and so does its owner. */
  const written = () => {
    setVersion((n) => n + 1);
    onChange?.();
  };
  const read = useMemo(() => db.read(), [db, version]);
  const collections = useMemo(() => openEnzymeCollections({ definitions: db }), [db]);
  const [collectionsVersion, setCollectionsVersion] = useState(0);
  const collectionsRead = useMemo(() => collections.read(), [collections, collectionsVersion]);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [memberPicks, setMemberPicks] = useState<Record<string, string>>({});
  const [collectionNotice, setCollectionNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  /** The Add intent region's chosen collection, and what its last Add said (US-01M7JPSK). */
  const [intentPick, setIntentPick] = useState<string | null>(null);
  const [intentNotice, setIntentNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  /**
   * After a collection write: the window reads the collections again and says what happened (no scan
   * reads them, so no onChange); `alsoSay` hears the same words, for the intent region.
   */
  function collectionWrite<T>(
    r: EnzymeDbResult<T>,
    said: (value: T) => string,
    alsoSay?: (notice: { kind: 'error' | 'info'; text: string }) => void,
  ): boolean {
    setCollectionsVersion((n) => n + 1);
    const notice = r.ok ? { kind: 'info' as const, text: said(r.value) } : { kind: 'error' as const, text: r.error.message };
    setCollectionNotice(notice);
    alsoSay?.(notice);
    return r.ok;
  }
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [submitErrors, setSubmitErrors] = useState<EnzymeFieldError[]>([]);
  const [pendingClash, setPendingClash] = useState<{ builtIn: string; message: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [circular, setCircular] = useState(false);
  // The user's flank lengths; null follows the default (the reach plus the context bases).
  const [flankChoice, setFlankChoice] = useState<{ left: number | null; right: number | null }>({ left: null, right: null });

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const formOpener = useRef<HTMLElement | null>(null);
  const focusAfterRender = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const target = focusAfterRender.current?.();
    focusAfterRender.current = null;
    if (target && target.isConnected) target.focus();
  });
  useEffect(() => {
    searchRef.current?.focus();
    return () => {
      if (returnFocusTo && returnFocusTo.isConnected) returnFocusTo.focus();
    };
  }, []);
  const formKey = form ? form.editId ?? `new:${form.clonedFrom ?? ''}` : null;
  useEffect(() => {
    if (formKey !== null) dialogRef.current?.querySelector<HTMLInputElement>('form input[aria-label="Name"]')?.focus();
  }, [formKey]);

  const closeForm = () => {
    setForm(null);
    setPendingClash(null);
    setSubmitErrors([]);
    focusAfterRender.current = () => formOpener.current;
  };
  const closeClash = () => {
    setPendingClash(null);
    focusAfterRender.current = () => saveButtonRef.current;
  };
  /** Escape closes the innermost open thing first, and the window only when nothing is open in it. */
  const onEscape = () => {
    if (pendingClash) closeClash();
    else if (form) closeForm();
    else onClose();
  };
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    // A click need not focus a button (WebKit), leaving focus on the body: Escape there is this window's.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== document.body) return;
      const others = Array.from(document.querySelectorAll('dialog[open], [role="dialog"]')).filter((d) => d !== dialogRef.current);
      if (others.length === 0) onEscapeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const customs = read.ok ? read.definitions : [];
  const builtIns = REBASE_ENZYMES.filter((e) => enzymeMatchesSearch(e, search));
  const listedCustoms = customs.filter((d) => enzymeMatchesSearch(d, search));

  const openForm = (next: FormState, opener: HTMLElement | null) => {
    formOpener.current = opener;
    setForm(next);
    setSubmitErrors([]);
    setPendingClash(null);
    setNotice(null);
    setFlankChoice({ left: null, right: null });
  };
  const startClone = (e: RestrictionEnzyme, opener: HTMLElement | null) =>
    openForm(
      {
        editId: null,
        name: e.name,
        recognitionSeq: e.recognitionSeq,
        cutFwd: String(e.cutFwd),
        cutRev: String(e.cutRev),
        isTypeIIS: e.isTypeIIS ?? false,
        methylationSensitivity: [...(e.methylationSensitivity ?? [])],
        clonedFrom: e.name,
        provenance: `Cloned from the built-in ${e.name} in MolBioCraft's REBASE catalogue.`,
        notes: '',
      },
      opener,
    );
  const startEdit = (d: CustomEnzymeDefinition, opener: HTMLElement | null) =>
    openForm(
      {
        editId: d.id,
        name: d.name,
        recognitionSeq: d.recognitionSeq,
        cutFwd: String(d.cutFwd),
        cutRev: String(d.cutRev),
        isTypeIIS: d.isTypeIIS,
        methylationSensitivity: [...d.methylationSensitivity],
        clonedFrom: d.clonedFrom,
        provenance: d.provenance,
        notes: d.notes,
      },
      opener,
    );

  const editing = form?.editId ? customs.find((d) => d.id === form.editId) : undefined;
  const input = form ? formInput(form) : null;
  // A stored cloned-from is text the catalogue may since have dropped; only a new one must name a built-in.
  const checkClonedFrom = !form?.editId;
  const live = input ? validateFields(input as unknown as Record<string, unknown>, checkClonedFrom) : null;
  const fieldErrors = submitErrors.length > 0 ? submitErrors : live && !live.ok ? live.error.fields : [];
  const fieldError = (field: EnzymeField) => fieldErrors.filter((e) => e.field === field).map((e) => e.reason).join(' ');

  const bounds = live?.ok ? flankBounds(live.value.recognitionSeq.length, live.value.cutFwd, live.value.cutRev, circular) : null;
  const flanks = bounds
    ? {
        left: Math.min(MAX_PREVIEW_FLANK, Math.max(bounds.left.min, flankChoice.left ?? bounds.left.default)),
        right: Math.min(MAX_PREVIEW_FLANK, Math.max(bounds.right.min, flankChoice.right ?? bounds.right.default)),
      }
    : { left: 0, right: 0 };
  // Recomputed from the form on every render, so any field, the topology or a flank length redraws it.
  const preview = input ? previewDefinition(input as unknown as Record<string, unknown>, circular, flanks, checkClonedFrom) : null;

  const submit = (confirmedClash?: string) => {
    if (!form || !input) return;
    if (form.editId) {
      if (!editing) {
        setNotice({ kind: 'error', text: 'Nothing was saved: the definition is no longer in the store.' });
        return;
      }
      const changes = editedFields(editing, input);
      if (Object.keys(changes).length === 0) {
        setNotice({ kind: 'info', text: `${editing.name} is unchanged.` });
        closeForm();
        return;
      }
      const r = db.update(form.editId, changes, { confirmedClash });
      written();
      if (!r.ok) {
        if (r.error.kind === 'nameClash' && r.error.clash) return setPendingClash({ builtIn: r.error.clash, message: r.error.message });
        setSubmitErrors(r.error.fields);
        setPendingClash(null);
        setNotice({ kind: 'error', text: r.error.message });
        return;
      }
      setNotice({ kind: 'info', text: `Saved the changes to ${r.value.name}.` });
      closeForm();
      return;
    }
    const r = db.add(input, { confirmedClash });
    written();
    if (!r.ok) {
      if (r.error.kind === 'nameClash' && r.error.clash) return setPendingClash({ builtIn: r.error.clash, message: r.error.message });
      setSubmitErrors(r.error.fields);
      setPendingClash(null);
      setNotice({ kind: 'error', text: r.error.message });
      return;
    }
    setNotice({ kind: 'info', text: `Saved ${r.value.name} as a custom enzyme.` });
    closeForm();
  };

  const updateForm = (patch: Partial<FormState>) => {
    if (!form) return;
    setForm({ ...form, ...patch });
    setSubmitErrors([]);
    setPendingClash(null);
  };
  const setFlank = (side: 'left' | 'right', text: string) => {
    if (!/^\s*\d+\s*$/.test(text)) return;
    setFlankChoice({ ...flankChoice, [side]: Number(text) });
  };

  const cutText = (e: { cutFwd: number; cutRev: number }) => `${e.cutFwd}/${e.cutRev}`;

  const exportBackup = async () => {
    const backup = db.exportBackup();
    if (!backup.ok) return setNotice({ kind: 'error', text: backup.error.message });
    const filename = `enzyme-database-${new Date().toISOString().slice(0, 10)}.json`;
    const said = describeSave(await savePlatformFile(filename, backup.value), 'Export', filename, (where) => `Exported the custom enzyme backup to ${where}.`);
    setNotice({ kind: said.kind, text: said.text });
  };

  /** Imports a backup's text with the user's choices so far; a refusal names the file and changes nothing. */
  const importBackup = (file: string, text: string, replace: string[], confirm: string[]) => {
    const r = db.importBackup(text, { replace, confirmClashes: confirm });
    written();
    if (!r.ok) {
      setPendingImport(null);
      const failed = (e: EnzymeDbError) => (e.kind === 'notSaved' ? e.message : `${e.message} Nothing was changed.`);
      return setNotice({ kind: 'error', text: `${file} was not imported. ${failed(r.error)}` });
    }
    const s = r.value;
    setNotice({
      kind: 'info',
      text: `Imported ${file}: ${s.added.length} added, ${s.replaced.length} replaced, ${s.unchanged.length} unchanged, ${s.conflicts.length} kept as stored, ${s.clashes.length} held back as a built-in name.`,
    });
    setPendingImport(s.conflicts.length > 0 || s.clashes.length > 0 ? { file, text, summary: s, replace: [], confirm: [] } : null);
  };

  const onBackupFile = async (file: File | undefined) => {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      setPendingImport(null);
      return setNotice({ kind: 'error', text: `${file.name} was not imported: it could not be read (${err instanceof Error ? err.message : String(err)}). Nothing was changed.` });
    }
    importBackup(file.name, text, [], []);
  };

  const discardUnreadable = (storedValue: string) => {
    setConfirmDiscard(false);
    const r = db.discardUnreadable(storedValue);
    written();
    setNotice(r.ok ? { kind: 'info', text: 'Discarded the unreadable custom enzyme store; it is now empty.' } : { kind: 'error', text: r.error.message });
  };

  const saveUnreadable = async (storedValue: string) => {
    const filename = 'enzyme-database-unreadable.json';
    const said = describeSave(await savePlatformFile(filename, storedValue), 'Copy of the unreadable data', filename, (where) => `Copy of the unreadable data saved to ${where}.`);
    setNotice({ kind: said.kind, text: said.text });
  };

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id));

  /**
   * The intent region (US-01M7JPSK), under the header. View resolves the key in the catalogue first,
   * then among the stored definitions by id; Edit is the Custom table's editor, for a custom only.
   * Add writes through this window's `collections` and `collectionWrite`; a `custom:` id is never shown.
   */
  const intentRegion = (() => {
    if (!intent) return null;
    if ('view' in intent) {
      const key = intent.view;
      const builtIn = REBASE_ENZYMES.find((e) => enzymeKey(e) === key);
      const custom = builtIn ? undefined : read.ok ? read.definitions.find((d) => d.id === key) : undefined;
      const shown: RestrictionEnzyme | CustomEnzymeDefinition | undefined = builtIn ?? custom;
      return (
        <section aria-label="Enzyme definition" className="studio-card">
          {shown ? (
            <>
              <h4>{enzymeLabel(shown)}</h4>
              <DefinitionLine term="Name">{shown.name}</DefinitionLine>
              <DefinitionLine term="Source">{custom ? 'Custom' : 'Built-in'}</DefinitionLine>
              <DefinitionLine term="Motif (5' → 3')">
                <span className="mono-cell">{shown.recognitionSeq}</span>
              </DefinitionLine>
              <DefinitionLine term="Cuts (top/bottom)">{cutText(shown)}</DefinitionLine>
              <p style={{ margin: '2px 0' }}>{`Type IIS: ${shown.isTypeIIS ? 'Yes' : 'No'}`}</p>
              <DefinitionLine term="Methylation sensitivity">
                {shown.methylationSensitivity.length > 0 ? shown.methylationSensitivity.join(', ') : 'None'}
              </DefinitionLine>
              <DefinitionLine term="Provenance">
                {custom ? custom.provenance || 'None given' : `MolBioCraft's built-in REBASE catalogue.`}
              </DefinitionLine>
              <DefinitionLine term="Notes">{shown.notes || 'None'}</DefinitionLine>
              {custom && (
                <button type="button" aria-label={`Edit the ${enzymeLabel(custom)} definition`} onClick={(ev) => startEdit(custom, ev.currentTarget)}>
                  Edit
                </button>
              )}
            </>
          ) : (
            <p role="note">{collectionMemberLabel(key, read)}</p>
          )}
        </section>
      );
    }
    const key = intent.addToCollection;
    const label = collectionMemberLabel(key, read);
    const list = collectionsRead.ok ? collectionsRead.collections : [];
    const chosen = list.find((c) => c.id === intentPick) ?? list[0];
    return (
      <section aria-label={`Add ${label} to a collection`} className="studio-card">
        <h4>{`Add ${label} to a collection`}</h4>
        {!collectionsRead.ok ? (
          <p role="note">{collectionsRead.error.message}</p>
        ) : !chosen ? (
          <p role="note">No collection yet: create one in this window first.</p>
        ) : (
          <div className="cloning-action-row">
            <select aria-label="Collection" value={chosen.id} onChange={(e) => setIntentPick(e.target.value)}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                collectionWrite(
                  collections.addMember(chosen.id, key),
                  (v) => (v.already ? `${label} is already in "${chosen.name}": nothing was changed.` : `Added ${label} to "${chosen.name}".`),
                  setIntentNotice,
                )
              }
            >
              Add
            </button>
          </div>
        )}
        {intentNotice && <p role={intentNotice.kind === 'error' ? 'alert' : 'status'}>{intentNotice.text}</p>}
      </section>
    );
  })();

  return (
    <div className="mbc-dialog-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.35)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enzyme-db-title"
        ref={dialogRef}
        className="prefs-modal-window modal-size-db studio-card"
        style={{ maxHeight: '90vh', overflow: 'auto', width: 'min(1100px, 96vw)' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onEscape();
          }
        }}
      >
        <div className="studio-card-header">
          <h3 id="enzyme-db-title">Restriction Enzymes</h3>
          <button type="button" className="btn-secondary" aria-label="Close Restriction Enzymes" onClick={onClose}>
            Close
          </button>
        </div>
        {intentRegion}

        {notice && (
          <p role={notice.kind === 'error' ? 'alert' : 'status'} className={notice.kind === 'error' ? 'warn-tag' : 'ok-tag'}>
            {notice.text}
          </p>
        )}
        {!read.ok && (
          <div role="alert" className="primer-db-unreadable">
            <p>
              <strong>The custom enzymes cannot be shown: {UNREADABLE_NAME[read.error.kind] ?? read.error.kind}.</strong> {read.error.message}
            </p>
            <p>Nothing has been changed. Your custom enzymes are not shown as empty, and nothing is written until you choose.</p>
            {read.error.storedValue !== undefined && (
              <div className="cloning-action-row">
                <button type="button" className="btn-secondary" onClick={() => void saveUnreadable(read.error.storedValue ?? '')}>
                  Save Unreadable Data…
                </button>
                {confirmDiscard ? (
                  <>
                    <button type="button" className="btn-danger" onClick={() => discardUnreadable(read.error.storedValue ?? '')}>
                      Discard and Start Empty
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setConfirmDiscard(false)}>
                      Keep It
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => setConfirmDiscard(true)}>
                    Discard Unreadable Store…
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="cloning-action-row" role="toolbar" aria-label="Restriction Enzymes actions">
          <label className="form-field">
            <span>Search name or motif</span>
            <input ref={searchRef} type="search" aria-label="Search enzymes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" aria-label="Add custom enzyme" disabled={!read.ok} onClick={(e) => openForm({ ...EMPTY_FORM }, e.currentTarget)}>
            Add
          </button>
          <button type="button" className="btn-secondary" disabled={!read.ok} onClick={() => void exportBackup()}>
            Export Backup…
          </button>
          <label className="form-field">
            <span>Import a backup (.json)</span>
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Import backup file"
              disabled={!read.ok}
              onChange={(e) => {
                void onBackupFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {pendingImport && (
          <section aria-label="Import choices" className="primer-db-conflicts">
            {pendingImport.summary.conflicts.length > 0 && (
              <div role="group" aria-label="Backup conflicts">
                <p>
                  {`${plural(pendingImport.summary.conflicts.length, 'custom enzyme')} in ${pendingImport.file} differ from the stored definition with the same id and were kept as stored. Choose any to replace with the backup's version.`}
                </p>
                <ul>
                  {pendingImport.summary.conflicts.map((c) => (
                    <li key={c.id}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`Replace stored ${c.stored.name} (${c.id}) with the backup's ${c.incoming.name}`}
                          checked={pendingImport.replace.includes(c.id)}
                          onChange={(e) => setPendingImport({ ...pendingImport, replace: toggle(pendingImport.replace, c.id, e.target.checked) })}
                        />{' '}
                        {`Replace stored ${c.stored.name} (${c.id}, ${c.stored.recognitionSeq} ${cutText(c.stored)}) with the backup's ${c.incoming.name} (${c.incoming.recognitionSeq} ${cutText(c.incoming)})`}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pendingImport.summary.clashes.length > 0 && (
              <div role="group" aria-label="Built-in name clashes">
                <p>
                  {`${plural(pendingImport.summary.clashes.length, 'custom enzyme')} in ${pendingImport.file} ${pendingImport.summary.clashes.length === 1 ? 'was' : 'were'} held back: the backup records no confirmation of a built-in enzyme's name. Choose any to import as a separate custom enzyme beside the built-in.`}
                </p>
                <ul>
                  {pendingImport.summary.clashes.map((k) => (
                    <li key={k.id}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`Import ${k.name} (${k.id}) beside the built-in ${k.builtIn}`}
                          checked={pendingImport.confirm.includes(k.id)}
                          onChange={(e) => setPendingImport({ ...pendingImport, confirm: toggle(pendingImport.confirm, k.id, e.target.checked) })}
                        />{' '}
                        {`${k.name} (${k.id}) is the name of the built-in enzyme ${k.builtIn}.`}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="cloning-action-row">
              <button
                type="button"
                className="btn-primary"
                disabled={pendingImport.replace.length === 0 && pendingImport.confirm.length === 0}
                onClick={() => importBackup(pendingImport.file, pendingImport.text, pendingImport.replace, pendingImport.confirm)}
              >
                Import Chosen
              </button>
              <button type="button" className="btn-secondary" onClick={() => setPendingImport(null)}>
                Keep All as Stored
              </button>
            </div>
          </section>
        )}

        {form && input && (
          <form
            aria-label={form.editId ? `Edit ${editing?.name ?? 'enzyme'}` : form.clonedFrom ? `Clone ${form.clonedFrom} as custom` : 'Add custom enzyme'}
            className="studio-card"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <p>
              {form.editId
                ? `Custom enzyme ${form.editId}`
                : `New custom enzyme${form.clonedFrom ? `, cloned from the built-in ${form.clonedFrom}` : ''}: it is given its own custom id when saved.`}
            </p>
            {FIELD_LABELS.map(([field, label]) => (
              <label key={field} className="form-field">
                <span>{label}</span>
                <input
                  type="text"
                  className={field === 'recognitionSeq' ? 'mono-input' : undefined}
                  aria-label={field === 'name' ? 'Name' : label}
                  aria-invalid={fieldError(field) ? true : undefined}
                  value={form[field] as string}
                  onChange={(e) => updateForm({ [field]: e.target.value } as Partial<FormState>)}
                />
                {fieldError(field) && <span className="warn-tag">{fieldError(field)}</span>}
              </label>
            ))}
            <label className="form-field">
              <span>Type IIS (cuts outside its motif)</span>
              <input type="checkbox" aria-label="Type IIS" checked={form.isTypeIIS} onChange={(e) => updateForm({ isTypeIIS: e.target.checked })} />
            </label>
            <div role="group" aria-label="Methylation sensitivity">
              <span>Methylation sensitivity: </span>
              {METHYLATION_SENSITIVITIES.map((m) => (
                <label key={m}>
                  <input
                    type="checkbox"
                    aria-label={`${m}-sensitive`}
                    checked={form.methylationSensitivity.includes(m)}
                    onChange={(e) =>
                      updateForm({
                        methylationSensitivity: e.target.checked
                          ? METHYLATION_SENSITIVITIES.filter((x) => x === m || form.methylationSensitivity.includes(x))
                          : form.methylationSensitivity.filter((x) => x !== m),
                      })
                    }
                  />{' '}
                  {m}
                </label>
              ))}
              {fieldError('methylationSensitivity') && <span className="warn-tag">{fieldError('methylationSensitivity')}</span>}
            </div>
            {form.clonedFrom !== undefined && <p aria-label="Cloned from">{`Cloned from: ${form.clonedFrom}`}</p>}
            <p className="mono-cell">{`The motif may be up to ${MAX_CUSTOM_MOTIF_LENGTH} bases of IUPAC codes.`}</p>

            <section aria-label="Cut preview" className="mbc-enzyme-preview">
              <div className="cloning-action-row" role="group" aria-label="Preview probe">
                <label className="form-field">
                  <span>Probe</span>
                  <select aria-label="Probe topology" value={circular ? 'circular' : 'linear'} onChange={(e) => setCircular(e.target.value === 'circular')}>
                    <option value="linear">Linear</option>
                    <option value="circular">Circular</option>
                  </select>
                </label>
                {(['left', 'right'] as const).map((side) => (
                  <label key={side} className="form-field">
                    <span>{side === 'left' ? 'Left flank (bases)' : 'Right flank (bases)'}</span>
                    <input
                      type="number"
                      aria-label={side === 'left' ? 'Left flank length' : 'Right flank length'}
                      min={bounds ? bounds[side].min : 0}
                      max={MAX_PREVIEW_FLANK}
                      step={1}
                      disabled={!bounds}
                      value={flanks[side]}
                      onChange={(e) => setFlank(side, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <PreviewBody preview={preview} />
            </section>

            {pendingClash && (
              <div role="group" aria-label="Name clash" className="primer-db-duplicate">
                <p>{pendingClash.message}</p>
                <div className="cloning-action-row">
                  <button type="button" className="btn-primary" onClick={() => submit(pendingClash.builtIn)}>
                    {`Keep Beside ${pendingClash.builtIn}`}
                  </button>
                  <button type="button" className="btn-secondary" aria-label="Cancel saving under a built-in's name" onClick={closeClash}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <div className="cloning-action-row">
              <button type="submit" className="btn-primary" ref={saveButtonRef}>
                {form.editId ? 'Save Changes' : 'Save Enzyme'}
              </button>
              <button type="button" className="btn-secondary" aria-label="Cancel editing" onClick={closeForm}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <h4>Built-in catalogue</h4>
        <table className="bio-table" aria-label="Built-in enzymes">
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>Motif (5&apos; → 3&apos;)</th>
              <th>Cuts (top/bottom)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {builtIns.map((e) => (
              <tr key={e.name} data-enzyme-source="built-in">
                <td>{e.name}</td>
                <td>Built-in</td>
                <td className="mono-cell">{e.recognitionSeq}</td>
                <td>{cutText(e)}</td>
                <td>
                  <button type="button" aria-label={`Clone ${e.name} as custom`} disabled={!read.ok} onClick={(ev) => startClone(e, ev.currentTarget)}>
                    Clone as custom
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {builtIns.length === 0 && <p>No built-in enzyme matches the search.</p>}

        <h4>Custom</h4>
        {read.ok && (
          <>
            <table className="bio-table" aria-label="Custom enzymes">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Motif (5&apos; → 3&apos;)</th>
                  <th>Cuts (top/bottom)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listedCustoms.map((d) => (
                  <tr key={d.id} data-enzyme-source="custom" data-enzyme-id={d.id}>
                    <td>{d.name}</td>
                    <td>Custom</td>
                    <td className="mono-cell">{d.recognitionSeq}</td>
                    <td>{cutText(d)}</td>
                    <td>
                      <button type="button" aria-label={`Edit ${d.name}`} onClick={(ev) => startEdit(d, ev.currentTarget)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listedCustoms.length === 0 && <p>{customs.length === 0 ? 'No custom enzyme yet.' : 'No custom enzyme matches the search.'}</p>}
          </>
        )}

        <section aria-label="Collections">
          <h4>Collections</h4>
          {collectionNotice && (
            <p role={collectionNotice.kind === 'error' ? 'alert' : 'status'}>{collectionNotice.text}</p>
          )}
          {!collectionsRead.ok ? (
            <p role="note">{collectionsRead.error.message}</p>
          ) : (
            <>
              <div className="cloning-action-row">
                <input
                  type="text"
                  aria-label="New collection name"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (collectionWrite(collections.create(newCollectionName), (c) => `Created the collection "${c.name}".`)) setNewCollectionName('');
                  }}
                >
                  New Collection
                </button>
              </div>
              {collectionsRead.collections.length === 0 && <p>No collection yet.</p>}
              {collectionsRead.collections.map((c) => {
                const pickable = read.ok ? activeEnzymeList(read.definitions) : REBASE_ENZYMES;
                const pick = memberPicks[c.id] ?? (pickable[0] ? enzymeKey(pickable[0]) : '');
                const draft = renameDrafts[c.id] ?? c.name;
                return (
                  <div key={c.id} className="studio-card" data-collection-id={c.id}>
                    <h5>{c.name}</h5>
                    <div className="cloning-action-row">
                      <input
                        type="text"
                        aria-label={`New name for ${c.name}`}
                        value={draft}
                        onChange={(e) => setRenameDrafts({ ...renameDrafts, [c.id]: e.target.value })}
                      />
                      <button
                        type="button"
                        aria-label={`Rename ${c.name}`}
                        onClick={() => {
                          if (collectionWrite(collections.rename(c.id, draft), (n) => `Renamed "${c.name}" to "${n.name}".`)) {
                            const { [c.id]: _done, ...rest } = renameDrafts;
                            setRenameDrafts(rest);
                          }
                        }}
                      >
                        Rename
                      </button>
                      <button type="button" aria-label={`Delete ${c.name}`} onClick={() => collectionWrite(collections.remove(c.id), () => `Deleted the collection "${c.name}".`)}>
                        Delete
                      </button>
                    </div>
                    <div className="cloning-action-row">
                      <select aria-label={`Enzyme to add to ${c.name}`} value={pick} onChange={(e) => setMemberPicks({ ...memberPicks, [c.id]: e.target.value })}>
                        {pickable.map((e) => (
                          <option key={enzymeKey(e)} value={enzymeKey(e)}>
                            {enzymeLabel(e)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`Add to ${c.name}`}
                        onClick={() =>
                          collectionWrite(collections.addMember(c.id, pick), (v) =>
                            v.already
                              ? `${collectionMemberLabel(pick, read)} is already in "${c.name}": nothing was changed.`
                              : `Added ${collectionMemberLabel(pick, read)} to "${c.name}".`,
                          )
                        }
                      >
                        Add
                      </button>
                    </div>
                    {c.enzymeIds.length === 0 ? (
                      <p>{`"${c.name}" holds no enzyme yet.`}</p>
                    ) : (
                      <ul aria-label={`Members of ${c.name}`}>
                        {c.enzymeIds.map((key) => {
                          const label = collectionMemberLabel(key, read);
                          return (
                            <li key={key}>
                              <span>{label}</span>{' '}
                              <button
                                type="button"
                                aria-label={`Remove ${label} from ${c.name}`}
                                onClick={() => collectionWrite(collections.removeMember(c.id, key), () => `Removed ${label} from "${c.name}".`)}
                              >
                                Remove
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </section>
      </div>
    </div>
  );
};

/** The preview area: the engine's site drawn, or why there is no picture. */
const PreviewBody: React.FC<{ preview: DefinitionPreview | null }> = ({ preview }) => {
  if (!preview) return null;
  if (preview.kind === 'refused') {
    return <p role="note">No preview: the definition is not valid yet (see the fields above).</p>;
  }
  if (preview.kind === 'unavailable') return <p role="note">{preview.message}</p>;
  const { probe } = preview;
  const span = `bases ${probe.motifStart + 1}–${probe.motifStart + probe.motif.length}`;
  const about = (
    <p data-preview-probe="">
      {`Probe: ${probe.sequence.length} bases, ${probe.circular ? 'circular' : 'linear'}, with the motif planted as ${probe.motif} at ${span}.`}
    </p>
  );
  if (preview.kind === 'noSite') {
    return (
      <div data-preview="no-site">
        {about}
        <p role="note">{preview.message}</p>
        <pre aria-label="Probe bases, top strand 5' to 3' over bottom strand 3' to 5', no cut drawn" style={{ margin: '6px 0', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
          <code data-strand="probe-top">{`5'-${probe.sequence}-3'`}</code>
          {'\n'}
          <code data-strand="probe-bottom">{`3'-${complementAligned(probe.sequence)}-5'`}</code>
        </pre>
      </div>
    );
  }
  return (
    <div data-preview="site">
      {about}
      <CleavageDrawing site={preview.site} sequence={probe.sequence} circular={probe.circular} flank={PREVIEW_CONTEXT_BASES} />
    </div>
  );
};
