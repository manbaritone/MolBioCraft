// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The workbench's one right-hand inspector (D0060, D0063, D0064). App owns the open state (one,
 * session-only, open by default) and the column node (its `aside.mbc-right-controls` body), and
 * hands both to WorkbenchInspectorProvider, which it renders around the main viewer canvas's
 * content. The provider holds only the studios' claims on the inspector, and tells App when they
 * cross between none and some, so App draws the header's inspector button on a tab with settings
 * and hides it on one with nothing to set.
 *
 * A studio claims the inspector in one of two ways:
 * - InspectorSection: a group of settings, drawn by portal into App's column as an accordion
 *   section, so its state stays the studio's own;
 * - useOwnInspector(active): for a studio that draws its own panel (the alignment studio's MSA
 *   grid, in US-01M6TA6T). App then shows the button and draws no column, and the studio draws
 *   its panel while the inspector is open.
 *
 * Drawn outside the workbench (a standalone studio, the split view's pane), there is no provider:
 * an InspectorSection renders its children exactly as passed, where they sit, and useOwnInspector
 * says to draw the panel.
 */

import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';

// The server renderer runs no effects (and warns about a layout effect); refs never fire there.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** How a studio claims the inspector: settings in App's column, or a panel of its own. */
export type InspectorClaimKind = 'shared' | 'own';

/** Whether any mounted studio claims the inspector, by kind. */
export interface InspectorClaims {
  shared: boolean;
  own: boolean;
}
export const NO_INSPECTOR_CLAIMS: InspectorClaims = { shared: false, own: false };

export interface WorkbenchInspectorValue {
  /** App's open state. */
  open: boolean;
  /** The node App's column gives the sections, or null while no column is drawn. */
  column: HTMLElement | null;
  /**
   * Claims the inspector for `owner` (one object per section or studio, so a second claim by the
   * same owner counts once) and returns the release.
   */
  claim(owner: object, kind: InspectorClaimKind): () => void;
}

export const WorkbenchInspectorContext = createContext<WorkbenchInspectorValue | null>(null);

export interface WorkbenchInspectorProviderProps {
  open: boolean;
  column: HTMLElement | null;
  /** Called only when the claims cross between none and some, of either kind. */
  onClaimsChange(claims: InspectorClaims): void;
  children?: React.ReactNode;
}

const sameClaims = (a: InspectorClaims, b: InspectorClaims) => a.shared === b.shared && a.own === b.own;

export function WorkbenchInspectorProvider({ open, column, onClaimsChange, children }: WorkbenchInspectorProviderProps) {
  // The claims live in a ref, so a claim or release re-renders nothing here; App re-renders only
  // on a crossing it is told of.
  const claims = useRef(new Map<object, InspectorClaimKind>());
  const reported = useRef<InspectorClaims>(NO_INSPECTOR_CLAIMS);
  const onChange = useRef(onClaimsChange);
  onChange.current = onClaimsChange;

  const claim = useMemo(() => {
    const current = (): InspectorClaims => {
      const kinds = [...claims.current.values()];
      return { shared: kinds.includes('shared'), own: kinds.includes('own') };
    };
    const report = () => {
      const now = current();
      if (sameClaims(now, reported.current)) return;
      reported.current = now;
      onChange.current(now);
    };
    let releaseQueued = false;
    return (owner: object, kind: InspectorClaimKind) => {
      claims.current.set(owner, kind);
      // A first claim is told at once, so App draws the button before the browser paints the section.
      report();
      return () => {
        if (claims.current.get(owner) === kind) claims.current.delete(owner);
        // A release is told after the commit: a section unmounted as the next one mounts (a
        // sub-tab switch), or StrictMode's second mount, then crosses nothing and is never told.
        if (releaseQueued) return;
        releaseQueued = true;
        queueMicrotask(() => {
          releaseQueued = false;
          report();
        });
      };
    };
  }, []);

  const value = useMemo<WorkbenchInspectorValue>(() => ({ open, column, claim }), [open, column, claim]);
  return <WorkbenchInspectorContext.Provider value={value}>{children}</WorkbenchInspectorContext.Provider>;
}

/** Whether the caller is drawn inside the workbench (its provider), not standalone. */
export function useInWorkbench(): boolean {
  return useContext(WorkbenchInspectorContext) !== null;
}

/**
 * For a studio that draws its own panel: claims the inspector while `active`, so App shows the
 * button and draws no column. Returns whether to draw the panel: App's open state inside the
 * workbench, always outside it.
 */
export function useOwnInspector(active: boolean): boolean {
  const ctx = useContext(WorkbenchInspectorContext);
  const owner = useRef<object>({});
  const claim = ctx?.claim;
  useIsomorphicLayoutEffect(() => (claim && active ? claim(owner.current, 'own') : undefined), [claim, active]);
  return ctx ? ctx.open : true;
}

export interface InspectorSectionProps {
  /** The section's accordion header. */
  title: string;
  /** Its place among the column's sections (the CSS order). */
  order: number;
  /** Whether the section is unfolded, for a studio that keeps that state; unfolded unless given. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  children?: React.ReactNode;
}

/**
 * A group of a studio's settings. Inside the workbench it claims the inspector while mounted and,
 * while the inspector is open, is drawn in App's column as an accordion section (nothing while it
 * is closed). Outside the workbench it is its children, exactly as passed.
 */
export function InspectorSection({ title, order, open, onOpenChange, children }: InspectorSectionProps) {
  const ctx = useContext(WorkbenchInspectorContext);
  const owner = useRef<object>({});
  const [unfoldedHere, setUnfoldedHere] = useState(true);
  const claim = ctx?.claim;
  useIsomorphicLayoutEffect(() => (claim ? claim(owner.current, 'shared') : undefined), [claim]);

  if (!ctx) return <>{children}</>;
  // createPortal throws in the server renderer (React 18.3), and with no document there is no column.
  if (!ctx.open || !ctx.column || typeof document === 'undefined') return null;
  const unfolded = open ?? unfoldedHere;
  const toggle = () => {
    if (open === undefined) setUnfoldedHere(!unfolded);
    onOpenChange?.(!unfolded);
  };
  return createPortal(
    <div className="mbc-accordion-section" style={{ order }}>
      <button type="button" aria-expanded={unfolded} className="mbc-accordion-header" onClick={toggle}>
        {unfolded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
      </button>
      {unfolded && <div className="mbc-accordion-body">{children}</div>}
    </div>,
    ctx.column
  );
}
