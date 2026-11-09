// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { invokeRustBioSync } from '../lib/rustBioEngine';

export interface VectorSystemGuide {
  id: string;
  code: string;
  name: string;
  source: 'Modular Vector Systems' | 'Twist Bioscience' | 'ConductScience' | 'Addgene / Standard';
  deliveryType:
    | 'Plasmid'
    | 'Lentivirus'
    | 'AAV'
    | 'Adenovirus'
    | 'Retrovirus'
    | 'Transposon'
    | 'Bacterial'
    | 'Yeast'
    | 'Insect / Baculovirus'
    | 'Plant Binary'
    | 'IVT mRNA';
  hostGroup: string;
  maxTotalSizeKb: number;
  maxCargoKb: number;
  integrationMode:
    | 'Episomal / Transient'
    | 'Stable Chromosomal Integration'
    | 'Homologous / HITI Knock-in'
    | 'Cell-Free / Cytoplasmic mRNA';
  biosafetyLevel: 'BSL-1' | 'BSL-2';
  recommendedStrain: string;
  keyElements: string[];
  advantages: string;
  limitations: string;
}

export interface HostStrainGuide {
  id: string;
  name: string;
  organism: 'E. coli' | 'S. cerevisiae' | 'P. pastoris' | 'A. tumefaciens';
  category:
    | 'Routine Cloning'
    | 'Repeat-Stable Viral/ITR'
    | 'Gateway ccdB'
    | 'Unmethylated (dam-/dcm-)'
    | 'Protein Expression'
    | 'Yeast / Plant Host';
  genotype: string;
  methylation: string;
  intrinsicResistance: string;
  growthTempC: string;
  highlights: string;
}

export interface OriginCompatibilityGroup {
  groupCode: string;
  origins: string[];
  copyNumberClass: 'high' | 'medium' | 'low' | 'single';
  copiesPerCell: string;
  twistAccepted: 'Yes' | 'Yes (Reduced Miniprep Yield)' | 'No';
  mechanism: string;
}

export interface TwistAntibioticStandard {
  code: string;
  name: string;
  concentrationUgMl: number;
  geneMarkers: string[];
}

export const ORIGIN_COMPATIBILITY_GROUPS: OriginCompatibilityGroup[] =
  invokeRustBioSync<OriginCompatibilityGroup[]>('get_origin_compatibility_groups');

export const TWIST_ANTIBIOTIC_STANDARDS: TwistAntibioticStandard[] =
  invokeRustBioSync<TwistAntibioticStandard[]>('get_twist_antibiotic_standards');

export const VECTOR_SYSTEM_GUIDES: VectorSystemGuide[] =
  invokeRustBioSync<VectorSystemGuide[]>('get_vector_system_guides');

export const HOST_STRAIN_GUIDES: HostStrainGuide[] =
  invokeRustBioSync<HostStrainGuide[]>('get_host_strain_guides');
