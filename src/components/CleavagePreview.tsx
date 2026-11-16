// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useRef } from 'react';
import type { RestrictionCutSite } from '../types/bio';
import { enzymeLabel } from '../core/bioEngine';
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

/**
 * The marked strands with their 5'/3' end labels beside the molecule's own first and last base: on a
 * linear molecule the blank columns past an end stay before the label on the left and are dropped
 * on the right, so a label never stands beyond them.
 */
export function labelledStrands(p: CleavagePicture): { top: string; bottom: string } {
  const strands = markedStrands(p);
  const { left, right } = p.unavailableFlank;
  const label = (s: string, opening: string, closing: string) =>
    ' '.repeat(left) + opening + s.slice(left, s.length - right) + closing;
  return { top: label(strands.top, "5'-", "-3'"), bottom: label(strands.bottom, "3'-", "-5'") };
}

const reverse = (s: string) => [...s].reverse().join('');

/**
 * Where the recognition motif lies in a {@link labelledStrands} line, as `[start, end)` indexes:
 * each cut mark (or the blank column for the other strand's cut) is inserted before the column it
 * bounds, and the `5'-`/`3'-` label stands three characters ahead of the molecule's first column.
 */
export function motifSpanInLabelled(p: CleavagePicture): { start: number; end: number } {
  const inserted = p.topCut.boundary === p.bottomCut.boundary ? [p.topCut.boundary] : [p.topCut.boundary, p.bottomCut.boundary];
  const marked = (column: number) => column + inserted.filter((b) => b <= column).length;
  return { start: marked(p.motif.start) + 3, end: marked(p.motif.end - 1) + 4 };
}

/** One strand line with the motif's span wrapped in a mark of its own. */
const StrandLine: React.FC<{ strand: 'top' | 'bottom'; text: string; motif: { start: number; end: number } | null }> = ({ strand, text, motif }) => (
  <code data-strand={strand}>
    {motif ? (
      <>
        {text.slice(0, motif.start)}
        <span className="mbc-cleavage-motif" data-motif="">
          {text.slice(motif.start, motif.end)}
        </span>
        {text.slice(motif.end)}
      </>
    ) : (
      text
    )}
  </code>
);

/** A cut in words: after the base before it, or before base 1 of a linear molecule, which no base precedes. */
const cutWords = (strand: 'Top' | 'bottom', cut: CleavageCut) =>
  cut.position === null ? `${strand} strand cut before base 1` : `${strand} strand cut after base ${cut.position}`;

function endWords(p: CleavagePicture): string {
  if (p.endType === 'blunt') return 'Blunt end';
  return `${p.endType === '5prime' ? "5'" : "3'"} overhang, ${p.overhangLength} nt: ${p.overhangSeq}`;
}

/** The parts of a DOM element that revealing the preview touches (a plain object stands in for one in tests). */
export interface RevealableElement {
  parentElement: RevealableElement | null;
  clientHeight?: number;
  style: { maxHeight: string; overflowY: string };
  scrollIntoView?: (options: ScrollIntoViewOptions) => void;
  focus: (options?: FocusOptions) => void;
}

/** The nearest ancestor of `el` that scrolls vertically (the sequence view's rows pane), or null. */
export function scrollPaneOf(
  el: RevealableElement,
  overflowOf: (e: RevealableElement) => string = (e) => getComputedStyle(e as unknown as Element).overflowY
): RevealableElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/^(auto|scroll|overlay)$/.test(overflowOf(p))) return p;
  }
  return null;
}

/** Room left above and below the preview when it is fitted to its pane (its own margins). */
const PANE_FIT_MARGIN_PX = 10;

/**
 * Bring a just-opened preview into sight: cap its height to its scroll pane's visible height (it
 * scrolls inside itself beyond that), scroll it into view within the pane by the least distance,
 * and move focus into it without scrolling again.
 */
export function revealCleavagePreview(el: RevealableElement, pane: RevealableElement | null): void {
  if (pane && pane.clientHeight) {
    el.style.maxHeight = `${Math.max(48, pane.clientHeight - PANE_FIT_MARGIN_PX)}px`;
    el.style.overflowY = 'auto';
  }
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  el.focus({ preventScroll: true });
}

export interface CleavageDrawingProps {
  /** The engine's record of the one site to draw. */
  site: RestrictionCutSite;
  /** The molecule the site was scanned on. */
  sequence: string;
  circular: boolean;
  /** Bases shown beyond the motif and both cuts. */
  flank?: number;
}

/**
 * The picture of one engine site, shared by the Enzymes view's cleavage preview and the
 * Restriction Enzymes window's definition preview (US-01M7DVDV), so the two draw one picture: the
 * matched site with its 1-based coordinates and orientation, the two strands with the motif marked
 * on the strand that carries it and both cuts where {@link cleavagePicture} places them, the end
 * the cut leaves, and whether it is a Type IIS or methylation-blocked site.
 */
export const CleavageDrawing: React.FC<CleavageDrawingProps> = ({ site, sequence, circular, flank = 4 }) => {
  const p = cleavagePicture(site, sequence, circular, flank);
  const strands = labelledStrands(p);
  const motifSpan = motifSpanInLabelled(p);
  const siteSeq = p.top.slice(p.motif.start, p.motif.end);
  const first = p.coordinates[p.motif.start];
  const last = p.coordinates[p.motif.end - 1];
  const orientation =
    p.recognitionStrand === 'top'
      ? 'forward (+) strand'
      : `reverse (−) strand: ${reverse(p.bottom.slice(p.motif.start, p.motif.end))} read 5'→3' on the bottom strand`;
  const sensitivity = site.enzyme.methylationSensitivity ?? [];

  return (
    <>
      <p style={{ margin: '2px 0' }}>{`Site ${siteSeq}, bases ${first}–${last}, ${orientation}`}</p>
      {p.crossesOrigin && (
        <p style={{ margin: '2px 0' }}>{`It runs across the origin, from base ${sequence.length} to base 1.`}</p>
      )}
      <pre
        aria-label="Top strand 5' to 3' over bottom strand 3' to 5', ▼ and ▲ marking the cuts"
        style={{ margin: '6px 0', fontFamily: 'var(--font-mono)', lineHeight: 1.4, overflowX: 'auto' }}
      >
        <StrandLine strand="top" text={strands.top} motif={p.recognitionStrand === 'top' ? motifSpan : null} />
        {'\n'}
        <StrandLine strand="bottom" text={strands.bottom} motif={p.recognitionStrand === 'bottom' ? motifSpan : null} />
      </pre>
      <p style={{ margin: '2px 0' }}>{`${cutWords('Top', p.topCut)}; ${cutWords('bottom', p.bottomCut)}`}</p>
      <p style={{ margin: '2px 0' }}>
        <strong>{endWords(p)}</strong>
      </p>
      {p.typeIIS && (
        <p style={{ margin: '2px 0' }}>
          {`Type IIS: cuts outside the ${site.enzyme.recognitionSeq} motif, top strand ${p.topCut.gapFromMotif} nt and bottom strand ${p.bottomCut.gapFromMotif} nt from it`}
        </p>
      )}
      {p.cleavage === 'methylation-blocked' && (
        <p role="status" style={{ margin: '2px 0', padding: '2px 6px', background: 'var(--mbc-amber-soft)', border: '1px solid var(--mbc-amber-border)', borderRadius: 4 }}>
          {`Methylation may block this cut${sensitivity.length > 0 ? ` (${site.enzyme.name} is ${sensitivity.join('/')}-sensitive)` : ''}: it is not a guaranteed cut.`}
        </p>
      )}
    </>
  );
};

export interface CleavagePreviewProps extends CleavageDrawingProps {
  /** Asked when the preview is dismissed (Escape or its close button). */
  onClose: () => void;
  id?: string;
  /** View the site's enzyme definition (US-01M7JPSK); absent, the preview offers no such button. */
  onViewEnzyme?: (site: RestrictionCutSite) => void;
  /** Add the site's enzyme to a collection (US-01M7JPSK); absent, the preview offers no such button. */
  onAddEnzymeToCollection?: (site: RestrictionCutSite) => void;
}

/**
 * The cleavage preview of one restriction site: a dialog holding its {@link CleavageDrawing}, brought
 * into sight and focused when it opens.
 */
export const CleavagePreview: React.FC<CleavagePreviewProps> = ({ site, sequence, circular, flank = 4, onClose, id, onViewEnzyme, onAddEnzymeToCollection }) => {
  // The enzyme as every surface names it: a custom definition's marked "(custom)" (US-01M7JPSK).
  const label = enzymeLabel(site.enzyme);
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = rootRef.current as unknown as RevealableElement | null;
    if (el) revealCleavagePreview(el, scrollPaneOf(el));
  }, [site.id]);

  return (
    <section
      id={id}
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${label} cleavage preview`}
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
        boxSizing: 'border-box',
        background: 'var(--mbc-bg-elevated)',
        color: 'var(--mbc-text-main)',
        fontSize: 'var(--font-size-caption)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong>{`${label} cleavage`}</strong>
        <button type="button" className="mbc-icon-btn" aria-label="Close cleavage preview" onClick={onClose}>
          ×
        </button>
      </div>
      {(onViewEnzyme || onAddEnzymeToCollection) && (
        <div className="cloning-action-row">
          {onViewEnzyme && (
            <button type="button" aria-label={`View the ${label} enzyme definition`} onClick={() => onViewEnzyme(site)}>
              View definition
            </button>
          )}
          {onAddEnzymeToCollection && (
            <button type="button" aria-label={`Add ${label} to a collection`} onClick={() => onAddEnzymeToCollection(site)}>
              Add to collection
            </button>
          )}
        </div>
      )}
      <CleavageDrawing site={site} sequence={sequence} circular={circular} flank={flank} />
    </section>
  );
};
