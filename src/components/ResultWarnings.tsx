// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { TriangleAlert } from 'lucide-react';

export interface ResultWarningsProps {
  /**
   * The engine's warnings for the result this sits beside (D0005): one plain sentence each, as
   * the engine wrote it. Nothing renders when there are none, or the reply left the field out.
   */
  warnings: readonly string[] | undefined;
  /** The accessible name of the warnings region, saying what they belong to ("Alignment warnings"). */
  label?: string;
}

/**
 * The shared component a studio shows a result's engine warnings with (D0005): a truncation, a cap
 * or a fallback, each as its own sentence in a Caution Amber note, rendered in place, next to the
 * result it sits beside. A repeated sentence is shown once and a blank one not at all.
 *
 * Each sentence is keyed by its own text, so re-rendering the same warnings keeps the nodes already
 * shown, and a warning that arrives later is inserted without replacing the ones before it.
 *
 * Do not rely on a screen-reader announcement. The status region is mounted already filled (it
 * renders nothing until there is a warning), and screen readers do not reliably announce a live
 * region that arrives with its content. The warning is there to be read where it sits, beside the
 * result.
 */
export function ResultWarnings({ warnings, label = 'Warnings' }: ResultWarningsProps) {
  const shown = [...new Set((warnings ?? []).map((w) => w.trim()).filter(Boolean))];
  if (!shown.length) return null;
  return (
    <div role="status" aria-label={label} data-mbc-result-warnings
      style={{ display: 'grid', gap: 'var(--mbc-space-1)', margin: 'var(--mbc-space-2) 0' }}>
      {shown.map((w) => (
        <p key={w} className="cloning-warning-note"
          style={{ display: 'flex', gap: 'var(--mbc-space-2)', alignItems: 'flex-start', margin: 0 }}>
          <TriangleAlert size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 1 }} />
          <span>{w}</span>
        </p>
      ))}
    </div>
  );
}
