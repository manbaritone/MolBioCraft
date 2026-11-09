// Copyright 2026 MolBioCraft Contributors
// Licensed under the MolBioCraft Personal & Academic Research License v1.0 (Non-Commercial)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIRTUAL_WASM_ID = 'virtual:molbiocraft-wasm-bytes';
const RESOLVED_VIRTUAL_WASM_ID = '\0' + VIRTUAL_WASM_ID;

function molbiocraftWasmInlinePlugin(): Plugin {
  const wasmPath = path.join(ROOT_DIR, 'public', 'molbiocraft_wasm.wasm');
  let resolvedOutDir = path.join(ROOT_DIR, 'dist');
  let isBuild = false;
  return {
    name: 'molbiocraft-wasm-inline',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
      isBuild = config.command === 'build';
    },
    // `public/molbiocraft_wasm.wasm` is only a build input: its bytes are embedded through
    // `virtual:molbiocraft-wasm-bytes`. Vite copies everything in `public/` verbatim, so drop the
    // unused ~5 MB raw copy from the emitted bundle (it would otherwise ship twice inside every
    // Tauri installer).
    closeBundle() {
      if (!isBuild) return;
      const emittedCopy = path.join(resolvedOutDir, 'molbiocraft_wasm.wasm');
      if (fs.existsSync(emittedCopy)) {
        fs.rmSync(emittedCopy);
      }
    },
    resolveId(id) {
      if (id === VIRTUAL_WASM_ID) {
        return RESOLVED_VIRTUAL_WASM_ID;
      }
      return null;
    },
    load(id, options) {
      if (id !== RESOLVED_VIRTUAL_WASM_ID) {
        return null;
      }
      if (options?.ssr) {
        return [
          `import fs from 'node:fs';`,
          `export const MOLBIOCRAFT_WASM_BYTES = new Uint8Array(fs.readFileSync(${JSON.stringify(wasmPath)}));`,
          `export const MOLBIOCRAFT_WASM_BASE64 = '';`,
        ].join('\n');
      }
      const b64 = fs.readFileSync(wasmPath).toString('base64');
      return [
        `export const MOLBIOCRAFT_WASM_BYTES = null;`,
        `export const MOLBIOCRAFT_WASM_BASE64 = ${JSON.stringify(b64)};`,
      ].join('\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const isStandalone = mode === 'standalone';
  return {
    plugins: [molbiocraftWasmInlinePlugin(), react()],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 6000,
      rollupOptions: {
        output: isStandalone
          ? {
              inlineDynamicImports: true,
            }
          : {
              manualChunks(id) {
                if (id.includes('molbiocraft-wasm-bytes')) {
                  return 'rust-wasm-payload';
                }
                if (
                  id.includes('node_modules/react-dom') ||
                  id.includes('node_modules/react/') ||
                  id.includes('node_modules/scheduler')
                ) {
                  return 'vendor-react';
                }
                if (id.includes('node_modules/lucide-react')) {
                  return 'vendor-icons';
                }
                if (id.includes('node_modules/molstar') || id.includes('node_modules/rxjs')) {
                  return 'vendor-molstar';
                }
                return undefined;
              },
            },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    test: {
      // Never collect tests from agent worktrees under .claude/: a path-filtered run in the main
      // checkout would otherwise also run each worktree's copy, against that tree's code (BG-01M6SBEE).
      exclude: [...configDefaults.exclude, '**/.claude/**'],
      // Measured only (`npm run test:coverage`): no thresholds are set, so a coverage figure never fails a run.
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        reporter: ['text', 'json-summary', 'html'],
      },
    },
    clearScreen: false,
  };
});
