// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Taking a figure off the screen and handing it to the user as a file.
 *
 * The half of figure export that needs a live document: reading the styles a chart inherits from
 * the stylesheet, painting it onto a canvas, pulling the values out of a rendered table, and
 * handing the result either to the host's native Save panel or to an ordinary browser download.
 *
 * The pure serializers it builds on live in {@link ./figureExport}, which has no DOM in it.
 */

import { postMacosNativeSave, postMacosNativeSaveBinary } from '../platform/macosMenuBridge';
import { sanitizeExportFilename, validateCrossPlatformFilename } from '../platform/osPlatform';
import {
  FIGURE_FORMAT_META,
  INLINED_SVG_PROPERTIES,
  delimitedText,
  figureFileName,
  finalizeSvgMarkup,
  plainTextTable,
  rgbaToPdf,
  resolveCssVariables,
  type FigureDataFormat,
  type FigureExportFormat,
  type FigureTable,
} from './figureExport';

/** How a save ended. `false` means it failed and the caller must not report success. */
export type FigureExportOutcome = 'native' | 'downloaded' | false;

/** The background an exported figure is composited onto, read from the live theme. */
function figureBackground(root: Element | null): string {
  const el = root ?? document.documentElement;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) return bg;
  }
  return '#ffffff';
}

/** Parse an `rgb()` / `rgba()` colour into the channel triple the PDF writer composites onto. */
export function parseRgbTriple(color: string): [number, number, number] {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return [255, 255, 255];
}

/**
 * Copy every presentation property the stylesheet supplies onto the elements themselves.
 *
 * The clone is walked beside the original because only the original is in the document, and only
 * an element in the document has a computed style. Properties are written as an inline `style`,
 * which is what a file opened anywhere else can act on.
 */
function inlineComputedStyles(source: Element, clone: Element): void {
  const computed = getComputedStyle(source);
  const declarations: string[] = [];
  for (const property of INLINED_SVG_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (!value || value === 'normal' || value === 'auto' || value === 'none') {
      // `none` matters for fill and stroke, where it is a real instruction, not a default.
      if (!(value === 'none' && (property === 'fill' || property === 'stroke'))) continue;
    }
    declarations.push(`${property}:${value}`);
  }
  if (declarations.length) {
    const existing = clone.getAttribute('style');
    clone.setAttribute('style', existing ? `${declarations.join(';')};${existing}` : declarations.join(';'));
  }

  const sourceChildren = source.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i += 1) {
    inlineComputedStyles(sourceChildren[i], cloneChildren[i]);
  }
}

/**
 * The figure inside a container, as opposed to the icons around it.
 *
 * An icon is an `<svg>` too, and the toolbar above a chart is full of them, so taking the first
 * one in the container would export a 16-pixel download glyph. The figure is the drawing with the
 * largest rendered area, and anything inside a control is never it.
 */
export const MIN_FIGURE_WIDTH_PX = 64;
export const MIN_FIGURE_HEIGHT_PX = 32;

export function findFigureSvg(host: Element | null | undefined): SVGSVGElement | null {
  if (!host) return null;
  let best: SVGSVGElement | null = null;
  let bestArea = 0;
  for (const candidate of Array.from(host.querySelectorAll('svg'))) {
    if (candidate.closest('button, a, [role="button"], .mbc-figure-export')) continue;
    const rect = candidate.getBoundingClientRect();
    // A figure that is scrolled out of view measures zero; fall back to its own drawn size.
    const viewBox = (candidate.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const width = rect.width || (viewBox.length === 4 ? viewBox[2] : 0);
    const height = rect.height || (viewBox.length === 4 ? viewBox[3] : 0);
    if (width < MIN_FIGURE_WIDTH_PX || height < MIN_FIGURE_HEIGHT_PX) continue;
    const area = width * height;
    if (area > bestArea) {
      bestArea = area;
      best = candidate as SVGSVGElement;
    }
  }
  return best;
}

/**
 * Figures drawn for a file differently than for the screen.
 *
 * A figure is normally exported as it is drawn: its live `<svg>` is cloned. A figure that sizes
 * its text for the scale it is shown at (the cloning studio's gel enlarges its labels when it is
 * drawn small, so they stay legible on screen) would carry the window it was exported from into
 * the file. Such a figure registers the markup of everything inside its root `<svg>`, drawn in the
 * same view at a fixed scale; the root itself, with its view and the presentation it inherits from
 * the page, is still taken from the live figure.
 */
const fileDrawings = new WeakMap<Element, () => string>();

/** Export `svg` with what `drawInside` returns inside its root, or as it is drawn when `null`. */
export function setFigureFileDrawing(svg: Element, drawInside: (() => string) | null): void {
  if (drawInside) fileDrawings.set(svg, drawInside);
  else fileDrawings.delete(svg);
}

/** Put `inner` inside the serialized, empty root `<svg>` that `markup` holds. */
function fillEmptyRoot(markup: string, inner: string): string {
  if (!inner.trim()) throw new Error('The figure has no drawing to export');
  const root = markup.trimEnd();
  if (root.endsWith('/>')) return `${root.slice(0, -2).trimEnd()}>${inner}</svg>`;
  if (root.endsWith('</svg>')) return `${root.slice(0, -'</svg>'.length)}${inner}</svg>`;
  throw new Error('The figure root could not be serialized for its file drawing');
}

export interface SvgCapture {
  markup: string;
  /** Size the figure occupies on screen, in CSS pixels. */
  cssWidth: number;
  cssHeight: number;
  background: string;
}

/**
 * Serialize a rendered `<svg>` into markup that stands on its own, carrying its styles, its theme
 * colours and its background with it.
 */
export function captureSvg(svg: SVGSVGElement, opts: { title?: string } = {}): SvgCapture {
  const rect = svg.getBoundingClientRect();
  const viewBox = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  // The chart's own units are its true proportions. On screen it may be letterboxed or shrunk to
  // fit a narrow card, and writing that box's width and height into the file would bake the
  // distortion in — so a figure with a viewBox is exported at the size it was drawn at.
  const hasViewBox = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0;
  const cssWidth = Math.max(1, Math.round(hasViewBox ? viewBox[2] : rect.width || 600));
  const cssHeight = Math.max(1, Math.round(hasViewBox ? viewBox[3] : rect.height || 400));
  const background = figureBackground(svg.parentElement);

  // A figure drawn for the file keeps only its root from the screen, so that is all that is cloned.
  const drawInside = fileDrawings.get(svg);
  const clone = svg.cloneNode(!drawInside) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  let markup = new XMLSerializer().serializeToString(clone);
  if (drawInside) markup = fillEmptyRoot(markup, drawInside());
  const rootStyle = getComputedStyle(document.documentElement);
  markup = resolveCssVariables(markup, (name) => rootStyle.getPropertyValue(name));

  return {
    markup: finalizeSvgMarkup(markup, {
      width: cssWidth,
      height: cssHeight,
      background,
      title: opts.title,
    }),
    cssWidth,
    cssHeight,
    background,
  };
}

/** Pixels per CSS pixel in an exported raster. Two is the usual retina figure; three is print. */
export const RASTER_SCALE = 3;

interface RasterResult {
  canvas: HTMLCanvasElement;
  pixelWidth: number;
  pixelHeight: number;
}

/** Paint serialized SVG markup onto a canvas at `scale` device pixels per CSS pixel. */
async function rasterize(capture: SvgCapture, scale: number): Promise<RasterResult> {
  const pixelWidth = Math.max(1, Math.round(capture.cssWidth * scale));
  const pixelHeight = Math.max(1, Math.round(capture.cssHeight * scale));
  const url = URL.createObjectURL(new Blob([capture.markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The figure could not be rendered for export'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser did not provide a 2D canvas for export');
    ctx.fillStyle = capture.background;
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    return { canvas, pixelWidth, pixelHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded'))),
      mimeType,
      quality
    );
  });
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** Read the values out of a table as it is rendered, header row included. */
export function captureTable(table: HTMLTableElement, caption?: string): FigureTable {
  const cellText = (cell: Element) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
  const headerRow = table.tHead?.rows[0] ?? table.rows[0];
  const headers = headerRow ? Array.from(headerRow.cells).map(cellText) : [];
  const bodyRows = table.tBodies.length
    ? Array.from(table.tBodies).flatMap((body) => Array.from(body.rows))
    : Array.from(table.rows).slice(1);
  return {
    headers,
    rows: bodyRows.map((row) => Array.from(row.cells).map(cellText)),
    caption,
  };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function saveText(content: string, filename: string, mimeType: string): FigureExportOutcome {
  const validated = validateCrossPlatformFilename(sanitizeExportFilename(filename));
  if (postMacosNativeSave(validated.sanitized, content)) return 'native';
  return browserDownload(new Blob([content], { type: mimeType }), validated.sanitized);
}

function saveBytes(bytes: Uint8Array, filename: string, mimeType: string): FigureExportOutcome {
  const validated = validateCrossPlatformFilename(sanitizeExportFilename(filename));
  if (postMacosNativeSaveBinary(validated.sanitized, bytes)) return 'native';
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return browserDownload(new Blob([copy.buffer], { type: mimeType }), validated.sanitized);
}

function browserDownload(blob: Blob, filename: string): FigureExportOutcome {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export interface FigureExportRequest {
  /** The drawing to save, when the chosen format is an image. */
  svg?: SVGSVGElement | null;
  /** The values to save, when the chosen format is text. */
  table?: FigureTable | null;
  /** A report to save instead of a table, for a `.txt` export. */
  text?: string | null;
  /** Stem of the file name, usually "<document> — <figure>". */
  baseName: string;
  /** Written into the SVG's `<title>` and the PDF's metadata. */
  title?: string;
  /**
   * Serializer for the delimited forms, when the caller has one it would rather use — the
   * workbench tables write theirs through the Rust CSV engine, which is what their round-trip
   * tests cover.
   */
  delimitedWriter?: (headers: string[], rows: string[][], delimiter: ',' | '\t') => string;
}

/**
 * Save one figure in one format. Returns how the save was handled, or `false` with a message the
 * caller can show; nothing here reports success on its own.
 */
export async function exportFigure(
  request: FigureExportRequest,
  format: FigureExportFormat
): Promise<{ outcome: FigureExportOutcome; filename: string; error?: string }> {
  const filename = figureFileName(request.baseName, format);
  const meta = FIGURE_FORMAT_META[format];
  try {
    if (format === 'txt' || format === 'tsv' || format === 'csv') {
      const content = textFor(request, format);
      if (!content) {
        return { outcome: false, filename, error: 'This view has no table or report to export' };
      }
      return { outcome: saveText(content, filename, meta.mimeType), filename };
    }

    const svg = request.svg;
    if (!svg) return { outcome: false, filename, error: 'This view has no figure to export' };
    const capture = captureSvg(svg, { title: request.title });

    if (format === 'svg') {
      return { outcome: saveText(capture.markup, filename, meta.mimeType), filename };
    }

    const raster = await rasterize(capture, RASTER_SCALE);
    if (format === 'pdf') {
      const ctx = raster.canvas.getContext('2d');
      if (!ctx) throw new Error('This browser did not provide a 2D canvas for export');
      const pixels = ctx.getImageData(0, 0, raster.pixelWidth, raster.pixelHeight).data;
      const pdf = await rgbaToPdf(pixels, raster.pixelWidth, raster.pixelHeight, {
        title: request.title ?? request.baseName,
        background: parseRgbTriple(capture.background),
        cssWidth: capture.cssWidth,
        cssHeight: capture.cssHeight,
      });
      return { outcome: saveBytes(pdf, filename, meta.mimeType), filename };
    }

    const blob = await canvasToBlob(
      raster.canvas,
      format === 'jpeg' ? 'image/jpeg' : 'image/png',
      format === 'jpeg' ? 0.95 : undefined
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { outcome: saveBytes(bytes, filename, meta.mimeType), filename };
  } catch (err) {
    return { outcome: false, filename, error: err instanceof Error ? err.message : String(err) };
  }
}

function textFor(request: FigureExportRequest, format: FigureDataFormat): string {
  if (format === 'txt') {
    if (request.text) return request.text.endsWith('\n') ? request.text : `${request.text}\n`;
    return request.table ? plainTextTable(request.table) : '';
  }
  if (!request.table) return '';
  if (request.delimitedWriter) {
    const text = request.delimitedWriter(
      [...request.table.headers],
      request.table.rows.map((row) => [...row]),
      format === 'csv' ? ',' : '\t'
    );
    return text.endsWith('\n') ? text : `${text}\n`;
  }
  return delimitedText(request.table, format);
}

/**
 * Which formats a given view can actually produce. A view with no drawing cannot make a PNG, and
 * one with no values cannot make a spreadsheet, so the menu only offers what is really there.
 */
export function availableFormats(request: {
  hasFigure: boolean;
  hasTable: boolean;
  hasText: boolean;
}): FigureExportFormat[] {
  const out: FigureExportFormat[] = [];
  if (request.hasFigure) out.push('png', 'jpeg', 'svg', 'pdf');
  if (request.hasTable || request.hasText) out.push('txt');
  if (request.hasTable) out.push('tsv', 'csv');
  return out;
}
