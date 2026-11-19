/**
 * US-01M6Q1BD: the studio rail (D0015, D0017, D0219, D0242). All eleven studios and the two
 * document panels are always listed down the left edge of a session, in the studio registry's
 * order; a studio the active document cannot show is disabled and says why; the rail marks the one
 * studio resolved from (tab, document, view), however the view was opened. The App is mounted
 * through appHarness.tsx, and its rail entries are addressed by studio id (D0242).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SequenceDocument } from '../types/bio';
import { STUDIO_ENTRIES, studioAvailability, type StudioEntry } from '../core/studioRegistry';
import { mountApp, type AppHarness } from './appHarness';
import type { LiveElement } from './liveDom';

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const RAIL_IDS = STUDIO_ENTRIES.map((e) => e.id);
const entry = (id: string): StudioEntry => STUDIO_ENTRIES.find((e) => e.id === id)!;

const BASE: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', features: [], primers: [], history: [],
};
const DNA: SequenceDocument = {
  ...BASE, id: 'rail-dna', name: 'Rail_Plasmid', accession: 'RL_1', topology: 'circular',
  sequence: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGA'.repeat(3),
  features: [0, 1].map((i) => ({ id: `f${i}`, name: `f${i}`, type: 'misc_feature', start: 1 + i, end: 9 + i, strand: 1, color: '#888888' })),
} as SequenceDocument;
const PROTEIN: SequenceDocument = {
  ...BASE, id: 'rail-protein', name: 'Rail_Protein', accession: 'RL_2', moleculeType: 'Protein', sequence: 'MKWVTFISLLFLFSSAYSRGVFRR',
  docMetadata: { 'PDB name': 'RL1A', Chain: 'A' },
} as SequenceDocument;
const TREE: SequenceDocument = {
  ...BASE, id: 'rail-tree', name: 'Rail_Tree', accession: 'RL_3', documentKind: 'tree', docMetadata: { Newick: '((a:1,b:1):1,c:2);', 'Source Format': 'Newick' },
} as SequenceDocument;
const NOTE: SequenceDocument = {
  ...BASE, id: 'rail-note', name: 'Rail_Notes', accession: 'RL_4', docMetadata: { 'Document Type': 'Text Document', Notes: 'Digest at 37 C.' },
} as SequenceDocument;
const LIBRARY = [DNA, PROTEIN, TREE, NOTE];

interface RailEntry { studio: string; name: string; disabled: boolean; current: boolean; tabIndex: string | null; el: LiveElement }
const rail = (app: AppHarness): RailEntry[] => app.railTabs().map((el) => ({
  studio: el.getAttribute('data-studio') ?? '',
  name: words(el.querySelectorAll('.mbc-studio-rail-name')[0]?.textContent),
  disabled: el.getAttribute('aria-disabled') === 'true',
  current: el.getAttribute('aria-selected') === 'true',
  tabIndex: el.getAttribute('tabindex'),
  el,
}));
const railEntry = (app: AppHarness, id: string) => {
  const hit = rail(app).filter((r) => r.studio === id);
  expect(hit, `the rail lists ${id} once`).toHaveLength(1);
  return hit[0];
};
const current = (app: AppHarness) => rail(app).filter((r) => r.current).map((r) => r.studio);
/** The accessible description of a rail entry: the text of the element its aria-describedby names. */
const description = (app: AppHarness, el: LiveElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? words(app.all(`#${id}`).map((d) => d.textContent).join(' ')) : '';
};
const statusText = (app: AppHarness) => app.all('.statusbar-toast-text').map((s) => words(s.textContent)).join(' | ');
const toolButton = (app: AppHarness, label: string) => {
  const hit = app.all('button.mbc-tool-btn').filter((b) => words(b.textContent) === label);
  expect(hit, `the toolbar's ${label} button`).toHaveLength(1);
  return hit[0];
};
const lit = (app: AppHarness, label: string) => toolButton(app, label).getAttribute('class')!.split(/\s+/).includes('active');
const openOn = (app: AppHarness, doc: SequenceDocument, viewerTab: Parameters<AppHarness['restoreSession']>[0]['viewerTab']) =>
  app.restoreSession({ documents: LIBRARY, activeDocId: doc.id, viewerTab });

function expectWholeRail(app: AppHarness, where: string) {
  expect(rail(app).map((r) => r.studio), `${where}: the 11 studios, then History and Info`).toEqual(RAIL_IDS);
  expect(rail(app).map((r) => r.name), `${where}: each by its registry name`).toEqual(STUDIO_ENTRIES.map((e) => e.name));
  expect(current(app), `${where}: one studio is current`).toHaveLength(1);
}

// ─── AC1 ───

describe('US-01M6Q1BD AC1: the rail lists every studio and both panels for every kind of document', () => {
  it('US-01M6Q1BD AC1 lists all eleven studios and both document panels for every kind of document', async () => {
    const app = await mountApp();
    try {
      for (const [doc, tab] of [[DNA, 'sequence-view'], [PROTEIN, 'sequence-view'], [TREE, 'phylogenetics'], [NOTE, 'text-view']] as const) {
        await openOn(app, doc, tab);
        expectWholeRail(app, doc.name);
        // History and Info sit after the one divider, below the studios.
        const list = app.one('.mbc-studio-rail-list', 'the rail');
        const order = list.children.map((c) => c.getAttribute('data-studio') ?? (c.getAttribute('class')?.includes('mbc-studio-rail-divider') ? '|' : '?'));
        expect(order.join(' '), `${doc.name}: the panels follow a divider`).toBe([...RAIL_IDS.slice(0, 11), '|', 'history', 'info'].join(' '));
        expect(app.header().querySelectorAll('[role="tab"]'), `${doc.name}: the header has no studio tab`).toHaveLength(0);
        expect(app.all('.mbc-scroll-strip--header-tabs'), `${doc.name}: no header studio strip`).toHaveLength(0);
      }
      // An empty session.
      await app.menu('new-session:blank');
      expect(app.all('.mbc-sources-pane'), 'a session is open').toHaveLength(1);
      expectWholeRail(app, 'an empty session');
      expect(railEntry(app, 'vectors').disabled, 'the vector catalogue needs no document').toBe(false);
      expect(railEntry(app, 'cloning-gel').disabled).toBe(true);
      expect(description(app, railEntry(app, 'cloning-gel').el)).toContain('Open or add a document first');

      // The sidebar hidden, then Expand Viewer.
      await openOn(app, DNA, 'sequence-view');
      await app.menu('view:toggle-sidebar');
      expect(app.all('.mbc-sources-pane'), 'the sidebar is hidden').toHaveLength(0);
      expectWholeRail(app, 'the sidebar hidden');
      await app.menu('view:toggle-sidebar');
      expect(app.all('.mbc-sources-pane'), 'the sidebar is back').toHaveLength(1);
      await app.menu('view:expand-doc-view');
      expect(app.all('.mbc-sources-pane'), 'Expand Viewer hides the sidebar').toHaveLength(0);
      expectWholeRail(app, 'Expand Viewer');
    } finally {
      app.unmount();
    }
  });
});

// ─── AC2 ───

describe('US-01M6Q1BD AC2: an inapplicable studio is disabled and says why', () => {
  it('US-01M6Q1BD AC2 disables the DNA-only studios on a protein with their registry reason and refuses to switch to one', async () => {
    const app = await mountApp();
    try {
      await openOn(app, PROTEIN, 'sequence-view');
      for (const id of ['cloning-gel', 'vectors', 'primers-crispr', 'sanger-contig']) {
        const r = railEntry(app, id);
        const availability = studioAvailability(entry(id), PROTEIN);
        expect(availability.ok, id).toBe(false);
        expect(r.disabled, `${id} is aria-disabled on a protein`).toBe(true);
        expect(description(app, r.el), `${id} describes its reason`).toBe((availability as { reason: string }).reason);
      }
      expect(description(app, railEntry(app, 'cloning-gel').el)).toContain('Cloning & Gel needs a DNA sequence');
      expect(description(app, railEntry(app, 'cloning-gel').el)).toContain('"Rail_Protein" is a Protein sequence');
      await app.click(railEntry(app, 'cloning-gel').el);
      expect(current(app), 'activating it leaves the current studio').toEqual(['sequence-map']);
      expect(app.activeTab()).toBe('sequence-view');
      expect(statusText(app), 'the status bar gives the same reason').toContain((studioAvailability(entry('cloning-gel'), PROTEIN) as { reason: string }).reason);
      // The rail refuses rather than requesting the studio: a request the record cannot show would be redirected (and remembered).
      expect(statusText(app), 'refused, not redirected').not.toContain('Select a document it applies to');

      await openOn(app, DNA, 'sequence-view');
      expect(railEntry(app, 'cloning-gel').disabled, 'Cloning & Gel applies to a DNA plasmid').toBe(false);
      expect(railEntry(app, 'cloning-gel').el.getAttribute('aria-describedby')).toBeNull();
    } finally {
      app.unmount();
    }
  });
});

// ─── AC3 ───

describe('US-01M6Q1BD AC3: switching studios never removes a studio from the rail', () => {
  it('US-01M6Q1BD AC3 keeps every studio listed from Cloning & Gel to Primers & CRISPR to Alignment and back to Sequence Map', async () => {
    const app = await mountApp();
    try {
      await openOn(app, DNA, 'sequence-view');
      for (const [id, tab] of [['cloning-gel', 'cloning-gel'], ['primers-crispr', 'primers-pcr'], ['alignment', 'sequence-alignment'], ['sequence-map', 'sequence-view']]) {
        await app.clickStudio(id);
        expect(app.activeTab(), `${id} opens`).toBe(tab);
        expect(current(app), `${id} is current`).toEqual([id]);
        expectWholeRail(app, `after ${id}`);
        expect(railEntry(app, 'cloning-gel').disabled, `Cloning & Gel stays enabled after ${id}`).toBe(false);
      }
    } finally {
      app.unmount();
    }
  });
});

// ─── AC4 ───

describe('US-01M6Q1BD AC4: the rail marks the studio the current view belongs to, however it was opened', () => {
  it('US-01M6Q1BD AC4 marks the studio opened by a menu, by ⌘K, by the studio\'s own sub-tab bar, by the 3D view and by a restored session', async () => {
    const app = await mountApp();
    try {
      await openOn(app, DNA, 'sequence-view');
      await app.menu('tools:ngs-suite');
      expect(app.activeTab()).toBe('genomics-ngs');
      expect(current(app), 'Tools > NGS Suite').toEqual(['pipelines-ngs']);

      // The studio's own sub-tab bar moves the genomics tab between its two studios (D0241).
      const subTab = async (label: string) => {
        const hit = app.canvas().querySelectorAll('button[role="tab"]').filter((b) => words(b.textContent) === label);
        expect(hit, `the studio's ${label} sub-tab`).toHaveLength(1);
        await app.click(hit[0]);
      };
      // The genomics studio has no 3D sub-tab: Protein & 3D is its own tab (US-01M6Q164), so every
      // genomics sub-tab keeps Pipelines & NGS current.
      expect(app.canvas().querySelectorAll('button[role="tab"]').filter((b) => words(b.textContent) === 'Coiled-Coils, Transmembrane & 3D PDB'), 'no 3D sub-tab').toHaveLength(0);
      await subTab('Glimmer Genes, CpG & Repeats');
      expect(current(app), 'back to an NGS sub-tab').toEqual(['pipelines-ngs']);
      // The rail's own Protein & 3D entry opens the Protein studio's tab, from an NGS view.
      await app.clickStudio('protein-3d');
      expect(app.activeTab()).toBe('protein-3d');
      expect(current(app), 'the rail\'s Protein & 3D').toEqual(['protein-3d']);

      await app.press('k', { mod: true });
      const item = app.all('.mbc-cmd-palette-item').filter((el) => el.getAttribute('data-studio') === 'cloning-gel');
      expect(item, '⌘K lists Cloning & Gel').toHaveLength(1);
      await app.click(item[0]);
      expect(app.activeTab()).toBe('cloning-gel');
      expect(current(app), '⌘K Cloning & Gel').toEqual(['cloning-gel']);

      // The structure's 3D viewer sub-view.
      await openOn(app, PROTEIN, 'protein-3d');
      expect(current(app), 'the 3D viewer of a structure').toEqual(['protein-3d']);
      expect(app.one('.mbc-studio-rail-list').getAttribute('data-current-studio')).toBe('protein-3d');

      await openOn(app, DNA, 'phylogenetics');
      expect(current(app), 'a restored session on phylogenetics').toEqual(['phylogenetics']);
      expect(app.one('.mbc-studio-rail-list').getAttribute('data-current-view')).toBe('phylogenetics');
    } finally {
      app.unmount();
    }
  });
});

// ─── AC5 ───

describe('US-01M6Q1BD AC5: the toolbar\'s studio-named buttons light only for their own open dropdown', () => {
  it('US-01M6Q1BD AC5 lights Workflows for Pipelines & NGS only, never for History or Info, and no studio-named button for its studio', async () => {
    const app = await mountApp();
    try {
      await openOn(app, DNA, 'sequence-view');
      await app.clickStudio('history');
      expect(app.activeTab()).toBe('history-hybrid');
      expect(lit(app, 'Workflows'), 'Workflows on History').toBe(false);
      await app.clickStudio('info');
      expect(app.activeTab()).toBe('document-info');
      expect(lit(app, 'Workflows'), 'Workflows on Info').toBe(false);
      await app.clickStudio('pipelines-ngs');
      expect(current(app)).toEqual(['pipelines-ngs']);
      expect(lit(app, 'Workflows'), 'Workflows on Pipelines & NGS').toBe(true);

      for (const [id, label, dropdown] of [['alignment', 'Align', true], ['phylogenetics', 'Tree', true], ['primers-crispr', 'Primers', true],
        ['cloning-gel', 'Cloning', true], ['vectors', 'Vectors', false]] as const) {
        await app.clickStudio(id);
        expect(current(app), `${id} is current`).toEqual([id]);
        expect(lit(app, label), `${label} does not light for its studio`).toBe(false);
        expect(lit(app, 'Workflows'), `Workflows on ${id}`).toBe(false);
        if (!dropdown) continue;
        await app.click(toolButton(app, label));
        expect(toolButton(app, label).getAttribute('aria-expanded'), `${label}'s dropdown opens`).toBe('true');
        expect(lit(app, label), `${label} lights while its dropdown is open`).toBe(true);
        await app.click(toolButton(app, label));
        expect(lit(app, label), `${label} goes dark when its dropdown closes`).toBe(false);
      }
    } finally {
      app.unmount();
    }
  });
});

// ─── AC6 ───

describe('US-01M6Q1BD AC6: the rail works from the keyboard', () => {
  it('US-01M6Q1BD AC6 keeps one entry in the tab order, opens with Enter and lets focus rest on a disabled entry that reads its reason', async () => {
    const app = await mountApp();
    try {
      await openOn(app, PROTEIN, 'sequence-view');
      const list = app.one('.mbc-studio-rail-list', 'the rail');
      expect(list.getAttribute('role')).toBe('tablist');
      expect(list.getAttribute('aria-orientation')).toBe('vertical');
      const inTabOrder = () => rail(app).filter((r) => r.tabIndex === '0').map((r) => r.studio);
      expect(inTabOrder(), 'one entry, the current one, is in the tab order').toEqual(['sequence-map']);
      expect(rail(app).filter((r) => r.tabIndex !== '0').every((r) => r.tabIndex === '-1')).toBe(true);
      railEntry(app, 'sequence-map').el.focus();
      const focused = () => app.doc.activeElement.getAttribute('data-studio');

      await app.press('ArrowDown');
      expect(focused(), 'ArrowDown moves to Annotations').toBe('annotations');
      expect(inTabOrder(), 'the tab stop moves with focus').toEqual(['annotations']);
      expect(current(app), 'moving focus does not switch').toEqual(['sequence-map']);
      await app.press('Enter');
      expect(app.activeTab(), 'Enter opens Annotations').toBe('annotations-table');
      expect(current(app)).toEqual(['annotations']);

      await app.press('ArrowDown');
      expect(focused()).toBe('flatfile');
      await app.press('ArrowDown');
      expect(focused(), 'focus rests on the disabled Cloning & Gel').toBe('cloning-gel');
      const cloning = railEntry(app, 'cloning-gel');
      expect(cloning.disabled).toBe(true);
      expect(cloning.el.hasAttribute('disabled'), 'it stays focusable: aria-disabled, never disabled').toBe(false);
      expect(description(app, cloning.el), 'its reason is its accessible description')
        .toBe((studioAvailability(entry('cloning-gel'), PROTEIN) as { reason: string }).reason);
      await app.press('Enter');
      expect(app.activeTab(), 'Enter on a disabled entry does not switch').toBe('annotations-table');
      expect(current(app)).toEqual(['annotations']);
      await app.press('ArrowUp');
      expect(focused(), 'ArrowUp moves back').toBe('flatfile');
      await app.press('End');
      expect(focused(), 'End reaches Info').toBe('info');
      await app.press('Home');
      expect(focused(), 'Home reaches Sequence Map').toBe('sequence-map');
    } finally {
      app.unmount();
    }
  });
});

// ─── AC7 ───

/** The declarations of every top-level rule whose selector names `cls`, as prop -> value. */
function rulesFor(css: string, selector: RegExp): { selector: string; decls: Record<string, string> }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => selector.test(sel)).map(([, sel, body]) => ({
    selector: sel.trim(),
    decls: Object.fromEntries(body.split(';').map((d) => d.split(':')).filter((p) => p.length >= 2).map(([p, ...v]) => [p.trim(), v.join(':').trim()])),
  }));
}

describe('US-01M6Q1BD AC7: the rail keeps the studio names whole', () => {
  it('US-01M6Q1BD AC7 shows each full registry name at caption size or larger, never clipped, in a rail as wide as --mbc-rail-w', async () => {
    const app = await mountApp();
    try {
      await openOn(app, DNA, 'sequence-view');
      for (const r of rail(app)) {
        expect(r.name, `${r.studio} shows its full name`).toBe(entry(r.studio).name);
        expect(r.el.textContent, `${r.studio} has no ellipsis`).not.toMatch(/…|\.\.\./);
      }
    } finally {
      app.unmount();
    }
    const css = readFileSync(new URL('../App.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const railRules = rulesFor(css, /mbc-studio-rail/);
    expect(railRules.length, 'the rail has its own rules').toBeGreaterThan(3);
    for (const rule of railRules) {
      expect(rule.decls['text-overflow'], `${rule.selector} clips no name`).toBeUndefined();
      expect(rule.decls['white-space'] ?? '', `${rule.selector} lets a name wrap`).not.toBe('nowrap');
    }
    const name = rulesFor(css, /^\s*\.mbc-studio-rail-name\s*$/);
    expect(name, 'one rule sizes the name').toHaveLength(1);
    expect(['var(--font-size-caption)', 'var(--font-size-label)'], 'the name is Caption or Label type (11px or more)').toContain(name[0].decls['font-size']);
    expect(name[0].decls['-webkit-line-clamp'], 'the name is not clamped').toBeUndefined();
    const shell = rulesFor(css, /^\s*\.mbc-studio-rail\s*$/);
    expect(shell.map((r) => r.decls.width), 'the rail is as wide as the token').toEqual(['var(--mbc-rail-w)']);
    expect(css, 'the token is declared').toMatch(/--mbc-rail-w:\s*\d+px/);
  });
});
