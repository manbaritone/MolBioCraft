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
 * An array that asks the engine for its documents on first use, not while this module loads, so
 * importing the module runs no engine call. Every read (an index, `length`, a method, iteration,
 * JSON) and every assignment (an index, `length`, `push`) goes to the engine's array.
 */
export const SAMPLE_LIBRARY: SequenceDocument[] = new Proxy([] as SequenceDocument[], {
  get: (_t, key) => Reflect.get(loadSamples(), key),
  has: (_t, key) => Reflect.has(loadSamples(), key),
  ownKeys: () => Reflect.ownKeys(loadSamples()),
  getOwnPropertyDescriptor: (_t, key) => Reflect.getOwnPropertyDescriptor(loadSamples(), key),
  set: (_t, key, value) => Reflect.set(loadSamples(), key, value),
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
