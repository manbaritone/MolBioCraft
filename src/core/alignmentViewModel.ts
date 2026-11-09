// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Pure view-model helpers for the multiple-sequence-alignment viewer.
 * Everything here operates on the FULL alignment (no column caps) and is
 * independent of React so it can be unit tested.
 */

export type AlignmentColorScheme =
  | 'ACGT - Default'
  | 'ACGT - Base Call Quality'
  | 'ACGT - Classic'
  | 'ACGT - Bright'
  | 'ACGT - Pastel'
  | 'ACGT - Text'
  | 'ACGT - Dark'
  | 'ACGT - # Mapped Locations'
  | 'Zappo'
  | 'Clustal'
  | 'MacClade'
  | 'GC vs AT'
  | 'Purine vs Pyrimidine'
  | 'Hydrophobicity'
  | 'Polarity'
  | 'Isoelectric Point'
  | 'By Translation'
  | 'By Annotation'
  | 'Similarity'
  | 'By Direction';

export interface ColorSchemeOption {
  value: AlignmentColorScheme;
  label: string;
}

const NUCLEOTIDE_SCHEMES: ColorSchemeOption[] = [
  { value: 'ACGT - Default', label: 'ACGT - Default' },
  { value: 'ACGT - Classic', label: 'ACGT - Classic' },
  { value: 'ACGT - Bright', label: 'ACGT - Bright' },
  { value: 'ACGT - Pastel', label: 'ACGT - Pastel' },
  { value: 'ACGT - Text', label: 'ACGT - Text' },
  { value: 'ACGT - Dark', label: 'ACGT - Dark' },
  { value: 'MacClade', label: 'MacClade' },
  { value: 'GC vs AT', label: 'GC vs AT' },
  { value: 'Purine vs Pyrimidine', label: 'Purine vs Pyrimidine' },
  { value: 'By Translation', label: 'By Translation' },
];

const PROTEIN_SCHEMES: ColorSchemeOption[] = [
  { value: 'Zappo', label: 'Zappo (physicochemical)' },
  { value: 'Clustal', label: 'Clustal X' },
  { value: 'Hydrophobicity', label: 'Hydrophobicity (Kyte-Doolittle)' },
  { value: 'Polarity', label: 'Polarity / Charge' },
  { value: 'Isoelectric Point', label: 'Isoelectric Point' },
];

const SHARED_SCHEMES: ColorSchemeOption[] = [
  { value: 'Similarity', label: 'Similarity (vs reference)' },
  { value: 'By Annotation', label: 'By Annotation' },
  { value: 'By Direction', label: 'By Direction (strand)' },
];

/** Colour schemes that are meaningful for the given molecule type. */
export function colorSchemesFor(isProtein: boolean): ColorSchemeOption[] {
  return [...(isProtein ? PROTEIN_SCHEMES : NUCLEOTIDE_SCHEMES), ...SHARED_SCHEMES];
}

/** Proteins open in Zappo, a published scheme (see AA_ZAPPO); nucleotides in ACGT - Default. */
export function defaultColorScheme(isProtein: boolean): AlignmentColorScheme {
  return isProtein ? 'Zappo' : 'ACGT - Default';
}

export function isSchemeValidFor(scheme: AlignmentColorScheme, isProtein: boolean): boolean {
  return colorSchemesFor(isProtein).some((s) => s.value === scheme);
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

const NT_DEFAULT: Record<string, string> = {
  A: '#e5484d', C: '#3e7bfa', G: '#e8b500', T: '#30a46c', U: '#30a46c', N: '#9aa4b2',
};
const NT_CLASSIC: Record<string, string> = {
  A: '#2e9b3f', C: '#2457d6', G: '#2b2b2b', T: '#d42a2a', U: '#d42a2a', N: '#9aa4b2',
};
const NT_MACCLADE: Record<string, string> = {
  A: '#e8341c', C: '#25a13a', G: '#f2c500', T: '#1f5fd1', U: '#1f5fd1', N: '#9aa4b2',
};
/** IUPAC ambiguity codes shown in a neutral purple. */
const NT_AMBIGUOUS = '#a78bfa';

/**
 * Zappo, the physicochemical protein scheme as Jalview publishes it (Jalview documentation,
 * Colour Schemes > Zappo, https://www.jalview.org/help/html/colourSchemes/zappo.html): seven
 * groups, each in its own colour - aliphatic/hydrophobic ILVAM #ffafaf, aromatic FWY #ffc800,
 * positive KRH #6464ff, negative DE #ff0000, hydrophilic STNQ #00ff00, conformationally special
 * PG #ff00ff and cysteine C #ffff00. It is the default protein scheme and the palette of By
 * Translation. Residues outside the 20 standard ones take no group colour.
 */
const AA_ZAPPO: Record<string, string> = {
  I: '#ffafaf', L: '#ffafaf', V: '#ffafaf', A: '#ffafaf', M: '#ffafaf',
  F: '#ffc800', W: '#ffc800', Y: '#ffc800',
  K: '#6464ff', R: '#6464ff', H: '#6464ff',
  D: '#ff0000', E: '#ff0000',
  S: '#00ff00', T: '#00ff00', N: '#00ff00', Q: '#00ff00',
  P: '#ff00ff', G: '#ff00ff',
  C: '#ffff00',
};
const AA_CLUSTAL: Record<string, string> = {
  A: '#80a0f0', I: '#80a0f0', L: '#80a0f0', M: '#80a0f0', F: '#80a0f0', W: '#80a0f0', V: '#80a0f0',
  K: '#f01505', R: '#f01505',
  E: '#c048c0', D: '#c048c0',
  N: '#15c015', Q: '#15c015', S: '#15c015', T: '#15c015',
  C: '#f08080', G: '#f09048', P: '#c0c000',
  H: '#15a4a4', Y: '#15a4a4',
};
const AA_POLARITY: Record<string, string> = {
  G: '#f2c94c', A: '#f2c94c', V: '#f2c94c', L: '#f2c94c', I: '#f2c94c', M: '#f2c94c',
  F: '#f2c94c', W: '#f2c94c', P: '#f2c94c',
  S: '#4caf50', T: '#4caf50', C: '#4caf50', Y: '#4caf50', N: '#4caf50', Q: '#4caf50',
  D: '#e53935', E: '#e53935',
  K: '#1e6fe0', R: '#1e6fe0', H: '#1e6fe0',
};

/** Kyte & Doolittle (1982) hydropathy index. */
export const KYTE_DOOLITTLE: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8,
  W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
};

/** Free amino-acid isoelectric points (Lehninger). */
export const AMINO_ACID_PI: Record<string, number> = {
  G: 5.97, A: 6.0, V: 5.96, L: 5.98, I: 6.02, M: 5.74, F: 5.48, W: 5.89, P: 6.3, S: 5.68,
  T: 5.6, C: 5.07, Y: 5.66, N: 5.41, Q: 5.65, D: 2.77, E: 3.22, K: 9.74, R: 10.76, H: 7.59,
};

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const BLUE: [number, number, number] = [37, 99, 235];
const WHITE: [number, number, number] = [245, 245, 245];
const RED: [number, number, number] = [220, 38, 38];

function divergingColor(t: number): string {
  // t in [0,1]: 0 = blue, 0.5 = white, 1 = red
  return t < 0.5 ? lerpColor(BLUE, WHITE, t * 2) : lerpColor(WHITE, RED, (t - 0.5) * 2);
}

const ANNOTATION_NONE = '#cbd5e1';

export interface ResidueColorContext {
  scheme: AlignmentColorScheme;
  isProtein: boolean;
  /** Character of the reference (consensus or first sequence) at this column. */
  refChar?: string;
  /** Strand of the row (for "By Direction"). */
  strand?: 1 | -1;
  /** Translated amino acid at this column (for "By Translation"). */
  translatedAa?: string;
  /** Annotation colour covering this column (for "By Annotation"). */
  annotationColor?: string;
}

/**
 * Solid colour used for a residue in the given scheme.
 * Returns `null` for gaps (nothing should be drawn).
 */
export function residueSolidColor(ch: string, ctx: ResidueColorContext): string | null {
  const u = ch.toUpperCase();
  if (u === '-' || u === '.' || u === ' ') return null;
  switch (ctx.scheme) {
    case 'GC vs AT':
      if (u === 'G' || u === 'C' || u === 'S') return '#2563eb';
      if (u === 'A' || u === 'T' || u === 'U' || u === 'W') return '#f59e0b';
      return NT_AMBIGUOUS;
    case 'Purine vs Pyrimidine':
      if (u === 'A' || u === 'G' || u === 'R') return '#db2777';
      if (u === 'C' || u === 'T' || u === 'U' || u === 'Y') return '#0891b2';
      return NT_AMBIGUOUS;
    case 'Similarity': {
      const ref = (ctx.refChar ?? '').toUpperCase();
      if (!ref || ref === '-') return '#94a3b8';
      return u === ref ? '#64748b' : '#ef4444';
    }
    case 'By Direction':
      return ctx.strand === -1 ? '#ea580c' : '#0284c7';
    case 'By Annotation':
      return ctx.annotationColor ?? ANNOTATION_NONE;
    case 'By Translation': {
      const aa = (ctx.translatedAa ?? '').toUpperCase();
      if (!aa) return ANNOTATION_NONE;
      if (aa === '*') return '#111827';
      return AA_ZAPPO[aa] ?? '#94a3b8';
    }
    case 'Clustal':
      return AA_CLUSTAL[u] ?? '#cbd5e1';
    case 'Polarity':
      return AA_POLARITY[u] ?? '#cbd5e1';
    case 'Hydrophobicity': {
      const v = KYTE_DOOLITTLE[u];
      if (v === undefined) return '#cbd5e1';
      return divergingColor((v + 4.5) / 9);
    }
    case 'Isoelectric Point': {
      const v = AMINO_ACID_PI[u];
      if (v === undefined) return '#cbd5e1';
      // acidic (low pI) -> red, basic (high pI) -> blue
      return divergingColor(1 - (v - 2.77) / (10.76 - 2.77));
    }
    case 'Zappo':
      return AA_ZAPPO[u] ?? '#cbd5e1';
    case 'MacClade':
      return NT_MACCLADE[u] ?? NT_AMBIGUOUS;
    case 'ACGT - Classic':
      return NT_CLASSIC[u] ?? NT_AMBIGUOUS;
    default:
      if (ctx.isProtein) return AA_ZAPPO[u] ?? '#cbd5e1';
      return NT_DEFAULT[u] ?? NT_AMBIGUOUS;
  }
}

export interface ResidueCellStyle {
  background: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Readable residue letters (WCAG 1.4.3: 4.5:1) in the light and night themes
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];
type Theme = 'day' | 'night';

const rgbOf = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};
const hexOf = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const over = (top: Rgb, alpha: number, under: Rgb): Rgb =>
  [0, 1, 2].map((i) => alpha * top[i] + (1 - alpha) * under[i]) as Rgb;
const luminance = (c: Rgb) => {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** The smallest contrast a residue letter keeps against its cell (WCAG 2.2 AA, normal text). */
export const RESIDUE_TEXT_MIN_CONTRAST = 4.5;
/** What the colour choices below aim for: the floor plus a margin, so that a browser rounding a
 * channel or the alpha never takes a letter under it. */
const TARGET_CONTRAST = RESIDUE_TEXT_MIN_CONTRAST + 0.1;

/** DESIGN.md's Ink, Night Ink and Canvas White: the neutral inks a residue letter may take. */
const INK_DAY: Rgb = [0x1f, 0x1f, 0x1f];
const INK_NIGHT: Rgb = [0xe7, 0xe9, 0xec];
const CANVAS_WHITE: Rgb = [0xff, 0xff, 0xff];

/**
 * What a residue cell sits on in each theme (App.css): the alignment canvas (Canvas White; Night
 * Canvas #1a1d22), and a selected row's wash over it (--mbc-bg-selected-soft: #e8f0fe; at night
 * rgba(122, 168, 245, 0.14)).
 */
const NIGHT_CANVAS: Rgb = [0x1a, 0x1d, 0x22];
const CELL_SURFACES: Record<Theme, Rgb[]> = {
  day: [CANVAS_WHITE, [0xe8, 0xf0, 0xfe]],
  night: [NIGHT_CANVAS, over([122, 168, 245], 0.14, NIGHT_CANVAS)],
};
/** Neutral inks to try, the theme's own first. */
const INKS: Record<Theme, Rgb[]> = { day: [INK_DAY, CANVAS_WHITE], night: [INK_NIGHT, CANVAS_WHITE, INK_DAY] };

/** The weakest contrast of `ink` over `fill` at `alpha` on every surface of the theme. */
const worstContrast = (ink: Rgb, fill: Rgb, alpha: number, theme: Theme) =>
  Math.min(...CELL_SURFACES[theme].map((s) => contrast(ink, over(fill, alpha, s))));

interface ThemedCell { alpha: number; ink: Rgb }

/**
 * A wash of `fill` at `alpha` with a neutral ink: the theme's first ink that reads at 4.5:1 at
 * that alpha; where none does, the nearest alpha (in steps of 0.01) at which one does. The hue
 * is the fill's own throughout, so the residue keeps its colour.
 */
function readableWash(fill: Rgb, alpha: number, theme: Theme): ThemedCell {
  for (let step = 0; step <= 100; step++) {
    for (const a of step === 0 ? [alpha] : [alpha - step / 100, alpha + step / 100]) {
      if (a < 0.1 || a > 1) continue;
      const a2 = Math.round(a * 100) / 100;
      const ink = INKS[theme].find((i) => worstContrast(i, fill, a2, theme) >= TARGET_CONTRAST);
      if (ink) return { alpha: a2, ink };
    }
  }
  return { alpha: 0.1, ink: INKS[theme][0] }; // unreachable: a 10% wash reads with the theme's ink
}

/**
 * A letter in the residue's own hue on `ground` (a solid colour, or the theme's surfaces when
 * null): the hue itself where it reads at 4.5:1, otherwise the nearest step of it toward the
 * theme's ink (deeper by day, lighter by night) that does.
 */
function readableHue(hue: Rgb, theme: Theme, ground: Rgb | null): Rgb {
  const pole = theme === 'day' ? INK_DAY : CANVAS_WHITE;
  const grounds = ground ? [ground] : CELL_SURFACES[theme];
  const reads = (c: Rgb) => Math.min(...grounds.map((g) => contrast(c, g))) >= TARGET_CONTRAST;
  for (let step = 0; step <= 100; step++) {
    const c = over(pole, step / 100, hue).map(Math.round) as Rgb;
    if (reads(c)) return c;
  }
  return pole;
}

/**
 * One CSS colour for both themes: the day value in the light theme and the night value under
 * `.mbc-dark-mode`, which sets --mbc-aln-day to 0 and --mbc-aln-night to 1 (App.css). Outside
 * the workbench (an exported figure, a test) the variables are unset and the day value stands.
 */
function themedColour(day: Rgb, dayAlpha: number, night: Rgb, nightAlpha: number): string {
  const mix = (d: number, n: number) => `calc(var(--mbc-aln-day, 1) * ${d} + var(--mbc-aln-night, 0) * ${n})`;
  return `rgba(${mix(Math.round(day[0]), Math.round(night[0]))}, ${mix(Math.round(day[1]), Math.round(night[1]))}, ${mix(Math.round(day[2]), Math.round(night[2]))}, ${mix(dayAlpha, nightAlpha)})`;
}

const sameRgb = (a: Rgb, b: Rgb) => a.every((v, i) => Math.round(v) === Math.round(b[i]));
const alphaHex = (alpha: number) => Math.round(alpha * 255).toString(16).padStart(2, '0');

/** The text colour for a day and a night ink: Ink / Night Ink is the theme's own text token. */
function themedInk(day: Rgb, night: Rgb): string {
  if (sameRgb(day, INK_DAY) && sameRgb(night, INK_NIGHT)) return 'var(--mbc-text-main, #1f1f1f)';
  if (sameRgb(day, night)) return hexOf(day);
  return themedColour(day, 1, night, 1);
}

/** A residue wash at its scheme's alpha (`#rrggbbaa`), or per theme where one theme needs another. */
function washStyle(solid: string, alpha: number): ResidueCellStyle {
  const fill = rgbOf(solid);
  const day = readableWash(fill, alpha, 'day');
  const night = readableWash(fill, alpha, 'night');
  const background = day.alpha === night.alpha
    ? (day.alpha === 1 ? solid : `${solid}${alphaHex(day.alpha)}`)
    : themedColour(fill, day.alpha, fill, night.alpha);
  return { background, color: themedInk(day.ink, night.ink) };
}

const SLATE_GROUND = '#1f2937';
const residueStyleCache = new Map<string, ResidueCellStyle>();

/** Background + text colour of a residue cell when letters are visible. */
export function residueCellStyle(
  ch: string,
  ctx: ResidueColorContext,
  dimmed: boolean
): ResidueCellStyle {
  const solid = residueSolidColor(ch, ctx);
  if (!solid) return { background: 'transparent', color: 'var(--mbc-text-muted)' };
  if (dimmed) return { background: 'transparent', color: 'var(--mbc-text-muted)' };
  const family = ['ACGT - Text', 'ACGT - Dark', 'ACGT - Bright', 'ACGT - Pastel'].includes(ctx.scheme) ? ctx.scheme : 'wash';
  const key = `${family}|${solid}`;
  const cached = residueStyleCache.get(key);
  if (cached) return cached;
  // A colour that is not `#rgb` / `#rrggbb` (an annotation colour written as a name, say) cannot be
  // washed or measured: the letter keeps the theme's ink on no wash, as such a cell drew before.
  const hex = /^#[0-9a-f]{3}$/i.test(solid) ? `#${[...solid.slice(1)].map((c) => c + c).join('')}` : solid;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return { background: 'transparent', color: 'var(--mbc-text-main, #1f1f1f)' };
  let style: ResidueCellStyle;
  switch (family) {
    case 'ACGT - Text': {
      // The letter carries the hue: a deeper step of it by day, a lighter one by night.
      const hue = rgbOf(hex);
      style = { background: 'transparent', color: themedInk(readableHue(hue, 'day', null), readableHue(hue, 'night', null)) };
      break;
    }
    case 'ACGT - Dark': {
      const ink = readableHue(rgbOf(hex), 'night', rgbOf(SLATE_GROUND));
      style = { background: SLATE_GROUND, color: hexOf(ink) };
      break;
    }
    case 'ACGT - Bright':
      style = washStyle(hex, 1);
      break;
    case 'ACGT - Pastel':
      style = washStyle(hex, 0x2e / 255);
      break;
    default:
      style = washStyle(hex, 0x66 / 255);
  }
  residueStyleCache.set(key, Object.freeze(style));
  return style;
}

// ---------------------------------------------------------------------------
// Column bookkeeping
// ---------------------------------------------------------------------------

/** Fraction of gaps per alignment column. */
export function gapFractionByColumn(seqs: readonly string[], colCount: number): number[] {
  const out = new Array<number>(colCount).fill(0);
  if (seqs.length === 0) return out;
  for (let c = 0; c < colCount; c++) {
    let gaps = 0;
    for (const s of seqs) if ((s[c] ?? '-') === '-') gaps++;
    out[c] = gaps / seqs.length;
  }
  return out;
}

/** Alignment column indices to display (optionally hiding gap-rich sites). */
export function visibleColumns(
  seqs: readonly string[],
  colCount: number,
  hideGapSites: boolean,
  gapThresholdPct: number
): number[] {
  if (!hideGapSites) return Array.from({ length: colCount }, (_, i) => i);
  const frac = gapFractionByColumn(seqs, colCount);
  const thr = gapThresholdPct / 100;
  const cols: number[] = [];
  for (let c = 0; c < colCount; c++) if (frac[c] <= thr) cols.push(c);
  return cols;
}

/**
 * For an aligned row: `posAt[c]` = 1-based ungapped position of the residue at column c,
 * or the position of the last residue before c if c is a gap (0 before the first residue).
 * `colOfPos[p]` = column holding ungapped position p (1-based; index 0 unused).
 */
export function rowCoordinateMaps(aligned: string): { posAt: Int32Array; colOfPos: Int32Array } {
  const posAt = new Int32Array(aligned.length);
  const colOfPos: number[] = [0];
  let p = 0;
  for (let c = 0; c < aligned.length; c++) {
    if (aligned[c] !== '-') {
      p++;
      colOfPos.push(c);
    }
    posAt[c] = p;
  }
  return { posAt, colOfPos: Int32Array.from(colOfPos) };
}

/**
 * Mask quality-trimmed read ends for contig statistics. Trim annotations use
 * 1-based *ungapped read* coordinates (as everywhere else: canvas, annotation
 * table); they are mapped to alignment columns before the residues are
 * replaced by gaps. Masking the raw coordinates as columns hit leading-gap
 * columns instead and left the trimmed low-quality bases in the statistics.
 */
export function maskTrimmedReadRegions(
  aligned: string,
  features: readonly { name?: string; type?: string; start: number; end: number }[]
): string {
  const trims = features.filter(
    (f) => /^trimmed$/i.test(String(f.name ?? '')) || String(f.type ?? '') === 'trimmed'
  );
  if (!trims.length) return aligned;
  const { colOfPos } = rowCoordinateMaps(aligned);
  const maxPos = colOfPos.length - 1;
  if (maxPos < 1) return aligned;
  const chars = aligned.split('');
  for (const t of trims) {
    const lo = Math.max(1, Math.min(t.start, t.end));
    const hi = Math.min(maxPos, Math.max(t.start, t.end));
    for (let p = lo; p <= hi; p++) chars[colOfPos[p]] = '-';
  }
  return chars.join('');
}

/** Index of the first element in sorted `arr` that is >= value. */
export function lowerBound(arr: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Next (direction = 1) or previous (direction = -1) 1-based column after `fromCol`
 * where `row` disagrees with `ref`. Returns null when none exists.
 */
export function findDisagreement(
  row: string,
  ref: string,
  fromCol: number,
  direction: 1 | -1
): number | null {
  const n = Math.max(row.length, ref.length);
  for (let c = fromCol - 1 + direction; c >= 0 && c < n; c += direction) {
    const a = (row[c] ?? '-').toUpperCase();
    const b = (ref[c] ?? '-').toUpperCase();
    if (a === '-' && b === '-') continue;
    if (a !== b) return c + 1;
  }
  return null;
}

/** Number of differing, non-double-gap columns between two aligned rows. */
export function countDifferences(a: string, b: string): number {
  const n = Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] ?? '-').toUpperCase();
    const y = (b[i] ?? '-').toUpperCase();
    if (x === '-' && y === '-') continue;
    if (x !== y) d++;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

const BASES = 'TCAG';
const GENETIC_CODE_TABLES: Record<string, string> = {
  'Standard (1)': 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
  'Vertebrate Mitochondrial': 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG',
  'Yeast Mitochondrial (3)': 'FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
  'Bacterial / Plastid (11)': 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
};

export const GENETIC_CODE_NAMES = Object.keys(GENETIC_CODE_TABLES);

/** Map free-text genetic code labels ("Standard", "Bacterial", "(2)") onto a supported table name. */
export function normaliseGeneticCodeName(name: string): string {
  return normaliseCodeName(name);
}

function normaliseCodeName(name: string): string {
  if (GENETIC_CODE_TABLES[name]) return name;
  const n = name.toLowerCase();
  if (n.includes('vertebrate') || n.includes('(2)')) return 'Vertebrate Mitochondrial';
  if (n.includes('yeast') || n.includes('(3)')) return 'Yeast Mitochondrial (3)';
  if (n.includes('bacter') || n.includes('plastid') || n.includes('(11)')) return 'Bacterial / Plastid (11)';
  return 'Standard (1)';
}

export function translateCodon(codon: string, codeName: string): string {
  const table = GENETIC_CODE_TABLES[normaliseCodeName(codeName)];
  const c = codon.toUpperCase().replace(/U/g, 'T');
  if (c.length !== 3) return 'X';
  let idx = 0;
  for (const ch of c) {
    const b = BASES.indexOf(ch);
    if (b < 0) return 'X';
    idx = idx * 4 + b;
  }
  return table[idx];
}

const THREE_LETTER: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His',
  I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp',
  Y: 'Tyr', V: 'Val', '*': 'Ter', X: 'Xaa',
};

export function threeLetterCode(aa: string): string {
  return THREE_LETTER[aa.toUpperCase()] ?? aa;
}

export interface AlignedTranslation {
  /** Amino acid at the column of each codon's middle base ('' elsewhere). */
  aaAtCol: string[];
  /** Amino-acid ordinal (1-based) at that same column (0 elsewhere). */
  aaIndexAtCol: Int32Array;
  /** Amino acid covering each column (all three codon columns) — used for colouring. */
  aaCoverAtCol: string[];
}

/**
 * Translate an aligned nucleotide row in-place: codons are formed from consecutive
 * non-gap bases starting at `frameOffset` (0..2) within [rangeStart, rangeEnd]
 * (1-based ungapped coordinates, optional).
 */
export function translateAlignedRow(
  aligned: string,
  frameOffset: number,
  codeName: string,
  rangeStart = 1,
  rangeEnd = Number.POSITIVE_INFINITY,
  strand: 1 | -1 = 1,
  segments?: readonly { start: number; end: number }[]
): AlignedTranslation {
  const n = aligned.length;
  const aaAtCol = new Array<string>(n).fill('');
  const aaCoverAtCol = new Array<string>(n).fill('');
  const aaIndexAtCol = new Int32Array(n);
  const cols: number[] = [];
  let pos = 0;
  for (let c = 0; c < n; c++) {
    if (aligned[c] === '-') continue;
    pos++;
    if (pos >= rangeStart && pos <= rangeEnd &&
        (!segments?.length || segments.some((s) => pos >= s.start && pos <= s.end))) cols.push(c);
  }
  if (strand === -1) cols.reverse();
  let k = 0;
  const offset = Number.isFinite(frameOffset) ? Math.max(0, Math.min(2, Math.floor(frameOffset))) : 0;
  for (let i = offset; i + 2 < cols.length; i += 3) {
    const bases = aligned[cols[i]] + aligned[cols[i + 1]] + aligned[cols[i + 2]];
    const codon = strand === -1 ? complementAligned(bases) : bases;
    const aa = translateCodon(codon, codeName);
    k++;
    aaAtCol[cols[i + 1]] = aa;
    aaIndexAtCol[cols[i + 1]] = k;
    for (let j = 0; j < 3; j++) aaCoverAtCol[cols[i + j]] = aa;
  }
  return { aaAtCol, aaIndexAtCol, aaCoverAtCol };
}

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', U: 'A', G: 'C', C: 'G', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D', N: 'N', '-': '-',
};

export function complementAligned(aligned: string): string {
  let out = '';
  for (const ch of aligned) {
    const u = ch.toUpperCase();
    const comp = COMPLEMENT[u] ?? u;
    out += ch === u ? comp : comp.toLowerCase();
  }
  return out;
}

export function reverseComplementAligned(aligned: string): string {
  return complementAligned(aligned).split('').reverse().join('');
}

// ---------------------------------------------------------------------------
// Graph tracks (values per alignment column)
// ---------------------------------------------------------------------------

/** Centred moving average with the given window (>=1). */
export function smooth(values: readonly number[], window: number): number[] {
  const w = Number.isFinite(window) ? Math.max(1, Math.floor(window)) : 1;
  if (w <= 1) return values.slice();
  const left = Math.floor((w - 1) / 2);
  const right = w - 1 - left;
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  return values.map((_, i) => {
    const a = Math.max(0, i - left);
    const b = Math.min(values.length, i + right + 1);
    return (prefix[b] - prefix[a]) / (b - a);
  });
}

export function coverageByColumn(seqs: readonly string[], colCount: number): number[] {
  const out = new Array<number>(colCount).fill(0);
  for (const s of seqs) for (let c = 0; c < colCount; c++) if ((s[c] ?? '-') !== '-') out[c]++;
  return out;
}

/** Fraction of G/C among non-gap bases per column (NaN-free; 0 for all-gap columns). */
export function gcByColumn(seqs: readonly string[], colCount: number): number[] {
  const out = new Array<number>(colCount).fill(0);
  for (let c = 0; c < colCount; c++) {
    let gc = 0;
    let total = 0;
    for (const s of seqs) {
      const ch = (s[c] ?? '-').toUpperCase();
      if (ch === '-') continue;
      total++;
      if (ch === 'G' || ch === 'C' || ch === 'S') gc++;
    }
    out[c] = total > 0 ? gc / total : 0;
  }
  return out;
}

/** AT fraction among non-gap residues; unknown bases and all-gap columns are not AT. */
export function atByColumn(seqs: readonly string[], colCount: number): number[] {
  return Array.from({ length: colCount }, (_, c) => {
    let at = 0;
    let total = 0;
    for (const seq of seqs) {
      const ch = (seq[c] ?? '-').toUpperCase();
      if (ch === '-') continue;
      total++;
      if ('ATUW'.includes(ch)) at++;
    }
    return total ? at / total : 0;
  });
}

function meanPropertyByColumn(
  seqs: readonly string[],
  colCount: number,
  scale: Record<string, number>
): number[] {
  const out = new Array<number>(colCount).fill(0);
  for (let c = 0; c < colCount; c++) {
    let sum = 0;
    let n = 0;
    for (const s of seqs) {
      const v = scale[(s[c] ?? '-').toUpperCase()];
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    out[c] = n > 0 ? sum / n : 0;
  }
  return out;
}

export function hydrophobicityByColumn(seqs: readonly string[], colCount: number): number[] {
  return meanPropertyByColumn(seqs, colCount, KYTE_DOOLITTLE);
}

export function isoelectricByColumn(seqs: readonly string[], colCount: number): number[] {
  return meanPropertyByColumn(seqs, colCount, AMINO_ACID_PI);
}

/**
 * Sequence-logo information per column: most frequent residue and its relative
 * information content (0..1) using Shannon entropy over the observed alphabet.
 */
export function logoByColumn(
  seqs: readonly string[],
  colCount: number,
  isProtein: boolean
): { letter: string; info: number }[] {
  const maxBits = Math.log2(isProtein ? 20 : 4);
  const out: { letter: string; info: number }[] = [];
  for (let c = 0; c < colCount; c++) {
    const counts = new Map<string, number>();
    let n = 0;
    for (const s of seqs) {
      const ch = (s[c] ?? '-').toUpperCase();
      if (ch === '-') continue;
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
      n++;
    }
    if (n === 0) {
      out.push({ letter: '-', info: 0 });
      continue;
    }
    let h = 0;
    let best = '';
    let bestN = 0;
    for (const [ch, k] of counts) {
      const p = k / n;
      h -= p * Math.log2(p);
      if (k > bestN || (k === bestN && ch < best)) {
        best = ch;
        bestN = k;
      }
    }
    out.push({ letter: best, info: Math.max(0, Math.min(1, (maxBits - h) / maxBits)) });
  }
  return out;
}

/** GC fraction at codon positions 1/2/3 of `seq` (consensus), smoothed per frame. */
export function framePlot(seq: string, window: number): [number[], number[], number[]] {
  const frames: [number[], number[], number[]] = [[], [], []];
  const n = seq.length;
  const w = Number.isFinite(window) ? Math.max(3, Math.floor(window)) : 3;
  const left = Math.floor((w - 1) / 2);
  const right = w - 1 - left;
  const positions = rowCoordinateMaps(seq).posAt;
  for (let f = 0; f < 3; f++) {
    const gcPrefix = new Float64Array(n + 1);
    const totalPrefix = new Float64Array(n + 1);
    for (let c = 0; c < n; c++) {
      const ch = seq[c].toUpperCase();
      const inFrame = ch !== '-' && (positions[c] - 1) % 3 === f;
      gcPrefix[c + 1] = gcPrefix[c] + (inFrame && (ch === 'G' || ch === 'C') ? 1 : 0);
      totalPrefix[c + 1] = totalPrefix[c] + (inFrame ? 1 : 0);
    }
    for (let c = 0; c < n; c++) {
      const a = Math.max(0, c - left);
      const b = Math.min(n, c + right + 1);
      const gc = gcPrefix[b] - gcPrefix[a];
      const tot = totalPrefix[b] - totalPrefix[a];
      frames[f].push(tot > 0 ? gc / tot : 0);
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Motifs (Dam / Dcm) in aligned rows
// ---------------------------------------------------------------------------

const IUPAC_SETS: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'TU', U: 'TU', R: 'AG', Y: 'CTU', S: 'GC', W: 'ATU', K: 'GTU',
  M: 'AC', B: 'CGTU', D: 'AGTU', H: 'ACTU', V: 'ACG', N: 'ACGTU',
};

/** Alignment columns covered by occurrences of an IUPAC motif in the ungapped row. */
export function motifColumns(aligned: string, motif: string): Set<number> {
  const cols: number[] = [];
  let ungapped = '';
  for (let c = 0; c < aligned.length; c++) {
    if (aligned[c] !== '-') {
      ungapped += aligned[c].toUpperCase();
      cols.push(c);
    }
  }
  const out = new Set<number>();
  const m = motif.toUpperCase();
  for (let i = 0; i + m.length <= ungapped.length; i++) {
    let ok = true;
    for (let j = 0; j < m.length; j++) {
      const allowed = IUPAC_SETS[m[j]] ?? m[j];
      if (!allowed.includes(ungapped[i + j])) {
        ok = false;
        break;
      }
    }
    if (ok) for (let j = 0; j < m.length; j++) out.add(cols[i + j]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Restriction sites on an aligned (gapped) sequence
// ---------------------------------------------------------------------------

export interface AlignedRestrictionHit {
  enzyme: string;
  site: string;
  /** 0-based alignment column of the first base of the recognition site. */
  col: number;
  /** 1-based ungapped position of the first base of the recognition site. */
  position: number;
  strand: 1 | -1;
}

function iupacReverseComplement(motif: string): string {
  return motif
    .toUpperCase()
    .split('')
    .reverse()
    .map((ch) => COMPLEMENT[ch] ?? ch)
    .join('');
}

function motifMatchesAt(seq: string, i: number, motif: string): boolean {
  for (let j = 0; j < motif.length; j++) {
    const allowed = IUPAC_SETS[motif[j]] ?? motif[j];
    if (!allowed.includes(seq[i + j])) return false;
  }
  return true;
}

/**
 * Find recognition sites in the UNGAPPED sequence (so sites spanning gap columns are
 * still found) and report them in alignment-column coordinates. Both strands are
 * searched for non-palindromic sites.
 */
export function findRestrictionSitesAligned(
  aligned: string,
  enzymes: readonly { name: string; recognitionSeq: string }[]
): AlignedRestrictionHit[] {
  const cols: number[] = [];
  let ungapped = '';
  for (let c = 0; c < aligned.length; c++) {
    if (aligned[c] !== '-') {
      ungapped += aligned[c].toUpperCase();
      cols.push(c);
    }
  }
  const hits: AlignedRestrictionHit[] = [];
  for (const e of enzymes) {
    const fwd = e.recognitionSeq.toUpperCase().replace(/[^ACGTURYSWKMBDHVN]/g, '');
    if (fwd.length < 4) continue;
    const rev = iupacReverseComplement(fwd);
    for (let i = 0; i + fwd.length <= ungapped.length; i++) {
      if (motifMatchesAt(ungapped, i, fwd)) {
        hits.push({ enzyme: e.name, site: fwd, col: cols[i], position: i + 1, strand: 1 });
      } else if (rev !== fwd && motifMatchesAt(ungapped, i, rev)) {
        hits.push({ enzyme: e.name, site: rev, col: cols[i], position: i + 1, strand: -1 });
      }
    }
  }
  return hits.sort((a, b) => a.col - b.col || a.enzyme.localeCompare(b.enzyme));
}

// ---------------------------------------------------------------------------
// ORF finding & annotation transfer on aligned rows
// ---------------------------------------------------------------------------

export interface SimpleOrf {
  /** 1-based ungapped start (lowest coordinate) */
  start: number;
  /** 1-based ungapped end (highest coordinate, includes stop codon) */
  end: number;
  strand: 1 | -1;
  lengthBp: number;
}

/**
 * Open reading frames on both strands of an ungapped DNA sequence.
 * An ORF runs from a start codon to the first in-frame stop codon (inclusive)
 * and must be at least `minLengthBp` long.
 */
export function findOrfsInSequence(
  dna: string,
  minLengthBp: number,
  startCodons: readonly string[],
  codeName: string
): SimpleOrf[] {
  const seq = dna.toUpperCase().replace(/U/g, 'T').replace(/[^ACGTN]/g, 'N');
  const starts = new Set(startCodons.map((c) => c.trim().toUpperCase().replace(/U/g, 'T')).filter((c) => c.length === 3));
  if (starts.size === 0) starts.add('ATG');
  const out: SimpleOrf[] = [];
  const scan = (s: string, strand: 1 | -1) => {
    const n = s.length;
    for (let frame = 0; frame < 3; frame++) {
      let open = -1;
      for (let i = frame; i + 3 <= n; i += 3) {
        const codon = s.slice(i, i + 3);
        if (open < 0) {
          if (starts.has(codon)) open = i;
        } else if (translateCodon(codon, codeName) === '*') {
          const len = i + 3 - open;
          if (len >= minLengthBp) {
            const a = open + 1;
            const b = i + 3;
            out.push(
              strand === 1
                ? { start: a, end: b, strand, lengthBp: len }
                : { start: n - b + 1, end: n - a + 1, strand, lengthBp: len }
            );
          }
          open = -1;
        }
      }
    }
  };
  scan(seq, 1);
  scan(reverseComplementAligned(seq), -1);
  return out.sort((x, y) => x.start - y.start || y.lengthBp - x.lengthBp);
}

export interface TransferableFeature {
  id: string;
  name: string;
  type: string;
  start: number;
  end: number;
  /** 1 forward, -1 reverse, 0 when the source record states no direction. */
  strand: 1 | -1 | 0;
  color: string;
}

/**
 * Transfer features from `sourceIdx` rows onto every other row when the aligned
 * region has at least `minIdentityPct` identity. Returns new features per row index
 * (in each target row's ungapped coordinates). Features already present (same
 * name/type overlapping) are not duplicated.
 */
export function transferAnnotations(
  aligned: readonly string[],
  featuresByRow: readonly TransferableFeature[][],
  sourceIdx: readonly number[],
  minIdentityPct: number
): Map<number, TransferableFeature[]> {
  const maps = aligned.map((a) => rowCoordinateMaps(a));
  const result = new Map<number, TransferableFeature[]>();
  for (const si of sourceIdx) {
    if (!maps[si]) continue;
    const { colOfPos } = maps[si];
    const maxPos = colOfPos.length - 1;
    for (const f of featuresByRow[si] ?? []) {
      if (f.type === 'source' || maxPos < 1) continue;
      const a = colOfPos[Math.min(maxPos, Math.max(1, Math.min(f.start, f.end)))];
      const b = colOfPos[Math.min(maxPos, Math.max(1, Math.max(f.start, f.end)))];
      for (let ti = 0; ti < aligned.length; ti++) {
        if (ti === si) continue;
        const tgt = aligned[ti];
        const src = aligned[si];
        let same = 0;
        let cols = 0;
        for (let c = a; c <= b; c++) {
          const x = (src[c] ?? '-').toUpperCase();
          const y = (tgt[c] ?? '-').toUpperCase();
          if (x === '-' && y === '-') continue;
          cols++;
          if (x === y) same++;
        }
        if (cols === 0 || (same / cols) * 100 < minIdentityPct) continue;
        const { posAt } = maps[ti];
        // first target residue at/after column a, last at/before column b
        let first = -1;
        for (let c = a; c <= b && c < tgt.length; c++) if (tgt[c] !== '-') { first = posAt[c]; break; }
        const last = posAt[Math.min(b, tgt.length - 1)] ?? 0;
        if (first < 1 || last < first) continue;
        const existing = [...(featuresByRow[ti] ?? []), ...(result.get(ti) ?? [])];
        const dup = existing.some(
          (e) => e.name === f.name && e.type === f.type && e.start <= last && e.end >= first
        );
        if (dup) continue;
        const list = result.get(ti) ?? [];
        list.push({ ...f, id: `${f.id}-xfer-${ti}`, start: first, end: last });
        result.set(ti, list);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Alignment-wide statistics
// ---------------------------------------------------------------------------

/** The most sequence pairs {@link meanPairwiseIdentity} compares before it samples them. */
const PAIRWISE_IDENTITY_MAX_PAIRS = 4000;

/** Which of an alignment's sequence pairs {@link meanPairwiseIdentity} compares. */
export interface PairwiseIdentitySampling {
  /** Every pair of the alignment's sequences: n(n-1)/2. */
  totalPairs: number;
  /** The pairs compared: each `stride`-th pair, in row order, from the first. */
  comparedPairs: number;
  stride: number;
}

/**
 * The pairs {@link meanPairwiseIdentity} reads for `seqCount` sequences (BG-01M6S1AA): every pair
 * up to 4,000 pairs (89 sequences), and past that each k-th pair in row order, k the smallest
 * stride that keeps the count at 4,000 or fewer. When `comparedPairs` is less than `totalPairs`,
 * the identity is an estimate, and the studio labels it approximate.
 */
export function pairwiseIdentitySampling(seqCount: number): PairwiseIdentitySampling {
  const totalPairs = seqCount >= 2 ? (seqCount * (seqCount - 1)) / 2 : 0;
  const stride = Math.max(1, Math.ceil(totalPairs / PAIRWISE_IDENTITY_MAX_PAIRS));
  return { totalPairs, comparedPairs: Math.ceil(totalPairs / stride), stride };
}

/**
 * Pairwise identity (%): over all sequence pairs, identical residue pairs
 * divided by compared columns, pooled across pairs. Only the region where both sequences are
 * present is compared (end gaps are ignored); gap-vs-gap columns are skipped and gap-vs-residue
 * columns count as differences. Past 4,000 pairs it compares the pairs
 * {@link pairwiseIdentitySampling} names, so the result is approximate.
 * Returns NaN when no pair shares a comparable column (nothing overlaps), so callers can show
 * "N/A" instead of a fabricated 100%.
 */
export function meanPairwiseIdentity(seqs: readonly string[]): number {
  const n = seqs.length;
  if (n < 2) return 100;
  const upper = seqs.map((s) => s.toUpperCase());
  const spans = upper.map((seq) => {
    let first = 0;
    while (first < seq.length && seq[first] === '-') first++;
    let last = seq.length - 1;
    while (last >= first && seq[last] === '-') last--;
    return [first, last] as const;
  });
  const { stride } = pairwiseIdentitySampling(n);
  let same = 0;
  let compared = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++, k++) {
      if (k % stride !== 0) continue;
      const a = upper[i];
      const b = upper[j];
      const lo = Math.max(spans[i][0], spans[j][0]);
      const hi = Math.min(spans[i][1], spans[j][1]);
      for (let c = lo; c <= hi; c++) {
        const x = a[c] ?? '-';
        const y = b[c] ?? '-';
        if (x === '-' && y === '-') continue;
        compared++;
        if (x === y) same++;
      }
    }
  }
  return compared ? Math.round((same / compared) * 1000) / 10 : Number.NaN;
}

/**
 * Average residue masses (Da) of the 2'-deoxyribonucleoside-5'-monophosphates once incorporated
 * into a chain (the nucleotide minus one water). A strand's weight is reported as the plain sum
 * of its residue masses, with no terminal water added.
 */
const DNMP_RESIDUE_DA: Record<'A' | 'C' | 'G' | 'T', number> = {
  A: 313.21,
  C: 289.18,
  G: 329.21,
  T: 304.2,
};

/** The unambiguous bases each IUPAC nucleotide code stands for (U is read as T for mass). */
export const IUPAC_NUCLEOTIDE_MEMBERS: Record<string, string> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  U: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'CG',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
};

/**
 * Mean single- and double-stranded molecular weight (kDa) of the sequences in an alignment,
 * weighted by their actual base composition rather than a flat average mass per base — the flat
 * form is wrong by ~0.3% for a sequence as AT-rich as vertebrate mitochondrial COXII. Gaps are
 * ignored, and IUPAC ambiguity codes contribute the mean mass of the bases they stand for.
 * For the 50-sequence COXII CDS alignment it gives 210.326 / 423.824 kDa. Biopython 1.88's
 * `molecular_weight` (average masses) refuses the alignment's one W and one K ("not a valid
 * unambiguous letter for DNA"), so for its figure each was averaged over its bases before the
 * call, as the mean of `molecular_weight` over the row's unambiguous readings. It then gives
 * 210.342 / 423.855 kDa on the same rows: it adds one water (18.0153 Da) per strand, and without
 * that water it gives 210.324 / 423.819 kDa; the remaining 2.07 / 4.78 Da difference is the
 * rounding of the two-decimal residue masses in `DNMP_RESIDUE_DA` above, which closes to 0.000000
 * Da when those masses are replaced by Biopython's exact ones (`IUPACData.unambiguous_dna_weights`
 * minus 18.0153 Da).
 */
export function meanNucleotideMolecularWeightKda(seqs: readonly string[]): {
  ssKda: number;
  dsKda: number;
} {
  if (seqs.length === 0) return { ssKda: 0, dsKda: 0 };
  const counts = { A: 0, C: 0, G: 0, T: 0 };
  for (const seq of seqs) {
    for (const raw of seq) {
      const members = IUPAC_NUCLEOTIDE_MEMBERS[raw.toUpperCase()];
      if (!members) continue;
      const share = 1 / members.length;
      for (const m of members) counts[m as 'A' | 'C' | 'G' | 'T'] += share;
    }
  }
  const n = seqs.length;
  const strand = (a: number, c: number, g: number, t: number) =>
    (a * DNMP_RESIDUE_DA.A +
      c * DNMP_RESIDUE_DA.C +
      g * DNMP_RESIDUE_DA.G +
      t * DNMP_RESIDUE_DA.T) /
    n;
  const ss = strand(counts.A, counts.C, counts.G, counts.T);
  // The complementary strand swaps A<->T and C<->G.
  const complement = strand(counts.T, counts.G, counts.C, counts.A);
  return { ssKda: ss / 1000, dsKda: (ss + complement) / 1000 };
}

/** Average residue masses (Da, monoisotopic-averaged, as residues in a chain). */
const AA_RESIDUE_MASS: Record<string, number> = {
  A: 71.0788, R: 156.1875, N: 114.1038, D: 115.0886, C: 103.1388, E: 129.1155, Q: 128.1307,
  G: 57.0519, H: 137.1411, I: 113.1594, L: 113.1594, K: 128.1741, M: 131.1926, F: 147.1766,
  P: 97.1167, S: 87.0782, T: 101.1051, W: 186.2132, Y: 163.1760, V: 99.1326,
};

/** EMBOSS pKa set. */
const PKA = { nTerm: 8.6, cTerm: 3.6, C: 8.5, D: 3.9, E: 4.1, H: 6.5, K: 10.8, R: 12.5, Y: 10.1 };

export function proteinNetCharge(seq: string, pH: number): number {
  const u = seq.toUpperCase();
  const pos = (pka: number) => 1 / (1 + 10 ** (pH - pka));
  const neg = (pka: number) => -1 / (1 + 10 ** (pka - pH));
  return (
    pos(PKA.nTerm) +
    neg(PKA.cTerm) +
    countIn(u, 'K') * pos(PKA.K) +
    countIn(u, 'R') * pos(PKA.R) +
    countIn(u, 'H') * pos(PKA.H) +
    countIn(u, 'D') * neg(PKA.D) +
    countIn(u, 'E') * neg(PKA.E) +
    countIn(u, 'C') * neg(PKA.C) +
    countIn(u, 'Y') * neg(PKA.Y)
  );
}

function countIn(seq: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < seq.length; i++) if (seq[i] === ch) n++;
  return n;
}

export function proteinIsoelectricPoint(seq: string): number {
  let lo = 0;
  let hi = 14;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (proteinNetCharge(seq, mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function proteinMolecularWeight(seq: string): number {
  let m = 18.01528; // water
  for (const ch of seq.toUpperCase()) m += AA_RESIDUE_MASS[ch] ?? 110;
  return m;
}

/** Extinction coefficient at 280 nm (M^-1 cm^-1, all Cys as cystines; Pace et al. 1995). */
export function proteinExtinctionCoefficient(seq: string): number {
  const u = seq.toUpperCase();
  return countIn(u, 'W') * 5500 + countIn(u, 'Y') * 1490 + Math.floor(countIn(u, 'C') / 2) * 125;
}

export interface ProteinSummary {
  mwKda: number;
  pI: number;
  chargePh7: number;
  extinction: number;
  a280: number; // absorbance of 1 mg/mL
}

/** Mean protein properties across the (ungapped) sequences. */
export function summariseProteins(seqs: readonly string[]): ProteinSummary {
  const clean = seqs.map((s) => s.replace(/[-*]/g, '')).filter((s) => s.length > 0);
  if (!clean.length) return { mwKda: 0, pI: 0, chargePh7: 0, extinction: 0, a280: 0 };
  let mw = 0;
  let pI = 0;
  let ch = 0;
  let ext = 0;
  let a280 = 0;
  for (const s of clean) {
    const m = proteinMolecularWeight(s);
    const e = proteinExtinctionCoefficient(s);
    mw += m;
    pI += proteinIsoelectricPoint(s);
    ch += proteinNetCharge(s, 7);
    ext += e;
    a280 += m > 0 ? e / m : 0;
  }
  const n = clean.length;
  return { mwKda: mw / n / 1000, pI: pI / n, chargePh7: ch / n, extinction: ext / n, a280: a280 / n };
}

// ---------------------------------------------------------------------------
// Dotplot (exact word matches, merged into diagonal segments)
// ---------------------------------------------------------------------------

export interface DotplotSegment {
  /** 0-based start in X */
  x: number;
  /** 0-based start in Y (for reverse strand: Y coordinate of the first matched base on the forward strand) */
  y: number;
  /** length in residues (>= word size) */
  len: number;
  strand: 1 | -1;
}

export interface DotplotResult {
  segments: DotplotSegment[];
  truncated: boolean;
}

/**
 * Exact word-match dotplot (EMBOSS dottup-like). Consecutive word hits on the
 * same diagonal are merged into segments. Reverse-complement matches are only
 * computed for nucleotide sequences.
 */
export function computeDotplot(
  seqX: string,
  seqY: string,
  wordSize: number,
  includeReverse: boolean,
  isProtein: boolean,
  maxSegments = 60000
): DotplotResult {
  const X = seqX.toUpperCase().replace(/[^A-Z*]/g, '');
  const Y = seqY.toUpperCase().replace(/[^A-Z*]/g, '');
  const k = Math.max(1, Math.floor(wordSize));
  const segments: DotplotSegment[] = [];
  let truncated = false;
  if (X.length < k || Y.length < k) return { segments, truncated };

  const index = new Map<string, number[]>();
  for (let j = 0; j + k <= Y.length; j++) {
    const w = Y.slice(j, j + k);
    if (!isProtein && /[^ACGTU]/.test(w)) continue;
    const list = index.get(w);
    if (list) list.push(j);
    else index.set(w, [j]);
  }

  const scan = (query: string, strand: 1 | -1) => {
    // open[diag] = segment currently being extended on that diagonal
    const open = new Map<number, DotplotSegment>();
    for (let i = 0; i + k <= query.length && !truncated; i++) {
      const hits = index.get(query.slice(i, i + k));
      if (!hits) continue;
      for (const j of hits) {
        const diag = j - i;
        const seg = open.get(diag);
        if (seg && seg.x + seg.len - k + 1 === i) {
          seg.len++;
        } else {
          if (segments.length >= maxSegments) {
            truncated = true;
            break;
          }
          const s: DotplotSegment = { x: i, y: j, len: k, strand };
          segments.push(s);
          open.set(diag, s);
        }
      }
    }
  };
  scan(X, 1);
  if (includeReverse && !isProtein) {
    const rc = reverseComplementAligned(X);
    const before = segments.length;
    scan(rc, -1);
    // convert reverse segments back to forward X coordinates
    for (let s = before; s < segments.length; s++) {
      const seg = segments[s];
      seg.x = X.length - (seg.x + seg.len);
    }
  }
  return { segments, truncated };
}

// ---------------------------------------------------------------------------
// Annotation lane packing
// ---------------------------------------------------------------------------

export interface LaneItem {
  startCol: number;
  endCol: number;
}

/**
 * Assign lanes to intervals. `compress` packs non-overlapping intervals into the
 * same lane; otherwise each interval gets its own lane.
 */
export function packLanes<T extends LaneItem>(items: readonly T[], compress: boolean): (T & { lane: number })[] {
  const sorted = [...items].sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol);
  if (!compress) return sorted.map((it, i) => ({ ...it, lane: i }));
  const laneEnds: number[] = [];
  return sorted.map((it) => {
    let lane = laneEnds.findIndex((end) => end < it.startCol);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(it.endCol);
    } else {
      laneEnds[lane] = it.endCol;
    }
    return { ...it, lane };
  });
}

/** Choose a "nice" ruler step so ticks are at least `minPx` apart. */
export function rulerStep(colWidth: number, minPx = 64): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  for (const s of steps) if (s * colWidth >= minPx) return s;
  return 20000;
}

/**
 * Display text for a pairwise identity value; NaN (no overlapping pairs) reads as N/A. Given the
 * sampling it was computed with, a value read from fewer pairs than the alignment has is labelled
 * approximate, with the pairs it read: "87.3% (approx., 3,980 of 19,900 pairs sampled)".
 */
export function formatPairwiseIdentityPct(
  pct: number,
  sampling?: Pick<PairwiseIdentitySampling, 'comparedPairs' | 'totalPairs'>
): string {
  if (!Number.isFinite(pct)) return 'N/A (no overlapping pairs)';
  if (!sampling || sampling.comparedPairs >= sampling.totalPairs) return `${pct}%`;
  const n = (v: number) => v.toLocaleString('en-US');
  return `${pct}% (approx., ${n(sampling.comparedPairs)} of ${n(sampling.totalPairs)} pairs sampled)`;
}

/**
 * Root-age calibration (Mya) typed by the user. Only finite, strictly positive ages are accepted;
 * anything else (empty, 0, negative, non-numeric) returns null and must not be applied.
 */
export function parseRootCalibrationMya(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const v = Number(trimmed);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * A document in the 'Contig Assembly' folder without embedded members is shown as a single read
 * only when it is the sole input. With several selected documents, the alignment viewer must show
 * the multiple alignment of all of them.
 */
export function contigFolderShowsSingleRead(
  isContigFolderDoc: boolean,
  inputDocIds: readonly string[]
): boolean {
  return isContigFolderDoc && new Set(inputDocIds).size < 2;
}

export type MsaMenuCommandAction = 'run-on-list' | 'stored-alignment' | 'none';

export interface MsaMenuCommandToken {
  nonce: number;
  docId: string;
}

/**
 * Decide what an Alignment menu MSA preset command (MAFFT / Clustal Omega / MUSCLE …, delivered as
 * initial algorithm + command nonce) does for the active document:
 * - unaligned embedded list → run the MSA on the list ('run-on-list');
 * - stored (already aligned) embedded alignment → the stored alignment is kept and not re-run
 *   ('stored-alignment'), which the UI must say;
 * - selected documents (no embedded members) → already aligned with the chosen preset ('none').
 * A nonce is consumed by the document it was issued for; a later remount on another document with
 * the same nonce does not re-trigger it.
 */
export function resolveMsaMenuCommand(input: {
  commandNonce: number;
  subMode: string;
  docId: string;
  hasEmbeddedMembers: boolean;
  isAligned: boolean | undefined;
  consumed: MsaMenuCommandToken | null;
}): { action: MsaMenuCommandAction; consumed: MsaMenuCommandToken | null } {
  const { commandNonce, subMode, docId, hasEmbeddedMembers, isAligned, consumed } = input;
  if (commandNonce <= 0 || subMode !== 'msa') return { action: 'none', consumed };
  if (consumed && consumed.nonce === commandNonce && consumed.docId !== docId) {
    return { action: 'none', consumed };
  }
  const token = { nonce: commandNonce, docId };
  if (!hasEmbeddedMembers) return { action: 'none', consumed: token };
  return { action: isAligned === false ? 'run-on-list' : 'stored-alignment', consumed: token };
}

/**
 * Text View export format for the current rows. An unaligned sequence list has no alignment, so
 * alignment layouts (Custom / Clustal / PHYLIP / NEXUS) are unavailable and fall back to FASTA of
 * the original (ungapped) sequences.
 */
export function effectiveTextViewFormat<F extends string>(format: F, isUnalignedList: boolean): F | 'FASTA' {
  if (!isUnalignedList) return format;
  return format === 'FASTA' || format === 'GenBank' ? format : 'FASTA';
}

/**
 * Nucleotide vs protein classification of aligned rows — the same rule as the
 * engine's `is_nucleotide_alignment` (molbiocraft-phylo trees.rs), so the UI
 * and the engine agree on which analyses apply: unambiguous bases (ACGTUN)
 * ≥ 60 % of residues, and with IUPAC ambiguity codes ≥ 90 %.
 */
export function isNucleotideAlignmentRows(rows: readonly string[]): boolean {
  let core = 0;
  let ambiguous = 0;
  let total = 0;
  for (const row of rows) {
    for (const ch of row.toUpperCase()) {
      if (ch === '-' || ch === '?' || ch === '.') continue;
      total += 1;
      if ('ACGTUN'.includes(ch)) core += 1;
      else if ('RYSWKMBDHV'.includes(ch)) ambiguous += 1;
    }
  }
  return total > 0 && core * 10 >= total * 6 && (core + ambiguous) * 10 >= total * 9;
}
