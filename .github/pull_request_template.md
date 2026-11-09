## Summary
Briefly describe the molecular biology, bioinformatics, UI, or cross-platform engineering changes introduced in this Pull Request.

## Affected Layers
- [ ] **TypeScript / React Workbench Studios & Shared Inspector** (`src/components/`, `src/App.tsx`)
- [ ] **Core Bioinformatics, Vector Architect & Guided Pipelines** (`src/core/`)
- [ ] **Cross-Platform 3-OS Abstraction Layer (`macOS` / `Windows` / `Linux`)** (`src/platform/osPlatform.ts`)
- [ ] **7-Crate Pure-Rust Bioinformatics Workspace & WASM Engine** (`crates/molbiocraft-*`)
- [ ] **Tauri v2 Desktop Shell, IPC Commands & Embedded REST Server** (`src-tauri/`)
- [ ] **JavaScript BioJS Plugin Engine** (`src/plugins/`)
- [ ] **Desktop Packaging (`macOS .dmg` / `Windows .msi & Portable .exe` / `Linux .deb`)** (`packaging/`, `scripts/`, `.github/workflows/release.yml`)

## Verification Checklist
- [ ] `npm run wasm:build` and `npm test` pass all Vitest suites
- [ ] `cargo test --workspace` and `cargo test --manifest-path src-tauri/Cargo.toml` pass with 0 failures
- [ ] `npm run build` succeeds with zero TypeScript (`tsc --noEmit`) or bundler errors
- [ ] Verified cross-platform paths, filenames (`NFC` / DOS reserved stems / 255-byte limit), and shortcuts across `macOS`, `Windows`, and `Linux`
