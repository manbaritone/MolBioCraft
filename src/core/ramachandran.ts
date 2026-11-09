// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * A Ramachandran plot of one protein chain, and the residues that fall outside the allowed
 * regions (US-01M6PBP8, after RCSB's "Structure Quality").
 *
 * The torsions and each residue's region come from the Rust engine (`backbone_torsions`,
 * molbiocraft-protein `backbone`); this module only selects what is plotted and listed, and how
 * a residue is named. The regions are 10-degree cells resampled from the Top8000 contours at
 * MolProbity's cutoffs: a coarse approximation of the categories MolProbity reports, not
 * MolProbity's classifier, so an outlier here is a residue to check, not a verdict.
 *
 * The engine reads the first model only, so the figure and its exports name the model they plot
 * whenever the entry holds more than one (an NMR ensemble): "model 1 of 10".
 */

import { invokeRustBioSync } from '../lib/rustBioEngine';
import type { FigureTable } from './figureExport';
import { residueNumberLabel, type Structure } from './structureView';

// ─── What `backbone_torsions` returns (molbiocraft-protein `BackboneTorsionReport`, camelCase) ───

export type RamachandranRegion = 'favoured' | 'allowed' | 'outlier';

/** The map a residue is judged on, as the engine assigns it. */
export type RamachandranClass = 'general' | 'glycine' | 'trans-proline' | 'cis-proline' | 'pre-proline' | 'ile-val';

export interface ResidueTorsions {
  /** Author chain id. */
  chain: string;
  labelSeqId: number | null;
  /** The residue number a PDB file shows. */
  authSeqId: number | null;
  insCode: string | null;
  resName: string;
  /** Degrees in (-180, 180]; `null` for a chain's first residue, after a break, or a missing atom. */
  phi: number | null;
  /** Degrees in (-180, 180]; `null` for a chain's last residue, before a break, or a missing atom. */
  psi: number | null;
  /** The peptide bond before this residue, degrees; `null` for a chain's first residue, after a break, or a missing atom. */
  omega: number | null;
  ramachandranClass: RamachandranClass;
  /** `null` when `phi` or `psi` is. */
  region: RamachandranRegion | null;
}

export interface RamachandranRegionCounts {
  favoured: number;
  allowed: number;
  outlier: number;
  /** Residues without both `phi` and `psi`. */
  unclassified: number;
}

export interface BackboneTorsionReport {
  /** Author chain id. */
  chain: string;
  /** mmCIF label chain id. */
  labelChain: string;
  /** The chain's polymer residues in chain order. */
  residues: ResidueTorsions[];
  counts: RamachandranRegionCounts;
  chainBreaks: number;
  peptideBondMaxAngstrom: number;
  /** The engine's own statement of the region rule and its sources. */
  regionRule: string;
}

/**
 * Backbone torsions of one chain of an mmCIF structure. `chain` is an author (else label) chain
 * id; left out, `null` or blank, the engine takes the first protein chain. An engine error (no
 * text, not mmCIF, no protein chain, no such chain) is thrown, carrying the engine's message.
 */
export function backboneTorsions(text: string, chain?: string | null): BackboneTorsionReport {
  return invokeRustBioSync<BackboneTorsionReport>('backbone_torsions', { text, chain: chain ?? null });
}

/** Which model of the entry the torsions come from. */
export interface PlottedModel {
  /** The number the file gives the model that is plotted. */
  modelNum: number;
  /** How many models the entry holds: more than one for an NMR ensemble. */
  count: number;
}

/**
 * The model `backboneTorsions` reads (the first, as the engine does) and how many models the
 * structure holds, from the structure `parse_structure` reads out of the same text.
 */
export function plottedModelOf(structure: Structure): PlottedModel {
  const first = structure.models[0];
  if (!first) throw new Error('The structure has no model to plot');
  return { modelNum: first.modelNum, count: structure.models.length };
}

/**
 * "model 1 of 10" for an entry of several models ("model 3, the first of 2" for a file that numbers
 * its models from 3); empty for an entry of one, which needs no saying.
 */
export function modelPhrase(model: PlottedModel): string {
  if (model.count <= 1) return '';
  return model.modelNum === 1 ? `model 1 of ${model.count}` : `model ${model.modelNum}, the first of ${model.count}`;
}

// ─── What the figure plots and lists ───

/** What the figure says about its regions, in the drawing, above the outlier list and in the table. */
export const REGION_CAVEAT =
  "Regions are a coarse approximation of MolProbity's Ramachandran categories (10° cells from the Top8000 contours), not MolProbity's own classifier.";

/** What to do with an outlier, said wherever the regions are explained. */
export const OUTLIER_ADVICE = 'Check each outlier against MolProbity before reporting it.';

/**
 * The table's region column heading. A spreadsheet export writes headings and rows but no caption,
 * so the heading itself carries the caveat into every format.
 */
export const REGION_COLUMN =
  "Region (coarse approximation of MolProbity's categories, not MolProbity's own classifier; check each outlier against MolProbity)";

export interface RamachandranPoint {
  residue: ResidueTorsions;
  phi: number;
  psi: number;
  region: RamachandranRegion | null;
}

const isAngle = (v: number | null): v is number => typeof v === 'number' && Number.isFinite(v);

/** Every residue that has both phi and psi, in chain order: the points of the plot. */
export function ramachandranPoints(report: BackboneTorsionReport): RamachandranPoint[] {
  const out: RamachandranPoint[] = [];
  for (const residue of report.residues) {
    if (isAngle(residue.phi) && isAngle(residue.psi)) {
      out.push({ residue, phi: residue.phi, psi: residue.psi, region: residue.region });
    }
  }
  return out;
}

export interface RamachandranOutlier {
  /** Author chain id. */
  chain: string;
  /** The label sequence number, which is how the 3D viewer names a residue. */
  labelSeqId: number | null;
  /** Author residue number with its insertion code, e.g. "102A". */
  number: string;
  resName: string;
  phi: number;
  psi: number;
  ramachandranClass: RamachandranClass;
}

/** The plotted residues the engine places in an outlier region, in chain order. */
export function ramachandranOutliers(report: BackboneTorsionReport): RamachandranOutlier[] {
  return ramachandranPoints(report)
    .filter((p) => p.region === 'outlier')
    .map(({ residue, phi, psi }) => ({
      chain: residue.chain,
      labelSeqId: residue.labelSeqId,
      number: residueNumberLabel(residue),
      resName: residue.resName,
      phi,
      psi,
      ramachandranClass: residue.ramachandranClass,
    }));
}

/** "<chain> <author number><insertion code> <residue name>", e.g. "A 102A ASN". */
export function residueLabel(r: ResidueTorsions | RamachandranOutlier): string {
  const number = 'number' in r ? r.number : residueNumberLabel(r);
  return `${r.chain} ${number} ${r.resName}`;
}

/**
 * The plotted values, for the figure's table export. Every row names its model and how many models
 * the entry holds, and the region heading carries the caveat, because the delimited forms write
 * no caption.
 */
export function ramachandranTable(report: BackboneTorsionReport, name: string, model: PlottedModel): FigureTable {
  const points = ramachandranPoints(report);
  const angle = (v: number | null) => (isAngle(v) ? v.toFixed(2) : '');
  const { favoured, allowed, outlier } = report.counts;
  const phrase = modelPhrase(model);
  return {
    headers: ['Model', 'Models in entry', 'Chain', 'Residue', 'Name', 'Phi (deg)', 'Psi (deg)', 'Omega (deg)', 'Class', REGION_COLUMN],
    rows: points.map(({ residue, phi, psi, region }) => [
      String(model.modelNum), String(model.count), residue.chain, residueNumberLabel(residue), residue.resName,
      angle(phi), angle(psi), angle(residue.omega), residue.ramachandranClass, region ?? '',
    ]),
    caption: `${name} — chain ${report.chain}${phrase ? `, ${phrase}` : ''}: ${points.length} of ${report.residues.length} `
      + `residues have both phi and psi (${favoured} favoured, ${allowed} allowed, ${outlier} outlier). `
      + `${REGION_CAVEAT} ${OUTLIER_ADVICE}`,
  };
}
