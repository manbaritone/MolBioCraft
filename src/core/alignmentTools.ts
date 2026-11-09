// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Mask Alignment and Translation Alignment (Tools / Align menus). */

import { runValidatedAlignment } from './alignmentExecution';
import { computeAlignmentConsensusAndIdentity } from './alignmentAnalysis';
import { alignPairwiseTypeScript } from './bioEngine';
import { translateCodon } from './alignmentViewModel';

export type MaskContent = 'none' | 'identical' | 'all-gaps' | 'gap-pct' | 'any-gaps' | 'ambiguities';

export interface MaskOptions {
  content: MaskContent;
  /** For 'gap-pct': columns with at least this % of gaps. */
  gapPct: number;
  /** Codon positions (1, 2, 3) to remove; nucleotide alignments only. */
  codonPositions: number[];
  /** NEXUS CHARSET (standard "2 4-6 10-20\\3" or vector "0101110000"); empty = off. */
  charset: string;
}

const NUC_AMBIG = /[^ACGTU-]/i;
const PROT_AMBIG = /[BJXZ]/i;

/**
 * Parses a NEXUS-style CHARSET into 0-based column indices. Supports single sites,
 * ranges ("4-6"), strides ("10-20\\3"), "." for the last site, and vector style.
 * Throws with a readable message on malformed input.
 */
export function parseCharset(text: string, ncols: number): Set<number> {
  const s = text.trim().replace(/;$/, '').trim();
  const out = new Set<number>();
  if (!s) return out;
  if (/^[01]+$/.test(s) && s.length > 1 && !/\s/.test(s)) {
    if (s.length !== ncols) throw new Error(`Vector CHARSET has ${s.length} sites but the alignment has ${ncols}.`);
    for (let i = 0; i < s.length; i++) if (s[i] === '1') out.add(i);
    return out;
  }
  for (const tok of s.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+|\.)(?:-(\d+|\.))?(?:\\(\d+))?$/.exec(tok);
    if (!m) throw new Error(`CHARSET item "${tok}" is not a site, range (4-6) or stride (1-30\\3).`);
    const val = (x: string) => (x === '.' ? ncols : Number(x));
    const a = val(m[1]);
    const b = m[2] !== undefined ? val(m[2]) : a;
    const step = m[3] !== undefined ? Number(m[3]) : 1;
    if (a < 1 || b < a || b > ncols || step < 1) throw new Error(`CHARSET item "${tok}" is outside 1–${ncols}.`);
    for (let i = a; i <= b; i += step) out.add(i - 1);
  }
  return out;
}

/** Columns (0-based) selected for masking/stripping by the options. */
export function columnsToMask(rows: readonly string[], isProtein: boolean, o: MaskOptions): Set<number> {
  const ncols = Math.max(0, ...rows.map((r) => r.length));
  const out = new Set<number>();
  for (let c = 0; c < ncols; c++) {
    const col = rows.map((r) => (r[c] ?? '-').toUpperCase());
    const gaps = col.filter((x) => x === '-' || x === '.').length;
    const residues = col.filter((x) => x !== '-' && x !== '.');
    let hit = false;
    switch (o.content) {
      case 'identical': hit = residues.length === 0 || (gaps === 0 && new Set(residues).size === 1); break;
      case 'all-gaps': hit = residues.length === 0; break;
      case 'gap-pct': hit = rows.length > 0 && (100 * gaps) / rows.length >= o.gapPct; break;
      case 'any-gaps': hit = gaps > 0; break;
      case 'ambiguities': hit = residues.some((x) => (isProtein ? PROT_AMBIG : NUC_AMBIG).test(x)); break;
      default: break;
    }
    if (!isProtein && o.codonPositions.includes((c % 3) + 1)) hit = true;
    if (hit) out.add(c);
  }
  if (o.charset.trim()) for (const c of parseCharset(o.charset, ncols)) out.add(c);
  return out;
}

export function stripColumns(rows: readonly string[], cols: Set<number>): string[] {
  return rows.map((r) => Array.from(r).filter((_, i) => !cols.has(i)).join(''));
}

/** Contiguous 1-based [start, end] runs of a column set (for Masked annotations). */
export function columnRuns(cols: Set<number>): [number, number][] {
  const sorted = Array.from(cols).sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const c of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[1] === c) last[1] = c + 1;
    else runs.push([c + 1, c + 1]);
  }
  return runs;
}

// ───────────────────────────── Translation alignment ─────────────────────────────

export interface TranslationAlignInput { id: string; name: string; sequence: string }

/**
 * Translates each nucleotide sequence (frame 1–3, chosen genetic code), aligns the
 * proteins, and threads the codons back onto the protein alignment so every codon stays
 * intact (a protein gap becomes "---"). Bases before the frame and after the last full
 * codon are kept at the row ends, each in one 3-column slot of its own when any row has them:
 * the lead right-aligned against the first codon, the trail (a partial codon, such as an
 * incomplete stop) left-aligned after the last. So the width is a multiple of 3 and every codon
 * starts at a column that is a multiple of 3 (BG-01M6X9NE). Stops align as "X" and keep their
 * codon.
 */
export function translationAlign(
  inputs: TranslationAlignInput[],
  frame: 1 | 2 | 3,
  geneticCode: string,
  algorithm: string
): { rows: { id: string; name: string; nucleotide: string; protein: string }[]; error: string | null } {
  const prepared = inputs.map((d) => {
    const upper = d.sequence.toUpperCase().replace(/[^A-Z]/g, '');
    const isRna = upper.includes('U') && !upper.includes('T');
    const nt = upper.replace(/U/g, 'T');
    const lead = nt.slice(0, frame - 1);
    const body = nt.slice(frame - 1);
    const codons: string[] = [];
    for (let i = 0; i + 3 <= body.length; i += 3) codons.push(body.slice(i, i + 3));
    const trail = body.slice(codons.length * 3);
    const protein = codons.map((c) => translateCodon(c, geneticCode)).join('').replace(/\*/g, 'X');
    return { ...d, lead, codons, trail, protein, isRna };
  });
  const empty = prepared.find((p) => p.codons.length === 0);
  if (empty) return { rows: [], error: `${empty.name}: no complete codon in frame ${frame}.` };
  const exec = runValidatedAlignment(
    prepared.map((p) => ({ id: p.id, name: p.name, sequence: p.protein, moleculeType: 'Protein' })),
    algorithm
  );
  if (exec.error) return { rows: [], error: exec.error };
  const byId = new Map(prepared.map((p) => [p.id, p]));
  // A lead or trail is shorter than a codon, so one slot of 3 holds the longest of either.
  const leadW = prepared.some((p) => p.lead.length) ? 3 : 0;
  const trailW = prepared.some((p) => p.trail.length) ? 3 : 0;
  const rows = exec.result.rows.map((r) => {
    const p = byId.get(r.id)!;
    let k = 0;
    const middle = Array.from(r.alignedSeq).map((aa) => (aa === '-' ? '---' : p.codons[k++])).join('');
    const row = p.lead.padStart(leadW, '-') + middle + p.trail.padEnd(trailW, '-');
    return {
      id: r.id,
      name: r.name,
      // RNA input stays RNA.
      nucleotide: p.isRna ? row.replace(/T/g, 'U') : row,
      protein: r.alignedSeq,
    };
  });
  return { rows, error: null };
}

// ───────────────────────────── add sequences to an alignment ─────────────────────────────

/** Longest consensus the affine-gap pairwise aligner accepts. */
export const ADD_TO_ALIGNMENT_MAX_COLUMNS = 2400;

/**
 * Adds sequences to an existing alignment without re-aligning it: each new sequence is
 * aligned globally to the alignment's consensus, and insertions relative to the consensus
 * become new gap columns in every existing row.
 */
export function addSequencesToAlignment(
  rows: { name: string; sequence: string }[],
  additions: { name: string; sequence: string }[],
  isProtein: boolean
): { rows: { name: string; sequence: string; added: boolean }[]; identities: number[] } {
  const W = rows[0]?.sequence.length ?? 0;
  // Columns with at least one residue form the profile; all-gap columns stay as gaps.
  const full = computeAlignmentConsensusAndIdentity(rows, 'Majority', true, isProtein).consensus;
  const cols: number[] = [];
  for (let c = 0; c < W; c++) if (rows.some((r) => r.sequence[c] && r.sequence[c] !== '-' && r.sequence[c] !== '.')) cols.push(c);
  const consensus = cols.map((c) => (full[c] && full[c] !== '-' ? full[c] : 'N')).join('');
  const C = consensus.length;
  if (!C) throw new Error('The alignment has no residues.');
  if (C > ADD_TO_ALIGNMENT_MAX_COLUMNS) throw new Error(`The alignment has ${C.toLocaleString()} columns; adding sequences supports up to ${ADD_TO_ALIGNMENT_MAX_COLUMNS.toLocaleString()}.`);
  const posOfCol = new Map(cols.map((c, i) => [c, i + 1]));
  const pairs = additions.map((a) => {
    const seq = a.sequence.toUpperCase().replace(/[^A-Z]/g, '');
    if (!seq) throw new Error(`${a.name} has no residues.`);
    if (seq.length > ADD_TO_ALIGNMENT_MAX_COLUMNS) throw new Error(`${a.name} is longer than ${ADD_TO_ALIGNMENT_MAX_COLUMNS.toLocaleString()} residues.`);
    const r = isProtein
      ? alignPairwiseTypeScript(consensus, seq, false, 2, -1, -10, -1, 'Protein', 'blosum62')
      : alignPairwiseTypeScript(consensus, seq, false, 2, -3, -5, -2, 'DNA');
    return { r, seq };
  });
  // Longest insertion after each consensus position (0 = before position 1).
  const insertMax = new Array<number>(C + 1).fill(0);
  const perAdd = pairs.map(({ r }) => {
    const ins: string[] = new Array(C + 1).fill('');
    const at: string[] = new Array(C + 1).fill('-');
    let p = 0;
    for (let k = 0; k < r.alignedSeq1.length; k++) {
      if (r.alignedSeq1[k] === '-') ins[p] += r.alignedSeq2[k];
      else { p += 1; at[p] = r.alignedSeq2[k]; }
    }
    ins.forEach((x, q) => { insertMax[q] = Math.max(insertMax[q], x.length); });
    return { ins, at };
  });
  const pad = (n: number) => '-'.repeat(n);
  const existing = rows.map((row) => {
    let out = pad(insertMax[0]);
    for (let c = 0; c < W; c++) {
      out += row.sequence[c] ?? '-';
      const p = posOfCol.get(c);
      if (p !== undefined) out += pad(insertMax[p]);
    }
    return { name: row.name, sequence: out, added: false };
  });
  const added = perAdd.map(({ ins, at }, i) => {
    let out = ins[0].padEnd(insertMax[0], '-');
    for (let c = 0; c < W; c++) {
      const p = posOfCol.get(c);
      if (p === undefined) { out += '-'; continue; }
      out += at[p] + ins[p].padEnd(insertMax[p], '-');
    }
    return { name: additions[i].name, sequence: out, added: true };
  });
  return { rows: [...existing, ...added], identities: pairs.map(({ r }) => r.identityPct) };
}
