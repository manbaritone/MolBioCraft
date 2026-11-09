// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Shared options window for analysis operations: an input summary, the operation's
 * options (basic + "More options"), and a footer with the settings menu (reset to
 * defaults, save / load / manage option profiles), Cancel and the run button.
 * The options used for a successful run are remembered for next time.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleHelp, Download, Keyboard, Loader2, PanelTop, Pencil, RotateCcw, Save, Settings, Trash2, Upload } from 'lucide-react';
import { OPERATION_HELP } from '../data/helpTopics';
import { HelpTopicView, OPERATION_HELP_EVENT } from './HelpTopicView';
import { StaticModalDialog } from './MenusPreferencesAndBlastModal';
import {
  deleteProfile,
  exportProfilesFile,
  importProfilesFile,
  listProfiles,
  loadLastUsed,
  renameProfile,
  saveLastUsed,
  saveProfile,
  sanitizeValues,
  type OptionProfile,
  type OptionValues,
} from '../core/optionProfiles';
import {
  formatShortcut,
  isOperationId,
  OPERATION_SHORTCUTS_EVENT,
  readOperationShortcuts,
  setOperationInToolbar,
  setOperationShortcut,
  shortcutFromEvent,
} from '../core/operationShortcuts';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export type SetOption = (key: string, value: string | number | boolean) => void;

export interface OperationDialogProps {
  operationId: string;
  title: string;
  /** What the operation will run on (e.g. "20 nucleotide sequences from HIV env"), or a function of the live option values (BG-01M6XSDQ). */
  summary: React.ReactNode | ((values: OptionValues) => React.ReactNode);
  defaults: OptionValues;
  renderOptions: (values: OptionValues, set: SetOption) => React.ReactNode;
  renderMoreOptions?: (values: OptionValues, set: SetOption) => React.ReactNode;
  /** Returns a blocking problem with the inputs or options, or null. */
  validate?: (values: OptionValues) => string | null;
  runLabel?: string;
  /** Runs the operation. Throw to show an error and keep the window open. */
  onRun: (values: OptionValues, signal: AbortSignal) => Promise<string | void> | string | void;
  onClose: () => void;
  /** Download helper for exported profiles (desktop save dialog or browser download). */
  onDownload?: (content: string, fileName: string) => void;
  /**
   * Options that describe this particular input (result name, region, …). They always
   * start from `defaults` and are never taken from the last run or a profile.
   */
  transientKeys?: string[];
}

export const OperationDialog: React.FC<OperationDialogProps> = ({
  operationId,
  title,
  summary,
  defaults,
  renderOptions,
  renderMoreOptions,
  validate,
  runLabel = 'OK',
  onRun,
  onClose,
  onDownload,
  transientKeys = [],
}) => {
  const withTransient = (v: OptionValues): OptionValues => {
    const out = { ...v };
    for (const k of transientKeys) if (k in defaults) out[k] = defaults[k];
    return out;
  };
  const [values, setValues] = useState<OptionValues>(() => withTransient(loadLastUsed(operationId, defaults)));
  const help = OPERATION_HELP[operationId];
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(OPERATION_HELP_EVENT, { detail: operationId }));
  }, [operationId]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [shortcutState, setShortcutState] = useState(() => readOperationShortcuts());
  useEffect(() => {
    const sync = () => setShortcutState(readOperationShortcuts());
    window.addEventListener(OPERATION_SHORTCUTS_EVENT, sync);
    return () => window.removeEventListener(OPERATION_SHORTCUTS_EVENT, sync);
  }, []);
  const opKey = isOperationId(operationId) ? operationId : null;
  const currentShortcut = opKey ? shortcutState.shortcuts[opKey] : undefined;
  const inToolbar = opKey ? shortcutState.toolbar.includes(opKey) : false;
  const [profiles, setProfiles] = useState<OptionProfile[]>(() => listProfiles(operationId));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runStarted, setRunStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const set: SetOption = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };
  const refreshProfiles = () => setProfiles(listProfiles(operationId));
  const problem = validate?.(values) ?? null;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - runStarted) / 1000)), 500);
    return () => clearInterval(id);
  }, [running, runStarted]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    if (problem || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRunStarted(Date.now());
    setElapsed(0);
    setError(null);
    // Let React paint the running state before synchronous engines block the thread.
    await new Promise((r) => setTimeout(r, 30));
    try {
      await onRun(values, controller.signal);
      if (controller.signal.aborted) return;
      saveLastUsed(operationId, values);
      onClose();
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const cancel = () => {
    if (running) {
      abortRef.current?.abort();
      setRunning(false);
      setNotice('Cancelled.');
      return;
    }
    onClose();
  };

  const menuItem = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className="mbc-opdlg-menu-item"
      disabled={disabled}
      onClick={() => {
        setMenuOpen(false);
        onClick();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <StaticModalDialog titleId={`opdlg-${operationId}`} title={title.replace(/…$/, '')} sizeClass="modal-size-operation" onClose={cancel} closedBy="closerequest">
      <div className="mbc-opdlg-body">
        {help && (
          <div className="mbc-opdlg-help-row">
            <button type="button" className="mbc-opdlg-help-toggle" aria-expanded={helpOpen} onClick={() => setHelpOpen((o) => !o)}
              title="What this does and how it works">
              <CircleHelp size={14} /> {helpOpen ? 'Hide help' : 'Help'}
            </button>
          </div>
        )}
        {help && helpOpen && <div className="mbc-opdlg-help"><HelpTopicView topic={help} compact /></div>}
        <div className="mbc-opdlg-summary">{typeof summary === 'function' ? summary(values) : summary}</div>
        <div className="mbc-opdlg-options">{renderOptions(values, set)}</div>
        {renderMoreOptions && (
          <div className="mbc-opdlg-more">
            <button
              type="button"
              className="mbc-opdlg-more-toggle"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
            >
              {moreOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              More options
            </button>
            {moreOpen && <div className="mbc-opdlg-options">{renderMoreOptions(values, set)}</div>}
          </div>
        )}

        {manageOpen && (
          <fieldset className="prefs-fieldset mbc-opdlg-manage">
            <legend>Saved profiles for {title.replace(/…$/, '')}</legend>
            {profiles.length === 0 ? (
              <span className="mbc-opdlg-muted">No profiles saved yet. Use the settings menu → Save current settings.</span>
            ) : (
              <ul className="mbc-opdlg-profile-list">
                {profiles.map((p) => (
                  <li key={p.name}>
                    {renaming?.from === p.name ? (
                      <input
                        className="mbc-opdlg-profile-name"
                        aria-label="New profile name"
                        value={renaming.to}
                        autoFocus
                        onChange={(e) => setRenaming({ from: p.name, to: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(null); }
                          if (e.key !== 'Enter') return;
                          try {
                            renameProfile(operationId, p.name, renaming.to);
                            setRenaming(null);
                            refreshProfiles();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      />
                    ) : (
                      <span className="mbc-opdlg-profile-name">{p.name}</span>
                    )}
                    <span className="mbc-opdlg-muted">{new Date(p.savedAt).toLocaleDateString()}</span>
                    <button type="button" className="btn-secondary-sm" onClick={() => {
                      setValues((cur) => {
                        const next = sanitizeValues(defaults, p.values);
                        for (const k of transientKeys) if (k in cur) next[k] = cur[k];
                        return next;
                      });
                      setNotice(`Loaded profile "${p.name}".`);
                    }}>Load</button>
                    <button type="button" className="mbc-opdlg-icon-btn" aria-label={`Rename ${p.name}`}
                      onClick={() => setRenaming({ from: p.name, to: p.name })}><Pencil size={13} /></button>
                    <button type="button" className="mbc-opdlg-icon-btn" aria-label={`Delete ${p.name}`} onClick={() => {
                      deleteProfile(operationId, p.name);
                      refreshProfiles();
                    }}><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="prefs-row">
              <button type="button" className="btn-secondary-sm" onClick={() => importRef.current?.click()}>
                <Upload size={13} /> Import…
              </button>
              <button
                type="button"
                className="btn-secondary-sm"
                disabled={profiles.length === 0 || !onDownload}
                onClick={() => onDownload?.(exportProfilesFile(profiles), `${operationId}_profiles.json`)}
              >
                <Download size={13} /> Export all
              </button>
              <button type="button" className="btn-secondary-sm" style={{ marginInlineStart: 'auto' }} onClick={() => setManageOpen(false)}>
                Done
              </button>
            </div>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const n = importProfilesFile(await file.text());
                  refreshProfiles();
                  setNotice(`Imported ${n} profile${n === 1 ? '' : 's'}.`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </fieldset>
        )}

        {saveName !== null && (
          <form
            className="prefs-row mbc-opdlg-save-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!saveName.trim()) return;
              try {
                saveProfile(operationId, saveName, values);
                refreshProfiles();
                setNotice(`Saved profile "${saveName.trim()}".`);
                setSaveName(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <label htmlFor={`opdlg-save-${operationId}`}>Save these options as profile:</label>
            <input
              id={`opdlg-save-${operationId}`}
              value={saveName}
              autoFocus
              placeholder="Profile name"
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSaveName(null); } }}
            />
            <button type="submit" className="btn-primary-sm" disabled={!saveName.trim()}>Save</button>
            <button type="button" className="btn-secondary-sm" onClick={() => setSaveName(null)}>Cancel</button>
          </form>
        )}
        {capturingShortcut && opKey && (
          <div className="prefs-row mbc-opdlg-save-row" role="group" aria-label="Keyboard shortcut">
            <label htmlFor={`opdlg-key-${operationId}`}>Shortcut to open this window:</label>
            <input
              id={`opdlg-key-${operationId}`}
              readOnly
              autoFocus
              value={currentShortcut ? formatShortcut(currentShortcut, IS_MAC) : ''}
              placeholder={IS_MAC ? 'Press ⌘ + key' : 'Press Ctrl + key'}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCapturingShortcut(false); return; }
                if (e.key === 'Tab') return;
                e.preventDefault();
                e.stopPropagation();
                const combo = shortcutFromEvent(e.nativeEvent, IS_MAC);
                if (!combo) {
                  if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) setError(`Include ${IS_MAC ? '⌘' : 'Ctrl'} in the shortcut.`);
                  return;
                }
                const err = setOperationShortcut(opKey, combo);
                if (err) { setError(err); return; }
                setError(null);
                setNotice(`Shortcut set to ${formatShortcut(combo, IS_MAC)}.`);
                setCapturingShortcut(false);
              }}
            />
            {currentShortcut && (
              <button type="button" className="btn-secondary-sm" onClick={() => {
                setOperationShortcut(opKey, null);
                setNotice('Shortcut removed.');
                setCapturingShortcut(false);
              }}>Remove</button>
            )}
            <button type="button" className="btn-secondary-sm" onClick={() => setCapturingShortcut(false)}>Done</button>
          </div>
        )}
        {problem && <div className="info-callout" role="status">{problem}</div>}
        {notice && !error && <div className="mbc-opdlg-notice" role="status">{notice}</div>}
        {error && <div className="info-callout" role="alert" style={{ color: 'var(--mbc-red)' }}>{error}</div>}
        {running && (
          <div className="mbc-opdlg-progress" role="status">
            <Loader2 size={14} className="mbc-spin" /> Running… {elapsed} s
          </div>
        )}
      </div>

      <div className="prefs-modal-footer">
        <div className="mbc-opdlg-settings" ref={menuRef}>
          <button
            type="button"
            className="mbc-opdlg-icon-btn"
            aria-label="Operation settings"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Reset, save or load option profiles"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Settings size={15} />
          </button>
          {menuOpen && (
            <div className="mbc-opdlg-menu" role="menu">
              {menuItem('Reset to defaults', <RotateCcw size={13} />, () => {
                setValues({ ...defaults });
                setNotice('Options reset to defaults.');
              })}
              {menuItem('Save current settings…', <Save size={13} />, () => setSaveName(''))}
              <div className="mbc-opdlg-menu-label">Load profile</div>
              {profiles.length === 0 && <div className="mbc-opdlg-menu-empty">No saved profiles</div>}
              {profiles.map((p) => (
                <React.Fragment key={p.name}>
                  {menuItem(p.name, <Check size={13} style={{ opacity: 0 }} />, () => {
                    setValues((cur) => {
                        const next = sanitizeValues(defaults, p.values);
                        for (const k of transientKeys) if (k in cur) next[k] = cur[k];
                        return next;
                      });
                    setNotice(`Loaded profile "${p.name}".`);
                  })}
                </React.Fragment>
              ))}
              <div className="mbc-opdlg-menu-sep" />
              {menuItem('Manage profiles…', <Pencil size={13} />, () => setManageOpen(true))}
              {opKey && (
                <>
                  <div className="mbc-opdlg-menu-sep" />
                  {menuItem(inToolbar ? 'Remove toolbar button' : 'Show toolbar button', <PanelTop size={13} />, () => {
                    setOperationInToolbar(opKey, !inToolbar);
                    setNotice(inToolbar ? 'Removed from the toolbar.' : 'Added to the toolbar.');
                  })}
                  {menuItem(currentShortcut ? `Keyboard shortcut (${formatShortcut(currentShortcut, IS_MAC)})…` : 'Keyboard shortcut…',
                    <Keyboard size={13} />, () => setCapturingShortcut(true))}
                </>
              )}
            </div>
          )}
        </div>
        <div className="mbc-opdlg-footer-actions">
          <button type="button" className="btn-secondary-sm" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary-sm" disabled={!!problem || running} onClick={() => void run()} data-autofocus="true">
            {runLabel}
          </button>
        </div>
      </div>
    </StaticModalDialog>
  );
};

/** Labelled form row used inside operation dialogs. */
export const OptionRow: React.FC<{ label: string; htmlFor?: string; hint?: string; children: React.ReactNode }> = ({
  label,
  htmlFor,
  hint,
  children,
}) => (
  <div className="mbc-opdlg-row">
    <label htmlFor={htmlFor} className="mbc-opdlg-label">{label}</label>
    <div className="mbc-opdlg-control">
      {children}
      {hint && <div className="mbc-opdlg-hint">{hint}</div>}
    </div>
  </div>
);

/**
 * Compact settings menu (reset / save / load option profiles) for windows that are not
 * built on OperationDialog, such as BLAST. Shares the same profile store.
 */
export const OptionProfilesMenu: React.FC<{
  operationId: string;
  defaults: OptionValues;
  values: OptionValues;
  onLoad: (values: OptionValues) => void;
}> = ({ operationId, defaults, values, onLoad }) => {
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<OptionProfile[]>(() => listProfiles(operationId));
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = (label: string, onClick: () => void) => (
    <button type="button" role="menuitem" className="mbc-opdlg-menu-item" onClick={() => { setOpen(false); onClick(); }}>
      <span>{label}</span>
    </button>
  );
  return (
    <div className="mbc-opdlg-settings prefs-row" ref={ref}>
      <button type="button" className="mbc-opdlg-icon-btn" aria-label="Search settings" aria-haspopup="menu" aria-expanded={open}
        title="Reset, save or load option profiles" onClick={() => setOpen((o) => !o)}>
        <Settings size={15} />
      </button>
      {open && (
        <div className="mbc-opdlg-menu" role="menu">
          {item('Reset to defaults', () => { onLoad({ ...defaults }); setMsg('Reset to defaults.'); })}
          {item('Save current settings…', () => setSaveName(''))}
          <div className="mbc-opdlg-menu-label">Load profile</div>
          {profiles.length === 0 && <div className="mbc-opdlg-menu-empty">No saved profiles</div>}
          {profiles.map((p) => (
            <React.Fragment key={p.name}>
              {item(p.name, () => { onLoad(sanitizeValues(defaults, p.values)); setMsg(`Loaded "${p.name}".`); })}
            </React.Fragment>
          ))}
          {profiles.length > 0 && (
            <>
              <div className="mbc-opdlg-menu-sep" />
              {profiles.map((p) => (
                <React.Fragment key={`del-${p.name}`}>
                  {item(`Delete "${p.name}"`, () => { deleteProfile(operationId, p.name); setProfiles(listProfiles(operationId)); })}
                </React.Fragment>
              ))}
            </>
          )}
        </div>
      )}
      {saveName !== null ? (
        <form className="prefs-row" onSubmit={(e) => {
          e.preventDefault();
          if (!saveName.trim()) return;
          saveProfile(operationId, saveName, values);
          setProfiles(listProfiles(operationId));
          setMsg(`Saved "${saveName.trim()}".`);
          setSaveName(null);
        }}>
          <input aria-label="Profile name" placeholder="Profile name" value={saveName} autoFocus
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSaveName(null); } }} />
          <button type="submit" className="btn-primary-sm" disabled={!saveName.trim()}>Save</button>
        </form>
      ) : msg && <span className="mbc-opdlg-muted" role="status">{msg}</span>}
    </div>
  );
};
