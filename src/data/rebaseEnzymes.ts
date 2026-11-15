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

/**
 * The built-in catalogue entry whose name equals `name`, trimmed and compared case-insensitively
 * (US-01M7DVMJ AC4), or undefined. A custom definition under such a name clashes with it.
 */
export function builtInEnzymeNamed(
  name: string,
  catalogue: readonly RestrictionEnzyme[] = REBASE_ENZYMES,
): RestrictionEnzyme | undefined {
  const key = String(name).trim().toLowerCase();
  if (key === '') return undefined;
  return catalogue.find((e) => e.name.toLowerCase() === key);
}
