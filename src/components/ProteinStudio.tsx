// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Protein studio (US-01M6Q164, viewer tab `protein-3d`): everything about one protein in one
 * place - ProtParam, hydropathy, GOR, antigenicity, the MS digest and PTMs (moved from History's
 * protein tab), the 3D viewer with its superposition and Ramachandran figure, and the coiled-coil
 * and transmembrane predictions (moved from the genomics studio's 3D tab). A DNA or RNA document is
 * analysed through its CDS translation and keeps the codon optimiser. Each panel computes only
 * while the studio is shown; the 3D card leads when the structure has coordinates (US-01M6Q1ZR).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { SequenceDocument, SequenceFeature, type ProteinAnalysisReport, type TranslatedSpan } from '../types/bio';
import { analyzeProteinSequence } from '../core/bioEngine';
import {
  alignPdbStructuresKabsch,
  targetProteinOf,
  parsePdbCaCoordinates,
  type PdbCaAtom,
  predictCoiledCoilsAndTransmembrane,
} from '../core/genomicsAndStructureSuite';
import { caAtomsToPdb, hasStructure, structureAtomsOf, structureChainCount, structureTextOf } from '../core/structureModels';
import { chainOf, parseStructure, type Structure } from '../core/structureView';
import { backboneTorsions, plottedModelOf, type BackboneTorsionReport, type PlottedModel } from '../core/ramachandran';
import {
  CodonOptimizationResult,
  optimizeCodonsRust,
  scanPostTranslationalModificationsRust,
  simulatePeptideMs2SpectrumRust,
  simulateProteolyticDigestMsRust,
} from '../lib/rustBioEngine';
import { pdbTextLoadProblem } from '../core/ngsTrimSave';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { ProteinStructure3DViewer } from './ProteinStructure3DViewer';
import { RamachandranPlot } from './RamachandranPlot';
import { FigureExportButton } from './FigureExportButton';
import { ResultWarnings } from './ResultWarnings';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';
import type { FigureTable } from '../core/figureExport';
import { PK_SCALE_LABEL } from '../core/alignmentViewModel';
import { CHART_FULL, chartMaxWidth, plotFrame, ticks } from '../core/chartLayout';
import {
  NO_RESIDUE_TRANSLATED,
  NO_STANDARD_RESIDUE,
  PROTEIN_ANALYSIS_CAP_AA,
  analysedProtein,
  documentBaseOf,
  proteinAnalysisTarget,
  residueBaseRuns,
  type ProteinAnalysisTarget,
} from '../core/analysisContext';

export { NO_RESIDUE_TRANSLATED, NO_STANDARD_RESIDUE };

const MS2_PLOT = plotFrame({ ...CHART_FULL, h: 280, padL: 52 });

const groupDigits = (v: number) => v.toLocaleString('en-US');

/** A peptide m/z to `digits` places, or 'n/a' when the engine gives none (null: a peptide holding B, Z or X). */
const mzText = (mz: number | null, digits: number) => (typeof mz === 'number' && Number.isFinite(mz) ? mz.toFixed(digits) : 'n/a');

/**
 * What the protein tab says of the bases it analysed from a DNA or RNA document, or null when it
 * analysed, as one ORF, exactly what its heading names: the whole CDS, or with no CDS feature the
 * whole molecule (BG-01M6S13D). `span` counts bases of the slice the engine was given (the CDS,
 * read along its own strand and a joined one from its segments, or the first 1,200 bp); the
 * sentence names them in the document's.
 */
function translatedCoverage(
  span: TranslatedSpan | null | undefined,
  aa: number,
  slice: { length: number; docLength: number; cds: { name: string; start: number; end: number; minus: boolean } | null },
  target: ProteinAnalysisTarget
): string | null {
  const n = groupDigits;
  const { cds } = slice;
  // An empty document had nothing to translate, rather than none of its 0 bases covered (BG-01M6SQXX).
  if (slice.docLength === 0) return 'The document holds no bases; nothing was translated.';
  if (span === undefined) {
    const [from, to] = cds ? [cds.start, cds.end] : [1, slice.length];
    return `Protein analysis did not report which of bases ${n(from)}–${n(to)} of ${n(slice.docLength)} it translated.`;
  }
  if (span === null) {
    return `Protein analysis covered no bases of ${n(slice.docLength)}: no residue was translated from ${cds ? `the CDS ${cds.name}` : 'the molecule'}.`;
  }
  const whole = span.rule === 'longestForwardOrf' && span.start === 1 && span.end === slice.length;
  if (whole && (cds || slice.length === slice.docLength)) return null;
  const ends = [documentBaseOf(target, span.start), documentBaseOf(target, span.end)];
  const [from, to] = [Math.min(...ends), Math.max(...ends)];
  const bases = `${cds?.minus ? 'the minus-strand bases' : 'bases'} ${n(from)}–${n(to)} of ${n(slice.docLength)}${cds ? `, not the whole CDS ${cds.name}` : ''}`;
  const where = cds ? 'read along the CDS' : `on the forward strand of bases 1–${n(slice.length)}`;
  if (span.rule === 'longestForwardOrf') {
    return `Protein analysis covered ${bases}: ${cds ? '' : 'with no CDS feature, '}it analyses the longest ORF (ATG to the first in-frame stop, at least 30 aa) ${where}, a ${n(aa)}-aa protein.`;
  }
  const frame = ((span.start - 1) % 3) + 1;
  const stops = `${n(span.stopsRemoved)} stop codon${span.stopsRemoved === 1 ? '' : 's'}`;
  return `Protein analysis covered ${bases}: ${cds ? 'with' : 'with no CDS feature and'} no ORF of at least 30 aa ${where}, it analyses ${cds ? "the CDS's " : ''}reading frame ${frame}, the frame with the fewest stop codons, as ${n(aa)} aa with its ${stops} left out.`;
}

/** Kyte-Doolittle hydropathy, and the b/y fragment-ion spectrum, both fill a studio card. */
const HYDRO_PLOT = plotFrame(CHART_FULL);
/** Whether a row key is a custom definition's (its `custom:` id): a built-in's key is its name. */

/** What the 3D tab draws beside the Cα trace: the file's full-atom model, or why there is none. */
interface FullAtomModel {
  structure: Structure | null;
  /** Why ligands, the file's own secondary structure, feature highlights and the Ramachandran plot are not shown. */
  note: string | null;
}

const MMCIF_ONLY =
  'ligands, the helices and strands the file declares, highlighting a selection and the Ramachandran plot are read from mmCIF';
const NOT_SHOWN = "ligands, the file's helices and strands, the selection and the Ramachandran plot are not shown";

/**
 * The full-atom model of a structure file, for the 3D viewer and the Ramachandran plot. The engine
 * reads one from mmCIF only (`parse_structure`; text is mmCIF when it has an `_atom_site.` item,
 * the engine's own test), so legacy PDB text gets none, and says so. A model whose label ids are
 * the author ids (`labelIdsFromAuthor`, as a PDB reader gives) is refused too: the viewer tells a
 * ligand from a polymer residue, and places a selection, by label sequence number, which such a
 * model gives every ligand and water.
 */
function fullAtomModelOf(text: string, name: string): FullAtomModel {
  if (!text.trim()) return { structure: null, note: null };
  if (!text.includes('_atom_site.')) {
    return { structure: null, note: `${name} is legacy PDB text: ${MMCIF_ONLY}, so they are not shown. Import the entry's .cif file to see them.` };
  }
  let structure: Structure;
  try {
    structure = parseStructure(text);
  } catch (e) {
    return { structure: null, note: `The full-atom model of ${name} could not be read (${e instanceof Error ? e.message : String(e)}), so ${NOT_SHOWN}.` };
  }
  if ((structure as Structure & { labelIdsFromAuthor?: boolean }).labelIdsFromAuthor === true) {
    return { structure: null, note: `The model read from ${name} has no mmCIF label ids (its label ids are the author ids), so its ligands cannot be told from its polymer residues; ${NOT_SHOWN}.` };
  }
  return { structure, note: null };
}

/** A token of mmCIF: a bare word (a tag, a keyword or a value), or a quoted string or text field, which is always a value. */
type CifToken = { value: string; bare: boolean };

/** The tokens of a line of mmCIF: bare words and quoted strings (a quote closes before whitespace), up to a comment. */
function cifWords(line: string): CifToken[] {
  const words: CifToken[] = [];
  for (const m of line.matchAll(/'(.*?)'(?=\s|$)|"(.*?)"(?=\s|$)|(\S+)/g)) {
    if (m[3]?.startsWith('#')) break;
    words.push({ value: m[1] ?? m[2] ?? m[3], bare: m[3] !== undefined });
  }
  return words;
}

/** Whether a token is an item name or a keyword, which ends a loop's values and is never a value. */
const cifTagOrKeyword = (token: CifToken) => token.bare && /^(_|loop_|data_|save_|global_|stop_)/i.test(token.value);

/**
 * What an mmCIF file states: the values of the items asked for, the names of the categories it
 * holds, and the categories that state something, a value (not a CIF null) in an item other than
 * one of the record's ids (an item named `id` or ending `_id`, such as `entry_id` or `specimen_id`).
 */
type CifRecord = { values: (item: string) => string[]; categories: ReadonlySet<string>; stated: ReadonlySet<string> };

/** Whether a token is a CIF null: a bare `?` or `.`. */
const cifNull = (token: CifToken) => token.bare && (token.value === '?' || token.value === '.');

/**
 * Reads mmCIF `text` in one pass of its tokens. Each item asked for (`_exptl.method`) gets its
 * values from its key-value pair or from every row of the loop that holds it, with the CIF nulls
 * (a bare `?` or `.`) left out. A value is a bare word, a quoted string or a `;` text field (the
 * lines from one that opens with `;` to the next such line, whose rest goes on with more values),
 * on its item's line or on a later one. Every category the file names is listed in `categories`
 * (`_ma_model_list`), and every category with a value besides its ids also in `stated`
 * (`_em_vitrification`, whose ids alone say nothing). Item and category names are compared in
 * lower case, as CIF compares them.
 */
function readCif(text: string, items: readonly string[]): CifRecord {
  const found = new Map<string, CifToken[]>(items.map((item) => [item.toLowerCase(), []]));
  const categories = new Set<string>();
  const stated = new Set<string>();
  const take = (name: string | undefined, value: CifToken) => {
    if (name === undefined) return;
    found.get(name)?.push(value);
    const dot = name.indexOf('.');
    if (dot >= 0 && !cifNull(value) && !/(^|_)id$/.test(name.slice(dot + 1))) stated.add(name.slice(0, dot));
  };
  let at = 0;
  const nextLine = (): string | null => {
    if (at >= text.length) return null;
    const end = text.indexOf('\n', at);
    const line = text.slice(at, end < 0 ? text.length : end).replace(/\r$/, '');
    at = end < 0 ? text.length : end + 1;
    return line;
  };
  let line: CifToken[] = [];
  let k = 0;
  const next = (): CifToken | null => {
    while (k >= line.length) {
      const raw = nextLine();
      if (raw === null) return null;
      k = 0;
      if (raw.startsWith(';')) {
        const field = [raw.slice(1)];
        let close = nextLine();
        for (; close !== null && !close.startsWith(';'); close = nextLine()) field.push(close);
        line = [{ value: field.join('\n').trim(), bare: false }, ...(close === null ? [] : cifWords(close.slice(1)))];
      } else line = cifWords(raw);
    }
    return line[k++];
  };
  const tag = (token: CifToken) => {
    const name = token.value.toLowerCase();
    const dot = name.indexOf('.');
    categories.add(dot < 0 ? name : name.slice(0, dot));
    return name;
  };
  for (let token = next(); token; token = next()) {
    if (!token.bare) continue;
    if (token.value.toLowerCase() === 'loop_') {
      const names: string[] = [];
      let value = next();
      for (; value && value.bare && value.value.startsWith('_'); value = next()) names.push(tag(value));
      for (let column = 0; value && !cifTagOrKeyword(value); column++, value = next()) take(names[column % names.length], value);
      if (value) k--;
    } else if (token.value.startsWith('_')) {
      const name = tag(token);
      const value = next();
      if (!value) break;
      if (cifTagOrKeyword(value)) k--;
      else take(name, value);
    }
  }
  return {
    values: (item) => (found.get(item.toLowerCase()) ?? []).filter((t) => !cifNull(t)).map((t) => t.value),
    categories,
    stated,
  };
}

/** The mmCIF items the 3D card's badge reads. */
const COORDINATE_SOURCE_ITEMS = [
  '_exptl.method', '_entry.id', '_software.name',
  '_em_specimen.vitrification_applied', '_em_specimen.staining_applied', '_em_staining.type',
] as const;

/** The text of a legacy PDB record type (columns 11 on, continuation lines joined), or '' when the file has none. */
const pdbRecordText = (text: string, record: 'EXPDTA' | 'TITLE'): string =>
  Array.from(text.matchAll(new RegExp(`^${record.padEnd(6)}(.*)$`, 'gm')), (m) => m[1].slice(4).trim()).join(' ');

/**
 * The experimental methods the badge calls measured, by their wwPDB names (the values of mmCIF
 * `_exptl.method` and PDB `EXPDTA`), besides ELECTRON MICROSCOPY, and the name the badge gives each.
 * The other names on that list, INFRARED SPECTROSCOPY, EPR and FLUORESCENCE TRANSFER, are not
 * classed, so the badge shows them as the file states them, as it does any name not on the list.
 */
const MEASURED_METHODS: Readonly<Record<string, string>> = {
  'X-RAY DIFFRACTION': 'X-ray',
  'NEUTRON DIFFRACTION': 'neutron',
  'FIBER DIFFRACTION': 'fiber diffraction',
  'POWDER DIFFRACTION': 'powder diffraction',
  'ELECTRON CRYSTALLOGRAPHY': 'electron crystallography',
  'SOLUTION NMR': 'NMR',
  'SOLID-STATE NMR': 'NMR',
  'SOLUTION SCATTERING': 'solution scattering',
};

/**
 * How the badge names an ELECTRON MICROSCOPY entry. The method name does not say how the specimen
 * was prepared, and a PDB file's EXPDTA record states nothing more (its REMARK 245 has at most
 * free-text vitrification details, which are not read), so the name is only as specific as the
 * mmCIF file's own `_em_` records state:
 * - cryo-EM when `_em_specimen.vitrification_applied` is YES or, when the file states no such flag,
 *   when its `_em_vitrification` record states something (a value besides the record's ids; an
 *   all-null record states nothing). 6VXX.cif states both;
 * - negative-stain EM when `_em_staining.type` is NEGATIVE and no specimen is stated vitrified
 *   (`vitrification_applied` YES) or unstained (`_em_specimen.staining_applied` NO). A specimen
 *   stated only not vitrified, or only stained, has no stated stain type, so it is not presumed
 *   negatively stained (a stained resin section is not a negative stain);
 * - otherwise electron microscopy.
 * A YES or NEGATIVE holds only when every specimen (every row of the item) says it, so a file whose
 * specimens differ (one vitrified and one not) gets the plain name whatever its stain rows say.
 */
function electronMicroscopyName(cif: CifRecord): string {
  const said = (item: string) => cif.values(item).map((v) => v.toUpperCase());
  const all = (values: string[], word: string) => values.length > 0 && values.every((v) => v === word);
  const vitrification = said('_em_specimen.vitrification_applied');
  if (vitrification.length ? all(vitrification, 'YES') : cif.stated.has('_em_vitrification')) return 'cryo-EM';
  const negativeStain = all(said('_em_staining.type'), 'NEGATIVE')
    && !vitrification.includes('YES') && !said('_em_specimen.staining_applied').includes('NO');
  return negativeStain ? 'negative-stain EM' : 'electron microscopy';
}

const ALPHAFOLD_MODEL = 'Predicted model (AlphaFold, pLDDT in B-factor)';

/**
 * What the 3D card's badge says model A's coordinates are. `text` is its structure file; `loaded`
 * says the file was loaded into the tab rather than being the document's own; `statedExperiment`
 * is the document's own record of the experiment (the sample library's `Experiment`), which says
 * nothing about a file loaded into the tab. The badge says "Measured" only for a method the file
 * or the document states, and names AlphaFold only for a file that is a model by its own record.
 *
 * 1. A predicted model, when the file is one by its own record: a ModelCIF file (it has `_ma_`
 *    categories, as AlphaFold DB's mmCIF file has) or a stated method that begins THEORETICAL MODEL
 *    or PREDICTED MODEL ("THEORETICAL MODEL (SWISS-MODEL SERVER)"). It is an AlphaFold model, whose
 *    B-factor column holds pLDDT, when the file also names AlphaFold: an AlphaFold DB entry id
 *    (`_entry.id` AF-...), `_software` named AlphaFold in a ModelCIF file, or the TITLE in 3.
 * 2. The methods the file states, mmCIF `_exptl.method` (a pair or a loop) and PDB `EXPDTA`
 *    (separated by `;`): measured when every one is in `MEASURED_METHODS` or is electron
 *    microscopy (named as `electronMicroscopyName` reads it), and otherwise shown as the file
 *    states them.
 * 3. With no method stated, a TITLE that opens "ALPHAFOLD ... PREDICTION FOR", as AlphaFold DB
 *    writes its PDB files (AF-P69905-F1's opens "ALPHAFOLD MONOMER V2.0 PREDICTION FOR"), which
 *    have no EXPDTA record: an AlphaFold model. A TITLE that mentions AlphaFold anywhere else does
 *    not say that the file's own coordinates are a prediction.
 * 4. The document's own record, read as a method in 2, unless the file was loaded into the tab.
 * 5. Otherwise the source is not stated.
 */
export function coordinateSourceBadge(text: string, loaded: boolean, statedExperiment: unknown): string {
  const cif = readCif(text, COORDINATE_SOURCE_ITEMS);
  const expdta = pdbRecordText(text, 'EXPDTA');
  const methods = [...cif.values('_exptl.method'), ...(expdta ? expdta.split(';') : [])]
    .map((m) => m.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const modelCif = [...cif.categories].some((category) => category.startsWith('_ma_'));
  const alphaFoldDbTitle = /^ALPHAFOLD\b.*\bPREDICTION FOR\b/i.test(pdbRecordText(text, 'TITLE'));
  const namesAlphaFold = cif.values('_entry.id').some((id) => /^AF-/i.test(id))
    || (modelCif && cif.values('_software.name').some((name) => /^AlphaFold\b/i.test(name)))
    || alphaFoldDbTitle;
  const fromMethods = (stated: string[]) => {
    const names = stated.map((m) => (m.toUpperCase() === 'ELECTRON MICROSCOPY' ? electronMicroscopyName(cif) : MEASURED_METHODS[m.toUpperCase()]));
    return names.every(Boolean)
      ? `Measured Cα coordinates (${[...new Set(names)].join(', ')})`
      : `Cα coordinates (method: ${stated.join('; ')})`;
  };
  if (modelCif || methods.some((m) => /^(THEORETICAL|PREDICTED) MODEL\b/i.test(m))) return namesAlphaFold ? ALPHAFOLD_MODEL : 'Predicted model';
  if (methods.length) return fromMethods(methods);
  if (alphaFoldDbTitle) return ALPHAFOLD_MODEL;
  const experiment = !loaded && typeof statedExperiment === 'string' ? statedExperiment.trim() : '';
  return experiment ? fromMethods([experiment]) : 'Cα coordinates (source not stated)';
}

/** The Ramachandran plot of the open chain: the engine's torsions and the model they come from, or why there are none. */
type ChainRamachandran = { report: BackboneTorsionReport; model: PlottedModel } | { error: string };

/**
 * The backbone torsions of one chain of `text`, named by its label id as a structure document's
 * `Chain` is (`''` for the first protein chain). The engine finds a chain by author id first, and
 * one chain's author id can be another's label id, so the chain is passed by its author id and the
 * label chain the engine read is checked.
 */
function chainRamachandran(text: string, structure: Structure, labelChain: string): ChainRamachandran {
  try {
    const authorChain = labelChain ? chainOf(structure, labelChain)?.authAsymId : undefined;
    if (labelChain && authorChain === undefined) return { error: `the structure's first model has no chain ${labelChain}` };
    const report = backboneTorsions(text, authorChain ?? null);
    if (labelChain && report.labelChain !== labelChain) {
      return { error: `the engine read chain ${report.labelChain} (author ${report.chain}), not chain ${labelChain}` };
    }
    return { report, model: plottedModelOf(structure) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The sequence superposition's two TM-scores (engine `tmScoreA`, `tmScoreB`: Zhang-Skolnick, of
 * the sequence-paired residues, normalised by each chain), each named by the chain it is
 * normalised by.
 */
function superpositionTmScores(
  report: { chainA: string; chainB: string },
  chains: { a: string; b: string } | null,
): { by: string; value: number }[] {
  const r = report as typeof report & { tmScoreA?: number; tmScoreB?: number };
  if (typeof r.tmScoreA !== 'number' || typeof r.tmScoreB !== 'number') return [];
  return [
    { by: `chain ${chains?.a ?? r.chainA}`, value: r.tmScoreA },
    { by: `chain ${chains?.b ?? r.chainB}`, value: r.tmScoreB },
  ];
}

/**
 * A chain the superposition engine paired, named as the Ramachandran figure and the selection badge
 * name a chain: by its author id, with its label id beside it where the two differ. The engine
 * names the chain by the one-letter id `caAtomsToPdb` wrote (the first letter of the Cα atoms'
 * chain id, which for mmCIF is the label id); a model with no full-atom structure, such as legacy
 * PDB text, has one id only.
 */
function pairedChainName(engineChain: string, atoms: PdbCaAtom[], structure: Structure | null): string {
  const label = atoms.find((a) => (a.chainId || 'A').slice(0, 1) === engineChain)?.chainId || engineChain;
  const author = structure ? chainOf(structure, label)?.authAsymId : undefined;
  return author && author !== label ? `${author} (label ${label})` : label;
}

/** The most rows the STR and synteny tables draw; the count beside each table is the total. */

export interface ProteinStudioProps {
  activeDoc: SequenceDocument;
  /** Live protein documents; the 3D superposition takes its partner model B from these. */
  proteinDocuments?: SequenceDocument[];
  /** Documents ticked in the table: a ticked structure is the superposition's model B. */
  selectedDocuments?: SequenceDocument[];
  /** The selection on the active document's sequence: the 3D viewer highlights its residues on the document's own chain. */
  selectedRange?: { start: number; end: number; label?: string } | null;
  /** Saves a document the analysis annotates (predicted epitopes). */
  onUpdateDocument?: (updated: SequenceDocument) => void;
  onStatusBanner?: (msg: string) => void;
}

/** The instability index is a sum over dipeptides of standard residues, so a chain with one standard residue has none. */
const NO_STANDARD_DIPEPTIDE = 'n/a: fewer than two standard residues';

/** ProtParam, hydropathy, GOR, antigenicity, the MS digest, PTMs and (for DNA or RNA) the codon optimiser: History's former protein tab. */
function ProteinAnalysisPanel({ doc, onUpdateDocument }: { doc: SequenceDocument; onUpdateDocument?: (updated: SequenceDocument) => void }) {
  // In the workbench the hydropathy window and the protease sit in App's inspector; drawn on its own,
  // the studio keeps each where it sits in its result (US-01M6TANN).
  const inWorkbench = useInWorkbench();
  const [proteaseEnzyme, setProteaseEnzyme] = useState<string>('Trypsin');
  const [selectedMs2PeptideIdx, setSelectedMs2PeptideIdx] = useState<number>(0);
  const [targetHost, setTargetHost] = useState<
    'ecoli_k12' | 'human_hek293' | 'yeast_scerevisiae'
  >('ecoli_k12');
  const [codonResult, setCodonResult] = useState<CodonOptimizationResult | null>(null);
  const [hydroWindow, setHydroWindow] = useState<number>(9);

  const isProteinDoc = doc.moleculeType === 'Protein';
  const targetCdsSlice = useMemo(() => proteinAnalysisTarget(doc), [doc]);

  const proteinReport = useMemo(
    () =>
      (analyzeProteinSequence(targetCdsSlice.coding, !isProteinDoc, hydroWindow) as ProteinAnalysisReport & {
            /** What the analysis read other than the 20 standard residues (D0005). */
            warnings?: string[];
            /** Guruprasad's instability index (biophysics_3d.rs); null where the chain has no two standard residues. */
            instabilityIndex?: number | null;
          }),
    [targetCdsSlice.coding, isProteinDoc, hydroWindow]
  );
  // The engine translated no residue (a lone stop, part of a codon, an empty document): each
  // protein KPI with no answer reads NO_RESIDUE_TRANSLATED (BG-01M6SQXX).
  const noResidue = proteinReport !== null && proteinReport.lengthAa === 0;
  // The protein the analysis card names, which the digest, MS2 and PTM cards and Annotate epitopes
  // read (BG-01M6SQ1W): the engine's translation of the bases its translatedSpan names. With none,
  // those cards say why they are empty; no stand-in protein is analysed in its place.
  const analysed = useMemo(
    () => (proteinReport ? analysedProtein(targetCdsSlice, isProteinDoc, proteinReport.translatedSpan) : null),
    [proteinReport, targetCdsSlice, isProteinDoc]
  );
  const analysedSeq = analysed?.protein ?? '';
  const noProteinWhy = analysed
    ? null
    : isProteinDoc
      ? 'the protein holds no residue'
      : noResidue || !proteinReport
        ? 'no residue was translated'
        : 'protein analysis did not report which bases it translated';

  // What protein analysis covered, said beside the result whenever it is not all the tab reads
  // from: a protein past the cap, or an ORF or frame short of the whole CDS (with no CDS, of the
  // whole molecule).
  const analysisCoverage = useMemo(() => {
    if (!proteinReport) return null;
    if (isProteinDoc) {
      const n = groupDigits;
      return proteinReport.lengthAa < targetCdsSlice.totalResidues
        ? `Protein analysis covered residues 1–${n(proteinReport.lengthAa)} of ${n(targetCdsSlice.totalResidues)}: it reads at most ${n(PROTEIN_ANALYSIS_CAP_AA)} aa.`
        : null;
    }
    return translatedCoverage(proteinReport.translatedSpan, proteinReport.lengthAa, {
      length: targetCdsSlice.coding.length,
      docLength: doc.sequence.length,
      cds: targetCdsSlice.cds,
    }, targetCdsSlice);
  }, [proteinReport, isProteinDoc, targetCdsSlice, doc.sequence.length]);

  const digestMsReport = useMemo(
    () => simulateProteolyticDigestMsRust(analysedSeq, proteaseEnzyme, 1, 400.0, 4500.0, true),
    [analysedSeq, proteaseEnzyme]
  );

  // The spectrum of the peptide picked from the digest; with no peptide there is none to fragment.
  const activeMs2Peptide = useMemo(() => {
    const list = digestMsReport?.peptides ?? [];
    if (list.length === 0) return null;
    const clamped = Math.min(selectedMs2PeptideIdx, list.length - 1);
    return list[Math.max(0, clamped)].sequence;
  }, [digestMsReport?.peptides, selectedMs2PeptideIdx]);

  const ms2SpectrumReport = useMemo(
    () => (activeMs2Peptide ? simulatePeptideMs2SpectrumRust(activeMs2Peptide, true) : null),
    [activeMs2Peptide]
  );

  const ptmDisulfideReport = useMemo(() => scanPostTranslationalModificationsRust(analysedSeq), [analysedSeq]);

  useEffect(() => {
    if (!isProteinDoc) {
      setCodonResult(optimizeCodonsRust(targetCdsSlice.dna, 'ecoli_k12'));
    }
  }, [targetCdsSlice.dna, isProteinDoc]);

  const handleRunCodonOpt = (
    host: 'ecoli_k12' | 'human_hek293' | 'yeast_scerevisiae'
  ) => {
    setTargetHost(host);
    setCodonResult(optimizeCodonsRust(targetCdsSlice.dna, host));
  };

  const handleAnnotateEpitopes = () => {
    if (!onUpdateDocument || !proteinReport || !analysed) return;
    const { minusStrand } = targetCdsSlice;
    const newFeatures: SequenceFeature[] = proteinReport.antigenicDeterminants.map(
      (ep, idx) => {
        // A protein's epitope is its residues; a DNA or RNA document's is the codons of the analysed
        // ORF or frame it was translated from (BG-01M6SQ1W), from translatedSpan.start, past any
        // stop a fewest-stop frame left out, along the CDS's strand and through a joined CDS's segments.
        const name = `Antigenic_Epitope_${ep.startAa}_${ep.endAa}`;
        const runs: [number, number][] = isProteinDoc
          ? [[ep.startAa, ep.endAa]]
          : residueBaseRuns(targetCdsSlice, analysed, ep.startAa, ep.endAa);
        return {
        id: `feat-epitope-${Date.now()}-${idx}`,
        name,
        type: 'antigenic_epitope',
        // its span is its lowest to its highest base, as the GenBank reader stores a join
        start: Math.max(1, Math.min(...runs.map((r) => r[0]))),
        end: Math.min(doc.sequence.length, Math.max(...runs.map((r) => r[1]))),
        strand: (minusStrand ? -1 : 1) as 1 | -1,
        color: '#d97706',
        notes: `EMBOSS Kolaskar-Tongaonkar antigenic determinant (${ep.peptide}, score=${ep.maxScore})`,
        ...(runs.length > 1
          ? { segments: runs.map(([start, end], i) => ({ index: i + 1, name: `${name} part ${i + 1}`, start, end, color: '#d97706' })) }
          : {}),
        };
      }
    );
    onUpdateDocument({
      ...doc,
      features: [...doc.features, ...newFeatures],
      updatedAt: new Date().toISOString(),
    });
  };

  // Build SVG path for Kyte-Doolittle Hydrophobicity Plot
  const hydroSvgPath = useMemo(() => {
    const prof = proteinReport?.hydrophobicityProfile ?? [];
    if (!prof.length) return '';
    return prof
      .map((pt, idx) => {
        const x = HYDRO_PLOT.xOfIndex(idx, prof.length);
        const y = HYDRO_PLOT.yOf(pt.score, -4.5, 4.5);
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [proteinReport?.hydrophobicityProfile]);

  /** The plotted profile as values, so the chart and the numbers behind it export together. */
  const hydroTable = useMemo((): FigureTable | null => {
    const prof = proteinReport?.hydrophobicityProfile ?? [];
    if (!prof.length) return null;
    return {
      headers: ['Residue position (aa)', `Kyte-Doolittle score (window ${hydroWindow} aa)`],
      rows: prof.map((pt) => [String(pt.position), pt.score.toFixed(3)]),
      caption: `${doc.name} — Kyte-Doolittle hydropathy, ${hydroWindow} aa window`,
    };
  }, [doc.name, hydroWindow, proteinReport?.hydrophobicityProfile]);

  // The Protein and Lineage settings sit in two places of their result. In the workbench each
  // sub-tab's pair is drawn in one inspector section and nowhere in the result; drawn on its own,
  // the studio draws each where it sat.
  const hydroWindowSlider = (
    <input
      type="range"
      min={5}
      max={21}
      step={2}
      value={hydroWindow}
      onChange={(e) => setHydroWindow(Number(e.target.value))}
    />
  );
  const proteaseSelect = (
    <select
      value={proteaseEnzyme}
      onChange={(e) => {
        setProteaseEnzyme(e.target.value);
        setSelectedMs2PeptideIdx(0);
      }}
    >
      <option value="Trypsin">Trypsin (K/R | not P)</option>
      <option value="Chymotrypsin">Chymotrypsin (F/Y/W/L)</option>
      <option value="Lys-C">Endoproteinase Lys-C (K)</option>
      <option value="Glu-C">Staph. V8 Glu-C (E/D)</option>
    </select>
  );
  return (
    <>
      {analysisCoverage && (
        <ResultWarnings warnings={[analysisCoverage]} label="Protein analysis coverage" />
      )}
      {proteinReport && digestMsReport && ptmDisulfideReport && (
        <div className="studio-split-grid">
          {/* after the Structure section (order 1), as the 3D card leads the studio */}
          {inWorkbench && (
            <InspectorSection title="Protein Analysis" order={2}>
              <label className="mbc-control-row">
                <span>Hydropathy window: {hydroWindow} aa</span>
                {hydroWindowSlider}
              </label>
              <label className="form-field">
                Protease
                {proteaseSelect}
              </label>
            </InspectorSection>
          )}
          {/* Left Card: EMBOSS Protein Analysis, Hydrophobicity, GOR Secondary Structure & Antigenicity */}
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>EMBOSS Protein Analysis — {targetCdsSlice.label}</h3>
              <span className="badge-accent">Kyte-Doolittle + GOR + Kolaskar</span>
            </div>

            <ResultWarnings warnings={proteinReport.warnings} label="Protein analysis warnings" />
            <p className="mbc-summary-note">{PK_SCALE_LABEL}</p>
            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Molecular Weight</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.molecularWeightKda} kDa ({proteinReport.lengthAa} aa)</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Isoelectric Point (pI)</span>
                <strong className="kpi-val">{noResidue ? NO_RESIDUE_TRANSLATED : <>pH {proteinReport.isoelectricPointPi}</>}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label" title="Net charge on the same Bjellqvist titration the pI is the root of">
                  Charge at pH 7
                </span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>
                    {proteinReport.chargeAtPh7 > 0 ? '+' : ''}
                    {proteinReport.chargeAtPh7.toFixed(2)}
                  </>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">ε₂₈₀ reduced / cystines (M⁻¹cm⁻¹)</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>
                    {proteinReport.extinctionCoeff280Reduced.toLocaleString()} /{' '}
                    {proteinReport.extinctionCoeff280Cystine.toLocaleString()}
                  </>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label" title="Absorbance of a 1 mg/ml solution in a 1 cm cell, cysteines paired">
                  A[280] of 1 mg/ml
                </span>
                <strong className="kpi-val">{noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.a280Of1mgPerMl.toFixed(2)} AU</>}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">GRAVY / Aliphatic</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : !Number.isFinite(proteinReport.gravyHydropathy) ? NO_STANDARD_RESIDUE : <>{proteinReport.gravyHydropathy} / {proteinReport.aliphaticIndex}</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label" title="Guruprasad dipeptide instability index; below 40 predicts a stable protein">Instability Index</span>
                <strong className="kpi-val">
                  {noResidue
                    ? NO_RESIDUE_TRANSLATED
                    : !Number.isFinite(proteinReport.gravyHydropathy)
                      ? NO_STANDARD_RESIDUE
                      : !Number.isFinite(proteinReport.instabilityIndex)
                        ? NO_STANDARD_DIPEPTIDE
                        : proteinReport.instabilityIndex}
                </strong>
              </div>
            </div>

            {/* Kyte-Doolittle Hydrophobicity Plot */}
            <div data-mbc-figure>
            <div className="studio-card-header" style={{ paddingTop: 4 }}>
              <h4>Kyte-Doolittle Hydropathy Plot (Window = {hydroWindow} aa)</h4>
              {!inWorkbench && hydroWindowSlider}
              <FigureExportButton
                compact
                baseName={`${doc.name} — Kyte-Doolittle Hydropathy`}
                title={`${doc.name} — Kyte-Doolittle hydropathy (${hydroWindow} aa window)`}
                table={hydroTable}
              />
            </div>

            <svg
              viewBox={`0 0 ${HYDRO_PLOT.w} ${HYDRO_PLOT.h}`}
              className="phylo-tree-svg"
              style={chartMaxWidth(HYDRO_PLOT.w)}
              role="img"
              aria-label={`Kyte-Doolittle hydropathy over ${proteinReport.lengthAa} residues`}
            >
              <rect
                x={HYDRO_PLOT.x}
                y={HYDRO_PLOT.y}
                width={HYDRO_PLOT.width}
                height={HYDRO_PLOT.height}
                fill="var(--mbc-bg-panel)"
                stroke="var(--mbc-border)"
              />
              {ticks(-4.5, 4.5, 7).map((v) => (
                <g key={v}>
                  <line
                    x1={HYDRO_PLOT.x}
                    y1={HYDRO_PLOT.yOf(v, -4.5, 4.5)}
                    x2={HYDRO_PLOT.x + HYDRO_PLOT.width}
                    y2={HYDRO_PLOT.yOf(v, -4.5, 4.5)}
                    stroke={v === 0 ? 'var(--mbc-text-muted)' : 'var(--mbc-border-light)'}
                    strokeDasharray={v === 0 ? '3 3' : undefined}
                  />
                  <text
                    x={HYDRO_PLOT.x - 8}
                    y={HYDRO_PLOT.yOf(v, -4.5, 4.5) + 3.5}
                    textAnchor="end"
                    fill="var(--mbc-text-secondary)"
                    fontSize="11"
                  >
                    {v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)}
                  </text>
                </g>
              ))}
              {/* transmembrane threshold */}
              <line
                x1={HYDRO_PLOT.x}
                y1={HYDRO_PLOT.yOf(1.6, -4.5, 4.5)}
                x2={HYDRO_PLOT.x + HYDRO_PLOT.width}
                y2={HYDRO_PLOT.yOf(1.6, -4.5, 4.5)}
                stroke="var(--mbc-red)"
                strokeDasharray="2 2"
              />
              <text
                x={HYDRO_PLOT.x + HYDRO_PLOT.width - 6}
                y={HYDRO_PLOT.yOf(1.6, -4.5, 4.5) - 5}
                textAnchor="end"
                fill="var(--mbc-red)"
                fontSize="10.5"
                fontWeight="600"
              >
                +1.6 hydrophobic threshold
              </text>
              {ticks(1, proteinReport.lengthAa, 6).map((v, i, all) => (
                <text
                  key={v}
                  x={HYDRO_PLOT.xOfIndex(i, all.length)}
                  y={HYDRO_PLOT.y + HYDRO_PLOT.height + 16}
                  textAnchor="middle"
                  fill="var(--mbc-text-secondary)"
                  fontSize="10.5"
                >
                  {Math.round(v)}
                </text>
              ))}
              <path d={hydroSvgPath} fill="none" stroke="var(--mbc-blue)" strokeWidth="1.5" />
              <text
                x={HYDRO_PLOT.x + HYDRO_PLOT.width / 2}
                y={HYDRO_PLOT.h - 8}
                textAnchor="middle"
                fill="var(--mbc-text-secondary)"
                fontSize="11"
                fontWeight="600"
              >
                Residue position (1..{proteinReport.lengthAa} aa)
              </text>
            </svg>
            </div>

            {/* Garnier-Osguthorpe-Robson (GOR) Secondary Structure & Kolaskar Antigenicity */}
            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">α-Helix (GOR H)</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.secondaryStructureSummary.helixPercent}%</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">β-Sheet (GOR E)</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.secondaryStructureSummary.sheetPercent}%</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Random Coil (C)</span>
                <strong className="kpi-val">
                  {noResidue ? NO_RESIDUE_TRANSLATED : <>{proteinReport.secondaryStructureSummary.coilPercent}%</>}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Antigenic Epitopes</span>
                <strong className="kpi-val">
                  {proteinReport.antigenicDeterminants.length} regions
                </strong>
              </div>
            </div>

            {onUpdateDocument && proteinReport.antigenicDeterminants.length > 0 && (
              <button className="btn-success" onClick={handleAnnotateEpitopes}>
                + Annotate {proteinReport.antigenicDeterminants.length} Predicted Antigenic Epitopes onto{' '}
                {doc.name}
              </button>
            )}

          </div>

          {/* Right Card: Back-Translation & Multi-Host Codon Optimization + Antigenic Table */}
          <div className="studio-card">
            {!isProteinDoc && (<>
            <div className="studio-card-header">
              <h3>
                Sequence{' '}
                <ChevronRight
                  size={15}
                  strokeWidth={2.4}
                  className="mbc-inline-chevron"
                  aria-hidden="true"
                />{' '}
                Back-Translate &amp; Multi-Host Codon Optimizer
              </h3>
              <span className="badge-accent">{codonResult?.engine || 'Python Sidecar'}</span>
            </div>

            <div className="cloning-method-tabs">
              {(
                [
                  ['ecoli_k12', 'E. coli K12'],
                  ['human_hek293', 'Human (HEK293)'],
                  ['yeast_scerevisiae', 'Yeast (S. cerevisiae)'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={`method-tab-btn ${targetHost === id ? 'active' : ''}`}
                  onClick={() => handleRunCodonOpt(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {codonResult && (
              <div className="codon-result-panel">
                <div className="thermo-kpi-grid">
                  <div className="kpi-box">
                    <span className="kpi-label">Codon Adaptation (CAI)</span>
                    <strong className="kpi-val">{codonResult.caiScore}</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Optimized GC%</span>
                    <strong className="kpi-val">{codonResult.gcPercent}%</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">CDS Length</span>
                    <strong className="kpi-val">{codonResult.lengthBp} bp</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Host Table</span>
                    <strong className="kpi-val">{codonResult.host}</strong>
                  </div>
                </div>
                <div className="newick-box" style={{ marginTop: 6 }}>
                  <span>Back-Translated / Codon-Optimized DNA (5&apos;→3&apos;):</span>
                  <code>{codonResult.optimizedDna.slice(0, 210)}...</code>
                </div>
                <ResultWarnings warnings={codonResult.warnings} label="Codon optimisation warnings" />
              </div>
            )}

            </>)}

            <h4 className="sub-heading">
              EMBOSS Kolaskar-Tongaonkar Predicted Antigenic Regions
            </h4>
            <WorkbenchSmartTable
              tableId="hybrid-protein-antigenic-regions"
              tableLabel="Predicted Antigenic Regions"
              regionMaxHeight={195}
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>AA Coordinates</th>
                  <th>Peptide Sequence</th>
                  <th>Length</th>
                  <th>Antigenicity Score</th>
                </tr>
              </thead>
              <tbody>
                {proteinReport.antigenicDeterminants.map((ep, idx) => (
                  <tr key={idx}>
                    <td>
                      <strong>
                        aa {ep.startAa}..{ep.endAa}
                      </strong>
                    </td>
                    <td className="mono-cell">{ep.peptide}</td>
                    <td>{ep.peptide.length} aa</td>
                    <td>{ep.maxScore}</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>

            {/* Proteomics LC-MS/MS In-Silico Digest, CID/HCD b/y-Ion MS2 Spectrum & PTM / petgraph Disulfide Scanner */}
            <div className="mbc-studio-isolated-region" style={{ marginTop: 12 }}>
              <div className="studio-card-header" style={{ paddingTop: 4 }}>
                <h4>Proteomics LC-MS/MS Digest, b/y-Ion MS2 &amp; PTM / Disulfide Prediction</h4>
                {!inWorkbench && proteaseSelect}
              </div>

              <ResultWarnings warnings={digestMsReport.warnings} label="Digest warnings" />
              {noProteinWhy && (
                <>
                  <p className="mbc-summary-note" data-mbc-empty-state="digest">
                    No peptide: {noProteinWhy}, so there is nothing to digest.
                  </p>
                  <p className="mbc-summary-note" data-mbc-empty-state="ptm">
                    No PTM, PEST or disulfide site: {noProteinWhy}, so there is no residue to scan.
                  </p>
                </>
              )}
              {!ms2SpectrumReport && (
                <p className="mbc-summary-note" data-mbc-empty-state="ms2">
                  {noProteinWhy
                    ? `No MS2 spectrum: ${noProteinWhy}, so there is no peptide to fragment.`
                    : `No MS2 spectrum: the ${proteaseEnzyme} digest gives no peptide of 400–4,500 Da to fragment.`}
                </p>
              )}

              <div className="thermo-kpi-grid">
                <div className="kpi-box">
                  <span className="kpi-label">Intact Mass (Mono)</span>
                  <strong className="kpi-val">
                    {noResidue ? NO_RESIDUE_TRANSLATED : Number.isFinite(digestMsReport.intactMonoisotopicDa) ? <>{(digestMsReport.intactMonoisotopicDa / 1000).toFixed(2)} kDa</> : 'n/a'}
                  </strong>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">Observable MS1 Peptides</span>
                  <strong className="kpi-val">
                    {digestMsReport.observablePeptideCount} (
                    {noResidue ? NO_RESIDUE_TRANSLATED : <>{digestMsReport.sequenceCoveragePct.toFixed(1)}% cov</>})
                  </strong>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">PTMs / PEST Degrons</span>
                  <strong className="kpi-val">
                    {ptmDisulfideReport.ptmSites.length} / {ptmDisulfideReport.pestDegrons.length}
                  </strong>
                </div>
                <div className="kpi-box">
                  <span className="kpi-label">Predicted Disulfides</span>
                  <strong className="kpi-val">
                    {ptmDisulfideReport.disulfideBonds.length} ({ptmDisulfideReport.totalCysteines} Cys)
                  </strong>
                </div>
              </div>

              {digestMsReport.peptides.length > 0 && ms2SpectrumReport && (
                <div style={{ marginTop: 6 }} data-mbc-figure>
                  <div className="studio-card-header" style={{ paddingTop: 0 }}>
                    <h4>b/y-Ion MS2 Spectrum</h4>
                    <FigureExportButton
                      compact
                      baseName={`${doc.name} — MS2 Spectrum`}
                      title={`${doc.name} — b/y fragment-ion spectrum`}
                      table={{
                        headers: ['m/z', 'Relative intensity (%)', 'Ion series', 'Label'],
                        rows: ms2SpectrumReport.peaks.map((pk) => [
                          pk.mz.toFixed(4),
                          pk.relativeIntensity.toFixed(1),
                          pk.ionSeries,
                          pk.label,
                        ]),
                        caption: `${doc.name} — b/y fragment ions, precursor [M+2H]2+ = ${mzText(ms2SpectrumReport.precursorMz2plus, 3)} m/z`,
                      }}
                    />
                  </div>
                  <label className="form-field" style={{ marginBottom: 6 }}>
                    <span>
                      b/y Fragment Ions (exact m/z; bar heights are a qualitative guide, not predicted
                      intensities) — Precursor [M+2H]²⁺ ={' '}
                      {mzText(ms2SpectrumReport.precursorMz2plus, 3)} m/z:
                    </span>
                    <select
                      value={Math.min(selectedMs2PeptideIdx, digestMsReport.peptides.length - 1)}
                      onChange={(e) => setSelectedMs2PeptideIdx(Number(e.target.value))}
                    >
                      {digestMsReport.peptides.slice(0, 18).map((pep, idx) => (
                        <option key={pep.peptideIndex} value={idx}>
                          #{pep.peptideIndex} ({pep.startAa}..{pep.endAa} aa) {pep.sequence} — {mzText(pep.mzCharge2, 2)} m/z (RT {pep.hplcRetentionMin.toFixed(1)} min)
                        </option>
                      ))}
                    </select>
                  </label>

                  <svg
                    viewBox={`0 0 ${MS2_PLOT.w} ${MS2_PLOT.h}`}
                    className="phylo-tree-svg"
                    style={chartMaxWidth(MS2_PLOT.w)}
                    role="img"
                    aria-label={`b and y fragment-ion spectrum, ${ms2SpectrumReport.peaks.length} peaks`}
                  >
                    <rect
                      x={MS2_PLOT.x}
                      y={MS2_PLOT.y}
                      width={MS2_PLOT.width}
                      height={MS2_PLOT.height}
                      fill="var(--mbc-bg-panel)"
                      stroke="var(--mbc-border)"
                    />
                    {(() => {
                      const peaks = ms2SpectrumReport.peaks;
                      const maxMz = Math.max(400, ...peaks.map((p) => p.mz)) * 1.06;
                      const baseY = MS2_PLOT.y + MS2_PLOT.height;
                      return (
                        <>
                          {ticks(0, 100, 5).map((v) => (
                            <g key={`i${v}`}>
                              <line
                                x1={MS2_PLOT.x}
                                y1={MS2_PLOT.yOf(v, 0, 100)}
                                x2={MS2_PLOT.x + MS2_PLOT.width}
                                y2={MS2_PLOT.yOf(v, 0, 100)}
                                stroke="var(--mbc-border-light)"
                              />
                              <text
                                x={MS2_PLOT.x - 8}
                                y={MS2_PLOT.yOf(v, 0, 100) + 3.5}
                                textAnchor="end"
                                fill="var(--mbc-text-secondary)"
                                fontSize="10.5"
                              >
                                {v}
                              </text>
                            </g>
                          ))}
                          {ticks(0, maxMz, 7).map((v) => (
                            <text
                              key={`m${v}`}
                              x={MS2_PLOT.xOf(v, 0, maxMz)}
                              y={baseY + 16}
                              textAnchor="middle"
                              fill="var(--mbc-text-secondary)"
                              fontSize="10.5"
                            >
                              {Math.round(v)}
                            </text>
                          ))}
                          {peaks.map((pk, idx) => {
                            const x = MS2_PLOT.xOf(pk.mz, 0, maxMz);
                            const y = MS2_PLOT.yOf(pk.relativeIntensity, 0, 100);
                            const isY = pk.ionSeries.startsWith('y');
                            const col = isY ? 'var(--mbc-red)' : 'var(--mbc-blue)';
                            return (
                              <g key={`${pk.label}-${idx}`}>
                                <line x1={x} y1={baseY} x2={x} y2={y} stroke={col} strokeWidth="1.4" />
                                {pk.relativeIntensity >= 42 && (
                                  <text x={x} y={y - 5} textAnchor="middle" fill={col} fontSize="10" fontWeight="700">
                                    {pk.label}
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </>
                      );
                    })()}
                    <text
                      x={MS2_PLOT.x - 8}
                      y={MS2_PLOT.y - 6}
                      textAnchor="end"
                      fill="var(--mbc-text-secondary)"
                      fontSize="10"
                    >
                      rel %
                    </text>
                    <text
                      x={MS2_PLOT.x + MS2_PLOT.width / 2}
                      y={MS2_PLOT.h - 8}
                      textAnchor="middle"
                      fill="var(--mbc-text-secondary)"
                      fontSize="11"
                      fontWeight="600"
                    >
                      m/z — blue: N-terminal b-ions · red: C-terminal y-ions (
                      {ptmDisulfideReport.predictedSubcellularCompartment})
                    </text>
                  </svg>
                </div>
              )}

              <WorkbenchSmartTable
                tableId="hybrid-proteomics-peptides"
                tableLabel="Proteolytic LC-MS Peptides"
                regionMaxHeight={165}
                className="bio-table"
              >
                <thead>
                  <tr>
                    <th>Span</th>
                    <th>Peptide</th>
                    <th>Formula</th>
                    <th>[M+2H]²⁺ m/z</th>
                    <th>RT (min)</th>
                  </tr>
                </thead>
                <tbody>
                  {digestMsReport.peptides.slice(0, 24).map((pep) => (
                    <tr key={pep.peptideIndex}>
                      <td>
                        aa {pep.startAa}..{pep.endAa}
                      </td>
                      <td className="mono-cell">{pep.sequence}</td>
                      <td className="mono-cell">{pep.chemicalFormula}</td>
                      <td>{mzText(pep.mzCharge2, 3)}</td>
                      <td>{pep.hplcRetentionMin.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The Protein studio: the 3D card (viewer, superposition, Ramachandran figure) and the coiled-coil
 * and TM predictions, with the protein analysis. With coordinates to draw the 3D card comes first;
 * without them the analyses lead and the import-a-structure callout follows.
 */
export const ProteinStudio: React.FC<ProteinStudioProps> = ({
  activeDoc,
  proteinDocuments = [],
  selectedDocuments = [],
  selectedRange = null,
  onUpdateDocument,
  onStatusBanner,
}) => {
  const inWorkbench = useInWorkbench();
  // 4. Coiled-Coils, Transmembrane Topology & 3D PDB Aligner
  // The protein they analyse, and which one it is and why (BG-01M6VZRS): the card names it.
  const target = useMemo(() => targetProteinOf(activeDoc), [activeDoc]);
  const targetProtein = target.protein;

  // 3D structures: only coordinates a structure file holds (an imported .pdb / .cif, or a file
  // loaded here) are drawn or compared. Model A is this document's own chain; Model B is empty until the
  // user picks a different structure (in the list, or by ticking it in the table beside this
  // one), so no score is ever reported for a structure against itself or against a model the
  // app made up.
  const [loadedA, setLoadedA] = useState<{ name: string; text: string } | null>(null);
  const [loadedB, setLoadedB] = useState<{ name: string; text: string } | null>(null);
  // null until the user picks one (in the list, or by loading a file to compare): '' none | 'file' | document id
  const [pickedCompareWith, setCompareWith] = useState<string | null>(null);
  const [wholeStructure, setWholeStructure] = useState(false);
  const [pdbLoadError, setPdbLoadError] = useState<string | null>(null);
  const [fetchingRcsb, setFetchingRcsb] = useState(false);
  useEffect(() => {
    setLoadedA(null);
    setLoadedB(null);
    setCompareWith(null);
    setWholeStructure(false);
    setPdbLoadError(null);
    setFetchingRcsb(false);
  }, [activeDoc.id]);
  const citedPdbId = useMemo(() => {
    const rawMeta = String(activeDoc.docMetadata?.['PDB name'] ?? '').trim().toUpperCase();
    if (/^[0-9][A-Z0-9]{3}$/.test(rawMeta)) return rawMeta;
    const accMatch = /^([0-9][A-Z0-9]{3})(?:_[A-Z0-9]+)?$/i.exec((activeDoc.accession || '').trim());
    if (accMatch) return accMatch[1].toUpperCase();
    const nameMatch = /\(([0-9][A-Z0-9]{3})\)/.exec(activeDoc.name || '');
    return nameMatch ? nameMatch[1].toUpperCase() : null;
  }, [activeDoc.docMetadata, activeDoc.accession, activeDoc.name]);
  const fetchCitedRcsbStructure = async (pdbId: string) => {
    setFetchingRcsb(true);
    setPdbLoadError(null);
    try {
      for (const ext of ['cif', 'pdb'] as const) {
        const resp = await fetch(`https://files.rcsb.org/download/${pdbId}.${ext}`);
        if (!resp.ok) continue;
        const text = await resp.text();
        let caCount = 0;
        try {
          caCount = parsePdbCaCoordinates(text).length;
        } catch {
          caCount = 0;
        }
        const fileName = `${pdbId}.${ext}`;
        const problem = pdbTextLoadProblem(text, caCount, fileName);
        if (!problem) {
          setLoadedA({ text, name: fileName });
          setPdbLoadError(null);
          return;
        }
      }
      setPdbLoadError(`Model A not loaded: could not fetch 3D coordinates for ${pdbId} from RCSB PDB.`);
    } catch (err) {
      setPdbLoadError(
        `Model A not loaded: could not fetch ${pdbId} from RCSB PDB (${err instanceof Error ? err.message : String(err)}).`
      );
    } finally {
      setFetchingRcsb(false);
    }
  };
  useEffect(() => {
    if (
      !citedPdbId ||
      hasStructure(activeDoc) ||
      loadedA !== null ||
      (typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { VITEST?: unknown } }).env?.VITEST))
    ) {
      return;
    }
    void fetchCitedRcsbStructure(citedPdbId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citedPdbId, activeDoc.id]);
  const structureCandidates = useMemo(
    () => proteinDocuments.filter((d) => d.id !== activeDoc.id && hasStructure(d)),
    [proteinDocuments, activeDoc.id]
  );
  const tickedPartnerId = structureCandidates.find((d) => selectedDocuments.some((s) => s.id === d.id))?.id ?? '';
  const compareWith = pickedCompareWith ?? tickedPartnerId;
  const modelAAtoms = useMemo(() => {
    if (loadedA) { try { return parsePdbCaCoordinates(loadedA.text); } catch { return []; } }
    return structureAtomsOf(activeDoc, wholeStructure);
  }, [loadedA, activeDoc, wholeStructure]);
  const modelBDoc = structureCandidates.find((d) => d.id === compareWith);
  const modelBAtoms = useMemo(() => {
    if (compareWith === 'file' && loadedB) { try { return parsePdbCaCoordinates(loadedB.text); } catch { return []; } }
    return modelBDoc ? structureAtomsOf(modelBDoc) : [];
  }, [compareWith, loadedB, modelBDoc]);
  const modelALabel = loadedA ? loadedA.name : wholeStructure ? `${activeDoc.name} (all chains)` : activeDoc.name;
  const modelBLabel = compareWith === 'file' ? loadedB?.name ?? '' : modelBDoc?.name ?? '';
  // Model A's file, read in full for the viewer (ligands, the file's own secondary structure, the
  // selection) and for the Ramachandran plot of the open chain: this document's own chain, or the
  // first protein chain of a file loaded here.
  const modelAText = loadedA ? loadedA.text : structureTextOf(activeDoc);
  const modelAName = loadedA ? loadedA.name : activeDoc.name;
  const openChain = loadedA ? '' : String(activeDoc.docMetadata?.Chain ?? '').trim();
  const fullAtomModel = useMemo(() => fullAtomModelOf(modelAText, modelAName), [modelAText, modelAName]);
  // What the 3D card's badge says model A's coordinates are: read from its file, then from this
  // document's own record of the experiment, which does not describe a file loaded here.
  const coordinateSource = useMemo(
    () => coordinateSourceBadge(modelAText, loadedA !== null, activeDoc.docMetadata?.Experiment),
    [modelAText, loadedA, activeDoc.docMetadata]
  );
  const viewerFeature = useMemo(
    () => (!loadedA && openChain && selectedRange && modelAAtoms.length
      ? {
          chainId: openChain, sequence: activeDoc.sequence, start: selectedRange.start, end: selectedRange.end,
          name: selectedRange.label || 'Selection',
        }
      : undefined),
    [loadedA, openChain, selectedRange, modelAAtoms.length, activeDoc.sequence]
  );
  const ramachandran = useMemo(
    () => (fullAtomModel.structure && modelAAtoms.length ? chainRamachandran(modelAText, fullAtomModel.structure, openChain) : null),
    [fullAtomModel, modelAAtoms.length, modelAText, openChain]
  );
  const activeChainCount =useMemo(() => (hasStructure(activeDoc) ? structureChainCount(activeDoc) : 0), [activeDoc]);
  const loadPdbFile = async (
    file: File | undefined,
    model: 'A' | 'B',
    setText: (text: string, name: string) => void
  ) => {
    if (!file) return;
    try {
      const text = await file.text();
      let caCount = 0;
      try {
        caCount = parsePdbCaCoordinates(text).length;
      } catch {
        caCount = 0;
      }
      const problem = pdbTextLoadProblem(text, caCount, file.name);
      if (problem) {
        setPdbLoadError(`Model ${model} not loaded: ${problem}`);
        return;
      }
      setText(text, file.name);
      setPdbLoadError(null);
    } catch (err) {
      setPdbLoadError(
        `Model ${model} not loaded: could not read ${file.name} (${err instanceof Error ? err.message : String(err)}).`
      );
    }
  };

  const topologyReport = useMemo(
    () => predictCoiledCoilsAndTransmembrane(targetProtein),
    [targetProtein]
  );

  // Superposition only for two structures; with Model A alone the engine is still asked for its
  // intra-chain contacts (the self-comparison scores are not shown).
  const pdbAlignReport = useMemo(() => {
    if (!modelAAtoms.length) return null;
    const pdbA = caAtomsToPdb(modelAAtoms);
    return alignPdbStructuresKabsch(pdbA, modelBAtoms.length ? caAtomsToPdb(modelBAtoms) : pdbA);
  }, [modelAAtoms, modelBAtoms]);
  const comparing = modelAAtoms.length > 0 && modelBAtoms.length > 0;
  // Model B's full-atom model, read to name its paired chain by author id as model A's is.
  const modelBStructure = useMemo(
    () => (comparing
      ? fullAtomModelOf(compareWith === 'file' ? loadedB?.text ?? '' : structureTextOf(modelBDoc), modelBLabel).structure
      : null),
    [comparing, compareWith, loadedB, modelBDoc, modelBLabel]
  );
  const pairedChains = comparing && pdbAlignReport
    ? {
        a: pairedChainName(pdbAlignReport.chainA, modelAAtoms, fullAtomModel.structure),
        b: pairedChainName(pdbAlignReport.chainB, modelBAtoms, modelBStructure),
      }
    : null;


  // The coiled-coil and transmembrane predictions for the protein tab. They follow the 3D card when
  // model A has Cα coordinates to draw, measured or predicted, and lead it when it has none (US-01M6Q1ZR).
  const topologyCard = topologyReport && (
    <div className="studio-card">
      <div className="studio-card-header">
        <h3>Coiled-Coils (Lupas) &amp; Transmembrane Helix Topology</h3>
        <span className="badge-accent">{topologyReport.lengthAa} aa Analyzed</span>
        <span className="mbc-summary-note" data-mbc-topology-source>from {target.source}</span>
      </div>

      <div className="thermo-kpi-grid">
        <div className="kpi-box">
          <span className="kpi-label">N-Terminus Topology</span>
          <strong className="kpi-val">{topologyReport.nTerminusLocation}</strong>
        </div>
        <div className="kpi-box">
          <span className="kpi-label">Coiled-Coil Domains</span>
          <strong className="kpi-val">{topologyReport.coiledCoils.length}</strong>
        </div>
        <div className="kpi-box">
          <span className="kpi-label">Transmembrane Helices</span>
          <strong className="kpi-val">{topologyReport.transmembraneHelices.length}</strong>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <strong style={{ fontSize: 12 }}>
          Predicted Coiled-Coil Heptad Domains (Lupas Algorithm):
        </strong>
        <div className="plugin-list-box" style={{ maxHeight: 130, marginTop: 6 }}>
          {topologyReport.coiledCoils.length === 0 ? (
            <div className="plugin-row-item">
              No extended heptad coiled-coil domains (P ≥ 0.64) detected in {target.source}.
            </div>
          ) : (
            topologyReport.coiledCoils.map((cc) => (
              <div key={cc.id} className="plugin-row-item">
                <div className="plugin-row-text">
                  <strong>
                    AA {cc.startAa}..{cc.endAa} ({cc.lengthAa} aa)
                  </strong>{' '}
                  — Lupas P = <strong>{cc.lupasProbability}</strong> •{' '}
                  <code>{cc.heptadPeptide}</code>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <strong style={{ fontSize: 12 }}>
          Predicted Transmembrane Helices &amp; Membrane Orientation:
        </strong>
        <div className="plugin-list-box" style={{ maxHeight: 140, marginTop: 6 }}>
          {topologyReport.transmembraneHelices.length === 0 ? (
            <div className="plugin-row-item">
              Soluble globular protein profile (0 hydrophobic transmembrane spans ≥ 19 aa).
            </div>
          ) : (
            topologyReport.transmembraneHelices.map((tm) => (
              <div key={tm.id} className="plugin-row-item">
                <div className="plugin-row-text">
                  <strong>
                    {tm.helixLabel}: AA {tm.startAa}..{tm.endAa} ({tm.orientation})
                  </strong>{' '}
                  — Mean KD = {tm.meanHydropathyKd} • <code>{tm.sequence}</code>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );


  const structureGrid = (
    <>
      {/* =================================================================== */}
      {/* TAB 4: Coiled-Coils (Lupas), Transmembrane Topology & 3D PDB Aligner */}
      {/* =================================================================== */}
      {topologyReport && (
        <div className="studio-split-grid">
          {/* The figure leads when there is one: with coordinates the 3D card comes first and the
              predictions follow it; without them the predictions lead and the import callout follows. */}
          {!modelAAtoms.length && topologyCard}

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>3D Structure &amp; Superposition</h3>
              {modelAAtoms.length > 0 && (
                <span className="badge-accent">{comparing ? 'Kabsch Cα superposition' : coordinateSource}</span>
              )}
            </div>

            {!modelAAtoms.length ? (
              <div className="info-callout">
                {activeDoc.name} has no 3D coordinates. Import a structure file (.pdb or .cif, e.g. from the
                RCSB PDB or AlphaFold DB) to view it here, or load one below. Structures are never generated
                from a sequence.
              </div>
            ) : (
              <>
                <div className="form-grid-2col" style={{ marginBottom: 8 }}>
                  <label className="form-field">
                    <span>Compare with:</span>
                    <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
                      <option value="">— nothing (view only) —</option>
                      {structureCandidates.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                      {loadedB && <option value="file">{loadedB.name} (loaded file)</option>}
                    </select>
                  </label>
                  {/* the 3D tab's one setting, offered only for the record's own multi-chain
                      structure: with one chain, or a file loaded over it, there is nothing to set */}
                  {activeChainCount > 1 && !loadedA && (
                    <InspectorSection title="Structure" order={1}>
                      <label className="mbc-check-row" style={inWorkbench ? undefined : { alignSelf: 'end' }}>
                        <input type="checkbox" checked={wholeStructure} onChange={(e) => setWholeStructure(e.target.checked)} />
                        <span>Show all {activeChainCount} chains of the structure</span>
                      </label>
                    </InspectorSection>
                  )}
                </div>

                {comparing && pdbAlignReport && (
                  <div className="thermo-kpi-grid">
                    <div className="kpi-box">
                      <span className="kpi-label">Cα RMSD</span>
                      <strong className="kpi-val">{pdbAlignReport.rmsdAngstrom} Å</strong>
                    </div>
                    {superpositionTmScores(pdbAlignReport, pairedChains).map(({ by, value }) => (
                      <div key={by} className="kpi-box" title={`Zhang-Skolnick TM-score of the sequence-paired residues normalised by ${by}, searched over superpositions; the overlay and RMSD are the Kabsch fit of all pairs`}>
                        <span className="kpi-label">TM-score by {by}</span>
                        <strong className="kpi-val">{value.toFixed(3)}</strong>
                      </div>
                    ))}
                    <div className="kpi-box" title={pdbAlignReport.pairingMethod}>
                      <span className="kpi-label">Cα pairs (sequence alignment)</span>
                      <strong className="kpi-val">{pdbAlignReport.alignedResiduePairs}</strong>
                    </div>
                    <div className="kpi-box" title="Each chain by its author id, with its mmCIF label id beside it where the two differ">
                      <span className="kpi-label">Chain pair (A / B)</span>
                      <strong className="kpi-val">{pairedChains?.a} / {pairedChains?.b}</strong>
                    </div>
                    <div className="kpi-box">
                      <span className="kpi-label">Sequence identity</span>
                      <strong className="kpi-val">{(pdbAlignReport.sequenceIdentity * 100).toFixed(1)}%</strong>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 8 }}>
                  <ProteinStructure3DViewer
                    primaryAtoms={modelAAtoms}
                    overlayAtoms={comparing ? pdbAlignReport?.superimposedAtomsB : undefined}
                    contacts={pdbAlignReport?.intraChainContacts}
                    title={comparing ? `${modelALabel} vs ${modelBLabel}` : modelALabel}
                    rmsdAngstrom={comparing ? pdbAlignReport?.rmsdAngstrom : undefined}
                    tmScores={comparing && pdbAlignReport ? superpositionTmScores(pdbAlignReport, pairedChains) : undefined}
                    alignedResiduePairs={comparing ? pdbAlignReport?.alignedResiduePairs : undefined}
                    pairingMethod={comparing ? pdbAlignReport?.pairingMethod : undefined}
                    structure={fullAtomModel.structure ?? undefined}
                    structureText={modelAText || undefined}
                    activeChainId={wholeStructure ? undefined : openChain || undefined}
                    selectedFeature={viewerFeature}
                    heightPx={300}
                  />
                </div>

                {comparing && pdbAlignReport && (
                  <div className="info-callout" style={{ marginTop: 8 }}>
                    <strong>Verdict:</strong> {pdbAlignReport.structuralSimilarityVerdict}. Chain {pairedChains?.a} of{' '}
                    {modelALabel} is paired with chain {pairedChains?.b} of {modelBLabel} by sequence
                    alignment: {pdbAlignReport.pairingMethod}. {pdbAlignReport.alignedResiduePairs} of their{' '}
                    {pdbAlignReport.alignedSequenceA.replace(/-/g, '').length} vs{' '}
                    {pdbAlignReport.alignedSequenceB.replace(/-/g, '').length} residues are paired,{' '}
                    {(pdbAlignReport.sequenceIdentity * 100).toFixed(1)}% of the pairs identical. Each TM-score is
                    Zhang and Skolnick&apos;s for these paired residues, normalised by the chain it names and searched
                    over superpositions; the overlay and RMSD are the Kabsch fit of all pairs, so a TM-score may come
                    from another superposition. Align Structures… aligns the chains by structure.
                  </div>
                )}

                {fullAtomModel.note && (
                  <div className="info-callout" style={{ marginTop: 8 }}>{fullAtomModel.note}</div>
                )}

                {ramachandran && (
                  <div style={{ marginTop: 10 }}>
                    {'error' in ramachandran ? (
                      <div className="info-callout" role="status">
                        Ramachandran plot not drawn: {ramachandran.error}.
                      </div>
                    ) : (
                      <RamachandranPlot
                        report={ramachandran.report}
                        model={ramachandran.model}
                        name={modelAName}
                        onStatus={onStatusBanner}
                      />
                    )}
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 11.5 }}>
              {citedPdbId && !modelAAtoms.length && (
                <button
                  type="button"
                  className="btn-primary-sm"
                  disabled={fetchingRcsb}
                  onClick={() => void fetchCitedRcsbStructure(citedPdbId)}
                >
                  {fetchingRcsb ? `Fetching ${citedPdbId}…` : `Fetch ${citedPdbId} from RCSB PDB`}
                </button>
              )}
              <label className="btn-secondary btn-xs" style={{ cursor: 'pointer' }}>
                {modelAAtoms.length ? 'Replace structure (.pdb / .cif)' : 'Load structure (.pdb / .cif)'}
                <input
                  type="file"
                  accept=".pdb,.cif,.mmcif,.ent,.txt"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const input = e.currentTarget;
                    await loadPdbFile(input.files?.[0], 'A', (text, name) => setLoadedA({ text, name }));
                    input.value = '';
                  }}
                />
              </label>
              {modelAAtoms.length > 0 && (
                <label className="btn-secondary btn-xs" style={{ cursor: 'pointer' }}>
                  Load structure to compare (.pdb / .cif)
                  <input
                    type="file"
                    accept=".pdb,.cif,.mmcif,.ent,.txt"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      await loadPdbFile(input.files?.[0], 'B', (text, name) => { setLoadedB({ text, name }); setCompareWith('file'); });
                      input.value = '';
                    }}
                  />
                </label>
              )}
              {loadedA && (
                <button type="button" className="btn-secondary btn-xs" onClick={() => setLoadedA(null)}>
                  Back to {activeDoc.name}
                </button>
              )}
            </div>

            {pdbLoadError && (
              <div className="info-callout" role="alert" style={{ marginTop: 8 }}>
                {pdbLoadError}
              </div>
            )}
          </div>
          {modelAAtoms.length > 0 && topologyCard}
        </div>
      )}
    </>
  );

  return (
    <div className="hybrid-studio-wrapper" aria-label="Protein & 3D">
      {modelAAtoms.length > 0 && structureGrid}
      <ProteinAnalysisPanel doc={activeDoc} onUpdateDocument={onUpdateDocument} />
      {!modelAAtoms.length && structureGrid}
    </div>
  );
};
