// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Primer import from a spreadsheet saved as text: comma-separated, tab-separated or
 * semicolon-separated (US-01M7DQHR).
 *
 * Two readings come from one tokenizer:
 *
 * - `readPrimerSpreadsheet` is the faithful reading. Each row keeps the sequence as it was typed,
 *   its normalized form, whether it is DNA or RNA, its modifications with their positions, its
 *   description and labels, and what is wrong with each field. Nothing in a row is renamed or
 *   dropped, and a row with an error is kept with it.
 * - `parsePrimerSpreadsheet` derives what Import Primers makes from those rows, as it always has:
 *   duplicate names renamed `_2`, `_3`, a blank name `Primer_<n>`, U written as T, slash
 *   modifications removed with any base they stand for, and rows under 6 bases skipped.
 *
 * The first non-blank line picks the separator (a tab, else a semicolon when the line has no
 * comma, else a comma) and may be a header. Columns are found by name (name/primer/oligo/id,
 * seq, then description/notes/comment/target/gene, then label/tag); without a header the first two
 * columns are name and sequence. The caller may map any column itself.
 */

import { normalizePrimerSequence as normalizeDatabaseSequence, PRIMER_BACKUP_FORMAT, PRIMER_DATABASE_SCHEMA, type PrimerDatabase } from './primerDatabase';
import type { DatabasePrimer } from '../types/bio';

export type PrimerSeparator = ',' | '\t' | ';';

/** One record of the sheet: `row` is the 1-based line it starts on. */
export interface SpreadsheetRecord {
  row: number;
  cells: string[];
  /** A line starting with `#`: kept so the header test sees it, never read as a primer. */
  comment: boolean;
}

/** Why the sheet as a whole cannot be read, with the 1-based row and field where it goes wrong. */
export interface SpreadsheetProblem {
  row: number;
  field: number;
  message: string;
}

export interface TokenizedSpreadsheet {
  separator: PrimerSeparator;
  records: SpreadsheetRecord[];
  problem: SpreadsheetProblem | null;
}

/** 0-based column indexes; -1 means the sheet has no such column. */
export interface PrimerColumnMapping {
  name: number;
  sequence: number;
  description: number;
  labels: number;
}

/** The mapping a caller passes when it leaves every column to the header. */
export const NO_COLUMN_MAPPING: Readonly<Partial<PrimerColumnMapping>> = Object.freeze({});

export type PrimerMolecule = 'DNA' | 'RNA';

export interface PrimerModification {
  /** As written: `/5Phos/`, `/iBiodT/`, `rA`, `mG`, `+C` or `*`. */
  text: string;
  placement: "5'" | "3'" | 'internal';
  /**
   * The 1-based base it sits on in the normalized sequence: the base it stands for (an internal
   * modification such as /iBiodT/, or a per-base prefix), the first base for a 5' modification, the
   * last for a 3' one, and the base it follows for a spacer or a phosphorothioate bond (`*`).
   */
  position: number;
  /** The base the modification stands for, kept in the sequence; null when it carries none. */
  base: string | null;
  /** Modifications take no part in a Tm or other thermodynamic calculation. */
  noThermodynamics: true;
}

export type PrimerField = 'name' | 'sequence' | 'description' | 'labels' | 'row';

export interface PrimerFieldError {
  field: PrimerField;
  /** 1-based column of the sheet. */
  column: number;
  message: string;
  /** The offending character, when one character is the reason. */
  character?: string;
}

export interface FaithfulPrimerRow {
  /** 1-based line the row starts on. */
  row: number;
  /** The name cell as written (blank stays blank). */
  name: string;
  /** The sequence cell as written. */
  original: string;
  /** Uppercase, without whitespace, 5'-/-3' marks, slash modifications or per-base prefixes. */
  sequence: string;
  molecule: PrimerMolecule;
  modifications: PrimerModification[];
  description: string;
  labels: string[];
  errors: PrimerFieldError[];
}

export interface PrimerSpreadsheetReading {
  separator: PrimerSeparator;
  /** The header cells as written, or null when the first row is data. */
  header: string[] | null;
  /** How many columns the widest row has (at least the header's). */
  columnCount: number;
  mapping: PrimerColumnMapping;
  rows: FaithfulPrimerRow[];
  problem: SpreadsheetProblem | null;
}

const IUPAC = /^[ACGTURYSWKMBDHVN]$/;
const VALID = /^[ACGTURYSWKMBDHVN]+$/;
const PRIME = /['′’]/;

/** The separator the first non-blank line uses. */
export function detectSeparator(text: string): PrimerSeparator {
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  return first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
}

/** The row and field (counted by separators, ignoring quotes) of a character offset. */
function rowAndField(text: string, at: number, sep: string): { row: number; field: number } {
  const before = text.slice(0, at);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { row: before.split('\n').length, field: before.slice(lineStart).split(sep).length };
}

/** A workbook or other binary file read as text: its zip signature, a control character or U+FFFD. */
function binaryProblem(text: string, sep: string): SpreadsheetProblem | null {
  if (text.startsWith('PK\u0003\u0004')) {
    return { row: 1, field: 1, message: 'this is an Excel workbook (.xlsx) or other zip file, not text; save the sheet as CSV or tab-separated text' };
  }
  // eslint-disable-next-line no-control-regex
  const m = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.exec(text);
  if (!m) return null;
  const code = `U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  return { ...rowAndField(text, m.index, sep), message: `character ${code} is binary data or not UTF-8 text (an .xls/.xlsx workbook?); save the sheet as CSV or tab-separated text` };
}

/**
 * Splits the sheet into records. A field that starts with a double quote (after any spaces) runs to
 * the closing quote, so it may hold the separator, a doubled quote `""` for one quote, and line
 * breaks. A UTF-8 byte-order mark is dropped, line ends may be LF, CRLF or CR, blank lines are
 * skipped, and every cell is trimmed. A quote never closed stops the reading at its row and field,
 * keeping the records before it; binary input (an .xlsx workbook, a control character, U+FFFD) is
 * refused whole, with the row and field of the first such character.
 */
export function tokenizeSpreadsheet(input: string, separator?: PrimerSeparator): TokenizedSpreadsheet {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const sep = separator ?? detectSeparator(text);
  const records: SpreadsheetRecord[] = [];
  const binary = binaryProblem(text, sep);
  if (binary) return { separator: sep, records, problem: binary };
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const eol = text.indexOf('\n', i);
    const lineEnd = eol < 0 ? text.length : eol;
    const raw = text.slice(i, lineEnd);
    if (!raw.trim() || raw.trim().startsWith('#')) {
      if (raw.trim()) records.push({ row: line, cells: [raw.trim()], comment: true });
      i = lineEnd + 1;
      line++;
      continue;
    }
    const row = line;
    const cells: string[] = [];
    let cur = '';
    let quotedField = false;
    let ended = false;
    while (i < text.length && !ended) {
      const ch = text[i];
      if (ch === '"' && !quotedField && !cur.trim()) {
        quotedField = true;
        cur = '';
        const open = { row: line, field: cells.length + 1 };
        i++;
        let closed = false;
        while (i < text.length) {
          const c = text[i];
          if (c === '"') {
            if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
            i++;
            closed = true;
            break;
          }
          if (c === '\n') line++;
          cur += c;
          i++;
        }
        if (!closed) return { separator: sep, records, problem: { ...open, message: 'a quote opened here is never closed' } };
      } else if (ch === sep) {
        cells.push(cur.trim());
        cur = '';
        quotedField = false;
        i++;
      } else if (ch === '\n') {
        ended = true;
        line++;
        i++;
      } else {
        cur += ch;
        i++;
      }
    }
    cells.push(cur.trim());
    records.push({ row, cells, comment: false });
  }
  return { separator: sep, records, problem: null };
}

/** The base an internal slash modification stands for (/iBiodT/ is T), or null for a spacer or dye. */
function baseOfInternal(text: string): string | null {
  if (!/^i/.test(text) || /^i(?:d?Sp|SpPC)/i.test(text)) return null;
  const m = /([ACGTU])$/.exec(text);
  return m ? m[1] : null;
}

export interface NormalizedPrimerSequence {
  sequence: string;
  molecule: PrimerMolecule;
  modifications: PrimerModification[];
  /** Why the sequence is refused, and the character when one is the reason. */
  error: { message: string; character?: string } | null;
}

/**
 * Normalizes one sequence cell without losing what it says. Letters are uppercased, and whitespace,
 * hyphens and 5'-/-3' marks are removed. A /slash/ modification is kept as text: at the 5' or 3' end
 * it is a terminal one, and an internal one that stands for a base (/iBiodT/) keeps that base in the
 * sequence at its position. IDT per-base prefixes are read before anything is uppercased: a lowercase
 * `r` (RNA) or `m` (2'-O-methyl) before an uppercase base, `+` (LNA) before a base, and `*` (a
 * phosphorothioate bond) between bases; so rArUrG is RNA AUG, never the IUPAC codes RARURG. A record
 * with U, or whose every base carries an r or m prefix, is RNA and keeps U; one with T is DNA and
 * keeps T; one with both is refused. An invalid character is refused and named.
 */
export function normalizePrimerSequence(input: string): NormalizedPrimerSequence {
  const bases: string[] = [];
  const prefixed: boolean[] = [];
  const mods: (PrimerModification & { at: number })[] = [];
  const fail = (message: string, character?: string): NormalizedPrimerSequence => ({
    sequence: bases.join(''), molecule: 'DNA', modifications: mods.map(({ at: _at, ...m }) => m), error: { message, ...(character !== undefined ? { character } : {}) },
  });
  const s = input;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '/') {
      const j = s.indexOf('/', i + 1);
      if (j < 0) return fail(`'/' at position ${i + 1} opens a modification that is never closed`, '/');
      const text = s.slice(i + 1, j);
      i = j + 1;
      if (!text) continue;
      const base = baseOfInternal(text);
      if (base) {
        bases.push(base);
        prefixed.push(false);
        mods.push({ text: `/${text}/`, placement: 'internal', position: bases.length, base, noThermodynamics: true, at: -1 });
      } else {
        mods.push({ text: `/${text}/`, placement: 'internal', position: 0, base: null, noThermodynamics: true, at: bases.length });
      }
      continue;
    }
    if (/\s/.test(ch) || ch === '-') { i++; continue; }
    if ((ch === '5' || ch === '3') && PRIME.test(s[i + 1] ?? '')) { i += 2; continue; }
    const next = s[i + 1] ?? '';
    if ((ch === 'r' || ch === 'm') && /[ACGTU]/.test(next)) {
      bases.push(next);
      prefixed.push(true);
      mods.push({ text: ch + next, placement: 'internal', position: bases.length, base: next, noThermodynamics: true, at: -1 });
      i += 2;
      continue;
    }
    if (ch === '+') {
      const b = next.toUpperCase();
      if (!/[ACGTU]/.test(b) || !next) return fail(`'+' at position ${i + 1} must come before a base (an LNA base such as +A)`, '+');
      bases.push(b);
      prefixed.push(false);
      mods.push({ text: `+${b}`, placement: 'internal', position: bases.length, base: b, noThermodynamics: true, at: -1 });
      i += 2;
      continue;
    }
    if (ch === '*') {
      if (!bases.length) return fail(`'*' at position ${i + 1} must sit between two bases (a phosphorothioate bond)`, '*');
      mods.push({ text: '*', placement: 'internal', position: bases.length, base: null, noThermodynamics: true, at: -1 });
      i++;
      continue;
    }
    const up = ch.toUpperCase();
    if (!IUPAC.test(up)) return fail(`'${ch}' at position ${i + 1} is not a nucleotide or IUPAC code`, ch);
    bases.push(up);
    prefixed.push(false);
    i++;
  }
  const n = bases.length;
  const modifications = mods.map(({ at, ...m }) => {
    if (at < 0) return m;
    if (at === 0) return { ...m, placement: "5'" as const, position: Math.min(1, n) };
    if (at === n) return { ...m, placement: "3'" as const, position: n };
    return { ...m, position: at };
  });
  const sequence = bases.join('');
  const hasT = sequence.includes('T');
  const hasU = sequence.includes('U');
  if (modifications.some((m) => m.text === '*' && m.position === n)) {
    return { sequence, molecule: 'DNA', modifications, error: { message: "'*' must sit between two bases (a phosphorothioate bond)", character: '*' } };
  }
  if (hasT && hasU) {
    return { sequence, molecule: 'DNA', modifications, error: { message: 'the sequence holds both T and U: a DNA oligo has T and an RNA one U' } };
  }
  const molecule: PrimerMolecule = hasU || (n > 0 && prefixed.every(Boolean)) ? 'RNA' : 'DNA';
  return { sequence, molecule, modifications, error: null };
}

/** The header test Import Primers has always used: a header names a column and its second cell is no sequence. */
function looksLikeHeader(cells: string[]): boolean {
  const header = cells.map((h) => h.toLowerCase());
  return header.some((h) => /name|primer|oligo|seq/.test(h)) && !VALID.test((header[1] ?? '').toUpperCase().replace(/\s/g, ''));
}

function headerMapping(cells: string[] | null): PrimerColumnMapping {
  if (!cells) return { name: 0, sequence: 1, description: -1, labels: -1 };
  const header = cells.map((h) => h.toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const name = Math.max(0, find(/name|primer|oligo|id/));
  const s = find(/seq/);
  return { name, sequence: s >= 0 ? s : name === 0 ? 1 : 0, description: find(/desc|note|comment|target|gene/), labels: find(/^(labels?|tags?)$/) };
}

/** A label cell split on ';' or ','. */
export function splitLabels(cell: string): string[] {
  return cell.split(/[;,]/).map((l) => l.trim()).filter(Boolean);
}

/** "Sequence (column 2)" for a header, "column 2" without one. */
export function fieldLabel(header: string[] | null, column: number): string {
  const h = header?.[column - 1];
  return h ? `${h} (column ${column})` : `column ${column}`;
}

/**
 * The faithful reading of a primer sheet; see the file header. Under a header, a row with a
 * non-empty cell past the header's last column is an error naming that column (empty trailing cells
 * are not counted).
 */
export function readPrimerSpreadsheet(text: string, mapping: Partial<PrimerColumnMapping> = NO_COLUMN_MAPPING): PrimerSpreadsheetReading {
  const { separator, records, problem } = tokenizeSpreadsheet(text);
  const first = records[0];
  const firstCells = first ? (first.comment ? first.cells[0].split(separator).map((c) => c.trim()) : first.cells) : [];
  const header = first && looksLikeHeader(firstCells) ? firstCells : null;
  const map = { ...headerMapping(header), ...mapping };
  const rows: FaithfulPrimerRow[] = [];
  for (const rec of header ? records.slice(1) : records) {
    if (rec.comment) continue;
    const cell = (c: number) => (c >= 0 ? rec.cells[c] ?? '' : '');
    const errors: PrimerFieldError[] = [];
    if (header && rec.cells.length > header.length) {
      const extra = rec.cells.findIndex((c, k) => k >= header.length && c !== '');
      if (extra >= 0) errors.push({ field: 'row', column: extra + 1, message: `the row has ${rec.cells.length} cells but the header has ${header.length}` });
    }
    const original = cell(map.sequence);
    const norm = normalizePrimerSequence(original);
    if (!original.trim()) errors.push({ field: 'sequence', column: map.sequence + 1, message: 'no sequence' });
    else if (norm.error) errors.push({ field: 'sequence', column: map.sequence + 1, message: norm.error.message, ...(norm.error.character !== undefined ? { character: norm.error.character } : {}) });
    else if (!norm.sequence) errors.push({ field: 'sequence', column: map.sequence + 1, message: 'no sequence' });
    rows.push({
      row: rec.row, name: cell(map.name), original, sequence: norm.sequence, molecule: norm.molecule, modifications: norm.modifications,
      description: cell(map.description), labels: splitLabels(cell(map.labels)), errors,
    });
  }
  const columnCount = Math.max(header?.length ?? 0, ...records.filter((r) => !r.comment).map((r) => r.cells.length));
  return { separator, header, columnCount, mapping: map, rows, problem };
}

// ─── What Import Primers makes ───

export interface ImportedPrimerRow {
  name: string;
  sequence: string;
  description: string;
  /** The faithful row it comes from. */
  row: number;
}

export interface PrimerImportResult {
  rows: ImportedPrimerRow[];
  skipped: { line: number; reason: string }[];
  /** Why the sheet could not be read at all, or null. */
  problem: SpreadsheetProblem | null;
}

/**
 * The sequence Import Primers writes for a faithful row: the bases an internal slash modification
 * stands for are dropped with it (as the documents path always has), and U is written as T.
 */
export function importedSequenceOf(row: FaithfulPrimerRow): string {
  const dropped = new Set(row.modifications.filter((m) => m.base && m.text.startsWith('/')).map((m) => m.position));
  return [...row.sequence].filter((_b, k) => !dropped.has(k + 1)).join('').replace(/U/g, 'T');
}

/** The reason a row is skipped, as the dialog and the error message show it. */
function skipReason(err: PrimerFieldError): string {
  if (err.message === 'no sequence') return 'no sequence';
  if (err.character !== undefined) return `not a nucleotide sequence: ${err.message}`;
  return err.message;
}

/** The rows Import Primers turns into documents, derived from the faithful reading. */
export function parsePrimerSpreadsheet(text: string, mapping: Partial<PrimerColumnMapping> = NO_COLUMN_MAPPING): PrimerImportResult {
  return importedRowsOf(readPrimerSpreadsheet(text, mapping));
}

export function importedRowsOf(reading: PrimerSpreadsheetReading): PrimerImportResult {
  const rows: ImportedPrimerRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seen = new Map<string, number>();
  for (const r of reading.rows) {
    if (r.errors.length) { skipped.push({ line: r.row, reason: skipReason(r.errors[0]) }); continue; }
    const sequence = importedSequenceOf(r);
    if (!sequence) { skipped.push({ line: r.row, reason: 'no sequence' }); continue; }
    if (sequence.length < 6) { skipped.push({ line: r.row, reason: 'shorter than 6 bases' }); continue; }
    let name = r.name || `Primer_${rows.length + 1}`;
    const k = (seen.get(name) ?? 0) + 1;
    seen.set(name, k);
    if (k > 1) name = `${name}_${k}`;
    rows.push({ name, sequence, description: r.description, row: r.row });
  }
  return { rows, skipped, problem: reading.problem };
}

/** "row 3, field 2: a quote opened here is never closed" */
export function describeSpreadsheetProblem(p: SpreadsheetProblem): string {
  return `row ${p.row}, field ${p.field}: ${p.message}`;
}

// ─── Into the Primer Database (US-01M7DQ0X) ───

/**
 * How a sheet row stands against the Primer Database and the rows above it in the sheet:
 * `new`, `sameName` (same name, different oligo), `sameOligo` (same oligo, different name) or
 * `exact` (one record or row has both its name and its oligo).
 */
export type DuplicateClass = 'new' | 'sameName' | 'sameOligo' | 'exact';
export type DuplicateChoice = 'skip' | 'keep' | 'merge';
export type DuplicateChoices = Record<Exclude<DuplicateClass, 'new'>, DuplicateChoice>;

/**
 * What each class does until the user chooses: an exact duplicate is skipped, a same-oligo row is
 * skipped (the oligo is already there), and a same-name row with a different oligo is kept as a
 * record of its own (nothing is overwritten by name).
 */
export const DEFAULT_DUPLICATE_CHOICES: Readonly<DuplicateChoices> = Object.freeze({ exact: 'skip', sameOligo: 'skip', sameName: 'keep' });
/** No choice made for a single row: every row follows its class. */
export const NO_ROW_CHOICES: Readonly<Record<number, DuplicateChoice>> = Object.freeze({});

export const DUPLICATE_CLASS_LABEL: Readonly<Record<DuplicateClass, string>> = Object.freeze({
  new: 'New',
  sameName: 'Same name, different oligo',
  sameOligo: 'Same oligo, different name',
  exact: 'Exact duplicate',
});

/** A record or an earlier row a row matches. */
export type PrimerMatch = { kind: 'database'; id: string; name: string } | { kind: 'row'; row: number; name: string };

export interface ClassifiedPrimerRow {
  row: FaithfulPrimerRow;
  cls: DuplicateClass;
  /** What the name matches (a database record before an earlier row), or null. */
  nameMatch: PrimerMatch | null;
  /** What the oligo matches (a database record before an earlier row), or null. */
  oligoMatch: PrimerMatch | null;
}

export interface PrimerRowProblem { row: number; name: string; reason: string }

/**
 * The modification text a row's oligo is stored with: terminal ones as written, internal ones at
 * their base. In an RNA oligo an `r` prefix only says the base is RNA, which the molecule already
 * says, so it is left out; in a DNA oligo it marks an RNA base and is kept.
 */
export function modificationTextOf(row: FaithfulPrimerRow): string {
  return row.modifications.filter((m) => !(row.molecule === 'RNA' && /^r[ACGU]$/.test(m.text))).map((m) => (m.placement === 'internal' ? `${m.text}@${m.position}` : m.text)).join(' ');
}

/** A name compared trimmed and case-insensitively. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * An oligo's identity: its normalized sequence, its molecule and its modification text. A reverse
 * complement, the RNA or DNA counterpart, or the same bases with another modification differ.
 */
export function oligoKey(sequence: string, molecule: PrimerMolecule, modifications: string): string {
  return `${molecule}\u0000${sequence}\u0000${modifications.trim().replace(/\s+/g, ' ')}`;
}

/** Why the Primer Database would refuse a row (its own rules: a one-line name, a valid sequence), or null. */
function storeRefusal(row: FaithfulPrimerRow): string | null {
  if (!row.name.trim()) return 'A primer needs a name.';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(row.name)) return 'A primer name is one line, without tabs or line breaks.';
  const seq = normalizeDatabaseSequence(row.sequence, row.molecule);
  if (!seq.ok) return seq.reason;
  if (seq.sequence !== row.sequence) return 'The sequence does not read the same way in the Primer Database.';
  return null;
}

/**
 * Classifies each valid row against the active database records and the rows above it in the sheet,
 * by name and by oligo. A row with an error, or one the database would refuse, is rejected.
 */
export function classifyPrimerRows(rows: FaithfulPrimerRow[], existing: DatabasePrimer[]): { classified: ClassifiedPrimerRow[]; rejected: PrimerRowProblem[] } {
  const active = existing.filter((r) => r.trashedAt === undefined);
  const classified: ClassifiedPrimerRow[] = [];
  const rejected: PrimerRowProblem[] = [];
  const seen: { row: number; name: string; nk: string; ok: string }[] = [];
  for (const row of rows) {
    const reason = row.errors.length ? row.errors.map((e) => e.message).join('; ') : storeRefusal(row);
    if (reason) { rejected.push({ row: row.row, name: row.name, reason }); continue; }
    const nk = nameKey(row.name);
    const ok = oligoKey(row.sequence, row.molecule, modificationTextOf(row));
    const dbExact = active.find((r) => nameKey(r.name) === nk && oligoKey(r.sequence, r.molecule, r.modifications) === ok);
    const rowExact = seen.find((s) => s.nk === nk && s.ok === ok);
    const dbName = active.find((r) => nameKey(r.name) === nk);
    const rowName = seen.find((s) => s.nk === nk);
    const dbOligo = active.find((r) => oligoKey(r.sequence, r.molecule, r.modifications) === ok);
    const rowOligo = seen.find((s) => s.ok === ok);
    const fromDb = (r: DatabasePrimer): PrimerMatch => ({ kind: 'database', id: r.id, name: r.name });
    const fromRow = (s: { row: number; name: string }): PrimerMatch => ({ kind: 'row', row: s.row, name: s.name });
    const exact = dbExact ? fromDb(dbExact) : rowExact ? fromRow(rowExact) : null;
    const nameMatch = exact ?? (dbName ? fromDb(dbName) : rowName ? fromRow(rowName) : null);
    const oligoMatch = exact ?? (dbOligo ? fromDb(dbOligo) : rowOligo ? fromRow(rowOligo) : null);
    const cls: DuplicateClass = exact ? 'exact' : nameMatch ? 'sameName' : oligoMatch ? 'sameOligo' : 'new';
    classified.push({ row, cls, nameMatch: cls === 'sameOligo' ? null : nameMatch, oligoMatch: cls === 'sameName' ? null : oligoMatch });
    seen.push({ row: row.row, name: row.name, nk, ok });
  }
  return { classified, rejected };
}

/** The choice that applies to a row: its own, else its class's. */
export function choiceFor(c: ClassifiedPrimerRow, byClass: Readonly<DuplicateChoices>, byRow: Readonly<Record<number, DuplicateChoice>>): DuplicateChoice | null {
  if (c.cls === 'new') return null;
  return byRow[c.row.row] ?? byClass[c.cls];
}

export interface PrimerDatabaseImportPlan {
  /** New records, in sheet order. */
  added: DatabasePrimer[];
  /** Stored records with the merged labels and filled fields; name and sequence as stored. */
  merged: DatabasePrimer[];
  skipped: PrimerRowProblem[];
  rejected: PrimerRowProblem[];
  /** Rows that end up saved: added rows and rows whose merge changed a record. */
  imported: number;
}

/** Merge a row into a record: add its labels, fill empty fields; the name, sequence and molecule never change. */
function mergeInto(target: DatabasePrimer, row: FaithfulPrimerRow, time: string): DatabasePrimer {
  const labels = [...target.labels];
  for (const l of row.labels) if (!labels.includes(l)) labels.push(l);
  const modifications = target.modifications || modificationTextOf(row);
  const description = target.description || row.description;
  const changed = labels.length !== target.labels.length || modifications !== target.modifications || description !== target.description;
  return changed ? { ...target, labels, modifications, description, modifiedAt: time } : target;
}

/**
 * What saving the reviewed sheet does, given the user's choices. A new row and a row kept
 * separately become new records; a merged row adds to the record (or earlier row) it matches; a
 * skipped row, a merge that adds nothing, and a merge into a row that is itself not saved are
 * skipped with the reason.
 */
export function planPrimerDatabaseImport(
  reading: PrimerSpreadsheetReading,
  existing: DatabasePrimer[],
  byClass: Readonly<DuplicateChoices>,
  byRow: Readonly<Record<number, DuplicateChoice>>,
  env: { now: string; newId: () => string; source: string },
): PrimerDatabaseImportPlan {
  const { classified, rejected } = classifyPrimerRows(reading.rows, existing);
  const added: DatabasePrimer[] = [];
  const addedByRow = new Map<number, number>();
  const mergedById = new Map<string, DatabasePrimer>();
  const skipped: PrimerRowProblem[] = [];
  let imported = 0;
  const stored = new Map(existing.map((r) => [r.id, r] as const));
  // Where a row ends up, so a later row can merge into it: an added record or a stored one.
  const landed = new Map<number, { added: number } | { id: string }>();
  for (const c of classified) {
    const { row } = c;
    const choice = choiceFor(c, byClass, byRow);
    if (choice === 'skip') { skipped.push({ row: row.row, name: row.name, reason: `skipped: ${DUPLICATE_CLASS_LABEL[c.cls].toLowerCase()}` }); continue; }
    if (choice === null || choice === 'keep') {
      const ids = new Set([...existing.map((r) => r.id), ...added.map((r) => r.id)]);
      let id = env.newId();
      while (ids.has(id)) id = env.newId();
      addedByRow.set(row.row, added.length);
      landed.set(row.row, { added: added.length });
      added.push({
        id, name: row.name.trim(), sequence: row.sequence, originalInput: row.original, molecule: row.molecule,
        modifications: modificationTextOf(row), tail5Prime: '', description: row.description, labels: [...new Set(row.labels)],
        createdAt: env.now, modifiedAt: env.now, provenance: `Imported from ${env.source}, row ${row.row}`,
      });
      imported++;
      continue;
    }
    const match = c.cls === 'sameName' ? c.nameMatch : c.oligoMatch;
    const into = !match ? undefined : match.kind === 'database' ? { id: match.id } : landed.get(match.row);
    if (!into) { skipped.push({ row: row.row, name: row.name, reason: `not merged: row ${match && match.kind === 'row' ? match.row : '?'} it matches is not saved` }); continue; }
    if ('added' in into) {
      const before = added[into.added];
      added[into.added] = mergeInto(before, row, env.now);
      if (added[into.added] === before) skipped.push({ row: row.row, name: row.name, reason: 'not merged: nothing new to add' });
      else imported++;
    } else {
      const before = mergedById.get(into.id) ?? stored.get(into.id)!;
      const after = mergeInto(before, row, env.now);
      if (after === before) skipped.push({ row: row.row, name: row.name, reason: 'not merged: nothing new to add' });
      else { mergedById.set(into.id, after); imported++; }
    }
    landed.set(row.row, into);
  }
  return { added, merged: [...mergedById.values()], skipped, rejected, imported };
}

export interface PrimerDatabaseImportCounts { imported: number; added: number; merged: number; skipped: number; rejected: number }

export function countsOf(plan: PrimerDatabaseImportPlan): PrimerDatabaseImportCounts {
  return { imported: plan.imported, added: plan.added.length, merged: plan.imported - plan.added.length, skipped: plan.skipped.length, rejected: plan.rejected.length };
}

/** "3 imported (2 new, 1 merged), 2 skipped, 1 rejected" */
export function describeImportCounts(n: PrimerDatabaseImportCounts): string {
  return `${n.imported} imported (${n.added} new, ${n.merged} merged), ${n.skipped} skipped, ${n.rejected} rejected`;
}

/**
 * Saves a plan in ONE store write: the new and merged records go through the store's backup
 * restore, which re-reads the store, adds the new ids and replaces the merged ones together, and
 * writes once, so either every row is saved or none is. (Between the dialog's read and this write,
 * a record another window changed and this plan merges into is replaced by the merged one.)
 */
export function savePrimerDatabaseImport(db: PrimerDatabase, plan: PrimerDatabaseImportPlan, now: string): { ok: true; message: string } | { ok: false; message: string } {
  const counts = countsOf(plan);
  if (!plan.added.length && !plan.merged.length) return { ok: false, message: `Nothing was saved to the Primer Database: no row is left to import (${describeImportCounts(counts)}).` };
  const backup = JSON.stringify({ format: PRIMER_BACKUP_FORMAT, schema: PRIMER_DATABASE_SCHEMA, exportedAt: now, records: [...plan.added, ...plan.merged] });
  const result = db.importBackup(backup, { replace: plan.merged.map((r) => r.id) });
  if (!result.ok) return { ok: false, message: `Nothing was saved to the Primer Database: ${result.error.message}` };
  const s = result.value;
  if (s.added.length !== plan.added.length || s.replaced.length !== plan.merged.length) {
    return { ok: false, message: `The Primer Database did not take the import as planned (${s.added.length} added, ${s.replaced.length} merged of ${plan.added.length} and ${plan.merged.length}); check it before importing again.` };
  }
  return { ok: true, message: `Saved to the Primer Database: ${describeImportCounts(counts)}.` };
}
