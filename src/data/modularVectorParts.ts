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

/**
 * Modular Genetic Parts Registry (Promoters, Reporters, Markers, Origins, Tags, Linkers, Viral Elements)
 * loaded synchronously from the compiled Rust `molbiocraft-cloning` crate.
 */
export const MODULAR_VECTOR_PARTS: ModularVectorPart[] =
  invokeRustBioSync<ModularVectorPart[]>('get_modular_vector_parts');
