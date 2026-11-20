// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { RestrictionEnzyme } from '../types/bio';

let enzymes: RestrictionEnzyme[] | null = null;

/** The restriction enzyme catalogue, asked of the engine on the first call and kept. */
function loadEnzymes(): RestrictionEnzyme[] {
  enzymes ??= invokeRustBioSync<RestrictionEnzyme[]>('get_rebase_enzymes');
  return enzymes;
}

/**
 * Curated REBASE Type II & Type IIS Restriction Endonuclease Catalog
 * from the compiled Rust `molbiocraft-cloning` crate.
 *
 * Built like `SAMPLE_LIBRARY` (src/data/sampleLibrary.ts), with the same limits: a Proxy over an empty
 * array that asks the engine on first use, not while this module loads (BG-01M6QDEV, D0276). Reads and
 * writes, `delete` and `Object.defineProperty` of a configurable property included, go to the engine's
 * array; `structuredClone` and `postMessage` of it throw a DataCloneError, and `Object.freeze`,
 * `Object.seal`, `Object.preventExtensions` or defining a non-configurable property throw a TypeError
 * and change nothing, so copy it first (`[...REBASE_ENZYMES]`) for those. Nothing in the app clones, posts
 * or freezes it.
 */
export const REBASE_ENZYMES: RestrictionEnzyme[] = new Proxy([] as RestrictionEnzyme[], {
  get: (_t, key) => Reflect.get(loadEnzymes(), key),
  set: (_t, key, value) => Reflect.set(loadEnzymes(), key, value),
  has: (_t, key) => Reflect.has(loadEnzymes(), key),
  deleteProperty: (_t, key) => Reflect.deleteProperty(loadEnzymes(), key),
  // A non-configurable property is refused before it reaches the array: the empty target lacks it, so
  // the Proxy would throw after the array had already changed.
  defineProperty: (_t, key, descriptor) =>
    descriptor.configurable !== false && Reflect.defineProperty(loadEnzymes(), key, descriptor),
  ownKeys: () => Reflect.ownKeys(loadEnzymes()),
  getOwnPropertyDescriptor: (_t, key) => Reflect.getOwnPropertyDescriptor(loadEnzymes(), key),
  // Refused, so a failed freeze or seal leaves the stand-in extensible and still working.
  preventExtensions: () => false,
});

/**
 * The built-in catalogue entry whose name equals `name`, trimmed and compared case-insensitively
 * (US-01M7DVMJ AC4), or undefined. A custom definition under such a name clashes with it.
 */
export function builtInEnzymeNamed(
  name: string,
  catalogue: readonly RestrictionEnzyme[] = REBASE_ENZYMES,
): RestrictionEnzyme | undefined {
  const key = String(name).trim().toLowerCase();
  if (key === '') return undefined;
  return catalogue.find((e) => e.name.toLowerCase() === key);
}
