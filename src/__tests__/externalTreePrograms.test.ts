// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import {
  cachedExternalTree,
  detectExternalTreePrograms,
  EXTERNAL_TREE_ALGORITHMS,
  externalTreeCacheKey,
  isExternalTreeAlgorithm,
} from '../core/externalTreePrograms';

describe('external tree programs (client)', () => {
  it('recognises exactly the four external algorithms', () => {
    expect(EXTERNAL_TREE_ALGORITHMS.every(isExternalTreeAlgorithm)).toBe(true);
    expect(isExternalTreeAlgorithm('Neighbor-Joining (NJ)')).toBe(false);
    expect(isExternalTreeAlgorithm('Maximum Likelihood (ML)')).toBe(false);
  });

  it('reports "not the desktop app" instead of pretending programs are missing', async () => {
    await expect(detectExternalTreePrograms()).resolves.toBeNull();
  });

  it('keys cached runs by program and exact alignment', () => {
    const k = externalTreeCacheKey('PhyML (ML + SH-aLRT)', ['a', 'b'], ['ACGT', 'ACGA']);
    expect(externalTreeCacheKey('PhyML (ML + SH-aLRT)', ['a', 'b'], ['ACGT', 'ACGA'])).toBe(k);
    expect(externalTreeCacheKey('PhyML (ML + SH-aLRT)', ['a', 'b'], ['ACGT', 'ACGG'])).not.toBe(k);
    expect(externalTreeCacheKey('FastTree (Approx-ML)', ['a', 'b'], ['ACGT', 'ACGA'])).not.toBe(k);
    expect(externalTreeCacheKey('PhyML (ML + SH-aLRT)', ['ab', ''], ['ACGT', 'ACGA'])).not.toBe(k);
    expect(cachedExternalTree(k)).toBeUndefined();
  });
});
