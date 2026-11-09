// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/// <reference types="vite/client" />

declare module 'virtual:molbiocraft-wasm-bytes' {
  export const MOLBIOCRAFT_WASM_BYTES: Uint8Array | null;
  export const MOLBIOCRAFT_WASM_BASE64: string;
}
