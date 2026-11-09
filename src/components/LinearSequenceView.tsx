// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadSummarySequence } from '../core/contigSummary';
import {
  FeatureType,
  NucleotideColorScheme,
  RestrictionCutSite,
  SequenceDocument,
  SequenceFeature,
} from '../types/bio';
import { analyzeProteinSequence, CODON_TABLE, reverseComplement, tmNoAnswerSentence } from '../core/bioEngine';
import { basicTmHasNoAnswer } from './ConstructCockpitBar';
import {
  getResidentTrackOverviewRust,
  searchResidentMotifFmIndexRust,
  sliceResidentViewportRust,
  type ResidentMotifSearchResult,
} from '../lib/rustBioEngine';
import { cutSiteDisplayPosition } from '../core/restrictionDisplay';
import { chartMaxWidth } from '../core/chartLayout';
import { FigureExportButton } from './FigureExportButton';
import { ResultWarnings } from './ResultWarnings';
import { meanGcWords, subsetNote, type RestrictionScanScope } from './CircularPlasmidMap';

interface LinearSequenceViewProps {
  doc: SequenceDocument;
  cutSites: RestrictionCutSite[];
  /** What `cutSites` cover when the caller scanned only part of the molecule; absent, the view gives no coverage note. */
  restrictionScope?: RestrictionScanScope | null;
  selectedRange: { start: number; end: number; label?: string } | null;
  onSelectRange: (range: { start: number; end: number; label?: string }) => void;
  onUpdateDocument: (updated: SequenceDocument) => void;
  showTranslation?: boolean;
  showGcGraph?: boolean;
  showHydropathyGraph?: boolean;
  colorScheme?: NucleotideColorScheme;
  onLoadBenchmarkDocument?: (kind: 'genome-500k' | 'protein-10k') => void;
  onClearSelection?: () => void;
  onExtractSelection?: () => void;
  onConvertSelectionToOligo?: () => void;
  onStatusNotice?: (msg: string) => void;
}

export interface SchematicFeaturePlaced {
  feature: SequenceFeature;
  lane: number;
  x1: number;
  x2: number;
  y: number;
  boxWidth: number;
  labelMode: 'inside' | 'outside-right' | 'outside-left' | 'none';
  displayLabel: string;
  labelX: number;
  textAnchor: 'middle' | 'start' | 'end';
  occStart: number;
  occEnd: number;
}

/** The most bases a sequence row holds, and the row length before the column has been measured. */
export const LINEAR_ROW_MAX_BASES = 60;
/** The fewest bases a sequence row holds, however narrow the column. */
export const LINEAR_ROW_MIN_BASES = 30;
/**
 * The width of one residue: Google Sans Code's 0.6 em advance (1200/2000) at the 12px residue size
 * (`.seq-strand-line`), plus the 0.25px letter spacing of `.mono-bases`.
 */
export const RESIDUE_ADVANCE_PX = 12 * 0.6 + 0.25;
/**
 * What a row spends beside its bases: the 68px start-coordinate gutter (`.coord-gutter`), then the
 * 8px gap and the end coordinate with its strand mark (`.coord-gutter-right`: room for 11
 * characters, "12345678 3'", of 11px Google Sans Code).
 */
export const LINEAR_ROW_GUTTER_PX = 68 + 8 + 11 * 11 * 0.6;

/**
 * The bases per sequence row for a column `widthPx` wide (the content width of the rows' scroll
 * area): the largest multiple of 10 whose row fits, from LINEAR_ROW_MIN_BASES to LINEAR_ROW_MAX_BASES.
 */
export function linearRowLength(widthPx: number, advancePx: number = RESIDUE_ADVANCE_PX): number {
  if (!Number.isFinite(widthPx) || !(advancePx > 0)) return LINEAR_ROW_MAX_BASES;
  const fits = Math.floor((widthPx - LINEAR_ROW_GUTTER_PX) / advancePx / 10) * 10;
  return Math.max(LINEAR_ROW_MIN_BASES, Math.min(LINEAR_ROW_MAX_BASES, fits));
}

const ROWS_PER_PAGE = 20;
const SCHEMATIC_X0 = 38;
const SCHEMATIC_X1 = 762;
const SCHEMATIC_W = SCHEMATIC_X1 - SCHEMATIC_X0;

function isDarkFillHex(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.62;
}

function classifyProteinResidueCss(aa: string): string {
  switch (aa) {
    case 'A':
    case 'V':
    case 'I':
    case 'L':
    case 'M':
    case 'F':
    case 'W':
    case 'C':
      return 'aa-hydrophobic';
    case 'R':
    case 'K':
    case 'H':
      return 'aa-basic';
    case 'D':
    case 'E':
      return 'aa-acidic';
    case 'G':
    case 'P':
      return 'aa-gly-pro';
    default:
      return 'aa-polar';
  }
}

/**
 * Multi-lane greedy interval packer for the Linear Schematic Overview Track.
 * Ensures feature pills and labels never overlap horizontally or clip past SVG edges.
 */
export function layoutLinearSchematicFeatures(
  features: SequenceFeature[],
  seqLen: number,
  maxLanes = 3
): { placed: SchematicFeaturePlaced[]; laneCount: number } {
  const safeLen = Math.max(1, seqLen);
  // the 360 longest, when there are more; the view says how many of the document's it drew
  const cappedFeatures =
    features.length > 360
      ? [...features]
          .sort((a, b) => {
            const aStart = Number(a.qualifiers?.genomic_start) || a.start;
            const bStart = Number(b.qualifiers?.genomic_start) || b.start;
            const aEnd = Number(a.qualifiers?.genomic_end) || a.end;
            const bEnd = Number(b.qualifiers?.genomic_end) || b.end;
            return (bEnd - bStart) - (aEnd - aStart);
          })
          .slice(0, 360)
      : features;
  const sorted = [...cappedFeatures].sort(
    (a, b) => {
      const aStart = Number(a.qualifiers?.genomic_start) || a.start;
      const bStart = Number(b.qualifiers?.genomic_start) || b.start;
      const aEnd = Number(a.qualifiers?.genomic_end) || a.end;
      const bEnd = Number(b.qualifiers?.genomic_end) || b.end;
      return aStart - bStart || (bEnd - bStart) - (aEnd - aStart);
    }
  );

  const CHAR_W = 6.35;
  const LANE_GAP_X = 6;
  const SVG_LEFT_LIMIT = 8;
  const SVG_RIGHT_LIMIT = 792;

  const laneEnds = new Array<number>(maxLanes).fill(-Infinity);
  const placed: SchematicFeaturePlaced[] = [];

  for (const f of sorted) {
    const fStart = Number(f.qualifiers?.genomic_start) || f.start;
    const fEnd = Number(f.qualifiers?.genomic_end) || f.end;
    const x1 = SCHEMATIC_X0 + ((Math.max(1, fStart) - 1) / safeLen) * SCHEMATIC_W;
    const x2 = Math.max(
      x1 + 8,
      Math.min(SCHEMATIC_X1, SCHEMATIC_X0 + (Math.min(safeLen, fEnd) / safeLen) * SCHEMATIC_W)
    );
    const boxWidth = x2 - x1;
    const fullTextW = f.name.length * CHAR_W + 12;

    let desiredMode: 'inside' | 'outside-right' | 'outside-left' = 'inside';
    let desiredLabel = f.name;
    let occStart = x1;
    let occEnd = x2;

    if (boxWidth >= fullTextW) {
      desiredMode = 'inside';
      desiredLabel = f.name;
      occStart = x1;
      occEnd = x2;
    } else if (boxWidth >= 52) {
      const maxChars = Math.max(4, Math.floor((boxWidth - 12) / CHAR_W));
      desiredMode = 'inside';
      desiredLabel =
        f.name.length > maxChars ? `${f.name.slice(0, maxChars - 1)}…` : f.name;
      occStart = x1;
      occEnd = x2;
    } else {
      const shortName = f.name.length > 18 ? `${f.name.slice(0, 17)}…` : f.name;
      const sideW = shortName.length * CHAR_W + 6;
      if (x2 + sideW <= SVG_RIGHT_LIMIT) {
        desiredMode = 'outside-right';
        desiredLabel = shortName;
        occStart = x1;
        occEnd = x2 + sideW;
      } else {
        desiredMode = 'outside-left';
        desiredLabel = shortName;
        occStart = Math.max(SVG_LEFT_LIMIT, x1 - sideW);
        occEnd = x2;
      }
    }

    let chosenLane = -1;
    for (let lane = 0; lane < maxLanes; lane++) {
      if (occStart >= laneEnds[lane] + LANE_GAP_X) {
        chosenLane = lane;
        break;
      }
    }

    if (chosenLane !== -1) {
      laneEnds[chosenLane] = occEnd;
      const y = 32 + chosenLane * 21;
      const labelX =
        desiredMode === 'inside'
          ? (x1 + x2) / 2
          : desiredMode === 'outside-right'
          ? x2 + 4
          : x1 - 4;
      const textAnchor =
        desiredMode === 'inside'
          ? 'middle'
          : desiredMode === 'outside-right'
          ? 'start'
          : 'end';

      placed.push({
        feature: f,
        lane: chosenLane,
        x1,
        x2,
        y,
        boxWidth,
        labelMode: desiredMode,
        displayLabel: desiredLabel,
        labelX,
        textAnchor,
        occStart,
        occEnd,
      });
    } else {
      let boxLane = 0;
      for (let lane = 1; lane < maxLanes; lane++) {
        if (laneEnds[lane] < laneEnds[boxLane]) {
          boxLane = lane;
        }
      }
      laneEnds[boxLane] = Math.max(laneEnds[boxLane], x2);
      placed.push({
        feature: f,
        lane: boxLane,
        x1,
        x2,
        y: 32 + boxLane * 21,
        boxWidth,
        labelMode: 'none',
        displayLabel: '',
        labelX: (x1 + x2) / 2,
        textAnchor: 'middle',
        occStart: x1,
        occEnd: x2,
      });
    }
  }

  const maxUsedLane = placed.reduce((acc, p) => Math.max(acc, p.lane), 0);
  return { placed, laneCount: Math.max(1, maxUsedLane + 1) };
}

export interface NucleotideColorEntry {
  symbol: string;
  description: string;
  blockColor: string;
  textColor: string;
  bgColor: string;
}

export const DEFAULT_NUCLEOTIDE_COLOR_PALETTE: NucleotideColorEntry[] = [
  { symbol: 'A', description: 'Adenine', blockColor: '#ef4444', textColor: '#111827', bgColor: '#fecaca' },
  { symbol: 'C', description: 'Cytosine', blockColor: '#3b82f6', textColor: '#111827', bgColor: '#bfdbfe' },
  { symbol: 'G', description: 'Guanine', blockColor: '#eab308', textColor: '#111827', bgColor: '#fef08a' },
  { symbol: 'T', description: 'Thymine / Uracil', blockColor: '#22c55e', textColor: '#111827', bgColor: '#bbf7d0' },
  { symbol: 'R', description: 'Purine (A or G)', blockColor: '#f97316', textColor: '#111827', bgColor: '#fed7aa' },
  { symbol: 'Y', description: 'Pyrimidine (C or T)', blockColor: '#14b8a6', textColor: '#111827', bgColor: '#99f6e4' },
  { symbol: 'M', description: 'Amino (A or C)', blockColor: '#a855f7', textColor: '#111827', bgColor: '#e9d5ff' },
  { symbol: 'W', description: 'Weak (A or T)', blockColor: '#84cc16', textColor: '#111827', bgColor: '#d9f99d' },
  { symbol: 'S', description: 'Strong (C or G)', blockColor: '#06b6d4', textColor: '#111827', bgColor: '#a5f3fc' },
  { symbol: 'K', description: 'Keto (G or T)', blockColor: '#65a30d', textColor: '#111827', bgColor: '#ecfccb' },
  { symbol: 'B', description: 'Not A (C, G, or T)', blockColor: '#64748b', textColor: '#111827', bgColor: '#e2e8f0' },
  { symbol: 'D', description: 'Not C (A, G, or T)', blockColor: '#64748b', textColor: '#111827', bgColor: '#e2e8f0' },
  { symbol: 'H', description: 'Not G (A, C, or T)', blockColor: '#64748b', textColor: '#111827', bgColor: '#e2e8f0' },
  { symbol: 'V', description: 'Not T (A, C, or G)', blockColor: '#64748b', textColor: '#111827', bgColor: '#e2e8f0' },
  { symbol: 'N', description: 'Any base (A, C, G, or T)', blockColor: '#94a3b8', textColor: '#334155', bgColor: '#f1f5f9' },
  { symbol: 'I', description: 'Inosine', blockColor: '#94a3b8', textColor: '#334155', bgColor: '#f1f5f9' },
  { symbol: '?', description: 'Unloaded summary / Unknown', blockColor: '#cbd5e1', textColor: '#475569', bgColor: '#f8fafc' },
  { symbol: '-', description: 'Alignment Gap', blockColor: '#e2e8f0', textColor: '#64748b', bgColor: '#ffffff' },
];

export const NucleotideColorOptionsModal: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const [entries, setEntries] = useState<NucleotideColorEntry[]>(DEFAULT_NUCLEOTIDE_COLOR_PALETTE);

  return (
    <div
      className="mbc-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Color Options"
      onClick={onClose}
    >
      <div
        className="mbc-modal-window"
        style={{ maxWidth: 540, width: '94%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mbc-modal-header">
          <h3>Color Options</h3>
          <button type="button" className="mbc-modal-close" onClick={onClose} aria-label="Close Color Options">
            ✕
          </button>
        </div>
        <div className="mbc-modal-body" style={{ maxHeight: 460, overflowY: 'auto' }}>
          <div
            className="info-callout"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 4,
              marginBottom: 10,
              fontSize: 11.5,
            }}
          >
            <div>
              <strong>Block Swatch (Left):</strong> Used as the block color when zoomed out
            </div>
            <div>
              <strong>Text Swatch (Center):</strong> Used as the text color when zoomed in
            </div>
            <div>
              <strong>Background Swatch (Right):</strong> Used as the background color when zoomed in
            </div>
          </div>

          <table className="mbc-document-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>IUPAC Meaning</th>
                <th>Block Color</th>
                <th>Text Color</th>
                <th>Background</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row, idx) => (
                <tr key={row.symbol}>
                  <td>
                    <strong
                      style={{
                        display: 'inline-block',
                        minWidth: 22,
                        textAlign: 'center',
                        padding: '1px 5px',
                        borderRadius: 3,
                        color: row.textColor,
                        backgroundColor: row.bgColor,
                        border: `1px solid ${row.blockColor}`,
                      }}
                    >
                      {row.symbol}
                    </strong>
                  </td>
                  <td>{row.description}</td>
                  <td>
                    <input
                      type="color"
                      aria-label={`${row.symbol} block color`}
                      value={row.blockColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEntries((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, blockColor: val } : item))
                        );
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      aria-label={`${row.symbol} text color`}
                      value={row.textColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEntries((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, textColor: val } : item))
                        );
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      aria-label={`${row.symbol} background color`}
                      value={row.bgColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEntries((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, bgColor: val } : item))
                        );
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="mbc-modal-footer"
          style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px' }}
        >
          <button
            type="button"
            className="btn-secondary-sm"
            onClick={() => setEntries(DEFAULT_NUCLEOTIDE_COLOR_PALETTE)}
          >
            Restore Defaults
          </button>
          <button type="button" className="btn-primary-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const AA_ORDER_20 = [
  'A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L',
  'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y', '*',
] as const;

const CODON_ORDER_64 = [
  'TTT', 'TTC', 'TTA', 'TTG', 'CTT', 'CTC', 'CTA', 'CTG',
  'ATT', 'ATC', 'ATA', 'ATG', 'GTT', 'GTC', 'GTA', 'GTG',
  'TCT', 'TCC', 'TCA', 'TCG', 'CCT', 'CCC', 'CCA', 'CCG',
  'ACT', 'ACC', 'ACA', 'ACG', 'GCT', 'GCC', 'GCA', 'GCG',
  'TAT', 'TAC', 'TAA', 'TAG', 'CAT', 'CAC', 'CAA', 'CAG',
  'AAT', 'AAC', 'AAA', 'AAG', 'GAT', 'GAC', 'GAA', 'GAG',
  'TGT', 'TGC', 'TGA', 'TGG', 'CGT', 'CGC', 'CGA', 'CGG',
  'AGT', 'AGC', 'AGA', 'AGG', 'GGT', 'GGC', 'GGA', 'GGG',
] as const;

export const GenomeInspectorExtras: React.FC<{
  doc: SequenceDocument;
  selectedRange: { start: number; end: number; label?: string } | null;
  onSelectRange: (range: { start: number; end: number; label?: string }) => void;
}> = ({ doc, selectedRange, onSelectRange }) => {
  const isContigSummary = Boolean(doc.docMetadata?.['Is Contig Summary']);
  const declaredLength =
    Number(doc.docMetadata?.['Declared Length']) ||
    Number(String(doc.docMetadata?.['Sequence Length'] ?? '').replace(/,/g, '')) ||
    doc.sequence.length;

  const typeGroups = useMemo(() => {
    const map = new Map<string, SequenceFeature[]>();
    for (const f of doc.features) {
      const rawType = f.qualifiers?.raw_type || f.type;
      const list = map.get(rawType) ?? [];
      list.push(f);
      map.set(rawType, list);
    }
    return Array.from(map.entries());
  }, [doc.features]);

  const [typeCursor, setTypeCursor] = useState<Record<string, number>>({});

  // What Translation Statistics translates, named on the panel (BG-01M6S17C): a selection that is
  // exactly a CDS (its start..end, the bounding span) is that CDS, any other selection is read on
  // its + strand, and with none it is the first CDS, else the first 900 bp. A joined CDS is read
  // from its parts alone, in the order the record lists them, and named by them in INSDC's join()
  // syntax: the GenBank importer keeps start..end as the lowest and highest base, so an
  // origin-spanning join(571..600,1..30) spans 1..600 and a spliced CDS spans its introns. A CDS on
  // the - strand is read from the reverse complement of its joined parts, as Biopython's
  // feature.extract() reads complement(join(...)). A range whose start is past its end, which the
  // GenBank and EMBL importers and Find ORFs never write (each splits an origin-spanning
  // range into parts) but a hand-built feature may carry, runs across the origin.
  const translationTelemetry = useMemo(() => {
    const seqLen = doc.sequence.length;
    const cdsList = doc.features.filter((f) => f.type === 'CDS' || f.qualifiers?.raw_type === 'CDS');
    const cds = selectedRange
      ? cdsList.find((f) => f.start === selectedRange.start && f.end === selectedRange.end)
      : cdsList[0];
    const start = cds?.start ?? selectedRange?.start ?? 1;
    const end = cds?.end ?? selectedRange?.end ?? Math.min(seqLen, 900);
    const minus = cds?.strand === -1;
    const joined = cds?.segments && cds.segments.length > 1 ? cds.segments : null;
    const parts: [number, number][] = joined
      ? joined.map((s) => [s.start, s.end])
      : start > end
        ? [[start, seqLen], [1, end]]
        : [[start, end]];
    const span = joined
      ? `join(${parts.map(([a, b]) => (a === b ? `${a}` : `${a}..${b}`)).join(',')})`
      : `${start.toLocaleString()}..${end.toLocaleString()}`;
    const rangeLabel = cds
      ? `CDS ${cds.name}, ${span}, ${minus ? '- strand, read from its reverse complement' : '+ strand'}`
      : selectedRange
        ? `Selection ${span}, + strand`
        : `${end < seqLen ? `First ${end.toLocaleString()} bp` : 'Whole sequence'}, ${span}, + strand`;
    const forward = parts
      .map(([a, b]) => doc.sequence.slice(Math.max(0, a - 1), Math.min(seqLen, b)))
      .join('')
      .toUpperCase()
      .replace(/U/g, 'T');
    const rawSub = minus && forward ? reverseComplement(forward) : forward;

    const codonCounts: Record<string, number> = {};
    const aaCounts: Record<string, number> = {};
    for (const c of CODON_ORDER_64) codonCounts[c] = 0;
    for (const a of AA_ORDER_20) aaCounts[a] = 0;

    let translatedAa = '';
    const totalCodons = Math.floor(rawSub.length / 3);
    for (let i = 0; i + 2 < rawSub.length; i += 3) {
      const codon = rawSub.slice(i, i + 3);
      if (codon in codonCounts) codonCounts[codon] += 1;
      const aa = CODON_TABLE[codon] ?? 'X';
      translatedAa += aa;
      if (aa in aaCounts) aaCounts[aa] += 1;
    }

    const cleanAa = translatedAa.replace(/\*/g, '');
    // No residue (no complete codon, or only stops) has no protein to measure.
    const protStats = cleanAa ? analyzeProteinSequence(cleanAa, false, 9) : null;
    const nW = aaCounts.W ?? 0;
    const nY = aaCounts.Y ?? 0;
    const nC = aaCounts.C ?? 0;
    const extinctionCoeff = nW * 5500 + nY * 1490 + Math.floor(nC / 2) * 125;
    const mwDa = Math.max(110, (protStats?.molecularWeightKda ?? 0) * 1000);
    const abs280 = extinctionCoeff / mwDa;
    const chargePh7 =
      (aaCounts.K ?? 0) +
      (aaCounts.R ?? 0) +
      0.1 * (aaCounts.H ?? 0) -
      (aaCounts.D ?? 0) -
      (aaCounts.E ?? 0);

    return {
      rangeLabel,
      codonsCount: totalCodons,
      hasResidues: protStats !== null,
      mwKda: protStats?.molecularWeightKda ?? 0,
      isoelectricPoint: protStats?.isoelectricPointPi ?? 0,
      chargePh7,
      extinctionCoeff,
      abs280,
      aaCounts,
      codonCounts,
    };
  }, [doc.features, doc.sequence, selectedRange]);

  const baseCountA = Number(doc.docMetadata?.['Base Count A']) || 0;
  const baseCountC = Number(doc.docMetadata?.['Base Count C']) || 0;
  const baseCountG = Number(doc.docMetadata?.['Base Count G']) || 0;
  const baseCountT = Number(doc.docMetadata?.['Base Count T']) || 0;
  const hasExplicitBaseCounts = baseCountA + baseCountC + baseCountG + baseCountT > 0;

  return (
    <div className="mbc-genome-inspector-extras" style={{ marginTop: 8 }}>
      <div className="stat-kv">
        <span>Sequence Length:</span>
        <strong>
          {declaredLength.toLocaleString()} {doc.moleculeType === 'RNA' ? 'nt' : 'bp'}
        </strong>
      </div>
      {isContigSummary && (
        <div className="stat-kv">
          <span>Summary Reference Bases (?):</span>
          <strong>?: 100.0% ({declaredLength.toLocaleString()} bp)</strong>
        </div>
      )}
      {hasExplicitBaseCounts && (
        <div className="stat-kv">
          <span>Organelle Base Counts (A/C/G/T):</span>
          <strong>
            {baseCountA.toLocaleString()} / {baseCountC.toLocaleString()} /{' '}
            {baseCountG.toLocaleString()} / {baseCountT.toLocaleString()}
          </strong>
        </div>
      )}
      {doc.docMetadata?.['Annotation Provider (Genome-Annotation-Data)'] && (
        <div className="stat-kv">
          <span>Annotation Provider:</span>
          <strong>{String(doc.docMetadata['Annotation Provider (Genome-Annotation-Data)'])}</strong>
        </div>
      )}
      {doc.docMetadata?.['Annotation Pipeline (Genome-Annotation-Data)'] && (
        <div className="stat-kv">
          <span>Annotation Pipeline:</span>
          <strong>{String(doc.docMetadata['Annotation Pipeline (Genome-Annotation-Data)'])}</strong>
        </div>
      )}
      {doc.docMetadata?.['Genes (total) (Genome-Annotation-Data)'] && (
        <div className="stat-kv">
          <span>Genes / CDSs (NCBI RefSeq):</span>
          <strong>
            {String(doc.docMetadata['Genes (total) (Genome-Annotation-Data)'])} genes •{' '}
            {String(doc.docMetadata['CDSs (total) (Genome-Annotation-Data)'] ?? '-')} CDSs
          </strong>
        </div>
      )}

      {typeGroups.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 11.5, display: 'block', marginBottom: 4 }}>
            Annotation Types ({doc.features.length}):
          </strong>
          {typeGroups.map(([typeName, feats]) => {
            const cur = typeCursor[typeName] ?? 0;
            return (
              <div
                key={typeName}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11.5,
                  padding: '2px 0',
                }}
              >
                <span>
                  {typeName} ({feats.length})
                </span>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <button
                    type="button"
                    className="btn-page"
                    aria-label={`Previous ${typeName} annotation`}
                    onClick={() => {
                      const nextIdx = (cur - 1 + feats.length) % feats.length;
                      setTypeCursor((p) => ({ ...p, [typeName]: nextIdx }));
                      const f = feats[nextIdx];
                      if (f) {
                        onSelectRange({
                          start: f.start,
                          end: f.end,
                          label: `${f.name} (${typeName})`,
                        });
                      }
                    }}
                  >
                    &lt;
                  </button>
                  <button
                    type="button"
                    className="btn-page"
                    aria-label={`Next ${typeName} annotation`}
                    onClick={() => {
                      const nextIdx = (cur + 1) % feats.length;
                      setTypeCursor((p) => ({ ...p, [typeName]: nextIdx }));
                      const f = feats[nextIdx];
                      if (f) {
                        onSelectRange({
                          start: f.start,
                          end: f.end,
                          label: `${f.name} (${typeName})`,
                        });
                      }
                    }}
                  >
                    &gt;
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!isContigSummary && doc.moleculeType !== 'Protein' && (
        <details style={{ marginTop: 8, fontSize: 11.5 }} open={doc.folder === 'Genomes/Viruses'}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            Translation Statistics ({translationTelemetry.codonsCount.toLocaleString()} aa / codons)
          </summary>
          <div style={{ marginTop: 6 }}>
            <div className="stat-kv">
              <span>Translated range:</span>
              <strong>{translationTelemetry.rangeLabel}</strong>
            </div>
            {translationTelemetry.codonsCount === 0 ? (
              <p className="mbc-summary-note">This range holds no complete codon to translate.</p>
            ) : (
              <>
                <div className="stat-kv">
                  <span>Length (mean):</span>
                  <strong>{translationTelemetry.codonsCount.toLocaleString()} aa (codons)</strong>
                </div>
                {translationTelemetry.hasResidues && (
                  <>
                    <div className="stat-kv">
                      <span>Molecular weight (mean):</span>
                      <strong>{translationTelemetry.mwKda.toFixed(2)} kDa</strong>
                    </div>
                    <div className="stat-kv">
                      <span>Isoelectric point (mean):</span>
                      <strong>{translationTelemetry.isoelectricPoint.toFixed(2)}</strong>
                    </div>
                    <div className="stat-kv">
                      <span>Charge at pH 7:</span>
                      <strong>{translationTelemetry.chargePh7.toFixed(2)}</strong>
                    </div>
                    <div className="stat-kv">
                      <span>Extinction Coefficient (mean):</span>
                      <strong>{translationTelemetry.extinctionCoeff.toLocaleString()} M⁻¹cm⁻¹</strong>
                    </div>
                    <div className="stat-kv">
                      <span>A[280] of 1 mg/ml (mean):</span>
                      <strong>{translationTelemetry.abs280.toFixed(3)}</strong>
                    </div>
                  </>
                )}
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  <strong>20 Amino Acid Frequencies:</strong>{' '}
                  {AA_ORDER_20.map((aa) => `${aa}:${translationTelemetry.aaCounts[aa] ?? 0}`).join(' · ')}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, opacity: 0.9 }}>
                  <strong>64-Codon Table:</strong>
                  {/* One line per second base (T, C, A, G), 16 codons each: all 64. */}
                  {[0, 16, 32, 48].map((from) => (
                    <div key={from}>
                      {CODON_ORDER_64.slice(from, from + 16)
                        .map((cod) => `${cod}(${CODON_TABLE[cod] ?? '*'}):${translationTelemetry.codonCounts[cod] ?? 0}`)
                        .join(' ')}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
};

export const LinearSequenceView: React.FC<LinearSequenceViewProps> = ({
  doc,
  cutSites,
  restrictionScope = null,
  selectedRange,
  onSelectRange,
  onUpdateDocument,
  showTranslation = true,
  showGcGraph = true,
  showHydropathyGraph = false,
  colorScheme = 'standard',
  onLoadBenchmarkDocument,
  onClearSelection,
  onExtractSelection,
  onConvertSelectionToOligo,
  onStatusNotice,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [jumpCoordInput, setJumpCoordInput] = useState('');
  const [settledScrollRowOffset, setSettledScrollRowOffset] = useState(0);
  const [showAddFeature, setShowAddFeature] = useState(false);
  const [newFeatName, setNewFeatName] = useState('New_Annotation');
  const [newFeatType, setNewFeatType] = useState<FeatureType>('CDS');
  const [newFeatStart, setNewFeatStart] = useState(selectedRange?.start ?? 1);
  const [newFeatEnd, setNewFeatEnd] = useState(selectedRange?.end ?? 120);
  const [newFeatStrand, setNewFeatStrand] = useState<1 | -1>(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [colorOptionsOpen, setColorOptionsOpen] = useState(false);
  const [showDownloadSummaryTab, setShowDownloadSummaryTab] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  /** The schematic track, so its Export control saves the map and not a graph below it. */
  const schematicRef = useRef<HTMLDivElement | null>(null);

  const rawLen = doc.sequence.length;
  const seqLen = Math.max(1, rawLen);
  const isProtein = doc.moleculeType === 'Protein';
  const unitLabel = isProtein ? 'aa' : doc.moleculeType === 'RNA' ? 'nt' : 'bp';
  const isContigSummary = Boolean(doc.docMetadata?.['Is Contig Summary']);
  const declaredLen =
    Number(doc.docMetadata?.['Declared Length']) ||
    Number(String(doc.docMetadata?.['Sequence Length'] ?? '').replace(/,/g, '')) ||
    seqLen;

  // Fetch the real record from NCBI; never synthesize bases for a summary.
  const handleDownloadFullSequence = async () => {
    setShowDownloadSummaryTab(false);
    onStatusNotice?.(`Downloading ${doc.accession || doc.name} (${declaredLen.toLocaleString()} ${unitLabel}) from NCBI…`);
    try {
      const full = await downloadSummarySequence({ ...doc, sequence: '' });
      onUpdateDocument({ ...full, features: doc.features });
      onStatusNotice?.(`Downloaded ${doc.accession}: ${full.sequence.length.toLocaleString()} ${unitLabel} from NCBI.`);
    } catch (err) {
      onStatusNotice?.(`Download failed: ${err instanceof Error ? err.message : String(err)} The record is unchanged.`);
    }
  };

  // Rows wrap to the width of their column: the rows' scroll area is measured when it is drawn and
  // whenever it resizes. Until then (a static render) a row holds LINEAR_ROW_MAX_BASES.
  const [basesPerRow, setBasesPerRow] = useState(LINEAR_ROW_MAX_BASES);
  const rowsResizeObserverRef = useRef<ResizeObserver | null>(null);
  const attachRowsScroll = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el;
    rowsResizeObserverRef.current?.disconnect();
    rowsResizeObserverRef.current = null;
    if (!el) return;
    const measure = () => {
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      const padding = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 0;
      const width = el.clientWidth - padding;
      // A hidden column (no width) keeps the row length it was last drawn at.
      if (width > 0) setBasesPerRow(linearRowLength(width));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      rowsResizeObserverRef.current = observer;
    }
  }, []);

  const totalRows = Math.max(1, Math.ceil(seqLen / basesPerRow));
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));
  const safePageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));

  // The first base of the selection, and the page that holds it at this row length.
  const selectionStart = selectedRange
    ? Math.max(1, Math.min(seqLen, Math.min(selectedRange.start, selectedRange.end)))
    : null;
  const selectionPage =
    selectionStart === null ? null : Math.floor(Math.floor((selectionStart - 1) / basesPerRow) / ROWS_PER_PAGE);
  // A new row length keeps the selection's first base on the page or, with nothing selected, the
  // base the page started with.
  const [pagedRowLength, setPagedRowLength] = useState(basesPerRow);
  if (pagedRowLength !== basesPerRow) {
    setPagedRowLength(basesPerRow);
    setPageIndex(selectionPage ?? Math.floor((safePageIndex * pagedRowLength) / basesPerRow));
  }
  // Another document starts on its first page (or, below, on the page of its selection).
  const [pagedDocId, setPagedDocId] = useState(doc.id);
  if (pagedDocId !== doc.id) {
    setPagedDocId(doc.id);
    setPageIndex(0);
  }
  // A new selection (a feature clicked on the circle, a search hit, a jump) brings its first base
  // onto the page; the effect below scrolls its row into view inside the rows' own scroll area.
  const followKey = selectionStart === null ? null : `${doc.id}:${selectionStart}`;
  const [followedKey, setFollowedKey] = useState<string | null>(null);
  if (followKey !== followedKey) {
    setFollowedKey(followKey);
    if (selectionPage !== null) setPageIndex(selectionPage);
  }

  useEffect(() => {
    setSettledScrollRowOffset(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [doc.id]);

  // The selected row is scrolled to the top of the rows' scroll area when it is out of view there.
  // Only that area scrolls: the page and the viewer stay where they are.
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (selectionStart === null || !scroller || typeof requestAnimationFrame !== 'function') return undefined;
    const rowStart = Math.floor((selectionStart - 1) / basesPerRow) * basesPerRow + 1;
    const reveal = () => {
      const row = scroller.querySelector<HTMLElement>(`[data-row-start="${rowStart}"]`);
      const strand = row?.querySelector<HTMLElement>('.top-strand');
      if (!row || !strand) return;
      const view = scroller.getBoundingClientRect();
      const line = strand.getBoundingClientRect();
      if (line.top >= view.top && line.bottom <= view.bottom) return;
      const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      scroller.scrollTop += row.getBoundingClientRect().top - view.top - padTop;
    };
    reveal();
    // Rows drawn on demand (content-visibility) take their real height once in view, so look again.
    let second = 0;
    const first = requestAnimationFrame(() => {
      reveal();
      second = requestAnimationFrame(reveal);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey, safePageIndex, basesPerRow]);

  // Deferred scroll-settled coordinate update using native `scrollend` with a 120ms debounced
  // `setTimeout` custom `scrollend` fallback for unsupported WebViews.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof window === 'undefined') return;

    const supportsNativeScrollEnd = 'onscrollend' in window;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScrollEnd = () => {
      const approxRow = Math.max(0, Math.floor(el.scrollTop / 92));
      setSettledScrollRowOffset(approxRow);
    };

    const handleScrollFallback = () => {
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        el.dispatchEvent(new CustomEvent('scrollend'));
      }, 120);
    };

    el.addEventListener('scrollend', handleScrollEnd);
    if (!supportsNativeScrollEnd) {
      el.addEventListener('scroll', handleScrollFallback, { passive: true });
    }

    return () => {
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      el.removeEventListener('scrollend', handleScrollEnd);
      if (!supportsNativeScrollEnd) {
        el.removeEventListener('scroll', handleScrollFallback);
      }
    };
  }, [doc.id, safePageIndex]);

  const schematicLayout = useMemo(
    () => layoutLinearSchematicFeatures(doc.features, declaredLen, 3),
    [doc.features, declaredLen]
  );
  const schematicHeight = Math.max(76, 36 + schematicLayout.laneCount * 22);
  // The schematic draws the longest features when there are more than it holds, and says so (BG-01M6S1AA).
  const schematicCoverage = subsetNote('The map draws', schematicLayout.placed.length, doc.features.length, 'features', 'longest');

  // Resident Rust sequence store track overview (cached 180-bin GC%, AT%, cumulative GC-skew, oriC/terC)
  const trackOverview = useMemo(
    () => getResidentTrackOverviewRust(doc, 180),
    [doc]
  );
  const meanGc = meanGcWords(trackOverview);

  const gcProfilePoints = useMemo(() => {
    const gcBins = trackOverview.gcFractionBins;
    const atBins = trackOverview.atFractionBins;
    const skewBins = trackOverview.cumulativeGcSkewBins;
    const n = Math.max(1, gcBins.length);
    const gcPts: string[] = [];
    const atPts: string[] = [];
    const skewPts: string[] = [];

    let maxAbsSkew = 1e-6;
    for (let i = 0; i < skewBins.length; i++) {
      const a = Math.abs(skewBins[i]);
      if (a > maxAbsSkew) maxAbsSkew = a;
    }

    for (let i = 0; i < n; i++) {
      const x = SCHEMATIC_X0 + (i / Math.max(1, n - 1)) * SCHEMATIC_W;
      const yGc = 60 - (gcBins[i] ?? 0.5) * 36;
      const yAt = 60 - (atBins[i] ?? 0.5) * 36;
      const normSkew = 0.5 + ((skewBins[i] ?? 0) / (2 * maxAbsSkew));
      const ySkew = 60 - Math.max(0, Math.min(1, normSkew)) * 34;
      gcPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yGc.toFixed(1)}`);
      atPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yAt.toFixed(1)}`);
      skewPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ySkew.toFixed(1)}`);
    }
    return {
      gcPath: gcPts.join(' '),
      atPath: atPts.join(' '),
      skewPath: skewPts.join(' '),
    };
  }, [trackOverview]);

  const startRow = safePageIndex * ROWS_PER_PAGE;
  const endRow = Math.min(totalRows, startRow + ROWS_PER_PAGE);
  const pageStartPos = Math.min(seqLen, startRow * basesPerRow + 1);
  const pageEndPos = Math.max(pageStartPos, Math.min(seqLen, endRow * basesPerRow));
  const lookaheadEndPos = Math.min(seqLen, pageEndPos + 2);

  // Single O(window + log F) Resident Rust WASM viewport slice for the entire active page (<= 1,202 bp/aa)
  const pageSlice = useMemo(
    () => sliceResidentViewportRust(doc, pageStartPos, lookaheadEndPos),
    [doc, pageStartPos, lookaheadEndPos]
  );

  // Kyte-Doolittle Hydrophobicity profile computed over a bounded 1,800 bp/aa Resident viewport slice
  const hydropathyPath = useMemo(() => {
    if (!showHydropathyGraph) return '';
    const sampleSlice = sliceResidentViewportRust(
      doc,
      pageStartPos,
      Math.min(seqLen, pageStartPos + 1799)
    );
    const prot = analyzeProteinSequence(sampleSlice.topStrand, !isProtein, 9);
    const prof = prot.hydrophobicityProfile;
    if (prof.length === 0) return '';
    return prof
      .map((pt, idx) => {
        const x = SCHEMATIC_X0 + (idx / Math.max(1, prof.length - 1)) * SCHEMATIC_W;
        const norm = (pt.score + 4.5) / 9.0;
        const y = 60 - Math.max(0, Math.min(1, norm)) * 36;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [doc, pageStartPos, seqLen, showHydropathyGraph, isProtein]);

  // Resident Rust `rust-bio` FM-Index / BWT backward motif search across full multi-megabase sequences:
  // the first 100 hits by position on both strands, and the number of hits in the whole sequence.
  const searchResult = useMemo((): ResidentMotifSearchResult => {
    const q = searchQuery.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (q.length < 3) return { hits: [], totalHits: 0, warnings: [] };
    return searchResidentMotifFmIndexRust(doc, q, !isProtein, 100);
  }, [doc, searchQuery, isProtein]);
  const searchMatches = searchResult.hits;

  const handleJumpToCoordinate = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(jumpCoordInput.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    const clampedPos = Math.max(1, Math.min(seqLen, parsed));
    const targetRow = Math.floor((clampedPos - 1) / basesPerRow);
    setPageIndex(Math.floor(targetRow / ROWS_PER_PAGE));
    onSelectRange({
      start: clampedPos,
      end: Math.min(seqLen, clampedPos + 19),
      label: `Coordinate ${clampedPos.toLocaleString()} ${unitLabel}`,
    });
  };

  const handleCreateFeature = (e: React.FormEvent) => {
    e.preventDefault();
    const s = Math.max(1, Math.min(seqLen, Number(newFeatStart)));
    const end = Math.max(s, Math.min(seqLen, Number(newFeatEnd)));
    const newFeat: SequenceFeature = {
      id: `feat-user-${Date.now()}`,
      name: newFeatName.trim() || 'Annotation',
      type: newFeatType,
      start: s,
      end,
      strand: newFeatStrand,
      color:
        newFeatType === 'CDS'
          ? '#10b981'
          : newFeatType === 'promoter'
          ? '#0284c7'
          : newFeatType === 'crispr_guide'
          ? '#dc2626'
          : '#d97706',
      notes: 'Added in Sequence View',
    };
    onUpdateDocument({
      ...doc,
      features: [...doc.features, newFeat],
      updatedAt: new Date().toISOString(),
    });
    setShowAddFeature(false);
  };

  const pageOverlappingFeatures = useMemo(() => {
    if (pageSlice.overlappingFeatureIndices.length > 0) {
      return pageSlice.overlappingFeatureIndices
        .map((idx) => doc.features[idx])
        .filter((f): f is SequenceFeature => Boolean(f));
    }
    return doc.features.filter((f) => f.end >= pageStartPos && f.start <= pageEndPos);
  }, [doc.features, pageSlice.overlappingFeatureIndices, pageStartPos, pageEndPos]);

  const pageCuts = useMemo(
    () =>
      isProtein
        ? []
        : cutSites.filter((c) => c.position >= pageStartPos && c.position <= pageEndPos),
    [cutSites, isProtein, pageStartPos, pageEndPos]
  );
  // A partial cut-site scan says where it stops (BG-01M6RRSV): on every page that reaches past the
  // scanned range, and on every page of a scan with a reduced catalog, so a stretch with no sites
  // drawn does not read as one with none. A reduced catalog says which bases it scanned (the whole
  // sequence, or only the first), so it does not read as part of the sequence left out (BG-01M6RTP1).
  const scanFirst = isProtein ? undefined : restrictionScope?.firstBp?.toLocaleString();
  const scanCore = isProtein ? undefined : restrictionScope?.coreEnzymes?.toLocaleString();
  const cutScanNote =
    scanFirst && pageEndPos > (restrictionScope?.firstBp ?? 0)
      ? `Cut sites are shown for the first ${scanFirst} bp${scanCore ? ` and for ${scanCore} core enzymes` : ''} only: the rest was not scanned.`
      : scanCore
        ? `Cut sites are shown for ${scanCore} core enzymes only: ${scanFirst ? `the first ${scanFirst} bp were` : 'the whole sequence was'} scanned for them, and not for other enzymes.`
        : null;

  const pagePrimers = useMemo(
    () =>
      isProtein
        ? []
        : doc.primers.filter((p) => p.bindEnd >= pageStartPos && p.bindStart <= pageEndPos),
    [doc.primers, isProtein, pageStartPos, pageEndPos]
  );

  const rows = useMemo(() => {
    const builtRows = [];
    const topPage = pageSlice.topStrand;
    const botPage = pageSlice.bottomStrand;
    const protSsPage = pageSlice.proteinSecondaryStates ?? '';
    const protClsPage = pageSlice.proteinResidueClasses ?? '';

    for (let r = startRow; r < endRow; r++) {
      const rowStart = r * basesPerRow + 1;
      const rowEnd = Math.min(seqLen, (r + 1) * basesPerRow);
      const localOffset = rowStart - pageStartPos;
      const rowLen = Math.max(0, rowEnd - rowStart + 1);
      const topSlice = topPage.slice(localOffset, localOffset + rowLen);
      const botSlice = isProtein ? '' : botPage.slice(localOffset, localOffset + rowLen);
      const protSecondarySlice = isProtein
        ? protSsPage.slice(localOffset, localOffset + rowLen)
        : '';
      const protClassSlice = isProtein
        ? protClsPage.slice(localOffset, localOffset + rowLen)
        : '';

      const rowCuts = pageCuts.filter(
        (c) => c.position >= rowStart && c.position <= rowEnd
      );
      const rowFeatures = pageOverlappingFeatures.filter(
        (f) => f.end >= rowStart && f.start <= rowEnd
      );
      const rowPrimers = pagePrimers.filter(
        (p) => p.bindEnd >= rowStart && p.bindStart <= rowEnd
      );

      const buildFrameLine = (frameOffset: number) => {
        if (isProtein) return '';
        let line = '';
        for (let i = 0; i < topSlice.length; i++) {
          const globalZeroIdx = rowStart - 1 + i;
          const localCenterIdx = localOffset + i;
          if (
            (globalZeroIdx - frameOffset) % 3 === 1 &&
            globalZeroIdx >= frameOffset + 1 &&
            localCenterIdx >= 1 &&
            localCenterIdx + 1 < topPage.length
          ) {
            const codon = topPage
              .slice(localCenterIdx - 1, localCenterIdx + 2)
              .replace(/U/g, 'T');
            line += CODON_TABLE[codon] ?? 'X';
          } else {
            line += ' ';
          }
        }
        return line;
      };

      builtRows.push({
        rowStart,
        rowEnd,
        topSlice,
        botSlice,
        protSecondarySlice,
        protClassSlice,
        rowCuts,
        rowFeatures,
        rowPrimers,
        frame1: buildFrameLine(0),
        frame2: buildFrameLine(1),
        frame3: buildFrameLine(2),
      });
    }
    return builtRows;
  }, [
    startRow,
    endRow,
    basesPerRow,
    seqLen,
    pageStartPos,
    pageSlice,
    isProtein,
    pageCuts,
    pageOverlappingFeatures,
    pagePrimers,
  ]);

  const settledViewportStartPos = Math.min(
    pageEndPos,
    pageStartPos + settledScrollRowOffset * basesPerRow
  );

  const selectionQuickStats = useMemo(() => {
    if (!selectedRange || rawLen === 0) return null;
    const start = Math.max(1, Math.min(seqLen, Math.min(selectedRange.start, selectedRange.end)));
    const end = Math.max(start, Math.min(seqLen, Math.max(selectedRange.start, selectedRange.end)));
    const length = end - start + 1;
    if (isProtein) {
      return {
        start,
        end,
        length,
        gcPercent: null as number | null,
        tmBasicC: null as number | null,
        tmNoAnswerReason: null as string | null,
      };
    }
    // GC and Tm are the whole selection's, beside its full length, in one pass over its bases with no
    // copy (BG-01M6RTHN): they were taken from its first 12,000 bp only. They follow the engine's
    // status-bar readout (analyze_sequence_composition, iupac.rs): N and the other IUPAC codes
    // (S and W too) count toward the length only, so GC and the Tm divide by the A/C/G/T(U) count,
    // and the Wallace rule holds below 14 bases. The length the Tm reads is the selection's letters,
    // as the composition counts them: a gap ('-'), a stop ('*') or any other character that is not
    // a letter is no base, so it is neither in that length nor an ambiguity base.
    let gc = 0;
    let at = 0;
    let bases = 0;
    for (let i = start - 1; i < end; i++) {
      const code = doc.sequence.charCodeAt(i);
      const ch = code | 0x20; // folded to lower case
      if (ch === 0x67 || ch === 0x63) gc++; // g, c
      else if (ch === 0x61 || ch === 0x74 || ch === 0x75) at++; // a, t, u
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) bases++; // a letter, a base
    }
    const denom = Math.max(1, gc + at);
    const gcPercent = (gc / denom) * 100;
    // Whether the Tm has an answer is the cockpit's rule, read here and kept nowhere else
    // (basicTmHasNoAnswer, BG-01M6SHQ0): a selection holding N or any other base that is not A, C,
    // G or T has none, "Tm n/a" with the shared reason as its title, as in the status bar. It kept
    // its own copy, which read 26 N and 14 A/C/G/T as 37.4 °C. Otherwise the Wallace rule holds
    // below 14 bases and the basic formula from 14 up, on the bases: a gap counted in the length
    // read ACGTACGT-ACGTAC as "n/a: ... holds 1 N", and ACGTACGT-ACGTA by the 14-base formula.
    const tmNoAnswerReason = basicTmHasNoAnswer(bases, gc + at) ? tmNoAnswerSentence(bases - (gc + at)) : null;
    const tmBasicC =
      tmNoAnswerReason !== null ? null : bases < 14 ? 2 * at + 4 * gc : 64.9 + (41 * (gc - 16.4)) / denom;
    return {
      start,
      end,
      length,
      gcPercent: Math.max(0, Math.min(100, gcPercent)),
      tmBasicC,
      tmNoAnswerReason,
    };
  }, [selectedRange, rawLen, seqLen, isProtein, doc.sequence]);

  return (
    <div
      className={`linear-seq-container scheme-${colorScheme} ${
        isProtein ? 'molecule-protein' : ''
      }`}
    >
      {colorOptionsOpen && (
        <NucleotideColorOptionsModal onClose={() => setColorOptionsOpen(false)} />
      )}

      {/* Contig Summary Alert Banner & Download Tab */}
      {isContigSummary && (
        <div
          className="mbc-contig-summary-banner"
          role="region"
          aria-label="Contig Summary Notice"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            padding: '7px 12px',
            background: 'var(--mbc-amber-soft)',
            borderBottom: '1px solid var(--mbc-amber-border)',
            color: 'var(--mbc-text-main)',
            fontSize: 12,
          }}
        >
          <div>
            <strong>Selected sequences are only summaries</strong>
            <span style={{ marginLeft: 8, opacity: 0.9 }}>
              ({doc.name} • {declaredLen.toLocaleString()} {unitLabel} Contig Summary)
            </span>
          </div>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button
              type="button"
              className="btn-secondary-sm"
              onClick={() => setShowDownloadSummaryTab((v) => !v)}
            >
              Download Tab
            </button>
            <button
              type="button"
              className="btn-primary-sm"
              onClick={handleDownloadFullSequence}
            >
              Download Full Sequence(s)
            </button>
          </div>
        </div>
      )}

      {(isContigSummary && showDownloadSummaryTab) && (
        <div
          className="mbc-contig-download-pane"
          style={{
            padding: '12px 16px',
            background: 'var(--mbc-bg-elevated)',
            borderBottom: '1px solid var(--mbc-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: 12.5,
          }}
        >
          <span>This is only a summary, click &apos;Download&apos; to get the full document</span>
          <button
            type="button"
            className="btn-primary-sm"
            onClick={handleDownloadFullSequence}
          >
            Download
          </button>
        </div>
      )}

      {/* Linear Schematic Overview Track */}
      <div className="studio-card-header" style={{ paddingTop: 0 }}>
        <h4>Linear Map — {doc.name}</h4>
        <FigureExportButton
          compact
          targetRef={schematicRef}
          baseName={`${doc.name} — Linear Map`}
          title={`${doc.name} — linear sequence map`}
          table={{
            headers: ['Name', 'Type', 'Start', 'End', 'Length', 'Strand'],
            rows: doc.features.map((f) => [
              f.name,
              String(f.type),
              String(f.start),
              String(f.end),
              String(f.end - f.start + 1),
              f.strand === -1 ? '-' : '+',
            ]),
            caption: `${doc.name} — ${doc.features.length} features`,
          }}
        />
      </div>
      {schematicCoverage.length > 0 && (
        <div style={{ paddingInline: 10 }}>
          <ResultWarnings warnings={schematicCoverage} label="Linear map coverage" />
        </div>
      )}
      <div className="mbc-schematic-header" data-mbc-figure ref={schematicRef}>
        <svg
          viewBox={`0 0 800 ${schematicHeight}`}
          className="schematic-overview-svg"
          role="img"
          aria-label={`Linear schematic overview of ${doc.name}`}
        >
          <rect x="0" y="0" width="800" height={schematicHeight} fill="var(--mbc-bg-panel)" />
          <line
            x1={SCHEMATIC_X0}
            y1="23"
            x2={SCHEMATIC_X1}
            y2="23"
            stroke="var(--mbc-border-strong)"
            strokeWidth="1.5"
          />
          {/* Ruler ticks */}
          {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((frac, idx) => {
            const x = SCHEMATIC_X0 + frac * SCHEMATIC_W;
            const coord = Math.max(1, Math.round(frac * declaredLen));
            return (
              <g key={idx}>
                <line
                  x1={x}
                  y1="17"
                  x2={x}
                  y2="27"
                  stroke="var(--mbc-text-muted)"
                  strokeWidth="1.1"
                />
                <text
                  x={x}
                  y="13"
                  textAnchor="middle"
                  fill="var(--mbc-text-secondary)"
                  fontSize="11"
                  fontWeight="600"
                >
                  {coord.toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* Chromosomal oriC / terC Cumulative GC-Skew Markers */}
          {!isProtein && declaredLen >= 20_000 && (
            <>
              <g>
                <title>{`Predicted oriC (GC-skew minimum): ${trackOverview.predictedOricBp.toLocaleString()} bp`}</title>
                <circle
                  cx={SCHEMATIC_X0 + (trackOverview.predictedOricBp / declaredLen) * SCHEMATIC_W}
                  cy={23}
                  r={3.6}
                  fill="var(--mbc-green)"
                />
              </g>
              <g>
                <title>{`Predicted terC (GC-skew maximum): ${trackOverview.predictedTercBp.toLocaleString()} bp`}</title>
                <circle
                  cx={SCHEMATIC_X0 + (trackOverview.predictedTercBp / declaredLen) * SCHEMATIC_W}
                  cy={23}
                  r={3.6}
                  fill="var(--mbc-amber)"
                />
              </g>
            </>
          )}

          {/* Current Viewport Box */}
          <rect
            x={
              declaredLen > seqLen
                ? SCHEMATIC_X0 + ((startRow * basesPerRow) / declaredLen) * SCHEMATIC_W
                : SCHEMATIC_X0 + ((startRow * basesPerRow) / seqLen) * SCHEMATIC_W
            }
            y={4}
            width={Math.max(
              14,
              Math.min(
                SCHEMATIC_W,
                declaredLen > seqLen
                  ? (((endRow - startRow) * basesPerRow) / declaredLen) * SCHEMATIC_W
                  : (((endRow - startRow) * basesPerRow) / seqLen) * SCHEMATIC_W
              )
            )}
            height={schematicHeight - 8}
            fill="rgba(26, 115, 232, 0.09)"
            stroke="var(--mbc-blue)"
            strokeWidth="1.15"
            strokeDasharray="3 2"
          />

          {/* Multi-Lane Non-Overlapping Schematic Feature Pills */}
          {schematicLayout.placed.map((item) => {
            const f = item.feature;
            const insideLightText = isDarkFillHex(f.color);
            const gStart = Number(f.qualifiers?.genomic_start) || f.start;
            const gEnd = Number(f.qualifiers?.genomic_end) || f.end;
            const gLen = Number(f.qualifiers?.genomic_length) || gEnd - gStart + 1;
            const rawType = f.qualifiers?.raw_type || f.type;
            return (
              <g
                key={f.id}
                className="clickable-arc"
                onClick={() => {
                  const targetRow = Math.floor((f.start - 1) / basesPerRow);
                  setPageIndex(Math.floor(targetRow / ROWS_PER_PAGE));
                  onSelectRange({
                    start: f.start,
                    end: f.end,
                    label: `${f.name} (${rawType}: ${gStart.toLocaleString()}..${gEnd.toLocaleString()})`,
                  });
                }}
              >
                <title>{`${f.name} [${rawType}] ${gStart.toLocaleString()}..${gEnd.toLocaleString()} (${gLen.toLocaleString()} ${unitLabel})`}</title>
                {f.segments && f.segments.length > 1 ? (
                  // Joined feature (spliced / frameshifted / trans-spliced): one block per interval.
                  <>
                    <line
                      x1={item.x1}
                      x2={item.x1 + item.boxWidth}
                      y1={item.y + 8}
                      y2={item.y + 8}
                      stroke={f.color}
                      strokeWidth="1.4"
                      strokeDasharray="3 2"
                    />
                    {f.segments.map((seg) => {
                      const span = Math.max(1, gEnd - gStart + 1);
                      const sx = item.x1 + ((seg.start - gStart) / span) * item.boxWidth;
                      const sw = Math.max(3, ((seg.end - seg.start + 1) / span) * item.boxWidth);
                      return (
                        <rect
                          key={`${f.id}-seg-${seg.index}`}
                          x={sx}
                          y={item.y}
                          width={sw}
                          height={16}
                          rx={3.5}
                          fill={f.color}
                          stroke="rgba(15, 23, 42, 0.45)"
                          strokeWidth="0.8"
                        />
                      );
                    })}
                  </>
                ) : (
                  <rect
                    x={item.x1}
                    y={item.y}
                    width={item.boxWidth}
                    height={16}
                    rx={3.5}
                    fill={f.color}
                    stroke="rgba(15, 23, 42, 0.45)"
                    strokeWidth="0.8"
                  />
                )}
                {item.labelMode !== 'none' && (
                  <text
                    x={item.labelX}
                    y={item.y + 11.5}
                    textAnchor={item.textAnchor}
                    fill={
                      item.labelMode === 'inside'
                        ? insideLightText
                          ? '#ffffff'
                          : '#0f172a'
                        : 'var(--mbc-text-main)'
                    }
                    fontSize="11"
                    fontWeight="700"
                  >
                    {item.displayLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Multi-Row Wrapped Linear Genome Map for Complete Viral & Organelle Genomes */}
        {!isContigSummary &&
          (doc.folder === 'Genomes/Viruses' ||
            doc.folder === 'Genomes/Organelles' ||
            (doc.folder.startsWith('Genomes/') && declaredLen <= 500_000)) && (
          <svg
            viewBox="0 0 800 130"
            className="mbc-wrapped-genome-svg"
            role="img"
            aria-label={`Wrapped multi-row genome map of ${doc.name}`}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderTop: '1px solid var(--mbc-border)',
              ...chartMaxWidth(800),
            }}
          >
            <rect x="0" y="0" width="800" height="130" fill="var(--mbc-bg-panel)" />
            {[0, 1, 2, 3, 4].map((rowIdx) => {
              const rowSpan = Math.ceil(declaredLen / 5);
              const rStart = rowIdx * rowSpan + 1;
              const rEnd = Math.min(declaredLen, (rowIdx + 1) * rowSpan);
              const yBase = 18 + rowIdx * 24;
              const rowFeats = doc.features.filter((f) => f.end >= rStart && f.start <= rEnd);
              return (
                <g key={rowIdx}>
                  <text x="6" y={yBase + 3} fontSize="9.5" fill="var(--mbc-text-secondary)" fontWeight="600">
                    {rStart.toLocaleString()}
                  </text>
                  <line
                    x1={56}
                    y1={yBase}
                    x2={740}
                    y2={yBase}
                    stroke="var(--mbc-border-strong)"
                    strokeWidth="1.2"
                  />
                  <text x="744" y={yBase + 3} fontSize="9.5" fill="var(--mbc-text-secondary)" fontWeight="600">
                    {rEnd.toLocaleString()}
                  </text>
                  {rowFeats.slice(0, 18).flatMap((f) => {
                    const parts = f.segments && f.segments.length > 1 ? f.segments : [f];
                    return parts
                      .filter((part) => part.end >= rStart && part.start <= rEnd)
                      .map((part, k) => {
                        const segStart = Math.max(rStart, part.start);
                        const segEnd = Math.min(rEnd, part.end);
                        const x1 = 56 + ((segStart - rStart) / Math.max(1, rEnd - rStart)) * 684;
                        const x2 = Math.max(x1 + 3, 56 + ((segEnd - rStart) / Math.max(1, rEnd - rStart)) * 684);
                        return (
                          <rect
                            key={`${rowIdx}-${f.id}-${k}`}
                            x={x1}
                            y={yBase - 6}
                            width={x2 - x1}
                            height={9}
                            rx={2}
                            fill={f.color}
                          >
                            <title>{`${f.name} (${f.qualifiers?.raw_type || f.type}) ${part.start.toLocaleString()}..${part.end.toLocaleString()}${parts.length > 1 ? ` (part ${k + 1} of ${parts.length})` : ''}`}</title>
                          </rect>
                        );
                      });
                  })}
                </g>
              );
            })}
          </svg>
        )}

        {/* Graphs Track (Resident GC% / AT% / GC-Skew or Protein Kyte-Doolittle Hydrophobicity) */}
        {((!isProtein && showGcGraph) || showHydropathyGraph) && (
          <div data-mbc-figure>
          <div className="studio-card-header" style={{ paddingTop: 0 }}>
            <h4>{isProtein || showHydropathyGraph ? 'Hydropathy Track' : 'GC Content Track'}</h4>
            <FigureExportButton
              compact
              baseName={`${doc.name} — ${isProtein || showHydropathyGraph ? 'Hydropathy' : 'GC'} Track`}
              title={`${doc.name} — ${isProtein || showHydropathyGraph ? 'hydropathy' : 'GC content'} track`}
            />
          </div>
          <svg viewBox="0 0 800 66" className="mbc-graphs-track-svg">
            <rect x="0" y="0" width="800" height="66" fill="var(--mbc-bg-elevated)" />
            <line
              x1={SCHEMATIC_X0}
              y1="42"
              x2={SCHEMATIC_X1}
              y2="42"
              stroke="var(--mbc-border)"
              strokeDasharray="3 3"
            />
            {!isProtein && showGcGraph && (
              <>
                <text x={SCHEMATIC_X0} y="15" fill="var(--mbc-blue)" fontSize="11" fontWeight="700">
                  Graphs: — %GC ({meanGc.value}{meanGc.approx ? `, ${meanGc.approx}` : ''})   -- %AT   ⋯ Cum. GC-Skew
                </text>
                <path
                  d={gcProfilePoints.gcPath}
                  fill="none"
                  stroke="var(--mbc-blue)"
                  strokeWidth="1.6"
                />
                <path
                  d={gcProfilePoints.atPath}
                  fill="none"
                  stroke="var(--mbc-amber)"
                  strokeWidth="1.2"
                  strokeDasharray="2.5 2.5"
                />
                <path
                  d={gcProfilePoints.skewPath}
                  fill="none"
                  stroke="var(--mbc-teal)"
                  strokeWidth="1.15"
                  strokeDasharray="1.5 2.5"
                />
              </>
            )}
            {showHydropathyGraph && hydropathyPath && (
              <>
                <text
                  x={isProtein ? SCHEMATIC_X0 : 395}
                  y="15"
                  fill="var(--mbc-purple)"
                  fontSize="11"
                  fontWeight="700"
                >
                  — Kyte-Doolittle Hydrophobicity (Window {pageStartPos.toLocaleString()} {unitLabel})
                </text>
                <path
                  d={hydropathyPath}
                  fill="none"
                  stroke="var(--mbc-purple)"
                  strokeWidth="1.6"
                />
              </>
            )}
          </svg>
          </div>
        )}
      </div>

      {/* Sequence View Sub-Toolbar */}
      <div className="linear-toolbar">
        <div className="search-box-group">
          <div className="seq-search-and-jump-row">
            <input
              id="mbc-seq-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isProtein
                  ? 'FM-Index motif search in protein (e.g. RGD, CxxC, VEV)...'
                  : "FM-Index search in sequence (5'->3' or RevComp, e.g. GAATTC)..."
              }
              className="seq-search-input"
            />
            <form className="coord-jump-form" onSubmit={handleJumpToCoordinate}>
              <input
                type="text"
                inputMode="numeric"
                value={jumpCoordInput}
                onChange={(e) => setJumpCoordInput(e.target.value)}
                placeholder={`Go to ${unitLabel}...`}
                aria-label={`Jump to ${unitLabel} coordinate`}
                className="coord-jump-input"
              />
              <button type="submit" className="btn-secondary-sm">
                Go
              </button>
            </form>
          </div>
          {searchMatches.length > 0 && (
            // Every hit the list holds has a jump button; the row is at most three control heights
            // tall and scrolls beyond that.
            <div
              className="search-hit-pills"
              style={{ maxHeight: 'calc(3 * var(--mbc-control-h-md))', overflowY: 'auto' }}
            >
              <span className="hit-count-badge">
                {searchResult.totalHits.toLocaleString()} FM-Index hits:
              </span>
              {searchMatches.map((m, idx) => (
                <button
                  type="button"
                  key={idx}
                  className="hit-jump-btn"
                  onClick={() => {
                    const targetRow = Math.floor((m.start - 1) / basesPerRow);
                    setPageIndex(Math.floor(targetRow / ROWS_PER_PAGE));
                    onSelectRange({
                      start: m.start,
                      end: m.end,
                      label: isProtein
                        ? `Motif ${m.start}..${m.end}`
                        : `Match (${m.strand === 1 ? '+' : '-'} strand)`,
                    });
                  }}
                >
                  {m.start.toLocaleString()}..{m.end.toLocaleString()}
                  {!isProtein ? ` (${m.strand === 1 ? '+' : '-'})` : ''}
                </button>
              ))}
            </div>
          )}
          <ResultWarnings warnings={searchResult.warnings} label="Search warnings" />
        </div>

        <div className="linear-toolbar-actions">
          <div className="linear-toolbar-left-pills">
            <button
              type="button"
              className="btn-secondary-sm"
              onClick={() => {
                if (selectedRange) {
                  setNewFeatStart(selectedRange.start);
                  setNewFeatEnd(selectedRange.end);
                }
                setShowAddFeature(!showAddFeature);
              }}
            >
              + Add Annotation
            </button>
            <button
              type="button"
              className="btn-secondary-sm"
              onClick={() => setColorOptionsOpen(true)}
              title="Open Nucleotide & Ambiguity Color Options"
            >
              Color Options
            </button>
            {onLoadBenchmarkDocument && (
              <>
                <button
                  type="button"
                  className="btn-secondary-sm"
                  onClick={() => onLoadBenchmarkDocument('genome-500k')}
                  title="Generate & open a 500,000 bp annotated chromosome in the Resident Rust Sequence Store"
                >
                  500 kbp Genome
                </button>
                <button
                  type="button"
                  className="btn-secondary-sm"
                  onClick={() => onLoadBenchmarkDocument('protein-10k')}
                  title="Generate & open a 10,000 aa multi-domain polyprotein in the Resident Rust Sequence Store"
                >
                  10k aa Protein
                </button>
              </>
            )}
            <span className="resident-window-badge" title="Active Resident Rust viewport coordinate & local GC%">
              {isProtein
                ? `At ${settledViewportStartPos.toLocaleString()} aa`
                : `Window GC ${pageSlice.windowGcPercent.toFixed(1)}%`}
            </span>
          </div>

          <div className="pagination-group">
            <button
              type="button"
              className="btn-page"
              disabled={safePageIndex === 0}
              onClick={() => setPageIndex(0)}
              title="First page"
            >
              ⏮
            </button>
            <button
              type="button"
              className="btn-page"
              disabled={safePageIndex === 0}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            >
              ◀ Prev
            </button>
            <span className="page-indicator">
              {pageStartPos.toLocaleString()}–{pageEndPos.toLocaleString()} of{' '}
              {seqLen.toLocaleString()} {unitLabel}
            </span>
            <button
              type="button"
              className="btn-page"
              disabled={safePageIndex >= totalPages - 1}
              onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next ▶
            </button>
            <button
              type="button"
              className="btn-page"
              disabled={safePageIndex >= totalPages - 1}
              onClick={() => setPageIndex(totalPages - 1)}
              title="Last page"
            >
              ⏭
            </button>
          </div>
        </div>
      </div>

      {/* Contextual Selection Quick-Action Bar */}
      {selectionQuickStats && (
        <div
          className="seq-selection-quickbar"
          role="region"
          aria-label="Selected Sequence Region Actions"
        >
          <div className="seq-selection-quickbar-summary">
            <strong>
              {selectedRange?.label ? `${selectedRange.label} · ` : ''}
              {selectionQuickStats.start.toLocaleString()}..{selectionQuickStats.end.toLocaleString()}
            </strong>
            <span>
              ({selectionQuickStats.length.toLocaleString()} {unitLabel}
              {selectionQuickStats.gcPercent !== null && (
                <>
                  {` · GC ${selectionQuickStats.gcPercent.toFixed(1)}% · Tm `}
                  {selectionQuickStats.tmBasicC === null ? (
                    <span title={selectionQuickStats.tmNoAnswerReason ?? undefined}>n/a</span>
                  ) : (
                    `${selectionQuickStats.tmBasicC.toFixed(1)} °C`
                  )}
                </>
              )}
              )
            </span>
          </div>
          <div className="seq-selection-quickbar-actions">
            <button
              type="button"
              className="seq-quick-pill-btn"
              onClick={() => {
                const sub = doc.sequence.slice(selectionQuickStats.start - 1, selectionQuickStats.end);
                navigator.clipboard?.writeText(sub);
                onStatusNotice?.(
                  `Copied ${sub.length.toLocaleString()} ${unitLabel} (${selectionQuickStats.start}..${selectionQuickStats.end}) to clipboard.`
                );
              }}
              title={isProtein ? 'Copy selected amino acid sequence' : "Copy selected 5'→3' sequence"}
            >
              {isProtein ? 'Copy AA' : "Copy 5'→3'"}
            </button>
            {!isProtein && (
              <button
                type="button"
                className="seq-quick-pill-btn"
                onClick={() => {
                  const sub = doc.sequence.slice(selectionQuickStats.start - 1, selectionQuickStats.end);
                  const rc = reverseComplement(sub);
                  navigator.clipboard?.writeText(rc);
                  onStatusNotice?.(
                    `Copied Reverse Complement (${rc.length.toLocaleString()} bp, ${selectionQuickStats.start}..${selectionQuickStats.end}) to clipboard.`
                  );
                }}
                title="Copy Reverse Complement of selected region"
              >
                Copy RevComp
              </button>
            )}
            <button
              type="button"
              className="seq-quick-pill-btn"
              onClick={() => {
                setNewFeatStart(selectionQuickStats.start);
                setNewFeatEnd(selectionQuickStats.end);
                setShowAddFeature(true);
              }}
              title="Create a new feature annotation spanning the active selection"
            >
              + Annotate
            </button>
            {onExtractSelection && (
              <button
                type="button"
                className="seq-quick-pill-btn"
                onClick={onExtractSelection}
                title="Extract selected region into a new sequence document"
              >
                Extract Region
              </button>
            )}
            {!isProtein &&
              selectionQuickStats.length >= 12 &&
              selectionQuickStats.length <= 80 &&
              onConvertSelectionToOligo && (
                <button
                  type="button"
                  className="seq-quick-pill-btn"
                  onClick={onConvertSelectionToOligo}
                  title="Save selected 12–80 bp region as a primer/oligo"
                >
                  + Save Oligo
                </button>
              )}
            {onClearSelection && (
              <button
                type="button"
                className="seq-quick-pill-btn"
                onClick={onClearSelection}
                title="Clear active sequence selection"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {showAddFeature && (
        <form className="add-feature-drawer" onSubmit={handleCreateFeature}>
          <strong>New Annotation:</strong>
          <input
            type="text"
            value={newFeatName}
            onChange={(e) => setNewFeatName(e.target.value)}
            placeholder="Name"
          />
          <select
            value={newFeatType}
            onChange={(e) => setNewFeatType(e.target.value as FeatureType)}
          >
            <option value="CDS">CDS</option>
            <option value="promoter">promoter</option>
            <option value="terminator">terminator</option>
            <option value="rep_origin">rep_origin</option>
            <option value="regulatory">regulatory</option>
            <option value="crispr_guide">crispr_guide</option>
            <option value="tag">tag</option>
            <option value="sig_peptide">sig_peptide</option>
            <option value="secondary_structure">secondary_structure</option>
            <option value="misc_feature">misc_feature</option>
          </select>
          <label>
            Start:
            <input
              type="number"
              min={1}
              max={seqLen}
              value={newFeatStart}
              onChange={(e) => setNewFeatStart(Number(e.target.value))}
            />
          </label>
          <label>
            End:
            <input
              type="number"
              min={1}
              max={seqLen}
              value={newFeatEnd}
              onChange={(e) => setNewFeatEnd(Number(e.target.value))}
            />
          </label>
          <select
            value={newFeatStrand}
            onChange={(e) => setNewFeatStrand(Number(e.target.value) as 1 | -1)}
          >
            <option value={1}>Forward (+)</option>
            <option value={-1}>Reverse (-)</option>
          </select>
          <button type="submit" className="btn-primary-sm">
            Save
          </button>
        </form>
      )}

      {cutScanNote && (
        <p className="mbc-summary-note" role="note" style={{ padding: '6px 10px' }}>
          {cutScanNote}
        </p>
      )}

      <div
        ref={attachRowsScroll}
        className="sequence-blocks-scroll"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'PageDown') {
            e.preventDefault();
            setPageIndex((p) => Math.min(totalPages - 1, p + 1));
          } else if (e.key === 'PageUp') {
            e.preventDefault();
            setPageIndex((p) => Math.max(0, p - 1));
          }
        }}
      >
        {rows.map((row, rowIdx) => (
          <div
            key={row.rowStart}
            data-row-start={row.rowStart}
            className={`seq-row-block ${rowIdx >= 4 ? 'seq-row-deferred' : ''}`}
          >
            {(row.rowCuts.length > 0 || row.rowPrimers.length > 0) && (
              <div className="seq-track-markers">
                {row.rowCuts.map((c) => (
                  <span
                    key={c.id}
                    className={`cut-pill ${c.enzyme.isTypeIIS ? 'type2s' : ''}`}
                    onClick={() =>
                      onSelectRange({
                        start: c.position,
                        end: c.position + c.enzyme.recognitionSeq.length - 1,
                        label: `${c.enzyme.name} (${c.overhangType}: ${
                          c.overhangSeq || 'blunt'
                        })`,
                      })
                    }
                  >
                    ▼ {c.enzyme.name} ({cutSiteDisplayPosition(c.cutTop, doc.sequence.length, doc.topology === 'circular')})
                  </span>
                ))}
                {row.rowPrimers.map((p) => (
                  <span
                    key={p.id}
                    className="primer-pill"
                    title={p.tmNoAnswerReason}
                    onClick={() =>
                      onSelectRange({
                        start: p.bindStart,
                        end: p.bindEnd,
                        label: `Primer ${p.name}`,
                      })
                    }
                  >
                    {p.strand === 1 ? '▶' : '◀'} {p.name} ({p.tmNoAnswerReason ? 'Tm n/a' : `Tm ${p.tmAnnealC}°C`})
                  </span>
                ))}
              </div>
            )}

            <div className="seq-strand-line top-strand">
              <span className="coord-gutter">
                {isProtein ? 'N ' : "5' "}
                {String(row.rowStart).padStart(7, ' ')}
              </span>
              <span className="mono-bases">
                {row.topSlice.split('').map((ch, idx) => {
                  const pos = row.rowStart + idx;
                  const inSel =
                    selectedRange &&
                    pos >= selectedRange.start &&
                    pos <= selectedRange.end;
                  const tokenClass = isProtein
                    ? `aa-res ${classifyProteinResidueCss(ch)}`
                    : `base-ch base-${ch === 'U' ? 'T' : ch}`;
                  return (
                    <span
                      key={idx}
                      className={`${tokenClass} ${inSel ? 'sel-base' : ''}`}
                      onClick={() =>
                        onSelectRange({
                          start: pos,
                          end: Math.min(seqLen, pos + 19),
                        })
                      }
                    >
                      {ch}
                    </span>
                  );
                })}
              </span>
              <span className="coord-gutter-right">
                {row.rowEnd} {isProtein ? 'C' : "3'"}
              </span>
            </div>

            {!isProtein ? (
              <>
                <div className="seq-strand-line bottom-strand">
                  <span className="coord-gutter">3&apos; {' '.repeat(7)}</span>
                  <span className="mono-bases comp-bases">{row.botSlice}</span>
                  <span className="coord-gutter-right">5&apos;</span>
                </div>

                {showTranslation && (
                  <>
                    <div className="seq-strand-line aa-frame-line">
                      <span className="coord-gutter">Frame +1</span>
                      <span className="mono-bases aa-track">{row.frame1}</span>
                    </div>
                    <div className="seq-strand-line aa-frame-line">
                      <span className="coord-gutter">Frame +2</span>
                      <span className="mono-bases aa-track">{row.frame2}</span>
                    </div>
                    <div className="seq-strand-line aa-frame-line">
                      <span className="coord-gutter">Frame +3</span>
                      <span className="mono-bases aa-track">{row.frame3}</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                {row.protClassSlice && (
                  <div
                    className="seq-strand-line bottom-strand"
                    title="Biochemical class symbols (non-color indicator): H = Hydrophobic, P = Polar, + = Basic, - = Acidic, G = Gly/Pro"
                  >
                    <span className="coord-gutter">Biochem</span>
                    <span className="mono-bases comp-bases">{row.protClassSlice}</span>
                  </div>
                )}
                {showTranslation && row.protSecondarySlice && (
                  <div
                    className="seq-strand-line aa-frame-line"
                    title="Garnier-Osguthorpe-Robson (GOR) secondary structure track: H = alpha-helix, E = beta-strand, C = coil"
                  >
                    <span className="coord-gutter">GOR 2°SS</span>
                    <span className="mono-bases aa-track">{row.protSecondarySlice}</span>
                  </div>
                )}
              </>
            )}

            {row.rowFeatures.length > 0 && (
              <div className="row-features-bars">
                {row.rowFeatures.map((f) => {
                  const gStart = Number(f.qualifiers?.genomic_start) || f.start;
                  const gEnd = Number(f.qualifiers?.genomic_end) || f.end;
                  const rawType = f.qualifiers?.raw_type || f.type;
                  return (
                    <div
                      key={f.id}
                      className="feature-inline-bar"
                      style={{
                        borderColor: f.color,
                        backgroundColor: `${f.color}20`,
                      }}
                      onClick={() =>
                        onSelectRange({
                          start: f.start,
                          end: f.end,
                          label: `${f.name} (${rawType})`,
                        })
                      }
                    >
                      <span className="feat-bar-title">
                        {f.strand === 1 ? '▶' : '◀'} {f.name} ({rawType}:{' '}
                        {gStart.toLocaleString()}..{gEnd.toLocaleString()})
                      </span>
                      {f.notes && <span className="feat-bar-note">{f.notes}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {doc.folder.startsWith('Genomes/') && (
          <GenomeInspectorExtras
            doc={doc}
            selectedRange={selectedRange}
            onSelectRange={onSelectRange}
          />
        )}
      </div>
    </div>
  );
};
