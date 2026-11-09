// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Export › Alignment Image (US-01M6S8C5): an alignment drawn whole, as a figure file.
 *
 * The drawing is made from the document's data, never from the studio's grid, which only draws
 * the rows and columns scrolled into view. Every member and every column is drawn, wrapped in
 * blocks of 60 columns: a position ruler, the consensus row, then each member, named as the grid
 * names it by default ("1. name") with its percent identity to the consensus. Residues take the
 * colours the studio's grid gives them in the scheme it is drawn in - the one its General inspector
 * picked for the document (BG-01M6XPX5), its molecule type's default until then - resolved for the
 * light theme (Canvas White) so the file reads the same wherever it is opened.
 *
 * {@link drawAlignmentImage} is a pure function of the alignment, so the drawing is the same
 * whatever the window size. {@link saveAlignmentImage} hands it to the app's figure export
 * ({@link exportFigure}), which writes the SVG and paints the PNG and the PDF from it.
 */

import type { SequenceDocument, SequenceFeature } from '../types/bio';
import { isTreeDocument } from './documentViews';
import {
  defaultColorScheme,
  residueCellStyle,
  type AlignmentColorScheme,
  type ResidueColorContext,
} from './alignmentViewModel';
import { resolveCssVariables, type FigureImageFormat } from './figureExport';
import { RASTER_SCALE, exportFigure, setFigureFileDrawing, type FigureExportOutcome } from './figureCapture';

/** Columns per block, as the alignment text's interleaved layout wraps them. */
export const ALIGNMENT_IMAGE_BLOCK_COLUMNS = 60;

/**
 * The largest image the export can paint, in device pixels. The PNG and the PDF are painted on one
 * canvas at {@link RASTER_SCALE}x the drawing, and no web view the desktop app runs in paints a
 * larger one: Chromium (WebView2 on Windows) stops at 32,767 pixels on a side, and both Chromium and
 * WebKit (macOS and Linux) at 268,435,456 pixels (16,384 x 16,384) in all. The SVG is the same
 * drawing, so all three formats share the limit: an alignment past it is refused, never cut.
 */
export const ALIGNMENT_IMAGE_MAX_SIDE_PX = 32_767;
export const ALIGNMENT_IMAGE_MAX_AREA_PX = 268_435_456;

// ─── Geometry, in CSS pixels: spacing on DESIGN.md's scale, text at its 11px caption size ───

const CELL_W = 10;
const LINE_H = 14;
const MARGIN = 20;
const NAME_GAP = 10;
const METRIC_GAP = 6;
const BLOCK_GAP = 14;
const FONT_PX = 11;
const BASELINE = 10;
const TICK_H = 6;

// ─── DESIGN.md's type and light-theme colours ───

const FONT_SANS = "'Google Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_MONO = "'Google Sans Code', SFMono-Regular, Menlo, Consolas, monospace";
const CANVAS_WHITE = '#ffffff';
const INK = '#1f1f1f';
const INK_SECONDARY = '#444746';
const INK_MUTED = '#5f6368';
/** The light theme's values of the tokens a residue cell's style reads (App.css :root). */
const DAY_TOKENS: Record<string, string> = { '--mbc-text-main': INK, '--mbc-text-muted': INK_MUTED };

// ─── Which documents are alignments ───

/**
 * An alignment document: two or more stored members, aligned. An unaligned sequence list, a contig
 * assembly and a tree document (which carries the alignment it was built from) are not.
 */
export function isAlignmentImageDocument(doc: SequenceDocument): boolean {
  const meta = doc.alignmentMeta;
  return (meta?.sequences?.length ?? 0) >= 2 && meta?.isAligned !== false &&
    doc.documentKind !== 'contig' && !isTreeDocument(doc);
}

/** A member row as the studio's grid draws it. */
export interface AlignmentImageMember {
  id: string;
  name: string;
  /** Upper case, '.' read as a gap, padded with gaps to the alignment's length. */
  sequence: string;
  strand: 1 | -1;
  features: SequenceFeature[];
}

/** An alignment document's members as the grid draws them, or null for a document that is not one. */
export function alignmentImageRows(doc: SequenceDocument): AlignmentImageMember[] | null {
  if (!isAlignmentImageDocument(doc)) return null;
  const members = doc.alignmentMeta?.sequences ?? [];
  const length = Math.max(...members.map((m) => m.sequence.length), 0);
  return members.map((m) => ({
    id: m.id,
    name: m.name,
    sequence: m.sequence.toUpperCase().replace(/\./g, '-').padEnd(length, '-'),
    strand: m.strand ?? 1,
    features: m.features ?? [],
  }));
}

/** A row's name as the grid gives it with its default display settings: "1. name". */
export const alignmentImageRowLabel = (index: number, name: string) => `${index + 1}. ${name.replace(/[\r\n\t]+/g, ' ')}`;

/**
 * A row's identity to the consensus, as the grid labels the row: the share of the row's residues
 * (gaps left out) that match the consensus in their column, to 0.1%, and 100 for a row of gaps.
 */
export function identityToConsensusPct(aligned: string, consensus: string): number {
  let matches = 0;
  let residues = 0;
  for (let i = 0; i < aligned.length; i++) {
    const ch = aligned[i];
    if (ch === '-') continue;
    residues++;
    if (ch.toUpperCase() === consensus[i]) matches++;
  }
  return residues > 0 ? Math.round((matches / residues) * 1000) / 10 : 100;
}

// ─── The drawing ───

export interface AlignmentImageRow {
  label: string;
  /** The aligned residues, one per column. */
  aligned: string;
  /** The identity shown beside the name, e.g. "97.4%". */
  identity: string;
  strand?: 1 | -1;
}

export interface AlignmentImageSource {
  rows: readonly AlignmentImageRow[];
  consensus: string;
  /** The consensus row's threshold, as the grid names it ("majority", "75%"). */
  consensusLabel: string;
  scheme: AlignmentColorScheme;
  isProtein: boolean;
}

export interface AlignmentImageSize {
  /** The drawing, in CSS pixels. */
  width: number;
  height: number;
  blocks: number;
  /** The PNG and the PDF, in device pixels. */
  pixelWidth: number;
  pixelHeight: number;
}

/** A generous width for `text` at 11px: wide capitals, and a full em for anything outside ASCII. */
function textWidth(text: string, weight: 'regular' | 'bold'): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    em += code > 0x7e ? 1 : /[a-z ]/.test(ch) ? 0.6 : 0.72;
  }
  return Math.ceil(em * FONT_PX * (weight === 'bold' ? 1.06 : 1));
}
const monoWidth = (text: string) => Math.ceil(text.length * FONT_PX * 0.6);
/** The identity column holds "100%" or a threshold name; "majority" is the widest of them. */
const METRIC_W = Math.max(textWidth('majority', 'regular'), monoWidth('100.0%'));

interface Geometry extends AlignmentImageSize {
  metricRight: number;
  cellsX: number;
  blockH: number;
}

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function geometry(labels: readonly string[], columns: number): Geometry {
  const nameW = Math.max(textWidth('Consensus', 'bold'), ...labels.map((l) => textWidth(l, 'bold')));
  const metricRight = MARGIN + nameW + METRIC_GAP + METRIC_W;
  const cellsX = metricRight + NAME_GAP;
  const blocks = Math.max(1, Math.ceil(columns / ALIGNMENT_IMAGE_BLOCK_COLUMNS));
  const blockH = LINE_H * (2 + labels.length);
  // A ruler number at a block's last column runs past it; the right margin keeps the longest whole.
  const rightPad = Math.max(MARGIN, Math.ceil(2 + monoWidth(thousands(columns)) - CELL_W / 2) + METRIC_GAP);
  const width = cellsX + Math.min(columns, ALIGNMENT_IMAGE_BLOCK_COLUMNS) * CELL_W + rightPad;
  const height = MARGIN * 2 + blocks * blockH + (blocks - 1) * BLOCK_GAP;
  return {
    width, height, blocks, metricRight, cellsX, blockH,
    pixelWidth: Math.round(width * RASTER_SCALE), pixelHeight: Math.round(height * RASTER_SCALE),
  };
}

/** The size the drawing of these rows and columns takes. */
export function alignmentImageSize(labels: readonly string[], columns: number): AlignmentImageSize {
  const { width, height, blocks, pixelWidth, pixelHeight } = geometry(labels, columns);
  return { width, height, blocks, pixelWidth, pixelHeight };
}

function refusalFor(name: string, size: AlignmentImageSize, rows: number, columns: number): string | null {
  if (rows === 0 || columns === 0) return `"${name}" has no aligned columns to draw as an alignment image.`;
  const fits = size.pixelWidth <= ALIGNMENT_IMAGE_MAX_SIDE_PX && size.pixelHeight <= ALIGNMENT_IMAGE_MAX_SIDE_PX &&
    size.pixelWidth * size.pixelHeight <= ALIGNMENT_IMAGE_MAX_AREA_PX;
  if (fits) return null;
  return `"${name}" is too large to draw whole as an alignment image: its ${thousands(rows)} sequences of ` +
    `${thousands(columns)} columns need ${thousands(size.pixelWidth)} x ${thousands(size.pixelHeight)} pixels at the ` +
    `export's ${RASTER_SCALE}x scale, and the limit is ${thousands(ALIGNMENT_IMAGE_MAX_SIDE_PX)} pixels on a side and ` +
    `${thousands(ALIGNMENT_IMAGE_MAX_AREA_PX)} pixels in all, the largest image the app can paint. Nothing was ` +
    'exported: export the sequences as FASTA or Clustal instead, or a shorter alignment as an image.';
}

/** Why `rows` cannot be drawn whole, or null when they can. */
export function alignmentImageRefusal(name: string, rows: readonly AlignmentImageMember[]): string | null {
  const columns = rows[0]?.sequence.length ?? 0;
  const size = alignmentImageSize(rows.map((r, i) => alignmentImageRowLabel(i, r.name)), columns);
  return refusalFor(name, size, rows.length, columns);
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

type Rgb = [number, number, number];
const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `a * b + c * d`, the arithmetic a themed residue colour's calc() holds. */
function evaluateSum(expr: string, css: string): number {
  let sum = 0;
  for (const term of expr.split('+')) {
    let product = 1;
    for (const factor of term.split('*')) {
      const n = Number(factor.trim());
      if (!factor.trim() || !Number.isFinite(n)) throw new Error(`The alignment image cannot read the colour "${css}"`);
      product *= n;
    }
    sum += product;
  }
  return sum;
}

/**
 * A cell colour as the light theme shows it on Canvas White, as an opaque colour, or null for no
 * fill. A colour this cannot read fails the export by name rather than drawing a guess.
 */
function lightThemeColour(css: string): Rgb | null {
  const value = resolveCssVariables(css, (name) => DAY_TOKENS[name] ?? '')
    .replace(/calc\(([^()]*)\)/g, (_m, expr: string) => String(evaluateSum(expr, css)))
    .trim()
    .toLowerCase();
  if (value === 'transparent') return null;
  let rgb: Rgb;
  let alpha = 1;
  const short = value.match(/^#([0-9a-f]{3})$/);
  const long = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  const fn = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (short) {
    rgb = [...short[1]].map((c) => parseInt(c + c, 16)) as Rgb;
  } else if (long) {
    rgb = [0, 2, 4].map((i) => parseInt(long[1].slice(i, i + 2), 16)) as Rgb;
    if (long[2]) alpha = parseInt(long[2], 16) / 255;
  } else if (fn) {
    rgb = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
    if (fn[4] !== undefined) alpha = Number(fn[4]);
  } else {
    throw new Error(`The alignment image cannot read the colour "${css}"`);
  }
  if (alpha <= 0) return null;
  return rgb.map((v) => alpha * v + (1 - alpha) * 255) as Rgb;
}

interface CellPaint { fill: string | null; ink: string }
const paintCache = new Map<string, CellPaint>();

/** The fill and letter colour the grid gives a residue, on Canvas White. */
function cellPaint(ch: string, ctx: ResidueColorContext): CellPaint {
  const style = residueCellStyle(ch, ctx, false);
  const key = `${style.background}|${style.color}`;
  const cached = paintCache.get(key);
  if (cached) return cached;
  const fill = lightThemeColour(style.background);
  const ink = lightThemeColour(style.color);
  const paint = { fill: fill ? hex(fill) : null, ink: ink ? hex(ink) : INK };
  paintCache.set(key, paint);
  return paint;
}

export type AlignmentImageDrawResult =
  | { ok: true; size: AlignmentImageSize; /** Everything inside the figure's root `<svg>`. */ inner: string }
  | { ok: false; message: string };

/**
 * Draw the whole alignment: for each block of 60 columns, a ruler (the block's first column and
 * every tenth), the consensus row and every member row. A drawing past the export's limit is
 * refused with a message that names the limit.
 */
export function drawAlignmentImage(name: string, source: AlignmentImageSource): AlignmentImageDrawResult {
  const { rows, consensus } = source;
  const columns = Math.max(consensus.length, ...rows.map((r) => r.aligned.length), 0);
  const g = geometry(rows.map((r) => r.label), columns);
  const refusal = refusalFor(name, g, rows.length, columns);
  if (refusal) return { ok: false, message: refusal };

  const out: string[] = [];
  const text = (x: number, y: number, content: string, attrs: string) =>
    `<text x="${x}" y="${y}"${attrs}>${escapeXml(content)}</text>`;
  const sans = (weight: number) => ` font-family="${FONT_SANS}" font-size="${FONT_PX}" font-weight="${weight}"`;

  const residues = (seq: string, start: number, end: number, top: number, ref: string, strand: 1 | -1) => {
    const cells: string[] = [];
    for (let col = start; col < end; col++) {
      const ch = seq[col] ?? '-';
      const x = g.cellsX + (col - start) * CELL_W;
      const paint = cellPaint(ch, { scheme: source.scheme, isProtein: source.isProtein, refChar: ref[col], strand });
      if (paint.fill) cells.push(`<rect x="${x}" y="${top}" width="${CELL_W}" height="${LINE_H}" fill="${paint.fill}"/>`);
      cells.push(text(x + CELL_W / 2, top + BASELINE, ch, paint.ink === INK ? '' : ` fill="${paint.ink}"`));
    }
    return `<g class="aln-residues" font-family="${FONT_MONO}" font-size="${FONT_PX}" text-anchor="middle" fill="${INK}">${cells.join('')}</g>`;
  };

  for (let b = 0; b < g.blocks; b++) {
    const start = b * ALIGNMENT_IMAGE_BLOCK_COLUMNS;
    const end = Math.min(columns, start + ALIGNMENT_IMAGE_BLOCK_COLUMNS);
    const top = MARGIN + b * (g.blockH + BLOCK_GAP);
    out.push(`<g class="aln-block" data-columns="${start + 1}-${end}">`);

    const ticks: string[] = [];
    const numbers: string[] = [];
    for (let col = start; col < end; col++) {
      const position = col + 1;
      if (col !== start && position % 10 !== 0) continue;
      const x = g.cellsX + (col - start) * CELL_W + CELL_W / 2;
      ticks.push(`<line x1="${x}" y1="${top + LINE_H - TICK_H}" x2="${x}" y2="${top + LINE_H}"/>`);
      numbers.push(text(x + 2, top + BASELINE, thousands(position), ''));
    }
    out.push('<g class="aln-ruler">' +
      `<g stroke="${INK_MUTED}" stroke-width="1">${ticks.join('')}</g>` +
      `<g font-family="${FONT_MONO}" font-size="${FONT_PX}" fill="${INK_SECONDARY}">${numbers.join('')}</g></g>`);

    const consensusTop = top + LINE_H;
    out.push('<g class="aln-consensus">' +
      text(MARGIN, consensusTop + BASELINE, 'Consensus', `${sans(700)} fill="${INK}"`) +
      text(g.metricRight, consensusTop + BASELINE, source.consensusLabel, `${sans(600)} text-anchor="end" fill="${INK_MUTED}"`) +
      residues(consensus, start, end, consensusTop, consensus, 1) + '</g>');

    rows.forEach((row, r) => {
      const rowTop = top + LINE_H * (2 + r);
      out.push('<g class="aln-row">' +
        text(MARGIN, rowTop + BASELINE, row.label, `${sans(600)} fill="${INK}"`) +
        text(g.metricRight, rowTop + BASELINE, row.identity,
          ` font-family="${FONT_MONO}" font-size="${FONT_PX}" font-weight="600" text-anchor="end" fill="${INK_MUTED}"`) +
        residues(row.aligned, start, end, rowTop, consensus, row.strand ?? 1) + '</g>');
    });
    out.push('</g>');
  }
  const { width, height, blocks, pixelWidth, pixelHeight } = g;
  return { ok: true, size: { width, height, blocks, pixelWidth, pixelHeight }, inner: out.join('') };
}

// ─── The scheme the grid is drawn in (BG-01M6XPX5) ───

// Each document's alignment colour scheme: the one source the studio's grid (whose General
// inspector picks it) and this export both read, so an exported image is painted in the scheme on
// screen and not in the molecule type's default. It is kept here, and not in the studio's own
// state, which this export cannot reach; it mirrors the studio's own consensusSettingsByDoc. The
// studio still gives each document its molecule type's default as it opens it.
const colorSchemeByDoc = new Map<string, AlignmentColorScheme>();
const colorSchemeListeners = new Set<() => void>();

/** Watch the per-document schemes; the returned function stops watching. */
export function subscribeAlignmentImageColorScheme(listener: () => void): () => void {
  colorSchemeListeners.add(listener);
  return () => {
    colorSchemeListeners.delete(listener);
  };
}

/** The scheme a document's grid and alignment image are drawn in: its molecule type's until picked. */
export function alignmentImageColorSchemeFor(
  doc: Pick<SequenceDocument, 'id' | 'moleculeType'>
): AlignmentColorScheme {
  return colorSchemeByDoc.get(doc.id) ?? defaultColorScheme(doc.moleculeType === 'Protein');
}

export function setAlignmentImageColorScheme(docId: string, scheme: AlignmentColorScheme): void {
  if (colorSchemeByDoc.get(docId) === scheme) return;
  colorSchemeByDoc.set(docId, scheme);
  colorSchemeListeners.forEach((listener) => listener());
}

/**
 * The drawing of an alignment document: its rows as the grid draws them, the consensus the grid
 * shows (and the name of its threshold), each row's identity to it, and the colour scheme the
 * studio's grid is drawn in.
 */
export function alignmentImageSource(
  doc: SequenceDocument,
  rows: readonly AlignmentImageMember[],
  grid: { consensus: string; consensusLabel: string }
): AlignmentImageSource {
  const isProtein = doc.moleculeType === 'Protein';
  return {
    rows: rows.map((r, i) => ({
      label: alignmentImageRowLabel(i, r.name),
      aligned: r.sequence,
      identity: `${identityToConsensusPct(r.sequence, grid.consensus)}%`,
      strand: r.strand,
    })),
    consensus: grid.consensus,
    consensusLabel: grid.consensusLabel,
    scheme: alignmentImageColorSchemeFor(doc),
    isProtein,
  };
}

// ─── Saving ───

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * Every inherited presentation property the figure export copies onto the file's root, set here so
 * the file carries these values and not the page's, whichever window, theme or text size it is in.
 */
const ROOT_STYLE = [
  `fill:${INK}`, 'fill-opacity:1', 'fill-rule:nonzero', 'stroke:none', 'stroke-width:1px', 'stroke-opacity:1',
  'stroke-linecap:butt', 'stroke-linejoin:miter', 'stroke-dasharray:none', `font-family:${FONT_SANS}`,
  `font-size:${FONT_PX}px`, 'font-style:normal', 'font-weight:400', 'letter-spacing:normal', 'text-anchor:start',
  'dominant-baseline:auto', 'text-transform:none', 'paint-order:normal', 'shape-rendering:auto',
].join(';');

/**
 * Save a drawing through the figure export. The export reads a figure from a live `<svg>`, so the
 * drawing is registered as the file drawing of an empty root on a Canvas White host kept off
 * screen. The root carries a view, so the export sizes the file by the drawing, not by the box the
 * root measures; nothing on screen is copied.
 */
export async function saveAlignmentImage(
  drawing: Extract<AlignmentImageDrawResult, { ok: true }>,
  format: FigureImageFormat,
  opts: { baseName: string; title: string }
): Promise<{ outcome: FigureExportOutcome; filename: string; error?: string }> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('style', `position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;background:${CANVAS_WHITE}`);
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${drawing.size.width} ${drawing.size.height}`);
  svg.setAttribute('style', ROOT_STYLE);
  host.appendChild(svg);
  document.body.appendChild(host);
  setFigureFileDrawing(svg, () => drawing.inner);
  try {
    return await exportFigure({ svg, baseName: opts.baseName, title: opts.title }, format);
  } finally {
    setFigureFileDrawing(svg, null);
    host.remove();
  }
}

/**
 * Export an alignment document as an image: drawn whole from its rows and the grid's consensus,
 * then saved. A drawing past the limit is refused with the message, and nothing is saved.
 */
export async function exportAlignmentImage(
  doc: SequenceDocument,
  rows: readonly AlignmentImageMember[],
  grid: { consensus: string; consensusLabel: string },
  format: FigureImageFormat
): Promise<{ outcome: FigureExportOutcome; filename: string; error?: string }> {
  const drawing = drawAlignmentImage(doc.name, alignmentImageSource(doc, rows, grid));
  if (!drawing.ok) return { outcome: false, filename: '', error: drawing.message };
  return saveAlignmentImage(drawing, format, {
    baseName: `${doc.name} — Alignment Image`,
    title: `${doc.name} — alignment of ${rows.length} sequences, ${thousands(rows[0]?.sequence.length ?? 0)} columns`,
  });
}
