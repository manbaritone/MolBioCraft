// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import {
  MENU_FUNCTION_INFO_EVENT,
  readStoredShowMenuFunctionInfo,
  resolveMenuNodeFunctionDescription,
  writeStoredShowMenuFunctionInfo,
} from '../data/menuFunctionDescriptions';
import {
  computeViewportClampedSubmenuPosition,
  DropdownViewportPosition,
  SubmenuViewportPosition,
} from '../platform/macosMenuBridge';
import { resolveMenuItemIcon } from './MolBioIcons';
import { shortcutLabelToAriaKeyshortcuts } from '../core/menuShortcuts';

export type MenuNode =
  | {
      kind: 'command';
      id: string;
      label: string;
      icon?: React.ReactNode;
      description?: string;
      shortcut?: string;
      disabled?: boolean;
      onSelect: () => void;
    }
  | {
      kind: 'checkbox';
      id: string;
      label: string;
      icon?: React.ReactNode;
      description?: string;
      checked: boolean;
      shortcut?: string;
      disabled?: boolean;
      onToggle: () => void;
    }
  | {
      kind: 'submenu';
      id: string;
      label: string;
      icon?: React.ReactNode;
      description?: string;
      disabled?: boolean;
      minWidth?: number;
      children: MenuNode[];
    }
  | {
      kind: 'separator';
      id?: string;
    }
  | {
      kind: 'search';
      id: string;
      placeholder: string;
      value: string;
      onChange: (nextValue: string) => void;
    };

export interface CascadingMenuPopupProps {
  items: MenuNode[];
  position: DropdownViewportPosition;
  minWidth?: number;
  ariaLabel?: string;
  isContextMenu?: boolean;
  showFunctionInfo?: boolean;
  onToggleFunctionInfo?: () => void;
  onCloseAll: () => void;
}

function flattenSearchableLeaves(
  nodes: MenuNode[],
  prefix = ''
): Exclude<MenuNode, { kind: 'submenu' | 'separator' | 'search' }>[] {
  const results: Exclude<MenuNode, { kind: 'submenu' | 'separator' | 'search' }>[] = [];
  for (const node of nodes) {
    if (node.kind === 'command' || node.kind === 'checkbox') {
      results.push({
        ...node,
        label: prefix ? `${prefix} › ${node.label}` : node.label,
      });
    } else if (node.kind === 'submenu') {
      const nextPrefix = prefix ? `${prefix} › ${node.label}` : node.label;
      results.push(...flattenSearchableLeaves(node.children, nextPrefix));
    }
  }
  return results;
}

interface MenuLevelProps {
  items: MenuNode[];
  depth: number;
  style: React.CSSProperties;
  stackedBelow?: boolean;
  ariaLabel?: string;
  isContextMenu?: boolean;
  autoFocusFirstItem?: boolean;
  showFunctionInfo: boolean;
  onToggleFunctionInfo: () => void;
  childMenuDomRef?: React.MutableRefObject<HTMLDivElement | null>;
  onCloseAll: () => void;
  onCloseThisLevel?: (restoreFocusToTrigger: boolean) => void;
  onPointerInsideChild?: () => void;
}

interface ActiveTooltipState {
  nodeId: string;
  text: string;
  top: number;
  left: number;
}

function computeMenuTooltipCoords(rowEl: HTMLElement): { top: number; left: number } {
  const rect = rowEl.getBoundingClientRect();
  const vw = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800;
  const estWidth = 340;
  const estHeight = 44;
  const offsetX = rect.width > 0 ? Math.min(72, Math.round(rect.width * 0.34)) : 56;
  let left = Math.round(rect.left + offsetX);
  let top = Math.round(rect.bottom + 3);
  if (left + estWidth > vw - 10) {
    left = Math.max(8, vw - estWidth - 10);
  }
  if (top + estHeight > vh - 8) {
    top = Math.max(8, Math.round(rect.top - estHeight - 3));
  }
  return { top, left };
}

const supportsNativeFocusGroup =
  typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

const SAFE_TRIANGLE_GRACE_MS = 260;

function focusMenuRowFromPointer(el: HTMLButtonElement): void {
  if (typeof document !== 'undefined' && document.activeElement === el) return;
  (
    el as HTMLButtonElement & {
      focus: (opts?: FocusOptions & { focusVisible?: boolean }) => void;
    }
  ).focus({ preventScroll: true, focusVisible: false });
}

const CascadingMenuLevel: React.FC<MenuLevelProps> = ({
  items,
  depth,
  style,
  stackedBelow = false,
  ariaLabel,
  isContextMenu = false,
  autoFocusFirstItem = false,
  showFunctionInfo,
  onToggleFunctionInfo,
  childMenuDomRef,
  onCloseAll,
  onCloseThisLevel,
  onPointerInsideChild,
}) => {
  const tooltipDomId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const openChildRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hoverTimerRef = useRef<number | null>(null);
  const tooltipLeaveTimerRef = useRef<number | null>(null);
  const pointerOverTooltipRef = useRef<boolean>(false);
  const [activeTooltip, setActiveTooltip] = useState<ActiveTooltipState | null>(null);

  const clearTooltipLeaveTimer = () => {
    if (tooltipLeaveTimerRef.current !== null) {
      window.clearTimeout(tooltipLeaveTimerRef.current);
      tooltipLeaveTimerRef.current = null;
    }
  };

  const showTooltipForRow = (
    nodeId: string,
    label: string,
    explicitDescription: string | undefined,
    isSubmenu: boolean,
    rowEl: HTMLElement
  ) => {
    clearTooltipLeaveTimer();
    if (!showFunctionInfo) {
      setActiveTooltip(null);
      return;
    }
    const text = resolveMenuNodeFunctionDescription(
      nodeId,
      label,
      explicitDescription,
      isSubmenu
    );
    if (!text) {
      setActiveTooltip(null);
      return;
    }
    const { top, left } = computeMenuTooltipCoords(rowEl);
    setActiveTooltip({ nodeId, text, top, left });
  };

  const scheduleHideTooltip = (nodeId: string) => {
    clearTooltipLeaveTimer();
    tooltipLeaveTimerRef.current = window.setTimeout(() => {
      tooltipLeaveTimerRef.current = null;
      if (!pointerOverTooltipRef.current) {
        setActiveTooltip((prev) => (prev?.nodeId === nodeId ? null : prev));
      }
    }, 90);
  };

  useEffect(() => {
    if (!showFunctionInfo) {
      setActiveTooltip(null);
    }
  }, [showFunctionInfo]);

  useEffect(() => {
    return () => {
      clearTooltipLeaveTimer();
    };
  }, []);
  const pendingNodeIdRef = useRef<string | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const prevPointerRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const [openSubmenu, setOpenSubmenu] = useState<{
    id: string;
    pos: SubmenuViewportPosition;
    focusFirst: boolean;
  } | null>(null);

  const setMergedContainerRef = (el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (childMenuDomRef) {
      childMenuDomRef.current = el;
    }
  };

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    pendingNodeIdRef.current = null;
  };

  useEffect(() => {
    return () => clearHoverTimer();
  }, []);

  useEffect(() => {
    if (!autoFocusFirstItem || !containerRef.current) return;
    const buttons = getDirectEnabledButtons(containerRef.current);
    buttons[0]?.focus({ preventScroll: true });
  }, [autoFocusFirstItem, items]);

  const recordPointerSample = (clientX: number, clientY: number) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = lastPointerRef.current;
    if (!last || Math.abs(clientX - last.x) + Math.abs(clientY - last.y) >= 1.5) {
      prevPointerRef.current = last;
      lastPointerRef.current = { x: clientX, y: clientY, t: now };
    }
  };

  /**
   * Safe-triangle trajectory check: returns true ONLY when an open child submenu
   * exists to the left/right and the pointer velocity vector projects onto the
   * open child submenu's near edge. Vertical motion along the menu returns false,
   * allowing 0ms instantaneous submenu switching.
   */
  const isMovingTowardOpenChildSubmenu = (px: number, py: number): boolean => {
    if (
      !openSubmenu ||
      openSubmenu.pos.stackedBelow ||
      !openChildRef.current ||
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        !window.matchMedia('(hover: hover)').matches)
    ) {
      return false;
    }
    const prev = prevPointerRef.current;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!prev || now - prev.t > 280) return false;

    const rect = openChildRef.current.getBoundingClientRect();
    const dx = px - prev.x;
    const dy = py - prev.y;

    if (!openSubmenu.pos.flippedLeft) {
      if (dx <= 1.0 || px >= rect.left + 6) return false;
      const distToEdge = Math.max(0, rect.left - px);
      const projectedY = py + (dy / dx) * distToEdge;
      return projectedY >= rect.top - 24 && projectedY <= rect.bottom + 24;
    } else {
      if (dx >= -1.0 || px <= rect.right - 6) return false;
      const distToEdge = Math.min(0, rect.right - px);
      const projectedY = py + (dy / dx) * distToEdge;
      return projectedY >= rect.top - 24 && projectedY <= rect.bottom + 24;
    }
  };

  const isPredominantlyVerticalMotion = (): boolean => {
    const prev = prevPointerRef.current;
    const last = lastPointerRef.current;
    if (!prev || !last) return false;
    const adx = Math.abs(last.x - prev.x);
    const ady = Math.abs(last.y - prev.y);
    return ady >= 3 && ady > adx * 1.6;
  };

  const searchNode = useMemo(
    () => items.find((n): n is Extract<MenuNode, { kind: 'search' }> => n.kind === 'search'),
    [items]
  );

  const effectiveItems = useMemo<MenuNode[]>(() => {
    const query = searchNode?.value.trim().toLowerCase() ?? '';
    if (!searchNode || !query) return items;
    const leaves = flattenSearchableLeaves(items).filter((leaf) =>
      leaf.label.toLowerCase().includes(query)
    );
    return [
      searchNode,
      { kind: 'separator', id: 'search-sep' },
      ...(leaves.length > 0
        ? leaves
        : [
            {
              kind: 'command' as const,
              id: 'no-search-matches',
              label: `No matching commands for "${searchNode.value}"`,
              disabled: true,
              onSelect: () => {},
            },
          ]),
    ];
  }, [items, searchNode]);

  const openSubmenuForNode = (
    node: Extract<MenuNode, { kind: 'submenu' }>,
    triggerEl: HTMLElement,
    focusFirst: boolean
  ) => {
    if (node.disabled) return;
    const rect = triggerEl.getBoundingClientRect();
    const estimatedRows = Math.max(2, node.children.length);
    const estimatedHeight = Math.min(460, estimatedRows * 32 + 16);
    const pos = computeViewportClampedSubmenuPosition(
      rect,
      typeof window !== 'undefined' ? window.innerWidth : 1280,
      typeof window !== 'undefined' ? window.innerHeight : 800,
      node.minWidth ?? 215,
      estimatedHeight
    );
    setOpenSubmenu({ id: node.id, pos, focusFirst });
    if (focusFirst && openChildRef.current && openSubmenu?.id === node.id) {
      const childBtns = getDirectEnabledButtons(openChildRef.current);
      childBtns[0]?.focus({ preventScroll: true });
    }
  };

  const applyOrScheduleSubmenuTransition = (
    targetNodeId: string,
    px: number,
    py: number,
    nextAction: () => void
  ) => {
    // 0ms immediate response when no submenu is open or when moving vertically!
    if (openSubmenu === null || !isMovingTowardOpenChildSubmenu(px, py)) {
      clearHoverTimer();
      nextAction();
      return;
    }
    // Moving diagonally toward the open child submenu: hold briefly (safe triangle)
    if (pendingNodeIdRef.current === targetNodeId && hoverTimerRef.current !== null) {
      return;
    }
    clearHoverTimer();
    pendingNodeIdRef.current = targetNodeId;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      pendingNodeIdRef.current = null;
      nextAction();
    }, SAFE_TRIANGLE_GRACE_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'INPUT') {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseAll();
      } else if (e.key === 'ArrowDown' && containerRef.current) {
        e.preventDefault();
        const btns = getDirectEnabledButtons(containerRef.current);
        btns[0]?.focus({ preventScroll: true });
      }
      return;
    }

    if (e.key === 'Control' && activeTooltip !== null) {
      // WCAG 1.4.13 Dismissible: dismiss hover/focus tooltip without moving focus or closing menu
      e.stopPropagation();
      setActiveTooltip(null);
      return;
    }

    if (e.key === 'Tab') {
      onCloseAll();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (depth > 0 && onCloseThisLevel) {
        onCloseThisLevel(true);
      } else {
        onCloseAll();
      }
      return;
    }

    if (e.key === 'ArrowLeft' && depth > 0 && onCloseThisLevel) {
      e.preventDefault();
      e.stopPropagation();
      onCloseThisLevel(true);
      return;
    }

    if (!supportsNativeFocusGroup && containerRef.current) {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const btns = getDirectEnabledButtons(containerRef.current);
        if (btns.length === 0) return;
        const activeIdx = btns.indexOf(document.activeElement as HTMLButtonElement);
        let nextIdx = 0;
        if (e.key === 'Home') {
          nextIdx = 0;
        } else if (e.key === 'End') {
          nextIdx = btns.length - 1;
        } else if (activeIdx < 0) {
          nextIdx = e.key === 'ArrowUp' ? btns.length - 1 : 0;
        } else {
          nextIdx =
            (activeIdx + (e.key === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length;
        }
        e.preventDefault();
        e.stopPropagation();
        btns[nextIdx]?.focus({ preventScroll: true });
      }
    }
  };

  const activeSubmenuNode = useMemo(
    () =>
      openSubmenu
        ? effectiveItems.find(
            (n): n is Extract<MenuNode, { kind: 'submenu' }> =>
              n.kind === 'submenu' && n.id === openSubmenu.id
          ) ?? null
        : null,
    [effectiveItems, openSubmenu]
  );

  const focusGroupAttr = { focusgroup: 'menu nomemory' } as Record<string, string>;

  return (
    <>
      <div
        ref={setMergedContainerRef}
        {...focusGroupAttr}
        role={supportsNativeFocusGroup ? undefined : 'menu'}
        aria-label={ariaLabel}
        data-menu-depth={depth}
        className={`desktop-menu-popup ${depth > 0 ? 'desktop-submenu-popup' : ''} ${
          stackedBelow ? 'submenu-stacked-below' : ''
        }`.trim()}
        style={{
          ...style,
          zIndex: 5000 + depth * 10,
        }}
        onPointerEnter={(e) => {
          recordPointerSample(e.clientX, e.clientY);
          onPointerInsideChild?.();
        }}
        onPointerMove={(e) => {
          recordPointerSample(e.clientX, e.clientY);
          onPointerInsideChild?.();
        }}
        onPointerDown={() => {
          onPointerInsideChild?.();
        }}
        onKeyDown={handleKeyDown}
      >
        {effectiveItems.map((node, idx) => {
          if (node.kind === 'separator') {
            return <hr key={node.id ?? `sep-${idx}`} className="desktop-menu-sep" />;
          }

          if (node.kind === 'search') {
            return (
              <div key={node.id} className="desktop-menu-search-wrap">
                <input
                  type="text"
                  placeholder={node.placeholder}
                  value={node.value}
                  onChange={(e) => node.onChange(e.target.value)}
                  className="desktop-menu-search-input"
                />
              </div>
            );
          }

          if (node.kind === 'submenu') {
            const isOpen = openSubmenu?.id === node.id;
            const isFlippedLeft = Boolean(isOpen && openSubmenu?.pos.flippedLeft);
            const hasActiveTip =
              showFunctionInfo && !isOpen && activeTooltip?.nodeId === node.id;
            return (
              <button
                key={node.id}
                ref={(el) => {
                  triggerRefs.current[node.id] = el;
                }}
                type="button"
                role={supportsNativeFocusGroup ? undefined : 'menuitem'}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-describedby={hasActiveTip ? tooltipDomId : undefined}
                disabled={node.disabled}
                className={`desktop-menu-row submenu-trigger ${isOpen ? 'submenu-open' : ''}`}
                onFocus={(e) => {
                  if (!isOpen) {
                    showTooltipForRow(node.id, node.label, node.description, true, e.currentTarget);
                  }
                }}
                onBlur={() => scheduleHideTooltip(node.id)}
                onPointerLeave={() => scheduleHideTooltip(node.id)}
                onPointerEnter={(e) => {
                  recordPointerSample(e.clientX, e.clientY);
                  if (!isOpen) {
                    showTooltipForRow(node.id, node.label, node.description, true, e.currentTarget);
                  }
                  if (node.disabled || e.pointerType === 'touch') return;
                  const el = e.currentTarget;
                  focusMenuRowFromPointer(el);
                  if (isOpen) {
                    clearHoverTimer();
                    return;
                  }
                  applyOrScheduleSubmenuTransition(node.id, e.clientX, e.clientY, () => {
                    setActiveTooltip(null);
                    openSubmenuForNode(node, el, false);
                  });
                }}
                onPointerMove={(e) => {
                  recordPointerSample(e.clientX, e.clientY);
                  if (node.disabled || e.pointerType === 'touch') return;
                  const el = e.currentTarget;
                  focusMenuRowFromPointer(el);
                  if (!isOpen) {
                    if (hoverTimerRef.current !== null && pendingNodeIdRef.current === node.id) {
                      if (isPredominantlyVerticalMotion()) {
                        clearHoverTimer();
                        setActiveTooltip(null);
                        openSubmenuForNode(node, el, false);
                      }
                    } else if (!isMovingTowardOpenChildSubmenu(e.clientX, e.clientY)) {
                      clearHoverTimer();
                      setActiveTooltip(null);
                      openSubmenuForNode(node, el, false);
                    }
                  }
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  clearHoverTimer();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (node.disabled) return;
                  clearHoverTimer();
                  setActiveTooltip(null);
                  openSubmenuForNode(node, e.currentTarget, true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' && !node.disabled) {
                    e.preventDefault();
                    e.stopPropagation();
                    clearHoverTimer();
                    setActiveTooltip(null);
                    openSubmenuForNode(node, e.currentTarget, true);
                  }
                }}
              >
                {(() => {
                  const leadingIcon =
                    node.icon !== undefined
                      ? node.icon
                      : isContextMenu
                      ? null
                      : resolveMenuItemIcon(node.id, node.label, true, 15);
                  return leadingIcon != null ? (
                    <span className="desktop-menu-leading-icon" aria-hidden="true">
                      {leadingIcon}
                    </span>
                  ) : null;
                })()}
                <span className="desktop-menu-label">{node.label}</span>
                <span className="desktop-menu-hint submenu-chevron" aria-hidden="true">
                  {isFlippedLeft ? (
                    <ChevronLeft size={16} strokeWidth={2.4} className="submenu-chevron-icon" />
                  ) : (
                    <ChevronRight size={16} strokeWidth={2.4} className="submenu-chevron-icon" />
                  )}
                </span>
              </button>
            );
          }

          if (node.kind === 'checkbox') {
            const hasActiveTip = showFunctionInfo && activeTooltip?.nodeId === node.id;
            return (
              <button
                key={node.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={node.checked}
                aria-describedby={hasActiveTip ? tooltipDomId : undefined}
                aria-keyshortcuts={shortcutLabelToAriaKeyshortcuts(node.shortcut)}
                disabled={node.disabled}
                className="desktop-menu-row checkable-row"
                onFocus={(e) =>
                  showTooltipForRow(node.id, node.label, node.description, false, e.currentTarget)
                }
                onBlur={() => scheduleHideTooltip(node.id)}
                onPointerLeave={() => scheduleHideTooltip(node.id)}
                onPointerEnter={(e) => {
                  recordPointerSample(e.clientX, e.clientY);
                  showTooltipForRow(node.id, node.label, node.description, false, e.currentTarget);
                  if (!node.disabled) {
                    focusMenuRowFromPointer(e.currentTarget);
                  }
                  if (openSubmenu !== null) {
                    applyOrScheduleSubmenuTransition(node.id, e.clientX, e.clientY, () =>
                      setOpenSubmenu(null)
                    );
                  }
                }}
                onPointerMove={(e) => {
                  recordPointerSample(e.clientX, e.clientY);
                  if (!node.disabled) {
                    focusMenuRowFromPointer(e.currentTarget);
                  }
                  if (openSubmenu !== null) {
                    if (hoverTimerRef.current !== null && pendingNodeIdRef.current === node.id) {
                      if (isPredominantlyVerticalMotion()) {
                        clearHoverTimer();
                        setOpenSubmenu(null);
                      }
                    } else if (!isMovingTowardOpenChildSubmenu(e.clientX, e.clientY)) {
                      clearHoverTimer();
                      setOpenSubmenu(null);
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ' && !node.disabled) {
                    // APG menuitemcheckbox: Space toggles state while keeping the menu open
                    e.preventDefault();
                    e.stopPropagation();
                    node.onToggle();
                  }
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  clearHoverTimer();
                  onPointerInsideChild?.();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (node.disabled) return;
                  node.onToggle();
                  onCloseAll();
                }}
              >
                {(() => {
                  const leadingIcon =
                    node.icon !== undefined
                      ? node.icon
                      : isContextMenu
                      ? null
                      : resolveMenuItemIcon(node.id, node.label, false, 14);
                  return leadingIcon != null ? (
                    <span className="desktop-menu-leading-icon" aria-hidden="true">
                      {leadingIcon}
                    </span>
                  ) : null;
                })()}
                <span className="desktop-menu-label">{node.label}</span>
                {node.shortcut && (
                  <span className="desktop-menu-hint" aria-hidden="true">
                    <kbd>{node.shortcut}</kbd>
                  </span>
                )}
              </button>
            );
          }

          const hasActiveTip = showFunctionInfo && activeTooltip?.nodeId === node.id;
          return (
            <button
              key={node.id}
              type="button"
              role={supportsNativeFocusGroup ? undefined : 'menuitem'}
              aria-describedby={hasActiveTip ? tooltipDomId : undefined}
              aria-keyshortcuts={shortcutLabelToAriaKeyshortcuts(node.shortcut)}
              disabled={node.disabled}
              className="desktop-menu-row"
              onFocus={(e) =>
                showTooltipForRow(node.id, node.label, node.description, false, e.currentTarget)
              }
              onBlur={() => scheduleHideTooltip(node.id)}
              onPointerLeave={() => scheduleHideTooltip(node.id)}
              onPointerEnter={(e) => {
                recordPointerSample(e.clientX, e.clientY);
                showTooltipForRow(node.id, node.label, node.description, false, e.currentTarget);
                if (!node.disabled) {
                  focusMenuRowFromPointer(e.currentTarget);
                }
                if (openSubmenu !== null) {
                  applyOrScheduleSubmenuTransition(node.id, e.clientX, e.clientY, () =>
                    setOpenSubmenu(null)
                  );
                }
              }}
              onPointerMove={(e) => {
                recordPointerSample(e.clientX, e.clientY);
                if (!node.disabled) {
                  focusMenuRowFromPointer(e.currentTarget);
                }
                if (openSubmenu !== null) {
                  if (hoverTimerRef.current !== null && pendingNodeIdRef.current === node.id) {
                    if (isPredominantlyVerticalMotion()) {
                      clearHoverTimer();
                      setOpenSubmenu(null);
                    }
                  } else if (!isMovingTowardOpenChildSubmenu(e.clientX, e.clientY)) {
                    clearHoverTimer();
                    setOpenSubmenu(null);
                  }
                }
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                clearHoverTimer();
                onPointerInsideChild?.();
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (node.disabled) return;
                node.onSelect();
                onCloseAll();
              }}
            >
              {(() => {
                const leadingIcon =
                  node.icon !== undefined
                    ? node.icon
                    : isContextMenu
                    ? null
                    : resolveMenuItemIcon(node.id, node.label, false, 15);
                return leadingIcon != null ? (
                  <span className="desktop-menu-leading-icon" aria-hidden="true">
                    {leadingIcon}
                  </span>
                ) : null;
              })()}
              <span className="desktop-menu-label">{node.label}</span>
              {node.shortcut && (
                <span className="desktop-menu-hint" aria-hidden="true">
                  <kbd>{node.shortcut}</kbd>
                </span>
              )}
            </button>
          );
        })}

        {depth === 0 && !isContextMenu && (
          <>
            <hr className="desktop-menu-sep desktop-menu-info-sep" />
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={showFunctionInfo}
              className="desktop-menu-row desktop-menu-info-toggle-row"
              onPointerEnter={(e) => {
                recordPointerSample(e.clientX, e.clientY);
                setActiveTooltip(null);
                focusMenuRowFromPointer(e.currentTarget);
                if (openSubmenu !== null) {
                  clearHoverTimer();
                  setOpenSubmenu(null);
                }
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                clearHoverTimer();
              }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleFunctionInfo();
                }
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFunctionInfo();
              }}
            >
              <Info size={13} className="desktop-menu-info-icon" aria-hidden="true" />
              <span className="desktop-menu-label">Function Info</span>
              <span
                className={`desktop-menu-info-pill ${showFunctionInfo ? 'is-on' : 'is-off'}`}
                aria-hidden="true"
              >
                <span className="desktop-menu-info-pill-knob" />
              </span>
            </button>
          </>
        )}
      </div>

      {showFunctionInfo &&
        activeTooltip &&
        openSubmenu?.id !== activeTooltip.nodeId && (
          <div
            id={tooltipDomId}
            role="tooltip"
            className="desktop-menu-func-tooltip"
            style={{
              top: activeTooltip.top,
              left: activeTooltip.left,
              zIndex: 5150 + depth * 10,
            }}
            onPointerEnter={() => {
              pointerOverTooltipRef.current = true;
              clearTooltipLeaveTimer();
              onPointerInsideChild?.();
            }}
            onPointerLeave={() => {
              pointerOverTooltipRef.current = false;
              setActiveTooltip(null);
            }}
          >
            {activeTooltip.text}
          </div>
        )}

      {/* Render child submenu as a sibling outside `.desktop-menu-popup` so parent `overflow-y: auto` never clips nested submenus */}
      {activeSubmenuNode && openSubmenu && (
        <CascadingMenuLevel
          key={activeSubmenuNode.id}
          items={activeSubmenuNode.children}
          depth={depth + 1}
          stackedBelow={Boolean(openSubmenu.pos.stackedBelow)}
          ariaLabel={activeSubmenuNode.label}
          isContextMenu={isContextMenu}
          autoFocusFirstItem={openSubmenu.focusFirst}
          showFunctionInfo={showFunctionInfo}
          onToggleFunctionInfo={onToggleFunctionInfo}
          childMenuDomRef={openChildRef}
          style={{
            top: openSubmenu.pos.top,
            left: openSubmenu.pos.left,
            right: openSubmenu.pos.right,
            maxWidth: openSubmenu.pos.maxWidth,
            maxHeight: openSubmenu.pos.maxHeight,
            minWidth: openSubmenu.pos.stackedBelow
              ? 0
              : Math.min(
                  activeSubmenuNode.minWidth ?? 215,
                  openSubmenu.pos.maxWidth ?? 360
                ),
          }}
          onPointerInsideChild={() => {
            clearHoverTimer();
            onPointerInsideChild?.();
          }}
          onCloseAll={onCloseAll}
          onCloseThisLevel={(restoreFocus) => {
            const trigId = activeSubmenuNode.id;
            setOpenSubmenu(null);
            if (restoreFocus) {
              triggerRefs.current[trigId]?.focus({ preventScroll: true });
            }
          }}
        />
      )}
    </>
  );
};

function getDirectEnabledButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(':scope > button')).filter(
    (btn) => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true'
  );
}

export const CascadingMenuPopup: React.FC<CascadingMenuPopupProps> = ({
  items,
  position,
  minWidth = 215,
  ariaLabel,
  isContextMenu = false,
  showFunctionInfo: controlledShowInfo,
  onToggleFunctionInfo: controlledToggleInfo,
  onCloseAll,
}) => {
  const [storedShowInfo, setStoredShowInfo] = useState<boolean>(() =>
    readStoredShowMenuFunctionInfo()
  );

  useEffect(() => {
    const syncFromEvent = () => {
      setStoredShowInfo(readStoredShowMenuFunctionInfo());
    };
    window.addEventListener(MENU_FUNCTION_INFO_EVENT, syncFromEvent);
    window.addEventListener('storage', syncFromEvent);
    return () => {
      window.removeEventListener(MENU_FUNCTION_INFO_EVENT, syncFromEvent);
      window.removeEventListener('storage', syncFromEvent);
    };
  }, []);

  const effectiveShowInfo = controlledShowInfo ?? storedShowInfo;
  const handleToggleInfo = () => {
    if (controlledToggleInfo) {
      controlledToggleInfo();
    } else {
      const next = !effectiveShowInfo;
      setStoredShowInfo(next);
      writeStoredShowMenuFunctionInfo(next);
    }
  };

  const tree = (
    <CascadingMenuLevel
      items={items}
      depth={0}
      ariaLabel={ariaLabel}
      isContextMenu={isContextMenu}
      showFunctionInfo={effectiveShowInfo}
      onToggleFunctionInfo={handleToggleInfo}
      style={{
        top: position.top,
        left: position.left,
        maxHeight: position.maxHeight,
        minWidth,
      }}
      onCloseAll={onCloseAll}
    />
  );

  // Portal into top-level `.mbc-workbench` (preserving `.mbc-dark-mode` theme tokens) so no ancestor
  // `overflow`, `content-visibility`, `container-type`, or `backdrop-filter` clips fixed submenus.
  if (typeof document !== 'undefined' && document.body) {
    const portalTarget = document.querySelector('.mbc-workbench') ?? document.body;
    return createPortal(tree, portalTarget);
  }

  return tree;
};
