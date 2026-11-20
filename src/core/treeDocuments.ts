// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { SequenceDocument } from '../types/bio';
import { layoutNewickPhylogeneticTreeRust } from '../lib/rustBioEngine';
import {
  nexusHasCharacterMatrix,
  nexusToAlignmentDocument,
  parseNexusAlignment,
  readNexusBlocks,
  stripNexusComments,
  unquoteNexusWord,
} from './fileParsers';

/** Index of the first `ch` outside quoted labels at or after `from`, or -1. */
function indexOutsideQuotes(text: string, ch: string, from = 0): number {
  let quote: string | null = null;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === ch) return i;
  }
  return -1;
}

/** Split on `sep` outside quoted words. */
function splitOutsideQuotes(text: string, sep: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const at = indexOutsideQuotes(text, sep, from);
    if (at < 0) { parts.push(text.slice(from)); return parts; }
    parts.push(text.slice(from, at));
    from = at + 1;
  }
}

/** Leading word of `text` (quoted or bare) and the remainder. */
function leadingWord(text: string): [string, string] {
  const t = text.trimStart();
  const q = t[0];
  if (q === "'" || q === '"') {
    let i = 1;
    for (; i < t.length; i += 1) {
      if (t[i] === q) {
        if (t[i + 1] === q) { i += 1; continue; }
        break;
      }
    }
    return [t.slice(0, i + 1), t.slice(i + 1)];
  }
  const m = /^\S+/.exec(t);
  return m ? [m[0], t.slice(m[0].length)] : ['', ''];
}

/**
 * Parse a NEXUS TRANSLATE statement body ("1 Homo_sapiens, 2 'Pan troglodytes', ...")
 * into a token -> label map. Quoted labels and a trailing comma are accepted.
 */
export function parseNexusTranslate(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of splitOutsideQuotes(body.replace(/^\s*translate\b/i, ''), ',')) {
    const [key, rest] = leadingWord(entry);
    if (!key) continue;
    const words: string[] = [];
    let remaining = rest;
    for (;;) {
      const [w, r] = leadingWord(remaining);
      if (!w) break;
      words.push(unquoteNexusWord(w));
      remaining = r;
    }
    if (words.length) map.set(unquoteNexusWord(key), words.join(' '));
  }
  return map;
}

/** Quote a label for Newick only when it has characters that would break the tree. */
function newickLabel(label: string): string {
  if (!/[\s():,;\[\]'"]/.test(label)) return label;
  if (!label.includes("'")) return `'${label}'`;
  if (!label.includes('"')) return `"${label}"`;
  return `'${label.replace(/'/g, '')}'`;
}

/** Replace tip labels (not internal-node labels such as support values) using a TRANSLATE map. */
export function applyNexusTranslation(newick: string, map: Map<string, string>): string {
  if (map.size === 0) return newick;
  let out = '';
  let expectTip = true;
  let i = 0;
  while (i < newick.length) {
    const c = newick[i];
    if (/\s/.test(c)) { out += c; i += 1; continue; }
    if (expectTip && !'(),;:'.includes(c)) {
      let raw: string;
      if (c === "'" || c === '"') {
        let j = i + 1;
        for (; j < newick.length; j += 1) {
          if (newick[j] === c) {
            if (newick[j + 1] === c) { j += 1; continue; }
            break;
          }
        }
        raw = newick.slice(i, j + 1);
      } else {
        raw = /^[^\s():,;]+/.exec(newick.slice(i))![0];
      }
      const translated = map.get(unquoteNexusWord(raw));
      out += translated !== undefined ? newickLabel(translated) : raw;
      i += raw.length;
      expectTip = false;
      continue;
    }
    if (c === "'" || c === '"') {
      // Internal-node label: copy verbatim.
      let j = i + 1;
      while (j < newick.length && newick[j] !== c) j += 1;
      out += newick.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    expectTip = c === '(' || c === ',';
    out += c;
    i += 1;
  }
  return out;
}

/** The comment keys whose numeric value is a node's support (MrBayes prob, BEAST posterior, ...). */
const SUPPORT_KEYS = new Set(['posterior', 'prob', 'probability', 'support']);

/** The support value a `&key=value,...` comment body names, or null when it names none. */
function supportValueOf(body: string): string | null {
  if (body[0] !== '&') return null;
  const parts: string[] = [];
  let current = '';
  let braces = 0;
  for (const c of body.slice(1)) {
    if (c === '{') braces += 1;
    if (c === '}') braces -= 1;
    if (c === ',' && braces === 0) { parts.push(current); current = ''; continue; }
    current += c;
  }
  parts.push(current);
  for (const part of parts) {
    const m = /^\s*([^=\s]+)\s*=\s*([\s\S]*?)\s*$/.exec(part);
    if (!m || !SUPPORT_KEYS.has(m[1].toLowerCase())) continue;
    const value = unquoteNexusWord(m[2]);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return value;
  }
  return null;
}

/** End index (exclusive) of the bracket comment that opens at `from`, or -1 when it is not closed. */
function commentEnd(text: string, from: number): number {
  let depth = 0;
  for (let j = from; j < text.length; j += 1) {
    if (text[j] === '[') depth += 1;
    else if (text[j] === ']') { depth -= 1; if (depth === 0) return j + 1; }
  }
  return -1;
}

/** The first character at or after `from` that is neither whitespace nor inside a comment. */
function nextSignificant(text: string, from: number): string {
  let i = from;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i += 1; continue; }
    if (text[i] === '[') { const end = commentEnd(text, i); if (end < 0) return ''; i = end; continue; }
    return text[i];
  }
  return '';
}

/**
 * Write a `[&posterior=0.95]`-style comment (keys posterior, prob, probability or support, any case)
 * that follows an internal node's `)` as that node's label, when the node has no label of its own.
 * Every other comment is left in place, for the comment stripper to remove.
 */
export function liftNewickSupportComments(text: string): string {
  let out = '';
  let quote: string | null = null;
  let prev = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === quote) {
        if (text[i + 1] === quote) { out += quote; i += 2; continue; }
        quote = null;
      }
      i += 1;
      continue;
    }
    if (c === '[') {
      const end = commentEnd(text, i);
      if (end < 0) { out += text.slice(i); break; }
      const value = prev === ')' ? supportValueOf(text.slice(i + 1, end - 1)) : null;
      const next = nextSignificant(text, end);
      if (value !== null && (next === '' || ':,);'.includes(next))) {
        out = out.trimEnd() + value;
        prev = value[value.length - 1];
        i = end;
        while (i < text.length && /\s/.test(text[i])) i += 1;
        continue;
      }
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    if (!/\s/.test(c)) prev = c;
    out += c;
    i += 1;
  }
  return out;
}

/** The sentence a tree document carries when the file held more trees than the one opened. */
export function treesNotOpenedSentence(more: number): string {
  return more === 1
    ? '1 more tree in the file was not opened; only the first is shown.'
    : `${more} more trees in the file were not opened; only the first is shown.`;
}

/** Read the first tree from a Newick file or a NEXUS trees block (TRANSLATE tables applied). */
export function extractNewickTree(text: string): string {
  return readFirstTree(text).newick;
}

/** The first tree of the file, and how many trees the file holds. */
function readFirstTree(rawText: string): { newick: string; treeCount: number } {
  const text = liftNewickSupportComments(rawText);
  const withoutComments = stripNexusComments(text);
  const isNexus = /^\s*#NEXUS\b/i.test(withoutComments.replace(/^\uFEFF/, ''));
  let source = withoutComments;
  let translate = new Map<string, string>();
  let treeCount: number;
  if (isNexus) {
    const blocks = readNexusBlocks(text);
    const trees = blocks.find((b) => b.name === 'trees');
    treeCount = blocks
      .filter((b) => b.name === 'trees')
      .reduce((n, b) => n + b.statements.filter((st) => /^u?tree\b/i.test(st)).length, 0);
    const statement = trees?.statements.find((s) => /^u?tree\b/i.test(s));
    const declaration = statement && /^u?tree\s+(?:\*\s*)?(?:'[^']*'|"[^"]*"|[^=]+?)\s*=\s*/i.exec(statement);
    if (!trees || !statement || !declaration) {
      if (nexusHasCharacterMatrix(text)) {
        throw new Error('NEXUS file has a character matrix but no TREES block; open it as an alignment');
      }
      throw new Error('NEXUS file has no tree declaration');
    }
    for (const s of trees.statements) {
      if (/^translate\b/i.test(s)) translate = parseNexusTranslate(s);
    }
    source = `${statement.slice(declaration[0].length)};`;
  } else {
    treeCount = splitOutsideQuotes(withoutComments, ';').filter((t) => indexOutsideQuotes(t, '(') >= 0).length;
  }
  const start = indexOutsideQuotes(source, '(');
  const end = start < 0 ? -1 : indexOutsideQuotes(source, ';', start);
  if (start < 0 || end < 0) throw new Error('Tree must contain a Newick topology ending in ;');
  let newick = source.slice(start, end + 1).trim();
  let depth = 0;
  let quote: string | null = null;
  for (const char of newick) {
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth < 0) break;
  }
  if (depth !== 0 || quote || indexOutsideQuotes(newick, ',') < 0) {
    throw new Error('Invalid or incomplete Newick tree');
  }
  newick = applyNexusTranslation(newick, translate);
  return { newick, treeCount };
}

/** A tree import: the tree document, the file's matrix as an alignment beside it, and what was left out. */
export interface ImportedNexusTree {
  kind: 'tree';
  doc: SequenceDocument;
  /** The DATA / CHARACTERS matrix of the same NEXUS file, opened as an alignment. */
  alignment?: { doc: SequenceDocument; sequenceCount: number };
  /** Sentences, also in the tree document's Notes, naming what the file holds that was not opened. */
  warnings: string[];
}

/**
 * Import a .nex/.nexus/.nwk/.newick file: a tree document when it holds a tree, with the file's
 * DATA/CHARACTERS matrix opened beside it as an alignment (or named as not opened, with the reader's
 * reason, when it cannot be read); a NEXUS file with only a matrix opens as an alignment document.
 */
export function importNexusOrNewickDocument(
  text: string,
  fileName: string,
): ImportedNexusTree | { kind: 'alignment'; doc: SequenceDocument; sequenceCount: number } {
  const isNexus = /^\s*#NEXUS\b/i.test(text.replace(/^\uFEFF/, ''));
  const hasMatrix = isNexus && nexusHasCharacterMatrix(text);
  if (hasMatrix && !readNexusBlocks(text).some((b) => b.name === 'trees')) {
    const aln = parseNexusAlignment(text);
    return { kind: 'alignment', doc: nexusToAlignmentDocument(aln, fileName), sequenceCount: aln.sequences.length };
  }
  let alignment: ImportedNexusTree['alignment'];
  const matrixWarnings: string[] = [];
  if (hasMatrix) {
    try {
      const aln = parseNexusAlignment(text);
      alignment = { doc: nexusToAlignmentDocument(aln, fileName), sequenceCount: aln.sequences.length };
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).replace(/\.?$/, '.');
      matrixWarnings.push(`The character matrix was not opened: ${reason}`);
    }
  }
  const { doc, warnings } = buildTreeDocument(text, fileName, matrixWarnings);
  return alignment ? { kind: 'tree', doc, alignment, warnings } : { kind: 'tree', doc, warnings };
}

export function createTreeDocument(text: string, fileName: string): SequenceDocument {
  return buildTreeDocument(text, fileName, []).doc;
}

/** The tree document, its Notes naming the trees not opened and any `extraWarnings`. */
function buildTreeDocument(text: string, fileName: string, extraWarnings: string[]): { doc: SequenceDocument; warnings: string[] } {
  const { newick, treeCount } = readFirstTree(text);
  const warnings = [...(treeCount > 1 ? [treesNotOpenedSentence(treeCount - 1)] : []), ...extraWarnings];
  const layout = layoutNewickPhylogeneticTreeRust(newick, 'phylogram', 900, 520);
  if (layout.tipCount < 2) throw new Error('Tree must have at least two readable tips');
  const stem = fileName.replace(/\.(nex|nexus|nwk|newick)$/i, '') || 'Imported_Tree';
  const now = new Date().toISOString();
  const doc: SequenceDocument = {
    id: `tree-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: stem,
    accession: '',
    description: `Imported phylogenetic tree from ${fileName}`,
    moleculeType: 'DNA',
    topology: 'linear',
    sequence: '',
    features: [],
    primers: [],
    history: [],
    documentKind: 'tree',
    docMetadata: {
      Newick: newick,
      'No. tips': layout.tipCount,
      'No. nodes': layout.totalNodes,
      'Source Format': /\.nex(us)?$/i.test(fileName) ? 'NEXUS' : 'Newick',
      ...(treeCount > 1 ? { 'Trees in file': treeCount } : {}),
      ...(warnings.length ? { Notes: `Warnings:\n${warnings.map((w) => `- ${w}`).join('\n')}\n` } : {}),
    },
    createdAt: now,
    updatedAt: now,
    folder: 'Tree Documents',
  };
  return { doc, warnings };
}
