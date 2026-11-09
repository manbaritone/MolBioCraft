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

/** Read the first tree from a Newick file or a NEXUS trees block (TRANSLATE tables applied). */
export function extractNewickTree(text: string): string {
  const withoutComments = stripNexusComments(text);
  const isNexus = /^\s*#NEXUS\b/i.test(withoutComments.replace(/^\uFEFF/, ''));
  let source = withoutComments;
  let translate = new Map<string, string>();
  if (isNexus) {
    const blocks = readNexusBlocks(text);
    const trees = blocks.find((b) => b.name === 'trees');
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
  return newick;
}

/**
 * Import a .nex/.nexus/.nwk/.newick file: a tree document when it holds a tree,
 * otherwise (NEXUS with only a DATA/CHARACTERS matrix) an alignment document.
 */
export function importNexusOrNewickDocument(
  text: string,
  fileName: string,
): { kind: 'tree'; doc: SequenceDocument } | { kind: 'alignment'; doc: SequenceDocument; sequenceCount: number } {
  const isNexus = /^\s*#NEXUS\b/i.test(text.replace(/^\uFEFF/, ''));
  if (isNexus && nexusHasCharacterMatrix(text) && !readNexusBlocks(text).some((b) => b.name === 'trees')) {
    const aln = parseNexusAlignment(text);
    return { kind: 'alignment', doc: nexusToAlignmentDocument(aln, fileName), sequenceCount: aln.sequences.length };
  }
  return { kind: 'tree', doc: createTreeDocument(text, fileName) };
}

export function createTreeDocument(text: string, fileName: string): SequenceDocument {
  const newick = extractNewickTree(text);
  const layout = layoutNewickPhylogeneticTreeRust(newick, 'phylogram', 900, 520);
  if (layout.tipCount < 2) throw new Error('Tree must have at least two readable tips');
  const stem = fileName.replace(/\.(nex|nexus|nwk|newick)$/i, '') || 'Imported_Tree';
  const now = new Date().toISOString();
  return {
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
    },
    createdAt: now,
    updatedAt: now,
    folder: 'Tree Documents',
  };
}
