// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Saving a figure or a table out of the workbench.
 *
 * Everything here is written against the platform the app already runs on — a canvas, a
 * compression stream, a blob — so a figure leaves the workbench as a real PNG, JPEG, SVG or PDF
 * with nothing to download or install first. The PDF is assembled byte by byte in
 * {@link buildPdfDocument}; it holds the rendered figure as a losslessly deflated RGB image, so a
 * chart keeps its crisp text instead of the fringing a JPEG would put around it.
 *
 * The pure half of this module (markup hardening, delimited text, the PDF container) is separated
 * from the half that needs a document so both can be tested without a browser.
 */

/** Formats a figure can be saved as. */
export type FigureImageFormat = 'png' | 'jpeg' | 'svg' | 'pdf';
/** Formats a table or report can be saved as. */
export type FigureDataFormat = 'txt' | 'tsv' | 'csv';
export type FigureExportFormat = FigureImageFormat | FigureDataFormat;

export const FIGURE_IMAGE_FORMATS: readonly FigureImageFormat[] = ['png', 'jpeg', 'svg', 'pdf'];
export const FIGURE_DATA_FORMATS: readonly FigureDataFormat[] = ['txt', 'tsv', 'csv'];

/** Extension and MIME type for each format, as the save panel and the blob need them. */
export const FIGURE_FORMAT_META: Record<
  FigureExportFormat,
  { extension: string; mimeType: string; label: string }
> = {
  png: { extension: 'png', mimeType: 'image/png', label: 'PNG image' },
  jpeg: { extension: 'jpg', mimeType: 'image/jpeg', label: 'JPEG image' },
  svg: { extension: 'svg', mimeType: 'image/svg+xml;charset=utf-8', label: 'SVG vector' },
  pdf: { extension: 'pdf', mimeType: 'application/pdf', label: 'PDF document' },
  txt: { extension: 'txt', mimeType: 'text/plain;charset=utf-8', label: 'Text' },
  tsv: { extension: 'tsv', mimeType: 'text/tab-separated-values;charset=utf-8', label: 'Tab-separated' },
  csv: { extension: 'csv', mimeType: 'text/csv;charset=utf-8', label: 'Comma-separated' },
};

/** True for the formats that come from a drawing rather than from rows of values. */
export function isImageFormat(format: FigureExportFormat): format is FigureImageFormat {
  return (FIGURE_IMAGE_FORMATS as readonly string[]).includes(format);
}

// ---------------------------------------------------------------------------
// SVG markup
// ---------------------------------------------------------------------------

/**
 * The presentation properties an exported figure has to carry with it. In the app these come from
 * stylesheet rules and CSS custom properties; a file opened in Illustrator or a browser has
 * neither, so each one is written onto the element it applies to.
 */
export const INLINED_SVG_PROPERTIES: readonly string[] = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'text-transform',
  'paint-order',
  'mix-blend-mode',
  'shape-rendering',
];

/**
 * Replace every `var(--token)` with the value the token currently resolves to. An exported file is
 * read outside the app, where the custom properties that carry the theme do not exist.
 */
export function resolveCssVariables(markup: string, resolve: (name: string) => string): string {
  // Innermost first, so a var() used as another var()'s fallback is resolved too.
  let out = markup;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = out.replace(
      /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*))?\)/g,
      (_match, name: string, fallback?: string) =>
        resolve(name).trim() || (fallback ?? '').trim() || 'currentColor'
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/** The XML declaration and doctype a standalone `.svg` file is expected to open with. */
export const SVG_FILE_PROLOGUE = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n';

/**
 * Wrap serialized `<svg>` markup into a file that stands on its own: namespaced, sized in real
 * pixels rather than only in user units, and backed by an opaque background so a figure drawn for
 * a white card is not read against a dark viewer.
 *
 * The size is written on the root element alone. A root that carries only a viewBox (many figures
 * do) leaves the first `width` and `height` in the markup to a child, so the root's start tag is
 * read on its own and nothing below it is touched.
 */
export function finalizeSvgMarkup(
  markup: string,
  opts: { width: number; height: number; background?: string; title?: string }
): string {
  const { width, height, background, title } = opts;
  const out = markup.trim();
  const root = readRootSvgStartTag(out);

  let added = ` width="${round(width)}" height="${round(height)}"`;
  if (!/\sxmlns:xlink=/.test(out) && /xlink:/.test(out)) {
    added += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
  }
  if (!/\sxmlns=/.test(out)) {
    added += ' xmlns="http://www.w3.org/2000/svg"';
  }
  // Everything in the start tag after `<svg` except the root's own width and height, each taken
  // with the whitespace before it.
  let kept = '';
  let at = ROOT_SVG_OPEN.length;
  for (const attr of root.attributes) {
    if (attr.name !== 'width' && attr.name !== 'height') continue;
    kept += out.slice(at, attr.start);
    at = attr.end;
  }
  kept += out.slice(at, root.end);
  let startTag = `${ROOT_SVG_OPEN}${added}${kept}`;
  let body = out.slice(root.end);

  const inserts: string[] = [];
  if (title) inserts.push(`<title>${escapeXml(title)}</title>`);
  if (background) {
    inserts.push(`<rect x="0" y="0" width="100%" height="100%" fill="${escapeXml(background)}"/>`);
  }
  if (inserts.length && root.selfClosing) {
    // `<svg/>` has no inside to put a title or background in, so open it and close it after them.
    startTag = `${startTag.slice(0, -2).trimEnd()}>`;
    body = `</svg>${body}`;
  }
  return `${SVG_FILE_PROLOGUE}${startTag}${inserts.join('')}${body}\n`;
}

const ROOT_SVG_OPEN = '<svg';

interface StartTagAttribute {
  name: string;
  /** Offset of the whitespace before the name. */
  start: number;
  /** Offset just past the closing quote of the value. */
  end: number;
}

/**
 * Read the start tag the markup opens with, which must be an `<svg>` element's: the attributes it
 * carries and the offset just past its `>` or `/>`.
 *
 * Only that one tag is read. A quoted value is skipped whole, in either quote, so a `>` inside a
 * label does not end the tag early. Markup that does not open with an `<svg>` start tag, or ends
 * inside it, is refused by name rather than exported unsized.
 */
function readRootSvgStartTag(markup: string): {
  attributes: StartTagAttribute[];
  end: number;
  selfClosing: boolean;
} {
  // XML's whitespace, which is all that may separate the parts of a start tag.
  const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  const next = markup[ROOT_SVG_OPEN.length];
  if (!markup.startsWith(ROOT_SVG_OPEN) || (next !== undefined && !isSpace(next) && next !== '/' && next !== '>')) {
    throw new Error('The figure markup does not open with an <svg> start tag');
  }
  const unterminated = () => new Error('The figure markup ends inside its <svg> start tag');
  const attributes: StartTagAttribute[] = [];
  let i = ROOT_SVG_OPEN.length;
  for (;;) {
    const start = i;
    while (isSpace(markup[i])) i += 1;
    if (i >= markup.length) throw unterminated();
    if (markup[i] === '>') return { attributes, end: i + 1, selfClosing: false };
    if (markup.startsWith('/>', i)) return { attributes, end: i + 2, selfClosing: true };

    const nameStart = i;
    while (i < markup.length && !isSpace(markup[i]) && !'=/>'.includes(markup[i])) i += 1;
    const name = markup.slice(nameStart, i);
    while (isSpace(markup[i])) i += 1;
    if (!name || markup[i] !== '=') {
      if (i >= markup.length) throw unterminated();
      throw new Error(`The figure's <svg> start tag has an attribute with no value at offset ${nameStart}`);
    }
    i += 1;
    while (isSpace(markup[i])) i += 1;
    const quote = markup[i];
    if (quote !== '"' && quote !== "'") {
      if (i >= markup.length) throw unterminated();
      throw new Error(`The figure's <svg> start tag has an unquoted value for "${name}"`);
    }
    const close = markup.indexOf(quote, i + 1);
    if (close < 0) throw unterminated();
    i = close + 1;
    attributes.push({ name, start, end: i });
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const round = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Delimited text
// ---------------------------------------------------------------------------

export interface FigureTable {
  /** Column headings, in display order. */
  headers: readonly string[];
  /** Rows of cells, each already reduced to its text. */
  rows: readonly (readonly string[])[];
  /** Optional lines written above the table in the `.txt` form. */
  caption?: string;
}

const DELIMITERS: Record<FigureDataFormat, string> = { tsv: '\t', csv: ',', txt: '\t' };

/**
 * Serialize a table for a spreadsheet. A tab-separated field cannot contain a tab, so tabs and
 * newlines inside a cell collapse to spaces; a comma-separated field is quoted in the usual way.
 */
export function delimitedText(table: FigureTable, format: FigureDataFormat): string {
  const delimiter = DELIMITERS[format];
  const cell = (raw: string): string => {
    const value = (raw ?? '').replace(/\r\n?|\n/g, ' ').trim();
    if (format === 'csv') {
      return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }
    return value.replace(/\t/g, ' ');
  };
  const lines = [
    table.headers.map(cell).join(delimiter),
    ...table.rows.map((row) => row.map(cell).join(delimiter)),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Serialize a table as something to read rather than to parse: every column padded to its widest
 * cell, under the caption the figure carried.
 */
export function plainTextTable(table: FigureTable): string {
  const grid = [table.headers.map((h) => (h ?? '').trim()), ...table.rows.map((r) => r.map((c) => (c ?? '').replace(/\s+/g, ' ').trim()))];
  const columns = Math.max(0, ...grid.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(0, ...grid.map((row) => (row[c] ?? '').length))
  );
  const render = (row: readonly string[]) =>
    row
      .map((c, i) => (i === row.length - 1 ? (c ?? '') : (c ?? '').padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  const rule = widths.map((w) => '-'.repeat(Math.max(1, w))).join('  ');
  const head = table.caption ? `${table.caption.trim()}\n\n` : '';
  return `${head}${render(grid[0] ?? [])}\n${rule}\n${grid.slice(1).map(render).join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** 96 CSS pixels to the inch, 72 PDF points to the inch. */
export const PX_TO_PT = 72 / 96;

export interface PdfImageSource {
  /** Encoded image bytes, already in the form the filter names. */
  data: Uint8Array;
  /** `FlateDecode` for deflated raw RGB scanlines, `DCTDecode` for a JPEG. */
  filter: 'FlateDecode' | 'DCTDecode';
  /** Pixel dimensions of the image itself. */
  pixelWidth: number;
  pixelHeight: number;
}

export interface PdfDocumentOptions {
  title?: string;
  /** Page size in points. Defaults to the image at 96 dpi. */
  pageWidthPt?: number;
  pageHeightPt?: number;
  /** Fixed timestamp, so a test can assert on the bytes. */
  createdAt?: Date;
}

/**
 * Assemble a one-page PDF holding a single image, drawn to fill the page.
 *
 * The file is built as a list of byte chunks rather than a string because the cross-reference
 * table addresses byte offsets, and the image stream is binary: measuring a JavaScript string
 * would count UTF-16 units and put every offset out by the size of the image.
 */
export function buildPdfDocument(image: PdfImageSource, opts: PdfDocumentOptions = {}): Uint8Array {
  const pageWidth = opts.pageWidthPt ?? image.pixelWidth * PX_TO_PT;
  const pageHeight = opts.pageHeightPt ?? image.pixelHeight * PX_TO_PT;
  const title = opts.title ?? 'MolBioCraft figure';
  const created = opts.createdAt ?? new Date();

  const content = `q\n${fmt(pageWidth)} 0 0 ${fmt(pageHeight)} 0 0 cm\n/Im0 Do\nQ\n`;

  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageWidth)} ${fmt(pageHeight)}] ` +
        `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    ],
    [
      `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} ` +
        `/Length ${image.data.length} >>\nstream\n`,
      image.data,
      '\nendstream',
    ],
    [`<< /Length ${content.length} >>\nstream\n${content}endstream`],
    [
      `<< /Title (${pdfString(title)}) /Producer (MolBioCraft) /Creator (MolBioCraft) ` +
        `/CreationDate (${pdfDate(created)}) >>`,
    ],
  ];

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? latin1(part) : part;
    chunks.push(bytes);
    offset += bytes.length;
  };

  // A binary comment on line two is what tells a transfer agent the file is not text.
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const offsets: number[] = [];
  objects.forEach((parts, index) => {
    offsets.push(offset);
    push(`${index + 1} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
  });

  const xrefOffset = offset;
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  });
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

function pdfString(value: string): string {
  return value.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, ' ');
}

function pdfDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

function latin1(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

/** Drop the alpha channel, compositing each pixel onto `background`, as a PDF image has none. */
export function rgbaToRgb(
  rgba: Uint8Array | Uint8ClampedArray,
  background: readonly [number, number, number] = [255, 255, 255]
): Uint8Array {
  const pixels = Math.floor(rgba.length / 4);
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    const alpha = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c += 1) {
      out[i * 3 + c] = Math.round(rgba[i * 4 + c] * alpha + background[c] * (1 - alpha));
    }
  }
  return out;
}

/** Deflate with the platform's own compression, which is what `FlateDecode` names. */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const Stream = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (typeof Stream !== 'function') {
    throw new Error('This browser cannot compress a PDF image stream (CompressionStream missing)');
  }
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const stream = new Stream('deflate');
  const writer = stream.writable.getWriter();
  void writer.write(copy);
  void writer.close();
  const parts: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value as Uint8Array);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Build a PDF page from raw RGBA pixels, deflated losslessly. */
export async function rgbaToPdf(
  rgba: Uint8Array | Uint8ClampedArray,
  pixelWidth: number,
  pixelHeight: number,
  opts: PdfDocumentOptions & { background?: readonly [number, number, number]; cssWidth?: number; cssHeight?: number } = {}
): Promise<Uint8Array> {
  const rgb = rgbaToRgb(rgba, opts.background);
  const data = await deflate(rgb);
  return buildPdfDocument(
    { data, filter: 'FlateDecode', pixelWidth, pixelHeight },
    {
      ...opts,
      pageWidthPt: opts.pageWidthPt ?? (opts.cssWidth ?? pixelWidth) * PX_TO_PT,
      pageHeightPt: opts.pageHeightPt ?? (opts.cssHeight ?? pixelHeight) * PX_TO_PT,
    }
  );
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/**
 * Name an exported file after the document and the figure it came from, with the extension the
 * chosen format expects. Punctuation a file system would object to becomes an underscore here;
 * the caller still passes the result through the app's own cross-platform validation.
 */
export function figureFileName(baseName: string, format: FigureExportFormat): string {
  const cleaned = baseName
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const stem = cleaned || 'MolBioCraft_Figure';
  return `${stem}.${FIGURE_FORMAT_META[format].extension}`;
}
