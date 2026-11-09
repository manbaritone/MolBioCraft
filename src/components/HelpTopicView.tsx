// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import type { HelpTopic } from '../data/helpTopics';

/** Renders one help topic (options window or view). */
export const HelpTopicView: React.FC<{ topic: HelpTopic; compact?: boolean }> = ({ topic, compact }) => (
  <div className="mbc-help-topic">
    {!compact && <h4>{topic.title}</h4>}
    {topic.where && <div className="mbc-help-where">{topic.where}</div>}
    <p>{topic.summary}</p>
    {topic.method && <p><strong>How it works:</strong> {topic.method}</p>}
    {topic.options && topic.options.length > 0 && (
      <>
        <strong>Options</strong>
        <ul>{topic.options.map((o) => <li key={o}>{o}</li>)}</ul>
      </>
    )}
    {topic.result && <p><strong>Result:</strong> {topic.result}</p>}
  </div>
);

/** Event fired when an options window opens, so the Help panel can follow it. */
export const OPERATION_HELP_EVENT = 'mbc:operation-help';
