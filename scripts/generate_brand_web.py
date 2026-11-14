#!/usr/bin/env python3
# Copyright 2026 MolBioCraft Contributors
# SPDX-License-Identifier: CC-BY-NC-4.0
"""
Writes the web brand images under public/brand/ from the tracked Phoenix masters in
packaging/brand/ (see packaging/brand/SOURCES.md). Run from the repository root:

    python3 scripts/generate_brand_web.py

Every derivative is a square PNG of at most 1024 px, made by a contain-fit LANCZOS downscale
(the aspect ratio is kept and never stretched). Colours are never keyed or changed:
  - phoenix-mascot-256.png      the opaque indigo tile (RGB), for MolBioCraftLogo, which rounds
                                its corners in CSS at the tile's own radius;
  - phoenix-mascot-favicon-64.png  the same tile with its outer corners cut to that radius in the
                                alpha channel (RGBA), since a favicon cannot be masked in CSS;
  - phoenix-emblem-512.png      the emblem cutout, keeping its alpha channel (RGBA).
"""

from pathlib import Path

from PIL import Image, ImageDraw

MASTER_DIR = Path("packaging/brand")
OUT_DIR = Path("public/brand")

# The mascot's tile fills the canvas edge to edge; its corner arc measures ~246 px on the
# 1254 px master. 1/5 of the side (~251 px) clips just inside that arc, cutting the black away.
TILE_CORNER_RADIUS_RATIO = 0.2


def contain_fit(image: Image.Image, side: int) -> Image.Image:
    """Scale to fit a side x side square without stretching, centred (on a transparent canvas for
    RGBA, black for RGB) when the source is not square. The square masters need no canvas."""
    scale = min(side / image.width, side / image.height, 1.0)
    width = max(1, round(image.width * scale))
    height = max(1, round(image.height * scale))
    resized = image.resize((width, height), Image.Resampling.LANCZOS)
    if (width, height) == (side, side):
        return resized
    mode = "RGBA" if image.mode in ("RGBA", "LA") else image.mode
    canvas = Image.new(mode, (side, side), (0, 0, 0, 0) if mode == "RGBA" else (0, 0, 0))
    canvas.paste(resized, ((side - width) // 2, (side - height) // 2))
    return canvas


def rounded_tile_mask(side: int, supersample: int = 4) -> Image.Image:
    """An anti-aliased rounded-square alpha mask at the mascot tile's corner radius."""
    big = side * supersample
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=round(big * TILE_CORNER_RADIUS_RATIO), fill=255
    )
    return mask.resize((side, side), Image.Resampling.LANCZOS)


def save_png(image: Image.Image, name: str) -> None:
    path = OUT_DIR / name
    image.save(path, format="PNG", optimize=True)
    print(f"[Brand] {path} {image.size[0]}x{image.size[1]} {image.mode} {path.stat().st_size} bytes")


def main() -> None:
    mascot_path = MASTER_DIR / "phoenix-mascot.png"
    emblem_path = MASTER_DIR / "phoenix-emblem.png"
    for path in (mascot_path, emblem_path):
        if not path.is_file():
            raise FileNotFoundError(f"Missing tracked brand master: {path}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    mascot = Image.open(mascot_path).convert("RGB")
    emblem = Image.open(emblem_path)
    if emblem.mode != "RGBA":
        raise ValueError(f"{emblem_path} must be an RGBA cutout, found {emblem.mode}")

    save_png(contain_fit(mascot, 256), "phoenix-mascot-256.png")

    favicon = contain_fit(mascot, 64).convert("RGBA")
    favicon.putalpha(rounded_tile_mask(64))
    save_png(favicon, "phoenix-mascot-favicon-64.png")

    save_png(contain_fit(emblem, 512), "phoenix-emblem-512.png")


if __name__ == "__main__":
    main()
