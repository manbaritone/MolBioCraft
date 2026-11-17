// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The circular map's rotation (US-01M7DVG4): view state only. It turns where the map draws the
 * molecule, never the molecule - base 1, every coordinate, the history and the undo stack stay as
 * they are, and nothing calls Set Origin. Angles are degrees clockwise from twelve o'clock.
 */

/** The slider's top: the rotation is held in [0, 360), shown to one decimal on the slider. */
export const MAP_ROTATION_SLIDER_MAX = 359.9;

/**
 * An angle in [0, 360): `a % 360`, plus 360 when that is negative. An angle already in range is
 * returned unchanged, -0 becomes +0, and a negative angle too small for 360 to hold it apart (where
 * `m + 360` is exactly 360) is 0.
 */
export function normalize(a: number): number {
  const m = a % 360;
  const r = m < 0 ? m + 360 : m + 0;
  return r === 360 ? 0 : r;
}

/** The angle a biological angle is drawn at under `rotationDeg`: their sum, in [0, 360). */
export function apply(biologicalDeg: number, rotationDeg: number): number {
  return normalize(biologicalDeg + rotationDeg);
}

export type RotationEntry = { ok: true; value: number } | { ok: false; reason: string };

/** A decimal number: digits with an optional fraction and exponent, nothing else (no hex, no Infinity). */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * What the degree field's text sets the rotation to. An empty or whitespace-only field is refused,
 * never read as 0 (`Number('')` is 0); so is any text that is not a finite decimal number.
 */
export function parseRotationEntry(text: string): RotationEntry {
  const t = text.trim();
  if (t === '') return { ok: false, reason: 'Enter an angle in degrees' };
  const n = DECIMAL.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(n)) return { ok: false, reason: `${t} is not an angle in degrees` };
  return { ok: true, value: normalize(n) };
}
