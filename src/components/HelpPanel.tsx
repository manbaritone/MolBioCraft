// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Context help panel (Help → Show Help Panel, F1): help for the current view and the last options window, plus search. */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { OPERATION_HELP, searchHelp, VIEW_HELP } from '../data/helpTopics';
import { HelpTopicView, OPERATION_HELP_EVENT } from './HelpTopicView';

export const HelpPanel: React.FC<{ viewerTab: string; onClose: () => void }> = ({ viewerTab, onClose }) => {
  const [lastOp, setLastOp] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setLastOp(String((e as CustomEvent).detail));
    window.addEventListener(OPERATION_HELP_EVENT, on);
    return () => window.removeEventListener(OPERATION_HELP_EVENT, on);
  }, []);
  const view = VIEW_HELP[viewerTab];
  const op = lastOp ? OPERATION_HELP[lastOp] : undefined;
  const results = query.trim() ? searchHelp(query) : [];
  return (
    <aside className="mbc-help-panel" aria-label="Help">
      <div className="mbc-help-panel-head">
        <strong>Help</strong>
        <button type="button" className="mbc-help-close" aria-label="Close help" onClick={onClose}><X size={14} /></button>
      </div>
      <input type="search" className="mbc-help-search" placeholder="Search help…" aria-label="Search help" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="mbc-help-panel-body">
        {query.trim() ? (
          results.length ? results.map(({ id, topic }) => (
            <div key={id} className="mbc-help-result">
              <button type="button" className="mbc-help-result-title" aria-expanded={open === id} onClick={() => setOpen((o) => (o === id ? null : id))}>{topic.title}</button>
              {open === id ? <HelpTopicView topic={topic} compact /> : <div className="mbc-help-where">{topic.summary.slice(0, 110)}{topic.summary.length > 110 ? '…' : ''}</div>}
            </div>
          )) : <p className="mbc-help-where">No help topics match “{query}”.</p>
        ) : (
          <>
            {op && <section><div className="mbc-help-section">Last options window</div><HelpTopicView topic={op} /></section>}
            {view && <section><div className="mbc-help-section">This view</div><HelpTopicView topic={view} /></section>}
            {!op && !view && <p className="mbc-help-where">Open a document or an options window to see help for it, or search above.</p>}
            <p className="mbc-help-where">Every options window also has a Help link at its top right.</p>
          </>
        )}
      </div>
    </aside>
  );
};
