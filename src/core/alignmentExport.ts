// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

export type AlignmentTextFormat = 'Custom' | 'FASTA' | 'Clustal' | 'PHYLIP' | 'NEXUS';

/** Serialize every row and column. Machine formats use unique, whitespace-free taxon IDs. */
export function formatAlignmentText(
  rows: readonly { name: string; sequence: string }[],
  format: AlignmentTextFormat,
  molecule: 'DNA' | 'RNA' | 'Protein',
  consensus = ''
): string {
  const length = rows.reduce((n, r) => Math.max(n, r.sequence.length), 0);
  const seqs = rows.map((r) => r.sequence.toUpperCase().replace(/\./g, '-').padEnd(length, '-'));
  // Clustal / Custom: the real names made unique and space-free (they used to get an s1_ prefix,
  // so a round trip renamed every taxon); NEXUS: the real names, quoted where NEXUS requires it.
  const names = uniqueTokenNames(rows.map((r) => r.name));
  const nexusNames = rows.map((r) => nexusName(r.name));
  const phylipIds = strictPhylipIds(rows.map((r) => r.name));
  if (format === 'FASTA') return rows.map((r, i) => `>${r.name.replace(/[\r\n]/g, ' ')}\n${seqs[i]}`).join('\n\n');
  if (format === 'PHYLIP') {
    // Strict sequential PHYLIP uses exactly ten characters for each taxon
    // identifier. Derive them from the real names (they used to be discarded
    // as seq1..seqN), keeping them unique within the ten-character limit.
    return [`${rows.length} ${length}`, ...seqs.map((s, i) => `${phylipIds[i].padEnd(10)}${s}`)].join('\n');
  }
  if (format === 'NEXUS') return [
    '#NEXUS', 'BEGIN DATA;', `  DIMENSIONS NTAX=${rows.length} NCHAR=${length};`,
    `  FORMAT DATATYPE=${molecule.toUpperCase()} MISSING=? GAP=-;`, '  MATRIX',
    ...seqs.map((s, i) => `  ${nexusNames[i]} ${s}`), '  ;', 'END;',
  ].join('\n');
  const width = Math.max(12, ...names.map((n) => n.length)) + 2;
  const blocks: string[] = [];
  for (let c = 0; c < length; c += 60) {
    const lines = seqs.map((s, i) => `${names[i].padEnd(width)}${s.slice(c, c + 60)}`);
    if (format === 'Custom') lines.unshift(`${'Consensus'.padEnd(width)}${consensus.slice(c, c + 60)}`);
    blocks.push(lines.join('\n'));
  }
  return `${format === 'Clustal' ? 'CLUSTAL multiple sequence alignment\n\n' : ''}${blocks.join('\n\n')}\n`;
}

/** Whitespace-free names, unique (a numeric suffix is added to repeats). */
export function uniqueTokenNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = raw.trim().replace(/\s+/g, '_') || `seq${i + 1}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return id;
  });
}

/** A NEXUS taxon name: bare when it is a plain token, otherwise single-quoted ('' for '). */
export function nexusName(name: string): string {
  return /^[A-Za-z0-9_.|\-]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Unique ≤10-character PHYLIP identifiers derived from taxon names. */
export function strictPhylipIds(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = raw.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || `seq${i + 1}`;
    let id = base.slice(0, 10);
    for (let n = 2; used.has(id); n++) {
      const suffix = `_${n}`;
      id = `${base.slice(0, 10 - suffix.length)}${suffix}`;
    }
    used.add(id);
    return id;
  });
}
