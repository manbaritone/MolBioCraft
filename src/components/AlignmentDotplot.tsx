// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Dotplot between two sequences of an alignment, drawn on a canvas.
 *
 * A nucleotide dotplot is drawn by default with PRD F11's method (D0032): the engine's sliding
 * window (`compute_dotplot_hits`), a dot wherever at least 9 of 11 positions hold the same base, on
 * both strands. Only A, C, G and T/U count: the engine compares letters, so it is handed U as T and
 * every other letter (N and the ambiguity codes) as a placeholder that differs between X and Y, one
 * letter for one, so N never matches there and never spends its hit cap; each window it returns is
 * still counted again here over bases alone before it is drawn.
 * Exact word matching (word size 10 nt) stays selectable. A protein dotplot draws exact 3-aa word
 * matches (D0035), because the engine's windowed dotplot also scores the reverse-complement strand
 * and so is a nucleotide method. The figure states the method and parameters that drew it, beneath
 * the plot and on the canvas itself, so the exported PNG carries them, says when the engine sampled
 * its windows (from 560 nt), and says where along X the engine stopped when it reached its hit cap.
 * Supports strand / score colouring, reverse-complement matches (nucleotides),
 * the pairwise path implied by the alignment, axis annotations, gridlines and PNG export.
 * In the workbench those options are a Dotplot section of App's inspector (US-01M6TAA4), while the
 * X and Y pickers and Export PNG stay with the plot; drawn on its own, every one sits in its box.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { dataUrlToBytes, saveWorkbenchFile } from '../platform/macosMenuBridge';
import type { SequenceFeature } from '../types/bio';
import { computeDotplot, rulerStep, type DotplotSegment } from '../core/alignmentViewModel';
import { computeDotplotHits } from '../core/bioEngine';
import { InspectorSection } from './WorkbenchInspector';

export interface DotplotSequence {
  id: string;
  name: string;
  alignedSeq: string;
  features: SequenceFeature[];
}

interface Props {
  sequences: DotplotSequence[];
  isProtein: boolean;
}

const PLOT = 520;
const MARGIN_L = 64;
const MARGIN_T = 48;
const ANN_H = 8;
const LABEL_FONT = "11px 'Google Sans', system-ui, sans-serif";

/** PRD F11: the dotplot's window and the matching positions a window needs to draw a dot. */
const F11_WINDOW = 11;
const F11_MIN_MATCHES = 9;
/**
 * `compute_dotplot_hits` compares every window pair only while the longer sequence (letters only)
 * is shorter than this; from here it strides its scan, so the figure must say its windows are
 * sampled (BG-01M6Q35A).
 */
const ENGINE_SAMPLES_FROM = 560;
/**
 * Above this length (the longer sequence, letters only) `compute_dotplot_hits` seeds its scan along
 * X and stops it once it holds `ENGINE_HIT_CAP` hits, so the plot past that point is never compared.
 */
const ENGINE_SEEDS_ABOVE = 4000;
const ENGINE_HIT_CAP = 4000;

/**
 * What X's and Y's letters other than A, C, G and T (after U is read as T) become before the engine
 * sees them: N, every other IUPAC code and any other letter. Each is a letter, so the engine keeps
 * it and every position keeps its coordinate; neither is a base or a nucleotide code, so the engine's
 * reverse complement leaves each as itself; and the two differ, so neither ever equals a letter of
 * the other axis on either strand, and the engine never spends its hit cap on them.
 */
const X_NON_BASE = 'J';
const Y_NON_BASE = 'O';

/**
 * The letters `compute_dotplot_hits` is handed for one axis: letters only (the engine drops every
 * other character), upper case, U read as T, and every letter that is not a base as `nonBase`.
 */
function engineLetters(seq: string, nonBase: string): string {
  return seq.replace(/[^A-Za-z]/g, '').toUpperCase().replace(/U/g, 'T').replace(/[^ACGT]/g, nonBase);
}

/** The bases a position can match on, in the letters handed to the engine; nothing else matches. */
const BASE: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T' };
const BASE_COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };

/**
 * The positions where window `x` of `a` holds the same base as window `y` of `b` (strand 1), or as
 * the reverse complement of window `y` of `b` (strand -1); 0-based starts on the engine's letters.
 */
function baseMatches(a: string, b: string, x: number, y: number, strand: number): number {
  let m = 0;
  for (let k = 0; k < F11_WINDOW; k++) {
    const p = BASE[a[x + k]];
    const q = strand === 1 ? BASE[b[y + k]] : BASE_COMPLEMENT[b[y + F11_WINDOW - 1 - k]];
    if (p !== undefined && p === q) m++;
  }
  return m;
}

/** `window`: the engine's sliding-window dotplot (F11). `word`: exact word matches merged along diagonals. */
type DotplotMethod = 'window' | 'word';

/** A drawn match: a merged word-match run, or one engine window (whose `score` is its matching bases). */
type DrawnSegment = DotplotSegment & { score?: number };

export const AlignmentDotplot: React.FC<Props> = ({ sequences, isProtein }) => {
  const [xIdx, setXIdx] = useState(0);
  const [yIdx, setYIdx] = useState(Math.min(1, Math.max(0, sequences.length - 1)));
  const [chosenMethod, setChosenMethod] = useState<DotplotMethod>('window');
  // The windowed engine is a nucleotide method (it also scores the reverse-complement strand).
  const method: DotplotMethod = isProtein ? 'word' : chosenMethod;
  const [wordSize, setWordSize] = useState(isProtein ? 3 : 10);
  const [colorMode, setColorMode] = useState<'Classic' | 'Score' | 'Strand'>('Strand');
  const [showReverse, setShowReverse] = useState(true);
  const [showPath, setShowPath] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setXIdx(0);
    setYIdx(Math.min(1, Math.max(0, sequences.length - 1)));
  }, [sequences.length]);
  useEffect(() => setWordSize(isProtein ? 3 : 10), [isProtein]);

  const sx = sequences[xIdx];
  const sy = sequences[yIdx];
  const X = useMemo(() => (sx?.alignedSeq ?? '').replace(/-/g, ''), [sx]);
  const Y = useMemo(() => (sy?.alignedSeq ?? '').replace(/-/g, ''), [sy]);

  // The letters the engine is handed, one for each letter of X and Y, so its coordinates are theirs.
  const xLetters = useMemo(() => engineLetters(X, X_NON_BASE), [X]);
  const yLetters = useMemo(() => engineLetters(Y, Y_NON_BASE), [Y]);

  const result = useMemo((): { segments: DrawnSegment[]; truncated: boolean; stoppedAt: number | null } => {
    if (method === 'word') return { ...computeDotplot(X, Y, wordSize, showReverse, isProtein), stoppedAt: null };
    const hits = computeDotplotHits(xLetters, yLetters, F11_WINDOW, F11_MIN_MATCHES);
    // A seeded scan walks X in order and stops once it holds the cap, so its furthest hit is the
    // last X window it compared.
    const stoppedAt =
      Math.max(xLetters.length, yLetters.length) > ENGINE_SEEDS_ABOVE && hits.length >= ENGINE_HIT_CAP
        ? hits.reduce((last, h) => Math.max(last, h.x), 0)
        : null;
    // Engine hits are 1-based window starts; a reverse hit pairs window x with the reverse
    // complement of window y, so it is drawn as an anti-diagonal over the same square. The engine
    // counts equal letters, which over these letters are equal bases; each window is still counted
    // again over bases, as a guard, and kept only if it holds the minimum.
    const segments: DrawnSegment[] = [];
    for (const h of hits) {
      if (!showReverse && h.strand !== 1) continue;
      const score = baseMatches(xLetters, yLetters, h.x - 1, h.y - 1, h.strand);
      if (score >= F11_MIN_MATCHES) segments.push({ x: h.x - 1, y: h.y - 1, len: F11_WINDOW, strand: h.strand, score });
    }
    return { segments, truncated: false, stoppedAt };
  }, [X, Y, xLetters, yLetters, method, wordSize, showReverse, isProtein]);

  const sampled = method === 'window' && Math.max(xLetters.length, yLetters.length) >= ENGINE_SAMPLES_FROM;
  const stopped =
    result.stoppedAt === null
      ? ''
      : `scan stopped at the ${ENGINE_HIT_CAP.toLocaleString()}-hit cap at position ${result.stoppedAt.toLocaleString()} of ${xLetters.length.toLocaleString()} along X`;

  /** The method and parameters that drew the figure, as its caption, its canvas and its export state them. */
  const unit = isProtein ? 'aa' : 'bp';
  const strands = isProtein ? '' : showReverse ? ' · both strands' : ' · forward strand only';
  const scanNote = stopped ? ` · ${stopped}` : sampled ? ' · windows sampled' : '';
  const methodLabel =
    method === 'window'
      ? `Windowed match · window ${F11_WINDOW} · minimum ${F11_MIN_MATCHES} matches${strands}${scanNote}`
      : `Exact word match · word size ${wordSize} ${unit}${strands}`;
  const methodTag = method === 'window' ? `window${F11_WINDOW}-min${F11_MIN_MATCHES}` : `word${wordSize}`;

  /** Path through (x, y) implied by the alignment columns where both have residues. */
  const path = useMemo(() => {
    if (!sx || !sy) return [] as [number, number][];
    const a = sx.alignedSeq;
    const b = sy.alignedSeq;
    const pts: [number, number][] = [];
    let px = 0;
    let py = 0;
    for (let c = 0; c < Math.min(a.length, b.length); c++) {
      const ga = a[c] === '-';
      const gb = b[c] === '-';
      if (!ga) px++;
      if (!gb) py++;
      if (!ga && !gb && (pts.length === 0 || c % 4 === 0)) pts.push([px - 1, py - 1]);
    }
    if (px && py) pts.push([px - 1, py - 1]);
    return pts;
  }, [sx, sy]);

  const maxLen = useMemo(
    () => result.segments.reduce((m, s) => Math.max(m, s.len), wordSize),
    [result.segments, wordSize]
  );

  const xLen = Math.max(1, X.length);
  const yLen = Math.max(1, Y.length);
  // keep aspect ratio of the sequences
  const scale = PLOT / Math.max(xLen, yLen);
  const W = Math.max(40, xLen * scale);
  const H = Math.max(40, yLen * scale);
  const plotW = MARGIN_L + W + 16;
  const totalH = MARGIN_T + H + 24;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    // Widen the canvas when the method label runs past a narrow plot, so the export keeps all of it.
    ctx.font = LABEL_FONT;
    const totalW = Math.max(plotW, Math.ceil(MARGIN_L + ctx.measureText(methodLabel).width + 8));
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(totalW * dpr);
    cv.height = Math.round(totalH * dpr);
    cv.style.width = `${totalW}px`;
    cv.style.height = `${totalH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(cv);
    const fg = css.getPropertyValue('--mbc-text-main').trim() || '#111827';
    const muted = css.getPropertyValue('--mbc-text-muted').trim() || '#64748b';
    const border = css.getPropertyValue('--mbc-border').trim() || '#cbd5e1';
    const bg = css.getPropertyValue('--mbc-bg-canvas').trim() || '#ffffff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, totalW, totalH);

    const ox = MARGIN_L;
    const oy = MARGIN_T;
    const step = rulerStep(scale, 60);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let v = step; v < xLen; v += step) {
      const gx = ox + v * scale;
      if (showGrid) {
        ctx.strokeStyle = border;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(gx, oy);
        ctx.lineTo(gx, oy + H);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.fillText(String(v), gx, oy - (showAnnotations ? ANN_H + 8 : 8));
    }
    for (let v = step; v < yLen; v += step) {
      const gy = oy + v * scale;
      if (showGrid) {
        ctx.strokeStyle = border;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(ox, gy);
        ctx.lineTo(ox + W, gy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = muted;
      ctx.textAlign = 'right';
      ctx.fillText(String(v), ox - (showAnnotations ? ANN_H + 6 : 6), gy);
    }

    // segments
    ctx.lineWidth = Math.max(1, Math.min(2, scale));
    ctx.lineCap = 'round';
    for (const s of result.segments) {
      let color = fg;
      if (colorMode === 'Strand') color = s.strand === 1 ? '#2563eb' : '#dc2626';
      else if (colorMode === 'Score') {
        const t =
          method === 'window'
            ? Math.min(1, ((s.score ?? F11_MIN_MATCHES) - F11_MIN_MATCHES) / (F11_WINDOW - F11_MIN_MATCHES))
            : Math.min(1, (s.len - wordSize) / Math.max(1, maxLen - wordSize));
        const r = Math.round(37 + (220 - 37) * t);
        const g = Math.round(99 + (38 - 99) * t);
        const b = Math.round(235 + (38 - 235) * t);
        color = `rgb(${r},${g},${b})`;
      }
      ctx.strokeStyle = color;
      ctx.beginPath();
      if (s.strand === 1) {
        ctx.moveTo(ox + s.x * scale, oy + s.y * scale);
        ctx.lineTo(ox + (s.x + s.len) * scale, oy + (s.y + s.len) * scale);
      } else {
        ctx.moveTo(ox + s.x * scale, oy + (s.y + s.len) * scale);
        ctx.lineTo(ox + (s.x + s.len) * scale, oy + s.y * scale);
      }
      ctx.stroke();
    }

    if (showPath && path.length > 1) {
      ctx.strokeStyle = '#f59e0b';
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      path.forEach(([x, y], i) => {
        const px = ox + x * scale;
        const py = oy + y * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (showAnnotations) {
      for (const f of sx?.features ?? []) {
        if (String(f.type) === 'source') continue;
        ctx.fillStyle = f.color;
        ctx.fillRect(ox + (f.start - 1) * scale, oy - ANN_H - 2, Math.max(1, (f.end - f.start + 1) * scale), ANN_H);
      }
      for (const f of sy?.features ?? []) {
        if (String(f.type) === 'source') continue;
        ctx.fillStyle = f.color;
        ctx.fillRect(ox - ANN_H - 2, oy + (f.start - 1) * scale, ANN_H, Math.max(1, (f.end - f.start + 1) * scale));
      }
    }

    ctx.strokeStyle = fg;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, W, H);

    // The method and parameters, under the plot, so the figure and its PNG say what drew them.
    ctx.font = LABEL_FONT;
    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(methodLabel, ox, oy + H + 14);
  }, [result, colorMode, showPath, showAnnotations, showGrid, path, sx, sy, scale, W, H, plotW, totalH, xLen, yLen, wordSize, maxLen, method, methodLabel]);

  const exportPng = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    saveWorkbenchFile(
      `dotplot-${(sx?.name ?? 'x').replace(/\W+/g, '_')}-vs-${(sy?.name ?? 'y').replace(/\W+/g, '_')}-${methodTag}.png`,
      dataUrlToBytes(cv.toDataURL('image/png')),
      'image/png'
    );
  };

  if (sequences.length === 0) {
    return <div className="mbc-aln-empty">No sequences available for a dotplot.</div>;
  }

  const fwd = result.segments.filter((s) => s.strand === 1).length;
  const rev = result.segments.length - fwd;

  return (
    <div className="mbc-dotplot">
      <div className="mbc-dotplot-plot">
        <div className="mbc-dotplot-axis-x" style={{ paddingLeft: MARGIN_L }}>
          {sx?.name} ({xLen.toLocaleString()} {unit}) →
        </div>
        <div className="mbc-dotplot-row">
          <div className="mbc-dotplot-axis-y">
            ↓ {sy?.name} ({yLen.toLocaleString()} {unit})
          </div>
          <canvas ref={canvasRef} role="img" aria-label={`Dotplot of ${sx?.name} vs ${sy?.name}`} />
        </div>
        <div className="mbc-aln-hint">{methodLabel}</div>
        <div className="mbc-aln-hint">
          {method === 'window'
            ? `${result.segments.length.toLocaleString()} windows with ≥ ${F11_MIN_MATCHES} of ${F11_WINDOW} matching`
            : `${result.segments.length.toLocaleString()} matching segments (≥ ${wordSize} ${unit})`}
          {!isProtein && showReverse ? ` · ${fwd.toLocaleString()} forward, ${rev.toLocaleString()} reverse` : ''}
          {result.truncated ? ' · truncated — increase the word size' : ''}
          {stopped
            ? ` · ${stopped}; the rest of the plot was not compared, and the windows before it were sampled`
            : sampled
              ? ` · from ${ENGINE_SAMPLES_FROM} nt the engine compares a sample of window pairs, so some matches are not drawn`
              : ''}
        </div>
      </div>

      <div className="mbc-aln-group-box mbc-dotplot-controls">
        <label className="mbc-aln-field-row">
          <span>X sequence:</span>
          <select value={xIdx} onChange={(e) => setXIdx(Number(e.target.value))}>
            {sequences.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1}. {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mbc-aln-field-row">
          <span>Y sequence:</span>
          <select value={yIdx} onChange={(e) => setYIdx(Number(e.target.value))}>
            {sequences.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1}. {s.name}
              </option>
            ))}
          </select>
        </label>
        <InspectorSection title="Dotplot" order={1}>
          {!isProtein && (
            <label className="mbc-aln-field-row">
              <span>Method:</span>
              <select
                aria-label="Dotplot method"
                value={method}
                onChange={(e) => setChosenMethod(e.target.value as DotplotMethod)}
              >
                <option value="window">
                  Windowed match ({F11_WINDOW} / ≥ {F11_MIN_MATCHES})
                </option>
                <option value="word">Exact word match</option>
              </select>
            </label>
          )}
          {method === 'word' && (
            <label className="mbc-aln-field-row">
              <span>Word size:</span>
              <input
                type="number"
                min={isProtein ? 1 : 4}
                max={isProtein ? 10 : 32}
                value={wordSize}
                onChange={(e) =>
                  setWordSize(
                    Math.max(isProtein ? 1 : 4, Math.min(isProtein ? 10 : 32, Number(e.target.value) || wordSize))
                  )
                }
              />
            </label>
          )}
          <label className="mbc-aln-field-row">
            <span>Colors:</span>
            <select value={colorMode} onChange={(e) => setColorMode(e.target.value as typeof colorMode)}>
              <option value="Strand">By strand</option>
              <option value="Score">{method === 'window' ? 'By matches in window' : 'By match length'}</option>
              <option value="Classic">Classic (black)</option>
            </select>
          </label>
          {!isProtein && (
            <label className="mbc-aln-check-inline">
              <input type="checkbox" checked={showReverse} onChange={(e) => setShowReverse(e.target.checked)} />
              <span>Reverse-complement matches</span>
            </label>
          )}
          <label className="mbc-aln-check-inline">
            <input type="checkbox" checked={showPath} onChange={(e) => setShowPath(e.target.checked)} />
            <span>Alignment path</span>
          </label>
          <label className="mbc-aln-check-inline">
            <input type="checkbox" checked={showAnnotations} onChange={(e) => setShowAnnotations(e.target.checked)} />
            <span>Annotations on axes</span>
          </label>
          <label className="mbc-aln-check-inline">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            <span>Gridlines</span>
          </label>
        </InspectorSection>
        <button type="button" className="btn-secondary-sm" onClick={exportPng}>
          Export PNG
        </button>
        <span className="mbc-aln-hint">
          {method === 'window'
            ? `A dot wherever at least ${F11_MIN_MATCHES} of ${F11_WINDOW} positions hold the same base (N and other ambiguity codes never match), so diverged sequences keep their diagonal.`
            : 'Exact word matches merged along diagonals (EMBOSS dottup-style).'}
        </span>
      </div>
    </div>
  );
};
