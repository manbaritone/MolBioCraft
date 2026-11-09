// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** File → Import → Metadata from Spreadsheet (CSV / TSV onto existing documents). */

import type { SequenceDocument } from '../types/bio';

export interface Spreadsheet {
  headers: string[];
  rows: string[][];
}

/** Parses CSV (RFC 4180 quoting) or TSV; the delimiter is detected from the header line. */
export function parseDelimited(text: string): Spreadsheet {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n', 1)[0] ?? '';
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length < 2) throw new Error('The spreadsheet needs a header row and at least one data row.');
  const headers = nonEmpty[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: nonEmpty.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim())) };
}

export interface MetadataImportOptions {
  keyColumn: string;
  matchBy: 'name' | 'accession';
  overwrite: boolean;
}

export interface MetadataImportPlan {
  updated: SequenceDocument[];
  matchedRows: number;
  unmatched: string[];
  fields: string[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function planMetadataImport(docs: SequenceDocument[], sheet: Spreadsheet, o: MetadataImportOptions): MetadataImportPlan {
  const k = sheet.headers.indexOf(o.keyColumn);
  if (k < 0) throw new Error(`Column "${o.keyColumn}" is not in the spreadsheet.`);
  const fields = sheet.headers.filter((h, i) => i !== k);
  const byKey = new Map<string, SequenceDocument[]>();
  for (const d of docs) {
    const key = norm(o.matchBy === 'name' ? d.name : d.accession ?? '');
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), d]);
  }
  const t = new Date().toISOString();
  const changed = new Map<string, SequenceDocument>();
  const unmatched: string[] = [];
  let matchedRows = 0;
  for (const r of sheet.rows) {
    const targets = byKey.get(norm(r[k] ?? ''));
    if (!targets) { if (r[k]) unmatched.push(r[k]); continue; }
    matchedRows += 1;
    for (const d0 of targets) {
      const d = changed.get(d0.id) ?? d0;
      const meta = { ...(d.docMetadata ?? {}) };
      const set: string[] = [];
      sheet.headers.forEach((h, i) => {
        if (i === k || r[i] === '') return;
        if (!o.overwrite && meta[h] !== undefined && meta[h] !== '') return;
        const v = r[i];
        const asNum = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
        if (meta[h] !== asNum) { meta[h] = asNum; set.push(h); }
      });
      if (!set.length) continue;
      changed.set(d.id, {
        ...d,
        docMetadata: meta,
        updatedAt: t,
        history: [...d.history, { id: `hist-meta-${Date.now().toString(36)}-${d.id}`, timestamp: t, operation: 'Import Metadata', description: `Set ${set.join(', ')} from spreadsheet`, parentIds: [d.id], lengthBp: d.sequence.length, topology: d.topology }],
      });
    }
  }
  return { updated: Array.from(changed.values()), matchedRows, unmatched, fields };
}
