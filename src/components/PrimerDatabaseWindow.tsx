// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Databases > Primers (US-01M7DQFS): the window over the user's Primer Database
 * (src/core/primerDatabase.ts, US-01M7DQVT). It lists the active records and the trash, searches
 * them, adds, edits and labels a record, exports the versioned JSON backup through the platform
 * save path and restores one, listing conflicts for an explicit replace choice.
 *
 * A store that cannot be read is shown by name and never as an empty list; discarding it is a
 * separate, confirmed choice. A write the storage refused is shown as not saved.
 *
 * Every way this module writes a record (Add, Edit, and Save to Primer Database from Primer & PCR
 * Studio) goes through `savePrimerCandidate`, which applies the duplicate policy of US-01M7DQ0X
 * (`primerDuplicatePolicy`): a record matching a stored one by name or oligo is never written until
 * the user picks skip, keep separately or merge metadata.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  normalizePrimerSequence,
  openPrimerDatabase,
  activePrimers,
  trashedPrimers,
  type DatabasePrimerInput,
  type PrimerDatabase,
  type PrimerDbError,
  type PrimerFieldError,
  type PrimerImportSummary,
} from '../core/primerDatabase';
import {
  classifyPrimerRows,
  DEFAULT_DUPLICATE_CHOICES,
  DUPLICATE_CHOICES_FOR,
  DUPLICATE_CLASS_LABEL,
  planPrimerDatabaseImport,
  type DuplicateChoice,
  type DuplicateClass,
  type FaithfulPrimerRow,
  type PrimerSpreadsheetReading,
} from '../core/primerImport';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import { isTauriDesktopRuntime, saveNativeFileDialogTauri } from '../lib/tauriIpc';
import type { DatabasePrimer, PrimerMolecule } from '../types/bio';

// ---- The duplicate policy (US-01M7DQ0X AC1-AC2), in one place -------------------------------

export type PrimerDuplicateClass = DuplicateClass;
export type PrimerDuplicateChoice = DuplicateChoice;

export interface PrimerDuplicateMatch {
  /** The shared classifier's class; one this window does not know is shown and defaults to skip. */
  cls: PrimerDuplicateClass | string;
  /** How the import dialog names the class, e.g. "Same oligo, different name". */
  label: string;
  /** The stored record whose name matches, or null. */
  nameMatch: DatabasePrimer | null;
  /** The stored record whose oligo (sequence, molecule and modification text) matches, or null. */
  oligoMatch: DatabasePrimer | null;
  /** The choices offered: merge only where the oligo matches (D0122). */
  choices: PrimerDuplicateChoice[];
  defaultChoice: PrimerDuplicateChoice;
}

/** What this window needs of the duplicate policy: the classification with its choices, and merge. */
export interface PrimerDuplicatePolicy {
  classify(candidate: DatabasePrimerInput, existing: DatabasePrimer[]): PrimerDuplicateMatch;
  /** The change merging `candidate` into `stored` makes: labels added, an empty description filled. */
  mergeChanges(stored: DatabasePrimer, candidate: DatabasePrimerInput): Partial<DatabasePrimerInput>;
}

/**
 * One candidate as the import dialog's row (src/core/primerImport.ts), so Add, Edit and Save to
 * Primer Database are classified and merged by the import's own code. The candidate's sequence is
 * already normalized; its modification text is carried as one modification written that way.
 */
function candidateRow(candidate: DatabasePrimerInput & { sequence: string; molecule: PrimerMolecule }): FaithfulPrimerRow {
  const modText = String(candidate.modifications ?? '').trim();
  return {
    row: 1,
    name: candidate.name,
    original: candidate.sequence,
    sequence: candidate.sequence,
    molecule: candidate.molecule,
    modifications: modText ? [{ text: modText, placement: "5'", position: 1, base: null, noThermodynamics: true }] : [],
    description: String(candidate.description ?? ''),
    labels: [...(candidate.labels ?? [])],
    errors: [],
    warnings: [],
  };
}

const oneRowReading = (row: FaithfulPrimerRow): PrimerSpreadsheetReading => ({
  separator: ',',
  header: null,
  columnCount: 2,
  mapping: { name: 1, sequence: 2, description: -1, labels: -1 },
  rows: [row],
  problem: null,
});

/**
 * The match a class makes, with the import's choices for it (DUPLICATE_CHOICES_FOR: merge only
 * where the oligo matches, D0122) and its default. A class the import names but this window does
 * not know is shown with skip or keep only and defaults to skip; merge also needs the stored
 * record whose oligo matches.
 */
export function duplicateMatchFor(cls: string, nameMatch: DatabasePrimer | null, oligoMatch: DatabasePrimer | null): PrimerDuplicateMatch {
  const offered = (DUPLICATE_CHOICES_FOR as Readonly<Record<string, readonly PrimerDuplicateChoice[] | undefined>>)[cls];
  const choices = (offered ?? ['skip', 'keep']).filter((c) => c !== 'merge' || oligoMatch !== null);
  const def = offered ? (DEFAULT_DUPLICATE_CHOICES as Readonly<Record<string, PrimerDuplicateChoice | undefined>>)[cls] ?? 'skip' : 'skip';
  const label = (DUPLICATE_CLASS_LABEL as Readonly<Record<string, string | undefined>>)[cls] ?? `Matches a stored primer (${cls})`;
  return { cls, label, nameMatch, oligoMatch, choices, defaultChoice: choices.includes(def) ? def : 'skip' };
}

/**
 * The duplicate policy of US-01M7DQ0X, as the import dialog applies it: `classifyPrimerRows` for
 * the class, `DEFAULT_DUPLICATE_CHOICES` for the default choice, and `planPrimerDatabaseImport`'s
 * merge (labels added, empty fields filled, name and sequence never changed).
 */
export const primerDuplicatePolicy: PrimerDuplicatePolicy | null = {
  classify(candidate, existing) {
    const active = activePrimers(existing);
    const none: PrimerDuplicateMatch = { cls: 'new', label: DUPLICATE_CLASS_LABEL.new, nameMatch: null, oligoMatch: null, choices: [], defaultChoice: 'keep' };
    const seq = normalizePrimerSequence(candidate.sequence, candidate.molecule);
    if (!seq.ok) return none;
    const row = candidateRow({ ...candidate, sequence: seq.sequence, molecule: seq.molecule });
    const c = classifyPrimerRows([row], active).classified[0];
    if (!c || c.cls === 'new') return none;
    const stored = (m: { kind: string; id?: string } | null) => (m && m.kind === 'database' ? active.find((r) => r.id === m.id) ?? null : null);
    return duplicateMatchFor(c.cls, stored(c.nameMatch), stored(c.oligoMatch));
  },
  mergeChanges(stored, candidate) {
    const seq = normalizePrimerSequence(candidate.sequence, candidate.molecule);
    if (!seq.ok) return {};
    const row = candidateRow({ ...candidate, sequence: seq.sequence, molecule: seq.molecule });
    const plan = planPrimerDatabaseImport(oneRowReading(row), [stored], DEFAULT_DUPLICATE_CHOICES, { 1: 'merge' }, {
      now: stored.modifiedAt,
      newId: () => `${stored.id}-unused`,
      source: 'this window',
    });
    const merged = plan.merged[0];
    if (!merged) return {};
    // Labels and an empty description only: modification text is part of the oligo (D0122).
    return { labels: merged.labels, description: merged.description };
  },
};

export type PrimerSaveOutcome =
  | { status: 'saved'; record: DatabasePrimer; message: string }
  | { status: 'merged'; record: DatabasePrimer; message: string }
  | { status: 'skipped'; message: string }
  | { status: 'needsChoice'; match: PrimerDuplicateMatch }
  | { status: 'refused'; message: string; error?: PrimerDbError };

/**
 * Write a candidate record (a new one, or the edit of `editId`) under the duplicate policy. Without
 * `choice`, a candidate matching another active record returns `needsChoice` and writes nothing.
 * An edit writes `editChanges` when given (the fields the user changed), else the whole candidate.
 */
export function savePrimerCandidate(
  db: PrimerDatabase,
  policy: PrimerDuplicatePolicy | null,
  candidate: DatabasePrimerInput,
  opts: { editId?: string; editChanges?: Partial<DatabasePrimerInput>; choice?: PrimerDuplicateChoice } = {},
): PrimerSaveOutcome {
  const refused = (error: PrimerDbError): PrimerSaveOutcome => ({ status: 'refused', message: error.message, error });
  const write = (): PrimerSaveOutcome => {
    if (opts.editId) {
      const r = db.edit(opts.editId, opts.editChanges ?? candidate);
      return r.ok ? { status: 'saved', record: r.value.record, message: `Saved ${r.value.record.name}.` } : refused(r.error);
    }
    const r = db.add(candidate);
    return r.ok ? { status: 'saved', record: r.value, message: `Added ${r.value.name} to the Primer Database.` } : refused(r.error);
  };
  // An invalid candidate is refused by the store with its field-level reasons, before any match.
  const seq = normalizePrimerSequence(candidate.sequence, candidate.molecule);
  if (!seq.ok || String(candidate.name ?? '').trim() === '') return write();
  if (!policy) {
    return {
      status: 'refused',
      message: 'Not saved: the duplicate check this needs is not available in this build, so nothing was written.',
    };
  }
  const current = db.read();
  if (!current.ok) return refused(current.error);
  const others = activePrimers(current.records).filter((r) => r.id !== opts.editId);
  const classified = policy.classify({ ...candidate, sequence: seq.sequence, molecule: seq.molecule }, others);
  // During an edit, merging into another record would drop the user's edits to this one
  // (BG-01M7DVJJ): an edit is kept separately or skipped, never merged away.
  const match: PrimerDuplicateMatch = opts.editId
    ? (() => {
        const choices: PrimerDuplicateChoice[] = classified.choices.filter((c) => c !== 'merge');
        return { ...classified, choices, defaultChoice: choices.includes(classified.defaultChoice) ? classified.defaultChoice : 'skip' };
      })()
    : classified;
  if (match.cls === 'new') return write();
  const choice = opts.choice;
  if (!choice || !match.choices.includes(choice)) return { status: 'needsChoice', match };
  const matchedNames = [match.nameMatch, match.oligoMatch].filter((r, i, a): r is DatabasePrimer => !!r && a.indexOf(r) === i).map((r) => r.name);
  if (choice === 'skip') return { status: 'skipped', message: `Skipped: ${match.label.toLowerCase()} (${matchedNames.join(', ')}). Nothing was saved.` };
  if (choice === 'keep') return write();
  if (!match.oligoMatch) return { status: 'needsChoice', match };
  const merged = db.edit(match.oligoMatch.id, policy.mergeChanges(match.oligoMatch, candidate));
  return merged.ok
    ? { status: 'merged', record: merged.value.record, message: `Merged into ${merged.value.record.name}.` }
    : refused(merged.error);
}

/** The classification of a match and the import dialog's three choices for it. */
export const DuplicateChoicePanel: React.FC<{
  match: PrimerDuplicateMatch;
  onChoose: (choice: PrimerDuplicateChoice) => void;
  onCancel: () => void;
}> = ({ match, onChoose, onCancel }) => {
  const def = match.defaultChoice;
  const TEXT: Record<PrimerDuplicateChoice, string> = { skip: 'Skip', keep: 'Keep Separately', merge: 'Merge Metadata' };
  const choices = match.choices.map((c) => [c, TEXT[c]] as const);
  const matched = [
    match.nameMatch && { by: 'name', r: match.nameMatch },
    match.oligoMatch && { by: 'oligo', r: match.oligoMatch },
  ].filter((m): m is { by: string; r: DatabasePrimer } => !!m);
  return (
    <div role="group" aria-label="Duplicate primer" className="primer-db-duplicate">
      <p role="status">
        <strong>{match.label}</strong>
        {matched.map(({ by, r }, i) =>
          i > 0 && matched[0].r === r ? null : (
            <span key={by}>
              {' '}
              — {matched.length > 1 && matched[0].r !== matched[1].r ? `by ${by}, ` : ''}matches stored primer {r.name} (5&apos;-{r.sequence}-3&apos;)
            </span>
          ),
        )}
      </p>
      <div className="cloning-action-row">
        {choices.map(([c, text]) => (
          <button
            key={c}
            type="button"
            className={c === def ? 'btn-primary' : 'btn-secondary'}
            data-default-choice={c === def ? 'true' : undefined}
            onClick={() => onChoose(c)}
          >
            {text}
            {c === def ? ' (default)' : ''}
          </button>
        ))}
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

/**
 * Save a candidate through the policy, holding a match until the user chooses. Primer & PCR
 * Studio's Save to Primer Database uses it; the window's form uses `savePrimerCandidate` directly.
 */
export function usePrimerDatabaseSave(
  db: PrimerDatabase,
  onDone: (message: string) => void,
  policy: PrimerDuplicatePolicy | null = primerDuplicatePolicy,
): { save: (candidate: DatabasePrimerInput, opener?: HTMLElement | null) => void; panel: React.ReactNode } {
  const [pending, setPending] = useState<{ candidate: DatabasePrimerInput; match: PrimerDuplicateMatch; opener: HTMLElement | null } | null>(null);
  const finish = (outcome: PrimerSaveOutcome, candidate: DatabasePrimerInput, opener: HTMLElement | null) => {
    if (outcome.status === 'needsChoice') setPending({ candidate, match: outcome.match, opener });
    else {
      setPending(null);
      onDone(outcome.message);
    }
  };
  // The control that asked to save (the focused Save button): focus returns to it when the panel closes.
  const activeControl = (): HTMLElement | null => {
    if (typeof document === 'undefined') return null;
    const el = document.activeElement as HTMLElement | null;
    return el && el !== document.body && typeof el.focus === 'function' ? el : null;
  };
  // A click need not focus the button it lands on (WebKit does not), so the caller passes it.
  const save = (candidate: DatabasePrimerInput, opener?: HTMLElement | null) =>
    finish(savePrimerCandidate(db, policy, candidate), candidate, opener ?? activeControl());
  const panel =
    pending && policy ? (
      <FocusedChoicePanel
        key={`${pending.candidate.name}\u0000${pending.match.cls}`}
        title={`Save ${pending.candidate.name} to Primer Database`}
        match={pending.match}
        returnFocusTo={pending.opener}
        onChoose={(choice) => finish(savePrimerCandidate(db, policy, pending.candidate, { choice }), pending.candidate, pending.opener)}
        onCancel={() => setPending(null)}
      />
    ) : null;
  return { save, panel };
}

/**
 * The Studio's duplicate panel as a dialog that takes focus (its default choice) when it opens,
 * closes on Escape, and gives focus back to the Save button that opened it (BG-01M7DVJJ).
 */
const FocusedChoicePanel: React.FC<{
  title: string;
  match: PrimerDuplicateMatch;
  returnFocusTo: HTMLElement | null;
  onChoose: (choice: PrimerDuplicateChoice) => void;
  onCancel: () => void;
}> = ({ title, match, returnFocusTo, onChoose, onCancel }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const target = ref.current?.querySelector<HTMLElement>('button[data-default-choice="true"]') ?? ref.current?.querySelector<HTMLElement>('button');
    target?.focus();
    return () => {
      if (returnFocusTo && returnFocusTo.isConnected) returnFocusTo.focus();
    };
  }, [returnFocusTo]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className="studio-card"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <DuplicateChoicePanel match={match} onChoose={onChoose} onCancel={onCancel} />
    </div>
  );
};

// ---- The window ---------------------------------------------------------------------------------

/** Whether `record` matches a search: name, the stored 5'->3' sequence, description or a label. */
export function primerMatchesSearch(record: DatabasePrimer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const bases = q.replace(/\s+/g, '');
  return (
    record.name.toLowerCase().includes(q) ||
    (bases !== '' && record.sequence.toLowerCase().includes(bases)) ||
    record.description.toLowerCase().includes(q) ||
    record.labels.some((l) => l.toLowerCase().includes(q))
  );
}

const ERROR_NAME: Record<string, string> = {
  malformed: 'unreadable data (malformed)',
  futureSchema: 'a newer format than this version reads (futureSchema)',
  unavailable: 'storage unavailable (unavailable)',
};

interface FormState {
  editId: string | null;
  name: string;
  sequence: string;
  molecule: '' | PrimerMolecule;
  tail5Prime: string;
  modifications: string;
  description: string;
  labels: string[];
  newLabel: string;
  provenance: string;
}

const EMPTY_FORM: FormState = {
  editId: null,
  name: '',
  sequence: '',
  molecule: '',
  tail5Prime: '',
  modifications: '',
  description: '',
  labels: [],
  newLabel: '',
  provenance: 'Entered by hand',
};

function formInput(f: FormState): DatabasePrimerInput {
  return {
    name: f.name,
    sequence: f.sequence,
    molecule: f.molecule || undefined,
    tail5Prime: f.tail5Prime,
    modifications: f.modifications,
    description: f.description,
    labels: f.labels,
    provenance: f.provenance,
  };
}

/** The checks the form shows as the user types; the store checks again on save. */
function liveFieldErrors(f: FormState): PrimerFieldError[] {
  const errors: PrimerFieldError[] = [];
  if (f.name.trim() === '') errors.push({ field: 'name', reason: 'A primer needs a name.' });
  const seq = normalizePrimerSequence(f.sequence, f.molecule || undefined);
  if (!seq.ok) errors.push({ field: 'sequence', reason: seq.reason });
  else if (f.tail5Prime.trim() !== '') {
    const tail = normalizePrimerSequence(f.tail5Prime, seq.molecule);
    if (!tail.ok || !seq.sequence.startsWith(tail.sequence) || tail.sequence.length >= seq.sequence.length) {
      errors.push({ field: 'tail5Prime', reason: "The 5' tail must be the start of the sequence, with an annealing portion after it." });
    }
  }
  return errors;
}

const shortTime = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/**
 * What the platform save path says about a file (BG-01M7DVJJ). Only the desktop app's own save
 * dialog (cmd_native_save_file_dialog) reports back: the path written, or nothing when the user
 * cancelled. saveWorkbenchFile cannot: it returns 'native' when it hands the file to a native dialog
 * whose outcome it never sees, and 'downloaded' when it hands it to the browser, which does not say
 * whether the user kept it.
 */
export type PlatformSaveResult =
  | { kind: 'saved'; where: string }
  | { kind: 'cancelled' }
  | { kind: 'unconfirmed'; how: 'native' | 'downloaded' }
  | { kind: 'failed'; message: string }
  | { kind: 'unavailable' };

export async function savePlatformFile(filename: string, content: string): Promise<PlatformSaveResult> {
  if (isTauriDesktopRuntime()) {
    try {
      const where = await saveNativeFileDialogTauri(filename, content);
      return where ? { kind: 'saved', where } : { kind: 'cancelled' };
    } catch (err) {
      return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
    }
  }
  const how = saveWorkbenchFile(filename, content, 'application/json');
  return how ? { kind: 'unconfirmed', how } : { kind: 'unavailable' };
}

/** What a save reports: "Exported" only for a file the platform says it wrote. */
function describeSave(result: PlatformSaveResult, what: string, filename: string): { text: string; kind: 'info' | 'error' } {
  switch (result.kind) {
    case 'saved':
      return { text: `${what} saved to ${result.where}.`, kind: 'info' };
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

export interface PrimerDatabaseWindowProps {
  onClose: () => void;
  /** Opens the primer import dialog with Primer Database chosen (US-01M7DQ0X); absent while unavailable. */
  onOpenImport?: () => void;
  /** Re-read the store when this changes (after an import the window did not write itself). */
  refreshKey?: number;
  /** The element focus returns to when the window closes (its in-app opener). */
  returnFocusTo?: HTMLElement | null;
  database?: PrimerDatabase;
  duplicatePolicy?: PrimerDuplicatePolicy | null;
  /** Saves a file through the platform save path; defaults to saveWorkbenchFile. */
  saveFile?: (filename: string, content: string) => Promise<PlatformSaveResult>;
  /**
   * Opens Find Where Stored Primers Bind with these record ids chosen (US-01M7DQMY AC1): the active
   * primers the window lists, narrowed by the search. Absent where there is no binding search.
   */
  onFindBindings?: (recordIds: string[]) => void;
}

export const PrimerDatabaseWindow: React.FC<PrimerDatabaseWindowProps> = ({
  onClose,
  onOpenImport,
  refreshKey = 0,
  returnFocusTo = null,
  database,
  duplicatePolicy = primerDuplicatePolicy,
  saveFile = savePlatformFile,
  onFindBindings,
}) => {
  const db = useMemo(() => database ?? openPrimerDatabase(), [database]);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  // Re-read on every change of version: another tab may have written since.
  const read = useMemo(() => db.read(), [db, version, refreshKey]);
  const [view, setView] = useState<'active' | 'trash'>('active');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [formErrors, setFormErrors] = useState<PrimerFieldError[]>([]);
  const [pendingMatch, setPendingMatch] = useState<PrimerDuplicateMatch | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [restore, setRestore] = useState<{ text: string; summary: PrimerImportSummary; replace: string[] } | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'empty-trash' | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  /** The Add or Edit button that opened the form: focus goes back to it when the form closes. */
  const formOpener = useRef<HTMLElement | null>(null);
  /** Where focus goes once the next render has drawn it (the control that opened what just closed). */
  const focusAfterRender = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const target = focusAfterRender.current?.();
    focusAfterRender.current = null;
    if (target && target.isConnected) target.focus();
  });
  const focusedControl = (): HTMLElement | null => {
    const el = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
    return el && el !== document.body ? el : null;
  };
  const buttonNamed = (text: string) =>
    Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? []).find((b) => (b.textContent ?? '').trim() === text) ?? null;
  const closeForm = () => {
    setForm(null);
    setPendingMatch(null);
    setFormErrors([]);
    focusAfterRender.current = () => formOpener.current;
  };
  const closeChoice = () => {
    setPendingMatch(null);
    focusAfterRender.current = () => saveButtonRef.current;
  };
  // A form that opens takes focus in its Name field, so typing and Escape both land in the window.
  const formOpen = form !== null;
  const formKey = form?.editId ?? (formOpen ? 'add' : null);
  useEffect(() => {
    if (formKey !== null) dialogRef.current?.querySelector<HTMLInputElement>('form input[aria-label="Name"]')?.focus();
  }, [formKey]);
  /** Escape closes the innermost open thing first, and the window only when nothing is pending (BG-01M7DVJJ). */
  const onEscape = () => {
    if (confirm) {
      const opener = confirm === 'discard' ? 'Discard Unreadable Database…' : 'Empty Trash';
      setConfirm(null);
      focusAfterRender.current = () => buttonNamed(opener);
    } else if (pendingMatch) closeChoice();
    else if (form) closeForm();
    else if (restore) setRestore(null);
    else onClose();
  };
  // A click on a button need not focus it (WebKit), leaving focus on the page body: Escape pressed
  // there belongs to this window too. Escape inside another dialog stays that dialog's.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== document.body) return;
      // Another dialog open (the import dialog over this window) owns Escape.
      const others = Array.from(document.querySelectorAll('dialog[open], [role="dialog"]')).filter((d) => d !== dialogRef.current);
      if (others.length === 0) onEscapeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchRef.current?.focus();
    return () => {
      if (returnFocusTo && returnFocusTo.isConnected) returnFocusTo.focus();
    };
  }, []);

  const report = (text: string, kind: 'error' | 'info' = 'info') => setNotice({ kind, text });
  const reportError = (error: PrimerDbError) => report(error.message, 'error');

  const records = read.ok ? read.records : [];
  const listed = (view === 'active' ? activePrimers(records) : trashedPrimers(records)).filter((r) => primerMatchesSearch(r, search));
  const trashCount = trashedPrimers(records).length;

  const startAdd = (opener: HTMLElement | null) => {
    formOpener.current = opener ?? focusedControl();
    setForm({ ...EMPTY_FORM });
    setFormErrors([]);
    setPendingMatch(null);
  };
  const startEdit = (r: DatabasePrimer, opener: HTMLElement | null) => {
    formOpener.current = opener ?? focusedControl();
    setForm({
      editId: r.id,
      name: r.name,
      sequence: r.sequence,
      molecule: r.molecule,
      tail5Prime: r.tail5Prime,
      modifications: r.modifications,
      description: r.description,
      labels: [...r.labels],
      newLabel: '',
      provenance: r.provenance,
    });
    setFormErrors([]);
    setPendingMatch(null);
  };

  const submitForm = (choice?: PrimerDuplicateChoice) => {
    if (!form) return;
    const input = formInput(form);
    // An edit that leaves the sequence as stored passes no sequence, so the input as typed is kept.
    const stored = form.editId ? records.find((r) => r.id === form.editId) : undefined;
    let editChanges: Partial<DatabasePrimerInput> | undefined;
    if (stored && stored.sequence === form.sequence) {
      const { sequence: _unchanged, ...rest } = input;
      void _unchanged;
      editChanges = rest;
    }
    const outcome = savePrimerCandidate(db, duplicatePolicy, input, { editId: form.editId ?? undefined, editChanges, choice });
    if (outcome.status === 'needsChoice') {
      setPendingMatch(outcome.match);
      return;
    }
    setPendingMatch(null);
    if (outcome.status === 'refused') {
      setFormErrors(outcome.error?.fields ?? []);
      report(outcome.message, 'error');
      reload();
      return;
    }
    closeForm();
    report(outcome.message);
    reload();
  };

  const act = (result: { ok: true } | { ok: false; error: PrimerDbError }, message: string) => {
    if (result.ok) report(message);
    else reportError(result.error);
    reload();
  };

  const exportBackup = async () => {
    const backup = db.exportBackup();
    if (!backup.ok) return reportError(backup.error);
    const filename = `primer-database-${new Date().toISOString().slice(0, 10)}.json`;
    const said = describeSave(await saveFile(filename, backup.value), 'Export', filename);
    report(said.text.replace(/^Export saved to/, 'Exported the Primer Database backup to'), said.kind);
  };

  const restoreText = (text: string, replace: string[] = []) => {
    const result = db.importBackup(text, { replace });
    reload();
    if (!result.ok) {
      setRestore(null);
      return reportError(result.error);
    }
    const s = result.value;
    // A ticked record trashed or gone when the restore committed is left as it is (BG-01M7DT7A).
    const missed = s.notReplaced ?? [];
    report(
      `Restored the backup: ${s.added.length} added, ${s.replaced.length} replaced, ${s.unchanged.length} unchanged, ${s.conflicts.length} kept as stored${
        missed.length ? `, ${missed.length} not replaced: ${missed.map((n) => n.reason).join('; ')}` : ''}.`,
      missed.length ? 'error' : 'info',
    );
    setRestore(s.conflicts.length ? { text, summary: s, replace: [] } : null);
  };

  const onBackupFile = async (file: File | undefined) => {
    if (!file) return;
    restoreText(await file.text());
  };

  const fieldError = (field: string) =>
    (formErrors.find((e) => e.field === field) ?? (form ? liveFieldErrors(form).find((e) => e.field === field) : undefined))?.reason;

  const preview = form ? normalizePrimerSequence(form.sequence, form.molecule || undefined) : null;
  const unreadable = !read.ok;

  return (
    <div className="mbc-dialog-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.35)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="primer-db-title"
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
          <h3 id="primer-db-title">Primer Database</h3>
          <button type="button" className="btn-secondary" aria-label="Close Primer Database" onClick={onClose}>
            Close
          </button>
        </div>

        {notice && (
          <p role={notice.kind === 'error' ? 'alert' : 'status'} className={notice.kind === 'error' ? 'warn-tag' : 'ok-tag'}>
            {notice.text}
          </p>
        )}

        {!read.ok && (
          <div role="alert" className="primer-db-unreadable">
            <p>
              <strong>The Primer Database cannot be shown: {ERROR_NAME[read.error.kind] ?? read.error.kind}.</strong> {read.error.message}
            </p>
            <p>Nothing has been changed. Your primers are not shown as empty, and nothing is written until you choose.</p>
            {read.error.storedValue !== undefined && (
              <div className="cloning-action-row">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    const filename = 'primer-database-unreadable.json';
                    const said = describeSave(await saveFile(filename, read.error.storedValue ?? ''), 'Copy of the unreadable data', filename);
                    report(said.text, said.kind);
                  }}
                >
                  Save Unreadable Data…
                </button>
                {confirm === 'discard' ? (
                  <>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => {
                        setConfirm(null);
                        act(db.discardUnreadable(read.error.storedValue ?? ''), 'Discarded the unreadable data; the Primer Database is now empty.');
                      }}
                    >
                      Discard and Start Empty
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>
                      Keep It
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => setConfirm('discard')}>
                    Discard Unreadable Database…
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="cloning-action-row" role="toolbar" aria-label="Primer Database actions">
          <label className="form-field">
            <span>Search name, sequence, description or label</span>
            <input
              ref={searchRef}
              type="search"
              aria-label="Search primers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button type="button" className="btn-primary" disabled={unreadable} onClick={(e) => startAdd(e.currentTarget)}>
            Add
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={unreadable || !onOpenImport}
            title={onOpenImport ? undefined : 'Import from a spreadsheet is not available in this build'}
            onClick={() => onOpenImport?.()}
          >
            Import…
          </button>
          <button type="button" className="btn-secondary" disabled={unreadable} onClick={() => void exportBackup()}>
            Export Backup…
          </button>
          <button type="button" className="btn-secondary" disabled={unreadable} onClick={() => fileRef.current?.click()}>
            Restore from Backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            aria-label="Backup file to restore"
            tabIndex={-1}
            style={{ display: 'none' }}
            onChange={(e) => {
              void onBackupFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            aria-pressed={view === 'trash'}
            disabled={unreadable}
            onClick={() => setView(view === 'trash' ? 'active' : 'trash')}
          >
            {view === 'trash' ? 'Show Primers' : `Trash (${trashCount})`}
          </button>
          {onFindBindings && (
            <button
              type="button"
              className="btn-secondary"
              disabled={unreadable || view !== 'active' || listed.length === 0}
              title={`Find where the ${listed.length} listed primer${listed.length === 1 ? '' : 's'} bind; search to narrow the list`}
              onClick={() => onFindBindings(listed.map((r) => r.id))}
            >
              Find Where These Bind…
            </button>
          )}
        </div>

        {restore && (
          <div role="group" aria-label="Backup conflicts" className="primer-db-conflicts">
            <p>
              {restore.summary.conflicts.length} primer{restore.summary.conflicts.length === 1 ? '' : 's'} in the backup differ from the stored
              record with the same id and were kept as stored. Choose any to replace with the backup&apos;s version.
            </p>
            <ul>
              {restore.summary.conflicts.map((c) => (
                <li key={c.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={restore.replace.includes(c.id)}
                      onChange={(e) =>
                        setRestore({
                          ...restore,
                          replace: e.target.checked ? [...restore.replace, c.id] : restore.replace.filter((id) => id !== c.id),
                        })
                      }
                    />{' '}
                    Replace stored {c.stored.name} (5&apos;-{c.stored.sequence}-3&apos;) with the backup&apos;s {c.incoming.name} (5&apos;-
                    {c.incoming.sequence}-3&apos;)
                  </label>
                </li>
              ))}
            </ul>
            <div className="cloning-action-row">
              <button type="button" className="btn-primary" disabled={restore.replace.length === 0} onClick={() => restoreText(restore.text, restore.replace)}>
                Replace Chosen
              </button>
              <button type="button" className="btn-secondary" onClick={() => setRestore(null)}>
                Keep All as Stored
              </button>
            </div>
          </div>
        )}

        {form && (
          <form
            aria-label={form.editId ? `Edit ${form.name || 'primer'}` : 'Add primer'}
            className="studio-card"
            onSubmit={(e) => {
              e.preventDefault();
              submitForm();
            }}
          >
            {(
              [
                ['name', 'Name', form.name],
                ['sequence', "Sequence (5' → 3')", form.sequence],
                ['tail5Prime', "5' tail (non-annealing, optional)", form.tail5Prime],
                ['modifications', 'Modifications', form.modifications],
                ['description', 'Description', form.description],
              ] as const
            ).map(([field, label, value]) => (
              <label key={field} className="form-field">
                <span>{label}</span>
                <input
                  type="text"
                  className={field === 'sequence' || field === 'tail5Prime' ? 'mono-input' : undefined}
                  aria-label={label}
                  aria-invalid={fieldError(field) ? true : undefined}
                  value={value}
                  onChange={(e) => {
                    setForm({ ...form, [field]: e.target.value });
                    setFormErrors([]);
                    setPendingMatch(null);
                  }}
                />
                {fieldError(field) && <span className="warn-tag">{fieldError(field)}</span>}
              </label>
            ))}
            <label className="form-field">
              <span>Molecule</span>
              <select
                aria-label="Molecule"
                value={form.molecule}
                onChange={(e) => {
                  setForm({ ...form, molecule: e.target.value as FormState['molecule'] });
                  setFormErrors([]);
                }}
              >
                <option value="">From the sequence (U means RNA)</option>
                <option value="DNA">DNA</option>
                <option value="RNA">RNA</option>
              </select>
            </label>
            <p aria-label="Normalized sequence" className="mono-cell">
              {preview?.ok
                ? `Saved as 5'-${preview.sequence}-3' (${preview.sequence.length} nt, ${preview.molecule})`
                : 'Not yet valid: see the sequence field.'}
            </p>
            <div role="group" aria-label="Labels">
              <span>Labels: </span>
              {form.labels.length === 0 && <span>none</span>}
              {form.labels.map((l) => (
                <span key={l} className="badge-accent">
                  {l}{' '}
                  <button type="button" aria-label={`Remove label ${l}`} onClick={() => setForm({ ...form, labels: form.labels.filter((x) => x !== l) })}>
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                aria-label="New label"
                value={form.newLabel}
                onChange={(e) => setForm({ ...form, newLabel: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const l = form.newLabel.trim();
                    if (l && !form.labels.includes(l)) setForm({ ...form, labels: [...form.labels, l], newLabel: '' });
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const l = form.newLabel.trim();
                  if (l && !form.labels.includes(l)) setForm({ ...form, labels: [...form.labels, l], newLabel: '' });
                }}
              >
                Add Label
              </button>
            </div>
            {pendingMatch && duplicatePolicy && (
              <DuplicateChoicePanel
                match={pendingMatch}
                onChoose={(choice) => submitForm(choice)}
                onCancel={closeChoice}
              />
            )}
            <div className="cloning-action-row">
              <button type="submit" className="btn-primary" ref={saveButtonRef}>
                {form.editId ? 'Save Changes' : 'Save Primer'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeForm}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {read.ok && (
          <>
            {view === 'trash' && (
              <div className="cloning-action-row">
                {confirm === 'empty-trash' ? (
                  <>
                    <span>
                      Delete {trashCount} trashed primer{trashCount === 1 ? '' : 's'} for good?
                    </span>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => {
                        setConfirm(null);
                        const r = db.emptyTrash();
                        act(r, r.ok ? `Deleted ${r.value.deleted.length} trashed primer(s).` : '');
                      }}
                    >
                      Delete for Good
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>
                      Keep Them
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-secondary" disabled={trashCount === 0} onClick={() => setConfirm('empty-trash')}>
                    Empty Trash
                  </button>
                )}
              </div>
            )}
            <table className="bio-table" aria-label={view === 'trash' ? 'Trashed primers' : 'Primers'}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Sequence (5&apos; → 3&apos;)</th>
                  <th>Length</th>
                  <th>Molecule</th>
                  <th>Modification</th>
                  <th>Labels</th>
                  <th>Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {listed.map((r) => (
                  <tr key={r.id} data-primer-id={r.id}>
                    <td>{r.name}</td>
                    <td className="mono-cell">
                      {r.tail5Prime && <span className="tail-highlight">{r.tail5Prime}</span>}
                      {r.sequence.slice(r.tail5Prime.length)}
                    </td>
                    <td>{r.sequence.length}</td>
                    <td>{r.molecule}</td>
                    <td>{r.modifications}</td>
                    <td>{r.labels.join(', ')}</td>
                    <td>{shortTime(r.modifiedAt)}</td>
                    <td>
                      {view === 'active' ? (
                        <>
                          <button type="button" aria-label={`Edit ${r.name}`} onClick={(e) => startEdit(r, e.currentTarget)}>
                            Edit
                          </button>
                          <button type="button" aria-label={`Trash ${r.name}`} onClick={() => act(db.trash(r.id), `Moved ${r.name} to the trash.`)}>
                            Trash
                          </button>
                        </>
                      ) : (
                        <button type="button" aria-label={`Restore ${r.name}`} onClick={() => act(db.restore(r.id), `Restored ${r.name}.`)}>
                          Restore
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listed.length === 0 && (
              <p role="status">
                {search.trim()
                  ? 'No primer matches the search.'
                  : view === 'trash'
                    ? 'The trash is empty.'
                    : 'The Primer Database has no primers yet. Add one, import a spreadsheet, or restore a backup.'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
