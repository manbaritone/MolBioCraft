// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';

interface MolBioCraftLogoProps {
  size?: number;
  decorative?: boolean;
}

/**
 * MolBioCraft brand mark.
 *
 * One identity everywhere: the rising phoenix engraving on the indigo (#3F51B5) rounded tile
 * that ships as the macOS/Windows/Linux application icon. This component renders that exact
 * asset (`public/logo.svg`, written by `scripts/generate_icons.py` from the same master artwork
 * as the .icns/.ico/.png icon set), so the title bar, About dialog, startup splash, home hero,
 * boot splash and the installed application icon cannot drift apart.
 *
 * The corner radius tracks the 108/512 radius of the tile in the artwork, so the mark keeps its
 * silhouette whether it is drawn at 17 px in the menu bar or at 96 px in the home hero.
 */
export const MolBioCraftLogo: React.FC<MolBioCraftLogoProps> = ({
  size = 20,
  decorative = true,
}) => (
  <img
    src="/logo.svg"
    width={size}
    height={size}
    draggable={false}
    style={{
      flex: 'none',
      display: 'inline-block',
      verticalAlign: 'middle',
      borderRadius: `${Math.max(2, Math.round((size * 108) / 512))}px`,
      pointerEvents: 'none',
    }}
    {...(decorative
      ? { alt: '', 'aria-hidden': true }
      : { alt: 'MolBioCraft — rising phoenix over a DNA double helix' })}
  />
);
