// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Contact pair as it may reach the 3D viewer. The Rust engine
 * (`align_pdb_kabsch` -> `ContactPair3D`, serde camelCase) emits
 * `{ resI, resJ, distanceAngstrom }` where resI/resJ are 0-based indices into
 * `atomsA`. Explicit atom indices and 1-based residue ordinals are accepted too.
 */
export interface StructureContactLike {
  resI?: number;
  resJ?: number;
  atomAIndex?: number;
  atomBIndex?: number;
  /** 1-based residue ordinal (legacy shape). */
  resA?: number;
  resB?: number;
  distanceAngstrom: number;
}

const isIndex = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Resolves a contact to 0-based atom indices, or null when it carries none. */
export function resolveContactAtomIndices(
  c: StructureContactLike
): [number, number] | null {
  if (isIndex(c.resI) && isIndex(c.resJ)) return [c.resI, c.resJ];
  if (isIndex(c.atomAIndex) && isIndex(c.atomBIndex)) return [c.atomAIndex, c.atomBIndex];
  if (isIndex(c.resA) && isIndex(c.resB) && c.resA >= 1 && c.resB >= 1) {
    return [c.resA - 1, c.resB - 1];
  }
  return null;
}
