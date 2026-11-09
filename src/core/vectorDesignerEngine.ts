// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Modular Vector Architect, Co-Transformation Compatibility & Clonal Onboarding Engine
 * backed by the compiled Rust `molbiocraft-cloning` crate.
 */

import type { CatalogVectorEntry } from '../data/vectorCatalog';
import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { SequenceDocument } from '../types/bio';

export interface ModularAssemblySpec {
  vectorName: string;
  systemGuideId: string;
  promoterPartId: string;
  signalOrInitPartId?: string;
  nTagPartId?: string;
  proteasePartId?: string;
  cargoMode: 'part' | 'custom-dna';
  cargoPartId?: string;
  customCargoName?: string;
  customCargoSeq?: string;
  linker2APartId?: string;
  eukaryoticMarkerPartId?: string;
  regulatoryWprePartId?: string;
  polyAOrTermPartId: string;
  originPartId: string;
  bacterialMarkerPartId: string;
}

export interface ModularAssemblyResult {
  document: SequenceDocument;
  cargoSizeBp: number;
  maxCargoBp: number;
  cargoUtilizationPct: number;
  overCapacity: boolean;
  warnings: string[];
}

export interface TwistOnboardingCheckItem {
  id: string;
  rule: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface TwistOnboardingReport {
  overallStatus: 'Ready for Onboarding' | 'Review Warnings' | 'Action Required (Blocked)';
  recommendedStrain: 'DH10B-like (37°C)' | 'Stbl3-like (30°C / 37°C)';
  productionAntibiotic: string;
  nearbyLinearizationEnzymes: string[];
  totalMassUg: number;
  checks: TwistOnboardingCheckItem[];
}

export function generateSafeBackboneSpacer(lengthBp: number, seed = 17): string {
  return invokeRustBioSync<string>('generate_safe_backbone_spacer', { lengthBp, seed });
}

export function buildMcsPolylinker(enzymeNames: string[]): string {
  return invokeRustBioSync<string>('build_mcs_polylinker', { enzymeNames });
}

export function buildCatalogVectorDocument(entry: CatalogVectorEntry): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('build_catalog_vector_document', { entry });
}

export function assembleModularCustomVector(spec: ModularAssemblySpec): ModularAssemblyResult {
  return invokeRustBioSync<ModularAssemblyResult>('assemble_modular_custom_vector', { spec });
}

export function auditTwistCustomVectorOnboarding(
  doc: SequenceDocument,
  insertionSiteBp: number,
  dnaVolumeUl = 120,
  dnaConcNgUl = 150
): TwistOnboardingReport {
  return invokeRustBioSync<TwistOnboardingReport>('audit_twist_onboarding', {
    doc,
    insertionSiteBp,
    dnaVolumeUl,
    dnaConcNgUl,
  });
}

export function simulateTwistClonalGeneInsertion(
  vectorDoc: SequenceDocument,
  insertionSiteBp: number,
  insertName: string,
  insertSeqRaw: string,
  framingMode: 'standard-scarless' | 'entr-kozak' | 'igg-variable-inframe' = 'standard-scarless'
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('simulate_twist_clonal_insertion', {
    vectorDoc,
    insertionSiteBp,
    insertName,
    insertSeqRaw,
    framingMode,
  });
}

export function checkCoTransformationCompatibility(
  vecA: CatalogVectorEntry,
  vecB: CatalogVectorEntry
): {
  compatible: boolean;
  originCompatible: boolean;
  antibioticOrthogonal: boolean;
  groupA: string;
  groupB: string;
  summary: string;
} {
  return invokeRustBioSync('check_cotransformation', { vecA, vecB });
}

export function generateCatalogCircularSvg(entry: CatalogVectorEntry): string {
  return invokeRustBioSync<string>('generate_catalog_circular_svg', { entry });
}

export function exportVectorCatalogCsv(entries: CatalogVectorEntry[]): string {
  return invokeRustBioSync<string>('export_vector_catalog_csv', { entries });
}
