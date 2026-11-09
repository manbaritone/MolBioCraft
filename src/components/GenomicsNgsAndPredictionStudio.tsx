// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import {
  alignPdbStructuresKabsch,
  callFreeBayesVariants,
  classifySequenceTaxonomy,
  complementOnlySequence,
  DeNovoAssemblerEngine,
  extractTargetProteinSequence,
  findCpGIslands,
  findGenomicRepeats,
  GenBankSubmissionMeta,
  type GenomicRepeatReport,
  mutateAndShuffleSequence,
  MutateShuffleOptions,
  NgsMapperEngine,
  parsePdbCaCoordinates,
  type PdbCaAtom,
  predictCoiledCoilsAndTransmembrane,
  predictGlimmerMicrobialGenes,
  prepareGenBankSubmissionPackage,
  reverseOnlySequence,
  runBbdukReadTrimming,
  runDeNovoAssembly,
  runNgsReferenceMapping,
  runWholeGenomeSynteny,
  scanMicrosatelliteStrs,
} from '../core/genomicsAndStructureSuite';
import { caAtomsToPdb, hasStructure, structureAtomsOf, structureChainCount, structureTextOf } from '../core/structureModels';
import { chainOf, parseStructure, type Structure } from '../core/structureView';
import { backboneTorsions, plottedModelOf, type BackboneTorsionReport, type PlottedModel } from '../core/ramachandran';
import { SequenceDocument, SequenceFeature } from '../types/bio';
import {
  alignLargeGenomesMinimizerChainRust,
  annotateVcfCodingConsequencesNoodlesRust,
  scanJasparPssmMotifsRust,
  segmentGenomeHmmViterbiRust,
  type HmmGenomeSegmentationReport,
  type PssmMotifScanReport,
} from '../lib/rustBioEngine';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { MolBioDocTypeIcon, MolBioMenuGlyph } from './MolBioIcons';
import { ProteinStructure3DViewer } from './ProteinStructure3DViewer';
import { RamachandranPlot } from './RamachandranPlot';
import { pdbTextLoadProblem, trimmedReadSaveBlockReason } from '../core/ngsTrimSave';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import { ResultWarnings } from './ResultWarnings';
import { subsetNote } from './CircularPlasmidMap';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';

import { genomicsTabsForDocument, type GenomicsSubTabId } from '../core/analysisContext';
export type GenomicsSuiteSubTab = GenomicsSubTabId;

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
const TABLE_ROWS_SHOWN = 250;

/**
 * The most rows the variant-call, HGVS-consequence and HMM-segment tables draw, the first in
 * sequence order (BG-01M6S1AA). The variant and segment captions give the total, as "first N of
 * M" when the table shows fewer; the HGVS table's caption counts impact tiers, so a note beside it
 * says how many records it lists when that is fewer than there are.
 */
const VARIANT_ROWS_SHOWN = 25;
const CONSEQUENCE_ROWS_SHOWN = 20;
const SEGMENT_ROWS_SHOWN = 24;

/**
 * A list's count as its caption gives it: the total when every item is shown, or "top 24 of 40"
 * ("first 250 of 400" for a list in sequence order) when the list shows fewer than were found.
 */
function listCountLabel(shown: number, total: number, rank: 'top' | 'first'): string {
  const n = (v: number) => v.toLocaleString('en-US');
  return shown < total ? `${rank} ${n(shown)} of ${n(total)}` : n(total);
}

/**
 * The repeat list's count as its caption gives it (BG-01M6SQ9T): the arm length the shown scan was
 * run at, then the count as for any ranked list, or, when the scan stopped at its copy-pair bound,
 * "80 of at least M, the longest found before the scan stopped", since those need not be the
 * longest repeats in the sequence.
 */
function repeatListLabel(report: GenomicRepeatReport): string {
  const n = (v: number) => v.toLocaleString('en-US');
  const count = report.totalIsLowerBound
    ? `${n(report.repeats.length)} of at least ${n(report.totalRepeats)}, the longest found before the scan stopped`
    : listCountLabel(report.repeats.length, report.totalRepeats, 'top');
  return `arms ≥ ${report.minArmBp} bp, ${count}`;
}

/**
 * The Min Repeat Arm box (BG-01M6SQ9T, D0055): the repeat scan runs this long after the last
 * keystroke, or at once on Enter or when the box loses focus, and only at a whole number of bases
 * from the least to the most arm length here.
 */
const REPEAT_ARM_SETTLE_MS = 400;
const MIN_REPEAT_ARM_BP = 8;
const MAX_REPEAT_ARM_BP = 24;

/** The Min Repeat Arm box's text as an arm length to scan at, or null when it is not one. */
function repeatArmOf(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const arm = Number(text);
  return arm >= MIN_REPEAT_ARM_BP && arm <= MAX_REPEAT_ARM_BP ? arm : null;
}

/** What a genome-scale scan is computed from, field by field; the genome names are kept to say so. */
type ScanInput = Readonly<Record<string, string | number>>;
type SyntenyInput = { genomeA: string; seqA: string; genomeB: string; seqB: string; engine: 'Mauve' | 'LASTZ' };
type GenomeScanInput = { genome: string; seq: string; min: number };

const sameScanInput = (a: ScanInput, b: ScanInput) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Object.is(a[k], b[k]));

const syntenyScan = (i: SyntenyInput) => runWholeGenomeSynteny(i.seqA, i.seqB, i.engine);
const geneScan = (i: GenomeScanInput) => predictGlimmerMicrobialGenes(i.seq, i.min);
const cpgScan = (i: GenomeScanInput) => findCpGIslands(i.seq, i.min);

/**
 * Runs `run` in a task of its own once the next frame has been painted (where there are no frames,
 * as outside a browser, in the next task); the function returned cancels it.
 */
function afterNextPaint(run: () => void): () => void {
  let frame: number | null = null;
  let task: ReturnType<typeof setTimeout> | null = null;
  const queue = () => {
    frame = null;
    task = setTimeout(run, 0);
  };
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(queue);
  else queue();
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (task !== null) clearTimeout(task);
  };
}

/**
 * A genome-scale scan (whole-genome synteny, gene prediction, the CpG island scan) the studio never
 * runs while it renders (BG-01M6T6HW): on unrelated 5 Mb genomes synteny alone takes hundreds of
 * milliseconds (D0061). Returns the landed result and the input it was computed for, or null while
 * there is none for `input`, which the panel shows as 'Scanning…'. The scan runs in a task of its
 * own after the frame that shows that has been painted. A result is shown only under the input it
 * was computed from: an input changed while its scan waits cancels it, and a result that returns
 * after its input changed is dropped. `input` is null while the scan's sub-view is not shown; the
 * last result shows again, with no new run, when its input comes back. A scan that throws, throws
 * here, in render, as it did when it ran in render.
 */
function useScanAfterPaint<I extends ScanInput, R>(input: I | null, scan: (input: I) => R): { input: I; result: R } | null {
  const [landed, setLanded] = useState<{ input: I; result?: R; failure?: { error: unknown } } | null>(null);
  const current = input && landed && sameScanInput(landed.input, input) ? landed : null;
  const waiting = input !== null && current === null;
  useEffect(() => {
    if (!input || !waiting) return undefined;
    let dropped = false;
    const cancel = afterNextPaint(() => {
      let outcome: { input: I; result?: R; failure?: { error: unknown } };
      try {
        outcome = { input, result: scan(input) };
      } catch (error) {
        outcome = { input, failure: { error } };
      }
      if (!dropped) setLanded(outcome);
    });
    return () => {
      dropped = true;
      cancel();
    };
  }, [input, waiting, scan]);
  if (current?.failure) throw current.failure.error;
  return current ? { input: current.input, result: current.result as R } : null;
}

/** What a scan's panel shows in place of its numbers while the scan waits or runs. */
const ScanningNote = () => (
  <div className="mbc-opdlg-progress" role="status">
    <Loader2 size={14} className="mbc-spin" aria-hidden="true" />
    <span>Scanning…</span>
  </div>
);

const bp = (seq: string) => `${seq.length.toLocaleString('en-US')} bp`;

/**
 * An engine reply with the D0005 `warnings` it carries: for the HMM segmentation, the TF motif scan
 * and the minimizer chainer, the bases covered when the engine stopped short of the sequence's end
 * and any list it cut. The engine's TypeScript reply types do not declare the field yet.
 */
type EngineCoverage<T> = T & { warnings?: string[] };

interface GenomicsNgsAndPredictionStudioProps {
  activeDoc: SequenceDocument;
  /** Candidate nucleotide documents for reference / read / partner pickers (no trashed or protein records). */
  documents: SequenceDocument[];
  /** Documents ticked in the table; when 2+ are ticked they are the de novo assembly inputs. */
  selectedDocuments?: SequenceDocument[];
  /** Live protein documents; the 3D aligner takes its partner model B from these. */
  proteinDocuments?: SequenceDocument[];
  /**
   * The selection on the active document's sequence (clicking a feature selects its range): the 3D
   * viewer highlights its residues on the document's own chain.
   */
  selectedRange?: { start: number; end: number; label?: string } | null;
  initialSubTab?: GenomicsSuiteSubTab;
  /** Incremented on every menu request so re-requesting the same sub-tab re-applies it. */
  commandNonce?: number;
  onCreateDocument: (newDoc: SequenceDocument) => void;
  onUpdateActiveSequence: (newSeq: string, summary: string) => void;
  /**
   * Coordinate-aware strand transforms. When provided, the in-place
   * Complement/Reverse buttons delegate to them so features and primers are
   * mirrored together with the sequence (a raw sequence swap would leave every
   * annotation pointing at the wrong bases).
   */
  onComplementOnlyActiveDoc?: () => void;
  onReverseOnlyActiveDoc?: () => void;
  onAppendFeatures: (features: SequenceFeature[], summary: string) => void;
  /** Append features to a specific document (e.g. variants called against the reference, not the active doc). */
  onAppendFeaturesToDocument?: (docId: string, features: SequenceFeature[], summary: string) => void;
  onStatusBanner?: (msg: string) => void;
}

export const GenomicsNgsAndPredictionStudio: React.FC<
  GenomicsNgsAndPredictionStudioProps
> = ({
  activeDoc,
  documents,
  selectedDocuments = [],
  proteinDocuments = [],
  selectedRange = null,
  initialSubTab,
  commandNonce,
  onCreateDocument,
  onUpdateActiveSequence,
  onComplementOnlyActiveDoc,
  onReverseOnlyActiveDoc,
  onAppendFeatures,
  onAppendFeaturesToDocument,
  onStatusBanner,
}) => {
  const availableTabs = genomicsTabsForDocument(activeDoc);
  const [selectedSubTab, setSubTab] = useState<GenomicsSuiteSubTab>(initialSubTab ?? availableTabs[0]);
  const subTab = availableTabs.includes(selectedSubTab) ? selectedSubTab : availableTabs[0];

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab, commandNonce]);

  // In the workbench each sub-tab's parameters are sections of App's shared inspector, titled
  // "Genomics Controls" ("3D Structure Controls" for a protein record), while the documents compared
  // and the GenBank submission fields stay in the cards. Every value stays this studio's state, so it
  // is kept across sub-tab switches and an inspector close. Drawn on its own, the studio keeps every
  // setting where it sits (US-01M6TAKR).
  const inWorkbench = useInWorkbench();
  /**
   * A setting drawn inline beside its card's buttons, label and box side by side, on its own; in the
   * workbench a labelled field of its section, as the inspector's other settings are.
   */
  const inlineSetting = (name: string, gap: number, fontSize: number, control: React.ReactElement) =>
    inWorkbench ? (
      <label className="form-field">
        <span>{name}</span>
        {control}
      </label>
    ) : (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap, fontSize }}>
        <span>{name}</span>
        {control}
      </label>
    );
  /** An inline box's fixed width on its own; in the inspector a field takes its section's width. */
  const inlineBoxWidth = (width: number) => (inWorkbench ? undefined : { width });

  // Accessible caption IDs for responsive sticky-header tables
  const contigTableId = useId();
  const lcbTableId = useId();
  const variantTableId = useId();
  const strTableId = useId();
  const glimmerTableId = useId();
  const cpgTableId = useId();
  const repeatTableId = useId();

  // 1. NGS Trim, Map & De Novo Assembly state
  const [bbdukKmer, setBbdukKmer] = useState<number>(11);
  const [bbdukMinQ, setBbdukMinQ] = useState<number>(20);
  const [ngsMapper, setNgsMapper] = useState<NgsMapperEngine>('Minimap2');
  const [mapRefDocId, setMapRefDocId] = useState<string>(documents[0]?.id ?? activeDoc.id);
  const [mapReadDocId, setMapReadDocId] = useState<string>(
    documents.find((d) => d.chromatogram || d.sequence.length < 1500)?.id ?? activeDoc.id
  );
  const [assembler, setAssembler] = useState<DeNovoAssemblerEngine>('CAP3');
  const [assemblyOverlap, setAssemblyOverlap] = useState<number>(19);

  // 2. Whole-Genome Synteny, FreeBayes Variants, Microsatellite STRs & 16S/ITS Taxonomy
  const [syntenyEngine, setSyntenyEngine] = useState<'Mauve' | 'LASTZ'>('Mauve');
  const [genomePartnerId, setGenomePartnerId] = useState<string>(
    documents.find((d) => d.id !== activeDoc.id)?.id ?? activeDoc.id
  );
  const [minStrCopies, setMinStrCopies] = useState<number>(4);

  // 3. Glimmer Microbial Genes, CpG Islands, Genomic Repeats, Viterbi HMM & JASPAR PSSM Motifs
  const [glimmerMinAa, setGlimmerMinAa] = useState<number>(45);
  const [cpgMinLen, setCpgMinLen] = useState<number>(200);
  const [repeatMinArm, setRepeatMinArm] = useState<number>(10);
  // What the Min Repeat Arm box holds while it is typed in; the scan moves to it once it settles.
  const [repeatArmText, setRepeatArmText] = useState<string>('10');
  const [pssmMinRelScore, setPssmMinRelScore] = useState<number>(0.84);

  useEffect(() => {
    const arm = repeatArmOf(repeatArmText);
    if (arm === null || arm === repeatMinArm) return undefined;
    const timer = setTimeout(() => setRepeatMinArm(arm), REPEAT_ARM_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [repeatArmText, repeatMinArm]);
  /** Enter or blur: scan at the box's arm now, or, when it holds no arm to scan at, show the one in use. */
  const settleRepeatArm = () => {
    const arm = repeatArmOf(repeatArmText);
    if (arm === null) setRepeatArmText(String(repeatMinArm));
    else setRepeatMinArm(arm);
  };

  // 4. Coiled-Coils, Transmembrane Topology & 3D PDB Aligner
  const targetProtein = useMemo(() => extractTargetProteinSequence(activeDoc), [activeDoc]);
  const partnerDoc = useMemo(
    () => documents.find((d) => d.id === genomePartnerId) ?? documents[0] ?? activeDoc,
    [documents, genomePartnerId, activeDoc]
  );
  const partnerProtein = useMemo(() => extractTargetProteinSequence(partnerDoc), [partnerDoc]);

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
      subTab !== 'protein-3d' ||
      !citedPdbId ||
      hasStructure(activeDoc) ||
      loadedA !== null ||
      (typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { VITEST?: unknown } }).env?.VITEST))
    ) {
      return;
    }
    void fetchCitedRcsbStructure(citedPdbId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, citedPdbId, activeDoc.id]);
  const structureCandidates = useMemo(
    () => proteinDocuments.filter((d) => d.id !== activeDoc.id && hasStructure(d)),
    [proteinDocuments, activeDoc.id]
  );
  const tickedPartnerId = structureCandidates.find((d) => selectedDocuments.some((s) => s.id === d.id))?.id ?? '';
  const compareWith = pickedCompareWith ?? tickedPartnerId;
  const modelAAtoms = useMemo(() => {
    if (subTab !== 'protein-3d') return [];
    if (loadedA) { try { return parsePdbCaCoordinates(loadedA.text); } catch { return []; } }
    return structureAtomsOf(activeDoc, wholeStructure);
  }, [subTab, loadedA, activeDoc, wholeStructure]);
  const modelBDoc = structureCandidates.find((d) => d.id === compareWith);
  const modelBAtoms = useMemo(() => {
    if (subTab !== 'protein-3d') return [];
    if (compareWith === 'file' && loadedB) { try { return parsePdbCaCoordinates(loadedB.text); } catch { return []; } }
    return modelBDoc ? structureAtomsOf(modelBDoc) : [];
  }, [subTab, compareWith, loadedB, modelBDoc]);
  const modelALabel = loadedA ? loadedA.name : wholeStructure ? `${activeDoc.name} (all chains)` : activeDoc.name;
  const modelBLabel = compareWith === 'file' ? loadedB?.name ?? '' : modelBDoc?.name ?? '';
  // Model A's file, read in full for the viewer (ligands, the file's own secondary structure, the
  // selection) and for the Ramachandran plot of the open chain: this document's own chain, or the
  // first protein chain of a file loaded here.
  const modelAText = subTab === 'protein-3d' ? (loadedA ? loadedA.text : structureTextOf(activeDoc)) : '';
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
  const activeChainCount =useMemo(() => (subTab === 'protein-3d' && hasStructure(activeDoc) ? structureChainCount(activeDoc) : 0), [subTab, activeDoc]);
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

  // 5. Transform, Mutate/Shuffle & NCBI GenBank Submission
  const [mutateMode, setMutateMode] =
    useState<MutateShuffleOptions['mode']>('shuffle-dinucleotide');
  const [mutationRatePct, setMutationRatePct] = useState<number>(2.5);
  const [mutateSeed, setMutateSeed] = useState<number>(20261030);
  const [gbMeta, setGbMeta] = useState<GenBankSubmissionMeta>({
    organism: 'Escherichia coli',
    strainOrIsolate: 'K-12 DH5alpha',
    molType: 'genomic DNA',
    geneticCodeId: 11,
  });

  // Memoized analytical reports
  const mapRefDoc = useMemo(
    () => documents.find((d) => d.id === mapRefDocId) ?? activeDoc,
    [documents, mapRefDocId, activeDoc]
  );
  const mapReadDoc = useMemo(
    () => documents.find((d) => d.id === mapReadDocId) ?? activeDoc,
    [documents, mapReadDocId, activeDoc]
  );

  const bbdukReport = useMemo(
    () => subTab === 'ngs-assembly' ?
      runBbdukReadTrimming(activeDoc.sequence, activeDoc.chromatogram?.phredScores, {
        kmerLen: bbdukKmer,
        minPhredQuality: bbdukMinQ,
      }) : null,
    [subTab, activeDoc, bbdukKmer, bbdukMinQ]
  );

  const ngsMapReport = useMemo(
    () => subTab === 'ngs-assembly' ? runNgsReferenceMapping(mapRefDoc.sequence, mapReadDoc.sequence, ngsMapper) : null,
    [subTab, mapRefDoc, mapReadDoc, ngsMapper]
  );

  // Assemble the reads the user ticked (2+ nucleotide documents). Without a
  // selection, fall back to the first 8 candidate documents and say so — it
  // previously always took the first 8 workspace documents, including trashed
  // and protein records.
  const assemblyInputDocs = useMemo(() => {
    const ticked = selectedDocuments.filter((d) => d.moleculeType !== 'Protein' && d.sequence.length > 0);
    return ticked.length >= 2 ? { docs: ticked, fromSelection: true } : { docs: documents.slice(0, 8), fromSelection: false };
  }, [selectedDocuments, documents]);
  const assemblyReport = useMemo(
    () => subTab === 'ngs-assembly' ?
      runDeNovoAssembly(
        assemblyInputDocs.docs.map((d) => ({ name: d.name, sequence: d.sequence })),
        assembler,
        assemblyOverlap
      ) : null,
    [subTab, assemblyInputDocs, assembler, assemblyOverlap]
  );

  // Synteny, gene prediction and the CpG island scan run after the frame showing 'Scanning…' has
  // been painted, never in render (BG-01M6T6HW); each result names the input it was computed for.
  const syntenyInput = useMemo(
    (): SyntenyInput | null => subTab === 'genome-variants'
      ? { genomeA: activeDoc.name, seqA: activeDoc.sequence, genomeB: partnerDoc.name, seqB: partnerDoc.sequence, engine: syntenyEngine }
      : null,
    [subTab, activeDoc.name, activeDoc.sequence, partnerDoc.name, partnerDoc.sequence, syntenyEngine]
  );
  const synteny = useScanAfterPaint(syntenyInput, syntenyScan);
  const syntenyReport = synteny?.result ?? null;

  const freeBayesReport = useMemo(
    () => subTab === 'genome-variants' ? callFreeBayesVariants(mapRefDoc.name, mapRefDoc.sequence, mapReadDoc.sequence) : null,
    [subTab, mapRefDoc, mapReadDoc]
  );
  const freeBayesWarnings: readonly string[] =
    (freeBayesReport as (typeof freeBayesReport & { warnings?: readonly string[] }) | null)?.warnings ?? [];

  // The chainer, the HMM segmentation and the TF scan are handed the whole sequence: the engine
  // covers it up to its own caps and says in `warnings` which bases it covered when it stopped
  // short (BG-01M6S1C1). They used to be handed the first 120, 100 and 60 kb, unannounced. The
  // chainer counts a chain only from `minChainAnchors` anchors, the fewest that chance seed matches
  // between genomes of these lengths are not expected to chain; its chains, coverage, identity and
  // inversion count are those chains alone.
  const minimizerChainReport = useMemo((): EngineCoverage<ReturnType<typeof alignLargeGenomesMinimizerChainRust>> & { totalChains?: number; minChainAnchors?: number } | null => {
    if (subTab !== 'genome-variants') return null;
    const seqA = activeDoc.moleculeType === 'Protein' ? '' : activeDoc.sequence;
    const seqB = partnerDoc.moleculeType === 'Protein' ? '' : partnerDoc.sequence;
    if (seqA.length < 25 || seqB.length < 25) return null;
    return alignLargeGenomesMinimizerChainRust(seqA, seqB, 8, 13, 64);
  }, [subTab, activeDoc.moleculeType, activeDoc.sequence, partnerDoc.moleculeType, partnerDoc.sequence]);

  const vcfConsequenceReport = useMemo(() => {
    if (subTab !== 'genome-variants') return null;
    if (mapRefDoc.moleculeType === 'Protein' || !freeBayesReport?.vcfText.trim()) return null;
    return annotateVcfCodingConsequencesNoodlesRust(
      mapRefDoc.sequence,
      mapRefDoc.features,
      freeBayesReport.vcfText,
      11
    );
  }, [subTab, mapRefDoc.moleculeType, mapRefDoc.sequence, mapRefDoc.features, freeBayesReport?.vcfText]);

  const hmmSegmentationReport = useMemo((): EngineCoverage<HmmGenomeSegmentationReport> | null => {
    if (subTab !== 'genes-cpg-repeats') return null;
    if (activeDoc.moleculeType === 'Protein' || activeDoc.sequence.length < 30) return null;
    return segmentGenomeHmmViterbiRust(activeDoc.sequence);
  }, [subTab, activeDoc.moleculeType, activeDoc.sequence]);

  const pssmMotifReport = useMemo((): EngineCoverage<PssmMotifScanReport> | null => {
    if (subTab !== 'genes-cpg-repeats') return null;
    if (activeDoc.moleculeType === 'Protein' || activeDoc.sequence.length < 12) return null;
    return scanJasparPssmMotifsRust(activeDoc.sequence, pssmMinRelScore);
  }, [subTab, activeDoc.moleculeType, activeDoc.sequence, pssmMinRelScore]);

  const strLoci = useMemo(
    () => subTab === 'genome-variants' ? scanMicrosatelliteStrs(activeDoc.sequence, minStrCopies) : null,
    [subTab, activeDoc.sequence, minStrCopies]
  );

  const taxonomyHits = useMemo(
    () => subTab === 'genome-variants' ? classifySequenceTaxonomy(activeDoc.sequence) : null,
    [subTab, activeDoc.sequence]
  );

  const geneInput = useMemo(
    (): GenomeScanInput | null => subTab === 'genes-cpg-repeats' ? { genome: activeDoc.name, seq: activeDoc.sequence, min: glimmerMinAa } : null,
    [subTab, activeDoc.name, activeDoc.sequence, glimmerMinAa]
  );
  const genes = useScanAfterPaint(geneInput, geneScan);
  const glimmerReport = genes?.result ?? null;

  const cpgInput = useMemo(
    (): GenomeScanInput | null => subTab === 'genes-cpg-repeats' ? { genome: activeDoc.name, seq: activeDoc.sequence, min: cpgMinLen } : null,
    [subTab, activeDoc.name, activeDoc.sequence, cpgMinLen]
  );
  const cpg = useScanAfterPaint(cpgInput, cpgScan);
  const cpgReport = cpg?.result ?? null;

  const repeatReport = useMemo(
    () => subTab === 'genes-cpg-repeats' ? findGenomicRepeats(activeDoc.sequence, repeatMinArm) : null,
    [subTab, activeDoc.sequence, repeatMinArm]
  );

  const topologyReport = useMemo(
    () => subTab === 'protein-3d' ? predictCoiledCoilsAndTransmembrane(targetProtein) : null,
    [subTab, targetProtein]
  );

  // Superposition only for two structures; with Model A alone the engine is still asked for its
  // intra-chain contacts (the self-comparison scores are not shown).
  const pdbAlignReport = useMemo(() => {
    if (subTab !== 'protein-3d' || !modelAAtoms.length) return null;
    const pdbA = caAtomsToPdb(modelAAtoms);
    return alignPdbStructuresKabsch(pdbA, modelBAtoms.length ? caAtomsToPdb(modelBAtoms) : pdbA);
  }, [subTab, modelAAtoms, modelBAtoms]);
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

  const mutateReport = useMemo(
    () => subTab === 'transform-submit' ?
      mutateAndShuffleSequence(activeDoc.sequence, {
        mode: mutateMode,
        mutationRatePercent: mutationRatePct,
        seed: mutateSeed,
      }) : null,
    [subTab, activeDoc.sequence, mutateMode, mutationRatePct, mutateSeed]
  );

  const genbankSubmission = useMemo(
    () => subTab === 'transform-submit' ? prepareGenBankSubmissionPackage(activeDoc, gbMeta) : null,
    [subTab, activeDoc, gbMeta]
  );

  const triggerTextDownload = (filename: string, content: string) => {
    const outcome = saveWorkbenchFile(filename, content);
    if (outcome === 'downloaded') onStatusBanner?.(`Exported ${filename}`);
    else if (!outcome) onStatusBanner?.(`Could not export ${filename}: no save path is available here.`);
  };

  // The coiled-coil and transmembrane predictions for the protein tab. They follow the 3D card when
  // model A has Cα coordinates to draw, measured or predicted, and lead it when it has none (US-01M6Q1ZR).
  const topologyCard = topologyReport && (
    <div className="studio-card">
      <div className="studio-card-header">
        <h3>Coiled-Coils (Lupas) &amp; Transmembrane Helix Topology</h3>
        <span className="badge-accent">{topologyReport.lengthAa} aa Analyzed</span>
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
              No extended heptad coiled-coil domains (P ≥ 0.64) detected in primary ORF.
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

  return (
    <div className="hybrid-studio-wrapper">
      {/* Sub-navigation bar covering all built-in Genomics, NGS, Prediction & Structure tools */}
      <div className="studio-card-header" style={{ marginBottom: 8 }}>
        <ScrollableMenuStrip
          className="mbc-scroll-strip--pills"
          trackClassName="cloning-method-tabs"
          role="tablist"
          ariaLabel="Genomics and Structure Modules"
          alwaysShowArrows={availableTabs.length > 1}
          activeKey={subTab}
          enableSpatialArrowNav
          activateOnSpatialFocus
          prevAriaLabel="Slide genomics modules left"
          nextAriaLabel="Slide genomics modules right"
        >
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('ngs-assembly')}
            tabIndex={subTab === 'ngs-assembly' ? 0 : -1}
            aria-selected={subTab === 'ngs-assembly'}
            className={`method-tab-btn ${subTab === 'ngs-assembly' ? 'active' : ''}`}
            onClick={() => setSubTab('ngs-assembly')}
          >
            <MolBioMenuGlyph glyph="map-to-ref" size={13} />
            <span>NGS Trim, Map &amp; Assemble</span>
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('genome-variants')}
            tabIndex={subTab === 'genome-variants' ? 0 : -1}
            aria-selected={subTab === 'genome-variants'}
            className={`method-tab-btn ${subTab === 'genome-variants' ? 'active' : ''}`}
            onClick={() => setSubTab('genome-variants')}
          >
            <MolBioMenuGlyph glyph="synteny-genome" size={13} />
            <span>Whole-Genome, Variants, STR &amp; 16S</span>
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('genes-cpg-repeats')}
            tabIndex={subTab === 'genes-cpg-repeats' ? 0 : -1}
            aria-selected={subTab === 'genes-cpg-repeats'}
            className={`method-tab-btn ${subTab === 'genes-cpg-repeats' ? 'active' : ''}`}
            onClick={() => setSubTab('genes-cpg-repeats')}
          >
            <MolBioMenuGlyph glyph="cpg-repeats" size={13} />
            <span>Glimmer Genes, CpG &amp; Repeats</span>
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('protein-3d')}
            tabIndex={subTab === 'protein-3d' ? 0 : -1}
            aria-selected={subTab === 'protein-3d'}
            className={`method-tab-btn ${subTab === 'protein-3d' ? 'active' : ''}`}
            onClick={() => setSubTab('protein-3d')}
          >
            <MolBioDocTypeIcon kind="protein" visualOverride="structure-3d" size={13} />
            <span>Coiled-Coils, Transmembrane &amp; 3D PDB</span>
          </button>
          <button
            type="button"
            role="tab"
            hidden={!availableTabs.includes('transform-submit')}
            tabIndex={subTab === 'transform-submit' ? 0 : -1}
            aria-selected={subTab === 'transform-submit'}
            className={`method-tab-btn ${subTab === 'transform-submit' ? 'active' : ''}`}
            onClick={() => setSubTab('transform-submit')}
          >
            <MolBioMenuGlyph glyph="database-ncbi" size={13} />
            <span>Transform, Mutate/Shuffle &amp; GenBank Submit</span>
          </button>
        </ScrollableMenuStrip>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: NGS Read Trimming (BBDuk), Reference Mapping & De Novo Assembly */}
      {/* =================================================================== */}
      {subTab === 'ngs-assembly' && bbdukReport && ngsMapReport && assemblyReport && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>BBDuk Adapter/Quality Trimmer &amp; Reference Read Mapper</h3>
              <span className="badge-accent">BBDuk • Minimap2 • Bowtie2 • BBMap</span>
            </div>

            <InspectorSection title="Read Trimming" order={1}>
              <div className="form-grid-2col">
                <label className="form-field">
                  <span>BBDuk Adapter K-mer Length (k):</span>
                  <input
                    type="number"
                    min={8}
                    max={19}
                    value={bbdukKmer}
                    onChange={(e) => setBbdukKmer(Number(e.target.value) || 11)}
                  />
                </label>
                <label className="form-field">
                  <span>Min End Phred Quality (Q):</span>
                  <input
                    type="number"
                    min={5}
                    max={40}
                    value={bbdukMinQ}
                    onChange={(e) => setBbdukMinQ(Number(e.target.value) || 20)}
                  />
                </label>
              </div>
            </InspectorSection>

            <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
              <div className="kpi-box">
                <span className="kpi-label">Trimmed Read ({activeDoc.name})</span>
                <strong className="kpi-val">
                  {bbdukReport.trimmedLengthBp.toLocaleString()} /{' '}
                  {bbdukReport.originalLengthBp.toLocaleString()} bp ({bbdukReport.retainedPercent}%)
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">5&apos; / 3&apos; Bases Trimmed</span>
                <strong className="kpi-val">
                  {bbdukReport.basesRemoved5Prime} bp / {bbdukReport.basesRemoved3Prime} bp
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Adapter Hits Detected</span>
                <strong className="kpi-val">{bbdukReport.adapterMatches.length}</strong>
              </div>
            </div>

            <div className="cloning-action-row" style={{ marginTop: 8, marginBottom: 14 }}>
              <button
                className="btn-primary-sm"
                disabled={trimmedReadSaveBlockReason(bbdukReport) !== null}
                title={trimmedReadSaveBlockReason(bbdukReport) ?? undefined}
                onClick={() => {
                  if (trimmedReadSaveBlockReason(bbdukReport) !== null) return;
                  const now = new Date().toISOString().slice(0, 10);
                  onCreateDocument({
                    id: `trimmed-${Date.now()}`,
                    name: `${activeDoc.name}_BBDuk_Trimmed`,
                    accession: `TRIM_${activeDoc.accession}`,
                    folder: activeDoc.folder,
                    moleculeType: activeDoc.moleculeType,
                    topology: 'linear',
                    sequence: bbdukReport.trimmedSequence,
                    description: `BBDuk k=${bbdukKmer} Q>=${bbdukMinQ} trimmed sequence from ${activeDoc.name}`,
                    createdAt: now,
                    updatedAt: now,
                    features: [],
                    primers: [],
                    history: [],
                  });
                }}
              >
                + Save Trimmed Sequence to Workspace
              </button>
              {trimmedReadSaveBlockReason(bbdukReport) && (
                <span className="studio-panel-note" role="status">
                  {trimmedReadSaveBlockReason(bbdukReport)}
                </span>
              )}
            </div>

            <div className="form-grid-3col">
              {/* the mapper is a setting; the reference and the read it maps are the documents compared */}
              <InspectorSection title="Read Mapping" order={2}>
                <label className="form-field">
                  <span>Mapping Algorithm:</span>
                  <select
                    value={ngsMapper}
                    onChange={(e) => setNgsMapper(e.target.value as NgsMapperEngine)}
                  >
                    <option value="Minimap2">Minimap2 (ONT / PacBio / Short Read)</option>
                    <option value="Bowtie2">Bowtie2 (FM-Index Short Read)</option>
                    <option value="BBMap">BBMap / BBMerge (DNA &amp; RNA-Seq)</option>
                  </select>
                </label>
              </InspectorSection>
              <label className="form-field">
                <span>Reference Sequence:</span>
                <select value={mapRefDocId} onChange={(e) => setMapRefDocId(e.target.value)}>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.sequence.length} bp)
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Query Read / Amplicon:</span>
                <select value={mapReadDocId} onChange={(e) => setMapReadDocId(e.target.value)}>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.sequence.length} bp)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
              <div className="kpi-box">
                <span className="kpi-label">Mapped Span &amp; Strand</span>
                <strong className="kpi-val">
                  {ngsMapReport.refStartBp}..{ngsMapReport.refEndBp} ({ngsMapReport.strand})
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Identity &amp; MAPQ</span>
                <strong className="kpi-val">
                  {ngsMapReport.identityPercent}% (MAPQ {ngsMapReport.mapqScore})
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">CIGAR &amp; Breadth</span>
                <strong className="kpi-val">
                  {ngsMapReport.cigar} ({ngsMapReport.coverageBreadthPercent}%)
                </strong>
              </div>
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>De Novo &amp; Contig Assembler ({assembler})</h3>
              <span className="badge-accent">CAP3 • Velvet • Flye • MIRA</span>
            </div>

            <InspectorSection title="De Novo Assembly" order={3}>
              <div className="form-grid-2col">
                <label className="form-field">
                  <span>Built-In Assembly Engine:</span>
                  <select
                    value={assembler}
                    onChange={(e) => setAssembler(e.target.value as DeNovoAssemblerEngine)}
                  >
                    <option value="CAP3">CAP3 — Sanger &amp; Overlap-Layout-Consensus</option>
                    <option value="Velvet">Velvet — Short-Read De Bruijn Graph</option>
                    <option value="Flye">Flye — Long-Read PacBio HiFi / ONT Repeat Graph</option>
                    <option value="MIRA">MIRA — Multi-Pass Genome &amp; EST Assembler</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Min Overlap / K-mer Size (bp):</span>
                  <input
                    type="number"
                    min={12}
                    max={65}
                    value={assemblyOverlap}
                    onChange={(e) => setAssemblyOverlap(Number(e.target.value) || 19)}
                  />
                </label>
              </div>
            </InspectorSection>

            <div className="info-callout" role="status" style={{ marginTop: 8 }}>
              {assemblyInputDocs.fromSelection
                ? `Assembling the ${assemblyInputDocs.docs.length} ticked documents.`
                : `No reads ticked: assembling the first ${assemblyInputDocs.docs.length} nucleotide documents. Tick 2 or more reads in the document table to choose the inputs.`}
            </div>
            <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
              <div className="kpi-box">
                <span className="kpi-label">Contigs Assembled</span>
                <strong className="kpi-val">
                  {assemblyReport.contigCount} (from {assemblyReport.inputReadCount} inputs)
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">N50 / L50</span>
                <strong className="kpi-val">
                  {assemblyReport.n50Bp.toLocaleString()} bp / L50={assemblyReport.l50Count}
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Total Assembled</span>
                <strong className="kpi-val">
                  {assemblyReport.totalAssembledBp.toLocaleString()} bp
                </strong>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div id={contigTableId} className="mbc-table-caption">
                Assembled Contigs ({assemblyReport.contigs.length})
              </div>
              <WorkbenchSmartTable
                tableId="ngs-assembled-contigs"
                tableLabel="Assembled Contigs"
                regionMaxHeight={230}
                className="mbc-batch-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Contig</th>
                    <th scope="col">Length</th>
                    <th scope="col">%GC</th>
                    <th scope="col">Reads (Cov)</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {assemblyReport.contigs.map((ctg) => (
                    <tr key={ctg.id}>
                      <th scope="row">{ctg.name}</th>
                      <td>{ctg.lengthBp.toLocaleString()} bp</td>
                      <td>{ctg.gcPercent}%</td>
                      <td>
                        {ctg.readCount} ({ctg.meanCoverageDepth}x)
                      </td>
                      <td>
                        <button
                          type="button"
                          className="mbc-copy-mini-btn"
                          onClick={() => {
                            const now = new Date().toISOString().slice(0, 10);
                            onCreateDocument({
                              id: `ctg-${Date.now()}`,
                              name: ctg.name,
                              accession: `ASM_${assembler}_${ctg.lengthBp}`,
                              folder: 'Contig Assembly',
                              moleculeType: 'DNA',
                              topology: 'linear',
                              sequence: ctg.sequence,
                              description: `${assembler} de novo assembled contig (${ctg.lengthBp} bp, N50=${assemblyReport.n50Bp} bp)`,
                              createdAt: now,
                              updatedAt: now,
                              features: [],
                              primers: [],
                              history: [],
                            });
                          }}
                        >
                          Add to Workspace
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: Whole-Genome (LASTZ / Mauve), FreeBayes, STR & 16S/ITS Taxonomy */}
      {/* =================================================================== */}
      {subTab === 'genome-variants' && freeBayesReport && strLoci && taxonomyHits && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Whole-Genome Alignment ({syntenyEngine}) &amp; 16S/ITS Classifier</h3>
              <span className="badge-accent">Mauve LCBs • LASTZ • 16S/ITS Taxonomy</span>
            </div>

            <div className="form-grid-2col">
              {/* the engine is a setting; the genome compared against stays with the result */}
              <InspectorSection title="Genome Alignment" order={1}>
                <label className="form-field">
                  <span>Genome Alignment Engine:</span>
                  <select
                    value={syntenyEngine}
                    onChange={(e) => setSyntenyEngine(e.target.value as 'Mauve' | 'LASTZ')}
                  >
                    <option value="Mauve">Mauve — Locally Collinear Blocks &amp; Inversions</option>
                    <option value="LASTZ">LASTZ — Chromosome-Scale Gapped Seed Aligner</option>
                  </select>
                </label>
              </InspectorSection>
              <label className="form-field">
                <span>Compare {activeDoc.name} Against:</span>
                <select
                  value={genomePartnerId}
                  onChange={(e) => setGenomePartnerId(e.target.value)}
                >
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.sequence.length} bp)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div data-mbc-scan="synteny" aria-busy={synteny ? undefined : true} style={{ marginTop: 8 }}>
              {synteny && syntenyReport ? (
                <>
                  <p className="studio-panel-note">
                    Computed for {synteny.input.genomeA} ({bp(synteny.input.seqA)}) against {synteny.input.genomeB} ({bp(synteny.input.seqB)}) with {synteny.input.engine}
                  </p>
                  <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
                    <div className="kpi-box">
                      <span className="kpi-label">Collinear Blocks (LCBs)</span>
                      <strong className="kpi-val">{syntenyReport.blocks.length}</strong>
                    </div>
                    <div className="kpi-box">
                      <span className="kpi-label">Aligned Bases &amp; Coverage</span>
                      <strong className="kpi-val">
                        {syntenyReport.totalAlignedBp.toLocaleString()} bp ({syntenyReport.genomeACoverageIsLowerBound
                          ? `at least ${syntenyReport.genomeACoveragePct}% of ${synteny.input.genomeA}`
                          : `${syntenyReport.genomeACoveragePct}%`})
                      </strong>
                    </div>
                    <div className="kpi-box">
                      <span className="kpi-label">Inversions Detected</span>
                      <strong className="kpi-val">{syntenyReport.inversionCount}</strong>
                    </div>
                  </div>
                  <ResultWarnings warnings={syntenyReport.warnings} label="Synteny warnings" />

                  <div style={{ marginTop: 8 }}>
                    <div id={lcbTableId} className="mbc-table-caption">
                      Synteny Blocks ({listCountLabel(Math.min(syntenyReport.blocks.length, TABLE_ROWS_SHOWN), syntenyReport.blocks.length, 'first')})
                    </div>
                    <WorkbenchSmartTable
                      tableId="genomics-synteny-blocks"
                      tableLabel="Whole-Genome Synteny Blocks"
                      regionMaxHeight={165}
                      className="mbc-batch-table"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Block</th>
                          <th scope="col">Query Span</th>
                          <th scope="col">Target Span</th>
                          <th scope="col">Event Class</th>
                          <th scope="col">% Identity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syntenyReport.blocks.length === 0 ? (
                          <tr>
                            <td colSpan={5}>No shared k-mer synteny block detected between selected pair.</td>
                          </tr>
                        ) : (
                          syntenyReport.blocks.slice(0, TABLE_ROWS_SHOWN).map((blk) => (
                            <tr key={blk.blockId}>
                              <th scope="row">
                                {blk.blockId} ({blk.strand})
                              </th>
                              <td>
                                {blk.genomeAStart}..{blk.genomeAEnd}
                              </td>
                              <td>
                                {blk.genomeBStart}..{blk.genomeBEnd}
                              </td>
                              <td>{blk.eventClass}</td>
                              <td>{blk.identityPercent}%</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </WorkbenchSmartTable>
                  </div>
                </>
              ) : (
                <ScanningNote />
              )}
            </div>

            {minimizerChainReport && (
              <div className="mbc-studio-isolated-region" style={{ marginTop: 10 }}>
                <div className="mbc-table-caption">
                  Large-Genome (w={minimizerChainReport.windowW}, k={minimizerChainReport.kmerK})-Minimizer Co-Linear Chainer ({minimizerChainReport.totalChains ?? minimizerChainReport.chains.length} chains • {minimizerChainReport.rawSeedMatches} seed anchors{minimizerChainReport.minChainAnchors !== undefined && <> • chains of at least {minimizerChainReport.minChainAnchors} anchors</>})
                </div>
                <ResultWarnings warnings={minimizerChainReport.warnings} label="Minimizer chaining warnings" />
                <WorkbenchSmartTable
                  tableId="genomics-minimizer-synteny-chains"
                  tableLabel="Minimizer Co-Linear Synteny Chains"
                  regionMaxHeight={145}
                  className="mbc-batch-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">Chain</th>
                      <th scope="col">Target Span</th>
                      <th scope="col">Query Span</th>
                      <th scope="col">Anchors</th>
                      <th scope="col">Identity / Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {minimizerChainReport.chains.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No co-linear minimizer anchor chains detected.</td>
                      </tr>
                    ) : (
                      // every chain the engine lists: its warning above says when that is fewer
                      // than the total the caption gives (it used to draw the first 16, unsaid)
                      minimizerChainReport.chains.map((ch) => (
                        <tr key={ch.chainId}>
                          <th scope="row">
                            #{ch.chainId} ({ch.strand >= 0 ? '+' : '-'})
                          </th>
                          <td>
                            {ch.targetStartBp}..{ch.targetEndBp}
                          </td>
                          <td>
                            {ch.queryStartBp}..{ch.queryEndBp}
                          </td>
                          <td>{ch.anchorCount}</td>
                          <td>
                            {ch.estimatedIdentityPct.toFixed(1)}% ({ch.structuralEvent})
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 12 }}>
                Taxonomic Classification (16S rRNA / ITS / Replicon Signatures) — {activeDoc.name}:
              </strong>
              <div className="plugin-list-box" style={{ maxHeight: 135, marginTop: 6 }}>
                {taxonomyHits.length === 0 && (
                  <div className="plugin-row-item">
                    <div className="plugin-row-text">
                      No marker signature (16S / ITS / replicon) was found in this sequence, so no taxon is suggested.
                    </div>
                  </div>
                )}
                {taxonomyHits.map((hit) => (
                  <div key={hit.rank} className="plugin-row-item">
                    <div className="plugin-row-text">
                      <strong>
                        #{hit.rank} {hit.taxonName} (signature score {hit.confidencePct})
                      </strong>
                      <div style={{ fontSize: 11, opacity: 0.85 }}>{hit.lineage}</div>
                      <div style={{ fontSize: 11, opacity: 0.85 }}>
                        Evidence: {hit.matchedSignatures.length} marker signature
                        {hit.matchedSignatures.length === 1 ? '' : 's'} ({hit.matchedSignatures.slice(0, 3).join(', ')}
                        {hit.matchedSignatures.length > 3 ? ', …' : ''})
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Sequence Variant Finder (vs. Reference) &amp; Microsatellite STR Genotyper</h3>
              <span className="badge-accent">Alignment-based VCF • STR Allele Caller</span>
            </div>

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Polymorphisms ({mapReadDoc.name} vs {mapRefDoc.name})</span>
                <strong className="kpi-val">
                  {freeBayesReport.totalVariants} ({freeBayesReport.snpCount} SNPs,{' '}
                  {freeBayesReport.mnpOrIndelCount} MNP/Indel)
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Ti / Tv Ratio</span>
                <strong className="kpi-val">{freeBayesReport.tiTvRatio}</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">STR Loci in {activeDoc.name}</span>
                <strong className="kpi-val">{strLoci.length}</strong>
              </div>
            </div>
            {/* what the call did not compare: an empty input (BG-01M6TE8J), the part of a sample past
                the caller's alignment cap (BG-01M6S1ED), unknown bases and the indels beside them
                (BG-01M6T6GK). The engine's report carries `warnings` (D0005), which its shared type
                does not list yet */}
            <ResultWarnings warnings={freeBayesWarnings} label="Variant calling warnings" />

            <div className="cloning-action-row" style={{ marginTop: 8 }}>
              <button
                className="btn-primary-sm"
                disabled={
                  freeBayesReport.annotations.length === 0 ||
                  (!onAppendFeaturesToDocument && mapRefDoc.id !== activeDoc.id)
                }
                title={`Variant coordinates are relative to the reference "${mapRefDoc.name}"; they are added to that document.`}
                onClick={() => {
                  const summary = `Annotated ${freeBayesReport.annotations.length} variant(s) on reference "${mapRefDoc.name}"`;
                  // Variant positions are reference coordinates: annotate the reference.
                  if (onAppendFeaturesToDocument) {
                    onAppendFeaturesToDocument(mapRefDoc.id, freeBayesReport.annotations, summary);
                  } else {
                    onAppendFeatures(freeBayesReport.annotations, summary);
                  }
                }}
              >
                + Annotate Variants on Reference
              </button>
              <button
                className="btn-secondary-sm"
                onClick={() =>
                  triggerTextDownload(`${mapRefDoc.name}_variants.vcf`, freeBayesReport.vcfText)
                }
              >
                Export VCF (.vcf)
              </button>
              <InspectorSection title="STR Genotyping" order={2}>
                {inlineSetting('Min STR Repeats:', 6, 11.5, (
                  <input
                    type="number"
                    min={3}
                    max={12}
                    value={minStrCopies}
                    onChange={(e) => setMinStrCopies(Number(e.target.value) || 4)}
                    style={inlineBoxWidth(56)}
                  />
                ))}
              </InspectorSection>
            </div>

            <div style={{ marginTop: 8 }}>
              <div id={variantTableId} className="mbc-table-caption">
                Variant Calls ({listCountLabel(Math.min(freeBayesReport.variants.length, VARIANT_ROWS_SHOWN), freeBayesReport.totalVariants, 'first')}; single sequence vs. reference, no read-depth QUAL)
              </div>
              <WorkbenchSmartTable
                tableId="genomics-freebayes-variants"
                tableLabel="Variant Calls"
                regionMaxHeight={155}
                className="mbc-batch-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Pos (bp)</th>
                    <th scope="col">REF &gt; ALT</th>
                    <th scope="col">Type</th>
                    <th scope="col">Class</th>
                    <th scope="col">GT</th>
                  </tr>
                </thead>
                <tbody>
                  {freeBayesReport.variants.length === 0 ? (
                    <tr>
                      {/* identity is claimed only where the call compared everything: an empty
                          input, or bases it passed over, are said in the warnings instead */}
                      <td colSpan={5}>
                        {freeBayesWarnings.length
                          ? 'No variants called; the warnings above say what was not compared.'
                          : '100% identical across mapped interval (0 variants).'}
                      </td>
                    </tr>
                  ) : (
                    freeBayesReport.variants.slice(0, VARIANT_ROWS_SHOWN).map((v) => (
                      <tr key={v.id}>
                        <th scope="row">{v.positionBp}</th>
                        <td>
                          <code>
                            {v.refAllele} &gt; {v.altAllele}
                          </code>
                        </td>
                        <td>{v.variantType}</td>
                        <td>{v.mutationClass}</td>
                        <td>{v.genotype}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </WorkbenchSmartTable>
            </div>

            {vcfConsequenceReport && (
              <div className="mbc-studio-isolated-region" style={{ marginTop: 10 }}>
                <div className="mbc-table-caption">
                  VCF coding consequences, HGVS (HIGH: {vcfConsequenceReport.highImpactCount} • MODERATE: {vcfConsequenceReport.moderateImpactCount} • LOW: {vcfConsequenceReport.lowImpactCount})
                </div>
                {/* the caption counts impact tiers only, so the rows the table leaves out are said here */}
                <ResultWarnings
                  warnings={subsetNote(
                    'The table lists',
                    Math.min(vcfConsequenceReport.annotatedVariants.length, CONSEQUENCE_ROWS_SHOWN),
                    vcfConsequenceReport.totalVariants,
                    'records',
                    'first'
                  )}
                  label="HGVS consequence warnings"
                />
                <WorkbenchSmartTable
                  tableId="genomics-noodles-vcf-consequences"
                  tableLabel="VCF HGVS Coding Consequences"
                  regionMaxHeight={150}
                  className="mbc-batch-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">Pos</th>
                      <th scope="col">Feature</th>
                      <th scope="col">Consequence</th>
                      <th scope="col">HGVS.c / HGVS.p</th>
                      <th scope="col">Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vcfConsequenceReport.annotatedVariants.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Zero VCF records requiring HGVS coding consequence annotation.</td>
                      </tr>
                    ) : (
                      vcfConsequenceReport.annotatedVariants.slice(0, CONSEQUENCE_ROWS_SHOWN).map((av, idx) => (
                        <tr key={`${av.positionBp}-${idx}`}>
                          <th scope="row">{av.positionBp}</th>
                          <td>{av.featureName ?? 'Intergenic'}</td>
                          <td>{av.consequenceTerm}</td>
                          <td className="mono-cell">
                            {av.hgvsCoding}
                            {av.hgvsProtein ? ` (${av.hgvsProtein})` : ''}
                          </td>
                          <td>
                            <strong>{av.impactTier}</strong>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <div id={strTableId} className="mbc-table-caption">
                Microsatellite / STR Genotypes ({listCountLabel(Math.min(strLoci.length, TABLE_ROWS_SHOWN), strLoci.length, 'first')})
              </div>
              <WorkbenchSmartTable
                tableId="genomics-microsatellite-strs"
                tableLabel="Microsatellite STR Genotypes"
                regionMaxHeight={155}
                className="mbc-batch-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Allele Call</th>
                    <th scope="col">Coordinates</th>
                    <th scope="col">Repeat Tract</th>
                    <th scope="col">Virtual Amplicon</th>
                  </tr>
                </thead>
                <tbody>
                  {strLoci.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No STR loci ≥ {minStrCopies} copies at current threshold.</td>
                    </tr>
                  ) : (
                    strLoci.slice(0, TABLE_ROWS_SHOWN).map((loc) => (
                      <tr key={loc.id}>
                        <th scope="row">{loc.alleleCall}</th>
                        <td>
                          {loc.startBp}..{loc.endBp}
                        </td>
                        <td>
                          {loc.repeatCopies}x ({loc.tractLengthBp} bp)
                        </td>
                        <td>{loc.virtualAmpliconBp} bp</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </WorkbenchSmartTable>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: Glimmer Microbial Gene Prediction, CpG Islands & Repeat Finder */}
      {/* =================================================================== */}
      {subTab === 'genes-cpg-repeats' && repeatReport && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Glimmer Microbial Gene Predictor (IMM + Shine-Dalgarno RBS)</h3>
              {glimmerReport && <span className="badge-accent">{glimmerReport.totalPredictedCds.toLocaleString('en-US')} Predicted CDS</span>}
            </div>

            <div className="cloning-action-row">
              <InspectorSection title="Gene Prediction" order={1}>
                {inlineSetting('Min Protein Length (aa):', 6, 12, (
                  <input
                    type="number"
                    min={20}
                    max={300}
                    value={glimmerMinAa}
                    onChange={(e) => setGlimmerMinAa(Number(e.target.value) || 45)}
                    style={inlineBoxWidth(70)}
                  />
                ))}
              </InspectorSection>
              <button
                className="btn-primary-sm"
                disabled={!glimmerReport || glimmerReport.annotations.length === 0}
                onClick={() =>
                  glimmerReport && onAppendFeatures(
                    glimmerReport.annotations,
                    `Annotated ${glimmerReport.annotations.length} Glimmer predicted gene(s)`
                  )
                }
              >
                + Annotate Glimmer Genes onto {activeDoc.name}
              </button>
            </div>

            <div data-mbc-scan="genes" aria-busy={genes ? undefined : true} style={{ marginTop: 10 }}>
              {genes && glimmerReport ? (
                <>
                  <p className="studio-panel-note">Computed for {genes.input.genome} ({bp(genes.input.seq)}), proteins ≥ {genes.input.min} aa</p>
                    <div id={glimmerTableId} className="mbc-table-caption">
                      Glimmer Predicted Protein-Coding Genes ({listCountLabel(glimmerReport.genes.length, glimmerReport.totalPredictedCds, 'top')})
                    </div>
                    <ResultWarnings warnings={glimmerReport.warnings} label="Gene prediction warnings" />
                    <WorkbenchSmartTable
                      tableId="genomics-glimmer-predicted-genes"
                      tableLabel="Glimmer Predicted Protein-Coding Genes"
                      regionMaxHeight={250}
                      className="mbc-batch-table"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Gene</th>
                          <th scope="col">Coordinates</th>
                          <th scope="col">Size</th>
                          <th scope="col">Start / RBS</th>
                          <th scope="col">IMM Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {glimmerReport.genes.map((g) => (
                          <tr key={g.id}>
                            <th scope="row">
                              {g.geneName} ({g.strand === 1 ? '+' : '-'})
                            </th>
                            <td>
                              {g.startBp}..{g.endBp}
                            </td>
                            <td>{g.lengthAa} aa</td>
                            <td>
                              {g.startCodon} / {g.rbsMotif}
                            </td>
                            <td>
                              <strong>{g.codingScore}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </WorkbenchSmartTable>
                </>
              ) : (
                <ScanningNote />
              )}
            </div>

            {/* rust-bio Viterbi 3-State Discrete-Emission HMM Compositional Genome Segmentation */}
            {hmmSegmentationReport && (
              <div className="mbc-studio-isolated-region" style={{ marginTop: 12 }}>
                <div className="studio-card-header" style={{ paddingTop: 2 }}>
                  <h4>
                    Genome segmentation, 3-state HMM (Viterbi path, ln P* = {hmmSegmentationReport.viterbiLogProb})
                  </h4>
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    disabled={hmmSegmentationReport.segments.length === 0}
                    onClick={() => {
                      const feats: SequenceFeature[] = hmmSegmentationReport.segments
                        .slice(0, 25)
                        .map((seg, idx) => ({
                          id: `hmm-seg-${Date.now()}-${idx}`,
                          name: `HMM_${seg.stateLabel.replace(/[^A-Za-z0-9]+/g, '_')}`,
                          type: seg.stateIndex === 2 ? 'misc_feature' : 'regulatory',
                          start: seg.start,
                          end: seg.end,
                          strand: 1,
                          color:
                            seg.stateIndex === 2
                              ? '#0284c7'
                              : seg.stateIndex === 0
                              ? '#d97706'
                              : '#16a34a',
                          notes: `rust-bio Viterbi HMM ${seg.stateLabel} (${seg.lengthBp} bp, ${seg.gcPercent}% GC)`,
                        }));
                      onAppendFeatures(
                        feats,
                        `Annotated ${feats.length} HMM segment(s) (Viterbi path)`
                      );
                    }}
                  >
                    + Annotate HMM Segments
                  </button>
                </div>
                <ResultWarnings warnings={hmmSegmentationReport.warnings} label="HMM segmentation warnings" />
                <div className="thermo-kpi-grid">
                  <div className="kpi-box">
                    <span className="kpi-label">AT-Rich / Promoter</span>
                    <strong className="kpi-val">{hmmSegmentationReport.atRichFractionPct}%</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">Balanced Coding</span>
                    <strong className="kpi-val">{hmmSegmentationReport.balancedCodingFractionPct}%</strong>
                  </div>
                  <div className="kpi-box">
                    <span className="kpi-label">GC-Rich / CpG Island</span>
                    <strong className="kpi-val">{hmmSegmentationReport.gcIslandFractionPct}%</strong>
                  </div>
                </div>
                <div className="mbc-table-caption">
                  Viterbi path segments ({listCountLabel(Math.min(hmmSegmentationReport.segments.length, SEGMENT_ROWS_SHOWN), hmmSegmentationReport.segments.length, 'first')})
                </div>
                <WorkbenchSmartTable
                  tableId="genomics-viterbi-hmm-segments"
                  tableLabel="Viterbi HMM Compositional Segments"
                  regionMaxHeight={145}
                  className="mbc-batch-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">HMM State</th>
                      <th scope="col">Coordinates</th>
                      <th scope="col">Length</th>
                      <th scope="col">%GC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hmmSegmentationReport.segments.slice(0, SEGMENT_ROWS_SHOWN).map((seg, idx) => (
                      <tr key={`${seg.start}-${idx}`}>
                        <th scope="row">{seg.stateLabel}</th>
                        <td>
                          {seg.start}..{seg.end}
                        </td>
                        <td>{seg.lengthBp} bp</td>
                        <td>{seg.gcPercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
            )}
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>CpG Islands &amp; Genomic Repeat Finder</h3>
              <span className="badge-accent">
                {cpgReport && <>{cpgReport.islands.length} CpG Islands • </>}{repeatReport.totalIsLowerBound ? 'at least ' : ''}{repeatReport.totalRepeats.toLocaleString('en-US')} Repeats
              </span>
            </div>

            <div className="cloning-action-row">
              <InspectorSection title="CpG Islands" order={2}>
                {inlineSetting('Min CpG Island (bp):', 6, 12, (
                  <input
                    type="number"
                    min={100}
                    max={1000}
                    value={cpgMinLen}
                    onChange={(e) => setCpgMinLen(Number(e.target.value) || 200)}
                    style={inlineBoxWidth(68)}
                  />
                ))}
              </InspectorSection>
              <button
                className="btn-primary-sm"
                disabled={!cpgReport || cpgReport.annotations.length === 0}
                onClick={() =>
                  cpgReport && onAppendFeatures(
                    cpgReport.annotations,
                    `Annotated ${cpgReport.annotations.length} CpG island(s)`
                  )
                }
              >
                + Annotate CpG Islands
              </button>
              {/* BG-01M6SQ9T's box as it landed: the draft it holds and the settle timer are the
                  studio's, so a close of the inspector mid-typing loses neither */}
              <InspectorSection title="Genomic Repeats" order={3}>
                {inlineSetting('Min Repeat Arm:', 6, 12, (
                  <input
                    type="number"
                    min={MIN_REPEAT_ARM_BP}
                    max={MAX_REPEAT_ARM_BP}
                    step={1}
                    value={repeatArmText}
                    onChange={(e) => setRepeatArmText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') settleRepeatArm();
                    }}
                    onBlur={settleRepeatArm}
                    style={inlineBoxWidth(56)}
                  />
                ))}
              </InspectorSection>
              <button
                className="btn-secondary-sm"
                disabled={repeatReport.annotations.length === 0}
                onClick={() =>
                  onAppendFeatures(
                    repeatReport.annotations,
                    `Annotated ${repeatReport.annotations.length} genomic repeat(s)`
                  )
                }
              >
                + Annotate Repeats
              </button>
            </div>

            <div data-mbc-scan="cpg" aria-busy={cpg ? undefined : true} style={{ marginTop: 8 }}>
              {cpg && cpgReport ? (
                <>
                  <p className="studio-panel-note">Computed for {cpg.input.genome} ({bp(cpg.input.seq)}), islands ≥ {cpg.input.min} bp</p>
                    <div id={cpgTableId} className="mbc-table-caption">
                      Gardiner-Garden &amp; Frommer CpG Islands ({cpgReport.islands.length})
                    </div>
                    <WorkbenchSmartTable
                      tableId="genomics-cpg-islands"
                      tableLabel="CpG Islands"
                      regionMaxHeight={155}
                      className="mbc-batch-table"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Island</th>
                          <th scope="col">Coordinates</th>
                          <th scope="col">Length</th>
                          <th scope="col">%GC</th>
                          <th scope="col">Obs/Exp CpG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cpgReport.islands.length === 0 ? (
                          <tr>
                            <td colSpan={5}>No CpG islands ≥ {cpg.input.min} bp with Obs/Exp ≥ 0.60.</td>
                          </tr>
                        ) : (
                          cpgReport.islands.map((isl) => (
                            <tr key={isl.id}>
                              <th scope="row">{isl.id}</th>
                              <td>
                                {isl.startBp}..{isl.endBp}
                              </td>
                              <td>{isl.lengthBp} bp</td>
                              <td>{isl.gcPercent}%</td>
                              <td>{isl.obsExpRatio}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </WorkbenchSmartTable>
                </>
              ) : (
                <ScanningNote />
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <div id={repeatTableId} className="mbc-table-caption">
                Direct, Inverted &amp; Palindromic Repeats ({repeatListLabel(repeatReport)})
              </div>
              <ResultWarnings warnings={repeatReport.warnings} label="Repeat scan warnings" />
              <WorkbenchSmartTable
                tableId="genomics-repeats-finder"
                tableLabel="Direct Inverted and Palindromic Repeats"
                regionMaxHeight={170}
                className="mbc-batch-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Repeat Type</th>
                    <th scope="col">Arm 1</th>
                    <th scope="col">Arm 2</th>
                    <th scope="col">Length</th>
                    <th scope="col">Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {repeatReport.repeats.map((rep) => (
                    <tr key={rep.id}>
                      <th scope="row">{rep.repeatType}</th>
                      <td>
                        {rep.arm1StartBp}..{rep.arm1EndBp}
                      </td>
                      <td>
                        {rep.arm2StartBp}..{rep.arm2EndBp}
                      </td>
                      <td>{rep.armLengthBp} bp</td>
                      <td>
                        <code>{rep.sequenceMotif}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>

            {/* rust-bio DNAMotif JASPAR PSSM / PWM Transcription Factor Motif Scanner */}
            {pssmMotifReport && (
              <div className="mbc-studio-isolated-region" style={{ marginTop: 12 }}>
                <div className="studio-card-header" style={{ paddingTop: 2 }}>
                  <h4>
                    Transcription-factor motif scan, JASPAR PWMs ({pssmMotifReport.totalHits} hits across {pssmMotifReport.motifsEvaluated} matrices)
                  </h4>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <InspectorSection title="TF Motif Scan" order={4}>
                      {inlineSetting('Min Score:', 5, 11.5, (
                        <select
                          value={String(pssmMinRelScore)}
                          onChange={(e) => setPssmMinRelScore(Number(e.target.value))}
                        >
                          <option value="0.8">0.80</option>
                          <option value="0.84">0.84</option>
                          <option value="0.88">0.88</option>
                          <option value="0.92">0.92</option>
                        </select>
                      ))}
                    </InspectorSection>
                    <button
                      type="button"
                      className="btn-primary-sm"
                      disabled={pssmMotifReport.hits.length === 0}
                      onClick={() => {
                        const feats: SequenceFeature[] = pssmMotifReport.hits
                          .slice(0, 30)
                          .map((hit, idx) => ({
                            id: `pssm-tf-${Date.now()}-${idx}`,
                            name: `${hit.tfName}_${hit.matrixId}`,
                            type: 'regulatory',
                            start: hit.start,
                            end: hit.end,
                            strand: hit.strand,
                            color: '#7c3aed',
                            notes: `JASPAR ${hit.matrixId} (${hit.family}) relScore=${hit.relativeScore}, logOdds=${hit.logOddsBits} bits`,
                          }));
                        onAppendFeatures(
                          feats,
                          `Annotated ${feats.length} JASPAR PSSM TF binding site(s)`
                        );
                      }}
                    >
                      + Annotate TF Sites
                    </button>
                  </div>
                </div>
                <div className="mbc-table-caption">
                  Best-scoring binding sites, every matrix ({listCountLabel(pssmMotifReport.hits.length, pssmMotifReport.totalHits, 'top')})
                </div>
                <ResultWarnings warnings={pssmMotifReport.warnings} label="TF motif scan warnings" />
                <WorkbenchSmartTable
                  tableId="genomics-jaspar-pssm-motifs"
                  tableLabel="JASPAR PSSM Transcription Factor Binding Sites"
                  regionMaxHeight={155}
                  className="mbc-batch-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">TF / Matrix</th>
                      <th scope="col">Coordinates</th>
                      <th scope="col">Matched Site</th>
                      <th scope="col">Rel. Score</th>
                      <th scope="col">Log-Odds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pssmMotifReport.hits.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No JASPAR PSSM hits ≥ {(pssmMinRelScore * 100).toFixed(0)}% relative score.</td>
                      </tr>
                    ) : (
                      pssmMotifReport.hits.map((hit, idx) => (
                        <tr key={`${hit.matrixId}-${hit.start}-${idx}`}>
                          <th scope="row">
                            {hit.tfName} ({hit.matrixId})
                          </th>
                          <td>
                            {hit.start}..{hit.end} ({hit.strand === 1 ? '+' : '-'})
                          </td>
                          <td className="mono-cell">{hit.matchedSeq}</td>
                          <td>{(hit.relativeScore * 100).toFixed(1)}%</td>
                          <td>{hit.logOddsBits} bits</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </WorkbenchSmartTable>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: Coiled-Coils (Lupas), Transmembrane Topology & 3D PDB Aligner */}
      {/* =================================================================== */}
      {subTab === 'protein-3d' && topologyReport && (
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
                    <div className="kpi-box" title="Scored on the sequence-paired superposition, not searched for as TM-align does">
                      <span className="kpi-label">TM≈ (approximate TM-score)</span>
                      <strong className="kpi-val">{pdbAlignReport.tmScore}</strong>
                    </div>
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
                    tmScore={comparing ? pdbAlignReport?.tmScore : undefined}
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
                    {(pdbAlignReport.sequenceIdentity * 100).toFixed(1)}% of the pairs identical. TM≈ is approximate: it
                    is scored on this sequence-paired superposition, not searched for as TM-align does; Align
                    Structures… aligns the chains by structure.
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

      {/* =================================================================== */}
      {/* TAB 5: Complement/Reverse Only, Mutate & Shuffle, NCBI GenBank Submit */}
      {/* =================================================================== */}
      {subTab === 'transform-submit' && mutateReport && genbankSubmission && (
        <div className="studio-split-grid">
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Complement / Reverse Only &amp; Mutate / Shuffle Generator</h3>
              <span className="badge-accent">Dinucleotide-Preserving Shuffle</span>
            </div>

            <div className="cloning-action-row" style={{ marginBottom: 12 }}>
              <button
                className="btn-primary-sm"
                disabled={activeDoc.moleculeType === 'Protein' || !activeDoc.sequence}
                title={activeDoc.moleculeType === 'Protein' ? 'Strand operations apply to DNA or RNA documents.' : undefined}
                onClick={() =>
                  onComplementOnlyActiveDoc
                    ? onComplementOnlyActiveDoc()
                    : onUpdateActiveSequence(
                        complementOnlySequence(activeDoc.sequence, activeDoc.moleculeType === 'RNA'),
                        `Applied Complement-Only (5'→3') to ${activeDoc.name}`
                      )
                }
              >
                Complement Only (5&apos;→3&apos; In-Place)
              </button>
              <button
                className="btn-primary-sm"
                disabled={activeDoc.moleculeType === 'Protein' || !activeDoc.sequence}
                title={activeDoc.moleculeType === 'Protein' ? 'Strand operations apply to DNA or RNA documents.' : undefined}
                onClick={() =>
                  onReverseOnlyActiveDoc
                    ? onReverseOnlyActiveDoc()
                    : onUpdateActiveSequence(
                        reverseOnlySequence(activeDoc.sequence),
                        `Applied Reverse-Only (3'→5') to ${activeDoc.name}`
                      )
                }
              >
                Reverse Only (3&apos;→5&apos; In-Place)
              </button>
            </div>

            <InspectorSection title="Benchmark Generator" order={1}>
              <div className="form-grid-3col">
                <label className="form-field">
                  <span>Benchmark Generator Mode:</span>
                  <select
                    value={mutateMode}
                    onChange={(e) =>
                      setMutateMode(e.target.value as MutateShuffleOptions['mode'])
                    }
                  >
                    <option value="shuffle-dinucleotide">
                      Shuffle — Preserve Exact Dinucleotide Composition
                    </option>
                    <option value="shuffle-mononucleotide">
                      Shuffle — Uniform Mononucleotide Fisher-Yates
                    </option>
                    <option value="point-mutate">
                      Point Mutate — Ti/Tv Weighted Random Substitutions
                    </option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Mutation Rate (%):</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0.5}
                    max={40}
                    disabled={mutateMode !== 'point-mutate'}
                    value={mutationRatePct}
                    onChange={(e) => setMutationRatePct(Number(e.target.value) || 2.5)}
                  />
                </label>
                <label className="form-field">
                  <span>PRNG Seed:</span>
                  <input
                    type="number"
                    value={mutateSeed}
                    onChange={(e) => setMutateSeed(Number(e.target.value) || 1)}
                  />
                </label>
              </div>
            </InspectorSection>

            <div className="thermo-kpi-grid" style={{ marginTop: 8 }}>
              <div className="kpi-box">
                <span className="kpi-label">Positions Changed</span>
                <strong className="kpi-val">
                  {mutateReport.mutationsApplied.toLocaleString()} /{' '}
                  {mutateReport.originalLengthBp.toLocaleString()} bp
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">%GC (Original → Output)</span>
                <strong className="kpi-val">
                  {mutateReport.gcOriginalPct}% → {mutateReport.gcOutputPct}%
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Dinucleotide Conservation</span>
                <strong className="kpi-val">
                  {(mutateReport.dinucleotideCorrelation * 100).toFixed(1)}%
                </strong>
              </div>
            </div>

            <div className="cloning-action-row" style={{ marginTop: 10 }}>
              <button
                className="btn-primary-sm"
                onClick={() => {
                  const now = new Date().toISOString().slice(0, 10);
                  const suffix =
                    mutateMode === 'point-mutate'
                      ? 'Mutated'
                      : mutateMode === 'shuffle-dinucleotide'
                      ? 'DinucShuffled'
                      : 'Shuffled';
                  onCreateDocument({
                    id: `mut-${Date.now()}`,
                    name: `${activeDoc.name}_${suffix}`,
                    accession: `BENCH_${suffix.toUpperCase()}`,
                    folder: activeDoc.folder,
                    moleculeType: activeDoc.moleculeType,
                    topology: 'linear',
                    sequence: mutateReport.outputSequence,
                    description: `${suffix} benchmark derivative of ${activeDoc.name} (GC=${mutateReport.gcOutputPct}%)`,
                    createdAt: now,
                    updatedAt: now,
                    features: [],
                    primers: [],
                    history: [],
                  });
                }}
              >
                + Create Mutated / Shuffled Document in Workspace
              </button>
            </div>
          </div>

          <div className="studio-card">
            <div className="studio-card-header">
              <h3>NCBI GenBank Direct Submission Validator (.fsa + .tbl)</h3>
              <span className="badge-accent">
                {genbankSubmission.readyForSubmission ? 'SUBMISSION READY' : 'REVIEW REQUIRED'}
              </span>
            </div>

            <div className="form-grid-2col">
              <label className="form-field">
                <span>Source Organism:</span>
                <input
                  type="text"
                  value={gbMeta.organism}
                  onChange={(e) => setGbMeta((p) => ({ ...p, organism: e.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Strain / Isolate:</span>
                <input
                  type="text"
                  value={gbMeta.strainOrIsolate}
                  onChange={(e) =>
                    setGbMeta((p) => ({ ...p, strainOrIsolate: e.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Molecule Type ([moltype]):</span>
                <select
                  value={gbMeta.molType}
                  onChange={(e) =>
                    setGbMeta((p) => ({
                      ...p,
                      molType: e.target.value as GenBankSubmissionMeta['molType'],
                    }))
                  }
                >
                  <option value="genomic DNA">genomic DNA</option>
                  <option value="mRNA">mRNA</option>
                  <option value="other DNA">other DNA (Synthetic / Vector)</option>
                  <option value="viral cRNA">viral cRNA</option>
                </select>
              </label>
              <label className="form-field">
                <span>NCBI Genetic Code ([gcode]):</span>
                <select
                  value={gbMeta.geneticCodeId}
                  onChange={(e) =>
                    setGbMeta((p) => ({
                      ...p,
                      geneticCodeId: Number(e.target.value) as 1 | 11,
                    }))
                  }
                >
                  <option value={1}>Table 1 — Standard Eukaryotic</option>
                  <option value={11}>Table 11 — Bacterial, Archaeal &amp; Plant Plastid</option>
                </select>
              </label>
            </div>

            <div className="plugin-list-box" style={{ maxHeight: 115, marginTop: 8 }}>
              {genbankSubmission.issues.map((iss, idx) => (
                <div key={idx} className="plugin-row-item">
                  <div className="plugin-row-text">
                    <strong>[{iss.severity}] {iss.rule}:</strong> {iss.message}
                  </div>
                </div>
              ))}
            </div>

            <div className="cloning-action-row" style={{ marginTop: 8 }}>
              <button
                className="btn-primary-sm"
                onClick={() =>
                  triggerTextDownload(`${activeDoc.name}.fsa`, genbankSubmission.fastaFsaText)
                }
              >
                Export Submission FASTA (.fsa)
              </button>
              <button
                className="btn-secondary-sm"
                onClick={() =>
                  triggerTextDownload(
                    `${activeDoc.name}.tbl`,
                    genbankSubmission.featureTableTblText
                  )
                }
              >
                Export 5-Column Feature Table (.tbl)
              </button>
            </div>

            <textarea
              className="js-code-editor"
              rows={4}
              readOnly
              style={{ marginTop: 8 }}
              value={`${genbankSubmission.fastaFsaText.slice(0, 260)}...\n\n${genbankSubmission.featureTableTblText}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};
