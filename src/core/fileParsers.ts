// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Bioinformatics Flatfile & Next-Generation Sequencing I/O Bridge
 * backed by the compiled Rust `molbiocraft-formats` crate (`noodles-fasta`,
 * `noodles-fastq`, `noodles-gff`, `noodles-bed`, `noodles-vcf`, `noodles-sam`,
 * GenBank, EMBL, and binary packet parsers).
 */

import {
  FastqParseSummary,
  invokeRustBioSync,
  parseBedNoodlesRust,
  ParsedVcfVariant,
  parseFastqNoodlesRust,
  parseGff3NoodlesRust,
  parseSamNoodlesRust,
  parseVcfNoodlesRust,
  SamAlignmentSummary,
} from '../lib/rustBioEngine';
import type { MoleculeType, SequenceDocument, SequenceFeature } from '../types/bio';

export function parseFasta(text: string, defaultName = 'Imported_FASTA'): SequenceDocument[] {
  return invokeRustBioSync<SequenceDocument[]>('parse_fasta', { text, defaultName });
}

/**
 * A GenBank flat file as a document, read by the Rust importer (`parse_genbank_flatfile`). A join
 * of complemented parts, join(complement(101..160),complement(11..40)), is the minus-strand
 * feature its complement(join(11..40,101..160)) form is, its parts stored in that form's order. A
 * join that mixes plus- and minus-strand parts is kept on the plus strand in its listed order, and
 * the document's Notes end with the D0005 "Warnings:" block withWarningNotes writes, naming it
 * (BG-01M6SMBS).
 */
export function parseGenBank(text: string, fallbackName = 'Imported_GenBank'): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('parse_genbank', { text, fallbackName });
}

/**
 * Extensions that the workbench recognises but cannot open as sequence
 * documents. Without this list they fell through to the FASTA reader, which
 * prepends a header to *any* text and produced junk "Protein" documents.
 */
const UNSUPPORTED_DOCUMENT_EXTENSIONS: Record<string, string> = {
  csv: 'a spreadsheet table',
  tsv: 'a spreadsheet table',
  xlsx: 'a spreadsheet',
  docx: 'a word-processor document',
  pdf: 'a PDF document',
  png: 'an image',
  jpg: 'an image',
  jpeg: 'an image',
  json: 'a JSON file that is not a MolBioCraft session',
};

const EXPORT_SEQUENCE = 'Export the sequence as GenBank (.gb), EMBL or FASTA and open that file.';
const EXPORT_ALIGNMENT = 'Export the alignment as FASTA, NEXUS or PHYLIP and open that file.';
const EXPORT_RECORDS = 'Export the records as GenBank and open those files.';
/**
 * Proprietary file types MolBioCraft does not read (CR-01M6T9MT), each with the open format to
 * export to: the plasmid files (.dna/.prot/.rna), the alignment file (.meg) and the
 * sequence-database archives (.ma4/.pa4/.oa4). The desktop shell passes a dropped file of these
 * types through to the importer, so this is the one place the message is written.
 */
const REFUSED_FILE_TYPES: Record<string, string> = {
  dna: EXPORT_SEQUENCE,
  prot: EXPORT_SEQUENCE,
  rna: EXPORT_SEQUENCE,
  meg: EXPORT_ALIGNMENT,
  ma4: EXPORT_RECORDS,
  pa4: EXPORT_RECORDS,
  oa4: EXPORT_RECORDS,
};

const extensionOf = (fileName: string): string | undefined => fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];

/** The export hint for a file of a refused proprietary type, or null for any other file. */
export function refusedFileTypeReason(fileName: string): string | null {
  const ext = extensionOf(fileName);
  if (!ext || !(ext in REFUSED_FILE_TYPES)) return null;
  return `"${fileName}" cannot be opened: MolBioCraft does not read this file type. ${REFUSED_FILE_TYPES[ext]}`;
}

/** Reason a file cannot be imported as a sequence document, or null when it may be. */
export function unsupportedImportReason(fileName: string): string | null {
  const refused = refusedFileTypeReason(fileName);
  if (refused) return refused;
  const ext = extensionOf(fileName);
  if (!ext || !(ext in UNSUPPORTED_DOCUMENT_EXTENSIONS)) return null;
  return `"${fileName}" is ${UNSUPPORTED_DOCUMENT_EXTENSIONS[ext]}; it cannot be opened as a sequence document.`;
}

/**
 * Decide whether header-less text is a raw sequence (possibly grouped in
 * blocks of 10 with position numbers) rather than prose, a table or a binary
 * payload. Text that starts with a FASTA '>' header is always accepted.
 */
export function assessRawSequenceText(text: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { ok: false, reason: 'the file is empty' };
  if (trimmed.startsWith('>')) return { ok: true };
  // NUL bytes / replacement characters: a binary file decoded as text.
  const sample = trimmed.slice(0, 65536);
  const binaryish = (sample.match(/[\u0000\uFFFD]/g) ?? []).length;
  if (binaryish > 0) return { ok: false, reason: 'it is a binary file, not sequence text' };
  // Classic FASTA/PIR ';' comment lines, and a 5'-…-3' primer wrapper.
  const body = trimmed
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(';'))
    .join('\n')
    .replace(/^5['′]-?/, '')
    .replace(/-?3['′]$/, '');
  const tokens = body.split(/\s+/).filter((t) => t && !/^\d+$/.test(t));
  if (tokens.length === 0) return { ok: false, reason: 'it contains no sequence letters' };
  const bad = tokens.find((t) => !/^[A-Za-z*\-.~]+$/.test(t));
  if (bad) {
    return { ok: false, reason: `it contains "${bad.slice(0, 24)}", which is not a sequence symbol` };
  }
  // Nucleotide text is a sequence however it is grouped (codon-spaced, blocks
  // of 5, short lines): IUPAC symbols only, with unambiguous bases making up
  // >= 60% (the engine's nucleotide rule), so degenerate primers pass while
  // short English spelled from IUPAC letters ("a cat had a bad day") does not.
  const letters = tokens.join('').replace(/[^A-Za-z]/g, '');
  const coreBases = (letters.match(/[ACGTUNacgtun]/g) ?? []).length;
  const allNucleotide =
    tokens.every((t) => /^[ACGTUNRYSWKMBDHVacgtunryswkmbdhv\-.~*]+$/.test(t)) &&
    letters.length > 0 &&
    coreBases >= letters.length * 0.6;
  if (tokens.length > 1 && !allNucleotide) {
    const lengths = tokens.map((t) => t.length).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    if (median < 8) return { ok: false, reason: 'it looks like prose rather than a sequence' };
  }
  return { ok: true };
}

/** EMBL / ENA flatfile (ID / AC / DE / FT / SQ line types). */
/** A BAM file decoded to SAM text (first `maxRecords` records; 0 = all). */
export function bamToSam(buffer: ArrayBuffer, maxRecords = 0): string {
  return invokeRustBioSync<string>('bam_to_sam', { bytes: Array.from(new Uint8Array(buffer)), maxRecords });
}

export function parseEMBL(text: string, fallbackName = 'Imported_EMBL'): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('parse_embl', { text, fallbackName });
}

/** True when the text is an EMBL record (first non-blank line is an `ID   ` line). */
export function looksLikeEmblRecord(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').trimStart().split('\n', 1)[0] ?? '';
  return /^ID {3}\S/.test(first);
}

/**
 * A binary trace file (ABIF or SCF, told apart by signature) as a document. Plain-text bases under a
 * trace extension are read as a sequence; any other bytes give an empty sequence, never invented bases.
 */
export function parseDnaBinaryPacket(buffer: ArrayBuffer, fileName: string): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('parse_binary_packet', {
    bytes: Array.from(new Uint8Array(buffer)),
    fileName,
  });
}

export function exportToGenBank(doc: SequenceDocument): string {
  return invokeRustBioSync<string>('export_genbank', { doc });
}

export function exportToFasta(doc: SequenceDocument): string {
  return invokeRustBioSync<string>('export_fasta', { doc });
}

export function exportToGFF3(doc: SequenceDocument): string {
  return invokeRustBioSync<string>('export_gff3', { doc });
}

export function exportToEMBL(doc: SequenceDocument): string {
  return invokeRustBioSync<string>('export_embl', { doc });
}

export function parseFastq(text: string, maxReads = 500): FastqParseSummary {
  return parseFastqNoodlesRust(text, maxReads);
}

export function parseGFF3(text: string): SequenceFeature[] {
  return parseGff3NoodlesRust(text);
}

export function parseBED(text: string): SequenceFeature[] {
  return parseBedNoodlesRust(text);
}

export function parseVCF(text: string): ParsedVcfVariant[] {
  return parseVcfNoodlesRust(text);
}

export function parseSAM(text: string): SamAlignmentSummary {
  return parseSamNoodlesRust(text);
}

// ---------------------------------------------------------------------------
// NEXUS lexing helpers and DATA / CHARACTERS matrix import
// ---------------------------------------------------------------------------

/**
 * Remove NEXUS `[...]` comments (nested; quote-aware, so brackets inside quoted
 * labels are kept). Throws when a comment is not closed.
 */
export function stripNexusComments(text: string): string {
  let out = '';
  let commentDepth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (commentDepth > 0) {
      if (char === '[') commentDepth += 1;
      else if (char === ']') commentDepth -= 1;
      continue;
    }
    if (quote) {
      out += char;
      if (char === quote) {
        if (text[i + 1] === quote) out += text[++i];
        else quote = null;
      }
      continue;
    }
    if (char === '[') { commentDepth = 1; continue; }
    if (char === "'" || char === '"') quote = char;
    out += char;
  }
  if (commentDepth !== 0) throw new Error('Unclosed NEXUS comment');
  return out;
}

/** Split comment-free NEXUS text into `;`-terminated statements (`;` inside quotes is kept). */
export function splitNexusStatements(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      current += char;
      if (char === quote) {
        if (text[i + 1] === quote) current += text[++i];
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    if (char === ';') {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** A NEXUS block: its lower-case name and its statements (without BEGIN/END). */
export interface NexusBlock {
  name: string;
  statements: string[];
}

/** Group the statements of a NEXUS file into blocks. */
export function readNexusBlocks(text: string): NexusBlock[] {
  const body = stripNexusComments(text.replace(/^﻿/, ''));
  const blocks: NexusBlock[] = [];
  let current: NexusBlock | null = null;
  for (const raw of splitNexusStatements(body)) {
    const statement = raw.replace(/^#NEXUS\b\s*/i, '').trim();
    if (!statement) continue;
    const begin = /^begin\s+(\S+)$/i.exec(statement);
    if (begin) {
      current = { name: begin[1].toLowerCase(), statements: [] };
      blocks.push(current);
      continue;
    }
    if (/^end(block)?$/i.test(statement)) { current = null; continue; }
    current?.statements.push(statement);
  }
  return blocks;
}

/** Remove NEXUS quoting from a word ('it''s' -> it's). */
export function unquoteNexusWord(word: string): string {
  const q = word[0];
  if ((q === "'" || q === '"') && word.length >= 2 && word[word.length - 1] === q) {
    return word.slice(1, -1).split(q + q).join(q);
  }
  return word;
}

/** True when the NEXUS text has a DATA or CHARACTERS block with a MATRIX. */
export function nexusHasCharacterMatrix(text: string): boolean {
  try {
    return readNexusBlocks(text).some((b) =>
      (b.name === 'data' || b.name === 'characters') && b.statements.some((s) => /^matrix\b/i.test(s)));
  } catch {
    return false;
  }
}

/** Sequence data from a NEXUS DATA / CHARACTERS block. */
export interface NexusAlignment {
  names: string[];
  sequences: string[];
  moleculeType: MoleculeType;
  /** The DATATYPE as written (or "inferred"). */
  dataType: string;
  interleaved: boolean;
  ntax: number;
  nchar: number;
}

const IUPAC_FROM_SET: Record<string, string> = {
  AG: 'R', CT: 'Y', CG: 'S', AT: 'W', GT: 'K', AC: 'M',
  CGT: 'B', AGT: 'D', ACT: 'H', ACG: 'V', ACGT: 'N',
};

function nexusFormatSymbol(format: string, key: string): string | undefined {
  const m = new RegExp(`\\b${key}\\s*=\\s*(?:'([^'])'|"([^"])"|(\\S))`, 'i').exec(format);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** Split a matrix line into words, keeping quoted names and {..}/(..) state sets whole. */
function tokenizeMatrixLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let setClose: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      current += char;
      if (char === quote) {
        if (line[i + 1] === quote) current += line[++i];
        else quote = null;
      }
      continue;
    }
    if (setClose) {
      if (!/\s/.test(char)) current += char;
      if (char === setClose) setClose = null;
      continue;
    }
    if ((char === "'" || char === '"') && current === '') { quote = char; current += char; continue; }
    if (char === '{') setClose = '}';
    else if (char === '(') setClose = ')';
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Parse the character matrix of a NEXUS DATA (or TAXA + CHARACTERS) block.
 * Handles sequential and interleaved matrices, NTAX/NCHAR, DATATYPE
 * (DNA/RNA/NUCLEOTIDE/PROTEIN), custom MISSING/GAP/MATCHCHAR symbols and
 * {..}/(..) polymorphic state sets (mapped to IUPAC codes, or X for protein).
 * Gaps become '-', missing data 'N' (nucleotides) or 'X' (protein).
 * Throws with a readable reason when the block is not a sequence alignment.
 */
export function parseNexusAlignment(text: string): NexusAlignment {
  const blocks = readNexusBlocks(text);
  const block = blocks.find((b) => (b.name === 'data' || b.name === 'characters')
    && b.statements.some((s) => /^matrix\b/i.test(s)));
  if (!block) throw new Error('NEXUS file has no DATA or CHARACTERS block with a MATRIX');
  const taxa = blocks.find((b) => b.name === 'taxa');
  const find = (b: NexusBlock | undefined, key: string) => b?.statements.find((s) => new RegExp(`^${key}\\b`, 'i').test(s)) ?? '';
  const dimensions = find(block, 'dimensions');
  const format = find(block, 'format').replace(/\b(symbols|equate|labels)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, ' ');
  const ntaxMatch = /\bntax\s*=\s*(\d+)/i.exec(dimensions) ?? /\bntax\s*=\s*(\d+)/i.exec(find(taxa, 'dimensions'));
  const ncharMatch = /\bnchar\s*=\s*(\d+)/i.exec(dimensions);
  const ntax = ntaxMatch ? Number(ntaxMatch[1]) : 0;
  const nchar = ncharMatch ? Number(ncharMatch[1]) : 0;
  if (/\btranspose\b/i.test(format)) throw new Error('Transposed NEXUS matrices are not supported');
  if (/\btokens\b/i.test(format) && !/\bnotokens\b/i.test(format)) throw new Error('NEXUS matrices written as TOKENS are not supported');
  const dataTypeRaw = /\bdatatype\s*=\s*(\w+)/i.exec(format)?.[1];
  const dataTypeLower = dataTypeRaw?.toLowerCase();
  if (dataTypeLower && !['dna', 'rna', 'nucleotide', 'protein'].includes(dataTypeLower)) {
    throw new Error(`NEXUS DATATYPE=${dataTypeRaw} is not a DNA, RNA or protein alignment`);
  }
  const interleaved = /\binterleave\b/i.test(format) && !/\binterleave\s*=\s*(?:no|false)\b/i.test(format);
  const missing = nexusFormatSymbol(format, 'missing') ?? '?';
  const gap = nexusFormatSymbol(format, 'gap') ?? '-';
  const matchChar = nexusFormatSymbol(format, 'matchchar');

  const matrixStatement = find(block, 'matrix');
  const lines = matrixStatement.replace(/^matrix\b/i, '').split(/\r?\n/).map(tokenizeMatrixLine).filter((t) => t.length > 0);

  // Raw states per row (sets kept as "{AG}"), counted one per state.
  const splitStates = (token: string): string[] => token.match(/\{[^}]*\}|\([^)]*\)|[^{(]/g) ?? [];
  const names: string[] = [];
  const rows: string[][] = [];
  const indexOf = new Map<string, number>();
  const rowFor = (name: string) => {
    let idx = indexOf.get(name);
    if (idx === undefined) {
      idx = names.length;
      indexOf.set(name, idx);
      names.push(name);
      rows.push([]);
    }
    return rows[idx];
  };
  if (!interleaved && nchar > 0) {
    // Sequential: a taxon's states may wrap over several lines; the next word after NCHAR states is a name.
    let row: string[] | null = null;
    for (const token of lines.flat()) {
      if (!row || row.length >= nchar) {
        const name = unquoteNexusWord(token);
        if (indexOf.has(name)) throw new Error(`NEXUS matrix lists taxon "${name}" twice in a sequential matrix`);
        row = rowFor(name);
        continue;
      }
      row.push(...splitStates(token));
    }
  } else {
    // Interleaved (or NCHAR unknown): every line is "name states..."; repeated names continue a row.
    for (const tokens of lines) {
      const row = rowFor(unquoteNexusWord(tokens[0]));
      for (const t of tokens.slice(1)) row.push(...splitStates(t));
    }
  }
  if (names.length === 0) throw new Error('NEXUS MATRIX is empty');
  if (ntax > 0 && names.length !== ntax) {
    throw new Error(`NEXUS NTAX=${ntax} but the MATRIX has ${names.length} taxa`);
  }
  const width = nchar > 0 ? nchar : rows[0].length;
  rows.forEach((row, i) => {
    if (row.length !== width) {
      throw new Error(`NEXUS taxon "${names[i]}" has ${row.length} characters; expected ${width}${nchar > 0 ? ' (NCHAR)' : ''}`);
    }
  });

  let moleculeType: MoleculeType;
  if (dataTypeLower === 'protein') moleculeType = 'Protein';
  else if (dataTypeLower === 'rna') moleculeType = 'RNA';
  else if (dataTypeLower === 'dna' || dataTypeLower === 'nucleotide') moleculeType = 'DNA';
  else {
    const letters = rows.flat().filter((s) => s.length === 1 && /[A-Za-z]/.test(s)).join('');
    moleculeType = /^[ACGTUNRYSWKMBDHVacgtunryswkmbdhv]*$/.test(letters)
      ? (/[Uu]/.test(letters) && !/[Tt]/.test(letters) ? 'RNA' : 'DNA')
      : 'Protein';
  }
  const nucleotide = moleculeType !== 'Protein';
  const missingOut = nucleotide ? 'N' : 'X';
  const decodeState = (state: string): string => {
    if (state.length > 1) {
      if (!nucleotide) return 'X';
      const set = [...new Set(state.slice(1, -1).toUpperCase().replace(/U/g, 'T').split(''))].sort().join('');
      const code = IUPAC_FROM_SET[set] ?? 'N';
      return moleculeType === 'RNA' ? code.replace('T', 'U') : code;
    }
    if (state === gap) return '-';
    if (state === missing) return missingOut;
    return state.toUpperCase();
  };
  const sequences = rows.map((row) => row.map(decodeState));
  if (matchChar) {
    const first = rows[0].map(decodeState);
    rows.forEach((row, r) => {
      if (r === 0) return;
      row.forEach((state, c) => { if (state === matchChar) sequences[r][c] = first[c]; });
    });
  }
  return {
    names,
    sequences: sequences.map((s) => s.join('')),
    moleculeType,
    dataType: dataTypeRaw ?? 'inferred',
    interleaved,
    ntax: names.length,
    nchar: width,
  };
}

/** Builds an alignment document from a NEXUS character matrix. */
export function nexusToAlignmentDocument(nexus: NexusAlignment, fileName: string, nowIso = new Date().toISOString()): SequenceDocument {
  const stem = fileName.replace(/\.[^.]+$/, '') || 'Imported_NEXUS';
  const { moleculeType } = nexus;
  const id = `nex-${stem.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
  return {
    id,
    name: stem,
    accession: '',
    description: `NEXUS alignment from ${fileName}`,
    moleculeType,
    topology: 'linear',
    sequence: nexus.sequences[0],
    features: [],
    primers: [],
    history: [{
      id: `hist-${id}`,
      timestamp: nowIso.slice(0, 16).replace('T', ' '),
      operation: 'Imported NEXUS alignment',
      description: `${nexus.sequences.length} ${moleculeType === 'Protein' ? 'protein' : 'nucleotide'} sequences, ${nexus.nchar.toLocaleString()} sites`,
      parentIds: [],
      lengthBp: nexus.nchar,
      topology: 'linear',
    }],
    documentKind: 'alignment',
    alignmentMeta: {
      sequenceCount: nexus.sequences.length,
      isAligned: true,
      sequences: nexus.sequences.map((seq, i) => ({
        id: `${id}-n${i + 1}`,
        name: nexus.names[i] ?? `Sequence ${i + 1}`,
        sequence: seq,
      })),
    },
    docMetadata: {
      'Source Format': 'NEXUS',
      'NEXUS DATATYPE': nexus.dataType,
      'NEXUS Layout': nexus.interleaved ? 'Interleaved' : 'Sequential',
    },
    createdAt: nowIso,
    updatedAt: nowIso,
    folder: 'Alignments',
  };
}
