# Phoenix brand masters

The two Phoenix artworks the operator supplied are kept here, byte for byte, so that no build or
test ever reads the git-ignored `resources/` folder. Only the file name changed (spaces removed).
Regenerate every derivative with `python3 scripts/generate_brand_web.py` from the repository root.

| Tracked master | Original file name | Pixels | Alpha | SHA-256 |
| --- | --- | --- | --- | --- |
| `packaging/brand/phoenix-mascot.png` | `Engraved Phoenix Bioinformatics Mascot.png` | 1254 x 1254 | none (RGB) | `bc3339d537010c9f5799b053f859c92dd894e3b9ce9d4cc88861cfa8bd20d5e8` |
| `packaging/brand/phoenix-emblem.png` | `Phoenix Bioinformatics Emblem.png` | 1254 x 1254 | yes (RGBA cutout) | `90b63db549da1793817ee5fd889bdb137571816bd55f28d0ed4741de0309d06a` |

## Roles

- **Mascot** - the app identity and logo mark: a phoenix in glasses working at a computer that
  shows a DNA sequence, a chromatogram, a phylogenetic tree and a protein structure, on an indigo
  rounded tile. The tile fills the canvas edge to edge; outside its rounded corners (radius about
  246 px of 1254) the artwork is opaque black, so every place that draws it either rounds it in
  CSS at 1/5 of its side or cuts those corners into the alpha channel.
- **Emblem** - the same scene as a transparent cutout with no tile, for illustrations: the About
  dialog, the welcome/home hero and the startup splash (React and boot). It is never rounded or
  masked, so its wings are never clipped.

## Derivatives

All are written by `scripts/generate_brand_web.py`: square PNGs of at most 1024 px, a contain-fit
`Image.Resampling.LANCZOS` downscale (aspect ratio kept, never stretched), with no colour keying
or recolouring.

| Derivative | From | Pixels | PNG colour type | Used by |
| --- | --- | --- | --- | --- |
| `public/brand/phoenix-mascot-256.png` | mascot | 256 x 256 | 2 (RGB, opaque tile) | `MolBioCraftLogo` (title bar), rounded in CSS |
| `public/brand/phoenix-mascot-favicon-64.png` | mascot | 64 x 64 | 6 (RGBA; corners cut to the tile radius) | `index.html` favicon, the standalone build's favicon |
| `public/brand/phoenix-emblem-512.png` | emblem | 512 x 512 | 6 (RGBA, alpha kept) | About dialog, home hero, startup splash, boot splash |

## Desktop and installer icons

`scripts/generate_icons.py` writes them from the mascot alone (run it from the repository root,
on macOS, which has `iconutil`). Each size is a LANCZOS downscale of the master whose outer black
corners are cut away by a rounded-rectangle alpha mask at the same 1/5 radius (box-filtered, so no
faint alpha is left in the corners); no colour is keyed, so the engraved lines inside the tile
stay opaque. The tile fills each icon edge to edge, as the old icon set did.

| Output | Pixels | Container |
| --- | --- | --- |
| `src-tauri/icons/32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `Square*Logo.png`, `StoreLogo.png`; `packaging/icon_512.png`, `packaging/icon_256.png` | as named (`@2x` = 256, `icon.png` = 512) | PNG, colour type 6 (RGBA) |
| `src-tauri/icons/icon.ico` = `packaging/molbiocraft.ico` | 16, 24, 32, 48, 64, 128, 256 | ICO (type 1), PNG-compressed images |
| `src-tauri/icons/icon.icns` = `packaging/AppIcon.icns` | 16 to 1024 | ICNS, made by `iconutil` from an `.iconset` |
| `packaging/logo.svg` = `public/logo.svg` (the README logo) | 512 viewBox | SVG embedding the 512 px icon |

The old engraving's masters (`packaging/molbiocraft_app_icon_*1024.png`) were removed, so no run
can restore it.
