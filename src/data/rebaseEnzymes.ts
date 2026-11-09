// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { RestrictionEnzyme } from '../types/bio';

/**
 * Curated REBASE Type II & Type IIS Restriction Endonuclease Catalog
 * loaded directly from the compiled Rust `molbiocraft-cloning` crate.
 */
export const REBASE_ENZYMES: RestrictionEnzyme[] =
  invokeRustBioSync<RestrictionEnzyme[]>('get_rebase_enzymes');
