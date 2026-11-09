// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Primer import from a spreadsheet (a CSV/TSV list). The first
 * row may be a header; columns are found by name (name/primer/oligo, sequence/seq, then any
 * description/notes column), otherwise the first two columns are name and sequence.
 */

export interface ImportedPrimerRow {
  name: string;
  sequence: string;
  description: string;
}

export interface PrimerImportResult {
  rows: ImportedPrimerRow[];
  skipped: { line: number; reason: string }[];
}

function splitLine(line: string, sep: string): string[] {
  if (sep !== ',') return line.split(sep).map((c) => c.trim());
  // CSV with quotes
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const VALID = /^[ACGTURYSWKMBDHVN]+$/;

export function parsePrimerSpreadsheet(text: string): PrimerImportResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim()) ?? '';
  const sep = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows: ImportedPrimerRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  let nameCol = 0;
  let seqCol = 1;
  let descCol = -1;
  let start = 0;
  const header = splitLine(first, sep).map((h) => h.toLowerCase());
  const looksHeader = header.some((h) => /name|primer|oligo|seq/.test(h)) && !VALID.test((header[1] ?? '').toUpperCase().replace(/\s/g, ''));
  if (looksHeader) {
    const find = (re: RegExp) => header.findIndex((h) => re.test(h));
    nameCol = Math.max(0, find(/name|primer|oligo|id/));
    const s = find(/seq/);
    seqCol = s >= 0 ? s : nameCol === 0 ? 1 : 0;
    descCol = find(/desc|note|comment|target|gene/);
    start = lines.indexOf(first) + 1;
  }
  const seen = new Map<string, number>();
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const cells = splitLine(line, sep);
    const rawName = cells[nameCol] ?? '';
    // remove 5'-/-3' labels, spaces and modifications such as /5Phos/
    const seq = (cells[seqCol] ?? '').toUpperCase().replace(/\/[^/]*\//g, '').replace(/5['′]-?|-?3['′]/g, '').replace(/[\s-]/g, '');
    if (!seq) { skipped.push({ line: i + 1, reason: 'no sequence' }); continue; }
    if (!VALID.test(seq)) { skipped.push({ line: i + 1, reason: `not a nucleotide sequence (${seq.slice(0, 12)}…)` }); continue; }
    if (seq.length < 6) { skipped.push({ line: i + 1, reason: 'shorter than 6 bases' }); continue; }
    let name = rawName || `Primer_${rows.length + 1}`;
    const k = (seen.get(name) ?? 0) + 1;
    seen.set(name, k);
    if (k > 1) name = `${name}_${k}`;
    rows.push({ name, sequence: seq.replace(/U/g, 'T'), description: descCol >= 0 ? cells[descCol] ?? '' : '' });
  }
  return { rows, skipped };
}
