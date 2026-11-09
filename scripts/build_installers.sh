#!/usr/bin/env zsh
# Copyright 2026 MolBioCraft Contributors
# Licensed under the MolBioCraft Personal & Academic Research License v1.0 (Non-Commercial)
#
# Builds the macOS universal (Apple Silicon arm64 + Intel x86_64) MolBioCraft.app and its .dmg on
# this Mac with the Tauri bundler, checks them, and copies the disk image to
# release/MolBioCraft-<version>-macOS-universal.dmg. `npm run package:installers` runs it, and so
# does the macos-latest job of .github/workflows/release.yml.
#
# macOS only. The Windows x64 .msi and portable .exe and the Linux x86_64 .deb are built by
# release.yml on their own windows-latest and ubuntu-22.04 runners, since the Tauri bundler builds
# each of them only on its own OS.
#
# Needs the aarch64-apple-darwin and x86_64-apple-darwin Rust targets (plus wasm32-unknown-unknown
# for the engine) and Node with npm; the Tauri CLI is fetched by npx at the version pinned below.

set -euo pipefail
setopt NULL_GLOB
# Fallbacks for a shell started without a login PATH; the caller's PATH comes first.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -d "$ROOT_DIR/.toolchain/cargo" ]; then
  export RUSTUP_HOME="$ROOT_DIR/.toolchain/rustup"
  export CARGO_HOME="$ROOT_DIR/.toolchain/cargo"
  export PATH="$CARGO_HOME/bin:$PATH"
fi

# The Tauri CLI release.yml pins too (its TAURI_CLI), matching the tauri 2.12 crate in src-tauri.
TAURI_CLI='@tauri-apps/cli@2.12.4'
TARGET='universal-apple-darwin'
APP_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json', 'utf8')).version")"

echo "==> [1/3] Building the zero-import Rust WebAssembly engine (molbiocraft-wasm)..."
npm run wasm:build

echo "==> [2/3] Building the universal MolBioCraft.app and .dmg with the Tauri bundler ($TAURI_CLI, --target $TARGET)..."
# The bundler runs `npm run build` (tauri.conf.json beforeBuildCommand), builds the arm64 and x86_64
# binaries and merges them with lipo, copies bundle.resources into Contents/Resources, ad-hoc signs
# the .app (bundle.macOS.signingIdentity "-") and images it.
if [ -z "${GITHUB_ACTIONS:-}" ]; then
  export TAURI_BUNDLER_DMG_IGNORE_CI=true
fi
npx --yes --package="$TAURI_CLI" -- tauri build --target "$TARGET" --bundles app,dmg --ci

echo "==> [3/3] Checking the .app and the .dmg, and copying the .dmg to release/..."
fail() {
  echo "ERROR: $*" >&2
  exit 1
}
BUNDLE_DIR="src-tauri/target/$TARGET/release/bundle"
DMG="$BUNDLE_DIR/dmg/MolBioCraft_${APP_VERSION}_universal.dmg"
OUT="release/MolBioCraft-${APP_VERSION}-macOS-universal.dmg"

# check_app APP: the binary macOS launches holds an arm64 and an x86_64 slice, the bundle's ad-hoc
# signature verifies, and Contents/Resources holds this checkout's NOTICE and PROVENANCE.md.
check_app() {
  local app="$1" plist exe archs f
  plist="$app/Contents/Info.plist"
  [ -f "$plist" ] || fail "$plist is missing"
  exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")" || fail "$plist names no CFBundleExecutable"
  [ -f "$app/Contents/MacOS/$exe" ] || fail "$app/Contents/MacOS/$exe (the CFBundleExecutable) is missing"
  archs="$(/usr/bin/lipo -archs "$app/Contents/MacOS/$exe")" || fail "lipo cannot read $app/Contents/MacOS/$exe"
  [[ " $archs " == *" arm64 "* ]] || fail "$app/Contents/MacOS/$exe has no arm64 slice (lipo -archs: $archs)"
  [[ " $archs " == *" x86_64 "* ]] || fail "$app/Contents/MacOS/$exe has no x86_64 slice (lipo -archs: $archs)"
  /usr/bin/codesign --verify --deep --strict "$app" || fail "the code signature of $app does not verify"
  for f in NOTICE PROVENANCE.md; do
    [ -f "$app/Contents/Resources/$f" ] || fail "$app/Contents/Resources/$f is missing"
    cmp -s "$f" "$app/Contents/Resources/$f" || fail "$app/Contents/Resources/$f differs from this checkout's $f"
  done
  echo "$app: $exe is universal ($archs); signature verifies; NOTICE and PROVENANCE.md in Contents/Resources"
}

[ -f "$DMG" ] || fail "the bundler wrote no $DMG"
check_app "$BUNDLE_DIR/macos/MolBioCraft.app"

# The .app inside the disk image, the one users drag to /Applications, passes the same check. The
# image shows LICENSE as an agreement when it is opened (the bundler passes it bundle.licenseFile),
# so attach is answered Y, as a user accepts it with Agree.
MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/molbiocraft-dmg.XXXXXX")"
{ yes || true; } | PAGER=cat /usr/bin/hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MOUNT" "$DMG" >/dev/null || fail "hdiutil cannot attach $DMG"
dmg_ok=0
( check_app "$MOUNT/MolBioCraft.app" ) && dmg_ok=1
/usr/bin/hdiutil detach "$MOUNT" -quiet || /usr/bin/hdiutil detach "$MOUNT" -force -quiet || true
rmdir "$MOUNT" 2>/dev/null || true
[ "$dmg_ok" = 1 ] || fail "the MolBioCraft.app in $DMG fails the check above"

mkdir -p release
rm -f release/MolBioCraft-*-macOS-universal.dmg
cp "$DMG" "$OUT"
echo "==> Built $OUT"
ls -lh "$OUT"
