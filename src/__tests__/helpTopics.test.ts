// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { OPERATION_LABELS } from '../core/operationShortcuts';
import { OPERATION_HELP, searchHelp, VIEW_HELP } from '../data/helpTopics';

describe('context help', () => {
  it('every options window has a help topic with a summary and menu path', () => {
    const missing = Object.keys(OPERATION_LABELS).filter((id) => !OPERATION_HELP[id]);
    expect(missing).toEqual([]);
    for (const [id, t] of Object.entries(OPERATION_HELP)) {
      expect(t.summary.length, id).toBeGreaterThan(30);
      expect(t.where, id).toMatch(/→/);
    }
  });
  it('the main views have help', () => {
    for (const v of ['sequence-view', 'text-view', 'sequence-alignment', 'phylogenetics', 'document-info']) expect(VIEW_HELP[v]).toBeTruthy();
  });
  it('search finds topics by method and option text', () => {
    expect(searchHelp('TIDE').map((r) => r.id)).toContain('crispr-editing');
    expect(searchHelp('little bootstraps').map((r) => r.id)).toContain('build-tree');
    expect(searchHelp('zzzz-nothing')).toEqual([]);
  });
  it('has a topic for Align Structures, found by its methods', () => {
    expect(OPERATION_HELP['align-structures'].where).toBe('Align → Align Structures…');
    expect(searchHelp('TM-align').map((r) => r.id)).toContain('align-structures');
    expect(searchHelp('Kabsch').map((r) => r.id)).toContain('align-structures');
  });
});
