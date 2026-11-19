// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Writes src-tauri/native-menu.json, the native macOS menu, from the command registry
 * (US-01M6Q159). Run it with `npm run menu:native` after changing a menu label, path or key;
 * src/__tests__/nativeMenuRegistry.test.ts fails while the file and the registry differ.
 * It runs under vite-node, which loads the registry's TypeScript.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nativeMenuSpec } from '../src/core/commandRegistry.ts';
import { CLONING_ACTION_VECTOR_PRESETS } from '../src/data/cloningActionVectors.ts';

const out = fileURLToPath(new URL('../src-tauri/native-menu.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(nativeMenuSpec(CLONING_ACTION_VECTOR_PRESETS), null, 2)}\n`);
console.log(`Wrote ${out}`);
