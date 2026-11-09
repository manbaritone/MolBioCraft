// Copyright 2026 MolBioCraft Contributors
// Licensed under the MolBioCraft Personal & Academic Research License v1.0 (Non-Commercial)

import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const assetsDir = path.join(distDir, 'assets');

const files = fs.readdirSync(assetsDir);
const cssFile = files.find((f) => f.endsWith('.css'));
const jsFiles = files.filter((f) => f.endsWith('.js'));
const jsFile = jsFiles.find((f) => /^index[-.]/.test(f)) ?? jsFiles[0];

if (!cssFile || !jsFile) {
  throw new Error('Missing built CSS or JS in dist/assets. Run vite build --mode standalone first.');
}

const rawCssContent = fs.readFileSync(path.join(assetsDir, cssFile), 'utf8');
const jsContent = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');

// Inline built font assets (e.g. Space Grotesk & Poppins .ttf/.woff2) as data URIs so file:// desktop bundles render offline
const cssContent = rawCssContent.replace(
  /url\((['"]?)(?:\/assets\/|\.\/)([^'")]+?\.(?:ttf|woff2?|otf))\1\)/gi,
  (fullMatch, _quote, assetName) => {
    const assetPath = path.join(assetsDir, assetName);
    if (!fs.existsSync(assetPath)) return fullMatch;
    const ext = path.extname(assetName).toLowerCase().slice(1);
    const mime =
      ext === 'woff2'
        ? 'font/woff2'
        : ext === 'woff'
          ? 'font/woff'
          : ext === 'otf'
            ? 'font/otf'
            : 'font/ttf';
    const b64 = fs.readFileSync(assetPath).toString('base64');
    return `url("data:${mime};base64,${b64}")`;
  }
);

// Escape closing style/script tags using callback replacers so $ patterns in minified bundles are never altered
const safeCssContent = cssContent.replace(/<\/style>/gi, () => '<\\/style>');
const safeJsContent = jsContent.replace(/<\/script>/gi, () => '<\\/script>');

const logoSvgPath = path.resolve('packaging', 'logo.svg');
const faviconLinkTag = fs.existsSync(logoSvgPath)
  ? `\n    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${fs.readFileSync(logoSvgPath).toString('base64')}" />`
  : '';

const standaloneHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />${faviconLinkTag}
    <script>
      try {
        document.querySelector('meta[name="color-scheme"]').content =
          localStorage.getItem('color-scheme') ?? 'light dark';
      } catch {}
    </script>
    <title>&#8203;</title>
    <style>${safeCssContent}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${safeJsContent}</script>
  </body>
</html>
`;

fs.writeFileSync(path.join(distDir, 'molbiocraft-standalone.html'), standaloneHtml, 'utf8');
console.log(
  `[MolBioCraft Bundler] Created self-contained offline bundle dist/molbiocraft-standalone.html (${(
    Buffer.byteLength(standaloneHtml) / 1024
  ).toFixed(1)} KB)`
);
