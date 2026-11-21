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

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# The host-path guard (BG01M6Q2FX). `host_path_guard flags` prints the CARGO_ENCODED_RUSTFLAGS the
# desktop shell is built with: the caller's own flags, then a --remap-path-prefix for this checkout
# (to nothing, so its sources read checkout-relative), CARGO_HOME (the registry and git checkouts,
# to /cargo) and RUSTUP_HOME (the rustup toolchains, to /rustup), as scripts/build_rust_wasm.mjs
# remaps the engine's, since src-tauri's Cargo.toml has no stable setting that remaps. `host_path_guard check FILE...` scans each file's
# bytes, as strings reads them, and fails naming the first five hits when it names a path under
# /Volumes/<x>/, /Users/<x>/, /home/<x>/, C:\Users\<x>\ or D:\a\<x>\ (either separator), a bare
# volume or home with no further component (/Volumes/<x>, /Users/<x>, /home/<x>, C:\Users\<x>),
# the building user's own home (os.homedir()) or any prefix remapped above (D0301).
# `build_installers.sh --guard-self-test` runs it on fixtures (guard_self_test below). The windows
# and linux jobs of .github/workflows/release.yml carry the same guard, byte for byte, as their
# HOST_PATH_GUARD.
HOST_PATH_GUARD="$(cat <<'JS'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [mode, ...files] = process.argv.slice(1);
const die = (m) => { console.error(`host-path guard: ${m}`); process.exit(1); };
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
// A Windows path (a drive letter or any backslash) in its given, forward-slash and backslash forms.
const forms = (p) => (/\\|^[A-Za-z]:/.test(p) ? [p, p.replaceAll('\\', '/'), p.replaceAll('/', '\\')] : [p]);
// The checkout (the working directory) to nothing, CARGO_HOME (its registry and git checkouts) to
// /cargo and RUSTUP_HOME (its toolchains, the sysroot of a rustup rustc) to /rustup, each home
// where cargo looks for it (unset: .cargo or .rustup under the user's home; relative: under the
// checkout), as given and as its real path, shortest first: rustc applies the last remapping that
// matches, and CARGO_HOME can sit inside the checkout (the local .toolchain).
const root = process.cwd();
const home = (value, dir) => (value ? path.resolve(root, value) : path.join(os.homedir(), dir));
const remaps = [
  [root, ''],
  [home(process.env.CARGO_HOME, '.cargo'), '/cargo'],
  [home(process.env.RUSTUP_HOME, '.rustup'), '/rustup'],
]
  .flatMap(([from, to]) => [...new Set([from, real(from)].flatMap(forms))].map((p) => [p, to]))
  .sort(([a], [b]) => a.length - b.length);
if (mode === 'flags') {
  // The caller's CARGO_ENCODED_RUSTFLAGS (0x1f-separated) or else RUSTFLAGS, then the remaps.
  const own = process.env.CARGO_ENCODED_RUSTFLAGS !== undefined
    ? process.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f')
    : (process.env.RUSTFLAGS ?? '').split(/\s+/);
  process.stdout.write([...own.filter(Boolean), ...remaps.map(([from, to]) => `--remap-path-prefix=${from}=${to}`)].join('\x1f'));
  process.exit(0);
}
if (mode !== 'check' || files.length === 0) die(`usage: flags | check FILE...; got: ${[mode, ...files].join(' ')}`);
// A path under a volume, a user's home or a GitHub runner workspace (/Volumes/x/, /Users/x/,
// /home/x/, C:\Users\x\, D:\a\x\, with either separator), and a bare volume or home with no
// further component (/Volumes/x, /Users/x, /home/x, C:\Users\x, either separator): a run of
// user-name characters ([\w.$~-]) after it, ending at the end of the text or at any byte that
// cannot continue a user name, so /Users/user\0 and /Users/userorg.molbiocraft.desktop are hits.
const HOST = /\/(?:Volumes|Users|home)\/[^\/\\\x00-\x1f]+\/|[A-Za-z]:[\\\/](?:Users|a)[\\\/][^\/\\\x00-\x1f]+[\\\/]|\/(?:Volumes|Users|home)\/[\w.$~-]+|[A-Za-z]:[\\\/]Users[\\\/][\w.$~-]+/g;
// Every prefix remapped above, and the building user's own home (os.homedir(), wherever it is),
// as given, as its real path and, for a Windows home, with either separator; a hit when no
// user-name character follows it.
const userHome = os.homedir();
const prefixes = [...new Set([...remaps.map(([from]) => from), ...[userHome, real(userHome)].flatMap(forms)].filter((p) => p.length > 1))];
const printable = (c) => c >= 0x20 && c < 0x7f;
let bad = false;
for (const file of files) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    die(`cannot read ${file}: ${e.message}`);
  }
  if (bytes.length === 0) die(`${file} is empty`);
  const text = bytes.toString('latin1');
  const at = new Set([...text.matchAll(HOST)].map((m) => m.index));
  for (const p of prefixes) {
    for (let i = text.indexOf(p); i !== -1; i = text.indexOf(p, i + 1)) {
      if (!/[\w.$~-]/.test(text.charAt(i + p.length))) at.add(i);
    }
  }
  if (at.size === 0) {
    console.log(`${file}: names no build-machine path`);
    continue;
  }
  // The first five hits, each as the printable run around it, the way strings prints it.
  const runs = new Set();
  for (const i of [...at].sort((a, b) => a - b)) {
    let s = i, e = i;
    while (s > 0 && printable(text.charCodeAt(s - 1))) s--;
    while (e < text.length && printable(text.charCodeAt(e))) e++;
    runs.add(text.slice(Math.max(s, i - 40), Math.min(e, i + 160)));
    if (runs.size === 5) break;
  }
  console.error(`host-path guard: ${file} names ${at.size} build-machine path(s); the first:`);
  for (const r of runs) console.error(`  ${r}`);
  bad = true;
}
process.exit(bad ? 1 : 0);
JS
)"
host_path_guard() {
  node --input-type=module -e "$HOST_PATH_GUARD" "$@"
}

# `build_installers.sh --guard-self-test` (BG01M6Q2FX AC3) runs host_path_guard check on fixture
# files written to a fresh mktemp -d, before anything is built, and builds nothing. Each fixture
# below (\0 is a NUL byte) must be refused for naming a build-machine path: \0/Users/user\0,
# \0/home/runner\0, /Users/userorg.molbiocraft.desktop\0, the building user's home (os.homedir())
# as it is, C:\Users\runneradmin\0 with either separator, this checkout's path and, with HOME
# pointed at a directory outside /Users and /home, \0<that directory>:/usr/bin\0 and, with HOME
# pointed at a symlink to it, \0<its real path>/.config\0 and, with HOME D:\builder\me (a
# Windows home outside C:\Users), \0D:/builder/me\0. An empty file must be refused as empty, and
# a clean fixture (remapped /cargo and /rustup paths, checkout-relative and system paths) must
# pass. It prints `host-path guard self-test: ok` only when every case does so, and otherwise
# names each case that did not and exits 1.
guard_self_test() {
  local dir own name home out
  local -i failed=0
  dir="$(mktemp -d "${TMPDIR:-/tmp}/molbiocraft-guard-self-test.XXXXXX")" || fail "mktemp -d cannot make the self-test directory"
  own="$(node -p 'require("node:os").homedir()')" || fail "node cannot read os.homedir()"
  printf '\000/Users/user\000' >"$dir/bare-users-home"
  printf '\000/home/runner\000' >"$dir/bare-linux-home"
  printf '/Users/userorg.molbiocraft.desktop\000' >"$dir/users-home-run-on"
  printf '%s' "$own" >"$dir/own-home"
  printf '%s\000' 'C:\Users\runneradmin' >"$dir/windows-home-backslash"
  printf '%s\000' 'C:/Users/runneradmin' >"$dir/windows-home-slash"
  printf '\000%s\000' "$ROOT_DIR" >"$dir/checkout"
  mkdir "$dir/home-outside-users"
  ln -s "$dir/home-outside-users" "$dir/home-link"
  printf '\000%s:/usr/bin\000' "$dir/home-outside-users" >"$dir/own-home-outside-users"
  printf '\000%s/.config\000' "$(cd "$dir/home-outside-users" && pwd -P)" >"$dir/own-home-real-path"
  printf '\000%s\000' 'D:/builder/me' >"$dir/own-home-windows-forms"
  : >"$dir/empty"
  printf '\000%s' '/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228/src/de/mod.rs' \
    '/rustup/toolchains/stable-aarch64-apple-darwin/lib/rustlib/src/rust/library/core/src/fmt/mod.rs' \
    'src/main.rs' 'crates/molbiocraft-core/src/lib.rs' '/usr/lib/libSystem.B.dylib' \
    '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit' >"$dir/clean"
  printf '\000' >>"$dir/clean"

  for name in bare-users-home bare-linux-home users-home-run-on own-home windows-home-backslash windows-home-slash checkout own-home-outside-users own-home-real-path own-home-windows-forms empty; do
    case "$name" in
      own-home-outside-users) home="$dir/home-outside-users" ;;
      own-home-real-path) home="$dir/home-link" ;;
      own-home-windows-forms) home='D:\builder\me' ;;
      *) home="${HOME:-}" ;;
    esac
    out="$(HOME="$home" host_path_guard check "$dir/$name" 2>&1)" && { echo "host-path guard self-test: $name passed; the guard printed: $out" >&2; failed=1; continue; }
    if [ "$name" = empty ]; then
      [[ "$out" == *"$dir/$name is empty"* ]] || { echo "host-path guard self-test: $name was refused, but not as empty: $out" >&2; failed=1; }
    else
      [[ "$out" == *"$dir/$name names "*" build-machine path(s)"* ]] || { echo "host-path guard self-test: $name was refused, but not for a build-machine path: $out" >&2; failed=1; }
    fi
  done
  out="$(host_path_guard check "$dir/clean" 2>&1)" || { echo "host-path guard self-test: clean was refused; the guard printed: $out" >&2; failed=1; }
  rm -rf "$dir"
  [ "$failed" = 0 ] || fail "host-path guard self-test failed (the cases are above)"
  echo "host-path guard self-test: ok"
}

if [ "${1:-}" = --guard-self-test ]; then
  guard_self_test
  exit 0
fi

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
SHELL_RUSTFLAGS="$(host_path_guard flags)" || fail "the host-path guard cannot work out the --remap-path-prefix flags"
CARGO_ENCODED_RUSTFLAGS="$SHELL_RUSTFLAGS" npx --yes --package="$TAURI_CLI" -- tauri build --target "$TARGET" --bundles app,dmg --ci

echo "==> [3/3] Checking the .app and the .dmg, and copying the .dmg to release/..."
BUNDLE_DIR="src-tauri/target/$TARGET/release/bundle"
DMG="$BUNDLE_DIR/dmg/MolBioCraft_${APP_VERSION}_universal.dmg"
OUT="release/MolBioCraft-${APP_VERSION}-macOS-universal.dmg"

# check_app APP: the binary macOS launches holds an arm64 and an x86_64 slice and names no
# build-machine path (host_path_guard check), the bundle's ad-hoc signature verifies, and
# Contents/Resources holds this checkout's NOTICE and PROVENANCE.md.
check_app() {
  local app="$1" plist exe archs f
  plist="$app/Contents/Info.plist"
  [ -f "$plist" ] || fail "$plist is missing"
  exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")" || fail "$plist names no CFBundleExecutable"
  [ -f "$app/Contents/MacOS/$exe" ] || fail "$app/Contents/MacOS/$exe (the CFBundleExecutable) is missing"
  archs="$(/usr/bin/lipo -archs "$app/Contents/MacOS/$exe")" || fail "lipo cannot read $app/Contents/MacOS/$exe"
  [[ " $archs " == *" arm64 "* ]] || fail "$app/Contents/MacOS/$exe has no arm64 slice (lipo -archs: $archs)"
  [[ " $archs " == *" x86_64 "* ]] || fail "$app/Contents/MacOS/$exe has no x86_64 slice (lipo -archs: $archs)"
  host_path_guard check "$app/Contents/MacOS/$exe" || fail "$app/Contents/MacOS/$exe names a build-machine path (the hits are above)"
  /usr/bin/codesign --verify --deep --strict "$app" || fail "the code signature of $app does not verify"
  for f in NOTICE PROVENANCE.md; do
    [ -f "$app/Contents/Resources/$f" ] || fail "$app/Contents/Resources/$f is missing"
    cmp -s "$f" "$app/Contents/Resources/$f" || fail "$app/Contents/Resources/$f differs from this checkout's $f"
  done
  echo "$app: $exe is universal ($archs) and names no build-machine path; signature verifies; NOTICE and PROVENANCE.md in Contents/Resources"
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
