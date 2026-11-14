// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';

/**
 * Web derivatives of the two Phoenix brand masters in `packaging/brand/` (see its SOURCES.md),
 * written to `public/brand/` by `scripts/generate_brand_web.py`. The standalone build inlines
 * every `/brand/*.png` reference as a data URI (`scripts/standalone_brand_images.mjs`).
 */
/** The mascot: the opaque indigo tile, the app's logo mark. */
export const BRAND_MASCOT_SRC = '/brand/phoenix-mascot-256.png';
/** The mascot tile at favicon size, its outer corners already cut to the tile's radius. */
export const BRAND_FAVICON_SRC = '/brand/phoenix-mascot-favicon-64.png';
/** The emblem: the same scene as a transparent cutout, for illustrations (About, home, splash). */
export const BRAND_EMBLEM_SRC = '/brand/phoenix-emblem-512.png';

interface MolBioCraftLogoProps {
  size?: number;
  decorative?: boolean;
}

/**
 * MolBioCraft brand mark: the Phoenix mascot - a phoenix in glasses working at a computer that
 * shows a DNA sequence, a chromatogram, a phylogenetic tree and a protein structure - on its
 * indigo rounded tile (`BRAND_MASCOT_SRC`).
 *
 * The mascot artwork is an opaque square whose tile runs to the edges, with black outside the
 * tile's rounded corners, so the image is clipped here to a corner radius of 1/5 of its size,
 * rounded up to a whole pixel - never less than the tile's own arc (about 246/1254), so no black
 * corner pixel shows. Only this opaque tile is rounded; the emblem cutout used for illustrations
 * is drawn unmasked.
 */
export const MolBioCraftLogo: React.FC<MolBioCraftLogoProps> = ({
  size = 20,
  decorative = true,
}) => (
  <img
    src={BRAND_MASCOT_SRC}
    width={size}
    height={size}
    draggable={false}
    style={{
      flex: 'none',
      display: 'inline-block',
      verticalAlign: 'middle',
      borderRadius: `${Math.max(2, Math.ceil(size / 5))}px`,
      pointerEvents: 'none',
    }}
    {...(decorative
      ? { alt: '', 'aria-hidden': true }
      : {
          alt: 'MolBioCraft logo: a phoenix in glasses working at a computer that shows DNA sequence, tree and protein views',
        })}
  />
);
