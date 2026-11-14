#!/usr/bin/env python3
# Copyright 2026 MolBioCraft Contributors
# SPDX-License-Identifier: CC-BY-NC-4.0
"""
Writes the desktop and installer icons from the one tracked Phoenix mascot master,
packaging/brand/phoenix-mascot.png (see packaging/brand/SOURCES.md). Run from the repository root:

    python3 scripts/generate_icons.py

The mascot is an indigo rounded tile that fills its canvas edge to edge, on an opaque black
outer background (the master has no alpha). Every icon cuts those outer corners away with a
rounded-rectangle alpha mask at the tile's own corner radius, so no black box shows in the Dock,
taskbar or launcher. Colours are never keyed: the engraved dark lines inside the tile stay opaque.
Each size is a LANCZOS downscale of the master, masked at that size.

Outputs (file names, pixel sizes and container formats are what src-tauri/tauri.conf.json and
the installers expect):
  - src-tauri/icons/32x32.png, 128x128.png, 128x128@2x.png, icon.png (512),
    Square*Logo.png and StoreLogo.png
  - src-tauri/icons/icon.ico  = packaging/molbiocraft.ico   (16, 24, 32, 48, 64, 128, 256 px)
  - src-tauri/icons/icon.icns = packaging/AppIcon.icns       (16 to 1024 px, made by iconutil)
  - packaging/icon_512.png, packaging/icon_256.png
  - packaging/logo.svg = public/logo.svg (the README logo; nothing in the UI draws it)
"""

import base64
import io
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

# The tile's corner radius as a fraction of its side, shared with the web favicon.
from generate_brand_web import TILE_CORNER_RADIUS_RATIO

MASCOT_MASTER = Path("packaging/brand/phoenix-mascot.png")
PACKAGING_DIR = Path("packaging")
PUBLIC_DIR = Path("public")
TAURI_ICONS_DIR = Path("src-tauri") / "icons"

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)

# iconutil's .iconset file names and their pixel sizes.
ICONSET_ENTRIES = (
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
)

TAURI_PNGS = (
    ("32x32.png", 32),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
    ("icon.png", 512),
    ("Square30x30Logo.png", 30),
    ("Square44x44Logo.png", 44),
    ("Square71x71Logo.png", 71),
    ("Square89x89Logo.png", 89),
    ("Square107x107Logo.png", 107),
    ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150),
    ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
    ("StoreLogo.png", 50),
)


def load_mascot() -> Image.Image:
    if not MASCOT_MASTER.is_file():
        raise FileNotFoundError(f"Missing tracked brand master: {MASCOT_MASTER}")
    mascot = Image.open(MASCOT_MASTER)
    if mascot.width != mascot.height:
        raise ValueError(f"{MASCOT_MASTER} must be square, found {mascot.width}x{mascot.height}")
    return mascot.convert("RGB")


def tile_mask(side: int, supersample: int = 8) -> Image.Image:
    """A rounded-square alpha mask at the mascot tile's corner radius, anti-aliased by averaging
    supersample x supersample blocks (a box filter: no ringing leaves faint alpha in the corners)."""
    big = side * supersample
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=round(big * TILE_CORNER_RADIUS_RATIO), fill=255
    )
    return mask.reduce(supersample)


def icon_frame(mascot: Image.Image, side: int) -> bytes:
    """The mascot tile at side x side px, its outer corners transparent, as PNG bytes."""
    frame = mascot.resize((side, side), Image.Resampling.LANCZOS).convert("RGBA")
    frame.putalpha(tile_mask(side))
    buf = io.BytesIO()
    frame.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_windows_ico(frames: dict[int, bytes], out_path: Path) -> None:
    """A multi-resolution Windows .ico: reserved 0, type 1, one PNG-compressed image per size."""
    header = struct.pack("<HHH", 0, 1, len(ICO_SIZES))
    offset = 6 + 16 * len(ICO_SIZES)
    entries = []
    for px in ICO_SIZES:
        data = frames[px]
        # A width or height of 256 is stored as 0.
        entries.append(struct.pack("<BBBBHHII", px % 256, px % 256, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    out_path.write_bytes(header + b"".join(entries) + b"".join(frames[px] for px in ICO_SIZES))


def write_icns(frames: dict[int, bytes], out_path: Path) -> None:
    """A macOS .icns made by iconutil from an .iconset of the PNG frames."""
    iconutil = shutil.which("iconutil")
    if iconutil is None:
        raise RuntimeError("iconutil not found: the .icns is made on macOS (run this script there)")
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir()
        for name, px in ICONSET_ENTRIES:
            (iconset / name).write_bytes(frames[px])
        subprocess.run([iconutil, "-c", "icns", str(iconset), "-o", str(out_path)], check=True)
    if out_path.read_bytes()[:4] != b"icns":
        raise RuntimeError(f"iconutil did not write an ICNS container: {out_path}")


def logo_svg(frame_512: bytes) -> str:
    """The README logo: the masked mascot tile on a 512 viewBox, inset 16 px like the old logo."""
    b64 = base64.b64encode(frame_512).decode("ascii")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <title>MolBioCraft</title>
  <rect x="0" y="0" width="512" height="512" fill="#ffffff" opacity="0" />
  <rect x="16" y="16" width="480" height="480" rx="96" ry="96" fill="#3F51B5" />
  <image href="data:image/png;base64,{b64}" x="16" y="16" width="480" height="480" />
</svg>
"""


def main() -> None:
    mascot = load_mascot()
    TAURI_ICONS_DIR.mkdir(parents=True, exist_ok=True)

    sizes = {px for px in ICO_SIZES} | {px for _, px in ICONSET_ENTRIES} | {px for _, px in TAURI_PNGS}
    frames = {px: icon_frame(mascot, px) for px in sorted(sizes)}

    for name, px in TAURI_PNGS:
        (TAURI_ICONS_DIR / name).write_bytes(frames[px])
    (PACKAGING_DIR / "icon_512.png").write_bytes(frames[512])
    (PACKAGING_DIR / "icon_256.png").write_bytes(frames[256])
    print(f"[Icon Generator] Wrote {len(TAURI_PNGS)} PNGs in {TAURI_ICONS_DIR} and packaging/icon_512|256.png")

    ico_path = PACKAGING_DIR / "molbiocraft.ico"
    write_windows_ico(frames, ico_path)
    shutil.copyfile(ico_path, TAURI_ICONS_DIR / "icon.ico")
    print(f"[Icon Generator] Wrote {ico_path} and {TAURI_ICONS_DIR / 'icon.ico'}")

    icns_path = PACKAGING_DIR / "AppIcon.icns"
    write_icns(frames, icns_path)
    shutil.copyfile(icns_path, TAURI_ICONS_DIR / "icon.icns")
    print(f"[Icon Generator] Wrote {icns_path} and {TAURI_ICONS_DIR / 'icon.icns'}")

    svg = logo_svg(frames[512])
    for path in (PACKAGING_DIR / "logo.svg", PUBLIC_DIR / "logo.svg"):
        path.write_text(svg, encoding="utf-8")
    print("[Icon Generator] Wrote packaging/logo.svg and public/logo.svg")


if __name__ == "__main__":
    main()
