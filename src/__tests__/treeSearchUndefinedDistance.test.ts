// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

// BG-01M6SB24: Minimum Evolution and Maximum Parsimony took their distances through fullMatrix,
// which fills a pair the model cannot compute with twice the largest real distance. A tree on such
// a set was saved under the model's name with no word about the made-up branch, where
// Neighbor-Joining and UPGMA refuse with the engine's sentence. Both must now refuse the same way,
// and a resampled replicate that hits such a pair must be named in the saved tree's warnings.

import { describe, expect, it } from 'vitest';
import { runBuildTree } from '../core/operationRunners';
import { EMPTY_WORKSPACE_DOCUMENT } from '../core/emptyWorkspace';
import type { SequenceDocument } from '../types/bio';

const doc = (id: string, name: string, sequence: string): SequenceDocument =>
  ({ ...EMPTY_WORKSPACE_DOCUMENT, id, name, sequence, moleculeType: 'DNA' });
const ctx = { sourceLabel: 'selected sequences' };

describe('Build Tree: Minimum Evolution and Maximum Parsimony on an undefined distance', () => {
  it('never saves an ME or MP tree on an invented distance without saying so', async () => {
    // A twelve-A clone and a twelve-C clone share no base, so their TN93 distance is undefined.
    const set = [doc('x', 'clone-A', 'A'.repeat(12)), doc('y', 'clone-C', 'C'.repeat(12)), doc('z', 'clone-M', 'ACGTACGTAAAA')];
    const noTree = 'clone-A vs clone-C: distance undefined (no shared sites, or too divergent for Tamura-Nei (TN93)). Use p-distance or remove the sequence.';
    for (const method of ['Minimum-Evolution (ME)', 'Maximum Parsimony (MP)']) {
      await expect(runBuildTree(set, { method }, ctx), method).rejects.toThrow(new Error(noTree));
    }
    // The sentence's own advice works: under p-distance every pair is defined and both methods save.
    for (const method of ['Minimum-Evolution (ME)', 'Maximum Parsimony (MP)']) {
      const saved = (await runBuildTree(set, { method, model: 'p-distance' }, ctx)).created[0];
      expect(String(saved.docMetadata?.Newick), method).toContain('clone-A');
      expect(saved.docMetadata?.Notes, `${method} on defined distances has no warning`).toBeUndefined();
    }
  }, 120000);

  it('names the resampled replicates whose distance had to be substituted', async () => {
    // clone-A and clone-B overlap in one column (9) of twenty: their p-distance is defined (0), but
    // a bootstrap replicate that does not draw column 9 leaves the pair with no shared site.
    const set = [
      doc('a', 'clone-A', `ACGTACGTAC${'-'.repeat(10)}`),
      doc('b', 'clone-B', `${'-'.repeat(9)}CGTACGTACGT`),
      doc('c', 'clone-C', 'ACGTACGTACGTACGTACGT'),
      doc('d', 'clone-D', 'ACGTACGTACGTACGTACGA'),
    ];
    const saved = (await runBuildTree(set, { method: 'Minimum-Evolution (ME)', model: 'p-distance', resampling: 'bootstrap', replicates: 20, seed: 11 }, ctx)).created[0];
    expect(String(saved.docMetadata?.['Branch support'])).toMatch(/bootstrap/);
    expect(String(saved.docMetadata?.Notes)).toMatch(/^- \d+ of 20 resampled replicates had a pair whose p-distance distance is undefined; /m);
    expect(String(saved.docMetadata?.Notes)).toContain('branch support may be off');
  }, 120000);
});
