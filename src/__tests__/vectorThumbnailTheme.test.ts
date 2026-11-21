// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M6W099: the Vectors window's backbone thumbnail follows the night theme.
 *
 * The thumbnail is SVG the Rust engine draws (`generate_catalog_circular_svg`), set inline in the
 * Vectors window (VectorLibraryAndDesignStudio.tsx) and downloaded as the Map .svg. Its presentation
 * attributes carry the day colours, so a downloaded file keeps them with no stylesheet; each mark
 * carries an `mbc-vthumb-*` class that App.css restyles under `.mbc-dark-mode` from a theme token.
 * This reads the classes from the engine's own output, the rules and the token values from App.css,
 * and the panel the thumbnail sits on from the component's source, and computes each mark's WCAG
 * contrast against that panel in the night theme.
 */
import { describe, expect, it } from 'vitest';
import { VECTOR_CATALOG } from '../data/vectorCatalog';
import { generateCatalogCircularSvg } from '../core/vectorDesignerEngine';
import { appCssRules, type CssRule } from './cssCascade';

interface NodeFs { readFileSync(p: URL, enc: 'utf8'): string }
const fs = (await import(/* @vite-ignore */ 'node:fs')) as NodeFs;

/** Each class the thumbnail carries, the property the night theme restyles, and the WCAG floor. */
const MARKS: Record<string, { prop: 'fill' | 'stroke'; floor: number }> = {
  'mbc-vthumb-ring': { prop: 'stroke', floor: 3 },
  'mbc-vthumb-label': { prop: 'fill', floor: 4.5 },
  'mbc-vthumb-title': { prop: 'fill', floor: 4.5 },
  'mbc-vthumb-meta': { prop: 'fill', floor: 4.5 },
  'mbc-vthumb-source': { prop: 'fill', floor: 4.5 },
};

const selectors = (r: CssRule) => r.selectorText.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
const atKey = (r: CssRule) => r.at.join(' ');

/**
 * The custom properties the night theme gives: `:root`'s, then `.mbc-dark-mode`'s at the top level,
 * then (for an at-rule context such as a contrast preference) `.mbc-dark-mode`'s inside it, each by
 * source order, as the cascade resolves them on an element inside the workbench.
 */
function nightTokens(rules: CssRule[], context: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const take = (pick: (r: CssRule) => boolean) => {
    for (const r of rules.filter(pick).sort((a, b) => a.order - b.order)) {
      for (const d of r.decls) if (d.name.startsWith('--')) tokens.set(d.name, d.value);
    }
  };
  take((r) => r.at.length === 0 && selectors(r).includes(':root'));
  take((r) => r.at.length === 0 && selectors(r).includes('.mbc-dark-mode'));
  if (context) {
    take((r) => atKey(r) === context && selectors(r).includes(':root'));
    take((r) => atKey(r) === context && selectors(r).includes('.mbc-dark-mode'));
  }
  return tokens;
}

/** `value` with every `var()` resolved from `tokens`; throws on a token no rule defines. */
function resolve(value: string, tokens: Map<string, string>, depth = 0): string {
  if (depth > 20) throw new Error(`a var() cycle at ${value}`);
  const m = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/.exec(value);
  if (!m) return value.trim();
  const v = tokens.get(m[1]) ?? m[2];
  if (v === undefined) throw new Error(`${m[1]} is not defined in the night theme`);
  return resolve(value.replace(m[0], v), tokens, depth + 1);
}

/** The sRGB channels of a `#rgb` or `#rrggbb` colour; throws on anything else. */
function rgb(colour: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour)?.[1];
  if (!hex) throw new Error(`${colour} is not an opaque hex colour`);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
/** WCAG 2 relative luminance. */
const luminance = (c: string): number => {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG 2 contrast ratio. */
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('the backbone thumbnail in the night theme (BG-01M6W099)', () => {
  it('BG-01M6W099 AC3 every backbone thumbnail class takes a theme token fill in the dark theme', () => {
    // Wrong implementations this catches: a class the engine writes that App.css never restyles, a
    // night rule that sets a hard-coded colour rather than a theme token, a rule outside
    // `.mbc-dark-mode` (it would repaint the day thumbnail too), a token too dim to read against
    // the panel, and a thumbnail moved off the panel the contrast is computed against.
    const entry = VECTOR_CATALOG.find((v) => v.partBlueprintIds.length >= 2);
    expect(entry, 'a catalog vector with two or more parts').toBeDefined();
    const svg = generateCatalogCircularSvg(entry!);
    const written = new Set([...svg.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('mbc-vthumb-')));
    expect([...written].sort(), "the classes the engine's thumbnail carries").toEqual(Object.keys(MARKS).sort());

    const studio = fs.readFileSync(new URL('../components/VectorLibraryAndDesignStudio.tsx', import.meta.url), 'utf8');
    const host = /<div\s+style=\{\{([^}]*)\}\}\s+dangerouslySetInnerHTML=\{\{\s*__html:\s*generateCatalogCircularSvg\(/.exec(studio);
    expect(host?.[1], 'the inline thumbnail sits on the panel background').toMatch(/background:\s*'var\(--mbc-bg-panel\)'/);

    const rules = appCssRules();
    const naming = rules.filter((r) => /mbc-vthumb-/.test(r.selectorText));
    const outside = naming.flatMap(selectors).filter((s) => /mbc-vthumb-/.test(s) && !s.startsWith('.mbc-dark-mode '));
    expect(outside, 'thumbnail rules that would apply outside the night theme').toEqual([]);

    const contexts = ['', ...new Set(rules.filter((r) => r.at.length > 0 && selectors(r).includes('.mbc-dark-mode')).map(atKey))];
    const ratios: string[] = [];
    for (const [cls, { prop, floor }] of Object.entries(MARKS)) {
      const decls = naming
        .filter((r) => r.at.length === 0 && selectors(r).includes(`.mbc-dark-mode .${cls}`))
        .sort((a, b) => a.order - b.order)
        .flatMap((r) => r.decls.filter((d) => d.name === prop));
      const value = decls.at(-1)?.value;
      expect(value ?? '(no rule)', `.mbc-dark-mode .${cls} sets ${prop} from a theme token`).toMatch(/^var\(--[\w-]+\)$/);
      for (const context of contexts) {
        const tokens = nightTokens(rules, context);
        const colour = resolve(value!, tokens);
        const panel = resolve('var(--mbc-bg-panel)', tokens);
        const ratio = contrast(colour, panel);
        ratios.push(`${cls} ${prop} ${value} = ${colour} on ${panel}${context ? ` in ${context}` : ''}: ${ratio.toFixed(2)}:1`);
        expect(ratio, `${cls} against the night panel${context ? ` in ${context}` : ''} (${colour} on ${panel})`).toBeGreaterThanOrEqual(floor);
      }
    }
    console.log(ratios.join('\n'));
  });
});
