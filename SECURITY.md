# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `1.0.x` | :white_check_mark: Active Support |
| `< 1.0.0` | :x: Upgrade to `v1.0.0+` |

## Security Architecture

- **Local-First Sequence Processing**: All DNA, RNA, protein, cloning, phylogenetic, and Sanger `.ab1` chromatogram analyses execute locally on-device with zero background telemetry or mandatory cloud uploads.
- **Hardened Tauri v2 WebView & Least-Privilege Capabilities**:
  - Enforces a strict `Content-Security-Policy` in [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json) (`object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'self'`, `form-action 'self'`, `freezePrototype: true`) restricting `connect-src` to Tauri IPC, the local `127.0.0.1:18420` embedded Rust REST server, and explicit user-triggered public database fetches (NCBI E-utilities, UniProtKB, and RCSB PDB).
  - Scopes window permissions via [`src-tauri/capabilities/default.json`](./src-tauri/capabilities/default.json).
- **Dual-Layer IPC Path & Payload Validation**:
  - Frontend (`validateCrossPlatformFilename` and `normalizeCrossPlatformPath` in [`src/platform/osPlatform.ts`](./src/platform/osPlatform.ts)) and Rust (`sanitize_workspace_path` in [`crates/molbiocraft-core/src/lib.rs`](./crates/molbiocraft-core/src/lib.rs)) reject NUL bytes, `..` parent-directory traversal, Windows reserved DOS device names, oversized payloads, and writes to protected OS directories (`/System`, `/usr`, `/etc`, `/proc`, `/sys`, `C:\Windows`, `C:\Program Files`).
- **OS Sandboxing & Integrity Verification**:
  - **macOS**: Ad-hoc signed with App Sandbox entitlements (`packaging/macos/entitlements.plist`) scoping access to `~/Library/Application Support/org.molbiocraft.desktop` and user-selected files via native `NSOpenPanel`/`NSSavePanel`.
  - **Linux**: Respects XDG Base Directories and Flatpak `org.freedesktop.portal.FileChooser` boundaries.
  - **Session Checksums**: `.mbc` Workbench Session files verify payload integrity via dual 32-bit FNV-1a and IEEE 802.3 CRC32 checksums prior to workspace hydration.
- **Scoped BioJS Macro Execution**: Custom workflow scripts execute inside [`src/plugins/pluginEngine.js`](./src/plugins/pluginEngine.js) without arbitrary shell access.

## Reporting a Vulnerability

Please report security issues via [GitHub Issues](https://github.com/manbaritone/MolBioCraft/issues) or directly to the repository maintainer (`@manbaritone`). Include affected OS (`macOS`, `Windows`, or `Linux`), MolBioCraft version, and minimal reproduction steps.
