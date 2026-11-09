// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useMemo, useState } from 'react';
import {
  calculatePrimerMetrics,
  tmNoAnswerSentence,
  translateSequence,
} from '../core/bioEngine';
import type {
  RestrictionCutSite,
  SequenceDocument,
} from '../types/bio';

export interface SelectedRange {
  start: number;
  end: number;
  label?: string;
}

/**
 * Okabe-Ito (2008) perceptually uniform, colorblind-safe biological feature palette.
 */
export const OKABE_ITO_FEATURE_PALETTE: Record<string, string> = {
  CDS: '#0072B2',          // Blue
  promoter: '#009E73',     // Bluish Green
  terminator: '#D55E00',   // Vermilion
  rep_origin: '#E69F00',   // Orange
  primer_bind: '#CC79A7',  // Reddish Purple
  enhancer: '#56B4E9',     // Sky Blue
  regulatory: '#F0E442',   // Yellow
  misc_feature: '#64748B', // Neutral Slate
};

/**
 * Whether a stretch of `length` bases, `acgt` of them A, C, G or T (U read as T, either case), has
 * no Tm (BG-01M6SHQ0): any other base, N or another IUPAC code, leaves it none, on the Wallace path
 * below 14 bases, the %GC path from 14 up and the nearest-neighbour path alike, as primer3-py 2.4.0
 * `calc_tm` refuses it (Biopython 1.88 `Tm_GC(strict=True)` refuses N, R and Y, though not S or W).
 * It read 26 N and 14 A/C/G/T as 37.4 °C
 * by %GC over the A/C/G/T bases and 68 °C by nearest neighbour. The status bar, Statistics, the
 * cockpit and the linear view's quickbar all read "n/a" by this one rule, with tmNoAnswerSentence.
 */
export const basicTmHasNoAnswer = (length: number, acgt: number) => acgt < length;

/** Frame +1 is translated this many bases (whole codons) at a time while its first stop is sought. */
const STOP_SCAN_WINDOW_NT = 3_000;

/**
 * The residues bases `from`..`to` (0-based, `to` excluded) code in frame +1 before its first stop
 * codon: the length of Biopython's translate(to_stop=True) (BG-01M6RZJF). The engine reads every
 * whole codon (an ambiguous one that can only be a stop, such as TAR, is a stop; lower case and U
 * read as upper case and T) and no part codon at the end. It translates a window at a time and stops
 * at the first window that holds a stop, translating none of the span past that window.
 */
const residuesToFirstStop = (sequence: string, from: number, to: number): number => {
  let residues = 0;
  for (let at = from; to - at >= 3; at += STOP_SCAN_WINDOW_NT) {
    const aa = translateSequence(sequence.slice(at, Math.min(to, at + STOP_SCAN_WINDOW_NT)), 0);
    const stop = aa.indexOf('*');
    if (stop >= 0) return residues + stop;
    residues += aa.length;
  }
  return residues;
};

export interface ConstructCockpitBarProps {
  doc: SequenceDocument;
  cutSites: RestrictionCutSite[];
  /**
   * Each enzyme's complete site count over what `cutSites` cover (the scan's `siteCounts`,
   * BG-01M6S1K2), which `cutSites` may hold only the first sites of; absent, counted from `cutSites`.
   */
  siteCounts?: Readonly<Record<string, number>>;
  selectedRange: SelectedRange | null;
  onSelectRange: (range: SelectedRange | null) => void;
  onJumpToStudio?: (studioId: 'primers-pcr' | 'cloning-gel' | 'sequence-alignment' | 'guided-pipelines') => void;
  onExtractSelection?: () => void;
  colorblindSafe?: boolean;
}

export const ConstructCockpitBar: React.FC<ConstructCockpitBarProps> = ({
  doc,
  cutSites,
  siteCounts,
  selectedRange,
  onSelectRange,
  onJumpToStudio,
  onExtractSelection,
  colorblindSafe = true,
}) => {
  const seqLen = Math.max(1, doc.sequence.length);
  const [hoveredLocus, setHoveredLocus] = useState<string | null>(null);

  // How many sites each enzyme has: the scan's complete counts, or the sites handed in.
  const enzymeSiteCounts = useMemo((): Readonly<Record<string, number>> => {
    if (siteCounts) return siteCounts;
    const counts: Record<string, number> = {};
    for (const cs of cutSites) counts[cs.enzyme.name] = (counts[cs.enzyme.name] ?? 0) + 1;
    return counts;
  }, [cutSites, siteCounts]);

  // Compute live biophysical & thermodynamic metrics for active selection (or whole sequence)
  const telemetry = useMemo(() => {
    const start = selectedRange ? Math.max(1, Math.min(seqLen, selectedRange.start, selectedRange.end)) : 1;
    const end = selectedRange ? Math.max(start, Math.min(seqLen, Math.max(selectedRange.start, selectedRange.end))) : seqLen;
    const spanLen = Math.max(1, end - start + 1);
    const slice = doc.sequence.slice(start - 1, Math.min(end, start - 1 + 4000)).toUpperCase();

    if (doc.moleculeType === 'Protein') {
      return {
        start,
        end,
        spanLen,
        gcPct: 0,
        gcSkew: 0,
        tmC: null as number | null,
        tmNoAnswer: false,
        tmNoAnswerReason: null as string | null,
        deltaG: null as number | null,
        mwKda: Number(((spanLen * 110.0) / 1000).toFixed(2)),
        peptidePreview: slice.slice(0, 18),
        previewOf: spanLen,
        orfBadge: null as { tone: 'pass' | 'info' | 'warn'; label: string; title: string } | null,
        uniqueCuttersInSpan: [] as string[],
      };
    }

    // GC, its skew and the long-span Tm are the whole span's, beside its full length, in one pass
    // over its bases with no copy (BG-01M6RTHN): they were taken from its first 4,000 bp only, so a
    // 200 kb sequence with an AT-rich head read that head's GC beside "Full Span: 1..200,000". N and
    // the other IUPAC codes are left out of the count, as the engine's composition leaves them out.
    // They are counted apart, as the letters that are not A, C, G, T or U: the Tm rule's k. A gap
    // ('-'), a stop ('*') or any other character that is not a letter is no base at all, as the
    // composition reads it (analyze_sequence_composition, iupac.rs), so it is neither.
    let g = 0;
    let c = 0;
    let a = 0;
    let t = 0;
    let ambiguity = 0;
    for (let i = start - 1; i < end; i++) {
      const code = doc.sequence.charCodeAt(i);
      const ch = code & 0xdf; // folded to upper case
      if (ch === 71) g++;
      else if (ch === 67) c++;
      else if (ch === 65) a++;
      else if (ch === 84 || ch === 85) t++;
      else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) ambiguity++; // another letter
    }
    const total = Math.max(1, g + c + a + t);
    const gcPct = Number((((g + c) / total) * 100).toFixed(1));
    const gcSkew = g + c > 0 ? Number(((g - c) / (g + c)).toFixed(3)) : 0;

    // SantaLucia (1998) nearest-neighbour Tm as Primer3 computes it for oligo-scale A/C/G/T spans
    // (10..65 bp), or 81.5 + 0.41 x %GC - 675 / N for longer ones, with no salt term: on an A/C/G/T
    // span of up to 10,000 bp it is the formula of Biopython 1.88's Tm_GC(valueset=2, saltcorr=0),
    // 101.3 °C for 1,000 bp at 50% GC where its salt-corrected default gives 79.8 °C. Here %GC is
    // rounded to 0.1 and N is the span's length, capped at 10,000. A span holding N or any other base that is not A, C, G or T has a Tm
    // by neither, "n/a" with the shared reason as in the status bar (basicTmHasNoAnswer, BG-01M6SHQ0):
    // primer3-py 2.4.0 calc_tm refuses it, where the cockpit read 26 N and 14 A/C/G/T as 68 °C and
    // 4,000 N and 1,000 A/C/G/T as 101.9 °C.
    let tmC: number | null = null;
    let deltaG: number | null = null;
    // The rule reads the span's bases, not its length: a gap or a stop counted in the length read as
    // an ambiguity base, so ACGTACGT-ACGTAC read "n/a: ... holds 1 N" where the status bar read 37.4 °C.
    const acgtBases = g + c + a + t;
    const tmNoAnswer = doc.moleculeType === 'DNA' && spanLen >= 10 && basicTmHasNoAnswer(acgtBases + ambiguity, acgtBases);
    const tmNoAnswerReason = tmNoAnswer ? tmNoAnswerSentence(ambiguity) : null;
    if (doc.moleculeType === 'DNA' && !tmNoAnswer && spanLen >= 10 && spanLen <= 65) {
      const m = calculatePrimerMetrics(slice);
      tmC = m.tmC;
      deltaG = m.hairpinDeltaG;
    } else if (doc.moleculeType === 'DNA' && !tmNoAnswer && spanLen > 65) {
      tmC = Number((81.5 + 0.41 * gcPct - 675 / Math.min(spanLen, 10000)).toFixed(1));
    }

    // Double-stranded DNA molecular weight in kDa (~617.96 Da/bp + 36.04 Da terminal OH/PO4)
    const mwKda = Number(((doc.moleculeType === 'RNA' ? spanLen * 339.5 : spanLen * 617.96 + 36.04) / 1000).toFixed(2));
    const dnaSlice = slice.replace(/U/g, 'T');
    // The residues the span codes for in frame +1: those before its first stop codon, as Biopython's
    // translate(to_stop=True) gives them (BG-01M6RZJF). They were its whole codons less a terminal
    // stop, so internal stops counted as residues: a 10 kb ORF with a TGA at codon 2,000 read 3,332,
    // not 1,999. The preview total and the In-Frame badge count these, and the preview, its first 12
    // codons, ends on the first stop when it reaches one.
    const residueCount = residuesToFirstStop(doc.sequence, start - 1, end);
    const frameHead = spanLen >= 3 ? translateSequence(dnaSlice.slice(0, 36), 0).slice(0, 12) : '';
    const stopInHead = frameHead.indexOf('*');
    const peptidePreview = stopInHead >= 0 ? frameHead.slice(0, stopInHead + 1) : frameHead;

    // Codon phase & ORF integrity check when a sub-selection is active. The codon count, the
    // internal stops and the last codon are the whole selection's, from one translation of all of
    // it (BG-01M6RWDB): they were read from its first 4,000 bp, so a 10 kb ORF read as the
    // 1,333 codons there, its stops past 4,000 bp uncounted and its last codon a frame-straddling
    // triplet at 3,998..4,000.
    let orfBadge: { tone: 'pass' | 'info' | 'warn'; label: string; title: string } | null = null;
    if (selectedRange && spanLen >= 3) {
      const rem = spanLen % 3;
      const spanDna = doc.sequence.slice(start - 1, end).toUpperCase().replace(/U/g, 'T');
      const fullAa = translateSequence(spanDna, 0);
      const internalAa = fullAa.length > 1 ? fullAa.slice(0, -1) : '';
      let internalStops = 0;
      for (let i = 0; i < internalAa.length; i++) {
        if (internalAa[i] === '*') internalStops++;
      }
      const firstCodon = spanDna.slice(0, 3);
      const lastCodon = spanDna.slice(spanDna.length - 3);
      const hasStart = firstCodon === 'ATG' || firstCodon === 'GTG' || firstCodon === 'TTG';
      const hasTerminalStop = lastCodon === 'TAA' || lastCodon === 'TAG' || lastCodon === 'TGA';

      if (rem !== 0) {
        orfBadge = {
          tone: 'warn',
          label: `Frameshift (+${rem} nt)`,
          title: `Selection length (${spanLen} nt) is not a multiple of 3 (${Math.floor(spanLen / 3)} codons + ${rem} nt remainder)`,
        };
      } else if (internalStops > 0) {
        orfBadge = {
          tone: 'warn',
          label: `Internal Stop (${internalStops}× *)`,
          title: `Contains ${internalStops} premature stop ${internalStops === 1 ? 'codon' : 'codons'} in frame +1`,
        };
      } else if (hasStart && hasTerminalStop) {
        orfBadge = {
          tone: 'pass',
          label: `3n Complete ORF (${firstCodon}→Stop)`,
          title: `Intact ${fullAa.length}-codon open reading frame starting with ${firstCodon} and terminating at ${lastCodon}`,
        };
      } else {
        orfBadge = {
          tone: 'info',
          label: `3n In-Frame (${residueCount} aa)`,
          title: `In-frame triplet selection (${fullAa.length} codons, 0 internal stop codons)`,
        };
      }
    }

    // Unique restriction enzymes cleaving inside the active interval
    const uniqueInSpan: string[] = [];
    for (const cs of cutSites) {
      const ename = cs.enzyme.name;
      if (enzymeSiteCounts[ename] === 1 && cs.position >= start && cs.position <= end) {
        if (!uniqueInSpan.includes(ename)) {
          uniqueInSpan.push(ename);
        }
      }
    }

    // The preview holds the first 12 residues; when the selection codes for more, it says so.
    const previewOf = residueCount;

    return {
      start,
      end,
      spanLen,
      previewOf,
      gcPct,
      gcSkew,
      tmC,
      tmNoAnswer,
      tmNoAnswerReason,
      deltaG,
      mwKda,
      peptidePreview,
      orfBadge,
      uniqueCuttersInSpan: uniqueInSpan,
    };
  }, [doc.sequence, doc.moleculeType, seqLen, selectedRange, cutSites, enzymeSiteCounts]);

  // Unique cutters across the entire construct for horizon ticks
  const uniqueCutSites = useMemo(
    () => cutSites.filter((cs) => enzymeSiteCounts[cs.enzyme.name] === 1).slice(0, 40),
    [cutSites, enzymeSiteCounts]
  );

  const handleHorizonClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const centerPos = Math.max(1, Math.min(seqLen, Math.round(ratio * seqLen)));
    const halfWin = Math.max(15, Math.min(250, Math.round(seqLen * 0.04)));
    const s = Math.max(1, centerPos - halfWin);
    const end = Math.min(seqLen, centerPos + halfWin);
    onSelectRange({
      start: s,
      end,
      label: `Horizon Lens ${s}..${end}`,
    });
  };

  const handleHorizonKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') {
      if (selectedRange) {
        e.preventDefault();
        onSelectRange(null);
      }
      return;
    }
    const step = e.shiftKey ? Math.max(30, Math.round(seqLen * 0.05)) : Math.max(3, Math.round(seqLen * 0.01));
    const winLen = selectedRange ? Math.max(3, telemetry.spanLen) : Math.max(30, Math.min(300, Math.round(seqLen * 0.06)));
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nextStart = Math.min(Math.max(1, seqLen - winLen + 1), telemetry.start + step);
      const nextEnd = Math.min(seqLen, nextStart + winLen - 1);
      onSelectRange({ start: nextStart, end: nextEnd, label: `Horizon Lens ${nextStart}..${nextEnd}` });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextStart = Math.max(1, telemetry.start - step);
      const nextEnd = Math.min(seqLen, nextStart + winLen - 1);
      onSelectRange({ start: nextStart, end: nextEnd, label: `Horizon Lens ${nextStart}..${nextEnd}` });
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSelectRange({ start: 1, end: Math.min(seqLen, winLen), label: `Horizon Start 1..${Math.min(seqLen, winLen)}` });
    } else if (e.key === 'End') {
      e.preventDefault();
      const s = Math.max(1, seqLen - winLen + 1);
      onSelectRange({ start: s, end: seqLen, label: `Horizon End ${s}..${seqLen}` });
    }
  };

  const declaredLen =
    Number(doc.docMetadata?.['Declared Length']) ||
    Number(String(doc.docMetadata?.['Sequence Length'] ?? '').replace(/,/g, '')) ||
    seqLen;
  const isContigSummary = Boolean(doc.docMetadata?.['Is Contig Summary']);

  const scaleBadge =
    isContigSummary && declaredLen > seqLen
      ? doc.moleculeType === 'Protein'
        ? `${declaredLen.toLocaleString()} aa Protein Summary`
        : doc.moleculeType === 'RNA'
        ? `${declaredLen.toLocaleString()} nt RNA Summary`
        : declaredLen >= 1_000_000
        ? `${(declaredLen / 1_000_000).toFixed(2)} Mbp Chromosome Summary`
        : declaredLen >= 10_000
        ? `${(declaredLen / 1_000).toFixed(1)} kbp Contig Summary`
        : `${declaredLen.toLocaleString()} bp Summary Record`
      : doc.moleculeType === 'Protein'
      ? `${seqLen.toLocaleString()} aa Protein Scale`
      : doc.moleculeType === 'RNA'
      ? `${seqLen.toLocaleString()} nt RNA Scale`
      : seqLen >= 1_000_000
      ? `${(seqLen / 1_000_000).toFixed(2)} Mbp Chromosome Scale`
      : seqLen >= 10_000
      ? `${(seqLen / 1_000).toFixed(1)} kbp Construct Scale`
      : `${seqLen.toLocaleString()} bp Nucleotide Scale`;

  return (
    <section
      className="mbc-cockpit-bar"
      aria-label="Scale-Continuous Construct & Biophysical Telemetry Cockpit"
    >
      {/* Row 1: Semantic Scale Horizon Scrubber + Okabe-Ito Feature Blocks */}
      <div className="mbc-cockpit-row-top">
        <span
          className="mbc-cockpit-scale-badge"
          title="Continuous biological scale indicator"
        >
          {scaleBadge}
        </span>

        <svg
          viewBox="0 0 1000 22"
          preserveAspectRatio="none"
          onClick={handleHorizonClick}
          onKeyDown={handleHorizonKeyDown}
          onMouseLeave={() => setHoveredLocus(null)}
          tabIndex={0}
          role="slider"
          aria-label="Construct Horizon Coordinate Scrubber (Use Left/Right arrows to scrub, or click any feature block to lock onto its locus)"
          aria-valuemin={1}
          aria-valuemax={seqLen}
          aria-valuenow={telemetry.start}
          aria-valuetext={`${telemetry.start} to ${telemetry.end} (${telemetry.spanLen} ${doc.moleculeType === 'Protein' ? 'aa' : doc.moleculeType === 'RNA' ? 'nt' : 'bp'})`}
          className="mbc-cockpit-horizon-svg"
        >
          {/* Baseline backbone */}
          <line x1={0} y1={11} x2={1000} y2={11} stroke="rgba(100,116,139,0.45)" strokeWidth={2} />

          {/* Annotated features using Okabe-Ito colorblind-safe palette */}
          {doc.features.map((f) => {
            const fStart = Math.min(f.start, f.end);
            const fEnd = Math.max(f.start, f.end);
            const fLen = Math.max(1, fEnd - fStart + 1);
            const x = Math.max(0, Math.min(998, ((fStart - 1) / seqLen) * 1000));
            const w = Math.max(4, (fLen / seqLen) * 1000);
            const fill = colorblindSafe
              ? OKABE_ITO_FEATURE_PALETTE[f.type] || f.color || '#0072B2'
              : f.color || '#0072B2';
            const isLocked =
              selectedRange !== null &&
              Math.min(selectedRange.start, selectedRange.end) === fStart &&
              Math.max(selectedRange.start, selectedRange.end) === fEnd;
            return (
              <rect
                key={f.id}
                className={`mbc-cockpit-feature-rect${isLocked ? ' is-locked' : ''}`}
                x={x}
                y={f.strand === -1 ? 11 : 3}
                width={Math.min(1000 - x, w)}
                height={8}
                rx={2}
                fill={fill}
                opacity={isLocked ? 1 : 0.88}
                onMouseEnter={() =>
                  setHoveredLocus(
                    `${f.name} • ${f.type} • ${fStart.toLocaleString()}..${fEnd.toLocaleString()} (${fLen.toLocaleString()} bp, ${f.strand === -1 ? '−' : '+'})`
                  )
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRange({
                    start: fStart,
                    end: fEnd,
                    label: `${f.name} (${f.type})`,
                  });
                }}
              >
                <title>{`${f.name} (${f.type}: ${fStart}..${fEnd}, ${fLen} bp) — Click to lock selection`}</title>
              </rect>
            );
          })}

          {/* Unique cutter ticks */}
          {uniqueCutSites.map((cs, idx) => {
            const cx = ((cs.position - 1) / seqLen) * 1000;
            return (
              <line
                key={`${cs.enzyme.name}-${cs.position}-${idx}`}
                className="mbc-cockpit-cutter-tick"
                x1={cx}
                y1={0}
                x2={cx}
                y2={7}
                stroke="#D55E00"
                strokeWidth={2}
                onMouseEnter={() =>
                  setHoveredLocus(
                    `${cs.enzyme.name} • 1× Cutter @ ${cs.position.toLocaleString()} bp`
                  )
                }
                onClick={(e) => {
                  e.stopPropagation();
                  const s = Math.max(1, cs.position - 18);
                  const end = Math.min(seqLen, cs.position + 18);
                  onSelectRange({
                    start: s,
                    end,
                    label: `${cs.enzyme.name} @ ${cs.position}`,
                  });
                }}
              >
                <title>{`Unique cutter: ${cs.enzyme.name} @ ${cs.position} — Click to center lens`}</title>
              </line>
            );
          })}

          {/* Active Selection Lens Brush */}
          {selectedRange && (
            <rect
              x={((telemetry.start - 1) / seqLen) * 1000}
              y={1}
              width={Math.max(4, (telemetry.spanLen / seqLen) * 1000)}
              height={20}
              fill="rgba(0, 158, 115, 0.22)"
              stroke="#009E73"
              strokeWidth={1.8}
              rx={2}
            />
          )}
        </svg>

        {hoveredLocus && (
          <span className="mbc-cockpit-reticle-pill" aria-live="polite">
            {hoveredLocus}
          </span>
        )}

        {/* Interactive Construct Provenance Pedigree Trail */}
        {doc.history && doc.history.length > 0 && (
          <details className="mbc-cockpit-provenance-details">
            <summary
              className="mbc-cockpit-provenance"
              title="Click to inspect full Construct Provenance Pedigree"
            >
              <strong>Provenance:</strong>
              <span>
                {doc.history[doc.history.length - 1].operation} ({doc.history.length}{' '}
                {doc.history.length === 1 ? 'step' : 'steps'})
              </span>
            </summary>
            <div className="mbc-cockpit-provenance-popover" role="region" aria-label="Construct Provenance Pedigree">
              <div className="mbc-cockpit-provenance-head">
                <strong>Construct Experimental Pedigree</strong>
                <span>{doc.history.length} recorded {doc.history.length === 1 ? 'operation' : 'operations'}</span>
              </div>
              <ol className="mbc-cockpit-provenance-list">
                {doc.history.map((entry, idx) => (
                  <li key={entry.id || idx} className="mbc-cockpit-provenance-item">
                    <div className="mbc-cockpit-provenance-step">
                      <span className="mbc-cockpit-step-idx">#{idx + 1}</span>
                      <strong>{entry.operation}</strong>
                      <time>
                        {entry.lengthBp ? `${entry.lengthBp.toLocaleString()} bp • ` : ''}
                        {entry.timestamp ? entry.timestamp.slice(0, 10) : ''}
                      </time>
                    </div>
                    {entry.description && <p>{entry.description}</p>}
                  </li>
                ))}
              </ol>
            </div>
          </details>
        )}
      </div>

      {/* Row 2: Live Biophysical & Thermodynamic Telemetry HUD + Protocol Reaction Quick-Dispatch */}
      <div className="mbc-cockpit-row-bottom">
        <div className="mbc-cockpit-telemetry-group">
          <span
            className="mbc-cockpit-span-readout"
            title={
              selectedRange
                ? selectedRange.label || 'Selected coordinate interval'
                : isContigSummary && declaredLen > seqLen
                ? `Reference genome record (${declaredLen.toLocaleString()} bp declared, ${seqLen.toLocaleString()} bp resident)`
                : 'Full construct coordinate span'
            }
          >
            <strong>{selectedRange ? 'Selection:' : isContigSummary && declaredLen > seqLen ? 'Reference Span:' : 'Full Span:'}</strong>{' '}
            {selectedRange
              ? `${telemetry.start.toLocaleString()}..${telemetry.end.toLocaleString()} (${telemetry.spanLen.toLocaleString()} ${doc.moleculeType === 'Protein' ? 'aa' : doc.moleculeType === 'RNA' ? 'nt' : 'bp'})`
              : isContigSummary && declaredLen > seqLen
              ? `1..${declaredLen.toLocaleString()} (${declaredLen.toLocaleString()} bp declared • ${seqLen.toLocaleString()} bp resident)`
              : `${telemetry.start.toLocaleString()}..${telemetry.end.toLocaleString()} (${telemetry.spanLen.toLocaleString()} ${doc.moleculeType === 'Protein' ? 'aa' : doc.moleculeType === 'RNA' ? 'nt' : 'bp'})`}
            {selectedRange && (
              <button
                type="button"
                className="mbc-cockpit-clear-lens-btn"
                onClick={() => onSelectRange(null)}
                aria-label="Reset selection to full construct span"
                title="Reset selection to full construct span (Esc)"
              >
                × Reset
              </button>
            )}
          </span>

          {doc.moleculeType !== 'Protein' && (
            <>
              <span title="GC Composition & Strand GC-Skew (G-C)/(G+C)">
                <strong>GC:</strong> {telemetry.gcPct}% (skew {telemetry.gcSkew >= 0 ? `+${telemetry.gcSkew}` : telemetry.gcSkew})
              </span>
              {telemetry.tmC !== null && (
                <span title="SantaLucia (1998) + Owczarzy (2008) Nearest-Neighbor / Salt-Adjusted Melting Temperature">
                  <strong>Duplex Tm:</strong> {telemetry.tmC} °C
                  {telemetry.deltaG !== null ? ` (ΔG ${telemetry.deltaG} kcal/mol)` : ''}
                </span>
              )}
              {telemetry.tmNoAnswerReason !== null && (
                <>
                  <span title={telemetry.tmNoAnswerReason}>
                    <strong>Duplex Tm:</strong> n/a
                  </span>
                  <span className="mbc-cockpit-tm-reason">{telemetry.tmNoAnswerReason}</span>
                </>
              )}
            </>
          )}

          <span title="Estimated Molecular Mass (kDa)">
            <strong>Mass:</strong> {telemetry.mwKda} kDa
          </span>

          {telemetry.peptidePreview && (
            <span
              className="mbc-cockpit-aa-preview"
              title={doc.moleculeType === 'Protein' ? 'Amino-acid sequence preview' : "In-Frame Translation Preview (5' -> 3' Frame +1)"}
            >
              <strong>AA:</strong> {telemetry.peptidePreview}
              {telemetry.previewOf > telemetry.peptidePreview.length
                ? `… (first ${telemetry.peptidePreview.length} aa of ${telemetry.previewOf.toLocaleString()})`
                : ''}
            </span>
          )}

          {telemetry.orfBadge && (
            <span
              className={`mbc-cockpit-orf-pill tone-${telemetry.orfBadge.tone}`}
              title={telemetry.orfBadge.title}
            >
              {telemetry.orfBadge.label}
            </span>
          )}

          {telemetry.uniqueCuttersInSpan.length > 0 && (
            <span title="Unique Restriction Endonucleases Cleaving Inside Active Interval">
              <strong>1× Cutters:</strong> {telemetry.uniqueCuttersInSpan.slice(0, 4).join(', ')}
              {telemetry.uniqueCuttersInSpan.length > 4
                ? ` +${telemetry.uniqueCuttersInSpan.length - 4}`
                : ''}
            </span>
          )}
        </div>

        {/* Protocol Loom Reaction Quick-Cells */}
        <div className="mbc-cockpit-actions">
          {selectedRange && onExtractSelection && (
            <button
              type="button"
              className="btn-secondary-sm mbc-cockpit-action-btn"
              onClick={onExtractSelection}
              aria-label="Extract selected region into a new sequence document"
              title="Extract selected interval into a new provenance-linked sequence document"
            >
              Splice Subconstruct
            </button>
          )}
          {onJumpToStudio && (
            <>
              {doc.moleculeType === 'DNA' && <button
                type="button"
                className="btn-secondary-sm mbc-cockpit-action-btn"
                onClick={() => onJumpToStudio('primers-pcr')}
                aria-label="Open Primers and CRISPR studio for this sequence"
                title="Open Primers & CRISPR studio to design primers or guide RNAs"
              >
                PCR / Oligo Cell
              </button>}
              {doc.moleculeType === 'DNA' && <button
                type="button"
                className="btn-secondary-sm mbc-cockpit-action-btn"
                onClick={() => onJumpToStudio('cloning-gel')}
                aria-label="Open Cloning and Virtual Gel studio for this sequence"
                title="Open Cloning & Virtual Gel studio to simulate restriction digests or assembly"
              >
                Digest / Assemble Cell
              </button>}
              <button
                type="button"
                className="btn-secondary-sm mbc-cockpit-action-btn"
                onClick={() => onJumpToStudio('sequence-alignment')}
                aria-label="Open Sequence Alignment studio"
                title="Open Sequence Alignment studio for pairwise or multiple alignment"
              >
                Homology Cell
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
