// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M7NKNJ AC5: a letter that is no nucleotide code in a DNA row of a multiple alignment is
 * scored as N, kept as written and named by the engine; the Multiple Alignment runner keeps that
 * sentence in the saved alignment's Notes, in the Warnings block withWarningNotes writes.
 *
 * The runner is the shipped one (runMultipleAlignment), over the real WASM engine, for the default
 * route and each preset the Multiple Alignment dialog offers (MSA_ALGORITHMS). The expected sentence
 * is this file's own wording of the row and position the X sits at, not the engine's reply.
 *
 * Wrong implementations this catches: the engine reading the X row as protein and saying nothing
 * (as before US-01M7NKNJ); a sentence naming the wrong row, position or letter; the runner dropping
 * the engine's warnings; a Warnings block written for rows of A, C, G and T alone; the X replaced
 * or dropped in the saved row.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import { MSA_ALGORITHMS, runMultipleAlignment } from '../core/operationRunners';
import type { SequenceDocument } from '../types/bio';

const doc = (id: string, name: string, sequence: string): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, moleculeType: 'DNA' });

const ROWS = ['ACGTACGTAAACCCGGGTTT', 'ACGTACGTAAXCCCGGGTTT', 'ACGTACGTAAGCCCGGGTTT'];
const docs = (rows: string[]) => rows.map((s, i) => doc(`r${i + 1}`, `row_${i + 1}`, s));
const ctx = { sourceLabel: '3 selected sequences' };

describe('US-01M7NKNJ AC5: Multiple Alignment keeps the stray-letter warning in the Notes', () => {
  it('US-01M7NKNJ AC5 ends the Notes with a Warnings block naming the X, and writes none without it', () => {
    const at = ROWS[1].indexOf('X') + 1;
    expect(at, 'fixture: the X is the 11th letter of row 2').toBe(11);
    const sentence = `1 letter that is not a nucleotide code (X at ${at} in row 2) was scored as N.`;
    expect(MSA_ALGORITHMS.map((a) => a.value), 'the dialog offers the default and four presets').toHaveLength(5);
    for (const { value } of MSA_ALGORITHMS) {
      const saved = runMultipleAlignment(docs(ROWS), { algorithm: value }, ctx).created[0];
      const rows = saved.alignmentMeta?.sequences?.map((m) => m.sequence.replace(/-/g, ''));
      expect(rows, `${value || 'default'}: rows kept as written, the X included`).toEqual(ROWS);
      const notes = String(saved.docMetadata?.Notes ?? '');
      const block = notes.slice(notes.lastIndexOf('Warnings:\n'));
      expect(notes.lastIndexOf('Warnings:\n'), `${value || 'default'}: a Warnings block: ${notes}`).toBeGreaterThanOrEqual(0);
      expect(block.endsWith('\n'), notes).toBe(true);
      expect(block.split('\n').filter(Boolean).slice(1), `${value || 'default'}: ${notes}`).toContain(`- ${sentence}`);

      const clean = ROWS.map((r) => r.replace('X', 'A'));
      const plain = runMultipleAlignment(docs(clean), { algorithm: value }, ctx).created[0];
      expect(plain.docMetadata?.Notes, `${value || 'default'}: no block without the X`).toBeUndefined();
    }
  });
});
