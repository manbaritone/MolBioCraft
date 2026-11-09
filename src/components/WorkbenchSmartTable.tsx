// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  exportDelimitedTableViaRust,
  parseSortableNumericValue,
  sortColumnsAsciiAlphabetical,
} from '../core/workbenchBatchOperations';
import { SequenceDocument, SequenceDocumentIconKind } from '../types/bio';
import { FigureExportButton } from './FigureExportButton';
import { MolBioDocTypeIcon } from './MolBioIcons';

export type TableFilterOperator =
  | 'contains'
  | 'equals'
  | 'not-contains'
  | 'starts-with'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte';

export interface TableFilterRule {
  id: string;
  colId: string; // '__all__' or specific column id
  operator: TableFilterOperator;
  value: string;
}

export interface SmartTableColumnOption {
  id: string;
  label: string;
  alwaysVisible?: boolean;
}

export interface PersistedTableColumnState {
  visibleIds: string[];
  orderedIds: string[];
  lockColumnOrder: boolean;
}

const STORAGE_PREFIX = 'mbc_gp_table_cols_v1:';

export function loadPersistedTableColumnState(
  tableId: string
): PersistedTableColumnState | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${tableId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTableColumnState>;
    if (!Array.isArray(parsed.visibleIds) || !Array.isArray(parsed.orderedIds)) {
      return null;
    }
    return {
      visibleIds: parsed.visibleIds.map(String),
      orderedIds: parsed.orderedIds.map(String),
      lockColumnOrder: Boolean(parsed.lockColumnOrder),
    };
  } catch {
    return null;
  }
}

export function savePersistedTableColumnState(
  tableId: string,
  state: PersistedTableColumnState
): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${tableId}`, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function evaluateSingleFilterRule(
  cellValueRaw: string,
  operator: TableFilterOperator,
  queryRaw: string
): boolean {
  const query = queryRaw.trim();
  if (!query) return true;
  const cell = cellValueRaw.trim();
  const cellLower = cell.toLowerCase();
  const queryLower = query.toLowerCase();

  switch (operator) {
    case 'contains':
      return cellLower.includes(queryLower);
    case 'equals': {
      const cn = parseSortableNumericValue(cell);
      const qn = parseSortableNumericValue(query);
      if (cn !== null && qn !== null) return Math.abs(cn - qn) < 1e-9;
      return cellLower === queryLower;
    }
    case 'not-contains':
      return !cellLower.includes(queryLower);
    case 'starts-with':
      return cellLower.startsWith(queryLower);
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const cn = parseSortableNumericValue(cell);
      const qn = parseSortableNumericValue(query);
      if (cn === null || qn === null) return false;
      if (operator === 'gt') return cn > qn;
      if (operator === 'lt') return cn < qn;
      if (operator === 'gte') return cn >= qn;
      return cn <= qn;
    }
  }
}

export function evaluateTableRowFilters(
  getCellText: (colId: string) => string,
  searchableColIds: readonly string[],
  quickFilter: string,
  rules: readonly TableFilterRule[],
  matchMode: 'all' | 'any'
): boolean {
  const q = quickFilter.trim().toLowerCase();
  if (q) {
    const matchesQuick = searchableColIds.some((cid) =>
      getCellText(cid).toLowerCase().includes(q)
    );
    if (!matchesQuick) return false;
  }

  const activeRules = rules.filter((r) => r.value.trim().length > 0);
  if (activeRules.length === 0) return true;

  const evalRule = (rule: TableFilterRule): boolean => {
    if (rule.colId === '__all__') {
      if (rule.operator === 'not-contains') {
        return searchableColIds.every((cid) =>
          evaluateSingleFilterRule(getCellText(cid), 'not-contains', rule.value)
        );
      }
      return searchableColIds.some((cid) =>
        evaluateSingleFilterRule(getCellText(cid), rule.operator, rule.value)
      );
    }
    return evaluateSingleFilterRule(getCellText(rule.colId), rule.operator, rule.value);
  };

  return matchMode === 'all'
    ? activeRules.every(evalRule)
    : activeRules.some(evalRule);
}

/**
 * Distinct MolBioCraft Precision Duotone biological document-type icons:
 * resolves 14 biological subtypes (circular plasmid vs circular genome, linear dsDNA
 * vs ssRNA, forward vs reverse primer, nucleotide vs protein MSA, contig vs paired
 * NGS reads vs Sanger chromatogram, protein sequence vs 3D PDB structure, and tree).
 */
export const SequenceDocKindIcon: React.FC<{
  kind: SequenceDocumentIconKind;
  doc?: SequenceDocument;
  size?: number;
  title?: string;
}> = ({ kind, doc, size = 16, title }) => (
  <MolBioDocTypeIcon kind={kind} doc={doc} size={size} title={title} />
);

const FilterFunnelSvg: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mbc-duotone-icon">
    <path
      d="M2 3H14L9.5 8.3V12.6L6.5 13.8V8.3L2 3Z"
      fill="currentColor"
      fillOpacity="0.14"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const ColumnsGridSvg: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mbc-duotone-icon">
    <rect
      x="2"
      y="2.5"
      width="12"
      height="11"
      rx="1.6"
      fill="currentColor"
      fillOpacity="0.12"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path d="M8 2.8V13.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2.3 5.8H13.7" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export interface WorkbenchColumnsPopoverProps {
  anchorRect: DOMRect | null;
  columns: readonly SmartTableColumnOption[];
  visibleColIds: readonly string[];
  lockColumnOrder: boolean;
  statusMessage?: string | null;
  onToggleColumn: (colId: string) => void;
  onToggleLockColumnOrder: () => void;
  onLoadColumnState: () => void;
  onSaveColumnState: () => void;
  onClose: () => void;
}

export const WorkbenchColumnsPopover: React.FC<WorkbenchColumnsPopoverProps> = ({
  anchorRect,
  columns,
  visibleColIds,
  lockColumnOrder,
  statusMessage,
  onToggleColumn,
  onToggleLockColumnOrder,
  onLoadColumnState,
  onSaveColumnState,
  onClose,
}) => {
  const popRef = useRef<HTMLDivElement | null>(null);

  const sortedCols = useMemo(
    () => sortColumnsAsciiAlphabetical(columns),
    [columns]
  );
  const visibleSet = useMemo(() => new Set(visibleColIds), [visibleColIds]);
  const needsScroll = sortedCols.length > 15;

  useEffect(() => {
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (popRef.current?.contains(target)) return;
      if (target?.closest('.mbc-columns-trigger-btn')) return;
      onClose();
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  const posStyle = useMemo<React.CSSProperties>(() => {
    if (!anchorRect || typeof window === 'undefined') {
      return { top: 42, right: 12 };
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estWidth = 290;
    const estHeight = Math.min(470, sortedCols.length * 24 + 106);
    const rightOffset = Math.max(8, vw - anchorRect.right);
    const clampedRight = Math.min(rightOffset, Math.max(8, vw - estWidth - 8));
    let top = anchorRect.bottom + 4;
    if (top + estHeight > vh - 8 && anchorRect.top > estHeight + 12) {
      top = Math.max(8, anchorRect.top - estHeight - 4);
    }
    return {
      position: 'fixed',
      top,
      right: clampedRight,
    };
  }, [anchorRect, sortedCols.length]);

  return (
    <div
      ref={popRef}
      className="mbc-columns-popover"
      role="dialog"
      aria-label="Choose Visible Table Columns"
      style={posStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={`mbc-columns-checklist ${needsScroll ? 'scrollable' : ''}`}
        role="group"
        aria-label="Available Columns"
      >
        {sortedCols.map((col) => {
          const isLocked = Boolean(col.alwaysVisible);
          const isChecked = isLocked || visibleSet.has(col.id);
          return (
            <label
              key={col.id}
              className={`mbc-columns-check-item ${isLocked ? 'locked-primary' : ''}`}
              title={
                isLocked
                  ? `${col.label} is the primary identifier column and is always visible`
                  : `Toggle ${col.label} column`
              }
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={isLocked}
                onChange={() => {
                  if (!isLocked) onToggleColumn(col.id);
                }}
              />
              <span className="mbc-columns-check-label">{col.label}</span>
            </label>
          );
        })}
      </div>

      <div className="mbc-columns-footer">
        <label className="mbc-columns-check-item footer-lock-item">
          <input
            type="checkbox"
            checked={lockColumnOrder}
            onChange={onToggleLockColumnOrder}
          />
          <span className="mbc-columns-check-label">Lock Column Order</span>
        </label>
        <button
          type="button"
          className="mbc-columns-action-btn"
          onClick={onLoadColumnState}
        >
          Load Column State...
        </button>
        <button
          type="button"
          className="mbc-columns-action-btn"
          onClick={onSaveColumnState}
        >
          Save Current State...
        </button>
        {statusMessage && (
          <div className="mbc-columns-status-note" role="status">
            {statusMessage}
          </div>
        )}
      </div>
    </div>
  );
};

export interface WorkbenchFilterPanelProps {
  columns: readonly SmartTableColumnOption[];
  quickFilter: string;
  onQuickFilterChange: (val: string) => void;
  rules: readonly TableFilterRule[];
  onRulesChange: (next: TableFilterRule[]) => void;
  matchMode: 'all' | 'any';
  onMatchModeChange: (mode: 'all' | 'any') => void;
  placeholder?: string;
  /** DOM id of the quick-filter input (targets for "Filter Folder" commands). */
  inputId?: string;
  /** Extra rule fields beyond the columns (e.g. residues, annotations). */
  extraFields?: readonly SmartTableColumnOption[];
  /** Whole-project scope toggle (omit to hide). */
  wholeProject?: boolean;
  onWholeProjectChange?: (on: boolean) => void;
  /** Saved searches (omit onSaveSearch to hide). */
  savedSearches?: readonly { id: string; name: string }[];
  onSaveSearch?: (name: string) => void;
  onLoadSearch?: (id: string) => void;
  onDeleteSearch?: (id: string) => void;
}

export const WorkbenchFilterPanel: React.FC<WorkbenchFilterPanelProps> = ({
  columns,
  quickFilter,
  onQuickFilterChange,
  rules,
  onRulesChange,
  matchMode,
  onMatchModeChange,
  placeholder = 'Filter across visible columns...',
  inputId,
  extraFields,
  wholeProject,
  onWholeProjectChange,
  savedSearches,
  onSaveSearch,
  onLoadSearch,
  onDeleteSearch,
}) => {
  const defaultColId = columns[0]?.id ?? '__all__';
  const [saveName, setSaveName] = React.useState<string | null>(null);
  const [chosenSearch, setChosenSearch] = React.useState('');

  const handleAddRule = () => {
    onRulesChange([
      ...rules,
      {
        id: `rule-${Date.now().toString(36)}-${rules.length}`,
        colId: defaultColId,
        operator: 'contains',
        value: '',
      },
    ]);
  };

  const handleUpdateRule = (id: string, patch: Partial<TableFilterRule>) => {
    onRulesChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleRemoveRule = (id: string) => {
    onRulesChange(rules.filter((r) => r.id !== id));
  };

  const hasAnyFilter =
    quickFilter.trim().length > 0 || rules.some((r) => r.value.trim().length > 0);

  return (
    <div className="mbc-inline-filter-panel" role="search" aria-label="Table Filter">
      <div className="mbc-filter-primary-row">
        <input
          id={inputId}
          type="text"
          className="mbc-filter-quick-input"
          value={quickFilter}
          onChange={(e) => onQuickFilterChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Quick filter across table columns"
        />
        <button
          type="button"
          className="mbc-filter-small-btn"
          onClick={handleAddRule}
          title="Add a column-specific filter condition"
        >
          + Column Rule
        </button>
        {rules.length > 1 && (
          <select
            className="mbc-filter-select match-mode-select"
            value={matchMode}
            onChange={(e) => onMatchModeChange(e.target.value as 'all' | 'any')}
            aria-label="Filter rule match mode"
          >
            <option value="all">Match All</option>
            <option value="any">Match Any</option>
          </select>
        )}
        {onWholeProjectChange && (
          <label className="mbc-filter-scope" title="Search every document in the project instead of the selected folder">
            <input type="checkbox" checked={Boolean(wholeProject)} onChange={(e) => onWholeProjectChange(e.target.checked)} />
            Whole project
          </label>
        )}
        {onSaveSearch && (
          saveName === null ? (
            <button type="button" className="mbc-filter-small-btn" disabled={!hasAnyFilter} onClick={() => setSaveName('')}
              title="Save this search (scope, quick filter and rules) to run again later">
              Save Search…
            </button>
          ) : (
            <span className="mbc-filter-save-row">
              <input autoFocus type="text" className="mbc-filter-rule-input" placeholder="Search name" value={saveName} aria-label="Saved search name"
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && saveName.trim()) { onSaveSearch(saveName.trim()); setSaveName(null); }
                  if (e.key === 'Escape') setSaveName(null);
                }} />
              <button type="button" className="mbc-filter-small-btn" disabled={!saveName.trim()} onClick={() => { onSaveSearch(saveName.trim()); setSaveName(null); }}>Save</button>
              <button type="button" className="mbc-filter-small-btn" onClick={() => setSaveName(null)}>Cancel</button>
            </span>
          )
        )}
        {onLoadSearch && savedSearches && savedSearches.length > 0 && (
          <span className="mbc-filter-save-row">
            <select className="mbc-filter-select" aria-label="Saved searches" value={chosenSearch}
              onChange={(e) => { setChosenSearch(e.target.value); if (e.target.value) onLoadSearch(e.target.value); }}>
              <option value="">Saved searches…</option>
              {savedSearches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            {chosenSearch && onDeleteSearch && (
              <button type="button" className="mbc-filter-small-btn" title="Delete this saved search"
                onClick={() => { onDeleteSearch(chosenSearch); setChosenSearch(''); }}>Delete</button>
            )}
          </span>
        )}
        {hasAnyFilter && (
          <button
            type="button"
            className="mbc-filter-small-btn clear-btn"
            onClick={() => {
              onQuickFilterChange('');
              onRulesChange([]);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {rules.length > 0 && (
        <div className="mbc-filter-rules-stack">
          {rules.map((rule) => (
            <div key={rule.id} className="mbc-filter-rule-row">
              <select
                className="mbc-filter-select"
                value={rule.colId}
                onChange={(e) => handleUpdateRule(rule.id, { colId: e.target.value })}
                aria-label="Filter column"
              >
                <option value="__all__">All Columns</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
                {extraFields && extraFields.length > 0 && (
                  <optgroup label="Search fields">
                    {extraFields.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </optgroup>
                )}
              </select>

              <select
                className="mbc-filter-select op-select"
                value={rule.operator}
                onChange={(e) =>
                  handleUpdateRule(rule.id, {
                    operator: e.target.value as TableFilterOperator,
                  })
                }
                aria-label="Filter operator"
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
                <option value="not-contains">does not contain</option>
                <option value="starts-with">starts with</option>
                <option value="gt">&gt;</option>
                <option value="gte">&ge;</option>
                <option value="lt">&lt;</option>
                <option value="lte">&le;</option>
              </select>

              <input
                type="text"
                className="mbc-filter-rule-input"
                value={rule.value}
                onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                placeholder="Value..."
                aria-label="Filter condition value"
              />

              <button
                type="button"
                className="mbc-filter-rule-remove"
                onClick={() => handleRemoveRule(rule.id)}
                aria-label="Remove filter rule"
                title="Remove rule"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export interface WorkbenchTableControlsBarProps {
  filterOpen: boolean;
  activeFilterCount: number;
  onToggleFilter: () => void;
  summaryLabel: string;
  columnsOpen: boolean;
  onToggleColumns: (anchorRect: DOMRect) => void;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  compact?: boolean;
}

export const WorkbenchTableControlsBar: React.FC<WorkbenchTableControlsBarProps> = ({
  filterOpen,
  activeFilterCount,
  onToggleFilter,
  summaryLabel,
  columnsOpen,
  onToggleColumns,
  leftSlot,
  rightSlot,
  compact = false,
}) => {
  return (
    <div className={`mbc-table-subtoolbar ${compact ? 'compact' : ''}`}>
      <div className="mbc-table-subtoolbar-left">
        <button
          type="button"
          className={`mbc-subtoolbar-btn mbc-filter-trigger-btn ${
            filterOpen || activeFilterCount > 0 ? 'active' : ''
          }`}
          onClick={onToggleFilter}
          aria-expanded={filterOpen}
          title="Filter rows by keyword or column rules"
        >
          <FilterFunnelSvg />
          <span>Filter</span>
          {activeFilterCount > 0 && (
            <span className="mbc-filter-active-badge">{activeFilterCount}</span>
          )}
        </button>
        {leftSlot}
      </div>

      <div className="mbc-table-subtoolbar-right">
        <span className="mbc-selection-summary-text">{summaryLabel}</span>
        <span className="mbc-subtoolbar-vdivider" aria-hidden="true" />
        <button
          type="button"
          className={`mbc-subtoolbar-btn mbc-columns-trigger-btn ${
            columnsOpen ? 'active' : ''
          }`}
          onClick={(e) => onToggleColumns(e.currentTarget.getBoundingClientRect())}
          aria-expanded={columnsOpen}
          title="Show, hide, lock, or save table columns"
        >
          <ColumnsGridSvg />
          <span>Columns</span>
        </button>
        {rightSlot}
      </div>
    </div>
  );
};

// ============================================================================
// Universal <WorkbenchSmartTable> Wrapper for All Workbench Tables
// ============================================================================

function flattenReactChildren(children: React.ReactNode): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      const fragProps = child.props as { children?: React.ReactNode };
      out.push(...flattenReactChildren(fragProps.children));
    } else {
      out.push(child);
    }
  });
  return out;
}

export function extractReactNodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    return node.map(extractReactNodeText).join(' ').replace(/\s+/g, ' ').trim();
  }
  if (React.isValidElement(node)) {
    const props = node.props as {
      children?: React.ReactNode;
      value?: string | number;
      'aria-label'?: string;
      title?: string;
    };
    if (node.type === 'input' && props.value !== undefined) {
      return String(props.value);
    }
    const childText = extractReactNodeText(props.children);
    if (childText) return childText;
    if (props['aria-label']) return props['aria-label'];
    if (props.title) return props.title;
  }
  return '';
}

function stripSortArrowsFromLabel(raw: string): string {
  return raw.replace(/[↑↓▲▼▴▾]+$/g, '').trim();
}

export interface WorkbenchSmartTableProps
  extends React.TableHTMLAttributes<HTMLTableElement> {
  tableId: string;
  tableLabel?: string;
  selectionSummary?: string;
  defaultHiddenColumns?: string[];
  lockedColumnIndex?: number;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  regionMaxHeight?: number | string;
  compactToolbar?: boolean;
}

interface ExtractedColMeta {
  id: string;
  origIndex: number;
  label: string;
  alwaysVisible: boolean;
  thElement: React.ReactElement;
}

export const WorkbenchSmartTable: React.FC<WorkbenchSmartTableProps> = ({
  tableId,
  tableLabel,
  selectionSummary,
  defaultHiddenColumns,
  lockedColumnIndex,
  wrapperClassName,
  wrapperStyle,
  regionMaxHeight,
  compactToolbar = true,
  className,
  style,
  children,
  ...restTableProps
}) => {
  const topSections = useMemo(() => flattenReactChildren(children), [children]);
  const theadEl = topSections.find((el) => el.type === 'thead');
  const tbodyEl = topSections.find((el) => el.type === 'tbody');
  const tfootEl = topSections.find((el) => el.type === 'tfoot');

  const headerRows = useMemo(
    () =>
      theadEl
        ? flattenReactChildren((theadEl.props as { children?: React.ReactNode }).children)
        : [],
    [theadEl]
  );
  const primaryHeaderTr = headerRows[0];

  const extractedCols = useMemo<ExtractedColMeta[]>(() => {
    if (!primaryHeaderTr) return [];
    const ths = flattenReactChildren(
      (primaryHeaderTr.props as { children?: React.ReactNode }).children
    );
    let lockedAssigned = false;
    return ths.map((th, idx) => {
      const thProps = th.props as {
        children?: React.ReactNode;
        'aria-label'?: string;
        title?: string;
      };
      const rawText = stripSortArrowsFromLabel(extractReactNodeText(thProps.children));
      const fallbackLabel =
        thProps['aria-label'] || thProps.title || (idx === 0 ? 'Select' : `Column ${idx + 1}`);
      const label = rawText || fallbackLabel;
      const isPrimaryLocked =
        lockedColumnIndex !== undefined
          ? idx === lockedColumnIndex
          : !lockedAssigned && rawText.length > 0;
      if (isPrimaryLocked) lockedAssigned = true;
      return {
        id: `c_${idx}_${label.replace(/[^a-zA-Z0-9#%_-]/g, '_')}`,
        origIndex: idx,
        label,
        alwaysVisible: isPrimaryLocked,
        thElement: th,
      };
    });
  }, [primaryHeaderTr, lockedColumnIndex]);

  // Visibility & Order state (hidden-based by default so dynamic columns like distance matrices auto-appear)
  const [hiddenColIds, setHiddenColIds] = useState<string[]>(() => {
    const saved = loadPersistedTableColumnState(tableId);
    if (saved) {
      const visSet = new Set(saved.visibleIds);
      return extractedCols
        .filter((c) => !c.alwaysVisible && !visSet.has(c.id))
        .map((c) => c.id);
    }
    if (defaultHiddenColumns && defaultHiddenColumns.length > 0) {
      const hideLabels = new Set(defaultHiddenColumns);
      return extractedCols
        .filter((c) => !c.alwaysVisible && (hideLabels.has(c.label) || hideLabels.has(c.id)))
        .map((c) => c.id);
    }
    return [];
  });

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = loadPersistedTableColumnState(tableId);
    return saved?.orderedIds ?? [];
  });

  const [lockColumnOrder, setLockColumnOrder] = useState<boolean>(() => {
    const saved = loadPersistedTableColumnState(tableId);
    return saved?.lockColumnOrder ?? false;
  });

  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  const [quickFilter, setQuickFilter] = useState<string>('');
  const [filterRules, setFilterRules] = useState<TableFilterRule[]>([]);
  const [filterMatchMode, setFilterMatchMode] = useState<'all' | 'any'>('all');

  const [columnsOpen, setColumnsOpen] = useState<boolean>(false);
  const [columnsAnchorRect, setColumnsAnchorRect] = useState<DOMRect | null>(null);
  const [colStatusMsg, setColStatusMsg] = useState<string | null>(null);

  const [sortColId, setSortColId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [dragColId, setDragColId] = useState<string | null>(null);

  const hiddenSet = useMemo(() => new Set(hiddenColIds), [hiddenColIds]);

  const orderedAllCols = useMemo(() => {
    if (columnOrder.length === 0) return extractedCols;
    const orderIdx = new Map(columnOrder.map((id, i) => [id, i]));
    return [...extractedCols].sort((a, b) => {
      const ia = orderIdx.has(a.id) ? orderIdx.get(a.id)! : 1000 + a.origIndex;
      const ib = orderIdx.has(b.id) ? orderIdx.get(b.id)! : 1000 + b.origIndex;
      return ia - ib;
    });
  }, [extractedCols, columnOrder]);

  const orderedVisibleCols = useMemo(
    () => orderedAllCols.filter((c) => c.alwaysVisible || !hiddenSet.has(c.id)),
    [orderedAllCols, hiddenSet]
  );

  const visibleColIds = useMemo(
    () => orderedVisibleCols.map((c) => c.id),
    [orderedVisibleCols]
  );

  const columnOptions = useMemo<SmartTableColumnOption[]>(
    () =>
      extractedCols.map((c) => ({
        id: c.id,
        label: c.label,
        alwaysVisible: c.alwaysVisible,
      })),
    [extractedCols]
  );

  // Extract body rows & cell text map
  const rawBodyRows = useMemo(
    () =>
      tbodyEl
        ? flattenReactChildren((tbodyEl.props as { children?: React.ReactNode }).children)
        : [],
    [tbodyEl]
  );

  const parsedRows = useMemo(() => {
    return rawBodyRows.map((tr, rowIndex) => {
      const cells = flattenReactChildren(
        (tr.props as { children?: React.ReactNode }).children
      );
      const firstCellColSpan =
        cells.length === 1
          ? Number((cells[0].props as { colSpan?: number }).colSpan ?? 1)
          : 1;
      const isFullSpanRow = cells.length === 1 && firstCellColSpan > 1;
      const textByColId: Record<string, string> = {};
      extractedCols.forEach((col) => {
        const cell = cells[col.origIndex];
        textByColId[col.id] = cell ? extractReactNodeText(cell) : '';
      });
      return {
        tr,
        rowIndex,
        cells,
        isFullSpanRow,
        textByColId,
      };
    });
  }, [rawBodyRows, extractedCols]);

  const dataRowCount = useMemo(
    () => parsedRows.filter((r) => !r.isFullSpanRow).length,
    [parsedRows]
  );

  const activeFilterCount =
    (quickFilter.trim().length > 0 ? 1 : 0) +
    filterRules.filter((r) => r.value.trim().length > 0).length;

  const filteredAndSortedRows = useMemo(() => {
    const searchableIds = orderedVisibleCols.map((c) => c.id);
    const filtered = parsedRows.filter((row) => {
      if (row.isFullSpanRow) return activeFilterCount === 0;
      return evaluateTableRowFilters(
        (cid) => row.textByColId[cid] ?? '',
        searchableIds,
        quickFilter,
        filterRules,
        filterMatchMode
      );
    });

    if (!sortColId) return filtered;
    const mult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (a.isFullSpanRow || b.isFullSpanRow) return 0;
      const ta = a.textByColId[sortColId] ?? '';
      const tb = b.textByColId[sortColId] ?? '';
      const na = parseSortableNumericValue(ta);
      const nb = parseSortableNumericValue(tb);
      let cmp = 0;
      if (na !== null && nb !== null) {
        cmp = na - nb;
      } else {
        cmp = ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (cmp === 0) return a.rowIndex - b.rowIndex;
      return cmp * mult;
    });
  }, [
    parsedRows,
    orderedVisibleCols,
    activeFilterCount,
    quickFilter,
    filterRules,
    filterMatchMode,
    sortColId,
    sortDir,
  ]);

  const visibleDataRowCount = useMemo(
    () => filteredAndSortedRows.filter((r) => !r.isFullSpanRow).length,
    [filteredAndSortedRows]
  );

  const computedSummaryLabel = useMemo(() => {
    if (selectionSummary) return selectionSummary;
    if (activeFilterCount > 0) {
      return `${visibleDataRowCount} of ${dataRowCount} rows`;
    }
    return `${dataRowCount} ${dataRowCount === 1 ? 'row' : 'rows'}`;
  }, [selectionSummary, activeFilterCount, visibleDataRowCount, dataRowCount]);

  const handleToggleColumn = (colId: string) => {
    const col = extractedCols.find((c) => c.id === colId);
    if (!col || col.alwaysVisible) return;
    setHiddenColIds((prev) =>
      prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId]
    );
  };

  const handleSaveColumnState = () => {
    const ok = savePersistedTableColumnState(tableId, {
      visibleIds: visibleColIds,
      orderedIds: orderedAllCols.map((c) => c.id),
      lockColumnOrder,
    });
    setColStatusMsg(ok ? 'Saved current column state ✓' : 'Unable to save column state');
    setTimeout(() => setColStatusMsg(null), 2200);
  };

  const handleLoadColumnState = () => {
    const saved = loadPersistedTableColumnState(tableId);
    if (saved) {
      const visSet = new Set(saved.visibleIds);
      setHiddenColIds(
        extractedCols
          .filter((c) => !c.alwaysVisible && !visSet.has(c.id))
          .map((c) => c.id)
      );
      setColumnOrder(saved.orderedIds);
      setLockColumnOrder(saved.lockColumnOrder);
      setColStatusMsg('Loaded saved column state ✓');
    } else {
      setHiddenColIds([]);
      setColumnOrder([]);
      setLockColumnOrder(false);
      setColStatusMsg('Reset to default columns ✓');
    }
    setTimeout(() => setColStatusMsg(null), 2200);
  };

  const handleDropOnColumn = (targetColId: string) => {
    if (lockColumnOrder || !dragColId || dragColId === targetColId) {
      setDragColId(null);
      return;
    }
    const currentOrder = orderedAllCols.map((c) => c.id);
    const fromIdx = currentOrder.indexOf(dragColId);
    const toIdx = currentOrder.indexOf(targetColId);
    if (fromIdx >= 0 && toIdx >= 0) {
      const next = [...currentOrder];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      setColumnOrder(next);
    }
    setDragColId(null);
  };

  // Fallback if malformed table without primary header row
  if (!primaryHeaderTr || extractedCols.length === 0) {
    return (
      <table className={className} style={style} {...restTableProps}>
        {children}
      </table>
    );
  }

  return (
    <div
      className={`mbc-smart-table-shell ${wrapperClassName ?? ''}`}
      style={wrapperStyle}
    >
      <WorkbenchTableControlsBar
        compact={compactToolbar}
        filterOpen={filterOpen}
        activeFilterCount={activeFilterCount}
        onToggleFilter={() => setFilterOpen((v) => !v)}
        summaryLabel={computedSummaryLabel}
        columnsOpen={columnsOpen}
        onToggleColumns={(rect) => {
          setColumnsAnchorRect(rect);
          setColumnsOpen((v) => !v);
        }}
        rightSlot={
          <FigureExportButton
            compact
            baseName={tableLabel ?? tableId}
            title={tableLabel ?? tableId}
            delimitedWriter={exportDelimitedTableViaRust}
            table={() => ({
              headers: orderedVisibleCols.map((c) => c.label),
              rows: filteredAndSortedRows
                .filter((r) => !r.isFullSpanRow)
                .map((r) => orderedVisibleCols.map((c) => r.textByColId[c.id] ?? '')),
              caption: tableLabel ?? tableId,
            })}
          />
        }
      />

      {filterOpen && (
        <WorkbenchFilterPanel
          columns={columnOptions}
          quickFilter={quickFilter}
          onQuickFilterChange={setQuickFilter}
          rules={filterRules}
          onRulesChange={setFilterRules}
          matchMode={filterMatchMode}
          onMatchModeChange={setFilterMatchMode}
        />
      )}

      {columnsOpen && (
        <WorkbenchColumnsPopover
          anchorRect={columnsAnchorRect}
          columns={columnOptions}
          visibleColIds={visibleColIds}
          lockColumnOrder={lockColumnOrder}
          statusMessage={colStatusMsg}
          onToggleColumn={handleToggleColumn}
          onToggleLockColumnOrder={() => setLockColumnOrder((v) => !v)}
          onLoadColumnState={handleLoadColumnState}
          onSaveColumnState={handleSaveColumnState}
          onClose={() => setColumnsOpen(false)}
        />
      )}

      <div
        className="mbc-smart-table-region"
        tabIndex={0}
        role="region"
        aria-label={tableLabel ?? `Data Table (${tableId})`}
        style={regionMaxHeight ? { maxHeight: regionMaxHeight } : undefined}
      >
        <table
          className={`mbc-smart-data-table ${className ?? ''}`}
          style={style}
          {...restTableProps}
        >
          <thead>
            {React.cloneElement(
              primaryHeaderTr,
              primaryHeaderTr.props as Record<string, unknown>,
              orderedVisibleCols.map((col) => {
                const origThProps = col.thElement.props as React.ThHTMLAttributes<HTMLTableCellElement>;
                const hasCustomSortHandler = typeof origThProps.onClick === 'function';
                const isSorted = sortColId === col.id;
                return React.cloneElement(
                  col.thElement,
                  {
                    key: col.id,
                    scope: origThProps.scope ?? 'col',
                    draggable: !lockColumnOrder,
                    'aria-sort': hasCustomSortHandler
                      ? origThProps['aria-sort']
                      : isSorted
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none',
                    className: `${origThProps.className ?? ''} mbc-smart-th ${
                      !lockColumnOrder ? 'mbc-draggable-th' : ''
                    } ${dragColId === col.id ? 'mbc-dragging-th' : ''}`.trim(),
                    onDragStart: () => {
                      if (!lockColumnOrder) setDragColId(col.id);
                    },
                    onDragOver: (e: React.DragEvent<HTMLTableCellElement>) => {
                      if (!lockColumnOrder && dragColId && dragColId !== col.id) {
                        e.preventDefault();
                      }
                    },
                    onDrop: (e: React.DragEvent<HTMLTableCellElement>) => {
                      e.preventDefault();
                      handleDropOnColumn(col.id);
                    },
                    onDragEnd: () => setDragColId(null),
                    onClick: (e: React.MouseEvent<HTMLTableCellElement>) => {
                      if ((e.target as HTMLElement | null)?.closest('input, button, select')) {
                        return;
                      }
                      if (hasCustomSortHandler) {
                        origThProps.onClick!(e);
                        return;
                      }
                      if (sortColId === col.id) {
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                      } else {
                        setSortColId(col.id);
                        setSortDir('asc');
                      }
                    },
                    title:
                      origThProps.title ??
                      `Click to sort by ${col.label}${
                        lockColumnOrder ? '' : ' • Drag to reorder'
                      }`,
                  } as React.ThHTMLAttributes<HTMLTableCellElement>,
                  hasCustomSortHandler ? (
                    origThProps.children
                  ) : (
                    <span className="mbc-smart-th-inner">
                      <span>{origThProps.children}</span>
                      {isSorted && (
                        <span className="mbc-smart-sort-caret" aria-hidden="true">
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                            {sortDir === 'asc' ? (
                              <path d="M5 2L8.5 7.5H1.5L5 2Z" fill="currentColor" />
                            ) : (
                              <path d="M5 8L1.5 2.5H8.5L5 8Z" fill="currentColor" />
                            )}
                          </svg>
                        </span>
                      )}
                    </span>
                  )
                );
              })
            )}
          </thead>

          <tbody>
            {filteredAndSortedRows.length === 0 && activeFilterCount > 0 ? (
              <tr>
                <td
                  colSpan={Math.max(1, orderedVisibleCols.length)}
                  className="mbc-smart-empty-filter-cell"
                >
                  No rows match the active filter.{' '}
                  <button
                    type="button"
                    className="mbc-filter-inline-reset"
                    onClick={() => {
                      setQuickFilter('');
                      setFilterRules([]);
                    }}
                  >
                    Clear Filter
                  </button>
                </td>
              </tr>
            ) : (
              filteredAndSortedRows.map((row) => {
                if (row.isFullSpanRow) {
                  const onlyCell = row.cells[0];
                  return React.cloneElement(
                    row.tr,
                    { key: row.tr.key ?? `full-${row.rowIndex}` },
                    React.cloneElement(onlyCell, {
                      colSpan: Math.max(1, orderedVisibleCols.length),
                    } as React.TdHTMLAttributes<HTMLTableCellElement>)
                  );
                }
                return React.cloneElement(
                  row.tr,
                  { key: row.tr.key ?? `r-${row.rowIndex}` },
                  orderedVisibleCols.map((col) => {
                    const cell = row.cells[col.origIndex];
                    if (!cell) {
                      return <td key={col.id}>-</td>;
                    }
                    return React.cloneElement(cell, {
                      key: col.id,
                    });
                  })
                );
              })
            )}
          </tbody>

          {tfootEl}
        </table>
      </div>
    </div>
  );
};
