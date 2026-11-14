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

The desktop and installer icons (`src-tauri/icons/`, `packaging/*.icns|ico|png`) are not made
here; they still come from `scripts/generate_icons.py`.
