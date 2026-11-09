// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Readers for multiple-alignment text formats that MolBioCraft also writes: Clustal (.aln),
 * PHYLIP (strict or relaxed names, sequential or interleaved; .phy) and Stockholm (.sto / .sth),
 * plus splitting of multi-record GenBank / EMBL files. Checked against Biopython AlignIO / SeqIO
 * on Biopython's own test files in `src/__tests__/importExportRoundTrip.test.ts`.
 */

import type { MoleculeType, SequenceDocument } from '../types/bio';

export interface TextAlignment {
  names: string[];
  sequences: string[];
  format: 'Clustal' | 'PHYLIP' | 'Stockholm' | 'FASTA';
}

const lines = (text: string) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');

/** Clustal W / X / Omega (and MUSCLE, Kalign, ProbCons … in Clustal format). */
export function parseClustal(text: string): TextAlignment {
  const ls = lines(text);
  if (!/^\s*(CLUSTAL|MUSCLE|PROBCONS|MSAPROBS|KALIGN)/i.test(ls.find((l) => l.trim()) ?? '')) throw new Error('Not a Clustal alignment (no CLUSTAL header line).');
  const order: string[] = [];
  const seqs = new Map<string, string>();
  for (const l of ls.slice(1)) {
    if (!l.trim() || /^\s/.test(l)) continue; // blank and conservation lines
    const m = /^(\S+)\s+(\S+)(?:\s+\d+)?\s*$/.exec(l);
    if (!m) continue;
    const [, name, chunk] = m;
    if (!seqs.has(name)) { order.push(name); seqs.set(name, ''); }
    seqs.set(name, seqs.get(name)! + chunk);
  }
  if (!order.length) throw new Error('The Clustal file has no sequence rows.');
  return { names: order, sequences: order.map((n) => seqs.get(n)!.toUpperCase().replace(/\./g, '-')), format: 'Clustal' };
}

/**
 * PHYLIP: header "ntax nchar", then names (strict: first 10 characters; relaxed: up to the first
 * whitespace) with sequences, sequential or interleaved.
 */
export function parsePhylip(text: string): TextAlignment {
  const ls = lines(text).filter((l) => l.trim());
  const head = /^\s*(\d+)\s+(\d+)/.exec(ls[0] ?? '');
  if (!head) throw new Error('Not a PHYLIP alignment (the first line must give the number of taxa and sites).');
  const ntax = Number(head[1]);
  const nchar = Number(head[2]);
  const body = ls.slice(1);
  const clean = (s: string) => s.replace(/\s+/g, '').replace(/\./g, '-').toUpperCase();
  const split = (l: string, relaxed: boolean): [string, string] | null => {
    if (!relaxed) return [l.slice(0, 10).trim(), l.slice(10)];
    const m = /^\s*(\S+)\s+(.*)$/.exec(l);
    return m ? [m[1], m[2]] : null;
  };
  const attempt = (relaxed: boolean, interleaved: boolean): TextAlignment | null => {
    const names: string[] = [];
    const seqs: string[] = [];
    let i = 0;
    if (interleaved) {
      for (let t = 0; t < ntax; t++) {
        const x = body[i] !== undefined ? split(body[i++], relaxed) : null;
        if (!x) return null;
        names.push(x[0]);
        seqs.push(clean(x[1]));
      }
      while (i < body.length && seqs.some((q) => q.length < nchar)) {
        for (let t = 0; t < ntax && i < body.length; t++) seqs[t] += clean(body[i++]);
      }
    } else {
      for (let t = 0; t < ntax; t++) {
        const x = body[i] !== undefined ? split(body[i++], relaxed) : null;
        if (!x) return null;
        let q = clean(x[1]);
        while (q.length < nchar && i < body.length) q += clean(body[i++]);
        names.push(x[0]);
        seqs.push(q);
      }
    }
    if (seqs.some((q) => q.length !== nchar) || names.some((n) => !n)) return null;
    return { names, sequences: seqs, format: 'PHYLIP' };
  };
  const r = attempt(false, true) ?? attempt(false, false) ?? attempt(true, true) ?? attempt(true, false);
  if (!r) throw new Error(`The PHYLIP file does not hold ${ntax} sequences of ${nchar} sites.`);
  return r;
}

/** Stockholm 1.0 (Pfam / Rfam): "name sequence" rows, #= annotation lines ignored, // ends. */
export function parseStockholm(text: string): TextAlignment {
  const ls = lines(text);
  if (!/^#\s*STOCKHOLM/i.test(ls.find((l) => l.trim()) ?? '')) throw new Error('Not a Stockholm alignment (no "# STOCKHOLM 1.0" header).');
  const order: string[] = [];
  const seqs = new Map<string, string>();
  for (const l of ls) {
    if (l.startsWith('//')) break;
    if (!l.trim() || l.startsWith('#')) continue;
    const m = /^(\S+)\s+(\S+)\s*$/.exec(l);
    if (!m) continue;
    if (!seqs.has(m[1])) { order.push(m[1]); seqs.set(m[1], ''); }
    seqs.set(m[1], seqs.get(m[1])! + m[2]);
  }
  if (!order.length) throw new Error('The Stockholm file has no sequence rows.');
  return { names: order, sequences: order.map((n) => seqs.get(n)!.toUpperCase().replace(/\./g, '-')), format: 'Stockholm' };
}

/**
 * An aligned multi-FASTA (≥ 2 records of equal length with gap characters) as an alignment;
 * null for ordinary FASTA, whose records stay separate sequences.
 */
export function parseAlignedFasta(text: string): TextAlignment | null {
  const names: string[] = [];
  const seqs: string[] = [];
  for (const l of lines(text)) {
    if (l.startsWith('>')) { names.push(l.slice(1).trim()); seqs.push(''); }
    else if (names.length) seqs[seqs.length - 1] += l.replace(/\s+/g, '');
  }
  if (names.length < 2 || !seqs.every((x) => x.length === seqs[0].length && x.length > 0)) return null;
  if (!seqs.some((x) => /[-.]/.test(x))) return null;
  return { names, sequences: seqs.map((x) => x.toUpperCase().replace(/\./g, '-')), format: 'FASTA' };
}

/** Guesses nucleotide vs protein from the residues. */
export function alignmentMolecule(seqs: string[]): MoleculeType {
  let acgt = 0, total = 0;
  for (const s of seqs) for (const c of s) { if (c === '-' || c === '?' || c === '.') continue; total++; if ('ACGTUN'.includes(c)) acgt++; }
  if (!total || acgt / total >= 0.9) return seqs.some((s) => s.includes('U') && !s.includes('T')) ? 'RNA' : 'DNA';
  return 'Protein';
}

/** An alignment document for an imported text alignment. */
export function textAlignmentToDocument(a: TextAlignment, fileName: string, nowIso = new Date().toISOString()): SequenceDocument {
  const stem = fileName.replace(/\.[^.]+$/, '') || `Imported_${a.format}`;
  const moleculeType = alignmentMolecule(a.sequences);
  const id = `${a.format.toLowerCase()}-${stem.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
  const width = Math.max(...a.sequences.map((s) => s.length));
  return {
    id,
    name: stem,
    accession: '',
    description: `${a.format} alignment from ${fileName}`,
    moleculeType,
    topology: 'linear',
    sequence: a.sequences[0],
    features: [],
    primers: [],
    history: [{
      id: `hist-${id}`,
      timestamp: nowIso.slice(0, 16).replace('T', ' '),
      operation: `Imported ${a.format} alignment`,
      description: `${a.sequences.length} ${moleculeType === 'Protein' ? 'protein' : 'nucleotide'} sequences, ${width.toLocaleString()} columns`,
      parentIds: [],
      lengthBp: width,
      topology: 'linear',
    }],
    documentKind: 'alignment',
    alignmentMeta: {
      sequenceCount: a.sequences.length,
      isAligned: true,
      sequences: a.sequences.map((seq, i) => ({ id: `${id}-n${i + 1}`, name: a.names[i] ?? `Sequence ${i + 1}`, sequence: seq.padEnd(width, '-') })),
    },
    docMetadata: { 'Source Format': a.format },
    createdAt: nowIso,
    updatedAt: nowIso,
    folder: 'Alignments',
  } as SequenceDocument;
}

/** Reads a text alignment by extension, else by content. */
export function parseTextAlignment(text: string, fileName: string): TextAlignment {
  const lower = fileName.toLowerCase();
  if (/\.(sto|sth|stk|stockholm)$/.test(lower) || /^#\s*STOCKHOLM/i.test(text.trimStart())) return parseStockholm(text);
  if (/\.(aln|clustal|clw)$/.test(lower) || /^\s*(CLUSTAL|MUSCLE)/i.test(text.trimStart())) return parseClustal(text);
  return parsePhylip(text);
}

/** Splits a multi-record GenBank or EMBL file at its "//" terminator lines. */
export function splitFlatfileRecords(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const l of lines(text)) {
    cur.push(l);
    if (/^\/\/\s*$/.test(l)) {
      if (cur.some((x) => /^(LOCUS|ID)\s/.test(x))) out.push(cur.join('\n'));
      cur = [];
    }
  }
  if (cur.some((x) => /^(LOCUS|ID)\s/.test(x))) out.push(cur.join('\n'));
  return out;
}
