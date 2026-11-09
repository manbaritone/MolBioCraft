// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import {
  generateLargeGenomeBenchmarkRust,
  generateLargeProteinBenchmarkRust,
  invokeRustBioSync,
} from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

/**
 * Curated Molecular Biology, Genomics, Protein & Alignment Sample Library
 * synthesized directly by the Rust `molbiocraft-cloning` crate.
 */
export const SAMPLE_LIBRARY: SequenceDocument[] =
  invokeRustBioSync<SequenceDocument[]>('get_sample_library');

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
