// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TAW8: one right-hand inspector for every task window, App's own (D0060, D0063, D0064).
 * Every check runs in the real App over the live DOM (the US-01M6TB6G harness), driven through its
 * own menus, shortcuts, header button and resizer.
 *
 * No studio claims the inspector yet, so two stand-ins reach the studio side:
 * - the section contract (AC6-AC9) is proved, as D0064 rules, by mounting the exported
 *   WorkbenchInspectorProvider, the component App renders, around test sections in the live window,
 *   with a host that plays App's part (it holds the open state and the column node, and draws the
 *   button and the column from what the provider tells it);
 * - App's half of it (a tab with settings other than Sequence: its labels, its column, its width)
 *   is shown by one studio, the Pipelines studio, drawn as a probe that claims the inspector
 *   through the real API. Unless a check sets `probe.kind`, the real studio is drawn.
 */

import { act, StrictMode, useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { resolveNativeMenuItemEnabled } from '../core/commandAvailability';
import { resolveMenuNodeFunctionDescription } from '../data/menuFunctionDescriptions';
import type { SequenceDocument } from '../types/bio';
import { macHost, mountApp, type AppHarness, type MountOptions } from './appHarness';
import { cascaded, gridTracks } from './cssCascade';
import { dispatchLiveEvent, LiveElement, memoryStorage } from './liveDom';

type Inspector = typeof import('../components/WorkbenchInspector');
type InspectorClaims = import('../components/WorkbenchInspector').InspectorClaims;

// A macOS host's Tauri runtime (AC5). vi.mock is hoisted above the imports, so the factory loads the harness itself.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

type PipelineStudio = typeof import('../components/WorkflowPipelineStudio').WorkflowPipelineStudio;
/**
 * Which probe the Pipelines tab draws (null: the real studio), and this launch's copies of the
 * modules it draws with. Vitest runs a vi.mock factory once per test file, not once per launch, so
 * the factory holds neither: pipelines() hands them over from the launch the check runs in.
 */
const probe = vi.hoisted(() => ({
  kind: null as null | 'one' | 'many' | 'own',
  inspector: null as Inspector | null,
  real: null as PipelineStudio | null,
}));

vi.mock('../components/WorkflowPipelineStudio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/WorkflowPipelineStudio')>();
  const React = await import('react');
  const h = React.createElement;
  const api = () => {
    if (!probe.inspector) throw new Error("open the Pipelines tab with pipelines(), which hands the probe this launch's WorkbenchInspector");
    return probe.inspector;
  };
  /** One section, swapped for another in one commit by the probe's own button (a sub-tab switch). */
  function OneSection() {
    const { InspectorSection } = api();
    const [beta, setBeta] = React.useState(false);
    return h('div', { className: 'probe-studio' },
      h('button', { type: 'button', className: 'probe-swap', onClick: () => setBeta((b) => !b) }, 'Swap the probe section'),
      beta
        ? h(InspectorSection, { key: 'beta', title: 'Probe Beta', order: 1 }, h('input', { type: 'text', 'aria-label': 'Probe beta value', defaultValue: '' }))
        : h(InspectorSection, { key: 'alpha', title: 'Probe Alpha', order: 1 }, h('input', { type: 'text', 'aria-label': 'Probe alpha value', defaultValue: '' })));
  }
  /** Three sections mounted out of their order, the first two holding a form grid each. */
  function ManySections() {
    const { InspectorSection } = api();
    const field = (name: string) => h('label', { key: name }, name, h('input', { type: 'text', 'aria-label': name, defaultValue: '' }));
    return h('div', { className: 'probe-studio' },
      h(InspectorSection, { title: 'Probe Third', order: 3 }, h('div', { className: 'form-grid-3col' }, field('Third A'), field('Third B'), field('Third C'))),
      h(InspectorSection, { title: 'Probe First', order: 1 }, h('div', { className: 'form-grid-2col' }, field('First A'), field('First B'))),
      h(InspectorSection, { title: 'Probe Second', order: 2 }, h('span', null, 'Probe second body')));
  }
  /** A studio that draws its own panel (as the alignment studio's MSA grid does). */
  function OwnPanel() {
    const draw = api().useOwnInspector(true);
    return h('div', { className: 'probe-studio' }, draw ? h('aside', { className: 'probe-own-panel' }, 'Probe own panel') : null);
  }
  const probes = { one: OneSection, many: ManySections, own: OwnPanel };
  function WorkflowPipelineStudio(props: Parameters<PipelineStudio>[0]) {
    if (probe.kind) return h(probes[probe.kind]);
    if (!probe.real) throw new Error("open the Pipelines tab with pipelines(), which hands the probe this launch's real studio");
    return h(probe.real, props);
  }
  return { ...actual, WorkflowPipelineStudio };
});

// Each check launches the App afresh, some more than once.
vi.setConfig({ testTimeout: 60_000 });

async function withApp<T>(opts: MountOptions, run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp(opts);
  try {
    return await run(app);
  } finally {
    app.unmount();
    Object.assign(probe, { kind: null, inspector: null, real: null });
  }
}

// ─── Documents built in the test ───

function lettersFrom(seed: number, n: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'[s >>> 30];
  }
  return out;
}
const BLANK: SequenceDocument = {
  id: '', name: '', accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear', folder: 'Local',
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z', features: [], primers: [], history: [],
};
const PLASMID: SequenceDocument = {
  ...BLANK, id: 'aw8-plasmid', name: 'pInspector_Ring', accession: 'AW8_0001', description: 'A circular construct built in the test',
  sequence: lettersFrom(0xa1b2, 3000), topology: 'circular', folder: 'Plasmids & Vectors',
  features: [{ id: 'f-aw8', name: 'InspectorMarker', type: 'CDS', start: 101, end: 961, strand: 1, color: '#d93025' }],
};
const INSERT: SequenceDocument = {
  ...BLANK, id: 'aw8-insert', name: 'Inspector_Insert', accession: 'AW8_0002', description: 'A linear insert built in the test',
  sequence: lettersFrom(0xc3d4, 840), folder: 'Cloning Inserts & PCR',
};
/** A contig summary as isContigSummaryRecord (src/core/contigSummary.ts) reads one: flagged, no bases, a declared length. */
const CONTIG: SequenceDocument = {
  ...BLANK, id: 'aw8-contig', name: 'Inspector_Contig_Summary', accession: 'AW8_0003', description: 'A contig summary built in the test',
  docMetadata: { 'Is Contig Summary': 'Yes', 'Declared Length': 125_000 },
  features: [{ id: 'f-aw8-src', name: 'source', type: 'source', start: 1, end: 125_000, strand: 1, color: '#94a3b8' }],
};

const sequenceOf = (app: AppHarness, ...docs: SequenceDocument[]) =>
  app.restoreSession({ documents: docs.length ? docs : [PLASMID], activeDocId: (docs[0] ?? PLASMID).id, viewerTab: 'sequence-view' });

// ─── Reading the App ───

const label = (el: LiveElement | null) => el?.getAttribute('aria-label') ?? null;
/** The inspector as the App shows it: the header button's label, the column, the resizer, the pane title. */
function shown(app: AppHarness) {
  const aside = app.inspectorAside();
  return {
    button: label(app.inspectorButton()),
    aside: aside !== null,
    hidden: app.bodySplit().classList.contains('inspector-hidden'),
    resizer: label(app.all('.mbc-inspector-resizer')[0] ?? null),
    title: aside?.querySelectorAll('.mbc-pane-title span')[0]?.textContent ?? null,
  };
}
const SEQUENCE_OPEN = { button: 'Hide Sequence View Controls Inspector', aside: true, hidden: false, resizer: 'Resize Sequence View Controls inspector', title: 'Sequence View Controls' };
const SEQUENCE_CLOSED = { button: 'Show Sequence View Controls Inspector', aside: false, hidden: true, resizer: null, title: null };
const NONE = { button: null, aside: false, hidden: true, resizer: null, title: null };

const resizer = (app: AppHarness) => app.one('.mbc-inspector-resizer', 'inspector resizer');
const widthNow = (app: AppHarness) => Number(resizer(app).getAttribute('aria-valuenow'));
/** A header in the inspector column whose text starts with `start`. */
const sectionHeader = (app: AppHarness, start: string) => {
  const found = app.inspectorAside()!.querySelectorAll('button.mbc-accordion-header').filter((b) => b.textContent.trim().startsWith(start));
  expect(found, `one "${start}" section header`).toHaveLength(1);
  return found[0];
};
/** Opens the Pipelines tab (from the Sequence tab, by Tools > Pipelines), drawn as `kind`'s probe or the real studio. */
async function pipelines(app: AppHarness, kind: typeof probe.kind) {
  // This launch's modules, one at a time.
  probe.inspector = await import('../components/WorkbenchInspector');
  probe.real = (await vi.importActual<typeof import('../components/WorkflowPipelineStudio')>('../components/WorkflowPipelineStudio')).WorkflowPipelineStudio;
  probe.kind = kind;
  if (app.activeTab() !== 'sequence-view') await app.clickTab('sequence-view');
  await app.menu('tools:pipelines');
  expect(app.activeTab()).toBe('guided-pipelines');
  const studio = app.canvas().querySelectorAll('.probe-studio');
  expect(studio.length, kind ? 'the probe is drawn' : 'the real studio is drawn').toBe(kind ? 1 : 0);
  if (studio.length) expect(insideProvider(studio[0], probe.inspector), 'the probe is drawn inside App\'s provider').toBe(true);
}

/** The rows of the open menus labelled `text`. */
const menuRows = (app: AppHarness, text: string) =>
  app.all('button.desktop-menu-row').filter((b) => b.querySelectorAll('.desktop-menu-label').some((s) => s.textContent.trim() === text));
/** Opens the menus from `opener` through `submenus` and returns the row labelled `leaf`, not clicked. */
async function menuRow(app: AppHarness, opener: LiveElement, submenus: string[], leaf: string): Promise<LiveElement> {
  await app.click(opener);
  for (const sub of submenus) {
    const rows = menuRows(app, sub);
    expect(rows, `one "${sub}" row`).toHaveLength(1);
    await app.click(rows[0]);
  }
  const rows = menuRows(app, leaf);
  expect(rows, `one "${leaf}" row`).toHaveLength(1);
  return rows[0];
}
const menubar = (app: AppHarness, name: string) => {
  const found = app.all('.mbc-menubar button.menu-item').filter((b) => b.textContent.trim() === name);
  expect(found, `the ${name} menu`).toHaveLength(1);
  return found[0];
};
/** Closes the open menus by clicking their opener again until no menu row is drawn. */
async function closeMenus(app: AppHarness, opener: LiveElement) {
  for (let i = 0; i < 2 && app.all('button.desktop-menu-row').length; i++) await app.click(opener);
  expect(app.all('button.desktop-menu-row'), 'the menus closed').toHaveLength(0);
}
const viewInspectorRow = (app: AppHarness) => menuRow(app, menubar(app, 'View'), ['Panels'], 'Inspector');

// ─── The provider, around test sections (AC6-AC9, D0064) ───

/**
 * Plays App's part around the real provider: it holds the open state and the column node, draws the
 * button while anything claims the inspector and the column while a section does and it is open,
 * and logs each crossing the provider reports and each of its own renders.
 */
function Host({ inspector, open, log, renders, children }: { inspector: Inspector; open: boolean; log: InspectorClaims[]; renders: { count: number }; children?: ReactNode }) {
  renders.count++;
  const [claims, setClaims] = useState<InspectorClaims>(inspector.NO_INSPECTOR_CLAIMS);
  const [column, setColumn] = useState<HTMLElement | null>(null);
  return (
    <div className="probe-host">
      {(claims.shared || claims.own) && <button type="button" className="probe-inspector-button">Inspector</button>}
      <div className="probe-canvas">
        <inspector.WorkbenchInspectorProvider open={open} column={column} onClaimsChange={(c) => { log.push(c); setClaims(c); }}>
          {children}
        </inspector.WorkbenchInspectorProvider>
      </div>
      {open && claims.shared && (
        <aside className="mbc-right-controls">
          <div className="mbc-accordion-scroll mbc-inspector-sections" ref={setColumn} />
        </aside>
      )}
    </div>
  );
}

interface Tree {
  app: AppHarness;
  inspector: Inspector;
  root: LiveElement;
  render(node: ReactNode): Promise<void>;
  /** Whether the host draws its inspector button. */
  button(): boolean;
  /** The host's column body, or null. */
  column(): LiveElement | null;
}
/** Mounts test trees with React DOM's client renderer in the live window of a launched App (the US-01M6TB6G harness). */
async function withTree(run: (tree: Tree) => Promise<void>) {
  await withApp({}, async (app) => {
    const inspector = await import('../components/WorkbenchInspector');
    const { createRoot } = await import('react-dom/client');
    const root = app.doc.createElement('div');
    root.setAttribute('class', 'probe-root');
    app.doc.body.appendChild(root);
    const reactRoot = createRoot(root as unknown as Element);
    const tree: Tree = {
      app, inspector, root,
      render: async (node) => { await act(async () => { reactRoot.render(node); }); await app.settle(); },
      button: () => root.querySelectorAll('.probe-inspector-button').length === 1,
      column: () => root.querySelectorAll('.mbc-inspector-sections')[0] ?? null,
    };
    try {
      await run(tree);
    } finally {
      await act(async () => { reactRoot.unmount(); });
      root.remove();
    }
  });
}
const headerOf = (section: LiveElement) => section.querySelectorAll('button.mbc-accordion-header')[0];
const chevron = (section: LiveElement) => headerOf(section).querySelectorAll('svg')[0]?.getAttribute('class') ?? '';

/** Whether React drew `el` inside WorkbenchInspectorProvider: its fiber has the provider's context above it. */
function insideProvider(el: LiveElement, inspector: Inspector): boolean {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!key) throw new Error(`<${el.localName}> carries no React fiber: React DOM did not draw it`);
  type Fiber = { return: Fiber | null; type?: { _context?: unknown } | null };
  for (let f: Fiber | null = (el as unknown as Record<string, Fiber>)[key]; f; f = f.return) {
    if (f.type && typeof f.type === 'object' && f.type._context === inspector.WorkbenchInspectorContext) return true;
  }
  return false;
}

// ─── AC1 ───

describe('the per-tab button (AC1)', () => {
  it('shows the inspector button only on a tab that has settings', async () => {
    await withApp({}, async (app) => {
      // A sequence record's Sequence tab: the button, the column and its resizer.
      await sequenceOf(app);
      expect(shown(app)).toEqual(SEQUENCE_OPEN);
      expect(app.header().querySelectorAll('.mbc-viewer-zoom-controls button').map(label).filter(Boolean).pop(), 'the button is the zoom controls\' last').toBe('Hide Sequence View Controls Inspector');

      // The tabs with nothing to set draw no button and no column, while the inspector stays open.
      for (const tab of ['annotations-table', 'document-info'] as const) {
        await app.clickTab(tab);
        expect(shown(app), tab).toEqual(NONE);
        expect(app.all('[aria-label$=" Inspector"]'), `${tab}: no inspector control anywhere, disabled or not`).toHaveLength(0);
      }
      await app.clickTab('sequence-view');
      await app.menu('tools:vectors');
      expect(app.activeTab()).toBe('vector-library');
      expect(shown(app), 'Vectors').toEqual(NONE);
      await pipelines(app, null);
      expect(shown(app), 'Pipelines').toEqual(NONE);
      await app.clickTab('sequence-view');
      expect(shown(app), 'the Sequence tab shows it again, open as it was left').toEqual(SEQUENCE_OPEN);
    });

    // A contig summary's Sequence tab drew the button, which did nothing: now it has none, and no column.
    await withApp({}, async (app) => {
      await sequenceOf(app, CONTIG, PLASMID);
      expect(app.canvas().querySelectorAll('.mbc-summary-view [aria-label="Contig Summary Notice"]'), 'the contig summary view is drawn').toHaveLength(1);
      expect(shown(app)).toEqual(NONE);
      expect(app.header().querySelectorAll('.mbc-viewer-zoom-controls').length, 'its zoom controls stay').toBe(1);
      expect(app.all('[aria-label$=" Inspector"]'), 'no inspector control, disabled or not').toHaveLength(0);
      expect(gridTracks(cascaded(app.bodySplit(), 'grid-template-columns', { window: 1280 })!), 'the body split draws one column').toEqual(['minmax(0, 1fr)']);
    });
  });
});

// ─── AC2 ───

describe('no jump to the Sequence tab (AC2)', () => {
  it('leaves the tab and the open state alone on a tab without settings', async () => {
    await withApp({}, async (app) => {
      await sequenceOf(app);
      const NOTICE = 'Inspector: this view has no settings to show.';
      // Each route, tried alone from the Info tab, then the Sequence tab read: open, then closed.
      const routes: [string, () => Promise<void>][] = [
        ['View > Toggle Inspector (the button\'s command)', () => app.menu('view:toggle-inspector')],
        ['Ctrl+Alt+I', () => app.press('i', { mod: true, alt: true })],
        ['View > Panels > Inspector', async () => {
          const row = await viewInspectorRow(app);
          await app.click(row);
          await closeMenus(app, menubar(app, 'View'));
        }],
      ];
      for (const [left, expected] of [['open', SEQUENCE_OPEN], ['closed', SEQUENCE_CLOSED]] as const) {
        if (left === 'closed') await app.press('i', { mod: true, alt: true });
        expect(shown(app), `left ${left}`).toEqual(expected);
        for (const [route, run] of routes) {
          await app.clickTab('document-info');
          await run();
          expect(app.activeTab(), `${route}, left ${left}: the Info tab stays open`).toBe('document-info');
          expect(shown(app), `${route}: still no inspector on Info`).toEqual(NONE);
          await app.clickTab('sequence-view');
          expect(shown(app), `${route}: the Sequence inspector is ${left}, as it was left`).toEqual(expected);
        }
      }
      // The shortcut and the native command say why they did nothing.
      await app.clickTab('document-info');
      await app.press('i', { mod: true, alt: true });
      expect(app.doc.body.textContent).toContain(NOTICE);
    });
  });
});

// ─── AC3 ───

describe('the View menu item (AC3)', () => {
  it('names the View menu item Inspector, checked only while one is shown, with its own Function Info', async () => {
    const TEXT = "Show or hide the right-hand inspector that holds the active task window's settings";
    await withApp({}, async (app) => {
      await sequenceOf(app);
      const view = menubar(app, 'View');
      let row = await viewInspectorRow(app);
      const panels = app.all('button.desktop-menu-row').filter((b) => b.parentElement === row.parentElement).map((b) => b.querySelectorAll('.desktop-menu-label')[0]?.textContent.trim());
      expect(panels, 'View > Panels').toEqual(['Project Sidebar', 'Document Table', 'Inspector']);
      expect(menuRows(app, 'Sequence Inspector'), 'no Sequence Inspector item').toHaveLength(0);
      const read = (r: LiveElement) => ({ checked: r.getAttribute('aria-checked'), disabled: r.hasAttribute('disabled'), kbd: r.querySelectorAll('kbd')[0]?.textContent, keys: r.getAttribute('aria-keyshortcuts') });
      expect(read(row), 'shown on the Sequence tab').toEqual({ checked: 'true', disabled: false, kbd: 'Ctrl+Alt+I', keys: 'Control+Alt+I' });

      // Its Function Info, as the menu shows it on hover.
      await act(async () => { dispatchLiveEvent(row, 'pointerover', { pointerId: 1, pointerType: 'mouse', isPrimary: true }); });
      await app.settle();
      expect(app.all('[role="tooltip"]').map((t) => t.textContent.trim()), 'the Function Info shown').toEqual([TEXT]);
      expect(resolveMenuNodeFunctionDescription('view-tog-inspector', 'Inspector'), 'its own entry, not the fallback').toBe(TEXT);
      expect(resolveMenuNodeFunctionDescription('view-tog-inspector', 'Sequence Inspector'), 'the Sequence Inspector entry is gone').toBe('Run Sequence Inspector in the active MolBioCraft workbench session');

      // Chosen, it hides the inspector, and reads unchecked.
      await app.click(row);
      expect(shown(app)).toEqual(SEQUENCE_CLOSED);
      row = await viewInspectorRow(app);
      expect(read(row), 'hidden on the Sequence tab').toEqual({ checked: 'false', disabled: false, kbd: 'Ctrl+Alt+I', keys: 'Control+Alt+I' });
      await app.click(row);
      expect(shown(app), 'chosen again, it shows it').toEqual(SEQUENCE_OPEN);

      // On a tab with nothing to set it is greyed and unchecked, though the inspector is open.
      await app.clickTab('document-info');
      row = await viewInspectorRow(app);
      expect(read(row), 'on Info').toEqual({ checked: 'false', disabled: true, kbd: 'Ctrl+Alt+I', keys: 'Control+Alt+I' });
      await closeMenus(app, view);
    });
    // On a contig summary's Sequence tab too.
    await withApp({}, async (app) => {
      await sequenceOf(app, CONTIG);
      const row = await viewInspectorRow(app);
      expect([row.getAttribute('aria-checked'), row.hasAttribute('disabled')]).toEqual(['false', true]);
    });
  });
});

// ─── AC4 ───

describe('the shortcut and the labels (AC4)', () => {
  it('toggles the inspector once per shortcut press, with labels that follow the tab', async () => {
    await withApp({}, async (app) => {
      await sequenceOf(app);
      const button = () => app.inspectorButton()!;
      expect([button().getAttribute('aria-keyshortcuts'), button().getAttribute('title')]).toEqual(['Control+Alt+I', 'Hide Sequence View Controls Inspector (Ctrl+Alt+I)']);
      // One press, one toggle (a second handler for the same press would undo it).
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'one press hides it').toEqual(SEQUENCE_CLOSED);
      expect(button().getAttribute('aria-keyshortcuts'), 'the shortcut is still announced').toBe('Control+Alt+I');
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'one press shows it').toEqual(SEQUENCE_OPEN);

      // Not in a text field: the press is the field's.
      const field = app.one('#mbc-toolbar-global-search-input', 'the global search field');
      field.focus();
      expect(app.doc.activeElement === field, 'the field has focus').toBe(true);
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'unchanged from a text field').toEqual(SEQUENCE_OPEN);
      field.blur();

      // Not behind an open dialog.
      await app.menu('help:shortcuts');
      const dialogs = () => app.all('dialog[open], .mbc-modal-backdrop');
      expect(dialogs().length, 'a dialog is open').toBeGreaterThan(0);
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'unchanged behind the dialog').toEqual(SEQUENCE_OPEN);
      await app.click(app.one('[aria-label="Close window"]', 'the dialog\'s close button'));
      expect(dialogs(), 'the dialog closed').toHaveLength(0);
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'with it closed, the press works again').toEqual(SEQUENCE_CLOSED);
      await app.press('i', { mod: true, alt: true });

      // A tab with settings other than Sequence: the labels follow it, and one press toggles once.
      await pipelines(app, 'many');
      const PIPELINES_OPEN = { button: 'Hide Pipelines Controls Inspector', aside: true, hidden: false, resizer: 'Resize Pipelines Controls inspector', title: 'Pipelines Controls' };
      expect(shown(app)).toEqual(PIPELINES_OPEN);
      expect(button().getAttribute('title')).toBe('Hide Pipelines Controls Inspector (Ctrl+Alt+I)');
      expect(app.header().querySelectorAll('.mbc-viewer-zoom-controls > *').map(label), 'the zoom controls hold only the button off the Sequence tab').toEqual(['Hide Pipelines Controls Inspector']);
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'one press hides it').toEqual({ button: 'Show Pipelines Controls Inspector', aside: false, hidden: true, resizer: null, title: null });
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'one press shows it').toEqual(PIPELINES_OPEN);
      // A studio that draws its own panel: the button names the tab, and App draws no column.
      await pipelines(app, 'own');
      expect(shown(app)).toEqual({ button: 'Hide Pipelines Controls Inspector', aside: false, hidden: true, resizer: null, title: null });
      await app.press('i', { mod: true, alt: true });
      expect(label(app.inspectorButton())).toBe('Show Pipelines Controls Inspector');
      await app.press('i', { mod: true, alt: true });
      expect(label(app.inspectorButton())).toBe('Hide Pipelines Controls Inspector');
    });

    // The macOS host: the native menu's ⌥⌘I accelerator is the shortcut. It sends Toggle Inspector,
    // and the page leaves the key alone, so one press toggles once there too.
    await withApp(macHost(), async (app) => {
      await sequenceOf(app);
      expect([app.inspectorButton()!.getAttribute('aria-keyshortcuts'), app.inspectorButton()!.getAttribute('title')]).toEqual(['Alt+Meta+I', 'Hide Sequence View Controls Inspector (⌥⌘I)']);
      await app.press('i', { mod: true, alt: true });
      expect(shown(app), 'the page does not act on the key itself').toEqual(SEQUENCE_OPEN);
      await app.menu('view:toggle-inspector');
      expect(shown(app), 'the accelerator\'s command hides it').toEqual(SEQUENCE_CLOSED);
      await app.menu('view:toggle-inspector');
      expect(shown(app), 'and shows it').toEqual(SEQUENCE_OPEN);
    });
  });
});

// ─── AC5 ───

describe('the native macOS menu (AC5)', () => {
  it('sends the native menu a greyed Toggle Inspector on a tab without settings', async () => {
    await withApp(macHost(), async (app) => {
      const last = () => app.nativeMenuStates().at(-1)!;
      const toggle = () => ({ override: last().overrides['view:toggle-inspector'], enabled: resolveNativeMenuItemEnabled('view:toggle-inspector', last()) });
      expect(last().sessionActive, 'no session at launch').toBe(false);
      expect(resolveNativeMenuItemEnabled('view:toggle-inspector', last()), 'greyed without a session').toBe(false);

      await app.restoreSession({ documents: [PLASMID, CONTIG], activeDocId: PLASMID.id, viewerTab: 'document-info' });
      expect(last().sessionActive).toBe(true);
      expect(toggle(), 'Info, in an active session').toEqual({ override: false, enabled: false });
      await app.clickTab('sequence-view');
      expect(toggle(), 'Sequence').toEqual({ override: true, enabled: true });
      // The item keeps its id: the native command reaches the dispatcher and toggles the inspector.
      await app.menu('view:toggle-inspector');
      expect(shown(app)).toEqual(SEQUENCE_CLOSED);
      await app.menu('view:toggle-inspector');
      expect(shown(app)).toEqual(SEQUENCE_OPEN);
      await app.clickTab('annotations-table');
      expect(toggle(), 'Annotations').toEqual({ override: false, enabled: false });
      // A studio's claim makes it available on its tab.
      await pipelines(app, 'many');
      expect(toggle(), 'a tab whose studio has settings').toEqual({ override: true, enabled: true });
    });
    await withApp(macHost(), async (app) => {
      await sequenceOf(app, CONTIG);
      expect(app.nativeMenuStates().at(-1)!.overrides['view:toggle-inspector'], 'a contig summary\'s Sequence tab').toBe(false);
    });
  });
});

// ─── AC6 ───

describe('the section contract (AC6)', () => {
  it('renders a section into the shared column, nothing while closed, and its children as passed without a workbench', async () => {
    await withTree(async ({ inspector, root, render, button, column }) => {
      const { InspectorSection } = inspector;
      const log: InspectorClaims[] = [];
      const renders = { count: 0 };
      const section = (title: string, body: ReactNode, more: { open?: boolean; onOpenChange?: (o: boolean) => void } = {}) => (
        <InspectorSection title={title} order={1} {...more}>{body}</InspectorSection>
      );
      const tree = (open: boolean, child: ReactNode) => (
        <StrictMode><Host inspector={inspector} open={open} log={log} renders={renders}>{child}</Host></StrictMode>
      );
      // StrictMode mounts the section twice: it is counted once and drawn once, in the column.
      await render(tree(true, section('Probe Alpha', <span className="probe-child">alpha</span>)));
      expect(log, 'one claim reported').toEqual([{ shared: true, own: false }]);
      const sections = () => column()?.querySelectorAll('.mbc-accordion-section') ?? [];
      expect(sections(), 'one section in the column').toHaveLength(1);
      const [s] = sections();
      expect([headerOf(s).textContent.trim(), headerOf(s).getAttribute('aria-expanded'), chevron(s)]).toEqual(['Probe Alpha', 'true', expect.stringContaining('lucide-chevron-down')]);
      expect(s.querySelectorAll('.mbc-accordion-body .probe-child'), 'its children in its body').toHaveLength(1);
      expect(root.querySelectorAll('.probe-canvas .probe-child'), 'nothing where the studio sits').toHaveLength(0);
      // Its header folds and unfolds it.
      const clickHeader = () => act(async () => { dispatchLiveEvent(headerOf(sections()[0]), 'click', { detail: 1 }); });
      await clickHeader();
      expect([headerOf(sections()[0]).getAttribute('aria-expanded'), chevron(sections()[0]), sections()[0].querySelectorAll('.probe-child').length], 'folded').toEqual(['false', expect.stringContaining('lucide-chevron-right'), 0]);
      await clickHeader();
      expect([headerOf(sections()[0]).getAttribute('aria-expanded'), chevron(sections()[0]), sections()[0].querySelectorAll('.probe-child').length], 'unfolded').toEqual(['true', expect.stringContaining('lucide-chevron-down'), 1]);

      // Closed: nothing drawn anywhere, and the claim (so the button) kept.
      await render(tree(false, section('Probe Alpha', <span className="probe-child">alpha</span>)));
      expect([button(), column() !== null, root.querySelectorAll('.probe-child').length, root.querySelectorAll('.mbc-accordion-section').length]).toEqual([true, false, 0, 0]);
      expect(log, 'closing reports nothing').toHaveLength(1);
      await render(tree(true, section('Probe Alpha', <span className="probe-child">alpha</span>)));
      expect(sections(), 'open again: drawn again').toHaveLength(1);

      // A studio that keeps the section's fold state: open and onOpenChange.
      const asked: boolean[] = [];
      await render(tree(true, section('Probe Alpha', <span className="probe-child">alpha</span>, { open: false, onOpenChange: (o) => asked.push(o) })));
      expect(headerOf(sections()[0]).getAttribute('aria-expanded'), 'folded by the studio').toBe('false');
      await act(async () => { dispatchLiveEvent(headerOf(sections()[0]), 'click', { detail: 1 }); });
      expect([asked, headerOf(sections()[0]).getAttribute('aria-expanded')], 'asked to unfold; still the studio\'s').toEqual([[true], 'false']);

      // Unmounted, it is released: counted once under StrictMode, so the claims reach none.
      await render(tree(true, null));
      expect(log, 'the release reported').toEqual([{ shared: true, own: false }, { shared: false, own: false }]);
      expect([button(), column() !== null]).toEqual([false, false]);

      // No provider: its children exactly as passed, with no header and no wrapper.
      const bare = (child: ReactNode) => <div className="probe-bare">{child}</div>;
      const children = <><span className="probe-child">alpha</span>beta<em>gamma</em></>;
      await render(bare(children));
      const asPassed = root.innerHTML;
      await render(bare(<StrictMode><InspectorSection title="Probe Alpha" order={1}>{children}</InspectorSection></StrictMode>));
      expect(root.innerHTML, 'the same markup as the children alone').toBe(asPassed);
      expect(root.querySelectorAll('.probe-bare > *').map((e) => e.localName)).toEqual(['span', 'em']);
    });
    // App's half: on a tab whose studio has a section, App draws it in its own column.
    await withApp({}, async (app) => {
      await sequenceOf(app);
      await pipelines(app, 'one');
      const aside = app.inspectorAside()!;
      expect(aside.querySelectorAll('.mbc-inspector-sections > .mbc-accordion-section button.mbc-accordion-header').map((b) => b.textContent.trim())).toEqual(['Probe Alpha']);
      expect(app.canvas().querySelectorAll('.mbc-accordion-section, [aria-label="Probe alpha value"]'), 'none of it in the canvas').toHaveLength(0);
    });
  });
});

// ─── AC7 ───

describe('the own-panel and in-workbench contract (AC7)', () => {
  it('registers an own inspector only while it is active', async () => {
    await withTree(async ({ inspector, root, render, button, column }) => {
      function Own({ active }: { active: boolean }) {
        const draw = inspector.useOwnInspector(active);
        return <div className="probe-own" data-draw={String(draw)} data-in-workbench={String(inspector.useInWorkbench())} />;
      }
      const log: InspectorClaims[] = [];
      const renders = { count: 0 };
      const own = () => {
        const el = root.querySelectorAll('.probe-own')[0];
        return { draw: el.getAttribute('data-draw'), inWorkbench: el.getAttribute('data-in-workbench'), button: button(), column: column() !== null };
      };
      const tree = (open: boolean, active: boolean) => <StrictMode><Host inspector={inspector} open={open} log={log} renders={renders}><Own active={active} /></Host></StrictMode>;

      await render(tree(true, false));
      expect([own(), log], 'inactive: no claim').toEqual([{ draw: 'true', inWorkbench: 'true', button: false, column: false }, []]);
      await render(tree(true, true));
      expect([own(), log], 'active: an own claim, the button and no column').toEqual([{ draw: 'true', inWorkbench: 'true', button: true, column: false }, [{ shared: false, own: true }]]);
      await render(tree(false, true));
      expect([own(), log.length], 'closed: the studio draws no panel, the button stays').toEqual([{ draw: 'false', inWorkbench: 'true', button: true, column: false }, 1]);
      await render(tree(false, false));
      expect([own(), log.at(-1)], 'inactive again: released').toEqual([{ draw: 'false', inWorkbench: 'true', button: false, column: false }, { shared: false, own: false }]);

      // Outside the workbench: draw the panel, open or not, and claim nothing.
      await render(<StrictMode><Own active /></StrictMode>);
      expect(own()).toEqual({ draw: 'true', inWorkbench: 'false', button: false, column: false });
    });
    // App's half: an own claim shows the button and draws no column; the toggle opens and closes the studio's panel.
    await withApp({}, async (app) => {
      await sequenceOf(app);
      await pipelines(app, 'own');
      const panel = () => app.canvas().querySelectorAll('.probe-own-panel').length;
      expect([shown(app), panel()]).toEqual([{ button: 'Hide Pipelines Controls Inspector', aside: false, hidden: true, resizer: null, title: null }, 1]);
      await app.click(app.inspectorButton()!);
      expect([label(app.inspectorButton()), app.inspectorAside() !== null, panel()]).toEqual(['Show Pipelines Controls Inspector', false, 0]);
      await app.click(app.inspectorButton()!);
      expect(panel(), 'opened again').toBe(1);
    });
  });
});

// ─── AC8 ───

describe('availability under sub-tab swaps (AC8)', () => {
  it('keeps the button through a swap of one section for another', async () => {
    await withTree(async ({ inspector, root, render, button, column }) => {
      function Swapper() {
        const [beta, setBeta] = useState(false);
        return (
          <>
            <button type="button" className="probe-swap" onClick={() => setBeta((b) => !b)}>Swap</button>
            {beta
              ? <inspector.InspectorSection key="beta" title="Probe Beta" order={1}>beta</inspector.InspectorSection>
              : <inspector.InspectorSection key="alpha" title="Probe Alpha" order={1}>alpha</inspector.InspectorSection>}
          </>
        );
      }
      const log: InspectorClaims[] = [];
      const renders = { count: 0 };
      await render(<Host inspector={inspector} open log={log} renders={renders}><Swapper /></Host>);
      expect(log).toEqual([{ shared: true, own: false }]);
      const hostButton = root.querySelectorAll('.probe-inspector-button')[0];
      const before = renders.count;
      const titles = () => column()!.querySelectorAll('button.mbc-accordion-header').map((b) => b.textContent.trim());
      expect(titles()).toEqual(['Probe Alpha']);
      // One click unmounts Alpha and mounts Beta in one commit: no crossing is reported and the host
      // does not re-render, so its button is the same node throughout.
      const swap = root.querySelectorAll('.probe-swap')[0];
      await act(async () => { dispatchLiveEvent(swap, 'click', { detail: 1 }); });
      await act(async () => { await Promise.resolve(); });
      expect([log.length, renders.count - before, titles()], 'Alpha for Beta').toEqual([1, 0, ['Probe Beta']]);
      await act(async () => { dispatchLiveEvent(swap, 'click', { detail: 1 }); });
      await act(async () => { await Promise.resolve(); });
      expect([log.length, renders.count - before, titles()], 'and back').toEqual([1, 0, ['Probe Alpha']]);
      expect(root.querySelectorAll('.probe-inspector-button')[0] === hostButton, 'the button node never left').toBe(true);
      // Removing the last section is a crossing, told once.
      await render(<Host inspector={inspector} open log={log} renders={renders} />);
      expect([log, button()]).toEqual([[{ shared: true, own: false }, { shared: false, own: false }], false]);
    });
    // App's half: the header button stays the same node through the probe studio's swap.
    await withApp({}, async (app) => {
      await sequenceOf(app);
      await pipelines(app, 'one');
      const b = app.inspectorButton()!;
      const states = app.nativeMenuStates();
      await app.click(app.one('.probe-swap'));
      expect(app.inspectorButton() === b, 'the same button node').toBe(true);
      expect(app.inspectorAside()!.querySelectorAll('button.mbc-accordion-header').map((h) => h.textContent.trim())).toEqual(['Probe Beta']);
      expect(app.nativeMenuStates(), 'nothing to send off macOS').toEqual(states);
    });
  });
});

// ─── AC9 ───

describe('the column layout and form grids (AC9)', () => {
  it('orders sections and lays out moved form grids one field per row in the inspector', async () => {
    const autoFitTracks = (width: number, min: number, gap: number) => Math.max(1, Math.floor((width + gap) / (min + gap)));
    await withTree(async ({ inspector, root, render, column }) => {
      const { InspectorSection } = inspector;
      const log: InspectorClaims[] = [];
      const grid = (cls: string) => <div className={cls}><label>A<input type="text" /></label><label>B<input type="text" /></label><label>C<input type="text" /></label></div>;
      await render(
        <Host inspector={inspector} open log={log} renders={{ count: 0 }}>
          <InspectorSection title="Probe Third" order={3}>{grid('form-grid-3col')}</InspectorSection>
          <InspectorSection title="Probe First" order={1}>{grid('form-grid-2col')}</InspectorSection>
          <InspectorSection title="Probe Second" order={2}>second</InspectorSection>
          {grid('form-grid-2col')}
        </Host>,
      );
      const body = column()!;
      const sections = body.querySelectorAll('.mbc-accordion-section');
      expect(sections.map((s) => headerOf(s).textContent.trim()), 'mounted in this order').toEqual(['Probe Third', 'Probe First', 'Probe Second']);
      for (const w of [1100, 1280, 1920]) {
        expect([cascaded(body, 'display', { window: w }), cascaded(body, 'flex-direction', { window: w })], `the body is a flex column at ${w}px`).toEqual(['flex', 'column']);
        expect(sections.map((s) => cascaded(s, 'order', { window: w })), 'each in its CSS order').toEqual(['3', '1', '2']);
        for (const cls of ['form-grid-2col', 'form-grid-3col']) {
          const inColumn = body.querySelectorAll(`.${cls}`)[0];
          expect(gridTracks(cascaded(inColumn, 'grid-template-columns', { window: w })!), `${cls} in the inspector at ${w}px`).toEqual(['minmax(0, 1fr)']);
        }
      }
      // The same grid where the studio sits keeps its auto-fit tracks, which would set two fields
      // side by side across the widest inspector's body (520px less 8px padding each side).
      const outside = root.querySelectorAll('.probe-canvas > .form-grid-2col')[0];
      expect(cascaded(outside, 'grid-template-columns', { window: 1280 })).toBe('repeat(auto-fit, minmax(min(100%, 220px), 1fr))');
      expect([autoFitTracks(520 - 16, 220, 6), autoFitTracks(520 - 16, 190, 8), autoFitTracks(232 - 16, 220, 6)], 'auto-fit tracks at the widest and narrowest inspector').toEqual([2, 2, 1]);
    });
    // App's column: the body App draws for the sections is that flex column, and the moved grids are one track.
    await withApp({}, async (app) => {
      await sequenceOf(app);
      // The Sequence accordion's body is not a flex column: the shared body's rule is its own.
      expect(cascaded(app.inspectorAside()!.querySelectorAll('.mbc-accordion-scroll')[0], 'display', { window: 1280 }), 'the Sequence accordion body').toBeUndefined();
      await pipelines(app, 'many');
      const body = app.one('aside.mbc-right-controls > .mbc-accordion-scroll.mbc-inspector-sections', 'App\'s shared column body');
      expect([cascaded(body, 'display', { window: 1280 }), cascaded(body, 'flex-direction', { window: 1280 })]).toEqual(['flex', 'column']);
      expect(body.querySelectorAll('.mbc-accordion-section').map((s) => [headerOf(s).textContent.trim(), cascaded(s, 'order', { window: 1280 })])).toEqual([['Probe Third', '3'], ['Probe First', '1'], ['Probe Second', '2']]);
      for (const cls of ['form-grid-2col', 'form-grid-3col']) {
        expect(gridTracks(cascaded(body.querySelectorAll(`.${cls}`)[0], 'grid-template-columns', { window: 1280 })!), cls).toEqual(['minmax(0, 1fr)']);
      }
    });
  });
});

// ─── AC10 ───

describe('the width and its key (AC10)', () => {
  it('keeps one inspector width, stored as before', async () => {
    const KEY = 'molbiocraft.workspace.layout.v1';
    const storage = memoryStorage();
    const stored = () => JSON.parse(storage.getItem(KEY) ?? '{}').inspectorWidthPx;
    await withApp({ storage }, async (app) => {
      await sequenceOf(app);
      const r = resizer(app);
      expect([r.getAttribute('aria-valuemin'), r.getAttribute('aria-valuemax'), widthNow(app)], 'its bounds and default').toEqual(['232', '520', 288]);
      const press = async (key: string, times = 1) => { for (let i = 0; i < times; i++) { resizer(app).focus(); await app.press(key); } };
      const inline = () => app.bodySplit().style.getPropertyValue('--mbc-inspector-width');
      await press('ArrowLeft');
      expect([widthNow(app), inline()], 'Left widens it 16px').toEqual([304, '304px']);
      await press('ArrowRight', 2);
      expect(widthNow(app), 'Right narrows it 16px a press').toBe(272);
      await press('Home');
      expect(widthNow(app), 'Home resets it').toBe(288);
      await press('ArrowLeft', 16);
      expect(widthNow(app), 'never past 520px').toBe(520);
      await press('ArrowRight', 20);
      expect(widthNow(app), 'never below 232px').toBe(232);
      await act(async () => { dispatchLiveEvent(resizer(app), 'dblclick', { detail: 2 }); });
      await app.settle();
      expect(widthNow(app), 'a double-click resets it').toBe(288);
      await press('ArrowLeft', 3);
      expect([widthNow(app), stored()], 'stored under its key').toEqual([336, 336]);

      // One width for every shared inspector: a studio's column on another tab takes it, and a change there is the Sequence tab's.
      await pipelines(app, 'many');
      expect([widthNow(app), inline(), label(resizer(app))]).toEqual([336, '336px', 'Resize Pipelines Controls inspector']);
      await press('ArrowRight');
      await app.clickTab('sequence-view');
      expect([widthNow(app), stored()], 'the Sequence tab has the width set on Pipelines').toEqual([320, 320]);
    });
    // The next launch restores it, clamped to the bounds.
    for (const [saved, restored] of [[320, 320], [999, 520], [100, 232], ['wide', 288]] as const) {
      const next = memoryStorage({ [KEY]: JSON.stringify({ ...JSON.parse(storage.getItem(KEY)!), inspectorWidthPx: saved }) });
      await withApp({ storage: next }, async (app) => {
        await sequenceOf(app);
        expect(widthNow(app), `saved ${saved}`).toBe(restored);
        expect(app.bodySplit().style.getPropertyValue('--mbc-inspector-width')).toBe(`${restored}px`);
      });
    }
  });
});

// ─── AC11 ───

describe('the stacked and side-by-side layouts and the table fold (AC11)', () => {
  it('keeps the inspector column across the stacked and side-by-side layouts and a table fold', async () => {
    await withApp({}, async (app) => {
      await sequenceOf(app);
      // A setting changed and a width set, then the layouts switched and the table folded and opened.
      await app.click(sectionHeader(app, 'ORFs'));
      const range = app.inspectorAside()!.querySelectorAll('input[type="range"]')[0];
      await app.change(range, '150');
      resizer(app).focus();
      await app.press('ArrowLeft');
      const aside = app.inspectorAside()!;
      const minimum = () => aside.querySelectorAll('.mbc-control-row span').map((s) => s.textContent).find((t) => t.startsWith('Minimum ORF Size'));
      const kept = (what: string) => {
        // Nodes compared by identity, as booleans (a failed diff of two live elements is unprintably large).
        expect([app.inspectorAside() === aside, aside.querySelectorAll('input[type="range"]')[0] === range], `${what}: the same column and field nodes`).toEqual([true, true]);
        expect([shown(app), widthNow(app), minimum()], what).toEqual([SEQUENCE_OPEN, 304, 'Minimum ORF Size: 150 aa']);
      };
      const steps = ['view:split-top-bottom', 'view:toggle-doctable', 'view:toggle-doctable', 'view:split-left-right', 'view:toggle-doctable', 'view:toggle-doctable', 'view:split-top-bottom'];
      const layouts = new Set<string>();
      let mode = '';
      for (const id of steps) {
        await app.menu(id);
        if (id.startsWith('view:split-')) mode = id === 'view:split-top-bottom' ? 'stacked' : 'side by side';
        const folded = app.one('.mbc-doc-table-pane').classList.contains('collapsed');
        const stack = app.one('.mbc-center-stack').classList;
        // The centre stack says which layout an open table is in (a folded table is a bar in either).
        if (!folded) expect([stack.contains('table-below'), stack.contains('split-left-right')], `${id}: ${mode}`).toEqual([mode === 'stacked', mode === 'side by side']);
        layouts.add(`${mode}${folded ? ', folded' : ''}`);
        kept(id);
      }
      expect(layouts, 'every layout was reached').toEqual(new Set(['stacked', 'side by side', 'stacked, folded', 'side by side, folded']));
      // Closed, it stays closed through the same switches.
      await app.press('i', { mod: true, alt: true });
      for (const id of steps) {
        await app.menu(id);
        expect(shown(app), `${id}: still closed`).toEqual(SEQUENCE_CLOSED);
      }
    });
    // A studio's column: its node, and a value typed into a section, survive the same switches.
    await withApp({}, async (app) => {
      await sequenceOf(app);
      await pipelines(app, 'one');
      const body = app.one('.mbc-inspector-sections');
      const field = app.one('[aria-label="Probe alpha value"]');
      await app.input(field, 'kept value');
      for (const id of ['view:split-left-right', 'view:toggle-doctable', 'view:split-top-bottom', 'view:toggle-doctable']) {
        await app.menu(id);
        expect([app.one('.mbc-inspector-sections') === body, app.one('[aria-label="Probe alpha value"]') === field, field.value], id).toEqual([true, true, 'kept value']);
      }
    });
  });
});

// ─── AC12 ───

describe('split view (AC12)', () => {
  it('keeps the inspector beside both panes in split view', async () => {
    await withApp({}, async (app) => {
      await app.restoreSession({ documents: [PLASMID, INSERT], activeDocId: PLASMID.id, viewerTab: 'sequence-view' });
      await app.click(app.one('button.mbc-split-toggle'));
      const pane = app.one('section.mbc-split-pane', 'the split view pane');
      const choice = pane.querySelectorAll('select')[0];
      if (choice.value !== INSERT.id) await app.change(choice, INSERT.id);
      expect(pane.querySelectorAll('select')[0].value, 'the insert beside the plasmid').toBe(INSERT.id);
      // Both panes in the split host, then the resizer and the inspector, right of both.
      const split = app.bodySplit();
      expect(split.children.map((c) => `${c.localName}.${c.getAttribute('class')?.trim().split(/\s+/)[0]}`)).toEqual(['div.mbc-split-host', 'div.mbc-inspector-resizer', 'aside.mbc-right-controls']);
      const host = split.children[0];
      expect([host.classList.contains('is-split'), host.contains(app.canvas()), host.contains(pane), host.contains(app.inspectorAside()!)]).toEqual([true, true, true, false]);
      expect(gridTracks(cascaded(split, 'grid-template-columns', { window: 1280 })!)).toHaveLength(3);
      expect(shown(app)).toEqual(SEQUENCE_OPEN);
      // The main document's settings only: its length, not the insert's.
      await app.click(sectionHeader(app, 'Sequence Statistics'));
      const length = app.inspectorAside()!.querySelectorAll('.stat-kv').find((kv) => kv.textContent.startsWith('Length:'))!.textContent;
      expect(length).toBe('Length:3,000 bp');
      // The provider holds the main view's content alone: not the split pane, the header or the column.
      const inspector = await import('../components/WorkbenchInspector');
      const mainContent = app.canvas().children[0];
      expect([insideProvider(mainContent, inspector), insideProvider(pane, inspector), insideProvider(app.inspectorButton()!, inspector), insideProvider(app.inspectorAside()!, inspector)]).toEqual([true, false, false, false]);
    });
  });
});

// ─── AC13 ───

describe('the narrow-window rules (AC13)', () => {
  it('keeps the inspector beside the viewer at the 1100px minimum window', async () => {
    await withApp({ width: 1100, height: 800 }, async (app) => {
      await sequenceOf(app);
      resizer(app).focus();
      for (let i = 0; i < 7; i++) await app.press('ArrowLeft');
      expect(widthNow(app), 'set to 400px').toBe(400);
      const read = (what: string) => {
        const split = app.bodySplit();
        const view = { window: 1100, height: 800 };
        expect([cascaded(split, 'display', view), gridTracks(cascaded(split, 'grid-template-columns', view)!), cascaded(split, '--mbc-inspector-width', view)], `${what}: three tracks, the last the set width`).toEqual(['grid', ['minmax(0, 1fr)', '5px', 'var(--mbc-inspector-width, 288px)'], '400px']);
        for (const prop of ['grid-template-rows', 'grid-template-areas', 'grid-auto-flow']) expect(cascaded(split, prop, view), `${what}: no ${prop} stacks it`).toBeUndefined();
        expect(split.children.map((c) => c.localName), `${what}: viewer, resizer, column`).toEqual(['div', 'div', 'aside']);
        for (const el of [split.children[1], split.children[2]]) {
          const name = el.getAttribute('class');
          expect(['none', 'contents'], `${what}: ${name} is drawn`).not.toContain(cascaded(el, 'display', view));
          expect(['absolute', 'fixed'], `${what}: ${name} stays in the grid's flow`).not.toContain(cascaded(el, 'position', view));
          for (const prop of ['visibility', 'grid-column', 'grid-row', 'grid-area']) expect(cascaded(el, prop, view), `${what}: no ${prop} on ${name}`).toBeUndefined();
        }
      };
      read('Sequence');
      // A studio's column, at the same width.
      await pipelines(app, 'many');
      read('Pipelines');
    });
  });
});

// ─── AC14 ───

describe('the commands that open a Sequence section (AC14)', () => {
  it('still opens the Sequence inspector from Show ORFs and Find Sites', async () => {
    await withApp({}, async (app) => {
      await sequenceOf(app);
      // From the Info tab with the inspector closed and the section folded.
      const ready = async (section: string) => {
        if (app.activeTab() !== 'sequence-view') await app.clickTab('sequence-view');
        if (!app.inspectorAside()) await app.press('i', { mod: true, alt: true });
        if (sectionHeader(app, section).getAttribute('aria-expanded') === 'true') await app.click(sectionHeader(app, section));
        expect(sectionHeader(app, section).getAttribute('aria-expanded'), `${section} folded`).toBe('false');
        await app.press('i', { mod: true, alt: true });
        await app.clickTab('document-info');
        expect(shown(app)).toEqual(NONE);
      };
      const opened = (route: string, section: string) => {
        expect(app.activeTab(), route).toBe('sequence-view');
        expect(shown(app), route).toEqual(SEQUENCE_OPEN);
        expect(sectionHeader(app, section).getAttribute('aria-expanded'), `${route}: ${section} unfolded`).toBe('true');
      };
      await ready('ORFs');
      await app.click(await menuRow(app, menubar(app, 'Sequence'), ['Annotate', 'Genes & ORFs'], 'Show ORFs'));
      opened('Sequence > Annotate > Genes & ORFs > Show ORFs', 'ORFs');
      await ready('Restriction Analysis');
      await app.click(await menuRow(app, app.one('button.mbc-tool-btn[title="Cloning and assembly tools"]'), ['Restriction Digest'], 'Find Sites'));
      opened('Cloning > Restriction Digest > Find Sites', 'Restriction Analysis');
      await ready('ORFs');
      await app.menu('annotate:find-orfs');
      opened('Annotate > Find ORFs (native)', 'ORFs');
    });
  });
});
