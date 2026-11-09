// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface ScrollableMenuStripProps {
  children?: React.ReactNode;
  /** Additional modifier class on the outer `.mbc-scroll-strip` shell. */
  className?: string;
  /** Optional class on the `container-type: scroll-state` scrollport. */
  scrollerClassName?: string;
  /** Class applied to the inner flex track containing the menu/tab items. */
  trackClassName?: string;
  /** Optional inline style on the outer `.mbc-scroll-strip` shell. */
  style?: React.CSSProperties;
  /** ARIA role applied to the inner item track (e.g. `'tablist'`). */
  role?: React.AriaRole;
  /** Accessible label applied to the inner item track. */
  ariaLabel?: string;
  /** Additional keydown handler on the track. */
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  /**
   * Keep left/right slide arrow buttons visible even when all items fit within
   * the viewport. When false (default), arrows appear automatically on overflow.
   */
  alwaysShowArrows?: boolean;
  /**
   * Key representing the currently active item. When changed, the active element
   * inside the track is scrolled into view (`block: 'nearest', inline: 'nearest'`).
   */
  activeKey?: string | number;
  /**
   * Enable geometry-based ArrowLeft / ArrowRight spatial focus navigation across
   * visible interactive items inside the track.
   */
  enableSpatialArrowNav?: boolean;
  /** When spatial arrow navigation moves focus to a tab button, also click/activate it. */
  activateOnSpatialFocus?: boolean;
  /** Optional previous-item stepper when `alwaysShowArrows` is true and strip fits without overflow. */
  onStepPrev?: () => void;
  /** Optional next-item stepper when `alwaysShowArrows` is true and strip fits without overflow. */
  onStepNext?: () => void;
  canStepPrev?: boolean;
  canStepNext?: boolean;
  prevAriaLabel?: string;
  nextAriaLabel?: string;
  /** Mark non-interactive background space as a Tauri window drag region. */
  dragRegion?: boolean;
  /** Fixed pixel slide distance per arrow click (defaults to ~55% of viewport width, min 180px). */
  scrollStepPx?: number;
}

export const ScrollableMenuStrip: React.FC<ScrollableMenuStripProps> = ({
  children,
  className = '',
  scrollerClassName = '',
  trackClassName = '',
  style,
  role,
  ariaLabel,
  onKeyDown,
  alwaysShowArrows = false,
  activeKey,
  enableSpatialArrowNav = false,
  activateOnSpatialFocus = false,
  onStepPrev,
  onStepNext,
  canStepPrev = false,
  canStepNext = false,
  prevAriaLabel = 'Slide menus left',
  nextAriaLabel = 'Slide menus right',
  dragRegion = false,
  scrollStepPx,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const startSentinelRef = useRef<HTMLSpanElement | null>(null);
  const endSentinelRef = useRef<HTMLSpanElement | null>(null);

  const [isOverflowing, setIsOverflowing] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncScrollMetrics = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    const overflowing = maxScrollLeft > 1.5;
    const leftAvail = overflowing && scroller.scrollLeft > 1.5;
    const rightAvail = overflowing && scroller.scrollLeft < maxScrollLeft - 1.5;

    setIsOverflowing((prev) => (prev !== overflowing ? overflowing : prev));
    setCanScrollLeft((prev) => (prev !== leftAvail ? leftAvail : prev));
    setCanScrollRight((prev) => (prev !== rightAvail ? rightAvail : prev));

    scroller.classList.toggle('can-scroll-left', leftAvail);
    scroller.classList.toggle('can-scroll-right', rightAvail);
  }, []);

  // Observers are installed once per mount. Content changes that alter the strip's
  // geometry are picked up by the ResizeObserver on the inner track, so `children`
  // must NOT be a dependency here: parent re-renders always produce new `children`
  // element identities, which previously tore down and re-created every observer and
  // forced a synchronous layout (`scrollWidth` read) after every App commit.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    const startSentinel = startSentinelRef.current;
    const endSentinel = endSentinelRef.current;
    if (!scroller) return;

    syncScrollMetrics();

    // Coalesce scroll-driven metric reads to at most one per animation frame.
    let scrollRaf = 0;
    const handleScroll = () => {
      if (scrollRaf !== 0) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        syncScrollMetrics();
      });
    };
    scroller.addEventListener('scroll', handleScroll, { passive: true });

    let intersectionObserver: IntersectionObserver | null = null;
    const supportsScrollStateQuery =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('container-type', 'scroll-state');

    if (
      !supportsScrollStateQuery &&
      typeof IntersectionObserver !== 'undefined' &&
      startSentinel &&
      endSentinel
    ) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === startSentinel) {
              scroller.classList.toggle('can-scroll-left', !entry.isIntersecting);
            } else if (entry.target === endSentinel) {
              scroller.classList.toggle('can-scroll-right', !entry.isIntersecting);
            }
          }
          syncScrollMetrics();
        },
        { root: scroller, threshold: 0.9 }
      );
      intersectionObserver.observe(startSentinel);
      intersectionObserver.observe(endSentinel);
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        syncScrollMetrics();
      });
      resizeObserver.observe(scroller);
      if (track) {
        resizeObserver.observe(track);
      }
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleScroll);
    }

    return () => {
      if (scrollRaf !== 0) cancelAnimationFrame(scrollRaf);
      scroller.removeEventListener('scroll', handleScroll);
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      if (!resizeObserver && typeof window !== 'undefined') {
        window.removeEventListener('resize', handleScroll);
      }
    };
  }, [syncScrollMetrics]);

  useEffect(() => {
    if (activeKey === undefined) return;
    const track = trackRef.current;
    if (!track) return;
    const activeEl = track.querySelector<HTMLElement>(
      '[aria-selected="true"], .active, .focused'
    );
    if (!activeEl || typeof activeEl.scrollIntoView !== 'function') return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeEl.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeKey]);

  const handleSlide = (
    direction: 'left' | 'right',
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.stopPropagation();
    const scroller = scrollerRef.current;
    const overflowing = scroller
      ? scroller.scrollWidth - scroller.clientWidth > 1.5
      : isOverflowing;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (overflowing && scroller) {
      if (e.altKey) {
        scroller.scrollTo({
          left: direction === 'left' ? 0 : scroller.scrollWidth,
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
        });
        return;
      }
      const step =
        scrollStepPx ?? Math.max(180, Math.round(scroller.clientWidth * 0.56));
      scroller.scrollBy({
        left: direction === 'left' ? -step : step,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
      return;
    }

    if (direction === 'left' && onStepPrev && canStepPrev) {
      onStepPrev();
    } else if (direction === 'right' && onStepNext && canStepNext) {
      onStepNext();
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (scroller.scrollWidth - scroller.clientWidth <= 1.5) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaY !== 0) {
      scroller.scrollLeft += e.deltaY;
    }
  };

  const handleTrackKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (!enableSpatialArrowNav || e.defaultPrevented) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

    const pathRoot =
      typeof e.nativeEvent?.composedPath === 'function'
        ? (e.nativeEvent.composedPath()[0] as Element | undefined)
        : (e.target as Element | null);
    if (
      pathRoot &&
      typeof pathRoot.matches === 'function' &&
      pathRoot.matches(':read-write, select, input[type="range"], [role="slider"]')
    ) {
      return;
    }

    const track = trackRef.current;
    if (!track || typeof document === 'undefined') return;
    const focused = document.activeElement as HTMLElement | null;
    if (!focused) return;

    const rawCandidates = Array.from(
      track.querySelectorAll<HTMLElement>(
        '[role="tab"]:not([aria-disabled="true"]):not(:disabled), button:not(:disabled)'
      )
    );
    const candidates = rawCandidates.filter((el) =>
      typeof el.checkVisibility === 'function' ? el.checkVisibility() : true
    );
    if (!candidates.includes(focused)) return;

    const currentRect = focused.getBoundingClientRect();
    const tolerance = 2;
    let bestCandidate: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (candidate === focused) continue;
      const rect = candidate.getBoundingClientRect();
      const inDirection =
        e.key === 'ArrowRight'
          ? rect.left >= currentRect.right - tolerance
          : rect.right <= currentRect.left + tolerance;
      if (!inDirection) continue;

      const gap =
        e.key === 'ArrowRight'
          ? Math.max(0, rect.left - currentRect.right)
          : Math.max(0, currentRect.left - rect.right);
      const overlapsPerp =
        Math.min(rect.bottom, currentRect.bottom) >
        Math.max(rect.top, currentRect.top);
      const perpOffset = Math.abs(
        (rect.top + rect.bottom) / 2 - (currentRect.top + currentRect.bottom) / 2
      );
      const score = overlapsPerp ? gap + perpOffset * 0.01 : 100000 + gap + 2 * perpOffset;

      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      // Preserve native boundary scrolling when no focus candidate exists in the pressed direction.
      return;
    }

    e.preventDefault();
    if (activateOnSpatialFocus) {
      bestCandidate.click();
    }
    bestCandidate.focus();
    bestCandidate.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const showArrows = alwaysShowArrows || isOverflowing;
  const prevDisabled = isOverflowing
    ? !canScrollLeft
    : !(onStepPrev && canStepPrev);
  const nextDisabled = isOverflowing
    ? !canScrollRight
    : !(onStepNext && canStepNext);

  return (
    <div
      className={`mbc-scroll-strip ${
        isOverflowing ? 'is-overflowing' : 'is-fitting'
      } ${alwaysShowArrows ? 'always-arrows' : 'auto-arrows'} ${className}`.trim()}
      style={style}
      {...(dragRegion ? { 'data-tauri-drag-region': true } : {})}
    >
      {showArrows && (
        <button
          type="button"
          className="mbc-menu-slide-btn prev"
          data-no-window-drag
          disabled={prevDisabled}
          onClick={(e) => handleSlide('left', e)}
          aria-label={prevAriaLabel}
          title={
            isOverflowing
              ? `${prevAriaLabel} (⌥-Click to jump to start)`
              : prevAriaLabel
          }
        >
          <ChevronLeft size={14} strokeWidth={2.35} aria-hidden="true" />
        </button>
      )}

      <div
        ref={scrollerRef}
        className={`mbc-scroll-strip-scroller ${scrollerClassName}`.trim()}
        onWheel={handleWheel}
        {...(dragRegion ? { 'data-tauri-drag-region': true } : {})}
      >
        <span
          ref={startSentinelRef}
          className="mbc-scroll-sentinel mbc-scroll-sentinel-start"
          aria-hidden="true"
        />
        <span
          className="mbc-scroll-fade mbc-scroll-fade-left"
          aria-hidden="true"
        />
        <div
          ref={trackRef}
          className={`mbc-scroll-strip-track ${trackClassName}`.trim()}
          role={role}
          aria-label={ariaLabel}
          onKeyDown={handleTrackKeyDown}
          {...(dragRegion ? { 'data-tauri-drag-region': true } : {})}
        >
          {children}
        </div>
        <span
          className="mbc-scroll-fade mbc-scroll-fade-right"
          aria-hidden="true"
        />
        <span
          ref={endSentinelRef}
          className="mbc-scroll-sentinel mbc-scroll-sentinel-end"
          aria-hidden="true"
        />
      </div>

      {showArrows && (
        <button
          type="button"
          className="mbc-menu-slide-btn next"
          data-no-window-drag
          disabled={nextDisabled}
          onClick={(e) => handleSlide('right', e)}
          aria-label={nextAriaLabel}
          title={
            isOverflowing
              ? `${nextAriaLabel} (⌥-Click to jump to end)`
              : nextAriaLabel
          }
        >
          <ChevronRight size={14} strokeWidth={2.35} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
