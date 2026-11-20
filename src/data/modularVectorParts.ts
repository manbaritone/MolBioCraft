// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { FeatureType } from '../types/bio';

export type ModularPartCategory =
  | 'Promoter'
  | 'Reporter / ORF'
  | 'Selection Marker'
  | 'Origin'
  | 'Affinity & Fusion Tag'
  | 'Protease Cleavage'
  | 'Linker / 2A / IRES'
  | 'Signal & Localization'
  | 'Regulatory / PolyA / Terminator'
  | 'Viral / Recombination'
  | 'CRISPR / CAR-T / Antibody';

export interface ModularVectorPart {
  id: string;
  name: string;
  category: ModularPartCategory;
  subCategory: string;
  source: string;
  hostSystem: string;
  featureType: FeatureType;
  color: string;
  nominalBp: number;
  sequence: string;
  summary: string;
}

let parts: ModularVectorPart[] | null = null;

/** The parts registry, asked of the engine on the first call and kept. */
function loadParts(): ModularVectorPart[] {
  parts ??= invokeRustBioSync<ModularVectorPart[]>('get_modular_vector_parts');
  return parts;
}

/**
 * Modular Genetic Parts Registry (Promoters, Reporters, Markers, Origins, Tags, Linkers, Viral Elements)
 * from the compiled Rust `molbiocraft-cloning` crate.
 *
 * Built like `SAMPLE_LIBRARY` (src/data/sampleLibrary.ts), with the same limits: a Proxy over an empty
 * array that asks the engine for the parts on first use, not while this module loads (BG-01M6QDEV).
 * Reads and writes, `delete` and `Object.defineProperty` of a configurable property included, go to
 * the engine's array; `structuredClone` and `postMessage` of it throw a DataCloneError, and
 * `Object.freeze`, `Object.seal`, `Object.preventExtensions` or defining a non-configurable property
 * throw a TypeError and change nothing, so copy it first (`[...MODULAR_VECTOR_PARTS]`) for those.
 * Nothing in the app clones, posts or freezes it.
 */
export const MODULAR_VECTOR_PARTS: ModularVectorPart[] = new Proxy([] as ModularVectorPart[], {
  get: (_t, key) => Reflect.get(loadParts(), key),
  set: (_t, key, value) => Reflect.set(loadParts(), key, value),
  has: (_t, key) => Reflect.has(loadParts(), key),
  deleteProperty: (_t, key) => Reflect.deleteProperty(loadParts(), key),
  // A non-configurable property is refused before it reaches the array: the empty target lacks it, so
  // the Proxy would throw after the array had already changed.
  defineProperty: (_t, key, descriptor) =>
    descriptor.configurable !== false && Reflect.defineProperty(loadParts(), key, descriptor),
  ownKeys: () => Reflect.ownKeys(loadParts()),
  getOwnPropertyDescriptor: (_t, key) => Reflect.getOwnPropertyDescriptor(loadParts(), key),
  // Refused, so a failed freeze or seal leaves the stand-in extensible and still working.
  preventExtensions: () => false,
});
