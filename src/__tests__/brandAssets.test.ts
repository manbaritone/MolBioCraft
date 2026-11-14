// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import nodeFs from 'node:fs';
import nodeZlib from 'node:zlib';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AboutMolBioCraftModal } from '../components/MenusPreferencesAndBlastModal';
import { AppStartupSplash } from '../components/AppStartupSplash';
import { ProjectFirstPageHome } from '../components/ProjectFirstPageHome';
import {
  BRAND_EMBLEM_SRC,
  BRAND_FAVICON_SRC,
  BRAND_MASCOT_SRC,
  MolBioCraftLogo,
} from '../components/MolBioCraftLogo';
import { inlineBrandImages } from '../../scripts/standalone_brand_images.mjs';

// US-01M7CC7X: the brand mark, About illustration, home hero, splash and favicon draw from the
// two Phoenix artworks (packaging/brand/), never from the old engraving (public/logo.svg and
// public/splash/phoenix-details.webp).

const ROOT = new URL('../../', import.meta.url);
const read = (rel: string): string => nodeFs.readFileSync(new URL(rel, ROOT), 'utf8');
const readBytes = (rel: string): Buffer => nodeFs.readFileSync(new URL(rel, ROOT));
const publicPath = (src: string): string => `public${src}`;

const OLD_ALT = 'rising phoenix over a DNA double helix';
const OLD_ENGRAVING_REFS = ['/logo.svg', '/splash/phoenix-details.webp'];

interface Png {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  interlace: number;
  /** RGBA of pixel (x, y); RGB images report alpha 255. */
  pixel: (x: number, y: number) => [number, number, number, number];
}

/** Minimal PNG reader (8-bit, colour type 2 or 6, not interlaced): IHDR plus filtered IDAT. */
function readPng(bytes: Buffer): Png {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let offset = 8;
  let ihdr: Buffer | null = null;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  expect(ihdr, 'IHDR chunk').not.toBeNull();
  const width = ihdr!.readUInt32BE(0);
  const height = ihdr!.readUInt32BE(4);
  const bitDepth = ihdr![8];
  const colourType = ihdr![9];
  const interlace = ihdr![12];
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  let rows: Buffer[] = [];
  if (channels && bitDepth === 8 && interlace === 0) {
    const raw = nodeZlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    let prev = Buffer.alloc(stride);
    rows = [];
    for (let y = 0; y < height; y += 1) {
      const filter = raw[y * (stride + 1)];
      const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
      for (let i = 0; i < stride; i += 1) {
        const a = i >= channels ? line[i - channels] : 0;
        const b = prev[i];
        const c = i >= channels ? prev[i - channels] : 0;
        let add = 0;
        if (filter === 1) add = a;
        else if (filter === 2) add = b;
        else if (filter === 3) add = (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        line[i] = (line[i] + add) & 0xff;
      }
      rows.push(line);
      prev = line;
    }
  }
  return {
    width,
    height,
    bitDepth,
    colourType,
    interlace,
    pixel: (x, y) => {
      const line = rows[y];
      const i = x * channels;
      return [line[i], line[i + 1], line[i + 2], channels === 4 ? line[i + 3] : 255];
    },
  };
}

function renderHome(): string {
  const noop = () => {};
  return renderToStaticMarkup(
    React.createElement(ProjectFirstPageHome, {
      sidebarOpen: true,
      sessionActive: false,
      sessionName: 'MolBioCraft_Workbench',
      documents: [],
      hasLocalAutosave: false,
      openDropdown: null,
      onToggleDropdown: noop,
      onOpenSampleProject: noop,
      onStartBlankProject: noop,
      onOpenMbcSession: noop,
      onRestoreAutosave: noop,
      onOpenFilePicker: noop,
      onOpenSampleDocumentById: noop,
      onResumeActiveSession: noop,
      onOpenShortcuts: noop,
    })
  );
}

const renderAbout = (): string =>
  renderToStaticMarkup(React.createElement(AboutMolBioCraftModal, { onClose: () => {} }));

/** Every <img> tag whose src is `src`. */
function imgTags(html: string, src: string): string[] {
  return [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes(`src="${src}"`));
}

/** Every UI source that can draw the brand: components, the app shell and the boot splash. */
function liveSources(): Array<[string, string]> {
  const dir = new URL('src/components/', ROOT);
  const files = nodeFs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => `src/components/${f}`);
  return [...files, 'src/App.tsx', 'src/App.css', 'index.html'].map((rel) => [rel, read(rel)]);
}

describe('US-01M7CC7X brand assets', () => {
  it('US-01M7CC7X AC2: MolBioCraftLogo draws the mascot derivative, rounded at the tile radius, with a new alt text', () => {
    expect(BRAND_MASCOT_SRC).toMatch(/^\/brand\/phoenix-mascot[\w-]*\.png$/);
    const named = renderToStaticMarkup(React.createElement(MolBioCraftLogo, { size: 96, decorative: false }));
    expect(named).toContain(`src="${BRAND_MASCOT_SRC}"`);
    expect(named).not.toContain('/logo.svg');
    // The tile in the artwork has a corner radius of ~246/1254 of its side; the mask uses 1/5,
    // rounded up, so it never falls inside the arc and leaves a black corner showing.
    expect(named).toContain('border-radius:20px');
    const alt = /alt="([^"]*)"/.exec(named)?.[1] ?? '';
    expect(alt).toMatch(/^MolBioCraft/);
    expect(alt).toMatch(/phoenix/i);
    expect(alt).toMatch(/computer/i);
    expect(alt).not.toContain(OLD_ALT);

    const small = renderToStaticMarkup(React.createElement(MolBioCraftLogo, { size: 17 }));
    expect(small).toContain('border-radius:4px');
    expect(small).toContain('alt=""');
    expect(small).toContain('aria-hidden="true"');
    // At every size the clip reaches at least the artwork's own arc (no black corner left) and
    // is exactly 1/5 rounded up - not the old engraving's 108/512 (42px at 200, not 40px).
    for (const size of [16, 17, 20, 32, 54, 76, 96, 100, 128, 200]) {
      const markup = renderToStaticMarkup(React.createElement(MolBioCraftLogo, { size }));
      const px = Number(/border-radius:(\d+)px/.exec(markup)?.[1]);
      expect(px, `radius at ${size}px`).toBeGreaterThanOrEqual((size * 246) / 1254);
      expect(px, `radius at ${size}px`).toBe(Math.ceil(size / 5));
    }
    expect(renderToStaticMarkup(React.createElement(MolBioCraftLogo, { size: 200 }))).toContain('border-radius:40px');

    // The mascot derivative is the opaque tile (no alpha), whose outer corners are the
    // artwork's black background - which is exactly what the rounded mask exists to clip.
    const logo = readPng(readBytes(publicPath(BRAND_MASCOT_SRC)));
    expect(logo.colourType).toBe(2);
    const [r, g, b] = logo.pixel(0, 0);
    expect(r + g + b).toBeLessThan(30);
    const [mr, mg, mb] = logo.pixel(logo.width >> 1, 0);
    expect(mb).toBeGreaterThan(mr + 40); // the indigo tile runs to the top edge
    expect(mg).toBeLessThan(mb);
  });

  it('US-01M7CC7X AC2: the index.html favicon is the mascot derivative PNG, its corners cut to the tile', () => {
    const indexHtml = read('index.html');
    const link = /<link rel="icon"[^>]*>/.exec(indexHtml)?.[0] ?? '';
    expect(link).toContain('type="image/png"');
    expect(link).toContain(`href="${BRAND_FAVICON_SRC}"`);
    expect(BRAND_FAVICON_SRC).toMatch(/^\/brand\/phoenix-mascot[\w-]*\.png$/);
    const favicon = readPng(readBytes(publicPath(BRAND_FAVICON_SRC)));
    expect(favicon.colourType).toBe(6);
    expect(favicon.pixel(0, 0)[3]).toBe(0); // transparent outside the rounded tile
    expect(favicon.pixel(favicon.width >> 1, 0)[3]).toBe(255); // the tile reaches the edge
  });

  it('US-01M7CC7X AC2: no live UI source draws the old engraving, and only the mascot is rounded', () => {
    for (const [rel, text] of liveSources()) {
      for (const old of OLD_ENGRAVING_REFS) {
        expect(text.includes(old), `${rel} still references ${old}`).toBe(false);
      }
    }
    // The splash (React and boot) shows the emblem in place of the old engraving.
    const splash = renderToStaticMarkup(
      React.createElement(AppStartupSplash, { initialProgress: 18, onComplete: () => {} })
    );
    expect(imgTags(splash, BRAND_EMBLEM_SRC)).toHaveLength(1);
    expect(read('index.html')).toContain(`src="${BRAND_EMBLEM_SRC}"`);
    // The rounded mask belongs to the opaque mascot tile only: no emblem <img> is clipped.
    for (const html of [renderAbout(), renderHome(), splash]) {
      for (const tag of imgTags(html, BRAND_EMBLEM_SRC)) {
        expect(tag).not.toMatch(/border-radius/);
      }
    }
  });

  it('US-01M7CC7X AC3: the About dialog shows the emblem, contain-fit and unclipped, and keeps its credits', () => {
    const html = renderAbout();
    const tags = imgTags(html, BRAND_EMBLEM_SRC);
    expect(tags).toHaveLength(1);
    // The dialog title and wordmark beside it name the product, so the illustration is decorative.
    expect(tags[0]).toContain('alt=""');
    expect(tags[0]).toContain('object-fit:contain');
    expect(tags[0]).not.toMatch(/border-radius/);
    expect(html).not.toContain('/logo.svg');
    expect(html).not.toContain(OLD_ALT);
    expect(html).toContain('About MolBioCraft');
    for (const credit of ['Thanakrit Wongsatit', 'Krittanai Trisakulwattana', 'Bundit Boonyarit', 'CC BY-NC 4.0']) {
      expect(html).toContain(credit);
    }
    expect(html).toMatch(/<h3 id="mbc-about-credits-heading"[^>]*>Credits<\/h3>/);
  });

  it('US-01M7CC7X AC3: the home hero shows the emblem with alt text describing the new artwork', () => {
    const html = renderHome();
    const tags = imgTags(html, BRAND_EMBLEM_SRC);
    expect(tags).toHaveLength(1);
    const alt = /alt="([^"]*)"/.exec(tags[0])?.[1] ?? '';
    expect(alt).toMatch(/phoenix/i);
    expect(alt).toMatch(/computer/i);
    expect(alt).toMatch(/protein/i);
    expect(alt).not.toContain(OLD_ALT);
    expect(tags[0]).toContain('object-fit:contain');
    expect(tags[0]).not.toMatch(/border-radius/);
    expect(html).not.toContain('/logo.svg');
    for (const rel of [
      'src/components/MolBioCraftLogo.tsx',
      'src/components/MenusPreferencesAndBlastModal.tsx',
      'src/components/ProjectFirstPageHome.tsx',
    ]) {
      expect(read(rel)).not.toContain(OLD_ALT);
    }
  });

  it('US-01M7CC7X AC4: each web derivative is a square PNG of at most 1024 px; the emblem keeps its alpha', () => {
    const masters = { mascot: 'packaging/brand/phoenix-mascot.png', emblem: 'packaging/brand/phoenix-emblem.png' };
    const mascotMaster = readPng(readBytes(masters.mascot));
    const emblemMaster = readPng(readBytes(masters.emblem));
    expect(mascotMaster.width).toBe(mascotMaster.height);
    expect(emblemMaster.colourType).toBe(6);

    const files = nodeFs.readdirSync(new URL('public/brand/', ROOT)).filter((f) => f.endsWith('.png'));
    for (const src of [BRAND_MASCOT_SRC, BRAND_FAVICON_SRC, BRAND_EMBLEM_SRC]) {
      expect(files).toContain(src.replace('/brand/', ''));
    }
    let total = 0;
    for (const f of files) {
      const bytes = readBytes(`public/brand/${f}`);
      total += bytes.length;
      const png = readPng(bytes);
      expect(png.width, `${f} is square`).toBe(png.height);
      expect(png.width, `${f} is at most 1024 px`).toBeLessThanOrEqual(1024);
      expect(png.width).toBeGreaterThanOrEqual(32);
      expect(png.bitDepth).toBe(8);
    }
    expect(total, 'the standalone build inlines these, so they stay small').toBeLessThan(800_000);

    const emblem = readPng(readBytes(publicPath(BRAND_EMBLEM_SRC)));
    expect(emblem.colourType).toBe(6);
    // Kept, not flattened: the cutout's corners stay transparent and its body stays opaque.
    expect(emblem.pixel(0, 0)[3]).toBe(0);
    expect(emblem.pixel(emblem.width - 1, emblem.height - 1)[3]).toBe(0);
    expect(emblem.pixel(emblem.width >> 1, emblem.height >> 1)[3]).toBeGreaterThan(240);
  });

  it('US-01M7CC7X AC4: the derivatives come from the tracked masters by the brand script, contain-fit with LANCZOS', () => {
    const script = read('scripts/generate_brand_web.py');
    expect(script).toContain('SPDX-License-Identifier: CC-BY-NC-4.0');
    expect(script).toContain('packaging/brand');
    expect(script).toContain('Image.Resampling.LANCZOS');
    expect(script).not.toContain('resources/');
    for (const src of [BRAND_MASCOT_SRC, BRAND_FAVICON_SRC, BRAND_EMBLEM_SRC]) {
      expect(script).toContain(src.replace('/brand/', ''));
    }
    const sources = read('packaging/brand/SOURCES.md');
    for (const src of [BRAND_MASCOT_SRC, BRAND_FAVICON_SRC, BRAND_EMBLEM_SRC]) {
      expect(sources).toContain(`public${src}`);
    }
  });

  it('US-01M7CC7X AC4: the standalone build embeds every brand image the UI references', () => {
    const referenced = new Set<string>();
    for (const [, text] of liveSources()) {
      for (const m of text.matchAll(/\/brand\/[\w.-]+\.png/g)) referenced.add(m[0]);
    }
    for (const src of [BRAND_MASCOT_SRC, BRAND_FAVICON_SRC, BRAND_EMBLEM_SRC]) {
      referenced.add(src);
    }
    const bundle = [...referenced].map((src, i) => `const a${i}="${src}";const b${i}='${src}';`).join('\n');
    const inlined: string = inlineBrandImages(bundle, new URL('public/', ROOT).pathname);
    expect(inlined).not.toMatch(/["']\/brand\//);
    for (const src of referenced) {
      const b64 = readBytes(publicPath(src)).toString('base64');
      expect(inlined).toContain(`"data:image/png;base64,${b64}"`);
    }
    // A reference to a brand image that does not exist fails the build by name.
    expect(() => inlineBrandImages('x="/brand/missing.png"', new URL('public/', ROOT).pathname)).toThrow(
      /missing\.png/
    );
    // The bundler runs it over the app script and takes its favicon from the same derivative.
    const builder = read('scripts/build_standalone_html.mjs');
    expect(builder).toMatch(/inlineBrandImages\(\s*jsContent/);
    expect(builder).toContain('BRAND_FAVICON');
    expect(builder).not.toContain("'logo.svg'");
  });
});

// US-01M7CCPD: the desktop and installer icons (src-tauri/icons/, packaging/*.ico|icns|png) are
// regenerated by scripts/generate_icons.py from the Phoenix mascot master, its tile's outer
// corners cut to transparent so no black box shows in the Dock, taskbar or launcher.

const MASCOT_MASTER = 'packaging/brand/phoenix-mascot.png';
/** The tile's corner arc measures ~246 px of the master's 1254 px side (see SOURCES.md). */
const TILE_RADIUS_RATIO = 246 / 1254;

/** The PNG frames an ICO directory lists: [declared width, declared height, payload]. */
function icoFrames(bytes: Buffer): Array<{ width: number; height: number; data: Buffer }> {
  const count = bytes.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + 16 * i;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    expect(offset + size, `ICO entry ${i} lies inside the file`).toBeLessThanOrEqual(bytes.length);
    frames.push({
      width: bytes[entry] || 256,
      height: bytes[entry + 1] || 256,
      data: bytes.subarray(offset, offset + size),
    });
  }
  return frames;
}

/** The (type, payload) records of an ICNS container, which must tile the file exactly. */
function icnsChunks(bytes: Buffer): Map<string, Buffer> {
  expect(bytes.toString('latin1', 0, 4)).toBe('icns');
  expect(bytes.readUInt32BE(4)).toBe(bytes.length);
  const chunks = new Map<string, Buffer>();
  let offset = 8;
  while (offset < bytes.length) {
    const type = bytes.toString('latin1', offset, offset + 4);
    const length = bytes.readUInt32BE(offset + 4);
    expect(length, `ICNS ${type} record length`).toBeGreaterThan(8);
    chunks.set(type, bytes.subarray(offset + 8, offset + length));
    offset += length;
  }
  expect(offset).toBe(bytes.length);
  return chunks;
}

/**
 * The icon is the mascot tile with transparent outer corners: every pixel well inside the
 * rounded tile is opaque (so no engraved dark line was colour-keyed away), every pixel well
 * outside its arc is transparent, and the colours of the opaque area match the mascot master
 * block by block (so it is this artwork, not the old engraving or the emblem).
 */
function expectMascotTile(icon: Png, mascot: Png, label: string): void {
  const side = icon.width;
  expect(icon.height, `${label} is square`).toBe(side);
  expect(icon.colourType, `${label} has an alpha channel`).toBe(6);
  const r = side * TILE_RADIUS_RATIO;
  const margin = Math.max(1.5, side / 64);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const cx = Math.min(Math.max(x + 0.5, r), side - r);
      const cy = Math.min(Math.max(y + 0.5, r), side - r);
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const alpha = icon.pixel(x, y)[3];
      if (dist < r - margin - side / 40) expect(alpha, `${label} (${x},${y}) inside the tile`).toBe(255);
      if (dist > r + margin) expect(alpha, `${label} (${x},${y}) outside the arc`).toBe(0);
    }
  }
  const grid = Math.min(8, side >> 3);
  let compared = 0;
  let totalDiff = 0;
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      // The block's whole-pixel bounds in the icon, and the same area of the master.
      const [x0, x1, y0, y1] = [gx, gx + 1, gy, gy + 1].map((g) => Math.floor((g * side) / grid));
      const mean = (png: Png, opaqueOnly: boolean): number[] | null => {
        const k = png.width / side;
        const sum = [0, 0, 0];
        let n = 0;
        for (let y = Math.round(y0 * k); y < Math.round(y1 * k); y += 1) {
          for (let x = Math.round(x0 * k); x < Math.round(x1 * k); x += 1) {
            const p = png.pixel(x, y);
            if (opaqueOnly && p[3] !== 255) return null;
            sum[0] += p[0];
            sum[1] += p[1];
            sum[2] += p[2];
            n += 1;
          }
        }
        return sum.map((v) => v / n);
      };
      const a = mean(icon, true);
      if (!a) continue; // a corner block the mask cuts into
      const b = mean(mascot, false)!;
      const diff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      expect(diff, `${label} block (${gx},${gy}) matches the mascot`).toBeLessThan(12);
      totalDiff += diff;
      compared += 1;
    }
  }
  expect(compared, `${label} compares most of its area`).toBeGreaterThanOrEqual(grid * grid - 12);
  expect(totalDiff / compared, `${label} mean block difference`).toBeLessThan(4);
}

describe('US-01M7CCPD desktop and installer icons', () => {
  const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json')) as { bundle: { icon: string[] } };
  const declared = tauriConf.bundle.icon;
  const mascot = readPng(readBytes(MASCOT_MASTER));

  it('US-01M7CCPD AC2: every PNG icon tauri.conf.json declares exists at its declared size and is the mascot tile', () => {
    expect(declared).toEqual([
      'icons/32x32.png',
      'icons/128x128.png',
      'icons/128x128@2x.png',
      'icons/icon.icns',
      'icons/icon.ico',
    ]);
    const pngs = declared.filter((p) => p.endsWith('.png'));
    expect(pngs).toHaveLength(3);
    for (const rel of pngs) {
      const m = /(\d+)x(\d+)(@2x)?\.png$/.exec(rel)!;
      const side = Number(m[1]) * (m[3] ? 2 : 1);
      const png = readPng(readBytes(`src-tauri/${rel}`));
      expect([png.width, png.height], rel).toEqual([side, side]);
      expectMascotTile(png, mascot, rel);
    }
    // The undeclared companions keep their file names and pixel sizes.
    const companions: Array<[string, number]> = [
      ['src-tauri/icons/icon.png', 512],
      ['packaging/icon_512.png', 512],
      ['packaging/icon_256.png', 256],
      ['src-tauri/icons/StoreLogo.png', 50],
      ...[30, 44, 71, 89, 107, 142, 150, 284, 310].map(
        (px): [string, number] => [`src-tauri/icons/Square${px}x${px}Logo.png`, px]
      ),
    ];
    for (const [rel, side] of companions) {
      const png = readPng(readBytes(rel));
      expect([png.width, png.height], rel).toEqual([side, side]);
      expectMascotTile(png, mascot, rel);
    }
  });

  it('US-01M7CCPD AC2: icon.ico is a real multi-image ICO container whose frames are the mascot tile', () => {
    const ico = readBytes('src-tauri/icons/icon.ico');
    expect(ico.readUInt16LE(0), 'reserved').toBe(0);
    expect(ico.readUInt16LE(2), 'type 1 = icon').toBe(1);
    const frames = icoFrames(ico);
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect(frames.map((f) => f.width)).toEqual(expect.arrayContaining([16, 24, 32, 48, 64, 128, 256]));
    for (const frame of frames) {
      const png = readPng(frame.data);
      expect([png.width, png.height], `ICO ${frame.width} px frame`).toEqual([frame.width, frame.height]);
      if (frame.width >= 64) expectMascotTile(png, mascot, `icon.ico ${frame.width} px`);
    }
    expect(readBytes('packaging/molbiocraft.ico').equals(ico), 'packaging/molbiocraft.ico is the same icon').toBe(true);
  });

  it("US-01M7CCPD AC2: icon.icns is a real ICNS container ('icns' magic) whose retina frames are the mascot tile", () => {
    const icns = readBytes('src-tauri/icons/icon.icns');
    const chunks = icnsChunks(icns);
    for (const [type, side] of [
      ['ic07', 128],
      ['ic08', 256],
      ['ic09', 512],
      ['ic10', 1024],
    ] as const) {
      const data = chunks.get(type);
      expect(data, `ICNS ${type}`).toBeDefined();
      const png = readPng(data!);
      expect([png.width, png.height], `ICNS ${type}`).toEqual([side, side]);
      if (side >= 512) expectMascotTile(png, mascot, `icon.icns ${type}`);
    }
    expect(readBytes('packaging/AppIcon.icns').equals(icns), 'packaging/AppIcon.icns is the same icon').toBe(true);
  });

  it('US-01M7CCPD AC2: the README and public logo.svg embed the mascot tile, not the old engraving', () => {
    const svg = read('packaging/logo.svg');
    expect(read('public/logo.svg')).toBe(svg);
    const b64 = /href="data:image\/png;base64,([^"]+)"/.exec(svg)?.[1] ?? '';
    expect(b64.length).toBeGreaterThan(1000);
    expectMascotTile(readPng(Buffer.from(b64, 'base64')), mascot, 'logo.svg image');
  });
});
