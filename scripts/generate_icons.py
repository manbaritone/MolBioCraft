#!/usr/bin/env python3
# Copyright 2026 MolBioCraft Contributors
# Licensed under the MolBioCraft Personal & Academic Research License v1.0 (Non-Commercial)
"""
Generates packaging/logo.svg and rasterizes it 1:1 into:
  - packaging/icon_512.png
  - packaging/icon_256.png
  - packaging/AppIcon.icns (macOS Universal App Icon)
  - packaging/molbiocraft.ico (Windows Multi-Resolution Icon)
  - src-tauri/icons/*

Design:
  - Background color: #3F51B5 (Material Indigo)
  - Style: Vintage naturalist woodcut engraving / crosshatch etching illustration
  - Subject: Mythical Phoenix bird rising with Protein Alpha-Helix, Beta-Sheet, DNA Double Helix & molecular structures
"""

import base64
import io
import math
import platform
import struct
import subprocess
import tempfile
from pathlib import Path
from PIL import Image


def generate_svg_string(bg_mode: str = "squircle") -> str:
    """
    MolBioCraft app icon — mythical Phoenix bird rising with Protein Alpha-Helix, Beta-Sheet,
    DNA Double Helix & molecular structures in vintage woodcut engraving style on indigo blue background.
    """
    pkg_dir = Path("packaging")
    master_png = pkg_dir / ("molbiocraft_app_icon_square_1024.png" if bg_mode == "square" else "molbiocraft_app_icon_1024.png")

    b64_data = ""
    if master_png.exists():
        im = Image.open(master_png).resize((512, 512), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        b64_data = base64.b64encode(buf.getvalue()).decode("ascii")

    if bg_mode == "square":
        bg = '<rect x="0" y="0" width="512" height="512" fill="#3F51B5" />'
        border = ""
    else:
        bg = (
            '<rect x="0" y="0" width="512" height="512" fill="#ffffff" opacity="0" />\n'
            '  <rect x="16" y="16" width="480" height="480" rx="108" ry="108" fill="#3F51B5" />'
        )
        border = ""

    return f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <title>MolBioCraft</title>
  {bg}
  <image href="data:image/png;base64,{b64_data}" x="0" y="0" width="512" height="512" />
{border}</svg>
"""


# (icns type, pixel size) for a modern, retina-complete macOS icon bundle.
ICNS_ENTRIES = (
    (b"icp4", 16),
    (b"icp5", 32),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic07", 128),
    (b"ic13", 256),
    (b"ic08", 256),
    (b"ic14", 512),
    (b"ic09", 512),
    (b"ic10", 1024),
)


def write_icns(frames: dict[int, bytes], out_path: Path) -> None:
    """
    Write a macOS .icns bundle from PNG frames keyed by pixel size.

    ICNS is a flat container -- an 'icns' magic, the total byte length, then one
    (4-byte type, 4-byte length-including-header, payload) record per image -- so it
    can be assembled without macOS `iconutil`.
    """
    chunks = []
    for icns_type, px in ICNS_ENTRIES:
        data = frames.get(px)
        if data is None:
            continue
        chunks.append(icns_type + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    out_path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def write_windows_ico(
    png_bytes_256: bytes, png_bytes_64: bytes, png_bytes_32: bytes, out_path: Path
) -> None:
    """Write a standard multi-resolution Windows .ico file embedding PNG frames."""
    images = [(0, 0, png_bytes_256), (64, 64, png_bytes_64), (32, 32, png_bytes_32)]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    dir_entries = []
    payloads = []

    for w, h, data in images:
        entry = struct.pack(
            "<BBBBHHII",
            w,
            h,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        dir_entries.append(entry)
        payloads.append(data)
        offset += len(data)

    out_path.write_bytes(header + b"".join(dir_entries) + b"".join(payloads))


def main() -> None:
    import shutil

    pkg_dir = Path("packaging")
    pkg_dir.mkdir(exist_ok=True)
    public_dir = Path("public")
    public_dir.mkdir(exist_ok=True)
    tauri_icons_dir = Path("src-tauri") / "icons"
    tauri_icons_dir.mkdir(parents=True, exist_ok=True)

    master_squircle = pkg_dir / "molbiocraft_app_icon_1024.png"
    master_square = pkg_dir / "molbiocraft_app_icon_square_1024.png"

    if not master_squircle.exists():
        raise FileNotFoundError(f"Missing master icon: {master_squircle}")

    # 1. Canonical SVG logo (#3F51B5 rounded-square tile).
    svg_path = pkg_dir / "logo.svg"
    svg_content = generate_svg_string("squircle")
    svg_path.write_text(svg_content, encoding="utf-8")
    (public_dir / "logo.svg").write_text(svg_content, encoding="utf-8")
    print(f"[Icon Generator] Wrote canonical SVG logo: {svg_path} & {public_dir / 'logo.svg'}")

    base_png_512 = pkg_dir / "icon_512.png"
    base_png_256 = pkg_dir / "icon_256.png"
    ico_path = pkg_dir / "molbiocraft.ico"
    icns_path = pkg_dir / "AppIcon.icns"

    # 2. Resample master 1024 squircle to all needed icon resolutions using Lanczos
    squircle_im = Image.open(master_squircle).convert("RGBA")
    square_im = Image.open(master_square).convert("RGBA") if master_square.exists() else squircle_im

    raster_sizes = [16, 32, 64, 128, 256, 512, 1024]
    frames: dict[int, bytes] = {}
    for px in raster_sizes:
        thumb = squircle_im.resize((px, px), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, format="PNG", optimize=True)
        frames[px] = buf.getvalue()

    base_png_512.write_bytes(frames[512])
    base_png_256.write_bytes(frames[256])
    print(f"[Icon Generator] Wrote {base_png_512} & {base_png_256}")

    # 3. Windows .ico from the same frames.
    write_windows_ico(frames[256], frames[64], frames[32], ico_path)
    print(f"[Icon Generator] Created Windows icon: {ico_path}")

    # 4. macOS .icns, assembled directly (no `iconutil` dependency).
    write_icns(frames, icns_path)
    print(f"[Icon Generator] Created macOS icon: {icns_path}")

    # 5. Sync the Tauri v2 icon set.
    (tauri_icons_dir / "32x32.png").write_bytes(frames[32])
    (tauri_icons_dir / "128x128.png").write_bytes(frames[128])
    (tauri_icons_dir / "128x128@2x.png").write_bytes(frames[256])
    (tauri_icons_dir / "icon.png").write_bytes(frames[512])
    shutil.copyfile(ico_path, tauri_icons_dir / "icon.ico")
    shutil.copyfile(icns_path, tauri_icons_dir / "icon.icns")

    square_tile_specs = [
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
    ]

    for fname, px in square_tile_specs:
        thumb = square_im.resize((px, px), Image.Resampling.LANCZOS)
        thumb.save(tauri_icons_dir / fname, format="PNG", optimize=True)

    print(f"[Icon Generator] Synced {tauri_icons_dir}")


if __name__ == "__main__":
    main()
