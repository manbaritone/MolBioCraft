// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import {
  generateLargeGenomeBenchmarkRust,
  generateLargeProteinBenchmarkRust,
  invokeRustBioSync,
} from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

let samples: SequenceDocument[] | null = null;

/** The sample library, asked of the engine on the first call and kept. */
function loadSamples(): SequenceDocument[] {
  samples ??= invokeRustBioSync<SequenceDocument[]>('get_sample_library');
  return samples;
}

/**
 * Curated Molecular Biology, Genomics, Protein & Alignment Sample Library
 * synthesized directly by the Rust `molbiocraft-cloning` crate.
 *
 * A Proxy over an empty array that asks the engine for its documents on first use, not while this
 * module loads, so importing the module runs no engine call (BG-01M6QDEV). Reads (an index, `length`,
 * `in`, a method, iteration, `Object.keys`, JSON) and writes (an index, `length`, `push`, `delete`,
 * `Object.defineProperty` of a configurable property) go to the engine's array. It is still a Proxy:
 * `structuredClone` and `postMessage` of it throw a DataCloneError, and `Object.freeze`, `Object.seal`,
 * `Object.preventExtensions` or defining a non-configurable property throw a TypeError and change
 * nothing. Copy it first (`[...SAMPLE_LIBRARY]`) for those; nothing in the app clones, posts or
 * freezes the array itself.
 */
export const SAMPLE_LIBRARY: SequenceDocument[] = new Proxy([] as SequenceDocument[], {
  get: (_t, key) => Reflect.get(loadSamples(), key),
  set: (_t, key, value) => Reflect.set(loadSamples(), key, value),
  has: (_t, key) => Reflect.has(loadSamples(), key),
  deleteProperty: (_t, key) => Reflect.deleteProperty(loadSamples(), key),
  // A non-configurable property is refused before it reaches the array: the empty target lacks it, so
  // the Proxy would throw after the array had already changed.
  defineProperty: (_t, key, descriptor) =>
    descriptor.configurable !== false && Reflect.defineProperty(loadSamples(), key, descriptor),
  ownKeys: () => Reflect.ownKeys(loadSamples()),
  getOwnPropertyDescriptor: (_t, key) => Reflect.getOwnPropertyDescriptor(loadSamples(), key),
  // Refused, so a failed freeze or seal leaves the stand-in extensible and still working.
  preventExtensions: () => false,
});

/**
 * Synthesize a deterministic large bacterial chromosome / eukaryotic genomic contig benchmark
 * (e.g., 500,000 bp – 5,000,000 bp) with realistic `oriC`/`terC` GC-skew & annotated operons in Rust.
 */
export function generateLargeGenomeBenchmark(
  lengthBp = 500_000,
  organismPreset = 'Escherichia coli K-12'
): SequenceDocument {
  return generateLargeGenomeBenchmarkRust(lengthBp, organismPreset);
}

/**
 * Synthesize a deterministic multi-thousand-residue giant structural polyprotein benchmark
 * (e.g., 10,000 aa – 35,000 aa Titin Ig/FnIII domains) in Rust.
 */
export function generateLargeProteinBenchmark(
  lengthAa = 10_000,
  proteinPreset = 'Titin_Ig_Polyprotein'
): SequenceDocument {
  return generateLargeProteinBenchmarkRust(lengthAa, proteinPreset);
}
