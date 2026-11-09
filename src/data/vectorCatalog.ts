// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { Topology } from '../types/bio';

export type VectorCatalogCategory =
  | 'Cloning & Entry'
  | 'Bacterial Expression'
  | 'Mammalian Expression'
  | 'Antibody & Fc Fusion'
  | 'Viral Transfer & Packaging'
  | 'CRISPR, Transposon & CAR-T'
  | 'Yeast, Plant, Insect & IVT'
  | 'Reporter & Standard DNA';

export interface CatalogVectorEntry {
  id: string;
  name: string;
  source: 'Twist Bioscience' | 'Modular Vector Systems' | 'ConductScience' | 'Addgene / Standard';
  vendorLine: string;
  category: VectorCatalogCategory;
  topology: Topology;
  nominalSizeBp: number;
  hostSystem: string;
  origin: string;
  copyNumber: 'high' | 'medium' | 'low' | 'single';
  bacterialMarker: string;
  eukaryoticMarker: string;
  promoter: string;
  fusionTags: string[];
  proteaseSite?: string;
  reporterOrCargo?: string;
  regulatoryElements: string[];
  mcsEnzymes: string[];
  recommendedStrain: string;
  maxCargoKb?: number;
  partBlueprintIds: string[];
  summary: string;
}

/**
 * Curated Vector Backbone Catalog loaded synchronously from `molbiocraft-cloning` (Rust).
 */
export const VECTOR_CATALOG: CatalogVectorEntry[] =
  invokeRustBioSync<CatalogVectorEntry[]>('get_vector_catalog');
