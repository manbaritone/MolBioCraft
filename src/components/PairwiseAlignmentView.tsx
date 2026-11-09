// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Block (interleaved) rendering of a pairwise alignment with per-sequence residue coordinates,
 * colour-coded identities / similar substitutions / mismatches / gaps and a column ruler.
 */

import React, { useMemo } from 'react';

export interface PairwiseAlignmentViewProps {
  nameA: string;
  nameB: string;
  alignedA: string;
  alignedB: string;
  midline: string;
  /** 1-based position of the first aligned residue of A (local alignments start later). */
  startA?: number;
  /** 1-based position of the first aligned residue of B. */
  startB?: number;
  blockWidth?: number;
}

type CellKind = 'id' | 'sim' | 'mis' | 'gap';

function classify(a: string, b: string, mid: string): CellKind {
  if (a === '-' || b === '-') return 'gap';
  if (a.toUpperCase() === b.toUpperCase()) return 'id';
  return mid === ':' ? 'sim' : 'mis';
}

/** Splits a block of one sequence into runs of the same kind so React renders few spans. */
function runs(seq: string, kinds: CellKind[]): { text: string; kind: CellKind }[] {
  const out: { text: string; kind: CellKind }[] = [];
  for (let i = 0; i < seq.length; i++) {
    const last = out[out.length - 1];
    if (last && last.kind === kinds[i]) last.text += seq[i];
    else out.push({ text: seq[i], kind: kinds[i] });
  }
  return out;
}

/** Column ruler: 1-based alignment column labels every 10 columns, clipped to the block. */
function rulerText(start: number, len: number): string {
  const chars = Array<string>(len).fill(' ');
  for (let i = 0; i < len; i += 10) {
    const label = String(start + i + 1);
    for (let k = 0; k < label.length && i + k < len; k++) chars[i + k] = label[k];
  }
  return chars.join('');
}

export const PairwiseAlignmentView: React.FC<PairwiseAlignmentViewProps> = ({
  nameA,
  nameB,
  alignedA,
  alignedB,
  midline,
  startA = 1,
  startB = 1,
  blockWidth = 60,
}) => {
  const blocks = useMemo(() => {
    const len = Math.max(alignedA.length, alignedB.length);
    const out: {
      start: number;
      a: string;
      b: string;
      mid: string;
      kinds: CellKind[];
      fromA: number;
      toA: number;
      fromB: number;
      toB: number;
    }[] = [];
    // Residue counters: number of residues consumed *before* the current block.
    let posA = startA - 1;
    let posB = startB - 1;
    for (let start = 0; start < len; start += blockWidth) {
      const a = alignedA.slice(start, start + blockWidth).padEnd(Math.min(blockWidth, len - start), '-');
      const b = alignedB.slice(start, start + blockWidth).padEnd(a.length, '-');
      const mid = midline.slice(start, start + blockWidth).padEnd(a.length, ' ');
      const kinds = Array.from(a, (ch, i) => classify(ch, b[i], mid[i]));
      const resA = a.replace(/-/g, '').length;
      const resB = b.replace(/-/g, '').length;
      out.push({
        start,
        a,
        b,
        mid,
        kinds,
        fromA: resA ? posA + 1 : posA,
        toA: posA + resA,
        fromB: resB ? posB + 1 : posB,
        toB: posB + resB,
      });
      posA += resA;
      posB += resB;
    }
    return out;
  }, [alignedA, alignedB, midline, startA, startB, blockWidth]);

  if (!blocks.length) {
    return <div className="mbc-pw-empty">No alignment to display.</div>;
  }

  return (
    <div className="mbc-pw-view" role="region" aria-label="Pairwise alignment blocks">
      <div className="mbc-pw-legend" aria-hidden="true">
        <span><i className="mbc-pw-swatch is-id" /> Identical</span>
        <span><i className="mbc-pw-swatch is-sim" /> Similar</span>
        <span><i className="mbc-pw-swatch is-mis" /> Mismatch</span>
        <span><i className="mbc-pw-swatch is-gap" /> Gap</span>
      </div>
      <div className="mbc-pw-scroll">
        {blocks.map((blk) => (
          <div key={blk.start} className="mbc-pw-block">
            <div className="mbc-pw-line mbc-pw-ruler" aria-hidden="true">
              <span className="mbc-pw-name" />
              <span className="mbc-pw-num" />
              <span className="mbc-pw-seq">
                {rulerText(blk.start, blk.a.length)}
              </span>
            </div>
            <div className="mbc-pw-line">
              <span className="mbc-pw-name" title={nameA}>{nameA}</span>
              <span className="mbc-pw-num">{blk.fromA}</span>
              <span className="mbc-pw-seq">
                {runs(blk.a, blk.kinds).map((r, i) => (
                  <span key={i} className={`mbc-pw-res is-${r.kind}`}>{r.text}</span>
                ))}
              </span>
              <span className="mbc-pw-num is-end">{blk.toA}</span>
            </div>
            <div className="mbc-pw-line mbc-pw-mid" aria-hidden="true">
              <span className="mbc-pw-name" />
              <span className="mbc-pw-num" />
              <span className="mbc-pw-seq">{blk.mid}</span>
            </div>
            <div className="mbc-pw-line">
              <span className="mbc-pw-name" title={nameB}>{nameB}</span>
              <span className="mbc-pw-num">{blk.fromB}</span>
              <span className="mbc-pw-seq">
                {runs(blk.b, blk.kinds).map((r, i) => (
                  <span key={i} className={`mbc-pw-res is-${r.kind}`}>{r.text}</span>
                ))}
              </span>
              <span className="mbc-pw-num is-end">{blk.toB}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
