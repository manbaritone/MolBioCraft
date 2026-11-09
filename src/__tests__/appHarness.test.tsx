// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6TB6G: the App test harness every inspector story proves its section through, checked
 * through the real App: the live DOM (liveDom.ts), the App mount (appHarness.tsx) and the App.css
 * cascade reader (cssCascade.ts).
 *
 * The checks fail for a wrong harness: a studio drawn as its Suspense fallback, a session restored
 * on another tab or document, an input that never reaches the App's handler, a key press that
 * ignores its modifiers, a cascade that skips a condition or guesses at one, a native-menu recorder
 * that misses a state, and an export read from the live figure instead of its copy.
 */

import { describe, expect, it, vi } from 'vitest';
import { NATIVE_MENU_COMMAND_RULES, resolveNativeMenuItemEnabled } from '../core/commandAvailability';
import type { SequenceDocument } from '../types/bio';
import { appTsxSource, LAZY_CHUNKS, macHost, mountApp, releaseLeakedMount, type AppHarness, type MountOptions } from './appHarness';
import { appCssRules, cascaded, gridTracks, parseCss } from './cssCascade';
import { blockedStorage, LiveDocument, LiveElement, LiveXMLSerializer, parseMarkup, SVG_NS } from './liveDom';

// A macOS host's Tauri runtime (AC5). vi.mock is hoisted above the imports, so the factory loads the
// harness itself.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

// Each check launches the App afresh (its modules loaded anew), some twice, so each is given the
// minute a test may take.
vi.setConfig({ testTimeout: 60_000 });

async function withApp<T>(opts: MountOptions, run: (app: AppHarness) => Promise<T>): Promise<T> {
  const app = await mountApp(opts);
  try {
    return await run(app);
  } finally {
    app.unmount();
  }
}

/** The document table's row for the record named `name` (its name cell reads exactly that). */
function row(app: AppHarness, name: string): LiveElement {
  const rows = app.all('.mbc-doc-table-pane tbody tr').filter((r) => r.querySelectorAll('td, span').some((c) => c.textContent.trim() === name));
  expect(rows, `one table row for ${name}`).toHaveLength(1);
  return rows[0];
}
const rowNames = (app: AppHarness) => app.all('.mbc-doc-table-pane tbody tr').map((r) => r.textContent);

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
  ...BLANK, id: 'harness-plasmid', name: 'pHarness_Ring', accession: 'HRN_0001', description: 'A circular construct built in the test',
  sequence: lettersFrom(0x5eed, 3000), topology: 'circular', folder: 'Plasmids & Vectors',
  features: [{ id: 'f-marker', name: 'HarnessMarker', type: 'CDS', start: 101, end: 961, strand: 1, color: '#d93025' }],
};
const INSERT: SequenceDocument = {
  ...BLANK, id: 'harness-insert', name: 'Harness_Insert', accession: 'HRN_0002', description: 'A linear insert built in the test',
  sequence: lettersFrom(0xbeef, 840), folder: 'Cloning Inserts & PCR',
};

// ─── AC1 ───

/** The studio for `tab` is drawn in the canvas: its own landmark, and no Suspense fallback ("Loading ..."). */
function studioDrawn(app: AppHarness, tab: string, landmark: string) {
  expect(app.activeTab(), `${tab} is the open tab`).toBe(tab);
  const canvas = app.canvas();
  const fallbacks = canvas.querySelectorAll('[role="status"]').map((e) => e.textContent.trim()).filter((t) => /^Loading\b/.test(t));
  expect(fallbacks, `${tab}: no Suspense fallback`).toEqual([]);
  expect(canvas.querySelectorAll(landmark).length, `${tab}: the studio draws ${landmark}`).toBeGreaterThan(0);
}

describe('mounts the real App over the live DOM (AC1)', () => {
  it('mounts the App and opens a lazy studio tab', async () => {
    // The chunks the harness imports first are App.tsx's React.lazy imports, all of them: the ten
    // studios (from eight modules) and the database explorer.
    const lazy = [...appTsxSource().matchAll(/React\.lazy\(\(\) =>\s*import\('([^']+)'\)/g)].map((m) => m[1]);
    expect(lazy, 'App.tsx declares ten lazy studios and the database explorer').toHaveLength(11);
    expect(Object.keys(LAZY_CHUNKS).sort()).toEqual([...new Set(lazy)].sort());

    await withApp({}, async (app) => {
      // React DOM's client renderer drew the workbench into the live tree, with the in-window menu bar a Linux window has.
      expect(app.all('.mbc-workbench'), 'the workbench').toHaveLength(1);
      expect(app.all('.mbc-menubar'), 'the in-window menu bar').toHaveLength(1);
      await app.menu('new-session:sample-library');
      expect(app.activeTab(), 'a new session opens on the Sequence tab').toBe('sequence-view');
      const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
      const named = (id: string) => SAMPLE_LIBRARY.find((d) => d.id === id)!.name;

      // Clicks on the studio tabs a record shows: History on the first record...
      await app.clickTab('history-hybrid');
      studioDrawn(app, 'history-hybrid', '[aria-label="Protein and Lineage Modules"]');
      // ...the Alignment it opens on, then Tree, Text and Alignment again on an alignment record...
      await app.click(row(app, named('doc-aln-coxii-cds')));
      studioDrawn(app, 'sequence-alignment', '[aria-label="Sequence Alignment Modes"]');
      await app.clickTab('phylogenetics');
      studioDrawn(app, 'phylogenetics', '.phylo-studio-topbar');
      await app.clickTab('text-view');
      studioDrawn(app, 'text-view', '.mbc-aln-text-stream');
      await app.clickTab('sequence-alignment');
      studioDrawn(app, 'sequence-alignment', '[aria-label="Sequence Alignment Modes"]');
      // ...and the Chromatogram a trace opens on.
      await app.click(row(app, named('doc-sanger-ab1-fwd')));
      studioDrawn(app, 'sanger-contig', '[aria-label="Sanger Trace Quality & Window Telemetry Cockpit"]');

      // The studios the header shows once a command asks for them, on a plasmid.
      await app.click(row(app, named('doc-pet28-egfp')));
      for (const [command, tab, landmark] of [
        ['tools:agarose-gel', 'cloning-gel', '[aria-label="Cloning Methods"]'],
        ['primers:pcr', 'primers-pcr', '[aria-label="Primer and CRISPR Tools"]'],
        ['tools:vectors', 'vector-library', '[aria-label="Vector Studio Modules"]'],
        ['align:whole-genome', 'genomics-ngs', '[aria-label="Genomics and Structure Modules"]'],
        ['tools:pipelines', 'guided-pipelines', '[aria-label="Guided pipelines"]'],
      ] as const) {
        await app.clickTab('sequence-view');
        await app.menu(command);
        studioDrawn(app, tab, landmark);
      }

      // A tab the header does not show, and a command the dispatcher has no case for, are refused by name.
      await expect(app.clickTab('sanger-contig')).rejects.toThrow(/has no sanger-contig tab; it shows /);
      await expect(app.menu('view:no-such-command')).rejects.toThrow(/has no case for "view:no-such-command"/);
    });
  });
});

// ─── AC2 ───

describe('restores a session built in the test (AC2)', () => {
  it('restores a session built in the test on the tab it names', async () => {
    await withApp({}, async (app) => {
      // The insert open on the Text tab, in FASTA: the flat file the App shows is the insert's.
      await app.restoreSession({ documents: [PLASMID, INSERT], activeDocId: INSERT.id, viewerTab: 'text-view', workspace: { textFormat: 'fasta' } });
      expect(app.activeTab()).toBe('text-view');
      const flat = app.canvas().textContent;
      expect(flat, 'the insert\'s FASTA header').toContain(`>${INSERT.name}`);
      expect(flat.replace(/\s+/g, ''), 'the insert\'s sequence').toContain(INSERT.sequence);
      expect(flat.replace(/\s+/g, '')).not.toContain(PLASMID.sequence.slice(0, 60));
      // The table holds the two documents built here and no others, the insert the active one.
      const names = rowNames(app);
      expect(names, 'two rows').toHaveLength(2);
      expect([PLASMID.name, INSERT.name].map((n) => names.filter((t) => t.includes(n)).length)).toEqual([1, 1]);
      expect(app.all('.mbc-doc-table-pane tr.selected-row').map((r) => r.textContent.includes(INSERT.name)), 'the insert is the open row').toEqual([true]);

      // Restored again, the plasmid open on the Sequence tab: its circle, in Split view, with its feature.
      await app.restoreSession({ documents: [PLASMID, INSERT], activeDocId: PLASMID.id, viewerTab: 'sequence-view', sessionName: 'Second_Session' });
      expect(app.activeTab()).toBe('sequence-view');
      expect(app.all('.mbc-doc-table-pane tr.selected-row').map((r) => r.textContent.includes(PLASMID.name)), 'the plasmid is the open row').toEqual([true]);
      const grid = app.one('.map-seq-grid');
      expect(grid.classList.contains('mode-split'), 'the circle beside the linear map').toBe(true);
      expect(app.canvas().querySelectorAll('svg.plasmid-svg text').some((t) => t.textContent.includes('HarnessMarker')), 'the plasmid\'s own feature on its circle').toBe(true);

      // It never claims a restore the App did not make: a document that is not in the session, and
      // a restore the App holds back to ask about unsaved work, are refused by name.
      await expect(app.restoreSession({ documents: [PLASMID], activeDocId: 'harness-missing', viewerTab: 'sequence-view' })).rejects.toThrow(/holds no document "harness-missing"/);
      await app.restoreSession({ documents: [INSERT], activeDocId: INSERT.id, viewerTab: 'sequence-view', sessionName: 'Unsaved_Session', unsaved: true });
      await expect(app.restoreSession({ documents: [PLASMID], activeDocId: PLASMID.id, viewerTab: 'sequence-view', sessionName: 'Held_Back' })).rejects.toThrow(/did not restore the session: it never says Restored workbench "Held_Back.mbc"/);
    });
    // Storage that refuses to write leaves no autosave to restore, and restoreSession says so.
    await withApp({ storage: blockedStorage() }, async (app) => {
      await expect(app.restoreSession({ documents: [PLASMID], activeDocId: PLASMID.id, viewerTab: 'sequence-view' })).rejects.toThrow(/wrote nothing/);
    });
  });
});

// ─── AC3 ───

describe('reaches the App\'s own handlers (AC3)', () => {
  it('drives the App through menu commands, clicks, field changes and key presses', async () => {
    await withApp({}, async (app) => {
      await app.menu('new-session:sample-library');
      const pane = () => app.one('.mbc-doc-table-pane');
      // View > Document Table folds the table into its bar and opens it again.
      expect(pane().classList.contains('collapsed'), 'the table opens expanded').toBe(false);
      await app.menu('view:toggle-doctable');
      expect(pane().classList.contains('collapsed'), 'folded from the View menu').toBe(true);
      expect(pane().querySelectorAll('thead'), 'no table while folded').toHaveLength(0);
      await app.menu('view:toggle-doctable');
      expect(pane().classList.contains('collapsed'), 'opened from the View menu').toBe(false);

      // Cmd/Ctrl+Alt+I on the Sequence tab hides its inspector and shows it again; Alt+I alone does nothing.
      const shown = () => ({ aside: app.inspectorAside() !== null, hidden: app.bodySplit().classList.contains('inspector-hidden'), label: app.inspectorButton()?.getAttribute('aria-label') });
      expect(shown()).toEqual({ aside: true, hidden: false, label: 'Hide Sequence View Controls Inspector' });
      await app.press('i', { mod: true, alt: true });
      expect(shown(), 'hidden by Ctrl+Alt+I').toEqual({ aside: false, hidden: true, label: 'Show Sequence View Controls Inspector' });
      await app.press('i', { alt: true });
      expect(shown(), 'Alt+I is not the shortcut').toEqual({ aside: false, hidden: true, label: 'Show Sequence View Controls Inspector' });
      await app.press('i', { mod: true, alt: true });
      expect(shown(), 'shown again by Ctrl+Alt+I').toEqual({ aside: true, hidden: false, label: 'Hide Sequence View Controls Inspector' });
      // The command key is Ctrl on this host: Ctrl+= is View > Zoom In (the menu's own shortcut
      // binding), and Meta+= is no shortcut here.
      const zoom = () => app.header().querySelectorAll('button.zoom-pct-btn').map((b) => b.textContent);
      expect(zoom()).toEqual(['100%']);
      await app.press('=', { mod: true });
      expect(zoom(), 'zoomed in by Ctrl+=').toEqual(['110%']);
      await app.press('=', { meta: true });
      expect(zoom(), 'Meta+= is not the shortcut on Linux').toEqual(['110%']);

      // A click on the header's inspector button does the same.
      await app.click(app.inspectorButton()!);
      expect(shown(), 'hidden by its button').toEqual({ aside: false, hidden: true, label: 'Show Sequence View Controls Inspector' });
      await app.click(app.inspectorButton()!);
      expect(shown().aside, 'shown by its button').toBe(true);

      // A click opens the ORFs section; a committed change and a typed input of its range field set
      // the minimum ORF size the App scans for.
      const aside = () => app.inspectorAside()!;
      const orfHeader = () => aside().querySelectorAll('button.mbc-accordion-header').find((b) => b.textContent.startsWith('ORFs'))!;
      const orfsFound = () => Number(/ORFs \((\d+)/.exec(orfHeader().textContent)?.[1]);
      const minimum = () => aside().querySelectorAll('.mbc-control-row span').map((s) => s.textContent).find((t) => t.startsWith('Minimum ORF Size'));
      expect(orfHeader().getAttribute('aria-expanded'), 'the ORFs section starts folded').toBe('false');
      await app.click(orfHeader());
      expect(orfHeader().getAttribute('aria-expanded'), 'opened by a click').toBe('true');
      expect(minimum()).toBe('Minimum ORF Size: 50 aa');
      const at50 = orfsFound();
      const range = () => aside().querySelectorAll('input[type="range"]')[0];
      await app.change(range(), '150');
      expect(minimum(), 'changed').toBe('Minimum ORF Size: 150 aa');
      expect(orfsFound(), 'fewer ORFs of 150 aa than of 50 aa').toBeLessThan(at50);
      await app.input(range(), '75');
      expect(minimum(), 'the input event alone reaches the App').toBe('Minimum ORF Size: 75 aa');

      // A select's change event: the View Layout picker puts the map in Linear View Only and back.
      const layout = () => aside().querySelectorAll('.mbc-control-row').find((r) => r.textContent.startsWith('View Layout:'))!.querySelectorAll('select')[0];
      expect(layout().value).toBe('split');
      await app.change(layout(), 'linear');
      expect(app.one('.map-seq-grid').classList.contains('mode-linear'), 'Linear View Only').toBe(true);
      expect(app.canvas().querySelectorAll('svg.plasmid-svg'), 'no circle drawn').toHaveLength(0);
      await app.change(layout(), 'split');
      expect(app.one('.map-seq-grid').classList.contains('mode-split'), 'Split again').toBe(true);
      // A value the picker does not offer is refused by name, not set.
      await expect(app.change(layout(), 'radial')).rejects.toThrow(/offers no option "radial"; it offers "split", "circular", "linear"/);
    });
  });
});

// ─── AC4 ───

describe('reads App.css (AC4)', () => {
  it('reads App.css as the cascade applies it at a window width', async () => {
    // The Sequence body split the App renders: the canvas, the handle and the inspector column at
    // 1100px; the canvas alone once the inspector is hidden. The map grid is side by side from a
    // 760px viewer canvas (a container query) and stacked below it.
    await withApp({}, async (app) => {
      await app.menu('new-session:sample-library');
      const split = app.bodySplit();
      expect(gridTracks(cascaded(split, 'grid-template-columns', { window: 1100 })!), 'three tracks at 1100px').toEqual(['minmax(0, 1fr)', '5px', 'var(--mbc-inspector-width, 288px)']);
      const handle = app.one('.mbc-inspector-resizer');
      expect(cascaded(split, '--mbc-inspector-width', { window: 1100 }), 'the width the App sets inline on the split').toBe(`${handle.getAttribute('aria-valuenow')}px`);
      const grid = app.one('.map-seq-grid.mode-split');
      expect(gridTracks(cascaded(grid, 'grid-template-columns', { window: 1100, canvas: 879 })!)).toEqual(['minmax(320px, 4fr)', 'minmax(0, 5fr)']);
      expect(gridTracks(cascaded(grid, 'grid-template-columns', { window: 1100, canvas: 760 })!)).toHaveLength(2);
      expect(gridTracks(cascaded(grid, 'grid-template-columns', { window: 1100, canvas: 759 })!)).toEqual(['minmax(0, 1fr)']);
      // With no canvas width the container query cannot be read, and the reader says which.
      expect(() => cascaded(grid, 'grid-template-columns', { window: 1100 })).toThrow(/@container viewer-canvas \(min-width: 760px\)", which queries <div class="mbc-viewer-canvas[^"]*">.*a container whose width the view does not give/);
      await app.press('i', { mod: true, alt: true });
      expect(gridTracks(cascaded(app.bodySplit(), 'grid-template-columns', { window: 1100 })!), 'one track with the inspector hidden').toEqual(['minmax(0, 1fr)']);
    });

    // An element tree built in the test: the Chromatogram studio's trace and inspector are one column
    // in a window up to 1150px wide (a media query) and two from 1151px.
    const doc = new LiveDocument();
    const canvas = doc.createElement('div');
    canvas.setAttribute('class', 'mbc-viewer-canvas is-sequence-view');
    const wrapper = doc.createElement('div');
    wrapper.setAttribute('class', 'chromatogram-studio-wrapper has-trace-inspector');
    canvas.appendChild(wrapper);
    doc.body.appendChild(canvas);
    const columns = (width: number) => gridTracks(cascaded(wrapper, 'grid-template-columns', { window: width })!);
    expect(columns(1100), 'one column at 1100px').toEqual(['minmax(0, 1fr)']);
    expect(columns(1280), 'two at 1280px').toEqual(['minmax(0, 1fr)', 'var(--mbc-trace-inspector-width, 288px)']);
    expect([columns(1150).length, columns(1151).length], 'the 1150px breakpoint').toEqual([1, 2]);
    // Without its second class the wrapper is the studios' shared flex stack, not the grid.
    wrapper.setAttribute('class', 'chromatogram-studio-wrapper');
    expect(cascaded(wrapper, 'grid-template-columns', { window: 1280 })).toBeUndefined();
    expect(cascaded(wrapper, 'display', { window: 1280 })).toBe('flex');

    // It fails by name on a selector part it does not model (a field's validity after user input),
    // and on a scroll-state container query, but reads the same rule's element where no scroll
    // container makes the query apply.
    const field = doc.createElement('textarea');
    doc.body.appendChild(field);
    expect(() => cascaded(field, 'border-color', { window: 1280 })).toThrow(/rule "[^"]*textarea:user-invalid" may set border-color on <textarea>, but the reader cannot evaluate the selector "textarea:user-invalid"/);
    const strip = doc.createElement('div');
    strip.setAttribute('class', 'mbc-scroll-strip-scroller');
    const fade = doc.createElement('span');
    fade.setAttribute('class', 'mbc-scroll-fade-left');
    strip.appendChild(fade);
    doc.body.appendChild(strip);
    expect(() => cascaded(fade, 'opacity', { window: 1280 })).toThrow(/cannot evaluate the scroll-state query "scroll-state\(scrollable: left\)"/);
    doc.body.appendChild(fade);
    expect(() => cascaded(fade, 'opacity', { window: 1280 }), 'no scroll-state container: the query does not apply').not.toThrow();
    expect(appCssRules().some((r) => r.selectorText === '.mbc-scroll-fade-left' && r.at.some((a) => a.startsWith('@container scroll-state'))), 'that query is in App.css').toBe(true);

    // The cascade's order, by a sheet built here: !important, then specificity, then source order;
    // a physical property and its logical twin share it; a shorthand is expanded or named.
    const sheet = parseCss(`
      .x { color: red; width: 10px; flex: 1 1 200px; }
      .x.y { color: green; }
      .x { color: blue; inline-size: 20px; }
      div.x { order: 1 !important; }
      .x.y.z { order: 2; }
      .x { grid-template: auto / 1fr 2fr; }
      @media (scan: interlace) { .y { color: black; } }
      @layer base { .z { color: white; } }
      @media (max-width: 900px) { .y { margin: 1px 2px 3px 4px; } }
    `);
    const el = doc.createElement('div');
    el.setAttribute('class', 'x y');
    doc.body.appendChild(el);
    expect(cascaded(el, 'color', { window: 1280 }, sheet.slice(0, 3)), 'the more specific rule, though earlier').toBe('green');
    el.setAttribute('class', 'x');
    expect(cascaded(el, 'color', { window: 1280 }, sheet), 'the later of two equal rules').toBe('blue');
    expect(cascaded(el, 'width', { window: 1280 }, sheet), 'inline-size, declared later, sets the width').toBe('20px');
    expect(cascaded(el, 'flex-basis', { window: 1280 }, sheet), 'from the flex shorthand').toBe('200px');
    expect(() => cascaded(el, 'grid-template-columns', { window: 1280 }, sheet)).toThrow(/through the shorthand "grid-template: auto \/ 1fr 2fr", which the reader does not expand/);
    el.setAttribute('class', 'x y z');
    expect(cascaded(el, 'order', { window: 1280 }, sheet), '!important beats specificity').toBe('1');
    expect(() => cascaded(el, 'color', { window: 1280 }, sheet)).toThrow(/cannot evaluate the media query "\(scan: interlace\)"/);
    el.setAttribute('class', 'x z');
    expect(() => cascaded(el, 'color', { window: 1280 }, sheet)).toThrow(/cascade layers are not modelled/);
    el.setAttribute('class', 'y');
    expect([cascaded(el, 'margin-left', { window: 800 }, sheet), cascaded(el, 'margin-inline-end', { window: 800 }, sheet), cascaded(el, 'margin-top', { window: 1280 }, sheet)], 'the margin shorthand, inside its media query').toEqual(['4px', '2px', undefined]);
    el.style.setProperty('margin-left', '9px');
    expect(cascaded(el, 'margin-left', { window: 800 }, sheet), 'the inline style beats the rule').toBe('9px');
  });
});

// ─── AC5 ───

describe('a macOS host (AC5)', () => {
  it('records the native menu state the App sends on a macOS host', async () => {
    await withApp(macHost(), async (app) => {
      const tauri = await import('../lib/tauriIpc');
      expect(tauri.isTauriDesktopRuntime(), 'the Tauri runtime is reported').toBe(true);
      // The App takes the host for macOS: no in-window menu bar, its header made room for the native one.
      expect(app.all('.mbc-menubar'), 'no in-window menu bar').toHaveLength(0);
      expect(app.all('.mbc-project-tabbar.macos-native-header'), 'the macOS header').toHaveLength(1);

      const before = app.nativeMenuStates();
      expect(before.length, 'the App sent the menu state at launch').toBeGreaterThan(0);
      expect(before.map((s) => s.sessionActive), 'no session yet, in every state').toEqual(before.map(() => false));
      // The App sends a state only when it changes, so each one differs from the one before.
      const distinct = (states: typeof before) => states.every((s, i) => i === 0 || JSON.stringify(s) !== JSON.stringify(states[i - 1]));
      expect(distinct(before)).toBe(true);
      const last = before[before.length - 1];
      expect(Object.keys(last.overrides).sort(), 'every command rule is in the state').toEqual(Object.keys(NATIVE_MENU_COMMAND_RULES).sort());
      expect(resolveNativeMenuItemEnabled('sequence:reverse-complement', last), 'Reverse Complement waits for a session').toBe(false);

      await app.menu('new-session:sample-library');
      const after = app.nativeMenuStates();
      expect(after.length, 'a new state arrived with the session').toBeGreaterThan(before.length);
      expect(after.slice(0, before.length), 'the earlier states are kept as sent').toEqual(before);
      expect(distinct(after)).toBe(true);
      const active = after[after.length - 1];
      expect(active.sessionActive, 'the session is active').toBe(true);
      expect(resolveNativeMenuItemEnabled('sequence:reverse-complement', active), 'Reverse Complement on the open DNA record').toBe(true);
      expect(resolveNativeMenuItemEnabled('view:toggle-doctable', active)).toBe(true);

      // A command that changes no menu availability sends nothing; closing the session sends the inactive state.
      await app.menu('view:toggle-sidebar');
      expect(app.nativeMenuStates(), 'the sidebar does not change the menu').toHaveLength(after.length);
      await app.menu('file:close-session');
      const closed = app.nativeMenuStates();
      expect(closed.length).toBe(after.length + 1);
      expect(closed[closed.length - 1].sessionActive, 'the session closed').toBe(false);
    });
    // On the default (Linux) host the same mock reports no Tauri runtime, and the App sends no native-menu state.
    await withApp({}, async (app) => {
      const tauri = await import('../lib/tauriIpc');
      expect(tauri.isTauriDesktopRuntime()).toBe(false);
      await app.menu('new-session:sample-library');
      expect(app.nativeMenuStates()).toEqual([]);
    });
  });
});

// ─── AC6 ───

describe('clones, serialises and saves (AC6)', () => {
  it('captures a file the App saves, with a cloned and serialised figure', async () => {
    // The live DOM clones (deep and shallow) and serialises as XML, escaping text and attributes.
    const doc = new LiveDocument();
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 10 10');
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'x');
    g.setAttribute('data-label', 'a "b"');
    const text = doc.createElementNS(SVG_NS, 'text');
    text.appendChild(doc.createTextNode('A & B < C'));
    g.appendChild(text);
    g.appendChild(doc.createElementNS(SVG_NS, 'rect'));
    svg.appendChild(g);
    const xml = new LiveXMLSerializer().serializeToString(svg);
    expect(xml).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g class="x" data-label="a &quot;b&quot;"><text>A &amp; B &lt; C</text><rect/></g></svg>');
    const deep = svg.cloneNode(true);
    expect(deep === svg || deep.firstChild === g, 'a copy, not the node').toBe(false);
    expect(new LiveXMLSerializer().serializeToString(deep)).toBe(xml);
    deep.setAttribute('xmlns', SVG_NS);
    (deep.firstChild as LiveElement).setAttribute('class', 'changed');
    expect(new LiveXMLSerializer().serializeToString(svg), 'the original is untouched by changes to its copy').toBe(xml);
    expect(svg.cloneNode(false).childNodes, 'a shallow copy has no children').toHaveLength(0);
    const html = doc.createElement('div');
    html.style.setProperty('--w', '4px');
    html.style.width = '2px';
    expect(new LiveXMLSerializer().serializeToString(html), 'an HTML element, its inline style as its style attribute').toBe('<div xmlns="http://www.w3.org/1999/xhtml" style="--w: 4px; width: 2px;"></div>');

    await withApp({}, async (app) => {
      await app.restoreSession({ documents: [PLASMID, INSERT], activeDocId: PLASMID.id, viewerTab: 'sequence-view' });
      const live = app.canvas().querySelectorAll('svg.plasmid-svg');
      expect(live, 'the circle the App draws').toHaveLength(1);
      expect(app.downloads(), 'nothing saved yet').toEqual([]);

      // File > Save as SVG Image: the App clones the circle, serialises the copy and saves it.
      await app.menu('file:save-svg-image');
      const files = app.downloads();
      expect(files.map((f) => [f.filename, f.type])).toEqual([[`${PLASMID.name}_Map_View.svg`, 'image/svg+xml;charset=utf-8']]);
      const saved = await files[0].text();
      expect(saved.startsWith('<svg '), 'an SVG document').toBe(true);
      expect(saved).toContain(' xmlns="http://www.w3.org/2000/svg"');
      expect(saved).toContain('HarnessMarker');
      // The file is the whole figure: read back, it holds every element the circle draws.
      const [back] = parseMarkup(saved, doc);
      expect(back instanceof LiveElement && back.localName, 'the file reads back as an <svg>').toBe('svg');
      expect((back as LiveElement).querySelectorAll('*').length, 'every element of the drawn circle').toBe(live[0].querySelectorAll('*').length);
      expect((back as LiveElement).getAttribute('class')).toBe('plasmid-svg');
      // The App set the namespace on its copy: the circle on screen does not carry it.
      expect(live[0].hasAttribute('xmlns'), 'the drawn circle is not the exported copy').toBe(false);
      expect(app.doc.body.textContent).toContain(`Saved vector graphic "${PLASMID.name}_Map_View.svg"`);

      // A text export: File > Save as FASTA writes the record, read back whole.
      await app.menu('file:save-fasta');
      const all = app.downloads();
      expect(all, 'the second file saved').toHaveLength(2);
      expect(all[1].filename.startsWith(PLASMID.name), all[1].filename).toBe(true);
      const fasta = await all[1].text();
      expect(fasta.split('\n')[0].startsWith(`>${PLASMID.name}`), fasta.split('\n')[0]).toBe(true);
      expect(fasta.split('\n').slice(1).join('').replace(/\s+/g, '')).toBe(PLASMID.sequence);
    });
  });
});

// ─── BG-01M6XTHE ───

// A mount abandoned without its cleanup - in the real case a test that times out before its own
// `finally` runs - must not reach the next test. The harness owns the mount flag, so the next test
// mounts normally instead of failing with a message about the harness.
describe('recovers from a leaked mount (BG-01M6XTHE)', () => {
  it('abandons a mount without running its cleanup', async () => {
    const app = await mountApp();
    expect(app.all('.mbc-workbench'), 'the App mounted and settled').toHaveLength(1);
    // Deliberately no unmount and no finally: this is the state a timed-out test leaves behind.
  });

  it('mounts normally after the leaked mount of the previous test', async () => {
    // The harness's own afterEach cleared the leak before this test began: the globals the
    // abandoned launch stubbed are gone, so nothing of it is left to clear here.
    expect((globalThis as { document?: unknown }).document, 'the leaked mount was cleared before this test began').toBeUndefined();
    await withApp({}, async (app) => {
      expect(app.all('.mbc-workbench'), 'the next test mounts normally').toHaveLength(1);
    });
  });

  it('tells a leaked mount apart from a double mount in this test', async () => {
    const noLiveDom = (globalThis as { document?: unknown }).document;
    await mountApp();
    await expect(mountApp(), 'a second mount in this test').rejects.toThrow(/already mounted in this test/);
    expect(releaseLeakedMount(), 'the harness clears the mount this test left').toBe(true);
    expect((globalThis as { document?: unknown }).document, 'the globals the launch stubbed are back').toBe(noLiveDom);
    expect(releaseLeakedMount(), 'nothing left to clear').toBe(false);
  });

  it('clears a leak from a previous test and mounts anyway, naming it a leak', async () => {
    // The last resort inside mountApp, for the copy of the harness whose afterEach never ran: the
    // live mount is on globalThis (so a module reset cannot split it), and a mount another test
    // made is cleared with a word for which case it was, rather than refused.
    await mountApp();
    const slot = (globalThis as unknown as Record<symbol, { current: { test: string } | null }>)[Symbol.for('molbiocraft.appHarness.liveMount')];
    slot.current!.test = 'a previous test that never reached its own cleanup';
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = await mountApp();
      expect(warned.mock.calls.map((c) => String(c[0])).join('\n'), 'the harness says which case it was')
        .toMatch(/was never unmounted - a leak from a previous test, not a double mount in this one/);
      expect(app.all('.mbc-workbench'), 'the mount went ahead').toHaveLength(1);
      app.unmount();
    } finally {
      warned.mockRestore();
    }
  });
});
