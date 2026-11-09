// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Preferences → Keyboard: shortcuts and toolbar buttons for every options window. */

import React, { useEffect, useState } from 'react';
import {
  formatShortcut,
  IS_MAC_PLATFORM,
  OPERATION_LABELS,
  OPERATION_SHORTCUTS_EVENT,
  readOperationShortcuts,
  setOperationInToolbar,
  setOperationShortcut,
  shortcutFromEvent,
  type OperationId,
} from '../core/operationShortcuts';

export const OperationShortcutsEditor: React.FC = () => {
  const [state, setState] = useState(() => readOperationShortcuts());
  const [capturing, setCapturing] = useState<OperationId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setState(readOperationShortcuts());
    window.addEventListener(OPERATION_SHORTCUTS_EVENT, sync);
    return () => window.removeEventListener(OPERATION_SHORTCUTS_EVENT, sync);
  }, []);
  const ops = (Object.keys(OPERATION_LABELS) as OperationId[]).sort((a, b) => OPERATION_LABELS[a].localeCompare(OPERATION_LABELS[b]));
  return (
    <fieldset className="prefs-fieldset">
      <legend>Options-window shortcuts &amp; toolbar</legend>
      <table className="bio-table mbc-op-shortcuts" aria-label="Options window shortcuts">
        <thead>
          <tr><th>Window</th><th style={{ width: 150 }}>Shortcut</th><th style={{ width: 80 }}>Toolbar</th></tr>
        </thead>
        <tbody>
          {ops.map((op) => {
            const key = state.shortcuts[op];
            return (
              <tr key={op}>
                <td>{OPERATION_LABELS[op]}…</td>
                <td>
                  {capturing === op ? (
                    <input
                      autoFocus
                      readOnly
                      aria-label={`Press the shortcut for ${OPERATION_LABELS[op]}`}
                      placeholder={IS_MAC_PLATFORM ? 'Press ⌘ + key' : 'Press Ctrl + key'}
                      style={{ width: 130 }}
                      onBlur={() => setCapturing(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCapturing(null); return; }
                        if (e.key === 'Tab') return;
                        e.preventDefault();
                        e.stopPropagation();
                        const combo = shortcutFromEvent(e.nativeEvent, IS_MAC_PLATFORM);
                        if (!combo) return;
                        const err = setOperationShortcut(op, combo);
                        setMessage(err ?? `${OPERATION_LABELS[op]}: ${formatShortcut(combo, IS_MAC_PLATFORM)}`);
                        if (!err) setCapturing(null);
                      }}
                    />
                  ) : (
                    <span className="prefs-row" style={{ gap: 6 }}>
                      <button type="button" className="btn-secondary-sm" onClick={() => { setCapturing(op); setMessage(null); }}>
                        {key ? formatShortcut(key, IS_MAC_PLATFORM) : 'Set…'}
                      </button>
                      {key && (
                        <button type="button" className="mbc-opdlg-icon-btn" aria-label={`Remove shortcut for ${OPERATION_LABELS[op]}`}
                          onClick={() => { setOperationShortcut(op, null); setMessage(`${OPERATION_LABELS[op]}: shortcut removed`); }}>×</button>
                      )}
                    </span>
                  )}
                </td>
                <td>
                  <input type="checkbox" aria-label={`Show ${OPERATION_LABELS[op]} in the toolbar`} checked={state.toolbar.includes(op)}
                    onChange={(e) => setOperationInToolbar(op, e.target.checked)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {message && <div className="mbc-opdlg-notice" role="status">{message}</div>}
    </fieldset>
  );
};
