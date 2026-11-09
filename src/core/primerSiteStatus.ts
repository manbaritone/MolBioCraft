// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Specificity label for a saved primer, from the engine's binding-site count
 * (`test_saved_primers_on_sequence`: exact 3′ pentamer, ≤ 1 mismatch in the
 * body, both strands). That search skips anneal regions shorter than 12 nt,
 * compares bases literally (IUPAC codes never match) and does not scan across
 * the origin of a circular template. Origin-spanning sites are counted here
 * with the same rule; primers outside the rule's scope are "not checked".
 */
export type PrimerSiteStatus = 'unique' | 'multiple' | 'none' | 'not-checked';

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
const revComp = (s: string): string =>
  s
    .split('')
    .reverse()
    .map((c) => COMPLEMENT[c] ?? 'N')
    .join('');

/** Letters only, upper case, U→T — as the engine's clean_alpha_sequence. */
const clean = (s: string): string => s.replace(/[^A-Za-z]/g, '').toUpperCase().replace(/U/g, 'T');

/** Engine rule: exact 3′ pentamer and at most `maxMismatches` in the body. */
function bindsAt(target: string, start: number, oligo: string, maxMismatches: number): boolean {
  const l = oligo.length;
  if (target.slice(start + l - 5, start + l) !== oligo.slice(l - 5)) return false;
  let mm = 0;
  for (let k = 0; k < l - 5; k += 1) {
    if (target[start + k] !== oligo[k] && ++mm > maxMismatches) return false;
  }
  return true;
}

/** Binding sites whose window spans the origin of a circular template. */
export function originSpanningSiteCount(anneal: string, template: string, maxMismatches = 1): number {
  const oligo = clean(anneal);
  const seq = clean(template);
  const l = oligo.length;
  if (l < 2 || seq.length < l) return 0;
  // Every length-l window of this string crosses the origin.
  const junction = seq.slice(-(l - 1)) + seq.slice(0, l - 1);
  let hits = 0;
  for (const target of [junction, revComp(junction)]) {
    for (let i = 0; i + l <= target.length; i += 1) {
      if (bindsAt(target, i, oligo, maxMismatches)) hits += 1;
    }
  }
  return hits;
}

export function primerSiteStatus(
  annealSequence: string,
  template: string,
  circular: boolean,
  engineCount: number
): PrimerSiteStatus {
  const anneal = clean(annealSequence);
  if (anneal.length < 12 || /[^ACGT]/.test(anneal)) {
    return engineCount > 1 ? 'multiple' : engineCount === 1 ? 'unique' : 'not-checked';
  }
  const total = engineCount + (circular ? originSpanningSiteCount(anneal, template) : 0);
  if (total === 1) return 'unique';
  if (total > 1) return 'multiple';
  return 'none';
}
