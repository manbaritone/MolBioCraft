// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The studio rail (US-01M6Q1BD, D0015, D0017, D0242): a fixed column left of the project sidebar,
 * shown in a session, that lists every studio and then History and Info in registry order. An
 * entry the document cannot show stays listed, aria-disabled and described by its reason; the
 * current entry is the one studio the open view belongs to. It is a vertical tab list with a roving
 * tab stop: the arrow keys, Home and End move focus, Enter or Space opens (a native button press).
 */

import React, { useEffect, useRef, useState } from 'react';
import type { StudioRailItem, ViewerTab } from '../core/documentViews';
import { studioIconElement, type StudioEntry } from '../core/studioRegistry';

export interface StudioRailProps {
  readonly items: readonly StudioRailItem[];
  /** The viewer tab actually showing (the tablist's data-current-view). */
  readonly currentView: ViewerTab;
  /** The number the Annotations entry shows beside its name. */
  readonly annotationCount: number;
  /** Opens an applicable studio or panel. */
  readonly onOpen: (entry: StudioEntry) => void;
  /** An inapplicable entry was activated: it does not switch, and says why. */
  readonly onRefuse: (reason: string) => void;
}

const reasonId = (entry: StudioEntry) => `mbc-studio-rail-reason-${entry.id}`;

export function StudioRail({ items, currentView, annotationCount, onOpen, onRefuse }: StudioRailProps): React.ReactElement {
  const currentItem = items.find((item) => item.current) ?? items[0];
  const [focusId, setFocusId] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // The tab stop returns to the current studio whenever the studio changes.
  useEffect(() => { setFocusId(null); }, [currentItem.entry.id]);
  // A short window scrolls the rail on its own; the current studio is kept in view.
  useEffect(() => { buttons.current.get(currentItem.entry.id)?.scrollIntoView?.({ block: 'nearest' }); }, [currentItem.entry.id]);
  const stopId = focusId ?? currentItem.entry.id;

  const moveFocus = (event: React.KeyboardEvent, index: number) => {
    const target: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
    if (!(event.key in target)) return;
    event.preventDefault();
    const next = items[(target[event.key] + items.length) % items.length].entry.id;
    setFocusId(next);
    buttons.current.get(next)?.focus();
  };

  return (
    <nav className="mbc-studio-rail" aria-label="Studios">
      <div
        className="mbc-studio-rail-list"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Studios and document panels"
        data-current-studio={currentItem.entry.id}
        data-current-view={currentView}
      >
        {items.map((item, index) => {
          const { entry, availability, current } = item;
          const reason = availability.ok ? null : availability.reason;
          return (
            <React.Fragment key={entry.id}>
              {entry.kind === 'panel' && items[index - 1]?.entry.kind === 'studio' && (
                <span className="mbc-studio-rail-divider" aria-hidden="true" />
              )}
              <button
                type="button"
                role="tab"
                ref={(el) => { if (el) buttons.current.set(entry.id, el); else buttons.current.delete(entry.id); }}
                data-studio={entry.id}
                data-view={entry.opens.tab}
                data-genomics-view={entry.opens.view}
                aria-selected={current}
                aria-disabled={reason ? true : undefined}
                aria-describedby={reason ? reasonId(entry) : undefined}
                tabIndex={stopId === entry.id ? 0 : -1}
                title={reason ?? entry.name}
                className={`mbc-studio-rail-tab${current ? ' current' : ''}${reason ? ' unavailable' : ''}`}
                onFocus={() => setFocusId(entry.id)}
                onKeyDown={(event) => moveFocus(event, index)}
                onClick={() => (reason ? onRefuse(reason) : onOpen(entry))}
              >
                <span className="mbc-studio-rail-icon" aria-hidden="true">{studioIconElement(entry.icon)}</span>
                <span className="mbc-studio-rail-name">{entry.name}</span>
                {entry.id === 'annotations' && (
                  <span className="mbc-studio-rail-count" aria-label={`${annotationCount} annotations`}>{annotationCount}</span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>
      {/* Each disabled entry's reason, its accessible description (and its tooltip). */}
      <div hidden>
        {items.map(({ entry, availability }) => !availability.ok && (
          <span key={entry.id} id={reasonId(entry)}>{availability.reason}</span>
        ))}
      </div>
    </nav>
  );
}
