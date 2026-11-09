// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { CloningMethodType, SequenceDocument, Topology } from '../types/bio';

export type ActionVectorGroup =
  | 'gateway-donor'
  | 'gateway-dest'
  | 'ta-vectors'
  | 'gc-vectors'
  | 'topo-ta'
  | 'topo-blunt'
  | 'topo-directional';

export interface CloningActionVectorPreset {
  id: string;
  name: string;
  group: ActionVectorGroup;
  cloningMethod: CloningMethodType;
  topology: Topology;
  nominalSizeBp: number;
  hostSystem: string;
  selectionMarker: string;
  recombinationOrCloningSite: string;
  promoter: string;
  mcsEnzymes: string[];
  summary: string;
}

export const CLONING_ACTION_VECTOR_PRESETS: CloningActionVectorPreset[] =
  invokeRustBioSync<CloningActionVectorPreset[]>('get_cloning_action_vector_presets');

export function buildCloningActionVectorDocument(
  preset: CloningActionVectorPreset
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('build_cloning_action_vector_document', { preset });
}
