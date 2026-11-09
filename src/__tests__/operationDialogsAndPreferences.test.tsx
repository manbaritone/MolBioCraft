// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProfile, exportProfilesFile, importProfilesFile, listProfiles, loadLastUsed,
  renameProfile, saveLastUsed, saveProfile, sanitizeValues,
} from '../core/optionProfiles';
import {
  DEFAULT_USER_PREFERENCES, exportLineEndingFor, loadUserPreferences, normalizeUserPreferences,
  resetUserPreferences, updateUserPreferences,
} from '../core/userPreferences';
import {
  PREFERENCES_CATEGORIES,
  PreferencesModal,
} from '../components/MenusPreferencesAndBlastModal';
import { AlignOperationDialog, BuildTreeOperationDialog } from '../components/AnalysisOperationDialogs';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { phylogenySourceDocuments } from '../core/documentViews';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

describe('option profiles', () => {
  const defaults = { algorithm: '', replicates: 100, open: true };

  it('remembers last-used options, keeping only known keys of the right type', () => {
    expect(loadLastUsed('op', defaults)).toEqual(defaults);
    saveLastUsed('op', { algorithm: 'POA', replicates: 'x' as unknown as number, open: false, junk: 1 });
    expect(loadLastUsed('op', defaults)).toEqual({ algorithm: 'POA', replicates: 100, open: false });
    expect(sanitizeValues(defaults, undefined)).toEqual(defaults);
  });

  it('saves, renames, deletes and scopes profiles per operation', () => {
    saveProfile('align', 'Fast', { algorithm: '' });
    saveProfile('align', 'Fast', { algorithm: 'MAFFT' }); // overwrite same name
    saveProfile('tree', 'Fast', { method: 'UPGMA' });
    expect(listProfiles('align')).toHaveLength(1);
    expect(listProfiles('align')[0].values.algorithm).toBe('MAFFT');
    renameProfile('align', 'Fast', 'Refined');
    expect(listProfiles('align').map((p) => p.name)).toEqual(['Refined']);
    saveProfile('align', 'Other', {});
    expect(() => renameProfile('align', 'Other', 'Refined')).toThrow(/already exists/);
    deleteProfile('align', 'Refined');
    expect(listProfiles('align').map((p) => p.name)).toEqual(['Other']);
    expect(listProfiles('tree')).toHaveLength(1);
    expect(() => saveProfile('align', '  ', {})).toThrow();
  });

  it('round-trips profiles through an exported file and rejects foreign files', () => {
    saveProfile('align', 'Shared', { algorithm: 'POA' });
    const file = exportProfilesFile(listProfiles('align'));
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    expect(importProfilesFile(file)).toBe(1);
    expect(listProfiles('align')[0]).toMatchObject({ name: 'Shared', values: { algorithm: 'POA' } });
    expect(() => importProfilesFile('{"hello":1}')).toThrow(/not a MolBioCraft/);
    expect(() => importProfilesFile('nope')).toThrow(/invalid JSON/);
  });
});

describe('user preferences', () => {
  it('persists, normalises and resets', () => {
    expect(loadUserPreferences()).toEqual(DEFAULT_USER_PREFERENCES);
    updateUserPreferences({ startup: 'restore', view: { minOrfAa: 120, showGcGraph: false } });
    const p = loadUserPreferences();
    expect(p.startup).toBe('restore');
    expect(p.view).toMatchObject({ minOrfAa: 120, showGcGraph: false, showOrfs: true });
    expect(normalizeUserPreferences({ startup: 'weird', view: { minOrfAa: 3 } })).toMatchObject({ startup: 'home', view: { minOrfAa: 10 } });
    resetUserPreferences();
    expect(loadUserPreferences()).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it('resolves export line endings', () => {
    expect(exportLineEndingFor('system', 'windows')).toBe('CRLF');
    expect(exportLineEndingFor('system', 'macos')).toBe('LF');
    expect(exportLineEndingFor('crlf', 'macos')).toBe('CRLF');
    expect(exportLineEndingFor('lf', 'windows')).toBe('LF');
  });

  it('persists default directory, default author, default export formats, and renders all 11 Preferences tabs without disabled controls', () => {
    updateUserPreferences({
      filesAndTabs: {
        defaultDirectory: '~/BioProjects/Cloning',
        defaultAuthor: 'Dr. Jane Doe',
      },
      exportDefaults: {
        dnaFormat: 'fasta',
        rnaFormat: 'fasta',
        proteinFormat: 'faa',
        alignmentFormat: 'phylip',
      },
      primers: {
        primerConcNm: 500,
        monovalentSaltMm: 60,
        divalentMgMm: 2.0,
      },
    });
    const saved = loadUserPreferences();
    expect(saved.filesAndTabs.defaultDirectory).toBe('~/BioProjects/Cloning');
    expect(saved.filesAndTabs.defaultAuthor).toBe('Dr. Jane Doe');
    expect(saved.exportDefaults).toMatchObject({
      dnaFormat: 'fasta',
      rnaFormat: 'fasta',
      proteinFormat: 'faa',
      alignmentFormat: 'phylip',
    });
    expect(saved.primers).toMatchObject({
      primerConcNm: 500,
      monovalentSaltMm: 60,
      divalentMgMm: 2.0,
    });

    const noop = () => undefined;
    for (const tab of PREFERENCES_CATEGORIES) {
      const html = renderToStaticMarkup(
        <PreferencesModal
          initialTab={tab}
          onClose={noop}
          themeMode="system"
          onChangeTheme={noop}
        />
      );
      expect(html).not.toMatch(/<(?:input|select)[^>]*\bdisabled\b/i);
    }
  });
});

describe('operation dialogs', () => {
  const hiv = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-hiv-env')!;
  const hivInputs = phylogenySourceDocuments(hiv, [], SAMPLE_LIBRARY);
  const noop = () => undefined;

  it('renders the alignment options window with the settings menu and input summary', () => {
    const html = renderToStaticMarkup(
      <AlignOperationDialog inputs={hivInputs} sourceLabel="HIV env" onCreate={noop} onClose={noop} />);
    expect(html).toContain('Multiple Alignment');
    expect(html).toContain('<strong>20</strong> RNA sequences from <strong>HIV env</strong>');
    expect(html).toContain('Operation settings');
    expect(html).toContain('>Align<');
  });

  it('blocks running with fewer than two sequences', () => {
    const html = renderToStaticMarkup(
      <AlignOperationDialog inputs={hivInputs.slice(0, 1)} sourceLabel="x" onCreate={noop} onClose={noop} />);
    expect(html).toContain('Select at least two sequences');
  });

  it('tells the tree builder an unaligned input will be aligned first', () => {
    const html = renderToStaticMarkup(
      <BuildTreeOperationDialog inputs={hivInputs} sourceLabel="HIV env" onCreate={noop} onClose={noop} />);
    expect(html).toContain('will be aligned first');
    expect(html).toContain('More options');
    expect(html).toContain('Bootstrap');
  });
});
