// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import fs from 'node:fs';
import path from 'node:path';

/** A quoted root-relative reference to a brand image, e.g. "/brand/phoenix-emblem-512.png". */
const BRAND_IMAGE_REF = /(["'`])\/brand\/([\w.-]+\.png)\1/g;

/**
 * Replace every quoted `/brand/<name>.png` reference in `source` with a `data:image/png;base64`
 * URI of that file under `<publicDir>/brand/`, so the single-file standalone build (opened from
 * file://, where a root-relative path resolves nowhere) still draws the brand images.
 * A reference to a file that does not exist throws, naming it, instead of shipping a broken image.
 */
export function inlineBrandImages(source, publicDir) {
  const cache = new Map();
  return source.replace(BRAND_IMAGE_REF, (_match, _quote, name) => {
    if (!cache.has(name)) {
      const file = path.join(publicDir, 'brand', name);
      if (!fs.existsSync(file)) {
        throw new Error(`Standalone build: brand image /brand/${name} is referenced but ${file} does not exist`);
      }
      cache.set(name, `"data:image/png;base64,${fs.readFileSync(file).toString('base64')}"`);
    }
    return cache.get(name);
  });
}
