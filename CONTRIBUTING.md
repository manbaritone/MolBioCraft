# Contributing to MolBioCraft

Thank you for contributing to **MolBioCraft**! This guide covers the architecture, development workflow, security boundaries, and cross-platform engineering standards across **macOS (Apple Silicon `arm64` & Intel `x86_64`)**, **Windows (`x64`)**, and **Linux (`x86_64`)**.

---

## 1. Prerequisites

- **Rust & Cargo** (`stable`, edition `2021`, plus the `wasm32-unknown-unknown` target for `crates/molbiocraft-wasm`)
- **Node.js** `>= 20.x` and **npm** `>= 10.x`
- **Platform WebView / Desktop Dependencies (for `src-tauri/`)**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`); add `aarch64-apple-darwin` and `x86_64-apple-darwin` targets for universal `.app`/`.dmg` packaging (`scripts/build_installers.sh`)
  - **Windows**: MSVC Build Tools and Microsoft Edge WebView2 runtime
  - **Linux (Debian/Ubuntu)**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`

---

## 2. Development & Verification Workflow

```bash
# Clone the repository
git clone https://github.com/manbaritone/MolBioCraft.git
cd MolBioCraft

# Install frontend & test dependencies
npm ci

# Compile the zero-import Rust WebAssembly engine (embeds public/molbiocraft_wasm.wasm)
npm run wasm:build

# Run the Vitest test suites
npm test

# Run the 7-crate Rust workspace tests and the Tauri desktop shell tests
cargo test --workspace
cargo test --manifest-path src-tauri/Cargo.toml

# Type-check & build production frontend + standalone HTML bundle
npm run build
npm run build:standalone

# On macOS: build universal (arm64 + x86_64) release/MolBioCraft.app and .dmg
npm run package:installers
```

---

## 3. Cross-Platform & Tauri v2 Engineering Standards

1. **Core Logic vs. OS Layer Separation**:
   - Keep pure bioinformatics algorithms (`crates/molbiocraft-*` and `src/core/`) free of OS-specific globals. Route all OS path normalization, storage directories (`~/Library/Application Support`, `%APPDATA%`, Linux XDG Base Directories), keyboard shortcuts (`⌘` vs `Ctrl+`), and file-lock retries through [`src/platform/osPlatform.ts`](./src/platform/osPlatform.ts) and [`crates/molbiocraft-core/src/lib.rs`](./crates/molbiocraft-core/src/lib.rs).
2. **Filename, Unicode & Long-Path Safety**:
   - Validate user/exported filenames with `validateCrossPlatformFilename()` (UTF-8 `NFC` normalization, 255-byte component limit, Windows reserved DOS device rejection, and Linux `EXT4`/`XFS` vs `APFS`/`NTFS` case-collision checks).
   - Resolve `.` and `..` lexical segments *before* applying Win32 `\\?\` or `\\?\UNC\` extended-length prefixes (`normalizeCrossPlatformPath()`).
3. **Non-Blocking UI & Deterministic Resource Cleanup**:
   - Execute multi-step bioinformatics pipelines via `runAsyncBioTask()` (with `AbortSignal` support) on the frontend and `tauri::async_runtime::spawn_blocking` in [`src-tauri/src/commands/`](./src-tauri/src/commands/mod.rs).
   - Wrap managed resources and subscriptions in `withManagedResource()`.
4. **Tauri v2 Security & IPC Hygiene**:
   - Keep `Content-Security-Policy` (`freezePrototype: true`, `object-src 'none'`, `base-uri 'none'`) enforced in [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json) and maintain least-privilege permissions in [`src-tauri/capabilities/default.json`](./src-tauri/capabilities/default.json).
   - Sanitize all IPC file paths via `sanitize_workspace_path()` in [`crates/molbiocraft-core/src/lib.rs`](./crates/molbiocraft-core/src/lib.rs) and `validateCrossPlatformFilename()` in [`src/platform/osPlatform.ts`](./src/platform/osPlatform.ts), and prefer batched IPC commands (`cmd_batch_sequence_stats`) over chatty per-item IPC loops.

---

## 4. License

By contributing to MolBioCraft, you agree that your contributions will be distributed under the **Creative Commons Attribution-NonCommercial 4.0 International Public License (CC BY-NC 4.0, `SPDX-License-Identifier: CC-BY-NC-4.0`)** as detailed in [`LICENSE`](./LICENSE).
