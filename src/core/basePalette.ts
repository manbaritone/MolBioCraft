// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The one nucleotide palette for traces, base calls and per-base QC charts (four-dye convention,
 * G drawn amber rather than black so it stays visible on the dark theme). Theme tokens, so every
 * view follows light / dark mode. Alignment residue colouring has its own selectable schemes
 * (alignmentViewModel.ts).
 */
export const BASE_COLOR = {
  A: 'var(--mbc-green)',
  C: 'var(--mbc-blue)',
  G: 'var(--mbc-amber)',
  T: 'var(--mbc-red)',
  N: 'var(--mbc-text-muted)',
} as const;

export const baseColor = (b: string): string => BASE_COLOR[(b.toUpperCase() === 'U' ? 'T' : b.toUpperCase()) as keyof typeof BASE_COLOR] ?? BASE_COLOR.N;

/** Phred quality bands shared by every quality bar: Q ≥ 30 good, Q20–29 fair, below Q20 poor. */
export const qualityColor = (q: number): string =>
  q >= 30
    ? 'color-mix(in srgb, var(--mbc-blue) 38%, transparent)'
    : q >= 20
    ? 'color-mix(in srgb, var(--mbc-amber) 42%, transparent)'
    : 'color-mix(in srgb, var(--mbc-red) 42%, transparent)';
