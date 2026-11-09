// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The Export control that sits beside a figure or a table.
 *
 * One control serves every view: it is handed the element the view draws into, and works out for
 * itself what can be saved from it. A view holding a drawing offers PNG, JPEG, SVG and PDF; a view
 * holding a table also offers text, tab-separated and comma-separated values. A view holding both
 * offers all of them, so a chart and the numbers behind it leave together.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import {
  availableFormats,
  captureTable,
  exportFigure,
  findFigureSvg,
  type FigureExportOutcome,
} from '../core/figureCapture';
import { FIGURE_FORMAT_META, type FigureExportFormat, type FigureTable } from '../core/figureExport';

/**
 * Where the control looks for the figure when it is not handed one: the nearest enclosing element
 * marked as a figure, else the card or panel it sits in. Marking a container with
 * `data-mbc-figure` is how a view says "this is the thing to export", and is all most views need.
 */
export const FIGURE_CONTAINER_SELECTOR =
  '[data-mbc-figure], .studio-card, .mbc-studio-card, section, .mbc-panel';

export interface FigureExportButtonProps {
  /**
   * The element the figure is drawn into; its first `<svg>` and `<table>` are what get saved.
   * Left out, the control finds the container it is sitting in, which is enough for a view whose
   * figure and its heading live in the same card.
   */
  targetRef?: React.RefObject<HTMLElement | null>;
  /** Stem of the saved file, usually "<document> — <figure>". */
  baseName: string;
  /** Written into the SVG's `<title>` and the PDF's metadata; defaults to `baseName`. */
  title?: string;
  /** Values to save instead of reading them back out of a rendered table. */
  table?: FigureTable | (() => FigureTable | null) | null;
  /** A report to save as `.txt`, for a view whose content is prose rather than a table. */
  text?: string | (() => string | null) | null;
  /** A one-line caption written above the table in the `.txt` form. */
  caption?: string;
  /** Serializer for the delimited forms, for a view that already has one it must keep using. */
  delimitedWriter?: (headers: string[], rows: string[][], delimiter: ',' | '\t') => string;
  /** Called with the outcome so the host can put it in its own status bar. */
  onStatus?: (message: string) => void;
  /** Smaller control, for a figure in a dense panel. */
  compact?: boolean;
  className?: string;
}

const resolve = <T,>(value: T | (() => T | null) | null | undefined): T | null => {
  if (typeof value === 'function') return (value as () => T | null)() ?? null;
  return value ?? null;
};

/** Pick a file-name stem the user will recognise if they later look for the file. */
function describeOutcome(outcome: FigureExportOutcome, filename: string, error?: string): string {
  if (outcome === 'native') return `Choose where to save "${filename}"`;
  if (outcome === 'downloaded') return `Exported "${filename}"`;
  return error ? `Export failed: ${error}` : `Export failed for "${filename}"`;
}

export function FigureExportButton({
  targetRef,
  baseName,
  title,
  table,
  text,
  caption,
  delimitedWriter,
  onStatus,
  compact = false,
  className,
}: FigureExportButtonProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<FigureExportFormat | null>(null);
  const [note, setNote] = useState('');
  const [formats, setFormats] = useState<FigureExportFormat[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /** The element whose contents this control saves. */
  const hostElement = useCallback((): HTMLElement | null => {
    if (targetRef?.current) return targetRef.current;
    const self = wrapRef.current;
    if (!self) return null;
    return (self.closest(FIGURE_CONTAINER_SELECTOR) as HTMLElement | null) ?? self.parentElement;
  }, [targetRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /** Look at what the view actually holds right now, rather than at what it held when mounted. */
  const openMenu = useCallback(() => {
    const host = hostElement();
    const hasFigure = Boolean(findFigureSvg(host));
    const hasTable = Boolean(resolve(table)) || Boolean(host?.querySelector('table'));
    const hasText = Boolean(resolve(text));
    setFormats(availableFormats({ hasFigure, hasTable, hasText }));
    setOpen((previous) => !previous);
  }, [hostElement, table, text]);

  const run = useCallback(
    async (format: FigureExportFormat) => {
      setOpen(false);
      setBusy(format);
      try {
        const host = hostElement();
        const provided = resolve(table);
        const domTable = host?.querySelector('table');
        const result = await exportFigure(
          {
            svg: findFigureSvg(host),
            table: provided ?? (domTable ? captureTable(domTable, caption) : null),
            text: resolve(text),
            baseName,
            title: title ?? baseName,
            delimitedWriter,
          },
          format
        );
        const message = describeOutcome(result.outcome, result.filename, result.error);
        setNote(message);
        onStatus?.(message);
      } finally {
        setBusy(null);
      }
    },
    [baseName, caption, delimitedWriter, hostElement, onStatus, table, text, title]
  );

  useEffect(() => {
    if (!note) return undefined;
    const timer = window.setTimeout(() => setNote(''), 6000);
    return () => window.clearTimeout(timer);
  }, [note]);

  return (
    <div
      className={`mbc-figure-export${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}
      ref={wrapRef}
    >
      <button
        type="button"
        className="btn-secondary-sm mbc-figure-export-trigger"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Export "${baseName}" as an image, a document or a table`}
        disabled={busy !== null}
      >
        <Download size={compact ? 11 : 12} aria-hidden="true" />
        {busy ? `Exporting ${FIGURE_FORMAT_META[busy].extension.toUpperCase()}…` : 'Export'}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="mbc-columns-popover mbc-figure-export-menu" role="menu">
          {formats.length === 0 && <div className="mbc-figure-export-empty">Nothing to export here yet</div>}
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className="mbc-figure-export-item"
              onClick={() => {
                void run(format);
              }}
            >
              <span className="mbc-figure-export-ext">{FIGURE_FORMAT_META[format].extension.toUpperCase()}</span>
              <span>{FIGURE_FORMAT_META[format].label}</span>
            </button>
          ))}
        </div>
      )}
      {note && !onStatus && <span className="mbc-figure-export-note">{note}</span>}
    </div>
  );
}
