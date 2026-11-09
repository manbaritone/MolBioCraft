// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6Q1G1: each studio says what it computes in the words a biologist uses, and names the
 * method that actually ran.
 *
 * Every check renders the real component, or drives the real App through its own command
 * dispatcher (the harness of structureToolsWiring.test.tsx), and reads the markup that results.
 * Only the desktop shell runs external tree programs, so its answers are stood in for at the
 * external-programs module (`desktop`), and the studio renders the tree they return; the notes of
 * programs not run that way go straight to the heading function the tree card calls. One check
 * stands in for a Mott trim that also keeps nothing of a read it cannot score (`engine`). None
 * reads source text. Headings are read as the words they show: tags and attribute values (tooltips,
 * ids, option values) are dropped.
 *
 * Some text only appears after a click (the contig assembly preview, the command palette). The
 * renders run on the server, where a state update made while a component is rendering re-renders
 * that component with the update. So a click here calls the real onClick of the button it names,
 * once, from inside the render that creates that button, and the markup returned is the render
 * that followed.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuNode } from '../components/CascadingMenu';
import { dataPath, haveTestData } from './testData';
import { abifWithoutQualities, seededChromatogram } from './traceFixtures';

// ─── Probes (installed before the App and studio modules are loaded) ───

interface AppDispatcher { onMenuAction: (actionId: string) => void }
type Menus = readonly (readonly unknown[])[];
const probe = vi.hoisted(() => ({
  /** The App's native-menu dispatcher ref, as its render last assigned it. */
  dispatcher: null as null | { current: AppDispatcher },
  /** Called from inside each App render with the web menu tables it builds. */
  onMenus: null as null | ((menus: Menus, dispatch: (id: string) => void) => void),
}));

/** Buttons to click, in order: each fires once, on the first button whose words match it. */
const clicker = vi.hoisted(() => {
  const textOf = (n: unknown): string => {
    if (n === null || n === undefined || typeof n === 'boolean') return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(textOf).join('');
    if (typeof n === 'object' && 'props' in n) return textOf((n as { props: { children?: unknown } }).props.children);
    return '';
  };
  const steps: { label: RegExp; done: boolean }[] = [];
  /** Selects to change: each fires once, on the first select showing `from`, whose onChange reads `to`. */
  const choices: { from: string; to: string; done: boolean }[] = [];
  const event = { preventDefault() {}, stopPropagation() {}, altKey: false, shiftKey: false, metaKey: false, ctrlKey: false };
  const wrap = <F,>(create: F): F =>
    ((type: unknown, props: { onClick?: unknown; onChange?: unknown; value?: unknown; children?: unknown; disabled?: unknown } | null, ...rest: unknown[]) => {
      if (type === 'button' && props && typeof props.onClick === 'function' && !props.disabled) {
        const next = steps.find((s) => !s.done);
        if (next && next.label.test(textOf(props.children).replace(/\s+/g, ' ').trim())) {
          next.done = true;
          (props.onClick as (e: unknown) => void)(event);
        }
      }
      if (type === 'select' && props && typeof props.onChange === 'function') {
        const pick = choices.find((c) => !c.done && c.from === String(props.value));
        if (pick) {
          pick.done = true;
          (props.onChange as (e: unknown) => void)({ ...event, target: { value: pick.to } });
        }
      }
      return (create as unknown as (...a: unknown[]) => unknown)(type, props, ...rest);
    }) as unknown as F;
  return { steps, choices, wrap };
});

/**
 * While `run` is on (see `mounted`), each effect runs during the render that declares it, the
 * first time and again whenever its dependencies change, as it would after a commit; the cleanup
 * of the previous run goes first, and the last cleanups wait in `live` for the unmount. A state
 * update an effect makes there re-renders the component with it, as a click does above.
 */
const effects = vi.hoisted(() => ({ run: false, live: new Set<{ cleanup: void | (() => void) }>() }));

/**
 * The desktop shell, as the studio sees it through the external-programs module (mocked below).
 * `programs` undefined leaves the real module answering; null is the browser build; a list is a
 * desktop that found these programs, where a run ends as `outcome` says.
 */
const desktop = vi.hoisted(() => ({
  programs: undefined as undefined | null | import('../core/externalTreePrograms').ExternalProgramStatus[],
  outcome: 'pending' as 'pending' | { value: import('../core/externalTreePrograms').ExternalTreeResult } | { error: Error },
  runs: [] as string[],
}));

/** The platform the App detects, when a test sets one (see the osPlatform mock). */
const host = vi.hoisted(() => ({ os: null as null | import('../platform/osPlatform').SupportedOS, asked: 0 }));

/**
 * The Mott trim, as the studio and these tests call it (see the rustBioEngine mock). `trim`
 * undefined leaves the real engine answering; a function rewrites each report it returns, standing
 * in for an engine that answers otherwise.
 */
type MottReport = import('../lib/rustBioEngine').MottPhredTrimReport;
type Chromatogram = import('../types/bio').ChromatogramData;
const engine = vi.hoisted(() => ({
  trim: undefined as undefined | ((report: MottReport, chromatogram: Chromatogram, cutoff: number) => MottReport),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useRef = ((initial: unknown) => {
    const ref = actual.useRef(initial);
    if (initial && typeof initial === 'object' && 'onMenuAction' in initial && 'onNativeFileOpen' in initial) {
      probe.dispatcher = ref as unknown as { current: AppDispatcher };
    }
    return ref;
  }) as typeof actual.useRef;
  const useEffect = ((effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const last = actual.useRef<{ deps: readonly unknown[] | undefined | null; cleanup: void | (() => void) }>({ deps: null, cleanup: undefined });
    const was = last.current.deps;
    const changed = was === null || !deps || !was || was.length !== deps.length || deps.some((d, i) => !Object.is(d, was[i]));
    if (effects.run && changed) {
      last.current.cleanup?.();
      last.current.deps = deps;
      last.current.cleanup = effect();
      effects.live.add(last.current);
    }
    return actual.useEffect(effect, deps);
  }) as typeof actual.useEffect;
  return { ...actual, default: { ...actual, useRef, useEffect }, useRef, useEffect };
});

vi.mock('../core/externalTreePrograms', async () => {
  const actual = await vi.importActual<typeof import('../core/externalTreePrograms')>('../core/externalTreePrograms');
  /** A promise that has already settled (or never will), so an effect run in a render reads it there. */
  const settled = <T,>(outcome: 'pending' | { value: T } | { error: Error }): Promise<T> => ({
    then: (ok?: (v: T) => unknown, fail?: (e: unknown) => unknown) =>
      outcome === 'pending' ? settled('pending')
        : 'value' in outcome ? settled({ value: ok ? ok(outcome.value) : outcome.value })
        : fail ? settled({ value: fail(outcome.error) }) : settled(outcome),
  }) as unknown as Promise<T>;
  return {
    ...actual,
    detectExternalTreePrograms: (refresh?: boolean) =>
      desktop.programs === undefined ? actual.detectExternalTreePrograms(refresh) : settled({ value: desktop.programs }),
    runExternalTree: (...args: Parameters<typeof actual.runExternalTree>) => {
      if (desktop.programs === undefined) return actual.runExternalTree(...args);
      desktop.runs.push(args[0]);
      return { promise: settled(desktop.outcome), cancel: () => {} };
    },
  };
});

vi.mock('../platform/osPlatform', async () => {
  const actual = await vi.importActual<typeof import('../platform/osPlatform')>('../platform/osPlatform');
  return {
    ...actual,
    detectHostOS: (userAgentOverride?: string) => {
      if (userAgentOverride !== undefined || !host.os) return actual.detectHostOS(userAgentOverride);
      host.asked++;
      return host.os;
    },
  };
});

vi.mock('../lib/rustBioEngine', async () => {
  const actual = await vi.importActual<typeof import('../lib/rustBioEngine')>('../lib/rustBioEngine');
  return {
    ...actual,
    trimSangerTraceMottPhredRust: (chromatogram: Chromatogram, errorCutoff = 0.05) => {
      const report = actual.trimSangerTraceMottPhredRust(chromatogram, errorCutoff);
      return engine.trim ? engine.trim(report, chromatogram, errorCutoff) : report;
    },
  };
});

vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<typeof import('react/jsx-dev-runtime')>('react/jsx-dev-runtime');
  return { ...actual, jsxDEV: clicker.wrap(actual.jsxDEV) };
});

vi.mock('react/jsx-runtime', async () => {
  const actual = await vi.importActual<typeof import('react/jsx-runtime')>('react/jsx-runtime');
  return { ...actual, jsx: clicker.wrap(actual.jsx), jsxs: clicker.wrap(actual.jsxs) };
});

vi.mock('../core/menuShortcuts', async () => {
  const actual = await vi.importActual<typeof import('../core/menuShortcuts')>('../core/menuShortcuts');
  return {
    ...actual,
    collectMenuShortcutBindings: (trees: Parameters<typeof actual.collectMenuShortcutBindings>[0]) => {
      probe.onMenus?.(trees, (id) => {
        if (!probe.dispatcher) throw new Error('the App rendered no native-menu dispatcher');
        probe.dispatcher.current.onMenuAction(id);
      });
      return actual.collectMenuShortcutBindings(trees);
    },
  };
});

const { App } = await import('../App');
const { PhylogeneticsStudio, SequenceAlignmentStudio, treeMethodHeading } = await import('../components/AlignmentAndPhyloStudio');
const { ChromatogramAndContigStudio } = await import('../components/ChromatogramAndContigStudio');
const { CloningAndGelStudio } = await import('../components/CloningAndGelStudio');
const { GenomicsNgsAndPredictionStudio } = await import('../components/GenomicsNgsAndPredictionStudio');
const { HybridToolsAndHistoryStudio } = await import('../components/HybridToolsAndHistoryStudio');
const { PrimerAndPCRStudio } = await import('../components/PrimerAndPCRStudio');
const { VectorLibraryAndDesignStudio } = await import('../components/VectorLibraryAndDesignStudio');
const { OperationDialog } = await import('../components/OperationDialog');
const { AlignOperationDialog, BuildTreeOperationDialog } = await import('../components/AnalysisOperationDialogs');
const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
const { phylogenySourceDocuments } = await import('../core/documentViews');
const { layoutNewickPhylogeneticTreeRust, trimSangerTraceMottPhredRust } = await import('../lib/rustBioEngine');
const { parseDnaBinaryPacket } = await import('../core/fileParsers');
const { detectCpuArch, formatPlatformShortcut } = await import('../platform/osPlatform');
type SequenceDocument = import('../types/bio').SequenceDocument;
type PhyloTreeAlgorithm = import('../core/phyloEvoEngine').PhyloTreeAlgorithm;
type ExternalProgramStatus = import('../core/externalTreePrograms').ExternalProgramStatus;
type ExternalTreeResult = import('../core/externalTreePrograms').ExternalTreeResult;

afterEach(() => {
  probe.onMenus = null;
  clicker.steps.length = 0;
  clicker.choices.length = 0;
  effects.run = false;
  effects.live.clear();
  desktop.programs = undefined;
  desktop.outcome = 'pending';
  desktop.runs = [];
  host.os = null;
  engine.trim = undefined;
});

// ─── Reading markup ───

/** The words a stretch of markup shows: tags (and so attribute values) dropped, entities decoded. */
const wordsOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** Every heading, table caption, KPI label and badge of a render, as words. */
function labelsOf(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g)) out.push(wordsOf(m[2]));
  for (const m of html.matchAll(/<div class="mbc-table-caption"[^>]*>([\s\S]*?)<\/div>/g)) out.push(wordsOf(m[1]));
  for (const m of html.matchAll(/<span class="kpi-label"[^>]*>([\s\S]*?)<\/span>/g)) out.push(wordsOf(m[1]));
  return out.concat(badgesOf(html));
}

/** The words of every badge (any span whose class names a badge). */
const badgesOf = (html: string): string[] =>
  Array.from(html.matchAll(/<span class="([^"]*\bbadge[^"]*)"[^>]*>([\s\S]*?)<\/span>/g), (m) => wordsOf(m[2]));

const JARGON = /petgraph|rust-bio|noodles|PHREDProb|Resident Rust/i;

/** Renders with the given buttons clicked in order, and checks each click found its button. */
function clicking(labels: RegExp[], render: () => string): string {
  clicker.steps.length = 0;
  clicker.steps.push(...labels.map((label) => ({ label, done: false })));
  const html = render();
  for (const s of clicker.steps) expect(s.done, `a button matching ${s.label} was clicked`).toBe(true);
  clicker.steps.length = 0;
  return html;
}

/** Renders as the client shows it once its effects have run (see `effects`), then unmounts it. */
function mounted(element: React.ReactElement): string {
  effects.run = true;
  try {
    return renderToStaticMarkup(element);
  } finally {
    effects.run = false;
    for (const e of effects.live) e.cleanup?.();
    effects.live.clear();
  }
}

/** The command of a web menu table labelled `label`. */
function findCommand(menus: Menus, label: string): (MenuNode & { kind: 'command' }) | null {
  const walk = (nodes: readonly MenuNode[]): (MenuNode & { kind: 'command' }) | null => {
    for (const n of nodes) {
      if (n.kind === 'command' && n.label === label) return n;
      if (n.kind === 'submenu') {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const tree of menus) {
    const hit = walk(tree as readonly MenuNode[]);
    if (hit) return hit;
  }
  return null;
}

/**
 * Renders the App. With a session, the first render starts it from the sample library; the first
 * render that has it runs `choose` and arms `clicks`. Returns the markup of the last render.
 */
function renderApp(opts: { session?: 'sample-library'; choose?: (menus: Menus, dispatch: (id: string) => void) => void; clicks?: RegExp[] } = {}): string {
  let step: 'start' | 'choose' | 'done' = 'start';
  let passes = 0;
  probe.onMenus = (menus, dispatch) => {
    passes++;
    if (passes > 30) throw new Error('the App kept re-rendering');
    if (!opts.session) return;
    if (step === 'start') {
      dispatch(`new-session:${opts.session}`);
      step = 'choose';
    } else if (step === 'choose') {
      step = 'done';
      opts.choose?.(menus, dispatch);
      clicker.steps.push(...(opts.clicks ?? []).map((label) => ({ label, done: false })));
    }
  };
  const html = renderToStaticMarkup(<App />);
  if (opts.session) expect(step, 'the session started and the next render ran').toBe('done');
  for (const s of clicker.steps) expect(s.done, `a button matching ${s.label} was clicked`).toBe(true);
  clicker.steps.length = 0;
  return html;
}

// ─── Fixtures ───

const noop = () => {};
const byId = (id: string) => {
  const d = SAMPLE_LIBRARY.find((doc) => doc.id === id);
  if (!d) throw new Error(`sample ${id} is missing`);
  return d;
};
const coxii = byId('doc-aln-coxii-cds');
/** The first eight rows of the COXII CDS alignment, taken from the input the App derives for the studio. */
const treeInputs = phylogenySourceDocuments(coxii, [], SAMPLE_LIBRARY).slice(0, 8);
const plasmid = byId('doc-pet28-egfp');

/**
 * Program banners as the desktop shell puts them in a run's `version`: the first output line that
 * starts with the program's name, trimmed of leading symbols and trailing dashes (`version_line`,
 * crates/molbiocraft-phylo/src/external.rs). The studio quotes it in the note it composes,
 * "<program> (<version>) ran on this computer in <t> s: <model> <what>.". Each line is the one the
 * program's own source prints:
 */
const BANNER = {
  /** PhyML src/io.c Print_Banner_Small: "---  PhyML %s  ---" with VERSION, in the stats file (configure.ac AC_INIT: "3.3." + "20260528"). */
  phyml: 'PhyML 3.3.20260528',
  /** raxml-ng src/main.cpp print_banner: "RAxML-NG v. " RAXML_VERSION " released on " RAXML_DATE " by The Exelixis Lab." (version.h: 2.0.4, 28.10.2026). */
  raxmlNg: 'RAxML-NG v. 2.0.4 released on 28.10.2026 by The Exelixis Lab.',
  /** The same print at the raxml-ng 1.2.2 tag (version.h: 1.2.2-master, 30.04.2024). */
  raxmlNg122: 'RAxML-NG v. 1.2.2-master released on 30.04.2024 by The Exelixis Lab.',
  /** standard-RAxML axml.c printVersionInfo: "This is %s version %s released by Alexandros Stamatakis on %s." (axml.h: RAxML, 8.2.12, May 2018). */
  raxml8: 'This is RAxML version 8.2.12 released by Alexandros Stamatakis on May 2018.',
  /**
   * FastTree 2.1.11 main(): "FastTree Version %s %s%s" with FT_VERSION, SSE_STRING and OpenMPString().
   * SSE_STRING is "Double precision (No SSE3)" in a USE_DOUBLE build, "SSE3" or "No SSE3" otherwise;
   * OpenMPString() is ", OpenMP (%d threads)" in FastTreeMP, "" otherwise.
   */
  fastTreeDouble: 'FastTree Version 2.1.11 Double precision (No SSE3)',
  fastTreeMP: 'FastTree Version 2.1.11 Double precision (No SSE3), OpenMP (8 threads)',
  fastTreeNoSse: 'FastTree Version 2.1.11 No SSE3',
};

const phylo = (tab: 'phylogeny' | 'usertree' | 'clocks', algorithm?: PhyloTreeAlgorithm, documents = treeInputs) =>
  renderToStaticMarkup(
    <PhylogeneticsStudio documents={documents} activeDoc={coxii} initialPhyloTab={tab}
      {...(algorithm ? { initialTreeAlgorithm: algorithm } : {})} />,
  );

/** The tree card: the card that holds the tree-method select, up to the figure card. */
function treeCard(html: string): string {
  const at = html.indexOf('Tree Inference Method:');
  expect(at, 'the tree card is drawn').toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<div class="studio-card">', at), html.indexOf('<div class="studio-card mbc-studio-isolated-region">', at));
}
const treeHeading = (card: string) => wordsOf(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(card)?.[1] ?? '');
const methodNoteOf = (card: string) => wordsOf(/<div class="info-callout" style="margin-top:8px">([^<]*)/.exec(card)?.[1] ?? '');

/** A trace whose base calls carry these Phred scores, with a clean peak under every call. */
function traceDoc(id: string, phred: number[]): SequenceDocument {
  const spacing = 12;
  const n = phred.length;
  const calls = Array.from({ length: n }, (_, i) => 'ACGT'[i % 4]).join('');
  const len = (n + 1) * spacing;
  const channels: Record<string, number[]> = { A: [], C: [], G: [], T: [] };
  for (const b of 'ACGT') channels[b] = new Array(len).fill(0);
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const at = i * spacing + spacing / 2;
    peaks.push(at);
    for (let x = Math.max(0, at - 5); x <= Math.min(len - 1, at + 5); x++) {
      channels[calls[i]][x] = Math.max(channels[calls[i]][x], Math.round(1000 * Math.exp(-((x - at) ** 2) / 4)));
    }
  }
  return {
    id, name: `${id}.ab1`, accession: '', description: '', moleculeType: 'DNA', topology: 'linear', sequence: calls,
    features: [], primers: [], history: [], createdAt: '', updatedAt: '', folder: 'Sequencing Reads (Sanger/NGS)',
    documentKind: 'trace',
    chromatogram: {
      traceA: channels.A, traceC: channels.C, traceG: channels.G, traceT: channels.T,
      peakLocations: peaks, phredScores: phred, baseCalls: calls,
    },
  };
}

/** The Mott trimming section of a chromatogram render. */
function mottSection(html: string): string {
  const at = html.indexOf('<div class="contig-variants-section mbc-studio-isolated-region"');
  expect(at, 'the trimming section is drawn').toBeGreaterThan(-1);
  const end = html.indexOf('<div class="contig-variants-section', at + 10);
  return html.slice(at, end === -1 ? undefined : end);
}

/** `doc` with a second peak, half the height of the call's, under each of these calls (1-based). */
function withMixedPeaks(doc: SequenceDocument, calls: number[]): SequenceDocument {
  const c = doc.chromatogram!;
  const traces: Record<string, number[]> = { A: [...c.traceA], C: [...c.traceC], G: [...c.traceG], T: [...c.traceT] };
  for (const call of calls) {
    const at = c.peakLocations[call - 1];
    const second = 'ACGT'[('ACGT'.indexOf(c.baseCalls[call - 1]) + 1) % 4];
    for (let x = at - 5; x <= at + 5; x++) {
      traces[second][x] = Math.max(traces[second][x], Math.round(500 * Math.exp(-((x - at) ** 2) / 4)));
    }
  }
  return { ...doc, chromatogram: { ...c, traceA: traces.A, traceC: traces.C, traceG: traces.G, traceT: traces.T } };
}

/**
 * Mixed IUPAC double peaks over the whole read, by the rule the engine calls them with
 * (`trim_sanger_trace_mott_phred`, chromatogram_mbc.rs): at a call's peak the second-highest
 * channel is at least 35% of the highest, and the highest is above 120.
 */
function mixedPeaksOf(c: Chromatogram): number {
  const points = Math.min(c.traceA.length, c.traceC.length, c.traceG.length, c.traceT.length);
  return c.peakLocations.filter((at, i) => {
    if (i >= c.baseCalls.length || at >= points) return false;
    const [top, next] = [c.traceA[at], c.traceC[at], c.traceG[at], c.traceT[at]].sort((a, b) => b - a);
    return top > 120 && next / top >= 0.35;
  }).length;
}

const fsSpec: string = 'node:fs';
/** A file's bytes, read through node:fs. */
const bytesOf = async (file: string | URL): Promise<ArrayBuffer> => {
  const { readFileSync } = (await import(/* @vite-ignore */ fsSpec)) as { readFileSync: (p: string | URL) => Uint8Array };
  const b = readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

// ─── AC1, AC2 ───

describe('the phylogeny card (PhylogeneticsStudio, phylogeny module)', () => {
  it('names the tree method that ran in the tree card heading', () => {
    // The studio opens on 'Maximum Likelihood (ML)', which scores the Neighbor-Joining tree; MP
    // also scores that tree and ME stops at its start tree. The heading names what the method note
    // says was computed, so a heading that shows the dropdown, or one fixed to Neighbor-Joining,
    // fails one of these. (Here each choice draws one tree; a later test covers the cases where the
    // dropdown and the report disagree.)
    const expected: Record<string, { note: RegExp; heading: string }> = {
      'Maximum Likelihood (ML)': { note: /^Maximum Likelihood \(ML\) is not run here: the topology is Neighbor-Joining/, heading: 'Neighbor-Joining tree' },
      'Maximum Parsimony (MP)': { note: /of the Neighbor-Joining tree .*no parsimony tree search is performed/, heading: 'Neighbor-Joining tree' },
      'Neighbor-Joining (NJ)': { note: /^Neighbor-Joining \(Saitou & Nei 1987\)/, heading: 'Neighbor-Joining tree' },
      'Minimum-Evolution (ME)': { note: /^Neighbor-Joining tree on .*\(the starting tree of an ME search\)/, heading: 'Neighbor-Joining start tree (no ME search)' },
      UPGMA: { note: /^UPGMA \(average linkage/, heading: 'UPGMA tree' },
    };
    for (const [algorithm, want] of Object.entries(expected)) {
      const card = treeCard(phylo('phylogeny', algorithm as PhyloTreeAlgorithm));
      const note = methodNoteOf(card);
      expect(note, `${algorithm}: the engine's method note`).toMatch(want.note);
      const heading = treeHeading(card);
      expect(heading, `${algorithm}: the heading`).toBe(want.heading);
      expect(heading).not.toContain(`(${algorithm})`);
      expect(heading).not.toMatch(/petgraph/i);
      // The Newick export beside it is labelled with the same method, not the dropdown.
      const newickLabel = wordsOf(/<div class="newick-box"><span>([\s\S]*?)<\/span>/.exec(card)?.[1] ?? '');
      expect(newickLabel, `${algorithm}: the Newick label`).toBe(`Export Newick Tree String (${want.heading}):`);
      // The heading spells the method as the note under it and the dropdown do.
      expect(heading).not.toMatch(/Neighbour/);
    }
    // The selected option still says what the ML choice does, so the dropdown keeps its words.
    expect(wordsOf(treeCard(phylo('phylogeny', 'Maximum Likelihood (ML)')))).toContain('Maximum Likelihood — lnL of the NJ tree (no ML search)');
  });

  it('names the tree method that ran in the tree card heading, for every note the report can carry', () => {
    // An external program's tree (composed by the studio from the program's result) names the
    // program and the model it ran, whatever full stops and parentheses its version banner holds;
    // a note naming no tree claims no method.
    const ML = (program: string) => `Maximum-likelihood tree (${program}, GTR+Γ4)`;
    const AML = 'Approximately-maximum-likelihood tree (FastTree, GTR+Γ20)';
    const phyml = (version: string) =>
      `PhyML (${version}) ran on this computer in 1.2 s: GTR+Γ4 maximum-likelihood tree (NNI + SPR search). Node labels: SH-like aLRT (%).`;
    const raxml = (version: string) =>
      `RAxML (${version}) ran on this computer in 4.1 s: GTR+Γ4 maximum-likelihood tree (one search from a parsimony start, no bootstrap). No branch support was computed. RAxML lnL (GTR+Γ4): -2340.12.`;
    const fastTree = (version: string | null) =>
      `FastTree${version ? ` (${version})` : ''} ran on this computer in 0.4 s: GTR+Γ20 approximately-maximum-likelihood tree (NNI + SPR moves). Node labels: SH-like local support (%).`;
    expect(treeMethodHeading(phyml(BANNER.phyml))).toBe(ML('PhyML'));
    // RAxML-NG's "v. 2.0.4" holds a full stop and a space, so the note's first sentence ends there.
    expect(treeMethodHeading(raxml(BANNER.raxmlNg))).toBe(ML('RAxML'));
    expect(treeMethodHeading(raxml(BANNER.raxmlNg122))).toBe(ML('RAxML'));
    expect(treeMethodHeading(raxml(BANNER.raxml8))).toBe(ML('RAxML'));
    // FastTree's banner holds parentheses of its own, one or two groups of them.
    expect(treeMethodHeading(fastTree(BANNER.fastTreeDouble))).toBe(AML);
    expect(treeMethodHeading(fastTree(BANNER.fastTreeMP))).toBe(AML);
    expect(treeMethodHeading(fastTree(BANNER.fastTreeNoSse))).toBe(AML);
    expect(treeMethodHeading(fastTree(null))).toBe(AML);
    // A banner nested deeper than one level is not read as a program, and claims no method.
    expect(treeMethodHeading(fastTree('FastTree Version 2.1.11 (Double precision (No SSE3))'))).toBe('Phylogenetic tree');
    // A note naming no program claims none, and the program pattern counts only where it opens the
    // note: a built-in note that mentions a program run later is still the built-in method.
    expect(treeMethodHeading('ran on this computer in 1.0 s: GTR+Γ4 maximum-likelihood tree (NNI + SPR search).')).toBe('Phylogenetic tree');
    expect(treeMethodHeading(`Neighbor-Joining (Saitou & Nei 1987) on Tamura-Nei (TN93) distances, midpoint-rooted. ${phyml(BANNER.phyml)}`))
      .toBe('Neighbor-Joining tree');
    expect(treeMethodHeading('MrBayes (3.2.7) ran on this computer in 61.0 s: GTR+Γ4 50% majority-rule consensus of 2 × 100,000 MCMC generations (25% burn-in). Node labels: posterior probability (%).'))
      .toBe('Bayesian consensus tree (MrBayes, GTR+Γ4)');
    expect(treeMethodHeading('A tree needs at least two sequences.')).toBe('Phylogenetic tree');
    expect(treeMethodHeading('No tree: the Tamura-Nei (TN93) distance is undefined for at least one pair.')).toBe('Phylogenetic tree');
    // A Neighbor-Joining mention after the first sentence (the lnL note) names nothing.
    expect(treeMethodHeading('Something else ran. Compared with the Neighbor-Joining tree.')).toBe('Phylogenetic tree');
  });

  it('names the tree method that ran in the tree card heading, when the dropdown and the report disagree', () => {
    // One dropdown choice draws different trees: the program's own tree on a desktop where it ran
    // (PhyML, RAxML-NG and FastTreeMP here, each with its real version banner), and the built-in
    // Neighbor-Joining tree everywhere else (browser, not installed, still running, failed), whose
    // report the studio also holds while the external tree is shown. So a
    // heading keyed on the dropdown (whatever it maps each choice to) fails one of these, and so
    // does one read from the built-in report while an external tree is drawn.
    const names = treeInputs.map((d) => d.name.replace(/[^A-Za-z0-9_.-]/g, '_'));
    // A caterpillar over the eight tips, labelled as the desktop shell writes them; not the NJ tree.
    const external = names.slice(0, -1).reduceRight((inner, tip, i) => `(${tip}:0.0${i + 1},${inner})${90 - i}:0.01`, `${names[names.length - 1]}:0.02`)
      .replace(/\)\d+:0\.01$/, ');');
    const exe: Record<ExternalProgramStatus['algorithm'], string> = {
      'FastTree (Approx-ML)': 'FastTreeMP', 'PhyML (ML + SH-aLRT)': 'phyml', 'RAxML (GTR+G Rapid ML)': 'raxml-ng', 'MrBayes (Bayesian MCMC)': 'mb',
    };
    const status = (algorithm: ExternalProgramStatus['algorithm'], available: boolean): ExternalProgramStatus => ({
      algorithm, name: algorithm.split(' ')[0], available,
      executablePath: available ? `/opt/homebrew/bin/${exe[algorithm]}` : null,
      installHint: `brew install ${exe[algorithm].toLowerCase()}`,
    });
    const found = (...available: ExternalProgramStatus['algorithm'][]) =>
      (['FastTree (Approx-ML)', 'PhyML (ML + SH-aLRT)', 'RAxML (GTR+G Rapid ML)', 'MrBayes (Bayesian MCMC)'] as const)
        .map((a) => status(a, available.includes(a)));
    const phyml: ExternalTreeResult = {
      algorithm: 'PhyML (ML + SH-aLRT)', program: 'PhyML', version: BANNER.phyml, executablePath: '/opt/homebrew/bin/phyml',
      commandLine: 'phyml -i aln.phy -d nt -m GTR -a e -c 4 -b -4 -o tlr --no_memory_check --quiet', model: 'GTR+Γ4',
      newick: external, supportKind: 'SH-like aLRT', programLogLikelihood: -2345.67, totalBranchLength: 0.29, runtimeMs: 12_300, warnings: [],
    };
    const raxml: ExternalTreeResult = {
      algorithm: 'RAxML (GTR+G Rapid ML)', program: 'RAxML', version: BANNER.raxmlNg, executablePath: '/opt/homebrew/bin/raxml-ng',
      commandLine: 'raxml-ng --search --msa aln.fasta --data-type DNA --model GTR+G --prefix run --seed 12345 --threads 2 --redo', model: 'GTR+Γ4',
      newick: external, supportKind: 'none', programLogLikelihood: -2340.12, totalBranchLength: 0.29, runtimeMs: 4_100, warnings: [],
    };
    const fastTree: ExternalTreeResult = {
      algorithm: 'FastTree (Approx-ML)', program: 'FastTree', version: BANNER.fastTreeMP, executablePath: '/opt/homebrew/bin/FastTreeMP',
      commandLine: 'FastTreeMP -nt -gtr -gamma -nopr aln.fasta', model: 'GTR+Γ20',
      newick: external, supportKind: 'SH-like local support', programLogLikelihood: -2351.9, totalBranchLength: 0.29, runtimeMs: 400, warnings: [],
    };
    const NJ = 'Neighbor-Joining tree';
    const cases: {
      where: string; algorithm: PhyloTreeAlgorithm; programs: null | ExternalProgramStatus[]; outcome?: typeof desktop.outcome;
      callout: RegExp; note: RegExp; heading: string; draws: 'built-in' | 'external';
    }[] = [
      { where: 'browser', algorithm: 'PhyML (ML + SH-aLRT)', programs: null,
        callout: /^PhyML can only be run from the MolBioCraft desktop app\. Showing the built-in Neighbor-Joining tree instead\.$/,
        note: /^PhyML \(ML \+ SH-aLRT\) is not run here: the topology is Neighbor-Joining/, heading: NJ, draws: 'built-in' },
      { where: 'desktop, PhyML not installed', algorithm: 'PhyML (ML + SH-aLRT)', programs: found('RAxML (GTR+G Rapid ML)'),
        callout: /^PhyML was not found on this computer, so the built-in Neighbor-Joining tree is shown\./,
        note: /^PhyML \(ML \+ SH-aLRT\) is not run here: the topology is Neighbor-Joining/, heading: NJ, draws: 'built-in' },
      { where: 'desktop, PhyML running', algorithm: 'PhyML (ML + SH-aLRT)', programs: found('PhyML (ML + SH-aLRT)'), outcome: 'pending',
        callout: /^Running PhyML on 8 sequences × [\d,]+ sites… 0 s\. The Neighbor-Joining tree is shown until it finishes\./,
        note: /^PhyML \(ML \+ SH-aLRT\) is not run here: the topology is Neighbor-Joining/, heading: NJ, draws: 'built-in' },
      { where: 'desktop, PhyML failed', algorithm: 'PhyML (ML + SH-aLRT)', programs: found('PhyML (ML + SH-aLRT)'),
        outcome: { error: new Error('PhyML wrote no tree. Last output: ERROR: the alignment has too few sites') },
        callout: /^PhyML did not produce a tree: PhyML wrote no tree\. .* The Neighbor-Joining tree is shown instead\./,
        note: /^PhyML \(ML \+ SH-aLRT\) is not run here: the topology is Neighbor-Joining/, heading: NJ, draws: 'built-in' },
      { where: 'desktop, PhyML ran', algorithm: 'PhyML (ML + SH-aLRT)', programs: found('PhyML (ML + SH-aLRT)'), outcome: { value: phyml },
        callout: /^Tree from \/opt\/homebrew\/bin\/phyml\.$/,
        note: /^PhyML \(PhyML 3\.3\.20260528\) ran on this computer in 12\.3 s: GTR\+Γ4 maximum-likelihood tree \(NNI \+ SPR search\)\. Node labels: SH-like aLRT \(%\)\./,
        heading: 'Maximum-likelihood tree (PhyML, GTR+Γ4)', draws: 'external' },
      { where: 'desktop, RAxML-NG ran', algorithm: 'RAxML (GTR+G Rapid ML)', programs: found('PhyML (ML + SH-aLRT)', 'RAxML (GTR+G Rapid ML)'), outcome: { value: raxml },
        callout: /^Tree from \/opt\/homebrew\/bin\/raxml-ng\.$/,
        note: /^RAxML \(RAxML-NG v\. 2\.0\.4 released on 28\.10\.2026 by The Exelixis Lab\.\) ran on this computer in 4\.1 s: GTR\+Γ4 maximum-likelihood tree \(one search from a parsimony start, no bootstrap\)\. No branch support was computed\./,
        heading: 'Maximum-likelihood tree (RAxML, GTR+Γ4)', draws: 'external' },
      { where: 'desktop, FastTreeMP ran', algorithm: 'FastTree (Approx-ML)', programs: found('FastTree (Approx-ML)'), outcome: { value: fastTree },
        callout: /^Tree from \/opt\/homebrew\/bin\/FastTreeMP\.$/,
        note: /^FastTree \(FastTree Version 2\.1\.11 Double precision \(No SSE3\), OpenMP \(8 threads\)\) ran on this computer in 0\.4 s: GTR\+Γ20 approximately-maximum-likelihood tree \(NNI \+ SPR moves\)\. Node labels: SH-like local support \(%\)\./,
        heading: 'Approximately-maximum-likelihood tree (FastTree, GTR+Γ20)', draws: 'external' },
    ];
    // The built-in tree, without its support labels: it skips the bootstrap while an installed
    // program can run, because that program reports its own support.
    const unlabelled = (newick: string) => newick.replace(/\)\d+(?=[:;,)])/g, ')');
    const builtInNewick = (algorithm: PhyloTreeAlgorithm) =>
      unlabelled(wordsOf(/<div class="newick-box"><span>[\s\S]*?<\/span><code>([\s\S]*?)<\/code>/.exec(phylo('phylogeny', algorithm))?.[1] ?? ''));
    const headings = new Map<string, Set<string>>();
    for (const c of cases) {
      desktop.programs = c.programs;
      desktop.outcome = c.outcome ?? 'pending';
      desktop.runs = [];
      const card = treeCard(mounted(
        <PhylogeneticsStudio documents={treeInputs} activeDoc={coxii} initialPhyloTab="phylogeny" initialTreeAlgorithm={c.algorithm} />));
      // The studio reached the state the case names: the callout above the tree says which tree is shown.
      const callout = wordsOf(/<div class="info-callout" role="(?:status|alert)"[^>]*>([\s\S]*?)<\/div>/.exec(card)?.[1] ?? '');
      expect(callout, `${c.where}: the callout`).toMatch(c.callout);
      expect(desktop.runs, `${c.where}: the program was started`).toEqual(c.outcome ? [c.algorithm] : []);
      // The report under the heading is the one that drew the tree, and the heading names its method.
      expect(methodNoteOf(card), `${c.where}: the method note`).toMatch(c.note);
      const heading = treeHeading(card);
      expect(heading, `${c.where}: the heading`).toBe(c.heading);
      expect(heading).not.toContain(c.algorithm);
      const newickBox = /<div class="newick-box"><span>([\s\S]*?)<\/span><code>([\s\S]*?)<\/code>/.exec(card);
      expect(wordsOf(newickBox?.[1] ?? ''), `${c.where}: the Newick label`).toBe(`Export Newick Tree String (${c.heading}):`);
      const drawn = wordsOf(newickBox?.[2] ?? '');
      if (c.draws === 'external') expect(drawn, `${c.where}: the tree drawn`).toBe(external);
      else expect(unlabelled(drawn), `${c.where}: the tree drawn`).toBe(builtInNewick(c.algorithm));
      headings.set(c.algorithm, (headings.get(c.algorithm) ?? new Set()).add(heading));
    }
    // The fixture reaches a heading keyed on the dropdown: one choice, two methods.
    expect([...headings.get('PhyML (ML + SH-aLRT)')!].sort()).toEqual(['Maximum-likelihood tree (PhyML, GTR+Γ4)', NJ]);
    expect(unlabelled(external)).not.toBe(builtInNewick('PhyML (ML + SH-aLRT)'));

    // No tree built: one sequence is no tree, whichever method is chosen.
    for (const algorithm of ['Neighbor-Joining (NJ)', 'UPGMA', 'Maximum Likelihood (ML)'] as const) {
      const card = treeCard(phylo('phylogeny', algorithm, treeInputs.slice(0, 1)));
      expect(methodNoteOf(card), `${algorithm}, one sequence: the method note`).toBe('A tree needs at least two sequences.');
      expect(treeHeading(card), `${algorithm}, one sequence: the heading`).toBe('Phylogenetic tree');
    }
  });

  it('labels the tree scale bar once in substitutions per site', () => {
    // The eight rows draw a 0.05 bar and the four primates a 0.02 bar, so a fixed label fails one.
    const labels = new Set<string>();
    for (const [algorithm, docs] of [
      ['Maximum Likelihood (ML)', treeInputs], ['UPGMA', treeInputs], ['Maximum Likelihood (ML)', treeInputs.slice(0, 4)],
    ] as const) {
      const html = phylo('phylogeny', algorithm, [...docs]);
      const fig = html.slice(html.indexOf('<div class="mbc-phylo-canvas">'), html.indexOf('</svg>', html.indexOf('<div class="mbc-phylo-canvas">')));
      expect(fig.length, 'the tree figure is drawn').toBeGreaterThan(100);
      const words = wordsOf(fig);
      expect(words.match(/subst\.\/site/g) ?? [], `${algorithm}: subst./site appears once`).toHaveLength(1);
      expect(words).not.toContain('subst/site');
      // The bar shows the engine's own label, whole.
      const newick = wordsOf(/<div class="newick-box"><span>[\s\S]*?<\/span><code>([\s\S]*?)<\/code>/.exec(html)?.[1] ?? '');
      const engine = layoutNewickPhylogeneticTreeRust(newick, 'phylogram', 620, Math.max(260, docs.length * 20 + 56));
      expect(engine.scaleBar?.label).toMatch(/^\S+ subst\.\/site$/);
      const scaleText = Array.from(fig.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g), (m) => wordsOf(m[1])).filter((t) => t.includes('subst'));
      expect(scaleText).toEqual([engine.scaleBar!.label]);
      labels.add(engine.scaleBar!.label);
    }
    expect(labels.size, 'the fixtures draw two different scale bars').toBe(2);
  });
});

// ─── AC3 ───

describe('library and storage names', () => {
  it('keeps library and storage names out of studio headings', () => {
    const fwd = byId('doc-contig-coi-fwd');
    const rev = byId('doc-contig-coi-rev');
    const renders: Record<string, string> = {
      'phylogeny': phylo('phylogeny', 'Maximum Likelihood (ML)'),
      'user tree': phylo('usertree'),
      // The assembly options and the preview open on a click: both are clicked here.
      'chromatogram': clicking([/^Contig Assembly$/, /^Run assembly preview$/], () => renderToStaticMarkup(
        <ChromatogramAndContigStudio documents={[fwd, rev]} activeDoc={fwd} selectedDocuments={[fwd, rev]} onCreateDocument={noop} />)),
      'variants': renderToStaticMarkup(<GenomicsNgsAndPredictionStudio activeDoc={plasmid} documents={[plasmid]} initialSubTab="genome-variants"
        onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop} />),
      'genes and motifs': renderToStaticMarkup(<GenomicsNgsAndPredictionStudio activeDoc={plasmid} documents={[plasmid]} initialSubTab="genes-cpg-repeats"
        onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop} />),
      'proteomics': renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={plasmid} allDocuments={SAMPLE_LIBRARY} initialSubTab="protein" />),
      'history': renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={plasmid} allDocuments={SAMPLE_LIBRARY} initialSubTab="lineage" />),
      // The command palette opens from the status bar's Navigator pill.
      'command palette': renderApp({ session: 'sample-library', clicks: [/Navigator$/] }),
    };
    for (const [view, html] of Object.entries(renders)) {
      const words = wordsOf(html);
      expect(words.match(JARGON)?.[0] ?? null, `${view}: no library or storage name in what it shows`).toBeNull();
    }

    // Each replaced heading says what it computes.
    const has = (view: string, label: string | RegExp) => {
      const labels = labelsOf(renders[view]);
      const found = typeof label === 'string' ? labels.includes(label) : labels.some((l) => label.test(l));
      expect(found, `${view}: "${label}" among ${JSON.stringify(labels)}`).toBe(true);
    };
    has('phylogeny', 'Tree (phylogram)');
    has('user tree', /^User tree topology \(8 tips • \d+ internal clades\)$/);
    has('chromatogram', 'Quality trimming (Mott) & mixed-peak IUPAC calls');
    has('chromatogram', 'P(err) cutoff 0.05');
    has('chromatogram', 'Contig assembly by partial-order alignment (POA)');
    has('chromatogram', 'Mott quality pre-trim on');
    expect(wordsOf(renders.chromatogram)).toContain('Pre-trim reads (Mott quality trimming)');
    has('variants', /^VCF coding consequences, HGVS \(HIGH: \d+ • MODERATE: \d+ • LOW: \d+\)$/);
    has('genes and motifs', /^Genome segmentation, 3-state HMM \(Viterbi path, ln P\* = -?[\d.]+\)$/);
    has('genes and motifs', /^Transcription-factor motif scan, JASPAR PWMs \(\d+ hits across \d+ matrices\)$/);
    has('proteomics', 'Proteomics LC-MS/MS Digest, b/y-Ion MS2 & PTM / Disulfide Prediction');
    has('proteomics', 'Predicted Disulfides');
    expect(wordsOf(renders.history)).toMatch(/Lineage: (Topological DAG Verified|Cyclic Graph) • \d+ nodes across \d+ layer\(s\)/);
    const palette = wordsOf(renders['command palette']);
    expect(palette).toContain('Load 500,000 bp Annotated Chromosome (benchmark)');
    expect(palette).toContain('Load 10,000 aa Multi-Domain Polyprotein (benchmark)');
  });

  it('keeps library and storage names out of studio headings, in the notices a run leaves', () => {
    // Loading the benchmark chromosome from the palette leaves a notice in the status bar.
    const html = renderApp({ session: 'sample-library', clicks: [/Navigator$/, /^Load 500,000 bp Annotated Chromosome/] });
    const banner = wordsOf(/<span class="statusbar-toast-text">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? '');
    expect(banner).toMatch(/^Loaded ".+" \(500,000 bp, \d+ annotations; [\d,]+ KiB held in memory\)$/);
    expect(banner).not.toMatch(JARGON);
    // Choosing the polyprotein again switches to the one already loaded, with its own notice.
    const again = renderApp({ session: 'sample-library', clicks: [/Navigator$/, /^Load 10,000 aa Multi-Domain Polyprotein/, /Navigator$/, /^Load 10,000 aa Multi-Domain Polyprotein/] });
    const switched = wordsOf(/<span class="statusbar-toast-text">([\s\S]*?)<\/span>/.exec(again)?.[1] ?? '');
    expect(switched).toMatch(/^Switched to benchmark document ".+" \(10,000 aa\)$/);

    // Annotating the HMM segments hands the App the notice it shows in the status bar.
    const notices: string[] = [];
    clicking([/^\+ Annotate HMM Segments$/], () => renderToStaticMarkup(
      <GenomicsNgsAndPredictionStudio activeDoc={plasmid} documents={[plasmid]} initialSubTab="genes-cpg-repeats"
        onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={(_features, summary) => notices.push(summary)} />));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^Annotated \d+ HMM segment\(s\) \(Viterbi path\)$/);
  });
});

// ─── AC4 ───

describe('studio badges', () => {
  const DECORATIVE = [
    '10-Method Cloning Suite', 'Sequence Alignment', 'Topology Evaluator', 'Gene Family Reconciliation', 'Clock Hypotheses',
    'Primers & CRISPR Suite', 'Protein structure tools', 'Sequence analysis tools', '4-Slot Core Cassette + Modular Tracks',
    '11 Component Classes', 'Homology Cloning', 'CRISPR + Golden Gate + RBS Macros',
  ];

  it('drops decorative badges and keeps the ones that carry a value', () => {
    const structA = byId('doc-prot-1d66-gal4-dna');
    const structB = byId('doc-prot-1a4y-rnase-angiogenin');
    const genomics = (doc: SequenceDocument, tab?: 'protein-3d') => renderToStaticMarkup(
      <GenomicsNgsAndPredictionStudio activeDoc={doc} documents={[doc, structB]} proteinDocuments={[structA, structB]}
        selectedDocuments={tab ? [structA, structB] : []} {...(tab ? { initialSubTab: tab } : {})}
        onCreateDocument={noop} onUpdateActiveSequence={noop} onAppendFeatures={noop} />);
    const vectors = (tab: 'architect' | 'parts' | 'twist-onboarding') => renderToStaticMarkup(
      <VectorLibraryAndDesignStudio activeDoc={plasmid} documents={SAMPLE_LIBRARY} initialSubTab={tab}
        onAddDocument={noop} onInsertPartIntoActiveDoc={noop} />);
    // Each decorative badge, rendered at the view that drew it.
    const renders: Record<string, string> = {
      cloning: renderToStaticMarkup(<CloningAndGelStudio documents={SAMPLE_LIBRARY} activeDoc={plasmid} onAddConstruct={noop} />),
      alignment: renderToStaticMarkup(<SequenceAlignmentStudio documents={treeInputs} activeDoc={coxii} />),
      'user tree': phylo('usertree'),
      clocks: phylo('clocks'),
      primers: renderToStaticMarkup(<PrimerAndPCRStudio doc={plasmid} allDocuments={SAMPLE_LIBRARY} onUpdateDocument={noop} onAddConstruct={noop} />),
      'genomics (DNA)': genomics(plasmid),
      'genomics (structure)': genomics(structA, 'protein-3d'),
      'vector architect': vectors('architect'),
      'vector parts': vectors('parts'),
      'vector clonal insertion': vectors('twist-onboarding'),
      workflows: renderToStaticMarkup(<HybridToolsAndHistoryStudio doc={plasmid} allDocuments={SAMPLE_LIBRARY} initialSubTab="workflows" />),
      phylogeny: phylo('phylogeny'),
    };
    // Before this story the views above drew all 12; each is checked in the view that drew it.
    const where: Record<string, string[]> = {
      cloning: ['10-Method Cloning Suite'],
      alignment: ['Sequence Alignment'],
      'user tree': ['Topology Evaluator', 'Gene Family Reconciliation'],
      clocks: ['Clock Hypotheses'],
      primers: ['Primers & CRISPR Suite'],
      'genomics (DNA)': ['Sequence analysis tools'],
      'genomics (structure)': ['Protein structure tools'],
      'vector architect': ['4-Slot Core Cassette + Modular Tracks'],
      'vector parts': ['11 Component Classes'],
      'vector clonal insertion': ['Homology Cloning'],
      workflows: ['CRISPR + Golden Gate + RBS Macros'],
    };
    expect(Object.values(where).flat().sort()).toEqual([...DECORATIVE].sort());
    for (const [view, html] of Object.entries(renders)) {
      const badges = badgesOf(html);
      for (const word of DECORATIVE) expect(badges, `${view}: no "${word}" badge`).not.toContain(word);
      // A badge emptied of its words is still a pill on screen.
      expect(badges.filter((b) => b === ''), `${view}: no empty badge`).toEqual([]);
    }
    for (const [view, words] of Object.entries(where)) {
      // The words are gone from the view, not moved into another element. ("Sequence Alignment"
      // is also part of other text there, such as "Multiple Sequence Alignment (MSA)".)
      const shown = wordsOf(renders[view]);
      for (const w of words) if (w !== 'Sequence Alignment') expect(shown, `${view}: "${w}" is not shown`).not.toContain(w);
    }

    // Badges that carry a value stay: bootstrap replicates on the tree card, Cα pairs and TM≈ on the 3D viewer.
    expect(badgesOf(treeCard(renders.phylogeny)).some((b) => /^\d+ bootstrap replicates$/.test(b)), 'bootstrap badge').toBe(true);
    const stage = renders['genomics (structure)'].slice(renders['genomics (structure)'].indexOf('protein-3d-viewer-stage'));
    const viewer = badgesOf(stage.slice(0, stage.indexOf('<select')));
    expect(viewer.some((b) => /^\d+ Cα pairs$/.test(b)), `Cα pairs badge among ${JSON.stringify(viewer)}`).toBe(true);
    expect(viewer.some((b) => /^TM≈ [\d.]+$/.test(b)), 'TM≈ badge').toBe(true);
    // And the module picker's badge, which names the methods the module offers.
    expect(badgesOf(renders.phylogeny)).toContain('NJ • UPGMA • Bootstrap • Parsimony & likelihood scores');
  });
});

// ─── AC5 ───

describe('operation dialog titles', () => {
  /** The words of the element the dialog's aria-labelledby names, and that id. */
  function dialogTitle(html: string): { id: string; words: string } {
    const id = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(id, 'the dialog names its title').not.toBe('');
    const m = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
    expect(m, `an element has id ${id}`).not.toBeNull();
    return { id, words: wordsOf(m![2]) };
  }
  const dialog = (title: string) => renderToStaticMarkup(
    <OperationDialog operationId="build-tree" title={title} summary="8 sequences" defaults={{}}
      renderOptions={() => null} onRun={noop} onClose={noop} />);

  it('titles operation dialogs without the menu ellipsis', () => {
    expect(dialogTitle(dialog('Build Tree…'))).toEqual({ id: 'opdlg-build-tree', words: 'Build Tree' });
    // A title with no ellipsis is shown as given, and only the one trailing ellipsis goes.
    expect(dialogTitle(dialog('Build Tree')).words).toBe('Build Tree');
    expect(dialogTitle(dialog('Find… Repeats…')).words).toBe('Find… Repeats');

    // The dialogs the menus open: their titles keep "…" in the source, the title shown has none.
    const inputs = phylogenySourceDocuments(coxii, [], SAMPLE_LIBRARY);
    expect(dialogTitle(renderToStaticMarkup(<BuildTreeOperationDialog inputs={inputs} sourceLabel="COXII CDS" onCreate={noop} onClose={noop} />)))
      .toEqual({ id: 'opdlg-build-tree', words: 'Build Tree' });
    expect(dialogTitle(renderToStaticMarkup(<AlignOperationDialog inputs={inputs} sourceLabel="COXII CDS" onCreate={noop} onClose={noop} />)))
      .toEqual({ id: 'opdlg-align-multiple', words: 'Multiple Alignment' });

    // Chosen from the App's own menu, the window the item opens is titled without it.
    const opened = renderApp({ session: 'sample-library', choose: (menus) => {
      const item = findCommand(menus, 'Build Tree…');
      expect(item, 'Build Tree… on the web menu').not.toBeNull();
      item!.onSelect();
    } });
    expect(dialogTitle(opened)).toEqual({ id: 'opdlg-build-tree', words: 'Build Tree' });
  });
});

// ─── AC6, AC7 ───

describe('the status bar and the view tabs', () => {
  const footerOf = (html: string) => {
    const m = /<footer class="mbc-statusbar"[^>]*>([\s\S]*?)<\/footer>/.exec(html);
    expect(m, 'the status bar is drawn').not.toBeNull();
    return m![1];
  };

  it('shows no host operating system in the status bar', () => {
    const arch = detectCpuArch();
    // The names of the three platforms the App detects, compared in lower case, so neither
    // "MACOS" nor "OS: macos" nor "Windows" passes.
    const OS_NAMES = ['macos', 'mac os', 'os x', 'darwin', 'windows', 'win32', 'linux'];
    for (const os of ['macos', 'windows', 'linux'] as const) {
      host.os = os;
      host.asked = 0;
      const footers = { 'no session': footerOf(renderToStaticMarkup(<App />)), 'sample library': footerOf(renderApp({ session: 'sample-library' })) };
      expect(host.asked, `${os}: the App asked which platform it runs on`).toBeGreaterThan(0);
      for (const [state, footer] of Object.entries(footers)) {
        const words = wordsOf(footer);
        const where = `${os}, ${state}`;
        expect(words.toLowerCase(), where).not.toContain('host os');
        // Not the OS or the architecture either, under any prefix or casing.
        for (const name of OS_NAMES) expect(words.toLowerCase(), `${where}: no "${name}"`).not.toContain(name);
        expect(words.toLowerCase(), where).not.toContain(`(${arch.toLowerCase()})`);
        // The shortcut hints follow the platform the App detected (⌘ on macOS, Ctrl elsewhere).
        expect(words, where).toContain(`${formatPlatformShortcut('O', os)} Open`);
        // The Navigator pill, the licence pill and the shortcut hints stay.
        expect(footer, where).toMatch(/<button[^>]*class="statusbar-engine-pill"[^>]*>[^<]*Navigator<\/button>/);
        expect(footer, where).toMatch(/<button[^>]*class="statusbar-license-pill"/);
      }
      const sc = (key: string) => formatPlatformShortcut(key, os);
      expect(wordsOf(footers['no session']), os).toContain(`${sc('N')} New Session • ${sc('I')} Import • ${sc('O')} Open`);
    }
    // macOS draws different hints from Windows and Linux, so the platform set above reaches the footer.
    expect(formatPlatformShortcut('O', 'macos')).not.toBe(formatPlatformShortcut('O', 'windows'));
  });

  it('shows view tab arrows only when the tabs overflow', () => {
    const html = renderApp({ session: 'sample-library' });
    const at = html.search(/<div class="mbc-scroll-strip [^"]*mbc-scroll-strip--header-tabs[^"]*"/);
    expect(at, 'the view tab strip is drawn').toBeGreaterThan(-1);
    const cls = /class="([^"]*)"/.exec(html.slice(at))![1].split(/\s+/);
    expect(cls).toContain('auto-arrows');
    expect(cls).not.toContain('always-arrows');
    // The strip's own markup: up to the </div> that closes the strip's <div>.
    let depth = 0;
    let end = at;
    for (const m of html.slice(at).matchAll(/<div\b|<\/div>/g)) {
      depth += m[0] === '</div>' ? -1 : 1;
      if (depth === 0) { end = at + m.index! + m[0].length; break; }
    }
    const strip = html.slice(at, end);
    expect(strip).toMatch(/^<div[\s\S]*<\/div>$/);
    expect(strip).toContain('mbc-scroll-sentinel-end');
    expect(strip).toContain('role="tablist"');
    expect(strip).not.toContain('mbc-menu-slide-btn');
    // The document tab strip is unchanged by this.
    expect(html).toMatch(/<div class="mbc-scroll-strip [^"]*mbc-scroll-strip--doc-tabs/);
  });
});

// ─── AC8 ───

describe('a trace too short to be a read', () => {
  const studio = (doc: SequenceDocument) => mottSection(renderToStaticMarkup(
    <ChromatogramAndContigStudio documents={[doc]} activeDoc={doc} onCreateDocument={noop} />));
  const saveButton = (section: string) => /<button type="button" class="([^"]+)"[^>]*>\+ Save Mott-Trimmed HQ Read \((\d+) bp\)<\/button>/.exec(section);
  const warningOf = (section: string) => /<div[^>]*role="(?:status|alert)"[^>]*>([\s\S]*?)<\/div>/.exec(section);

  it('warns before offering to save a trace under 20 bp', () => {
    const lowEnds = [...new Array(6).fill(2), ...new Array(13).fill(40), ...new Array(6).fill(2)];
    const cases = [
      { doc: traceDoc('short5', new Array(5).fill(40)), raw: 5 },
      // 25 bases, trimmed to the 13 good ones: the length Save would write is what counts.
      { doc: traceDoc('trims-short', lowEnds), raw: 25 },
      // 20 bp is the first length that is not warned about.
      { doc: traceDoc('edge20', new Array(20).fill(40)), raw: 20 },
      { doc: traceDoc('long30', new Array(30).fill(40)), raw: 30 },
    ];
    for (const { doc, raw } of cases) {
      const trimmed = trimSangerTraceMottPhredRust(doc.chromatogram!, 0.05).trimmedLengthBp;
      expect(doc.sequence.length).toBe(raw);
      const section = studio(doc);
      const save = saveButton(section);
      expect(save, `${doc.id}: the Save button is offered`).not.toBeNull();
      expect(Number(save![2])).toBe(trimmed);
      const warning = warningOf(section);
      if (trimmed < 20) {
        expect(warning, `${doc.id}: a warning (${trimmed} bp)`).not.toBeNull();
        expect(wordsOf(warning![1])).toBe(`${trimmed} bp after trimming is too short to use as a read.`);
        expect(section.indexOf(warning![0]), 'the warning comes before Save').toBeLessThan(section.indexOf(save![0]));
        expect(save![1]).toBe('btn-secondary-sm');
      } else {
        expect(warning, `${doc.id}: no warning at ${trimmed} bp`).toBeNull();
        expect(save![1]).toBe('btn-primary-sm');
      }
    }
    // The fixtures reach both sides of the threshold, and the raw length alone would mislead.
    const lengths = cases.map(({ doc }) => trimSangerTraceMottPhredRust(doc.chromatogram!, 0.05).trimmedLengthBp);
    expect(lengths[0]).toBe(5);
    expect(lengths[1]).toBe(13);
    expect(lengths[2]).toBe(20);
    expect(lengths[3]).toBe(30);
  });
});

// ─── BG-01M6RC3J ───

/**
 * A trim claims a high-quality region only when the qualities support one. The Mott trim keeps
 * nothing (1..0) when no stretch of bases beats the cutoff (BG-01M6RPCA; it used to keep the whole
 * read), and keeps the whole read when the read has no quality value for every call, so the studio
 * cannot take its coordinates as they come. Wrong implementations, and the case that catches each:
 * - showing the trim's coordinates as they come (the bug): empty.ab1, 310.ab1, ABI01.abi;
 * - asking only whether the file has quality values: empty.ab1, 310.ab1;
 * - asking only whether some base beats the cutoff, which a read with no qualities passes when its
 *   missing values are read as error-free: ABI01.abi;
 * - taking a short read as the only one with no region: 310.ab1 (868 bp);
 * - one message for both causes: ABI01.abi against empty.ab1;
 * - no region whenever any base is Q0, or unless every base beats the cutoff: 3730.ab1, whose
 *   trimmed region still shows;
 * - no region only when every quality is 0: the 30-base Q13 read;
 * - no region whenever the trim kept the whole read: the Q14 read;
 * - the trim report's expected errors against the cutoff: the three-base Q13 read (they are
 *   rounded to 0.15, under 0.05 × 3 in floating point);
 * - the trimming section gated at 0.05 rather than the chosen cutoff, the HQ window at the chosen
 *   cutoff rather than its 0.05, or a base at the cutoff counted as better than it: the cutoff test;
 * - an HQ window that does not name the cutoff it is fixed at, beside a trim at another: the cutoff
 *   test;
 * - a read scored for all but one call taken as scored (its trim reports 1..30 at a mean of Q38.7),
 *   or said to have no quality values: the 29-for-30 read;
 * - a quality count checked only for falling short of the calls: the 31-for-30 read;
 * - another wording for a read with no quality values on any surface, or for a sequence with no
 *   trace: the one-wording test;
 * - the trim's own mixed-peak count labelled as the whole read's: the read with two mixed peaks and
 *   no good base, under the engine's trim, which keeps nothing of such a read (BG-01M6RPCA);
 * - the whole read's count given as the region's beside a region: the same peaks, with good bases
 *   between bad ends.
 * Biopython 1.88 reads empty.ab1 with its PCON quality tags present and every value 0:
 *   r = SeqIO.read("empty.ab1", "abi"); r.letter_annotations["phred_quality"]  # [0, 0, 0, 0, 0]
 */
describe('a trace with no usable quality', () => {
  const have = haveTestData('biopython-abi/empty.ab1', 'biopython-abi/310.ab1', 'biopython-abi/3730.ab1');
  const NO_REGION = 'No high-quality region';
  const NO_QUALITY = 'No quality values in this file';
  /** The same, as a table cell says it. */
  const NO_QUALITY_SHORT = 'No quality values';
  /** How the HQ-window surfaces name the cutoff they are fixed at. */
  const AT_005 = '(P(err) cutoff 0.05)';
  type Surfaces = ReturnType<typeof surfaces>;

  /** `doc` read from a file that holds these quality values, whatever its calls. */
  const withQualities = (doc: SequenceDocument, phredScores: number[]): SequenceDocument =>
    ({ ...doc, chromatogram: { ...doc.chromatogram!, phredScores } });

  /**
   * Every surface that shows the trim, from one render with the Parameters tab and both sidebar
   * panels open; with the trimming cutoff changed from 0.05 to `cutoff`, and `reference` chosen to
   * compare the read against, when they are given.
   */
  function surfaces(doc: SequenceDocument, { cutoff, reference }: { cutoff?: string; reference?: SequenceDocument } = {}) {
    if (cutoff) clicker.choices.push({ from: '0.05', to: cutoff, done: false });
    if (reference) clicker.choices.push({ from: '', to: reference.id, done: false });
    const html = clicking([/^Parameters$/, /^Quality Trimming$/, /^Trace Statistics$/], () => renderToStaticMarkup(
      <ChromatogramAndContigStudio documents={reference ? [doc, reference] : [doc]} activeDoc={doc} onCreateDocument={noop} />));
    for (const c of clicker.choices) expect(c.done, `a select was changed to ${c.to}`).toBe(true);
    clicker.choices.length = 0;
    expect(html, `${doc.name}: the read is the one drawn`).toContain(`${doc.sequence.length.toLocaleString()} bp Sanger Trace`);
    const section = mottSection(html);
    // (the section runs to the next one, or to the end of the render: stop it at the sidebar)
    const mott = section.slice(0, section.includes('<aside') ? section.indexOf('<aside') : undefined);
    const pairs = (re: RegExp, from: string) => Object.fromEntries(Array.from(from.matchAll(re), (m) => [wordsOf(m[1]), wordsOf(m[2])]));
    const jump = /<button([^>]*)>Jump to HQ Start<\/button>/.exec(html);
    const params = /<div><strong>(HQ Trim Range[^<]*)<\/strong>([^<]*)<\/div>/.exec(html);
    const meanLine = /<strong>Mean Phred Quality &amp; SNR:<\/strong>([^<]*)<\/div>/.exec(html);
    const cockpit = /<span title="High-quality trim window">([\s\S]*?)<\/span>/.exec(html);
    const quality = /<span title="Per-base quality values">([\s\S]*?)<\/span>/.exec(html);
    const warning = /<div[^>]*role="status"[^>]*>([\s\S]*?)<\/div>/.exec(mott);
    // The Phred cell of the first variant row: the sixth, after position, trace base, type, reference and call.
    const mapped = html.indexOf('Contig Reference Mapping');
    const variantRow = mapped === -1 ? null : /<tbody>\s*<tr>([\s\S]*?)<\/tr>/.exec(html.slice(mapped, html.indexOf('<div class="contig-variants-section mbc-studio-isolated-region"')));
    const variant = variantRow ? Array.from(variantRow[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (m) => m[1])[5] ?? null : null;
    if (reference) expect(variant, `${doc.name}: a variant against ${reference.name} is listed`).not.toBeNull();
    return {
      id: `${doc.name} (${doc.sequence.length} bp${cutoff ? `, cutoff ${cutoff}` : ''})`,
      cutoffBadge: badgesOf(mott)[0],
      cockpit: cockpit ? wordsOf(cockpit[1]) : null,
      quality: quality ? wordsOf(quality[1]) : null,
      meanQ: /<strong>Mean Q:<\/strong>/.test(html),
      horizon: /<title>High-quality trim window ([^<]*)<\/title>/.exec(html)?.[1] ?? null,
      jump: jump ? { disabled: /\bdisabled=""/.test(jump[1]), title: /\btitle="([^"]*)"/.exec(jump[1])?.[1] ?? '' } : null,
      parametersLabel: params ? wordsOf(params[1]) : null,
      parameters: params ? wordsOf(params[2]).split(' • ')[0] : null,
      parametersQuality: meanLine ? wordsOf(meanLine[1]).split(' • ')[0] : null,
      variantQuality: variant === null ? null : wordsOf(variant),
      kpis: pairs(/<span class="kpi-label"[^>]*>([\s\S]*?)<\/span><strong class="kpi-val"[^>]*>([\s\S]*?)<\/strong>/g, mott),
      stats: pairs(/<div class="stat-kv"><span>([^<]*)<\/span><strong>([\s\S]*?)<\/strong><\/div>/g, html),
      warning: warning ? wordsOf(warning[1]) : null,
      save: /<button type="button" class="([^"]+)"[^>]*>\+ Save Mott-Trimmed HQ Read \((\d+) bp\)<\/button>/.exec(mott),
      mottWords: wordsOf(mott),
    };
  }

  /**
   * The HQ window surfaces (cockpit, horizon, Jump to HQ Start, parameters tab, Trace Statistics) say
   * why there is none. A read whose qualities score every call keeps its quality figures; one whose
   * qualities cannot be used says why in their place, and shows no mean quality.
   */
  function windowNone(s: Surfaces, why: string) {
    const scored = why === NO_REGION;
    expect(s.cockpit, `${s.id}: cockpit HQ window`).toBe(scored ? `HQ Window ${AT_005}: ${NO_REGION}` : null);
    expect(s.quality, `${s.id}: cockpit quality`).toBe(scored ? null : `Quality: ${why}`);
    expect(s.meanQ, `${s.id}: cockpit mean Q`).toBe(scored);
    expect(s.horizon, `${s.id}: no HQ outline on the quality horizon`).toBeNull();
    expect(s.jump, `${s.id}: Jump to HQ Start is offered`).not.toBeNull();
    expect(s.jump!.disabled, `${s.id}: Jump to HQ Start is disabled`).toBe(true);
    expect(s.jump!.title.startsWith(why), `${s.id}: Jump to HQ Start says why ("${s.jump!.title}")`).toBe(true);
    expect(s.parametersLabel, `${s.id}: parameters tab`).toBe(`HQ Trim Range ${AT_005} & Heterozygote Peaks:`);
    expect(s.parameters, `${s.id}: parameters tab`).toBe(why);
    if (scored) expect(s.parametersQuality, `${s.id}: parameters tab mean quality`).toMatch(/^Q\d+\.\d$/);
    else expect(s.parametersQuality, `${s.id}: parameters tab mean quality`).toBe(why);
    expect(s.stats[`HQ Trim Window ${AT_005}`], `${s.id}: Trace Statistics`).toBe(scored ? NO_REGION : undefined);
    expect(s.stats['Per-Base Quality'], `${s.id}: Trace Statistics`).toBe(scored ? undefined : why);
    expect(s.stats['Mean Phred'] !== undefined, `${s.id}: Trace Statistics mean Phred`).toBe(scored);
    if (s.variantQuality !== null && !scored) {
      expect(s.variantQuality, `${s.id}: variant quality`).toBe(why === NO_QUALITY ? NO_QUALITY_SHORT : why);
    }
  }

  /** The HQ window surfaces show the window `at`, naming the cutoff it is fixed at. */
  function windowAt(s: Surfaces, at: string) {
    expect(s.cockpit, `${s.id}: cockpit`).toBe(`HQ Window ${AT_005}: ${at} bp`);
    expect(s.quality, `${s.id}: cockpit quality`).toBeNull();
    expect(s.horizon, `${s.id}: HQ outline`).toBe(`${at} bp ${AT_005}`);
    expect(s.jump, `${s.id}: Jump to HQ Start`).toEqual({ disabled: false, title: 'Move the chromatogram window to the start of the high-quality region' });
    expect(s.parametersLabel, `${s.id}: parameters tab`).toBe(`HQ Trim Range ${AT_005} & Heterozygote Peaks:`);
    expect(s.parameters, `${s.id}: parameters tab`).toBe(`${at} bp`);
    expect(s.stats[`HQ Trim Window ${AT_005}`], `${s.id}: Trace Statistics`).toBe(at);
  }

  /**
   * The trimming surfaces (KPIs, warning, Save, Quality Trimming panel) say why there is none, with
   * no mean Phred, and count mixed peaks over the whole read. A read whose qualities score every call
   * and miss the cutoff is trimmed to 0 bp, which is too short to use; a read the trim cannot score
   * was not trimmed, so it is given no kept length and is not called too short.
   */
  function trimNone(s: Surfaces, doc: SequenceDocument, why: string) {
    const n = doc.sequence.length;
    const scored = why === NO_REGION;
    expect(s.kpis['Trim Result'], `${s.id}: trim result`).toBe(scored ? NO_REGION : 'Not trimmed');
    expect(s.kpis['Reason'], `${s.id}: why it was not trimmed`).toBe(scored ? undefined : why);
    expect(s.kpis['HQ Trim Coordinates'], `${s.id}: no trim coordinates`).toBeUndefined();
    expect(s.kpis['Mean Trimmed Phred'], `${s.id}: no mean Phred`).toBeUndefined();
    expect(s.mottWords, `${s.id}: no Phred value in the trimming section`).not.toMatch(/\bQ\d/);
    // Expected errors are counted over the whole read when its qualities miss the cutoff, and not at all without usable qualities.
    const errors = doc.chromatogram!.phredScores.reduce((e, q) => e + 10 ** (-q / 10), 0);
    expect(s.kpis['Expected Base Errors'], `${s.id}: expected errors`).toBe(scored ? `${errors.toFixed(2)} in ${n} bp` : undefined);
    expect(s.kpis['Mixed IUPAC Double Peaks'], `${s.id}: mixed peaks`).toBe(`${mixedPeaksOf(doc.chromatogram!)} over the whole read`);
    expect(s.warning, `${s.id}: short-read warning`).toBe(scored ? '0 bp after trimming is too short to use as a read.' : null);
    expect(s.save, `${s.id}: no Save button`).toBeNull();
    expect(s.stats['HQ Window'], `${s.id}: Quality Trimming panel`).toBe(why);
    expect(s.stats['Trimmed Length'], `${s.id}: Quality Trimming panel`).toBe(scored ? `0 / ${n} bp` : 'Not trimmed');
    if (!scored) expect(s.mottWords, `${s.id}: no kept length in the trimming section`).not.toMatch(/\b0 bp\b/);
  }

  /** The trimming surfaces show the trim's region as the trim reports it, and its mixed peaks inside it of the read's. */
  function trimAt(s: Surfaces, doc: SequenceDocument, t: ReturnType<typeof trimSangerTraceMottPhredRust>) {
    const at = `${t.trimStart1based}..${t.trimEnd1based}`;
    expect(s.kpis['HQ Trim Coordinates'], `${s.id}: trim coordinates`).toBe(`${at} (${t.trimmedLengthBp} / ${t.rawLengthBp} bp)`);
    expect(s.kpis['Mean Trimmed Phred'], `${s.id}: mean Phred`).toBe(`Q${t.meanPhredTrimmed.toFixed(1)}`);
    expect(s.kpis['Trim Result'], `${s.id}: no trim result note`).toBeUndefined();
    expect(s.kpis['Mixed IUPAC Double Peaks'], `${s.id}: mixed peaks in the region`)
      .toBe(`${t.heterozygoteCount} of ${mixedPeaksOf(doc.chromatogram!)} in the trimmed region`);
    expect(s.save?.[2], `${s.id}: Save`).toBe(String(t.trimmedLengthBp));
    expect(s.warning, `${s.id}: ${t.trimmedLengthBp} bp is long enough to be a read`).toBeNull();
    expect(s.stats['HQ Window'], `${s.id}: Quality Trimming panel`).toBe(at);
    expect(s.stats['Trimmed Length'], `${s.id}: Quality Trimming panel`).toBe(`${t.trimmedLengthBp} / ${t.rawLengthBp} bp`);
  }

  const expectNoRegion = (doc: SequenceDocument, why: string, reference?: SequenceDocument) => {
    const s = surfaces(doc, { reference });
    windowNone(s, why);
    trimNone(s, doc, why);
    return s;
  };
  const expectRegion = (doc: SequenceDocument) => {
    const t = trimSangerTraceMottPhredRust(doc.chromatogram!, 0.05);
    const s = surfaces(doc);
    windowAt(s, `${t.trimStart1based}..${t.trimEnd1based}`);
    trimAt(s, doc, t);
    return t;
  };

  /** A reference that differs from `doc`'s calls at call 16, with flanks: the read maps onto it with one SNP. */
  const referenceFor = (doc: SequenceDocument): SequenceDocument => {
    const calls = doc.chromatogram!.baseCalls;
    const sequence = `GATTACA${calls.slice(0, 15)}${calls[15] === 'A' ? 'C' : 'A'}${calls.slice(16)}GATTACA`;
    return { ...doc, id: `${doc.id}-ref`, name: `${doc.id}_ref.fasta`, sequence, documentKind: undefined, chromatogram: undefined };
  };

  it.skipIf(!have)('reports no high-quality region for a trace with no usable quality', async () => {
    const empty = parseDnaBinaryPacket(await bytesOf(dataPath('biopython-abi/empty.ab1')), 'empty.ab1');
    const q0 = parseDnaBinaryPacket(await bytesOf(dataPath('biopython-abi/310.ab1')), '310.ab1');
    // A read of 628 calls written as ABIF with no quality tags (traceFixtures.ts), every 19th call
    // from the 8th a mixed peak: 33 of them.
    const mixedCall = (i: number) => i % 19 === 7;
    const noQualityRead = seededChromatogram(0xab1f0004, 628, mixedCall);
    const noQuality = parseDnaBinaryPacket(abifWithoutQualities(noQualityRead, 'seeded-no-quality'), 'no_quality.ab1');
    const noQualityMixed = Array.from({ length: 628 }, (_, i) => i).filter(mixedCall).length;
    const usable = parseDnaBinaryPacket(await bytesOf(dataPath('biopython-abi/3730.ab1')), '3730.ab1');
    // The fixtures are the cases they stand for.
    expect(empty.chromatogram!.phredScores).toEqual([0, 0, 0, 0, 0]);
    expect([q0.sequence.length, q0.chromatogram!.phredScores.length, Math.max(...q0.chromatogram!.phredScores)]).toEqual([868, 868, 0]);
    expect([noQuality.sequence.length, noQuality.chromatogram!.phredScores.length]).toEqual([628, 0]);
    expect([noQuality.sequence, noQuality.chromatogram!.peakLocations, noQualityMixed]).toEqual([noQualityRead.baseCalls, noQualityRead.peakLocations, 33]);
    expect(usable.chromatogram!.phredScores.slice(0, 15).filter((q) => q === 0)).toHaveLength(4);
    // The trim keeps nothing of a read with no good base (BG-01M6RPCA), and the whole of a read it
    // cannot score: the studio must show neither as a region.
    for (const doc of [empty, q0]) {
      const t = trimSangerTraceMottPhredRust(doc.chromatogram!, 0.05);
      expect([t.trimStart1based, t.trimEnd1based, t.trimmedLengthBp]).toEqual([1, 0, 0]);
    }
    const unscored = trimSangerTraceMottPhredRust(noQuality.chromatogram!, 0.05);
    expect([unscored.trimStart1based, unscored.trimEnd1based]).toEqual([1, noQuality.sequence.length]);
    // Mixed peaks over the whole read; the written read has the 33 it was given; 3730.ab1 has 23,
    // of which its trimmed region keeps 1.
    expect([empty, q0, noQuality, usable].map((d) => mixedPeaksOf(d.chromatogram!))).toEqual([3, 311, noQualityMixed, 23]);

    expectNoRegion(empty, NO_REGION);
    expectNoRegion(q0, NO_REGION);
    expectNoRegion(noQuality, NO_QUALITY);
    const t = expectRegion(usable);
    expect([t.trimStart1based, t.trimEnd1based, t.trimmedLengthBp, t.rawLengthBp, t.meanPhredTrimmed, t.heterozygoteCount]).toEqual([15, 1090, 1076, 1165, 47.7, 1]);
  });

  it('tells qualities that all miss the cutoff from a trim that keeps the whole read', () => {
    // P(err) at Q13 is 0.050, just over the 0.05 cutoff; at Q14 it is 0.040, under it.
    expectNoRegion(traceDoc('allQ13', new Array(30).fill(13)), NO_REGION);
    expectNoRegion(traceDoc('threeQ13', [13, 13, 13]), NO_REGION);
    const t = expectRegion(traceDoc('allQ14', new Array(30).fill(14)));
    expect([t.trimStart1based, t.trimEnd1based]).toEqual([1, 30]);
  });

  it('trims at the chosen cutoff, and keeps the HQ window at its own', () => {
    // Q17 (P(err) 0.020) passes the HQ window's 0.05 and misses a 0.01 cutoff: the window names its 0.05.
    const q17 = traceDoc('allQ17', new Array(30).fill(17));
    const strict = surfaces(q17, { cutoff: '0.01' });
    expect(strict.cutoffBadge).toBe('P(err) cutoff 0.01');
    windowAt(strict, '1..30');
    trimNone(strict, q17, NO_REGION);
    // Q10's P(err) is the 0.1 cutoff itself, which is no better than it; it misses the HQ window's 0.05 too.
    const q10 = traceDoc('allQ10', new Array(30).fill(10));
    const relaxed = surfaces(q10, { cutoff: '0.1' });
    expect(relaxed.cutoffBadge).toBe('P(err) cutoff 0.1');
    windowNone(relaxed, NO_REGION);
    trimNone(relaxed, q10, NO_REGION);
  });

  it('tells a read with a quality value for all but one call from a read with none', () => {
    // 30 calls scored Q40 but the last: a file whose PCON is one value short of its PBAS calls.
    const short = withQualities(traceDoc('short29', new Array(30).fill(40)), new Array(29).fill(40));
    // A file whose PBAS calls were filtered to fewer than its PCON values: one value too many.
    const long = withQualities(traceDoc('long31', new Array(30).fill(40)), new Array(31).fill(40));
    const none = withQualities(traceDoc('none30', new Array(30).fill(40)), []);
    // The trim keeps all 30 calls of each, and reports the short read as a region at a mean of Q38.7.
    for (const doc of [short, long, none]) {
      const t = trimSangerTraceMottPhredRust(doc.chromatogram!, 0.05);
      expect([t.trimStart1based, t.trimEnd1based, t.trimmedLengthBp]).toEqual([1, 30, 30]);
    }
    expect(trimSangerTraceMottPhredRust(short.chromatogram!, 0.05).meanPhredTrimmed).toBe(38.7);

    expectNoRegion(short, '29 quality values for 30 base calls', referenceFor(short));
    expectNoRegion(long, '31 quality values for 30 base calls', referenceFor(long));
    expectNoRegion(none, NO_QUALITY, referenceFor(none));
    // The same calls scored at every one are a read with a region.
    expectRegion(traceDoc('full30', new Array(30).fill(40)));
  });

  it('says a read has no quality values in one wording on every surface', () => {
    const none = withQualities(traceDoc('noneOneWording', new Array(30).fill(40)), []);
    const s = surfaces(none, { reference: referenceFor(none) });
    expect({
      cockpit: s.quality,
      parametersQuality: s.parametersQuality,
      parametersHqWindow: s.parameters,
      jumpToHqStart: s.jump?.title,
      traceStatistics: s.stats['Per-Base Quality'],
      trimReason: s.kpis['Reason'],
      qualityTrimming: s.stats['HQ Window'],
      variantQuality: s.variantQuality,
    }).toEqual({
      cockpit: 'Quality: No quality values in this file',
      parametersQuality: 'No quality values in this file',
      parametersHqWindow: 'No quality values in this file',
      jumpToHqStart: 'No quality values in this file, so the read has no high-quality region',
      traceStatistics: 'No quality values in this file',
      trimReason: 'No quality values in this file',
      qualityTrimming: 'No quality values in this file',
      variantQuality: 'No quality values',
    });
    // A read scored at every call shows the variant's own quality in that cell instead.
    const scored = traceDoc('scoredOneWording', new Array(30).fill(40));
    expect(surfaces(scored, { reference: referenceFor(scored) }).variantQuality).toBe('Q40 (error p = 0.00010)');
    // A sequence with no trace, which need not come from a file, says it short.
    expect(plasmid.chromatogram).toBeUndefined();
    const sequenceOnly = clicking([/^Quality Trimming$/, /^Trace Statistics$/], () => renderToStaticMarkup(
      <ChromatogramAndContigStudio documents={[plasmid]} activeDoc={plasmid} onCreateDocument={noop} />));
    const trimmingPanel = sequenceOnly.slice(sequenceOnly.indexOf('<span>Quality Trimming</span>'), sequenceOnly.indexOf('<span>Contig Assembly</span>'));
    expect({
      qualityTrimming: /<p class="mbc-accordion-note">([^<]*)<\/p>/.exec(trimmingPanel)?.[1] ?? null,
      traceStatistics: /<div class="stat-kv"><span>Per-Base Quality<\/span><strong>([^<]*)<\/strong>/.exec(sequenceOnly)?.[1] ?? null,
    }).toEqual({
      qualityTrimming: 'No quality values, so there is nothing to trim.',
      traceStatistics: 'No quality values',
    });
  });

  it('counts mixed peaks over the whole read when there is no high-quality region', () => {
    // 25 calls with second peaks under calls 3 and 12. Q2 at each end and Q40 between trims to 7..19,
    // which holds call 12 only; at Q0 throughout no base is good.
    const ends = [...new Array(6).fill(2), ...new Array(13).fill(40), ...new Array(6).fill(2)];
    const trimmed = withMixedPeaks(traceDoc('mixedEnds', ends), [3, 12]);
    const bad = withMixedPeaks(traceDoc('mixedQ0', new Array(25).fill(0)), [3, 12]);
    const unscored = withQualities(bad, []);
    expect([trimmed, bad, unscored].map((d) => mixedPeaksOf(d.chromatogram!))).toEqual([2, 2, 2]);
    const t = trimSangerTraceMottPhredRust(trimmed.chromatogram!, 0.05);
    expect([t.trimStart1based, t.trimEnd1based, t.heterozygoteCount]).toEqual([7, 19, 1]);

    // With a region the count is the trim's own, inside it, of the read's.
    expect(surfaces(trimmed).kpis['Mixed IUPAC Double Peaks']).toBe('1 of 2 in the trimmed region');
    // With none it is over the whole read: the trim keeps nothing of the Q0 read (BG-01M6RPCA) and
    // all of the unscored one...
    expectNoRegion(bad, NO_REGION);
    expectNoRegion(unscored, NO_QUALITY);
    // ...and still under a trim that keeps nothing of the unscored read either.
    engine.trim = (report, c, cutoff) =>
      c.phredScores.length === c.baseCalls.length && c.phredScores.some((q) => 10 ** (-q / 10) < cutoff)
        ? report
        : { ...report, trimStart1based: 1, trimEnd1based: 0, trimmedLengthBp: 0, trimmedSequence: '', iupacHeterozygoteConsensus: '', heterozygoteCount: 0 };
    expect([bad, unscored].map((d) => trimSangerTraceMottPhredRust(d.chromatogram!, 0.05).heterozygoteCount)).toEqual([0, 0]);
    expectNoRegion(bad, NO_REGION);
    expectNoRegion(unscored, NO_QUALITY);
    expect(surfaces(trimmed).kpis['Mixed IUPAC Double Peaks']).toBe('1 of 2 in the trimmed region');
  });

  it('counts mixed peaks over the whole read above the 32 the peak list holds', () => {
    // 70 calls with second peaks under calls 1..40, more than the viewport's list of 32. At Q0, or
    // with no qualities, there is no region; Q2 for 5 at each end and Q40 between trims to 6..65.
    const first40 = Array.from({ length: 40 }, (_, i) => i + 1);
    const ends = [...new Array(5).fill(2), ...new Array(60).fill(40), ...new Array(5).fill(2)];
    const bad = withMixedPeaks(traceDoc('mixed40Q0', new Array(70).fill(0)), first40);
    const unscored = withQualities(bad, []);
    const trimmed = withMixedPeaks(traceDoc('mixed40Ends', ends), first40);
    expect([bad, unscored, trimmed].map((d) => mixedPeaksOf(d.chromatogram!))).toEqual([40, 40, 40]);
    const t = expectRegion(trimmed);
    expect([t.trimStart1based, t.trimEnd1based, t.heterozygoteCount]).toEqual([6, 65, 35]);
    // trimNone pins "40 over the whole read" for both, and trimAt "35 of 40 in the trimmed region".
    expectNoRegion(bad, NO_REGION);
    expectNoRegion(unscored, NO_QUALITY);
    expect(surfaces(trimmed).kpis['Mixed IUPAC Double Peaks']).toBe('35 of 40 in the trimmed region');
  });
});

// ─── BG-01M6RT5Z ───

/**
 * The viewport lists at most 32 mixed peaks (`compute_chromatogram_viewport`, chromatogram_mbc.rs),
 * so a total read off that list stops at 32. Every surface states the read's own count, and the peak
 * table says when it holds only the first 32. Wrong implementations, and the case that catches each:
 * - the list's length as the total (the bug): 310.ab1 (311), 3100.ab1 (74), the 40-peak read;
 * - the trim's own count as the total, or the larger of it and the list's length: 3100.ab1 (19 of
 *   74 inside its region) and the 40-peak read (35 of 40). On 310.ab1 the trim keeps nothing
 *   (BG-01M6RPCA), so its own count, 0, catches the first too, and the larger of 0 and the list's 32
 *   is the list's length, which the case above catches;
 * - the in-region count with no total beside it: 3730.ab1 (1 of 23) and the 10-peak read (5 of 10);
 * - a cap note on a complete list, none on a cut one, or the list's length for both numbers: the
 *   10-peak read and 3730.ab1 (under the cap) against the others;
 * - one surface fixed and the rest not: every surface is read for every read.
 */
describe('mixed-peak totals', () => {
  /** How many mixed peaks the viewport's list holds at most. */
  const LISTED = 32;

  /** Every mixed-peak total of one render (cockpit, parameters tab, Trace Statistics, trimming section) and the peak table. */
  function peakSurfaces(doc: SequenceDocument) {
    const html = clicking([/^Parameters$/, /^Trace Statistics$/], () => renderToStaticMarkup(
      <ChromatogramAndContigStudio documents={[doc]} activeDoc={doc} onCreateDocument={noop} />));
    const mott = mottSection(html);
    const table = /<div class="mbc-smart-table-region"[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/table>/.exec(mott);
    return {
      cockpit: wordsOf(/<span title="Mixed IUPAC double peaks called across the read">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? ''),
      parameters: / • (\d+) mixed IUPAC call\(s\)<\/div>/.exec(html)?.[1] ?? null,
      statistics: /<div class="stat-kv"><span>Mixed IUPAC Peaks<\/span><strong>([^<]*)<\/strong>/.exec(html)?.[1] ?? null,
      trimming: wordsOf(/<span class="kpi-label">Mixed IUPAC Double Peaks<\/span><strong class="kpi-val">([\s\S]*?)<\/strong>/.exec(mott)?.[1] ?? ''),
      tableLabel: table?.[1] ?? null,
      tableRows: table ? (table[2].match(/<strong>bp \d+<\/strong>/g) ?? []).length : 0,
      note: /<p class="studio-panel-note">([^<]*)<\/p>/.exec(mott)?.[1] ?? null,
    };
  }

  /**
   * Every surface states `total` mixed peaks for `doc`; the trimming section gives `inRegion` of
   * them inside its region, or the total over the whole read when there is no region (null).
   */
  function expectTotal(doc: SequenceDocument, total: number, inRegion: number | null) {
    const listed = Math.min(LISTED, total);
    const cut = total > LISTED ? ` (first ${LISTED} of ${total})` : '';
    expect(peakSurfaces(doc), doc.name).toEqual({
      cockpit: `Mixed Peaks: ${total}`,
      parameters: String(total),
      statistics: String(total),
      trimming: inRegion === null ? `${total} over the whole read` : `${inRegion} of ${total} in the trimmed region`,
      tableLabel: `Mixed-Peak IUPAC Heterozygote Calls${cut}`,
      tableRows: listed,
      note: cut ? `The table lists the first ${LISTED} of ${total} mixed peaks.` : null,
    });
  }

  /** The trim's region and the mixed peaks inside it, with the read's own count. */
  const peaksOf = (doc: SequenceDocument) => {
    const t = trimSangerTraceMottPhredRust(doc.chromatogram!, 0.05);
    return [t.trimStart1based, t.trimEnd1based, t.heterozygoteCount, mixedPeaksOf(doc.chromatogram!)];
  };

  it('states the real mixed-peak count when the peak list holds fewer than the read has', () => {
    // 70 calls, Q2 for 5 at each end and Q40 between: the trim keeps 6..65. At Q0 it keeps nothing.
    const ends = [...new Array(5).fill(2), ...new Array(60).fill(40), ...new Array(5).fill(2)];
    const calls = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    const over = withMixedPeaks(traceDoc('peaks40', ends), calls(40));
    const under = withMixedPeaks(traceDoc('peaks10', ends), calls(10));
    const overBad = withMixedPeaks(traceDoc('peaks40q0', new Array(70).fill(0)), calls(40));
    expect([over, under, overBad].map(peaksOf)).toEqual([[6, 65, 35, 40], [6, 65, 5, 10], [1, 0, 0, 40]]);

    expectTotal(over, 40, 35);
    expectTotal(under, 10, 5);
    expectTotal(overBad, 40, null);
  });

  const have = haveTestData('biopython-abi/310.ab1', 'biopython-abi/3100.ab1', 'biopython-abi/3730.ab1');
  it.skipIf(!have)('states the real mixed-peak count of public traces with more peaks than the list holds', async () => {
    const read = async (name: string) => parseDnaBinaryPacket(await bytesOf(dataPath(`biopython-abi/${name}`)), name);
    const [q0, abi3100, abi3730] = [await read('310.ab1'), await read('3100.ab1'), await read('3730.ab1')];
    // 310.ab1 has no good base, so no region; the other two have one.
    expect([q0, abi3100, abi3730].map(peaksOf)).toEqual([[1, 0, 0, 311], [19, 697, 19, 74], [15, 1090, 1, 23]]);

    expectTotal(q0, 311, null);
    expectTotal(abi3100, 74, 19);
    // Under the cap the list is the whole count.
    expectTotal(abi3730, 23, 1);
  });
});
