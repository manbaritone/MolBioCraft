// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useRef } from 'react';
import type { RestrictionCutSite } from '../types/bio';
import { cleavagePicture, type CleavageCut, type CleavagePicture } from '../core/restrictionDisplay';

/**
 * One strand of the picture with its own cut drawn as `mark` and a blank column where the other
 * strand is cut, so the top and bottom strands keep the same columns base for base.
 */
function markStrand(strand: string, own: number, other: number, mark: string): string {
  const cols: [number, string][] = own === other ? [[own, mark]] : [[own, mark], [other, ' ']];
  cols.sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [boundary, ch] of cols) {
    out += strand.slice(at, boundary) + ch;
    at = boundary;
  }
  return out + strand.slice(at);
}

/** The top strand with ▼ at its cut and the bottom strand with ▲ at its cut, as the Enzymes View marks them. */
export function markedStrands(p: CleavagePicture): { top: string; bottom: string } {
  return {
    top: markStrand(p.top, p.topCut.boundary, p.bottomCut.boundary, '▼'),
    bottom: markStrand(p.bottom, p.bottomCut.boundary, p.topCut.boundary, '▲'),
  };
}

const reverse = (s: string) => [...s].reverse().join('');

const cutWords = (strand: 'Top' | 'bottom', cut: CleavageCut) =>
  cut.position === null
    ? `${strand} strand cut past the end of the linear molecule`
    : `${strand} strand cut after base ${cut.position}`;

function endWords(p: CleavagePicture): string {
  if (p.endType === 'blunt') return 'Blunt end';
  const side = p.endType === '5prime' ? "5'" : "3'";
  const seq = p.overhangSeq === null ? ' (part of it lies past the end of the linear molecule)' : `: ${p.overhangSeq}`;
  return `${side} overhang, ${p.overhangLength} nt${seq}`;
}

export interface CleavagePreviewProps {
  /** The engine's record of the one site to show. */
  site: RestrictionCutSite;
  /** The molecule the site was scanned on. */
  sequence: string;
  circular: boolean;
  /** Bases shown beyond the motif and both cuts. */
  flank?: number;
  /** Asked when the preview is dismissed (Escape or its close button). */
  onClose: () => void;
  id?: string;
}

/**
 * The cleavage preview of one restriction site: the enzyme, the matched site with its 1-based
 * coordinates and orientation, the two strands with both cuts where {@link cleavagePicture} places
 * them, the end the cut leaves, and whether it is a Type IIS or methylation-blocked site.
 */
export const CleavagePreview: React.FC<CleavagePreviewProps> = ({ site, sequence, circular, flank = 4, onClose, id }) => {
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, [site.id]);

  const p = cleavagePicture(site, sequence, circular, flank);
  const strands = markedStrands(p);
  const siteSeq = p.top.slice(p.motif.start, p.motif.end);
  const first = p.coordinates[p.motif.start];
  const last = p.coordinates[p.motif.end - 1];
  const orientation =
    p.recognitionStrand === 'top'
      ? 'forward (+) strand'
      : `reverse (−) strand: ${reverse(p.bottom.slice(p.motif.start, p.motif.end))} read 5'→3' on the bottom strand`;
  const sensitivity = site.enzyme.methylationSensitivity ?? [];

  return (
    <section
      id={id}
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${p.enzyme} cleavage preview`}
      tabIndex={-1}
      className="mbc-cleavage-preview"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      style={{
        margin: '4px 0 6px 68px',
        padding: '8px 10px',
        maxWidth: 'min(560px, calc(100% - 68px))',
        border: '1px solid var(--mbc-border)',
        borderRadius: 6,
        background: 'var(--mbc-bg-elevated)',
        color: 'var(--mbc-text-main)',
        fontSize: 'var(--font-size-caption)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong>{`${p.enzyme} cleavage`}</strong>
        <button type="button" className="mbc-icon-btn" aria-label="Close cleavage preview" onClick={onClose}>
          ×
        </button>
      </div>
      <p style={{ margin: '4px 0' }}>{`Site ${siteSeq}, bases ${first}–${last}, ${orientation}`}</p>
      {p.crossesOrigin && (
        <p style={{ margin: '4px 0' }}>{`It runs across the origin, from base ${sequence.length} to base 1.`}</p>
      )}
      <pre
        aria-label="Top strand 5' to 3' over bottom strand 3' to 5', ▼ and ▲ marking the cuts"
        style={{ margin: '6px 0', fontFamily: 'var(--font-mono)', lineHeight: 1.4, overflowX: 'auto' }}
      >
        <code data-strand="top">{`5'-${strands.top}-3'`}</code>
        {'\n'}
        <code data-strand="bottom">{`3'-${strands.bottom}-5'`}</code>
      </pre>
      <p style={{ margin: '4px 0' }}>{`${cutWords('Top', p.topCut)}; ${cutWords('bottom', p.bottomCut)}`}</p>
      <p style={{ margin: '4px 0' }}>
        <strong>{endWords(p)}</strong>
      </p>
      {p.typeIIS && (
        <p style={{ margin: '4px 0' }}>
          {`Type IIS: cuts outside the ${site.enzyme.recognitionSeq} motif, top strand ${p.topCut.gapFromMotif} nt and bottom strand ${p.bottomCut.gapFromMotif} nt from it`}
        </p>
      )}
      {p.cleavage === 'methylation-blocked' && (
        <p role="status" style={{ margin: '4px 0', padding: '2px 6px', background: 'var(--mbc-amber-soft)', border: '1px solid var(--mbc-amber-border)', borderRadius: 4 }}>
          {`Methylation may block this cut${sensitivity.length > 0 ? ` (${site.enzyme.name} is ${sensitivity.join('/')}-sensitive)` : ''}: it is not a guaranteed cut.`}
        </p>
      )}
    </section>
  );
};
